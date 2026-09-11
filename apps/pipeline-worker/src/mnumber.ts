/**
 * JOB-SEQ-004 M 번호 채번 (WP-074 / FR-SEQ-008, CR-077 · CR-079, ADR-023).
 *
 * ## 한 회차의 순서
 *
 *   공간·checkpoint 읽기 → (에폭이 올랐으면 색인의 옛 번호 정리) → checkpoint 다음 batch
 *   → **트랜잭션 밖에서** 근거 조회(GHE·스냅숏) → BEGIN → 공간 xact 락 → 에폭·checkpoint
 *   재검증 → 근거 저장 → 순수 planner → 번호·checkpoint·blocker → materialize/announce
 *   work → COMMIT → 지표·표본
 *
 * 외부 I/O(GHE·ES·Redis)는 트랜잭션 안에 없다. 번호·checkpoint·전달 의도는 **같은
 * 트랜잭션**이다 (AC-11) — 하나라도 실패하면 셋 다 없다.
 *
 * ## 이 워커가 정하지 않는 것
 *
 * 직접 푸시의 부재 확정. production은 `direct_confirmed`를 만들지 않으며 (DEV-581),
 * 그 결과 첫 미확정 항목 뒤의 PR이 전부 `pending`으로 남을 수 있다. 그 사실을 감추지
 * 않고 `mnumber_blocked_total{reason}`과 공간 blocker로 드러낸다.
 */

import { randomUUID } from 'node:crypto';
import type { Client } from '@elastic/elasticsearch';
import { EVENT_NAMES, deterministicEventId, sequencePartitionKey, type MergeNumberAssigned } from '@prs/domain';
import { TOPICS, type EventBus } from '@prs/bus';
import {
  mergeSequenceRepo,
  mnumberEvidenceRepo,
  repositoryRepo,
  sequenceLatencyRepo,
  sequenceSpaceRepo,
  sequenceWorkRepo,
  trySequenceSpaceLock,
  withReindexWrite,
  type EvidenceRow,
  type Pool,
  type RepositoryRow,
  type SequenceWorkRow,
} from '@prs/db';
import { applyMergeNumberToDocument, clearMergeNumbersBelowEpoch, readMergeNumberProjectionInternal } from '@prs/es';
import type { MergeNumberBlockReason } from '@prs/domain';
import type { WorkerMetrics } from './metrics.js';
import { resolveEvidence, type EvidenceDecision, type EvidenceDeps } from './mnumber-evidence.js';
import { planMergeNumbers, type PlanRow } from './mnumber-plan.js';
import type { MergeNumberConfig } from './mnumber-config.js';

export interface MergeNumberLogFields {
  readonly level: 'info' | 'warn' | 'error';
  readonly message: string;
  readonly [key: string]: unknown;
}

export interface MergeNumberDeps {
  readonly pool: Pool;
  readonly es: Client;
  readonly bus: EventBus;
  readonly metrics: WorkerMetrics;
  readonly config: MergeNumberConfig;
  readonly evidence: EvidenceDeps;
  readonly log?: (fields: MergeNumberLogFields) => void;
  readonly now?: () => Date;
}

/** 한 회차의 처리 예산 (planner·DB, 외부 I/O 제외). 소진은 완료가 아니라 다음 회차다. */
export const RECONCILE_BUDGET_MS = 1_000;

export type ReconcileOutcome =
  | {
      readonly kind: 'done';
      readonly epoch: number;
      readonly assigned: number;
      readonly blocked: { readonly seq: number; readonly reason: MergeNumberBlockReason } | null;
      /** batch를 다 보기 전에 예산이 끝났다. 곧바로 다음 회차다. */
      readonly continueImmediately: boolean;
    }
  | { readonly kind: 'skipped'; readonly reason: string }
  /** 다른 워커가 공간을 쥐고 있다. 5초 뒤. */
  | { readonly kind: 'locked' }
  /** 락 사이에 에폭·checkpoint가 움직였다. 곧바로 다시. */
  | { readonly kind: 'retry'; readonly reason: string };

/** 에폭 상향 뒤 색인 정리를 이미 한 공간. 프로세스 수명이며 재기동 시 한 번 더 도는 것이 안전하다. */
const clearedEpochBySpace = new Map<string, number>();

