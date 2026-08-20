/** App JWT 서명 (FR-ING-004, THR-009). */

import { createVerify } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createAppJwt } from './jwt.js';
import { generateTestKeyPair } from '../testing/mock-ghe.js';

const keys = generateTestKeyPair();
const NOW = new Date('2026-08-20T12:00:00.000Z');

function decode(part: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as Record<string, unknown>;
}

describe('App JWT', () => {
  it('RS256으로 서명하고 공개 키로 검증된다', () => {
    const jwt = createAppJwt({ appId: '12345', privateKey: keys.privateKey, now: NOW });
    const [header, payload, signature] = jwt.split('.');
    expect(decode(header!)).toEqual({ alg: 'RS256', typ: 'JWT' });

    const verifier = createVerify('RSA-SHA256');
    verifier.update(`${header!}.${payload!}`);
    verifier.end();
    expect(verifier.verify(keys.publicKey, signature!, 'base64url')).toBe(true);
  });

  it('발급자와 수명이 GitHub 규칙 안에 있다', () => {
    const jwt = createAppJwt({ appId: '12345', privateKey: keys.privateKey, now: NOW });
    const payload = decode(jwt.split('.')[1]!);
    expect(payload['iss']).toBe('12345');
    const iat = payload['iat'] as number;
    const exp = payload['exp'] as number;
    // 시계 오차를 감안해 뒤로 당겨 발급한다.
    expect(iat).toBeLessThan(Math.floor(NOW.getTime() / 1000));
    // GitHub 상한은 10분이다.
    expect(exp - iat).toBeLessThanOrEqual(600);
  });

  it('설정이 비어 있으면 조용히 잘못된 JWT를 만들지 않고 던진다', () => {
    expect(() => createAppJwt({ appId: '', privateKey: keys.privateKey })).toThrow(/App ID/);
    expect(() => createAppJwt({ appId: '1', privateKey: '' })).toThrow(/private key/);
  });
});
