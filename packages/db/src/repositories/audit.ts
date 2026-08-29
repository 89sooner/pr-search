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
  /**
   * `action` 정확 일치.
   *
   * **정본 유니온(`ActiveAuditAction`)으로 좁히지 않는다** (FR-AUTH-004 AC-7).
   * `AC-3`이 과거 기록의 갱신을 금지하므로 저장소에는 현재 어휘에 없는 값이
   * 남아 있다 — `sequence_integrity.reassign`이 그것이다. 타입으로 막으면
   * **감사의 목적인 과거 조사가 불가능해진다.**
   */
  readonly action?: string;
  readonly target?: string;
  readonly resultCode?: string;
  readonly from?: Date;
  readonly to?: Date;
}

/**
 * 키셋 순회의 위치.
 *
 * 두 값을 함께 쓴다 — 감사는 초당 여러 건이 같은 밀리초에 들어오고,
 * `occurred_at` 하나로 자르면 그 무리를 페이지 경계가 가를 때 기록이 빠지거나
 * 겹친다 (`API-ADM-005`).
 */
export interface AuditCursorPosition {
  readonly occurredAt: Date;
  readonly auditId: number;
}

export interface AuditPage {
  readonly items: readonly AuditRecordRow[];
  /** 다음 페이지가 있으면 그 시작 직전 위치. 없으면 `null`. */
  readonly next: AuditCursorPosition | null;
}

/** 기본·최대 페이지 크기 (`API-ADM-005`). */
export const AUDIT_DEFAULT_LIMIT = 50;
export const AUDIT_MAX_LIMIT = 100;

function buildFilterClauses(filter: AuditFilter, params: unknown[]): string[] {
  const parts: string[] = [];
  const push = (value: unknown, sql: (placeholder: string) => string): void => {
    params.push(value);
    parts.push(sql(`$${String(params.length)}`));
  };

  if (filter.userId !== undefined) push(filter.userId, (p) => `user_id = ${p}`);
  if (filter.action !== undefined) push(filter.action, (p) => `action = ${p}`);

  if (filter.target !== undefined) push(filter.target, (p) => `target = ${p}`);
  if (filter.resultCode !== undefined) push(filter.resultCode, (p) => `result_code = ${p}`);
  if (filter.from !== undefined) push(filter.from, (p) => `occurred_at >= ${p}`);
  if (filter.to !== undefined) push(filter.to, (p) => `occurred_at < ${p}`);
  return parts;
}

export async function listAuditRecords(
  db: Queryable,
  filter: AuditFilter = {},
  limit = AUDIT_DEFAULT_LIMIT,
): Promise<AuditRecordRow[]> {
  const page = await listAuditRecordPage(db, filter, limit, null);
  return [...page.items];
}

/**
 * 키셋 순회 한 페이지 (`ADR-010` — 오프셋을 두지 않는다).
 *
 * **`limit + 1`을 읽어 다음 페이지의 유무를 판정한다.** 별도 `count`를 돌리지
 * 않는 이유는 그 수가 답에 쓰이지 않기 때문이다 — 화면이 묻는 것은 "더 있는가"
 * 하나이고, 5억 행 규모에서 전체 건수를 세는 비용은 그 답의 값보다 크다.
 *
 * 정렬은 `occurred_at DESC, audit_id DESC`이며 `audit_cursor_idx`가 그 순서를
 * 그대로 덮는다 (마이그레이션 018).
 */
export async function listAuditRecordPage(
  db: Queryable,
  filter: AuditFilter,
  limit: number,
  after: AuditCursorPosition | null,
): Promise<AuditPage> {
  const size = Math.min(Math.max(1, limit), AUDIT_MAX_LIMIT);
  const params: unknown[] = [];
  const parts = buildFilterClauses(filter, params);

  if (after !== null) {
    // 행 값 비교. `(a, b) < (x, y)`는 두 키를 사전식으로 함께 보므로,
    // 같은 `occurred_at` 안에서도 `audit_id`가 이어진다.
    params.push(after.occurredAt, after.auditId);
    parts.push(
      `(occurred_at, audit_id) < ($${String(params.length - 1)}, $${String(params.length)})`,
    );
  }

  const where = parts.length === 0 ? '' : ` WHERE ${parts.join(' AND ')}`;
  params.push(size + 1);
  const result = await db.query<AuditRecordRow>(
    `SELECT * FROM audit_record${where} ORDER BY occurred_at DESC, audit_id DESC LIMIT $${String(params.length)}`,
    params,
  );

  const rows = result.rows;
  if (rows.length <= size) return { items: rows, next: null };

  const items = rows.slice(0, size);
  const last = items[items.length - 1];
  // `items`는 비어 있지 않다 — `rows.length > size >= 1`이기 때문이다.
  const next: AuditCursorPosition | null =
    last === undefined ? null : { occurredAt: last.occurred_at, auditId: last.audit_id };
  return { items, next };
}
