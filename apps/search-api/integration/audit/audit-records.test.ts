/**
 * API-ADM-005 감사 기록 조회 — 실제 Fastify + PostgreSQL + Redis
 * (WP-039 DoD / FR-AUTH-004, NFR-006, QA-A004-01~10, CR-054).
 *
 * ## 왜 실제 DB인가
 *
 * 이 경로가 실제로 지키는 것은 **키셋 순회의 전순서**와 **파티션 테이블 위의
 * 필터**다. 목으로는 `(occurred_at, audit_id) < (x, y)` 행 값 비교가 같은
 * 밀리초의 무리를 어떻게 가르는지 확인할 수 없고, 그 자리가 정확히 기록이
 * 빠지거나 겹치는 곳이다.
 *
 * ## 공유 자원 규율
 *
 * `prs_test`는 다른 파일과 함께 쓴다. **자기 행만 만들고 자기 행만 지운다** —
 * 전역 `DELETE FROM audit_record`는 남의 픽스처를 지우고, 그 실패는 원인이
 * 있는 곳과 증상이 나타나는 곳이 다르다 (2026-08-29 세션이 네 번째로 밟았다).
 * 사용자 ID에 이 파일 고유 접두를 붙여 그것을 보장한다.
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
import { auditRepo, authRepo, type Pool } from '@prs/db';
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

/** 이 파일 고유 접두. 남의 픽스처와 섞이지 않게 한다. */
const NS = 'wp039-audit';
const OFFICER = `${NS}-officer`;
const OPERATOR = `${NS}-operator`;
const DEVELOPER = `${NS}-developer`;
/** 기록의 주체. 조사자와 다르다 — 감사는 남의 행위를 본다. */
const ACTOR = `${NS}-actor`;

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

/** 이 파일이 만든 행만 지운다. */
async function clearOwnRecords(): Promise<void> {
  await pool.query('DELETE FROM audit_record WHERE user_id LIKE $1', [`${NS}%`]);
}

interface SeedRow {
  readonly action: string;
  readonly target?: string | null;
  readonly query?: string | null;
  readonly resultCode?: string;
  readonly occurredAt?: string;
  readonly userId?: string;
}

async function seed(rows: readonly SeedRow[]): Promise<void> {
  for (const row of rows) {
    await pool.query(
      `INSERT INTO audit_record (user_id, action, target, query, result_code, correlation_id, occurred_at)
       VALUES ($1, $2, $3, $4, $5, gen_random_uuid(), COALESCE($6::timestamptz, now()))`,
      [
        row.userId ?? ACTOR,
        row.action,
        row.target ?? null,
        row.query ?? null,
        row.resultCode ?? 'ok',
        row.occurredAt ?? null,
      ],
    );
  }
}

interface ListBody {
  readonly items: readonly {
    readonly user_id: string;
    readonly action: string;
    readonly target: string | null;
    readonly query: string | null;
    readonly occurred_at: string;
    readonly result_code: string;
    readonly correlation_id: string;
  }[];
  readonly next_cursor: string | null;
}

async function list(sessionId: string, search = ''): Promise<{ status: number; body: ListBody }> {
  const response = await app.inject({
    method: 'GET',
    url: search === '' ? AUDIT_RECORDS_PATH : `${AUDIT_RECORDS_PATH}?${search}`,
    headers: cookie(sessionId),
  });
  return { status: response.statusCode, body: response.json() as ListBody };
}

beforeAll(async () => {
  pool = await migratedPool({ fixtureMonths: ['2026-08'] });
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
          repositoryIds: [9101],
          orgIds: [91],
          teamIds: [910],
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
  await clearOwnRecords();
  for (const [user, roles] of [
    [OFFICER, ['developer', 'security_officer']],
    [OPERATOR, ['developer', 'operator']],
    [DEVELOPER, ['developer']],
  ] as const) {
    await authRepo.upsertUserOnLogin(pool, {
      user_id: user,
      login: user,
      // github_user_id는 유니크다. 파일 고유 대역을 쓴다 — 로컬에 없어도
      // CI에서 충돌한 적이 있다 (2026-08-29 세션).
      github_user_id: 39_000 + user.length,
    });
    await authRepo.setAssignedRoles(pool, user, [...roles]);
  }
});

afterAll(async () => {
  await clearOwnRecords();
  await app?.close();
  await redis?.quit();
  await pool?.end();
});

