/**
 * 실행기 지표 (NFR-011, 관측성 문서).
 *
 * 라벨은 유한한 값만 쓴다 — 실행 ID·사용자·저장소를 라벨로 내면 지표 엔드포인트가
 * 두 번째 유출 경로가 된다 (관측성 3.3).
 */

import { Counter, Gauge, Histogram, METRICS_CONTENT_TYPE, renderMetrics, type Metric } from '@prs/metrics';

export { METRICS_CONTENT_TYPE };

export interface ExecutorMetrics {
  /** result: succeeded | failed | cancelled | timed_out | rejected | lost_claim | reclaimed */
  readonly executions: Counter;
  readonly duration: Histogram;
  readonly active: Gauge;
  /** 실행 중인 프로세스 수를 더하거나 뺀다. `Gauge`는 `set`만 있어 여기서 센다. */
  activeDelta(delta: number): void;
  render(): string;
}

export function createExecutorMetrics(): ExecutorMetrics {
  const executions = new Counter('gh_execution_total', 'gh 실행 결과 건수. 라벨 result');
  const duration = new Histogram('gh_execution_duration_seconds', 'gh 프로세스 실행 시간(초)', [0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60]);
  const active = new Gauge('gh_executor_active', '지금 실행 중인 gh 프로세스 수');
  active.set(0);
  let activeCount = 0;
  const all: readonly Metric[] = [executions, duration, active];
  return {
    executions,
    duration,
    active,
    activeDelta: (delta) => {
      activeCount = Math.max(0, activeCount + delta);
      active.set(activeCount);
    },
    render: () => renderMetrics(all),
  };
}
