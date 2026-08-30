/**
 * 저장소 등록 검토 요청 (ENT-CORE-008 / FR-ING-009 AC-8·9·10, WP-034 / CR-050).
 *
 * ## 행 하나가 뜻하는 것
 *
 * **"이 사용자가 이 식별자의 등록 검토를 요청했다"뿐이다.** 저장소가 실제로
 * 존재한다는 뜻도, 요청자가 그것을 볼 수 있다는 뜻도 아니다 — 기록 시점에
 * GitHub Enterprise에 묻지 않기 때문이다. 그래서 `repository_id`도 `org_id`도
 * `visibility`도 이 표에 없다. 묻는 순간 이 경로가 비공개 저장소의 존재
 * 신탁이 된다 (AC-10, THR-004·THR-041).
 *
 * ## 처리 상태는 운영자 평면의 것이다 (CR-055, DEV-428)
 *
 * `pending` · `fulfilled` · `dismissed` 셋뿐이며 **그 사이에 승인 상태를 두지
 * 않는다** (FR-ING-009 AC-11). 등록되지 않은 채 승인된 행은 아무것도 보장하지
 * 못하므로 승인은 성공한 등록 그 자체다.
 *
 * **이 열들은 요청자에게 가지 않는다.** `API-ING-003`이 쓰는 `toRequestView`가
 * 세 필드를 명시적으로 고르는 허용 목록이라 열이 늘어도 새어 나가지 않는다 —
 * 행을 그대로 펼치는 형태로 바꾸지 마라. 사유가 돌아가면 `dismissed`의 이유가
 * 곧 "그 저장소는 없다"의 답이 된다 (AC-10, THR-045).
 */

import type { Pool, PoolClient } from 'pg';

type Queryable = Pool | PoolClient;

/** 처리 상태 (FR-ING-009 AC-11). 마이그레이션 020의 CHECK와 같은 셋이다. */
export type RegistrationRequestStatus = 'pending' | 'fulfilled' | 'dismissed';

export interface RegistrationRequestRow {
  readonly request_id: number;
  readonly requested_by: string;
  readonly repository_owner: string;
  readonly repository_name: string;
  readonly created_at: Date;
  readonly status: RegistrationRequestStatus;
  readonly resolved_at: Date | null;
  readonly resolved_by: string | null;
  readonly resolution_note: string | null;
}

export interface RegistrationRequestInput {
  readonly requestedBy: string;
  readonly owner: string;
  readonly name: string;
}

/**
 * 요청을 기록하고, 이미 있으면 그것을 그대로 돌려준다 (AC-9).
 *
 * **자연 멱등이다.** 같은 사용자의 같은 식별자 반복 요청은 실패가 아니며 새
 * 행도 만들지 않는다 — 별도의 중복 오류 코드를 만들지 않는 이유는 사용자가
 * 두 번 눌렀다는 것이 오류가 아니기 때문이다.
 *
 * `DO NOTHING` 대신 값이 바뀌지 않는 `DO UPDATE`를 쓴다. `DO NOTHING`은
 * 충돌 시 아무 행도 돌려주지 않아 다시 `SELECT` 해야 하는데, **동시 요청이
 * 겹치면 그 `SELECT`가 아직 커밋되지 않은 행을 보지 못해** 사용자에게 오류가
 * 간다. `DO UPDATE`는 충돌한 행에 잠금을 잡고 그것을 돌려주므로 한 왕복으로
 * 끝나며, `created_at`은 손대지 않아 **최초 요청 시각이 보존된다.**
 *
 * **종료된 요청을 다시 열지 않는다** (CR-055, FR-ING-009 AC-11). `SET`이
 * `requested_by`만 건드리므로 `status`·`resolved_at`·`resolved_by`·
 * `resolution_note`는 그대로 남는다 — 운영자의 처리 결과를 보지도 못하는 일반
 * 사용자의 반복 호출 하나가 그것을 조용히 되돌리면 안 된다. 이 성질은 이제
 * 계약이므로 `SET`에 다른 열을 더하지 마라.
 */
export async function recordRequest(
  db: Queryable,
  input: RegistrationRequestInput,
): Promise<RegistrationRequestRow> {
  const result = await db.query<RegistrationRequestRow>(
    `INSERT INTO repository_registration_request (requested_by, repository_owner, repository_name)
     VALUES ($1, $2, $3)
     ON CONFLICT (requested_by, repository_owner, repository_name)
       DO UPDATE SET requested_by = EXCLUDED.requested_by
     RETURNING *`,
    [input.requestedBy, input.owner, input.name],
  );
  const row = result.rows[0];
  if (row === undefined) {
    // `RETURNING`이 있는 upsert는 언제나 한 행을 준다. 오면 그것은 계약 위반이다.
    throw new Error('등록 요청 기록이 행을 돌려주지 않았다');
  }
  return row;
}

/** 한 사용자가 남긴 요청. 화면이 "이미 요청했다"를 표시할 때 쓴다. */
export async function listRequestsByUser(
  db: Queryable,
  userId: string,
  limit = 100,
): Promise<readonly RegistrationRequestRow[]> {
  const result = await db.query<RegistrationRequestRow>(
    `SELECT * FROM repository_registration_request
      WHERE requested_by = $1
      ORDER BY created_at DESC, request_id DESC
      LIMIT $2`,
    [userId, limit],
  );
  return result.rows;
}

/** 운영자 대기열 필터 (API-ADM-009). 셋 다 선택이다. */
export interface RegistrationRequestFilter {
  readonly status?: RegistrationRequestStatus;
  readonly owner?: string;
  readonly name?: string;
  readonly requestedBy?: string;
}

