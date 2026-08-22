/**
 * JOB-ING-004 저장소 백필 (WP-019, FR-ING-006).
 *
 * **실제 PostgreSQL과 실제 Elasticsearch를 쓴다.** 이 WP가 증명해야 할 것
 * 대부분이 저장소의 동작 그 자체다:
 *
 * - 동시 실행 상한(AC-6)은 **한 트랜잭션 안의 count + `FOR UPDATE SKIP LOCKED`**가
 *   강제한다. 목으로 바꾸면 검증하려던 것을 건너뛴다
 * - "백필이 실시간을 덮어쓰지 않는다"(AC-5)는 **조건부 업서트 스크립트**가
 *   강제한다. 그것도 클러스터 안에 있다
 *
 * GHE만 목이다 — 그쪽은 계약이지 동작이 아니다.
 *
 * 검증: `pnpm test:integration jobs/backfill`
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Client } from '@elastic/elasticsearch';
import { jobRepo, repositoryRepo, type Pool, type RepositoryRow } from '@prs/db';
import { applyMappings, createEsClient, dropEntityIndices, resolveClientOptions } from '@prs/es';
import { runBackfillJob, type BackfillDeps } from '../../src/backfill.js';
import { backfillDeliveryId } from '../../src/backfill-plan.js';
import { migratedPool } from '../helpers.js';

const REPOSITORY_ID = 4021;
const TARGET = 'acme/payments';

let pool: Pool;
let es: Client;
let repository: RepositoryRow;

/** GHE 목. 페이지와 실패를 시험이 통제한다. */
interface FakePr {
  readonly number: number;
  readonly updated_at: string;
}

function prSummary(pr: FakePr): Record<string, unknown> {
  return {
    number: pr.number,
    title: `PR ${String(pr.number)}`,
    body: null,
    state: 'closed',
    draft: false,
    labels: [],
    merged: true,
    created_at: '2026-08-01T00:00:00Z',
    updated_at: pr.updated_at,
    closed_at: pr.updated_at,
    merged_at: pr.updated_at,
    merge_commit_sha: `${String(pr.number).padStart(40, 'a')}`,
    user: { login: 'kim' },
    head: { ref: 'feat', sha: 'b'.repeat(40) },
    base: { ref: 'main', sha: 'c'.repeat(40) },
  };
}

interface FakeClientOptions {
  readonly pages: readonly (readonly FakePr[])[];
  readonly onPage?: (page: number) => void;
  readonly failListAt?: number;
  readonly failWith?: unknown;
}

function fakeClient(options: FakeClientOptions): BackfillDeps['client'] {
  let listCalls = 0;
  return {
    async listPullRequestsPage(_ref: unknown, page: number) {
      listCalls += 1;
      options.onPage?.(page);
      if (options.failListAt === listCalls) throw options.failWith;
      const items = options.pages[page - 1] ?? [];
      return { items: items.map(prSummary), hasMore: page < options.pages.length };
    },
    async listPullRequestCommitsPaged() {
      return { items: [{ sha: 'd'.repeat(40) }], truncated: false, maxItems: 250 };
    },
    async listPullRequestFilesPaged() {
      return { items: [{ filename: 'a.ts', additions: 1, deletions: 0, status: 'modified' }], truncated: false, maxItems: 3000 };
    },
    async listPullRequestReviews() {
      return [];
    },
  } as unknown as BackfillDeps['client'];
}

function deps(client: BackfillDeps['client'], extra: Partial<BackfillDeps> = {}): BackfillDeps {
  return {
    pool,
    es,
    client,
    log: () => undefined,
    sleep: async () => undefined,
    ...extra,
  };
}

async function waitForCluster(): Promise<void> {
  await es.cluster.health({ wait_for_status: 'yellow', timeout: '60s' });
}

beforeAll(async () => {
  pool = await migratedPool();
  es = createEsClient(resolveClientOptions());
  await waitForCluster();
  await dropEntityIndices(es);
  await applyMappings(es);
}, 120_000);

afterAll(async () => {
  await es.close();
  await pool.end();
});

beforeEach(async () => {
  await pool.query('TRUNCATE job');
  await pool.query('TRUNCATE repository CASCADE');
  await es.deleteByQuery({
    index: ['prs-pull-requests', 'prs-commits'],
    query: { match_all: {} },
    refresh: true,
    conflicts: 'proceed',
  });
  await repositoryRepo.upsertRepository(pool, {
    repository_id: REPOSITORY_ID,
    owner: 'acme',
    name: 'payments',
    org_id: 77,
    visibility: 'internal',
    sequence_branches: ['main'],
  });
  const found = await repositoryRepo.findRepositoryById(pool, REPOSITORY_ID);
  if (found === undefined) throw new Error('저장소 seed 실패');
  repository = found;
});

