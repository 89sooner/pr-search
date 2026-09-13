/**
 * A-006 gh capability·버전 레지스트리의 화면 판정 (WP-078 / FR-GH-001 AC-5·AC-6, FR-GH-011 AC-2·AC-3, NFR-009, CR-088).
 *
 * **순수 모듈이다.** 컴포넌트 안에 판정을 흩뿌리지 않는다 — `gh.ts`·`ops-jobs.ts`가 같은 이유로 이 자리에 있다.
 *
 * ## 화면은 수치를 다시 세지 않는다
 *
 * 커버리지·게이트·실행 허용 수는 `API-GH-013`이 `@prs/gh-cli`의 검증기에서 계산해 준 값이다. 여기서 다른
 * 공식으로 세면 CLI·API·화면이 갈린다. 이 모듈이 하는 것은 **상태의 뜻을 가르는 것**뿐이다 — 기록 없음·
 * 미완(incomplete)·지남(overdue)·드리프트·오류·통과를 서로 다르게 보여야 하고, 「0개 정상」과 「없음」을
 * 섞지 않아야 한다.
 */

export type RegistryStatus = 'passed' | 'incomplete' | 'drift' | 'failed' | 'error';

export interface DimensionView {
  readonly id: string;
  readonly label: string;
  readonly gate: string;
  readonly total: number;
  readonly classified: number;
  readonly unclassified: number;
  readonly unclassifiedSample: readonly string[];
  readonly note: string;
}

export interface GateView {
  readonly id: string;
  readonly label: string;
  readonly pass: boolean;
  readonly dimensions: readonly string[];
  readonly detail: string;
}

export interface VerificationView {
  readonly verification_id: number;
  readonly snapshot_id: number;
  readonly checked_at: string;
  readonly checked_by: 'gh-executor' | 'ci' | 'cli' | string;
  readonly trigger: string;
  readonly status: RegistryStatus | string;
  readonly gh_version_expected: string;
  readonly gh_version_observed: string | null;
  readonly binary_sha256_expected: string;
  readonly binary_sha256_observed: string | null;
  readonly manifest_hash_expected: string;
  readonly manifest_hash_observed: string | null;
  readonly inventory_hash_expected: string;
  readonly inventory_hash_observed: string | null;
  readonly validator_version: string;
  readonly rules_version: string;
  readonly drift: { readonly addedCommands: readonly string[]; readonly removedCommands: readonly string[]; readonly changedCommands: readonly string[] } | null;
  readonly error: string | null;
  readonly report_hash: string;
  readonly matches_served_manifest: boolean;
  readonly environment: Record<string, unknown>;
}

export interface SnapshotView {
  readonly snapshot_id: number;
  readonly gh_version: string;
  readonly manifest_version: string;
  readonly manifest_hash: string;
  readonly inventory_hash: string;
  readonly leaf_command_count: number;
  readonly unclassified_count: number;
  readonly executable_count: number;
  readonly first_seen_at: string;
  readonly activated_at: string | null;
  readonly is_served: boolean;
}

/** `API-GH-013`의 응답. 서버가 snake_case로 준다. */
export interface RegistryStatusView {
  readonly gh: { readonly pinned_version: string; readonly binary_sha256_expected: string };
  readonly manifest: {
    readonly version: string;
    readonly hash: string;
    readonly generated_at: string;
    readonly inventory_hash: string;
    readonly hash_verified: boolean;
    readonly command_count: number;
    readonly leaf_command_count: number;
    readonly group_command_count: number;
    readonly alias_only_command_count: number;
    readonly help_topics: number;
  };
  readonly validator: { readonly version: string; readonly rules_version: string; readonly status: RegistryStatus | string };
  readonly coverage: {
    readonly classified_leaf_commands: number;
    readonly unclassified_leaf_commands: number;
    readonly executable_commands: number;
    readonly dimensions: readonly DimensionView[];
  };
  readonly gates: readonly GateView[];
  readonly execution: { readonly allowed: readonly string[]; readonly definitions: readonly string[] };
  readonly findings: { readonly errors: number; readonly gaps: number; readonly infos: number; readonly sample: readonly { readonly code: string; readonly severity: string; readonly subject: string; readonly message: string }[] };
  readonly verification: {
    readonly check_interval_ms: number;
    readonly latest_by_source: readonly VerificationView[];
    readonly recent: readonly VerificationView[];
    readonly executor_matches_served_manifest: boolean | null;
  };
  readonly snapshots: readonly SnapshotView[];
  readonly host_verification: { readonly status: string; readonly note: string };
}

