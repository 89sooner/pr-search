/**
 * JOB-ING-007 아웃박스 재적재 (WP-005 DoD 4, ADR-002 follow-up).
 *
 * 게이트웨이가 발행에 실패해도 이벤트가 유실되지 않는다는 것을 증명한다.
 * 실제 PostgreSQL과 실제 Redis를 쓴다 — 이 잡의 존재 이유가 "장애 뒤 복구"라
 * 목으로 확인하면 아무것도 증명하지 못한다.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { rawEventRepo, type Pool, type RawEventInsert, type RawEventRow } from '@prs/db';
import { RedisStreamsEventBus, TOPICS, partitionFor, partitionStream, type DeliveredEvent, type Redis } from '@prs/bus';
import { EVENT_NAMES, toIngestionEvent } from '@prs/domain';
import { relayOutboxOnce, startOutboxRelay } from '../src/outbox-relay.js';
import { createTestRedis, migratedPool } from './helpers.js';

let pool: Pool;
let redis: Redis;
let bus: RedisStreamsEventBus;

const NOW = new Date('2026-08-20T12:00:00.000Z');

beforeAll(async () => {
  pool = await migratedPool();
  redis = createTestRedis();
  bus = new RedisStreamsEventBus(redis);
});

afterAll(async () => {
  await bus.close();
  redis.disconnect();
  await pool.end();
});

beforeEach(async () => {
  await pool.query('TRUNCATE raw_event');
  await redis.flushdb();
});

/** 게이트웨이가 저장한 뒤 발행에 실패한 상태를 그대로 만든다. */
function strandedRow(overrides: Partial<RawEventInsert> = {}): RawEventInsert {
  return {
    delivery_id: 'stranded-1',
    event_type: 'pull_request',
    action: 'closed',
    repository_id: 4021,
    received_at: new Date(NOW.getTime() - 15 * 60 * 1_000),
    payload: { action: 'closed', number: 1234, repository: { id: 4021 } },
    payload_hash: 'a'.repeat(64),
    correlation_id: '0f0a1b2c-3d4e-5f60-7182-93a4b5c6d7e8',
    queued_at: new Date(NOW.getTime() - 15 * 60 * 1_000),
    ...overrides,
  };
}

async function insert(row: RawEventInsert): Promise<void> {
  await rawEventRepo.insertRawEventIfAbsent(pool, row);
}

async function streamLength(partitionKey: string): Promise<number> {
  const stream = partitionStream(TOPICS.ingest, partitionFor(partitionKey, bus.partitions(TOPICS.ingest)));
  return redis.xlen(stream);
}

describe('대상 판정 (비동기 문서 3장)', () => {
  it('queued_at이 10분 넘게 지나고 processed_at이 없는 행을 재적재한다', async () => {
    await insert(strandedRow());

    const result = await relayOutboxOnce(pool, bus, { now: () => NOW });

    expect(result).toEqual({ found: 1, relayed: 1, failed: 0 });
    expect(await streamLength('4021')).toBe(1);
  });

  it('아직 10분이 지나지 않은 행은 건드리지 않는다', async () => {
    await insert(
      strandedRow({
        delivery_id: 'fresh',
        queued_at: new Date(NOW.getTime() - 60 * 1_000),
        received_at: new Date(NOW.getTime() - 60 * 1_000),
      }),
    );

    const result = await relayOutboxOnce(pool, bus, { now: () => NOW });
    expect(result.found).toBe(0);
    expect(await streamLength('4021')).toBe(0);
  });

  it('이미 처리된 행은 다시 보내지 않는다', async () => {
    const row = strandedRow({ delivery_id: 'done' });
    await insert(row);
    await rawEventRepo.markProcessed(pool, 'done', row.received_at);

    const result = await relayOutboxOnce(pool, bus, { now: () => NOW });
    expect(result.found).toBe(0);
  });

  it('아웃박스 표식이 없는 행은 대상이 아니다', async () => {
    await insert(strandedRow({ delivery_id: 'no-marker', queued_at: null }));

    const result = await relayOutboxOnce(pool, bus, { now: () => NOW });
    expect(result.found).toBe(0);
  });

  it('재적재에 성공하면 타이머를 다시 감는다 — 다음 회차에 또 잡히지 않는다', async () => {
    await insert(strandedRow());

    await relayOutboxOnce(pool, bus, { now: () => NOW });
    const second = await relayOutboxOnce(pool, bus, { now: () => NOW });

    expect(second.found).toBe(0);
    expect(await streamLength('4021')).toBe(1);
  });

  it('재적재에 실패하면 타이머를 감지 않는다 — 다음 회차에서 다시 잡힌다', async () => {
    await insert(strandedRow());
    const brokenBus = {
      publish: async (): Promise<void> => {
        throw new Error('Redis 연결 없음');
      },
      subscribe: () => Promise.reject(new Error('사용하지 않는다')),
      close: async (): Promise<void> => undefined,
    };

    const first = await relayOutboxOnce(pool, brokenBus, { now: () => NOW });
    expect(first).toEqual({ found: 1, relayed: 0, failed: 1 });

    // 실패한 행이 그대로 남아 있어야 복구 후에 다시 보낼 수 있다.
    const second = await relayOutboxOnce(pool, bus, { now: () => NOW });
    expect(second).toEqual({ found: 1, relayed: 1, failed: 0 });
  });
});

