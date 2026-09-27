/**
 * CR-125 — 관리 목록 두 개의 커서가 마이크로초 정밀도를 끝까지 지킨다 (DEV-777).
 *
 * 등록 요청 대기열(API-ADM-009)과 감사 기록(API-ADM-005)은 `created_at`·`occurred_at`
 * (`timestamptz`, 마이크로초) 내림차순 + ID 내림차순으로 키셋 순회한다. 커서가 그 시각을
 * JavaScript `Date`의 `toISOString()`(밀리초)으로 실으면, 경계 행과 같은 밀리초 안의 더 이른
 * 행은 `(시각, ID) < (잘린 시각, ID)` 비교에서 커서보다 큰 값이 되어 **다음 쪽에서 사라진다.**
 *
 * **실제 PostgreSQL을 쓴다.** 누락은 PostgreSQL의 행 값 비교와 node-postgres의 시각 파싱이 만든다
 * — 대역으로는 재현되지 않는다. 시험 자료의 시각은 SQL로 직접 넣는다(같은 밀리초 안의 마이크로초
 * 차이, 완전히 같은 시각). 빠르게 연달아 요청하거나 대기 시간을 넣어 우연에 맡기지 않는다.
 * 기대 순서도 PostgreSQL이 정한 `ORDER BY`에서 읽는다 — 시험이 순서를 다시 계산하지 않는다.
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
import { RedisStreamsEventBus, type Redis } from '@prs/bus';
import { authRepo, createPool, resolvePoolConfig, type Pool } from '@prs/db';
import { buildServer } from '../../src/server.js';
import { REGISTRATION_REQUESTS_ADMIN_PATH } from '../../src/ops/routes.js';
import { AUDIT_RECORDS_PATH } from '../../src/audit/routes.js';
import { DEFAULT_REQUEST_PAGE_SIZE, parseRequestFilter } from '../../src/ops/registration-requests.js';
import { computeRequestFingerprint } from '../../src/ops/registration-request-cursor.js';
import { computeAuditFingerprint } from '../../src/audit/cursor.js';
import { CURSOR_TTL_MS, decodeEnvelope, encodeEnvelope } from '../../src/cursor/envelope.js';
import type { AuthContext, AuthRedis } from '../../src/auth/context.js';
import { createTestRedis, migratedPool } from '../helpers.js';
import { TEST_CURSOR_KEY, TEST_CURSOR_SIGNER } from '../_cursor-fixture.js';

const NS = 'cr125-cursor';
const OPERATOR = `${NS}-operator`;
const OFFICER = `${NS}-officer`;
const DEVELOPER = `${NS}-developer`;
const REQUESTER = `${NS}-requester`;
/** 감사 기록의 행위자. 조회 자체가 남기는 `audit.view`(행위자 OFFICER)와 섞이지 않게 따로 둔다. */
const ACTOR = `${NS}-actor`;
const USERS = [OPERATOR, OFFICER, DEVELOPER, REQUESTER, ACTOR];
const OWNER = 'cr125own';

/**
 * 같은 밀리초 안의 마이크로초 차이 넷, 완전히 같은 시각 두 쌍, 앞뒤 밀리초·초 경계.
 * 파티션이 있는 달(`fixtureMonths`)에 둔다 — 감사 기록은 월 파티션이다.
 */
const TIMES = [
  '2026-08-26T10:00:00.124000Z',
  '2026-08-26T10:00:00.123999Z',
  '2026-08-26T10:00:00.123500Z',
  '2026-08-26T10:00:00.123500Z',
  '2026-08-26T10:00:00.123001Z',
  '2026-08-26T10:00:00.123000Z',
  '2026-08-26T10:00:00.122999Z',
  '2026-08-26T10:00:00.000001Z',
  '2026-08-26T09:59:59.999999Z',
  '2026-08-26T09:59:59.999999Z',
] as const;

