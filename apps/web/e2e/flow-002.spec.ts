import { expect, test, type Page } from '@playwright/test';

/**
 * FLOW-002 / W-002 PR 상세 (WP-017 DoD).
 *
 * **실제 브라우저에서만 확인되는 것**만 둔다:
 *   1. 딥링크가 실제로 라우팅되는가
 *   2. **W-001 → W-002 → 뒤로가기**가 성립하는가 (WP-016이 심은 `from_q`)
 *   3. 자동 폴링이 정말 없는가 — 진짜 네트워크 계층에서 센다
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
  reviewers: ['lee', 'park'],
  approved_by: ['lee'],
  created_at: '2026-08-18T09:00:00Z',
  first_review_at: '2026-08-18T11:30:00Z',
  merged_at: '2026-08-19T05:02:11Z',
  lead_time_seconds: 72000,
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
};

const SEARCH_RESULT = {
  total: { value: 1, relation: 'eq' },
  items: [
    {
      kind: 'pull_request',
      repository: 'acme/payments',
      pr_number: 1234,
      title: 'feat: 결제 재시도',
      author: 'kim',
      state: 'merged',
      merge_seq: null,
      seq_epoch: null,
      sequence_space: null,
      merged_at: '2026-08-19T05:02:11Z',
      changed_files_count: 2,
      additions: 120,
      deletions: 15,
      url: '/pr/acme/payments/1234',
    },
  ],
  sort: { field: 'merge_seq', order: 'desc' },
  next_cursor: null,
};

/** 선행·후행 응답. 서수 3은 **PR 없는 직접 푸시**다 (CR-031, DEV-161). */
const NEIGHBORS = {
  sequence_space: 'acme/payments@main',
  seq_epoch: 3,
  sequence_state: 'ok',
  epoch_stale: false,
  anchor: { merge_seq: 4, kind: 'pull_request', pr_number: 1234, commit_sha: 'a'.repeat(40) },
  items: [
    { merge_seq: 3, kind: 'commit', commit_sha: 'e'.repeat(40), pr_number: null, title: null, author: null, merged_at: '2026-08-18T00:00:00Z', is_anchor: false, indexed: false, url: '/commit/acme/payments/' + 'e'.repeat(40) },
    { merge_seq: 4, kind: 'pull_request', commit_sha: 'a'.repeat(40), pr_number: 1234, title: 'feat: 결제 재시도', author: 'kim', merged_at: '2026-08-19T05:02:11Z', is_anchor: true, indexed: true, url: '/pr/acme/payments/1234' },
    { merge_seq: 5, kind: 'pull_request', commit_sha: 'f'.repeat(40), pr_number: 1240, title: 'fix: 세션', author: 'park', merged_at: '2026-08-19T06:00:00Z', is_anchor: false, indexed: true, url: '/pr/acme/payments/1240' },
  ],
  boundary: { at_start: false, at_end: true },
  correlation_id: 'n',
};

const RANGE = {
  sequence_space: 'acme/payments@main',
  seq_epoch: 3,
  sequence_state: 'ok',
  epoch_stale: false,
  range: { from_seq: 3, to_seq: 5, boundary: '(from, to]' },
  summary: {
    pull_request_count: 1,
    commit_count: 2,
    distinct_author_count: 1,
    changed_files_total: 2,
    additions_total: 10,
    deletions_total: 1,
    files_truncated_pull_request_count: 0,
    top_changed_paths: [],
  },
  items: [],
  items_missing_in_index: 0,
  next_cursor: null,
  correlation_id: 'r',
};

/**
 * 앵커 대역 — **표현을 실제로 판정한다** (WP-026의 교훈).
 *
 * 무엇을 주든 해석해 주는 대역은 링크가 만든 표현이 틀려도 초록을 낸다. 맨 숫자는
 * `classifyAnchor`가 의도적으로 `ambiguous`로 판정하므로 여기서도 거절한다.
 */
function resolveAnchorExpression(position: string, expression: string): { status: number; body: unknown } {
  if (/^\d+$/.test(expression)) {
    return {
      status: 400,
      body: {
        error: { code: 'ANCHOR_UNRESOLVABLE', message: `모호합니다: ${expression}`, detail: {} },
        correlation_id: 'c',
      },
    };
  }
  const seq = Number(/^seq:(\d+)$/.exec(expression)?.[1] ?? '1');
  return {
    status: 200,
    body: {
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
    },
  };
}

