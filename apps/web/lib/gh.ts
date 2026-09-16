/**
 * W-010·W-021의 화면 판정 (WP-077 / FR-GH-002·003·006·012, CR-086).
 *
 * **순수 모듈이다.** 컴포넌트 안에 판정을 흩뿌리지 않는다 — `ops-jobs.ts`·`audit.ts`가
 * 같은 이유로 이 자리에 있다.
 *
 * ## 폼 검증 규칙은 UI가 소유하지 않는다 (FR-GH-003 AC-8, W-010 규칙)
 *
 * 옵션의 열거값·범위·JSON 필드 허용 목록은 `API-GH-001`이 준 capability 정의에서 읽고,
 * 판정은 서버와 **같은 함수**(`@prs/gh-cli`의 `evaluateInvocation`)로 한다. 여기서
 * 규칙을 다시 쓰면 두 판정이 갈리고, 갈라진 쪽이 느슨하면 그것이 우회 경로다.
 *
 * ## 실행 결과는 서버가 준 것만 그린다
 *
 * 화면이 stdout을 파싱하지 않는다. typed 결과(`result.rows`)와 무해화된 발췌를
 * 그대로 그린다 — 원시 HTML을 만들지 않는다 (ADR-018).
 */

import { evaluateInvocation, type GhCapabilityDefinition, type GhConstraintViolation, type GhInvocation } from '@prs/gh-cli';
import { GATE_TEXT, type ExecutionGateView } from './gh-policy';
import { serviceMessage } from './service-message';

/** `API-GH-001`이 내는 capability 하나. 서버가 snake_case로 준다. */
export interface CapabilityView {
  readonly id: string;
  readonly path: readonly string[];
  readonly title: string;
  readonly risk: string;
  readonly support: string;
  readonly execution: string;
  readonly required_permissions: readonly string[];
  readonly options: GhCapabilityDefinition['options'];
  readonly constraints: GhCapabilityDefinition['constraints'];
  /** 실행기가 구현한 결과 adapter (CR-089). 옛 배포의 응답에는 없다. */
  readonly result_adapter?: GhCapabilityDefinition['resultAdapter'];
  /** 결과 계약 요약. 결과의 뜻은 서버가 분류에서 준다 — 화면이 다시 정하지 않는다. */
  readonly result_contract?: {
    readonly kind: string;
    readonly sensitivity: string;
    readonly composability: string;
    readonly bindable: boolean;
    readonly resource_kind: string | null;
  } | null;
  readonly timeout_ms: number;
  /** 실행 판정 (CR-090). 옛 배포의 응답에는 없다 — 그때는 미리보기의 판정만 본다. */
  readonly execution_gate?: ExecutionGateView | null;
}

/** `API-GH-001`의 command 목록 한 줄 — 실행이 열리지 않은 것도 사유와 함께. */
export interface CommandView {
  readonly id: string;
  readonly path: readonly string[];
  readonly summary: string;
  readonly section: string;
  readonly alias_of: readonly string[] | null;
  readonly support: string;
  readonly execution: string;
  readonly execution_reason: string | null;
  readonly risk: string | null;
  /** 분류 요약 (CR-088). 옛 배포의 응답에는 없다 — 없으면 그리지 않는다. */
  readonly interaction?: string | null;
  readonly side_effect?: string | null;
  readonly host_support?: string | null;
}

export interface CapabilitiesResponse {
  readonly gh_version: string;
  readonly manifest_version: string;
  readonly manifest_hash: string;
  readonly coverage: { readonly leafCommands: number; readonly executableCommands: number; readonly unclassifiedLeafCommands: number };
  readonly capabilities: readonly CapabilityView[];
  readonly commands: readonly CommandView[];
}

export interface RepositoryContextView {
  readonly repository_id: number;
  readonly repository: string;
  readonly visibility: string;
}

export interface IdentityView {
  readonly status: 'connected' | 'not_connected' | 'expired' | 'revoked' | 'host_changed';
  readonly host: string | null;
  readonly github_login: string | null;
  readonly connected_at: string | null;
  readonly expires_at: string | null;
}

export interface PreviewView {
  readonly capability_id: string;
  readonly risk: string;
  readonly argv: readonly string[];
  readonly env: readonly { readonly key: string; readonly value: string }[];
  readonly context: {
    readonly host: string;
    readonly repository: string;
    readonly github_actor: string | null;
    readonly identity_status: string;
    readonly gh_version: string;
    readonly manifest_version: string;
    readonly manifest_hash: string;
    readonly required_permissions: readonly string[];
    readonly permission_check: string;
    readonly policy: string;
    readonly timeout_ms: number;
  };
  /** 실행 판정 (CR-090). 허용이 아니면 그 사유가 `blockers`의 맨 앞에 온다. */
  readonly gate?: ExecutionGateView;
  readonly executable: boolean;
  readonly blockers: readonly string[];
}

