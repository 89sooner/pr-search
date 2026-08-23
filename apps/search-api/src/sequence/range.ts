/**
 * 시퀀스 범위 조회 (API-SEQ-001, FR-SEQ-002).
 *
 * ## 어디서 읽는가가 이 파일의 전부다 (CR-027, DEV-130)
 *
 * **구간에 무엇이 속하는지는 PostgreSQL `merge_sequence`가 답한다.** 그 표가
 * first-parent walk의 결과 그 자체이고, `git log --first-parent A..B`와 대조 검증이
 * 성립하는 유일한 출처다 (ADR-007).
 *
 * Elasticsearch로 `range(merge_seq)`를 걸어도 결과는 나온다 — 그것이 이 결함의
 * 성질이다. 채번은 PostgreSQL을 먼저 커밋하고 뒤에 색인에 비추므로, 비추기가
 * 실패하면 서수가 붙지 않은 문서가 남고 **그 구간은 오류 없이 항목이 빠진 채**
 * 돌아온다. 범위 인용이 조용히 틀리는 것은 이 제품이 막으려는 실패 그 자체다.
 *
 * 그래서 역할이 갈린다:
 *
 * | 무엇 | 어디서 | 왜 |
 * | --- | --- | --- |
 * | 멤버십·순서·건수 | PostgreSQL | 정본이고 git과 대조 가능하다 |
 * | 제목·작성자·변경량·경로 | Elasticsearch | 정본에 없는 표시용 값이다 |
 * | `q` 필터 | Elasticsearch | 질의 문법이 색인 위에서만 평가된다 |
 *
 * 그리고 **정본에는 있는데 색인에 없는 항목은 버리지 않는다.** 목록에
 * `indexed: false`로 남기고 `items_missing_in_index`로 센다 — 덜 채워진 결과와
 * 완전한 결과를 응답만 보고 가를 수 있어야 한다.
 */

import { mergeSequenceRepo } from '@prs/db';
import type { MergeSequenceRow, Pool } from '@prs/db';
import {
  applyMandatoryScopeFilter,
  buildQuery,
  collectNames,
  multiSearch,
  type AccessScope,
  type NameResolution,
  type UnresolvedName,
} from '@prs/es';
import type { QueryAst } from '@prs/query';
import type { Client } from '@elastic/elasticsearch';
import type { estypes } from '@elastic/elasticsearch';
import type { ResolvedSpace } from './space.js';

/** FR-SEQ-002 AC-4의 상한. 이 수를 넘으면 조회하지 않고 400이다. */
export const RANGE_LIMIT = 50_000;

/** API 계약: `size` 기본 50, 최대 200. 목록과 같은 상한을 쓴다. */
export const DEFAULT_RANGE_SIZE = 50;
export const MAX_RANGE_SIZE = 200;

/** 변경 경로 상위 N (FR-SEQ-002 AC-2). */
export const TOP_PATHS = 20;

export function clampRangeSize(raw: unknown): number {
  if (typeof raw !== 'string' || raw.trim() === '') return DEFAULT_RANGE_SIZE;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) return DEFAULT_RANGE_SIZE;
  return Math.min(parsed, MAX_RANGE_SIZE);
}

export interface RangeItem {
  readonly merge_seq: number;
  readonly kind: 'pull_request' | 'commit';
  readonly pr_number?: number;
  readonly commit_sha: string;
  readonly title: string | null;
  readonly author: string | null;
  readonly merged_at: string | null;
  readonly changed_files_count: number | null;
  readonly additions: number | null;
  readonly deletions: number | null;
  /**
   * 이 항목의 문서가 색인에 있는가 (CR-027, DEV-130).
   *
   * `false`면 서수·SHA·PR 번호는 정본에서 나온 확정값이고 나머지는 아직 모른다.
   * **`null`과 뜻이 다르다** — `null`은 "그 문서에 그 값이 없다"이고 이것은
   * "그 문서를 아직 못 찾았다"이다.
   */
  readonly indexed: boolean;
  readonly url: string | null;
}

