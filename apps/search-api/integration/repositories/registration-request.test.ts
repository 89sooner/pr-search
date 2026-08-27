/**
 * 저장소 등록 검토 요청 (API-ING-003 / FR-ING-009 AC-8·9·10, WP-034 / CR-050).
 *
 * ## 이 파일이 반증하는 결함
 *
 * 1. **존재 신탁** — 이 경로가 GitHub Enterprise에 물어 "있다/없다"를 구분하면
 *    비공개 저장소의 존재가 샌다 (THR-041). 응답 모양이 그것을 가르지 않는지
 *    본다.
 * 2. **중복 행** — 같은 사용자의 같은 식별자 반복 요청이 실패가 되거나 행을
 *    늘리면 안 된다 (AC-9).
 * 3. **클라이언트 입력 신뢰** — 계약 밖 필드가 등록 계약으로 흘러들면 안 된다.
 * 4. **보존 정책** — 사용자를 지우면 요청도 사라져야 한다.
 *
 * 실행: `pnpm test:integration repositories/registration-request`
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
import type { Client } from '@elastic/elasticsearch';
import { authRepo, repositoryRepo, type Pool } from '@prs/db';
import type { Redis } from '@prs/bus';
import { buildServer } from '../../src/server.js';
import { REGISTRATION_REQUESTS_PATH } from '../../src/repositories/routes.js';
import type { AuthContext, AuthRedis } from '../../src/auth/context.js';
import { createTestRedis, migratedPool } from '../helpers.js';
import { TEST_CURSOR_KEY, TEST_CURSOR_SIGNER } from '../_cursor-fixture.js';

const AUTH_CONFIG = {
  enabled: true,
  cookieSecure: true,
  loginPath: '/auth/login',
  groupRoleMap: new Map<string, never>(),
} as const;

const ALICE = 'sub-wp034-req-alice';
const BOB = 'sub-wp034-req-bob';
const USERS = [ALICE, BOB];

/**
 * **실제로 등록된 저장소.** 존재 비노출을 재려면 있는 것과 없는 것을 비교해야
 * 한다 — 둘 다 없는 슬러그로 비교하면 어떤 존재 확인 분기도 같은 답을 내고,
 * 그 시험은 통과하면서 아무것도 지키지 않는다 (M6 변이가 이 구멍을 드러냈다).
 */
const EXISTING_REPO = 90740;
const EXISTING_SLUG = 'wp034q/registered';
const MISSING_SLUG = 'zzz-nonexistent/zzz-nonexistent';

let pool: Pool;
let redis: Redis;
let es: Client;
let app: FastifyInstance;
const cookies = new Map<string, Record<string, string>>();

function redisPort(): AuthRedis {
  return {
    get: (key) => redis.get(key),
    set: (key, value, mode, seconds) => redis.set(key, value, mode, seconds),
    del: (...keys) => redis.del(...keys),
    scan: (cursor, m, pattern, c, n) => redis.scan(cursor, m, pattern, c, n),
  };
}

async function request(
  user: string,
  body: Record<string, unknown>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await app.inject({
    method: 'POST',
    url: REGISTRATION_REQUESTS_PATH,
    headers: { ...(cookies.get(user) ?? {}), 'content-type': 'application/json' },
    payload: body,
  });
  return { status: response.statusCode, body: response.json<Record<string, unknown>>() };
}

async function countRows(userId: string): Promise<number> {
  const result = await pool.query<{ count: number }>(
    'SELECT count(*)::int AS count FROM repository_registration_request WHERE requested_by = $1',
    [userId],
  );
  return result.rows[0]?.count ?? 0;
}

