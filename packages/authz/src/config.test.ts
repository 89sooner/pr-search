/**
 * 세션 구성 계약 (WP-012 / FR-AUTH-001 AC-2, `CR-078` `DEV-577`).
 *
 * ## 왜 이 파일이 늦게 생겼는가
 *
 * 이 계약은 `WP-012`부터 있었지만 **계약 자체를 거는 시험이 없었다.** 배포 문서와
 * 코드 주석이 「운영에서 false면 기동을 막는다」고 적고, 원장의 검증 표도 그렇게
 * 적었는데, 그 문장이 참인지 재는 자리가 어디에도 없었다. 사내 반입
 * `0.1.0-pilot.3`에서 그 문장이 실제로는 거짓임이 드러났다 — 막은 것은 기동이
 * 아니라 **요청 하나하나**였고, 컨테이너는 초록으로 서 있었다.
 *
 * 그래서 두 가지를 건다.
 *
 *   1. 계약 자체 — 어떤 입력에 던지고 어떤 입력에 던지지 않는가
 *   2. **배포 문서가 그 계약과 같은 말을 하는가** — 문서에 적힌 값을 실제
 *      계약 함수에 넣어 본다. 문자열 대조가 아니라 실행이다.
 *
 * 2번이 이번 결함의 재발 경로다. `.env.example`이 「HTTP면 false여야 한다」고
 * 적었고 운영자가 그대로 했으며, 그 값은 운영에서 모든 화면을 500으로 만들었다.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  hasAuthCredentials,
  insecureCookiesAllowed,
  resolveAllowInsecureCookies,
  resolveAuthProvider,
  resolveGitHubAuthConfig,
  resolveOidcConfig,
  resolveSessionReaderConfig,
  resolveTeamRoleMap,
} from './config.js';

const repoFile = (path: string): string =>
  readFileSync(fileURLToPath(new URL(`../../../${path}`, import.meta.url)), 'utf8');

describe('FR-AUTH-001 AC-2: 운영에서 insecure 세션 쿠키를 거부한다', () => {
  it('운영에서 SESSION_COOKIE_SECURE=false면 던진다', () => {
    expect(() => resolveSessionReaderConfig({ NODE_ENV: 'production', SESSION_COOKIE_SECURE: 'false' })).toThrow(
      /SESSION_COOKIE_SECURE/,
    );
  });

  it('운영에서 값이 없으면 secure가 기본이고 던지지 않는다', () => {
    const config = resolveSessionReaderConfig({ NODE_ENV: 'production' });
    expect(config.cookieSecure).toBe(true);
  });

  it('운영에서 true면 던지지 않는다', () => {
    expect(resolveSessionReaderConfig({ NODE_ENV: 'production', SESSION_COOKIE_SECURE: 'true' }).cookieSecure).toBe(
      true,
    );
  });

  /**
   * **인증을 명시적으로 끈 배포만 면제된다** (`CR-083`, 사용자 결정).
   *
   * `CR-078`이 이 계약을 세울 때 적은 우려는 「인증을 켜는 순간 평문 HTTP로
   * 세션이 나가기 시작하는데, 그 전환은 환경 변수 한 줄이라 "지금은 안 쓰니까"로
   * 열어 두면 **열린 채로 켜진다**」였고, 그 우려는 옳다. 사내가 TLS 없이 파일럿을
   * 돌려야 한다고 요청했으므로 면제를 열되 **그 우려를 구조로 막는다.**
   *
   * 아래 세 시험이 한 쌍이다 — 면제는 운영자가 `AUTH_ENABLED=false`라고 적어 낸
   * 경우뿐이고, 그 값을 남긴 채 인증만 켜면 기동이 막히며, 의도를 적지 않은
   * 배포는 애초에 면제되지 않는다. 마지막이 중요하다: `enabled`의 계산값에
   * 면제를 걸면 자격 증명을 아직 안 채운 배포가 면제를 받고 **나중에 자격을
   * 채우는 순간 조용히 켜진다.**
   */
  it('AUTH_ENABLED=false를 명시하면 허용한다 — 세션이 발급되지 않는 형상이다', () => {
    const config = resolveSessionReaderConfig({
      NODE_ENV: 'production',
      AUTH_ENABLED: 'false',
      SESSION_COOKIE_SECURE: 'false',
    });
    expect(config.cookieSecure).toBe(false);
    expect(config.enabled).toBe(false);
  });

  it('그 값을 남긴 채 인증만 켜면 다시 거부한다 — 열린 채로 켜지지 않는다', () => {
    expect(() =>
      resolveSessionReaderConfig({ NODE_ENV: 'production', AUTH_ENABLED: 'true', SESSION_COOKIE_SECURE: 'false' }),
    ).toThrow(/SESSION_COOKIE_SECURE/);
  });

  it('AUTH_ENABLED를 적지 않으면 자격 증명이 없어도 거부한다', () => {
    // 자격이 비어 `enabled`는 false로 계산되지만, 의도가 적혀 있지 않으므로
    // 면제하지 않는다. 이 배포가 나중에 자격을 채우면 인증이 켜진다.
    expect(() =>
      resolveSessionReaderConfig({ NODE_ENV: 'production', SESSION_COOKIE_SECURE: 'false' }),
    ).toThrow(/SESSION_COOKIE_SECURE/);
  });

  it('개발에서는 false를 허용한다 — TLS 없이 도는 것이 정상이다', () => {
    expect(resolveSessionReaderConfig({ NODE_ENV: 'development', SESSION_COOKIE_SECURE: 'false' }).cookieSecure).toBe(
      false,
    );
  });
});

