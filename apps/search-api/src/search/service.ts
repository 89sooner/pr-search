/**
 * 목록 조회 (API-SRCH-004, FR-SRCH-006, FR-SRCH-007).
 *
 * 백엔드 아키텍처 6.1의 조회 순서를 그대로 따른다.
 *
 *   1. 세션 검증 — 라우트가 한다
 *   2. 접근 범위 산출 — 실패하면 503, 부분 결과 없음
 *   3. 역할 검사 — 목록 조회에는 없다
 *   4. 강제 필터 결합 — `applyMandatoryScopeFilter`
 *   5. 조회 실행
 *   6. 감사 기록 — WP-039
 */

import {
  applyMandatoryScopeFilter,
  assertNoShardFailures,
  buildQuery,
  buildSort,
  collectNames,
  search,
  type AccessScope,
  type NameResolution,
  type SearchTarget,
  type SortKey,
  type SortOrder,
  type UnresolvedName,
} from '@prs/es';
import type { QueryAst } from '@prs/query';
import type { Client } from '@elastic/elasticsearch';
import type { estypes } from '@elastic/elasticsearch';
import { computeRelaxationHints, NO_RELAXATION, type RelaxationResult } from './relaxation.js';

/** W-001의 결과 표가 PR과 커밋을 한 목록에 보여 준다 (CR-016, DEV-054). */
export const SEARCH_TARGET: SearchTarget = ['prs-pull-requests', 'prs-commits'];

/** API 계약: `size` 기본 25, 최대 200 (초과 시 절삭). */
export const DEFAULT_SIZE = 25;
export const MAX_SIZE = 200;

/**
 * `track_total_hits` 상한.
 *
 * 정확한 총계를 1만 건까지만 센다. 그 위는 `relation: 'gte'`로 근사한다 —
 * 수백만 건을 정확히 세는 비용이 "62건"과 "1만 건 이상"의 차이만큼 가치
 * 있지 않다.
 */
export const TRACK_TOTAL_HITS = 10_000;

export function clampSize(raw: unknown): number {
  if (typeof raw !== 'string' || raw.trim() === '') return DEFAULT_SIZE;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) return DEFAULT_SIZE;
  // 초과는 오류가 아니라 절삭이다 (API 계약).
  return Math.min(parsed, MAX_SIZE);
}

export function parseOrder(raw: unknown): SortOrder {
  return raw === 'asc' ? 'asc' : 'desc';
}

/** 문서에서 목록에 필요한 만큼만 꺼낸 모양. */
export interface SearchHitSource {
  readonly repository?: string;
  readonly pr_number?: number;
  readonly commit_sha?: string;
  readonly title?: string;
  readonly message?: string;
  readonly author?: string;
  readonly state?: string;
  readonly merge_seq?: number;
  readonly seq_epoch?: number;
  readonly sequence_space?: string;
  readonly merged_at?: string;
  readonly committed_at?: string;
  readonly changed_files_count?: number;
  readonly additions?: number;
  readonly deletions?: number;
  readonly labels?: readonly string[];
  readonly link_summary?: Readonly<Record<string, unknown>>;
}

export interface SearchItem {
  readonly kind: 'pull_request' | 'commit';
  readonly repository: string | null;
  readonly pr_number?: number;
  readonly commit_sha?: string;
  readonly title: string | null;
  readonly author: string | null;
  readonly state: string | null;
  readonly merge_seq: number | null;
  readonly seq_epoch: number | null;
  readonly sequence_space: string | null;
  readonly merged_at: string | null;
  readonly changed_files_count: number | null;
  readonly additions: number | null;
  readonly deletions: number | null;
  readonly labels: readonly string[];
  readonly link_summary: Readonly<Record<string, unknown>> | null;
  readonly url: string | null;
}

export interface SearchResult {
  readonly total: { readonly value: number; readonly relation: string };
  readonly sort: { readonly field: SortKey; readonly order: SortOrder };
  readonly items: readonly SearchItem[];
  readonly relaxation: RelaxationResult;
  /** 레지스트리에서 찾지 못한 `org`·`team` 이름 (CR-016, DEV-052). */
  readonly unresolved: readonly UnresolvedName[];
}

/** 인덱스 이름으로 문서 유형을 가른다. 별칭이 아니라 실제 인덱스가 온다. */
function kindOf(index: string): 'pull_request' | 'commit' {
  return index.startsWith('prs-commits') ? 'commit' : 'pull_request';
}

