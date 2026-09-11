/**
 * PR 제목 M 넘버 표기 (JOB-SEQ-005 / WP-075, FR-SEQ-009, ADR-022).
 *
 * ## 이벤트는 힌트이고 정본은 DB다
 *
 * `EVT-SEQ-004`의 payload는 "이 공간의 이 번호들이 확정됐다"는 신호일 뿐이다
 * (비동기 문서 EVT-SEQ-004: **payload는 힌트이며 소비자는 현재 epoch·정본을
 * 재검증한다**). 그래서 쓰기 직전에 정본을 다시 읽고, 늦게 도착한 이전 에폭
 * 이벤트는 아무것도 고치지 못한다.
 *
 * ## 순서가 계약이다
 *
 * 1. 저장소 코드를 정한다 — 못 정하면 **요청 한 번도 보내지 않는다**
 * 2. GHE에서 **지금 제목**을 읽는다 — 이벤트나 색인의 옛 제목을 쓰지 않는다
 * 3. 순수 함수가 판정한다 — 같은 접두면 호출하지 않고, 다른 M 접두면 덮지 않는다
 * 4. 제목 한 필드만 PATCH한다
 * 5. 정본에 결과를 남기고, 실제로 쓴 경우에만 감사를 남긴다
 *
 * ## crash를 견디는 방법
 *
 * GHE 쓰기와 PostgreSQL 갱신은 한 트랜잭션이 될 수 없다. PATCH 성공 직후 죽으면
 * 행은 `done`이 아닌 채 남고 다음 회차가 다시 집는다. 그때 2단계가 이미 붙은
 * 접두를 보므로 **PATCH 없이** `done`으로 복구된다 — 접두가 두 번 붙지 않는 것은
 * at-least-once 실행에서 이 순서가 만드는 성질이다.
 */

import { randomUUID } from 'node:crypto';

import { ANNOTATE_PRINCIPAL, EVENT_NAMES, type MergeNumberAssigned } from '@prs/domain';
import {
  TOPICS,
  consumerGroup,
  deferUntil,
  type DeliveredEvent,
  type EventBus,
  type EventHandler,
  type HandlerDisposition,
  type SubscribeOptions,
  type Subscription,
} from '@prs/bus';
import { auditRepo, mergeSequenceRepo, repositoryRepo, sequenceSpaceRepo, type Pool } from '@prs/db';
import { safeMessage } from '@prs/github';
import {
  ANNOTATE_MAX_ATTEMPTS,
  AnnotateApiError,
  EVENT_PASS_BUDGET_MS,
  decideTitleUpdate,
  resolveAnnotationTarget,
  type AnnotateClient,
  type AnnotateConfig,
} from '@prs/github-annotate';

import type { WorkerMetrics } from './metrics.js';

export interface AnnotateLogFields {
  readonly level: 'info' | 'warn' | 'error';
  readonly message: string;
  readonly [key: string]: unknown;
}

export interface AnnotateDeps {
  readonly pool: Pool;
  readonly bus: EventBus;
  readonly client: AnnotateClient;
  readonly config: AnnotateConfig;
  readonly metrics: Pick<WorkerMetrics, 'mnumberAnnotateTotal' | 'mnumberAnnotateMismatchTotal'>;
  readonly log?: (fields: AnnotateLogFields) => void;
  readonly now?: () => Date;
  /** 재시도 대기. 시험이 시간을 건너뛸 수 있게 열어 둔다. */
  readonly sleep?: (ms: number) => Promise<void>;
}

/** 한 행의 처리 결과. 지표의 `result` 라벨이 그대로 이 값이다. */
export type AnnotateResult =
  | 'updated'
  | 'already_done'
  | 'mismatch'
  | 'code_unavailable'
  | 'permission_blocked'
  | 'validation_failed'
  /** 쓰기 직전 재확인에서 정본이 바뀌었다. 상태를 남기지 않고 다음 회차에 맡긴다. */
  | 'superseded'
  | 'failed';