describe('QA-A004-04: security_officer 전용이다 (AC-5)', () => {
  it('`security_officer`는 200을 받는다', async () => {
    const session = await login(OFFICER, ['developer', 'security_officer']);
    const { status } = await list(session);
    expect(status).toBe(200);
  });

  it('**`operator`도 403이다** — 권한 매트릭스가 A-004를 그 역할에서 뺀다', async () => {
    const session = await login(OPERATOR, ['developer', 'operator']);
    const response = await app.inject({
      method: 'GET',
      url: AUDIT_RECORDS_PATH,
      headers: cookie(session),
    });
    expect(response.statusCode).toBe(403);
  });

  it('`developer`는 403이다', async () => {
    const session = await login(DEVELOPER, ['developer']);
    const response = await app.inject({
      method: 'GET',
      url: AUDIT_RECORDS_PATH,
      headers: cookie(session),
    });
    expect(response.statusCode).toBe(403);
  });

  it('세션이 없으면 401이다', async () => {
    const response = await app.inject({ method: 'GET', url: AUDIT_RECORDS_PATH });
    expect(response.statusCode).toBe(401);
  });
});

describe('QA-A004-01: 다섯 축으로 필터한다', () => {
  beforeEach(async () => {
    await seed([
      { action: 'search.execute', query: 'repo:acme/payments', occurredAt: '2026-08-20T00:00:00Z' },
      {
        action: 'entity.view',
        target: 'commit:acme/payments:abc',
        occurredAt: '2026-08-21T00:00:00Z',
      },
      {
        action: 'repository.register',
        target: 'acme/other',
        resultCode: 'FORBIDDEN_ROLE',
        occurredAt: '2026-08-22T00:00:00Z',
        userId: `${NS}-other`,
      },
    ]);
  });

  it('`user_id`로 좁힌다', async () => {
    const session = await login(OFFICER, ['developer', 'security_officer']);
    const { body } = await list(session, `user_id=${NS}-other`);
    const mine = body.items.filter((row) => row.user_id.startsWith(NS));
    expect(mine).toHaveLength(1);
    expect(mine[0]?.action).toBe('repository.register');
  });

  it('`action`으로 좁힌다', async () => {
    const session = await login(OFFICER, ['developer', 'security_officer']);
    const { body } = await list(session, 'action=entity.view');
    const mine = body.items.filter((row) => row.user_id.startsWith(NS));
    expect(mine).toHaveLength(1);
    expect(mine[0]?.target).toBe('commit:acme/payments:abc');
  });

  it('`target`으로 좁힌다', async () => {
    const session = await login(OFFICER, ['developer', 'security_officer']);
    const { body } = await list(session, 'target=acme/other');
    const mine = body.items.filter((row) => row.user_id.startsWith(NS));
    expect(mine).toHaveLength(1);
  });

  it('`result_code`로 좁힌다', async () => {
    const session = await login(OFFICER, ['developer', 'security_officer']);
    const { body } = await list(session, 'result_code=FORBIDDEN_ROLE');
    const mine = body.items.filter((row) => row.user_id.startsWith(NS));
    expect(mine).toHaveLength(1);
  });

  it('기간으로 좁힌다 — `from` 이상 `to` 미만', async () => {
    const session = await login(OFFICER, ['developer', 'security_officer']);
    const { body } = await list(
      session,
      'from=2026-08-21T00:00:00Z&to=2026-08-22T00:00:00Z&user_id=' + ACTOR,
    );
    expect(body.items).toHaveLength(1);
    expect(body.items[0]?.action).toBe('entity.view');
  });

  it('조건을 겹쳐 쓴다', async () => {
    const session = await login(OFFICER, ['developer', 'security_officer']);
    const { body } = await list(session, `user_id=${ACTOR}&action=search.execute`);
    expect(body.items).toHaveLength(1);
  });

  it('빈 문자열 조건은 400이다 — 조용히 무시하지 않는다', async () => {
    const session = await login(OFFICER, ['developer', 'security_officer']);
    const response = await app.inject({
      method: 'GET',
      url: `${AUDIT_RECORDS_PATH}?action=`,
      headers: cookie(session),
    });
    expect(response.statusCode).toBe(400);
  });
});

describe('QA-A004-02·10: 필수 필드와 `null` 정직성', () => {
  it('일곱 필드를 모두 낸다 (AC-2)', async () => {
    await seed([{ action: 'entity.view', target: 'pull_request:acme/payments:12' }]);
    const session = await login(OFFICER, ['developer', 'security_officer']);
    const { body } = await list(session, `user_id=${ACTOR}`);
    const row = body.items[0];
    expect(row).toBeDefined();
    expect(Object.keys(row ?? {}).sort()).toEqual(
      ['action', 'correlation_id', 'occurred_at', 'query', 'result_code', 'target', 'user_id'].sort(),
    );
  });

  it('`target`·`query`가 없으면 `null`이다 — `N/A`를 지어내지 않는다', async () => {
    await seed([{ action: 'search.execute', target: null, query: 'is:merged' }]);
    const session = await login(OFFICER, ['developer', 'security_officer']);
    const { body } = await list(session, `user_id=${ACTOR}&action=search.execute`);
    expect(body.items[0]?.target).toBeNull();
    expect(body.items[0]?.query).toBe('is:merged');
  });
});

