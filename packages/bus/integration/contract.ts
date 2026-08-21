/**
 * `EventBus` 어댑터 계약 (WP-005 DoD 3).
 *
 * 이 파일이 곧 ADR-002가 말하는 "어댑터 교체 가능"의 정의다. 장래
 * `KafkaEventBus`는 이 스위트를 그대로 통과해야 하고, 통과하지 못하면 워커
 * 코드를 바꾸지 않고 갈아 끼울 수 없다는 뜻이다.
 *
 * 그래서 여기에는 Redis에만 있는 개념(스트림 ID, PEL, XAUTOCLAIM)이 한 번도
 * 나오지 않는다. 포트의 약속만 검증한다.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TOPICS, deadLetter, deferUntil, type DeliveredEvent, type EventBus, type EventEnvelope } from '@prs/bus';

/** 계약 테스트가 쓰는 토픽. 파티션 수를 고정해 카탈로그 변경과 분리한다. */
export const CONTRACT_TOPIC = TOPICS.ingest;
export const CONTRACT_GROUP = 'enrich';
export const CONTRACT_PARTITIONS = 4;

export interface BusFixture {
  readonly bus: EventBus;
  /** 테스트 사이의 상태를 지운다. */
  reset(): Promise<void>;
  dispose(): Promise<void>;
}

export type BusFactory = () => Promise<BusFixture>;

let counter = 0;

export function envelope(payload: unknown, name = 'ingestion.event_received'): EventEnvelope {
  counter += 1;
  return {
    event_id: `evt-${String(counter)}`,
    event_name: name,
    correlation_id: '0f0a1b2c-3d4e-5f60-7182-93a4b5c6d7e8',
    occurred_at: '2026-08-20T00:00:00.000Z',
    payload,
  };
}

export async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 5_000,
  label = '조건',
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`${label}이(가) ${String(timeoutMs)}ms 안에 충족되지 않았다`);
}

/**
 * 어댑터 하나에 대해 포트 계약 전체를 검증한다.
 *
 * @param adapterName 테스트 이름에 붙일 어댑터 이름
 * @param factory 매 테스트마다 깨끗한 버스를 만드는 팩토리
 */
