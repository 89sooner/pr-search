/**
 * C-011 질의 토큰 칩 (WP-016 / FR-SRCH-005).
 *
 * ## 문자열을 자르지 않는다
 *
 * 칩 제거는 **AST를 고친 뒤 다시 직렬화한다.** 질의 문자열에서 해당 구간을
 * 잘라내는 방식은 인용부호·공백·부정 접두를 만나면 곧 틀리고, 무엇보다
 * 사용자가 친 질의와 화면이 만든 질의가 다른 문법을 쓰게 된다.
 * `@prs/query`의 왕복이 보장되므로 AST를 고치는 쪽이 항상 옳다 (ADR-001).
 */

import { isNegated, isRangeFilter, type QueryAst, type QueryFilter } from '@prs/query';

/** 칩 하나. 화면이 그리는 데 필요한 것만 담는다. */
export interface QueryChip {
  /** AST의 몇 번째 필터인가. 제거할 때 이 값으로 지목한다. */
  readonly index: number;
  readonly key: string;
  /** 사람이 읽는 값. 범위는 `1200..1350`, 다중 값은 쉼표로 잇는다. */
  readonly value: string;
  readonly negated: boolean;
  /** 스크린 리더가 읽을 제거 버튼 이름 (C-011 접근성 규칙). */
  readonly removeLabel: string;
}

function valueOf(filter: QueryFilter): string {
  if (isRangeFilter(filter)) return `${String(filter.from)}..${String(filter.to)}`;
  return filter.values.join(', ');
}

/**
 * AST를 칩 목록으로.
 *
 * **등장 순서를 지킨다.** 파서가 순서를 보존하므로(`QueryAst.filters`) 칩도
 * 사용자가 친 순서로 선다 — 정렬하면 질의를 고칠 때마다 칩이 뛴다.
 */
export function toChips(ast: QueryAst | null): readonly QueryChip[] {
  if (ast === null) return [];
  return ast.filters.map((filter, index) => {
    const value = valueOf(filter);
    const negated = isNegated(filter);
    return {
      index,
      key: filter.key,
      value,
      negated,
      // 부정 조건임을 이름에 넣는다 — `-` 기호는 스크린 리더가 읽지 않는다.
      removeLabel: `${negated ? '제외 조건 ' : ''}${filter.key}:${value} 필터 제거`,
    };
  });
}

/**
 * 칩 하나를 뺀 AST.
 *
 * 범위를 벗어난 index는 **원본을 그대로 돌려준다.** 던지지 않는 이유는 이
 * 함수가 클릭 핸들러에서 불리기 때문이다 — 응답이 늦게 와 목록이 바뀐
 * 사이에 누른 클릭 하나로 화면이 죽으면 안 된다.
 */
export function removeChip(ast: QueryAst, index: number): QueryAst {
  if (index < 0 || index >= ast.filters.length) return ast;
  return { ...ast, filters: ast.filters.filter((_, i) => i !== index) };
}

/**
 * 질의에 동등 조건 값을 더한다 — 패싯 선택이 쓰는 경로.
 *
 * **구현은 `@prs/query`에 있다** (CR-053). 집계의 `drill_down_query`가 같은
 * 판정을 필요로 하는데, 화면과 서버가 각자 구현하면 한쪽만 고쳐지는 날이 오고
 * 그때 어긋나는 것은 **버킷 수와 목록 건수**다.
 */
export { addEquality } from '@prs/query';

/** 동등 조건에서 값 하나를 뺀다. 값이 없어지면 노드째 뺀다. */
export function removeEquality(ast: QueryAst, key: string, value: string): QueryAst {
  const index = ast.filters.findIndex((f) => f.key === key && f.op === 'eq');
  if (index === -1) return ast;

  const filter = ast.filters[index] as QueryFilter & { readonly values: readonly string[] };
  const values = filter.values.filter((v) => v !== value);
  if (values.length === filter.values.length) return ast;

  if (values.length === 0) return removeChip(ast, index);
  const updated = { ...filter, values } as QueryFilter;
  return { ...ast, filters: ast.filters.map((f, i) => (i === index ? updated : f)) };
}

/** 이 값이 지금 선택되어 있는가. 레일의 체크 상태가 이것으로 결정된다. */
export function hasEquality(ast: QueryAst | null, key: string, value: string): boolean {
  if (ast === null) return false;
  return ast.filters.some(
    (f) => f.key === key && f.op === 'eq' && !isRangeFilter(f) && f.values.includes(value),
  );
}
