/**
 * `audit_record` 리포지터리 (ENT-CORE-007, FR-AUTH-004).
 *
 * **추가와 조회만 있다.** 갱신·삭제 함수를 두지 않는 것은 실수 방지가 아니라
 * 설계다 — DB 롤 `prs_app`도 이 표에 INSERT/SELECT 권한만 갖는다 (마이그레이션
 * 005, FR-AUTH-004 AC-3). 보존 만료 삭제는 관리 롤이 파티션을 드롭해서 한다.
 *
 * 파티션 키가 `occurred_at`이라 조회는 기간을 함께 주어야 파티션 가지치기가
 * 된다. 기간 없는 조회는 전 파티션을 훑는다.
 */

import type { Pool, PoolClient } from 'pg';

export interface AuditRecordInput {
  /**
   * 행위 주체.
   *
   * WP-012의 OIDC 세션이 서기 전까지는 관리 토큰의 이름이다
   * (`admin:alice` 형태, CR-013 DEV-030). **신원이 없다고 지어내지 않는다** —
   * 이름 없는 단일 토큰은 `admin:unnamed`로 남아 "누구인지 모른다"는 사실
   * 자체가 기록된다.
   */
  readonly userId: string;
  /** `repository.register` 처럼 `대상.동작` 형태. */
  readonly action: string;
  readonly target?: string | null;
  /** 질의 문자열. 응답 본문은 절대 싣지 않는다 (관측성 3.1). */
  readonly query?: string | null;
  readonly resultCode: string;
  readonly correlationId: string;
}

export interface AuditRecordRow {
  readonly audit_id: number;
  readonly user_id: string;
  readonly action: string;
  readonly target: string | null;
  readonly query: string | null;
  readonly result_code: string;
  readonly correlation_id: string;
  readonly occurred_at: Date;
}

type Queryable = Pool | PoolClient;

export async function recordAudit(db: Queryable, input: AuditRecordInput): Promise<void> {
  await db.query(
    `INSERT INTO audit_record (user_id, action, target, query, result_code, correlation_id)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      input.userId,
      input.action,
      input.target ?? null,
      input.query ?? null,
      input.resultCode,
      input.correlationId,
    ],
  );
}

export interface AuditFilter {
  readonly userId?: string;
  readonly action?: string;
  readonly from?: Date;
  readonly to?: Date;
}

export async function listAuditRecords(
  db: Queryable,
  filter: AuditFilter = {},
  limit = 50,
): Promise<AuditRecordRow[]> {
  const params: unknown[] = [];
  const parts: string[] = [];

  if (filter.userId !== undefined) {
    params.push(filter.userId);
    parts.push(`user_id = $${String(params.length)}`);
  }
  if (filter.action !== undefined) {
    params.push(filter.action);
    parts.push(`action = $${String(params.length)}`);
  }
  if (filter.from !== undefined) {
    params.push(filter.from);
    parts.push(`occurred_at >= $${String(params.length)}`);
  }
  if (filter.to !== undefined) {
    params.push(filter.to);
    parts.push(`occurred_at < $${String(params.length)}`);
  }

  const where = parts.length === 0 ? '' : ` WHERE ${parts.join(' AND ')}`;
  const result = await db.query<AuditRecordRow>(
    `SELECT * FROM audit_record${where} ORDER BY occurred_at DESC, audit_id DESC LIMIT $${String(params.length + 1)}`,
    [...params, limit],
  );
  return result.rows;
}
