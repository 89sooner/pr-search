/**
 * 저장된 검색 리포지터리 (ENT-CORE-006 / WP-033, CR-049).
 *
 * ## 여기가 소유하는 것
 *
 * 이 자원의 접근 규칙은 **질의 안에 있다.** 라우트가 "소유자인가"를 판정하고
 * 리포지터리가 그것을 믿는 구조로 만들지 않는다 — 그러면 새 경로가 생길 때마다
 * 빠뜨릴 자리가 하나씩 늘어난다. 조회·수정·삭제·실행 넷이 각자의 SQL에 권한
 * 조건을 담고, 조건에 맞지 않으면 **행이 없는 것과 같은 답**을 준다.
 *
 * ## 검사와 쓰기 사이에 창을 남기지 않는다 (CR-049, DEV-344)
 *
 * `READ COMMITTED`에서 문장마다 스냅숏이 새로 잡힌다. 그래서 한 트랜잭션
 * 안이라도 "구성원인가"를 읽은 뒤 커밋된 탈퇴를 `INSERT`가 보지 못한다 —
 * 이탈한 사람이 그 팀에 공유하는 행을 만들 수 있다. 두 자리에서 잠근다:
 *
 *   - 소유자 행을 `FOR UPDATE` — 100건 상한을 세는 동안 다른 요청이 끼어들지
 *     못한다 (DEV-336). `count` 뒤 `INSERT`는 99건 상태의 동시 요청 둘을
 *     101건으로 만든다.
 *   - `team_member` 행을 `FOR SHARE` — 그 행을 지우려는 트랜잭션이 이쪽 커밋을
 *     기다린다. 반대로 삭제가 먼저 커밋했다면 이쪽 `SELECT`가 그것을 보고
 *     거절한다. 어느 순서든 결과가 일관된다.
 *
 * ## 대상 팀은 `team_id`다
 *
 * slug은 `(org_id, slug)`에서만 유일하다 (DEV-331). 이름으로 판정하면 같은
 * 이름의 다른 조직 팀으로 공유가 샌다. `slug`·`org_id`는 화면이 사람에게
 * 보여 주기 위해 함께 실어 보낼 뿐 정체성이 아니다.
 */

import type { Pool, PoolClient } from 'pg';
import { withTransaction } from '../pool.js';

type Queryable = Pool | PoolClient;

export type SavedSearchVisibility = 'private' | 'team';

/** 사용자 1인당 저장 개수 상한 (FR-SRCH-010 AC-4). */
export const SAVED_SEARCH_LIMIT = 100;

export interface SavedSearchRow {
  readonly saved_search_id: number;
  readonly owner_user_id: string;
  readonly owner_login: string;
  readonly name: string;
  readonly query: string;
  readonly visibility: SavedSearchVisibility;
  /** `visibility`가 `team`일 때만 값이 있다 — 마이그레이션 015가 강제한다. */
  readonly team_id: number | null;
  readonly team_slug: string | null;
  readonly team_org_id: number | null;
  /**
   * ISO 8601 UTC, **마이크로초까지**.
   *
   * `Date`로 받지 않는다. `node-postgres`의 timestamptz 파서는 `Date`를 주고
   * `Date`는 밀리초 정밀도라 `12:00:00.123456`이 `12:00:00.123`이 된다. 그 값을
   * 커서에 실으면 같은 밀리초 안의 아직 내주지 않은 행이 키셋 비교에서
   * **누락된다** — 조사 도구에서 조용한 오답이다. 문자열로 받아 그대로 다시
   * 넘기면 PostgreSQL이 자기가 준 값을 그대로 파싱한다.
   */
  readonly created_at: string;
  readonly last_run_at: string | null;
}

/**
 * 목록 커서가 가리키는 위치.
 *
 * 정렬이 `created_at DESC, saved_search_id DESC`로 고정돼 있으므로 키셋도 그
 * 쌍이다. `created_at`만으로는 같은 밀리초에 만들어진 두 행에서 순회가 갈린다.
 */
export interface SavedSearchKeyset {
  /** `SavedSearchRow.created_at`이 준 값 그대로. 정밀도를 재가공하지 않는다. */
  readonly createdAt: string;
  readonly savedSearchId: number;
}

/** 공유 대상으로 고를 수 있는 팀 (API-SRCH-005 `/share-targets`). */
export interface ShareTargetTeam {
  readonly team_id: number;
  readonly org_id: number;
  readonly slug: string;
}

