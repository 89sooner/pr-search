/**
 * 세션과 쿠키 (WP-012 DoD 2, DoD 3).
 *
 * 쿠키 속성 셋과 만료 둘은 FR-AUTH-001 AC-2·AC-3이 숫자까지 정한 것이라,
 * 여기서 확인하는 것은 "동작한다"가 아니라 "그 숫자 그대로인가"다.
 */

import { describe, expect, it } from 'vitest';
import {
  ABSOLUTE_TIMEOUT_MS,
  IDLE_TIMEOUT_MS,
  INSECURE_SESSION_COOKIE_NAME,
  SESSION_COOKIE_NAME,
  createSessionId,
  deadlinesOf,
  expiryOf,
  readSessionCookie,
  remainingTtlSeconds,
  serializeClearingCookie,
  serializeSessionCookie,
  sessionCookieName,
  type SessionRecord,
} from './session.js';

const T0 = Date.UTC(2026, 7, 21, 9, 0, 0);

function session(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    sessionId: 'sid',
    userId: 'sub-1',
    login: 'kim',
    email: 'kim@acme.example',
    roles: ['developer'],
    issuedAt: T0,
    lastSeenAt: T0,
    correlationId: null,
    ...overrides,
  };
}

describe('DoD 3: 만료', () => {
  it('유휴 만료는 8시간, 절대 만료는 12시간이다 (AC-3)', () => {
    expect(IDLE_TIMEOUT_MS).toBe(8 * 60 * 60 * 1000);
    expect(ABSOLUTE_TIMEOUT_MS).toBe(12 * 60 * 60 * 1000);
  });

  it('마지막 활동에서 8시간이 지나면 유휴 만료다', () => {
    const s = session();
    expect(expiryOf(s, T0 + IDLE_TIMEOUT_MS - 1)).toBeNull();
    expect(expiryOf(s, T0 + IDLE_TIMEOUT_MS)).toBe('idle');
  });

  it('계속 활동해도 발급에서 12시간이 지나면 만료다', () => {
    // 11시간 59분에 활동한 세션 — 유휴 만료는 한참 남았다.
    const s = session({ lastSeenAt: T0 + ABSOLUTE_TIMEOUT_MS - 60_000 });
    expect(expiryOf(s, T0 + ABSOLUTE_TIMEOUT_MS - 1)).toBeNull();
    expect(expiryOf(s, T0 + ABSOLUTE_TIMEOUT_MS)).toBe('absolute');
  });

  it('절대 만료가 유휴 만료보다 먼저 오면 절대 만료가 이긴다', () => {
    const s = session({ lastSeenAt: T0 + ABSOLUTE_TIMEOUT_MS - 1000 });
    // 이 시점의 유휴 마감은 절대 마감보다 훨씬 뒤다.
    expect(deadlinesOf(s).idleExpiresAt).toBeGreaterThan(deadlinesOf(s).absoluteExpiresAt);
    expect(expiryOf(s, T0 + ABSOLUTE_TIMEOUT_MS + 1)).toBe('absolute');
  });

  it('Redis 수명은 두 만료 중 이른 쪽까지다', () => {
    const s = session({ lastSeenAt: T0 + ABSOLUTE_TIMEOUT_MS - 30_000 });
    // 유휴 마감은 8시간 뒤지만 절대 마감은 30초 뒤다.
    expect(remainingTtlSeconds(s, T0 + ABSOLUTE_TIMEOUT_MS - 30_000)).toBe(30);
  });

  it('만료가 지난 세션의 수명은 음수가 아니라 1초다', () => {
    expect(remainingTtlSeconds(session(), T0 + ABSOLUTE_TIMEOUT_MS + 999_999)).toBe(1);
  });
});

