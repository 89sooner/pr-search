/**
 * 접근 범위 캐시와 무효화 — 실제 PostgreSQL·Redis (WP-012 DoD 6, DoD 8).
 *
 * 단위 테스트가 가짜 저장소로 확인한 성질을 실제 SQL과 Redis에서 다시 건다.
 * **울타리(DEV-044)는 SQL의 조건절에 있으므로 여기서만 진짜로 검증된다.**
 */

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { Redis } from 'ioredis';
import {
  AccessScopeResolver,
  CACHE_TTL_MS,
  EXPLICIT_SCOPE_LIMIT,
  ScopeUnavailableError,
  createScopeDatabase,
  scopeKey,
  type AccessScopeSource,
  type RawAccessScope,
  type ScopeRedis,
} from '@prs/authz';
import { authRepo, type Pool } from '@prs/db';
import { migratedPool } from '../../db/integration/helpers.js';
import { createTestRedis } from '../../bus/integration/helpers.js';

let pool: Pool;
let redis: Redis;

const USER = 'sub-integration-1';
const LOGIN = 'kim';

function scopeRedis(client: Redis): ScopeRedis {
  return {
    get: (key) => client.get(key),
    set: (key, value, mode, seconds) => client.set(key, value, mode, seconds),
    del: (...keys) => client.del(...keys),
  };
}

function fixedSource(scope: Partial<RawAccessScope> = {}): AccessScopeSource & { calls: number } {
  const impl = {
    calls: 0,
    fetch: async (): Promise<RawAccessScope> => {
      impl.calls += 1;
      return {
        repositoryIds: [101, 102],
        orgIds: [1],
        teamIds: [10],
        visibilities: ['public', 'internal'],
        ...scope,
      };
    },
  };
  return impl;
}

function build(source: AccessScopeSource, now?: () => number): AccessScopeResolver {
  return new AccessScopeResolver({
    redis: scopeRedis(redis),
    db: createScopeDatabase(pool),
    source,
    ...(now === undefined ? {} : { now }),
  });
}

beforeEach(async () => {
  pool ??= await migratedPool();
  redis ??= createTestRedis();

  await pool.query('DELETE FROM permission_cache');
  await pool.query('DELETE FROM team_member');
  // `team`도 비운다. 이 파일이 쓰는 team_id는 다른 통합 파일이 쓰는 것과
  // 겹칠 수 있고, `team`에는 `UNIQUE (org_id, slug)`가 있어 남의 행이 남아
  // 있으면 같은 slug를 다른 team_id로 넣는 순간 삽입이 통째로 실패한다.
  // 통합 파일은 한 데이터베이스를 나눠 쓰므로 각자 자기 전제를 세운다.
  await pool.query('DELETE FROM team');
  await pool.query('DELETE FROM app_user');
  await redis.del(scopeKey(USER));

  await authRepo.upsertUserOnLogin(pool, {
    user_id: USER,
    login: LOGIN,
    github_user_id: 5001,
    email: 'kim@acme.example',
  });
}, 60_000);

afterAll(async () => {
  await redis?.quit();
  await pool?.end();
});

describe('세 계층이 실제 저장소에서 이어진다', () => {
  it('첫 조회가 PostgreSQL과 Redis를 모두 채운다', async () => {
    const source = fixedSource();
    const scope = await build(source).resolve(USER);

    expect(scope).toEqual({ kind: 'explicit', repositoryIds: [101, 102] });
    expect(source.calls).toBe(1);

    const row = await authRepo.findPermissionCache(pool, USER);
    expect(row?.repository_ids).toEqual([101, 102]);
    expect(row?.scope_kind).toBe('explicit');
    expect(await redis.get(scopeKey(USER))).not.toBeNull();
  });

  it('Redis가 비어도 PostgreSQL이 신선하면 GHE를 부르지 않는다', async () => {
    const source = fixedSource();
    const resolver = build(source);
    await resolver.resolve(USER);
    await redis.del(scopeKey(USER));

    await resolver.resolve(USER);
    expect(source.calls).toBe(1);
    expect(await redis.get(scopeKey(USER))).not.toBeNull();
  });

  it('5분이 지나면 GHE를 다시 부른다 (AC-1)', async () => {
    const source = fixedSource();
    let clock = Date.now();
    const resolver = build(source, () => clock);

    await resolver.resolve(USER);
    await redis.del(scopeKey(USER));
    clock += CACHE_TTL_MS + 1000;

    await resolver.resolve(USER);
    expect(source.calls).toBe(2);
  });
});

