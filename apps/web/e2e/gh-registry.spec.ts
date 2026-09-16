import { expect, test, type Page, type Route } from '@playwright/test';

/**
 * A-006 gh capability·버전 레지스트리 (WP-078 DoD / QA-GH-32, FR-GH-001 AC-6, FR-GH-011 AC-3, CR-088).
 *
 * **실제 브라우저에서만 확인되는 것**만 둔다. 순수 판정은 `lib/gh-registry.test.ts`가, 렌더와 접근성은
 * `a11y/gh-registry.test.tsx`가 이미 건다. 여기서 거는 것은:
 *
 *   1. `/ops/gh-registry`가 실제로 열리고 신원·커버리지·게이트·기록이 보인다
 *   2. 검색이 목록을 좁히고, command를 고르면 상세 요청이 나가 flag 표가 그려진다
 *   3. 403은 no_permission, 404는 「열리지 않았다」 — 접근 권한 부족과 미수집을 가른다
 *   4. 상세에 결과 계약·입력 port·들어오는 간선이 그려지고, 간선은 「실행 미개방」이며 실행 버튼이 없다 (CR-089)
 *
 * e2e 서버는 `AUTH_ENABLED=false`라 역할이 없다 — 역할 판정은 API가 하고 여기서는 API 응답을 대신 준다.
 * 목의 응답은 `API-GH-013`·`API-GH-014`의 필드 이름 그대로다. 결과 계약·간선·요약 수치는 커밋된 manifest(r0.3)에서
 * 옮긴 실측이다 — 간선은 들어오는 9개 중 `pr list`에서 오는 하나만 싣는다.
 */

const HASH = '13623d63cb18e5b7a4c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3';

const VERIFICATION = {
  verification_id: 7,
  snapshot_id: 1,
  checked_at: '2026-09-14T03:00:00.000Z',
  checked_by: 'gh-executor',
  trigger: 'startup',
  status: 'passed',
  gh_version_expected: '2.97.0',
  gh_version_observed: '2.97.0',
  binary_sha256_expected: 'b'.repeat(64),
  binary_sha256_observed: 'b'.repeat(64),
  manifest_hash_expected: HASH,
  manifest_hash_observed: HASH,
  inventory_hash_expected: 'c'.repeat(64),
  inventory_hash_observed: 'c'.repeat(64),
  validator_version: 'validator-2026-09-14.2',
  rules_version: 'rules-2026-09-14.3',
  drift: null,
  error: null,
  report_hash: 'd'.repeat(64),
  matches_served_manifest: true,
  environment: { hostname: 'exec-1' },
  report_version: 'r2',
  contract_dimensions: 'verified',
};

const CONTRACTS = {
  resultContracts: {
    classified: 196,
    total: 196,
  },
  composability: [
    {
      value: 'fully_bindable',
      count: 0,
    },
    {
      value: 'partially_bindable',
      count: 32,
    },
    {
      value: 'terminal_result',
      count: 115,
    },
    {
      value: 'artifact_result',
      count: 3,
    },
    {
      value: 'opaque_result',
      count: 30,
    },
    {
      value: 'secret_non_bindable',
      count: 4,
    },
    {
      value: 'policy_blocked',
      count: 12,
    },
    {
      value: 'unsupported_by_host',
      count: 0,
    },
  ],
  outputPorts: {
    commands: 32,
    ports: 36,
  },
  inputPorts: {
    commands: 80,
    ports: 81,
  },
  adaptersImplemented: [
    'pr.list:pr_list_v2',
  ],
  executableCommands: [
    'pr.list',
  ],
  graph: {
    nodes: 196,
    outputPorts: 36,
    inputPorts: 81,
    edges: 398,
    direct: 0,
    conditional: 398,
    blockedSameType: 6,
    byType: [
      {
        type: 'codespace',
        edges: 24,
      },
      {
        type: 'discussion',
        edges: 12,
      },
      {
        type: 'repository',
        edges: 84,
      },
      {
        type: 'issue',
        edges: 102,
      },
      {
        type: 'pull_request',
        edges: 144,
      },
      {
        type: 'release',
        edges: 16,
      },
      {
        type: 'workflow_run',
        edges: 12,
      },
      {
        type: 'workflow',
        edges: 4,
      },
    ],
    executableFlows: 0,
  },
  executableFlows: 0,
  hostVerified: 0,
};

