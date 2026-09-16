import { expect, test, type Page, type Route } from '@playwright/test';
import { NOT_ACTIVATED_AUDIT_ACTIONS } from '@prs/domain';

/**
 * A-004 감사 로그 (WP-039 / FR-AUTH-004, NFR-006, CR-054).
 *
 * **실제 브라우저에서만 확인되는 것**만 둔다. 순수 판정은 `lib/audit.test.ts`가
 * 23건으로, 렌더와 접근성은 `a11y/audit.test.tsx`가 9건으로, 역할별 내비게이션은
 * `lib/nav.test.ts`가 이미 건다.
 *
 * 여기서 거는 것은 다섯이다.
 *
 *   1. 화면이 실제로 서고 기록을 그린다
 *   2. 필터 적용이 **URL과 요청 둘 다**를 바꾼다 — 딥링크가 재현 경로다
 *   3. 커서 다음 페이지가 이어진다
 *   4. 403이면 **필요 역할을 그대로 적는다** — "결과 없음"이 아니다
 *   5. **수정·삭제 컨트롤이 하나도 없다** (AC-3)
 *
 * ## 목이 서버 계약과 키를 맞춘다
 *
 * `WP-038`에서 배운 것이다 — 목이 응답을 지어내면 계약 버그를 숨긴다. 여기
 * 응답은 `API-ADM-005`의 필드 이름을 그대로 쓴다.
 */

interface Row {
  user_id: string;
  action: string;
  target: string | null;
  query: string | null;
  occurred_at: string;
  result_code: string;
  correlation_id: string;
}

const PAGE_ONE: readonly Row[] = [
  {
    user_id: 'alice',
    action: 'search.execute',
    target: null,
    query: 'repo:acme/payments seq:1200..1350',
    occurred_at: '2026-08-29T04:12:07.412Z',
    result_code: 'ok',
    correlation_id: '11111111-1111-4111-8111-111111111111',
  },
  {
    user_id: 'bob',
    action: 'entity.view',
    target: 'commit:acme/payments:a3f9c21',
    query: null,
    occurred_at: '2026-08-29T04:10:00.000Z',
    result_code: 'not_found',
    correlation_id: '22222222-2222-4222-8222-222222222222',
  },
];

const PAGE_TWO: readonly Row[] = [
  {
    user_id: 'system:audit-retention',
    action: 'retention.purge',
    target: 'audit_record_2025_07',
    query: null,
    occurred_at: '2026-08-29T03:00:00.000Z',
    result_code: 'dropped',
    correlation_id: '33333333-3333-4333-8333-333333333333',
  },
];

interface MockConfig {
  /** 403이면 권한 없음 경로를 탄다. */
  readonly status?: number;
  /** 서버가 실제로 받은 질의 문자열을 모은다. */
  readonly seen?: string[];
}

async function installRoutes(page: Page, config: MockConfig = {}): Promise<void> {
  await page.route('**/api/admin/audit-records**', async (route: Route) => {
    const url = new URL(route.request().url());
    config.seen?.push(url.search);

    if (config.status !== undefined && config.status !== 200) {
      return route.fulfill({
        status: config.status,
        contentType: 'application/json',
        body: JSON.stringify({
          error: { code: 'FORBIDDEN_ROLE', message: '권한이 없습니다' },
          correlation_id: 'c-403',
        }),
      });
    }

    const cursor = url.searchParams.get('cursor');
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(
        cursor === null
          ? { items: PAGE_ONE, next_cursor: 'page-two-cursor', correlation_id: 'c-1' }
          : { items: PAGE_TWO, next_cursor: null, correlation_id: 'c-2' },
      ),
    });
  });
}

