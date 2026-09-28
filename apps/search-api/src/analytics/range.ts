/**
 * 시계열 기간 해석 (API-STAT-002, FR-STAT-002 AC-7, CR-127).
 *
 * **버킷과 모집단이 같은 시간대를 쓴다.** 버킷은 요청 시간대로 나누는데(AC-2) 기간을
 * UTC 날짜로 거르면, 한국 날짜 9/26 새벽의 PR이 9/26 버킷에서 빠지고 요청하지 않은
 * 9/29 버킷이 생긴다(DEV-781). 날짜만 적은 기간은 그래서 **요청 시간대의 달력 날짜**이며,
 * 모집단은 검색과 같은 문법 `merged:<from>..<to>@<시간대>`로 더한다 — 버킷 하나를 누른
 * 검색이 같은 문법을 쓰므로 두 수가 같다.
 *
 * 시각을 적은 기간(API를 직접 부른 쪽)은 기존 뜻 그대로다. 옛 호출을 다시 해석하지 않는다.
 */

import { addDays, canonicalTimeZone, isCalendarDate, startOfZonedDay, todayIn } from '@prs/query';
import { DEFAULT_RANGE_DAYS, DEFAULT_TIMEZONE } from './types.js';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
/** 오프셋 없는 날짜와 시각. */
const DATE_TIME_WITHOUT_OFFSET = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/;

export interface TimeSeriesRange {
  /** `calendar`는 날짜만 적은 기간(또는 기본값), `instant`는 시각을 적은 옛 기간이다. */
  readonly kind: 'calendar' | 'instant';
  /** 정규 표기의 시간대. 버킷 경계와 달력 기간이 같이 쓴다. */
  readonly timezone: string;
  /** 응답의 `applied_range`. 달력 기간이면 날짜, 옛 기간이면 받은 값이다. */
  readonly appliedFrom: string;
  readonly appliedTo: string;
  /** 모집단에 더하는 질의 조건. */
  readonly rangeFilter: string;
  /**
   * `extended_bounds`. **필터가 아니라 채울 버킷을 고르는 값이다** — 경계 값을 담은
   * 버킷까지 채운다. 달력 기간의 끝은 그 기간의 마지막 순간(다음 날 첫 순간의 1ms 앞)
   * 이라, 시간 버킷이면 마지막 날 23시 버킷까지, 일·주·월 버킷이면 마지막 날이 속한
   * 버킷까지 채운다.
   */
  readonly boundsMin: string;
  readonly boundsMax: string;
  /** 버킷 수 어림에 쓰는 길이(밀리초). */
  readonly spanMs: number;
}

export interface TimeSeriesRangeFailure {
  readonly field: 'from' | 'to' | 'timezone';
  readonly message: string;
}

/** 문자열이 아니면 없는 것으로 본다 — 기존 동작(`typeof === 'string'`)을 지킨다. */
function optionalString(raw: unknown): string | undefined {
  return typeof raw === 'string' ? raw : undefined;
}

/**
 * 시각형 기간의 끝을 UTC 순간 표기로 (CR-127). **오프셋 없는 시각은 UTC다** — 모집단의 범위
 * 질의가 그렇게 거른다. `Date.parse`에 그대로 넘기면 서버 프로세스의 기본 시간대로 읽히고,
 * `extended_bounds`에 그대로 넘기면 Elasticsearch가 집계의 `time_zone`으로 읽어 버킷을 채우는
 * 구간이 모집단과 어긋난다(격리 Elasticsearch 8.19 실측, 원장 6.118장). 오프셋이 있으면 받은 그대로다.
 */
function utcInstant(value: string): string {
  return DATE_TIME_WITHOUT_OFFSET.test(value) ? `${value.replace(' ', 'T')}Z` : value;
}

export function resolveTimeSeriesRange(
  input: { readonly from: unknown; readonly to: unknown; readonly timezone: unknown },
  nowMs: number,
): TimeSeriesRange | TimeSeriesRangeFailure {
  const rawZone = input.timezone === undefined || input.timezone === null ? DEFAULT_TIMEZONE : input.timezone;
  const timezone = typeof rawZone === 'string' ? canonicalTimeZone(rawZone) : null;
  if (timezone === null) {
    return { field: 'timezone', message: `알 수 없는 시간대입니다: '${String(rawZone)}' (예: Asia/Seoul)` };
  }

  const from = optionalString(input.from);
  const to = optionalString(input.to);
  const calendar = (from === undefined || DATE_ONLY.test(from)) && (to === undefined || DATE_ONLY.test(to));

  if (!calendar) {
    // 시각을 적은 기간 — 기존 뜻 그대로(양끝 순간 포함, 기본값은 지금부터 30일 전까지). 응답의
    // 적용 기간과 모집단 조건은 받은 값이고, 판정·버킷 수 어림·버킷 경계는 UTC로 읽은 순간이다.
    const appliedTo = to ?? new Date(nowMs).toISOString();
    const appliedFrom = from ?? new Date(nowMs - DEFAULT_RANGE_DAYS * 86_400_000).toISOString();
    const fromInstant = utcInstant(appliedFrom);
    const toInstant = utcInstant(appliedTo);
    if (Number.isNaN(Date.parse(fromInstant)) || Number.isNaN(Date.parse(toInstant))) {
      return { field: 'from', message: '기간은 ISO 8601 시각이어야 합니다.' };
    }
    if (Date.parse(fromInstant) > Date.parse(toInstant)) {
      return { field: 'from', message: '기간이 뒤집혔습니다.' };
    }
    return {
      kind: 'instant',
      timezone,
      appliedFrom,
      appliedTo,
      rangeFilter: `merged:${appliedFrom}..${appliedTo}`,
      boundsMin: fromInstant,
      boundsMax: toInstant,
      spanMs: Date.parse(toInstant) - Date.parse(fromInstant),
    };
  }

  if (from !== undefined && !isCalendarDate(from)) return { field: 'from', message: `없는 날짜입니다: '${from}'` };
  if (to !== undefined && !isCalendarDate(to)) return { field: 'to', message: `없는 날짜입니다: '${to}'` };
  // 한쪽만 주면 다른 쪽은 기본값이다. 오늘도 요청 시간대의 날짜다 — 서버의 날짜가 아니다.
  const appliedTo = to ?? todayIn(timezone, nowMs);
  const appliedFrom = from ?? addDays(appliedTo, -(DEFAULT_RANGE_DAYS - 1));
  if (appliedFrom > appliedTo) return { field: 'from', message: '기간이 뒤집혔습니다.' };

  const start = startOfZonedDay(appliedFrom, timezone);
  const end = startOfZonedDay(addDays(appliedTo, 1), timezone);
  return {
    kind: 'calendar',
    timezone,
    appliedFrom,
    appliedTo,
    rangeFilter: `merged:${appliedFrom}..${appliedTo}@${timezone}`,
    boundsMin: new Date(start).toISOString(),
    boundsMax: new Date(end - 1).toISOString(),
    spanMs: end - start,
  };
}

export function isRangeFailure(value: TimeSeriesRange | TimeSeriesRangeFailure): value is TimeSeriesRangeFailure {
  return 'field' in value;
}