/**
 * 두 번째 면제 — 위험을 이름으로 적어 낸 배포 (`CR-091` / `DEV-694`, 사용자 결정).
 *
 * 사내 `0.1.0-pilot.6`은 TLS 없이 GHE 로그인을 시험하려 했고, `CR-083`의 면제(인증을 끈
 * 배포)로는 그것을 할 수 없었다. 이 묶음은 **플래그가 한 줄로 평문 세션을 시작시키지
 * 않는다**는 것을 건다 — 플래그만으로도, `SESSION_COOKIE_SECURE=false`만으로도 서지 않는다.
 */
describe('CR-091: ALLOW_INSECURE_COOKIES — 운영에서 인증을 켠 평문 HTTP 파일럿', () => {
  const PILOT = { NODE_ENV: 'production', AUTH_ENABLED: 'true', SESSION_COOKIE_SECURE: 'false' } as const;

  it('SESSION_COOKIE_SECURE=false와 함께 적으면 인증을 켠 채로 선다', () => {
    const config = resolveSessionReaderConfig({ ...PILOT, ALLOW_INSECURE_COOKIES: 'true' });
    expect(config.cookieSecure).toBe(false);
    expect(config.enabled).toBe(true);
    expect(insecureCookiesAllowed({ ...PILOT, ALLOW_INSECURE_COOKIES: 'true' })).toBe(true);
  });

  it('플래그가 없으면 여전히 거부하고, 거부 문구가 두 갈래의 처방을 말한다', () => {
    expect(() => resolveSessionReaderConfig(PILOT)).toThrow(/TLS.*ALLOW_INSECURE_COOKIES=true/);
  });

  it('플래그는 Secure를 끄지 않는다 — 플래그만 적은 운영 배포는 Secure 쿠키를 낸다', () => {
    const env = { NODE_ENV: 'production', AUTH_ENABLED: 'true', ALLOW_INSECURE_COOKIES: 'true' };
    expect(resolveSessionReaderConfig(env).cookieSecure).toBe(true);
    expect(insecureCookiesAllowed(env)).toBe(false);
  });

  it('AUTH_ENABLED=false 면제와 겹치면 경고 대상이 아니다 — 세션이 발급되지 않는 형상이다', () => {
    const env = { ...PILOT, AUTH_ENABLED: 'false', ALLOW_INSECURE_COOKIES: 'true' };
    expect(resolveSessionReaderConfig(env).enabled).toBe(false);
    expect(insecureCookiesAllowed(env)).toBe(false);
  });

  it('개발에서는 경고 대상이 아니다 — 운영 계약의 예외가 아니라 원래 허용이다', () => {
    expect(insecureCookiesAllowed({ NODE_ENV: 'development', SESSION_COOKIE_SECURE: 'false', ALLOW_INSECURE_COOKIES: 'true' })).toBe(
      false,
    );
  });

  it.each(['', 'false', ' false '])('%j는 꺼짐이다', (value) => {
    expect(resolveAllowInsecureCookies({ ALLOW_INSECURE_COOKIES: value })).toBe(false);
    expect(() => resolveSessionReaderConfig({ ...PILOT, ALLOW_INSECURE_COOKIES: value })).toThrow(/SESSION_COOKIE_SECURE/);
  });

  it.each(['TRUE', 'yes', '1', 'on'])('%j는 기동을 거부한다 — 켜짐으로도 꺼짐으로도 읽지 않는다', (value) => {
    expect(() => resolveAllowInsecureCookies({ ALLOW_INSECURE_COOKIES: value })).toThrow(/ALLOW_INSECURE_COOKIES는 true 또는 false/);
    // Secure를 켠 운영 배포에서도 같다 — 오타는 형상과 무관하게 오타다.
    expect(() => resolveSessionReaderConfig({ NODE_ENV: 'production', ALLOW_INSECURE_COOKIES: value })).toThrow(
      /ALLOW_INSECURE_COOKIES/,
    );
  });

  it('값이 없으면 꺼짐이다 — 이미 선 배포의 동작이 바뀌지 않는다', () => {
    expect(resolveAllowInsecureCookies({})).toBe(false);
    expect(insecureCookiesAllowed({ NODE_ENV: 'production' })).toBe(false);
  });
});

