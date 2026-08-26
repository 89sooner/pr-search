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
  isRepositoryInScope,
  shouldUseOrgTeamScope,
  AccessScopeUnavailableError,
  EXPLICIT_SCOPE_LIMIT,
} from './scoped-query.js';
export type { AccessScope, ExplicitAccessScope, OrgTeamAccessScope, ScopedQuery } from './scoped-query.js';

export {
  DENORM_TAG_LIMIT,
  RELEASE_TAGS_LIMIT,
  applyReleaseTagsToDocuments,
  pruneReleaseDocuments,
  releaseDocId,
  upsertReleaseDocuments,
} from './releases.js';
export type { ApplyReleaseTagsInput, DenormRelease, ReleaseDocInput, ReleaseScope } from './releases.js';

export { multiSearch, search } from './search.js';
export type { ScopedSearchOptions, ScopedSearchRequest, SearchTarget } from './search.js';

export {
  RELATION_LIMIT_DEFAULT,
  RELATION_LIMIT_MAX,
  clampRelationLimit,
  searchRelationLinks,
} from './relations-read.js';
export type { RelationDirection, RelationLinkHit, RelationLinkPage } from './relations-read.js';


export {
  MAX_PREFIX_CANDIDATES,
  PR_SHA_FIELDS,
  commitDetailQuery,
  commitExactQuery,
  commitPrefixQuery,
  pullRequestDetailQuery,
  pullRequestQuery,
  pullRequestsByNumbersQuery,
  shaFallbackQuery,
} from './resolve-query.js';

export { EMPTY_RESOLUTION, buildQuery, collectNames } from './query-builder.js';
export type { BuiltQuery, NameResolution, UnresolvedName } from './query-builder.js';

export {
  DEFAULT_SORT_KEY,
  DEFAULT_SORT_ORDER,
  PartialSearchError,
  SORT_KEYS,
  TIEBREAK_FIELD,
  assertNoShardFailures,
  buildSort,
  isSortKey,
} from './sort.js';
export type { SortKey, SortOrder } from './sort.js';

export { CONDITIONAL_UPSERT_SCRIPT, bulkUpsert, classifyFailure, upsertOne } from './upsert.js';
export type { BulkItemOutcome, BulkUpsertResult, UpsertRequest } from './upsert.js';

export {
  ARCHIVABLE_ALIASES,
  NON_ARCHIVABLE_ALIASES,
  TEAM_SCOPED_ALIASES,
  applyRepositoryTeams,
  markRepositoryArchived,
} from './registry.js';
export type { MarkArchivedResult } from './registry.js';

export { SEQUENCE_CHUNK, applyEpochBump, applySequenceToDocuments, findPullRequestByMergeCommit } from './sequence.js';
export type { ApplySequenceInput, ApplySequenceResult, SequenceAssignment } from './sequence.js';

export { applyMappings, dropEntityIndices } from './bootstrap.js';
export type { BootstrapResult } from './bootstrap.js';
export {
  DERIVED_LINK_TYPES,
  LINKS_ALIAS,
  LINK_SUMMARY_SCRIPT,
  REFERENCE_LINK_TYPE,
  REFERENCE_PAGE_SIZE,
  deleteStaleDerivedLinks,
  deleteStaleReferenceLinks,
  findLinksFrom,
  findLinksTo,
  findReferenceTargets,
  findReferencesTo,
  resolveReferenceLinks,
  setLinkDetached,
  setLinkResolved,
  summarizeRelations,
  updateLinkSummary,
  writeDerivedLinks,
  writeReferenceLinks,
} from './links.js';
export type {
  DerivedLinkDoc,
  DerivedLinkTypeName,
  LinkEndpointKind,
  LinkScopeFields,
  LinkSummaryResult,
  LinkSummaryUpdate,
  LinkWriteFailure,
  LinkWriteResult,
  ReferenceLinkDoc,
  ReferenceResolution,
  ReferencingLink,
  RelationSummary,
  StoredLink,
  TargetLookup,
} from './links.js';

export {
  COMMIT_METADATA_SCRIPT,
  upsertCommitMetadata,
  type CommitMetadataFields,
  type CommitMetadataResult,
  type CommitMetadataUpsert,
} from './commit-metadata.js';