export interface PassSummary {
  readonly processed: number;
  readonly results: Readonly<Partial<Record<AnnotateResult, number>>>;
  /** 한도에 걸려 회차를 멈췄다면 언제부터 다시 할 수 있는가. */
  readonly rateLimitedUntil?: Date;
  /** 시간 예산이 다해 남은 대상을 두고 돌아왔는가. */
  readonly budgetExhausted?: boolean;
}

/**
 * 첫 재시도까지의 대기(ms). 이후 두 배씩 늘린다.
 *
 * 다섯 번 시도하면 대기는 200·400·800·1600으로 합이 3초다. `JOB-SEQ-005`의 회차
 * 예산 30초 안에 요청 다섯 번과 함께 들어간다. **상한 상수를 두지 않는 이유는
 * 이 수열에서 상한이 닿지 않기 때문이다** — 닿지 않는 가지를 두면 그것이 무엇을
 * 막는지 아무도 확인할 수 없다.
 */
const RETRY_BASE_MS = 200;

function logOf(deps: AnnotateDeps): (fields: AnnotateLogFields) => void {
  return (
    deps.log ??
    ((fields): void => {
      process.stdout.write(`${JSON.stringify({ service: 'pipeline-worker', job: 'JOB-SEQ-005', ...fields })}\n`);
    })
  );
}

function sleepOf(deps: AnnotateDeps): (ms: number) => Promise<void> {
  return (
    deps.sleep ??
    (async (ms): Promise<void> => {
      await new Promise<void>((resolve) => setTimeout(resolve, ms));
    })
  );
}

/**
 * 일시 실패에만 다시 시도한다 (JOB-SEQ-005: 5회 지수 백오프).
 *
 * `permission`·`validation`은 **첫 실패에서 그대로 올린다** — 권한이 없는데
 * 반복하면 한도만 태운다(FR-SEQ-009 예외 처리). `rate_limited`도 올린다:
 * 대기해야 할 시간이 회차 예산보다 길 수 있으므로 여기서 자지 않고 회차를
 * 멈추는 쪽이 정직하다.
 */
async function withRetry<T>(deps: AnnotateDeps, operation: () => Promise<T>): Promise<T> {
  const sleep = sleepOf(deps);
  let lastError: unknown;
  for (let attempt = 1; attempt <= ANNOTATE_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      const retryable =
        error instanceof AnnotateApiError && error.retryable && error.kind !== 'rate_limited';
      if (!retryable || attempt === ANNOTATE_MAX_ATTEMPTS) throw error;
      await sleep(RETRY_BASE_MS * 2 ** (attempt - 1));
    }
  }
  /* 루프는 반드시 반환하거나 던진다. 타입을 만족시키기 위한 줄이다. */
  throw lastError;
}

/** 감사는 주 동작 밖이다. 실패해도 표기 결과를 뒤집지 않는다 (FR-AUTH-004 AC-6). */
async function recordAnnotateAudit(
  deps: AnnotateDeps,
  target: mergeSequenceRepo.AnnotateTargetRow,
  correlationId: string,
): Promise<void> {
  const log = logOf(deps);
  try {
    /*
     * `audit_record.correlation_id`는 uuid 타입이다. 스윕처럼 상관 ID가 없는
     * 경로에서 빈 문자열을 넣으면 INSERT가 던지고 catch가 삼켜 **감사 기록이
     * 조용히 사라진다** (`sequence.ts`가 시험으로 겪은 자리).
     */
    const value = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(correlationId)
      ? correlationId
      : randomUUID();
    await auditRepo.recordAudit(deps.pool, {
      userId: ANNOTATE_PRINCIPAL,
      action: 'pull_request.annotate',
      target: `${target.owner}/${target.name}#${String(target.pull_request_number)}`,
      // 질의가 없는 행위다. 의미 없는 문자열을 채우지 않는다 (보안 문서 13.3).
      query: null,
      resultCode: 'annotated',
      correlationId: value,
    });
  } catch (error) {
    log({
      level: 'error',
      message: '표기 감사 기록 저장 실패',
      repository_id: target.repository_id,
      pull_request_number: target.pull_request_number,
      reason: 'audit_write_failed',
      error: safeMessage(error),
    });
  }
}

