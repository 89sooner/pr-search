/**
 * PIPE 연동 구성 (CR-112 / ADR-025, FR-INT-001 AC-11).
 *
 * ## 기본은 꺼짐이고, 켜면 전부 갖춰야 선다
 *
 * `PIPE_SEARCH_INTEGRATION_ENABLED=true`만 켠다. 켰는데 리스너·TLS·신뢰 client·서명 키·
 * 저장소 허용 목록 중 하나라도 없으면 **던진다** — 기동을 거부한다 (`MNUMBER_ENABLED`,
 * `GH_OPERATIONS_ENABLED`와 같은 규율). 조용히 일부만 선 연동은 "켰다고 믿는 운영자"와
 * "실제로는 열려 있지 않은 경로"(또는 그 반대)를 만든다.
 *
 * `AUTH_ENABLED=false`를 **명시한** 개발 배포에서는 켤 수 없다 (지시서 5절). 인증을 끈
 * 개발 설정이 새 연동을 자동으로 허용하는 모양을 만들지 않는다.
 *
 * ## 무엇을 설정 파일에 두는가
 *
 * 신뢰 재료(서명 공개키·인증서 대조값·저장소 허용 목록)는 **배포 설정**이다. 토큰의 `jku`·`x5u`·
 * `jwk`로 키를 가져오지 않는다 (계약 5.1). 긴급 회수만 DB(`ENT-INT-004`)가 즉시 반영한다.
 */

import { createHash, createPublicKey, type KeyObject } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { EXPLICIT_SCOPE_LIMIT } from '@prs/es';

export const PIPE_PROFILE = 'search-read-v1' as const;
export const POLICY_SCHEMA = 'pipe-search-integration-policy/v1' as const;

/**
 * 적합성 시험 키의 SPKI SHA-256 (handoff `conformance/keys`).
 *
 * **운영에서 이 키가 설정되어 있으면 기동을 거부한다** (계약 11장, PSI-G06). 시험 키는
 * 공개된 자료에 들어 있으므로 누구나 그 키로 서명할 수 있다.
 */
export const FIXTURE_SIGNING_KEY_SPKI_SHA256: ReadonlySet<string> = new Set([
  'a09ce41e6e4304fb8117b867340cee2b15001b6247984e64951cce1f0639dfb1',
]);

export interface PipeIntegrationEnv {
  readonly [key: string]: string | undefined;
}

/** 등록된 통합 client 하나 — 설정 파일 한 항목. */
export interface PipeClientPolicy {
  readonly clientId: string;
  readonly status: 'active' | 'disabled';
  /** 추적용. 정책의 효력은 요청마다 다시 평가하므로 이 값으로 grant를 죽이지 않는다. */
  readonly policyVersion: number;
  readonly issuer: string;
  readonly audience: string;
  readonly profile: typeof PIPE_PROFILE;
  /** `kid` → RSA 공개키. 등록된 것만 쓴다. */
  readonly signingKeys: ReadonlyMap<string, KeyObject>;
  /** mTLS leaf 인증서 SHA-256 (소문자 hex). */
  readonly certificateSha256: ReadonlySet<string>;
  /** mTLS 인증서의 subjectAltName 항목 정확 일치 (`URI:…`, `DNS:…`). */
  readonly subjectAltNames: ReadonlySet<string>;
  /** 이 client가 볼 수 있는 등록 저장소 ID. 비어 있을 수 없다 — 빈 목록은 전부 거부다. */
  readonly repositoryIds: readonly number[];
}

export interface PipeIntegrationEnabled {
  readonly enabled: true;
  readonly host: string;
  readonly port: number;
  readonly tls: { readonly key: Buffer; readonly cert: Buffer; readonly clientCa: Buffer };
  readonly clients: readonly PipeClientPolicy[];
  /** 이 배포의 GHE 호스트. binding의 `ghe_host`가 이것과 같아야 한다 (PSI-B06). */
  readonly gheHost: string;
}

export type PipeIntegrationSetting = { readonly enabled: false } | PipeIntegrationEnabled;

export interface ResolveOptions {
  readonly readFile?: (path: string) => Buffer;
}

const CLIENT_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const KID = /^[A-Za-z0-9._:-]{1,128}$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;
/** Node가 `subjectaltname`을 쉼표로 이어 주므로 값에 쉼표·따옴표가 들어간 항목은 받지 않는다. */
const SAN = /^(DNS|URI|IP Address|email):[\x21\x23-\x2B\x2D-\x7E]{1,500}$/;

