/**
 * 게이트웨이 통합 테스트 공용 헬퍼.
 *
 * 실제 PostgreSQL과 실제 HTTP를 쓴다. `app.inject()`는 네트워크 계층을 건너뛰므로
 * 수신 응답 시간(NFR-002)이나 본문 크기 상한을 재는 데는 쓰지 않는다.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPool, ensureAllPartitions, migrateUp, resolvePoolConfig, type Pool } from '@prs/db';
import { createArchiveWriter, NULL_ARCHIVE_WRITER, type ArchiveWriter } from '../src/archive.js';
import { MAX_BODY_BYTES, type GatewayConfig } from '../src/config.js';
import { createIngestMetrics, type IngestMetrics } from '../src/metrics.js';
import { buildServer, createServerDeps, type ServerDeps } from '../src/server.js';
import type { EventBus } from '@prs/bus';
import { computeSignature } from '../src/signature.js';
import type { FastifyInstance } from 'fastify';

export const WEBHOOK_SECRET = 'integration-webhook-secret';

/** 발행을 버리는 버스. 큐를 보지 않는 테스트가 Redis에 의존하지 않게 한다. */
export const NULL_BUS: EventBus = {
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
  await ensureAllPartitions(pool, 3);
  return pool;
}

export function testConfig(overrides: Partial<GatewayConfig> = {}): GatewayConfig {
  return {
    port: 0,
    webhookSecrets: [WEBHOOK_SECRET],
    maxBodyBytes: MAX_BODY_BYTES,
    archivePath: null,
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
