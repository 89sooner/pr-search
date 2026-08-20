/**
 * ingest-gateway — GHE 웹훅 수신 게이트웨이 (ADR-002 레인 A 입구).
 *
 * 이 앱은 시스템에서 유일한 공개 인바운드 지점이다 (보안 문서 9장). 그래서
 * 라우트가 셋뿐이고, 그중 하나만 본문을 받는다.
 */

import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import type { Pool } from '@prs/db';
import type { HealthResponse } from '@prs/contracts';
import type { ArchiveWriter } from './archive.js';
import { createArchiveWriter, NULL_ARCHIVE_WRITER } from './archive.js';
import type { GatewayConfig } from './config.js';
import { ingestWebhook, type LogEntry, type WebhookOutcome } from './ingest.js';
import { createIngestMetrics, METRICS_CONTENT_TYPE, type IngestMetrics } from './metrics.js';
import { verifyWebhookSignature, SIGNATURE_HEADER } from './signature.js';
import { createRawEventStore, type RawEventStore } from './store.js';

export const SERVICE_NAME = 'ingest-gateway' as const;
export const DEFAULT_PORT = 3001;
export const WEBHOOK_PATH = '/api/v1/webhooks/github';

const VERSION = process.env['npm_package_version'] ?? '0.1.0';
/** 헬스체크의 PostgreSQL 확인이 매달리지 않게 하는 상한. */
const HEALTH_PROBE_MS = 2_000;

export interface ServerDeps {
  readonly config: GatewayConfig;
  readonly store: RawEventStore;
  /** PostgreSQL 연결 확인 (인프라 3장: 게이트웨이 헬스체크는 PG 연결을 본다). */
  readonly checkDatabase: () => Promise<void>;
  readonly archive: ArchiveWriter;
  readonly metrics: IngestMetrics;
  readonly now?: () => Date;
  readonly log?: (entry: LogEntry) => void;
}

/** 구조화 로그 (관측성 3.1). 토큰·시크릿·본문은 절대 싣지 않는다 (NFR-005). */
function defaultLog(entry: LogEntry): void {
  process.stdout.write(`${JSON.stringify({ service: SERVICE_NAME, ...entry })}\n`);
}

/** 실행 중인 풀에서 서버 의존성을 만든다. */
export function createServerDeps(pool: Pool, config: GatewayConfig): ServerDeps {
  return {
    config,
    store: createRawEventStore(pool),
    checkDatabase: async (): Promise<void> => {
      await pool.query('SELECT 1');
    },
    archive: config.archivePath === null ? NULL_ARCHIVE_WRITER : createArchiveWriter(config.archivePath),
    metrics: createIngestMetrics(),
  };
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('health probe timed out'));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

interface TimedRequest extends FastifyRequest {
  ingestStartedAt?: bigint;
}

export function buildServer(deps: ServerDeps): FastifyInstance {
  const log = deps.log ?? defaultLog;
  const now = deps.now ?? ((): Date => new Date());
  const app = Fastify({ logger: false, bodyLimit: deps.config.maxBodyBytes });

  /**
   * 본문은 바이트 그대로 받는다.
   *
   * Fastify 기본 JSON 파서를 그대로 두면 라우트 핸들러가 돌기 전에 파싱이
   * 끝나 버린다. 그러면 서명 검증이 파싱보다 늦어져 보안 문서 9장을 어긴다.
   * 파싱은 `ingestWebhook`이 검증을 통과시킨 뒤에 한다.
   */
  const passThrough = (
    _request: FastifyRequest,
    body: Buffer,
    done: (error: Error | null, body?: Buffer) => void,
  ): void => {
    done(null, body);
  };
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, passThrough);
  // GHE 설정이 어긋나 다른 Content-Type으로 와도 바이트는 받아 두고 서명으로
  // 판별한다. 415로 끊으면 서명 검증 이전에 요청을 분류하는 셈이 된다.
  app.addContentTypeParser('*', { parseAs: 'buffer' }, passThrough);

  app.addHook('onRequest', async (request: TimedRequest): Promise<void> => {
    request.ingestStartedAt = process.hrtime.bigint();
  });

  app.addHook('onResponse', async (request: TimedRequest, reply: FastifyReply): Promise<void> => {
    const startedAt = request.ingestStartedAt;
    if (startedAt === undefined || request.url !== WEBHOOK_PATH) return;
    const seconds = Number(process.hrtime.bigint() - startedAt) / 1e9;
    deps.metrics.responseSeconds.observe(seconds, { status: String(reply.statusCode) });
  });

  /**
   * 오류 응답은 내부 정보를 담지 않는다 (보안 문서 9장). 허용 코드는
   * 401·413·500뿐이므로 그 밖의 오류도 500으로 접는다.
   */
  app.setErrorHandler((error: unknown, request, reply) => {
    const correlationId = randomUUID();
    const detail = (error ?? {}) as { statusCode?: number; code?: string };
    const tooLarge = detail.statusCode === 413 || detail.code === 'FST_ERR_CTP_BODY_TOO_LARGE';
    const status = tooLarge ? 413 : 500;
    const reason = tooLarge ? 'payload_too_large' : 'unhandled_error';

    if (request.url === WEBHOOK_PATH) {
      deps.metrics.rejected.inc({ reason });
    }
    log({
      level: 'error',
      message: 'request failed',
      correlation_id: correlationId,
      reason,
    });
    void reply.status(status).send({ accepted: false, correlation_id: correlationId });
  });

  /** 인프라 3장의 헬스체크. WP-004부터 PostgreSQL 연결까지 확인한다. */
  app.get('/healthz', async (_request, reply): Promise<HealthResponse | { status: string }> => {
    try {
      await withTimeout(deps.checkDatabase(), HEALTH_PROBE_MS);
    } catch {
      // 이유는 본문에 싣지 않는다. 공개 엔드포인트이기 때문이다.
      return reply.status(503).send({ status: 'error', service: SERVICE_NAME, version: VERSION });
    }
    return { status: 'ok', service: SERVICE_NAME, version: VERSION };
  });

  /** 수신 지표 노출 (QA-A001-01). 스크레이프·집계 배선은 WP-010이 맡는다. */
  app.get('/metrics', async (_request, reply): Promise<string> => {
    return reply.type(METRICS_CONTENT_TYPE).send(deps.metrics.render());
  });

  app.post(WEBHOOK_PATH, async (request, reply): Promise<WebhookOutcome['body']> => {
    const body = request.body;
    const outcome = await ingestWebhook(
      {
        verifySignature: (rawBody, signature) =>
          verifyWebhookSignature(rawBody, signature, deps.config.webhookSecrets),
        parsePayload: (rawBody) => JSON.parse(rawBody.toString('utf8')) as unknown,
        store: deps.store,
        archive: deps.archive,
        metrics: deps.metrics,
        maxBodyBytes: deps.config.maxBodyBytes,
        now,
        newCorrelationId: randomUUID,
        log,
      },
      {
        rawBody: Buffer.isBuffer(body) ? body : undefined,
        signature: request.headers[SIGNATURE_HEADER] as string | undefined,
        eventType: request.headers['x-github-event'] as string | undefined,
        deliveryId: request.headers['x-github-delivery'] as string | undefined,
      },
    );

    return reply.status(outcome.status).send(outcome.body);
  });

  return app;
}
