/**
 * API-ADM-002 잡 실행·중단·진행률 (WP-019 DoD, FR-ING-006·FR-ADMIN-002).
 *
 * 실제 PostgreSQL에 붙는다. 이 API가 지켜야 할 것 대부분이 **DB 제약**이다 —
 * 같은 대상에 활성 잡 하나(`job_active_uk`)와 상태 전이가 그렇다. 목으로
 * 바꾸면 검증하려던 것을 건너뛴다.
 *
 * 검증: `pnpm test:integration admin/jobs`
 */

import type { Client as EsClient } from '@elastic/elasticsearch';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { jobRepo, repositoryRepo, type Pool } from '@prs/db';
import { createEsClient, resolveClientOptions } from '@prs/es';
import { RedisStreamsEventBus, type Redis } from '@prs/bus';
import { buildServer } from '../../src/server.js';
import { JOBS_PATH } from '../../src/ops/routes.js';
import { createJob } from '../../src/ops/jobs.js';
import { createTestRedis, migratedPool } from '../helpers.js';
import { TEST_CURSOR_KEY } from '../_cursor-fixture.js';

const TEST_AUTH_CONFIG = {
  enabled: false,
  cookieSecure: false,
  loginPath: '/auth/login',
  groupRoleMap: new Map<string, never>(),
} as const;

const TOKEN = 'jobs-token';
const AUTH = { authorization: `Bearer ${TOKEN}` };
const REPOSITORY_ID = 4021;
const TARGET = 'acme/payments';

let pool: Pool;
let es: EsClient;
let redis: Redis;
let bus: RedisStreamsEventBus;
let app: FastifyInstance;

beforeAll(async () => {
  pool = await migratedPool();
  es = createEsClient(resolveClientOptions());
  redis = createTestRedis();
  bus = new RedisStreamsEventBus(redis);
  app = buildServer({
    config: {
      port: 0,
      adminTokens: [{ name: 'alice', token: TOKEN }],
      metricsQueryUrl: null,
      gheBaseUrl: null,
      auth: TEST_AUTH_CONFIG, searchCursorKey: TEST_CURSOR_KEY,
    },
    ops: { pool, bus },
    registry: { pool, es, lookup: async () => null },
  });
  await app.ready();
}, 90_000);

afterAll(async () => {
  /*
   * **남긴 상태를 지우고 끝낸다.** 이 파일은 `beforeEach`의 `TRUNCATE`에 기대는데
   * 그것은 파일 안에서만 성립한다 — 마지막 시험이 만든 `queued` 잡은 그대로
   * 남아 **다른 파일의 `claimNextJob`이 유형만 보고 집는다.** 실제로
   * `cancel-race.test.ts`가 자기 잡 대신 이 파일의 잔여를 집어 실패했다.
   */
  await pool.query('TRUNCATE repository, job, audit_record RESTART IDENTITY CASCADE');
  await app.close();
  await bus.close();
  redis.disconnect();
  await es.close();
  await pool.end();
});

beforeEach(async () => {
  await pool.query('TRUNCATE repository, job, audit_record RESTART IDENTITY CASCADE');
  await repositoryRepo.upsertRepository(pool, {
    repository_id: REPOSITORY_ID,
    owner: 'acme',
    name: 'payments',
    org_id: 77,
    visibility: 'internal',
    sequence_branches: ['main'],
  });
});

type Injected = Awaited<ReturnType<FastifyInstance['inject']>>;

const post = async (payload: Record<string, unknown>): Promise<Injected> =>
  app.inject({ method: 'POST', url: JOBS_PATH, headers: AUTH, payload });

const patch = async (jobId: number, payload: Record<string, unknown>): Promise<Injected> =>
  app.inject({ method: 'PATCH', url: `${JOBS_PATH}/${String(jobId)}`, headers: AUTH, payload });

