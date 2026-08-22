/**
 * JOB-ING-003 투영 워커 (WP-008, FR-ING-005).
 *
 * `prs:enriched`를 소비해 정규화 문서를 Elasticsearch에 업서트하고 `EVT-ING-003`을
 * 낸다. 수집 파이프라인의 마지막 단계이자, 웹훅이 검색 결과가 되는 지점이다.
 *
 * 지켜야 할 것 다섯:
 *
 * 1. **오래된 이벤트가 새 상태를 덮지 않는다.** 문서 버전은 웹훅 **수신 시각**이고
 *    비교는 Elasticsearch 스크립트가 한다 (AC-1). 보강 시각을 쓰면 순서가 바뀐 두
 *    웹훅 중 늦게 보강된 쪽이 이긴다.
 * 2. **여러 인덱스를 벌크 1건으로 보낸다** (AC-2). 문서 수만큼 왕복하면 수집
 *    지연이 문서 수에 비례한다.
 * 3. **부분 실패는 항목별로 다시 보낸다** (AC-3). 벌크 전체를 되돌리면 이미
 *    성공한 항목까지 다시 가고, 무엇이 실패했는지가 지표에서 사라진다.
 * 4. **매핑 거부는 재시도하지 않는다** (THR-010). 다시 보내도 같으므로 곧장 실패
 *    대기열로 간다 — 재시도하면 같은 이벤트가 다섯 번 거부되는 동안 파티션이 막힌다.
 * 5. **미등록 저장소는 투영하지 않는다** (FR-ING-009 AC-4, CR-011 DEV-020).
 *    접근 범위 필드를 얻을 곳이 없어 검색되지 않는 문서만 남는다. 실패가 아니므로
 *    실패 대기열로도 보내지 않는다.
 *
 * `raw_event.processed_at`은 **여기서** 찍는다. 그 표식의 뜻이 "문서가 색인됐다"이고
 * 그 사실을 아는 것은 이 워커뿐이다 (WP-007이 찍지 않고 남겨 둔 이유다).
 */

import {
  EVENT_NAMES,
  deterministicEventId,
  ingestPartitionKey,
  type IngestionEnriched,
  type IngestionProjected,
  type ProjectedEntityKind,
} from '@prs/domain';
import {
  MAX_RETRIES,
  TOPICS,
  consumerGroup,
  deadLetter,
  type DeliveredEvent,
  type EventBus,
  type EventHandler,
  type HandlerDisposition,
  type SubscribeOptions,
  type Subscription,
} from '@prs/bus';
import { deadLetterRepo, rawEventRepo, repositoryRepo, type Pool, type RawEventRow } from '@prs/db';
import { bulkUpsert, classifyFailure, type BulkItemOutcome, type UpsertRequest } from '@prs/es';
import type { Client } from '@elastic/elasticsearch';
import { buildUpsertRequests } from './documents.js';
import { parseEnriched } from './enriched-payload.js';
import { defaultSleep, retryFailedItems } from './index-retry.js';
import type { WorkerMetrics } from './metrics.js';

/** 실패 대기열·지표에서 이 단계를 가리키는 이름. */
export const PROJECT_STAGE = 'project' as const;

export interface ProjectLogEntry {
  readonly level: 'info' | 'warn' | 'error';
  readonly message: string;
  readonly delivery_id?: string;
  readonly correlation_id?: string;
  readonly repository_id?: number;
  readonly pr_number?: number;
  readonly documents?: number;
  readonly reason?: string;
  readonly retry_count?: number;
  readonly lag_seconds?: number;
}

export interface ProjectDeps {
  readonly pool: Pool;
  readonly bus: EventBus;
  readonly es: Client;
  readonly metrics: WorkerMetrics;
  readonly log?: (entry: ProjectLogEntry) => void;
  readonly now?: () => Date;
  /** 항목 재시도 사이 대기. 시험이 실제로 기다리지 않게 하려고 뚫어 둔다. */
  readonly sleep?: (ms: number) => Promise<void>;
}

export interface ProjectOutcome {
  readonly disposition: HandlerDisposition;
  /** 발행한 EVT-ING-003. 발행하지 않았으면 빈 배열. */
  readonly projected: readonly IngestionProjected[];
  readonly reason?: string;
}

function entityKindOf(request: UpsertRequest): ProjectedEntityKind {
  return request.alias === 'prs-commits' ? 'commit' : 'pull_request';
}

/**
 * 한 이벤트를 처리한다.
 *
 * 처분만 돌려주고 ack·재전달은 버스가 한다 (CR-010의 처분 계약).
 */
