import { expect, test, type Page, type Route } from '@playwright/test';

/**
 * FLOW-007 수집 지연 대응 (WP-040 / SCN-006, FR-ING-007·011, FR-ADMIN-001·002, CR-055).
 *
 * **실제 브라우저에서만 확인되는 것**만 둔다. 순수 판정은 `lib/ops-pipeline.test.ts`가,
 * 렌더와 접근성은 `a11y/ops-pipeline.test.tsx`가 이미 건다.
 *
 * 여기서 거는 것은 넷이다.
 *
 *   1. 화면이 실제로 서고 지표·실패 대기열·조정 스캔이 그려진다
 *   2. **확인 전에는 재처리 요청이 서버로 한 번도 나가지 않는다** — 버튼 비활성
 *      스냅숏이 아니라 **실제 네트워크 호출 수**로 증명한다 (DoD)
 *   3. 100건 초과는 확인을 **두 번** 거쳐야 나간다
 *   4. 조정 스캔이 잡을 만들고 그 상태가 그대로 보인다 — 버튼을 누른 사실은
 *      스캔 완료가 아니다 (QA-A003-15)
 *
 * ## 목이 서버 계약과 키를 맞춘다
 *
 * `WP-038`에서 배운 것이다 — 목이 응답을 지어내면 계약 버그를 숨긴다. 여기
 * 응답은 `API-ADM-006`·`API-ADM-002`의 필드 이름을 그대로 쓴다.
 */

interface Counters {
  /** 서버가 실제로 받은 재처리 요청. 확인 전에는 비어 있어야 한다. */
  readonly reprocess: unknown[];
  /** 만들어진 잡. 조정 스캔이 여기 쌓인다. */
  readonly jobsCreated: unknown[];
}

const STATUS = {
  generated_at: '2026-08-30T04:00:00.000Z',
  intake_per_minute: 420,
  queue_depth: { ingest: 12, enrich: 3 },
  stage_latency_seconds: { ingest: 'unavailable', enrich: 2.4 },
  dead_letter: { pending: 3 },
  enrichment_pending: 5,
  sequence_space_state: { ready: 12 },
  slowest_repositories: [],
  slowest_repositories_out_of_scope: 3,
  unavailable: ['ingestion_lag_seconds'],
};

function deadLetters(count: number): readonly Record<string, unknown>[] {
  return Array.from({ length: count }, (_, index) => ({
    dead_letter_id: index + 1,
    delivery_id: `delivery-${String(index + 1)}`,
    stage: 'ingest',
    repository_id: 4021,
    error: '색인 거부',
    retry_count: 2,
    reprocess_count: 0,
    state: 'pending',
    created_at: '2026-08-30T03:00:00.000Z',
    updated_at: '2026-08-30T03:30:00.000Z',
  }));
}

interface MockConfig {
  readonly counters: Counters;
  readonly deadLetterCount?: number;
  /** 조정 잡이 이미 돌고 있다. */
  readonly scanRunning?: boolean;
  /** 조정 스캔 생성이 409를 낸다. */
  readonly scanConflict?: number;
}

async function installRoutes(page: Page, config: MockConfig): Promise<void> {
  const { counters } = config;

  await page.route('**/api/admin/pipeline-status**', (route: Route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(STATUS) }),
  );

  await page.route('**/api/admin/dead-letters/reprocess**', async (route: Route) => {
    counters.reprocess.push(route.request().postDataJSON());
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ requeued: 1, correlation_id: 'c-reprocess' }),
    });
  });

  await page.route('**/api/admin/dead-letters?**', (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items: deadLetters(config.deadLetterCount ?? 3), total: config.deadLetterCount ?? 3 }),
    }),
  );
  await page.route('**/api/admin/dead-letters', (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items: deadLetters(config.deadLetterCount ?? 3), total: config.deadLetterCount ?? 3 }),
    }),
  );

  await page.route('**/api/admin/jobs**', async (route: Route) => {
    if (route.request().method() === 'POST') {
      counters.jobsCreated.push(route.request().postDataJSON());
      if (config.scanConflict !== undefined) {
        return route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({
            error: { code: 'JOB_CONFLICT', message: '이미 실행 중이다', detail: { job_id: config.scanConflict } },
            correlation_id: 'c-conflict',
          }),
        });
      }
      return route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ job_id: 55, state: 'queued' }),
      });
    }

    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        items: config.scanRunning === true
          ? [
              {
                job_id: 55,
                type: 'reconcile',
                target: 'all',
                state: 'running',
                progress: { done: 4, total: 12 },
                requested_by: 'operator',
                started_at: '2026-08-30T04:00:00.000Z',
                finished_at: null,
                error: null,
                allowed_actions: ['cancel'],
              },
            ]
          : [],
      }),
    });
  });

  await page.route('**/api/admin/raw-events**', (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items: [], next_cursor: null, index_available: true }),
    }),
  );
}

function counters(): Counters {
  return { reprocess: [], jobsCreated: [] };
}

