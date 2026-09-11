/**
 * 직접 푸시 종단 · 전량 재파생 · PostgreSQL만으로의 재구축 (WP-029 / CR-039).
 *
 * **실제 git · 실제 PostgreSQL · 실제 Elasticsearch · 실제 EventBus를 쓴다.**
 *
 * 이 파일이 증명하는 것 셋은 전부 "코드가 있다"로는 증명되지 않는다:
 *
 * 1. **직접 푸시 커밋의 참조가 실제 방아쇠 사슬로 간선이 된다.** `EVT-ING-003`을
 *    손으로 만들어 넣지 않는다 — 그 이벤트는 이 경로에 애초에 발생하지 않는다.
 *    채번 → 보강 → 정본 → 색인 → **ready 신호** → 파생을 실제 버스로 잇는다.
 * 2. **되먹임이 없다.** 커밋 보강이 자기가 낸 신호를 같은 토픽에서 되받는데,
 *    처리하면 무한 루프다. 실제 버스로 돌려 루프가 없음을 본다.
 * 3. **PostgreSQL 정본만으로 `prs-links`를 다시 만들 수 있다** (ADR-004).
 *    색인을 비우고 정본만 남긴 뒤 재파생이 복구하는지 본다.
 *
 * 검증: `pnpm run test:integration worker/link-rebuild`
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Client } from '@elastic/elasticsearch';
import { InMemoryEventBus, TOPICS, consumerGroup, type Subscription } from '@prs/bus';
import { EVENT_NAMES, commitDocId, pullRequestDocId } from '@prs/domain';
import {
  commitSnapshotRepo,
  jobRepo,
  mergeSequenceRepo,
  prSnapshotRepo,
  repositoryRepo,
  sequenceSpaceRepo,
  type Pool,
  type RepositoryRow,
} from '@prs/db';
import { applyMappings, switchAliasesForTests, createEsClient, resolveClientOptions } from '@prs/es';
import { MirrorCommitGraph, MirrorSync, type CommitGraph } from '@prs/github';
import {
  COMMIT_ENRICH_CONSUMER,
  enrichCommit,
  handleProjectedEvent,
  type CommitEnrichDeps,
} from '../../src/commit-enrich.js';
import {
  LINK_REBUILD_TYPE,
  handleLinkEvent,
  runReferenceRebuild,
  startReferenceRebuildRunner,
  type LinkDeps,
} from '../../src/link.js';
import { createWorkerMetrics } from '../../src/metrics.js';
import { migratedPool, clearMergeSequence } from '../helpers.js';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  createSequenceFixture,
  firstParentOf,
  makeTempDir,
  removeDir,
  run,
  type SequenceFixture,
} from '../sequence/fixture.js';

const REPOSITORY_ID = 4711;
const OWNER = 'acme';
const NAME = 'link-rebuild-wp029';
const BRANCH = 'main';
const TEAM = 7111;
const HOST = 'ghe.acme.example';

let pool: Pool;
let es: Client;
let origin: SequenceFixture;
let mirrorRoot: string;
let repository: RepositoryRow;
let chain: readonly string[];
/** 참조를 담은 **직접 푸시** 커밋. 이 WP의 사용자-visible 동기다. */
let directSha: string;

/** 그 커밋 메시지가 가리키는 PR. 픽스처가 아니라 시험이 정한다. */
const DIRECT_REF_PR = 77;

function graph(): CommitGraph {
  return new MirrorCommitGraph({ root: mirrorRoot, repositoryIdOf: () => REPOSITORY_ID });
}

function linkDeps(bus: InMemoryEventBus): LinkDeps {
  return {
    pool,
    es,
    bus,
    metrics: createWorkerMetrics(),
    gheHost: `https://${HOST}`,
    log: () => undefined,
    refresh: true,
  };
}

function enrichDeps(bus: InMemoryEventBus): CommitEnrichDeps {
  return {
    pool,
    es,
    bus,
    metrics: createWorkerMetrics(),
    graphFor: () => graph(),
    log: () => undefined,
  };
}

async function linksOf(fromId: string): Promise<readonly Record<string, unknown>[]> {
  await es.indices.refresh({ index: 'prs-links' });
  const response = await es.search<Record<string, unknown>>({
    index: 'prs-links',
    size: 200,
    query: {
      bool: {
        filter: [
          { term: { repository_id: REPOSITORY_ID } },
          { term: { link_type: 'references' } },
          { term: { from_id: fromId } },
        ],
      },
    },
  });
  return response.hits.hits.map((hit) => ({ _id: hit._id, ...hit._source }));
}

