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
 * ## 재시도의 단위는 요청이 아니라 **판단 전체**다 (안전성 보강)
 *
 * 처음 구현은 `updateTitle(nextTitle)`을 그대로 다섯 번 다시 실행했다. 그 사이에
 * 사람이 제목을 고쳤거나, 다른 M 접두가 생겼거나, 운영자가 저장소를 껐거나,
 * 재채번으로 번호가 무효가 됐어도 **첫 시도에 계산한 문자열이 그대로 다시 나갔다.**
 * 제목은 되돌릴 수 없으므로 그것은 되돌릴 수 없는 손실이다.
 *
 * 지금은 변경 요청을 다시 보낼 때마다 순서 전체를 다시 지난다:
 *
 * 1. 실행자 소유권과 시간 예산을 확인한다
 * 2. 정본·에폭·번호·저장소 정책을 **락 커넥션으로** 다시 묻는다
 * 3. GHE에서 **지금 제목**을 읽는다
 * 4. 순수 함수가 다시 판정한다 — 같은 접두면 호출하지 않고, 다른 M 접두면 덮지 않는다
 * 5. 변경 요청 차례를 기다린다 (실행자 전체의 간격)
 * 6. 제목 한 필드만 PATCH한다
 * 7. 응답이 보낸 값과 같은지 확인한다
 * 8. 정본에 결과를 남기고, 실제로 쓴 경우에만 감사를 남긴다
 *
 * ## 모르는 것을 안다고 적지 않는다
 *
 * 요청을 보내고 응답을 받지 못하면(시한 초과·연결 끊김·예산 만료·게이트웨이 5xx)
 * 서버가 처리했는지 **확정할 수 없다** — 공식 API가 멱등성 키도 요청 조회도 주지
 * 않는다. 그런 행은 `unknown`으로 남고 다음 회차가 제목을 다시 읽어 확인한다.
 * 서버가 저장한 제목이 보낸 값과 다르면 `body_changed`로 남고 **자동으로 다시
 * 시도하지 않는다** — 자동 재시도는 그 차이를 덮어 「원래 제목을 지킨다」를 조용히
 * 무너뜨린다.
 *
 * ## crash를 견디는 방법
 *
 * GHE 쓰기와 PostgreSQL 갱신은 한 트랜잭션이 될 수 없다. PATCH 성공 직후 죽으면
 * 행은 `done`이 아닌 채 남고 다음 회차가 다시 집는다. 그때 3단계가 이미 붙은
 * 접두를 보므로 **PATCH 없이** 복구된다 — 접두가 두 번 붙지 않는 것은
 * at-least-once 실행에서 이 순서가 만드는 성질이다.
 */

import { createHash, randomUUID } from 'node:crypto';

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
import {
  auditRepo,
  mergeSequenceRepo,
  repositoryRepo,
  sequenceSpaceRepo,
  type Pool,
  type PoolClient,
} from '@prs/db';
import { safeMessage } from '@prs/github';
import {
  ANNOTATE_MAX_ATTEMPTS,
  AnnotateApiError,
  EVENT_PASS_BUDGET_MS,
  PassDeadline,
  WriteGate,
  decideTitleUpdate,
  leavesOutcomeUnknown,
  resolveAnnotationTarget,
  type AnnotateClient,
  type AnnotateConfig,
} from '@prs/github-annotate';

import { withAnnotateRunnerLock } from './annotate-lock.js';
import type { WorkerMetrics } from './metrics.js';

/** 풀이든 특정 커넥션이든 질의를 받는다. `@prs/db`의 저장소들과 같은 관례다. */
type Queryable = Pool | PoolClient;

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
  /**
   * 변경 요청 간격을 **실행자 전체**에 적용하는 게이트.
   *
   * 운영에서는 프로세스마다 하나를 만들어 모든 회차가 공유한다 — 간격의 단위가
   * 회차가 아니라 실행자이기 때문이다. 주지 않으면 호출마다 새로 만든다: 시험이
   * 서로의 간격에 묶이지 않게 하는 기본값이며, 그 경우에도 **한 호출 안의**
   * 재시도 간격은 그대로 지켜진다.
   */
  readonly gate?: WriteGate;
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
  /** 서버가 저장한 제목이 보낸 값과 다르다. **자동으로 다시 시도하지 않는다.** */
  | 'body_changed'
  /** 요청을 보냈으나 결과를 확정할 수 없다. 다음 회차가 제목을 다시 읽어 확인한다. */
  | 'outcome_unknown'
  /** 예산이나 종료 요청으로 손을 뗐다. 원격에 아무것도 보내지 않았다. */
  | 'deferred'
  | 'failed';

