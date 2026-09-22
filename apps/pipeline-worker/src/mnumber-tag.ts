/**
 * M 번호 lightweight 태그 (JOB-SEQ-007 / WP-100, FR-SEQ-012, ADR-026).
 *
 * ## 이 파일이 하는 일
 *
 * `sequence_work`의 `tag` kind를 집어 원격 GHE에 `refs/tags/M-<코드>-<번호>`를 **만든다.**
 * 채번 트랜잭션이 남긴 의도(PR당 한 행)와 잔여 스윕이 다시 요청한 의도가 같은 경로로
 * 온다. 이 역할(`tag`)만 태그 전용 App의 자격을 갖는다.
 *
 * ## 한 work의 순서 — 재시도는 요청이 아니라 판단 전체를 다시 지난다
 *
 * 1. 정본을 **다시** 읽는다(`findTagTarget`: 현재 에폭·번호·SHA·저장소 정책·차단·추적 브랜치).
 *    payload는 힌트다 — 옛 에폭의 work가 이미 무효가 된 번호로 태그를 만들지 못한다.
 * 2. 원격 ref를 읽는다(`GET /git/ref/tags/<name>`).
 * 3. 순수 판정(`decideTagAction`): 없으면 만든다, 같은 SHA면 끝, 다른 것이면 **충돌** — 옮기지 않는다.
 * 4. 변경 요청 차례를 기다리고(실행자 전체의 간격) **쓰기 바로 앞에서** 정본을 한 번 더 묻는다.
 * 5. `POST /git/refs` 하나. 422는 문구로 가르지 않고 ref를 다시 읽어 뜻을 정한다.
 * 6. 결과를 정본에 남기고, **실제로 만든 경우에만** 감사를 남긴다.
 *
 * ## 모르는 것을 안다고 적지 않는다
 *
 * 응답을 받지 못한 생성 요청은 서버가 처리했을 수 있다. 그 행은 `unknown`으로 남고 다음
 * 시도의 `GET`이 답한다 — 이미 있으면 호출 없이 `observed_after_unknown`으로 끝난다.
 *
 * ## 되돌릴 수 없는 것을 되돌리지 않는다
 *
 * 태그를 옮기거나 지우는 메서드는 클라이언트에 없다(`@prs/github-tag`). 충돌은 사람이 본다
 * (RUNBOOK 7.F). 에폭이 올라 번호가 바뀌어도 기존 태그는 그대로다 — 새 번호가 기존 태그와
 * 다른 SHA를 만나면 충돌로 남는다. 그것이 ADR-007 규칙 5(인용은 조용히 재해석되지 않는다)를
 * 원격 태그까지 늘린 것이다.
 */

import { randomUUID } from 'node:crypto';
import { MAX_RETRIES } from '@prs/bus';
import { TAG_PRINCIPAL } from '@prs/domain';
import {
  auditRepo,
  mergeSequenceRepo,
  repositoryRepo,
  sequenceWorkRepo,
  type Pool,
  type SequenceWorkRow,
} from '@prs/db';
import { PassDeadline, WriteGate, safeMessage } from '@prs/github';
import {
  TAG_MAX_ATTEMPTS,
  TagApiError,
  decideTagAction,
  leavesOutcomeUnknown,
  resolveTagTarget,
  type TagClient,
  type TagConfig,
} from '@prs/github-tag';
import type { WorkerMetrics } from './metrics.js';
import { WORK_DEFER_MS, WORK_HEARTBEAT_MS, WORK_LEASE_MS, WORK_PARK_MS, retryDelayMs } from './sequence-work-runner.js';

export interface TagLogFields {
  readonly level: 'info' | 'warn' | 'error';
  readonly message: string;
  readonly [key: string]: unknown;
}