function fail(message: string): never {
  throw new Error(`PIPE 연동 구성 오류 (CR-112): ${message}`);
}

/** `true`만 켠다. 오타를 켜짐으로 읽지 않고, 알 수 없는 값은 기동을 거부한다. */
export function resolvePipeIntegrationEnabled(env: PipeIntegrationEnv): boolean {
  const raw = (env['PIPE_SEARCH_INTEGRATION_ENABLED'] ?? '').trim();
  if (raw === 'true') return true;
  if (raw === '' || raw === 'false') return false;
  throw new Error(`PIPE_SEARCH_INTEGRATION_ENABLED는 true 또는 false여야 한다: '${raw}'`);
}

function requiredEnv(env: PipeIntegrationEnv, key: string): string {
  const value = (env[key] ?? '').trim();
  if (value === '') fail(`${key}가 설정되지 않았다`);
  return value;
}

/** 인증서 지문 표기(`AB:CD:…`·대소문자)를 소문자 hex 하나로 맞춘다. */
export function normalizeSha256(raw: string): string | null {
  const value = raw.replace(/:/g, '').trim().toLowerCase();
  return SHA256_HEX.test(value) ? value : null;
}

/** 공개키의 SPKI SHA-256 — 시험 키 거부와 운영 로그에 쓴다. 비밀이 아니다. */
export function spkiSha256(key: KeyObject): string {
  return createHash('sha256').update(key.export({ type: 'spki', format: 'der' })).digest('hex');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 모르는 키를 거절한다 — 오타(`repositry_ids`)가 조용히 기본값이 되지 않게. */
function exactKeys(value: Record<string, unknown>, allowed: readonly string[], where: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) fail(`${where}에 알 수 없는 키가 있다: '${key}'`);
  }
}

function text(value: unknown, where: string, max = 256): string {
  if (typeof value !== 'string' || value.trim() !== value || value === '' || value.length > max) {
    fail(`${where}는 앞뒤 공백 없는 1~${String(max)}자 문자열이어야 한다`);
  }
  if ([...value].some((char) => char.charCodeAt(0) < 0x21 || char.charCodeAt(0) === 0x7f)) {
    fail(`${where}에 공백·제어 문자를 쓸 수 없다`);
  }
  return value;
}

function loadSigningKey(pem: Buffer, where: string, production: boolean): KeyObject {
  const source = pem.toString('utf8');
  // 서명 비밀키를 pr-search에 두지 않는다. 공개키 자리에 비밀키가 오면 구성 실수다.
  if (/PRIVATE KEY/.test(source)) fail(`${where}에 비밀키가 들어 있다 — 공개키(SPKI PEM)만 둔다`);
  let key: KeyObject;
  try {
    key = createPublicKey(source);
  } catch {
    fail(`${where}를 공개키로 읽을 수 없다`);
  }
  if (key.asymmetricKeyType !== 'rsa') fail(`${where}는 RSA 공개키여야 한다 (RS256 고정)`);
  const bits = key.asymmetricKeyDetails?.modulusLength ?? 0;
  if (bits < 2048) fail(`${where}의 RSA 키가 너무 짧다 (${String(bits)}비트, 최소 2048)`);
  if (production && FIXTURE_SIGNING_KEY_SPKI_SHA256.has(spkiSha256(key))) {
    fail(`${where}는 공개된 적합성 시험 키다 — 운영에서 쓸 수 없다`);
  }
  return key;
}

