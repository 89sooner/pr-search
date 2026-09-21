/**
 * PIPE 연동 구성 (CR-112 / PSI-G06 — 켰는데 모자라면 기동 거부, 시험 키는 운영 거부).
 */

import { createPublicKey, generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  FIXTURE_SIGNING_KEY_SPKI_SHA256,
  normalizeSha256,
  parsePolicyDocument,
  resolvePipeIntegrationConfig,
  resolvePipeIntegrationEnabled,
  spkiSha256,
} from './config.js';

const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
const shortRsa = generateKeyPairSync('rsa', { modulusLength: 1024 });
const ec = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const FIXTURE_PUBLIC_KEY = readFileSync(
  fileURLToPath(
    new URL(
      '../../../../../handoff/pipe-search-integration/v1/conformance/keys/TEST-ONLY-pipe-conformance-signing.public.pem',
      import.meta.url,
    ),
  ),
);

const PIN = 'AB:'.repeat(31) + 'AB';

function policy(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: 'pipe-search-integration-policy/v1',
    clients: [
      {
        client_id: 'pipe-dev',
        status: 'active',
        policy_version: 1,
        issuer: 'urn:test:pipe:dev',
        audience: 'urn:test:pr-search:pipe-integration:dev',
        profile: 'search-read-v1',
        signing_keys: [{ kid: 'pipe-signing-dev-1', public_key_file: '/keys/rsa.pem' }],
        tls_client: { certificate_sha256: [PIN], subject_alt_names: ['URI:spiffe://test/pipe-dev'] },
        repository_ids: [102, 101, 101],
        ...overrides,
      },
    ],
  };
}

function files(extra: Record<string, string | Buffer> = {}): (path: string) => Buffer {
  const map: Record<string, string | Buffer> = {
    '/keys/rsa.pem': rsa.publicKey.export({ type: 'spki', format: 'pem' }),
    '/keys/short.pem': shortRsa.publicKey.export({ type: 'spki', format: 'pem' }),
    '/keys/ec.pem': ec.publicKey.export({ type: 'spki', format: 'pem' }),
    '/keys/private.pem': rsa.privateKey.export({ type: 'pkcs8', format: 'pem' }),
    '/keys/fixture.pem': FIXTURE_PUBLIC_KEY,
    '/tls/server.key': 'server-key',
    '/tls/server.crt': 'server-cert',
    '/tls/client-ca.crt': 'client-ca',
    '/policy.json': JSON.stringify(policy()),
    ...extra,
  };
  return (path) => {
    const value = map[path];
    if (value === undefined) throw new Error('ENOENT');
    return Buffer.isBuffer(value) ? value : Buffer.from(value);
  };
}

const ENV = {
  PIPE_SEARCH_INTEGRATION_ENABLED: 'true',
  PIPE_SEARCH_INTEGRATION_HOST: '10.0.0.5',
  PIPE_SEARCH_INTEGRATION_PORT: '3443',
  PIPE_SEARCH_INTEGRATION_TLS_KEY_FILE: '/tls/server.key',
  PIPE_SEARCH_INTEGRATION_TLS_CERT_FILE: '/tls/server.crt',
  PIPE_SEARCH_INTEGRATION_TLS_CLIENT_CA_FILE: '/tls/client-ca.crt',
  PIPE_SEARCH_INTEGRATION_POLICY_FILE: '/policy.json',
  GHE_BASE_URL: 'https://GHE.corp.example/',
} as const;

describe('PIPE_SEARCH_INTEGRATION_ENABLED — 기본은 꺼짐, true만 켠다', () => {
  it('값이 없거나 false면 꺼짐이고 파일을 하나도 읽지 않는다', () => {
    const readFile = (): Buffer => {
      throw new Error('꺼진 배포가 파일을 읽었다');
    };
    expect(resolvePipeIntegrationConfig({}, { readFile })).toEqual({ enabled: false });
    expect(resolvePipeIntegrationConfig({ PIPE_SEARCH_INTEGRATION_ENABLED: 'false' }, { readFile })).toEqual({ enabled: false });
  });

  it.each(['TRUE', '1', 'yes', 'on'])('모르는 값 %s는 기동을 거부한다', (value) => {
    expect(() => resolvePipeIntegrationEnabled({ PIPE_SEARCH_INTEGRATION_ENABLED: value })).toThrow(/true 또는 false/);
  });
});