export interface CreateSavedSearchInput {
  /** 세션이 정한다. 요청 본문에서 받지 않는다. */
  readonly ownerUserId: string;
  readonly name: string;
  readonly query: string;
  readonly visibility: SavedSearchVisibility;
  /** `visibility`가 `team`일 때 필수. */
  readonly teamId?: number | null;
}

export type CreateSavedSearchOutcome =
  | { readonly kind: 'created'; readonly row: SavedSearchRow }
  | { readonly kind: 'limit_reached'; readonly limit: number }
  | { readonly kind: 'name_conflict' }
  | { readonly kind: 'not_team_member'; readonly teamId: number };

export interface UpdateSavedSearchInput {
  readonly name?: string;
  readonly query?: string;
  readonly visibility?: SavedSearchVisibility;
  readonly teamId?: number | null;
}

export type UpdateSavedSearchOutcome =
  | { readonly kind: 'updated'; readonly row: SavedSearchRow }
  /** 없거나, 볼 수 없거나, 내 것이 아니다 — 셋을 구분해 답하지 않는다. */
  | { readonly kind: 'not_found' }
  | { readonly kind: 'name_conflict' }
  | { readonly kind: 'not_team_member'; readonly teamId: number };

/**
 * 공통 SELECT.
 *
 * `team`은 `LEFT JOIN`이다 — `private` 행에는 대상이 없고, 그것이 결함이 아니라
 * 정상이다. `app_user`는 `INNER JOIN`이다: 외래 키가 소유자의 존재를 보증한다.
 */
const SELECT_COLUMNS = `
  s.saved_search_id,
  s.owner_user_id,
  u.login       AS owner_login,
  s.name,
  s.query,
  s.visibility,
  s.team_id,
  t.slug        AS team_slug,
  t.org_id      AS team_org_id,
  to_char(s.created_at  AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.USZ') AS created_at,
  to_char(s.last_run_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.USZ') AS last_run_at`;

const FROM_JOINED = `
  FROM saved_search s
  JOIN app_user u ON u.user_id = s.owner_user_id
  LEFT JOIN team t ON t.team_id = s.team_id`;

/**
 * 내가 이 행을 읽고 실행할 수 있는가.
 *
 * 소유자이거나, `team` 공개이면서 **지금** 그 팀의 구성원이거나. 구성원 자격을
 * 저장해 두지 않고 매번 `team_member`에 묻는 것이 요점이다 — 회수는 그 표에서
 * 일어나고 (WP-068) 이 자원은 그것을 알 방법이 없다.
 */
const VISIBLE_PREDICATE = `(
  s.owner_user_id = $USER$
  OR (
    s.visibility = 'team'
    AND EXISTS (SELECT 1 FROM team_member m WHERE m.team_id = s.team_id AND m.user_id = $USER$)
  )
)`;

function visibleTo(userParam: string): string {
  return VISIBLE_PREDICATE.replaceAll('$USER$', userParam);
}

const UNIQUE_VIOLATION = '23505';
const SAVED_SEARCH_NAME_UK = 'saved_search_owner_user_id_name_key';

function isNameConflict(error: unknown): boolean {
  const shape = error as { code?: string; constraint?: string };
  if (shape.code !== UNIQUE_VIOLATION) return false;
  /*
   * 제약 이름을 확인한다. `saved_search`에 유니크가 하나뿐인 지금은 코드만 봐도
   * 같은 결론이지만, 나중에 하나 더 생기면 **다른 충돌이 이름 충돌로 보고된다.**
   */
  return shape.constraint === undefined || shape.constraint === SAVED_SEARCH_NAME_UK;
}

/**
 * 이 사용자가 지금 그 팀의 구성원인지 확인하고 **그 사실을 커밋까지 붙잡는다.**
 *
 * `FOR SHARE`가 핵심이다 (DEV-344). 잠그지 않으면 이 `SELECT`와 뒤따르는 쓰기
 * 사이에 커밋된 탈퇴를 쓰기가 보지 못한다 — `READ COMMITTED`에서 문장마다
 * 스냅숏이 새로 잡히기 때문이다.
 *
 * `team_member` 한 표만 잠근다. 조인하면 잠글 행이 늘어나고, 여기서 필요한
 * 것은 "이 사람의 이 팀 소속"이라는 사실 하나뿐이다.
 */
async function holdsMembership(client: PoolClient, teamId: number, userId: string): Promise<boolean> {
  const { rowCount } = await client.query(
    'SELECT 1 FROM team_member WHERE team_id = $1 AND user_id = $2 FOR SHARE',
    [teamId, userId],
  );
  return (rowCount ?? 0) > 0;
}