const STATUS = {
  gh: { pinned_version: '2.97.0', binary_sha256_expected: 'b'.repeat(64) },
  manifest: { version: 'r0.3', hash: HASH, generated_at: '2026-09-14T02:30:00.000Z', inventory_hash: 'c'.repeat(64), hash_verified: true, command_count: 229, leaf_command_count: 196, group_command_count: 32, alias_only_command_count: 1, help_topics: 8 },
  validator: { version: 'validator-2026-09-14.2', rules_version: 'rules-2026-09-14.3', report_version: 'r2', status: 'passed' },
  coverage: {
    classified_leaf_commands: 196,
    unclassified_leaf_commands: 0,
    executable_commands: 1,
    dimensions: [
      { id: 'command_path', label: 'core command path 분류율', gate: 'GATE-GH-01', total: 196, classified: 196, unclassified: 0, unclassifiedSample: [], note: 'leaf' },
      { id: 'command_flag', label: 'command 고유 flag 분류율', gate: 'GATE-GH-01', total: 1034, classified: 1034, unclassified: 0, unclassifiedSample: [], note: 'flags' },
      { id: 'result_contract', label: '결과 계약 분류율', gate: 'GATE-GH-01d', total: 196, classified: 196, unclassified: 0, unclassifiedSample: [], note: 'leaf' },
      { id: 'output_port', label: '출력 port 분류율', gate: 'GATE-GH-01d', total: 32, classified: 32, unclassified: 0, unclassifiedSample: [], note: 'bindable leaf 32개(출력 port 36개)' },
      { id: 'input_port', label: '입력 port 분류율', gate: 'GATE-GH-01d', total: 80, classified: 80, unclassified: 0, unclassifiedSample: [], note: '대상 자원 자리를 가진 leaf 80개(입력 port 81개)' },
    ],
  },
  gates: [
    { id: 'GATE-GH-01', label: 'capability 커버리지 (NFR-009 본표)', pass: true, dimensions: ['command_path', 'command_flag'], detail: '차원 전부 100%' },
    { id: 'GATE-GH-01b', label: 'core / extension 분리 보고', pass: true, dimensions: [], detail: '차원 전부 100%' },
    { id: 'GATE-GH-01d', label: '결과 계약 커버리지 (CR-009)', pass: true, dimensions: ['result_contract', 'bindability', 'resource_type', 'secret_output', 'output_port', 'input_port'], detail: '차원 전부 100%' },
  ],
  execution: { allowed: ['pr.list'], definitions: ['pr.list'] },
  contracts: CONTRACTS,
  gate_scope: 'GATE-GH-01·01b·01d만 판정한다. 01d 통과는 REL-007 완료가 아니다 — 01e·06·08과 대상 GHES 지원 확인은 판정하지 않았다',
  findings: { errors: 0, gaps: 0, infos: 0, sample: [] },
  verification: { check_interval_ms: 86_400_000, latest_by_source: [VERIFICATION], recent: [VERIFICATION], executor_matches_served_manifest: true },
  snapshots: [{ snapshot_id: 1, gh_version: '2.97.0', manifest_version: 'r0.3', manifest_hash: HASH, inventory_hash: 'c'.repeat(64), leaf_command_count: 196, unclassified_count: 0, executable_count: 1, first_seen_at: '2026-09-14T03:00:00.000Z', activated_at: null, is_served: true }],
  host_verification: { status: 'not_verified', note: '사내 GHES에서 확인한 command가 없다.' },
  correlation_id: 'c-reg',
};

