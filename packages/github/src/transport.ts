/**
 * HTTP 전송 (FR-ING-004 AC-2, NFR-002).
 *
 * 이 계층이 하는 일은 넷이다 — 토큰을 붙이고, 시간을 재고, rate limit 헤더를
 * 읽어 풀에 알리고, 실패를 구조화한다. 무엇을 조회할지는 `GitHubClient`가 안다.
 *
 * GraphQL(`postGraphql`, CR-135)은 예외다 — 한도 헤더를 풀에 알리지 않고, 실패를 분류하지 않은 응답째 돌려준다.
 */

import { GitHubApiError, classifyStatus } from './errors.js';
import { parseRateLimitHeaders, parseRetryAfter } from './rate-limit.js';
import { safeMessage } from './redact.js';
import { RequestScheduler, type RequestPriority } from './scheduler.js';
import type { TokenPool } from './token-pool.js';

/**
 * 원시 본문 읽기의 동시 상한 기본값 (CR-132).
 *
 * 원시 창 읽기는 본문을 받는 내내 공용 슬롯 하나를 잡는다 — 큰 offset이면 수십 초다. 공용 슬롯(`scheduler`)은
 * 이 프로세스의 모든 GitHub 호출이 나눠 쓰므로, 원시 읽기가 슬롯을 다 차지하면 목록·메타 조회까지 멈춘다. 그래서
 * 원시 읽기는 이 상한 안에서만 공용 슬롯을 청한다.
 */
export const RAW_READ_CONCURRENCY = 2;

/**
 * 원시 창 읽기의 호출 기한에 더하는 몫 (CR-132): 받아야 하는 바이트를 이 속도(바이트/ms, 1 MiB/s)로 나눈 시간이다.
 * GitHub는 바이트 범위를 받지 않아 offset 앞을 모두 다시 받으므로, 기본 기한(작은 JSON 기준)으로는 뒤쪽 창을 영영
 * 읽지 못한다. 요청 전체의 상한은 호출자의 `signal`(경로 기한)이 정한다.
 */
export const RAW_MIN_BYTES_PER_MS = 1024 * 1024 / 1000;

/**
 * GraphQL 호출의 동시 상한 (CR-135).
 *
 * 원시 읽기(`RAW_READ_CONCURRENCY`)와 같은 이유다. blame 한 건은 GitHub가 10초까지 붙잡는 무거운 조회라, 공용 슬롯을
 * 여럿 차지하면 이 프로세스의 목록·메타 조회가 함께 멈춘다. 그래서 GraphQL은 이 상한 안에서만 공용 슬롯을 청한다.
 */
export const GRAPHQL_CONCURRENCY = 2;

/** `onResponse`에 싣는 GraphQL 호출의 경로 (CR-135). */
const GRAPHQL_EVENT_PATH = '/graphql';

export interface TransportOptions {
  readonly apiUrl: string;
  /**
   * GraphQL 끝점 (CR-135). `resolveGitHubConfig().graphqlUrl`을 넘긴다 — GHES는 `/api/graphql`이다. 없으면
   * `postGraphql`이 던진다(REST 경로는 영향이 없다).
   */
  readonly graphqlUrl?: string;
  readonly requestTimeoutMs: number;
  readonly pool: TokenPool;
  readonly scheduler: RequestScheduler;
  /** 원시 본문 읽기의 동시 상한 (CR-132). 기본은 `RAW_READ_CONCURRENCY`개다. */
  readonly rawReads?: RequestScheduler;
  readonly now?: () => Date;
  readonly fetchImpl?: typeof fetch;
  /** 지표·로그 훅. 토큰 값은 넘기지 않는다. */
  readonly onResponse?: (event: TransportEvent) => void;
}

export interface TransportEvent {
  readonly org: string;
  readonly installationId: number;
  /** REST는 API 루트 아래의 경로, GraphQL은 `/graphql`이다 (CR-135). */
  readonly path: string;
  readonly status: number;
  readonly durationMs: number;
  /** 응답 헤더의 잔여 한도. `/graphql` 이벤트의 값은 REST가 아니라 **GraphQL 버킷**이다 (CR-135). */
  readonly remaining: number | undefined;
  readonly priority: RequestPriority;
}