/** 키셋 위치. 정렬 키를 그대로 담는다. */
export interface RegistrationRequestPosition {
  readonly createdAt: Date;
  readonly requestId: number;
}

/**
 * 운영자 대기열 한 페이지 (API-ADM-009).
 *
 * **정렬은 `created_at DESC, request_id DESC`로 결정론적이다.** `status`로
 * 정렬하지 않는 이유는 목록의 기본 필터가 그것을 이미 좁히기 때문이고, 정렬
 * 키에 상태를 넣으면 **상태가 바뀌는 순간 그 행이 커서 순회 안에서 움직인다.**
 *
 * `created_at` 하나로 자르지 않는다 — 같은 밀리초에 들어온 요청이 페이지
 * 경계에 걸리면 빠지거나 겹친다. 두 키를 함께 비교한다 (`API-ADM-005` 선례).
 *
 * @param limit 호출부가 `limit + 1`을 주어 다음 페이지 유무를 판정한다.
 */
export async function listRequestPage(
  db: Queryable,
  filter: RegistrationRequestFilter,
  limit: number,
  after?: RegistrationRequestPosition,
): Promise<readonly RegistrationRequestRow[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  const bind = (value: unknown): string => {
    params.push(value);
    return `$${String(params.length)}`;
  };

  if (filter.status !== undefined) conditions.push(`status = ${bind(filter.status)}`);
  if (filter.owner !== undefined) conditions.push(`repository_owner = ${bind(filter.owner)}`);
  if (filter.name !== undefined) conditions.push(`repository_name = ${bind(filter.name)}`);
  if (filter.requestedBy !== undefined) conditions.push(`requested_by = ${bind(filter.requestedBy)}`);
  if (after !== undefined) {
    conditions.push(`(created_at, request_id) < (${bind(after.createdAt)}, ${bind(after.requestId)})`);
  }

  const where = conditions.length === 0 ? '' : `WHERE ${conditions.join(' AND ')}`;
  const result = await db.query<RegistrationRequestRow>(
    `SELECT * FROM repository_registration_request
      ${where}
      ORDER BY created_at DESC, request_id DESC
      LIMIT ${bind(limit)}`,
    params,
  );
  return result.rows;
}

/** 단건 조회. `PATCH`가 전이 불가 사유를 말할 때 쓴다. */
export async function findRequestById(
  db: Queryable,
  requestId: number,
): Promise<RegistrationRequestRow | undefined> {
  const result = await db.query<RegistrationRequestRow>(
    'SELECT * FROM repository_registration_request WHERE request_id = $1',
    [requestId],
  );
  return result.rows[0];
}

/**
 * 요청을 등록 없이 종료한다 (API-ADM-009 `dismiss`).
 *
 * **`pending`일 때만 옮긴다.** 전이 조건을 `WHERE` 절에 두어야 데이터베이스가
 * 한 번에 판정한다 — 읽고 나서 쓰면 그 사이에 다른 운영자의 처리나 등록에 의한
 * 종료가 들어올 수 있고, 그때 이 호출이 남의 결과를 덮는다
 * (`finishJobIfRunning`이 배운 것과 같은 자리, DEV-196).
 *
 * @returns 옮겼으면 그 행. 이미 종료된 요청이거나 없으면 `undefined`이며,
 *   호출부가 현재 상태를 다시 읽어 400으로 옮긴다.
 */
export async function dismissRequest(
  db: Queryable,
  requestId: number,
  resolvedBy: string,
  note: string | null,
): Promise<RegistrationRequestRow | undefined> {
  const result = await db.query<RegistrationRequestRow>(
    `UPDATE repository_registration_request
        SET status = 'dismissed', resolved_at = now(), resolved_by = $2, resolution_note = $3
      WHERE request_id = $1 AND status = 'pending'
      RETURNING *`,
    [requestId, resolvedBy, note],
  );
  return result.rows[0];
}

/**
 * 한 식별자의 대기 중 요청을 **전부** 종료한다 (FR-ING-009 AC-11).
 *
 * 저장소 등록이 성공한 자리에서 부른다. **하나만 닫지 않는 이유**는 여러
 * 사용자가 같은 저장소를 요청했을 때 실제 등록 하나가 그 전부의 목적을
 * 충족하기 때문이다 — 남겨 두면 운영자의 대기열에 이미 해결된 항목이 쌓인다.
 *
 * **등록과 같은 트랜잭션 안에서 부른다.** 저장소가 `active`인데 그 식별자의
 * 요청이 `pending`으로 남는 상태를 성공한 등록 하나가 만들어서는 안 된다.
 * 그래서 인자가 `Pool`이 아니라 `Queryable`이다.
 *
 * `resolution_note`는 남기지 않는다 — 종료 사유는 "등록됐다"이고 그것은
 * `status`가 이미 말한다. 운영자가 손으로 적은 메모가 아닌 값을 그 칸에 넣으면
 * 사람이 쓴 것과 기계가 쓴 것이 섞인다.
 *
 * @returns 종료된 행들. 0건은 정상이다 — 요청 없이 등록할 수 있다.
 */
export async function fulfillPendingForSlug(
  db: Queryable,
  owner: string,
  name: string,
  resolvedBy: string,
): Promise<readonly RegistrationRequestRow[]> {
  const result = await db.query<RegistrationRequestRow>(
    `UPDATE repository_registration_request
        SET status = 'fulfilled', resolved_at = now(), resolved_by = $3
      WHERE repository_owner = $1 AND repository_name = $2 AND status = 'pending'
      RETURNING *`,
    [owner, name, resolvedBy],
  );
  return result.rows;
}
