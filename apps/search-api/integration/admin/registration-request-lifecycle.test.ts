/**
 * 등록 검토 요청의 수명주기 (API-ADM-009 / FR-ING-009 AC-10·AC-11, WP-040 / CR-055).
 *
 * 실제 PostgreSQL에 붙는다. **두 평면을 한 서버에서 함께 세운다** — 요청자가
 * 보는 응답과 운영자가 보는 응답이 갈라져 있다는 것이 이 계약의 핵심이고,
 * 평면을 따로 세운 시험은 그 갈라짐이 실제로 유지되는지 재지 못한다.
 *
 * ## 이 파일이 반증하는 결함
 *
 * 1. **승인 중간 상태** — `fulfilled`가 성공한 등록 없이 만들어지면 안 된다.
 *    등록되지 않은 채 승인된 행은 수집도 채번도 시작하지 않는다.
 * 2. **한 건만 닫기** — 여러 요청자가 같은 저장소를 요청했을 때 등록 하나가
 *    그 전부를 종료하지 않으면 대기열에 이미 해결된 항목이 쌓인다.
 * 3. **처리 상태 누출** — 요청자 평면에 `status`·`resolution_note`·`resolved_by`가
 *    새면 종료 사유가 곧 "그 저장소는 없다"의 답이 된다 (THR-045).
 * 4. **조용한 재개방** — 종료된 요청이 일반 사용자의 반복 호출로 다시 열리면
 *    운영자의 처리 결과가 그것을 보지도 못하는 호출 하나로 되돌려진다.
 * 5. **깨진 원자성** — 저장소가 `active`인데 그 식별자의 요청이 `pending`으로
 *    남는 상태를 성공한 등록 하나가 만들어서는 안 된다.
 *
 * 실행: `pnpm run test:integration admin/registration-request-lifecycle`
 */

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  AccessScopeResolver,
  SESSION_COOKIE_NAME,
  SessionStore,
  createScopeDatabase,
  createSessionId,
  scopeKey,
  type AccessScopeSource,
} from '@prs/authz';
import { createEsClient, resolveClientOptions } from '@prs/es';
import type { Client as EsClient } from '@elastic/elasticsearch';
import { applyMappings, switchAliasesForTests } from '@prs/es';
import { RedisStreamsEventBus, type Redis } from '@prs/bus';
import { authRepo, registrationRequestRepo, repositoryRepo, withTransaction, type Pool } from '@prs/db';
import { buildServer } from '../../src/server.js';
import { REGISTRATION_REQUESTS_ADMIN_PATH, REPOSITORIES_PATH } from '../../src/ops/routes.js';
import { REGISTRATION_REQUESTS_PATH } from '../../src/repositories/routes.js';
import type { GheRepositoryFacts } from '../../src/ops/repositories.js';
import type { AuthContext, AuthRedis } from '../../src/auth/context.js';
import { createTestRedis, migratedPool } from '../helpers.js';
import { TEST_CURSOR_KEY, TEST_CURSOR_SIGNER } from '../_cursor-fixture.js';

const AUTH_CONFIG = {
  enabled: true,
  cookieSecure: true,
  loginPath: '/auth/login',
  groupRoleMap: new Map<string, never>(),
} as const;

/** 픽스처 이름은 유일해야 한다 — `prs_test`는 파일 사이에서 공유된다. */
const ALICE = 'sub-wp040-lifecycle-alice';
const BOB = 'sub-wp040-lifecycle-bob';
const OPERATOR = 'sub-wp040-lifecycle-operator';
const USERS = [ALICE, BOB, OPERATOR];

const OWNER = 'wp040lc';
const NAME = 'console';
const SLUG = `${OWNER}/${NAME}`;
const REPOSITORY_ID = 904001;
/** 등록이 실패해야 하는 두 번째 식별자. 요청은 남고 저장소는 서지 않는다. */
const DENIED_SLUG = `${OWNER}/denied`;

let pool: Pool;
let redis: Redis;
let es: EsClient;
let bus: RedisStreamsEventBus;
let app: FastifyInstance;
const cookies = new Map<string, Record<string, string>>();

/** GHE 조회 결과를 시험이 바꿔 끼운다. `null`이면 접근할 수 없다는 뜻이다. */
let lookupFor: (owner: string, name: string) => GheRepositoryFacts | null;

