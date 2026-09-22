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
  /**
   * 최근 **완료된** 조정 스캔의 시각과 누락 건수 (WP-034 / CR-050, DEV-352).
   *
   * 둘이 함께 `null`이면 "완료된 조정 스캔 기록이 없다"이고, 건수 `0`은
   * "확인했고 누락이 없다"이다. **미룬 회차(`deferred`)는 이 값을 덮지
   * 않는다** — 한도 소진으로 창을 끝까지 읽지 못한 회차의 부분 집계는
   * 언제나 실제보다 작고, 그것을 "최근 결과"로 보이면 사용자는 "거의 다
   * 수집됐다"로 읽는다.
   */
  readonly last_reconciled_at: Date | null;
  readonly last_reconcile_missing_count: number | null;
  /**
   * PR 제목에 M 넘버를 표기할 대상인가 (WP-075 / FR-SEQ-009 AC-6, 마이그레이션 026).
   *
   * **운영자가 적어 낸 값이다.** 이 제품은 오류를 만났다고 이 값을 바꾸지 않는다 —
   * 그것은 아래 `annotate_blocked_at`이 따로 기록한다. 꺼진 저장소는 채번은 계속하고
   * 표기만 멈춘다.
   */
  readonly annotate_enabled: boolean;
  /**
   * 표기 잡이 GHE 권한 오류를 받아 **스스로** 멈춘 시각과 사유.
   *
   * 운영자 정책과 분리해 두는 이유는 둘이 다른 사실이기 때문이다. 한 열에 담으면
   * 권한 오류 한 번이 운영자의 설정을 조용히 뒤집고, 권한이 복구된 뒤에도 운영자는
   * 자기가 켜 둔 저장소가 왜 꺼져 있는지 알 수 없다.
   */
  readonly annotate_blocked_at: Date | null;
  readonly annotate_blocked_reason: string | null;
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

/**
 * 저장소 코드가 `code`인 활성 저장소 (CR-114 / FR-SRCH-001 AC-7).
 *
 * 저장소 코드는 이름의 **유일한** 연속 숫자 run이다(OD-009, `repositoryCodeOf`).
 * 정규식 `^[^0-9]*<code>[^0-9]*$`가 그 정의를 SQL로 옮긴 것이다 — 숫자 run이 둘인
 * 이름(`app1900v2`)은 걸리지 않고, 선행 0은 그대로 대조된다(`app007`은 `007`에만
 * 걸리고 `7`에는 걸리지 않는다). `code`는 호출부가 숫자만으로 검증한 값이어야
 * 하며 여기서 다시 확인해 정규식에 다른 문자가 들어가지 않게 한다. 접근 범위는
 * 호출부가 건다 — 이 함수는 접근 통제를 모른다.
 */
