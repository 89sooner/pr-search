/**
 * JOB-ING-002 보강 워커 (WP-007, FR-ING-004).
 *
 * PR 웹훅은 원본 커밋 목록도, 변경 파일도, 리뷰도 주지 않는다. 이 워커가
 * `prs:ingest`를 소비해 GHE에서 그 셋을 채우고 `EVT-ING-002`로 넘긴다.
 *
 * 지켜야 할 것 넷:
 *
 * 1. **rate limit 대기는 실패가 아니다.** 한도 회복 시각까지 `defer`하며
 *    재시도 예산을 소비하지 않는다 (CR-010, DEV-014). 30초마다 재전달되어
 *    회복 전에 5회를 소진하고 실패 대기열로 가는 일이 없어야 한다.
 * 2. **부분 결과는 버리지 않는다.** 일부만 채워졌으면 채워진 만큼을
 *    `enrichment_pending: true`로 넘긴다 (AC-3).
 * 3. **절삭 표식은 추측하지 않는다.** 배열 길이가 250·3000이라고 잘렸다고
 *    적지 않는다. API 클라이언트가 실제로 잘랐다고 말할 때만 세운다 (AC-4).
 * 4. **`raw_event.processed_at`은 건드리지 않는다.** 그 표식은 문서가 색인된
 *    시점을 뜻하고, 색인은 투영 워커(WP-008)의 일이다. 여기서 미리 찍으면
 *    아웃박스 재적재(JOB-ING-007)가 투영되지 않은 이벤트를 다시 집지 않는다.
 */

import {
  EVENT_NAMES,
  deterministicEventId,
  ingestPartitionKey,
  type EnrichedChangedFile,
  type EnrichedPullRequest,
  type EnrichedReview,
  type EnrichmentComponent,
  type EnrichmentError,
  type IngestionEnriched,
} from '@prs/domain';
import {
  MAX_RETRIES,
  TOPICS,
  consumerGroup,
  deadLetter,
  deferUntil,
  type DeliveredEvent,
  type EventBus,
  type EventHandler,
  type HandlerDisposition,
  type SubscribeOptions,
  type Subscription,
} from '@prs/bus';
import { deadLetterRepo, rawEventRepo, type Pool, type RawEventRow } from '@prs/db';
import { GitHubApiError, safeMessage, type GitHubClient } from '@prs/github';
import { extractTarget, type EnrichTarget } from './webhook-target.js';
import type { WorkerMetrics } from './metrics.js';

/** 실패 대기열·지표에서 이 단계를 가리키는 이름. */
export const ENRICH_STAGE = 'enrich' as const;

export interface EnrichLogEntry {
  readonly level: 'info' | 'warn' | 'error';
  readonly message: string;
  readonly delivery_id?: string;
  readonly correlation_id?: string;
  readonly repository_id?: number;
  readonly pr_number?: number;
  readonly reason?: string;
  readonly retry_count?: number;
  readonly retry_at?: string;
}

export interface EnrichDeps {
  readonly pool: Pool;
  readonly bus: EventBus;
  readonly client: GitHubClient;
  /**
   * 조직 → 설치 ID (CR-010, DEV-015).
   *
   * 등록되지 않은 조직은 `undefined`다. 조용히 넘기지 않는다 — 그러면 그
   * 조직의 저장소만 영문 모르게 검색되지 않는 상태가 된다.
   */
  readonly installationFor: (org: string) => number | undefined;
  readonly metrics: WorkerMetrics;
  readonly log?: (entry: EnrichLogEntry) => void;
  readonly now?: () => Date;
}

/** 한 이벤트를 처리한 결과. 시험이 처분과 이유를 함께 보게 하려고 노출한다. */
export interface EnrichOutcome {
  readonly disposition: HandlerDisposition;
  /** 발행한 EVT-ING-002. 발행하지 않았으면 `undefined`. */
  readonly published?: IngestionEnriched;
  readonly reason?: string;
}

interface ComponentFailure {
  readonly error: EnrichmentError;
  readonly retryable: boolean;
  readonly retryAt: Date | undefined;
}