let pool: Pool;
/** 서버가 쓰는 연결 — UTC가 아닌 세션 시간대로 연다(아래 `nonUtcPool`). */
let appPool: Pool;
let redis: Redis;
let bus: RedisStreamsEventBus;
let app: FastifyInstance;
let sessions: SessionStore;
const cookies = new Map<string, string>();

/**
 * 서버가 쓰는 연결을 **UTC가 아닌 세션 시간대**로 연다 (CR-125 독립 리뷰 지적).
 *
 * 키셋 문자열의 `AT TIME ZONE 'UTC'`는 세션 시간대와 무관하게 UTC 벽시계를 내게 하는 유일한 장치다.
 * 시험 DB의 기본 시간대(UTC)로만 돌리면 그 절을 지워도 결과가 같아 결함을 놓친다 — 비UTC 세션에서는
 * 지역 벽시계에 `Z`를 붙인 거짓 UTC가 커서에 실려 `::timestamptz`가 다른 순간으로 읽는다.
 * 풀에서는 연결마다 `SET`이 보장되지 않으므로 연결 옵션으로 건다.
 */
function nonUtcPool(): Pool {
  const env = { ...process.env };
  if (env['DATABASE_URL'] === undefined || env['DATABASE_URL'] === '') {
    env['POSTGRES_DB'] = env['POSTGRES_TEST_DB'] ?? 'prs_test';
  }
  return createPool({ ...resolvePoolConfig(env), options: '-c timezone=Asia/Seoul' });
}

function redisPort(): AuthRedis {
  return {
    get: (key) => redis.get(key),
    set: (key, value, mode, seconds) => redis.set(key, value, mode, seconds),
    del: (...keys) => redis.del(...keys),
    scan: (cursor, m, pattern, c, n) => redis.scan(cursor, m, pattern, c, n),
  };
}

async function login(userId: string, roles: readonly string[]): Promise<void> {
  const sessionId = createSessionId();
  await sessions.create({
    sessionId,
    userId,
    login: userId,
    email: null,
    roles,
    issuedAt: Date.now(),
    lastSeenAt: Date.now(),
    correlationId: null,
  });
  cookies.set(userId, `${SESSION_COOKIE_NAME}=${sessionId}`);
}

interface Page {
  readonly status: number;
  readonly code: unknown;
  readonly detail: unknown;
  readonly body: Record<string, unknown>;
  readonly labels: readonly string[];
  readonly next: string | null;
}

async function get(user: string | null, url: string, label: (item: Record<string, unknown>) => string): Promise<Page> {
  const response = await app.inject({
    method: 'GET',
    url,
    headers: user === null ? {} : { cookie: cookies.get(user) ?? '' },
  });
  const body = response.json<Record<string, unknown>>();
  const items = (body['items'] as readonly Record<string, unknown>[] | undefined) ?? [];
  return {
    status: response.statusCode,
    code: (body['error'] as Record<string, unknown> | undefined)?.['code'],
    detail: (body['error'] as Record<string, unknown> | undefined)?.['detail'],
    body,
    labels: items.map(label),
    next: typeof body['next_cursor'] === 'string' ? body['next_cursor'] : null,
  };
}

/** 첫 쪽부터 `next_cursor`가 끝날 때까지 읽는다. 페이지 수에 상한을 둬 순환을 막는다. */
async function readAll(
  first: string,
  withCursor: (cursor: string) => string,
  user: string,
  label: (item: Record<string, unknown>) => string,
): Promise<{ readonly labels: readonly string[]; readonly pages: number }> {
  const labels: string[] = [];
  let url = first;
  for (let pages = 1; pages <= 100; pages += 1) {
    const page = await get(user, url, label);
    expect(page.status, `${url} → ${String(page.code)}`).toBe(200);
    labels.push(...page.labels);
    if (page.next === null) return { labels, pages };
    url = withCursor(page.next);
  }
  throw new Error('100쪽을 넘었다 — 커서가 끝나지 않는다');
}

/* ------------------------------------------------------------------------- */
/* 등록 요청 대기열                                                            */
/* ------------------------------------------------------------------------- */