export interface PassSummary {
  readonly processed: number;
  readonly results: Readonly<Partial<Record<AnnotateResult, number>>>;
  /** 한도에 걸려 회차를 멈췄다면 언제부터 다시 할 수 있는가. */
  readonly rateLimitedUntil?: Date;
  /** 시간 예산이 다해 남은 대상을 두고 돌아왔는가. */
  readonly budgetExhausted?: boolean;
  /** 다른 프로세스가 실행자다. 이 회차는 아무것도 하지 않았다. */
  readonly notRunner?: boolean;
}

/**
 * 첫 재시도까지의 대기(ms). 이후 두 배씩 늘린다.
 *
 * 다섯 번 시도하면 대기는 200·400·800·1600으로 합이 3초다. 여기에 변경 요청 간격이
 * 더해지므로 실제 회차 시간은 그보다 길고, **예산이 그 전부를 감싼다** — 대기가
 * 예산을 넘기면 자지 않고 손을 뗀다.
 */
const RETRY_BASE_MS = 200;

/**
 * 제목을 다시 읽지 않고 그대로 쓸 수 있는 대기 상한.
 *
 * 변경 요청 차례를 기다리는 동안 제목이 바뀔 수 있다. 그 창을 0으로 만들 수는 없지만
 * (조회와 PATCH 사이에는 언제나 왕복이 있다), **한도 유예처럼 긴 대기 뒤에는 다시
 * 읽는 것이 옳다.** 기준을 쓰기 간격으로 두는 이유는 그 정도의 창은 이미 계약이
 * 받아들인 크기이고(`DEV-618`), 한도 유예는 분 단위라 질이 다르기 때문이다.
 */
function titleRereadThresholdMs(config: AnnotateConfig): number {
  return config.writeSpacingMs;
}

/** 신선도 때문에 처음부터 다시 하는 횟수의 상한. 실패 재시도와 다른 예산이다. */
const MAX_FRESHNESS_RESTARTS = 3;

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

/** 기대한 제목의 지문. 원문을 정본에 복제하지 않으려고 해시 앞부분만 남긴다. */
function titleDigest(title: string): string {
  return createHash('sha256').update(title, 'utf8').digest('hex').slice(0, 16);
}