export interface RangeSummary {
  readonly pull_request_count: number;
  readonly commit_count: number;
  readonly distinct_author_count: number;
  readonly changed_files_total: number;
  readonly additions_total: number;
  readonly deletions_total: number;
  readonly files_truncated_pull_request_count: number;
  readonly top_changed_paths: readonly { readonly path: string; readonly count: number }[];
}

export interface RangeResult {
  readonly summary: RangeSummary;
  readonly items: readonly RangeItem[];
  readonly items_missing_in_index: number;
  readonly unresolved: readonly UnresolvedName[];
}

export interface RangeRequest {
  readonly space: ResolvedSpace;
  readonly scope: AccessScope;
  readonly fromExclusive: number;
  readonly toInclusive: number;
  readonly size: number;
  /** `q`가 없으면 `null`. `match_all`을 넘기는 것과 구분한다 — 아래 주석 참고. */
  readonly ast: QueryAst | null;
  /**
   * 구간의 first-parent 커밋 수. `guardRange`가 이미 정확히 센 값이다.
   *
   * 다시 세지 않는 이유는 두 번 세면 그 사이에 채번이 끼어들 수 있어서다 —
   * 상한 검사를 통과한 수와 응답에 실리는 수가 달라지면 어느 쪽이 맞는지 알 수
   * 없다.
   */
  readonly rangeTotal: number;
}

export interface RangeDeps {
  readonly pool: Pool;
  readonly es: Client;
  readonly resolveNames: (names: {
    readonly orgs: readonly string[];
    readonly teams: readonly string[];
  }) => Promise<NameResolution>;
  readonly timeoutMs?: number;
}

/** 구간 크기 검증의 결과. 조회를 시작하기 전에 끝난다. */
export type RangeGuard =
  | { readonly kind: 'ok'; readonly total: number }
  | { readonly kind: 'inverted' }
  | { readonly kind: 'too_large'; readonly total: number };

/**
 * 조회 전에 구간을 검사한다 (AC-3, AC-4).
 *
 * **역전을 먼저 본다.** `from > to`면 건수는 언제나 0이라, 순서를 뒤집으면
 * "0건이니 통과"가 되어 사용자가 받는 것은 빈 목록이다 — 오타를 정답처럼
 * 돌려주는 셈이다.
 *
 * 건수는 추정이 아니라 정확한 값이다 (DEV-140). 정본이 PostgreSQL이므로
 * `count(*)`가 기본 키 범위 스캔 한 번이다.
 */
export async function guardRange(
  pool: Pool,
  space: ResolvedSpace,
  fromExclusive: number,
  toInclusive: number,
): Promise<RangeGuard> {
  if (fromExclusive > toInclusive) return { kind: 'inverted' };

  const total = await mergeSequenceRepo.countRange(
    pool,
    space.repositoryId,
    space.baseBranch,
    space.seqEpoch,
    fromExclusive,
    toInclusive,
  );
  if (total > RANGE_LIMIT) return { kind: 'too_large', total };
  return { kind: 'ok', total };
}

/** 색인에서 꺼내는 표시용 필드. 정본이 주지 않는 것만 담는다. */
interface PullRequestSource {
  readonly pr_number?: number;
  readonly title?: string;
  readonly author?: string;
  readonly merged_at?: string;
  readonly changed_files_count?: number;
  readonly additions?: number;
  readonly deletions?: number;
}

interface SummaryAggregations {
  readonly distinct_authors?: { readonly value: number };
  readonly changed_files?: { readonly value: number | null };
  readonly additions?: { readonly value: number | null };
  readonly deletions?: { readonly value: number | null };
  readonly files_truncated?: { readonly doc_count: number };
  readonly top_paths?: { readonly buckets: readonly { readonly key: string; readonly doc_count: number }[] };
}

const EMPTY_SUMMARY_AGGS: RangeSummary = {
  pull_request_count: 0,
  commit_count: 0,
  distinct_author_count: 0,
  changed_files_total: 0,
  additions_total: 0,
  deletions_total: 0,
  files_truncated_pull_request_count: 0,
  top_changed_paths: [],
};

