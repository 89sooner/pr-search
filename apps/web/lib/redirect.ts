/**
 * 같은 출처의 경로로 보내는 리다이렉트 (CR-092 / DEV-699).
 *
 * ## 왜 절대 URL을 만들지 않는가
 *
 * 콜백 둘은 `NextResponse.redirect(new URL(path, request.nextUrl.origin))`로 보냈다. `next start`는 요청의 출처를
 * **자기가 들은 호스트·포트**로 조립하므로 역방향 프록시 뒤에서 그 값은 `localhost:3000`이다 — `Host`를 그대로
 * 넘겨도 바뀌지 않는다(`X-Forwarded-Proto`만 반영된다). 사내 `0.1.0-pilot.7` 이미지에 `Host: prs.corp.example`로
 * 걸어 `location: https://localhost:3000/gh?identity=failed`를 실측했고, 로그인 콜백이 같은 방법이라 사용자는
 * GHE 로그인 뒤 `localhost:3000`으로 떨어졌다.
 *
 * 고치는 길은 셋이었다. **외부 주소를 환경 변수로 받으면** 운영자가 맞출 값이 하나 늘고 틀리면 같은 증상이
 * 되돌아온다. **`Host`·`X-Forwarded-Host`를 믿으면** 그 헤더를 고른 누구든 리다이렉트 목적지를 고른다(열린
 * 리다이렉트). **상대 경로를 `Location`에 두면** 브라우저가 자기가 연 주소를 기준으로 푼다(RFC 9110 10.2.2) —
 * 서버는 자기 이름을 알 필요가 없다. 셋째를 택했다.
 *
 * ## 경로만 받는다
 *
 * `sanitizeReturnPath`와 같은 규칙으로 거르고, 걸리면 **던진다.** 호출부가 이미 걸렀어야 하는 값이므로 여기서
 * 조용히 `/`로 바꾸면 호출부의 결함이 가려진다.
 */

import { NextResponse } from 'next/server';
import { sanitizeReturnPath } from '@prs/authz';

/**
 * @param path 같은 출처의 절대 경로(`/`로 시작, `//`·`/\` 아님, 제어 문자 없음).
 * @param status `GET` 콜백은 307, 폼 `POST`의 결과 화면으로 보낼 때는 303(브라우저가 `GET`으로 바꾼다).
 */
export function redirectToPath(path: string, status: 303 | 307 = 307): NextResponse {
  // 빈 값은 `sanitizeReturnPath`가 대체값(여기서는 빈 값)을 돌려주므로 비교만으로는 걸리지 않는다.
  if (path === '' || sanitizeReturnPath(path, '') !== path) {
    throw new Error(`Not a same-origin absolute path: ${JSON.stringify(path)}`);
  }
  return new NextResponse(null, { status, headers: { location: path } });
}
