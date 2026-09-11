/**
 * API-SEQ-007과 목록 M 대조 (WP-074 FR-SEQ-008 / T05a · T05b · T05d).
 *
 * ## 무엇을 묻는가
 *
 * 1. **계약의 오류 표 그대로** 답하는가 — 400·404·409·200의 갈림과 사유(DEV-580).
 * 2. 미등록·권한 밖·없는 대상이 **같은 404 메시지**인가 (ADR-008, THR-006).
 * 3. M 방향에서 에폭 생략이 거부되고, 에폭 불일치는 **결과 키 없이** 답하는가.
 * 4. 목록 N행이 정본을 **한 번만** 묻는가 — 행별 조회를 만들지 않는다 (ADR-023 C5).
 * 5. 기능이 꺼진 배포에서 M 키가 **생기지 않는가** (기존 응답 모양 보존).
 *
 * 실행: `pnpm exec vitest run --config vitest.integration.config.ts apps/search-api/integration/sequence/merge-numbers`
 */

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Client } from '@elastic/elasticsearch';
import {
  AccessScopeResolver,
  SESSION_COOKIE_NAME,
  SessionStore,
  createScopeDatabase,
  createSessionId,
  scopeKey,
  type AccessScopeSource,
} from '@prs/authz';
import { authRepo, mergeSequenceRepo, repositoryRepo, sequenceSpaceRepo, type Pool } from '@prs/db';
import type { Redis } from '@prs/bus';
import { buildServer } from '../../src/server.js';
import { MERGE_NUMBER_RESOLVE_PATH } from '../../src/sequence/merge-numbers.js';
import { SEARCH_PATH } from '../../src/search/routes.js';
import type { AuthContext, AuthRedis } from '../../src/auth/context.js';
import { createTestRedis, migratedPool } from '../helpers.js';
import { TEST_CURSOR_KEY, TEST_CURSOR_SIGNER } from '../_cursor-fixture.js';

const AUTH_CONFIG = {
  enabled: true,
  cookieSecure: true,
  loginPath: '/auth/login',
  groupRoleMap: new Map<string, never>(),
} as const;

const USER = 'sub-mnumber';
const ORG = 1;
/** 이름에 숫자 run이 하나 — 코드는 `1900`이다 (OD-009). */
const SMP = 6101;
/** 이름에 숫자가 없다 — 표기 코드를 만들 수 없다. */
const NOCODE = 6102;
/** 접근 범위 밖. 존재가 새면 안 된다. */
const HIDDEN = 6900;
const MAIN = 'main';
const OTHER_BRANCH = 'release/2026.09';

const sha = (n: number): string => `${String(n).padStart(2, '0')}${'a'.repeat(38)}`;

/** 서수 1..5. 2·4·5가 PR이고 그중 2·4만 번호를 받았다 — 5는 앞이 막혀 대기다. */
const ROWS = [
  { seq: 1, pr: null, m: null },
  { seq: 2, pr: 21, m: 1 },
  { seq: 3, pr: null, m: null },
  { seq: 4, pr: 25, m: 2 },
  { seq: 5, pr: 29, m: null },
] as const;

let pool: Pool;
let redis: Redis;
let app: FastifyInstance;
let appDisabled: FastifyInstance;
let sessionId: string;
/** 이 요청이 실행한 SQL. 행별 조회를 만들지 않는다는 주장을 여기서 센다. */
let sqlLog: string[] = [];

interface ResolveBody {
  readonly sequence_space?: string;
  readonly seq_epoch?: number;
  readonly epoch_stale?: boolean;
  readonly requested_seq_epoch?: number;
  readonly pr_number?: number;
  readonly merge_seq?: number;
  readonly merge_number?: string | null;
  readonly merge_number_state?: string;
  readonly merge_number_reason?: string | null;
  readonly merge_number_epoch?: number | null;
  readonly merge_number_projection_state?: string;
  readonly error?: { code: string; message: string; detail?: Record<string, unknown> };
  readonly correlation_id: string;
}

async function resolve(
  params: Record<string, string>,
  options: { readonly session?: boolean; readonly server?: FastifyInstance } = {},
): Promise<{ status: number; body: ResolveBody }> {
  const query = new URLSearchParams(params).toString();
  const response = await (options.server ?? app).inject({
    method: 'GET',
    url: `${MERGE_NUMBER_RESOLVE_PATH}?${query}`,
    ...(options.session === false ? {} : { headers: { cookie: `${SESSION_COOKIE_NAME}=${sessionId}` } }),
  });
  return { status: response.statusCode, body: response.json<ResolveBody>() };
}

