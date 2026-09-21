/**
 * 수동 재채번 러너 (JOB-SEQ-002 수동 경로 / CR-034, DEV-178).
 *
 * ## 왜 필요했나
 *
 * API-ADM-007 POST는 `job.type = 'sequence_reassign'` 행을 `queued`로 만든다.
 * 그런데 **그 유형을 claim하는 곳이 저장소 어디에도 없었다** — 데이터베이스 잡을
 * 집는 것은 백필 러너뿐이다. 그 결과 운영자가 재채번을 요청하면 행만 남고
 * 아무 일도 일어나지 않으며, `job_active_uk` 때문에 **같은 공간의 다음 요청은
 * 전부 `JOB_CONFLICT`로 거절된다.** 고치라고 만든 버튼이 고칠 수 없게 만든다.
 *
 * ## 새 큐 틀을 만들지 않는다
 *
 * `jobRepo.claimNextJob`을 그대로 쓴다 — advisory lock으로 세기와 잡기를 한
 * 트랜잭션에 두는 그 함수가 이미 동시 실행 상한을 강제한다(DEV-102·DEV-107).
 * 시퀀스 공간 충돌은 `repairSequence` 안의 `trySequenceSpaceLock`이 막는다.
 *
 * ## 잡 수명주기를 실제로 반영한다
 *
 * `queued → running → completed | failed`가 행에 남는다. 영구 `queued`를
 * 허용하지 않는 것이 이 러너의 존재 이유다.
 */

import { jobRepo, repositoryRepo } from '@prs/db';
import type { JobRow, Pool, RepositoryRow } from '@prs/db';
import { repairSequence, type RepairOutcome, type SequenceDeps } from './sequence.js';
import { awaitProjectionWork, REPROJECT_WATCH_MS } from './sequence-reproject-runner.js';

/** 큐를 비운 뒤 다음 확인까지. 수동 요청이라 빈도가 낮다. */
export const REPAIR_POLL_INTERVAL_MS = 30_000;
export const REPAIR_JOB = 'sequence_reassign' as const;

export interface RepairRunnerLogFields {
  readonly level: 'info' | 'warn' | 'error';
  readonly message: string;
  readonly job_id?: number;
  readonly target?: string;
  readonly outcome?: string;
  readonly reason?: string;
}

/** `consistent` 뒤 색인 재투영 완료를 기다리는 상한. 넘어도 잡은 `completed`이며 progress가 `in_progress`를 말한다. */
export const REPAIR_PROJECTION_WAIT_MS = 10 * 60_000;

export interface RepairRunnerDeps {
  readonly pool: Pool;
  readonly sequence: SequenceDeps;
  readonly projectionWaitMs?: number;
  readonly projectionWatchMs?: number;
  readonly log?: (fields: RepairRunnerLogFields) => void;
  readonly sleep?: (ms: number) => Promise<void>;
  /** 시험이 갈아 끼우는 이음매. 기본값이 실제 복구다. */
  readonly repair?: (
    deps: SequenceDeps,
    repository: RepositoryRow,
    baseBranch: string,
    correlationId: string,
  ) => Promise<RepairOutcome>;
}

/** `owner/name@branch` → 조각들. API가 그 모양으로 `target`을 만든다. */
export function parseRepairTarget(target: string): { readonly owner: string; readonly name: string; readonly baseBranch: string } | null {
  const at = target.indexOf('@');
  if (at < 0) return null;
  const slug = target.slice(0, at);
  const baseBranch = target.slice(at + 1);
  const slash = slug.indexOf('/');
  if (slash < 0 || baseBranch === '') return null;
  return { owner: slug.slice(0, slash), name: slug.slice(slash + 1), baseBranch };
}

/**
 * 잡 하나를 처리한다.
 *
 * **던지지 않는다** — 개별 잡 실패로 러너를 죽이면 큐가 다시 멈춘다. 실패는
 * 잡 행에 남기고 다음 잡으로 간다.
 */
