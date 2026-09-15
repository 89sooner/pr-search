/**
 * 로그인 사용자 정본 등록 (CR-083 / DEV-613).
 *
 * ## 이 시험이 지키는 명제
 *
 * `AccessScopeResolver`는 `app_user` 행이 없으면 던지고, 그 주석은 「로그인이
 * 만들었어야 한다」고 적는다. **그 만드는 코드가 없었다** — 그래서 로그인은
 * 성공하는데 첫 조회가 `503 permission_unavailable`이 됐다.
 *
 * 여기서 거는 것은 셋이다.
 *
 *   1. 세션을 읽으면 정본에 행이 생긴다 — 읽는 **모든** 경로에서
 *   2. 등록 실패가 인증 실패로 둔갑하지 않는다
 *   3. 실패한 등록이 캐시되지 않는다 — 다음 요청이 다시 시도한다
 *
 * 2번이 중요하다. 던지면 `503 permission_unavailable`(정본이 비었다)이
 * `401 UNAUTHENTICATED`(세션이 없다)로 바뀌어 운영자가 엉뚱한 곳을 본다.
 */

import { describe, expect, it } from 'vitest';

import {
  createSessionId,
  serializeSessionCookie,
  type SessionRecord,
  type SessionRedis,
} from '@prs/authz';
import type { Pool } from '@prs/db';

import { RegisteringSessionStore } from './registration.js';

/** Redis 대역. 세션 저장소가 쓰는 넷만 흉내 낸다. */
function fakeRedis(): SessionRedis & { readonly store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    get: async (key) => store.get(key) ?? null,
    set: async (key, value) => {
      store.set(key, value);
      return 'OK';
    },
    del: async (...keys) => {
      let removed = 0;
      for (const key of keys) if (store.delete(key)) removed += 1;
      return removed;
    },
    scan: async () => ['0', []],
  };
}

interface RecordedQuery {
  readonly text: string;
  readonly values: readonly unknown[];
}

/** 정본 **등록** 질의만 추린다. 역할 조회(DEV-695)는 요청마다 돌므로 등록 횟수와 섞지 않는다. */
const inserts = (queries: readonly RecordedQuery[]): RecordedQuery[] =>
  queries.filter((query) => query.text.includes('INSERT INTO app_user'));

/** `Pool` 대역. `upsertUserOnLogin`이 부르는 `query` 하나만 받는다. */
function fakePool(options: { failWith?: Error } = {}): {
  readonly pool: Pool;
  readonly queries: RecordedQuery[];
} {
  const queries: RecordedQuery[] = [];
  const pool = {
    query: async (text: string, values: readonly unknown[]) => {
      queries.push({ text, values });
      if (options.failWith !== undefined) throw options.failWith;
      return { rows: [{ user_id: values[0], login: values[1] }] };
    },
  } as unknown as Pool;
  return { pool, queries };
}

const SESSION: SessionRecord = {
  sessionId: 'unused',
  userId: '4021',
  login: 'kim',
  email: 'kim@example.com',
  roles: ['developer'],
  issuedAt: Date.now(),
  lastSeenAt: Date.now(),
  correlationId: null,
  githubUserId: 4021,
};

/** 세션을 실제로 넣고 그 id를 돌려준다. */
async function seed(
  store: RegisteringSessionStore,
  overrides: Partial<SessionRecord> = {},
): Promise<string> {
  const sessionId = createSessionId();
  await store.create({ ...SESSION, ...overrides, sessionId });
  return sessionId;
}

