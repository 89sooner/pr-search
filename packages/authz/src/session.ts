/**
 * 서버 측 세션과 쿠키 (FR-AUTH-001 AC-2, AC-3, AC-5).
 *
 * 세션은 Redis에만 있고 쿠키에는 **불투명한 세션 ID만** 담긴다. 그래서
 * 로그아웃이 쿠키 삭제가 아니라 서버 측 무효화로 성립하고 (AC-5), 위조한
 * 쿠키 값은 아무 세션도 열지 못한다 (CR-015, DEV-047).
 *
 * 만료가 둘인 이유: 유휴 8시간은 자리를 비운 사람의 세션을 닫고, 절대 12시간은
 * **계속 쓰고 있는 세션도** 언젠가 다시 인증하게 만든다. 절대 만료가 없으면
 * 탈취된 세션이 활동만 유지하면 영원히 산다.
 */

import { randomBytes, timingSafeEqual } from 'node:crypto';

/** FR-AUTH-001 AC-3. */
export const IDLE_TIMEOUT_MS = 8 * 60 * 60 * 1000;
export const ABSOLUTE_TIMEOUT_MS = 12 * 60 * 60 * 1000;

/** 쿠키 이름. `__Host-` 접두는 도메인·경로를 브라우저가 강제하게 한다. */
export const SESSION_COOKIE_NAME = '__Host-prs_session';

/** 128비트로는 짧다. 세션 ID는 그 자체가 인증 수단이다. */
const SESSION_ID_BYTES = 32;

export interface SessionRecord {
  readonly sessionId: string;
  /** OIDC `sub` = `app_user.user_id` (CR-015, DEV-043). */
  readonly userId: string;
  readonly login: string;
  readonly email: string | null;
  readonly roles: readonly string[];
  readonly issuedAt: number;
  readonly lastSeenAt: number;
  /** 세션을 만든 요청의 상관 ID. 로그인 실패 조사에 쓴다. */
  readonly correlationId: string | null;
}

export function createSessionId(): string {
  return randomBytes(SESSION_ID_BYTES).toString('base64url');
}

export interface SessionDeadlines {
  readonly idleExpiresAt: number;
  readonly absoluteExpiresAt: number;
}

export function deadlinesOf(session: SessionRecord): SessionDeadlines {
  return {
    idleExpiresAt: session.lastSeenAt + IDLE_TIMEOUT_MS,
    absoluteExpiresAt: session.issuedAt + ABSOLUTE_TIMEOUT_MS,
  };
}

export type ExpiryReason = 'idle' | 'absolute';

/**
 * 만료 여부를 판정한다.
 *
 * 두 만료 중 **먼저 오는 쪽**이 이긴다. 절대 만료가 지났다면 방금 활동했더라도
 * 만료다 — 그것이 절대 만료의 정의다.
 */
export function expiryOf(session: SessionRecord, now: number): ExpiryReason | null {
  const deadlines = deadlinesOf(session);
  if (now >= deadlines.absoluteExpiresAt) return 'absolute';
  if (now >= deadlines.idleExpiresAt) return 'idle';
  return null;
}

/**
 * Redis에 남길 수명 (초).
 *
 * 두 만료 중 이른 쪽까지만 산다. 절대 만료를 넘겨 살려 두면 만료된 세션이
 * 메모리를 차지하고, 판정 버그 하나가 그것을 되살릴 수 있다.
 */
export function remainingTtlSeconds(session: SessionRecord, now: number): number {
  const deadlines = deadlinesOf(session);
  const until = Math.min(deadlines.idleExpiresAt, deadlines.absoluteExpiresAt);
  return Math.max(1, Math.ceil((until - now) / 1000));
}

export interface CookieOptions {
  /** 개발 환경(HTTP)에서만 false. 운영에서 false면 기동을 막는다. */
  readonly secure: boolean;
  readonly maxAgeSeconds?: number;
}

/**
 * `Set-Cookie` 값을 만든다 (FR-AUTH-001 AC-2).
 *
 * - `HttpOnly` — 브라우저 JavaScript가 세션 ID를 읽지 못한다 (THR-018).
 * - `Secure` — 평문 HTTP로 나가지 않는다.
 * - `SameSite=Lax` — 다른 사이트의 POST에 쿠키가 실리지 않는다 (CSRF).
 * - `Path=/` + `Domain` 없음 — `__Host-` 접두의 요구 조건이다.
 */
export function serializeSessionCookie(sessionId: string, options: CookieOptions): string {
  const parts = [`${SESSION_COOKIE_NAME}=${sessionId}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (options.secure) parts.push('Secure');
  if (options.maxAgeSeconds !== undefined) parts.push(`Max-Age=${String(options.maxAgeSeconds)}`);
  return parts.join('; ');
}

/** 로그아웃용. 서버 측 무효화와 **함께** 쓴다 — 이것만으로는 끝나지 않는다. */
export function serializeClearingCookie(options: CookieOptions): string {
  const parts = [`${SESSION_COOKIE_NAME}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (options.secure) parts.push('Secure');
  return parts.join('; ');
}

/**
 * `Cookie` 헤더에서 세션 ID를 꺼낸다.
 *
 * 같은 이름이 여러 번 오면 **거절한다.** 어느 쪽을 고르든 공격자가 원하는
 * 값을 고르게 만드는 방법이 생기기 때문이다 (쿠키 주입).
 */
export function readSessionCookie(header: string | undefined): string | null {
  if (header === undefined || header === '') return null;

  const found: string[] = [];
  for (const pair of header.split(';')) {
    const separator = pair.indexOf('=');
    if (separator < 0) continue;
    if (pair.slice(0, separator).trim() !== SESSION_COOKIE_NAME) continue;
    found.push(pair.slice(separator + 1).trim());
  }

  if (found.length !== 1) return null;
  const value = found[0];
  return value === undefined || value === '' ? null : value;
}

/** 세션 ID 비교. 저장소 조회 전에 형식을 거른다. */
export function sessionIdsMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length || left.length === 0) return false;
  return timingSafeEqual(left, right);
}