async function loadById(db: Queryable, savedSearchId: number): Promise<SavedSearchRow> {
  const { rows } = await db.query<SavedSearchRow>(
    `SELECT ${SELECT_COLUMNS} ${FROM_JOINED} WHERE s.saved_search_id = $1`,
    [savedSearchId],
  );
  const row = rows[0];
  if (row === undefined) throw new Error('저장된 검색을 다시 읽지 못했다');
  return row;
}

/**
 * 저장된 검색을 만든다 (API-SRCH-005 `POST`).
 *
 * 순서가 계약이다: 소유자 잠금 → 개수 → 구성원 자격 잠금 → 삽입. 앞의 둘이
 * 상한을(AC-4), 셋째가 공유 대상을(AC-1) 지킨다.
 */
export async function createSavedSearch(
  pool: Pool,
  input: CreateSavedSearchInput,
): Promise<CreateSavedSearchOutcome> {
  const teamId = input.visibility === 'team' ? (input.teamId ?? null) : null;
  if (input.visibility === 'team' && teamId === null) {
    throw new Error('team 공개 범위에는 대상 팀이 필요하다 (FR-SRCH-010 AC-1)');
  }

  return withTransaction(pool, async (client) => {
    /*
     * 소유자 행을 잠근다.
     *
     * 이 잠금이 없으면 99건 상태의 동시 요청 둘이 각각 "99 < 100"을 읽고
     * 101건을 만든다 (DEV-336). 여러 행에 걸친 개수는 `CHECK`로 막을 수 없다 —
     * PostgreSQL의 `CHECK`는 다른 행을 볼 수 없다.
     */
    const owner = await client.query('SELECT user_id FROM app_user WHERE user_id = $1 FOR UPDATE', [
      input.ownerUserId,
    ]);
    if ((owner.rowCount ?? 0) === 0) throw new Error(`사용자를 찾을 수 없다: ${input.ownerUserId}`);

    const counted = await client.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM saved_search WHERE owner_user_id = $1',
      [input.ownerUserId],
    );
    if (Number(counted.rows[0]?.count ?? '0') >= SAVED_SEARCH_LIMIT) {
      return { kind: 'limit_reached', limit: SAVED_SEARCH_LIMIT };
    }

    if (teamId !== null && !(await holdsMembership(client, teamId, input.ownerUserId))) {
      return { kind: 'not_team_member', teamId };
    }

    let savedSearchId: number;
    try {
      const inserted = await client.query<{ saved_search_id: number }>(
        `INSERT INTO saved_search (owner_user_id, name, query, visibility, team_id)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING saved_search_id`,
        [input.ownerUserId, input.name, input.query, input.visibility, teamId],
      );
      savedSearchId = inserted.rows[0]?.saved_search_id ?? 0;
    } catch (error) {
      if (isNameConflict(error)) return { kind: 'name_conflict' };
      throw error;
    }

    return { kind: 'created', row: await loadById(client, savedSearchId) };
  });
}

/**
 * 내가 볼 수 있는 한 건 (API-SRCH-005 `GET /{id}`).
 *
 * @returns 없거나 볼 수 없으면 `null`. **둘을 구분하지 않는다** — 구분하면
 * 그 ID의 검색이 존재한다는 사실이 새어 나간다 (THR-004와 같은 규율).
 */
export async function findVisibleSavedSearch(
  db: Queryable,
  savedSearchId: number,
  userId: string,
): Promise<SavedSearchRow | null> {
  const { rows } = await db.query<SavedSearchRow>(
    `SELECT ${SELECT_COLUMNS} ${FROM_JOINED}
      WHERE s.saved_search_id = $1 AND ${visibleTo('$2')}`,
    [savedSearchId, userId],
  );
  return rows[0] ?? null;
}

/**
 * 키셋 조건.
 *
 * 행 비교 `(created_at, saved_search_id) < ($1, $2)`는 정렬과 같은 순서라
 * 인덱스를 그대로 탄다. `created_at < $1 OR (created_at = $1 AND id < $2)`로
 * 풀어 쓰면 같은 뜻이지만 플래너가 인덱스를 덜 쓴다.
 */
function keysetClause(after: SavedSearchKeyset | null, first: number): string {
  if (after === null) return '';
  // `::timestamptz` 캐스팅이 문자열을 마이크로초까지 되돌린다.
  return ` AND (s.created_at, s.saved_search_id) < ($${String(first)}::timestamptz, $${String(first + 1)})`;
}

