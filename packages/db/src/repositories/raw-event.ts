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
  /**
   * 아웃박스 표식 (ADR-002 follow-up).
   *
   * INSERT 시점에 채운다 — "큐에 성공적으로 넣었다"가 아니라 "큐로 보낼
   * 대상이다"라는 뜻이다. 발행이 실패해도 이 값이 있어야 `JOB-ING-007`이
   * 그 행을 찾아 재적재한다. 생략하면 NULL이다.
   */
  readonly queued_at?: Date | null;
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

/**
 * 전달 식별자가 아직 없을 때만 저장한다. 이미 있으면 `false`를 돌려준다.
 *
 * **왜 INSERT 충돌만으로는 부족한가.** `raw_event`는 `received_at` 범위 파티션이고
 * PostgreSQL은 파티션 테이블의 유일 제약이 파티션 키를 포함하도록 요구하므로
 * 기본 키가 `(delivery_id, received_at)`이다. 재전송은 수신 시각이 달라 기본 키가
 * 충돌하지 않는다 — 그대로 두면 같은 전달 식별자가 두 행이 된다 (DEV-009).
 * 그래서 존재 검사를 INSERT와 한 문장에 묶고, 호출 측이 같은 트랜잭션에서
 * `advisoryXactLock`으로 같은 전달 식별자를 직렬화한다. 기본 키 충돌(23505)은
 * 같은 시각에 두 번 도착한 경우를 위한 마지막 방어선으로 남는다.
 *
 * 존재 검사는 `delivery_id`가 기본 키의 선두 컬럼이라 파티션마다 인덱스 탐색
 * 한 번으로 끝난다. `received_at` 조건이 없어 파티션 프루닝은 되지 않는다.
 */
export async function insertRawEventIfAbsent(db: Queryable, event: RawEventInsert): Promise<boolean> {
  const result = await db.query(
    `INSERT INTO raw_event
       (delivery_id, event_type, action, repository_id, received_at, payload, payload_hash, correlation_id, queued_at)
     SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9
      WHERE NOT EXISTS (SELECT 1 FROM raw_event WHERE delivery_id = $1)`,
    [
      event.delivery_id,
      event.event_type,
      event.action,
      event.repository_id,
      event.received_at,
      JSON.stringify(event.payload),
      event.payload_hash,
      event.correlation_id,
      event.queued_at ?? null,
    ],
  );
  return result.rowCount === 1;
}

/** 전달 식별자로 원본 이벤트를 찾는다. 멱등 검증과 조사에 쓴다. */
export async function findRawEventByDeliveryId(
  db: Queryable,
  deliveryId: string,
): Promise<RawEventRow | undefined> {
  const result = await db.query<RawEventRow>(
    'SELECT * FROM raw_event WHERE delivery_id = $1 ORDER BY received_at LIMIT 1',
    [deliveryId],
  );
  return result.rows[0];
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

/** 아웃박스 타이머를 다시 감는다. `queuedAt`을 주지 않으면 DB 시계를 쓴다. */
export async function markQueued(
  db: Queryable,
  deliveryId: string,
  receivedAt: Date,
  queuedAt?: Date,
): Promise<void> {
  await db.query(
    'UPDATE raw_event SET queued_at = COALESCE($3, now()) WHERE delivery_id = $1 AND received_at = $2',
    [deliveryId, receivedAt, queuedAt ?? null],
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

/**
 * 저장소별 **마지막으로 보관한** 원본 이벤트 시각 (API-ING-002 / WP-034, CR-050).
 *
 * W-009의 "마지막 수집 시각"이 뜻하는 것은 **PR Search가 마지막으로 이벤트를
 * 받아 durable하게 보관한 시점**이다. `processed_at`과 섞지 않는다 — 받았지만
 * 처리가 밀린 상태와 아예 받지 못한 상태는 다른 사실이고, 검색 반영 여부는
 * 문서 수·백필·조정 스캔이 따로 말한다.
 *
 * `raw_event_repo_idx (repository_id, received_at DESC)`가 이 질의를 받는다.
 * 페이지의 저장소 전체를 **한 번에** 읽는다 — 저장소마다 질의하면 N+1이다.
 */
export async function lastReceivedAtByRepository(
  db: Queryable,
  repositoryIds: readonly number[],
): Promise<Map<number, Date>> {
  const out = new Map<number, Date>();
  if (repositoryIds.length === 0) return out;
  const result = await db.query<{ repository_id: number; last_received_at: Date }>(
    `SELECT repository_id, max(received_at) AS last_received_at
       FROM raw_event
      WHERE repository_id = ANY($1)
      GROUP BY repository_id`,
    [repositoryIds],
  );
  for (const row of result.rows) out.set(row.repository_id, row.last_received_at);
  return out;
}