/**
 * GraphQL 호출 한 건 (CR-135). 문서와 변수는 호출자가 코드에 둔 **서버 소유 고정 query**다 — 이 전송은 외부에서 받은
 * 문서를 싣는 통로가 아니다. 조회 문서만 받는다(`mutation`·`subscription`은 보내기 전에 거절한다).
 */
export interface GraphqlRequestOptions {
  readonly org: string;
  readonly query: string;
  readonly variables: Readonly<Record<string, unknown>>;
  /** 호출자의 취소·요청 기한. 슬롯 대기와 GitHub 호출을 함께 멈춘다. */
  readonly signal?: AbortSignal;
  /** 이 호출 하나의 시간 제한. 기본은 전송 설정의 `requestTimeoutMs`다. 본문 읽기까지 포함한다. */
  readonly timeoutMs?: number;
  readonly priority?: RequestPriority;
}

/** GraphQL 응답의 한도 헤더 (CR-135). 토큰 풀의 REST 상태에는 넣지 않는다 — 버킷이 다르다. */
export interface GraphqlRateLimit {
  /** `x-ratelimit-remaining`. 없거나 숫자가 아니면 `null`. */
  readonly remaining: number | null;
  /** `x-ratelimit-reset`(epoch 초)을 시각으로. 없거나 숫자가 아니면 `null`. */
  readonly reset: Date | null;
  /** `retry-after`(초 또는 HTTP 날짜)를 시각으로. 없으면 `null`. */
  readonly retryAfter: Date | null;
  /** 응답을 받은 시각(전송의 시계). 한도 오류의 기본 재시도 시각을 여기서 잰다. */
  readonly observedAt: Date;
}

/**
 * GraphQL 응답 (CR-135). **HTTP 상태와 무관하게 돌려준다** — 200 안의 `errors`, 403 부 한도, 401을 가르는 일은
 * 호출자의 분류(`readSourceBlame`)가 한다. `body`는 파싱한 JSON이고, 비었거나 JSON이 아니면 `null`이다.
 */
export interface GraphqlResponse {
  readonly status: number;
  readonly body: unknown;
  readonly rateLimit: GraphqlRateLimit;
}

export interface RequestOptions {
  readonly org: string;
  readonly path: string;
  readonly priority?: RequestPriority;
  readonly query?: Readonly<Record<string, string | number | undefined>>;
  /** 응답 형식 (CR-132). 기본은 `application/vnd.github+json`이다. */
  readonly accept?: string;
  /**
   * 호출자의 취소 (CR-132). 사용자가 화면을 닫거나 요청 기한이 지나면 슬롯 대기와 GitHub 호출을 함께 멈춘다.
   * 호출마다의 시간 제한(`timeoutMs`)과 함께 건다 — 둘 중 먼저 오는 쪽이 끊는다.
   */
  readonly signal?: AbortSignal;
  /** 이 호출 하나의 시간 제한. 기본은 전송 설정의 `requestTimeoutMs`다. 본문 읽기까지 포함한다. */
  readonly timeoutMs?: number;
}

/** 원시 본문의 창 (CR-132). `offset`부터 최대 `length`바이트를 읽고 나머지는 받지 않는다. */
export interface RawWindow {
  readonly bytes: Uint8Array;
  /** 창을 다 채우기 전에 본문이 끝났다. */
  readonly eof: boolean;
}

export class GitHubTransport {
  readonly #options: TransportOptions;
  readonly #rawReads: RequestScheduler;
  readonly #graphqlCalls = new RequestScheduler({ maxConcurrent: GRAPHQL_CONCURRENCY });

  constructor(options: TransportOptions) {
    this.#options = options;
    this.#rawReads = options.rawReads ?? new RequestScheduler({ maxConcurrent: RAW_READ_CONCURRENCY });
  }

  #now(): Date {
    return (this.#options.now ?? ((): Date => new Date()))();
  }

  /**
   * GET 한 건.
   *
   * 격리된 토큰으로는 요청하지 않는다 — 보내 봐야 403이고 한도만 더 깎인다.
   * 대신 회복 시각을 담은 재시도 가능 오류를 던져 호출 측이 재예약하게 한다
   * (FR-ING-004 AC-2).
   */
  async get<T>(options: RequestOptions): Promise<T> {
    return this.#request(options, () => undefined, async (response) => (await response.json()) as T);
  }

