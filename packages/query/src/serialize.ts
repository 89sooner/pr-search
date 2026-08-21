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
