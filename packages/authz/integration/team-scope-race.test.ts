/**
 * 팀 접근 범위 동기화의 동시성 (CR-037, DEV-191) — 실제 PostgreSQL.
 *
 * ## 이 파일이 지키는 주장
 *
 * `syncRepositoryTeamScope`를 부르는 자리는 셋이다 — 저장소 등록(search-api),
 * 팀 웹훅(pipeline-worker), 조정 스캔(JOB-ING-005). 잠금이 없으면 셋이 겹칠 때
 * 각자 **다른 GHE 스냅숏**을 읽고 조건 없이 덮어쓰며, **늦게 끝난 옛 호출이 새
 * 회수를 되돌린다.** 제거된 팀 ID가 정본과 색인에 되살아나고, 그 팀에서 빠진
 * 사용자가 다음 동기화가 올 때까지 문서를 계속 본다 — 접근 범위의 유출이다.
 *
 * 이 시험은 두 동기화를 **실제로 동시에** 돌리고 GHE 응답 완료 순서를 의도적으로
 * 뒤집는다. 락은 PostgreSQL의 기능이므로 **여기서만 진짜로 검증된다** — 가짜
 * 풀로는 `pg_advisory_lock`이 아무것도 하지 않는다.
 *
 * 실행: `pnpm test:integration team-scope-race`
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { repositoryRepo, type Pool } from '@prs/db';
import { syncRepositoryTeamScope, type TeamScopeDeps } from '@prs/authz';
import { migratedPool } from '../../db/integration/helpers.js';

const REPOSITORY_ID = 8301;
const OWNER = 'acme';
const NAME = 'team-scope-race-cr037';
const ORG = 1;
const TEAM_KEEP = 7801;
const TEAM_REVOKED = 7802;
// `team`은 `(org_id, slug)`에도 유니크 제약이 있다 — 픽스처 이름을 이 파일 전용으로 둔다.
const SLUG_KEEP = 'cr037-race-keep';
const SLUG_REVOKED = 'cr037-race-revoked';

let pool: Pool;

/** 색인 쪽 최종 상태. `applyRepositoryTeams`가 마지막으로 쓴 값이다. */
let indexTeams: number[] | null;
/** 색인 쓰기 순서. 어느 호출이 마지막으로 이겼는지 본다. */
let indexWrites: number[][];

const repository = {
  repository_id: REPOSITORY_ID,
  owner: OWNER,
  name: NAME,
  org_id: ORG,
} as const;

/**
 * 두 호출을 **같은 순간에** GHE 안에 세우는 장치.
 *
 * `gate`가 열릴 때까지 첫 조회를 붙잡는다. 락이 조회를 감싸지 않으면 두 호출이
 * 함께 통과해 각자 다른 스냅숏을 들고 나오고, 그때 쓰기 순서를 뒤집을 수 있다.
 * 락이 조회를 감싸면 두 번째 호출은 애초에 여기 도달하지 못한다.
 */
function createSource(responses: readonly (readonly { id: number; slug: string }[])[]): {
  readonly source: TeamScopeDeps['source'];
  readonly entered: Promise<void>;
  release(): void;
  calls: number;
} {
  let calls = 0;
  let openGate: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    openGate = resolve;
  });
  let signalEntered: () => void = () => undefined;
  const entered = new Promise<void>((resolve) => {
    signalEntered = resolve;
  });

  const state = {
    get calls(): number {
      return calls;
    },
    entered,
    release: (): void => openGate(),
    source: {
      listRepositoryTeams: async (): Promise<readonly { id: number; slug: string }[]> => {
        const index = calls;
        calls += 1;
        if (index === 0) {
          // 첫 호출(옛 스냅숏)을 GHE 안에 붙잡아 둔다.
          signalEntered();
          await gate;
        }
        return responses[index] ?? responses[responses.length - 1] ?? [];
      },
    },
  };
  return state as ReturnType<typeof createSource>;
}

function deps(source: TeamScopeDeps['source']): TeamScopeDeps {
  return {
    pool,
    source,
    index: {
      applyRepositoryTeams: (_repositoryId, teamIds): Promise<{ total: number }> => {
        indexTeams = [...teamIds];
        indexWrites.push([...teamIds]);
        return Promise.resolve({ total: teamIds.length });
      },
    },
    // 시험이 매달리지 않도록 짧게. 정상 경로는 밀리초 안에 끝난다.
    lockTimeoutMs: 20_000,
  };
}

