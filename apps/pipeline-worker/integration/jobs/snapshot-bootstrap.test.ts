/**
 * JOB-ING-009 정본 스냅숏 부트스트랩 (CR-037, DEV-194·195 / ADR-004).
 *
 * ## 이 파일이 재현하는 것 — 업그레이드 픽스처
 *
 * 마이그레이션 010 **이전부터 운영되던 상태**를 그대로 만든다:
 *
 * 1. Elasticsearch에는 PR 문서가 이미 있다
 * 2. `pull_request_snapshot`은 비어 있다
 * 3. 정합성 감시를 돌리면 — 그것을 **색인 손상으로 확정하지 않는다**
 * 4. GHE 목으로 부트스트랩을 돌린다
 * 5. 스냅숏이 생긴다 (색인은 건드리지 않는다)
 * 6. 정합성 감시를 다시 돌리면 일치한다
 *
 * **실제 PostgreSQL을 쓴다.** 이 정정이 지켜야 할 것 대부분이 저장소의 동작
 * 그 자체다 — 조건부 업서트의 멱등, 커서 재개, `snapshot_bootstrapped_at`의
 * 의미. GHE만 목이다(계약이지 동작이 아니다).
 *
 * 실제 GHE에 붙는 smoke는 **NOT RUN**이다 — 사내망 자격 증명이 없다.
 *
 * 검증: `pnpm test:integration jobs/snapshot-bootstrap`
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { jobRepo, prSnapshotRepo, repositoryRepo, type Pool, type RepositoryRow } from '@prs/db';
import { runBackfillJob, type BackfillDeps } from '../../src/backfill.js';
import {
  BOOTSTRAP_ENQUEUE_BATCH,
  completeSnapshotBootstrap,
  enqueueSnapshotBootstrap,
  SNAPSHOT_BOOTSTRAP_TYPE,
} from '../../src/snapshot-bootstrap.js';
import {
  checkRepositoryConsistency,
  repositoryScopeState,
  type ConsistencyDeps,
} from '../../src/consistency.js';
import { migratedPool } from '../helpers.js';

const REPOSITORY_ID = 4501;
const OWNER = 'acme';
const NAME = 'bootstrap-cr037';
const TARGET = `${OWNER}/${NAME}`;

let pool: Pool;
let repository: RepositoryRow;

/** 색인에 이미 있는 PR. 업그레이드 이전에 투영된 것들이다. */
const INDEXED = [11, 12, 13];

function prSummary(number: number): Record<string, unknown> {
  return {
    number,
    title: `PR ${String(number)}`,
    body: null,
    state: 'closed',
    draft: false,
    labels: [],
    merged: true,
    created_at: '2026-08-01T00:00:00Z',
    updated_at: '2026-08-02T00:00:00Z',
    closed_at: '2026-08-02T00:00:00Z',
    merged_at: '2026-08-02T00:00:00Z',
    merge_commit_sha: String(number).padStart(40, 'a'),
    user: { login: 'kim' },
    head: { ref: 'feat', sha: 'b'.repeat(40) },
    base: { ref: 'main', sha: 'c'.repeat(40) },
  };
}

/** GHE 목. 페이지를 시험이 통제한다. */
function fakeClient(pages: readonly (readonly number[])[], onPage?: (page: number) => void): BackfillDeps['client'] {
  return {
    listPullRequestsPage: (_ref: unknown, page: number) => {
      onPage?.(page);
      const items = pages[page - 1] ?? [];
      return Promise.resolve({ items: items.map(prSummary), hasMore: page < pages.length });
    },
    listPullRequestCommitsPaged: () =>
      Promise.resolve({ items: [{ sha: 'd'.repeat(40) }], truncated: false, maxItems: 250 }),
    listPullRequestFilesPaged: () =>
      Promise.resolve({
        items: [{ filename: 'a.ts', additions: 1, deletions: 0, status: 'modified' }],
        truncated: false,
        maxItems: 3000,
      }),
    listPullRequestReviews: () => Promise.resolve([]),
  } as unknown as BackfillDeps['client'];
}