describe('DoD 8 / DEV-044: 울타리가 SQL에서 성립한다', () => {
  it('갱신 중 무효화가 끼어들면 캐시에 쓰이지 않는다', async () => {
    let started = (): void => {};
    let release = (): void => {};
    const fetchStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const resolver = build({
      fetch: async () => {
        started();
        await gate;
        return { repositoryIds: [101, 102], orgIds: [1], teamIds: [], visibilities: [] };
      },
    });

    const pending = resolver.resolve(USER);
    await fetchStarted;

    // 조회가 도는 사이에 권한이 회수된다.
    await authRepo.invalidateUsers(pool, [USER]);
    release();
    await pending;

    // 회수 이전의 범위가 캐시로 되살아나지 않았다.
    expect(await authRepo.findPermissionCache(pool, USER)).toBeNull();
    expect(await redis.get(scopeKey(USER))).toBeNull();
  });

  it('무효화가 access_scope_version을 올린다', async () => {
    const before = await authRepo.findUserById(pool, USER);
    await authRepo.invalidateUsers(pool, [USER]);
    const after = await authRepo.findUserById(pool, USER);

    expect(after?.access_scope_version).toBe((before?.access_scope_version ?? 0) + 1);
  });

  it('무효화 뒤 첫 조회부터 새 범위를 쓴다 (FR-AUTH-003 AC-4)', async () => {
    let repositoryIds = [101, 102];
    const resolver = build({
      fetch: async () => ({ repositoryIds, orgIds: [1], teamIds: [], visibilities: [] }),
    });

    expect(await resolver.resolve(USER)).toEqual({ kind: 'explicit', repositoryIds: [101, 102] });

    // 저장소 102의 권한이 회수됐다.
    repositoryIds = [101];
    await authRepo.invalidateUsers(pool, [USER]);
    await resolver.forget([USER]);

    expect(await resolver.resolve(USER)).toEqual({ kind: 'explicit', repositoryIds: [101] });
  });
});

describe('DEV-045: 영향 사용자 조회', () => {
  it('명시적 캐시에 담긴 저장소로 사용자를 찾는다', async () => {
    await build(fixedSource()).resolve(USER);

    expect(await authRepo.findUsersAffectedByRepository(pool, 101, null)).toEqual([USER]);
    expect(await authRepo.findUsersAffectedByRepository(pool, 999, null)).toEqual([]);
  });

  it('org_team 모드 사용자는 조직으로 찾는다 — 저장소를 나열하지 않기 때문', async () => {
    const many = Array.from({ length: EXPLICIT_SCOPE_LIMIT + 5 }, (_, i) => 2000 + i);
    await build(fixedSource({ repositoryIds: many })).resolve(USER);

    const row = await authRepo.findPermissionCache(pool, USER);
    expect(row?.scope_kind).toBe('org_team');

    // 저장소 ID로도 찾히지만(목록은 남아 있다), 조직으로도 찾혀야 한다.
    expect(await authRepo.findUsersAffectedByRepository(pool, 9999, 1)).toEqual([USER]);
    expect(await authRepo.findUsersAffectedByRepository(pool, 9999, 2)).toEqual([]);
  });
});

describe('DEV-046: 팀 구성원', () => {
  it('구성원을 통째로 갈아 끼운다', async () => {
    await authRepo.upsertUserOnLogin(pool, { user_id: 'sub-2', login: 'lee', github_user_id: 5002 });
    await authRepo.upsertTeam(pool, { team_id: 77, slug: 'payments-core', org_id: 1 });

    expect((await authRepo.replaceTeamMembers(pool, 77, [USER, 'sub-2'])).sort()).toEqual(
      [USER, 'sub-2'].sort(),
    );
    // 한 명이 팀에서 빠졌다.
    expect(await authRepo.replaceTeamMembers(pool, 77, [USER])).toEqual([USER]);
  });

  it('로그인한 적 없는 사용자는 담지 않는다 — 무효화할 캐시가 없다', async () => {
    await authRepo.upsertTeam(pool, { team_id: 78, slug: 'other', org_id: 1 });
    expect(await authRepo.replaceTeamMembers(pool, 78, [USER, 'never-logged-in'])).toEqual([USER]);
  });

  it('갱신 시각을 남긴다', async () => {
    await authRepo.upsertTeam(pool, { team_id: 79, slug: 'third', org_id: 1 });
    await authRepo.replaceTeamMembers(pool, 79, [USER]);
    expect((await authRepo.findTeam(pool, 79))?.members_refreshed_at).not.toBeNull();
  });
});