/** 감사는 주 동작 밖이다. 실패해도 표기 결과를 뒤집지 않는다 (FR-AUTH-004 AC-6). */
async function recordAnnotateAudit(
  deps: AnnotateDeps,
  target: mergeSequenceRepo.AnnotateTargetRow,
  correlationId: string,
  resultCode: 'annotated' | 'annotated_observed',
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
      resultCode,
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

/* ------------------------------------------------------------------ 한 행의 시도 */

/** 회차가 한 행에 넘겨 주는 실행 맥락. */
export interface AttemptContext {
  /** 락을 쥔 커넥션. 정본 확인과 상태 기록이 이것을 지난다. */
  readonly db: Queryable;
  readonly deadline: PassDeadline;
  readonly gate: WriteGate;
}

type AttemptOutcome =
  | { readonly kind: 'done'; readonly wrote: boolean }
  | { readonly kind: 'mismatch'; readonly found: string }
  | { readonly kind: 'body_changed'; readonly sentLength: number; readonly storedLength: number }
  | { readonly kind: 'superseded' }
  | { readonly kind: 'restart' }
  | { readonly kind: 'deferred' }
  | { readonly kind: 'failure'; readonly error: AnnotateApiError; readonly outcomeUnknown: boolean };

function toApiError(error: unknown): AnnotateApiError {
  if (error instanceof AnnotateApiError) return error;
  // 이 계층 밖의 오류다. 원격 상태를 모르는 쪽으로 보수적으로 다룬다.
  return new AnnotateApiError('server', safeMessage(error));
}

/**
 * 한 번의 시도. **여기서 원격에 보내는 변경 요청은 최대 하나다.**
 *
 * 실패해서 다시 시도하면 이 함수 전체를 다시 지난다 — 그것이 「오래된 제목을 다시
 * 보내지 않는다」를 만드는 구조다.
 */
async function attemptOnce(
  deps: AnnotateDeps,
  target: mergeSequenceRepo.AnnotateTargetRow,
  expected: string,
  context: AttemptContext,
): Promise<AttemptOutcome> {
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

  if (context.deadline.expired()) return { kind: 'deferred' };

  /*
   * 1. **정본·정책을 락 커넥션으로 묻는다.**
   *
   * 질의가 성공했다는 것이 곧 세션이 살아 있다는 증거이고, 세션이 살아 있으면
   * 실행자 락도 살아 있다. 죽었으면 여기서 던지고 **원격 요청을 시작하지 않는다.**
   */
  if (!(await mergeSequenceRepo.isAnnotationCurrent(context.db, key, target.merge_number))) {
    return { kind: 'superseded' };
  }

  // 2. 지금 제목을 읽는다. 저장된 제목을 쓰면 그 사이의 사용자 편집을 덮는다.
  let currentTitle: string;
  try {
    currentTitle = await deps.client.readTitle(ref, { signal: context.deadline.signal });
  } catch (error) {
    const api = toApiError(error);
    // 조회는 아무것도 바꾸지 않는다. 실패해도 원격 상태는 분명하다.
    return { kind: 'failure', error: api, outcomeUnknown: false };
  }

  // 3. 순수 판정.
  const decision = decideTitleUpdate(expected, currentTitle);
  if (decision.kind === 'already_annotated') return { kind: 'done', wrote: false };
  if (decision.kind === 'mismatch') return { kind: 'mismatch', found: decision.found };

  /*
   * 4. **변경 요청 차례를 기다린다.** 성공한 행 뒤에만 쉬면 실패가 이어질 때 간격이
   * 무너진다 — 부 한도를 부르는 바로 그 형태다.
   *
   * 기다림이 길면 방금 읽은 제목이 오래된 것이 되므로, 기다린 뒤 **처음부터 다시
   * 한다.** 짧은 기다림(쓰기 간격만큼)은 이미 계약이 받아들인 창이라 그대로 간다.
   */
  const waitMs = context.gate.waitMs();
  if (waitMs > 0) {
    const slept = await context.gate.waitForTurn(context.deadline, sleepOf(deps));
    if (!slept) return { kind: 'deferred' };
    if (waitMs > titleRereadThresholdMs(deps.config)) return { kind: 'restart' };
  }

  /*
   * 5. **쓰기 바로 앞에서 정본을 한 번 더 묻는다.** 기다리는 동안 재채번이 들어와
   * 에폭이 올랐을 수 있다. 제목은 되돌릴 수 없으므로 무효가 된 번호를 내보내지 않는다.
   */
  if (!(await mergeSequenceRepo.isAnnotationCurrent(context.db, key, target.merge_number))) {
    return { kind: 'superseded' };
  }
  if (context.deadline.expired()) return { kind: 'deferred' };

  // 6. 제목 한 필드만 바꾼다. 보낸 시각을 먼저 기록해 실패해도 간격이 지켜지게 한다.
  context.gate.markSent();
  let echoed: string;
  try {
    echoed = await deps.client.updateTitle(ref, decision.nextTitle, { signal: context.deadline.signal });
  } catch (error) {
    const api = toApiError(error);
    return { kind: 'failure', error: api, outcomeUnknown: leavesOutcomeUnknown(api.kind) };
  }

  /*
   * 7. **뒤 공백만 허용하고 본문은 그대로여야 한다.**
   *
   * 공식 문서는 응답의 `title`이 보낸 값과 같다고 보장하지 않으므로 완전 일치를
   * 요구하면 서버가 뒤 공백을 다듬는 것만으로 성공한 표기가 실패가 된다
   * (`DEV-623`). 그렇다고 **접두만 보면 더 나쁘다** — 문서가 제목 길이 상한도
   * 밝히지 않으므로 서버가 본문을 조용히 자르는 경로가 있을 수 있고, 그때
   * 접두만 확인하면 **원래 제목이 잘린 것을 성공으로 기록한다.**
   */
  if (echoed.trimEnd() !== decision.nextTitle.trimEnd()) {
    return { kind: 'body_changed', sentLength: decision.nextTitle.length, storedLength: echoed.length };
  }
  return { kind: 'done', wrote: true };
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
  context?: AttemptContext,
): Promise<AnnotateResult> {
  const log = logOf(deps);
  const sleep = sleepOf(deps);
  const ctx: AttemptContext = context ?? {
    db: deps.pool,
    deadline: new PassDeadline(),
    gate: deps.gate ?? new WriteGate({ spacingMs: deps.config.writeSpacingMs }),
  };
  const key = {
    repositoryId: target.repository_id,
    baseBranch: target.base_branch,
    seqEpoch: target.seq_epoch,
    mergeSeq: target.merge_seq,
  };

  // 1. 저장소 코드. 못 정하면 GHE를 부르지 않는다 (OD-009).
  const resolved = resolveAnnotationTarget(target.name, target.merge_number);
  if (resolved.kind === 'code_unavailable') {
    await mergeSequenceRepo.markAnnotateState(ctx.db, key, 'failed', { reason: resolved.reason });
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

  /*
   * **이미 「본문이 바뀐 채 저장됐다」고 확인한 행은 건드리지 않는다.**
   *
   * 대상 질의가 이미 걸러 주지만 이벤트 경로가 PR 번호를 직접 지목할 수 있으므로
   * 여기서도 막는다. 자동으로 다시 쓰면 그 차이를 덮어 「원래 제목을 지킨다」가
   * 조용히 무너진다 — 운영자가 확인하고 재개를 지시할 때까지 멈춘다.
   */
  if ((target.annotate_state as string | null) === 'body_changed') {
    log({
      level: 'warn',
      message: '본문 불일치로 멈춘 행이다 — 운영자의 재개가 필요하다',
      repository_id: target.repository_id,
      pull_request_number: target.pull_request_number,
      reason: 'awaiting_operator_resume',
    });
    return 'body_changed';
  }

  const evidenceBase = { attemptId: randomUUID(), expectedDigest: titleDigest(resolved.expected) };
  /** 결과를 모르는 행의 복구인가. 감사 결과 코드가 갈린다. */
  const recovering = (target.annotate_state as string | null) === 'unknown';
  let restarts = 0;

  for (let attempt = 1; attempt <= ANNOTATE_MAX_ATTEMPTS; attempt += 1) {
    let outcome: AttemptOutcome;
    try {
      outcome = await attemptOnce(deps, target, resolved.expected, ctx);
    } catch (error) {
      /*
       * 정본 질의가 던졌다 — 락 커넥션이 죽었거나 DB가 답하지 않는다. **원격에는
       * 아무것도 보내지 않았다.** 상태를 남기지 않고 다음 회차에 맡긴다.
       */
      log({
        level: 'error',
        message: '정본을 확인하지 못해 표기를 보류한다',
        repository_id: target.repository_id,
        pull_request_number: target.pull_request_number,
        reason: 'canonical_unreachable',
        error: safeMessage(error),
      });
      return 'deferred';
    }

    switch (outcome.kind) {
      case 'restart': {
        restarts += 1;
        if (restarts > MAX_FRESHNESS_RESTARTS) return 'deferred';
        attempt -= 1; // 신선도 재시작은 실패가 아니다. 재시도 횟수를 쓰지 않는다.
        continue;
      }
      case 'done': {
        if (outcome.wrote) {
          /*
           * **쓰기가 성공했으므로 이 저장소의 차단을 푼다.** 조회 성공으로 풀지
           * 않는 이유는 「읽을 수 있다」가 「제목을 고칠 수 있다」를 뜻하지 않기
           * 때문이다 — 공식 문서가 그 둘을 다른 권한으로 나눈다.
           */
          await repositoryRepo.clearAnnotationBlock(ctx.db, target.repository_id);
          /*
           * **감사를 정본 표시보다 앞에 둔다.** 이 지점에서 쓰기는 확정됐다.
           * 표시를 먼저 하고 그 사이에 죽으면 제목은 바뀌었는데 감사가 없는 행이
           * 남고, 다음 회차는 `already_annotated`라 다시 기록하지 않는다.
           *
           * **어느 순서로 두어도 창은 남는다.** 원자성이 불가능한 경계이므로 창을
           * 없애는 것이 아니라 **어느 쪽을 남길지 고르는 것**이고, 여기서는 둘 다
           * 정직하게 적는다:
           *
           * - 감사 뒤·표시 전에 죽으면 「감사는 있는데 표시가 없는 행」이 남고, 다음
           *   회차가 접두를 보고 `done`으로 마무리한다 — 잃는 것이 없다.
           * - **PATCH 뒤·감사 전에 죽으면 「썼는데 감사가 없는 행」이 남는다.** 그 행은
           *   상태가 비어 있어 다음 회차가 복구로 보지 않고, 접두를 보고 감사 없이
           *   `done`으로 끝낸다. 이 창은 이 순서가 좁히지 못한다.
           *
           * 감사를 앞에 둔 것은 앞의 창이 뒤의 창보다 짧기 때문이다(DB 왕복 하나 대
           * 네트워크 왕복 하나). 그것뿐이며 「감사가 절대 빠지지 않는다」가 아니다.
           */
          await recordAnnotateAudit(deps, target, correlationId, 'annotated');
        } else if (recovering) {
          /*
           * 결과를 모르던 행에서 접두를 관측했다. **우리 요청이 성공했다고 단정하지
           * 않는다** — 다른 주체가 같은 접두를 붙였을 수도 있고, 공식 API는 그것을
           * 가릴 수단을 주지 않는다. 관측했다는 사실만 다른 결과 코드로 남긴다.
           */
          await recordAnnotateAudit(deps, target, correlationId, 'annotated_observed');
        }
        await mergeSequenceRepo.markAnnotateState(ctx.db, key, 'done', {
          ...evidenceBase,
          reason: outcome.wrote ? 'patched' : recovering ? 'observed_after_unknown' : 'already_annotated',
        });
        return outcome.wrote ? 'updated' : 'already_done';
      }
      case 'mismatch': {
        await mergeSequenceRepo.markAnnotateState(ctx.db, key, 'mismatch', {
          ...evidenceBase,
          reason: 'foreign_prefix',
        });
        deps.metrics.mnumberAnnotateMismatchTotal.inc();
        log({
          level: 'warn',
          message: '다른 M 넘버 접두가 있어 덮지 않는다',
          repository_id: target.repository_id,
          repository: `${target.owner}/${target.name}`,
          pull_request_number: target.pull_request_number,
          expected: resolved.expected,
          found: outcome.found,
        });
        return 'mismatch';
      }
      case 'body_changed': {
        await mergeSequenceRepo.markAnnotateState(ctx.db, key, 'body_changed', {
          ...evidenceBase,
          reason: 'title_body_changed',
        });
        deps.metrics.mnumberAnnotateMismatchTotal.inc();
        log({
          level: 'error',
          message: 'GHE가 저장한 제목이 보낸 값과 다르다 — 운영자가 확인할 때까지 멈춘다',
          repository_id: target.repository_id,
          pull_request_number: target.pull_request_number,
          sent_length: outcome.sentLength,
          stored_length: outcome.storedLength,
          reason: 'title_body_changed',
        });
        return 'body_changed';
      }
      case 'superseded': {
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
      case 'deferred': {
        /*
         * 예산이나 종료로 손을 뗐다. **원격에 보낸 것이 없으므로** 상태를 남기지
         * 않는다 — 남기면 다음 회차가 그것을 실패로 읽는다.
         */
        return 'deferred';
      }
      case 'failure': {
        const { error } = outcome;
        // 한도만 회차 전체를 멈춘다. 여기서 자지 않는 것은 대기가 예산보다 길 수 있어서다.
        if (error.kind === 'rate_limited') throw error;

        if (error.kind === 'permission') {
          /*
           * 이 저장소의 표기를 멈춘다. **운영자의 `annotate_enabled`는 건드리지
           * 않는다** — 권한 오류는 운영자의 결정이 아니다.
           */
          await repositoryRepo.blockAnnotation(
            ctx.db,
            target.repository_id,
            `${String(error.status ?? 0)} ${error.message}`,
          );
          await mergeSequenceRepo.markAnnotateState(ctx.db, key, 'failed', {
            ...evidenceBase,
            reason: 'permission_blocked',
          });
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

        if (error.kind === 'validation') {
          await mergeSequenceRepo.markAnnotateState(ctx.db, key, 'failed', {
            ...evidenceBase,
            reason: 'validation_failed',
          });
          log({
            level: 'error',
            message: 'GHE가 제목을 거부했다',
            repository_id: target.repository_id,
            pull_request_number: target.pull_request_number,
            status: error.status ?? null,
            reason: 'validation',
            error: safeMessage(error),
          });
          return 'validation_failed';
        }

        if (error.kind === 'aborted') {
          /*
           * 우리가 끊었다. 변경 요청을 보낸 뒤였다면 **결과를 모른다.**
           */
          if (outcome.outcomeUnknown) {
            await mergeSequenceRepo.markAnnotateState(ctx.db, key, 'unknown', {
              ...evidenceBase,
              reason: 'aborted_after_send',
            });
            return 'outcome_unknown';
          }
          return 'deferred';
        }

        const lastAttempt = attempt === ANNOTATE_MAX_ATTEMPTS;
        if (!lastAttempt) {
          // 예산 안에서만 잔다. 잘 수 없으면 이 회차에서 더 하지 않는다.
          const slept = await ctx.deadline.sleep(RETRY_BASE_MS * 2 ** (attempt - 1), sleep);
          if (slept) continue;
        }

        /*
         * 더 시도하지 않는다. **결과를 아는가 모르는가**로 갈라 적는다 — 응답을
         * 받지 못한 변경 요청은 서버가 처리했을 수 있고, 그것을 `failed`로 적으면
         * 「실패했다」가 거짓이 된다.
         */
        const state = outcome.outcomeUnknown ? 'unknown' : 'failed';
        await mergeSequenceRepo.markAnnotateState(ctx.db, key, state, {
          ...evidenceBase,
          reason: outcome.outcomeUnknown ? `outcome_unknown_${error.kind}` : error.kind,
        });
        log({
          level: 'error',
          message: outcome.outcomeUnknown ? '변경 요청의 결과를 확정하지 못했다' : '표기에 실패했다',
          repository_id: target.repository_id,
          repository: `${target.owner}/${target.name}`,
          pull_request_number: target.pull_request_number,
          reason: error.kind,
          status: error.status ?? null,
          error: safeMessage(error),
        });
        return outcome.outcomeUnknown ? 'outcome_unknown' : 'failed';
      }
    }
  }

  /* 루프는 반드시 반환한다. 타입을 만족시키기 위한 줄이다. */
  return 'failed';
}

/* ------------------------------------------------------------------ 회차 */

/**
 * **이 프로세스 안에서 회차는 하나씩만 돈다.**
 *
 * 이벤트 구독과 잔여 스윕은 서로를 모르는 채 같은 프로세스에서 돈다. 둘이 겹치면
 * 아직 표시되지 않은 같은 행을 둘 다 골라, 둘 다 제목을 읽고 둘 다 PATCH를 보낸다 —
 * 결과 제목은 같아도 요청과 감사 기록이 두 벌이 되어 「쓴 횟수」가 거짓이 된다.
 *
 * **프로세스 사이는 이것이 막지 못한다.** 그쪽은 `withAnnotateRunnerLock`의 몫이며,
 * 둘은 같은 것을 다른 범위에서 막는다.
 */
let passChain: Promise<void> = Promise.resolve();

/**
 * 줄을 서서 내 차례를 기다린다.
 *
 * **기다림 자체가 예산 안에 있다.** 앞 회차가 상한만큼 돌면 뒤에 선 이벤트는
 * 수백 초를 기다릴 수 있고, 그동안 버스는 30초 방치를 이유로 그 이벤트를 회수한다.
 * 회수된 이벤트를 손에 쥔 채 일하는 것이 바로 「같은 행을 둘이 집는」 상태다.
 *
 * @returns 차례가 왔으면 자리를 비우는 함수. 예산이 먼저 다하면 `undefined`이며,
 *   그때 **내 자리는 이미 비워져 있다** — 뒤에 선 회차가 나를 기다리지 않는다.
 */
async function acquirePassSlot(deadline: PassDeadline): Promise<(() => void) | undefined> {
  const previous = passChain;
  let release: () => void = () => {};
  const mine = new Promise<void>((resolve) => {
    release = resolve;
  });
  /*
   * 등록은 **동기적으로** 한다. `await` 뒤에 등록하면 동시에 도착한 회차 여럿이
   * 같은 `previous`를 보고 모두 통과해 겹친다.
   */
  passChain = previous.then(() => mine).catch(() => undefined) as Promise<void>;

  if (deadline.expired()) {
    release();
    return undefined;
  }
  /*
   * **예산이 없어도 신호는 듣는다.** 예산이 무한한 회차(잔여 스윕)를 그냥
   * `await previous`로 두면 종료 요청이 와도 앞 회차가 끝날 때까지 줄에 묶인다 —
   * 이벤트 회차가 앞에 있으면 그 예산(25초)만큼 프로세스가 죽지 못한다. 갈래를
   * 두지 않고 언제나 경주시키면, 신호가 없는 회차는 자연히 `previous`만 기다린다.
   */
  const gotTurn = await new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (value: boolean): void => {
      if (settled) return;
      settled = true;
      deadline.signal.removeEventListener('abort', onAbort);
      resolve(value);
    };
    const onAbort = (): void => {
      finish(false);
    };
    deadline.signal.addEventListener('abort', onAbort, { once: true });
    void previous.catch(() => undefined).then(() => {
      finish(true);
    });
  });

  /*
   * 차례가 온 뒤에도 **시각으로 한 번 더 확인한다.** 신호는 타이머가 올리므로
   * 앞 회차가 끝나는 순간과 만료가 겹치면 신호가 아직 오르지 않았을 수 있다.
   */
  if (!gotTurn || deadline.expired()) {
    release();
    return undefined;
  }
  return release;
}

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
  externalSignal?: AbortSignal,
): Promise<PassSummary> {
  /*
   * **예산은 줄을 서기 전부터 잰다.** 락을 잡은 뒤부터 재면 대기 시간이 예산 밖으로
   * 빠지고, 그것이 바로 버스의 회수 시한을 넘기는 자리다 (DEV-628).
   */
  const deadline = new PassDeadline(budgetMs, Date.now(), Date.now, externalSignal);
  try {
    const release = await acquirePassSlot(deadline);
    if (release === undefined) {
      logOf(deps)({ level: 'info', message: '줄에서 기다리다 예산이 다했다' });
      return { processed: 0, results: {}, budgetExhausted: true };
    }
    try {
      /*
       * **실행자는 하나다.** 같은 정본 DB를 보는 다른 프로세스가 이미 표기 중이면
       * 이 회차는 아무것도 하지 않는다 — 읽기 역할은 그대로 돈다.
       */
      const outcome = await withAnnotateRunnerLock(deps.pool, async (client) =>
        runAnnotationPassLocked(deps, filter, correlationId, deadline, client),
      );
      if (outcome.kind === 'not_runner') {
        logOf(deps)({
          level: 'info',
          message: '다른 프로세스가 표기 실행자다 — 이 회차는 건너뛴다',
          reason: 'not_runner',
        });
        return { processed: 0, results: {}, notRunner: true };
      }
      return outcome.value;
    } finally {
      release();
    }
  } finally {
    deadline.dispose();
  }
}

async function runAnnotationPassLocked(
  deps: AnnotateDeps,
  filter: mergeSequenceRepo.AnnotateTargetFilter,
  correlationId: string,
  deadline: PassDeadline,
  client: PoolClient,
): Promise<PassSummary> {
  const log = logOf(deps);
  const results: Partial<Record<AnnotateResult, number>> = {};
  const gate = deps.gate ?? new WriteGate({ spacingMs: deps.config.writeSpacingMs });
  const context: AttemptContext = { db: client, deadline, gate };
  let processed = 0;

  if (deadline.expired()) return { processed: 0, results, budgetExhausted: true };

  // 한도로 멈춰 있는 동안에는 정본을 읽지도 않는다 — 읽어 봐야 쓸 수 없다.
  const paused = gate.pausedUntil();
  if (paused !== undefined && paused.getTime() > Date.now()) {
    return { processed: 0, results, rateLimitedUntil: paused };
  }

  const targets = await mergeSequenceRepo.listAnnotateTargets(client, filter);
  const blocked = new Set<number>();

  for (const target of targets) {
    if (blocked.has(target.repository_id)) continue;
    if (deadline.expired()) {
      log({
        level: 'info',
        message: '시간 예산이 다해 이번 회차를 멈춘다',
        processed,
        remaining: targets.length - processed,
      });
      return { processed, results, budgetExhausted: true };
    }
    let result: AnnotateResult;
    try {
      result = await annotateOne(deps, target, correlationId, context);
    } catch (error) {
      if (error instanceof AnnotateApiError && error.kind === 'rate_limited') {
        /*
         * 회복 시각은 언제나 있다 — `classifyFailure`가 `429`에는 문서의 최소
         * 대기(1분)를 채우고, `403`은 대기 신호가 있을 때만 이 갈래로 온다.
         */
        const retryAt = error.retryAt ?? new Date(Date.now() + 60_000);
        /*
         * **게이트 전체를 멈춘다.** 이 이벤트만 `defer`하고 다음 이벤트가 곧바로
         * 같은 한도를 두드리면 유예가 아무것도 아니다 (재현 E와 같은 뿌리).
         */
        gate.pauseUntil(retryAt);
        deps.metrics.mnumberAnnotateTotal.inc({ result: 'rate_limited' });
        log({
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
     * 예산이나 종료로 손을 뗐다면 **여기서 멈춘다.** 다음 행을 집으면 방금 손을
     * 뗀 이유가 사라진다.
     */
    if (result === 'deferred') {
      return { processed, results, ...(deadline.expired() ? { budgetExhausted: true } : {}) };
    }
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
   * 다른 프로세스가 실행자다. 그쪽이 같은 정본을 보고 일하고 있으므로 **곧 다시
   * 받기만 한다** — ack하면 그 프로세스가 이 PR을 집지 않았을 때 잔여 스윕까지 밀린다.
   */
  if (summary.notRunner === true) {
    return deferUntil(new Date(Date.now() + 5_000), 'annotate_not_runner');
  }
  /*
   * 예산이 다해 남긴 것이 있으면 **곧 다시 받는다.** `retry`가 아니라 `defer`인 것은
   * 실패가 아니기 때문이다 — 재시도 횟수를 올리면 정상 동작이 dead letter로 간다.
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
 * 복구됐는지 확인할 다른 경로가 없기 때문이다. 다시 본다고 차단이 풀리지는
 * 않는다: 푸는 것은 실제 쓰기 성공이나 운영자의 재개다.
 *
 * **종료 요청에 답한다.** 상한 200건짜리 회차가 끝나기를 기다리면 프로세스가
 * 몇 분 동안 죽지 못한다. `stop()`은 진행 중인 회차의 중단 신호를 올려 HTTP
 * 왕복까지 끊고, 끊긴 행은 다음 기동이 정본에서 다시 집는다.
 */
export function startAnnotateSweeper(deps: AnnotateDeps, intervalMs = deps.config.sweepIntervalMs): AnnotateSweeper {
  const log = logOf(deps);
  const now = deps.now ?? ((): Date => new Date());
  const stopping = new AbortController();
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
        /*
         * **해제 표시도 실행자 락 안에서 한다.** GHE를 부르지 않는 순수 DB 쓰기이지만,
         * 락 밖에 두면 두 프로세스가 같은 행을 함께 표시해 `disabled` 지표가 부풀고
         * 「실행자는 하나다」가 회차에만 참인 말이 된다. 회차와 별도로 잠그는 것은
         * 둘이 독립적이기 때문이며, 그 사이에 다른 프로세스가 회차를 가져가도 잃는
         * 것이 없다.
         */
        const disabledOutcome = await withAnnotateRunnerLock(deps.pool, async (client) =>
          mergeSequenceRepo.markDisabledRepositoryTargets(client, deps.config.sweepLimit),
        );
        const disabled = disabledOutcome.kind === 'ran' ? disabledOutcome.value : 0;
        if (disabled > 0) {
          deps.metrics.mnumberAnnotateTotal.inc({ result: 'disabled' }, disabled);
          log({ level: 'info', message: '해제된 저장소의 표기 대상을 표시했다', count: disabled });
        }
        const summary = await runAnnotationPass(
          deps,
          {
            limit: deps.config.sweepLimit,
            blockedBefore: new Date(now().getTime() - deps.config.blockCooldownMs),
          },
          undefined,
          undefined,
          stopping.signal,
        );
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
      // 진행 중인 회차를 끊는다. 끊긴 자리는 정본에 남아 다음 기동이 이어받는다.
      stopping.abort();
      wake?.();
      await loop;
    },
  };
}