  /**
   * 원시 본문의 한 창 (CR-132).
   *
   * GitHub는 바이트 범위를 받지 않는다. 그래서 본문을 앞에서부터 받으며 `offset` 전까지는 버리고, `length`바이트가
   * 모이면 **스트림을 끊는다** — 뒤를 내려받지 않는다. 슬롯은 읽는 동안 잡고 있고, 시간 제한과 호출자의 취소는
   * 본문 읽기에도 걸린다. 받은 바이트는 이 호출 안에서만 산다.
   *
   * 원시 읽기는 `rawReads` 상한(기본 `RAW_READ_CONCURRENCY`) 안에서만 공용 슬롯을 청한다. 호출 기한은 따로 주지
   * 않으면 기본 기한에 받아야 할 바이트 몫(`RAW_MIN_BYTES_PER_MS`)을 더한 값이다.
   */
  async getRawWindow(options: RequestOptions, window: { readonly offset: number; readonly length: number }): Promise<RawWindow> {
    if (!Number.isSafeInteger(window.offset) || window.offset < 0 || !Number.isSafeInteger(window.length) || window.length < 1) {
      throw new RangeError('원시 창은 0 이상의 offset과 1 이상의 length가 필요하다');
    }
    const timeoutMs = options.timeoutMs
      ?? this.#options.requestTimeoutMs + Math.ceil((window.offset + window.length) / RAW_MIN_BYTES_PER_MS);
    try {
      return await this.#rawReads.run(options.priority ?? 'realtime', () => this.#readWindow({ ...options, timeoutMs }, window), options.signal);
    } catch (error) {
      // 원시 읽기 줄에서 기다리다 취소됐다. 공용 경로와 같은 모양으로 알린다.
      if (options.signal?.aborted && !(error instanceof GitHubApiError)) throw callerAborted(options.signal);
      throw error;
    }
  }

