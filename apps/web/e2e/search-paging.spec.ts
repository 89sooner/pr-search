import { expect, test, type Page } from '@playwright/test';

/**
 * W-001 이어 보기·패싯·강조 (WP-032 / FR-SRCH-008·009·011).
 *
 * **실제 브라우저에서만 확인되는 것**만 둔다. 상태 판정과 조각 조립은
 * `lib/*.test.ts`가, 접근성은 `a11y/search.test.tsx`가 더 촘촘하게 건다.
 *
 * 여기서 거는 것은 넷이다.
 *
 *   1. 이어 보기가 **커서를 그대로 되돌려 보내고** 결과를 쌓는다
 *   2. **첫 페이지만** `facets=true`다 (QA-W001-27)
 *   3. 커서 실패가 **자동 재조회 없이** 안내로 나타난다 (DEV-273)
 *   4. 강조가 `<mark>`로 그려지고 **원문의 마크업은 글자로 남는다** (THR-018)
 *
 * 넷 다 jsdom이 흉내 내지 못한다 — 실제 요청 순서도, 실제 DOM 이스케이프도 없다.
 */

function row(n: number, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: 'pull_request',
    repository: 'acme/payments',
    pr_number: n,
    title: `결제 재시도 ${String(n)}`,
    author: 'kim',
    state: 'merged',
    merge_seq: 2000 - n,
    seq_epoch: 3,
    sequence_space: 'acme/payments@main',
    merged_at: '2026-08-19T05:02:11Z',
    changed_files_count: 1,
    additions: 1,
    deletions: 1,
    url: `/pr/acme/payments/${String(n)}`,
    ...extra,
  };
}

const FACETS = {
  facets: {
    author: [{ value: 'kim', count: 18 }],
    repository: [{ value: 'acme/payments', count: 18 }],
  },
  facets_omitted: false,
  facets_status: 'ready',
};

/**
 * 페이지를 순서대로 돌려주는 대역.
 *
 * **요청 URL을 그대로 기록한다.** 이 파일의 단언 절반이 "무엇을 실어 보냈는가"에
 * 걸려 있다 — 커서를 해석하지 않고 되돌려 보내는지, 두 번째 페이지가 패싯을
 * 다시 요청하지 않는지는 응답이 아니라 **요청**이 말한다.
 */
async function stubPages(page: Page, pages: readonly Record<string, unknown>[]): Promise<string[]> {
  const calls: string[] = [];
  let index = 0;
  await page.route('**/api/search*', async (route) => {
    const url = route.request().url();
    calls.push(url);
    const body = pages[Math.min(index, pages.length - 1)] as Record<string, unknown>;
    index += 1;
    await route.fulfill({
      status: (body['__status'] as number | undefined) ?? 200,
      contentType: 'application/json',
      body: JSON.stringify({
        total: { value: 3, relation: 'eq' },
        sort: { field: 'merge_seq', order: 'desc' },
        correlation_id: '00000000-0000-4000-8000-000000000000',
        ...body,
      }),
    });
  });
  return calls;
}