describe('POST — 잡 실행', () => {
  it('백필을 큐에 넣는다', async () => {
    const response = await post({ type: 'backfill', target: TARGET });

    expect(response.statusCode).toBe(201);
    const body = response.json<{ job_id: number; state: string; target: string }>();
    expect(body.state).toBe('queued');
    expect(body.target).toBe(TARGET);
    expect(body.job_id).toBeGreaterThan(0);
  });

  it('**같은 대상에 둘째는 409다** — 부분 유니크 인덱스가 강제한다', async () => {
    await post({ type: 'backfill', target: TARGET });
    const second = await post({ type: 'backfill', target: TARGET });

    expect(second.statusCode).toBe(409);
    expect(second.json<{ error: { code: string } }>().error.code).toBe('JOB_CONFLICT');
  });

  it('끝난 잡이 있으면 새로 넣을 수 있다 — 활성 잡만 막는다', async () => {
    const first = await post({ type: 'backfill', target: TARGET });
    const jobId = first.json<{ job_id: number }>().job_id;
    await jobRepo.finishJob(pool, jobId, 'completed');

    expect((await post({ type: 'backfill', target: TARGET })).statusCode).toBe(201);
  });

  it('**등록되지 않은 저장소는 404다** — 유령 잡을 만들지 않는다', async () => {
    /*
     * 만들어 두면 워커가 잡을 때마다 실패하고, 운영자는 원인이 미등록임을
     * 알 수 없다.
     */
    const response = await post({ type: 'backfill', target: 'acme/nope' });

    expect(response.statusCode).toBe(404);
    const rows = await jobRepo.listJobs(pool);
    expect(rows).toHaveLength(0);
  });

  it('**`link_rebuild`를 큐에 넣을 수 있다** — JOB-REL-006의 유일한 시작 경로다 (CR-039)', async () => {
    /*
     * 이 경로가 `backfill`만 받던 동안 **운영자는 JOB-REL-006을 시작할 방법이
     * 아예 없었다** (PR #44 리뷰 P1). 그것은 PostgreSQL 정본에서 `prs-links`를
     * 복구하는 유일한 경로이므로, 과거 엔티티와 재구축한 인덱스가 간선을
     * 영원히 얻지 못한다는 뜻이었다.
     */
    const response = await post({ type: 'link_rebuild', target: TARGET });

    expect(response.statusCode).toBe(201);
    const body = response.json<{ job_id: number; type: string; state: string; target: string }>();
    expect(body.type).toBe('link_rebuild');
    expect(body.state).toBe('queued');
    // **`target`은 다른 잡과 같은 `owner/repo`다** — 러너가 그 형식을 해석한다.
    expect(body.target).toBe(TARGET);
  });

  it('두 유형은 서로의 활성 잡을 막지 않는다 — 대상이 같아도 하는 일이 다르다', async () => {
    expect((await post({ type: 'backfill', target: TARGET })).statusCode).toBe(201);
    expect((await post({ type: 'link_rebuild', target: TARGET })).statusCode).toBe(201);
  });

  it('알 수 없는 `type`은 400이다 — 아무도 잡지 않는 잡을 만들지 않는다', async () => {
    // 집는 러너가 없는 유형은 여전히 거절한다.
    expect((await post({ type: 'reindex', target: TARGET })).statusCode).toBe(400);
    expect((await post({ type: 'sequence_reassign', target: TARGET })).statusCode).toBe(400);
    expect((await post({ target: TARGET })).statusCode).toBe(400);
  });

  it('`target` 모양이 틀리면 400이다', async () => {
    expect((await post({ type: 'backfill', target: 'payments' })).statusCode).toBe(400);
    expect((await post({ type: 'backfill', target: 42 })).statusCode).toBe(400);
  });

  /*
   * **409는 실행 중 잡 식별자를 함께 준다** (AC-4, QA-A003-03, PR #89 리뷰 P2).
   * 대상만 돌려주면 화면이 "이미 돌고 있다"까지만 말하고 **운영자가 그 잡을
   * 찾아갈 곳이 없다.**
   */
  it('중복 요청의 409가 실행 중 잡 ID를 담는다 (AC-4)', async () => {
    const first = await post({ type: 'backfill', target: TARGET });
    expect(first.statusCode).toBe(201);
    const runningId = first.json<{ job_id: number }>().job_id;

    const second = await post({ type: 'backfill', target: TARGET });
    expect(second.statusCode).toBe(409);
    const body = second.json<{ error: { code: string; detail?: Record<string, unknown> } }>();
    expect(body.error.code).toBe('JOB_CONFLICT');
    expect(body.error.detail?.['job_id']).toBe(runningId);
  });

  it('**상한을 넘겨도 거절하지 않는다** — 큐에 넣는다 (AC-6)', async () => {
    /*
     * 상한은 *동시에 도는 수*의 제약이지 *요청받을 수 있는 수*의 제약이
     * 아니다. 넷째를 400으로 막으면 운영자가 앞의 셋이 끝나는 것을 지켜보다
     * 다시 눌러야 한다.
     */
    for (const name of ['a', 'b', 'c', 'd']) {
      await repositoryRepo.upsertRepository(pool, {
        repository_id: 5000 + name.charCodeAt(0),
        owner: 'acme',
        name,
        org_id: 77,
        visibility: 'internal',
        sequence_branches: ['main'],
      });
      expect((await post({ type: 'backfill', target: `acme/${name}` })).statusCode).toBe(201);
    }
    expect(await jobRepo.listJobs(pool, { state: 'queued' })).toHaveLength(4);
  });

  /*
   * **응답 필드가 유일한 방어선이 아니다** (AC-7, PR #89 리뷰 P2).
   * `allowed_actions`에서 뺀 동작을 변이 경로가 그대로 받으면, 직접 호출하는
   * 클라이언트가 `reconcile`을 `paused`로 옮길 수 있다 — 러너에 멈출 지점이
   * 없어 전량 스윕은 완주하고 행만 `paused`가 되며, `resume`이 같은 스캔을
   * 다시 큐에 넣는다.
   */
  it('`reconcile`의 `pause`를 PATCH가 거절한다 (AC-7)', async () => {
    const created = await post({ type: 'reconcile' });
    expect(created.statusCode).toBe(201);
    const jobId = created.json<{ job_id: number; allowed_actions: readonly string[] }>();
    // 응답이 이미 좁혀져 있다.
    expect(jobId.allowed_actions).toEqual(['cancel']);

    const paused = await app.inject({
      method: 'PATCH',
      url: `${JOBS_PATH}/${String(jobId.job_id)}`,
      headers: AUTH,
      payload: { action: 'pause' },
    });

    expect(paused.statusCode).toBe(400);
    const body = paused.json<{ error: { detail?: Record<string, unknown> } }>();
    expect(body.error.detail?.['allowed_actions']).toEqual(['cancel']);
    // 행은 그대로다 — 거절이 조용한 무시가 아니다.
    expect(await jobRepo.findJobState(pool, jobId.job_id)).toBe('queued');
  });

  it('`cancel`은 `reconcile`에서도 받는다', async () => {
    const created = await post({ type: 'reconcile' });
    const jobId = created.json<{ job_id: number }>().job_id;

    const cancelled = await app.inject({
      method: 'PATCH',
      url: `${JOBS_PATH}/${String(jobId)}`,
      headers: AUTH,
      payload: { action: 'cancel' },
    });

    expect(cancelled.statusCode).toBe(200);
    expect(await jobRepo.findJobState(pool, jobId)).toBe('cancelled');
  });

  it('인증 없이는 401이다', async () => {
    expect((await app.inject({ method: 'POST', url: JOBS_PATH, payload: {} })).statusCode).toBe(401);
  });
});