export interface TagDeps {
  readonly pool: Pool;
  readonly client: TagClient;
  readonly config: TagConfig;
  readonly metrics: Pick<WorkerMetrics, 'mnumberTagTotal' | 'mnumberTagConflictTotal' | 'sequenceWorkTotal'>;
  readonly log?: (fields: TagLogFields) => void;
  readonly now?: () => Date;
  readonly sleep?: (ms: number) => Promise<void>;
  /** 변경 요청 간격을 실행자 전체에 적용하는 게이트. 운영에서는 프로세스마다 하나다. */
  readonly gate?: WriteGate;
}

/** work 하나의 결과. 지표 `mnumber_tag_total{result}`의 값이 그대로 이것이다. */
export type TagResult =
  | 'created'
  | 'already_done'
  | 'observed_after_unknown'
  | 'conflict'
  | 'code_unavailable'
  | 'disabled'
  | 'multiple_sequence_branches'
  | 'permission_blocked'
  | 'superseded'
  | 'obsolete'
  | 'unprocessable'
  | 'outcome_unknown'
  | 'rate_limited'
  | 'deferred'
  | 'failed';

export interface TagWorkOutcome {
  readonly result: TagResult;
  /** `rate_limited`·`deferred`(차단 쿨다운)에서 다음에 볼 시각. */
  readonly retryAt?: Date;
}

/** work 하나에 허용하는 시간. lease(60초)보다 짧아야 다른 워커가 회수하기 전에 손을 뗀다. */
export const TAG_WORK_BUDGET_MS = 50_000;
const RETRY_BASE_MS = 200;

function logOf(deps: TagDeps): (fields: TagLogFields) => void {
  return (
    deps.log ??
    ((fields): void => {
      process.stdout.write(`${JSON.stringify({ service: 'pipeline-worker', job: 'JOB-SEQ-007', ...fields })}\n`);
    })
  );
}

function sleepOf(deps: TagDeps): (ms: number) => Promise<void> {
  return (
    deps.sleep ??
    (async (ms): Promise<void> => {
      await new Promise<void>((resolve) => setTimeout(resolve, ms));
    })
  );
}

function toApiError(error: unknown): TagApiError {
  if (error instanceof TagApiError) return error;
  return new TagApiError('server', safeMessage(error));
}

/** 감사는 주 동작 밖이다. 실패해도 태그 결과를 뒤집지 않는다 (FR-AUTH-004 AC-6). */
async function recordTagAudit(
  deps: TagDeps,
  target: mergeSequenceRepo.TagTargetRow,
  tagName: string,
  correlationId: string,
  resultCode: 'created' | 'observed',
): Promise<void> {
  const log = logOf(deps);
  try {
    // `audit_record.correlation_id`는 uuid다. 스윕처럼 상관 ID가 없는 경로는 새 값을 만든다.
    const value = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(correlationId) ? correlationId : randomUUID();
    await auditRepo.recordAudit(deps.pool, {
      userId: TAG_PRINCIPAL,
      action: 'merge_number.tag',
      target: `${target.owner}/${target.name}:refs/tags/${tagName}`,
      query: null,
      resultCode,
      correlationId: value,
    });
  } catch (error) {
    log({ level: 'error', message: '태그 감사 기록 저장 실패', repository_id: target.repository_id, tag: tagName, reason: 'audit_write_failed', error: safeMessage(error) });
  }
}

export interface TagAttemptContext {
  readonly deadline: PassDeadline;
  readonly gate: WriteGate;
  readonly correlationId: string;
}

type AttemptOutcome =
  | { readonly kind: 'done'; readonly wrote: boolean }
  | { readonly kind: 'conflict'; readonly foundSha: string; readonly objectType: string }
  | { readonly kind: 'superseded' }
  | { readonly kind: 'deferred' }
  | { readonly kind: 'failure'; readonly error: TagApiError; readonly outcomeUnknown: boolean };