/** 두 API를 모두 가로채고 호출 URL을 기록한다. */
async function stubApi(page: Page, prBody: Record<string, unknown> = {}): Promise<string[]> {
  const calls: string[] = [];
  await page.route('**/api/**', async (route) => {
    const url = route.request().url();
    calls.push(url);
    let status = 200;
    let body: unknown;
    if (url.includes('/api/search')) body = SEARCH_RESULT;
    else if (url.includes('/api/sequence-neighbors')) {
      /*
       * **대역이 서버보다 관대하면 그만큼이 사각지대다** (WP-026의 교훈). 서버는
       * `base_branch` 없이는 공간을 추측하지 않고 400을 낸다 (CR-032, DEV-168).
       * 대역이 그것을 받아 주면 화면이 공간을 빠뜨려도 초록이 난다.
       */
      const branch = new URL(url).searchParams.get('base_branch');
      if (branch === null || branch === '') {
        status = 400;
        body = {
          error: { code: 'INVALID_PARAMETER', message: 'base_branch가 필요합니다.', detail: { field: 'base_branch' } },
          correlation_id: 'c',
        };
      } else {
        body = NEIGHBORS;
      }
    }
    else if (url.includes('/api/sequence-ranges')) body = RANGE;
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
    } else body = { ...PR, ...prBody };
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  });
  return calls;
}

test.describe('딥링크가 선다', () => {
  test('`/pr/:owner/:repo/:number`가 상세를 그린다', async ({ page }) => {
    await stubApi(page);
    await page.goto('/pr/acme/payments/1234');

    await expect(page.getByTestId('pr-detail')).toHaveAttribute('data-screen-state', 'ready');
    await expect(page.getByRole('heading', { name: 'feat: 결제 재시도', level: 1 })).toBeVisible();
    await expect(page.getByTestId('entity-identifier')).toContainText('acme/payments #1234');
  });

  test('셸 안에 선다 — 랜드마크가 유지된다', async ({ page }) => {
    await stubApi(page);
    await page.goto('/pr/acme/payments/1234');

    await expect(page.getByRole('banner')).toBeVisible();
    await expect(page.getByRole('main')).toBeVisible();
  });

  test('**번호 모양이 틀리면 조회하지 않고 같은 화면을 보인다**', async ({ page }) => {
    const calls = await stubApi(page);
    await page.goto('/pr/acme/payments/abc');

    await expect(page.getByTestId('pr-detail')).toHaveAttribute('data-screen-state', 'not_found');
    // 부르지 않는다 — 어차피 404이고, 부르지 않는 편이 낫다.
    expect(calls.filter((c) => c.includes('/pull-requests/'))).toEqual([]);
    // **막다른 골목으로 두지 않는다.** 되돌아갈 길이 화면 안에 있어야 한다.
    await expect(page.getByTestId('back-link')).toBeVisible();
  });

  test('**0과 앞자리 0도 조회하지 않는다** — PR 번호는 양의 정수다', async ({ page }) => {
    for (const bad of ['0', '007', '-1', '1.5', '12345678901']) {
      const calls = await stubApi(page);
      await page.goto(`/pr/acme/payments/${bad}`);
      await expect(page.getByTestId('pr-detail')).toHaveAttribute('data-screen-state', 'not_found');
      /*
       * `007`을 받아 주면 `Number('007') === 7`이라 **URL과 다른 PR을
       * 그리게 된다.** 조사 결과를 URL로 인용하는 제품에서 그것은 치명적이다.
       */
      expect(calls.filter((c) => c.includes('/pull-requests/'))).toEqual([]);
    }
  });

  test('번호 모양이 틀려도 **원래 질의로 돌아간다**', async ({ page }) => {
    await stubApi(page);
    await page.goto('/pr/acme/payments/abc?from_q=repo%3Aacme%2Fpayments');

    await expect(page.getByTestId('pr-detail')).toHaveAttribute('data-screen-state', 'not_found');
    await page.getByTestId('back-link').click();
    await expect(page).toHaveURL(/\/search\?q=repo%3Aacme%2Fpayments/);
  });
});

