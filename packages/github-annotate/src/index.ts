/**
 * @prs/github-annotate — PR 제목 M 넘버 표기의 쓰기 경계 (WP-075 / FR-SEQ-009, ADR-022).
 *
 * **이 제품에서 사람의 지시 없이 GHE를 고치는 유일한 경로다.** 그래서 조회용
 * `@prs/github`과 **다른 패키지**로 둔다 — 같은 패키지에 있으면 `search-api`의
 * 의존 그래프가 쓰기 코드를 포함하게 되고, 보안 문서 13장이 말하는 「세 번째
 * 경계」가 이름만 남는다. 이 패키지를 의존하는 앱은 `pipeline-worker` 하나이며
 * 그 안에서도 `annotate` 역할만 자격을 받는다.
 *
 * 쓰기 반경은 PR 제목 한 필드다 (ADR-022 결정 2).
 */

export const PACKAGE_NAME = '@prs/github-annotate' as const;

export {
  ANNOTATE_MAX_ATTEMPTS,
  DEFAULT_BLOCK_COOLDOWN_MS,
  DEFAULT_SWEEP_INTERVAL_MS,
  DEFAULT_SWEEP_LIMIT,
  MIN_WRITE_SPACING_MS,
  annotateConfigFailure,
  hasAnnotateCredentials,
  resolveAnnotateConfig,
  resolveAnnotateEnabled,
} from './config.js';
export type { AnnotateConfig } from './config.js';

export { decideTitleUpdate, resolveAnnotationTarget } from './title.js';
export type { AnnotationTarget, TitleDecision } from './title.js';

export { AnnotateApiError, AnnotateClient } from './client.js';
export type {
  AnnotateClientOptions,
  AnnotateErrorKind,
  AnnotateRequestEvent,
  PullRequestRef,
} from './client.js';