export async function listActiveRepositoriesByCode(db: Queryable, code: string): Promise<RepositoryRow[]> {
  if (!/^[0-9]+$/.test(code)) return [];
  const result = await db.query<RepositoryRow>(
    `SELECT * FROM repository
      WHERE status = 'active' AND name ~ ('^[^0-9]*' || $1 || '[^0-9]*$')
      ORDER BY owner, name`,
    [code],
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
  /** FR-SEQ-009 AC-6. 운영자가 저장소별로 표기를 해제한다 (WP-075). */
  readonly annotate_enabled?: boolean;
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
            mirror_enabled    = COALESCE($3, mirror_enabled),
            annotate_enabled  = COALESCE($4, annotate_enabled)
      WHERE repository_id = $1
      RETURNING *`,
    [
      repositoryId,
      settings.sequence_branches === undefined ? null : [...settings.sequence_branches],
      settings.mirror_enabled ?? null,
      settings.annotate_enabled ?? null,
    ],
  );
  return result.rows[0];
}

/**
 * 표기 잡이 이 저장소에서 스스로 멈춘 사실을 남긴다 (WP-075 / FR-SEQ-009 예외 처리).
 *
 * **`annotate_enabled`를 건드리지 않는다.** 권한 오류는 운영자의 결정이 아니므로
 * 운영자가 적어 낸 값을 뒤집을 근거가 되지 못한다. 차단은 프로세스가 다시 떠도
 * 유지되어야 하므로 메모리가 아니라 여기 남는다 — 재시작마다 권한 없는 저장소에
 * 다시 요청하면 `FR-SEQ-009`가 막으려던 한도 소모가 그대로 일어난다.
 *
 * 같은 사유로 다시 부르면 시각만 미뤄진다. 쿨다운은 마지막 차단 시각부터 센다.
 */
export async function blockAnnotation(db: Queryable, repositoryId: number, reason: string): Promise<void> {
  await db.query(
    `UPDATE repository
        SET annotate_blocked_at = now(), annotate_blocked_reason = $2
      WHERE repository_id = $1`,
    // 제약이 200자다. GHE 오류 본문이 그대로 들어오지 않도록 여기서도 자른다.
    [repositoryId, reason.slice(0, 200)],
  );
}

/** 차단을 푼다. 쿨다운이 지나 다시 시도할 때와 성공했을 때 부른다. */
export async function clearAnnotationBlock(db: Queryable, repositoryId: number): Promise<void> {
  await db.query(
    `UPDATE repository
        SET annotate_blocked_at = NULL, annotate_blocked_reason = NULL
      WHERE repository_id = $1 AND annotate_blocked_at IS NOT NULL`,
    [repositoryId],
  );
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
 * 등록된 조직 전부 (WP-069 / CR-058).
 *
 * 조직 팀 동기화가 무엇을 훑을지 정하는 목록이다. **보관된 저장소만 남은 조직도
 * 담는다** — 그 저장소의 과거 PR이 여전히 검색되고 집계되므로 작성자 팀도
 * 답해야 한다. 조직 하나가 여러 `owner`를 갖는 일은 없어 `DISTINCT`가 짝을
 * 하나로 만든다.
 */
export async function listRegisteredOrgs(
  db: Queryable,
): Promise<readonly { readonly orgId: number; readonly owner: string }[]> {
  const { rows } = await db.query<{ owner: string; org_id: string }>(
    'SELECT DISTINCT org_id, owner FROM repository ORDER BY org_id',
  );
  return rows.map((row) => ({ orgId: Number(row.org_id), owner: row.owner }));
}

/**
 * `org_id` → `owner` (WP-037 / CR-053, PR #76 리뷰 P1).
 *
 * 집계는 `org_id`로 묶고 사용자는 `org:acme`로 묻는다. **그 숫자를 그대로
 * 근거 질의에 넣으면 `org:77`이 되어 아무 저장소도 찾지 못한다** — 버킷은
 * 건수를 보이는데 눌러 보면 0건인 자리다.
 *
 * `resolveOrgIds`의 역방향이며 같은 표를 본다. 한 조직이 여러 `owner`를 갖는
 * 일은 없으므로 `DISTINCT`로 하나를 취한다.
 */
export async function resolveOrgOwners(
  db: Queryable,
  orgIds: readonly number[],
): Promise<Map<number, string>> {
  if (orgIds.length === 0) return new Map();

  const { rows } = await db.query<{ owner: string; org_id: number }>(
    'SELECT DISTINCT org_id, owner FROM repository WHERE org_id = ANY($1::bigint[])',
    [[...orgIds]],
  );
  return new Map(rows.map((row) => [Number(row.org_id), row.owner]));
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

/**
 * 최근 **완료된** 조정 결과를 기록한다 (WP-034 / FR-ING-011 AC-6, CR-050 DEV-352).
 *
 * **완주한 회차만 부른다.** 한도 소진으로 미룬 회차(`ReconcileResult.deferred`)와
 * 예외로 끝난 회차는 이 함수를 부르지 않는다 — 그 회차의 집계는 창을 끝까지
 * 읽지 못한 부분값이라 **언제나 실제보다 작고**, 최근 결과로 표시되면 사용자는
 * "거의 다 수집됐다"로 읽는다. W-009의 목적이 정확히 그 오독을 막는 것이다.
 *
 * `reconcile_missing_total` 지표를 대체하지 않는다 — 누적 counter는 운영 추세를,
 * 이 열은 사용자 진단 시점의 상태를 나타내며 책임이 다르다.
 */
export async function recordCompletedReconciliation(
  db: Queryable,
  repositoryId: number,
  missingCount: number,
  completedAt: Date,
): Promise<void> {
  await db.query(
    `UPDATE repository
        SET last_reconciled_at = $2, last_reconcile_missing_count = $3
      WHERE repository_id = $1`,
    [repositoryId, completedAt, missingCount],
  );
}

/** W-009 목록의 키셋 위치. 정렬 키 셋과 같은 순서다. */
export interface RepositoryKeyset {
  readonly owner: string;
  readonly name: string;
  readonly repositoryId: number;
}

export interface OverviewPageFilter {
  /** `owner/name` 완전 일치. 진단 딥링크와 카드 단위 재시도가 쓴다. */
  readonly slug?: { readonly owner: string; readonly name: string };
  readonly after?: RepositoryKeyset;
}

/**
 * W-009 목록 한 페이지 (API-ING-002 / WP-034, CR-050).
 *
 * **`status`로 거르지 않는다** (FR-ING-009 AC-7). 해제된 저장소도 접근 범위
 * 안이면 등록 상태와 함께 보여 준다 — 해제는 신규 수집 중단이고 기존 문서는
 * 남으므로(AC-3), 그 사실 자체가 사용자가 찾던 답이다. 조용히 숨기면 사용자는
 * "등록된 적이 없다"로 오인한다.
 *
 * **접근 범위는 여기서 거르지 않는다.** 이 함수는 페이지 후보를 정렬 순서대로
 * 줄 뿐이고, 판정은 `isRepositoryInScope`가 한 곳에서 한다 — 규칙을 둘로
 * 나누면 한쪽만 고쳐지는 자리가 생긴다 (`resolveRepository`와 같은 구조).
 * 그래서 호출자는 `limit`보다 넉넉히 읽어 거른 뒤 잘라야 한다.
 *
 * 정렬은 `owner, name, repository_id`다. 세 번째 키가 동률을 깬다 — 앞의 둘에
 * UNIQUE가 걸려 있어도 정렬 안정성을 계약으로 보장하려면 결정론적 tiebreak가
 * 필요하고, 커서가 그 세 값을 그대로 되짚는다.
 */
export async function listRepositoryOverviewPage(
  db: Queryable,
  filter: OverviewPageFilter,
  limit: number,
): Promise<readonly RepositoryRow[]> {
  const params: unknown[] = [];
  const where: string[] = [];

  if (filter.slug !== undefined) {
    params.push(filter.slug.owner, filter.slug.name);
    where.push(`owner = $${String(params.length - 1)} AND name = $${String(params.length)}`);
  }
  if (filter.after !== undefined) {
    params.push(filter.after.owner, filter.after.name, filter.after.repositoryId);
    const n = params.length;
    where.push(
      `(owner, name, repository_id) > ($${String(n - 2)}, $${String(n - 1)}, $${String(n)})`,
    );
  }
  params.push(limit);

  const clause = where.length === 0 ? '' : ` WHERE ${where.join(' AND ')}`;
  const result = await db.query<RepositoryRow>(
    `SELECT * FROM repository${clause}
      ORDER BY owner, name, repository_id
      LIMIT $${String(params.length)}`,
    params,
  );
  return result.rows;
}