/**
 * 한 행을 처리한다.
 *
 * 던지는 것은 `rate_limited` 하나뿐이다 — 그것만 **회차 전체**를 멈추게 하기
 * 때문이다. 나머지는 전부 결과로 돌려 회차가 다음 행으로 넘어간다.
 */
export async function annotateOne(
  deps: AnnotateDeps,
  target: mergeSequenceRepo.AnnotateTargetRow,
  correlationId: string,
): Promise<AnnotateResult> {
  const log = logOf(deps);
  const key = {
    repositoryId: target.repository_id,
    baseBranch: target.base_branch,
    seqEpoch: target.seq_epoch,
    mergeSeq: target.merge_seq,
  };
  const ref = {
    owner: target.owner,
    repo: target.name,
    pullRequestNumber: target.pull_request_number,
  };

  // 1. 저장소 코드. 못 정하면 GHE를 부르지 않는다 (OD-009).
  const resolved = resolveAnnotationTarget(target.name, target.merge_number);
  if (resolved.kind === 'code_unavailable') {
    await mergeSequenceRepo.markAnnotateState(deps.pool, key, 'failed');
    log({
      level: 'warn',
      message: '저장소 코드를 정할 수 없어 표기하지 않는다',
      repository_id: target.repository_id,
      repository: `${target.owner}/${target.name}`,
      pull_request_number: target.pull_request_number,
      reason: resolved.reason,
    });
    return 'code_unavailable';
  }

  try {
    // 2. 지금 제목을 읽는다. 저장된 제목을 쓰면 그 사이의 사용자 편집을 덮는다.
    const currentTitle = await withRetry(deps, async () => deps.client.readTitle(ref));

    // 3. 순수 판정.
    /*
     * **여기까지 왔다는 것은 GHE가 200을 줬다는 뜻이다.** 접근이 증명됐으므로
     * 이전의 권한 차단을 푼다 — 쓰기 성공에서만 풀면, 남은 대상이 모두 이미
     * 표기돼 있는 저장소는 권한이 복구돼도 차단이 남아 새 PR의 표기가 다음
     * 스윕까지 밀린다 (리뷰 minor).
     */
    await repositoryRepo.clearAnnotationBlock(deps.pool, target.repository_id);

    const decision = decideTitleUpdate(resolved.expected, currentTitle);
    if (decision.kind === 'already_annotated') {
      await mergeSequenceRepo.markAnnotateState(deps.pool, key, 'done');
      return 'already_done';
    }
    if (decision.kind === 'mismatch') {
      await mergeSequenceRepo.markAnnotateState(deps.pool, key, 'mismatch');
      deps.metrics.mnumberAnnotateMismatchTotal.inc();
      log({
        level: 'warn',
        message: '다른 M 넘버 접두가 있어 덮지 않는다',
        repository_id: target.repository_id,
        repository: `${target.owner}/${target.name}`,
        pull_request_number: target.pull_request_number,
        expected: resolved.expected,
        found: decision.found,
      });
      return 'mismatch';
    }

    /*
     * 4. **외부 쓰기 바로 앞에서 정본을 한 번 더 묻는다.**
     *
     * 목록을 뽑은 뒤 한 건씩 처리하는 동안 재채번이 들어와 에폭이 오를 수 있다.
     * 제목은 되돌릴 수 없으므로 무효가 된 번호를 내보내지 않는다.
     */
    if (!(await mergeSequenceRepo.isAnnotationCurrent(deps.pool, key, target.merge_number))) {
      log({
        level: 'info',
        message: '정본이 그 사이 바뀌어 표기하지 않는다',
        repository_id: target.repository_id,
        pull_request_number: target.pull_request_number,
        reason: 'canonical_moved',
      });
      // 상태를 남기지 않는다 — 다음 회차가 현재 정본으로 다시 판정한다.
      return 'superseded';
    }

    // 5. 제목 한 필드만 바꾼다.
    const echoed = await withRetry(deps, async () => deps.client.updateTitle(ref, decision.nextTitle));
    /*
     * **보낸 문자열과의 완전 일치를 성공 조건으로 삼지 않는다.**
     *
     * 공식 문서는 응답의 `title`이 보낸 값과 같다고 보장하지 않으며, 서버가 앞뒤
     * 공백을 다듬기만 해도 완전 일치는 깨진다. 그때 성공한 표기가 `failed`로 남으면
     * 지표가 거짓을 말한다. `AC-1`이 요구하는 것은 **접두가 붙었는가**이므로,
     * 같은 순수 판정기에 응답을 넣어 그것을 묻는다.
     */
    if (decideTitleUpdate(resolved.expected, echoed).kind !== 'already_annotated') {
      await mergeSequenceRepo.markAnnotateState(deps.pool, key, 'failed');
      log({
        level: 'error',
        message: 'GHE가 저장한 제목에 기대한 접두가 없다',
        repository_id: target.repository_id,
        pull_request_number: target.pull_request_number,
        reason: 'title_prefix_absent',
      });
      return 'failed';
    }

    /*
     * 6. **감사를 정본 표시보다 앞에 둔다** (리뷰 note).
     *
     * 이 지점에서 쓰기는 이미 확정됐다 — GHE가 기대한 접두를 담은 제목을
     * 돌려줬다. 표시를 먼저 하고 그 사이에 죽으면 **제목은 바뀌었는데 감사가
     * 없는 행**이 남고, 다음 회차는 `already_annotated`라 다시 기록하지 않는다.
     * 순서를 뒤집으면 그 창에서 남는 것은 "감사는 있는데 표시가 없는 행"이고,
     * 그 행은 다음 회차가 `done`으로 마무리한다 — 감사가 빠지지 않는 쪽이
     * `AC-4`에 부합한다.
     *
     * **실제로 GHE에 쓴 경우에만 기록한다.** 이미 접두가 있어 호출하지 않은
     * 회차까지 남기면 감사 이력의 건수가 "제목이 바뀐 횟수"를 말하지 않게 된다.
     * 주 동작 밖이라 실패해도 이 결과를 뒤집지 않는다.
     */
    await recordAnnotateAudit(deps, target, correlationId);
    await mergeSequenceRepo.markAnnotateState(deps.pool, key, 'done');
    return 'updated';
  } catch (error) {
    if (error instanceof AnnotateApiError && error.kind === 'rate_limited') throw error;

    if (error instanceof AnnotateApiError && error.kind === 'permission') {
      /*
       * 이 저장소의 표기를 멈춘다. **운영자의 `annotate_enabled`는 건드리지
       * 않는다** — 권한 오류는 운영자의 결정이 아니다.
       */
      await repositoryRepo.blockAnnotation(
        deps.pool,
        target.repository_id,
        `${String(error.status ?? 0)} ${error.message}`,
      );
      await mergeSequenceRepo.markAnnotateState(deps.pool, key, 'failed');
      log({
        level: 'error',
        message: '표기 권한이 없어 이 저장소를 멈춘다',
        repository_id: target.repository_id,
        repository: `${target.owner}/${target.name}`,
        pull_request_number: target.pull_request_number,
        status: error.status ?? null,
        reason: 'permission_blocked',
      });
      return 'permission_blocked';
    }

    const validation = error instanceof AnnotateApiError && error.kind === 'validation';
    await mergeSequenceRepo.markAnnotateState(deps.pool, key, 'failed');
    log({
      level: 'error',
      message: validation ? 'GHE가 제목을 거부했다' : '표기에 실패했다',
      repository_id: target.repository_id,
      repository: `${target.owner}/${target.name}`,
      pull_request_number: target.pull_request_number,
      reason: error instanceof AnnotateApiError ? error.kind : 'unknown',
      status: error instanceof AnnotateApiError ? (error.status ?? null) : null,
      error: safeMessage(error),
    });
    return validation ? 'validation_failed' : 'failed';
  }
}