test.describe('W-001 → W-002 → 뒤로가기 (FLOW-002)', () => {
  test('**결과 행을 눌러 상세로 가고, 뒤로가기로 질의가 살아 돌아온다**', async ({ page }) => {
    await stubApi(page);

    await page.goto('/search?q=repo%3Aacme%2Fpayments');
    await expect(page.getByTestId('search-view')).toHaveAttribute('data-screen-state', 'ready');

    // WP-016이 심은 `from_q`가 여기서 값을 한다.
    await page.getByTestId('result-link').click();
    await expect(page).toHaveURL(/\/pr\/acme\/payments\/1234\?from_q=/);
    await expect(page.getByTestId('pr-detail')).toHaveAttribute('data-screen-state', 'ready');

    await page.goBack();
    await expect(page).toHaveURL(/\/search\?q=repo%3Aacme%2Fpayments/);
    // 입력창이 질의를 그대로 담고 있어야 한다 — 조사가 끊기지 않는다.
    await expect(page.getByRole('searchbox')).toHaveValue('repo:acme/payments');
  });

  test('상세의 "검색으로 돌아가기"도 같은 질의로 간다', async ({ page }) => {
    await stubApi(page);
    await page.goto('/pr/acme/payments/1234?from_q=repo%3Aacme%2Fpayments');

    await expect(page.getByTestId('pr-detail')).toHaveAttribute('data-screen-state', 'ready');
    await page.getByTestId('back-link').click();
    await expect(page).toHaveURL(/\/search\?q=repo%3Aacme%2Fpayments/);
  });
});

test.describe('보강 미완료 (QA-W002-15, FLOW-002 예외 흐름)', () => {
  test('머지 커밋은 보이고 원본만 수집 중이다', async ({ page }) => {
    await stubApi(page, { source_commits: [], enrichment_pending: true });
    await page.goto('/pr/acme/payments/1234');

    await expect(page.getByTestId('enrichment-pending')).toBeVisible();
    await expect(page.getByTestId('merge-commit-row')).toContainText('a'.repeat(12));
  });

  test('**자동 폴링을 하지 않는다** — 실제 네트워크에서 센다', async ({ page }) => {
    const calls = await stubApi(page, { source_commits: [], enrichment_pending: true });
    await page.goto('/pr/acme/payments/1234');
    await expect(page.getByTestId('enrichment-pending')).toBeVisible();

    const before = calls.filter((c) => c.includes('/pull-requests/')).length;
    await page.waitForTimeout(1500);
    const after = calls.filter((c) => c.includes('/pull-requests/')).length;

    // 1.5초를 가만히 둬도 늘지 않아야 한다.
    expect(after).toBe(before);
  });

  test('재조회 버튼은 실제로 다시 부른다', async ({ page }) => {
    const calls = await stubApi(page, { source_commits: [], enrichment_pending: true });
    await page.goto('/pr/acme/payments/1234');
    await expect(page.getByTestId('enrichment-pending')).toBeVisible();

    const before = calls.filter((c) => c.includes('/pull-requests/')).length;
    await page.getByRole('button', { name: "Refresh" }).click();
    await expect
      .poll(() => calls.filter((c) => c.includes('/pull-requests/')).length)
      .toBe(before + 1);
  });
});

test.describe('지연 조회 섹션 (QA-W002-17)', () => {

  test('**진입 시 관계·릴리스를 부르지 않는다**', async ({ page }) => {
    const calls = await stubApi(page);
    await page.goto('/pr/acme/payments/1234');
    await expect(page.getByTestId('pr-detail')).toHaveAttribute('data-screen-state', 'ready');

    // PR 문서 하나뿐이다 (IA 원칙 4, 점진적 공개).
    expect(calls.filter((c) => c.includes('/api/'))).toHaveLength(1);
  });

  test('세 섹션이 숨겨지지 않는다', async ({ page }) => {
    await stubApi(page);
    await page.goto('/pr/acme/payments/1234');

    await expect(page.getByTestId('section-neighbors')).toBeVisible();
    await expect(page.getByTestId('section-releases')).toBeVisible();
    await expect(page.getByTestId('section-links')).toBeVisible();
    // 동시 변경은 관계와 **독립한** 하위 섹션이다 (WP-031, CR-042).
    await expect(page.getByTestId('section-cochanges')).toBeVisible();
  });
});


test.describe('접근 범위 (QA-W002-18)', () => {
  test('404는 존재 여부를 드러내지 않는다', async ({ page }) => {
    await page.route('**/api/pull-requests/**', async (route) => {
      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'NOT_FOUND', message: 'PR을 찾을 수 없습니다' } }),
      });
    });
    await page.goto('/pr/acme/secret/9999');

    await expect(page.getByTestId('pr-detail')).toHaveAttribute('data-screen-state', 'not_found');
    // "권한"이라는 말이 나오면 "있긴 있다"가 새어 나간다.
    await expect(page.getByRole('main')).not.toContainText("permission");
  });
});

