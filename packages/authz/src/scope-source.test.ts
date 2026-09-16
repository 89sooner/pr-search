/**
 * GHE 접근 범위 출처 — 필요한 조회만 하고, 실패한 단계를 말한다 (CR-092 / DEV-698).
 *
 * 사내 `0.1.0-pilot.7`은 저장소 셋으로 인증을 켜자 `/me`가 503이 됐다. 필터는 저장소 ID만 보는 크기였는데
 * 출처가 쓰이지 않는 조직·팀 조회까지 불렀고, App에 조직 `Members` 권한이 없어 그 조회 하나가 범위 전체를
 * 실패시켰다. 로그에는 사유가 없어 원인을 추정할 수밖에 없었다.
 */

import { GitHubApiError } from '@prs/github';
import { describe, expect, it } from 'vitest';
import {
  AccessScopeLookupError,
  GheAccessScopeSource,
  SCOPE_STAGE_PERMISSION,
  isReadable,
  type GhePermissionApi,
  type RegisteredRepository,
} from './scope-source.js';
import {
  AccessScopeResolver,
  EXPLICIT_SCOPE_LIMIT,
  ScopeUnavailableError,
  describeScopeFailure,
  toAccessScope,
  type CachedScope,
  type ScopeDatabase,
  type ScopeRedis,
} from './scope.js';

const ORG_ID = 7;
const OWNER = 'acme';

function registered(count: number): RegisteredRepository[] {
  return Array.from({ length: count }, (_, i) => ({
    repositoryId: 1000 + i,
    owner: OWNER,
    name: `smp-${String(i)}`,
    orgId: ORG_ID,
    visibility: 'private' as const,
  }));
}

/** GHE가 `Members` 권한 없는 App에 하는 답 — 전송 계층이 만드는 오류와 같은 모양이다. */
function membersForbidden(path: string): GitHubApiError {
  return new GitHubApiError('auth', `${path} 요청 실패 (403): {"message":"Resource not accessible by integration"}`, {
    status: 403,
  });
}

interface FakeApi extends GhePermissionApi {
  readonly calls: { collaborator: number; orgMember: number; orgTeams: number; teamMembership: number };
}

function api(options: { membersForbidden?: boolean; collaboratorError?: Error } = {}): FakeApi {
  const calls = { collaborator: 0, orgMember: 0, orgTeams: 0, teamMembership: 0 };
  return {
    calls,
    collaboratorPermission: async () => {
      calls.collaborator += 1;
      if (options.collaboratorError !== undefined) throw options.collaboratorError;
      return { permission: 'pull' };
    },
    isOrgMember: async (org) => {
      calls.orgMember += 1;
      if (options.membersForbidden === true) throw membersForbidden(`/orgs/${org}/members/kim`);
      return true;
    },
    listOrgTeams: async (org) => {
      calls.orgTeams += 1;
      if (options.membersForbidden === true) throw membersForbidden(`/orgs/${org}/teams`);
      return [{ id: 51, slug: 'core' }];
    },
    teamMembership: async () => {
      calls.teamMembership += 1;
      return true;
    },
  };
}

const USER = { userId: 'u1', login: 'kim' };

describe('FR-AUTH-002: GHE read 권한 이름 호환', () => {
  it.each(['read', 'write', 'writer', 'pull', 'triage', 'push', 'maintain', 'admin'])('%s는 저장소 read 이상이다', (permission) => {
    expect(isReadable(permission)).toBe(true);
  });

  it.each(['none', '', 'viewer', 'unknown'])('%s는 저장소 접근 권한이 아니다', (permission) => {
    expect(isReadable(permission)).toBe(false);
  });
});

describe('조직·팀은 그 표현을 쓸 때만 읽는다 (CR-092 / DEV-698, FR-AUTH-002 AC-1·AC-6)', () => {
  it('저장소 셋이면 조직 Members 권한이 없어도 범위가 선다 — 사내 pilot.7 형상', async () => {
    const fake = api({ membersForbidden: true });
    const source = new GheAccessScopeSource({ api: fake, listRegistered: async () => registered(3) });

    const scope = await source.fetch(USER);

    expect(scope).toEqual({ repositoryIds: [1000, 1001, 1002], orgIds: [], teamIds: [], visibilities: [] });
    expect(fake.calls).toEqual({ collaborator: 3, orgMember: 0, orgTeams: 0, teamMembership: 0 });
  });

  it('임계와 같은 500개까지는 저장소 목록만으로 표현하고 조직·팀을 부르지 않는다', async () => {
    const fake = api({ membersForbidden: true });
    const source = new GheAccessScopeSource({ api: fake, listRegistered: async () => registered(EXPLICIT_SCOPE_LIMIT) });

    const scope = await source.fetch(USER);

    expect(scope.repositoryIds).toHaveLength(EXPLICIT_SCOPE_LIMIT);
    expect(fake.calls.orgMember + fake.calls.orgTeams + fake.calls.teamMembership).toBe(0);
    // 이 범위를 쓰는 쪽도 저장소 목록 표현을 고른다 — 조직·팀이 비어도 결과 집합은 같다.
    expect(toAccessScope({ ...scope, refreshedAt: 0, version: 0 }).kind).toBe('explicit');
  });

  it('500개를 넘으면 조직·팀을 읽어 org_team 표현을 채운다', async () => {
    const fake = api();
    const source = new GheAccessScopeSource({ api: fake, listRegistered: async () => registered(EXPLICIT_SCOPE_LIMIT + 1) });

    const scope = await source.fetch(USER);

    expect(scope.orgIds).toEqual([ORG_ID]);
    expect(scope.teamIds).toEqual([51]);
    expect(scope.visibilities).toEqual(['public', 'internal']);
    expect(fake.calls).toMatchObject({ orgMember: 1, orgTeams: 1, teamMembership: 1 });
    expect(toAccessScope({ ...scope, refreshedAt: 0, version: 0 }).kind).toBe('org_team');
  });

  it('500개를 넘는 범위에서 조직 조회가 실패하면 부분 범위가 아니라 실패다 (FR-AUTH-002 예외 처리)', async () => {
    const source = new GheAccessScopeSource({
      api: api({ membersForbidden: true }),
      listRegistered: async () => registered(EXPLICIT_SCOPE_LIMIT + 1),
    });

    const failure = await source.fetch(USER).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(AccessScopeLookupError);
    expect(failure).toMatchObject({ stage: 'org_membership', kind: 'auth', status: 403 });
  });
});