/**
 * 배포 문서가 계약과 같은 말을 하는가 (`DEV-577`).
 *
 * **문서에서 값을 읽어 실제 계약 함수에 넣는다.** 이렇게 하면 문구가 어떻게
 * 바뀌든, 문서가 권하는 값이 운영에서 서지 못하는 값이면 시험이 죽는다.
 */
describe('DEV-577: 배포 문서의 값이 운영 계약을 통과한다', () => {
  const ENV_EXAMPLE = repoFile('deploy/single-host/.env.example');
  const COMPOSE = repoFile('deploy/single-host/compose.yml');

  it('.env.example이 권하는 SESSION_COOKIE_SECURE가 운영에서 선다', () => {
    const declared = /^SESSION_COOKIE_SECURE=(.*)$/m.exec(ENV_EXAMPLE)?.[1];
    expect(declared, '.env.example에 SESSION_COOKIE_SECURE가 없다').toBeDefined();
    expect(() =>
      resolveSessionReaderConfig({ NODE_ENV: 'production', SESSION_COOKIE_SECURE: (declared as string).trim() }),
    ).not.toThrow();
  });

  it('compose의 기본값이 운영에서 선다', () => {
    // `SESSION_COOKIE_SECURE: ${SESSION_COOKIE_SECURE:-true}` 에서 기본값만 읽는다.
    const fallback = /SESSION_COOKIE_SECURE:\s*\$\{SESSION_COOKIE_SECURE:-([^}]*)\}/.exec(COMPOSE)?.[1];
    expect(fallback, 'compose가 SESSION_COOKIE_SECURE에 기본값을 주지 않는다').toBeDefined();
    expect(() =>
      resolveSessionReaderConfig({ NODE_ENV: 'production', SESSION_COOKIE_SECURE: (fallback as string).trim() }),
    ).not.toThrow();
  });

  /**
   * **문서가 운영자를 거부당하는 값으로 보내지 않는다.**
   *
   * 이전 `.env.example`은 「TLS 없이 HTTP로 서비스하면 false여야 쿠키가
   * 전달된다」고 적었다. 그 문장 자체는 브라우저 동작으로는 참인데, 이 배포의
   * 운영 계약에서는 **실행 불가능한 조합**이다. 두 문장이 한 파일에 있으면
   * 운영자는 앞 문장을 실행한다.
   */
  it('.env.example이 운영에서 false를 쓰라고 읽히지 않는다', () => {
    const section = ENV_EXAMPLE.slice(
      ENV_EXAMPLE.indexOf('# 인증 (OIDC)'),
      ENV_EXAMPLE.indexOf('SESSION_COOKIE_SECURE='),
    );
    expect(section, 'false를 권하는 문장이 남아 있다').not.toMatch(/false여야|false로 (?:둔다|바꾼다|내린다)/);
    // 대신 무엇을 해야 하는지 말해야 한다 — 금지만으로는 운영자가 갈 곳이 없다.
    expect(section).toContain('AUTH_ENABLED=false');
  });
});