test.describe('이어 보기 (C-016 / FR-SRCH-008)', () => {
  test('**다음 페이지가 커서를 그대로 실어 보내고 결과를 쌓는다**', async ({ page }) => {
    const calls = await stubPages(page, [
      { items: [row(1)], next_cursor: 'CURSOR-A', ...FACETS },
      { items: [row(2)], next_cursor: null },
    ]);

    await page.goto('/search?q=repo%3Aacme%2Fpayments');
    await expect(page.getByTestId('result-row')).toHaveCount(1);

    await page.getByTestId('cursor-next').click();
    // 갈아 끼우지 않고 **쌓는다** — 번호가 없어 앞 페이지로 돌아갈 길이 없다.
    await expect(page.getByTestId('result-row')).toHaveCount(2);

    const second = calls[1] ?? '';
    // 커서를 해석하지 않는다 — 서버가 준 문자열 그대로다.
    expect(new URL(second).searchParams.get('cursor')).toBe('CURSOR-A');
  });

  test('**첫 페이지만 분포를 요청한다** (QA-W001-27, DEV-280)', async ({ page }) => {
    const calls = await stubPages(page, [
      { items: [row(1)], next_cursor: 'CURSOR-A', ...FACETS },
      { items: [row(2)], next_cursor: null },
    ]);

    await page.goto('/search?q=repo%3Aacme%2Fpayments');
    await expect(page.getByTestId('result-row')).toHaveCount(1);
    await page.getByTestId('cursor-next').click();
    await expect(page.getByTestId('result-row')).toHaveCount(2);

    expect(new URL(calls[0] ?? '').searchParams.get('facets')).toBe('true');
    // 이어 보기는 같은 질의의 같은 분포를 다시 세는 것이라 예산만 쓴다.
    expect(new URL(calls[1] ?? '').searchParams.get('facets')).toBeNull();
  });

  test('마지막 페이지에서는 다음 버튼이 없고 끝임을 말한다 (AC-1)', async ({ page }) => {
    await stubPages(page, [
      { items: [row(1)], next_cursor: 'CURSOR-A', ...FACETS },
      { items: [row(2)], next_cursor: null },
    ]);

    await page.goto('/search?q=repo%3Aacme%2Fpayments');
    await page.getByTestId('cursor-next').click();
    await expect(page.getByTestId('result-row')).toHaveCount(2);

    await expect(page.getByTestId('cursor-next')).toHaveCount(0);
    // 버튼만 사라지면 "더 있는데 안 나오는 것"과 "여기가 끝"을 구분할 수 없다.
    await expect(page.getByTestId('cursor-end')).toBeVisible();
  });

  test('"첫 페이지로"가 쌓인 결과를 버리고 처음부터 다시 연다', async ({ page }) => {
    const calls = await stubPages(page, [
      { items: [row(1)], next_cursor: 'CURSOR-A', ...FACETS },
      { items: [row(2)], next_cursor: 'CURSOR-B' },
      { items: [row(1)], next_cursor: 'CURSOR-A', ...FACETS },
    ]);

    await page.goto('/search?q=repo%3Aacme%2Fpayments');
    await page.getByTestId('cursor-next').click();
    await expect(page.getByTestId('result-row')).toHaveCount(2);

    await page.getByTestId('cursor-first').click();
    await expect(page.getByTestId('result-row')).toHaveCount(1);
    // 첫 페이지로 돌아왔으므로 커서를 싣지 않는다.
    expect(new URL(calls[2] ?? '').searchParams.get('cursor')).toBeNull();
  });

  test('페이지 번호 UI를 만들지 않는다 (ADR-010)', async ({ page }) => {
    await stubPages(page, [{ items: [row(1)], next_cursor: 'CURSOR-A', ...FACETS }]);
    await page.goto('/search?q=repo%3Aacme%2Fpayments');
    await expect(page.getByTestId('cursor-pager')).toBeVisible();

    const text = (await page.getByTestId('cursor-pager').innerText()).replace(/\s+/g, ' ');
    // "3 / 7페이지" 같은 표기가 없다 — 총계가 근사라 그것은 사실이 아니다.
    expect(text).not.toMatch(/\d+\s*\/\s*\d+/);
    await expect(page.locator('[aria-label="pagination"]')).toHaveCount(0);
  });
});

test.describe('커서 실패 (DEV-273)', () => {
  /*
   * **자동으로 다시 부르지 않는다.**
   *
   * 화면이 조용히 첫 페이지를 재조회하면 사용자는 목록이 처음으로 돌아간 것만
   * 보고 이유를 모른다. 무엇이 일어났는지 말하고 사용자가 누르게 한다.
   */
  test('`CURSOR_QUERY_MISMATCH`가 안내로 나타나고 자동 재조회가 없다', async ({ page }) => {
    const calls = await stubPages(page, [
      { items: [row(1)], next_cursor: 'CURSOR-A', ...FACETS },
      { __status: 400, error: { code: 'CURSOR_QUERY_MISMATCH', message: '조건이 바뀌었습니다' } },
    ]);

    await page.goto('/search?q=repo%3Aacme%2Fpayments');
    await page.getByTestId('cursor-next').click();

    const failure = page.getByTestId('cursor-failure');
    await expect(failure).toBeVisible();
    await expect(failure).toHaveAttribute('data-cursor-failure', 'CURSOR_QUERY_MISMATCH');

    // 잠시 기다려도 세 번째 요청이 나가지 않는다 — 재시도 루프가 없다.
    await page.waitForTimeout(300);
    expect(calls).toHaveLength(2);
  });

  test('`CURSOR_INVALID`는 다른 문구다 — 같은 원인인 척하지 않는다', async ({ page }) => {
    await stubPages(page, [
      { items: [row(1)], next_cursor: 'CURSOR-A', ...FACETS },
      { __status: 400, error: { code: 'CURSOR_INVALID', message: '쓸 수 없습니다' } },
    ]);

    await page.goto('/search?q=repo%3Aacme%2Fpayments');
    await page.getByTestId('cursor-next').click();

    const failure = page.getByTestId('cursor-failure');
    await expect(failure).toHaveAttribute('data-cursor-failure', 'CURSOR_INVALID');
    await expect(failure).toContainText('만료');
  });
});

