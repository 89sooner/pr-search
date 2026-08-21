/**
 * 접근 범위 산출 (FR-AUTH-002, FR-AUTH-003, 보안 문서 5.2).
 *
 * ```text
 * resolveAccessScope(user)
 *   ├─ Redis 조회 (TTL 5분)          → 적중 시 반환
 *   ├─ PostgreSQL permission_cache   → 5분 이내면 Redis 채우고 반환
 *   └─ GHE API 조회
 *       ├─ 성공 → Redis + PostgreSQL 갱신 후 반환
 *       └─ 실패 → 오류. 만료 캐시를 쓰지 않는다 (AC-3, 기본 거부)
 * ```
 *
 * **두 가지를 절대 하지 않는다.**
 *
 * 1. 만료된 캐시로 대신하지 않는다 (FR-AUTH-003 AC-3). 5분 지난 캐시가
 *    있더라도 GHE 조회가 실패하면 오류다. "조금 낡았지만 있는 답"과
 *    "모른다"를 섞으면 권한 회수가 반영되지 않는다.
 * 2. 빈 범위를 성공으로 돌려주지 않는다. 실패는 던지고, 빈 범위는 빈 범위로
 *    돌려준다 — `applyMandatoryScopeFilter`가 그것을 기본 거부로 바꾼다.
 */

import { EXPLICIT_SCOPE_LIMIT, shouldUseOrgTeamScope, type AccessScope } from '@prs/es';
import type { AccessScopeSource, RawAccessScope } from './scope-source.js';

/** FR-AUTH-003 AC-1. */
export const CACHE_TTL_MS = 5 * 60 * 1000;
export const CACHE_TTL_SECONDS = CACHE_TTL_MS / 1000;

/** FR-AUTH-003 예외 처리: 대량 무효화 시 GHE 조회 폭주를 막는 동시 요청 상한. */
export const DEFAULT_MAX_CONCURRENT_REFRESH = 20;

export const SCOPE_KEY_PREFIX = 'prs:scope:';

export function scopeKey(userId: string): string {
  return `${SCOPE_KEY_PREFIX}${userId}`;
}

/** 캐시에 담기는 모양. `AccessScope`보다 넓다 — 두 모드 사이를 오갈 수 있어야 한다. */
export interface CachedScope {
  readonly repositoryIds: readonly number[];
  readonly orgIds: readonly number[];
  readonly teamIds: readonly number[];
  readonly visibilities: readonly string[];
  readonly refreshedAt: number;
  readonly version: number;
}

export interface ScopeRedis {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: 'EX', seconds: number): Promise<unknown>;
  del(...keys: string[]): Promise<number>;
}

/** PostgreSQL 백업 계층. `@prs/db`의 `authRepo`를 이 모양으로 맞춰 넣는다. */
export interface ScopeDatabase {
  readUser(userId: string): Promise<{ readonly login: string; readonly version: number } | null>;
  readCache(userId: string): Promise<CachedScope | null>;
  writeCache(userId: string, scope: CachedScope): Promise<boolean>;
}

/** 캐시 적중률 지표 (FR-AUTH-003 AC-5). */
export interface ScopeMetrics {
  hit(layer: 'redis' | 'postgres'): void;
  miss(): void;
  refreshFailed(): void;
  /** 무효화가 끼어들어 갱신 결과를 버린 횟수 (CR-015, DEV-044). */
  fenced(): void;
}

export interface ScopeResolverOptions {
  readonly redis: ScopeRedis;
  readonly db: ScopeDatabase;
  readonly source: AccessScopeSource;
  readonly metrics?: ScopeMetrics;
  readonly maxConcurrentRefresh?: number;
  readonly now?: () => number;
}

/**
 * 접근 범위를 확인할 수 없다 (FR-AUTH-002 예외 처리).
 *
 * API 계층이 503 `PERMISSION_UNAVAILABLE`로 옮긴다. **부분 결과를 내지
 * 않는다** — 빈 결과를 200으로 주면 사용자는 "볼 수 있는 것이 없다"로 읽는다.
 */
export class ScopeUnavailableError extends Error {
  constructor(reason: string) {
    super(`접근 범위를 조회할 수 없다: ${reason}`);
    this.name = 'ScopeUnavailableError';
  }
}

