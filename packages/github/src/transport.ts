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
    return this.#fetchJson<T>(options, () => undefined);
  }

  async #fetchJson<T>(options: RequestOptions, observe: (response: Response) => void): Promise<T> {
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

      return (await response.json()) as T;
    });
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
    const body = await this.#fetchJson<T>(options, (response) => {
      captured = {
        link: response.headers.get('link'),
        requestId: response.headers.get('x-github-request-id'),
        status: response.status,
      };
    });
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