describe('DEV-613: 세션을 읽으면 정본에 사용자 행이 있게 한다', () => {
  it('세션을 읽을 때 app_user를 upsert한다', async () => {
    const { pool, queries } = fakePool();
    const store = new RegisteringSessionStore({ redis: fakeRedis(), pool });
    const sessionId = await seed(store);

    const loaded = await store.load(sessionId);

    expect(loaded).not.toBeNull();
    expect(inserts(queries)).toHaveLength(1);
    // 등록 요청은 upsert의 반환 행으로 역할을 읽는다 — 질의가 하나 더 붙지 않는다.
    expect(queries).toHaveLength(1);
    // 신원·로그인·GHE 숫자 id·이메일이 그대로 간다.
    expect(inserts(queries)[0]?.values).toEqual(['4021', 'kim', 4021, 'kim@example.com']);
  });

  /**
   * **OIDC 세션에는 GHE 숫자 id가 없다.** 그 자리에 지어낸 값을 넣지 않는다 —
   * `github_user_id`는 UNIQUE라 지어낸 값이 남의 행과 부딪친다.
   */
  it('githubUserId가 없는 세션은 null로 등록한다', async () => {
    const { pool, queries } = fakePool();
    const store = new RegisteringSessionStore({ redis: fakeRedis(), pool });
    const sessionId = await seed(store, { githubUserId: undefined, userId: 'oidc-sub-1' });

    await store.load(sessionId);

    expect(inserts(queries)[0]?.values[2]).toBeNull();
  });

  it('같은 사용자를 여러 번 읽어도 정본을 한 번만 친다', async () => {
    const { pool, queries } = fakePool();
    const store = new RegisteringSessionStore({ redis: fakeRedis(), pool });
    const sessionId = await seed(store);

    await store.load(sessionId);
    await store.load(sessionId);
    await store.load(sessionId);

    expect(inserts(queries)).toHaveLength(1);
  });

  /**
   * **개명이 정본에 반영된다** (독립 검토가 찾은 것).
   *
   * `upsertUserOnLogin`은 매 로그인 `login`을 갱신하도록 짜여 있다. 캐시를
   * `userId`만으로 걸면 그 설계가 무력화되어, 개명한 사용자의 새 이름이 프로세스가
   * 다시 설 때까지 정본에 들어가지 않는다. 그 상태에서는 `login`으로 영향 사용자를
   * 찾는 무효화 경로(`findUserIdsByLogins`)가 개명자를 놓친다.
   */
  it('같은 사용자라도 login이 바뀌면 다시 등록한다', async () => {
    const { pool, queries } = fakePool();
    const store = new RegisteringSessionStore({ redis: fakeRedis(), pool });

    await store.load(await seed(store, { login: 'kim' }));
    await store.load(await seed(store, { login: 'kim-renamed' }));

    expect(inserts(queries)).toHaveLength(2);
    expect(inserts(queries)[1]?.values[1]).toBe('kim-renamed');
  });

  it('이메일이 바뀌어도 다시 등록한다', async () => {
    const { pool, queries } = fakePool();
    const store = new RegisteringSessionStore({ redis: fakeRedis(), pool });

    await store.load(await seed(store, { email: 'old@example.com' }));
    await store.load(await seed(store, { email: 'new@example.com' }));

    expect(inserts(queries)).toHaveLength(2);
    expect(inserts(queries)[1]?.values[3]).toBe('new@example.com');
  });

  it('내용이 그대로면 세션이 달라도 한 번만 친다', async () => {
    const { pool, queries } = fakePool();
    const store = new RegisteringSessionStore({ redis: fakeRedis(), pool });

    await store.load(await seed(store));
    await store.load(await seed(store));

    expect(inserts(queries)).toHaveLength(1);
  });

  it('사용자가 다르면 각각 등록한다', async () => {
    const { pool, queries } = fakePool();
    const store = new RegisteringSessionStore({ redis: fakeRedis(), pool });
    const first = await seed(store, { userId: 'a', login: 'a' });
    const second = await seed(store, { userId: 'b', login: 'b' });

    await store.load(first);
    await store.load(second);

    expect(inserts(queries).map((q) => q.values[0])).toEqual(['a', 'b']);
  });

  it('세션이 없으면 정본을 건드리지 않는다', async () => {
    const { pool, queries } = fakePool();
    const store = new RegisteringSessionStore({ redis: fakeRedis(), pool });

    expect(await store.load(createSessionId())).toBeNull();
    expect(queries).toHaveLength(0);
  });

  /**
   * **등록 실패가 인증 실패로 둔갑하지 않는다.**
   *
   * 세션 자체는 유효하다. 정본이 비었다는 사실은 접근 범위 해석이 이미
   * `503 permission_unavailable`로 정확하게 말한다.
   */
  it('등록이 실패해도 세션을 돌려준다', async () => {
    const { pool } = fakePool({ failWith: new Error('duplicate key value violates unique constraint') });
    const store = new RegisteringSessionStore({ redis: fakeRedis(), pool });
    const sessionId = await seed(store);

    const loaded = await store.load(sessionId);

    expect(loaded).not.toBeNull();
    expect(loaded?.session.userId).toBe('4021');
  });

  it('등록 실패를 로그로 남기되 값은 싣지 않는다', async () => {
    const { pool } = fakePool({ failWith: new Error('duplicate key') });
    const seen: { message: string; detail: Record<string, unknown> }[] = [];
    const store = new RegisteringSessionStore({
      redis: fakeRedis(),
      pool,
      log: (message, detail) => seen.push({ message, detail }),
    });
    const sessionId = await seed(store);

    await store.load(sessionId);

    // 이 대역은 모든 질의에 실패하므로 역할 조회 실패(DEV-695)도 한 줄 남는다. 등록 로그는 하나다.
    const registration = seen.filter((entry) => entry.message.includes('DEV-613'));
    expect(registration).toHaveLength(1);
    expect(registration[0]?.detail['user_id']).toBe('4021');
    // 이메일은 신원 확인에 필요하지 않다 (NFR-005). 어느 로그에도 싣지 않는다.
    expect(JSON.stringify(seen.map((entry) => entry.detail))).not.toContain('kim@example.com');
  });

  /**
   * **실패한 등록을 캐시하지 않는다.**
   *
   * 캐시하면 그 사용자는 프로세스가 다시 설 때까지 영영 정본에 들어가지 못하고,
   * 조회가 계속 503이 된다. 일시적 DB 오류가 영구 장애로 굳는다.
   */
  it('실패한 사용자는 다음 요청에서 다시 시도한다', async () => {
    const queries: RecordedQuery[] = [];
    let fail = true;
    const pool = {
      query: async (text: string, values: readonly unknown[]) => {
        queries.push({ text, values });
        if (fail) throw new Error('일시적 오류');
        return { rows: [{ user_id: values[0] }] };
      },
    } as unknown as Pool;

    const store = new RegisteringSessionStore({ redis: fakeRedis(), pool });
    const sessionId = await seed(store);

    await store.load(sessionId);
    expect(inserts(queries)).toHaveLength(1);

    fail = false;
    await store.load(sessionId);
    expect(inserts(queries)).toHaveLength(2);

    // 성공한 뒤에는 캐시가 선다 — 역할 조회는 요청마다 돌지만 등록은 다시 하지 않는다.
    await store.load(sessionId);
    expect(inserts(queries)).toHaveLength(2);
  });

  /**
   * 상속이 실제로 성립하는가 — 기반 저장소의 계약이 그대로 남아 있어야 한다.
   *
   * **대역이 실제보다 관대하면 그만큼이 사각지대다.** 감싼 쪽이 `load`만 덮고
   * 나머지를 그대로 물려받는지, 쿠키 계약이 그대로인지 여기서 함께 본다.
   */
  it('기반 저장소의 파기 계약을 그대로 물려받는다', async () => {
    const { pool } = fakePool();
    const store = new RegisteringSessionStore({ redis: fakeRedis(), pool });
    const sessionId = await seed(store);

    await store.destroy(sessionId);

    expect(await store.load(sessionId)).toBeNull();
    // 세션 쿠키 계약은 감싸도 그대로다 (FR-AUTH-001 AC-2).
    expect(serializeSessionCookie(sessionId, { secure: true })).toContain('HttpOnly');
  });
});