/** 오류를 문자열 grep이 아니라 필드로 분류한다 (비동기 5.2). */
function describeFailure(component: EnrichmentComponent, error: unknown): ComponentFailure {
  if (error instanceof GitHubApiError) {
    return {
      error: { component, kind: error.kind, message: error.message },
      retryable: error.retryable,
      retryAt: error.retryAt,
    };
  }
  // GitHub 계열이 아닌 실패(직렬화, 프로그래밍 오류)는 재시도해도 같다.
  return {
    error: { component, kind: 'unexpected', message: safeMessage(error) },
    retryable: false,
    retryAt: undefined,
  };
}

function isNotFound(error: unknown): boolean {
  return error instanceof GitHubApiError && error.kind === 'not_found';
}

/** 여러 실패 중 가장 이른 회복 시각. 하나라도 있으면 그때까지 미룬다. */
function earliestRetryAt(failures: readonly ComponentFailure[]): Date | undefined {
  let earliest: Date | undefined;
  for (const failure of failures) {
    if (failure.retryAt === undefined) continue;
    if (earliest === undefined || failure.retryAt < earliest) earliest = failure.retryAt;
  }
  return earliest;
}

/**
 * 한 이벤트를 처리한다.
 *
 * 처분을 돌려주기만 하고 ack·재전달은 버스가 한다. 실패 대기열 기록은 여기서
 * **먼저** 하고 `dead_letter` 처분을 돌려준다 — 순서가 반대면 기록이 실패했을
 * 때 이미 ack된 이벤트가 흔적 없이 사라진다.
 */
export async function handleIngestEvent(
  deps: EnrichDeps,
  event: DeliveredEvent,
): Promise<EnrichOutcome> {
  const log = deps.log ?? ((): void => undefined);
  const startedAt = Date.now();
  const retriesUsed = Math.max(0, event.delivery_count - 1);

  const observe = (outcome: string): void => {
    deps.metrics.stageSeconds.observe((Date.now() - startedAt) / 1_000, {
      stage: ENRICH_STAGE,
      outcome,
    });
  };

  const payload = event.payload;
  const deliveryId =
    typeof payload === 'object' && payload !== null && 'delivery_id' in payload
      ? (payload as { delivery_id?: unknown }).delivery_id
      : undefined;

  if (typeof deliveryId !== 'string' || deliveryId === '') {
    // 실패 대기열은 `delivery_id`로 색인된다. 그것이 없으면 기록할 자리가
    // 없다. 파티션을 영영 막지 않도록 기록만 남기고 ack한다.
    log({ level: 'error', message: 'delivery_id 없는 이벤트', reason: 'malformed_envelope' });
    observe('malformed');
    return { disposition: { kind: 'ack' }, reason: 'malformed_envelope' };
  }

  const fail = async (reason: string, detail: string): Promise<EnrichOutcome> => {
    await deadLetterRepo.recordDeadLetter(deps.pool, deliveryId, ENRICH_STAGE, detail, retriesUsed);
    deps.metrics.deadLettered.inc({ stage: ENRICH_STAGE, reason });
    log({
      level: 'error',
      message: '실패 대기열로 보냈다',
      delivery_id: deliveryId,
      correlation_id: event.correlation_id,
      reason,
      retry_count: retriesUsed,
    });
    observe('dead_letter');
    return { disposition: deadLetter(detail), reason };
  };

  const row = await rawEventRepo.findRawEventByDeliveryId(deps.pool, deliveryId);
  if (row === undefined) {
    // 게이트웨이는 저장한 뒤에 발행하므로 정상 경로에서는 있어야 한다. 복제
    // 지연 같은 일시적 원인일 수 있어 예산 안에서는 다시 시도한다.
    if (retriesUsed < MAX_RETRIES) {
      observe('retry');
      return { disposition: { kind: 'retry', reason: 'raw_event_missing' }, reason: 'raw_event_missing' };
    }
    return fail('raw_event_missing', `원본 이벤트를 찾을 수 없다: ${deliveryId}`);
  }

  const outcome = extractTarget(row.event_type, row.payload);
  if (outcome.kind === 'skip') {
    // DEV-016: 이 워커의 일이 아니다. 원본은 `raw_event`에 남아 있으므로
    // 소비자가 생기면 그때 진행된다. 여기서 실패로 적으면 실패 대기열이
    // 정상 이벤트로 가득 찬다.
    log({
      level: 'info',
      message: '보강 대상이 아니다',
      delivery_id: deliveryId,
      correlation_id: event.correlation_id,
      reason: outcome.reason,
    });
    observe('skipped');
    return { disposition: { kind: 'ack' }, reason: outcome.reason };
  }
  if (outcome.kind === 'invalid') {
    return fail('malformed_payload', outcome.reason);
  }

  const target = outcome.target;
  if (deps.installationFor(target.owner) === undefined) {
    return fail(
      'installation_unregistered',
      `설치가 등록되지 않은 조직이다: ${target.owner} (GHE_INSTALLATIONS 확인)`,
    );
  }

  return enrichTarget(deps, event, row, target, {
    deliveryId,
    retriesUsed,
    observe,
    fail,
    log,
  });
}

