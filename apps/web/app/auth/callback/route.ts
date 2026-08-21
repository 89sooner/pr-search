/**
 * OIDC 콜백 (FLOW-000 4~6단계 / WP-015).
 *
 * 순서가 곧 보안이다:
 *   1. 왕복 쿠키를 읽고 **즉시 만료 예약** — 같은 `state`로 두 번 시도할 수 없다
 *   2. `state` 비교 (상수 시간, `statesMatch`)
 *   3. 인가 코드 → 토큰 (PKCE `code_verifier`)
 *   4. ID 토큰 5종 검증 (서명·iss·aud·exp·nonce)
 *   5. 세션 발급
 *   6. 원래 경로로 복귀
 *
 * **어느 단계가 실패했는지 사용자에게 자세히 말하지 않는다.** "state가
 * 다르다"와 "서명이 틀리다"를 구분해 주면 공격자에게 어디까지 통과했는지를
 * 알려 준다. 로그에는 상관 ID와 함께 남는다.
 */

import { randomUUID } from 'node:crypto';
import type { KeyObject } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import {
  composeRoles,
  createSessionId,
  exchangeCode,
  fetchTokenExchanger,
  groupsClaimName,
  parseGroupRoleMap,
  resolveOidcConfig,
  sanitizeReturnPath,
  serializeSessionCookie,
  statesMatch,
  verifyIdToken,
  JwksCache,
  fetchJwks,
} from '@prs/authz';
import { clearedRoundTripCookie, decodeRoundTrip, OIDC_STATE_COOKIE } from '../../../lib/oidc-state';
import { resolveWebConfig } from '../../../lib/server/config';
import { sessionStore } from '../../../lib/server/session';

export const dynamic = 'force-dynamic';

/**
 * JWKS 캐시를 모듈 수준에 둔다.
 *
 * 요청마다 새로 만들면 로그인마다 IdP의 JWKS를 다시 받는다. 캐시가 TTL과
 * 회전 쿨다운을 함께 다루므로(WP-012) 여기서는 한 번만 만들면 된다.
 */
let jwks: JwksCache | undefined;

function keyResolver(uri: string): (kid: string) => Promise<KeyObject> {
  jwks ??= new JwksCache({ uri, fetcher: fetchJwks });
  return (kid) => (jwks as JwksCache).getKey(kid);
}

/** 실패는 한 가지 모양으로만 보인다. 어디서 틀렸는지 드러내지 않는다. */
function authFailed(correlationId: string, secure: boolean): NextResponse {
  const response = NextResponse.json(
    {
      error: { code: 'UNAUTHENTICATED', message: '인증을 완료하지 못했습니다. 다시 로그인하세요.' },
      correlation_id: correlationId,
    },
    { status: 401 },
  );
  response.cookies.set(clearedRoundTripCookie(secure));
  return response;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const correlationId = randomUUID();
  const config = resolveWebConfig();
  const secure = config.session.cookieSecure;

  if (!config.authEnabled) {
    return NextResponse.json(
      { error: { code: 'PERMISSION_UNAVAILABLE', message: 'OIDC가 구성되지 않았습니다' } },
      { status: 503 },
    );
  }

  // 1. 왕복 상태.
  const roundTrip = decodeRoundTrip(request.cookies.get(OIDC_STATE_COOKIE)?.value);
  if (roundTrip === null) return authFailed(correlationId, secure);

  // 2. `state` 비교. IdP가 준 것과 우리가 만든 것이 같아야 한다 (CSRF).
  const received = request.nextUrl.searchParams.get('state') ?? '';
  if (!statesMatch(roundTrip.state, received)) return authFailed(correlationId, secure);

  const code = request.nextUrl.searchParams.get('code') ?? '';
  if (code === '') return authFailed(correlationId, secure);

  const oidc = resolveOidcConfig();

  try {
    // 3. 코드 → 토큰.
    const tokens = await exchangeCode(oidc, code, roundTrip.codeVerifier, fetchTokenExchanger);

    // 4. ID 토큰 검증. `nonce`까지 다섯을 모두 본다.
    const claims = await verifyIdToken(tokens.id_token, {
      issuer: oidc.issuer,
      audience: oidc.clientId,
      expectedNonce: roundTrip.nonce,
      getKey: keyResolver(oidc.jwksUri),
    });

    // 5. 세션 발급. 역할은 IdP 그룹에서 합성한다 (WP-012의 규칙 그대로).
    const groups = claims[groupsClaimName()];
    const roles = composeRoles(
      Array.isArray(groups) ? groups.filter((g): g is string => typeof g === 'string') : [],
      [],
      parseGroupRoleMap(process.env['OIDC_GROUP_ROLE_MAP'] ?? ''),
    );

    const sessionId = createSessionId();
    const now = Date.now();
    await sessionStore().create({
      sessionId,
      userId: claims.sub,
      login: typeof claims['preferred_username'] === 'string' ? claims['preferred_username'] : claims.sub,
      email: typeof claims['email'] === 'string' ? claims['email'] : null,
      roles,
      issuedAt: now,
      lastSeenAt: now,
      correlationId,
    });

    // 6. 원래 경로로. 쿠키에서 온 값도 다시 한번 거른다 — 신뢰 경계를 두 번 넘지 않는다.
    const response = NextResponse.redirect(
      new URL(sanitizeReturnPath(roundTrip.returnTo), request.nextUrl.origin),
    );
    response.headers.append('set-cookie', serializeSessionCookie(sessionId, { secure }));
    response.cookies.set(clearedRoundTripCookie(secure));
    return response;
  } catch {
    /*
     * 토큰 교환·검증 실패.
     *
     * **오류 객체를 응답에 담지 않는다** — `exchangeCode`가 응답 본문을
     * 메시지에 넣지 않도록 만들어졌지만(NFR-005), 여기서 한 번 더 막는다.
     */
    return authFailed(correlationId, secure);
  }
}
