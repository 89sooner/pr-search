/**
 * 표준 재시도 백오프 (FR-ING-007 AC-1, 비동기 문서 5.1).
 *
 * 1·2·4·8·16초에 ±20% 지터. 지터가 없으면 동시에 실패한 이벤트들이 같은
 * 순간에 몰려 재시도해 장애를 되풀이한다.
 */

/** 비동기 문서 5.1이 정한 지연. 인덱스는 재시도 횟수 - 1. */
export const RETRY_DELAYS_MS: readonly number[] = [1_000, 2_000, 4_000, 8_000, 16_000];

/** 표준 재시도 상한. 이 횟수를 넘기면 실패 대기열로 간다. */
export const MAX_RETRIES = RETRY_DELAYS_MS.length;

export const JITTER_RATIO = 0.2;

/**
 * `attempt`번째 재시도까지 기다릴 시간.
 *
 * @param attempt 1부터 시작. 상한을 넘으면 마지막 지연을 유지한다.
 * @param random 지터용 난수원. 테스트가 결정론적으로 만들 수 있게 주입받는다.
 */
export function retryDelayMs(attempt: number, random: () => number = Math.random): number {
  const index = Math.max(0, Math.min(attempt, MAX_RETRIES) - 1);
  const base = RETRY_DELAYS_MS[index] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1] ?? 16_000;
  // ±20%. random()이 0.5면 지터가 0이다.
  return Math.round(base * (1 + (random() * 2 - 1) * JITTER_RATIO));
}
