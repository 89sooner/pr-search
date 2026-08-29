'use client';

/**
 * W-001-AGG 집계 탭 (WP-038 / FR-STAT-006).
 *
 * ## 검색과 같은 파서, 같은 접근 범위
 *
 * 현재 검색 질의 문자열을 그대로 집계 요청에 보낸다 — 집계 전용 문법을 두지 않는다
 * (FR-STAT-006 AC-1, CR-053). 서버가 같은 파서로 같은 필터 트리를 만든다.
 *
 * ## 총계는 PR 기준이다
 *
 * 집계 총계는 PR 모집단을 세므로 목록 총계(PR+커밋)와 다를 수 있다(AC-2). 화면이
 * 그 사실을 밝힌다. 전체 대시보드는 «대시보드에서 보기»로 넘어간다.
 */

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { Banner, Panel, Spinner } from '@conductor-by-89soone/react';
import { AggregationPanel, type AggregationGroup } from './AggregationPanel';
import {
  analyticsHref,
  buildGroupsRequest,
  drillDownHref,
  resolvePanelState,
  EMPTY_ANALYTICS_STATE,
  type AnalyticsBody,
} from '../lib/analytics';

export interface SearchAggregationTabProps {
  readonly q: string;
  readonly seqEpoch: string | null;
  readonly loginPath: string;
}

interface Result {
  readonly loading: boolean;
  readonly networkFailed: boolean;
  readonly status: number | null;
  readonly body: (AnalyticsBody & Record<string, unknown>) | null;
}

export function SearchAggregationTab({ q, seqEpoch, loginPath }: SearchAggregationTabProps): ReactNode {
  // 그룹 엔드포인트는 group_by가 필수다. 검색 위 집계의 기본 그룹은 작성자로 둔다.
  const state = { ...EMPTY_ANALYTICS_STATE, q, seqEpoch, groupBy: 'author' as const };
  const requestKey = JSON.stringify(buildGroupsRequest(state));
  const [result, setResult] = useState<Result>({ loading: true, networkFailed: false, status: null, body: null });

  useEffect(() => {
    const controller = new AbortController();
    setResult({ loading: true, networkFailed: false, status: null, body: null });
    void (async () => {
      try {
        const response = await fetch('/api/analytics/groups', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: requestKey,
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
  }, [requestKey]);

  const groups = (result.body?.['groups'] as readonly AggregationGroup[] | undefined) ?? [];
  const panel = resolvePanelState({
    loading: result.loading,
    networkFailed: result.networkFailed,
    status: result.status,
    body: result.body,
    loginPath,
    isEmpty: !result.loading && result.status === 200 && groups.length === 0,
  });

  return (
    <div data-testid="search-aggregation">
      <p>
        <Link href={analyticsHref(state)} data-testid="open-dashboard">
          대시보드에서 보기
        </Link>
      </p>

      {panel.kind === 'loading' ? (
        <Spinner label="집계를 불러오는 중" />
      ) : panel.kind === 'ready' || panel.kind === 'approximate' ? (
        <AggregationPanel
          groups={groups}
          approximate={result.body?.approximate === true}
          truncated={result.body?.['truncated'] === true}
          hrefFor={(query) => drillDownHref(query, seqEpoch)}
        />
      ) : panel.kind === 'epoch_stale' ? (
        <Banner tone="warning">
          질의의 시퀀스 범위가 딛고 선 에폭이 현재와 다릅니다. 집계를 그리지 않습니다.
        </Banner>
      ) : panel.kind === 'empty_no_data' ? (
        <Panel as="section">
          <p>이 질의로 집계할 Pull Request가 없습니다.</p>
        </Panel>
      ) : (
        <Banner tone="warning">집계를 불러오지 못했습니다.</Banner>
      )}
    </div>
  );
}