describe('실패한 단계를 말한다 (CR-092 / DEV-698)', () => {
  it('협업자 권한 조회의 실패는 그 단계와 상태 코드로 남는다', async () => {
    const source = new GheAccessScopeSource({
      api: api({ collaboratorError: new GitHubApiError('not_found', '/repos/acme/smp-0 요청 실패 (404): body', { status: 404 }) }),
      listRegistered: async () => registered(3),
    });

    await expect(source.fetch(USER)).rejects.toMatchObject({
      stage: 'collaborator_permission',
      kind: 'not_found',
      status: 404,
    });
  });

  it('등록 저장소 목록(PostgreSQL)의 실패는 GHE 분류 없이 그 단계로 남는다', async () => {
    const source = new GheAccessScopeSource({
      api: api(),
      listRegistered: async () => {
        throw new Error('connection terminated');
      },
    });

    await expect(source.fetch(USER)).rejects.toMatchObject({
      stage: 'registered_repositories',
      kind: undefined,
      status: undefined,
    });
  });

  it('단계마다 GitHub App 권한을 가리킨다 — 협업자 권한은 Metadata, 조직·팀은 Members', () => {
    expect(SCOPE_STAGE_PERMISSION.collaborator_permission).toContain('Metadata');
    expect(SCOPE_STAGE_PERMISSION.org_membership).toContain('Members');
    expect(SCOPE_STAGE_PERMISSION.org_teams).toContain('Members');
    expect(SCOPE_STAGE_PERMISSION.team_membership).toContain('Members');
    expect(SCOPE_STAGE_PERMISSION.registered_repositories).toBeNull();
  });
});

class MemoryRedis implements ScopeRedis {
  readonly entries = new Map<string, string>();
  get = async (key: string): Promise<string | null> => this.entries.get(key) ?? null;
  set = async (key: string, value: string): Promise<unknown> => this.entries.set(key, value);
  del = async (...keys: string[]): Promise<number> => keys.filter((key) => this.entries.delete(key)).length;
}

function database(user: { login: string; version: number } | null): ScopeDatabase {
  let cache: CachedScope | null = null;
  return {
    readUser: async () => user,
    readCache: async () => cache,
    writeCache: async (_userId, scope) => {
      cache = scope;
      return true;
    },
  };
}

describe('503의 사유는 응답이 아니라 운영자 로그가 말한다 (CR-092 / DEV-698)', () => {
  it('실패한 단계·분류·상태 코드·필요 권한을 남기고, GHE 응답 본문은 싣지 않는다', async () => {
    const logs: { message: string; detail: Record<string, unknown> }[] = [];
    const resolver = new AccessScopeResolver({
      redis: new MemoryRedis(),
      db: database({ login: 'kim', version: 0 }),
      source: new GheAccessScopeSource({
        api: api({ membersForbidden: true }),
        listRegistered: async () => registered(EXPLICIT_SCOPE_LIMIT + 1),
      }),
      log: (message, detail) => logs.push({ message, detail }),
    });

    await expect(resolver.resolve('u1')).rejects.toBeInstanceOf(ScopeUnavailableError);

    expect(logs).toHaveLength(1);
    expect(logs[0]?.detail).toEqual({
      user_id: 'u1',
      stage: 'org_membership',
      error_kind: 'auth',
      status: 403,
      required_permission: SCOPE_STAGE_PERMISSION.org_membership,
    });
    expect(JSON.stringify(logs), 'GHE 응답 본문이 로그에 실렸다').not.toContain('Resource not accessible');
  });

  it('정본에 사용자 행이 없는 실패도 로그에 단계를 남긴다', async () => {
    const logs: Record<string, unknown>[] = [];
    const resolver = new AccessScopeResolver({
      redis: new MemoryRedis(),
      db: database(null),
      source: new GheAccessScopeSource({ api: api(), listRegistered: async () => registered(1) }),
      log: (_message, detail) => logs.push(detail),
    });

    await expect(resolver.resolve('u1')).rejects.toBeInstanceOf(ScopeUnavailableError);
    expect(logs).toEqual([{ user_id: 'u1', stage: 'app_user' }]);
  });

  it('출처가 단계 없는 오류를 던져도 메시지 없이 오류 이름만 남긴다', () => {
    expect(describeScopeFailure('u1', new Error('SELECT secret'))).toEqual({
      user_id: 'u1',
      stage: 'unknown',
      error_name: 'Error',
    });
  });
});
