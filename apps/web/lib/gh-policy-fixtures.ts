/**
 * 운영 정책 화면 픽스처 (A-005 · A-006 · W-010, CR-090).
 *
 * **적재 정의의 값은 커밋된 manifest의 실측 리터럴이다** — manifest 해시·판·인벤토리 해시·보고서 해시·게이트·신선도 한도.
 * `gh-policy-fixtures.test.ts`가 manifest와 검증기로 다시 계산해 같은지 건다(CR-089의 규율: 목이 응답을 지어내면 계약 버그를 숨긴다).
 * 운영 정책의 상태(승인·차단·이력)는 시나리오마다 다르게 만든다.
 */

import type { ExecutionGateView, PolicyRevisionView, PolicyStatusView } from './gh-policy';

export const SERVED_MANIFEST_HASH = '18589580d7c69d79ed981f52387103e12389abc384c58239b4b553739c142b13';
export const SERVED_MANIFEST_VERSION = 'r0.3';
export const SERVED_GH_VERSION = '2.97.0';
export const SERVED_INVENTORY_HASH = '831285807600ae8c4b8f5c2b637d4f9e393374b74c9891854d92fe780579d772';
export const SERVED_REPORT_HASH = '686f4d6d890c0c2c7b2f7e22b648e12ed8b166a779e93e43c7d2cfdf12fd4459';
export const SERVED_VALIDATOR_VERSION = 'validator-2026-09-14.2';
export const EVIDENCE_MAX_AGE_MS = 91_225_000;
export const LEAF_COMMANDS = 196;
export const EXECUTABLE_COMMANDS = 1;

const SCOPE = 'ghe.example.com';
const NOW = '2026-09-14T09:00:00.000Z';
const CHECKED_AT = '2026-09-14T08:55:00.000Z';

export const GATE_READY: ExecutionGateView = { allowed: true, reason: null, detail: null, revision: 1 };
export const GATE_ADMIN_ACTION: ExecutionGateView = { allowed: false, reason: 'admin_action_required', detail: 'no_approval', revision: 0 };
export const GATE_BLOCKED: ExecutionGateView = { allowed: false, reason: 'policy_blocked', detail: 'operator_blocked', revision: 2 };
export const GATE_REGISTRY: ExecutionGateView = { allowed: false, reason: 'registry_stale', detail: 'latest_check_drift', revision: 1 };

const APPROVE_REVISION: PolicyRevisionView = {
  revision: 1,
  previous_revision: 0,
  action: 'approve',
  capability_id: null,
  snapshot_id: 7,
  verification_id: 41,
  report_hash: SERVED_REPORT_HASH,
  manifest_version: SERVED_MANIFEST_VERSION,
  manifest_hash: SERVED_MANIFEST_HASH,
  gh_version: SERVED_GH_VERSION,
  actor: 'u-ops',
  reason: 'r0.3 배포 승인',
  correlation_id: '00000000-0000-4000-8000-0000000000a1',
  created_at: '2026-09-14T08:58:00.000Z',
};

const BLOCK_REVISION: PolicyRevisionView = {
  revision: 2,
  previous_revision: 1,
  action: 'block',
  capability_id: 'pr.list',
  snapshot_id: null,
  verification_id: null,
  report_hash: null,
  manifest_version: null,
  manifest_hash: null,
  gh_version: null,
  actor: 'u-ops',
  reason: '장애 대응',
  correlation_id: '00000000-0000-4000-8000-0000000000a2',
  created_at: '2026-09-14T08:59:00.000Z',
};

export type PolicyScenario = 'approval_required' | 'ineligible' | 'approved' | 'blocked' | 'other_definition';

