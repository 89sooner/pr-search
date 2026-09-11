/**
 * PR 제목 쓰기 전용 클라이언트 (WP-075 / FR-SEQ-009, ADR-022).
 *
 * ## 왜 `@prs/github`의 `GitHubTransport`를 쓰지 않는가
 *
 * 그 전송 계층은 `GET`만 갖고 조회용 Data App의 `TokenPool`에 묶여 있다. 거기에
 * `PATCH`를 더하면 **조회 토큰으로 쓰기가 가능한 코드 경로**가 생기고, 그 순간
 * `THR-047`의 완화 근거가 코드에서 사라진다. `ADR-022` 결정 1이 자격 분리를
 * 요구하므로 전송도 분리한다 — 이 파일의 토큰은 표기 전용 App의 것뿐이다.
 *
 * 함께 쓰는 것은 **신원을 모르는 순수 유틸리티**뿐이다: `safeMessage`(가림),
 * `parseRateLimitHeaders`·`parseRetryAfter`(헤더 해석), `InstallationTokenProvider`
 * (App 자격을 **인자로 받는** 토큰 발급기). 같은 기계를 다른 자격으로 한 번 더
 * 세우는 것이지 자격을 물려받는 것이 아니다.
 *
 * ## 쓰기 반경은 제목 한 필드다 (ADR-022 결정 2)
 *
 * 요청 본문은 언제나 `{"title": ...}` 하나다. `body`·`state`·`base`·
 * `maintainer_can_modify`도 같은 엔드포인트가 받지만(공식 문서), 그 필드를 실을
 * 수 있는 코드 경로 자체를 두지 않는다.
 */

import {
  GitHubApiError,
  InstallationTokenProvider,
  parseRateLimitHeaders,
  parseRetryAfter,
  safeMessage,
} from '@prs/github';
import type { GitHubErrorKind, InstallationBinding } from '@prs/github';

import type { AnnotateConfig } from './config.js';

export type AnnotateErrorKind =
  /** 공식 문서가 정한 대기 신호가 있다. 그 시각까지 기다렸다 다시 한다. */
  | 'rate_limited'
  /**
   * 대기 신호 없는 403, 또는 404.
   *
   * **이 저장소의 표기를 멈춘다** (FR-SEQ-009 예외 처리). 권한이 없는데 반복하면
   * 한도만 태운다.
   */
  | 'permission'
  /** 401. 토큰을 버리고 한 번 다시 받는다. */
  | 'auth'
  /** 422. 이 PR에 대해 영구 실패다 — 제목을 잘라서 성공시키지 않는다. */
  | 'validation'
  | 'server'
  | 'network'
  | 'timeout';

export class AnnotateApiError extends Error {
  readonly kind: AnnotateErrorKind;
  readonly status: number | undefined;
  /** 일시 실패인가. `permission`·`validation`은 아니다. */
  readonly retryable: boolean;
  /** `rate_limited`에서만 채워진다. */
  readonly retryAt: Date | undefined;

  constructor(
    kind: AnnotateErrorKind,
    message: string,
    options: { status?: number; retryAt?: Date } = {},
  ) {
    // 메시지는 언제나 가려진 상태로만 저장한다 (THR-009).
    super(safeMessage(message));
    this.name = 'AnnotateApiError';
    this.kind = kind;
    this.status = options.status;
    this.retryAt = options.retryAt;
    this.retryable = kind !== 'permission' && kind !== 'validation';
  }
}

export interface PullRequestRef {
  readonly owner: string;
  readonly repo: string;
  readonly pullRequestNumber: number;
}

export interface AnnotateRequestEvent {
  readonly method: 'GET' | 'PATCH';
  readonly owner: string;
  readonly repo: string;
  readonly pullRequestNumber: number;
  readonly status: number;
  readonly durationMs: number;
}

export interface AnnotateClientOptions {
  readonly config: AnnotateConfig;
  /** 주입하면 그것을 쓴다. 없으면 설정의 **표기 전용** 자격으로 하나 만든다. */
  readonly tokens?: InstallationTokenProvider;
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => Date;
  /** 지표·로그 훅. 토큰과 제목 문자열은 넘기지 않는다. */
  readonly onResponse?: (event: AnnotateRequestEvent) => void;
}

/** GHES 3.15의 기본값이자 유일한 지원 값이다 (공식 문서). 조회 경로와 같은 값을 보낸다. */
const API_VERSION = '2022-11-28';

function installationIndex(bindings: readonly InstallationBinding[]): ReadonlyMap<string, number> {
  return new Map(bindings.map((binding) => [binding.org.toLowerCase(), binding.installationId]));
}

export class AnnotateClient {
  readonly #config: AnnotateConfig;
  readonly #tokens: InstallationTokenProvider;
  readonly #installations: ReadonlyMap<string, number>;
  readonly #fetch: typeof fetch;
  readonly #now: () => Date;
  readonly #onResponse: ((event: AnnotateRequestEvent) => void) | undefined;

