/**
 * 커넥션 풀과 트랜잭션 헬퍼.
 */

import pg from 'pg';
import type { Pool, PoolClient, PoolConfig } from 'pg';
import { resolvePoolConfig } from './config.js';

export function createPool(config: PoolConfig = resolvePoolConfig()): Pool {
  return new pg.Pool(config);
}

/**
 * 콜백을 단일 트랜잭션에서 실행한다.
 *
 * 트랜잭션 범위 advisory lock(`pg_try_advisory_xact_lock`)은 커밋·롤백 시점에
 * 자동으로 풀리므로, 채번 경로는 반드시 이 헬퍼 안에서 락을 잡아야 한다.
 */
export async function withTransaction<T>(pool: Pool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
