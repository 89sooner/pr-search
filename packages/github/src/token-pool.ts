/**
 * 조직별 설치 토큰 풀 (백엔드 아키텍처 4.2).
 *
 * 저장소가 속한 조직마다 설치가 다르고, 설치마다 rate limit이 따로 걸린다.
 * 그래서 "어느 조직의 요청인가"가 곧 "어느 한도를 쓰는가"다.
 *
 * 이 모듈은 **어떤 토큰이 지금 쓸 수 있는가**만 안다. 발급은 `TokenProvider`,
 * 순서는 `RequestScheduler`의 일이다.
 */

import type { InstallationTokenProvider, InstallationToken } from './token-provider.js';
import {
  INITIAL_STATE,
  applyResponse,
  applySecondaryLimit,
  isAvailable,
  type RateLimitSnapshot,
  type TokenRateLimitState,
} from './rate-limit.js';

export interface InstallationBinding {
  readonly org: string;
  readonly installationId: number;
}

export interface PoolOptions {
  readonly installations: readonly InstallationBinding[];
  readonly quarantineThreshold: number;
  readonly now?: () => Date;
}

export interface LeasedToken {
  readonly org: string;
  readonly installationId: number;
  readonly token: InstallationToken;
}

export class TokenPool {
  readonly #provider: InstallationTokenProvider;
  readonly #options: PoolOptions;
  readonly #byOrg = new Map<string, number>();
  readonly #state = new Map<number, TokenRateLimitState>();

  constructor(provider: InstallationTokenProvider, options: PoolOptions) {
    this.#provider = provider;
    this.#options = options;
    for (const binding of options.installations) {
      this.#byOrg.set(binding.org, binding.installationId);
      this.#state.set(binding.installationId, INITIAL_STATE);
    }
  }

  #now(): Date {
    return (this.#options.now ?? ((): Date => new Date()))();
  }

  installationFor(org: string): number | undefined {
    return this.#byOrg.get(org);
  }

  state(installationId: number): TokenRateLimitState {
    return this.#state.get(installationId) ?? INITIAL_STATE;
  }

  /** 이 조직의 토큰을 지금 쓸 수 있는가. */
  isAvailable(org: string): boolean {
    const id = this.#byOrg.get(org);
    if (id === undefined) return false;
    return isAvailable(this.state(id), this.#now());
  }

  /** 격리가 풀리는 시각. 쓸 수 있으면 `undefined`. */
  availableAt(org: string): Date | undefined {
    const id = this.#byOrg.get(org);
    if (id === undefined) return undefined;
    const until = this.state(id).quarantinedUntil;
    return until !== undefined && until > this.#now() ? until : undefined;
  }

  async lease(org: string): Promise<LeasedToken> {
    const installationId = this.#byOrg.get(org);
    if (installationId === undefined) {
      throw new Error(`설치가 등록되지 않은 조직이다: ${org}`);
    }
    const token = await this.#provider.getToken(installationId);
    return { org, installationId, token };
  }

  /** 응답 헤더를 반영한다. 잔여가 임계 미만이면 회복 시각까지 격리된다. */
  observeResponse(installationId: number, snapshot: RateLimitSnapshot | undefined): void {
    this.#state.set(
      installationId,
      applyResponse(this.state(installationId), snapshot, this.#options.quarantineThreshold),
    );
  }

  /** 429를 받았다. `retry-after`가 지정한 시간만큼 격리한다. */
  observeSecondaryLimit(installationId: number, retryAt: Date): void {
    this.#state.set(installationId, applySecondaryLimit(this.state(installationId), retryAt));
  }

  /** 토큰이 거부되었다. 다음 요청이 새로 발급받게 한다. */
  invalidate(installationId: number): void {
    this.#provider.invalidate(installationId);
  }

  /** 지표용 스냅숏: `github_rate_limit_remaining{token}` (비동기 문서 10장). */
  remainingByInstallation(): ReadonlyMap<number, number> {
    const out = new Map<number, number>();
    for (const [id, state] of this.#state) {
      if (state.snapshot !== undefined) out.set(id, state.snapshot.remaining);
    }
    return out;
  }
}
