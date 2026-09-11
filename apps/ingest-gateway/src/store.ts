/**
 * durable 저장 (FR-ING-001 AC-3, FR-ING-002, FR-ING-003).
 *
 * 저장 성공 뒤에만 202가 나간다. 여기서 던진 예외는 그대로 500이 되어 GHE의
 * 재전송을 부른다 — 삼키면 그 이벤트는 영영 없어진다.
 *
 * 큐 enqueue는 WP-005에서 붙는다. 그때까지 `queued_at`은 NULL로 남고, 아웃박스
 * 재적재 잡(JOB-ING-007)은 `queued_at IS NOT NULL`만 보므로 서로 밟지 않는다.
 */

import {
  advisoryXactLock,
  deliveryLockKey,
  rawEventRepo,
  repositoryRepo,
  sequenceWorkRepo,
  withTransaction,
} from '@prs/db';
import type { Pool, PoolClient, RawEventInsert } from '@prs/db';
import { extractPushTarget } from '@prs/domain';

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

      let inserted: boolean;
      try {
        inserted = await rawEventRepo.insertRawEventIfAbsent(client, event);
      } catch (error) {
        if (isUniqueViolation(error)) return { duplicate: true };
        throw error;
      }
      if (inserted) await recordRefreshIntent(client, event);
      return { duplicate: !inserted };
    });
  };
}

/**
 * push의 채번 refresh 의도를 **원본과 같은 트랜잭션**에 남긴다 (WP-074 / CR-079,
 * FR-SEQ-008 AC-11, DEV-576 · DEV-582).
 *
 * ## 왜 발행이 아니라 저장인가
 *
 * `prs:sequence` 발행은 실패해도 202이고 아웃박스는 `prs:ingest`만 재적재한다. 그래서
 * 마지막 push의 채번 요청은 **어디에도 남지 않을 수 있었다.** 원본과 함께 커밋되는
 * 행은 그 구멍을 닫는다 — 발행은 여전히 빠른 길이고, 이 행은 durable한 길이다.
 *
 * ## 채번 대상 브랜치만 남긴다
 *
 * 저장소 행 하나를 기본 키로 읽는다 (같은 트랜잭션 안의 인덱스 탐색 한 번). 피처
 * 브랜치 push마다 행을 만들면 표가 push 수에 비례해 자란다. 미등록·보관·비대상은
 * 남기지 않는다 — 그 판정은 채번 워커도 같은 값으로 다시 한다.
 *
 * 실패는 **던진다.** 이 함수는 저장 트랜잭션 안에 있으므로 여기서 던지면 원본 저장도
 * 롤백되고 500이 되어 GHE가 다시 보낸다 — 원본은 있는데 의도만 없는 반쪽 커밋을
 * 남기지 않는다.
 */
async function recordRefreshIntent(client: PoolClient, event: RawEventInsert): Promise<void> {
  if (event.event_type !== 'push') return;
  const push = extractPushTarget(event.payload);
  if (push.kind !== 'target') return;

  const repository = await repositoryRepo.findRepositoryById(client, push.target.repositoryId);
  if (repository === undefined || repository.status !== 'active') return;
  if (!repository.sequence_branches.includes(push.target.baseBranch)) return;

  await sequenceWorkRepo.enqueueRefreshWork(client, {
    deliveryId: event.delivery_id,
    repositoryId: push.target.repositoryId,
    baseBranch: push.target.baseBranch,
    headSha: push.target.headSha,
    receivedAt: event.received_at,
    correlationId: event.correlation_id,
  });
}