export async function handleEnrichedEvent(
  deps: ProjectDeps,
  event: DeliveredEvent,
): Promise<ProjectOutcome> {
  const log = deps.log ?? ((): void => undefined);
  const now = deps.now ?? ((): Date => new Date());
  const startedAt = Date.now();
  const retriesUsed = Math.max(0, event.delivery_count - 1);

  const observe = (outcome: string): void => {
    deps.metrics.stageSeconds.observe((Date.now() - startedAt) / 1_000, {
      stage: PROJECT_STAGE,
      outcome,
    });
  };

  const parsed = parseEnriched(event.payload);
  if (parsed.kind === 'invalid') {
    // 실패 대기열은 `delivery_id`로 색인된다. payload가 깨져 그것조차 못 읽으면
    // 기록할 자리가 없다. 파티션을 영영 막지 않도록 로그만 남기고 ack한다.
    log({ level: 'error', message: 'EVT-ING-002 계약 위반', reason: parsed.reason });
    observe('malformed');
    return { disposition: { kind: 'ack' }, projected: [], reason: parsed.reason };
  }

  const enriched = parsed.enriched;
  const deliveryId = enriched.delivery_id;

  const fail = async (reason: string, detail: string): Promise<ProjectOutcome> => {
    await deadLetterRepo.recordDeadLetter(deps.pool, {
      deliveryId,
      stage: PROJECT_STAGE,
      repositoryId: enriched.repository_id,
      error: detail,
      retryCount: retriesUsed,
    });
    deps.metrics.deadLettered.inc({ stage: PROJECT_STAGE, reason });
    log({
      level: 'error',
      message: '실패 대기열로 보냈다',
      delivery_id: deliveryId,
      correlation_id: enriched.correlation_id,
      repository_id: enriched.repository_id,
      pr_number: enriched.pr_number,
      reason,
      retry_count: retriesUsed,
    });
    observe('dead_letter');
    return { disposition: deadLetter(detail), projected: [], reason };
  };

  const row = await rawEventRepo.findRawEventByDeliveryId(deps.pool, deliveryId);
  if (row === undefined) {
    // 문서 버전의 출처이자 `processed_at`을 찍을 행이다. 없으면 투영할 수 없다.
    if (retriesUsed < MAX_RETRIES) {
      observe('retry');
      return {
        disposition: { kind: 'retry', reason: 'raw_event_missing' },
        projected: [],
        reason: 'raw_event_missing',
      };
    }
    return fail('raw_event_missing', `원본 이벤트를 찾을 수 없다: ${deliveryId}`);
  }

  const repository = await repositoryRepo.findRepositoryById(deps.pool, enriched.repository_id);
  if (repository === undefined) {
    // FR-ING-009 AC-4. 원본은 `raw_event`에 남아 있어 등록 후 백필로 채울 수 있다.
    log({
      level: 'info',
      message: '미등록 저장소라 투영하지 않는다',
      delivery_id: deliveryId,
      correlation_id: enriched.correlation_id,
      repository_id: enriched.repository_id,
      reason: 'repository_unregistered',
    });
    observe('skipped');
    return { disposition: { kind: 'ack' }, projected: [], reason: 'repository_unregistered' };
  }

  return projectDocuments(deps, enriched, row, repository, {
    deliveryId,
    retriesUsed,
    observe,
    fail,
    log,
    now,
  });
}

interface ProjectContext {
  readonly deliveryId: string;
  readonly retriesUsed: number;
  readonly observe: (outcome: string) => void;
  readonly fail: (reason: string, detail: string) => Promise<ProjectOutcome>;
  readonly log: (entry: ProjectLogEntry) => void;
  readonly now: () => Date;
}

