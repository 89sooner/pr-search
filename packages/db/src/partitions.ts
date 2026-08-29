/**
 * 월별 파티션 생성 (데이터 모델 3.1·3.4, JOB-ING-006).
 *
 * `raw_event`(보존 3년, OD-003)와 `audit_record`(보존 1년, NFR-006)가 대상이다.
 * 보존 만료는 DELETE가 아니라 파티션 드롭으로 처리한다 — 5억 행 규모에서 행 단위
 * 삭제는 vacuum 부하와 테이블 팽창을 만든다.
 *
 * 파티션이 없는 파티션 테이블은 INSERT를 거부하므로, 이 함수는 정기 잡뿐 아니라
 * 부트스트랩에서도 호출되어야 한다.
 */

import type { Pool } from 'pg';

export const PARTITIONED_TABLES = ['raw_event', 'audit_record'] as const;

export type PartitionedTable = (typeof PARTITIONED_TABLES)[number];

/** `YYYY-MM-01T00:00:00Z` 기준으로 월 경계를 만든다. */
function monthStart(base: Date, offset: number): Date {
  return new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + offset, 1));
}

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function partitionName(table: PartitionedTable, month: Date): string {
  const year = String(month.getUTCFullYear());
  const monthPart = String(month.getUTCMonth() + 1).padStart(2, '0');
  return `${table}_${year}_${monthPart}`;
}

/**
 * `from`부터 `monthsAhead`개월치 파티션을 멱등하게 만든다.
 *
 * @returns 실제로 만든 파티션 이름 (이미 있던 것은 제외).
 */
export async function ensureMonthlyPartitions(
  pool: Pool,
  table: PartitionedTable,
  monthsAhead = 3,
  from: Date = new Date(),
): Promise<string[]> {
  const created: string[] = [];

  for (let offset = 0; offset < monthsAhead; offset += 1) {
    const start = monthStart(from, offset);
    const end = monthStart(from, offset + 1);
    const name = partitionName(table, start);

    const exists = await pool.query('SELECT to_regclass($1) AS oid', [name]);
    if (exists.rows[0]?.oid !== null) continue;

    // 식별자는 바인딩할 수 없어 문자열로 조립한다. table은 리터럴 유니온이고
    // name은 그로부터 만든 값이라 외부 입력이 섞이지 않는다.
    await pool.query(
      `CREATE TABLE IF NOT EXISTS ${name} PARTITION OF ${table} FOR VALUES FROM ('${isoDate(start)}') TO ('${isoDate(end)}')`,
    );
    created.push(name);
  }

  return created;
}

/** 두 파티션 테이블 모두에 대해 파티션을 만든다. */
export async function ensureAllPartitions(pool: Pool, monthsAhead = 3, from?: Date): Promise<string[]> {
  const created: string[] = [];
  for (const table of PARTITIONED_TABLES) {
    created.push(...(await ensureMonthlyPartitions(pool, table, monthsAhead, from)));
  }
  return created;
}

/**
 * 표별 보존 기간 (개월).
 *
 * `raw_event` 3년은 `OD-003` 결정값(`FR-ING-003` AC-4), `audit_record` 1년은
 * `NFR-006`이다. 여기 있는 이유는 **드롭 판정이 이 값 하나에 걸리기 때문**이며,
 * 값이 두 곳에 살면 한쪽만 바뀌었을 때 그 차이가 데이터 손실이 된다.
 */
export const RETENTION_MONTHS: Readonly<Record<PartitionedTable, number>> = {
  raw_event: 36,
  audit_record: 12,
};

export interface PartitionBound {
  readonly name: string;
  /** 이 파티션이 담는 구간의 상한(미포함). */
  readonly upperBound: Date;
}

/**
 * 시스템 카탈로그에서 파티션의 **실제 경계**를 읽는다.
 *
 * **이름으로 추측하지 않는다** (CR-054 §41). `audit_record_2024_01`이라는
 * 이름이 그 파티션의 경계를 말하는 것처럼 보이지만, 이름은 만들 때 붙인
 * 문자열이고 경계는 `FOR VALUES` 절이 정한다. 손으로 만든 파티션이나 다른
 * 규칙으로 붙은 이름이 하나라도 있으면 이름 기반 판정은 **살아 있는 데이터를
 * 지운다.** 되돌릴 수 없는 동작에서 추측은 근거가 아니다.
 */
