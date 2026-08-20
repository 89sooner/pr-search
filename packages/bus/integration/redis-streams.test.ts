/**
 * Redis Streams 어댑터 (WP-005 DoD 1·2·3).
 *
 * 계약 스위트 전량에 더해, Redis에서만 확인할 수 있는 것을 본다 —
 * 파티션 스트림이 실제로 갈라져 만들어지는지, 미ack가 PEL에 남는지.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Redis } from 'ioredis';
import { RedisStreamsEventBus, partitionFor, partitionStream } from '@prs/bus';
import { CONTRACT_GROUP, CONTRACT_PARTITIONS, CONTRACT_TOPIC, envelope, runEventBusContract, waitFor, type BusFixture } from './contract.js';
import { TEST_PARTITION_OVERRIDES, createTestRedis, flushTestRedis } from './helpers.js';

runEventBusContract('RedisStreamsEventBus', async (): Promise<BusFixture> => {
  const redis = createTestRedis();
  const bus = new RedisStreamsEventBus(redis, { partitionOverrides: TEST_PARTITION_OVERRIDES });
  return {
    bus,
    reset: async (): Promise<void> => {
      await flushTestRedis(redis);
    },
    dispose: async (): Promise<void> => {
      await bus.close();
      redis.disconnect();
    },
  };
});

describe('RedisStreamsEventBus — Redis 고유 동작', () => {
  let redis: Redis;
  let bus: RedisStreamsEventBus;

  beforeAll(() => {
    redis = createTestRedis();
    bus = new RedisStreamsEventBus(redis, { partitionOverrides: TEST_PARTITION_OVERRIDES });
  });

  afterAll(async () => {
    await bus.close();
    redis.disconnect();
  });

  beforeEach(async () => {
    await flushTestRedis(redis);
  });

  it('토픽 하나가 파티션 스트림 여러 개로 갈라진다', async () => {
    for (let index = 0; index < 40; index += 1) {
      await bus.publish(CONTRACT_TOPIC, `repo-${String(index)}`, envelope({ index }));
    }

    const streams = await redis.keys(`${CONTRACT_TOPIC}:*`);
    expect(streams.length).toBeGreaterThan(1);
    expect(streams.length).toBeLessThanOrEqual(CONTRACT_PARTITIONS);
    for (const stream of streams) {
      expect(stream).toMatch(new RegExp(`^${CONTRACT_TOPIC}:\\d+$`));
    }
  });

  it('파티션 키가 해시로 정한 스트림에 정확히 들어간다', async () => {
    await bus.publish(CONTRACT_TOPIC, '4021', envelope({ repository_id: 4021 }));
    const expected = partitionStream(CONTRACT_TOPIC, partitionFor('4021', CONTRACT_PARTITIONS));
    expect(await redis.xlen(expected)).toBe(1);
  });

  it('ack하지 않은 이벤트가 PEL에 남는다 (재전달의 근거)', async () => {
    const stream = partitionStream(CONTRACT_TOPIC, partitionFor('4021', CONTRACT_PARTITIONS));
    let seen = 0;
    const subscription = await bus.subscribe(
      CONTRACT_TOPIC,
      CONTRACT_GROUP,
      async () => {
        seen += 1;
        throw new Error('처리 실패');
      },
      { claimIdleMs: 60_000, blockMs: 50, onError: () => undefined },
    );

    try {
      await bus.publish(CONTRACT_TOPIC, '4021', envelope({ delivery_id: 'stuck' }));
      await waitFor(() => seen >= 1, 5_000, '첫 전달');
      const pending = await redis.xpending(stream, CONTRACT_GROUP);
      expect(Array.isArray(pending) ? Number(pending[0]) : 0).toBe(1);
    } finally {
      await subscription.close();
    }
  });

  it('정상 처리한 이벤트는 PEL에 남지 않는다', async () => {
    const stream = partitionStream(CONTRACT_TOPIC, partitionFor('4021', CONTRACT_PARTITIONS));
    let seen = 0;
    const subscription = await bus.subscribe(
      CONTRACT_TOPIC,
      CONTRACT_GROUP,
      async () => {
        seen += 1;
      },
      { claimIdleMs: 60_000, blockMs: 50 },
    );

    try {
      await bus.publish(CONTRACT_TOPIC, '4021', envelope({ delivery_id: 'ok' }));
      await waitFor(() => seen === 1, 5_000, '전달');
      // ack는 핸들러 반환 직후에 나가므로 한 박자 준다.
      await new Promise((resolve) => setTimeout(resolve, 100));
      const pending = await redis.xpending(stream, CONTRACT_GROUP);
      expect(Array.isArray(pending) ? Number(pending[0]) : -1).toBe(0);
    } finally {
      await subscription.close();
    }
  });
});