/** 목록 대역. PR 셋을 한 페이지로 준다 — 색인의 M 값도 함께 실어 관측 상태를 만든다. */
function stubEsClient(): Client {
  const hit = (pr: number, indexedNumber: number | null, epoch: number | null): unknown => ({
    _index: 'prs-pull-requests-v2',
    _id: `${String(SMP)}:${String(pr)}`,
    _source: {
      repository: 'acme/smp1900',
      repository_id: SMP,
      base_branch: MAIN,
      pr_number: pr,
      title: `PR ${String(pr)}`,
      state: 'merged',
      merge_seq: 2,
      seq_epoch: 1,
      ...(indexedNumber === null ? {} : { merge_number: indexedNumber }),
      ...(epoch === null ? {} : { merge_number_epoch: epoch }),
    },
    sort: [String(pr)],
  });
  return {
    search: () =>
      Promise.resolve({
        // 부분 결과를 내보내지 않는다는 계약이 `_shards`를 읽는다 (CR-016, DEV-054).
        _shards: { failed: 0, total: 1 },
        hits: {
          total: { value: 3, relation: 'eq' },
          hits: [
            // 21: 색인이 정본과 같다 → in_sync
            hit(21, 1, 1),
            // 25: 색인이 아직 비었다 → pending
            hit(25, null, null),
            // 29: 정본에 번호가 없다 → pending / predecessor_pending
            hit(29, null, null),
          ],
        },
        pit_id: 'pit-1',
      }),
    openPointInTime: () => Promise.resolve({ id: 'pit-1' }),
    closePointInTime: () => Promise.resolve({ succeeded: true }),
    msearch: () => Promise.resolve({ responses: [] }),
  } as unknown as Client;
}

/** 색인 관측 대역 — resolve가 부르는 `_search` 하나. */
function stubProjectionEs(mergeNumber: number | null, epoch: number | null): Client {
  return {
    search: () =>
      Promise.resolve({
        _shards: { failed: 0, total: 1 },
        hits: {
          total: { value: mergeNumber === null ? 0 : 1, relation: 'eq' },
          hits:
            mergeNumber === null
              ? []
              : [
                  {
                    _index: 'prs-pull-requests-v2',
                    _id: 'x',
                    _source: {
                      merge_number: mergeNumber,
                      merge_number_epoch: epoch,
                      merge_commit_sha: sha(2),
                      merge_number_state: 'assigned',
                    },
                  },
                ],
        },
      }),
    msearch: () => Promise.resolve({ responses: [] }),
  } as unknown as Client;
}

/** `pool.query`를 감싸 실행된 SQL을 기록한다. 행별 조회를 만들지 않는다는 주장의 근거다. */
function recordingPool(base: Pool): Pool {
  return new Proxy(base, {
    get(target, property, receiver) {
      if (property === 'query') {
        return (...args: unknown[]): unknown => {
          const first = args[0];
          sqlLog.push(typeof first === 'string' ? first : String((first as { text?: string }).text ?? ''));
          return (target.query as (...a: unknown[]) => unknown).apply(target, args);
        };
      }
      return Reflect.get(target, property, receiver) as unknown;
    },
  }) as Pool;
}

