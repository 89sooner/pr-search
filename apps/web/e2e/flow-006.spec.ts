import { expect, test, type Page } from '@playwright/test';

/**
 * FLOW-006 관계 추적 (WP-031 DoD / CR-042).
 *
 * **실제 브라우저에서만 확인되는 것**만 둔다:
 *   1. 진입 시 관계·동시 변경 요청이 정말 0건인가 — 진짜 네트워크 계층에서 센다
 *   2. 펼칠 때 유형×방향마다 실제 요청이 나가는가
 *   3. 해제·다중 후보·대상 내용 부재가 화면에 실제로 그려지는가
 *   4. 관계가 실패해도 동시 변경과 상세 본체가 살아 있는가
 */

const PR = {
  repository: 'acme/payments',
  pr_number: 1234,
  title: 'feat: 결제 재시도',
  state: 'merged',
  author: 'kim',
  base_branch: 'main',
  head_branch: 'feat/retry',
  labels: ['backend'],
  reviewers: ['lee'],
  approved_by: ['lee'],
  created_at: '2026-08-18T09:00:00Z',
  merged_at: '2026-08-19T05:02:11Z',
  changed_files_count: 2,
  additions: 120,
  deletions: 15,
  merge_commit_sha: 'a'.repeat(40),
  source_commits: [{ commit_sha: 'b'.repeat(40) }],
  source_commits_truncated: false,
  source_commits_total: 1,
  merge_seq: null,
  seq_epoch: null,
  sequence_space: null,
  links_pending: true,
};

function relationItems(linkType: string, direction: string): readonly unknown[] {
  if (linkType === 'reverts' && direction === 'incoming') {
    return [
      {
        link_id: 'rev-1',
        link_type: 'reverts',
        direction,
        confidence: 'heuristic',
        evidence: 'Revert "feat: 결제 재시도"',
        resolved: true,
        ambiguous: true,
        content_available: true,
        endpoint: {
          kind: 'pull_request',
          repository: 'acme/payments',
          pr_number: 1301,
          title: 'Revert "feat: 결제 재시도"',
          author: 'park',
          url: '/pr/acme/payments/1301',
        },
      },
      {
        link_id: 'rev-2',
        link_type: 'reverts',
        direction,
        confidence: 'heuristic',
        evidence: 'Revert "feat: 결제 재시도"',
        resolved: true,
        ambiguous: true,
        content_available: true,
        endpoint: {
          kind: 'pull_request',
          repository: 'acme/payments',
          pr_number: 1302,
          title: 'Revert "feat: 결제 재시도"',
          author: 'choi',
          url: '/pr/acme/payments/1302',
        },
      },
    ];
  }
  if (linkType === 'stacks_on' && direction === 'outgoing') {
    return [
      {
        link_id: 'stack-1',
        link_type: 'stacks_on',
        direction,
        confidence: 'derived',
        evidence: 'base=feat/upper',
        resolved: true,
        detached: true,
        ambiguous: false,
        content_available: true,
        endpoint: {
          kind: 'pull_request',
          repository: 'acme/payments',
          pr_number: 1200,
          title: '상위 PR',
          author: 'lee',
          url: '/pr/acme/payments/1200',
        },
      },
    ];
  }
  if (linkType === 'references' && direction === 'outgoing') {
    return [
      {
        link_id: 'ref-1',
        link_type: 'references',
        direction,
        confidence: 'derived',
        evidence: 'Refs: acme/other#20',
        resolved: true,
        ambiguous: false,
        // 대상 저장소가 접근 범위 밖이다 (THR-034).
        content_available: false,
        endpoint: { kind: 'pull_request', reference_expression: 'acme/other#20' },
      },
    ];
  }
  return [];
}

const CO_CHANGES = {
  available: true,
  anchor: { repository: 'acme/payments', pr_number: 1234, changed_files_count: 2 },
  items: [
    {
      repository: 'acme/payments',
      pr_number: 1180,
      title: 'fix: 결제 백오프',
      author: 'lee',
      merged_at: '2026-07-02T11:20:00Z',
      similarity: 0.4286,
      overlapping_paths: ['src/payment/retry.ts'],
      url: '/pr/acme/payments/1180',
    },
  ],
  correlation_id: 'c',
};

