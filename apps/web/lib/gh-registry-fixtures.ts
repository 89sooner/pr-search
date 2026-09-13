/**
 * A-006 시험 픽스처 (WP-078 / CR-088). **시험 전용이다** — 제품 코드가 가져오지 않는다.
 *
 * 응답 모양은 `API-GH-013`·`API-GH-014`의 필드 이름 그대로다. 목이 응답을 지어내면 계약 버그를 숨긴다.
 * 수치는 2026-09-14 커밋된 manifest(r0.2)의 실측에서 옮겼다 — 차원 전부가 아니라 대표 다섯이다.
 */

import type { CommandDetailView, DimensionView, RegistryStatusView, VerificationView } from './gh-registry';

export const MANIFEST_HASH = '13623d63cb18e5b7a4c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3';
export const OTHER_HASH = 'ad00027d84b9915e5127867a778df29b1d164bb88b8e5e15d6be2c9ab820dab2';

export const DIMENSIONS: readonly DimensionView[] = [
  { id: 'command_path', label: 'core command path 분류율', gate: 'GATE-GH-01', total: 196, classified: 196, unclassified: 0, unclassifiedSample: [], note: '분모는 leaf 196개' },
  { id: 'positional', label: 'positional argument 분류율', gate: 'GATE-GH-01', total: 164, classified: 164, unclassified: 0, unclassifiedSample: [], note: 'USAGE 줄의 자리' },
  { id: 'command_flag', label: 'command 고유 flag 분류율', gate: 'GATE-GH-01', total: 1034, classified: 1034, unclassified: 0, unclassifiedSample: [], note: '모든 command의 FLAGS 절' },
  { id: 'bindability', label: 'bindability 분류율', gate: 'GATE-GH-01d', total: 196, classified: 1, unclassified: 195, unclassifiedSample: ['agent-task create', 'agent-task list', 'alias delete', 'api', 'attestation download', 'auth login'], note: '정의에만 있다' },
  { id: 'io_port', label: '입력·출력 port 분류율', gate: 'GATE-GH-01d', total: 0, classified: 0, unclassified: 0, unclassifiedSample: [], note: 'bindable capability 없음' },
  { id: 'host_support', label: '대상 GHES 지원 확인', gate: 'informational', total: 196, classified: 0, unclassified: 196, unclassifiedSample: ['agent-task create'], note: '사내 확인 0' },
];

export function verification(overrides: Partial<VerificationView> = {}): VerificationView {
  return {
    verification_id: 7,
    snapshot_id: 1,
    checked_at: '2026-09-14T03:00:00.000Z',
    checked_by: 'gh-executor',
    trigger: 'startup',
    status: 'incomplete',
    gh_version_expected: '2.97.0',
    gh_version_observed: '2.97.0',
    binary_sha256_expected: '141507c337e8b202ad398550c3b73d72f5af92e86f71665214538a81efd4c409',
    binary_sha256_observed: '141507c337e8b202ad398550c3b73d72f5af92e86f71665214538a81efd4c409',
    manifest_hash_expected: MANIFEST_HASH,
    manifest_hash_observed: MANIFEST_HASH,
    inventory_hash_expected: 'b'.repeat(64),
    inventory_hash_observed: 'b'.repeat(64),
    validator_version: 'validator-2026-09-14.1',
    rules_version: 'rules-2026-09-14.1',
    drift: null,
    error: null,
    report_hash: 'c'.repeat(64),
    matches_served_manifest: true,
    environment: { executor_id: 'exec-1:100:abcd', hostname: 'exec-1' },
    ...overrides,
  };
}

export function registryStatus(overrides: Partial<RegistryStatusView> = {}): RegistryStatusView {
  return {
    gh: { pinned_version: '2.97.0', binary_sha256_expected: '141507c337e8b202ad398550c3b73d72f5af92e86f71665214538a81efd4c409' },
    manifest: {
      version: 'r0.2',
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
    validator: { version: 'validator-2026-09-14.1', rules_version: 'rules-2026-09-14.1', status: 'incomplete' },
    coverage: { classified_leaf_commands: 196, unclassified_leaf_commands: 0, executable_commands: 1, dimensions: DIMENSIONS },
    gates: [
      { id: 'GATE-GH-01', label: 'capability 커버리지 (NFR-009 본표)', pass: true, dimensions: ['command_path', 'positional', 'command_flag'], detail: '차원 전부 100%' },
      { id: 'GATE-GH-01b', label: 'core / extension 분리 보고', pass: true, dimensions: ['extension_split'], detail: '차원 전부 100%' },
      { id: 'GATE-GH-01d', label: '결과 계약 커버리지 (CR-009)', pass: false, dimensions: ['bindability', 'io_port'], detail: '미달 2개: bindability 1/196, io_port 0/0' },
    ],
    execution: { allowed: ['pr.list'], definitions: ['pr.list'] },
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
        manifest_version: 'r0.2',
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
    io: { stdin: 'none', fileInputFlags: [], fileOutputFlags: [], outputFormats: ['text', 'json', 'web'], contexts: ['repository'], paginated: true },
    resultKind: 'json',
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
};