function spaceKey(repositoryId: number, baseBranch: string): string {
  return `${String(repositoryId)}:${baseBranch}`;
}

function toPlanRow(
  row: { readonly merge_seq: number; readonly commit_sha: string; readonly pull_request_number: number | null; readonly merge_number: number | null },
  decision: EvidenceDecision | undefined,
): PlanRow {
  const common = {
    mergeSeq: row.merge_seq,
    sha: row.commit_sha,
    existingNumber: row.merge_number,
    existingPr: row.pull_request_number,
  };
  if (decision === undefined) {
    return { ...common, decision: 'unresolved', prNumber: null, reason: 'pr_evidence_pending', mergedAt: null };
  }
  if (decision.kind === 'pr_confirmed') {
    return { ...common, decision: 'pr_confirmed', prNumber: decision.prNumber, reason: null, mergedAt: decision.mergedAt };
  }
  if (decision.kind === 'direct_confirmed') {
    return { ...common, decision: 'direct_confirmed', prNumber: null, reason: null, mergedAt: null };
  }
  return { ...common, decision: 'unresolved', prNumber: null, reason: decision.reason, mergedAt: null };
}

/**
 * 한 시퀀스 공간의 M 채번 회차.
 *
 * @param options.force 미확정 근거의 재조회 간격을 무시한다 (스냅숏 도착 등).
 */
