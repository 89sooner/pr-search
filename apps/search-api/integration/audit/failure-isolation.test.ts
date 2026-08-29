/**
 * 감사 실패 격리 — 실제 Fastify + PostgreSQL (WP-039 DoD / FR-AUTH-004 AC-6,
 * CR-054 DEV-406).
 *
 * ## 무엇을 증명하는가
 *
 * **감사 쓰기가 실패해도 주 동작의 결과가 바뀌지 않는다.** 200은 200으로,
 * 403은 403으로 나간다 — 감사 실패 때문에 500이 되어서도 안 되고, 주 동작의
 * 실패를 감사 성공이 덮어서도 안 된다.
 *
 * ## 어떻게 실패시키는가
 *
 * `audit_record`의 `action`에 길이 제약을 걸어 INSERT를 거절하게 한다. 목을
 * 끼우는 대신 **실제 DB가 실제로 거절하게** 하는 이유는, 공용 경계가 무엇을
 * 잡는지가 여기서 걸려야 하기 때문이다 — 목은 우리가 상상한 실패만 낸다.
 *
 * 제약은 이 파일이 만들고 이 파일이 지운다. 다른 파일이 같은 표를 쓰므로
 * **각 시험 안에서만 켜고 반드시 끈다.**
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
  type SessionRecord,
} from '@prs/authz';
import { auditRepo, authRepo, type Pool } from '@prs/db';
import type { Redis } from '@prs/bus';
import { buildServer } from '../../src/server.js';
import { AUDIT_RECORDS_PATH } from '../../src/audit/routes.js';
import { auditFailedTotal, recordAuditBestEffort } from '../../src/audit/recorder.js';
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

const NS = 'wp039-isolation';
const OFFICER = `${NS}-officer`;
const CONSTRAINT = 'wp039_audit_reject_all';

let pool: Pool;
let redis: Redis;
let app: FastifyInstance;
let sessions: SessionStore;

function authRedis(client: Redis): AuthRedis {
  return {
    get: (key) => client.get(key),
    set: (key, value, mode, seconds) => client.set(key, value, mode, seconds),
    del: (...keys) => client.del(...keys),
    scan: (cursor, m, pattern, c, n) => client.scan(cursor, m, pattern, c, n),
  };
}

async function login(userId: string, roles: readonly string[]): Promise<string> {
  const sessionId = createSessionId();
  const now = Date.now();
  const record: SessionRecord = {
    sessionId,
    userId,
    login: userId,
    email: `${userId}@acme.example`,
    roles,
    issuedAt: now,
    lastSeenAt: now,
    correlationId: null,
  };
  await sessions.create(record);
  return sessionId;
}

function cookie(sessionId: string): Record<string, string> {
  return { cookie: `${SESSION_COOKIE_NAME}=${sessionId}` };
}

/**
 * 감사 INSERT를 거절하게 만든다.
 *
 * `NOT VALID`를 쓴다 — 기존 행을 검사하지 않으므로 다른 파일이 남긴 행이
 * 있어도 제약이 걸린다. 새 INSERT만 막는 것이 우리가 원하는 것이다.
 */
async function breakAuditWrites(): Promise<void> {
  await pool.query(
    `ALTER TABLE audit_record ADD CONSTRAINT ${CONSTRAINT} CHECK (action = '') NOT VALID`,
  );
}

async function repairAuditWrites(): Promise<void> {
  await pool.query(`ALTER TABLE audit_record DROP CONSTRAINT IF EXISTS ${CONSTRAINT}`);
}

beforeAll(async () => {
  pool = await migratedPool();
  redis = createTestRedis();

  const redisPort = authRedis(redis);
  sessions = new SessionStore({ redis: redisPort });

  const auth: AuthContext = {
    sessions,
    scopes: new AccessScopeResolver({
      redis: redisPort,
      db: createScopeDatabase(pool),
      source: {
        fetch: async () => ({
          repositoryIds: [9201],
          orgIds: [92],
          teamIds: [920],
          visibilities: ['internal'],
        }),
      },
    }),
    forget: async (userIds) => {
      if (userIds.length > 0) await redis.del(...userIds.map(scopeKey));
    },
  };

  app = buildServer({
    config: {
      port: 0,
      adminTokens: [],
      metricsQueryUrl: null,
      gheBaseUrl: null,
      auth: AUTH_CONFIG,
      searchCursorKey: TEST_CURSOR_KEY,
    },
    ops: { pool, bus: undefined as never },
    auth,
    audit: { pool, cursorSigner: createCursorSigner(TEST_CURSOR_KEY) },
  });
  await app.ready();
}, 90_000);

