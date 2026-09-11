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
 * 읽기 전용 일관 스냅숏 (WP-074 / API-SEQ-007, 상세 설계 9절).
 *
 * ## 왜 필요한가
 *
 * `Pool`에 문장을 여러 번 보내면 **문장마다 다른 커넥션**일 수 있고, 각자 자기
 * 시점의 스냅숏을 본다. 그 사이에 재채번이 커밋하면 한 응답 안에서 공간은 옛
 * 에폭을, 행은 새 에폭을 말하게 된다 — 화면은 에폭 4를 적으면서 에폭 5의 링크를
 * 만든다. 계약이 "REPEATABLE READ read-only transaction 또는 단일 SQL snapshot"을
 * 요구하는 이유가 그것이다.
 *
 * ## `READ ONLY`를 함께 거는 이유
 *
 * 조회 경로가 실수로 쓰기를 하면 **DB가 거절한다.** 규율을 주석이 아니라 엔진이
 * 지키게 한다 — 측정 CLI가 같은 이유로 `BEGIN READ ONLY`를 쓴다.
 *
 * 커밋하지 않고 `ROLLBACK`으로 닫는다. 읽기만 했으므로 되돌릴 것이 없고, 성공과
 * 실패가 같은 문장을 쓰면 한쪽만 빠뜨리는 날이 없다.
 */
export async function withReadSnapshot<T>(pool: Pool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    return await fn(client);
  } finally {
    try {
      await client.query('ROLLBACK');
    } catch {
      // 연결이 이미 끊겼다. 되돌릴 것이 없으므로 원래 오류를 가리지 않는다.
    }
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
