/**
 * ID 토큰 검증 (WP-012, FR-AUTH-001 AC-4).
 *
 * 검사 다섯을 **하나씩 무너뜨려** 각각이 실제로 막고 있는지 본다. 다섯 중
 * 넷만 하는 검증은 검증이 아니다.
 */

import { createPrivateKey, createPublicKey, createSign, generateKeyPairSync } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { OidcError } from './errors.js';
import { verifyIdToken } from './id-token.js';

const NOW = Date.UTC(2026, 7, 21, 9, 0, 0);
const nowFn = (): number => NOW;

const ISSUER = 'https://idp.acme.example';
const AUDIENCE = 'pr-search';
const NONCE = 'nonce-of-this-attempt';

let privateKeyPem: string;
let publicJwk: Record<string, unknown>;
let otherPrivateKeyPem: string;

beforeAll(() => {
  const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
  privateKeyPem = pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  publicJwk = { ...pair.publicKey.export({ format: 'jwk' }), kid: 'k1', use: 'sig', alg: 'RS256' };

  const other = generateKeyPairSync('rsa', { modulusLength: 2048 });
  otherPrivateKeyPem = other.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
});

function b64(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

interface TokenParts {
  readonly header?: Record<string, unknown>;
  readonly claims?: Record<string, unknown>;
  readonly signWith?: string;
  readonly signature?: string;
}

function makeToken(parts: TokenParts = {}): string {
  const header = { alg: 'RS256', typ: 'JWT', kid: 'k1', ...parts.header };
  const claims = {
    sub: 'sub-1',
    iss: ISSUER,
    aud: AUDIENCE,
    exp: Math.floor(NOW / 1000) + 300,
    iat: Math.floor(NOW / 1000),
    nonce: NONCE,
    ...parts.claims,
  };

  const signingInput = `${b64(header)}.${b64(claims)}`;
  if (parts.signature !== undefined) return `${signingInput}.${parts.signature}`;

  const signer = createSign('RSA-SHA256');
  signer.update(signingInput);
  signer.end();
  return `${signingInput}.${signer.sign(createPrivateKey(parts.signWith ?? privateKeyPem), 'base64url')}`;
}

function options(overrides: Partial<Parameters<typeof verifyIdToken>[1]> = {}) {
  return {
    issuer: ISSUER,
    audience: AUDIENCE,
    expectedNonce: NONCE,
    now: nowFn,
    getKey: async (kid: string) => {
      if (kid !== 'k1') throw new OidcError(`서명 키를 찾을 수 없다 (kid=${kid})`);
      return createPublicKey({ key: publicJwk as never, format: 'jwk' });
    },
    ...overrides,
  };
}

describe('제대로 된 토큰', () => {
  it('다섯 검사를 모두 통과하면 클레임을 돌려준다', async () => {
    const claims = await verifyIdToken(makeToken(), options());
    expect(claims.sub).toBe('sub-1');
    expect(claims.iss).toBe(ISSUER);
  });

  it('`aud`가 배열이어도 우리가 그 안에 있으면 통과한다', async () => {
    const claims = await verifyIdToken(makeToken({ claims: { aud: ['other-app', AUDIENCE] } }), options());
    expect(claims.sub).toBe('sub-1');
  });

  it('프로필 클레임을 그대로 실어 준다', async () => {
    const token = makeToken({
      claims: { email: 'kim@acme.example', preferred_username: 'kim', groups: ['eng', 'qa-team'] },
    });
    const claims = await verifyIdToken(token, options());
    expect(claims.email).toBe('kim@acme.example');
    expect(claims.groups).toEqual(['eng', 'qa-team']);
  });
});

describe('AC-4: 서명', () => {
  it('다른 키로 서명한 토큰을 거절한다', async () => {
    await expect(verifyIdToken(makeToken({ signWith: otherPrivateKeyPem }), options())).rejects.toThrow(
      /서명이 맞지 않는다/,
    );
  });

  it('payload를 고치면 서명이 깨진다', async () => {
    const token = makeToken();
    const [header, , signature] = token.split('.') as [string, string, string];
    const tampered = `${header}.${b64({ sub: 'admin', iss: ISSUER, aud: AUDIENCE, exp: 9e9, nonce: NONCE })}.${signature}`;
    await expect(verifyIdToken(tampered, options())).rejects.toThrow(/서명이 맞지 않는다/);
  });

  it('`alg: none`을 거절한다 — 헤더의 alg를 믿지 않는다', async () => {
    const token = makeToken({ header: { alg: 'none' }, signature: '' });
    await expect(verifyIdToken(token, options())).rejects.toThrow(/지원하지 않는 서명 알고리즘/);
  });

  it('HMAC(HS256)으로 바꿔치기한 토큰을 거절한다', async () => {
    // 공개키를 HMAC 비밀로 쓰는 고전적 우회. 허용 목록에 없으므로 막힌다.
    const token = makeToken({ header: { alg: 'HS256' }, signature: 'whatever' });
    await expect(verifyIdToken(token, options())).rejects.toThrow(/지원하지 않는 서명 알고리즘/);
  });

  it('kid가 없으면 거절한다', async () => {
    const token = makeToken({ header: { kid: undefined } });
    await expect(verifyIdToken(token, options())).rejects.toThrow(/kid가 없다/);
  });
});

describe('AC-4: iss', () => {
  it('다른 IdP가 발급한 토큰을 거절한다', async () => {
    await expect(
      verifyIdToken(makeToken({ claims: { iss: 'https://evil.example' } }), options()),
    ).rejects.toThrow(/발급자/);
  });

  it('발급자 접두만 같은 것도 거절한다', async () => {
    await expect(
      verifyIdToken(makeToken({ claims: { iss: `${ISSUER}.evil.example` } }), options()),
    ).rejects.toThrow(/발급자/);
  });
});

describe('AC-4: aud', () => {
  it('같은 IdP의 다른 앱에 발급된 토큰을 거절한다', async () => {
    await expect(verifyIdToken(makeToken({ claims: { aud: 'other-app' } }), options())).rejects.toThrow(
      /대상\(aud\)/,
    );
  });

  it('aud가 없으면 거절한다', async () => {
    await expect(verifyIdToken(makeToken({ claims: { aud: undefined } }), options())).rejects.toThrow(
      /대상\(aud\)/,
    );
  });
});

describe('AC-4: exp', () => {
  it('만료된 토큰을 거절한다', async () => {
    const expired = { exp: Math.floor(NOW / 1000) - 3600 };
    await expect(verifyIdToken(makeToken({ claims: expired }), options())).rejects.toThrow(/만료됐다/);
  });

  it('시계 오차 60초 안쪽은 받아 준다', async () => {
    const barely = { exp: Math.floor(NOW / 1000) - 30 };
    await expect(verifyIdToken(makeToken({ claims: barely }), options())).resolves.toBeDefined();
  });

  it('exp가 없으면 거절한다', async () => {
    await expect(verifyIdToken(makeToken({ claims: { exp: undefined } }), options())).rejects.toThrow(
      /만료\(exp\)가 없다/,
    );
  });

  it('발급 시각이 미래면 거절한다', async () => {
    const future = { iat: Math.floor(NOW / 1000) + 600 };
    await expect(verifyIdToken(makeToken({ claims: future }), options())).rejects.toThrow(/미래다/);
  });
});

describe('AC-4 + 보안 문서 4장: nonce', () => {
  it('다른 로그인 시도의 nonce를 거절한다 — 재생 공격', async () => {
    await expect(
      verifyIdToken(makeToken({ claims: { nonce: 'nonce-of-another-attempt' } }), options()),
    ).rejects.toThrow(/nonce/);
  });

  it('nonce가 아예 없으면 거절한다', async () => {
    await expect(verifyIdToken(makeToken({ claims: { nonce: undefined } }), options())).rejects.toThrow(
      /nonce/,
    );
  });
});

describe('형식', () => {
  it('3구간이 아니면 거절한다', async () => {
    await expect(verifyIdToken('a.b', options())).rejects.toThrow(/3구간/);
    await expect(verifyIdToken('', options())).rejects.toThrow(/3구간/);
  });

  it('sub가 없으면 거절한다 — 누구인지 모르는 세션을 만들 수 없다', async () => {
    await expect(verifyIdToken(makeToken({ claims: { sub: undefined } }), options())).rejects.toThrow(
      /주체\(sub\)/,
    );
  });
});

describe('NFR-005: 토큰을 오류에 담지 않는다', () => {
  it('실패 메시지에 토큰 문자열이 없다', async () => {
    const token = makeToken({ claims: { iss: 'https://evil.example' } });
    const error = await verifyIdToken(token, options()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(OidcError);
    // 토큰의 어느 구간도 메시지에 실리지 않아야 한다.
    for (const segment of token.split('.')) {
      expect((error as Error).message).not.toContain(segment);
    }
  });
});
