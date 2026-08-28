/**
 * `API-ADM-008` 라우트 수준 검증 (WP-036 / PR #66 리뷰 P1).
 *
 * 여기서 재는 것 셋.
 *
 *   1. `security_officer`가 실제로 조회할 수 있다 (AC-5) — 역할 하나만 검사하는
 *      구현이면 그 역할이 막힌다
 *   2. 두 역할 어느 쪽도 아니면 막힌다
 *   3. **`include_payload=true`가 감사 기록을 남긴다** — 계약이 "명시적 열람은
 *      감사에 그대로 남는다"라고 정했는데 첫 구현이 그것을 따르지 않았다
 *
 * 픽스처 이름에 파일 전용 접두(`rawroute`)를 쓴다. 공유 `prs_test`에서
 * `app_user.login`과 `repository(owner, name)`이 유니크하기 때문이다.
 *
 * 실행: `pnpm test:integration ops/raw-events-route`
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
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
import { bootstrapArchive, createEsClient, resolveClientOptions } from '@prs/es';
import { authRepo, repositoryRepo, type Pool } from '@prs/db';
import type { Redis } from '@prs/bus';
import { buildServer, type ServerDeps } from '../../src/server.js';
import { RAW_EVENTS_PATH } from '../../src/ops/routes.js';
import type { AuthContext, AuthRedis } from '../../src/auth/context.js';
import { createTestRedis, migratedPool } from '../helpers.js';
import { TEST_CURSOR_KEY, TEST_CURSOR_SIGNER } from '../_cursor-fixture.js';

const AUTH_CONFIG = {
  enabled: true,
  cookieSecure: true,
  loginPath: '/auth/login',
  groupRoleMap: new Map<string, never>(),
} as const;

const INDEX = 'prs-raw-events-2026.07';
const REPOSITORY_ID = 90_201;
const OWNER = 'rawroute';
const NAME = 'payments';

const OPERATOR = 'rawroute-operator';
const OFFICER = 'rawroute-officer';
const DEVELOPER = 'rawroute-developer';
const USERS: readonly { readonly id: string; readonly roles: readonly string[] }[] = [
  { id: OPERATOR, roles: ['developer', 'operator'] },
  { id: OFFICER, roles: ['developer', 'security_officer'] },
  { id: DEVELOPER, roles: ['developer'] },
];

let pool: Pool;
let redis: Redis;
let es: Client;
let app: FastifyInstance;
let authContext: AuthContext;
const cookies = new Map<string, string>();

function redisPort(): AuthRedis {
  return redis as unknown as AuthRedis;
}

beforeAll(async () => {
  pool = await migratedPool();
  redis = createTestRedis();
  es = createEsClient(resolveClientOptions());

  // 접근 범위 산출이 `app_user` 등록을 요구한다.
  for (const user of USERS) {
    await authRepo.upsertUserOnLogin(pool, { user_id: user.id, login: user.id });
  }

  await repositoryRepo.upsertRepository(pool, {
    repository_id: REPOSITORY_ID,
    owner: OWNER,
    name: NAME,
    org_id: 1,
    visibility: 'internal',
    sequence_branches: ['main'],
  });

  await bootstrapArchive(es);
  await es.indices.delete({ index: INDEX }, { ignore: [404] });
  await es.indices.create({ index: INDEX });
  await es.index({
    index: INDEX,
    id: 'rawroute-d1',
    document: {
      delivery_id: 'rawroute-d1',
      event_type: 'pull_request',
      action: 'closed',
      repository: `${OWNER}/${NAME}`,
      repository_id: REPOSITORY_ID,
      received_at: '2026-07-15T10:00:00.000Z',
      correlation_id: 'rawroute-c1',
      payload: { secret: 'do-not-leak' },
    },
    refresh: true,
  });

  const sessions = new SessionStore({ redis: redisPort() });
  const source: AccessScopeSource = {
    fetch: async () => ({
      repositoryIds: [REPOSITORY_ID],
      orgIds: [],
      teamIds: [],
      visibilities: [],
    }),
  };
  authContext = {
    sessions,
    scopes: new AccessScopeResolver({ redis: redisPort(), db: createScopeDatabase(pool), source }),
    forget: async (ids) => {
      if (ids.length > 0) await redis.del(...ids.map(scopeKey));
    },
  };
  const auth = authContext;

  for (const user of USERS) {
    const sessionId = createSessionId();
    await sessions.create({
      sessionId,
      userId: user.id,
      login: user.id,
      email: null,
      roles: [...user.roles],
      issuedAt: Date.now(),
      lastSeenAt: Date.now(),
      correlationId: null,
    });
    cookies.set(user.id, `${SESSION_COOKIE_NAME}=${sessionId}`);
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
    ops: { pool, bus: undefined, log: () => undefined },
    rawEvents: { es, cursorSigner: TEST_CURSOR_SIGNER },
  } as unknown as ServerDeps);
}, 120_000);

afterAll(async () => {
  // 자기 픽스처를 치우고 나간다 — 남기면 다른 파일의 전역 삭제가 외래 키로 막힌다.
  const ids = USERS.map((u) => u.id);
  await pool.query('delete from audit_record where user_id = any($1)', [ids]);
  await pool.query('delete from permission_cache where user_id = any($1)', [ids]);
  await pool.query('delete from app_user where user_id = any($1)', [ids]);
  await pool.query('delete from repository where repository_id = $1', [REPOSITORY_ID]);
  await es.indices.delete({ index: INDEX }, { ignore: [404] });
  await es.close();
  await app.close();
  await redis.quit();
  await pool.end();
});

async function get(user: string, query = ''): Promise<{ status: number; body: unknown }> {
  const response = await app.inject({
    method: 'GET',
    url: `${RAW_EVENTS_PATH}${query}`,
    headers: { cookie: cookies.get(user) as string },
  });
  return { status: response.statusCode, body: response.json() };
}

describe('AC-5: 두 역할이 조회한다', () => {
  it('`operator`가 조회한다', async () => {
    const { status } = await get(OPERATOR);
    expect(status).toBe(200);
  });

  it('**`security_officer`도 조회한다** — 역할 하나만 검사하면 여기서 막힌다', async () => {
    const { status } = await get(OFFICER);
    expect(status).toBe(200);
  });

  it('둘 다 아닌 역할은 403이다', async () => {
    const { status } = await get(DEVELOPER);
    expect(status).toBe(403);
  });
});

describe('PR #67 리뷰 P1: 감사 적재 실패가 조회를 막지 않는다', () => {
  it('감사 쓰기가 거절돼도 200과 결과를 돌려준다', async () => {
    /*
     * `audit_record` 쓰기만 실패시킨다. 스프레드로 감싸면 클래스 메서드가
     * 사라지므로(risks) `Proxy`로 `query`만 가로챈다.
     */
    const brokenPool = new Proxy(pool, {
      get(target, prop, receiver) {
        if (prop !== 'query') return Reflect.get(target, prop, receiver) as unknown;
        return (text: unknown, params?: unknown) => {
          if (typeof text === 'string' && text.includes('audit_record')) {
            return Promise.reject(new Error('audit down'));
          }
          return (target.query as (t: unknown, p?: unknown) => unknown)(text, params);
        };
      },
    });

    const broken = buildServer({
      config: {
        port: 0,
        adminTokens: [],
        metricsQueryUrl: null,
        gheBaseUrl: null,
        auth: AUTH_CONFIG,
        searchCursorKey: TEST_CURSOR_KEY,
      },
      auth: authContext,
      ops: { pool: brokenPool, bus: undefined, log: () => undefined },
      rawEvents: { es, cursorSigner: TEST_CURSOR_SIGNER },
    } as unknown as ServerDeps);

    try {
      const response = await broken.inject({
        method: 'GET',
        url: `${RAW_EVENTS_PATH}?include_payload=true`,
        headers: { cookie: cookies.get(OFFICER) as string },
      });
      // 감사는 조회의 부수 기록이지 전제가 아니다.
      expect(response.statusCode).toBe(200);
      expect(response.body).toContain('do-not-leak');
    } finally {
      await broken.close();
    }
  });
});

