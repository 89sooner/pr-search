import { expect, test, type Page } from '@playwright/test';

/**
 * M 번호 병기와 해석 진입 (WP-074 / FR-SEQ-008, CR-079 — 상세 설계 9절).
 *
 * **실제 브라우저에서만 확인되는 것**만 둔다. 판정은 `lib/merge-number.test.ts`가,
 * 렌더와 접근성은 `a11y/mnumber.test.tsx`가 이미 더 촘촘하게 건다.
 *
 * 여기서 거는 것은 넷이다.
 *
 *   1. **M 배지 링크를 눌러 실제로 PR 상세에 닿는가** — resolve 왕복과 라우팅이
 *      진짜로 이어지는지는 jsdom이 흉내 내지 못한다
 *   2. **경유지가 히스토리에 남지 않는가** — 뒤로가기가 목록으로 돌아와야 한다.
 *      `push`로 옮기면 뒤로가기가 경유지로 와서 다시 앞으로 튕긴다 (DEV-097)
 *   3. **복사한 URL을 새 창에 붙여넣어도 같은 곳에 닿는가** — 인용의 조건이다
 *   4. **자동 재검증이 실제 왕복 수로 계약을 지키는가** — 행 수만큼 늘지 않는다
 */

const BASE_ROW = {
  kind: 'pull_request',
  repository: 'acme/smp1900',
  title: 'feat: 결제 재시도',
  author: 'kim',
  state: 'merged',
  seq_epoch: 3,
  sequence_space: 'acme/smp1900@main',
  merged_at: '2026-08-19T05:02:11Z',
  changed_files_count: 2,
  additions: 120,
  deletions: 15,
};

const ASSIGNED_ROW = {
  ...BASE_ROW,
  pr_number: 1234,
  merge_seq: 1342,
  url: '/pr/acme/smp1900/1234',
  merge_number: 'M-1900-77',
  merge_number_state: 'assigned',
  merge_number_reason: null,
  merge_number_epoch: 3,
};

const PENDING_ROW = {
  ...BASE_ROW,
  pr_number: 1235,
  merge_seq: 1343,
  url: '/pr/acme/smp1900/1235',
  merge_number: null,
  merge_number_state: 'pending',
  merge_number_reason: 'predecessor_pending',
  merge_number_epoch: 3,
};

const PR_DETAIL = {
  repository: 'acme/smp1900',
  pr_number: 1234,
  title: 'feat: 결제 재시도',
  state: 'merged',
  author: 'kim',
  base_branch: 'main',
  head_branch: 'feat/retry',
  labels: ['backend'],
  reviewers: ['lee'],
  approved_by: ['lee'],
  created_at: '2026-08-18T09:00:00Z',
  merged_at: '2026-08-19T05:02:11Z',
  changed_files_count: 2,
  additions: 120,
  deletions: 15,
  merge_commit_sha: 'a'.repeat(40),
  source_commits: [{ commit_sha: 'b'.repeat(40) }],
  source_commits_truncated: false,
  source_commits_total: 1,
  merge_seq: 1342,
  seq_epoch: 3,
  sequence_space: 'acme/smp1900@main',
  merge_number: 'M-1900-77',
  merge_number_state: 'assigned',
  merge_number_reason: null,
  merge_number_epoch: 3,
};

interface Calls {
  readonly search: string[];
  readonly resolve: string[];
}

/**
 * `search-api`를 가로챈다.
 *
 * 응답 키는 API-SEQ-007이 정한 이름 그대로다 — 목이 이름을 지어내면 계약
 * 버그를 숨긴다 (WP-038에서 배운 것).
 */
async function stub(page: Page, options: { rows?: readonly unknown[] } = {}): Promise<Calls> {
  const calls: Calls = { search: [], resolve: [] };
  const rows = options.rows ?? [ASSIGNED_ROW];

  await page.route('**/api/merge-numbers/resolve*', async (route) => {
    calls.resolve.push(route.request().url());
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        sequence_space: 'acme/smp1900@main',
        seq_epoch: 3,
        sequence_state: 'ok',
        epoch_stale: false,
        pr_number: 1234,
        merge_seq: 1342,
        merge_number: 'M-1900-77',
        merge_number_state: 'assigned',
        merge_number_reason: null,
        merge_number_epoch: 3,
        correlation_id: 'c-resolve',
      }),
    });
  });

  await page.route('**/api/search*', async (route) => {
    calls.search.push(route.request().url());
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        total: { value: rows.length, relation: 'eq' },
        items: rows,
        sort: { field: 'merge_seq', order: 'desc' },
        facets_omitted: false,
        facets: {},
        next_cursor: null,
        correlation_id: 'c-search',
      }),
    });
  });

  await page.route('**/api/pull-requests/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(PR_DETAIL),
    });
  });

  // 상세 화면의 나머지 패널은 이 시험의 대상이 아니다. 빈 응답으로 둔다.
  await page.route('**/api/sequence-neighbors*', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [] }) });
  });

  return calls;
}