describe('EVT-ING-001 봉투', () => {
  it('원본 행이 이벤트 payload로 그대로 옮겨진다', async () => {
    const row = strandedRow();
    await insert(row);
    await relayOutboxOnce(pool, bus, { now: () => NOW });

    const stream = partitionStream(TOPICS.ingest, partitionFor('4021', bus.partitions(TOPICS.ingest)));
    const entries = await redis.xrange(stream, '-', '+');
    const fields = new Map<string, string>();
    const raw = entries[0]?.[1] ?? [];
    for (let index = 0; index + 1 < raw.length; index += 2) {
      fields.set(String(raw[index]), String(raw[index + 1]));
    }

    expect(fields.get('event_name')).toBe(EVENT_NAMES.ingestionEventReceived);
    expect(fields.get('correlation_id')).toBe(row.correlation_id);
    expect(fields.get('partition_key')).toBe('4021');
    expect(JSON.parse(fields.get('payload') ?? '{}')).toEqual({
      delivery_id: 'stranded-1',
      event_type: 'pull_request',
      action: 'closed',
      repository_id: 4021,
      correlation_id: row.correlation_id,
      occurred_at: row.received_at.toISOString(),
    });
  });

  it('저장소를 알 수 없는 이벤트는 전달 식별자를 파티션 키로 쓴다', async () => {
    await insert(strandedRow({ delivery_id: 'org-event', event_type: 'team', repository_id: null }));
    await relayOutboxOnce(pool, bus, { now: () => NOW });
    expect(await streamLength('org-event')).toBe(1);
  });

  it('toIngestionEvent가 행을 카탈로그 payload로 옮긴다', () => {
    const received = new Date('2026-08-20T11:45:00.000Z');
    const row: RawEventRow = {
      ...strandedRow(),
      received_at: received,
      queued_at: received,
      processed_at: null,
    };
    expect(toIngestionEvent(row)).toEqual({
      delivery_id: 'stranded-1',
      event_type: 'pull_request',
      action: 'closed',
      repository_id: 4021,
      correlation_id: '0f0a1b2c-3d4e-5f60-7182-93a4b5c6d7e8',
      occurred_at: received.toISOString(),
    });
  });
});

describe('DoD 4 (뒤쪽): Redis 복구 후 유실된 이벤트가 소비자에게 도달한다', () => {
  it('발행되지 못한 채 남아 있던 이벤트를 소비자가 받는다', async () => {
    // 게이트웨이가 저장은 했는데 발행에 실패한 상태 (enqueue.test.ts가 그 상태가
    // 실제로 만들어짐을 증명한다). 큐는 비어 있다.
    await insert(strandedRow({ delivery_id: 'lost-in-outage' }));
    expect(await streamLength('4021')).toBe(0);

    const received: DeliveredEvent[] = [];
    const subscription = await bus.subscribe(
      TOPICS.ingest,
      'enrich',
      async (event) => {
        received.push(event);
      },
      { claimIdleMs: 50, blockMs: 50 },
    );

    try {
      // Redis가 돌아왔다. 재적재 잡이 한 회차를 돈다.
      const result = await relayOutboxOnce(pool, bus, { now: () => NOW });
      expect(result.relayed).toBe(1);

      const deadline = Date.now() + 5_000;
      while (received.length === 0 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    } finally {
      await subscription.close();
    }

    expect(received).toHaveLength(1);
    expect(received[0]?.payload).toMatchObject({ delivery_id: 'lost-in-outage', repository_id: 4021 });
    expect(received[0]?.partition_key).toBe('4021');
  });
});

describe('스케줄 실행', () => {
  it('주기적으로 회차를 돌고 stop으로 깔끔히 멈춘다', async () => {
    await insert(strandedRow({ delivery_id: 'scheduled' }));

    const relay = startOutboxRelay(pool, bus, { now: () => NOW, intervalMs: 20 });
    try {
      const deadline = Date.now() + 5_000;
      while ((await streamLength('4021')) === 0 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    } finally {
      await relay.stop();
    }

    expect(await streamLength('4021')).toBe(1);

    // 멈춘 뒤에는 더 돌지 않는다.
    await insert(strandedRow({ delivery_id: 'after-stop', repository_id: 5150 }));
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(await streamLength('5150')).toBe(0);
  });
});
