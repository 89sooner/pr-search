/**
 * 콜백이 신원을 어떻게 정하는가 (`CR-083`).
 *
 * ## 왜 이 파일이 필요한가
 *
 * 독립 검토가 지적한 공백이다. `github-oauth.ts`의 시험은 `fetchGitHubIdentity`가
 * **무엇을 돌려주는지**를 건다. 그런데 이 판의 보안 결정은 그 값을 **어디에 쓰는지**에
 * 있다 — `userId`에 숫자 id를 쓰는가 `login`을 쓰는가, 접두를 붙이는가, 역할을 어느
 * 매핑으로 합성하는가.
 *
 * 그 선택을 거는 시험이 없으면 `userId: identity.login`으로 되돌려도 **아무 시험도
 * 죽지 않는다.** 그것이 바로 이 판이 막으려는 취약점(개명자가 남의 이력을
 * 물려받는다)이다.
 *
 * ## 대역을 `fetch` 하나로 좁힌 이유
 *
 * 토큰 교환과 신원 조회를 각각 대역으로 바꾸면 그 사이의 실제 코드가 돌지 않는다.
 * `fetch`만 바꾸면 인가 코드 → 토큰 → `/user` → `/user/teams` → 역할 합성 →
 * 세션 발급이 **전부 실제 경로로** 흐른다. 이 저장소가 「대역이 실제보다 관대하면
 * 그만큼이 사각지대다」로 여러 번 겪은 것에 대한 대응이다.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createAuthorizationRequest, type SessionRecord } from '@prs/authz';

vi.mock('server-only', () => ({}));

/** 발급된 세션을 여기 모은다. */
const created: SessionRecord[] = [];

vi.mock('../../../lib/server/session', () => ({
  sessionStore: () => ({
    create: async (session: SessionRecord) => {
      created.push(session);
    },
  }),
}));

const { GET } = await import('./route.js');
const { encodeRoundTrip } = await import('../../../lib/oidc-state.js');

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

const ACCESS_TOKEN = 'gho_test_0000111122223333';

/** `/user`와 `/user/teams`가 무엇을 답할지 정해 두고 `fetch`를 가로챈다. */
function stubFetch(options: {
  user?: Record<string, unknown>;
  teams?: Record<string, unknown>[];
  tokenBody?: Record<string, unknown>;
  tokenStatus?: number;
}): { readonly calls: string[] } {
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    async (input: string | URL, init?: { method?: string }): Promise<Response> => {
      const url = typeof input === 'string' ? input : input.toString();
      calls.push(url);

      if (init?.method === 'POST') {
        return new Response(JSON.stringify(options.tokenBody ?? { access_token: ACCESS_TOKEN }), {
          status: options.tokenStatus ?? 200,
        });
      }
      if (url.includes('/user/teams')) {
        return new Response(JSON.stringify(options.teams ?? []), { status: 200 });
      }
      return new Response(JSON.stringify(options.user ?? { id: 4021, login: 'kim', email: 'kim@example.com' }), {
        status: 200,
      });
    },
  );
  return { calls };
}

/** 왕복 쿠키와 `state`를 맞춘 콜백 요청. */
function callbackRequest(): { request: NextRequest; state: string } {
  const authorization = createAuthorizationRequest('/search?q=abc');
  const request = new NextRequest(
    new URL(`/auth/callback?code=test-code&state=${authorization.state}`, 'https://prs.example.com'),
  );
  request.cookies.set('__Host-prs_oidc', encodeRoundTrip(authorization));
  return { request, state: authorization.state };
}

