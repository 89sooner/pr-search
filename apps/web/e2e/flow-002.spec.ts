import { expect, test, type Page } from '@playwright/test';

/**
 * FLOW-002 / W-002 PR 상세 (WP-017 DoD).
 *
 * **실제 브라우저에서만 확인되는 것**만 둔다:
 *   1. 딥링크가 실제로 라우팅되는가
 *   2. **W-001 → W-002 → 뒤로가기**가 성립하는가 (WP-016이 심은 `from_q`)
 *   3. 자동 폴링이 정말 없는가 — 진짜 네트워크 계층에서 센다
 */

const PR = {
  repository: 'acme/payments',
  pr_number: 1234,
  title: 'feat: 결제 재시도',
  state: 'merged',
  author: 'kim',
  base_branch: 'main',
  head_branch: 'feat/retry',
  labels: ['backend'],
  reviewers: ['lee', 'park'],
  approved_by: ['lee'],
  created_at: '2026-08-18T09:00:00Z',
  first_review_at: '2026-08-18T11:30:00Z',
  merged_at: '2026-08-19T05:02:11Z',
  lead_time_seconds: 72000,
  changed_files_count: 2,
  additions: 120,
  deletions: 15,
  merge_commit_sha: 'a'.repeat(40),
  source_commits: [{ commit_sha: 'b'.repeat(40) }],
  source_commits_truncated: false,
  source_commits_total: 1,
  merge_seq: null,
  seq_epoch: null,
  sequence_space: null,
};

const SEARCH_RESULT = {
  total: { value: 1, relation: 'eq' },
  items: [
    {
      kind: 'pull_request',
      repository: 'acme/payments',
      pr_number: 1234,
      title: 'feat: 결제 재시도',
      author: 'kim',
      state: 'merged',
      merge_seq: null,
      seq_epoch: null,
      sequence_space: null,
      merged_at: '2026-08-19T05:02:11Z',
      changed_files_count: 2,
      additions: 120,
      deletions: 15,
      url: '/pr/acme/payments/1234',
    },
  ],
  sort: { field: 'merge_seq', order: 'desc' },
  next_cursor: null,
};

