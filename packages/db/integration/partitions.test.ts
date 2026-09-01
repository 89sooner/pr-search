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

  /*
   * **`fixtureMonths`가 실제로 그 달의 파티션을 만든다** (DEV-509).
   *
   * 고정 과거 날짜를 쓰는 통합 시험은 그 달을 `migratedPool({ fixtureMonths })`로
   * 직접 넘긴다. 헬퍼가 과거를 향해 **롤링 창**을 열던 이전 방식은 픽스처를
   * 오늘 통과시키고 몇 달 뒤에 깨지게 만들었고(`DEV-500` → `DEV-509`), 그 실패는
   * 개발자 DB에 지난달 파티션이 남아 있어 **CI에서만** 드러났다.
   *
   * **먼 과거 달로 건다.** 오늘이 언제든 결과가 같아야 이 시험 자체가 시간에
   * 의존하지 않는다 — 직전 몇 달을 확인하는 형태는 롤링 창 아래에서 **언제나
   * 초록이라** 그 회귀를 잡지 못했다(리뷰가 지적한 자리다).
   */
  it('fixtureMonths가 먼 과거 달의 파티션을 만든다 (DEV-509)', async () => {
    const month = '2019-05';
    const names = PARTITIONED_TABLES.map((table) => partitionName(table, new Date(`${month}-01T00:00:00.000Z`)));
    await pool.query(`DROP TABLE IF EXISTS ${names.join(', ')}`);
    let scoped: Pool | undefined;
    try {
      scoped = await migratedPool({ fixtureMonths: [month] });
      for (const name of names) {
        const found = await pool.query<{ oid: string | null }>('SELECT to_regclass($1) AS oid', [name]);
        expect(found.rows[0]?.oid, `${name}이 없다`).not.toBeNull();
      }
    } finally {
      await scoped?.end();
      await pool.query(`DROP TABLE IF EXISTS ${names.join(', ')}`);
    }
  });

  it('fixtureMonths가 YYYY-MM이 아니면 거절한다', async () => {
    // 형식을 조용히 흘려보내면 파티션이 만들어지지 않은 채 시험이 23514로 죽고,
    // 그 오류는 원인에서 멀다.
    await expect(migratedPool({ fixtureMonths: ['2019/05'] })).rejects.toThrow(/YYYY-MM/);
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

  /*
   * **자기가 만든 파티션을 지운다** (DEV-501). 이 시험은 "첫 호출이 만들고 둘째가
   * 만들지 않는다"를 단언하므로 **시작 상태가 비어 있어야** 성립하는데, 남겨 두면
   * 같은 DB의 두 번째 실행부터 첫 호출이 빈 배열을 돌려주고 단언이 깨진다.
   * CI는 매번 새 DB라 통과하고 **개발자 DB에서만 빨갛다** — `DEV-500`과 정확히
   * 반대 방향의 같은 병이며, 이 저장소의 규율("통합 시험은 자기 이름 공간만
   * 정리한다")이 여기에만 적용되지 않고 있었다.
   */
  it('파티션 생성은 멱등하다', async () => {
    const from = new Date(Date.UTC(2027, 0, 1));
    const names = [partitionName('raw_event', from), 'raw_event_2027_02'];
    await pool.query(`DROP TABLE IF EXISTS ${names.join(', ')}`);
    try {
      const first = await ensureMonthlyPartitions(pool, 'raw_event', 2, from);
      const second = await ensureMonthlyPartitions(pool, 'raw_event', 2, from);

      expect(first).toEqual(names);
      expect(second).toEqual([]);
    } finally {
      await pool.query(`DROP TABLE IF EXISTS ${names.join(', ')}`);
    }
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
