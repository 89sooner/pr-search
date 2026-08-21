/**
 * OIDC 로그인 시작 (FLOW-000 3단계 / WP-015).
 *
 * WP-012가 `@prs/authz`에 라이브러리를 세웠고 이 라우트가 그것을 부른다.
 * **`web`이 소유하는 이유**는 인프라 문서의 아웃바운드 허용 목록이 IdP를
 * `web`에만 열기 때문이다.
 */

import { NextResponse, type NextRequest } from 'next/server';
import {
  buildAuthorizationUrl,
  createAuthorizationRequest,
  resolveOidcConfig,
  sanitizeReturnPath,
} from '@prs/authz';
import { encodeRoundTrip, roundTripCookie } from '../../../lib/oidc-state';
import { resolveWebConfig } from '../../../lib/server/config';

export const dynamic = 'force-dynamic';

export function GET(request: NextRequest): NextResponse {
  const config = resolveWebConfig();

  if (!config.authEnabled) {
    // 자격 증명 없이 리다이렉트하면 IdP 대신 404로 간다. 무엇이 빠졌는지 말한다.
    return NextResponse.json(
      { error: { code: 'PERMISSION_UNAVAILABLE', message: 'OIDC가 구성되지 않았습니다' } },
      { status: 503 },
    );
  }

  /*
   * 돌아갈 경로를 `state`가 아니라 쿠키에 담는다 (CR-018, DEV-071).
   *
   * `sanitizeReturnPath`가 외부 URL과 프로토콜 상대 경로를 걸러 낸다 —
   * 그것이 없으면 `?return_to=https://evil.example`이 로그인 후 오픈
   * 리다이렉트가 된다.
   */
  const returnTo = sanitizeReturnPath(request.nextUrl.searchParams.get('return_to') ?? undefined);
  const authorization = createAuthorizationRequest(returnTo);

  const response = NextResponse.redirect(
    buildAuthorizationUrl(resolveOidcConfig(), authorization),
  );
  response.cookies.set(roundTripCookie(encodeRoundTrip(authorization), config.session.cookieSecure));
  return response;
}