const requestLabel = (item: Record<string, unknown>): string => String(item['request_id']);
const requestQuery = (limit: number | null): string =>
  `${REGISTRATION_REQUESTS_ADMIN_PATH}?requested_by=${REQUESTER}${limit === null ? '' : `&limit=${String(limit)}`}`;

async function seedRequests(): Promise<readonly string[]> {
  for (const [index, at] of TIMES.entries()) {
    await pool.query(
      `INSERT INTO repository_registration_request (requested_by, repository_owner, repository_name, created_at)
       VALUES ($1, $2, $3, $4::timestamptz)`,
      [REQUESTER, OWNER, `repo-${String(index).padStart(2, '0')}`, at],
    );
  }
  // 출력 열 이름을 바꾼다 — `request_id::text`를 같은 이름으로 내면 `ORDER BY request_id`가 그 **문자열**
  // 출력 열을 가리켜 '9'가 '10' 뒤로 간다(PostgreSQL은 이름이 겹치면 출력 열을 고른다). 새 DB에서 ID가
  // 한 자리에서 두 자리로 넘어갈 때만 드러났다.
  const expected = await pool.query<{ label: string }>(
    `SELECT request_id::text AS label FROM repository_registration_request
      WHERE requested_by = $1 AND status = 'pending'
      ORDER BY created_at DESC, request_id DESC`,
    [REQUESTER],
  );
  return expected.rows.map((row) => row.label);
}

/* ------------------------------------------------------------------------- */
/* 감사 기록                                                                   */
/* ------------------------------------------------------------------------- */

const auditLabel = (item: Record<string, unknown>): string => String(item['query']);
const auditQuery = (limit: number | null): string =>
  `${AUDIT_RECORDS_PATH}?user_id=${ACTOR}${limit === null ? '' : `&limit=${String(limit)}`}`;

async function seedAudit(): Promise<readonly string[]> {
  for (const [index, at] of TIMES.entries()) {
    await pool.query(
      `INSERT INTO audit_record (user_id, action, target, query, result_code, correlation_id, occurred_at)
       VALUES ($1, 'search.execute', NULL, $2, 'ok', gen_random_uuid(), $3::timestamptz)`,
      [ACTOR, `row-${String(index).padStart(2, '0')}`, at],
    );
  }
  const expected = await pool.query<{ query: string }>(
    `SELECT query FROM audit_record WHERE user_id = $1 ORDER BY occurred_at DESC, audit_id DESC`,
    [ACTOR],
  );
  return expected.rows.map((row) => row.query);
}

/* ------------------------------------------------------------------------- */

beforeAll(async () => {
  pool = await migratedPool({ fixtureMonths: ['2026-08'] });
  appPool = nonUtcPool();
  // 옵션이 실제로 걸렸는지 본다 — 조용히 UTC로 돌면 이 파일의 시간대 방어가 무의미하다.
  const zone = await appPool.query<{ TimeZone: string }>('SHOW timezone');
  expect(zone.rows[0]?.TimeZone).toBe('Asia/Seoul');
  redis = createTestRedis();
  bus = new RedisStreamsEventBus(redis);
  sessions = new SessionStore({ redis: redisPort() });

  await pool.query('DELETE FROM repository_registration_request WHERE requested_by = ANY($1::text[])', [USERS]);
  await pool.query('DELETE FROM audit_record WHERE user_id = ANY($1::text[])', [USERS]);
  await pool.query('DELETE FROM permission_cache WHERE user_id = ANY($1::text[])', [USERS]);
  await pool.query('DELETE FROM app_user WHERE user_id = ANY($1::text[])', [USERS]);
  for (const userId of USERS) await authRepo.upsertUserOnLogin(pool, { user_id: userId, login: userId });
  await authRepo.setAssignedRoles(pool, OPERATOR, ['operator']);
  await authRepo.setAssignedRoles(pool, OFFICER, ['security_officer']);

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

  app = buildServer({
    config: {
      port: 0,
      adminTokens: [],
      metricsQueryUrl: null,
      gheBaseUrl: null,
      auth: { enabled: true, cookieSecure: true, loginPath: '/auth/login', groupRoleMap: new Map<string, never>() },
      searchCursorKey: TEST_CURSOR_KEY,
    },
    auth,
    ops: { pool: appPool, bus },
    requestQueue: { pool: appPool, cursorSigner: TEST_CURSOR_SIGNER },
    audit: { pool: appPool, cursorSigner: TEST_CURSOR_SIGNER },
  });
  await app.ready();

  await login(OPERATOR, ['developer', 'operator']);
  await login(OFFICER, ['developer', 'security_officer']);
  await login(DEVELOPER, ['developer']);
}, 180_000);

