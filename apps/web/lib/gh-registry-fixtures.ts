/**
 * A-006 시험 픽스처 (WP-078 / CR-088 · WP-079 / CR-089). **시험 전용이다** — 제품 코드가 가져오지 않는다.
 *
 * 응답 모양은 `API-GH-013`·`API-GH-014`의 필드 이름 그대로다. 목이 응답을 지어내면 계약 버그를 숨긴다.
 * 수치·결과 계약·간선은 커밋된 manifest(r0.3)의 실측을 옮겼다 — 차원·간선은 전부가 아니라 대표만이고 차원 설명(note)은 줄였다.
 * `gh-registry-fixtures.test.ts`가 manifest를 다시 계산해 옮긴 값이 같은지 건다. 옛 판(r0.2) 응답은
 * `REGISTRY_STATUS_LEGACY`가 따로 그린다.
 */

import type { CommandDetailView, ContractSummaryView, DimensionView, GraphEdgeView, RegistryStatusView, ResultContractView, VerificationView } from './gh-registry';

export const MANIFEST_HASH = '13623d63cb18e5b7a4c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3';
export const OTHER_HASH = 'ad00027d84b9915e5127867a778df29b1d164bb88b8e5e15d6be2c9ab820dab2';

export const DIMENSIONS: readonly DimensionView[] = [
  { id: 'command_path', label: 'core command path 분류율', gate: 'GATE-GH-01', total: 196, classified: 196, unclassified: 0, unclassifiedSample: [], note: '분모는 leaf 196개' },
  { id: 'positional', label: 'positional argument 분류율', gate: 'GATE-GH-01', total: 164, classified: 164, unclassified: 0, unclassifiedSample: [], note: 'USAGE 줄의 자리' },
  { id: 'command_flag', label: 'command 고유 flag 분류율', gate: 'GATE-GH-01', total: 1034, classified: 1034, unclassified: 0, unclassifiedSample: [], note: '모든 command의 FLAGS 절' },
  { id: 'result_contract', label: '결과 계약 분류율', gate: 'GATE-GH-01d', total: 196, classified: 196, unclassified: 0, unclassifiedSample: [], note: '분모는 leaf 196개' },
  { id: 'output_port', label: '출력 port 분류율', gate: 'GATE-GH-01d', total: 32, classified: 32, unclassified: 0, unclassifiedSample: [], note: '분모는 port 수가 아니라 bindable leaf 32개(출력 port 36개)' },
  { id: 'input_port', label: '입력 port 분류율', gate: 'GATE-GH-01d', total: 80, classified: 80, unclassified: 0, unclassifiedSample: [], note: '분모는 대상 자원 자리를 가진 leaf 80개(입력 port 81개)' },
  { id: 'host_support', label: '대상 GHES 지원 확인', gate: 'informational', total: 196, classified: 0, unclassified: 196, unclassifiedSample: ['agent-task create'], note: '사내 확인 0' },
  { id: 'graph_edges', label: 'capability 그래프 간선 수', gate: 'informational', total: 398, classified: 398, unclassified: 0, unclassifiedSample: [], note: '조건부 398 · 직접 0' },
  { id: 'executable_flows', label: '실행 가능한 다단계 흐름 수', gate: 'informational', total: 0, classified: 0, unclassified: 0, unclassifiedSample: [], note: '다단계 실행(Recipe)은 열리지 않았다' },
];

/** 옛 판(r0.2) 응답의 01d — bindability가 정의에만 있어 미달이었다. */
export const LEGACY_DIMENSIONS: readonly DimensionView[] = [
  { id: 'command_path', label: 'core command path 분류율', gate: 'GATE-GH-01', total: 196, classified: 196, unclassified: 0, unclassifiedSample: [], note: '분모는 leaf 196개' },
  { id: 'bindability', label: 'bindability 분류율', gate: 'GATE-GH-01d', total: 196, classified: 1, unclassified: 195, unclassifiedSample: ['agent-task create', 'agent-task list', 'alias delete', 'api', 'attestation download', 'auth login'], note: '정의에만 있다' },
  { id: 'io_port', label: '입력·출력 port 분류율', gate: 'GATE-GH-01d', total: 0, classified: 0, unclassified: 0, unclassifiedSample: [], note: 'bindable capability 없음' },
];

