/**
 * 네 집계의 Elasticsearch 질의와 응답 변환 (WP-037 / FR-STAT-001~005).
 *
 * **여기에는 접근 통제가 없다.** 질의는 `prepare.ts`가 이미 `ScopedQuery`로
 * 만들었고 이 모듈은 그 위에 얹을 집계 모양만 만든다. 두 관심사를 한 파일에
 * 두면 "여기서는 필터를 붙였던가"를 매번 다시 읽어야 한다.
 *
 * **조회 시점 `script`를 쓰지 않는다** (NFR-001, 데이터 모델 6장). 네 집계가
 * 읽는 값은 모두 색인 시점에 계산된 필드다 — `changed_lines`가 `CR-053`에서
 * 사전 계산 필드로 들어온 것이 그 규율 때문이다.
 */

import type { estypes } from '@elastic/elasticsearch';
import { replaceEquality, serializeQuery, type QueryAst } from '@prs/query';
import {
  DEFAULT_PERCENTILES,
  DISTRIBUTION_BUCKETS,
  DIMENSION_FIELDS,
  GROUP_FIELDS,
  GROUP_QUERY_KEYS,
  LOW_SAMPLE_THRESHOLD,
  MAX_GROUPS,
  MAX_SERIES,
  type Dimension,
  type GroupKey,
  type Interval,
  type MetricKey,
  type PercentileField,
} from './types.js';

/**
 * 그룹 정렬 (FR-STAT-001 AC-8). 건수 내림차순, 동률이면 키 오름차순.
 *
 * **호출마다 새 배열을 만든다.** 하나를 공유해 넘기면 Elasticsearch 클라이언트가
 * 그 객체를 손대는 날 세 집계가 함께 바뀐다.
 */
function groupOrder(): estypes.AggregationsAggregateOrder {
  return [{ _count: 'desc' }, { _key: 'asc' }];
}

/**
 * 근거 목록으로 갈 질의 (FR-STAT-001 AC-5, DEV-383).
 *
 * **`kind:pull_request`를 반드시 넣는다.** 집계는 PR만 세는데 목록은 PR과
 * 커밋을 함께 보이므로, 이 조건이 없으면 사용자가 누른 412가 목록에서 더 큰
 * 수가 되어 돌아온다.
 *
 * 그룹 조건은 **`GROUP_QUERY_KEYS`를 지난다** — `team` 그룹이 `team:`이 아니라
 * `author_team:`이 되는 자리가 여기다 (DEV-382).
 */
export function drillDownQuery(base: QueryAst, key: GroupKey, value: string): string {
  /*
   * **더하지 않고 대체한다** (PR #76 리뷰 P2).
   *
   * 버킷을 누르는 것은 그 버킷으로 **좁히는** 일이다. `author:alice author:bob`에서
   * alice를 눌렀는데 OR가 남으면 목록이 버킷보다 큰 수를 보인다. `kind`도 같다 —
   * 질의에 `kind:commit`이 있으면 더하기만 해서는 커밋이 그대로 남는다.
   */
  const withKind = replaceEquality(base, 'kind', 'pull_request');
  return serializeQuery(replaceEquality(withKind, GROUP_QUERY_KEYS[key], value));
}

/** 구간 하나에 대한 근거 질의. 구간 조건은 질의 문법에 없으므로 유형만 좁힌다. */
export function distributionDrillDown(base: QueryAst): string {
  return serializeQuery(replaceEquality(base, 'kind', 'pull_request'));
}

// ---------------------------------------------------------------------------
// API-STAT-001 그룹 집계
// ---------------------------------------------------------------------------

export interface GroupRow {
  readonly key: string;
  readonly count: number;
  readonly changed_files_sum?: number;
  readonly additions_sum?: number;
  readonly lead_time_median?: number | null;
  readonly drill_down_query: string;
}

