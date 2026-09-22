/**
 * 수동 시퀀스 재투영 러너 (JOB-SEQ-006 / CR-113, FR-SEQ-001 AC-8).
 *
 * ## 재투영은 재채번이 아니다
 *
 * `API-ADM-002`·`prsctl sequence reproject`가 만든 `sequence_reproject` 잡을 집어, 그 공간의
 * **현재 에폭 정본**을 색인에 다시 비추는 durable `project(full)` work를 요청하고 그 완료를
 * 기다린다. Git을 읽지 않고, 에폭을 올리지 않고, `merge_seq`·M 번호·head를 바꾸지 않는다.
 * 실제 쓰기는 durable 러너의 같은 경로(`runSpaceProjectionWork`)다 — 이 잡이 두 번째 투영
 * 구현을 갖지 않는다.
 *
 * ## 예약과 완료를 가른다
 *
 * 잡의 `progress`에 work 키·세대·상태·커서·건수를 그대로 비춘다. 잡이 `completed`가 되는 것은
 * 공간 sweep이 끝나고 그 sweep이 넘긴 문서 단위 work까지 모두 끝났을 때뿐이다. 문서가 끝내
 * 만들어지지 않거나(`parked`) 예산 안에 끝나지 않으면 **`failed`**로 적고 남은 건수를 말한다 —
 * "예약했다"를 "복구했다"로 표현하지 않는다. work 자체는 durable하게 남아 계속 돈다.
 *
 * ## 에폭은 운영자가 명시한다
 *
 * force-push 직후 운영자가 모르는 새 에폭에 재투영하지 않도록 `expected_epoch`를 받아 현재
 * 에폭과 대조한다(확인서 CLI와 같은 규율, CR-100). 다르면 실패이며 현재 값을 알려 준다.
 */

import { jobRepo, repositoryRepo, sequenceSpaceRepo, sequenceWorkRepo, type JobRow, type Pool, type SequenceWorkRow } from '@prs/db';
import { parseSequenceSpaceLabel } from '@prs/domain';
import { spaceWorkRequest, type SpaceWorkProgress } from './sequence-projection.js';

export const REPROJECT_JOB = 'sequence_reproject' as const;
/** 수동 요청이라 폴링 빈도가 낮다. */
export const REPROJECT_POLL_INTERVAL_MS = 5_000;
/** work 상태를 잡 진행에 비추는 주기. */
export const REPROJECT_WATCH_MS = 2_000;
/** 잡이 work 완료를 기다리는 상한. 넘으면 `failed`(work는 계속 돈다). */
export const REPROJECT_WAIT_MS = 30 * 60_000;

export const REPROJECT_ALIASES = ['prs-pull-requests', 'prs-commits'] as const;
export type ReprojectAlias = (typeof REPROJECT_ALIASES)[number];

/** 잡 생성 시 `progress`에 실리는 입력. API·CLI가 같은 모양을 쓴다. */
export interface ReprojectJobInput {
  readonly expected_epoch: number;
  readonly aliases: readonly ReprojectAlias[];
}

export function parseReprojectInput(progress: Record<string, unknown>): ReprojectJobInput | null {
  const epoch = progress['expected_epoch'];
  if (typeof epoch !== 'number' || !Number.isInteger(epoch) || epoch < 1) return null;
  const rawAliases = progress['aliases'];
  const aliases = Array.isArray(rawAliases) && rawAliases.length > 0 ? rawAliases : [...REPROJECT_ALIASES];
  if (!aliases.every((one) => (REPROJECT_ALIASES as readonly unknown[]).includes(one))) return null;
  return { expected_epoch: epoch, aliases: aliases as ReprojectAlias[] };
}

export interface ReprojectRunnerLogFields {
  readonly level: 'info' | 'warn' | 'error';
  readonly message: string;
  readonly job_id?: number;
  readonly target?: string;
  readonly outcome?: string;
  readonly reason?: string;
  readonly work_key?: string;
}

export interface ReprojectRunnerDeps {
  readonly pool: Pool;
  readonly log?: (fields: ReprojectRunnerLogFields) => void;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly now?: () => Date;
  readonly waitMs?: number;
  readonly watchMs?: number;
}

export type ProjectionWaitState = 'completed' | 'in_progress' | 'obsolete' | 'timeout' | 'cancelled' | 'missing';

export interface ProjectionWaitResult {
  readonly state: ProjectionWaitState;
  readonly work?: SequenceWorkRow;
  /** 공간 sweep이 넘긴 문서 단위 work 중 아직 끝나지 않은 수. */
  readonly pendingDocuments: number;
  readonly parkedDocuments: number;
}

