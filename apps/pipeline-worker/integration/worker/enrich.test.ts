/**
 * JOB-ING-002 보강 워커 (WP-007, FR-ING-004).
 *
 * 실제 PostgreSQL·실제 Redis·실제 HTTP(목 GHE 서버)를 쓴다. 이 WP가 증명해야
 * 할 것 대부분이 **상태 코드와 헤더에 대한 반응**이라 fetch를 목으로 바꾸면
 * 그 경로를 통째로 건너뛴다.
 *
 * 검증: `pnpm test:integration worker/enrich`
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { deadLetterRepo, rawEventRepo, type Pool, type RawEventInsert } from '@prs/db';
import {
  MAX_RETRIES,
  RedisStreamsEventBus,
  TOPICS,
  partitionFor,
  partitionStream,
  type DeliveredEvent,
  type Redis,
} from '@prs/bus';
import {
  EVENT_NAMES,
  deterministicEventId,
  type IngestionEnriched,
  type IngestionEventReceived,
} from '@prs/domain';
import {
  GitHubClient,
  GitHubTransport,
  InstallationTokenProvider,
  RequestScheduler,
  TokenPool,
} from '@prs/github';
import {
  GITHUB_PR_COMMITS_API_LIMIT,
  generateTestKeyPair,
  startMockGhe,
  type MockGhe,
  type MockGheOptions,
} from '../../../../packages/github/testing/mock-ghe.js';
import { handleIngestEvent, startEnrichWorker, type EnrichDeps } from '../../src/enrich.js';
import { createWorkerMetrics } from '../../src/metrics.js';
import { createTestRedis, migratedPool } from '../helpers.js';

const keys = generateTestKeyPair();
const DELIVERY_ID = 'delivery-enrich-1';
const CORRELATION_ID = '0f0a1b2c-3d4e-5f60-7182-93a4b5c6d7e8';
const REPOSITORY_ID = 4021;
const PR_NUMBER = 1234;
const RECEIVED_AT = new Date('2026-08-20T12:00:00.000Z');

let pool: Pool;
let redis: Redis;
let bus: RedisStreamsEventBus;
let ghe: MockGhe | undefined;

beforeAll(async () => {
  pool = await migratedPool({ fixtureMonths: ['2026-08'] });
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
  await pool.query('TRUNCATE dead_letter');
  await redis.flushdb();
});

afterEach(async () => {
  await ghe?.close();
  ghe = undefined;
});

/** 목 GHE에 붙은 보강 의존성 묶음. */
async function buildDeps(
  options: MockGheOptions = {},
  overrides: { readonly installations?: readonly { org: string; installationId: number }[] } = {},
): Promise<EnrichDeps & { readonly metrics: ReturnType<typeof createWorkerMetrics> }> {
  ghe = await startMockGhe(options);
  const provider = new InstallationTokenProvider({
    apiUrl: ghe.apiUrl,
    appId: '12345',
    privateKey: keys.privateKey,
    refreshLeadMs: 60_000,
    requestTimeoutMs: 5_000,
  });
  const tokenPool = new TokenPool(provider, {
    installations: overrides.installations ?? [{ org: 'acme', installationId: 42 }],
    quarantineThreshold: 0.1,
  });
  const metrics = createWorkerMetrics();
  return {
    pool,
    bus,
    client: new GitHubClient(
      new GitHubTransport({
        apiUrl: ghe.apiUrl,
        requestTimeoutMs: 5_000,
        pool: tokenPool,
        scheduler: new RequestScheduler({ maxConcurrent: 4 }),
      }),
    ),
    installationFor: (org) => tokenPool.installationFor(org),
    metrics,
  };
}

function prPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    action: 'closed',
    number: PR_NUMBER,
    repository: { id: REPOSITORY_ID, full_name: 'acme/payments' },
    pull_request: {
      number: PR_NUMBER,
      title: 'feat: 결제 재시도',
      state: 'closed',
      merged: true,
      merged_at: '2026-08-19T10:00:00Z',
      merge_commit_sha: 'a3f9c21b4e8d7f0c1a2b3c4d5e6f708192a3b4c5',
      user: { login: 'dev' },
      head: { ref: 'feature/retry', sha: 'b1c2d3e4f5061728394a5b6c7d8e9f0a1b2c3d4e' },
      base: { ref: 'main', sha: 'c1d2e3f405162738495a6b7c8d9e0f1a2b3c4d5e' },
    },
    ...overrides,
  };
}

