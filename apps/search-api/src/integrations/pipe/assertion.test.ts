/**
 * PIPE 사용자 assertion 검증 (CR-112 / PSI-A05~A09, 공통 계약 5.2).
 *
 * 시계는 고정한다 (`NOW_S`). 서명은 이 파일이 만든 시험 전용 RSA 키로 한다 — 운영 자격이 아니다.
 */

import { CompactSign } from 'jose';
import { createSecretKey, generateKeyPairSync, sign as rsaSign, type KeyObject } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ASSERTION_TYP, MAX_ASSERTION_LENGTH, verifyAssertion, type AssertionPurpose } from './assertion.js';
import type { PipeClientPolicy } from './config.js';
import { PsiError } from './errors.js';

const NOW_S = 2_000_000_000;
const NOW_MS = NOW_S * 1000;
const ISSUER = 'urn:test:pipe:dev';
const AUDIENCE = 'urn:test:pr-search:pipe-integration:dev';

const signer = generateKeyPairSync('rsa', { modulusLength: 2048 });
const stranger = generateKeyPairSync('rsa', { modulusLength: 2048 });

const CLIENT: PipeClientPolicy = {
  clientId: 'pipe-test',
  status: 'active',
  policyVersion: 1,
  issuer: ISSUER,
  audience: AUDIENCE,
  profile: 'search-read-v1',
  signingKeys: new Map<string, KeyObject>([['pipe-signing-test-1', signer.publicKey]]),
  certificateSha256: new Set(),
  subjectAltNames: new Set(['URI:spiffe://test/pipe']),
  repositoryIds: [101],
};

function claims(overrides: Record<string, unknown> = {}, omit: readonly string[] = []): Record<string, unknown> {
  const base: Record<string, unknown> = {
    iss: ISSUER,
    aud: AUDIENCE,
    sub: 'fixture-corp-user-001',
    client_id: 'pipe-test',
    purpose: 'grant',
    profile: 'search-read-v1',
    auth_context_id: 'ctx-fixture-0123456789',
    auth_expires_at: NOW_S + 3600,
    iat: NOW_S,
    nbf: NOW_S,
    exp: NOW_S + 60,
    jti: 'jti-fixture-abcdefghijklmnop',
    ...overrides,
  };
  for (const name of omit) delete base[name];
  return base;
}

async function sign(
  payload: unknown,
  header: Record<string, unknown> = { alg: 'RS256', typ: ASSERTION_TYP, kid: 'pipe-signing-test-1' },
  key: KeyObject = signer.privateKey,
): Promise<string> {
  return new CompactSign(new TextEncoder().encode(JSON.stringify(payload)))
    .setProtectedHeader(header as { alg: string })
    .sign(key);
}