beforeAll(async () => {
  pool = await migratedPool();
  redis = createTestRedis();
  es = createEsClient(resolveClientOptions());

  await pool.query('DELETE FROM repository_registration_request WHERE requested_by = ANY($1::text[])', [USERS]);
  await pool.query('DELETE FROM permission_cache WHERE user_id = ANY($1::text[])', [USERS]);
  await pool.query('DELETE FROM app_user WHERE user_id = ANY($1::text[])', [USERS]);

  for (const userId of USERS) {
    await authRepo.upsertUserOnLogin(pool, { user_id: userId, login: userId });
  }

  await pool.query('DELETE FROM repository WHERE repository_id = $1', [EXISTING_REPO]);
  await repositoryRepo.upsertRepository(pool, {
    repository_id: EXISTING_REPO,
    owner: 'wp034q',
    name: 'registered',
    org_id: 9074,
    visibility: 'private',
    sequence_branches: [],
  });

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
      roles: ['developer'],
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
    search: {
      es,
      cursorSigner: TEST_CURSOR_SIGNER,
      resolveNames: async () => ({ orgIds: new Map(), teamIds: new Map() }),
      resolveTeamSlugs: (ids) => authRepo.resolveTeamSlugs(pool, ids),
    },
    repositories: { pool, es, cursorSigner: TEST_CURSOR_SIGNER },
  });
  await app.ready();
}, 180_000);

beforeEach(async () => {
  await pool.query('DELETE FROM repository_registration_request WHERE requested_by = ANY($1::text[])', [USERS]);
});

afterAll(async () => {
  await pool?.query('DELETE FROM repository WHERE repository_id = $1', [EXISTING_REPO]);
  await pool?.query('DELETE FROM repository_registration_request WHERE requested_by = ANY($1::text[])', [USERS]);
  await pool?.query('DELETE FROM permission_cache WHERE user_id = ANY($1::text[])', [USERS]);
  await pool?.query('DELETE FROM app_user WHERE user_id = ANY($1::text[])', [USERS]);
  await app?.close();
  await es?.close();
  redis?.disconnect();
  await pool?.end();
});

describe('기록 (AC-8)', () => {
  it('요청을 남기면 201과 기록 사실만 돌려준다', async () => {
    const { status, body } = await request(ALICE, { repository: 'acme/payments' });
    expect(status).toBe(201);
    expect(body['repository']).toBe('acme/payments');
    expect(body['request_id']).toBeDefined();
    expect(await countRows(ALICE)).toBe(1);
  });

  it('**등록하지 않는다** — 저장소 표에 행이 생기지 않는다', async () => {
    await request(ALICE, { repository: 'acme/never-registered' });
    const result = await pool.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM repository WHERE owner = 'acme' AND name = 'never-registered'",
    );
    expect(result.rows[0]?.count).toBe(0);
  });

  it('**응답이 대상의 실재 여부를 말하지 않는다** (AC-10, THR-041)', async () => {
    /*
     * **실제로 등록된 저장소와 없는 저장소를 비교한다.** 둘 다 없는 슬러그를
     * 쓰면 어떤 존재 확인 분기도 같은 답을 내므로 이 시험이 아무것도 지키지
     * 않는다 — M6 변이가 그 구멍을 드러냈다.
     */
    const real = await request(ALICE, { repository: EXISTING_SLUG });
    const fake = await request(ALICE, { repository: MISSING_SLUG });

    expect(fake.status).toBe(real.status);

    // 필드 집합이 같아야 한다 — 하나라도 다르면 그것이 신탁이 된다.
    expect(Object.keys(fake.body).sort()).toEqual(Object.keys(real.body).sort());

    // 값도 존재 여부를 드러내지 않는다. 다른 것은 요청 자체의 식별자뿐이다.
    const IDENTITY_FIELDS = new Set(['request_id', 'repository', 'created_at', 'correlation_id']);
    const shape = (body: Record<string, unknown>): Record<string, unknown> =>
      Object.fromEntries(Object.entries(body).filter(([key]) => !IDENTITY_FIELDS.has(key)));
    expect(shape(fake.body), '남은 필드가 존재 여부를 말하면 THR-041이다').toEqual(shape(real.body));
  });
});