function redisPort(): AuthRedis {
  return {
    get: (key) => redis.get(key),
    set: (key, value, mode, seconds) => redis.set(key, value, mode, seconds),
    del: (...keys) => redis.del(...keys),
    scan: (cursor, m, pattern, c, n) => redis.scan(cursor, m, pattern, c, n),
  };
}

interface Response {
  readonly status: number;
  readonly body: Record<string, unknown>;
}

async function call(
  user: string,
  method: 'GET' | 'POST' | 'PATCH',
  url: string,
  payload?: Record<string, unknown>,
): Promise<Response> {
  const response = await app.inject({
    method,
    url,
    headers: { ...(cookies.get(user) ?? {}), 'content-type': 'application/json' },
    ...(payload === undefined ? {} : { payload }),
  });
  return { status: response.statusCode, body: response.json<Record<string, unknown>>() };
}

/**
 * 오류 응답의 코드와 세부. 모양은 `{ error: { code, message, detail } }`이며
 * 평평하지 않다 — 코드를 최상위에서 읽으면 어떤 오류든 `undefined`가 되어
 * 시험이 조용히 통과한다.
 */
const errorCode = (response: Response): unknown => (response.body['error'] as Record<string, unknown> | undefined)?.['code'];

const errorDetail = (response: Response): unknown =>
  (response.body['error'] as Record<string, unknown> | undefined)?.['detail'];

/** 요청자 평면. `API-ING-003`이며 기록 사실만 돌려준다. */
const userRequest = (user: string, repository: string): Promise<Response> =>
  call(user, 'POST', REGISTRATION_REQUESTS_PATH, { repository });

/** 운영자 평면. `API-ADM-009`이며 처리 상태를 함께 준다. */
const adminList = (query = ''): Promise<Response> =>
  call(OPERATOR, 'GET', `${REGISTRATION_REQUESTS_ADMIN_PATH}${query}`);

const adminDismiss = (requestId: string, body: Record<string, unknown>): Promise<Response> =>
  call(OPERATOR, 'PATCH', `${REGISTRATION_REQUESTS_ADMIN_PATH}/${requestId}`, body);

const register = (repository: string, extra: Record<string, unknown> = {}): Promise<Response> => {
  const slash = repository.indexOf('/');
  return call(OPERATOR, 'POST', REPOSITORIES_PATH, {
    owner: repository.slice(0, slash),
    name: repository.slice(slash + 1),
    ...extra,
  });
};

async function rowsFor(repository: string): Promise<readonly { status: string; requested_by: string; resolved_by: string | null; resolution_note: string | null; resolved_at: Date | null }[]> {
  const slash = repository.indexOf('/');
  const result = await pool.query<{
    status: string;
    requested_by: string;
    resolved_by: string | null;
    resolution_note: string | null;
    resolved_at: Date | null;
  }>(
    `SELECT status, requested_by, resolved_by, resolution_note, resolved_at
       FROM repository_registration_request
      WHERE repository_owner = $1 AND repository_name = $2
      ORDER BY requested_by`,
    [repository.slice(0, slash), repository.slice(slash + 1)],
  );
  return result.rows;
}

