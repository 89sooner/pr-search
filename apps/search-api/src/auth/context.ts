/**
 * 인증 컨텍스트 조립 (CR-015, DEV-047·DEV-048).
 *
 * `search-api`의 인증은 **세션 읽기 + 접근 범위 산출** 둘뿐이다. OIDC 흐름은
 * `web`만 수행한다 — 인프라 문서의 아웃바운드 허용 목록이 IdP를 `web`에만
 * 열어 준다. 그래서 여기에는 클라이언트 시크릿도 IdP 주소도 없다.
 */

import {
  AccessScopeResolver,
  SessionStore,
  createScopeDatabase,
  scopeKey,
  type ScopeMetrics,
  type ScopeRedis,
  type SessionRedis,
  type AccessScopeSource,
} from '@prs/authz';
import type { Pool } from '@prs/db';
import { Counter } from '@prs/metrics';

/** 세션과 접근 범위가 함께 쓰는 Redis 명령. */
export type AuthRedis = SessionRedis & ScopeRedis;

export interface AuthContext {
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
}

export function createAuthContext(options: AuthContextOptions): AuthContext {
  const sessions = new SessionStore({ redis: options.redis });
  const scopes = new AccessScopeResolver({
    redis: options.redis,
    db: createScopeDatabase(options.pool),
    source: options.source,
    ...(options.metrics === undefined ? {} : { metrics: options.metrics }),
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
