/**
 * 화면의 실효 역할 (`CR-091` / `DEV-695`, API-AUTH-001).
 *
 * 관문이 세션 레코드의 역할을 직접 읽어, 관리자가 지정한 `operator`가 화면에 끝내 나타나지
 * 않았다. 여기서 거는 것은 셋이다.
 *
 *   1. `/me`가 준 역할을 쓴다 — 세션 레코드보다 우선한다
 *   2. 실패하면 세션의 역할로 그린다 — 더 보이는 쪽이 아니라 덜 보이는 쪽이다
 *   3. 요청이 프록시와 같은 규칙으로 나간다 — 세션 쿠키만 다시 조립한다
 */

import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { resolveEffectiveRoles } = await import('./effective-roles.js');

const INPUT = {
  searchApiUrl: 'http://search-api:3002',
  sessionId: 'session-abc',
  sessionRoles: ['developer', 'manager'],
} as const;

interface Call {
  readonly url: string;
  readonly init: RequestInit | undefined;
}

function fakeFetch(respond: () => Response | Promise<Response>): { readonly fetch: typeof fetch; readonly calls: Call[] } {
  const calls: Call[] = [];
  const impl = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    calls.push({ url: String(url), init });
    return respond();
  };
  return { fetch: impl as typeof fetch, calls };
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('DEV-695: 관문이 /me의 실효 역할을 쓴다', () => {
  it('/me가 준 역할을 쓴다 — 세션에 없는 관리자 지정 operator가 화면에 온다', async () => {
    const { fetch } = fakeFetch(() => json({ roles: ['developer', 'manager', 'operator'] }));

    expect(await resolveEffectiveRoles(INPUT, { fetch, log: () => undefined })).toEqual([
      'developer',
      'manager',
      'operator',
    ]);
  });

  it('/me가 operator를 주지 않으면 세션에 무엇이 있든 주지 않는다 — 회수가 화면에도 반영된다', async () => {
    const { fetch } = fakeFetch(() => json({ roles: ['developer'] }));

    expect(await resolveEffectiveRoles({ ...INPUT, sessionRoles: ['developer', 'operator'] }, { fetch })).toEqual([
      'developer',
    ]);
  });

  it('search-api의 /me로 세션 쿠키만 실어 묻는다', async () => {
    const { fetch, calls } = fakeFetch(() => json({ roles: ['developer'] }));

    await resolveEffectiveRoles(INPUT, { fetch });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('http://search-api:3002/api/v1/me');
    const headers = new Headers(calls[0]?.init?.headers);
    // 서비스 사이에는 정본 이름이다 — 브라우저가 평문 HTTP 파일럿의 접두 없는 이름을 가져도 같다.
    expect(headers.get('cookie')).toBe('__Host-prs_session=session-abc');
    expect(headers.get('x-correlation-id')).not.toBeNull();
    expect(calls[0]?.init?.cache).toBe('no-store');
    expect(calls[0]?.init?.signal).toBeInstanceOf(AbortSignal);
  });

  it.each([
    ['401', () => json({ error: { code: 'UNAUTHENTICATED' } }, 401)],
    ['503', () => json({ error: { code: 'PERMISSION_UNAVAILABLE' } }, 503)],
    ['형식이 다른 본문', () => json({ roles: 'operator' })],
    ['역할이 아닌 원소', () => json({ roles: ['developer', 7] })],
    ['JSON이 아닌 본문', () => new Response('<html>', { status: 200 })],
  ])('%s면 세션의 역할로 그리고 원인을 남긴다', async (_name, respond) => {
    const { fetch } = fakeFetch(respond);
    const log = vi.fn();

    expect(await resolveEffectiveRoles(INPUT, { fetch, log })).toEqual(['developer', 'manager']);
    expect(log).toHaveBeenCalledTimes(1);
    expect(String(log.mock.calls[0]?.[0])).toContain('DEV-695');
  });

  /**
   * **성공이 아닌 응답의 본문은 역할의 근거가 아니다.** 앞 시험의 오류 본문에는 `roles`가 없어서, 상태 코드를 보지 않고
   * 본문을 읽는 구현도 「형식이 다르다」로 같은 결과를 냈다(변이 D2가 살아남았다). 본문에 역할이 실린 비정상 응답으로 건다.
   */
  it.each([401, 403, 404, 502])('%i 응답에 roles가 실려 있어도 믿지 않는다', async (status) => {
    const { fetch } = fakeFetch(() => json({ roles: ['developer', 'operator'] }, status));
    const log = vi.fn();

    expect(await resolveEffectiveRoles(INPUT, { fetch, log })).toEqual(['developer', 'manager']);
    expect(log.mock.calls[0]?.[1]).toMatchObject({ reason: 'rejected', status });
  });

  it('search-api에 닿지 못하면 세션의 역할로 그린다', async () => {
    const log = vi.fn();
    const failing = (async () => {
      throw new TypeError('fetch failed');
    }) as typeof fetch;

    expect(await resolveEffectiveRoles(INPUT, { fetch: failing, log })).toEqual(['developer', 'manager']);
    expect(log.mock.calls[0]?.[1]).toMatchObject({ reason: 'TypeError' });
  });

  it('상한을 넘기면 기다리지 않고 세션의 역할로 그린다', async () => {
    const log = vi.fn();
    const hanging = ((_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
      })) as typeof fetch;

    const started = Date.now();
    expect(await resolveEffectiveRoles(INPUT, { fetch: hanging, log, timeoutMs: 20 })).toEqual(['developer', 'manager']);
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(log).toHaveBeenCalledTimes(1);
  });

  it('로그에 신원·역할 값을 싣지 않는다 (NFR-005)', async () => {
    const { fetch } = fakeFetch(() => json({}, 500));
    const log = vi.fn();

    await resolveEffectiveRoles(INPUT, { fetch, log });

    const detail = JSON.stringify(log.mock.calls[0]?.[1]);
    expect(detail).not.toContain('session-abc');
    expect(detail).not.toContain('manager');
  });

  it('역할이 아닌 값을 권한으로 만들지 않는다', async () => {
    const { fetch } = fakeFetch(() => json({ roles: ['developer', 'admin', 'OPERATOR'] }));

    expect(await resolveEffectiveRoles(INPUT, { fetch })).toEqual(['developer']);
  });
});