describe('감사 대상 값의 정본 (PR #84 리뷰)', () => {
  it('`dead_letter.reprocess`의 대상은 **전달 식별자**다', async () => {
    // 내부 `dead_letter_id`는 그 행을 가리킬 뿐이고, 필터 문자열은 무엇이
    // 재처리됐는지 말하지 않는다 — 일치 집합이 직후에 달라질 수 있다.
    await seed([
      {
        action: 'dead_letter.reprocess',
        target: '8f2c1e40-aaaa-4bbb-8ccc-000000000001,8f2c1e40-aaaa-4bbb-8ccc-000000000002',
        query: JSON.stringify({ dead_letter_ids: [11, 12], filter: null }),
        resultCode: '2',
      },
    ]);
    const session = await login(OFFICER, ['developer', 'security_officer']);
    const { body } = await list(session, 'action=dead_letter.reprocess');
    const row = body.items.find((item) => item.user_id.startsWith(NS));
    expect(row?.target).toContain('8f2c1e40');
    // 어떻게 골랐는지는 조건이므로 `query`가 담는다.
    expect(row?.query).toContain('dead_letter_ids');
  });

  it('`saved_search.update`는 **바뀐 뒤의 질의**를 남긴다', async () => {
    // `patch.query`만 담으면 이름만 고친 수정이 `null`을 남기고, 나중에
    // 그 항목이 삭제되면 어떤 공유 검색을 건드렸는지 알 수 없다.
    await seed([
      {
        action: 'saved_search.update',
        target: '77',
        query: 'repo:acme/payments is:merged',
        resultCode: 'updated',
      },
    ]);
    const session = await login(OFFICER, ['developer', 'security_officer']);
    const { body } = await list(session, 'action=saved_search.update');
    const row = body.items.find((item) => item.user_id.startsWith(NS));
    expect(row?.query).toBe('repo:acme/payments is:merged');
  });
});

describe('QA-A004-08: legacy 어휘도 조회할 수 있다 (AC-7)', () => {
  it('정본 표에 없는 `sequence_integrity.reassign`을 찾는다', async () => {
    // WP-028이 기록한 값. AC-3이 갱신을 금지하므로 그대로 남아 있다.
    await seed([{ action: 'sequence_integrity.reassign', target: 'acme/payments@main' }]);
    const session = await login(OFFICER, ['developer', 'security_officer']);
    const { body } = await list(session, 'action=sequence_integrity.reassign');
    const mine = body.items.filter((row) => row.user_id.startsWith(NS));
    expect(mine).toHaveLength(1);
    expect(mine[0]?.action).toBe('sequence_integrity.reassign');
  });
});