beforeAll(async () => {
  pool = await migratedPool();
  redis = createTestRedis();

  // 근거 행이 정본 행을 참조한다 (FK, ON DELETE RESTRICT) — 근거부터 지운다.
  await pool.query('DELETE FROM sequence_latency_sample');
  await pool.query('DELETE FROM sequence_work');
  await pool.query('DELETE FROM mnumber_evidence');
  await pool.query('DELETE FROM merge_sequence');
  await pool.query('DELETE FROM sequence_space');
  await pool.query('DELETE FROM permission_cache');
  await pool.query('DELETE FROM app_user');
  await pool.query('DELETE FROM repository');

  await authRepo.upsertUserOnLogin(pool, { user_id: USER, login: 'kim', github_user_id: 6001 });
  for (const [id, owner, name, org] of [
    [SMP, 'acme', 'smp1900', ORG],
    [NOCODE, 'acme', 'payments', ORG],
    [HIDDEN, 'other', 'secret9', 2],
  ] as const) {
    await repositoryRepo.upsertRepository(pool, {
      repository_id: id,
      owner,
      name,
      org_id: org,
      visibility: 'internal',
      sequence_branches: [MAIN],
    });
  }

  await sequenceSpaceRepo.ensureSequenceSpace(pool, SMP, MAIN);
  for (const row of ROWS) {
    await mergeSequenceRepo.upsertMergeSequence(pool, {
      repository_id: SMP,
      base_branch: MAIN,
      seq_epoch: 1,
      merge_seq: row.seq,
      commit_sha: sha(row.seq),
      pull_request_number: row.pr,
      committed_at: new Date('2026-09-01T00:00:00Z'),
    });
  }
  await sequenceSpaceRepo.advanceHead(pool, SMP, MAIN, sha(5), 5);
  await mergeSequenceRepo.assignMergeNumbers(
    pool,
    SMP,
    MAIN,
    1,
    ROWS.filter((row) => row.m !== null).map((row) => ({ mergeSeq: row.seq, prNumber: row.pr as number, mergeNumber: row.m as number })),
  );
  // 5번이 막혀 있다 — 그 사유가 곧 목록의 `pending` 사유가 된다.
  await sequenceSpaceRepo.advanceMergeNumberCheckpoint(pool, SMP, MAIN, 1, {
    headSeq: 4,
    headNumber: 2,
    blocked: { seq: 5, reason: 'negative_evidence_unavailable' },
  });

  // 숫자 없는 이름의 저장소에도 번호가 하나 붙어 있다 — 표기 코드만 만들 수 없다.
  await sequenceSpaceRepo.ensureSequenceSpace(pool, NOCODE, MAIN);
  await mergeSequenceRepo.upsertMergeSequence(pool, {
    repository_id: NOCODE,
    base_branch: MAIN,
    seq_epoch: 1,
    merge_seq: 1,
    commit_sha: sha(9),
    pull_request_number: 31,
    committed_at: new Date('2026-09-01T00:00:00Z'),
  });
  await sequenceSpaceRepo.advanceHead(pool, NOCODE, MAIN, sha(9), 1);
  await mergeSequenceRepo.assignMergeNumbers(pool, NOCODE, MAIN, 1, [{ mergeSeq: 1, prNumber: 31, mergeNumber: 1 }]);
  await sequenceSpaceRepo.advanceMergeNumberCheckpoint(pool, NOCODE, MAIN, 1, { headSeq: 1, headNumber: 1, blocked: null });

  const redisPort: AuthRedis = {
    get: (key) => redis.get(key),
    set: (key, value, mode, seconds) => redis.set(key, value, mode, seconds),
    del: (...keys) => redis.del(...keys),
    scan: (cursor, m, pattern, c, n) => redis.scan(cursor, m, pattern, c, n),
  };
  const source: AccessScopeSource = {
    fetch: async () => ({ repositoryIds: [SMP, NOCODE], orgIds: [ORG], teamIds: [], visibilities: ['internal'] }),
  };
  const auth: AuthContext = {
    sessions: new SessionStore({ redis: redisPort }),
    scopes: new AccessScopeResolver({ redis: redisPort, db: createScopeDatabase(pool), source }),
    forget: async (ids) => {
      if (ids.length > 0) await redis.del(...ids.map(scopeKey));
    },
  };

  const recorded = recordingPool(pool);
  const baseConfig = {
    port: 0,
    adminTokens: [],
    metricsQueryUrl: null,
    gheBaseUrl: null,
    auth: AUTH_CONFIG,
    searchCursorKey: TEST_CURSOR_KEY,
  };
  const resolveNames = async (): Promise<{
    orgIds: ReadonlyMap<string, number>;
    teamIds: ReadonlyMap<string, readonly number[]>;
  }> => ({ orgIds: new Map(), teamIds: new Map() });

  app = buildServer({
    config: { ...baseConfig, mergeNumberEnabled: true },
    auth,
    search: { pool: recorded, es: stubEsClient(), cursorSigner: TEST_CURSOR_SIGNER, resolveNames },
    sequence: { pool: recorded, es: stubProjectionEs(1, 1), cursorSigner: TEST_CURSOR_SIGNER, resolveNames },
  });
  await app.ready();

  // 기능이 꺼진 배포. 같은 데이터·같은 요청에 **기존 모양**으로 답해야 한다.
  appDisabled = buildServer({
    config: { ...baseConfig, mergeNumberEnabled: false },
    auth,
    search: { pool, es: stubEsClient(), cursorSigner: TEST_CURSOR_SIGNER, resolveNames },
    sequence: { pool, es: stubProjectionEs(1, 1), cursorSigner: TEST_CURSOR_SIGNER, resolveNames },
  });
  await appDisabled.ready();
}, 180_000);