export async function reconcileMergeNumbers(
  deps: MergeNumberDeps,
  repositoryId: number,
  baseBranch: string,
  options: {
    readonly force?: boolean;
    readonly trigger?: string;
    /**
     * 이 회차를 유발한 요청의 상관 ID (`DEV-594`).
     *
     * `EVT-SEQ-004`가 그것을 실어 추적이 채번에서 끊기지 않게 한다. 없으면 이 회차의
     * 새 ID를 만든다 — 빈 문자열을 싣는 것보다 낫다. 조정 스윕처럼 유발 요청이 없는
     * 경로가 그쪽이다.
     */
    readonly correlationId?: string;
  } = {},
): Promise<ReconcileOutcome> {
  const log = deps.log ?? ((): void => undefined);
  const now = deps.now ?? ((): Date => new Date());
  const correlationId = options.correlationId ?? randomUUID();

  const repository = await repositoryRepo.findRepositoryById(deps.pool, repositoryId);
  if (repository === undefined) return { kind: 'skipped', reason: 'repository_unregistered' };
  if (repository.status !== 'active') return { kind: 'skipped', reason: 'repository_archived' };
  if (!repository.sequence_branches.includes(baseBranch)) return { kind: 'skipped', reason: 'not_sequence_branch' };

  const space = await sequenceSpaceRepo.findSequenceSpace(deps.pool, repositoryId, baseBranch);
  if (space === undefined) return { kind: 'skipped', reason: 'sequence_space_missing' };
  if (space.state === 'reassigning') return { kind: 'retry', reason: 'space_reassigning' };
  const epoch = space.seq_epoch;

  /*
   * 에폭이 올랐으면 색인의 옛 번호부터 지운다 (ADR-007 규칙 5). 멱등이라 재기동 뒤 한 번
   * 더 돌아도 안전하고, 실패하면 다음 회차가 다시 시도한다 — 정본은 이미 새 에폭이다.
   */
  const key = spaceKey(repositoryId, baseBranch);
  if ((clearedEpochBySpace.get(key) ?? 0) < epoch) {
    try {
      await withReindexWrite(deps.pool, (targets) =>
        clearMergeNumbersBelowEpoch(deps.es, { repositoryId, baseBranch, newEpoch: epoch }, targets),
      );
      clearedEpochBySpace.set(key, epoch);
    } catch (error) {
      log({ level: 'warn', message: '옛 에폭의 색인 M 번호 정리 실패 — 다음 회차가 다시 시도한다', repository_id: repositoryId, reason: 'mnumber_epoch_clear_failed', detail: String(error).slice(0, 200) });
    }
  }

  const checkpoint = { headSeq: Number(space.mnumber_head_seq), headNumber: Number(space.mnumber_head) };
  const rows = await mergeSequenceRepo.listCandidatesAfter(deps.pool, repositoryId, baseBranch, epoch, checkpoint.headSeq, deps.config.batchSize);
  if (rows.length === 0) {
    // 확인할 행이 없다. blocker가 남아 있다면 그것은 지난 회차의 사실 그대로다.
    return { kind: 'done', epoch, assigned: 0, blocked: space.mnumber_blocked_seq === null ? null : { seq: Number(space.mnumber_blocked_seq), reason: space.mnumber_blocked_reason as MergeNumberBlockReason }, continueImmediately: false };
  }

  // ---- 트랜잭션 밖: 근거 조회. 첫 미확정에서 멈춘다 — 그 뒤는 어차피 이번 회차에 번호를 받지 못한다.
  const existing = await mnumberEvidenceRepo.listEvidence(deps.pool, repositoryId, baseBranch, epoch, rows.map((row) => row.merge_seq));
  const decisions = new Map<number, EvidenceDecision>();
  for (const row of rows) {
    const decision = await resolveEvidence(
      deps.evidence,
      {
        repository,
        baseBranch,
        seqEpoch: epoch,
        mergeSeq: row.merge_seq,
        commitSha: row.commit_sha,
        candidateHint: row.pull_request_number,
        existing: existing.get(row.merge_seq),
      },
      { ...(options.force === undefined ? {} : { force: options.force }) },
    );
    decisions.set(row.merge_seq, decision);
    if (decision.kind === 'unresolved') break;
  }

  // ---- 트랜잭션: 락 → 재검증 → 근거 저장 → planner → 번호·checkpoint·work.
  const client = await deps.pool.connect();
  let committed: { readonly assignments: readonly { mergeSeq: number; prNumber: number; mergeNumber: number; sha: string; mergedAt: Date | null }[]; readonly blocked: ReconcileOutcome & { kind: 'done' } } | null = null;
  try {
    await client.query('BEGIN');
    if (!(await trySequenceSpaceLock(client, repositoryId, baseBranch))) {
      await client.query('ROLLBACK');
      return { kind: 'locked' };
    }
    const current = await sequenceSpaceRepo.findSequenceSpace(client, repositoryId, baseBranch);
    if (current === undefined || current.seq_epoch !== epoch || Number(current.mnumber_head_seq) !== checkpoint.headSeq) {
      await client.query('ROLLBACK');
      return { kind: 'retry', reason: 'checkpoint_moved' };
    }

    /*
     * 근거 저장. **확정 뒤 다른 확정은 덮지 않는다** — 그 행은 `mapping_conflict`로 판정을
     * 바꾸고 blocker로 남긴다. 조용히 바꾸면 이미 부여된 번호가 다른 PR을 가리킨다.
     */
    for (const row of rows) {
      const decision = decisions.get(row.merge_seq);
      if (decision === undefined) break;
      const prior: EvidenceRow | undefined = existing.get(row.merge_seq);
      if (decision.kind === 'pr_confirmed' && prior?.state === 'pr_confirmed' && prior.pr_number !== decision.prNumber) {
        log({ level: 'error', message: '확정된 PR 근거와 다른 확정이 왔다 — 번호를 옮기지 않고 충돌로 멈춘다', repository_id: repositoryId, base_branch: baseBranch, merge_seq: row.merge_seq, prior_pr: prior.pr_number, new_pr: decision.prNumber, reason: 'mapping_conflict' });
        decisions.set(row.merge_seq, {
          kind: 'unresolved',
          reason: 'mapping_conflict',
          upsert: { ...decision.upsert, state: 'unresolved', prNumber: null, reason: 'mapping_conflict', sourceKind: 'unresolved_lookup', mergedAt: null },
        });
        // 기존 확정 근거는 그대로 둔다. 충돌 사실은 blocker와 로그에 남는다.
        break;
      }
      if (decision.upsert !== null) await mnumberEvidenceRepo.upsertEvidence(client, decision.upsert);
      if (decision.kind === 'unresolved') break;
    }

    const planRows: PlanRow[] = rows.map((row) => toPlanRow(row, decisions.get(row.merge_seq)));
    const candidatePrs = planRows.map((row) => row.prNumber).filter((n): n is number => n !== null);
    const alreadyNumbered = await mergeSequenceRepo.listNumberedPullRequests(client, repositoryId, baseBranch, epoch, candidatePrs);
    const previousMergedAt = await mnumberEvidenceRepo.findLastConfirmedMergedAt(client, repositoryId, baseBranch, epoch, checkpoint.headSeq);

    const plan = planMergeNumbers({
      checkpoint,
      rows: planRows,
      previousAssignedMergedAt: previousMergedAt,
      isAlreadyNumbered: (pr) => alreadyNumbered.has(pr),
      budgetMs: RECONCILE_BUDGET_MS,
    });

    const written = await mergeSequenceRepo.assignMergeNumbers(client, repositoryId, baseBranch, epoch, plan.assignments);
    if (written !== plan.assignments.length) {
      /*
       * 정본이 planner의 전제와 다르다 (다른 PR·다른 번호가 이미 있다). 번호를 쓰지 않고
       * 롤백한 뒤 **별도 짧은 트랜잭션**에서 blocker만 남긴다.
       */
      await client.query('ROLLBACK');
      const firstSeq = plan.assignments[0]?.mergeSeq ?? checkpoint.headSeq + 1;
      await sequenceSpaceRepo.advanceMergeNumberCheckpoint(deps.pool, repositoryId, baseBranch, epoch, {
        headSeq: checkpoint.headSeq,
        headNumber: checkpoint.headNumber,
        blocked: { seq: firstSeq, reason: 'canonical_mismatch' },
      });
      deps.metrics.mnumberBlockedTotal.inc({ reason: 'canonical_mismatch' });
      log({ level: 'error', message: 'M 번호 쓰기 행 수가 planner와 다르다 — 정본 불일치로 멈춘다', repository_id: repositoryId, base_branch: baseBranch, expected: plan.assignments.length, written, reason: 'canonical_mismatch' });
      return { kind: 'done', epoch, assigned: 0, blocked: { seq: firstSeq, reason: 'canonical_mismatch' }, continueImmediately: false };
    }

    const advanced = await sequenceSpaceRepo.advanceMergeNumberCheckpoint(client, repositoryId, baseBranch, epoch, {
      headSeq: plan.nextHeadSeq,
      headNumber: plan.nextHeadNumber,
      blocked: plan.blocked,
    });
    if (!advanced) {
      await client.query('ROLLBACK');
      return { kind: 'retry', reason: 'epoch_moved' };
    }

    for (const assignment of plan.assignments) {
      await sequenceWorkRepo.requestWork(client, {
        kind: 'materialize',
        repositoryId,
        baseBranch,
        seqEpoch: epoch,
        keyExtra: [assignment.prNumber],
        payload: { pr_number: assignment.prNumber, merge_number: assignment.mergeNumber, merge_seq: assignment.mergeSeq },
      });
    }
    if (plan.assignments.length > 0) {
      const first = plan.assignments[0] as (typeof plan.assignments)[number];
      const last = plan.assignments[plan.assignments.length - 1] as (typeof plan.assignments)[number];
      const payload: MergeNumberAssigned = {
        repository_id: repositoryId,
        base_branch: baseBranch,
        seq_epoch: epoch,
        from_mnumber: first.mergeNumber,
        to_mnumber: last.mergeNumber,
        pull_request_numbers: plan.assignments.map((one) => one.prNumber),
      };
      /*
       * **채번 회차의 상관 ID를 work에 함께 남긴다** (DEV-594).
       *
       * 발행은 다른 프로세스가 나중에 하므로, 여기서 남기지 않으면 그쪽이 복원할
       * 수단이 없어 `EVT-SEQ-004`만 상관 ID 없이 나간다 — 한 push의 추적이 채번
       * 직전에서 끊긴다. `sequence.assigned`는 이미 싣고 있다.
       */
      const announcePayload = { ...payload, correlation_id: correlationId } as unknown as Record<string, unknown>;
      await sequenceWorkRepo.requestWork(client, {
        kind: 'announce',
        repositoryId,
        baseBranch,
        seqEpoch: epoch,
        keyExtra: [first.mergeNumber, last.mergeNumber],
        payload: announcePayload,
      });
    }
    await client.query('COMMIT');

    const bySeq = new Map(rows.map((row) => [row.merge_seq, row]));
    committed = {
      assignments: plan.assignments.map((one) => ({ ...one, sha: bySeq.get(one.mergeSeq)?.commit_sha ?? '' })),
      blocked: { kind: 'done', epoch, assigned: plan.assignments.length, blocked: plan.blocked, continueImmediately: plan.budgetExhausted && plan.blocked === null },
    };
    if (plan.orderMismatches > 0) deps.metrics.mnumberOrderMismatchTotal.inc({ repository: String(repositoryId) }, plan.orderMismatches);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }

  // ---- 커밋 뒤: 지표와 표본. 실패해도 번호는 이미 정본이다.
  const outcome = committed.blocked;
  if (outcome.assigned > 0) deps.metrics.mnumberAssignedTotal.inc({ repository: String(repositoryId) }, outcome.assigned);
  if (outcome.blocked !== null) deps.metrics.mnumberBlockedTotal.inc({ reason: outcome.blocked.reason });
  await recordAssignmentSamples(deps, repository, baseBranch, epoch, committed.assignments, options.trigger ?? 'reconcile');
  log({
    level: 'info',
    message: 'M 채번 회차 완료',
    repository_id: repositoryId,
    base_branch: baseBranch,
    seq_epoch: epoch,
    assigned: outcome.assigned,
    ...(outcome.blocked === null ? {} : { blocked_seq: outcome.blocked.seq, blocked_reason: outcome.blocked.reason }),
  });
  void now;
  return outcome;
}

