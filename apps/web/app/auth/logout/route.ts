/**
 * 로그아웃 (FR-AUTH-001 AC-5 / WP-015).
 *
 * **세션을 Redis에서 지운다.** 쿠키만 지우면 그 값을 아는 누구든 계속 쓸 수
 * 있다 — AC-5가 요구하는 것은 "다음 요청부터 401"이지 "브라우저가 잊는다"가
 * 아니다.
 *
 * `POST`만 받는다. `GET`으로 열면 다른 사이트가 `<img src>` 하나로 사용자를
 * 로그아웃시킬 수 있다.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { serializeClearingCookie, sessionCookieName } from '@prs/authz';
import { resolveWebConfig } from '../../../lib/server/config';
import { sessionStore } from '../../../lib/server/session';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest): Promise<NextResponse> {
  const config = resolveWebConfig();

  // 브라우저가 가진 이름은 `Secure` 여부로 갈린다 (CR-091) — 세울 때와 같은 함수로 읽는다.
  const sessionId = request.cookies.get(sessionCookieName(config.session.cookieSecure))?.value;
  if (sessionId !== undefined && sessionId !== '') {
    await sessionStore().destroy(sessionId);
  }

  const response = NextResponse.json({ ok: true });
  // 전용 헬퍼가 `Max-Age=0`과 빈 값을 함께 낸다. 서버 쪽은 이미 지워졌다.
  response.headers.append('set-cookie', serializeClearingCookie({ secure: config.session.cookieSecure }));
  return response;
}
