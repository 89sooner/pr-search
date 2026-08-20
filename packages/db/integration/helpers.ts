/**
 * 통합 테스트 공용 헬퍼.
 *
 * 실제 PostgreSQL에 붙는다. 접속 정보는 환경 변수에서 읽고, 테스트 기본 DB는
 * `prs_test`다 — 개발용 `prs`를 테스트가 지우지 않도록 분리한다.
 */

import type { Pool } from 'pg';
import { createPool } from '../src/pool.js';
import { resolvePoolConfig } from '../src/config.js';
import { migrateUp } from '../src/migrate.js';
import { ensureAllPartitions } from '../src/partitions.js';

export function createTestPool(): Pool {
  const env = { ...process.env };
  if (env['DATABASE_URL'] === undefined || env['DATABASE_URL'] === '') {
    env['POSTGRES_DB'] = env['POSTGRES_TEST_DB'] ?? 'prs_test';
  }
  return createPool(resolvePoolConfig(env));
}

/** 스키마를 적용하고 파티션까지 만든 풀을 돌려준다. 여러 번 불러도 안전하다. */
export async function migratedPool(): Promise<Pool> {
  const pool = createTestPool();
  await migrateUp(pool);
  await ensureAllPartitions(pool, 3);
  return pool;
}

/** PostgreSQL 유니크 위반 SQLSTATE. */
export const UNIQUE_VIOLATION = '23505';

export function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code: unknown }).code)
    : undefined;
}

/** 테이블 목록을 비운다. 파티션 테이블도 TRUNCATE로 함께 비워진다. */
export async function truncate(pool: Pool, ...tables: string[]): Promise<void> {
  if (tables.length === 0) return;
  await pool.query(`TRUNCATE ${tables.join(', ')} RESTART IDENTITY CASCADE`);
}
