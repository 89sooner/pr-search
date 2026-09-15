/**
 * 접근 범위는 필요한 조회만 하고, 실패하면 운영자 로그가 사유를 말한다 — 실제 Fastify + PostgreSQL + Redis (CR-092 / DEV-698).
 *
 * ## 무엇이 있었나
 *
 * 사내 `0.1.0-pilot.7`은 저장소 셋을 등록하고 인증을 켜자 `GET /api/v1/me`가 503 `PERMISSION_UNAVAILABLE`이었다.
 * 필터는 저장소 ID만 보는 크기였는데 출처(`GheAccessScopeSource`)가 쓰이지 않는 조직·팀 조회까지 불렀고, App에
 * 조직 `Members` 권한이 없어 그 조회 하나가 범위 전체를 실패시켰다. 응답은 사유를 싣지 않고 로그에도 없어 사내는
 * 원인을 **추정**했다.
 *
 * 이 파일은 **운영 조립(`createAuthContext`)과 실제 출처 클래스**를 쓰고, GHE만 권한 없는 App이 받는 답(403)으로
 * 바꾼다. 출처의 단위 시험(`packages/authz/src/scope-source.test.ts`)이 판정을 보고, 여기서는 그 판정이 요청 경로와
 * 로그까지 이어지는지 본다.
 */

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  EXPLICIT_SCOPE_LIMIT,
  GheAccessScopeSource,
  SESSION_COOKIE_NAME,
  createSessionId,
  scopeKey,
  type GhePermissionApi,
  type RegisteredRepository,
} from '@prs/authz';
import { authRepo, type Pool } from '@prs/db';
import type { Redis } from '@prs/bus';
import { GitHubApiError } from '@prs/github';
import { buildServer } from '../../src/server.js';
import { ME_PATH } from '../../src/auth/routes.js';
import { createAuthContext, type AuthContext, type AuthRedis } from '../../src/auth/context.js';
import { createTestRedis, migratedPool } from '../helpers.js';
import { TEST_CURSOR_KEY } from '../_cursor-fixture.js';

const AUTH_CONFIG = {
  enabled: true,
  cookieSecure: true,
  loginPath: '/auth/login',
  groupRoleMap: new Map<string, never>(),
} as const;

const USER = 'github:992';
const LOGIN = 'cr092-lee';

let pool: Pool;
let redis: Redis;
let app: FastifyInstance;
let auth: AuthContext;
let registeredCount = 3;
const calls = { orgMember: 0, orgTeams: 0 };
const logged: { message: string; detail: Record<string, unknown> }[] = [];

function authRedis(client: Redis): AuthRedis {
  return {
    get: (key) => client.get(key),
    set: (key, value, mode, seconds) => client.set(key, value, mode, seconds),
    del: (...keys) => client.del(...keys),
    scan: (cursor, m, pattern, c, n) => client.scan(cursor, m, pattern, c, n),
  };
}

/** 조직 `Members` 권한이 없는 App이 GHE에서 받는 답. 협업자 권한(`Metadata`)은 된다. */
const membersForbiddenApi: GhePermissionApi = {
  collaboratorPermission: async () => ({ permission: 'push' }),
  isOrgMember: async (org) => {
    calls.orgMember += 1;
    throw new GitHubApiError('auth', `/orgs/${org}/members/${LOGIN} 요청 실패 (403): {"message":"Resource not accessible by integration"}`, {
      status: 403,
    });
  },
  listOrgTeams: async () => {
    calls.orgTeams += 1;
    return [];
  },
  teamMembership: async () => false,
};

function registered(): RegisteredRepository[] {
  return Array.from({ length: registeredCount }, (_, i) => ({
    repositoryId: 92_000 + i,
    owner: 'smp-org',
    name: `smp-repo-${String(i)}`,
    orgId: 920,
    visibility: 'private' as const,
  }));
}