export const CONTRACTS: ContractSummaryView = {
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

export function verification(overrides: Partial<VerificationView> = {}): VerificationView {
  return {
    verification_id: 7,
    snapshot_id: 1,
    checked_at: '2026-09-14T03:00:00.000Z',
    checked_by: 'gh-executor',
    trigger: 'startup',
    status: 'passed',
    gh_version_expected: '2.97.0',
    gh_version_observed: '2.97.0',
    binary_sha256_expected: '141507c337e8b202ad398550c3b73d72f5af92e86f71665214538a81efd4c409',
    binary_sha256_observed: '141507c337e8b202ad398550c3b73d72f5af92e86f71665214538a81efd4c409',
    manifest_hash_expected: MANIFEST_HASH,
    manifest_hash_observed: MANIFEST_HASH,
    inventory_hash_expected: 'b'.repeat(64),
    inventory_hash_observed: 'b'.repeat(64),
    validator_version: 'validator-2026-09-14.2',
    rules_version: 'rules-2026-09-14.3',
    drift: null,
    error: null,
    report_hash: 'c'.repeat(64),
    matches_served_manifest: true,
    environment: { executor_id: 'exec-1:100:abcd', hostname: 'exec-1' },
    report_version: 'r2',
    contract_dimensions: 'verified',
    ...overrides,
  };
}

export function registryStatus(overrides: Partial<RegistryStatusView> = {}): RegistryStatusView {
  return {
    gh: { pinned_version: '2.97.0', binary_sha256_expected: '141507c337e8b202ad398550c3b73d72f5af92e86f71665214538a81efd4c409' },
    manifest: {
      version: 'r0.3',
      hash: MANIFEST_HASH,
      generated_at: '2026-09-14T02:30:00.000Z',
      inventory_hash: 'b'.repeat(64),
      hash_verified: true,
      command_count: 229,
      leaf_command_count: 196,
      group_command_count: 32,
      alias_only_command_count: 1,
      help_topics: 8,
    },
    validator: { version: 'validator-2026-09-14.2', rules_version: 'rules-2026-09-14.3', report_version: 'r2', status: 'passed' },
    coverage: { classified_leaf_commands: 196, unclassified_leaf_commands: 0, executable_commands: 1, dimensions: DIMENSIONS },
    gates: [
      { id: 'GATE-GH-01', label: 'capability 커버리지 (NFR-009 본표)', pass: true, dimensions: ['command_path', 'positional', 'command_flag'], detail: '차원 전부 100%' },
      { id: 'GATE-GH-01b', label: 'core / extension 분리 보고', pass: true, dimensions: ['extension_split'], detail: '차원 전부 100%' },
      { id: 'GATE-GH-01d', label: '결과 계약 커버리지 (CR-009)', pass: true, dimensions: ['result_contract', 'bindability', 'resource_type', 'secret_output', 'output_port', 'input_port'], detail: '차원 전부 100%' },
    ],
    execution: { allowed: ['pr.list'], definitions: ['pr.list'] },
    contracts: CONTRACTS,
    gate_scope: 'GATE-GH-01·01b·01d만 판정한다. 01d 통과는 REL-007 완료가 아니다 — 01e·06·08과 대상 GHES 지원 확인은 판정하지 않았다',
    findings: { errors: 0, gaps: 0, infos: 1, sample: [{ code: 'help_auth_required', severity: 'info', subject: 'extension exec', message: '--help가 인증을 요구한다' }] },
    verification: {
      check_interval_ms: 86_400_000,
      latest_by_source: [verification()],
      recent: [verification()],
      executor_matches_served_manifest: true,
    },
    snapshots: [
      {
        snapshot_id: 1,
        gh_version: '2.97.0',
        manifest_version: 'r0.3',
        manifest_hash: MANIFEST_HASH,
        inventory_hash: 'b'.repeat(64),
        leaf_command_count: 196,
        unclassified_count: 0,
        executable_count: 1,
        first_seen_at: '2026-09-14T03:00:00.000Z',
        activated_at: null,
        is_served: true,
      },
    ],
    host_verification: { status: 'not_verified', note: '사내 GHES에서 실제로 확인한 command가 없다.' },
    ...overrides,
  };
}

/** 기록이 하나도 없는 배포 — 「0개 정상」이 아니라 「없음」으로 그려야 한다. */
export const REGISTRY_STATUS_EMPTY: RegistryStatusView = registryStatus({
  verification: { check_interval_ms: 86_400_000, latest_by_source: [], recent: [], executor_matches_served_manifest: null },
  snapshots: [],
});

/** 실행기가 드리프트를 확인한 배포. */
export const REGISTRY_STATUS_DRIFT: RegistryStatusView = registryStatus({
  verification: {
    check_interval_ms: 86_400_000,
    latest_by_source: [
      verification({ verification_id: 9, trigger: 'periodic', status: 'drift', inventory_hash_observed: 'e'.repeat(64), drift: { addedCommands: ['pr frobnicate'], removedCommands: [], changedCommands: ['pr list'] } }),
    ],
    recent: [],
    executor_matches_served_manifest: true,
  },
});

/** 옛 판 API의 응답에는 `contracts`·`gate_scope` **키가 없다** — `undefined` 값을 넣은 객체와 달리 옛 API가 실제로 낸 모양이다. */
function withoutContractSummary(view: RegistryStatusView): RegistryStatusView {
  const legacy: { -readonly [K in keyof RegistryStatusView]?: RegistryStatusView[K] } = { ...view };
  delete legacy.contracts;
  delete legacy.gate_scope;
  return legacy as RegistryStatusView;
}

const LEGACY_BASE: RegistryStatusView = registryStatus({
  manifest: { ...registryStatus().manifest, version: 'r0.2' },
  validator: { version: 'validator-2026-09-14.1', rules_version: 'rules-2026-09-14.2', status: 'incomplete' },
  coverage: { classified_leaf_commands: 196, unclassified_leaf_commands: 0, executable_commands: 1, dimensions: LEGACY_DIMENSIONS },
  gates: [
    { id: 'GATE-GH-01', label: 'capability 커버리지 (NFR-009 본표)', pass: true, dimensions: ['command_path'], detail: '차원 전부 100%' },
    { id: 'GATE-GH-01d', label: '결과 계약 커버리지 (CR-009)', pass: false, dimensions: ['bindability', 'io_port'], detail: '미달 2개: bindability 1/196, io_port 0/0' },
  ],
  verification: {
    check_interval_ms: 86_400_000,
    latest_by_source: [verification({ status: 'incomplete', validator_version: 'validator-2026-09-14.1', rules_version: 'rules-2026-09-14.2', report_version: 'r1', contract_dimensions: 'not_in_report_version' })],
    recent: [],
    executor_matches_served_manifest: true,
  },
});

/** 옛 판(r0.2) API의 응답 — 결과 계약 요약이 없고, 검증 기록은 r1 보고서라 결과 계약 차원을 검증하지 않았다. */
export const REGISTRY_STATUS_LEGACY: RegistryStatusView = withoutContractSummary(LEGACY_BASE);

const PR_LIST_CONTRACT: ResultContractView = {
  kind: 'resource_list',
  sensitivity: 'internal',
  composability: 'partially_bindable',
  bindable: true,
  resourceKind: 'pull_request',
  resourceBasis: 'gh v2.97.0 pkg/cmd/pr/list/list.go:213 PR 배열을 쓴다 · 빈 결과도 `[]`(:203) · `number`는 GraphQL Int!',
  outputs: [
    {
      mode: 'text',
      kind: 'text',
      adapter: 'opaque_text',
      schema: null,
      unstructuredReason: '기본 출력은 사람이 읽는 표·요약이다 — 구조는 --json(--format json) 모드에만 있다',
      bindable: false,
      reason: '기본 출력에는 식별 필드의 구조가 없다',
    },
    {
      mode: 'json',
      kind: 'resource_list',
      adapter: 'native_json',
      schema: 'pr_list_v2',
      unstructuredReason: null,
      bindable: true,
      reason: null,
    },
    {
      mode: 'jq',
      kind: 'text',
      adapter: 'opaque_text',
      schema: null,
      unstructuredReason: 'jq 표현식의 결과는 표현식이 정한다 — 모양을 보장하지 않는다 (pkg/cmdutil/json_flags.go:233-242)',
      bindable: false,
      reason: '임의 표현식의 출력은 typed 바인딩의 source가 될 수 없다 (ADR-020)',
    },
    {
      mode: 'template',
      kind: 'text',
      adapter: 'opaque_text',
      schema: null,
      unstructuredReason: 'Go 템플릿 출력은 텍스트다 (pkg/cmdutil/json_flags.go:243-250)',
      bindable: false,
      reason: '임의 템플릿의 출력은 typed 바인딩의 source가 될 수 없다 (ADR-020)',
    },
    {
      mode: 'web',
      kind: 'exit_status',
      adapter: 'exit_status',
      schema: null,
      unstructuredReason: '브라우저를 여는 모드다 — 구조화된 결과가 없고(안내 문구는 stderr나 TTY 전용 stdout으로 나가며, gist create는 비TTY stdout에 안내 한 줄을 쓴다) 실행기에는 브라우저가 없다 (ADR-019)',
      bindable: false,
      reason: '구조화된 결과가 없다',
    },
  ],
  inputPorts: [],
  outputPorts: [
    {
      id: 'pull_requests',
      direction: 'output',
      type: 'pull_request',
      cardinality: 'many',
      required: true,
      nullable: false,
      sensitivity: 'internal',
      conditions: [
        {
          code: 'output_mode',
          detail: '`--json`으로 실행한 결과여야 한다 — 기본 출력(표)·--jq·--template에는 port가 없다',
        },
        {
          code: 'json_fields_selected',
          detail: 'number',
        },
      ],
      source: {
        adapter: 'native_json',
        mode: 'json',
        schema: 'pr_list_v2',
        pointer: '',
        identity: {
          slot: 'number',
          field: 'number',
          repositoryPath: null,
        },
      },
      slot: null,
      basis: {
        source: 'rule',
        rule: 'json-identity',
        evidence: 'gh v2.97.0 pkg/cmd/pr/list/list.go:213 PR 배열을 쓴다 · 빈 결과도 `[]`(:203) · `number`는 GraphQL Int!',
      },
    },
  ],
  inputPortsNote: '대상 자원을 받는 자리가 없다 — positional이 없고 저장소·호스트는 실행 컨텍스트가 정한다',
  outputPortsNote: null,
  basis: {
    source: 'override',
    rule: 'result-contract',
    evidence: 'gh v2.97.0 · pkg/cmd/pr/list/list.go:213 PR 배열을 쓴다 · 빈 결과도 `[]`(:203) · `number`는 GraphQL Int!',
  },
};

const PR_LIST_TO_VIEW_EDGE: GraphEdgeView = {
  from: 'pr.list',
  fromPort: 'pull_requests',
  to: 'pr.view',
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

export const COMMAND_DETAIL_PR_LIST: CommandDetailView = {
  id: 'pr.list',
  path: ['pr', 'list'],
  summary: 'List pull requests in a repository <script>alert(1)</script>',
  usage: 'gh pr list [flags]',
  section: 'CORE COMMANDS',
  aliases: ['pr ls'],
  alias_of: null,
  group: false,
  help_status: 'ok',
  support: 'supported',
  execution: 'allowed',
  execution_reason: null,
  risk: 'R0',
  json_fields: ['number', 'title', 'state'],
  classification: {
    support: 'supported',
    interaction: 'web_native',
    risk: 'R0',
    sideEffect: 'read',
    auth: 'token',
    io: { stdin: 'none', fileInputFlags: [], fileOutputFlags: [], outputFormats: ['text', 'json', 'jq', 'template', 'web'], contexts: ['repository'], paginated: true },
    resultKind: 'resource_list',
    sensitivity: 'internal',
    hostSupport: 'unverified',
    positionals: [],
    flags: [
      { name: 'state', inherited: false, control: 'mapped_to_typed_control', valueKind: 'enum', enumValues: ['open', 'closed', 'merged', 'all'], basis: { source: 'rule', rule: 'enum-from-help', evidence: '--state string  Filter by state: {open|closed|merged|all}' } },
      { name: 'web', inherited: false, control: 'mapped_to_web_equivalent', valueKind: 'bool', enumValues: null, basis: { source: 'rule', rule: 'web-flag', evidence: '--web  List pull requests in the web browser' } },
      { name: 'repo', inherited: true, control: 'mapped_to_typed_control', valueKind: 'selector', enumValues: null, basis: { source: 'rule', rule: 'selector-flag', evidence: '--repo [HOST/]OWNER/REPO' } },
    ],
    basis: { source: 'override', rule: 'commands-table', evidence: 'help: 「List pull requests in a repository」 — R0 첫 수직이 여는 유일한 command (CR-086)' },
    notes: ['`--web`은 브라우저를 연다 — 실행기에서는 열 수 없고 웹 등가(URL)로만 표현한다 (ADR-019)'],
  },
  definition: { id: 'pr.list' },
  result_contract: PR_LIST_CONTRACT,
  graph: {
    outgoing: [PR_LIST_TO_VIEW_EDGE],
    incoming: [],
    blocked: [],
    executable_flows: 0,
  },
};

const AUTH_TOKEN_CONTRACT: ResultContractView = {
  kind: 'text',
  sensitivity: 'secret',
  composability: 'secret_non_bindable',
  bindable: false,
  resourceKind: null,
  resourceBasis: '결과가 비밀이다 — 값은 표시·저장·감사 본문·바인딩·stdin 전달 어디로도 흐르지 않는다 (SRS 9.8 2항)',
  outputs: [
    {
      mode: 'text',
      kind: 'text',
      adapter: 'secret_non_bindable',
      schema: null,
      unstructuredReason: '결과가 비밀이다 — 값은 표시·저장·감사 본문·바인딩·stdin 전달 어디로도 흐르지 않는다 (SRS 9.8 2항)',
      bindable: false,
      reason: '결과가 비밀이다 — 값은 표시·저장·감사 본문·바인딩·stdin 전달 어디로도 흐르지 않는다 (SRS 9.8 2항)',
    },
  ],
  inputPorts: [],
  outputPorts: [],
  inputPortsNote: '대상 자원을 받는 자리가 없다 — positional이 없고 저장소·호스트는 실행 컨텍스트가 정한다',
  outputPortsNote: '결과가 비밀이다 — 값은 표시·저장·감사 본문·바인딩·stdin 전달 어디로도 흐르지 않는다 (SRS 9.8 2항)',
  basis: {
    source: 'override',
    rule: 'result-contract',
    evidence: 'gh v2.97.0 · 결과가 비밀이다 — 값은 표시·저장·감사 본문·바인딩·stdin 전달 어디로도 흐르지 않는다 (SRS 9.8 2항)',
  },
};

export const COMMAND_DETAIL_AUTH_TOKEN: CommandDetailView = {
  id: 'auth.token',
  path: ['auth', 'token'],
  summary: 'Print the authentication token gh uses for a hostname and account',
  usage: 'gh auth token [flags]',
  section: 'GENERAL COMMANDS',
  aliases: [],
  alias_of: null,
  group: false,
  help_status: 'ok',
  support: 'policy_blocked',
  execution: 'policy_blocked',
  execution_reason: '이 제품이 열지 않기로 정한 command다 — help: 「This command outputs the authentication token for an account」',
  risk: 'R3',
  json_fields: [],
  classification: {
    support: 'policy_blocked',
    interaction: 'policy_blocked',
    risk: 'R3',
    sideEffect: 'read',
    auth: 'none',
    io: { stdin: 'none', fileInputFlags: [], fileOutputFlags: [], outputFormats: ['text'], contexts: ['none'], paginated: false },
    resultKind: 'text',
    sensitivity: 'secret',
    hostSupport: 'unverified',
    positionals: [],
    flags: [{ name: 'hostname', inherited: false, control: 'mapped_to_typed_control', valueKind: 'selector', enumValues: null, basis: { source: 'rule', rule: 'selector-flag', evidence: '--hostname string' } }],
    basis: { source: 'override', rule: 'commands-table', evidence: 'help: 「This command outputs the authentication token for an account」 — 결과가 비밀 그 자체다' },
    notes: [],
  },
  definition: null,
  result_contract: AUTH_TOKEN_CONTRACT,
  graph: { outgoing: [], incoming: [], blocked: [], executable_flows: 0 },
};
