import { expect, test, type Page } from '@playwright/test';

/**
 * W-009 저장소 개요 (WP-034 / FR-ING-009 AC-6~10, CR-050).
 *
 * **실제 브라우저에서만 확인되는 것**만 둔다. 판정은
 * `lib/repository-overview.test.ts`가 25건으로, 렌더와 접근성은
 * `a11y/repositories.test.tsx`가 14건으로 이미 건다.
 *
 * 여기서 거는 것은 넷이다.
 *
 *   1. **딥링크의 `repository=`가 실제 요청에 실린다** — W-005·W-001에서 오는 진단 경로
 *   2. 커서 실패가 **자동 재조회 없이** 안내로 나타난다
 *   3. 등록 요청이 **실제 POST**로 나가고 성공 안내가 뜬다
 *   4. `release_not_indexed`에서 이 화면으로 **실제로 이동한다** (DEV-159 만기)
 *
 * 넷 다 jsdom이 흉내 내지 못한다 — 실제 URL도, 실제 이동도, 실제 요청 순서도 없다.
 */

interface OverviewItem {
  readonly repository_id: number;
  readonly repository: string;
  readonly registration_state: 'active' | 'archived';
  readonly registered_at: string;
  readonly last_ingested_at: string | null;
  readonly document_counts: { pull_requests: number; commits: number; total: number } | null;
  readonly backfill: { state: string; job_id: string; progress: Record<string, unknown> } | null;
  readonly sequence_spaces: {
    base_branch: string;
    last_sequence: number | null;
    seq_epoch: number | null;
    sequence_state: string;
    last_assigned_at: string | null;
  }[];
  readonly reconciliation: { last_completed_at: string | null; missing_count: number | null };
  readonly unavailable: readonly string[];
}

function item(overrides: Partial<OverviewItem> = {}): OverviewItem {
  return {
    repository_id: 4021,
    repository: 'acme/payments',
    registration_state: 'active',
    registered_at: '2026-03-02T04:11:00.000Z',
    last_ingested_at: '2026-08-27T23:58:12.000Z',
    document_counts: { pull_requests: 12, commits: 24, total: 36 },
    backfill: null,
    sequence_spaces: [
      {
        base_branch: 'main',
        last_sequence: 1342,
        seq_epoch: 3,
        sequence_state: 'ok',
        last_assigned_at: '2026-08-27T23:40:02.000Z',
      },
    ],
    reconciliation: { last_completed_at: '2026-08-27T23:00:00.000Z', missing_count: 0 },
    unavailable: [],
    ...overrides,
  };
}

/**
 * 목록 대역.
 *
 * **요청 URL을 그대로 기록한다** — 고정 응답은 틀린 입력을 받아 주고, 그
 * 관대함이 그대로 사각지대가 된다 (risks 44).
 */
async function stubList(page: Page, pages: readonly Record<string, unknown>[]): Promise<string[]> {
  const calls: string[] = [];
  const queue = [...pages];

  await page.route('**/api/repositories*', async (route) => {
    calls.push(route.request().url());
    const body = (queue.length > 1 ? queue.shift() : queue[0]) as Record<string, unknown>;
    await route.fulfill({
      status: (body['__status'] as number | undefined) ?? 200,
      contentType: 'application/json',
      body: JSON.stringify({ correlation_id: 'e2e', ...body }),
    });
  });

  return calls;
}