/** 두 API를 모두 가로채고 호출 URL을 기록한다. */
async function stubApi(page: Page, prBody: Record<string, unknown> = {}): Promise<string[]> {
  const calls: string[] = [];
  await page.route('**/api/**', async (route) => {
    const url = route.request().url();
    calls.push(url);
    const body = url.includes('/api/search') ? SEARCH_RESULT : { ...PR, ...prBody };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  return calls;
}

test.describe('딥링크가 선다', () => {
  test('`/pr/:owner/:repo/:number`가 상세를 그린다', async ({ page }) => {
    await stubApi(page);
    await page.goto('/pr/acme/payments/1234');

    await expect(page.getByTestId('pr-detail')).toHaveAttribute('data-screen-state', 'ready');
    await expect(page.getByRole('heading', { name: 'feat: 결제 재시도', level: 1 })).toBeVisible();
    await expect(page.getByTestId('entity-identifier')).toContainText('acme/payments #1234');
  });

  test('셸 안에 선다 — 랜드마크가 유지된다', async ({ page }) => {
    await stubApi(page);
    await page.goto('/pr/acme/payments/1234');

    await expect(page.getByRole('banner')).toBeVisible();
    await expect(page.getByRole('main')).toBeVisible();
  });

  test('**번호 모양이 틀리면 조회하지 않고 같은 화면을 보인다**', async ({ page }) => {
    const calls = await stubApi(page);
    await page.goto('/pr/acme/payments/abc');

    await expect(page.getByTestId('pr-detail')).toHaveAttribute('data-screen-state', 'not_found');
    // 부르지 않는다 — 어차피 404이고, 부르지 않는 편이 낫다.
    expect(calls.filter((c) => c.includes('/pull-requests/'))).toEqual([]);
    // **막다른 골목으로 두지 않는다.** 되돌아갈 길이 화면 안에 있어야 한다.
    await expect(page.getByTestId('back-link')).toBeVisible();
  });

  test('**0과 앞자리 0도 조회하지 않는다** — PR 번호는 양의 정수다', async ({ page }) => {
    for (const bad of ['0', '007', '-1', '1.5', '12345678901']) {
      const calls = await stubApi(page);
      await page.goto(`/pr/acme/payments/${bad}`);
      await expect(page.getByTestId('pr-detail')).toHaveAttribute('data-screen-state', 'not_found');
      /*
       * `007`을 받아 주면 `Number('007') === 7`이라 **URL과 다른 PR을
       * 그리게 된다.** 조사 결과를 URL로 인용하는 제품에서 그것은 치명적이다.
       */
      expect(calls.filter((c) => c.includes('/pull-requests/'))).toEqual([]);
    }
  });

  test('번호 모양이 틀려도 **원래 질의로 돌아간다**', async ({ page }) => {
    await stubApi(page);
    await page.goto('/pr/acme/payments/abc?from_q=repo%3Aacme%2Fpayments');

    await expect(page.getByTestId('pr-detail')).toHaveAttribute('data-screen-state', 'not_found');
    await page.getByTestId('back-link').click();
    await expect(page).toHaveURL(/\/search\?q=repo%3Aacme%2Fpayments/);
  });
});

test.describe('W-001 → W-002 → 뒤로가기 (FLOW-002)', () => {
  test('**결과 행을 눌러 상세로 가고, 뒤로가기로 질의가 살아 돌아온다**', async ({ page }) => {
    await stubApi(page);

    await page.goto('/search?q=repo%3Aacme%2Fpayments');
    await expect(page.getByTestId('search-view')).toHaveAttribute('data-screen-state', 'ready');

    // WP-016이 심은 `from_q`가 여기서 값을 한다.
    await page.getByTestId('result-link').click();
    await expect(page).toHaveURL(/\/pr\/acme\/payments\/1234\?from_q=/);
    await expect(page.getByTestId('pr-detail')).toHaveAttribute('data-screen-state', 'ready');

    await page.goBack();
    await expect(page).toHaveURL(/\/search\?q=repo%3Aacme%2Fpayments/);
    // 입력창이 질의를 그대로 담고 있어야 한다 — 조사가 끊기지 않는다.
    await expect(page.getByRole('searchbox')).toHaveValue('repo:acme/payments');
  });

  test('상세의 "검색으로 돌아가기"도 같은 질의로 간다', async ({ page }) => {
    await stubApi(page);
    await page.goto('/pr/acme/payments/1234?from_q=repo%3Aacme%2Fpayments');

    await expect(page.getByTestId('pr-detail')).toHaveAttribute('data-screen-state', 'ready');
    await page.getByTestId('back-link').click();
    await expect(page).toHaveURL(/\/search\?q=repo%3Aacme%2Fpayments/);
  });
});

test.describe('보강 미완료 (QA-W002-15, FLOW-002 예외 흐름)', () => {
  test('머지 커밋은 보이고 원본만 수집 중이다', async ({ page }) => {
    await stubApi(page, { source_commits: [], enrichment_pending: true });
    await page.goto('/pr/acme/payments/1234');

    await expect(page.getByTestId('enrichment-pending')).toBeVisible();
    await expect(page.getByTestId('merge-commit-row')).toContainText('a'.repeat(12));
  });

  test('**자동 폴링을 하지 않는다** — 실제 네트워크에서 센다', async ({ page }) => {
    const calls = await stubApi(page, { source_commits: [], enrichment_pending: true });
    await page.goto('/pr/acme/payments/1234');
    await expect(page.getByTestId('enrichment-pending')).toBeVisible();

    const before = calls.filter((c) => c.includes('/pull-requests/')).length;
    await page.waitForTimeout(1500);
    const after = calls.filter((c) => c.includes('/pull-requests/')).length;

    // 1.5초를 가만히 둬도 늘지 않아야 한다.
    expect(after).toBe(before);
  });

  test('재조회 버튼은 실제로 다시 부른다', async ({ page }) => {
    const calls = await stubApi(page, { source_commits: [], enrichment_pending: true });
    await page.goto('/pr/acme/payments/1234');
    await expect(page.getByTestId('enrichment-pending')).toBeVisible();

    const before = calls.filter((c) => c.includes('/pull-requests/')).length;
    await page.getByRole('button', { name: '다시 조회' }).click();
    await expect
      .poll(() => calls.filter((c) => c.includes('/pull-requests/')).length)
      .toBe(before + 1);
  });
});

test.describe('준비 중 섹션 (QA-W002-17)', () => {
  test('**진입 시 관계·릴리스를 부르지 않는다**', async ({ page }) => {
    const calls = await stubApi(page);
    await page.goto('/pr/acme/payments/1234');
    await expect(page.getByTestId('pr-detail')).toHaveAttribute('data-screen-state', 'ready');

    // PR 문서 하나뿐이다 (IA 원칙 4, 점진적 공개).
    expect(calls.filter((c) => c.includes('/api/'))).toHaveLength(1);
  });

  test('세 섹션이 숨겨지지 않는다', async ({ page }) => {
    await stubApi(page);
    await page.goto('/pr/acme/payments/1234');

    await expect(page.getByTestId('section-neighbors')).toBeVisible();
    await expect(page.getByTestId('section-releases')).toBeVisible();
    await expect(page.getByTestId('section-links')).toBeVisible();
  });
});

test.describe('접근 범위 (QA-W002-18)', () => {
  test('404는 존재 여부를 드러내지 않는다', async ({ page }) => {
    await page.route('**/api/pull-requests/**', async (route) => {
      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'NOT_FOUND', message: 'PR을 찾을 수 없습니다' } }),
      });
    });
    await page.goto('/pr/acme/secret/9999');

    await expect(page.getByTestId('pr-detail')).toHaveAttribute('data-screen-state', 'not_found');
    // "권한"이라는 말이 나오면 "있긴 있다"가 새어 나간다.
    await expect(page.getByRole('main')).not.toContainText('권한');
  });
});