/**
 * 구간 전체의 PR 번호로 거는 질의.
 *
 * **`range(merge_seq)`가 아니라 `terms(pr_number)`다.** 정본이 준 목록을 그대로
 * 쓰므로, 색인의 `merge_seq`가 아직 비어 있어도 그 PR의 표시 필드는 찾아진다 —
 * 채번 반영이 늦어도 요약이 조용히 줄지 않는다.
 *
 * 상한은 `RANGE_LIMIT`(5만)이고 Elasticsearch의 `index.max_terms_count` 기본값은
 * 65,536이라 구간 전체를 한 번에 실을 수 있다.
 */
function prNumbersQuery(
  space: ResolvedSpace,
  prNumbers: readonly number[],
  extra: estypes.QueryDslQueryContainer | null,
): estypes.QueryDslQueryContainer {
  const filter: estypes.QueryDslQueryContainer[] = [
    { term: { repository_id: space.repositoryId } },
    { terms: { pr_number: [...prNumbers] } },
  ];
  if (extra !== null) filter.push(extra);
  return { bool: { filter } };
}

/** 요약 집계. 라우팅으로 단일 샤드에 닿으므로 `terms` 집계가 근사가 아니라 정확하다. */
const SUMMARY_AGGS: Record<string, estypes.AggregationsAggregationContainer> = {
  distinct_authors: { cardinality: { field: 'author' } },
  changed_files: { sum: { field: 'changed_files_count' } },
  additions: { sum: { field: 'additions' } },
  deletions: { sum: { field: 'deletions' } },
  files_truncated: { filter: { term: { files_truncated: true } } },
  top_paths: { terms: { field: 'changed_paths.raw', size: TOP_PATHS } },
};

function buildUrl(space: ResolvedSpace, row: MergeSequenceRow): string | null {
  const [owner, rest] = space.sequenceSpace.split('/');
  const name = rest?.split('@')[0];
  if (owner === undefined || name === undefined || name === '') return null;
  return row.pull_request_number === null
    ? `/commit/${owner}/${name}/${row.commit_sha}`
    : `/pr/${owner}/${name}/${String(row.pull_request_number)}`;
}

/**
 * 반개구간 `(from, to]`를 조회한다.
 *
 * 순서는 바꿀 수 없다: 정본에서 멤버십을 읽고 → 색인에서 채운다. 반대로 하면
 * 색인이 목록의 길이를 정하게 된다.
 */
