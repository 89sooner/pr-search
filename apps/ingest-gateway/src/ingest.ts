/**
 * 웹훅 수신 처리의 핵심 (FR-ING-001, FR-ING-002, FR-ING-003).
 *
 * **순서가 곧 보장이다** (백엔드 아키텍처 4.1, 보안 문서 9장).
 *
 *   1. 원문 바이트로 서명 검증 — 실패하면 저장하지 않고 401
 *   2. 크기 상한 확인 — 초과하면 413
 *   3. JSON 파싱 (여기서 처음으로 파서가 입력을 본다)
 *   4. durable 저장 — 실패하면 500, GHE가 다시 보낸다
 *   5. 큐 enqueue (레인 A) — 실패해도 202를 막지 않는다. 아웃박스가 받는다
 *   6. NDJSON 아카이브 append (레인 B, 실패해도 202를 막지 않는다)
 *   7. 202
 *
 * 이 순서를 지키려고 의존성을 전부 주입받는다. Fastify에 묶어 두면 "파싱보다
 * 서명 검증이 먼저인가"를 테스트로 증명할 수 없다.
 */

import { extractPushTarget, type PushTarget } from '@prs/domain';
import type { RawEventInsert } from '@prs/db';
import { extractInvalidationTarget, isEmptyTarget, type InvalidationTarget } from '@prs/authz';
import type { ArchiveWriter } from './archive.js';
import { eventTypeLabel, isSupportedEventType } from './events.js';
import type { IngestMetrics } from './metrics.js';
import { canonicalHash, extractAction, extractRepositoryId, resolveDeliveryId } from './payload.js';
import type { RawEventStore } from './store.js';

export interface WebhookRequest {
  readonly rawBody: Buffer | undefined;
  readonly signature: string | undefined;
  readonly eventType: string | undefined;
  readonly deliveryId: string | undefined;
}

/** API-ING-001이 정의한 202 본문. */
export interface WebhookAccepted {
  readonly accepted: true;
  readonly delivery_id: string;
  readonly duplicate: boolean;
}

/**
 * 오류 본문.
 *
 * 내부 정보를 담지 않는다 (보안 문서 9장: "오류 응답은 내부 정보를 노출하지
 * 않는다"). 상관 ID만 넘겨 운영자가 로그와 맞춰 볼 수 있게 한다.
 */
export interface WebhookRejected {
  readonly accepted: false;
  readonly correlation_id: string;
}

export interface WebhookOutcome {
  readonly status: 202 | 401 | 413 | 500;
  readonly body: WebhookAccepted | WebhookRejected;
}

export interface LogEntry {
  readonly level: 'info' | 'warn' | 'error';
  readonly message: string;
  readonly correlation_id: string;
  readonly delivery_id?: string;
  readonly event_type?: string;
  readonly repository_id?: number | null;
  readonly supported?: boolean;
  readonly duplicate?: boolean;
  readonly reason?: string;
}