/** `pr_list_v2`에서는 `number` 필드를 고르지 않았으면 `null`이다. `pr_list_v1` 기록은 늘 번호가 있다. */
export interface PrRowView {
  readonly number: number | null;
  readonly title: string | null;
  readonly state: string | null;
  readonly url: string | null;
  readonly author: string | null;
  readonly headRefName: string | null;
  readonly baseRefName: string | null;
  readonly isDraft: boolean | null;
  readonly createdAt: string | null;
  readonly updatedAt: string | null;
}

export interface ExecutionView {
  readonly execution_id: number;
  readonly state: string;
  readonly capability_id: string;
  readonly risk: string;
  readonly repository: string | null;
  readonly host: string;
  readonly github_actor: string;
  readonly argv: readonly string[];
  readonly env_keys: readonly string[];
  readonly gh_version: string;
  readonly manifest_version: string;
  readonly requested_at: string;
  readonly started_at: string | null;
  readonly finished_at: string | null;
  readonly cancel_requested_at: string | null;
  readonly exit_code: number | null;
  readonly error: string | null;
  readonly result: {
    readonly schema?: string;
    readonly rows?: readonly PrRowView[];
    readonly row_count?: number;
    readonly possibly_more?: boolean;
    readonly stdout_truncated?: boolean;
    /** `pr_list_v2`의 PR 참조 (CR-089). `pr_list_v1` 기록에는 없다 — 옛 기록을 다시 해석하지 않는다. */
    readonly references?: {
      readonly status: 'available' | 'unavailable';
      readonly reason: string | null;
      readonly refs: readonly { readonly host: string; readonly kind: string; readonly repository: string | null; readonly number: number | null }[];
    };
  } | null;
  readonly stdout: { readonly text: string | null; readonly truncated: boolean } | null;
  readonly stderr: { readonly text: string | null; readonly truncated: boolean } | null;
  readonly output_binary: boolean;
  readonly correlation_id: string;
  /** 요청 당시의 invocation. 「같은 구성으로 다시 실행」의 재료다 (FR-GH-012 AC-4). */
  readonly invocation?: Record<string, unknown>;
}

/** `API-GH-010` 목록 응답. `next_before`가 있으면 그 ID 앞의 페이지가 더 있다. */
export interface ExecutionListResponse {
  readonly items: readonly ExecutionView[];
  readonly next_before: number | null;
}

export const TERMINAL_STATES: readonly string[] = ['succeeded', 'failed', 'cancelled', 'timed_out', 'policy_blocked'];

export function isTerminal(state: string): boolean {
  return TERMINAL_STATES.includes(state);
}

const STATE_LABELS: Readonly<Record<string, string>> = {
  queued: 'Queued',
  preflighting: 'Preflight checks',
  awaiting_confirmation: 'Awaiting confirmation',
  awaiting_approval: 'Awaiting approval',
  running: 'Running',
  succeeded: 'Succeeded',
  failed: 'Failed',
  cancelled: 'Canceled',
  timed_out: 'Timed out',
  policy_blocked: 'Policy blocked',
};

export function stateLabel(state: string): string {
  return STATE_LABELS[state] ?? state;
}

const IDENTITY_LABELS: Readonly<Record<IdentityView['status'], string>> = {
  connected: 'Connected',
  not_connected: 'Not connected',
  expired: 'Expired — reconnect required',
  revoked: 'Disconnected',
  host_changed: 'Connected to a different GHE — reconnect required',
};

export function identityLabel(status: IdentityView['status']): string {
  return IDENTITY_LABELS[status];
}

/** 폼 상태. 문자열로 들고 있다가 검증 시점에 invocation으로 옮긴다. */
export interface PrListFormState {
  readonly repository: string;
  readonly state: string;
  readonly limit: string;
  readonly jsonFields: readonly string[];
}

export function defaultFormState(capability: CapabilityView | null, repository = ''): PrListFormState {
  const state = capability?.options.find((option) => option.kind === 'enum');
  const limit = capability?.options.find((option) => option.kind === 'int');
  const json = capability?.options.find((option) => option.kind === 'json_fields');
  return {
    repository,
    state: state?.kind === 'enum' ? state.defaultValue : 'open',
    limit: limit?.kind === 'int' ? String(limit.defaultValue) : '30',
    jsonFields: json?.kind === 'json_fields' ? [...json.defaultValue] : [],
  };
}

