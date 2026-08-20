/**
 * @prs/github — GitHub Enterprise REST 클라이언트와 rate limit 관리 (WP-006).
 *
 * **Search/Data Plane 전용이다.** 읽기 전용 Data App 설치 토큰으로 동작하고,
 * `gh` CLI를 실행하지 않으며, 사용자 위임 신원을 다루지 않는다. 사용자가 요청한
 * GitHub 작업은 Operations Plane(REL-007 이후)의 몫이며 신원·권한·감사 경계가
 * 분리되어 있다 (ADR-013, ADR-014).
 */

export const PACKAGE_NAME = '@prs/github' as const;

export {
  resolveGitHubConfig,
  hasAppCredentials,
  parseInstallations,
  QUARANTINE_THRESHOLD,
  TOKEN_REFRESH_LEAD_MS,
} from './config.js';
export type { GitHubAppConfig, GitHubEnv } from './config.js';

export { redact, safeMessage, REDACTED } from './redact.js';

export { GitHubApiError, classifyStatus } from './errors.js';
export type { GitHubErrorKind } from './errors.js';

export { createAppJwt } from './jwt.js';
export type { AppJwtOptions } from './jwt.js';

export {
  INITIAL_STATE,
  applyResponse,
  applySecondaryLimit,
  isAvailable,
  parseRateLimitHeaders,
  parseRetryAfter,
} from './rate-limit.js';
export type { QuarantineReason, RateLimitSnapshot, TokenRateLimitState } from './rate-limit.js';

export { InstallationTokenProvider, isExpiring } from './token-provider.js';
export type { InstallationToken, TokenProviderOptions } from './token-provider.js';

export { TokenPool } from './token-pool.js';
export type { InstallationBinding, LeasedToken, PoolOptions } from './token-pool.js';

export { RequestScheduler } from './scheduler.js';
export type { RequestPriority, SchedulerOptions } from './scheduler.js';

export { GitHubTransport } from './transport.js';
export type { PagedResult, RequestOptions, TransportEvent, TransportOptions } from './transport.js';

export { GitHubClient, MAX_CHANGED_FILES, MAX_PR_COMMITS } from './client.js';
export type {
  CallOptions,
  ChangedFile,
  CollaboratorSummary,
  CommitSummary,
  PullRequestSummary,
  ReleaseSummary,
  RepoRef,
  RepositorySummary,
  ReviewSummary,
  TagSummary,
  TeamSummary,
} from './client.js';