export interface FlagClassificationView {
  readonly name: string;
  readonly inherited: boolean;
  readonly control: string;
  readonly valueKind: string;
  readonly enumValues: readonly string[] | null;
  readonly basis: { readonly source: string; readonly rule: string | null; readonly evidence: string };
}

export interface PositionalClassificationView {
  readonly placeholder: string;
  readonly required: boolean;
  readonly variadic: boolean;
  readonly control: string;
  readonly binding: string | null;
  readonly basis: { readonly source: string; readonly rule: string | null; readonly evidence: string };
}

/** `API-GH-014`의 응답. */
export interface CommandDetailView {
  readonly id: string;
  readonly path: readonly string[];
  readonly summary: string;
  readonly usage: string;
  readonly section: string;
  readonly aliases: readonly string[];
  readonly alias_of: readonly string[] | null;
  readonly group: boolean;
  readonly help_status: string;
  readonly support: string;
  readonly execution: string;
  readonly execution_reason: string | null;
  readonly risk: string | null;
  readonly json_fields: readonly string[];
  readonly classification: {
    readonly support: string;
    readonly interaction: string;
    readonly risk: string | null;
    readonly sideEffect: string;
    readonly auth: string;
    readonly io: {
      readonly stdin: string;
      readonly fileInputFlags: readonly string[];
      readonly fileOutputFlags: readonly string[];
      readonly outputFormats: readonly string[];
      readonly contexts: readonly string[];
      readonly paginated: boolean;
    };
    readonly resultKind: string;
    readonly sensitivity: string;
    readonly hostSupport: string;
    readonly positionals: readonly PositionalClassificationView[];
    readonly flags: readonly FlagClassificationView[];
    readonly basis: { readonly source: string; readonly rule: string | null; readonly evidence: string };
    readonly notes: readonly string[];
  } | null;
  readonly definition: { readonly id: string } | null;
}

/* ------------------------------------------------------------------ 라벨 */

export const SUPPORT_LABEL: Readonly<Record<string, string>> = {
  supported: '지원',
  preview: '미리보기(gh preview)',
  policy_blocked: '정책 차단',
  terminal_only: '터미널 전용',
  requires_extension: 'extension plane',
  requires_local_workspace: '작업 트리 필요',
  unsupported_by_host: '호스트 미지원',
  admin_only: '관리자 전용',
  unknown: '미분류',
};

export const EXECUTION_LABEL: Readonly<Record<string, string>> = {
  allowed: '실행 가능',
  not_implemented: '아직 열리지 않음',
  policy_blocked: '정책 차단',
};

export const INTERACTION_LABEL: Readonly<Record<string, string>> = {
  web_native: '웹 폼',
  web_equivalent: '웹 등가',
  sandbox_terminal: '격리 터미널',
  terminal_only: '터미널 전용',
  policy_blocked: '정책 차단',
  unsupported_by_host: '호스트 미지원',
  unknown: '미분류',
};

export const SIDE_EFFECT_LABEL: Readonly<Record<string, string>> = {
  read: '읽기',
  write: '쓰기',
  destructive: '파괴적',
  local: '로컬(실행 호스트)',
  arbitrary: '입력에 따라 다름',
  unknown: '미분류',
};

export const CONTROL_LABEL: Readonly<Record<string, string>> = {
  mapped_to_typed_control: 'typed 컨트롤',
  mapped_to_generic_control: '일반 컨트롤',
  mapped_to_web_equivalent: '웹 등가',
  terminal_only: '터미널 전용',
  policy_blocked: '정책 차단',
  unsupported_by_host: '호스트 미지원',
  requires_admin_approval: '승인 필요',
  unknown: '미분류',
};

export const STATUS_LABEL: Readonly<Record<string, string>> = {
  passed: '통과',
  incomplete: '미완(게이트 미달)',
  drift: '드리프트',
  failed: '실패',
  error: '오류',
  unchecked: '미검사',
};

export function label(table: Readonly<Record<string, string>>, value: string | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return table[value] ?? value;
}

/* ------------------------------------------------------------- 상태 판정 */