/** 모든 `/api/**`를 가로챈다. 실패 주입은 `failing`으로 고른다. */
async function stubApi(page: Page, failing: 'none' | 'relations' | 'cochanges' = 'none'): Promise<string[]> {
  const calls: string[] = [];
  await page.route('**/api/**', async (route) => {
    const url = route.request().url();
    calls.push(url);

    if (url.includes('/api/relations')) {
      if (failing === 'relations') {
        await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({}) });
        return;
      }
      const params = new URL(url).searchParams;
      const linkType = params.get('link_type') ?? '';
      const direction = params.get('direction') ?? '';
      /*
       * **대역이 서버보다 관대하면 그만큼이 사각지대다.** 서버는 커밋 앵커로
       * `stacks_on`을 물으면 400을 낸다 (CR-042). 대역도 같은 갈래로 판정한다.
       */
      if (linkType === 'stacks_on' && params.get('commit_sha') !== null) {
        await route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({ error: { code: 'INVALID_PARAMETER' }, correlation_id: 'c' }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          anchor: { repository: 'acme/payments', kind: 'pull_request', pr_number: 1234 },
          link_type: linkType,
          direction,
          items: relationItems(linkType, direction),
          truncated: false,
          correlation_id: 'c',
        }),
      });
      return;
    }

    if (url.includes('/api/co-changes')) {
      if (failing === 'cochanges') {
        await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({}) });
        return;
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(CO_CHANGES) });
      return;
    }

    if (url.includes('/api/pull-requests/')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ...PR, correlation_id: 'c' }),
      });
      return;
    }

    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) });
  });
  return calls;
}

test.describe('FLOW-006 지연 조회 (QA-W002-17)', () => {
  test('**진입 시 관계도 동시 변경도 부르지 않는다** — 진짜 네트워크에서 센다', async ({ page }) => {
    const calls = await stubApi(page);
    await page.goto('/pr/acme/payments/1234');
    await expect(page.getByTestId('pr-detail')).toHaveAttribute('data-screen-state', 'ready');

    expect(calls.filter((c) => c.includes('/api/relations'))).toHaveLength(0);
    expect(calls.filter((c) => c.includes('/api/co-changes'))).toHaveLength(0);
  });

  test('관계를 펼치면 유형×방향마다 실제 요청이 나간다', async ({ page }) => {
    const calls = await stubApi(page);
    await page.goto('/pr/acme/payments/1234');
    await page.getByTestId('toggle-links').click();

    await expect(page.getByTestId('relation-group-reverts-incoming')).toBeVisible();
    // PR은 유형 넷 × 방향 둘.
    expect(calls.filter((c) => c.includes('/api/relations'))).toHaveLength(8);
    // 동시 변경은 아직 부르지 않았다 — 독립한 섹션이다.
    expect(calls.filter((c) => c.includes('/api/co-changes'))).toHaveLength(0);
  });

  test('동시 변경을 펼치면 그때 한 번 부른다', async ({ page }) => {
    const calls = await stubApi(page);
    await page.goto('/pr/acme/payments/1234');
    await page.getByTestId('toggle-cochanges').click();

    await expect(page.getByTestId('cochange-row')).toBeVisible();
    expect(calls.filter((c) => c.includes('/api/co-changes'))).toHaveLength(1);
    expect(calls.filter((c) => c.includes('/api/relations'))).toHaveLength(0);
  });
});

