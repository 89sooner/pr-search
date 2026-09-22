/**
 * 태그 ref 전용 클라이언트 (WP-100 / FR-SEQ-012, ADR-026).
 *
 * ## 쓰기 반경은 `refs/tags/M-*` 생성 하나다
 *
 * 이 클래스가 보낼 수 있는 변경 요청은 `POST /git/refs`에 `{ref, sha}`를 싣는 것뿐이다.
 * `PATCH /git/refs/{ref}`(이동·force)와 `DELETE /git/refs/{ref}`는 **메서드 자체가 없다** —
 * 「태그를 옮기거나 지우지 않는다」(FR-SEQ-012 AC-3·AC-8)를 약속이 아니라 코드 경로의 부재로
 * 만든다. 회귀 시험이 이 파일에 그 두 메서드 문자열이 없음을 잠근다.
 *
 * ## 왜 `@prs/github`의 `GitHubTransport`를 쓰지 않는가
 *
 * 표기 클라이언트(`@prs/github-annotate`)와 같은 이유다: 그 전송 계층은 조회용 Data App의
 * `TokenPool`에 묶여 있고, 거기에 쓰기를 더하면 조회 토큰으로 쓰기가 가능한 경로가 생긴다.
 * 여기 토큰은 태그 전용 App의 것뿐이며, 함께 쓰는 것은 신원을 모르는 순수 유틸리티
 * (`safeMessage`·헤더 해석·자격을 인자로 받는 `InstallationTokenProvider`)뿐이다.
 */

import {
  GitHubApiError,
  InstallationTokenProvider,
  parseRateLimitHeaders,
  parseRetryAfter,
  safeMessage,
} from '@prs/github';
import type { GitHubErrorKind, InstallationBinding } from '@prs/github';

import type { TagConfig } from './config.js';
import type { RefLookup } from './decision.js';

export type TagErrorKind =
  /** 공식 문서가 정한 대기 신호가 있다. 그 시각까지 기다렸다 다시 한다. */
  | 'rate_limited'
  /** 대기 신호 없는 403, 또는 변경 요청의 404. **이 저장소의 태그를 멈춘다** (FR-SEQ-012 예외 처리). */
  | 'permission'
  /** 401. 토큰을 버리고 한 번 다시 받는다. */
  | 'auth'
  /**
   * 422. 「Reference already exists」와 「Object does not exist」가 **같은 코드**로 온다 —
   * 본문 문구로 가르지 않고 호출부가 ref를 다시 읽어 판정한다.
   */
  | 'unprocessable'
  | 'server'
  | 'network'
  | 'timeout'
  /** 우리가 끊었다(예산·종료). 같은 회차에서 다시 보내지 않는다. */
  | 'aborted';

export class TagApiError extends Error {
  readonly kind: TagErrorKind;
  readonly status: number | undefined;
  readonly retryable: boolean;
  /** `rate_limited`에서만 채워진다. */
  readonly retryAt: Date | undefined;

  constructor(kind: TagErrorKind, message: string, options: { status?: number; retryAt?: Date } = {}) {
    super(safeMessage(message));
    this.name = 'TagApiError';
    this.kind = kind;
    this.status = options.status;
    this.retryAt = options.retryAt;
    this.retryable = kind !== 'permission' && kind !== 'unprocessable' && kind !== 'aborted';
  }
}

/**
 * 이 실패가 **원격 상태를 모르게 만드는가**. 변경 요청에서만 뜻이 있다 — 응답 본문을 받지
 * 못한 채 끝난 실패는 서버가 이미 ref를 만들었을 수 있다. 다음 시도의 `GET`이 답한다.
 */
export function leavesOutcomeUnknown(kind: TagErrorKind): boolean {
  return kind === 'timeout' || kind === 'network' || kind === 'aborted' || kind === 'server';
}

export interface RepositoryRef {
  readonly owner: string;
  readonly repo: string;
}

/** `matching-refs` 목록의 한 항목. `name`은 `refs/tags/` 뒤의 이름이다. */
export interface RemoteTagRef {
  readonly name: string;
  readonly sha: string;
  readonly objectType: string;
}

export interface TagRequestEvent {
  readonly method: 'GET' | 'POST';
  readonly owner: string;
  readonly repo: string;
  readonly status: number;
  readonly durationMs: number;
}

export interface RequestOptions {
  readonly signal?: AbortSignal;
}

export interface TagClientOptions {
  readonly config: TagConfig;
  readonly tokens?: InstallationTokenProvider;
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => Date;
  /** 지표·로그 훅. 토큰·태그 이름은 넘기지 않는다. */
  readonly onResponse?: (event: TagRequestEvent) => void;
}

/** GHES 3.15의 기본값이자 유일한 지원 값이다 (공식 문서). 다른 두 경로와 같은 값을 보낸다. */
const API_VERSION = '2022-11-28';
/** `matching-refs` 한 페이지. 공식 문서의 상한이다. */
const LIST_PAGE_SIZE = 100;
/** 한 접두의 태그 목록에서 읽는 최대 페이지 수. 이 위는 대조가 「부분 열거」로 보고한다. */
export const LIST_MAX_PAGES = 200;