/** 시나리오별 조회 응답. 적재 정의·근거는 실측 리터럴이다. */
export function policyStatus(scenario: PolicyScenario = 'approval_required'): PolicyStatusView {
  const approved = scenario === 'approved' || scenario === 'blocked' || scenario === 'other_definition';
  const blocked = scenario === 'blocked';
  const ineligible = scenario === 'ineligible';
  const revision = blocked ? 2 : approved ? 1 : 0;
  const gate: ExecutionGateView = blocked ? GATE_BLOCKED : scenario === 'approved' ? GATE_READY : { ...GATE_ADMIN_ACTION, detail: scenario === 'other_definition' ? 'approved_definition_differs' : 'no_approval', revision };
  return {
    scope: SCOPE,
    now: NOW,
    served: {
      gh_version: SERVED_GH_VERSION,
      pinned_version: SERVED_GH_VERSION,
      manifest_version: SERVED_MANIFEST_VERSION,
      manifest_hash: SERVED_MANIFEST_HASH,
      inventory_hash: SERVED_INVENTORY_HASH,
      report_version: 'r2',
      report_hash: SERVED_REPORT_HASH,
      validator_version: SERVED_VALIDATOR_VERSION,
      snapshot_id: 7,
      snapshot_activated_at: approved ? '2026-09-14T08:58:00.000Z' : null,
    },
    policy: {
      revision,
      updated_at: revision === 0 ? null : blocked ? BLOCK_REVISION.created_at : APPROVE_REVISION.created_at,
      updated_by: revision === 0 ? null : 'u-ops',
      approval: approved
        ? {
            snapshot_id: scenario === 'other_definition' ? 6 : 7,
            verification_id: 41,
            report_hash: SERVED_REPORT_HASH,
            manifest_version: scenario === 'other_definition' ? 'r0.2' : SERVED_MANIFEST_VERSION,
            manifest_hash: scenario === 'other_definition' ? 'e'.repeat(64) : SERVED_MANIFEST_HASH,
            gh_version: SERVED_GH_VERSION,
            approved_at: APPROVE_REVISION.created_at,
            approved_by: 'u-ops',
            matches_served: scenario !== 'other_definition',
          }
        : null,
      blocked_capabilities: blocked ? ['pr.list'] : [],
    },
    approval_preview: {
      eligible: !ineligible && scenario !== 'approved' && scenario !== 'blocked',
      reasons: ineligible ? [{ code: 'evidence_stale', detail: null }, { code: 'report_not_reproducible', detail: null }] : scenario === 'approved' || scenario === 'blocked' ? [{ code: 'already_approved', detail: null }] : [],
      snapshot_id: 7,
      verification_id: 41,
      report_hash: SERVED_REPORT_HASH,
      report_version: 'r2',
      evidence: { verification_id: 41, checked_at: CHECKED_AT, checked_by: 'gh-executor', trigger: 'startup', status: 'passed', executor_id: 'exec-1:42:abcd', hostname: 'exec-1', registry_check_ms: 86_400_000 },
      evidence_max_age_ms: EVIDENCE_MAX_AGE_MS,
      evidence_expires_at: new Date(Date.parse(CHECKED_AT) + EVIDENCE_MAX_AGE_MS).toISOString(),
      gates: [
        { id: 'GATE-GH-01', pass: true },
        { id: 'GATE-GH-01b', pass: true },
        { id: 'GATE-GH-01d', pass: true },
      ],
      required_gates: ['GATE-GH-01', 'GATE-GH-01b', 'GATE-GH-01d'],
      opens: ['pr.list'],
      not_opened: { leaf_commands: LEAF_COMMANDS, executable_commands: EXECUTABLE_COMMANDS, not_executable_commands: LEAF_COMMANDS - EXECUTABLE_COMMANDS },
      scope_note: '이 승인은 이 배포 범위의 현재 R0 정의에 대한 운영 승인이다 — 196개 명령의 실행 허용·사내 GHES 확인·REL-007 완료가 아니다',
    },
    capabilities: [{ id: 'pr.list', blocked, gate }],
    revisions: blocked ? [BLOCK_REVISION, APPROVE_REVISION] : approved ? [APPROVE_REVISION] : [],
    host_verification: { status: 'not_verified', note: '사내 GHES에서 실제로 확인한 command가 없다 — 운영 승인은 이 사실을 바꾸지 않는다 (FR-GH-011 AC-4·AC-5)' },
  };
}