async function allLinks(): Promise<number> {
  await es.indices.refresh({ index: 'prs-links' });
  const response = await es.count({
    index: 'prs-links',
    query: { term: { repository_id: REPOSITORY_ID } },
  });
  return response.count;
}

/** 현재 에폭 체인을 정본에 채운다. PR 매핑이 없으면 직접 푸시 커밋이다. */
async function seedSequence(): Promise<void> {
  for (const [index, sha] of chain.entries()) {
    await mergeSequenceRepo.upsertMergeSequence(pool, {
      repository_id: REPOSITORY_ID,
      base_branch: BRANCH,
      seq_epoch: 1,
      merge_seq: index + 1,
      commit_sha: sha,
      pull_request_number: null,
      committed_at: new Date('2026-08-01T00:00:00Z'),
    });
  }
  await sequenceSpaceRepo.advanceHead(pool, REPOSITORY_ID, BRANCH, chain.at(-1) ?? '', chain.length);
}

/**
 * 실제 두 소비자를 붙인 버스.
 *
 * `link:commit-enrich`와 `link` 두 **논리 소비자 그룹**이 같은 토픽을 읽는다.
 * consumer group은 work sharing이라 그룹이 같으면 이벤트가 나뉜다 — 그룹이
 * 다르므로 각자 전부 받는다 (CR-038, DEV-205).
 */
async function wireBus(): Promise<{
  bus: InMemoryEventBus;
  subscriptions: Subscription[];
  seen: string[];
}> {
  const bus = new InMemoryEventBus();
  const seen: string[] = [];
  const enrich = enrichDeps(bus);
  const link = linkDeps(bus);

  const subscriptions = [
    await bus.subscribe(
      TOPICS.projected,
      consumerGroup(TOPICS.projected, COMMIT_ENRICH_CONSUMER),
      async (delivered) => {
        seen.push(`commit-enrich:${delivered.event_name}`);
        return handleProjectedEvent(enrich, delivered);
      },
      {},
    ),
    await bus.subscribe(
      TOPICS.projected,
      consumerGroup(TOPICS.projected),
      async (delivered) => {
        seen.push(`link:${delivered.event_name}`);
        return handleLinkEvent(link, delivered);
      },
      {},
    ),
  ];

  return { bus, subscriptions, seen };
}

/**
 * 두 소비자가 조용해질 때까지 기다린다. 무한 루프면 여기서 끝나지 않는다.
 *
 * ## `until`을 주면 그 조건까지 기다린다 (DEV-346)
 *
 * **정적(quiet)은 "지금 전달 중인 이벤트가 없다"이지 "처리가 끝났다"가 아니다.**
 * 소비자가 이벤트를 받아 `seen`에 적은 뒤 정본을 쓰고 색인하는 동안 버스는
 * 조용하다. 느린 실행기에서 그 틈이 `quietMs`를 넘으면 사슬이 아직 진행 중인데
 * 멎은 것으로 판정하고, 시험은 간선이 없는 상태로 단언에 들어간다 — CI에서
 * 실제로 그렇게 실패했다(run 33073072697). 로컬에서는 늘 통과했다.
 *
 * 대기 시간을 늘려 가리지 않는다. **기대하는 상태를 직접 묻는다.**
 * 루프 탐지처럼 "아무 일도 더 일어나지 않는다"를 재는 곳은 `until` 없이 부른다.
 */
interface SettleOptions {
  readonly quietMs?: number;
  readonly limitMs?: number;
  /** 참이 될 때까지 기다린다. 정적만으로 빠져나오지 않는다. */
  readonly until?: () => Promise<boolean>;
}

