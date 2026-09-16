import { expect, test, type Page } from '@playwright/test';

/** WP-044 / QA-W001-20·21. Browser confirmation and real download event. */
async function search(page: Page): Promise<void> {
  await page.route('**/api/search*', (route) => route.fulfill({ json: { total: { value: 1001, relation: 'eq' }, items: [{ kind: 'pull_request', repository: 'wp044/visible', pr_number: 1, title: 'Export', author: 'user', state: 'merged', merge_seq: 1, seq_epoch: 1, sequence_space: 'wp044/visible@main', merged_at: null, changed_files_count: 0, additions: 0, deletions: 0, url: null }], next_cursor: null, sort: { field: 'merge_seq', order: 'desc' } } }));
  await page.goto('/search?q=repo%3Awp044%2Fvisible');
  await page.getByRole('button', { name: "Export", exact: true }).click();
}
test('QA-W001-20 confirms exact count before synchronous CSV download', async ({ page }) => {
  let creates = 0;
  await page.route('**/api/exports', async (route) => {
    const data = route.request().postDataJSON() as { preview?: boolean };
    if (data.preview) await route.fulfill({ json: { total: 1000, mode: 'sync' } });
    else { creates++; await route.fulfill({ status: 200, contentType: 'text/csv', headers: { 'content-disposition': 'attachment; filename="pr-search.csv"' }, body: 'title\r\nExport\r\n' }); }
  });
  await search(page);
  await expect(page.getByRole('dialog')).toContainText("1,000");
  expect(creates).toBe(0);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: "Export" }).click();
  expect((await download).suggestedFilename()).toBe('pr-search.csv');
  expect(creates).toBe(1);
});
test('QA-W001-21 async job exposes completed download and failure reason', async ({ page }) => {
  await page.route('**/api/exports', (route) => route.fulfill({ status: route.request().postDataJSON().preview ? 200 : 202, json: route.request().postDataJSON().preview ? { total: 1001, mode: 'async' } : { job_id: 44, state: 'queued' } }));
  await page.route('**/api/exports/44', (route) => route.fulfill({ json: { job_id: 44, state: 'completed', download_url: '/api/v1/exports/44/download' } }));
  await search(page);
  await expect(page.getByRole('dialog')).toContainText("1,001");
  await page.getByRole('button', { name: "Export" }).click();
  await expect(page.getByRole('link', { name: "Download completed file" })).toHaveAttribute('href', '/api/exports/44/download');
  await page.getByRole('button', { name: "Close", exact: true }).last().click();
  await page.route('**/api/exports/44', (route) => route.fulfill({ json: { job_id: 44, state: 'failed', download_url: null, error: 'export_scope_changed' } }));
  await page.getByRole('button', { name: "Export", exact: true }).click();
  await page.getByRole('button', { name: "Export" }).click();
  await expect(page.getByRole('dialog')).toContainText("Your access permissions have changed.");
  await expect(page.getByRole('link', { name: "Download completed file" })).toHaveCount(0);
});
test('closed creation cannot overwrite a reopened dialog', async ({ page }) => {
  let release: (() => void) | undefined;
  let started: (() => void) | undefined;
  const requestStarted = new Promise<void>((resolve) => { started = resolve; });
  const delayed = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/api/exports', async (route) => {
    if (route.request().postDataJSON().preview) { await route.fulfill({ json: { total: 1001, mode: 'async' } }); return; }
    started?.(); await delayed;
    await route.fulfill({ status: 202, json: { job_id: 99, state: 'queued' } }).catch(() => undefined);
  });
  await search(page);
  await page.getByRole('button', { name: "Export" }).click(); await requestStarted;
  await page.getByRole('button', { name: "Close", exact: true }).last().click();
  await page.getByRole('button', { name: "Export", exact: true }).click(); release?.();
  await expect(page.getByRole('button', { name: "Export" })).toBeEnabled();
  await expect(page.getByRole('dialog')).not.toContainText("Job #99");
});
