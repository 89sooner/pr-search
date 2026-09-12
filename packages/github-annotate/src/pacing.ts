/**
 * 시간 예산과 변경 요청 간격 (WP-075 안전성 보강).
 *
 * ## 왜 순수 모듈로 떼는가
 *
 * 「예산이 있다」와 「예산이 집행된다」는 다른 말이다. 앞의 것은 회차가 시작할 때
 * 시각을 한 번 재면 성립하지만, 뒤의 것은 **기다리는 모든 자리**가 같은 예산을
 * 보아야 성립한다 — 줄 서기, DB 질의, 토큰 발급, HTTP 왕복, 재시도 대기, 쓰기
 * 간격이 전부 그 자리다. 그 자리마다 `Date.now()`를 다시 부르면 언젠가 한 곳이
 * 빠지고, 빠진 곳은 아무도 모른다.
 *
 * 여기 모아 두면 **하나의 신호**(`AbortSignal`)가 그 전부를 끊는다.
 */

/**
 * 회차 하나가 쓸 수 있는 시간.
 *
 * 예산이 없으면(`undefined`) 만료되지 않는다 — 잔여 스윕처럼 버스의 회수 시한에
 * 묶이지 않는 경로가 그렇다. 다만 **중단 신호는 언제나 있다**: 종료 요청은 예산과
 * 무관하게 들어온다.
 */
export class PassDeadline {
  readonly #endsAt: number | undefined;
  readonly #controller = new AbortController();
  readonly #now: () => number;
  #timer: ReturnType<typeof setTimeout> | undefined;

  /**
   * @param budgetMs 회차 전체에 허용된 시간. `undefined`면 시간 제한이 없다.
   * @param startedAt 예산을 재기 시작한 시각. **줄을 서기 전**의 시각이어야 한다 —
   *   락을 잡은 뒤부터 재면 대기 시간이 예산 밖으로 빠진다 (DEV-628).
   */
  constructor(
    budgetMs?: number,
    startedAt: number = Date.now(),
    now: () => number = Date.now,
    /**
     * 바깥의 중단 신호. 종료 요청이 여기로 들어온다.
     *
     * 예산이 없는 회차(잔여 스윕)도 이것으로 끊을 수 있어야 한다 — 그러지 않으면
     * 프로세스 종료가 상한 200건짜리 스윕이 끝나기를 기다린다.
     */
    externalSignal?: AbortSignal,
  ) {
    this.#now = now;
    if (externalSignal !== undefined) {
      if (externalSignal.aborted) this.#controller.abort(new DeadlineExceededError());
      else externalSignal.addEventListener('abort', () => {
        this.#controller.abort(new DeadlineExceededError());
      }, { once: true });
    }
    this.#endsAt = budgetMs === undefined ? undefined : startedAt + budgetMs;
    if (this.#endsAt !== undefined) {
      const remaining = this.#endsAt - this.#now();
      if (remaining <= 0) this.#controller.abort(new DeadlineExceededError());
      else {
        /*
         * 타이머가 예산 만료를 **스스로** 알린다. 각 단계가 `expired()`를 묻는 것만으로는
         * 이미 시작한 HTTP 왕복을 끊지 못한다 — 그 왕복이 예산보다 길면 회차는 예산을
         * 넘긴 채 돌아온다 (재현 D).
         */
        this.#timer = setTimeout(() => {
          this.#controller.abort(new DeadlineExceededError());
        }, remaining);
        this.#timer.unref?.();
      }
    }
  }

  /** 하위 호출에 넘길 중단 신호. HTTP·대기가 이것을 본다. */
  get signal(): AbortSignal {
    return this.#controller.signal;
  }

  /** 남은 시간(ms). 예산이 없으면 `Number.POSITIVE_INFINITY`다. */
  remainingMs(): number {
    if (this.#endsAt === undefined) return Number.POSITIVE_INFINITY;
    return this.#endsAt - this.#now();
  }

  /**
   * 예산이 끝났는가.
   *
   * **타이머만 믿지 않는다.** 타이머는 진행 중인 왕복을 끊는 역할이고, 만료 자체는
   * 시각 비교가 정본이다 — 타이머에만 기대면 해상도만큼 늦게 알아채고, 시계를
   * 앞당기는 시험에서는 영영 알아채지 못한다. 시각으로 만료를 발견하면 신호도
   * 함께 올려 **이미 시작한 왕복까지** 끊는다.
   */
  expired(): boolean {
    if (this.#controller.signal.aborted) return true;
    if (this.#endsAt !== undefined && this.#now() >= this.#endsAt) {
      this.#controller.abort(new DeadlineExceededError());
      return true;
    }
    return false;
  }

  /**
   * 예산 안에서만 잔다.
   *
   * @returns 끝까지 잤으면 `true`. 예산이 먼저 다했으면 `false`이며, 호출부는
   *   **다음 원격 요청을 시작하지 않는다.**
   */
  async sleep(ms: number, impl?: (ms: number) => Promise<void>): Promise<boolean> {
    if (this.expired()) return false;
    const remaining = this.remainingMs();
    if (ms >= remaining) {
      /*
       * 남은 예산보다 오래 자야 한다면 **자지 않고 돌아온다.** 예산만큼만 자고
       * 이어서 요청을 보내면 간격 계약이 깨진다 — 기다림의 목적이 간격이기 때문이다.
       */
      return false;
    }
    if (impl !== undefined) {
      await impl(ms);
      return !this.expired();
    }
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        this.#controller.signal.removeEventListener('abort', onAbort);
        resolve(true);
      }, ms);
      const onAbort = (): void => {
        clearTimeout(timer);
        resolve(false);
      };
      this.#controller.signal.addEventListener('abort', onAbort, { once: true });
    });
  }

  /** 회차가 끝나면 반드시 부른다. 타이머를 남기면 프로세스가 늦게 죽는다. */
  dispose(): void {
    if (this.#timer !== undefined) clearTimeout(this.#timer);
    this.#timer = undefined;
  }
}