beforeAll(async () => {
  pool = await migratedPool();
  redis = createTestRedis();
  es = createEsClient(resolveClientOptions());
  await applyMappings(es);
  await switchAliasesForTests(es);
  bus = new RedisStreamsEventBus(redis);

  await pool.query('DELETE FROM repository_registration_request WHERE requested_by = ANY($1::text[])', [USERS]);
  await pool.query('DELETE FROM audit_record WHERE user_id = ANY($1::text[])', [USERS]);
  await pool.query('DELETE FROM permission_cache WHERE user_id = ANY($1::text[])', [USERS]);
  await pool.query('DELETE FROM app_user WHERE user_id = ANY($1::text[])', [USERS]);
  for (const userId of USERS) {
    await authRepo.upsertUserOnLogin(pool, { user_id: userId, login: userId });
  }

  const sessions = new SessionStore({ redis: redisPort() });
  const source: AccessScopeSource = {
    fetch: async () => ({ repositoryIds: [], orgIds: [], teamIds: [], visibilities: [] }),
  };
  const auth: AuthContext = {
    sessions,
    scopes: new AccessScopeResolver({ redis: redisPort(), db: createScopeDatabase(pool), source }),
    forget: async (ids) => {
      if (ids.length > 0) await redis.del(...ids.map(scopeKey));
    },
  };

  for (const userId of USERS) {
    const sessionId = createSessionId();
    await sessions.create({
      sessionId,
      userId,
      login: userId,
      email: null,
      roles: userId === OPERATOR ? ['operator'] : ['developer'],
      issuedAt: Date.now(),
      lastSeenAt: Date.now(),
      correlationId: null,
    });
    cookies.set(userId, { cookie: `${SESSION_COOKIE_NAME}=${sessionId}` });
  }

  app = buildServer({
    config: {
      port: 0,
      adminTokens: [],
      metricsQueryUrl: null,
      gheBaseUrl: null,
      auth: AUTH_CONFIG,
      searchCursorKey: TEST_CURSOR_KEY,
    },
    auth,
    ops: { pool, bus },
    registry: {
      pool,
      es,
      lookup: async (owner, name) => lookupFor(owner, name),
    },
    requestQueue: { pool, cursorSigner: TEST_CURSOR_SIGNER },
    repositories: { pool, es, cursorSigner: TEST_CURSOR_SIGNER },
  });
  await app.ready();
}, 180_000);

beforeEach(async () => {
  await pool.query('DELETE FROM repository_registration_request WHERE requested_by = ANY($1::text[])', [USERS]);
  await pool.query('DELETE FROM audit_record WHERE user_id = ANY($1::text[])', [USERS]);
  await pool.query('DELETE FROM repository WHERE repository_id = $1', [REPOSITORY_ID]);
  lookupFor = (owner, name) =>
    `${owner}/${name}` === SLUG
      ? { repository_id: REPOSITORY_ID, org_id: 9040, visibility: 'internal', default_branch: 'main' }
      : null;
});

afterAll(async () => {
  await pool?.query('DELETE FROM repository_registration_request WHERE requested_by = ANY($1::text[])', [USERS]);
  await pool?.query('DELETE FROM audit_record WHERE user_id = ANY($1::text[])', [USERS]);
  await pool?.query('DELETE FROM permission_cache WHERE user_id = ANY($1::text[])', [USERS]);
  await pool?.query('DELETE FROM app_user WHERE user_id = ANY($1::text[])', [USERS]);
  await pool?.query('DELETE FROM repository WHERE repository_id = $1', [REPOSITORY_ID]);
  await app?.close();
  await bus?.close();
  await es?.close();
  redis?.disconnect();
  await pool?.end();
});

describe('요청 생성과 초기 상태 (AC-8·AC-9)', () => {
  it('요청을 남기면 `pending`으로 시작한다', async () => {
    const created = await userRequest(ALICE, SLUG);
    expect(created.status).toBe(201);

    const rows = await rowsFor(SLUG);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe('pending');
    expect(rows[0]?.resolved_at).toBeNull();
    expect(rows[0]?.resolved_by).toBeNull();
  });

  it('같은 사용자의 반복 요청이 행을 늘리지 않는다', async () => {
    await userRequest(ALICE, SLUG);
    const again = await userRequest(ALICE, SLUG);
    expect(again.status).toBe(201);
    expect(await rowsFor(SLUG)).toHaveLength(1);
  });

  it('요청자 평면 응답에 처리 상태가 **없다** (THR-045)', async () => {
    const { body } = await userRequest(ALICE, SLUG);
    expect(Object.keys(body).sort()).toEqual(['correlation_id', 'created_at', 'repository', 'request_id'].sort());
    for (const leaked of ['status', 'resolution_note', 'resolved_by', 'resolved_at']) {
      expect(body[leaked]).toBeUndefined();
    }
  });
});

