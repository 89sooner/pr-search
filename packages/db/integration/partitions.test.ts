import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PARTITIONED_TABLES, ensureMonthlyPartitions, partitionName } from '../src/partitions.js';
import { migratedPool } from './helpers.js';

describe('월별 파티션 (데이터 모델 3.1·3.4)', () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = await migratedPool();
  });

  afterAll(async () => {
    await pool.end();
  });

  it('raw_event와 audit_record가 파티션 테이블이다', async () => {
    for (const table of PARTITIONED_TABLES) {
      const result = await pool.query<{ relkind: string }>(
        'SELECT relkind FROM pg_class WHERE relname = $1',
        [table],
      );
      expect(result.rows[0]?.relkind).toBe('p');
    }
  });

  it('파티션 생성은 멱등하다', async () => {
    const from = new Date(Date.UTC(2027, 0, 1));
    const first = await ensureMonthlyPartitions(pool, 'raw_event', 2, from);
    const second = await ensureMonthlyPartitions(pool, 'raw_event', 2, from);

    expect(first).toEqual([partitionName('raw_event', from), 'raw_event_2027_02']);
    expect(second).toEqual([]);
  });

  it('보존 만료는 파티션 드롭으로 처리할 수 있다 (OD-003)', async () => {
    const from = new Date(Date.UTC(2028, 5, 1));
    const [created] = await ensureMonthlyPartitions(pool, 'raw_event', 1, from);
    expect(created).toBe('raw_event_2028_06');

    await pool.query(`DROP TABLE ${String(created)}`);

    const exists = await pool.query('SELECT to_regclass($1) AS oid', [created]);
    expect(exists.rows[0]).toEqual({ oid: null });
  });
});
