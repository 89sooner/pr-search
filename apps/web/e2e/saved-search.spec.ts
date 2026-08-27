import { expect, test, type Page } from '@playwright/test';

/**
 * W-008 저장된 검색 · W-001 저장 액션 (WP-033 / FR-SRCH-010, CR-049).
 *
 * **실제 브라우저에서만 확인되는 것**만 둔다. 판정은 `lib/saved-search.test.ts`가
 * 26건으로, 렌더와 접근성은 `a11y/saved-searches.test.tsx`가 17건으로 이미 건다.
 *
 * 여기서 거는 것은 넷이다.
 *
 *   1. 저장 대화상자가 **URL의 질의를 그대로** 담는다 — 화면이 다시 조립하지 않는다
 *   2. 실행이 **서버가 준 주소로** 실제 이동한다
 *   3. 두 목록이 **각자의 커서**로 순회하고 서로를 건드리지 않는다
 *   4. 커서 실패가 **자동 재조회 없이** 안내로 나타난다
 *
 * 넷 다 jsdom이 흉내 내지 못한다 — 실제 URL도, 실제 이동도, 실제 요청 순서도 없다.
 */

interface SavedItem {
  readonly saved_search_id: number;
  readonly name: string;
  readonly query: string;
  readonly visibility: 'private' | 'team';
  readonly target_team?: { team_id: number; org_id: number; slug: string };
  readonly owner: { user_id: string; login: string };
  readonly is_owner: boolean;
  readonly query_status: 'valid' | 'invalid';
  readonly created_at: string;
  readonly last_run_at: string | null;
}

function item(overrides: Partial<SavedItem> = {}): SavedItem {
  return {
    saved_search_id: 1,
    name: '결제 월간 리뷰',
    query: 'repo:acme/payments',
    visibility: 'private',
    owner: { user_id: 'sub-alice', login: 'alice' },
    is_owner: true,
    query_status: 'valid',
    created_at: '2026-08-27T09:00:00.000000Z',
    last_run_at: null,
    ...overrides,
  };
}

/**
 * 목록 대역.
 *
 * **요청 URL로 응답을 만든다** — 고정 응답은 틀린 입력을 받아 주고, 그 관대함이
 * 그대로 사각지대가 된다 (risks 44). `view`가 무엇인지에 따라 다른 목록을 준다.
 */
async function stubList(
  page: Page,
  pages: { readonly mine?: readonly unknown[]; readonly team?: readonly unknown[] },
): Promise<string[]> {
  const calls: string[] = [];
  const mine = [...(pages.mine ?? [{ items: [], next_cursor: null }])];
  const team = [...(pages.team ?? [{ items: [], next_cursor: null }])];

  await page.route('**/api/saved-searches?*', async (route) => {
    const url = route.request().url();
    calls.push(url);
    const view = new URL(url).searchParams.get('view');
    const queue = view === 'team' ? team : mine;
    const body = (queue.length > 1 ? queue.shift() : queue[0]) as Record<string, unknown>;
    await route.fulfill({
      status: (body['__status'] as number | undefined) ?? 200,
      contentType: 'application/json',
      body: JSON.stringify({ view, correlation_id: 'e2e', ...body }),
    });
  });

  return calls;
}

