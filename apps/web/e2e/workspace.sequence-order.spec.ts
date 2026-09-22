/**
 * RepositoryWorkspace의 M number 정렬 (CR-113 / WP-098, FR-SRCH-007).
 *
 * 이 spec은 `workspace` 프로젝트에서만 돈다 — `PRS_LEGACY_SEARCH` 없이 뜬 서버라 `/search`가
 * 운영 기본 화면(RepositoryWorkspace)을 그린다. 다른 spec은 legacy `SearchView`를 본다.
 *
 * ## 무엇을 거는가
 *
 * 화면이 **API가 준 순서를 그대로** 그리고, 헤더 클릭이 `sort=merge_seq`를 서버에 보낸다는 것.
 * 서수가 정본과 같은지는 여기서 판정하지 않는다 — 그것은 search-api 통합 시험
 * (`sequence-projection-recovery.test.ts`)이 ES 원시 필드로 건다. 여기서 확인하는 것은
 * 화면이 클라이언트에서 재정렬하거나 M 문자열을 정렬해 증상을 숨기지 않는다는 점이다.
 */

import { expect, test, type Page } from '@playwright/test';

const REPOSITORY = 'acme/payments';

/** 서수·PR 번호·merged_at의 순서가 서로 다르다 — 어느 하나로 다른 것을 추정할 수 없다. */
const ROWS = [
  { pr: 307, seq: 5, m: 'M-ACME-5', mergedAt: '2026-09-02T00:00:00Z' },
  { pr: 302, seq: 4, m: 'M-ACME-4', mergedAt: '2026-09-04T00:00:00Z' },
  { pr: 309, seq: 3, m: 'M-ACME-3', mergedAt: '2026-09-01T00:00:00Z' },
  { pr: 301, seq: 2, m: 'M-ACME-2', mergedAt: '2026-09-05T00:00:00Z' },
  { pr: 305, seq: 1, m: 'M-ACME-1', mergedAt: '2026-09-03T00:00:00Z' },
] as const;

function row(one: (typeof ROWS)[number]): Record<string, unknown> {
  return {
    kind: 'pull_request',
    repository: REPOSITORY,
    pr_number: one.pr,
    title: `PR ${String(one.pr)}`,
    author: 'kim',
    state: 'merged',
    merge_seq: one.seq,
    seq_epoch: 1,
    sequence_space: `${REPOSITORY}@main`,
    merge_number: one.m,
    merge_number_state: 'assigned',
    merge_number_epoch: 1,
    merged_at: one.mergedAt,
    changed_files_count: 1,
    additions: 10,
    deletions: 1,
    url: `/pr/${REPOSITORY}/${String(one.pr)}`,
  };
}

async function stubApis(page: Page): Promise<string[]> {
  const searches: string[] = [];
  // Playwright는 **나중에 등록한 route를 먼저** 본다. 포괄 404를 먼저 두어야 아래 구체 경로가 이긴다.
  // 나머지(소스 트리 등)는 이 spec의 관심이 아니다 — 빈 200이 아니라 404를 준다. 빈 본문은 그 패널이 기대하는 모양이 아니다.
  await page.route('**/api/**', async (route) => {
    await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: { code: 'NOT_FOUND', message: 'stubbed' } }) });
  });
  await page.route('**/api/repositories*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        items: [
          {
            repository_id: 1,
            repository: REPOSITORY,
            registration_state: 'active',
            registered_at: '2026-08-01T00:00:00Z',
            last_ingested_at: '2026-09-05T00:00:00Z',
            document_counts: { pull_requests: 5, commits: 5, total: 10 },
            backfill: null,
            sequence_spaces: [{ base_branch: 'main', last_sequence: 5, seq_epoch: 1, sequence_state: 'ok', last_assigned_at: '2026-09-05T00:00:00Z' }],
            reconciliation: { last_completed_at: null, missing_count: null },
            unavailable: [],
          },
        ],
        next_cursor: null,
        correlation_id: '00000000-0000-4000-8000-000000000000',
      }),
    });
  });
  await page.route('**/api/search*', async (route) => {
    const url = new URL(route.request().url());
    searches.push(url.search);
    const sort = url.searchParams.get('sort') ?? 'pr_number';
    const order = url.searchParams.get('order') ?? 'desc';
    // 서버가 정렬한다. 화면은 이 순서를 그대로 그려야 한다.
    const sorted = [...ROWS].sort((a, b) => {
      const key = sort === 'merge_seq' ? a.seq - b.seq : sort === 'merged_at' ? a.mergedAt.localeCompare(b.mergedAt) : a.pr - b.pr;
      return order === 'asc' ? key : -key;
    });
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        total: { value: ROWS.length, relation: 'eq' },
        items: sorted.map(row),
        sort: { field: sort, order },
        facets_omitted: false,
        facets: { author: [{ value: 'kim', count: 5 }], label: [], state: [{ value: 'merged', count: 5 }] },
        next_cursor: null,
        correlation_id: '00000000-0000-4000-8000-000000000000',
      }),
    });
  });
  return searches;
}