/** PR 단위 표본 (상세 설계 6.4). 원인 push 연결이 증명될 때만 `received_at`을 채운다. */
async function recordAssignmentSamples(
  deps: MergeNumberDeps,
  repository: RepositoryRow,
  baseBranch: string,
  epoch: number,
  assignments: readonly { mergeSeq: number; prNumber: number; mergeNumber: number; sha: string }[],
  trigger: string,
): Promise<void> {
  for (const one of assignments) {
    try {
      const refresh = one.sha === '' ? undefined : await sequenceWorkRepo.findRefreshWorkByHead(deps.pool, repository.repository_id, baseBranch, one.sha);
      const payload = refresh?.payload as { delivery_id?: string; received_at?: string } | undefined;
      const rowAssignedAt = await deps.pool.query<{ assigned_at: Date }>(
        'SELECT assigned_at FROM merge_sequence WHERE repository_id = $1 AND base_branch = $2 AND seq_epoch = $3 AND merge_seq = $4',
        [repository.repository_id, baseBranch, epoch, one.mergeSeq],
      );
      const workKey = refresh?.work_key ?? sequenceWorkRepo.spaceWorkKey('reconcile', repository.repository_id, baseBranch, epoch);

      /*
       * **push 표본을 이어받는다** (DEV-593). 수신 시점에는 PR을 몰라 `pr_number`가
       * 비어 있다. 새 행을 만들면 한 요청이 두 행이 되어 push 행이 영영 `pending`으로
       * 집계되고 같은 push가 두 번 세어진다.
       */
      await sequenceLatencyRepo.promotePushSample(deps.pool, {
        workKey,
        attempt: 1,
        seqEpoch: epoch,
        prNumber: one.prNumber,
      });

      await sequenceLatencyRepo.upsertSample(deps.pool, {
        workKey,
        attempt: 1,
        repositoryId: repository.repository_id,
        baseBranch,
        seqEpoch: epoch,
        prNumber: one.prNumber,
        deliveryId: payload?.delivery_id ?? null,
        triggerKind: trigger === 'sequence_reassigned' ? 'reassign' : payload === undefined ? 'backfill' : 'new_squash',
        outcome: 'assigned',
        receivedAt: typeof payload?.received_at === 'string' ? new Date(payload.received_at) : null,
        attemptStartedAt: null,
        sequenceAssignedAt: rowAssignedAt.rows[0]?.assigned_at ?? null,
        mnumberAssignedNow: true,
        reason: null,
      });
    } catch {
      deps.metrics.measurementMissing.inc({ stage: 'mnumber' });
    }
  }
}

