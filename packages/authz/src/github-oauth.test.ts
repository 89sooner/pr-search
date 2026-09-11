/**
 * GHE OAuth2 직접 인증 (CR-083 / FR-AUTH-001 AC-6~AC-9).
 *
 * ## 이 흐름에서 무엇이 위험한가
 *
 * OIDC는 신원을 **서명된 토큰 안에서** 읽으므로 검증이 암호학이다. GHE OAuth2는
 * 신원을 **발급자에게 되물어서** 얻으므로 검증이 응답 해석이다. 그래서 이 파일이
 * 무겁게 거는 것은 서명이 아니라 다음 셋이다.
 *
 *   1. 실패를 성공으로 읽지 않는가 — GHE는 교환 실패를 **HTTP 200**으로도 답한다
 *   2. 응답의 모양을 믿지 않는가 — `id`가 정수가 아니면 `app_user`와 어긋난다
 *   3. 비밀이 오류 경로로 새지 않는가 (NFR-005)
 *
 * 1번이 이 판에서 가장 조용한 실패다. 상태 코드만 보면 거절된 교환이 통과하고
 * `access_token`이 없는 채로 다음 단계에 들어간다.
 */

import { describe, expect, it } from 'vitest';

import { OidcError } from './errors.js';
import {
  buildGitHubAuthorizationUrl,
  exchangeGitHubCode,
  fetchGitHubIdentity,
  gitHubAuthorizationEndpoint,
  gitHubTokenEndpoint,
  type GitHubApiReader,
  type GitHubAuthConfig,
  type GitHubTokenExchanger,
} from './github-oauth.js';
import { createAuthorizationRequest } from './pkce.js';

const CONFIG: GitHubAuthConfig = {
  baseUrl: 'https://ghe.example.com',
  apiUrl: 'https://ghe.example.com/api/v3',
  clientId: 'Iv1.client',
  clientSecret: 's3cr3t-value',
  redirectUri: 'https://prs.example.com/auth/callback',
  scopes: ['read:user', 'read:org'],
};

const ACCESS_TOKEN = 'gho_aaaabbbbccccddddeeeeffff0000111122223333';

describe('엔드포인트 주소', () => {
  it('GHE 호스트에 표준 경로를 붙인다', () => {
    expect(gitHubAuthorizationEndpoint(CONFIG)).toBe('https://ghe.example.com/login/oauth/authorize');
    expect(gitHubTokenEndpoint(CONFIG)).toBe('https://ghe.example.com/login/oauth/access_token');
  });

  it('기반 주소의 끝 슬래시가 경로를 겹치게 하지 않는다', () => {
    const trailing = { ...CONFIG, baseUrl: 'https://ghe.example.com/' };
    expect(gitHubAuthorizationEndpoint(trailing)).toBe('https://ghe.example.com/login/oauth/authorize');
  });
});

describe('인가 URL (AC-1)', () => {
  it('state와 PKCE 챌린지를 싣는다', () => {
    const request = createAuthorizationRequest('/search?q=abc');
    const url = new URL(buildGitHubAuthorizationUrl(CONFIG, request));

    expect(url.origin + url.pathname).toBe('https://ghe.example.com/login/oauth/authorize');
    expect(url.searchParams.get('client_id')).toBe(CONFIG.clientId);
    expect(url.searchParams.get('redirect_uri')).toBe(CONFIG.redirectUri);
    expect(url.searchParams.get('scope')).toBe('read:user read:org');
    expect(url.searchParams.get('state')).toBe(request.state);
    expect(url.searchParams.get('code_challenge')).toBe(request.codeChallenge);
    // `plain`은 GHE가 받지 않는다. 다운그레이드를 허용하지 않는다.
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  });

  /**
   * **verifier는 인가 요청에 실리지 않는다.**
   *
   * 실리면 PKCE가 무의미해진다 — 인가 URL은 브라우저 주소창과 IdP 로그에 남는다.
   */
  it('code_verifier를 싣지 않는다', () => {
    const request = createAuthorizationRequest('/');
    const raw = buildGitHubAuthorizationUrl(CONFIG, request);

    expect(raw).not.toContain(request.codeVerifier);
    expect(new URL(raw).searchParams.get('code_verifier')).toBeNull();
  });

  it('GHE가 받지 않는 nonce를 보내지 않는다', () => {
    const url = new URL(buildGitHubAuthorizationUrl(CONFIG, createAuthorizationRequest('/')));
    expect(url.searchParams.get('nonce')).toBeNull();
  });

  it('클라이언트 시크릿을 싣지 않는다', () => {
    const raw = buildGitHubAuthorizationUrl(CONFIG, createAuthorizationRequest('/'));
    expect(raw).not.toContain(CONFIG.clientSecret);
  });
});

