/**
 * 커서·패싯 요청 파라미터 읽기 (WP-032).
 *
 * 두 화면(W-001·W-004)이 순회 의미는 나누지만 **파라미터 이름과 그 해석은
 * 같아야 한다.** 한쪽만 `?cursor=`를 빈 문자열로 다르게 읽으면 같은 URL이
 * 화면에 따라 다르게 동작한다.
 */

/**
 * 이어 보기 커서.
 *
 * **빈 문자열은 없는 것으로 읽는다.** `?cursor=`로 온 요청을 훼손된 커서로
 * 판정하면 첫 페이지를 요청한 사용자가 오류를 본다 — 폼이 빈 값을 그대로
 * 붙이는 것은 흔한 일이다.
 */
export function readCursor(query: Record<string, unknown>): string | null {
  const raw = query['cursor'];
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * 패싯을 셀 것인가.
 *
 * **기본은 세지 않는다.** 세 키가 통째로 빠진 응답이 "요청하지 않았다"이며
 * (CR-019, DEV-076), 두 번째 페이지부터는 화면이 `facets=false`로 부른다
 * (QA-W001-27). `'true'` 정확히 하나만 참으로 읽는다 — `1`·`yes`를 함께 받으면
 * 화면과 서버가 다른 규칙을 갖게 된다.
 */
export function readFacets(query: Record<string, unknown>): boolean {
  return query['facets'] === 'true';
}