/** 색인에 쓰면 시험이 실패하는 ES 대역. 부트스트랩은 색인을 건드리지 않는다. */
function forbiddenEs(): { readonly es: BackfillDeps['es']; readonly writes: string[] } {
  const writes: string[] = [];
  const es = {
    bulk: () => {
      writes.push('bulk');
      return Promise.resolve({ items: [], errors: false });
    },
    index: () => {
      writes.push('index');
      return Promise.resolve({});
    },
  } as unknown as BackfillDeps['es'];
  return { es, writes };
}

/**
 * 정합성 감시용 ES 대역.
 *
 * **문서를 실제 투영 결과와 같은 모양으로 준다.** 번호만 담은 대역을 쓰면 지문이
 * 언제나 어긋나 "일치"라는 결과를 아예 만들 수 없다 — 대역이 실제와 다르면
 * 그만큼이 사각지대이고, 여기서는 시험이 증명하려는 것 자체를 없앤다.
 */
function consistencyDeps(documents: readonly Record<string, unknown>[]): ConsistencyDeps {
  return {
    pool,
    es: {
      search: () =>
        Promise.resolve({
          hits: {
            total: { value: documents.length, relation: 'eq' },
            hits: documents.map((doc) => ({ _source: doc })),
          },
        }),
    } as unknown as ConsistencyDeps['es'],
    metrics: {
      projectionConsistencyMismatch: { inc: (): void => undefined },
    } as unknown as ConsistencyDeps['metrics'],
  };
}

async function snapshotNumbers(): Promise<readonly number[]> {
  const rows = await prSnapshotRepo.listSnapshots(pool, REPOSITORY_ID, 100);
  return rows.map((row) => row.pr_number).sort((a, b) => a - b);
}

async function reload(): Promise<RepositoryRow> {
  const row = await repositoryRepo.findRepositoryById(pool, REPOSITORY_ID);
  if (row === undefined) throw new Error('저장소가 사라졌다');
  return row;
}