const CAPABILITIES = {
  gh_version: '2.97.0',
  manifest_version: 'r0.3',
  manifest_hash: HASH,
  coverage: { leafCommands: 196, executableCommands: 1, unclassifiedLeafCommands: 0 },
  capabilities: [],
  commands: [
    { id: 'pr.list', path: ['pr', 'list'], summary: 'List pull requests in a repository', section: 'CORE COMMANDS', alias_of: null, support: 'supported', execution: 'allowed', execution_reason: null, risk: 'R0', interaction: 'web_native', side_effect: 'read', host_support: 'unverified', composability: 'partially_bindable' },
    { id: 'pr.merge', path: ['pr', 'merge'], summary: 'Merge a pull request', section: 'CORE COMMANDS', alias_of: null, support: 'supported', execution: 'not_implemented', execution_reason: 'REL-007 첫 수직 판이 아직 열지 않았다', risk: 'R2', interaction: 'web_native', side_effect: 'destructive', host_support: 'unverified', composability: 'terminal_result' },
    { id: 'auth.token', path: ['auth', 'token'], summary: 'Print the authentication token', section: 'GENERAL COMMANDS', alias_of: null, support: 'policy_blocked', execution: 'policy_blocked', execution_reason: '이 제품이 열지 않기로 정한 command다', risk: 'R3', interaction: 'policy_blocked', side_effect: 'read', host_support: 'unverified', composability: 'secret_non_bindable' },
  ],
  correlation_id: 'c-cap',
};

const PR_MERGE_CONTRACT = {
  kind: 'exit_status',
  sensitivity: 'internal',
  composability: 'terminal_result',
  bindable: false,
  resourceKind: null,
  resourceBasis: 'stdout에 결과가 없다 — 비TTY 실행기에서는 종료 코드만 의미가 있다',
  outputs: [
    {
      mode: 'text',
      kind: 'exit_status',
      adapter: 'exit_status',
      schema: null,
      unstructuredReason: 'stdout에 결과가 없다 — 비TTY에서 확인 문구는 stderr로만 나가거나 TTY에서만 찍힌다',
      bindable: false,
      reason: '종료 코드만 의미가 있다',
    },
  ],
  inputPorts: [
    {
      id: 'pull_request',
      direction: 'input',
      type: 'pull_request',
      cardinality: 'one',
      required: false,
      nullable: false,
      sensitivity: 'internal',
      conditions: [
        {
          code: 'slot_alternative',
          detail: '`<number>` 대안으로만 받는다. <url>는 gh가 URL을 직접 해석해 대상을 찾는 입력이라 참조로 채우지 않는다 — PR URL은 URL의 저장소·호스트로 --repo를 덮는다(pkg/cmd/pr/shared/finder.go:117-120). <branch>는 PullRequestRef의 식별자가 아니라 참조로 채우지 않는다.',
        },
        {
          code: 'same_repository',
          detail: '참조의 저장소가 이 실행의 --repo와 같아야 한다',
        },
      ],
      source: null,
      slot: {
        kind: 'positional',
        index: 0,
        placeholder: '<number> | <url> | <branch>',
        alternative: 'number',
      },
      basis: {
        source: 'rule',
        rule: 'subject-slot',
        evidence: 'gh v2.97.0 USAGE: gh pr merge [<number> | <url> | <branch>] [flags]',
      },
    },
  ],
  outputPorts: [],
  inputPortsNote: null,
  outputPortsNote: 'stdout에 결과가 없다 — 비TTY 실행기에서는 종료 코드만 의미가 있다',
  basis: {
    source: 'override',
    rule: 'result-contract',
    evidence: 'gh v2.97.0 · 주 종류: pkg/cmd/pr/merge/merge.go:492·500 메시지는 IO.ErrOut · stdout에 결과가 없다 — 비TTY 실행기에서는 종료 코드만 의미가 있다',
  },
};

const LIST_TO_MERGE_EDGE = {
  from: 'pr.list',
  fromPort: 'pull_requests',
  to: 'pr.merge',
  toPort: 'pull_request',
  type: 'pull_request',
  verdict: 'conditional',
  conditions: [
    {
      code: 'output_mode',
      detail: '`--json`으로 실행한 결과여야 한다 — 기본 출력(표)·--jq·--template에는 port가 없다',
    },
    {
      code: 'json_fields_selected',
      detail: 'number',
    },
    {
      code: 'slot_alternative',
      detail: '`<number>` 대안으로만 받는다. <url>는 gh가 URL을 직접 해석해 대상을 찾는 입력이라 참조로 채우지 않는다 — PR URL은 URL의 저장소·호스트로 --repo를 덮는다(pkg/cmd/pr/shared/finder.go:117-120). <branch>는 PullRequestRef의 식별자가 아니라 참조로 채우지 않는다.',
    },
    {
      code: 'same_repository',
      detail: '참조의 저장소가 이 실행의 --repo와 같아야 한다',
    },
    {
      code: 'explicit_selection',
      detail: '목록에서 원소 하나를 `/<index>`로 명시적으로 고른다 — 첫 원소를 자동으로 고르지 않는다',
    },
  ],
  execution: {
    from: 'allowed',
    to: 'not_implemented',
    executable: false,
    reason: '입력 쪽 command의 실행이 열리지 않았다(not_implemented) · 다단계 실행(Recipe)은 열리지 않았다 (FR-GH-005) — 호환 판정은 실행 승인이 아니다',
  },
};