describe('켜면 전부 갖춰야 선다 (PSI-G06)', () => {
  it('정상 구성을 읽고 지문·저장소 목록을 정규화한다', () => {
    const setting = resolvePipeIntegrationConfig(ENV, { readFile: files() });
    if (!setting.enabled) throw new Error('켜져 있어야 한다');
    expect(setting.host).toBe('10.0.0.5');
    expect(setting.port).toBe(3443);
    expect(setting.gheHost).toBe('ghe.corp.example');
    const [client] = setting.clients;
    expect(client?.clientId).toBe('pipe-dev');
    expect(client?.repositoryIds).toEqual([101, 102]);
    expect([...(client?.certificateSha256 ?? [])]).toEqual(['ab'.repeat(32)]);
    expect(client?.signingKeys.has('pipe-signing-dev-1')).toBe(true);
  });

  it('AUTH_ENABLED=false를 명시한 개발 배포에서는 켤 수 없다', () => {
    expect(() => resolvePipeIntegrationConfig({ ...ENV, AUTH_ENABLED: 'false' }, { readFile: files() })).toThrow(/AUTH_ENABLED=false/);
  });

  it.each([
    'PIPE_SEARCH_INTEGRATION_HOST',
    'PIPE_SEARCH_INTEGRATION_PORT',
    'PIPE_SEARCH_INTEGRATION_TLS_KEY_FILE',
    'PIPE_SEARCH_INTEGRATION_TLS_CERT_FILE',
    'PIPE_SEARCH_INTEGRATION_TLS_CLIENT_CA_FILE',
    'PIPE_SEARCH_INTEGRATION_POLICY_FILE',
    'GHE_BASE_URL',
  ])('%s가 없으면 기동을 거부한다', (key) => {
    const env: Record<string, string> = { ...ENV };
    delete env[key];
    expect(() => resolvePipeIntegrationConfig(env, { readFile: files() })).toThrow(/PIPE 연동 구성 오류/);
  });

  it('파일을 읽지 못하면 거부하고 메시지에 파일 내용을 싣지 않는다', () => {
    expect(() =>
      resolvePipeIntegrationConfig({ ...ENV, PIPE_SEARCH_INTEGRATION_TLS_KEY_FILE: '/missing' }, { readFile: files() }),
    ).toThrow(/읽을 수 없다/);
  });

  it('공개 리스너와 같은 포트를 거부한다', () => {
    expect(() => resolvePipeIntegrationConfig({ ...ENV, SEARCH_API_PORT: '3443' }, { readFile: files() })).toThrow(/달라야 한다/);
  });

  it.each(['0', '65536', 'abc', '3443x'])('포트 %s를 거부한다', (port) => {
    expect(() => resolvePipeIntegrationConfig({ ...ENV, PIPE_SEARCH_INTEGRATION_PORT: port }, { readFile: files() })).toThrow();
  });

  it('정책 파일이 JSON이 아니면 거부한다', () => {
    expect(() => resolvePipeIntegrationConfig(ENV, { readFile: files({ '/policy.json': '{not json' }) })).toThrow(/JSON이 아니다/);
  });
});