/** 한 번의 시도. 여기서 원격에 보내는 변경 요청은 최대 하나다. */
async function attemptOnce(
  deps: TagDeps,
  target: mergeSequenceRepo.TagTargetRow,
  expected: { readonly name: string; readonly sha: string },
  context: TagAttemptContext,
): Promise<AttemptOutcome> {
  const ref = { owner: target.owner, repo: target.name };
  const key = { repositoryId: target.repository_id, baseBranch: target.base_branch, seqEpoch: target.seq_epoch, mergeSeq: target.merge_seq };
  if (context.deadline.expired()) return { kind: 'deferred' };

  // 1. 원격 상태를 읽는다. 조회는 아무것도 바꾸지 않는다.
  let lookup;
  try {
    lookup = await deps.client.readTagRef(ref, expected.name, { signal: context.deadline.signal });
  } catch (error) {
    return { kind: 'failure', error: toApiError(error), outcomeUnknown: false };
  }

  // 2. 순수 판정.
  const decision = decideTagAction(expected.sha, lookup);
  if (decision.kind === 'already_done') return { kind: 'done', wrote: false };
  if (decision.kind === 'conflict') return { kind: 'conflict', foundSha: decision.foundSha, objectType: decision.objectType };

  // 3. 변경 요청 차례를 기다린다 — 실패가 이어져도 간격은 지켜진다.
  const slept = await context.gate.waitForTurn(context.deadline, sleepOf(deps));
  if (!slept) return { kind: 'deferred' };

  // 4. 쓰기 바로 앞에서 정본을 한 번 더 묻는다. 태그는 되돌릴 수 없다.
  if (!(await mergeSequenceRepo.isTagTargetCurrent(deps.pool, key, target.merge_number, expected.sha))) {
    return { kind: 'superseded' };
  }
  if (context.deadline.expired()) return { kind: 'deferred' };

  // 5. ref 하나를 만든다. 보낸 시각을 먼저 기록해 실패해도 간격이 지켜지게 한다.
  context.gate.markSent();
  try {
    await deps.client.createTagRef(ref, expected.name, expected.sha, { signal: context.deadline.signal });
    return { kind: 'done', wrote: true };
  } catch (error) {
    const api = toApiError(error);
    if (api.kind === 'unprocessable') {
      /*
       * 422는 「이미 있다」와 「그 SHA가 이 저장소에 없다」가 같은 코드다. 문구로 가르지 않고
       * 다시 읽는다 — 그 사이 다른 실행자가 만들었을 수도 있고(같은 SHA면 끝, 다른 SHA면 충돌),
       * 아무것도 없으면 SHA가 원격에 없는 것이다.
       */
      try {
        const again = await deps.client.readTagRef(ref, expected.name, { signal: context.deadline.signal });
        const reread = decideTagAction(expected.sha, again);
        if (reread.kind === 'already_done') return { kind: 'done', wrote: false };
        if (reread.kind === 'conflict') return { kind: 'conflict', foundSha: reread.foundSha, objectType: reread.objectType };
      } catch (rereadError) {
        return { kind: 'failure', error: toApiError(rereadError), outcomeUnknown: false };
      }
      return { kind: 'failure', error: api, outcomeUnknown: false };
    }
    return { kind: 'failure', error: api, outcomeUnknown: leavesOutcomeUnknown(api.kind) };
  }
}

/**
 * `tag` work 하나를 끝까지 처리한다. 던지지 않는다 — 결과로 돌려주고 러너가 work 상태를 정한다.
 */
