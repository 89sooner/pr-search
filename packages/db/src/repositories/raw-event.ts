/**
 * `raw_event` 리포지터리 (ENT-ING-001, FR-ING-002·FR-ING-003).
 *
 * 원본은 갱신·삭제하지 않는다. 보존 만료 삭제만 파티션 드롭으로 이뤄진다.
 * `queued_at`/`processed_at`이 아웃박스 역할을 한다 (ADR-002 follow-up).
 */

import type { Pool, PoolClient } from 'pg';

export interface RawEventInsert {
  readonly delivery_id: string;
  readonly event_type: string;
  readonly action: string | null;
  readonly repository_id: number | null;
  readonly received_at: Date;
  readonly payload: unknown;
  readonly payload_hash: string;
  readonly correlation_id: string;
}

export interface RawEventRow extends RawEventInsert {
  readonly queued_at: Date | null;
  readonly processed_at: Date | null;
}

type Queryable = Pool | PoolClient;

/**
 * 원본 이벤트를 저장한다.
 *
 * 같은 `delivery_id`가 이미 있으면 유니크 위반이 발생한다 (FR-ING-002 AC-1).
 * 멱등 처리는 호출 측이 위반을 잡아서 판단한다 — 여기서 조용히 무시하면
 * 재전송과 중복 전송을 구분할 수 없다.
 */
export async function insertRawEvent(db: Queryable, event: RawEventInsert): Promise<void> {
  await db.query(
    `INSERT INTO raw_event
       (delivery_id, event_type, action, repository_id, received_at, payload, payload_hash, correlation_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      event.delivery_id,
      event.event_type,
      event.action,
      event.repository_id,
      event.received_at,
      JSON.stringify(event.payload),
      event.payload_hash,
      event.correlation_id,
    ],
  );
}

/** 아웃박스 재적재 대상: enqueue됐지만 일정 시간이 지나도 처리되지 않은 행 (JOB-ING-007). */
export async function findStuckOutboxEvents(
  db: Queryable,
  olderThan: Date,
  limit = 100,
): Promise<RawEventRow[]> {
  const result = await db.query<RawEventRow>(
    `SELECT * FROM raw_event
      WHERE processed_at IS NULL AND queued_at IS NOT NULL AND queued_at < $1
      ORDER BY queued_at
      LIMIT $2`,
    [olderThan, limit],
  );
  return result.rows;
}

export async function markQueued(db: Queryable, deliveryId: string, receivedAt: Date): Promise<void> {
  await db.query(
    'UPDATE raw_event SET queued_at = now() WHERE delivery_id = $1 AND received_at = $2',
    [deliveryId, receivedAt],
  );
}

export async function markProcessed(db: Queryable, deliveryId: string, receivedAt: Date): Promise<void> {
  await db.query(
    'UPDATE raw_event SET processed_at = now() WHERE delivery_id = $1 AND received_at = $2',
    [deliveryId, receivedAt],
  );
}

export async function countRawEvents(db: Queryable): Promise<number> {
  const result = await db.query<{ count: string }>('SELECT count(*) AS count FROM raw_event');
  return Number(result.rows[0]?.count ?? '0');
}
