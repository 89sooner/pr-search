/**
 * 세션을 끝내는 경로 (CR-092 / DEV-700).
 *
 * 라우트 파일은 Next.js가 정한 이름만 내보낼 수 있으므로 여기에 둔다. 사용자 메뉴·로그아웃 라우트·완료 화면이
 * 같은 값을 읽어야 한다 — 한쪽만 바뀌면 로그아웃이 404로 끝난다.
 */

/** 로그아웃 라우트. `POST`만 받는다. */
export const LOGOUT_PATH = '/auth/logout';

/** 로그아웃을 마친 문서 요청이 가는 곳. 세션을 요구하지 않는 공개 화면이다. */
export const SIGNED_OUT_PATH = '/auth/signed-out';
