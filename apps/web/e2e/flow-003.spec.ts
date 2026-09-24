import { expect, test, type Page } from '@playwright/test';

/**
 * FLOW-002 전 경로 / W-003 커밋 상세 (WP-018 DoD).
 *
 * WP-018의 DoD가 요구하는 것은 화면 하나가 아니라 **경로 전체**다:
 * SHA 입력 → 커밋 상세 → PR 상세. W-001과 W-002는 이미 섰으므로 여기서
 * 처음으로 **셋이 이어지는지**를 실제 브라우저에서 확인한다.
 */

const MERGE_SHA = 'a3f9c21b4e8d7f0c1a2b3c4d5e6f708192a3b4c5';
const SOURCE_SHA = '1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d';

const COMMIT = {
  repository: 'acme/payments',
  commit_sha: MERGE_SHA,
  short_sha: MERGE_SHA.slice(0, 12),
  role: 'merge_commit',
  base_branch: 'main',
  merge_seq: null,
  seq_epoch: null,
  sequence_space: null,
  enrichment_pending: false,
  pull_requests: [
    {
      pr_number: 1234,
      title: 'feat: 결제 재시도',
      author: 'kim',
      reviewers: ['lee', 'park'],
      state: 'merged',
      merged_at: '2026-08-19T05:02:11Z',
      merge_commit_sha: MERGE_SHA,
      url: '/pr/acme/payments/1234',
    },
  ],
};

const PR = {
  repository: 'acme/payments',
  pr_number: 1234,
  title: 'feat: 결제 재시도',
  state: 'merged',
  author: 'kim',
  base_branch: 'main',
  head_branch: 'feat/retry',
  created_at: '2026-08-18T09:00:00Z',
  merged_at: '2026-08-19T05:02:11Z',
  merge_commit_sha: MERGE_SHA,
  source_commits: [{ commit_sha: SOURCE_SHA }],
  source_commits_truncated: false,
  source_commits_total: 1,
  merge_seq: null,
  seq_epoch: null,
  sequence_space: null,
};

/** 40자 SHA를 붙여넣으면 판별기가 커밋으로 읽고 후보 1건을 낸다. */
const RESOLVE = {
  detected_kind: 'commit',
  candidates: [
    {
      kind: 'commit',
      repository: 'acme/payments',
      commit_sha: MERGE_SHA,
      role: 'merge_commit',
      url: `/commit/acme/payments/${MERGE_SHA}`,
    },
  ],
  truncated: false,
};