/** 폼 → invocation. 서버가 받는 모양 그대로다. */
export function toInvocation(capability: CapabilityView, form: PrListFormState): GhInvocation {
  const stateFlag = capability.options.find((option) => option.kind === 'enum')?.flag ?? '--state';
  const limitFlag = capability.options.find((option) => option.kind === 'int')?.flag ?? '--limit';
  return {
    capability_id: capability.id,
    context: { repository: form.repository },
    flags: { [stateFlag]: form.state, [limitFlag]: form.limit },
    output: { json_fields: form.jsonFields },
  };
}

/**
 * 즉시 검증 (FR-GH-003 AC-1). **서버와 같은 함수다.**
 *
 * `CapabilityView`는 정의의 필드 이름만 다르므로(snake_case) 정의 모양으로 옮겨 넣는다.
 */
export function validateForm(capability: CapabilityView, form: PrListFormState): readonly GhConstraintViolation[] {
  const definition: GhCapabilityDefinition = {
    id: capability.id,
    path: capability.path,
    title: capability.title,
    risk: capability.risk as GhCapabilityDefinition['risk'],
    support: capability.support as GhCapabilityDefinition['support'],
    execution: capability.execution as GhCapabilityDefinition['execution'],
    interaction: 'web_native',
    requiredPermissions: capability.required_permissions,
    options: capability.options,
    constraints: capability.constraints,
    // 폼 검증(evaluateInvocation)은 결과 adapter를 읽지 않는다 — 옛 응답이면 구현 adapter 자리를 채울 뿐이다.
    resultAdapter: capability.result_adapter ?? { mode: 'json', adapter: 'native_json', schema: 'unknown', outputPort: 'unknown' },
    timeoutMs: capability.timeout_ms,
  };
  const outcome = evaluateInvocation(definition, toInvocation(capability, form));
  return outcome.ok ? [] : outcome.violations;
}

/** 실행 버튼을 열어도 되는가 — 폼이 유효하고 미리보기가 실행 가능하다고 답했을 때만. */
export function canExecute(violations: readonly GhConstraintViolation[], preview: PreviewView | null): boolean {
  return violations.length === 0 && preview !== null && preview.executable;
}

/** 새 중복 방지 키. 제출마다 하나이며, 결과가 오면 다음 제출을 위해 다시 만든다. */
export function newIdempotencyKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return `web-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * 이력의 「같은 구성으로 다시 실행」이 W-010에 넘기는 값 (FR-GH-012 AC-4).
 *
 * invocation만 넘긴다 — 실행 ID나 승인 여부는 넘기지 않는다. 받는 쪽은 그것으로 **새 미리보기와
 * 새 실행**을 만들 뿐이며, 과거 실행의 승인이나 결과를 승계하지 않는다.
 */
export function encodePrefill(invocation: Record<string, unknown>): string {
  return encodeURIComponent(JSON.stringify(invocation));
}

/**
 * `?prefill=`을 invocation으로 읽는다. 모양이 조금이라도 다르면 `null`이다.
 *
 * URL은 외부 입력이다 — 여기서 받은 값은 폼의 초기값이 될 뿐이고, 판정은 폼 값과 똑같이
 * `validateForm`(서버와 같은 함수)을 지난다. 키를 더 받지 않는 것이 요점이다.
 */
export function parsePrefill(raw: string | null): GhInvocation | null {
  if (raw === null || raw === '') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const record = parsed as Record<string, unknown>;
  const capabilityId = record['capability_id'];
  const context = record['context'];
  const repository = typeof context === 'object' && context !== null ? (context as Record<string, unknown>)['repository'] : undefined;
  const flags = record['flags'];
  const output = record['output'];
  const jsonFields = typeof output === 'object' && output !== null ? (output as Record<string, unknown>)['json_fields'] : undefined;
  if (typeof capabilityId !== 'string' || typeof repository !== 'string') return null;
  if (typeof flags !== 'object' || flags === null || Array.isArray(flags)) return null;
  if (!Array.isArray(jsonFields) || !jsonFields.every((field) => typeof field === 'string')) return null;
  const safeFlags: Record<string, string> = {};
  for (const [flag, value] of Object.entries(flags as Record<string, unknown>)) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') safeFlags[flag] = String(value);
  }
  return { capability_id: capabilityId, context: { repository }, flags: safeFlags, output: { json_fields: jsonFields as string[] } };
}

/** invocation → 폼 초기값. 정의에 없는 flag는 버린다 — 폼이 그릴 수 없는 값은 초기값이 될 수 없다. */
export function formFromInvocation(capability: CapabilityView, invocation: GhInvocation): PrListFormState {
  const base = defaultFormState(capability, invocation.context.repository);
  const enumOption = capability.options.find((option) => option.kind === 'enum');
  const intOption = capability.options.find((option) => option.kind === 'int');
  const stateValue = enumOption === undefined ? undefined : invocation.flags[enumOption.flag];
  const limitValue = intOption === undefined ? undefined : invocation.flags[intOption.flag];
  return {
    ...base,
    state: typeof stateValue === 'string' ? stateValue : base.state,
    limit: typeof limitValue === 'string' || typeof limitValue === 'number' ? String(limitValue) : base.limit,
    jsonFields: invocation.output.json_fields.length > 0 ? [...invocation.output.json_fields] : base.jsonFields,
  };
}

/** 401 응답의 `detail.login_path`. 프록시가 넣어 준다 — 화면이 로그인 경로를 짐작하지 않는다. */
export function loginPathOf(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null;
  const error = (body as Record<string, unknown>)['error'];
  if (typeof error !== 'object' || error === null) return null;
  const detail = (error as Record<string, unknown>)['detail'];
  if (typeof detail !== 'object' || detail === null) return null;
  const path = (detail as Record<string, unknown>)['login_path'];
  // 절대 경로만. `//host`·`/\host`는 브라우저가 외부 출처로 해석하므로 거른다 (`sanitizeReturnPath`와 같은 규율).
  return typeof path === 'string' && path.startsWith('/') && !path.startsWith('//') && !path.startsWith('/\\') ? path : null;
}

