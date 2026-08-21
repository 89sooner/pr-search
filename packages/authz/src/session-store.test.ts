/**
 * 세션 저장소 (WP-012 DoD 3, FR-AUTH-001 AC-5).
 */

import { describe, expect, it } from 'vitest';
import { ABSOLUTE_TIMEOUT_MS, IDLE_TIMEOUT_MS, type SessionRecord } from './session.js';
import {
  SessionStore,
  TOUCH_INTERVAL_MS,
  cookieMaxAgeSeconds,
  parseSession,
  sessionKey,
  type SessionRedis,
} from './session-store.js';

const T0 = Date.UTC(2026, 7, 21, 9, 0, 0);

/** 만료(EX)를 실제로 흉내 내는 가짜 Redis. TTL이 지난 키는 사라진다. */
class FakeRedis implements SessionRedis {
  readonly entries = new Map<string, { value: string; expiresAt: number }>();
  now = T0;

  #live(key: string): { value: string; expiresAt: number } | undefined {
    const entry = this.entries.get(key);
    if (entry === undefined) return undefined;
    if (this.now >= entry.expiresAt) {
      this.entries.delete(key);
      return undefined;
    }
    return entry;
  }

  get(key: string): Promise<string | null> {
    return Promise.resolve(this.#live(key)?.value ?? null);
  }

  set(key: string, value: string, _mode: 'EX', seconds: number): Promise<unknown> {
    this.entries.set(key, { value, expiresAt: this.now + seconds * 1000 });
    return Promise.resolve('OK');
  }

  del(...keys: string[]): Promise<number> {
    let removed = 0;
    for (const key of keys) if (this.entries.delete(key)) removed += 1;
    return Promise.resolve(removed);
  }

  scan(cursor: string, _m: 'MATCH', pattern: string, _c: 'COUNT', _n: number): Promise<[string, string[]]> {
    if (cursor !== '0') return Promise.resolve(['0', []]);
    const prefix = pattern.replace(/\*$/, '');
    const keys = [...this.entries.keys()].filter((key) => key.startsWith(prefix) && this.#live(key) !== undefined);
    return Promise.resolve(['0', keys]);
  }
}

function session(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    sessionId: 'sid-1',
    userId: 'sub-1',
    login: 'kim',
    email: null,
    roles: ['developer'],
    issuedAt: T0,
    lastSeenAt: T0,
    correlationId: 'corr-1',
    ...overrides,
  };
}

function build(): { redis: FakeRedis; store: SessionStore } {
  const redis = new FakeRedis();
  return { redis, store: new SessionStore({ redis, now: () => redis.now }) };
}

describe('만들고 읽기', () => {
  it('만든 세션을 그대로 되읽는다', async () => {
    const { store } = build();
    await store.create(session());

    const loaded = await store.load('sid-1');
    expect(loaded?.session.userId).toBe('sub-1');
    expect(loaded?.session.roles).toEqual(['developer']);
  });

  it('없는 세션은 null이다', async () => {
    const { store } = build();
    expect(await store.load('nope')).toBeNull();
  });

  it('형식이 깨진 값은 세션이 아니며 지운다', async () => {
    const { redis, store } = build();
    await redis.set(sessionKey('broken'), 'not json', 'EX', 3600);

    expect(await store.load('broken')).toBeNull();
    expect(redis.entries.has(sessionKey('broken'))).toBe(false);
  });
});

describe('DoD 3: 만료가 저장소에서도 성립한다', () => {
  it('마지막 활동에서 8시간이 지나면 세션이 없다', async () => {
    const { redis, store } = build();
    await store.create(session());

    // 중간에 읽지 않는다. 읽는 것 자체가 활동이라 유휴 시각이 갱신된다.
    redis.now = T0 + IDLE_TIMEOUT_MS + 1000;
    expect(await store.load('sid-1')).toBeNull();
  });

  it('만료 직전 읽기는 성공하고, 그 읽기가 유휴 시각을 미룬다', async () => {
    const { redis, store } = build();
    await store.create(session());

    redis.now = T0 + IDLE_TIMEOUT_MS - 1000;
    const loaded = await store.load('sid-1');
    expect(loaded?.touched).toBe(true);

    // 방금 활동했으므로 원래 마감을 넘겨도 살아 있다.
    redis.now = T0 + IDLE_TIMEOUT_MS + 1000;
    expect(await store.load('sid-1')).not.toBeNull();

    // 그러나 그 활동에서 다시 8시간이 지나면 끝난다.
    redis.now = T0 + IDLE_TIMEOUT_MS - 1000 + IDLE_TIMEOUT_MS + 1;
    expect(await store.load('sid-1')).toBeNull();
  });

  it('활동을 이어 가도 절대 12시간에서 끊긴다', async () => {
    const { redis, store } = build();
    await store.create(session());

    // 1시간마다 활동을 이어 간다 — 유휴 만료는 계속 갱신된다.
    for (let hour = 1; hour <= 11; hour += 1) {
      redis.now = T0 + hour * 60 * 60 * 1000;
      expect(await store.load('sid-1')).not.toBeNull();
    }

    redis.now = T0 + ABSOLUTE_TIMEOUT_MS + 1;
    expect(await store.load('sid-1')).toBeNull();
  });

  it('TTL이 살아 있어도 절대 만료가 지났으면 읽는 즉시 지운다', async () => {
    const { redis, store } = build();
    await store.create(session());
    // 저장소 TTL을 인위적으로 늘려 놓는다 — 판정을 TTL에만 맡기지 않는지 본다.
    const entry = redis.entries.get(sessionKey('sid-1'));
    if (entry !== undefined) entry.expiresAt = T0 + 100 * 60 * 60 * 1000;

    redis.now = T0 + ABSOLUTE_TIMEOUT_MS + 1;
    expect(await store.load('sid-1')).toBeNull();
    expect(redis.entries.has(sessionKey('sid-1'))).toBe(false);
  });
});