/**
 * 화면 머리의 한 줄 판정. 「기록 없음」은 상태가 아니라 부재다 — 0개 정상으로 그리지 않는다.
 *
 * 우선순위: 실행기 기록이 있으면 그것이 정본(실행을 실제로 거절하는 쪽이다). 실행기 기록이 없고 CI·CLI
 * 기록만 있으면 그것을 보이되 「실행기 미검사」를 함께 말한다.
 */
export type RegistryHeadline =
  | { readonly kind: 'no_records'; readonly validatorStatus: string }
  | { readonly kind: 'executor_unchecked'; readonly other: VerificationView; readonly validatorStatus: string }
  | { readonly kind: 'executor'; readonly latest: VerificationView; readonly overdue: boolean; readonly servedMismatch: boolean };

export function registryHeadline(view: RegistryStatusView, now: Date): RegistryHeadline {
  const latest = view.verification.latest_by_source;
  if (latest.length === 0) return { kind: 'no_records', validatorStatus: view.validator.status };
  const executor = latest.find((one) => one.checked_by === 'gh-executor');
  if (executor === undefined) return { kind: 'executor_unchecked', other: latest[0]!, validatorStatus: view.validator.status };
  return {
    kind: 'executor',
    latest: executor,
    overdue: isOverdue(executor.checked_at, view.verification.check_interval_ms, now),
    servedMismatch: !executor.matches_served_manifest,
  };
}

/** 마지막 검사가 주기의 두 배를 넘겼는가 — 실행기가 죽었거나 검사가 멈춘 것이다. */
export function isOverdue(checkedAt: string, intervalMs: number, now: Date): boolean {
  const at = Date.parse(checkedAt);
  if (Number.isNaN(at)) return true;
  return now.getTime() - at > intervalMs * 2;
}

/** 배지 톤. 서버의 상태 문자열을 그대로 옮긴다 — 화면이 판정을 만들지 않는다. */
export function statusTone(status: string): 'success' | 'warning' | 'danger' | 'neutral' {
  if (status === 'passed') return 'success';
  if (status === 'incomplete') return 'warning';
  if (status === 'drift' || status === 'failed' || status === 'error') return 'danger';
  return 'neutral';
}

/** 차원의 백분율 문자열. 분모 0은 백분율이 아니라 「정의되지 않음」이다. */
export function percentOf(dimension: Pick<DimensionView, 'total' | 'classified'>): string {
  if (dimension.total === 0) return 'n/a';
  return `${String(Math.floor((dimension.classified / dimension.total) * 1000) / 10)}%`;
}

/* ---------------------------------------------------------- command 탐색 */

export interface CommandListItem {
  readonly id: string;
  readonly path: readonly string[];
  readonly summary: string;
  readonly section: string;
  readonly alias_of: readonly string[] | null;
  readonly support: string;
  readonly execution: string;
  readonly execution_reason: string | null;
  readonly risk: string | null;
  readonly interaction?: string | null;
  readonly side_effect?: string | null;
  readonly host_support?: string | null;
}

export interface CommandFilter {
  readonly query: string;
  readonly support: string | 'all';
  readonly execution: string | 'all';
}

export const EMPTY_FILTER: CommandFilter = { query: '', support: 'all', execution: 'all' };

export function filterCommands(commands: readonly CommandListItem[], filter: CommandFilter): readonly CommandListItem[] {
  const needle = filter.query.trim().toLowerCase();
  return commands.filter((command) => {
    if (filter.support !== 'all' && command.support !== filter.support) return false;
    if (filter.execution !== 'all' && command.execution !== filter.execution) return false;
    if (needle === '') return true;
    return command.path.join(' ').includes(needle) || command.id.includes(needle) || command.summary.toLowerCase().includes(needle);
  });
}

/** 지원 상태별 건수 — 목록 위의 요약. 순서는 SUPPORT_LABEL의 순서다. */
export function countBy<T extends string>(commands: readonly CommandListItem[], key: (command: CommandListItem) => T): readonly { readonly value: T; readonly count: number }[] {
  const counts = new Map<T, number>();
  for (const command of commands) counts.set(key(command), (counts.get(key(command)) ?? 0) + 1);
  return [...counts.entries()].sort((left, right) => right[1] - left[1] || String(left[0]).localeCompare(String(right[0]))).map(([value, count]) => ({ value, count }));
}

/** 해시의 앞 12자 — 표시용. 전체는 title 속성으로 둔다. */
export function shortHash(hash: string | null): string {
  if (hash === null || hash === '') return '—';
  return hash.length > 12 ? `${hash.slice(0, 12)}…` : hash;
}