/**
 * **이 프로세스 안에서 회차는 하나씩만 돈다.**
 *
 * 이벤트 구독과 잔여 스윕은 서로를 모르는 채 같은 프로세스에서 돈다. 둘이 겹치면
 * 아직 표시되지 않은 같은 행을 둘 다 골라, 둘 다 제목을 읽고 둘 다 PATCH를 보낸다 —
 * 결과 제목은 같아도 요청과 감사 기록이 두 벌이 되어 「쓴 횟수」가 거짓이 된다.
 * 배포가 replica 1이라는 사실은 **파드 사이**를 막을 뿐 이 경합을 막지 못한다.
 *
 * 공식 문서의 「변경 요청은 직렬로 보내라」와도 같은 방향이다.
 */
let passChain: Promise<unknown> = Promise.resolve();

/**
 * 대상을 훑는다. 이벤트 경로와 잔여 스윕이 같은 함수를 쓴다.
 *
 * 권한으로 멈춘 저장소는 **그 회차 안에서 더 보지 않는다** — 차단을 남겼어도
 * 이미 뽑아 둔 목록에는 같은 저장소의 다음 행이 남아 있고, 그것을 그대로 처리하면
 * 막자마자 같은 저장소에 다시 요청하게 된다.
 */
export async function runAnnotationPass(
  deps: AnnotateDeps,
  filter: mergeSequenceRepo.AnnotateTargetFilter,
  correlationId: string = randomUUID(),
  budgetMs?: number,
): Promise<PassSummary> {
  /*
   * **예산은 줄을 서기 전부터 잰다.**
   *
   * 잔여 스윕이 상한만큼 돌면 회차가 수백 초를 쥔다. 그동안 도착한 이벤트가
   * 줄에서 기다리는 시간도 **버스가 재는 방치 시간에 들어간다** — 락을 잡은
   * 뒤부터 재면 30초 회수 시한을 기다리기만 하다 넘겨 버린다. 대기까지 예산에
   * 넣어야 이벤트가 제때 손을 떼고 `defer`로 돌아간다.
   */
  const queuedAt = Date.now();
  const previous = passChain.catch(() => undefined);
  const started = previous.then(async () =>
    runAnnotationPassUnlocked(deps, filter, correlationId, budgetMs, queuedAt),
  );
  passChain = started;
  return started;
}

