/** rate limit 상태 전이 (FR-ING-004 AC-2). */

import { describe, expect, it } from 'vitest';
import {
  INITIAL_STATE,
  applyResponse,
  applySecondaryLimit,
  isAvailable,
  parseRateLimitHeaders,
  parseRetryAfter,
} from './rate-limit.js';

const NOW = new Date('2026-08-20T12:00:00.000Z');
const RESET = new Date('2026-08-20T13:00:00.000Z');

function headers(values: Record<string, string>): { get(name: string): string | null } {
  return { get: (name: string): string | null => values[name.toLowerCase()] ?? null };
}

describe('헤더 파싱', () => {
  it('x-ratelimit-* 세 값을 읽는다', () => {
    const snapshot = parseRateLimitHeaders(
      headers({
        'x-ratelimit-limit': '5000',
        'x-ratelimit-remaining': '4200',
        'x-ratelimit-reset': String(Math.floor(RESET.getTime() / 1000)),
      }),
      NOW,
    );
    expect(snapshot).toMatchObject({ limit: 5000, remaining: 4200 });
    expect(snapshot?.resetAt.toISOString()).toBe(RESET.toISOString());
  });

  it('헤더가 없으면 undefined다 — 0으로 넘기지 않는다', () => {
    expect(parseRateLimitHeaders(headers({}), NOW)).toBeUndefined();
  });

  it('retry-after를 초와 HTTP 날짜 양쪽으로 읽는다', () => {
    expect(parseRetryAfter(headers({ 'retry-after': '30' }), NOW)?.toISOString()).toBe(
      new Date(NOW.getTime() + 30_000).toISOString(),
    );
    expect(parseRetryAfter(headers({ 'retry-after': RESET.toUTCString() }), NOW)?.getTime()).toBe(
      RESET.getTime(),
    );
    expect(parseRetryAfter(headers({}), NOW)).toBeUndefined();
  });
});

describe('FR-ING-004 AC-2: 잔여 10% 미만이면 회복 시각까지 격리', () => {
  const snapshot = (remaining: number) => ({ limit: 5000, remaining, resetAt: RESET, observedAt: NOW });

  it('임계 위에서는 격리하지 않는다', () => {
    const state = applyResponse(INITIAL_STATE, snapshot(500), 0.1);
    expect(state.quarantinedUntil).toBeUndefined();
    expect(isAvailable(state, NOW)).toBe(true);
  });

  it('임계 아래에서는 회복 시각까지 격리한다', () => {
    const state = applyResponse(INITIAL_STATE, snapshot(499), 0.1);
    expect(state.quarantinedUntil?.toISOString()).toBe(RESET.toISOString());
    expect(state.quarantineReason).toBe('primary_exhausted');
    expect(isAvailable(state, NOW)).toBe(false);
  });

  it('회복 시각이 지나면 다시 쓸 수 있다', () => {
    const state = applyResponse(INITIAL_STATE, snapshot(10), 0.1);
    expect(isAvailable(state, new Date(RESET.getTime() + 1))).toBe(true);
  });

  it('임계는 비율이다 — 한도가 다르면 절대값도 달라진다', () => {
    const small = applyResponse(INITIAL_STATE, { limit: 100, remaining: 9, resetAt: RESET, observedAt: NOW }, 0.1);
    const large = applyResponse(INITIAL_STATE, { limit: 15000, remaining: 900, resetAt: RESET, observedAt: NOW }, 0.1);
    expect(small.quarantinedUntil).toBeDefined();
    expect(large.quarantinedUntil).toBeDefined();
    const largeOk = applyResponse(INITIAL_STATE, { limit: 15000, remaining: 1600, resetAt: RESET, observedAt: NOW }, 0.1);
    expect(largeOk.quarantinedUntil).toBeUndefined();
  });

  it('헤더가 없는 응답은 상태를 바꾸지 않는다', () => {
    const quarantined = applyResponse(INITIAL_STATE, snapshot(10), 0.1);
    expect(applyResponse(quarantined, undefined, 0.1)).toBe(quarantined);
  });
});

describe('부 한도 격리는 주 한도 회복으로 풀리지 않는다', () => {
  it('429 격리 뒤 잔여가 넉넉한 응답이 와도 격리가 유지된다', () => {
    const retryAt = new Date(NOW.getTime() + 30_000);
    let state = applySecondaryLimit(INITIAL_STATE, retryAt);
    expect(state.quarantineReason).toBe('secondary_limit');

    state = applyResponse(state, { limit: 5000, remaining: 4999, resetAt: RESET, observedAt: NOW }, 0.1);
    expect(state.quarantinedUntil?.toISOString()).toBe(retryAt.toISOString());
    expect(isAvailable(state, NOW)).toBe(false);
    expect(isAvailable(state, new Date(retryAt.getTime() + 1))).toBe(true);
  });

  it('이미 더 긴 격리가 걸려 있으면 줄이지 않는다', () => {
    const longer = new Date(NOW.getTime() + 120_000);
    const shorter = new Date(NOW.getTime() + 10_000);
    const state = applySecondaryLimit(applySecondaryLimit(INITIAL_STATE, longer), shorter);
    expect(state.quarantinedUntil?.toISOString()).toBe(longer.toISOString());
  });
});
