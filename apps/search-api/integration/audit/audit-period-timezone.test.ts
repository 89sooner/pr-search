/**
 * API-ADM-005 감사 기록 기간의 시간대 — 실제 Fastify + PostgreSQL + Redis (CR-127, WP-108).
 *
 * 화면(A-004)은 기간 입력을 **한국 시간 벽시계**로 받아 `+09:00`을 붙여 보낸다. 서버는
 * 오프셋이 있으면 그 순간 그대로, 없으면 **UTC**로 읽는다(FR-AUTH-004 AC-9). 전에는
 * `new Date(raw)`가 오프셋 없는 값을 **서버 프로세스의 기본 시간대**로 읽었다 — 컨테이너는
 * UTC라 배포에서는 UTC였지만, 같은 요청이 실행 환경에 따라 다른 기록을 냈다.
 *
 * 기간은 계약 그대로 `from` 이상 `to` 미만이다. 경계 행은 KST 자정 앞뒤와 마이크로초
 * 끝에 둔다(CR-125의 커서 판 2가 그 정밀도를 지킨다).
 */

import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  AccessScopeResolver,
  SESSION_COOKIE_NAME,
  SessionStore,
  createScopeDatabase,
  createSessionId,
  scopeKey,
} from '@prs/authz';
import { authRepo, type Pool } from '@prs/db';
import type { Redis } from '@prs/bus';
import { buildServer } from '../../src/server.js';
import { AUDIT_RECORDS_PATH } from '../../src/audit/routes.js';
import type { AuthContext, AuthRedis } from '../../src/auth/context.js';
import { createCursorSigner } from '../../src/cursor/envelope.js';
import { createTestRedis, migratedPool } from '../helpers.js';
import { TEST_CURSOR_KEY } from '../_cursor-fixture.js';

const AUTH_CONFIG = {
  enabled: true,
  cookieSecure: true,
  loginPath: '/auth/login',
  groupRoleMap: new Map<string, never>(),
} as const;

/** 이 파일 고유 접두. 자기 행만 만들고 자기 행만 지운다. */
const NS = 'cr127-audit';
const OFFICER = `${NS}-officer`;
const ACTOR = `${NS}-actor`;

/** 경계 행. 주석이 한국 시간이다. */
const ROWS: readonly (readonly [target: string, occurredAt: string])[] = [
  ['r1', '2026-09-26T14:59:59.999999Z'], // 2026-09-26 23:59:59.999999
  ['r2', '2026-09-26T15:00:00Z'], // 2026-09-27 00:00:00
  ['r3', '2026-09-27T03:00:00Z'], // 2026-09-27 12:00
  ['r4', '2026-09-27T14:59:59.999999Z'], // 2026-09-27 23:59:59.999999
  ['r5', '2026-09-27T15:00:00Z'], // 2026-09-28 00:00:00
];

let pool: Pool;
let redis: Redis;
let app: FastifyInstance;
let sessions: SessionStore;
let officer: string;
const originalTz = process.env['TZ'];

interface ListBody {
  readonly items: readonly { readonly target: string | null; readonly occurred_at: string }[];
  readonly next_cursor: string | null;
  readonly error?: { readonly code: string; readonly detail?: Record<string, unknown> };
}

/**
 * 질의 문자열은 **`URLSearchParams`로만 만든다.** 오프셋의 `+`를 날것으로 이어 붙이면 서버가
 * 공백으로 풀어 읽는다 — 화면(`lib/audit.ts`)도 같은 이유로 `URLSearchParams`를 쓴다.
 */
async function list(filter: Readonly<Record<string, string>>): Promise<{ status: number; body: ListBody }> {
  const params = new URLSearchParams({ ...filter, user_id: ACTOR });
  const response = await app.inject({
    method: 'GET',
    url: `${AUDIT_RECORDS_PATH}?${params.toString()}`,
    headers: { cookie: `${SESSION_COOKIE_NAME}=${officer}` },
  });
  return { status: response.statusCode, body: response.json() as ListBody };
}

/** 최신순으로 오는 목록을 과거순 대상 이름으로 바꾼다. */
async function targetsFor(filter: Readonly<Record<string, string>>): Promise<string[]> {
  const { status, body } = await list(filter);
  expect(status, JSON.stringify(body.error)).toBe(200);
  return body.items.map((item) => item.target ?? '?').reverse();
}

