/**
 * 프록시 규칙 (WP-015 / CR-018 DEV-067, ADR-008).
 *
 * 무엇을 전달하고 무엇을 막는가는 **보안 판정**이다. Next.js 런타임 없이
 * 직접 건다 — 라우트를 통해서만 확인할 수 있으면 판정 자체를 못 건다.
 */

import { describe, expect, it } from 'vitest';
import { SESSION_COOKIE_NAME } from '@prs/authz';
import {
  CORRELATION_HEADER,
  FORBIDDEN_IDENTITY_HEADERS,
  buildProxyHeaders,
  buildResponseHeaders,
  buildUpstreamUrl,
  readBrowserCookie,
  readBrowserCookieValues,
  resolveProxyAuth,
} from './proxy';

function proxied(clientHeaders: Record<string, string>): Headers {
  return buildProxyHeaders({
    headers: new Headers(clientHeaders),
    sessionId: 'sess-123',
    correlationId: 'corr-abc',
  });
}

describe('DEV-067: 신원을 주장하는 헤더를 만들지 않는다', () => {
  it('클라이언트가 보낸 신원 헤더를 **전부 버린다**', () => {
    const headers = proxied({
      'x-user-id': 'attacker',
      'x-forwarded-user': 'attacker',
      'x-roles': 'operator',
      authorization: 'Bearer stolen',
      'x-access-scope': '{"repositoryIds":[1]}',
    });

    for (const name of FORBIDDEN_IDENTITY_HEADERS) {
      expect(headers.has(name), name).toBe(false);
    }
  });

  it('프록시가 스스로도 신원 헤더를 만들지 않는다', () => {
    // 예전 문서는 "사용자 식별 헤더 부착"이었다. search-api는 그것을 401로 거절한다.
    const headers = proxied({});
    for (const name of FORBIDDEN_IDENTITY_HEADERS) {
      expect(headers.has(name), name).toBe(false);
    }
  });

  it('접근 범위를 전달하지 않는다 — 서버가 세션으로 판정한다 (ADR-008)', () => {
    expect(proxied({ 'x-access-scope': '{"orgIds":[1]}' }).has('x-access-scope')).toBe(false);
  });

  it('신원은 **세션 쿠키가 나른다**', () => {
    expect(proxied({}).get('cookie')).toBe(`${SESSION_COOKIE_NAME}=sess-123`);
  });
});

describe('쿠키를 다시 조립한다', () => {
  it('세션 외의 쿠키는 넘어가지 않는다', () => {
    // 클라이언트의 `Cookie`를 그대로 넘기면 분석 도구·실험 플래그까지 샌다.
    const headers = proxied({
      cookie: `analytics=abc; ${SESSION_COOKIE_NAME}=other; experiment=on`,
    });

    expect(headers.get('cookie')).toBe(`${SESSION_COOKIE_NAME}=sess-123`);
    expect(headers.get('cookie')).not.toContain('analytics');
    expect(headers.get('cookie')).not.toContain('experiment');
  });

  it('클라이언트가 다른 세션 값을 주장해도 서버가 정한 것이 이긴다', () => {
    const headers = proxied({ cookie: `${SESSION_COOKIE_NAME}=forged` });
    expect(headers.get('cookie')).toBe(`${SESSION_COOKIE_NAME}=sess-123`);
  });
});

describe('허용 목록이 좁다', () => {
  it('내용 협상 헤더만 넘어간다', () => {
    const headers = proxied({
      accept: 'application/json',
      'accept-language': 'ko',
      'content-type': 'application/json',
      'user-agent': 'evil/1.0',
      referer: 'https://elsewhere.example',
      'x-custom': 'anything',
    });

    expect(headers.get('accept')).toBe('application/json');
    expect(headers.get('accept-language')).toBe('ko');
    expect(headers.get('content-type')).toBe('application/json');
    expect(headers.has('user-agent')).toBe(false);
    expect(headers.has('referer')).toBe(false);
    expect(headers.has('x-custom')).toBe(false);
  });

  it('쓰기 요청의 중복 방지 키는 넘어간다 — 신원이 아니며 서버가 사용자별로 묶는다 (DEV-690, FR-GH-012 AC-5)', () => {
    /*
     * W-010의 실행 요청과 운영 정책 변경은 `Idempotency-Key` 헤더로 키를 보낸다. 허용 목록에서 빠져 있어 실제 프록시를 지나면
     * 키가 사라지고 search-api가 400을 냈다 — e2e는 브라우저에서 응답을 목킹하고 통합 시험은 search-api를 직접 불러 드러나지
     * 않았다(CR-090 준비 중 코드 판독으로 발견, 이 시험으로 재현).
     */
    const headers = proxied({ 'Idempotency-Key': 'req-0001-alpha', 'content-type': 'application/json' });
    expect(headers.get('idempotency-key')).toBe('req-0001-alpha');
    expect(FORBIDDEN_IDENTITY_HEADERS).not.toContain('idempotency-key');
  });

  it('대소문자를 가리지 않고 막는다', () => {
    expect(proxied({ 'X-User-Id': 'attacker' }).has('x-user-id')).toBe(false);
  });

  it('상관 ID를 싣는다', () => {
    expect(proxied({}).get(CORRELATION_HEADER)).toBe('corr-abc');
  });
});

