/**
 * `explicit`과 `org_team`이 같은 권한에서 같은 결과를 낸다 (WP-034 / CR-050, DEV-353).
 *
 * ## 이 파일이 반증하는 결함
 *
 * `isRepositoryInScope`의 `allowedTeamIds`를 넘기지 않으면 **오류 없이 조용히
 * 좁게 답한다** — `org_team` 범위에서 팀 소속으로만 허용되는 비공개 저장소가
 * 결과에서 사라진다. fail-closed라 유출이 아니고, 그래서 WP-068 이후 다섯 WP
 * 동안 아무 시험도 그것을 잡지 못했다.
 *
 * **결과만 재는 시험으로는 잡히지 않는다.** 한 표현만 두면 빠진 결과가 "원래
 * 그런 것"으로 보인다. 그래서 같은 논리 권한을 두 표현으로 만들어 **결과가
 * 같은지**를 묻는다 — 재료가 빠지면 `org_team` 쪽만 좁아져 등식이 깨진다.
 *
 * ## 왜 함수 수준인가
 *
 * `toAccessScope`는 저장소가 500개를 넘을 때만 `org_team`을 준다
 * (`EXPLICIT_SCOPE_LIMIT`). HTTP로 그 표현을 만들려면 픽스처에 저장소 501개가
 * 필요하고, 그렇게 만든 시험은 무엇이 실패했는지 읽기 어렵다. 세 경로가 전부
 * `AccessScope`를 인자로 받으므로 그 자리에서 직접 건다.
 *
 * 실행: `pnpm test:integration repositories/scope-parity`
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from '@elastic/elasticsearch';
import { createEsClient, resolveClientOptions, type AccessScope } from '@prs/es';
import { authRepo, repositoryRepo, sequenceSpaceRepo, type Pool } from '@prs/db';
import { loadRepositoryOverview } from '../../src/repositories/overview.js';
import { resolveRepository } from '../../src/sequence/space.js';
import { listSequenceSpaces } from '../../src/sequence/spaces-list.js';
import { migratedPool } from '../helpers.js';

const ORG = 9061;
const MY_TEAM = 90610;
const OTHER_TEAM = 90611;

/** 팀 소속으로만 볼 수 있다. **DEV-353이 이 저장소를 사라지게 했다.** */
const TEAM_PRIVATE = 90620;
/** 같은 조직의 비공개지만 남의 팀 것. */
const FOREIGN_PRIVATE = 90621;
/** 가시성으로 보인다. */
const INTERNAL = 90622;

const ALL = [TEAM_PRIVATE, FOREIGN_PRIVATE, INTERNAL];
/** 두 표현 모두 이 집합을 내야 한다. */
const VISIBLE = [TEAM_PRIVATE, INTERNAL];

const SLUGS: Readonly<Record<number, { owner: string; name: string }>> = {
  [TEAM_PRIVATE]: { owner: 'wp034p', name: 'a-team-private' },
  [FOREIGN_PRIVATE]: { owner: 'wp034p', name: 'b-foreign-private' },
  [INTERNAL]: { owner: 'wp034p', name: 'c-internal' },
};

/**
 * 같은 논리 권한의 두 표현.
 *
 * `explicit`은 볼 수 있는 저장소를 열거하고, `org_team`은 조직·팀·가시성으로
 * 같은 집합을 기술한다. 규칙이 옳다면 둘이 같은 답을 내야 한다.
 */
const EXPLICIT: AccessScope = { kind: 'explicit', repositoryIds: VISIBLE };
const ORG_TEAM: AccessScope = {
  kind: 'org_team',
  orgIds: [ORG],
  teamIds: [MY_TEAM],
  visibilities: ['public', 'internal'],
};

let pool: Pool;
let es: Client;

beforeAll(async () => {
  pool = await migratedPool();
  es = createEsClient(resolveClientOptions());

  await pool.query('DELETE FROM sequence_space WHERE repository_id = ANY($1::bigint[])', [ALL]);
  await pool.query('DELETE FROM repository WHERE repository_id = ANY($1::bigint[])', [ALL]);
  await pool.query('DELETE FROM team WHERE team_id = ANY($1::bigint[])', [[MY_TEAM, OTHER_TEAM]]);

  await authRepo.upsertTeam(pool, { team_id: MY_TEAM, slug: 'wp034p-mine', org_id: ORG });
  await authRepo.upsertTeam(pool, { team_id: OTHER_TEAM, slug: 'wp034p-other', org_id: ORG });

  const fixtures = [
    [TEAM_PRIVATE, 'private', [MY_TEAM]],
    [FOREIGN_PRIVATE, 'private', [OTHER_TEAM]],
    [INTERNAL, 'internal', []],
  ] as const;

  for (const [id, visibility, teams] of fixtures) {
    const slug = SLUGS[id];
    await repositoryRepo.upsertRepository(pool, {
      repository_id: id,
      owner: slug?.owner ?? '',
      name: slug?.name ?? '',
      org_id: ORG,
      visibility,
      sequence_branches: ['main'],
    });
    if (teams.length > 0) await repositoryRepo.setAllowedTeams(pool, id, [...teams]);
    await sequenceSpaceRepo.ensureSequenceSpace(pool, id, 'main');
  }
}, 180_000);

