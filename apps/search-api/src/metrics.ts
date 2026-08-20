/**
 * search-api 지표 (WP-009: `dead_letter_total{state}`).
 *
 * 게이트웨이·워커와 같은 노출 형식을 손으로 다시 만든다. 공유 지표 패키지를
 * 세우는 일은 파이프라인 지표 전체를 소유한 WP-010의 몫이고, 여기서 먼저 경계를
 * 그으면 WP-010이 그것을 물려받아야 한다 (워커 `metrics.ts`와 같은 판단이다).
 *
 * 실패 대기열 건수는 카운터가 아니라 **게이지**다. 프로세스가 누적하는 값이
 * 아니라 그 순간 표의 상태이므로, 스크레이프 때 읽는다.
 */

export type Labels = Readonly<Record<string, string>>;

function renderLabels(labels: Labels): string {
  const parts = Object.keys(labels)
    .sort()
    .map((name) => `${name}=${JSON.stringify(labels[name] ?? '')}`);
  return parts.length === 0 ? '' : `{${parts.join(',')}}`;
}

export interface GaugeSample {
  readonly labels: Labels;
  readonly value: number;
}

export function renderGauge(name: string, help: string, samples: readonly GaugeSample[]): string {
  const lines = [`# HELP ${name} ${help}`, `# TYPE ${name} gauge`];
  if (samples.length === 0) lines.push(`${name} 0`);
  for (const sample of samples) {
    lines.push(`${name}${renderLabels(sample.labels)} ${String(sample.value)}`);
  }
  return lines.join('\n');
}

export const METRICS_CONTENT_TYPE = 'text/plain; version=0.0.4; charset=utf-8';
