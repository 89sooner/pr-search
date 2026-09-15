/**
 * 로그아웃 (FR-AUTH-001 AC-5 / WP-015, CR-092).
 *
 * **세션을 Redis에서 지운다.** 쿠키만 지우면 그 값을 아는 누구든 계속 쓸 수
 * 있다 — AC-5가 요구하는 것은 "다음 요청부터 401"이지 "브라우저가 잊는다"가
 * 아니다.
 *
 * `POST`만 받는다. `GET`으로 열면 다른 사이트가 `<img src>` 하나로 사용자를
 * 로그아웃시킬 수 있다.
 *
 * ## 응답은 요청한 쪽에 맞춘다 (CR-092 / DEV-700)
 *
 * 사용자 메뉴의 「로그아웃」은 **폼 제출**이다 — 브라우저가 이동하므로 JSON을 받으면 사용자는 `{"ok":true}`
 * 한 줄을 본다. 그래서 문서를 받는 요청(`Accept`에 `text/html`)은 로그아웃 완료 화면으로 **303**을 보낸다(브라우저가
 * 그 화면을 `GET`으로 연다). 그 밖의 요청(스크립트·운영 도구)은 지금까지와 같은 JSON 200이다.
 *
 * **로그인 화면으로 곧장 보내지 않는다.** 로그인은 IdP로 이어지고, IdP 세션이 살아 있으면 사용자가 아무것도
 * 누르지 않았는데 다시 로그인된다 — 로그아웃이 실패한 것처럼 보인다. 완료 화면이 멈춤을 만든다.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { serializeClearingCookie, sessionCookieName } from '@prs/authz';
import { SIGNED_OUT_PATH } from '../../../lib/auth-paths';
import { readBrowserCookieValues } from '../../../lib/proxy';
import { redirectToPath } from '../../../lib/redirect';
import { resolveWebConfig } from '../../../lib/server/config';
import { sessionStore } from '../../../lib/server/session';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest): Promise<NextResponse> {
  const config = resolveWebConfig();

  // 브라우저가 가진 이름은 `Secure` 여부로 갈린다 (CR-091) — 세울 때와 같은 함수로 읽는다.
  // 같은 이름이 둘 이상이면 전부 끝낸다 — 어느 것이 이 사용자의 세션인지 모르기 때문이다.
  for (const sessionId of readBrowserCookieValues(request.headers.get('cookie'), sessionCookieName(config.session.cookieSecure))) {
    await sessionStore().destroy(sessionId);
  }

  const wantsDocument = (request.headers.get('accept') ?? '').includes('text/html');
  const response = wantsDocument ? redirectToPath(SIGNED_OUT_PATH, 303) : NextResponse.json({ ok: true });
  // 전용 헬퍼가 `Max-Age=0`과 빈 값을 함께 낸다. 서버 쪽은 이미 지워졌다.
  response.headers.append('set-cookie', serializeClearingCookie({ secure: config.session.cookieSecure }));
  return response;
}
