import { expect, test, type Page } from '@playwright/test';

/**
 * FLOW-001 / W-001 통합 검색 (WP-016 DoD).
 *
 * **실제 브라우저에서만 확인되는 것**만 둔다. 상태 판정과 렌더링은
 * `lib/*.test.ts`와 `a11y/search.test.tsx`가 이미 더 촘촘하게 건다.
 *
 * 여기서 거는 것은 셋이다:
 *   1. **히스토리 동작** — 필터를 여러 번 만져도 뒤로가기 한 번이면 이전 화면
 *   2. **URL만으로 화면이 재현되는가** (QA-COMMON-09)
 *   3. **네트워크가 실제로 나가지 않는가** (QA-W001-04)
 *
 * 셋 다 jsdom이 흉내 내지 못한다 — 히스토리 스택도, 진짜 요청도 없다.
 */

const ROW = {
  kind: 'pull_request',
  repository: 'acme/payments',
  pr_number: 1234,
  title: 'feat: 결제 재시도',
  author: 'kim',
  state: 'merged',
  merge_seq: 1342,
  seq_epoch: 3,
  sequence_space: 'acme/payments@main',
  merged_at: '2026-08-19T05:02:11Z',
  changed_files_count: 2,
  additions: 120,
  deletions: 15,
  url: '/pr/acme/payments/1234',
};

/**
 * `search-api`를 가로챈다.
 *
 * e2e 환경에는 백엔드가 없다. **화면의 URL 규율을 거는 것**이 목적이므로
 * 응답을 고정하는 것이 옳다 — API 자체는 WP-013·WP-014의 통합 시험이 건다.
 */
async function stubSearch(page: Page, body: Record<string, unknown> = {}): Promise<string[]> {
  const calls: string[] = [];
  await page.route('**/api/search*', async (route) => {
    calls.push(route.request().url());
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        total: { value: 1, relation: 'eq' },
        items: [ROW],
        sort: { field: 'merge_seq', order: 'desc' },
        facets_omitted: false,
        facets: {
          author: [
            { value: 'kim', count: 18 },
            { value: 'lee', count: 11 },
          ],
          label: [
            { value: 'backend', count: 33 },
            { value: 'payment', count: 7 },
          ],
          state: [{ value: 'merged', count: 62 }],
        },
        next_cursor: null,
        correlation_id: '00000000-0000-4000-8000-000000000000',
        ...body,
      }),
    });
  });
  return calls;
}

