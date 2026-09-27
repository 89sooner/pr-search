/**
 * W-006 통계 대시보드의 순수 계층 (WP-038 / FR-STAT-001~006, CR-053).
 *
 * ## 왜 순수 계층을 먼저 세우는가
 *
 * 집계는 답이 하나의 수라서 사용자가 눈으로 검증할 방법이 없다. `timed_out`,
 * 부분 샤드, 상한까지만 센 수, 범위 밖 문서, 좁히지 않은 모집단이 전부 그 하나에
 * 섞여 들어가며 어느 것도 오류를 내지 않는다(WP-037 세션의 발견). 서버가 그것을
 * 이미 판정해 응답 필드로 실어 보내므로, 화면이 할 일은 **그 사실을 왜곡 없이
 * 그리는 것**이다. 판정을 다시 하지 않는다 — 여기서 하는 것은 "무엇을 받았는가"를
 * 상태 하나로 좁히고, 근거 목록으로 갈 링크를 만드는 것뿐이다.
 *
 * ## 판정을 클라이언트가 다시 만들지 않는다
 *
 * `approximate`·`truncated`·`low_sample`·`excluded_count`는 서버가 준 값을
 * 그대로 읽는다. 드릴다운 질의도 그룹·분포는 서버가 실어 준 `drill_down_query`를
 * 그대로 W-001에 넘긴다(재조립하면 OR가 남거나 `author_team:` 인코딩이 틀린다,
 * WP-037 리뷰). 시계열 버킷만 서버 문자열이 없어 클라이언트가 기간 범위를 만든다
 * (DEV-396) — 그것은 `merged:` 범위 하나이지 그룹 인코딩이 아니다.
 */

import {
  addDays,
  canonicalTimeZone,
  endOfMonth,
  parseQuery,
  serializeQuery,
  hasSequenceRangeFilter,
  QueryParseError,
  zonedDate,
} from '@prs/query';
import { formatInTimeZone, timeZoneLabel } from './format';

// ---------------------------------------------------------------------------
// URL 상태
// ---------------------------------------------------------------------------

/**
 * `/analytics`가 URL에 싣는 것. 딥링크 재현에 필요한 최소값만 둔다.
 *
 * **API와 같은 snake_case를 쓴다** (§21). 와이어프레임 예시의 `groupBy`가 아니라
 * `group_by`다 — 요청 본문과 이름이 어긋나면 그 사이에서 매핑이 한 번 더 생긴다.
 * `seq_epoch`은 질의에 `seq:` 범위가 있을 때만 싣는다(CR-051, ADR-007 규칙 5).
 */
export const ANALYTICS_PARAM = {
  query: 'q',
  groupBy: 'group_by',
  interval: 'interval',
  from: 'from',
  to: 'to',
  timezone: 'timezone',
  seqEpoch: 'seq_epoch',
} as const;

export const INTERVALS = ['hour', 'day', 'week', 'month'] as const;
export type Interval = (typeof INTERVALS)[number];
export function isInterval(value: string): value is Interval {
  return (INTERVALS as readonly string[]).includes(value);
}

export const GROUP_KEYS = [
  'repository',
  'org',
  'team',
  'author',
  'label',
  'base_branch',
  'state',
] as const;
export type GroupKey = (typeof GROUP_KEYS)[number];
export function isGroupKey(value: string): value is GroupKey {
  return (GROUP_KEYS as readonly string[]).includes(value);
}

export const DEFAULT_INTERVAL: Interval = 'day';
export const DEFAULT_TIMEZONE = 'Asia/Seoul';

export interface AnalyticsUrlState {
  readonly q: string;
  /** `null`이면 그룹 없는 전체 집계다. */
  readonly groupBy: GroupKey | null;
  readonly interval: Interval;
  /**
   * 날짜(`YYYY-MM-DD`) — 대시보드 시간대(`timezone`)의 달력 날짜다(FR-STAT-002 AC-7, CR-127).
   * `null`이면 서버가 그 시간대의 오늘을 포함한 30일을 적용하고 `applied_range`로 알린다.
   */
  readonly from: string | null;
  readonly to: string | null;
  readonly timezone: string;
  /** `seq:` 질의에서만 값이 있다. 원문을 그대로 나른다(PR #64 리뷰). */
  readonly seqEpoch: string | null;
}

