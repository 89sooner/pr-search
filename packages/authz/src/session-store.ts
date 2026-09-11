/**
 * Redis 세션 저장소 (보안 문서 4장).
 *
 * PostgreSQL 백업을 두지 않는다 — 세션 유실은 재로그인으로 복구되고, 세션을
 * 두 곳에 두면 로그아웃이 두 곳 모두에서 성립해야 한다 (AC-5를 어길 자리가
 * 하나 더 생긴다).
 *
 * Redis에는 **최소한만** 남긴다. ID 토큰·액세스 토큰·refresh 토큰을 세션에
 * 담지 않는다 (NFR-005: 저장소에 토큰 0건). 필요한 것은 누구인지와 언제
 * 시작했는지뿐이다.
 */

import {
  ABSOLUTE_TIMEOUT_MS,
  expiryOf,
  remainingTtlSeconds,
  type ExpiryReason,
  type SessionRecord,
} from './session.js';

/** Redis 키 접두. 다른 용도의 키와 섞이지 않게 한다. */
export const SESSION_KEY_PREFIX = 'prs:session:';

export function sessionKey(sessionId: string): string {
  return `${SESSION_KEY_PREFIX}${sessionId}`;
}

/**
 * 세션 저장소가 쓰는 Redis 명령만 추린 포트.
 *
 * `ioredis`의 `Redis` 전체가 아니라 이 넷만 받는다 — 테스트가 가짜를 만들기
 * 쉽고, 이 파일이 실수로 다른 명령을 쓰기 시작하면 타입이 막는다.
 */
export interface SessionRedis {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: 'EX', seconds: number): Promise<unknown>;
  del(...keys: string[]): Promise<number>;
  scan(cursor: string, match: 'MATCH', pattern: string, count: 'COUNT', n: number): Promise<[string, string[]]>;
}

export interface SessionStoreOptions {
  readonly redis: SessionRedis;
  readonly now?: () => number;
}

export interface LoadedSession {
  readonly session: SessionRecord;
  /** 유휴 시각을 갱신했는가. 갱신했으면 쿠키 Max-Age도 다시 내보낸다. */
  readonly touched: boolean;
}

/**
 * 유휴 시각을 이 간격 안에서는 다시 쓰지 않는다.
 *
 * 매 요청마다 Redis에 쓰면 검색 한 번에 쓰기가 한 번씩 붙는다. 1분 해상도면
 * 8시간 유휴 만료 판정에 영향이 없다.
 */
export const TOUCH_INTERVAL_MS = 60 * 1000;

export class SessionStore {
  readonly #redis: SessionRedis;
  readonly #now: () => number;

  constructor(options: SessionStoreOptions) {
    this.#redis = options.redis;
    this.#now = options.now ?? Date.now;
  }

  async create(session: SessionRecord): Promise<void> {
    const ttl = remainingTtlSeconds(session, this.#now());
    await this.#redis.set(sessionKey(session.sessionId), JSON.stringify(session), 'EX', ttl);
  }

  /**
   * 세션을 읽고, 살아 있으면 유휴 시각을 갱신한다.
   *
   * 만료된 세션은 **읽는 즉시 지운다.** Redis TTL이 먼저 지워 주는 것이 보통
   * 이지만, 절대 만료는 TTL보다 이를 수 있고 (그럴 일이 없도록 TTL을 잡았지만)
   * 판정을 저장소 TTL에만 맡기면 그 가정이 깨지는 날 만료된 세션이 산다.
   */
  async load(sessionId: string): Promise<LoadedSession | null> {
    const raw = await this.#redis.get(sessionKey(sessionId));
    if (raw === null) return null;

    const session = parseSession(raw);
    if (session === null) {
      // 형식이 깨진 값은 세션이 아니다. 지우고 미인증으로 다룬다.
      await this.#redis.del(sessionKey(sessionId));
      return null;
    }

    const now = this.#now();
    const expired: ExpiryReason | null = expiryOf(session, now);
    if (expired !== null) {
      await this.#redis.del(sessionKey(session.sessionId));
      return null;
    }

    if (now - session.lastSeenAt < TOUCH_INTERVAL_MS) {
      return { session, touched: false };
    }

    const touched: SessionRecord = { ...session, lastSeenAt: now };
    await this.#redis.set(
      sessionKey(session.sessionId),
      JSON.stringify(touched),
      'EX',
      remainingTtlSeconds(touched, now),
    );
    return { session: touched, touched: true };
  }

