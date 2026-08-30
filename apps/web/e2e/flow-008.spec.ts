import { expect, test, type Page, type Route } from '@playwright/test';

/**
 * FLOW-008 시퀀스 재채번 (WP-040 / FR-SEQ-005, FR-ADMIN-003, CR-055).
 *
 * **재채번은 비가역이다.** 이 파일이 증명하는 것은 그 조작이 **확인 없이는
 * 절대 서버에 닿지 않는다**는 사실이며, 그것은 버튼 비활성 스냅숏이 아니라
 * **실제 네트워크 호출 수**로만 잴 수 있다 (DoD).
 *
 * 여기서 거는 것은 다섯이다.
 *
 *   1. 점검 결과가 최초 불일치와 두 SHA를 보인다 (AC-3)
 *   2. 영향 범위 셋이 확인 다이얼로그에 표시된다 (4단계)
 *   3. **확인 전 POST 호출 수 = 0** (5단계, QA-A003-10)
 *   4. 확인 문자열이 정확히 같을 때만 나간다 — trim도 대소문자 무시도 없다
 *   5. **확인 이후의 실패를 클라이언트가 자동으로 재시도하지 않는다** (예외 흐름)
 *
 * 잡 제어의 `allowed_actions` 준수(QA-A003-13)도 여기서 함께 본다 — 그 판정이
 * 실제 브라우저에서 서버 응답을 따라가는지는 렌더 시험이 답하지 못한다.
 */

interface Counters {
  /** 서버가 받은 재채번 요청. 확인 전에는 비어 있어야 한다. */
  readonly reassign: unknown[];
  /** 서버가 받은 잡 제어 요청. */
  readonly control: { jobId: string; body: unknown }[];
}

const INTEGRITY = {
  reports: [
    {
      repository: 'acme/payments',
      base_branch: 'main',
      seq_epoch: 3,
      checked_at: '2026-08-30T04:00:00.000Z',
      consistent: false,
      first_mismatch_seq: 1207,
      stored_sha: 'a'.repeat(40),
      actual_sha: 'b'.repeat(40),
      checked_count: 200,
    },
  ],
  impacts: {
    'acme/payments@main': {
      affected_commit_count: 143,
      invalidated_safe_marker_count: 2,
      affected_saved_search_count: 7,
    },
  },
};

const INDEX_STATUS = {
  generated_at: '2026-08-30T04:10:00.000Z',
  aliases: [
    {
      alias: 'prs-commits',
      current_index: 'prs-commits-v2',
      document_count: 1_200_000,
      store_size_bytes: 3_221_225_472,
      active_reindex: null,
      last_reindex: { job_id: 70, state: 'completed', switched_at: '2026-08-29T10:00:00.000Z' },
    },
    {
      alias: 'prs-links',
      current_index: 'prs-links-v1',
      // 통계를 읽지 못했다 — **0이 아니다** (QA-A003-14).
      document_count: null,
      store_size_bytes: null,
      active_reindex: null,
      last_reindex: null,
    },
  ],
  unavailable: ['prs-links.document_count'],
};

const JOBS = [
  {
    job_id: 11,
    type: 'backfill',
    target: 'acme/payments',
    state: 'running',
    progress: { done: 120, unit: 'PR' },
    requested_by: 'alice',
    started_at: '2026-08-30T04:00:00.000Z',
    finished_at: null,
    error: null,
    allowed_actions: ['pause', 'cancel'],
  },
  {
    job_id: 13,
    type: 'link_rebuild',
    target: 'acme/payments',
    state: 'cancelled',
    progress: null,
    requested_by: 'alice',
    started_at: '2026-08-30T03:00:00.000Z',
    finished_at: '2026-08-30T03:10:00.000Z',
    error: null,
    // 종료 상태라 제어할 수 없다.
    allowed_actions: [],
  },
];

interface MockConfig {
  readonly counters: Counters;
  /** 재채번 요청이 실패한다. 자동 재시도가 없어야 한다. */
  readonly reassignFails?: boolean;
}

async function installRoutes(page: Page, config: MockConfig): Promise<void> {
  const { counters } = config;

  await page.route('**/api/admin/sequence-integrity**', async (route: Route) => {
    if (route.request().method() === 'POST') {
      counters.reassign.push(route.request().postDataJSON());
      if (config.reassignFails === true) {
        return route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: { code: 'INTERNAL', message: '재채번 실패' }, correlation_id: 'c-fail' }),
        });
      }
      return route.fulfill({
        status: 202,
        contentType: 'application/json',
        body: JSON.stringify({ job_id: 88, state: 'queued' }),
      });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(INTEGRITY) });
  });

  await page.route('**/api/admin/reindex**', (route: Route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(INDEX_STATUS) }),
  );

  /*
   * **잡 경로는 한 핸들러가 받는다.** Playwright는 나중에 등록한 라우트를 먼저
   * 매칭하므로 목록 패턴을 따로 두면 그것이 `/jobs/11`의 `PATCH`까지 삼켜
   * 제어 요청이 목록 응답을 받는다 — 시험은 통과하면서 아무것도 지키지 않는다.
   */
  await page.route('**/api/admin/jobs**', async (route: Route) => {
    const path = new URL(route.request().url()).pathname;
    const jobId = /\/jobs\/(\d+)$/.exec(path)?.[1];
    if (jobId !== undefined) {
      counters.control.push({ jobId, body: route.request().postDataJSON() });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ job_id: 11 }) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: JOBS }) });
  });
}