describe('정책 파일 — 모르는 키·빈 허용 목록·약한 키를 받지 않는다', () => {
  const parse = (document: unknown, production = false) => parsePolicyDocument(document, files(), production);

  it('모르는 키(오타)를 거부한다', () => {
    expect(() => parse(policy({ repositry_ids: [1] }))).toThrow(/알 수 없는 키/);
    expect(() => parse({ ...policy(), extra: true })).toThrow(/알 수 없는 키/);
  });

  it('빈 저장소 허용 목록은 전부 거부라 구성 오류다', () => {
    expect(() => parse(policy({ repository_ids: [] }))).toThrow(/비어 있을 수 없다/);
  });

  it('허용 목록은 500개를 넘을 수 없다 — 교집합이 늘 명시 목록이 되게', () => {
    expect(() => parse(policy({ repository_ids: Array.from({ length: 501 }, (_, i) => i + 1) }))).toThrow(/500/);
  });

  it.each([[0], [-1], ['101'], [1.5]])('저장소 ID %j를 거부한다', (id) => {
    expect(() => parse(policy({ repository_ids: [id] }))).toThrow(/양의 정수/);
  });

  it('서명 공개키 자리에 비밀키가 오면 거부한다', () => {
    expect(() => parse(policy({ signing_keys: [{ kid: 'k', public_key_file: '/keys/private.pem' }] }))).toThrow(/비밀키/);
  });

  it('RSA가 아닌 키와 2048비트 미만 키를 거부한다', () => {
    expect(() => parse(policy({ signing_keys: [{ kid: 'k', public_key_file: '/keys/ec.pem' }] }))).toThrow(/RSA 공개키/);
    expect(() => parse(policy({ signing_keys: [{ kid: 'k', public_key_file: '/keys/short.pem' }] }))).toThrow(/너무 짧다/);
  });

  it('kid 중복을 거부한다', () => {
    const key = { kid: 'same', public_key_file: '/keys/rsa.pem' };
    expect(() => parse(policy({ signing_keys: [key, key] }))).toThrow(/중복/);
  });

  it('mTLS client 대조값이 하나도 없으면 거부한다 — IP만으로 client를 믿지 않는다', () => {
    expect(() => parse(policy({ tls_client: {} }))).toThrow(/하나 이상/);
    expect(() => parse(policy({ tls_client: { certificate_sha256: [], subject_alt_names: [] } }))).toThrow(/하나 이상/);
  });

  it('대조값 목록이 배열이 아니면 모양 오류로 거부한다', () => {
    expect(() => parse(policy({ tls_client: { certificate_sha256: PIN } }))).toThrow(/배열/);
    expect(() => parse(policy({ tls_client: { subject_alt_names: 7 } }))).toThrow(/배열/);
  });

  it('형식이 틀린 지문·SAN을 거부한다', () => {
    expect(() => parse(policy({ tls_client: { certificate_sha256: ['xyz'] } }))).toThrow(/SHA-256/);
    expect(() => parse(policy({ tls_client: { subject_alt_names: ['URI:a,b'] } }))).toThrow(/형식/);
    expect(() => parse(policy({ tls_client: { subject_alt_names: ['spiffe://no-prefix'] } }))).toThrow(/형식/);
  });

  it('한 인증서가 두 client를 가리키면 거부한다', () => {
    const first = (policy()['clients'] as Record<string, unknown>[])[0] ?? {};
    const second = { ...first, client_id: 'pipe-other', tls_client: { certificate_sha256: [PIN] } };
    expect(() => parse({ schema: 'pipe-search-integration-policy/v1', clients: [first, second] })).toThrow(/두 client/);
  });

  it('profile은 search-read-v1만 받는다', () => {
    expect(() => parse(policy({ profile: 'search-write-v1' }))).toThrow(/search-read-v1/);
  });
});

describe('적합성 시험 키는 운영에서 기동을 거부한다 (계약 11장)', () => {
  it('handoff의 시험 공개키 지문이 거부 목록에 있다', () => {
    expect(FIXTURE_SIGNING_KEY_SPKI_SHA256.has(spkiSha256(createPublicKey(FIXTURE_PUBLIC_KEY)))).toBe(true);
  });

  it('NODE_ENV=production이면 거부하고 개발에서는 받는다', () => {
    const fixture = policy({ signing_keys: [{ kid: 'fixture', public_key_file: '/keys/fixture.pem' }] });
    const readFile = files({ '/policy.json': JSON.stringify(fixture) });
    expect(() => resolvePipeIntegrationConfig({ ...ENV, NODE_ENV: 'production' }, { readFile })).toThrow(/적합성 시험 키/);
    expect(resolvePipeIntegrationConfig({ ...ENV, NODE_ENV: 'development' }, { readFile }).enabled).toBe(true);
  });
});

describe('normalizeSha256', () => {
  it('콜론·대소문자 표기를 소문자 hex 하나로 맞춘다', () => {
    expect(normalizeSha256(PIN)).toBe('ab'.repeat(32));
    expect(normalizeSha256('AB'.repeat(32))).toBe('ab'.repeat(32));
    expect(normalizeSha256('ab')).toBeNull();
  });
});
