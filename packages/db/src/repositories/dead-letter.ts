/**
 * `dead_letter` 리포지터리 (ENT-ING-002, FR-ING-007).
 *
 * 재시도 3회가 모두 실패한 이벤트를 격리한다. 격리된 이벤트도 원본은 `raw_event`에
 * 남아 있으므로 재처리는 원본에서 다시 시작한다.
 */

import type { Pool, PoolClient } from 'pg';

export type DeadLetterStage = 'enrich' | 'project' | 'sequence' | 'link';
export type DeadLetterState = 'pending' | 'reprocessing' | 'held';

export interface DeadLetterRow {
  readonly dead_letter_id: string;
  readonly delivery_id: string;
  readonly stage: DeadLetterStage;
  readonly error: string;
  readonly retry_count: number;
  readonly reprocess_count: number;
  readonly state: DeadLetterState;
  readonly created_at: Date;
  readonly updated_at: Date;
}

type Queryable = Pool | PoolClient;

export async function recordDeadLetter(
  db: Queryable,
  deliveryId: string,
  stage: DeadLetterStage,
  error: string,
  retryCount: number,
): Promise<string> {
  const result = await db.query<{ dead_letter_id: string }>(
    `INSERT INTO dead_letter (delivery_id, stage, error, retry_count, state)
     VALUES ($1, $2, $3, $4, 'pending')
     RETURNING dead_letter_id`,
    [deliveryId, stage, error, retryCount],
  );

  const id = result.rows[0]?.dead_letter_id;
  if (id === undefined) throw new Error('실패 대기열 기록이 id를 반환하지 않았다');
  return id;
}

export async function listPending(db: Queryable, limit = 100): Promise<DeadLetterRow[]> {
  const result = await db.query<DeadLetterRow>(
    "SELECT * FROM dead_letter WHERE state = 'pending' ORDER BY created_at LIMIT $1",
    [limit],
  );
  return result.rows;
}

export async function markState(
  db: Queryable,
  deadLetterId: string,
  state: DeadLetterState,
): Promise<void> {
  await db.query('UPDATE dead_letter SET state = $2, updated_at = now() WHERE dead_letter_id = $1', [
    deadLetterId,
    state,
  ]);
}

/** 재처리 시도 횟수를 올린다. 무한 재처리 루프를 지표로 잡기 위해 별도 카운터를 둔다. */
export async function incrementReprocess(db: Queryable, deadLetterId: string): Promise<void> {
  await db.query(
    `UPDATE dead_letter
        SET reprocess_count = reprocess_count + 1, state = 'reprocessing', updated_at = now()
      WHERE dead_letter_id = $1`,
    [deadLetterId],
  );
}