async function enqueue(target = TARGET): Promise<number> {
  return jobRepo.enqueueJob(pool, 'backfill', target, 'alice');
}

describe('QA-A003-06 / AC-4: 중단 후 재개', () => {
  it('**멈춘 지점의 커서가 남고 재개가 그것을 이어받는다**', async () => {
    const jobId = await enqueue();
    const claimed = await jobRepo.claimNextJob(pool, 'backfill');
    expect(claimed?.job_id).toBe(jobId);

    /*
     * 1페이지를 읽는 동안 운영자가 멈춘다. 루프는 **페이지 사이에서만**
     * 멈추므로 1페이지는 온전히 처리되고, 2페이지는 시작하지 않아야 한다.
     */
    const seen: number[] = [];
    // 1페이지를 내주면서 곧바로 중단을 건다 (운영자의 PATCH와 같은 효과).
    const pausing = fakeClient({
      pages: [
        [
          { number: 1, updated_at: '2026-08-01T00:00:00Z' },
          { number: 2, updated_at: '2026-08-02T00:00:00Z' },
        ],
        [{ number: 3, updated_at: '2026-08-03T00:00:00Z' }],
      ],
      onPage: (page) => {
        seen.push(page);
        if (page === 1) void jobRepo.transitionJob(pool, jobId, 'pause');
      },
    });

    const result = await runBackfillJob(deps(pausing), claimed!, repository);
    expect(result.outcome).toBe('stopped');
    // 2페이지를 시작하지 않았다.
    expect(seen).toEqual([1]);

    const row = await jobRepo.findJobById(pool, jobId);
    expect(row?.state).toBe('paused');
    // 커서가 2페이지를 가리켜야 재개가 3번 PR을 처리한다.
    expect(row?.cursor).toMatchObject({ page: 2, done: 2 });
  });

  it('**재개하면 커서가 가리키는 페이지부터 읽는다** (QA-A003-06)', async () => {
    const jobId = await enqueue();
    // 앞선 실행이 2페이지까지 처리하고 멈춘 상태를 만든다.
    await jobRepo.updateJobProgress(pool, jobId, { done: 200, total: null, unit: 'pull_request' }, { page: 3, done: 200 });
    const claimed = await jobRepo.claimNextJob(pool, 'backfill');

    const seen: number[] = [];
    const client = fakeClient({
      pages: [[], [], [{ number: 300, updated_at: '2026-08-19T05:02:11Z' }]],
      onPage: (page) => seen.push(page),
    });
    const result = await runBackfillJob(deps(client), claimed!, repository);

    // 1·2페이지를 다시 읽지 않는다 — 이미 처리한 것이다.
    expect(seen).toEqual([3]);
    expect(result.outcome).toBe('completed');
    // `done`이 이어진다 — 0으로 되돌아가지 않는다.
    expect(result.processed).toBe(201);
  });

  it('망가진 커서는 처음부터 시작한다 — 중간을 추측하지 않는다', async () => {
    const jobId = await enqueue();
    await jobRepo.updateJobProgress(pool, jobId, {}, { page: 'nope' } as unknown as Record<string, unknown>);
    const claimed = await jobRepo.claimNextJob(pool, 'backfill');

    const seen: number[] = [];
    const client = fakeClient({
      pages: [[{ number: 1, updated_at: '2026-08-01T00:00:00Z' }]],
      onPage: (page) => seen.push(page),
    });
    await runBackfillJob(deps(client), claimed!, repository);

    // 추측한 지점에서 시작하면 그 사이 PR이 영영 색인되지 않는다.
    expect(seen[0]).toBe(1);
  });
});

