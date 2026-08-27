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

const TIEBREAK: estypes.SortCombinations = {
  [TIEBREAK_FIELD]: { order: 'asc', missing: '_last', unmapped_type: 'keyword' },
};

function fieldSort(
  field: string,
  type: 'long' | 'date' | 'integer',
  order: SortOrder,
): estypes.SortCombinations {
  return {
    [field]: {
      order,
      // 정렬 대상 필드가 없는 문서는 마지막에 (FR-SRCH-007 예외 처리).
      missing: '_last',
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
