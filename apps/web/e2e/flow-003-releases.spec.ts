import { expect, test, type Page } from '@playwright/test';

/**
 * FLOW-003 릴리스 구간 조사 / W-005 (WP-026 DoD).
 *
 * 실제 브라우저에서 거는 것: 릴리스 타임라인 → 2건 선택(순서 뒤집힘) →
 * **구간 비교가 정규화된 태그 앵커·에폭 인용으로 W-004에 도착**하고 앵커가
 * 자동 정규화되는 경로(FLOW-003 1~3단계), 그리고 미배포 구간 진입
 * (QA-W005-04)이다.
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

const TIMELINE = {
  sequence_space: 'acme/payments@main',
  seq_epoch: 3,
  sequence_state: 'ok',
  releases: [
    { tag_name: 'v1.1', released_at: '2026-08-15T09:00:00Z', commit_sha: 'c'.repeat(40), merge_seq: 5, source: 'git_tag', previous_tag_name: 'v1.0', pull_request_count: 2 },
    { tag_name: 'v1.0', released_at: '2026-08-14T09:00:00Z', commit_sha: 'b'.repeat(40), merge_seq: 2, source: 'git_tag', previous_tag_name: null, pull_request_count: 1 },
  ],
  unreleased: { last_release_tag: 'v1.1', head_seq: 6, head_commit_sha: 'd'.repeat(40), pending_pull_request_count: 4 },
  correlation_id: 't',
};

const COMPARISON = {
  sequence_space: 'acme/payments@main',
  seq_epoch: 3,
  sequence_state: 'ok',
  normalized_direction: 'from=v1.0(seq 2) → to=v1.1(seq 5)',
  from_release: { tag_name: 'v1.0', merge_seq: 2 },
  to_release: { tag_name: 'v1.1', merge_seq: 5 },
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
  items: [],
  items_missing_in_index: 0,
  next_cursor: null,
  correlation_id: 'c',
};

/** W-004 도착 뒤의 앵커 정규화 — 태그 표현이 릴리스 앵커로 해석된다. */
const TAG_SEQ: Record<string, number> = { 'v1.0': 2, 'v1.1': 5 };

function resolvedBody(position: string, expression: string): unknown {
  const seqExpr = /^seq:(\d+)$/.exec(expression)?.[1];
  const seq = seqExpr === undefined ? (TAG_SEQ[expression] ?? 1) : Number(seqExpr);
  return {
    sequence_space: 'acme/payments@main',
    seq_epoch: 3,
    resolved: [
      {
        position,
        expression,
        kind: seqExpr === undefined ? 'release' : 'sequence',
        merge_seq: seq,
        commit_sha: `${String(seq).padStart(2, '0')}${'a'.repeat(38)}`,
        boundary: position === 'from' ? 'exclusive' : 'inclusive',
        occurred_at: '2026-08-12T00:00:00Z',
      },
    ],
    correlation_id: 'c',
  };
}

async function stubApi(page: Page): Promise<string[]> {
  const calls: string[] = [];
  await page.route('**/api/**', async (route) => {
    const url = route.request().url();
    calls.push(url);
    let body: unknown = {};
    if (url.includes('/api/sequence-spaces')) body = SPACES;
    else if (url.includes('/api/release-comparisons')) body = COMPARISON;
    else if (url.includes('/api/releases')) body = TIMELINE;
    else if (url.includes('/api/sequence-anchors/resolve')) {
      const payload = route.request().postDataJSON() as {
        anchors?: { position: string; expression: string }[];
      };
      const anchor = payload.anchors?.[0];
      body = anchor === undefined ? {} : resolvedBody(anchor.position, anchor.expression);
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  return calls;
}

test.describe('FLOW-003: W-005 릴리스 목록 → 구간 비교 → W-004', () => {
  test('**역순으로 2건을 선택해도 정규화된 태그 앵커·에폭 인용으로 W-004에 도착한다** (QA-W005-01·02)', async ({ page }) => {
    await stubApi(page);
    await page.goto('/releases/acme/payments?branch=main');
    await expect(page.getByTestId('release-timeline')).toBeVisible();

    // 큰 서수(v1.1)를 먼저 체크한다 — 순서에 의도가 없다.
    await page.getByLabel('비교 대상: v1.1').click();
    await page.getByLabel('비교 대상: v1.0').click();
    await expect(page.getByTestId('release-compare-direction')).toHaveText(
      'from=v1.0(seq 2) → to=v1.1(seq 5)',
    );

    await page.getByTestId('release-compare-go').click();
    await expect(page).toHaveURL(/\/ranges\?repo=acme%2Fpayments&branch=main&from=v1\.0&to=v1\.1&epoch=3/);
    // W-004가 태그 앵커를 자동 정규화한다 (FLOW-003 3단계).
    await expect(page.getByTestId('anchor-from-resolved')).toBeVisible();
    await expect(page.getByTestId('anchor-to-resolved')).toBeVisible();
  });

  test('릴리스 상세가 직전 릴리스 대비 요약을 세우고, 되돌림 자리는 준비 중이다 (DEV-156)', async ({ page }) => {
    await stubApi(page);
    await page.goto('/releases/acme/payments?branch=main');
    await expect(page.getByTestId('release-timeline')).toBeVisible();

    await page.getByTestId('release-detail-v1.1').click();
    await expect(page.getByTestId('release-detail-ready-v1.1')).toBeVisible();
    await expect(page.getByTestId('summary-reverts-pending')).toContainText('준비 중');
  });

  test('**미배포 구간 진입이 head 서수를 끝 앵커로 W-004에 도착한다** (QA-W005-04)', async ({ page }) => {
    await stubApi(page);
    await page.goto('/releases/acme/payments?branch=main');
    await expect(page.getByTestId('release-unreleased')).toBeVisible();
    await expect(page.getByTestId('release-pending-count')).toHaveText('4');

    await page.getByTestId('release-unreleased-go').click();
    await expect(page).toHaveURL(/\/ranges\?repo=acme%2Fpayments&branch=main&from=v1\.1&to=seq%3A6&epoch=3/);
    await expect(page.getByTestId('anchor-to-resolved')).toBeVisible();
  });

  test('좌측 내비게이션 "릴리스"가 공간 선택 화면으로 온다', async ({ page }) => {
    await stubApi(page);
    await page.goto('/search');
    await page.getByRole('link', { name: '릴리스' }).click();
    await expect(page).toHaveURL(/\/releases$/);
    await expect(page.getByTestId('releases-picker')).toBeVisible();
  });
});