export interface IngestDeps {
  /** 원문 바이트에 대한 HMAC-SHA256 상수 시간 검증. */
  readonly verifySignature: (rawBody: Buffer, signature: string | undefined) => boolean;
  /** JSON 파싱. 검증 이후에만 불린다. */
  readonly parsePayload: (rawBody: Buffer) => unknown;
  readonly store: RawEventStore;
  /**
   * 큐 enqueue (JOB-ING-001).
   *
   * 실패해도 202를 막지 않는다 — 저장이 끝났고 `queued_at`이 찍혀 있으므로
   * `JOB-ING-007`이 재적재한다 (ADR-002 follow-up).
   */
  readonly enqueue: (event: RawEventInsert) => Promise<void>;
  /**
   * 권한 캐시 무효화 발행 (EVT-AUTH-001, CR-015 DEV-042).
   *
   * `member`/`team`/`repository` 이벤트만 대상이다. **여기서 팀을 구성원으로
   * 펼치지 않는다** — GHE 동기 호출이 수신 경로에 들어가면 NFR-002의 수신
   * p95 300ms가 그대로 무너진다. 펼치기는 authz 소비자가 한다.
   */
  readonly publishPermissionInvalidation: (
    target: InvalidationTarget,
    correlationId: string,
  ) => Promise<void>;
  /**
   * 채번 요청 발행 (JOB-SEQ-001의 트리거, CR-025 DEV-116).
   *
   * 잡 카탈로그가 JOB-SEQ-001의 트리거를 "push 이벤트"라 적지만 **그 이벤트를
   * `prs:sequence`에 싣는 코드가 없었다** — push는 `prs:ingest`로 가고 보강이
   * "PR 이벤트가 아니다"로 버린다. 여기서 싣는다.
   *
   * **레지스트리를 조회하지 않는다.** 어느 브랜치가 채번 대상인지
   * (`repository.sequence_branches`)는 채번 워커가 판단한다 — 그 조회를 여기
   * 두면 수신 응답 예산(NFR-002 p95 300ms)에 왕복 하나가 더해지고, 수신
   * 경로에 새 실패 지점이 생긴다.
   */
  readonly publishSequenceRequest: (target: PushTarget, correlationId: string) => Promise<void>;
  readonly archive: ArchiveWriter;
  readonly metrics: IngestMetrics;
  readonly maxBodyBytes: number;
  readonly now: () => Date;
  readonly newCorrelationId: () => string;
  readonly log: (entry: LogEntry) => void;
}

function reject(
  deps: IngestDeps,
  status: 401 | 413 | 500,
  reason: string,
  correlationId: string,
  eventType: string | undefined,
): WebhookOutcome {
  deps.metrics.rejected.inc({ reason });
  deps.log({
    level: status === 500 ? 'error' : 'warn',
    message: 'webhook rejected',
    correlation_id: correlationId,
    reason,
    ...(eventType === undefined ? {} : { event_type: eventType }),
  });
  return { status, body: { accepted: false, correlation_id: correlationId } };
}

