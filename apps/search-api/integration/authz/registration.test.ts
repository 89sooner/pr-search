/**
 * 로그인 사용자 정본 등록 — 실제 PostgreSQL·Redis (CR-083 / DEV-613).
 *
 * ## 왜 단위 시험만으로는 부족한가
 *
 * 단위 시험(`src/auth/registration.test.ts`)은 `Pool`을 대역으로 넣어 **`query`가
 * 불렸는지와 어떤 인자로 불렸는지**를 본다. 그것은 SQL이 실제로 도는지 말하지
 * 않는다 — 열 이름이 틀려도, `ON CONFLICT` 대상이 틀려도 대역은 통과시킨다.
 *
 * 이 파일이 거는 것은 **행이 실제로 생기는가**와 **재로그인이 정본을 망가뜨리지
 * 않는가**다. 뒤의 것이 특히 중요하다: `upsertUserOnLogin`은 `roles`를 건드리지
 * 않기로 되어 있고(CR-015, DEV-049), 그 약속이 깨지면 **로그인 한 번이 관리자가
 * 지정한 `operator`를 지운다.** 그 사고는 SQL로만 재현된다.
 *
 * ## 통합 계층에 이 파일이 필요한 두 번째 이유
 *
 * 이 저장소의 다른 통합 시험은 대부분 `new SessionStore(...)`를 직접 넣어
 * 컨텍스트를 손으로 만든다. 즉 `createAuthContext`가 조립하는 실제 경로가
 * 통합 계층에서 거의 걸리지 않는다. **그 사각지대를 이 파일이 덮는다.**
 */

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { Redis } from '@prs/bus';
import { createSessionId, type SessionRecord } from '@prs/authz';
import { authRepo, type Pool } from '@prs/db';

import { RegisteringSessionStore } from '../../src/auth/registration.js';
import { createTestRedis, migratedPool } from '../helpers.js';

let pool: Pool;
let redis: Redis;

const GHE_USER = '904021';
const OIDC_USER = 'oidc-sub-904021';

const baseSession = (overrides: Partial<SessionRecord> = {}): Omit<SessionRecord, 'sessionId'> => ({
  userId: GHE_USER,
  login: 'reg-kim',
  email: 'reg-kim@example.com',
  roles: ['developer'],
  issuedAt: Date.now(),
  lastSeenAt: Date.now(),
  correlationId: null,
  githubUserId: 904021,
  ...overrides,
});

function store(): RegisteringSessionStore {
  return new RegisteringSessionStore({
    redis: {
      get: (key) => redis.get(key),
      set: (key, value, mode, seconds) => redis.set(key, value, mode, seconds),
      del: (...keys) => redis.del(...keys),
      scan: (cursor, m, pattern, c, n) => redis.scan(cursor, m, pattern, c, n),
    },
    pool,
  });
}

/** 세션을 넣고 그 id를 돌려준다. */
async function seed(target: RegisteringSessionStore, overrides: Partial<SessionRecord> = {}): Promise<string> {
  const sessionId = createSessionId();
  await target.create({ ...baseSession(overrides), sessionId });
  return sessionId;
}

beforeEach(async () => {
  pool ??= await migratedPool();
  redis ??= createTestRedis();
  await pool.query('DELETE FROM app_user WHERE user_id = ANY($1)', [[GHE_USER, OIDC_USER]]);
});

afterAll(async () => {
  await pool?.query('DELETE FROM app_user WHERE user_id = ANY($1)', [[GHE_USER, OIDC_USER]]);
  await pool?.end();
  redis?.disconnect();
});