interface RefPayload {
  readonly ref?: unknown;
  readonly object?: { readonly type?: unknown; readonly sha?: unknown };
}

function installationIndex(bindings: readonly InstallationBinding[]): ReadonlyMap<string, number> {
  return new Map(bindings.map((binding) => [binding.org.toLowerCase(), binding.installationId]));
}

function refPayloadToLookup(payload: RefPayload): RefLookup {
  const sha = payload.object?.sha;
  const type = payload.object?.type;
  if (typeof sha !== 'string' || typeof type !== 'string') {
    throw new TagApiError('server', 'ref 응답에 object.sha·object.type이 없다');
  }
  return { kind: 'found', sha: sha.toLowerCase(), objectType: type };
}

export class TagClient {
  readonly #config: TagConfig;
  readonly #tokens: InstallationTokenProvider;
  readonly #installations: ReadonlyMap<string, number>;
  readonly #fetch: typeof fetch;
  readonly #now: () => Date;
  readonly #onResponse: ((event: TagRequestEvent) => void) | undefined;

  constructor(options: TagClientOptions) {
    this.#config = options.config;
    this.#tokens =
      options.tokens ??
      new InstallationTokenProvider({
        apiUrl: options.config.apiUrl,
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
   * `refs/tags/<name>`을 읽는다. 404는 `missing`이다 — 비공개 저장소에 접근 권한이 없어도
   * 같은 404가 오므로(공식 문서), 이 결과만으로 「없다」를 확정하지 않는다. 확정은 뒤따르는
   * `POST`의 답(201·422·403/404)이 한다.
   */
  async readTagRef(ref: RepositoryRef, tagName: string, options: RequestOptions = {}): Promise<RefLookup> {
    const path = `/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}/git/ref/tags/${encodeURIComponent(tagName)}`;
    const outcome = await this.#request<RefPayload>('GET', ref, path, undefined, options, { notFoundIsMissing: true });
    if (outcome.kind === 'missing') return { kind: 'missing' };
    return refPayloadToLookup(outcome.payload);
  }

  /**
   * lightweight 태그를 만든다 — `POST /git/refs`에 `{ref: "refs/tags/<name>", sha}` 하나.
   * 태그 객체(tagger·message·서명)를 만들지 않으므로 annotated가 아니다 (FR-SEQ-012 AC-1).
   *
   * @returns GHE가 응답에 실은 대상 SHA. 보낸 값을 성공의 근거로 삼지 않는다.
   */
  async createTagRef(ref: RepositoryRef, tagName: string, sha: string, options: RequestOptions = {}): Promise<{ readonly sha: string }> {
    const path = `/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}/git/refs`;
    const outcome = await this.#request<RefPayload>('POST', ref, path, { ref: `refs/tags/${tagName}`, sha: sha.toLowerCase() }, options, {
      notFoundIsMissing: false,
    });
    if (outcome.kind === 'missing') throw new TagApiError('server', 'ref 생성 응답이 비었다');
    const created = refPayloadToLookup(outcome.payload);
    return { sha: created.kind === 'found' ? created.sha : sha.toLowerCase() };
  }

  /**
   * `refs/tags/<prefix>*` 목록 (`GET /git/matching-refs/tags/<prefix>`). 대조(reconcile)가 쓴다.
   * 페이지를 끝까지 읽는다 — `LIST_MAX_PAGES`를 넘으면 `truncated: true`로 돌려주고 호출부가
   * 「부분 열거」로 보고한다.
   */
  async listTagRefs(
    ref: RepositoryRef,
    prefix: string,
    options: RequestOptions = {},
  ): Promise<{ readonly refs: readonly RemoteTagRef[]; readonly truncated: boolean }> {
    const base = `/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}/git/matching-refs/tags/${encodeURIComponent(prefix)}`;
    const refs: RemoteTagRef[] = [];
    for (let page = 1; page <= LIST_MAX_PAGES; page += 1) {
      const outcome = await this.#request<RefPayload[]>('GET', ref, `${base}?per_page=${String(LIST_PAGE_SIZE)}&page=${String(page)}`, undefined, options, {
        notFoundIsMissing: false,
      });
      if (outcome.kind === 'missing') break;
      const items = Array.isArray(outcome.payload) ? outcome.payload : [];
      for (const item of items) {
        const name = typeof item.ref === 'string' && item.ref.startsWith('refs/tags/') ? item.ref.slice('refs/tags/'.length) : null;
        const sha = item.object?.sha;
        const type = item.object?.type;
        if (name === null || typeof sha !== 'string' || typeof type !== 'string') continue;
        refs.push({ name, sha: sha.toLowerCase(), objectType: type });
      }
      if (items.length < LIST_PAGE_SIZE) return { refs, truncated: false };
    }
    return { refs, truncated: true };
  }

  #installationFor(owner: string): number {
    const installationId = this.#installations.get(owner.toLowerCase());
    if (installationId === undefined) {
      throw new TagApiError('permission', `태그 전용 App의 설치가 없는 조직이다: ${owner}`);
    }
    return installationId;
  }

  async #request<T>(
    method: 'GET' | 'POST',
    ref: RepositoryRef,
    path: string,
    body: { readonly ref: string; readonly sha: string } | undefined,
    options: RequestOptions,
    behavior: { readonly notFoundIsMissing: boolean },
  ): Promise<{ readonly kind: 'ok'; readonly payload: T } | { readonly kind: 'missing' }> {
    const callerSignal = options.signal;
    if (callerSignal?.aborted === true) {
      throw new TagApiError('aborted', '시간 예산이 다해 요청을 보내지 않았다');
    }
    const installationId = this.#installationFor(ref.owner);
    let token;
    try {
      token = await this.#tokens.getToken(installationId);
    } catch (error) {
      throw fromProviderError(error);
    }
    const url = `${this.#config.apiUrl}${path}`;
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
        signal:
          callerSignal === undefined
            ? AbortSignal.timeout(this.#config.requestTimeoutMs)
            : AbortSignal.any([AbortSignal.timeout(this.#config.requestTimeoutMs), callerSignal]),
      });
    } catch (error) {
      const timedOut = error instanceof Error && error.name === 'TimeoutError';
      const aborted = callerSignal !== undefined && callerSignal.aborted && !timedOut;
      const kind: TagErrorKind = aborted ? 'aborted' : timedOut ? 'timeout' : 'network';
      throw new TagApiError(kind, safeMessage(error));
    }

    const now = this.#now();
    this.#onResponse?.({ method, owner: ref.owner, repo: ref.repo, status: response.status, durationMs: Date.now() - startedAt });

    if (response.ok) return { kind: 'ok', payload: (await response.json()) as T };
    if (response.status === 404 && behavior.notFoundIsMissing) {
      await response.text().catch(() => '');
      return { kind: 'missing' };
    }
    if (response.status === 401) this.#tokens.invalidate(installationId);

    const detail = safeMessage(await response.text().catch(() => '')).slice(0, 200);
    throw classifyFailure(response, now, detail);
  }
}

