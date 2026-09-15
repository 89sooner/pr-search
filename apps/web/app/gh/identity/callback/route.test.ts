/**
 * Operations App 인가 콜백의 판정 (WP-077 / FR-GH-008 AC-2, CR-086).
 *
 * `auth/callback/route.test.ts`와 같은 이유로 있다 — 라우트 시험이 없으면 세션 확인 한 줄을 빼도
 * 아무 시험도 죽지 않는다. 여기서 거는 것은 넷이다:
 *   - 세션이 없으면 `search-api`를 부르지 않고 로그인으로 보낸다
 *   - `code`·`state`가 없으면 부르지 않는다
 *   - 성공하면 서버의 `return_to`를 **거른 뒤** 보내고, 실패는 한 모양(`/gh?identity=failed`)이다
 *   - `code`·`state`가 로그 어디에도 남지 않는다
 *
 * 대역은 `fetch` 하나와 세션 저장소뿐이다 — 그 사이의 실제 코드가 전부 돈다.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('server-only', () => ({}));

/** 세션 저장소 대역. `sessions`에 있는 ID만 살아 있다. */
const sessions = new Map<string, { readonly session: { readonly userId: string } }>();
vi.mock('../../../../lib/server/session', () => ({
  sessionStore: () => ({
    load: async (id: string) => sessions.get(id) ?? null,
  }),
}));

const { GET } = await import('./route.js');

const ENV: Record<string, string> = {
  NODE_ENV: 'production',
  SESSION_COOKIE_SECURE: 'true',
  AUTH_ENABLED: 'true',
  SESSION_LOGIN_PATH: '/auth/login',
  SEARCH_API_URL: 'http://search-api.test:3002',
};

const CODE = 'code-should-never-be-logged-8f3a';
const STATE = 'state-should-never-be-logged-Ab12Cd34Ef56';

interface Upstream {
  readonly status?: number;
  readonly body?: unknown;
  readonly throws?: boolean;
}

function stubFetch(upstream: Upstream = {}): { readonly calls: { url: string; init: RequestInit | undefined }[] } {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  vi.stubGlobal('fetch', async (input: string | URL, init?: RequestInit): Promise<Response> => {
    calls.push({ url: typeof input === 'string' ? input : input.toString(), init });
    if (upstream.throws === true) throw new Error('ECONNREFUSED');
    return new Response(JSON.stringify(upstream.body ?? { status: 'connected', github_login: 'alice', return_to: '/gh', correlation_id: 'c-up' }), {
      status: upstream.status ?? 200,
      headers: { 'content-type': 'application/json' },
    });
  });
  return { calls };
}

function request(options: { code?: string; state?: string; sessionId?: string; origin?: string } = {}): NextRequest {
  const url = new URL('/gh/identity/callback', options.origin ?? 'https://prs.example.com');
  if (options.code !== undefined) url.searchParams.set('code', options.code);
  if (options.state !== undefined) url.searchParams.set('state', options.state);
  const next = new NextRequest(url);
  if (options.sessionId !== undefined) next.cookies.set('__Host-prs_session', options.sessionId);
  return next;
}

let logged: string[] = [];

