/**
 * 시퀀스 채번 동시성 제어 (FR-SEQ-001 AC-6, 데이터 모델 3.2).
 *
 * 대기하지 않는 `pg_try_advisory_xact_lock`을 쓴다. 락을 얻지 못하면 잡을
 * 재큐에 넣고 종료한다 — 대기하면 워커가 묶이고 큐가 밀린다.
 */

import type { PoolClient } from 'pg';

/** 웹훅 멱등 처리 락 키. 전달 식별자 하나가 동시에 두 번 저장되지 않게 한다 (FR-ING-002). */
export function deliveryLockKey(deliveryId: string): string {
  return `ingest:${deliveryId}`;
}

/**
 * 잡 claim 직렬화 락 키 (CR-022, DEV-107).
 *
 * 유형 단위다. 동시 실행 상한이 `(type, state='running')`의 수에 대한
 * 제약이므로, 같은 유형을 잡으려는 워커들만 줄을 서면 된다 — 백필이
 * 재색인의 claim을 막을 이유는 없다.
 */
export function jobClaimLockKey(type: string): string {
  return `job:claim:${type}`;
}

/** 시퀀스 공간 하나에 대응하는 락 키 문자열. */
export function sequenceLockKey(repositoryId: number, baseBranch: string): string {
  return `seq:${String(repositoryId)}:${baseBranch}`;
}

/**
 * 릴리스 스냅숏 갱신 락 키 (WP-024 / JOB-REL-007).
 *
 * 저장소 단위다 — 갱신이 전량 diff(upsert + 스냅숏 밖 삭제)라, 두 갱신이
 * 겹치면 한쪽의 upsert를 다른 쪽의 삭제가 지운다. 파티션이 저장소당 직렬을
 * 이미 만들지만 6시간 보정 스윕은 파티션 밖에서 돌므로 락이 이중 안전장치다.
 */
export function releaseLockKey(repositoryId: number): string {
  return `release:${String(repositoryId)}`;
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

/**
 * 대기하는 트랜잭션 범위 advisory lock.
 *
 * 채번과 달리 수집 경로는 **기다려야** 한다. 같은 전달 식별자가 동시에 두 번
 * 도착했을 때 재큐할 곳이 없기 때문이다 — 앞선 트랜잭션이 커밋할 때까지
 * 기다렸다가 중복인지 다시 본다. `lock_timeout`으로 대기를 잘라 수신 응답
 * 예산(NFR-002 p95 300ms)이 무한정 밀리지 않게 한다.
 */
export async function advisoryXactLock(
  client: PoolClient,
  key: string,
  lockTimeoutMs = 2_000,
): Promise<void> {
  await client.query(`SET LOCAL lock_timeout = ${String(Math.trunc(lockTimeoutMs))}`);
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [key]);
}

/** 시퀀스 공간 락. `tryAdvisoryXactLock`에 키 생성을 합친 것이다. */
export async function trySequenceSpaceLock(
  client: PoolClient,
  repositoryId: number,
  baseBranch: string,
): Promise<boolean> {
  return tryAdvisoryXactLock(client, sequenceLockKey(repositoryId, baseBranch));
}