  constructor(options: AnnotateClientOptions) {
    this.#config = options.config;
    this.#tokens =
      options.tokens ??
      new InstallationTokenProvider({
        apiUrl: options.config.apiUrl,
        // 표기 전용 App의 자격이다. 조회 App의 값은 이 파일에 들어오지 않는다.
        appId: options.config.appId,
        privateKey: options.config.privateKey,
        refreshLeadMs: options.config.tokenRefreshLeadMs,
        requestTimeoutMs: options.config.requestTimeoutMs,
        ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
      });
    this.#installations = installationIndex(options.config.installations);
    this.#fetch = options.fetchImpl ?? fetch;
    this.#now = options.now ?? ((): Date => new Date());
    this.#onResponse = options.onResponse;
  }

  /**
   * **쓰기 직전에** 현재 제목을 읽는다 (WP-075 구현 범위).
   *
   * 이벤트나 PostgreSQL·ES에 저장된 제목을 쓰면 그 사이의 사용자 편집을 덮는다.
   */
  async readTitle(ref: PullRequestRef): Promise<string> {
    const payload = await this.#request<{ title?: unknown }>('GET', ref, undefined);
    if (typeof payload.title !== 'string') {
      throw new AnnotateApiError('server', 'PR 응답에 title 문자열이 없다');
    }
    return payload.title;
  }

  /**
   * 제목만 바꾼다. 돌려주는 값은 **GHE가 응답에 실은 제목**이다.
   *
   * 보낸 값을 성공의 근거로 삼지 않는다 — 서버가 무엇을 저장했는지는 서버가
   * 말하게 한다.
   */
  async updateTitle(ref: PullRequestRef, title: string): Promise<string> {
    // 본문은 이 한 줄이 전부다. 다른 필드를 더할 수 있는 인자를 두지 않는다.
    const payload = await this.#request<{ title?: unknown }>('PATCH', ref, { title });
    if (typeof payload.title !== 'string') {
      throw new AnnotateApiError('server', 'PR 갱신 응답에 title 문자열이 없다');
    }
    return payload.title;
  }

  #installationFor(owner: string): number {
    const installationId = this.#installations.get(owner.toLowerCase());
    if (installationId === undefined) {
      /*
       * 표기 전용 App이 이 조직에 설치되어 있지 않다. 재시도해도 달라지지 않으므로
       * 권한 계열로 다룬다 — 저장소를 차단하고 쿨다운 뒤 다시 본다.
       */
      throw new AnnotateApiError('permission', `표기 전용 App의 설치가 없는 조직이다: ${owner}`);
    }
    return installationId;
  }

  async #request<T>(
    method: 'GET' | 'PATCH',
    ref: PullRequestRef,
    body: { readonly title: string } | undefined,
  ): Promise<T> {
    const installationId = this.#installationFor(ref.owner);
    /*
     * **토큰 발급 실패를 이 모델로 옮긴다.**
     *
     * `InstallationTokenProvider`는 `GitHubApiError`를 던진다. 그대로 올리면
     * 호출부의 재시도와 한도 유예가 `AnnotateApiError`만 알아보므로 **일시적인
     * 토큰 엔드포인트 장애가 영구 실패로 기록되고** 회복이 다음 스윕까지 밀린다.
     */
    let token;
    try {
      token = await this.#tokens.getToken(installationId);
    } catch (error) {
      throw fromProviderError(error);
    }
    const url = `${this.#config.apiUrl}/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}/pulls/${String(ref.pullRequestNumber)}`;
    const startedAt = Date.now();

    let response: Response;
    try {
      response = await this.#fetch(url, {
        method,
        headers: {
          // 토큰은 헤더로만 간다. URL·argv·본문에 실지 않는다 (THR-009).
          authorization: `Bearer ${token.token}`,
          accept: 'application/vnd.github+json',
          'x-github-api-version': API_VERSION,
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(this.#config.requestTimeoutMs),
      });
    } catch (error) {
      const timedOut = error instanceof Error && error.name === 'TimeoutError';
      throw new AnnotateApiError(timedOut ? 'timeout' : 'network', safeMessage(error));
    }

    const now = this.#now();
    this.#onResponse?.({
      method,
      owner: ref.owner,
      repo: ref.repo,
      pullRequestNumber: ref.pullRequestNumber,
      status: response.status,
      durationMs: Date.now() - startedAt,
    });

    if (response.ok) return (await response.json()) as T;

    if (response.status === 401) {
      // 만료됐거나 회수됐다. 버리고 다음 시도가 새로 받게 한다.
      this.#tokens.invalidate(installationId);
    }

    const detail = safeMessage(await response.text().catch(() => '')).slice(0, 200);
    throw classifyFailure(response, now, detail);
  }
}

