/**
 * `dead_letter` 리포지터리 (ENT-ING-002, FR-ING-007).
 *
 * 표준 재시도가 모두 실패한 이벤트를 격리한다. 격리된 이벤트도 원본은
 * `raw_event`에 남아 있으므로 재처리는 언제나 원본에서 다시 시작한다.
 *
 * **한 (전달, 단계)에 행 하나다 (CR-012, DEV-022).** `EVT-ING-004`가 정한 멱등
 * 키를 유일 제약이 강제한다. 제약 없이 삽입만 하면 재처리가 실패할 때마다
 * `reprocess_count = 0`인 새 행이 생겨, FR-ING-007의 "동일 이벤트가 3회 재처리
 * 실패하면 보류"가 영원히 성립하지 않는다.
 */

import type { Pool, PoolClient } from 'pg';

export type DeadLetterStage = 'enrich' | 'project' | 'sequence' | 'link';
export type DeadLetterState = 'pending' | 'reprocessing' | 'held' | 'resolved';

/** 자동 재처리에서 빠지기까지의 재처리 실패 횟수 (FR-ING-007 예외 처리). */
export const MAX_REPROCESS_ATTEMPTS = 3;

/** 경보 임계 (FR-ING-007 AC-5). 세는 대상은 아직 열려 있는 상태뿐이다. */
export const DEAD_LETTER_ALERT_THRESHOLD = 100;

/** 열려 있는 상태. `held`는 사람이 보기로 한 것이고 `resolved`는 끝난 것이다. */
export const OPEN_STATES: readonly DeadLetterState[] = ['pending', 'reprocessing'];

export interface DeadLetterRow {
  /**
   * `BIGSERIAL`이라 int8이고, `@prs/db`의 타입 파서가 숫자로 준다 (CR-012,
   * DEV-027). 선언을 `string`으로 두면 타입만 문자열이고 런타임 값은 숫자인
   * 상태가 되어 `===` 비교와 JSON 직렬화가 조용히 어긋난다.
   */
  readonly dead_letter_id: number;
  readonly delivery_id: string;
  readonly stage: DeadLetterStage;
  readonly repository_id: number | null;
  readonly error: string;
  readonly retry_count: number;
  readonly reprocess_count: number;
  readonly state: DeadLetterState;
  readonly created_at: Date;
  readonly updated_at: Date;
}

export interface DeadLetterInput {
  readonly deliveryId: string;
  readonly stage: DeadLetterStage;
  readonly repositoryId: number | null;
  readonly error: string;
  readonly retryCount: number;
}

export interface DeadLetterFilter {
  readonly states?: readonly DeadLetterState[];
  readonly stage?: DeadLetterStage;
  readonly repositoryId?: number;
}

type Queryable = Pool | PoolClient;

/**
 * 실패를 기록한다. 같은 (전달, 단계)가 이미 있으면 갱신한다.
 *
 * 충돌 시 상태 전이는 한 문장으로 정해진다 (데이터 모델 3.1의 표와 같다).
 *
 *   `reprocessing` → 재처리가 실패했다는 뜻이다. 누적을 올리고 3에 닿으면 `held`
 *   `resolved`     → 닫혔던 이벤트가 새로 실패했다. 이전 주기를 물려받지 않는다
 *   `held`         → 그대로 둔다. 자동 재처리 대상에서 빠진 채로 남는다
 *   `pending`      → 재처리를 거치지 않은 실패가 또 났다. 마지막 오류만 갱신한다
 */
export async function recordDeadLetter(db: Queryable, input: DeadLetterInput): Promise<DeadLetterRow> {
  const result = await db.query<DeadLetterRow>(
    `INSERT INTO dead_letter (delivery_id, stage, repository_id, error, retry_count, state)
     VALUES ($1, $2, $3, $4, $5, 'pending')
     ON CONFLICT (delivery_id, stage) DO UPDATE
        SET repository_id   = COALESCE(EXCLUDED.repository_id, dead_letter.repository_id),
            error           = EXCLUDED.error,
            retry_count     = EXCLUDED.retry_count,
            reprocess_count = CASE
                                WHEN dead_letter.state = 'reprocessing' THEN dead_letter.reprocess_count + 1
                                WHEN dead_letter.state = 'resolved'     THEN 0
                                ELSE dead_letter.reprocess_count
                              END,
            state           = CASE
                                WHEN dead_letter.state = 'held' THEN 'held'
                                WHEN dead_letter.state = 'reprocessing'
                                     AND dead_letter.reprocess_count + 1 >= $6 THEN 'held'
                                ELSE 'pending'
                              END,
            updated_at      = now()
     RETURNING *`,
    [
      input.deliveryId,
      input.stage,
      input.repositoryId,
      input.error,
      input.retryCount,
      MAX_REPROCESS_ATTEMPTS,
    ],
  );

  const row = result.rows[0];
  if (row === undefined) throw new Error('실패 대기열 기록이 행을 반환하지 않았다');
  return row;
}

