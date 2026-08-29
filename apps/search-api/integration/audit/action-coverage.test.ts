/**
 * 활성 감사 액션의 실제 도달성 — 실제 Fastify + PostgreSQL
 * (WP-039 DoD / FR-AUTH-004 AC-1, CR-054).
 *
 * ## `grep`으로 증명하지 않는다
 *
 * "코드에 액션 문자열이 있다"와 "사용자 경로가 실제로 감사된다"는 다른 주장이다.
 * 이 파일은 **실제 요청을 보내고 그 뒤 `audit_record`에 행이 생기는지**를 본다.
 *
 * ## 미활성 액션은 게이트에서 뺀다
 *
 * `export.create`(WP-044)와 `safe_marker.set`(WP-041)은 그 기능 자체가
 * `REL-006`이다. 여기서 요구하면 **없는 기능을 만들어서라도 통과시키게 되고**,
 * 그것이 `DEV-403`이 막으려는 바로 그 압력이다. 대신 소유 WP가 계약에 남아
 * 있는지를 확인한다.
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
  type SessionRecord,
} from '@prs/authz';
import { auditRepo, authRepo, repositoryRepo, type Pool } from '@prs/db';
import { applyMappings, createEsClient, resolveClientOptions } from '@prs/es';
import type { Client as EsClient } from '@elastic/elasticsearch';
import {
  ACTIVE_AUDIT_ACTIONS,
  LEGACY_AUDIT_ACTIONS,
  NOT_ACTIVATED_AUDIT_ACTIONS,
} from '@prs/domain';
import type { Redis } from '@prs/bus';
import { buildServer } from '../../src/server.js';
import { AUDIT_RECORDS_PATH } from '../../src/audit/routes.js';
import { SEARCH_PATH } from '../../src/search/routes.js';
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

const NS = 'wp039-coverage';
const USER = `${NS}-user`;

let pool: Pool;
let es: EsClient;
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

async function login(roles: readonly string[]): Promise<string> {
  const sessionId = createSessionId();
  const now = Date.now();
  const record: SessionRecord = {
    sessionId,
    userId: USER,
    login: USER,
    email: `${USER}@acme.example`,
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

async function recorded(action: string): Promise<number> {
  const rows = await auditRepo.listAuditRecords(pool, { userId: USER, action }, 50);
  return rows.length;
}

beforeAll(async () => {
  pool = await migratedPool();
  es = createEsClient(resolveClientOptions());
  await applyMappings(es);
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
          repositoryIds: [9301],
          orgIds: [93],
          teamIds: [930],
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
    /*
     * **검색 경로를 실제로 세운다.** 목으로 대체하면 "라우트가 등록되어
     * 있는가"만 보게 되고, 감사가 실제 응답 경로 위에 있는지는 확인되지
     * 않는다 — 그 자리가 `WP-039`가 메우려는 공백이다.
     */
    search: {
      pool,
      es,
      cursorSigner: createCursorSigner(TEST_CURSOR_KEY),
      resolveNames: async (names) => ({
        orgIds: await repositoryRepo.resolveOrgIds(pool, names.orgs),
        teamIds: await authRepo.resolveTeamIds(pool, names.teams),
      }),
    },
  });
  await app.ready();
}, 180_000);

beforeEach(async () => {
  await pool.query('DELETE FROM audit_record WHERE user_id LIKE $1', [`${NS}%`]);
  await authRepo.upsertUserOnLogin(pool, { user_id: USER, login: USER, github_user_id: 39_700 });
  await authRepo.setAssignedRoles(pool, USER, ['developer', 'security_officer']);
});

afterAll(async () => {
  await pool.query('DELETE FROM audit_record WHERE user_id LIKE $1', [`${NS}%`]);
  await app?.close();
  await es?.close();
  await redis?.quit();
  await pool?.end();
});

