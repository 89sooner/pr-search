/**
 * 로그인 콜백 (FLOW-000 4~6단계 / WP-015, CR-083).
 *
 * 순서가 곧 보안이다:
 *   1. 왕복 쿠키를 읽고 **즉시 만료 예약** — 같은 `state`로 두 번 시도할 수 없다
 *   2. `state` 비교 (상수 시간, `statesMatch`)
 *   3. 인가 코드 → 토큰 (PKCE `code_verifier`)
 *   4. 신원 확인 — 공급자마다 방법이 다르다
 *   5. 세션 발급
 *   6. 원래 경로로 복귀
 *
 * **어느 단계가 실패했는지 사용자에게 자세히 말하지 않는다.** "state가
 * 다르다"와 "서명이 틀리다"를 구분해 주면 공격자에게 어디까지 통과했는지를
 * 알려 준다. 로그에는 상관 ID와 함께 남는다.
 *
 * ## 4단계가 공급자마다 다른 이유 (CR-083)
 *
 * OIDC는 신원을 **서명된 `id_token` 안에서** 읽는다 — 서명·`iss`·`aud`·`exp`·
 * `nonce` 다섯을 검증하면 그 클레임이 곧 신원이다.
 *
 * GHE OAuth2는 `id_token`을 주지 않는다. 신원은 액세스 토큰으로 **GHE에 되물어서**
 * 얻는다. 그래서 `nonce` 재생 검사가 없다 — 재생된 코드로는 토큰을 얻지 못하고,
 * 얻었다면 그 토큰의 주인이 곧 신원이다. `state`와 PKCE는 두 흐름이 공유한다.
 *
 * 1·2·3·5·6단계는 공유한다. **갈래마다 따로 쓰면 한쪽에만 고쳐지는 보안 처리가
 * 생긴다** — 이 저장소가 여러 번 겪은 모양이다.
 */

import { randomUUID } from 'node:crypto';
import type { KeyObject } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import {
  composeRoles,
  createSessionId,
  exchangeCode,
  exchangeGitHubCode,
  fetchGitHubApiReader,
  fetchGitHubIdentity,
  fetchGitHubTokenExchanger,
  fetchTokenExchanger,
  groupsClaimName,
  parseGroupRoleMap,
  resolveAuthProvider,
  resolveGitHubAuthConfig,
  resolveOidcConfig,
  resolveTeamRoleMap,
  sanitizeReturnPath,
  serializeSessionCookie,
  statesMatch,
  verifyIdToken,
  JwksCache,
  fetchJwks,
  type Role,
} from '@prs/authz';
import { clearedRoundTripCookie, decodeRoundTrip, OIDC_STATE_COOKIE, type OidcRoundTrip } from '../../../lib/oidc-state';
import { resolveWebConfig } from '../../../lib/server/config';
import { sessionStore } from '../../../lib/server/session';

export const dynamic = 'force-dynamic';

/** 공급자가 다르게 얻고 세션 발급이 똑같이 쓰는 것. */
interface ResolvedIdentity {
  /** 세션과 `app_user`의 키. **바뀌지 않는 값이어야 한다.** */
  readonly userId: string;
  readonly login: string;
  readonly email: string | null;
  readonly roles: readonly Role[];
  /** GHE 공급자에서만 채워진다. `app_user.github_user_id`로 간다. */
  readonly githubUserId?: number | undefined;
}

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

/**
 * OIDC — 서명된 `id_token`에서 신원을 읽는다.
 *
 * 다섯 검증(서명·`iss`·`aud`·`exp`·`nonce`)을 통과한 클레임만 신원이 된다.
 */
async function identifyViaOidc(roundTrip: OidcRoundTrip, code: string): Promise<ResolvedIdentity> {
  const oidc = resolveOidcConfig();
  const tokens = await exchangeCode(oidc, code, roundTrip.codeVerifier, fetchTokenExchanger);

  const claims = await verifyIdToken(tokens.id_token, {
    issuer: oidc.issuer,
    audience: oidc.clientId,
    expectedNonce: roundTrip.nonce,
    getKey: keyResolver(oidc.jwksUri),
  });

  const groups = claims[groupsClaimName()];
  return {
    userId: claims.sub,
    login: typeof claims['preferred_username'] === 'string' ? claims['preferred_username'] : claims.sub,
    email: typeof claims['email'] === 'string' ? claims['email'] : null,
    roles: composeRoles(
      Array.isArray(groups) ? groups.filter((g): g is string => typeof g === 'string') : [],
      [],
      parseGroupRoleMap(process.env['OIDC_GROUP_ROLE_MAP'] ?? ''),
    ),
  };
}

/**
 * GHE OAuth2 — 액세스 토큰으로 발급자에게 신원을 되묻는다 (CR-083).
 *
 * **`userId`는 로그인 이름이 아니라 숫자 `id`다.** GHE에서 로그인 이름은 바뀔 수
 * 있고, 그것을 키로 쓰면 이름을 바꾼 사람이 남의 저장 검색과 감사 이력을 물려받는다.
 * 숫자 `id`는 계정의 수명 동안 바뀌지 않는다.
 *
 * 역할은 팀 멤버십에서 합성한다. **부여할 수 있는 역할은 `manager`와 `qa`뿐이고**
 * 그 제한은 `parseGroupRoleMap`이 IdP 그룹과 똑같이 강제한다 (CR-015, DEV-049) —
 * GHE 팀을 만들 수 있는 사람이 운영 권한을 발급하게 두지 않는다.
 */
async function identifyViaGitHub(roundTrip: OidcRoundTrip, code: string): Promise<ResolvedIdentity> {
  const github = resolveGitHubAuthConfig();
  const tokens = await exchangeGitHubCode(github, code, roundTrip.codeVerifier, fetchGitHubTokenExchanger);
  const identity = await fetchGitHubIdentity(github, tokens.access_token, fetchGitHubApiReader);

  return {
    userId: String(identity.id),
    login: identity.login,
    email: identity.email,
    roles: composeRoles(identity.teams, [], resolveTeamRoleMap()),
    githubUserId: identity.id,
  };
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
      { error: { code: 'PERMISSION_UNAVAILABLE', message: '인증이 구성되지 않았습니다' } },
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

  try {
    // 3·4. 코드 → 토큰 → 신원. 공급자마다 방법이 다르다 (위 두 함수의 주석 참고).
    const identity =
      resolveAuthProvider() === 'github'
        ? await identifyViaGitHub(roundTrip, code)
        : await identifyViaOidc(roundTrip, code);

    // 5. 세션 발급.
    const sessionId = createSessionId();
    const now = Date.now();
    await sessionStore().create({
      sessionId,
      userId: identity.userId,
      login: identity.login,
      email: identity.email,
      roles: identity.roles,
      issuedAt: now,
      lastSeenAt: now,
      correlationId,
      githubUserId: identity.githubUserId,
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