async function insertRaw(overrides: Partial<RawEventInsert> = {}): Promise<void> {
  await rawEventRepo.insertRawEventIfAbsent(pool, {
    delivery_id: DELIVERY_ID,
    event_type: 'pull_request',
    action: 'closed',
    repository_id: REPOSITORY_ID,
    received_at: RECEIVED_AT,
    payload: prPayload(),
    payload_hash: 'a'.repeat(64),
    correlation_id: CORRELATION_ID,
    queued_at: RECEIVED_AT,
    ...overrides,
  });
}

/** 버스가 핸들러에게 건네는 모양 그대로 만든다. */
function delivered(deliveryCount = 1, deliveryId = DELIVERY_ID): DeliveredEvent {
  const payload: IngestionEventReceived = {
    delivery_id: deliveryId,
    event_type: 'pull_request',
    action: 'closed',
    repository_id: REPOSITORY_ID,
    correlation_id: CORRELATION_ID,
    occurred_at: RECEIVED_AT.toISOString(),
  };
  return {
    event_id: 'evt-1',
    event_name: EVENT_NAMES.ingestionEventReceived,
    correlation_id: CORRELATION_ID,
    occurred_at: RECEIVED_AT.toISOString(),
    partition_key: String(REPOSITORY_ID),
    partition: 0,
    delivery_count: deliveryCount,
    message_id: 'm-1',
    payload,
  };
}

async function deadLetters(): Promise<{ error: string; retry_count: number }[]> {
  const result = await pool.query<{ error: string; retry_count: number }>(
    'SELECT error, retry_count FROM dead_letter ORDER BY dead_letter_id',
  );
  return result.rows;
}

async function processedAt(): Promise<Date | null> {
  const row = await rawEventRepo.findRawEventByDeliveryId(pool, DELIVERY_ID);
  return row?.processed_at ?? null;
}

async function enrichedStreamLength(): Promise<number> {
  const stream = partitionStream(
    TOPICS.enriched,
    partitionFor(String(REPOSITORY_ID), bus.partitions(TOPICS.enriched)),
  );
  return redis.xlen(stream);
}