beforeEach(async () => {
  await pool.query('DELETE FROM audit_record WHERE user_id LIKE $1', [`${NS}%`]);
  await authRepo.upsertUserOnLogin(pool, {
    user_id: OFFICER,
    login: OFFICER,
    github_user_id: 39_500,
  });
  await authRepo.setAssignedRoles(pool, OFFICER, ['developer', 'security_officer']);
});

afterEach(async () => {
  // **반드시 끈다.** 남기면 뒤에 도는 모든 파일의 감사 쓰기가 실패한다 —
  // 자기 시험은 통과하고 남의 시험이 깨지는 바로 그 모양이다.
  await repairAuditWrites();
});

afterAll(async () => {
  await repairAuditWrites();
  await pool.query('DELETE FROM audit_record WHERE user_id LIKE $1', [`${NS}%`]);
  await app?.close();
  await redis?.quit();
  await pool?.end();
});

describe('공용 경계 (`recordAuditBestEffort`)', () => {
  it('정상이면 기록하고 `true`를 준다', async () => {
    const ok = await recordAuditBestEffort(pool, {
      userId: OFFICER,
      action: 'audit.view',
      target: null,
      query: null,
      resultCode: 'ok',
      correlationId: '00000000-0000-4000-8000-000000000001',
    });
    expect(ok).toBe(true);
  });

  it('**실패해도 던지지 않는다** — `false`를 주고 지표를 올린다', async () => {
    await breakAuditWrites();
    const before = auditFailedTotal.get({ action: 'audit.view' });

    const ok = await recordAuditBestEffort(pool, {
      userId: OFFICER,
      action: 'audit.view',
      target: null,
      query: null,
      resultCode: 'ok',
      correlationId: '00000000-0000-4000-8000-000000000002',
    });

    expect(ok).toBe(false);
    expect(auditFailedTotal.get({ action: 'audit.view' })).toBe(before + 1);
  });

  it('지표 라벨은 `action` 하나다 — 고카디널리티 값을 담지 않는다', async () => {
    await breakAuditWrites();
    await recordAuditBestEffort(pool, {
      userId: OFFICER,
      action: 'search.execute',
      target: null,
      query: 'repo:acme/payments seq:1..2',
      resultCode: 'ok',
      correlationId: '00000000-0000-4000-8000-000000000003',
    });

    const rendered = auditFailedTotal.render();
    expect(rendered).toContain('action="search.execute"');
    // 감사가 담은 값이 지표로 새어 나가면 지표 엔드포인트가 두 번째 유출 경로다.
    expect(rendered).not.toContain(OFFICER);
    expect(rendered).not.toContain('acme/payments');
  });
});

describe('AC-6: 감사 실패가 주 동작의 결과를 바꾸지 않는다', () => {
  it('200은 200으로 남는다 — `audit.view`가 실패해도 목록이 나간다', async () => {
    const session = await login(OFFICER, ['developer', 'security_officer']);
    await breakAuditWrites();

    const response = await app.inject({
      method: 'GET',
      url: AUDIT_RECORDS_PATH,
      headers: cookie(session),
    });

    expect(response.statusCode).toBe(200);
    expect((response.json() as { items: unknown[] }).items).toBeDefined();
  });

  it('감사 실패로 500이 되지 않는다', async () => {
    const session = await login(OFFICER, ['developer', 'security_officer']);
    await breakAuditWrites();

    const response = await app.inject({
      method: 'GET',
      url: `${AUDIT_RECORDS_PATH}?limit=5`,
      headers: cookie(session),
    });

    expect(response.statusCode).not.toBe(500);
  });

  it('**주 동작의 실패를 감사 성공이 덮지 않는다** — 400은 400으로 남는다', async () => {
    const session = await login(OFFICER, ['developer', 'security_officer']);
    const response = await app.inject({
      method: 'GET',
      url: `${AUDIT_RECORDS_PATH}?limit=9999`,
      headers: cookie(session),
    });
    expect(response.statusCode).toBe(400);
  });

  it('감사가 실패한 요청은 기록을 남기지 않는다 — 없는 것을 있다고 하지 않는다', async () => {
    const session = await login(OFFICER, ['developer', 'security_officer']);
    await breakAuditWrites();

    await app.inject({ method: 'GET', url: AUDIT_RECORDS_PATH, headers: cookie(session) });
    await repairAuditWrites();

    const records = await auditRepo.listAuditRecords(pool, { userId: OFFICER }, 10);
    expect(records).toHaveLength(0);
  });
});
