/**
 * HTTP 전송 (FR-ING-004 AC-2, NFR-002).
 *
 * 이 계층이 하는 일은 넷이다 — 토큰을 붙이고, 시간을 재고, rate limit 헤더를
 * 읽어 풀에 알리고, 실패를 구조화한다. 무엇을 조회할지는 `GitHubClient`가 안다.
 */

import { GitHubApiError, classifyStatus } from './errors.js';
import { parseRateLimitHeaders, parseRetryAfter } from './rate-limit.js';
import { safeMessage } from './redact.js';
import type { RequestPriority, RequestScheduler } from './scheduler.js';
import type { TokenPool } from './token-pool.js';

export interface TransportOptions {
  readonly apiUrl: string;
  readonly requestTimeoutMs: number;
  readonly pool: TokenPool;
  readonly scheduler: RequestScheduler;
  readonly now?: () => Date;
  readonly fetchImpl?: typeof fetch;
  /** 지표·로그 훅. 토큰 값은 넘기지 않는다. */
  readonly onResponse?: (event: TransportEvent) => void;
}

export interface TransportEvent {
  readonly org: string;
  readonly installationId: number;
  readonly path: string;
  readonly status: number;
  readonly durationMs: number;
  readonly remaining: number | undefined;
  readonly priority: RequestPriority;
}

export interface RequestOptions {
  readonly org: string;
  readonly path: string;
  readonly priority?: RequestPriority;
  readonly query?: Readonly<Record<string, string | number | undefined>>;
}

export class GitHubTransport {
  readonly #options: TransportOptions;

  constructor(options: TransportOptions) {
    this.#options = options;
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
    const priority = options.priority ?? 'realtime';
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

    return this.#options.scheduler.run(priority, async () => {
      const startedAt = Date.now();
      const doFetch = this.#options.fetchImpl ?? fetch;
      let response: Response;
      try {
        response = await doFetch(url.toString(), {
          method: 'GET',
          headers: {
            // 토큰은 헤더로만. URL이나 인자에 실지 않는다 (THR-009).
            authorization: `Bearer ${lease.token.token}`,
            accept: 'application/vnd.github+json',
            'x-github-api-version': '2022-11-28',
          },
          signal: AbortSignal.timeout(this.#options.requestTimeoutMs),
        });
      } catch (error) {
        const timedOut = error instanceof Error && error.name === 'TimeoutError';
        throw new GitHubApiError(timedOut ? 'timeout' : 'network', safeMessage(error));
      }

      const now = this.#now();
      const snapshot = parseRateLimitHeaders(response.headers, now);
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

      return (await response.json()) as T;
    });
  }

  /** 페이지네이션. `per_page` 상한과 최대 페이지 수로 폭주를 막는다. */
  async getAll<T>(options: RequestOptions & { perPage?: number; maxItems?: number }): Promise<T[]> {
    const perPage = options.perPage ?? 100;
    const maxItems = options.maxItems ?? 3000;
    const collected: T[] = [];
    for (let page = 1; collected.length < maxItems; page += 1) {
      const batch = await this.get<T[]>({
        ...options,
        query: { ...options.query, per_page: perPage, page },
      });
      if (!Array.isArray(batch) || batch.length === 0) break;
      collected.push(...batch);
      if (batch.length < perPage) break;
    }
    return collected.slice(0, maxItems);
  }
}
