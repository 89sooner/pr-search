'use client';

/**
 * C-034 DistributionChart — 변경 규모 구간별 분포 (WP-038 / FR-STAT-005).
 *
 * ## unknown은 0과 다르게 그린다
 *
 * 값이 없는 것(보강 미완료)과 0인 것은 다른 사실이다(FR-STAT-005 AC-5, CR-053).
 * unknown 구간은 순서형 색을 주지 않고 muted로 그리며, 근거 목록으로 갈 길이 없다
 * (서버가 `drill_down_query`를 `null`로 준다). 0인 구간은 순서형 색을 유지하되
 * 길이가 0일 뿐이다.
 *
 * ## 색은 순서를, 길이는 크기를 나타낸다
 *
 * 순서형 구간은 단일 색조 명도 램프(`dataviz.sequential.1`~`5`)로 그린다. 크기는
 * 막대 길이로 표현하고 색으로 표현하지 않는다(dataviz 원칙). 색만으로 정보를 주지
 * 않도록 동일 데이터를 표로 함께 제공한다(WCAG 1.4.1, C-034 사용 규칙).
 */

import Link from 'next/link';
import type { ReactNode } from 'react';
import { Panel } from './ui';

export interface DistributionBucket {
  readonly label: string;
  readonly count: number;
  readonly ratio: number;
  /** 서버가 준 근거 질의. `null`이면 근거 목록으로 갈 길이 없다(unknown). */
  readonly drillDownQuery: string | null;
  /** 보강 미완료 문서 구간. 0과 다르게 그린다. */
  readonly unknown: boolean;
}

export interface DistributionChartProps {
  readonly title: string;
  readonly buckets: readonly DistributionBucket[];
  readonly hrefFor: (drillDownQuery: string) => string | null;
}

/** 순서형 구간의 색. 인덱스가 오를수록 뚜렷해진다(단일 색조 명도 램프). */
function sequentialColor(rangeIndex: number): string {
  // sequential.1~5. 구간이 5개를 넘지 않는다(파일 수 5, 라인 수 4).
  const step = Math.min(rangeIndex + 1, 5);
  return `var(--ui-dataviz-sequential-${String(step)})`;
}

function percent(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`;
}

export function DistributionChart({ title, buckets, hrefFor }: DistributionChartProps): ReactNode {
  const max = buckets.reduce((acc, bucket) => Math.max(acc, bucket.count), 0);
  const summary = buckets
    .map((bucket) => `${bucket.label} ${bucket.count.toLocaleString("en-US")} items ${percent(bucket.ratio)}`)
    .join(', ');
  let rangeIndex = -1;

  return (
    <Panel as="section" aria-label={title} className="prs-chart-panel">
      <h3>{title}</h3>

      {/* 시각 막대. 실제 데이터와 상호작용은 아래 표가 담당한다(role img). */}
      <div
        role="img"
        aria-label={`${title}: ${summary}`}
        className="prs-distribution-chart"
      >
        {buckets.map((bucket) => {
          if (!bucket.unknown) rangeIndex += 1;
          const width = max === 0 ? 0 : (bucket.count / max) * 100;
          const fill = bucket.unknown ? 'var(--ui-text-muted)' : sequentialColor(rangeIndex);
          return (
            <div key={bucket.label} className="prs-distribution-row" aria-hidden="true">
              <span>{bucket.label}</span>
              <span className="prs-distribution-track"><span style={{ width: `${width}%`, background: fill, opacity: bucket.unknown ? 0.5 : 1 }} /></span>
              <span>{bucket.count.toLocaleString('en-US')}<small>{percent(bucket.ratio)}</small></span>
            </div>
          );
        })}
      </div>

      {/* 표 대체. C-034 사용 규칙이 요구한다 — 같은 값·라벨·구간 순서를 쓴다. */}
      <details open className="prs-chart-data">
        <summary>View as table</summary>
        <table>
          <caption>{title} Counts and percentages by bucket</caption>
          <thead>
            <tr>
              <th scope="col">Range</th>
              <th scope="col">Count</th>
              <th scope="col">Percentage</th>
            </tr>
          </thead>
          <tbody>
            {buckets.map((bucket) => {
              const href = bucket.unknown ? null : hrefFor(bucket.drillDownQuery ?? '');
              return (
                <tr key={bucket.label} data-unknown={bucket.unknown ? 'true' : undefined}>
                  <th scope="row">
                    {href === null ? (
                      <span>
                        {bucket.label}
                        {bucket.unknown ? <span> (enrichment incomplete)</span> : null}
                      </span>
                    ) : (
                      <Link href={href} data-testid="distribution-drilldown">
                        {bucket.label}
                      </Link>
                    )}
                  </th>
                  <td>{bucket.count.toLocaleString("en-US")}</td>
                  <td>{percent(bucket.ratio)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </details>
    </Panel>
  );
}
