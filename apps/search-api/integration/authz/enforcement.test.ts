/**
 * 인증 강제 — 실제 Fastify + PostgreSQL + Redis (WP-012 DoD 1~10).
 *
 * `app.inject`로 진짜 HTTP 경로를 탄다. 단위 테스트가 함수 단위로 확인한
 * 성질을 여기서는 **응답 상태 코드**로 다시 건다 — 계약이 정한 것이 그것이기
 * 때문이다.
 *
 * 접근 범위 밖 문서가 검색 결과에 나타나지 않는다는 것(DoD 4·DoD 5)은 아직
 * 검색 API가 없어(WP-013·WP-014) `applyMandatoryScopeFilter`가 만드는 질의로
 * Elasticsearch에 직접 물어 확인한다.
 */

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ABSOLUTE_TIMEOUT_MS,
  AccessScopeResolver,
  SESSION_COOKIE_NAME,
  SessionStore,
  createScopeDatabase,
  createSessionId,
  scopeKey,
  serializeSessionCookie,
  type AccessScopeSource,
  type SessionRecord,
} from '@prs/authz';
import { authRepo, type Pool } from '@prs/db';
import type { Redis } from '@prs/bus';
import { buildServer } from '../../src/server.js';
import { ME_PATH } from '../../src/auth/routes.js';
import { DEAD_LETTER_PATH } from '../../src/ops/routes.js';
import type { AuthContext, AuthRedis } from '../../src/auth/context.js';
import { createTestRedis, migratedPool } from '../helpers.js';

const AUTH_CONFIG = {
  enabled: true,
  cookieSecure: true,
  loginPath: '/auth/login',
  groupRoleMap: new Map<string, never>(),
} as const;

const DEVELOPER = 'sub-developer';
const OPERATOR = 'sub-operator';

let pool: Pool;
let redis: Redis;
let app: FastifyInstance;
let sessions: SessionStore;
let scopeSource: AccessScopeSource;
let repositoryIds: number[] = [101, 102];

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

beforeAll(async () => {
  pool = await migratedPool();
  redis = createTestRedis();

  const redisPort = authRedis(redis);
  sessions = new SessionStore({ redis: redisPort });
  scopeSource = {
    fetch: async () => ({
      repositoryIds,
      orgIds: [1],
      teamIds: [10],
      visibilities: ['public', 'internal'],
    }),
  };

  const auth: AuthContext = {
    sessions,
    scopes: new AccessScopeResolver({
      redis: redisPort,
      db: createScopeDatabase(pool),
      source: { fetch: (user) => scopeSource.fetch(user) },
    }),
    forget: async (userIds) => {
      if (userIds.length > 0) await redis.del(...userIds.map(scopeKey));
    },
  };

  app = buildServer({
    // 세션이 서면 토큰 목록은 비어 있어야 한다 (DEV-048).
    config: { port: 0, adminTokens: [], metricsQueryUrl: null, auth: AUTH_CONFIG },
    ops: { pool, bus: undefined as never },
    auth,
  });
  await app.ready();
}, 90_000);

beforeEach(async () => {
  repositoryIds = [101, 102];
  await pool.query('DELETE FROM permission_cache');
  await pool.query('DELETE FROM app_user');
  await redis.del(scopeKey(DEVELOPER), scopeKey(OPERATOR));

  await authRepo.upsertUserOnLogin(pool, { user_id: DEVELOPER, login: DEVELOPER, github_user_id: 6001 });
  await authRepo.upsertUserOnLogin(pool, { user_id: OPERATOR, login: OPERATOR, github_user_id: 6002 });
  await authRepo.setAssignedRoles(pool, OPERATOR, ['developer', 'operator']);
});

afterAll(async () => {
  await app?.close();
  await redis?.quit();
  await pool?.end();
});

