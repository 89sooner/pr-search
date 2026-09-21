/**
 * PIPE 사용자 assertion 검증 (CR-112 / ADR-025, 공통 계약 5.2, PSI-A05~A09).
 *
 * ## 서명은 `jose`가, 정책은 이 파일이 판정한다
 *
 * JWS 서명 검증은 검증된 구현(`jose` `compactVerify`, RS256 고정)에 맡긴다 — 서명을 직접
 * 구현하지 않는다(지시서 5절). 그 위의 **헤더·claim 정책은 계약이 정한 그대로** 여기서 판정한다.
 * `jose`의 `jwtVerify`를 쓰지 않는 이유는 그것이 `typ` 표기를 정규화하고 배열 `aud`를 받아 주기
 * 때문이다 — 이 계약은 둘 다 정확히 하나만 허용한다.
 *
 * ## 받지 않는 것
 *
 * - `alg`는 `RS256` 하나다. `none`·HS256(공개키를 HMAC 비밀로 쓰는 혼동)·RS384는 전부 거절한다.
 * - 헤더는 `alg`·`typ`·`kid` 셋만이다. `jku`·`x5u`·`jwk`·`x5c`·`crit`이 있으면 거절한다 —
 *   따라가지 않는 것만으로 부족하다. 있으면 이 형식이 아니다.
 * - `kid`는 등록된 로컬 키에서만 찾는다. 외부로 키를 가지러 가지 않는다 (PSI-A07).
 * - claim은 열두 개 정확히다. `roles`·`repositories`·`operator`·`ghe_login` 같은 권한·매핑 주장은
 *   이 profile에 없다. 모르는 claim이 하나라도 있으면 거절한다.
 *
 * 어느 검사에서 떨어졌는지는 응답에 싣지 않는다 (`ASSERTION_INVALID` 하나). 사유 코드는
 * 이벤트 기록으로만 간다.
 */

import { compactVerify, decodeProtectedHeader } from 'jose';
import type { KeyObject } from 'node:crypto';
import type { PipeClientPolicy } from './config.js';
import { PsiError } from './errors.js';

export const ASSERTION_TYP = 'pipe-user-assertion+jwt' as const;
/** 허용 시계 오차 (계약 5.2). grant의 실제 만료는 이 값으로 늘리지 않는다. */
export const CLOCK_SKEW_SECONDS = 5;
/** assertion 수명 상한 (`exp - iat`). */
export const MAX_ASSERTION_TTL_SECONDS = 60;
/** 압축 JWS 길이 상한. 서명 검증 전에 자른다 (PSI-A08). */
export const MAX_ASSERTION_LENGTH = 8192;

export type AssertionPurpose = 'grant' | 'revoke_context';

const ALLOWED_HEADER = new Set(['alg', 'typ', 'kid']);
const REQUIRED_CLAIMS = [
  'iss',
  'aud',
  'sub',
  'client_id',
  'purpose',
  'profile',
  'auth_context_id',
  'auth_expires_at',
  'iat',
  'nbf',
  'exp',
  'jti',
] as const;
const CLAIM_SET: ReadonlySet<string> = new Set(REQUIRED_CLAIMS);

const COMPACT_JWS = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const KID = /^[A-Za-z0-9._:-]{1,128}$/;
/** 공백·제어 문자 없는 가시 ASCII. PIPE의 불변 사용자 ID 형식을 가정하지 않고 이것만 요구한다. */
const SUBJECT = /^[\x21-\x7E]{1,256}$/;
/** 비밀이 아닌 불투명 로그인 문맥 값 (계약 5.2). */
const AUTH_CONTEXT_ID = /^[A-Za-z0-9._~:-]{8,256}$/;
/** 128비트 이상 난수의 base64url (22자 이상). */
const JTI = /^[A-Za-z0-9_-]{22,128}$/;

export interface VerifiedAssertion {
  readonly issuer: string;
  readonly audience: string;
  readonly subject: string;
  readonly clientId: string;
  readonly purpose: AssertionPurpose;
  readonly profile: string;
  readonly authContextId: string;
  /** 초 단위 epoch. */
  readonly authExpiresAt: number;
  readonly issuedAt: number;
  readonly notBefore: number;
  readonly expiresAt: number;
  readonly jti: string;
  readonly kid: string;
}

export interface VerifyAssertionInput {
  readonly client: PipeClientPolicy;
  readonly purpose: AssertionPurpose;
  readonly nowMs: number;
}