test.describe('M 번호 병기와 해석 진입', () => {
  test('목록의 M 배지를 누르면 resolve 한 번을 거쳐 PR 상세에 닿는다', async ({ page }) => {
    const calls = await stub(page);
    await page.goto('/search?q=repo%3Aacme%2Fsmp1900');

    const badge = page.getByTestId('mnumber-badge').first();
    await expect(badge).toHaveText('M-1900-77');

    await page.getByTestId('mnumber-link').first().click();

    await expect(page).toHaveURL(/\/pr\/acme\/smp1900\/1234/);
    await expect(page.getByTestId('pr-detail')).toHaveAttribute('data-screen-state', 'ready');

    // 경유지는 resolve를 **정확히 한 번** 부른다.
    expect(calls.resolve).toHaveLength(1);
    expect(calls.resolve[0]).toContain('merge_number=M-1900-77');
    expect(calls.resolve[0]).toContain('seq_epoch=3');
  });

  test('**뒤로가기가 목록으로 돌아온다** — 경유지는 히스토리에 남지 않는다', async ({ page }) => {
    await stub(page);
    await page.goto('/search?q=repo%3Aacme%2Fsmp1900');
    await expect(page.getByTestId('mnumber-link').first()).toBeVisible();

    await page.getByTestId('mnumber-link').first().click();
    await expect(page).toHaveURL(/\/pr\/acme\/smp1900\/1234/);

    await page.goBack();

    // 경유지(`m_number=…`)가 아니라 원래 목록이어야 한다.
    await expect(page).toHaveURL(/\/search\?q=/);
    await expect(page).not.toHaveURL(/m_number=/);
    await expect(page.getByTestId('result-row').first()).toBeVisible();
  });

  test('복사한 URL을 그대로 열어도 같은 PR에 닿는다 (인용의 조건)', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await stub(page);
    await page.goto('/pr/acme/smp1900/1234');
    await expect(page.getByTestId('mnumber-badge')).toHaveText('M-1900-77');

    await page.getByTestId('mnumber-copy').click();
    await expect(page.getByTestId('mnumber-copy-status')).toHaveText(/복사했습니다/);

    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toContain('m_repository=acme%2Fsmp1900');
    expect(copied).toContain('m_base_branch=main');
    expect(copied).toContain('m_seq_epoch=3');
    expect(copied).toContain('m_number=M-1900-77');

    // 붙여넣은 그 주소가 실제로 열린다.
    const next = await context.newPage();
    await stub(next);
    await next.goto(copied);
    await expect(next).toHaveURL(/\/pr\/acme\/smp1900\/1234/);
    await next.close();
  });

  test('키가 일부만 있으면 **아무 공간도 추측하지 않고** 무엇이 빠졌는지 말한다', async ({ page }) => {
    const calls = await stub(page);
    await page.goto('/search?m_repository=acme%2Fsmp1900&m_number=M-1900-77');

    await expect(page.getByTestId('search-view')).toHaveAttribute('data-screen-state', 'merge_number_entry');
    await expect(page.getByTestId('mnumber-entry')).toContainText('대상 브랜치');
    await expect(page.getByTestId('mnumber-entry')).toContainText('시퀀스 에폭');

    expect(calls.resolve).toHaveLength(0);
    expect(calls.search).toHaveLength(0);
  });

  test('대기 행의 자동 재검증은 **행 수가 아니라 요청 하나**를 다시 보낸다', async ({ page }) => {
    const calls = await stub(page, {
      rows: [PENDING_ROW, { ...PENDING_ROW, pr_number: 1236, merge_seq: 1344, url: '/pr/acme/smp1900/1236' }],
    });
    await page.goto('/search?q=repo%3Aacme%2Fsmp1900');
    await expect(page.getByTestId('result-row')).toHaveCount(2);

    const first = calls.search.length;
    expect(first).toBe(1);

    // 5초 간격이다. 두 tick이 지나면 두 번 더 — 행이 둘이어도 넷이 아니다.
    await expect.poll(() => calls.search.length, { timeout: 20_000 }).toBeGreaterThanOrEqual(first + 2);
    expect(calls.search.length).toBeLessThanOrEqual(first + 4);
    expect(calls.resolve).toHaveLength(0);
  });

  test('확정된 목록에는 자동 재검증이 돌지 않는다', async ({ page }) => {
    const calls = await stub(page);
    await page.goto('/search?q=repo%3Aacme%2Fsmp1900');
    await expect(page.getByTestId('mnumber-badge').first()).toBeVisible();

    await page.waitForTimeout(12_000);
    expect(calls.search).toHaveLength(1);
  });
});