describe('GET — 조회', () => {
  it('목록과 단건을 낸다', async () => {
    const created = await post({ type: 'backfill', target: TARGET });
    const jobId = created.json<{ job_id: number }>().job_id;

    const list = await app.inject({ method: 'GET', url: JOBS_PATH, headers: AUTH });
    expect(list.statusCode).toBe(200);
    expect(list.json<{ items: unknown[] }>().items).toHaveLength(1);

    const one = await app.inject({ method: 'GET', url: `${JOBS_PATH}/${String(jobId)}`, headers: AUTH });
    expect(one.statusCode).toBe(200);
    expect(one.json<{ job_id: number }>().job_id).toBe(jobId);
  });

  it('**`cursor`를 내보내지 않는다** (DEV-103)', async () => {
    const created = await post({ type: 'backfill', target: TARGET });
    const jobId = created.json<{ job_id: number }>().job_id;
    await jobRepo.updateJobProgress(pool, jobId, { done: 10, total: 100, unit: 'pull_request' }, { page: 2, done: 10 });

    const one = await app.inject({ method: 'GET', url: `${JOBS_PATH}/${String(jobId)}`, headers: AUTH });
    const body = one.json<Record<string, unknown>>();

    /*
     * 재개 지점은 워커의 내부 상태다. 운영자가 읽을 수 있으면 고치고
     * 싶어지고, 고치면 재개가 무엇을 이어받는지 아무도 보장하지 못한다.
     */
    expect(body).not.toHaveProperty('cursor');
    // 진행률은 그대로 보인다 — 그것이 운영자가 볼 것이다 (AC-2).
    expect(body['progress']).toMatchObject({ done: 10, total: 100, unit: 'pull_request' });
  });

  it('**한도 대기가 진행률에 보인다** (DEV-104)', async () => {
    const created = await post({ type: 'backfill', target: TARGET });
    const jobId = created.json<{ job_id: number }>().job_id;
    const until = '2026-08-22T10:00:00.000Z';
    await jobRepo.updateJobProgress(
      pool,
      jobId,
      { done: 10, total: null, unit: 'pull_request', waiting_until: until },
      { page: 2, done: 10 },
    );

    const one = await app.inject({ method: 'GET', url: `${JOBS_PATH}/${String(jobId)}`, headers: AUTH });
    const body = one.json<{ state: string; progress: Record<string, unknown> }>();

    expect(body.progress['waiting_until']).toBe(until);
    // 상태는 바뀌지 않았다 — `paused`는 운영자 의도만 뜻한다.
    expect(body.state).not.toBe('paused');
  });

  it('없는 잡은 404다', async () => {
    expect((await app.inject({ method: 'GET', url: `${JOBS_PATH}/999999`, headers: AUTH })).statusCode).toBe(404);
  });

  it('식별자가 정수가 아니면 400이다', async () => {
    expect((await app.inject({ method: 'GET', url: `${JOBS_PATH}/abc`, headers: AUTH })).statusCode).toBe(400);
  });
});