export async function materializeTag(
  deps: TagDeps,
  work: Pick<SequenceWorkRow, 'work_key' | 'repository_id' | 'base_branch' | 'seq_epoch' | 'payload'>,
  context?: Partial<TagAttemptContext>,
): Promise<TagWorkOutcome> {
  const log = logOf(deps);
  const sleep = sleepOf(deps);
  const now = deps.now ?? ((): Date => new Date());
  const ctx: TagAttemptContext = {
    deadline: context?.deadline ?? new PassDeadline(TAG_WORK_BUDGET_MS),
    gate: context?.gate ?? deps.gate ?? new WriteGate({ spacingMs: deps.config.writeSpacingMs }),
    correlationId: context?.correlationId ?? randomUUID(),
  };
  const ownsDeadline = context?.deadline === undefined;

  try {
    const prNumber = Number((work.payload as { pr_number?: unknown }).pr_number);
    if (!Number.isInteger(prNumber) || prNumber < 1) return { result: 'obsolete' };

    // 1. 정본을 다시 읽는다 — 현재 에폭의 번호 행만 나온다.
    const target = await mergeSequenceRepo.findTagTarget(deps.pool, { repositoryId: work.repository_id, baseBranch: work.base_branch, prNumber });
    if (target === undefined || target.seq_epoch !== work.seq_epoch) return { result: 'obsolete' };
    const key = { repositoryId: target.repository_id, baseBranch: target.base_branch, seqEpoch: target.seq_epoch, mergeSeq: target.merge_seq };

    if (target.repository_status !== 'active') return { result: 'disabled' };
    if (!target.tag_enabled) {
      await mergeSequenceRepo.markTagState(deps.pool, key, 'disabled', { reason: 'repository_tag_disabled' });
      return { result: 'disabled' };
    }
    if (target.sequence_branches.length !== 1) {
      /*
       * 태그 이름에 브랜치가 없다. 시퀀스 브랜치가 둘이면 `M-1900-1`이 두 SHA를 뜻하므로 만들지
       * 않는다 — 어느 브랜치의 번호를 굳힐지는 제품 결정이다(OD-015).
       */
      await mergeSequenceRepo.markTagState(deps.pool, key, 'disabled', { reason: 'multiple_sequence_branches' });
      log({ level: 'warn', message: '시퀀스 브랜치가 둘 이상인 저장소라 태그를 만들지 않는다 (OD-015)', repository_id: target.repository_id, repository: `${target.owner}/${target.name}`, branches: target.sequence_branches, reason: 'multiple_sequence_branches' });
      return { result: 'multiple_sequence_branches' };
    }
    if (target.tag_blocked_at !== null) {
      const resumeAt = new Date(target.tag_blocked_at.getTime() + deps.config.blockCooldownMs);
      if (resumeAt.getTime() > now().getTime()) return { result: 'deferred', retryAt: resumeAt };
    }
    if (target.tag_state === 'conflict') {
      // 손대지 않기로 한 태그다. 다시 판정하는 것은 대조(reconcile)의 몫이다.
      return { result: 'conflict' };
    }

    const resolved = resolveTagTarget(target.name, target.merge_number, target.commit_sha);
    if (resolved.kind === 'code_unavailable') {
      await mergeSequenceRepo.markTagState(deps.pool, key, 'failed', { reason: resolved.reason });
      log({ level: 'warn', message: '저장소 코드를 정할 수 없어 태그를 만들지 않는다', repository_id: target.repository_id, repository: `${target.owner}/${target.name}`, reason: resolved.reason });
      return { result: 'code_unavailable' };
    }
    const expected = { name: resolved.name, sha: resolved.sha };
    const attemptId = randomUUID();
    const recovering = target.tag_state === 'unknown';

    for (let attempt = 1; attempt <= TAG_MAX_ATTEMPTS; attempt += 1) {
      const outcome = await attemptOnce(deps, target, expected, ctx);
      switch (outcome.kind) {
        case 'done': {
          if (outcome.wrote) {
            await repositoryRepo.clearTagBlock(deps.pool, target.repository_id);
            await recordTagAudit(deps, target, expected.name, ctx.correlationId, 'created');
          } else if (recovering) {
            await recordTagAudit(deps, target, expected.name, ctx.correlationId, 'observed');
          }
          await mergeSequenceRepo.markTagState(deps.pool, key, 'done', { attemptId, reason: outcome.wrote ? 'created' : recovering ? 'observed_after_unknown' : 'already_present' });
          log({ level: 'info', message: outcome.wrote ? '태그를 만들었다' : '태그가 이미 있다', repository_id: target.repository_id, repository: `${target.owner}/${target.name}`, tag: expected.name, sha: expected.sha, wrote: outcome.wrote });
          return { result: outcome.wrote ? 'created' : recovering ? 'observed_after_unknown' : 'already_done' };
        }
        case 'conflict': {
          await mergeSequenceRepo.markTagState(deps.pool, key, 'conflict', { attemptId, reason: outcome.objectType === 'tag' ? 'annotated_tag' : 'different_sha', foundSha: outcome.foundSha });
          deps.metrics.mnumberTagConflictTotal.inc();
          log({ level: 'error', message: '같은 이름의 태그가 다른 대상을 가리킨다 — 옮기지 않는다. 운영자가 확인한다 (RUNBOOK 7.F)', repository_id: target.repository_id, repository: `${target.owner}/${target.name}`, tag: expected.name, expected_sha: expected.sha, found_sha: outcome.foundSha, object_type: outcome.objectType, reason: 'tag_conflict' });
          return { result: 'conflict' };
        }
        case 'superseded':
          log({ level: 'info', message: '정본이 그 사이 바뀌어 태그를 만들지 않는다', repository_id: target.repository_id, tag: expected.name, reason: 'canonical_moved' });
          return { result: 'superseded' };
        case 'deferred':
          return { result: 'deferred' };
        case 'failure': {
          const { error } = outcome;
          if (error.kind === 'rate_limited') {
            const retryAt = error.retryAt ?? new Date(now().getTime() + 60_000);
            ctx.gate.pauseUntil(retryAt);
            log({ level: 'warn', message: '한도에 걸려 태그를 미룬다', repository_id: target.repository_id, retry_at: retryAt.toISOString() });
            return { result: 'rate_limited', retryAt };
          }
          if (error.kind === 'permission') {
            await repositoryRepo.blockTagging(deps.pool, target.repository_id, `${String(error.status ?? 0)} ${error.message}`);
            await mergeSequenceRepo.markTagState(deps.pool, key, 'failed', { attemptId, reason: 'permission_blocked' });
            log({ level: 'error', message: '태그 권한이 없어 이 저장소를 멈춘다', repository_id: target.repository_id, repository: `${target.owner}/${target.name}`, status: error.status ?? null, reason: 'permission_blocked' });
            return { result: 'permission_blocked' };
          }
          if (error.kind === 'unprocessable') {
            await mergeSequenceRepo.markTagState(deps.pool, key, 'failed', { attemptId, reason: 'sha_not_in_remote' });
            log({ level: 'error', message: 'GHE가 ref 생성을 거부했다 — 머지 커밋이 원격에 없다', repository_id: target.repository_id, tag: expected.name, sha: expected.sha, status: error.status ?? null, reason: 'unprocessable' });
            return { result: 'unprocessable' };
          }
          if (error.kind === 'aborted') {
            if (outcome.outcomeUnknown) {
              await mergeSequenceRepo.markTagState(deps.pool, key, 'unknown', { attemptId, reason: 'aborted_after_send' });
              return { result: 'outcome_unknown' };
            }
            return { result: 'deferred' };
          }
          const lastAttempt = attempt === TAG_MAX_ATTEMPTS;
          if (!lastAttempt) {
            const slept = await ctx.deadline.sleep(RETRY_BASE_MS * 2 ** (attempt - 1), sleep);
            if (slept) continue;
          }
          const state = outcome.outcomeUnknown ? 'unknown' : 'failed';
          await mergeSequenceRepo.markTagState(deps.pool, key, state, { attemptId, reason: outcome.outcomeUnknown ? `outcome_unknown_${error.kind}` : error.kind });
          log({ level: 'error', message: outcome.outcomeUnknown ? '태그 생성 요청의 결과를 확정하지 못했다' : '태그 생성에 실패했다', repository_id: target.repository_id, tag: expected.name, reason: error.kind, status: error.status ?? null, error: safeMessage(error) });
          return { result: outcome.outcomeUnknown ? 'outcome_unknown' : 'failed' };
        }
      }
    }
    return { result: 'failed' };
  } catch (error) {
    // 정본 질의가 던졌다. 원격에 보낸 것이 없거나 이미 결과를 남겼다 — 러너가 백오프로 다시 본다.
    log({ level: 'error', message: '태그 work 처리 중 정본을 확인하지 못했다', work_key: work.work_key, reason: 'canonical_unreachable', error: safeMessage(error) });
    return { result: 'failed' };
  } finally {
    if (ownsDeadline) ctx.deadline.dispose();
  }
}

