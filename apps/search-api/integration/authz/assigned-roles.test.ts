/**
 * 관리자 지정 역할이 실효 역할이 된다 — 실제 Fastify + PostgreSQL + Redis (CR-091 / DEV-695).
 *
 * ## 무엇이 비어 있었나
 *
 * 보안 문서 5.1과 API-AUTH-001은 최종 역할을 `{developer} ∪ (IdP·팀 매핑) ∪ (DB 지정값)`으로
 * 적었다. 그런데 로그인 콜백은 DB에 닿지 않아 지정값 자리에 빈 배열을 넘겼고, 세션을 읽는
 * 자리는 세션의 역할만 봤다. 그래서 `app_user.roles[]`에 `operator`를 적어도 어디에도
 * 반영되지 않았다. 사내 `0.1.0-pilot.6`에서 GHE 로그인으로 바꾼 뒤 누구도 운영 콘솔을 쓸 수
 * 없었던 이유다.
 *
 * `enforcement.test.ts`는 세션에 `operator`를 **직접 넣어** 만들었기 때문에 이 빈틈을 보지
 * 못했다. 이 파일은 로그인이 실제로 만드는 세션(IdP·팀 역할만)을 넣고, **운영 조립
 * (`createAuthContext`)을 그대로 써서** 요청이 실제 배선을 지나게 한다.
 */

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  SESSION_COOKIE_NAME,
  createSessionId,
  scopeKey,
  sessionKey,
  type SessionRecord,
} from '@prs/authz';
import { authRepo, type Pool } from '@prs/db';
import type { Redis } from '@prs/bus';
import { buildServer } from '../../src/server.js';
import { ME_PATH } from '../../src/auth/routes.js';
import { DEAD_LETTER_PATH } from '../../src/ops/routes.js';
import { createAuthContext, type AuthContext, type AuthRedis } from '../../src/auth/context.js';
import { createTestRedis, migratedPool } from '../helpers.js';
import { TEST_CURSOR_KEY } from '../_cursor-fixture.js';

const AUTH_CONFIG = {
  enabled: true,
  cookieSecure: true,
  loginPath: '/auth/login',
  groupRoleMap: new Map<string, never>(),
} as const;

const USER = 'github:991';
const LOGIN = 'cr091-kim';

let pool: Pool;
let redis: Redis;
let app: FastifyInstance;
let auth: AuthContext;
const logged: { message: string; detail: Record<string, unknown> }[] = [];

function authRedis(client: Redis): AuthRedis {
  return {
    get: (key) => client.get(key),
    set: (key, value, mode, seconds) => client.set(key, value, mode, seconds),
    del: (...keys) => client.del(...keys),
    scan: (cursor, m, pattern, c, n) => client.scan(cursor, m, pattern, c, n),
  };
}

/** 로그인 콜백이 실제로 만드는 세션 — 역할은 IdP·팀 매핑 절반뿐이다. */
async function login(roles: readonly string[] = ['developer']): Promise<string> {
  const sessionId = createSessionId();
  const now = Date.now();
  const record: SessionRecord = {
    sessionId,
    userId: USER,
    login: LOGIN,
    email: null,
    roles,
    issuedAt: now,
    lastSeenAt: now,
    correlationId: null,
    githubUserId: 991,
  };
  await auth.sessions.create(record);
  return sessionId;
}

const cookie = (sessionId: string): Record<string, string> => ({ cookie: `${SESSION_COOKIE_NAME}=${sessionId}` });

async function me(sessionId: string): Promise<string[]> {
  const response = await app.inject({ method: 'GET', url: ME_PATH, headers: cookie(sessionId) });
  expect(response.statusCode).toBe(200);
  return response.json<{ roles: string[] }>().roles;
}

async function deadLetters(sessionId: string): Promise<number> {
  return (await app.inject({ method: 'GET', url: DEAD_LETTER_PATH, headers: cookie(sessionId) })).statusCode;
}

