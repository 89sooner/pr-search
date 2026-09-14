/**
 * 레지스트리 운영 승인과 실행 게이트 (FR-GH-011 AC-6~AC-10, FR-GH-009 AC-8, CR-090 / WP-080).
 *
 * 커밋된 manifest와 그것으로 검증기가 만든 **실제 보고서**로 본다. 근거를 지어내지 않고, 위조는 실제 기록의 한 칸을 바꿔
 * 만든다 — 그래야 「passed 문자열만 위조」「해시만 맞추기」「옛 판·알 수 없는 판」이 각각의 이유 코드로 잡히는지 알 수 있다.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { GH_PINNED_LINUX_AMD64, GH_PINNED_VERSION } from './pin.js';
import { GH_VERSION_TIMEOUT_MS, INVENTORY_HELP_CONCURRENCY, INVENTORY_HELP_TIMEOUT_MS, REGISTRY_CHECK_RETRY_DELAYS_MS } from './registry-cadence.js';
import {
  REQUIRED_APPROVAL_GATES,
  decideExecution,
  decodeRegistryReport,
  emptyPolicyState,
  evaluateApprovalEligibility,
  executorRegistryVerdict,
  nonAliasCommandCount,
  recordedRegistryVerdict,
  registeredReportVersions,
  registryCheckRoundBudgetMs,
  registryEvidenceMaxAgeMs,
  type GhApprovalEvidence,
  type GhApprovalSnapshot,
  type GhExecutionGateInput,
  type GhPolicyApproval,
  type GhPolicyState,
} from './registry-policy.js';
import type { GhCapabilityManifest } from './types.js';
import { reportHash, validateManifest, type GhRegistryReport } from './validate.js';

const manifest = JSON.parse(readFileSync(fileURLToPath(new URL('../manifest/gh-2.97.0.json', import.meta.url)), 'utf8')) as GhCapabilityManifest;
const report = validateManifest(manifest);
const SCOPE = 'ghe.example.com';
const NOW = new Date('2026-09-14T12:00:00.000Z');
const DAY = 86_400_000;

const snapshot: GhApprovalSnapshot = {
  snapshotId: 7,
  ghVersion: manifest.ghVersion,
  manifestVersion: manifest.manifestVersion,
  manifestHash: manifest.hash,
  inventoryHash: report.inventoryHash,
  unclassifiedCount: 0,
  interactionUnclassifiedCount: 0,
  flagUnclassifiedCount: 0,
  positionalUnclassifiedCount: 0,
  activatedAt: null,
};

/** 실행기가 실제로 남기는 모양의 통과 기록 — 보고서 원문은 JSON 왕복을 거친다(DB JSONB와 같다). */
function evidence(overrides: Partial<GhApprovalEvidence> = {}): GhApprovalEvidence {
  const stored = JSON.parse(JSON.stringify(report)) as unknown;
  return {
    verificationId: 41,
    snapshotId: snapshot.snapshotId,
    checkedAt: new Date(NOW.getTime() - 60_000),
    checkedBy: 'gh-executor',
    scope: SCOPE,
    trigger: 'startup',
    status: 'passed',
    environment: { executor_id: 'exec-1', registry_check_ms: DAY },
    ghVersionExpected: GH_PINNED_VERSION,
    ghVersionObserved: GH_PINNED_VERSION,
    binarySha256Expected: GH_PINNED_LINUX_AMD64.binarySha256,
    binarySha256Observed: GH_PINNED_LINUX_AMD64.binarySha256,
    manifestHashExpected: manifest.hash,
    manifestHashObserved: manifest.hash,
    inventoryHashExpected: report.inventoryHash,
    inventoryHashObserved: report.inventoryHash,
    report: stored,
    reportHash: reportHash(report),
    ...overrides,
  };
}

function eligibility(overrides: { evidence?: GhApprovalEvidence | null; snapshot?: GhApprovalSnapshot | null; policy?: GhPolicyState; servedReport?: GhRegistryReport; now?: Date } = {}): ReturnType<typeof evaluateApprovalEligibility> {
  return evaluateApprovalEligibility({
    scope: SCOPE,
    manifest,
    servedReport: overrides.servedReport ?? report,
    snapshot: overrides.snapshot === undefined ? snapshot : overrides.snapshot,
    latestEvidence: overrides.evidence === undefined ? evidence() : overrides.evidence,
    policy: overrides.policy ?? emptyPolicyState(SCOPE),
    now: overrides.now ?? NOW,
  });
}

