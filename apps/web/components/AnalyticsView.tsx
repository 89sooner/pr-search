'use client';

/**
 * W-006 통계 대시보드 (WP-038 / FR-STAT-001~006, FLOW-005).
 *
 * ## 패널마다 독립으로 조회하고 실패를 격리한다
 *
 * 한 패널이 timeout이어도 나머지는 자기 결과를 유지한다(상태 매트릭스 W-006
 * `partial_failure`). 그래서 패널마다 fetch를 따로 건다 — 하나의 조회로 묶으면
 * 한 축의 실패가 대시보드 전체를 비운다.
 *
 * ## 집계가 세는 것은 PR이다
 *
 * 목록은 PR과 커밋을 함께 보이므로 목록 총계와 집계 총계가 다를 수 있고 그것은
 * 오류가 아니다(CR-053, FR-STAT-006 AC-2). 화면이 그 사실을 밝힌다.
 *
 * ## 차트는 동적 import한다
 *
 * `TimeSeriesChart`·`DistributionChart`는 이 화면에서만 쓰이므로 초기 번들에 넣지
 * 않는다(프런트엔드 문서 9장, 번들 250KB 예산).
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { Banner, Panel, Spinner } from '@conductor-by-89soone/react';
import { PercentileCardRow } from './PercentileCardRow';
import { AggregationPanel, type AggregationGroup } from './AggregationPanel';
import {
  readAnalyticsState,
  writeAnalyticsState,
  buildGroupsRequest,
  buildTimeSeriesRequest,
  buildPercentilesRequest,
  buildDistributionsRequest,
  resolvePanelState,
  drillDownHref,
  bucketDrillDownHref,
  readPercentileValues,
  GROUP_KEYS,
  INTERVALS,
  DEFAULT_PERCENTILES,
  DEFAULT_TIMEZONE,
  type AnalyticsUrlState,
  type PanelState,
  type AnalyticsBody,
  type GroupKey,
  type Interval,
} from '../lib/analytics';
import { useRouter, useSearchParams } from 'next/navigation';

const TimeSeriesChart = dynamic(() => import('./TimeSeriesChart').then((m) => m.TimeSeriesChart), {
  ssr: false,
  loading: () => <Spinner label="시계열을 불러오는 중" />,
});
const DistributionChart = dynamic(() => import('./DistributionChart').then((m) => m.DistributionChart), {
  ssr: false,
  loading: () => <Spinner label="분포를 불러오는 중" />,
});

const ANALYTICS_API = '/api/analytics';

interface FetchResult {
  readonly loading: boolean;
  readonly networkFailed: boolean;
  readonly status: number | null;
  readonly body: (AnalyticsBody & Record<string, unknown>) | null;
}

const PENDING: FetchResult = { loading: true, networkFailed: false, status: null, body: null };
const DISABLED: FetchResult = { loading: false, networkFailed: false, status: null, body: null };

/**
 * 한 패널의 조회. URL 상태가 바뀌면 다시 부른다. 실패는 이 훅 안에 갇힌다.
 *
 * `enabled`가 거짓이면 부르지 않는다 — 그룹 집계는 서버가 `group_by`를 필수로
 * 요구하므로(routes.ts) 그룹 키가 없을 때 부르면 400을 받는다.
 */