beforeAll(async () => {
  pool = await migratedPool();
  redis = createTestRedis();

  auth = createAuthContext({
    redis: authRedis(redis),
    pool,
    source: {
      fetch: async () => ({ repositoryIds: [101], orgIds: [1], teamIds: [10], visibilities: ['public'] }),
    },
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
  await pool.query('DELETE FROM permission_cache');
  /*
   * 행을 지우지 않고 역할만 되돌린다. 등록 캐시는 프로세스 수명이라(`registration.ts`) 행을
   * 지우면 다음 시험의 세션이 다시 등록되지 않는다 — 운영에서 누가 행을 손으로 지운 것과 같은
   * 형상이며 이 파일의 관심사가 아니다.
   */
  await authRepo.upsertUserOnLogin(pool, { user_id: USER, login: LOGIN, github_user_id: 991 });
  await authRepo.setAssignedRoles(pool, USER, ['developer']);
  await redis.del(scopeKey(USER));
});

afterAll(async () => {
  await app?.close();
  await redis?.quit();
  await pool?.end();
});

describe('DEV-695: app_user.roles[]의 관리자 지정이 실제 요청의 권한이 된다', () => {
  it('로그인 세션만으로는 운영 경로가 403이다 — 출발점', async () => {
    const sessionId = await login();
    expect(await me(sessionId)).toEqual(['developer']);
    expect(await deadLetters(sessionId)).toBe(403);
  });

  it('DB에 operator를 지정하면 **같은 세션의 다음 요청부터** 통과한다 — 재로그인이 필요 없다', async () => {
    const sessionId = await login();
    // 첫 요청이 정본에 행을 만든다 (DEV-613). 지정은 그 행에 한다.
    expect(await deadLetters(sessionId)).toBe(403);

    await authRepo.setAssignedRoles(pool, USER, ['developer', 'operator']);

    expect(await deadLetters(sessionId)).toBe(200);
    expect(await me(sessionId)).toEqual(['developer', 'operator']);
  });

  it('회수하면 같은 세션의 다음 요청부터 403이다 — 세션 수명 동안 남지 않는다', async () => {
    const sessionId = await login();
    await me(sessionId);
    await authRepo.setAssignedRoles(pool, USER, ['developer', 'operator']);
    expect(await deadLetters(sessionId)).toBe(200);

    await authRepo.setAssignedRoles(pool, USER, ['developer']);

    expect(await deadLetters(sessionId)).toBe(403);
    expect(await me(sessionId)).toEqual(['developer']);
  });

  it('팀 매핑 역할(세션)과 관리자 지정(DB)을 합친다 — 한쪽이 다른 쪽을 덮지 않는다', async () => {
    const sessionId = await login(['developer', 'manager']);
    await me(sessionId);
    await authRepo.setAssignedRoles(pool, USER, ['developer', 'security_officer']);

    expect(await me(sessionId)).toEqual(['developer', 'manager', 'security_officer']);
  });

  it('실효 역할을 Redis의 세션 레코드에 쓰지 않는다 — web의 유휴 갱신과 서로 덮지 않는다', async () => {
    const sessionId = await login();
    await me(sessionId);
    await authRepo.setAssignedRoles(pool, USER, ['developer', 'operator']);
    expect(await deadLetters(sessionId)).toBe(200);

    const stored = JSON.parse((await redis.get(sessionKey(sessionId))) ?? '{}') as { roles?: string[] };
    expect(stored.roles).toEqual(['developer']);
  });

  it('지정 역할 조회가 실패해도 기존 동작이 무너지지 않는다 — 로그를 남기고 세션 역할로 판정한다', async () => {
    const sessionId = await login();
    await me(sessionId);
    await authRepo.setAssignedRoles(pool, USER, ['developer', 'operator']);
    expect(await deadLetters(sessionId)).toBe(200);

    // `roles` 열을 잠시 읽을 수 없게 만든다 — 연결은 살아 있고 그 질의만 실패한다.
    await pool.query('ALTER TABLE app_user RENAME COLUMN roles TO roles_cr091_hidden');
    try {
      expect(await deadLetters(sessionId)).toBe(403);
      expect(logged.map((entry) => entry.message)).toContainEqual(expect.stringContaining('DEV-695'));
    } finally {
      await pool.query('ALTER TABLE app_user RENAME COLUMN roles_cr091_hidden TO roles');
    }
    expect(await deadLetters(sessionId)).toBe(200);
  });
});