describe('응답 헤더', () => {
  it('백엔드의 `Set-Cookie`를 넘기지 않는다', () => {
    // 세션 발급은 `web`의 몫이다. 백엔드가 쿠키를 세우면 두 곳이 세션을 소유한다.
    const upstream = new Headers({
      'content-type': 'application/json',
      'set-cookie': 'evil=1',
      'x-internal-node': 'es-3',
    });
    const headers = buildResponseHeaders(upstream, 'corr-abc');

    expect(headers.get('content-type')).toBe('application/json');
    expect(headers.has('set-cookie')).toBe(false);
    expect(headers.has('x-internal-node')).toBe(false);
  });

  it('상관 ID를 클라이언트에게 돌려준다 — 문의할 때 쓴다', () => {
    expect(buildResponseHeaders(new Headers(), 'corr-abc').get(CORRELATION_HEADER)).toBe('corr-abc');
  });
});

describe('대상 URL', () => {
  it('`/api/v1` 아래로 붙인다', () => {
    expect(buildUpstreamUrl('http://search-api:3002', ['search'], '?q=a')).toBe(
      'http://search-api:3002/api/v1/search?q=a',
    );
  });

  it('끝 슬래시를 정리한다', () => {
    expect(buildUpstreamUrl('http://api/', ['search'], '')).toBe('http://api/api/v1/search');
  });

  it('조각이 없으면 경로도 없다', () => {
    expect(buildUpstreamUrl('http://api', [], '')).toBe('http://api/api/v1');
  });

  it('**경로 이탈을 막는다**', () => {
    // `..`이 살아 있으면 `search-api`의 다른 경로로 빠져나간다.
    expect(buildUpstreamUrl('http://api', ['..', 'admin'], '')).toBe('http://api/api/v1/admin');
    expect(buildUpstreamUrl('http://api', ['.', 'search'], '')).toBe('http://api/api/v1/search');
  });

  it('**PIPE 연동 private 경로로 빠져나가지 않는다** (CR-112, PSI-G01)', () => {
    // 연동 경로는 다른 리스너에만 있지만, 프록시가 만드는 주소도 언제나 `/api/v1` 아래다.
    for (const segments of [
      ['..', '..', 'internal', 'integrations', 'pipe', 'v1', 'read', 'search'],
      ['..%2F..%2Finternal%2Fintegrations'],
      ['%2e%2e', 'internal'],
    ]) {
      const url = new URL(buildUpstreamUrl('http://api', segments, ''));
      expect(url.pathname.startsWith('/api/v1/')).toBe(true);
      expect(url.pathname).not.toMatch(/^\/internal/);
    }
  });

  it('조각 안의 `/`를 인코딩한다', () => {
    // `commits/acme/payments/sha`의 저장소 조각이 경로를 갈라서는 안 된다.
    const url = buildUpstreamUrl('http://api', ['commits', 'acme/payments'], '');
    expect(url).toBe('http://api/api/v1/commits/acme%2Fpayments');
  });

  it('빈 조각을 버린다', () => {
    expect(buildUpstreamUrl('http://api', ['', 'search', ''], '')).toBe('http://api/api/v1/search');
  });
});

/*
 * 이 블록은 **변이 E11이 살아남아서** 생겼다.
 *
 * e2e에는 Redis가 없어 `load`가 늘 던진다 — 그래서 "저장소에 닿지 못했다"
 * (503)가 "그런 세션이 없다"(401)를 가렸고, `위조한 세션 쿠키로도 통과하지
 * 못한다`가 **옳은 이유가 아닌 이유로** 통과하고 있었다. 판정을 순수 함수로
 * 떼어 세 갈래를 저장소 없이 직접 건다.
 */
