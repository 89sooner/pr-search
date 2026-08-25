import { expect, test, type Page } from '@playwright/test';

/**
 * FLOW-003 1~3단계 / W-005 (WP-026 DoD).
 *
 * 실제 브라우저에서 거는 것: 셸의 "릴리스" 항목이 **실제로 화면에 닿는가**
 * (CR-030 DEV-157 — 문서가 적던 `/releases/[owner]/[repo]`로 두면 404였다),
 * 그리고 릴리스 2건 선택이 W-004로 **앵커를 싣고 이동하는가**다. 그 이동이
 * 이어져야 SCN-002가 화면으로 완결된다.
 */

const SPACES = {
  spaces: [
    { repository: 'acme/payments', base_branch: 'main', sequence_space: 'acme/payments@main', seq_epoch: 3, sequence_state: 'ok' },
    { repository: 'acme/payments', base_branch: 'release/2.4', sequence_space: 'acme/payments@release/2.4', seq_epoch: 1, sequence_state: 'ok' },
  ],
};

const RELEASES = {
  repository: 'acme/payments',
  releases: [
    { tag_name: 'v1.2', commit_sha: 'a'.repeat(40), released_at: '2026-08-15T09:00:00Z', source: 'git_tag', base_branch: 'main', sequence_space: 'acme/payments@main', seq_epoch: 3, merge_seq: 6, previous_tag_name: 'v1.0', pull_request_count_since_previous: 3 },
    { tag_name: 'r2.4.0', commit_sha: 'c'.repeat(40), released_at: '2026-08-12T09:00:00Z', source: 'git_tag', base_branch: 'release/2.4', sequence_space: 'acme/payments@release/2.4', seq_epoch: 1, merge_seq: 2, previous_tag_name: null, pull_request_count_since_previous: null },
    { tag_name: 'v1.0', commit_sha: 'd'.repeat(40), released_at: '2026-08-10T09:00:00Z', source: 'git_tag', base_branch: 'main', sequence_space: 'acme/payments@main', seq_epoch: 3, merge_seq: 2, previous_tag_name: null, pull_request_count_since_previous: null },
  ],
  reason: null,
  truncated: false,
  correlation_id: 'l',
};

const COMPARISON = {
  sequence_space: 'acme/payments@main',
  seq_epoch: 3,
  sequence_state: 'ok',
  epoch_stale: false,
  normalized_direction: 'from=v1.2(seq 6) → to=main head(seq 8)',
  unreleased: true,
  range: { from_seq: 6, to_seq: 8, boundary: '(from, to]' },
  summary: {
    pull_request_count: 2,
    commit_count: 2,
    distinct_author_count: 1,
    changed_files_total: 4,
    additions_total: 40,
    deletions_total: 2,
    files_truncated_pull_request_count: 0,
    top_changed_paths: [],
  },
  items: [],
  items_missing_in_index: 0,
  next_cursor: null,
  correlation_id: 'c',
};

/**
 * 앵커 대역 — **표현을 실제로 판정한다**.
 *
 * 무엇을 주든 해석해 주는 대역은 링크가 만든 표현이 틀려도 초록을 낸다. 실제로
 * 그 구멍으로 "맨 숫자 앵커" 결함이 CI를 통과했다 — `classifyAnchor`는 맨 숫자를
 * **의도적으로 `ambiguous`로 판정**하는데(PR 번호와 서수를 고르지 않는다) 대역은
 * 그것을 몰랐다. 그래서 여기서는 서버와 같은 갈래를 흉내 낸다.
 */
function resolveAnchorExpression(
  position: string,
  expression: string,
): { status: number; body: unknown } {
  const bare = /^\d+$/.test(expression);
  if (bare) {
    return {
      status: 400,
      body: {
        error: {
          code: 'ANCHOR_UNRESOLVABLE',
          message: `무엇을 뜻하는지 정할 수 없습니다: ${expression}`,
          detail: { candidates: [`#${expression} (PR 번호)`, `seq:${expression} (시퀀스 값)`] },
        },
        correlation_id: 'c',
      },
    };
  }

  const seqMatch = /^seq:(\d+)$/.exec(expression);
  const seq = seqMatch !== null ? Number(seqMatch[1]) : expression === 'v1.0' ? 2 : 6;
  if (seqMatch !== null && seq < 1) {
    return {
      status: 400,
      body: {
        error: { code: 'ANCHOR_UNRESOLVABLE', message: '시퀀스 값이 범위를 벗어난다', detail: {} },
        correlation_id: 'c',
      },
    };
  }

  return {
    status: 200,
    body: {
      sequence_space: 'acme/payments@main',
      seq_epoch: 3,
      resolved: [
        {
          position,
          expression,
          kind: seqMatch === null ? 'release' : 'sequence',
          merge_seq: seq,
          commit_sha: `${String(seq).padStart(2, '0')}${'a'.repeat(38)}`,
          boundary: position === 'from' ? 'exclusive' : 'inclusive',
          occurred_at: '2026-08-12T00:00:00Z',
        },
      ],
      correlation_id: 'c',
    },
  };
}