describe('정상 보강 (FR-ING-004 AC-1)', () => {
  it('커밋·파일·리뷰를 병합해 EVT-ING-002를 발행한다', async () => {
    const deps = await buildDeps();
    await insertRaw();

    const outcome = await handleIngestEvent(deps, delivered());

    expect(outcome.disposition.kind).toBe('ack');
    expect(outcome.published).toMatchObject({
      delivery_id: DELIVERY_ID,
      repository_id: REPOSITORY_ID,
      entity_kind: 'pull_request',
      pr_number: PR_NUMBER,
      enrichment_pending: false,
      source_commits_truncated: false,
      files_truncated: false,
    });
    expect(outcome.published?.source_commit_shas).toEqual(['aaa1']);
    expect(outcome.published?.changed_files).toEqual([
      { filename: 'src/pay.ts', additions: 12, deletions: 3, status: 'modified' },
    ]);
    expect(outcome.published?.reviews).toEqual([
      { id: 9, state: 'APPROVED', reviewer: 'reviewer', submitted_at: '2026-08-20T00:00:00Z' },
    ]);
    expect(await enrichedStreamLength()).toBe(1);
    expect(await deadLetters()).toHaveLength(0);
  });

  it('EVT-ING-002만으로 투영이 문서를 만들 수 있다 — API를 다시 부르지 않아도 된다 (DEV-013)', async () => {
    const deps = await buildDeps();
    await insertRaw();

    const published = (await handleIngestEvent(deps, delivered())).published;
    expect(published).toBeDefined();
    if (published === undefined) return;

    // WP-008이 문서를 만들 때 필요한 값이 모두 이벤트 안에 있다.
    expect(published.pull_request).toMatchObject({
      number: PR_NUMBER,
      merged: true,
      merge_commit_sha: 'a3f9c21b4e8d7f0c1a2b3c4d5e6f708192a3b4c5',
      base_ref: 'main',
      head_sha: 'b1c2d3e4f5061728394a5b6c7d8e9f0a1b2c3d4e',
    });
    // 투영의 `lead_time_seconds`·`first_review_wait_seconds` 기준점 (CR-011, DEV-018).
    expect(published.pull_request?.created_at).toBe('2026-08-01T09:00:00Z');
    expect(published.pull_request?.labels).toEqual(['payments', 'bug']);
    expect(published.pull_request?.draft).toBe(false);
    // 겹치는 필드는 **API 응답**이 이긴다. 웹훅은 발생 시점의 스냅숏이고 재전송이면
    // 몇 분 전 것일 수도 있다 — 목 GHE는 `jdoe`/`2026-08-02`, 웹훅은 `dev`/`2026-08-19`다.
    expect(published.pull_request?.author).toBe('jdoe');
    expect(published.pull_request?.merged_at).toBe('2026-08-02T10:30:00Z');
    const additions = published.changed_files.reduce((sum, file) => sum + file.additions, 0);
    const deletions = published.changed_files.reduce((sum, file) => sum + file.deletions, 0);
    expect({ count: published.changed_files.length, additions, deletions }).toEqual({
      count: 1,
      additions: 12,
      deletions: 3,
    });
    expect(published.reviews[0]?.submitted_at).toBe('2026-08-20T00:00:00Z');
  });

  it('원본 웹훅 전량·patch·토큰을 싣지 않는다 (CR-010 금지 목록)', async () => {
    const deps = await buildDeps();
    // patch 본문과 토큰처럼 보이는 값이 원본 payload에 들어 있어도 새어 나가면 안 된다.
    await insertRaw({
      payload: prPayload({
        installation: { id: 42 },
        sender: { login: 'dev' },
        secret_field: 'ghs_shouldnevershipthisvalue0000000000',
        patch: '@@ -1 +1 @@\n-old\n+new',
      }),
    });

    const published = (await handleIngestEvent(deps, delivered())).published;
    const serialized = JSON.stringify(published);
    expect(serialized).not.toContain('ghs_');
    expect(serialized).not.toContain('@@');
    expect(serialized).not.toContain('secret_field');
    expect(serialized).not.toContain('installation');
    expect(serialized).not.toContain('sender');
  });

  it('같은 전달을 다시 처리하면 같은 event_id가 나온다', async () => {
    const deps = await buildDeps();
    await insertRaw();

    await handleIngestEvent(deps, delivered());
    const stream = partitionStream(
      TOPICS.enriched,
      partitionFor(String(REPOSITORY_ID), bus.partitions(TOPICS.enriched)),
    );
    const entries = await redis.xrange(stream, '-', '+');
    const fields = entries[0]?.[1] ?? [];
    const eventId = fields[fields.indexOf('event_id') + 1];
    expect(eventId).toBe(deterministicEventId(EVENT_NAMES.ingestionEnriched, DELIVERY_ID));
  });
});

describe('절삭 (FR-ING-004 AC-4, FR-SRCH-003 AC-4)', () => {
  it('변경 파일 3000개를 넘으면 절삭하고 files_truncated를 세운다', async () => {
    const deps = await buildDeps({ resources: { files: 3001 } });
    await insertRaw();

    const published = (await handleIngestEvent(deps, delivered())).published;
    expect(published?.changed_files).toHaveLength(3000);
    expect(published?.files_truncated).toBe(true);
  });

  it('원본 커밋 250건을 넘으면 절삭하고 source_commits_truncated를 세운다', async () => {
    const deps = await buildDeps({ resources: { commits: 251 } });
    await insertRaw();

    const published = (await handleIngestEvent(deps, delivered())).published;
    expect(published?.source_commit_shas).toHaveLength(250);
    expect(published?.source_commits_truncated).toBe(true);
  });

  it('상한을 정확히 채운 것은 절삭이 아니다 — 길이로 추측하지 않는다', async () => {
    const deps = await buildDeps({ resources: { files: 3000, commits: 250 } });
    await insertRaw();

    const published = (await handleIngestEvent(deps, delivered())).published;
    expect(published?.changed_files).toHaveLength(3000);
    expect(published?.files_truncated).toBe(false);
    expect(published?.source_commit_shas).toHaveLength(250);
    expect(published?.source_commits_truncated).toBe(false);
  });
});

/*
 * `source_commits_complete`는 **커밋에서 PR 번호를 지울 권한**이다. 목록에 없다는
 * 사실이 "그 PR 소속이 아니다"라는 뜻이 되려면 그 목록이 원격의 전부여야 한다.
 * 그래서 이 판정에서 거짓을 참으로 읽는 실수는 되돌릴 수 없는 삭제가 된다.
 */