describe('운영자 대기열 (API-ADM-009)', () => {
  it('`pending` 목록을 처리 이력과 함께 준다', async () => {
    await userRequest(ALICE, SLUG);
    const { status, body } = await adminList('?status=pending');
    expect(status).toBe(200);

    const items = body['items'] as readonly Record<string, unknown>[];
    expect(items).toHaveLength(1);
    expect(items[0]?.['repository']).toBe(SLUG);
    expect(items[0]?.['status']).toBe('pending');
    expect(items[0]).toHaveProperty('resolved_at');
    expect(items[0]).toHaveProperty('resolved_by');
    expect(items[0]).toHaveProperty('resolution_note');
  });

  /*
   * **기본 필터가 `pending`이다** (API-ADM-009 계약, PR #89 리뷰 P2). 이 목록은
   * 처리 대기열이고, 필터가 없으면 종료된 이력이 쌓일수록 페이지를 채워
   * **처리할 것이 그 아래로 묻힌다.**
   */
  it('`status`를 주지 않으면 `pending`만 돌려준다', async () => {
    await userRequest(ALICE, SLUG);
    await userRequest(BOB, SLUG);
    const listed = await adminList('?status=pending');
    const requestId = String(
      (listed.body['items'] as readonly Record<string, unknown>[]).find((item) => item['requested_by'] === ALICE)?.[
        'request_id'
      ],
    );
    await adminDismiss(requestId, { action: 'dismiss', reason: '종료한다' });

    const { body } = await adminList();
    const items = body['items'] as readonly Record<string, unknown>[];
    expect(items).toHaveLength(1);
    expect(items[0]?.['requested_by']).toBe(BOB);
    expect(items.every((item) => item['status'] === 'pending')).toBe(true);
  });

  it('이력을 보려면 `status`를 명시한다', async () => {
    await userRequest(ALICE, SLUG);
    const listed = await adminList('?status=pending');
    const requestId = String((listed.body['items'] as readonly Record<string, unknown>[])[0]?.['request_id']);
    await adminDismiss(requestId, { action: 'dismiss', reason: '종료한다' });

    const dismissed = await adminList('?status=dismissed');
    expect((dismissed.body['items'] as readonly unknown[])).toHaveLength(1);
  });

  it('`operator`가 아니면 목록을 볼 수 없다', async () => {
    await userRequest(ALICE, SLUG);
    const denied = await call(ALICE, 'GET', REGISTRATION_REQUESTS_ADMIN_PATH);
    expect(denied.status).toBe(403);
  });

  it('전체 수를 내지 않는다 — `next_cursor`가 "더 있는가"를 답한다', async () => {
    await userRequest(ALICE, SLUG);
    await userRequest(BOB, SLUG);
    const { body } = await adminList('?limit=1');
    expect(body['total']).toBeUndefined();
    expect(body['next_cursor']).toEqual(expect.any(String));

    const second = await adminList(`?limit=1&cursor=${encodeURIComponent(String(body['next_cursor']))}`);
    expect((second.body['items'] as readonly unknown[])).toHaveLength(1);
    expect(second.body['next_cursor']).toBeNull();
  });

  it('커서를 쓴 뒤 조건이 달라지면 `CURSOR_QUERY_MISMATCH`다', async () => {
    await userRequest(ALICE, SLUG);
    await userRequest(BOB, SLUG);
    const first = await adminList('?limit=1&status=pending');
    const cursor = encodeURIComponent(String(first.body['next_cursor']));

    const mismatched = await adminList(`?limit=1&status=dismissed&cursor=${cursor}`);
    expect(mismatched.status).toBe(400);
    expect(errorCode(mismatched)).toBe('CURSOR_QUERY_MISMATCH');
  });

  it('훼손된 커서는 `CURSOR_INVALID`다 — 두 코드를 섞지 않는다', async () => {
    const broken = await adminList('?cursor=not-a-real-cursor');
    expect(broken.status).toBe(400);
    expect(errorCode(broken)).toBe('CURSOR_INVALID');
  });
});