  async #readWindow(options: RequestOptions, window: { readonly offset: number; readonly length: number }): Promise<RawWindow> {
    return this.#request(options, () => undefined, async (response, signal) => {
      const body = response.body;
      if (body === null) return { bytes: new Uint8Array(0), eof: true };
      const reader = body.getReader();
      // 취소·기한이 오면 읽기를 기다리지 않는다 — 본문 스트림이 신호에 반응하지 않는 구현에서도 끊긴다.
      const aborted = new Promise<never>((_resolve, reject) => {
        const fail = (): void => { reject(signal.reason); };
        if (signal.aborted) fail();
        else signal.addEventListener('abort', fail, { once: true });
      });
      aborted.catch(() => undefined);
      const read = () => Promise.race([reader.read(), aborted]);
      const collected = new Uint8Array(window.length);
      let skipped = 0;
      let filled = 0;
      let eof = false;
      // 창을 채운 조각에 창 뒤의 바이트가 남았다 — 그 조각이 스트림의 마지막이어도 본문은 끝나지 않았다.
      let remainder = false;
      try {
        while (filled < window.length) {
          const chunk = await read();
          if (chunk.done) { eof = true; break; }
          let bytes = chunk.value;
          if (skipped < window.offset) {
            const skip = Math.min(window.offset - skipped, bytes.length);
            skipped += skip;
            bytes = bytes.subarray(skip);
          }
          const take = Math.min(bytes.length, window.length - filled);
          collected.set(bytes.subarray(0, take), filled);
          filled += take;
          if (take < bytes.length) remainder = true;
        }
        if (!eof) {
          if (remainder) await reader.cancel();
          else {
            // 창이 조각 끝에서 딱 끝났다. 본문도 여기서 끝났는지 한 번 더 보고, 남았으면 받지 않고 끊는다.
            const next = await read();
            if (next.done) eof = true;
            else await reader.cancel();
          }
        }
      } catch (error) {
        await reader.cancel().catch(() => undefined);
        throw error;
      } finally {
        reader.releaseLock();
      }
      return { bytes: collected.subarray(0, filled), eof };
    });
  }

  /**
   * GraphQL POST 한 건 (CR-135).
   *
   * REST 경로와 **같은** 것: 설치 토큰 lease, 401이면 그 토큰 무효화, 호출자 신호, 호출 기한, `onResponse`.
   *
   * REST 경로와 **다른** 것:
   * - 한도 헤더를 토큰 풀의 REST 상태(`observeResponse`·`observeSecondaryLimit`)에 넣지 않고, REST 격리(`availableAt`)도
   *   보지 않는다. GraphQL 한도는 점수로 깎이는 **다른 버킷**이다 — 섞으면 blame 한 번이 REST 조회 전체를 격리하거나
   *   REST 격리가 blame을 막는다. 한도 헤더는 응답의 `rateLimit`으로 호출자에게만 준다.
   * - 어떤 HTTP 상태든 던지지 않고 돌려준다. 던지는 것은 네트워크·기한·호출자 취소(REST와 같은 `GitHubApiError` 모양)와
   *   호출 전의 설정·인자 오류(`graphqlUrl` 미설정, 조회가 아닌 문서)뿐이다. 재시도하지 않는다.
   *
   * 원시 읽기처럼 `GRAPHQL_CONCURRENCY` 상한 안에서만 공용 슬롯을 청한다.
   */
  async postGraphql(options: GraphqlRequestOptions): Promise<GraphqlResponse> {
    const endpoint = this.#options.graphqlUrl;
    if (endpoint === undefined || endpoint === '') {
      throw new Error('GraphQL 끝점(graphqlUrl)이 설정되지 않았다 (CR-135)');
    }
    if (!isQueryDocument(options.query)) {
      // 이 전송은 조회 App의 토큰을 붙인다. 쓰기 연산이 나갈 통로를 만들지 않는다.
      throw new Error('GraphQL 전송은 query 연산만 보낸다 — mutation·subscription을 거절한다 (CR-135)');
    }
    const caller = options.signal;
    if (caller?.aborted) throw callerAborted(caller);
    const priority = options.priority ?? 'realtime';
    try {
      return await this.#graphqlCalls.run(priority, async () => {
        const lease = await this.#options.pool.lease(options.org);
        return this.#options.scheduler.run(priority, () => this.#sendGraphql(endpoint, options, lease, priority), caller);
      }, caller);
    } catch (error) {
      // GraphQL 줄이나 공용 줄에서 기다리다 취소됐다. 본문 읽기 중의 취소와 같은 모양으로 알린다.
      if (caller?.aborted && !(error instanceof GitHubApiError)) throw callerAborted(caller);
      throw error;
    }
  }

  async #sendGraphql(
    endpoint: string,
    options: GraphqlRequestOptions,
    lease: Awaited<ReturnType<TokenPool['lease']>>,
    priority: RequestPriority,
  ): Promise<GraphqlResponse> {
    const caller = options.signal;
    const startedAt = Date.now();
    const doFetch = this.#options.fetchImpl ?? fetch;
    const timeout = AbortSignal.timeout(options.timeoutMs ?? this.#options.requestTimeoutMs);
    const signal = caller === undefined ? timeout : AbortSignal.any([timeout, caller]);
    let response: Response;
    try {
      response = await doFetch(endpoint, {
        method: 'POST',
        headers: {
          // 토큰은 헤더로만 (THR-009). 문서와 변수는 본문에만 싣는다.
          authorization: `Bearer ${lease.token.token}`,
          'content-type': 'application/json',
          accept: 'application/vnd.github+json',
          'x-github-api-version': '2022-11-28',
        },
        body: JSON.stringify({ query: options.query, variables: options.variables }),
        signal,
      });
    } catch (error) {
      if (caller?.aborted) throw callerAborted(caller);
      const timedOut = error instanceof Error && error.name === 'TimeoutError';
      throw new GitHubApiError(timedOut ? 'timeout' : 'network', safeMessage(error));
    }

    const rateLimit = readGraphqlRateLimit(response.headers, this.#now());
    this.#options.onResponse?.({
      org: options.org,
      installationId: lease.installationId,
      path: GRAPHQL_EVENT_PATH,
      status: response.status,
      durationMs: Date.now() - startedAt,
      remaining: rateLimit.remaining ?? undefined,
      priority,
    });
    // 토큰이 거부됐다. 다음 요청이 새로 발급받게 한다 — 분류(`auth`)는 호출자가 한다.
    if (response.status === 401) this.#options.pool.invalidate(lease.installationId);

    let text: string;
    try {
      text = await response.text();
    } catch {
      // 본문을 읽다 끊겼다 — 호출자의 취소, 시간 제한, 연결 오류를 가른다. 원인 문구는 싣지 않는다.
      if (caller?.aborted) throw callerAborted(caller);
      if (timeout.aborted) throw new GitHubApiError('timeout', 'GraphQL 본문을 제시간에 읽지 못했다');
      throw new GitHubApiError('network', 'GraphQL 본문을 읽지 못했다');
    }
    return { status: response.status, body: parseJsonOrNull(text), rateLimit };
  }

  async #request<T>(options: RequestOptions, observe: (response: Response) => void, consume: (response: Response, signal: AbortSignal) => Promise<T>): Promise<T> {
    const priority = options.priority ?? 'realtime';
    const caller = options.signal;
    if (caller?.aborted) throw callerAborted(caller);
    const availableAt = this.#options.pool.availableAt(options.org);
    if (availableAt !== undefined) {
      throw new GitHubApiError('rate_limited', `${options.org} 토큰이 한도 회복을 기다리는 중이다`, {
        retryAt: availableAt,
      });
    }

    const lease = await this.#options.pool.lease(options.org);
    const url = new URL(`${this.#options.apiUrl}${options.path}`);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }

    try {
      return await this.#options.scheduler.run(priority, () => this.#send(options, lease, url, priority, observe, consume), caller);
    } catch (error) {
      // 슬롯을 기다리다 취소됐다(스케줄러는 신호의 사유를 그대로 던진다). 본문 읽기 중의 취소와 같은 모양으로 알린다.
      if (caller?.aborted && !(error instanceof GitHubApiError)) throw callerAborted(caller);
      throw error;
    }
  }

  async #send<T>(
    options: RequestOptions,
    lease: Awaited<ReturnType<TokenPool['lease']>>,
    url: URL,
    priority: RequestPriority,
    observe: (response: Response) => void,
    consume: (response: Response, signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const caller = options.signal;
    const startedAt = Date.now();
    const doFetch = this.#options.fetchImpl ?? fetch;
    const timeout = AbortSignal.timeout(options.timeoutMs ?? this.#options.requestTimeoutMs);
    const signal = caller === undefined ? timeout : AbortSignal.any([timeout, caller]);
    let response: Response;
    try {
      response = await doFetch(url.toString(), {
        method: 'GET',
        headers: {
          // 토큰은 헤더로만. URL이나 인자에 실지 않는다 (THR-009).
          authorization: `Bearer ${lease.token.token}`,
          accept: options.accept ?? 'application/vnd.github+json',
          'x-github-api-version': '2022-11-28',
        },
        signal,
      });
    } catch (error) {
      if (caller?.aborted) throw callerAborted(caller);
      const timedOut = error instanceof Error && error.name === 'TimeoutError';
      throw new GitHubApiError(timedOut ? 'timeout' : 'network', safeMessage(error));
    }

    const now = this.#now();
    const snapshot = parseRateLimitHeaders(response.headers, now);
    observe(response);
    this.#options.pool.observeResponse(lease.installationId, snapshot);
    this.#options.onResponse?.({
      org: options.org,
      installationId: lease.installationId,
      path: options.path,
      status: response.status,
      durationMs: Date.now() - startedAt,
      remaining: snapshot?.remaining,
      priority,
    });

    if (response.status === 429) {
      // 부 한도. `retry-after`가 없으면 보수적으로 1분 격리한다.
      const retryAt = parseRetryAfter(response.headers, now) ?? new Date(now.getTime() + 60_000);
      this.#options.pool.observeSecondaryLimit(lease.installationId, retryAt);
      throw new GitHubApiError('secondary_rate_limited', 'GitHub 부 한도에 걸렸다', {
        status: 429,
        retryAt,
      });
    }

    if (response.status === 403 && snapshot !== undefined && snapshot.remaining === 0) {
      // 주 한도 소진. 헤더 반영으로 이미 격리됐다.
      throw new GitHubApiError('rate_limited', 'GitHub 주 한도가 소진됐다', {
        status: 403,
        retryAt: snapshot.resetAt,
      });
    }

    if (response.status === 401) {
      this.#options.pool.invalidate(lease.installationId);
    }

    if (!response.ok) {
      const body = safeMessage(await response.text().catch(() => ''));
      throw new GitHubApiError(
        classifyStatus(response.status),
        `${options.path} 요청 실패 (${String(response.status)}): ${body.slice(0, 200)}`,
        { status: response.status },
      );
    }

    try {
      return await consume(response, signal);
    } catch (error) {
      // 본문을 읽다 끊겼다 — 호출자의 취소, 시간 제한, 연결 오류를 가른다. 원인 문구는 싣지 않는다.
      if (caller?.aborted) throw callerAborted(caller);
      if (timeout.aborted) throw new GitHubApiError('timeout', `${options.path} 본문을 제시간에 읽지 못했다`);
      if (error instanceof SyntaxError) throw error;
      throw new GitHubApiError('network', `${options.path} 본문을 읽지 못했다`);
    }
  }

  /**
   * GET 한 페이지 — **본문과 함께 `Link`·요청 ID를 돌려준다** (WP-074 / CR-079, 상세 설계 5.1).
   *
   * `get`은 본문만 주므로 호출 측이 "다음 페이지가 있는가"를 `batch.length < perPage`로
   * **추측**한다. 증거 경로는 추측하지 않는다 — GitHub이 준 `Link: rel="next"`가
   * 없을 때만 열거가 끝난 것이다. 그리고 `x-github-request-id`는 근거의 `proof`에
   * 해시로 남는다.
   *
   * 오류 처리·한도·격리는 `get`과 같다. **두 번째 전송 경로를 만들지 않는다.**
   */
  async getPage<T>(options: RequestOptions): Promise<PageResponse<T>> {
    let captured: { readonly link: string | null; readonly requestId: string | null; readonly status: number } | undefined;
    const body = await this.#request<T>(options, (response) => {
      captured = {
        link: response.headers.get('link'),
        requestId: response.headers.get('x-github-request-id'),
        status: response.status,
      };
    }, async (response) => (await response.json()) as T);
    return {
      body,
      status: captured?.status ?? 200,
      nextPage: parseNextPage(captured?.link ?? null),
      requestId: captured?.requestId ?? null,
    };
  }

  /** 페이지네이션. `per_page` 상한과 최대 항목 수로 폭주를 막는다. */
  async getAll<T>(options: RequestOptions & { perPage?: number; maxItems?: number }): Promise<T[]> {
    // 얕은 복사 한 번. 호출 측이 계속 가변 배열을 받도록 계약을 유지한다.
    return [...(await this.getAllPaged<T>(options)).items];
  }

  /**
   * 절삭 여부까지 알려 주는 페이지네이션 (FR-ING-004 AC-4).
   *
   * **배열 길이만으로는 절삭을 알 수 없다.** 파일이 정확히 3000개인 PR과
   * 3000개에서 잘린 PR은 둘 다 길이 3000이다. 그래서 상한을 **넘겨** 한 번 더
   * 읽어 보고, 더 있으면 그때 `truncated`를 세운다. 여분 요청은 자원이 상한에
   * 닿았을 때만 나가므로 흔한 경로에는 비용이 없다.
   */
  async getAllPaged<T>(
    options: RequestOptions & { perPage?: number; maxItems?: number },
  ): Promise<PagedResult<T>> {
    const perPage = options.perPage ?? 100;
    const maxItems = options.maxItems ?? 3000;
    const collected: T[] = [];
    // `<=`가 핵심이다. `<`면 정확히 상한에서 멈춰 "더 있는지"를 영영 모른다.
    for (let page = 1; collected.length <= maxItems; page += 1) {
      const batch = await this.get<T[]>({
        ...options,
        query: { ...options.query, per_page: perPage, page },
      });
      if (!Array.isArray(batch) || batch.length === 0) break;
      collected.push(...batch);
      if (batch.length < perPage) break;
    }
    return { items: collected.slice(0, maxItems), truncated: collected.length > maxItems, maxItems };
  }
}