export async function runRepairJob(deps: RepairRunnerDeps, job: JobRow): Promise<RepairOutcome | null> {
  const log = deps.log ?? ((): void => undefined);

  /**
   * 종료 상태를 **`running`일 때만** 쓴다 (CR-037, DEV-196).
   *
   * 옮기지 못했다는 것은 그 사이 운영자가 취소했다는 뜻이다. 그때 `completed`로
   * 덮으면 취소가 **반영되지도 존중되지도** 않는다 — 그대로 두고 소리만 낸다.
   */
  const finish = async (state: 'completed' | 'failed', error?: string): Promise<void> => {
    const moved = await jobRepo.finishJobIfRunning(deps.pool, job.job_id, state, error ?? null);
    if (moved) return;
    const current = await jobRepo.findJobState(deps.pool, job.job_id);
    log({
      level: 'warn',
      message: '실행 중 잡의 상태가 이미 바뀌어 있어 종료 상태를 덮지 않았다',
      job_id: job.job_id,
      target: job.target,
      outcome: state,
      reason: current ?? 'missing',
    });
  };

  const parsed = parseRepairTarget(job.target);
  if (parsed === null) {
    await finish('failed', `target 형식이 아니다: ${job.target}`);
    return null;
  }

  const repository = await repositoryRepo.findRepositoryBySlug(deps.pool, parsed.owner, parsed.name);
  if (repository === undefined) {
    await finish('failed', '등록되지 않은 저장소다');
    return null;
  }

  /*
   * 비가역 복구를 시작하기 전에 한 번 더 본다. 큐에서 기다리는 사이 취소됐다면
   * **아예 시작하지 않는 것**이 취소를 존중하는 것이다 (CR-037, DEV-196).
   * 이것은 최종 판정이 아니라 창을 좁히는 예비 검사이며, 종료 시점의 조건부
   * 전이가 나머지를 막는다.
   */
  const before = await jobRepo.findJobState(deps.pool, job.job_id);
  if (before !== 'running') {
    log({
      level: 'warn',
      message: '시작 전에 취소된 잡이다 — 복구를 실행하지 않는다',
      job_id: job.job_id,
      target: job.target,
      reason: before ?? 'missing',
    });
    return null;
  }

  const repair = deps.repair ?? repairSequence;
  try {
    const outcome = await repair(deps.sequence, repository, parsed.baseBranch, `job:${String(job.job_id)}`);
    if (outcome.kind === 'consistent') {
      /*
       * `consistent`도 **성공**이다 (CR-034, DEV-182). 큐에서 기다리는 사이 이미
       * 고쳐졌을 수 있고, 그때 실패로 적으면 운영자가 없는 문제를 쫓는다.
       *
       * 그러나 **DB 정합과 색인 복구는 다른 사실이다** (CR-113). `repairSequence`가 남긴
       * durable full sweep을 상한까지 기다려 progress에 `db: consistent` / `projection:
       * completed | in_progress | partial`로 따로 적는다. 락은 잡지 않는다 — 읽기만 한다.
       */
      const patch = async (fields: Record<string, unknown>): Promise<void> => {
        await deps.pool.query('UPDATE job SET progress = progress || $2::jsonb WHERE job_id = $1', [job.job_id, JSON.stringify(fields)]);
      };
      await patch({ db: 'consistent', checked: outcome.checked, projection: 'scheduled', work_key: outcome.projection.work_key, requested_generation: outcome.projection.requested_generation });
      const sleep = deps.sleep ?? ((ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms)));
      const waited = await awaitProjectionWork(
        deps.pool,
        {
          workKey: outcome.projection.work_key,
          requiredGeneration: outcome.projection.requested_generation,
          repositoryId: repository.repository_id,
          baseBranch: parsed.baseBranch,
          seqEpoch: outcome.projection.seq_epoch,
        },
        {
          waitMs: deps.projectionWaitMs ?? REPAIR_PROJECTION_WAIT_MS,
          watchMs: deps.projectionWatchMs ?? REPROJECT_WATCH_MS,
          sleep,
          now: () => new Date(),
          onTick: async (summary) => {
            await patch({ ...summary, projection: 'running' });
          },
          isCancelled: async () => (await jobRepo.findJobState(deps.pool, job.job_id)) !== 'running',
        },
      );
      const projection =
        waited.state === 'completed' ? (waited.parkedDocuments > 0 ? 'partial' : 'completed') : waited.state === 'timeout' ? 'in_progress' : waited.state;
      await patch({ projection, pending_documents: waited.pendingDocuments, parked_documents: waited.parkedDocuments });
      await finish('completed');
    } else if (outcome.kind === 'repaired') {
      await finish('completed');
    } else {
      await finish('failed', outcome.kind);
    }
    log({ level: 'info', message: '수동 재채번 처리', job_id: job.job_id, target: job.target, outcome: outcome.kind });
    return outcome;
  } catch (error) {
    await finish('failed', String(error).slice(0, 500));
    log({ level: 'error', message: '수동 재채번 실패', job_id: job.job_id, target: job.target, reason: String(error).slice(0, 200) });
    return null;
  }
}

export interface RepairRunner {
  stop(): Promise<void>;
}

/** 큐를 지켜보며 `sequence_reassign` 잡을 실행한다. */
export function startSequenceRepairRunner(
  deps: RepairRunnerDeps,
  options: { readonly intervalMs?: number; readonly maxConcurrent?: number } = {},
): RepairRunner {
  const interval = options.intervalMs ?? REPAIR_POLL_INTERVAL_MS;
  const log = deps.log ?? ((): void => undefined);
  let stopped = false;

  let wake: () => void = () => undefined;
  const interruptibleSleep = (ms: number): Promise<void> =>
    new Promise((resolve) => {
      const timer = setTimeout(() => {
        wake = () => undefined;
        resolve();
      }, ms);
      wake = (): void => {
        clearTimeout(timer);
        wake = () => undefined;
        resolve();
      };
    });
  const sleep = deps.sleep ?? interruptibleSleep;

  const loop = (async (): Promise<void> => {
    while (!stopped) {
      try {
        // 큐가 빌 때까지 이어서 처리한다 — 한 회차에 하나만 하면 밀린다.
        for (;;) {
          if (stopped) break;
          const job = await jobRepo.claimNextJob(deps.pool, REPAIR_JOB, options.maxConcurrent);
          if (job === undefined) break;
          await runRepairJob(deps, job);
        }
      } catch (error) {
        log({ level: 'error', message: '재채번 러너 회차 실패', reason: String(error).slice(0, 200) });
      }
      if (stopped) break;
      await sleep(interval);
    }
  })();

  return {
    async stop(): Promise<void> {
      stopped = true;
      wake();
      await loop;
    },
  };
}
