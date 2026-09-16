/**
 * 운영 정책 화면 모델 — A-006 운영 승인 · A-005 capability 차단(최소) · W-010 실행 판정 표시 (API-GH-008, CR-090).
 *
 * ## 판정을 다시 만들지 않는다
 *
 * 승인 자격과 실행 판정은 서버가 `@prs/gh-cli`의 한 식으로 계산해 사유 코드로 준다. 이 파일은 그 코드를 사람의 말로 옮기고
 * 요청 본문을 만들 뿐이다 — 화면이 「승인할 수 있다」「실행할 수 있다」를 스스로 정하면 두 판정이 갈린다. 버튼을 숨기는 것도
 * 방어가 아니다: 변경 권한은 서버가 요청마다 세션에서 다시 본다.
 *
 * ## 문구가 사실보다 넓어지지 않는다
 *
 * 운영 승인은 현재 배포 정의의 R0 범위에 대한 결정이다. 「전 기능 사용 가능」「사내 GHES 확인 완료」처럼 읽히는 말을 쓰지 않는다.
 * 차단은 이미 실행권을 받은 실행을 취소하지 않는다 — 그렇게 설명하지 않는다.
 */

import { GH_APPROVAL_INELIGIBLE_REASONS, GH_EXECUTION_GATE_REASONS, type GhApprovalIneligibleReason, type GhExecutionGateReason } from '@prs/gh-cli';
import { serviceMessage } from './service-message';

export const POLICY_URL = '/api/gh/policies';
export const POLICY_CHANGES_URL = '/api/gh/policies/changes';
export const POLICY_REASON_MAX = 500;

export type PolicyAction = 'approve' | 'revoke' | 'block' | 'resume';

/**
 * 운영 정책 변경 버튼을 그릴지. **판정이 아니다** — API-GH-008이 요청마다 세션의 `operator` 역할을 본다.
 *
 * 인증이 구성되지 않은 배포에서는 역할을 알 수 없다. 빈 목록을 「자격 없음」으로 읽으면 이 화면만 다르게 굴고(A-001 `pipelineAccess`와
 * 같은 판단), 그 배포에서는 `/gh/*` 자체가 등록되지 않거나 서버가 거절하므로 버튼이 무엇을 열지 않는다.
 */
export function canChangePolicy(roles: readonly string[], authEnabled: boolean): boolean {
  return !authEnabled || roles.includes('operator');
}

export interface ExecutionGateView {
  readonly allowed: boolean;
  readonly reason: GhExecutionGateReason | null;
  readonly detail: string | null;
  readonly revision: number | null;
}

export interface PolicyApprovalView {
  readonly snapshot_id: number;
  readonly verification_id: number;
  readonly report_hash: string;
  readonly manifest_version: string;
  readonly manifest_hash: string;
  readonly gh_version: string;
  readonly approved_at: string;
  readonly approved_by: string;
  readonly matches_served: boolean;
}

export interface PolicyRevisionView {
  readonly revision: number;
  readonly previous_revision: number;
  readonly action: PolicyAction;
  readonly capability_id: string | null;
  readonly snapshot_id: number | null;
  readonly verification_id: number | null;
  readonly report_hash: string | null;
  readonly manifest_version: string | null;
  readonly manifest_hash: string | null;
  readonly gh_version: string | null;
  readonly actor: string;
  readonly reason: string;
  readonly correlation_id: string;
  readonly created_at: string;
}