function keysetParams(after: SavedSearchKeyset | null): unknown[] {
  return after === null ? [] : [after.createdAt, after.savedSearchId];
}

const ORDER_AND_LIMIT = ' ORDER BY s.created_at DESC, s.saved_search_id DESC LIMIT ';

/**
 * 내가 소유한 것 (`view=mine`). `private`와 `team`을 함께 센다.
 *
 * `limit`은 **화면이 요청한 개수 그대로**다 — 다음 페이지 유무는 라우트가
 * `limit + 1`을 요청해 판정한다. 여기서 `+1`을 몰래 더하면 호출자가 받은
 * 개수와 화면에 그릴 개수가 어긋난다.
 */
export async function listOwnedSavedSearches(
  db: Queryable,
  userId: string,
  options: { readonly limit: number; readonly after?: SavedSearchKeyset | null },
): Promise<readonly SavedSearchRow[]> {
  const after = options.after ?? null;
  const { rows } = await db.query<SavedSearchRow>(
    `SELECT ${SELECT_COLUMNS} ${FROM_JOINED}
      WHERE s.owner_user_id = $1${keysetClause(after, 2)}${ORDER_AND_LIMIT}$${String(after === null ? 2 : 4)}`,
    [userId, ...keysetParams(after), options.limit],
  );
  return rows;
}

/**
 * 남이 소유하고 내가 구성원인 팀에 공유한 것 (`view=team`).
 *
 * **`owner_user_id <> $1`이 있어야 두 목록이 배타가 된다.** 내가 만든 `team`
 * 검색은 `mine`에 있고, 양쪽에 나타나면 사용자가 그것을 두 개로 읽는다.
 */
export async function listSharedSavedSearches(
  db: Queryable,
  userId: string,
  options: { readonly limit: number; readonly after?: SavedSearchKeyset | null },
): Promise<readonly SavedSearchRow[]> {
  const after = options.after ?? null;
  const { rows } = await db.query<SavedSearchRow>(
    `SELECT ${SELECT_COLUMNS} ${FROM_JOINED}
      WHERE s.visibility = 'team'
        AND s.owner_user_id <> $1
        AND EXISTS (SELECT 1 FROM team_member m WHERE m.team_id = s.team_id AND m.user_id = $1)
        ${keysetClause(after, 2)}${ORDER_AND_LIMIT}$${String(after === null ? 2 : 4)}`,
    [userId, ...keysetParams(after), options.limit],
  );
  return rows;
}

/**
 * 수정 (API-SRCH-005 `PATCH`). **저장자만** 한다 (AC-2).
 *
 * 최종 상태가 `team`이면 그 대상 팀의 구성원 자격을 다시 확인한다 (AC-7) —
 * 이탈한 사람이 그 팀의 공유 자산을 계속 바꾸게 두지 않는다. `private`으로
 * 바꾸는 것과 삭제는 언제나 된다.
 */
export async function updateSavedSearch(
  pool: Pool,
  savedSearchId: number,
  ownerUserId: string,
  patch: UpdateSavedSearchInput,
): Promise<UpdateSavedSearchOutcome> {
  return withTransaction(pool, async (client) => {
    /*
     * 소유 행을 잠근다. 같은 행에 대한 동시 수정이 서로의 최종 상태를 덮지
     * 않게 하고, 아래의 구성원 자격 확인과 갱신을 같은 트랜잭션에 묶는다.
     */
    const current = await client.query<{
      visibility: SavedSearchVisibility;
      team_id: number | null;
    }>(
      `SELECT visibility, team_id FROM saved_search
        WHERE saved_search_id = $1 AND owner_user_id = $2 FOR UPDATE`,
      [savedSearchId, ownerUserId],
    );
    const before = current.rows[0];
    if (before === undefined) return { kind: 'not_found' };

    const visibility = patch.visibility ?? before.visibility;
    /*
     * 최종 대상 팀.
     *
     * `private`이면 대상을 **지운다** — 남겨 두면 마이그레이션 015의 불변식이
     * 거절하고, 그 거절은 사용자가 고칠 수 없는 오류로 보인다.
     */
    const teamId =
      visibility === 'private' ? null : (patch.teamId ?? before.team_id ?? null);
    if (visibility === 'team' && teamId === null) {
      throw new Error('team 공개 범위에는 대상 팀이 필요하다 (FR-SRCH-010 AC-1)');
    }

    /*
     * **최종 상태가 `team`이면 언제나 확인한다** — 대상을 바꾸지 않는 수정도
     * 포함한다 (AC-7). 이름만 고치는 요청이라도 그 사람이 이미 그 팀에서
     * 이탈했다면 그것은 더 이상 그의 공유 자산이 아니다.
     */
    if (teamId !== null && !(await holdsMembership(client, teamId, ownerUserId))) {
      return { kind: 'not_team_member', teamId };
    }

    try {
      await client.query(
        `UPDATE saved_search
            SET name       = COALESCE($3, name),
                query      = COALESCE($4, query),
                visibility = $5,
                team_id    = $6
          WHERE saved_search_id = $1 AND owner_user_id = $2`,
        [
          savedSearchId,
          ownerUserId,
          patch.name ?? null,
          patch.query ?? null,
          visibility,
          teamId,
        ],
      );
    } catch (error) {
      if (isNameConflict(error)) return { kind: 'name_conflict' };
      throw error;
    }

    return { kind: 'updated', row: await loadById(client, savedSearchId) };
  });
}

