/**
 * ingest-gateway — GHE 웹훅 수신 게이트웨이 (ADR-002 레인 A 입구).
 *
 * 이 앱은 시스템에서 유일한 공개 인바운드 지점이다 (보안 문서 9장). 그래서
 * 라우트가 셋뿐이고, 그중 하나만 본문을 받는다.
 */

import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import type { Pool, RawEventInsert } from '@prs/db';
import { TOPICS, type EventBus } from '@prs/bus';
import {
  EVENT_NAMES,
  deterministicEventId,
  ingestPartitionKey,
  sequencePartitionKey,
  type PushTarget,
  type ReleaseRefreshRequested,
  type ReleaseSignal,
  type SequenceRequested,
} from '@prs/domain';
import { toEventPayload, type InvalidationTarget } from '@prs/authz';
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
  readonly enqueue: (event: RawEventInsert) => Promise<void>;
  /** 권한 캐시 무효화 발행 (EVT-AUTH-001, CR-015 DEV-042). */
  readonly publishPermissionInvalidation: (
    target: InvalidationTarget,
    correlationId: string,
  ) => Promise<void>;
  /** 채번 요청 발행 (JOB-SEQ-001 트리거, CR-025 DEV-116). */
  readonly publishSequenceRequest: (target: PushTarget, correlationId: string) => Promise<void>;
  readonly publishReleaseRequest: (signal: ReleaseSignal, correlationId: string) => Promise<void>;
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

/**
 * 큐 발행자 (JOB-ING-001, EVT-ING-001).
 *
 * 마감 시간을 둔다. Redis가 응답하지 않을 때 발행이 매달리면 수신 응답
 * p95 300ms(NFR-002)가 그대로 무너지기 때문이다. 마감을 넘기면 실패로 보고
 * 넘어가고, 그 행은 `queued_at`이 찍혀 있으므로 `JOB-ING-007`이 재적재한다.
 *
 * 마감 뒤에 발행이 뒤늦게 성공할 수 있다. 그러면 같은 이벤트가 두 번 흐르는데,
 * 소비자의 멱등 기준이 `delivery_id`라 문제가 되지 않는다 (at-least-once).
 */
export function createIngestPublisher(
  bus: EventBus,
  deadlineMs: number,
): (event: RawEventInsert) => Promise<void> {
  return async (event: RawEventInsert): Promise<void> => {
    await withTimeout(
      bus.publish(TOPICS.ingest, ingestPartitionKey(event.repository_id, event.delivery_id), {
        event_id: randomUUID(),
        event_name: EVENT_NAMES.ingestionEventReceived,
        correlation_id: event.correlation_id,
        occurred_at: event.received_at.toISOString(),
        payload: {
          delivery_id: event.delivery_id,
          event_type: event.event_type,
          action: event.action,
          repository_id: event.repository_id,
          correlation_id: event.correlation_id,
          occurred_at: event.received_at.toISOString(),
        },
      }),
      deadlineMs,
    );
  };
}

/**
 * 권한 캐시 무효화 발행자 (EVT-AUTH-001, CR-015 DEV-042).
 *
 * `prs:permission`은 `user_id`로 파티션한다 (비동기 문서 2장). 그런데 이
 * 이벤트는 사용자를 아직 모를 수 있다 — `team`·`repository` 이벤트가 그렇다.
 * 그래서 파티션 키는 **대상 자체**로 잡는다. 같은 팀·같은 저장소의 무효화가
 * 한 파티션에서 직렬로 처리되므로, 연달아 오는 변경이 서로를 앞지르지 않는다.
 *
 * 마감 시간은 enqueue와 같은 값을 쓴다. 이 발행이 매달리면 수신 응답 p95
 * 300ms(NFR-002)가 그대로 무너진다.
 */
export function createPermissionPublisher(
  bus: EventBus,
  deadlineMs: number,
): (target: InvalidationTarget, correlationId: string) => Promise<void> {
  return async (target: InvalidationTarget, correlationId: string): Promise<void> => {
    await withTimeout(
      bus.publish(TOPICS.permission, permissionPartitionKey(target), {
        event_id: randomUUID(),
        event_name: EVENT_NAMES.permissionInvalidated,
        correlation_id: correlationId,
        occurred_at: new Date().toISOString(),
        payload: { ...toEventPayload(target), org: target.org, team_slug: target.teamSlug, org_id: target.orgId },
      }),
      deadlineMs,
    );
  };
}

