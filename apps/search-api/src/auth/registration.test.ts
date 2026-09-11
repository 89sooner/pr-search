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
    expect(queries).toHaveLength(1);
    expect(queries[0]?.text).toContain('INSERT INTO app_user');
    // 신원·로그인·GHE 숫자 id·이메일이 그대로 간다.
    expect(queries[0]?.values).toEqual(['4021', 'kim', 4021, 'kim@example.com']);
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

    expect(queries[0]?.values[2]).toBeNull();
  });

  it('같은 사용자를 여러 번 읽어도 정본을 한 번만 친다', async () => {
    const { pool, queries } = fakePool();
    const store = new RegisteringSessionStore({ redis: fakeRedis(), pool });
    const sessionId = await seed(store);

    await store.load(sessionId);
    await store.load(sessionId);
    await store.load(sessionId);

    expect(queries).toHaveLength(1);
  });

  it('사용자가 다르면 각각 등록한다', async () => {
    const { pool, queries } = fakePool();
    const store = new RegisteringSessionStore({ redis: fakeRedis(), pool });
    const first = await seed(store, { userId: 'a', login: 'a' });
    const second = await seed(store, { userId: 'b', login: 'b' });

    await store.load(first);
    await store.load(second);

    expect(queries.map((q) => q.values[0])).toEqual(['a', 'b']);
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

    expect(seen).toHaveLength(1);
    expect(seen[0]?.message).toContain('DEV-613');
    expect(seen[0]?.detail['user_id']).toBe('4021');
    // 이메일은 신원 확인에 필요하지 않다 (NFR-005).
    expect(JSON.stringify(seen[0]?.detail)).not.toContain('kim@example.com');
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
    expect(queries).toHaveLength(1);

    fail = false;
    await store.load(sessionId);
    expect(queries).toHaveLength(2);

    // 성공한 뒤에는 캐시가 선다.
    await store.load(sessionId);
    expect(queries).toHaveLength(2);
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