describe('DEV-043: 신원 매핑', () => {
  it('GHE 숫자 id로 사용자를 찾는다', async () => {
    expect(await authRepo.findUserIdsByGithubIds(pool, [5001])).toEqual([USER]);
    expect(await authRepo.findUserIdsByGithubIds(pool, [9999])).toEqual([]);
  });

  it('login으로도 찾는다 — 숫자 id가 없는 이벤트의 폴백', async () => {
    expect(await authRepo.findUserIdsByLogins(pool, [LOGIN])).toEqual([USER]);
  });

  it('login이 바뀌어도 숫자 id는 같은 사용자를 가리킨다', async () => {
    await authRepo.upsertUserOnLogin(pool, { user_id: USER, login: 'kim-renamed', github_user_id: 5001 });

    expect(await authRepo.findUserIdsByGithubIds(pool, [5001])).toEqual([USER]);
    // 옛 login으로는 더 이상 찾히지 않는다 — 그래서 숫자 id를 우선 쓴다.
    expect(await authRepo.findUserIdsByLogins(pool, [LOGIN])).toEqual([]);
  });

  it('로그인이 관리자 지정 역할을 지우지 않는다 (DEV-049)', async () => {
    await authRepo.setAssignedRoles(pool, USER, ['developer', 'operator']);
    await authRepo.upsertUserOnLogin(pool, { user_id: USER, login: LOGIN, github_user_id: 5001 });

    expect((await authRepo.findUserById(pool, USER))?.roles).toEqual(['developer', 'operator']);
  });

  it('로그인이 access_scope_version을 건드리지 않는다', async () => {
    await authRepo.invalidateUsers(pool, [USER]);
    const before = (await authRepo.findUserById(pool, USER))?.access_scope_version;
    await authRepo.upsertUserOnLogin(pool, { user_id: USER, login: LOGIN });

    expect((await authRepo.findUserById(pool, USER))?.access_scope_version).toBe(before);
  });
});

describe('AC-3: 기본 거부', () => {
  it('GHE 조회 실패는 낡은 캐시로 대신하지 않는다', async () => {
    // 캐시를 채운 뒤 `refreshed_at`을 직접 되돌린다. `writeCache`는 SQL에서
    // `now()`를 찍으므로 낡은 행을 만들려면 이 방법뿐이다.
    await build(fixedSource()).resolve(USER);
    await pool.query(
      "UPDATE permission_cache SET refreshed_at = now() - interval '10 minutes' WHERE user_id = $1",
      [USER],
    );
    await redis.del(scopeKey(USER));

    const resolver = build({ fetch: () => Promise.reject(new Error('GHE 502')) });
    await expect(resolver.resolve(USER)).rejects.toThrow(ScopeUnavailableError);
  });

  it('낡은 캐시는 살아 있어도 쓰이지 않는다 — 행이 남아 있음을 확인한다', async () => {
    await build(fixedSource()).resolve(USER);
    await pool.query(
      "UPDATE permission_cache SET refreshed_at = now() - interval '10 minutes' WHERE user_id = $1",
      [USER],
    );
    await redis.del(scopeKey(USER));

    // 낡은 행은 그대로 있다. 그럼에도 조회는 GHE로 간다.
    expect(await authRepo.findPermissionCache(pool, USER)).not.toBeNull();
    const source = fixedSource({ repositoryIds: [999] });
    expect(await build(source).resolve(USER)).toEqual({ kind: 'explicit', repositoryIds: [999] });
    expect(source.calls).toBe(1);
  });

  it('등록되지 않은 사용자는 빈 범위가 아니라 오류다', async () => {
    await expect(build(fixedSource()).resolve('sub-unknown')).rejects.toThrow(/등록되어 있지 않다/);
  });
});
