/** WP-042 / FLOW-004. 상태를 보존하는 API 대역과 실제 브라우저; 저장소는 integration/bisect.test.ts에서 검증한다. */
import { expect, test } from '@playwright/test';

const point = (seq: number) => ({ merge_seq: seq, commit_sha: 'a'.repeat(40), pull_request_number: 4200 + seq });
const initial = { session_id: '42', seq_epoch: 1, good_seq: 1, bad_seq: 9, epoch_stale: false, remaining: 4, estimated_steps: 2, next: point(5), result: null as ReturnType<typeof point> | null, converged: false };
test('FLOW-004 start → good → revisit → bad → converged → reset', async ({ context, page }) => {
  let session: typeof initial | null = null;
  await context.route('**/api/**', async (route) => {
    const url = route.request().url(); const method = route.request().method(); let body: unknown = {};
    if (url.includes('/bisect-sessions')) {
      if (method === 'DELETE') session = null;
      if (method === 'POST') {
        const data = route.request().postDataJSON() as { action: string; verdict?: string; merge_seq?: number };
        if (data.action === 'start') session = { ...initial };
        else if (data.verdict === 'good') { expect(data.merge_seq).toBe(5); session = { ...initial, good_seq: 5, remaining: 2, estimated_steps: 1, next: point(8) }; }
        else { expect(data.merge_seq).toBe(8); session = { ...initial, good_seq: 5, bad_seq: 8, remaining: 1, estimated_steps: 0, next: null as never, result: point(8), converged: true }; }
      }
      body = { seq_epoch: 1, session };
    } else if (url.includes('/sequence-spaces')) body = { spaces: [{ repository: 'acme/payments', base_branch: 'main', sequence_space: 'acme/payments@main', seq_epoch: 1, sequence_state: 'ok' }] };
    else if (url.includes('/sequence-anchors/resolve')) {
      const data = route.request().postDataJSON() as { anchors: { position: string; expression: string }[] };
      body = { seq_epoch: 1, resolved: data.anchors.map((a) => ({ ...a, kind: 'sequence', merge_seq: Number(a.expression.replace('seq:', '')), commit_sha: 'a'.repeat(40), boundary: a.position === 'from' ? 'exclusive' : 'inclusive', occurred_at: new Date().toISOString() })) };
    } else if (url.includes('/sequence-ranges')) body = { seq_epoch: 1, sequence_state: 'ok', epoch_stale: false, items: [], items_missing_in_index: 0, next_cursor: null };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.goto('/ranges?repo=acme%2Fpayments&branch=main&from=seq%3A1&to=seq%3A9&epoch=1');
  await expect(page.getByTestId('anchor-to-resolved')).toBeVisible();
  await page.getByTestId('range-query').click();
  await page.getByRole('button', { name: '이 구간에서 탐색 시작' }).click();
  await expect(page.getByTestId('bisect-next')).toContainText('seq:5');
  await page.getByRole('button', { name: '정상', exact: true }).click();
  await expect(page.getByTestId('bisect-remaining')).toHaveText('남은 후보 2건 · 예상 잔여 검사 1회');
  await page.close();
  const reopened = await context.newPage();
  await reopened.goto('/ranges?repo=acme%2Fpayments&branch=main');
  await expect(reopened.getByTestId('bisect-next')).toContainText('seq:8');
  await reopened.getByRole('button', { name: '이상', exact: true }).click();
  await expect(reopened.getByTestId('bisect-result')).toContainText('PR #4208');
  await expect(reopened.getByRole('button', { name: '정상', exact: true })).toHaveCount(0);
  await reopened.getByRole('button', { name: '탐색 초기화' }).click();
  await expect(reopened.getByTestId('bisect-result')).toHaveCount(0);
});

for (const failure of ['contradiction', 'epoch'] as const) {
  test(`FLOW-004 ${failure}: invalidation and explicit reset`, async ({ page }) => {
    let reset = false;
    await page.route('**/api/**', async (route) => {
      const url = route.request().url(); const method = route.request().method(); let body: unknown = {}; let status = 200;
      if (url.includes('/bisect-sessions')) {
        if (method === 'DELETE') { reset = true; body = { session: null }; }
        else if (method === 'POST') { status = 409; body = { error: { code: 'BISECT_CONTRADICTION', message: '정상·이상 표시가 모순됩니다. 탐색을 초기화하세요.', detail: { good_seq: 10, bad_seq: 9 } } }; }
        else body = { session: failure === 'epoch' ? { ...initial, epoch_stale: true, next: null, remaining: null, estimated_steps: null } : initial };
      }
      await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    });
    await page.goto('/ranges?repo=acme%2Fpayments&branch=main');
    if (failure === 'contradiction') {
      await page.getByRole('button', { name: '정상', exact: true }).click();
      await expect(page.getByTestId('bisect-panel').getByRole('alert')).toContainText('정상 10, 이상 9');
      await expect(page.getByRole('button', { name: '정상', exact: true })).toBeDisabled();
    } else await expect(page.getByText('탐색 에폭이 낡았습니다')).toBeVisible();
    await page.getByRole('button', { name: '탐색 초기화' }).click();
    expect(reset).toBe(true);
  });
}
