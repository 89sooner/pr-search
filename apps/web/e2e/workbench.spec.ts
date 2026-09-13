import { expect, test, type Page } from '@playwright/test';
import axe from 'axe-core';
import { mkdir } from 'node:fs/promises';

/** WP-073 / FR-SRCH-001·006·007·008 / FR-SEQ-005 / NFR-007.
 * 실제 포커스, 요청 수, URL, CSS 밀도/대비를 검증한다. 데이터는 UI 계약용 fixture다.
 */
const QUERY = 'repo:platform/engine base:main';
const TITLES = [
  '렌더 스레드의 리소스 해제 순서 수정', 'feat: 셰이더 캐시 증분 빌드 지원',
  'fix: 월드 스트리밍 경계의 충돌 누락 수정', '네트워크 패킷 직렬화 비용 감소',
  'test: 에셋 로딩 회귀 시나리오 추가', '빌드 메타데이터의 버전 정보 정규화',
];
const ROWS = Array.from({ length: 25 }, (_, i) => ({
  kind: 'pull_request', repository: 'platform/engine', pr_number: 2486 - i,
  title: TITLES[i % TITLES.length], author: ['minseo', 'jiho', 'yuna', 'alex'][i % 4],
  state: 'merged', merge_seq: 18472 - i, seq_epoch: 3, sequence_space: 'platform/engine@main',
  merged_at: '2026-09-08T02:24:00Z', changed_files_count: i + 2, additions: 37 + i * 8, deletions: 12 + i,
  url: `/pr/platform/engine/${2486 - i}`,
}));

async function searchFixture(page: Page, overrides: Record<string, unknown> = {}): Promise<string[]> {
  const calls: string[] = [];
  await page.route('**/api/**', async (route) => {
    calls.push(route.request().url());
    if (!new URL(route.request().url()).pathname.endsWith('/search')) {
      await route.fulfill({ status: 500, json: { error: { code: 'UNEXPECTED_TEST_REQUEST' } } });
      return;
    }
    await route.fulfill({ json: {
      total: { value: 25, relation: 'eq' }, items: ROWS,
      sort: { field: 'merge_seq', order: 'desc' }, next_cursor: null,
      facets_omitted: false,
      facets: {
        repository: [{ value: 'platform/engine', count: 25 }],
        author: [{ value: 'minseo', count: 9 }, { value: 'jiho', count: 7 }, { value: 'yuna', count: 5 }, { value: 'alex', count: 4 }],
        base_branch: [{ value: 'main', count: 25 }],
        label: [{ value: 'rendering', count: 14 }, { value: 'bugfix', count: 8 }],
        state: [{ value: 'merged', count: 25 }],
      }, ...overrides,
    } });
  });
  return calls;
}
async function openResults(page: Page): Promise<void> {
  await page.goto(`/search?q=${encodeURIComponent(QUERY)}`);
  await expect(page.getByTestId('result-row')).toHaveCount(25);
}
async function noDocumentOverflow(page: Page): Promise<void> {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}
async function capture(page: Page, name: string): Promise<void> {
  const dir = process.env['PRS_UI_EVIDENCE'];
  if (dir === undefined) return;
  await mkdir(dir, { recursive: true });
  await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
}

/**
 * 하이드레이션이 끝나 단축키 리스너(`AppTopBar`의 `document` keydown)가 붙기 전에 누른 키는 사라진다 —
 * `goto`는 로드까지만 기다리므로 그 창이 실제로 있었다(CI·로컬에서 간헐 실패, `DEV-662`). 붙을 때까지
 * 다시 누른다. 제품 코드가 아니라 시험의 대기 조건을 고친 것이다.
 */
async function pressShortcutUntil(page: Page, settled: () => Promise<void>): Promise<void> {
  await expect(async () => {
    await page.keyboard.press('Control+k');
    await settled();
  }).toPass({ timeout: 10_000 });
}

test('WP-073: 검색 단축키가 실제 검색창을 잡고 예시는 요청 없이 편집된다', async ({ page }) => {
  const calls = await searchFixture(page);
  await page.goto('/search');
  await pressShortcutUntil(page, () => expect(page.getByRole('searchbox')).toBeFocused({ timeout: 500 }));
  await page.getByRole('button', { name: /머지 순서 조사/ }).click();
  await expect(page.getByRole('searchbox')).toBeFocused();
  await expect(page.getByRole('searchbox')).toHaveValue('repo:owner/repo base:main seq:1200..1350');
  expect(calls).toEqual([]);
});

