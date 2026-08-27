/**
 * 패싯 집계 (WP-032 / FR-SRCH-009, FR-SEQ-002 AC-8, CR-043 DEV-276~281).
 *
 * ## 목록과 실패 도메인을 나눈다
 *
 * 같은 요청에 `hits`와 `aggs`를 함께 넣으면 집계 하나가 예산을 넘길 때 응답
 * **전체**가 못 쓰게 된다. 그러면 "패싯 실패가 목록을 막지 않는다"(FR-SRCH-009
 * 예외 처리)를 지킬 수 없다. 그래서 별도 요청이고, 예산은 검색 예산 3초의
 * 절반인 1.5초다.
 *
 * 백엔드 아키텍처가 한동안 `왕복 1회`를 처방하고 있었다 — 요구사항이 금지하는
 * 구조였고 CR-043이 그것을 고쳤다.
 *
 * ## 집계도 강제 필터를 지난다
 *
 * `computeFacets`는 `ScopedQuery`만 받는다. 위험한 것은 새 헬퍼가
 * `client.search({ index, aggs })`를 직접 불러 질의를 **잊는** 길인데, ADR-008
 * 가드레일이 그 형태를 잡는다 (`architecture.test.ts`).
 *
 * 불변식 하나가 여기 걸려 있다: **접근 범위 밖 저장소가 가진 팀·라벨·작성자는
 * bucket에도 count에도 나타나지 않는다** (THR-003). 질의가 같으므로 목록이
 * 보여 주지 않는 문서는 집계도 세지 않는다.
 *
 * ## 선택된 값도 조건에 포함한다
 *
 * 일반적인 상거래 패싯(disjunctive facet)은 자기 필드의 필터만 빼고 분포를 다시
 * 계산하지만, SRS AC-3은 **"목록 조회와 동일한 질의 조건"**이라고 명시한다.
 * 관행을 이유로 다르게 만들지 않는다 — 다른 동작이 필요하면 별도 요구사항이다.
 */

import { assertNoShardFailures, search, type ScopedQuery, type SearchTarget } from '@prs/es';
import type { Client, estypes } from '@elastic/elasticsearch';

/** 각 패싯이 돌려주는 값 수 (FR-SRCH-009 AC-1: 상위 20). */
export const FACET_TOP = 20;

/**
 * 패싯 예산 (FR-SRCH-009 AC-4: "전체 응답 예산의 절반").
 *
 * 백엔드 아키텍처 8장의 `집계 타임아웃 (5초)`는 통계 API(REL-005)의 시계열
 * 집계이며 **이 예산이 아니다.**
 */
export const FACET_BUDGET_MS = 1_500;

/** 응답 상태 넷 중 셋. "요청하지 않음"은 키가 아예 없는 것으로 표현한다. */
export type FacetStatus = 'ready' | 'budget_omitted' | 'failed';

export interface FacetValue {
  readonly value: string;
  readonly count: number;
}

export type FacetMap = Readonly<Record<string, readonly FacetValue[]>>;

export interface FacetOutcome {
  readonly facets: FacetMap;
  /** `facets_omitted`. `budget_omitted`·`failed` 둘 다 `true`다. */
  readonly omitted: boolean;
  readonly status: FacetStatus;
}

/**
 * 패싯 축 하나.
 *
 * `key`는 **응답 키**이고 `field`는 ES 필드다. 둘이 다른 축이 둘 있다 —
 * `repository`(질의 키는 `repo`)와 `team`(필드는 `allowed_team_ids`).
 */
export interface FacetAxis {
  readonly key: string;
  readonly field: string;
  /** 값이 사람이 읽을 이름이 아닌 축. 지금은 팀 하나뿐이다. */
  readonly display?: 'team';
}

/**
 * W-001의 여섯 축 (FR-SRCH-009 AC-1).
 *
 * `W-001-FACETS`가 한때 여덟(기간·시퀀스 포함)을 적었으나 CR-043이 여섯으로
 * 좁혔다 — 연속 값에 "상위 20개 값과 건수"라는 형태가 맞지 않고, 기간·시퀀스는
 * `merged:`·`seq:` 질의 키로 이미 필터할 수 있다 (DEV-285).
 */
export const SEARCH_FACET_AXES: readonly FacetAxis[] = [
  { key: 'repository', field: 'repository' },
  { key: 'author', field: 'author' },
  /*
   * **`team:` 질의 키와 같은 필드를 센다** (DEV-281).
   *
   * 다른 필드를 세면 "패싯을 눌렀는데 건수가 다르다"가 된다. 질의 키가
   * `allowed_team_ids`로 가므로(CR-016, DEV-052) 패싯도 거기를 본다.
   */
  { key: 'team', field: 'allowed_team_ids', display: 'team' },
  { key: 'label', field: 'labels' },
  { key: 'base_branch', field: 'base_branch' },
  { key: 'state', field: 'state' },
];

/**
 * W-004의 네 축 (FR-SEQ-002 AC-8).
 *
 * 저장소와 대상 브랜치는 **시퀀스 공간이 이미 고정**하므로 패싯으로 다시 묻지
 * 않고, PR 상태는 W-004의 승인 범위가 아니다.
 */
export const RANGE_FACET_AXES: readonly FacetAxis[] = [
  { key: 'author', field: 'author' },
  { key: 'team', field: 'allowed_team_ids', display: 'team' },
  { key: 'label', field: 'labels' },
  { key: 'path', field: 'changed_paths.raw' },
];