function usePanel(path: string, requestBody: Record<string, unknown>, enabled = true): FetchResult {
  const [result, setResult] = useState<FetchResult>(enabled ? PENDING : DISABLED);
  const key = JSON.stringify(requestBody);

  useEffect(() => {
    if (!enabled) {
      setResult(DISABLED);
      return;
    }
    const controller = new AbortController();
    setResult(PENDING);
    void (async () => {
      try {
        const response = await fetch(`${ANALYTICS_API}/${path}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: key,
          signal: controller.signal,
          cache: 'no-store',
        });
        let body: (AnalyticsBody & Record<string, unknown>) | null = null;
        try {
          body = (await response.json()) as AnalyticsBody & Record<string, unknown>;
        } catch {
          body = null;
        }
        setResult({ loading: false, networkFailed: false, status: response.status, body });
      } catch {
        if (controller.signal.aborted) return;
        setResult({ loading: false, networkFailed: true, status: null, body: null });
      }
    })();
    return () => {
      controller.abort();
    };
  }, [path, key, enabled]);

  return result;
}

/** 공통 상태(재인증·오프라인·오류)를 한 자리에서 그린다. */
function PanelStatus({ state }: { readonly state: PanelState }): ReactNode {
  switch (state.kind) {
    case 'loading':
      return <Spinner label="불러오는 중" />;
    case 'offline':
      return <Banner tone="warning">연결이 끊겼습니다. 다시 시도하세요.</Banner>;
    case 'auth_expired':
      return (
        <Banner tone="warning">
          세션이 만료되었습니다. <Link href={state.loginPath}>다시 로그인</Link>
        </Banner>
      );
    case 'no_permission':
      return <Banner tone="danger">이 집계를 볼 권한이 없습니다.</Banner>;
    case 'empty_no_data':
      return <p>대상 데이터가 없습니다. 기간이나 조건을 넓혀 보세요.</p>;
    case 'epoch_stale':
      return (
        <Banner tone="warning" data-testid="epoch-stale">
          질의의 시퀀스 범위가 딛고 선 에폭이 현재와 다릅니다(요청 {state.requested ?? '없음'}). 재채번 뒤의 같은
          서수는 다른 커밋을 가리키므로 집계를 그리지 않습니다. 범위를 다시 지정하세요.
        </Banner>
      );
    case 'error_too_many_buckets':
      return (
        <Banner tone="warning">
          버킷이 {state.max ?? 400}개를 넘습니다(요청 {state.bucketCount ?? '?'}). 간격을 넓히세요.
        </Banner>
      );
    case 'error_aggregation_timeout':
      return <Banner tone="warning">집계가 시간을 넘겼습니다. 기간을 줄이거나 조건을 좁히세요.</Banner>;
    case 'error_other':
      return (
        <Banner tone="danger">
          집계에 실패했습니다({state.code}). {state.message}
        </Banner>
      );
    default:
      return null;
  }
}

/** 상태가 정상 그리기(ready/approximate)가 아니면 대체 메시지를 낸다. */
function isRenderable(state: PanelState): boolean {
  return state.kind === 'ready' || state.kind === 'approximate';
}

export interface AnalyticsViewProps {
  readonly loginPath: string;
}

export function AnalyticsView({ loginPath }: AnalyticsViewProps): ReactNode {
  const router = useRouter();
  const searchParams = useSearchParams();
  const state = useMemo(() => readAnalyticsState(searchParams.toString()), [searchParams]);

  const update = useCallback(
    (patch: Partial<AnalyticsUrlState>) => {
      const next = writeAnalyticsState({ ...state, ...patch });
      router.replace(next === '' ? '/analytics' : `/analytics?${next}`);
    },
    [router, state],
  );

  const hrefFor = useCallback((q: string) => drillDownHref(q, state.seqEpoch), [state.seqEpoch]);
  const bucketHrefFor = useCallback(
    (iso: string) => bucketDrillDownHref(state.q, iso, state.interval, state.seqEpoch),
    [state.q, state.interval, state.seqEpoch],
  );

  return (
    <div>
      <AnalyticsControls state={state} onChange={update} />

      <p data-testid="pr-population-note">
        이 통계는 <strong>Pull Request</strong>를 대상으로 셉니다. 검색 목록은 PR과 커밋을 함께 보이므로 목록 총계와
        다를 수 있으며, 그 차이는 오류가 아닙니다.
      </p>

      <GroupsSlot state={state} loginPath={loginPath} hrefFor={hrefFor} />
      <TimeSeriesSlot state={state} loginPath={loginPath} bucketHrefFor={bucketHrefFor} />
      <PercentilesSlot
        state={state}
        loginPath={loginPath}
        field="lead_time_seconds"
        title="리드타임 분포"
        percentiles={[...DEFAULT_PERCENTILES]}
      />
      <PercentilesSlot
        state={state}
        loginPath={loginPath}
        field="first_review_wait_seconds"
        title="리뷰 대기 시간"
        percentiles={[50, 90, 95]}
      />
      <DistributionSlot state={state} loginPath={loginPath} dimension="changed_files" title="변경 파일 수 분포" hrefFor={hrefFor} />
      <DistributionSlot state={state} loginPath={loginPath} dimension="changed_lines" title="변경 라인 수 분포" hrefFor={hrefFor} />
    </div>
  );
}

function AnalyticsControls({
  state,
  onChange,
}: {
  readonly state: AnalyticsUrlState;
  readonly onChange: (patch: Partial<AnalyticsUrlState>) => void;
}): ReactNode {
  return (
    <Panel as="section" aria-label="조건">
      <label>
        질의
        <input
          type="text"
          defaultValue={state.q}
          onBlur={(event) => {
            onChange({ q: event.target.value });
          }}
          placeholder="org:acme merged:2026-07-01..2026-08-01"
        />
      </label>
      <label>
        그룹 키
        <select
          value={state.groupBy ?? ''}
          onChange={(event) => {
            const value = event.target.value;
            onChange({ groupBy: value === '' ? null : (value as GroupKey) });
          }}
        >
          <option value="">그룹 없음</option>
          {GROUP_KEYS.map((key) => (
            <option key={key} value={key}>
              {key}
            </option>
          ))}
        </select>
      </label>
      <label>
        버킷 간격
        <select
          value={state.interval}
          onChange={(event) => {
            onChange({ interval: event.target.value as Interval });
          }}
        >
          {INTERVALS.map((interval) => (
            <option key={interval} value={interval}>
              {interval}
            </option>
          ))}
        </select>
      </label>
      <label>
        시작
        <input
          type="date"
          value={state.from ?? ''}
          onChange={(event) => {
            onChange({ from: event.target.value === '' ? null : event.target.value });
          }}
        />
      </label>
      <label>
        끝
        <input
          type="date"
          value={state.to ?? ''}
          onChange={(event) => {
            onChange({ to: event.target.value === '' ? null : event.target.value });
          }}
        />
      </label>
      <label>
        시간대
        <input
          type="text"
          defaultValue={state.timezone}
          onBlur={(event) => {
            onChange({ timezone: event.target.value === '' ? DEFAULT_TIMEZONE : event.target.value });
          }}
          placeholder="Asia/Seoul"
        />
      </label>
    </Panel>
  );
}

function GroupsSlot({
  state,
  loginPath,
  hrefFor,
}: {
  readonly state: AnalyticsUrlState;
  readonly loginPath: string;
  readonly hrefFor: (q: string) => string | null;
}): ReactNode {
  // 그룹 키가 없으면 조회하지 않는다 — 그룹 엔드포인트는 group_by가 필수다.
  const enabled = state.groupBy !== null;
  const result = usePanel('groups', buildGroupsRequest(state), enabled);
  const groups = (result.body?.['groups'] as readonly AggregationGroup[] | undefined) ?? [];
  // 빈 그룹은 AggregationPanel이 자기 문구로 그린다(team 미투영 = 정상 빈 결과). slot에서
  // empty_no_data로 접으면 그 구분이 사라진다.
  const panel = resolvePanelState({ ...result, loginPath });

  if (!enabled) {
    return (
      <Panel as="section" aria-label="그룹 집계">
        <h3>그룹 집계</h3>
        <p data-testid="group-prompt">그룹 키를 선택하면 그룹별 집계가 나타납니다.</p>
      </Panel>
    );
  }
  if (!isRenderable(panel)) return <Panel as="section" aria-label="그룹 집계"><PanelStatus state={panel} /></Panel>;
  return (
    <AggregationPanel
      groups={groups}
      approximate={result.body?.approximate === true}
      truncated={result.body?.['truncated'] === true}
      hrefFor={hrefFor}
      groupLabel={state.groupBy ?? '그룹'}
    />
  );
}

function TimeSeriesSlot({
  state,
  loginPath,
  bucketHrefFor,
}: {
  readonly state: AnalyticsUrlState;
  readonly loginPath: string;
  readonly bucketHrefFor: (iso: string) => string | null;
}): ReactNode {
  const result = usePanel('time-series', buildTimeSeriesRequest(state));
  const buckets = (result.body?.['buckets'] as readonly string[] | undefined) ?? [];
  const series = (result.body?.['series'] as readonly { key: string; values: readonly number[] }[] | undefined) ?? [];
  const panel = resolvePanelState({ ...result, loginPath, isEmpty: !result.loading && result.status === 200 && buckets.length === 0 });

  if (!isRenderable(panel)) return <Panel as="section" aria-label="시계열"><PanelStatus state={panel} /></Panel>;
  return (
    <TimeSeriesChart
      buckets={buckets}
      series={series}
      truncated={result.body?.['truncated'] === true}
      bucketHrefFor={bucketHrefFor}
    />
  );
}

function PercentilesSlot({
  state,
  loginPath,
  field,
  title,
  percentiles,
}: {
  readonly state: AnalyticsUrlState;
  readonly loginPath: string;
  readonly field: 'lead_time_seconds' | 'first_review_wait_seconds';
  readonly title: string;
  readonly percentiles: readonly number[];
}): ReactNode {
  const result = usePanel('percentiles', buildPercentilesRequest(state, field));
  const body = result.body ?? {};
  const sampleSize = typeof body['sample_size'] === 'number' ? body['sample_size'] : 0;
  const lowSample = body['low_sample'] === true;
  const panel = resolvePanelState({
    ...result,
    loginPath,
    isEmpty: !result.loading && result.status === 200 && sampleSize === 0 && !lowSample,
  });

  // 서버는 백분위를 `overall: { p50, ... }`(중첩)로, 그룹별은 `groups: [{ key, p50, ... }]`로 준다.
  const overallSource = (body['overall'] as Record<string, unknown> | undefined) ?? body;
  const rawGroups = (body['groups'] as readonly Record<string, unknown>[] | undefined) ?? [];
  const groups = rawGroups.map((g) => {
    const groupLow = g['low_sample'] === true;
    return {
      key: String(g['key'] ?? ''),
      lowSample: groupLow,
      values: groupLow ? null : readPercentileValues(g, percentiles),
      rawValues: (g['raw_values'] as readonly number[] | undefined) ?? null,
      sampleSize: typeof g['sample_size'] === 'number' ? g['sample_size'] : 0,
    };
  });

  return (
    <Panel as="section" aria-label={title}>
      <h3>{title}</h3>
      {!isRenderable(panel) ? (
        <PanelStatus state={panel} />
      ) : (
        <PercentileCardRow
          percentiles={percentiles}
          overall={{
            lowSample,
            values: lowSample ? null : readPercentileValues(overallSource, percentiles),
            rawValues: (body['raw_values'] as readonly number[] | undefined) ?? null,
            sampleSize,
          }}
          groups={groups}
          excludedCount={typeof body['excluded_count'] === 'number' ? body['excluded_count'] : 0}
          excludedReasons={body['excluded_reasons'] as Readonly<Record<string, number>> | undefined}
        />
      )}
    </Panel>
  );
}

interface RawDistributionBucket {
  readonly key?: string;
  readonly label?: string;
  readonly count: number;
  readonly ratio: number;
  readonly drill_down_query: string | null;
}

function DistributionSlot({
  state,
  loginPath,
  dimension,
  title,
  hrefFor,
}: {
  readonly state: AnalyticsUrlState;
  readonly loginPath: string;
  readonly dimension: 'changed_files' | 'changed_lines';
  readonly title: string;
  readonly hrefFor: (q: string) => string | null;
}): ReactNode {
  const result = usePanel('distributions', buildDistributionsRequest(state, dimension));
  const raw = (result.body?.['buckets'] as readonly RawDistributionBucket[] | undefined) ?? [];
  const total = typeof result.body?.total?.value === 'number' ? result.body.total.value : 0;
  const panel = resolvePanelState({ ...result, loginPath, isEmpty: !result.loading && result.status === 200 && total === 0 });

  if (!isRenderable(panel)) return <Panel as="section" aria-label={title}><PanelStatus state={panel} /></Panel>;
  const buckets = raw.map((bucket) => ({
    label: bucket.label ?? bucket.key ?? '',
    count: bucket.count,
    ratio: bucket.ratio,
    drillDownQuery: bucket.drill_down_query,
    unknown: (bucket.key ?? bucket.label) === 'unknown' || bucket.drill_down_query === null,
  }));
  return <DistributionChart title={title} buckets={buckets} hrefFor={hrefFor} />;
}