describe('토큰 교환', () => {
  const okExchanger = (captured: { endpoint?: string; body?: URLSearchParams; headers?: Record<string, string> }) =>
    (async (endpoint, body, headers) => {
      captured.endpoint = endpoint;
      captured.body = body;
      captured.headers = { ...headers };
      return { status: 200, body: { access_token: ACCESS_TOKEN, token_type: 'bearer', scope: 'read:org' } };
    }) satisfies GitHubTokenExchanger;

  it('코드와 verifier를 보내고 토큰을 돌려준다', async () => {
    const captured: { endpoint?: string; body?: URLSearchParams; headers?: Record<string, string> } = {};
    const token = await exchangeGitHubCode(CONFIG, 'code-1', 'verifier-1', okExchanger(captured));

    expect(token.access_token).toBe(ACCESS_TOKEN);
    expect(captured.endpoint).toBe('https://ghe.example.com/login/oauth/access_token');
    expect(captured.body?.get('code')).toBe('code-1');
    expect(captured.body?.get('code_verifier')).toBe('verifier-1');
    expect(captured.body?.get('redirect_uri')).toBe(CONFIG.redirectUri);
    // 공식 문서가 지정한 자리. 헤더로 옮겨 추측하지 않는다.
    expect(captured.body?.get('client_secret')).toBe(CONFIG.clientSecret);
    // 이 헤더가 없으면 GHE는 form-urlencoded로 답한다.
    expect(captured.headers?.['accept']).toBe('application/json');
  });

  /**
   * **이 판에서 가장 조용한 실패다.**
   *
   * GHE는 거절된 교환을 HTTP 200으로 답하고 본문에 `error`를 싣는다. 상태 코드만
   * 보는 구현은 그것을 성공으로 읽고 `access_token`이 없는 채로 다음 단계에
   * 들어간다.
   */
  it('HTTP 200이어도 본문에 error가 있으면 던진다', async () => {
    const exchanger: GitHubTokenExchanger = async () => ({
      status: 200,
      body: {
        error: 'bad_verification_code',
        error_description: 'The code passed is incorrect or expired.',
        error_uri: 'https://docs.github.com/',
      },
    });

    await expect(exchangeGitHubCode(CONFIG, 'code', 'verifier', exchanger)).rejects.toThrow(OidcError);
    await expect(exchangeGitHubCode(CONFIG, 'code', 'verifier', exchanger)).rejects.toThrow(
      /bad_verification_code/,
    );
  });

  it('2xx가 아니면 던진다', async () => {
    const exchanger: GitHubTokenExchanger = async () => ({ status: 401, body: { error: 'unauthorized_client' } });
    await expect(exchangeGitHubCode(CONFIG, 'code', 'verifier', exchanger)).rejects.toThrow(/401/);
  });

  it('access_token이 없으면 던진다', async () => {
    const exchanger: GitHubTokenExchanger = async () => ({ status: 200, body: { token_type: 'bearer' } });
    await expect(exchangeGitHubCode(CONFIG, 'code', 'verifier', exchanger)).rejects.toThrow(/access_token/);
  });

  it('access_token이 문자열이 아니면 던진다', async () => {
    const exchanger: GitHubTokenExchanger = async () => ({ status: 200, body: { access_token: 12345 } });
    await expect(exchangeGitHubCode(CONFIG, 'code', 'verifier', exchanger)).rejects.toThrow(/문자열/);
  });

  it('요청 자체가 실패하면 감싸서 던진다', async () => {
    const exchanger: GitHubTokenExchanger = async () => {
      throw new Error('ECONNREFUSED');
    };
    await expect(exchangeGitHubCode(CONFIG, 'code', 'verifier', exchanger)).rejects.toThrow(/토큰 교환 요청 실패/);
  });

  /**
   * NFR-005 — 로그에 비밀 0건.
   *
   * 성공 응답과 **같은 자리**에 액세스 토큰이 실리므로, 오류 처리 경로가 응답
   * 본문을 메시지로 옮기면 그것이 곧 토큰 유출 통로가 된다.
   */
  it('오류 메시지에 토큰도 시크릿도 담지 않는다', async () => {
    const exchanger: GitHubTokenExchanger = async () => ({
      status: 200,
      // 거절이면서 토큰까지 실린 최악의 응답을 일부러 만든다.
      body: { error: 'incorrect_client_credentials', access_token: ACCESS_TOKEN, secret: CONFIG.clientSecret },
    });

    const error = await exchangeGitHubCode(CONFIG, 'code', 'verifier', exchanger).catch((e: unknown) => e);
    const message = error instanceof Error ? error.message : String(error);

    expect(message).not.toContain(ACCESS_TOKEN);
    expect(message).not.toContain(CONFIG.clientSecret);
    expect(message).toContain('incorrect_client_credentials');
  });
});