function summarize(work: SequenceWorkRow | undefined): Record<string, unknown> {
  if (work === undefined) return { work_state: 'missing' };
  const progress = work.progress as SpaceWorkProgress;
  return {
    work_state: work.state,
    requested_generation: work.requested_generation,
    completed_generation: work.completed_generation,
    attempt_count: work.attempt_count,
    last_reason: work.last_reason,
    cursor_seq: progress.cursor_seq ?? 0,
    pages: progress.pages ?? 0,
    counts: progress.counts ?? {},
    ...(progress.completed === undefined ? {} : { completed: progress.completed }),
  };
}

/** 아직 끝나지 않은 문서 단위 work 수. SQL 집계 하나다 — 매 tick 전량 조회를 하지 않는다. */
function docWorkTally(pool: Pool, repositoryId: number, baseBranch: string, seqEpoch: number): Promise<{ readonly pending: number; readonly parked: number }> {
  return sequenceWorkRepo.countPendingProjectDocWork(pool, repositoryId, baseBranch, seqEpoch);
}

/**
 * 공간 sweep work와 그것이 넘긴 문서 단위 work가 끝나기를 기다린다. **락을 잡지 않는다** —
 * 읽기만 하며, 호출 측이 넘긴 `onTick`으로 진행을 비추고 `isCancelled`로 멈춘다.
 */
export async function awaitProjectionWork(
  pool: Pool,
  target: { readonly workKey: string; readonly requiredGeneration: number; readonly repositoryId: number; readonly baseBranch: string; readonly seqEpoch: number },
  options: {
    readonly waitMs: number;
    readonly watchMs: number;
    readonly sleep: (ms: number) => Promise<void>;
    readonly now: () => Date;
    readonly onTick?: (summary: Record<string, unknown>) => Promise<void>;
    readonly isCancelled?: () => Promise<boolean>;
  },
): Promise<ProjectionWaitResult> {
  const deadline = options.now().getTime() + options.waitMs;
  for (;;) {
    const work = await sequenceWorkRepo.findWork(pool, target.workKey);
    const docs = await docWorkTally(pool, target.repositoryId, target.baseBranch, target.seqEpoch);
    if (options.onTick !== undefined) await options.onTick({ ...summarize(work), pending_documents: docs.pending, parked_documents: docs.parked });
    if (work === undefined) return { state: 'missing', pendingDocuments: docs.pending, parkedDocuments: docs.parked };
    if (work.state === 'obsolete') return { state: 'obsolete', work, pendingDocuments: docs.pending, parkedDocuments: docs.parked };
    const sweepDone = work.state === 'done' && work.completed_generation >= target.requiredGeneration;
    if (sweepDone && docs.pending === 0) {
      return { state: 'completed', work, pendingDocuments: 0, parkedDocuments: docs.parked };
    }
    if (options.isCancelled !== undefined && (await options.isCancelled())) {
      return { state: 'cancelled', work, pendingDocuments: docs.pending, parkedDocuments: docs.parked };
    }
    if (options.now().getTime() >= deadline) {
      return { state: 'timeout', work, pendingDocuments: docs.pending, parkedDocuments: docs.parked };
    }
    await options.sleep(options.watchMs);
  }
}

