/**
 * 로그인 시작이 구성한 공급자로 보낸다 (`CR-083`).
 *
 * **왜 실행으로 재는가.** 분기가 한 줄이라 소스 검사는 그 줄의 존재만 본다.
 * 그런데 이 판에서 틀리기 쉬운 것은 존재가 아니라 **어느 쪽으로 가는가**다 —
 * `AUTH_PROVIDER=github`으로 설정한 배포가 OIDC 주소로 리다이렉트되면 운영자는
 * "GHE로 설정했는데 왜 IdP로 가지"를 로그 없이 겪는다. 핸들러를 실제로 불러
 * `Location` 헤더를 본다.
 *
 * 왕복 쿠키·경로 정화는 두 공급자가 **공유한다.** 갈래마다 따로 쓰면 한쪽에만
 * 고쳐지는 보안 처리가 생기므로, 공유가 실제로 유지되는지도 함께 건다.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('server-only', () => ({}));

const { GET } = await import('./route.js');

const OIDC_ENV: Record<string, string> = {
  NODE_ENV: 'production',
  SESSION_COOKIE_SECURE: 'true',
  AUTH_ENABLED: 'true',
  OIDC_ISSUER: 'https://idp.example.com',
  OIDC_CLIENT_ID: 'oidc-client',
  OIDC_CLIENT_SECRET: 'oidc-secret',
  OIDC_REDIRECT_URI: 'https://prs.example.com/auth/callback',
};

const GHE_ENV: Record<string, string> = {
  NODE_ENV: 'production',
  SESSION_COOKIE_SECURE: 'true',
  AUTH_ENABLED: 'true',
  AUTH_PROVIDER: 'github',
  GHE_BASE_URL: 'https://ghe.example.com',
  GHE_OAUTH_CLIENT_ID: 'Iv1.ghe-client',
  GHE_OAUTH_CLIENT_SECRET: 'ghe-secret',
  GHE_OAUTH_REDIRECT_URI: 'https://prs.example.com/auth/callback',
};

function stub(env: Record<string, string>): void {
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
}

const request = (path = '/auth/login'): NextRequest =>
  new NextRequest(new URL(path, 'https://prs.example.com'));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('CR-083: 로그인이 구성한 공급자로 보낸다', () => {
  it('기본값은 OIDC 인가 엔드포인트다', () => {
    stub(OIDC_ENV);
    const location = GET(request()).headers.get('location') ?? '';
    expect(location).toContain('https://idp.example.com/authorize');
    expect(new URL(location).searchParams.get('client_id')).toBe('oidc-client');
  });

  it('AUTH_PROVIDER=github이면 GHE 인가 엔드포인트다', () => {
    stub(GHE_ENV);
    const location = GET(request()).headers.get('location') ?? '';
    expect(location).toContain('https://ghe.example.com/login/oauth/authorize');
    expect(new URL(location).searchParams.get('client_id')).toBe('Iv1.ghe-client');
  });

  /**
   * **두 공급자가 같은 왕복 쿠키를 쓴다.**
   *
   * 쿠키가 갈리면 배포 중 공급자를 바꿀 때 진행 중인 로그인이 조용히 깨진다.
   */
  it.each([
    ['oidc', OIDC_ENV],
    ['github', GHE_ENV],
  ])('%s 공급자가 왕복 쿠키를 심는다', (_label, env) => {
    stub(env);
    const cookie = GET(request()).headers.get('set-cookie') ?? '';
    expect(cookie).toContain('prs_oidc');
    expect(cookie).toContain('HttpOnly');
    // 제공자에서 돌아올 때 실려야 하므로 `Strict`가 아니다. Next가 속성 값을
    // 소문자로 쓰므로 대소문자를 가리지 않고 본다.
    expect(cookie).toMatch(/SameSite=lax/i);
    expect(cookie).not.toMatch(/SameSite=strict/i);
  });

  /**
   * **PKCE 챌린지를 두 공급자 모두 싣고 verifier는 싣지 않는다.**
   *
   * GHE는 `plain`을 지원하지 않으므로 S256 고정이다.
   */
  it.each([
    ['oidc', OIDC_ENV],
    ['github', GHE_ENV],
  ])('%s 공급자가 S256 챌린지를 싣는다', (_label, env) => {
    stub(env);
    const location = new URL(GET(request()).headers.get('location') ?? '');
    expect(location.searchParams.get('code_challenge')).toBeTruthy();
    expect(location.searchParams.get('code_challenge_method')).toBe('S256');
    expect(location.searchParams.get('code_verifier')).toBeNull();
    expect(location.searchParams.get('state')).toBeTruthy();
  });

  it.each([
    ['oidc', OIDC_ENV, 'oidc-secret'],
    ['github', GHE_ENV, 'ghe-secret'],
  ])('%s 공급자가 클라이언트 시크릿을 URL에 싣지 않는다', (_label, env, secret) => {
    stub(env);
    expect(GET(request()).headers.get('location') ?? '').not.toContain(secret);
  });

  /**
   * **경로 정화는 공유한다** (CR-018, DEV-071).
   *
   * 공급자를 늘리면서 한쪽만 정화하면 그쪽이 오픈 리다이렉트가 된다.
   */
  it.each([
    ['oidc', OIDC_ENV],
    ['github', GHE_ENV],
  ])('%s 공급자에서 외부 return_to를 걸러 낸다', (_label, env) => {
    stub(env);
    const cookie =
      GET(request('/auth/login?return_to=https://evil.example/steal')).headers.get('set-cookie') ?? '';
    expect(cookie).not.toContain('evil.example');
  });

  it.each([
    ['oidc', OIDC_ENV],
    ['github', GHE_ENV],
  ])('%s 공급자에서 인증이 꺼져 있으면 503이다', (_label, env) => {
    stub(env);
    vi.stubEnv('AUTH_ENABLED', 'false');
    expect(GET(request()).status).toBe(503);
  });

  /**
   * **모르는 공급자 값은 조용히 기본값으로 떨어지지 않는다.**
   *
   * 이 라우트는 던지고, 기동 검증(`webConfigFailure`)이 그보다 먼저 막는다.
   */
  it('AUTH_PROVIDER 오타는 던진다', () => {
    stub({ ...GHE_ENV, AUTH_PROVIDER: 'githubb' });
    expect(() => GET(request())).toThrow(/AUTH_PROVIDER/);
  });
});
