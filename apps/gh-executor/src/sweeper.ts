/**
 * 고아 회수와 잔여 큐 스윕 (JOB-GH-007, NFR-012 상태 정합성).
 *
 * 둘을 한 주기로 돈다:
 *
 * 1. **고아 회수** — 하트비트가 끊긴 `running`을 `failed(executor_lost)`로. 실행기가
 *    죽으면 그 행은 영원히 `running`으로 남는데, 사용자에게는 「돌고 있다」로 보인다.
 * 2. **잔여 큐** — 이벤트 발행이 실패했거나 유실된 `queued`를 집는다. 이벤트 경로가
 *    유일한 방아쇠이면 발행 한 번의 실패가 실행을 영영 묻는다. 여기서 같은 러너를
 *    같은 claim으로 부르므로 이벤트 경로와 두 번 실행되지 않는다.
 */

import { ghExecutionRepo } from '@prs/db';
import { runExecution, type RunnerDeps } from './runner.js';

export interface Sweeper {
  stop(): Promise<void>;
  /** 시험용. 한 회차를 지금 돈다. */
  runOnce(): Promise<{ readonly reclaimed: number[]; readonly resumed: number[] }>;
}

export function startSweeper(deps: RunnerDeps, intervalMs = deps.config.sweepIntervalMs): Sweeper {
  let stopped = false;
  let inFlight: Promise<unknown> = Promise.resolve();

  const runOnce = async (): Promise<{ readonly reclaimed: number[]; readonly resumed: number[] }> => {
    const now = (deps.now ?? ((): Date => new Date()))();
    const reclaimed = await ghExecutionRepo.reclaimOrphans(deps.pool, new Date(now.getTime() - deps.config.orphanAfterMs));
    for (const id of reclaimed) {
      deps.metrics.executions.inc({ result: 'reclaimed' });
      deps.log({ level: 'warn', message: '하트비트가 끊긴 실행을 failed로 회수했다', execution_id: id, reason: 'executor_lost' });
    }
    const stale = await ghExecutionRepo.listStaleQueued(deps.pool, new Date(now.getTime() - deps.config.queuedStaleMs));
    const resumed: number[] = [];
    for (const id of stale) {
      if (stopped) break;
      const outcome = await runExecution(deps, id);
      if (outcome !== 'missing' && outcome !== 'not_queued') resumed.push(id);
    }
    return { reclaimed, resumed };
  };

  const timer = setInterval(() => {
    if (stopped) return;
    inFlight = inFlight.then(async () => {
      try {
        await runOnce();
      } catch (error) {
        deps.log({ level: 'error', message: '스윕 회차 실패', reason: error instanceof Error ? error.message : String(error) });
      }
    });
  }, intervalMs);
  timer.unref();

  return {
    stop: async () => {
      stopped = true;
      clearInterval(timer);
      await inFlight;
    },
    runOnce,
  };
}