/** 세 API를 모두 가로채고 호출 URL을 기록한다. */
async function stubApi(page: Page, overrides: Record<string, unknown> = {}): Promise<string[]> {
  const calls: string[] = [];
  await page.route('**/api/**', async (route) => {
    const url = route.request().url();
    calls.push(url);
    let body: unknown = { ...COMMIT, ...overrides };
    if (url.includes('/api/resolve')) body = RESOLVE;
    else if (url.includes('/api/pull-requests/')) body = PR;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  return calls;
}

/**
 * 이 탭의 세션 히스토리 — 항목의 경로와 현재 위치 (CR-118, DEV-758).
 *
 * Chromium의 Navigation API로 읽는다. `history.length`는 수만 말해 주므로, 항목 하나가 덮였는지
 * 하나가 더 쌓였는지를 가르지 못한다.
 */
async function sessionHistory(page: Page): Promise<{ readonly index: number; readonly entries: readonly string[] }> {
  return page.evaluate(() => {
    const navigation = (window as unknown as {
      navigation: { entries(): readonly { url: string | null }[]; currentEntry: { index: number } | null };
    }).navigation;
    return {
      index: navigation.currentEntry?.index ?? -1,
      entries: navigation.entries().map((entry) => {
        const url = new URL(entry.url ?? '', window.location.origin);
        return `${url.pathname}${url.search}`;
      }),
    };
  });
}

test.describe('딥링크가 선다', () => {
  test('`/commit/:owner/:repo/:sha`가 상세를 그린다', async ({ page }) => {
    await stubApi(page);
    await page.goto(`/commit/acme/payments/${MERGE_SHA}`);

    await expect(page.getByTestId('commit-detail')).toHaveAttribute('data-screen-state', 'ready');
    // 이름은 축약 SHA다 — PR 제목을 빌려오지 않는다 (DEV-090).
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(MERGE_SHA.slice(0, 12));
  });

  test('셸 안에 선다 — 랜드마크가 유지된다', async ({ page }) => {
    await stubApi(page);
    await page.goto(`/commit/acme/payments/${MERGE_SHA}`);

    await expect(page.getByRole('banner')).toBeVisible();
    await expect(page.getByRole('main')).toBeVisible();
  });

  test('**대문자 SHA도 같은 커밋을 연다**', async ({ page }) => {
    const calls = await stubApi(page);
    await page.goto(`/commit/acme/payments/${MERGE_SHA.toUpperCase()}`);

    await expect(page.getByTestId('commit-detail')).toHaveAttribute('data-screen-state', 'ready');
    // 서버는 소문자로 색인한다. 대문자 그대로 물으면 404가 된다.
    expect(calls.some((c) => c.includes(MERGE_SHA))).toBe(true);
  });

  test('**딥링크의 `from_q`가 되돌아가기 링크로 이어진다**', async ({ page }) => {
    await stubApi(page);
    await page.goto(`/commit/acme/payments/${MERGE_SHA}?from_q=repo%3Aacme%2Fpayments`);

    await expect(page.getByTestId('commit-detail')).toHaveAttribute('data-screen-state', 'ready');
    /*
     * 라우트가 `from_q`를 화면으로 넘기지 않으면 되돌아가기가 빈 검색으로
     * 간다 — 사용자가 조사하던 질의를 손으로 다시 친다 (DEV-078).
     */
    await expect(page.getByTestId('back-link')).toHaveAttribute(
      'href',
      '/search?q=repo%3Aacme%2Fpayments',
    );
    await page.getByTestId('back-link').click();
    await expect(page.getByRole('searchbox')).toHaveValue('repo:acme/payments');
  });

  test('**축약 SHA는 상세 주소가 아니다** — 조회하지 않고 같은 화면을 보인다', async ({ page }) => {
    const calls = await stubApi(page);
    await page.goto('/commit/acme/payments/a3f9c21');

    await expect(page.getByTestId('commit-detail')).toHaveAttribute('data-screen-state', 'not_found');
    /*
     * 축약은 후보가 여럿일 수 있어 화면이 임의로 고르면 안 된다 (ADR-012).
     * 해석은 `/resolve`가 하고 W-001이 후보를 보여 준다.
     */
    expect(calls.filter((c) => c.includes('/commits/'))).toEqual([]);
    await expect(page.getByTestId('back-link')).toBeVisible();
  });

  test('hex가 아닌 40자도 조회하지 않는다', async ({ page }) => {
    const calls = await stubApi(page);
    await page.goto(`/commit/acme/payments/${'z'.repeat(40)}`);

    await expect(page.getByTestId('commit-detail')).toHaveAttribute('data-screen-state', 'not_found');
    expect(calls.filter((c) => c.includes('/commits/'))).toEqual([]);
  });
});

test.describe('FLOW-002 전 경로: SHA 입력 → 커밋 상세 → PR 상세', () => {
  test('**셋이 이어진다**', async ({ page }) => {
    await stubApi(page);

    // 1. W-001에서 40자 SHA를 붙여넣는다.
    await page.goto('/search');
    await page.getByRole('searchbox').fill(MERGE_SHA);
    await page.getByRole('button', { name: "Search" }).click();

    /*
     * 2. **후보가 1건이라 자동으로 이동한다** (FLOW-001 4단계).
     *    누를 필요가 없다 — 누르게 하면 그 자체가 명세 위반이다.
     */
    await expect(page).toHaveURL(new RegExp(`/commit/acme/payments/${MERGE_SHA}`));
    await expect(page.getByTestId('commit-detail')).toHaveAttribute('data-screen-state', 'ready');
    // 원본 입력이 URL에 남아 있어야 뒤로가기가 살아난다 (DEV-078).
    await expect(page).toHaveURL(new RegExp(`from_q=${MERGE_SHA}`));

    // 3. 소속 PR을 눌러 PR 상세로 간다 — 역추적이 여기서 완성된다.
    await page.getByTestId('linked-pr-link').click();
    await expect(page.getByTestId('pr-detail')).toHaveAttribute('data-screen-state', 'ready');
    await expect(page).toHaveURL(/\/pr\/acme\/payments\/1234/);
  });

  test('뒤로가기로 커밋 상세를 거쳐 검색으로 돌아온다', async ({ page }) => {
    await stubApi(page);
    await page.goto('/search');
    await page.getByRole('searchbox').fill(MERGE_SHA);
    await page.getByRole('button', { name: "Search" }).click();
    // 후보 1건이라 자동으로 커밋 상세에 도착한다.
    await expect(page.getByTestId('commit-detail')).toBeVisible();
    await page.getByTestId('linked-pr-link').click();
    await expect(page.getByTestId('pr-detail')).toBeVisible();

    /*
     * **두 번째 뒤로가기는 커밋 상세가 수화된 뒤에 부른다** (CR-118, DEV-758).
     *
     * `linked-pr-link`는 진짜 `<a href>`라 PR 상세는 새 문서로 열린다. Playwright의 Chromium은
     * back-forward cache를 끈 채로 뜨므로 첫 `goBack()`은 커밋 상세를 **새 문서로 다시 불러온다.**
     * 그 문서의 SSR HTML에 이미 `commit-detail`(`loading_initial`)이 있어서 URL 판정과
     * `toBeVisible()`은 **수화 전에** 통과한다. 그 순간 부른 두 번째 `goBack()`은 같은 문서 안의
     * popstate인데, App Router는 그 청취자를 수화 뒤 효과에서 붙이므로 이동을 놓친다. 이어지는
     * 수화가 `history.replaceState`로 `/search?q=` 항목을 커밋 URL로 덮거나(아래 URL 판정 실패 —
     * CI의 `9 × unexpected value ".../commit/acme/payments/...?from_q=..."`), URL은 맞는데 화면이
     * 커밋 상세에 영원히 머문다(마지막 판정이 시한을 다 쓴다).
     *
     * 그래서 **클라이언트에서만 생기는 신호** `data-screen-state="ready"`를 기다린다. 그 값은 수화 뒤
     * 효과가 부른 조회의 응답에서만 서므로, 그때는 라우터의 popstate 청취자가 이미 붙어 있다.
     * 과거 진단 — DEV-424 「히스토리 전이가 끝나지 않았다」, DEV-689 「RSC 왕복이 늦다」 — 은 이
     * 기제를 보지 못했다. 로컬 부하 실측(작업자 4, 60회): 옛 대기 12회 실패, 이 대기 0회.
     */
    await page.goBack();
    await expect(page).toHaveURL(/\/commit\//);
    await expect(page.getByTestId('commit-detail')).toHaveAttribute('data-screen-state', 'ready');
    await page.goBack();
    /*
     * 자동 이동은 `push`라 히스토리가 쌓인다 — 뒤로가기 한 번으로 검색
     * 화면과 **원래 입력**이 함께 돌아와야 한다 (FLOW-001 4단계).
     *
     * **도착을 먼저 확인한다** (DEV-376). App Router의 뒤로가기는 클라이언트
     * 내비게이션이라 URL이 바뀐 뒤에도 화면이 그려질 때까지 시간이 걸린다.
     * 곧바로 `searchbox`를 찾으면 아직 커밋 상세가 서 있는 순간을 만나
     * `element(s) not found`로 끝난다 — 이 시험이 CI와 로컬에서 반복해서
     * 실패한 자리다. URL을 먼저 기다리면 **어디에 도착했는지도 함께 판정된다**:
     * 뒤로가기가 검색이 아닌 곳으로 갔다면 그 사실이 여기서 드러난다.
     */
    await expect(page).toHaveURL(/\/search/);
    /*
     * **히스토리가 그대로다** (CR-118, DEV-758). 실패했을 때 원인이 메시지에서 바로 갈린다 —
     * 자동 이동 push가 두 번 나갔다면 커밋 항목이 둘이고, 수화가 `/search?q=` 항목을 덮었다면
     * 그 자리에 커밋 URL이 있다. 둘째 항목에 머물러야 한다.
     */
    expect(await sessionHistory(page)).toEqual({
      index: 1,
      entries: ['/search', `/search?q=${MERGE_SHA}`, `/commit/acme/payments/${MERGE_SHA}?from_q=${MERGE_SHA}`, '/pr/acme/payments/1234'],
    });
    /*
     * 시한은 기본값이다. 옛 15초(DEV-689)는 위 기제로 화면이 영원히 멈추던 것을 「느리다」로
     * 읽고 늘린 값이었다 — 늘린 시한은 실패를 15초 늦췄을 뿐이다.
     */
    await expect(page.getByRole('searchbox')).toHaveValue(MERGE_SHA);
  });

  test('**뒤로가기가 튕겨 나가지 않는다** (CR-021, DEV-097)', async ({ page }) => {
    await stubApi(page);
    await page.goto('/search');
    await page.getByRole('searchbox').fill(MERGE_SHA);
    await page.getByRole('button', { name: "Search" }).click();
    await expect(page.getByTestId('commit-detail')).toBeVisible();

    await page.goBack();
    /*
     * 자동 이동을 해석 결과에만 걸면 여기서 곧바로 상세로 다시 튕겨 나가
     * **사용자가 검색 화면에 영영 닿지 못한다.** 이동은 제출에 대한 응답이다.
     */
    await expect(page.getByRole('searchbox')).toHaveValue(MERGE_SHA);
    await expect(page).toHaveURL(/\/search\?q=/);
    // 잠시 두어도 떠나지 않는다.
    await expect(page.getByTestId('search-view')).toBeVisible({ timeout: 2000 });
    await expect(page).toHaveURL(/\/search\?q=/);
  });

  test('돌아온 화면에서 **후보 카드를 눌러** 다시 갈 수 있다', async ({ page }) => {
    await stubApi(page);
    await page.goto('/search');
    await page.getByRole('searchbox').fill(MERGE_SHA);
    await page.getByRole('button', { name: "Search" }).click();
    await expect(page.getByTestId('commit-detail')).toBeVisible();
    await page.goBack();

    await page.getByTestId('candidate-link').first().click();
    await expect(page.getByTestId('commit-detail')).toHaveAttribute('data-screen-state', 'ready');
  });

  test('W-002의 커밋 목록에서 커밋 상세로 간다', async ({ page }) => {
    await stubApi(page);
    await page.goto('/pr/acme/payments/1234');
    await expect(page.getByTestId('pr-detail')).toHaveAttribute('data-screen-state', 'ready');

    // W-002-COMMITS의 항목이 W-003으로 가는 것이 IA가 정한 경로다.
    await expect(page.getByTestId('merge-commit-row')).toBeVisible();
  });
});

test.describe('원본 커밋의 복구 경로 (QA-W003-06)', () => {
  test('**체인 밖이라고 말하고 머지 커밋으로 보낸다**', async ({ page }) => {
    await stubApi(page, { commit_sha: SOURCE_SHA, short_sha: SOURCE_SHA.slice(0, 12), role: 'source_commit' });
    await page.goto(`/commit/acme/payments/${SOURCE_SHA}`);

    await expect(page.getByTestId('sequence-position')).toHaveAttribute('data-seq-state', 'off_chain');
    await page.getByTestId('landed-as-link').click();
    await expect(page).toHaveURL(new RegExp(`/commit/acme/payments/${MERGE_SHA}`));
  });
});

test.describe('SHA 복사 (QA-W003-07)', () => {
  test('**실제 클립보드에 전체 40자가 들어간다**', async ({ page, context }) => {
    // 실제 브라우저에서만 확인되는 것이다 — jsdom은 클립보드를 흉내 낸다.
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await stubApi(page);
    await page.goto(`/commit/acme/payments/${MERGE_SHA}`);

    await page.getByTestId('sha-copy').click();
    await expect(page.getByTestId('sha-copy-status')).toContainText("Copied");

    const clipped = await page.evaluate(() => navigator.clipboard.readText());
    // 화면에 보이는 12자가 아니라 40자여야 한다.
    expect(clipped).toBe(MERGE_SHA);
  });
});

test.describe('접근 범위 (W-002와 같은 규칙)', () => {
  test('404는 존재 여부를 드러내지 않는다', async ({ page }) => {
    await page.route('**/api/commits/**', async (route) => {
      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'NOT_FOUND', message: 'x' } }),
      });
    });
    await page.goto(`/commit/acme/payments/${MERGE_SHA}`);

    await expect(page.getByTestId('commit-detail')).toHaveAttribute('data-screen-state', 'not_found');
    await expect(page.getByRole('main')).not.toContainText("permission");
  });
});