describe('AC-5: 백필이 실시간을 덮어쓰지 않는다', () => {
  it('**더 새로운 실시간 문서를 백필이 이기지 못한다**', async () => {
    const prNumber = 1234;
    const updatedAt = '2026-08-19T05:02:11Z';
    // 실시간이 먼저 색인했다 — 웹훅 수신 시각은 갱신 시각보다 뒤다.
    const realtimeVersion = Date.parse(updatedAt) + 5_000;
    await es.index({
      index: 'prs-pull-requests',
      id: `${String(REPOSITORY_ID)}:${String(prNumber)}`,
      document: {
        repository_id: REPOSITORY_ID,
        repository: TARGET,
        org_id: 77,
        visibility: 'internal',
        pr_number: prNumber,
        title: '실시간이 쓴 제목',
        document_version: realtimeVersion,
      },
      refresh: true,
    });

    const jobId = await enqueue();
    const claimed = await jobRepo.claimNextJob(pool, 'backfill');
    const client = fakeClient({ pages: [[{ number: prNumber, updated_at: updatedAt }]] });
    await runBackfillJob(deps(client), claimed!, repository);
    await es.indices.refresh({ index: 'prs-pull-requests' });

    const doc = await es.get<{ title: string; document_version: number }>({
      index: 'prs-pull-requests',
      id: `${String(REPOSITORY_ID)}:${String(prNumber)}`,
    });
    /*
     * 백필의 버전은 `updated_at`이라 실시간보다 작다. 조건부 업서트가
     * 저절로 거절한다 — **AC-5가 분기가 아니라 수의 대소로 성립한다.**
     */
    expect(doc._source?.title).toBe('실시간이 쓴 제목');
    expect(doc._source?.document_version).toBe(realtimeVersion);
    void jobId;
  });

  it('실시간이 없으면 백필이 색인한다 — 그것이 백필의 목적이다', async () => {
    const jobId = await enqueue();
    const claimed = await jobRepo.claimNextJob(pool, 'backfill');
    const client = fakeClient({ pages: [[{ number: 77, updated_at: '2026-08-19T05:02:11Z' }]] });
    const result = await runBackfillJob(deps(client), claimed!, repository);
    await es.indices.refresh({ index: 'prs-pull-requests' });

    expect(result.outcome).toBe('completed');
    const doc = await es.get<{ pr_number: number; last_delivery_id: string }>({
      index: 'prs-pull-requests',
      id: `${String(REPOSITORY_ID)}:77`,
    });
    expect(doc._source?.pr_number).toBe(77);
    // 합성 델리버리 ID가 문서에 남아 출처를 밝힌다 (DEV-100).
    expect(doc._source?.last_delivery_id).toBe(backfillDeliveryId(REPOSITORY_ID, 77));
    void jobId;
  });
});

describe('AC-6: 동시 실행 상한', () => {
  it('**넷을 넣어도 셋만 돈다**', async () => {
    for (const target of ['acme/a', 'acme/b', 'acme/c', 'acme/d']) {
      await jobRepo.enqueueJob(pool, 'backfill', target, 'alice');
    }

    const claimed = [];
    for (let i = 0; i < 4; i += 1) {
      claimed.push(await jobRepo.claimNextJob(pool, 'backfill', 3));
    }

    expect(claimed.filter((one) => one !== undefined)).toHaveLength(3);
    expect(claimed[3]).toBeUndefined();

    const running = await pool.query<{ count: string }>(
      `SELECT count(*) AS count FROM job WHERE state = 'running'`,
    );
    expect(Number(running.rows[0]?.count)).toBe(3);
  });

  it('**동시에 잡아도 상한을 넘지 않는다** — 세는 것과 잡는 것이 한 트랜잭션이다', async () => {
    for (const target of ['acme/a', 'acme/b', 'acme/c', 'acme/d', 'acme/e']) {
      await jobRepo.enqueueJob(pool, 'backfill', target, 'alice');
    }

    /*
     * 나뉘어 있으면 다섯이 동시에 `running=0`을 읽고 모두 시작한다.
     * `FOR UPDATE SKIP LOCKED` + 같은 트랜잭션의 count가 그것을 막는다.
     */
    const results = await Promise.all(
      Array.from({ length: 5 }, () => jobRepo.claimNextJob(pool, 'backfill', 3)),
    );

    expect(results.filter((one) => one !== undefined)).toHaveLength(3);
  });

  it('하나가 끝나면 다음이 들어온다', async () => {
    for (const target of ['acme/a', 'acme/b', 'acme/c', 'acme/d']) {
      await jobRepo.enqueueJob(pool, 'backfill', target, 'alice');
    }
    const first = await jobRepo.claimNextJob(pool, 'backfill', 3);
    await jobRepo.claimNextJob(pool, 'backfill', 3);
    await jobRepo.claimNextJob(pool, 'backfill', 3);
    expect(await jobRepo.claimNextJob(pool, 'backfill', 3)).toBeUndefined();

    await jobRepo.finishJob(pool, first!.job_id, 'completed');
    expect(await jobRepo.claimNextJob(pool, 'backfill', 3)).toBeDefined();
  });
});

