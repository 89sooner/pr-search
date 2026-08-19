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