export function buildGroupsAggs(
  groupBy: GroupKey,
  metrics: readonly MetricKey[],
  size: number,
): Record<string, estypes.AggregationsAggregationContainer> {
  const inner: Record<string, estypes.AggregationsAggregationContainer> = {};
  if (metrics.includes('changed_files_sum')) {
    inner['changed_files_sum'] = { sum: { field: 'changed_files_count' } };
  }
  if (metrics.includes('additions_sum')) inner['additions_sum'] = { sum: { field: 'additions' } };
  if (metrics.includes('lead_time_median')) {
    /*
     * **`API-STAT-003`의 `p50`과 같은 값이다** (FR-STAT-003 AC-6, DEV-390).
     * 중앙값을 따로 계산하는 집계를 쓰지 않는 것은 두 API가 같은 것을 다른
     * 방법으로 계산해 미세하게 다른 수를 내는 일을 막기 위해서다.
     */
    inner['lead_time_median'] = { percentiles: { field: 'lead_time_seconds', percents: [50] } };
  }

  return {
    groups: {
      terms: {
        field: GROUP_FIELDS[groupBy],
        size: Math.min(size, MAX_GROUPS),
        order: groupOrder(),
      },
      ...(Object.keys(inner).length === 0 ? {} : { aggs: inner }),
    },
  };
}

function percentileValue(
  agg: estypes.AggregationsAggregate | undefined,
  percent: number,
): number | null {
  const values = (agg as { values?: Record<string, number | null> } | undefined)?.values;
  if (values === undefined) return null;
  const raw = values[`${String(percent)}.0`] ?? values[String(percent)];
  return typeof raw === 'number' ? raw : null;
}

export interface GroupsOutcome {
  readonly groups: readonly GroupRow[];
  readonly truncated: boolean;
}

export function toGroupsOutcome(
  aggregations: Record<string, estypes.AggregationsAggregate>,
  input: {
    readonly ast: QueryAst;
    readonly groupBy: GroupKey;
    readonly metrics: readonly MetricKey[];
    /**
     * 버킷 키 → 사용자가 읽고 질의에 쓰는 값 (PR #76 리뷰 P1).
     *
     * `org`와 `team`의 버킷 키는 `org_id`·`author_team_ids`라 **숫자**인데
     * 질의는 이름·slug를 받는다. 그 숫자를 그대로 근거 질의에 넣으면
     * `org:77`이 되어 아무것도 찾지 못한다 — 버킷은 건수를 보이는데 눌러 보면
     * 0건인 자리다. **일괄로 해석해 넘긴다** (버킷마다 조회하면 N+1이다).
     */
    readonly display?: ReadonlyMap<string, string>;
  },
): GroupsOutcome {
  const agg = aggregations['groups'] as
    | { buckets?: readonly Record<string, unknown>[]; sum_other_doc_count?: number }
    | undefined;
  const buckets = agg?.buckets ?? [];

  const groups = buckets.map((bucket): GroupRow => {
    const raw = String(bucket['key']);
    /*
     * 해석하지 못한 키는 **그대로 둔다.** 레지스트리에서 사라진 조직·팀이
     * 문서에는 남아 있을 수 있고, 그때 이름을 지어내면 없는 것을 있다고
     * 말하게 된다. 근거 질의는 그 값으로도 0건이지만 **버킷이 거짓말하지는
     * 않는다.**
     */
    const key = input.display?.get(raw) ?? raw;
    const row: Record<string, unknown> = {
      key,
      count: Number(bucket['doc_count'] ?? 0),
      drill_down_query: drillDownQuery(input.ast, input.groupBy, key),
    };
    if (input.metrics.includes('changed_files_sum')) {
      row['changed_files_sum'] = Number((bucket['changed_files_sum'] as { value?: number })?.value ?? 0);
    }
    if (input.metrics.includes('additions_sum')) {
      row['additions_sum'] = Number((bucket['additions_sum'] as { value?: number })?.value ?? 0);
    }
    if (input.metrics.includes('lead_time_median')) {
      row['lead_time_median'] = percentileValue(
        bucket['lead_time_median'] as estypes.AggregationsAggregate,
        50,
      );
    }
    return row as unknown as GroupRow;
  });

  /*
   * **`sum_other_doc_count`가 절삭의 정본이다** (FR-STAT-001 AC-3).
   *
   * `buckets.length === size`로 판정하면 그룹 수가 정확히 상한과 같을 때
   * 절삭하지 않았는데도 절삭했다고 말한다.
   */
  return { groups, truncated: (agg?.sum_other_doc_count ?? 0) > 0 };
}

