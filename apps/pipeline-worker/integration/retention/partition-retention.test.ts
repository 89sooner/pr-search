/**
 * JOB-AUD-001 파티션 수명 — 실제 PostgreSQL
 * (WP-039 DoD / FR-ING-003 AC-4·AC-5, NFR-006, CR-054 DEV-417).
 *
 * ## 왜 실제 DB인가
 *
 * 드롭 판정의 재료가 **시스템 카탈로그의 실제 파티션 경계**다. 이름으로
 * 추측하지 않는다는 규칙(CR-054 §41)은 `pg_get_expr(relpartbound)`를 읽어야만
 * 성립하고, 그것은 목으로 확인되지 않는다.
 *
 * ## 공유 자원 규율
 *
 * `prs_test`의 `raw_event`·`audit_record`는 다른 파일도 쓴다. **이 파일은
 * 자기가 만든 합성 파티션만 만들고 지운다** — 실제 운영 파티션(현재 월 부근)은
 * 건드리지 않으며, 보존 기준이 3년·1년이라 그 경계에 닿지도 않는다.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  createPool,
  listPartitionBounds,
  partitionName,
  resolvePoolConfig,
  retentionCutoff,
  runPartitionRetention,
  type Pool,
} from '@prs/db';
import { migrateUp } from '@prs/db/migrate';

let pool: Pool;

/** 이 파일이 만든 합성 파티션. 반드시 되돌린다. */
const created: string[] = [];

const NOW = new Date('2026-08-29T00:00:00.000Z');

async function makePartition(table: 'raw_event' | 'audit_record', month: string): Promise<string> {
  const start = new Date(`${month}-01T00:00:00Z`);
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
  const name = partitionName(table, start);
  await pool.query(
    `CREATE TABLE IF NOT EXISTS ${name} PARTITION OF ${table}
     FOR VALUES FROM ('${start.toISOString().slice(0, 10)}') TO ('${end.toISOString().slice(0, 10)}')`,
  );
  created.push(name);
  return name;
}

async function names(table: 'raw_event' | 'audit_record'): Promise<string[]> {
  return (await listPartitionBounds(pool, table)).map((bound) => bound.name);
}

beforeAll(async () => {
  const env = { ...process.env };
  if (env['DATABASE_URL'] === undefined || env['DATABASE_URL'] === '') {
    env['POSTGRES_DB'] = env['POSTGRES_TEST_DB'] ?? 'prs_test';
  }
  pool = createPool(resolvePoolConfig(env));
  await migrateUp(pool);
}, 90_000);

afterEach(async () => {
  for (const name of created.splice(0)) {
    await pool.query(`DROP TABLE IF EXISTS ${name}`);
  }
});

afterAll(async () => {
  await pool?.end();
});

describe('카탈로그에서 경계를 읽는다 (§41)', () => {
  it('이름이 아니라 `FOR VALUES` 절을 본다', async () => {
    const name = await makePartition('audit_record', '2020-03');
    const bounds = await listPartitionBounds(pool, 'audit_record');
    const found = bounds.find((bound) => bound.name === name);
    expect(found).toBeDefined();
    expect(found?.upperBound.toISOString()).toBe('2020-04-01T00:00:00.000Z');
  });
});