describe('PATCH — 중단·재개', () => {
  async function queued(): Promise<number> {
    return (await post({ type: 'backfill', target: TARGET })).json<{ job_id: number }>().job_id;
  }

  it('중단하고 재개한다', async () => {
    const jobId = await queued();

    const paused = await patch(jobId, { action: 'pause' });
    expect(paused.statusCode).toBe(200);
    expect(paused.json<{ state: string }>().state).toBe('paused');

    const resumed = await patch(jobId, { action: 'resume' });
    /*
     * `running`이 아니라 `queued`로 돌아간다 — 곧바로 올리면 상한을 넘겨
     * 되살아난다. claim을 다시 거쳐야 한다 (DEV-102).
     */
    expect(resumed.json<{ state: string }>().state).toBe('queued');
  });

  it('취소는 종료 시각을 남긴다', async () => {
    const jobId = await queued();
    const response = await patch(jobId, { action: 'cancel' });

    expect(response.json<{ state: string; finished_at: string | null }>().state).toBe('cancelled');
    expect(response.json<{ finished_at: string | null }>().finished_at).not.toBeNull();
  });

  it('**끝난 잡은 되살릴 수 없다** — 새 잡이지 전이가 아니다', async () => {
    const jobId = await queued();
    await jobRepo.finishJob(pool, jobId, 'completed');

    const response = await patch(jobId, { action: 'resume' });
    expect(response.statusCode).toBe(400);
    // 현재 상태를 알려 준다 — 조용히 무시하면 운영자가 됐다고 믿는다.
    expect(response.json<{ error: { detail?: { state?: string } } }>().error.detail?.state).toBe('completed');
  });

  it('**중단이 조용히 무시되지 않는다** — 이미 취소된 잡을 또 취소하면 400', async () => {
    const jobId = await queued();
    await patch(jobId, { action: 'cancel' });

    expect((await patch(jobId, { action: 'cancel' })).statusCode).toBe(400);
  });

  it('**세 액션만 받는다** (DEV-103)', async () => {
    const jobId = await queued();

    for (const action of ['complete', 'fail', 'reset', '']) {
      expect((await patch(jobId, { action })).statusCode).toBe(400);
    }
    // 진행률·커서를 직접 쓰는 길이 없다.
    expect((await patch(jobId, { cursor: { page: 99 } })).statusCode).toBe(400);
    const row = await jobRepo.findJobById(pool, jobId);
    expect(row?.cursor).toBeNull();
  });

  it('없는 잡은 404다', async () => {
    expect((await patch(999999, { action: 'cancel' })).statusCode).toBe(404);
  });
});