/** 모든 API 호출을 센다. "부르지 않았다"를 걸기 위한 것이다. */
async function countApiCalls(page: Page): Promise<string[]> {
  const calls: string[] = [];
  await page.route('**/api/**', async (route) => {
    calls.push(route.request().url());
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  return calls;
}

test.describe('W-001이 실제 브라우저에서 선다', () => {
  test('`/search`가 셸과 함께 뜬다', async ({ page }) => {
    await stubSearch(page);
    await page.goto('/search');

    await expect(page.getByRole('banner')).toBeVisible();
    await expect(page.getByRole('heading', { name: '통합 검색', level: 1 })).toBeVisible();
    await expect(page.getByRole('searchbox')).toBeVisible();
  });

  test('질의 없이 들어오면 예시를 보여 준다 (`empty_no_query`)', async ({ page }) => {
    await stubSearch(page);
    await page.goto('/search');

    await expect(page.getByTestId('search-view')).toHaveAttribute(
      'data-screen-state',
      'empty_no_query',
    );
  });
});

test.describe('URL이 단일 진실이다 (QA-COMMON-09)', () => {
  test('**URL을 붙여넣으면 같은 화면이 재현된다**', async ({ page }) => {
    await stubSearch(page);
    await page.goto('/search?q=repo%3Aacme%2Fpayments+author%3Akim&sort=merged_at&order=asc');

    // 입력창이 URL의 질의를 그대로 담는다.
    await expect(page.getByRole('searchbox')).toHaveValue('repo:acme/payments author:kim');
    // 칩도 URL에서 나온다 — 화면 상태가 따로 있지 않다.
    await expect(page.getByRole('button', { name: 'author:kim 필터 제거' })).toBeVisible();
    await expect(page.getByTestId('search-view')).toHaveAttribute('data-screen-state', 'ready');
  });

  test('조회 요청이 URL의 조건을 그대로 싣는다', async ({ page }) => {
    const calls = await stubSearch(page);
    await page.goto('/search?q=repo%3Aacme%2Fpayments&sort=merged_at&order=asc');
    await expect(page.getByTestId('search-view')).toHaveAttribute('data-screen-state', 'ready');

    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('sort=merged_at');
    expect(calls[0]).toContain('order=asc');
  });
});

test.describe('히스토리 규율 (WP-016 DoD)', () => {
  test('**필터를 5회 조작한 뒤 뒤로가기 1회로 이전 화면에 돌아간다**', async ({ page }) => {
    await stubSearch(page);

    // 이전 화면을 만든다 — 뒤로가기가 돌아갈 곳이 있어야 한다.
    await page.goto('/');
    await expect(page).toHaveURL(/\/$/);

    await page.goto('/search?q=repo%3Aacme%2Fpayments');
    await expect(page.getByTestId('search-view')).toHaveAttribute('data-screen-state', 'ready');

    /*
     * 다섯 번 만진다 — 패싯 3회 + 정렬 2회. 전부 `router.replace`여야 한다.
     * `push`면 히스토리가 다섯 칸 쌓여 뒤로가기 한 번으로는 못 돌아간다.
     */
    await page.getByLabel('kim (18)').click();
    await page.getByLabel('lee (11)').click();
    await page.getByLabel('backend (33)').click();
    await page.getByRole('button', { name: '머지 시각' }).click();
    await page.getByRole('button', { name: '변경 파일' }).click();

    // 조건이 실제로 URL에 쌓였는지 확인한다 — 아무 일도 없었다면 시험이 무의미하다.
    await expect(page).toHaveURL(/author%3Akim/);
    await expect(page).toHaveURL(/sort=changed_files_count/);

    // **한 번**이면 충분해야 한다.
    await page.goBack();
    await expect(page).toHaveURL(/\/$/);
  });

  test('질의 제출은 히스토리에 남는다 — 새 조사다', async ({ page }) => {
    await stubSearch(page);
    await page.goto('/search?q=repo%3Aacme%2Fpayments');
    await expect(page.getByTestId('search-view')).toHaveAttribute('data-screen-state', 'ready');

    await page.getByRole('searchbox').fill('repo:acme/other');
    await page.getByRole('button', { name: '검색', exact: true }).click();
    await expect(page).toHaveURL(/acme%2Fother/);

    // 제출은 `push`이므로 뒤로가기가 직전 질의로 돌아간다.
    await page.goBack();
    await expect(page).toHaveURL(/acme%2Fpayments/);
  });
});

test.describe('클라이언트가 먼저 거절한다 (QA-W001-04)', () => {
  test('**7자 미만 hex는 네트워크 요청을 만들지 않는다**', async ({ page }) => {
    const calls = await countApiCalls(page);
    await page.goto('/search?q=a1b2c3');

    await expect(page.getByTestId('prefix-too-short')).toBeVisible();
    await expect(page.getByTestId('search-view')).toHaveAttribute(
      'data-screen-state',
      'error_prefix_too_short',
    );

    /*
     * 이 단언이 이 시험의 전부다. 실제 브라우저에서 **왕복이 0건**이어야
     * 한다 — 목이 아니라 진짜 네트워크 계층에서 센다.
     */
    expect(calls).toEqual([]);
  });

  test('입력 중에도 부르지 않는다 — 제출 버튼이 잠긴다', async ({ page }) => {
    const calls = await countApiCalls(page);
    await page.goto('/search');

    await page.getByRole('searchbox').fill('abc12');
    await expect(page.getByRole('button', { name: '검색', exact: true })).toBeDisabled();
    expect(calls).toEqual([]);
  });

  test('7자가 되면 잠금이 풀린다 — 하한이 7이다 (ADR-012)', async ({ page }) => {
    await stubSearch(page);
    await page.goto('/search');

    await page.getByRole('searchbox').fill('a1b2c3d');
    await expect(page.getByRole('button', { name: '검색', exact: true })).toBeEnabled();
  });
});

test.describe('오프셋 페이징을 시사하지 않는다 (QA-W001-14 절반 / DEV-075)', () => {
  test('페이지 번호 UI가 없다', async ({ page }) => {
    await stubSearch(page);
    await page.goto('/search?q=repo%3Aacme%2Fpayments');
    await expect(page.getByTestId('search-view')).toHaveAttribute('data-screen-state', 'ready');

    // 커서 동작 자체는 WP-032지만 **금지 규칙은 지금 세운다** — 나중에
    // 검사하면 이미 잘못 만든 뒤다.
    await expect(page.getByRole('navigation', { name: /페이지/ })).toHaveCount(0);
    await expect(page.locator('[aria-label*="페이지"]')).toHaveCount(0);
  });
});

test.describe('결과 행 (C-013)', () => {
  test('**행이 진짜 링크라 새 탭으로 열 수 있다**', async ({ page }) => {
    await stubSearch(page);
    await page.goto('/search?q=repo%3Aacme%2Fpayments');
    await expect(page.getByTestId('search-view')).toHaveAttribute('data-screen-state', 'ready');

    const link = page.getByTestId('result-link');
    await expect(link).toHaveAttribute('href', /\/pr\/acme\/payments\/1234/);
    // 원본 입력을 남긴다 (DEV-078) — 뒤로가기로 돌아오면 질의가 살아 있다.
    await expect(link).toHaveAttribute('href', /from_q=/);
  });
});
