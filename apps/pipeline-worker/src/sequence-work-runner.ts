/**
 * durable work 러너 (WP-074 / FR-SEQ-008 AC-11, CR-079, ADR-023, DEV-582).
 *
 * ## 무엇을 돌리는가
 *
 * `sequence_work`의 네 종류를 기동 직후와 매초 읽는다.
 *
 * | kind | 하는 일 |
 * | --- | --- |
 * | `refresh` | push 의도 → `prepareAndAssignSequence` (fetch → 채번). M 기능과 무관하게 돈다 |
 * | `reconcile` | M 채번 회차 (`reconcileMergeNumbers`) |
 * | `materialize` | PR 문서 하나에 M 상태 반영 |
 * | `announce` | EVT-SEQ-004 발행 |
 *
 * 뒤 셋은 `MNUMBER_ENABLED=true`일 때만 집는다. 꺼져 있어도 행은 공간·PR당 하나라
 * 쌓이지 않고, 켜는 순간 이어 간다.
 *
 * ## 같은 공간의 M 회차는 하나다
 *
 * claim은 최대 8건이지만 같은 `(저장소, 브랜치)`의 work는 **순서대로** 돈다 (refresh →
 * reconcile → materialize → announce). 공간이 다르면 병렬이다. 채번의 공간 락이
 * 이중 안전장치지만, 러너가 줄을 세우면 락 경합 자체가 줄어든다.
 *
 * ## 재시도 정책 (상세 설계 6.3)
 *
 * 1·2·4·8·16초 뒤 60초 상한(±20% 지터). 5회 실패하면 경보하되 work를 없애지 않는다.
 * 락 경합은 실패로 세지 않고 5초 defer. 권한·기능 미지원은 `parked`(5분 재검사).
 * 미확정 근거는 60초 뒤 다시 본다.
 */

import { sequenceWorkRepo, type Pool, type SequenceWorkKind, type SequenceWorkRow } from '@prs/db';
import { MAX_RETRIES } from '@prs/bus';
import type { WorkerMetrics } from './metrics.js';
import { announceMergeNumbers, materializeMergeNumber, reconcileMergeNumbers, type MergeNumberDeps } from './mnumber.js';
import { prepareAndAssignSequence, type SequenceDeps, type SequenceLogFields } from './sequence.js';

export interface WorkRunnerDeps {
  readonly pool: Pool;
  readonly sequence: SequenceDeps;
  /** M 기능이 꺼져 있으면 `null`. 그때 `refresh`만 집는다. */
  readonly mnumber: MergeNumberDeps | null;
  readonly metrics: WorkerMetrics;
  readonly log?: (fields: SequenceLogFields) => void;
  readonly now?: () => Date;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly random?: () => number;
  readonly pollMs?: number;
  readonly leaseMs?: number;
  readonly claimLimit?: number;
  readonly retryMaxMs?: number;
}

export const WORK_LEASE_MS = 60_000;
export const WORK_HEARTBEAT_MS = 10_000;
export const WORK_CLAIM_LIMIT = 8;
export const WORK_DEFER_MS = 5_000;
export const WORK_PARK_MS = 5 * 60_000;
export const EVIDENCE_PENDING_RETRY_MS = 60_000;

const KIND_ORDER: readonly SequenceWorkKind[] = ['refresh', 'reconcile', 'materialize', 'announce'];

/** 표준 백오프 + 지터. `attempt`는 이번 claim이 몇 번째인지(1부터)다. */
export function retryDelayMs(attempt: number, maxMs: number, random: () => number = Math.random): number {
  const base = Math.min(1_000 * 2 ** Math.max(0, attempt - 1), maxMs);
  const jitter = (random() * 2 - 1) * 0.2 * base;
  return Math.max(0, Math.round(base + jitter));
}

export interface WorkRoundResult {
  readonly claimed: number;
  readonly outcomes: Readonly<Record<string, number>>;
}

function sortByKind(rows: readonly SequenceWorkRow[]): SequenceWorkRow[] {
  return [...rows].sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.created_at.getTime() - b.created_at.getTime());
}