interface EnrichContext {
  readonly deliveryId: string;
  readonly retriesUsed: number;
  readonly observe: (outcome: string) => void;
  readonly fail: (reason: string, detail: string) => Promise<EnrichOutcome>;
  readonly log: (entry: EnrichLogEntry) => void;
}

async function enrichTarget(
  deps: EnrichDeps,
  event: DeliveredEvent,
  row: RawEventRow,
  target: EnrichTarget,
  context: EnrichContext,
): Promise<EnrichOutcome> {
  const ref = { owner: target.owner, repo: target.repo };
  const failures: ComponentFailure[] = [];

  // --- PR 본문 ---
  let pullRequest: EnrichedPullRequest | null = target.webhookPullRequest;
  try {
    const fresh = await deps.client.getPullRequest(ref, target.prNumber, { priority: 'realtime' });
    // API 응답이 웹훅보다 새롭다. 웹훅은 발생 시점의 스냅숏이고 재전송이면
    // 몇 분 전 것일 수도 있다. 그래서 겹치는 필드는 API 값을 그대로 쓴다.
    pullRequest = {
      number: fresh.number,
      title: fresh.title,
      body: fresh.body,
      state: fresh.state,
      draft: fresh.draft,
      labels: fresh.labels.map((label) => label.name),
      merged: fresh.merged,
      created_at: fresh.created_at,
      updated_at: fresh.updated_at,
      closed_at: fresh.closed_at,
      merged_at: fresh.merged_at,
      merge_commit_sha: fresh.merge_commit_sha,
      author: fresh.user?.login ?? null,
      head_ref: fresh.head.ref,
      head_sha: fresh.head.sha,
      base_ref: fresh.base.ref,
      base_sha: fresh.base.sha,
    };
  } catch (error) {
    if (isNotFound(error)) {
      // 삭제된 PR이다. 다시 물어봐도 없다 (비동기 5.2). 재시도 없이 종료한다.
      return context.fail('pull_request_not_found', `PR을 찾을 수 없다: ${target.prNumber}`);
    }
    failures.push(describeFailure('pull_request', error));
  }

  // --- 원본 커밋 ---
  let sourceCommitShas: readonly string[] = [];
  let sourceCommitsTruncated = false;
  try {
    const page = await deps.client.listPullRequestCommitsPaged(ref, target.prNumber, {
      priority: 'realtime',
    });
    sourceCommitShas = page.items.map((commit) => commit.sha);
    sourceCommitsTruncated = page.truncated;
  } catch (error) {
    failures.push(describeFailure('commits', error));
  }

  // --- 변경 파일 ---
  let changedFiles: readonly EnrichedChangedFile[] = [];
  let filesTruncated = false;
  try {
    const page = await deps.client.listPullRequestFilesPaged(ref, target.prNumber, {
      priority: 'realtime',
    });
    changedFiles = page.items.map((file) => ({
      filename: file.filename,
      additions: file.additions,
      deletions: file.deletions,
      status: file.status,
    }));
    filesTruncated = page.truncated;
  } catch (error) {
    failures.push(describeFailure('files', error));
  }

  // --- 리뷰 ---
  let reviews: readonly EnrichedReview[] = [];
  try {
    const list = await deps.client.listPullRequestReviews(ref, target.prNumber, {
      priority: 'realtime',
    });
    reviews = list.map((review) => ({
      id: review.id,
      state: review.state,
      reviewer: review.user?.login ?? null,
      submitted_at: review.submitted_at,
    }));
  } catch (error) {
    failures.push(describeFailure('reviews', error));
  }

  // --- 처분 ---
  const retryAt = earliestRetryAt(failures);
  if (retryAt !== undefined) {
    // AC-2. 재시도 예산을 쓰지 않는다 — 대기는 실패가 아니다.
    context.log({
      level: 'info',
      message: 'rate limit 회복까지 보강을 미룬다',
      delivery_id: context.deliveryId,
      correlation_id: event.correlation_id,
      repository_id: target.repositoryId,
      pr_number: target.prNumber,
      retry_at: retryAt.toISOString(),
    });
    context.observe('deferred');
    return { disposition: deferUntil(retryAt, 'rate_limited') };
  }

  const retryable = failures.some((failure) => failure.retryable);
  if (retryable && context.retriesUsed < MAX_RETRIES) {
    context.log({
      level: 'warn',
      message: '보강 실패, 표준 백오프로 재시도한다',
      delivery_id: context.deliveryId,
      correlation_id: event.correlation_id,
      repository_id: target.repositoryId,
      pr_number: target.prNumber,
      reason: failures.map((failure) => `${failure.error.component}:${failure.error.kind}`).join(','),
      retry_count: context.retriesUsed,
    });
    context.observe('retry');
    return { disposition: { kind: 'retry', reason: 'enrichment_failed' } };
  }

  const enrichmentPending = failures.length > 0;
  const enriched: IngestionEnriched = {
    delivery_id: context.deliveryId,
    repository_id: target.repositoryId,
    entity_kind: 'pull_request',
    pr_number: target.prNumber,
    pull_request: pullRequest,
    source_commit_shas: sourceCommitShas,
    changed_files: changedFiles,
    reviews,
    source_commits_truncated: sourceCommitsTruncated,
    files_truncated: filesTruncated,
    enrichment_pending: enrichmentPending,
    enrichment_errors: failures.map((failure) => failure.error),
    correlation_id: row.correlation_id,
  };

  // 부분이든 완전하든 먼저 넘긴다. 실패 대기열 기록보다 앞에 두어야 기록이
  // 실패해도 부분 문서는 살아남는다 (AC-3: "부분 문서는 유지한다").
  await deps.bus.publish(
    TOPICS.enriched,
    ingestPartitionKey(target.repositoryId, context.deliveryId),
    {
      // 같은 전달을 다시 처리하면 같은 ID가 나온다. 추적 가능해야 한다.
      event_id: deterministicEventId(EVENT_NAMES.ingestionEnriched, context.deliveryId),
      event_name: EVENT_NAMES.ingestionEnriched,
      correlation_id: row.correlation_id,
      occurred_at: (deps.now ?? ((): Date => new Date()))().toISOString(),
      payload: enriched,
    },
  );

  // `raw_event.processed_at`은 찍지 않는다. 문서가 색인된 시점을 뜻하는
  // 표식이고 색인은 WP-008의 일이다.

  if (!enrichmentPending) {
    context.log({
      level: 'info',
      message: '보강 완료',
      delivery_id: context.deliveryId,
      correlation_id: event.correlation_id,
      repository_id: target.repositoryId,
      pr_number: target.prNumber,
    });
    context.observe('ok');
    return { disposition: { kind: 'ack' }, published: enriched };
  }

  const reason = failures.map((failure) => `${failure.error.component}:${failure.error.kind}`).join(',');
  deps.metrics.enrichPending.inc({ reason: failures[0]?.error.kind ?? 'unknown' });
  const terminal = await context.fail(
    'enrichment_incomplete',
    `보강 부분 실패로 부분 문서를 진행했다: ${reason}`,
  );
  return { ...terminal, published: enriched };
}

/** 보강 핸들러. 처분만 돌려주고 ack·재전달은 버스가 한다. */
export function createEnrichHandler(deps: EnrichDeps): EventHandler {
  return async (event) => {
    const outcome = await handleIngestEvent(deps, event);
    return outcome.disposition;
  };
}

/**
 * `prs:ingest`의 `enrich` 그룹을 구독한다.
 *
 * 그룹 이름은 카탈로그에서 가져온다 — 워커가 문자열을 따로 적으면 카탈로그와
 * 어긋난 날 조용히 다른 그룹을 만들어 이벤트를 두 번 처리한다.
 */
export async function startEnrichWorker(
  deps: EnrichDeps,
  options: SubscribeOptions = {},
): Promise<Subscription> {
  return deps.bus.subscribe(
    TOPICS.ingest,
    consumerGroup(TOPICS.ingest),
    createEnrichHandler(deps),
    options,
  );
}