// ---------------------------------------------------------------------------
// API-STAT-002 시계열
// ---------------------------------------------------------------------------

const CALENDAR_INTERVAL: Readonly<Record<Interval, estypes.AggregationsCalendarInterval>> = {
  hour: 'hour',
  day: 'day',
  week: 'week',
  month: 'month',
};

export function buildTimeSeriesAggs(input: {
  readonly interval: Interval;
  readonly timezone: string;
  readonly from: string;
  readonly to: string;
  readonly groupBy: GroupKey | null;
}): Record<string, estypes.AggregationsAggregationContainer> {
  /*
   * **버킷 경계를 요청 시간대에서 계산한다** (FR-STAT-002 AC-2).
   *
   * UTC로 나눈 뒤 이름만 바꾸면 자정 경계가 어긋나 하루가 밀린다.
   * `time_zone`을 Elasticsearch에 넘겨 DST와 오프셋 처리를 맡긴다.
   */
  const histogram: estypes.AggregationsAggregationContainer = {
    date_histogram: {
      field: 'merged_at',
      calendar_interval: CALENDAR_INTERVAL[input.interval],
      time_zone: input.timezone,
      // 데이터 없는 구간도 0으로 채운다 (AC-4). 경계는 요청 구간 그대로다.
      min_doc_count: 0,
      extended_bounds: { min: input.from, max: input.to },
    },
  };

  if (input.groupBy === null) return { buckets: histogram };

  return {
    series: {
      terms: {
        field: GROUP_FIELDS[input.groupBy],
        size: MAX_SERIES,
        order: groupOrder(),
      },
      aggs: { buckets: histogram },
    },
  };
}

export interface TimeSeriesOutcome {
  readonly buckets: readonly string[];
  readonly series: readonly { readonly key: string; readonly values: readonly number[] }[];
  readonly truncated: boolean;
}

function histogramBuckets(
  agg: estypes.AggregationsAggregate | undefined,
): readonly Record<string, unknown>[] {
  return ((agg as { buckets?: readonly Record<string, unknown>[] } | undefined)?.buckets ?? []);
}

export function toTimeSeriesOutcome(
  aggregations: Record<string, estypes.AggregationsAggregate>,
  groupBy: GroupKey | null,
): TimeSeriesOutcome {
  if (groupBy === null) {
    const buckets = histogramBuckets(aggregations['buckets']);
    return {
      buckets: buckets.map((one) => String(one['key_as_string'] ?? one['key'])),
      series: [{ key: 'all', values: buckets.map((one) => Number(one['doc_count'] ?? 0)) }],
      truncated: false,
    };
  }

  const outer = aggregations['series'] as
    | { buckets?: readonly Record<string, unknown>[]; sum_other_doc_count?: number }
    | undefined;
  const groups = outer?.buckets ?? [];

  /*
   * **버킷 라벨은 첫 계열에서 가져온다.** 계열마다 같은 히스토그램을 돌리므로
   * 경계가 같고, `extended_bounds`가 빈 구간까지 채우므로 길이도 같다.
   */
  const labels = groups.length === 0 ? [] : histogramBuckets(
    groups[0]?.['buckets'] as estypes.AggregationsAggregate,
  ).map((one) => String(one['key_as_string'] ?? one['key']));

  return {
    buckets: labels,
    series: groups.map((group) => ({
      key: String(group['key']),
      values: histogramBuckets(group['buckets'] as estypes.AggregationsAggregate).map((one) =>
        Number(one['doc_count'] ?? 0),
      ),
    })),
    truncated: (outer?.sum_other_doc_count ?? 0) > 0,
  };
}

// ---------------------------------------------------------------------------
// API-STAT-003 백분위
// ---------------------------------------------------------------------------