beforeAll(async () => {
  pool = await migratedPool({ fixtureMonths: ['2026-09'] });
  redis = createTestRedis();
  const redisPort: AuthRedis = {
    get: (key) => redis.get(key),
    set: (key, value, mode, seconds) => redis.set(key, value, mode, seconds),
    del: (...keys) => redis.del(...keys),
    scan: (cursor, m, pattern, c, n) => redis.scan(cursor, m, pattern, c, n),
  };
  sessions = new SessionStore({ redis: redisPort });
  const auth: AuthContext = {
    sessions,
    scopes: new AccessScopeResolver({
      redis: redisPort,
      db: createScopeDatabase(pool),
      source: { fetch: async () => ({ repositoryIds: [], orgIds: [], teamIds: [], visibilities: ['internal'] }) },
    }),
    forget: async (ids) => {
      if (ids.length > 0) await redis.del(...ids.map(scopeKey));
    },
  };
  app = buildServer({
    config: { port: 0, adminTokens: [], metricsQueryUrl: null, gheBaseUrl: null, auth: AUTH_CONFIG, searchCursorKey: TEST_CURSOR_KEY },
    ops: { pool, bus: undefined as never },
    auth,
    audit: { pool, cursorSigner: createCursorSigner(TEST_CURSOR_KEY) },
  });
  await app.ready();

  await pool.query('DELETE FROM audit_record WHERE user_id LIKE $1', [`${NS}%`]);
  await authRepo.upsertUserOnLogin(pool, { user_id: OFFICER, login: OFFICER, github_user_id: 127_127 });
  await authRepo.setAssignedRoles(pool, OFFICER, ['developer', 'security_officer']);
  for (const [target, occurredAt] of ROWS) {
    await pool.query(
      `INSERT INTO audit_record (user_id, action, target, query, result_code, correlation_id, occurred_at)
       VALUES ($1, 'entity.view', $2, NULL, 'ok', gen_random_uuid(), $3::timestamptz)`,
      [ACTOR, target, occurredAt],
    );
  }
}, 90_000);

beforeEach(async () => {
  officer = createSessionId();
  const now = Date.now();
  await sessions.create({
    sessionId: officer, userId: OFFICER, login: OFFICER, email: null,
    roles: ['developer', 'security_officer'], issuedAt: now, lastSeenAt: now, correlationId: null,
  });
});

afterEach(() => {
  if (originalTz === undefined) delete process.env['TZ'];
  else process.env['TZ'] = originalTz;
});

afterAll(async () => {
  await app?.close();
  await pool?.query('DELETE FROM audit_record WHERE user_id LIKE $1', [`${NS}%`]);
  await redis?.quit();
  await pool?.end();
});

describe('감사 기록 기간은 오프셋을 그대로 읽고, 오프셋이 없으면 UTC다 (FR-AUTH-004 AC-9)', () => {
  it('화면이 보내는 KST 벽시계(+09:00) 하루: 자정 직전은 빠지고 다음 날 자정은 빠진다', async () => {
    expect(await targetsFor({ from: '2026-09-27T00:00+09:00', to: '2026-09-28T00:00+09:00' })).toEqual(['r2', 'r3', 'r4']);
  });

  it('같은 순간을 Z로 적어도 같은 기록이다 — 시간대 보정을 두 번 하지 않는다', async () => {
    expect(await targetsFor({ from: '2026-09-26T15:00:00Z', to: '2026-09-27T15:00:00Z' })).toEqual(['r2', 'r3', 'r4']);
  });

  it.each(['UTC', 'Asia/Seoul', 'America/Los_Angeles'])(
    '오프셋 없는 값은 서버 기본 시간대(%s)와 무관하게 UTC다',
    async (zone) => {
      process.env['TZ'] = zone;
      expect(await targetsFor({ from: '2026-09-26T15:00', to: '2026-09-27T15:00' })).toEqual(['r2', 'r3', 'r4']);
    },
  );

  it('날짜만 적은 옛 값은 그대로 UTC 자정이다', async () => {
    expect(await targetsFor({ from: '2026-09-27', to: '2026-09-28' })).toEqual(['r3', 'r4', 'r5']);
  });

  it('한 건씩 끝까지 읽어도 빠지거나 겹치지 않는다 — 마이크로초 경계 포함 (CR-125)', async () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 10; page++) {
      const { status, body } = await list({
        from: '2026-09-26T00:00+09:00',
        to: '2026-09-29T00:00+09:00',
        limit: '1',
        ...(cursor === null ? {} : { cursor }),
      });
      expect(status, JSON.stringify(body.error)).toBe(200);
      seen.push(...body.items.map((item) => item.target ?? '?'));
      cursor = body.next_cursor;
      if (cursor === null) break;
    }
    expect(seen).toEqual(['r5', 'r4', 'r3', 'r2', 'r1']);
  });

  it.each([
    ['역전된 기간', { from: '2026-09-28T00:00+09:00', to: '2026-09-27T00:00+09:00' }, 'from'],
    ['없는 날짜', { from: '2025-02-29T00:00+09:00' }, 'from'],
    ['없는 시각', { to: '2026-09-27T24:30+09:00' }, 'to'],
    ['형식이 아닌 값', { from: 'yesterday' }, 'from'],
    ['오프셋의 +가 공백으로 풀린 값', { from: '2026-09-27T00:00 09:00' }, 'from'],
  ] as const)('%s → 400 INVALID_PARAMETER', async (_label, filter, field) => {
    const { status, body } = await list(filter);
    expect(status).toBe(400);
    expect(body.error?.code).toBe('INVALID_PARAMETER');
    expect(body.error?.detail?.['field']).toBe(field);
  });
});
