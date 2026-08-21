/**
 * search-api 인증 강제 (WP-012 DoD 1, DoD 6, DoD 10).
 *
 * 여기서 확인하는 것은 **신원이 닿는 유일한 길이 세션 쿠키인가**, 그리고
 * 실패가 계약이 정한 상태 코드로 나가는가다.
 */

import { describe, expect, it } from 'vitest';
import {
  ABSOLUTE_TIMEOUT_MS,
  IDLE_TIMEOUT_MS,
  SESSION_COOKIE_NAME,
  SessionStore,
  ScopeUnavailableError,
  type SessionRecord,
  type SessionRedis,
} from '@prs/authz';
import type { FastifyRequest } from 'fastify';
import { NotFoundError, toAuthError } from './errors.js';
import { buildMe, summarizeScope } from './me.js';
import {
  authenticateSession,
  authenticateToken,
  principalId,
  principalRoles,
  requireRole,
  type SessionPrincipal,
} from './principal.js';

const T0 = Date.UTC(2026, 7, 21, 9, 0, 0);
const CORR = '01J9Z';

class FakeRedis implements SessionRedis {
  readonly entries = new Map<string, string>();
  now = T0;

  get(key: string): Promise<string | null> {
    return Promise.resolve(this.entries.get(key) ?? null);
  }
  set(key: string, value: string): Promise<unknown> {
    this.entries.set(key, value);
    return Promise.resolve('OK');
  }
  del(...keys: string[]): Promise<number> {
    let removed = 0;
    for (const key of keys) if (this.entries.delete(key)) removed += 1;
    return Promise.resolve(removed);
  }
  scan(): Promise<[string, string[]]> {
    return Promise.resolve(['0', [...this.entries.keys()]]);
  }
}

function session(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    sessionId: 'sid-1',
    userId: 'sub-1',
    login: 'kim',
    email: 'kim@acme.example',
    roles: ['developer'],
    issuedAt: T0,
    lastSeenAt: T0,
    correlationId: CORR,
    ...overrides,
  };
}

function request(headers: Record<string, string | undefined>): FastifyRequest {
  return { headers } as unknown as FastifyRequest;
}

async function storeWith(record: SessionRecord): Promise<{ store: SessionStore; redis: FakeRedis }> {
  const redis = new FakeRedis();
  const store = new SessionStore({ redis, now: () => redis.now });
  await store.create(record);
  return { store, redis };
}

describe('DEV-047: 신원이 닿는 유일한 길', () => {
  it('세션 쿠키를 Redis에서 해석한다', async () => {
    const { store } = await storeWith(session());
    const principal = await authenticateSession(
      request({ cookie: `${SESSION_COOKIE_NAME}=sid-1` }),
      store,
    );

    expect(principal.userId).toBe('sub-1');
    expect(principal.login).toBe('kim');
  });

  it('신원을 주장하는 헤더를 읽지 않는다', async () => {
    const { store } = await storeWith(session());

    // 클러스터 안 무엇이든 이런 헤더를 붙일 수 있다. 읽는 순간 우회 경로다.
    for (const headers of [
      { 'x-user-id': 'sub-1' },
      { 'x-forwarded-user': 'kim' },
      { 'x-authenticated-user': 'sub-1', 'x-roles': 'operator' },
      { authorization: 'Bearer sub-1' },
    ]) {
      await expect(authenticateSession(request(headers), store)).rejects.toThrow(/세션 쿠키가 없다/);
    }
  });

  it('위조한 쿠키 값은 아무 세션도 열지 못한다', async () => {
    const { store } = await storeWith(session());
    await expect(
      authenticateSession(request({ cookie: `${SESSION_COOKIE_NAME}=forged` }), store),
    ).rejects.toThrow(/세션이 없거나 만료됐다/);
  });

  it('쿠키를 두 번 넣어도 통과하지 않는다 — 쿠키 주입', async () => {
    const { store } = await storeWith(session());
    await expect(
      authenticateSession(
        request({ cookie: `${SESSION_COOKIE_NAME}=forged; ${SESSION_COOKIE_NAME}=sid-1` }),
        store,
      ),
    ).rejects.toThrow(/세션 쿠키가 없다/);
  });

  it('만료된 세션은 인증되지 않는다 (DoD 3)', async () => {
    const { store, redis } = await storeWith(session());
    redis.now = T0 + ABSOLUTE_TIMEOUT_MS + 1;

    await expect(
      authenticateSession(request({ cookie: `${SESSION_COOKIE_NAME}=sid-1` }), store),
    ).rejects.toThrow(/만료/);
  });
});

