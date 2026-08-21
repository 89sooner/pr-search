/**
 * 인증 구성 (보안 문서 4장, 6장).
 *
 * 값은 환경 변수에서만 읽는다. OIDC 클라이언트 시크릿은 Kubernetes Secret에
 * 있고 `web`만 접근한다 — `search-api`는 시크릿 없이 세션만 읽으므로 이
 * 파일의 두 함수가 나뉘어 있다.
 */

import { parseGroupRoleMap, type GroupRoleMap } from './roles.js';
import type { OidcProviderConfig } from './oidc.js';

export interface AuthEnv {
  readonly [key: string]: string | undefined;
}

const DEFAULT_SCOPES = ['openid', 'profile', 'email'];

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

  if (production && !secure) {
    // 평문 HTTP로 세션 쿠키를 내보내는 운영 배포를 기동시키지 않는다 (AC-2).
    throw new Error('운영에서 SESSION_COOKIE_SECURE=false는 허용되지 않는다 (FR-AUTH-001 AC-2)');
  }

  return {
    enabled: env['AUTH_ENABLED'] === undefined ? hasOidcCredentials(env) : env['AUTH_ENABLED'] === 'true',
    cookieSecure: secure,
    loginPath: env['AUTH_LOGIN_PATH'] ?? '/auth/login',
    groupRoleMap: parseGroupRoleMap(env['IDP_GROUP_ROLE_MAP']),
  };
}

export function hasOidcCredentials(env: AuthEnv = process.env): boolean {
  return (
    (env['OIDC_ISSUER'] ?? '') !== '' &&
    (env['OIDC_CLIENT_ID'] ?? '') !== '' &&
    (env['OIDC_CLIENT_SECRET'] ?? '') !== ''
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
  const scopes = (env['OIDC_SCOPES'] ?? '').trim();

  return {
    issuer,
    // 표준 경로를 기본값으로 둔다. discovery 문서를 쓰는 IdP는 덮어쓴다.
    authorizationEndpoint: env['OIDC_AUTHORIZATION_ENDPOINT'] ?? `${trimSlash(issuer)}/authorize`,
    tokenEndpoint: env['OIDC_TOKEN_ENDPOINT'] ?? `${trimSlash(issuer)}/token`,
    jwksUri: env['OIDC_JWKS_URI'] ?? `${trimSlash(issuer)}/.well-known/jwks.json`,
    clientId: required(env, 'OIDC_CLIENT_ID'),
    clientSecret: required(env, 'OIDC_CLIENT_SECRET'),
    redirectUri: required(env, 'OIDC_REDIRECT_URI'),
    scopes: scopes === '' ? DEFAULT_SCOPES : scopes.split(/[\s,]+/).filter((one) => one !== ''),
  };
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
