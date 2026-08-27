/**
 * 정렬 (FR-SRCH-007, CR-016 DEV-054·DEV-056).
 *
 * 지켜야 할 것 셋:
 *
 * 1. **모든 정렬은 결정론적이다** (AC-4). 문서 ID를 마지막 키로 둔다 — 동점이
 *    있어도 같은 조건을 두 번 조회하면 같은 순서가 나온다. 이것이 없으면
 *    커서 페이지네이션(WP-032)이 항목을 건너뛰거나 두 번 보여 준다.
 * 2. **기본 정렬은 두 단이다** (AC-2). `merge_seq` 내림차순이되, 시퀀스가 없는
 *    문서는 `merged_at` 내림차순으로 **뒤에** 놓는다. `missing: _last`가
 *    "뒤에"를 만들고, 두 번째 키가 그 안에서의 순서를 만든다.
 * 3. **모든 키에 `unmapped_type`을 붙인다** (CR-016, DEV-054). PR과 커밋을 함께
 *    도는데 `merged_at`·`title` 같은 필드는 PR에만 있다. 없는 필드로 정렬하면
 *    Elasticsearch가 **HTTP 200에 샤드 부분 실패를 붙여** 준다 — 한 인덱스가
 *    통째로 빠진 결과가 정상처럼 돌아온다. 실측으로 확인했다.
 */

import type { estypes } from '@elastic/elasticsearch';

/** FR-SRCH-007 AC-1의 정렬 키 여덟. 이 목록이 곧 400 응답의 지원 키 목록이다. */
export const SORT_KEYS = [
  'merge_seq',
  'merged_at',
  'created_at',
  'updated_at',
  'changed_files_count',
  'additions',
  'lead_time_seconds',
  'relevance',
] as const;

export type SortKey = (typeof SORT_KEYS)[number];
export type SortOrder = 'asc' | 'desc';

const SORT_KEY_SET = new Set<string>(SORT_KEYS);

export function isSortKey(value: string): value is SortKey {
  return SORT_KEY_SET.has(value);
}

export const DEFAULT_SORT_KEY: SortKey = 'merge_seq';
export const DEFAULT_SORT_ORDER: SortOrder = 'desc';

/**
 * 키가 보는 필드와 그 타입.
 *
 * `unmapped_type`은 **그 필드가 없는 인덱스에서 이 정렬을 어떻게 다룰지**를
 * 정한다. 값이 없는 것으로 치고 `missing` 규칙을 따른다.
 */
const SORT_FIELDS: Readonly<Record<Exclude<SortKey, 'relevance'>, { field: string; type: 'long' | 'date' | 'integer' }>> =
  {
    merge_seq: { field: 'merge_seq', type: 'long' },
    merged_at: { field: 'merged_at', type: 'date' },
    created_at: { field: 'created_at', type: 'date' },
    updated_at: { field: 'updated_at', type: 'date' },
    changed_files_count: { field: 'changed_files_count', type: 'integer' },
    additions: { field: 'additions', type: 'integer' },
    lead_time_seconds: { field: 'lead_time_seconds', type: 'long' },
  };

/**
 * 동점을 가르는 마지막 키 (AC-4, CR-016 DEV-059).
 *
 * **`_id`가 아니라 `doc_id`다.** Elasticsearch 8은 `_id` 정렬을 금지한다 —
 * fielddata를 켜야 하는데 그것은 클러스터 전역 설정이고 모든 ID를 메모리에
 * 올린다. 그래서 `upsert`가 `_id`와 같은 값을 `doc_id` 필드에 함께 넣고,
 * 정렬은 그 필드를 본다.
 *
 * `_doc`도 쓰지 않는다. 세그먼트 내부 순서라 머지나 재색인이 일어나면 값이
 * 달라져 "두 번 조회하면 같은 순서"가 성립하지 않는다.
 */
export const TIEBREAK_FIELD = 'doc_id' as const;

/*
 * 동률 키는 `_last`를 그대로 쓴다 (DEV-329의 예외).
 *
 * 숫자·날짜 축과 달리 keyword의 누락 값은 응답에 `null`로 나오고, 실제
 * Elasticsearch 8이 `search_after`에서 그 `null`을 받는다 — 되먹임이 성립하므로
 * 명시적 센티널이 필요 없다. 그리고 `upsert`가 모든 문서에 `doc_id`를 채우므로
 * (CR-016, DEV-059) 운영에서는 이 갈래에 닿지도 않는다.
 */
const TIEBREAK: estypes.SortCombinations = {
  [TIEBREAK_FIELD]: { order: 'asc', missing: '_last', unmapped_type: 'keyword' },
};

