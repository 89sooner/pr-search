import { expect, test, type Page } from '@playwright/test';

/**
 * W-001의 시퀀스 인용 URL 규율 (CR-051 / QA-W001-31~33, 36).
 *
 * **실제 브라우저에서만 확인되는 것**만 둔다. 판정과 렌더링은
 * `lib/search-state.test.ts`와 `lib/query-url.test.ts`가 더 촘촘히 건다.
 *
 * 여기서 거는 것은 셋이다.
 *   1. 첫 조회가 주소창에 에폭을 새기는가 — **그리고 히스토리에 쌓지 않는가**
 *   2. 낡은 인용에서 아무것도 누르지 않으면 **정말로 아무 일도 없는가**
 *   3. 「현재 에폭으로 다시 조회」가 실제로 URL을 바꾸는가
 *
 * 셋 다 jsdom이 흉내 내지 못한다 — 주소창도 히스토리 스택도 없다.
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

const CONTEXT = {
  sequence_space: 'acme/payments@main',
  repository: 'acme/payments',
  base_branch: 'main',
  seq_epoch: 3,
  sequence_state: 'ok',
};

const BOUND = 'repo:acme/payments base:main seq:1280..1342';

/**
 * 서버가 에폭을 판정하는 자리를 흉내 낸다.
 *
 * 요청의 `seq_epoch`이 없거나 3이면 정상, 그 밖이면 낡은 인용이다 — 실제
 * `API-SRCH-004`의 규칙 2·3과 같은 모양이며, 그 계약 자체는 통합 시험이 건다.
 */
async function stubSearch(page: Page): Promise<string[]> {
  const calls: string[] = [];
  await page.route('**/api/search*', async (route) => {
    const url = new URL(route.request().url());
    calls.push(url.search);
    const requested = url.searchParams.get('seq_epoch');
    const query = url.searchParams.get('q') ?? '';

    /*
     * **`seq:`가 없으면 두 키를 싣지 않는다** — 계약 규칙 그대로다. 대역이
     * 계약보다 관대하면 그만큼이 사각지대가 된다: 여기에 맥락을 실으면
     * 화면이 뜻 없는 에폭을 주소에 새기고도 시험이 통과한다.
     */
    if (!query.includes('seq:')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          query,
          parsed: { filters: [], text: null },
          total: { value: 1, relation: 'eq' },
          items: [ROW],
          sort: { field: 'merge_seq', order: 'desc' },
          next_cursor: null,
          correlation_id: 'plain-1',
        }),
      });
      return;
    }

    if (requested !== null && requested !== '3') {
      // **결과 키를 넣지 않는다** — 계산하지 않은 것을 빈 값으로 채우지 않는다.
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          query: BOUND,
          parsed: { filters: [], text: null },
          sequence_context: CONTEXT,
          requested_seq_epoch: Number(requested),
          epoch_stale: true,
          next_cursor: null,
          correlation_id: 'stale-1',
        }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        query: BOUND,
        parsed: { filters: [], text: null },
        total: { value: 1, relation: 'eq' },
        items: [ROW],
        sort: { field: 'merge_seq', order: 'desc' },
        sequence_context: CONTEXT,
        epoch_stale: false,
        next_cursor: null,
        correlation_id: 'ok-1',
      }),
    });
  });
  return calls;
}