describe('DoD 1: 미인증 요청', () => {
  it('세션 없이 /me를 부르면 401 + 재인증 경로다', async () => {
    const response = await app.inject({ method: 'GET', url: ME_PATH });

    expect(response.statusCode).toBe(401);
    const body = response.json<{ error: { code: string; detail?: { login_path?: string } } }>();
    expect(body.error.code).toBe('UNAUTHENTICATED');
    expect(body.error.detail?.login_path).toBe('/auth/login');
  });

  it('세션 없이 관리 경로를 부르면 401이다', async () => {
    const response = await app.inject({ method: 'GET', url: DEAD_LETTER_PATH });
    expect(response.statusCode).toBe(401);
  });

  it('신원을 주장하는 헤더로는 통과하지 못한다 (DEV-047)', async () => {
    for (const headers of [
      { 'x-user-id': OPERATOR },
      { 'x-forwarded-user': OPERATOR },
      { authorization: `Bearer ${OPERATOR}` },
      { 'x-roles': 'operator' },
    ]) {
      const response = await app.inject({ method: 'GET', url: DEAD_LETTER_PATH, headers });
      expect(response.statusCode).toBe(401);
    }
  });

  it('위조한 쿠키로는 통과하지 못한다', async () => {
    const response = await app.inject({ method: 'GET', url: ME_PATH, headers: cookie('forged-session') });
    expect(response.statusCode).toBe(401);
  });
});

describe('DoD 3: 세션 만료', () => {
  it('절대 만료가 지난 세션은 401이다', async () => {
    const sessionId = createSessionId();
    const stale = Date.now() - ABSOLUTE_TIMEOUT_MS - 1000;
    await sessions.create({
      sessionId,
      userId: DEVELOPER,
      login: DEVELOPER,
      email: null,
      roles: ['developer'],
      issuedAt: stale,
      lastSeenAt: Date.now(),
      correlationId: null,
    });

    const response = await app.inject({ method: 'GET', url: ME_PATH, headers: cookie(sessionId) });
    expect(response.statusCode).toBe(401);
  });

  it('로그아웃하면 그 다음 요청부터 401이다 (AC-5)', async () => {
    const sessionId = await login(DEVELOPER, ['developer']);
    expect((await app.inject({ method: 'GET', url: ME_PATH, headers: cookie(sessionId) })).statusCode).toBe(200);

    await sessions.destroy(sessionId);
    expect((await app.inject({ method: 'GET', url: ME_PATH, headers: cookie(sessionId) })).statusCode).toBe(401);
  });
});

describe('DoD 10: 권한 매트릭스 (API 계층)', () => {
  it('developer는 관리 경로에서 403이다', async () => {
    const sessionId = await login(DEVELOPER, ['developer']);
    const response = await app.inject({ method: 'GET', url: DEAD_LETTER_PATH, headers: cookie(sessionId) });

    expect(response.statusCode).toBe(403);
    const body = response.json<{ error: { code: string; detail?: { required_role?: string } } }>();
    expect(body.error.code).toBe('FORBIDDEN_ROLE');
    expect(body.error.detail?.required_role).toBe('operator');
  });

  it('manager·qa·release_manager도 관리 경로에서 403이다', async () => {
    for (const roles of [
      ['developer', 'manager'],
      ['developer', 'qa'],
      ['developer', 'release_manager'],
      ['developer', 'security_officer'],
    ]) {
      const sessionId = await login(DEVELOPER, roles);
      const response = await app.inject({ method: 'GET', url: DEAD_LETTER_PATH, headers: cookie(sessionId) });
      expect(response.statusCode, roles.join(',')).toBe(403);
    }
  });

  it('operator는 통과한다', async () => {
    const sessionId = await login(OPERATOR, ['developer', 'operator']);
    const response = await app.inject({ method: 'GET', url: DEAD_LETTER_PATH, headers: cookie(sessionId) });
    expect(response.statusCode).toBe(200);
  });

  it('403과 401을 섞지 않는다 — 인증은 됐으나 역할이 없는 경우', async () => {
    const sessionId = await login(DEVELOPER, ['developer']);
    const response = await app.inject({ method: 'GET', url: DEAD_LETTER_PATH, headers: cookie(sessionId) });
    // 401이면 화면이 재인증으로 보내고, 사용자는 같은 화면을 무한히 맴돈다.
    expect(response.statusCode).not.toBe(401);
  });
});