test.describe('W-009 목록 (FR-ING-009 AC-6)', () => {
  test('저장소 카드가 진단 정보를 그린다', async ({ page }) => {
    await stubList(page, [{ items: [item()], next_cursor: null }]);

    await page.goto('/repositories');
    const card = page.getByTestId('repository-card');
    await expect(card).toBeVisible();
    await expect(card.getByTestId('registration-state')).toHaveText('수집 중');
    await expect(card.getByTestId('document_counts-value')).toContainText('PR 12건');
    await expect(card.getByTestId('sequence-spaces')).toBeVisible();
  });

  test('**딥링크의 `repository=`가 실제 요청에 실린다** — 진단 경로가 성립한다', async ({ page }) => {
    const calls = await stubList(page, [{ items: [item()], next_cursor: null }]);

    await page.goto('/repositories?repository=acme%2Fpayments');
    await expect(page.getByTestId('repository-card')).toBeVisible();

    const withFilter = calls.filter(
      (one) => new URL(one).searchParams.get('repository') === 'acme/payments',
    );
    expect(withFilter.length).toBeGreaterThan(0);
  });

  test('**커서가 거절되면 자동으로 다시 부르지 않는다**', async ({ page }) => {
    const calls = await stubList(page, [
      { items: [item()], next_cursor: 'PAGE-A' },
      { __status: 400, error: { code: 'CURSOR_QUERY_MISMATCH', message: '조건이 바뀌었습니다' } },
    ]);

    await page.goto('/repositories');
    await expect(page.getByTestId('repository-card')).toBeVisible();

    await page.getByTestId('cursor-next').click();
    await expect(page.getByTestId('cursor-failure')).toBeVisible();

    // 지금까지 본 목록이 남아 있다 — 사용자가 자기 위치를 잃지 않는다.
    await expect(page.getByTestId('repository-card')).toBeVisible();

    const before = calls.length;
    await page.waitForTimeout(600);
    expect(calls.length, '자동 재조회가 돌면 사용자는 목록이 처음으로 간 것만 본다').toBe(before);
  });

  test('빈 목록 문구가 PR Search 범위를 말한다 (AC-10)', async ({ page }) => {
    await stubList(page, [{ items: [], next_cursor: null }]);

    await page.goto('/repositories');
    const empty = page.getByTestId('empty-state');
    await expect(page.getByText('표시할 등록 저장소가 없습니다')).toBeVisible();
    await expect(page.getByText(/GitHub에 접근 가능한 저장소가 없/)).toHaveCount(0);
    void empty;
  });
});

test.describe('등록 검토 요청 (AC-8·9)', () => {
  test('**실제 POST로 나가고 성공 안내가 뜬다**', async ({ page }) => {
    await stubList(page, [{ items: [], next_cursor: null }]);

    const posted: string[] = [];
    await page.route('**/api/repository-registration-requests', async (route) => {
      posted.push(route.request().postData() ?? '');
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          request_id: '318',
          repository: 'acme/new-repo',
          created_at: '2026-08-28T01:20:00.000Z',
          correlation_id: 'e2e',
        }),
      });
    });

    await page.goto('/repositories');
    await page.getByTestId('open-register-request').click();
    await page.getByTestId('register-request-repository').fill('acme/new-repo');
    await page.getByTestId('register-request-submit').click();

    await expect(page.getByTestId('register-request-recorded')).toBeVisible();
    expect(posted).toHaveLength(1);
    expect(JSON.parse(posted[0] ?? '{}')).toEqual({ repository: 'acme/new-repo' });
  });

  test('**요청 본문에 브랜치·미러·백필이 실리지 않는다** — 등록 계약이 열리지 않는다', async ({ page }) => {
    await stubList(page, [{ items: [], next_cursor: null }]);

    let body = '';
    await page.route('**/api/repository-registration-requests', async (route) => {
      body = route.request().postData() ?? '';
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ request_id: '1', repository: 'acme/x', created_at: '2026-08-28T00:00:00Z' }),
      });
    });

    await page.goto('/repositories');
    await page.getByTestId('open-register-request').click();
    await page.getByTestId('register-request-repository').fill('acme/x');
    await page.getByTestId('register-request-submit').click();
    await expect(page.getByTestId('register-request-recorded')).toBeVisible();

    for (const forbidden of ['sequence_branches', 'mirror_enabled', 'backfill', 'repository_id']) {
      expect(body).not.toContain(forbidden);
    }
  });
});

test.describe('진단 경로 연결 (DEV-159 만기)', () => {
  test('**W-005의 릴리스 미수집 안내에서 저장소 개요로 이동한다**', async ({ page }) => {
    await stubList(page, [{ items: [item()], next_cursor: null }]);

    await page.route('**/api/sequence-spaces*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          spaces: [
            {
              repository: 'acme/payments',
              repository_id: 4021,
              base_branch: 'main',
              sequence_space: 'acme/payments@main',
              seq_epoch: 1,
              sequence_state: 'ok',
            },
          ],
          correlation_id: 'e2e',
        }),
      });
    });
    await page.route('**/api/releases*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          repository: 'acme/payments',
          releases: [],
          truncated: false,
          reason: 'release_not_indexed',
          correlation_id: 'e2e',
        }),
      });
    });

    await page.goto('/releases?repo=acme%2Fpayments&branch=main');
    const link = page.getByTestId('releases-open-repository-overview');
    await expect(link).toBeVisible();
    await link.click();

    await expect(page).toHaveURL(/\/repositories\?repository=acme%2Fpayments/);
    await expect(page.getByTestId('repository-card')).toBeVisible();
  });
});