describe('세션 판정 (`resolveProxyAuth`)', () => {
  const never = (): Promise<unknown> => {
    throw new Error('쿠키가 없으면 저장소를 부르지 않아야 한다');
  };

  it('쿠키가 없으면 미인증이다 — 저장소를 부르지도 않는다', async () => {
    await expect(resolveProxyAuth(undefined, never)).resolves.toEqual({ kind: 'unauthenticated' });
  });

  it('빈 쿠키도 미인증이다', async () => {
    await expect(resolveProxyAuth('', never)).resolves.toEqual({ kind: 'unauthenticated' });
  });

  it('**저장소에 그런 세션이 없으면 미인증이다** — 위조 쿠키가 여기서 막힌다', async () => {
    await expect(resolveProxyAuth('forged', () => Promise.resolve(null))).resolves.toEqual({
      kind: 'unauthenticated',
    });
  });

  it('`undefined`도 없는 것으로 본다 — 적재기가 `null` 대신 그것을 줄 수 있다', async () => {
    /*
     * 지금 `SessionStore.load`는 `LoadedSession | null`이라 `undefined`를 주지
     * 않는다. 그래도 거는 이유는 이 함수의 서명이 `Promise<unknown>`이기
     * 때문이다 — 다른 적재기를 끼우는 순간 `undefined`가 들어올 수 있고,
     * 그것을 세션으로 인정하면 인증이 통째로 뚫린다.
     */
    await expect(resolveProxyAuth('x', () => Promise.resolve(undefined))).resolves.toEqual({
      kind: 'unauthenticated',
    });
  });

  it('저장소가 던지면 미인증이 아니라 `unavailable`이다', async () => {
    const outcome = await resolveProxyAuth('sess-1', () => Promise.reject(new Error('ECONNREFUSED')));

    // 401이면 사용자가 고칠 수 없는 일로 재로그인을 반복하게 된다.
    expect(outcome).toEqual({ kind: 'unavailable' });
  });

  it('살아 있는 세션이면 그 id를 그대로 넘긴다', async () => {
    await expect(resolveProxyAuth('sess-1', () => Promise.resolve({ userId: 'u1' }))).resolves.toEqual({
      kind: 'authenticated',
      sessionId: 'sess-1',
    });
  });

  it('저장소가 부른 id는 쿠키의 값 그대로다', async () => {
    const seen: string[] = [];
    await resolveProxyAuth('sess-abc', (id) => {
      seen.push(id);
      return Promise.resolve({ userId: 'u1' });
    });
    expect(seen).toEqual(['sess-abc']);
  });
});

/**
 * 브라우저 쿠키 읽기 (CR-091, 독립 검토 A).
 *
 * web은 값 하나를 골라 search-api로 가는 헤더를 다시 조립한다. 그래서 중복 쿠키 거절이 web에도 없으면
 * search-api의 방어가 브라우저 구간에서 사라진다 — 평문 HTTP 파일럿의 접두 없는 이름은 하위 도메인·같은 망에서
 * 하나 더 심을 수 있다(세션 강요).
 */
describe('CR-091: 브라우저 쿠키를 중복 없이 읽는다', () => {
  it('이름이 하나면 그 값이다', () => {
    expect(readBrowserCookie('theme=dark; prs_session=abc; lang=ko', 'prs_session')).toBe('abc');
    expect(readBrowserCookie(`${SESSION_COOKIE_NAME}=xyz`, SESSION_COOKIE_NAME)).toBe('xyz');
  });

  it('**같은 이름이 둘이면 없는 것으로 본다** — 어느 쪽을 골라도 주입한 쪽이 이길 수 있다', () => {
    expect(readBrowserCookie('prs_session=victim; prs_session=attacker', 'prs_session')).toBeUndefined();
  });

  it('없거나 비었으면 없는 것이다', () => {
    expect(readBrowserCookie(null, 'prs_session')).toBeUndefined();
    expect(readBrowserCookie('', 'prs_session')).toBeUndefined();
    expect(readBrowserCookie('prs_session=', 'prs_session')).toBeUndefined();
  });

  it('이름은 정확히 같아야 한다 — 접두 있는 이름과 없는 이름은 다른 쿠키다', () => {
    expect(readBrowserCookie(`${SESSION_COOKIE_NAME}=secure`, 'prs_session')).toBeUndefined();
    expect(readBrowserCookie('prs_session=plain', SESSION_COOKIE_NAME)).toBeUndefined();
  });

  it('로그아웃용 읽기는 같은 이름의 값을 전부 준다 — 피해자의 세션을 남기지 않는다', () => {
    expect(readBrowserCookieValues('prs_session=victim; x=1; prs_session=attacker; prs_session=victim', 'prs_session')).toEqual([
      'victim',
      'attacker',
    ]);
    expect(readBrowserCookieValues(undefined, 'prs_session')).toEqual([]);
    expect(readBrowserCookieValues('prs_session=', 'prs_session')).toEqual([]);
  });
});