export const EMPTY_ANALYTICS_STATE: AnalyticsUrlState = {
  q: '',
  groupBy: null,
  interval: DEFAULT_INTERVAL,
  from: null,
  to: null,
  timezone: DEFAULT_TIMEZONE,
  seqEpoch: null,
};

export function readAnalyticsState(search: string | URLSearchParams): AnalyticsUrlState {
  const params = typeof search === 'string' ? new URLSearchParams(search) : search;
  const rawGroup = params.get(ANALYTICS_PARAM.groupBy);
  const rawInterval = params.get(ANALYTICS_PARAM.interval);
  const tz = params.get(ANALYTICS_PARAM.timezone);
  return {
    q: params.get(ANALYTICS_PARAM.query) ?? '',
    groupBy: rawGroup !== null && isGroupKey(rawGroup) ? rawGroup : null,
    interval: rawInterval !== null && isInterval(rawInterval) ? rawInterval : DEFAULT_INTERVAL,
    from: params.get(ANALYTICS_PARAM.from),
    to: params.get(ANALYTICS_PARAM.to),
    timezone: tz !== null && tz !== '' ? tz : DEFAULT_TIMEZONE,
    seqEpoch: params.get(ANALYTICS_PARAM.seqEpoch),
  };
}

export function writeAnalyticsState(state: AnalyticsUrlState): string {
  const params = new URLSearchParams();
  if (state.q.trim() !== '') params.set(ANALYTICS_PARAM.query, state.q.trim());
  if (state.groupBy !== null) params.set(ANALYTICS_PARAM.groupBy, state.groupBy);
  if (state.interval !== DEFAULT_INTERVAL) params.set(ANALYTICS_PARAM.interval, state.interval);
  if (state.from !== null) params.set(ANALYTICS_PARAM.from, state.from);
  if (state.to !== null) params.set(ANALYTICS_PARAM.to, state.to);
  if (state.timezone !== DEFAULT_TIMEZONE) params.set(ANALYTICS_PARAM.timezone, state.timezone);
  /*
   * **`seq:`가 없으면 에폭을 싣지 않는다** (CR-051). 뜻이 없어진 파라미터를
   * 남기면 다음 조회가 그것을 근거로 400을 받는다. 질의에 `seq:` 범위가 있을
   * 때만 원문을 그대로 싣는다.
   */
  if (state.seqEpoch !== null && analyticsQueryHasSeqRange(state.q)) {
    params.set(ANALYTICS_PARAM.seqEpoch, state.seqEpoch);
  }
  return params.toString();
}

export function analyticsHref(state: AnalyticsUrlState): string {
  const search = writeAnalyticsState(state);
  return search === '' ? '/analytics' : `/analytics?${search}`;
}

/** 질의에 `seq:` 범위가 있는가. 파싱 실패는 "없다"로 접는다(서버가 다시 판정한다). */
function analyticsQueryHasSeqRange(q: string): boolean {
  if (q.trim() === '') return false;
  try {
    return hasSequenceRangeFilter(parseQuery(q));
  } catch (error) {
    if (error instanceof QueryParseError) return false;
    throw error;
  }
}

// ---------------------------------------------------------------------------
// 요청 본문
// ---------------------------------------------------------------------------

interface EpochField {
  readonly seq_epoch?: string;
}

/** `seq:`가 있을 때만 `seq_epoch`을 붙인다. 없으면 서버가 현재 에폭으로 바인딩한다. */
function epochField(state: AnalyticsUrlState): EpochField {
  if (state.seqEpoch === null || !analyticsQueryHasSeqRange(state.q)) return {};
  return { seq_epoch: state.seqEpoch };
}

export const GROUP_METRICS = ['count', 'changed_files_sum', 'additions_sum', 'lead_time_median'] as const;

export function buildGroupsRequest(state: AnalyticsUrlState): Record<string, unknown> {
  return {
    query: state.q,
    ...(state.groupBy === null ? {} : { group_by: state.groupBy }),
    metrics: [...GROUP_METRICS],
    ...epochField(state),
  };
}