test.describe('A-004 감사 로그', () => {
  test('화면이 서고 기록을 그린다', async ({ page }) => {
    await installRoutes(page);
    await page.goto('/ops/audit');

    await expect(page.getByTestId('audit-view')).toHaveAttribute('data-state', 'ready');
    await expect(page.getByTestId('audit-row')).toHaveCount(2);
    await expect(page.getByTestId('audit-record-table')).toBeVisible();
  });

  test('**`null`을 빈 값으로 그린다** — `N/A`를 지어내지 않는다 (AC-2)', async ({ page }) => {
    await installRoutes(page);
    await page.goto('/ops/audit');

    // 검색 행의 대상, 상세 행의 질의 — 둘이 비어 있다.
    await expect(page.getByTestId('audit-absent')).toHaveCount(2);
    await expect(page.getByText('N/A')).toHaveCount(0);
  });

  test('필터 적용이 URL과 요청 둘 다를 바꾼다', async ({ page }) => {
    const seen: string[] = [];
    await installRoutes(page, { seen });
    await page.goto('/ops/audit');
    await expect(page.getByTestId('audit-row').first()).toBeVisible();

    await page.getByLabel("Action type").fill('entity.view');
    await page.getByTestId('audit-apply').click();

    // URL이 조건을 담는다 — 조사 중이던 조건을 붙여넣기로 넘길 수 있다.
    await expect(page).toHaveURL(/action=entity\.view/);
    // 서버도 그 조건을 실제로 받았다.
    await expect
      .poll(() => seen.some((search) => search.includes('action=entity.view')))
      .toBe(true);
  });

  test('**빈 조건은 질의 문자열을 만들지 않는다** — 서버를 400으로 만들지 않는다', async ({
    page,
  }) => {
    const seen: string[] = [];
    await installRoutes(page, { seen });
    await page.goto('/ops/audit');
    await expect(page.getByTestId('audit-row').first()).toBeVisible();

    await page.getByTestId('audit-apply').click();
    await expect.poll(() => seen.length).toBeGreaterThan(1);
    for (const search of seen) {
      expect(search).not.toContain('action=&');
      expect(search).not.toMatch(/user_id=(&|$)/);
    }
  });

  test('딥링크로 들어온 조건이 첫 조회에 실린다', async ({ page }) => {
    const seen: string[] = [];
    await installRoutes(page, { seen });
    await page.goto('/ops/audit?action=retention.purge&user_id=alice');

    await expect(page.getByTestId('audit-row').first()).toBeVisible();
    await expect
      .poll(() => seen.some((s) => s.includes('action=retention.purge') && s.includes('user_id=alice')))
      .toBe(true);
    // 입력 칸도 그 값을 보인다 — URL과 화면이 어긋나지 않는다.
    await expect(page.getByLabel("Action type")).toHaveValue('retention.purge');
  });

  test('커서 다음 페이지가 이어진다 — 앞 페이지를 비우지 않는다', async ({ page }) => {
    await installRoutes(page);
    await page.goto('/ops/audit');
    await expect(page.getByTestId('audit-row')).toHaveCount(2);

    await page.getByTestId('cursor-next').click();
    // 두 페이지가 쌓인다.
    await expect(page.getByTestId('audit-row')).toHaveCount(3);
    await expect(page.getByText('audit_record_2025_07')).toBeVisible();
  });

  test('403이면 **필요 역할을 그대로 적는다** — "결과 없음"이 아니다', async ({ page }) => {
    await installRoutes(page, { status: 403 });
    await page.goto('/ops/audit');

    await expect(page.getByTestId('audit-view')).toHaveAttribute('data-state', 'no_permission');
    await expect(page.getByRole('heading', { name: /security_officer/ })).toBeVisible();
    // 조건에 맞는 기록이 없다고 말하지 않는다 — 볼 자격이 없는 것이다.
    await expect(page.getByText(/No audit records match these filters/)).toHaveCount(0);
  });

  test('QA-A004-03: 수정·삭제 컨트롤이 표에 없다 (AC-3)', async ({ page }) => {
    await installRoutes(page);
    await page.goto('/ops/audit');
    await expect(page.getByTestId('audit-row').first()).toBeVisible();

    const table = page.getByTestId('audit-record-table');
    await expect(table.locator('button')).toHaveCount(0);
    await expect(table.locator('input')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Delete|Update|Edit/ })).toHaveCount(0);
  });

  test('행위 후보에 legacy 값이 있고 미활성 액션은 없다 (AC-7, DEV-403)', async ({ page }) => {
    await installRoutes(page);
    await page.goto('/ops/audit');

    const options = page.locator('#audit-action-options option');
    await expect(options.filter({ has: page.locator('[value="sequence_integrity.reassign"]') })).toHaveCount(
      0,
    );
    // `datalist` 옵션은 value 속성으로 확인한다.
    const values = await options.evaluateAll((nodes) =>
      nodes.map((node) => (node as HTMLOptionElement).value),
    );
    expect(values).toContain('sequence_integrity.reassign');
    expect(values).toContain('audit.view');
    /*
     * **정본 목록과 대조한다** (WP-041). 문자열을 여기 적으면 액션이 활성으로
     * 옮겨갈 때 이 시험이 그 사실을 결함으로 신고한다 — `safe_marker.set`이
     * 실제로 그렇게 됐다. 확인할 성질은 "미활성인 것이 후보에 없다"이지
     * "이 두 문자열이 없다"가 아니다.
     */
    for (const action of NOT_ACTIVATED_AUDIT_ACTIONS) {
      expect(values, action).not.toContain(action);
    }
    // 활성으로 옮겨간 것은 후보에 있어야 한다.
    expect(values).toContain('safe_marker.set');
  });
});
