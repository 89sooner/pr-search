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

  it('조각 안의 `/`를 인코딩한다', () => {
    // `commits/acme/payments/sha`의 저장소 조각이 경로를 갈라서는 안 된다.
    const url = buildUpstreamUrl('http://api', ['commits', 'acme/payments'], '');
    expect(url).toBe('http://api/api/v1/commits/acme%2Fpayments');
  });

  it('빈 조각을 버린다', () => {
    expect(buildUpstreamUrl('http://api', ['', 'search', ''], '')).toBe('http://api/api/v1/search');
  });
});
