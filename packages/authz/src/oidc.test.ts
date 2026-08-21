/**
 * PKCE·인가 URL·토큰 교환·JWKS (WP-012, FR-AUTH-001).
 */

import { createHash, generateKeyPairSync } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { OidcError } from './errors.js';
import { JwksCache } from './jwks.js';
import { buildAuthorizationUrl, exchangeCode, type OidcProviderConfig } from './oidc.js';
import { codeChallengeOf, createAuthorizationRequest, sanitizeReturnPath, statesMatch } from './pkce.js';

const CONFIG: OidcProviderConfig = {
  issuer: 'https://idp.acme.example',
  authorizationEndpoint: 'https://idp.acme.example/authorize',
  tokenEndpoint: 'https://idp.acme.example/token',
  jwksUri: 'https://idp.acme.example/jwks',
  clientId: 'pr-search',
  clientSecret: 'super-secret-value',
  redirectUri: 'https://prsearch.acme.example/auth/callback',
  scopes: ['openid', 'profile', 'email'],
};

describe('PKCE', () => {
  it('challenge는 verifier의 S256 해시다', () => {
    const request = createAuthorizationRequest('/');
    const expected = createHash('sha256').update(request.codeVerifier).digest('base64url');
    expect(request.codeChallenge).toBe(expected);
    expect(codeChallengeOf(request.codeVerifier)).toBe(expected);
  });

  it('verifier·state·nonce가 매번 다르다', () => {
    const many = Array.from({ length: 100 }, () => createAuthorizationRequest('/'));
    expect(new Set(many.map((r) => r.codeVerifier)).size).toBe(100);
    expect(new Set(many.map((r) => r.state)).size).toBe(100);
    expect(new Set(many.map((r) => r.nonce)).size).toBe(100);
  });

  it('verifier가 RFC 7636의 43~128자 범위다', () => {
    const { codeVerifier } = createAuthorizationRequest('/');
    expect(codeVerifier.length).toBeGreaterThanOrEqual(43);
    expect(codeVerifier.length).toBeLessThanOrEqual(128);
  });

  it('state 비교가 정확히 일치할 때만 참이다', () => {
    expect(statesMatch('abc', 'abc')).toBe(true);
    expect(statesMatch('abc', 'abd')).toBe(false);
    expect(statesMatch('abc', 'abcd')).toBe(false);
    expect(statesMatch('', '')).toBe(false);
  });
});

describe('열린 리다이렉트 (FLOW-000)', () => {
  it('같은 출처의 절대 경로를 그대로 둔다', () => {
    expect(sanitizeReturnPath('/search?q=repo%3Aacme%2Fpayments')).toBe('/search?q=repo%3Aacme%2Fpayments');
  });

  it('절대 URL을 거절한다', () => {
    expect(sanitizeReturnPath('https://evil.example/steal')).toBe('/');
  });

  it('프로토콜 상대 URL을 거절한다', () => {
    expect(sanitizeReturnPath('//evil.example/steal')).toBe('/');
  });

  it('역슬래시 변형을 거절한다 — 브라우저가 다른 출처로 읽는다', () => {
    expect(sanitizeReturnPath('/\\evil.example')).toBe('/');
  });

  it('제어 문자를 거절한다 — 헤더를 쪼갤 수 있다', () => {
    expect(sanitizeReturnPath('/search\r\nSet-Cookie: x=1')).toBe('/');
  });

  it('빈 값과 상대 경로는 기본값이다', () => {
    expect(sanitizeReturnPath(undefined)).toBe('/');
    expect(sanitizeReturnPath('')).toBe('/');
    expect(sanitizeReturnPath('search')).toBe('/');
  });
});

describe('인가 URL (AC-1)', () => {
  it('PKCE·state·nonce를 모두 싣는다', () => {
    const request = createAuthorizationRequest('/search');
    const url = new URL(buildAuthorizationUrl(CONFIG, request));

    expect(url.origin + url.pathname).toBe('https://idp.acme.example/authorize');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('client_id')).toBe('pr-search');
    expect(url.searchParams.get('redirect_uri')).toBe(CONFIG.redirectUri);
    expect(url.searchParams.get('scope')).toBe('openid profile email');
    expect(url.searchParams.get('state')).toBe(request.state);
    expect(url.searchParams.get('nonce')).toBe(request.nonce);
    expect(url.searchParams.get('code_challenge')).toBe(request.codeChallenge);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  });

  it('verifier를 URL에 싣지 않는다 — 그러면 PKCE가 무의미하다', () => {
    const request = createAuthorizationRequest('/');
    expect(buildAuthorizationUrl(CONFIG, request)).not.toContain(request.codeVerifier);
  });
});

