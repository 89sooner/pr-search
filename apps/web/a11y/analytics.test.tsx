/**
 * W-006 통계 대시보드 컴포넌트 (WP-038 DoD / QA-W006-16~18, NFR-007).
 *
 * 순수 판정은 `lib/analytics.test.ts`가 24건으로 이미 걸었다. 여기서 거는 것은
 * **그 판정이 실제로 그려지는가**와 접근성이다:
 *   - low_sample이면 백분위 대신 원값을 그리는가 (FR-STAT-003)
 *   - unknown 구간을 0과 다르게, 근거 링크 없이 그리는가 (FR-STAT-005 AC-5)
 *   - 모든 차트에 표 대체가 있는가 (QA-W006-18)
 *   - 개인 순위 배지·정렬 강조가 없는가 (QA-W006-17)
 *   - 탭이 화살표·Home·End로 움직이는가 (W-001-AGG 접근성)
 *   - axe 위반 0건 (QA-COMMON, 두 테마 대비는 conductor-check-contrast가 따로 본다)
 */

import { useState, type ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/search',
  useSearchParams: () => new URLSearchParams(''),
}));

const { PercentileCardRow } = await import('../components/PercentileCardRow');
const { AggregationPanel } = await import('../components/AggregationPanel');
const { DistributionChart } = await import('../components/DistributionChart');
const { TimeSeriesChart } = await import('../components/TimeSeriesChart');
const { TabList, TabPanel } = await import('../components/Tabs');

async function violations(container: HTMLElement): Promise<axe.Result[]> {
  const results = await axe.run(container, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
    rules: { 'color-contrast': { enabled: false } },
  });
  return results.violations;
}

const groups = [
  { key: 'payments-core', count: 412, changed_files_sum: 2841, additions_sum: 51240, lead_time_median: 61200, drill_down_query: 'kind:pull_request org:acme author_team:payments-core' },
  { key: 'session', count: 288, changed_files_sum: 1522, additions_sum: 29110, lead_time_median: 44100, drill_down_query: 'kind:pull_request org:acme author_team:session' },
];

afterEach(() => {
  cleanup();
});

describe('PercentileCardRow', () => {
  it('FR-STAT-003: 정상 표본이면 백분위 카드, 제외 건수를 함께 그린다', async () => {
    const { container } = render(
      <PercentileCardRow
        percentiles={[50, 75, 90, 95, 99]}
        overall={{ lowSample: false, values: { '50': 61200, '75': 80000, '90': 120000, '95': 200000, '99': 400000 }, rawValues: null, sampleSize: 412 }}
        excludedCount={17}
      />,
    );
    expect(screen.queryByTestId('raw-values')).toBeNull();
    expect(screen.getByTestId('excluded-count')).toHaveTextContent('17');
    expect(await violations(container)).toEqual([]);
  });

  it('그룹별 백분위 비교 행을 표로 그린다 (P2 리뷰)', async () => {
    const { container } = render(
      <PercentileCardRow
        percentiles={[50, 90, 95]}
        overall={{ lowSample: false, values: { '50': 61200, '90': 120000, '95': 200000 }, rawValues: null, sampleSize: 412 }}
        groups={[
          { key: 'payments-core', lowSample: false, values: { '50': 54000, '90': 216000, '95': 388800 }, rawValues: null, sampleSize: 412 },
          { key: 'session', lowSample: true, values: null, rawValues: [1000, 2000], sampleSize: 2 },
        ]}
        excludedCount={0}
      />,
    );
    expect(screen.getByText('payments-core')).toBeInTheDocument();
    // low_sample 그룹은 백분위 대신 표본 부족 배지
    expect(screen.getByText('session')).toBeInTheDocument();
    expect(await violations(container)).toEqual([]);
  });

  it('FR-STAT-003: low_sample이면 백분위 대신 원값을 그린다', async () => {
    const { container } = render(
      <PercentileCardRow
        percentiles={[50, 90, 95]}
        overall={{ lowSample: true, values: null, rawValues: [1200, 3400, 5600], sampleSize: 3 }}
        excludedCount={0}
      />,
    );
    expect(screen.getByTestId('raw-values')).toBeInTheDocument();
    expect(await violations(container)).toEqual([]);
  });
});

describe('AggregationPanel', () => {
  it('FR-STAT-001: 그룹 행과 근거 링크, 근사·절삭 배지를 그린다', async () => {
    const { container } = render(
      <AggregationPanel groups={groups} approximate truncated hrefFor={(q) => `/search?q=${encodeURIComponent(q)}`} groupLabel="team" />,
    );
    expect(screen.getByTestId('approximate-badge')).toBeInTheDocument();
    expect(screen.getByTestId('truncated-badge')).toBeInTheDocument();
    expect(screen.getAllByTestId('group-drilldown')).toHaveLength(2);
    // QA-W006-17: 개인 순위 배지·정렬 강조가 없다.
    expect(container.querySelector('[data-rank]')).toBeNull();
    expect(await violations(container)).toEqual([]);
  });

  it('빈 그룹을 0이나 오류가 아니라 "데이터 없음"으로 그린다 (team 미투영)', async () => {
    const { container } = render(<AggregationPanel groups={[]} hrefFor={() => null} groupLabel="team" />);
    expect(screen.getByTestId('group-empty')).toBeInTheDocument();
    expect(await violations(container)).toEqual([]);
  });
});