afterAll(async () => {
  await pool?.query('DELETE FROM sequence_space WHERE repository_id = ANY($1::bigint[])', [ALL]);
  await pool?.query('DELETE FROM repository WHERE repository_id = ANY($1::bigint[])', [ALL]);
  await pool?.query('DELETE FROM team WHERE team_id = ANY($1::bigint[])', [[MY_TEAM, OTHER_TEAM]]);
  await es?.close();
  await pool?.end();
});

describe('API-ING-002 저장소 진단 (WP-034)', () => {
  async function visibleIds(scope: AccessScope): Promise<number[]> {
    const page = await loadRepositoryOverview({ pool, es }, { scope, limit: 100 });
    return page.items
      .map((item) => item.repository_id)
      .filter((id) => ALL.includes(id))
      .sort((a, b) => a - b);
  }

  it('**두 표현이 같은 저장소를 낸다** — `allowedTeamIds`를 빼면 org_team 쪽이 좁아진다', async () => {
    const [explicit, orgTeam] = await Promise.all([visibleIds(EXPLICIT), visibleIds(ORG_TEAM)]);
    expect(explicit).toEqual([...VISIBLE].sort((a, b) => a - b));
    expect(orgTeam, 'DEV-353: 팀 소속 저장소가 org_team 표현에서 사라진다').toEqual(explicit);
  });

  it('남의 팀 비공개는 두 표현 모두에서 안 보인다', async () => {
    for (const scope of [EXPLICIT, ORG_TEAM]) {
      expect(await visibleIds(scope)).not.toContain(FOREIGN_PRIVATE);
    }
  });
});

describe('resolveRepository — 단건 판정 (API-SEQ-001·002)', () => {
  async function visible(scope: AccessScope, id: number): Promise<boolean> {
    const slug = SLUGS[id];
    if (slug === undefined) throw new Error(`슬러그가 없다: ${String(id)}`);
    const lookup = await resolveRepository(pool, slug, scope);
    return lookup.kind === 'ok';
  }

  it('**팀 소속 비공개를 두 표현 모두에서 통과시킨다** (DEV-353)', async () => {
    expect(await visible(EXPLICIT, TEAM_PRIVATE)).toBe(true);
    expect(await visible(ORG_TEAM, TEAM_PRIVATE), 'DEV-353: org_team 경로가 좁다').toBe(true);
  });

  it('남의 팀 비공개는 두 표현 모두에서 막는다', async () => {
    expect(await visible(EXPLICIT, FOREIGN_PRIVATE)).toBe(false);
    expect(await visible(ORG_TEAM, FOREIGN_PRIVATE)).toBe(false);
  });

  it('가시성으로 보이는 저장소는 두 표현 모두에서 통과한다', async () => {
    expect(await visible(EXPLICIT, INTERNAL)).toBe(true);
    expect(await visible(ORG_TEAM, INTERNAL)).toBe(true);
  });
});

describe('listSequenceSpaces — 목록 판정 (API-SEQ-006)', () => {
  async function visibleIds(scope: AccessScope): Promise<number[]> {
    const spaces = await listSequenceSpaces(pool, scope);
    return [...new Set(spaces.map((space) => space.repository_id))]
      .filter((id) => ALL.includes(id))
      .sort((a, b) => a - b);
  }

  it('**두 표현이 같은 공간을 낸다** (DEV-353)', async () => {
    const [explicit, orgTeam] = await Promise.all([visibleIds(EXPLICIT), visibleIds(ORG_TEAM)]);
    expect(explicit).toEqual([...VISIBLE].sort((a, b) => a - b));
    expect(orgTeam, 'DEV-353: 목록 경로가 팀 소속 저장소를 빠뜨린다').toEqual(explicit);
  });

  it('남의 팀 비공개의 공간은 두 표현 모두에서 안 보인다', async () => {
    for (const scope of [EXPLICIT, ORG_TEAM]) {
      expect(await visibleIds(scope)).not.toContain(FOREIGN_PRIVATE);
    }
  });
});