describe('멱등 (AC-9)', () => {
  it('**같은 사용자의 같은 식별자 반복 요청이 행 하나로 남는다**', async () => {
    const first = await request(ALICE, { repository: 'acme/payments' });
    const second = await request(ALICE, { repository: 'acme/payments' });
    expect(second.status).toBe(201);
    expect(second.body['request_id']).toBe(first.body['request_id']);
    expect(await countRows(ALICE)).toBe(1);
  });

  it('**최초 요청 시각이 보존된다** — 재요청이 시각을 덮지 않는다', async () => {
    const first = await request(ALICE, { repository: 'acme/payments' });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const second = await request(ALICE, { repository: 'acme/payments' });
    expect(second.body['created_at']).toBe(first.body['created_at']);
  });

  it('다른 사용자의 같은 저장소는 각자의 기록이다', async () => {
    await request(ALICE, { repository: 'acme/payments' });
    await request(BOB, { repository: 'acme/payments' });
    expect(await countRows(ALICE)).toBe(1);
    expect(await countRows(BOB)).toBe(1);
  });

  it('**동시 요청도 하나로 남는다** — count 뒤 INSERT 형태가 아니다', async () => {
    const [a, b] = await Promise.all([
      request(ALICE, { repository: 'acme/concurrent' }),
      request(ALICE, { repository: 'acme/concurrent' }),
    ]);
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(await countRows(ALICE)).toBe(1);
  });
});

describe('입력 검증', () => {
  it.each([
    ['빈 문자열', ''],
    ['슬래시 없음', 'payments'],
    ['조각이 셋', 'a/b/c'],
    ['소유자 없음', '/payments'],
    ['이름 없음', 'acme/'],
    ['숫자', 42],
  ])('%s는 400이다', async (_label, value) => {
    const { status, body } = await request(ALICE, { repository: value });
    expect(status).toBe(400);
    expect((body['error'] as { code?: string } | undefined)?.code).toBe('INVALID_PARAMETER');
  });

  it('**조각 길이 상한을 넘으면 400이다** — 실재를 확인하지 않는 표가 임의 문자열 저장소가 되지 않는다', async () => {
    const long = 'x'.repeat(101);
    const { status } = await request(ALICE, { repository: `acme/${long}` });
    expect(status).toBe(400);
  });

  it('**계약 밖 필드를 신뢰하지 않는다** — 등록 계약이 클라이언트 입력으로 열리지 않는다', async () => {
    const { status } = await request(ALICE, {
      repository: 'acme/payments',
      repository_id: 999999,
      org_id: 1,
      visibility: 'public',
      sequence_branches: ['main'],
      mirror_enabled: true,
      backfill: true,
    });
    expect(status).toBe(201);

    const row = await pool.query<Record<string, unknown>>(
      'SELECT * FROM repository_registration_request WHERE requested_by = $1',
      [ALICE],
    );
    expect(row.rows).toHaveLength(1);

    /*
     * **표에 그 값들을 담을 열 자체가 없다.** 열 목록을 실측해서 건다 —
     * `SELECT`가 고른 열만 보면 "안 담겼다"가 아니라 "안 물어봤다"를 재는 것이
     * 되고, 나중에 누가 열을 더해도 이 시험이 통과한다.
     */
    const columns = await pool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = 'repository_registration_request'`,
    );
    const names = columns.rows.map((one) => one.column_name).sort();
    expect(names).toEqual([
      'created_at',
      'repository_name',
      'repository_owner',
      'request_id',
      'requested_by',
    ]);
    for (const forbidden of ['repository_id', 'org_id', 'visibility', 'sequence_branches']) {
      expect(names, `${forbidden} 열이 생기면 등록 계약이 클라이언트 입력으로 열린다`).not.toContain(
        forbidden,
      );
    }
  });
});

describe('보존 정책', () => {
  it('**사용자를 지우면 요청도 사라진다** (ON DELETE CASCADE)', async () => {
    await request(BOB, { repository: 'acme/payments' });
    expect(await countRows(BOB)).toBe(1);

    await pool.query('DELETE FROM permission_cache WHERE user_id = $1', [BOB]);
    await pool.query('DELETE FROM app_user WHERE user_id = $1', [BOB]);
    expect(await countRows(BOB)).toBe(0);

    // 뒤이은 시험을 위해 되살린다.
    await authRepo.upsertUserOnLogin(pool, { user_id: BOB, login: BOB });
  });
});

describe('인증', () => {
  it('세션이 없으면 401이고 아무것도 기록되지 않는다', async () => {
    const response = await app.inject({
      method: 'POST',
      url: REGISTRATION_REQUESTS_PATH,
      headers: { 'content-type': 'application/json' },
      payload: { repository: 'acme/payments' },
    });
    expect(response.statusCode).toBe(401);
    const result = await pool.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM repository_registration_request WHERE repository_name = 'payments'",
    );
    expect(result.rows[0]?.count).toBe(0);
  });
});