async function runAnnotationPassUnlocked(
  deps: AnnotateDeps,
  filter: mergeSequenceRepo.AnnotateTargetFilter,
  correlationId: string,
  budgetMs: number | undefined,
  startedAt: number,
): Promise<PassSummary> {
  const sleep = sleepOf(deps);
  const results: Partial<Record<AnnotateResult, number>> = {};
  // 줄에서 기다리는 동안 예산이 다했으면 정본을 읽지도 않는다.
  if (budgetMs !== undefined && Date.now() - startedAt >= budgetMs) {
    logOf(deps)({ level: 'info', message: '줄에서 기다리다 예산이 다했다', waited_ms: Date.now() - startedAt });
    return { processed: 0, results, budgetExhausted: true };
  }
  const targets = await mergeSequenceRepo.listAnnotateTargets(deps.pool, filter);
  const blocked = new Set<number>();
  let processed = 0;

  for (const target of targets) {
    if (blocked.has(target.repository_id)) continue;
    /*
     * **예산을 넘기면 한 것까지 남기고 돌아온다.** 이벤트 경로가 오래 붙들면
     * 버스가 30초 방치된 항목을 회수해 같은 행을 다시 집는다. 남은 대상은
     * 이미 정본에 있으므로 잃지 않는다.
     */
    if (budgetMs !== undefined && Date.now() - startedAt >= budgetMs) {
      logOf(deps)({
        level: 'info',
        message: '시간 예산이 다해 이번 회차를 멈춘다',
        processed,
        remaining: targets.length - processed,
      });
      return { processed, results, budgetExhausted: true };
    }
    let result: AnnotateResult;
    try {
      result = await annotateOne(deps, target, correlationId);
    } catch (error) {
      if (error instanceof AnnotateApiError && error.kind === 'rate_limited') {
        /*
         * 회복 시각은 언제나 있다 — `classifyFailure`가 `429`에는 문서의 최소
         * 대기(1분)를 채우고, `403`은 대기 신호가 있을 때만 이 갈래로 온다.
         * 그래도 기본값을 두는 것은 그 불변식이 타입에 적히지 않기 때문이며,
         * 값이 없다고 ack해 버리면 이 회차가 못 쓴 PR이 스윕까지 밀린다.
         */
        const retryAt = error.retryAt ?? new Date(Date.now() + 60_000);
        deps.metrics.mnumberAnnotateTotal.inc({ result: 'rate_limited' });
        logOf(deps)({
          level: 'warn',
          message: '한도에 걸려 이번 회차를 멈춘다',
          repository_id: target.repository_id,
          retry_at: retryAt.toISOString(),
        });
        return { processed, results, rateLimitedUntil: retryAt };
      }
      throw error;
    }
    if (result === 'permission_blocked') blocked.add(target.repository_id);
    deps.metrics.mnumberAnnotateTotal.inc({ result });
    results[result] = (results[result] ?? 0) + 1;
    processed += 1;
    /*
     * **실제로 쓴 뒤에만 쉰다** (공식 문서의 변경 요청 지침). 조회만 한 회차까지
     * 늦추면 스윕이 상한만큼 도는 데 걸리는 시간이 이유 없이 늘어난다.
     */
    if (result === 'updated') await sleep(deps.config.writeSpacingMs);
  }

  return { processed, results };
}