export type MaterializeOutcome = 'done' | 'obsolete' | 'retry' | 'document_missing';

/**
 * PR 문서 하나에 현재 정본의 M 상태를 비춘다 (`materialize` work).
 *
 * payload의 옛 값을 쓰지 않는다 — **현재 정본을 다시 읽는다** (상세 설계 8절). 에폭이
 * 올랐으면 이 work는 무효이고, 새 에폭의 회차가 새 work를 만든다.
 */
export async function materializeMergeNumber(
  deps: MergeNumberDeps,
  work: Pick<SequenceWorkRow, 'repository_id' | 'base_branch' | 'seq_epoch' | 'payload'>,
): Promise<MaterializeOutcome> {
  const prNumber = Number((work.payload as { pr_number?: unknown }).pr_number);
  if (!Number.isInteger(prNumber) || prNumber < 1) return 'obsolete';
  const space = await sequenceSpaceRepo.findSequenceSpace(deps.pool, work.repository_id, work.base_branch);
  if (space === undefined || space.seq_epoch !== work.seq_epoch) return 'obsolete';

  const lookup = await mergeSequenceRepo.lookupMergeNumbers(deps.pool, [
    { repositoryId: work.repository_id, baseBranch: work.base_branch, prNumber },
  ]);
  const row = lookup.rows[0];
  if (row === undefined) return 'done';

  const outcome = await withReindexWrite(deps.pool, (targets) =>
    applyMergeNumberToDocument(
      deps.es,
      {
        repositoryId: work.repository_id,
        prNumber,
        baseBranch: work.base_branch,
        expectedMergeCommitSha: row.commit_sha,
        mergeNumber: row.merge_number,
        mergeNumberEpoch: space.seq_epoch,
        state: row.merge_number === null ? 'pending' : 'assigned',
        reason: null,
      },
      targets,
    ),
  );
  if (outcome === 'updated' || outcome === 'noop') return 'done';
  if (outcome === 'document_missing') return 'document_missing';
  (deps.log ?? ((): void => undefined))({ level: 'warn', message: 'PR 문서의 저장소·브랜치·머지 커밋이 정본과 달라 M 값을 쓰지 않았다 — 투영이 따라잡은 뒤 다시 본다', repository_id: work.repository_id, pr_number: prNumber, reason: 'mnumber_guard_rejected' });
  return 'retry';
}