describe('신원과 팀 조회', () => {
  const user = { id: 4021, login: 'kim', email: 'kim@example.com' };

  const team = (org: string, slug: string): Record<string, unknown> => ({
    slug,
    name: slug,
    organization: { login: org, id: 1 },
  });

  /** 호출된 URL을 기록하면서 답을 돌려주는 대역. */
  const reader = (
    routes: { user?: unknown; userStatus?: number; teamPages?: unknown[]; teamStatus?: number },
    seen: string[] = [],
  ): { read: GitHubApiReader; seen: string[]; headers: Record<string, string>[] } => {
    const headers: Record<string, string>[] = [];
    const read: GitHubApiReader = async (url, sent) => {
      seen.push(url);
      headers.push({ ...sent });
      if (url.includes('/user/teams')) {
        const page = Number(new URL(url).searchParams.get('page') ?? '1');
        return { status: routes.teamStatus ?? 200, body: routes.teamPages?.[page - 1] ?? [] };
      }
      return { status: routes.userStatus ?? 200, body: routes.user ?? user };
    };
    return { read, seen, headers };
  };

  it('사용자와 팀을 읽어 org/team 형태로 돌려준다', async () => {
    const { read, seen } = reader({ teamPages: [[team('acme', 'pipe-admins'), team('acme', 'pipe-users')]] });
    const identity = await fetchGitHubIdentity(CONFIG, ACCESS_TOKEN, read);

    expect(identity).toEqual({
      id: 4021,
      login: 'kim',
      email: 'kim@example.com',
      teams: ['acme/pipe-admins', 'acme/pipe-users'],
      teamsTruncated: false,
    });
    expect(seen[0]).toBe('https://ghe.example.com/api/v3/user');
    expect(seen[1]).toContain('/api/v3/user/teams');
  });

  it('사용자 위임 토큰을 Bearer로 보낸다', async () => {
    const { read, headers } = reader({ teamPages: [[]] });
    await fetchGitHubIdentity(CONFIG, ACCESS_TOKEN, read);
    expect(headers[0]?.['authorization']).toBe(`Bearer ${ACCESS_TOKEN}`);
    expect(headers[0]?.['x-github-api-version']).toBe('2022-11-28');
  });

  it('이메일이 없으면 null이다', async () => {
    const { read } = reader({ user: { id: 7, login: 'lee', email: null }, teamPages: [[]] });
    expect((await fetchGitHubIdentity(CONFIG, ACCESS_TOKEN, read)).email).toBeNull();
  });

  /**
   * **`id`는 `app_user.github_user_id`(BIGINT)로 간다.**
   *
   * 실수나 안전 범위 밖 값을 신원으로 쓰면 정본에 들어가는 순간 어긋난다.
   */
  it.each([
    ['문자열', { id: '7', login: 'lee' }],
    ['실수', { id: 7.5, login: 'lee' }],
    ['음수', { id: -7, login: 'lee' }],
    ['0', { id: 0, login: 'lee' }],
    ['없음', { login: 'lee' }],
  ])('id가 %s이면 던진다', async (_label, body) => {
    const { read } = reader({ user: body, teamPages: [[]] });
    await expect(fetchGitHubIdentity(CONFIG, ACCESS_TOKEN, read)).rejects.toThrow(/id/);
  });

  it('login이 없으면 던진다', async () => {
    const { read } = reader({ user: { id: 7 }, teamPages: [[]] });
    await expect(fetchGitHubIdentity(CONFIG, ACCESS_TOKEN, read)).rejects.toThrow(/login/);
  });

  it('사용자 조회가 2xx가 아니면 던진다', async () => {
    const { read } = reader({ userStatus: 401, teamPages: [[]] });
    await expect(fetchGitHubIdentity(CONFIG, ACCESS_TOKEN, read)).rejects.toThrow(/401/);
  });

  it('팀 조회가 2xx가 아니면 던진다 — 역할을 모른 채 넘기지 않는다', async () => {
    const { read } = reader({ teamStatus: 403, teamPages: [[]] });
    await expect(fetchGitHubIdentity(CONFIG, ACCESS_TOKEN, read)).rejects.toThrow(/403/);
  });

  it('페이지가 꽉 차면 다음 페이지를 읽는다', async () => {
    const full = Array.from({ length: 100 }, (_, i) => team('acme', `team-${String(i)}`));
    const { read, seen } = reader({ teamPages: [full, [team('beta', 'late')]] });

    const identity = await fetchGitHubIdentity(CONFIG, ACCESS_TOKEN, read);
    expect(identity.teams).toHaveLength(101);
    expect(identity.teams).toContain('beta/late');
    expect(identity.teamsTruncated).toBe(false);
    expect(seen.filter((url) => url.includes('/user/teams'))).toHaveLength(2);
  });

  it('정원보다 적게 오면 거기서 멈춘다', async () => {
    const { read, seen } = reader({ teamPages: [[team('acme', 'one')]] });
    await fetchGitHubIdentity(CONFIG, ACCESS_TOKEN, read);
    expect(seen.filter((url) => url.includes('/user/teams'))).toHaveLength(1);
  });

  /**
   * **상한이 없으면 느린 응답 하나가 로그인 전체를 매단다.**
   *
   * 상한에 걸린 사실을 감추지 않는다 — 그 뒤 팀에 걸린 역할 매핑은 적용되지 않는다.
   */
  it('페이지 상한에 걸리면 truncated로 알린다', async () => {
    const full = Array.from({ length: 100 }, (_, i) => team('acme', `team-${String(i)}`));
    const { read, seen } = reader({ teamPages: Array.from({ length: 30 }, () => full) });

    const identity = await fetchGitHubIdentity(CONFIG, ACCESS_TOKEN, read);
    expect(identity.teamsTruncated).toBe(true);
    expect(seen.filter((url) => url.includes('/user/teams'))).toHaveLength(20);
  });

  it('중복된 팀을 한 번만 센다', async () => {
    const { read } = reader({ teamPages: [[team('acme', 'dup'), team('acme', 'dup')]] });
    expect((await fetchGitHubIdentity(CONFIG, ACCESS_TOKEN, read)).teams).toEqual(['acme/dup']);
  });

  /**
   * **팀 하나의 모양이 달라졌다고 로그인 전체를 막지 않는다.**
   *
   * 그 대가가 이득보다 크다. 매핑에 쓰이는 팀이라면 역할이 붙지 않는 것으로
   * 드러나고, 그것은 관리자가 고칠 수 있는 증상이다.
   */
  it('모양이 다른 항목은 건너뛰되 나머지를 살린다', async () => {
    const { read } = reader({
      teamPages: [
        [
          { slug: 'no-org' },
          { organization: { login: 'acme' } },
          { slug: '', organization: { login: 'acme' } },
          { slug: 'good', organization: { login: 'acme' } },
          null,
          'nonsense',
        ],
      ],
    });
    expect((await fetchGitHubIdentity(CONFIG, ACCESS_TOKEN, read)).teams).toEqual(['acme/good']);
  });

  it('팀이 하나도 없어도 성립한다 — 기본 역할만 받는다', async () => {
    const { read } = reader({ teamPages: [[]] });
    expect((await fetchGitHubIdentity(CONFIG, ACCESS_TOKEN, read)).teams).toEqual([]);
  });
});