export function buildPercentilesAggs(input: {
  readonly field: PercentileField;
  readonly percentiles: readonly number[];
  readonly groupBy: GroupKey | null;
}): Record<string, estypes.AggregationsAggregationContainer> {
  const stats: Record<string, estypes.AggregationsAggregationContainer> = {
    percentiles: { percentiles: { field: input.field, percents: [...input.percentiles] } },
    // 표본 수는 **그 필드에 값이 있는 문서 수**다. 전체 건수가 아니다 —
    // 리뷰가 없는 PR은 `first_review_wait_seconds`가 없고 집계 대상이 아니다.
    sample_size: { value_count: { field: input.field } },
    /*
     * 제외 사유를 가른다 (FR-STAT-004 AC-1, 예외/실패 처리).
     *
     * **리뷰가 없어서 값이 없는 것과 보강이 끝나지 않아 모르는 것은 다른
     * 사실이다.** 하나로 묶으면 운영자가 "리뷰 문화"와 "파이프라인 지연"을
     * 구분할 수 없다.
     */
    enrichment_pending: { filter: { term: { enrichment_pending: true } } },
    /*
     * 표본이 적을 때 돌려줄 원값 (FR-STAT-003 예외/실패 처리, PR #76 리뷰 P2).
     *
     * **계약은 "백분위 **대신** 원값 목록"이다.** 표본 20건 미만에서 백분위는
     * 흔들리는 수이고, 그것을 그대로 내보내면 화면이 의미 있는 값처럼 그린다.
     *
     * 상한까지만 모으므로 표본이 많으면 이 값은 쓰이지 않는다. `_source`를
     * 그 필드 하나로 좁혀 문서 본문이 딸려 나오지 않게 한다.
     */
    raw_values: {
      top_hits: { size: LOW_SAMPLE_THRESHOLD, _source: [input.field], sort: [{ [input.field]: 'asc' }] },
    },
  };

  if (input.groupBy === null) return stats;

  return {
    ...stats,
    groups: {
      terms: { field: GROUP_FIELDS[input.groupBy], size: MAX_GROUPS, order: groupOrder() },
      aggs: stats,
    },
  };
}

export interface PercentileRow {
  readonly key: string;
  readonly values: Readonly<Record<string, number | null>>;
  readonly sample_size: number;
  readonly low_sample: boolean;
  /**
   * 표본이 적을 때의 원값 (FR-STAT-003 예외/실패 처리).
   *
   * **`low_sample`일 때만 채운다.** 계약이 "백분위 대신"이라 말하므로, 둘을
   * 함께 내보내면 화면이 흔들리는 백분위를 그릴 여지가 남는다.
   */
  readonly raw_values?: readonly number[];
}

/** `top_hits`가 담아 온 원값. 그 필드 하나만 실려 있다. */
function rawValues(source: Record<string, unknown>, field: string): readonly number[] {
  const hits = (source['raw_values'] as { hits?: { hits?: readonly { _source?: Record<string, unknown> }[] } })
    ?.hits?.hits;
  if (hits === undefined) return [];
  return hits
    .map((hit) => hit._source?.[field])
    .filter((value): value is number => typeof value === 'number');
}

function percentileRow(
  source: Record<string, unknown>,
  key: string,
  percentiles: readonly number[],
  field: string,
): PercentileRow {
  const sampleSize = Number((source['sample_size'] as { value?: number })?.value ?? 0);
  const agg = source['percentiles'] as estypes.AggregationsAggregate;
  const values: Record<string, number | null> = {};
  for (const percent of percentiles) {
    values[`p${String(percent)}`] = percentileValue(agg, percent);
  }
  // **경계는 20이다.** 19는 `true`, 20은 `false` (FR-STAT-003 예외/실패 처리).
  const low = sampleSize < LOW_SAMPLE_THRESHOLD;
  return {
    key,
    values,
    sample_size: sampleSize,
    low_sample: low,
    ...(low ? { raw_values: rawValues(source, field) } : {}),
  };
}

export interface PercentilesOutcome {
  readonly overall: PercentileRow;
  readonly groups: readonly PercentileRow[];
  readonly excludedCount: number;
  readonly excludedReasons: Readonly<Record<string, number>>;
}