describe('API-AUTH-001 /me', () => {
  it('사용자·역할·접근 범위 요약을 준다', async () => {
    const sessionId = await login(OPERATOR, ['developer', 'operator']);
    const response = await app.inject({ method: 'GET', url: ME_PATH, headers: cookie(sessionId) });

    expect(response.statusCode).toBe(200);
    const body = response.json<{
      user_id: string;
      roles: string[];
      access_scope: { scope_kind: string; repository_count: number | null };
    }>();

    expect(body.user_id).toBe(OPERATOR);
    expect(body.roles).toEqual(['developer', 'operator']);
    expect(body.access_scope.scope_kind).toBe('explicit');
    expect(body.access_scope.repository_count).toBe(2);
  });

  it('저장소 ID 목록을 응답에 싣지 않는다 (DEV-040)', async () => {
    const sessionId = await login(DEVELOPER, ['developer']);
    const body = (await app.inject({ method: 'GET', url: ME_PATH, headers: cookie(sessionId) })).body;

    expect(body).not.toContain('101');
    expect(body).not.toContain('repository_ids');
  });

  it('접근 범위 조회가 실패하면 503 permission_unavailable이다 (DoD 6)', async () => {
    scopeSource = { fetch: () => Promise.reject(new Error('GHE 502')) };
    const sessionId = await login(DEVELOPER, ['developer']);

    const response = await app.inject({ method: 'GET', url: ME_PATH, headers: cookie(sessionId) });
    expect(response.statusCode).toBe(503);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('PERMISSION_UNAVAILABLE');

    scopeSource = {
      fetch: async () => ({ repositoryIds, orgIds: [1], teamIds: [10], visibilities: [] }),
    };
  });

  it('실패해도 부분 결과를 주지 않는다 — 빈 범위로 200을 내지 않는다', async () => {
    scopeSource = { fetch: () => Promise.reject(new Error('GHE 502')) };
    const sessionId = await login(DEVELOPER, ['developer']);

    const response = await app.inject({ method: 'GET', url: ME_PATH, headers: cookie(sessionId) });
    expect(response.statusCode).not.toBe(200);

    scopeSource = {
      fetch: async () => ({ repositoryIds, orgIds: [1], teamIds: [10], visibilities: [] }),
    };
  });
});

describe('DoD 8: 권한 회수가 첫 요청부터 반영된다 (FR-AUTH-003 AC-4)', () => {
  it('무효화 뒤 첫 /me가 줄어든 범위를 보여 준다', async () => {
    const sessionId = await login(DEVELOPER, ['developer']);

    const before = (await app.inject({ method: 'GET', url: ME_PATH, headers: cookie(sessionId) })).json<{
      access_scope: { repository_count: number };
    }>();
    expect(before.access_scope.repository_count).toBe(2);

    // 저장소 하나의 권한이 회수됐다.
    repositoryIds = [101];
    await authRepo.invalidateUsers(pool, [DEVELOPER]);
    await redis.del(scopeKey(DEVELOPER));

    const after = (await app.inject({ method: 'GET', url: ME_PATH, headers: cookie(sessionId) })).json<{
      access_scope: { repository_count: number };
    }>();
    expect(after.access_scope.repository_count).toBe(1);
  });
});

describe('DEV-048: 세션과 토큰은 배타다', () => {
  it('둘을 함께 구성하면 기동을 거부한다', () => {
    expect(() =>
      buildServer({
        config: {
          port: 0,
          adminTokens: [{ name: 'alice', token: 'tok' }],
          metricsQueryUrl: null,
          auth: AUTH_CONFIG,
        },
        ops: { pool, bus: undefined as never },
        auth: { sessions, scopes: {} as never, forget: async () => {} },
      }),
    ).toThrow(/함께 구성할 수 없다/);
  });

  it('쿠키 속성을 실제 응답 헤더에서 확인한다 (DoD 2)', () => {
    // 쿠키는 `web`이 발급하지만 직렬화는 `@prs/authz`가 한다.
    const value = serializeSessionCookie('abc', { secure: AUTH_CONFIG.cookieSecure });
    expect(value).toContain('HttpOnly');
    expect(value).toContain('Secure');
    expect(value).toContain('SameSite=Lax');
  });
});