describe('DoD 10: 권한 매트릭스 (API 계층)', () => {
  /** 보안 문서 5.1의 역할 여섯 × 관리 API 권한. */
  const MATRIX = [
    { roles: ['developer'], operator: false, securityOfficer: false },
    { roles: ['developer', 'manager'], operator: false, securityOfficer: false },
    { roles: ['developer', 'qa'], operator: false, securityOfficer: false },
    { roles: ['developer', 'release_manager'], operator: false, securityOfficer: false },
    { roles: ['developer', 'operator'], operator: true, securityOfficer: false },
    { roles: ['developer', 'security_officer'], operator: false, securityOfficer: true },
  ] as const;

  it.each(MATRIX)('$roles — operator=$operator, security_officer=$securityOfficer', (row) => {
    const principal: SessionPrincipal = {
      kind: 'session',
      userId: 'sub-1',
      login: 'kim',
      roles: row.roles,
      session: session({ roles: row.roles }),
    };

    if (row.operator) {
      expect(() => requireRole(principal, 'operator')).not.toThrow();
    } else {
      expect(() => requireRole(principal, 'operator')).toThrow(/operator/);
    }

    if (row.securityOfficer) {
      expect(() => requireRole(principal, 'security_officer')).not.toThrow();
    } else {
      expect(() => requireRole(principal, 'security_officer')).toThrow(/security_officer/);
    }
  });

  it('THR-016: operator도 데이터 범위는 접근 범위가 정한다', () => {
    // 역할은 화면·액션 접근만 결정한다. 이 파일 어디에도 접근 범위가 없다.
    const principal: SessionPrincipal = {
      kind: 'session',
      userId: 'sub-1',
      login: 'kim',
      roles: ['developer', 'operator'],
      session: session(),
    };
    expect(Object.keys(principal)).not.toContain('scope');
    expect(principalRoles(principal)).toEqual(['developer', 'operator']);
  });
});

describe('DEV-048: 임시 토큰 통제', () => {
  const tokens = [
    { name: 'alice', token: 'tok-alice' },
    { name: 'bob', token: 'tok-bob' },
  ];

  it('일치하는 토큰을 주체로 바꾼다', () => {
    const principal = authenticateToken(request({ authorization: 'Bearer tok-bob' }), tokens);
    expect(principal).toEqual({ kind: 'token', name: 'bob' });
    expect(principalId(principal)).toBe('admin:bob');
  });

  it('틀린 토큰과 없는 토큰을 같은 이유로 거절한다', () => {
    for (const headers of [{ authorization: 'Bearer nope' }, {}, { authorization: 'tok-alice' }]) {
      expect(() => authenticateToken(request(headers), tokens)).toThrow(/관리 API 인증에 실패했다/);
    }
  });

  it('토큰 주체는 operator이되 security_officer는 아니다', () => {
    const principal = authenticateToken(request({ authorization: 'Bearer tok-alice' }), tokens);
    expect(() => requireRole(principal, 'operator')).not.toThrow();
    // 감사 기록 조회는 사람 신원이 있어야 의미가 있다 (FR-AUTH-004 AC-5).
    expect(() => requireRole(principal, 'security_officer')).toThrow();
  });

  it('토큰이 하나도 없으면 아무것도 통과하지 않는다', () => {
    expect(() => authenticateToken(request({ authorization: 'Bearer anything' }), [])).toThrow();
  });
});

