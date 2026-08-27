/**
 * 저장소 팀 접근 범위 (WP-068 / CR-035, DEV-114·185·186·187).
 *
 * ## 이 파일이 지키는 주장
 *
 * 네 색인 매핑이 `allowed_team_ids`를 선언하고 강제 필터가 그 값을 읽는데
 * **그것을 만드는 자리가 없었다.** 그래서 `team:<slug>` 질의는 한 건도 맞히지
 * 못했고, 500개를 넘어 `org_team` 경로로 전환된 사용자는 **팀으로만 볼 수 있는
 * 비공개 저장소를 잃었다.** 실패 방향이 과소 허용이라 유출은 아니지만 승인된
 * 기능(FR-AUTH-002 AC-6)이 죽어 있었다.
 *
 * 실행: `pnpm test:integration authz/team-scope`
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { authRepo, repositoryRepo, type Pool } from '@prs/db';
import { migratedPool } from '../helpers.js';
import { syncRepositoryTeams, type RegistryDeps } from '../../src/ops/repositories.js';

const REPOSITORY_ID = 8101;
const OWNER = 'acme';
const NAME = 'team-scope-wp068';
const ORG = 1;
const TEAM_CORE = 7701;
const TEAM_OPS = 7702;

let pool: Pool;
/** 색인 소급 적용 호출 기록. 실제 ES 없이 그 호출을 본다. */
let applied: { repositoryId: number; teams: readonly number[] }[];

function deps(teams: readonly { id: number; slug: string }[] | Error): RegistryDeps {
  return {
    pool,
    es: {
      updateByQuery: (request: { routing?: string; script?: { params?: { teams?: number[] } } }) => {
        applied.push({
          repositoryId: Number(request.routing),
          teams: request.script?.params?.teams ?? [],
        });
        return Promise.resolve({ updated: 3 });
      },
    } as unknown as RegistryDeps['es'],
    lookup: (() => Promise.resolve(null)) as unknown as RegistryDeps['lookup'],
    listTeams: () => (teams instanceof Error ? Promise.reject(teams) : Promise.resolve(teams)),
  };
}