function parseClient(
  raw: unknown,
  index: number,
  readFile: (path: string) => Buffer,
  production: boolean,
): PipeClientPolicy {
  const where = `clients[${String(index)}]`;
  if (!isRecord(raw)) fail(`${where}는 객체여야 한다`);
  exactKeys(
    raw,
    ['client_id', 'status', 'policy_version', 'issuer', 'audience', 'profile', 'signing_keys', 'tls_client', 'repository_ids'],
    where,
  );

  const clientId = text(raw['client_id'], `${where}.client_id`, 64);
  if (!CLIENT_ID.test(clientId)) fail(`${where}.client_id는 소문자·숫자·._- 1~64자여야 한다`);

  const status = raw['status'];
  if (status !== 'active' && status !== 'disabled') fail(`${where}.status는 active 또는 disabled다`);

  const policyVersion = raw['policy_version'];
  if (typeof policyVersion !== 'number' || !Number.isSafeInteger(policyVersion) || policyVersion < 1) {
    fail(`${where}.policy_version은 1 이상의 정수다`);
  }

  const issuer = text(raw['issuer'], `${where}.issuer`);
  const audience = text(raw['audience'], `${where}.audience`);
  if (raw['profile'] !== PIPE_PROFILE) fail(`${where}.profile은 '${PIPE_PROFILE}'만 지원한다`);

  const keysRaw = raw['signing_keys'];
  if (!Array.isArray(keysRaw) || keysRaw.length === 0 || keysRaw.length > 8) {
    fail(`${where}.signing_keys는 1~8개여야 한다`);
  }
  const signingKeys = new Map<string, KeyObject>();
  keysRaw.forEach((entry: unknown, keyIndex) => {
    const keyWhere = `${where}.signing_keys[${String(keyIndex)}]`;
    if (!isRecord(entry)) fail(`${keyWhere}는 객체여야 한다`);
    exactKeys(entry, ['kid', 'public_key_file'], keyWhere);
    const kid = text(entry['kid'], `${keyWhere}.kid`, 128);
    if (!KID.test(kid)) fail(`${keyWhere}.kid 형식이 틀렸다`);
    if (signingKeys.has(kid)) fail(`${keyWhere}.kid가 중복이다`);
    const file = text(entry['public_key_file'], `${keyWhere}.public_key_file`, 1024);
    let pem: Buffer;
    try {
      pem = readFile(file);
    } catch {
      fail(`${keyWhere}.public_key_file을 읽을 수 없다`);
    }
    signingKeys.set(kid, loadSigningKey(pem, keyWhere, production));
  });

  const tlsRaw = raw['tls_client'];
  if (!isRecord(tlsRaw)) fail(`${where}.tls_client는 객체여야 한다`);
  exactKeys(tlsRaw, ['certificate_sha256', 'subject_alt_names'], `${where}.tls_client`);
  // 모양을 먼저 본다 — 문자열이 오면 글자 단위로 돌며 엉뚱한 오류를 내고, 숫자가 오면 `fail` 밖에서 던진다.
  const pinsRaw = tlsRaw['certificate_sha256'] ?? [];
  const sansRaw = tlsRaw['subject_alt_names'] ?? [];
  if (!Array.isArray(pinsRaw) || !Array.isArray(sansRaw)) fail(`${where}.tls_client의 두 목록은 배열이어야 한다`);
  const pins = new Set<string>();
  for (const value of pinsRaw as unknown[]) {
    const pin = typeof value === 'string' ? normalizeSha256(value) : null;
    if (pin === null) fail(`${where}.tls_client.certificate_sha256 항목이 SHA-256 지문이 아니다`);
    pins.add(pin);
  }
  const sans = new Set<string>();
  for (const value of sansRaw as unknown[]) {
    if (typeof value !== 'string' || !SAN.test(value)) {
      fail(`${where}.tls_client.subject_alt_names 항목은 'URI:…'·'DNS:…' 형식의 정확한 값이다`);
    }
    sans.add(value);
  }
  if (pins.size === 0 && sans.size === 0) {
    fail(`${where}.tls_client에 인증서 지문이나 subjectAltName이 하나 이상 있어야 한다 — IP만으로 client를 믿지 않는다`);
  }

  const reposRaw = raw['repository_ids'];
  if (!Array.isArray(reposRaw) || reposRaw.length === 0) {
    fail(`${where}.repository_ids는 비어 있을 수 없다 — 빈 허용 목록은 전부 거부다`);
  }
  if (reposRaw.length > EXPLICIT_SCOPE_LIMIT) {
    // 교집합이 언제나 명시적 목록(`explicit`)으로 표현되게 한다 (ADR-008의 전환 임계).
    fail(`${where}.repository_ids는 ${String(EXPLICIT_SCOPE_LIMIT)}개를 넘을 수 없다`);
  }
  const repositoryIds = new Set<number>();
  for (const id of reposRaw) {
    if (typeof id !== 'number' || !Number.isSafeInteger(id) || id < 1) {
      fail(`${where}.repository_ids 항목은 양의 정수(등록 저장소 ID)다`);
    }
    repositoryIds.add(id);
  }

  return {
    clientId,
    status,
    policyVersion,
    issuer,
    audience,
    profile: PIPE_PROFILE,
    signingKeys,
    certificateSha256: pins,
    subjectAltNames: sans,
    repositoryIds: [...repositoryIds].sort((a, b) => a - b),
  };
}

