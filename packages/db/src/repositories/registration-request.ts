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
 * ## 승인·반려를 만들지 않는다
 *
 * 운영자가 이 요청을 처리하는 경로는 A-002를 세우는 WP-040의 몫이다. 지금
 * 상태 열을 미리 만들면 검증되지 않은 수명주기를 스키마가 선점하고, 그것은
 * "표는 있는데 뜻이 정해지지 않은 열"이 된다 — CR-049가 `saved_search.team_id`
 * 에서 겪은 바로 그 상태다.
 */

import type { Pool, PoolClient } from 'pg';

type Queryable = Pool | PoolClient;

export interface RegistrationRequestRow {
  readonly request_id: number;
  readonly requested_by: string;
  readonly repository_owner: string;
  readonly repository_name: string;
  readonly created_at: Date;
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