const RANGE = {
  sequence_space: 'acme/payments@main',
  seq_epoch: 3,
  sequence_state: 'ok',
  epoch_stale: false,
  range: { from_seq: 2, to_seq: 6, boundary: '(from, to]' },
  summary: {
    pull_request_count: 3,
    commit_count: 4,
    distinct_author_count: 2,
    changed_files_total: 8,
    additions_total: 90,
    deletions_total: 4,
    files_truncated_pull_request_count: 0,
    top_changed_paths: [],
  },
  items: [
    { merge_seq: 3, kind: 'pull_request', pr_number: 1234, commit_sha: 'a'.repeat(40), title: 'feat: 결제 재시도', author: 'kim', merged_at: '2026-08-12T00:00:00Z', changed_files_count: 3, additions: 40, deletions: 2, indexed: true },
  ],
  items_missing_in_index: 0,
  next_cursor: null,
  correlation_id: 'r',
};

async function stubApi(page: Page): Promise<string[]> {
  const calls: string[] = [];
  await page.route('**/api/**', async (route) => {
    const url = route.request().url();
    calls.push(url);
    let status = 200;
    let body: unknown = {};
    if (url.includes('/api/sequence-spaces')) body = SPACES;
    else if (url.includes('/api/releases')) body = RELEASES;
    else if (url.includes('/api/release-comparisons')) body = COMPARISON;
    else if (url.includes('/api/sequence-anchors/resolve')) {
      const payload = route.request().postDataJSON() as {
        anchors?: { position: string; expression: string }[];
      };
      const anchor = payload.anchors?.[0];
      const outcome =
        anchor === undefined
          ? { status: 400, body: {} }
          : resolveAnchorExpression(anchor.position, anchor.expression);
      status = outcome.status;
      body = outcome.body;
    } else if (url.includes('/api/sequence-ranges')) body = RANGE;
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  });
  return calls;
}

test.describe('W-005: 릴리스 목록에서 구간 조사로', () => {
  test('**좌측 내비게이션 "릴리스"가 실제 화면에 닿는다** (CR-030, DEV-157)', async ({ page }) => {
    await stubApi(page);
    await page.goto('/search');
    await page.getByRole('link', { name: '릴리스' }).click();
    await expect(page).toHaveURL(/\/releases/);
    // 셸이 소유한 경로에 화면이 섰다 — 이 항목은 이 WP 전까지 404였다.
    await expect(page.getByTestId('releases-view')).toBeVisible();
  });

  test('**릴리스 2건 선택이 W-004로 앵커를 싣고 이동한다** (FLOW-003 1~3단계)', async ({ page }) => {
    await stubApi(page);
    await page.goto('/releases?repo=acme%2Fpayments&branch=main');

    await expect(page.getByTestId('release-timeline')).toBeVisible();
    // 저장소 스코프라 다른 브랜치의 릴리스도 함께 있다 (DEV-158).
    await expect(page.getByTestId('release-row')).toHaveCount(3);

    // 최신을 먼저 누른다 — 목록이 시각 내림차순이라 그것이 자연스럽다.
    await page.getByRole('checkbox', { name: 'v1.2 비교 대상으로 선택' }).click();
    await page.getByRole('checkbox', { name: 'v1.0 비교 대상으로 선택' }).click();

    // 서수가 작은 쪽이 시작이다 (AC-4) — 누른 순서와 무관하다.
    await expect(page.getByTestId('compare-direction')).toContainText('v1.0');
    await page.getByTestId('compare-link').click();

    await expect(page).toHaveURL(/\/ranges\?/);
    await expect(page).toHaveURL(/from=v1.0&to=v1.2/);
    await expect(page).toHaveURL(/epoch=3/);
    // W-004가 그 앵커를 받아 정규화까지 마친다.
    await expect(page.getByTestId('anchor-to-resolved')).toBeVisible();
  });

  test('다른 대상 브랜치 2건은 이동 전에 막힌다 (QA-W005-03, AC-3)', async ({ page }) => {
    await stubApi(page);
    await page.goto('/releases?repo=acme%2Fpayments&branch=main');
    await expect(page.getByTestId('release-timeline')).toBeVisible();

    await page.getByRole('checkbox', { name: 'v1.2 비교 대상으로 선택' }).click();
    await page.getByRole('checkbox', { name: 'r2.4.0 비교 대상으로 선택' }).click();

    await expect(page.getByTestId('compare-link')).toHaveCount(0);
    await expect(page.getByText('대상 브랜치가 다른 릴리스는 비교할 수 없습니다')).toBeVisible();
  });

  test('미배포 구간이 서수 앵커로 W-004에 닿는다 (QA-W005-04, AC-5)', async ({ page }) => {
    await stubApi(page);
    await page.goto('/releases?repo=acme%2Fpayments&branch=main');

    await expect(page.getByTestId('unreleased-summary')).toContainText('2건');
    await page.getByTestId('unreleased-link').click();
    await expect(page).toHaveURL(/from=seq%3A6&to=seq%3A8/);

    /*
     * **도착만으로는 부족하다.** 링크가 만든 표현을 W-004가 실제로 해석해야
     * 조회가 열린다 — 맨 숫자로 넘기면 여기서 두 앵커가 모두 실패하고 사용자는
     * 조회 버튼이 잠긴 화면을 만난다.
     */
    await expect(page.getByTestId('anchor-from-resolved')).toBeVisible();
    await expect(page.getByTestId('anchor-to-resolved')).toBeVisible();
  });
});
