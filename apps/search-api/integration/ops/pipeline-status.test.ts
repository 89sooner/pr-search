/**
 * 파이프라인 상태 (WP-010 DoD, API-ADM-006, FR-ADMIN-001).
 *
 * 실제 PostgreSQL·Redis·Elasticsearch에 붙는다. 항목마다 출처가 달라서
 * (CR-013, DEV-029) 셋 중 하나라도 목으로 바꾸면 "출처가 정말 그것인가"를
 * 확인하지 못한다.
 */

import type { Client as EsClient } from '@elastic/elasticsearch';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  deadLetterRepo,
  rawEventRepo,
  repositoryRepo,
  sequenceSpaceRepo,
  type Pool,
  type RawEventInsert,
} from '@prs/db';
import { applyMappings, switchAliasesForTests, createEsClient, resolveClientOptions } from '@prs/es';
import { RedisStreamsEventBus, TOPICS, type Redis } from '@prs/bus';
import { buildServer } from '../../src/server.js';
import { PIPELINE_STATUS_PATH } from '../../src/ops/routes.js';
import { createTestRedis, migratedPool } from '../helpers.js';
import { TEST_CURSOR_KEY } from '../_cursor-fixture.js';

/** WP-012 이전과 같은 조건: OIDC 미구성 → 이름 붙은 토큰이 통제한다 (CR-015, DEV-048). */
const TEST_AUTH_CONFIG = {
  enabled: false,
  cookieSecure: false,
  loginPath: '/auth/login',
  groupRoleMap: new Map(),
} as const;

const TOKEN = 'status-token';
const AUTH = { authorization: `Bearer ${TOKEN}` };
const REPOSITORY_ID = 4021;

let pool: Pool;
let es: EsClient;
let redis: Redis;
let bus: RedisStreamsEventBus;
let app: FastifyInstance;

interface StatusBody {
  generated_at: string;
  intake_per_minute: number | null;
  queue_depth: Record<string, number> | null;
  ingestion_lag_seconds: { p50: number | null; p95: number | null; sample_count: number } | null;
  stage_latency_seconds: unknown;
  dead_letter: Record<string, number> | null;
  enrichment_pending: number | null;
  slowest_repositories: { repository_id: number; repository: string | null; lag_p95_seconds: number }[] | null;
  sequence_space_state: Record<string, number> | null;
  unavailable: string[];
}

function rawEvent(deliveryId: string, overrides: Partial<RawEventInsert> = {}): RawEventInsert {
  return {
    delivery_id: deliveryId,
    event_type: 'pull_request',
    action: 'closed',
    repository_id: REPOSITORY_ID,
    received_at: new Date(),
    payload: { number: 1 },
    payload_hash: `hash-${deliveryId}`,
    correlation_id: '0f0a1b2c-3d4e-5f60-7182-93a4b5c6d7e8',
    ...overrides,
  };
}

/** 수신 시각과 처리 시각을 직접 놓아 지연 표본을 만든다. */
async function seedProcessed(deliveryId: string, lagSeconds: number, repositoryId = REPOSITORY_ID): Promise<void> {
  const receivedAt = new Date(Date.now() - 5 * 60 * 1_000);
  await rawEventRepo.insertRawEvent(pool, rawEvent(deliveryId, { received_at: receivedAt, repository_id: repositoryId }));
  await pool.query('UPDATE raw_event SET processed_at = received_at + make_interval(secs => $2) WHERE delivery_id = $1', [
    deliveryId,
    lagSeconds,
  ]);
}

async function status(): Promise<StatusBody> {
  const response = await app.inject({ method: 'GET', url: PIPELINE_STATUS_PATH, headers: AUTH });
  expect(response.statusCode).toBe(200);
  return response.json() as StatusBody;
}

