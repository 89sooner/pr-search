import { expect, test, type Page, type Route } from '@playwright/test';

/**
 * REL-007 R0 첫 수직 — W-010·W-021 (WP-077 DoD / FR-GH-002·003·006·008·012, CR-086).
 *
 * **실제 브라우저에서만 확인되는 것**만 둔다. 순수 판정은 `lib/gh.test.ts`가, 렌더와 접근성은
 * `a11y/gh.test.tsx`가 이미 건다. 여기서 거는 것은:
 *
 *   1. 연결 없음 → 연결 버튼 → 서버가 준 `authorize_url`로 **실제로 이동**한다 (FR-GH-008 AC-2)
 *   2. 저장소 → 폼 → 미리보기 argv → 실행 → `EventSource` 스트림 → 결과 표 (사용자 흐름 전체)
 *   3. 위반이 있으면 실행 버튼이 닫히고 **미리보기 요청이 서버로 나가지 않는다** — 네트워크 호출 수로 (QA-GH-02)
 *   4. 같은 버튼을 두 번 눌러도 실행 요청이 하나다 (QA-GH-14)
 *   5. 배포가 껐으면(404) 「열리지 않았다」가 보인다 (DEV-589)
 *   6. 이력 → 행 선택 → 패널, 「같은 구성으로 다시 실행」이 W-010의 초기값이 된다 (FR-GH-012 AC-4)
 *
 * ## 목이 서버 계약과 키를 맞춘다
 *
 * 응답은 `API-GH-001/002/005/007/010`의 필드 이름을 그대로 쓴다. 목이 응답을 지어내면 계약
 * 버그를 숨긴다 (WP-038에서 배운 것).
 */

const JSON_FIELDS = ['number', 'title', 'state', 'author', 'headRefName', 'baseRefName', 'isDraft', 'updatedAt', 'url'];

const CAPABILITIES = {
  gh_version: '2.97.0',
  manifest_version: 'r0.1',
  manifest_hash: 'ad00027d84b9915e5127867a778df29b1d164bb88b8e5e15d6be2c9ab820dab2',
  coverage: { leafCommands: 196, executableCommands: 1, unclassifiedLeafCommands: 195 },
  capabilities: [
    {
      id: 'pr.list',
      path: ['pr', 'list'],
      title: 'PR 목록 조회',
      risk: 'R0',
      support: 'supported',
      execution: 'allowed',
      required_permissions: ['pull_requests:read'],
      options: [
        { kind: 'enum', flag: '--state', values: ['open', 'closed', 'merged', 'all'], defaultValue: 'open', label: 'PR 상태' },
        { kind: 'int', flag: '--limit', min: 1, max: 100, defaultValue: 30, label: '조회 건수' },
        { kind: 'json_fields', flag: '--json', allowed: [...JSON_FIELDS, 'createdAt'], defaultValue: JSON_FIELDS, minItems: 1, maxItems: 10, label: 'JSON 필드' },
      ],
      constraints: [{ kind: 'context_required', context: 'repository' }],
      // CR-089: 실행 정의에는 구현 adapter만 있고, 결과의 뜻은 결과 계약 요약으로 온다.
      result_adapter: { mode: 'json', adapter: 'native_json', schema: 'pr_list_v2', outputPort: 'pull_requests' },
      result_contract: { kind: 'resource_list', sensitivity: 'internal', composability: 'partially_bindable', bindable: true, resource_kind: 'pull_request' },
      timeout_ms: 30_000,
    },
  ],
  commands: [
    { id: 'pr.list', path: ['pr', 'list'], summary: 'List pull requests in a repository', section: 'CORE COMMANDS', alias_of: null, support: 'supported', execution: 'allowed', execution_reason: null, risk: 'R0' },
    { id: 'pr.merge', path: ['pr', 'merge'], summary: 'Merge a pull request', section: 'CORE COMMANDS', alias_of: null, support: 'unknown', execution: 'not_implemented', execution_reason: '이 판이 열지 않은 capability', risk: null },
  ],
  correlation_id: 'c-cap',
};

const REPOSITORIES = { host: 'ghe.test', items: [{ repository_id: 4021, repository: 'acme/payments', visibility: 'internal' }], correlation_id: 'c-repo' };

