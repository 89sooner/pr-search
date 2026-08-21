/**
 * JWKS 조회와 캐시 (FR-AUTH-001 AC-4).
 *
 * ID 토큰 서명을 검증하려면 IdP의 공개키가 필요하다. 매 로그인마다 JWKS를
 * 받아 오면 IdP가 느려질 때 로그인이 함께 느려지므로 캐시한다.
 *
 * **모르는 `kid`가 오면 한 번은 다시 받아 온다.** IdP가 키를 회전하면 새 `kid`가
 * 캐시에 없고, 캐시 TTL이 끝날 때까지 모든 로그인이 실패한다. 다만 **재조회는
 * 최소 간격을 둔다** — 그렇게 하지 않으면 위조된 `kid`를 담은 토큰을 반복해서
 * 보내는 것만으로 IdP에 요청을 쏟아부을 수 있다.
 */

import { createPublicKey, type KeyObject } from 'node:crypto';
import { OidcError } from './errors.js';

/** 서명 검증에 쓸 수 있는 알고리즘. `none`과 HMAC 계열은 받지 않는다. */
export const SUPPORTED_ALGORITHMS = ['RS256', 'RS384', 'RS512', 'ES256', 'ES384'] as const;
export type SupportedAlgorithm = (typeof SUPPORTED_ALGORITHMS)[number];

const ALGORITHM_SET = new Set<string>(SUPPORTED_ALGORITHMS);

export function isSupportedAlgorithm(alg: string): alg is SupportedAlgorithm {
  return ALGORITHM_SET.has(alg);
}

/** 캐시 수명. 짧게 두어도 `kid` 미스 재조회가 회전을 즉시 흡수한다. */
export const JWKS_TTL_MS = 10 * 60 * 1000;
/** `kid` 미스로 인한 재조회의 최소 간격. 위조 `kid` 폭주를 막는다. */
export const JWKS_REFRESH_COOLDOWN_MS = 60 * 1000;

interface Jwk {
  readonly kid?: string;
  readonly kty?: string;
  readonly use?: string;
  readonly alg?: string;
  readonly [key: string]: unknown;
}

/** JWKS를 가져오는 방법. 테스트는 여기에 목을 넣는다. */
export type JwksFetcher = (uri: string) => Promise<{ readonly keys: readonly Jwk[] }>;

export interface JwksCacheOptions {
  readonly uri: string;
  readonly fetcher: JwksFetcher;
  readonly ttlMs?: number;
  readonly cooldownMs?: number;
  readonly now?: () => number;
}

export class JwksCache {
  readonly #uri: string;
  readonly #fetcher: JwksFetcher;
  readonly #ttlMs: number;
  readonly #cooldownMs: number;
  readonly #now: () => number;

  #keys = new Map<string, KeyObject>();
  /** 아직 한 번도 받지 않았음. 0으로 두면 시계가 0에 가까운 테스트에서 첫 조회를 건너뛴다. */
  #fetchedAt = Number.NEGATIVE_INFINITY;
  #inFlight: Promise<void> | null = null;

  constructor(options: JwksCacheOptions) {
    this.#uri = options.uri;
    this.#fetcher = options.fetcher;
    this.#ttlMs = options.ttlMs ?? JWKS_TTL_MS;
    this.#cooldownMs = options.cooldownMs ?? JWKS_REFRESH_COOLDOWN_MS;
    this.#now = options.now ?? Date.now;
  }

  /**
   * `kid`에 대응하는 공개키를 준다.
   *
   * @throws {OidcError} 재조회 뒤에도 없으면 던진다.
   */
  async getKey(kid: string): Promise<KeyObject> {
    if (this.#now() - this.#fetchedAt >= this.#ttlMs) await this.#refresh();

    const cached = this.#keys.get(kid);
    if (cached !== undefined) return cached;

    // 회전했을 수 있다. 쿨다운이 지났으면 한 번 더 받아 본다.
    if (this.#now() - this.#fetchedAt >= this.#cooldownMs) {
      await this.#refresh();
      const refreshed = this.#keys.get(kid);
      if (refreshed !== undefined) return refreshed;
    }

    throw new OidcError(`서명 키를 찾을 수 없다 (kid=${kid})`);
  }

  /** 같은 시점의 여러 로그인이 JWKS를 한 번만 받게 한다. */
  async #refresh(): Promise<void> {
    this.#inFlight ??= this.#fetchOnce().finally(() => {
      this.#inFlight = null;
    });
    await this.#inFlight;
  }

  async #fetchOnce(): Promise<void> {
    let document: { readonly keys: readonly Jwk[] };
    try {
      document = await this.#fetcher(this.#uri);
    } catch (error) {
      throw new OidcError(`JWKS 조회 실패: ${error instanceof Error ? error.message : String(error)}`);
    }

    if (!Array.isArray(document.keys)) {
      throw new OidcError('JWKS 응답에 keys 배열이 없다');
    }

    const next = new Map<string, KeyObject>();
    for (const jwk of document.keys) {
      // 서명 검증에 쓸 수 없는 키는 담지 않는다. 암호화용(`enc`) 키로 서명을
      // 검증하려 들면 실패 이유가 엉뚱해진다.
      if (jwk.use !== undefined && jwk.use !== 'sig') continue;
      if (typeof jwk.kid !== 'string' || jwk.kid === '') continue;
      if (jwk.kty !== 'RSA' && jwk.kty !== 'EC') continue;

      try {
        next.set(jwk.kid, createPublicKey({ key: jwk as never, format: 'jwk' }));
      } catch {
        // 개별 키가 깨졌다고 전체를 버리지 않는다. 나머지로 검증할 수 있다.
        continue;
      }
    }

    if (next.size === 0) throw new OidcError('JWKS에 쓸 수 있는 서명 키가 없다');

    this.#keys = next;
    this.#fetchedAt = this.#now();
  }
}
