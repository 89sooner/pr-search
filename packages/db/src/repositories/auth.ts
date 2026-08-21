/**
 * 사용자·팀·권한 캐시 리포지터리 (ENT-CORE-004, ENT-CORE-005).
 *
 * PostgreSQL은 Redis 미스 시의 백업이자 무효화 대상을 찾는 색인이다 (ADR-008).
 * **접근 범위의 시스템 오브 레코드는 GHE다** — 여기 있는 것은 전부 캐시이며,
 * 지워도 다음 조회가 다시 채운다.
 */

import type { Pool, PoolClient } from 'pg';

type Queryable = Pool | PoolClient;

export type ScopeKind = 'explicit' | 'org_team';

export interface AppUserRow {
  /** OIDC `sub` (CR-015, DEV-043). */
  readonly user_id: string;
  /** GHE login. */
  readonly login: string;
  /** GHE 숫자 id. login 개명에 흔들리지 않는 유일한 신원이다. */
  readonly github_user_id: number | null;
  readonly email: string | null;
  readonly roles: string[];
  readonly access_scope_version: number;
  readonly last_seen_at: Date | null;
}

export interface AppUserUpsert {
  readonly user_id: string;
  readonly login: string;
  readonly github_user_id?: number | null;
  readonly email?: string | null;
}

/**
 * 로그인 시 사용자를 만들거나 갱신한다.
 *
 * **`roles`를 건드리지 않는다 (CR-015, DEV-049).** 관리자가 지정한
 * `operator`·`release_manager`·`security_officer`는 이 표에만 있고, IdP는
 * 그것을 모른다. 여기서 `roles`를 쓰면 로그인 한 번이 관리자 지정을 지운다.
 *
 * `access_scope_version`도 건드리지 않는다 — 로그인은 권한 변경이 아니다.
 */
export async function upsertUserOnLogin(db: Queryable, user: AppUserUpsert): Promise<AppUserRow> {
  const { rows } = await db.query<AppUserRow>(
    `INSERT INTO app_user (user_id, login, github_user_id, email, last_seen_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (user_id) DO UPDATE SET
       login          = EXCLUDED.login,
       github_user_id = COALESCE(EXCLUDED.github_user_id, app_user.github_user_id),
       email          = COALESCE(EXCLUDED.email, app_user.email),
       last_seen_at   = now()
     RETURNING user_id, login, github_user_id, email, roles, access_scope_version, last_seen_at`,
    [user.user_id, user.login, user.github_user_id ?? null, user.email ?? null],
  );

  const row = rows[0];
  if (row === undefined) throw new Error('app_user upsert가 행을 돌려주지 않았다');
  return row;
}

export async function findUserById(db: Queryable, userId: string): Promise<AppUserRow | null> {
  const { rows } = await db.query<AppUserRow>(
    `SELECT user_id, login, github_user_id, email, roles, access_scope_version, last_seen_at
       FROM app_user WHERE user_id = $1`,
    [userId],
  );
  return rows[0] ?? null;
}

/** 관리자 지정 역할을 바꾼다. IdP 매핑 역할은 여기 담기지 않는다. */
export async function setAssignedRoles(db: Queryable, userId: string, roles: readonly string[]): Promise<void> {
  await db.query('UPDATE app_user SET roles = $2 WHERE user_id = $1', [userId, [...roles]]);
}

export interface PermissionCacheRow {
  readonly user_id: string;
  readonly scope_kind: ScopeKind;
  readonly repository_ids: number[] | null;
  readonly org_ids: number[] | null;
  readonly team_ids: number[] | null;
  readonly visibilities: string[];
  readonly refreshed_at: Date;
  readonly access_scope_version: number;
}

export interface PermissionCacheWrite {
  readonly user_id: string;
  readonly scope_kind: ScopeKind;
  readonly repository_ids: readonly number[];
  readonly org_ids: readonly number[];
  readonly team_ids: readonly number[];
  readonly visibilities: readonly string[];
  /** 갱신을 시작할 때 읽어 둔 값. 이것이 울타리다 (CR-015, DEV-044). */
  readonly expected_version: number;
}