beforeEach(async () => {
  sqlLog = [];
  await redis.del(scopeKey(USER));
  sessionId = createSessionId();
  const now = Date.now();
  await new SessionStore({
    redis: {
      get: (key) => redis.get(key),
      set: (key, value, mode, seconds) => redis.set(key, value, mode, seconds),
      del: (...keys) => redis.del(...keys),
      scan: (cursor, m, pattern, c, n) => redis.scan(cursor, m, pattern, c, n),
    },
  }).create({
    sessionId,
    userId: USER,
    login: 'kim',
    email: null,
    roles: ['developer'],
    issuedAt: now,
    lastSeenAt: now,
    correlationId: null,
  });
});

afterAll(async () => {
  await app?.close();
  await appDisabled?.close();
  await redis?.quit();
  await pool?.end();
});

describe('T05a: 입력 계약 (API-SEQ-007, DEV-580)', () => {
  it('**repository·base_branch는 생략할 수 없다** — 서버가 공간을 고르지 않는다', async () => {
    const noRepo = await resolve({ base_branch: MAIN, pr_number: '21' });
    expect(noRepo.status).toBe(400);
    expect(noRepo.body.error?.detail).toMatchObject({ field: 'repository' });
    const noBranch = await resolve({ repository: 'acme/smp1900', pr_number: '21' });
    expect(noBranch.status).toBe(400);
    expect(noBranch.body.error?.detail).toMatchObject({ field: 'base_branch' });
  });

  it('앵커는 정확히 하나다 — 둘 다 주거나 둘 다 없으면 400', async () => {
    const both = await resolve({ repository: 'acme/smp1900', base_branch: MAIN, pr_number: '21', merge_number: 'M-1900-1', seq_epoch: '1' });
    expect(both.status).toBe(400);
    const neither = await resolve({ repository: 'acme/smp1900', base_branch: MAIN });
    expect(neither.status).toBe(400);
  });

  it.each([
    ['0', 'pr_number'],
    ['-1', 'pr_number'],
    ['1.5', 'pr_number'],
    ['1e3', 'pr_number'],
    [' 21', 'pr_number'],
    ['21abc', 'pr_number'],
    ['2147483648', 'pr_number'],
  ])('정수 경계 밖 pr_number는 400이다: %s', async (value) => {
    const result = await resolve({ repository: 'acme/smp1900', base_branch: MAIN, pr_number: value });
    expect(result.status).toBe(400);
    expect(result.body.error?.detail).toMatchObject({ field: 'pr_number' });
  });

  it.each([
    'M-1900-0',
    'M-1900-01',
    ' M-1900-1',
    'M-1900-1 ',
    'M-1900-1.5',
    'M-1900-9007199254740992',
    'm-1900-1',
    'M-1900-1x',
    '1900-1',
  ])('형식 밖 merge_number는 400이다: %s', async (value) => {
    const result = await resolve({ repository: 'acme/smp1900', base_branch: MAIN, merge_number: value, seq_epoch: '1' });
    expect(result.status).toBe(400);
    expect(result.body.error?.detail).toMatchObject({ field: 'merge_number' });
  });

  it('**M 방향은 seq_epoch가 필수다** — 생략값을 현재로 보완하지 않는다 (AC-12)', async () => {
    const result = await resolve({ repository: 'acme/smp1900', base_branch: MAIN, merge_number: 'M-1900-1' });
    expect(result.status).toBe(400);
    expect(result.body.error?.detail).toMatchObject({ field: 'seq_epoch' });
  });

  it('저장소 코드가 다르면 거부한다 — 이름이 말하는 코드와 문자 그대로 같아야 한다', async () => {
    const result = await resolve({ repository: 'acme/smp1900', base_branch: MAIN, merge_number: 'M-1901-1', seq_epoch: '1' });
    expect(result.status).toBe(400);
    expect(result.body.error?.detail).toMatchObject({ field: 'merge_number', reason: 'repository_code_mismatch' });
  });

  it('이름에서 코드를 정할 수 없는 저장소는 M 방향이 400이다', async () => {
    const result = await resolve({ repository: 'acme/payments', base_branch: MAIN, merge_number: 'M-1-1', seq_epoch: '1' });
    expect(result.status).toBe(400);
    expect(result.body.error?.detail).toMatchObject({ reason: 'repository_code_unavailable' });
  });

  it('PR 방향은 코드를 만들 수 없어도 200이고 `unavailable`이다 (설계 9절 표)', async () => {
    const result = await resolve({ repository: 'acme/payments', base_branch: MAIN, pr_number: '31' });
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      merge_number: null,
      merge_number_state: 'unavailable',
      merge_number_reason: 'repository_code_unavailable',
    });
  });

  it('세션이 없으면 401이다', async () => {
    const result = await resolve({ repository: 'acme/smp1900', base_branch: MAIN, pr_number: '21' }, { session: false });
    expect(result.status).toBe(401);
  });
});