export function toPercentilesOutcome(
  aggregations: Record<string, estypes.AggregationsAggregate>,
  input: {
    readonly percentiles: readonly number[];
    readonly groupBy: GroupKey | null;
    readonly total: number;
    readonly field: string;
  },
): PercentilesOutcome {
  const overall = percentileRow(aggregations, 'overall', input.percentiles, input.field);
  const pending = Number(
    (aggregations['enrichment_pending'] as { doc_count?: number } | undefined)?.doc_count ?? 0,
  );

  /*
   * 제외 = 대상 전체 − 값이 있는 문서. 그중 보강 대기가 몇인지 따로 센다.
   *
   * 나머지는 "리뷰가 없어서"다 — 그 둘의 합이 제외 수와 같도록 계산한다.
   * 음수가 나오지 않게 막는 것은 근사 집계에서 표본으로 되돌린 수가 어긋날 수
   * 있기 때문이다.
   */
  const excluded = Math.max(input.total - overall.sample_size, 0);
  const enrichmentPending = Math.min(pending, excluded);

  const groups =
    aggregations['groups'] === undefined
      ? []
      : (
          (aggregations['groups'] as { buckets?: readonly Record<string, unknown>[] }).buckets ?? []
        ).map((bucket) =>
          percentileRow(bucket, String(bucket['key']), input.percentiles, input.field),
        );

  return {
    overall,
    groups,
    excludedCount: excluded,
    excludedReasons: {
      no_review: excluded - enrichmentPending,
      enrichment_pending: enrichmentPending,
    },
  };
}

// ---------------------------------------------------------------------------
// API-STAT-004 분포
// ---------------------------------------------------------------------------

export function buildDistributionsAggs(
  dimension: Dimension,
): Record<string, estypes.AggregationsAggregationContainer> {
  const field = DIMENSION_FIELDS[dimension];
  const specs = DISTRIBUTION_BUCKETS[dimension];

  return {
    ranges: {
      range: {
        field,
        // Elasticsearch의 `range`는 `from` 포함, `to` 제외다. 계약의 구간은
        // 양끝 포함이므로 `to`에 1을 더한다.
        ranges: specs.map((spec) => ({
          key: spec.key,
          from: spec.from,
          ...(spec.to === null ? {} : { to: spec.to + 1 }),
        })),
      },
    },
    /*
     * **값이 없는 문서는 구간이 아니라 `unknown`이다** (FR-STAT-005 AC-5).
     *
     * 0과 다르다 — 파일 0개를 바꾼 PR은 자기 구간에 들어가고, 보강이 끝나지
     * 않아 값을 모르는 PR만 여기 온다. 둘을 합치면 화면이 "0줄 바꿨다"라는
     * 사실 주장을 하게 된다.
     */
    unknown: { missing: { field } },
  };
}

export interface DistributionRow {
  readonly key: string;
  readonly from: number | null;
  readonly to: number | null;
  readonly count: number;
  readonly ratio: number;
  readonly drill_down_query: string | null;
}

export function toDistributionsOutcome(
  aggregations: Record<string, estypes.AggregationsAggregate>,
  input: { readonly ast: QueryAst; readonly dimension: Dimension; readonly total: number },
): readonly DistributionRow[] {
  const specs = DISTRIBUTION_BUCKETS[input.dimension];
  const buckets =
    ((aggregations['ranges'] as { buckets?: readonly Record<string, unknown>[] } | undefined)
      ?.buckets ?? []);
  const counted = new Map<string, number>();
  for (const bucket of buckets) counted.set(String(bucket['key']), Number(bucket['doc_count'] ?? 0));

  const unknown = Number(
    (aggregations['unknown'] as { doc_count?: number } | undefined)?.doc_count ?? 0,
  );
  // `total`이 0이면 모든 구간이 0이다 (예외/실패 처리). 0으로 나누지 않는다.
  const ratioOf = (count: number): number => (input.total === 0 ? 0 : count / input.total);
  const drillDown = distributionDrillDown(input.ast);

  const rows: DistributionRow[] = specs.map((spec) => ({
    key: spec.key,
    from: spec.from,
    to: spec.to,
    count: counted.get(spec.key) ?? 0,
    ratio: ratioOf(counted.get(spec.key) ?? 0),
    drill_down_query: drillDown,
  }));

  rows.push({
    key: 'unknown',
    from: null,
    to: null,
    count: unknown,
    ratio: ratioOf(unknown),
    // **`unknown`에는 근거 목록으로 갈 길이 없다.** 질의 문법에 "값이 없음"을
    // 나타내는 조건이 없으므로, 있는 척하는 문자열을 만들지 않는다.
    drill_down_query: null,
  });

  return rows;
}

export const DEFAULT_PERCENTILE_LIST: readonly number[] = DEFAULT_PERCENTILES;
