'use client';

/**
 * C-035 PercentileCardRow — 백분위 카드와 원값 대체 (WP-038 / FR-STAT-003, FR-STAT-004).
 *
 * ## low_sample이면 백분위를 그리지 않는다
 *
 * 계약의 낱말이 "대신"이다(FR-STAT-003 예외 처리). 표본이 20건 미만이면 서버가
 * 백분위 **대신** 원값을 싣고 `low_sample: true`를 준다. 둘을 함께 그리면 흔들리는
 * 백분위를 의미 있는 값처럼 보이게 한다 — 그래서 여기서도 하나만 그린다.
 *
 * ## 제외 건수를 항상 보인다
 *
 * 리뷰 없는 PR은 리뷰 대기 집계에서 빠지고(FR-STAT-004 AC-1), 그 수를 숨기면
 * "리뷰가 빠른 팀"과 "리뷰를 안 받은 팀"이 같은 수로 보인다.
 */

import type { ReactNode } from 'react';
import { Badge, Card, CardGrid } from './ui';
import { formatDuration } from '../lib/format';

export interface PercentileGroupRow {
  readonly key: string;
  readonly lowSample: boolean;
  readonly values: Readonly<Record<string, number>> | null;
  readonly rawValues: readonly number[] | null;
  readonly sampleSize: number;
}

export interface PercentileCardRowProps {
  /** 표시할 백분위 순서. 리드타임은 [50,75,90,95,99], 리뷰 대기는 [50,90,95]. */
  readonly percentiles: readonly number[];
  readonly overall: {
    readonly lowSample: boolean;
    readonly values: Readonly<Record<string, number>> | null;
    readonly rawValues: readonly number[] | null;
    readonly sampleSize: number;
  };
  /** 그룹 지정 시 그룹별 비교. 없으면 전체만 그린다. */
  readonly groups?: readonly PercentileGroupRow[];
  /** 집계에서 빠진 문서 수. 항상 보인다 (0이어도). */
  readonly excludedCount: number;
  readonly excludedReasons?: Readonly<Record<string, number>> | undefined;
}

/** 초를 사람이 읽는 값으로. `formatDuration`이 이미 있는 규칙을 쓴다. */
function seconds(value: number): string {
  return formatDuration(value);
}

function LowSampleValues({ raw }: { readonly raw: readonly number[] }): ReactNode {
  return (
    <div data-testid="raw-values">
      <Badge tone="warning">Insufficient samples</Badge>
      <p>Fewer than 20 samples. Raw values are shown instead of percentiles.</p>
      <ol>
        {raw.map((value, index) => (
          <li key={index}>{seconds(value)}</li>
        ))}
      </ol>
    </div>
  );
}

function PercentileCards({
  percentiles,
  values,
}: {
  readonly percentiles: readonly number[];
  readonly values: Readonly<Record<string, number>>;
}): ReactNode {
  return (
    <CardGrid className="prs-percentile-grid">
      {percentiles.map((p) => {
        const value = values[String(p)];
        return (
          <Card key={p} size="sm" className="prs-percentile-card">
            <span aria-hidden="true">p {p}</span>
            <strong>
              <span className="ui-sr-only">{p} percentile </span>
              {value === undefined ? '—' : seconds(value)}
            </strong>
          </Card>
        );
      })}
    </CardGrid>
  );
}

export function PercentileCardRow({
  percentiles,
  overall,
  groups,
  excludedCount,
  excludedReasons,
}: PercentileCardRowProps): ReactNode {
  return (
    <div className="prs-percentiles">
      {overall.lowSample || overall.values === null ? (
        <LowSampleValues raw={overall.rawValues ?? []} />
      ) : (
        <PercentileCards percentiles={percentiles} values={overall.values} />
      )}

      <p data-testid="excluded-count">
        Excluded from aggregation: <strong>{excludedCount.toLocaleString("en-US")} items</strong>
        {excludedReasons !== undefined && Object.keys(excludedReasons).length > 0 ? (
          <span>
            {' '}
            (
            {Object.entries(excludedReasons)
              .map(([reason, count]) => `${reason} ${count.toLocaleString("en-US")}`)
              .join(', ')}
            )
          </span>
        ) : null}
      </p>

      {groups !== undefined && groups.length > 0 ? (
        <table>
          <caption>Percentile comparison by group</caption>
          <thead>
            <tr>
              <th scope="col">Group</th>
              {percentiles.map((p) => (
                <th key={p} scope="col">
                  p {p}
                </th>
              ))}
              <th scope="col">Samples</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((group) => (
              <tr key={group.key}>
                <th scope="row">{group.key}</th>
                {group.lowSample || group.values === null ? (
                  <td colSpan={percentiles.length}>
                    <Badge tone="warning">Insufficient samples</Badge>
                  </td>
                ) : (
                  percentiles.map((p) => {
                    const value = group.values?.[String(p)];
                    return <td key={p}>{value === undefined ? '—' : seconds(value)}</td>;
                  })
                )}
                <td>{group.sampleSize.toLocaleString("en-US")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}