describe('DEV-613: 세션을 읽으면 정본에 행이 실제로 생긴다', () => {
  it('없던 사용자가 첫 조회에 등록된다', async () => {
    const target = store();
    const sessionId = await seed(target);

    expect(await authRepo.findUserById(pool, GHE_USER), '등록 전인데 행이 있다').toBeNull();

    await target.load(sessionId);

    const row = await authRepo.findUserById(pool, GHE_USER);
    expect(row, '세션을 읽었는데 정본에 행이 없다 — 첫 조회가 503이 된다').not.toBeNull();
    expect(row?.login).toBe('reg-kim');
    expect(row?.github_user_id).toBe(904021);
    // 기본 역할은 스키마가 준다. 로그인이 정하지 않는다.
    expect(row?.roles).toEqual(['developer']);
  });

  /**
   * **접근 범위 산출이 요구하는 것이 실제로 갖춰지는가.**
   *
   * `AccessScopeResolver`가 읽는 것은 `login`과 `access_scope_version` 둘이다.
   * 등록이 그 둘을 세워야 조회가 성립한다.
   */
  it('접근 범위 산출이 읽는 필드가 갖춰진다', async () => {
    const target = store();
    await target.load(await seed(target));

    const row = await authRepo.findUserById(pool, GHE_USER);
    expect(row?.login).not.toBe('');
    expect(row?.access_scope_version).toBe(0);
  });

  /**
   * **로그인 한 번이 관리자 지정을 지우지 않는다** (CR-015, DEV-049).
   *
   * `operator`·`release_manager`·`security_officer`는 이 표에만 있고 공급자는
   * 그것을 모른다. 재로그인이 `roles`를 덮으면 운영 권한이 조용히 사라진다.
   */
  it('재로그인이 관리자 지정 역할을 지우지 않는다', async () => {
    const target = store();
    await target.load(await seed(target));
    await authRepo.setAssignedRoles(pool, GHE_USER, ['developer', 'operator']);

    // 새 프로세스가 선 것처럼 등록 캐시가 빈 저장소로 다시 읽는다.
    const fresh = store();
    await fresh.load(await seed(fresh, { login: 'reg-kim-renamed' }));

    const row = await authRepo.findUserById(pool, GHE_USER);
    expect(row?.roles, '로그인이 관리자 지정을 덮었다').toEqual(['developer', 'operator']);
    // 이름은 공급자가 정본이므로 갱신된다.
    expect(row?.login).toBe('reg-kim-renamed');
  });

  /**
   * **OIDC 세션에는 GHE 숫자 id가 없다.** 그 자리에 지어낸 값을 넣으면 UNIQUE
   * 제약이 남의 행과 부딪친다.
   */
  it('githubUserId가 없는 세션은 그 칸을 비운 채 등록한다', async () => {
    const target = store();
    await target.load(await seed(target, { userId: OIDC_USER, login: 'reg-oidc', githubUserId: undefined }));

    const row = await authRepo.findUserById(pool, OIDC_USER);
    expect(row).not.toBeNull();
    expect(row?.github_user_id).toBeNull();
  });

  /**
   * **이미 있는 사용자의 재로그인이 다른 행을 건드리지 않는다.**
   *
   * `ON CONFLICT` 대상이 틀리면 여기서 드러난다 — 대역은 그것을 볼 수 없다.
   */
  it('이미 있는 행을 갱신하되 새 행을 만들지 않는다', async () => {
    await authRepo.upsertUserOnLogin(pool, { user_id: GHE_USER, login: 'old-name', github_user_id: 904021 });

    const target = store();
    await target.load(await seed(target));

    const { rows } = await pool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM app_user WHERE user_id = $1',
      [GHE_USER],
    );
    expect(rows[0]?.count, '같은 사용자로 행이 둘 생겼다').toBe('1');
    expect((await authRepo.findUserById(pool, GHE_USER))?.login).toBe('reg-kim');
  });

  /**
   * **등록 실패가 인증 실패로 둔갑하지 않는다** — 실제 제약 위반으로 확인한다.
   *
   * `app_user.login`은 UNIQUE다. GHE에서 개명한 계정의 이름이 이미 다른
   * `user_id`에 붙어 있으면 등록이 실패하는데, 그때도 세션은 살아 있어야 한다.
   */
  it('login UNIQUE 충돌이 나도 세션을 돌려준다', async () => {
    await authRepo.upsertUserOnLogin(pool, { user_id: OIDC_USER, login: 'reg-kim' });

    const seen: string[] = [];
    const target = new RegisteringSessionStore({
      redis: {
        get: (key) => redis.get(key),
        set: (key, value, mode, seconds) => redis.set(key, value, mode, seconds),
        del: (...keys) => redis.del(...keys),
        scan: (cursor, m, pattern, c, n) => redis.scan(cursor, m, pattern, c, n),
      },
      pool,
      log: (message) => seen.push(message),
    });
    const sessionId = await seed(target);

    const loaded = await target.load(sessionId);

    expect(loaded, '등록 실패가 세션을 무효로 만들었다').not.toBeNull();
    expect(loaded?.session.userId).toBe(GHE_USER);
    expect(seen[0]).toContain('DEV-613');
    // 실패했으므로 행은 생기지 않는다. 그 사실은 조회의 503이 말한다.
    expect(await authRepo.findUserById(pool, GHE_USER)).toBeNull();
  });
});
