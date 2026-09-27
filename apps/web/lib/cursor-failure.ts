/**
 * 커서 실패의 갈래와 안내 문구 (C-016 CursorPager, CR-043 · CR-125).
 *
 * `CURSOR_QUERY_MISMATCH`와 `CURSOR_INVALID`는 **다른 사실**을 말한다 — 하나는 "조건이 바뀌었다"이고
 * 다른 하나는 "이 커서를 쓸 수 없다"이다 (DEV-273). 셋째 갈래 `CURSOR_OUTDATED`는 **서버 코드가
 * 아니다** — 서버는 옛 판 커서도 `CURSOR_INVALID`로 답하고 그 사실을 `detail.reason`에 싣는다(계약의
 * 커서 오류 표는 그대로다). 화면은 그 사유를 따로 안내한다: 서비스가 바뀌어 저장해 둔 위치를 더 쓸 수
 * 없다는 것이지 사용자가 무엇을 잘못한 것이 아니다 (DEV-777 — 밀리초로 잘린 판 1 커서).
 *
 * 컴포넌트가 아니라 여기 두는 이유: 판정은 순수 함수라 단위 시험이 닿아야 한다.
 */

export type CursorFailure = 'CURSOR_QUERY_MISMATCH' | 'CURSOR_INVALID' | 'CURSOR_OUTDATED';

export const CURSOR_FAILURE_TEXT: Readonly<Record<CursorFailure, { readonly title: string; readonly impact: string }>> = {
  CURSOR_QUERY_MISMATCH: {
    title: "Filters changed; pagination cannot continue",
    impact: "Search filters or permissions have changed. Start again from the first page.",
  },
  CURSOR_INVALID: {
    title: "Pagination is unavailable",
    impact: "Pagination information has expired or is invalid. Start again from the first page.",
  },
  CURSOR_OUTDATED: {
    title: "This page position is from an earlier version",
    impact: "The service was updated and the saved page position can no longer be used. Start again from the first page.",
  },
};

/** 서버가 옛 판 커서의 `CURSOR_INVALID`에 싣는 사유. */
const OUTDATED_REASON = 'cursor_version_outdated';

/**
 * 응답 오류가 커서 실패인가. 화면 여럿이 같은 판정을 쓴다.
 *
 * `detail`은 선택이다 — 넘기지 않는 화면은 옛 판 사유를 `CURSOR_INVALID`로 보인다(첫 페이지로 돌아가는
 * 처리는 같다).
 */
export function toCursorFailure(code: string | undefined, detail?: unknown): CursorFailure | null {
  if (
    code === 'CURSOR_INVALID' &&
    typeof detail === 'object' &&
    detail !== null &&
    (detail as Record<string, unknown>)['reason'] === OUTDATED_REASON
  ) {
    return 'CURSOR_OUTDATED';
  }
  if (code === 'CURSOR_QUERY_MISMATCH' || code === 'CURSOR_INVALID') return code;
  return null;
}

/** 오류 응답 본문에서 커서 실패를 읽는다. 본문 모양이 다르면 `null`이다. */
export function readCursorFailureBody(body: unknown): CursorFailure | null {
  if (typeof body !== 'object' || body === null) return null;
  const error = (body as Record<string, unknown>)['error'];
  if (typeof error !== 'object' || error === null) return null;
  const record = error as Record<string, unknown>;
  const code = record['code'];
  return toCursorFailure(typeof code === 'string' ? code : undefined, record['detail']);
}