/**
 * 인증 공급자 선택 (`CR-083`).
 *
 * **모르는 값을 조용히 기본값으로 떨어뜨리지 않는다.** 오타 하나가 "GHE로
 * 설정했는데 왜 OIDC 화면이 뜨지"로 나타나면 운영자가 로그 없이 그것을 겪는다.
 */
describe('CR-083: AUTH_PROVIDER', () => {
  it('값이 없으면 oidc다 — 이미 선 배포의 동작이 바뀌지 않는다', () => {
    expect(resolveAuthProvider({})).toBe('oidc');
    expect(resolveAuthProvider({ AUTH_PROVIDER: '' })).toBe('oidc');
  });

  it('github을 고를 수 있다', () => {
    expect(resolveAuthProvider({ AUTH_PROVIDER: 'github' })).toBe('github');
  });

  it.each(['githubb', 'GitHub', 'ghe', 'oauth'])('모르는 값 %s이면 던진다', (value) => {
    expect(() => resolveAuthProvider({ AUTH_PROVIDER: value })).toThrow(/AUTH_PROVIDER/);
  });
});

/**
 * GHE OAuth2 구성 (`CR-083`).
 *
 * **수집용 GitHub App과 자격을 공유하지 않는다.** `GHE_BASE_URL`은 같은 서버를
 * 가리키므로 공유하지만 `GHE_APP_ID`/`GHE_APP_PRIVATE_KEY`는 쓰지 않는다 —
 * 하나가 유출됐을 때 피해 범위가 달라진다 (`ADR-022`의 근거).
 */
describe('CR-083: resolveGitHubAuthConfig', () => {
  const FULL = {
    GHE_BASE_URL: 'https://ghe.example.com',
    GHE_OAUTH_CLIENT_ID: 'Iv1.abc',
    GHE_OAUTH_CLIENT_SECRET: 'secret',
    GHE_OAUTH_REDIRECT_URI: 'https://prs.example.com/auth/callback',
  };

  it('필수 넷으로 구성이 선다', () => {
    const config = resolveGitHubAuthConfig(FULL);
    expect(config.baseUrl).toBe('https://ghe.example.com');
    expect(config.clientId).toBe('Iv1.abc');
    expect(config.redirectUri).toBe('https://prs.example.com/auth/callback');
  });

  it.each(Object.keys(FULL))('%s가 비면 던진다', (key) => {
    expect(() => resolveGitHubAuthConfig({ ...FULL, [key]: '' })).toThrow(new RegExp(key));
  });

  it('API 주소를 주지 않으면 수집 경로와 같은 규칙으로 만든다', () => {
    expect(resolveGitHubAuthConfig(FULL).apiUrl).toBe('https://ghe.example.com/api/v3');
  });

  it('API 주소를 주면 그것을 쓴다', () => {
    const config = resolveGitHubAuthConfig({ ...FULL, GHE_API_URL: 'https://api.ghe.example.com/' });
    expect(config.apiUrl).toBe('https://api.ghe.example.com');
  });

  it('스코프 기본값은 최소 권한이다', () => {
    // `/user`에 read:user, `/user/teams`에 read:org. 저장소 내용 스코프는 없다.
    expect(resolveGitHubAuthConfig(FULL).scopes).toEqual(['read:user', 'read:org']);
  });

  it('스코프를 주면 그것을 쓴다', () => {
    const config = resolveGitHubAuthConfig({ ...FULL, GHE_OAUTH_SCOPES: 'read:user read:org user:email' });
    expect(config.scopes).toEqual(['read:user', 'read:org', 'user:email']);
  });

  it('수집용 App 자격을 읽지 않는다', () => {
    // 이 값들만 있고 OAuth App 자격이 없으면 구성이 서지 않아야 한다.
    expect(() =>
      resolveGitHubAuthConfig({ GHE_BASE_URL: 'https://ghe.example.com', GHE_APP_ID: '1', GHE_APP_PRIVATE_KEY: 'k' }),
    ).toThrow(/GHE_OAUTH_CLIENT_ID/);
  });
});

