/**
 * 한국 시간 표시와 KST 달력 날짜 검색 — 실제 브라우저, 브라우저 시간대 셋 (CR-127, WP-108).
 *
 * 이 spec은 `workspace` 프로젝트에서 돈다(운영 기본 `/search` = RepositoryWorkspace).
 *
 * ## 무엇을 거는가
 *
 * 브라우저 시간대를 UTC·Asia/Seoul·America/Los_Angeles로 바꿔도 **화면 시각, 달력의 오늘,
 * 날짜 필터 요청이 같다**는 것(NFR-007 「시각 표시 기준」, FR-SRCH-005 AC-11). 「지금」은
 * KST 9/27 01:30으로 고정한다 — UTC와 LA에서는 아직 9/26이라, 브라우저 날짜를 쓰면
 * 달력의 오늘이 하루 어긋난다.
 *
 * 결과의 정답(어느 PR이 KST 9/27인가)은 여기서 판정하지 않는다 — 실제 PostgreSQL·
 * Elasticsearch를 거치는 `apps/search-api/integration/search/kst-calendar-range.test.ts`가
 * 건다. 여기서 확인하는 것은 **화면이 보내는 조건과 그리는 시각**이다.
 */

import { expect, test, type Page, type Route } from '@playwright/test';

const REPOSITORY = 'acme/kst';
/** KST 2026-09-27 01:30 = UTC 2026-09-26 16:30 = LA 2026-09-26 09:30. */
const NOW = new Date('2026-09-26T16:30:00Z');
const ZONES = ['UTC', 'Asia/Seoul', 'America/Los_Angeles'] as const;

/** 한국 자정 앞뒤. 표시는 브라우저와 무관하게 오른쪽 값이어야 한다. */
const ROWS = [
  { pr: 3, mergedAt: '2026-09-27T14:59:59Z', shown: '2026-09-27 23:59 KST' },
  { pr: 2, mergedAt: '2026-09-26T15:00:00Z', shown: '2026-09-27 00:00 KST' },
  { pr: 1, mergedAt: '2026-09-26T14:59:59Z', shown: '2026-09-26 23:59 KST' },
] as const;

const KST_QUERY = `kind:pull_request repo:"${REPOSITORY}" merged:2026-09-27..2026-09-27@Asia/Seoul`;
const LEGACY_QUERY = `kind:pull_request repo:"${REPOSITORY}" merged:2026-09-27..2026-09-27`;

function row(one: (typeof ROWS)[number]): Record<string, unknown> {
  return {
    kind: 'pull_request', repository: REPOSITORY, pr_number: one.pr, title: `PR ${String(one.pr)}`, author: 'kim',
    state: 'merged', merge_seq: one.pr, seq_epoch: 1, sequence_space: `${REPOSITORY}@main`, merge_number: null,
    merge_number_state: 'pending', merge_number_epoch: 1, merged_at: one.mergedAt, changed_files_count: 1,
    additions: 1, deletions: 0, url: `/pr/${REPOSITORY}/${String(one.pr)}`,
  };
}

/** 화면이 보낸 검색 질의(`q`)를 차례로 모은다. */
async function stubWorkspace(page: Page): Promise<string[]> {
  const queries: string[] = [];
  // 나중에 등록한 route를 먼저 본다 — 포괄 404를 먼저 둔다.
  await page.route('**/api/**', async (route: Route) => {
    await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: { code: 'NOT_FOUND', message: 'stubbed' } }) });
  });
  await page.route('**/api/repositories*', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        items: [{
          repository_id: 1, repository: REPOSITORY, registration_state: 'active', registered_at: '2026-08-01T00:00:00Z',
          last_ingested_at: '2026-09-26T15:00:00Z', document_counts: { pull_requests: 3, commits: 0, total: 3 }, backfill: null,
          sequence_spaces: [{ base_branch: 'main', last_sequence: 3, seq_epoch: 1, sequence_state: 'ok', last_assigned_at: '2026-09-26T15:00:00Z' }],
          reconciliation: { last_completed_at: null, missing_count: null }, unavailable: [],
        }],
        next_cursor: null,
        correlation_id: '00000000-0000-4000-8000-000000000000',
      }),
    });
  });
  await page.route('**/api/search*', async (route: Route) => {
    queries.push(new URL(route.request().url()).searchParams.get('q') ?? '');
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        total: { value: ROWS.length, relation: 'eq' }, items: ROWS.map(row), sort: { field: 'pr_number', order: 'desc' },
        facets_omitted: false, facets: { author: [], label: [], state: [] }, next_cursor: null,
        correlation_id: '00000000-0000-4000-8000-000000000000',
      }),
    });
  });
  return queries;
}

async function openDateRange(page: Page): Promise<void> {
  await page.getByRole('button', { name: /^Filters/ }).click();
  await page.getByRole('combobox', { name: 'Range filter' }).click();
  await page.getByRole('option', { name: 'Merged date' }).click();
}