describe('예외 처리: API 한도', () => {
  it('**한도를 만나면 기다리고 잡을 실패시키지 않는다** (DEV-104)', async () => {
    const jobId = await enqueue();
    const claimed = await jobRepo.claimNextJob(pool, 'backfill');
    const retryAt = new Date(Date.now() + 30_000);

    let slept = 0;
    const client = fakeClient({
      pages: [[{ number: 5, updated_at: '2026-08-19T05:02:11Z' }]],
      failListAt: 1,
      failWith: Object.assign(new Error('한도'), { kind: 'rate_limited', retryAt }),
    });

    const result = await runBackfillJob(
      deps(client, {
        sleep: async (ms) => {
          slept = ms;
        },
      }),
      claimed!,
      repository,
    );

    // 기다린 뒤 이어서 끝냈다 — 실패가 아니다.
    expect(result.outcome).toBe('completed');
    expect(slept).toBeGreaterThan(0);

    const row = await jobRepo.findJobById(pool, jobId);
    /*
     * 상태는 `running`을 거쳐 `completed`가 됐고, **`paused`로 간 적이 없다** —
     * `paused`는 운영자 의도만 뜻해야 자동 재개가 중단을 되살리지 않는다.
     */
    expect(row?.state).toBe('completed');
  });

  it('한도가 아닌 오류는 잡을 실패시킨다 — 영원히 기다리지 않는다', async () => {
    const jobId = await enqueue();
    const claimed = await jobRepo.claimNextJob(pool, 'backfill');
    const client = fakeClient({
      pages: [[]],
      failListAt: 1,
      failWith: Object.assign(new Error('부서짐'), { kind: 'server_error' }),
    });

    const result = await runBackfillJob(deps(client), claimed!, repository);
    expect(result.outcome).toBe('failed');

    const row = await jobRepo.findJobById(pool, jobId);
    expect(row?.state).toBe('failed');
    expect(row?.error).toContain('부서짐');
  });
});

describe('개별 PR 실패가 잡을 중단시키지 않는다', () => {
  it('**갱신 시각을 읽을 수 없는 PR만 건너뛴다**', async () => {
    const jobId = await enqueue();
    const claimed = await jobRepo.claimNextJob(pool, 'backfill');
    const client = fakeClient({
      pages: [[
        { number: 10, updated_at: '2026-08-19T05:02:11Z' },
        { number: 11, updated_at: 'not-a-date' },
        { number: 12, updated_at: '2026-08-20T05:02:11Z' },
      ]],
    });

    const result = await runBackfillJob(deps(client), claimed!, repository);
    await es.indices.refresh({ index: 'prs-pull-requests' });

    // 하나가 틀려도 잡은 완료다 — 나머지를 버리지 않는다.
    expect(result.outcome).toBe('completed');
    expect(result.failed).toEqual([11]);

    const found = await es.count({ index: 'prs-pull-requests', query: { term: { repository_id: REPOSITORY_ID } } });
    expect(found.count).toBe(2);
    void jobId;
  });
});

describe('색인 설정 (DEV-105)', () => {
  it('**시작할 때 되돌린 뒤 올리고, 끝나면 되돌린다**', async () => {
    const calls: string[] = [];
    const jobId = await enqueue();
    const claimed = await jobRepo.claimNextJob(pool, 'backfill');
    const client = fakeClient({ pages: [[]] });

    await runBackfillJob(
      deps(client, {
        indexTuning: {
          relax: async () => {
            calls.push('relax');
          },
          restore: async () => {
            calls.push('restore');
          },
        },
      }),
      claimed!,
      repository,
    );

    /*
     * 앞선 잡이 죽어 `30s`를 남겼을 수 있다. 시작할 때 무조건 되돌리므로
     * 인덱스가 영구히 느린 상태로 남지 않는다.
     */
    expect(calls).toEqual(['restore', 'relax', 'restore']);
    void jobId;
  });

  it('설정 실패가 잡을 멈추지 않는다 — 색인은 느려질 뿐 계속된다', async () => {
    const jobId = await enqueue();
    const claimed = await jobRepo.claimNextJob(pool, 'backfill');
    const client = fakeClient({ pages: [[{ number: 21, updated_at: '2026-08-19T05:02:11Z' }]] });

    const result = await runBackfillJob(
      deps(client, {
        indexTuning: {
          relax: async () => {
            throw new Error('설정 거부');
          },
          restore: async () => {
            throw new Error('설정 거부');
          },
        },
      }),
      claimed!,
      repository,
    );

    expect(result.outcome).toBe('completed');
    void jobId;
  });
});