describe('팀 접근 범위 동기화는 저장소 단위로 직렬화된다 (CR-037, DEV-191)', () => {
  beforeAll(async () => {
    pool = await migratedPool();
  }, 180_000);

  afterAll(async () => {
    await pool?.end();
  });

  beforeEach(async () => {
    indexTeams = null;
    indexWrites = [];
    await pool.query('DELETE FROM repository WHERE repository_id = $1', [REPOSITORY_ID]);
    await pool.query('DELETE FROM team WHERE team_id = ANY($1::bigint[]) OR slug = ANY($2::text[])', [
      [TEAM_KEEP, TEAM_REVOKED],
      [SLUG_KEEP, SLUG_REVOKED],
    ]);
    await repositoryRepo.upsertRepository(pool, {
      repository_id: REPOSITORY_ID,
      owner: OWNER,
      name: NAME,
      org_id: ORG,
      visibility: 'private',
      sequence_branches: ['main'],
    });
    // 출발 상태: 두 팀 모두 접근 가능하다.
    await repositoryRepo.setAllowedTeams(pool, REPOSITORY_ID, [TEAM_KEEP, TEAM_REVOKED]);
  });

  it('GHE 응답이 뒤집힌 순서로 끝나도 회수가 되살아나지 않는다', async () => {
    /*
     * 첫 호출은 **옛 스냅숏**([keep, revoked])을 들고 GHE 안에서 멈춘다.
     * 두 번째 호출은 **새 스냅숏**([keep])을 즉시 받는다 — 회수가 일어났다.
     *
     * 잠금이 없으면 첫 호출이 나중에 깨어나 옛 값을 덮어써 `revoked`가 되살아난다.
     * 잠금이 조회를 감싸면 두 번째 호출은 첫 호출이 끝날 때까지 GHE에 닿지도
     * 못하고, 닿았을 때는 이미 회수된 최신 답([keep])을 받는다.
     */
    const stage = createSource([
      [
        { id: TEAM_KEEP, slug: SLUG_KEEP },
        { id: TEAM_REVOKED, slug: SLUG_REVOKED },
      ],
      [{ id: TEAM_KEEP, slug: SLUG_KEEP }],
    ]);

    const first = syncRepositoryTeamScope(deps(stage.source), repository);

    // 첫 호출이 정말로 GHE 안에 들어간 뒤에 두 번째를 띄운다.
    await stage.entered;
    const second = syncRepositoryTeamScope(deps(stage.source), repository);

    // 두 번째가 락을 기다리고 있는 동안 첫 호출을 풀어 준다 —
    // 완료 순서가 뒤집힌 상황을 만든다.
    await new Promise((resolve) => setTimeout(resolve, 200));
    stage.release();

    const outcomes = await Promise.all([first, second]);

    // 둘 다 미뤄지지 않고 실제로 수행됐다 — 직렬화가 한쪽을 버리지 않는다.
    expect(outcomes.every((one) => one.deferred)).toBe(false);

    const row = await repositoryRepo.findRepositoryById(pool, REPOSITORY_ID);
    expect(row?.allowed_team_ids).toEqual([TEAM_KEEP]);
    expect(indexTeams).toEqual([TEAM_KEEP]);

    // 색인의 **마지막** 쓰기가 회수를 반영해야 한다. 되살아난 값이 마지막이면 유출이다.
    expect(indexWrites.at(-1)).toEqual([TEAM_KEEP]);
    expect(indexWrites.every((write) => write.includes(TEAM_REVOKED) === false)).toBe(true);
  });

  it('조회 자체가 락 안에 있다 — 두 호출이 동시에 GHE를 읽지 않는다', async () => {
    let concurrent = 0;
    let maxConcurrent = 0;

    const source: TeamScopeDeps['source'] = {
      listRepositoryTeams: async (): Promise<readonly { id: number; slug: string }[]> => {
        concurrent += 1;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await new Promise((resolve) => setTimeout(resolve, 120));
        concurrent -= 1;
        return [{ id: TEAM_KEEP, slug: SLUG_KEEP }];
      },
    };

    await Promise.all([
      syncRepositoryTeamScope(deps(source), repository),
      syncRepositoryTeamScope(deps(source), repository),
      syncRepositoryTeamScope(deps(source), repository),
    ]);

    /*
     * 락이 쓰기만 감싸면 여기가 3이 된다 — 세 호출이 각자 옛 스냅숏을 읽고
     * 줄만 서서 덮어쓰는 상태이며, 그것이 DEV-191의 경주다.
     */
    expect(maxConcurrent).toBe(1);
  });

  it('다른 저장소끼리는 서로를 막지 않는다', async () => {
    const OTHER_ID = REPOSITORY_ID + 1;
    await pool.query('DELETE FROM repository WHERE repository_id = $1', [OTHER_ID]);
    await repositoryRepo.upsertRepository(pool, {
      repository_id: OTHER_ID,
      owner: OWNER,
      name: `${NAME}-other`,
      org_id: ORG,
      visibility: 'private',
      sequence_branches: ['main'],
    });

    let concurrent = 0;
    let maxConcurrent = 0;
    const source: TeamScopeDeps['source'] = {
      listRepositoryTeams: async (): Promise<readonly { id: number; slug: string }[]> => {
        concurrent += 1;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await new Promise((resolve) => setTimeout(resolve, 120));
        concurrent -= 1;
        return [{ id: TEAM_KEEP, slug: SLUG_KEEP }];
      },
    };

    await Promise.all([
      syncRepositoryTeamScope(deps(source), repository),
      syncRepositoryTeamScope(deps(source), { ...repository, repository_id: OTHER_ID, name: `${NAME}-other` }),
    ]);

    // 저장소 단위 락이다 — 전역 락이면 여기가 1이 되고 동기화가 직렬 병목이 된다.
    expect(maxConcurrent).toBe(2);

    await pool.query('DELETE FROM repository WHERE repository_id = $1', [OTHER_ID]);
  });
});