/** 오류 DTO에서 사용자에게 보일 한 줄. 코드는 서버가 정한 것이며 여기서는 옮기기만 한다. */
export function describeApiError(body: unknown, fallback: string): { readonly message: string; readonly code: string | null; readonly correlationId: string | null } {
  if (typeof body !== 'object' || body === null) return { message: fallback, code: null, correlationId: null };
  const record = body as Record<string, unknown>;
  const correlationId = typeof record['correlation_id'] === 'string' ? record['correlation_id'] : null;
  const error = record['error'];
  if (typeof error !== 'object' || error === null) return { message: fallback, code: null, correlationId };
  const code = typeof (error as Record<string, unknown>)['code'] === 'string' ? ((error as Record<string, unknown>)['code'] as string) : null;
  const message = serviceMessage((error as Record<string, unknown>)['message'], fallback, code);
  return { message, code, correlationId };
}

/** argv를 사람이 읽을 한 줄로. 공백이 있는 항목은 따옴표로 감싼다 — 표시용이며 실행에 쓰지 않는다. */
export function formatArgv(argv: readonly string[]): string {
  return ['gh', ...argv].map((item) => (/[\s"']/.test(item) ? JSON.stringify(item) : item)).join(' ');
}

/** 결과의 사실 상태. 「부분 출력」과 「0건」과 「실패」를 가른다 (지시서 12장). */
export type ResultKind = 'pending' | 'rows' | 'empty' | 'truncated' | 'failed' | 'cancelled' | 'timed_out' | 'binary';

export function resultKind(execution: ExecutionView): ResultKind {
  if (!isTerminal(execution.state)) return 'pending';
  if (execution.state === 'cancelled') return 'cancelled';
  if (execution.state === 'timed_out') return 'timed_out';
  if (execution.output_binary) return 'binary';
  if (execution.state !== 'succeeded') return 'failed';
  if (execution.result?.stdout_truncated === true || execution.stdout?.truncated === true) return 'truncated';
  const rows = execution.result?.rows ?? [];
  return rows.length === 0 ? 'empty' : 'rows';
}

/** 실패 사유를 사용자 말로. 서버의 사유 코드가 정본이며 여기서는 옮기기만 한다. */
export function describeError(error: string | null): string {
  if (error === null) return '';
  if (error === 'identity_required' || error === 'identity_expired' || error === 'identity_revoked') return 'Your GitHub connection is missing or expired. Reconnect before running this command.';
  if (error === 'registry_stale') return 'The runner\'s gh or manifest has changed since the request. Refresh and run again.';
  // 운영 정책이 닫은 요청 (CR-090) — 상태는 `policy_blocked`이며 다시 실행되지 않는다.
  if (error === 'admin_action_required' || error === 'policy_blocked' || error === 'policy_changed') return `${GATE_TEXT[error].title}. ${GATE_TEXT[error].description}`;
  if (error === 'registry_evidence_expired' || error === 'registry_unchecked') return `${GATE_TEXT[error].title}. ${GATE_TEXT[error].description}`;
  if (error === 'argv_mismatch') return 'The command changed after the request was saved. Run it again.';
  if (error === 'executor_lost') return 'The run was reclaimed because the runner stopped responding.';
  if (error === 'gh_auth_required') return 'gh requested authentication. GHE may have rejected the delegated token.';
  if (error.startsWith('gh_exit_')) return `gh exited with code ${error.slice('gh_exit_'.length)}. Check standard error.`;
  if (error.startsWith('result_parse_failed')) return 'The output did not match the result contract. Standard output may be truncated or have a different format.';
  if (error.startsWith('timed_out')) return 'The process was terminated after exceeding the time limit.';
  return error;
}
