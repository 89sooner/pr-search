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
  approve: '운영 승인',
  revoke: '승인 철회',
  block: '실행 차단',
  resume: '실행 재개',
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
  operations_disabled: { state: 'operations_disabled', title: '이 배포에서는 GitHub 작업이 꺼져 있습니다', description: '운영자가 기능을 켜면 이 화면이 열립니다.' },
  capability_not_executable: { state: 'not_executable', title: '이 배포가 실행을 열지 않은 명령입니다', description: '열린 명령만 실행할 수 있습니다. 운영 승인으로 명령이 늘어나지 않습니다.' },
  policy_unavailable: { state: 'policy_unavailable', title: '실행 정책을 확인할 수 없습니다', description: '정책 상태를 읽지 못해 실행을 허용하지 않습니다. 잠시 후 다시 시도하세요.' },
  admin_action_required: { state: 'admin_action_required', title: '관리자 운영 승인이 필요합니다', description: '현재 배포된 gh 명령 정의를 운영자가 아직 승인하지 않았습니다. 승인되면 다시 실행할 수 있습니다.' },
  policy_blocked: { state: 'policy_blocked', title: '관리자가 이 명령의 실행을 차단했습니다', description: '운영자가 재개할 때까지 새 요청은 실행되지 않습니다. 필요하면 관리자에게 문의하세요.' },
  policy_changed: { state: 'admin_action_required', title: '요청한 뒤 실행 정책이 바뀌었습니다', description: '이 요청은 이전 정책으로 수락돼 실행하지 않고 닫혔습니다. 필요하면 새로 요청하세요.' },
  registry_stale: { state: 'registry_mismatch', title: 'gh 레지스트리가 승인된 정의와 맞지 않습니다', description: '실행기의 검사 결과가 이 정의와 다릅니다. 관리자 조치를 기다립니다.' },
  registry_evidence_expired: { state: 'registry_mismatch', title: '실행기의 최근 검사가 오래됐습니다', description: '실행기가 제때 검사를 마치지 못해 실행을 멈췄습니다. 관리자 조치를 기다립니다.' },
  registry_unchecked: { state: 'registry_mismatch', title: '실행기가 아직 gh 레지스트리를 검사하지 않았습니다', description: '검사가 끝나면 다시 판정합니다. 관리자 조치를 기다립니다.' },
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
  snapshot_missing: '현재 정의의 스냅숏이 없습니다 — 실행기가 이 정의를 아직 검사하지 않았습니다.',
  snapshot_unclassified: '현재 정의에 미분류 항목이 남아 있습니다.',
  evidence_missing: '이 배포 범위의 실행기 검증 기록이 없습니다. CLI·CI 기록은 근거가 아닙니다.',
  evidence_not_passed: '가장 최근 실행기 검사가 통과가 아닙니다 — 과거 통과로 덮지 않습니다.',
  evidence_other_definition: '실행기의 최근 검사가 다른 manifest를 가리킵니다 — 실행기와 API의 배포가 다릅니다.',
  evidence_manifest_mismatch: '실행기가 다시 계산한 manifest 해시가 기대값과 다릅니다.',
  evidence_binary_mismatch: '실행기의 gh 바이너리·버전이 고정값과 다릅니다.',
  evidence_inventory_mismatch: '실행기가 관측한 인벤토리가 manifest와 다릅니다.',
  evidence_cadence_unknown: '검증 기록에 검사 주기가 없습니다 — 이 판의 실행기가 다시 검사해야 합니다.',
  evidence_stale: '검증 근거가 신선도 한도를 넘었습니다 — 실행기의 다음 검사를 기다리거나 재기동 검사를 확인하세요.',
  report_version_unsupported: '보고서 판을 이 서버가 해석할 수 없습니다.',
  report_version_superseded: '결과 계약을 검증하지 않은 옛 판의 보고서입니다.',
  report_invalid: '보고서 모양이 틀립니다.',
  report_hash_mismatch: '저장된 보고서 해시가 보고서 내용과 다릅니다.',
  report_not_reproducible: '서버가 같은 정의로 만든 보고서와 다릅니다 — 실행기와 API의 검증기·manifest가 다릅니다.',
  report_not_passed: '보고서가 통과가 아닙니다.',
  gate_not_passed: '필요한 게이트(GATE-GH-01·01b·01d)가 통과하지 않았습니다.',
  already_approved: '현재 정의는 이미 운영 승인돼 있습니다.',
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
  if (trimmed === '') return '사유를 적어 주세요.';
  if ([...trimmed].length > POLICY_REASON_MAX) return `${String(POLICY_REASON_MAX)}자 이내로 적어 주세요.`;
  // eslint-disable-next-line no-control-regex -- 서버(`search-api/src/gh/policy.ts`)와 같은 제어 문자 규칙을 제출 전에 안내한다.
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(trimmed)) return '제어 문자는 쓸 수 없습니다.';
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
      return { code, message: '확인한 뒤 정책이나 근거가 바뀌었습니다. 새로 읽은 내용을 다시 확인한 뒤 제출하세요.', correlationId, stale: true, reasons: [] };
    case 'GH_REGISTRY_APPROVAL_INELIGIBLE':
      return { code, message: '현재 근거로는 운영 승인할 수 없습니다.', correlationId, stale: true, reasons };
    case 'GH_DUPLICATE_REQUEST':
      return { code, message: '같은 요청 키가 다른 내용에 이미 쓰였습니다. 새로 읽은 뒤 다시 제출하세요.', correlationId, stale: true, reasons: [] };
    case 'FORBIDDEN_ROLE':
      return { code, message: '운영 정책을 바꾸려면 운영자(operator) 역할이 필요합니다.', correlationId, stale: false, reasons: [] };
    case 'GH_POLICY_UNAVAILABLE':
      return { code, message: '운영 정책 상태를 읽지 못했습니다. 잠시 후 다시 시도하세요.', correlationId, stale: false, reasons: [] };
    default: {
      const message = typeof error['message'] === 'string' && error['message'] !== '' ? error['message'] : fallback;
      return { code, message, correlationId, stale: false, reasons: [] };
    }
  }
}

/** `25시간 20분`처럼. 신선도 한도를 운영자에게 보일 때 쓴다. */
export function formatDurationMs(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${String(rest)}분`;
  return rest === 0 ? `${String(hours)}시간` : `${String(hours)}시간 ${String(rest)}분`;
}

/** 승인해도 열리지 않는 것 — 미리보기가 그대로 보인다. 서버의 `not_opened` 수치와 함께 쓴다. */
export function notOpenedLines(status: PolicyStatusView): readonly string[] {
  const counts = status.approval_preview.not_opened;
  return [
    `실행이 열리지 않은 gh 명령 ${String(counts.not_executable_commands)}개 (전체 leaf ${String(counts.leaf_commands)}개 중)`,
    '다단계 Recipe의 저장·실행',
    '쓰기 위험도(R1~R3) 명령',
    '임의 gh api 호출과 확장(extension) 실행',
    '파일 입출력 작업',
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