/**
 * 삭제 (API-SRCH-005 `DELETE`). **저장자만** 한다.
 *
 * 대상 팀에서 이탈했어도 삭제는 된다 (AC-7) — 자기 자산을 치우는 일을 막을
 * 이유가 없다.
 *
 * @returns 지웠으면 `true`. 없거나 내 것이 아니면 `false` — 둘을 구분하지 않는다.
 */
export async function deleteSavedSearch(
  db: Queryable,
  savedSearchId: number,
  ownerUserId: string,
): Promise<boolean> {
  const { rowCount } = await db.query(
    'DELETE FROM saved_search WHERE saved_search_id = $1 AND owner_user_id = $2',
    [savedSearchId, ownerUserId],
  );
  return (rowCount ?? 0) > 0;
}

/**
 * 실행 시각을 찍는다 (API-SRCH-005 `POST /{id}/run`).
 *
 * **갱신 문장 자체가 권한 조건을 다시 건다.** 읽기와 갱신 사이에 팀 구성이
 * 바뀔 수 있고, 그 창에서 회수된 사람이 "마지막으로 실행한 사람"으로 기록되면
 * 그 기록이 거짓이 된다. 조건에 맞는 행이 없으면 `null`이고 라우트가 404로
 * 옮긴다.
 *
 * 시각은 **DB의 `now()`**다. 앱 시계가 복제본마다 다르면 목록 정렬이 흔들린다.
 */
export async function markSavedSearchRun(
  db: Queryable,
  savedSearchId: number,
  userId: string,
): Promise<SavedSearchRow | null> {
  const { rows } = await db.query<{ saved_search_id: number }>(
    `UPDATE saved_search s
        SET last_run_at = now()
      WHERE s.saved_search_id = $1 AND ${visibleTo('$2')}
      RETURNING s.saved_search_id`,
    [savedSearchId, userId],
  );
  if (rows[0] === undefined) return null;
  return loadById(db, savedSearchId);
}

/**
 * 공유 대상으로 고를 수 있는 팀 (API-SRCH-005 `/share-targets`).
 *
 * 정본은 `team`·`team_member`다. **GHE를 부르지 않는다** — 저장 대화상자
 * 하나가 외부 의존을 타면 GHE가 느릴 때 저장 자체가 막힌다.
 *
 * 정렬은 `(org_id, slug, team_id)`다. 같은 이름이 여러 조직에 있으면 화면이
 * 조직으로 구분해 보여 주며, 순서가 결정론이어야 그 목록이 요청마다 흔들리지
 * 않는다.
 */
export async function listTeamsForUser(db: Queryable, userId: string): Promise<readonly ShareTargetTeam[]> {
  const { rows } = await db.query<ShareTargetTeam>(
    `SELECT t.team_id, t.org_id, t.slug
       FROM team_member m
       JOIN team t ON t.team_id = m.team_id
      WHERE m.user_id = $1
      ORDER BY t.org_id, t.slug, t.team_id`,
    [userId],
  );
  return rows;
}

/** 소유한 저장 검색 개수. 상한 판정의 사후 확인과 시험이 쓴다. */
export async function countOwnedSavedSearches(db: Queryable, userId: string): Promise<number> {
  const { rows } = await db.query<{ count: string }>(
    'SELECT count(*)::text AS count FROM saved_search WHERE owner_user_id = $1',
    [userId],
  );
  return Number(rows[0]?.count ?? '0');
}
