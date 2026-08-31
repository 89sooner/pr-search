import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appliedVersions, loadMigrations, migrateDown, migrateUp } from '../src/migrate.js';
import { ensureAllPartitions } from '../src/partitions.js';
import { createTestPool } from './helpers.js';

describe('마이그레이션 (WP-002 DoD 1: migrate 후 --down이 스키마를 원복한다)', () => {
  let pool: Pool;

  beforeAll(() => {
    pool = createTestPool();
  });

  afterAll(async () => {
    // 뒤 테스트 파일들이 스키마를 전제로 하므로 적용 상태로 되돌려 둔다.
    await migrateUp(pool);
    await ensureAllPartitions(pool, 3);
    await pool.end();
  });

  it('마이그레이션 파일이 up/down 쌍으로 존재한다', () => {
    const migrations = loadMigrations();
    expect(migrations.length).toBeGreaterThanOrEqual(5);
    expect(migrations.map((m) => m.version)).toEqual([...migrations.map((m) => m.version)].sort());
  });

  it('up이 전 마이그레이션을 적용하고 데이터 모델 3장의 테이블을 만든다', async () => {
    await migrateDown(pool);
    await migrateUp(pool);

    const expected = [
      'raw_event', 'dead_letter',
      'sequence_space', 'merge_sequence', 'safe_marker', 'bisect_session',
      'repository', 'app_user', 'team', 'team_member', 'permission_cache',
      'team_membership', 'org_team_sync',
      'saved_search', 'job', 'audit_record',
    ];

    const result = await pool.query<{ tablename: string }>(
      `SELECT c.relname AS tablename FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')`,
    );
    const actual = new Set(result.rows.map((row) => row.tablename));

    for (const table of expected) expect(actual).toContain(table);
  });

  it('down이 적용분 전부를 회수해 스키마를 비운다', async () => {
    await migrateUp(pool);
    const reverted = await migrateDown(pool);

    expect(reverted.length).toBeGreaterThanOrEqual(5);
    expect(await appliedVersions(pool)).toEqual([]);

    const result = await pool.query<{ tablename: string }>(
      `SELECT c.relname AS tablename FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND c.relname <> 'schema_migration'`,
    );
    expect(result.rows.map((row) => row.tablename)).toEqual([]);
  });

  it('down 후 다시 up하면 같은 스키마로 복원된다', async () => {
    await migrateUp(pool);
    const versions = await appliedVersions(pool);
    expect(versions).toEqual(loadMigrations().map((m) => m.version));
  });

  it('--step 1은 최신 하나만 회수한다', async () => {
    await migrateUp(pool);
    const before = await appliedVersions(pool);

    const reverted = await migrateDown(pool, 1);
    expect(reverted).toHaveLength(1);
    expect(await appliedVersions(pool)).toEqual(before.slice(0, -1));

    await migrateUp(pool);
  });
});
