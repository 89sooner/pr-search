/**
 * rate limit 상태 (FR-ING-004 AC-2, 백엔드 아키텍처 4.2).
 *
 * **주 한도와 부 한도를 한 덩어리로 만들지 않는다.** 둘은 신호도 회복 방식도
 * 다르다 — 주 한도는 응답 헤더가 잔여와 회복 시각을 알려주고, 부 한도는 429와
 * `retry-after`로만 나타난다. 같은 if문에 섞으면 어느 쪽 때문에 격리됐는지
 * 알 수 없어진다.
 */

export interface RateLimitSnapshot {
  readonly limit: number;
  readonly remaining: number;
  readonly resetAt: Date;
  readonly observedAt: Date;
}

export interface HeaderLike {
  get(name: string): string | null;
}

/** `x-ratelimit-*` 헤더를 읽는다. 없으면 `undefined`. */
export function parseRateLimitHeaders(headers: HeaderLike, now: Date): RateLimitSnapshot | undefined {
  const rawLimit = headers.get('x-ratelimit-limit');
  const rawRemaining = headers.get('x-ratelimit-remaining');
  const rawReset = headers.get('x-ratelimit-reset');
  // `Number(null)`은 0이다. 헤더가 없는 응답을 "잔여 0"으로 읽으면 멀쩡한
  // 토큰이 통째로 격리된다.
  if (rawLimit === null || rawRemaining === null || rawReset === null) return undefined;

  const limit = Number(rawLimit);
  const remaining = Number(rawRemaining);
  const reset = Number(rawReset);
  if (!Number.isFinite(limit) || !Number.isFinite(remaining) || !Number.isFinite(reset)) {
    return undefined;
  }
  return { limit, remaining, resetAt: new Date(reset * 1000), observedAt: now };
}

/**
 * `retry-after` 헤더를 시각으로 바꾼다.
 *
 * 값은 초 단위 정수이거나 HTTP 날짜다. 둘 다 처리한다 — 하나만 다루면 서버가
 * 다른 형식을 보낼 때 격리가 통째로 사라진다.
 */
export function parseRetryAfter(headers: HeaderLike, now: Date): Date | undefined {
  const raw = headers.get('retry-after');
  if (raw === null || raw.trim() === '') return undefined;

  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return new Date(now.getTime() + seconds * 1000);
  }
  const asDate = new Date(raw);
  return Number.isNaN(asDate.getTime()) ? undefined : asDate;
}

export type QuarantineReason = 'primary_exhausted' | 'secondary_limit';

export interface TokenRateLimitState {
  readonly snapshot: RateLimitSnapshot | undefined;
  /** 이 시각까지 이 토큰을 쓰지 않는다. */
  readonly quarantinedUntil: Date | undefined;
  readonly quarantineReason: QuarantineReason | undefined;
}

export const INITIAL_STATE: TokenRateLimitState = {
  snapshot: undefined,
  quarantinedUntil: undefined,
  quarantineReason: undefined,
};

/**
 * 응답 헤더를 반영한다. 잔여가 임계 미만이면 회복 시각까지 격리한다.
 *
 * 임계 판정은 비율이다 — 한도가 5,000인 토큰과 15,000인 토큰에 같은 절대값을
 * 쓰면 한쪽은 너무 일찍, 다른 쪽은 너무 늦게 빠진다.
 */
export function applyResponse(
  state: TokenRateLimitState,
  snapshot: RateLimitSnapshot | undefined,
  threshold: number,
): TokenRateLimitState {
  if (snapshot === undefined) return state;
  if (snapshot.limit > 0 && snapshot.remaining / snapshot.limit < threshold) {
    return { snapshot, quarantinedUntil: snapshot.resetAt, quarantineReason: 'primary_exhausted' };
  }
  // 격리 사유가 부 한도였다면 그 격리는 유지한다. 주 한도가 회복됐다고
  // 부 한도 격리를 풀면 429를 다시 맞는다.
  if (state.quarantineReason === 'secondary_limit') {
    return { ...state, snapshot };
  }
  return { snapshot, quarantinedUntil: undefined, quarantineReason: undefined };
}

/** 429를 받았다. `retry-after`가 지정한 시간만큼 격리한다. */
export function applySecondaryLimit(
  state: TokenRateLimitState,
  retryAt: Date,
): TokenRateLimitState {
  const current = state.quarantinedUntil;
  return {
    ...state,
    // 이미 더 긴 격리가 걸려 있으면 줄이지 않는다.
    quarantinedUntil: current !== undefined && current > retryAt ? current : retryAt,
    quarantineReason: 'secondary_limit',
  };
}

export function isAvailable(state: TokenRateLimitState, now: Date): boolean {
  return state.quarantinedUntil === undefined || state.quarantinedUntil <= now;
}