/**
 * GHE 팀 → 역할 매핑 (`CR-083`).
 *
 * **IdP 그룹 매핑과 형식·제약을 공유한다.** 같은 개념에 두 형식을 두면 운영자가
 * 어느 쪽이 어느 것인지 매번 확인해야 한다.
 */
describe('CR-083: resolveTeamRoleMap', () => {
  it('org/team:role 쌍을 읽는다', () => {
    const map = resolveTeamRoleMap({ GHE_TEAM_ROLE_MAP: 'acme/pipe-admins:manager,acme/qa-team:qa' });
    expect(map.get('acme/pipe-admins')).toBe('manager');
    expect(map.get('acme/qa-team')).toBe('qa');
  });

  it('비어 있으면 빈 매핑이다 — 모두 developer만 받는다', () => {
    expect(resolveTeamRoleMap({}).size).toBe(0);
  });

  /**
   * **GHE 팀을 만들 수 있는 사람이 운영 권한을 발급하게 두지 않는다.**
   *
   * 이 제약은 IdP 그룹에 세운 것과 같다 (CR-015, DEV-049). 사내 GHE의 팀 생성
   * 권한과 PR Search의 운영 권한은 다른 조직이 관리한다.
   */
  it.each(['operator', 'security_officer', 'release_manager'])('%s는 팀으로 부여할 수 없다', (role) => {
    expect(() => resolveTeamRoleMap({ GHE_TEAM_ROLE_MAP: `acme/team:${role}` })).toThrow(/부여할 수 없다/);
  });

  it('역할이 아닌 값은 던진다 — 사내가 제안한 admin·viewer가 여기 걸린다', () => {
    expect(() => resolveTeamRoleMap({ GHE_TEAM_ROLE_MAP: 'acme/team:admin' })).toThrow(/역할이 아니다/);
    expect(() => resolveTeamRoleMap({ GHE_TEAM_ROLE_MAP: 'acme/team:viewer' })).toThrow(/역할이 아니다/);
  });

  it('구분자가 콜론이 아니면 던진다', () => {
    expect(() => resolveTeamRoleMap({ GHE_TEAM_ROLE_MAP: 'acme/team=manager' })).toThrow(/형식/);
  });
});

/**
 * 공급자가 바뀌면 인증 기본값도 그 공급자를 본다 (`CR-083`).
 *
 * **GHE 배포에서 OIDC 키 유무로 판정하면** 자격을 다 채우고도 인증이 꺼진 채로
 * 선다. 그 배포는 화면이 뜨고 조회만 401이라 원인을 찾기 어렵다.
 */
