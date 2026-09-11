/**
 * GHE OAuth2 직접 인증 (CR-083 / FR-AUTH-001 AC-6~AC-9).
 *
 * 사내망에 별도 OIDC IdP가 없고 **사내 GHE는 OIDC 디스커버리 엔드포인트를
 * 제공하지 않는다.** Dex 같은 미들웨어를 따로 세우는 것은 운영 부담이 크다는
 * 것이 사내의 판단이었다. 그래서 GHE가 직접 제공하는 OAuth2 Authorization
 * Code Flow를 두 번째 공급자로 둔다.
 *
 * **기존 OIDC 흐름을 그대로 둔다.** `AUTH_PROVIDER`가 둘 중 하나를 고르고,
 * 값을 주지 않은 배포는 `oidc`다 — 이미 서 있는 배포의 동작이 바뀌지 않는다.
 *
 * ## OIDC와 무엇이 다른가
 *
 * | | OIDC | GHE OAuth2 |
 * | --- | --- | --- |
 * | 신원의 출처 | `id_token`의 서명된 클레임 | `/user` 응답 |
 * | 검증 방법 | JWKS 서명·`iss`·`aud`·`nonce` | **액세스 토큰으로 GHE에 되물음** |
 * | 역할의 출처 | 그룹 클레임 | `/user/teams` 멤버십 |
 *
 * 신원을 토큰 안에서 읽지 않고 **발급자에게 되묻는다**는 것이 핵심 차이다.
 * 그래서 `nonce` 재생 검사가 필요 없다 — 재생된 코드로는 토큰을 얻지 못하고,
 * 얻더라도 그 토큰의 주인이 곧 신원이다. `state`와 PKCE는 그대로 쓴다.
 *
 * ## PKCE
 *
 * GHE의 인가 엔드포인트는 `code_challenge`/`code_challenge_method=S256`을
 * 받는다 (`plain`은 지원하지 않는다). 그래서 `pkce.ts`를 공급자마다 새로 쓰지
 * 않고 그대로 공유한다. `nonce`는 GHE가 받지 않으므로 보내지 않는다.
 *
 * 이 파일은 HTTP 서버를 모른다. 라우트는 `apps/web`이 가진다.
 */

import { OidcError } from './errors.js';
import type { AuthorizationRequest } from './pkce.js';

/** `/user/teams` 한 페이지의 크기. GHE가 허용하는 최대값이다. */
const TEAM_PAGE_SIZE = 100;

/**
 * 팀 조회에서 따라갈 최대 페이지 수.
 *
 * **상한이 없으면 느린 응답 하나가 로그인 전체를 매단다.** 100 × 20 = 2,000팀은
 * 한 사람의 멤버십으로는 비현실적으로 크고, 넘어가면 역할 매핑이 그 뒤 팀을
 * 보지 못한다는 것을 호출 측이 알 수 있게 `truncated`로 돌려준다.
 */
const TEAM_PAGE_LIMIT = 20;

/** 기본 스코프. `/user`에 `read:user`, `/user/teams`에 `read:org`가 최소다. */
const DEFAULT_SCOPES: readonly string[] = ['read:user', 'read:org'];

export interface GitHubAuthConfig {
  /** `https://<GHE 호스트>` — 인가·토큰 엔드포인트의 기반이다. API 기반과 다르다. */
  readonly baseUrl: string;
  /** `https://<GHE 호스트>/api/v3` — `/user`와 `/user/teams`의 기반이다. */
  readonly apiUrl: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUri: string;
  readonly scopes: readonly string[];
}

/** 설정에서 기본 스코프를 쓰고 싶을 때. */
export function defaultGitHubScopes(): readonly string[] {
  return DEFAULT_SCOPES;
}

