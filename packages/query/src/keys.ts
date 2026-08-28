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
  /**
   * 작성자의 소속 팀 (CR-053, DEV-382).
   *
   * **`team`과 다른 것을 뜻한다.** `team`은 저장소 접근 권한을 가진 팀이고
   * 이것은 PR을 연 사람이 속한 팀이다. 하나로 합치면 **접근 권한을 성과로
   * 읽게 된다** — 용어집이 "권한 판정과 집계 그룹의 단위"를 한 줄에 담았던
   * 것이 그 결함의 뿌리였다.
   */
  'author_team',
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
  /**
   * 문서 유형 (CR-053, DEV-383).
   *
   * 집계는 PR만 세는데 목록은 PR과 커밋을 함께 보이므로, 집계의
   * `drill_down_query`가 **같은 모집단을 가리킬 수단**이 필요하다.
   * `is:merged`가 우연히 PR만 남기는 것에 기대지 않는다 — 그 뜻은
   * "머지된 것"이지 "PR"이 아니고, 상태별 그룹은 머지되지 않은 PR도 센다.
   */
  'kind',
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
 * 범위 키의 올바른 예시 (DEV-364, DEV-378, DEV-379).
 *
 * **키마다 다른 예를 보여 준다.** `seq`에 날짜 예시를 주면 사용자가 두 번
 * 틀리고, 그 두 번째 오류는 우리가 만든 것이다.
 */
export const RANGE_KEY_EXAMPLE: Readonly<Record<RangeKey, string>> = {
  seq: 'seq:1200..1350',
  merged: 'merged:2026-08-10..2026-08-19',
  created: 'created:2026-08-10..2026-08-19',
};

/**
 * 값이 열거된 키 (CR-014, DEV-036).
 *
 * **SRS가 값을 열거한 키에만 값을 검증한다.** 지금은 `is` 하나뿐이다.
 * `state`는 SRS가 값을 열거하지 않았으므로 검증하지 않는다 — 없는 제약을
 * 지어내는 것이 조용히 통과시키는 것보다 낫지 않다.
 */
export const ENUMERATED_VALUES: Readonly<Partial<Record<QueryKey, readonly string[]>>> = {
  is: ['merged', 'open', 'closed', 'reverted'],
  // 값이 둘뿐이고 API 계약이 그대로 쓴다. 저장소의 관용어이기도 하다 —
  // `SearchItem.kind`·`detected_kind`가 같은 낱말과 같은 값을 쓴다.
  kind: ['pull_request', 'commit'],
};