const codes = (result: ReturnType<typeof evaluateApprovalEligibility>): string[] => result.reasons.map((reason) => reason.code);

const approval: GhPolicyApproval = {
  snapshotId: snapshot.snapshotId,
  verificationId: 41,
  reportHash: reportHash(report),
  manifestVersion: manifest.manifestVersion,
  manifestHash: manifest.hash,
  ghVersion: manifest.ghVersion,
  approvedAt: NOW,
  approvedBy: 'u-operator',
};

const approved = (overrides: Partial<GhPolicyState> = {}): GhPolicyState => ({ ...emptyPolicyState(SCOPE), revision: 3, approval, ...overrides });

function gate(overrides: Partial<GhExecutionGateInput> = {}): ReturnType<typeof decideExecution> {
  return decideExecution({ operationsEnabled: true, capabilityId: 'pr.list', manifest, policy: approved(), registry: { kind: 'ok' }, ...overrides });
}

describe('보고서 판 해석기 — 판 문자열의 크기를 비교하지 않는다 (FR-GH-011 AC-7)', () => {
  it('등록된 판은 r2 하나이고 실제 검증기 보고서를 읽는다', () => {
    expect(registeredReportVersions()).toEqual(['r2']);
    const decoded = decodeRegistryReport(JSON.parse(JSON.stringify(report)));
    expect(decoded.ok).toBe(true);
    if (decoded.ok) {
      expect(decoded.report.status).toBe('passed');
      expect(decoded.report.gates.map((one) => one.id)).toEqual([...REQUIRED_APPROVAL_GATES]);
    }
  });

  it('옛 판 r1은 결과 계약 이전 판으로, r999·r10·constructor는 알 수 없는 판으로 거절한다', () => {
    expect(decodeRegistryReport({ ...report, reportVersion: 'r1' })).toEqual({ ok: false, reason: 'report_version_superseded', version: 'r1' });
    for (const version of ['r999', 'r10', 'r3', 'constructor', '__proto__', 'toString']) {
      expect(decodeRegistryReport({ ...report, reportVersion: version }), version).toEqual({ ok: false, reason: 'report_version_unsupported', version });
    }
  });

  it('모양이 틀린 r2는 해석하지 않는다 — 판만 맞춘 위조를 통과시키지 않는다', () => {
    expect(decodeRegistryReport({ reportVersion: 'r2' })).toMatchObject({ ok: false, reason: 'report_invalid' });
    expect(decodeRegistryReport({ ...report, gates: [{ id: 'GATE-GH-01', pass: 'true' }] })).toMatchObject({ ok: false, reason: 'report_invalid' });
    expect(decodeRegistryReport({ ...report, manifestHash: 'not-a-hash' })).toMatchObject({ ok: false, reason: 'report_invalid' });
    expect(decodeRegistryReport(null)).toMatchObject({ ok: false, reason: 'report_invalid', version: null });
    expect(decodeRegistryReport([report])).toMatchObject({ ok: false, reason: 'report_invalid' });
  });
});

describe('신선도 한도 — 검사 주기와 시간 상한·재시도 설정에서 계산한다', () => {
  it('설정 값을 복제하지 않고 같은 상수를 읽는다', () => {
    expect([GH_VERSION_TIMEOUT_MS, INVENTORY_HELP_TIMEOUT_MS, INVENTORY_HELP_CONCURRENCY, [...REGISTRY_CHECK_RETRY_DELAYS_MS]]).toEqual([10_000, 20_000, 4, [5_000, 15_000, 45_000]]);
  });

  it('기본값은 주기 1일 + 한 회차 최악 소요 = 91,225,000ms다 (비별칭 command 228)', () => {
    expect(nonAliasCommandCount(manifest)).toBe(228);
    expect(registryCheckRoundBudgetMs(228)).toBe(4 * (10_000 + 20_000 + 20_000 + 57 * 20_000) + 65_000);
    expect(registryEvidenceMaxAgeMs({ intervalMs: DAY, commandsWithHelp: 228 })).toBe(91_225_000);
  });

  it('주기를 줄이면 한도도 줄고, 잘못된 입력은 계산하지 않는다', () => {
    expect(registryEvidenceMaxAgeMs({ intervalMs: 60_000, commandsWithHelp: 228 })).toBe(60_000 + 4_825_000);
    expect(() => registryEvidenceMaxAgeMs({ intervalMs: 0, commandsWithHelp: 228 })).toThrow();
    expect(() => registryCheckRoundBudgetMs(-1)).toThrow();
  });

  it('받아들이는 가장 긴 주기(7일)의 한도도 DB 함수가 받는 인자 상한 안에 있다 — 넘으면 정당한 승인이 PRS05로 막힌다', () => {
    // 두 값은 다른 파일에 산다(판정 모듈과 마이그레이션 030). 한쪽만 바뀌면 여기서 드러난다 (독립 검토 A).
    const sql = readFileSync(fileURLToPath(new URL('../../db/migrations/030_gh_operations_policy.up.sql', import.meta.url)), 'utf8');
    const bounds = /p_evidence_max_age_ms NOT BETWEEN (\d+) AND (\d+)/.exec(sql);
    expect(bounds).not.toBeNull();
    const [, floor, ceiling] = bounds ?? [];
    const longest = registryEvidenceMaxAgeMs({ intervalMs: 7 * DAY, commandsWithHelp: nonAliasCommandCount(manifest) });
    const shortest = registryEvidenceMaxAgeMs({ intervalMs: 60_000, commandsWithHelp: nonAliasCommandCount(manifest) });
    expect(longest).toBeLessThanOrEqual(Number(ceiling));
    expect(shortest).toBeGreaterThanOrEqual(Number(floor));
  });
});

