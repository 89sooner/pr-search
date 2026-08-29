/**
 * JOB-AUD-001의 감사 기록 — 실제 PostgreSQL
 * (WP-039 DoD / FR-ING-003 AC-5, CR-054).
 *
 * 보존 만료 삭제 자체가 감사 대상이다. **실제로 지운 파티션만** 남기고,
 * 감사 쓰기가 실패해도 **이미 성공한 드롭을 되돌린 척하지 않는다.**
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  auditRepo,
  createPool,
  partitionName,
  resolvePoolConfig,
  type Pool,
} from '@prs/db';
import { migrateUp } from '@prs/db/migrate';
import { AUDIT_RETENTION_PRINCIPAL } from '@prs/domain';
import { runRetentionSweep } from '../../src/retention.js';

let pool: Pool;
const created: string[] = [];
const NOW = new Date('2026-08-29T00:00:00.000Z');
const CONSTRAINT = 'wp039_retention_reject_audit';

async function makeExpired(table: 'raw_event' | 'audit_record', month: string): Promise<string> {
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

async function purgeRecords(): Promise<readonly auditRepo.AuditRecordRow[]> {
  return auditRepo.listAuditRecords(
    pool,
    { userId: AUDIT_RETENTION_PRINCIPAL, action: 'retention.purge' },
    100,
  );
}

beforeAll(async () => {
  const env = { ...process.env };
  if (env['DATABASE_URL'] === undefined || env['DATABASE_URL'] === '') {
    env['POSTGRES_DB'] = env['POSTGRES_TEST_DB'] ?? 'prs_test';
  }
  pool = createPool(resolvePoolConfig(env));
  await migrateUp(pool);
}, 90_000);

beforeEach(async () => {
  // 이 주체의 행만 지운다 — 남의 픽스처를 건드리지 않는다.
  await pool.query('DELETE FROM audit_record WHERE user_id = $1', [AUDIT_RETENTION_PRINCIPAL]);
});

afterEach(async () => {
  await pool.query(`ALTER TABLE audit_record DROP CONSTRAINT IF EXISTS ${CONSTRAINT}`);
  for (const name of created.splice(0)) {
    await pool.query(`DROP TABLE IF EXISTS ${name}`);
  }
});

afterAll(async () => {
  await pool.query('DELETE FROM audit_record WHERE user_id = $1', [AUDIT_RETENTION_PRINCIPAL]);
  await pool?.end();
});

describe('실제로 지운 파티션만 기록한다 (AC-5)', () => {
  it('드롭마다 `retention.purge`를 남긴다', async () => {
    const old = await makeExpired('audit_record', '2023-11');
    const result = await runRetentionSweep({ admin: pool, pool }, NOW);
    created.splice(created.indexOf(old), 1);

    const records = await purgeRecords();
    expect(result.dropped.map((d) => d.name)).toContain(old);
    expect(records.map((row) => row.target)).toContain(old);
  });

  it('`target`은 파티션 이름이고 `query`는 `null`이다 (AC-2)', async () => {
    const old = await makeExpired('raw_event', '2021-04');
    await runRetentionSweep({ admin: pool, pool }, NOW);
    created.splice(created.indexOf(old), 1);

    const row = (await purgeRecords()).find((r) => r.target === old);
    expect(row).toBeDefined();
    expect(row?.query).toBeNull();
    expect(row?.result_code).toBe('dropped');
    expect(row?.user_id).toBe(AUDIT_RETENTION_PRINCIPAL);
  });

  it('**지울 것이 없으면 아무 기록도 남기지 않는다** — 뜻 없는 행을 쌓지 않는다', async () => {
    await runRetentionSweep({ admin: pool, pool }, NOW);
    expect(await purgeRecords()).toHaveLength(0);
  });

  it('두 표의 드롭을 각각 남긴다', async () => {
    const a = await makeExpired('audit_record', '2023-09');
    const b = await makeExpired('raw_event', '2021-09');
    await runRetentionSweep({ admin: pool, pool }, NOW);
    created.splice(created.indexOf(a), 1);
    created.splice(created.indexOf(b), 1);

    const targets = (await purgeRecords()).map((row) => row.target);
    expect(targets).toEqual(expect.arrayContaining([a, b]));
  });
});

describe('감사 실패가 드롭을 되돌리지 않는다', () => {
  it('감사가 실패해도 파티션은 지워진 채로 남는다', async () => {
    const old = await makeExpired('audit_record', '2023-07');
    // 감사 INSERT만 막는다. 드롭은 그대로 일어난다.
    await pool.query(
      `ALTER TABLE audit_record ADD CONSTRAINT ${CONSTRAINT} CHECK (action = '') NOT VALID`,
    );

    const result = await runRetentionSweep({ admin: pool, pool }, NOW);
    created.splice(created.indexOf(old), 1);

    // **드롭은 성공했다.** 감사가 실패했다고 파티션이 돌아오지 않는다.
    expect(result.dropped.map((d) => d.name)).toContain(old);
    expect(result.failed).toHaveLength(0);

    await pool.query(`ALTER TABLE audit_record DROP CONSTRAINT IF EXISTS ${CONSTRAINT}`);
    // 기록은 남지 않았다 — 없는 것을 있다고 말하지 않는다.
    expect(await purgeRecords()).toHaveLength(0);
  });

  it('감사가 실패해도 회차가 던지지 않는다', async () => {
    await makeExpired('audit_record', '2023-06');
    await pool.query(
      `ALTER TABLE audit_record ADD CONSTRAINT ${CONSTRAINT} CHECK (action = '') NOT VALID`,
    );
    await expect(runRetentionSweep({ admin: pool, pool }, NOW)).resolves.toBeDefined();
    created.length = 0;
  });
});

describe('멱등하다', () => {
  it('두 번째 회차는 새 기록을 만들지 않는다', async () => {
    const old = await makeExpired('audit_record', '2023-04');
    await runRetentionSweep({ admin: pool, pool }, NOW);
    created.splice(created.indexOf(old), 1);
    const first = (await purgeRecords()).length;

    await runRetentionSweep({ admin: pool, pool }, NOW);
    expect((await purgeRecords()).length).toBe(first);
  });
});
