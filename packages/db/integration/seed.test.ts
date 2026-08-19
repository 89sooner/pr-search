import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SEED_TARGET, seed } from '../src/seed.js';
import * as mergeSequenceRepo from '../src/repositories/merge-sequence.js';
import { migratedPool, truncate } from './helpers.js';

describe('합성 시드 (WP-002 DoD 2)', () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = await migratedPool();
    await truncate(pool, 'raw_event', 'merge_sequence', 'sequence_space', 'repository');
    await seed(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('저장소 3개를 등록한다', async () => {
    const result = await pool.query<{ count: string }>('SELECT count(*) AS count FROM repository');
    expect(Number(result.rows[0]?.count)).toBe(SEED_TARGET.repositories);
  });

  it('PR 200건과 직접 푸시를 합쳐 커밋 500건을 채번한다', async () => {
    const total = await pool.query<{ count: string }>('SELECT count(*) AS count FROM merge_sequence');
    expect(Number(total.rows[0]?.count)).toBe(SEED_TARGET.commits);

    const withPr = await pool.query<{ count: string }>(
      'SELECT count(*) AS count FROM merge_sequence WHERE pull_request_number IS NOT NULL',
    );
    expect(Number(withPr.rows[0]?.count)).toBe(SEED_TARGET.pullRequests);
  });

  it('FR-SEQ-001 AC-3: 직접 푸시 커밋은 pull_request_number가 NULL이다', async () => {
    const result = await pool.query<{ count: string }>(
      'SELECT count(*) AS count FROM merge_sequence WHERE pull_request_number IS NULL',
    );
    expect(Number(result.rows[0]?.count)).toBe(SEED_TARGET.commits - SEED_TARGET.pullRequests);
  });

  it('시퀀스 서수가 공간마다 1부터 빈틈없이 이어진다 (ADR-007)', async () => {
    const result = await pool.query<{ repository_id: string; min: string; max: string; count: string }>(
      `SELECT repository_id, min(merge_seq) AS min, max(merge_seq) AS max, count(*) AS count
         FROM merge_sequence
        WHERE base_branch = 'main' AND seq_epoch = 1
        GROUP BY repository_id`,
    );

    expect(result.rows.length).toBe(SEED_TARGET.repositories);
    for (const row of result.rows) {
      expect(Number(row.min)).toBe(1);
      // 빈틈이 있으면 max와 count가 어긋난다.
      expect(Number(row.max)).toBe(Number(row.count));
    }
  });

  it('릴리스를 포함한 원본 이벤트를 적재한다', async () => {
    const releases = await pool.query<{ count: string }>(
      "SELECT count(*) AS count FROM raw_event WHERE event_type = 'release'",
    );
    expect(Number(releases.rows[0]?.count)).toBe(SEED_TARGET.releases);
  });

  it('반개구간 (from, to] 조회가 git log A..B와 같은 개수를 준다', async () => {
    const range = await mergeSequenceRepo.findRange(pool, 1001, 'main', 1, 10, 20);
    expect(range).toHaveLength(10);
    expect(Number(range[0]?.merge_seq)).toBe(11);
    expect(Number(range.at(-1)?.merge_seq)).toBe(20);
  });

  it('두 번 실행해도 같은 상태가 된다', async () => {
    const before = await pool.query<{ count: string }>('SELECT count(*) AS count FROM merge_sequence');
    await seed(pool);
    const after = await pool.query<{ count: string }>('SELECT count(*) AS count FROM merge_sequence');
    expect(after.rows[0]?.count).toBe(before.rows[0]?.count);
  });
});
