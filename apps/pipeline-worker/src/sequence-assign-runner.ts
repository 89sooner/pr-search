/**
 * 수동 시퀀스 채번 러너 (JOB-SEQ-001 / WP-040, CR-055).
 *
 * ## 두 번째 채번 실행 구조를 만들지 않는다
 *
 * `API-ADM-002`가 만든 `sequence_assign` 잡 행을 집어 **기존 `assignSequence`를
 * 부른다.** 버스 소비자(`handleSequenceEvent`)와 이 러너가 같은 함수로 모이며,
 * 그 함수는 자기가 어느 문으로 불렸는지 알지 못한다.
 *
 * ## `CR-034`(DEV-180)의 결론을 되돌린 것이 아니다
 *
 * 그 결정은 근거가 둘이었다 — "그 유형을 집는 러너가 없다"와 "영원히 `queued`인
 * 행이 `findActiveJob`에 걸려 이후의 모든 복구를 막는다". 이 파일이 첫 번째
 * 근거를 없애지만 **두 번째는 그대로다**: 조정 스캔의 head 복구는 계속 버스
 * 이벤트로 간다. 그 경로는 공간마다 멱등해야 하고 활성 잡 제약에 걸리면 안 된다.
 *
 * ## 공간의 직렬은 여기서 만들지 않는다
 *
 * `assignSequence`가 시퀀스 공간마다 PostgreSQL advisory lock을 이미 잡는다.
 * 그 락은 프로세스 안이든 밖이든 똑같이 작동하므로 버스 소비자와 이 러너가 같은
 * 프로세스에서 동시에 깨어나도 안전하고, 늦게 온 쪽은 `locked`를 받는다.
 * **`JOB-ING-005`와 달리 루프를 합칠 이유가 없는 것이 그 때문이다.**
 */

import { jobRepo, repositoryRepo, type JobRow, type Pool } from '@prs/db';
import { parseSequenceSpaceLabel } from '@prs/domain';
import { assignSequence, type SequenceDeps } from './sequence.js';
import type { AssignOutcome } from './sequence-plan.js';

export const ASSIGN_JOB = 'sequence_assign' as const;

/** 큐가 비었을 때만 기다린다. */
export const ASSIGN_POLL_INTERVAL_MS = 5_000;

/**
 * 락 경합 재시도 상한.
 *
 * `locked`는 다른 워커가 같은 공간을 쥐고 있다는 뜻이라 곧 풀린다. 그래도
 * 무한히 기다리지 않는 이유는 **잡이 영원히 `running`으로 남으면 그 공간의
 * 다음 요청을 활성 잡 제약이 막기** 때문이다. 상한에 닿으면 실패로 적어
 * 운영자가 다시 실행할 수 있게 한다.
 */
export const ASSIGN_LOCK_RETRIES = 5;
export const ASSIGN_LOCK_RETRY_MS = 2_000;

export interface AssignRunnerLogFields {
  readonly level: 'info' | 'warn' | 'error';
  readonly message: string;
  readonly job_id?: number;
  readonly target?: string;
  readonly outcome?: string;
  readonly reason?: string;
}

export interface AssignRunnerDeps {
  readonly pool: Pool;
  readonly sequence: SequenceDeps;
  readonly log?: (fields: AssignRunnerLogFields) => void;
  readonly sleep?: (ms: number) => Promise<void>;
  /** 시험이 갈아 끼우는 이음매. 기본값이 실제 채번이다. */
  readonly assign?: (
    deps: SequenceDeps,
    repositoryId: number,
    baseBranch: string,
    correlationId: string,
  ) => Promise<AssignOutcome>;
}

/**
 * 채번 결과를 잡의 종료 상태로 옮긴다.
 *
 * **`assignSequence`의 결과를 새로운 뜻으로 재해석하지 않는다.** 각 갈래가
 * 이미 무엇을 뜻하는지 정해져 있고, 여기서는 그것을 "운영자가 다시 눌러야
 * 하는가"로만 옮긴다.
 *
 * - `assigned`·`reassigned`: 일을 했다 → 완료
 * - `no_branch`·`skipped`: 할 일이 없었다 → **완료**. 큐에서 기다리는 사이
 *   브랜치가 사라지거나 저장소가 해제될 수 있고, 그때 실패로 적으면 운영자가
 *   없는 문제를 쫓는다 (`sequence_reassign`의 `consistent`가 같은 자리다)
 * - `stale`: 그래프를 읽지 못했다 → **실패**. 공간은 `stale`로 표시됐고 기존
 *   값은 보존됐지만, 이 실행은 자기 일을 하지 못했다
 * - `locked`·`rewritten`: 아직 끝나지 않았다 → 재시도 대상
 */
export function isRetryable(outcome: AssignOutcome): boolean {
  return outcome.kind === 'locked' || outcome.kind === 'rewritten';
}