export function runEventBusContract(adapterName: string, factory: BusFactory): void {
  describe(`${adapterName} — EventBus 계약 (ADR-002)`, () => {
    let fixture: BusFixture;
    let bus: EventBus;

    beforeEach(async () => {
      fixture = await factory();
      bus = fixture.bus;
      await fixture.reset();
    });

    afterEach(async () => {
      await fixture.dispose();
    });

    it('발행한 이벤트가 봉투 그대로 전달된다', async () => {
      const received: DeliveredEvent[] = [];
      const subscription = await bus.subscribe(
        CONTRACT_TOPIC,
        CONTRACT_GROUP,
        async (event) => {
          received.push(event);
        },
        { claimIdleMs: 50, blockMs: 50 },
      );

      try {
        await bus.publish(CONTRACT_TOPIC, '4021', envelope({ delivery_id: 'd-1', repository_id: 4021 }));
        await waitFor(() => received.length === 1, 5_000, '이벤트 전달');
      } finally {
        await subscription.close();
      }

      const event = received[0]!;
      expect(event.event_name).toBe('ingestion.event_received');
      expect(event.correlation_id).toBe('0f0a1b2c-3d4e-5f60-7182-93a4b5c6d7e8');
      expect(event.occurred_at).toBe('2026-08-20T00:00:00.000Z');
      expect(event.payload).toEqual({ delivery_id: 'd-1', repository_id: 4021 });
      expect(event.partition_key).toBe('4021');
      expect(event.delivery_count).toBe(1);
      expect(event.partition).toBeGreaterThanOrEqual(0);
      expect(event.partition).toBeLessThan(CONTRACT_PARTITIONS);
    });

    it('구독보다 먼저 발행된 이벤트도 전달된다', async () => {
      await bus.publish(CONTRACT_TOPIC, '4021', envelope({ order: 'before-subscribe' }));

      const received: DeliveredEvent[] = [];
      const subscription = await bus.subscribe(
        CONTRACT_TOPIC,
        CONTRACT_GROUP,
        async (event) => {
          received.push(event);
        },
        { claimIdleMs: 50, blockMs: 50 },
      );
      try {
        await waitFor(() => received.length === 1, 5_000, '이전 이벤트 전달');
      } finally {
        await subscription.close();
      }
      expect(received[0]?.payload).toEqual({ order: 'before-subscribe' });
    });

    it('DoD 1: 같은 파티션 키의 이벤트가 발행 순서대로 전달된다', async () => {
      const received: number[] = [];
      const subscription = await bus.subscribe(
        CONTRACT_TOPIC,
        CONTRACT_GROUP,
        async (event) => {
          received.push((event.payload as { index: number }).index);
        },
        { claimIdleMs: 50, blockMs: 50 },
      );

      try {
        for (let index = 0; index < 25; index += 1) {
          await bus.publish(CONTRACT_TOPIC, '4021', envelope({ index }));
        }
        await waitFor(() => received.length === 25, 10_000, '25건 전달');
      } finally {
        await subscription.close();
      }

      expect(received).toEqual(Array.from({ length: 25 }, (_value, index) => index));
    });

    it('DoD 1: 같은 파티션 키의 이벤트는 한 소비자에게만 간다', async () => {
      // 파티션을 둘로 갈라 서로 다른 소비자에게 맡긴다. 파티션 키가 같은
      // 이벤트가 두 소비자에게 흩어지면 순서 보장이 성립하지 않는다.
      const byConsumer = new Map<string, string[]>([
        ['low', []],
        ['high', []],
      ]);
      const keys = ['4021', '5150', '77', 'acme/payments@main', 'job-9'];

      const low = await bus.subscribe(
        CONTRACT_TOPIC,
        CONTRACT_GROUP,
        async (event) => {
          byConsumer.get('low')?.push(event.partition_key);
        },
        { partitions: [0, 1], consumer: 'low', claimIdleMs: 50, blockMs: 50 },
      );
      const high = await bus.subscribe(
        CONTRACT_TOPIC,
        CONTRACT_GROUP,
        async (event) => {
          byConsumer.get('high')?.push(event.partition_key);
        },
        { partitions: [2, 3], consumer: 'high', claimIdleMs: 50, blockMs: 50 },
      );

      try {
        for (const key of keys) {
          for (let repeat = 0; repeat < 4; repeat += 1) {
            await bus.publish(CONTRACT_TOPIC, key, envelope({ key, repeat }));
          }
        }
        await waitFor(
          () => (byConsumer.get('low')?.length ?? 0) + (byConsumer.get('high')?.length ?? 0) === keys.length * 4,
          10_000,
          '전량 전달',
        );
      } finally {
        await low.close();
        await high.close();
      }

      for (const key of keys) {
        const inLow = (byConsumer.get('low') ?? []).filter((value) => value === key).length;
        const inHigh = (byConsumer.get('high') ?? []).filter((value) => value === key).length;
        // 한쪽이 4건 전부를 받고 다른 쪽은 0이어야 한다.
        expect([inLow, inHigh].filter((count) => count > 0)).toHaveLength(1);
        expect(inLow + inHigh).toBe(4);
      }
    });

    it('DoD 2: 핸들러가 던지면 ack하지 않고 재전달한다. 전달 횟수가 올라간다', async () => {
      const attempts: number[] = [];
      const subscription = await bus.subscribe(
        CONTRACT_TOPIC,
        CONTRACT_GROUP,
        async (event) => {
          attempts.push(event.delivery_count);
          if (attempts.length < 3) throw new Error('일시 실패');
        },
        { claimIdleMs: 50, blockMs: 50, onError: () => undefined },
      );

      try {
        await bus.publish(CONTRACT_TOPIC, '4021', envelope({ delivery_id: 'retry-me' }));
        await waitFor(() => attempts.length >= 3, 10_000, '재전달 3회');
      } finally {
        await subscription.close();
      }

      expect(attempts.length).toBeGreaterThanOrEqual(3);
      // 첫 전달은 1이고, 재전달마다 올라간다.
      expect(attempts[0]).toBe(1);
      expect(attempts[attempts.length - 1]).toBeGreaterThan(1);
    });

    it('DoD 2: 소비자가 ack 전에 죽으면 다음 소비자가 이어받는다', async () => {
      const firstSeen: string[] = [];
      const dying = await bus.subscribe(
        CONTRACT_TOPIC,
        CONTRACT_GROUP,
        async (event) => {
          firstSeen.push(event.event_id);
          throw new Error('소비자 장애');
        },
        { consumer: 'dying', claimIdleMs: 50, blockMs: 50, onError: () => undefined },
      );

      await bus.publish(CONTRACT_TOPIC, '4021', envelope({ delivery_id: 'orphan' }));
      await waitFor(() => firstSeen.length >= 1, 5_000, '첫 소비자 수신');
      await dying.close();

      const secondSeen: DeliveredEvent[] = [];
      const successor = await bus.subscribe(
        CONTRACT_TOPIC,
        CONTRACT_GROUP,
        async (event) => {
          secondSeen.push(event);
        },
        { consumer: 'successor', claimIdleMs: 50, blockMs: 50 },
      );

      try {
        await waitFor(() => secondSeen.length >= 1, 10_000, '후임 소비자 회수');
      } finally {
        await successor.close();
      }

      expect(secondSeen[0]?.payload).toEqual({ delivery_id: 'orphan' });
      // 회수된 이벤트는 재전달이므로 전달 횟수가 1보다 크다.
      expect(secondSeen[0]?.delivery_count).toBeGreaterThan(1);
    });

    it('실패한 이벤트를 건너뛰고 다음 것을 처리하지 않는다 — 순서가 깨진다', async () => {
      const order: number[] = [];
      let failuresLeft = 2;
      const subscription = await bus.subscribe(
        CONTRACT_TOPIC,
        CONTRACT_GROUP,
        async (event) => {
          const index = (event.payload as { index: number }).index;
          if (index === 0 && failuresLeft > 0) {
            failuresLeft -= 1;
            throw new Error('첫 이벤트 일시 실패');
          }
          order.push(index);
        },
        { claimIdleMs: 50, blockMs: 50, onError: () => undefined },
      );

      try {
        for (let index = 0; index < 4; index += 1) {
          await bus.publish(CONTRACT_TOPIC, '4021', envelope({ index }));
        }
        await waitFor(() => order.length === 4, 10_000, '4건 전달');
      } finally {
        await subscription.close();
      }

      // 0번이 두 번 실패했어도 1번이 그 앞에 오면 안 된다.
      expect(order).toEqual([0, 1, 2, 3]);
    });

    it('서로 다른 파티션 키는 여러 파티션에 퍼진다', async () => {
      const partitions = new Set<number>();
      const subscription = await bus.subscribe(
        CONTRACT_TOPIC,
        CONTRACT_GROUP,
        async (event) => {
          partitions.add(event.partition);
        },
        { claimIdleMs: 50, blockMs: 50 },
      );

      try {
        for (let index = 0; index < 40; index += 1) {
          await bus.publish(CONTRACT_TOPIC, `repo-${String(index)}`, envelope({ index }));
        }
        await waitFor(() => partitions.size > 1, 10_000, '2개 이상 파티션 사용');
      } finally {
        await subscription.close();
      }

      expect(partitions.size).toBeGreaterThan(1);
    });

    it('close 이후에는 더 전달하지 않는다', async () => {
      const received: string[] = [];
      const subscription = await bus.subscribe(
        CONTRACT_TOPIC,
        CONTRACT_GROUP,
        async (event) => {
          received.push(event.event_id);
        },
        { claimIdleMs: 50, blockMs: 50 },
      );
      await bus.publish(CONTRACT_TOPIC, '4021', envelope({ index: 0 }));
      await waitFor(() => received.length === 1, 5_000, '첫 이벤트');
      await subscription.close();

      await bus.publish(CONTRACT_TOPIC, '4021', envelope({ index: 1 }));
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(received).toHaveLength(1);
    });

    it('CR-010: `defer`는 지정 시각 전에 다시 전달하지 않고 재시도 예산을 쓰지 않는다', async () => {
      const attempts: number[] = [];
      const deferUntilTime = Date.now() + 400;
      const subscription = await bus.subscribe(
        CONTRACT_TOPIC,
        CONTRACT_GROUP,
        async (event) => {
          attempts.push(event.delivery_count);
          // 아직 때가 아니라고 말한다. 실패가 아니다.
          return Date.now() < deferUntilTime ? deferUntil(new Date(deferUntilTime)) : undefined;
        },
        { claimIdleMs: 20, blockMs: 20 },
      );

      try {
        await bus.publish(CONTRACT_TOPIC, '4021', envelope({ delivery_id: 'deferred' }));
        await waitFor(() => attempts.length >= 2, 5_000, '유예 후 재전달');
      } finally {
        await subscription.close();
      }

      // 유예 동안 폭주하지 않았다.
      expect(attempts.length).toBeLessThan(6);
      // 전달 횟수가 오르지 않는다 — 한도 대기는 재시도가 아니다.
      expect(attempts.every((count) => count === 1)).toBe(true);
    });

    it('CR-010: `retry`는 표준 백오프로 재시도하며 전달 횟수를 올린다', async () => {
      const counts: number[] = [];
      const subscription = await bus.subscribe(
        CONTRACT_TOPIC,
        CONTRACT_GROUP,
        async (event) => {
          counts.push(event.delivery_count);
          return counts.length < 2 ? { kind: 'retry' as const } : undefined;
        },
        { claimIdleMs: 20, blockMs: 20, onError: () => undefined },
      );

      try {
        await bus.publish(CONTRACT_TOPIC, '4021', envelope({ delivery_id: 'retried' }));
        await waitFor(() => counts.length >= 2, 10_000, '재시도');
      } finally {
        await subscription.close();
      }
      expect(counts[0]).toBe(1);
      expect(counts[1]).toBe(2);
    });

    it('CR-010: `dead_letter`는 ack해서 파티션을 푼다', async () => {
      const seen: string[] = [];
      const subscription = await bus.subscribe(
        CONTRACT_TOPIC,
        CONTRACT_GROUP,
        async (event) => {
          const payload = event.payload as { index: number };
          seen.push(String(payload.index));
          // 첫 이벤트를 종료 처리한다. 막히지 않고 다음이 와야 한다.
          return payload.index === 0 ? deadLetter('테스트') : undefined;
        },
        { claimIdleMs: 20, blockMs: 20 },
      );

      try {
        await bus.publish(CONTRACT_TOPIC, '4021', envelope({ index: 0 }));
        await bus.publish(CONTRACT_TOPIC, '4021', envelope({ index: 1 }));
        await waitFor(() => seen.includes('1'), 5_000, '파티션 진행');
      } finally {
        await subscription.close();
      }
      expect(seen).toEqual(['0', '1']);
    });

    it('CR-010: 유예 중인 파티션이 다른 파티션을 막지 않는다', async () => {
      // 같은 파티션에 몰리지 않도록 서로 다른 파티션에 떨어지는 키를 고른다.
      const keys = ['4021', '5150', '77', 'job-9', 'acme/payments@main'];
      const { partitionFor } = await import('@prs/bus');
      const byPartition = new Map<number, string>();
      for (const key of keys) byPartition.set(partitionFor(key, CONTRACT_PARTITIONS), key);
      const distinct = [...byPartition.values()];
      if (distinct.length < 2) return; // 파티션이 갈리지 않으면 이 성질을 볼 수 없다

      const [deferredKey, freeKey] = distinct as [string, string];
      const processed: string[] = [];
      const subscription = await bus.subscribe(
        CONTRACT_TOPIC,
        CONTRACT_GROUP,
        async (event) => {
          if (event.partition_key === deferredKey) {
            return deferUntil(new Date(Date.now() + 30_000));
          }
          processed.push(event.partition_key);
          return undefined;
        },
        { claimIdleMs: 20, blockMs: 20 },
      );

      try {
        await bus.publish(CONTRACT_TOPIC, deferredKey, envelope({ which: 'deferred' }));
        await bus.publish(CONTRACT_TOPIC, freeKey, envelope({ which: 'free' }));
        // 30초 유예에 갇히지 않고 다른 파티션이 진행돼야 한다.
        await waitFor(() => processed.includes(freeKey), 5_000, '다른 파티션 진행');
      } finally {
        await subscription.close();
      }
      expect(processed).toContain(freeKey);
    });

    it('WP-010: 대기 길이는 처리량이 아니라 적체를 센다', async () => {
      // `XLEN`을 쓰면 잘 도는 파이프라인일수록 값이 커진다. 소비된 것은 빠져야
      // "적체"라는 말이 성립한다 (FR-ADMIN-001 AC-1).
      expect(await bus.depth(CONTRACT_TOPIC)).toBe(0);

      await bus.publish(CONTRACT_TOPIC, '4021', envelope({ index: 0 }));
      await bus.publish(CONTRACT_TOPIC, '5150', envelope({ index: 1 }));
      expect(await bus.depth(CONTRACT_TOPIC)).toBe(2);

      const seen: number[] = [];
      const subscription = await bus.subscribe(
        CONTRACT_TOPIC,
        CONTRACT_GROUP,
        async (event) => {
          seen.push((event.payload as { index: number }).index);
        },
        { claimIdleMs: 50, blockMs: 50 },
      );

      try {
        await waitFor(() => seen.length === 2, 5_000, '두 건 소비');
        await waitFor(async () => (await bus.depth(CONTRACT_TOPIC)) === 0, 5_000, '적체 해소');
      } finally {
        await subscription.close();
      }

      expect(await bus.depth(CONTRACT_TOPIC)).toBe(0);
    });

    it('WP-010: ack되지 않은 이벤트는 계속 적체로 센다', async () => {
      const subscription = await bus.subscribe(
        CONTRACT_TOPIC,
        CONTRACT_GROUP,
        async () => {
          throw new Error('처리 실패');
        },
        { claimIdleMs: 60_000, blockMs: 50, onError: () => undefined },
      );

      try {
        await bus.publish(CONTRACT_TOPIC, '4021', envelope({ index: 0 }));
        // 전달됐지만 ack되지 않았다. 사라지지 않아야 한다.
        await new Promise((resolve) => setTimeout(resolve, 300));
        expect(await bus.depth(CONTRACT_TOPIC)).toBe(1);
      } finally {
        await subscription.close();
      }
    });

    it('카탈로그에 없는 토픽은 발행도 구독도 거부한다', async () => {
      await expect(bus.publish('prs:typo', '4021', envelope({}))).rejects.toThrow(/알 수 없는 토픽/);
      await expect(
        bus.subscribe('prs:typo', CONTRACT_GROUP, async () => undefined),
      ).rejects.toThrow(/알 수 없는 토픽/);
    });

    it('파티션 범위를 벗어난 구독을 거부한다', async () => {
      await expect(
        bus.subscribe(CONTRACT_TOPIC, CONTRACT_GROUP, async () => undefined, {
          partitions: [CONTRACT_PARTITIONS],
        }),
      ).rejects.toThrow(/파티션 범위/);
    });

    it('빈 파티션 키로는 발행할 수 없다', async () => {
      await expect(bus.publish(CONTRACT_TOPIC, '', envelope({}))).rejects.toThrow(/파티션 키가 비어/);
    });
  });
}