describe('파이프라인 상태 (WP-010, API-ADM-006)', () => {
  beforeAll(async () => {
    pool = await migratedPool();
    es = createEsClient(resolveClientOptions());
    await applyMappings(es);
  // 매핑 버전이 올라간 별칭을 현재 정의로 옮긴다 (WP-032). 시험 전용.
  await switchAliasesForTests(es);
    redis = createTestRedis();
    bus = new RedisStreamsEventBus(redis);
    app = buildServer({
      config: { port: 0, adminTokens: [{ name: 'alice', token: TOKEN }], metricsQueryUrl: null, gheBaseUrl: null, auth: TEST_AUTH_CONFIG, searchCursorKey: TEST_CURSOR_KEY },
      ops: { pool, bus },
      pipeline: { pool, bus, es, metricsQueryUrl: null },
    });
    await app.ready();
  }, 90_000);

  afterAll(async () => {
    await app.close();
    await bus.close();
    redis.disconnect();
    await es.close();
    await pool.end();
  });

  beforeEach(async () => {
    await pool.query('TRUNCATE raw_event, dead_letter, repository RESTART IDENTITY CASCADE');
    await redis.flushdb();
    // 다른 스위트가 남긴 문서가 `enrichment_pending` 집계에 섞이지 않게
    // 이 저장소의 문서를 전부 비운다.
    await es.deleteByQuery({
      index: 'prs-pull-requests',
      refresh: true,
      conflicts: 'proceed',
      query: { match_all: {} },
    });
  });

  it('인증 없이는 볼 수 없다 (AC-4의 임시 통제)', async () => {
    expect((await app.inject({ method: 'GET', url: PIPELINE_STATUS_PATH })).statusCode).toBe(401);
  });

  it('DoD: 신선도가 요청 시점이다 — 캐시하지 않는다 (AC-2)', async () => {
    const before = Date.now();
    const first = await status();
    expect(first.intake_per_minute).toBe(0);

    await rawEventRepo.insertRawEvent(pool, rawEvent('fresh-1'));
    const second = await status();

    // 같은 요청을 두 번 했는데 값이 따라 움직인다. 30초는커녕 즉시다.
    expect(second.intake_per_minute).toBe(1);
    expect(new Date(second.generated_at).getTime()).toBeGreaterThanOrEqual(before);
    expect(new Date(second.generated_at).getTime()).toBeGreaterThanOrEqual(
      new Date(first.generated_at).getTime(),
    );
  });

  it('AC-1: 수신량은 최근 1분만 센다', async () => {
    await rawEventRepo.insertRawEvent(pool, rawEvent('recent'));
    await rawEventRepo.insertRawEvent(
      pool,
      rawEvent('old', { received_at: new Date(Date.now() - 10 * 60 * 1_000) }),
    );
    expect((await status()).intake_per_minute).toBe(1);
  });

  it('AC-1: 대기열 길이가 실제 스트림 적체를 따른다', async () => {
    expect((await status()).queue_depth).toEqual({
      [TOPICS.ingest]: 0,
      [TOPICS.enriched]: 0,
      [TOPICS.projected]: 0,
    });

    await bus.publish(TOPICS.ingest, String(REPOSITORY_ID), {
      event_id: 'evt-1',
      event_name: 'ingestion.event_received',
      correlation_id: '0f0a1b2c-3d4e-5f60-7182-93a4b5c6d7e8',
      occurred_at: new Date().toISOString(),
      payload: { delivery_id: 'q-1' },
    });

    expect((await status()).queue_depth?.[TOPICS.ingest]).toBe(1);
  });

  it('AC-1: 수집 반영 지연이 실제 백분위다 — 버킷 근사가 아니다', async () => {
    // 1초짜리 9건과 100초짜리 1건. p50은 1 근처, p95는 100 쪽으로 끌린다.
    for (let index = 0; index < 9; index += 1) {
      await seedProcessed(`fast-${String(index)}`, 1);
    }
    await seedProcessed('slow-1', 100);

    const lag = (await status()).ingestion_lag_seconds;
    expect(lag?.sample_count).toBe(10);
    expect(lag?.p50).toBeCloseTo(1, 1);
    expect(lag?.p95).toBeGreaterThan(50);
  });

  it('처리되지 않은 이벤트는 지연 표본에 넣지 않는다', async () => {
    // 0으로 세면 지연이 실제보다 낮게 보이고, 무한대로 세면 하나만 막혀도
    // 백분위가 무의미해진다.
    await seedProcessed('done-1', 4);
    await rawEventRepo.insertRawEvent(pool, rawEvent('pending-1'));

    const lag = (await status()).ingestion_lag_seconds;
    expect(lag?.sample_count).toBe(1);
    expect(lag?.p50).toBeCloseTo(4, 1);
  });

  it('AC-3: 저장소별 지연 상위를 이름과 함께 돌려준다', async () => {
    await pool.query(
      `INSERT INTO repository (repository_id, owner, name, org_id, visibility)
       VALUES ($1, 'acme', 'payments', 77, 'internal')`,
      [REPOSITORY_ID],
    );
    await seedProcessed('r1-fast', 1, REPOSITORY_ID);
    await seedProcessed('r2-slow', 30, 5150);

    const slowest = (await status()).slowest_repositories;
    expect(slowest?.[0]).toMatchObject({ repository_id: 5150, repository: null });
    expect(slowest?.[1]).toMatchObject({ repository_id: REPOSITORY_ID, repository: 'acme/payments' });
  });

  it('AC-1: 실패 대기열 건수를 상태별로 돌려준다', async () => {
    await deadLetterRepo.recordDeadLetter(pool, {
      deliveryId: 'dl-1',
      stage: 'project',
      repositoryId: REPOSITORY_ID,
      error: 'index_unavailable',
      retryCount: 5,
    });
    expect((await status()).dead_letter).toMatchObject({ pending: 1, resolved: 0 });
  });

  it('AC-1: 보강 대기 건수를 Elasticsearch에서 읽는다', async () => {
    await es.index({
      index: 'prs-pull-requests',
      id: `${String(REPOSITORY_ID)}:1`,
      routing: String(REPOSITORY_ID),
      document: {
        document_version: 1,
        repository_id: REPOSITORY_ID,
        pr_number: 1,
        enrichment_pending: true,
      },
      refresh: true,
    });
    expect((await status()).enrichment_pending).toBe(1);
  });

  it('DEV-029: 지표 저장소가 없으면 단계별 지연만 미확인이다', async () => {
    const body = await status();
    // 워커 복제본 하나를 긁어 클러스터 전체인 양 내놓지 않는다.
    expect(body.stage_latency_seconds).toBeNull();
    expect(body.unavailable).toEqual(['stage_latency_seconds']);
    // 나머지는 정상이다 — 한 항목의 부재가 화면을 비우지 않는다.
    expect(body.intake_per_minute).not.toBeNull();
    expect(body.queue_depth).not.toBeNull();
    expect(body.dead_letter).not.toBeNull();
  });

  it('한 출처가 죽어도 나머지는 정상 반환한다 (예외 처리)', async () => {
    const broken = buildServer({
      config: { port: 0, adminTokens: [{ name: 'alice', token: TOKEN }], metricsQueryUrl: null, gheBaseUrl: null, auth: TEST_AUTH_CONFIG, searchCursorKey: TEST_CURSOR_KEY },
      ops: { pool, bus },
      pipeline: {
        pool,
        bus: {
          publish: bus.publish.bind(bus),
          subscribe: bus.subscribe.bind(bus),
          close: async (): Promise<void> => undefined,
          depth: async (): Promise<number> => {
            throw new Error('Redis가 응답하지 않는다');
          },
        },
        es,
        metricsQueryUrl: null,
      },
    });

    try {
      await broken.ready();
      const response = await broken.inject({ method: 'GET', url: PIPELINE_STATUS_PATH, headers: AUTH });
      const body = response.json() as StatusBody;

      expect(response.statusCode).toBe(200);
      expect(body.queue_depth).toBeNull();
      expect(body.unavailable).toContain('queue_depth');
      expect(body.dead_letter).not.toBeNull();
    } finally {
      await broken.close();
    }
  });

  /**
   * 시퀀스 공간 상태 요약 (FR-ADMIN-001 AC-1 / CR-050, DEV-354).
   *
   * v0.9까지 API 계약이 "WP-021 이후에 더한다"로 남아 있었고 구현도 없었다.
   * **WP-021은 이미 완료됐고 AC-1은 이 항목을 `Must`로 요구한다** — 이월의
   * 조건이 충족됐는데 아무도 그것을 다시 읽지 않은 자리다.
   */
  describe('시퀀스 공간 상태 요약 (DEV-354)', () => {
    const SPACE_REPOS = [90810, 90811, 90812];

    beforeEach(async () => {
      await pool.query('DELETE FROM sequence_space WHERE repository_id = ANY($1::bigint[])', [SPACE_REPOS]);
      await pool.query('DELETE FROM repository WHERE repository_id = ANY($1::bigint[])', [SPACE_REPOS]);
    });

    async function seedSpaces(states: readonly string[]): Promise<void> {
      for (const [index, state] of states.entries()) {
        const id = SPACE_REPOS[index];
        if (id === undefined) continue;
        await repositoryRepo.upsertRepository(pool, {
          repository_id: id,
          owner: 'wp034s',
          name: `space-${String(index)}`,
          org_id: 9081,
          visibility: 'internal',
          sequence_branches: ['main'],
        });
        await sequenceSpaceRepo.ensureSequenceSpace(pool, id, 'main');
        await pool.query('UPDATE sequence_space SET state = $2 WHERE repository_id = $1', [id, state]);
      }
    }

    it('**네 상태를 전부 싣는다** — 없는 상태의 키가 빠지면 0과 미확인이 섞인다', async () => {
      await seedSpaces(['ok']);
      const body = await status();
      expect(body.sequence_space_state).not.toBeNull();
      expect(Object.keys(body.sequence_space_state ?? {}).sort()).toEqual([
        'ok',
        'reassigning',
        'stale',
        'unknown',
      ]);
    });

    it('**상태별 건수가 맞는다**', async () => {
      await seedSpaces(['ok', 'stale', 'reassigning']);
      const body = await status();
      const summary = body.sequence_space_state ?? {};
      expect(summary['ok']).toBeGreaterThanOrEqual(1);
      expect(summary['stale']).toBeGreaterThanOrEqual(1);
      expect(summary['reassigning']).toBeGreaterThanOrEqual(1);
    });

    it('**저장소를 식별하지 않는다** — 전역 건수라 접근 범위를 거치지 않는 근거다', async () => {
      await seedSpaces(['ok', 'stale']);
      const body = await status();
      const serialized = JSON.stringify(body.sequence_space_state);
      for (const id of SPACE_REPOS) expect(serialized).not.toContain(String(id));
      expect(serialized).not.toContain('wp034s');
      expect(serialized).not.toContain('main');
    });

    it('**여전히 `operator` 전용이다** (AC-4) — 이 항목이 권한을 넓히지 않았다', async () => {
      const response = await app.inject({ method: 'GET', url: PIPELINE_STATUS_PATH });
      expect(response.statusCode).toBe(401);
    });
  });
});