const DETAIL_PR_MERGE = {
  id: 'pr.merge',
  path: ['pr', 'merge'],
  summary: 'Merge a pull request',
  usage: 'gh pr merge [<number> | <url> | <branch>] [flags]',
  section: 'CORE COMMANDS',
  aliases: [],
  alias_of: null,
  group: false,
  help_status: 'ok',
  support: 'supported',
  execution: 'not_implemented',
  execution_reason: 'REL-007 첫 수직 판이 아직 열지 않았다',
  risk: 'R2',
  json_fields: [],
  classification: {
    support: 'supported',
    interaction: 'web_native',
    risk: 'R2',
    sideEffect: 'destructive',
    auth: 'token',
    io: { stdin: 'none', fileInputFlags: [], fileOutputFlags: [], outputFormats: ['text'], contexts: ['repository'], paginated: false },
    resultKind: 'exit_status',
    sensitivity: 'internal',
    hostSupport: 'unverified',
    positionals: [{ placeholder: '<number> | <url> | <branch>', required: false, variadic: false, control: 'mapped_to_typed_control', binding: 'value', basis: { source: 'rule', rule: 'selector-placeholder', evidence: '<number> | <url> | <branch>' } }],
    flags: [
      { name: 'admin', inherited: false, control: 'requires_admin_approval', valueKind: 'bool', enumValues: null, basis: { source: 'rule', rule: 'admin-approval-flag', evidence: '--admin  Use administrator privileges to merge' } },
      { name: 'squash', inherited: false, control: 'mapped_to_typed_control', valueKind: 'bool', enumValues: null, basis: { source: 'rule', rule: 'bool-flag', evidence: '--squash  Squash the commits' } },
    ],
    basis: { source: 'override', rule: 'commands-table', evidence: 'help: 「Merge a pull request」 — 병합은 되돌리기 어렵고 `--admin`은 보호 규칙을 넘는다' },
    notes: ['--admin은(는) 확인을 건너뛰거나 보호를 넘는다 — 관리자 승인 경로가 있어야 연다 (FR-GH-009)'],
  },
  definition: null,
  result_contract: PR_MERGE_CONTRACT,
  graph: {
    outgoing: [],
    incoming: [LIST_TO_MERGE_EDGE],
    blocked: [],
    executable_flows: 0,
  },
  correlation_id: 'c-detail',
};

interface MockConfig {
  readonly registryStatus?: number;
  readonly detailCalls: string[];
}

async function installRoutes(page: Page, config: MockConfig): Promise<void> {
  const json = (route: Route, status: number, body: unknown): Promise<void> => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  await page.route('**/api/gh/**', async (route: Route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/gh/registry') {
      if (config.registryStatus === 403) return json(route, 403, { error: { code: 'FORBIDDEN_ROLE', message: "'operator 또는 security_officer' 역할이 필요하다" }, correlation_id: 'c-403' });
      if (config.registryStatus === 404) return json(route, 404, { message: 'Route GET:/api/v1/gh/registry not found', error: 'Not Found', statusCode: 404 });
      return json(route, 200, STATUS);
    }
    if (path === '/api/gh/capabilities') return json(route, 200, CAPABILITIES);
    const detail = /^\/api\/gh\/registry\/commands\/(.+)$/.exec(path);
    if (detail !== null) {
      config.detailCalls.push(decodeURIComponent(detail[1] ?? ''));
      return json(route, 200, DETAIL_PR_MERGE);
    }
    return json(route, 404, { error: { code: 'NOT_FOUND', message: '없다' }, correlation_id: 'c-404' });
  });
}