const CONNECTED = { status: 'connected', host: 'ghe.test', github_login: 'alice', github_user_id: 1, connected_at: '2026-09-13T04:00:00.000Z', expires_at: '2026-09-13T12:00:00.000Z', revoked_at: null, scopes: [], correlation_id: 'c-id' };
const NOT_CONNECTED = { status: 'not_connected', host: 'ghe.test', github_login: null, github_user_id: null, connected_at: null, expires_at: null, revoked_at: null, scopes: [], correlation_id: 'c-id' };

interface Invocation {
  readonly capability_id: string;
  readonly context: { readonly repository: string };
  readonly flags: Record<string, string>;
  readonly output: { readonly json_fields: string[] };
}

/** 서버의 argv 빌더와 같은 모양 — 미리보기와 실행이 같은 값을 보게 한다. 토큰은 절대 들어가지 않는다. */
function argvOf(invocation: Invocation): string[] {
  return ['pr', 'list', '--repo', `ghe.test/${invocation.context.repository}`, '--state', invocation.flags['--state'] ?? 'open', '--limit', invocation.flags['--limit'] ?? '30', '--json', invocation.output.json_fields.join(',')];
}

function previewOf(invocation: Invocation, connected: boolean): Record<string, unknown> {
  return {
    capability_id: 'pr.list',
    risk: 'R0',
    argv: argvOf(invocation),
    env: [
      { key: 'GH_ENTERPRISE_TOKEN', value: '<redacted>' },
      { key: 'GH_HOST', value: 'ghe.test' },
    ],
    context: {
      host: 'ghe.test',
      repository: invocation.context.repository,
      github_actor: connected ? 'alice' : null,
      identity_status: connected ? 'connected' : 'not_connected',
      gh_version: '2.97.0',
      manifest_version: 'r0.1',
      manifest_hash: CAPABILITIES.manifest_hash,
      required_permissions: ['pull_requests:read'],
      permission_check: 'delegated_token_intersection',
      policy: 'r0_immediate',
      timeout_ms: 30_000,
    },
    executable: connected,
    blockers: connected ? [] : ['identity_not_connected'],
    correlation_id: 'c-preview',
  };
}

function executionOf(id: number, invocation: Invocation, state: string): Record<string, unknown> {
  const done = state === 'succeeded' || state === 'failed' || state === 'cancelled' || state === 'timed_out';
  return {
    execution_id: id,
    state,
    capability_id: 'pr.list',
    risk: 'R0',
    repository: invocation.context.repository,
    host: 'ghe.test',
    github_actor: 'alice',
    user_id: 'u-alice',
    argv: argvOf(invocation),
    env_keys: ['GH_ENTERPRISE_TOKEN', 'GH_HOST'],
    gh_version: '2.97.0',
    manifest_version: 'r0.1',
    manifest_hash: CAPABILITIES.manifest_hash,
    requested_at: '2026-09-13T05:00:00.000Z',
    started_at: state === 'queued' ? null : '2026-09-13T05:00:01.000Z',
    finished_at: done ? '2026-09-13T05:00:03.000Z' : null,
    cancel_requested_at: state === 'cancelled' ? '2026-09-13T05:00:02.000Z' : null,
    exit_code: done ? 0 : null,
    error: state === 'cancelled' ? 'cancelled' : null,
    result:
      state === 'succeeded'
        ? {
            kind: 'resource_list',
            schema: 'pr_list_v2',
            references: {
              port: 'pull_requests',
              type: 'pull_request',
              status: 'available',
              reason: null,
              refs: [12, 11].map((number) => ({ host: 'ghe.test', kind: 'pull_request', repository: invocation.context.repository, id: null, number, ref: null })),
            },
            fields: invocation.output.json_fields,
            rows: [
              { number: 12, title: 'Fix race <script>alert(1)</script>', state: 'OPEN', url: 'https://ghe.test/acme/payments/pull/12', author: 'alice', headRefName: 'fix/race', baseRefName: 'main', isDraft: false, createdAt: null, updatedAt: '2026-09-12T00:00:00.000Z' },
              { number: 11, title: 'Add thing', state: 'OPEN', url: null, author: 'bob', headRefName: 'feat/thing', baseRefName: 'main', isDraft: true, createdAt: null, updatedAt: '2026-09-11T00:00:00.000Z' },
            ],
            row_count: 2,
            possibly_more: false,
            stdout_truncated: false,
          }
        : null,
    stdout: done ? { text: '[{"number":12}]', truncated: false } : null,
    stderr: done ? { text: null, truncated: false } : null,
    output_binary: false,
    output_hash: done ? 'a'.repeat(64) : null,
    correlation_id: 'c-exec',
    invocation,
  };
}

