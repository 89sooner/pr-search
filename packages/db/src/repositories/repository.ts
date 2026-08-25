/**
 * `repository` 리포지터리 (ENT-CORE-001, FR-ING-009).
 */

import type { Pool, PoolClient } from 'pg';

export type RepositoryStatus = 'active' | 'archived';

export interface RepositoryRow {
  readonly repository_id: number;
  readonly owner: string;
  readonly name: string;
  readonly org_id: number;
  readonly visibility: 'public' | 'internal' | 'private';
  readonly sequence_branches: string[];
  readonly mirror_enabled: boolean;
  readonly status: RepositoryStatus;
  readonly registered_at: Date;
  /**
   * 이 저장소를 볼 수 있는 팀 (WP-068 / CR-035, DEV-114 해소).
   *
   * **레지스트리가 소유한다** (CR-024) — 이벤트에 싣지 않는다. 팀 권한은 PR
   * 엔티티의 버전이 아니라 저장소 접근 상태이며, 그것으로 문서 버전이 오르면
   * 권한 변경이 수집 순서를 흔든다.
   */
  readonly allowed_team_ids: number[];
  /**
   * 정본 스냅숏이 완전하다고 확인된 시점 (CR-037, DEV-194).
   *
   * `null`이면 아직 부트스트랩되지 않았다 — 그 저장소의 `pull_request_snapshot`은
   * 비어 있거나 일부만 있으며, 정합성 감시가 그것을 색인 손상으로 읽으면 안 된다.
   */
  snapshot_bootstrapped_at: Date | null;

}

/**
 * 시퀀스 대상 브랜치 상한 (FR-ING-009 AC-2).
 *
 * DB의 CHECK 제약이 같은 값을 강제한다. 여기 상수를 두는 것은 API가 400
 * `BRANCH_LIMIT_EXCEEDED`로 **먼저** 거절하기 위해서다 — 제약 위반으로
 * 터지면 클라이언트가 받는 것은 500이다.
 */
export const MAX_SEQUENCE_BRANCHES = 10;

type Queryable = Pool | PoolClient;

/**
 * 등록 입력.
 *
 * `registered_at`은 여기 없다 — DB가 찍는다. 행 타입에서 파생시키면 등록할
 * 때마다 "언제 등록됐는지"를 클라이언트가 주장하게 된다.
 */
export interface RepositoryInput {
  readonly repository_id: number;
  readonly owner: string;
  readonly name: string;
  readonly org_id: number;
  readonly visibility: 'public' | 'internal' | 'private';
  readonly sequence_branches: readonly string[];
  readonly mirror_enabled?: boolean;
  readonly status?: RepositoryStatus;
}

/** 저장소를 등록하거나 갱신한다. 시퀀스 대상 브랜치는 최대 10개다 (FR-ING-009 AC-2). */
export async function upsertRepository(db: Queryable, repository: RepositoryInput): Promise<void> {
  await db.query(
    `INSERT INTO repository
       (repository_id, owner, name, org_id, visibility, sequence_branches, mirror_enabled, status)
     VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, true), COALESCE($8, 'active'))
     ON CONFLICT (repository_id) DO UPDATE SET
       owner = EXCLUDED.owner,
       name = EXCLUDED.name,
       org_id = EXCLUDED.org_id,
       visibility = EXCLUDED.visibility,
       sequence_branches = EXCLUDED.sequence_branches,
       mirror_enabled = EXCLUDED.mirror_enabled,
       status = EXCLUDED.status`,
    [
      repository.repository_id,
      repository.owner,
      repository.name,
      repository.org_id,
      repository.visibility,
      [...repository.sequence_branches],
      repository.mirror_enabled ?? null,
      repository.status ?? null,
    ],
  );
}

export async function findRepositoryById(db: Queryable, repositoryId: number): Promise<RepositoryRow | undefined> {
  const result = await db.query<RepositoryRow>('SELECT * FROM repository WHERE repository_id = $1', [
    repositoryId,
  ]);
  return result.rows[0];
}

