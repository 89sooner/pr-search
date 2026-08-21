/**
 * 접근 범위 산출 (WP-012 DoD 6, DoD 7, DoD 8).
 *
 * 세 계층의 순서, 만료 캐시 미사용, `org_team` 전환, 무효화 울타리를 건다.
 */

import { describe, expect, it, vi } from 'vitest';
import type { AccessScopeSource, RawAccessScope } from './scope-source.js';
import {
  AccessScopeResolver,
  CACHE_TTL_MS,
  EXPLICIT_SCOPE_LIMIT,
  ScopeUnavailableError,
  parseCachedScope,
  scopeKey,
  toAccessScope,
  type CachedScope,
  type ScopeDatabase,
  type ScopeMetrics,
  type ScopeRedis,
} from './scope.js';

const T0 = Date.UTC(2026, 7, 21, 9, 0, 0);

class FakeRedis implements ScopeRedis {
  readonly entries = new Map<string, string>();
  failing = false;
  gets = 0;

  get(key: string): Promise<string | null> {
    this.gets += 1;
    if (this.failing) return Promise.reject(new Error('redis down'));
    return Promise.resolve(this.entries.get(key) ?? null);
  }

  set(key: string, value: string): Promise<unknown> {
    if (this.failing) return Promise.reject(new Error('redis down'));
    this.entries.set(key, value);
    return Promise.resolve('OK');
  }

  del(...keys: string[]): Promise<number> {
    let removed = 0;
    for (const key of keys) if (this.entries.delete(key)) removed += 1;
    return Promise.resolve(removed);
  }
}

class FakeDb implements ScopeDatabase {
  version = 0;
  cache: CachedScope | null = null;
  login = 'kim';
  userMissing = false;
  writes = 0;

  readUser(): Promise<{ login: string; version: number } | null> {
    return Promise.resolve(this.userMissing ? null : { login: this.login, version: this.version });
  }

  readCache(): Promise<CachedScope | null> {
    return Promise.resolve(this.cache);
  }

  writeCache(_userId: string, scope: CachedScope): Promise<boolean> {
    this.writes += 1;
    // 실제 SQL과 같은 규칙: 시작 시점 버전이 그대로일 때만 기록한다.
    if (scope.version !== this.version) return Promise.resolve(false);
    this.cache = scope;
    return Promise.resolve(true);
  }
}

function metrics(): ScopeMetrics & { counts: Record<string, number> } {
  const counts: Record<string, number> = { redis: 0, postgres: 0, miss: 0, failed: 0, fenced: 0 };
  return {
    counts,
    hit: (layer) => {
      counts[layer] = (counts[layer] ?? 0) + 1;
    },
    miss: () => {
      counts['miss'] = (counts['miss'] ?? 0) + 1;
    },
    refreshFailed: () => {
      counts['failed'] = (counts['failed'] ?? 0) + 1;
    },
    fenced: () => {
      counts['fenced'] = (counts['fenced'] ?? 0) + 1;
    },
  };
}

function source(scope: Partial<RawAccessScope> = {}): AccessScopeSource & { calls: number } {
  const impl = {
    calls: 0,
    fetch: async (): Promise<RawAccessScope> => {
      impl.calls += 1;
      return {
        repositoryIds: [10, 20],
        orgIds: [1],
        teamIds: [100],
        visibilities: ['public', 'internal'],
        ...scope,
      };
    },
  };
  return impl;
}

function build(overrides: { source?: AccessScopeSource; now?: () => number } = {}) {
  const redis = new FakeRedis();
  const db = new FakeDb();
  const m = metrics();
  const src = overrides.source ?? source();
  let clock = T0;
  const resolver = new AccessScopeResolver({
    redis,
    db,
    source: src,
    metrics: m,
    now: overrides.now ?? ((): number => clock),
  });
  return {
    redis,
    db,
    metrics: m,
    source: src,
    resolver,
    advance: (ms: number): void => {
      clock += ms;
    },
  };
}