describe('CR-083: AUTH_ENABLED 기본값이 공급자를 따른다', () => {
  const GHE = {
    NODE_ENV: 'production',
    AUTH_PROVIDER: 'github',
    GHE_BASE_URL: 'https://ghe.example.com',
    GHE_OAUTH_CLIENT_ID: 'Iv1.abc',
    GHE_OAUTH_CLIENT_SECRET: 'secret',
  };

  it('GHE 자격이 갖춰지면 인증이 켜진다', () => {
    expect(resolveSessionReaderConfig(GHE).enabled).toBe(true);
    expect(hasAuthCredentials(GHE)).toBe(true);
  });

  it('GHE 자격이 없으면 꺼진다', () => {
    expect(resolveSessionReaderConfig({ NODE_ENV: 'production', AUTH_PROVIDER: 'github' }).enabled).toBe(false);
  });

  it('OIDC 키만 있고 공급자가 github이면 꺼진다', () => {
    const mixed = {
      NODE_ENV: 'production',
      AUTH_PROVIDER: 'github',
      OIDC_ISSUER: 'https://idp.example.com',
      OIDC_CLIENT_ID: 'client',
      OIDC_CLIENT_SECRET: 'secret',
    };
    expect(resolveSessionReaderConfig(mixed).enabled).toBe(false);
  });

  it('공급자를 주지 않으면 OIDC 자격을 본다 — 기존 배포 그대로', () => {
    const oidc = {
      NODE_ENV: 'production',
      OIDC_ISSUER: 'https://idp.example.com',
      OIDC_CLIENT_ID: 'client',
      OIDC_CLIENT_SECRET: 'secret',
    };
    expect(resolveSessionReaderConfig(oidc).enabled).toBe(true);
  });
});

/**
 * 독립 검토가 찾은 경계 (`CR-083`).
 *
 * 둘 다 오구성 입력에서만 나타나지만, **오구성의 대가가 "조용히 틀린 동작"이면
 * 안 된다**는 것이 이 저장소의 규칙이다.
 */
describe('CR-083: 구성 해석의 경계', () => {
  const FULL = {
    GHE_BASE_URL: 'https://ghe.example.com',
    GHE_OAUTH_CLIENT_ID: 'Iv1.abc',
    GHE_OAUTH_CLIENT_SECRET: 'secret',
    GHE_OAUTH_REDIRECT_URI: 'https://prs.example.com/auth/callback',
  };

  /**
   * **한 값에 정규화 규칙이 둘이면 부분 고장이 난다.**
   *
   * 인가 엔드포인트는 `joinUrl`이 정규화하므로 정상인데 API 주소만 이중
   * 슬래시가 되면, 로그인은 되고 사용자 조회만 실패한다.
   */
  it.each([
    ['슬래시 없음', 'https://ghe.example.com'],
    ['슬래시 하나', 'https://ghe.example.com/'],
    ['슬래시 둘', 'https://ghe.example.com//'],
  ])('기반 주소의 뒤 슬래시가 %s이어도 API 주소가 같다', (_label, base) => {
    expect(resolveGitHubAuthConfig({ ...FULL, GHE_BASE_URL: base }).apiUrl).toBe('https://ghe.example.com/api/v3');
  });

  /**
   * **구성 오류의 대가가 「무권한 토큰」이어서는 안 된다.**
   *
   * 빈 문자열만 검사하면 구분자만 있는 값이 빈 배열이 되고, `scope=`로 나간
   * 인가 요청이 만든 토큰은 `/user/teams`를 읽지 못해 로그인이 실패한다.
   */
  it.each([',,,', ' , , ', '   ', ''])('스코프가 %s이면 기본값으로 떨어진다', (raw) => {
    expect(resolveGitHubAuthConfig({ ...FULL, GHE_OAUTH_SCOPES: raw }).scopes).toEqual(['read:user', 'read:org']);
  });

  it('OIDC 스코프도 같은 규칙을 쓴다', () => {
    const oidc = {
      OIDC_ISSUER: 'https://idp.example.com',
      OIDC_CLIENT_ID: 'c',
      OIDC_CLIENT_SECRET: 's',
      OIDC_REDIRECT_URI: 'https://prs.example.com/auth/callback',
    };
    expect(resolveOidcConfig({ ...oidc, OIDC_SCOPES: ',,,' }).scopes).toEqual(['openid', 'profile', 'email']);
  });
});