/** `API-GH-008` 조회 응답. */
export interface PolicyStatusView {
  readonly scope: string;
  readonly now: string;
  readonly served: {
    readonly gh_version: string;
    readonly pinned_version: string;
    readonly manifest_version: string;
    readonly manifest_hash: string;
    readonly inventory_hash: string;
    readonly report_version: string;
    readonly report_hash: string;
    readonly validator_version: string;
    readonly snapshot_id: number | null;
    readonly snapshot_activated_at: string | null;
  };
  readonly policy: {
    readonly revision: number;
    readonly updated_at: string | null;
    readonly updated_by: string | null;
    readonly approval: PolicyApprovalView | null;
    readonly blocked_capabilities: readonly string[];
  };
  readonly approval_preview: {
    readonly eligible: boolean;
    readonly reasons: readonly { readonly code: string; readonly detail: string | null }[];
    readonly snapshot_id: number | null;
    readonly verification_id: number | null;
    readonly report_hash: string | null;
    readonly report_version: string | null;
    readonly evidence: {
      readonly verification_id: number;
      readonly checked_at: string;
      readonly checked_by: string;
      readonly trigger: string;
      readonly status: string;
      readonly executor_id: string | null;
      readonly hostname: string | null;
      readonly registry_check_ms: number | null;
    } | null;
    readonly evidence_max_age_ms: number | null;
    readonly evidence_expires_at: string | null;
    readonly gates: readonly { readonly id: string; readonly pass: boolean }[];
    readonly required_gates: readonly string[];
    readonly opens: readonly string[];
    readonly not_opened: {
      readonly leaf_commands: number;
      readonly executable_commands: number;
      readonly not_executable_commands: number;
    };
    readonly scope_note: string;
  };
  readonly capabilities: readonly { readonly id: string; readonly blocked: boolean; readonly gate: ExecutionGateView }[];
  readonly revisions: readonly PolicyRevisionView[];
  readonly host_verification: { readonly status: string; readonly note: string };
}

export const POLICY_ACTION_LABEL: Readonly<Record<PolicyAction, string>> = {
  approve: 'Operational approval',
  revoke: 'Revoke approval',
  block: 'Block execution',
  resume: 'Resume execution',
};

/** W-010이 구분해 그리는 상태 (지시서 11장). 계정 연결·권한은 기존 신원 배너가 따로 그린다. */
export type GateState = 'ready' | 'operations_disabled' | 'admin_action_required' | 'policy_blocked' | 'registry_mismatch' | 'policy_unavailable' | 'not_executable';

export interface GateText {
  readonly state: GateState;
  readonly title: string;
  readonly description: string;
}

/**
 * 판정 사유 → 사용자에게 보이는 문구. **모든 사유를 덮는다**(시험이 `GH_EXECUTION_GATE_REASONS`와 대조한다).
 * A-005는 차단 전에 이 문구를 「변경 후 사용자에게 보일 사유」로 미리 보여 준다.
 */
export const GATE_TEXT: Readonly<Record<GhExecutionGateReason, GateText>> = {
  operations_disabled: { state: 'operations_disabled', title: 'GitHub operations are disabled for this deployment', description: 'This page becomes available when an operator enables the feature.' },
  capability_not_executable: { state: 'not_executable', title: 'This command is not enabled in this deployment', description: 'Only enabled commands can run. Operational approval does not enable additional commands.' },
  policy_unavailable: { state: 'policy_unavailable', title: 'Execution policy is unavailable', description: 'Execution is blocked because the policy could not be read. Try again later.' },
  admin_action_required: { state: 'admin_action_required', title: 'Operational approval is required', description: 'An operator has not approved the deployed gh command definitions yet. Try again after approval.' },
  policy_blocked: { state: 'policy_blocked', title: 'An administrator blocked this command', description: 'New requests will not run until an operator resumes execution. Contact an administrator if needed.' },
  policy_changed: { state: 'admin_action_required', title: 'The execution policy changed after this request', description: 'This request was accepted under an earlier policy and closed without running. Submit a new request if needed.' },
  registry_stale: { state: 'registry_mismatch', title: 'The gh registry does not match the approved definitions', description: 'The runner\'s verification does not match these definitions. Administrator action is required.' },
  registry_evidence_expired: { state: 'registry_mismatch', title: 'The runner\'s latest verification is stale', description: 'Execution stopped because the runner did not complete verification in time. Administrator action is required.' },
  registry_unchecked: { state: 'registry_mismatch', title: 'The runner has not verified the gh registry yet', description: 'The policy will be evaluated after verification. Administrator action is required.' },
};

export function gateState(gate: ExecutionGateView | null | undefined): GateState | null {
  if (gate === null || gate === undefined) return null;
  if (gate.allowed) return 'ready';
  return gate.reason === null ? 'policy_unavailable' : GATE_TEXT[gate.reason].state;
}