export async function listPartitionBounds(
  db: Pool,
  table: PartitionedTable,
): Promise<PartitionBound[]> {
  /*
   * **경계 문자열을 PostgreSQL이 파싱하게 한다.**
   *
   * `pg_get_expr`이 내는 것은 `FOR VALUES FROM ('2026-01-01 00:00:00+00') TO
   * ('2026-02-01 00:00:00+00')`이며 공백 구분자와 `+00` 오프셋을 쓴다.
   * 그것을 JavaScript `Date`에 넘기면 구현마다 다르게 읽히거나 `NaN`이 되고,
   * `NaN`이 되면 그 파티션이 **조용히 판정 대상에서 빠진다** — 지우지 못하는
   * 실패는 눈에 띄지만 지워야 할 것을 빠뜨리는 실패는 디스크가 찰 때까지
   * 드러나지 않는다. 서버가 자기 형식을 `timestamptz`로 캐스팅하게 두면 그
   * 갈래가 사라진다.
   */
  const result = await db.query<{ name: string; upper_bound: Date | null }>(
    `SELECT c.relname AS name,
            (regexp_match(pg_get_expr(c.relpartbound, c.oid), 'TO \\(''([^'']+)''\\)'))[1]::timestamptz AS upper_bound
       FROM pg_class parent
       JOIN pg_inherits i ON i.inhparent = parent.oid
       JOIN pg_class c ON c.oid = i.inhrelid
      WHERE parent.relname = $1`,
    [table],
  );

  const bounds: PartitionBound[] = [];
  for (const row of result.rows) {
    // `DEFAULT` 파티션에는 상한이 없다. 그런 파티션은 어떤 기준으로도
    // 만료되지 않으므로 대상에서 뺀다.
    if (row.upper_bound === null) continue;
    bounds.push({ name: row.name, upperBound: row.upper_bound });
  }
  return bounds;
}

export interface DroppedPartition {
  readonly table: PartitionedTable;
  readonly name: string;
}

export interface PartitionDropFailure {
  readonly table: PartitionedTable;
  readonly name: string;
  readonly reason: string;
}

export interface RetentionResult {
  readonly created: readonly string[];
  readonly dropped: readonly DroppedPartition[];
  readonly failed: readonly PartitionDropFailure[];
}

/** 보존 만료 기준 시각. `now`에서 표의 보존 개월만큼 뺀다. */
export function retentionCutoff(table: PartitionedTable, now: Date): Date {
  return monthStart(now, -RETENTION_MONTHS[table]);
}

/**
 * 파티션 수명 한 회차 — **만들고 나서 지운다** (JOB-AUD-001, CR-054 DEV-417).
 *
 * 순서가 중요하다. 드롭을 먼저 하면 그 회차가 실패했을 때 다가올 파티션도
 * 없는 채로 끝나고, 다음 INSERT가 전부 거부된다. **생성은 언제나 안전하고
 * 드롭은 되돌릴 수 없으므로** 안전한 쪽을 먼저 한다.
 *
 * ## 드롭 조건
 *
 * `파티션 상한 <= 보존 기준 시각`일 때만 지운다. 상한이 기준보다 **뒤**면 그
 * 파티션에는 아직 보존 기간 안의 행이 있다. 현재·미래 파티션은 상한이 언제나
 * 기준보다 뒤이므로 자연히 제외된다.
 *
 * ## 부분 실패를 조용히 넘기지 않는다
 *
 * 파티션 하나의 드롭이 실패해도 나머지를 계속 지운다 — 한 표의 잠금 경합이
 * 다른 표의 보존 정책을 멈추게 두지 않는다. 다만 **실패를 결과에 담아
 * 돌려준다.** 조용한 부분 성공은 "보존 정책이 돌고 있다"는 거짓 신호를 만든다.
 *
 * ## 멱등하다
 *
 * 두 번째 실행은 지울 것이 없어 `dropped`가 비고 성공으로 끝난다. 이미 없는
 * 파티션 때문에 실패하지 않는다 (`DROP TABLE IF EXISTS`).
 */
export async function runPartitionRetention(
  db: Pool,
  now: Date = new Date(),
  monthsAhead = 3,
): Promise<RetentionResult> {
  const created = await ensureAllPartitions(db, monthsAhead, now);
  const dropped: DroppedPartition[] = [];
  const failed: PartitionDropFailure[] = [];

  for (const table of PARTITIONED_TABLES) {
    const cutoff = retentionCutoff(table, now);
    const bounds = await listPartitionBounds(db, table);

    for (const bound of bounds) {
      if (bound.upperBound.getTime() > cutoff.getTime()) continue;
      try {
        // 이름은 카탈로그에서 읽은 값이고 외부 입력이 섞이지 않는다.
        // 그래도 식별자 형태를 확인한다 — 카탈로그를 믿되 검증한다.
        if (!/^[a-z_][a-z0-9_]*$/.test(bound.name)) {
          failed.push({ table, name: bound.name, reason: '식별자 형태가 아니다' });
          continue;
        }
        await db.query(`DROP TABLE IF EXISTS ${bound.name}`);
        dropped.push({ table, name: bound.name });
      } catch (error) {
        failed.push({ table, name: bound.name, reason: String(error).slice(0, 200) });
      }
    }
  }

  return { created, dropped, failed };
}