/**
 * 끝까지 처리된 전달의 열린 행을 닫는다 (CR-012, DEV-023).
 *
 * 재투입은 비동기라 요청 시점에는 성공 여부를 알 수 없다. 이벤트가 끝까지
 * 갔다는 증거는 투영이 `raw_event.processed_at`을 찍는 그 자리 하나뿐이라,
 * 판정도 거기서 한다. `held`도 함께 닫는다 — 실제로 통과했으면 보류 상태가
 * 더는 사실이 아니다.
 *
 * @returns 닫은 행 수. 대개 0이며, 그때는 유일 제약의 인덱스 탐색 한 번이다.
 */
export async function resolveByDelivery(db: Queryable, deliveryId: string): Promise<number> {
  const result = await db.query(
    `UPDATE dead_letter SET state = 'resolved', updated_at = now()
      WHERE delivery_id = $1 AND state <> 'resolved'`,
    [deliveryId],
  );
  return result.rowCount ?? 0;
}

function filterClauses(filter: DeadLetterFilter): { readonly sql: string; readonly params: unknown[] } {
  const params: unknown[] = [];
  const parts: string[] = [];

  if (filter.states !== undefined) {
    params.push([...filter.states]);
    parts.push(`state = ANY($${String(params.length)}::text[])`);
  }
  if (filter.stage !== undefined) {
    params.push(filter.stage);
    parts.push(`stage = $${String(params.length)}`);
  }
  if (filter.repositoryId !== undefined) {
    params.push(filter.repositoryId);
    parts.push(`repository_id = $${String(params.length)}`);
  }

  return { sql: parts.length === 0 ? '' : ` WHERE ${parts.join(' AND ')}`, params };
}

export async function listDeadLetters(
  db: Queryable,
  filter: DeadLetterFilter = {},
  limit = 50,
  offset = 0,
): Promise<DeadLetterRow[]> {
  const { sql, params } = filterClauses(filter);
  const result = await db.query<DeadLetterRow>(
    `SELECT * FROM dead_letter${sql}
      ORDER BY created_at DESC, dead_letter_id DESC
      LIMIT $${String(params.length + 1)} OFFSET $${String(params.length + 2)}`,
    [...params, limit, offset],
  );
  return result.rows;
}

export async function countDeadLetters(db: Queryable, filter: DeadLetterFilter = {}): Promise<number> {
  const { sql, params } = filterClauses(filter);
  const result = await db.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM dead_letter${sql}`,
    params,
  );
  return result.rows[0]?.count ?? 0;
}

/** 상태별 건수. 경보 지표 `dead_letter_total{state}`의 출처다 (AC-5). */
export async function countsByState(db: Queryable): Promise<Record<DeadLetterState, number>> {
  const result = await db.query<{ state: DeadLetterState; count: number }>(
    'SELECT state, count(*)::int AS count FROM dead_letter GROUP BY state',
  );
  const counts: Record<DeadLetterState, number> = {
    pending: 0,
    reprocessing: 0,
    held: 0,
    resolved: 0,
  };
  for (const row of result.rows) counts[row.state] = row.count;
  return counts;
}

export async function findByIds(db: Queryable, ids: readonly number[]): Promise<DeadLetterRow[]> {
  if (ids.length === 0) return [];
  const result = await db.query<DeadLetterRow>(
    'SELECT * FROM dead_letter WHERE dead_letter_id = ANY($1::bigint[]) ORDER BY dead_letter_id',
    [[...ids]],
  );
  return result.rows;
}

/**
 * 재투입을 시작한 행을 표시한다.
 *
 * 이 표시가 뒤에 오는 실패의 뜻을 바꾼다 — `reprocessing` 상태에서 온 실패만
 * "재처리가 실패했다"이고, 그때만 `reprocess_count`가 오른다.
 */
export async function markReprocessing(db: Queryable, ids: readonly number[]): Promise<number> {
  if (ids.length === 0) return 0;
  const result = await db.query(
    `UPDATE dead_letter SET state = 'reprocessing', updated_at = now()
      WHERE dead_letter_id = ANY($1::bigint[])`,
    [[...ids]],
  );
  return result.rowCount ?? 0;
}

/**
 * 재투입 발행에 실패했을 때 표시를 되돌린다.
 *
 * 발행하지 못했으면 `reprocessing`은 사실이 아니다. 되돌리지 않으면 아무도 다시
 * 넣지 않은 행이 진행 중으로 남고, 그 뒤에 오는 실패가 재처리 실패로 잘못
 * 세어진다.
 */
export async function revertReprocessing(db: Queryable, deadLetterId: number): Promise<boolean> {
  const result = await db.query(
    `UPDATE dead_letter SET state = 'pending', updated_at = now()
      WHERE dead_letter_id = $1 AND state = 'reprocessing'`,
    [deadLetterId],
  );
  return (result.rowCount ?? 0) > 0;
}