test.describe('패싯 상태 (C-012 / FR-SRCH-009)', () => {
  test('예산 초과와 계산 실패가 다른 문구다 (DEV-277)', async ({ page }) => {
    await stubPages(page, [
      { items: [row(1)], next_cursor: null, facets: {}, facets_omitted: true, facets_status: 'budget_omitted' },
    ]);
    await page.goto('/search?q=repo%3Aacme%2Fpayments');
    await expect(page.getByTestId('facet-notice')).toHaveAttribute('data-facet-state', 'omitted');
    const omitted = await page.getByTestId('facet-notice').innerText();

    await page.unrouteAll();
    await stubPages(page, [
      { items: [row(1)], next_cursor: null, facets: {}, facets_omitted: true, facets_status: 'failed' },
    ]);
    await page.goto('/search?q=repo%3Aacme%2Fbilling');
    await expect(page.getByTestId('facet-notice')).toHaveAttribute('data-facet-state', 'failed');
    const failed = await page.getByTestId('facet-notice').innerText();

    // 사용자가 할 수 있는 일이 다르다 — 하나는 조건을 좁히고, 하나는 다시 시도한다.
    expect(failed).not.toBe(omitted);
  });

  /*
   * **첫 페이지에서도 재시도가 실제로 요청을 낸다** (PR #57 리뷰 P2).
   *
   * 커서만으로는 "다시 불러라"를 표현할 수 없다 — 첫 페이지에서 분포가 실패한
   * 뒤 버튼을 누르면 커서는 이미 `null`이라 상태가 달라지지 않고, React가
   * 갱신을 건너뛰어 조회 효과가 다시 돌지 않는다. 버튼이 아무 일도 하지 않는다.
   */
  test('**분포 다시 계산이 첫 페이지에서도 요청을 낸다**', async ({ page }) => {
    const calls = await stubPages(page, [
      { items: [row(1)], next_cursor: null, facets: {}, facets_omitted: true, facets_status: 'failed' },
      { items: [row(1)], next_cursor: null, ...FACETS },
    ]);

    await page.goto('/search?q=repo%3Aacme%2Fpayments');
    await expect(page.getByTestId('facet-notice')).toHaveAttribute('data-facet-state', 'failed');
    expect(calls).toHaveLength(1);

    await page.getByTestId('facet-retry').click();

    await expect.poll(() => calls.length).toBe(2);
    // 다시 부를 때도 첫 페이지이므로 분포를 함께 요청한다.
    expect(new URL(calls[1] ?? '').searchParams.get('facets')).toBe('true');
    expect(new URL(calls[1] ?? '').searchParams.get('cursor')).toBeNull();
    await expect(page.getByTestId('facet-notice')).toHaveCount(0);
  });

  test('패싯을 누르면 질의가 갱신되고 첫 페이지부터 다시 연다 (DEV-280)', async ({ page }) => {
    const calls = await stubPages(page, [
      { items: [row(1)], next_cursor: 'CURSOR-A', ...FACETS },
      { items: [row(2)], next_cursor: 'CURSOR-B' },
      { items: [row(1)], next_cursor: null, ...FACETS },
    ]);

    await page.goto('/search?q=repo%3Aacme%2Fpayments');
    await page.getByTestId('cursor-next').click();
    await expect(page.getByTestId('result-row')).toHaveCount(2);

    await page.getByTestId('facet-author').getByRole('checkbox').first().click();

    await expect.poll(() => calls.length).toBeGreaterThanOrEqual(3);
    const last = new URL(calls[calls.length - 1] ?? '');
    expect(last.searchParams.get('q')).toContain('author:kim');
    // 조건이 바뀌었으므로 커서를 버린다 — 들고 가면 서버가 mismatch로 답한다.
    expect(last.searchParams.get('cursor')).toBeNull();
  });
});

test.describe('강조 (FR-SRCH-011 AC-5, THR-018)', () => {
  test('일치 구간이 `<mark>`으로 그려진다', async ({ page }) => {
    await stubPages(page, [
      {
        items: [
          row(1, {
            title: 'feat: 결제 재시도 로직',
            highlight: { title: [{ text: 'feat: 결제 재시도 로직', matches: [{ start: 6, end: 8 }] }] },
          }),
        ],
        next_cursor: null,
        ...FACETS,
      },
    ]);

    await page.goto('/search?q=%EA%B2%B0%EC%A0%9C');
    await expect(page.getByTestId('highlight-match')).toHaveText('결제');
  });

  /*
   * **이것이 THR-018이 실제로 걸리는 자리다.**
   *
   * API가 주는 것은 평문이고 화면은 텍스트 노드로 그린다. 제목이 `<script>`를
   * 담고 있어도 그것은 **글자**여야 한다 — DOM에 요소로 들어가면 완화 근거가
   * 무너진다. jsdom 단언으로는 이 차이를 보기 어렵다.
   */
  test('**원문의 마크업은 글자로 남고 DOM 요소가 되지 않는다**', async ({ page }) => {
    await stubPages(page, [
      {
        items: [
          row(1, {
            title: '<script>alert(1)</script> 결제',
            highlight: {
              title: [{ text: '<script>alert(1)</script> 결제', matches: [{ start: 26, end: 28 }] }],
            },
          }),
        ],
        next_cursor: null,
        ...FACETS,
      },
    ]);

    await page.goto('/search?q=%EA%B2%B0%EC%A0%9C');
    const highlighted = page.getByTestId('highlighted-text');
    await expect(highlighted).toContainText('<script>alert(1)</script>');
    // 글자로 그려졌다면 요소는 없다.
    expect(await highlighted.locator('script').count()).toBe(0);
    await expect(page.getByTestId('highlight-match')).toHaveText('결제');
  });
});
