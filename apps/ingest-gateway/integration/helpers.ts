/**
 * 게이트웨이 통합 테스트 공용 헬퍼.
 *
 * 실제 PostgreSQL과 실제 HTTP를 쓴다. `app.inject()`는 네트워크 계층을 건너뛰므로
 * 수신 응답 시간(NFR-002)이나 본문 크기 상한을 재는 데는 쓰지 않는다.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPool, ensureAllPartitions, resolvePoolConfig, type Pool } from '@prs/db';
import { migrateUp } from '@prs/db/migrate';
import {
  createArchiveWriter,
  DEFAULT_ARCHIVE_ROTATION,
  NULL_ARCHIVE_WRITER,
  type ArchiveWriter,
} from '../src/archive.js';
import { MAX_BODY_BYTES, type GatewayConfig } from '../src/config.js';
import { createIngestMetrics, type IngestMetrics } from '../src/metrics.js';
import { buildServer, createServerDeps, type ServerDeps } from '../src/server.js';
import type { EventBus } from '@prs/bus';
import { computeSignature } from '../src/signature.js';
import type { FastifyInstance } from 'fastify';

export const WEBHOOK_SECRET = 'integration-webhook-secret';

/** 발행을 버리는 버스. 큐를 보지 않는 테스트가 Redis에 의존하지 않게 한다. */
export const NULL_BUS: EventBus = {
  depth: async (): Promise<number> => 0,
  publish: async (): Promise<void> => undefined,
  subscribe: () => Promise.reject(new Error('구독하지 않는다')),
  close: async (): Promise<void> => undefined,
};

export function createTestPool(): Pool {
  const env = { ...process.env };
  if (env['DATABASE_URL'] === undefined || env['DATABASE_URL'] === '') {
    env['POSTGRES_DB'] = env['POSTGRES_TEST_DB'] ?? 'prs_test';
  }
  return createPool(resolvePoolConfig(env));
}

/** 스키마와 파티션까지 갖춘 풀. 여러 번 불러도 안전하다. */
export async function migratedPool(): Promise<Pool> {
  const pool = createTestPool();
  await migrateUp(pool);
  /*
   * **파티션 창을 과거로도 연다** (DEV-500). `ensureAllPartitions`의 기본 `from`은
   * **현재 월**이라 앞으로 3개월치만 만드는데, 통합 시험 여럿이 `audit_record`·
   * `raw_event`에 **고정된 과거 날짜**로 쓴다 — 커서 순회와 범위 필터를 검증하려면
   * 결정적인 시각이 필요하기 때문이다. 달이 바뀌면 그 파티션이 사라져 삽입이
   * `23514`로 죽고, **개발자 DB에는 지난달 파티션이 남아 있어 CI에서만 드러난다.**
   *
   * **창을 3개월로 좁혀 둔 데에는 이유가 있다.** 넓히면 그 파티션들이 보존 잡의
   * 드롭 대상 구간에 들어가는데, 여기서 만든 것은 소유자가 `prs`이고 `prs_admin`은
   * 그것을 지우지 못해 `runPartitionRetention`의 `failed`에 쌓인다 — 12개월로 열었다가
   * `retention-role.test.ts`가 그렇게 깨졌다. 더 오래된 날짜가 필요한 시험은
   * `makePartition`처럼 **자기가 만들고 소유권까지 맞춘다.**
   */
  const now = new Date();
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 3, 1));
  await ensureAllPartitions(pool, 6, from);
  return pool;
}

export function testConfig(overrides: Partial<GatewayConfig> = {}): GatewayConfig {
  return {
    port: 0,
    webhookSecrets: [WEBHOOK_SECRET],
    maxBodyBytes: MAX_BODY_BYTES,
    archivePath: null,
    archiveRotation: DEFAULT_ARCHIVE_ROTATION,
    shutdownGraceMs: 30_000,
    enqueueTimeoutMs: 150,
    ...overrides,
  };
}

export interface RunningGateway {
  readonly app: FastifyInstance;
  readonly baseUrl: string;
  readonly metrics: IngestMetrics;
  readonly archive: ArchiveWriter;
  readonly archivePath: string | null;
  stop(): Promise<void>;
}

export interface StartOptions {
  readonly config?: GatewayConfig;
  readonly now?: () => Date;
  readonly withArchive?: boolean;
  /** 실제 버스. 생략하면 발행을 무시하는 스텁을 쓴다. */
  readonly bus?: EventBus;
}

/** 실제 포트를 열고 게이트웨이를 띄운다. */
export async function startGateway(pool: Pool, options: StartOptions = {}): Promise<RunningGateway> {
  let tempDir: string | null = null;
  let archivePath: string | null = null;
  let archive: ArchiveWriter = NULL_ARCHIVE_WRITER;

  if (options.withArchive === true) {
    tempDir = mkdtempSync(join(tmpdir(), 'prs-archive-'));
    archivePath = join(tempDir, 'raw-events.ndjson');
    archive = createArchiveWriter(archivePath);
  }

  const config = options.config ?? testConfig();
  const bus = options.bus ?? NULL_BUS;
  const base = createServerDeps(pool, config, bus);
  const metrics = createIngestMetrics();
  const deps: ServerDeps = {
    ...base,
    archive,
    metrics,
    log: (): void => {
      /* 통합 테스트에서는 로그를 삼킨다 */
    },
    ...(options.now === undefined ? {} : { now: options.now }),
  };

  const app = buildServer(deps);
  const address = await app.listen({ port: 0, host: '127.0.0.1' });

  return {
    app,
    baseUrl: address,
    metrics,
    archive,
    archivePath,
    stop: async (): Promise<void> => {
      await app.close();
      await archive.close();
      if (tempDir !== null) rmSync(tempDir, { recursive: true, force: true });
    },
  };
}

export interface PostOptions {
  readonly body: string | Buffer;
  readonly eventType?: string | undefined;
  readonly deliveryId?: string | undefined;
  readonly signature?: string | undefined;
  readonly secret?: string;
}

/** 서명을 붙여 실제 HTTP POST를 보낸다. */
export async function postWebhook(baseUrl: string, options: PostOptions): Promise<Response> {
  const body = Buffer.isBuffer(options.body) ? options.body : Buffer.from(options.body, 'utf8');
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-hub-signature-256': options.signature ?? computeSignature(body, options.secret ?? WEBHOOK_SECRET),
  };
  if (options.eventType !== undefined) headers['x-github-event'] = options.eventType;
  if (options.deliveryId !== undefined) headers['x-github-delivery'] = options.deliveryId;

  return fetch(`${baseUrl}/api/v1/webhooks/github`, { method: 'POST', headers, body });
}

export async function countRawEvents(pool: Pool, deliveryId?: string): Promise<number> {
  const result =
    deliveryId === undefined
      ? await pool.query<{ count: string }>('SELECT count(*) AS count FROM raw_event')
      : await pool.query<{ count: string }>(
          'SELECT count(*) AS count FROM raw_event WHERE delivery_id = $1',
          [deliveryId],
        );
  return Number(result.rows[0]?.count ?? '0');
}

export async function truncateRawEvents(pool: Pool): Promise<void> {
  await pool.query('TRUNCATE raw_event');
}
