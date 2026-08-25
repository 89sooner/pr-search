/**
 * 팀 접근 범위 동기화 (WP-068 / CR-036, DEV-188·189).
 *
 * ## 이 파일이 막는 것
 *
 * 첫 구현은 팀 웹훅에서 **PostgreSQL에 이미 있는 값**을 색인에 다시 썼다. 회수
 * 사건에서 그 값은 아직 제거된 팀을 담고 있으므로 **회수가 반영되지 않고 옛
 * 구성원이 문서를 계속 본다** — 유출이다. 그리고 색인이 실패하면 정본만 바뀐 채
 * 남아 다음 동기화가 "바뀐 것 없음"으로 건너뛰었다.
 */

import { describe, expect, it } from 'vitest';
import { refreshTeamScope, syncRepositoryTeamScope, type TeamScopeDeps } from './team-scope.js';

const REPO = { repository_id: 1, owner: 'acme', name: 'payments', org_id: 9 };

interface Harness {
  readonly deps: TeamScopeDeps;
  readonly indexed: { repositoryId: number; teamIds: readonly number[] }[];
  readonly stored: { current: number[] };
}

function harness(options: {
  /** GHE가 지금 답하는 팀. */
  readonly ghe: readonly { id: number; slug: string }[];
  /** 정본에 이미 있는 값. */
  readonly existing?: number[];
  readonly indexFails?: boolean;
}): Harness {
  const indexed: { repositoryId: number; teamIds: readonly number[] }[] = [];
  const stored = { current: [...(options.existing ?? [])] };

  const pool = {
    query: (text: string, values?: readonly unknown[]) => {
      const sql = String(text);
      if (/UPDATE repository/i.test(sql)) {
        const next = (values?.[1] as number[]) ?? [];
        const changed = JSON.stringify(next) !== JSON.stringify(stored.current);
        if (changed) stored.current = [...next];
        return Promise.resolve({ rowCount: changed ? 1 : 0 });
      }
      if (/allowed_team_ids @>/i.test(sql)) {
        const teamId = Number(values?.[0]);
        return Promise.resolve({
          rows: stored.current.includes(teamId) ? [{ ...REPO, allowed_team_ids: [...stored.current] }] : [],
        });
      }
      if (/FROM repository/i.test(sql)) {
        return Promise.resolve({ rows: [{ ...REPO, allowed_team_ids: [...stored.current] }] });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    },
  } as unknown as TeamScopeDeps['pool'];

  return {
    deps: {
      pool,
      index: {
        applyRepositoryTeams: (repositoryId, teamIds) => {
          if (options.indexFails === true) return Promise.reject(new Error('ES 503'));
          indexed.push({ repositoryId, teamIds });
          return Promise.resolve({ total: 3 });
        },
      },
      source: { listRepositoryTeams: () => Promise.resolve(options.ghe) },
    },
    indexed,
    stored,
  };
}

describe('syncRepositoryTeamScope', () => {
  it('GHE가 답한 팀을 정본과 색인에 반영한다', async () => {
    const h = harness({ ghe: [{ id: 10, slug: 'core' }] });
    const outcome = await syncRepositoryTeamScope(h.deps, REPO);
    expect(outcome.changed).toBe(true);
    expect(outcome.teamIds).toEqual([10]);
    expect(h.stored.current).toEqual([10]);
    expect(h.indexed).toEqual([{ repositoryId: 1, teamIds: [10] }]);
  });

  it('**회수를 실제로 반영한다** — 정본의 옛 값을 되쓰지 않는다 (DEV-188)', async () => {
    // 정본에는 아직 10·20이 있는데 GHE는 이제 10만 답한다.
    const h = harness({ ghe: [{ id: 10, slug: 'core' }], existing: [10, 20] });
    await syncRepositoryTeamScope(h.deps, REPO);
    expect(h.stored.current).toEqual([10]);
    // 색인에 쓴 값이 회수 후 값이어야 한다. 옛 값을 쓰면 유출이다.
    expect(h.indexed[0]?.teamIds).toEqual([10]);
  });

  it('바뀐 것이 없으면 색인을 만지지 않는다', async () => {
    const h = harness({ ghe: [{ id: 10, slug: 'core' }], existing: [10] });
    const outcome = await syncRepositoryTeamScope(h.deps, REPO);
    expect(outcome.changed).toBe(false);
    expect(h.indexed).toEqual([]);
  });

  it('**색인이 실패하면 정본을 되돌린다** — 다음 동기화가 재시도한다 (DEV-189)', async () => {
    const h = harness({ ghe: [{ id: 10, slug: 'core' }], existing: [10, 20], indexFails: true });
    const outcome = await syncRepositoryTeamScope(h.deps, REPO);
    expect(outcome.rolledBack).toBe(true);
    expect(outcome.changed).toBe(false);
    // 되돌리지 않으면 다음 회차가 "바뀐 것 없음"으로 건너뛰어 색인이 영원히 낡는다.
    expect(h.stored.current).toEqual([10, 20]);
  });

  it('되돌린 뒤 다음 회차가 같은 차이를 다시 본다', async () => {
    const h = harness({ ghe: [{ id: 10, slug: 'core' }], existing: [10, 20], indexFails: true });
    await syncRepositoryTeamScope(h.deps, REPO);
    // 색인이 살아난 회차.
    const healthy = harness({ ghe: [{ id: 10, slug: 'core' }], existing: h.stored.current });
    const outcome = await syncRepositoryTeamScope(healthy.deps, REPO);
    expect(outcome.changed).toBe(true);
    expect(healthy.indexed[0]?.teamIds).toEqual([10]);
  });
});

describe('refreshTeamScope — 사건에서 대상을 고른다 (DEV-188)', () => {
  it('**`repository_id`가 있으면 그 저장소를 본다** — 추가 사건은 역조회로 못 찾는다', async () => {
    // 정본에 그 팀이 아직 없다(추가 직전 상태).
    const h = harness({ ghe: [{ id: 10, slug: 'core' }], existing: [] });
    const outcomes = await refreshTeamScope(h.deps, { teamId: 10, repositoryId: 1 });
    expect(outcomes).toHaveLength(1);
    expect(h.stored.current).toEqual([10]);
  });

  it('`repository_id`가 없으면 그 팀을 가진 저장소를 본다', async () => {
    const h = harness({ ghe: [], existing: [10] });
    const outcomes = await refreshTeamScope(h.deps, { teamId: 10, repositoryId: null });
    expect(outcomes).toHaveLength(1);
    // GHE가 이제 아무 팀도 답하지 않는다 = 전부 회수됐다.
    expect(h.stored.current).toEqual([]);
  });

  it('둘 다 없으면 아무것도 하지 않는다', async () => {
    const h = harness({ ghe: [{ id: 10, slug: 'core' }] });
    expect(await refreshTeamScope(h.deps, { teamId: null, repositoryId: null })).toEqual([]);
    expect(h.indexed).toEqual([]);
  });
});