/** EVT-SEQ-004 발행 (`announce` work). 이벤트 ID는 work 키로 결정론 생성한다. */
export async function announceMergeNumbers(
  deps: MergeNumberDeps,
  work: Pick<SequenceWorkRow, 'work_key' | 'repository_id' | 'base_branch' | 'seq_epoch' | 'payload'>,
): Promise<'done' | 'obsolete'> {
  const space = await sequenceSpaceRepo.findSequenceSpace(deps.pool, work.repository_id, work.base_branch);
  if (space === undefined || space.seq_epoch !== work.seq_epoch) return 'obsolete';
  /*
   * **상관 ID는 봉투에만 싣는다** (DEV-604).
   *
   * work에는 그 값을 남겨야 발행 시점에 복원할 수 있지만(DEV-594), payload는
   * `EVT-SEQ-004`가 정한 여섯 필드 그대로여야 한다. 봉투에 이미 있는 값을 payload에
   * 또 넣으면 타입이 말하는 것과 실제로 나가는 것이 달라지고, 소비자는 계약에 없는
   * 키를 보게 된다.
   */
  const { correlation_id: workCorrelationId, ...rest } = work.payload as { correlation_id?: unknown };
  const payload = rest as unknown as MergeNumberAssigned;
  await deps.bus.publish(TOPICS.projected, sequencePartitionKey(work.repository_id, work.base_branch), {
    event_id: deterministicEventId(EVENT_NAMES.mergeNumberAssigned, work.work_key),
    event_name: EVENT_NAMES.mergeNumberAssigned,
    // work가 채번 회차의 상관 ID를 실어 왔으면 그것을 잇는다 (DEV-594).
    correlation_id: typeof workCorrelationId === 'string' ? workCorrelationId : '',
    occurred_at: (deps.now ?? ((): Date => new Date()))().toISOString(),
    payload,
  });
  return 'done';
}

/** 관측 시한 (상세 설계 7절). 넘기면 사유를 남기고 느린 재시도로 옮긴다. */
export const OBSERVE_TIMEOUT_MS = 120_000;
export const OBSERVE_SLOW_RETRY_MS = 60_000;
export const OBSERVE_POLL_MS = 2_000;

/**
 * 번호가 붙은 표본이 **실제 검색**에서 보이는지 확인한다 (상세 설계 7절의 observer).
 *
 * ES bulk ACK는 가시성이 아니다. `_search` hit의 번호·에폭·SHA가 정본과 같을 때만
 * 관측 시각을 남긴다. 실패는 번호를 되돌리지 않는다.
 */