/**
 * 호출자가 취소했다 (CR-132). 요청 기한(`TimeoutError`)이면 `timeout`, 그 밖(연결을 끊은 사용자)은 `network`로
 * 분류한다 — 새 오류 종류를 만들지 않는다. 호출자는 자기 신호의 사유로 둘을 가를 수 있다.
 */
function callerAborted(signal: AbortSignal): GitHubApiError {
  const reason: unknown = signal.reason;
  const deadline = reason instanceof Error && reason.name === 'TimeoutError';
  return new GitHubApiError(deadline ? 'timeout' : 'network', deadline ? '요청 기한이 지났다' : '호출자가 요청을 취소했다');
}

/**
 * 조회 문서인가 (CR-135). 주석을 뺀 문서가 `query`나 `{`로 시작하고 `mutation`·`subscription` 낱말이 없어야 한다.
 * 문서를 해석하지 않고 보수적으로 거절한다 — 이 경로에는 서버 소유 고정 query만 오므로 잃는 것이 없다.
 */
function isQueryDocument(query: string): boolean {
  // 한계: `#`부터 줄 끝까지를 문자열 리터럴 안에서도 지운다 — 같은 줄의 `"#"` 뒤에 숨긴 연산은 이 검사를 지난다. 그런
  // 문서는 다중 연산이라 `operationName`(보내지 않는다) 없이는 GitHub가 실행하지 않고, 운영 호출자는 서버 소유 상수
  // 하나뿐이다(회귀 `runtime-reachability.test.ts`가 고정한다).
  const code = query.replace(/#[^\r\n]*/g, '');
  return /^\s*(query\b|\{)/.test(code) && !/\b(mutation|subscription)\b/.test(code);
}

/** 헤더의 숫자 값. 없거나 비었거나 숫자가 아니면 `null`이다 — `Number('')`는 0이다. */
function headerNumber(headers: Headers, name: string): number | null {
  const raw = headers.get(name);
  if (raw === null || raw.trim() === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

/** GraphQL 응답의 한도 헤더 (CR-135). 셋을 따로 읽는다 — `x-ratelimit-limit`이 빠져도 회복 시각은 남긴다. */
function readGraphqlRateLimit(headers: Headers, now: Date): GraphqlRateLimit {
  const reset = headerNumber(headers, 'x-ratelimit-reset');
  return {
    remaining: headerNumber(headers, 'x-ratelimit-remaining'),
    reset: reset === null ? null : new Date(reset * 1000),
    retryAfter: parseRetryAfter(headers, now) ?? null,
    observedAt: now,
  };
}

function parseJsonOrNull(text: string): unknown {
  if (text.trim() === '') return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/** `getPage`의 결과. `nextPage`가 `null`이면 GitHub이 다음 페이지를 알리지 않은 것이다. */
export interface PageResponse<T> {
  readonly body: T;
  readonly status: number;
  readonly nextPage: number | null;
  readonly requestId: string | null;
}

/**
 * `Link` 헤더의 `rel="next"` 페이지 번호. 없으면 `null`.
 *
 * GitHub은 `<url?page=N>; rel="next"` 형태로 준다. URL의 `page` 쿼리만 읽고 다른
 * 파라미터는 무시한다 — 호출 측이 자기 쿼리를 그대로 다시 보낸다.
 */
export function parseNextPage(link: string | null): number | null {
  if (link === null || link === '') return null;
  for (const part of link.split(',')) {
    const match = /<([^>]+)>\s*;\s*rel="next"/.exec(part.trim());
    if (match === null) continue;
    try {
      const page = new URL(match[1] as string).searchParams.get('page');
      if (page === null) return null;
      const value = Number(page);
      return Number.isInteger(value) && value >= 1 ? value : null;
    } catch {
      return null;
    }
  }
  return null;
}

/** 상한에 걸려 잘렸는지를 호출 측이 추측하지 않도록 함께 돌려준다. */
export interface PagedResult<T> {
  readonly items: readonly T[];
  /** 상한을 넘는 항목이 실제로 더 있었다. */
  readonly truncated: boolean;
  /** 적용된 상한. 표식의 근거를 로그에 남길 때 쓴다. */
  readonly maxItems: number;
}
