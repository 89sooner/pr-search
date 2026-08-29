'use client';

/**
 * C-033 TimeSeriesChart — 머지 PR 수 시계열 (WP-038 / FR-STAT-002).
 *
 * ## 색은 계열을, 위치는 값을 나타낸다
 *
 * 계열은 `dataviz.series.1`~`20`으로 구분한다. 색은 계열 정체성만 나타내고 값의
 * 크기는 y 위치로 표현한다(dataviz 원칙). 색만으로 계열을 알게 하지 않으려고
 * 범례가 색과 이름을 함께 싣고, 같은 데이터를 표로도 제공한다(C-033 사용 규칙).
 *
 * ## 계열 색이 조회마다 흔들리지 않는다
 *
 * 색은 `series[]`의 순서(=서버가 정한 count 내림차순)로 배정한다. 같은 키가 다음
 * 조회에서 다른 색을 받지 않도록 인덱스 규칙을 고정한다.
 *
 * ## 버킷 드릴다운은 기간만 만든다
 *
 * 서버가 시계열에는 `drill_down_query`를 주지 않아(그룹·분포와 다르다) 뷰가 버킷의
 * 기간 범위를 만든다(DEV-396). 그것은 `merged:` 범위 하나이지 그룹 인코딩이 아니다.
 */

import Link from 'next/link';
import type { ReactNode } from 'react';
import { Panel } from '@conductor-by-89soone/react';

export interface TimeSeriesRow {
  readonly key: string;
  readonly values: readonly number[];
}

export interface TimeSeriesChartProps {
  readonly buckets: readonly string[];
  readonly series: readonly TimeSeriesRow[];
  readonly truncated?: boolean;
  /** 버킷 시각 → 근거 목록 href(기간 범위). `null`이면 링크를 만들지 않는다. */
  readonly bucketHrefFor: (bucketIso: string) => string | null;
  /** 사람이 읽는 버킷 라벨. 기본은 ISO를 그대로 쓴다. */
  readonly bucketLabel?: (bucketIso: string) => string;
}

const MAX_SERIES = 20;

/** 계열 색. 인덱스로 고정한다(같은 키는 같은 색). */
function seriesColor(index: number): string {
  return `var(--cdt-dataviz-series-${String((index % MAX_SERIES) + 1)})`;
}

function polylinePoints(values: readonly number[], max: number): string {
  const n = values.length;
  return values
    .map((value, index) => {
      const x = n <= 1 ? 0 : (index / (n - 1)) * 100;
      const y = max === 0 ? 100 : 100 - (value / max) * 100;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');
}

export function TimeSeriesChart({
  buckets,
  series,
  truncated = false,
  bucketHrefFor,
  bucketLabel = (iso) => iso,
}: TimeSeriesChartProps): ReactNode {
  const max = series.reduce((acc, row) => Math.max(acc, ...row.values), 0);
  const summary = `${String(series.length)}개 계열, ${String(buckets.length)}개 구간, 최대 ${max.toLocaleString('ko-KR')}`;

  return (
    <Panel as="section" aria-label="시계열">
      <h3>머지 PR 시계열</h3>
      {truncated ? <p data-testid="series-truncated">계열이 20개를 넘어 상위 20개만 색으로 구분합니다.</p> : null}

      <svg
        role="img"
        aria-label={`머지 PR 시계열: ${summary}`}
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        style={{ width: '100%', height: '220px' }}
      >
        {series.slice(0, MAX_SERIES).map((row, index) => (
          <polyline
            key={row.key}
            points={polylinePoints(row.values, max)}
            fill="none"
            stroke={seriesColor(index)}
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>

      {/* 범례: 색과 이름을 함께 싣는다 — 색만으로 계열을 알게 하지 않는다. */}
      {series.length > 0 ? (
        <ul data-testid="series-legend" aria-label="계열 범례">
          {series.slice(0, MAX_SERIES).map((row, index) => (
            <li key={row.key}>
              <span
                aria-hidden="true"
                style={{
                  display: 'inline-block',
                  width: '0.75rem',
                  height: '0.75rem',
                  backgroundColor: seriesColor(index),
                }}
              />
              {row.key}
            </li>
          ))}
        </ul>
      ) : null}

      {/* 표 대체: 같은 값·구간 순서. 버킷마다 근거 목록으로 가는 링크를 둔다. */}
      <details open>
        <summary>표로 보기</summary>
        <div style={{ overflowX: 'auto' }}>
          <table>
            <caption>구간별 계열 값</caption>
            <thead>
              <tr>
                <th scope="col">구간</th>
                {series.map((row) => (
                  <th key={row.key} scope="col">
                    {row.key}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {buckets.map((bucket, bucketIndex) => {
                const href = bucketHrefFor(bucket);
                return (
                  <tr key={bucket}>
                    <th scope="row">
                      {href === null ? (
                        bucketLabel(bucket)
                      ) : (
                        <Link href={href} data-testid="bucket-drilldown">
                          {bucketLabel(bucket)}
                        </Link>
                      )}
                    </th>
                    {series.map((row) => (
                      <td key={row.key}>{(row.values[bucketIndex] ?? 0).toLocaleString('ko-KR')}</td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </details>
    </Panel>
  );
}