describe('유휴 갱신', () => {
  it('1분 안에는 다시 쓰지 않는다', async () => {
    const { redis, store } = build();
    await store.create(session());

    redis.now = T0 + TOUCH_INTERVAL_MS - 1;
    const loaded = await store.load('sid-1');
    expect(loaded?.touched).toBe(false);
    expect(loaded?.session.lastSeenAt).toBe(T0);
  });

  it('1분이 지나면 유휴 시각을 갱신한다', async () => {
    const { redis, store } = build();
    await store.create(session());

    redis.now = T0 + TOUCH_INTERVAL_MS + 1;
    const loaded = await store.load('sid-1');
    expect(loaded?.touched).toBe(true);
    expect(loaded?.session.lastSeenAt).toBe(redis.now);
  });

  it('갱신해도 발급 시각은 그대로다 — 절대 만료가 밀리면 안 된다', async () => {
    const { redis, store } = build();
    await store.create(session());

    redis.now = T0 + 5 * 60 * 60 * 1000;
    const loaded = await store.load('sid-1');
    expect(loaded?.session.issuedAt).toBe(T0);
  });
});

describe('AC-5: 로그아웃', () => {
  it('서버 측 세션을 지운다 — 쿠키만 지우고 끝내지 않는다', async () => {
    const { redis, store } = build();
    await store.create(session());

    await store.destroy('sid-1');
    expect(await store.load('sid-1')).toBeNull();
    expect(redis.entries.has(sessionKey('sid-1'))).toBe(false);
  });

  it('한 사용자의 모든 세션을 끊는다 — 여러 기기', async () => {
    const { store } = build();
    await store.create(session({ sessionId: 'laptop' }));
    await store.create(session({ sessionId: 'phone' }));
    await store.create(session({ sessionId: 'other-user', userId: 'sub-2' }));

    expect(await store.destroyAllForUser('sub-1')).toBe(2);
    expect(await store.load('laptop')).toBeNull();
    expect(await store.load('phone')).toBeNull();
    // 다른 사용자의 세션은 건드리지 않는다.
    expect(await store.load('other-user')).not.toBeNull();
  });
});

describe('NFR-005: 세션에 토큰을 담지 않는다', () => {
  it('저장된 값에 토큰으로 보이는 필드가 없다', async () => {
    const { redis, store } = build();
    await store.create(session());

    const raw = redis.entries.get(sessionKey('sid-1'))?.value ?? '';
    for (const forbidden of ['id_token', 'access_token', 'refresh_token', 'code_verifier', 'client_secret']) {
      expect(raw).not.toContain(forbidden);
    }
  });
});

describe('되읽기 검증', () => {
  it('필드가 빠진 값은 세션이 아니다', () => {
    expect(parseSession('{}')).toBeNull();
    expect(parseSession(JSON.stringify({ sessionId: 's', userId: '' }))).toBeNull();
    expect(parseSession(JSON.stringify({ ...session(), roles: 'developer' }))).toBeNull();
    expect(parseSession(JSON.stringify({ ...session(), issuedAt: '2026' }))).toBeNull();
  });

  it('배열이나 원시값은 세션이 아니다', () => {
    expect(parseSession('[]')).toBeNull();
    expect(parseSession('"sid"')).toBeNull();
    expect(parseSession('null')).toBeNull();
  });

  it('역할 배열에 문자열 아닌 값이 섞이면 거절한다', () => {
    expect(parseSession(JSON.stringify({ ...session(), roles: ['developer', 7] }))).toBeNull();
  });
});

describe('쿠키 Max-Age', () => {
  it('절대 만료까지 남은 시간이다', () => {
    expect(cookieMaxAgeSeconds(session(), T0)).toBe(ABSOLUTE_TIMEOUT_MS / 1000);
    expect(cookieMaxAgeSeconds(session(), T0 + ABSOLUTE_TIMEOUT_MS - 60_000)).toBe(60);
  });

  it('지났으면 음수가 아니라 1이다', () => {
    expect(cookieMaxAgeSeconds(session(), T0 + ABSOLUTE_TIMEOUT_MS + 5000)).toBe(1);
  });
});