/* ------------------------------------------------------------------ 이벤트 경로 */

export async function handleMergeNumberAssigned(
  deps: AnnotateDeps,
  event: DeliveredEvent,
): Promise<HandlerDisposition> {
  if (event.event_name !== EVENT_NAMES.mergeNumberAssigned) return { kind: 'ack' };

  const payload = event.payload as Partial<MergeNumberAssigned> | undefined;
  const repositoryId = payload?.repository_id;
  const baseBranch = payload?.base_branch;
  const prNumbers = payload?.pull_request_numbers;
  if (typeof repositoryId !== 'number' || typeof baseBranch !== 'string' || baseBranch === '') {
    return { kind: 'ack' };
  }

  /*
   * **에폭을 먼저 실측한다.** 질의도 현재 에폭만 내지만, 늦게 도착한 옛 에폭
   * 이벤트를 "대상 0건"과 구분해 로그로 남길 수 있어야 한다 — 둘을 섞으면
   * 표기가 왜 안 되는지 물었을 때 답할 근거가 없다.
   */
  const space = await sequenceSpaceRepo.findSequenceSpace(deps.pool, repositoryId, baseBranch);
  if (space === undefined) return { kind: 'ack' };
  if (typeof payload?.seq_epoch === 'number' && payload.seq_epoch !== space.seq_epoch) {
    logOf(deps)({
      level: 'info',
      message: '이전 에폭의 표기 이벤트라 건너뛴다',
      repository_id: repositoryId,
      event_epoch: payload.seq_epoch,
      current_epoch: space.seq_epoch,
    });
    return { kind: 'ack' };
  }

  const summary = await runAnnotationPass(
    deps,
    {
      limit: deps.config.sweepLimit,
      repositoryId,
      baseBranch,
      // payload의 번호는 힌트다. 정본 질의가 그중 실제로 표기할 것만 남긴다.
      ...(Array.isArray(prNumbers) && prNumbers.length > 0 ? { pullRequestNumbers: prNumbers } : {}),
    },
    // 채번을 유발한 요청의 상관 ID를 감사까지 잇는다 (DEV-594와 같은 근거).
    event.correlation_id,
    EVENT_PASS_BUDGET_MS,
  );

  /*
   * 한도에 걸렸으면 **다시 받는다.** ack하면 이 회차에 못 쓴 PR은 잔여 스윕까지
   * 최대 하루를 기다린다.
   */
  if (summary.rateLimitedUntil !== undefined) {
    return deferUntil(summary.rateLimitedUntil, 'annotate_rate_limited');
  }
  /*
   * 예산이 다해 남긴 것이 있으면 **곧 다시 받는다.** ack하면 그 PR들이 잔여
   * 스윕까지 최대 하루를 기다린다. `retry`가 아니라 `defer`인 것은 실패가
   * 아니기 때문이다 — 재시도 횟수를 올리면 정상 동작이 dead letter로 간다.
   */
  if (summary.budgetExhausted === true) {
    return deferUntil(new Date(Date.now() + 1_000), 'annotate_budget_exhausted');
  }
  return { kind: 'ack' };
}