const joinUrl = (base: string, path: string): string =>
  `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;

/** 인가 엔드포인트 URL (`<base>/login/oauth/authorize`). */
export function gitHubAuthorizationEndpoint(config: GitHubAuthConfig): string {
  return joinUrl(config.baseUrl, 'login/oauth/authorize');
}

/** 토큰 엔드포인트 URL (`<base>/login/oauth/access_token`). */
export function gitHubTokenEndpoint(config: GitHubAuthConfig): string {
  return joinUrl(config.baseUrl, 'login/oauth/access_token');
}

/**
 * 인가 엔드포인트로 보낼 URL을 만든다 (FR-AUTH-001 AC-1).
 *
 * `nonce`는 싣지 않는다 — GHE가 받지 않는 파라미터이고, 신원은 토큰 안이 아니라
 * `/user` 응답에서 온다. **`code_verifier`는 절대 싣지 않는다** (그것은 교환
 * 요청에만 간다).
 */
export function buildGitHubAuthorizationUrl(
  config: GitHubAuthConfig,
  request: AuthorizationRequest,
): string {
  const url = new URL(gitHubAuthorizationEndpoint(config));
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', config.redirectUri);
  url.searchParams.set('scope', config.scopes.join(' '));
  url.searchParams.set('state', request.state);
  url.searchParams.set('code_challenge', request.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  // 계정 선택 화면을 건너뛰지 않는다. 공용 단말에서 앞 사람의 세션으로 조용히
  // 들어가는 일이 없어야 한다.
  url.searchParams.set('allow_signup', 'false');
  return url.toString();
}

export interface GitHubTokenResponse {
  readonly access_token: string;
  readonly token_type?: string;
  readonly scope?: string;
}

/** 토큰 엔드포인트를 부르는 방법. 시험은 여기에 대역을 넣는다. */
export type GitHubTokenExchanger = (
  endpoint: string,
  body: URLSearchParams,
  headers: Readonly<Record<string, string>>,
) => Promise<{ readonly status: number; readonly body: unknown }>;

/**
 * 응답 본문에서 오류 코드만 뽑는다.
 *
 * **본문 전체를 메시지에 담지 않는다** — 성공 응답과 같은 자리에 액세스 토큰이
 * 실리므로, 오류 처리 경로가 토큰을 로그로 옮기는 통로가 되어서는 안 된다
 * (NFR-005).
 */
const errorCodeOf = (body: unknown): string => {
  if (typeof body !== 'object' || body === null || !('error' in body)) return 'unknown';
  const code = (body as { error: unknown }).error;
  return typeof code === 'string' && code !== '' ? code : 'unknown';
};

/**
 * 인가 코드를 액세스 토큰으로 바꾼다.
 *
 * **GHE는 교환 실패를 HTTP 200으로도 답한다.** 본문에 `error`가 실려 오고 상태
 * 코드는 성공이다. 공식 문서가 이 동작의 상태 코드를 명시하지 않으므로 **두
 * 경우를 모두 오류로 다룬다** — 상태 코드만 보면 실패한 교환을 성공으로 읽고
 * `access_token`이 없는 채로 다음 단계에 들어간다.
 *
 * `client_secret`은 공식 문서가 지정한 대로 본문 파라미터로 보낸다. OIDC 쪽이
 * 쓰는 Basic 헤더를 여기에 옮겨 쓰지 않는다 — 문서에 없는 방식을 추측으로
 * 고르면 사내에서만 실패하고 그 실패는 재현하기 어렵다.
 *
 * @throws {OidcError} 요청이 실패했거나, 본문에 `error`가 있거나,
 * `access_token`이 없으면. **응답 본문을 메시지에 담지 않는다.**
 */
export async function exchangeGitHubCode(
  config: GitHubAuthConfig,
  code: string,
  codeVerifier: string,
  exchanger: GitHubTokenExchanger,
): Promise<GitHubTokenResponse> {
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code,
    redirect_uri: config.redirectUri,
    code_verifier: codeVerifier,
  });

  let response: { readonly status: number; readonly body: unknown };
  try {
    response = await exchanger(gitHubTokenEndpoint(config), body, {
      'content-type': 'application/x-www-form-urlencoded',
      // 이 헤더가 없으면 GHE는 form-urlencoded로 답한다.
      accept: 'application/json',
    });
  } catch (error) {
    throw new OidcError(`GHE 토큰 교환 요청 실패: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (response.status < 200 || response.status >= 300) {
    throw new OidcError(
      `GHE 토큰 엔드포인트가 ${String(response.status)}를 반환했다 (error=${errorCodeOf(response.body)})`,
    );
  }

  // 200인데 오류인 경우. 이것이 GHE의 통상 실패 모양이다.
  if (typeof response.body === 'object' && response.body !== null && 'error' in response.body) {
    throw new OidcError(`GHE 토큰 교환이 거절됐다 (error=${errorCodeOf(response.body)})`);
  }

  if (typeof response.body !== 'object' || response.body === null || !('access_token' in response.body)) {
    throw new OidcError('GHE 토큰 응답에 access_token이 없다');
  }
  const token = (response.body as { access_token: unknown }).access_token;
  if (typeof token !== 'string' || token === '') {
    throw new OidcError('access_token이 문자열이 아니다');
  }

  return response.body as GitHubTokenResponse;
}

/** GHE API를 부르는 방법. 시험은 여기에 대역을 넣는다. */
export type GitHubApiReader = (
  url: string,
  headers: Readonly<Record<string, string>>,
) => Promise<{ readonly status: number; readonly body: unknown; readonly link?: string | undefined }>;

export interface GitHubIdentity {
  /** `/user`의 숫자 `id`. **로그인 이름과 달리 바뀌지 않으므로 이것이 신원이다.** */
  readonly id: number;
  readonly login: string;
  readonly email: string | null;
  /** `<org login>/<team slug>` 형태. 역할 매핑의 입력이다. */
  readonly teams: readonly string[];
  /** 팀 페이지 상한에 걸려 뒤를 보지 못했으면 참. */
  readonly teamsTruncated: boolean;
}

const authHeaders = (accessToken: string): Record<string, string> => ({
  authorization: `Bearer ${accessToken}`,
  accept: 'application/vnd.github+json',
  'x-github-api-version': '2022-11-28',
});

