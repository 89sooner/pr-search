/**
 * AST → 질의 문자열 (WP-011 DoD 7).
 *
 * **왕복이 같은 AST를 만들어야 한다.** 화면은 파싱된 토큰 칩을 보여 주고
 * (W-001-QUERY), 칩을 지우거나 패싯을 고르면 AST를 고쳐 다시 문자열로 만들어
 * URL에 넣는다 (`/search?q=<질의>`). 왕복이 흔들리면 칩 하나를 지울 때마다
 * 질의가 조금씩 달라진다.
 *
 * 그래서 인용 규칙이 보수적이다 — **다시 파싱했을 때 토큰이 갈라질 여지가
 * 있으면 무조건 묶는다.** 보기 좋은 문자열보다 안정된 왕복이 먼저다.
 */

import { isRangeFilter, type QueryAst, type QueryFilter } from './ast.js';

/**
 * 값을 다시 묶어야 하는가.
 *
 * 공백은 토큰을 가르고, `"`는 인용을 깨고, 앞의 `-`는 부정으로 읽히고,
 * `:`는 키 구분자로 읽힌다. 빈 문자열도 묶어야 사라지지 않는다.
 */
function needsQuotes(value: string): boolean {
  return (
    value === '' ||
    /\s/.test(value) ||
    value.includes('"') ||
    value.includes('\\') ||
    value.includes(':') ||
    value.startsWith('-')
  );
}

function quote(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function renderValue(value: string): string {
  return needsQuotes(value) ? quote(value) : value;
}

function renderFilter(filter: QueryFilter): string[] {
  const prefix = filter.op === 'not_eq' || filter.op === 'not_range' ? '-' : '';

  if (isRangeFilter(filter)) {
    return [`${prefix}${filter.key}:${String(filter.from)}..${String(filter.to)}`];
  }
  // 같은 키의 값 하나하나가 토큰이다. 다시 파싱하면 한 노드로 모인다 (AC-5).
  return filter.values.map((value) => `${prefix}${filter.key}:${renderValue(value)}`);
}

/**
 * 전문 검색어를 다시 낱말로 편다.
 *
 * AST의 `text`는 낱말을 공백 하나로 이어 붙인 것이라, 그대로 내보내면 다시
 * 같은 낱말들로 갈린다. 인용이 필요한 낱말만 묶는다.
 */
function renderText(text: string): string[] {
  return text
    .split(' ')
    .filter((term) => term !== '')
    .map((term) => (needsQuotes(term) && !term.startsWith('-') ? quote(term) : term));
}

/**
 * 질의 문자열을 만든다.
 *
 * 필터가 먼저, 전문 검색어가 뒤다. 순서를 고정해야 같은 AST가 늘 같은
 * 문자열이 되고, URL이 이유 없이 바뀌지 않는다.
 */
export function serializeQuery(ast: QueryAst): string {
  const parts = ast.filters.flatMap(renderFilter);
  if (ast.text !== null) parts.push(...renderText(ast.text));
  return parts.join(' ');
}

/**
 * 질의에 동등 조건 값을 더한다 — 패싯 선택과 집계의 `drill_down_query`가 쓴다.
 *
 * **같은 키가 이미 있으면 그 노드에 값을 넣는다.** 파서가 같은 (키, op)를 한
 * 노드로 모으므로(FR-SRCH-005 AC-5의 OR) 새 노드를 만들면 직렬화 후 다시
 * 파싱했을 때 모양이 달라져 **왕복이 깨진다.**
 *
 * 화면(`apps/web/lib/tokens.ts`)에 있던 것을 여기로 올렸다 (CR-053) — 집계가
 * 근거 목록으로 가는 질의를 만들 때 같은 판정이 필요한데, **각자 구현하면
 * 한쪽만 고쳐지는 날이 온다.** 그때 어긋나는 것은 버킷 수와 목록 건수다.
 */
/**
 * 그 키의 동등 조건을 **값 하나로 대체한다** (CR-053, PR #76 리뷰 P2).
 *
 * `addEquality`와 다른 것을 한다. 패싯 선택은 조건을 **넓히지만**, 집계 버킷을
 * 누르는 것은 **그 버킷으로 좁히는** 일이다. 더하기만 하면 `author:alice author:bob`
 * 질의에서 alice를 눌러도 OR가 남아 **두 사람의 결과가 그대로 돌아온다** —
 * 버킷이 말한 수와 목록이 보여 주는 수가 어긋난다.
 */
export function replaceEquality(ast: QueryAst, key: string, value: string): QueryAst {
  const kept = ast.filters.filter((one) => !(one.key === key && one.op === 'eq'));
  return { ...ast, filters: [...kept, { key, op: 'eq', values: [value] } as QueryFilter] };
}

/**
 * 수치 범위 조건을 갈아 끼운다 (CR-056, DEV-451).
 *
 * 분포 드릴다운이 구간마다 다른 범위를 걸어야 하는데, 기준 질의에 같은 키의
 * 범위가 이미 있으면 둘이 AND로 겹쳐 **두 조건을 모두 만족하는 문서만** 남고
 * 그 수는 분포가 보여 준 수와 다르다. 사용자가 고른 것은 이 구간이므로
 * 갈아 끼운다 — `replaceEquality`가 `kind`에 하는 것과 같다.
 */
export function replaceNumericRange(ast: QueryAst, key: string, from: number, to: number): QueryAst {
  const kept = ast.filters.filter((one) => !(one.key === key && one.op === 'range'));
  return { ...ast, filters: [...kept, { key, op: 'range', from, to } as QueryFilter] };
}

export function addEquality(ast: QueryAst, key: string, value: string): QueryAst {
  const existing = ast.filters.findIndex((one) => one.key === key && one.op === 'eq');

  if (existing === -1) {
    return {
      ...ast,
      filters: [...ast.filters, { key, op: 'eq', values: [value] } as QueryFilter],
    };
  }

  const filter = ast.filters[existing] as QueryFilter & { readonly values: readonly string[] };
  // 이미 있는 값을 또 넣지 않는다 — `author:kim author:kim`은 같은 결과에 문자열만 길어진다.
  if (filter.values.includes(value)) return ast;

  const updated = { ...filter, values: [...filter.values, value] } as QueryFilter;
  return { ...ast, filters: ast.filters.map((one, i) => (i === existing ? updated : one)) };
}