describe('세 계층 순서 (보안 문서 5.2)', () => {
  it('Redis가 적중하면 PostgreSQL도 GHE도 부르지 않는다', async () => {
    const { resolver, redis, db, metrics: m, source: src } = build();
    await resolver.resolve('u1'); // 채운다
    const writesAfterFirst = db.writes;

    await resolver.resolve('u1');
    expect(m.counts['redis']).toBe(1);
    expect(src.calls).toBe(1);
    expect(db.writes).toBe(writesAfterFirst);
    expect(redis.entries.has(scopeKey('u1'))).toBe(true);
  });

  it('Redis 미스에 PostgreSQL이 신선하면 GHE를 부르지 않고 Redis를 채운다', async () => {
    const { resolver, redis, metrics: m, source: src } = build();
    await resolver.resolve('u1');
    redis.entries.clear();

    await resolver.resolve('u1');
    expect(m.counts['postgres']).toBe(1);
    expect(src.calls).toBe(1);
    // 다음 요청을 위해 다시 채워 둔다.
    expect(redis.entries.has(scopeKey('u1'))).toBe(true);
  });

  it('둘 다 없으면 GHE를 부르고 양쪽을 채운다', async () => {
    const { resolver, redis, db, metrics: m, source: src } = build();
    const scope = await resolver.resolve('u1');

    expect(m.counts['miss']).toBe(1);
    expect(src.calls).toBe(1);
    expect(db.cache).not.toBeNull();
    expect(redis.entries.has(scopeKey('u1'))).toBe(true);
    expect(scope).toEqual({ kind: 'explicit', repositoryIds: [10, 20] });
  });

  it('Redis가 죽어도 PostgreSQL과 GHE로 답한다', async () => {
    const { resolver, redis, source: src } = build();
    redis.failing = true;

    await expect(resolver.resolve('u1')).resolves.toEqual({ kind: 'explicit', repositoryIds: [10, 20] });
    expect(src.calls).toBe(1);
  });
});

describe('AC-3: 만료된 캐시를 쓰지 않는다', () => {
  it('5분이 지난 PostgreSQL 캐시는 무시하고 GHE를 부른다', async () => {
    const { resolver, redis, advance, source: src } = build();
    await resolver.resolve('u1');
    redis.entries.clear();

    advance(CACHE_TTL_MS + 1);
    await resolver.resolve('u1');
    expect(src.calls).toBe(2);
  });

  it('TTL이 지나지 않은 Redis 값도 시각으로 한 번 더 본다', async () => {
    const { resolver, redis, advance, source: src } = build();
    await resolver.resolve('u1');

    // TTL이 잘못 설정되어 Redis가 값을 살려 둔 상황을 만든다.
    advance(CACHE_TTL_MS + 1);
    // PostgreSQL 캐시도 함께 낡았으므로 GHE로 간다.
    await resolver.resolve('u1');
    expect(src.calls).toBe(2);
    expect(redis.entries.size).toBeGreaterThan(0);
  });

  it('GHE 조회가 실패하면 낡은 캐시로 대신하지 않고 던진다', async () => {
    const failing: AccessScopeSource = { fetch: () => Promise.reject(new Error('GHE 502')) };
    const { resolver, db, metrics: m } = build({ source: failing });
    // 낡은 캐시를 심어 둔다 — 유혹은 있지만 써서는 안 된다.
    db.cache = {
      repositoryIds: [999],
      orgIds: [],
      teamIds: [],
      visibilities: [],
      refreshedAt: T0 - CACHE_TTL_MS - 1,
      version: 0,
    };

    await expect(resolver.resolve('u1')).rejects.toThrow(ScopeUnavailableError);
    expect(m.counts['failed']).toBe(1);
  });

  it('사용자 행이 없으면 빈 범위가 아니라 오류다', async () => {
    const { resolver, db } = build();
    db.userMissing = true;
    await expect(resolver.resolve('ghost')).rejects.toThrow(/등록되어 있지 않다/);
  });
});

describe('DoD 8 / DEV-044: 무효화 울타리', () => {
  it('갱신 중에 무효화가 끼어들면 결과를 캐시에 쓰지 않는다', async () => {
    const db = new FakeDb();
    const redis = new FakeRedis();
    const m = metrics();
    let release = (): void => {};
    let started = (): void => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetchStarted = new Promise<void>((resolve) => {
      started = resolve;
    });

    const resolver = new AccessScopeResolver({
      redis,
      db,
      metrics: m,
      now: () => T0,
      source: {
        fetch: async () => {
          started();
          await gate;
          return { repositoryIds: [10, 20], orgIds: [1], teamIds: [], visibilities: [] };
        },
      },
    });

    const pending = resolver.resolve('u1');
    // 시작 시점 버전은 이미 읽혔다. 그 뒤에 권한이 회수된다.
    await fetchStarted;
    db.version += 1;
    db.cache = null;
    release();

    await pending;
    // 회수 이전의 범위가 캐시로 되살아나지 않았다.
    expect(db.cache).toBeNull();
    expect(redis.entries.has(scopeKey('u1'))).toBe(false);
    expect(m.counts['fenced']).toBe(1);
  });

  it('무효화가 없으면 그대로 기록한다', async () => {
    const { resolver, db, metrics: m } = build();
    await resolver.resolve('u1');
    expect(db.cache).not.toBeNull();
    expect(m.counts['fenced']).toBe(0);
  });

  it('울타리에 걸려도 이번 요청에는 답을 준다', async () => {
    // 버릴 것은 캐시이지 응답이 아니다. 이 요청은 조회 시점에 정확했다.
    const db = new FakeDb();
    db.version = 5;
    const resolver = new AccessScopeResolver({
      redis: new FakeRedis(),
      db,
      now: () => T0,
      source: {
        fetch: async () => {
          db.version = 6; // 조회 도중 무효화
          return { repositoryIds: [7], orgIds: [], teamIds: [], visibilities: [] };
        },
      },
    });

    await expect(resolver.resolve('u1')).resolves.toEqual({ kind: 'explicit', repositoryIds: [7] });
  });
});