describe('토큰 교환', () => {
  it('code·verifier를 본문에, 시크릿을 Basic 헤더에 싣는다', async () => {
    const exchanger = vi.fn().mockResolvedValue({ status: 200, body: { id_token: 'header.payload.sig' } });
    await exchangeCode(CONFIG, 'auth-code', 'the-verifier', exchanger);

    const [endpoint, body, headers] = exchanger.mock.calls[0] as [string, URLSearchParams, Record<string, string>];
    expect(endpoint).toBe(CONFIG.tokenEndpoint);
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('code')).toBe('auth-code');
    expect(body.get('code_verifier')).toBe('the-verifier');
    // 시크릿은 본문이 아니라 헤더다 — 프록시 로그에 남을 여지를 줄인다.
    expect(body.get('client_secret')).toBeNull();
    expect(headers['authorization']).toMatch(/^Basic /);
  });

  it('2xx가 아니면 던지되 본문을 메시지에 담지 않는다', async () => {
    const exchanger = vi
      .fn()
      .mockResolvedValue({ status: 400, body: { error: 'invalid_grant', id_token: 'leaked.token.here' } });
    const error = await exchangeCode(CONFIG, 'c', 'v', exchanger).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(OidcError);
    expect((error as Error).message).toContain('invalid_grant');
    expect((error as Error).message).not.toContain('leaked.token.here');
  });

  it('id_token이 없으면 던진다', async () => {
    const exchanger = vi.fn().mockResolvedValue({ status: 200, body: { access_token: 'a' } });
    await expect(exchangeCode(CONFIG, 'c', 'v', exchanger)).rejects.toThrow(/id_token이 없다/);
  });

  it('요청 자체가 실패해도 OidcError로 감싼다', async () => {
    const exchanger = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(exchangeCode(CONFIG, 'c', 'v', exchanger)).rejects.toThrow(OidcError);
  });
});

describe('JWKS 캐시', () => {
  const publicJwk = generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey.export({ format: 'jwk' });
  const jwk = (kid: string): Record<string, unknown> => ({ ...publicJwk, kid, use: 'sig', alg: 'RS256' });

  it('첫 조회 뒤에는 다시 받아 오지 않는다', async () => {
    const fetcher = vi.fn().mockResolvedValue({ keys: [jwk('k1')] });
    let clock = 0;
    const cache = new JwksCache({ uri: 'x', fetcher, now: () => clock });

    await cache.getKey('k1');
    await cache.getKey('k1');
    expect(fetcher).toHaveBeenCalledTimes(1);

    clock += 11 * 60 * 1000; // TTL 초과
    await cache.getKey('k1');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('모르는 kid가 오면 한 번 다시 받아 온다 — 키 회전', async () => {
    let clock = 0;
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({ keys: [jwk('k1')] })
      .mockResolvedValueOnce({ keys: [jwk('k1'), jwk('k2')] });
    const cache = new JwksCache({ uri: 'x', fetcher, now: () => clock });

    await cache.getKey('k1');
    clock += 61 * 1000; // 쿨다운 경과
    await expect(cache.getKey('k2')).resolves.toBeDefined();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('쿨다운 안에서는 재조회하지 않는다 — 위조 kid 폭주를 막는다', async () => {
    const fetcher = vi.fn().mockResolvedValue({ keys: [jwk('k1')] });
    const cache = new JwksCache({ uri: 'x', fetcher, now: () => 0 });

    await cache.getKey('k1');
    for (let i = 0; i < 20; i += 1) {
      await expect(cache.getKey(`forged-${String(i)}`)).rejects.toThrow(/서명 키를 찾을 수 없다/);
    }
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('서명용이 아닌 키를 담지 않는다', async () => {
    const fetcher = vi.fn().mockResolvedValue({ keys: [{ ...jwk('enc-key'), use: 'enc' }, jwk('k1')] });
    const cache = new JwksCache({ uri: 'x', fetcher, now: () => 0 });

    await expect(cache.getKey('enc-key')).rejects.toThrow(/서명 키를 찾을 수 없다/);
    await expect(cache.getKey('k1')).resolves.toBeDefined();
  });

  it('조회 실패를 OidcError로 감싼다', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('502'));
    const cache = new JwksCache({ uri: 'x', fetcher, now: () => 0 });
    await expect(cache.getKey('k1')).rejects.toThrow(OidcError);
  });

  it('쓸 수 있는 키가 하나도 없으면 던진다', async () => {
    const fetcher = vi.fn().mockResolvedValue({ keys: [{ kid: 'x', kty: 'oct' }] });
    const cache = new JwksCache({ uri: 'x', fetcher, now: () => 0 });
    await expect(cache.getKey('x')).rejects.toThrow(/쓸 수 있는 서명 키가 없다/);
  });

  it('동시 조회가 JWKS를 한 번만 받는다', async () => {
    const fetcher = vi.fn().mockImplementation(
      async () =>
        new Promise((resolve) => {
          setTimeout(() => {
            resolve({ keys: [jwk('k1')] });
          }, 10);
        }),
    );
    const cache = new JwksCache({ uri: 'x', fetcher, now: () => 0 });

    await Promise.all([cache.getKey('k1'), cache.getKey('k1'), cache.getKey('k1')]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