describe('종료 (dismiss)', () => {
  it('사유와 함께 종료하고 처리자·시각을 남긴다', async () => {
    await userRequest(ALICE, SLUG);
    const listed = await adminList('?status=pending');
    const requestId = String((listed.body['items'] as readonly Record<string, unknown>[])[0]?.['request_id']);

    const { status, body } = await adminDismiss(requestId, { action: 'dismiss', reason: '사내 저장소가 아니다' });
    expect(status).toBe(200);
    expect(body['status']).toBe('dismissed');

    const rows = await rowsFor(SLUG);
    expect(rows[0]?.status).toBe('dismissed');
    expect(rows[0]?.resolved_by).toBe(OPERATOR);
    expect(rows[0]?.resolution_note).toBe('사내 저장소가 아니다');
    expect(rows[0]?.resolved_at).not.toBeNull();
  });

  it('종료가 감사에 남고 메모는 `query` 칸으로 간다 (PR #88 리뷰 P1)', async () => {
    await userRequest(ALICE, SLUG);
    const listed = await adminList('?status=pending');
    const requestId = String((listed.body['items'] as readonly Record<string, unknown>[])[0]?.['request_id']);
    await adminDismiss(requestId, { action: 'dismiss', reason: '대상이 아니다' });

    const audit = await pool.query<{ action: string; target: string | null; query: string | null; result_code: string | null }>(
      `SELECT action, target, query, result_code FROM audit_record
        WHERE user_id = $1 AND action = 'repository_registration_request.dismiss'`,
      [OPERATOR],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]?.target).toBe(requestId);
    expect(audit.rows[0]?.query).toBe('대상이 아니다');
    expect(audit.rows[0]?.result_code).toBe('dismissed');
  });

  it('`dismiss` 밖의 동작은 받지 않는다 — 승인은 성공한 등록이다', async () => {
    await userRequest(ALICE, SLUG);
    const listed = await adminList('?status=pending');
    const requestId = String((listed.body['items'] as readonly Record<string, unknown>[])[0]?.['request_id']);

    const approved = await adminDismiss(requestId, { action: 'approve' });
    expect(approved.status).toBe(400);
    expect((await rowsFor(SLUG))[0]?.status).toBe('pending');
  });

  it('이미 종료된 요청은 다시 종료되지 않고 현재 상태를 알려 준다', async () => {
    await userRequest(ALICE, SLUG);
    const listed = await adminList('?status=pending');
    const requestId = String((listed.body['items'] as readonly Record<string, unknown>[])[0]?.['request_id']);
    await adminDismiss(requestId, { action: 'dismiss', reason: '한 번' });

    const twice = await adminDismiss(requestId, { action: 'dismiss', reason: '두 번' });
    expect(twice.status).toBe(400);
    expect(errorDetail(twice)).toMatchObject({ status: 'dismissed' });
    expect((await rowsFor(SLUG))[0]?.resolution_note).toBe('한 번');
  });

  it('상한을 넘는 메모는 거절되고 요청은 그대로 열려 있다', async () => {
    await userRequest(ALICE, SLUG);
    const listed = await adminList('?status=pending');
    const requestId = String((listed.body['items'] as readonly Record<string, unknown>[])[0]?.['request_id']);

    const tooLong = await adminDismiss(requestId, { action: 'dismiss', reason: 'x'.repeat(501) });
    expect(tooLong.status).toBe(400);
    expect((await rowsFor(SLUG))[0]?.status).toBe('pending');
  });
});

describe('등록이 요청을 종료한다 (AC-11)', () => {
  it('등록 성공이 같은 식별자의 `pending` 전부를 `fulfilled`로 옮긴다', async () => {
    await userRequest(ALICE, SLUG);
    await userRequest(BOB, SLUG);
    expect((await rowsFor(SLUG)).every((row) => row.status === 'pending')).toBe(true);

    const registered = await register(SLUG);
    expect(registered.status).toBe(201);

    const rows = await rowsFor(SLUG);
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.status)).toEqual(['fulfilled', 'fulfilled']);
    expect(rows.every((row) => row.resolved_by === OPERATOR)).toBe(true);
    expect(rows.every((row) => row.resolved_at !== null)).toBe(true);
    // 종료 사유는 "등록됐다"이며 그것은 `status`가 말한다. 기계가 쓴 메모를 남기지 않는다.
    expect(rows.every((row) => row.resolution_note === null)).toBe(true);
  });

  it('이미 종료된 요청은 등록이 다시 건드리지 않는다', async () => {
    await userRequest(ALICE, SLUG);
    await userRequest(BOB, SLUG);
    const listed = await adminList('?status=pending');
    const items = listed.body['items'] as readonly Record<string, unknown>[];
    const aliceRow = items.find((item) => item['requested_by'] === ALICE);
    await adminDismiss(String(aliceRow?.['request_id']), { action: 'dismiss', reason: '중복 요청' });

    await register(SLUG);

    const rows = await rowsFor(SLUG);
    const alice = rows.find((row) => row.requested_by === ALICE);
    const bob = rows.find((row) => row.requested_by === BOB);
    expect(alice?.status).toBe('dismissed');
    expect(alice?.resolution_note).toBe('중복 요청');
    expect(bob?.status).toBe('fulfilled');
  });

  it('**등록이 실패하면 요청은 `pending`으로 남는다**', async () => {
    await userRequest(ALICE, DENIED_SLUG);
    const denied = await register(DENIED_SLUG);
    expect(denied.status).toBe(403);

    expect((await rowsFor(DENIED_SLUG))[0]?.status).toBe('pending');
    const repository = await repositoryRepo.findRepositoryBySlug(pool, OWNER, 'denied');
    expect(repository).toBeUndefined();
  });

  it('요청 없이도 등록된다 — 0건 종료는 정상이다', async () => {
    const registered = await register(SLUG);
    expect(registered.status).toBe(201);
    expect(await rowsFor(SLUG)).toHaveLength(0);
  });
});