beforeEach(async () => {
  await pool.query('DELETE FROM repository_registration_request WHERE requested_by = ANY($1::text[])', [USERS]);
  await pool.query('DELETE FROM audit_record WHERE user_id = ANY($1::text[])', [USERS]);
});

afterAll(async () => {
  await pool?.query('DELETE FROM repository_registration_request WHERE requested_by = ANY($1::text[])', [USERS]);
  await pool?.query('DELETE FROM audit_record WHERE user_id = ANY($1::text[])', [USERS]);
  await app?.close();
  await redis?.quit();
  await appPool?.end();
  await pool?.end();
});

describe('등록 요청 대기열 — 고정 자료를 끝까지 읽으면 모든 요청이 정확히 한 번 나온다 (API-ADM-009)', () => {
  for (const limit of [1, 2, 3, null] as const) {
    it(`limit=${limit === null ? `기본(${String(DEFAULT_REQUEST_PAGE_SIZE)})` : String(limit)}`, async () => {
      const expected = await seedRequests();
      expect(expected).toHaveLength(TIMES.length);
      const { labels, pages } = await readAll(
        requestQuery(limit),
        (cursor) => `${requestQuery(limit)}&cursor=${encodeURIComponent(cursor)}`,
        OPERATOR,
        requestLabel,
      );
      expect(labels).toEqual(expected);
      expect(pages).toBe(limit === null ? 1 : Math.ceil(TIMES.length / limit));
    });
  }
});

describe('감사 기록 — 고정 자료를 끝까지 읽으면 모든 기록이 정확히 한 번 나온다 (API-ADM-005)', () => {
  for (const limit of [1, 2, 3, null] as const) {
    it(`limit=${limit === null ? '기본' : String(limit)}`, async () => {
      const expected = await seedAudit();
      expect(expected).toHaveLength(TIMES.length);
      const { labels, pages } = await readAll(
        auditQuery(limit),
        (cursor) => `${auditQuery(limit)}&cursor=${encodeURIComponent(cursor)}`,
        OFFICER,
        auditLabel,
      );
      expect(labels).toEqual(expected);
      expect(pages).toBe(limit === null ? 1 : Math.ceil(TIMES.length / limit));
    });
  }
});

describe('커서 보호와 권한은 그대로다', () => {
  it('등록 요청: 조건을 바꾸면 `CURSOR_QUERY_MISMATCH`, 훼손된 커서는 `CURSOR_INVALID`', async () => {
    await seedRequests();
    const first = await get(OPERATOR, requestQuery(1), requestLabel);
    expect(first.next).not.toBeNull();
    const mismatch = await get(
      OPERATOR,
      `${requestQuery(1)}&status=dismissed&cursor=${encodeURIComponent(first.next ?? '')}`,
      requestLabel,
    );
    expect([mismatch.status, mismatch.code]).toEqual([400, 'CURSOR_QUERY_MISMATCH']);
    const broken = await get(OPERATOR, `${requestQuery(1)}&cursor=not-a-real-cursor`, requestLabel);
    expect([broken.status, broken.code]).toEqual([400, 'CURSOR_INVALID']);
  });

  it('감사 기록: 조건을 바꾸면 `CURSOR_QUERY_MISMATCH`, 훼손된 커서는 `CURSOR_INVALID`', async () => {
    await seedAudit();
    const first = await get(OFFICER, auditQuery(1), auditLabel);
    expect(first.next).not.toBeNull();
    const mismatch = await get(
      OFFICER,
      `${auditQuery(1)}&action=entity.view&cursor=${encodeURIComponent(first.next ?? '')}`,
      auditLabel,
    );
    expect([mismatch.status, mismatch.code]).toEqual([400, 'CURSOR_QUERY_MISMATCH']);
    const broken = await get(OFFICER, `${auditQuery(1)}&cursor=forged.signature`, auditLabel);
    expect([broken.status, broken.code]).toEqual([400, 'CURSOR_INVALID']);
  });

  it('등록 요청은 운영자만, 감사 기록은 보안 담당자만 읽는다', async () => {
    expect((await get(DEVELOPER, requestQuery(1), requestLabel)).status).toBe(403);
    expect((await get(OFFICER, requestQuery(1), requestLabel)).status).toBe(403);
    expect((await get(null, requestQuery(1), requestLabel)).status).toBe(401);
    expect((await get(DEVELOPER, auditQuery(1), auditLabel)).status).toBe(403);
    expect((await get(OPERATOR, auditQuery(1), auditLabel)).status).toBe(403);
    expect((await get(null, auditQuery(1), auditLabel)).status).toBe(401);
  });
});