describe('PR #66 리뷰 P1: 원본 열람이 감사에 남는다', () => {
  it('`include_payload=true`가 감사 기록을 남긴다', async () => {
    const { status, body } = await get(OFFICER, '?include_payload=true');
    expect(status).toBe(200);
    expect(JSON.stringify(body)).toContain('do-not-leak');

    const rows = await pool.query<{ action: string; target: string; query: string }>(
      'select action, target, query from audit_record where user_id = $1 order by occurred_at desc limit 1',
      [OFFICER],
    );
    expect(rows.rows[0]?.action).toBe('raw_event.view_payload');

    /*
     * 질의는 **적용된 조건 전부**를 담아야 재구성이 된다 (FR-AUTH-004 AC-2,
     * PR #67·#68 리뷰). 특히 `cursor`는 어느 페이지를 열람했는지를 정하므로
     * 없으면 같은 조건의 2쪽과 5쪽이 구분되지 않는다.
     */
    const recorded = JSON.parse(rows.rows[0]?.query ?? '{}') as Record<string, unknown>;
    for (const key of [
      'delivery_id',
      'repository',
      'event_type',
      'action',
      'received_from',
      'received_to',
      'limit',
      'cursor',
    ]) {
      expect(recorded, `감사 질의에 ${key}가 없다`).toHaveProperty(key);
    }
  });

  it('**기본 조회는 남기지 않는다** — 모든 조회를 남기면 열람 신호가 묻힌다', async () => {
    await pool.query('delete from audit_record where user_id = $1', [OPERATOR]);
    const { status, body } = await get(OPERATOR);
    expect(status).toBe(200);
    expect(JSON.stringify(body)).not.toContain('do-not-leak');

    const rows = await pool.query<{ count: string }>(
      'select count(*) as count from audit_record where user_id = $1',
      [OPERATOR],
    );
    expect(Number(rows.rows[0]?.count)).toBe(0);
  });
});