beforeEach(() => {
  sessions.clear();
  sessions.set('sid-alice', { session: { userId: 'u-alice' } });
  logged = [];
  for (const [key, value] of Object.entries(ENV)) vi.stubEnv(key, value);
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    logged.push(args.map(String).join(' '));
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('FR-GH-008 AC-2: 콜백은 세션이 있는 사용자의 것만 서버에 넘긴다', () => {
  it('세션이 없으면 search-api를 부르지 않고 로그인으로 보낸다 — 코드는 버린다', async () => {
    const { calls } = stubFetch();
    const response = await GET(request({ code: CODE, state: STATE }));
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('/auth/login?return_to=%2Fgh');
    expect(calls).toHaveLength(0);
  });

  it('위조된 세션 쿠키도 같다 — 저장소에 없는 ID는 세션이 아니다', async () => {
    const { calls } = stubFetch();
    const response = await GET(request({ code: CODE, state: STATE, sessionId: 'sid-forged' }));
    expect(response.headers.get('location')).toContain('/auth/login');
    expect(calls).toHaveLength(0);
  });

  it('code나 state가 없으면 부르지 않고 실패 한 모양으로 보낸다', async () => {
    const { calls } = stubFetch();
    for (const partial of [{ state: STATE }, { code: CODE }, {}]) {
      const response = await GET(request({ ...partial, sessionId: 'sid-alice' }));
      expect(response.headers.get('location')).toBe('/gh?identity=failed');
    }
    expect(calls).toHaveLength(0);
  });

  it('세션이 있으면 세션 쿠키만 다시 조립해 code·state를 본문으로 넘긴다', async () => {
    const { calls } = stubFetch();
    const response = await GET(request({ code: CODE, state: STATE, sessionId: 'sid-alice' }));

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('http://search-api.test:3002/api/v1/gh/identity/callback');
    expect(calls[0]?.init?.method).toBe('POST');
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ code: CODE, state: STATE });
    const headers = new Headers(calls[0]?.init?.headers);
    expect(headers.get('cookie')).toBe('__Host-prs_session=sid-alice');
    expect(headers.get('content-type')).toBe('application/json');
    // 신원을 주장하는 헤더는 만들지 않는다 (CR-018, DEV-067).
    expect(headers.get('x-user-id')).toBeNull();
    expect(headers.get('authorization')).toBeNull();

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('/gh');
  });

  it('서버의 return_to를 한 번 더 거른다 — 외부 URL로 보내지 않는다', async () => {
    stubFetch({ body: { status: 'connected', github_login: 'alice', return_to: 'https://evil.example/phish', correlation_id: 'c' } });
    const response = await GET(request({ code: CODE, state: STATE, sessionId: 'sid-alice' }));
    expect(response.headers.get('location')).toBe('/gh');

    stubFetch({ body: { status: 'connected', github_login: 'alice', return_to: '/gh/history', correlation_id: 'c' } });
    const ok = await GET(request({ code: CODE, state: STATE, sessionId: 'sid-alice' }));
    expect(ok.headers.get('location')).toBe('/gh/history');
  });

  it('서버가 거절하면(state 불일치 등) 실패 한 모양이며 사유는 로그에만 간다', async () => {
    stubFetch({ status: 401, body: { error: { code: 'GH_IDENTITY_REQUIRED', message: 'GitHub 계정 연결에 실패했다', detail: { reason: 'state_mismatch' } }, correlation_id: 'c-fail' } });
    const response = await GET(request({ code: CODE, state: STATE, sessionId: 'sid-alice' }));
    expect(response.headers.get('location')).toBe('/gh?identity=failed');
    expect(logged.join('\n')).toContain('state_mismatch');
  });

  it('search-api에 닿지 못해도 실패 한 모양이다', async () => {
    stubFetch({ throws: true });
    const response = await GET(request({ code: CODE, state: STATE, sessionId: 'sid-alice' }));
    expect(response.headers.get('location')).toBe('/gh?identity=failed');
  });

  it('code·state는 어느 경로에서도 로그에 남지 않는다', async () => {
    stubFetch({ status: 401, body: { error: { code: 'GH_IDENTITY_REQUIRED', message: 'x', detail: { reason: 'state_mismatch' } } } });
    await GET(request({ code: CODE, state: STATE, sessionId: 'sid-alice' }));
    await GET(request({ code: CODE, state: STATE }));
    await GET(request({ state: STATE, sessionId: 'sid-alice' }));
    const everything = logged.join('\n');
    expect(everything).not.toContain(CODE);
    expect(everything).not.toContain(STATE);
    expect(everything).toContain('Operations App 인가 콜백을 완료하지 못했다');
  });
});

/**
 * **역방향 프록시 뒤에서 `localhost:3000`으로 보내지 않는다** (CR-092 / DEV-699).
 *
 * 사내 `0.1.0-pilot.7` 이미지에 `Host: prs.corp.example`로 이 콜백을 걸어 `location: https://localhost:3000/gh?identity=failed`를
 * 실측했다. 라우트가 보는 출처가 그 값이어도 세 갈래(실패·로그인·성공) 모두 호스트 없는 경로여야 한다.
 */
describe('복귀 주소에 호스트를 싣지 않는다 (CR-092 / DEV-699)', () => {
  const behindProxy = 'https://localhost:3000';

  it('실패·로그인·성공 세 갈래 모두 상대 경로다', async () => {
    stubFetch();
    const failed = await GET(request({ origin: behindProxy }));
    const login = await GET(request({ code: CODE, state: STATE, origin: behindProxy }));
    const connected = await GET(request({ code: CODE, state: STATE, sessionId: 'sid-alice', origin: behindProxy }));

    expect(failed.headers.get('location')).toBe('/gh?identity=failed');
    expect(login.headers.get('location')).toBe('/auth/login?return_to=%2Fgh');
    expect(connected.headers.get('location')).toBe('/gh');
    for (const response of [failed, login, connected]) {
      expect(response.status).toBe(307);
      expect(response.headers.get('location')).not.toMatch(/^[a-z]+:|^\/\//i);
    }
  });
});
