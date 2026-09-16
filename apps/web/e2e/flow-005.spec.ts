import { expect, test, type Page, type Route } from '@playwright/test';

/**
 * FLOW-005 통계에서 근거 목록으로 (WP-038 DoD / FR-STAT-001~006).
 *
 * **실제 브라우저에서만 확인되는 것**만 둔다:
 *   1. 여섯 패널이 독립으로 조회되고, 한 패널(시계열 504)이 실패해도 나머지가 산다
 *   2. approximate 배지가 실제로 뜬다
 *   3. epoch_stale를 빈 결과가 아니라 그 사실로 그린다
 *   4. 그룹 클릭이 서버 drill_down_query 그대로 W-001로 간다
 *   5. team 빈 그룹을 0이나 오류가 아니라 "데이터 없음"으로 그린다
 *   6. 집계가 PR을 대상으로 함을 화면이 밝힌다
 *   7. W-001 집계 탭이 실제로 열리고 대시보드로 넘어가는 링크가 있다
 */

const GROUPS = {
  query: 'org:acme',
  group_by: 'team',
  total: { value: 700, relation: 'eq' },
  groups: [
    { key: 'payments-core', count: 412, changed_files_sum: 2841, additions_sum: 51240, lead_time_median: 61200, drill_down_query: 'kind:pull_request org:acme author_team:payments-core' },
    { key: 'session', count: 288, changed_files_sum: 1522, additions_sum: 29110, lead_time_median: 44100, drill_down_query: 'kind:pull_request org:acme author_team:session' },
  ],
  truncated: false,
  approximate: false,
  correlation_id: 'c-groups',
};

const TIME_SERIES = {
  interval: 'day',
  timezone: 'Asia/Seoul',
  applied_range: { from: '2026-07-01T00:00:00Z', to: '2026-07-03T00:00:00Z' },
  total: { value: 700, relation: 'eq' },
  buckets: ['2026-07-01', '2026-07-02', '2026-07-03'],
  series: [{ key: 'payments-core', values: [14, 9, 0] }],
  truncated: false,
  approximate: false,
  correlation_id: 'c-ts',
};

const PERCENTILES = {
  field: 'lead_time_seconds',
  unit: 'seconds',
  p50: 61200,
  p75: 80000,
  p90: 120000,
  p95: 200000,
  p99: 400000,
  overall: { p50: 61200, p75: 80000, p90: 120000, p95: 200000, p99: 400000 },
  sample_size: 412,
  low_sample: false,
  groups: [{ key: 'payments-core', p50: 54000, p75: 108000, p90: 216000, p95: 388800, p99: 777600, sample_size: 412, low_sample: false }],
  excluded_count: 17,
  excluded_reasons: { no_review: 17 },
  total: { value: 412, relation: 'eq' },
  approximate: false,
  correlation_id: 'c-pct',
};

const DISTRIBUTIONS = {
  dimension: 'changed_files',
  total: { value: 400, relation: 'eq' },
  buckets: [
    { key: '1', count: 120, ratio: 0.3, drill_down_query: 'kind:pull_request changed_files:1' },
    { key: '2-5', count: 200, ratio: 0.5, drill_down_query: 'kind:pull_request changed_files:2..5' },
    { key: 'unknown', count: 80, ratio: 0.2, drill_down_query: null },
  ],
  approximate: false,
  correlation_id: 'c-dist',
};

interface MockConfig {
  timeSeriesStatus: number;
  groupsBody: unknown;
}

async function installRoutes(page: Page, config: MockConfig): Promise<void> {
  await page.route('**/api/analytics/**', async (route: Route) => {
    const url = route.request().url();
    const json = (status: number, body: unknown): Promise<void> =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.includes('/analytics/groups')) return json(200, config.groupsBody);
    if (url.includes('/analytics/time-series')) {
      if (config.timeSeriesStatus !== 200) {
        return json(config.timeSeriesStatus, { error: { code: 'AGGREGATION_TIMEOUT', message: '집계가 예산을 넘겼습니다' }, correlation_id: 'c-ts' });
      }
      return json(200, TIME_SERIES);
    }
    if (url.includes('/analytics/percentiles')) return json(200, PERCENTILES);
    if (url.includes('/analytics/distributions')) return json(200, DISTRIBUTIONS);
    return json(200, {});
  });
}

