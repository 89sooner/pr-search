/**
 * 마이그레이션 러너.
 *
 * `migrations/` 아래 `<version>_<name>.up.sql` / `.down.sql` 쌍을 버전 순으로
 * 적용·회수한다. 각 마이그레이션은 단일 트랜잭션에서 실행되므로 중간에 실패하면
 * 그 마이그레이션만 통째로 롤백된다.
 *
 * 적용 이력은 `schema_migration` 테이블에 남는다. up은 미적용분 전부를 적용하고,
 * down은 그 역연산으로 적용분 전부를 회수한다 (`--step N`으로 개수 제한 가능).
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Pool } from 'pg';
import { withTransaction } from './pool.js';

export const MIGRATIONS_DIR = fileURLToPath(new URL('../migrations', import.meta.url));

export interface Migration {
  readonly version: string;
  readonly name: string;
  readonly upPath: string;
  readonly downPath: string;
}

const FILE_PATTERN = /^(\d+)_(.+)\.up\.sql$/;

export function loadMigrations(dir: string = MIGRATIONS_DIR): Migration[] {
  return readdirSync(dir)
    .map((file) => FILE_PATTERN.exec(file))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => ({
      version: match[1]!,
      name: match[2]!,
      upPath: join(dir, `${match[1]!}_${match[2]!}.up.sql`),
      downPath: join(dir, `${match[1]!}_${match[2]!}.down.sql`),
    }))
    .sort((a, b) => a.version.localeCompare(b.version));
}

async function ensureMigrationTable(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migration (
      version    TEXT        PRIMARY KEY,
      name       TEXT        NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

export async function appliedVersions(pool: Pool): Promise<string[]> {
  await ensureMigrationTable(pool);
  const result = await pool.query<{ version: string }>(
    'SELECT version FROM schema_migration ORDER BY version',
  );
  return result.rows.map((row) => row.version);
}

/** 미적용 마이그레이션을 순서대로 적용하고, 적용한 버전 목록을 돌려준다. */
export async function migrateUp(pool: Pool, dir?: string): Promise<string[]> {
  const applied = new Set(await appliedVersions(pool));
  const pending = loadMigrations(dir).filter((migration) => !applied.has(migration.version));
  const done: string[] = [];

  for (const migration of pending) {
    const sql = readFileSync(migration.upPath, 'utf8');
    await withTransaction(pool, async (client) => {
      await client.query(sql);
      await client.query('INSERT INTO schema_migration (version, name) VALUES ($1, $2)', [
        migration.version,
        migration.name,
      ]);
    });
    done.push(migration.version);
  }

  return done;
}

/**
 * 적용된 마이그레이션을 최신 순으로 회수한다.
 *
 * @param step 회수할 개수. 생략하면 적용분 전부를 회수한다 (up의 역연산).
 */
export async function migrateDown(pool: Pool, step?: number, dir?: string): Promise<string[]> {
  const applied = await appliedVersions(pool);
  const byVersion = new Map(loadMigrations(dir).map((migration) => [migration.version, migration]));
  const targets = applied.slice().reverse().slice(0, step ?? applied.length);
  const done: string[] = [];

  for (const version of targets) {
    const migration = byVersion.get(version);
    if (migration === undefined) {
      throw new Error(`적용 이력에 있는 ${version} 마이그레이션 파일을 찾지 못했다`);
    }

    const sql = readFileSync(migration.downPath, 'utf8');
    await withTransaction(pool, async (client) => {
      await client.query(sql);
      await client.query('DELETE FROM schema_migration WHERE version = $1', [version]);
    });
    done.push(version);
  }

  return done;
}
