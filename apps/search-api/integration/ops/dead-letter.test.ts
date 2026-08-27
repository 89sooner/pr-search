/**
 * 실패 대기열 API (WP-009 DoD, API-ADM-003, FR-ING-007).
 *
 * 실제 PostgreSQL과 실제 Redis에 붙는다. 재투입이 "발행됐다고 치는" 목이 아니라
 * 진짜 스트림에 들어가는지 보아야, 파이프라인이 그것을 집을 수 있다는 말이
 * 검증된다.
 */

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { deadLetterRepo, rawEventRepo, type Pool, type RawEventInsert } from '@prs/db';
import {
  RedisStreamsEventBus,
  TOPICS,
  partitionFor,
  partitionStream,
  type Redis,
} from '@prs/bus';
import { EVENT_NAMES } from '@prs/domain';
import { buildServer } from '../../src/server.js';
import { DEAD_LETTER_PATH, REPROCESS_PATH } from '../../src/ops/routes.js';
import { createTestRedis, migratedPool } from '../helpers.js';
import { TEST_CURSOR_KEY } from '../_cursor-fixture.js';

/** WP-012 이전과 같은 조건: OIDC 미구성 → 이름 붙은 토큰이 통제한다 (CR-015, DEV-048). */
const TEST_AUTH_CONFIG = {
  enabled: false,
  cookieSecure: false,
  loginPath: '/auth/login',
  groupRoleMap: new Map<string, never>(),
} as const;


const TOKEN = 'test-admin-token';
const AUTH = { authorization: `Bearer ${TOKEN}` };
const REPOSITORY_ID = 4021;

let pool: Pool;
let redis: Redis;
let bus: RedisStreamsEventBus;
let app: FastifyInstance;

function rawEvent(deliveryId: string, receivedAt = new Date()): RawEventInsert {
  return {
    delivery_id: deliveryId,
    event_type: 'pull_request',
    action: 'closed',
    repository_id: REPOSITORY_ID,
    received_at: receivedAt,
    payload: { number: 42 },
    payload_hash: `hash-${deliveryId}`,
    correlation_id: '0f0a1b2c-3d4e-5f60-7182-93a4b5c6d7e8',
  };
}

/** 원본과 실패 기록을 한 쌍으로 만든다. */
async function seedFailure(deliveryId: string, withRawEvent = true): Promise<number> {
  if (withRawEvent) await rawEventRepo.insertRawEvent(pool, rawEvent(deliveryId));
  const row = await deadLetterRepo.recordDeadLetter(pool, {
    deliveryId,
    stage: 'project',
    repositoryId: REPOSITORY_ID,
    error: 'index_unavailable: connection refused',
    retryCount: 5,
  });
  return row.dead_letter_id;
}

/** 재투입된 봉투를 스트림에서 직접 읽는다. */
async function ingestEntries(deliveryId: string): Promise<Record<string, string>[]> {
  const stream = partitionStream(TOPICS.ingest, partitionFor(String(REPOSITORY_ID), bus.partitions(TOPICS.ingest)));
  const entries = await redis.xrange(stream, '-', '+');
  return entries
    .map(([, fields]) => {
      const record: Record<string, string> = {};
      for (let index = 0; index + 1 < fields.length; index += 2) {
        record[fields[index] ?? ''] = fields[index + 1] ?? '';
      }
      return record;
    })
    .filter((record) => (record['payload'] ?? '').includes(deliveryId));
}

