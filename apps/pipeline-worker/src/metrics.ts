/**
 * 워커 지표 (WP-007: `enrich_pending_total`, `stage_latency_seconds`;
 * WP-008: `ingestion_lag_seconds`).
 *
 * 사내 표준이 Prometheus 호환(인프라 4장)이라 텍스트 노출 형식을 그대로 쓴다.
 * 게이트웨이(`apps/ingest-gateway/src/metrics.ts`)와 같은 형식을 손으로 다시
 * 만드는 것이 마음에 들지는 않지만, 공유 지표 패키지를 세우는 일은 파이프라인
 * 지표 전체를 소유한 WP-010의 몫이다. 여기서 새 패키지 경계를 먼저 그으면
 * WP-010이 그것을 물려받아야 한다. 그때 한 곳으로 합친다.
 */

export type Labels = Readonly<Record<string, string>>;

/**
 * 단계 지연 버킷(초).
 *
 * JOB-ING-002의 타임아웃이 60초라 그 위쪽까지 본다. 보강은 GitHub 왕복 서너
 * 번이라 게이트웨이 응답(300ms SLO)과 자릿수가 다르다.
 */
export const STAGE_BUCKETS = [0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 120] as const;

function labelKey(labels: Labels): string {
  return Object.keys(labels)
    .sort()
    .map((name) => `${name}=${JSON.stringify(labels[name] ?? '')}`)
    .join(',');
}

function renderLabels(key: string, extra?: string): string {
  const parts = [key, extra].filter((part): part is string => part !== undefined && part !== '');
  return parts.length === 0 ? '' : `{${parts.join(',')}}`;
}

export class Counter {
  private readonly values = new Map<string, number>();

  constructor(
    readonly name: string,
    readonly help: string,
  ) {}

  inc(labels: Labels = {}, delta = 1): void {
    const key = labelKey(labels);
    this.values.set(key, (this.values.get(key) ?? 0) + delta);
  }

  get(labels: Labels = {}): number {
    return this.values.get(labelKey(labels)) ?? 0;
  }

  render(): string {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} counter`];
    if (this.values.size === 0) lines.push(`${this.name} 0`);
    for (const [key, value] of this.values) {
      lines.push(`${this.name}${renderLabels(key)} ${String(value)}`);
    }
    return lines.join('\n');
  }
}

export class Histogram {
  private readonly counts = new Map<string, number[]>();
  private readonly sums = new Map<string, number>();
  private readonly totals = new Map<string, number>();

  constructor(
    readonly name: string,
    readonly help: string,
    private readonly buckets: readonly number[] = STAGE_BUCKETS,
  ) {}

  observe(seconds: number, labels: Labels = {}): void {
    const key = labelKey(labels);
    const counts = this.counts.get(key) ?? new Array<number>(this.buckets.length).fill(0);
    for (let index = 0; index < this.buckets.length; index += 1) {
      const bound = this.buckets[index];
      if (bound !== undefined && seconds <= bound) counts[index] = (counts[index] ?? 0) + 1;
    }
    this.counts.set(key, counts);
    this.sums.set(key, (this.sums.get(key) ?? 0) + seconds);
    this.totals.set(key, (this.totals.get(key) ?? 0) + 1);
  }

  count(labels: Labels = {}): number {
    return this.totals.get(labelKey(labels)) ?? 0;
  }

  render(): string {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} histogram`];
    for (const [key, counts] of this.counts) {
      for (let index = 0; index < this.buckets.length; index += 1) {
        const bound = this.buckets[index];
        if (bound === undefined) continue;
        lines.push(
          `${this.name}_bucket${renderLabels(key, `le="${String(bound)}"`)} ${String(counts[index] ?? 0)}`,
        );
      }
      lines.push(
        `${this.name}_bucket${renderLabels(key, 'le="+Inf"')} ${String(this.totals.get(key) ?? 0)}`,
      );
      lines.push(`${this.name}_sum${renderLabels(key)} ${String(this.sums.get(key) ?? 0)}`);
      lines.push(`${this.name}_count${renderLabels(key)} ${String(this.totals.get(key) ?? 0)}`);
    }
    if (this.counts.size === 0) {
      lines.push(`${this.name}_bucket{le="+Inf"} 0`, `${this.name}_sum 0`, `${this.name}_count 0`);
    }
    return lines.join('\n');
  }
}

export interface WorkerMetrics {
  /** 부분 결과로 진행한 건수 (FR-ING-004 AC-3). 라벨: `reason`. */
  readonly enrichPending: Counter;
  /**
   * 웹훅 수신부터 색인 반영까지의 지연(초) (WP-008, FR-ING-005 AC-5, NFR-002).
   *
   * 단계별 처리 시간(`stage_latency_seconds`)과 다르다. 이것은 **끝에서 끝까지**라
   * 대기열에 머문 시간과 재시도로 늘어난 시간이 전부 들어간다. p95 10초 SLO가
   * 보는 값이 이쪽이다. 라벨을 두지 않는다 — 저장소별로 나누면 카디널리티가
   * 저장소 수만큼 늘어난다.
   */
  readonly ingestionLagSeconds: Histogram;
  /** 실패 대기열로 보낸 건수. 라벨: `stage`, `reason`. */
  readonly deadLettered: Counter;
  /** 단계 처리 시간(초). 라벨: `stage`, `outcome`. */
  readonly stageSeconds: Histogram;
  render(): string;
}

export function createWorkerMetrics(): WorkerMetrics {
  const enrichPending = new Counter('enrich_pending_total', '부분 결과로 진행한 보강 건수');
  const ingestionLagSeconds = new Histogram('ingestion_lag_seconds', '웹훅 수신부터 색인 반영까지 지연(초)');
  const deadLettered = new Counter('worker_dead_lettered_total', '실패 대기열로 보낸 이벤트 건수');
  const stageSeconds = new Histogram('stage_latency_seconds', '파이프라인 단계 처리 시간(초)');

  return {
    enrichPending,
    ingestionLagSeconds,
    deadLettered,
    stageSeconds,
    render(): string {
      const metrics = [enrichPending, ingestionLagSeconds, deadLettered, stageSeconds];
      return `${metrics.map((metric) => metric.render()).join('\n')}\n`;
    },
  };
}

export const METRICS_CONTENT_TYPE = 'text/plain; version=0.0.4; charset=utf-8';
