/**
 * @prs/authz — 인증과 접근 범위 강제 (WP-012).
 *
 * 이 패키지는 HTTP 서버도 Fastify도 Next.js도 모른다. 세 가지 일만 한다.
 *
 *   1. **누구인가** — OIDC 흐름과 서버 측 세션 (FR-AUTH-001)
 *   2. **무엇을 볼 수 있는가** — 접근 범위 산출과 캐시 (FR-AUTH-002, FR-AUTH-003)
 *   3. **무엇을 할 수 있는가** — 역할 (보안 문서 5.1)
 *
 * 강제 결합 자체(`applyMandatoryScopeFilter`, `ScopedQuery`)는 `@prs/es`가
 * 소유한다 — 그것은 Elasticsearch 질의의 성질이고, 여기서 다시 정의하면
 * 우회 가능한 두 번째 경로가 생긴다 (ADR-008).
 */

export const PACKAGE_NAME = '@prs/authz' as const;

export { AuthError, ForbiddenRoleError, OidcError, UnauthenticatedError } from './errors.js';

export {
  ADMIN_ASSIGNED_ROLES,
  DEFAULT_ROLE,
  IDP_ASSIGNABLE_ROLES,
  ROLES,
  composeRoles,
  hasRole,
  isRole,
  parseGroupRoleMap,
  withAssignedRoles,
} from './roles.js';
export type { GroupRoleMap, Role } from './roles.js';

export { codeChallengeOf, createAuthorizationRequest, sanitizeReturnPath, statesMatch } from './pkce.js';
export type { AuthorizationRequest } from './pkce.js';

export {
  JWKS_REFRESH_COOLDOWN_MS,
  JWKS_TTL_MS,
  JwksCache,
  SUPPORTED_ALGORITHMS,
  isSupportedAlgorithm,
} from './jwks.js';
export type { JwksCacheOptions, JwksFetcher, SupportedAlgorithm } from './jwks.js';

export { CLOCK_SKEW_SECONDS, verifyIdToken } from './id-token.js';
export type { IdTokenClaims, VerifyOptions } from './id-token.js';

export { buildAuthorizationUrl, exchangeCode, fetchJwks, fetchTokenExchanger } from './oidc.js';
export type { OidcProviderConfig, TokenExchanger, TokenResponse } from './oidc.js';

export {
  buildGitHubAuthorizationUrl,
  defaultGitHubScopes,
  exchangeGitHubCode,
  fetchGitHubApiReader,
  fetchGitHubIdentity,
  fetchGitHubTokenExchanger,
  gitHubAuthorizationEndpoint,
  gitHubTokenEndpoint,
} from './github-oauth.js';
export type {
  GitHubApiReader,
  GitHubAuthConfig,
  GitHubIdentity,
  GitHubTokenExchanger,
  GitHubTokenResponse,
} from './github-oauth.js';

export {
  ABSOLUTE_TIMEOUT_MS,
  IDLE_TIMEOUT_MS,
  INSECURE_SESSION_COOKIE_NAME,
  SESSION_COOKIE_NAME,
  createSessionId,
  deadlinesOf,
  expiryOf,
  readSessionCookie,
  remainingTtlSeconds,
  serializeClearingCookie,
  serializeSessionCookie,
  sessionCookieName,
  sessionIdsMatch,
} from './session.js';
export type { CookieOptions, ExpiryReason, SessionDeadlines, SessionRecord } from './session.js';

export {
  SESSION_KEY_PREFIX,
  SessionStore,
  TOUCH_INTERVAL_MS,
  cookieMaxAgeSeconds,
  parseSession,
  sessionKey,
} from './session-store.js';
export type { LoadedSession, SessionRedis, SessionStoreOptions } from './session-store.js';

export {
  AccessScopeLookupError,
  DEFAULT_REPOSITORY_CONCURRENCY,
  GheAccessScopeSource,
  SCOPE_STAGE_PERMISSION,
  ghePermissionApi,
  isReadable,
} from './scope-source.js';
export type {
  AccessScopeLookupStage,
  AccessScopeSource,
  CollaboratorPermission,
  GhePermissionApi,
  GheScopeSourceOptions,
  RawAccessScope,
  RegisteredRepository,
} from './scope-source.js';

export {
  AccessScopeResolver,
  CACHE_TTL_MS,
  CACHE_TTL_SECONDS,
  DEFAULT_MAX_CONCURRENT_REFRESH,
  EXPLICIT_SCOPE_LIMIT,
  SCOPE_KEY_PREFIX,
  ScopeUnavailableError,
  describeScopeFailure,
  parseCachedScope,
  scopeKey,
  toAccessScope,
} from './scope.js';
export { createScopeDatabase } from './scope-database.js';
export { applyMandatoryScopeFilter, shouldUseOrgTeamScope } from '@prs/es';
export type { AccessScope, ExplicitAccessScope, OrgTeamAccessScope, ScopedQuery } from '@prs/es';
export type {
  CachedScope,
  ScopeDatabase,
  ScopeMetrics,
  ScopeRedis,
  ScopeResolverOptions,
} from './scope.js';

export {
  applyInvalidation,
  extractInvalidationTarget,
  isEmptyTarget,
  toEventPayload,
} from './invalidation.js';
export type {
  InvalidationContext,
  InvalidationPorts,
  InvalidationReason,
  InvalidationResult,
  InvalidationTarget,
  PermissionInvalidated,
} from './invalidation.js';

export {
  groupsClaimName,
  hasAuthCredentials,
  hasGitHubAuthCredentials,
  hasOidcCredentials,
  insecureCookiesAllowed,
  resolveAllowInsecureCookies,
  resolveAuthProvider,
  resolveGitHubAuthConfig,
  resolveOidcConfig,
  resolveSessionReaderConfig,
  resolveTeamRoleMap,
} from './config.js';
export { refreshTeamScope, syncRepositoryTeamScope } from './team-scope.js';
export type { RepositoryTeamsSource, TeamScopeDeps, TeamScopeIndex, TeamSyncOutcome } from './team-scope.js';
export type { AuthEnv, AuthProvider, SessionReaderConfig } from './config.js';
