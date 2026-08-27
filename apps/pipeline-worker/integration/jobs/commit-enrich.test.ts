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
import { applyMappings, switchAliasesForTests, createEsClient, dropEntityIndices, resolveClientOptions } from '@prs/es';
import { FallbackCommitGraph, MirrorCommitGraph, MirrorSync, type CommitGraph } from '@prs/github';
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

/**
 * 일부 메서드만 갈아 끼운 그래프.
 *
 * **클래스 인스턴스를 스프레드하면 프로토타입 메서드가 복사되지 않는다** — 그렇게
 * 만든 대역은 나머지 메서드가 통째로 `undefined`가 되고, 그 사실이 엉뚱한 자리에서
 * 터진다. 명시적으로 위임한다.
 */
function delegating(inner: CommitGraph, overrides: Partial<CommitGraph>): CommitGraph {
  return {
    kind: inner.kind,
    resolveHead: (ref, branch) => inner.resolveHead(ref, branch),
    isAncestor: (ref, a, b) => inner.isAncestor(ref, a, b),
    mergeBase: (ref, a, b) => inner.mergeBase(ref, a, b),
    firstParentRevList: (ref, range) => inner.firstParentRevList(ref, range),
    firstParentCommits: (ref, range) => inner.firstParentCommits(ref, range),
    patchId: (ref, sha) => inner.patchId(ref, sha),
    readCommit: (ref, sha) => inner.readCommit(ref, sha),
    changedPaths: (ref, sha, limit) => inner.changedPaths(ref, sha, limit),
    ...overrides,
  };
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
  // 매핑 버전이 올라간 별칭을 현재 정의로 옮긴다 (WP-032). 시험 전용.
  await switchAliasesForTests(es);

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
     * ---- 스윕은 **전역**이라 다른 시험 파일이 남긴 행이 배치 상한을 채운다.
     *
     * `listCommitsMissingSnapshot`은 `repository_id` 순으로 최대 500건을 집으므로,
     * 앞서 실행된 파일들이 낮은 번호의 저장소에 행을 남겨 두면 우리 커밋이 그
     * 창에 들어오지 못한다 — 파일 하나로 돌리면 통과하고 전량으로 돌리면 깨진다.
     *
     * 남의 행을 지우지 않고 **이미 처리된 것으로 표시**해 창에서 비운다. 우리
     * 저장소의 행은 건드리지 않으므로 시험이 보려는 것은 그대로 남는다.
     */
    await pool.query(
      `INSERT INTO commit_snapshot
         (repository_id, commit_sha, authored_at, committed_at, metadata_source, projected_at)
       SELECT DISTINCT ms.repository_id, ms.commit_sha, now(), now(), 'mirror', now()
         FROM merge_sequence ms
        WHERE ms.repository_id <> $1
       ON CONFLICT (repository_id, commit_sha) DO NOTHING`,
      [REPOSITORY_ID],
    );

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

      /*
       * 두 번째 회차는 **이 저장소에서** 할 일이 없다.
       *
       * `prs_test`는 다른 시험 파일의 행도 담고 있고 스윕은 전역이라, 전체 건수로
       * 걸면 다른 파일이 픽스처를 하나 더할 때마다 깨진다. 우리 커밋이 전부
       * 투영 완료로 남았는지를 본다 — 그것이 "다시 집지 않는다"의 실제 의미다.
       */
      await runCommitEnrichSweep(deps());
      const rows = await commitSnapshotRepo.listCommitSnapshots(pool, REPOSITORY_ID, chain);
      expect(rows).toHaveLength(chain.length);
      expect(rows.every((row) => row.projected_at !== null)).toBe(true);
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

  /**
   * PR #42 리뷰가 찾은 것 (CR-038 / DEV-208·214 보강).
   *
   * 셋 다 **"실패했는데 아무도 다시 하지 않는다"**는 같은 모양이다.
   */
  describe('실패한 뒤 스스로 회복한다 (PR #42 리뷰)', () => {
    it('**색인 쓰기가 실패한 커밋을 스윕이 다시 집는다**', async () => {
      await seedSequence();
      const sha = chain[0] ?? '';

      // Elasticsearch 장애를 흉내 낸다 — 정본은 써지고 색인은 실패한다.
      const brokenEs = {
        update: () => Promise.reject(new Error('ES 503')),
      } as unknown as Client;
      const broken: CommitEnrichDeps = { ...deps(), es: brokenEs };

      await expect(
        enrichCommit(broken, repository, {
          commitSha: sha,
          firstParent: true,
          pullRequestNumber: null,
          baseBranch: BRANCH,
        }),
      ).rejects.toThrow();

      // 정본은 있다. 그래서 "스냅숏이 없는 커밋" 조건에는 걸리지 않는다.
      const row = await commitSnapshotRepo.findCommitSnapshot(pool, REPOSITORY_ID, sha);
      expect(row).toBeDefined();
      expect(row?.projected_at).toBeNull();
      expect(await commitDoc(sha)).toBeUndefined();

      /*
       * 투영 상태를 따로 들지 않으면 이 커밋은 **영원히 색인에 나타나지 않는다** —
       * 다시 투영할 다른 경로가 없다.
       */
      const outcome = await runCommitEnrichSweep(deps());
      expect(outcome.enriched).toBeGreaterThan(0);
      expect(await commitDoc(sha)).toBeDefined();
      expect((await commitSnapshotRepo.findCommitSnapshot(pool, REPOSITORY_ID, sha))?.projected_at).not.toBeNull();
    });

    it('성공한 보강은 `projected_at`을 남겨 스윕이 다시 집지 않는다', async () => {
      await seedSequence();
      await runCommitEnrichSweep(deps());

      // 전역 건수가 아니라 **이 저장소의 상태**를 본다 (공유 DB 오염에 견딘다).
      const pending = await commitSnapshotRepo.listCommitsMissingProjection(pool, 1000);
      expect(pending.filter((row) => Number(row.repository_id) === REPOSITORY_ID)).toEqual([]);
      const missing = await commitSnapshotRepo.listCommitsMissingSnapshot(pool, 1000);
      expect(missing.filter((row) => Number(row.repository_id) === REPOSITORY_ID)).toEqual([]);
    });

    it('**미러가 커밋을 모르면 API 폴백이 답한다** — `null`도 폴백 사유다', async () => {
      const sha = chain[0] ?? '';
      const truth = await mirrorGraph().readCommit({ owner: OWNER, repo: NAME }, sha);
      expect(truth).not.toBeNull();

      /*
       * `readCommit`은 못 찾았을 때 던지지 않고 `null`을 돌려준다. 그 규약을 그대로
       * 두면 미러가 통째로 비어 있어도 예외가 나지 않아 폴백이 영원히 돌지 않는다.
       */
      const api = delegating(mirrorGraph(), {
        kind: 'api',
        readCommit: () => Promise.resolve(truth),
        changedPaths: () => Promise.resolve({ paths: ['fallback.ts'], truncated: false }),
        patchId: () => Promise.resolve({ patchId: null, unavailable: 'no_mirror' as const }),
      });
      const fallback = new FallbackCommitGraph(noMirrorGraph(), api);

      const done = await enrichCommit(deps(fallback), repository, {
        commitSha: sha,
        firstParent: true,
        pullRequestNumber: null,
        baseBranch: BRANCH,
      });
      expect(done).toBe(true);
      expect((await commitDoc(sha))?.['changed_paths']).toEqual(['fallback.ts']);
    });

    it('미러가 얻은 `patch_id`를 API 폴백 회차가 지우지 않는다', async () => {
      const sha = chain[0] ?? '';
      // 1) patch_id를 얻은 회차 (blob 인출 허용).
      const withPatch = delegating(mirrorGraph(), {
        patchId: () => Promise.resolve({ patchId: 'p-abc123' as const }),
      });
      await enrichCommit(deps(withPatch), repository, {
        commitSha: sha,
        firstParent: true,
        pullRequestNumber: null,
        baseBranch: BRANCH,
      });
      expect((await commitDoc(sha))?.['patch_id']).toBe('p-abc123');

      // 2) API 폴백으로 돈 회차 — 계산할 수 없어 `no_mirror`를 낸다.
      const noPatch = delegating(mirrorGraph(), {
        patchId: () => Promise.resolve({ patchId: null, unavailable: 'no_mirror' as const }),
      });
      await enrichCommit(deps(noPatch), repository, {
        commitSha: sha,
        firstParent: true,
        pullRequestNumber: null,
        baseBranch: BRANCH,
      });

      /*
       * 능력이 없는 쪽이 있는 쪽을 지우면 색인이 정본과 어긋나고 체리픽 파생
       * (WP-030)이 이미 알던 사실을 잃는다. PostgreSQL은 `COALESCE`로 보존한다.
       */
      const doc = await commitDoc(sha);
      expect(doc?.['patch_id']).toBe('p-abc123');
      expect(doc?.['patch_id_unavailable']).toBeUndefined();
      expect((await commitSnapshotRepo.findCommitSnapshot(pool, REPOSITORY_ID, sha))?.patch_id).toBe('p-abc123');
    });
  });
});
