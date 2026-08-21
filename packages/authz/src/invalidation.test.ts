/**
 * 권한 캐시 무효화 (WP-012 DoD 8, FR-AUTH-003 AC-2·AC-4).
 */

import { describe, expect, it, vi } from 'vitest';
import {
  applyInvalidation,
  extractInvalidationTarget,
  isEmptyTarget,
  toEventPayload,
  type InvalidationPorts,
} from './invalidation.js';

const ORG = { login: 'acme', id: 1 };

function ports(overrides: Partial<InvalidationPorts> = {}): InvalidationPorts & { invalidated: string[] } {
  const invalidated: string[] = [];
  return {
    invalidated,
    findUserIdsByGithubIds: async () => [],
    findUserIdsByLogins: async () => [],
    findUsersAffectedByRepository: async () => [],
    listTeamMembers: async () => [],
    invalidate: async (ids) => {
      invalidated.push(...ids);
      return [...ids];
    },
    forgetCached: async () => {},
    ...overrides,
  };
}

describe('AC-2: 웹훅에서 대상을 뽑는다', () => {
  it('`member` 이벤트는 사용자 숫자 id와 login을 준다', () => {
    const target = extractInvalidationTarget('member', {
      action: 'removed',
      member: { login: 'kim', id: 501 },
      repository: { id: 4021 },
      organization: ORG,
    });

    expect(target?.reason).toBe('member');
    expect(target?.githubUserIds).toEqual([501]);
    expect(target?.logins).toEqual(['kim']);
    expect(target?.repositoryId).toBe(4021);
  });

  it('`team` 이벤트는 팀 id와 slug를 준다 — 구성원으로 펼치지 않는다', () => {
    const target = extractInvalidationTarget('team', {
      action: 'edited',
      team: { id: 77, slug: 'payments-core' },
      organization: ORG,
    });

    expect(target?.reason).toBe('team');
    expect(target?.teamId).toBe(77);
    expect(target?.teamSlug).toBe('payments-core');
    // 게이트웨이가 GHE를 부르면 수신 p95 300ms가 무너진다 (DEV-041).
    expect(target?.githubUserIds).toEqual([]);
  });

  it('`repository` 이벤트는 저장소 id와 조직 id를 준다', () => {
    const target = extractInvalidationTarget('repository', {
      action: 'privatized',
      repository: { id: 4021 },
      organization: ORG,
    });

    expect(target?.reason).toBe('repository');
    expect(target?.repositoryId).toBe(4021);
    expect(target?.orgId).toBe(1);
  });

  it('다른 유형은 대상이 아니다', () => {
    expect(extractInvalidationTarget('pull_request', { pull_request: { number: 1 } })).toBeNull();
    expect(extractInvalidationTarget('push', {})).toBeNull();
  });

  it('모양이 다르면 빈 대상을 만들지 않고 null이다', () => {
    // 아무도 무효화하지 않는 무효화가 성공으로 기록되면 회수가 새어 나간다.
    expect(extractInvalidationTarget('member', { action: 'added' })).toBeNull();
    expect(extractInvalidationTarget('team', { action: 'created', team: {} })).toBeNull();
    expect(extractInvalidationTarget('repository', { action: 'created' })).toBeNull();
    expect(extractInvalidationTarget('member', 'not an object')).toBeNull();
  });

  it('아무것도 가리키지 않는 대상을 알아본다', () => {
    const target = extractInvalidationTarget('repository', { repository: { id: 1 } });
    expect(target).not.toBeNull();
    expect(isEmptyTarget(target!)).toBe(false);
  });

  it('EVT-AUTH-001 payload로 옮긴다', () => {
    const target = extractInvalidationTarget('member', { member: { login: 'kim', id: 501 }, organization: ORG });
    expect(toEventPayload(target!)).toEqual({
      user_ids: [501],
      logins: ['kim'],
      team_id: null,
      repository_id: null,
      reason: 'member',
    });
  });
});