describe('관계 관측의 완전성 (CR-116 / FR-ING-004 AC-6, DEV-744)', () => {
  it('커밋이 정확히 250건이면 완전하다고 말한다 — 삭제 권한이 서는 자리다', async () => {
    const deps = await buildDeps({
      resources: { commits: GITHUB_PR_COMMITS_API_LIMIT },
      capCommitListAtApiLimit: true,
    });
    await insertRaw();

    const published = (await handleIngestEvent(deps, delivered())).published;

    expect(published?.source_commit_shas).toHaveLength(GITHUB_PR_COMMITS_API_LIMIT);
    expect(published?.source_commits_truncated).toBe(false);
    expect(published?.pull_request?.commits_count).toBe(GITHUB_PR_COMMITS_API_LIMIT);
    expect(published?.source_commits_complete).toBe(true);
  });

  it('400 커밋 PR은 절삭 표식이 없어도 완전하지 않다 — API가 말없이 250건에서 자른다', async () => {
    const deps = await buildDeps({ resources: { commits: 400 }, capCommitListAtApiLimit: true });
    await insertRaw();

    const published = (await handleIngestEvent(deps, delivered())).published;

    // 겉으로는 아무 문제가 없다. 응답은 200이고, 마지막 페이지가 `per_page`보다
    // 짧아 `rel="next"`도 없으니 우리 쪽에 잘렸다는 표식이 하나도 없다 — 바로 위
    // 250 커밋 PR과 **구분되지 않는 모습**이다.
    expect(published?.source_commit_shas).toHaveLength(GITHUB_PR_COMMITS_API_LIMIT);
    expect(published?.source_commits_truncated).toBe(false);
    expect(published?.enrichment_pending).toBe(false);
    expect(await deadLetters()).toHaveLength(0);

    // 둘을 가르는 것은 커밋 수 대조 하나뿐이다. 그것이 없으면 읽지 못한 150건이
    // "이 PR 소속이 아니다"로 읽혀 그 커밋들에서 PR 번호가 지워진다.
    expect(published?.pull_request?.commits_count).toBe(400);
    expect(published?.source_commits_complete).toBe(false);
  });

  it('커밋 조회가 실패하면 빈 목록을 부재로 읽지 않는다', async () => {
    // 실패로 나온 `[]`는 "커밋이 없다"가 아니라 **모른다**이다. 둘을 같게 다루면
    // 한 번의 403이 그 PR의 커밋 링크를 전부 지운다.
    const deps = await buildDeps({ failures: [{ resource: 'commits', status: 403 }] });
    await insertRaw();

    const published = (await handleIngestEvent(deps, delivered())).published;

    expect(published?.source_commit_shas).toEqual([]);
    expect(published?.source_commits_complete).toBe(false);
    expect(published?.enrichment_errors).toMatchObject([{ component: 'commits', kind: 'auth' }]);
  });

  it('리뷰 조회만 실패한 것은 커밋 목록의 완전성과 무관하다', async () => {
    // 완전성은 **커밋 목록 하나**에 대한 판정이다. 보강이 부분 실패했다는 이유만으로
    // 권한을 거두면, 리뷰 API가 자주 흔들리는 저장소에서는 커밋 링크가 영영
    // 정리되지 않는다.
    const deps = await buildDeps({ failures: [{ resource: 'reviews', status: 403 }] });
    await insertRaw();

    const published = (await handleIngestEvent(deps, delivered())).published;

    expect(published?.enrichment_pending).toBe(true);
    expect(published?.reviews).toEqual([]);
    expect(published?.enrichment_errors).toMatchObject([{ component: 'reviews', kind: 'auth' }]);
    expect(published?.source_commits_complete).toBe(true);
  });
});