async function sessionCookie(): Promise<Record<string, string>> {
  const sessionId = createSessionId();
  const now = Date.now();
  await auth.sessions.create({
    sessionId,
    userId: USER,
    login: LOGIN,
    email: null,
    roles: ['developer'],
    issuedAt: now,
    lastSeenAt: now,
    correlationId: null,
    githubUserId: 992,
  });
  return { cookie: `${SESSION_COOKIE_NAME}=${sessionId}` };
}

beforeAll(async () => {
  pool = await migratedPool();
  redis = createTestRedis();

  auth = createAuthContext({
    redis: authRedis(redis),
    pool,
    source: new GheAccessScopeSource({ api: membersForbiddenApi, listRegistered: async () => registered() }),
    log: (message, detail) => logged.push({ message, detail }),
  });

  app = buildServer({
    config: { port: 0, adminTokens: [], metricsQueryUrl: null, gheBaseUrl: null, auth: AUTH_CONFIG, searchCursorKey: TEST_CURSOR_KEY },
    ops: { pool, bus: undefined as never },
    auth,
  });
  await app.ready();
}, 90_000);

beforeEach(async () => {
  logged.length = 0;
  calls.orgMember = 0;
  calls.orgTeams = 0;
  await pool.query('DELETE FROM permission_cache WHERE user_id = $1', [USER]);
  await authRepo.upsertUserOnLogin(pool, { user_id: USER, login: LOGIN, github_user_id: 992 });
  await redis.del(scopeKey(USER));
});

afterAll(async () => {
  await app?.close();
  await redis?.quit();
  await pool?.end();
});

describe('DEV-698: 저장소 목록으로 표현하는 범위는 조직 Members 권한 없이 선다', () => {
  it('사내 pilot.7 형상(저장소 셋) — /me가 200이고 조직·팀을 부르지 않으며 캐시에 저장소 목록 모드로 남는다', async () => {
    registeredCount = 3;

    const response = await app.inject({ method: 'GET', url: ME_PATH, headers: await sessionCookie() });

    expect(response.statusCode, response.body).toBe(200);
    expect(response.json<{ access_scope: unknown }>().access_scope).toMatchObject({
      scope_kind: 'explicit',
      repository_count: 3,
      org_count: null,
      team_count: null,
    });
    expect(calls).toEqual({ orgMember: 0, orgTeams: 0 });
    expect(logged).toEqual([]);

    const cached = await pool.query<{ scope_kind: string; repository_ids: string[] }>(
      'SELECT scope_kind, repository_ids FROM permission_cache WHERE user_id = $1',
      [USER],
    );
    expect(cached.rows[0]?.scope_kind).toBe('explicit');
    expect(cached.rows[0]?.repository_ids.map(Number)).toEqual([92_000, 92_001, 92_002]);
  });
});

describe('DEV-698: 조직·팀이 필요한 범위의 실패는 여전히 503이고, 사유는 로그에만 남는다', () => {
  it('500개를 넘으면 조직 조회의 403이 503이 되고, 로그가 단계·상태·필요 권한을 말한다', async () => {
    registeredCount = EXPLICIT_SCOPE_LIMIT + 1;

    const response = await app.inject({ method: 'GET', url: ME_PATH, headers: await sessionCookie() });

    expect(response.statusCode).toBe(503);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('PERMISSION_UNAVAILABLE');
    // 응답은 사유를 싣지 않는다 — 단계 이름도 GHE 본문도 없다.
    expect(response.body).not.toContain('org_membership');
    expect(response.body).not.toContain('Resource not accessible');

    expect(logged).toHaveLength(1);
    expect(logged[0]?.detail).toMatchObject({
      user_id: USER,
      stage: 'org_membership',
      error_kind: 'auth',
      status: 403,
    });
    expect(String(logged[0]?.detail['required_permission'])).toContain('Members');
    expect(JSON.stringify(logged)).not.toContain('Resource not accessible');
  });
});
