/**
 * durable 저장 (FR-ING-001 AC-3, FR-ING-002, FR-ING-003).
 *
 * 저장 성공 뒤에만 202가 나간다. 여기서 던진 예외는 그대로 500이 되어 GHE의
 * 재전송을 부른다 — 삼키면 그 이벤트는 영영 없어진다.
 *
 * 큐 enqueue는 WP-005에서 붙는다. 그때까지 `queued_at`은 NULL로 남고, 아웃박스
 * 재적재 잡(JOB-ING-007)은 `queued_at IS NOT NULL`만 보므로 서로 밟지 않는다.
 */

import { advisoryXactLock, deliveryLockKey, rawEventRepo, withTransaction } from '@prs/db';
import type { Pool, RawEventInsert } from '@prs/db';

/** PostgreSQL 유니크 위반 SQLSTATE. */
const UNIQUE_VIOLATION = '23505';

export interface StoreOutcome {
  readonly duplicate: boolean;
}

export type RawEventStore = (event: RawEventInsert) => Promise<StoreOutcome>;

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    String((error as { code: unknown }).code) === UNIQUE_VIOLATION
  );
}

/**
 * 같은 전달 식별자에 대한 동시 처리를 트랜잭션 범위 락으로 직렬화하고,
 * 아직 없을 때만 저장한다.
 *
 * 락 → 조건부 INSERT → (마지막 방어선) 유니크 위반 순으로 세 겹이다. 앞의 둘이
 * 이 스키마에서 실제로 중복을 잡고, 셋째는 같은 마이크로초에 두 번 도착한
 * 경우를 위한 것이다.
 */
export function createRawEventStore(pool: Pool, lockTimeoutMs?: number): RawEventStore {
  return async (event: RawEventInsert): Promise<StoreOutcome> => {
    return withTransaction(pool, async (client) => {
      if (lockTimeoutMs === undefined) {
        await advisoryXactLock(client, deliveryLockKey(event.delivery_id));
      } else {
        await advisoryXactLock(client, deliveryLockKey(event.delivery_id), lockTimeoutMs);
      }

      try {
        const inserted = await rawEventRepo.insertRawEventIfAbsent(client, event);
        return { duplicate: !inserted };
      } catch (error) {
        if (isUniqueViolation(error)) return { duplicate: true };
        throw error;
      }
    });
  };
}