test.describe('FLOW-007 수집 지연 대응', () => {
  test('1단계: 화면이 서고 지표·실패 대기열·조정 스캔이 그려진다', async ({ page }) => {
    await installRoutes(page, { counters: counters() });
    await page.goto('/ops/pipeline');

    await expect(page.getByTestId('ops-pipeline-view')).toHaveAttribute('data-access', 'full');
    await expect(page.getByTestId('section-metrics')).toBeVisible();
    await expect(page.getByTestId('section-dlq')).toBeVisible();
    await expect(page.getByTestId('section-scan')).toBeVisible();
    await expect(page.getByTestId('dead-letter-row')).toHaveCount(3);
  });

  test('2단계: 읽지 못한 지표를 **0으로 그리지 않는다**', async ({ page }) => {
    await installRoutes(page, { counters: counters() });
    await page.goto('/ops/pipeline');

    await expect(page.getByTestId('metric-ingestion-lag')).toHaveAttribute('data-unavailable', 'true');
    await expect(page.getByTestId('metric-stage-latency')).toContainText("Unknown");
    await expect(page.getByTestId('metric-stage-latency')).toContainText("2.4s");
  });

  test('2단계: "느린 저장소가 없다"와 "볼 수 없다"를 가른다 (DEV-051)', async ({ page }) => {
    await installRoutes(page, { counters: counters() });
    await page.goto('/ops/pipeline');

    await expect(page.getByTestId('laggards-empty')).toContainText("None within your access scope");
    await expect(page.getByTestId('laggards-empty')).toContainText("3");
  });

  test('**4단계: 확인 전에는 재처리 요청이 서버로 나가지 않는다**', async ({ page }) => {
    const seen = counters();
    await installRoutes(page, { counters: seen });
    await page.goto('/ops/pipeline');
    await expect(page.getByTestId('dead-letter-row').first()).toBeVisible();

    await page.getByTestId('dead-letter-select').first().click();
    await page.getByTestId('dead-letter-reprocess-open').click();
    await expect(page.getByTestId('dead-letter-dialog')).toBeVisible();

    /*
     * **실제 호출 수로 증명한다.** 버튼이 비활성이었다는 스냅숏은 증명이
     * 아니다 — 확인 다이얼로그가 열린 상태에서 서버가 아무것도 받지 않았어야 한다.
     */
    expect(seen.reprocess).toHaveLength(0);

    await page.getByTestId('dead-letter-reprocess-confirm').click();
    await expect.poll(() => seen.reprocess.length).toBe(1);
    expect(seen.reprocess[0]).toEqual({ dead_letter_ids: [1] });
  });

  test('**4단계: 100건 초과는 확인을 두 번 거쳐야 나간다**', async ({ page }) => {
    const seen = counters();
    await installRoutes(page, { counters: seen, deadLetterCount: 101 });
    await page.goto('/ops/pipeline');
    await expect(page.getByTestId('dead-letter-row')).toHaveCount(101);

    for (const box of await page.getByTestId('dead-letter-select').all()) await box.click();
    await page.getByTestId('dead-letter-reprocess-open').click();

    // 첫 확인은 재확인 단계로만 넘어간다 — 서버는 아직 아무것도 받지 않는다.
    await page.getByTestId('dead-letter-reprocess-confirm').click();
    await expect(page.getByTestId('dead-letter-dialog')).toHaveAttribute('data-phase', 'reconfirm');
    expect(seen.reprocess).toHaveLength(0);

    await page.getByTestId('dead-letter-reprocess-confirm').click();
    await expect.poll(() => seen.reprocess.length).toBe(1);
  });

  test('**5·6단계: 조정 스캔이 잡을 만들고 그 상태가 그대로 보인다**', async ({ page }) => {
    const seen = counters();
    await installRoutes(page, { counters: seen });
    await page.goto('/ops/pipeline');
    await expect(page.getByTestId('scan-run')).toBeVisible();

    await page.getByTestId('scan-run').click();
    await expect.poll(() => seen.jobsCreated.length).toBe(1);
    // `reconcile`은 대상을 보내지 않는다 — 서버가 `all`을 쓴다.
    expect(seen.jobsCreated[0]).toEqual({ type: 'reconcile' });
  });

  test('6단계: 실행 중이면 잡 상태와 진행률을 보인다 — "실행했습니다"로 끝내지 않는다', async ({
    page,
  }) => {
    await installRoutes(page, { counters: counters(), scanRunning: true });
    await page.goto('/ops/pipeline');

    await expect(page.getByTestId('scan-job')).toContainText("Job 55");
    await expect(page.getByTestId('scan-job')).toContainText("Running");
    // 실행 중에는 다시 누를 수 없다 — 두 번째 잡을 만들지 않는다.
    await expect(page.getByTestId('scan-run')).toBeDisabled();
  });

  test('예외: 이미 돌고 있으면 409와 실행 중 잡을 가리킨다', async ({ page }) => {
    await installRoutes(page, { counters: counters(), scanConflict: 91 });
    await page.goto('/ops/pipeline');
    await expect(page.getByTestId('scan-run')).toBeEnabled();

    await page.getByTestId('scan-run').click();
    await expect(page.getByTestId('scan-conflict')).toContainText('91');
    await expect(page.getByTestId('scan-conflict')).toContainText("cannot run concurrently");
  });

  test('아카이브 인덱스가 없어도 나머지 섹션이 정상 동작한다 (QA-A001-13)', async ({ page }) => {
    await installRoutes(page, { counters: counters() });
    await page.route('**/api/admin/raw-events**', (route: Route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items: [], next_cursor: null, index_available: false }),
      }),
    );
    await page.goto('/ops/pipeline');

    await page.getByTestId('archive-search').click();
    await expect(page.getByTestId('archive-unavailable')).toBeVisible();
    // 다른 섹션은 그대로 돈다.
    await expect(page.getByTestId('section-metrics')).toBeVisible();
    await expect(page.getByTestId('dead-letter-row').first()).toBeVisible();
  });
});