describe('종료를 되돌리지 않는다', () => {
  it('`dismissed` 요청을 일반 사용자의 재요청이 다시 열지 않는다', async () => {
    await userRequest(ALICE, SLUG);
    const listed = await adminList('?status=pending');
    const requestId = String((listed.body['items'] as readonly Record<string, unknown>[])[0]?.['request_id']);
    await adminDismiss(requestId, { action: 'dismiss', reason: '대상이 아니다' });

    const again = await userRequest(ALICE, SLUG);
    expect(again.status).toBe(201);

    const rows = await rowsFor(SLUG);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe('dismissed');
    expect(rows[0]?.resolution_note).toBe('대상이 아니다');
    expect(rows[0]?.resolved_by).toBe(OPERATOR);
  });

  it('`fulfilled` 요청도 재요청으로 되돌아가지 않는다', async () => {
    await userRequest(ALICE, SLUG);
    await register(SLUG);
    expect((await rowsFor(SLUG))[0]?.status).toBe('fulfilled');

    await userRequest(ALICE, SLUG);
    expect((await rowsFor(SLUG))[0]?.status).toBe('fulfilled');
  });

  it('종료된 요청의 처리 결과가 요청자에게 돌아가지 않는다 (AC-10)', async () => {
    await userRequest(ALICE, SLUG);
    const listed = await adminList('?status=pending');
    const requestId = String((listed.body['items'] as readonly Record<string, unknown>[])[0]?.['request_id']);
    await adminDismiss(requestId, { action: 'dismiss', reason: '비공개 저장소다' });

    const { body } = await userRequest(ALICE, SLUG);
    expect(JSON.stringify(body)).not.toContain('비공개 저장소다');
    expect(body['status']).toBeUndefined();
    expect(body['resolved_by']).toBeUndefined();
  });
});

describe('정본 쓰기와 요청 종료의 경계', () => {
  it('한 트랜잭션이라 중간 실패가 저장소도 요청도 남기지 않는다', async () => {
    await userRequest(ALICE, SLUG);

    await expect(
      withTransaction(pool, async (client) => {
        await repositoryRepo.upsertRepository(client, {
          repository_id: REPOSITORY_ID,
          owner: OWNER,
          name: NAME,
          org_id: 9040,
          visibility: 'internal',
          sequence_branches: [],
          status: 'active',
        });
        await registrationRequestRepo.fulfillPendingForSlug(client, OWNER, NAME, OPERATOR);
        throw new Error('경계 안에서 실패한다');
      }),
    ).rejects.toThrow('경계 안에서 실패한다');

    // 저장소도 서지 않았고 요청도 열려 있다 — 둘 중 하나만 남는 상태가 없다.
    expect(await repositoryRepo.findRepositoryBySlug(pool, OWNER, NAME)).toBeUndefined();
    expect((await rowsFor(SLUG))[0]?.status).toBe('pending');
  });

  it('성공한 등록 뒤에는 저장소가 `active`이고 요청이 열려 있지 않다', async () => {
    await userRequest(ALICE, SLUG);
    await register(SLUG);

    const repository = await repositoryRepo.findRepositoryBySlug(pool, OWNER, NAME);
    expect(repository?.status).toBe('active');
    expect((await rowsFor(SLUG)).some((row) => row.status === 'pending')).toBe(false);
  });
});