test.describe('FLOW-005 통계 대시보드', () => {
  test('여섯 패널이 독립으로 서고, 시계열 504가 나머지를 비우지 않는다', async ({ page }) => {
    await installRoutes(page, { timeSeriesStatus: 504, groupsBody: GROUPS });
    await page.goto('/analytics?q=org%3Aacme&group_by=team');

    // 그룹 패널은 산다.
    await expect(page.getByTestId('group-drilldown').first()).toBeVisible();
    // 시계열만 timeout 상태다 — 다른 패널을 비우지 않는다.
    await expect(page.getByText("The aggregation timed out.")).toBeVisible();
    // 백분위·제외 건수는 여전히 뜬다.
    await expect(page.getByRole('region', { name: "Lead time distribution" }).getByTestId('excluded-count')).toContainText('17');
    // 분포의 unknown은 근거 링크가 없다.
    await expect(page.locator('[data-unknown="true"]').first()).toBeVisible();
  });

  test('집계가 PR을 대상으로 함을 밝힌다', async ({ page }) => {
    await installRoutes(page, { timeSeriesStatus: 200, groupsBody: GROUPS });
    await page.goto('/analytics?q=org%3Aacme');
    await expect(page.getByTestId('pr-population-note')).toContainText('Pull Request');
  });

  test('그룹 클릭이 서버 drill_down_query 그대로 W-001로 간다', async ({ page }) => {
    await installRoutes(page, { timeSeriesStatus: 200, groupsBody: GROUPS });
    await page.goto('/analytics?q=org%3Aacme&group_by=team');
    await page.getByTestId('group-drilldown').first().click();
    await expect(page).toHaveURL(/\/search\?q=kind%3Apull_request\+org%3Aacme\+author_team%3Apayments-core/);
  });

  test('approximate면 근사 배지가 뜬다', async ({ page }) => {
    await installRoutes(page, { timeSeriesStatus: 200, groupsBody: { ...GROUPS, approximate: true, sample_probability: 0.1 } });
    await page.goto('/analytics?q=org%3Aacme&group_by=team');
    await expect(page.getByTestId('approximate-badge')).toBeVisible();
  });

  test('epoch_stale를 빈 결과가 아니라 그 사실로 그린다', async ({ page }) => {
    const stale = { query: 'seq:1200..1350', sequence_context: { sequence_space: 'acme/a@main' }, requested_seq_epoch: 'old-epoch', epoch_stale: true, correlation_id: 'c-stale' };
    await installRoutes(page, { timeSeriesStatus: 200, groupsBody: stale });
    await page.goto('/analytics?q=seq%3A1200..1350&group_by=team&seq_epoch=old-epoch');
    await expect(page.getByTestId('epoch-stale').first()).toContainText("Epoch");
  });

  test('그룹 키가 없으면 그룹 패널은 조회하지 않고 안내를 그린다', async ({ page }) => {
    const groupsCalls: string[] = [];
    await page.route('**/api/analytics/**', async (route: Route) => {
      const url = route.request().url();
      if (url.includes('/analytics/groups')) groupsCalls.push(url);
      const json = (status: number, body: unknown): Promise<void> =>
        route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
      if (url.includes('/analytics/time-series')) return json(200, TIME_SERIES);
      if (url.includes('/analytics/percentiles')) return json(200, PERCENTILES);
      if (url.includes('/analytics/distributions')) return json(200, DISTRIBUTIONS);
      return json(200, GROUPS);
    });
    // group_by 없이 진입한다.
    await page.goto('/analytics?q=org%3Aacme');
    await expect(page.getByTestId('group-prompt')).toBeVisible();
    // 다른 패널은 뜬다 — 그룹만 조회를 미룬다.
    await expect(page.getByTestId('pr-population-note')).toBeVisible();
    // 그룹 엔드포인트는 부르지 않았다(400을 받지 않는다).
    expect(groupsCalls).toHaveLength(0);
  });

  test('team 빈 그룹을 데이터 없음으로 그린다', async ({ page }) => {
    await installRoutes(page, { timeSeriesStatus: 200, groupsBody: { ...GROUPS, groups: [], total: { value: 0, relation: 'eq' } } });
    await page.goto('/analytics?q=org%3Aacme&group_by=team');
    await expect(page.getByText("No data is available for this group.")).toBeVisible();
  });
});

test.describe('FLOW-005 W-001 집계 탭', () => {
  test('집계 탭을 열면 집계가 뜨고 대시보드 링크가 있다', async ({ page }) => {
    await page.route('**/api/**', async (route: Route) => {
      const url = route.request().url();
      if (url.includes('/api/analytics/groups')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(GROUPS) });
      }
      // 검색 목록·기타는 빈 응답으로 둔다 — 이 시험은 집계 탭만 본다.
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ results: [], items: [] }) });
    });
    await page.goto('/search?q=org%3Aacme');
    await page.getByRole('tab', { name: "Aggregation" }).click();
    await expect(page.getByTestId('search-aggregation')).toBeVisible();
    await expect(page.getByTestId('open-dashboard')).toHaveAttribute('href', /\/analytics/);
  });
});
