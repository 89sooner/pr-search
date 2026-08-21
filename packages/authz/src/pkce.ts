/**
 * PKCE와 일회용 값 (FR-AUTH-001, 보안 문서 4장).
 *
 * Authorization Code + PKCE에서 `code_verifier`는 **인가 요청과 토큰 교환을
 * 잇는 유일한 비밀**이다. 인가 코드가 리다이렉트 URL·브라우저 기록·프록시
 * 로그에 남더라도 verifier 없이는 토큰으로 바꿀 수 없다.
 *
 * `state`와 `nonce`는 목적이 다르다. `state`는 CSRF를 막고 (그리고 FLOW-000이
 * 요구하는 원래 경로를 나른다), `nonce`는 ID 토큰이 **이 로그인 시도에 대한
 * 응답**임을 확인한다 — 재생된 토큰을 거절하는 것은 `nonce`뿐이다.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** RFC 7636이 정한 verifier 길이 범위는 43~128자다. 32바이트 → 43자. */
const VERIFIER_BYTES = 32;
const STATE_BYTES = 32;
const NONCE_BYTES = 32;

function randomUrlSafe(bytes: number): string {
  return randomBytes(bytes).toString('base64url');
}

/** 인가 요청 하나에 대응하는 일회용 값 묶음. */
export interface AuthorizationRequest {
  readonly state: string;
  readonly nonce: string;
  readonly codeVerifier: string;
  readonly codeChallenge: string;
  /** 인증 후 돌아갈 경로 (FLOW-000 6단계). */
  readonly returnTo: string;
}

/**
 * `code_challenge`를 만든다 (`S256`).
 *
 * `plain` 방식은 지원하지 않는다. verifier가 그대로 URL에 실리면 PKCE가
 * 막으려던 것을 그대로 노출한다.
 */
export function codeChallengeOf(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

export function createAuthorizationRequest(returnTo: string): AuthorizationRequest {
  const codeVerifier = randomUrlSafe(VERIFIER_BYTES);
  return {
    state: randomUrlSafe(STATE_BYTES),
    nonce: randomUrlSafe(NONCE_BYTES),
    codeVerifier,
    codeChallenge: codeChallengeOf(codeVerifier),
    returnTo,
  };
}

/**
 * `state` 비교.
 *
 * 상수 시간 비교를 쓴다. 길이가 다르면 `timingSafeEqual`이 던지므로 먼저
 * 거른다 — 길이는 비밀이 아니다.
 */
export function statesMatch(expected: string, received: string): boolean {
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(received, 'utf8');
  if (a.length !== b.length || a.length === 0) return false;
  return timingSafeEqual(a, b);
}

/**
 * 돌아갈 경로를 안전하게 만든다 (FLOW-000).
 *
 * **열린 리다이렉트를 막는다.** `state`에 담긴 경로는 공격자가 고를 수 있는
 * 값이므로, 절대 URL·프로토콜 상대 URL(`//evil.example`)·역슬래시 변형을 전부
 * 거르고 같은 출처의 절대 경로만 남긴다.
 */
export function sanitizeReturnPath(candidate: string | undefined, fallback = '/'): string {
  if (candidate === undefined || candidate === '') return fallback;
  // 제어 문자는 헤더를 쪼갤 수 있다.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(candidate)) return fallback;
  if (!candidate.startsWith('/')) return fallback;
  // `//host`와 `/\host`는 둘 다 브라우저가 다른 출처로 읽는다.
  if (candidate.startsWith('//') || candidate.startsWith('/\\')) return fallback;
  return candidate;
}
