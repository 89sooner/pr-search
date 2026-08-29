/**
 * 커넥션 풀과 트랜잭션 헬퍼.
 */

import pg from 'pg';
import type { Pool, PoolClient, PoolConfig } from 'pg';
import { ADMIN_DB_ROLE, resolveAdminPoolConfig, resolvePoolConfig } from './config.js';
import { installTypeParsers } from './type-parsers.js';

export function createPool(config: PoolConfig = resolvePoolConfig()): Pool {
  // BIGINT를 문자열이 아니라 숫자로 받는다. 선언된 타입과 런타임 값을 맞춘다.
  installTypeParsers();
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

/**
 * 관리 권한 풀 (WP-039 / CR-054, DEV-411·416).
 *
 * 연결마다 `SET ROLE prs_admin`을 건다 — 풀은 연결을 재사용하므로 한 번
 * 실행하는 것으로는 부족하고, `pg`의 `connect` 이벤트가 새 물리 연결마다
 * 발생한다. **`SET ROLE`은 세션 단위이며 트랜잭션과 무관하다.**
 *
 * @returns 설정(`ADMIN_DATABASE_URL`)이 없으면 `null`. 호출부는 그때 보존
 * 잡만 세우지 않는다.
 */
export function createAdminPool(config = resolveAdminPoolConfig()): Pool | null {
  if (config === null) return null;
  installTypeParsers();
  const pool = new pg.Pool(config);
  pool.on('connect', (client) => {
    /*
     * 실패해도 여기서 던지지 않는다 — `connect` 핸들러의 예외는 풀 전체를
     * 불안정하게 만든다. 권한이 없으면 실제 `DROP`이 실패하고 그 실패가
     * 보존 결과의 `failed`에 담겨 드러난다.
     */
    void client.query(`SET ROLE ${ADMIN_DB_ROLE}`).catch(() => undefined);
  });
  return pool;
}
