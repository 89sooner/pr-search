/**
 * 운영 정책 화면 모델 (WP-080 / FR-GH-011 AC-6~AC-9, FR-GH-009 AC-8, CR-090).
 *
 * 문구 표가 서버의 사유 목록을 **빠짐없이** 덮는지, 요청 본문이 미리보기의 근거를 그대로 싣는지, 문구가 사실보다 넓어지지
 * 않는지(「전 기능」「확인 완료」)를 건다. 픽스처의 적재 정의 값은 커밋된 manifest로 다시 계산해 대조한다.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { GH_APPROVAL_INELIGIBLE_REASONS, GH_EXECUTION_GATE_REASONS, REQUIRED_APPROVAL_GATES, nonAliasCommandCount, registryEvidenceMaxAgeMs, reportHash, validateManifest, type GhCapabilityManifest } from '@prs/gh-cli';
import { describe, expect, it } from 'vitest';
import {
  APPROVAL_REASON_TEXT,
  GATE_TEXT,
  approvalBody,
  approvalReasonText,
  approvalState,
  blockerLabel,
  canChangePolicy,
  capabilityChangeBody,
  describePolicyError,
  formatDurationMs,
  gateState,
  gateText,
  notOpenedLines,
  reasonProblem,
  revokeBody,
} from './gh-policy';
import {
  EVIDENCE_MAX_AGE_MS,
  EXECUTABLE_COMMANDS,
  GATE_BLOCKED,
  GATE_READY,
  GATE_REGISTRY,
  LEAF_COMMANDS,
  SERVED_INVENTORY_HASH,
  SERVED_MANIFEST_HASH,
  SERVED_MANIFEST_VERSION,
  SERVED_REPORT_HASH,
  SERVED_VALIDATOR_VERSION,
  policyStatus,
} from './gh-policy-fixtures';

const manifest = JSON.parse(readFileSync(fileURLToPath(new URL('../../../packages/gh-cli/manifest/gh-2.97.0.json', import.meta.url)), 'utf8')) as GhCapabilityManifest;
const report = validateManifest(manifest);

describe('픽스처의 적재 정의는 커밋된 manifest의 실측이다', () => {
  it('manifest 해시·판·인벤토리·보고서 해시·검증기 판·게이트·신선도 한도·명령 수가 같다', () => {
    expect([SERVED_MANIFEST_HASH, SERVED_MANIFEST_VERSION]).toEqual([manifest.hash, manifest.manifestVersion]);
    expect([SERVED_INVENTORY_HASH, SERVED_REPORT_HASH, SERVED_VALIDATOR_VERSION]).toEqual([report.inventoryHash, reportHash(report), report.validatorVersion]);
    expect(policyStatus().approval_preview.gates).toEqual(report.gates.map((gate) => ({ id: gate.id, pass: gate.pass })));
    expect(policyStatus().approval_preview.required_gates).toEqual([...REQUIRED_APPROVAL_GATES]);
    expect(EVIDENCE_MAX_AGE_MS).toBe(registryEvidenceMaxAgeMs({ intervalMs: 86_400_000, commandsWithHelp: nonAliasCommandCount(manifest) }));
    expect([LEAF_COMMANDS, EXECUTABLE_COMMANDS]).toEqual([manifest.coverage.leafCommands, manifest.coverage.executableCommands]);
  });
});

describe('문구 표가 서버의 사유를 빠짐없이 덮는다', () => {
  it('실행 판정 사유 전부에 사용자 문구가 있다', () => {
    expect(Object.keys(GATE_TEXT).sort()).toEqual([...GH_EXECUTION_GATE_REASONS].sort());
  });

  it('승인 부적격 사유 전부에 운영자 문구가 있다 — 모르는 코드는 코드 그대로 보인다', () => {
    expect(Object.keys(APPROVAL_REASON_TEXT).sort()).toEqual([...GH_APPROVAL_INELIGIBLE_REASONS].sort());
    expect(approvalReasonText('something_new')).toBe('something_new');
  });

  it('문구가 사실보다 넓어지지 않는다 — 전 기능 허용·사내 확인 완료·차단이 실행 중 작업을 취소한다고 말하지 않는다', () => {
    const all = [...Object.values(GATE_TEXT).flatMap((text) => [text.title, text.description]), ...Object.values(APPROVAL_REASON_TEXT), ...notOpenedLines(policyStatus())];
    for (const phrase of ['전 기능', '모든 기능', '확인 완료', '실행 중인 작업을 취소']) {
      expect(all.filter((text) => text.includes(phrase)), phrase).toEqual([]);
    }
  });
});

describe('버튼 표시 규칙 — 판정은 서버가 한다', () => {
  it('인증이 켜진 배포에서는 operator만 변경 버튼을 보고, 인증이 없는 배포는 역할을 몰라 그린다(서버가 거절)', () => {
    expect(canChangePolicy(['operator'], true)).toBe(true);
    expect(canChangePolicy(['security_officer', 'operator'], true)).toBe(true);
    expect(canChangePolicy(['security_officer'], true)).toBe(false);
    expect(canChangePolicy(['developer'], true)).toBe(false);
    expect(canChangePolicy([], false)).toBe(true);
  });
});

describe('W-010 상태 구분 (지시서 11장)', () => {
  it('실행 가능·운영 승인 필요·관리자 차단·레지스트리 불일치·정책 확인 불가를 서로 다르게 가른다', () => {
    expect(gateState(GATE_READY)).toBe('ready');
    expect(gateState(policyStatus().capabilities[0]?.gate)).toBe('admin_action_required');
    expect(gateState(GATE_BLOCKED)).toBe('policy_blocked');
    expect(gateState(GATE_REGISTRY)).toBe('registry_mismatch');
    expect(gateState({ allowed: false, reason: 'policy_unavailable', detail: null, revision: null })).toBe('policy_unavailable');
    expect(gateState(null)).toBeNull();
    expect(gateText(GATE_READY)).toBeNull();
    expect(gateText(GATE_BLOCKED)?.title).toBe('관리자가 이 명령의 실행을 차단했습니다');
  });

  it('미리보기의 막힘 사유는 이 판의 판정 사유만 문구로 옮기고 계정 연결 사유는 코드 그대로 둔다', () => {
    expect(blockerLabel('admin_action_required')).toBe('관리자 운영 승인이 필요합니다');
    expect(blockerLabel('identity_not_connected')).toBe('identity_not_connected');
  });
});

describe('요청 본문 — 미리보기의 근거와 revision을 그대로 되돌려 보낸다', () => {
  it('승인할 수 있으면 스냅숏·기록·보고서 해시·기대 revision을 싣고, 사유는 앞뒤 공백을 걷는다', () => {
    expect(approvalBody(policyStatus('approval_required'), '  배포 승인  ')).toEqual({ action: 'approve', expected_revision: 0, reason: '배포 승인', snapshot_id: 7, verification_id: 41, report_hash: SERVED_REPORT_HASH });
  });

  it('자격이 없으면 본문을 만들지 않는다 — 화면이 서버의 판정을 앞질러 보내지 않는다', () => {
    expect(approvalBody(policyStatus('ineligible'), '승인')).toBeNull();
    expect(approvalBody(policyStatus('approved'), '승인')).toBeNull();
  });

  it('철회·차단·재개도 현재 revision을 기대값으로 싣는다', () => {
    expect(revokeBody(policyStatus('approved'), '철회')).toEqual({ action: 'revoke', expected_revision: 1, reason: '철회' });
    expect(capabilityChangeBody(policyStatus('approved'), 'pr.list', 'block', '사고')).toEqual({ action: 'block', expected_revision: 1, reason: '사고', capability_id: 'pr.list' });
    expect(capabilityChangeBody(policyStatus('blocked'), 'pr.list', 'resume', '해소')).toEqual({ action: 'resume', expected_revision: 2, reason: '해소', capability_id: 'pr.list' });
  });

  it('사유는 비었거나 500자를 넘거나 제어 문자가 있으면 제출 전에 안내한다', () => {
    expect(reasonProblem('')).not.toBeNull();
    expect(reasonProblem('   ')).not.toBeNull();
    expect(reasonProblem('가'.repeat(501))).not.toBeNull();
    expect(reasonProblem(`bad${String.fromCharCode(7)}`)).not.toBeNull();
    expect(reasonProblem('가'.repeat(500))).toBeNull();
    expect(reasonProblem('여러 줄\n사유')).toBeNull();
  });
});

describe('상태와 오류를 운영자의 말로', () => {
  it('승인 상태 — 없음·현재 정의 승인·다른 정의 승인', () => {
    expect(approvalState(policyStatus('approval_required'))).toBe('approval_required');
    expect(approvalState(policyStatus('approved'))).toBe('approved');
    expect(approvalState(policyStatus('other_definition'))).toBe('approved_other_definition');
  });

  it('충돌·부적격·키 재사용은 다시 읽어야 하는 오류이고 부적격 사유를 함께 낸다', () => {
    expect(describePolicyError({ error: { code: 'GH_POLICY_CONFLICT', detail: { reason: 'revision_changed' } }, correlation_id: 'c-1' }, 'x')).toMatchObject({ stale: true, correlationId: 'c-1' });
    expect(describePolicyError({ error: { code: 'GH_REGISTRY_APPROVAL_INELIGIBLE', detail: { reasons: [{ code: 'evidence_stale' }] } } }, 'x')).toMatchObject({ stale: true, reasons: ['evidence_stale'] });
    expect(describePolicyError({ error: { code: 'GH_DUPLICATE_REQUEST' } }, 'x')).toMatchObject({ stale: true });
    expect(describePolicyError({ error: { code: 'FORBIDDEN_ROLE' } }, 'x')).toMatchObject({ stale: false });
    expect(describePolicyError(null, '대체 문구').message).toBe('대체 문구');
  });

  it('신선도 한도를 시간·분으로 — 기본 91,225,000ms는 25시간 20분', () => {
    expect(formatDurationMs(91_225_000)).toBe('25시간 20분');
    expect(formatDurationMs(3_600_000)).toBe('1시간');
    expect(formatDurationMs(120_000)).toBe('2분');
  });
});
