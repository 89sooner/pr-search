/**
 * OIDC 왕복 상태 (CR-018, DEV-071).
 *
 * `createAuthorizationRequest`가 만드는 `state`·`nonce`·`codeVerifier`·`returnTo`
 * 넷은 인가 리다이렉트와 콜백 **사이를 건너야 한다.** 어디에 두는지가 어느
 * 문서에도 없어 CR-018이 정했다: **짧은 수명의 HttpOnly 쿠키**.
 *
 * - **Redis에 두지 않는 이유**: 콜백 전에 이탈한 사용자의 흔적이 계속 쌓인다.
 *   왕복 하나에 필요한 값이 왕복보다 오래 살 이유가 없다.
 * - **URL에 두지 않는 이유**: `codeVerifier`가 노출되면 PKCE가 막으려던 것을
 *   그대로 연다.
 * - **`SameSite=Lax`인 이유**: IdP에서 우리 콜백으로 돌아오는 것은 top-level
 *   내비게이션이라 `Lax`로 쿠키가 실린다. `Strict`면 실리지 않아 콜백이
 *   자기 `state`를 못 읽는다.
 */

import type { AuthorizationRequest } from '@prs/authz';

export const OIDC_STATE_COOKIE = '__Host-prs_oidc';

/**
 * 왕복 상태의 수명 (10분).
 *
 * IdP 로그인 화면에서 사용자가 머무는 시간을 넉넉히 덮되, 브라우저에 오래
 * 남기지 않는다. 만료되면 콜백이 `state`를 못 찾아 처음부터 다시 시작한다.
 */
export const OIDC_STATE_TTL_SECONDS = 600;

export interface OidcRoundTrip {
  readonly state: string;
  readonly nonce: string;
  readonly codeVerifier: string;
  readonly returnTo: string;
}

/** 쿠키에 실을 값. JSON을 base64url로 감싸 쿠키 문법과 부딪히지 않게 한다. */
export function encodeRoundTrip(request: AuthorizationRequest): string {
  const payload: OidcRoundTrip = {
    state: request.state,
    nonce: request.nonce,
    codeVerifier: request.codeVerifier,
    returnTo: request.returnTo,
  };
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

/**
 * 쿠키 값을 되읽는다.
 *
 * 모양이 조금이라도 어긋나면 `null`이다 — 부분적으로 읽어 진행하면 `nonce`
 * 없이 ID 토큰을 검증하게 되고, 그것은 검증하지 않는 것과 같다.
 */
export function decodeRoundTrip(raw: string | undefined): OidcRoundTrip | null {
  if (raw === undefined || raw === '') return null;

  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (typeof parsed !== 'object' || parsed === null) return null;

    const { state, nonce, codeVerifier, returnTo } = parsed as Record<string, unknown>;
    if (
      typeof state !== 'string' || state === '' ||
      typeof nonce !== 'string' || nonce === '' ||
      typeof codeVerifier !== 'string' || codeVerifier === '' ||
      typeof returnTo !== 'string'
    ) {
      return null;
    }
    return { state, nonce, codeVerifier, returnTo };
  } catch {
    return null;
  }
}

export interface CookieAttributes {
  readonly name: string;
  readonly value: string;
  readonly httpOnly: true;
  readonly secure: boolean;
  readonly sameSite: 'lax';
  readonly path: '/';
  readonly maxAge: number;
}

/**
 * 쿠키를 세운다.
 *
 * `__Host-` 접두를 쓰므로 `Secure`·`Path=/`가 필수이고 `Domain`을 둘 수 없다 —
 * 하위 도메인이 이 쿠키를 덮어쓰지 못하게 한다.
 */
export function roundTripCookie(value: string, secure: boolean): CookieAttributes {
  return {
    name: OIDC_STATE_COOKIE,
    value,
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
    maxAge: OIDC_STATE_TTL_SECONDS,
  };
}

/**
 * 쿠키를 즉시 만료시킨다.
 *
 * 콜백이 검증을 마치면 **성공이든 실패든** 지운다. 남겨 두면 같은 `state`로
 * 두 번째 콜백을 시도할 수 있다.
 */
export function clearedRoundTripCookie(secure: boolean): CookieAttributes {
  return { ...roundTripCookie('', secure), maxAge: 0 };
}

/**
 * 쿠키 속성을 `Set-Cookie` 헤더 값으로 만든다.
 *
 * **`NextResponse.cookies.set`을 쓸 수 없는 자리가 있다** (`DEV-614`). 그 API는
 * 자기가 아는 목록으로 `set-cookie` 헤더를 **다시 쓰므로**, `headers.append`로 이미
 * 달아 둔 다른 쿠키를 지운다. 한 응답에 쿠키가 둘 이상이면 **두 쿠키를 같은 방법으로
 * 달아야** 한다. 순서를 맞추는 것으로 고치면 다음 사람이 줄을 옮기는 순간 같은
 * 자리가 다시 열린다.
 *
 * `@prs/authz`의 `serializeSessionCookie`와 같은 형식을 낸다.
 */
export function serializeCookie(attributes: CookieAttributes): string {
  const parts = [`${attributes.name}=${attributes.value}`, `Path=${attributes.path}`];
  if (attributes.maxAge !== undefined) parts.push(`Max-Age=${String(attributes.maxAge)}`);
  if (attributes.secure) parts.push('Secure');
  if (attributes.httpOnly) parts.push('HttpOnly');
  parts.push(`SameSite=${attributes.sameSite === 'lax' ? 'Lax' : attributes.sameSite}`);
  return parts.join('; ');
}