for (const zone of ZONES) {
  test.describe(`브라우저 시간대 ${zone}`, () => {
    test.use({ timezoneId: zone });

    test('결과 표의 머지 시각은 KST이고 툴팁은 원본 UTC다', async ({ page }) => {
      await page.clock.setFixedTime(NOW);
      await stubWorkspace(page);
      await page.goto(`/search?repository=${encodeURIComponent(REPOSITORY)}`);
      const cells = page.locator('table.repo-table tbody time');
      await expect(cells).toHaveCount(ROWS.length);
      for (const [index, one] of ROWS.entries()) {
        await expect(cells.nth(index)).toHaveText(one.shown);
        await expect(cells.nth(index)).toHaveAttribute('title', `${one.mergedAt} (UTC)`);
        await expect(cells.nth(index)).toHaveAttribute('datetime', one.mergedAt);
      }
    });

    test('달력의 오늘은 KST 9/27이고, 그 하루를 고르면 요청이 KST 달력 범위다 — 새로고침·뒤로가기에서도 같다', async ({ page }) => {
      await page.clock.setFixedTime(NOW);
      const queries = await stubWorkspace(page);
      await page.goto(`/search?repository=${encodeURIComponent(REPOSITORY)}`);
      await openDateRange(page);

      await page.getByRole('button', { name: 'Merged from (KST)' }).click();
      await expect(page.getByRole('button', { name: 'September 27, 2026' })).toHaveAttribute('aria-current', 'date');
      await page.getByRole('button', { name: 'Today' }).click();
      await page.getByRole('button', { name: 'Merged to (KST)' }).click();
      await page.getByRole('button', { name: 'Today' }).click();
      await page.getByRole('button', { name: 'Search ↵' }).click();

      await expect.poll(() => queries.at(-1)).toBe(KST_QUERY);
      const url = new URL(page.url());
      expect(url.searchParams.get('from')).toBe('2026-09-27');
      expect(url.searchParams.get('to')).toBe('2026-09-27');
      expect(url.searchParams.get('tz')).toBe('Asia/Seoul');
      await expect(page.getByText('Merged 2026-09-27–2026-09-27 KST')).toBeVisible();

      // 새로고침: 같은 URL이 같은 조건을 다시 만든다.
      queries.length = 0;
      await page.reload();
      await expect.poll(() => queries.at(-1)).toBe(KST_QUERY);

      // 뒤로가기: 다른 화면에 갔다가 돌아와도 같은 조건이다.
      await page.goto('/saved-searches');
      queries.length = 0;
      await page.goBack();
      await expect.poll(() => queries.at(-1)).toBe(KST_QUERY);
    });

    test('시간대 없는 옛 URL은 UTC 하루로 그대로 실행하고 UTC 조건임을 표시한다', async ({ page }) => {
      await page.clock.setFixedTime(NOW);
      const queries = await stubWorkspace(page);
      await page.goto(`/search?repository=${encodeURIComponent(REPOSITORY)}&from=2026-09-27&to=2026-09-27`);
      await expect.poll(() => queries.at(-1)).toBe(LEGACY_QUERY);
      await page.getByRole('button', { name: /^Filters/ }).click();
      await expect(page.getByRole('button', { name: 'Merged from (UTC)' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Merged to (UTC)' })).toBeVisible();
      await expect(page.getByText('Merged 2026-09-27–2026-09-27 UTC')).toBeVisible();

      // 날짜를 새로 고르는 순간 KST 조건이 된다 — 조건이 바뀌므로 결과와 커서를 새로 받는다.
      await page.getByRole('button', { name: 'Merged from (UTC)' }).click();
      await page.getByRole('button', { name: 'September 27, 2026' }).click();
      await page.getByRole('button', { name: 'Search ↵' }).click();
      await expect.poll(() => queries.at(-1)).toBe(KST_QUERY);
      expect(new URL(page.url()).searchParams.get('tz')).toBe('Asia/Seoul');
    });
  });
}

const TIME_SERIES = {
  interval: 'day',
  timezone: 'Asia/Seoul',
  applied_range: { from: '2026-09-26', to: '2026-09-28' },
  total: { value: 7, relation: 'eq' },
  buckets: ['2026-09-26T00:00:00.000+09:00', '2026-09-27T00:00:00.000+09:00', '2026-09-28T00:00:00.000+09:00'],
  series: [{ key: 'all', values: [2, 3, 2] }],
  truncated: false,
  approximate: false,
  correlation_id: 'c-ts',
};

for (const zone of ZONES) {
  test.describe(`통계 — 브라우저 시간대 ${zone}`, () => {
    test.use({ timezoneId: zone });

    test('버킷 이름은 KST 날짜이고, 한국 날짜 하루를 누르면 그 하루의 KST 검색으로 간다', async ({ page }) => {
      await page.clock.setFixedTime(NOW);
      const requests: unknown[] = [];
      await page.route('**/api/analytics/**', async (route: Route) => {
        const url = route.request().url();
        if (url.includes('/analytics/time-series')) {
          requests.push(route.request().postDataJSON());
          return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(TIME_SERIES) });
        }
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) });
      });
      await page.goto(`/analytics?q=${encodeURIComponent(`repo:${REPOSITORY}`)}&from=2026-09-26&to=2026-09-28`);

      await expect.poll(() => requests.length).toBeGreaterThan(0);
      expect(requests[0]).toMatchObject({ from: '2026-09-26', to: '2026-09-28', timezone: 'Asia/Seoul' });

      await expect(page.getByRole('columnheader', { name: 'Range (KST)' })).toBeAttached();
      const links = page.getByTestId('bucket-drilldown');
      await expect(links).toHaveCount(3);
      await expect(links.nth(1)).toHaveText('2026-09-27');
      const href = await links.nth(1).getAttribute('href');
      expect(new URLSearchParams((href ?? '').split('?')[1] ?? '').get('q')).toBe(`repo:${REPOSITORY} merged:2026-09-27..2026-09-27@Asia/Seoul`);

      // 기간 달력의 오늘도 대시보드 시간대(KST)의 날짜다.
      await page.getByRole('button', { name: 'Start' }).click();
      await expect(page.getByRole('button', { name: 'September 27, 2026' })).toHaveAttribute('aria-current', 'date');
    });
  });
}