export function isFailure(outcome: AssignOutcome): boolean {
  return outcome.kind === 'stale';
}

/**
 * 잡 하나를 처리한다.
 *
 * **던지지 않는다** — 개별 잡 실패로 러너를 죽이면 큐가 다시 멈춘다. 실패는
 * 잡 행에 남기고 다음 잡으로 간다.
 */
export async function runAssignJob(deps: AssignRunnerDeps, job: JobRow): Promise<AssignOutcome | null> {
  const log = deps.log ?? ((): void => undefined);
  const sleep = deps.sleep ?? ((ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms)));

  /**
   * 종료 상태를 **`running`일 때만** 쓴다 (CR-037, DEV-196).
   *
   * 옮기지 못했다는 것은 그 사이 운영자가 취소했다는 뜻이다. 그때 `completed`로
   * 덮으면 취소가 반영되지도 존중되지도 않는다 — 그대로 두고 소리만 낸다.
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

  /*
   * `target`을 `@prs/domain`의 파서로 읽는다. **여기서 다시 만들지 않는다** —
   * 이 형식을 만드는 자리가 `sequenceSpaceLabel` 하나이므로 읽는 자리도 하나여야
   * 하고, 각자 파서를 두면 한쪽만 고쳐지는 날 두 러너가 같은 문자열을 다르게
   * 읽어 **오류 없이 다른 시퀀스 공간을 가리킨다.**
   */
  const parsed = parseSequenceSpaceLabel(job.target);
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
   * 큐에서 기다리는 사이 취소됐다면 **아예 시작하지 않는 것**이 취소를 존중하는
   * 것이다. 이것은 최종 판정이 아니라 창을 좁히는 예비 검사이며, 종료 시점의
   * 조건부 전이가 나머지를 막는다.
   */
  const before = await jobRepo.findJobState(deps.pool, job.job_id);
  if (before !== 'running') {
    log({
      level: 'warn',
      message: '시작 전에 취소된 잡이다 — 채번을 실행하지 않는다',
      job_id: job.job_id,
      target: job.target,
      reason: before ?? 'missing',
    });
    return null;
  }

  const assign = deps.assign ?? assignSequence;
  const correlationId = `job:${String(job.job_id)}`;
  let outcome: AssignOutcome | null = null;

  try {
    for (let attempt = 0; attempt <= ASSIGN_LOCK_RETRIES; attempt += 1) {
      outcome = await assign(deps.sequence, repository.repository_id, parsed.baseBranch, correlationId);
      if (!isRetryable(outcome)) break;
      if (attempt === ASSIGN_LOCK_RETRIES) break;

      /*
       * 다시 시도하기 전에 취소를 확인한다. 락이 오래 잡혀 있는 동안 운영자가
       * 멈췄을 수 있고, 그때 계속 도는 것은 취소를 무시하는 일이다.
       */
      const state = await jobRepo.findJobState(deps.pool, job.job_id);
      if (state !== 'running') {
        log({
          level: 'warn',
          message: '재시도 대기 중 잡이 멈췄다 — 채번을 이어 하지 않는다',
          job_id: job.job_id,
          target: job.target,
          reason: state ?? 'missing',
        });
        return outcome;
      }
      await sleep(ASSIGN_LOCK_RETRY_MS);
    }

    if (outcome === null) {
      await finish('failed', '채번 결과를 얻지 못했다');
      return null;
    }
    if (isRetryable(outcome)) {
      await finish('failed', `${outcome.kind}_retry_exhausted`);
    } else if (isFailure(outcome)) {
      await finish('failed', outcome.kind === 'stale' ? outcome.reason : outcome.kind);
    } else {
      await finish('completed');
    }

    log({
      level: isFailure(outcome) || isRetryable(outcome) ? 'warn' : 'info',
      message: '수동 채번 처리',
      job_id: job.job_id,
      target: job.target,
      outcome: outcome.kind,
    });
    return outcome;
  } catch (error) {
    await finish('failed', String(error).slice(0, 500));
    log({
      level: 'error',
      message: '수동 채번 실패',
      job_id: job.job_id,
      target: job.target,
      reason: String(error).slice(0, 200),
    });
    return null;
  }
}

export interface AssignRunner {
  stop(): Promise<void>;
}

/** 큐를 지켜보며 `sequence_assign` 잡을 실행한다. */
export function startSequenceAssignRunner(
  deps: AssignRunnerDeps,
  options: { readonly intervalMs?: number; readonly maxConcurrent?: number } = {},
): AssignRunner {
  const interval = options.intervalMs ?? ASSIGN_POLL_INTERVAL_MS;
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
          const job = await jobRepo.claimNextJob(deps.pool, ASSIGN_JOB, options.maxConcurrent);
          if (job === undefined) break;
          await runAssignJob(deps, job);
        }
      } catch (error) {
        log({ level: 'error', message: '채번 러너 회차 실패', reason: String(error).slice(0, 200) });
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