function toItem(hit: estypes.SearchHit<SearchHitSource>): SearchItem {
  const source = hit._source ?? {};
  const kind = kindOf(hit._index);
  const repository = source.repository ?? null;

  return {
    kind,
    repository,
    ...(source.pr_number === undefined ? {} : { pr_number: source.pr_number }),
    ...(source.commit_sha === undefined ? {} : { commit_sha: source.commit_sha }),
    // 커밋에는 `title`이 없다. 목록의 제목 열에는 커밋 메시지 첫 줄이 온다.
    title: source.title ?? firstLine(source.message) ?? null,
    author: source.author ?? null,
    state: source.state ?? null,
    merge_seq: source.merge_seq ?? null,
    seq_epoch: source.seq_epoch ?? null,
    sequence_space: source.sequence_space ?? null,
    merged_at: source.merged_at ?? source.committed_at ?? null,
    changed_files_count: source.changed_files_count ?? null,
    additions: source.additions ?? null,
    deletions: source.deletions ?? null,
    labels: source.labels ?? [],
    link_summary: source.link_summary ?? null,
    url: buildUrl(kind, repository, source),
  };
}

function firstLine(message: string | undefined): string | null {
  if (message === undefined || message === '') return null;
  const index = message.indexOf('\n');
  return index < 0 ? message : message.slice(0, index);
}

/** 화면 경로. 저장하지 않고 계산한다 — 경로 규칙이 바뀌면 문서를 다시 쓸 이유가 없다. */
function buildUrl(
  kind: 'pull_request' | 'commit',
  repository: string | null,
  source: SearchHitSource,
): string | null {
  if (repository === null) return null;
  if (kind === 'commit') {
    return source.commit_sha === undefined ? null : `/commit/${repository}/${source.commit_sha}`;
  }
  return source.pr_number === undefined ? null : `/pr/${repository}/${String(source.pr_number)}`;
}

export interface SearchDeps {
  readonly es: Client;
  /** `org`·`team` 이름을 ID로 옮긴다 (CR-016, DEV-052). */
  readonly resolveNames: (names: {
    readonly orgs: readonly string[];
    readonly teams: readonly string[];
  }) => Promise<NameResolution>;
  readonly target?: SearchTarget;
  /** ES 조회 마감 시간. 넘기면 504 `SEARCH_TIMEOUT` (백엔드 아키텍처 8장). */
  readonly timeoutMs?: number;
}

export interface SearchRequest {
  readonly ast: QueryAst;
  readonly scope: AccessScope;
  readonly sortKey: SortKey;
  readonly order: SortOrder;
  readonly size: number;
}

/**
 * 목록을 조회한다.
 *
 * @throws {AccessScopeUnavailableError} 접근 범위가 비어 있으면 (기본 거부).
 * @throws {PartialSearchError} 샤드가 하나라도 실패하면. 부분 결과를 내보내지
 * 않는다 — 한 인덱스가 통째로 빠진 결과가 정상처럼 보이기 때문이다.
 */
export async function runSearch(request: SearchRequest, deps: SearchDeps): Promise<SearchResult> {
  const target = deps.target ?? SEARCH_TARGET;
  const resolution = await deps.resolveNames(collectNames(request.ast));
  const built = buildQuery(request.ast, resolution);

  // 4. 강제 필터 결합. 우회 경로가 없다 (ADR-008).
  const scoped = applyMandatoryScopeFilter(built.query, request.scope);

  const response = await search<SearchHitSource>(deps.es, target, scoped, {
    size: request.size,
    sort: buildSort(request.sortKey, request.order),
    track_total_hits: TRACK_TOTAL_HITS,
    ...(deps.timeoutMs === undefined ? {} : { timeout: `${String(deps.timeoutMs)}ms` }),
  });

  // 부분 결과를 내보내지 않는다 (CR-016, DEV-054).
  assertNoShardFailures(response);

  const total = response.hits.total;
  const value = typeof total === 'number' ? total : (total?.value ?? 0);
  const relation = typeof total === 'number' ? 'eq' : (total?.relation ?? 'eq');

  const items = response.hits.hits.map(toItem);

  // 0건일 때만 완화 후보를 센다 (FR-SRCH-006 AC-3).
  const relaxation =
    value === 0
      ? await computeRelaxationHints(request.ast, { es: deps.es, target, scope: request.scope, resolution })
      : NO_RELAXATION;

  return {
    total: { value, relation },
    sort: { field: request.sortKey, order: request.order },
    items,
    relaxation,
    unresolved: built.unresolved,
  };
}
