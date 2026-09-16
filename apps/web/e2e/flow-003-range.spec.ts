import { expect, test, type Page } from '@playwright/test';

/**
 * FLOW-003 릴리스 구간 조사 / W-004 (WP-025 DoD).
 *
 * 실제 브라우저에서 거는 것: 딥링크 → 앵커 자동 정규화 → 조회 → 결과 행 →
 * W-002 이동 → **뒤로가기가 조사 상태(URL)로 복귀**하는 경로 전체다
 * (FLOW-003 5·6단계). 에폭 불일치의 "자동 재조회 없음"(QA-W004-21)도 실제
 * 네트워크 계층에서 센다.
 */

const SPACES = {
  spaces: [
    {
      repository: 'acme/payments',
      base_branch: 'main',
      sequence_space: 'acme/payments@main',
      seq_epoch: 3,
      sequence_state: 'ok',
    },
  ],
};

function resolvedBody(position: string, expression: string): unknown {
  const seq = Number(/^seq:(\d+)$/.exec(expression)?.[1] ?? '1');
  return {
    sequence_space: 'acme/payments@main',
    seq_epoch: 3,
    resolved: [
      {
        position,
        expression,
        kind: 'sequence',
        merge_seq: seq,
        commit_sha: `${String(seq).padStart(2, '0')}${'a'.repeat(38)}`,
        boundary: position === 'from' ? 'exclusive' : 'inclusive',
        occurred_at: '2026-08-12T00:00:00Z',
      },
    ],
    correlation_id: 'c',
  };
}

const RANGE = {
  sequence_space: 'acme/payments@main',
  seq_epoch: 3,
  sequence_state: 'ok',
  epoch_stale: false,
  range: { from_seq: 2, to_seq: 5, boundary: '(from, to]' },
  summary: {
    pull_request_count: 2,
    commit_count: 3,
    distinct_author_count: 2,
    changed_files_total: 5,
    additions_total: 70,
    deletions_total: 3,
    files_truncated_pull_request_count: 0,
    top_changed_paths: [],
  },
  items: [
    {
      merge_seq: 3,
      kind: 'pull_request',
      pr_number: 1234,
      commit_sha: 'a'.repeat(40),
      title: 'feat: 결제 재시도',
      author: 'kim',
      merged_at: '2026-08-12T00:00:00Z',
      changed_files_count: 3,
      additions: 40,
      deletions: 2,
      indexed: true,
    },
  ],
  items_missing_in_index: 0,
  next_cursor: null,
  correlation_id: 'r',
};

const PR = {
  repository: 'acme/payments',
  pr_number: 1234,
  title: 'feat: 결제 재시도',
  state: 'merged',
  author: 'kim',
  base_branch: 'main',
  head_branch: 'feat/retry',
  created_at: '2026-08-11T09:00:00Z',
  merged_at: '2026-08-12T00:00:00Z',
  merge_commit_sha: 'a'.repeat(40),
  source_commits: [],
  source_commits_truncated: false,
  source_commits_total: 0,
  merge_seq: 3,
  seq_epoch: 3,
  sequence_space: 'acme/payments@main',
};

async function stubApi(page: Page): Promise<string[]> {
  const calls: string[] = [];
  await page.route('**/api/**', async (route) => {
    const url = route.request().url();
    calls.push(url);
    let body: unknown = {};
    if (url.includes('/api/sequence-spaces')) body = SPACES;
    else if (url.includes('/api/sequence-anchors/resolve')) {
      const payload = route.request().postDataJSON() as {
        anchors?: { position: string; expression: string }[];
      };
      const anchor = payload.anchors?.[0];
      body = anchor === undefined ? {} : resolvedBody(anchor.position, anchor.expression);
    } else if (url.includes('/api/sequence-ranges')) body = RANGE;
    else if (url.includes('/api/pull-requests/')) body = PR;
    else if (url.includes('/api/containments')) {
      body = { merge_seq: 3, releases: [], unreleased: true, pending_pull_request_count: 0, correlation_id: 'x' };
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  return calls;
}

test.describe('FLOW-003: 딥링크 → 조회 → 상세 → 복귀', () => {
  test('**딥링크의 앵커가 자동 정규화되고, 조회가 결과와 URL 인용을 만든다**', async ({ page }) => {
    await stubApi(page);
    await page.goto('/ranges?repo=acme%2Fpayments&branch=main&from=seq%3A2&to=seq%3A5');

    // 반개구간 규칙 상시 표기 (QA-W004-01).
    await expect(page.getByTestId('range-boundary-rule')).toBeVisible();
    await expect(page.getByTestId('anchor-from-boundary')).toHaveText("Excluded");

    // 딥링크의 앵커는 자동 정규화된다 — 링크가 곧 의사 표시다.
    await expect(page.getByTestId('anchor-from-resolved')).toBeVisible();
    await expect(page.getByTestId('anchor-to-resolved')).toBeVisible();

    await page.getByTestId('range-query').click();
    await expect(page.getByTestId('range-results')).toBeVisible();
    await expect(page.getByTestId('summary-reverts-pending')).toContainText("Not yet available");

    // 성공한 조회는 URL을 현재 에폭 인용으로 만든다 (ADR-007).
    await expect(page).toHaveURL(/epoch=3/);
  });

  test('**결과 행 → W-002 → 뒤로가기가 조사 URL로 복귀한다** (FLOW-003 5·6단계)', async ({ page }) => {
    await stubApi(page);
    await page.goto('/ranges?repo=acme%2Fpayments&branch=main&from=seq%3A2&to=seq%3A5');
    await expect(page.getByTestId('anchor-to-resolved')).toBeVisible();
    await page.getByTestId('range-query').click();
    await expect(page.getByTestId('range-results')).toBeVisible();

    await page.getByTestId('range-row-link').first().click();
    await expect(page.getByTestId('pr-detail')).toHaveAttribute('data-screen-state', 'ready');

    await page.goBack();
    // 조사 상태가 URL에 있으므로 뒤로가기가 같은 구간으로 돌아온다.
    await expect(page).toHaveURL(/\/ranges\?/);
    await expect(page).toHaveURL(/from=seq%3A2/);
  });

  test('**URL 에폭이 낡으면 경고만 내고 범위 조회를 자동으로 보내지 않는다** (QA-W004-21)', async ({ page }) => {
    const calls = await stubApi(page);
    await page.goto('/ranges?repo=acme%2Fpayments&branch=main&epoch=2');

    await expect(page.getByTestId('epoch-stale-banner')).toBeVisible();
    expect(calls.filter((url) => url.includes('/api/sequence-ranges'))).toHaveLength(0);
  });

  test('좌측 내비게이션 "범위 조사"가 이 화면으로 온다', async ({ page }) => {
    await stubApi(page);
    await page.goto('/search');
    await page.getByRole('link', { name: "Range investigation" }).click();
    await expect(page).toHaveURL(/\/ranges/);
    await expect(page.getByTestId('range-empty')).toBeVisible();
  });
});