beforeEach(() => {
  created.length = 0;
  for (const [key, value] of Object.entries(GHE_ENV)) vi.stubEnv(key, value);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('CR-083: GHE 콜백이 신원을 정하는 방식', () => {
  /**
   * **이 시험이 지키는 것이 이 판의 핵심 보안 선택이다.**
   *
   * `userId`를 `login`으로 되돌리면 여기서 죽는다. GHE에서 로그인 이름은 바뀔 수
   * 있고, 그것을 키로 쓰면 개명한 사람이 남의 저장 검색과 감사 이력을 물려받는다.
   */
  it('세션 키를 숫자 id에 공급자 접두를 붙여 만든다 — login이 아니다', async () => {
    stubFetch({ user: { id: 4021, login: 'kim', email: null } });

    const response = await GET(callbackRequest().request);

    expect(response.status).toBe(307);
    expect(created).toHaveLength(1);
    expect(created[0]?.userId).toBe('github:4021');
    expect(created[0]?.userId).not.toBe('kim');
    expect(created[0]?.login).toBe('kim');
    expect(created[0]?.githubUserId).toBe(4021);
  });

  /**
   * **접두가 OIDC `sub`와의 충돌을 막는다.**
   *
   * `app_user.user_id`는 하나의 TEXT 공간이다. 사내 IdP가 사번처럼 숫자 문자열을
   * `sub`로 쓰면, 접두 없이는 GHE 사용자의 등록이 다른 사람의 행을 덮는다.
   */
  it('접두 없는 숫자 문자열을 세션 키로 쓰지 않는다', async () => {
    stubFetch({ user: { id: 7, login: 'lee' } });

    await GET(callbackRequest().request);

    expect(created[0]?.userId).not.toBe('7');
    expect(created[0]?.userId).toMatch(/^github:/);
  });

  it('팀 멤버십에서 역할을 합성한다', async () => {
    vi.stubEnv('GHE_TEAM_ROLE_MAP', 'acme/pipe-admins:manager');
    stubFetch({
      user: { id: 4021, login: 'kim' },
      teams: [{ slug: 'pipe-admins', organization: { login: 'acme' } }],
    });

    await GET(callbackRequest().request);

    expect(created[0]?.roles).toContain('manager');
    // 기본 역할은 언제나 붙는다.
    expect(created[0]?.roles).toContain('developer');
  });

  it('매핑에 없는 팀은 역할을 주지 않는다', async () => {
    vi.stubEnv('GHE_TEAM_ROLE_MAP', 'acme/pipe-admins:manager');
    stubFetch({
      user: { id: 4021, login: 'kim' },
      teams: [{ slug: 'other-team', organization: { login: 'acme' } }],
    });

    await GET(callbackRequest().request);

    expect(created[0]?.roles).toEqual(['developer']);
  });

  /** 사용자 위임 토큰으로 묻는다. 설치 자격으로 물으면 더 넓은 답이 온다. */
  it('발급받은 액세스 토큰으로 사용자와 팀을 읽는다', async () => {
    const { calls } = stubFetch({ user: { id: 4021, login: 'kim' } });

    await GET(callbackRequest().request);

    expect(calls[0]).toContain('/login/oauth/access_token');
    expect(calls[1]).toContain('/api/v3/user');
    expect(calls[2]).toContain('/api/v3/user/teams');
  });

  it('세션 쿠키와 원래 경로로 복귀한다', async () => {
    stubFetch({ user: { id: 4021, login: 'kim' } });

    const response = await GET(callbackRequest().request);

    expect(response.headers.get('location')).toBe('https://prs.example.com/search?q=abc');

    // 쿠키가 둘 나간다 — `get`은 그중 하나만 돌려주므로 목록으로 본다.
    const cookies = response.headers.getSetCookie();
    expect(cookies.some((one) => one.includes('__Host-prs_session')), '세션 쿠키가 없다').toBe(true);
    expect(
      cookies.some((one) => one.includes('__Host-prs_oidc=;') || one.includes('Max-Age=0')),
      '왕복 쿠키를 지우지 않았다 — 같은 state로 다시 시도할 수 있다',
    ).toBe(true);
  });
});

/**
 * 평문 HTTP 파일럿의 로그인 왕복 (`CR-091` / `DEV-694`).
 *
 * 사내 `0.1.0-pilot.6`은 `http://` 주소로 GHE 로그인을 시험했고 콜백이 「왕복 쿠키가 없거나
 * 읽을 수 없다」로 끝났다. 이 묶음은 **로그인 라우트가 실제로 낸 `Set-Cookie`를 브라우저처럼
 * 되돌려 보내** 콜백까지 흐르게 한다. 두 가지를 함께 건다: `Secure`가 없는 쿠키에 `__Host-`
 * 접두가 붙지 않는다(붙으면 브라우저가 버린다), 세운 이름과 읽는 이름이 같다.
 */
describe('CR-091: ALLOW_INSECURE_COOKIES 배포의 로그인 왕복', () => {
  const PILOT_ENV: Record<string, string> = {
    ...GHE_ENV,
    SESSION_COOKIE_SECURE: 'false',
    ALLOW_INSECURE_COOKIES: 'true',
    GHE_OAUTH_REDIRECT_URI: 'http://prs.intra/auth/callback',
  };

  /** `Set-Cookie` 한 줄을 브라우저가 돌려보낼 `name=value`로 줄인다. 브라우저의 거부 규칙도 흉내 낸다. */
  function asBrowserCookie(setCookie: string): string {
    const [pair = '', ...attributes] = setCookie.split(';').map((part) => part.trim());
    const secure = attributes.some((attribute) => attribute.toLowerCase() === 'secure');
    // RFC 6265bis: `__Host-`·`__Secure-` 접두 쿠키는 `Secure` 없이 저장되지 않는다.
    if (!secure && /^__(Host|Secure)-/.test(pair)) throw new Error(`브라우저가 버리는 쿠키다: ${setCookie}`);
    return pair;
  }

  it('로그인이 세운 왕복 쿠키로 콜백이 세션을 발급하고, 두 쿠키 모두 브라우저가 받는 모양이다', async () => {
    for (const [key, value] of Object.entries(PILOT_ENV)) vi.stubEnv(key, value);
    stubFetch({ user: { id: 4021, login: 'kim' } });
    const login = await import('../login/route.js');

    const started = login.GET(new NextRequest(new URL('/auth/login?return_to=/search', 'http://prs.intra')));
    const roundTripSetCookie = started.headers.getSetCookie().find((one) => one.includes('prs_oidc')) ?? '';
    const roundTripCookie = asBrowserCookie(roundTripSetCookie);
    expect(roundTripCookie.startsWith('prs_oidc=')).toBe(true);
    const state = new URL(started.headers.get('location') ?? '').searchParams.get('state') ?? '';

    const callback = await GET(
      new NextRequest(new URL(`/auth/callback?code=test-code&state=${state}`, 'http://prs.intra'), {
        headers: { cookie: roundTripCookie },
      }),
    );

    expect(callback.status).toBe(307);
    expect(created).toHaveLength(1);
    const cookies = callback.headers.getSetCookie();
    const session = cookies.find((one) => one.startsWith('prs_session='));
    expect(session, '세션 쿠키가 접두 없는 이름으로 나가지 않았다').toBeDefined();
    expect(asBrowserCookie(session ?? '')).toBe(`prs_session=${created[0]?.sessionId ?? ''}`);
    expect(cookies.join('\n')).not.toContain('__Host-');
  });

  it('TLS 배포의 쿠키 이름은 그대로다 — 이미 로그인한 사용자의 세션이 끊기지 않는다', async () => {
    stubFetch({ user: { id: 4021, login: 'kim' } });

    const response = await GET(callbackRequest().request);

    const cookies = response.headers.getSetCookie();
    expect(cookies.some((one) => one.startsWith('__Host-prs_session=') && one.includes('Secure'))).toBe(true);
  });
});

describe('CR-083: 콜백 실패가 한 가지 모양으로만 보인다', () => {
  const failures: [string, () => NextRequest][] = [
    [
      'state 불일치',
      () => {
        const { request } = callbackRequest();
        return new NextRequest(new URL('/auth/callback?code=c&state=wrong', 'https://prs.example.com'), {
          headers: { cookie: request.headers.get('cookie') ?? '' },
        });
      },
    ],
    [
      '왕복 쿠키 없음',
      () => new NextRequest(new URL('/auth/callback?code=c&state=s', 'https://prs.example.com')),
    ],
    [
      '코드 없음',
      () => {
        const authorization = createAuthorizationRequest('/');
        const request = new NextRequest(
          new URL(`/auth/callback?state=${authorization.state}`, 'https://prs.example.com'),
        );
        request.cookies.set('__Host-prs_oidc', encodeRoundTrip(authorization));
        return request;
      },
    ],
  ];

  it.each(failures)('%s이면 401이고 세션을 만들지 않는다', async (_label, build) => {
    stubFetch({});
    const response = await GET(build());

    expect(response.status).toBe(401);
    expect(created).toHaveLength(0);
    const body = (await response.json()) as { error: { code: string }; correlation_id: string };
    expect(body.error.code).toBe('UNAUTHENTICATED');
    expect(body.correlation_id).toBeTruthy();
  });

  it('토큰 교환이 200과 함께 error를 주면 401이다', async () => {
    stubFetch({ tokenBody: { error: 'bad_verification_code' } });

    const response = await GET(callbackRequest().request);

    expect(response.status).toBe(401);
    expect(created).toHaveLength(0);
  });

  it('사용자 조회가 실패하면 401이다', async () => {
    stubFetch({ user: { login: 'no-id' } });

    expect((await GET(callbackRequest().request)).status).toBe(401);
    expect(created).toHaveLength(0);
  });

  /**
   * **사용자에게 말하지 않는 것과 아무 데도 적지 않는 것은 다르다.**
   *
   * 운영자가 사용자에게서 받은 상관 ID로 뒤질 곳이 있어야 한다.
   */
  it('실패 이유를 상관 ID와 함께 로그에 남긴다', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    stubFetch({ tokenBody: { error: 'bad_verification_code' } });

    const response = await GET(callbackRequest().request);
    const body = (await response.json()) as { correlation_id: string };

    const lines = logged.mock.calls.map((call) => String(call[0]));
    const matched = lines.find((line) => line.includes(body.correlation_id));
    expect(matched, '상관 ID가 로그에 없다 — 운영자가 뒤질 곳이 없다').toBeDefined();
    expect(matched).toContain('bad_verification_code');
  });

  /** 응답은 이유를 말하지 않는다 (NFR-005). */
  it('응답 본문에 실패 이유를 싣지 않는다', async () => {
    stubFetch({ tokenBody: { error: 'bad_verification_code' } });

    const raw = await (await GET(callbackRequest().request)).text();

    expect(raw).not.toContain('bad_verification_code');
    expect(raw).not.toContain(ACCESS_TOKEN);
  });
});
