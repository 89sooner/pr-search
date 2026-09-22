/**
 * RepositoryWorkspace의 Linked PRs (CR-116 / WP-101, FR-SRCH-002 AC-6).
 *
 * 이 spec은 `workspace` 프로젝트에서만 돈다 — `PRS_LEGACY_SEARCH` 없이 뜬 서버라
 * `/search`가 운영 기본 화면(RepositoryWorkspace)을 그린다.
 *
 * ## 무엇을 거는가
 *
 * 화면이 **API가 준 것을 그대로** 그린다는 것. CR-116은 잘못된 PR 번호를 정본에서
 * 지우는 변경이며, **화면에서 특정 번호를 숨겨 증상만 없애는 처리를 금지한다** —
 * 그런 처리가 들어오면 이 시험이 죽는다.
 *
 * 세 상태가 서로 다르게 보여야 한다는 것도 함께 건다.
 *
 * - 배열에 원소가 있으면 그 번호들을 **전부** 보여 준다(하나만 보여 주지 않는다).
 * - `[]`는 「검증한 범위에서 연결 없음」이라는 **사실**이라 `—`로 보인다.
 * - `null`은 「아직 모름」이라 `Pending`으로 보인다.
 *
 * 정본과 색인이 실제로 그 값을 갖는지는 여기서 판정하지 않는다 — 그것은
 * `apps/pipeline-worker/integration/worker/commit-links.test.ts`가 실제 ES의
 * `_source`로, `apps/search-api/integration/source/history-pull-requests.test.ts`가
 * API 응답으로 건다. 여기서 확인하는 것은 **화면이 그 사실을 왜곡하지 않는다**는 점이다.
 */

import { expect, test, type Page } from '@playwright/test';

const REPOSITORY = 'acme/payments';
const PATH = 'src/billing.ts';

const SHA_MANY = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
const SHA_EMPTY = 'b2c3d4e5f60718293a4b5c6d7e8f9012345678a1';
const SHA_PENDING = 'c3d4e5f60718293a4b5c6d7e8f9012345678a1b2';

/** 정본이 말하는 그대로다. 두 번호가 붙은 커밋이 이 시험의 핵심이다. */
const HISTORY = {
  repository: REPOSITORY,
  revision: SHA_MANY,
  path: PATH,
  next_page: null,
  commits: [
    { sha: SHA_MANY, parents: [], message: 'fix: retry\n', author: 'kim', date: '2026-09-01T00:00:00Z', pull_request_numbers: [521, 2400] },
    { sha: SHA_EMPTY, parents: [], message: 'chore: cleanup\n', author: 'lee', date: '2026-09-02T00:00:00Z', pull_request_numbers: [] },
    { sha: SHA_PENDING, parents: [], message: 'wip\n', author: 'kim', date: null, pull_request_numbers: null },
  ],
};

async function stubApis(page: Page): Promise<void> {
  // Playwright는 **나중에 등록한 route를 먼저** 본다. 포괄 404를 먼저 두어야 아래가 이긴다.
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
  await page.route('**/api/source/**/history*', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(HISTORY) });
  });
}

function historyUrl(): string {
  const params = new URLSearchParams({
    repository: REPOSITORY,
    tab: 'history',
    path: PATH,
    path_kind: 'file',
    source_ref: SHA_MANY,
    base: 'main',
  });
  return `/search?${params.toString()}`;
}

test.describe('RepositoryWorkspace — Linked PRs는 API가 준 집합 그대로다 (CR-116)', () => {
  test('여러 PR이 붙은 커밋은 번호를 전부 보여 준다 — 첫 번호만 보여 주지 않는다', async ({ page }) => {
    await stubApis(page);
    await page.goto(historyUrl());

    const row = page.locator('.source-history-table tbody tr').first();
    await expect(row).toBeVisible();
    const chips = row.locator('.source-pr-chip');
    await expect(chips).toHaveCount(2);
    await expect(chips.nth(0)).toContainText('#521');
    await expect(chips.nth(1)).toContainText('#2400');
  });

  test('빈 배열과 미확정을 다르게 그린다 — `[]`는 사실이고 `null`은 모름이다', async ({ page }) => {
    await stubApis(page);
    await page.goto(historyUrl());

    const rows = page.locator('.source-history-table tbody tr');
    await expect(rows).toHaveCount(3);
    // `[]` — 검증한 범위에서 연결이 없다. 칩도 Pending도 아니다.
    await expect(rows.nth(1).locator('.source-pr-empty')).toBeVisible();
    await expect(rows.nth(1).locator('.source-pr-chip')).toHaveCount(0);
    await expect(rows.nth(1).locator('.source-pr-pending')).toHaveCount(0);
    // `null` — 아직 모른다.
    await expect(rows.nth(2).locator('.source-pr-pending')).toContainText('Pending');
    await expect(rows.nth(2).locator('.source-pr-empty')).toHaveCount(0);
  });

  test('조회 실패는 History 본문을 지우지 않는다', async ({ page }) => {
    await stubApis(page);
    await page.route('**/api/source/**/history*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ...HISTORY,
          pull_requests_unavailable: true,
          commits: HISTORY.commits.map((commit) => ({ ...commit, pull_request_numbers: null })),
        }),
      });
    });
    await page.goto(historyUrl());

    // 커밋 목록은 그대로 있고, 연결만 미확정으로 보인다.
    await expect(page.locator('.source-history-table tbody tr')).toHaveCount(3);
    await expect(page.locator('.source-pr-pending').first()).toBeVisible();
    await expect(page.getByText('PR link lookup is temporarily unavailable.')).toBeVisible();
  });
});