describe('**잡 생성 경합** (DEV-444, PR #91 리뷰 P2)', () => {
  /*
   * 유니크 인덱스는 **활성 상태에만** 걸린다(`job_active_uk`). 유니크 위반과
   * 그 뒤의 재조회 사이에서 이긴 행이 끝나면 제약도 함께 사라진다 — 그때
   * `409`를 내면 운영자는 "이미 돌고 있다"는 말을 듣고도 갈 곳이 없고,
   * **실제로는 아무것도 돌고 있지 않다.**
   *
   * 경합을 **결정적으로** 만든다. 동시 요청 둘을 실제로 띄우면 어느 쪽이
   * 이길지 정해지지 않아 이 창을 재현하지 못한다.
   */
  const RACE_REQUESTER = 'alice';

  /** `seq`번째 쿼리 **직전**에 개입하는 대역 풀. 훅 안의 조회는 세지 않는다. */
  const poolWithHook = (hook: (sql: string, seq: number) => Promise<void>): Pool => {
    let seq = 0;
    return {
      query: async (text: unknown, values?: unknown): Promise<unknown> => {
        seq += 1;
        await hook(String(text), seq);
        return (pool.query as (t: unknown, v?: unknown) => Promise<unknown>)(text, values);
      },
    } as unknown as Pool;
  };

  const insertCompetitor = async (): Promise<number> =>
    jobRepo.enqueueJob(pool, 'backfill', TARGET, 'competitor');

  it('**이긴 잡이 그 사이 끝나면 409가 아니라 새 잡을 만든다**', async () => {
    let competitorId = 0;
    const racing = poolWithHook(async (_sql, seq) => {
      // 2 = INSERT 직전. 경쟁자가 활성 잡을 만들어 유니크 위반을 일으킨다.
      if (seq === 2) competitorId = await insertCompetitor();
      // 3 = 위반 뒤 재조회 직전. 경쟁자가 끝나 활성 잡이 사라진다.
      if (seq === 3) await jobRepo.transitionJob(pool, competitorId, 'cancel');
    });

    const outcome = await createJob(racing, 'backfill', TARGET, RACE_REQUESTER);

    expect(outcome.kind).toBe('created');
    if (outcome.kind !== 'created') throw new Error('created가 아니다');
    expect(outcome.job.job_id).not.toBe(competitorId);
    expect(outcome.job.state).toBe('queued');
  });

  it('이긴 잡이 아직 살아 있으면 그 식별자로 충돌을 낸다 — 대칭', async () => {
    let competitorId = 0;
    const racing = poolWithHook(async (_sql, seq) => {
      if (seq === 2) competitorId = await insertCompetitor();
    });

    const outcome = await createJob(racing, 'backfill', TARGET, RACE_REQUESTER);

    expect(outcome).toEqual({ kind: 'conflict', jobId: competitorId });
  });

  it('**충돌은 식별자 없이 나올 수 없다** — 창이 계속 갈리면 오류를 올린다', async () => {
    /*
     * 무한 재시도를 두지 않는다. 활성 잡이 이 짧은 창에서 계속 생겼다
     * 사라진다면 다른 문제가 있다는 뜻이고, 그때 요청을 영원히 붙잡는 것은
     * 운영자에게 아무것도 알려 주지 않는다. **없는 제품 오류 코드를 지어내지도
     * 않는다** — 기존 처리 정책이 답한다.
     */
    let competitorId = 0;
    const racing = poolWithHook(async (sql) => {
      if (/INSERT INTO job/i.test(sql)) {
        competitorId = await insertCompetitor();
      } else if (/FROM job/i.test(sql) && competitorId > 0) {
        await jobRepo.transitionJob(pool, competitorId, 'cancel');
        competitorId = 0;
      }
    });

    await expect(createJob(racing, 'backfill', TARGET, RACE_REQUESTER)).rejects.toThrow(/경합/);
  });

  it('경합이 없으면 평소대로 만든다', async () => {
    const outcome = await createJob(pool, 'backfill', TARGET, RACE_REQUESTER);
    expect(outcome.kind).toBe('created');
  });
});
