/**
 * 마이그레이션 009 — 잡 유형 `sequence_reassign` (WP-028 / CR-033, DEV-172).
 *
 * DEV-128이 등록해 둔 문서 간 모순의 해소다. API-ADM-007의 202 응답은
 * `type: "sequence_reassign"`을 안정 계약으로 내는데 `job_type_chk`는 그 값을
 * 허용하지 않아, **잡 행을 만드는 순간 CHECK 위반**이었다.
 *
 * CHECK 제약은 타입이 잡아 주지 않는다 — 실제로 행을 넣어 봐야 안다.
 *
 * 실행: `pnpm test:integration job-type-reassign`
 */

import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as jobRepo from '../src/repositories/job.js';
import { loadMigrations } from '../src/migrate.js';
import { migratedPool, truncate } from './helpers.js';

describe('마이그레이션 009 잡 유형 (CR-033, DEV-172)', () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = await migratedPool();
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await truncate(pool, 'job');
  });

  it('up/down 쌍이 존재한다', () => {
    const migration = loadMigrations().find((entry) => entry.version === '009');
    expect(migration).toBeDefined();
    expect(migration?.upPath).toContain('009_job_type_reassign.up.sql');
    expect(migration?.downPath).toContain('009_job_type_reassign.down.sql');
  });

  it('**`sequence_reassign` 잡 행이 실제로 만들어진다**', async () => {
    const jobId = await jobRepo.enqueueJob(pool, 'sequence_reassign', 'acme/payments@main', 'tester');
    const row = await jobRepo.findJobById(pool, jobId);
    expect(row?.type).toBe('sequence_reassign');
    expect(row?.state).toBe('queued');
  });

  it('기존 유형은 그대로 허용된다 — 넓히기만 했다', async () => {
    for (const type of ['backfill', 'reconcile', 'reindex', 'sequence_assign', 'sequence_integrity'] as const) {
      const jobId = await jobRepo.enqueueJob(pool, type, `target-${type}`, 'tester');
      expect(await jobRepo.findJobById(pool, jobId)).toBeDefined();
    }
  });

  it('**모르는 유형은 여전히 거절한다** — 제약을 없앤 것이 아니다', async () => {
    await expect(
      pool.query(`INSERT INTO job (type, target, state, requested_by) VALUES ('nonsense', 't', 'queued', 'tester')`),
    ).rejects.toThrow(/job_type_chk/);
  });

  it('같은 공간에 활성 재채번 잡은 하나뿐이다 (job_active_uk)', async () => {
    await jobRepo.enqueueJob(pool, 'sequence_reassign', 'acme/payments@main', 'tester');
    await expect(
      jobRepo.enqueueJob(pool, 'sequence_reassign', 'acme/payments@main', 'tester'),
    ).rejects.toThrow();
  });
});