async function projectDocuments(
  deps: ProjectDeps,
  enriched: IngestionEnriched,
  row: RawEventRow,
  repository: Awaited<ReturnType<typeof repositoryRepo.findRepositoryById>> & object,
  context: ProjectContext,
): Promise<ProjectOutcome> {
  const indexedAt = context.now();
  const requests = buildUpsertRequests({
    enriched,
    repository,
    // AC-1. 웹훅 수신 시각이 사실의 순서다.
    documentVersion: row.received_at.getTime(),
    indexedAt,
  });

  let outcomes: readonly BulkItemOutcome[];
  try {
    outcomes = (await bulkUpsert(deps.es, requests)).outcomes;
  } catch (error) {
    // 벌크 자체가 실패했다 — 연결 끊김이거나 클러스터가 요청을 받지 못했다.
    const shape = error as { statusCode?: number; body?: { error?: { type?: string; reason?: string } } };
    const status = shape.statusCode ?? 0;
    const detail = `벌크 요청 실패: ${String(status)} ${shape.body?.error?.type ?? String(error)}`;
    if (classifyFailure(status, shape.body?.error) === 'rejected') {
      return context.fail('bulk_rejected', detail);
    }
    if (context.retriesUsed < MAX_RETRIES) {
      context.observe('retry');
      return { disposition: { kind: 'retry', reason: 'bulk_unavailable' }, projected: [], reason: detail };
    }
    return context.fail('bulk_unavailable', detail);
  }

  outcomes = await retryFailedItems(deps.es, outcomes, deps.sleep ?? defaultSleep);

  const rejected = outcomes.filter((outcome) => outcome.kind === 'rejected');
  if (rejected.length > 0) {
    // THR-010. 매핑에 없는 필드가 흘러들었거나 문서가 파싱되지 않았다.
    const detail = rejected
      .map((outcome) => `${outcome.request.alias}/${outcome.request.id}: ${outcome.reason}`)
      .join('; ');
    return context.fail('index_rejected', detail);
  }

  const retryable = outcomes.filter((outcome) => outcome.kind === 'retryable');
  if (retryable.length > 0) {
    const detail = retryable
      .map((outcome) => `${outcome.request.alias}/${outcome.request.id}: ${outcome.reason}`)
      .join('; ');
    if (context.retriesUsed < MAX_RETRIES) {
      context.log({
        level: 'warn',
        message: '색인 일부가 실패해 표준 백오프로 재시도한다',
        delivery_id: context.deliveryId,
        correlation_id: enriched.correlation_id,
        repository_id: enriched.repository_id,
        pr_number: enriched.pr_number,
        reason: detail,
        retry_count: context.retriesUsed,
      });
      context.observe('retry');
      return { disposition: { kind: 'retry', reason: 'index_unavailable' }, projected: [], reason: detail };
    }
    return context.fail('index_unavailable', detail);
  }

  // 전부 색인됐다. 이제서야 원본에 처리 표식을 찍는다 — 순서가 반대면 색인이
  // 실패해도 아웃박스 재적재(JOB-ING-007)가 그 이벤트를 다시 집지 않는다.
  await rawEventRepo.markProcessed(deps.pool, context.deliveryId, row.received_at);

  // 이 전달이 끝까지 갔다. 실패 대기열에 열린 행이 있으면 여기서 닫는다
  // (CR-012, DEV-023). 재투입은 비동기라 재처리 API는 성공을 알 수 없고,
  // "끝까지 갔다"를 아는 자리는 여기 하나뿐이다. 대개 0건이며 그때는 유일
  // 제약의 인덱스 탐색 한 번으로 끝난다.
  const resolved = await deadLetterRepo.resolveByDelivery(deps.pool, context.deliveryId);
  if (resolved > 0) {
    deps.metrics.deadLetterResolved.inc({ stage: PROJECT_STAGE }, resolved);
    context.log({
      level: 'info',
      message: '실패 대기열 항목을 닫았다',
      delivery_id: context.deliveryId,
      correlation_id: enriched.correlation_id,
      repository_id: enriched.repository_id,
      reason: 'reprocess_succeeded',
    });
  }

  const lagSeconds = (indexedAt.getTime() - row.received_at.getTime()) / 1_000;
  deps.metrics.ingestionLagSeconds.observe(lagSeconds);

  const projected = await publishProjected(deps, enriched, row, outcomes);

  context.log({
    level: 'info',
    message: '투영 완료',
    delivery_id: context.deliveryId,
    correlation_id: enriched.correlation_id,
    repository_id: enriched.repository_id,
    pr_number: enriched.pr_number,
    documents: outcomes.length,
    lag_seconds: lagSeconds,
  });
  context.observe('ok');
  return { disposition: { kind: 'ack' }, projected };
}

/**
 * 색인된 문서마다 `EVT-ING-003`을 낸다.
 *
 * `noop`은 내지 않는다 — 버전이 낮아 아무것도 바뀌지 않았다는 뜻이고, 그것으로
 * 관계 워커를 깨우면 같은 일을 다시 하게 된다.
 */
async function publishProjected(
  deps: ProjectDeps,
  enriched: IngestionEnriched,
  row: RawEventRow,
  outcomes: readonly BulkItemOutcome[],
): Promise<readonly IngestionProjected[]> {
  const now = deps.now ?? ((): Date => new Date());
  const published: IngestionProjected[] = [];

  for (const outcome of outcomes) {
    if (outcome.kind !== 'ok' || outcome.result === 'noop') continue;
    const request = outcome.request;
    const payload: IngestionProjected = {
      repository_id: enriched.repository_id,
      entity_kind: entityKindOf(request),
      entity_id: request.id,
      document_version: request.doc.document_version,
      correlation_id: enriched.correlation_id,
    };
    await deps.bus.publish(
      TOPICS.projected,
      ingestPartitionKey(enriched.repository_id, enriched.delivery_id),
      {
        // 같은 전달의 같은 문서를 다시 투영하면 같은 ID가 나온다.
        event_id: deterministicEventId(EVENT_NAMES.ingestionProjected, enriched.delivery_id, request.id),
        event_name: EVENT_NAMES.ingestionProjected,
        correlation_id: row.correlation_id,
        occurred_at: now().toISOString(),
        payload,
      },
    );
    published.push(payload);
  }

  return published;
}

/** 투영 핸들러. 처분만 돌려주고 ack·재전달은 버스가 한다. */
export function createProjectHandler(deps: ProjectDeps): EventHandler {
  return async (event) => {
    const outcome = await handleEnrichedEvent(deps, event);
    return outcome.disposition;
  };
}

/** `prs:enriched`의 `project` 그룹을 구독한다. 그룹 이름은 카탈로그가 정본이다. */
export async function startProjectWorker(
  deps: ProjectDeps,
  options: SubscribeOptions = {},
): Promise<Subscription> {
  return deps.bus.subscribe(
    TOPICS.enriched,
    consumerGroup(TOPICS.enriched),
    createProjectHandler(deps),
    options,
  );
}
