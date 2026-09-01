/**
 * 멱등 저장의 동시성 보장 (FR-ING-002 AC-1, DEV-009).
 *
 * `webhook.test.ts`의 "동시에 여덟 번" 테스트는 타이밍에 기대므로 락이 없어도
 * 우연히 통과할 수 있다. 여기서는 두 트랜잭션의 순서를 직접 붙잡아, 락이
 * 있을 때와 없을 때가 실제로 갈리는 것을 결정론적으로 확인한다.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { advisoryXactLock, deliveryLockKey, rawEventRepo, type Pool, type RawEventInsert } from '@prs/db';
import { migratedPool, truncateRawEvents } from './helpers.js';
import { createRawEventStore } from '../src/store.js';

let pool: Pool;

beforeAll(async () => {
  pool = await migratedPool({ fixtureMonths: ['2026-08'] });
});

afterAll(async () => {
  await pool.end();
});

afterEach(async () => {
  await truncateRawEvents(pool);
});

const event = (deliveryId: string, receivedAt: Date): RawEventInsert => ({
  delivery_id: deliveryId,
  event_type: 'pull_request',
  action: 'closed',
  repository_id: 4021,
  received_at: receivedAt,
  payload: { number: 1234 },
  payload_hash: 'a'.repeat(64),
  correlation_id: '0f0a1b2c-3d4e-5f60-7182-93a4b5c6d7e8',
});

async function countByDeliveryId(deliveryId: string): Promise<number> {
  const result = await pool.query<{ count: string }>(
    'SELECT count(*) AS count FROM raw_event WHERE delivery_id = $1',
    [deliveryId],
  );
  return Number(result.rows[0]?.count ?? '0');
}

describe('DEV-009: 기본 키만으로는 재전송 중복을 막지 못한다', () => {
  /**
   * `raw_event`는 `received_at` 범위 파티션이고 PostgreSQL은 파티션 테이블의
   * 유일 제약이 파티션 키를 포함하도록 요구한다. 그래서 기본 키가
   * `(delivery_id, received_at)`이고, 수신 시각이 다른 재전송은 충돌하지 않는다.
   * 이 테스트가 실패하기 시작하면 스키마가 바뀐 것이므로 DEV-009를 닫아도 된다.
   */
  it('수신 시각만 다른 같은 전달 식별자가 기본 키 충돌 없이 두 번 들어간다', async () => {
    const deliveryId = 'dev009-pk-does-not-catch';
    await rawEventRepo.insertRawEvent(pool, event(deliveryId, new Date('2026-08-20T00:00:00.000Z')));
    await rawEventRepo.insertRawEvent(pool, event(deliveryId, new Date('2026-08-20T00:00:01.000Z')));
    expect(await countByDeliveryId(deliveryId)).toBe(2);
  });

  it('조건부 INSERT는 락 없이도 순차 재전송을 막는다', async () => {
    const deliveryId = 'dev009-sequential';
    expect(
      await rawEventRepo.insertRawEventIfAbsent(pool, event(deliveryId, new Date('2026-08-20T00:00:00.000Z'))),
    ).toBe(true);
    expect(
      await rawEventRepo.insertRawEventIfAbsent(pool, event(deliveryId, new Date('2026-08-20T00:00:01.000Z'))),
    ).toBe(false);
    expect(await countByDeliveryId(deliveryId)).toBe(1);
  });

  /**
   * READ COMMITTED에서 조건부 INSERT의 존재 검사는 문장 시작 시점 스냅숏을 본다.
   * 커밋되지 않은 남의 INSERT는 보이지 않으므로, 락이 없으면 둘 다 삽입된다.
   */
  it('락이 없으면 겹친 두 트랜잭션이 둘 다 삽입한다', async () => {
    const deliveryId = 'dev009-race-without-lock';
    const first = await pool.connect();
    const second = await pool.connect();
    try {
      await first.query('BEGIN');
      await second.query('BEGIN');

      expect(
        await rawEventRepo.insertRawEventIfAbsent(first, event(deliveryId, new Date('2026-08-20T00:00:00.000Z'))),
      ).toBe(true);
      // first가 아직 커밋하지 않았으므로 second는 아무것도 못 본다.
      expect(
        await rawEventRepo.insertRawEventIfAbsent(second, event(deliveryId, new Date('2026-08-20T00:00:01.000Z'))),
      ).toBe(true);

      await first.query('COMMIT');
      await second.query('COMMIT');
    } finally {
      first.release();
      second.release();
    }
    expect(await countByDeliveryId(deliveryId)).toBe(2);
  });
});

describe('FR-ING-002 AC-1: advisory lock이 같은 전달 식별자를 직렬화한다', () => {
  it('락을 쥔 트랜잭션이 커밋할 때까지 기다렸다가 중복으로 판정한다', async () => {
    const deliveryId = 'lock-serializes';
    const store = createRawEventStore(pool);
    const holder = await pool.connect();
    let storeSettled = false;

    try {
      await holder.query('BEGIN');
      await advisoryXactLock(holder, deliveryLockKey(deliveryId));

      // 락을 쥔 쪽이 아직 커밋하지 않은 동안 저장을 시작한다.
      const pending = store(event(deliveryId, new Date('2026-08-20T00:00:01.000Z'))).then((outcome) => {
        storeSettled = true;
        return outcome;
      });

      await new Promise((resolve) => setTimeout(resolve, 300));
      // 락이 실제로 걸렸다면 여기서 아직 끝나 있으면 안 된다.
      expect(storeSettled).toBe(false);

      await rawEventRepo.insertRawEventIfAbsent(holder, event(deliveryId, new Date('2026-08-20T00:00:00.000Z')));
      await holder.query('COMMIT');

      // 락이 풀린 뒤 다시 보고 중복으로 판정한다.
      expect(await pending).toEqual({ duplicate: true });
    } finally {
      holder.release();
    }

    expect(await countByDeliveryId(deliveryId)).toBe(1);
  });

  it('lock_timeout을 넘기면 조용히 저장을 건너뛰지 않고 예외를 던진다', async () => {
    const deliveryId = 'lock-timeout';
    const store = createRawEventStore(pool, 200);
    const holder = await pool.connect();

    try {
      await holder.query('BEGIN');
      await advisoryXactLock(holder, deliveryLockKey(deliveryId));

      // 저장하지 못했는데 202를 주면 그 이벤트는 사라진다. 반드시 던져야 한다.
      await expect(store(event(deliveryId, new Date('2026-08-20T00:00:01.000Z')))).rejects.toThrow();

      await holder.query('ROLLBACK');
    } finally {
      holder.release();
    }

    expect(await countByDeliveryId(deliveryId)).toBe(0);
  });
});