test.describe('시퀀스 인용 URL (CR-051)', () => {
  test('**첫 조회가 주소에 에폭을 새기고 히스토리에 쌓지 않는다** (QA-W001-31)', async ({
    page,
  }) => {
    await stubSearch(page);

    // 돌아갈 곳을 만든다 — 뒤로가기가 확인 대상이다.
    await page.goto('/');
    await expect(page).toHaveURL(/\/$/);

    await page.goto(`/search?q=${encodeURIComponent(BOUND)}`);
    await expect(page.getByTestId('search-view')).toHaveAttribute('data-screen-state', 'ready');

    // 서버가 준 현재 에폭이 주소에 나타난다.
    await expect(page).toHaveURL(/seq_epoch=3/);

    /*
     * **`replace`이지 `push`가 아니다.** 에폭 고정은 새 조사 단계가 아니라
     * 지금 조회의 정본 주소를 완성하는 일이다 — `push`면 뒤로가기 한 번이
     * 에폭 없는 같은 조회로 돌아가고 사용자는 두 번 조회했다고 읽는다.
     */
    await page.goBack();
    await expect(page).toHaveURL(/\/$/);
  });

  test('에폭이 새겨진 주소를 그대로 열면 같은 화면이 뜬다 (QA-COMMON-09)', async ({ page }) => {
    await stubSearch(page);
    await page.goto(`/search?q=${encodeURIComponent(BOUND)}&seq_epoch=3`);

    await expect(page.getByTestId('search-view')).toHaveAttribute('data-screen-state', 'ready');
    await expect(page).toHaveURL(/seq_epoch=3/);
  });

  test('**낡은 주소는 결과를 그리지 않고 기다려도 옮겨 가지 않는다** (QA-W001-32·33)', async ({
    page,
  }) => {
    const calls = await stubSearch(page);
    await page.goto(`/search?q=${encodeURIComponent(BOUND)}&seq_epoch=1`);

    const banner = page.getByTestId('epoch-stale-notice');
    await expect(banner).toBeVisible();
    // 두 세대를 함께 적는다 — 무엇이 달라졌는지 알아야 고칠 수 있다.
    await expect(banner).toContainText('1');
    await expect(banner).toContainText('3');

    // 결과 표가 없다. 빈 목록도 "0건"도 아니다.
    await expect(page.getByTestId('result-table')).toHaveCount(0);

    /*
     * **아무것도 누르지 않으면 아무 일도 없다.** 자동 재시도나 타이머가 있으면
     * 여기서 요청이 하나 더 나가고 URL이 3으로 옮겨 간다.
     */
    const before = calls.length;
    await page.waitForTimeout(1200);
    expect(calls.length).toBe(before);
    await expect(page).toHaveURL(/seq_epoch=1/);
  });

  test('「현재 에폭으로 다시 조회」를 눌러야 옮겨 간다 (QA-W001-33)', async ({ page }) => {
    await stubSearch(page);
    await page.goto(`/search?q=${encodeURIComponent(BOUND)}&seq_epoch=1`);
    await expect(page.getByTestId('epoch-stale-notice')).toBeVisible();

    await page.getByTestId('epoch-rebind').click();

    await expect(page).toHaveURL(/seq_epoch=3/);
    await expect(page.getByTestId('search-view')).toHaveAttribute('data-screen-state', 'ready');
    await expect(page.getByTestId('epoch-stale-notice')).toHaveCount(0);
  });

  test('**낡은 인용에서는 저장할 수 없다** (CR-051, PR #64 리뷰 P1)', async ({ page }) => {
    await stubSearch(page);
    await page.goto(`/search?q=${encodeURIComponent(BOUND)}&seq_epoch=1`);
    await expect(page.getByTestId('epoch-stale-notice')).toBeVisible();

    /*
     * 이 상태에서 응답의 `sequence_context.seq_epoch`은 사용자가 본 적 없는
     * **현재** 세대(3)다. 저장을 열어 두면 결과를 보지도 못한 세대에 묶인
     * 검색이 조용히 만들어진다 — "본 것을 저장한다"는 계약이 뒤집힌다.
     */
    await expect(page.getByTestId('search-save')).toBeDisabled();

    // 현재 세대를 실제로 본 뒤에는 저장할 수 있다.
    await page.getByTestId('epoch-rebind').click();
    await expect(page.getByTestId('search-view')).toHaveAttribute('data-screen-state', 'ready');
    await expect(page.getByTestId('search-save')).toBeEnabled();
  });

  test('**질의에서 `seq:`를 지우면 주소에서 에폭도 사라진다** (QA-W001-36)', async ({ page }) => {
    await stubSearch(page);
    await page.goto(`/search?q=${encodeURIComponent(BOUND)}&seq_epoch=3`);
    await expect(page).toHaveURL(/seq_epoch=3/);

    // 새 질의를 제출한다. 뜻이 없어진 파라미터가 남으면 다음 조회가 거절당한다.
    await page.getByRole('searchbox').fill('repo:acme/payments author:kim');
    await page.getByRole('button', { name: '검색', exact: true }).click();

    await expect(page).toHaveURL(/author%3Akim/);
    await expect(page).not.toHaveURL(/seq_epoch/);
  });
});
