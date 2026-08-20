/**
 * @prs/es — Elasticsearch 매핑 정의와 질의 경계 (ADR-003, ADR-008).
 *
 * Elasticsearch는 PostgreSQL에서 전량 재구성 가능한 파생 뷰다. 어떤 데이터도
 * 검색 인덱스에만 존재해서는 안 된다 (ADR-004).
 */

export const PACKAGE_NAME = '@prs/es' as const;

export { resolveClientOptions } from './config.js';
export type { ElasticsearchEnv } from './config.js';

export { createEsClient } from './client.js';

export {
  ENTITY_ANALYSIS,
  ENTITY_INDEX_SETTINGS,
  UNSORTED_INDEX_SETTINGS,
  LOWERCASE_NORMALIZER,
  PATH_ANALYZER,
  TEXT_ANALYZER,
} from './settings.js';

export { COMMIT_MAPPING, LINK_MAPPING, PULL_REQUEST_MAPPING, RELEASE_MAPPING } from './mappings/index.js';

export { ENTITY_ALIASES, ENTITY_INDICES, findIndexDefinition } from './indices.js';
export type { EntityAlias, EntityIndexDefinition } from './indices.js';

export {
  applyMandatoryScopeFilter,
  shouldUseOrgTeamScope,
  AccessScopeUnavailableError,
  EXPLICIT_SCOPE_LIMIT,
} from './scoped-query.js';
export type { AccessScope, ExplicitAccessScope, OrgTeamAccessScope, ScopedQuery } from './scoped-query.js';

export { search } from './search.js';
export type { ScopedSearchOptions } from './search.js';

export { applyMappings, dropEntityIndices } from './bootstrap.js';
export type { BootstrapResult } from './bootstrap.js';
