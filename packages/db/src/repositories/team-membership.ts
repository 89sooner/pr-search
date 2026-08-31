/**
 * 작성자 소속 팀 리포지터리 (WP-069 / CR-058, 마이그레이션 021).
 *
 * ## 여기가 소유하는 것
 *
 * "이 조직에서 이 GHE 사용자가 어느 팀에 속하는가"와 "그 답이 언제 기준인가"
 * 둘이다. **접근 통제는 여기 없다** — `allowed_team_ids`가 저장소를 볼 수 있는
 * 팀이고 이것은 작성자의 소속이며, 둘을 섞으면 **접근 권한을 성과로 읽게 된다**
 * (CR-053, DEV-382).
 *
 * ## `team_member`가 아닌 이유
 *
 * 그 표는 `app_user(user_id)`를 참조하므로 **PR Search에 로그인한 적 없는
 * 사용자를 담지 못한다.** PR 작성자의 대부분이 그 경우다. 그리고 그 표의 뜻은
 * "이 팀의 PR Search 사용자"이고 권한 무효화가 그 뜻으로 읽는다 (DEV-482).
 *
 * ## 동기화 시각이 판정의 재료다
 *
 * `org_team_sync.synced_at`이 **아는 것과 모르는 것의 경계**다. 신선하면 그
 * 조직에서 작성자가 어느 팀에도 없다는 것이 사실이므로 빈 배열을 쓰고, 낡았거나
 * 행이 없으면 모름이므로 필드를 쓰지 않는다 (DEV-486). 이 표를 지우는 것은
 * "팀이 없다"가 아니라 "다시 물어봐야 한다"이다.
 */

import type { Pool, PoolClient } from 'pg';
import { withTransaction } from '../pool.js';
import { upsertTeam } from './auth.js';

type Queryable = Pool | PoolClient;

/** 한 조직에서 읽어 온 팀 하나와 그 구성원 login. */
export interface OrgTeamSnapshot {
  readonly teamId: number;
  readonly slug: string;
  readonly logins: readonly string[];
}

/**
 * 한 조직의 팀과 구성원을 통째로 갈아 끼운다.
 *
 * **부분 갱신이 아니라 교체다.** GHE가 준 목록이 진실이고, 여기 남아 있던
 * 사람이 그 목록에 없으면 팀에서 빠진 것이므로 지워야 한다. `replaceTeamMembers`가
 * `team_member`에 하는 것과 같은 판단이다 (CR-015, DEV-046).
 *
 * **본 팀을 `team` 레지스트리에도 등재한다** (DEV-483). `resolveTeamIds`가
 * `author_team:<slug>`를 ID로 옮기고 `resolveTeamSlugs`가 버킷 키를 이름으로
 * 되돌리는데 둘 다 그 표를 본다 — 등재하지 않으면 필드를 채워도 **질의가 조용히
 * 비고 버킷이 숫자로 남는다.**
 *
 * **`synced_at`은 이 트랜잭션 안에서 찍는다.** 밖에서 찍으면 교체가 실패한
 * 조직이 신선한 것으로 보이고, 그 순간 모름이 빈 배열로 바뀐다.
 *
 * @param syncedAt 동기화 시각. 시험이 시계를 고정할 수 있게 받는다.
 * @returns 등재한 팀 수와 구성원 행 수.
 */
