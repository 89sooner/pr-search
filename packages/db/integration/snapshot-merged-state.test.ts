/**
 * 032 — PR 스냅숏 문서의 `state` 파생 (CR-101 / DEV-718).
 *
 * 투영이 병합된 PR을 `closed`로 저장해 온 스냅숏을 032가 `merged`로 바로잡고, down이 옛 투영의 값(`closed`)으로
 * 결정적으로 되돌리는지 본다. 병합 시각이 없는 문서는 어느 방향에서도 건드리지 않는다.
 *
 * 실행: `pnpm exec vitest run --config vitest.integration.config.ts packages/db/integration/snapshot-merged-state`
 */

import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { migrateDown, migrateUp } from '../src/migrate.js';
import { ensureAllPartitions } from '../src/partitions.js';
import { createTestPool, truncate } from './helpers.js';

const REPO = 4021;
let pool: Pool;

async function seed(prNumber: number, document: Record<string, unknown>): Promise<void> {
  await pool.query(
    `INSERT INTO pull_request_snapshot (repository_id, pr_number, document_version, source, document)
     VALUES ($1, $2, 1754042400000, 'backfill', $3::jsonb)`,
    [REPO, prNumber, JSON.stringify({ pr_number: prNumber, title: `pr ${String(prNumber)}`, ...document })],
  );
}

async function states(): Promise<Record<number, { state: string | null; version: number }>> {
  const result = await pool.query<{ pr_number: number; state: string | null; document_version: number }>(
    `SELECT pr_number, document->>'state' AS state, document_version FROM pull_request_snapshot WHERE repository_id = $1 ORDER BY pr_number`,
    [REPO],
  );
  return Object.fromEntries(result.rows.map((row) => [row.pr_number, { state: row.state, version: Number(row.document_version) }]));
}

beforeAll(async () => {
  pool = createTestPool();
  await migrateUp(pool);
  await ensureAllPartitions(pool, 3);
}, 120_000);

afterAll(async () => {
  await migrateUp(pool);
  await ensureAllPartitions(pool, 3);
  await pool.end();
});

beforeEach(async () => {
  await truncate(pool, 'pull_request_snapshot');
});

describe('032: 스냅숏 문서의 state 파생 (CR-101 / DEV-718)', () => {
  it('**up이 병합 시각 있는 문서를 merged로 바로잡고 down이 closed로 되돌린다**; 병합 시각 없는 문서와 document_version은 그대로다', async () => {
    // 032를 내리고 옛 투영이 남겼을 모양으로 심는다. 그 위에 033(CR-112)이 쌓였으므로 함께 내린다.
    expect(await migrateDown(pool, 6)).toEqual(['037', '036', '035', '034', '033', '032']);
    await seed(1, { state: 'closed', merged_at: '2026-08-02T10:30:00.000Z', closed_at: '2026-08-02T10:30:00.000Z' });
    await seed(2, { state: 'closed', merged_at: null, closed_at: '2026-08-03T00:00:00.000Z' });
    await seed(3, { state: 'open', merged_at: null, closed_at: null });
    await seed(4, { state: 'merged', merged_at: '2026-08-04T00:00:00.000Z' });
    await seed(5, { state: 'closed' });

    expect(await migrateUp(pool)).toEqual(['032', '033', '034', '035', '036', '037']);
    const after = await states();
    expect(Object.fromEntries(Object.entries(after).map(([pr, row]) => [pr, row.state]))).toEqual({
      1: 'merged',
      2: 'closed',
      3: 'open',
      4: 'merged',
      5: 'closed',
    });
    expect(Object.values(after).every((row) => row.version === 1_754_042_400_000)).toBe(true);

    // 되돌림은 결정적이다 — 병합된 PR의 GitHub 원시 state는 언제나 closed다.
    expect(await migrateDown(pool, 6)).toEqual(['037', '036', '035', '034', '033', '032']);
    expect(Object.fromEntries(Object.entries(await states()).map(([pr, row]) => [pr, row.state]))).toEqual({
      1: 'closed',
      2: 'closed',
      3: 'open',
      4: 'closed',
      5: 'closed',
    });
    expect(await migrateUp(pool)).toEqual(['032', '033', '034', '035', '036', '037']);
  });
});
