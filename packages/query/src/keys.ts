/**
 * 지원 질의 키 (FR-SRCH-005 AC-1).
 *
 * 목록은 SRS가 정한 15종 그대로다. 여기서 늘리면 API 계약의
 * `supported_keys`와 어긋나므로, 키를 더하려면 SRS부터 고친다.
 */

export const QUERY_KEYS = [
  'repo',
  'org',
  'author',
  'team',
  'reviewer',
  'label',
  'base',
  'head',
  'state',
  'merged',
  'created',
  'seq',
  'release',
  'path',
  'is',
] as const;

export type QueryKey = (typeof QUERY_KEYS)[number];

const KEY_SET = new Set<string>(QUERY_KEYS);

export function isQueryKey(value: string): value is QueryKey {
  return KEY_SET.has(value);
}

/**
 * 범위 문법 `a..b`를 받는 키 (CR-014, DEV-037).
 *
 * 셋뿐이다. 그 밖의 키에서 `..`는 리터럴이다 — `path:src/a..b`는 범위가
 * 아니라 그 문자열을 찾는 조건이다.
 */
export const NUMERIC_RANGE_KEYS = ['seq'] as const;
export const TEMPORAL_RANGE_KEYS = ['merged', 'created'] as const;

export type NumericRangeKey = (typeof NUMERIC_RANGE_KEYS)[number];
export type TemporalRangeKey = (typeof TEMPORAL_RANGE_KEYS)[number];
export type RangeKey = NumericRangeKey | TemporalRangeKey;

const NUMERIC_SET = new Set<string>(NUMERIC_RANGE_KEYS);
const TEMPORAL_SET = new Set<string>(TEMPORAL_RANGE_KEYS);

export function isNumericRangeKey(key: string): key is NumericRangeKey {
  return NUMERIC_SET.has(key);
}

export function isTemporalRangeKey(key: string): key is TemporalRangeKey {
  return TEMPORAL_SET.has(key);
}

export function isRangeKey(key: string): key is RangeKey {
  return isNumericRangeKey(key) || isTemporalRangeKey(key);
}

/**
 * 값이 열거된 키 (CR-014, DEV-036).
 *
 * **SRS가 값을 열거한 키에만 값을 검증한다.** 지금은 `is` 하나뿐이다.
 * `state`는 SRS가 값을 열거하지 않았으므로 검증하지 않는다 — 없는 제약을
 * 지어내는 것이 조용히 통과시키는 것보다 낫지 않다.
 */
export const ENUMERATED_VALUES: Readonly<Partial<Record<QueryKey, readonly string[]>>> = {
  is: ['merged', 'open', 'closed', 'reverted'],
};
