/**
 * ID 토큰 검증 (FR-AUTH-001 AC-4).
 *
 * "토큰 서명과 발급자, 대상, 만료를 모두 검증한다"에 `nonce`를 더한 다섯을
 * 검증한다 (보안 문서 4장). 다섯 중 **하나라도 빼면 검증이 아니다.**
 *
 * - 서명 없이 믿으면 누구나 토큰을 만든다.
 * - `iss` 없이 믿으면 다른 IdP의 토큰이 통과한다.
 * - `aud` 없이 믿으면 같은 IdP의 **다른 앱**에 발급된 토큰이 통과한다.
 * - `exp` 없이 믿으면 한 번 유출된 토큰이 영원히 산다.
 * - `nonce` 없이 믿으면 가로챈 토큰을 재생할 수 있다.
 *
 * `alg`는 헤더가 아니라 **우리가 허용한 목록**으로 판정한다. 헤더의 `alg`를
 * 그대로 믿으면 `none`이나 HMAC으로 바꿔치기하는 고전적인 우회가 열린다.
 */

import { createVerify, timingSafeEqual, verify as verifySignature, type KeyObject } from 'node:crypto';
import { OidcError } from './errors.js';
import { isSupportedAlgorithm, type SupportedAlgorithm } from './jwks.js';

/** 시계 오차 허용치. IdP와 우리 시계가 정확히 같을 수는 없다. */
export const CLOCK_SKEW_SECONDS = 60;

export interface IdTokenClaims {
  readonly sub: string;
  readonly iss: string;
  readonly aud: string | readonly string[];
  readonly exp: number;
  readonly iat?: number;
  readonly nonce?: string;
  readonly email?: string;
  readonly preferred_username?: string;
  readonly name?: string;
  readonly groups?: readonly string[];
  readonly [claim: string]: unknown;
}

export interface VerifyOptions {
  readonly issuer: string;
  readonly audience: string;
  readonly expectedNonce: string;
  readonly getKey: (kid: string) => Promise<KeyObject>;
  readonly now?: () => number;
}

interface JwtHeader {
  readonly alg?: unknown;
  readonly kid?: unknown;
  readonly typ?: unknown;
}

function decodeSegment(segment: string, what: string): Record<string, unknown> {
  let json: string;
  try {
    json = Buffer.from(segment, 'base64url').toString('utf8');
  } catch {
    throw new OidcError(`${what}를 디코딩할 수 없다`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new OidcError(`${what}가 JSON이 아니다`);
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new OidcError(`${what}가 객체가 아니다`);
  }
  return parsed as Record<string, unknown>;
}

/** ECDSA 서명은 JWS에서 raw (r||s) 형식이라 DER로 다루지 않는다. */
function verifyOne(
  alg: SupportedAlgorithm,
  signingInput: string,
  signature: Buffer,
  key: KeyObject,
): boolean {
  if (alg.startsWith('ES')) {
    const hash = alg === 'ES256' ? 'sha256' : 'sha384';
    return verifySignature(hash, Buffer.from(signingInput, 'utf8'), { key, dsaEncoding: 'ieee-p1363' }, signature);
  }

  const verifier = createVerify(alg === 'RS256' ? 'RSA-SHA256' : alg === 'RS384' ? 'RSA-SHA384' : 'RSA-SHA512');
  verifier.update(signingInput);
  verifier.end();
  return verifier.verify(key, signature);
}

function audienceMatches(aud: unknown, expected: string): boolean {
  if (typeof aud === 'string') return constantTimeEquals(aud, expected);
  if (Array.isArray(aud)) return aud.some((one) => typeof one === 'string' && constantTimeEquals(one, expected));
  return false;
}

function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length || left.length === 0) return false;
  return timingSafeEqual(left, right);
}

/**
 * ID 토큰을 검증하고 클레임을 돌려준다.
 *
 * @throws {OidcError} 다섯 검사 중 하나라도 실패하면. **토큰 자체는 메시지에
 * 담지 않는다** (NFR-005: 로그·응답에 토큰 0건).
 */
export async function verifyIdToken(token: string, options: VerifyOptions): Promise<IdTokenClaims> {
  const parts = token.split('.');
  if (parts.length !== 3) throw new OidcError('ID 토큰이 JWS 3구간 형식이 아니다');

  const [headerSegment, payloadSegment, signatureSegment] = parts as [string, string, string];
  const header = decodeSegment(headerSegment, 'ID 토큰 헤더') as JwtHeader;

  if (typeof header.alg !== 'string' || !isSupportedAlgorithm(header.alg)) {
    // `none`이 여기서 막힌다.
    throw new OidcError(`지원하지 않는 서명 알고리즘이다: ${String(header.alg)}`);
  }
  if (typeof header.kid !== 'string' || header.kid === '') {
    throw new OidcError('ID 토큰 헤더에 kid가 없다');
  }

  const key = await options.getKey(header.kid);
  const signature = Buffer.from(signatureSegment, 'base64url');
  if (!verifyOne(header.alg, `${headerSegment}.${payloadSegment}`, signature, key)) {
    throw new OidcError('ID 토큰 서명이 맞지 않는다');
  }

  const claims = decodeSegment(payloadSegment, 'ID 토큰 payload') as unknown as IdTokenClaims;

  if (typeof claims.iss !== 'string' || !constantTimeEquals(claims.iss, options.issuer)) {
    throw new OidcError('발급자(iss)가 기대와 다르다');
  }
  if (!audienceMatches(claims.aud, options.audience)) {
    throw new OidcError('대상(aud)이 이 클라이언트가 아니다');
  }
  if (typeof claims.exp !== 'number' || !Number.isFinite(claims.exp)) {
    throw new OidcError('만료(exp)가 없다');
  }

  const nowSeconds = Math.floor((options.now ?? Date.now)() / 1000);
  if (claims.exp + CLOCK_SKEW_SECONDS <= nowSeconds) {
    throw new OidcError('ID 토큰이 만료됐다');
  }
  if (typeof claims.iat === 'number' && claims.iat - CLOCK_SKEW_SECONDS > nowSeconds) {
    throw new OidcError('ID 토큰의 발급 시각(iat)이 미래다');
  }
  if (typeof claims.nonce !== 'string' || !constantTimeEquals(claims.nonce, options.expectedNonce)) {
    // 재생 공격이 여기서 막힌다.
    throw new OidcError('nonce가 이 로그인 시도의 것이 아니다');
  }
  if (typeof claims.sub !== 'string' || claims.sub === '') {
    throw new OidcError('주체(sub)가 없다');
  }

  return claims;
}
