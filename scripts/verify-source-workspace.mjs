/* global document, window */
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { URL } from 'node:url';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { chromium } = require('../apps/web/node_modules/@playwright/test');
const axe = require('../apps/web/node_modules/axe-core');
async function accessibility(page, label) {
  await page.addScriptTag({ content: axe.source });
  const violations = await page.evaluate(async () => (await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] } })).violations.map(item => ({ id: item.id, impact: item.impact, targets: item.nodes.map(node => node.target) })));
  assert.deepEqual(violations, [], `${label}: accessibility violations`);
}
const origin = process.env.PR_SEARCH_PREVIEW_URL || 'http://localhost:3123';
const output = '/tmp/pr-search-source';
const repo = 'platform/payments-api';
const shas = ['1', '2', '3'].map(char => char.repeat(40));
const texts = ['export function retryLimit() {\n  return 1;\n}\n', '// Configuration\nexport function retryLimit() {\n  return 2;\n}\n', '// Configuration\nexport function retryLimit() {\n  return 3;\n}\n'];
const sharedSource = `
export interface RetryPolicy {
  readonly initialDelayMs: number;
  readonly maxDelayMs: number;
  readonly multiplier: number;
}

export const defaultPolicy: RetryPolicy = {
  initialDelayMs: 250,
  maxDelayMs: 5000,
  multiplier: 2,
};

export function delayForAttempt(attempt: number, policy = defaultPolicy) {
  const delay = policy.initialDelayMs * policy.multiplier ** attempt;
  return Math.min(delay, policy.maxDelayMs);
}

export function canRetry(status: number) {
  return status === 429 || status >= 500;
}

export async function withRetry<T>(request: () => Promise<T>) {
  let lastError: unknown;
  for (let attempt = 0; attempt < retryLimit(); attempt += 1) {
    try {
      return await request();
    } catch (error) {
      lastError = error;
      const delay = delayForAttempt(attempt);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}
`;
for (let i = 0; i < texts.length; i++) texts[i] += sharedSource;
const commits = shas.map((sha, index) => ({ sha, parents: index ? [shas[index - 1]] : [], message: ['Add retry policy', 'Make retry budget configurable', 'Increase retry budget'][index], author: ['alice', 'minji', 'jiyoon'][index], date: `2026-09-${14 + index}T09:30:00Z` })).reverse();
const entry = (name, path, kind, sha = 'a'.repeat(40)) => ({ name, path, kind, sha, size: kind === 'directory' ? null : 100 });
const files = [{ path: 'src/policy.ts', previous_path: 'src/old-policy.ts', status: 'renamed', additions: 1, deletions: 1 }, { path: 'logo.bin', previous_path: null, status: 'modified', additions: 0, deletions: 0 }];
const calls = [];
async function mock(page) {
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url()); const path = url.pathname; const params = url.searchParams; calls.push(url);
    let body = { items: [], next_cursor: null };
    if (path === '/api/repositories') body = { items: [{ repository_id: 1, repository: repo, sequence_spaces: [{ base_branch: 'main' }] }], next_cursor: null };
    else if (path === '/api/search') body = { items: [{ kind: 'pull_request', repository: repo, pr_number: 7, title: 'Improve retry policy', author: 'minji', state: 'merged', merge_seq: 2901, seq_epoch: 3, sequence_space: `${repo}@main`, merged_at: '2026-09-16T09:30:00Z', changed_files_count: 2, additions: 1, deletions: 1, url: `/pr/${repo}/7` }], total: { value: 1, relation: 'eq' } };
    else if (path.startsWith('/api/pull-requests/')) body = { body: 'Improve retry policy.', changed_paths: ['src/policy.ts'], merge_commit_sha: shas[2], source_commits: [] };
    else if (path.endsWith('/tree')) body = { repository: repo, ref: 'main', revision: shas[2], path: params.get('path') || '', truncated: false, entries: params.get('tree_sha') ? [entry('policy.ts', 'src/policy.ts', 'file')] : [entry('src', 'src', 'directory'), entry('README.md', 'README.md', 'file')] };
    else if (path.endsWith('/history')) body = { repository: repo, revision: shas[2], path: params.get('path') || '', commits, next_page: null };
    else if (path.endsWith('/diff')) { const head = params.get('commit') || shas[2]; const index = shas.indexOf(head); body = { repository: repo, head, base: index > 0 ? shas[index - 1] : null, commit: commits.find(item => item.sha === head), files, next_page: null, truncated: false, pull_requests: [{ number: 7, title: 'Improve retry policy', body: 'Separate retry policy from transport. Add deterministic tests.' }] }; }
    else if (path.endsWith('/file')) { const binary = params.get('path') === 'logo.bin'; body = { repository: repo, revision: params.get('revision'), path: params.get('path'), status: binary ? 'binary' : 'text', text: binary ? null : texts[shas.indexOf(params.get('revision'))] ?? texts[2], size: 100, sha: 'b'.repeat(40), reason: binary ? 'Binary files cannot be displayed as text.' : null }; }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
}
(async () => {
  mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PR_SEARCH_CHROME || '/home/roqkf/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome' });
  try {
    const page = await browser.newPage({ viewport: { width: 1536, height: 1050 }, locale: 'en-US', colorScheme: 'light' }); const errors = [];
    page.on('pageerror', error => errors.push(error.message)); await mock(page);
    await page.goto(`${origin}/search`); await page.waitForLoadState('networkidle');
    await page.addStyleTag({ content: 'nextjs-portal{display:none!important}' });
    assert.equal(await page.getByLabel('Merged after').getAttribute('placeholder'), 'YYYY-MM-DD');
    assert.equal(await page.getByLabel('Merged before').getAttribute('placeholder'), 'YYYY-MM-DD');
    const folder = page.getByRole('treeitem', { name: 'src', exact: true }); await folder.waitFor();
    await folder.locator(':scope > .source-tree-node').click();
    const file = page.getByRole('treeitem', { name: 'policy.ts', exact: true }); await file.waitFor(); await file.locator(':scope > .source-tree-node').click();
    await page.waitForURL('**path=src%2Fpolicy.ts*'); await page.getByText('Increase retry budget', { exact: true }).waitFor();
    assert.ok(calls.some(url => url.pathname.endsWith('/history') && url.searchParams.get('path') === 'src/policy.ts' && url.searchParams.get('ref') === shas[2]));
    await accessibility(page, 'Tree and history');
    await page.screenshot({ path: `${output}/tree-history-light.png`, fullPage: true, animations: 'disabled' });
    await page.getByRole('checkbox', { name: 'Select 3333333 for comparison' }).check(); await page.getByRole('checkbox', { name: 'Select 2222222 for comparison' }).check();
    await page.getByRole('button', { name: /Compare selected/ }).click();
    await page.locator('.source-diff-table').waitFor();
    await page.getByRole('checkbox', { name: 'Show all lines', exact: true }).check();
    assert.ok((await page.locator('.source-diff-table code').allTextContents()).some(text => text.includes('return 2;')));
    assert.ok((await page.locator('.source-diff-table code').allTextContents()).some(text => text.includes('return 3;')));
    await accessibility(page, 'Light diff');
    await page.screenshot({ path: `${output}/diff-light.png`, fullPage: true, animations: 'disabled' });
    await page.getByRole('button', { name: 'Unified', exact: true }).click(); assert.equal(await page.locator('.source-diff-table--unified').count(), 1);
    await page.getByRole('textbox', { name: 'Find in diff' }).fill('return'); assert.ok(await page.locator('.source-diff-table mark').count() > 0);
    await page.getByRole('button', { name: 'Full screen', exact: true }).click(); assert.equal(await page.locator('.source-modal--full').count(), 1);
    await page.getByRole('button', { name: 'Close source analysis', exact: true }).click();
    await page.getByRole('button', { name: 'Dark mode' }).click();
    await page.getByRole('button', { name: 'View diff for 3333333', exact: true }).click(); await page.locator('.source-diff-table').waitFor();
    await page.getByRole('checkbox', { name: 'Show all lines', exact: true }).check();
    assert.ok(calls.some(url => url.pathname.endsWith('/file') && url.searchParams.get('path') === 'src/old-policy.ts'));
    await page.screenshot({ path: `${output}/diff-dark.png`, fullPage: true, animations: 'disabled' });
    await page.getByRole('button', { name: 'Time-lapse', exact: true }).click();
    await page.locator('.source-file-code').waitFor(); assert.equal(await page.locator('[role="dialog"]').count(), 2);
    await page.keyboard.press('Escape'); await page.waitForFunction(() => document.querySelectorAll('[role="dialog"]').length === 1);
    await page.locator('.source-changed-files button').filter({ hasText: 'logo.bin' }).click(); await page.getByText('Binary files cannot be displayed as text.', { exact: true }).waitFor();
    await page.keyboard.press('Escape'); await page.getByRole('button', { name: 'Time-lapse', exact: true }).click();
    const slider = page.getByRole('slider', { name: 'File revision' }); await slider.waitFor();
    await page.waitForFunction(() => document.querySelector('.source-file-code')?.textContent.includes('return 3;'));
    await slider.focus(); await slider.press('Home'); await page.waitForFunction(() => document.querySelector('.source-file-code')?.textContent.includes('return 1;'));
    await slider.press('End'); await page.waitForFunction(() => document.querySelector('.source-file-code')?.textContent.includes('return 3;'));
    await page.getByRole('button', { name: 'Analyze line history', exact: true }).click(); await page.getByText(/3 revisions analyzed/).waitFor();
    await page.getByRole('button', { name: 'Inspect line 3', exact: true }).click(); await page.getByText('3 observed versions of this line', { exact: true }).waitFor();
    assert.ok(await page.locator('.source-heat-2').count() > 0);
    await page.getByRole('button', { name: 'Related PRs', exact: true }).click(); await page.getByText('Separate retry policy from transport. Add deterministic tests.', { exact: true }).waitFor();
    await accessibility(page, 'Dark time-lapse');
    await page.screenshot({ path: `${output}/timelapse-dark.png`, fullPage: true, animations: 'disabled' });
    await page.locator('.source-line-history button').filter({ hasText: shas[0].slice(0, 9) }).click(); await page.waitForFunction(() => document.querySelector('.source-file-code')?.textContent.includes('return 1;'));
    assert.ok(await page.getByRole('button', { name: 'Inspect line 2', exact: true }).getAttribute('aria-pressed') === 'true');
    await page.keyboard.press('Escape');
    await page.getByRole('tab', { name: 'Search', exact: true }).click(); await page.locator('.repo-expand').first().focus(); await page.keyboard.press('Control+d'); await page.getByRole('heading', { name: 'Pull request #7', exact: true }).waitFor();
    await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 390, height: 844 }); await page.getByRole('tab', { name: 'Commit history', exact: true }).click(); await page.getByRole('button', { name: 'Time-lapse', exact: true }).click(); await page.locator('.source-file-code').waitFor();
    const mobileBounds = await page.locator('.source-modal').boundingBox();
    assert.ok(mobileBounds && Math.abs(mobileBounds.y) < 2 && mobileBounds.width <= 390 && mobileBounds.height <= 845, 'Mobile analysis must fit the viewport');
    await page.screenshot({ path: `${output}/timelapse-mobile.png`, fullPage: false, animations: 'disabled' });
    assert.deepEqual(errors, []);
    console.log(`PASS: real tree expansion → scoped history → two-revision/commit/PR diffs → slider/line lineage/PR context; binary, rename, keyboard and mobile. Captures: ${output}`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