describe('저장소 팀 접근 범위 (WP-068)', () => {
  beforeAll(async () => {
    pool = await migratedPool();
  }, 180_000);

  afterAll(async () => {
    await pool?.end();
  });

  beforeEach(async () => {
    applied = [];
    await pool.query('DELETE FROM repository WHERE repository_id = $1', [REPOSITORY_ID]);
    await pool.query('DELETE FROM team WHERE team_id = ANY($1::bigint[])', [[TEAM_CORE, TEAM_OPS]]);
    await repositoryRepo.upsertRepository(pool, {
      repository_id: REPOSITORY_ID,
      owner: OWNER,
      name: NAME,
      org_id: ORG,
      visibility: 'private',
      sequence_branches: ['main'],
    });
  });

  describe('정본이 팀을 소유한다 (CR-024)', () => {
    it('기본값은 빈 배열이다 — 모르는 것이 "전부 허용"이 되지 않는다', async () => {
      const row = await repositoryRepo.findRepositoryById(pool, REPOSITORY_ID);
      expect(row?.allowed_team_ids).toEqual([]);
    });

    it('설정하면 정렬·중복 제거되어 저장된다', async () => {
      const changed = await repositoryRepo.setAllowedTeams(pool, REPOSITORY_ID, [
        TEAM_OPS,
        TEAM_CORE,
        TEAM_CORE,
      ]);
      expect(changed).toBe(true);
      const row = await repositoryRepo.findRepositoryById(pool, REPOSITORY_ID);
      expect(row?.allowed_team_ids).toEqual([TEAM_CORE, TEAM_OPS]);
    });

    it('**같은 값이면 바뀌지 않았다고 답한다** — 헛된 색인 갱신을 막는다', async () => {
      await repositoryRepo.setAllowedTeams(pool, REPOSITORY_ID, [TEAM_CORE]);
      expect(await repositoryRepo.setAllowedTeams(pool, REPOSITORY_ID, [TEAM_CORE])).toBe(false);
      // 순서만 다른 것도 같은 값이다.
      await repositoryRepo.setAllowedTeams(pool, REPOSITORY_ID, [TEAM_CORE, TEAM_OPS]);
      expect(await repositoryRepo.setAllowedTeams(pool, REPOSITORY_ID, [TEAM_OPS, TEAM_CORE])).toBe(false);
    });

    it('팀으로 저장소를 되찾는다 — 소급 적용의 대상 목록이다', async () => {
      await repositoryRepo.setAllowedTeams(pool, REPOSITORY_ID, [TEAM_CORE]);
      const found = await repositoryRepo.findRepositoriesForTeam(pool, TEAM_CORE);
      expect(found.map((row) => row.repository_id)).toContain(REPOSITORY_ID);
      expect(await repositoryRepo.findRepositoriesForTeam(pool, TEAM_OPS)).toHaveLength(0);
    });
  });

  describe('GHE 동기화 (DEV-185·186)', () => {
    it('**저장소의 팀을 정본에 채우고 `team` 표에도 넣는다**', async () => {
      const result = await syncRepositoryTeams(
        deps([
          { id: TEAM_CORE, slug: 'payments-core' },
          { id: TEAM_OPS, slug: 'payments-ops' },
        ]),
        REPOSITORY_ID,
        ORG,
        OWNER,
        NAME,
        'c-1',
      );
      expect(result.changed).toBe(true);
      expect(result.teamIds).toEqual([TEAM_CORE, TEAM_OPS]);

      const row = await repositoryRepo.findRepositoryById(pool, REPOSITORY_ID);
      expect(row?.allowed_team_ids).toEqual([TEAM_CORE, TEAM_OPS]);

      // `team:` 질의가 slug를 ID로 옮길 수 있어야 한다 — 그 표가 비어 있어서 못 맞혔다.
      const ids = await authRepo.resolveTeamIds(pool, ['payments-core']);
      /*
       * **ID 목록이다** (WP-032, PR #57 리뷰 P2).
       *
       * slug은 조직 안에서만 유일하므로(`UNIQUE (org_id, slug)`) 이름 하나가 팀
       * 여럿을 가리킬 수 있다. 이 함수의 주석이 오래 "전부 돌려준다"고 적어
       * 왔으나 구현은 하나만 남기고 있었고, 패싯이 그 차이를 사용자에게 드러냈다.
       */
      expect(ids.get('payments-core')).toEqual([TEAM_CORE]);
    });

    it('**값이 바뀔 때만 색인을 만진다**', async () => {
      const teams = [{ id: TEAM_CORE, slug: 'payments-core' }];
      await syncRepositoryTeams(deps(teams), REPOSITORY_ID, ORG, OWNER, NAME, 'c-1');
      expect(applied).toHaveLength(4); // 별칭 4종

      applied = [];
      await syncRepositoryTeams(deps(teams), REPOSITORY_ID, ORG, OWNER, NAME, 'c-2');
      expect(applied).toEqual([]);
    });

    it('소급 적용이 **정렬된 팀 ID**를 문서에 쓴다', async () => {
      await syncRepositoryTeams(
        deps([
          { id: TEAM_OPS, slug: 'ops' },
          { id: TEAM_CORE, slug: 'core' },
        ]),
        REPOSITORY_ID,
        ORG,
        OWNER,
        NAME,
        'c-1',
      );
      expect(applied[0]?.teams).toEqual([TEAM_CORE, TEAM_OPS]);
      expect(applied[0]?.repositoryId).toBe(REPOSITORY_ID);
    });

    it('**GHE 실패가 등록을 되돌리지 않는다** — 팀은 다음 갱신이 채운다', async () => {
      await repositoryRepo.setAllowedTeams(pool, REPOSITORY_ID, [TEAM_CORE]);
      const result = await syncRepositoryTeams(
        deps(new Error('GHE 503')),
        REPOSITORY_ID,
        ORG,
        OWNER,
        NAME,
        'c-1',
      );
      expect(result.changed).toBe(false);
      // 기존 값을 지우지 않는다 — 모르는 것이 "아무 팀도 없음"이 되면 안 된다.
      const row = await repositoryRepo.findRepositoryById(pool, REPOSITORY_ID);
      expect(row?.allowed_team_ids).toEqual([TEAM_CORE]);
    });

    it('팀 조회 수단이 없으면 아무것도 하지 않는다 — 기존 값을 비우지 않는다', async () => {
      await repositoryRepo.setAllowedTeams(pool, REPOSITORY_ID, [TEAM_CORE]);
      const withoutTeams = { ...deps([]) };
      delete (withoutTeams as { listTeams?: unknown }).listTeams;
      const result = await syncRepositoryTeams(
        withoutTeams as RegistryDeps,
        REPOSITORY_ID,
        ORG,
        OWNER,
        NAME,
        'c-1',
      );
      expect(result.changed).toBe(false);
      expect((await repositoryRepo.findRepositoryById(pool, REPOSITORY_ID))?.allowed_team_ids).toEqual([
        TEAM_CORE,
      ]);
    });
  });

  describe('팀에서 제거되면 소급 적용된다 (DEV-187)', () => {
    it('**팀이 빠지면 문서의 접근 범위에서도 빠진다**', async () => {
      await syncRepositoryTeams(
        deps([
          { id: TEAM_CORE, slug: 'core' },
          { id: TEAM_OPS, slug: 'ops' },
        ]),
        REPOSITORY_ID,
        ORG,
        OWNER,
        NAME,
        'c-1',
      );
      applied = [];

      // GHE에서 ops 팀의 접근이 사라졌다.
      await syncRepositoryTeams(deps([{ id: TEAM_CORE, slug: 'core' }]), REPOSITORY_ID, ORG, OWNER, NAME, 'c-2');
      expect(applied).toHaveLength(4);
      expect(applied[0]?.teams).toEqual([TEAM_CORE]);
      expect((await repositoryRepo.findRepositoryById(pool, REPOSITORY_ID))?.allowed_team_ids).toEqual([
        TEAM_CORE,
      ]);
    });
  });
});
