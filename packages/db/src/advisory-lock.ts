/**
 * 시퀀스 채번 동시성 제어 (FR-SEQ-001 AC-6, 데이터 모델 3.2).
 *
 * 대기하지 않는 `pg_try_advisory_xact_lock`을 쓴다. 락을 얻지 못하면 잡을
 * 재큐에 넣고 종료한다 — 대기하면 워커가 묶이고 큐가 밀린다.
 */

import type { PoolClient } from 'pg';

/** 시퀀스 공간 하나에 대응하는 락 키 문자열. */
export function sequenceLockKey(repositoryId: number, baseBranch: string): string {
  return `seq:${String(repositoryId)}:${baseBranch}`;
}

/**
 * 트랜잭션 범위 advisory lock을 시도한다.
 *
 * @returns 락을 얻었으면 `true`. 다른 트랜잭션이 쥐고 있으면 즉시 `false`.
 */
export async function tryAdvisoryXactLock(client: PoolClient, key: string): Promise<boolean> {
  const result = await client.query<{ locked: boolean }>(
    'SELECT pg_try_advisory_xact_lock(hashtext($1)) AS locked',
    [key],
  );
  return result.rows[0]?.locked === true;
}

/** 시퀀스 공간 락. `tryAdvisoryXactLock`에 키 생성을 합친 것이다. */
export async function trySequenceSpaceLock(
  client: PoolClient,
  repositoryId: number,
  baseBranch: string,
): Promise<boolean> {
  return tryAdvisoryXactLock(client, sequenceLockKey(repositoryId, baseBranch));
}