function b64(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

/**
 * 라이브러리를 거치지 않은 RS256 서명. `jose`는 모르는 `crit` 확장이 든 헤더로는 서명을 거부하지만
 * 공격자는 그런 토큰을 직접 만들 수 있다 — 검증 쪽이 막는지를 봐야 한다.
 */
function signRaw(header: Record<string, unknown>, payload: unknown): string {
  const input = `${b64(header)}.${b64(payload)}`;
  return `${input}.${rsaSign('sha256', Buffer.from(input), signer.privateKey).toString('base64url')}`;
}

async function verify(token: string, purpose: AssertionPurpose = 'grant', nowMs = NOW_MS) {
  return verifyAssertion(token, { client: CLIENT, purpose, nowMs });
}

async function expectInvalid(token: string, purpose: AssertionPurpose = 'grant', nowMs = NOW_MS): Promise<PsiError> {
  try {
    await verify(token, purpose, nowMs);
  } catch (error) {
    expect(error).toBeInstanceOf(PsiError);
    expect((error as PsiError).code).toBe('ASSERTION_INVALID');
    return error as PsiError;
  }
  throw new Error('거절되어야 할 assertion이 통과했다');
}

describe('유효한 assertion (PSI-A01의 전제)', () => {
  it('정확한 헤더·claim이면 검증된 값을 돌려준다', async () => {
    const verified = await verify(await sign(claims()));
    expect(verified).toMatchObject({
      issuer: ISSUER,
      subject: 'fixture-corp-user-001',
      clientId: 'pipe-test',
      purpose: 'grant',
      authContextId: 'ctx-fixture-0123456789',
      authExpiresAt: NOW_S + 3600,
      expiresAt: NOW_S + 60,
      kid: 'pipe-signing-test-1',
    });
  });
});

describe('PSI-A05 서명 불량·alg:none·HS/RS 혼동', () => {
  it('alg:none (서명 없음)을 거절한다', async () => {
    const unsigned = `${b64({ alg: 'none', typ: ASSERTION_TYP, kid: 'pipe-signing-test-1' })}.${b64(claims())}.`;
    await expectInvalid(unsigned);
    const fakeSignature = `${b64({ alg: 'none', typ: ASSERTION_TYP, kid: 'pipe-signing-test-1' })}.${b64(claims())}.AAAA`;
    expect((await expectInvalid(fakeSignature)).reason).toBe('alg');
  });

  it('공개키 PEM을 HMAC 비밀로 쓴 HS256을 거절한다 (알고리즘 혼동)', async () => {
    const pem = signer.publicKey.export({ type: 'spki', format: 'pem' });
    const token = await sign(
      claims(),
      { alg: 'HS256', typ: ASSERTION_TYP, kid: 'pipe-signing-test-1' },
      createSecretKey(Buffer.from(pem)),
    );
    expect((await expectInvalid(token)).reason).toBe('alg');
  });

  it('등록 키로 서명했어도 RS384는 받지 않는다 (RS256 고정)', async () => {
    const token = await sign(claims(), { alg: 'RS384', typ: ASSERTION_TYP, kid: 'pipe-signing-test-1' });
    expect((await expectInvalid(token)).reason).toBe('alg');
  });

  it('등록 kid를 달았지만 다른 키로 서명하면 서명 검증에서 떨어진다', async () => {
    const token = await sign(claims(), undefined, stranger.privateKey);
    expect((await expectInvalid(token)).reason).toBe('signature');
  });

  it('payload를 바꾼 토큰은 서명이 맞지 않는다', async () => {
    const [header, , signature] = (await sign(claims())).split('.');
    const tampered = `${header ?? ''}.${b64(claims({ sub: 'someone-else' }))}.${signature ?? ''}`;
    expect((await expectInvalid(tampered)).reason).toBe('signature');
  });
});

describe('PSI-A06 issuer·audience·typ·purpose·profile은 정확히 하나다', () => {
  it.each([
    ['iss', { iss: 'urn:test:pipe:prod' }],
    ['aud', { aud: 'urn:test:pr-search:other' }],
    ['aud', { aud: [AUDIENCE] }],
    ['aud', { aud: [AUDIENCE, 'urn:other'] }],
    ['client_id', { client_id: 'pipe-other' }],
    ['purpose', { purpose: 'revoke_context' }],
    ['profile', { profile: 'search-write-v1' }],
  ] as const)('%s 불일치를 거절한다 (%j)', async (reason, override) => {
    expect((await expectInvalid(await sign(claims(override)))).reason).toBe(reason);
  });

  it.each(['JWT', 'application/pipe-user-assertion+jwt', 'PIPE-USER-ASSERTION+JWT', undefined])(
    'typ=%s 를 거절한다 — 정확한 표기 하나만 받는다',
    async (typ) => {
      const header: Record<string, unknown> = { alg: 'RS256', kid: 'pipe-signing-test-1' };
      if (typ !== undefined) header['typ'] = typ;
      expect((await expectInvalid(await sign(claims(), header))).reason).toBe('typ');
    },
  );

  it('일반 PIPE 로그인 JWT(HS256, typ JWT)를 거절한다', async () => {
    const pipeLogin = await sign(
      { user_id: 42, username: 'alice', exp: NOW_S + 3600 },
      { alg: 'HS256', typ: 'JWT' },
      createSecretKey(Buffer.from('pipe-login-secret')),
    );
    await expectInvalid(pipeLogin);
  });
});

describe('PSI-G05 서명 키 정상 교체 — 겹치는 기간에는 둘 다 받고, 옛 키를 빼면 그 kid를 거절한다', () => {
  const next = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const rotating: PipeClientPolicy = {
    ...CLIENT,
    signingKeys: new Map<string, KeyObject>([
      ['pipe-signing-test-1', signer.publicKey],
      ['pipe-signing-test-2', next.publicKey],
    ]),
  };
  const header = (kid: string): Record<string, unknown> => ({ alg: 'RS256', typ: ASSERTION_TYP, kid });

  it('두 키가 함께 등록된 동안에는 옛 키와 새 키의 서명을 모두 받는다', async () => {
    const old = await sign(claims(), header('pipe-signing-test-1'));
    const fresh = await sign(claims({ jti: 'jti-fixture-rotation-new-key' }), header('pipe-signing-test-2'), next.privateKey);
    await expect(verifyAssertion(old, { client: rotating, purpose: 'grant', nowMs: NOW_MS })).resolves.toMatchObject({
      kid: 'pipe-signing-test-1',
    });
    await expect(verifyAssertion(fresh, { client: rotating, purpose: 'grant', nowMs: NOW_MS })).resolves.toMatchObject({
      kid: 'pipe-signing-test-2',
    });
  });

  it('옛 키를 정책에서 빼면 그 kid의 assertion은 등록되지 않은 kid로 거절한다', async () => {
    const retired: PipeClientPolicy = { ...rotating, signingKeys: new Map<string, KeyObject>([['pipe-signing-test-2', next.publicKey]]) };
    const old = await sign(claims(), header('pipe-signing-test-1'));
    await expect(verifyAssertion(old, { client: retired, purpose: 'grant', nowMs: NOW_MS })).rejects.toMatchObject({
      code: 'ASSERTION_INVALID',
      reason: 'unknown_kid',
    });
  });
});

describe('PSI-A07 알 수 없는 kid·토큰이 지정한 키 위치', () => {
  it('등록되지 않은 kid를 거절한다', async () => {
    const token = await sign(claims(), { alg: 'RS256', typ: ASSERTION_TYP, kid: 'pipe-signing-unknown' });
    expect((await expectInvalid(token)).reason).toBe('unknown_kid');
  });

  it('kid가 없으면 거절한다', async () => {
    expect((await expectInvalid(await sign(claims(), { alg: 'RS256', typ: ASSERTION_TYP }))).reason).toBe('kid_format');
  });

  it.each(['jku', 'x5u', 'jwk', 'x5c', 'crit', 'b64'])('헤더에 %s가 있으면 따라가지 않고 거절한다', async (param) => {
    const header: Record<string, unknown> = { alg: 'RS256', typ: ASSERTION_TYP, kid: 'pipe-signing-test-1' };
    header[param] =
      param === 'jwk'
        ? signer.publicKey.export({ format: 'jwk' })
        : param === 'crit'
          ? ['exp']
          : param === 'b64'
            ? true
            : 'https://attacker.example/keys';
    expect((await expectInvalid(signRaw(header, claims()))).reason).toBe(`header_param_${param}`);
  });

  it('직접 서명한 정상 헤더 토큰은 통과한다 — 위 거절이 서명 문제가 아니라 헤더 때문임을 보인다', async () => {
    const header = { alg: 'RS256', typ: ASSERTION_TYP, kid: 'pipe-signing-test-1' };
    await expect(verify(signRaw(header, claims()))).resolves.toBeDefined();
  });
});

describe('PSI-A08 필수 claim 누락·타입 불량·크기', () => {
  it.each(['iss', 'aud', 'sub', 'client_id', 'purpose', 'profile', 'auth_context_id', 'auth_expires_at', 'iat', 'nbf', 'exp', 'jti'])(
    '%s가 없으면 거절한다',
    async (name) => {
      await expectInvalid(await sign(claims({}, [name])));
    },
  );

  it.each(['roles', 'repositories', 'operator', 'ghe_login', 'email', 'user_id'])(
    '권한·매핑 주장 claim %s를 받지 않는다',
    async (name) => {
      const reason = (await expectInvalid(await sign(claims({ [name]: name === 'operator' ? true : ['x'] })))).reason;
      expect(reason).toBe(`claim_unexpected_${name}`);
    },
  );

  it.each([
    ['iat', { iat: String(NOW_S) }],
    ['exp', { exp: NOW_S + 30.5 }],
    ['auth_expires_at', { auth_expires_at: -1 }],
    ['sub', { sub: 'has space' }],
    ['sub', { sub: '' }],
    ['auth_context_id', { auth_context_id: 'short' }],
    ['jti', { jti: 'too-short' }],
    ['jti', { jti: 12345 }],
  ] as const)('%s 타입·형식 불량을 거절한다 (%j)', async (_name, override) => {
    await expectInvalid(await sign(claims(override)));
  });

  it('payload가 JSON 객체가 아니면 거절한다', async () => {
    await expectInvalid(await sign(['not', 'an', 'object']));
  });

  it('길이 상한을 넘으면 서명 검증 전에 거절한다', async () => {
    const huge = `${'a'.repeat(MAX_ASSERTION_LENGTH)}.b.c`;
    expect((await expectInvalid(huge)).reason).toBe('size');
  });

  it('JWS 세 구간이 아니면 거절한다', async () => {
    expect((await expectInvalid('only.two')).reason).toBe('format');
    expect((await expectInvalid('a.b.c.d')).reason).toBe('format');
  });
});

describe('PSI-A09 수명·시계 경계 (고정 시계, 허용 오차 5초)', () => {
  it('exp - iat = 60초는 받고 61초는 거절한다', async () => {
    await expect(verify(await sign(claims({ exp: NOW_S + 60 })))).resolves.toBeDefined();
    expect((await expectInvalid(await sign(claims({ exp: NOW_S + 61 })))).reason).toBe('ttl_too_long');
  });

  it('exp <= iat를 거절한다', async () => {
    expect((await expectInvalid(await sign(claims({ exp: NOW_S })))).reason).toBe('exp_not_after_iat');
  });

  it('iat가 5초 넘게 미래면 거절하고 5초까지는 받는다', async () => {
    await expect(verify(await sign(claims({ iat: NOW_S + 5, nbf: NOW_S + 5, exp: NOW_S + 65 })))).resolves.toBeDefined();
    expect((await expectInvalid(await sign(claims({ iat: NOW_S + 6, nbf: NOW_S + 6, exp: NOW_S + 66 })))).reason).toBe('iat_in_future');
  });

  it('nbf가 5초 넘게 미래면 거절한다', async () => {
    expect((await expectInvalid(await sign(claims({ nbf: NOW_S + 6 })))).reason).toBe('not_yet_valid');
  });

  it('만료 뒤 허용 오차(5초) 안은 받고 그 뒤는 거절한다', async () => {
    const token = await sign(claims({ iat: NOW_S - 60, nbf: NOW_S - 60, exp: NOW_S }));
    await expect(verify(token, 'grant', (NOW_S + 4) * 1000)).resolves.toBeDefined();
    expect((await expectInvalid(token, 'grant', (NOW_S + 5) * 1000)).reason).toBe('expired');
  });

  it('grant 목적이면 원 로그인 자격이 만료됐을 때 거절한다 (허용 오차로 늘리지 않는다)', async () => {
    expect((await expectInvalid(await sign(claims({ auth_expires_at: NOW_S })))).reason).toBe('auth_expired');
  });

  it('revoke_context 목적은 지난 auth_expires_at를 받는다', async () => {
    const token = await sign(claims({ purpose: 'revoke_context', auth_expires_at: NOW_S - 86_400 }));
    await expect(verify(token, 'revoke_context')).resolves.toMatchObject({ purpose: 'revoke_context' });
  });
});