describe('실행 판정 — API·실행기·화면이 같은 식을 쓴다 (FR-GH-011 AC-9, FR-GH-009 AC-8)', () => {
  it('승인된 현재 정의·차단 없음·레지스트리 통과면 허용하고 현재 revision을 돌려준다', () => {
    expect(gate()).toEqual({ allowed: true, revision: 3 });
  });

  it('순서가 사유의 순서다 — 꺼짐 → 상한 → 정책 읽기 → 운영 승인 → 운영자 차단 → revision → 레지스트리', () => {
    expect(gate({ operationsEnabled: false, policy: 'unavailable', registry: { kind: 'unchecked' } })).toMatchObject({ allowed: false, reason: 'operations_disabled' });
    expect(gate({ capabilityId: 'pr.view', policy: 'unavailable' })).toMatchObject({ allowed: false, reason: 'capability_not_executable' });
    expect(gate({ policy: 'unavailable' })).toMatchObject({ allowed: false, reason: 'policy_unavailable', revision: null });
    expect(gate({ policy: emptyPolicyState(SCOPE), registry: { kind: 'stale', detail: 'x' } })).toMatchObject({ allowed: false, reason: 'admin_action_required', detail: 'no_approval', revision: 0 });
    expect(gate({ policy: approved({ blockedCapabilities: ['pr.list'] }), registry: { kind: 'stale', detail: 'x' }, acceptedRevision: 1 })).toMatchObject({ allowed: false, reason: 'policy_blocked', detail: 'operator_blocked' });
    expect(gate({ acceptedRevision: 2, registry: { kind: 'stale', detail: 'x' } })).toMatchObject({ allowed: false, reason: 'policy_changed' });
    expect(gate({ registry: { kind: 'stale', detail: 'drift' } })).toMatchObject({ allowed: false, reason: 'registry_stale', detail: 'drift' });
    expect(gate({ registry: { kind: 'expired', lastPassedAt: NOW, maxAgeMs: 1 } })).toMatchObject({ allowed: false, reason: 'registry_evidence_expired' });
    expect(gate({ registry: { kind: 'unchecked' } })).toMatchObject({ allowed: false, reason: 'registry_unchecked' });
  });

  it('정책은 상한을 넓히지 못한다 — 승인과 차단 해제가 있어도 코드가 열지 않은 command는 실행되지 않는다', () => {
    for (const id of ['pr.view', 'pr.merge', 'api', 'extension.install', 'repo.delete']) {
      expect(gate({ capabilityId: id }), id).toMatchObject({ allowed: false, reason: 'capability_not_executable' });
    }
  });

  it('승인 정의가 적재 정의와 다르면 다른 스냅숏으로 옮겨 가지 않고 막는다', () => {
    for (const changed of [{ manifestHash: 'f'.repeat(64) }, { manifestVersion: 'r0.2' }, { ghVersion: '2.96.0' }]) {
      expect(gate({ policy: approved({ approval: { ...approval, ...changed } }) }), JSON.stringify(changed)).toMatchObject({ allowed: false, reason: 'admin_action_required', detail: 'approved_definition_differs' });
    }
  });

  it('대기 요청은 과거 revision을 승계하지 않는다 — 수락 판정(acceptedRevision 없음)만 현재 revision을 받는다', () => {
    expect(gate({ acceptedRevision: 3 })).toEqual({ allowed: true, revision: 3 });
    expect(gate({ acceptedRevision: null })).toMatchObject({ allowed: false, reason: 'policy_changed' });
  });
});

