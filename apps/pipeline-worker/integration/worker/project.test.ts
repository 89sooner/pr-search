/**
 * JOB-ING-003 투영 워커 (WP-008, FR-ING-005).
 *
 * 실제 PostgreSQL·실제 Redis·**실제 Elasticsearch**를 쓴다. 이 WP가 증명해야 할
 * 것 대부분(조건부 업서트, `dynamic: strict` 거부, 벌크 부분 실패)은 클러스터의
 * 동작 그 자체라 목으로 바꾸면 검증하려던 것을 건너뛴다.
 *
 * 검증: `pnpm test:integration worker/project`
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Client } from '@elastic/elasticsearch';
import { rawEventRepo, repositoryRepo, type Pool, type RawEventInsert } from '@prs/db';
import { applyMappings, createEsClient, dropEntityIndices, resolveClientOptions } from '@prs/es';
import {
  MAX_RETRIES,
  RedisStreamsEventBus,
  TOPICS,
  consumerGroup,
  type DeliveredEvent,
  type Redis,
} from '@prs/bus';
import { EVENT_NAMES, type IngestionEnriched, type IngestionProjected } from '@prs/domain';
import { handleEnrichedEvent, type ProjectDeps } from '../../src/project.js';
import { createWorkerMetrics } from '../../src/metrics.js';
import { createTestRedis, migratedPool } from '../helpers.js';

const REPOSITORY_ID = 4021;
const PR_NUMBER = 1234;
const CORRELATION_ID = '0f0a1b2c-3d4e-5f60-7182-93a4b5c6d7e8';
const MERGE_SHA = 'a3f9c21b4e8d7f0c1a2b3c4d5e6f708192a3b4c5';
const SOURCE_SHA = 'dddd111122223333444455556666777788889999';

let pool: Pool;
let redis: Redis;
let bus: RedisStreamsEventBus;
let es: Client;

beforeAll(async () => {
  pool = await migratedPool();
  redis = createTestRedis();
  bus = new RedisStreamsEventBus(redis);
  es = createEsClient(resolveClientOptions());
  await waitForCluster();
  await dropEntityIndices(es);
  await applyMappings(es);
}, 120_000);

afterAll(async () => {
  await bus.close();
  redis.disconnect();
  await es.close();
  await pool.end();
});

beforeEach(async () => {
  await pool.query('TRUNCATE raw_event');
  await pool.query('TRUNCATE dead_letter');
  await pool.query('TRUNCATE repository CASCADE');
  await redis.flushdb();
  await es.deleteByQuery({
    index: ['prs-pull-requests', 'prs-commits'],
    query: { match_all: {} },
    refresh: true,
    conflicts: 'proceed',
  });
  await repositoryRepo.upsertRepository(pool, {
    repository_id: REPOSITORY_ID,
    owner: 'acme',
    name: 'payments',
    org_id: 77,
    visibility: 'internal',
    sequence_branches: ['main'],
  });
});

afterEach(async () => {
  await es.indices.refresh({ index: ['prs-pull-requests', 'prs-commits'] });
});

async function waitForCluster(timeoutMs = 90_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      await es.cluster.health({ wait_for_status: 'yellow', timeout: '5s' });
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  }
  throw new Error(`Elasticsearch가 준비되지 않았다: ${String(lastError)}`);
}

const BASE_PR: NonNullable<IngestionEnriched['pull_request']> = {
  number: PR_NUMBER,
  title: 'feat: 결제 재시도',
  body: '지수 백오프로 재시도한다.',
  state: 'closed',
  draft: false,
  labels: ['payments'],
  merged: true,
  created_at: '2026-08-19T09:00:00.000Z',
  updated_at: '2026-08-19T10:00:00.000Z',
  closed_at: '2026-08-19T10:00:00.000Z',
  merged_at: '2026-08-19T10:00:00.000Z',
  merge_commit_sha: MERGE_SHA,
  author: 'dev',
  head_ref: 'feature/retry',
  head_sha: 'b1c2d3e4f5061728394a5b6c7d8e9f0a1b2c3d4e',
  base_ref: 'main',
  base_sha: 'c1d2e3f405162738495a6b7c8d9e0f1a2b3c4d5e',
};

function enrichedPayload(overrides: Partial<IngestionEnriched> = {}): IngestionEnriched {
  return {
    delivery_id: 'delivery-project-1',
    repository_id: REPOSITORY_ID,
    entity_kind: 'pull_request',
    pr_number: PR_NUMBER,
    pull_request: BASE_PR,
    source_commit_shas: [SOURCE_SHA],
    changed_files: [{ filename: 'src/pay.ts', additions: 10, deletions: 2, status: 'modified' }],
    reviews: [{ id: 1, state: 'APPROVED', reviewer: 'alice', submitted_at: '2026-08-19T09:30:00.000Z' }],
    source_commits_truncated: false,
    files_truncated: false,
    enrichment_pending: false,
    enrichment_errors: [],
    correlation_id: CORRELATION_ID,
    ...overrides,
  };
}

async function insertRaw(deliveryId: string, receivedAt: Date, overrides: Partial<RawEventInsert> = {}): Promise<void> {
  await rawEventRepo.insertRawEventIfAbsent(pool, {
    delivery_id: deliveryId,
    event_type: 'pull_request',
    action: 'closed',
    repository_id: REPOSITORY_ID,
    received_at: receivedAt,
    payload: { number: PR_NUMBER },
    payload_hash: 'a'.repeat(64),
    correlation_id: CORRELATION_ID,
    queued_at: receivedAt,
    ...overrides,
  });
}

function delivered(payload: IngestionEnriched, deliveryCount = 1): DeliveredEvent {
  return {
    event_id: 'evt-project-1',
    event_name: EVENT_NAMES.ingestionEnriched,
    correlation_id: CORRELATION_ID,
    occurred_at: new Date().toISOString(),
    partition_key: String(REPOSITORY_ID),
    partition: 0,
    delivery_count: deliveryCount,
    message_id: 'm-1',
    payload,
  };
}

function buildDeps(overrides: Partial<ProjectDeps> = {}): ProjectDeps & { metrics: ReturnType<typeof createWorkerMetrics> } {
  const metrics = (overrides.metrics as ReturnType<typeof createWorkerMetrics> | undefined) ?? createWorkerMetrics();
  return {
    pool,
    bus,
    es,
    // 시험이 실제로 1초를 기다리지 않게 한다. 재시도 횟수는 그대로다.
    sleep: async (): Promise<void> => undefined,
    ...overrides,
    metrics,
  };
}

async function getDoc(index: string, id: string): Promise<Record<string, unknown> | undefined> {
  await es.indices.refresh({ index });
  try {
    const response = await es.get<Record<string, unknown>>({ index, id, routing: String(REPOSITORY_ID) });
    return response._source;
  } catch {
    return undefined;
  }
}

async function deadLetters(): Promise<{ error: string; stage: string }[]> {
  const result = await pool.query<{ error: string; stage: string }>(
    'SELECT error, stage FROM dead_letter ORDER BY dead_letter_id',
  );
  return result.rows;
}

describe('투영 워커 (WP-008 DoD)', () => {
  it('PR 문서와 커밋 문서를 색인한다', async () => {
    const receivedAt = new Date('2026-08-20T12:00:00.000Z');
    await insertRaw('delivery-project-1', receivedAt);
    const outcome = await handleEnrichedEvent(buildDeps(), delivered(enrichedPayload()));

    expect(outcome.disposition.kind).toBe('ack');

    const pr = await getDoc('prs-pull-requests', `${String(REPOSITORY_ID)}:${String(PR_NUMBER)}`);
    expect(pr?.['title']).toBe('feat: 결제 재시도');
    expect(pr?.['document_version']).toBe(receivedAt.getTime());
    expect(pr?.['lead_time_seconds']).toBe(3_600);
    expect(pr?.['approved_by']).toEqual(['alice']);
    expect(pr?.['last_delivery_id']).toBe('delivery-project-1');

    const merge = await getDoc('prs-commits', `${String(REPOSITORY_ID)}:${MERGE_SHA}`);
    expect(merge?.['role']).toBe('merge_commit');
    expect(merge?.['pull_request_numbers']).toEqual([PR_NUMBER]);

    const src = await getDoc('prs-commits', `${String(REPOSITORY_ID)}:${SOURCE_SHA}`);
    expect(src?.['role']).toBe('source_commit');
  });

  it('DoD 1: 오래된 `document_version` 갱신이 새 상태를 덮어쓰지 않는다 (AC-1)', async () => {
    const later = new Date('2026-08-20T12:00:00.000Z');
    const earlier = new Date('2026-08-20T11:00:00.000Z');
    await insertRaw('delivery-late', later);
    await insertRaw('delivery-early', earlier);

    const deps = buildDeps();
    // 늦게 일어난 사실을 먼저 색인한다.
    await handleEnrichedEvent(
      deps,
      delivered(enrichedPayload({ delivery_id: 'delivery-late', pull_request: { ...BASE_PR, title: '나중 상태' } })),
    );
    // 그다음 도착한 것이 더 오래된 웹훅이다.
    const outcome = await handleEnrichedEvent(
      deps,
      delivered(enrichedPayload({ delivery_id: 'delivery-early', pull_request: { ...BASE_PR, title: '이전 상태' } })),
    );

    expect(outcome.disposition.kind).toBe('ack');
    const pr = await getDoc('prs-pull-requests', `${String(REPOSITORY_ID)}:${String(PR_NUMBER)}`);
    expect(pr?.['title']).toBe('나중 상태');
    expect(pr?.['document_version']).toBe(later.getTime());
    // 덮이지 않았으니 관계 워커를 깨울 이유도 없다.
    expect(outcome.projected).toEqual([]);
  });

  it('DoD 2: 같은 이벤트를 두 번 처리해도 문서가 하나다 (FR-ING-002 AC-5)', async () => {
    await insertRaw('delivery-project-1', new Date('2026-08-20T12:00:00.000Z'));
    const deps = buildDeps();
    await handleEnrichedEvent(deps, delivered(enrichedPayload()));
    await handleEnrichedEvent(deps, delivered(enrichedPayload(), 2));

    await es.indices.refresh({ index: 'prs-pull-requests' });
    const count = await es.count({
      index: 'prs-pull-requests',
      query: { term: { pr_number: PR_NUMBER } },
    });
    expect(count.count).toBe(1);
  });

  it('DoD 3: 여러 인덱스 갱신이 벌크 1건으로 전송된다 (AC-2)', async () => {
    await insertRaw('delivery-project-1', new Date('2026-08-20T12:00:00.000Z'));
    let bulkCalls = 0;
    const counting = new Proxy(es, {
      get(target, property, receiver) {
        if (property === 'bulk') {
          return async (...args: unknown[]): Promise<unknown> => {
            bulkCalls += 1;
            return Reflect.apply(target.bulk as (...a: unknown[]) => Promise<unknown>, target, args);
          };
        }
        return Reflect.get(target, property, receiver) as unknown;
      },
    });

    await handleEnrichedEvent(buildDeps({ es: counting }), delivered(enrichedPayload()));

    expect(bulkCalls).toBe(1);
    // 그 한 번으로 두 인덱스가 갱신됐다.
    expect(await getDoc('prs-pull-requests', `${String(REPOSITORY_ID)}:${String(PR_NUMBER)}`)).toBeDefined();
    expect(await getDoc('prs-commits', `${String(REPOSITORY_ID)}:${MERGE_SHA}`)).toBeDefined();
  });

  it('DoD 4: 벌크 부분 실패 항목이 개별 재시도된다 (AC-3)', async () => {
    await insertRaw('delivery-project-1', new Date('2026-08-20T12:00:00.000Z'));
    let updateCalls = 0;
    // 마지막 문서만 클러스터에 닿지 못하고 쓰기 거부(429)를 받은 상황을 만든다.
    // 응답만 조작하면 그 문서는 이미 색인돼 있어 재시도가 무엇을 고쳤는지 알 수 없다.
    const flaky = new Proxy(es, {
      get(target, property, receiver) {
        if (property === 'bulk') {
          return async (params: { operations: unknown[] }, ...rest: unknown[]): Promise<{ items: unknown[] }> => {
            const kept = params.operations.slice(0, -2);
            const response = (await Reflect.apply(
              target.bulk as (...a: unknown[]) => Promise<{ items: unknown[] }>,
              target,
              [{ ...params, operations: kept }, ...rest],
            )) as { items: unknown[] };
            return {
              ...response,
              items: [
                ...response.items,
                { update: { status: 429, error: { type: 'es_rejected_execution_exception', reason: '쓰기 대기열 포화' } } },
              ],
            };
          };
        }
        if (property === 'update') {
          return async (...args: unknown[]): Promise<unknown> => {
            updateCalls += 1;
            return Reflect.apply(target.update as (...a: unknown[]) => Promise<unknown>, target, args);
          };
        }
        return Reflect.get(target, property, receiver) as unknown;
      },
    });

    const outcome = await handleEnrichedEvent(buildDeps({ es: flaky }), delivered(enrichedPayload()));

    // 실패한 항목 하나만 다시 갔다. 벌크 전체를 되돌리지 않았다.
    expect(updateCalls).toBe(1);
    expect(outcome.disposition.kind).toBe('ack');
    expect(await deadLetters()).toEqual([]);
    // 개별 재시도가 실제로 그 문서를 색인했다.
    expect(await getDoc('prs-commits', `${String(REPOSITORY_ID)}:${MERGE_SHA}`)).toBeDefined();
  });

  it('DoD 6: 매핑에 없는 필드는 색인이 거부되고 DLQ로 간다 (THR-010)', async () => {
    await insertRaw('delivery-project-1', new Date('2026-08-20T12:00:00.000Z'));
    // 화이트리스트가 뚫렸다고 가정하고 실제로 클러스터가 막는지 본다.
    const leaky = new Proxy(es, {
      get(target, property, receiver) {
        if (property === 'bulk') {
          return async (params: { operations: unknown[] }, ...rest: unknown[]): Promise<unknown> => {
            const operations = params.operations.map((operation) => {
              const body = operation as { script?: { params: { doc: Record<string, unknown> } }; upsert?: Record<string, unknown> };
              if (body.script === undefined) return operation;
              return {
                ...body,
                script: { ...body.script, params: { ...body.script.params, doc: { ...body.script.params.doc, source_patch: 'diff --git' } } },
                upsert: { ...body.upsert, source_patch: 'diff --git' },
              };
            });
            return Reflect.apply(target.bulk as (...a: unknown[]) => Promise<unknown>, target, [
              { ...params, operations },
              ...rest,
            ]);
          };
        }
        return Reflect.get(target, property, receiver) as unknown;
      },
    });

    const outcome = await handleEnrichedEvent(buildDeps({ es: leaky }), delivered(enrichedPayload()));

    expect(outcome.disposition.kind).toBe('dead_letter');
    const letters = await deadLetters();
    expect(letters).toHaveLength(1);
    expect(letters[0]?.stage).toBe('project');
    expect(letters[0]?.error).toContain('strict_dynamic_mapping_exception');
    // 거부된 이벤트는 처리 표식을 받지 않는다 — 색인되지 않았기 때문이다.
    const row = await rawEventRepo.findRawEventByDeliveryId(pool, 'delivery-project-1');
    expect(row?.processed_at).toBeNull();
  });

  it('DoD 7: 커밋이 두 PR에 속해도 `pull_request_numbers`가 합집합으로 남는다 (CR-011)', async () => {
    const first = new Date('2026-08-20T12:00:00.000Z');
    const second = new Date('2026-08-20T13:00:00.000Z');
    await insertRaw('delivery-pr-1', first);
    await insertRaw('delivery-pr-2', second);

    const deps = buildDeps();
    await handleEnrichedEvent(deps, delivered(enrichedPayload({ delivery_id: 'delivery-pr-1' })));
    await handleEnrichedEvent(
      deps,
      delivered(
        enrichedPayload({
          delivery_id: 'delivery-pr-2',
          pr_number: 5678,
          pull_request: { ...BASE_PR, number: 5678, merged: false, merge_commit_sha: null },
        }),
      ),
    );

    const commit = await getDoc('prs-commits', `${String(REPOSITORY_ID)}:${SOURCE_SHA}`);
    expect([...(commit?.['pull_request_numbers'] as number[])].sort((a, b) => a - b)).toEqual([1234, 5678]);
  });

  it('DoD 7: 오래된 이벤트도 자기 PR 번호는 등록한다 (합집합은 버전과 무관하다)', async () => {
    const later = new Date('2026-08-20T13:00:00.000Z');
    const earlier = new Date('2026-08-20T12:00:00.000Z');
    await insertRaw('delivery-late', later);
    await insertRaw('delivery-early', earlier);

    const deps = buildDeps();
    await handleEnrichedEvent(
      deps,
      delivered(enrichedPayload({ delivery_id: 'delivery-late', pr_number: 5678, pull_request: { ...BASE_PR, number: 5678 } })),
    );
    await handleEnrichedEvent(deps, delivered(enrichedPayload({ delivery_id: 'delivery-early' })));

    const commit = await getDoc('prs-commits', `${String(REPOSITORY_ID)}:${SOURCE_SHA}`);
    expect([...(commit?.['pull_request_numbers'] as number[])].sort((a, b) => a - b)).toEqual([1234, 5678]);
  });

  it('DoD 8: 미등록 저장소는 문서를 만들지 않고 실패로도 세지 않는다 (FR-ING-009 AC-4)', async () => {
    await insertRaw('delivery-project-1', new Date('2026-08-20T12:00:00.000Z'), { repository_id: 9999 });
    const outcome = await handleEnrichedEvent(
      buildDeps(),
      delivered(enrichedPayload({ repository_id: 9999 })),
    );

    expect(outcome.disposition.kind).toBe('ack');
    expect(outcome.reason).toBe('repository_unregistered');
    expect(await deadLetters()).toEqual([]);
    expect(await getDoc('prs-pull-requests', `9999:${String(PR_NUMBER)}`)).toBeUndefined();
  });

  it('색인에 성공해야 `raw_event.processed_at`을 찍는다', async () => {
    const receivedAt = new Date('2026-08-20T12:00:00.000Z');
    await insertRaw('delivery-project-1', receivedAt);
    // WP-007은 이 표식을 남겨 뒀다. 색인 전에는 비어 있어야 한다.
    expect((await rawEventRepo.findRawEventByDeliveryId(pool, 'delivery-project-1'))?.processed_at).toBeNull();

    await handleEnrichedEvent(buildDeps(), delivered(enrichedPayload()));

    const row = await rawEventRepo.findRawEventByDeliveryId(pool, 'delivery-project-1');
    expect(row?.processed_at).not.toBeNull();
  });

  it('색인된 문서마다 `EVT-ING-003`을 낸다', async () => {
    await insertRaw('delivery-project-1', new Date('2026-08-20T12:00:00.000Z'));

    const seen: IngestionProjected[] = [];
    const subscription = await bus.subscribe(
      TOPICS.projected,
      consumerGroup(TOPICS.projected),
      async (event) => {
        seen.push(event.payload as IngestionProjected);
      },
      { claimIdleMs: 50, blockMs: 50 },
    );

    try {
      const outcome = await handleEnrichedEvent(buildDeps(), delivered(enrichedPayload()));
      expect(outcome.projected).toHaveLength(3);

      const deadline = Date.now() + 10_000;
      while (seen.length < 3 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    } finally {
      await subscription.close();
    }

    expect(seen).toHaveLength(3);
    expect(seen.map((event) => event.entity_kind).sort()).toEqual(['commit', 'commit', 'pull_request']);
    expect(seen.every((event) => event.correlation_id === CORRELATION_ID)).toBe(true);
  });

  it('원본 이벤트가 아직 없으면 예산 안에서 재시도하고 그 뒤 DLQ로 보낸다', async () => {
    const deps = buildDeps();
    const first = await handleEnrichedEvent(deps, delivered(enrichedPayload()));
    expect(first.disposition.kind).toBe('retry');

    const exhausted = await handleEnrichedEvent(deps, delivered(enrichedPayload(), MAX_RETRIES + 1));
    expect(exhausted.disposition.kind).toBe('dead_letter');
    expect((await deadLetters())[0]?.stage).toBe('project');
  });

  it('계약이 깨진 payload는 파티션을 막지 않고 ack한다', async () => {
    const outcome = await handleEnrichedEvent(buildDeps(), delivered({ nonsense: true } as unknown as IngestionEnriched));
    expect(outcome.disposition.kind).toBe('ack');
    expect(outcome.reason).toContain('delivery_id');
  });

  it('DoD 5: 수신부터 검색 반영까지 p95 10초 이하다 (AC-5, 개발 데이터셋)', async () => {
    const deps = buildDeps();
    const events = 20;
    for (let index = 0; index < events; index += 1) {
      const deliveryId = `delivery-lag-${String(index)}`;
      // 수신 시각이 지금이어야 끝에서 끝까지 지연을 잰다.
      await insertRaw(deliveryId, new Date());
      await handleEnrichedEvent(
        deps,
        delivered(
          enrichedPayload({
            delivery_id: deliveryId,
            pr_number: 9000 + index,
            pull_request: { ...BASE_PR, number: 9000 + index },
            source_commit_shas: [SOURCE_SHA.slice(0, 36) + String(index).padStart(4, '0')],
          }),
        ),
      );
    }

    // 히스토그램의 10초 버킷에 전부 들어갔으면 p95도 10초 이하다.
    expect(deps.metrics.ingestionLagSeconds.count()).toBe(events);
    const rendered = deps.metrics.render();
    const withinTenSeconds = /ingestion_lag_seconds_bucket\{le="10"\} (\d+)/.exec(rendered);
    expect(Number(withinTenSeconds?.[1] ?? 0)).toBe(events);
  });
});
