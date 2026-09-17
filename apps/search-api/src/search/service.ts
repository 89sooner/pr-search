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
  buildHighlight,
  buildQuery,
  buildSort,
  closePointInTime,
  collectNames,
  openPointInTime,
  resolveSearchTarget,
  searchWithPit,
  toPlainHighlight,
  type AccessScope,
  type EntityAlias,
  type HighlightMap,
  type NameResolution,
  type SearchTarget,
  type SortKey,
  type SortOrder,
  type UnresolvedName,
} from '@prs/es';
import { serializeQuery, type QueryAst } from '@prs/query';
import type { Client } from '@elastic/elasticsearch';
import type { estypes } from '@elastic/elasticsearch';
import type { CursorSigner } from '../cursor/envelope.js';
import { computeFingerprint, decodeSearchCursor, encodeSearchCursor } from './cursor.js';
import {
  SEARCH_FACET_AXES,
  computeFacets,
  type FacetOutcome,
  type TeamSlugResolver,
} from './facets.js';
import { computeRelaxationHints, NO_RELAXATION, type RelaxationResult } from './relaxation.js';
import { resolveMergeNumberFields, type MergeNumberInput } from '../sequence/merge-number-batch.js';
import type { Pool } from '@prs/db';

/** W-001의 결과 표가 PR과 커밋을 한 목록에 보여 준다 (CR-016, DEV-054). */
export const SEARCH_TARGET: SearchTarget = ['prs-pull-requests', 'prs-commits'];

/** `SearchTarget`은 문자열 하나도 허용한다. `resolveSearchTarget`은 목록으로 받는다. */
function toAliases(target: SearchTarget): readonly EntityAlias[] {
  return typeof target === 'string' ? [target as EntityAlias] : (target as readonly EntityAlias[]);
}

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
/** ES가 돌려주는 강조 원문 — 표식이 박힌 조각들. 경계를 넘기 전에 걷어 낸다. */
type RawHighlight = Readonly<Record<string, readonly string[]>>;

/** 문서에서 목록에 필요한 만큼만 꺼낸 모양. */
export interface SearchHitSource {
  readonly repository?: string;
  /** M 정본 대조의 키 (WP-074). 응답에는 싣지 않고 대조에만 쓴다. */
  readonly repository_id?: number;
  readonly base_branch?: string;
  /** 색인이 지금 말하는 M 값. 정본과 다르면 정본이 이기고 관측 상태만 알린다. */
  readonly merge_number?: number;
  readonly merge_number_epoch?: number;
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
  /**
   * 강조 조각 (FR-SRCH-011 AC-5).
   *
   * **평문과 구간이다** — 마크업은 API 경계를 넘지 않는다 (THR-018, DEV-282).
   * 일치가 없으면 키 자체가 없다: 빈 객체는 "강조가 없다"가 아니라 "강조를
   * 계산했는데 아무것도 없었다"로 읽힌다.
   */
  readonly highlight?: HighlightMap;
  readonly url: string | null;
  /**
   * M 번호 (WP-074 / FR-SEQ-008 AC-13). **PR 항목에만 붙고** 기능이 꺼진 배포에서는
   * 키 자체가 없다. 값은 언제나 정본이며 색인 값이 아니다 (ADR-023 C5).
   */
  readonly merge_number?: string | null;
  readonly merge_number_state?: string;
  readonly merge_number_reason?: string | null;
  readonly merge_number_epoch?: number | null;
  readonly merge_number_projection_state?: string;
}

export interface SearchResult {
  readonly total: { readonly value: number; readonly relation: string };
  readonly sort: { readonly field: SortKey; readonly order: SortOrder };
  readonly items: readonly SearchItem[];
  readonly relaxation: RelaxationResult;
  /** 레지스트리에서 찾지 못한 `org`·`team` 이름 (CR-016, DEV-052). */
  readonly unresolved: readonly UnresolvedName[];
  /** 다음 페이지 커서. **마지막 페이지에서 `null`이다** (FR-SRCH-008 AC-1). */
  readonly nextCursor: string | null;
  /** 패싯. 요청하지 않았으면 `null` — 세 키를 응답에서 통째로 뺀다. */
  readonly facets: FacetOutcome | null;
}

/** 인덱스 이름으로 문서 유형을 가른다. 별칭이 아니라 실제 인덱스가 온다. */
function kindOf(index: string): 'pull_request' | 'commit' {
  return index.startsWith('prs-commits') ? 'commit' : 'pull_request';
}