test.describe('A-006 gh capability·버전 레지스트리', () => {
  test('신원·커버리지·게이트·기록이 보이고, 검색과 상세가 동작한다 (QA-GH-32)', async ({ page }) => {
    const detailCalls: string[] = [];
    await installRoutes(page, { detailCalls });
    await page.goto('/ops/gh-registry');
    const root = page.getByTestId('gh-registry');
    await expect(root).toHaveAttribute('data-state', 'ready');
    await expect(page.getByTestId('gh-registry-gh-version')).toHaveText('2.97.0');
    await expect(page.getByTestId('gh-registry-manifest')).toContainText('r0.3');
    await expect(page.getByTestId('gh-registry-execution')).toContainText('Enabled capabilities 1 items: pr.list');
    await expect(page.getByTestId('gh-registry-records-executor')).toHaveAttribute('data-status', 'passed');
    await expect(page.getByTestId('gh-registry-dimensions')).toContainText('1034/1034');
    await expect(page.getByTestId('gh-registry-gates').locator('[data-gate="GATE-GH-01d"]')).toHaveAttribute('data-pass', 'true');
    await expect(page.getByTestId('gh-registry-host')).toContainText("Unknown");
    // 결과 계약·연결 요약 (CR-089) — 분모가 다른 수치를 따로 보이고, 01d 통과가 REL-007 완료가 아니라고 말한다.
    const summary = page.getByTestId('gh-registry-contract-summary');
    await expect(summary.locator('[data-item="result_contracts"]')).toContainText('196/196');
    await expect(summary.locator('[data-item="executable"]')).toContainText('pr.list');
    await expect(summary.locator('[data-item="edges"]')).toContainText('398');
    await expect(summary.locator('[data-item="flows"]')).toContainText('0');
    await expect(page.getByTestId('gh-registry-gate-scope')).toContainText('does not complete REL-007');

    const list = page.getByTestId('gh-registry-command-list');
    await expect(list.getByRole('listitem')).toHaveCount(3);
    await page.getByTestId('gh-registry-search').fill('merge');
    await expect(list.getByRole('listitem')).toHaveCount(1);
    await page.getByTestId('gh-registry-command-pr.merge').click();
    await expect(page.getByTestId('gh-registry-detail-pr.merge')).toBeVisible();
    expect(detailCalls).toEqual(['pr.merge']);
    await expect(page.getByTestId('gh-registry-detail-pr.merge')).toContainText("Not enabled yet");
    await expect(page.getByTestId('gh-registry-detail-pr.merge')).toContainText("Approval required");
    await expect(page.getByTestId('gh-registry-detail-pr.merge')).toContainText("Destructive");

    // 결과 계약·입력 port·들어오는 간선 (CR-089) — 호환 판정과 실행 미개방을 함께 보이고, 상세에는 실행 버튼이 없다.
    const detail = page.getByTestId('gh-registry-detail-pr.merge');
    const contract = detail.getByTestId('gh-registry-contract');
    await expect(contract).toHaveAttribute('data-composability', 'terminal_result');
    await expect(contract.getByTestId('gh-registry-input-ports')).toContainText('PullRequestRef');
    await expect(contract.getByTestId('gh-registry-output-ports')).toContainText('stdout에 결과가 없다');
    const edge = contract.getByTestId('gh-registry-graph-incoming').locator('[data-edge="pr.list.pull_requests->pr.merge.pull_request"]');
    await expect(edge).toHaveAttribute('data-executable', 'false');
    await expect(edge).toContainText("Execution disabled");
    await expect(edge).toContainText("Explicit item selection");
    await expect(detail.getByRole('button')).toHaveCount(0);
  });

  test('403은 필요한 역할을 적은 no_permission이고, 404는 「열리지 않았다」다', async ({ page }) => {
    await installRoutes(page, { registryStatus: 403, detailCalls: [] });
    await page.goto('/ops/gh-registry');
    await expect(page.getByTestId('gh-registry')).toHaveAttribute('data-state', 'no_permission');
    await expect(page.getByText("The operator or security_officer role is required")).toBeVisible();

    await page.unrouteAll();
    await installRoutes(page, { registryStatus: 404, detailCalls: [] });
    await page.goto('/ops/gh-registry');
    await expect(page.getByTestId('gh-registry')).toHaveAttribute('data-state', 'unavailable');
    await expect(page.getByText("GitHub operations are not enabled in this deployment")).toBeVisible();
  });
});
