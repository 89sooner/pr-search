/**
 * 질의 AST (API-SRCH-004의 `parsed`).
 *
 * 이 모양이 그대로 응답 본문에 실린다. 서버가 파싱한 결과를 화면이 토큰 칩으로
 * 그리고(W-001-QUERY), 칩을 지우면 다시 질의 문자열로 직렬화해 URL에 넣는다.
 * 그래서 **왕복이 같은 AST를 만들어야 한다** — 아니면 칩 하나를 지울 때마다
 * 질의가 조금씩 달라진다.
 */

import type { NumericRangeKey, QueryKey, TemporalRangeKey } from './keys.js';

/**
 * `not_range`가 있는 이유 (CR-014, DEV-035).
 *
 * FR-SRCH-005 AC-6의 `-` 접두는 문법 수준에서 `key:value` 앞에 붙는다. 범위에만
 * 붙일 수 없게 하면 토크나이저에 특례가 생기고, 사용자는 왜 그 조합만 안 되는지
 * 알 수 없다. 부정은 문법의 성질이지 특정 연산자의 성질이 아니다.
 */
export type FilterOp = 'eq' | 'not_eq' | 'range' | 'not_range';

/**
 * 동등 조건.
 *
 * **같은 (키, op)의 값은 한 노드에 모인다.** AC-5의 "같은 키가 여러 번
 * 등장하면 OR"가 이 배열이다.
 */
export interface EqualityFilter {
  readonly key: QueryKey;
  readonly op: 'eq' | 'not_eq';
  readonly values: readonly string[];
}

/** 숫자 범위. 지금은 `seq` 하나다. */
export interface NumericRangeFilter {
  readonly key: NumericRangeKey;
  readonly op: 'range' | 'not_range';
  readonly from: number;
  readonly to: number;
}

/**
 * 시각 범위.
 *
 * **입력한 문자열을 그대로 둔다.** `2026-08-10`을 자정으로 펴는 것은 시간대
 * 해석이고, 그것은 질의를 ES 질의로 옮기는 쪽(WP-013)의 몫이다. 파서가 미리
 * 펴면 사용자가 적은 것과 다른 문자열이 왕복에서 돌아온다.
 */
export interface TemporalRangeFilter {
  readonly key: TemporalRangeKey;
  readonly op: 'range' | 'not_range';
  readonly from: string;
  readonly to: string;
}

export type RangeFilter = NumericRangeFilter | TemporalRangeFilter;
export type QueryFilter = EqualityFilter | RangeFilter;

export interface QueryAst {
  /** 등장 순서를 지킨다. 정렬하면 사용자가 적은 질의가 이유 없이 재배열된다. */
  readonly filters: readonly QueryFilter[];
  /** 키 없는 남은 문자열. 없으면 `null`. */
  readonly text: string | null;
}

export function isRangeFilter(filter: QueryFilter): filter is RangeFilter {
  return filter.op === 'range' || filter.op === 'not_range';
}

export function isNegated(filter: QueryFilter): boolean {
  return filter.op === 'not_eq' || filter.op === 'not_range';
}

/** 빈 질의. 필터도 검색어도 없다. */
export const EMPTY_QUERY: QueryAst = { filters: [], text: null };