/** 한 회차: 만료 lease 회수 → claim → 공간별 직렬 실행. 시험이 직접 부른다. */
export async function runSequenceWorkOnce(deps: WorkRunnerDeps): Promise<WorkRoundResult> {
  const kinds: SequenceWorkKind[] = deps.mnumber === null ? ['refresh'] : ['refresh', 'reconcile', 'materialize', 'announce'];
  await sequenceWorkRepo.reclaimExpiredLeases(deps.pool);
  const claimed = await sequenceWorkRepo.claimDueWork(deps.pool, {
    kinds,
    limit: deps.claimLimit ?? WORK_CLAIM_LIMIT,
    leaseMs: deps.leaseMs ?? WORK_LEASE_MS,
  });
  const outcomes: Record<string, number> = {};
  const bump = (kind: string, outcome: string): void => {
    const key = `${kind}:${outcome}`;
    outcomes[key] = (outcomes[key] ?? 0) + 1;
    deps.metrics.sequenceWorkTotal.inc({ kind, outcome });
  };

  const bySpace = new Map<string, SequenceWorkRow[]>();
  for (const row of claimed) {
    const key = `${String(row.repository_id)}:${row.base_branch}`;
    bySpace.set(key, [...(bySpace.get(key) ?? []), row]);
  }
  await Promise.all(
    [...bySpace.values()].map(async (rows) => {
      for (const row of sortByKind(rows)) {
        const outcome = await runOne(deps, row);
        bump(row.kind, outcome);
      }
    }),
  );
  return { claimed: claimed.length, outcomes };
}

async function runOne(deps: WorkRunnerDeps, row: SequenceWorkRow): Promise<string> {
  const log = deps.log ?? ((): void => undefined);
  const now = deps.now ?? ((): Date => new Date());
  const lease = { workKey: row.work_key, leaseToken: row.lease_token as string };
  const maxMs = deps.retryMaxMs ?? 60_000;
  const random = deps.random ?? Math.random;

  const heartbeat = setInterval(() => {
    void sequenceWorkRepo.heartbeatWork(deps.pool, lease, deps.leaseMs ?? WORK_LEASE_MS).catch(() => undefined);
  }, WORK_HEARTBEAT_MS);
  heartbeat.unref();

  const finish = async (outcome: string, next: { readonly state: 'done' } | { readonly state: 'retry' | 'parked' | 'obsolete' | 'ready'; readonly delayMs: number; readonly reason: string; readonly resetAttempts?: boolean }): Promise<string> => {
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
      return 'lease_lost';
    }
    return outcome;
  };
  const retryLater = (reason: string, outcome = 'retry'): Promise<string> => {
    if (row.attempt_count >= MAX_RETRIES) {
      log({ level: 'error', message: 'durable work가 반복 실패한다 — 경보 대상이며 work는 유지한다', work_key: row.work_key, kind: row.kind, attempt: row.attempt_count, reason });
    }
    return finish(outcome, { state: 'retry', delayMs: retryDelayMs(row.attempt_count, maxMs, random), reason });
  };

  try {
    switch (row.kind) {
      case 'refresh': {
        const payload = row.payload as { correlation_id?: string };
        const result = await prepareAndAssignSequence(deps.sequence, row.repository_id, row.base_branch, payload.correlation_id ?? '', { leaseToken: row.lease_token });
        if (result.kind === 'done' || result.kind === 'skipped') {
          // `done`은 covered 완료가 이 work도 함께 닫았다. 그래도 lease 기준으로 한 번 더 닫는다 (0행이면 이미 닫힘).
          const applied = await sequenceWorkRepo.completeWork(deps.pool, lease, row.requested_generation);
          void applied;
          return result.kind === 'done' ? result.assign.kind : `skipped:${result.reason}`;
        }
        if (result.kind === 'defer') {
          return finish('defer', { state: 'ready', delayMs: Math.max(0, result.retryAt.getTime() - now().getTime()), reason: result.reason, resetAttempts: true });
        }
        return retryLater(result.reason);
      }
      case 'reconcile': {
        if (deps.mnumber === null) return finish('disabled', { state: 'parked', delayMs: WORK_PARK_MS, reason: 'mnumber_disabled' });
        const trigger = typeof (row.payload as { trigger_kind?: unknown }).trigger_kind === 'string' ? ((row.payload as { trigger_kind: string }).trigger_kind) : 'reconcile';
        // 이 work의 상관 ID를 회차에 넘긴다 — `EVT-SEQ-004`가 그것을 이어 싣는다 (DEV-594).
        const result = await reconcileMergeNumbers(deps.mnumber, row.repository_id, row.base_branch, {
          force: trigger === 'snapshot',
          trigger,
          ...(typeof (row.payload as { correlation_id?: unknown }).correlation_id === 'string'
            ? { correlationId: (row.payload as { correlation_id: string }).correlation_id }
            : {}),
        });
        if (result.kind === 'skipped') return finish(`skipped:${result.reason}`, { state: 'done' });
        if (result.kind === 'locked') return finish('locked', { state: 'ready', delayMs: WORK_DEFER_MS, reason: 'sequence_space_locked', resetAttempts: true });
        if (result.kind === 'retry') {
          /*
           * **진전이 있는 재시도만 즉시 돈다.**
           *
           * `checkpoint_moved`·`epoch_moved`는 남이 값을 옮겼다는 뜻이라 다음 회차가
           * 새 값을 읽고 앞으로 간다 — 즉시 다시 도는 것이 옳다.
           *
           * `space_reassigning`은 다르다. 재채번이 끝나기 전까지 **몇 번을 다시 물어도
           * 같은 답**이고, 지연 0으로 두면 `claimed > 0`이 poll을 건너뛰어 회차마다
           * 다섯 문장이 나가는 바쁜 루프가 된다. 재채번이 수 분이면 그 내내 그렇고,
           * 워커가 `markReassigning` 커밋 뒤 죽으면 상태가 남아 사람이 개입할 때까지
           * 끝나지 않는다. 락 경합과 같은 종류의 기다림이므로 같은 defer를 쓴다.
           */
          const immediate = result.reason !== 'space_reassigning';
          return finish(immediate ? 'retry_immediate' : 'retry_defer', {
            state: 'ready',
            delayMs: immediate ? 0 : WORK_DEFER_MS,
            reason: result.reason,
            resetAttempts: true,
          });
        }
        if (result.continueImmediately) return finish('continue', { state: 'ready', delayMs: 0, reason: 'budget_exhausted', resetAttempts: true });
        if (result.blocked === null) return finish('done', { state: 'done' });
        switch (result.blocked.reason) {
          case 'partial_lookup':
            return finish('partial_lookup', { state: 'ready', delayMs: 0, reason: 'partial_lookup', resetAttempts: true });
          case 'fetch_failed':
            return retryLater('fetch_failed', 'fetch_failed');
          case 'pr_evidence_pending':
          case 'profile_unverified':
            // 60초 뒤 다시 본다. 새 push·스냅숏은 `requestWork`가 available_at을 지금으로 당긴다.
            return finish(`blocked:${result.blocked.reason}`, { state: 'retry', delayMs: EVIDENCE_PENDING_RETRY_MS, reason: result.blocked.reason, resetAttempts: true });
          default:
            // 부재 미확정·프로파일 밖·충돌·정본 불일치·용량 — 새 정보(스냅숏·push·일일 대조)가 와야 풀린다.
            return finish(`blocked:${result.blocked.reason}`, { state: 'done' });
        }
      }
      case 'materialize': {
        if (deps.mnumber === null) return finish('disabled', { state: 'parked', delayMs: WORK_PARK_MS, reason: 'mnumber_disabled' });
        const result = await materializeMergeNumber(deps.mnumber, row);
        if (result === 'done') return finish('done', { state: 'done' });
        if (result === 'obsolete') return finish('obsolete', { state: 'obsolete', delayMs: 0, reason: 'epoch_moved' });
        return retryLater(result, result);
      }
      case 'announce': {
        if (deps.mnumber === null) return finish('disabled', { state: 'parked', delayMs: WORK_PARK_MS, reason: 'mnumber_disabled' });
        const result = await announceMergeNumbers(deps.mnumber, row);
        if (result === 'done') return finish('done', { state: 'done' });
        return finish('obsolete', { state: 'obsolete', delayMs: 0, reason: 'epoch_moved' });
      }
    }
  } catch (error) {
    log({ level: 'error', message: 'durable work 처리 실패', work_key: row.work_key, kind: row.kind, attempt: row.attempt_count, reason: 'work_failed', detail: String(error instanceof Error ? error.message : error).slice(0, 300) });
    return retryLater('exception');
  } finally {
    clearInterval(heartbeat);
  }
}