export function buildTimeSeriesRequest(state: AnalyticsUrlState): Record<string, unknown> {
  return {
    query: state.q,
    interval: state.interval,
    timezone: state.timezone,
    ...(state.from === null ? {} : { from: state.from }),
    ...(state.to === null ? {} : { to: state.to }),
    ...(state.groupBy === null ? {} : { group_by: state.groupBy }),
    metric: 'count',
    ...epochField(state),
  };
}

export function buildPercentilesRequest(
  state: AnalyticsUrlState,
  field: 'lead_time_seconds' | 'first_review_wait_seconds',
): Record<string, unknown> {
  return {
    query: state.q,
    field,
    ...(state.groupBy === null ? {} : { group_by: state.groupBy }),
    ...epochField(state),
  };
}

export function buildDistributionsRequest(
  state: AnalyticsUrlState,
  dimension: 'changed_files' | 'changed_lines',
): Record<string, unknown> {
  return {
    query: state.q,
    dimension,
    ...epochField(state),
  };
}

// ---------------------------------------------------------------------------
// 패널 상태 판정
// ---------------------------------------------------------------------------

/**
 * 한 패널의 상태. **패널마다 독립이다** — 한 패널이 timeout이어도 나머지는
 * 자기 상태를 유지한다(상태 매트릭스 W-006 `partial_failure`).
 *
 * 공통 실패(`auth_expired`)는 대시보드 전체가 성립하지 않으므로 뷰가 따로
 * 처리한다. 여기서 좁히는 것은 한 패널이 받은 것뿐이다.
 */
export type PanelState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready' }
  | { readonly kind: 'empty_no_data' }
  | { readonly kind: 'approximate'; readonly sampleProbability: number | null }
  | { readonly kind: 'epoch_stale'; readonly requested: string | null; readonly context: unknown }
  | { readonly kind: 'error_too_many_buckets'; readonly bucketCount: number | null; readonly max: number | null }
  | { readonly kind: 'error_aggregation_timeout' }
  | { readonly kind: 'auth_expired'; readonly loginPath: string }
  | { readonly kind: 'no_permission' }
  | { readonly kind: 'offline' }
  | { readonly kind: 'error_other'; readonly code: string; readonly message: string; readonly correlationId: string | null };

export interface PanelInput {
  readonly loading: boolean;
  readonly networkFailed: boolean;
  readonly status: number | null;
  readonly body: AnalyticsBody | null;
  readonly loginPath: string;
  /** 이 패널이 "빈 데이터"로 볼 조건. 응답을 읽어 뷰가 판정해 넘긴다. */
  readonly isEmpty?: boolean;
}

export interface AnalyticsBody {
  readonly epoch_stale?: boolean;
  readonly requested_seq_epoch?: string;
  readonly sequence_context?: unknown;
  readonly approximate?: boolean;
  readonly sample_probability?: number;
  readonly total?: { readonly value: number; readonly relation: string };
  readonly error?: {
    readonly code: string;
    readonly message: string;
    readonly detail?: Readonly<Record<string, unknown>>;
  };
  readonly correlation_id?: string;
}

/**
 * 패널 하나의 상태로 좁힌다.
 *
 * 순서가 규율이다. `epoch_stale`은 200에 실려 오므로 오류보다 **먼저** 본다 —
 * 빈 결과나 0으로 그리지 않고 그 사실로 그린다(FR-STAT-006 AC-6, DEV-384).
 */