test('WP-073: 다른 화면의 빠른 검색도 입력으로 이동한다', async ({ page }) => {
  await page.goto('/');
  await pressShortcutUntil(page, () => expect(page).toHaveURL(/\/search#omni-search-input$/, { timeout: 500 }));
  await expect(page.getByRole('searchbox')).toBeFocused();
});

test('WP-073: 선택/화살표/닫기 포커스, 추가 API 요청 없음, 제목 링크 보존', async ({ page }) => {
  const calls = await searchFixture(page);
  await openResults(page);
  const selection = page.locator('[data-result-select]');
  await selection.nth(0).click();
  await expect(page.getByRole('region', { name: '선택한 결과 미리보기' })).toContainText('#2486');
  await page.keyboard.press('ArrowDown');
  await expect(selection.nth(1)).toBeFocused();
  await expect(selection.nth(1)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('region', { name: '선택한 결과 미리보기' })).toContainText('#2485');
  await page.getByRole('button', { name: '미리보기 닫기' }).click();
  await expect(selection.nth(1)).toBeFocused();
  await expect(page.getByRole('region', { name: '선택한 결과 미리보기' })).toHaveCount(0);
  await page.keyboard.press('End');
  await expect(selection.nth(24)).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('region', { name: '선택한 결과 미리보기' })).toHaveCount(0);
  expect(calls).toHaveLength(1);
  await expect(page.getByTestId('result-link').first()).toHaveAttribute('href', new RegExp('/pr/platform/engine/2486\\?from_q='));
});

test('WP-073: 필터 접기는 조회/URL을 바꾸지 않고 갱신은 선택을 지운다', async ({ page }) => {
  const calls = await searchFixture(page);
  await openResults(page);
  const url = page.url();
  await page.locator('[data-result-select]').first().click();
  await page.getByRole('button', { name: '필터', exact: true }).click();
  await expect(page.getByRole('complementary', { name: '필터' })).toBeHidden();
  expect(page.url()).toBe(url);
  expect(calls).toHaveLength(1);
  await page.getByRole('button', { name: '필터', exact: true }).click();
  await expect(page.getByRole('complementary', { name: '필터' })).toBeVisible();
  await page.getByRole('button', { name: '결과 새로고침' }).click();
  await expect(page.getByRole('region', { name: '선택한 결과 미리보기' })).toHaveCount(0);
  await expect.poll(() => calls.length).toBe(2);
  await expect(page.getByTestId('result-row')).toHaveCount(25);
});

test('WP-073: 질의 변경 시 이전 선택 데이터를 보여주지 않는다', async ({ page }) => {
  await searchFixture(page);
  await openResults(page);
  await page.locator('[data-result-select]').first().click();
  await page.getByLabel('minseo (9)').click();
  await expect(page).toHaveURL(/author%3Aminseo/);
  await expect(page.getByRole('region', { name: '선택한 결과 미리보기' })).toHaveCount(0);
});

test('WP-073: 1440×1200에서 25행을 읽을 수 있다', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1200 });
  await searchFixture(page);
  await openResults(page);
  await noDocumentOverflow(page);
  const last = await page.getByTestId('result-row').last().boundingBox();
  expect(last).not.toBeNull();
  expect(last!.y + last!.height).toBeLessThanOrEqual(1200);
  await capture(page, 'workbench-25-rows');
});

for (const scheme of ['dark', 'light'] as const) {
  test(`WP-073: ${scheme} 테마 결과/선택 대비와 axe`, async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 1100 });
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await searchFixture(page);
    await openResults(page);
    await page.locator('[data-result-select]').nth(2).click();
    await page.addScriptTag({ content: axe.source });
    const violations = await page.evaluate(async () => {
      const axe = (window as unknown as { axe: { run: (node: Element, options: unknown) => Promise<{ violations: unknown[] }> } }).axe;
      return (await axe.run(document.documentElement, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] } })).violations;
    });
    expect(violations).toEqual([]);
    expect(errors).toEqual([]);
    await capture(page, `workbench-${scheme}`);
  });
}