export interface SequenceWorkRunner {
  stop(): Promise<void>;
  /** 다음 poll을 기다리지 않고 깨운다 (버스 힌트가 부른다). */
  wake(): void;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => { setTimeout(resolve, ms); });

/** 기동 직후 한 번, 그 뒤 `pollMs`마다 (기본 1초). 회차가 겹치지 않는다. */
export function startSequenceWorkRunner(deps: WorkRunnerDeps): SequenceWorkRunner {
  const pollMs = deps.pollMs ?? 1_000;
  const sleep = deps.sleep ?? defaultSleep;
  let stopped = false;
  let wakeResolve: (() => void) | null = null;

  const loop = (async (): Promise<void> => {
    while (!stopped) {
      try {
        const result = await runSequenceWorkOnce(deps);
        if (result.claimed > 0) continue; // 바로 다음 batch — 밀린 것이 있으면 poll을 기다리지 않는다.
      } catch (error) {
        (deps.log ?? ((): void => undefined))({ level: 'error', message: 'durable work 회차 실패', reason: 'work_round_failed', detail: String(error).slice(0, 300) });
      }
      await Promise.race([sleep(pollMs), new Promise<void>((resolve) => { wakeResolve = resolve; })]);
      wakeResolve = null;
    }
  })();

  return {
    async stop(): Promise<void> {
      stopped = true;
      wakeResolve?.();
      await loop;
    },
    wake(): void {
      wakeResolve?.();
    },
  };
}