/* ------------------------------------------------------------------ durable 러너 */

export interface TagWorkRunnerOptions {
  readonly pollMs?: number;
  readonly claimLimit?: number;
  readonly leaseMs?: number;
  readonly retryMaxMs?: number;
  readonly random?: () => number;
}

export interface TagRoundResult {
  readonly claimed: number;
  readonly outcomes: Readonly<Record<string, number>>;
}

/**
 * 한 회차: 만료 lease 회수 → `tag` claim → **직렬** 실행. 시험이 직접 부른다.
 *
 * 직렬인 이유는 공식 문서의 「변경 요청은 동시에 보내지 말고 직렬로」다. 한도에 걸리면 남은
 * 행을 두고 회차를 끝낸다 — 게이트가 멈춘 동안 정본을 읽어 봐야 쓸 수 없다.
 */
export async function runTagWorkOnce(deps: TagDeps, options: TagWorkRunnerOptions = {}): Promise<TagRoundResult> {
  const log = logOf(deps);
  const now = deps.now ?? ((): Date => new Date());
  const gate = deps.gate ?? new WriteGate({ spacingMs: deps.config.writeSpacingMs });
  const outcomes: Record<string, number> = {};
  const bump = (outcome: string): void => {
    outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
    deps.metrics.sequenceWorkTotal.inc({ kind: 'tag', outcome });
  };

  const paused = gate.pausedUntil();
  if (paused !== undefined && paused.getTime() > now().getTime()) return { claimed: 0, outcomes };

  await sequenceWorkRepo.reclaimExpiredLeases(deps.pool);
  const claimed = await sequenceWorkRepo.claimDueWork(deps.pool, {
    kinds: ['tag'],
    limit: options.claimLimit ?? 8,
    leaseMs: options.leaseMs ?? WORK_LEASE_MS,
  });

  let stopAfter = false;
  for (const row of claimed) {
    const lease = { workKey: row.work_key, leaseToken: row.lease_token as string };
    const heartbeat = setInterval(() => {
      void sequenceWorkRepo.heartbeatWork(deps.pool, lease, options.leaseMs ?? WORK_LEASE_MS).catch(() => undefined);
    }, WORK_HEARTBEAT_MS);
    heartbeat.unref();
    const finish = async (
      outcome: string,
      next: { readonly state: 'done' } | { readonly state: 'retry' | 'parked' | 'obsolete' | 'ready'; readonly delayMs: number; readonly reason: string; readonly resetAttempts?: boolean },
    ): Promise<void> => {
      const applied =
        next.state === 'done'
          ? await sequenceWorkRepo.completeWork(deps.pool, lease, row.requested_generation)
          : await sequenceWorkRepo.releaseWork(deps.pool, lease, {
              state: next.state,
              availableAt: new Date(now().getTime() + next.delayMs),
              reason: next.reason,
              ...(next.resetAttempts === undefined ? {} : { resetAttempts: next.resetAttempts }),
            });
      if (!applied) {
        log({ level: 'warn', message: 'lease를 잃어 결과를 기록하지 못했다 — 다른 워커가 이어 간다', work_key: row.work_key, reason: 'lease_lost' });
        bump('lease_lost');
        return;
      }
      bump(outcome);
    };
    const retryLater = (reason: string, outcome: string): Promise<void> => {
      if (row.attempt_count >= MAX_RETRIES) {
        log({ level: 'error', message: '태그 work가 반복 실패한다 — 경보 대상이며 work는 유지한다', work_key: row.work_key, attempt: row.attempt_count, reason });
      }
      return finish(outcome, { state: 'retry', delayMs: retryDelayMs(row.attempt_count, options.retryMaxMs ?? 60_000, options.random ?? Math.random), reason });
    };

    try {
      if (stopAfter) {
        await finish('rate_limited_skip', { state: 'ready', delayMs: WORK_DEFER_MS, reason: 'rate_limited', resetAttempts: true });
        continue;
      }
      const deadline = new PassDeadline(TAG_WORK_BUDGET_MS, now().getTime(), () => now().getTime());
      let outcome: TagWorkOutcome;
      try {
        const payload = row.payload as { correlation_id?: unknown };
        outcome = await materializeTag(deps, row, { deadline, gate, ...(typeof payload.correlation_id === 'string' ? { correlationId: payload.correlation_id } : {}) });
      } finally {
        deadline.dispose();
      }
      deps.metrics.mnumberTagTotal.inc({ result: outcome.result });
      switch (outcome.result) {
        case 'created':
        case 'already_done':
        case 'observed_after_unknown':
        case 'conflict':
        case 'code_unavailable':
        case 'disabled':
        case 'multiple_sequence_branches':
          // 끝난 상태다. 충돌·해제는 대조(reconcile)나 운영자가 다시 연다.
          await finish(outcome.result, { state: 'done' });
          break;
        case 'obsolete':
          await finish('obsolete', { state: 'obsolete', delayMs: 0, reason: 'epoch_moved' });
          break;
        case 'superseded':
          await finish('superseded', { state: 'ready', delayMs: WORK_DEFER_MS, reason: 'canonical_moved', resetAttempts: true });
          break;
        case 'deferred':
          await finish('deferred', {
            state: 'retry',
            delayMs: outcome.retryAt === undefined ? WORK_DEFER_MS : Math.max(0, outcome.retryAt.getTime() - now().getTime()),
            reason: outcome.retryAt === undefined ? 'budget_exhausted' : 'tag_block_cooldown',
            resetAttempts: true,
          });
          break;
        case 'rate_limited':
          stopAfter = true;
          await finish('rate_limited', {
            state: 'retry',
            delayMs: outcome.retryAt === undefined ? 60_000 : Math.max(0, outcome.retryAt.getTime() - now().getTime()),
            reason: 'rate_limited',
            resetAttempts: true,
          });
          break;
        case 'permission_blocked':
          // 쿨다운 뒤 스윕이 다시 요청한다(`requestWork`가 `ready`로 되돌린다). 스스로는 집지 않는다.
          await finish('permission_blocked', { state: 'parked', delayMs: WORK_PARK_MS, reason: 'permission_blocked' });
          break;
        case 'outcome_unknown':
          await retryLater('outcome_unknown', 'outcome_unknown');
          break;
        case 'unprocessable':
          await finish('unprocessable', { state: 'parked', delayMs: WORK_PARK_MS, reason: 'sha_not_in_remote' });
          break;
        default:
          if (row.attempt_count >= MAX_RETRIES) {
            await finish('parked', { state: 'parked', delayMs: WORK_PARK_MS, reason: 'failed_repeatedly' });
          } else {
            await retryLater('failed', 'failed');
          }
      }
    } catch (error) {
      log({ level: 'error', message: '태그 work 처리 실패', work_key: row.work_key, attempt: row.attempt_count, reason: 'work_failed', detail: safeMessage(error).slice(0, 300) });
      await retryLater('exception', 'exception');
    } finally {
      clearInterval(heartbeat);
    }
  }
  return { claimed: claimed.length, outcomes };
}