describe('rate limit (FR-ING-004 AC-2, CR-010 DEV-014)', () => {
  it('부 한도에 걸리면 retry-after까지 미루고 재시도 예산을 쓰지 않는다', async () => {
    const deps = await buildDeps({ secondaryLimitTimes: 100, retryAfterSeconds: 600 });
    await insertRaw();

    const outcome = await handleIngestEvent(deps, delivered());

    expect(outcome.disposition.kind).toBe('defer');
    if (outcome.disposition.kind !== 'defer') return;
    // 10분 뒤다. `claimIdleMs` 30초와 무관하게 그때까지 다시 부르지 않는다.
    expect(outcome.disposition.until.getTime() - Date.now()).toBeGreaterThan(9 * 60 * 1_000);
    expect(await deadLetters()).toHaveLength(0);
    expect(await enrichedStreamLength()).toBe(0);
  });

  it('주 한도가 소진되면 회복 시각까지 미룬다', async () => {
    const resetAt = Math.floor(Date.now() / 1_000) + 900;
    const deps = await buildDeps({ rateLimit: { limit: 5000, remaining: [0], resetAt } });
    await insertRaw();

    const outcome = await handleIngestEvent(deps, delivered());

    expect(outcome.disposition.kind).toBe('defer');
    expect(await deadLetters()).toHaveLength(0);
  });

  it('유예가 재시도 예산을 소비하지 않는다 — 전달 횟수가 5여도 실패 대기열로 가지 않는다', async () => {
    // DEV-014 회귀. 예전 계약이라면 30초마다 재전달돼 10분이 되기 전에 5회를
    // 소진하고 DLQ로 갔다.
    const deps = await buildDeps({ secondaryLimitTimes: 100, retryAfterSeconds: 600 });
    await insertRaw();

    const outcome = await handleIngestEvent(deps, delivered(MAX_RETRIES));

    expect(outcome.disposition.kind).toBe('defer');
    expect(await deadLetters()).toHaveLength(0);
  });
});

describe('부분 실패 (FR-ING-004 AC-3)', () => {
  it('일부 조회가 실패해도 나머지를 enrichment_pending으로 진행한다', async () => {
    // 재시도할 수 없는 실패(403)라 예산을 태우지 않고 곧바로 부분 진행이다.
    const deps = await buildDeps({ failures: [{ resource: 'files', status: 403 }] });
    await insertRaw();

    const outcome = await handleIngestEvent(deps, delivered());

    expect(outcome.published?.enrichment_pending).toBe(true);
    expect(outcome.published?.changed_files).toEqual([]);
    expect(outcome.published?.source_commit_shas).toEqual(['aaa1']);
    expect(outcome.published?.enrichment_errors).toMatchObject([{ component: 'files', kind: 'auth' }]);
    expect(await enrichedStreamLength()).toBe(1);
    expect(deps.metrics.enrichPending.get({ reason: 'auth' })).toBe(1);
  });

  it('보강이 전부 실패해도 웹훅 payload로 만든 부분 문서는 남는다', async () => {
    const deps = await buildDeps({
      failures: [
        { resource: 'pull_request', status: 403 },
        { resource: 'commits', status: 403 },
        { resource: 'files', status: 403 },
        { resource: 'reviews', status: 403 },
      ],
    });
    await insertRaw();

    const outcome = await handleIngestEvent(deps, delivered());

    expect(outcome.published?.enrichment_pending).toBe(true);
    expect(outcome.published?.pull_request).toMatchObject({ number: PR_NUMBER, merged: true, author: 'dev' });
    expect(await enrichedStreamLength()).toBe(1);
  });

  it('재시도 가능한 실패는 예산이 남아 있으면 재시도한다', async () => {
    const deps = await buildDeps({ failures: [{ resource: 'files', status: 500 }] });
    await insertRaw();

    const outcome = await handleIngestEvent(deps, delivered(1));

    expect(outcome.disposition.kind).toBe('retry');
    expect(await enrichedStreamLength()).toBe(0);
    expect(await deadLetters()).toHaveLength(0);
  });

  it('재시도 5회를 소진하면 부분 문서를 진행하고 실패 대기열로 보낸다 (FR-ING-007 AC-1)', async () => {
    const deps = await buildDeps({ failures: [{ resource: 'files', status: 500 }] });
    await insertRaw();

    const outcome = await handleIngestEvent(deps, delivered(MAX_RETRIES + 1));

    expect(outcome.disposition.kind).toBe('dead_letter');
    expect(outcome.published?.enrichment_pending).toBe(true);
    expect(outcome.published?.source_commit_shas).toEqual(['aaa1']);
    const rows = await deadLetters();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.retry_count).toBe(MAX_RETRIES);
    expect(await enrichedStreamLength()).toBe(1);
  });
});