function counters(): Counters {
  return { reassign: [], control: [] };
}

test.describe('FLOW-008 시퀀스 재채번', () => {
  test('1·2단계: 점검 결과가 최초 불일치와 두 SHA를 보인다 (AC-3)', async ({ page }) => {
    await installRoutes(page, { counters: counters() });
    await page.goto('/ops/jobs');

    await expect(page.getByTestId('integrity-report-card')).toBeVisible();
    await expect(page.getByTestId('integrity-first-mismatch')).toHaveText('1207');
    await expect(page.getByTestId('integrity-shas')).toContainText('a'.repeat(40));
    await expect(page.getByTestId('integrity-shas')).toContainText('b'.repeat(40));
  });

  test('4단계: 영향 범위 셋이 확인 다이얼로그에 표시된다', async ({ page }) => {
    await installRoutes(page, { counters: counters() });
    await page.goto('/ops/jobs');

    await page.getByTestId('integrity-reassign-open').click();
    const impact = page.getByTestId('reassign-impact');
    await expect(impact).toContainText('143');
    await expect(impact).toContainText('2');
    await expect(impact).toContainText('7');
  });

  test('**5단계: 확인 전 재채번 POST 호출 수가 0이다**', async ({ page }) => {
    const seen = counters();
    await installRoutes(page, { counters: seen });
    await page.goto('/ops/jobs');

    await page.getByTestId('integrity-reassign-open').click();
    await expect(page.getByTestId('reassign-dialog')).toBeVisible();
    // 다이얼로그를 여는 것만으로는 아무것도 나가지 않는다.
    expect(seen.reassign).toHaveLength(0);

    // 틀린 문자열로 눌러도 나가지 않는다.
    await page.getByTestId('reassign-confirm-input').fill('acme/payment');
    await page.getByTestId('reassign-confirm-submit').click({ force: true });
    expect(seen.reassign).toHaveLength(0);

    // 앞뒤 공백도 봐주지 않는다 — 관대한 비교는 증명을 약하게 만든다.
    await page.getByTestId('reassign-confirm-input').fill(' acme/payments ');
    await page.getByTestId('reassign-confirm-submit').click({ force: true });
    expect(seen.reassign).toHaveLength(0);

    // 정확히 같을 때 처음으로 나간다.
    await page.getByTestId('reassign-confirm-input').fill('acme/payments');
    await page.getByTestId('reassign-confirm-submit').click();
    await expect.poll(() => seen.reassign.length).toBe(1);
    expect(seen.reassign[0]).toMatchObject({
      action: 'reassign',
      repository: 'acme/payments',
      base_branch: 'main',
      confirm: 'acme/payments',
    });
  });

  test('**예외: 확인 이후의 실패를 자동으로 다시 요청하지 않는다**', async ({ page }) => {
    const seen = counters();
    await installRoutes(page, { counters: seen, reassignFails: true });
    await page.goto('/ops/jobs');

    await page.getByTestId('integrity-reassign-open').click();
    await page.getByTestId('reassign-confirm-input').fill('acme/payments');
    await page.getByTestId('reassign-confirm-submit').click();

    await expect(page.getByText(/재채번 요청이 거절되었습니다/)).toBeVisible();
    /*
     * **재채번은 비가역이므로 재시도는 운영자의 명시적 재실행이어야 한다.**
     * 잠시 기다린 뒤에도 요청이 하나뿐임을 확인한다.
     */
    await page.waitForTimeout(1_000);
    expect(seen.reassign).toHaveLength(1);
  });

  test('QA-A003-13: 각 잡의 제어가 서버가 준 `allowed_actions`와 일치한다', async ({ page }) => {
    const seen = counters();
    await installRoutes(page, { counters: seen });
    await page.goto('/ops/jobs');
    await expect(page.getByTestId('job-row').first()).toBeVisible();

    const running = page.getByTestId('job-row').first();
    await expect(running.getByRole('button')).toHaveCount(2);

    // 종료된 잡에는 버튼이 하나도 없다.
    const cancelled = page.getByTestId('job-row').nth(1);
    await expect(cancelled.getByRole('button')).toHaveCount(0);

    await running.getByTestId('job-action-cancel').click();
    await expect.poll(() => seen.control.length).toBe(1);
    expect(seen.control[0]).toEqual({ jobId: '11', body: { action: 'cancel' } });
  });

  test('QA-A003-14: 인덱스의 읽지 못한 값이 미확인이며 `0`·`0B`가 아니다', async ({ page }) => {
    await installRoutes(page, { counters: counters() });
    await page.goto('/ops/jobs');

    const links = page.getByTestId('index-row').filter({ hasText: 'prs-links' });
    await expect(links.getByTestId('index-unavailable')).toHaveCount(2);
    await expect(links).not.toContainText('0 B');
    // 다른 행은 정상 표시된다 — 값 하나의 실패가 패널을 무너뜨리지 않는다.
    await expect(page.getByTestId('index-row').filter({ hasText: 'prs-commits' })).toContainText('1,200,000');
  });

  test('총계를 모르는 진행률을 0으로 그리지 않는다', async ({ page }) => {
    await installRoutes(page, { counters: counters() });
    await page.goto('/ops/jobs');

    await expect(page.getByTestId('job-progress-count')).toContainText('총계 미확인');
    await expect(page.getByTestId('job-progress-meter')).toHaveCount(0);
  });
});