test.describe('FLOW-006 표시 규칙', () => {
  test('**해제된 스택이 보이고 "해제됨"으로 표시된다** (FR-REL-006 AC-3)', async ({ page }) => {
    await stubApi(page);
    await page.goto('/pr/acme/payments/1234');
    await page.getByTestId('toggle-links').click();

    const detached = page.getByTestId('relation-detached');
    await expect(detached).toBeVisible();
    await expect(detached).toHaveText("Dismissed");
    // 숨기지 않는다 — 대상으로 이동할 수도 있어야 한다.
    await expect(page.getByTestId('relation-group-stacks_on-outgoing')).toBeVisible();
  });

  test('**다중 후보가 모두 보이고 다중임이 표시된다** (FR-REL-004 예외)', async ({ page }) => {
    await stubApi(page);
    await page.goto('/pr/acme/payments/1234');
    await page.getByTestId('toggle-links').click();

    const group = page.getByTestId('relation-group-reverts-incoming');
    await expect(group.getByTestId('relation-row')).toHaveCount(2);
    await expect(group.getByTestId('relation-ambiguous')).toHaveCount(2);
  });

  test('**대상을 볼 수 없으면 링크가 없고 사유를 말하지 않는다** (THR-034)', async ({ page }) => {
    await stubApi(page);
    await page.goto('/pr/acme/payments/1234');
    await page.getByTestId('toggle-links').click();

    const group = page.getByTestId('relation-group-references-outgoing');
    await expect(group.getByTestId('relation-target-inactive')).toHaveText('acme/other#20');
    await expect(group.getByTestId('relation-target-link')).toHaveCount(0);
    // "권한"이라는 말이 나오면 "있긴 있다"가 새어 나간다.
    await expect(page.getByRole('main')).not.toContainText("permission");
  });

  test('**`links_pending`이 참조에만 걸리고 되돌림은 그대로 보인다** (DEV-258)', async ({ page }) => {
    await stubApi(page);
    await page.goto('/pr/acme/payments/1234');
    await page.getByTestId('toggle-links').click();

    await expect(page.getByTestId('references-pending')).toHaveText("Analyzing references");
    // 되돌림 간선은 그 상태와 무관하게 보인다.
    await expect(page.getByTestId('relation-group-reverts-incoming')).toBeVisible();
  });

  test('`heuristic` 항목에 근거가 함께 보인다 (QA-W002-10)', async ({ page }) => {
    await stubApi(page);
    await page.goto('/pr/acme/payments/1234');
    await page.getByTestId('toggle-links').click();

    const group = page.getByTestId('relation-group-reverts-incoming');
    await expect(group.getByTestId('relation-evidence').first()).toContainText('Revert "feat: 결제 재시도"');
  });
});

test.describe('FLOW-006 부분 실패', () => {
  test('**관계가 실패해도 동시 변경과 상세 본체는 살아 있다**', async ({ page }) => {
    await stubApi(page, 'relations');
    await page.goto('/pr/acme/payments/1234');
    await page.getByTestId('toggle-links').click();
    await page.getByTestId('toggle-cochanges').click();

    await expect(page.getByTestId('relation-error-reverts:incoming')).toBeVisible();
    // 따를 수 없는 지시를 하지 않는다 — 버튼이 실재한다 (DEV-170).
    await expect(page.getByTestId('relation-retry-reverts:incoming')).toBeVisible();
    await expect(page.getByTestId('cochange-row')).toBeVisible();
    await expect(page.getByTestId('pr-detail')).toHaveAttribute('data-screen-state', 'ready');
  });

  test('**동시 변경이 실패해도 관계는 살아 있다**', async ({ page }) => {
    await stubApi(page, 'cochanges');
    await page.goto('/pr/acme/payments/1234');
    await page.getByTestId('toggle-links').click();
    await page.getByTestId('toggle-cochanges').click();

    await expect(page.getByTestId('cochange-retry')).toBeVisible();
    await expect(page.getByTestId('relation-group-reverts-incoming')).toBeVisible();
  });
});

test.describe('FLOW-006 커밋 화면 (W-003)', () => {
  test('**진입 시 부르지 않고, 스택·동시 변경은 아예 묻지 않는다** (QA-W003-10·11)', async ({ page }) => {
    const calls = await stubApi(page);
    await page.route('**/api/commits/**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          repository: 'acme/payments',
          commit_sha: 'a'.repeat(40),
          short_sha: 'a'.repeat(12),
          role: 'merge_commit',
          base_branch: 'main',
          merge_seq: null,
          seq_epoch: null,
          sequence_space: null,
          pull_requests: [],
          correlation_id: 'c',
        }),
      });
    });

    await page.goto(`/commit/acme/payments/${'a'.repeat(40)}`);
    await expect(page.getByTestId('section-commit-links')).toBeVisible();
    expect(calls.filter((c) => c.includes('/api/relations'))).toHaveLength(0);
    // 동시 변경 섹션 자체가 없다 — 커밋에는 그 개념이 없다.
    await expect(page.getByTestId('section-cochanges')).toHaveCount(0);

    await page.getByTestId('toggle-commit-links').click();
    await expect
      .poll(() => calls.filter((c) => c.includes('/api/relations')).length)
      .toBe(6);
    expect(calls.filter((c) => c.includes('stacks_on'))).toHaveLength(0);
  });
});