interface Counters {
  readonly previews: Invocation[];
  readonly executions: { key: string | null; body: Invocation }[];
  readonly identityStarts: unknown[];
}

interface MockConfig {
  readonly counters: Counters;
  readonly connected?: boolean;
  /** `search-api`가 `/gh/*`를 등록하지 않았다. */
  readonly unavailable?: boolean;
  /** 이력 목록. */
  readonly history?: readonly Record<string, unknown>[];
}

const DEFAULT_INVOCATION: Invocation = { capability_id: 'pr.list', context: { repository: 'acme/payments' }, flags: { '--state': 'closed', '--limit': '7' }, output: { json_fields: ['number', 'title'] } };

async function installRoutes(page: Page, config: MockConfig): Promise<void> {
  const { counters } = config;
  const connected = config.connected ?? true;
  let nextId = 900;
  const created = new Map<number, Invocation>();

  const json = (route: Route, status: number, body: unknown): Promise<void> => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

  /*
   * **한 핸들러가 전부 받는다.** Playwright는 나중에 등록한 라우트를 먼저 매칭하므로 경로마다
   * 따로 두면 `/executions`가 `/executions/901/stream`까지 삼킨다 (FLOW-008이 같은 함정을 적었다).
   */
  await page.route('**/api/gh/**', async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();

    if (config.unavailable === true) return json(route, 404, { message: `Route ${method}:${path} not found`, error: 'Not Found', statusCode: 404 });

    if (path === '/api/gh/identity' && method === 'GET') return json(route, 200, connected ? CONNECTED : NOT_CONNECTED);
    if (path === '/api/gh/identity' && method === 'POST') {
      counters.identityStarts.push(request.postDataJSON());
      return json(route, 201, { authorize_url: 'https://ghe.test/login/oauth/authorize?client_id=ops&state=s1', state: 's1', correlation_id: 'c-start' });
    }
    if (path === '/api/gh/identity' && method === 'DELETE') return json(route, 200, { status: 'revoked', correlation_id: 'c-del' });
    if (path === '/api/gh/capabilities') return json(route, 200, CAPABILITIES);
    if (path === '/api/gh/contexts/repositories') return json(route, 200, REPOSITORIES);

    if (path === '/api/gh/executions/preview') {
      const invocation = request.postDataJSON() as Invocation;
      counters.previews.push(invocation);
      return json(route, 200, previewOf(invocation, connected));
    }
    if (path === '/api/gh/executions' && method === 'POST') {
      const invocation = request.postDataJSON() as Invocation;
      const key = request.headers()['idempotency-key'] ?? null;
      counters.executions.push({ key, body: invocation });
      if (!connected) return json(route, 401, { error: { code: 'GH_IDENTITY_REQUIRED', message: '연결이 없다', detail: { reason: 'not_connected' } }, correlation_id: 'c-401' });
      nextId += 1;
      created.set(nextId, invocation);
      return json(route, 202, executionOf(nextId, invocation, 'queued'));
    }
    if (path === '/api/gh/executions' && method === 'GET') {
      return json(route, 200, { items: config.history ?? [], next_before: null, correlation_id: 'c-list' });
    }

    const stream = /^\/api\/gh\/executions\/(\d+)\/stream$/.exec(path);
    if (stream !== null) {
      const id = Number(stream[1]);
      const invocation = created.get(id) ?? DEFAULT_INVOCATION;
      const events = [
        `event: state\ndata: ${JSON.stringify(executionOf(id, invocation, 'running'))}\n\n`,
        `event: state\ndata: ${JSON.stringify(executionOf(id, invocation, 'succeeded'))}\n\n`,
        `event: done\ndata: ${JSON.stringify({ execution_id: id, state: 'succeeded' })}\n\n`,
      ].join('');
      return route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache' }, body: events });
    }
    const cancel = /^\/api\/gh\/executions\/(\d+)\/cancel$/.exec(path);
    if (cancel !== null) {
      const id = Number(cancel[1]);
      return json(route, 202, executionOf(id, created.get(id) ?? DEFAULT_INVOCATION, 'cancelled'));
    }
    const detail = /^\/api\/gh\/executions\/(\d+)$/.exec(path);
    if (detail !== null) {
      const id = Number(detail[1]);
      const fromHistory = (config.history ?? []).find((item) => item['execution_id'] === id);
      return json(route, 200, fromHistory ?? executionOf(id, created.get(id) ?? DEFAULT_INVOCATION, 'succeeded'));
    }
    return json(route, 404, { error: { code: 'NOT_FOUND', message: '없다' }, correlation_id: 'c-404' });
  });

  // GHE 인가 화면 대역 — 브라우저가 실제로 여기로 이동하는지만 본다.
  await page.route('https://ghe.test/**', (route: Route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>GHE mock</title><h1 data-testid="ghe-authorize">GHE authorize</h1>' }));
}

function counters(): Counters {
  return { previews: [], executions: [], identityStarts: [] };
}

test.describe('W-010 GitHub Command Center', () => {
  test('배포가 껐으면 오류가 아니라 「열리지 않았다」가 보인다 (DEV-589)', async ({ page }) => {
    await installRoutes(page, { counters: counters(), unavailable: true });
    await page.goto('/gh');
    await expect(page.getByTestId('gh-command-center')).toHaveAttribute('data-state', 'unavailable');
    await expect(page.getByText('이 배포에서는 GitHub 작업이 열리지 않았습니다')).toBeVisible();
  });

  test('연결이 없으면 연결 버튼이 보이고, 누르면 서버가 준 인가 URL로 이동한다 (FR-GH-008 AC-2, QA-GH-12)', async ({ page }) => {
    const c = counters();
    await installRoutes(page, { counters: c, connected: false });
    await page.goto('/gh');
    await expect(page.getByTestId('gh-identity')).toHaveAttribute('data-status', 'not_connected');
    await expect(page.getByTestId('gh-execute')).toBeDisabled();

    await page.getByTestId('gh-identity-connect').click();
    await expect(page.getByTestId('ghe-authorize')).toBeVisible();
    expect(page.url()).toContain('https://ghe.test/login/oauth/authorize');
    expect(c.identityStarts).toEqual([{ return_to: '/gh' }]);
  });

  test('저장소 → 폼 → 미리보기 argv → 실행 → 스트림 → 결과 표 (사용자 흐름 전체)', async ({ page }) => {
    const c = counters();
    await installRoutes(page, { counters: c });
    await page.goto('/gh');

    // 미지원 command가 사유와 함께 보인다 (QA-GH-01).
    await expect(page.getByTestId('gh-capability-others')).toContainText('gh pr merge');
    await expect(page.getByTestId('gh-capability-others')).toContainText('이 판이 열지 않은 capability');

    // 저장소를 고르기 전에는 미리보기가 없고 실행 버튼이 닫혀 있다.
    await expect(page.getByTestId('gh-preview')).toHaveAttribute('data-ready', 'false');
    await expect(page.getByTestId('gh-execute')).toBeDisabled();

    await page.getByTestId('gh-repository').selectOption('acme/payments');
    await page.getByTestId('gh-state').selectOption('closed');
    await page.getByTestId('gh-limit').fill('5');

    await expect(page.getByTestId('gh-preview')).toHaveAttribute('data-ready', 'true');
    await expect(page.getByTestId('gh-preview-argv')).toHaveText(`gh pr list --repo ghe.test/acme/payments --state closed --limit 5 --json ${JSON_FIELDS.join(',')}`);
    // 비밀 값은 미리보기에 없다 (QA-GH-04).
    await expect(page.getByTestId('gh-preview-env')).toContainText('GH_ENTERPRISE_TOKEN=<redacted>');
    await expect(page.getByTestId('gh-effective-context')).toContainText('@alice');

    await expect(page.getByTestId('gh-execute')).toBeEnabled();
    await page.getByTestId('gh-execute').click();

    // 실행 본문은 마지막 미리보기 본문과 같다 (QA-GH-05의 화면 쪽 절반).
    await expect.poll(() => c.executions.length).toBe(1);
    expect(c.executions[0]?.body).toEqual(c.previews[c.previews.length - 1]);
    expect(c.executions[0]?.key).toMatch(/^web-[0-9a-f]{32}$/);

    // 스트림이 상태를 흘리고 결과가 표로 닿는다. 심은 마크업은 텍스트다 (QA-GH-24).
    await expect(page.getByTestId('gh-execution-panel')).toHaveAttribute('data-state', 'succeeded', { timeout: 10_000 });
    await expect(page.getByTestId('gh-result-row')).toHaveCount(2);
    await expect(page.getByTestId('gh-result-title').first()).toHaveText('Fix race <script>alert(1)</script>');
    expect(await page.locator('[data-testid="gh-execution-panel"] script').count()).toBe(0);
    await expect(page.getByTestId('gh-execution-status')).toContainText('성공');
  });

  test('위반이 있으면 실행 버튼이 닫히고 미리보기 요청이 서버로 나가지 않는다 (QA-GH-02)', async ({ page }) => {
    const c = counters();
    await installRoutes(page, { counters: c });
    await page.goto('/gh');
    await page.getByTestId('gh-repository').selectOption('acme/payments');
    await expect(page.getByTestId('gh-preview')).toHaveAttribute('data-ready', 'true');
    const before = c.previews.length;

    await page.getByTestId('gh-limit').fill('0');
    await expect(page.getByTestId('gh-violation-limit')).toBeVisible();
    await expect(page.getByTestId('gh-execute')).toBeDisabled();
    await expect(page.getByTestId('gh-preview')).toHaveAttribute('data-ready', 'false');
    // 디바운스 시간을 넉넉히 넘긴 뒤에도 요청 수가 같다.
    await page.waitForTimeout(800);
    expect(c.previews.length).toBe(before);
  });

  test('같은 버튼을 두 번 눌러도 실행 요청은 하나다 (QA-GH-14)', async ({ page }) => {
    const c = counters();
    await installRoutes(page, { counters: c });
    await page.goto('/gh');
    await page.getByTestId('gh-repository').selectOption('acme/payments');
    await expect(page.getByTestId('gh-execute')).toBeEnabled();
    await page.getByTestId('gh-execute').dblclick();
    await expect(page.getByTestId('gh-execution-panel')).toBeVisible();
    await page.waitForTimeout(300);
    expect(c.executions).toHaveLength(1);
  });

  test('인가 실패로 돌아오면 안내가 보이고 다시 연결할 수 있다', async ({ page }) => {
    await installRoutes(page, { counters: counters(), connected: false });
    await page.goto('/gh?identity=failed');
    await expect(page.getByText('GitHub 계정 연결에 실패했습니다')).toBeVisible();
    await expect(page.getByTestId('gh-identity-connect')).toBeVisible();
  });
});

test.describe('W-021 실행 이력', () => {
  const HISTORY = [executionOf(41, DEFAULT_INVOCATION, 'succeeded'), executionOf(40, { ...DEFAULT_INVOCATION, flags: { '--state': 'open', '--limit': '30' } }, 'cancelled')];

  test('이력 표 → 행 선택 → 결과 패널', async ({ page }) => {
    await installRoutes(page, { counters: counters(), history: HISTORY });
    await page.goto('/gh/history');
    await expect(page.getByTestId('gh-history-row')).toHaveCount(2);
    // 역할이 없으면 전체 보기 스위치를 그리지 않는다 (THR-004).
    await expect(page.getByTestId('gh-history-all')).toHaveCount(0);

    await page.getByTestId('gh-history-select').first().click();
    await expect(page.getByTestId('gh-execution-panel')).toHaveAttribute('data-state', 'succeeded');
    await expect(page.getByTestId('gh-result-row')).toHaveCount(2);
  });

  test('「같은 구성으로 다시 실행」은 새 미리보기의 초기값이 된다 — 실행을 만들지 않는다 (FR-GH-012 AC-4)', async ({ page }) => {
    const c = counters();
    await installRoutes(page, { counters: c, history: HISTORY });
    await page.goto('/gh/history');
    const rerun = page.getByTestId('gh-history-rerun').first();
    await expect(rerun).toHaveAttribute('href', /^\/gh\?prefill=/);
    await rerun.click();

    await expect(page).toHaveURL(/\/gh\?prefill=/);
    await expect(page.getByTestId('gh-repository')).toHaveValue('acme/payments');
    await expect(page.getByTestId('gh-state')).toHaveValue('closed');
    await expect(page.getByTestId('gh-limit')).toHaveValue('7');
    // 미리보기는 새로 만들어지고, 실행은 사용자가 누르기 전에는 없다.
    await expect(page.getByTestId('gh-preview')).toHaveAttribute('data-ready', 'true');
    await expect(page.getByTestId('gh-preview-argv')).toContainText('--state closed --limit 7 --json number,title');
    expect(c.executions).toHaveLength(0);
    await expect(page.getByTestId('gh-execution-panel')).toHaveCount(0);
  });
});
