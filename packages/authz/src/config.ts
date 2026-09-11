/**
 * 인증 구성 (보안 문서 4장, 6장).
 *
 * 값은 환경 변수에서만 읽는다. OIDC 클라이언트 시크릿은 Kubernetes Secret에
 * 있고 `web`만 접근한다 — `search-api`는 시크릿 없이 세션만 읽으므로 이
 * 파일의 두 함수가 나뉘어 있다.
 */

import { parseGroupRoleMap, type GroupRoleMap } from './roles.js';
import type { OidcProviderConfig } from './oidc.js';
import { defaultGitHubScopes, joinUrl, type GitHubAuthConfig } from './github-oauth.js';

export interface AuthEnv {
  readonly [key: string]: string | undefined;
}

const DEFAULT_SCOPES = ['openid', 'profile', 'email'];

/**
 * 인증 공급자 (CR-083).
 *
 * `oidc`가 기본이다 — **값을 주지 않은 배포의 동작이 바뀌지 않아야 한다.**
 * `github`는 사내망에 별도 IdP가 없고 GHE 계정을 그대로 쓰는 배포용이다.
 */
export type AuthProvider = 'oidc' | 'github';

const AUTH_PROVIDERS: ReadonlySet<string> = new Set<string>(['oidc', 'github']);

/**
 * 어느 공급자로 로그인하는가.
 *
 * **모르는 값은 조용히 기본값으로 떨어뜨리지 않는다.** 오타 하나가 "GHE로
 * 설정했는데 왜 OIDC 화면이 뜨지"로 나타나면 운영자가 로그 없이 그것을 겪는다.
 */
export function resolveAuthProvider(env: AuthEnv = process.env): AuthProvider {
  const raw = (env['AUTH_PROVIDER'] ?? '').trim();
  if (raw === '') return 'oidc';
  if (!AUTH_PROVIDERS.has(raw)) {
    throw new Error(`AUTH_PROVIDER='${raw}'는 지원하지 않는다 (기대: ${[...AUTH_PROVIDERS].join(' | ')})`);
  }
  return raw as AuthProvider;
}

/**
 * 세션을 **읽기만** 하는 쪽의 구성 (`search-api`).
 *
 * IdP 주소도 클라이언트 시크릿도 필요 없다. 세션은 Redis에 있고, 쿠키가
 * 가리키는 것을 거기서 찾으면 된다 (CR-015, DEV-047).
 */
export interface SessionReaderConfig {
  /** 인증이 구성되어 있는가. 아니면 `/admin/*`가 임시 토큰 통제로 돌아간다. */
  readonly enabled: boolean;
  /** 쿠키에 `Secure`를 다는가. 운영에서 false면 기동을 막는다. */
  readonly cookieSecure: boolean;
  /** 미인증 응답에 실을 로그인 경로. `web`이 이 경로를 OIDC로 이어 준다. */
  readonly loginPath: string;
  readonly groupRoleMap: GroupRoleMap;
}

