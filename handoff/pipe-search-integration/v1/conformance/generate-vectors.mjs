#!/usr/bin/env node
/**
 * PSI-1.0 assertion 적합성 벡터 생성기 (CR-112).
 *
 * FIXTURE ONLY. 시험 전용 키 쌍이며 어떤 배포 환경에서도 쓰지 않는다. pr-search는 운영(NODE_ENV=production)에서
 * 이 공개키가 설정되어 있으면 기동을 거부한다.
 *
 * **비밀키는 저장소에 없다.** 이 저장소는 공개 저장소라 비밀키 파일을 커밋하지 않았다 — 공개키(`keys/`)와
 * 이 스크립트가 만든 `vectors.json`만 있다. 벡터를 다시 만들려면 비밀키 경로를 `PIPE_CONFORMANCE_PRIVATE_KEY`로
 * 준다. 비밀키를 잃었으면 새 키 쌍을 만들고 `keys/`의 공개키, 이 벡터, pr-search 설정의 거부 목록
 * (`FIXTURE_SIGNING_KEY_SPKI_SHA256`)을 함께 바꾼다.
 *
 * 서명 입력은 base64url(header) + "." + base64url(payload)이며 base64url은 패딩 없이 쓴다. PIPE 서명 구현은
 * `vectors.json`의 `header`·`payload`를 **같은 키 순서로** 직렬화해 서명 입력이 `token`의 앞 두 조각과 바이트
 * 단위로 같은지 보고, `token`의 서명을 공개키로 검증한다.
 *
 * 실행: PIPE_CONFORMANCE_PRIVATE_KEY=<비밀키 PEM 경로> node generate-vectors.mjs   (vectors.json을 다시 쓴다)
 */

import { Buffer } from 'node:buffer';
import { createHash, createPrivateKey, createPublicKey, sign } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { URL, fileURLToPath } from 'node:url';

const here = (name) => fileURLToPath(new URL(name, import.meta.url));

const privateKeyPath = process.env['PIPE_CONFORMANCE_PRIVATE_KEY'];
if (privateKeyPath === undefined || privateKeyPath === '') {
  process.stderr.write('PIPE_CONFORMANCE_PRIVATE_KEY에 시험 비밀키 PEM 경로를 주십시오 — 비밀키는 저장소에 없습니다.\n');
  process.exit(2);
}
const privateKey = createPrivateKey(readFileSync(privateKeyPath));
const publicPem = readFileSync(here('./keys/TEST-ONLY-pipe-conformance-signing.public.pem'), 'utf8');
const spkiSha256 = createHash('sha256')
  .update(createPublicKey(publicPem).export({ type: 'spki', format: 'der' }))
  .digest('hex');

/** 고정 시계: 2033-05-18T03:33:20Z. */
const NOW = 2_000_000_000;

const CLIENT = {
  client_id: 'pipe-conformance',
  issuer: 'urn:fixture:pipe:conformance',
  audience: 'urn:fixture:pr-search:pipe-integration:conformance',
  profile: 'search-read-v1',
  kid: 'pipe-conformance-2033-01',
};

const b64 = (value) => Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');

function header(overrides = {}) {
  return { alg: 'RS256', typ: 'pipe-user-assertion+jwt', kid: CLIENT.kid, ...overrides };
}

function payload(overrides = {}, omit = []) {
  const value = {
    iss: CLIENT.issuer,
    aud: CLIENT.audience,
    sub: 'fixture-corp-user-001',
    client_id: CLIENT.client_id,
    purpose: 'grant',
    profile: CLIENT.profile,
    auth_context_id: 'opaque-server-derived-login-context',
    auth_expires_at: NOW + 3600,
    iat: NOW,
    nbf: NOW,
    exp: NOW + 60,
    jti: 'conformance-jti-000000000001',
    ...overrides,
  };
  for (const name of omit) delete value[name];
  return value;
}

function signed(h, p) {
  const input = `${b64(h)}.${b64(p)}`;
  return `${input}.${sign('sha256', Buffer.from(input, 'utf8'), privateKey).toString('base64url')}`;
}

const accept = { result: 'accept' };
const reject = (reason) => ({ result: 'reject', status: 401, code: 'ASSERTION_INVALID', reason });