describe('T05b: 존재·권한·에폭', () => {
  it('**미등록·권한 밖·없는 대상이 같은 404 메시지다** — 존재가 새지 않는다', async () => {
    const unregistered = await resolve({ repository: 'acme/ghost', base_branch: MAIN, pr_number: '21' });
    const hidden = await resolve({ repository: 'other/secret9', base_branch: MAIN, pr_number: '21' });
    const unknownM = await resolve({ repository: 'acme/smp1900', base_branch: MAIN, merge_number: 'M-1900-99', seq_epoch: '1' });
    for (const result of [unregistered, hidden, unknownM]) {
      expect(result.status).toBe(404);
      expect(result.body.error?.code).toBe('NOT_FOUND');
    }
    expect(hidden.body.error?.message).toBe(unregistered.body.error?.message);
    expect(unknownM.body.error?.message).toBe(unregistered.body.error?.message);
  });

  it('비대상 브랜치는 409 `branch_not_tracked`다', async () => {
    const result = await resolve({ repository: 'acme/smp1900', base_branch: OTHER_BRANCH, pr_number: '21' });
    expect(result.status).toBe(409);
    expect(result.body.error).toMatchObject({ code: 'NO_SEQUENCE', detail: { reason: 'branch_not_tracked' } });
  });

  it('이 공간에 서수가 없는 PR은 409 `not_sequenced`다', async () => {
    const result = await resolve({ repository: 'acme/smp1900', base_branch: MAIN, pr_number: '999' });
    expect(result.status).toBe(409);
    expect(result.body.error).toMatchObject({ code: 'NO_SEQUENCE', detail: { reason: 'not_sequenced' } });
  });

  it('**에폭이 다르면 계산하지 않는다** — 결과 키 자체가 없다 (ADR-007 규칙 5)', async () => {
    const result = await resolve({ repository: 'acme/smp1900', base_branch: MAIN, pr_number: '21', seq_epoch: '7' });
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ epoch_stale: true, requested_seq_epoch: 7, seq_epoch: 1 });
    for (const key of ['pr_number', 'merge_seq', 'merge_number', 'merge_number_state', 'sequence_state']) {
      expect(Object.hasOwn(result.body, key), key).toBe(false);
    }
  });
});