/* ------------------------------------------------------------------------- */
/* 커서 봉투 — 마이크로초 왕복, 옛 판(밀리초) 커서, 만료                          */
/* ------------------------------------------------------------------------- */

/** PostgreSQL이 저장한 값을 마이크로초 UTC 문자열로 — 커서가 실어야 하는 바로 그 값이다. */
const US = `'YYYY-MM-DD"T"HH24:MI:SS.USZ'`;

const requestFingerprint = (): string => computeRequestFingerprint(parseRequestFilter({ requested_by: REQUESTER }));
const auditFingerprint = (): string => computeAuditFingerprint({ userId: ACTOR });

/** 옛 판(버전 1)의 커서를 같은 서명 키로 만든다 — 시각은 `toISOString()`의 밀리초다. */
function legacyCursor(t: string, id: number, fingerprint: string): string {
  return encodeEnvelope({ v: 1, t, i: id, q: fingerprint, x: Date.now() + CURSOR_TTL_MS }, TEST_CURSOR_SIGNER);
}

describe('커서가 DB의 마이크로초를 그대로 싣는다 — 조회 → 커서 생성 → 해석 → 다음 조회', () => {
  it('등록 요청: 첫 쪽 마지막 행의 커서 시각이 PostgreSQL의 값과 글자 그대로 같다', async () => {
    await seedRequests();
    const first = await get(OPERATOR, requestQuery(2), requestLabel);
    const last = first.labels[first.labels.length - 1]!;
    const payload = decodeEnvelope(first.next ?? '', TEST_CURSOR_SIGNER) as { t: string; i: number };
    const row = await pool.query<{ t: string }>(
      `SELECT to_char(created_at AT TIME ZONE 'UTC', ${US}) AS t FROM repository_registration_request WHERE request_id = $1`,
      [last],
    );
    expect(payload.t).toBe(row.rows[0]?.t);
    expect(payload.t).toMatch(/\.\d{6}Z$/);
    expect(String(payload.i)).toBe(last);
  });

  it('감사 기록: 첫 쪽 마지막 행의 커서 시각이 PostgreSQL의 값과 글자 그대로 같다', async () => {
    await seedAudit();
    const first = await get(OFFICER, auditQuery(2), auditLabel);
    const last = first.labels[first.labels.length - 1]!;
    const payload = decodeEnvelope(first.next ?? '', TEST_CURSOR_SIGNER) as { t: string; i: number };
    const row = await pool.query<{ t: string; id: string }>(
      `SELECT to_char(occurred_at AT TIME ZONE 'UTC', ${US}) AS t, audit_id::text AS id FROM audit_record WHERE user_id = $1 AND query = $2`,
      [ACTOR, last],
    );
    expect(payload.t).toBe(row.rows[0]?.t);
    expect(String(payload.i)).toBe(row.rows[0]?.id);
  });
});

