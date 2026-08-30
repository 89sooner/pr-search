'use client';

/**
 * C-040 PipelineMetricGrid — A-001의 단계 지표 (WP-040 / FR-ADMIN-001 AC-1·AC-2·AC-3, CR-055).
 *
 * ## 읽지 못한 값과 0을 가른다
 *
 * 지표 저장소가 없거나 한 축의 조회가 실패하면 그 자리만 **미확인**으로 그린다
 * (`isUnavailable`). 0으로 그리면 운영자가 "대기열이 비었다"로 읽고, 그것이
 * 실제로는 "대기열 길이를 모른다"일 때 이 화면의 목적이 통째로 뒤집힌다.
 *
 * ## "느린 저장소가 없다"와 "내가 볼 수 없다"는 다르다 (DEV-051)
 *
 * 상위 목록이 접근 범위로 걸러졌으면 **걸러진 건수만** 적는다. 식별자는 주지
 * 않는다 — 그것을 주면 범위 밖 저장소의 존재가 샌다.
 *
 * ## 신선도를 값과 함께 보인다 (AC-2)
 *
 * 마지막 갱신 시각이 없으면 지표가 언제 것인지 알 수 없고, 그러면 운영자는
 * 낡은 값으로 판단한다.
 */

import type { ReactNode } from 'react';
import { Card, CardGrid } from '@conductor-by-89soone/react';
import { UNAVAILABLE_LABEL, formatCount } from '../lib/ops-jobs';
import { hasHiddenSlowRepositories, isUnavailable, type PipelineStatusView } from '../lib/ops-pipeline';
import { formatTimestamp } from '../lib/format';

function Unavailable(): ReactNode {
  return (
    <span data-testid="metric-unavailable" aria-label="읽지 못한 값">
      {UNAVAILABLE_LABEL}
    </span>
  );
}

/** 지표 카드 하나. 값이 `null`이거나 미확인이면 그 사실을 적는다. */
function MetricCard({
  label,
  value,
  unavailable,
  testId,
}: {
  readonly label: string;
  readonly value: ReactNode;
  readonly unavailable: boolean;
  readonly testId: string;
}): ReactNode {
  return (
    <Card data-testid={testId} data-unavailable={unavailable ? 'true' : 'false'}>
      <h3>{label}</h3>
      <p>{unavailable ? <Unavailable /> : value}</p>
    </Card>
  );
}

/** 축 하나를 이름-값 목록으로 그린다. 축 전체가 미확인이면 그 사실만 적는다. */
function AxisList({
  label,
  values,
  unavailable,
  testId,
  format,
}: {
  readonly label: string;
  readonly values: Record<string, number | string> | undefined;
  readonly unavailable: boolean;
  readonly testId: string;
  readonly format?: (value: number | string) => string;
}): ReactNode {
  const entries = Object.entries(values ?? {});
  return (
    <Card data-testid={testId} data-unavailable={unavailable ? 'true' : 'false'}>
      <h3>{label}</h3>
      {unavailable ? (
        <p>
          <Unavailable />
        </p>
      ) : entries.length === 0 ? (
        <p data-testid={`${testId}-empty`}>항목이 없습니다.</p>
      ) : (
        <dl>
          {entries.map(([key, value]) => (
            <div key={key}>
              <dt>{key}</dt>
              <dd>
                {value === 'unavailable' ? (
                  <Unavailable />
                ) : (
                  (format?.(value) ?? (typeof value === 'number' ? formatCount(value) : String(value)))
                )}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </Card>
  );
}

export interface PipelineMetricGridProps {
  readonly metrics: PipelineStatusView | null;
  readonly updatedAt?: string | null;
  /** 신선도가 30초를 넘었다. 값을 지우지 않고 그 사실만 알린다. */
  readonly stale?: boolean;
  readonly failed?: boolean;
}

export function PipelineMetricGrid({
  metrics,
  updatedAt = null,
  stale = false,
  failed = false,
}: PipelineMetricGridProps): ReactNode {
  if (failed || metrics === null) {
    return (
      <div data-testid="pipeline-metric-grid" data-state="partial_failure">
        <p data-testid="pipeline-metrics-failed">
          파이프라인 지표를 읽지 못했습니다. 값은 <strong>{UNAVAILABLE_LABEL}</strong>이며 0이 아닙니다.
        </p>
      </div>
    );
  }

  const seconds = (value: number | string): string =>
    typeof value === 'number' ? `${value.toFixed(1)}초` : String(value);

  return (
    <div data-testid="pipeline-metric-grid" data-state={stale ? 'stale' : 'ready'}>
      <p data-testid="pipeline-updated-at">
        마지막 갱신 {formatTimestamp(updatedAt ?? metrics.generated_at)}
        {stale ? ' — 30초가 지났습니다. 아래 값은 그 시점의 값입니다.' : ''}
      </p>

      <CardGrid>
        <MetricCard
          label="분당 수신량"
          testId="metric-intake"
          unavailable={isUnavailable(metrics, 'intake_per_minute')}
          value={formatCount(metrics.intake_per_minute ?? null)}
        />
        <MetricCard
          label="보강 대기"
          testId="metric-enrichment"
          unavailable={isUnavailable(metrics, 'enrichment_pending')}
          value={formatCount(metrics.enrichment_pending ?? null)}
        />
        <AxisList
          label="대기열 길이"
          testId="metric-queue-depth"
          unavailable={isUnavailable(metrics, 'queue_depth')}
          values={metrics.queue_depth}
        />
        <AxisList
          label="단계별 지연"
          testId="metric-stage-latency"
          unavailable={isUnavailable(metrics, 'stage_latency_seconds')}
          values={metrics.stage_latency_seconds}
          format={seconds}
        />
        <AxisList
          label="수집 지연"
          testId="metric-ingestion-lag"
          unavailable={isUnavailable(metrics, 'ingestion_lag_seconds')}
          values={metrics.ingestion_lag_seconds}
          format={seconds}
        />
        <AxisList
          label="실패 대기열"
          testId="metric-dead-letter"
          unavailable={isUnavailable(metrics, 'dead_letter')}
          values={metrics.dead_letter}
        />
        <AxisList
          label="시퀀스 공간 상태"
          testId="metric-sequence-space"
          unavailable={isUnavailable(metrics, 'sequence_space_state')}
          values={metrics.sequence_space_state}
        />
      </CardGrid>

      <section aria-label="지연 상위 저장소" data-testid="metric-laggards">
        <h3>지연 상위 저장소</h3>
        {isUnavailable(metrics, 'slowest_repositories') ? (
          <p>
            <Unavailable />
          </p>
        ) : (metrics.slowest_repositories ?? []).length === 0 ? (
          <p data-testid="laggards-empty">
            {hasHiddenSlowRepositories(metrics)
              ? /*
                 * **건수만 적고 식별자는 주지 않는다** (DEV-051). 이 문장이
                 * 없으면 조회자가 "느린 저장소가 없다"와 "내가 볼 수 없다"를
                 * 구분하지 못한다.
                 */
                `접근 범위 안에는 없습니다. 범위 밖 ${String(metrics.slowest_repositories_out_of_scope ?? 0)}건은 표시하지 않습니다.`
              : '지연 상위 저장소가 없습니다.'}
          </p>
        ) : (
          <ol>
            {(metrics.slowest_repositories ?? []).map((row, index) => (
              <li key={String(row['repository'] ?? index)} data-testid="laggard-row">
                {String(row['repository'] ?? '미확인')} — {String(row['lag_seconds'] ?? UNAVAILABLE_LABEL)}
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