export function resolveSessionReaderConfig(env: AuthEnv = process.env): SessionReaderConfig {
  const production = (env['NODE_ENV'] ?? 'development') === 'production';
  const secure = env['SESSION_COOKIE_SECURE'] === undefined ? production : env['SESSION_COOKIE_SECURE'] === 'true';
  const enabled = env['AUTH_ENABLED'] === undefined ? hasAuthCredentials(env) : env['AUTH_ENABLED'] === 'true';

  /*
   * 평문 HTTP로 **세션 쿠키를 내보내는** 운영 배포를 기동시키지 않는다 (AC-2).
   *
   * **인증을 명시적으로 끈 배포만 면제된다** (CR-083, 사용자 결정). 그 형상에서는
   * 로그인 경로가 503을 내고 세션이 아예 발급되지 않으므로 보호할 쿠키가 없다.
   * 면제의 근거는 "덜 중요해서"가 아니라 **대상이 존재하지 않아서**다.
   *
   * ## 면제를 `enabled`가 아니라 명시적 `'false'`에 건 이유
   *
   * `CR-078`이 이 계약을 세울 때 적은 우려가 있다 — 「인증을 켜는 순간 평문
   * HTTP로 세션이 나가기 시작하는데, 그 전환은 환경 변수 한 줄이라 "지금은 안
   * 쓰니까"로 열어 두면 **열린 채로 켜진다**」. 그 우려는 옳다.
   *
   * `enabled`에 걸면 그 우려가 실재한다: `AUTH_ENABLED`를 주지 않은 배포는
   * 자격 증명 유무로 `enabled`가 정해지므로, 자격을 아직 안 채운 배포가 면제를
   * 받고 **나중에 자격을 채우는 순간 조용히 인증이 켜진다.** 그래서 면제는
   * 운영자가 `AUTH_ENABLED=false`라고 **적어 낸** 경우로 좁힌다.
   *
   *   AUTH_ENABLED=false  (명시)  → 면제. 세션이 발급되지 않는다
   *   AUTH_ENABLED 없음           → 거부. 기본값이 무엇이든 의도가 적혀 있지 않다
   *   AUTH_ENABLED=true           → 거부. 켜는 순간 기동이 막힌다
   *
   * 세 번째 줄이 `CR-078`의 우려를 구조로 막는다. 값을 되돌리지 않고 인증만
   * 켜면 그 배포는 서지 못한다.
   *
   * 그래서 이 완화는 사내가 요청한 것의 절반이다. GHE OAuth2 로그인을 실제로
   * 시험하려면 인증을 켜야 하고, 켜면 TLS가 필요하다. 런북이 그 사실을 적는다.
   */
  const authExplicitlyDisabled = env['AUTH_ENABLED'] === 'false';
  if (production && !secure && !authExplicitlyDisabled) {
    throw new Error('운영에서 SESSION_COOKIE_SECURE=false는 허용되지 않는다 (FR-AUTH-001 AC-2)');
  }

  return {
    enabled,
    cookieSecure: secure,
    loginPath: env['AUTH_LOGIN_PATH'] ?? '/auth/login',
    groupRoleMap: parseGroupRoleMap(env['IDP_GROUP_ROLE_MAP']),
  };
}

/**
 * 구성된 공급자의 자격 증명이 갖춰져 있는가.
 *
 * `AUTH_ENABLED`를 명시하지 않은 배포의 기본값을 정한다. **공급자마다 보는
 * 키가 다르다** — GHE 배포에서 OIDC 키 유무로 판정하면 자격을 다 채우고도
 * 인증이 꺼진 채로 선다.
 */
export function hasAuthCredentials(env: AuthEnv = process.env): boolean {
  return resolveAuthProvider(env) === 'github' ? hasGitHubAuthCredentials(env) : hasOidcCredentials(env);
}

export function hasOidcCredentials(env: AuthEnv = process.env): boolean {
  return (
    (env['OIDC_ISSUER'] ?? '') !== '' &&
    (env['OIDC_CLIENT_ID'] ?? '') !== '' &&
    (env['OIDC_CLIENT_SECRET'] ?? '') !== ''
  );
}

export function hasGitHubAuthCredentials(env: AuthEnv = process.env): boolean {
  return (
    (env['GHE_BASE_URL'] ?? '') !== '' &&
    (env['GHE_OAUTH_CLIENT_ID'] ?? '') !== '' &&
    (env['GHE_OAUTH_CLIENT_SECRET'] ?? '') !== ''
  );
}

/**
 * OIDC 흐름을 **수행하는** 쪽의 구성 (`web`).
 *
 * 인프라 문서의 아웃바운드 허용 목록이 IdP를 `web`에만 열어 준다. 이 함수를
 * `search-api`에서 부르면 없는 환경 변수 때문에 던지는데, 그것이 의도다.
 */
export function resolveOidcConfig(env: AuthEnv = process.env): OidcProviderConfig {
  const issuer = required(env, 'OIDC_ISSUER');

  return {
    issuer,
    // 표준 경로를 기본값으로 둔다. discovery 문서를 쓰는 IdP는 덮어쓴다.
    authorizationEndpoint: env['OIDC_AUTHORIZATION_ENDPOINT'] ?? `${trimSlash(issuer)}/authorize`,
    tokenEndpoint: env['OIDC_TOKEN_ENDPOINT'] ?? `${trimSlash(issuer)}/token`,
    jwksUri: env['OIDC_JWKS_URI'] ?? `${trimSlash(issuer)}/.well-known/jwks.json`,
    clientId: required(env, 'OIDC_CLIENT_ID'),
    clientSecret: required(env, 'OIDC_CLIENT_SECRET'),
    redirectUri: required(env, 'OIDC_REDIRECT_URI'),
    scopes: parseScopes(env['OIDC_SCOPES'], DEFAULT_SCOPES),
  };
}