describe('DoD 2: 쿠키 속성 (AC-2)', () => {
  it('HttpOnly·Secure·SameSite=Lax를 모두 단다', () => {
    const cookie = serializeSessionCookie('abc', { secure: true });
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Lax');
  });

  it('`__Host-` 접두의 조건인 Path=/를 두고 Domain을 두지 않는다', () => {
    const cookie = serializeSessionCookie('abc', { secure: true });
    expect(SESSION_COOKIE_NAME.startsWith('__Host-')).toBe(true);
    expect(cookie).toContain('Path=/');
    expect(cookie).not.toContain('Domain=');
  });

  it('개발 환경에서만 Secure를 뗀다', () => {
    expect(serializeSessionCookie('abc', { secure: false })).not.toContain('Secure');
  });

  /**
   * **`Secure`를 떼면 `__Host-` 접두도 뗀다** (`CR-091` / `DEV-694`).
   *
   * 브라우저는 `__Host-` 접두 쿠키에 `Secure`가 없으면 저장하지 않는다. 속성만 떼고 이름을
   * 두면 평문 HTTP 파일럿에서 `Set-Cookie`는 나가는데 브라우저가 버리고, 사용자는 로그인
   * 화면으로 되돌아온다. 사내 `0.1.0-pilot.6`이 막힌 모양이 그것이다.
   */
  it('Secure가 없는 쿠키에 __Host- 접두를 붙이지 않는다 — 브라우저가 버린다', () => {
    const insecure = serializeSessionCookie('abc', { secure: false });
    expect(insecure.startsWith(`${INSECURE_SESSION_COOKIE_NAME}=abc;`)).toBe(true);
    expect(insecure).not.toContain('__Host-');
    expect(serializeClearingCookie({ secure: false }).startsWith(`${INSECURE_SESSION_COOKIE_NAME}=;`)).toBe(true);

    const secure = serializeSessionCookie('abc', { secure: true });
    expect(secure.startsWith(`${SESSION_COOKIE_NAME}=abc;`)).toBe(true);
  });

  it('이름을 고르는 규칙은 하나다 — Secure일 때만 __Host-', () => {
    expect(sessionCookieName(true)).toBe(SESSION_COOKIE_NAME);
    expect(sessionCookieName(false)).toBe(INSECURE_SESSION_COOKIE_NAME);
    expect(INSECURE_SESSION_COOKIE_NAME.startsWith('__')).toBe(false);
  });

  it('로그아웃 쿠키는 Max-Age=0이고 값이 비어 있다', () => {
    const cookie = serializeClearingCookie({ secure: true });
    expect(cookie).toContain(`${SESSION_COOKIE_NAME}=;`);
    expect(cookie).toContain('Max-Age=0');
    expect(cookie).toContain('HttpOnly');
  });
});

describe('쿠키 읽기', () => {
  it('여러 쿠키 중 세션 쿠키만 꺼낸다', () => {
    expect(readSessionCookie(`theme=dark; ${SESSION_COOKIE_NAME}=xyz; lang=ko`)).toBe('xyz');
  });

  it('기본은 정본 이름만 읽는다 — search-api는 접두 없는 이름을 세션으로 받지 않는다 (CR-091)', () => {
    expect(readSessionCookie(`${INSECURE_SESSION_COOKIE_NAME}=xyz`)).toBeNull();
    expect(readSessionCookie(`${INSECURE_SESSION_COOKIE_NAME}=xyz`, INSECURE_SESSION_COOKIE_NAME)).toBe('xyz');
  });

  it('세션 쿠키가 없으면 null이다', () => {
    expect(readSessionCookie('theme=dark')).toBeNull();
    expect(readSessionCookie(undefined)).toBeNull();
    expect(readSessionCookie('')).toBeNull();
  });

  it('같은 이름이 두 번 오면 거절한다 — 쿠키 주입', () => {
    // 어느 쪽을 고르든 공격자가 원하는 값을 고르게 만드는 방법이 생긴다.
    expect(readSessionCookie(`${SESSION_COOKIE_NAME}=real; ${SESSION_COOKIE_NAME}=injected`)).toBeNull();
  });

  it('값이 빈 쿠키는 세션이 아니다', () => {
    expect(readSessionCookie(`${SESSION_COOKIE_NAME}=`)).toBeNull();
  });
});

describe('세션 ID', () => {
  it('매번 다르고, 추측하기 어려울 만큼 길다', () => {
    const ids = new Set(Array.from({ length: 200 }, () => createSessionId()));
    expect(ids.size).toBe(200);
    // 32바이트 base64url = 43자.
    expect([...ids][0]).toHaveLength(43);
  });

  it('URL·쿠키에 그대로 쓸 수 있는 문자만 쓴다', () => {
    for (let i = 0; i < 50; i += 1) {
      expect(createSessionId()).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });
});