/**
 * 토큰 발급기의 오류를 태그 오류 모델로 옮긴다. 발급 경로의 `auth`·`not_found`는 재시도로
 * 풀리지 않으므로 권한 계열로 둔다(표기 클라이언트와 같은 근거).
 */
function fromProviderError(error: unknown): TagApiError {
  if (!(error instanceof GitHubApiError)) {
    return new TagApiError('server', `태그 토큰 발급이 실패했다: ${safeMessage(error)}`);
  }
  const mapping: Readonly<Record<GitHubErrorKind, TagErrorKind>> = {
    auth: 'permission',
    not_found: 'permission',
    rate_limited: 'rate_limited',
    secondary_rate_limited: 'rate_limited',
    server: 'server',
    network: 'network',
    timeout: 'timeout',
    client: 'unprocessable',
  };
  const kind: TagErrorKind = mapping[error.kind] ?? 'server';
  return new TagApiError(kind, `태그 토큰 발급이 실패했다: ${error.message}`, {
    ...(error.status === undefined ? {} : { status: error.status }),
    ...(kind === 'rate_limited' ? { retryAt: error.retryAt ?? new Date(Date.now() + 60_000) } : {}),
  });
}

/**
 * 응답을 오류로 옮긴다. 공식 문서가 정한 순서 그대로다 — 대기 신호(`retry-after` 또는
 * `x-ratelimit-remaining=0`)가 있으면 한도이고, 없는 403·404는 권한이다(표기와 같은 판정,
 * DEV-616). 422는 `unprocessable`로 돌려주고 호출부가 ref를 다시 읽어 뜻을 정한다.
 */
function classifyFailure(response: Response, now: Date, detail: string): TagApiError {
  const status = response.status;
  const retryAfter = parseRetryAfter(response.headers, now);
  const snapshot = parseRateLimitHeaders(response.headers, now);
  const waitUntil = retryAfter ?? (snapshot !== undefined && snapshot.remaining === 0 ? snapshot.resetAt : undefined);

  if (status === 429) {
    return new TagApiError('rate_limited', `GHE 한도에 걸렸다 (429): ${detail}`, { status, retryAt: waitUntil ?? new Date(now.getTime() + 60_000) });
  }
  if (status === 403 && waitUntil !== undefined) {
    return new TagApiError('rate_limited', `GHE 한도에 걸렸다 (403): ${detail}`, { status, retryAt: waitUntil });
  }
  if (status === 403 || status === 404) {
    return new TagApiError('permission', `태그 권한이 없다 (${String(status)}): ${detail}`, { status });
  }
  if (status === 401) {
    return new TagApiError('auth', `태그 토큰이 거부됐다 (401): ${detail}`, { status });
  }
  if (status === 422) {
    return new TagApiError('unprocessable', `GHE가 ref 요청을 거부했다 (422): ${detail}`, { status });
  }
  if (status >= 500) {
    return new TagApiError('server', `GHE 오류 (${String(status)}): ${detail}`, { status });
  }
  return new TagApiError('unprocessable', `예상하지 못한 응답 (${String(status)}): ${detail}`, { status });
}