describe('활성 액션의 목록 자체가 계약이다 (AC-1)', () => {
  it('개수를 세지 않는다 — 목록이 정본이다', () => {
    // 이 시험이 확인하는 것은 "몇 개인가"가 아니라 "어떤 것이 있는가"다.
    // 개수를 단언하면 액션을 하나 더할 때마다 이 시험이 그 이유 없이 깨진다.
    expect(ACTIVE_AUDIT_ACTIONS).toEqual(
      expect.arrayContaining([
        'search.execute',
        'entity.view',
        'saved_search.create',
        'saved_search.update',
        'saved_search.delete',
        'repository.register',
        'repository.update',
        'repository.unregister',
        'job.run',
        'job.pause',
        'job.resume',
        'job.cancel',
        'dead_letter.reprocess',
        'reindex.start',
        'sequence_integrity.check',
        'sequence.reassign',
        'raw_event.view_payload',
        'audit.view',
        'retention.purge',
      ]),
    );
  });

  it('**미활성 액션이 활성 목록에 없다** (DEV-403)', () => {
    for (const action of NOT_ACTIVATED_AUDIT_ACTIONS) {
      expect(ACTIVE_AUDIT_ACTIONS as readonly string[], action).not.toContain(action);
    }
  });

  it('legacy 값이 신규 쓰기 어휘에 없다 (DEV-405)', () => {
    for (const action of LEGACY_AUDIT_ACTIONS) {
      expect(ACTIVE_AUDIT_ACTIONS as readonly string[], action).not.toContain(action);
    }
  });

  it('**`secret.rotate`가 없다** — 소유하는 제품 기능이 없다 (DEV-409)', () => {
    expect(ACTIVE_AUDIT_ACTIONS as readonly string[]).not.toContain('secret.rotate');
    expect(NOT_ACTIVATED_AUDIT_ACTIONS as readonly string[]).not.toContain('secret.rotate');
  });
});

describe('실제 요청이 실제 기록을 만든다', () => {
  it('`search.execute` — 검색 실행', async () => {
    const session = await login(['developer', 'security_officer']);
    await app.inject({
      method: 'GET',
      url: `${SEARCH_PATH}?q=is%3Amerged`,
      headers: cookie(session),
    });
    expect(await recorded('search.execute')).toBeGreaterThan(0);
  });

  it('`search.execute` — `target`이 `null`이고 `query`가 질의다 (AC-2)', async () => {
    const session = await login(['developer', 'security_officer']);
    await app.inject({
      method: 'GET',
      url: `${SEARCH_PATH}?q=repo%3Aacme%2Fpayments`,
      headers: cookie(session),
    });
    const rows = await auditRepo.listAuditRecords(pool, { userId: USER, action: 'search.execute' }, 5);
    expect(rows[0]?.target).toBeNull();
    expect(rows[0]?.query).toBe('repo:acme/payments');
  });

  it('`audit.view` — 감사 조회', async () => {
    const session = await login(['developer', 'security_officer']);
    await app.inject({ method: 'GET', url: AUDIT_RECORDS_PATH, headers: cookie(session) });
    expect(await recorded('audit.view')).toBeGreaterThan(0);
  });

  it('**질의를 남기되 응답 본문은 남기지 않는다** (보안 7.1)', async () => {
    const session = await login(['developer', 'security_officer']);
    /*
     * **응답을 내는 경로를 모두 지난다.** 검색 하나만 부르면 `audit.view`의
     * 기록이 아예 만들어지지 않아 그 경로의 유출을 볼 수 없다 — 변이 M7이
     * 그 구멍을 드러냈다(감사 조회 응답의 `items`를 자기 기록에 담아도
     * 시험이 살아남았다).
     */
    await app.inject({
      method: 'GET',
      url: `${SEARCH_PATH}?q=is%3Amerged`,
      headers: cookie(session),
    });
    await app.inject({ method: 'GET', url: AUDIT_RECORDS_PATH, headers: cookie(session) });

    const rows = await auditRepo.listAuditRecords(pool, { userId: USER }, 50);
    expect(rows.length).toBeGreaterThan(1);
    // 두 액션이 모두 있어야 이 시험이 뜻을 갖는다.
    expect(rows.map((row) => row.action)).toEqual(
      expect.arrayContaining(['search.execute', 'audit.view']),
    );

    for (const row of rows) {
      const query = row.query ?? '';
      // 응답이 담는 키가 감사에 나타나면 감사 로그가 유출 경로가 된다.
      expect(query, row.action).not.toContain('"items"');
      expect(query, row.action).not.toContain('"total"');
      expect(query, row.action).not.toContain('"correlation_id"');
      expect(query, row.action).not.toContain('"next_cursor"');
    }
  });
});

describe('미활성 액션은 기록되지 않는다 (DEV-403)', () => {
  it('합성 경로를 만들어 감사만 남기지 않았다', async () => {
    for (const action of NOT_ACTIVATED_AUDIT_ACTIONS) {
      const rows = await auditRepo.listAuditRecords(pool, { action }, 5);
      expect(rows, action).toHaveLength(0);
    }
  });
});