/**
 * 누락 문서를 뒤로 보내는 값 (WP-032 / DEV-329).
 *
 * ## 왜 `missing: '_last'`가 아닌가
 *
 * `_last`는 Elasticsearch가 내부적으로 `Long.MIN_VALUE`/`MAX_VALUE`를 정렬 값으로
 * 쓰게 만든다. 조회만 할 때는 아무 문제가 없다 — 그 값은 응답의 `sort` 배열에만
 * 나타나고 아무도 보지 않는다.
 *
 * **커서가 그 값을 되먹이는 순간 깨진다.** 실제 Elasticsearch 8로 셋 다 확인했다.
 *
 * | 시도 | 결과 |
 * | --- | --- |
 * | 날짜 축, `format` 없음 | `parse_exception: failed to parse date field [-9223372036854776000]` |
 * | 날짜 축, `format: strict_date_optional_time` | 센티널이 `-292275055-05-16T…`로 나오고 **그것을 자기가 못 읽는다** |
 * | 날짜 축, `format: epoch_millis` | `date_time_exception: … cannot be negative according to the SignStyle` |
 *
 * 게다가 그 값은 `Number.MAX_SAFE_INTEGER`를 넘어 **JSON 왕복에서 정밀도를
 * 잃는다**(`-9223372036854775808` → `-9223372036854776000`). 숫자 축은 우연히
 * 동작하지만 그것은 Elasticsearch가 범위를 잘라 준 결과이지 우리가 보낸 값이
 * 맞아서가 아니다.
 *
 * 그래서 **표현 가능하고 충돌할 수 없는 값**을 명시한다. 방향마다 다른 것은
 * `_last`가 방향과 무관하게 뒤로 보내기 때문이다 — 그 뜻을 값으로 옮기면
 * 내림차순에서는 가장 작은 값, 오름차순에서는 가장 큰 값이 된다.
 *
 * 충돌 가능성: 날짜 축은 서기 1년/9999년, 숫자 축은 음수/`MAX_SAFE_INTEGER`다.
 * PR의 머지 시각이나 변경 파일 수가 그 값이 되는 일은 없고, 설령 된다 해도
 * 결과는 **동률**이며 `doc_id`가 그것을 가른다 — 중복도 누락도 생기지 않는다.
 */
const MISSING_SENTINEL: Readonly<Record<'long' | 'date' | 'integer', Readonly<Record<SortOrder, number>>>> = {
  // 0001-01-01T00:00:00Z / 9999-12-31T23:59:59Z — `strict_date_optional_time`이 읽을 수 있는 양 끝.
  date: { desc: -62_135_596_800_000, asc: 253_402_300_799_000 },
  // 서수·리드타임은 음수가 되지 않는다. 위쪽은 JSON이 정확히 나르는 상한이다.
  long: { desc: -1, asc: Number.MAX_SAFE_INTEGER },
  // `integer` 매핑의 상한은 2^31-1이다. `MAX_SAFE_INTEGER`를 넣으면 범위 밖이다.
  integer: { desc: -1, asc: 2_147_483_647 },
};

function fieldSort(
  field: string,
  type: 'long' | 'date' | 'integer',
  order: SortOrder,
): estypes.SortCombinations {
  return {
    [field]: {
      order,
      // 정렬 대상 필드가 없는 문서는 마지막에 (FR-SRCH-007 예외 처리, DEV-329).
      missing: MISSING_SENTINEL[type][order],
      // 그 필드가 아예 없는 **인덱스**를 위한 것 (CR-016, DEV-054).
      unmapped_type: type,
    },
  };
}

/**
 * 정렬 절을 만든다.
 *
 * @param key 검증된 정렬 키. 검증은 호출 측이 `isSortKey`로 한다 — 여기서
 * 던지면 400 응답에 지원 키 목록을 실을 자리가 없다.
 */
export function buildSort(key: SortKey, order: SortOrder): estypes.SortCombinations[] {
  if (key === 'relevance') {
    /*
     * **요청한 방향을 그대로 쓴다** (WP-032, CR-043 DEV-275).
     *
     * 여기는 오래 `order`를 무시하고 `desc`로 고정돼 있었다. WP-013에는 점수를
     * 내는 절이 없어 모든 문서의 점수가 같았고, 그래서 방향이 아무 차이도
     * 만들지 않았기 때문이다 (CR-016, DEV-056). 이제 자유 텍스트가 점수를
     * 내므로 방향이 실제 순서를 바꾼다.
     *
     * `asc`를 "쓸모없으니 막는다"고 판단하지 않는다 — FR-SRCH-007 AC-1이 키와
     * 방향을 함께 승인했고, 지원하지 않기로 정하는 것은 SRS 변경이다.
     */
    return [{ _score: { order } }, TIEBREAK];
  }

  const spec = SORT_FIELDS[key];
  const primary = fieldSort(spec.field, spec.type, order);

  if (key !== DEFAULT_SORT_KEY) return [primary, TIEBREAK];

  /*
   * 기본 정렬만 두 단이다 (AC-2).
   *
   * "시퀀스가 없는 문서는 `merged_at` 내림차순으로 뒤에"를 그대로 옮긴 것이다.
   * `missing: _last`가 시퀀스 없는 문서를 뒤로 보내고, 두 번째 키가 그
   * 뒤엉킨 무리 안에서 순서를 만든다. 두 번째 키가 없으면 그 무리가
   * 문서 ID 순으로 서는데, 그것은 "최근 머지가 먼저"가 아니다.
   */
  return [primary, fieldSort('merged_at', 'date', 'desc'), TIEBREAK];
}

/**
 * 샤드 부분 실패를 검사한다 (CR-016, DEV-054).
 *
 * Elasticsearch는 일부 샤드가 실패해도 **HTTP 200과 나머지 결과**를 준다.
 * 그대로 내보내면 한 인덱스가 통째로 빠진 결과가 정상처럼 보인다 — 사용자는
 * "커밋이 안 나오네"를 데이터가 없는 것으로 오해한다.
 *
 * @throws {PartialSearchError} 실패한 샤드가 하나라도 있으면.
 */
export function assertNoShardFailures(response: {
  readonly _shards: { readonly failed: number; readonly total: number };
}): void {
  if (response._shards.failed > 0) {
    throw new PartialSearchError(response._shards.failed, response._shards.total);
  }
}

export class PartialSearchError extends Error {
  readonly failedShards: number;
  readonly totalShards: number;

  constructor(failed: number, total: number) {
    super(`검색 샤드 ${String(failed)}/${String(total)}가 실패해 부분 결과가 되었다`);
    this.name = 'PartialSearchError';
    this.failedShards = failed;
    this.totalShards = total;
  }
}