/** 잡 하나를 처리한다. **던지지 않는다** — 실패는 잡 행에 남기고 다음 잡으로 간다. */
export async function runReprojectJob(deps: ReprojectRunnerDeps, job: JobRow): Promise<ProjectionWaitState | 'rejected' | null> {
  const log = deps.log ?? ((): void => undefined);
  const sleep = deps.sleep ?? ((ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms)));
  const now = deps.now ?? ((): Date => new Date());

  const patch = async (fields: Record<string, unknown>): Promise<void> => {
    await deps.pool.query('UPDATE job SET progress = progress || $2::jsonb WHERE job_id = $1', [job.job_id, JSON.stringify(fields)]);
  };
  const finish = async (state: 'completed' | 'failed', error?: string): Promise<void> => {
    const moved = await jobRepo.finishJobIfRunning(deps.pool, job.job_id, state, error ?? null);
    if (moved) return;
    const current = await jobRepo.findJobState(deps.pool, job.job_id);
    log({ level: 'warn', message: '실행 중 잡의 상태가 이미 바뀌어 있어 종료 상태를 덮지 않았다', job_id: job.job_id, target: job.target, outcome: state, reason: current ?? 'missing' });
  };

  const parsed = parseSequenceSpaceLabel(job.target);
  if (parsed === null) {
    await finish('failed', `target 형식이 아니다: ${job.target}`);
    return 'rejected';
  }
  const input = parseReprojectInput(job.progress);
  if (input === null) {
    await finish('failed', 'expected_epoch(양의 정수)와 aliases(prs-pull-requests·prs-commits)가 필요하다');
    return 'rejected';
  }
  const repository = await repositoryRepo.findRepositoryBySlug(deps.pool, parsed.owner, parsed.name);
  if (repository === undefined) {
    await finish('failed', '등록되지 않은 저장소다');
    return 'rejected';
  }
  const space = await sequenceSpaceRepo.findSequenceSpace(deps.pool, repository.repository_id, parsed.baseBranch);
  if (space === undefined) {
    await finish('failed', '채번된 적 없는 시퀀스 공간이다');
    return 'rejected';
  }
  if (space.seq_epoch !== input.expected_epoch) {
    await patch({ current_epoch: space.seq_epoch });
    await finish('failed', `epoch_mismatch: expected=${String(input.expected_epoch)} current=${String(space.seq_epoch)}`);
    return 'rejected';
  }

  const before = await jobRepo.findJobState(deps.pool, job.job_id);
  if (before !== 'running') {
    log({ level: 'warn', message: '시작 전에 취소된 잡이다 — 재투영을 예약하지 않는다', job_id: job.job_id, target: job.target, reason: before ?? 'missing' });
    return null;
  }

  try {
    const work = await sequenceWorkRepo.requestWork(
      deps.pool,
      spaceWorkRequest({ repositoryId: repository.repository_id, baseBranch: parsed.baseBranch, seqEpoch: space.seq_epoch }, 'full', {
        trigger_kind: 'operator_reproject',
        job_id: job.job_id,
        requested_by: job.requested_by,
        aliases: [...input.aliases],
      }),
    );
    await patch({ work_key: work.work_key, requested_generation: work.requested_generation, projection: 'scheduled', ...summarize(work) });
    log({ level: 'info', message: '시퀀스 재투영을 예약했다 — durable work가 정본을 색인에 다시 비춘다', job_id: job.job_id, target: job.target, work_key: work.work_key });

    const waited = await awaitProjectionWork(
      deps.pool,
      { workKey: work.work_key, requiredGeneration: work.requested_generation, repositoryId: repository.repository_id, baseBranch: parsed.baseBranch, seqEpoch: space.seq_epoch },
      {
        waitMs: deps.waitMs ?? REPROJECT_WAIT_MS,
        watchMs: deps.watchMs ?? REPROJECT_WATCH_MS,
        sleep,
        now,
        onTick: async (summary) => {
          await patch({ ...summary, projection: 'running' });
        },
        isCancelled: async () => (await jobRepo.findJobState(deps.pool, job.job_id)) !== 'running',
      },
    );

    switch (waited.state) {
      case 'completed':
        await patch({ projection: 'completed', pending_documents: 0, parked_documents: waited.parkedDocuments });
        if (waited.parkedDocuments > 0) {
          // sweep은 끝났으나 끝내 만들어지지 않은 문서가 있다 — 완료로 닫지 않는다.
          await finish('failed', `projection_partial: ${String(waited.parkedDocuments)} documents still missing in the index (parked)`);
        } else {
          await finish('completed');
        }
        break;
      case 'obsolete':
        await patch({ projection: 'obsolete' });
        await finish('failed', 'epoch_moved: 재투영 중 에폭이 올랐다 — 새 에폭으로 다시 요청한다');
        break;
      case 'cancelled':
        // 취소는 잡의 것이다. work는 durable하게 남아 계속 돈다 — 그 사실을 남긴다.
        await patch({ projection: 'detached', note: 'job cancelled; durable work continues' });
        log({ level: 'warn', message: '재투영 잡이 취소됐다 — durable work는 계속 돈다', job_id: job.job_id, target: job.target, work_key: work.work_key });
        break;
      case 'timeout':
        await patch({ projection: 'in_progress' });
        await finish('failed', `projection_incomplete: sweep ${waited.work?.state ?? 'unknown'}, ${String(waited.pendingDocuments)} documents pending — durable work continues`);
        break;
      default:
        await finish('failed', `projection_${waited.state}`);
    }
    log({ level: 'info', message: '수동 재투영 처리', job_id: job.job_id, target: job.target, outcome: waited.state });
    return waited.state;
  } catch (error) {
    await finish('failed', String(error).slice(0, 500));
    log({ level: 'error', message: '수동 재투영 실패', job_id: job.job_id, target: job.target, reason: String(error).slice(0, 200) });
    return null;
  }
}

export interface ReprojectRunner {
  stop(): Promise<void>;
}

/** 큐를 지켜보며 `sequence_reproject` 잡을 실행한다. 구조는 `startSequenceRepairRunner`와 같다. */
export function startSequenceReprojectRunner(
  deps: ReprojectRunnerDeps,
  options: { readonly intervalMs?: number; readonly maxConcurrent?: number } = {},
): ReprojectRunner {
  const interval = options.intervalMs ?? REPROJECT_POLL_INTERVAL_MS;
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
        for (;;) {
          if (stopped) break;
          const job = await jobRepo.claimNextJob(deps.pool, REPROJECT_JOB, options.maxConcurrent);
          if (job === undefined) break;
          await runReprojectJob(deps, job);
        }
      } catch (error) {
        log({ level: 'error', message: '재투영 러너 회차 실패', reason: String(error).slice(0, 200) });
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