/**
 * 주소 조립 (독립 검토가 찾은 것).
 *
 * **이어 붙이기는 오구성을 오류가 아니라 "말없이 틀린 주소"로 바꾼다.** 기반
 * 주소에 쿼리가 섞이면 실제 경로가 쿼리 값 안으로 삼켜지고, 그 요청은 엉뚱한
 * 곳으로 가면서 성공처럼 보인다. 운영자는 로그인 실패의 원인을 찾지 못한다.
 */
describe('주소 조립이 오구성을 삼키지 않는다', () => {
  const withBase = (base: string): GitHubAuthConfig => ({ ...CONFIG, baseUrl: base });

  it.each([
    ['슬래시 없음', 'https://ghe.example.com'],
    ['슬래시 하나', 'https://ghe.example.com/'],
    ['슬래시 여럿', 'https://ghe.example.com///'],
  ])('뒤 슬래시가 %s이어도 같은 주소다', (_label, base) => {
    expect(gitHubAuthorizationEndpoint(withBase(base))).toBe('https://ghe.example.com/login/oauth/authorize');
    expect(gitHubTokenEndpoint(withBase(base))).toBe('https://ghe.example.com/login/oauth/access_token');
  });

  it('경로가 붙은 기반 주소를 보존한다', () => {
    expect(gitHubAuthorizationEndpoint(withBase('https://host/ghe'))).toBe('https://host/ghe/login/oauth/authorize');
  });

  /** 경로가 쿼리 안으로 삼켜지던 자리다. */
  it('쿼리와 프래그먼트를 경로에 섞지 않는다', () => {
    expect(gitHubAuthorizationEndpoint(withBase('https://ghe.example.com/?x=1'))).toBe(
      'https://ghe.example.com/login/oauth/authorize',
    );
    expect(gitHubAuthorizationEndpoint(withBase('https://ghe.example.com#frag'))).toBe(
      'https://ghe.example.com/login/oauth/authorize',
    );
  });

  it.each(['', '/', 'ghe.example.com', 'not a url'])('절대 URL이 아니면 던진다: %s', (base) => {
    expect(() => gitHubAuthorizationEndpoint(withBase(base))).toThrow(OidcError);
  });
});