export async function startAnnotateWorker(
  deps: AnnotateDeps,
  options: SubscribeOptions = {},
): Promise<Subscription> {
  const handler: EventHandler = async (event) => handleMergeNumberAssigned(deps, event);
  // `mnumber`(WP-074)와 다른 group이다. 같으면 둘이 이벤트를 나눠 먹는다.
  return deps.bus.subscribe(TOPICS.projected, consumerGroup(TOPICS.projected, 'annotate'), handler, options);
}

/* ------------------------------------------------------------------ 잔여 스윕 */

export interface AnnotateSweeper {
  stop(): Promise<void>;
}

/**
 * 미표기 잔여 스윕 (JOB-SEQ-005, 일 1회).
 *
 * 이벤트가 유실됐거나 PATCH 직후 프로세스가 죽어 정본에 결과를 못 남긴 행을
 * 여기서 메운다. **차단된 저장소도 쿨다운이 지나면 한 번 다시 본다** — 권한이
 * 복구됐는지 확인할 다른 경로가 없기 때문이다.
 *
 * 비동기 문서 9장이 `05:30 KST`를 적지만 **주기만 코드가 안다** — `retention.ts`가
 * 같은 자리에서 같은 관례를 따른다. 벽시계 스케줄러를 이 잡에만 두면 같은 문서의
 * 다른 일 1회 잡들과 동작이 갈린다.
 */
export function startAnnotateSweeper(deps: AnnotateDeps, intervalMs = deps.config.sweepIntervalMs): AnnotateSweeper {
  const log = logOf(deps);
  const now = deps.now ?? ((): Date => new Date());
  let stopped = false;
  let wake: (() => void) | undefined;

  const sleep = (ms: number): Promise<void> =>
    new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      wake = (): void => {
        clearTimeout(timer);
        resolve();
      };
    });

  const loop = (async (): Promise<void> => {
    while (!stopped) {
      await sleep(intervalMs);
      if (stopped) break;
      try {
        const disabled = await mergeSequenceRepo.markDisabledRepositoryTargets(deps.pool, deps.config.sweepLimit);
        if (disabled > 0) {
          deps.metrics.mnumberAnnotateTotal.inc({ result: 'disabled' }, disabled);
          log({ level: 'info', message: '해제된 저장소의 표기 대상을 표시했다', count: disabled });
        }
        const summary = await runAnnotationPass(deps, {
          limit: deps.config.sweepLimit,
          blockedBefore: new Date(now().getTime() - deps.config.blockCooldownMs),
        });
        if (summary.processed > 0 || summary.rateLimitedUntil !== undefined) {
          log({ level: 'info', message: '잔여 표기 스윕', processed: summary.processed, results: summary.results });
        }
      } catch (error) {
        log({
          level: 'error',
          message: '잔여 표기 스윕이 실패했다',
          error: safeMessage(error),
        });
      }
    }
  })();

  return {
    stop: async (): Promise<void> => {
      stopped = true;
      wake?.();
      await loop;
    },
  };
}