export async function listActiveRepositories(db: Queryable): Promise<RepositoryRow[]> {
  const result = await db.query<RepositoryRow>(
    "SELECT * FROM repository WHERE status = 'active' ORDER BY owner, name",
  );
  return result.rows;
}

export interface RepositoryFilter {
  readonly status?: RepositoryStatus;
}

function statusClause(filter: RepositoryFilter): { readonly sql: string; readonly params: unknown[] } {
  if (filter.status === undefined) return { sql: '', params: [] };
  return { sql: ' WHERE status = $1', params: [filter.status] };
}

export async function listRepositories(
  db: Queryable,
  filter: RepositoryFilter = {},
  limit = 50,
  offset = 0,
): Promise<RepositoryRow[]> {
  const { sql, params } = statusClause(filter);
  const result = await db.query<RepositoryRow>(
    `SELECT * FROM repository${sql}
      ORDER BY owner, name
      LIMIT $${String(params.length + 1)} OFFSET $${String(params.length + 2)}`,
    [...params, limit, offset],
  );
  return result.rows;
}

export async function countRepositories(db: Queryable, filter: RepositoryFilter = {}): Promise<number> {
  const { sql, params } = statusClause(filter);
  const result = await db.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM repository${sql}`,
    params,
  );
  return result.rows[0]?.count ?? 0;
}

export async function findRepositoryBySlug(
  db: Queryable,
  owner: string,
  name: string,
): Promise<RepositoryRow | undefined> {
  const result = await db.query<RepositoryRow>(
    'SELECT * FROM repository WHERE owner = $1 AND name = $2',
    [owner, name],
  );
  return result.rows[0];
}

/**
 * 등록 상태를 바꾼다 (FR-ING-009 AC-3).
 *
 * 행을 지우지 않는다. 해제는 소프트 삭제이며 기존 문서도 남는다 —
 * 조사 이력의 보존이 이 제품의 목적이다 (데이터 모델 9장).
 */
export async function setRepositoryStatus(
  db: Queryable,
  repositoryId: number,
  status: RepositoryStatus,
): Promise<RepositoryRow | undefined> {
  const result = await db.query<RepositoryRow>(
    'UPDATE repository SET status = $2 WHERE repository_id = $1 RETURNING *',
    [repositoryId, status],
  );
  return result.rows[0];
}

export interface RepositorySettings {
  readonly sequence_branches?: readonly string[];
  readonly mirror_enabled?: boolean;
}

/**
 * 운영자가 바꿀 수 있는 설정만 갱신한다.
 *
 * 소유자·이름·가시성·조직은 GHE가 소유한 값이라 여기서 바꾸지 않는다. 등록
 * 시점에 GHE에 물어서 채우고, 달라졌으면 재등록이 갱신한다 (CR-013, DEV-033).
 */
export async function updateRepositorySettings(
  db: Queryable,
  repositoryId: number,
  settings: RepositorySettings,
): Promise<RepositoryRow | undefined> {
  const result = await db.query<RepositoryRow>(
    `UPDATE repository
        SET sequence_branches = COALESCE($2, sequence_branches),
            mirror_enabled    = COALESCE($3, mirror_enabled)
      WHERE repository_id = $1
      RETURNING *`,
    [
      repositoryId,
      settings.sequence_branches === undefined ? null : [...settings.sequence_branches],
      settings.mirror_enabled ?? null,
    ],
  );
  return result.rows[0];
}

/**
 * 조직 이름을 `org_id`로 옮긴다 (CR-016, DEV-052).
 *
 * 검색 문서는 `org_id`를 숫자로만 갖는다 — 조직 **이름**이 없다. 사용자는
 * `org:acme`처럼 이름으로 묻으므로 그 사이를 레지스트리가 잇는다. 문서에
 * 이름을 넣어 재색인하지 않는 이유는 그 이름의 주인이 여기이고, 조직명이
 * 바뀌면 문서 전량을 다시 써야 하기 때문이다.
 *
 * 한 `owner`가 여러 `org_id`를 갖는 일은 없다 — `(owner, name)`이 유일하고
 * 같은 owner의 저장소는 같은 조직에 속한다. `DISTINCT`로 그것을 강제한다.
 *
 * 찾지 못한 이름은 결과에 담기지 않는다. 호출 측이 그 사실을 사용자에게
 * 알린다 — 조용히 0건을 내지 않기 위해서다.
 */
export async function resolveOrgIds(db: Queryable, owners: readonly string[]): Promise<Map<string, number>> {
  if (owners.length === 0) return new Map();

  const { rows } = await db.query<{ owner: string; org_id: number }>(
    'SELECT DISTINCT owner, org_id FROM repository WHERE owner = ANY($1::text[])',
    [[...owners]],
  );
  return new Map(rows.map((row) => [row.owner, row.org_id]));
}

/**
 * 저장소를 볼 수 있는 팀을 갈아 끼운다 (WP-068 / CR-035, DEV-114).
 *
 * **등록·갱신과 분리된 함수다.** `upsertRepository`에 넣으면 팀을 모르는 호출
 * (시험 픽스처, 시퀀스 브랜치만 바꾸는 갱신)이 기존 팀을 지운다 — 권한을
 * 모르는 호출이 권한을 비우는 일이 없어야 한다.
 *
 * @returns 값이 실제로 바뀌었으면 `true`. 색인 소급 적용은 그때만 돌린다 —
 * 같은 값으로 `update_by_query`를 돌리면 문서를 헛되이 다시 쓴다.
 */
export async function setAllowedTeams(
  db: Queryable,
  repositoryId: number,
  teamIds: readonly number[],
): Promise<boolean> {
  // 정렬·중복 제거해 저장한다 — 순서만 다른 값이 "바뀌었다"로 읽히지 않게.
  const normalized = [...new Set(teamIds)].sort((a, b) => a - b);
  const result = await db.query(
    `UPDATE repository
        SET allowed_team_ids = $2
      WHERE repository_id = $1 AND allowed_team_ids IS DISTINCT FROM $2::bigint[]`,
    [repositoryId, normalized],
  );
  return (result.rowCount ?? 0) > 0;
}

/** 이 팀을 볼 수 있는 저장소들. 팀 변경의 소급 적용 대상이다. */
export async function findRepositoriesForTeam(
  db: Queryable,
  teamId: number,
): Promise<readonly RepositoryRow[]> {
  const result = await db.query<RepositoryRow>(
    'SELECT * FROM repository WHERE allowed_team_ids @> ARRAY[$1]::bigint[]',
    [teamId],
  );
  return result.rows;
}

/**
 * 정본 스냅숏 부트스트랩 완료를 기록한다 (CR-037, DEV-194).
 *
 * 이 시점 이후 `pull_request_snapshot`은 그 저장소의 PR 전량을 담고 있다고
 * 본다 — 정합성 감시가 `extra_in_es`와 `snapshot_bootstrap_pending`을 가르는
 * 근거다.
 */
export async function markSnapshotBootstrapped(
  db: Queryable,
  repositoryId: number,
  at: Date,
): Promise<void> {
  await db.query('UPDATE repository SET snapshot_bootstrapped_at = $2 WHERE repository_id = $1', [
    repositoryId,
    at,
  ]);
}

/** 아직 부트스트랩되지 않은 활성 저장소. 조정 스캔이 한 주기에 일부씩 집는다. */
export async function listSnapshotBootstrapPending(
  db: Queryable,
  limit: number,
): Promise<readonly RepositoryRow[]> {
  const result = await db.query<RepositoryRow>(
    `SELECT * FROM repository
      WHERE snapshot_bootstrapped_at IS NULL AND status = 'active'
      ORDER BY repository_id
      LIMIT $1`,
    [limit],
  );
  return result.rows;
}
