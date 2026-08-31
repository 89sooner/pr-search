/**
 * 작성자 소속 팀 (마이그레이션 021 / WP-069, CR-058).
 *
 * ## 이 표가 없으면 깨지는 것
 *
 * `team_member`는 `app_user(user_id)`를 참조하므로 **PR Search에 로그인한 적 없는
 * 작성자를 담지 못한다.** PR 작성자의 대부분이 그 경우이고, 그 표만으로는
 * `author_team_ids`를 채울 수 없다 (DEV-482). 그리고 `ADR-004`가 재구축을
 * PostgreSQL만으로 요구하므로 소속이 여기 있어야 재색인이 현재 값을 쓴다
 * (DEV-485).
 *
 * 실행: `pnpm test:integration team-membership`
 */

import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as teamMembershipRepo from '../src/repositories/team-membership.js';
import * as authRepo from '../src/repositories/auth.js';
import { migratedPool, truncate } from './helpers.js';

const ORG = 90_101;
const OTHER_ORG = 90_102;
const CORE = 91_001;
const PLATFORM = 91_002;
const OTHER_TEAM = 91_003;
const SYNCED = new Date('2026-08-31T10:00:00.000Z');

describe('team_membership · org_team_sync (WP-069 / CR-058)', () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = await migratedPool();
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await truncate(pool, 'team_membership', 'org_team_sync', 'team_member', 'team', 'app_user');
  });

  it('조직 동기화가 팀과 구성원과 시각을 함께 남긴다', async () => {
    const written = await teamMembershipRepo.replaceOrgTeamMembership(
      pool,
      ORG,
      [
        { teamId: CORE, slug: 'core', logins: ['alice', 'bob'] },
        { teamId: PLATFORM, slug: 'platform', logins: ['alice'] },
      ],
      SYNCED,
    );

    expect(written).toEqual({ teams: 2, members: 3 });
    expect(await teamMembershipRepo.findOrgSyncedAt(pool, ORG)).toEqual(SYNCED);

    const found = await teamMembershipRepo.findAuthorTeamIds(pool, ORG, ['alice', 'bob']);
    expect(found.get('alice')).toEqual([CORE, PLATFORM]);
    expect(found.get('bob')).toEqual([CORE]);
  });

  it('**로그인한 적 없는 사용자를 담는다** — `team_member`가 답하지 못하는 자리다 (DEV-482)', async () => {
    await authRepo.upsertTeam(pool, { team_id: CORE, slug: 'core', org_id: ORG });

    // `team_member`는 `app_user` 외래 키가 미로그인 사용자를 버린다.
    const kept = await authRepo.replaceTeamMembers(pool, CORE, ['never-logged-in']);
    expect(kept).toEqual([]);

    // `team_membership`은 담는다 — 그것이 이 표를 만든 이유다.
    await teamMembershipRepo.replaceOrgTeamMembership(
      pool,
      ORG,
      [{ teamId: CORE, slug: 'core', logins: ['never-logged-in'] }],
      SYNCED,
    );
    const found = await teamMembershipRepo.findAuthorTeamIds(pool, ORG, ['never-logged-in']);
    expect(found.get('never-logged-in')).toEqual([CORE]);
  });

  it('**조회한 팀을 `team` 레지스트리에 등재한다** — 하지 않으면 slug 해석이 비고 버킷이 숫자로 남는다 (DEV-483)', async () => {
    await teamMembershipRepo.replaceOrgTeamMembership(
      pool,
      ORG,
      [{ teamId: CORE, slug: 'core', logins: ['alice'] }],
      SYNCED,
    );

    expect(await authRepo.resolveTeamIds(pool, ['core'])).toEqual(new Map([['core', [CORE]]]));
    expect(await authRepo.resolveTeamSlugs(pool, [CORE])).toEqual(new Map([[CORE, 'core']]));
  });

  it('**교체다.** 목록에서 빠진 사람은 지워지고, 사라진 팀의 구성원도 남지 않는다', async () => {
    await teamMembershipRepo.replaceOrgTeamMembership(
      pool,
      ORG,
      [
        { teamId: CORE, slug: 'core', logins: ['alice', 'bob'] },
        { teamId: PLATFORM, slug: 'platform', logins: ['alice'] },
      ],
      SYNCED,
    );

    // 두 번째 동기화: bob이 빠지고 platform 팀 자체가 조직에서 사라졌다.
    await teamMembershipRepo.replaceOrgTeamMembership(
      pool,
      ORG,
      [{ teamId: CORE, slug: 'core', logins: ['alice'] }],
      new Date('2026-08-31T11:00:00.000Z'),
    );

    const found = await teamMembershipRepo.findAuthorTeamIds(pool, ORG, ['alice', 'bob']);
    expect(found.get('alice')).toEqual([CORE]);
    expect(found.get('bob')).toBeUndefined();
  });

  it('**조직이 판정의 경계다** — 다른 조직의 같은 사람은 이 조직의 답에 섞이지 않는다 (DEV-481)', async () => {
    await teamMembershipRepo.replaceOrgTeamMembership(
      pool,
      ORG,
      [{ teamId: CORE, slug: 'core', logins: ['alice'] }],
      SYNCED,
    );
    await teamMembershipRepo.replaceOrgTeamMembership(
      pool,
      OTHER_ORG,
      [{ teamId: OTHER_TEAM, slug: 'core', logins: ['alice'] }],
      SYNCED,
    );

    expect((await teamMembershipRepo.findAuthorTeamIds(pool, ORG, ['alice'])).get('alice')).toEqual([CORE]);
    expect((await teamMembershipRepo.findAuthorTeamIds(pool, OTHER_ORG, ['alice'])).get('alice')).toEqual([
      OTHER_TEAM,
    ]);
  });

  it('한 조직의 동기화가 다른 조직의 소속을 지우지 않는다', async () => {
    await teamMembershipRepo.replaceOrgTeamMembership(
      pool,
      OTHER_ORG,
      [{ teamId: OTHER_TEAM, slug: 'core', logins: ['alice'] }],
      SYNCED,
    );
    await teamMembershipRepo.replaceOrgTeamMembership(
      pool,
      ORG,
      [{ teamId: CORE, slug: 'core', logins: ['bob'] }],
      SYNCED,
    );

    expect((await teamMembershipRepo.findAuthorTeamIds(pool, OTHER_ORG, ['alice'])).get('alice')).toEqual([
      OTHER_TEAM,
    ]);
  });

  it('동기화한 적 없는 조직은 시각이 `null`이다 — 그것이 모름의 재료다 (DEV-486)', async () => {
    expect(await teamMembershipRepo.findOrgSyncedAt(pool, ORG)).toBeNull();
  });

  it('빈 조회는 왕복하지 않고 빈 맵을 돌려준다', async () => {
    expect(await teamMembershipRepo.findAuthorTeamIds(pool, ORG, [])).toEqual(new Map());
  });

  it('중복 login을 접는다 — GHE가 같은 사람을 두 번 주어도 행이 하나다', async () => {
    const written = await teamMembershipRepo.replaceOrgTeamMembership(
      pool,
      ORG,
      [{ teamId: CORE, slug: 'core', logins: ['alice', 'alice'] }],
      SYNCED,
    );
    expect(written.members).toBe(1);
    expect((await teamMembershipRepo.findAuthorTeamIds(pool, ORG, ['alice'])).get('alice')).toEqual([CORE]);
  });
});
