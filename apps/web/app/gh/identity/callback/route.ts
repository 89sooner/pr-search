/**
 * Operations App 인가 콜백 (WP-077 / FR-GH-008 AC-2, API-GH-007, CR-086).
 *
 * GHE가 `?code&state`를 들고 여기로 돌아온다. `web`이 IdP 왕복을 소유한다는 인프라 규칙에 따라
 * 이 라우트가 받되, **판정은 `search-api`가 한다** — `state`가 누구의 것인지, 코드 교환이 성립하는지,
 * 봉인을 어디에 두는지는 전부 그쪽이다. 여기서 하는 일은 셋뿐이다:
 *
 *   1. 세션 쿠키로 사용자를 확인한다 (프록시와 같은 판정, `resolveProxyAuth`)
 *   2. `code`·`state`를 세션 쿠키와 함께 `POST /api/v1/gh/identity/callback`으로 넘긴다
 *   3. 응답의 `return_to`로 보낸다 — 실패는 한 가지 모양(`/gh?identity=failed`)으로만 보인다
 *
 * **`code`·`state`를 로그에 남기지 않는다.** 둘 다 1회용 자격이다. 실패 사유도 사용자에게
 * 자세히 말하지 않는다 (`CR-083`의 규율) — 상관 ID와 사유 코드는 서버 로그에만 간다.
 *
 * `app/auth/callback/route.ts`와 같은 자리이되 다른 자격이다: 그쪽은 PR Search 로그인, 여기는
 * 로그인한 사용자가 GitHub에 위임하는 두 번째 자격이다 (FR-GH-008 AC-1).
 */

import { randomUUID } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { sanitizeReturnPath, sessionCookieName } from '@prs/authz';
import { buildProxyHeaders, readBrowserCookie, resolveProxyAuth } from '../../../../lib/proxy';
import { resolveWebConfig } from '../../../../lib/server/config';
import { sessionStore } from '../../../../lib/server/session';

export const dynamic = 'force-dynamic';

/** 인가가 끝난 뒤의 기본 복귀 경로. `return_to`가 없거나 안전하지 않으면 여기다. */
const FALLBACK_RETURN = '/gh';
/** 실패는 이 한 곳으로만 간다. 어느 단계가 틀렸는지 URL이 말하지 않는다. */
const FAILED_RETURN = '/gh?identity=failed';

function logFailure(correlationId: string, reason: string, status?: number): void {
  console.error(
    JSON.stringify({
      level: 'warn',
      message: 'Operations App 인가 콜백을 완료하지 못했다',
      correlation_id: correlationId,
      reason,
      ...(status === undefined ? {} : { upstream_status: status }),
    }),
  );
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const correlationId = randomUUID();
  const config = resolveWebConfig();
  const origin = request.nextUrl.origin;
  const failed = (): NextResponse => NextResponse.redirect(new URL(FAILED_RETURN, origin));

  const code = request.nextUrl.searchParams.get('code') ?? '';
  const state = request.nextUrl.searchParams.get('state') ?? '';
  if (code === '' || state === '') {
    logFailure(correlationId, 'code 또는 state가 없다');
    return failed();
  }

  /*
   * 1. 세션. 세션 없이는 이 `state`가 누구의 것인지 서버가 확인할 수 없다. 로그인 뒤 `/gh`로
   *    돌아와 **다시 연결**한다 — 인가 코드는 1회용이라 되살리지 않는다.
   */
  const auth = await resolveProxyAuth(
    readBrowserCookie(request.headers.get('cookie'), sessionCookieName(config.session.cookieSecure)),
    (id) => sessionStore().load(id),
  );
  if (auth.kind === 'unauthenticated') {
    logFailure(correlationId, '세션이 없다');
    if (config.authEnabled) {
      return NextResponse.redirect(new URL(`${config.session.loginPath}?return_to=${encodeURIComponent(FALLBACK_RETURN)}`, origin));
    }
    return failed();
  }
  if (auth.kind === 'unavailable') {
    logFailure(correlationId, '세션 저장소에 닿지 못했다');
    return failed();
  }

  // 2. 전달 — 세션 쿠키만 다시 조립한다 (프록시와 같은 규칙).
  const headers = buildProxyHeaders({
    headers: new Headers({ 'content-type': 'application/json', accept: 'application/json' }),
    sessionId: auth.sessionId,
    correlationId,
  });

  let upstream: Response;
  try {
    upstream = await fetch(`${config.searchApiUrl}/api/v1/gh/identity/callback`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ code, state }),
      redirect: 'manual',
      cache: 'no-store',
    });
  } catch {
    logFailure(correlationId, 'search-api에 닿지 못했다');
    return failed();
  }

  const body: unknown = await upstream.json().catch(() => null);
  if (!upstream.ok) {
    const error = typeof body === 'object' && body !== null ? (body as Record<string, unknown>)['error'] : undefined;
    const detail = typeof error === 'object' && error !== null ? (error as Record<string, unknown>)['detail'] : undefined;
    const reason = typeof detail === 'object' && detail !== null ? (detail as Record<string, unknown>)['reason'] : undefined;
    logFailure(correlationId, typeof reason === 'string' ? reason : 'rejected', upstream.status);
    return failed();
  }

  // 3. 복귀. 서버가 준 값도 다시 한번 거른다 — 신뢰 경계를 두 번 넘지 않는다.
  const returnTo = typeof body === 'object' && body !== null ? (body as Record<string, unknown>)['return_to'] : undefined;
  return NextResponse.redirect(new URL(sanitizeReturnPath(typeof returnTo === 'string' ? returnTo : undefined, FALLBACK_RETURN), origin));
}