test.describe('W-008 목록 (FR-SRCH-010)', () => {
  test('**두 목록이 각자의 커서로 순회한다** — 한쪽이 다른 쪽을 건드리지 않는다', async ({ page }) => {
    const calls = await stubList(page, {
      mine: [
        { items: [item()], next_cursor: 'MINE-A' },
        { items: [item({ saved_search_id: 2, name: '두 번째' })], next_cursor: null },
      ],
      team: [{ items: [item({ saved_search_id: 9, name: '공유받은 것', is_owner: false })], next_cursor: null }],
    });

    await page.goto('/saved-searches');
    await expect(page.getByTestId('saved-mine-row-1')).toBeVisible();
    await expect(page.getByTestId('saved-team-row-9')).toBeVisible();

    await page.getByTestId('saved-mine').getByTestId('cursor-next').click();
    await expect(page.getByTestId('saved-mine-row-2')).toBeVisible();

    // 이어 보기 요청이 `view=mine`에만 커서를 실었다.
    const withCursor = calls.filter((one) => new URL(one).searchParams.get('cursor') !== null);
    expect(withCursor).toHaveLength(1);
    expect(new URL(withCursor[0] ?? '').searchParams.get('view')).toBe('mine');
    expect(new URL(withCursor[0] ?? '').searchParams.get('cursor')).toBe('MINE-A');

    // 팀 목록은 그대로다 — 다시 부르지 않았다.
    await expect(page.getByTestId('saved-team-row-9')).toBeVisible();
  });

  test('**커서가 거절되면 자동으로 다시 부르지 않는다**', async ({ page }) => {
    const calls = await stubList(page, {
      mine: [
        { items: [item()], next_cursor: 'MINE-A' },
        { __status: 400, error: { code: 'CURSOR_QUERY_MISMATCH', message: '조건이 바뀌었습니다' } },
      ],
    });

    await page.goto('/saved-searches');
    await expect(page.getByTestId('saved-mine-row-1')).toBeVisible();

    await page.getByTestId('saved-mine').getByTestId('cursor-next').click();
    await expect(page.getByTestId('saved-mine').getByTestId('cursor-failure')).toBeVisible();

    // 지금까지 본 목록이 남아 있다 — 사용자가 자기 위치를 잃지 않는다.
    await expect(page.getByTestId('saved-mine-row-1')).toBeVisible();

    /*
     * **세 번째 요청이 없어야 한다.** 실패를 보고 화면이 첫 페이지를 자동으로
     * 다시 부르면 목록이 처음으로 돌아간 것만 보이고 이유를 알 수 없다.
     */
    await page.waitForTimeout(300);
    expect(calls.filter((one) => new URL(one).searchParams.get('view') === 'mine')).toHaveLength(2);
  });

  test('**공유받은 항목에는 편집·삭제가 없다** (QA-W008-06)', async ({ page }) => {
    await stubList(page, {
      team: [{ items: [item({ saved_search_id: 9, is_owner: false, visibility: 'team' })], next_cursor: null }],
    });

    await page.goto('/saved-searches');
    await expect(page.getByTestId('saved-team-row-9-run')).toBeVisible();
    await expect(page.getByTestId('saved-team-row-9-edit')).toHaveCount(0);
    await expect(page.getByTestId('saved-team-row-9-delete')).toHaveCount(0);
  });

  test('**실행하면 서버가 준 주소로 이동한다**', async ({ page }) => {
    await stubList(page, { mine: [{ items: [item()], next_cursor: null }] });
    await page.route('**/api/saved-searches/1/run', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          saved_search_id: 1,
          query: 'repo:acme/payments',
          last_run_at: '2026-08-27T10:00:00.000000Z',
          navigation_url: '/search?q=repo%3Aacme%2Fpayments',
          correlation_id: 'e2e',
        }),
      });
    });
    // 이동 대상 화면의 조회는 비워 둔다 — 여기서 보는 것은 이동 자체다.
    await page.route('**/api/search*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          total: { value: 0, relation: 'eq' },
          items: [],
          next_cursor: null,
          correlation_id: 'e2e',
        }),
      });
    });

    await page.goto('/saved-searches');
    await page.getByTestId('saved-mine-row-1-run').click();

    await page.waitForURL('**/search?q=repo%3Aacme%2Fpayments');
    await expect(page.getByTestId('search-view')).toBeVisible();
  });

  test('**편집이 PATCH로 간다** — 화면 이동이 아니다', async ({ page }) => {
    await stubList(page, { mine: [{ items: [item()], next_cursor: null }] });
    const methods: string[] = [];
    await page.route('**/api/saved-searches/1', async (route) => {
      methods.push(route.request().method());
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ saved_search_id: 1, name: '새 이름' }),
      });
    });

    await page.goto('/saved-searches');
    await page.getByTestId('saved-mine-row-1-edit').click();

    // 대화상자가 열린다 — `/search`로 떠나지 않는다.
    await expect(page.getByTestId('save-search-dialog')).toBeVisible();
    expect(new URL(page.url()).pathname).toBe('/saved-searches');

    // 현재 값이 담겨 있고 질의를 고칠 수 있다.
    await expect(page.getByTestId('save-search-name')).toHaveValue('결제 월간 리뷰');
    await expect(page.getByTestId('save-search-query')).toHaveValue('repo:acme/payments');
    await page.getByTestId('save-search-query').fill('repo:acme/payments author:kim');

    await page.getByTestId('save-search-name').fill('새 이름');
    await page.getByTestId('save-search-submit').click();

    await expect.poll(() => methods).toContain('PATCH');
  });

  test('**무효 구간을 짚는다** (AC-6)', async ({ page }) => {
    await stubList(page, {
      mine: [
        {
          items: [
            item({
              saved_search_id: 7,
              query: 'repo:acme/a nosuchkey:value',
              query_status: 'invalid',
              // 파서가 주는 모양 그대로.
              query_error: { message: '지원하지 않는 검색 키입니다', detail: { offset_start: 12, offset_end: 21 } },
            } as Partial<SavedItem>),
          ],
          next_cursor: null,
        },
      ],
    });

    await page.goto('/saved-searches');
    await expect(page.getByTestId('saved-mine-row-7-invalid-span')).toHaveText('nosuchkey');
    // 짚되 글자를 잃지 않는다.
    await expect(page.getByTestId('saved-mine-row-7-query')).toHaveText('repo:acme/a nosuchkey:value');
    await expect(page.getByTestId('saved-mine-row-7-run')).toBeDisabled();
  });

  test('**삭제는 확인을 거친다**', async ({ page }) => {
    await stubList(page, { mine: [{ items: [item()], next_cursor: null }] });
    let deleted = 0;
    await page.route('**/api/saved-searches/1', async (route) => {
      if (route.request().method() === 'DELETE') deleted += 1;
      await route.fulfill({ status: 204, body: '' });
    });

    await page.goto('/saved-searches');
    await page.getByTestId('saved-mine-row-1-delete').click();

    // 누른 것만으로는 지워지지 않는다.
    expect(deleted).toBe(0);
    await expect(page.getByTestId('saved-mine-delete-dialog')).toBeVisible();

    await page.getByTestId('saved-mine-delete-confirm').click();
    await expect.poll(() => deleted).toBe(1);
  });
});