describe('오류 매핑 (API 계약 6장)', () => {
  it('미인증은 401 + 재인증 경로다 (DoD 1)', async () => {
    const { store } = await storeWith(session());
    const error = await authenticateSession(request({}), store).catch((e: unknown) => e);
    const shape = toAuthError(error, { correlationId: CORR, loginPath: '/auth/login' });

    expect(shape?.status).toBe(401);
    expect(shape?.body.error.code).toBe('UNAUTHENTICATED');
    expect(shape?.body.error.detail).toEqual({ login_path: '/auth/login' });
  });

  it('역할 부족은 403이며 필요한 역할을 알려 준다', () => {
    const principal: SessionPrincipal = {
      kind: 'session',
      userId: 'sub-1',
      login: 'kim',
      roles: ['developer'],
      session: session(),
    };
    const error = ((): unknown => {
      try {
        requireRole(principal, 'operator');
      } catch (e) {
        return e;
      }
      return null;
    })();

    const shape = toAuthError(error, { correlationId: CORR });
    expect(shape?.status).toBe(403);
    expect(shape?.body.error.code).toBe('FORBIDDEN_ROLE');
  });

  it('접근 범위 밖은 404다 — 403이 아니다 (DoD 5, THR-004)', () => {
    const shape = toAuthError(new NotFoundError(), { correlationId: CORR });
    expect(shape?.status).toBe(404);
    expect(shape?.body.error.code).toBe('NOT_FOUND');
    // 403이면 "권한은 없지만 존재한다"가 되어 존재 여부가 샌다.
    expect(shape?.status).not.toBe(403);
  });

  it('접근 범위 조회 실패는 503이고 부분 결과가 없다 (DoD 6)', () => {
    const shape = toAuthError(new ScopeUnavailableError('GHE 502'), { correlationId: CORR });
    expect(shape?.status).toBe(503);
    expect(shape?.body.error.code).toBe('PERMISSION_UNAVAILABLE');
    // 실패 사유에 GHE 응답이 섞여 나가지 않는다.
    expect(shape?.body.error.message).not.toContain('502');
  });

  it('그 밖의 예외는 여기서 처리하지 않는다', () => {
    expect(toAuthError(new Error('boom'), { correlationId: CORR })).toBeNull();
  });
});

describe('API-AUTH-001 /me (DEV-040)', () => {
  const principal: SessionPrincipal = {
    kind: 'session',
    userId: 'sub-1',
    login: 'kim',
    roles: ['developer', 'operator'],
    session: session(),
  };

  const scopes = (repositoryCount: number) => ({
    resolveCached: async () => ({
      repositoryIds: Array.from({ length: repositoryCount }, (_, i) => i + 1),
      orgIds: [1],
      teamIds: [10, 11],
      visibilities: ['public', 'internal'],
      refreshedAt: T0,
      version: 3,
    }),
  });

  it('사용자·역할·접근 범위 요약을 준다', async () => {
    const body = await buildMe(principal, scopes(128), CORR);

    expect(body.user_id).toBe('sub-1');
    expect(body.login).toBe('kim');
    expect(body.roles).toEqual(['developer', 'operator']);
    expect(body.access_scope).toEqual({
      scope_kind: 'explicit',
      repository_count: 128,
      org_count: 1,
      team_count: 2,
      refreshed_at: new Date(T0).toISOString(),
    });
    expect(body.correlation_id).toBe(CORR);
  });

  it('저장소 ID 목록을 싣지 않는다 — 인벤토리 그 자체다', async () => {
    const body = await buildMe(principal, scopes(600), CORR);
    const serialized = JSON.stringify(body);

    expect(serialized).not.toContain('repository_ids');
    expect(serialized).not.toContain('"repositoryIds"');
    // 600개면 목록이 실렸을 때 응답이 수 KB가 된다.
    expect(serialized.length).toBeLessThan(1000);
  });

  it('org_team 모드에서는 저장소 수가 null이다', async () => {
    const body = await buildMe(principal, scopes(501), CORR);
    expect(body.access_scope.scope_kind).toBe('org_team');
    expect(body.access_scope.repository_count).toBeNull();
  });

  it('세션 만료 두 가지를 모두 알려 준다', async () => {
    const body = await buildMe(principal, scopes(1), CORR);
    expect(body.session.idle_expires_at).toBe(new Date(T0 + IDLE_TIMEOUT_MS).toISOString());
    expect(body.session.absolute_expires_at).toBe(new Date(T0 + ABSOLUTE_TIMEOUT_MS).toISOString());
  });

  it('접근 범위 조회가 실패하면 부분 응답 없이 던진다', async () => {
    const failing = {
      resolveCached: (): Promise<never> => Promise.reject(new ScopeUnavailableError('GHE 502')),
    };
    await expect(buildMe(principal, failing, CORR)).rejects.toThrow(ScopeUnavailableError);
  });

  it('요약은 500을 경계로 모드를 바꾼다', () => {
    const base = { orgIds: [1], teamIds: [], visibilities: [], refreshedAt: T0, version: 0 };
    const at500 = summarizeScope({ ...base, repositoryIds: Array.from({ length: 500 }, (_, i) => i) });
    const at501 = summarizeScope({ ...base, repositoryIds: Array.from({ length: 501 }, (_, i) => i) });

    expect(at500.scope_kind).toBe('explicit');
    expect(at500.repository_count).toBe(500);
    expect(at501.scope_kind).toBe('org_team');
  });
});