export async function observeMergeNumberSamples(deps: MergeNumberDeps, limit = 100): Promise<number> {
  const now = deps.now ?? ((): Date => new Date());
  const samples = await sequenceLatencyRepo.listUnobservedAssigned(deps.pool, limit);
  let observed = 0;

  /*
   * **정본은 한 번에 묻는다** (DEV-610).
   *
   * 표본마다 물으면 기본 한도 100에서 왕복이 100번이고, 그것이 2초마다 돈다.
   * `lookupMergeNumbers`는 이미 튜플 목록을 받으므로 묶는 비용이 없다 — 목록·상세가
   * 페이지를 한 번에 묻는 것과 같은 규율이다 (ADR-023 C5).
   *
   * ES는 묶지 않는다. 문서마다 조회가 필요하고, 여기서 보려는 것이 **실제 검색
   * hit**이라 그 한 번을 줄이면 관측의 뜻이 달라진다.
   */
  const tuples = samples
    .filter((one) => one.pr_number !== null)
    .map((one) => ({ repositoryId: one.repository_id, baseBranch: one.base_branch, prNumber: one.pr_number as number }));
  let canonical: Awaited<ReturnType<typeof mergeSequenceRepo.lookupMergeNumbers>>['rows'] = [];
  try {
    canonical = (await mergeSequenceRepo.lookupMergeNumbers(deps.pool, tuples)).rows;
  } catch {
    // 정본을 읽지 못했다. 이번 회차는 아무것도 관측하지 않고 다음 회차가 다시 본다.
    deps.metrics.measurementMissing.inc({ stage: 'observe' });
    return 0;
  }
  /*
   * **번호를 가진 행이 이긴다** (DEV-611).
   *
   * 한 PR에 정본 행이 둘일 수 있다 — 같은 PR의 이중 squash SHA다(설계 3절). 그때
   * `lookupMergeNumbers`는 `merge_seq` 순서로 **둘 다** 돌려주므로, 그냥 `Map`에
   * 넣으면 나중 행이 앞 행을 덮는다. 번호 있는 행이 앞이고 충돌 행이 뒤면 관측이
   * 번호 없는 쪽을 보고 **영영 `visible`이 되지 않는다.**
   *
   * `merge-number-view.ts`의 `preferRow`가 API 쪽에서 세운 것과 같은 규칙이다
   * (`DEV-601`). 같은 정본을 읽는 두 곳이 다른 행을 고르면 안 된다.
   */
  const expectedOf = new Map<string, (typeof canonical)[number]>();
  for (const row of canonical) {
    const key = `${String(row.repository_id)}\u0000${row.base_branch}\u0000${String(row.pull_request_number)}`;
    const held = expectedOf.get(key);
    if (held === undefined || (row.merge_number !== null && held.merge_number === null)) {
      expectedOf.set(key, row);
    }
  }

  for (const sample of samples) {
    if (sample.pr_number === null) continue;
    const age = now().getTime() - sample.created_at.getTime();
    if (age > OBSERVE_TIMEOUT_MS) {
      const lastAbsent = sample.last_search_absent_at?.getTime() ?? 0;
      if (now().getTime() - lastAbsent < OBSERVE_SLOW_RETRY_MS) continue;
      if (sample.reason === null) await sequenceLatencyRepo.markObservationTimedOut(deps.pool, sample.sample_id, 'observation_timeout');
    }
    try {
      const expected = expectedOf.get(`${String(sample.repository_id)}\u0000${sample.base_branch}\u0000${String(sample.pr_number)}`);
      const projection = await readMergeNumberProjectionInternal(deps.es, sample.repository_id, sample.pr_number);
      const visible =
        expected !== undefined &&
        expected.merge_number !== null &&
        projection !== null &&
        projection.merge_number === expected.merge_number &&
        projection.merge_number_epoch === expected.seq_epoch &&
        (projection.merge_commit_sha ?? '').toLowerCase() === expected.commit_sha.toLowerCase();
      if (visible) {
        await sequenceLatencyRepo.markObserved(deps.pool, sample.sample_id, { indexUuid: projection.index, pollIntervalMs: OBSERVE_POLL_MS });
        observed += 1;
      } else {
        await sequenceLatencyRepo.markAbsent(deps.pool, sample.sample_id, OBSERVE_POLL_MS);
      }
    } catch {
      deps.metrics.measurementMissing.inc({ stage: 'observe' });
    }
  }
  return observed;
}