export function gateText(gate: ExecutionGateView | null | undefined): GateText | null {
  if (gate === null || gate === undefined || gate.allowed || gate.reason === null) return null;
  return GATE_TEXT[gate.reason];
}

/** 승인 부적격 사유 → 운영자에게 보이는 문구. 모든 사유를 덮는다(시험이 `GH_APPROVAL_INELIGIBLE_REASONS`와 대조한다). */
export const APPROVAL_REASON_TEXT: Readonly<Record<GhApprovalIneligibleReason, string>> = {
  snapshot_missing: 'No snapshot exists for the current definitions. The runner has not verified them yet.',
  snapshot_unclassified: 'The current definitions still contain unclassified items.',
  evidence_missing: 'No runner verification exists for this deployment scope. CLI and CI records do not qualify as evidence.',
  evidence_not_passed: 'The latest runner verification did not pass. An earlier pass does not override it.',
  evidence_other_definition: 'The latest runner verification references a different manifest. The runner and API deployments differ.',
  evidence_manifest_mismatch: 'The manifest hash recalculated by the runner does not match the expected value.',
  evidence_binary_mismatch: 'The runner\'s gh binary or version differs from the pinned value.',
  evidence_inventory_mismatch: 'The inventory observed by the runner differs from the manifest.',
  evidence_cadence_unknown: 'The verification record has no check interval. The current runner must verify it again.',
  evidence_stale: 'Verification evidence has expired. Wait for the runner\'s next check or review its startup verification.',
  report_version_unsupported: 'This server cannot read this report version.',
  report_version_superseded: 'This is an older report that did not verify result contracts.',
  report_invalid: 'The report format is invalid.',
  report_hash_mismatch: 'The stored report hash does not match its contents.',
  report_not_reproducible: 'The report differs from one generated by the server for the same definitions. The runner and API use different validators or manifests.',
  report_not_passed: 'The report did not pass.',
  gate_not_passed: 'The required gates (GATE-GH-01, 01b, 01d) did not pass.',
  already_approved: 'The current definitions already have operational approval.',
};

export function approvalReasonText(code: string): string {
  return (APPROVAL_REASON_TEXT as Readonly<Record<string, string>>)[code] ?? code;
}

export type ApprovalState = 'approved' | 'approval_required' | 'approved_other_definition';

export function approvalState(status: PolicyStatusView): ApprovalState {
  const approval = status.policy.approval;
  if (approval === null) return 'approval_required';
  return approval.matches_served ? 'approved' : 'approved_other_definition';
}

/** 사유 입력의 문제. 없으면 `null`. 서버와 같은 규칙이지만 판정은 서버가 한다 — 여기는 제출 전 안내다. */
export function reasonProblem(reason: string): string | null {
  const trimmed = reason.trim();
  if (trimmed === '') return 'Enter a reason.';
  if ([...trimmed].length > POLICY_REASON_MAX) return `${String(POLICY_REASON_MAX)} characters maximum.`;
  // eslint-disable-next-line no-control-regex -- 서버(`search-api/src/gh/policy.ts`)와 같은 제어 문자 규칙을 제출 전에 안내한다.
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(trimmed)) return 'Control characters are not allowed.';
  return null;
}

/** 승인 요청 본문 — 미리보기의 근거와 revision을 그대로 되돌려 보낸다. 자격이 없으면 `null`. */
export function approvalBody(status: PolicyStatusView, reason: string): Record<string, unknown> | null {
  const preview = status.approval_preview;
  if (!preview.eligible || preview.snapshot_id === null || preview.verification_id === null || preview.report_hash === null) return null;
  return {
    action: 'approve',
    expected_revision: status.policy.revision,
    reason: reason.trim(),
    snapshot_id: preview.snapshot_id,
    verification_id: preview.verification_id,
    report_hash: preview.report_hash,
  };
}

export function revokeBody(status: PolicyStatusView, reason: string): Record<string, unknown> {
  return { action: 'revoke', expected_revision: status.policy.revision, reason: reason.trim() };
}