/**
 * 액세스 토큰의 주인과 그 팀 멤버십을 읽는다.
 *
 * **사용자 위임 토큰으로 부른다.** App 설치 자격으로 물으면 그 사용자가 실제로
 * 볼 수 있는 것보다 넓은 답이 오고, 그 차이만큼 역할이 과하게 부여된다
 * (`FR-GH-008` AC-3이 교집합을 요구하는 것과 같은 이유다).
 *
 * @throws {OidcError} 어느 호출이든 2xx가 아니거나 모양이 다르면. 응답 본문을
 * 메시지에 담지 않는다.
 */
export async function fetchGitHubIdentity(
  config: GitHubAuthConfig,
  accessToken: string,
  read: GitHubApiReader,
): Promise<GitHubIdentity> {
  const headers = authHeaders(accessToken);

  let user: { readonly status: number; readonly body: unknown };
  try {
    user = await read(joinUrl(config.apiUrl, 'user'), headers);
  } catch (error) {
    throw new OidcError(`GHE 사용자 조회 실패: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (user.status < 200 || user.status >= 300) {
    throw new OidcError(`GHE 사용자 조회가 ${String(user.status)}를 반환했다`);
  }
  if (typeof user.body !== 'object' || user.body === null) {
    throw new OidcError('GHE 사용자 응답이 객체가 아니다');
  }

  const raw = user.body as { id?: unknown; login?: unknown; email?: unknown };
  // **정수여야 한다.** 실수나 안전 범위 밖 값을 신원으로 쓰면 `app_user`의
  // BIGINT 열과 어긋난다.
  if (typeof raw.id !== 'number' || !Number.isSafeInteger(raw.id) || raw.id <= 0) {
    throw new OidcError('GHE 사용자 응답의 id가 양의 정수가 아니다');
  }
  if (typeof raw.login !== 'string' || raw.login === '') {
    throw new OidcError('GHE 사용자 응답에 login이 없다');
  }
  const email = typeof raw.email === 'string' && raw.email !== '' ? raw.email : null;

  const { teams, truncated } = await fetchTeams(config, headers, read);

  return { id: raw.id, login: raw.login, email, teams, teamsTruncated: truncated };
}

async function fetchTeams(
  config: GitHubAuthConfig,
  headers: Readonly<Record<string, string>>,
  read: GitHubApiReader,
): Promise<{ teams: readonly string[]; truncated: boolean }> {
  const collected: string[] = [];
  const seen = new Set<string>();

  for (let page = 1; page <= TEAM_PAGE_LIMIT; page += 1) {
    const url = new URL(joinUrl(config.apiUrl, 'user/teams'));
    url.searchParams.set('per_page', String(TEAM_PAGE_SIZE));
    url.searchParams.set('page', String(page));

    let response: { readonly status: number; readonly body: unknown; readonly link?: string | undefined };
    try {
      response = await read(url.toString(), headers);
    } catch (error) {
      throw new OidcError(`GHE 팀 조회 실패: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (response.status < 200 || response.status >= 300) {
      throw new OidcError(`GHE 팀 조회가 ${String(response.status)}를 반환했다`);
    }
    if (!Array.isArray(response.body)) {
      throw new OidcError('GHE 팀 응답이 배열이 아니다');
    }

    for (const entry of response.body) {
      const slug = teamKeyOf(entry);
      // 모양이 다른 항목은 **버리되 던지지 않는다** — 팀 하나의 표현이 바뀌었다고
      // 로그인 전체가 막히면 그 대가가 이득보다 크다. 매핑에 쓰이는 팀이라면
      // 역할이 붙지 않는 것으로 드러난다.
      if (slug === null || seen.has(slug)) continue;
      seen.add(slug);
      collected.push(slug);
    }

    // 마지막 페이지는 정원보다 적게 온다. `Link` 헤더를 신뢰하지 않는 이유는
    // 프록시가 그것을 다시 쓰는 배포가 있기 때문이다.
    if (response.body.length < TEAM_PAGE_SIZE) {
      return { teams: collected, truncated: false };
    }
  }

  return { teams: collected, truncated: true };
}

/** `{organization: {login}, slug}` → `"org/team"`. 모양이 다르면 `null`. */
function teamKeyOf(entry: unknown): string | null {
  if (typeof entry !== 'object' || entry === null) return null;
  const team = entry as { slug?: unknown; organization?: unknown };
  if (typeof team.slug !== 'string' || team.slug === '') return null;
  if (typeof team.organization !== 'object' || team.organization === null) return null;
  const org = (team.organization as { login?: unknown }).login;
  if (typeof org !== 'string' || org === '') return null;
  return `${org}/${team.slug}`;
}

/** `fetch` 기반 기본 구현. 시험은 쓰지 않는다. */
export const fetchGitHubTokenExchanger: GitHubTokenExchanger = async (endpoint, body, headers) => {
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

/** `fetch` 기반 기본 구현. 시험은 쓰지 않는다. */
export const fetchGitHubApiReader: GitHubApiReader = async (url, headers) => {
  const response = await fetch(url, { headers: { ...headers } });
  const text = await response.text();
  let parsed: unknown = null;
  try {
    parsed = text === '' ? null : JSON.parse(text);
  } catch {
    parsed = null;
  }
  return { status: response.status, body: parsed, link: response.headers.get('link') ?? undefined };
};
