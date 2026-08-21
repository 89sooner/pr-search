/**
 * OIDC Authorization Code + PKCE (FR-AUTH-001, ADR-011).
 *
 * **이 흐름을 수행하는 것은 `web`뿐이다.** 인프라 문서의 아웃바운드 허용
 * 목록이 IdP를 `web`에만 열어 준다. `search-api`는 여기 있는 것 중 아무것도
 * 부르지 않고, 만들어진 세션을 Redis에서 읽기만 한다 (CR-015, DEV-047).
 *
 * 그래서 이 파일은 HTTP 서버를 모른다 — 라우트는 WP-015가 만든다.
 */

import { OidcError } from './errors.js';
import type { AuthorizationRequest } from './pkce.js';

export interface OidcProviderConfig {
  readonly issuer: string;
  readonly authorizationEndpoint: string;
  readonly tokenEndpoint: string;
  readonly jwksUri: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUri: string;
  /** 기본 `openid profile email`. 그룹 클레임이 별도 스코프인 IdP가 있다. */
  readonly scopes: readonly string[];
}

/** 인가 엔드포인트로 보낼 URL을 만든다 (FR-AUTH-001 AC-1). */
export function buildAuthorizationUrl(
  config: OidcProviderConfig,
  request: AuthorizationRequest,
): string {
  const url = new URL(config.authorizationEndpoint);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', config.redirectUri);
  url.searchParams.set('scope', config.scopes.join(' '));
  url.searchParams.set('state', request.state);
  url.searchParams.set('nonce', request.nonce);
  url.searchParams.set('code_challenge', request.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

export interface TokenResponse {
  readonly id_token: string;
  readonly access_token?: string;
  readonly token_type?: string;
  readonly expires_in?: number;
}

/** 토큰 엔드포인트를 부르는 방법. 테스트는 여기에 목을 넣는다. */
export type TokenExchanger = (
  endpoint: string,
  body: URLSearchParams,
  headers: Readonly<Record<string, string>>,
) => Promise<{ readonly status: number; readonly body: unknown }>;

/**
 * 인가 코드를 토큰으로 바꾼다.
 *
 * `client_secret`은 본문이 아니라 **Basic 인증 헤더**로 보낸다. 본문에 실으면
 * 프록시 로그와 오류 보고에 남을 여지가 커진다 (NFR-005: 로그에 시크릿 0건).
 *
 * @throws {OidcError} 응답이 2xx가 아니거나 `id_token`이 없으면. **응답 본문을
 * 메시지에 담지 않는다** — 그 안에 토큰이 들어 있다.
 */
export async function exchangeCode(
  config: OidcProviderConfig,
  code: string,
  codeVerifier: string,
  exchanger: TokenExchanger,
): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: config.redirectUri,
    client_id: config.clientId,
    code_verifier: codeVerifier,
  });

  const basic = Buffer.from(`${encodeURIComponent(config.clientId)}:${encodeURIComponent(config.clientSecret)}`).toString(
    'base64',
  );

  let response: { readonly status: number; readonly body: unknown };
  try {
    response = await exchanger(config.tokenEndpoint, body, {
      authorization: `Basic ${basic}`,
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json',
    });
  } catch (error) {
    throw new OidcError(`토큰 교환 요청 실패: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (response.status < 200 || response.status >= 300) {
    // 본문에 `error`가 있으면 그것만 옮긴다. 나머지는 담지 않는다.
    const code_ =
      typeof response.body === 'object' && response.body !== null && 'error' in response.body
        ? String((response.body as { error: unknown }).error)
        : 'unknown';
    throw new OidcError(`토큰 엔드포인트가 ${String(response.status)}를 반환했다 (error=${code_})`);
  }

  const payload = response.body;
  if (typeof payload !== 'object' || payload === null || !('id_token' in payload)) {
    throw new OidcError('토큰 응답에 id_token이 없다');
  }
  const idToken = (payload as { id_token: unknown }).id_token;
  if (typeof idToken !== 'string' || idToken === '') {
    throw new OidcError('id_token이 문자열이 아니다');
  }

  return payload as TokenResponse;
}

/** `fetch` 기반 기본 구현. 테스트는 쓰지 않는다. */
export const fetchTokenExchanger: TokenExchanger = async (endpoint, body, headers) => {
  const response = await fetch(endpoint, { method: 'POST', body, headers: { ...headers } });
  const text = await response.text();
  let parsed: unknown = null;
  try {
    parsed = text === '' ? null : JSON.parse(text);
  } catch {
    parsed = null;
  }
  return { status: response.status, body: parsed };
};

/** `fetch` 기반 JWKS 조회. */
export async function fetchJwks(uri: string): Promise<{ readonly keys: readonly Record<string, unknown>[] }> {
  const response = await fetch(uri, { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`JWKS 응답 ${String(response.status)}`);
  return (await response.json()) as { readonly keys: readonly Record<string, unknown>[] };
}