test('WP-073: 390px에서 문서 가로 넘침 없이 필터/표/선택/내비게이션 사용', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await searchFixture(page, { items: ROWS.map((row, i) => i === 0 ? { ...row, title: 'LongIdentifier'.repeat(40), author: 'LongAuthor'.repeat(20) } : row) });
  await openResults(page);
  await noDocumentOverflow(page);
  await page.getByRole('button', { name: '필터', exact: true }).click();
  await page.locator('[data-result-select]').first().click();
  await expect(page.getByRole('region', { name: '선택한 결과 미리보기' })).toBeVisible();
  await noDocumentOverflow(page);
  await capture(page, 'workbench-mobile');
  await page.getByRole('button', { name: '주요 화면 열기' }).click();
  await expect(page.getByRole('link', { name: '저장된 검색', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: '주요 화면 열기' })).toBeFocused();
});

test('WP-073: 클립보드 실패를 숨기지 않는다', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new Error('denied')) } }));
  await searchFixture(page);
  await openResults(page);
  await page.locator('[data-result-select]').first().click();
  await page.getByRole('button', { name: '식별자 복사' }).click();
  await expect(page.getByRole('region', { name: '선택한 결과 미리보기' })).toContainText('복사하지 못했습니다');
});

test('WP-073: 커밋 선택은 전체 SHA와 미확인을 보존하고 복사한다', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const sha = 'a123456789abcdef0123456789abcdef012345678';
  await searchFixture(page, {
    total: { value: 1, relation: 'eq' },
    items: [{ kind: 'commit', repository: 'platform/engine', commit_sha: sha, title: null, author: null, state: null,
      merge_seq: null, seq_epoch: null, sequence_space: null, merged_at: null,
      changed_files_count: null, additions: null, deletions: null, url: `/commit/platform/engine/${sha}` }],
  });
  await page.goto(`/search?q=${encodeURIComponent(QUERY)}`);
  await page.locator('[data-result-select]').first().click();
  const preview = page.getByRole('region', { name: '선택한 결과 미리보기' });
  await expect(preview).toContainText(sha);
  await expect(preview).toContainText('파일 수 미확인');
  await expect(preview).toContainText('시퀀스 공간 미확인');
  await expect(preview).not.toContainText('+0');
  await page.getByRole('button', { name: '식별자 복사' }).click();
  await expect(preview).toContainText('식별자를 복사했습니다.');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(sha);
});

test('WP-073: 상세 섹션 링크가 제목에 키보드 포커스를 옮기고 자동 조회하지 않는다', async ({ page }) => {
  const calls: string[] = [];
  await page.route('**/api/**', async (route) => {
    calls.push(route.request().url());
    await route.fulfill({ json: {
      repository: 'platform/engine', pr_number: 2486, title: TITLES[0], state: 'merged',
      author: 'minseo', base_branch: 'main', head_branch: 'fix/resource-lifetime',
      labels: ['rendering', 'bugfix'], reviewers: ['jiho'], approved_by: ['jiho'],
      source_commits: [{ commit_sha: 'b'.repeat(40), message: 'Fix resource lifetime', author: 'minseo', committed_at: '2026-09-08T02:00:00Z' }],
      source_commits_total: 1, merge_commit_sha: 'c'.repeat(40),
      merge_seq: 18472, seq_epoch: 3, sequence_space: 'platform/engine@main',
      created_at: '2026-09-07T02:00:00Z', merged_at: '2026-09-08T02:24:00Z',
      changed_files_count: 4, additions: 68, deletions: 23, lead_time_seconds: 87840,
    } });
  });
  await page.goto('/pr/platform/engine/2486');
  await expect(page.getByTestId('pr-detail')).toHaveAttribute('data-screen-state', 'ready');
  const baselineCalls = calls.length;
  await page.getByRole('navigation', { name: '상세 섹션' }).getByRole('link', { name: '커밋', exact: true }).click();
  await expect(page.getByRole('heading', { name: '커밋', exact: true })).toBeFocused();
  expect(calls).toHaveLength(baselineCalls);
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await capture(page, 'workbench-pr-detail');
});