describe('레지스트리 판정 입력 — 실행기는 인메모리 검사, API는 DB 기록', () => {
  const base = { stale: false, now: NOW, intervalMs: DAY, manifest };

  it('실행기: 드리프트가 먼저, 통과 없음은 unchecked, 한도를 넘은 마지막 통과는 expired', () => {
    expect(executorRegistryVerdict({ ...base, stale: true, lastPassedAt: NOW })).toMatchObject({ kind: 'stale' });
    expect(executorRegistryVerdict({ ...base, lastPassedAt: null })).toEqual({ kind: 'unchecked' });
    expect(executorRegistryVerdict({ ...base, lastPassedAt: new Date(NOW.getTime() - 91_225_000) })).toEqual({ kind: 'ok' });
    expect(executorRegistryVerdict({ ...base, lastPassedAt: new Date(NOW.getTime() - 91_225_001) })).toMatchObject({ kind: 'expired', maxAgeMs: 91_225_000 });
  });

  it('API: 일시 오류를 뺀 최근 기록이 적재 정의·통과면 ok, 다른 정의·드리프트·미완이면 stale, 없으면 unchecked', () => {
    expect(recordedRegistryVerdict({ manifestHash: manifest.hash, latestDecisive: null })).toEqual({ kind: 'unchecked' });
    expect(recordedRegistryVerdict({ manifestHash: manifest.hash, latestDecisive: { status: 'passed', manifestHashExpected: manifest.hash } })).toEqual({ kind: 'ok' });
    expect(recordedRegistryVerdict({ manifestHash: manifest.hash, latestDecisive: { status: 'passed', manifestHashExpected: 'e'.repeat(64) } })).toEqual({ kind: 'stale', detail: 'executor_definition_differs' });
    for (const status of ['drift', 'failed', 'incomplete']) {
      expect(recordedRegistryVerdict({ manifestHash: manifest.hash, latestDecisive: { status, manifestHashExpected: manifest.hash } })).toEqual({ kind: 'stale', detail: `latest_check_${status}` });
    }
  });
});