describe('QA-A004-09: 커서 순회', () => {
  beforeEach(async () => {
    // **같은 밀리초에 여럿을 넣는다** — 타이브레이커가 없으면 여기서 기록이
    // 빠지거나 겹친다. 경계를 비켜 가면 그 규칙은 코드에만 있다.
    const same = '2026-08-25T12:00:00.000Z';
    await seed([
      { action: 'search.execute', query: 'q1', occurredAt: same },
      { action: 'search.execute', query: 'q2', occurredAt: same },
      { action: 'search.execute', query: 'q3', occurredAt: same },
      { action: 'search.execute', query: 'q4', occurredAt: same },
    ]);
  });

  it('페이지를 이어도 중복·누락이 없다', async () => {
    const session = await login(OFFICER, ['developer', 'security_officer']);
    const filter = `user_id=${ACTOR}&action=search.execute`;

    const first = await list(session, `${filter}&limit=2`);
    expect(first.body.items).toHaveLength(2);
    expect(first.body.next_cursor).not.toBeNull();

    const second = await list(
      session,
      `${filter}&limit=2&cursor=${encodeURIComponent(first.body.next_cursor ?? '')}`,
    );
    expect(second.body.items).toHaveLength(2);

    const seen = [...first.body.items, ...second.body.items].map((row) => row.query);
    expect(new Set(seen).size).toBe(4);
    expect(seen.sort()).toEqual(['q1', 'q2', 'q3', 'q4']);
  });

  it('마지막 페이지의 `next_cursor`는 `null`이다', async () => {
    const session = await login(OFFICER, ['developer', 'security_officer']);
    const { body } = await list(session, `user_id=${ACTOR}&action=search.execute&limit=100`);
    expect(body.next_cursor).toBeNull();
  });

  it('위조된 커서는 `CURSOR_INVALID`다', async () => {
    const session = await login(OFFICER, ['developer', 'security_officer']);
    const response = await app.inject({
      method: 'GET',
      url: `${AUDIT_RECORDS_PATH}?cursor=forged.signature`,
      headers: cookie(session),
    });
    expect(response.statusCode).toBe(400);
    expect((response.json() as { error: { code: string } }).error.code).toBe('CURSOR_INVALID');
  });

  it('조건을 바꾸고 옛 커서를 쓰면 `CURSOR_QUERY_MISMATCH`다', async () => {
    const session = await login(OFFICER, ['developer', 'security_officer']);
    const first = await list(session, `user_id=${ACTOR}&limit=1`);
    const cursorValue = first.body.next_cursor ?? '';

    const response = await app.inject({
      method: 'GET',
      url: `${AUDIT_RECORDS_PATH}?user_id=${ACTOR}&action=entity.view&limit=1&cursor=${encodeURIComponent(cursorValue)}`,
      headers: cookie(session),
    });
    expect(response.statusCode).toBe(400);
    expect((response.json() as { error: { code: string } }).error.code).toBe('CURSOR_QUERY_MISMATCH');
  });

  it('`limit` 상한을 넘으면 400이다', async () => {
    const session = await login(OFFICER, ['developer', 'security_officer']);
    const response = await app.inject({
      method: 'GET',
      url: `${AUDIT_RECORDS_PATH}?limit=101`,
      headers: cookie(session),
    });
    expect(response.statusCode).toBe(400);
  });
});

describe('QA-A004-05: 조회 자체가 감사 대상이다 (AC-8)', () => {
  it('`audit.view`가 기록된다', async () => {
    const session = await login(OFFICER, ['developer', 'security_officer']);
    await list(session, `user_id=${ACTOR}`);

    const records = await auditRepo.listAuditRecords(pool, { userId: OFFICER, action: 'audit.view' }, 10);
    expect(records.length).toBeGreaterThan(0);
    expect(records[0]?.target).toBeNull();
    expect(records[0]?.query).toContain(ACTOR);
  });

  it('**자기 자신이 그 응답에 나타나지 않는다** — 응답 확정 뒤에 기록한다', async () => {
    const session = await login(OFFICER, ['developer', 'security_officer']);
    const first = await list(session, `user_id=${OFFICER}&action=audit.view`);
    expect(first.body.items).toHaveLength(0);

    // 다음 조회부터 보인다.
    const second = await list(session, `user_id=${OFFICER}&action=audit.view`);
    expect(second.body.items.length).toBeGreaterThan(0);
  });

  it('403을 받은 요청은 `audit.view`를 남기지 않는다 — 조회가 없었다', async () => {
    const session = await login(OPERATOR, ['developer', 'operator']);
    await app.inject({ method: 'GET', url: AUDIT_RECORDS_PATH, headers: cookie(session) });

    const records = await auditRepo.listAuditRecords(pool, { userId: OPERATOR }, 10);
    expect(records).toHaveLength(0);
  });
});

describe('정렬', () => {
  it('최근 순이다 — 같은 시각은 `audit_id` 내림차순', async () => {
    await seed([
      { action: 'job.run', target: 'a', occurredAt: '2026-08-10T00:00:00Z' },
      { action: 'job.run', target: 'b', occurredAt: '2026-08-12T00:00:00Z' },
      { action: 'job.run', target: 'c', occurredAt: '2026-08-11T00:00:00Z' },
    ]);
    const session = await login(OFFICER, ['developer', 'security_officer']);
    const { body } = await list(session, `user_id=${ACTOR}&action=job.run`);
    expect(body.items.map((row) => row.target)).toEqual(['b', 'c', 'a']);
  });
});

describe('갱신·삭제 경로가 없다 (AC-3)', () => {
  it('`PATCH`·`DELETE`·`POST`가 모두 404·405다', async () => {
    const session = await login(OFFICER, ['developer', 'security_officer']);
    for (const method of ['PATCH', 'DELETE', 'POST'] as const) {
      const response = await app.inject({
        method,
        url: AUDIT_RECORDS_PATH,
        headers: cookie(session),
      });
      expect([404, 405], method).toContain(response.statusCode);
    }
  });
});
