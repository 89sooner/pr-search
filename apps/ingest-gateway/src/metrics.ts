/**
 * 수신 지표 (WP-004, QA-A001-01).
 *
 * 사내 표준이 Prometheus 호환(인프라 4장)이라 텍스트 노출 형식을 그대로 쓴다.
 * 의존성을 더하지 않고 필요한 4종만 직접 만든다 — 집계·스크레이프 배선은
 * WP-010(파이프라인 지표)의 몫이고, 여기서는 노출까지가 범위다.
 */

export type Labels = Readonly<Record<string, string>>;

/** NFR-002의 300ms를 경계로 갖는 버킷. p95를 SLO와 바로 견줄 수 있어야 한다. */
export const RESPONSE_BUCKETS = [
  0.005, 0.01, 0.025, 0.05, 0.1, 0.15, 0.2, 0.3, 0.5, 1, 2.5, 5,
] as const;

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

class Counter {
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
    if (this.values.size === 0) {
      lines.push(`${this.name} 0`);
    }
    for (const [key, value] of this.values) {
      lines.push(`${this.name}${renderLabels(key)} ${String(value)}`);
    }
    return lines.join('\n');
  }
}

class Histogram {
  private readonly counts = new Map<string, number[]>();
  private readonly sums = new Map<string, number>();
  private readonly totals = new Map<string, number>();

  constructor(
    readonly name: string,
    readonly help: string,
    private readonly buckets: readonly number[] = RESPONSE_BUCKETS,
  ) {}

  observe(seconds: number, labels: Labels = {}): void {
    const key = labelKey(labels);
    const counts = this.counts.get(key) ?? new Array<number>(this.buckets.length).fill(0);
    for (let index = 0; index < this.buckets.length; index += 1) {
      const bound = this.buckets[index];
      if (bound !== undefined && seconds <= bound) {
        counts[index] = (counts[index] ?? 0) + 1;
      }
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

export interface IngestMetrics {
  /** 수신 건수. 라벨: `event_type`, `supported` (FR-ADMIN-001). */
  readonly received: Counter;
  /** 거부 건수. 라벨: `reason`. 5분간 10건 초과 시 경보 (FR-ING-001 AC-2, NFR-005). */
  readonly rejected: Counter;
  /** 중복 전달 건수 (FR-ING-002 AC-3). */
  readonly duplicate: Counter;
  /** 수신 응답 시간 히스토그램. p95 300ms (NFR-002). */
  readonly responseSeconds: Histogram;
  /** 아카이브 append 실패 건수. 레인 B 장애가 조용히 묻히지 않게 한다. */
  readonly archiveFailed: Counter;
  /** 큐 enqueue 실패 건수. 아웃박스 재적재(JOB-ING-007)가 얼마나 일하는지의 선행 지표다. */
  readonly enqueueFailed: Counter;
  render(): string;
}

export function createIngestMetrics(): IngestMetrics {
  const received = new Counter('ingest_received_total', '웹훅 수신 건수');
  const rejected = new Counter('ingest_rejected_total', '서명 검증 실패 등 거부 건수');
  const duplicate = new Counter('ingest_duplicate_total', '중복 전달 건수');
  const responseSeconds = new Histogram('ingest_response_seconds', '수신 응답 시간(초)');
  const archiveFailed = new Counter('ingest_archive_failed_total', 'NDJSON 아카이브 append 실패 건수');
  const enqueueFailed = new Counter('ingest_enqueue_failed_total', '큐 enqueue 실패 건수');

  return {
    received,
    rejected,
    duplicate,
    responseSeconds,
    archiveFailed,
    enqueueFailed,
    render(): string {
      return `${[received, rejected, duplicate, archiveFailed, enqueueFailed, responseSeconds]
        .map((metric) => metric.render())
        .join('\n')}\n`;
    },
  };
}

export const METRICS_CONTENT_TYPE = 'text/plain; version=0.0.4; charset=utf-8';
