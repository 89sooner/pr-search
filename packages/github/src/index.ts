/**
 * @prs/github — GitHub Enterprise REST 클라이언트와 rate limit 관리 (WP-006).
 *
 * **Search/Data Plane 전용이다.** 읽기 전용 Data App 설치 토큰으로 동작하고,
 * `gh` CLI를 실행하지 않으며, 사용자 위임 신원을 다루지 않는다. 사용자가 요청한
 * GitHub 작업은 Operations Plane(REL-007 이후)의 몫이며 신원·권한·감사 경계가
 * 분리되어 있다 (ADR-013, ADR-014).
 */

export const PACKAGE_NAME = '@prs/github' as const;
export { GitHubSourceReader } from './source-reader.js';
export type { SourceGitCommit, SourceRestCommit, SourceRestFile, SourceContent, SourceGitTree, SourcePr } from './source-reader.js';

export {
  resolveGitHubConfig,
  hasAppCredentials,
  parseInstallations,
  QUARANTINE_THRESHOLD,
  TOKEN_REFRESH_LEAD_MS,
} from './config.js';
export { resolveMirrorConfig, DEFAULT_MIRROR_ROOT } from './config.js';
export type { GitHubAppConfig, GitHubEnv, MirrorConfig } from './config.js';

export {
  authArgs,
  branchRef,
  diskUsageRatio,
  firstParentChain,
  gitEnv,
  GraphInputError,
  isFullSha,
  isSafeBranch,
  MIRROR_DISK_ALERT_RATIO,
  mirrorPath,
  parseFirstParentCommits,
  parsePatchId,
  parseRevList,
  readAncestorExit,
  revRangeArg,
} from './graph-plan.js';
export type { FirstParentCommit, GitEnvOptions, ParentLink, RevRange } from './graph-plan.js';

export { CommitGraphError, FallbackCommitGraph, selectCommitGraph } from './commit-graph.js';
export type { CommitGraph, CommitGraphKind, PatchIdResult, PatchIdUnavailable } from './commit-graph.js';

export { MirrorCommitGraph, nodeGitRunner } from './mirror-graph.js';
export type { GitExecResult, GitRunner, GitRunOptions, MirrorGraphOptions, MirrorTag } from './mirror-graph.js';

export { ApiCommitGraph, DEFAULT_MAX_API_COMMITS } from './api-graph.js';
export type { ApiGraphOptions } from './api-graph.js';

export { MirrorSync, MirrorSyncError, mirrorDiskUsage, MIRROR_SYNC_TIMEOUT_MS } from './mirror-sync.js';
export type { MirrorSyncOptions, MirrorSyncResult, MirrorSyncAction } from './mirror-sync.js';

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

export { GitHubTransport, parseNextPage } from './transport.js';
export type { PagedResult, PageResponse, RequestOptions, TransportEvent, TransportOptions } from './transport.js';

export { GitHubClient, MAX_CHANGED_FILES, MAX_PR_COMMITS, resolveVisibility, toPullRequestEvidence } from './client.js';
export type {
  CallOptions,
  ChangedFile,
  CollaboratorSummary,
  CommitPullRequestsPage,
  CommitSummary,
  PermissionSummary,
  PullRequestEvidence,
  PullRequestSummary,
  ReleaseSummary,
  CompareResult,
  RepoRef,
  RepositorySummary,
  ReviewSummary,
  TagSummary,
  TeamMemberSummary,
  TeamSummary,
} from './client.js';
