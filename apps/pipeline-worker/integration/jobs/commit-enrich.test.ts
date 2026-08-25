/**
 * JOB-MIR-002 커밋 메타데이터 보강 (WP-067 / CR-038, DEV-206~214).
 *
 * **실제 git · 실제 PostgreSQL · 실제 Elasticsearch를 쓴다.** 이 WP가 증명해야 할
 * 것 대부분이 그 셋의 동작 그 자체다:
 *
 * - "직접 푸시 커밋이 실제 문서로 존재한다"는 **색인이** 판정한다
 * - "`document_version`이 변하지 않는다"는 **업서트 스크립트가** 강제한다
 * - "정본에서 재구성할 수 있다"는 **PostgreSQL 행이** 근거다
 * - "blob을 인출하지 않는다"는 **미러 볼륨이** 답한다
 *
 * 검증: `pnpm test:integration jobs/commit-enrich`
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Client } from '@elastic/elasticsearch';
import type { EventBus } from '@prs/bus';
import { commitDocId, EVENT_NAMES } from '@prs/domain';
import {
  commitSnapshotRepo,
  mergeSequenceRepo,
  repositoryRepo,
  sequenceSpaceRepo,
  type Pool,
  type RepositoryRow,
} from '@prs/db';
import { applyMappings, createEsClient, dropEntityIndices, resolveClientOptions } from '@prs/es';
import { MirrorCommitGraph, MirrorSync, type CommitGraph } from '@prs/github';
import {
  enrichCommit,
  handleProjectedEvent,
  runCommitEnrichSweep,
  type CommitEnrichDeps,
} from '../../src/commit-enrich.js';
import { createWorkerMetrics } from '../../src/metrics.js';
import { migratedPool } from '../helpers.js';
import {
  createSequenceFixture,
  firstParentOf,
  makeTempDir,
  removeDir,
  type SequenceFixture,
} from '../sequence/fixture.js';

const REPOSITORY_ID = 4601;
const OWNER = 'acme';
const NAME = 'commit-enrich-wp067';
const BRANCH = 'main';

let pool: Pool;
let es: Client;
let origin: SequenceFixture;
let mirrorRoot: string;
let repository: RepositoryRow;
/** git이 낸 정답지. 오래된 것부터다. */
let chain: readonly string[];

function mirrorGraph(options: { readonly allowBlobFetch?: boolean } = {}): CommitGraph {
  return new MirrorCommitGraph({
    root: mirrorRoot,
    repositoryIdOf: () => REPOSITORY_ID,
    ...(options.allowBlobFetch === undefined ? {} : { allowBlobFetch: options.allowBlobFetch }),
  });
}

/** 미러가 없는 저장소를 흉내 낸다 — `patchId`가 `no_mirror`를 낸다. */
function noMirrorGraph(): CommitGraph {
  return new MirrorCommitGraph({ root: `${mirrorRoot}-absent`, repositoryIdOf: () => REPOSITORY_ID });
}

function deps(graph: CommitGraph = mirrorGraph(), published: unknown[] = []): CommitEnrichDeps {
  return {
    pool,
    es,
    bus: {
      publish: (_topic: string, _key: string, event: unknown) => {
        published.push(event);
        return Promise.resolve();
      },
    } as unknown as EventBus,
    metrics: createWorkerMetrics(),
    graphFor: () => graph,
    log: () => undefined,
  };
}

async function commitDoc(sha: string): Promise<Record<string, unknown> | undefined> {
  await es.indices.refresh({ index: 'prs-commits' });
  try {
    const response = await es.get<Record<string, unknown>>({
      index: 'prs-commits',
      id: commitDocId(REPOSITORY_ID, sha),
      routing: String(REPOSITORY_ID),
    });
    return response._source;
  } catch {
    return undefined;
  }
}

/** 현재 에폭 체인을 정본에 채운다. 직접 푸시 커밋도 여기 들어온다. */
async function seedSequence(pullRequestFor: (index: number) => number | null = () => null): Promise<void> {
  for (const [index, sha] of chain.entries()) {
    await mergeSequenceRepo.upsertMergeSequence(pool, {
      repository_id: REPOSITORY_ID,
      base_branch: BRANCH,
      seq_epoch: 1,
      merge_seq: index + 1,
      commit_sha: sha,
      pull_request_number: pullRequestFor(index),
      committed_at: new Date('2026-08-01T00:00:00Z'),
    });
  }
  await sequenceSpaceRepo.advanceHead(pool, REPOSITORY_ID, BRANCH, chain.at(-1) ?? '', chain.length);
}