function toItem(hit: estypes.SearchHit<SearchHitSource>): SearchItem {
  const source = hit._source ?? {};
  const kind = kindOf(hit._index);
  const repository = source.repository ?? null;
  const highlight = toPlainHighlight(hit.highlight as RawHighlight | undefined);

  return {
    ...(highlight === null ? {} : { highlight }),
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

/**
 * 페이지의 PR 항목에 M 필드를 붙인다.
 *
 * `kind: 'commit'` 항목은 건드리지 않는다 — 커밋은 M 번호의 대상이 아니며(AC-1),
 * 키를 만들면 화면이 없는 영역을 그린다.
 */
async function attachMergeNumbers(
  items: readonly SearchItem[],
  hits: readonly estypes.SearchHit<SearchHitSource>[],
  deps: SearchDeps,
): Promise<readonly SearchItem[]> {
  if (deps.mergeNumbers === undefined || !deps.mergeNumbers.enabled) return items;

  const inputs: MergeNumberInput[] = items.map((item, index) => {
    const source = hits[index]?._source ?? {};
    if (item.kind !== 'pull_request') {
      return { repositoryId: null, repositorySlug: null, baseBranch: null, prNumber: null, state: null };
    }
    return {
      repositoryId: source.repository_id ?? null,
      repositorySlug: item.repository,
      baseBranch: source.base_branch ?? null,
      prNumber: item.pr_number ?? null,
      state: item.state,
      indexed: {
        mergeNumber: source.merge_number ?? null,
        epoch: source.merge_number_epoch ?? null,
      },
    };
  });

  const fields = await resolveMergeNumberFields(deps.mergeNumbers.pool, inputs, { enabled: true });
  return items.map((item, index) => {
    const one = fields[index];
    return one === null || one === undefined ? item : { ...item, ...one };
  });
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
  /**
   * 커서 서명 (WP-032).
   *
   * **선택이 아니다.** 없으면 `runSearch`가 던진다 — 서명 없는 커서를 발급하는
   * 대신 배포가 잘못됐음을 말한다 (fail closed). 기동 시점의 방어는
   * `resolveSearchApiConfig`가 하고 여기는 그 값이 실제로 도달했는지를 본다.
   */
  readonly cursorSigner: CursorSigner;
  /** 팀 ID → slug 일괄 해석. 없으면 팀 패싯이 숫자로 나간다 (DEV-281). */
  readonly resolveTeamSlugs?: TeamSlugResolver;
  /** 패싯 예산. 시험이 `budget_omitted`를 재현할 때만 넘긴다. */
  readonly facetBudgetMs?: number;
  /**
   * M 번호 정본 대조 (WP-074 / ADR-023 C5). 없으면 M 키를 만들지 않는다 —
   * 기능이 꺼진 배포에서 기존 응답 모양이 그대로 유지된다.
   */
  readonly mergeNumbers?: { readonly pool: Pool; readonly enabled: boolean };
  readonly now?: () => number;
}

export interface SearchRequest {
  readonly ast: QueryAst;
  readonly scope: AccessScope;
  /**
   * `app_user.access_scope_version` (FR-AUTH-003).
   *
   * 지문의 재료다 — 권한이 회수되면 진행 중이던 페이징이 죽는 것이 옳다.
   * 같은 요청 안에서 접근 범위를 두 번 산출하지 않으려고 라우트가 한 번에
   * 얻은 값을 `scope`와 함께 넘긴다 (CR-043, DEV-272).
   */
  readonly scopeVersion: number;
  readonly sortKey: SortKey;
  readonly order: SortOrder;
  readonly size: number;
  /** 이어 보기 커서. 첫 페이지면 `null`. */
  readonly cursor: string | null;
  /** 패싯을 함께 셀 것인가 (`facets=true`). */
  readonly facets: boolean;
  /**
   * `seq:` 범위 질의의 유효 에폭. `seq:`가 없으면 `null` (CR-051).
   *
   * 라우트가 시퀀스 공간을 해석해 확정한 값이며, 여기서 다시 조회하지
   * 않는다 — 접근 통제를 지나는 해석은 라우트의 일이고 이 함수는 그
   * 결과를 질의와 지문에 반영할 뿐이다 (백엔드 아키텍처 6.1의 4-1단계).
   */
  readonly sequenceEpoch: number | null;
  /**
   * `mnum:` 범위 질의의 유효 M 번호 에폭. `mnum:`이 없으면 `null` (CR-106).
   *
   * `sequenceEpoch`과 별개로 받는다 — 값이 같은 공간에서는 같은 정수여도
   * `buildQuery`가 다른 색인 필드(`merge_number_epoch`)에 걸고 지문도 다른
   * 자리에 싣는다.
   */
  readonly mergeNumberEpoch: number | null;
}

/**
 * 목록을 조회한다 (WP-013 + WP-032).
 *
 * ## 왜 PIT을 늘 여는가
 *
 * `search_after`는 "정렬 값이 이 커서보다 뒤"라는 조건이라, 정렬 값이 페이지
 * **사이에** 움직이면 항목이 두 번 나오거나 영영 나오지 않는다. 첫 페이지를
 * 만들 때는 사용자가 이어 볼지 알 수 없으므로, 그때 뷰를 고정해 두지 않으면
 * 커서를 발급할 자격이 없다 (ADR-010 Amendment).
 *
 * 대가는 조회마다 PIT 왕복 하나다. 마지막 페이지에서 best-effort로 닫고,
 * 닫지 못해도 `keep_alive`(5분)가 지나면 스스로 사라진다.
 *
 * ## 한 건 더 읽어 마지막 페이지를 **안다**
 *
 * `size`만 읽으면 "더 있는가"를 알 수 없어, 결과가 정확히 `size`의 배수일 때
 * 빈 페이지를 한 번 더 내주게 된다. AC-1이 "마지막 페이지에서 `next_cursor`가
 * null"을 요구하므로 한 건을 더 읽어 판정하고 그 한 건은 버린다.
 *
 * @throws {AccessScopeUnavailableError} 접근 범위가 비어 있으면 (기본 거부).
 * @throws {PartialSearchError} 샤드가 하나라도 실패하면. 부분 결과를 내보내지
 * 않는다 — 한 인덱스가 통째로 빠진 결과가 정상처럼 보이기 때문이다.
 * @throws {CursorInvalidError} 커서를 쓸 수 없으면.
 * @throws {CursorQueryMismatchError} 커서가 현재 조건과 다르면.
 */
export async function runSearch(request: SearchRequest, deps: SearchDeps): Promise<SearchResult> {
  const base = deps.target ?? SEARCH_TARGET;
  /*
   * `kind:` 필터는 절이 아니라 **검색 대상**이 된다 (CR-053, DEV-383).
   *
   * `null`이면 어떤 유형도 남지 않은 것이다 — `kind:pull_request -kind:pull_request`
   * 같은 질의다. 조회하지 않고 빈 결과를 낸다. **빈 인덱스 목록을 넘기면
   * Elasticsearch가 전체를 검색하므로** 그 길을 타입이 막는다.
   */
  const { target, ast } = resolveSearchTarget(request.ast, toAliases(base));
  const now = (deps.now ?? Date.now)();

  if (target === null) {
    /*
     * 남은 유형이 없다. Elasticsearch를 부르지 않고 빈 결과를 낸다 — 인덱스를
     * 좁히다 아무것도 남지 않은 것은 **오류가 아니라 결과가 없다는 사실**이다.
     */
    return {
      total: { value: 0, relation: 'eq' },
      sort: { field: request.sortKey, order: request.order },
      items: [],
      relaxation: NO_RELAXATION,
      unresolved: [],
      nextCursor: null,
      facets: null,
    };
  }

  const resolution = await deps.resolveNames(collectNames(ast));
  const built = buildQuery(
    // `kind:`가 걷어내진 AST다 — 남기면 `buildQuery`가 던진다 (CR-053).
    ast,
    resolution,
    /*
     * `seq:`/`mnum:`가 있는데 대응 에폭이 없으면 `buildQuery`가 던진다 —
     * 조용히 모든 세대를 함께 돌려주는 것보다 조립 오류를 드러내는 편이
     * 낫다. 둘은 독립이다(CR-106) — 값이 같아도 다른 필드에 걸린다.
     */
    {
      ...(request.sequenceEpoch === null ? {} : { sequenceEpoch: request.sequenceEpoch }),
      ...(request.mergeNumberEpoch === null ? {} : { mergeNumberEpoch: request.mergeNumberEpoch }),
    },
  );

  // 4. 강제 필터 결합. 우회 경로가 없다 (ADR-008).
  const scoped = applyMandatoryScopeFilter(built.query, request.scope);

  /*
   * 지문은 **한 번만** 만든다. 커서 검증과 다음 커서 발급이 같은 값을 쓴다 —
   * 두 번 계산하면 그 사이에 재료가 달라질 여지가 생긴다.
   */
  const fingerprint = computeFingerprint({
    query: serializeQuery(request.ast),
    sortKey: request.sortKey,
    order: request.order,
    scope: request.scope,
    scopeVersion: request.scopeVersion,
    sequenceEpoch: request.sequenceEpoch,
    mergeNumberEpoch: request.mergeNumberEpoch,
  });

  const resumed =
    request.cursor === null
      ? null
      : decodeSearchCursor(request.cursor, fingerprint, deps.cursorSigner, now);

  const pitId = resumed?.pitId ?? (await openPointInTime(deps.es, target));

  const hasText = request.ast.text !== null && request.ast.text !== '';
  const response = await searchWithPit<SearchHitSource>(deps.es, pitId, scoped, {
    // 한 건을 더 읽어 "다음이 있는가"를 판정한다. 그 한 건은 목록에 실리지 않는다.
    size: request.size + 1,
    sort: buildSort(request.sortKey, request.order),
    track_total_hits: TRACK_TOTAL_HITS,
    ...(resumed === null ? {} : { search_after: [...resumed.searchAfter] }),
    ...(hasText ? { highlight: buildHighlight() } : {}),
    ...(deps.timeoutMs === undefined ? {} : { timeout: `${String(deps.timeoutMs)}ms` }),
  });

  // 부분 결과를 내보내지 않는다 (CR-016, DEV-054).
  assertNoShardFailures(response);

  /*
   * **응답이 준 PIT을 다음 요청에 쓴다** (PR #57 리뷰 P1).
   *
   * Elasticsearch는 검색 응답에 `pit_id`를 실어 주며 그것이 **바뀔 수 있다** —
   * 계약이 "다음 요청에는 응답의 값을 쓰라"고 정한다. 처음 받은 값을 계속 쓰면
   * 성공한 페이지 뒤에 이어 보기가 실패할 수 있고, 마지막 페이지의 정리도
   * 이미 지나간 식별자를 닫는다.
   *
   * 지금 이 버전에서는 두 값이 같다 — 실측했다. 그러나 그것은 **우연이지
   * 계약이 아니며**, 우연에 기대는 코드는 판올림 한 번에 조용히 깨진다.
   */
  const livePitId = response.pit_id ?? pitId;

  const total = response.hits.total;
  const value = typeof total === 'number' ? total : (total?.value ?? 0);
  const relation = typeof total === 'number' ? 'eq' : (total?.relation ?? 'eq');

  const hits = response.hits.hits;
  const hasMore = hits.length > request.size;
  const page = hasMore ? hits.slice(0, request.size) : hits;
  const baseItems = page.map(toItem);

  /*
   * M 번호는 **페이지의 PR 튜플을 한 번에** 정본과 대조해 붙인다 (ADR-023 C5).
   * 행별 조회를 만들지 않으며, 정본 조회가 실패해도 목록은 그대로 나간다.
   */
  const items = await attachMergeNumbers(baseItems, page, deps);

  /*
   * 마지막 페이지의 정렬 값이 다음 커서의 재료다.
   *
   * `hasMore`가 거짓이면 커서를 발급하지 않고 PIT을 닫는다 — 발급하지 않은
   * 커서는 아무도 쓸 수 없으므로 그 뷰를 붙잡고 있을 이유가 없다.
   */
  const lastSort = page[page.length - 1]?.sort;
  const nextCursor =
    hasMore && lastSort !== undefined && lastSort.length > 0
      ? encodeSearchCursor({ pitId: livePitId, searchAfter: lastSort }, fingerprint, deps.cursorSigner, now)
      : null;

  if (nextCursor === null) await closePointInTime(deps.es, livePitId);

  /*
   * 패싯은 **별도 요청**이고 던지지 않는다 (FR-SRCH-009 예외 처리).
   *
   * 목록은 이미 만들어졌다. 분포 하나 때문에 그것을 버리지 않는다.
   */
  const facets = request.facets
    ? await computeFacets(
        { target, query: scoped, axes: SEARCH_FACET_AXES },
        {
          es: deps.es,
          ...(deps.resolveTeamSlugs === undefined ? {} : { resolveTeamSlugs: deps.resolveTeamSlugs }),
          ...(deps.facetBudgetMs === undefined ? {} : { budgetMs: deps.facetBudgetMs }),
        },
      )
    : null;

  // 0건일 때만 완화 후보를 센다 (FR-SRCH-006 AC-3).
  const relaxation =
    value === 0
      ? await computeRelaxationHints(request.ast, {
          es: deps.es,
          target,
          scope: request.scope,
          resolution,
          sequenceEpoch: request.sequenceEpoch,
          mergeNumberEpoch: request.mergeNumberEpoch,
        })
      : NO_RELAXATION;

  return {
    total: { value, relation },
    sort: { field: request.sortKey, order: request.order },
    items,
    relaxation,
    unresolved: built.unresolved,
    nextCursor,
    facets,
  };
}
