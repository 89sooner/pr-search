/**
 * 게이트웨이 → 큐 연결 (WP-005, JOB-ING-001, EVT-ING-001).
 *
 * WP-004가 남긴 경계를 잇는다. 여기서 확인하는 것은 두 가지다 —
 * 정상일 때 이벤트가 실제로 스트림에 들어가는가, 그리고 **Redis가 죽었을 때도
 * 202가 나가고 아웃박스 표식이 남는가** (WP-005 DoD 4의 앞쪽 절반).
 */

import { createServer, type Socket } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Pool } from '@prs/db';
import { EVENT_NAMES, ingestPartitionKey } from '@prs/domain';
import { RedisStreamsEventBus, TOPICS, createRedisClient, partitionFor, partitionStream } from '@prs/bus';
import type { Redis } from '@prs/bus';
import {
  countRawEvents,
  migratedPool,
  postWebhook,
  startGateway,
  truncateRawEvents,
  type RunningGateway,
} from './helpers.js';

const PR_EVENT = JSON.stringify({
  action: 'closed',
  number: 1234,
  repository: { id: 4021, full_name: 'acme/payments' },
});

/** 이 포트에는 아무도 없다. "Redis가 죽었다"를 결정론적으로 만든다. */
const UNREACHABLE_REDIS = 'redis://127.0.0.1:6390';

function testRedisUrl(): string {
  const base = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
  return `${base.replace(/\/\d+$/, '')}/14`;
}

let pool: Pool;
let redis: Redis;

beforeAll(async () => {
  pool = await migratedPool();
  redis = createRedisClient({
    url: testRedisUrl(),
    maxRetriesPerRequest: 1,
    connectTimeoutMs: 2_000,
    commandTimeoutMs: 2_000,
  });
});

afterAll(async () => {
  redis.disconnect();
  await pool.end();
});

beforeEach(async () => {
  await truncateRawEvents(pool);
  await redis.flushdb();
});