export async function ingestWebhook(deps: IngestDeps, request: WebhookRequest): Promise<WebhookOutcome> {
  const correlationId = deps.newCorrelationId();
  const rawBody = request.rawBody;

  // 본문 없음도 401이다 (API-ING-001). 서명만으로 판별할 대상이 없다.
  if (rawBody === undefined || rawBody.length === 0) {
    return reject(deps, 401, 'missing_body', correlationId, request.eventType);
  }

  // 1. 서명 검증. 파싱보다 먼저다.
  if (!deps.verifySignature(rawBody, request.signature)) {
    return reject(deps, 401, 'invalid_signature', correlationId, request.eventType);
  }

  // 2. 크기 상한. 앞단(Fastify bodyLimit)이 본문을 다 읽기 전에 끊지만,
  //    주입된 상한이 다를 수 있으므로 여기서도 확인한다.
  if (rawBody.length > deps.maxBodyBytes) {
    return reject(deps, 413, 'payload_too_large', correlationId, request.eventType);
  }

  // 3. 파싱.
  let payload: unknown;
  try {
    payload = deps.parsePayload(rawBody);
  } catch {
    // 서명이 맞는데 JSON이 깨졌다면 GHE와 우리 사이에서 본문이 상한 것이다.
    // `payload`는 JSONB NOT NULL이라 저장할 수 없다. 허용된 상태 코드는
    // 401/413/500뿐이므로(API-ING-001) 500으로 알리고 재전송을 받는다.
    return reject(deps, 500, 'malformed_payload', correlationId, request.eventType);
  }

  const eventType = request.eventType ?? 'unknown';
  const payloadHash = canonicalHash(payload);
  const deliveryId = resolveDeliveryId(request.deliveryId, payloadHash);
  const receivedAt = deps.now();
  const repositoryId = extractRepositoryId(payload);
  const supported = isSupportedEventType(eventType);

  const event: RawEventInsert = {
    delivery_id: deliveryId,
    event_type: eventType,
    action: extractAction(payload),
    repository_id: repositoryId,
    received_at: receivedAt,
    payload,
    payload_hash: payloadHash,
    correlation_id: correlationId,
    // 아웃박스 표식. "큐에 넣었다"가 아니라 "큐로 보낼 대상이다"라는 뜻이라
    // 발행 성공 여부와 무관하게 저장 시점에 찍는다 (ADR-002 follow-up).
    queued_at: receivedAt,
  };

  // 4. durable 저장.
  let duplicate: boolean;
  try {
    ({ duplicate } = await deps.store(event));
  } catch {
    return reject(deps, 500, 'store_failed', correlationId, eventType);
  }

  deps.metrics.received.inc({ event_type: eventTypeLabel(request.eventType), supported: String(supported) });
  if (duplicate) {
    deps.metrics.duplicate.inc();
    deps.log({
      level: 'info',
      message: 'webhook duplicate',
      correlation_id: correlationId,
      delivery_id: deliveryId,
      event_type: eventType,
      repository_id: repositoryId,
      supported,
      duplicate: true,
    });
    return { status: 202, body: { accepted: true, delivery_id: deliveryId, duplicate: true } };
  }

  // 5. 큐 enqueue. 실패는 아웃박스가 받는다.
  try {
    await deps.enqueue(event);
  } catch {
    deps.metrics.enqueueFailed.inc();
    deps.log({
      level: 'error',
      message: 'enqueue failed — 아웃박스가 재적재한다',
      correlation_id: correlationId,
      delivery_id: deliveryId,
      event_type: eventType,
      reason: 'enqueue_failed',
    });
  }

  // 5b. 권한 캐시 무효화 (EVT-AUTH-001). 실패해도 202를 막지 않는다 —
  //     TTL 5분이 최후의 안전망이라 유실이 곧 영구 우회는 아니다. 다만
  //     그 5분 동안 회수가 반영되지 않으므로 오류로 남긴다.
  const invalidation = extractInvalidationTarget(eventType, payload);
  if (invalidation !== null && !isEmptyTarget(invalidation)) {
    try {
      await deps.publishPermissionInvalidation(invalidation, correlationId);
    } catch {
      deps.metrics.permissionPublishFailed.inc();
      deps.log({
        level: 'error',
        message: 'permission.invalidated 발행 실패 — 최대 5분간 회수가 반영되지 않는다',
        correlation_id: correlationId,
        delivery_id: deliveryId,
        event_type: eventType,
        reason: 'permission_publish_failed',
      });
    }
  }

  // 5c. 채번 요청 (JOB-SEQ-001, CR-025 DEV-116). 실패해도 202를 막지 않는다 —
  //     시퀀스는 증분이라 이번 push를 놓쳐도 다음 push나 6시간 보정이
  //     `<저장 head>..<현재 head>`를 통째로 메운다. 유실이 곧 구멍이 아니다.
  if (eventType === 'push') {
    const pushOutcome = extractPushTarget(payload);
    if (pushOutcome.kind === 'target') {
      try {
        await deps.publishSequenceRequest(pushOutcome.target, correlationId);
      } catch {
        deps.metrics.sequencePublishFailed.inc();
        deps.log({
          level: 'error',
          message: '채번 요청 발행 실패 — 다음 push나 보정 주기가 메운다',
          correlation_id: correlationId,
          delivery_id: deliveryId,
          event_type: eventType,
          reason: 'sequence_publish_failed',
        });
      }
    }
  }

  // 6. 아카이브. 레인 B 실패는 레인 A를 막지 않는다.
  try {
    await deps.archive.append({
      delivery_id: deliveryId,
      event_type: eventType,
      action: event.action,
      repository_id: repositoryId,
      received_at: receivedAt.toISOString(),
      correlation_id: correlationId,
      payload,
    });
  } catch {
    deps.metrics.archiveFailed.inc();
    deps.log({
      level: 'error',
      message: 'archive append failed',
      correlation_id: correlationId,
      delivery_id: deliveryId,
      event_type: eventType,
      reason: 'archive_append_failed',
    });
  }

  deps.log({
    level: 'info',
    message: 'webhook accepted',
    correlation_id: correlationId,
    delivery_id: deliveryId,
    event_type: eventType,
    repository_id: repositoryId,
    supported,
    duplicate: false,
  });

  return { status: 202, body: { accepted: true, delivery_id: deliveryId, duplicate: false } };
}