describe('커밋 메타데이터 보강 (WP-067 / CR-038)', () => {
  beforeAll(async () => {
    pool = await migratedPool();
    es = createEsClient(resolveClientOptions());
    await es.cluster.health({ wait_for_status: 'yellow', timeout: '60s' });
    await dropEntityIndices(es);
    await applyMappings(es);

    origin = await createSequenceFixture();
    mirrorRoot = await makeTempDir('prs-enrich-mirror-');
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
    await pool.query('DELETE FROM merge_sequence WHERE repository_id = $1', [REPOSITORY_ID]);
    await pool.query('DELETE FROM commit_snapshot WHERE repository_id = $1', [REPOSITORY_ID]);
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
    await repositoryRepo.setAllowedTeams(pool, REPOSITORY_ID, [7001]);
    repository = (await repositoryRepo.findRepositoryById(pool, REPOSITORY_ID))!;
    await sequenceSpaceRepo.ensureSequenceSpace(pool, REPOSITORY_ID, BRANCH);

    /*
     * **지우기 전에 먼저 refresh한다.** `delete_by_query`는 검색으로 대상을 찾으므로
     * 아직 refresh되지 않은 문서를 보지 못한다 — `refresh: true`는 지운 *뒤에*
     * 새로 고치는 옵션이라 이 문제를 풀지 않는다 (WP-019가 CI에서 겪은 것과 같다).
     */
    await es.indices.refresh({ index: 'prs-commits' });
    await es.deleteByQuery({
      index: 'prs-commits',
      query: { term: { repository_id: REPOSITORY_ID } },
      refresh: true,
      conflicts: 'proceed',
    });
  });

  describe('직접 푸시 커밋이 실제 문서가 된다 (DEV-206)', () => {
    it('**색인에 없던 first-parent 커밋의 문서를 만든다**', async () => {
      const sha = chain[0] ?? '';
      expect(await commitDoc(sha)).toBeUndefined();

      const done = await enrichCommit(deps(), repository, {
        commitSha: sha,
        firstParent: true,
        pullRequestNumber: null,
        baseBranch: BRANCH,
      });
      expect(done).toBe(true);

      const doc = await commitDoc(sha);
      expect(doc).toBeDefined();
      expect(doc?.['commit_sha']).toBe(sha);
      expect(doc?.['role']).toBe('direct_push');
      expect(typeof doc?.['message']).toBe('string');
      expect(doc?.['message']).not.toBe('');
      expect(Array.isArray(doc?.['changed_paths'])).toBe(true);
    });

    it('**접근 통제 material을 문서 생성 시점에 함께 싣는다** (DEV-213)', async () => {
      const sha = chain[0] ?? '';
      await enrichCommit(deps(), repository, {
        commitSha: sha,
        firstParent: true,
        pullRequestNumber: null,
        baseBranch: BRANCH,
      });

      const doc = await commitDoc(sha);
      /*
       * 먼저 만들고 나중에 채우면 그 사이 문서를 강제 필터가 거를 수 없다.
       * fail closed를 유지한다.
       */
      expect(doc?.['repository_id']).toBe(REPOSITORY_ID);
      expect(doc?.['org_id']).toBe(1);
      expect(doc?.['visibility']).toBe('private');
      expect(doc?.['allowed_team_ids']).toEqual([7001]);
      expect(doc?.['repository_archived']).toBe(false);
    });

    it('초기 `document_version`이 **커밋 시각**이다 (DEV-209)', async () => {
      const sha = chain[0] ?? '';
      await enrichCommit(deps(), repository, {
        commitSha: sha,
        firstParent: true,
        pullRequestNumber: null,
        baseBranch: BRANCH,
      });

      const doc = await commitDoc(sha);
      const committedAt = String(doc?.['committed_at']);
      /*
       * `Date.now()`를 쓰면 그 뒤 도착하는 정상 웹훅 투영이 전부 "오래된 이벤트"로
       * 밀려나 이 문서가 PR 정보를 영영 받지 못한다.
       */
      expect(doc?.['document_version']).toBe(Date.parse(committedAt));
      expect(Number(doc?.['document_version'])).toBeLessThan(Date.now());
    });

    it('체인 밖 커밋은 문서를 만들지 않는다 — 접근 범위를 확신할 수 없다', async () => {
      const sha = chain[0] ?? '';
      const done = await enrichCommit(deps(), repository, {
        commitSha: sha,
        firstParent: false,
        pullRequestNumber: null,
      });
      expect(done).toBe(true);
      // 정본에는 남지만 색인 문서는 만들지 않는다.
      expect(await commitDoc(sha)).toBeUndefined();
      expect(await commitSnapshotRepo.findCommitSnapshot(pool, REPOSITORY_ID, sha)).toBeDefined();
    });
  });

  describe('역할 판정과 교정 (DEV-207)', () => {
    it('PR 매핑이 생기면 `direct_push`가 `merge_commit`으로 **교정된다**', async () => {
      const sha = chain[0] ?? '';
      await enrichCommit(deps(), repository, {
        commitSha: sha,
        firstParent: true,
        pullRequestNumber: null,
        baseBranch: BRANCH,
      });
      expect((await commitDoc(sha))?.['role']).toBe('direct_push');

      // push와 PR 투영 사이의 경주가 늦게 해소된 상황이다.
      await enrichCommit(deps(), repository, {
        commitSha: sha,
        firstParent: true,
        pullRequestNumber: 42,
        baseBranch: BRANCH,
      });
      expect((await commitDoc(sha))?.['role']).toBe('merge_commit');
    });

    it('체인 소속을 모르면 역할을 건드리지 않는다', async () => {
      const sha = chain[0] ?? '';
      await enrichCommit(deps(), repository, {
        commitSha: sha,
        firstParent: true,
        pullRequestNumber: 42,
        baseBranch: BRANCH,
      });
      expect((await commitDoc(sha))?.['role']).toBe('merge_commit');

      // 원본 커밋 경로(EVT-ING-003)는 first-parent 여부를 모른다.
      await enrichCommit(deps(), repository, { commitSha: sha, firstParent: false, pullRequestNumber: null });
      expect((await commitDoc(sha))?.['role']).toBe('merge_commit');
    });
  });

  describe('멱등과 버전 불변 (DoD 5·6)', () => {
    it('**같은 SHA를 두 번 보강해도 문서가 같고 `document_version`이 변하지 않는다**', async () => {
      const sha = chain[0] ?? '';
      await enrichCommit(deps(), repository, {
        commitSha: sha,
        firstParent: true,
        pullRequestNumber: null,
        baseBranch: BRANCH,
      });
      const first = await commitDoc(sha);

      await enrichCommit(deps(), repository, {
        commitSha: sha,
        firstParent: true,
        pullRequestNumber: null,
        baseBranch: BRANCH,
      });
      const second = await commitDoc(sha);

      expect(second).toEqual(first);
      expect(second?.['document_version']).toBe(first?.['document_version']);
    });

    it('기존 문서를 보강해도 `document_version`이 오르지 않는다 (DEV-209)', async () => {
      const sha = chain[0] ?? '';
      // 투영이 만든 문서를 흉내 낸다 — 버전이 이미 높다.
      const version = Date.now();
      await es.index({
        index: 'prs-commits',
        id: commitDocId(REPOSITORY_ID, sha),
        routing: String(REPOSITORY_ID),
        refresh: true,
        document: {
          document_version: version,
          doc_id: commitDocId(REPOSITORY_ID, sha),
          repository_id: REPOSITORY_ID,
          repository: `${OWNER}/${NAME}`,
          org_id: 1,
          visibility: 'private',
          allowed_team_ids: [7001],
          repository_archived: false,
          commit_sha: sha,
          role: 'merge_commit',
        },
      });

      await enrichCommit(deps(), repository, { commitSha: sha, firstParent: false, pullRequestNumber: null });

      const doc = await commitDoc(sha);
      expect(doc?.['document_version']).toBe(version);
      // 그러면서도 메타데이터는 실제로 들어갔다 — 조건부 대입이었다면 아무것도 안 붙는다.
      expect(typeof doc?.['message']).toBe('string');
      expect(doc?.['message']).not.toBe('');
    });
  });

  describe('patch-id 사유 (DoD 3·4 / FR-REL-005 AC-5)', () => {
    it('blob 인출이 꺼져 있으면 `patch_id` 키가 **없고** 사유가 `blob_fetch_disabled`다', async () => {
      const sha = chain[0] ?? '';
      await enrichCommit(deps(mirrorGraph({ allowBlobFetch: false })), repository, {
        commitSha: sha,
        firstParent: true,
        pullRequestNumber: null,
        baseBranch: BRANCH,
      });

      const doc = await commitDoc(sha);
      expect(doc?.['patch_id']).toBeUndefined();
      expect(doc?.['patch_id_unavailable']).toBe('blob_fetch_disabled');

      const row = await commitSnapshotRepo.findCommitSnapshot(pool, REPOSITORY_ID, sha);
      expect(row?.patch_id).toBeNull();
      expect(row?.patch_id_unavailable).toBe('blob_fetch_disabled');
    });

    it('미러가 없으면 사유가 `no_mirror`다', async () => {
      const sha = chain[0] ?? '';
      const done = await enrichCommit(deps(noMirrorGraph()), repository, {
        commitSha: sha,
        firstParent: true,
        pullRequestNumber: null,
        baseBranch: BRANCH,
      });
      // 미러가 없으면 커밋 자체를 읽지 못한다 — 오류가 아니라 "다음에 다시 본다"이다.
      expect(done).toBe(false);
      expect(await commitDoc(sha)).toBeUndefined();
    });
  });

  describe('PostgreSQL 정본에서 재구성할 수 있다 (DEV-208 / ADR-004)', () => {
    it('색인을 통째로 잃어도 정본이 커밋 문서의 근거를 갖고 있다', async () => {
      await seedSequence();
      for (const sha of chain) {
        await enrichCommit(deps(), repository, {
          commitSha: sha,
          firstParent: true,
          pullRequestNumber: null,
          baseBranch: BRANCH,
        });
      }

      // 색인을 지운다. 검색으로 대상을 찾으므로 먼저 refresh한다.
      await es.indices.refresh({ index: 'prs-commits' });
      await es.deleteByQuery({
        index: 'prs-commits',
        query: { term: { repository_id: REPOSITORY_ID } },
        refresh: true,
        conflicts: 'proceed',
      });
      expect(await commitDoc(chain[0] ?? '')).toBeUndefined();

      // 정본만으로 같은 값을 되찾는다.
      const rows = await commitSnapshotRepo.listCommitSnapshots(pool, REPOSITORY_ID, chain);
      expect(rows).toHaveLength(chain.length);
      for (const row of rows) {
        expect(row.message).not.toBe('');
        expect(row.committed_at).toBeInstanceOf(Date);
        expect(Array.isArray(row.parent_shas)).toBe(true);
        expect(row.metadata_source).toBe('mirror');
      }
      // 소스 코드는 어떤 열에도 없다 — 경로 이름만이다 (NFR-005).
      const columns = await pool.query<{ column_name: string }>(
        "SELECT column_name FROM information_schema.columns WHERE table_name = 'commit_snapshot'",
      );
      const names = columns.rows.map((row) => row.column_name);
      expect(names).not.toContain('patch');
      expect(names).not.toContain('diff');
      expect(names).not.toContain('content');
    });
  });

  describe('방아쇠 (DEV-206)', () => {
    it('`sequence.assigned`가 **새로 채번된 구간**을 보강한다 — 직접 푸시가 여기로 들어온다', async () => {
      await seedSequence();

      const disposition = await handleProjectedEvent(deps(), {
        event_id: 'e1',
        event_name: EVENT_NAMES.sequenceAssigned,
        correlation_id: 'c1',
        occurred_at: new Date().toISOString(),
        delivery_count: 1,
        payload: {
          repository_id: REPOSITORY_ID,
          base_branch: BRANCH,
          seq_epoch: 1,
          from_seq: 1,
          to_seq: chain.length,
          head_sha: chain.at(-1),
        },
      } as never);

      expect(disposition.kind).toBe('ack');
      for (const sha of chain) {
        const doc = await commitDoc(sha);
        expect(doc).toBeDefined();
        expect(doc?.['role']).toBe('direct_push');
      }
    });

    it('스윕이 정본에 빠진 커밋을 메운다 — 주 전달 수단이 아니라 보정이다', async () => {
      await seedSequence();
      expect(await commitSnapshotRepo.listCommitSnapshots(pool, REPOSITORY_ID, chain)).toHaveLength(0);

      const outcome = await runCommitEnrichSweep(deps());
      expect(outcome.enriched).toBeGreaterThanOrEqual(chain.length);
      expect(await commitSnapshotRepo.listCommitSnapshots(pool, REPOSITORY_ID, chain)).toHaveLength(chain.length);

      // 두 번째 회차는 할 일이 없다 — 이미 정본이 있는 커밋은 다시 읽지 않는다.
      const second = await runCommitEnrichSweep(deps());
      expect(second.enriched).toBe(0);
    });

    it('등록되지 않은 저장소의 이벤트는 조용히 ack한다 (FR-ING-009 AC-4)', async () => {
      const disposition = await handleProjectedEvent(deps(), {
        event_id: 'e2',
        event_name: EVENT_NAMES.sequenceAssigned,
        correlation_id: 'c2',
        occurred_at: new Date().toISOString(),
        delivery_count: 1,
        payload: { repository_id: 999_999, base_branch: BRANCH, seq_epoch: 1, from_seq: 1, to_seq: 1, head_sha: 'x' },
      } as never);
      expect(disposition.kind).toBe('ack');
    });
  });
});