describe('종료 실패 (비동기 5.2)', () => {
  it('404는 재시도 없이 즉시 실패 대기열로 간다', async () => {
    const deps = await buildDeps({ failures: [{ resource: 'pull_request', status: 404 }] });
    await insertRaw();

    const outcome = await handleIngestEvent(deps, delivered(1));

    expect(outcome.disposition.kind).toBe('dead_letter');
    expect(await deadLetters()).toHaveLength(1);
    expect(await enrichedStreamLength()).toBe(0);
  });

  it('설치가 등록되지 않은 조직은 조용히 넘기지 않는다 (DEV-015)', async () => {
    const deps = await buildDeps({}, { installations: [{ org: 'contoso', installationId: 7 }] });
    await insertRaw();

    const outcome = await handleIngestEvent(deps, delivered());

    expect(outcome.disposition.kind).toBe('dead_letter');
    const rows = await deadLetters();
    expect(rows[0]?.error).toContain('GHE_INSTALLATIONS');
    // GHE를 아예 부르지 않았다 — 설치를 모르는 채로 요청하지 않는다.
    expect(ghe?.requests ?? []).toHaveLength(0);
  });

  it('모양이 깨진 payload는 PR API를 부르지 않고 실패 대기열로 간다', async () => {
    const deps = await buildDeps();
    await insertRaw({ payload: { action: 'closed', repository: { id: REPOSITORY_ID, full_name: 'acme/payments' } } });

    const outcome = await handleIngestEvent(deps, delivered());

    expect(outcome.disposition.kind).toBe('dead_letter');
    expect(ghe?.requests.filter((request) => request.path.includes('/pulls/'))).toHaveLength(0);
  });

  it('원본 이벤트가 없으면 예산 안에서는 재시도하고 소진되면 실패 대기열로 간다', async () => {
    const deps = await buildDeps();

    expect((await handleIngestEvent(deps, delivered(1))).disposition.kind).toBe('retry');
    expect((await handleIngestEvent(deps, delivered(MAX_RETRIES + 1))).disposition.kind).toBe('dead_letter');
  });
});

describe('경계 (WP-007 제외 범위)', () => {
  it('PR 이벤트가 아니면 진행하지 않고 ack한다 (DEV-016)', async () => {
    const deps = await buildDeps();
    await insertRaw({ event_type: 'push', action: null, payload: { ref: 'refs/heads/main' } });

    const outcome = await handleIngestEvent(deps, delivered());

    expect(outcome.disposition.kind).toBe('ack');
    expect(await deadLetters()).toHaveLength(0);
    expect(await enrichedStreamLength()).toBe(0);
    // 원본은 남아 있다. 소비자가 생기면 그때 진행된다.
    expect(await rawEventRepo.findRawEventByDeliveryId(pool, DELIVERY_ID)).toBeDefined();
  });

  it('raw_event.processed_at을 건드리지 않는다 — 색인 시점 표식은 WP-008의 것이다', async () => {
    const deps = await buildDeps();
    await insertRaw();
    expect(await processedAt()).toBeNull();

    await handleIngestEvent(deps, delivered());

    expect(await processedAt()).toBeNull();
  });

  it('실패 경로에서도 processed_at을 찍지 않는다', async () => {
    const deps = await buildDeps({ failures: [{ resource: 'pull_request', status: 404 }] });
    await insertRaw();

    await handleIngestEvent(deps, delivered());

    expect(await processedAt()).toBeNull();
  });
});