export class DeadlineExceededError extends Error {
  constructor() {
    super('표기 회차의 시간 예산이 다했다');
    this.name = 'DeadlineExceededError';
  }
}

/**
 * 변경 요청 사이의 간격을 **실행자 전체에** 적용한다.
 *
 * ## 성공한 요청만 세면 계약이 아니다
 *
 * 공식 문서의 권고는 「변경 요청을 많이 보낼 때 각 요청 사이에 최소 1초」다. 성공한
 * 행 뒤에만 쉬면 5xx가 이어질 때 재시도 백오프(200ms)만 남아 간격이 무너진다 —
 * 부 한도를 부르는 바로 그 형태이고, 같은 문서가 「한도에 걸린 채 계속 보내면
 * integration이 차단될 수 있다」고 경고하는 자리다 (재현 E).
 *
 * ## 한도 대기도 여기서 센다
 *
 * 한 이벤트만 `defer`하고 다음 이벤트가 곧바로 같은 한도를 두드리면 유예가 아무것도
 * 아니다. 한도 신호를 받으면 이 게이트가 **모든 쓰기**를 그 시각까지 멈춘다.
 *
 * ## 프로세스 안에서만 유효하다
 *
 * 재시작하면 마지막 쓰기 시각과 한도 유예를 잊는다. 그것을 정본에 남기는 것은
 * 한도가 저장소가 아니라 **App 설치 단위**라 둘 자리가 마땅치 않고, 대신 기동 직후
 * 첫 쓰기를 한 간격만큼 늦춘다(`startPaused`) — 재시작 직후의 연달은 쓰기만 막으면
 * 되고, 그것이 재시작이 만드는 유일한 새 위험이다.
 */
export class WriteGate {
  readonly #spacingMs: number;
  readonly #now: () => number;
  #nextAllowedAt: number;
  #pausedUntil: number | undefined;

  constructor(options: { spacingMs: number; now?: () => number; startPaused?: boolean }) {
    this.#spacingMs = options.spacingMs;
    this.#now = options.now ?? Date.now;
    // 기동 직후의 첫 쓰기도 앞선 프로세스의 마지막 쓰기와 간격을 둔다.
    this.#nextAllowedAt = options.startPaused === true ? this.#now() + options.spacingMs : 0;
  }

  /** 지금 한도로 멈춰 있다면 그 회복 시각. */
  pausedUntil(): Date | undefined {
    return this.#pausedUntil === undefined ? undefined : new Date(this.#pausedUntil);
  }

  /** 한도 신호를 받았다. 이 시각까지 **모든** 변경 요청을 멈춘다. */
  pauseUntil(until: Date): void {
    const at = until.getTime();
    if (this.#pausedUntil === undefined || at > this.#pausedUntil) this.#pausedUntil = at;
    if (at > this.#nextAllowedAt) this.#nextAllowedAt = at;
  }

  /** 지금 기다려야 하는 시간(ms). 0이면 바로 보낼 수 있다. */
  waitMs(): number {
    return Math.max(0, this.#nextAllowedAt - this.#now());
  }

  /**
   * 다음 변경 요청을 보낼 차례를 기다린다.
   *
   * @returns 차례가 됐으면 `true`. 예산이 먼저 다했으면 `false`이며 호출부는
   *   **요청을 보내지 않는다.**
   */
  async waitForTurn(deadline: PassDeadline, sleepImpl?: (ms: number) => Promise<void>): Promise<boolean> {
    const wait = this.waitMs();
    if (wait <= 0) return !deadline.expired();
    return deadline.sleep(wait, sleepImpl);
  }

  /**
   * 변경 요청을 **보낸 직후** 부른다.
   *
   * 응답을 받은 뒤가 아니라 보낸 직후인 이유는, 간격을 재는 기준이 요청이 나간
   * 시각이기 때문이다. 응답 기준으로 재면 느린 응답만큼 간격이 늘어 한도를 덜 쓰는
   * 쪽으로 치우치지만, 그 대신 실패한 요청의 간격을 놓친다.
   */
  markSent(): void {
    const next = this.#now() + this.#spacingMs;
    if (next > this.#nextAllowedAt) this.#nextAllowedAt = next;
    if (this.#pausedUntil !== undefined && this.#now() >= this.#pausedUntil) this.#pausedUntil = undefined;
  }
}
