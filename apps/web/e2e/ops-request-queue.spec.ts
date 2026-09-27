import { expect, test, type Page, type Route } from '@playwright/test';

/**
 * A-002 등록 검토 요청 대기열의 이어 보기 (WP-040 / API-ADM-009, CR-125 / DEV-777).
 *
 * 실제 브라우저에서만 확인되는 것 둘을 건다 — 「Load more」가 앞 페이지를 비우지 않고 이어 붙이는가, 그리고
 * 다음 쪽 커서가 옛 판으로 거절되면 쌓인 항목을 지우지 않고 첫 페이지 재조회를 안내하는가(전에는 대기열
 * 전체가 일반 오류 배너로 바뀌어 첫 페이지로 돌아갈 방법이 없었다).
 *
 * 응답은 `API-ADM-009`의 필드 이름을 그대로 쓴다. 누락·중복 없는 순회 자체는 실제 PostgreSQL을 쓰는
 * `apps/search-api/integration/admin/admin-list-cursor-precision.test.ts`가 건다.
 */

interface RequestRow {
  request_id: string;
  requested_by: string;
  repository: string;
  created_at: string;
  status: string;
  resolved_at: string | null;
  resolved_by: string | null;
  resolution_note: string | null;
}

const row = (id: string, repository: string, createdAt: string): RequestRow => ({
  request_id: id,
  requested_by: 'alice',
  repository,
  created_at: createdAt,
  status: 'pending',
  resolved_at: null,
  resolved_by: null,
  resolution_note: null,
});

const PAGE_ONE = [row('12', 'acme/web', '2026-09-26T10:00:00.124Z'), row('11', 'acme/api', '2026-09-26T10:00:00.123Z')];
const PAGE_TWO = [row('10', 'acme/docs', '2026-09-26T10:00:00.123Z')];

interface MockConfig {
  readonly outdatedNextPage?: boolean;
  readonly seen?: string[];
}

async function installRoutes(page: Page, config: MockConfig = {}): Promise<void> {
  await page.route('**/api/admin/repositories', async (route: Route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], correlation_id: 'r-1' }) }),
  );
  await page.route('**/api/admin/repository-registration-requests**', async (route: Route) => {
    const url = new URL(route.request().url());
    config.seen?.push(url.search);
    const cursor = url.searchParams.get('cursor');
    if (cursor !== null && config.outdatedNextPage === true) {
      return route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({
          error: {
            code: 'CURSOR_INVALID',
            message: '옛 판 커서다',
            detail: { reason: 'cursor_version_outdated', issued_version: 1, current_version: 2 },
          },
          correlation_id: 'q-outdated',
        }),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(
        cursor === null
          ? { items: PAGE_ONE, next_cursor: 'page-two-cursor', correlation_id: 'q-1' }
          : { items: PAGE_TWO, next_cursor: null, correlation_id: 'q-2' },
      ),
    });
  });
}

test.describe('A-002 등록 검토 요청 대기열 — 이어 보기', () => {
  test('Load more가 다음 쪽을 이어 붙이고, 마지막 쪽에서 사라진다', async ({ page }) => {
    const seen: string[] = [];
    await installRoutes(page, { seen });
    await page.goto('/ops/repositories');
    await expect(page.getByTestId('request-row')).toHaveCount(2);

    await page.getByTestId('request-load-more').click();
    await expect(page.getByTestId('request-row')).toHaveCount(3);
    await expect(page.getByTestId('request-repository')).toHaveText(['acme/web', 'acme/api', 'acme/docs']);
    await expect(page.getByTestId('request-load-more')).toHaveCount(0);
    expect(seen.some((search) => search.includes('cursor=page-two-cursor'))).toBe(true);
  });

  test('**옛 판 커서는 쌓인 항목을 지우지 않고 첫 페이지 재조회를 안내한다** (DEV-777)', async ({ page }) => {
    await installRoutes(page, { outdatedNextPage: true });
    await page.goto('/ops/repositories');
    await expect(page.getByTestId('request-row')).toHaveCount(2);

    await page.getByTestId('request-load-more').click();
    await expect(page.getByTestId('request-cursor-failure')).toHaveAttribute('data-cursor-failure', 'CURSOR_OUTDATED');
    await expect(page.getByText('This page position is from an earlier version')).toBeVisible();
    // 이미 받은 요청은 그대로이고, 거절된 위치에서 이어 읽지 않는다.
    await expect(page.getByTestId('request-row')).toHaveCount(2);
    await expect(page.getByTestId('request-load-more')).toHaveCount(0);
    // 일반 실패 배너로 대기열을 바꾸지 않는다.
    await expect(page.getByText('Unable to load registration review requests')).toHaveCount(0);

    await page.getByTestId('request-first-page').click();
    await expect(page.getByTestId('request-cursor-failure')).toHaveCount(0);
    await expect(page.getByTestId('request-row')).toHaveCount(2);
    await expect(page.getByTestId('request-load-more')).toHaveCount(1);
  });
});