async function renderedPrNumbers(page: Page): Promise<number[]> {
  const links = page.locator('table.repo-table tbody .repo-pr-link');
  await expect(links).toHaveCount(ROWS.length);
  const texts = await links.allTextContents();
  return texts.map((text) => Number(text.replace('#', '')));
}

test.describe('RepositoryWorkspace — M number 정렬은 서버 순서를 그대로 그린다 (CR-113)', () => {
  test('헤더를 누르면 sort=merge_seq를 보내고, 표는 API 순서(서수 내림차순)를 그대로 따른다', async ({ page }) => {
    const searches = await stubApis(page);
    await page.goto(`/search?repository=${encodeURIComponent(REPOSITORY)}&tab=all`);
    await expect(page.getByRole('table')).toBeVisible();

    // 기본 정렬은 PR 번호다 (CR-099). 여기서는 서수 순서와 다르다는 것만 확인한다.
    const initial = await renderedPrNumbers(page);
    expect(initial).toEqual([309, 307, 305, 302, 301]);

    await page.getByRole('button', { name: /^M number/ }).click();
    await expect.poll(() => searches.some((one) => one.includes('sort=merge_seq'))).toBe(true);
    await expect.poll(() => renderedPrNumbers(page)).toEqual([307, 302, 309, 301, 305]);

    // 서수 순서는 PR 번호 순서와도 merged_at 순서와도 다르다 — 화면이 어느 쪽으로도 재정렬하지 않았다.
    expect([307, 302, 309, 301, 305]).not.toEqual([309, 307, 305, 302, 301]);
    expect([307, 302, 309, 301, 305]).not.toEqual([301, 302, 305, 307, 309]);

    // M 배지는 API가 준 표시값을 그대로 보여 준다 — 화면이 서수에서 문자열을 만들지 않는다.
    await expect(page.locator('table.repo-table tbody tr').first().locator('.repo-mnumber')).toContainText('M-ACME-5');
    await expect(page.getByRole('columnheader', { name: /M number/ })).toHaveAttribute('aria-sort', 'descending');
  });

  test('오름차순으로 바꾸면 order=asc를 보내고 표가 뒤집힌다', async ({ page }) => {
    const searches = await stubApis(page);
    await page.goto(`/search?repository=${encodeURIComponent(REPOSITORY)}&tab=all&sort=merge_seq&order=desc`);
    await expect.poll(() => renderedPrNumbers(page)).toEqual([307, 302, 309, 301, 305]);
    await page.getByRole('button', { name: /^M number/ }).click();
    await expect.poll(() => searches.some((one) => one.includes('sort=merge_seq') && one.includes('order=asc'))).toBe(true);
    await expect.poll(() => renderedPrNumbers(page)).toEqual([305, 301, 309, 302, 307]);
  });
});
