/**
 * 요청 순서 결정 (WP-006 DoD 4).
 *
 * **"실시간이 백필보다 우선"과 "토큰을 쓸 수 있는가"는 다른 문제다.** 전자는
 * 순서 문제이고 후자는 가용성 문제다. 한 조건문에 섞으면 "백필이 밀린 건
 * 우선순위 때문인가 한도 때문인가"를 구분할 수 없어진다.
 *
 * 여기서는 순서만 정한다. 한도는 `TokenPool`이 안다.
 */

export type RequestPriority = 'realtime' | 'backfill';

interface Waiter {
  readonly priority: RequestPriority;
  readonly enqueuedAt: number;
  readonly resolve: () => void;
}

export interface SchedulerOptions {
  readonly maxConcurrent: number;
}

export class RequestScheduler {
  readonly #maxConcurrent: number;
  readonly #queues: Record<RequestPriority, Waiter[]> = { realtime: [], backfill: [] };
  #inFlight = 0;
  #sequence = 0;

  constructor(options: SchedulerOptions) {
    this.#maxConcurrent = Math.max(1, options.maxConcurrent);
  }

  get inFlight(): number {
    return this.#inFlight;
  }

  get queued(): number {
    return this.#queues.realtime.length + this.#queues.backfill.length;
  }

  /**
   * 실행 슬롯을 하나 잡고 작업을 돌린다.
   *
   * 실시간 요청은 언제나 백필보다 먼저 슬롯을 받는다. 같은 우선순위 안에서는
   * 먼저 온 것이 먼저다 — 그래야 백필이 굶더라도 순서는 예측 가능하다.
   */
  async run<T>(priority: RequestPriority, task: () => Promise<T>): Promise<T> {
    await this.#acquire(priority);
    try {
      return await task();
    } finally {
      this.#release();
    }
  }

  async #acquire(priority: RequestPriority): Promise<void> {
    if (this.#inFlight < this.#maxConcurrent && this.queued === 0) {
      this.#inFlight += 1;
      return;
    }
    this.#sequence += 1;
    const enqueuedAt = this.#sequence;
    await new Promise<void>((resolve) => {
      this.#queues[priority].push({ priority, enqueuedAt, resolve });
    });
    this.#inFlight += 1;
  }

  #release(): void {
    this.#inFlight -= 1;
    // 실시간 큐를 먼저 비운다. 백필은 실시간이 하나도 남지 않았을 때만 나간다.
    const next = this.#queues.realtime.shift() ?? this.#queues.backfill.shift();
    next?.resolve();
  }
}
