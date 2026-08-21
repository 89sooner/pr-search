/**
 * 질의 문자열 ↔ URL 동기화 (WP-015 / 프런트엔드 문서 4.1).
 *
 * **URL이 화면 상태의 유일한 원본이다.** 조사 결과를 동료에게 붙여넣어 보내면
 * 같은 화면이 떠야 하고, 뒤로 가기가 이전 조건으로 돌아가야 한다. 그래서
 * 필터·정렬·페이지 크기가 전부 질의 문자열에 있고 컴포넌트 상태에는 없다.
 *
 * 파싱은 `@prs/query`가 한다 (ADR-001). 여기서는 **URL과 그 파서 사이만**
 * 잇는다 — 문법을 다시 해석하지 않는다.
 */

import { parseQuery, serializeQuery, QueryParseError, type QueryAst } from '@prs/query';

/** URL 파라미터 이름. 한 곳에 모아 화면과 라우트가 같은 철자를 쓰게 한다. */
export const PARAM = {
  query: 'q',
  sort: 'sort',
  order: 'order',
  size: 'size',
  repository: 'repository',
} as const;

/** 화면이 다루는 조회 상태 전부. URL에 실리는 것과 1:1이다. */
export interface QueryState {
  readonly q: string;
  readonly sort: string | null;
  readonly order: 'asc' | 'desc' | null;
  readonly size: number | null;
  readonly repository: string | null;
}

export const EMPTY_STATE: QueryState = {
  q: '',
  sort: null,
  order: null,
  size: null,
  repository: null,
};

function readString(params: URLSearchParams, key: string): string | null {
  const raw = params.get(key);
  if (raw === null) return null;
  const trimmed = raw.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * URL 질의 문자열을 조회 상태로.
 *
 * **모르는 값을 버리지 않고 `null`로 둔다.** 서버가 정렬 키를 판정하고
 * 400을 내므로(FR-SRCH-007 AC-3) 여기서 미리 걸러 내면 사용자가 오타를
 * 고칠 기회를 잃는다 — 화면은 서버가 준 오류를 그대로 보여 준다.
 */
export function readQueryState(search: string | URLSearchParams): QueryState {
  const params = typeof search === 'string' ? new URLSearchParams(search) : search;

  const order = readString(params, PARAM.order);
  const rawSize = readString(params, PARAM.size);
  const size = rawSize === null ? null : Number(rawSize);

  return {
    q: params.get(PARAM.query) ?? '',
    sort: readString(params, PARAM.sort),
    order: order === 'asc' || order === 'desc' ? order : null,
    size: size !== null && Number.isInteger(size) && size > 0 ? size : null,
    repository: readString(params, PARAM.repository),
  };
}

/**
 * 조회 상태를 URL 질의 문자열로.
 *
 * **비어 있는 값은 키째 뺀다.** `?q=&sort=`처럼 빈 파라미터가 남으면 같은
 * 조건인데 URL이 달라져 브라우저 히스토리에 중복이 쌓이고, 붙여넣은 링크가
 * 서로 달라 보인다.
 *
 * 키 순서를 `PARAM` 선언 순으로 고정한다 — 같은 상태가 늘 같은 문자열이
 * 되어야 왕복이 성립한다.
 */
export function writeQueryState(state: QueryState): string {
  const params = new URLSearchParams();

  if (state.q.trim() !== '') params.set(PARAM.query, state.q.trim());
  if (state.sort !== null) params.set(PARAM.sort, state.sort);
  if (state.order !== null) params.set(PARAM.order, state.order);
  if (state.size !== null) params.set(PARAM.size, String(state.size));
  if (state.repository !== null) params.set(PARAM.repository, state.repository);

  return params.toString();
}

/** 경로와 상태를 합쳐 이동할 URL로. 상태가 비면 경로만 남는다. */
export function toHref(pathname: string, state: QueryState): string {
  const search = writeQueryState(state);
  return search === '' ? pathname : `${pathname}?${search}`;
}

export interface ParsedQuery {
  readonly ast: QueryAst | null;
  /** 파서가 준 오류. 화면이 오프셋으로 입력창을 강조한다 (FR-SRCH-005 AC-4). */
  readonly error: QueryParseError | null;
}

/**
 * URL의 질의를 AST로 — **클라이언트에서도 같은 파서로**.
 *
 * 서버가 판정하기 전에 화면이 먼저 문법 오류를 보여 줄 수 있게 한다
 * (ADR-001). 던지지 않고 오류를 값으로 돌려주는 이유는 렌더 중에 부를 수
 * 있어야 하기 때문이다.
 */
export function parseQueryState(state: QueryState): ParsedQuery {
  if (state.q.trim() === '') return { ast: null, error: null };
  try {
    return { ast: parseQuery(state.q), error: null };
  } catch (error) {
    if (error instanceof QueryParseError) return { ast: null, error };
    throw error;
  }
}

/**
 * AST를 질의 문자열로 되돌려 상태에 넣는다.
 *
 * 패싯 클릭이나 토큰 제거가 이 경로를 쓴다 — 화면이 문자열을 손으로 잇지
 * 않고 AST를 고친 뒤 직렬화한다. `@prs/query`의 왕복이 보장되므로
 * 사용자가 친 질의와 화면이 만든 질의가 같은 문법을 쓴다.
 */
export function withAst(state: QueryState, ast: QueryAst): QueryState {
  return { ...state, q: serializeQuery(ast) };
}