describe('정상 경로: 수신한 이벤트가 prs:ingest에 들어간다', () => {
  let gateway: RunningGateway;
  let bus: RedisStreamsEventBus;

  beforeAll(() => {
    bus = new RedisStreamsEventBus(redis);
  });

  afterAll(async () => {
    await gateway.stop();
    await bus.close();
  });

  it('EVT-ING-001 봉투가 repository_id 파티션에 발행된다', async () => {
    gateway = await startGateway(pool, { bus });
    const response = await postWebhook(gateway.baseUrl, {
      body: PR_EVENT,
      eventType: 'pull_request',
      deliveryId: 'enqueue-1',
    });
    expect(response.status).toBe(202);

    const stream = partitionStream(TOPICS.ingest, partitionFor('4021', bus.partitions(TOPICS.ingest)));
    const entries = await redis.xrange(stream, '-', '+');
    expect(entries).toHaveLength(1);

    const fields = new Map<string, string>();
    const raw = entries[0]?.[1] ?? [];
    for (let index = 0; index + 1 < raw.length; index += 2) {
      fields.set(String(raw[index]), String(raw[index + 1]));
    }

    expect(fields.get('event_name')).toBe(EVENT_NAMES.ingestionEventReceived);
    expect(fields.get('partition_key')).toBe(ingestPartitionKey(4021, 'enqueue-1'));
    expect(JSON.parse(fields.get('payload') ?? '{}')).toMatchObject({
      delivery_id: 'enqueue-1',
      event_type: 'pull_request',
      action: 'closed',
      repository_id: 4021,
    });
    expect(fields.get('correlation_id')).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('중복 재전송은 다시 발행하지 않는다 — 큐에도 한 번만 들어간다', async () => {
    await postWebhook(gateway.baseUrl, { body: PR_EVENT, eventType: 'push', deliveryId: 'enqueue-dup' });
    await postWebhook(gateway.baseUrl, { body: PR_EVENT, eventType: 'push', deliveryId: 'enqueue-dup' });

    const stream = partitionStream(TOPICS.ingest, partitionFor('4021', bus.partitions(TOPICS.ingest)));
    expect(await redis.xlen(stream)).toBe(1);
  });
});

describe('DoD 4 (앞쪽): Redis가 죽어도 게이트웨이는 202를 돌려준다', () => {
  it('발행 실패에도 202이고, 원본과 아웃박스 표식이 남는다', async () => {
    const deadClient = createRedisClient({
      url: UNREACHABLE_REDIS,
      maxRetriesPerRequest: 1,
      connectTimeoutMs: 200,
      commandTimeoutMs: 200,
    });
    deadClient.on('error', () => undefined);
    const deadBus = new RedisStreamsEventBus(deadClient);
    const gateway = await startGateway(pool, { bus: deadBus });

    try {
      const response = await postWebhook(gateway.baseUrl, {
        body: PR_EVENT,
        eventType: 'pull_request',
        deliveryId: 'redis-down-1',
      });

      // 저장은 끝났으니 GHE에 재전송을 시킬 이유가 없다.
      expect(response.status).toBe(202);
      expect(await response.json()).toMatchObject({ accepted: true, duplicate: false });
      expect(await countRawEvents(pool, 'redis-down-1')).toBe(1);

      const row = await pool.query<{ queued_at: Date | null; processed_at: Date | null }>(
        'SELECT queued_at, processed_at FROM raw_event WHERE delivery_id = $1',
        ['redis-down-1'],
      );
      // 아웃박스 표식이 있어야 JOB-ING-007이 이 행을 찾는다.
      expect(row.rows[0]?.queued_at).toBeInstanceOf(Date);
      expect(row.rows[0]?.processed_at).toBeNull();

      expect(gateway.metrics.enqueueFailed.get()).toBe(1);
      // 살아 있는 Redis에는 아무것도 들어가지 않았다.
      expect(await redis.keys(`${TOPICS.ingest}:*`)).toHaveLength(0);
    } finally {
      await gateway.stop();
      await deadBus.close();
      deadClient.disconnect();
    }
  });

  it('발행이 매달려도 수신 응답 예산을 지킨다 (NFR-002)', async () => {
    // 연결은 받아 주는데 한 마디도 대답하지 않는 서버. "Redis가 죽었다"보다
    // 고약한 상황이다 — 소켓이 살아 있으니 재연결도 걸리지 않고, 명령이
    // commandTimeout까지 그대로 매달린다. 발행 마감(150ms)이 없으면 수신 응답이
    // 그만큼 늦어져 NFR-002가 무너진다.
    const sockets = new Set<Socket>();
    const blackHole = createServer((socket) => {
      // 연결을 붙잡고 아무 응답도 하지 않는다. 닫을 때 끊어야 하므로 모아 둔다.
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
    });
    await new Promise<void>((resolve) => {
      blackHole.listen(0, '127.0.0.1', resolve);
    });
    const address = blackHole.address();
    const port = typeof address === 'object' && address !== null ? address.port : 0;

    const stalledClient = createRedisClient({
      url: `redis://127.0.0.1:${String(port)}`,
      maxRetriesPerRequest: 1,
      connectTimeoutMs: 30_000,
      commandTimeoutMs: 30_000,
    });
    stalledClient.on('error', () => undefined);
    const stalledBus = new RedisStreamsEventBus(stalledClient);
    const gateway = await startGateway(pool, { bus: stalledBus });

    try {
      const started = process.hrtime.bigint();
      const response = await postWebhook(gateway.baseUrl, {
        body: PR_EVENT,
        eventType: 'push',
        deliveryId: 'redis-stalled',
      });
      const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;

      expect(response.status).toBe(202);
      expect(elapsedMs).toBeLessThan(300);
      expect(gateway.metrics.enqueueFailed.get()).toBe(1);
    } finally {
      await gateway.stop();
      await stalledBus.close();
      // 소켓을 먼저 끊어야 서버가 닫힌다. 열린 연결이 남아 있으면
      // `close()`의 콜백이 영영 오지 않는다.
      stalledClient.disconnect();
      // ioredis가 재연결을 시도하며 남긴 소켓까지 끊어야 서버가 닫힌다.
      // 하나라도 열려 있으면 `close()`의 콜백이 오지 않는다.
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => {
        blackHole.close(() => {
          resolve();
        });
      });
    }
  });
});
