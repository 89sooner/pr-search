/**
 * 로그아웃 라우트 (FR-AUTH-001 AC-5, CR-091).
 *
 * 이 라우트에는 라우트 시험이 없었다. CR-091이 두 가지를 바꿨으므로 여기서 건다.
 *
 *   1. 평문 HTTP 파일럿에서는 브라우저의 쿠키 이름이 `prs_session`이다 — 그 이름으로 읽고 그 이름으로 지운다.
 *   2. 같은 이름의 세션 쿠키가 둘 이상이면 **전부** 서버에서 끝낸다 — 어느 것이 이 사용자의 세션인지 모른다.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('server-only', () => ({}));

const destroyed: string[] = [];

vi.mock('../../../lib/server/session', () => ({
  sessionStore: () => ({
    destroy: async (sessionId: string) => {
      destroyed.push(sessionId);
    },
  }),
}));

const { POST } = await import('./route.js');

const logout = (cookie: string | undefined, origin = 'https://prs.example.com'): NextRequest =>
  new NextRequest(new URL('/auth/logout', origin), {
    method: 'POST',
    ...(cookie === undefined ? {} : { headers: { cookie } }),
  });

beforeEach(() => {
  destroyed.length = 0;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('로그아웃이 서버 세션을 끝낸다 (AC-5)', () => {
  it('TLS 배포는 __Host- 이름으로 읽고 Secure로 지운다', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('SESSION_COOKIE_SECURE', 'true');

    const response = await POST(logout('__Host-prs_session=sess-a'));

    expect(destroyed).toEqual(['sess-a']);
    const cleared = response.headers.getSetCookie().join('\n');
    expect(cleared).toContain('__Host-prs_session=;');
    expect(cleared).toContain('Secure');
  });

  it('평문 HTTP 파일럿은 접두 없는 이름으로 읽고 지운다 — __Host- 쿠키를 지우는 척하지 않는다 (CR-091)', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('AUTH_ENABLED', 'true');
    vi.stubEnv('SESSION_COOKIE_SECURE', 'false');
    vi.stubEnv('ALLOW_INSECURE_COOKIES', 'true');

    const response = await POST(logout('prs_session=sess-b', 'http://prs.intra'));

    expect(destroyed).toEqual(['sess-b']);
    const cleared = response.headers.getSetCookie().join('\n');
    expect(cleared).toContain('prs_session=;');
    expect(cleared).not.toContain('__Host-');
    expect(cleared).not.toContain('Secure');
  });

  it('**같은 이름의 세션 쿠키가 여럿이면 전부 끝낸다** — 하나도 지우지 않으면 피해자의 세션이 남는다', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('AUTH_ENABLED', 'true');
    vi.stubEnv('SESSION_COOKIE_SECURE', 'false');
    vi.stubEnv('ALLOW_INSECURE_COOKIES', 'true');

    await POST(logout('prs_session=victim; theme=dark; prs_session=planted', 'http://prs.intra'));

    expect(destroyed.sort()).toEqual(['planted', 'victim']);
  });

  it('세션 쿠키가 없으면 아무것도 끝내지 않고 지우는 쿠키만 보낸다', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('SESSION_COOKIE_SECURE', 'true');

    const response = await POST(logout(undefined));

    expect(destroyed).toEqual([]);
    expect(response.headers.getSetCookie().join('\n')).toContain('Max-Age=0');
  });
});