/**
 * 접근 범위를 결정한다.
 *
 * 같은 사용자에 대한 동시 요청은 **하나로 병합한다** (FR-AUTH-003 예외 처리).
 * 팀 전원 무효화 직후에는 그 팀의 모든 사용자가 동시에 캐시 미스를 내는데,
 * 병합하지 않으면 사용자 한 명이 열어 둔 탭 수만큼 GHE 조회가 나간다.
 */
export class AccessScopeResolver {
  readonly #redis: ScopeRedis;
  readonly #db: ScopeDatabase;
  readonly #source: AccessScopeSource;
  readonly #metrics: ScopeMetrics | undefined;
  readonly #now: () => number;
  readonly #maxConcurrent: number;

  /** 사용자별 진행 중인 갱신. 요청 병합의 실체다. */
  readonly #inFlight = new Map<string, Promise<CachedScope>>();
  /** 동시 갱신 상한을 기다리는 대기열. */
  readonly #waiting: (() => void)[] = [];
  #running = 0;

  constructor(options: ScopeResolverOptions) {
    this.#redis = options.redis;
    this.#db = options.db;
    this.#source = options.source;
    this.#metrics = options.metrics;
    this.#now = options.now ?? Date.now;
    this.#maxConcurrent = options.maxConcurrentRefresh ?? DEFAULT_MAX_CONCURRENT_REFRESH;
  }

  /**
   * @throws {ScopeUnavailableError} 세 계층 모두에서 신선한 답을 얻지 못하면.
   */
  async resolve(userId: string): Promise<AccessScope> {
    return toAccessScope(await this.resolveCached(userId));
  }

  /** `/me`가 쓰는 형태 — 요약에 `refreshedAt`이 필요하다. */
  async resolveCached(userId: string): Promise<CachedScope> {
    const fromRedis = await this.#readRedis(userId);
    if (fromRedis !== null) {
      this.#metrics?.hit('redis');
      return fromRedis;
    }

    const fromDb = await this.#db.readCache(userId);
    if (fromDb !== null && this.#isFresh(fromDb)) {
      this.#metrics?.hit('postgres');
      // Redis를 다시 채운다. 다음 요청은 한 계층에서 끝난다.
      await this.#writeRedis(userId, fromDb);
      return fromDb;
    }

    this.#metrics?.miss();
    return this.#refresh(userId);
  }

  /** 무효화 (FR-AUTH-003 AC-2). Redis만 지운다 — PostgreSQL은 호출 측 트랜잭션이 맡는다. */
  async forget(userIds: readonly string[]): Promise<void> {
    if (userIds.length === 0) return;
    await this.#redis.del(...userIds.map(scopeKey));
  }