export async function replaceOrgTeamMembership(
  pool: Pool,
  orgId: number,
  teams: readonly OrgTeamSnapshot[],
  syncedAt: Date,
): Promise<{ readonly teams: number; readonly members: number }> {
  /*
   * **레지스트리 등재는 트랜잭션 밖에서 한다** (WP-069 / CR-058).
   *
   * `upsertTeam`은 `(org_id, slug)` 유일 인덱스 충돌(23505)을 **한 번 다시 시도해**
   * 넘긴다 — 그 사이 상대가 커밋해 행이 존재하므로 두 번째 시도가 갱신 경로를
   * 탄다는 전제다. **트랜잭션 안에서는 그 전제가 깨진다**: PostgreSQL은 오류가
   * 나면 트랜잭션을 중단시키므로 재시도의 `INSERT`가 25P02로 다시 실패하고,
   * 회복 가능한 경합이 **동기화 전체의 실패**가 된다.
   *
   * 저장소 팀 동기화(`team-scope.ts`)가 같은 표에 다른 잠금 아래에서 쓰므로
   * 그 경합은 실재한다 — 조직 잠금은 이쪽 경로끼리만 줄을 세운다.
   *
   * 밖으로 빼도 잃는 것이 없다. 등재는 멱등이고, 아래 트랜잭션이 실패하면
   * `org_team_sync`가 갱신되지 않아 **판정은 그대로 모름이다.**
   */
  for (const team of teams) {
    await upsertTeam(pool, { team_id: team.teamId, slug: team.slug, org_id: orgId });
  }

  return withTransaction(pool, async (client) => {
    /*
     * 이 조직의 **알려진 팀 전부**에서 지운다. 이번에 받은 팀만 지우면 조직에서
     * 사라진 팀의 구성원이 그대로 남아, 없어진 팀의 버킷이 계속 답한다.
     */
    await client.query(
      `DELETE FROM team_membership
        WHERE team_id IN (SELECT team_id FROM team WHERE org_id = $1)`,
      [orgId],
    );

    let members = 0;
    for (const team of teams) {
      const logins = [...new Set(team.logins)];
      if (logins.length === 0) continue;
      const { rowCount } = await client.query(
        `INSERT INTO team_membership (team_id, login)
         SELECT $1, unnest($2::text[])
         ON CONFLICT DO NOTHING`,
        [team.teamId, logins],
      );
      members += rowCount ?? 0;
    }

    await client.query(
      `INSERT INTO org_team_sync (org_id, synced_at) VALUES ($1, $2)
       ON CONFLICT (org_id) DO UPDATE SET synced_at = EXCLUDED.synced_at`,
      [orgId, syncedAt],
    );

    return { teams: teams.length, members };
  });
}

/** 조직의 마지막 동기화 시각. 한 번도 하지 않았으면 `null`이다. */
export async function findOrgSyncedAt(db: Queryable, orgId: number): Promise<Date | null> {
  const { rows } = await db.query<{ synced_at: Date }>(
    'SELECT synced_at FROM org_team_sync WHERE org_id = $1',
    [orgId],
  );
  return rows[0]?.synced_at ?? null;
}

/**
 * 여러 작성자의 소속 팀을 한 번에 읽는다.
 *
 * **버킷마다 조회하지 않는다** — 백필과 재색인은 한 배치에 200건을 다루므로
 * login마다 왕복하면 그 수만큼 늘어난다. `resolveTeamSlugs`가 같은 이유로
 * 일괄인 것과 같다 (WP-032, DEV-281).
 *
 * 팀이 없는 login은 **맵에 담지 않는다** — 빈 배열과 미조회를 여기서 가르지
 * 않는다. 그 판정은 `synced_at`을 함께 보는 호출부의 몫이다.
 */
export async function findAuthorTeamIds(
  db: Queryable,
  orgId: number,
  logins: readonly string[],
): Promise<Map<string, number[]>> {
  const unique = [...new Set(logins)];
  if (unique.length === 0) return new Map();

  const { rows } = await db.query<{ login: string; team_id: string }>(
    `SELECT m.login, m.team_id
       FROM team_membership m
       JOIN team t ON t.team_id = m.team_id
      WHERE t.org_id = $1 AND m.login = ANY($2::text[])
      ORDER BY m.team_id`,
    [orgId, unique],
  );

  // `ORDER BY team_id`가 출력을 결정론으로 만든다 — 같은 소속이 늘 같은 배열이
  // 되어야 조건부 업서트가 바뀌지 않은 문서를 `noop`으로 접는다.
  const resolved = new Map<string, number[]>();
  for (const row of rows) {
    const id = Number(row.team_id);
    const found = resolved.get(row.login);
    if (found === undefined) resolved.set(row.login, [id]);
    else found.push(id);
  }
  return resolved;
}