export interface TagWorkRunner {
  stop(): Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => { setTimeout(resolve, ms); });

/** 기동 직후 한 번, 그 뒤 `pollMs`마다 (기본 1초). 회차가 겹치지 않는다. */
export function startTagWorkRunner(deps: TagDeps, options: TagWorkRunnerOptions = {}): TagWorkRunner {
  const pollMs = options.pollMs ?? 1_000;
  const sleep = deps.sleep ?? defaultSleep;
  const log = logOf(deps);
  let stopped = false;

  const loop = (async (): Promise<void> => {
    while (!stopped) {
      try {
        const result = await runTagWorkOnce(deps, options);
        if (result.claimed > 0 && !stopped) continue;
      } catch (error) {
        log({ level: 'error', message: '태그 work 회차 실패', reason: 'work_round_failed', detail: safeMessage(error).slice(0, 300) });
      }
      if (stopped) break;
      await sleep(pollMs);
    }
  })();

  return {
    async stop(): Promise<void> {
      stopped = true;
      await loop;
    },
  };
}

/* ------------------------------------------------------------------ 잔여 스윕 (backfill) */

export interface TagSweeper {
  stop(): Promise<void>;
}

/**
 * 태그 결과가 없거나 다시 볼 수 있는 행에 `tag` work를 다시 요청한다 (JOB-SEQ-007 스윕).
 *
 * 이것이 **과거 채번분의 backfill**이다 — CR-115 이전에 번호를 받은 행에는 work가 없다. 유실된
 * 이벤트·죽은 프로세스의 복구이기도 하다. 한 회차 상한(`sweepLimit`)만큼만 요청해 첫 스윕이
 * 전체 이력을 한 번에 큐에 넣지 않게 한다 — 나머지는 다음 회차가 잇는다.
 *
 * @returns 이번에 요청한 행 수.
 */