describe('T05a: 값과 상태', () => {
  it('**확정된 PR은 표기 문자열과 함께 assigned다** — 양방향이 같은 모양을 돌려준다', async () => {
    const byPr = await resolve({ repository: 'acme/smp1900', base_branch: MAIN, pr_number: '21', seq_epoch: '1' });
    expect(byPr.status).toBe(200);
    expect(byPr.body).toMatchObject({
      sequence_space: 'acme/smp1900@main',
      seq_epoch: 1,
      epoch_stale: false,
      pr_number: 21,
      merge_seq: 2,
      merge_number: 'M-1900-1',
      merge_number_state: 'assigned',
      merge_number_reason: null,
      merge_number_epoch: 1,
      merge_number_projection_state: 'in_sync',
    });

    const byM = await resolve({ repository: 'acme/smp1900', base_branch: MAIN, merge_number: 'M-1900-1', seq_epoch: '1' });
    expect(byM.status).toBe(200);
    // 두 방향의 답은 **상관 ID만 다르고 나머지가 같아야** 한다.
    const sameExceptCorrelation = (body: ResolveBody): ResolveBody => ({
      ...body,
      correlation_id: '<비교 대상 아님>',
    });
    expect(sameExceptCorrelation(byM.body)).toEqual(sameExceptCorrelation(byPr.body));
  });

  it('**앞이 막혀 번호가 없는 PR은 pending이고 잠정값을 지어내지 않는다** (AC-3)', async () => {
    const result = await resolve({ repository: 'acme/smp1900', base_branch: MAIN, pr_number: '29' });
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      pr_number: 29,
      merge_seq: 5,
      merge_number: null,
      merge_number_state: 'pending',
      merge_number_reason: 'negative_evidence_unavailable',
      merge_number_epoch: 1,
    });
    // 내부 blocker 서수는 응답에 없다 — 운영 CLI만 본다.
    expect(JSON.stringify(result.body)).not.toContain('blocked');
  });

  it('PR 방향은 seq_epoch 생략을 허용한다 (현재 에폭)', async () => {
    const result = await resolve({ repository: 'acme/smp1900', base_branch: MAIN, pr_number: '25' });
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ merge_number: 'M-1900-2', merge_number_state: 'assigned', seq_epoch: 1 });
  });

  it('기능이 꺼진 배포는 404 `feature_disabled`다', async () => {
    const result = await resolve({ repository: 'acme/smp1900', base_branch: MAIN, pr_number: '21' }, { server: appDisabled });
    expect(result.status).toBe(404);
    expect(result.body.error?.detail).toMatchObject({ reason: 'feature_disabled' });
  });
});

describe('T05d: 목록은 정본을 한 번만 묻는다 (ADR-023 C5)', () => {
  it('**PR 3행에 대해 M 대조 SQL이 1회다** — 행별 조회를 만들지 않는다', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `${SEARCH_PATH}?q=repo:acme/smp1900`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${sessionId}` },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<{ items: Record<string, unknown>[] }>();
    expect(body.items).toHaveLength(3);

    const lookups = sqlLog.filter((sql) => sql.includes('FROM merge_sequence ms') && sql.includes('unnest'));
    expect(lookups).toHaveLength(1);
    const spaces = sqlLog.filter((sql) => sql.includes('FROM sequence_space s') && sql.includes('unnest'));
    expect(spaces).toHaveLength(1);
  });

  it('**색인 값이 아니라 정본을 싣고, 색인이 뒤처지면 관측 상태로 알린다**', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `${SEARCH_PATH}?q=repo:acme/smp1900`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${sessionId}` },
    });
    const body = response.json<{ items: Record<string, unknown>[] }>();
    expect(body.items[0]).toMatchObject({
      pr_number: 21,
      merge_number: 'M-1900-1',
      merge_number_state: 'assigned',
      merge_number_projection_state: 'in_sync',
    });
    // 25는 정본에 번호가 있으나 색인이 아직 비었다 — 값은 정본이고 관측만 pending이다.
    expect(body.items[1]).toMatchObject({
      pr_number: 25,
      merge_number: 'M-1900-2',
      merge_number_state: 'assigned',
      merge_number_projection_state: 'pending',
    });
    expect(body.items[2]).toMatchObject({
      pr_number: 29,
      merge_number: null,
      merge_number_state: 'pending',
      merge_number_reason: 'negative_evidence_unavailable',
    });
  });

  it('기능이 꺼지면 목록에 M 키가 **생기지 않는다** — 기존 응답 모양 그대로다', async () => {
    const response = await appDisabled.inject({
      method: 'GET',
      url: `${SEARCH_PATH}?q=repo:acme/smp1900`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${sessionId}` },
    });
    const body = response.json<{ items: Record<string, unknown>[] }>();
    expect(body.items).toHaveLength(3);
    for (const item of body.items) {
      for (const key of ['merge_number', 'merge_number_state', 'merge_number_reason', 'merge_number_epoch', 'merge_number_projection_state']) {
        expect(Object.hasOwn(item, key), key).toBe(false);
      }
    }
  });
});
