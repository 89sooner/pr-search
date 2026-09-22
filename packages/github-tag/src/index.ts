/**
 * @prs/github-tag — M 번호 lightweight 태그의 쓰기 경계 (WP-100 / FR-SEQ-012, ADR-026).
 *
 * 표기(`@prs/github-annotate`)에 이어 이 제품이 사람의 지시 없이 GHE를 고치는 **두 번째**
 * 경로다. 별도 패키지로 두는 이유는 같다 — 조회용 `@prs/github`·`search-api`의 의존
 * 그래프에 쓰기 코드가 들어오지 않게 하고, 자격(`GHE_TAG_*`)이 표기 자격과 다른 행으로
 * 관리되게 한다. 이 패키지를 의존하는 앱은 `pipeline-worker` 하나이며 그 안에서도 `tag`
 * 역할만 자격을 받는다.
 *
 * 쓰기 반경은 `refs/tags/M-<코드>-<번호>`의 **생성**뿐이다. 이동·삭제 메서드는 없다.
 */

export const PACKAGE_NAME = '@prs/github-tag' as const;

export {
  DEFAULT_TAG_BLOCK_COOLDOWN_MS,
  DEFAULT_TAG_LIST_MAX_PAGES,
  DEFAULT_TAG_SWEEP_INTERVAL_MS,
  DEFAULT_TAG_SWEEP_LIMIT,
  MIN_TAG_WRITE_SPACING_MS,
  TAG_MAX_ATTEMPTS,
  hasTagCredentials,
  resolveTagConfig,
  resolveTagEnabled,
  tagConfigFailure,
} from './config.js';
export type { TagConfig } from './config.js';

export { decideTagAction, mergeNumberOfTagName, resolveTagTarget } from './decision.js';
export type { RefLookup, TagDecision, TagTarget } from './decision.js';

export { LIST_MAX_PAGES, TagApiError, TagClient, leavesOutcomeUnknown } from './client.js';
export type { RemoteTagRef, RepositoryRef, RequestOptions, TagClientOptions, TagErrorKind, TagRequestEvent } from './client.js';