/**
 * 응답을 오류로 옮긴다. **공식 문서가 정한 순서를 그대로 따른다.**
 *
 * > If the `retry-after` response header is present, you should not retry your
 * > request until after that many seconds has elapsed. If the
 * > `x-ratelimit-remaining` header is `0`, you should not retry your request
 * > until after the time, in UTC epoch seconds, specified by the
 * > `x-ratelimit-reset` header. Otherwise, wait for at least one minute before
 * > retrying.
 *
 * ## 403을 한 덩어리로 다루지 않는 이유
 *
 * 같은 문서가 **주 한도와 부 한도 모두 `403` 또는 `429`로 온다**고 적는다. 그래서
 * 상태 코드만 보고 모든 403을 권한 거부로 단정하면, 한도 소진 한 번이 그 저장소의
 * 표기를 영구히 멈춘다. 반대로 전부 한도로 보면 권한이 없는 저장소에 계속 요청해
 * 한도만 태운다 — `FR-SEQ-009`가 막으려는 바로 그 상태다.
 *
 * **문서가 403의 두 원인을 구분하는 방법을 보장하지 않으므로**(DEV-616), 문서가
 * 보장하는 것만 쓴다: 대기 신호(`retry-after` 또는 `x-ratelimit-remaining=0`)가
 * 있으면 한도이고, 없으면 기다릴 근거가 없으니 권한 문제로 다룬다. `429`는 문서가
 * 한도 전용으로 정의하므로 신호가 없어도 한도이며, 그때는 문서의 마지막 문장대로
 * 최소 1분을 기다린다.
 */
/**
 * 토큰 발급기의 오류를 표기 오류 모델로 옮긴다.
 *
 * `not_found`를 권한으로 보는 이유는 공식 문서가 **비공개 자원에 대한 인증 부족을
 * `403`이 아니라 `404`로 답한다**고 적기 때문이다 — 존재 자체를 확인해 주지 않으려는
 * 설계이며, 우리 쪽에서는 「쓸 수 없다」로 같다.
 */
function fromProviderError(error: unknown): AnnotateApiError {
  if (!(error instanceof GitHubApiError)) {
    return new AnnotateApiError('server', `표기 토큰 발급이 실패했다: ${safeMessage(error)}`);
  }
  /*
   * **발급 경로의 `auth`는 재시도로 풀리지 않는다.**
   *
   * 요청 경로의 `401`은 토큰이 만료된 것이라 버리고 다시 받으면 되지만, 토큰
   * **발급** 자체가 인증에 실패했다면 App ID나 개인 키가 틀린 것이다. 행마다
   * 다섯 번씩 두드려도 답이 달라지지 않고 한도만 태운다. 권한 계열로 옮겨
   * 저장소를 막고 쿨다운 뒤에 다시 보게 한다 — 자격을 고치면 그때 풀린다.
   */
  const mapping: Readonly<Record<GitHubErrorKind, AnnotateErrorKind>> = {
    auth: 'permission',
    not_found: 'permission',
    rate_limited: 'rate_limited',
    secondary_rate_limited: 'rate_limited',
    server: 'server',
    network: 'network',
    timeout: 'timeout',
    client: 'validation',
  };
  const kind = mapping[error.kind];
  return new AnnotateApiError(kind, `표기 토큰 발급이 실패했다: ${error.message}`, {
    ...(error.status === undefined ? {} : { status: error.status }),
    // 한도 계열이면 발급기가 회복 시각을 알고 있다. 없으면 문서의 최소 대기를 쓴다.
    ...(kind === 'rate_limited' ? { retryAt: error.retryAt ?? new Date(Date.now() + 60_000) } : {}),
  });
}

function classifyFailure(response: Response, now: Date, detail: string): AnnotateApiError {
  const status = response.status;
  const retryAfter = parseRetryAfter(response.headers, now);
  const snapshot = parseRateLimitHeaders(response.headers, now);
  const waitUntil = retryAfter ?? (snapshot !== undefined && snapshot.remaining === 0 ? snapshot.resetAt : undefined);

  if (status === 429) {
    return new AnnotateApiError('rate_limited', `GHE 한도에 걸렸다 (429): ${detail}`, {
      status,
      retryAt: waitUntil ?? new Date(now.getTime() + 60_000),
    });
  }
  if (status === 403 && waitUntil !== undefined) {
    return new AnnotateApiError('rate_limited', `GHE 한도에 걸렸다 (403): ${detail}`, { status, retryAt: waitUntil });
  }
  if (status === 403 || status === 404) {
    return new AnnotateApiError('permission', `표기 권한이 없다 (${String(status)}): ${detail}`, { status });
  }
  if (status === 401) {
    return new AnnotateApiError('auth', `표기 토큰이 거부됐다 (401): ${detail}`, { status });
  }
  if (status === 422) {
    return new AnnotateApiError('validation', `GHE가 제목을 거부했다 (422): ${detail}`, { status });
  }
  if (status >= 500) {
    return new AnnotateApiError('server', `GHE 오류 (${String(status)}): ${detail}`, { status });
  }
  return new AnnotateApiError('validation', `예상하지 못한 응답 (${String(status)}): ${detail}`, { status });
}