/** 팀 ID를 slug으로 **일괄** 옮긴다. bucket마다 조회하지 않는다 (DEV-281). */
export type TeamSlugResolver = (ids: readonly number[]) => Promise<ReadonlyMap<number, string>>;

export interface FacetDeps {
  readonly es: Client;
  readonly resolveTeamSlugs?: TeamSlugResolver;
  /** 시험이 예산을 줄여 `budget_omitted`를 재현할 수 있게 열어 둔다. */
  readonly budgetMs?: number;
}

export interface FacetRequest {
  readonly target: SearchTarget;
  readonly query: ScopedQuery;
  readonly axes: readonly FacetAxis[];
  /** 단일 샤드로 좁히는 라우팅 값. 구간 조회가 쓴다. */
  readonly routing?: string;
}

interface TermsAggregation {
  readonly buckets?: readonly { readonly key: string | number; readonly doc_count: number }[];
}

const OMITTED: FacetOutcome = { facets: {}, omitted: true, status: 'budget_omitted' };
const FAILED: FacetOutcome = { facets: {}, omitted: true, status: 'failed' };

function aggregationsOf(axes: readonly FacetAxis[]): Record<string, estypes.AggregationsAggregationContainer> {
  return Object.fromEntries(
    axes.map((axis) => [axis.key, { terms: { field: axis.field, size: FACET_TOP } }]),
  );
}

/**
 * 패싯을 센다.
 *
 * **던지지 않는다.** 실패는 상태값이다 — 목록은 이미 만들어졌고 패싯 하나
 * 때문에 그것을 버릴 수 없다. 대신 무엇이 실패인지 상태로 갈라 화면이 다른
 * 안내를 그리게 한다.
 */
export async function computeFacets(request: FacetRequest, deps: FacetDeps): Promise<FacetOutcome> {
  const budget = deps.budgetMs ?? FACET_BUDGET_MS;

  let response: estypes.SearchResponse<unknown>;
  try {
    response = await search<unknown>(deps.es, request.target, request.query, {
      size: 0,
      aggs: aggregationsOf(request.axes),
      timeout: `${String(budget)}ms`,
      ...(request.routing === undefined ? {} : { routing: request.routing }),
    });
    /*
     * 부분 결과를 분포로 내보내지 않는다.
     *
     * 샤드가 하나 빠진 집계는 **틀린 수**이지 적은 수가 아니다. 사용자는 그
     * 차이를 볼 수 없으므로 상태로 말한다.
     */
    assertNoShardFailures(response);
  } catch {
    return FAILED;
  }

  /*
   * `timed_out`은 예산 초과다 (FR-SRCH-009 AC-4).
   *
   * Elasticsearch의 `timeout`은 **소프트**라 넘겨도 200과 부분 집계를 준다.
   * 그 수를 그대로 그리면 조용히 틀린 분포가 된다 — `budget_omitted`로 답한다.
   */
  if (response.timed_out === true) return OMITTED;

  const raw = response.aggregations;
  if (raw === undefined) return FAILED;

  const facets: Record<string, readonly FacetValue[]> = {};
  const teamIds = new Set<number>();

  for (const axis of request.axes) {
    const aggregation = raw[axis.key] as TermsAggregation | undefined;
    const buckets = aggregation?.buckets ?? [];
    if (buckets.length === 0) continue;

    facets[axis.key] = buckets.map((bucket) => ({ value: String(bucket.key), count: bucket.doc_count }));
    if (axis.display === 'team') {
      for (const bucket of buckets) {
        const id = Number(bucket.key);
        if (Number.isSafeInteger(id)) teamIds.add(id);
      }
    }
  }

  if (teamIds.size > 0 && deps.resolveTeamSlugs !== undefined) {
    let slugs: ReadonlyMap<number, string>;
    try {
      slugs = await deps.resolveTeamSlugs([...teamIds]);
    } catch {
      // 표시 이름을 못 얻은 것은 분포를 못 센 것과 다르다. 숫자로 남긴다.
      slugs = new Map();
    }
    for (const axis of request.axes) {
      if (axis.display !== 'team') continue;
      const values = facets[axis.key];
      if (values === undefined) continue;
      /*
       * 못 찾은 ID는 **숫자 그대로 남긴다.**
       *
       * 버리면 그 팀의 건수가 조용히 사라지고, 남기면 사용자가 누를 때
       * `team:<숫자>`가 되어 `unresolved_names` 경고로 드러난다. 조용히 적게
       * 답하는 쪽을 고르지 않는다 (DEV-052가 정한 규칙과 같다).
       */
      facets[axis.key] = values.map((entry) => {
        const slug = slugs.get(Number(entry.value));
        return slug === undefined ? entry : { value: slug, count: entry.count };
      });
    }
  }

  return { facets, omitted: false, status: 'ready' };
}

/**
 * 응답에 실을 세 키.
 *
 * **함께 나타나거나 함께 빠진다** (CR-019 DEV-076). 요청하지 않았으면 빈 객체를
 * 돌려 호출부가 스프레드로 아무것도 더하지 않게 한다 — `facets: {}`를 내보내는
 * 것과 다르다. 그 둘의 차이가 "세지 않았다"와 "세었는데 비었다"이다.
 */
export function facetResponseFields(outcome: FacetOutcome | null): Record<string, unknown> {
  if (outcome === null) return {};
  return {
    facets: outcome.facets,
    facets_omitted: outcome.omitted,
    facets_status: outcome.status,
  };
}
