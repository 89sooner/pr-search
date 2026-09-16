// Executable UI smoke test and screenshots. All API payloads here are fictional.
/* global document, innerWidth, Storage */
import { URL } from 'node:url';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { chromium } = require('../apps/web/node_modules/@playwright/test');
const output = '/tmp/pr-search-ui';
const origin = process.env.PR_SEARCH_PREVIEW_URL || 'http://localhost:3123';
const repo = 'platform/payments-api';
const now = '2026-09-16T01:42:00Z';
const repositories = ['platform/payments-api', 'platform/checkout-web', 'platform/design-system'].map((repository, i) => ({ repository_id: i + 1, repository, registration_state: 'active', registered_at: now, last_ingested_at: now, document_counts: { pull_requests: 1248 - i * 170, commits: 6480 - i * 860, total: 7728 - i * 1030 }, backfill: null, sequence_spaces: [{ base_branch: 'main', last_sequence: 2901 - i * 400, seq_epoch: 3, sequence_state: 'ok', last_assigned_at: now }], reconciliation: { last_completed_at: now, missing_count: 0 }, unavailable: [] }));
const titles = ['Improve payment retry policy and observability', 'Clarify gateway timeout messages', 'Separate settlement idempotency keys', 'Refactor payment fee calculation', 'Add receipt webhook recovery', 'Update asynchronous payment status'];
const rows = titles.map((title, i) => ({ kind: 'pull_request', repository: repo, pr_number: 1842 - i, title, author: ['minji', 'jiyoon', 'dohyun'][i % 3], state: i === 5 ? 'open' : 'merged', merge_seq: i === 5 ? null : 2901 - i, sequence_space: `${repo}@main`, seq_epoch: 3, merged_at: i === 5 ? null : now, changed_files_count: 4 + i, additions: 128 + i * 21, deletions: 16 + i * 3, url: `/pr/${repo}/${1842 - i}` }));
const detail = { ...rows[0], body: 'Separate retry policy from request handling and make failure stages easier to investigate.', head_branch: 'feat/retry-observability', base_branch: 'main', changed_paths: ['apps/api/src/payments/retry.ts', 'apps/api/src/payments/retry.test.ts', 'packages/metrics/src/payments.ts'], source_commits: [{ commit_sha: '9a3d8b21d8e74c8ba4dfce62db1d19f6e2b3a8e1' }], merge_commit_sha: 'bf21a40112cbeafd901732e5e0a9cf566cc18752', labels: ['payments', 'observability'], reviewers: ['jiyoon'], approved_by: ['jiyoon'], created_at: '2026-09-14T01:42:00Z' };
const saved = { saved_search_id: 1, name: 'Payment regression watch', query: `repo:${repo}`, visibility: 'private', owner: { user_id: 'demo', login: 'minji' }, is_owner: true, query_status: 'valid', created_at: now, last_run_at: now };
const pipeline = { generated_at: now, intake_per_minute: 420, queue_depth: { ingest: 12, enrich: 3, project: 0 }, ingestion_lag_seconds: { ingest: 1.2, enrich: 2.4 }, stage_latency_seconds: { ingest: .2, enrich: 2.4, project: .8 }, dead_letter: { pending: 0 }, enrichment_pending: 5, sequence_space_state: { ok: 12 }, slowest_repositories: [], slowest_repositories_out_of_scope: 0, unavailable: [] };
const pct = { field: 'lead_time_seconds', unit: 'seconds', p50: 61200, p75: 80000, p90: 120000, p95: 200000, p99: 400000, overall: { p50: 61200, p75: 80000, p90: 120000, p95: 200000, p99: 400000 }, sample_size: 412, low_sample: false, groups: [], excluded_count: 17, excluded_reasons: { no_review: 17 }, total: { value: 412, relation: 'eq' }, approximate: false };
async function intercept(page) {
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url()); const path = url.pathname; const q = url.searchParams.get('q') || '';
    let body = { items: [], next_cursor: null };
    let status = 200;
    if (path === '/api/repositories') body = { items: repositories, next_cursor: null };
    else if (path.includes('/source/') && path.endsWith('/tree')) body = { repository: repo, ref: 'main', revision: 'a'.repeat(40), path: '', entries: [{ name: 'src', path: 'src', sha: 'b'.repeat(40), kind: 'directory', size: null }], truncated: false };
    else if (path.includes('/source/') && path.endsWith('/history')) body = { repository: repo, revision: 'a'.repeat(40), path: url.searchParams.get('path') || '', commits: [], next_page: null };
    else if (path === '/api/search') { const items = q.includes('state:"merged"') ? rows.filter(r => r.state === 'merged') : rows; body = { items, total: { value: items.length, relation: 'eq' }, next_cursor: null }; }
    else if (path.startsWith('/api/pull-requests/')) body = detail;
    else if (path === '/api/saved-searches') body = { view: url.searchParams.get('view'), items: url.searchParams.get('view') === 'mine' ? [saved] : [], next_cursor: null };
    else if (path === '/api/teams') body = { items: [] };
    else if (path === '/api/admin/pipeline-status') body = pipeline;
    else if (path === '/api/admin/reindex') body = { generated_at: now, aliases: [{ alias: 'prs-pull-requests', current_index: 'prs-pull-requests-v2', document_count: 1248, store_size_bytes: 184000000, active_reindex: null, last_reindex: { job_id: 70, state: 'completed', switched_at: now } }, { alias: 'prs-commits', current_index: 'prs-commits-v2', document_count: 6480, store_size_bytes: 322100000, active_reindex: null, last_reindex: null }], unavailable: [] };
    else if (path === '/api/admin/sequence-integrity') body = { reports: [{ repository: repo, base_branch: 'main', seq_epoch: 3, checked_at: now, consistent: true, first_mismatch_seq: null, stored_sha: null, actual_sha: null, checked_count: 2901 }], impacts: {} };
    else if (path === '/api/admin/jobs') body = { items: [{ job_id: 11, type: 'backfill', target: repo, state: 'running', progress: { done: 120, total: 320, unit: 'PR' }, requested_by: 'minji', started_at: now, finished_at: null, error: null, allowed_actions: ['pause', 'cancel'] }], next_cursor: null };
    else if (path.endsWith('/analytics/groups')) body = { query: `repo:${repo}`, group_by: 'team', total: { value: 700, relation: 'eq' }, groups: [{ key: 'payments-core', count: 412, changed_files_sum: 2841, additions_sum: 51240, lead_time_median: 61200, drill_down_query: `repo:${repo}` }, { key: 'checkout', count: 288, changed_files_sum: 1522, additions_sum: 29110, lead_time_median: 44100, drill_down_query: 'repo:platform/checkout-web' }], approximate: false, truncated: false };
    else if (path.endsWith('/analytics/time-series')) body = { interval: 'day', timezone: 'UTC', buckets: ['2026-09-14', '2026-09-15', '2026-09-16'], series: [{ key: 'payments', values: [14, 9, 12] }], total: { value: 35, relation: 'eq' }, approximate: false, truncated: false, applied_range: { from: '2026-09-14T00:00:00Z', to: now } };
    else if (path.endsWith('/analytics/percentiles')) body = pct;
    else if (path.endsWith('/analytics/distributions')) body = { dimension: 'changed_files', total: { value: 400, relation: 'eq' }, buckets: [{ key: '1', count: 120, ratio: .3, drill_down_query: `repo:${repo}` }, { key: '2-5', count: 200, ratio: .5, drill_down_query: `repo:${repo}` }, { key: '6-10', count: 80, ratio: .2, drill_down_query: `repo:${repo}` }], approximate: false };
    else if (path.includes('/gh/')) { status = 404; body = { error: { code: 'NOT_FOUND', message: 'This feature is not enabled in the preview.' } }; }
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ ...body, correlation_id: 'fictional-preview' }) });
  });
}
(async () => {
  mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PR_SEARCH_CHROME || '/home/roqkf/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome' });
  try {
    const context = await browser.newContext({ viewport: { width: 1536, height: 1000 }, locale: 'en-US', colorScheme: 'light' });
    const page = await context.newPage(); const errors = [];
    page.on('pageerror', error => { errors.push(error.message); });
    await intercept(page);
    async function settle() { await page.waitForLoadState('networkidle'); await page.evaluate(() => document.fonts.ready); await page.addStyleTag({ content: 'nextjs-portal{display:none!important}' }); }
    async function capture(name) {
      await settle();
      const copy = await page.locator('body').innerText();
      assert.ok(!/[가-힣]/u.test(copy), `Untranslated UI on ${name}: ${copy.match(/[^\n]*[가-힣][^\n]*/gu)?.join('\n')}`);
      assert.equal(await page.locator('[class*="cdt-"]').count(), 0, 'Conductor classes remain');
      await page.screenshot({ path: `${output}/${name}-light.png`, fullPage: true, animations: 'disabled' });
      await page.getByRole('button', { name: 'Dark mode' }).click();
      assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
      await page.screenshot({ path: `${output}/${name}-dark.png`, fullPage: true, animations: 'disabled' });
      await page.getByRole('button', { name: 'Dark mode' }).click();
    }
    await page.goto(`${origin}/search`); await page.locator('.repo-expand').first().waitFor(); await capture('search');
    await page.locator('.repo-expand').first().click(); await page.locator('.repo-description').waitFor(); await capture('search-detail');
    await page.getByRole('combobox', { name: 'Status', exact: true }).click(); await page.getByRole('option', { name: /Merged/i }).click();
    await page.locator('.repo-filter-form button[type="submit"]').click(); await page.waitForURL('**state=merged*');
    assert.equal(await page.getByLabel('Label', { exact: true }).count(), 1);
    await page.keyboard.press('Control+k'); assert.ok(await page.locator('[data-reader-search]').evaluate(el => el === document.activeElement));
    await page.getByRole('button', { name: 'Dark mode' }).click(); await page.reload(); await settle(); assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark', 'Theme did not survive reload');
    const other = await context.newPage(); await intercept(other); await other.goto(`${origin}/repositories`); await other.waitForLoadState('networkidle');
    await page.getByRole('button', { name: 'Dark mode' }).click();
    await other.waitForFunction(() => document.documentElement.dataset.theme === 'light'); await other.close();
    await page.goto(`${origin}/repositories`); await page.getByTestId('repository-card').first().waitFor(); await capture('repositories');
    await page.goto(`${origin}/saved-searches`); await page.getByTestId('saved-mine-row-1').waitFor(); await capture('saved-searches');
    await page.getByTestId('saved-mine-row-1-edit').click(); await page.getByRole('dialog').waitFor();
    await page.getByRole('textbox', { name: /^Name/ }).fill(''); assert.ok(await page.getByTestId('save-search-submit').isDisabled());
    await page.keyboard.press('Escape'); assert.equal(await page.getByRole('dialog').count(), 0);
    await page.waitForFunction(() => document.querySelector('[data-testid="saved-mine-row-1-edit"]') === document.activeElement, null, { timeout: 3000 });
    await page.goto(`${origin}/analytics?q=org:platform&group_by=team`); await page.getByTestId('group-drilldown').first().waitFor(); await capture('analytics');
    await page.goto(`${origin}/ops/pipeline`); await page.getByTestId('section-metrics').waitFor(); await capture('pipeline');
    for (const [path, name] of [['/ranges','ranges'], ['/releases','releases'], ['/ops/jobs','jobs'], ['/ops/audit','audit'], ['/gh','github'], ['/gh/history','github-history'], ['/ops/repositories','repository-management'], ['/ops/gh-registry','registry'], ['/ops/gh-policy','policy'], [`/pr/${repo}/1842`, 'pr-details']]) { await page.goto(`${origin}${path}`); await capture(name); }
    await page.goto(`${origin}/repositories`); await settle(); await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: /Open main menu|Open navigation/ }).click(); await page.getByRole('dialog').waitFor(); await page.keyboard.press('Escape');
    assert.equal(await page.getByRole('dialog').count(), 0);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Mobile page overflow');
    await page.screenshot({ path: `${output}/mobile.png`, fullPage: true, animations: 'disabled' });
    const privateContext = await browser.newContext({ colorScheme: 'dark' });
    await privateContext.addInitScript(() => {
      const read = Storage.prototype.getItem; const write = Storage.prototype.setItem;
      Storage.prototype.getItem = function (key) { if (key === 'pr-search-theme') throw new Error('Storage blocked'); return read.call(this, key); };
      Storage.prototype.setItem = function (key, value) { if (key === 'pr-search-theme') throw new Error('Storage blocked'); write.call(this, key, value); };
    });
    const privatePage = await privateContext.newPage();
    await privatePage.goto(`${origin}/auth/signed-out`); await privatePage.waitForLoadState('networkidle');
    assert.equal(await privatePage.locator('html').getAttribute('data-theme'), 'dark', 'System preference was ignored');
    await privatePage.getByRole('button', { name: 'Dark mode' }).click();
    assert.equal(await privatePage.locator('html').getAttribute('data-theme'), 'light', 'Blocked storage prevented a theme change');
    await privateContext.close();
    assert.deepEqual(errors, []);
    console.log(`PASS: 17 screen states, light/dark, persisted/cross-tab/system/blocked-storage theme, select, filters, shortcut, field validation, dialog focus, mobile drawer; screenshots ${output}`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
