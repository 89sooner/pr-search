/**
 * 지원 질의 키 (FR-SRCH-005 AC-1).
 *
 * 목록은 SRS가 정한 그대로다. 여기서 늘리면 API 계약의 `supported_keys`와
 * 어긋나므로, 키를 더하려면 SRS부터 고친다. **개수를 여기 적지 않는다** —
 * 키가 하나 늘 때마다 그 수가 낡고 누가 낡게 했는지 아무도 모른다 (CR-054).
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
  /**
   * 변경 규모 (CR-056, DEV-451).
   *
   * 분포의 구간을 선택하면 그 구간의 문서로 가야 하는데(`FR-STAT-005` AC-4)
   * 그 조건을 표현할 문법이 없었다 — 모든 구간이 기준 질의를 그대로 받아
   * **실행하면 전체가 나왔다.** 두 키가 그 재료다.
   *
   * `seq`와 달리 시퀀스 공간을 지목할 필요가 없다. 변경 규모는 저장소를
   * 건너 비교해도 뜻이 유지되는 값이다.
   */
  'changed_files',
  'changed_lines',
  /**
   * 식별자 범위 (CR-106, FR-SRCH-005 AC-8·AC-9).
   *
   * `pr_number`는 `repo:` 하나만 요구한다 — PR 번호는 저장소 안에서 생성
   * 시점에 매겨지므로 대상 브랜치나 시퀀스 에폭과 무관하다.
   *
   * `mnum`은 `seq`와 같은 시퀀스 공간 지목 규칙을 따른다(`repo:`·`base:`
   * 하나씩). M 번호는 `merge_seq`에서 파생된 별도의 조밀 서수라 `seq`와
   * 서로 대체할 수 없다 — 공간은 같아도 값은 다르다. 두 키의 지목 규칙은
   * `sequence-binding.ts`에 있다.
   */
  'pr_number',
  'mnum',
] as const;

export type QueryKey = (typeof QUERY_KEYS)[number];

const KEY_SET = new Set<string>(QUERY_KEYS);

export function isQueryKey(value: string): value is QueryKey {
  return KEY_SET.has(value);
}

/**
 * 범위 문법 `a..b`를 받는 키 (CR-014, DEV-037 / CR-056, DEV-451).
 *
 * 여기 없는 키에서 `..`는 리터럴이다 — `path:src/a..b`는 범위가 아니라 그
 * 문자열을 찾는 조건이다.
 */
export const NUMERIC_RANGE_KEYS = ['seq', 'changed_files', 'changed_lines', 'pr_number', 'mnum'] as const;
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
 * 수치 범위 키의 하한(포함) (CR-106).
 *
 * **여기 없는 키는 하한이 없다** — `changed_files`·`changed_lines`는 0을 사실의
 * 진술로 쓰고(CR-056, "0은 하나도 바꾸지 않음"), `seq`는 이 CR이 손대지 않은
 * 기존 키다. `pr_number`·`mnum`은 1부터 시작하는 값이라(GitHub의 PR 번호,
 * `FR-SEQ-008`의 1-기반 조밀 서수) 그 아래는 범위 형태는 맞아도 값 자체가
 * 성립하지 않는다 — "최솟값 위반"을 형태 검사와 별개로 거절한다.
 */
export const MIN_RANGE_VALUE: Readonly<Partial<Record<NumericRangeKey, number>>> = {
  pr_number: 1,
  mnum: 1,
};

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
  changed_files: 'changed_files:2..5',
  changed_lines: 'changed_lines:51..200',
  pr_number: 'repo:acme/payments pr_number:100..200',
  mnum: 'repo:acme/payments base:main mnum:1..50',
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