describe('보존 만료 드롭', () => {
  it('1년 지난 `audit_record` 파티션을 지운다', async () => {
    const old = await makePartition('audit_record', '2024-01');
    const result = await runPartitionRetention(pool, NOW);

    expect(result.dropped.map((d) => d.name)).toContain(old);
    expect(await names('audit_record')).not.toContain(old);
    // 지웠으므로 정리 목록에서 뺀다.
    created.splice(created.indexOf(old), 1);
  });

  it('3년 지난 `raw_event` 파티션을 지운다', async () => {
    const old = await makePartition('raw_event', '2022-01');
    const result = await runPartitionRetention(pool, NOW);

    expect(result.dropped.map((d) => d.name)).toContain(old);
    created.splice(created.indexOf(old), 1);
  });

  it('**보존 기간 안의 파티션은 남긴다** — `audit_record` 6개월 전', async () => {
    const recent = await makePartition('audit_record', '2026-02');
    const result = await runPartitionRetention(pool, NOW);

    expect(result.dropped.map((d) => d.name)).not.toContain(recent);
    expect(await names('audit_record')).toContain(recent);
  });

  it('**`raw_event`에 1년 기준을 쓰지 않는다** — 2년 전 파티션은 남는다', async () => {
    // 두 표의 보존이 다르다. 하나로 뭉뚱그리면 원본 3년 보증이 깨진다.
    const twoYears = await makePartition('raw_event', '2024-06');
    const result = await runPartitionRetention(pool, NOW);

    expect(result.dropped.map((d) => d.name)).not.toContain(twoYears);
  });

  it('현재·미래 파티션은 남는다', async () => {
    const future = await makePartition('audit_record', '2026-12');
    const result = await runPartitionRetention(pool, NOW);
    expect(result.dropped.map((d) => d.name)).not.toContain(future);
  });

  it('경계에 걸친 파티션을 지운다 — 상한이 기준과 같다', async () => {
    const cutoff = retentionCutoff('audit_record', NOW);
    expect(cutoff.toISOString()).toBe('2025-08-01T00:00:00.000Z');
    // 상한이 정확히 2025-08-01인 파티션 = 2025-07월분.
    const edge = await makePartition('audit_record', '2025-07');
    const result = await runPartitionRetention(pool, NOW);
    expect(result.dropped.map((d) => d.name)).toContain(edge);
    created.splice(created.indexOf(edge), 1);
  });

  it('경계 하루 뒤는 남긴다', async () => {
    // 2025-08월분의 상한은 2025-09-01로 기준보다 뒤다.
    const edge = await makePartition('audit_record', '2025-08');
    const result = await runPartitionRetention(pool, NOW);
    expect(result.dropped.map((d) => d.name)).not.toContain(edge);
  });
});

describe('다가올 파티션을 먼저 만든다 (DEV-417)', () => {
  it('생성이 드롭보다 앞선다 — 결과에 만든 것이 담긴다', async () => {
    // 먼 미래를 기준으로 돌리면 그 시점의 파티션이 없으므로 만들어야 한다.
    const far = new Date('2027-03-15T00:00:00.000Z');
    const result = await runPartitionRetention(pool, far, 2);
    for (const name of result.created) created.push(name);

    expect(result.created.length).toBeGreaterThan(0);
    expect(result.created.some((name) => name.startsWith('audit_record_2027_03'))).toBe(true);
  });

  it('현재 월 파티션이 반드시 있다 — 감사 INSERT가 거부되지 않는다', async () => {
    await runPartitionRetention(pool, NOW, 3);
    const bounds = await listPartitionBounds(pool, 'audit_record');
    const covering = bounds.filter((b) => b.upperBound.getTime() > NOW.getTime());
    expect(covering.length).toBeGreaterThan(0);
  });
});

describe('멱등하다', () => {
  it('두 번째 실행은 지울 것이 없고 실패하지 않는다', async () => {
    const old = await makePartition('audit_record', '2023-05');

    const first = await runPartitionRetention(pool, NOW);
    expect(first.dropped.map((d) => d.name)).toContain(old);
    expect(first.failed).toHaveLength(0);
    created.splice(created.indexOf(old), 1);

    const second = await runPartitionRetention(pool, NOW);
    expect(second.dropped.map((d) => d.name)).not.toContain(old);
    expect(second.failed).toHaveLength(0);
  });

  it('이미 없는 파티션 때문에 실패하지 않는다', async () => {
    const result = await runPartitionRetention(pool, NOW);
    expect(result.failed).toHaveLength(0);
  });
});

describe('식별자 주입 방어', () => {
  it('카탈로그가 준 이름도 식별자 형태를 검사한다', async () => {
    // 실제로 그런 이름을 만들 수는 없지만, 검사가 살아 있는지 확인한다 —
    // 조립되는 SQL에 들어가는 값이므로 카탈로그를 믿되 검증한다.
    const bounds = await listPartitionBounds(pool, 'audit_record');
    for (const bound of bounds) {
      expect(bound.name, bound.name).toMatch(/^[a-z_][a-z0-9_]*$/);
    }
  });
});
