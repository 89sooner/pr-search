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
   * **시험 픽스처의 시간 의존을 건다** (DEV-500).
   *
   * 통합 시험 여럿이 `audit_record`·`raw_event`에 **고정된 과거 날짜**로 쓴다 —
   * 커서 순회와 범위 필터를 검증하려면 결정적인 시각이 필요하기 때문이다.
   * 헬퍼가 현재 월부터만 파티션을 만들면 **달이 바뀌는 순간** 그 삽입이 `23514`로
   * 죽는데, 개발자 DB에는 지난달 파티션이 남아 있어 **로컬에서 재현되지 않는다.**
   * 2026-09-01에 CI가 실제로 그렇게 터졌다.
   *
   * 이 시험이 없으면 헬퍼의 파티션 창을 좁혀도 **아무것도 죽지 않고**, 그 사실은
   * 다음 달 1일에야 드러난다.
   */
  it('헬퍼가 지난 3개월 파티션까지 만든다 — 시험이 고정 과거 날짜를 쓴다 (DEV-500)', async () => {
    const now = new Date();
    for (const monthsAgo of [1, 2, 3]) {
      const past = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsAgo, 1));
      for (const table of PARTITIONED_TABLES) {
        const name = partitionName(table, past);
        const result = await pool.query<{ oid: string | null }>('SELECT to_regclass($1) AS oid', [name]);
        expect(result.rows[0]?.oid, `${monthsAgo}개월 전 파티션 ${name}이 없다`).not.toBeNull();
      }
    }
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
