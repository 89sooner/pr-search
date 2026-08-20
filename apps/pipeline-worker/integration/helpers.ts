/** 워커 통합 테스트 공용 헬퍼. 실제 PostgreSQL과 실제 Redis에 붙는다. */

import { createPool, ensureAllPartitions, migrateUp, resolvePoolConfig, type Pool } from '@prs/db';
import { createRedisClient, type Redis } from '@prs/bus';

export async function migratedPool(): Promise<Pool> {
  const env = { ...process.env };
  if (env['DATABASE_URL'] === undefined || env['DATABASE_URL'] === '') {
    env['POSTGRES_DB'] = env['POSTGRES_TEST_DB'] ?? 'prs_test';
  }
  const pool = createPool(resolvePoolConfig(env));
  await migrateUp(pool);
  await ensureAllPartitions(pool, 3);
  return pool;
}

/** 워커 테스트 전용 Redis DB. 버스 계약 테스트(15번)와 겹치지 않게 13번을 쓴다. */
export function createTestRedis(): Redis {
  const base = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
  return createRedisClient({
    url: `${base.replace(/\/\d+$/, '')}/13`,
    maxRetriesPerRequest: 1,
    connectTimeoutMs: 2_000,
    commandTimeoutMs: 2_000,
  });
}