  #isFresh(scope: CachedScope): boolean {
    return this.#now() - scope.refreshedAt < CACHE_TTL_MS;
  }

  async #readRedis(userId: string): Promise<CachedScope | null> {
    let raw: string | null;
    try {
      raw = await this.#redis.get(scopeKey(userId));
    } catch {
      // Redis 장애는 치명적이지 않다. PostgreSQL과 GHE가 남아 있다.
      return null;
    }
    if (raw === null) return null;

    const parsed = parseCachedScope(raw);
    // Redis TTL이 이미 5분이지만, 값에 담긴 시각으로 한 번 더 본다. TTL 설정이
    // 잘못된 배포 하나가 만료 캐시를 살려 두는 일을 막는다 (AC-3).
    return parsed !== null && this.#isFresh(parsed) ? parsed : null;
  }

  async #writeRedis(userId: string, scope: CachedScope): Promise<void> {
    const remaining = Math.ceil((scope.refreshedAt + CACHE_TTL_MS - this.#now()) / 1000);
    if (remaining <= 0) return;
    try {
      await this.#redis.set(scopeKey(userId), JSON.stringify(scope), 'EX', remaining);
    } catch {
      // 캐시를 못 써도 답은 이미 있다. 다음 요청이 다시 조회할 뿐이다.
    }
  }

  /** GHE 조회. 같은 사용자의 동시 요청을 하나로 묶는다. */
  async #refresh(userId: string): Promise<CachedScope> {
    const existing = this.#inFlight.get(userId);
    if (existing !== undefined) return existing;

    const promise = this.#refreshOnce(userId).finally(() => {
      this.#inFlight.delete(userId);
    });
    this.#inFlight.set(userId, promise);
    return promise;
  }

  async #refreshOnce(userId: string): Promise<CachedScope> {
    const user = await this.#db.readUser(userId);
    if (user === null) {
      // 세션이 있는데 사용자 행이 없다. 로그인이 만들었어야 하므로 정합성
      // 문제이며, 빈 범위로 조용히 넘기지 않는다.
      throw new ScopeUnavailableError(`사용자 '${userId}'가 등록되어 있지 않다`);
    }

    // **버전을 먼저 읽는다.** 이 값이 울타리다 (CR-015, DEV-044).
    const versionAtStart = user.version;

    await this.#acquire();
    let raw: RawAccessScope;
    try {
      raw = await this.#source.fetch({ userId, login: user.login });
    } catch (error) {
      this.#metrics?.refreshFailed();
      throw new ScopeUnavailableError(error instanceof Error ? error.message : String(error));
    } finally {
      this.#release();
    }

    const scope: CachedScope = {
      repositoryIds: raw.repositoryIds,
      orgIds: raw.orgIds,
      teamIds: raw.teamIds,
      visibilities: raw.visibilities,
      refreshedAt: this.#now(),
      version: versionAtStart,
    };

    // 무효화가 끼어들었으면 기록하지 않는다. 버린 결과는 손실이 아니다 —
    // 다음 요청이 다시 조회하고, 그때는 회수가 반영된 범위를 얻는다.
    const written = await this.#db.writeCache(userId, scope);
    if (!written) {
      this.#metrics?.fenced();
      return scope;
    }

    await this.#writeRedis(userId, scope);
    return scope;
  }

  /** 동시 갱신 상한. 팀 전원 무효화가 GHE를 몰아치지 않게 한다. */
  async #acquire(): Promise<void> {
    if (this.#running < this.#maxConcurrent) {
      this.#running += 1;
      return;
    }
    await new Promise<void>((resolve) => this.#waiting.push(resolve));
    this.#running += 1;
  }

  #release(): void {
    this.#running -= 1;
    const next = this.#waiting.shift();
    if (next !== undefined) next();
  }
}

/**
 * 캐시된 범위를 필터에 쓸 모양으로 옮긴다 (FR-AUTH-002 AC-6).
 *
 * 500개를 넘으면 `terms` 목록 대신 조직·팀 조건으로 치환한다. 저장소 ID
 * 수천 개를 담은 `terms` 절은 질의 파싱과 캐시 키 계산만으로 무거워진다.
 *
 * **두 모드의 결과 집합은 같아야 한다.** `org_team`이 `explicit`보다 넓으면
 * 권한 없는 문서가 새고, 좁으면 볼 수 있어야 할 것이 사라진다 (보안 문서 5.2).
 */
export function toAccessScope(scope: CachedScope): AccessScope {
  if (!shouldUseOrgTeamScope(scope.repositoryIds.length)) {
    return { kind: 'explicit', repositoryIds: scope.repositoryIds };
  }
  return {
    kind: 'org_team',
    orgIds: scope.orgIds,
    teamIds: scope.teamIds,
    visibilities: scope.visibilities,
  };
}

export function parseCachedScope(raw: string): CachedScope | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;

  const value = parsed as Record<string, unknown>;
  const numbers = (key: string): number[] | null => {
    const list = value[key];
    if (!Array.isArray(list) || list.some((one) => typeof one !== 'number')) return null;
    return list as number[];
  };

  const repositoryIds = numbers('repositoryIds');
  const orgIds = numbers('orgIds');
  const teamIds = numbers('teamIds');
  const visibilities = value['visibilities'];

  if (repositoryIds === null || orgIds === null || teamIds === null) return null;
  if (!Array.isArray(visibilities) || visibilities.some((one) => typeof one !== 'string')) return null;
  if (typeof value['refreshedAt'] !== 'number' || typeof value['version'] !== 'number') return null;

  return {
    repositoryIds,
    orgIds,
    teamIds,
    visibilities: visibilities as string[],
    refreshedAt: value['refreshedAt'],
    version: value['version'],
  };
}

export { EXPLICIT_SCOPE_LIMIT };