const cases = [
  ['V01-valid-grant', '정상 grant 목적 assertion', 'grant', NOW, header(), payload(), accept],
  ['V02-revoke-context-past-auth', '문맥 회수 목적은 지난 auth_expires_at를 받는다', 'revoke_context', NOW, header(), payload({ purpose: 'revoke_context', auth_expires_at: NOW - 3600 }), accept],
  ['V03-ttl-60', 'exp - iat = 60초는 받는다', 'grant', NOW, header(), payload({ exp: NOW + 60 }), accept],
  ['V04-ttl-61', 'exp - iat = 61초는 거절한다', 'grant', NOW, header(), payload({ exp: NOW + 61 }), reject('ttl_too_long')],
  ['V05-exp-equals-iat', 'exp <= iat는 거절한다', 'grant', NOW, header(), payload({ exp: NOW }), reject('exp_not_after_iat')],
  ['V06-iat-future-5s', 'iat가 5초 미래까지는 받는다', 'grant', NOW, header(), payload({ iat: NOW + 5, nbf: NOW + 5, exp: NOW + 65 }), accept],
  ['V07-iat-future-6s', 'iat가 6초 미래면 거절한다', 'grant', NOW, header(), payload({ iat: NOW + 6, nbf: NOW + 6, exp: NOW + 66 }), reject('iat_in_future')],
  ['V08-within-skew-after-exp', 'exp 뒤 4초(허용 오차 안)는 받는다', 'grant', NOW + 64, header(), payload(), accept],
  ['V09-expired-beyond-skew', 'exp 뒤 5초부터는 거절한다', 'grant', NOW + 65, header(), payload(), reject('expired')],
  ['V10-auth-expired', 'grant 목적인데 원 로그인 자격이 만료됐다', 'grant', NOW, header(), payload({ auth_expires_at: NOW }), reject('auth_expired')],
  ['V11-aud-array', 'aud가 배열이면 우리 값이 있어도 거절한다', 'grant', NOW, header(), payload({ aud: [CLIENT.audience] }), reject('aud')],
  ['V12-wrong-issuer', 'issuer가 다르다', 'grant', NOW, header(), payload({ iss: 'urn:fixture:pipe:other' }), reject('iss')],
  ['V13-wrong-client-id', 'client_id가 mTLS client와 다르다', 'grant', NOW, header(), payload({ client_id: 'pipe-other' }), reject('client_id')],
  ['V14-wrong-purpose', 'grant 경로에 revoke_context 목적', 'grant', NOW, header(), payload({ purpose: 'revoke_context' }), reject('purpose')],
  ['V15-extra-roles-claim', '권한 주장 claim(roles)은 받지 않는다', 'grant', NOW, header(), payload({ roles: ['operator'] }), reject('claim_unexpected_roles')],
  ['V16-extra-ghe-login-claim', '매핑 주장 claim(ghe_login)은 받지 않는다', 'grant', NOW, header(), payload({ ghe_login: 'someone' }), reject('claim_unexpected_ghe_login')],
  ['V17-missing-nbf', '12개 claim은 모두 필수다', 'grant', NOW, header(), payload({}, ['nbf']), reject('claim_missing_nbf')],
  ['V18-short-jti', 'jti는 128비트 이상(base64url 22자 이상)', 'grant', NOW, header(), payload({ jti: 'short-jti' }), reject('claim_jti_format')],
  ['V19-typ-jwt', 'typ은 정확히 pipe-user-assertion+jwt다', 'grant', NOW, header({ typ: 'JWT' }), payload(), reject('typ')],
  ['V20-unknown-kid', '등록되지 않은 kid', 'grant', NOW, header({ kid: 'pipe-conformance-unknown' }), payload(), reject('unknown_kid')],
  ['V21-jku-header', '토큰이 지정한 키 위치(jku)는 따라가지 않고 거절한다', 'grant', NOW, header({ jku: 'https://attacker.example/jwks.json' }), payload(), reject('header_param_jku')],
];

const vectors = cases.map(([id, description, purpose, now, h, p, expect]) => ({
  id,
  description,
  purpose,
  now,
  header: h,
  payload: p,
  token: signed(h, p),
  expect,
}));

// 서명 없는 `alg: none`은 직접 만든다 — 서명 구간이 비어 있다.
vectors.push({
  id: 'V22-alg-none',
  description: 'alg:none (서명 없음)은 거절한다',
  purpose: 'grant',
  now: NOW,
  header: { alg: 'none', typ: 'pipe-user-assertion+jwt', kid: CLIENT.kid },
  payload: payload(),
  token: `${b64({ alg: 'none', typ: 'pipe-user-assertion+jwt', kid: CLIENT.kid })}.${b64(payload())}.`,
  expect: reject('format'),
});

const document = {
  protocol_version: 'PSI-1.0',
  fixture_only: true,
  warning: 'FIXTURE ONLY — 공개된 시험 키로 만든 벡터다. 어떤 배포 환경에서도 이 키를 쓰지 않는다.',
  clock_now_seconds: NOW,
  clock_now_iso: new Date(NOW * 1000).toISOString(),
  client: CLIENT,
  public_key_pem: publicPem,
  public_key_spki_sha256: spkiSha256,
  serialization: 'token = base64url(JSON.stringify(header)) + "." + base64url(JSON.stringify(payload)) + "." + base64url(RSASSA-PKCS1-v1_5-SHA256)',
  vectors,
};

writeFileSync(here('./vectors.json'), `${JSON.stringify(document, null, 2)}\n`);
console.log(`vectors.json: ${String(vectors.length)}개`);