export async function sweepTagTargets(deps: TagDeps, filter: Omit<mergeSequenceRepo.TagSweepFilter, 'limit'> & { readonly limit?: number } = {}): Promise<number> {
  const now = deps.now ?? ((): Date => new Date());
  const targets = await mergeSequenceRepo.listTagSweepTargets(deps.pool, {
    limit: filter.limit ?? deps.config.sweepLimit,
    ...(filter.repositoryId === undefined ? {} : { repositoryId: filter.repositoryId }),
    ...(filter.baseBranch === undefined ? {} : { baseBranch: filter.baseBranch }),
    blockedBefore: filter.blockedBefore ?? new Date(now().getTime() - deps.config.blockCooldownMs),
  });
  if (targets.length === 0) return 0;
  await sequenceWorkRepo.requestWorkBatch(
    deps.pool,
    targets.map((target) => ({
      kind: 'tag' as const,
      repositoryId: target.repository_id,
      baseBranch: target.base_branch,
      seqEpoch: target.seq_epoch,
      keyExtra: [target.pull_request_number],
      payload: {
        pr_number: target.pull_request_number,
        merge_number: target.merge_number,
        merge_seq: target.merge_seq,
        commit_sha: target.commit_sha,
        trigger_kind: 'sweep',
      },
    })),
  );
  return targets.length;
}

/** 기동 뒤 `initialDelayMs` 뒤 한 번, 그 뒤 `intervalMs`마다 스윕한다. */
export function startTagSweeper(deps: TagDeps, intervalMs = deps.config.sweepIntervalMs, initialDelayMs = 30_000): TagSweeper {
  const log = logOf(deps);
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
    let delay = initialDelayMs;
    while (!stopped) {
      await sleep(delay);
      delay = intervalMs;
      if (stopped) break;
      try {
        const requested = await sweepTagTargets(deps);
        if (requested > 0) log({ level: 'info', message: '태그 잔여 스윕이 work를 요청했다', requested });
      } catch (error) {
        log({ level: 'error', message: '태그 잔여 스윕이 실패했다', error: safeMessage(error) });
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