/** 설정 파일 본문을 client 목록으로 읽는다. 시험이 파일 없이 부를 수 있게 따로 둔다. */
export function parsePolicyDocument(
  raw: unknown,
  readFile: (path: string) => Buffer,
  production: boolean,
): readonly PipeClientPolicy[] {
  if (!isRecord(raw)) fail('정책 파일이 JSON 객체가 아니다');
  exactKeys(raw, ['schema', 'clients'], '정책 파일');
  if (raw['schema'] !== POLICY_SCHEMA) fail(`정책 파일 schema는 '${POLICY_SCHEMA}'여야 한다`);
  const clientsRaw = raw['clients'];
  if (!Array.isArray(clientsRaw) || clientsRaw.length === 0 || clientsRaw.length > 16) {
    fail('clients는 1~16개여야 한다');
  }
  const clients = clientsRaw.map((entry: unknown, index) => parseClient(entry, index, readFile, production));

  // 한 인증서가 두 client를 가리키면 어느 client인지 정할 수 없다. 기동 때 막는다.
  const seenIds = new Set<string>();
  const seenPins = new Set<string>();
  const seenSans = new Set<string>();
  for (const client of clients) {
    if (seenIds.has(client.clientId)) fail(`client_id가 중복이다: ${client.clientId}`);
    seenIds.add(client.clientId);
    for (const pin of client.certificateSha256) {
      if (seenPins.has(pin)) fail('같은 인증서 지문이 두 client에 등록되어 있다');
      seenPins.add(pin);
    }
    for (const san of client.subjectAltNames) {
      if (seenSans.has(san)) fail('같은 subjectAltName이 두 client에 등록되어 있다');
      seenSans.add(san);
    }
  }
  return clients;
}

/** `GHE_BASE_URL`의 호스트. binding 대조의 기준이다. */
export function gheHostOf(gheBaseUrl: string | null): string | null {
  if (gheBaseUrl === null || gheBaseUrl === '') return null;
  try {
    return new URL(gheBaseUrl).host.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * 연동 구성을 정한다.
 *
 * @throws 켰는데 무엇 하나라도 모자라거나 틀리면. 메시지에 파일 내용·키 값을 싣지 않는다.
 */
export function resolvePipeIntegrationConfig(
  env: PipeIntegrationEnv = process.env,
  options: ResolveOptions = {},
): PipeIntegrationSetting {
  if (!resolvePipeIntegrationEnabled(env)) return { enabled: false };

  if (env['AUTH_ENABLED'] === 'false') {
    fail('AUTH_ENABLED=false인 배포에서는 켤 수 없다 — 인증을 끈 개발 설정이 연동을 허용하지 않는다');
  }
  const production = (env['NODE_ENV'] ?? 'development') === 'production';
  const readFile = options.readFile ?? ((path: string) => readFileSync(path));

  const host = requiredEnv(env, 'PIPE_SEARCH_INTEGRATION_HOST');
  const portRaw = requiredEnv(env, 'PIPE_SEARCH_INTEGRATION_PORT');
  const port = Number(portRaw);
  if (!/^[0-9]+$/.test(portRaw) || !Number.isInteger(port) || port < 1 || port > 65535) {
    fail('PIPE_SEARCH_INTEGRATION_PORT는 1~65535의 정수다');
  }
  const publicPort = Number(env['SEARCH_API_PORT'] ?? '3002');
  if (port === publicPort) fail('PIPE_SEARCH_INTEGRATION_PORT는 공개 리스너(SEARCH_API_PORT)와 달라야 한다');

  const read = (key: string): Buffer => {
    const path = requiredEnv(env, key);
    try {
      return readFile(path);
    } catch {
      fail(`${key}가 가리키는 파일을 읽을 수 없다`);
    }
  };
  const tls = {
    key: read('PIPE_SEARCH_INTEGRATION_TLS_KEY_FILE'),
    cert: read('PIPE_SEARCH_INTEGRATION_TLS_CERT_FILE'),
    clientCa: read('PIPE_SEARCH_INTEGRATION_TLS_CLIENT_CA_FILE'),
  };

  let policy: unknown;
  try {
    policy = JSON.parse(read('PIPE_SEARCH_INTEGRATION_POLICY_FILE').toString('utf8'));
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('PIPE 연동 구성 오류')) throw error;
    fail('PIPE_SEARCH_INTEGRATION_POLICY_FILE이 JSON이 아니다');
  }
  const clients = parsePolicyDocument(policy, readFile, production);

  const gheHost = gheHostOf((env['GHE_BASE_URL'] ?? '').trim().replace(/\/+$/, ''));
  if (gheHost === null) fail('GHE_BASE_URL이 없다 — binding의 GHE 호스트를 대조할 기준이 없다');

  return { enabled: true, host, port, tls, clients, gheHost };
}