describe('요청 병합과 동시 상한 (FR-AUTH-003 예외 처리)', () => {
  it('같은 사용자의 동시 요청이 GHE를 한 번만 부른다', async () => {
    const { resolver, source: src } = build();
    await Promise.all([resolver.resolve('u1'), resolver.resolve('u1'), resolver.resolve('u1')]);
    expect(src.calls).toBe(1);
  });

  it('동시 갱신이 상한 20을 넘지 않는다', async () => {
    let active = 0;
    let peak = 0;
    const gates: (() => void)[] = [];

    const resolver = new AccessScopeResolver({
      redis: new FakeRedis(),
      db: new FakeDb(),
      now: () => T0,
      source: {
        fetch: async () => {
          active += 1;
          peak = Math.max(peak, active);
          await new Promise<void>((resolve) => gates.push(resolve));
          active -= 1;
          return { repositoryIds: [1], orgIds: [], teamIds: [], visibilities: [] };
        },
      },
    });

    // 팀 전원 무효화 직후를 흉내 낸다 — 50명이 한꺼번에 미스를 낸다.
    const pending = Promise.all(Array.from({ length: 50 }, (_, i) => resolver.resolve(`u${String(i)}`)));
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    while (gates.length > 0) {
      gates.shift()?.();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    await pending;

    expect(peak).toBeLessThanOrEqual(20);
    expect(peak).toBeGreaterThan(1);
  });
});

describe('DoD 7 / AC-6: org_team 전환', () => {
  it('500개 이하는 explicit이다', () => {
    const scope: CachedScope = {
      repositoryIds: Array.from({ length: EXPLICIT_SCOPE_LIMIT }, (_, i) => i),
      orgIds: [1],
      teamIds: [2],
      visibilities: ['public', 'internal'],
      refreshedAt: T0,
      version: 0,
    };
    expect(toAccessScope(scope).kind).toBe('explicit');
  });

  it('501개부터 org_team이다', () => {
    const scope: CachedScope = {
      repositoryIds: Array.from({ length: EXPLICIT_SCOPE_LIMIT + 1 }, (_, i) => i),
      orgIds: [1],
      teamIds: [2],
      visibilities: ['public', 'internal'],
      refreshedAt: T0,
      version: 0,
    };
    const converted = toAccessScope(scope);
    expect(converted).toEqual({
      kind: 'org_team',
      orgIds: [1],
      teamIds: [2],
      visibilities: ['public', 'internal'],
    });
  });

  it('전환해도 저장소 목록은 캐시에 남는다 — 임계를 오갈 때 다시 조회하지 않는다', async () => {
    const many = Array.from({ length: EXPLICIT_SCOPE_LIMIT + 5 }, (_, i) => i);
    const { resolver, db } = build({ source: source({ repositoryIds: many }) });

    expect((await resolver.resolve('u1')).kind).toBe('org_team');
    expect(db.cache?.repositoryIds).toHaveLength(many.length);
  });
});

describe('무효화', () => {
  it('forget이 Redis 키를 지운다', async () => {
    const { resolver, redis } = build();
    await resolver.resolve('u1');
    expect(redis.entries.has(scopeKey('u1'))).toBe(true);

    await resolver.forget(['u1']);
    expect(redis.entries.has(scopeKey('u1'))).toBe(false);
  });

  it('빈 목록은 아무것도 하지 않는다', async () => {
    const { resolver, redis } = build();
    const del = vi.spyOn(redis, 'del');
    await resolver.forget([]);
    expect(del).not.toHaveBeenCalled();
  });
});

describe('캐시 값 되읽기', () => {
  it('모양이 다르면 캐시가 아니다', () => {
    expect(parseCachedScope('{}')).toBeNull();
    expect(parseCachedScope('[]')).toBeNull();
    expect(parseCachedScope('nope')).toBeNull();
    expect(
      parseCachedScope(JSON.stringify({ repositoryIds: ['10'], orgIds: [], teamIds: [], visibilities: [], refreshedAt: 0, version: 0 })),
    ).toBeNull();
    expect(
      parseCachedScope(JSON.stringify({ repositoryIds: [], orgIds: [], teamIds: [], visibilities: [7], refreshedAt: 0, version: 0 })),
    ).toBeNull();
  });

  it('제대로 된 값은 그대로 돌아온다', () => {
    const scope: CachedScope = {
      repositoryIds: [1, 2],
      orgIds: [3],
      teamIds: [4],
      visibilities: ['internal'],
      refreshedAt: T0,
      version: 2,
    };
    expect(parseCachedScope(JSON.stringify(scope))).toEqual(scope);
  });
});