describe('정밀도를 잃은 옛 커서는 이어 읽지 않고 첫 페이지 재조회를 안내한다', () => {
  it('등록 요청: 옛 판 커서는 `CURSOR_INVALID`이고 `detail.reason`이 옛 판임을 말하며 항목을 내주지 않는다', async () => {
    const expected = await seedRequests();
    const legacy = legacyCursor('2026-08-26T10:00:00.123Z', Number(expected[1]), requestFingerprint());
    const page = await get(OPERATOR, `${requestQuery(1)}&cursor=${encodeURIComponent(legacy)}`, requestLabel);
    expect([page.status, page.code]).toEqual([400, 'CURSOR_INVALID']);
    expect(page.detail).toEqual({ reason: 'cursor_version_outdated', issued_version: 1, current_version: 2 });
    expect(page.body['items']).toBeUndefined();
  });

  it('감사 기록: 옛 판 커서는 `CURSOR_INVALID`이고 `detail.reason`이 옛 판임을 말하며 항목을 내주지 않는다', async () => {
    await seedAudit();
    const id = await pool.query<{ id: string }>('SELECT max(audit_id)::text AS id FROM audit_record WHERE user_id = $1', [ACTOR]);
    const legacy = legacyCursor('2026-08-26T10:00:00.123Z', Number(id.rows[0]?.id), auditFingerprint());
    const page = await get(OFFICER, `${auditQuery(1)}&cursor=${encodeURIComponent(legacy)}`, auditLabel);
    expect([page.status, page.code]).toEqual([400, 'CURSOR_INVALID']);
    expect(page.detail).toEqual({ reason: 'cursor_version_outdated', issued_version: 1, current_version: 2 });
    expect(page.body['items']).toBeUndefined();
  });

  it('만료된 커서는 옛 판과 다른 갈래다 — `CURSOR_INVALID`이되 옛 판 사유가 없다', async () => {
    await seedRequests();
    const first = await get(OPERATOR, requestQuery(1), requestLabel);
    const payload = decodeEnvelope(first.next ?? '', TEST_CURSOR_SIGNER) as Record<string, unknown>;
    const expired = encodeEnvelope({ ...payload, x: Date.now() - 1 }, TEST_CURSOR_SIGNER);
    const page = await get(OPERATOR, `${requestQuery(1)}&cursor=${encodeURIComponent(expired)}`, requestLabel);
    expect([page.status, page.code]).toEqual([400, 'CURSOR_INVALID']);
    expect(page.detail).toBeUndefined();

    await seedAudit();
    const auditFirst = await get(OFFICER, auditQuery(1), auditLabel);
    const auditPayload = decodeEnvelope(auditFirst.next ?? '', TEST_CURSOR_SIGNER) as Record<string, unknown>;
    const auditExpired = encodeEnvelope({ ...auditPayload, x: Date.now() - 1 }, TEST_CURSOR_SIGNER);
    const auditPage = await get(OFFICER, `${auditQuery(1)}&cursor=${encodeURIComponent(auditExpired)}`, auditLabel);
    expect([auditPage.status, auditPage.code]).toEqual([400, 'CURSOR_INVALID']);
    expect(auditPage.detail).toBeUndefined();
  });

  it('현재 판의 커서라도 시각 형식이 마이크로초 여섯 자리가 아니면 받지 않는다', async () => {
    const expected = await seedRequests();
    for (const t of ['2026-08-26T10:00:00.123Z', '2026-08-26T10:00:00.1234567Z', '2026-08-26T10:00:00.123456', '2026-08-26 10:00:00.123456Z']) {
      const forged = encodeEnvelope({ v: 2, t, i: Number(expected[1]), q: requestFingerprint(), x: Date.now() + CURSOR_TTL_MS }, TEST_CURSOR_SIGNER);
      const page = await get(OPERATOR, `${requestQuery(1)}&cursor=${encodeURIComponent(forged)}`, requestLabel);
      expect([page.status, page.code], t).toEqual([400, 'CURSOR_INVALID']);
    }
  });
});