describe('승인 자격 — 서버가 적재한 정의와 실행기 근거로만 판정한다 (FR-GH-011 AC-7)', () => {
  it('실제 통과 기록이면 승인할 수 있고, 열리는 것은 pr.list 하나다', () => {
    const result = eligibility();
    expect(result.reasons).toEqual([]);
    expect(result).toMatchObject({ eligible: true, snapshotId: 7, verificationId: 41, reportVersion: 'r2', evidenceMaxAgeMs: 91_225_000, opens: ['pr.list'] });
    expect(result.evidenceExpiresAt?.getTime()).toBe(NOW.getTime() - 60_000 + 91_225_000);
  });

  it('근거가 없거나 실행기·이 배포 범위의 기록이 아니면 거절한다', () => {
    expect(codes(eligibility({ evidence: null }))).toEqual(['evidence_missing']);
    expect(codes(eligibility({ evidence: evidence({ checkedBy: 'ci' }) }))).toContain('evidence_missing');
    expect(codes(eligibility({ evidence: evidence({ scope: 'other-ghe.example.com' }) }))).toContain('evidence_missing');
    expect(codes(eligibility({ evidence: evidence({ scope: null }) }))).toContain('evidence_missing');
  });

  it('더 최신의 실패·드리프트·일시 오류를 과거 성공으로 덮지 않는다 — 가장 최근 기록이 passed여야 한다', () => {
    for (const status of ['drift', 'failed', 'incomplete', 'error']) {
      expect(codes(eligibility({ evidence: evidence({ status }) })), status).toContain('evidence_not_passed');
    }
  });

  it('passed 문자열만 위조한 기록은 보고서·해시에서 잡힌다', () => {
    const incomplete = { ...JSON.parse(JSON.stringify(report)), status: 'incomplete', gates: report.gates.map((one) => (one.id === 'GATE-GH-01d' ? { ...one, pass: false } : one)) } as GhRegistryReport;
    // 보고서는 미완인데 기록의 status와 report_hash를 통과처럼 적었다.
    const forged = codes(eligibility({ evidence: evidence({ report: incomplete }) }));
    expect(forged).toEqual(expect.arrayContaining(['report_hash_mismatch', 'report_not_passed', 'gate_not_passed']));
    // 해시까지 새 보고서에 맞춰도 서버가 같은 정의로 만든 보고서와 달라 재현되지 않는다.
    const rehashed = codes(eligibility({ evidence: evidence({ report: incomplete, reportHash: reportHash(incomplete) }) }));
    expect(rehashed).toEqual(expect.arrayContaining(['report_not_reproducible', 'report_not_passed', 'gate_not_passed']));
    expect(rehashed).not.toContain('report_hash_mismatch');
  });

  it('옛 판 r1·알 수 없는 판 r999의 보고서는 근거가 아니다', () => {
    const r1 = { ...JSON.parse(JSON.stringify(report)), reportVersion: 'r1' };
    expect(codes(eligibility({ evidence: evidence({ report: r1, reportHash: reportHash(r1 as GhRegistryReport) }) }))).toContain('report_version_superseded');
    const r999 = { ...JSON.parse(JSON.stringify(report)), reportVersion: 'r999' };
    expect(codes(eligibility({ evidence: evidence({ report: r999, reportHash: reportHash(r999 as GhRegistryReport) }) }))).toContain('report_version_unsupported');
  });

  it('스냅숏·보고서·manifest 해시가 서로 다르면 거절한다', () => {
    expect(codes(eligibility({ evidence: evidence({ snapshotId: 8 }) }))).toContain('evidence_other_definition');
    expect(codes(eligibility({ evidence: evidence({ manifestHashExpected: 'e'.repeat(64), manifestHashObserved: 'e'.repeat(64) }) }))).toContain('evidence_other_definition');
    expect(codes(eligibility({ evidence: evidence({ manifestHashObserved: 'd'.repeat(64) }) }))).toContain('evidence_manifest_mismatch');
    expect(codes(eligibility({ evidence: evidence({ binarySha256Observed: 'c'.repeat(64) }) }))).toContain('evidence_binary_mismatch');
    expect(codes(eligibility({ evidence: evidence({ ghVersionObserved: '2.96.0' }) }))).toContain('evidence_binary_mismatch');
    expect(codes(eligibility({ evidence: evidence({ inventoryHashObserved: 'b'.repeat(64) }) }))).toContain('evidence_inventory_mismatch');
    expect(codes(eligibility({ snapshot: { ...snapshot, inventoryHash: 'a'.repeat(64) } }))).toContain('evidence_inventory_mismatch');
  });

  it('실행기와 API의 적재 정의가 다르면 재현되지 않는다 — 다른 검증기로 만든 보고서', () => {
    const otherValidator = { ...report, validatorVersion: `${report.validatorVersion}-other` } as GhRegistryReport;
    expect(codes(eligibility({ servedReport: otherValidator }))).toEqual(['report_not_reproducible']);
  });

  it('근거가 신선도 한도를 넘었거나 미래 시각이거나 검사 주기를 모르면 거절한다', () => {
    expect(codes(eligibility({ evidence: evidence({ checkedAt: new Date(NOW.getTime() - 91_225_001) }) }))).toEqual(['evidence_stale']);
    expect(codes(eligibility({ evidence: evidence({ checkedAt: new Date(NOW.getTime() - 91_225_000) }) }))).toEqual([]);
    expect(eligibility({ evidence: evidence({ checkedAt: new Date(NOW.getTime() + 1_000) }) }).reasons).toEqual([{ code: 'evidence_stale', detail: 'checked_in_future' }]);
    expect(codes(eligibility({ evidence: evidence({ environment: { executor_id: 'old' } }) }))).toEqual(['evidence_cadence_unknown']);
    expect(codes(eligibility({ evidence: evidence({ environment: { registry_check_ms: 59_999 } }) }))).toEqual(['evidence_cadence_unknown']);
  });

  it('스냅숏이 없거나 미분류가 남았거나 이미 같은 정의가 승인돼 있으면 거절한다', () => {
    expect(codes(eligibility({ snapshot: null }))).toContain('snapshot_missing');
    expect(codes(eligibility({ snapshot: { ...snapshot, flagUnclassifiedCount: 1 } }))).toContain('snapshot_unclassified');
    expect(codes(eligibility({ policy: approved() }))).toEqual(['already_approved']);
    expect(codes(eligibility({ policy: approved({ approval: { ...approval, snapshotId: 6, manifestHash: 'f'.repeat(64) } }) }))).toEqual([]);
  });
});