describe('DistributionChart (QA-W006-18, FR-STAT-005 AC-5)', () => {
  const buckets = [
    { label: '1', count: 120, ratio: 0.3, drillDownQuery: 'kind:pull_request changed_files:1', unknown: false },
    { label: '2-5', count: 200, ratio: 0.5, drillDownQuery: 'kind:pull_request changed_files:2..5', unknown: false },
    { label: 'unknown', count: 80, ratio: 0.2, drillDownQuery: null, unknown: true },
  ];

  it('표 대체를 제공하고, unknown을 0과 다르게·근거 링크 없이 그린다', async () => {
    const { container } = render(<DistributionChart title="변경 파일 수 분포" buckets={buckets} hrefFor={(q) => `/search?q=${encodeURIComponent(q)}`} />);
    // 표 대체 (QA-W006-18)
    expect(container.querySelector('table')).toBeInTheDocument();
    // 범위 구간은 드릴다운 링크가 있고, unknown은 없다 (AC-5)
    expect(screen.getAllByTestId('distribution-drilldown')).toHaveLength(2);
    const unknownRow = container.querySelector('[data-unknown="true"]');
    expect(unknownRow).not.toBeNull();
    expect(within(unknownRow as HTMLElement).queryByTestId('distribution-drilldown')).toBeNull();
    expect(within(unknownRow as HTMLElement).getByText(/보강 미완료/)).toBeInTheDocument();
    expect(await violations(container)).toEqual([]);
  });
});

describe('TimeSeriesChart (QA-W006-18, FR-STAT-002)', () => {
  const props = {
    buckets: ['2026-07-01', '2026-07-02', '2026-07-03'],
    series: [
      { key: 'payments-core', values: [14, 9, 0] },
      { key: 'session', values: [6, 11, 3] },
    ],
    bucketHrefFor: (iso: string) => `/search?q=${encodeURIComponent(`merged:${iso}`)}`,
  };

  it('범례와 표 대체를 제공하고, 버킷마다 근거 링크를 그린다', async () => {
    const { container } = render(<TimeSeriesChart {...props} />);
    expect(screen.getByTestId('series-legend')).toBeInTheDocument();
    expect(container.querySelector('table')).toBeInTheDocument();
    expect(screen.getAllByTestId('bucket-drilldown')).toHaveLength(3);
    // 색은 계열 구분에만 — 범례가 색과 이름을 함께 싣는다 (색 단독 금지)
    expect(screen.getByTestId('series-legend')).toHaveTextContent('payments-core');
    // M8: 계열 색은 dataviz 토큰이어야 한다 (status/severity 돌려쓰기 금지, ADR-006)
    const swatch = container.querySelector('[data-testid="series-legend"] span[aria-hidden="true"]');
    expect((swatch as HTMLElement).style.backgroundColor).toContain('--cdt-dataviz-series-');
    expect(await violations(container)).toEqual([]);
  });
});

describe('TabList — 접근성 탭 (W-001-AGG)', () => {
  function Harness(): ReactNode {
    const [active, setActive] = useState('results');
    return (
      <>
        <TabList
          tabs={[{ id: 'results', label: '결과' }, { id: 'aggregation', label: '집계' }]}
          activeId={active}
          onChange={setActive}
          label="보기 방식"
        />
        <TabPanel id="results" active={active === 'results'}>
          결과 내용
        </TabPanel>
        <TabPanel id="aggregation" active={active === 'aggregation'}>
          집계 내용
        </TabPanel>
      </>
    );
  }

  it('roving tabindex와 ARIA 연결을 갖추고 axe 0건', async () => {
    const { container } = render(<Harness />);
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(2);
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    expect(tabs[0]).toHaveAttribute('tabindex', '0');
    expect(tabs[1]).toHaveAttribute('tabindex', '-1');
    expect(tabs[0]).toHaveAttribute('aria-controls', 'tabpanel-results');
    // 비활성 패널은 hidden
    expect(container.querySelector('#tabpanel-aggregation')).toHaveAttribute('hidden');
    expect(await violations(container)).toEqual([]);
  });

  it('ArrowRight로 다음 탭이 선택된다 (자동 활성화)', () => {
    render(<Harness />);
    fireEvent.keyDown(screen.getByRole('tab', { name: '결과' }), { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: '집계' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: '결과' })).toHaveAttribute('aria-selected', 'false');
  });

  it('End는 마지막, Home은 첫 탭으로 간다', () => {
    render(<Harness />);
    fireEvent.keyDown(screen.getByRole('tab', { name: '결과' }), { key: 'End' });
    expect(screen.getByRole('tab', { name: '집계' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(screen.getByRole('tab', { name: '집계' }), { key: 'Home' });
    expect(screen.getByRole('tab', { name: '결과' })).toHaveAttribute('aria-selected', 'true');
  });
});
