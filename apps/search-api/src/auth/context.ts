/**
 * 인증 컨텍스트 조립 (CR-015, DEV-047·DEV-048).
 *
 * `search-api`의 인증은 **세션 읽기 + 접근 범위 산출** 둘뿐이다. OIDC 흐름은
 * `web`만 수행한다 — 인프라 문서의 아웃바운드 허용 목록이 IdP를 `web`에만
 * 열어 준다. 그래서 여기에는 클라이언트 시크릿도 IdP 주소도 없다.
 */

import {
  AccessScopeResolver,
  createScopeDatabase,
  scopeKey,
  type ScopeMetrics,
  type ScopeRedis,
  type SessionRedis,
  type SessionStore,
  type AccessScopeSource,
} from '@prs/authz';
import type { Pool } from '@prs/db';
import { Counter } from '@prs/metrics';

import { RegisteringSessionStore } from './registration.js';

/** 세션과 접근 범위가 함께 쓰는 Redis 명령. */
export type AuthRedis = SessionRedis & ScopeRedis;

export interface AuthContext {
  /**
   * 기반 타입으로 선언한다.
   *
   * 조립은 `RegisteringSessionStore`를 넣지만(`DEV-613`), **시험은 정본 없이
   * 순수 `SessionStore`를 넣을 수 있어야 한다** — 정본 등록은 이 컨텍스트를 쓰는
   * 쪽의 관심사가 아니고, 좁게 선언하면 세션만 필요한 시험이 DB까지 세우게 된다.
   */
  readonly sessions: SessionStore;
  readonly scopes: AccessScopeResolver;
  /** 무효화가 Redis 캐시를 지우는 방법. `ops` 경로가 쓴다. */
  forget(userIds: readonly string[]): Promise<void>;
}

/** 캐시 적중률 지표 (FR-AUTH-003 AC-5). */
export interface AuthMetrics extends ScopeMetrics {
  readonly scopeLookups: Counter;
  render(): readonly Counter[];
}

export function createAuthMetrics(): AuthMetrics {
  const scopeLookups = new Counter(
    'access_scope_lookup_total',
    '접근 범위 조회 건수. 라벨 outcome: redis|postgres|miss|failed|fenced',
  );

  return {
    scopeLookups,
    hit: (layer) => scopeLookups.inc({ outcome: layer }),
    miss: () => scopeLookups.inc({ outcome: 'miss' }),
    refreshFailed: () => scopeLookups.inc({ outcome: 'failed' }),
    fenced: () => scopeLookups.inc({ outcome: 'fenced' }),
    render: () => [scopeLookups],
  };
}

export interface AuthContextOptions {
  readonly redis: AuthRedis;
  readonly pool: Pool;
  readonly source: AccessScopeSource;
  readonly metrics?: ScopeMetrics;
  /** 정본 등록 실패(`DEV-613`)와 접근 범위 조회 실패(`DEV-698`)를 남길 곳. */
  readonly log?: ((message: string, detail: Record<string, unknown>) => void) | undefined;
}

export function createAuthContext(options: AuthContextOptions): AuthContext {
  /*
   * 세션을 읽는 김에 **정본에 사용자 행이 있게 한다** (`DEV-613`).
   *
   * 설계는 로그인이 그 행을 만드는 것이었으나 그 코드가 없었고, 그래서 로그인
   * 직후 첫 조회가 `503 permission_unavailable`이 됐다. `web`은 DB에 닿지
   * 않으므로 세션을 읽는 이 자리가 경계를 가장 덜 건드리는 곳이다. 자세한
   * 근거는 `registration.ts`의 머리글에 있다.
   */
  const sessions = new RegisteringSessionStore({
    redis: options.redis,
    pool: options.pool,
    log: options.log,
  });
  const scopes = new AccessScopeResolver({
    redis: options.redis,
    db: createScopeDatabase(options.pool),
    source: options.source,
    ...(options.metrics === undefined ? {} : { metrics: options.metrics }),
    // 503의 사유는 응답이 아니라 운영자 로그가 말한다 (CR-092 / DEV-698).
    log: options.log,
  });

  return {
    sessions,
    scopes,
    forget: async (userIds) => {
      if (userIds.length === 0) return;
      await options.redis.del(...userIds.map(scopeKey));
    },
  };
}
