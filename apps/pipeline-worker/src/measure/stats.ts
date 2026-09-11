/**
 * 측정 표본의 분류와 집계 (WP-074 FR-SEQ-008 AC-14 / 측정 가이드 3·5절).
 *
 * ## 0으로 clamp하지 않는다
 *
 * 음수 지연(시계 이상)은 `clock_anomaly`로 따로 세고 최솟값을 기록한다. 0으로
 * 접으면 "빠르다"로 읽히고, 그 보고는 있지도 않은 성능을 주장한다.
 *
 * ## 분류는 서로 배타적이다
 *
 * `valid + missing + failed + pending + clock_anomaly = requests`. 같은 요청의
 * 재시도 attempt를 여러 요청으로 늘리지 않는다 (가이드 6절).
 */

/** 한 표본의 stage 시각. `null`은 그 구간을 재지 못했다는 뜻이며 0이 아니다. */
export interface SampleTimes {
  readonly outcome: 'pending' | 'failed' | 'assigned' | 'visible' | 'skipped';
  readonly reason: string | null;
  readonly receivedAt: Date | null;
  readonly mirrorCompletedAt: Date | null;
  readonly sequenceAssignedAt: Date | null;
  readonly mnumberAssignedAt: Date | null;
  readonly searchObservedAt: Date | null;
}

/** 가이드 3절의 구간 이름. */
export const STAGES = [
  'received_to_mirror',
  'received_to_sequence',
  'received_to_mnumber',
  'mnumber_to_search_observed',
  'received_to_search_observed',
] as const;
export type StageName = (typeof STAGES)[number];

const STAGE_BOUNDS: Readonly<Record<StageName, readonly [keyof SampleTimes, keyof SampleTimes]>> = {
  received_to_mirror: ['receivedAt', 'mirrorCompletedAt'],
  received_to_sequence: ['receivedAt', 'sequenceAssignedAt'],
  received_to_mnumber: ['receivedAt', 'mnumberAssignedAt'],
  mnumber_to_search_observed: ['mnumberAssignedAt', 'searchObservedAt'],
  received_to_search_observed: ['receivedAt', 'searchObservedAt'],
};

export interface StageStats {
  readonly name: StageName;
  readonly unit: 'ms';
  readonly requests: number;
  readonly valid_samples: number;
  readonly p50: number | null;
  readonly p95: number | null;
  readonly p99: number | null;
  readonly max: number | null;
  readonly missing: number;
  readonly failed: number;
  readonly pending: number;
  readonly clock_anomaly_count: number;
  readonly clock_anomaly_min_ms: number | null;
}

/** `percentile_disc` — 정렬한 표본에서 **실제 값 하나**를 고른다. 보간하지 않는다. */
export function percentileDisc(sorted: readonly number[], fraction: number): number | null {
  if (sorted.length === 0) return null;
  const index = Math.ceil(fraction * sorted.length) - 1;
  return sorted[Math.min(Math.max(index, 0), sorted.length - 1)] as number;
}

/**
 * 한 구간의 통계. **분모를 밝힌다** — `valid_samples`가 percentile의 분모이고
 * `requests`가 전체다. pending을 빼고 p95만 좋게 보고하지 않기 위해서다.
 */
export function summarizeStage(name: StageName, samples: readonly SampleTimes[]): StageStats {
  const [fromKey, toKey] = STAGE_BOUNDS[name];
  const durations: number[] = [];
  let missing = 0;
  let failed = 0;
  let pending = 0;
  let anomalies = 0;
  let anomalyMin: number | null = null;

  for (const sample of samples) {
    const from = sample[fromKey] as Date | null;
    const to = sample[toKey] as Date | null;
    if (from === null || to === null) {
      // 끝나지 않은 것과 잴 수 없는 것을 가른다 — 둘 다 percentile 분모에서 빠진다.
      if (sample.outcome === 'failed') failed += 1;
      else if (to === null && (sample.outcome === 'pending' || sample.outcome === 'assigned')) pending += 1;
      else missing += 1;
      continue;
    }
    const delta = to.getTime() - from.getTime();
    if (delta < 0) {
      anomalies += 1;
      anomalyMin = anomalyMin === null ? delta : Math.min(anomalyMin, delta);
      continue;
    }
    durations.push(delta);
  }

  durations.sort((a, b) => a - b);
  return {
    name,
    unit: 'ms',
    requests: samples.length,
    valid_samples: durations.length,
    p50: percentileDisc(durations, 0.5),
    p95: percentileDisc(durations, 0.95),
    p99: percentileDisc(durations, 0.99),
    max: durations.length === 0 ? null : (durations[durations.length - 1] as number),
    missing,
    failed,
    pending,
    clock_anomaly_count: anomalies,
    clock_anomaly_min_ms: anomalyMin,
  };
}

/** 저장소 식별자를 로컬 라벨로 치환한다 — 외부 보고에 내부 이름을 싣지 않는다 (가이드 6절). */
export function spaceLabel(hash: string): string {
  return `space-${hash.slice(0, 4)}`;
}

export interface PendingSummary {
  /** 미확정 커밋 수 (checkpoint 다음 blocker). */
  readonly items: number;
  /** 이미 아는 PR 중 번호를 기다리는 수. `items`와 합이 같을 필요가 없다. */
  readonly known_prs: number;
  readonly oldest_ms: number | null;
  readonly reasons: Readonly<Record<string, number>>;
}
