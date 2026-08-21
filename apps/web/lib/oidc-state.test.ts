/**
 * OIDC 왕복 상태 쿠키 (WP-015 / CR-018 DEV-071).
 *
 * 이 쿠키가 잘못되면 인증이 조용히 약해진다 — `nonce`를 잃으면 ID 토큰
 * 재생 공격을 막지 못하고, `codeVerifier`를 잃으면 PKCE가 무력해진다.
 */

import { describe, expect, it } from 'vitest';
import { createAuthorizationRequest } from '@prs/authz';
import {
  OIDC_STATE_COOKIE,
  OIDC_STATE_TTL_SECONDS,
  clearedRoundTripCookie,
  decodeRoundTrip,
  encodeRoundTrip,
  roundTripCookie,
} from './oidc-state';

describe('왕복', () => {
  it('네 값이 그대로 돌아온다', () => {
    const request = createAuthorizationRequest('/search?q=a%3Ab');
    const decoded = decodeRoundTrip(encodeRoundTrip(request));

    expect(decoded).toEqual({
      state: request.state,
      nonce: request.nonce,
      codeVerifier: request.codeVerifier,
      returnTo: request.returnTo,
    });
  });

  it('쿠키 문법과 부딪히지 않는다', () => {
    // base64url에는 `;`도 `=`도 공백도 없다.
    const encoded = encodeRoundTrip(createAuthorizationRequest('/a/b?c=d&e=f'));
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('빈 `returnTo`도 왕복한다', () => {
    const request = createAuthorizationRequest('');
    expect(decodeRoundTrip(encodeRoundTrip(request))?.returnTo).toBe(request.returnTo);
  });
});

describe('되읽기가 어긋난 값을 받지 않는다', () => {
  it.each([
    ['없음', undefined],
    ['빈 문자열', ''],
    ['base64가 아님', '!!!not-base64!!!'],
    ['JSON이 아님', Buffer.from('nope', 'utf8').toString('base64url')],
    ['배열', Buffer.from('[]', 'utf8').toString('base64url')],
    ['null', Buffer.from('null', 'utf8').toString('base64url')],
  ])('%s는 `null`이다', (_label, raw) => {
    expect(decodeRoundTrip(raw)).toBeNull();
  });

  it('**필드가 하나라도 빠지면 `null`이다**', () => {
    // 부분적으로 읽어 진행하면 `nonce` 없이 ID 토큰을 검증하게 되고,
    // 그것은 검증하지 않는 것과 같다.
    const full = { state: 's', nonce: 'n', codeVerifier: 'v', returnTo: '/' };
    for (const key of ['state', 'nonce', 'codeVerifier', 'returnTo'] as const) {
      const partial: Record<string, unknown> = { ...full };
      delete partial[key];
      const raw = Buffer.from(JSON.stringify(partial), 'utf8').toString('base64url');
      expect(decodeRoundTrip(raw), key).toBeNull();
    }
  });

  it('빈 `state`·`nonce`·`codeVerifier`도 거절한다', () => {
    for (const key of ['state', 'nonce', 'codeVerifier'] as const) {
      const raw = Buffer.from(
        JSON.stringify({ state: 's', nonce: 'n', codeVerifier: 'v', returnTo: '/', [key]: '' }),
        'utf8',
      ).toString('base64url');
      expect(decodeRoundTrip(raw), key).toBeNull();
    }
  });

  it('타입이 다르면 거절한다', () => {
    const raw = Buffer.from(
      JSON.stringify({ state: 1, nonce: 'n', codeVerifier: 'v', returnTo: '/' }),
      'utf8',
    ).toString('base64url');
    expect(decodeRoundTrip(raw)).toBeNull();
  });
});

describe('쿠키 속성', () => {
  it('`__Host-` 접두의 조건을 모두 만족한다', () => {
    const cookie = roundTripCookie('value', true);

    expect(cookie.name).toBe(OIDC_STATE_COOKIE);
    expect(cookie.name.startsWith('__Host-')).toBe(true);
    expect(cookie.secure).toBe(true);
    expect(cookie.path).toBe('/');
    // `Domain`이 없어야 한다 — 속성 자체를 두지 않는다.
    expect(cookie).not.toHaveProperty('domain');
  });

  it('HttpOnly다 — 스크립트가 `codeVerifier`를 읽지 못한다', () => {
    expect(roundTripCookie('v', true).httpOnly).toBe(true);
  });

  it('**`SameSite=Lax`다** — `Strict`면 IdP 복귀에 쿠키가 실리지 않는다', () => {
    expect(roundTripCookie('v', true).sameSite).toBe('lax');
  });

  it('수명이 10분이다', () => {
    expect(OIDC_STATE_TTL_SECONDS).toBe(600);
    expect(roundTripCookie('v', true).maxAge).toBe(600);
  });

  it('개발에서는 `Secure`를 끌 수 있다', () => {
    expect(roundTripCookie('v', false).secure).toBe(false);
  });

  it('만료 쿠키는 `maxAge`가 0이고 값이 비어 있다', () => {
    const cleared = clearedRoundTripCookie(true);
    expect(cleared.maxAge).toBe(0);
    expect(cleared.value).toBe('');
    expect(cleared.name).toBe(OIDC_STATE_COOKIE);
  });
});