export async function findPermissionCache(db: Queryable, userId: string): Promise<PermissionCacheRow | null> {
  const { rows } = await db.query<PermissionCacheRow>(
    `SELECT user_id, scope_kind, repository_ids, org_ids, team_ids, visibilities,
            refreshed_at, access_scope_version
       FROM permission_cache WHERE user_id = $1`,
    [userId],
  );
  return rows[0] ?? null;
}

/**
 * 계산한 접근 범위를 캐시에 쓴다 — **버전이 그대로일 때만** (CR-015, DEV-044).
 *
 * 회수 직전에 시작된 GHE 조회가 회수 뒤에 끝나면, `app_user.access_scope_version`은
 * 이미 증가해 있다. 그 경우 이 쿼리는 0행을 갱신하고 `false`를 돌려준다 —
 * 회수 이전의 범위가 캐시로 되살아나지 않는다.
 *
 * 버린 결과는 손실이 아니다. 다음 요청이 캐시 미스로 다시 조회하고, 그때는
 * 회수가 반영된 범위를 얻는다.
 *
 * @returns 기록했으면 `true`, 무효화가 끼어들어 버렸으면 `false`
 */
export async function writePermissionCache(db: Queryable, scope: PermissionCacheWrite): Promise<boolean> {
  const { rowCount } = await db.query(
    `INSERT INTO permission_cache
       (user_id, scope_kind, repository_ids, org_ids, team_ids, visibilities, refreshed_at, access_scope_version)
     SELECT $1, $2, $3, $4, $5, $6, now(), $7
       FROM app_user
      WHERE app_user.user_id = $1
        AND app_user.access_scope_version = $7
     ON CONFLICT (user_id) DO UPDATE SET
       scope_kind           = EXCLUDED.scope_kind,
       repository_ids       = EXCLUDED.repository_ids,
       org_ids              = EXCLUDED.org_ids,
       team_ids             = EXCLUDED.team_ids,
       visibilities         = EXCLUDED.visibilities,
       refreshed_at         = EXCLUDED.refreshed_at,
       access_scope_version = EXCLUDED.access_scope_version
     WHERE permission_cache.access_scope_version <= EXCLUDED.access_scope_version`,
    [
      scope.user_id,
      scope.scope_kind,
      [...scope.repository_ids],
      [...scope.org_ids],
      [...scope.team_ids],
      [...scope.visibilities],
      scope.expected_version,
    ],
  );
  return (rowCount ?? 0) > 0;
}

/**
 * 무효화 (FR-AUTH-003 AC-2, AC-4).
 *
 * 캐시 행을 지우고 `access_scope_version`을 올린다. 두 가지를 한 트랜잭션에
 * 묶는 것이 중요하다 — 버전만 올리고 행이 남으면 다음 조회가 낡은 행을 쓰고,
 * 행만 지우고 버전이 그대로면 진행 중이던 갱신이 낡은 값을 다시 써 넣는다.
 *
 * @returns 실제로 무효화된 사용자 ID
 */
export async function invalidateUsers(db: Queryable, userIds: readonly string[]): Promise<string[]> {
  if (userIds.length === 0) return [];

  const ids = [...userIds];
  const { rows } = await db.query<{ user_id: string }>(
    `WITH bumped AS (
       UPDATE app_user
          SET access_scope_version = access_scope_version + 1
        WHERE user_id = ANY($1::text[])
        RETURNING user_id
     ), cleared AS (
       DELETE FROM permission_cache WHERE user_id = ANY($1::text[])
     )
     SELECT user_id FROM bumped`,
    [ids],
  );
  return rows.map((row) => row.user_id);
}

/** GHE 숫자 id로 사용자를 찾는다. 무효화가 우선 쓰는 경로다 (CR-015, DEV-043). */
export async function findUserIdsByGithubIds(db: Queryable, githubIds: readonly number[]): Promise<string[]> {
  if (githubIds.length === 0) return [];
  const { rows } = await db.query<{ user_id: string }>(
    'SELECT user_id FROM app_user WHERE github_user_id = ANY($1::bigint[])',
    [[...githubIds]],
  );
  return rows.map((row) => row.user_id);
}