/**
 * 공백이나 쉼표로 나뉜 스코프 목록.
 *
 * **분해한 결과가 비면 기본값으로 떨어진다.** 빈 문자열만 검사하면 `',,,'` 같은
 * 값이 빈 배열이 되어 `scope=`로 인가 요청이 나가고, 그 토큰은 필요한 것을 읽지
 * 못해 로그인이 실패한다. 구성 오류의 대가가 "무권한 토큰"이어서는 안 된다.
 */
function parseScopes(raw: string | undefined, fallback: readonly string[]): readonly string[] {
  const parsed = (raw ?? '')
    .split(/[\s,]+/)
    .map((one) => one.trim())
    .filter((one) => one !== '');
  return parsed.length === 0 ? fallback : parsed;
}

/**
 * GHE OAuth2 흐름을 **수행하는** 쪽의 구성 (`web`, CR-083).
 *
 * `GHE_BASE_URL`을 수집 경로와 공유한다 — 같은 서버이므로 주소를 두 벌 두면
 * 언젠가 갈린다. 그러나 **OAuth App 자격은 공유하지 않는다**: `GHE_APP_ID`는
 * 수집용 GitHub App이고 여기 쓰는 것은 사용자 로그인용 OAuth App이다. 둘이
 * 자격을 나눠 쓰면 유출 시 피해 범위가 달라진다 (`ADR-022`의 같은 근거).
 */
export function resolveGitHubAuthConfig(env: AuthEnv = process.env): GitHubAuthConfig {
  const baseUrl = required(env, 'GHE_BASE_URL');
  const apiUrl = (env['GHE_API_URL'] ?? '').trim();

  return {
    baseUrl,
    /*
     * 수집 경로와 같은 기본 규칙이다 (`packages/github`의 `resolveGitHubConfig`).
     *
     * **주소 조립은 `joinUrl` 하나만 쓴다.** 여기서 문자열로 이어 붙이면 뒤
     * 슬래시가 둘인 기반 주소에서 `https://host//api/v3`가 나오는데, 인가
     * 엔드포인트는 `joinUrl`이 정규화해 정상이므로 **로그인은 되고 사용자 조회만
     * 실패한다.** 한 값에 정규화 규칙이 둘이면 그런 부분 고장이 생긴다.
     */
    apiUrl: apiUrl === '' ? joinUrl(baseUrl, 'api/v3') : apiUrl.replace(/\/+$/, ''),
    clientId: required(env, 'GHE_OAUTH_CLIENT_ID'),
    clientSecret: required(env, 'GHE_OAUTH_CLIENT_SECRET'),
    redirectUri: required(env, 'GHE_OAUTH_REDIRECT_URI'),
    scopes: parseScopes(env['GHE_OAUTH_SCOPES'], defaultGitHubScopes()),
  };
}

/**
 * GHE 팀 → 역할 매핑 (CR-083).
 *
 * **형식과 제약을 IdP 그룹 매핑과 공유한다** (`org/team:role`, 쉼표로 잇는다).
 * 같은 개념에 두 형식을 두면 운영자가 어느 쪽이 어느 것인지 매번 확인해야 한다.
 *
 * 부여할 수 있는 역할이 `manager`와 `qa`뿐인 것도 그대로 상속된다 (CR-015,
 * DEV-049). **GHE 팀을 만들 수 있는 사람이 운영 권한을 발급하게 두지 않는다** —
 * 사내 GHE의 팀 생성 권한과 PR Search의 운영 권한은 다른 조직이 관리한다.
 */
export function resolveTeamRoleMap(env: AuthEnv = process.env): GroupRoleMap {
  return parseGroupRoleMap(env['GHE_TEAM_ROLE_MAP']);
}

/** IdP가 그룹을 싣는 클레임 이름. IdP마다 다르다 (`groups`, `roles`, ...). */
export function groupsClaimName(env: AuthEnv = process.env): string {
  return env['OIDC_GROUPS_CLAIM'] ?? 'groups';
}

function required(env: AuthEnv, key: string): string {
  const value = env[key];
  if (value === undefined || value === '') {
    throw new Error(`${key}가 설정되지 않았다`);
  }
  return value;
}

function trimSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}