async function settle(seen: string[], options: SettleOptions = {}): Promise<void> {
  const quietMs = options.quietMs ?? 300;
  const limitMs = options.limitMs ?? (options.until === undefined ? 6_000 : 20_000);
  const started = Date.now();
  let last = seen.length;
  let quietSince = Date.now();
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    if (seen.length !== last) {
      last = seen.length;
      quietSince = Date.now();
    }
    if (Date.now() - quietSince >= quietMs) {
      if (options.until === undefined) return;
      if (await options.until()) return;
      // 조건이 아직이면 정적 판정을 다시 시작한다 — 그 사이 새 이벤트가 올 수 있다.
      quietSince = Date.now();
    }
    if (Date.now() - started > limitMs) {
      throw new Error(
        options.until === undefined
          ? `이벤트가 멎지 않는다 (${String(seen.length)}건)`
          : `기대한 상태에 이르지 못했다 (이벤트 ${String(seen.length)}건)`,
      );
    }
  }
}

describe('직접 푸시 종단과 전량 재파생 (WP-029 / CR-039)', () => {
  beforeAll(async () => {
    pool = await migratedPool();
    es = createEsClient(resolveClientOptions());
    await es.cluster.health({ wait_for_status: 'yellow', timeout: '60s' });
    await applyMappings(es);
  // 매핑 버전이 올라간 별칭을 현재 정의로 옮긴다 (WP-032). 시험 전용.
  await switchAliasesForTests(es);

    origin = await createSequenceFixture();

    /*
     * ---- 참조를 담은 직접 푸시 커밋을 하나 더한다.
     *
     * 기본 픽스처의 메시지에는 참조가 없어 "간선이 생겼는가"를 **조건부로만**
     * 물을 수 있었다 — 픽스처가 우연히 참조를 담지 않으면 그 시험은 아무것도
     * 증명하지 않는다. 무엇을 물을지 시험이 정한다.
     */
    await writeFile(join(origin.dir, 'hotfix.txt'), 'hotfix\n', 'utf8');
    await run(origin.dir, ['add', '.']);
    await run(origin.dir, [
      'commit',
      '-q',
      '-m',
      `c5 hotfix\n\nRefs: #${String(DIRECT_REF_PR)}`,
    ]);
    directSha = (await run(origin.dir, ['rev-parse', 'HEAD'])).trim();

    mirrorRoot = await makeTempDir('prs-link-mirror-');
    await new MirrorSync({ root: mirrorRoot, remoteUrl: () => origin.url }).sync(
      { owner: OWNER, repo: NAME },
      REPOSITORY_ID,
    );
    chain = await firstParentOf(origin.dir, BRANCH);
    expect(chain.length).toBeGreaterThan(0);
  }, 180_000);

  afterAll(async () => {
    await es?.close();
    await pool?.end();
    if (origin !== undefined) await removeDir(origin.dir);
    if (mirrorRoot !== undefined) await removeDir(mirrorRoot);
  });

  beforeEach(async () => {
    await pool.query('DELETE FROM job WHERE target = $1', [`${OWNER}/${NAME}`]);
    await clearMergeSequence(pool, 'repository_id = $1', [REPOSITORY_ID]);
    await pool.query('DELETE FROM commit_snapshot WHERE repository_id = $1', [REPOSITORY_ID]);
    await pool.query('DELETE FROM pull_request_snapshot WHERE repository_id = $1', [REPOSITORY_ID]);
    await pool.query('DELETE FROM repository WHERE repository_id = $1', [REPOSITORY_ID]);
    await repositoryRepo.upsertRepository(pool, {
      repository_id: REPOSITORY_ID,
      owner: OWNER,
      name: NAME,
      org_id: 1,
      visibility: 'private',
      sequence_branches: [BRANCH],
      mirror_enabled: true,
      status: 'active',
    });
    await repositoryRepo.setAllowedTeams(pool, REPOSITORY_ID, [TEAM]);
    repository = (await repositoryRepo.findRepositoryById(pool, REPOSITORY_ID))!;
    await sequenceSpaceRepo.ensureSequenceSpace(pool, REPOSITORY_ID, BRANCH);

    for (const index of ['prs-links', 'prs-pull-requests', 'prs-commits']) {
      await es.indices.refresh({ index });
      await es.deleteByQuery({
        index,
        refresh: true,
        conflicts: 'proceed',
        query: { term: { repository_id: REPOSITORY_ID } },
      });
    }
  });

  /* --------------------------------------------------------------------- */

  it('**직접 푸시 커밋의 참조가 실제 방아쇠 사슬로 간선이 된다** (DEV-215)', async () => {
    /*
     * 이 경로에는 `EVT-ING-003`이 애초에 발생하지 않는다 — 그 이벤트는 `project`
     * 워커가 만든 문서에만 나온다. 직접 푸시 커밋 문서는 커밋 보강이 만든다.
     * 그래서 채번 이벤트 하나만 넣고, 나머지는 **운영이 실제로 하는 대로** 흐르게 둔다.
     */
    await seedSequence();
    const { bus, subscriptions, seen } = await wireBus();

    try {
      await bus.publish(TOPICS.projected, String(REPOSITORY_ID), {
        event_id: 'seq-1',
        event_name: EVENT_NAMES.sequenceAssigned,
        correlation_id: 'corr-1',
        occurred_at: '2026-08-01T00:00:00.000Z',
        payload: {
          repository_id: REPOSITORY_ID,
          base_branch: BRANCH,
          seq_epoch: 1,
          from_seq: 1,
          to_seq: chain.length,
          head_sha: chain.at(-1) ?? '',
        },
      });

      /*
       * **간선이 생길 때까지 기다린다** (DEV-346). 이 사슬은 채번 → 보강 →
       * 정본 → 색인 → 신호 → 파생으로 이어지고, 마지막 두 홉 사이에 버스가
       * 조용한 구간이 있다. 정적만으로 판정하면 그 구간에서 빠져나온다.
       */
      await settle(seen, { until: async () => (await linksOf(commitDocId(REPOSITORY_ID, directSha))).length > 0 });

      // ---- ready 신호가 실제로 나왔다. 이것이 없으면 사슬이 끊긴 것이다.
      expect(seen.filter((one) => one === `link:${EVENT_NAMES.commitMetadataReady}`).length).toBeGreaterThan(0);
      // `EVT-ING-003`은 이 경로에 **애초에 오지 않는다** — 그것이 DEV-215의 요지다.
      expect(seen).not.toContain(`link:${EVENT_NAMES.ingestionProjected}`);

      // ---- 정본이 채워졌다. 그것이 파생의 입력이다 (ADR-004).
      const snapshots = await pool.query<{ count: string }>(
        'SELECT count(*)::text AS count FROM commit_snapshot WHERE repository_id = $1',
        [REPOSITORY_ID],
      );
      expect(Number(snapshots.rows[0]?.count)).toBe(chain.length);

      /*
       * ---- **직접 푸시 커밋의 참조가 실제로 간선이 됐다.**
       *
       * 이 단언이 이 WP의 사용자-visible 결과다. 조건부로 걸지 않는다.
       */
      const links = await linksOf(commitDocId(REPOSITORY_ID, directSha));
      expect(links).toHaveLength(1);
      expect(links[0]?.['reference_key']).toBe(`pr:${String(DIRECT_REF_PR)}`);
      expect(links[0]?.['from_type']).toBe('commit');
      expect(links[0]?.['confidence']).toBe('derived');
      // 대상이 색인되지 않았으므로 미해결이 정답이다 — 오류가 아니다.
      expect(links[0]?.['resolved']).toBe(false);
      // 접근 통제 material이 생성 시점에 함께 들어갔다 (THR-035).
      expect(links[0]?.['allowed_team_ids']).toEqual([TEAM]);
    } finally {
      for (const subscription of subscriptions) await subscription.close();
      await bus.close();
    }
  }, 60_000);

  it('**되먹임이 없다** — 커밋 보강이 자기 신호를 되받아 다시 내지 않는다 (DEV-216)', async () => {
    await seedSequence();
    const { bus, subscriptions, seen } = await wireBus();

    try {
      await bus.publish(TOPICS.projected, String(REPOSITORY_ID), {
        event_id: 'seq-loop',
        event_name: EVENT_NAMES.sequenceAssigned,
        correlation_id: 'corr-loop',
        occurred_at: '2026-08-01T00:00:00.000Z',
        payload: {
          repository_id: REPOSITORY_ID,
          base_branch: BRANCH,
          seq_epoch: 1,
          from_seq: 1,
          to_seq: chain.length,
          head_sha: chain.at(-1) ?? '',
        },
      });

      // 루프가 있으면 `settle`이 던진다.
      await settle(seen);

      const ready = seen.filter((one) => one === `link:${EVENT_NAMES.commitMetadataReady}`).length;
      const bounced = seen.filter(
        (one) => one === `commit-enrich:${EVENT_NAMES.commitMetadataReady}`,
      ).length;

      // 보강도 그 신호를 **받기는** 한다 — 같은 토픽이기 때문이다.
      expect(bounced).toBe(ready);
      // 그러나 처리하지 않으므로 신호 수가 커밋 수를 넘지 않는다.
      expect(ready).toBeLessThanOrEqual(chain.length);
    } finally {
      for (const subscription of subscriptions) await subscription.close();
      await bus.close();
    }
  }, 60_000);

  /* --------------------------------------------------------------------- */

  describe('전량 재파생 (JOB-REL-006, DEV-221)', () => {
    it('**이벤트를 하나도 받지 않은 과거 데이터에 간선이 생긴다**', async () => {
      /*
       * WP-029 배포 **전부터** 있던 정본을 흉내 낸다. Redis backlog는 없다 —
       * 그것이 이 잡이 존재하는 이유다.
       */
      await prSnapshotRepo.upsertPullRequestSnapshot(pool, {
        repositoryId: REPOSITORY_ID,
        prNumber: 5,
        documentVersion: 1,
        source: 'backfill',
        document: { pr_number: 5, title: 'old', body: 'Refs: #4', updated_at: '2026-07-01T00:00:00.000Z' },
      });
      await prSnapshotRepo.upsertPullRequestSnapshot(pool, {
        repositoryId: REPOSITORY_ID,
        prNumber: 4,
        documentVersion: 1,
        source: 'backfill',
        document: { pr_number: 4, title: 'older', body: 'no refs', updated_at: '2026-07-01T00:00:00.000Z' },
      });
      for (const prNumber of [4, 5]) {
        await es.index({
          index: 'prs-pull-requests',
          id: pullRequestDocId(REPOSITORY_ID, prNumber),
          routing: String(REPOSITORY_ID),
          refresh: true,
          document: {
            document_version: 1,
            repository_id: REPOSITORY_ID,
            repository: `${OWNER}/${NAME}`,
            org_id: 1,
            visibility: 'private',
            allowed_team_ids: [TEAM],
            pr_number: prNumber,
            links_pending: true,
            link_summary: {
              has_revert: false,
              is_reverted: false,
              has_cherry_pick: false,
              has_stack: false,
              reference_count: 0,
            },
          },
        });
      }

      expect(await allLinks()).toBe(0);

      const bus = new InMemoryEventBus();
      try {
        // PR 단계 → 커밋 단계 순으로 돈다. 커서가 넘어갈 때까지 돌린다.
        let cursor = undefined as undefined | Awaited<ReturnType<typeof runReferenceRebuild>>['cursor'];
        for (let round = 0; round < 5; round += 1) {
          const result = await runReferenceRebuild(linkDeps(bus), repository, cursor);
          cursor = result.cursor;
          if (result.done) break;
        }

        const links = await linksOf(pullRequestDocId(REPOSITORY_ID, 5));
        expect(links).toHaveLength(1);
        expect(links[0]?.['reference_key']).toBe('pr:4');
        // #4는 이미 색인돼 있으므로 해결된 상태여야 한다.
        expect(links[0]?.['resolved']).toBe(true);
      } finally {
        await bus.close();
      }
    }, 60_000);

    it('**PostgreSQL 정본만으로 `prs-links`를 다시 만든다** (ADR-004, §51)', async () => {
      await prSnapshotRepo.upsertPullRequestSnapshot(pool, {
        repositoryId: REPOSITORY_ID,
        prNumber: 9,
        documentVersion: 1,
        source: 'webhook',
        document: { pr_number: 9, title: 't', body: 'Refs: #8', updated_at: '2026-07-01T00:00:00.000Z' },
      });
      await es.index({
        index: 'prs-pull-requests',
        id: pullRequestDocId(REPOSITORY_ID, 9),
        routing: String(REPOSITORY_ID),
        refresh: true,
        document: {
          document_version: 1,
          repository_id: REPOSITORY_ID,
          repository: `${OWNER}/${NAME}`,
          org_id: 1,
          visibility: 'private',
          allowed_team_ids: [TEAM],
          pr_number: 9,
          links_pending: true,
          link_summary: {
            has_revert: false,
            is_reverted: false,
            has_cherry_pick: false,
            has_stack: false,
            reference_count: 0,
          },
        },
      });

      const bus = new InMemoryEventBus();
      try {
        let cursor = undefined as undefined | Awaited<ReturnType<typeof runReferenceRebuild>>['cursor'];
        for (let round = 0; round < 5; round += 1) {
          const result = await runReferenceRebuild(linkDeps(bus), repository, cursor);
          cursor = result.cursor;
          if (result.done) break;
        }
        expect(await allLinks()).toBe(1);

        /*
         * ---- 간선 인덱스를 통째로 비운다. 정본은 그대로다.
         *
         * `delete_by_query`는 **검색으로** 대상을 찾으므로 앞에서 refresh 한다.
         */
        await es.indices.refresh({ index: 'prs-links' });
        await es.deleteByQuery({
          index: 'prs-links',
          refresh: true,
          conflicts: 'proceed',
          query: { term: { repository_id: REPOSITORY_ID } },
        });
        expect(await allLinks()).toBe(0);

        // ---- 정본만으로 복구한다.
        cursor = undefined;
        for (let round = 0; round < 5; round += 1) {
          const result = await runReferenceRebuild(linkDeps(bus), repository, cursor);
          cursor = result.cursor;
          if (result.done) break;
        }

        const links = await linksOf(pullRequestDocId(REPOSITORY_ID, 9));
        expect(links).toHaveLength(1);
        expect(links[0]?.['reference_key']).toBe('pr:8');
        // 접근 통제 material도 함께 복구된다 — 재구축이 반쪽이면 유출이다.
        expect(links[0]?.['allowed_team_ids']).toEqual([TEAM]);
      } finally {
        await bus.close();
      }
    }, 60_000);

    it('**운영자가 만든 잡을 러너가 실제로 집어 끝낸다** (PR #44 리뷰 P1)', async () => {
      /*
       * `target`은 API-ADM-002가 만드는 형식(`owner/repo`)이다. 러너가 그것을
       * 해석하지 못하면 운영자가 만들 수 있는 유일한 행을 아무도 처리하지 못한다.
       */
      await prSnapshotRepo.upsertPullRequestSnapshot(pool, {
        repositoryId: REPOSITORY_ID,
        prNumber: 21,
        documentVersion: 1,
        source: 'backfill',
        document: { pr_number: 21, title: 't', body: 'Refs: #20', updated_at: '2026-07-01T00:00:00.000Z' },
      });
      await es.index({
        index: 'prs-pull-requests',
        id: pullRequestDocId(REPOSITORY_ID, 21),
        routing: String(REPOSITORY_ID),
        refresh: true,
        document: {
          document_version: 1,
          repository_id: REPOSITORY_ID,
          repository: `${OWNER}/${NAME}`,
          org_id: 1,
          visibility: 'private',
          allowed_team_ids: [TEAM],
          pr_number: 21,
          links_pending: true,
          link_summary: {
            has_revert: false,
            is_reverted: false,
            has_cherry_pick: false,
            has_stack: false,
            reference_count: 0,
          },
        },
      });

      const jobId = await jobRepo.enqueueJob(pool, LINK_REBUILD_TYPE, `${OWNER}/${NAME}`, 'alice');
      const bus = new InMemoryEventBus();
      const runner = startReferenceRebuildRunner(linkDeps(bus));
      try {
        for (let waited = 0; waited < 60; waited += 1) {
          const row = await jobRepo.findJobById(pool, jobId);
          if (row?.state === 'completed' || row?.state === 'failed') break;
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
        const row = await jobRepo.findJobById(pool, jobId);
        expect(row?.state).toBe('completed');
        expect(row?.error).toBeNull();

        const links = await linksOf(pullRequestDocId(REPOSITORY_ID, 21));
        expect(links).toHaveLength(1);
        expect(links[0]?.['reference_key']).toBe('pr:20');
      } finally {
        await runner.stop();
        await bus.close();
      }
    }, 60_000);

    it('**재파생은 결정론적이다** — 두 번 돌려도 같은 문서 ID다', async () => {
      await prSnapshotRepo.upsertPullRequestSnapshot(pool, {
        repositoryId: REPOSITORY_ID,
        prNumber: 11,
        documentVersion: 1,
        source: 'webhook',
        document: { pr_number: 11, title: 't', body: 'Refs: #1 #2', updated_at: '2026-07-01T00:00:00.000Z' },
      });
      await es.index({
        index: 'prs-pull-requests',
        id: pullRequestDocId(REPOSITORY_ID, 11),
        routing: String(REPOSITORY_ID),
        refresh: true,
        document: {
          document_version: 1,
          repository_id: REPOSITORY_ID,
          repository: `${OWNER}/${NAME}`,
          org_id: 1,
          visibility: 'private',
          allowed_team_ids: [TEAM],
          pr_number: 11,
          links_pending: true,
          link_summary: {
            has_revert: false,
            is_reverted: false,
            has_cherry_pick: false,
            has_stack: false,
            reference_count: 0,
          },
        },
      });

      const bus = new InMemoryEventBus();
      try {
        const run = async (): Promise<readonly unknown[]> => {
          let cursor = undefined as undefined | Awaited<ReturnType<typeof runReferenceRebuild>>['cursor'];
          for (let round = 0; round < 5; round += 1) {
            const result = await runReferenceRebuild(linkDeps(bus), repository, cursor);
            cursor = result.cursor;
            if (result.done) break;
          }
          return (await linksOf(pullRequestDocId(REPOSITORY_ID, 11)))
            .map((link) => link['_id'])
            .sort();
        };

        const first = await run();
        const second = await run();
        expect(first).toHaveLength(2);
        expect(second).toEqual(first);
        // 두 번 돌려도 문서가 늘지 않는다 (ADR-009 멱등).
        expect(await allLinks()).toBe(2);
      } finally {
        await bus.close();
      }
    }, 60_000);
  });

  /* --------------------------------------------------------------------- */

  it('**ready 신호 발행이 실패하면 완결을 찍지 않는다** — 스윕이 다시 본다 (PR #44 리뷰 P1)', async () => {
    /*
     * 발행을 완결 표식 뒤에 두면 발행 실패가 **영구 유실**이 된다: 스냅숏이 있고
     * 투영도 찍혀 있어 두 스윕이 모두 그 커밋을 건너뛰고, `enrichCommits`는 예외를
     * 잡아 `skipped`로 세며 핸들러는 ack한다. 직접 푸시 커밋의 유일한 방아쇠가
     * 사라지고 그 메시지의 참조는 영영 간선이 되지 않는다.
     */
    await seedSequence();
    const bus = new InMemoryEventBus();
    try {
      const broken = {
        ...enrichDeps(bus),
        bus: { publish: () => Promise.reject(new Error('bus down')) } as never,
      };

      await expect(
        enrichCommit(broken, repository, { commitSha: directSha, firstParent: true, pullRequestNumber: null }),
      ).rejects.toThrow(/bus down/);

      const row = await commitSnapshotRepo.findCommitSnapshot(pool, REPOSITORY_ID, directSha);
      // 정본은 남았다 — 그것이 재구성 근거다 (ADR-004).
      expect(row?.message).toContain(`Refs: #${String(DIRECT_REF_PR)}`);
      // **완결은 찍히지 않았다.** 이것이 스윕의 재시도 조건이다.
      expect(row?.projected_at).toBeNull();

      const pending = await commitSnapshotRepo.listCommitsMissingProjection(pool, 500);
      expect(pending.some((one) => one.commit_sha === directSha)).toBe(true);
    } finally {
      await bus.close();
    }
  }, 60_000);

  it('커밋 문서도 `links_pending`을 가질 수 있다 (DEV-218)', async () => {
    const sha = chain[0]!;
    await es.index({
      index: 'prs-commits',
      id: commitDocId(REPOSITORY_ID, sha),
      routing: String(REPOSITORY_ID),
      refresh: true,
      document: {
        document_version: 1,
        repository_id: REPOSITORY_ID,
        repository: `${OWNER}/${NAME}`,
        org_id: 1,
        visibility: 'private',
        allowed_team_ids: [TEAM],
        commit_sha: sha,
        role: 'direct_push',
        // 매핑에 이 필드가 없으면 strict가 THR-010으로 거부한다.
        links_pending: true,
        link_summary: { has_revert: false, is_reverted: false, has_cherry_pick: false, reference_count: 0 },
      },
    });

    const doc = await es.get<Record<string, unknown>>({
      index: 'prs-commits',
      id: commitDocId(REPOSITORY_ID, sha),
      routing: String(REPOSITORY_ID),
    });
    expect(doc._source?.['links_pending']).toBe(true);
    expect((doc._source?.['link_summary'] as Record<string, unknown>)['reference_count']).toBe(0);
  });
});