/** login으로 사용자를 찾는다. 숫자 id가 없는 이벤트의 폴백이다. */
export async function findUserIdsByLogins(db: Queryable, logins: readonly string[]): Promise<string[]> {
  if (logins.length === 0) return [];
  const { rows } = await db.query<{ user_id: string }>('SELECT user_id FROM app_user WHERE login = ANY($1::text[])', [
    [...logins],
  ]);
  return rows.map((row) => row.user_id);
}

/**
 * 저장소 하나에 영향받는 사용자를 찾는다 (CR-015, DEV-045).
 *
 * 두 갈래를 합친다.
 *   - `explicit` 캐시: 그 저장소 ID를 담고 있는 행
 *   - `org_team` 캐시: 그 저장소의 조직을 담고 있는 행 (저장소를 나열하지 않으므로)
 *
 * 둘 다 GIN 색인을 탄다. 색인이 없으면 이 조회가 전량 스캔이 되고,
 * `repository` 웹훅 하나가 권한 캐시 테이블을 통째로 읽는다.
 */
export async function findUsersAffectedByRepository(
  db: Queryable,
  repositoryId: number,
  orgId: number | null,
): Promise<string[]> {
  const { rows } = await db.query<{ user_id: string }>(
    `SELECT user_id FROM permission_cache
      WHERE repository_ids @> ARRAY[$1::bigint]
         OR ($2::bigint IS NOT NULL AND scope_kind = 'org_team' AND org_ids @> ARRAY[$2::bigint])`,
    [repositoryId, orgId],
  );
  return rows.map((row) => row.user_id);
}

export interface TeamRow {
  readonly team_id: number;
  readonly slug: string;
  readonly org_id: number;
  readonly members_refreshed_at: Date | null;
}

export async function upsertTeam(
  db: Queryable,
  team: { readonly team_id: number; readonly slug: string; readonly org_id: number },
): Promise<void> {
  await db.query(
    `INSERT INTO team (team_id, slug, org_id) VALUES ($1, $2, $3)
     ON CONFLICT (team_id) DO UPDATE SET slug = EXCLUDED.slug, org_id = EXCLUDED.org_id`,
    [team.team_id, team.slug, team.org_id],
  );
}

export async function findTeam(db: Queryable, teamId: number): Promise<TeamRow | null> {
  const { rows } = await db.query<TeamRow>(
    'SELECT team_id, slug, org_id, members_refreshed_at FROM team WHERE team_id = $1',
    [teamId],
  );
  return rows[0] ?? null;
}

/**
 * 팀 구성원을 통째로 갈아 끼운다 (CR-015, DEV-046).
 *
 * 부분 갱신이 아니라 교체다. GHE가 준 목록이 진실이고, 여기 남아 있던
 * 사람이 그 목록에 없다면 **팀에서 빠진 것**이므로 지워야 한다. 지우지 않으면
 * 탈퇴한 사람이 팀 무효화 대상으로 계속 남는다 (해롭지는 않지만 늘어난다).
 *
 * `app_user`에 아직 없는 사용자는 담지 않는다 — 외래 키가 막고, 로그인한
 * 적 없는 사람에게는 무효화할 캐시도 없다.
 */
export async function replaceTeamMembers(
  db: Queryable,
  teamId: number,
  userIds: readonly string[],
): Promise<string[]> {
  await db.query('DELETE FROM team_member WHERE team_id = $1', [teamId]);

  if (userIds.length > 0) {
    await db.query(
      `INSERT INTO team_member (team_id, user_id)
       SELECT $1, user_id FROM app_user WHERE user_id = ANY($2::text[])
       ON CONFLICT DO NOTHING`,
      [teamId, [...userIds]],
    );
  }

  await db.query('UPDATE team SET members_refreshed_at = now() WHERE team_id = $1', [teamId]);
  return listTeamMembers(db, teamId);
}

export async function listTeamMembers(db: Queryable, teamId: number): Promise<string[]> {
  const { rows } = await db.query<{ user_id: string }>('SELECT user_id FROM team_member WHERE team_id = $1', [teamId]);
  return rows.map((row) => row.user_id);
}