test.describe('W-001 저장 액션 (W-001-ACTIONS)', () => {
  async function stubSearch(page: Page): Promise<void> {
    await page.route('**/api/search*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          total: { value: 1, relation: 'eq' },
          sort: { field: 'merge_seq', order: 'desc' },
          items: [
            {
              kind: 'pull_request',
              repository: 'acme/payments',
              pr_number: 1,
              title: '결제 재시도',
              author: 'kim',
              state: 'merged',
              merge_seq: 10,
              seq_epoch: 1,
              sequence_space: 'acme/payments@main',
              merged_at: '2026-08-19T05:02:11Z',
              changed_files_count: 1,
              additions: 1,
              deletions: 1,
              url: '/pr/acme/payments/1',
            },
          ],
          next_cursor: null,
          correlation_id: 'e2e',
        }),
      });
    });
  }

  test('**대화상자가 URL의 질의를 그대로 담는다** — 화면이 다시 조립하지 않는다', async ({ page }) => {
    await stubSearch(page);
    await page.goto('/search?q=repo%3Aacme%2Fpayments+author%3Akim');

    await page.getByTestId('search-save').click();
    await expect(page.getByTestId('save-search-dialog')).toBeVisible();
    await expect(page.getByTestId('save-search-query')).toHaveValue('repo:acme/payments author:kim');
  });

  test('**질의가 없으면 저장 버튼이 없다**', async ({ page }) => {
    await stubSearch(page);
    await page.goto('/search');
    await expect(page.getByTestId('search-save')).toHaveCount(0);
  });

  test('**팀 공유를 고를 때만 대상 목록을 부른다**', async ({ page }) => {
    await stubSearch(page);
    let shareCalls = 0;
    await page.route('**/api/saved-searches/share-targets', async (route) => {
      shareCalls += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          teams: [{ team_id: 7, org_id: 1, slug: 'payments' }],
          correlation_id: 'e2e',
        }),
      });
    });

    await page.goto('/search?q=repo%3Aacme%2Fpayments');
    await page.getByTestId('search-save').click();
    await expect(page.getByTestId('save-search-dialog')).toBeVisible();

    // 열기만 해서는 부르지 않는다.
    expect(shareCalls).toBe(0);

    await page.getByTestId('save-search-visibility').click();
    await page.getByRole('option', { name: /팀 공유/ }).click();
    await expect.poll(() => shareCalls).toBe(1);
  });

  test('저장하면 안내가 뜨고 대화상자가 닫힌다', async ({ page }) => {
    await stubSearch(page);
    await page.route('**/api/saved-searches', async (route) => {
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ saved_search_id: 1, name: '결제 리뷰' }),
      });
    });

    await page.goto('/search?q=repo%3Aacme%2Fpayments');
    await page.getByTestId('search-save').click();
    await page.getByTestId('save-search-name').fill('결제 리뷰');
    await page.getByTestId('save-search-submit').click();

    await expect(page.getByTestId('save-search-dialog')).toHaveCount(0);
    await expect(page.getByTestId('search-saved-notice')).toContainText('결제 리뷰');
  });
});