describe('버스 왕복 (WP-005 계약 위)', () => {
  it('prs:ingest를 구독해 처리하고 prs:enriched로 넘긴다', async () => {
    const deps = await buildDeps();
    await insertRaw();

    const subscription = await startEnrichWorker(deps, { claimIdleMs: 200, blockMs: 50 });
    try {
      await bus.publish(TOPICS.ingest, String(REPOSITORY_ID), {
        event_id: 'evt-ingest-1',
        event_name: EVENT_NAMES.ingestionEventReceived,
        correlation_id: CORRELATION_ID,
        occurred_at: RECEIVED_AT.toISOString(),
        payload: {
          delivery_id: DELIVERY_ID,
          event_type: 'pull_request',
          action: 'closed',
          repository_id: REPOSITORY_ID,
          correlation_id: CORRELATION_ID,
          occurred_at: RECEIVED_AT.toISOString(),
        } satisfies IngestionEventReceived,
      });

      const deadline = Date.now() + 15_000;
      while (Date.now() < deadline && (await enrichedStreamLength()) === 0) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    } finally {
      await subscription.close();
    }

    expect(await enrichedStreamLength()).toBe(1);
    const received: IngestionEnriched[] = [];
    const consumer = await bus.subscribe(
      TOPICS.enriched,
      'project',
      async (event) => {
        received.push(event.payload as IngestionEnriched);
      },
      { claimIdleMs: 200, blockMs: 50 },
    );
    try {
      const deadline = Date.now() + 15_000;
      while (Date.now() < deadline && received.length === 0) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    } finally {
      await consumer.close();
    }

    expect(received[0]).toMatchObject({
      delivery_id: DELIVERY_ID,
      pr_number: PR_NUMBER,
      enrichment_pending: false,
    });
  });

  it('rate limit 유예 중에는 claimIdleMs가 지나도 다시 부르지 않는다 (DEV-014 회귀)', async () => {
    // `claimIdleMs`(200ms)를 훨씬 넘겨 기다려도 두 번째 전달이 없어야 한다.
    // 예전 계약이라면 200ms마다 재전달되어 재시도 예산을 태웠을 자리다.
    const deps = await buildDeps({ secondaryLimitTimes: 100, retryAfterSeconds: 600 });
    await insertRaw();

    const subscription = await startEnrichWorker(deps, { claimIdleMs: 200, blockMs: 50 });
    try {
      await bus.publish(TOPICS.ingest, String(REPOSITORY_ID), {
        event_id: 'evt-ingest-2',
        event_name: EVENT_NAMES.ingestionEventReceived,
        correlation_id: CORRELATION_ID,
        occurred_at: RECEIVED_AT.toISOString(),
        payload: {
          delivery_id: DELIVERY_ID,
          event_type: 'pull_request',
          action: 'closed',
          repository_id: REPOSITORY_ID,
          correlation_id: CORRELATION_ID,
          occurred_at: RECEIVED_AT.toISOString(),
        } satisfies IngestionEventReceived,
      });
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    } finally {
      await subscription.close();
    }

    const attempts = ghe?.requests.filter((request) => request.path.includes('/pulls/')).length ?? 0;
    // 정확히 한 번이다. 첫 429가 설치를 격리하므로 나머지 조회는 HTTP까지 가지도
    // 않는다. 2초 동안 200ms 주기로 재전달됐다면 열 번 가까이 찍혔을 자리다.
    expect(attempts).toBe(1);
    expect(await deadLetterRepo.listDeadLetters(pool, { states: deadLetterRepo.OPEN_STATES })).toHaveLength(0);
  });

  it('종료 실패는 ack되어 같은 파티션의 다음 이벤트를 막지 않는다', async () => {
    // 404 이벤트가 미ack로 남으면 그 저장소의 이후 이벤트가 영영 멈춘다.
    const deps = await buildDeps({ failures: [{ resource: 'pull_request', status: 404, times: 1 }] });
    await insertRaw();
    await insertRaw({ delivery_id: 'delivery-enrich-2' });

    const publish = async (deliveryId: string, eventId: string): Promise<void> => {
      await bus.publish(TOPICS.ingest, String(REPOSITORY_ID), {
        event_id: eventId,
        event_name: EVENT_NAMES.ingestionEventReceived,
        correlation_id: CORRELATION_ID,
        occurred_at: RECEIVED_AT.toISOString(),
        payload: {
          delivery_id: deliveryId,
          event_type: 'pull_request',
          action: 'closed',
          repository_id: REPOSITORY_ID,
          correlation_id: CORRELATION_ID,
          occurred_at: RECEIVED_AT.toISOString(),
        } satisfies IngestionEventReceived,
      });
    };

    const subscription = await startEnrichWorker(deps, { claimIdleMs: 200, blockMs: 50 });
    try {
      await publish(DELIVERY_ID, 'evt-ingest-3');
      await publish('delivery-enrich-2', 'evt-ingest-4');

      const deadline = Date.now() + 15_000;
      while (Date.now() < deadline && (await enrichedStreamLength()) === 0) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    } finally {
      await subscription.close();
    }

    // 첫 이벤트는 실패 대기열로 갔고, 두 번째는 그 뒤로 정상 처리됐다.
    expect(await deadLetters()).toHaveLength(1);
    expect(await enrichedStreamLength()).toBe(1);
  });
});