export function capabilityChangeBody(status: PolicyStatusView, capabilityId: string, action: 'block' | 'resume', reason: string): Record<string, unknown> {
  return { action, expected_revision: status.policy.revision, reason: reason.trim(), capability_id: capabilityId };
}

export interface PolicyErrorView {
  readonly code: string | null;
  readonly message: string;
  readonly correlationId: string | null;
  /** 정책·근거가 확인한 뒤 바뀌었다 — 다시 읽고 다시 확인해야 한다. */
  readonly stale: boolean;
  readonly reasons: readonly string[];
}

/** 변경 응답의 오류를 운영자의 말로. */
export function describePolicyError(body: unknown, fallback: string): PolicyErrorView {
  const record = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
  const error = typeof record['error'] === 'object' && record['error'] !== null ? (record['error'] as Record<string, unknown>) : {};
  const code = typeof error['code'] === 'string' ? error['code'] : null;
  const detail = typeof error['detail'] === 'object' && error['detail'] !== null ? (error['detail'] as Record<string, unknown>) : {};
  const correlationId = typeof record['correlation_id'] === 'string' ? record['correlation_id'] : null;
  const reasons = Array.isArray(detail['reasons']) ? (detail['reasons'] as { code?: unknown }[]).map((one) => (typeof one.code === 'string' ? one.code : '')).filter((one) => one !== '') : [];
  switch (code) {
    case 'GH_POLICY_CONFLICT':
      return { code, message: 'The policy or evidence changed after your review. Review the refreshed details before submitting.', correlationId, stale: true, reasons: [] };
    case 'GH_REGISTRY_APPROVAL_INELIGIBLE':
      return { code, message: 'The current evidence does not support operational approval.', correlationId, stale: true, reasons };
    case 'GH_DUPLICATE_REQUEST':
      return { code, message: 'This request key has already been used with different content. Refresh and submit again.', correlationId, stale: true, reasons: [] };
    case 'FORBIDDEN_ROLE':
      return { code, message: 'The operator role is required to change operational policy.', correlationId, stale: false, reasons: [] };
    case 'GH_POLICY_UNAVAILABLE':
      return { code, message: 'Could not read the operational policy. Try again later.', correlationId, stale: false, reasons: [] };
    default: {
      const message = serviceMessage(error['message'], fallback, code);
      return { code, message, correlationId, stale: false, reasons: [] };
    }
  }
}

/** `25시간 20분`처럼. 신선도 한도를 운영자에게 보일 때 쓴다. */
export function formatDurationMs(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${String(rest)}m`;
  return rest === 0 ? `${String(hours)}h` : `${String(hours)}h ${String(rest)}m`;
}

/** 승인해도 열리지 않는 것 — 미리보기가 그대로 보인다. 서버의 `not_opened` 수치와 함께 쓴다. */
export function notOpenedLines(status: PolicyStatusView): readonly string[] {
  const counts = status.approval_preview.not_opened;
  return [
    `Disabled gh commands: ${String(counts.not_executable_commands)} (out of ${String(counts.leaf_commands)} leaf commands)`,
    'Saving and running multistep Recipes',
    'Write commands (risk levels R1–R3)',
    'Arbitrary gh api calls and extension execution',
    'File input/output operations',
  ];
}

/**
 * 미리보기의 막힘 사유 한 개를 표시한다. 실행 판정 사유(CR-090)는 사용자 문구의 제목으로 옮기고, 그 밖의 사유(계정 연결 등)는
 * 이전 판처럼 코드를 그대로 둔다 — 이 판이 만든 사유만 바꾼다.
 */
export function blockerLabel(code: string): string {
  return (GH_EXECUTION_GATE_REASONS as readonly string[]).includes(code) ? GATE_TEXT[code as GhExecutionGateReason].title : code;
}

export const GATE_REASONS: readonly GhExecutionGateReason[] = GH_EXECUTION_GATE_REASONS;
export const APPROVAL_REASONS: readonly GhApprovalIneligibleReason[] = GH_APPROVAL_INELIGIBLE_REASONS;