/**
 * 실효 역할 = 세션 역할 ∪ 관리자 지정값 (`CR-091` / `DEV-695`).
 *
 * 보안 문서 5.1과 API-AUTH-001은 이 합집합을 적었지만 **코드에 없었다** — 로그인 콜백은
 * DB에 닿지 않아 지정값 없이 세션을 만들었고, 세션을 읽는 자리는 세션의 역할만 봤다.
 * 그래서 사내 `0.1.0-pilot.6`에서 GHE 로그인으로 바꾼 뒤 누구도 `operator`가 될 수 없었다.
 */
describe('DEV-695: 세션을 읽을 때 관리자 지정 역할을 더한다', () => {
  /** 등록 upsert와 역할 조회에 각각 답하는 `Pool` 대역. */
  function rolesPool(answer: {
    readonly upsert?: () => readonly string[];
    readonly select?: () => readonly string[] | null;
  }): { readonly pool: Pool; readonly queries: RecordedQuery[] } {
    const queries: RecordedQuery[] = [];
    const pool = {
      query: async (text: string, values: readonly unknown[]) => {
        queries.push({ text, values });
        if (text.includes('INSERT INTO app_user')) {
          return { rows: [{ user_id: values[0], login: values[1], roles: answer.upsert?.() ?? ['developer'] }] };
        }
        const roles = answer.select?.() ?? null;
        return { rows: roles === null ? [] : [{ roles }] };
      },
    } as unknown as Pool;
    return { pool, queries };
  }

  it('등록하는 요청은 upsert가 돌려준 지정값을 더한다', async () => {
    const { pool } = rolesPool({ upsert: () => ['developer', 'operator'] });
    const store = new RegisteringSessionStore({ redis: fakeRedis(), pool });

    const loaded = await store.load(await seed(store, { roles: ['developer', 'manager'] }));

    expect(loaded?.session.roles).toEqual(['developer', 'manager', 'operator']);
  });

  it('등록된 뒤에는 요청마다 다시 읽는다 — 지정도 회수도 다음 요청에 반영된다', async () => {
    let assigned: readonly string[] = ['developer'];
    const { pool, queries } = rolesPool({ upsert: () => assigned, select: () => assigned });
    const store = new RegisteringSessionStore({ redis: fakeRedis(), pool });
    const sessionId = await seed(store);

    expect((await store.load(sessionId))?.session.roles).toEqual(['developer']);

    assigned = ['developer', 'operator'];
    expect((await store.load(sessionId))?.session.roles).toEqual(['developer', 'operator']);

    assigned = ['developer'];
    expect((await store.load(sessionId))?.session.roles).toEqual(['developer']);

    // 등록은 한 번, 역할 조회는 등록 뒤의 두 요청.
    expect(inserts(queries)).toHaveLength(1);
    expect(queries.filter((query) => query.text.includes('SELECT roles'))).toHaveLength(2);
  });

  /**
   * **Redis에 되써 넣지 않는다.** 세션 레코드는 유휴 시각을 갱신할 때 통째로 다시 쓰이므로
   * 되써 넣으면 `web`의 쓰기와 서로 덮고, 회수가 세션 수명 동안 늦어진다.
   */
  it('실효 역할을 세션 레코드에 저장하지 않는다', async () => {
    const redis = fakeRedis();
    const { pool } = rolesPool({ upsert: () => ['developer', 'operator'] });
    const store = new RegisteringSessionStore({ redis, pool });
    const sessionId = await seed(store);

    await store.load(sessionId);

    const stored = [...redis.store.values()].map((raw) => JSON.parse(raw) as { roles: string[] });
    expect(stored).toHaveLength(1);
    expect(stored[0]?.roles).toEqual(['developer']);
  });

  it('지정값을 읽지 못하면 세션 역할만 쓰고 그 사실을 남긴다 — 과잉 허용이 아니라 거절 쪽이다', async () => {
    let failSelect = false;
    const queries: RecordedQuery[] = [];
    const pool = {
      query: async (text: string, values: readonly unknown[]) => {
        queries.push({ text, values });
        if (text.includes('INSERT INTO app_user')) return { rows: [{ user_id: values[0], roles: ['developer', 'operator'] }] };
        if (failSelect) throw new Error('connection terminated');
        return { rows: [{ roles: ['developer', 'operator'] }] };
      },
    } as unknown as Pool;
    const seen: { message: string; detail: Record<string, unknown> }[] = [];
    const store = new RegisteringSessionStore({ redis: fakeRedis(), pool, log: (message, detail) => seen.push({ message, detail }) });
    const sessionId = await seed(store, { roles: ['developer', 'qa'] });

    expect((await store.load(sessionId))?.session.roles).toContain('operator');

    failSelect = true;
    const loaded = await store.load(sessionId);

    expect(loaded).not.toBeNull();
    expect(loaded?.session.roles).toEqual(['developer', 'qa']);
    expect(seen.map((entry) => entry.message)).toEqual([expect.stringContaining('DEV-695')]);
    expect(seen[0]?.detail['user_id']).toBe('4021');
  });

  it('등록이 실패해도 지정값은 user_id로 읽는다 — 개명 충돌이 운영 권한을 지우지 않는다', async () => {
    const pool = {
      query: async (text: string) => {
        if (text.includes('INSERT INTO app_user')) throw new Error('duplicate key value violates unique constraint');
        return { rows: [{ roles: ['developer', 'operator'] }] };
      },
    } as unknown as Pool;
    const store = new RegisteringSessionStore({ redis: fakeRedis(), pool });

    const loaded = await store.load(await seed(store));

    expect(loaded?.session.roles).toEqual(['developer', 'operator']);
  });

  it('정본에 행이 없으면 세션 역할 그대로다', async () => {
    const pool = {
      query: async (text: string) => {
        if (text.includes('INSERT INTO app_user')) throw new Error('duplicate key');
        return { rows: [] };
      },
    } as unknown as Pool;
    const store = new RegisteringSessionStore({ redis: fakeRedis(), pool });

    expect((await store.load(await seed(store, { roles: ['developer', 'manager'] })))?.session.roles).toEqual([
      'developer',
      'manager',
    ]);
  });

  it('DB에 적힌 역할이 아닌 값은 권한이 되지 않는다', async () => {
    const { pool } = rolesPool({ upsert: () => ['developer', 'admin', 'OPERATOR'] });
    const store = new RegisteringSessionStore({ redis: fakeRedis(), pool });

    expect((await store.load(await seed(store)))?.session.roles).toEqual(['developer']);
  });
});