  /** 로그아웃 (FR-AUTH-001 AC-5). 쿠키 삭제와 **함께** 부른다. */
  async destroy(sessionId: string): Promise<void> {
    await this.#redis.del(sessionKey(sessionId));
  }

  /**
   * 한 사용자의 모든 세션을 지운다.
   *
   * 여러 기기에서 로그인한 사용자의 접근을 한 번에 끊어야 할 때 쓴다.
   * `SCAN`으로 훑으므로 세션 수에 비례한다 — 요청 경로가 아니라 관리 경로에서만
   * 부른다. `KEYS`는 쓰지 않는다 (Redis를 멈춘다).
   */
  async destroyAllForUser(userId: string): Promise<number> {
    let cursor = '0';
    let removed = 0;

    do {
      const [next, keys] = await this.#redis.scan(cursor, 'MATCH', `${SESSION_KEY_PREFIX}*`, 'COUNT', 200);
      cursor = next;

      const doomed: string[] = [];
      for (const key of keys) {
        const raw = await this.#redis.get(key);
        if (raw === null) continue;
        const session = parseSession(raw);
        if (session !== null && session.userId === userId) doomed.push(key);
      }

      if (doomed.length > 0) removed += await this.#redis.del(...doomed);
    } while (cursor !== '0');

    return removed;
  }
}

/**
 * 저장된 값을 세션으로 되읽는다.
 *
 * Redis의 값은 우리가 쓴 것이지만, 형식이 바뀐 배포가 겹치는 순간에는 옛
 * 모양이 올 수 있다. **모양이 다르면 세션이 아니라고 말한다** — 절반만 채워진
 * 세션으로 권한 판정을 하는 것보다 재로그인이 낫다.
 */
export function parseSession(raw: string): SessionRecord | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;

  const value = parsed as Record<string, unknown>;
  if (typeof value['sessionId'] !== 'string' || value['sessionId'] === '') return null;
  if (typeof value['userId'] !== 'string' || value['userId'] === '') return null;
  if (typeof value['login'] !== 'string') return null;
  if (typeof value['issuedAt'] !== 'number' || typeof value['lastSeenAt'] !== 'number') return null;
  if (!Array.isArray(value['roles']) || value['roles'].some((role) => typeof role !== 'string')) return null;

  const email = value['email'];
  const correlationId = value['correlationId'];
  /*
   * `githubUserId`는 **선택 필드다** (CR-083). 없으면 없는 대로 둔다 — 이
   * 형식이 나오기 전에 발급된 세션과 OIDC로 만든 세션에는 원래 없다.
   *
   * 모양이 이상하면(정수가 아니거나 양수가 아니거나) 세션을 버리지 않고 **그
   * 값만 버린다.** 신원과 역할은 위의 필수 필드가 이미 정했고 이 값은 웹훅
   * 조회의 보조 키이므로, 여기서 `null`을 돌려주면 보조 키 하나 때문에 멀쩡한
   * 세션이 재로그인으로 밀린다.
   */
  const githubUserId = value['githubUserId'];
  const validGithubUserId =
    typeof githubUserId === 'number' && Number.isSafeInteger(githubUserId) && githubUserId > 0
      ? githubUserId
      : undefined;

  return {
    sessionId: value['sessionId'],
    userId: value['userId'],
    login: value['login'],
    email: typeof email === 'string' ? email : null,
    roles: value['roles'] as readonly string[],
    issuedAt: value['issuedAt'],
    lastSeenAt: value['lastSeenAt'],
    correlationId: typeof correlationId === 'string' ? correlationId : null,
    githubUserId: validGithubUserId,
  };
}

/** 절대 만료까지 남은 초. 쿠키 `Max-Age`에 쓴다. */
export function cookieMaxAgeSeconds(session: SessionRecord, now: number): number {
  return Math.max(1, Math.ceil((session.issuedAt + ABSOLUTE_TIMEOUT_MS - now) / 1000));
}