/**
 * 릴리스 갱신 신호 발행자 (JOB-REL-007의 트리거, CR-028 DEV-144·145).
 *
 * `event_id`가 (저장소, 상관 ID)로 결정론적이다 — 같은 웹훅의 재전송이 같은
 * 신호가 된다. 태그 이름·SHA를 싣지 않는 이유는 EVT-REL-001에 있다: 갱신은
 * 항상 미러 스냅숏과의 전량 diff이므로 신호에 필요한 것은 저장소뿐이고,
 * payload의 태그를 신뢰하면 이벤트 순서 역전이 스냅숏을 되돌린다.
 */
export function createReleasePublisher(
  bus: EventBus,
  deadlineMs: number,
): (signal: ReleaseSignal, correlationId: string) => Promise<void> {
  return async (signal: ReleaseSignal, correlationId: string): Promise<void> => {
    const payload: ReleaseRefreshRequested = {
      repository_id: signal.repositoryId,
      correlation_id: correlationId,
    };
    await withTimeout(
      bus.publish(TOPICS.release, String(signal.repositoryId), {
        event_id: deterministicEventId('release.refresh_requested', String(signal.repositoryId), correlationId),
        event_name: 'release.refresh_requested',
        correlation_id: correlationId,
        occurred_at: new Date().toISOString(),
        payload,
      }),
      deadlineMs,
    );
  };
}

/**
 * 채번 요청 발행자 (JOB-SEQ-001의 트리거, CR-025 DEV-116).
 *
 * 파티션 키가 `repository_id:base_branch`인 이유는 **같은 시퀀스 공간의 채번이
 * 직렬화되어야** 하기 때문이다 (비동기 문서 2장). advisory lock이 이중
 * 안전장치지만, 파티션이 먼저 줄을 세우면 락 경합 자체가 줄어든다.
 *
 * `event_id`를 `(저장소, 브랜치, head)`에서 결정론적으로 만든다. 같은 push가
 * 두 번 도착해도 같은 ID가 나오므로 소비자가 중복을 알아볼 수 있다 — 채번은
 * 어차피 멱등이지만, 중복이 지표에서 새 일감으로 보이지 않게 한다.
 */
export function createSequencePublisher(
  bus: EventBus,
  deadlineMs: number,
): (target: PushTarget, correlationId: string) => Promise<void> {
  return async (target: PushTarget, correlationId: string): Promise<void> => {
    const payload: SequenceRequested = {
      repository_id: target.repositoryId,
      base_branch: target.baseBranch,
      head_sha: target.headSha,
      correlation_id: correlationId,
    };
    await withTimeout(
      bus.publish(TOPICS.sequence, sequencePartitionKey(target.repositoryId, target.baseBranch), {
        event_id: deterministicEventId(
          'sequence.requested',
          String(target.repositoryId),
          target.baseBranch,
          target.headSha,
        ),
        event_name: 'sequence.requested',
        correlation_id: correlationId,
        occurred_at: new Date().toISOString(),
        payload,
      }),
      deadlineMs,
    );
  };
}

/** 대상별 파티션 키. 같은 대상의 무효화가 서로를 앞지르지 않게 한다. */
function permissionPartitionKey(target: InvalidationTarget): string {
  if (target.teamId !== null) return `team:${String(target.teamId)}`;
  if (target.githubUserIds.length > 0) return `user:${String(target.githubUserIds[0])}`;
  if (target.repositoryId !== null) return `repo:${String(target.repositoryId)}`;
  return `login:${target.logins[0] ?? 'unknown'}`;
}

/** 실행 중인 풀과 버스에서 서버 의존성을 만든다. */
export function createServerDeps(pool: Pool, config: GatewayConfig, bus: EventBus): ServerDeps {
  return {
    config,
    store: createRawEventStore(pool),
    enqueue: createIngestPublisher(bus, config.enqueueTimeoutMs),
    publishPermissionInvalidation: createPermissionPublisher(bus, config.enqueueTimeoutMs),
    publishSequenceRequest: createSequencePublisher(bus, config.enqueueTimeoutMs),
    publishReleaseRequest: createReleasePublisher(bus, config.enqueueTimeoutMs),
    checkDatabase: async (): Promise<void> => {
      await pool.query('SELECT 1');
    },
    archive:
      config.archivePath === null
        ? NULL_ARCHIVE_WRITER
        : createArchiveWriter(config.archivePath, config.archiveRotation),
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
    // 버린 조각 수는 쓰기 쪽이 세고 스크레이프 시점에 읽는다 (FR-ING-010 AC-7).
    deps.metrics.archiveSegmentsDropped.set(deps.archive.droppedSegments());
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
        enqueue: deps.enqueue,
        publishPermissionInvalidation: deps.publishPermissionInvalidation,
        publishSequenceRequest: deps.publishSequenceRequest,
        publishReleaseRequest: deps.publishReleaseRequest,
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