export function resolvePanelState(input: PanelInput): PanelState {
  if (input.loading) return { kind: 'loading' };
  if (input.networkFailed) return { kind: 'offline' };

  const body = input.body;
  const status = input.status;

  // 200 특수 본문: 에폭이 낡았다. 0/빈 버킷으로 그리지 않는다.
  if (body?.epoch_stale === true) {
    return {
      kind: 'epoch_stale',
      requested: body.requested_seq_epoch ?? null,
      context: body.sequence_context ?? null,
    };
  }

  if (status !== null && status >= 400) {
    const code = body?.error?.code ?? 'UNKNOWN';
    const message = body?.error?.message ?? '';
    const correlationId = body?.correlation_id ?? null;
    if (status === 401) return { kind: 'auth_expired', loginPath: input.loginPath };
    if (status === 403) return { kind: 'no_permission' };
    if (code === 'PERMISSION_UNAVAILABLE') return { kind: 'no_permission' };
    if (code === 'TOO_MANY_BUCKETS') {
      const detail = body?.error?.detail ?? {};
      return {
        kind: 'error_too_many_buckets',
        bucketCount: numberOrNull(detail['bucket_count']),
        max: numberOrNull(detail['max']),
      };
    }
    if (code === 'AGGREGATION_TIMEOUT') return { kind: 'error_aggregation_timeout' };
    return { kind: 'error_other', code, message, correlationId };
  }

  if (input.isEmpty === true) return { kind: 'empty_no_data' };

  if (body?.approximate === true) {
    return { kind: 'approximate', sampleProbability: body.sample_probability ?? null };
  }

  return { kind: 'ready' };
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

// ---------------------------------------------------------------------------
// 드릴다운 (근거 목록 W-001로)
// ---------------------------------------------------------------------------

/**
 * 그룹·분포의 드릴다운. **서버가 준 `drill_down_query`를 그대로 W-001에 넘긴다.**
 *
 * `null`이면 갈 곳이 없다(분포의 `unknown` 구간) — 링크를 만들지 않는다.
 * `seq:` 범위가 있으면 현재 에폭도 보존한다(CR-051).
 */
export function drillDownHref(drillDownQuery: string | null, seqEpoch: string | null): string | null {
  if (drillDownQuery === null || drillDownQuery.trim() === '') return null;
  const params = new URLSearchParams();
  params.set('q', drillDownQuery);
  if (seqEpoch !== null && hasSeqRange(drillDownQuery)) params.set('seq_epoch', seqEpoch);
  return `/search?${params.toString()}`;
}

/** 시계열 응답이 말한 달력 — 버킷을 나눈 시간대와 실제로 적용된 기간 (CR-127). */
export interface BucketCalendar {
  /** 응답의 `timezone`(서버가 정규화한 값). */
  readonly timezone: string;
  /** 응답의 `applied_range`. 날짜 기간이면 버킷 링크를 그 안으로 자른다. */
  readonly appliedRange: { readonly from: string; readonly to: string } | null;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** 버킷 키(요청 시간대로 그린 시작 순간)를 그 시간대의 날짜로. 날짜만 온 키는 그대로다. */
function bucketDate(bucketKey: string, timezone: string): string | null {
  if (DATE_ONLY.test(bucketKey)) return bucketKey;
  const at = Date.parse(bucketKey);
  return Number.isNaN(at) ? null : zonedDate(at, timezone);
}

/**
 * 시계열 버킷의 드릴다운. 서버가 문자열을 주지 않아 클라이언트가 **기간만** 만든다
 * (DEV-396). 그룹 인코딩을 재조립하는 것이 아니라 `merged:` 범위 하나를 더한다.
 *
 * **일·주·월 버킷은 대시보드 시간대의 달력 날짜 범위다** (FR-STAT-002 AC-7, CR-127) —
 * `merged:<버킷 첫날>..<버킷 끝날>@<시간대>`. 서버가 버킷과 같은 달력으로 모집단을
 * 거르므로 버킷의 수와 이 검색의 수가 같다. 기간의 앞뒤가 주·월 버킷 중간에 걸리면
 * 적용 기간과 겹친 만큼만 간다. 전에는 버킷 시작 순간에 UTC 달을 더하고 1ms를 빼서
 * 끝을 만들었는데, KST 9월 버킷이 10월 1일 하루를 더 가져갔다(DEV-781).
 *
 * **시간 버킷은 순간 범위 그대로다** — 달력 범위가 아니고, 한 시간은 어느 시간대에서나
 * 같은 순간 사이다. 반열림 버킷을 양끝 포함 순간 범위로 옮기려고 끝을 다음 버킷 직전
 * (-1ms)으로 둔다(PR #80 리뷰 P2) — 밀리초 정밀도의 `merged_at`에서 정확하다.
 *
 * 파서로 왕복해 사용자가 친 질의와 같은 문법을 쓴다(ADR-001).
 */
export function bucketDrillDownHref(
  baseQuery: string,
  bucketStartIso: string,
  interval: Interval,
  seqEpoch: string | null,
  calendar: BucketCalendar,
): string | null {
  let range: string;
  if (interval === 'hour') {
    const start = new Date(bucketStartIso);
    if (Number.isNaN(start.getTime())) return null;
    const end = new Date(start.getTime() + 3_600_000 - 1);
    range = `merged:${start.toISOString()}..${end.toISOString()}`;
  } else {
    const timezone = canonicalTimeZone(calendar.timezone);
    if (timezone === null) return null;
    const first = bucketDate(bucketStartIso, timezone);
    if (first === null) return null;
    const last = interval === 'day' ? first : interval === 'week' ? addDays(first, 6) : endOfMonth(first);
    const applied = calendar.appliedRange;
    const bounded = applied !== null && DATE_ONLY.test(applied.from) && DATE_ONLY.test(applied.to);
    const from = bounded && applied.from > first ? applied.from : first;
    const to = bounded && applied.to < last ? applied.to : last;
    if (from > to) return null;
    range = `merged:${from}..${to}@${timezone}`;
  }
  const q = baseQuery.trim() === '' ? range : `${baseQuery.trim()} ${range}`;

  // 파서 왕복으로 문법을 정규화한다. 실패하면 링크를 만들지 않는다.
  let normalized: string;
  try {
    normalized = serializeQuery(parseQuery(q));
  } catch (error) {
    if (error instanceof QueryParseError) return null;
    throw error;
  }

  const params = new URLSearchParams();
  params.set('q', normalized);
  if (seqEpoch !== null && hasSeqRange(normalized)) params.set('seq_epoch', seqEpoch);
  return `/search?${params.toString()}`;
}

/**
 * 버킷 이름 — 대시보드 시간대의 날짜·시각 (CR-127). 시간 버킷은 `YYYY-MM-DD HH:mm`,
 * 일·주 버킷은 `YYYY-MM-DD`(주는 그 주의 첫날), 월 버킷은 `YYYY-MM`이다. 날짜만 온
 * 키(시험 픽스처)는 그대로 둔다.
 */
export function bucketLabelFor(interval: Interval, timezone: string): (bucketKey: string) => string {
  const zone = canonicalTimeZone(timezone) ?? DEFAULT_TIMEZONE;
  const precision = interval === 'hour' ? 'minute' : interval === 'month' ? 'month' : 'date';
  return (bucketKey) => (DATE_ONLY.test(bucketKey) ? (precision === 'month' ? bucketKey.slice(0, 7) : bucketKey) : formatInTimeZone(bucketKey, zone, precision));
}

/** 버킷 열 제목 — `Range (KST)`처럼 시간대를 적는다. */
export function bucketHeadingFor(timezone: string): string {
  return `Range (${timeZoneLabel(canonicalTimeZone(timezone) ?? DEFAULT_TIMEZONE)})`;
}

function hasSeqRange(q: string): boolean {
  try {
    return hasSequenceRangeFilter(parseQuery(q));
  } catch (error) {
    if (error instanceof QueryParseError) return false;
    throw error;
  }
}

// ---------------------------------------------------------------------------
// 백분위 응답 읽기 (spread 본문)
// ---------------------------------------------------------------------------

/**
 * 백분위 응답은 값을 최상위에 spread한다(`{ "50": 61200, "75": ... }`). low_sample이면
 * 백분위 **대신** `raw_values`를 싣는다(계약의 낱말이 "대신"이다). 그 둘을 갈라 읽는다.
 */
export interface PercentileRow {
  readonly key: string | null;
  readonly lowSample: boolean;
  readonly sampleSize: number;
  /** low_sample이 아닐 때만. 요청한 백분위별 초 단위 값. */
  readonly values: Readonly<Record<string, number>> | null;
  /** low_sample일 때만. 원값 목록. */
  readonly rawValues: readonly number[] | null;
}

export const DEFAULT_PERCENTILES = [50, 75, 90, 95, 99] as const;

export function readPercentileValues(
  source: Readonly<Record<string, unknown>>,
  percentiles: readonly number[] = DEFAULT_PERCENTILES,
): Readonly<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const p of percentiles) {
    // 서버는 `p50`처럼 **p 접두** 키로 방출한다 (API-STAT-003, aggregations.ts).
    const raw = source[`p${String(p)}`];
    if (typeof raw === 'number' && Number.isFinite(raw)) out[String(p)] = raw;
  }
  return out;
}
