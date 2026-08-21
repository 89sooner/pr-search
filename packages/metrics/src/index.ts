/**
 * Prometheus 호환 지표 노출 (WP-010).
 *
 * 사내 표준이 Prometheus 호환(인프라 4장)이라 텍스트 노출 형식을 그대로 쓴다.
 * 의존성을 더하지 않고 필요한 세 종류만 직접 만든다.
 *
 * **이 패키지가 하는 일은 노출까지다.** 보관·집계·질의는 사내 지표 저장소가
 * 한다. 게이트웨이·워커·search-api가 각자 손으로 복제해 두었던 같은 구현을
 * 한 곳으로 모은 것이고, 세 앱의 노출 형식이 서로 어긋나지 않게 하는 것이
 * 목적이다 (관측성 3.4).
 */

export type Labels = Readonly<Record<string, string>>;

/** 수신 응답 시간용. NFR-002의 300ms를 경계로 갖는다. */
export const RESPONSE_BUCKETS = [
  0.005, 0.01, 0.025, 0.05, 0.1, 0.15, 0.2, 0.3, 0.5, 1, 2.5, 5,
] as const;

/** 파이프라인 단계용. JOB-ING-002의 타임아웃이 60초라 그 위쪽까지 본다. */
export const STAGE_BUCKETS = [0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 120] as const;

export const METRICS_CONTENT_TYPE = 'text/plain; version=0.0.4; charset=utf-8';

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

/** 노출 가능한 지표. `render()`가 Prometheus 텍스트 형식을 돌려준다. */
export interface Metric {
  readonly name: string;
  render(): string;
}

export class Counter implements Metric {
  readonly #values = new Map<string, number>();

  constructor(
    readonly name: string,
    readonly help: string,
  ) {}

  inc(labels: Labels = {}, delta = 1): void {
    const key = labelKey(labels);
    this.#values.set(key, (this.#values.get(key) ?? 0) + delta);
  }

  get(labels: Labels = {}): number {
    return this.#values.get(labelKey(labels)) ?? 0;
  }

  render(): string {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} counter`];
    // 값이 하나도 없어도 시계열을 낸다. 없는 것과 0인 것을 구분하지 못하면
    // "수집이 멈췄다"는 경보가 스크레이프 시작 전까지 뜨지 않는다.
    if (this.#values.size === 0) lines.push(`${this.name} 0`);
    for (const [key, value] of this.#values) {
      lines.push(`${this.name}${renderLabels(key)} ${String(value)}`);
    }
    return lines.join('\n');
  }
}

export class Histogram implements Metric {
  readonly #counts = new Map<string, number[]>();
  readonly #sums = new Map<string, number>();
  readonly #totals = new Map<string, number>();

  constructor(
    readonly name: string,
    readonly help: string,
    private readonly buckets: readonly number[] = STAGE_BUCKETS,
  ) {}

  observe(seconds: number, labels: Labels = {}): void {
    const key = labelKey(labels);
    const counts = this.#counts.get(key) ?? new Array<number>(this.buckets.length).fill(0);
    for (let index = 0; index < this.buckets.length; index += 1) {
      const bound = this.buckets[index];
      if (bound !== undefined && seconds <= bound) counts[index] = (counts[index] ?? 0) + 1;
    }
    this.#counts.set(key, counts);
    this.#sums.set(key, (this.#sums.get(key) ?? 0) + seconds);
    this.#totals.set(key, (this.#totals.get(key) ?? 0) + 1);
  }

  /** 해당 라벨 조합의 관측 수. 시험이 버킷 분포를 확인할 때 쓴다. */
  count(labels: Labels = {}): number {
    return this.#totals.get(labelKey(labels)) ?? 0;
  }

  /** 상한 이하 관측 수. 누적 히스토그램이라 `le` 의미 그대로다. */
  countAtOrBelow(bound: number, labels: Labels = {}): number {
    const index = this.buckets.indexOf(bound);
    if (index < 0) return 0;
    return this.#counts.get(labelKey(labels))?.[index] ?? 0;
  }

  render(): string {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} histogram`];
    for (const [key, counts] of this.#counts) {
      for (let index = 0; index < this.buckets.length; index += 1) {
        const bound = this.buckets[index];
        if (bound === undefined) continue;
        lines.push(
          `${this.name}_bucket${renderLabels(key, `le="${String(bound)}"`)} ${String(counts[index] ?? 0)}`,
        );
      }
      const total = this.#totals.get(key) ?? 0;
      lines.push(`${this.name}_bucket${renderLabels(key, 'le="+Inf"')} ${String(total)}`);
      lines.push(`${this.name}_sum${renderLabels(key)} ${String(this.#sums.get(key) ?? 0)}`);
      lines.push(`${this.name}_count${renderLabels(key)} ${String(total)}`);
    }
    // 관측이 없어도 시계열을 낸다. Counter와 같은 이유다.
    if (this.#counts.size === 0) {
      lines.push(`${this.name}_bucket{le="+Inf"} 0`, `${this.name}_sum 0`, `${this.name}_count 0`);
    }
    return lines.join('\n');
  }
}

/**
 * 게이지.
 *
 * 프로세스가 누적하는 값이 아니라 **그 순간의 상태**를 내는 지표다. 실패
 * 대기열 건수처럼 출처가 데이터베이스인 값은 스크레이프 때 읽어 `set`한다.
 */
export class Gauge implements Metric {
  readonly #values = new Map<string, number>();

  constructor(
    readonly name: string,
    readonly help: string,
  ) {}

  set(value: number, labels: Labels = {}): void {
    this.#values.set(labelKey(labels), value);
  }

  get(labels: Labels = {}): number {
    return this.#values.get(labelKey(labels)) ?? 0;
  }

  /** 이전 값을 모두 버리고 주어진 집합으로 바꾼다. 사라진 라벨이 남지 않는다. */
  replace(samples: readonly { readonly labels: Labels; readonly value: number }[]): void {
    this.#values.clear();
    for (const sample of samples) this.set(sample.value, sample.labels);
  }

  render(): string {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} gauge`];
    if (this.#values.size === 0) lines.push(`${this.name} 0`);
    for (const [key, value] of this.#values) {
      lines.push(`${this.name}${renderLabels(key)} ${String(value)}`);
    }
    return lines.join('\n');
  }
}

/** 여러 지표를 한 번에 노출한다. 끝에 개행 하나를 붙인다 (Prometheus 텍스트 규약). */
export function renderMetrics(metrics: readonly Metric[]): string {
  return `${metrics.map((metric) => metric.render()).join('\n')}\n`;
}