describe('정본 스냅숏 부트스트랩 (CR-037, DEV-194·195)', () => {
  beforeAll(async () => {
    pool = await migratedPool();
  }, 180_000);

  afterAll(async () => {
    await pool?.end();
  });

  beforeEach(async () => {
    await pool.query('DELETE FROM pull_request_snapshot WHERE repository_id = $1', [REPOSITORY_ID]);
    await pool.query('DELETE FROM job');
    await pool.query('DELETE FROM repository WHERE repository_id = $1', [REPOSITORY_ID]);
    await repositoryRepo.upsertRepository(pool, {
      repository_id: REPOSITORY_ID,
      owner: OWNER,
      name: NAME,
      org_id: 1,
      visibility: 'private',
      sequence_branches: ['main'],
      status: 'active',
    });
    repository = await reload();
  });

  it('업그레이드 직후에는 부트스트랩이 끝나지 않은 상태다', async () => {
    expect(repository.snapshot_bootstrapped_at).toBeNull();
    expect(await snapshotNumbers()).toEqual([]);
  });

  it('**색인에만 있는 문서를 색인 손상으로 확정하지 않는다** (DEV-195)', async () => {
    const reports = await checkRepositoryConsistency(
      consistencyDeps(INDEXED.map((n) => ({ pr_number: n }))),
      repository,
    );
    expect(reports.map((report) => report.kind)).toEqual(['snapshot_bootstrap_pending']);
    expect(reports[0]?.postgresCount).toBe(0);
    expect(reports[0]?.elasticsearchCount).toBe(INDEXED.length);
  });

  it('부트스트랩이 정본을 채우고 색인은 건드리지 않는다 (DEV-194)', async () => {
    const jobId = await jobRepo.enqueueJob(pool, SNAPSHOT_BOOTSTRAP_TYPE, TARGET, 'system');
    const job = await jobRepo.claimNextJob(pool, SNAPSHOT_BOOTSTRAP_TYPE);
    expect(job?.job_id).toBe(jobId);

    const { es, writes } = forbiddenEs();
    const result = await runBackfillJob(
      {
        pool,
        es,
        client: fakeClient([INDEXED]),
        log: () => undefined,
        sleep: () => Promise.resolve(),
        snapshotOnly: true,
        snapshotSource: 'backfill',
      },
      job!,
      repository,
    );

    expect(result.outcome).toBe('completed');
    expect(result.failed).toEqual([]);
    expect(await snapshotNumbers()).toEqual(INDEXED);
    // 색인은 이미 그 문서를 갖고 있다. 메우려는 공백은 PostgreSQL 쪽이다.
    expect(writes).toEqual([]);
  });

  it('부트스트랩 뒤 정합성 감시가 일치를 낸다', async () => {
    const jobId = await jobRepo.enqueueJob(pool, SNAPSHOT_BOOTSTRAP_TYPE, TARGET, 'system');
    const job = await jobRepo.claimNextJob(pool, SNAPSHOT_BOOTSTRAP_TYPE);
    const { es } = forbiddenEs();
    const result = await runBackfillJob(
      { pool, es, client: fakeClient([INDEXED]), log: () => undefined, sleep: () => Promise.resolve(), snapshotOnly: true },
      job!,
      repository,
    );
    await jobRepo.finishJob(pool, jobId, 'completed');

    const marked = await completeSnapshotBootstrap(pool, repository, result);
    expect(marked).toBe(true);

    const after = await reload();
    expect(after.snapshot_bootstrapped_at).not.toBeNull();

    /*
     * 색인이 정본과 같은 문서를 갖고 있는 상태다 — 부트스트랩이 성공했다면
     * 그것이 사실이어야 한다. 접근 범위는 레지스트리에서 합성한다(DEV-193).
     */
    const scope = repositoryScopeState(after);
    const snapshots = await prSnapshotRepo.listSnapshots(pool, REPOSITORY_ID, 100);
    const indexed = snapshots.map((row) => ({ ...row.document, ...scope }));

    const reports = await checkRepositoryConsistency(consistencyDeps(indexed), after);
    expect(reports).toEqual([]);
  });

  it('같은 PR을 다시 처리해도 결과가 같다 — 멱등이다 (§11)', async () => {
    for (let round = 0; round < 2; round += 1) {
      await pool.query('DELETE FROM job');
      await jobRepo.enqueueJob(pool, SNAPSHOT_BOOTSTRAP_TYPE, TARGET, 'system');
      const job = await jobRepo.claimNextJob(pool, SNAPSHOT_BOOTSTRAP_TYPE);
      const { es } = forbiddenEs();
      await runBackfillJob(
        { pool, es, client: fakeClient([INDEXED]), log: () => undefined, sleep: () => Promise.resolve(), snapshotOnly: true },
        job!,
        repository,
      );
    }
    expect(await snapshotNumbers()).toEqual(INDEXED);
  });

  it('버전은 GitHub 엔티티의 updated_at이다 — 지금 시각이 아니다 (§11)', async () => {
    await jobRepo.enqueueJob(pool, SNAPSHOT_BOOTSTRAP_TYPE, TARGET, 'system');
    const job = await jobRepo.claimNextJob(pool, SNAPSHOT_BOOTSTRAP_TYPE);
    const { es } = forbiddenEs();
    await runBackfillJob(
      { pool, es, client: fakeClient([[11]]), log: () => undefined, sleep: () => Promise.resolve(), snapshotOnly: true },
      job!,
      repository,
    );

    const rows = await prSnapshotRepo.listSnapshots(pool, REPOSITORY_ID, 10);
    /*
     * `2026-08-02T00:00:00Z`의 epoch ms다. 지금 시각을 쓰면 이 값보다 훨씬 크고,
     * **늦게 도착한 부트스트랩이 새 웹훅 상태를 덮는다.**
     */
    expect(Number(rows[0]?.document_version)).toBe(Date.parse('2026-08-02T00:00:00Z'));
  });

  it('중간에 멈춘 부트스트랩은 완료로 기록하지 않는다 — 다음 주기가 다시 집는다', async () => {
    const stopped = await completeSnapshotBootstrap(pool, repository, {
      jobId: 1,
      processed: 2,
      failed: [],
      outcome: 'stopped',
    });
    expect(stopped).toBe(false);
    expect((await reload()).snapshot_bootstrapped_at).toBeNull();

    const partial = await completeSnapshotBootstrap(pool, repository, {
      jobId: 1,
      processed: 3,
      failed: [12],
      outcome: 'completed',
    });
    expect(partial).toBe(false);
    expect((await reload()).snapshot_bootstrapped_at).toBeNull();
  });

  describe('예약', () => {
    /*
     * `prs_test`는 다른 시험 파일의 저장소를 함께 담고 있고 그것들도 대개
     * 부트스트랩 전이다. **절대 수가 아니라 이 저장소가 큐에 들어갔는지**를 본다 —
     * 절대 수로 걸면 다른 파일이 픽스처를 하나 더할 때마다 깨진다.
     */
    async function queuedForTarget(): Promise<boolean> {
      return (await jobRepo.findActiveJob(pool, SNAPSHOT_BOOTSTRAP_TYPE, TARGET)) !== undefined;
    }

    it('아직 부트스트랩되지 않은 저장소를 큐에 넣는다', async () => {
      const queued = await enqueueSnapshotBootstrap(pool, { limit: 100 });
      expect(queued).toBeGreaterThan(0);
      expect(await queuedForTarget()).toBe(true);
    });

    it('이미 큐에 있으면 두 번 넣지 않는다', async () => {
      await enqueueSnapshotBootstrap(pool, { limit: 100 });
      const before = await pool.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM job WHERE type = 'snapshot_bootstrap' AND target = $1",
        [TARGET],
      );
      await enqueueSnapshotBootstrap(pool, { limit: 100 });
      const after = await pool.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM job WHERE type = 'snapshot_bootstrap' AND target = $1",
        [TARGET],
      );
      expect(after.rows[0]?.count).toBe(before.rows[0]?.count);
      expect(Number(before.rows[0]?.count)).toBe(1);
    });

    it('끝난 저장소는 다시 넣지 않는다', async () => {
      await repositoryRepo.markSnapshotBootstrapped(pool, REPOSITORY_ID, new Date());
      await enqueueSnapshotBootstrap(pool, { limit: 100 });
      expect(await queuedForTarget()).toBe(false);
    });

    it('한 주기에 넣는 수에 상한이 있다 — 첫 배포가 GHE 한도를 태우지 않는다', async () => {
      const extra = BOOTSTRAP_ENQUEUE_BATCH + 3;
      for (let i = 0; i < extra; i += 1) {
        await repositoryRepo.upsertRepository(pool, {
          repository_id: REPOSITORY_ID + 100 + i,
          owner: OWNER,
          name: `${NAME}-bulk-${String(i)}`,
          org_id: 1,
          visibility: 'private',
          sequence_branches: ['main'],
          status: 'active',
        });
      }
      try {
        const queued = await enqueueSnapshotBootstrap(pool);
        expect(queued).toBeGreaterThan(0);
        expect(queued).toBeLessThanOrEqual(BOOTSTRAP_ENQUEUE_BATCH);
      } finally {
        await pool.query('DELETE FROM repository WHERE repository_id >= $1 AND repository_id < $2', [
          REPOSITORY_ID + 100,
          REPOSITORY_ID + 200,
        ]);
      }
    });
  });
});