describe('실패 대기열 API (WP-009, API-ADM-003)', () => {
  beforeAll(async () => {
    pool = await migratedPool();
    redis = createTestRedis();
    bus = new RedisStreamsEventBus(redis);
    app = buildServer({
      config: { port: 0, adminTokens: [{ name: 'tester', token: TOKEN }], metricsQueryUrl: null, gheBaseUrl: null, auth: TEST_AUTH_CONFIG, searchCursorKey: TEST_CURSOR_KEY },
      ops: { pool, bus },
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await bus.close();
    redis.disconnect();
    await pool.end();
  });

  beforeEach(async () => {
    await pool.query('TRUNCATE dead_letter, raw_event RESTART IDENTITY CASCADE');
    await redis.flushdb();
  });

  describe('인증 (CR-012, DEV-025)', () => {
    it('토큰이 없으면 401이다', async () => {
      const response = await app.inject({ method: 'GET', url: DEAD_LETTER_PATH });
      expect(response.statusCode).toBe(401);
      expect(response.json()).toMatchObject({ error: { code: 'UNAUTHENTICATED' } });
    });

    it('토큰이 틀리면 401이다', async () => {
      const response = await app.inject({
        method: 'GET',
        url: DEAD_LETTER_PATH,
        headers: { authorization: 'Bearer 아무거나' },
      });
      expect(response.statusCode).toBe(401);
    });

    it('재처리도 인증 없이는 되지 않는다', async () => {
      const id = await seedFailure('auth-1');
      const response = await app.inject({
        method: 'POST',
        url: REPROCESS_PATH,
        payload: { dead_letter_ids: [id] },
      });
      expect(response.statusCode).toBe(401);
      // 아무것도 하지 않았다. 상태가 그대로여야 한다.
      const [row] = await deadLetterRepo.findByIds(pool, [id]);
      expect(row?.state).toBe('pending');
    });

    it('토큰이 설정되지 않으면 경로가 아예 없다', async () => {
      const bare = buildServer({ config: { port: 0, adminTokens: [], metricsQueryUrl: null, gheBaseUrl: null, auth: TEST_AUTH_CONFIG, searchCursorKey: TEST_CURSOR_KEY }, ops: { pool, bus } });
      try {
        await bare.ready();
        const response = await bare.inject({ method: 'GET', url: DEAD_LETTER_PATH, headers: AUTH });
        expect(response.statusCode).toBe(404);
      } finally {
        await bare.close();
      }
    });
  });

  describe('조회', () => {
    it('AC-2: 사유·마지막 오류·재시도 횟수·단계와 함께 나온다', async () => {
      await seedFailure('list-1');
      const response = await app.inject({ method: 'GET', url: DEAD_LETTER_PATH, headers: AUTH });

      expect(response.statusCode).toBe(200);
      const body = response.json() as { items: Record<string, unknown>[]; total: number };
      expect(body.total).toBe(1);
      expect(body.items[0]).toMatchObject({
        delivery_id: 'list-1',
        stage: 'project',
        repository_id: REPOSITORY_ID,
        error: 'index_unavailable: connection refused',
        retry_count: 5,
        reprocess_count: 0,
        state: 'pending',
      });
      // DEV-027: JSON에 숫자로 나간다. 문자열이면 클라이언트 비교가 어긋난다.
      expect(typeof body.items[0]?.['dead_letter_id']).toBe('number');
    });

    it('단계·상태·저장소로 좁힌다', async () => {
      await seedFailure('f-1');
      await deadLetterRepo.recordDeadLetter(pool, {
        deliveryId: 'f-2',
        stage: 'enrich',
        repositoryId: 777,
        error: 'installation_unregistered',
        retryCount: 0,
      });

      const byStage = await app.inject({
        method: 'GET',
        url: `${DEAD_LETTER_PATH}?stage=enrich`,
        headers: AUTH,
      });
      expect((byStage.json() as { total: number }).total).toBe(1);

      const byRepo = await app.inject({
        method: 'GET',
        url: `${DEAD_LETTER_PATH}?repository_id=777`,
        headers: AUTH,
      });
      expect((byRepo.json() as { total: number }).total).toBe(1);
    });

    it('기본 목록은 끝난 항목을 보여 주지 않는다', async () => {
      await seedFailure('done-1');
      await deadLetterRepo.resolveByDelivery(pool, 'done-1');

      const listed = await app.inject({ method: 'GET', url: DEAD_LETTER_PATH, headers: AUTH });
      expect((listed.json() as { total: number }).total).toBe(0);

      const explicit = await app.inject({
        method: 'GET',
        url: `${DEAD_LETTER_PATH}?state=resolved`,
        headers: AUTH,
      });
      expect((explicit.json() as { total: number }).total).toBe(1);
    });

    it('알 수 없는 상태·단계는 400으로 거절한다', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `${DEAD_LETTER_PATH}?state=아무거나`,
        headers: AUTH,
      });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ error: { code: 'INVALID_PARAMETER' } });
    });
  });

  describe('재처리 (AC-3, AC-4)', () => {
    it('DoD: 개별 재처리가 원본을 prs:ingest에 다시 넣는다', async () => {
      const id = await seedFailure('one-1');

      const response = await app.inject({
        method: 'POST',
        url: REPROCESS_PATH,
        headers: AUTH,
        payload: { dead_letter_ids: [id] },
      });

      expect(response.statusCode).toBe(202);
      expect(response.json()).toMatchObject({ requested: 1, reinjected: 1, skipped: [] });

      const entries = await ingestEntries('one-1');
      expect(entries).toHaveLength(1);
      expect(entries[0]?.['event_name']).toBe(EVENT_NAMES.ingestionEventReceived);
      // 파이프라인이 처음 받았을 때와 같은 payload여야 한다.
      expect(JSON.parse(entries[0]?.['payload'] ?? '{}')).toMatchObject({
        delivery_id: 'one-1',
        event_type: 'pull_request',
        repository_id: REPOSITORY_ID,
      });

      const [row] = await deadLetterRepo.findByIds(pool, [id]);
      expect(row?.state).toBe('reprocessing');
    });

    it('DoD: 일괄 재처리가 동작한다', async () => {
      const ids = [await seedFailure('b-1'), await seedFailure('b-2'), await seedFailure('b-3')];

      const response = await app.inject({
        method: 'POST',
        url: REPROCESS_PATH,
        headers: AUTH,
        payload: { dead_letter_ids: ids },
      });

      expect(response.json()).toMatchObject({ requested: 3, reinjected: 3 });
      const rows = await deadLetterRepo.findByIds(pool, ids);
      expect(rows.every((row) => row.state === 'reprocessing')).toBe(true);
    });

    it('필터로도 고를 수 있고, held는 자동으로 딸려 오지 않는다', async () => {
      const open = await seedFailure('filter-open');
      const held = await seedFailure('filter-held');
      // 세 번 재처리 실패시켜 보류로 만든다.
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await deadLetterRepo.markReprocessing(pool, [held]);
        await deadLetterRepo.recordDeadLetter(pool, {
          deliveryId: 'filter-held',
          stage: 'project',
          repositoryId: REPOSITORY_ID,
          error: '또 실패',
          retryCount: 5,
        });
      }

      const response = await app.inject({
        method: 'POST',
        url: REPROCESS_PATH,
        headers: AUTH,
        payload: { filter: { stage: 'project' } },
      });

      expect(response.json()).toMatchObject({ requested: 1, reinjected: 1 });
      expect((await deadLetterRepo.findByIds(pool, [held]))[0]?.state).toBe('held');
      expect((await deadLetterRepo.findByIds(pool, [open]))[0]?.state).toBe('reprocessing');
    });

    it('보류된 항목도 식별자로 짚으면 다시 흐른다', async () => {
      const id = await seedFailure('held-explicit');
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await deadLetterRepo.markReprocessing(pool, [id]);
        await deadLetterRepo.recordDeadLetter(pool, {
          deliveryId: 'held-explicit',
          stage: 'project',
          repositoryId: REPOSITORY_ID,
          error: '또 실패',
          retryCount: 5,
        });
      }
      expect((await deadLetterRepo.findByIds(pool, [id]))[0]?.state).toBe('held');

      const response = await app.inject({
        method: 'POST',
        url: REPROCESS_PATH,
        headers: AUTH,
        payload: { dead_letter_ids: [id] },
      });
      expect(response.json()).toMatchObject({ reinjected: 1 });
    });

    it('AC-4: 두 번 재처리해도 재투입 payload의 멱등 키가 같다', async () => {
      const id = await seedFailure('idem-1');
      for (let round = 0; round < 2; round += 1) {
        await app.inject({
          method: 'POST',
          url: REPROCESS_PATH,
          headers: AUTH,
          payload: { dead_letter_ids: [id] },
        });
      }

      const entries = await ingestEntries('idem-1');
      expect(entries).toHaveLength(2);
      const payloads = entries.map((entry) => JSON.parse(entry['payload'] ?? '{}') as { delivery_id: string });
      // 소비자의 멱등 기준은 `event_id`가 아니라 payload의 `delivery_id`다
      // (EVT-ING-001). 그래서 봉투 ID는 달라도 문서는 하나가 된다 — 문서 수준의
      // 보장은 WP-008 투영 시험이 결정론적 문서 ID로 증명한다.
      expect(payloads.map((payload) => payload.delivery_id)).toEqual(['idem-1', 'idem-1']);
      expect(new Set(entries.map((entry) => entry['event_id'])).size).toBe(2);
    });

    it('원본이 없으면 건너뛴다', async () => {
      const id = await seedFailure('no-raw', false);

      const response = await app.inject({
        method: 'POST',
        url: REPROCESS_PATH,
        headers: AUTH,
        payload: { dead_letter_ids: [id] },
      });

      expect(response.json()).toMatchObject({
        requested: 1,
        reinjected: 0,
        skipped: [{ dead_letter_id: id, reason: 'raw_event_missing' }],
      });
      // 재투입하지 않았으니 진행 중으로 표시하지도 않는다.
      expect((await deadLetterRepo.findByIds(pool, [id]))[0]?.state).toBe('pending');
    });

    it('발행에 실패하면 진행 중 표시를 되돌린다', async () => {
      // 발행하지 못했는데 `reprocessing`으로 남으면, 아무도 다시 넣지 않은 행이
      // 진행 중으로 보이고 뒤에 오는 실패가 재처리 실패로 잘못 세어진다.
      const id = await seedFailure('publish-fail');
      const brokenBus = {
        partitions: (topic: string) => bus.partitions(topic),
        depth: async (): Promise<number> => 0,
        publish: async (): Promise<void> => {
          throw new Error('Redis가 응답하지 않는다');
        },
        subscribe: bus.subscribe.bind(bus),
        close: async (): Promise<void> => undefined,
      };
      const broken = buildServer({
        config: { port: 0, adminTokens: [{ name: 'tester', token: TOKEN }], metricsQueryUrl: null, gheBaseUrl: null, auth: TEST_AUTH_CONFIG, searchCursorKey: TEST_CURSOR_KEY },
        ops: { pool, bus: brokenBus },
      });

      try {
        await broken.ready();
        const response = await broken.inject({
          method: 'POST',
          url: REPROCESS_PATH,
          headers: AUTH,
          payload: { dead_letter_ids: [id] },
        });
        expect(response.json()).toMatchObject({
          requested: 1,
          reinjected: 0,
          skipped: [{ dead_letter_id: id, reason: 'publish_failed' }],
        });
      } finally {
        await broken.close();
      }

      expect((await deadLetterRepo.findByIds(pool, [id]))[0]?.state).toBe('pending');
    });

    it('빈 요청은 400이다', async () => {
      const response = await app.inject({
        method: 'POST',
        url: REPROCESS_PATH,
        headers: AUTH,
        payload: {},
      });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ error: { code: 'INVALID_PARAMETER' } });
    });
  });

  describe('일괄 확인과 상한 (QA-A001-05)', () => {
    async function seedMany(count: number): Promise<void> {
      for (let index = 0; index < count; index += 1) {
        await seedFailure(`bulk-${String(index)}`);
      }
    }

    it('DoD: 100건 초과 일괄 재처리는 재확인을 요구한다', async () => {
      await seedMany(101);

      const without = await app.inject({
        method: 'POST',
        url: REPROCESS_PATH,
        headers: AUTH,
        payload: { filter: { stage: 'project' } },
      });
      expect(without.statusCode).toBe(400);
      expect(without.json()).toMatchObject({
        error: { code: 'CONFIRMATION_MISMATCH', detail: { required_confirmation: '101' } },
      });

      const wrong = await app.inject({
        method: 'POST',
        url: REPROCESS_PATH,
        headers: AUTH,
        payload: { filter: { stage: 'project' }, confirmation: '100' },
      });
      expect(wrong.statusCode).toBe(400);

      const right = await app.inject({
        method: 'POST',
        url: REPROCESS_PATH,
        headers: AUTH,
        payload: { filter: { stage: 'project' }, confirmation: '101' },
      });
      expect(right.statusCode).toBe(202);
      expect(right.json()).toMatchObject({ requested: 101, reinjected: 101 });
    });

    it('경계는 정확히 100이다 — 100건은 확인 없이 지나간다', async () => {
      await seedMany(100);
      const response = await app.inject({
        method: 'POST',
        url: REPROCESS_PATH,
        headers: AUTH,
        payload: { filter: { stage: 'project' } },
      });
      expect(response.statusCode).toBe(202);
      expect(response.json()).toMatchObject({ requested: 100, reinjected: 100 });
    });
  });

  describe('지표 (AC-5)', () => {
    it('DoD: 100건을 넘으면 경보 지표가 임계를 넘는다', async () => {
      for (let index = 0; index < 101; index += 1) {
        await seedFailure(`metric-${String(index)}`);
      }

      const response = await app.inject({ method: 'GET', url: '/metrics' });
      expect(response.statusCode).toBe(200);
      const body = response.body;
      expect(body).toContain('dead_letter_total{state="pending"} 101');
      expect(body).toContain('dead_letter_open_total 101');
    });

    it('끝난 항목은 경보 임계를 잠식하지 않는다', async () => {
      await seedFailure('m-open');
      await seedFailure('m-done');
      await deadLetterRepo.resolveByDelivery(pool, 'm-done');

      const body = (await app.inject({ method: 'GET', url: '/metrics' })).body;
      expect(body).toContain('dead_letter_total{state="resolved"} 1');
      expect(body).toContain('dead_letter_open_total 1');
    });
  });
});