export async function runRange(request: RangeRequest, deps: RangeDeps): Promise<RangeResult> {
  const { space, scope } = request;

  /*
   * 1. 정본. 이 둘이 구간의 정의다.
   *
   * **행 전체를 올리지 않는다.** 구간은 5만 건까지 허용되는데 응답에 실리는 것은
   * `size`(최대 200)뿐이다. 필요한 것은 보여 줄 페이지와, 요약 질의에 실을 PR
   * 번호 목록 둘이다.
   */
  const [page, prNumbers] = await Promise.all([
    mergeSequenceRepo.findRangePage(
      deps.pool,
      space.repositoryId,
      space.baseBranch,
      space.seqEpoch,
      request.fromExclusive,
      request.toInclusive,
      request.size,
    ),
    mergeSequenceRepo.listPullRequestNumbersInRange(
      deps.pool,
      space.repositoryId,
      space.baseBranch,
      space.seqEpoch,
      request.fromExclusive,
      request.toInclusive,
    ),
  ]);

  // 2. `q`를 ES 절로 옮긴다. 없으면 `null` — `match_all`을 끼워 넣지 않는다.
  let extra: estypes.QueryDslQueryContainer | null = null;
  let unresolved: readonly UnresolvedName[] = [];
  if (request.ast !== null) {
    const resolution = await deps.resolveNames(collectNames(request.ast));
    const built = buildQuery(request.ast, resolution);
    extra = built.query;
    unresolved = built.unresolved;
  }

  if (prNumbers.length === 0) {
    /*
     * 구간에 PR이 하나도 없다 — 직접 푸시만 있는 구간이거나 빈 구간이다.
     * `terms`에 빈 목록을 넣으면 아무것도 매치하지 않지만, 그 왕복은 답을
     * 바꾸지 않으므로 하지 않는다.
     */
    return {
      // `q`가 있으면 판정할 PR이 하나도 없으므로 0건이다 (DEV-136).
      summary: { ...EMPTY_SUMMARY_AGGS, commit_count: extra === null ? request.rangeTotal : 0 },
      items: extra === null ? page.map((row) => toUnindexedItem(space, row)) : [],
      // PR이 없는 항목은 커밋 문서로만 존재하고, 그 문서에는 표시할 값이 없다.
      items_missing_in_index: 0,
      unresolved,
    };
  }

  // 3. 한 왕복으로 셋을 묻는다 (ADR-008: 셋 다 강제 필터를 지난다).
  const pagePrNumbers = [
    ...new Set(page.filter((row) => row.pull_request_number !== null).map((row) => row.pull_request_number!)),
  ];

  const timeout = deps.timeoutMs === undefined ? {} : { timeout: `${String(deps.timeoutMs)}ms` };
  const routing = String(space.repositoryId);
  const scoped = (extraClause: estypes.QueryDslQueryContainer | null, numbers: readonly number[]): ScopedRequest =>
    applyMandatoryScopeFilter(prNumbersQuery(space, numbers, extraClause), scope);

  /*
   * `q`가 있으면 **거르지 않은 건수**를 따로 센다.
   *
   * `items_missing_in_index`는 `q`와 무관하게 늘 같은 뜻이어야 한다 — "정본에는
   * PR이 있는데 색인에 문서가 없는 수". 거른 건수 하나로 그것을 계산하면
   * "필터에 걸러진 것"과 "문서가 없는 것"이 한 숫자에 섞이고, 같은 필드가 요청에
   * 따라 다른 것을 세게 된다.
   *
   * `q`가 없으면 두 질의가 같으므로 세지 않는다.
   */
  const requests: { target: 'prs-pull-requests'; query: ScopedRequest; options: estypes.MsearchRequestItem }[] = [];
  const summaryIndex = extra === null ? 0 : 1;
  if (extra !== null) {
    requests.push({
      target: 'prs-pull-requests',
      query: scoped(null, prNumbers),
      options: { size: 0, routing, track_total_hits: true, ...timeout } as estypes.MsearchRequestItem,
    });
  }
  requests.push({
    target: 'prs-pull-requests',
    query: scoped(extra, prNumbers),
    options: {
      size: 0,
      routing,
      aggs: SUMMARY_AGGS,
      track_total_hits: true,
      ...timeout,
    } as estypes.MsearchRequestItem,
  });
  requests.push({
    target: 'prs-pull-requests',
    query: scoped(extra, pagePrNumbers),
    options: {
      size: pagePrNumbers.length,
      routing,
      _source: ['pr_number', 'title', 'author', 'merged_at', 'changed_files_count', 'additions', 'deletions'],
      ...timeout,
    } as estypes.MsearchRequestItem,
  });

  const response = await multiSearch<PullRequestSource>(deps.es, requests);
  const summaryResponse = asResult(response.responses[summaryIndex]);
  const pageResponse = asResult(response.responses[summaryIndex + 1]);

  const aggs = (summaryResponse?.aggregations ?? {}) as SummaryAggregations;
  /** `q`를 지난 PR 수. 구간 전체 기준이다. */
  const matchedTotal = totalOf(summaryResponse);
  /** 색인에 문서가 있는 PR 수. `q`와 무관하다. */
  const indexedTotal = extra === null ? matchedTotal : totalOf(asResult(response.responses[0]));

  const sources = new Map<number, PullRequestSource>();
  for (const hit of pageResponse?.hits.hits ?? []) {
    const source = hit._source;
    if (source?.pr_number !== undefined) sources.set(source.pr_number, source);
  }

  /*
   * `q`가 있으면 목록도 요약도 그것을 지난 집합을 말한다 (DEV-136). 필터에 걸리지
   * 않은 행은 목록에서 빠지며, 그 사실은 `pull_request_count`가 함께 줄어드는
   * 것으로 드러난다.
   *
   * `q`가 없으면 정본의 모든 행이 목록에 남는다 — 색인에 없어도 서수와 SHA는
   * 확정값이므로 보여 줄 것이 있다.
   */
  const filtered = extra === null ? page : page.filter((row) => hasSource(row, sources));
  const items = filtered.map((row) => toItem(space, row, sources));

  /*
   * 커밋 수의 뜻 (DEV-139): 구간의 **first-parent 커밋 수**다. PR의 원본 커밋까지
   * 세지 않는다 — DoD가 `git log --first-parent A..B`와 대조하라고 하므로 그
   * 명령이 세는 것과 같은 것을 센다.
   *
   * `q`가 걸리면 PR 문서가 없는 직접 푸시 커밋은 **판정할 수 없다.** 통과로 세면
   * 요약이 목록보다 커지므로 세지 않는다. 그래서 필터가 있을 때 커밋 수는 곧
   * 걸러진 PR 수다 — 서수 하나에 머지 커밋 하나이므로 둘은 같은 수다.
   */
  const commitCount = extra === null ? request.rangeTotal : matchedTotal;

  return {
    summary: {
      pull_request_count: extra === null ? prNumbers.length : matchedTotal,
      commit_count: commitCount,
      distinct_author_count: aggs.distinct_authors?.value ?? 0,
      changed_files_total: Math.round(aggs.changed_files?.value ?? 0),
      additions_total: Math.round(aggs.additions?.value ?? 0),
      deletions_total: Math.round(aggs.deletions?.value ?? 0),
      files_truncated_pull_request_count: aggs.files_truncated?.doc_count ?? 0,
      top_changed_paths: (aggs.top_paths?.buckets ?? []).map((bucket) => ({
        path: bucket.key,
        count: bucket.doc_count,
      })),
    },
    items,
    items_missing_in_index: Math.max(0, prNumbers.length - indexedTotal),
    unresolved,
  };
}