function invalid(reason: string): never {
  throw new PsiError('ASSERTION_INVALID', reason);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function integer(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) invalid(`claim_${name}_type`);
  return value;
}

function exactString(value: unknown, name: string, pattern: RegExp): string {
  if (typeof value !== 'string' || !pattern.test(value)) invalid(`claim_${name}_format`);
  return value;
}

/**
 * assertion 하나를 검증한다. 재생 소비는 여기서 하지 않는다 — 서명과 claim을 통과한 뒤
 * 호출부가 분산 저장소에서 원자적으로 소비한다 (공격자가 저장소를 채우지 못하게).
 *
 * @throws {PsiError} `ASSERTION_INVALID` — 형식·서명·claim 어느 것이든.
 */
export async function verifyAssertion(token: string, input: VerifyAssertionInput): Promise<VerifiedAssertion> {
  if (typeof token !== 'string' || token.length === 0 || token.length > MAX_ASSERTION_LENGTH) invalid('size');
  if (!COMPACT_JWS.test(token)) invalid('format');

  let header: Record<string, unknown>;
  try {
    header = decodeProtectedHeader(token) as Record<string, unknown>;
  } catch {
    invalid('header_decode');
  }
  for (const name of Object.keys(header)) {
    if (!ALLOWED_HEADER.has(name)) invalid(`header_param_${name.slice(0, 16)}`);
  }
  if (header['alg'] !== 'RS256') invalid('alg');
  if (header['typ'] !== ASSERTION_TYP) invalid('typ');
  const kid = header['kid'];
  if (typeof kid !== 'string' || !KID.test(kid)) invalid('kid_format');
  const key: KeyObject | undefined = input.client.signingKeys.get(kid);
  if (key === undefined) invalid('unknown_kid');

  let payloadBytes: Uint8Array;
  try {
    const verified = await compactVerify(token, key, { algorithms: ['RS256'] });
    payloadBytes = verified.payload;
  } catch {
    invalid('signature');
  }

  let claims: unknown;
  try {
    claims = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(payloadBytes));
  } catch {
    invalid('payload_json');
  }
  if (!isRecord(claims)) invalid('payload_object');
  for (const name of Object.keys(claims)) {
    if (!CLAIM_SET.has(name)) invalid(`claim_unexpected_${name.slice(0, 24)}`);
  }
  for (const name of REQUIRED_CLAIMS) {
    if (!(name in claims)) invalid(`claim_missing_${name}`);
  }

  // 발급자·대상·client·목적·profile — 정확히 하나의 값만 맞는다.
  if (claims['iss'] !== input.client.issuer) invalid('iss');
  if (typeof claims['aud'] !== 'string' || claims['aud'] !== input.client.audience) invalid('aud');
  if (claims['client_id'] !== input.client.clientId) invalid('client_id');
  if (claims['purpose'] !== input.purpose) invalid('purpose');
  if (claims['profile'] !== input.client.profile) invalid('profile');

  const subject = exactString(claims['sub'], 'sub', SUBJECT);
  const authContextId = exactString(claims['auth_context_id'], 'auth_context_id', AUTH_CONTEXT_ID);
  const jti = exactString(claims['jti'], 'jti', JTI);
  const iat = integer(claims['iat'], 'iat');
  const nbf = integer(claims['nbf'], 'nbf');
  const exp = integer(claims['exp'], 'exp');
  const authExpiresAt = integer(claims['auth_expires_at'], 'auth_expires_at');

  const now = Math.floor(input.nowMs / 1000);
  if (exp <= iat) invalid('exp_not_after_iat');
  if (exp - iat > MAX_ASSERTION_TTL_SECONDS) invalid('ttl_too_long');
  if (nbf > exp) invalid('nbf_after_exp');
  if (iat > now + CLOCK_SKEW_SECONDS) invalid('iat_in_future');
  if (nbf > now + CLOCK_SKEW_SECONDS) invalid('not_yet_valid');
  if (now >= exp + CLOCK_SKEW_SECONDS) invalid('expired');
  // grant 목적이면 원 로그인 자격이 아직 살아 있어야 한다. 회수 목적은 지난 값을 받는다 (계약 9장).
  if (input.purpose === 'grant' && authExpiresAt <= now) invalid('auth_expired');

  return {
    issuer: input.client.issuer,
    audience: input.client.audience,
    subject,
    clientId: input.client.clientId,
    purpose: input.purpose,
    profile: input.client.profile,
    authContextId,
    authExpiresAt,
    issuedAt: iat,
    notBefore: nbf,
    expiresAt: exp,
    jti,
    kid,
  };
}
