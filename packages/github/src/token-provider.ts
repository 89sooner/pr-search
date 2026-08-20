/**
 * 설치 토큰 발급과 갱신 (WP-006 DoD 1).
 *
 * 설치 토큰은 1시간짜리다. 만료된 뒤에 401을 받고 갱신하면 그 요청 하나를
 * 버리게 되므로, 만료 전에 미리 바꾼다.
 *
 * 이 모듈은 토큰을 **발급**만 한다. 어떤 토큰을 쓸지 고르는 일은 `TokenPool`,
 * 언제 쓸지 정하는 일은 `RequestScheduler`가 한다. 셋을 한 클래스에 넣으면
 * "만료됐나"와 "한도가 남았나"와 "실시간이 먼저인가"가 한 조건문에서 뒤엉킨다.
 */

import { createAppJwt } from './jwt.js';
import { GitHubApiError, classifyStatus } from './errors.js';
import { safeMessage } from './redact.js';

export interface InstallationToken {
  readonly token: string;
  readonly expiresAt: Date;
}

export interface TokenProviderOptions {
  readonly apiUrl: string;
  readonly appId: string;
  readonly privateKey: string;
  readonly refreshLeadMs: number;
  readonly requestTimeoutMs: number;
  readonly now?: () => Date;
  readonly fetchImpl?: typeof fetch;
}

/** 남은 수명이 이만큼 미만이면 만료된 것으로 본다. */
export function isExpiring(token: InstallationToken, now: Date, leadMs: number): boolean {
  return token.expiresAt.getTime() - now.getTime() <= leadMs;
}

export class InstallationTokenProvider {
  readonly #options: TokenProviderOptions;
  readonly #cache = new Map<number, InstallationToken>();
  /** 같은 설치에 대한 동시 갱신을 하나로 접는다. */
  readonly #inFlight = new Map<number, Promise<InstallationToken>>();
  #issueCount = 0;

  constructor(options: TokenProviderOptions) {
    this.#options = options;
  }

  /** 지금까지 실제로 발급한 횟수. 갱신 동작 검증에 쓴다. */
  get issueCount(): number {
    return this.#issueCount;
  }

  /** 유효한 설치 토큰. 만료가 가까우면 새로 받는다. */
  async getToken(installationId: number): Promise<InstallationToken> {
    const now = (this.#options.now ?? ((): Date => new Date()))();
    const cached = this.#cache.get(installationId);
    if (cached !== undefined && !isExpiring(cached, now, this.#options.refreshLeadMs)) {
      return cached;
    }

    const pending = this.#inFlight.get(installationId);
    if (pending !== undefined) return pending;

    const request = this.#issue(installationId).finally(() => {
      this.#inFlight.delete(installationId);
    });
    this.#inFlight.set(installationId, request);
    return request;
  }

  /** 강제 무효화. 401을 받은 뒤 다음 요청이 새 토큰을 받게 한다. */
  invalidate(installationId: number): void {
    this.#cache.delete(installationId);
  }

  async #issue(installationId: number): Promise<InstallationToken> {
    const jwt = createAppJwt({ appId: this.#options.appId, privateKey: this.#options.privateKey });
    const url = `${this.#options.apiUrl}/app/installations/${String(installationId)}/access_tokens`;
    const doFetch = this.#options.fetchImpl ?? fetch;

    let response: Response;
    try {
      response = await doFetch(url, {
        method: 'POST',
        headers: {
          // JWT는 헤더로만 간다. argv나 URL에 실지 않는다.
          authorization: `Bearer ${jwt}`,
          accept: 'application/vnd.github+json',
        },
        signal: AbortSignal.timeout(this.#options.requestTimeoutMs),
      });
    } catch (error) {
      const timedOut = error instanceof Error && error.name === 'TimeoutError';
      throw new GitHubApiError(timedOut ? 'timeout' : 'network', safeMessage(error));
    }

    if (!response.ok) {
      // 본문에도 자격 증명이 섞일 수 있으므로 가려서 넣는다.
      const body = safeMessage(await response.text().catch(() => ''));
      throw new GitHubApiError(
        classifyStatus(response.status),
        `설치 토큰 발급 실패 (${String(response.status)}): ${body.slice(0, 200)}`,
        { status: response.status },
      );
    }

    const payload = (await response.json()) as { token?: unknown; expires_at?: unknown };
    if (typeof payload.token !== 'string' || typeof payload.expires_at !== 'string') {
      throw new GitHubApiError('server', '설치 토큰 응답 형식이 예상과 다르다');
    }

    const token: InstallationToken = { token: payload.token, expiresAt: new Date(payload.expires_at) };
    this.#cache.set(installationId, token);
    this.#issueCount += 1;
    return token;
  }
}