/** `applyMandatoryScopeFilter`의 반환 타입. 브랜드가 지워지지 않게 그대로 받는다. */
type ScopedRequest = ReturnType<typeof applyMandatoryScopeFilter>;

/** msearch 응답의 한 칸은 결과이거나 오류다. 오류 칸은 집계도 히트도 없다. */
function asResult(
  entry: estypes.MsearchResponseItem<PullRequestSource> | undefined,
): estypes.SearchResponse<PullRequestSource> | null {
  if (entry === undefined || 'error' in entry) return null;
  return entry as estypes.SearchResponse<PullRequestSource>;
}

function totalOf(result: estypes.SearchResponse<PullRequestSource> | null): number {
  const total = result?.hits.total;
  if (total === undefined) return 0;
  return typeof total === 'number' ? total : total.value;
}

function hasSource(row: MergeSequenceRow, sources: ReadonlyMap<number, PullRequestSource>): boolean {
  return row.pull_request_number !== null && sources.has(row.pull_request_number);
}

function toUnindexedItem(space: ResolvedSpace, row: MergeSequenceRow): RangeItem {
  return {
    merge_seq: Number(row.merge_seq),
    kind: row.pull_request_number === null ? 'commit' : 'pull_request',
    ...(row.pull_request_number === null ? {} : { pr_number: row.pull_request_number }),
    commit_sha: row.commit_sha,
    title: null,
    author: null,
    merged_at: null,
    changed_files_count: null,
    additions: null,
    deletions: null,
    indexed: false,
    url: buildUrl(space, row),
  };
}

function toItem(
  space: ResolvedSpace,
  row: MergeSequenceRow,
  sources: ReadonlyMap<number, PullRequestSource>,
): RangeItem {
  const source = row.pull_request_number === null ? undefined : sources.get(row.pull_request_number);
  if (source === undefined) return toUnindexedItem(space, row);

  return {
    merge_seq: Number(row.merge_seq),
    kind: 'pull_request',
    ...(row.pull_request_number === null ? {} : { pr_number: row.pull_request_number }),
    commit_sha: row.commit_sha,
    title: source.title ?? null,
    author: source.author ?? null,
    merged_at: source.merged_at ?? null,
    changed_files_count: source.changed_files_count ?? null,
    additions: source.additions ?? null,
    deletions: source.deletions ?? null,
    indexed: true,
    url: buildUrl(space, row),
  };
}