describe('JOB-AUTH-001: 대상을 펼친다', () => {
  it('숫자 id로 사용자를 찾는다 (DEV-043)', async () => {
    const p = ports({ findUserIdsByGithubIds: async () => ['sub-kim'] });
    const result = await applyInvalidation({ user_ids: [501], reason: 'member' }, p);

    expect(result.invalidatedUserIds).toEqual(['sub-kim']);
    expect(p.invalidated).toEqual(['sub-kim']);
  });

  it('숫자 id가 없으면 login으로 찾는다', async () => {
    const byId = vi.fn().mockResolvedValue([]);
    const byLogin = vi.fn().mockResolvedValue(['sub-kim']);
    const p = ports({ findUserIdsByGithubIds: byId, findUserIdsByLogins: byLogin });

    await applyInvalidation({ logins: ['kim'], reason: 'member' }, p);
    expect(byLogin).toHaveBeenCalledWith(['kim']);
    expect(p.invalidated).toEqual(['sub-kim']);
  });

  it('두 경로가 같은 사용자를 가리켜도 한 번만 무효화한다', async () => {
    const p = ports({
      findUserIdsByGithubIds: async () => ['sub-kim'],
      findUserIdsByLogins: async () => ['sub-kim'],
    });
    await applyInvalidation({ user_ids: [501], logins: ['kim'], reason: 'member' }, p);
    expect(p.invalidated).toEqual(['sub-kim']);
  });

  it('팀은 GHE에서 다시 읽고 그 결과를 우선 쓴다 (DEV-046)', async () => {
    const refresh = vi.fn().mockResolvedValue(['sub-a', 'sub-b']);
    const p = ports({
      // 표는 비어 있다 — 이것을 "무효화할 사람이 없다"로 읽으면 안 된다.
      listTeamMembers: async () => [],
      refreshTeamMembers: refresh,
    });

    const result = await applyInvalidation({ team_id: 77, reason: 'team' }, p, {
      org: 'acme',
      teamSlug: 'payments-core',
    });

    expect(refresh).toHaveBeenCalledWith(77, 'acme', 'payments-core');
    expect(result.teamRefreshed).toBe(true);
    expect([...p.invalidated].sort()).toEqual(['sub-a', 'sub-b']);
  });

  it('팀에서 빠진 사람도 무효화한다 — 갱신 전 구성원을 함께 담는다', async () => {
    const p = ports({
      listTeamMembers: async () => ['sub-left', 'sub-stay'],
      refreshTeamMembers: async () => ['sub-stay', 'sub-new'],
    });

    await applyInvalidation({ team_id: 77, reason: 'team' }, p, { org: 'acme', teamSlug: 'core' });
    // 빠진 사람의 캐시가 남으면 그는 팀 저장소를 5분 더 본다.
    expect([...p.invalidated].sort()).toEqual(['sub-left', 'sub-new', 'sub-stay']);
  });

  it('GHE 조회 경로가 없으면 표만으로 진행한다', async () => {
    const p = ports({ listTeamMembers: async () => ['sub-a'] });
    const result = await applyInvalidation({ team_id: 77, reason: 'team' }, p);

    expect(result.teamRefreshed).toBe(false);
    expect(p.invalidated).toEqual(['sub-a']);
  });

  it('저장소는 명시적 캐시와 org_team 캐시를 함께 찾는다 (DEV-045)', async () => {
    const find = vi.fn().mockResolvedValue(['sub-a', 'sub-b']);
    const p = ports({ findUsersAffectedByRepository: find });

    await applyInvalidation({ repository_id: 4021, reason: 'repository' }, p, { orgId: 1 });
    expect(find).toHaveBeenCalledWith(4021, 1);
    expect([...p.invalidated].sort()).toEqual(['sub-a', 'sub-b']);
  });

  it('세 갈래를 합집합으로 모은다', async () => {
    const p = ports({
      findUserIdsByGithubIds: async () => ['sub-a'],
      listTeamMembers: async () => ['sub-b'],
      findUsersAffectedByRepository: async () => ['sub-c', 'sub-a'],
    });

    await applyInvalidation(
      { user_ids: [501], team_id: 77, repository_id: 4021, reason: 'team' },
      p,
    );
    expect([...p.invalidated].sort()).toEqual(['sub-a', 'sub-b', 'sub-c']);
  });

  it('대상이 없으면 아무것도 무효화하지 않는다', async () => {
    const invalidate = vi.fn();
    const p = ports({ invalidate });
    const result = await applyInvalidation({ user_ids: [], reason: 'member' }, p);

    expect(result.invalidatedUserIds).toEqual([]);
    expect(invalidate).not.toHaveBeenCalled();
  });
});

describe('무효화 순서', () => {
  it('PostgreSQL을 먼저, Redis를 나중에 지운다', async () => {
    const order: string[] = [];
    const p = ports({
      findUserIdsByGithubIds: async () => ['sub-a'],
      invalidate: async (ids) => {
        order.push('postgres');
        return [...ids];
      },
      forgetCached: async () => {
        order.push('redis');
      },
    });

    await applyInvalidation({ user_ids: [1], reason: 'member' }, p);
    // 뒤집으면 그 사이의 요청이 PostgreSQL의 낡은 행으로 Redis를 다시 채운다.
    expect(order).toEqual(['postgres', 'redis']);
  });
});