test.describe('선행·후행 (WP-027 / FR-REL-001, CR-031)', () => {
  test('**진입 시에는 부르지 않고, 펼칠 때 1회 부른다** (QA-W002-17)', async ({ page }) => {
    const calls = await stubApi(page);
    await page.goto('/pr/acme/payments/1234');
    await expect(page.getByTestId('pr-detail')).toHaveAttribute('data-screen-state', 'ready');
    expect(calls.filter((url) => url.includes('/api/sequence-neighbors'))).toHaveLength(0);

    await page.getByTestId('toggle-neighbors').click();
    await expect(page.getByTestId('neighbor-list')).toBeVisible();
    expect(calls.filter((url) => url.includes('/api/sequence-neighbors'))).toHaveLength(1);
  });

  test('**직접 푸시 커밋이 목록에 있어 서수가 건너뛰지 않는다** (DEV-161)', async ({ page }) => {
    await stubApi(page);
    await page.goto('/pr/acme/payments/1234');
    await page.getByTestId('toggle-neighbors').click();
    await expect(page.getByTestId('neighbor-list')).toBeVisible();

    await expect(page.getByTestId('neighbor-row')).toHaveCount(3);
    await expect(page.getByTestId('neighbor-direct-push')).toBeVisible();
    await expect(page.getByTestId('neighbor-anchor-badge')).toBeVisible();
  });

  test('**범위로 확장이 W-004에 닿고 앵커가 해석된다** (DEV-167)', async ({ page }) => {
    await stubApi(page);
    await page.goto('/pr/acme/payments/1234');
    await page.getByTestId('toggle-neighbors').click();
    await expect(page.getByTestId('neighbors-range-expand')).toBeVisible();

    await page.getByTestId('neighbors-range-expand').click();
    await expect(page).toHaveURL(/from=seq%3A3&to=seq%3A5/);
    /*
     * 도착만으로는 부족하다 — 링크가 만든 표현을 W-004가 실제로 해석해야 조회가
     * 열린다. 맨 숫자로 넘기면 여기서 두 앵커가 모두 실패한다 (WP-026에서 겪었다).
     */
    await expect(page.getByTestId('anchor-from-resolved')).toBeVisible();
    await expect(page.getByTestId('anchor-to-resolved')).toBeVisible();
  });

  test('미머지 PR은 조회하지 않고 사유를 보인다 (QA-W002-07, DEV-164)', async ({ page }) => {
    const calls = await stubApi(page, { state: 'open', merge_commit_sha: null });
    await page.goto('/pr/acme/payments/1234');
    await page.getByTestId('toggle-neighbors').click();

    await expect(page.getByTestId('neighbor-not-merged')).toBeVisible();
    expect(calls.filter((url) => url.includes('/api/sequence-neighbors'))).toHaveLength(0);
  });
});

test.describe('공간 지정과 실패 복구 (CR-032)', () => {
  test('**요청이 공간을 지정하고 목록이 실제로 선다** (DEV-168)', async ({ page }) => {
    const calls = await stubApi(page);
    await page.goto('/pr/acme/payments/1234');
    await expect(page.getByTestId('pr-detail')).toHaveAttribute('data-screen-state', 'ready');

    await page.getByTestId('toggle-neighbors').click();
    /*
     * 대역이 `base_branch` 없는 요청을 400으로 거절하므로, 목록이 보인다는 것은
     * 화면이 공간을 실제로 실어 보냈다는 뜻이다 — 왕복으로 확인한다.
     */
    await expect(page.getByTestId('neighbor-list')).toBeVisible();
    const asked = calls.find((url) => url.includes('/api/sequence-neighbors'));
    expect(asked).toContain('base_branch=main');
  });

  test('**실패한 뒤 실제 브라우저에서 다시 시도할 수 있다** (DEV-170)', async ({ page }) => {
    let attempts = 0;
    await page.route('**/api/**', async (route) => {
      const url = route.request().url();
      if (!url.includes('/api/sequence-neighbors')) {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(PR) });
        return;
      }
      attempts += 1;
      if (attempts === 1) {
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: { code: 'INTERNAL', message: '일시 오류' } }),
        });
        return;
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(NEIGHBORS) });
    });

    await page.goto('/pr/acme/payments/1234');
    await expect(page.getByTestId('pr-detail')).toHaveAttribute('data-screen-state', 'ready');
    await page.getByTestId('toggle-neighbors').click();
    await expect(page.getByTestId('neighbors-error')).toBeVisible();

    await page.getByTestId('neighbors-retry').click();
    await expect(page.getByTestId('neighbor-list')).toBeVisible();
    expect(attempts).toBe(2);
  });
});
