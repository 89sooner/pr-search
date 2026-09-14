/**
 * 레지스트리 운영 승인과 실행 게이트 — 판정의 **유일한 식** (FR-GH-011 AC-6~AC-10, FR-GH-009 AC-8, CR-090).
 *
 * 세 사실을 섞지 않는다.
 *
 * | 사실 | 어디에 있나 | 뜻 |
 * | --- | --- | --- |
 * | 검증 기록 | `gh_capability_verification` (실행기가 남긴다) | 어떤 바이너리·manifest를 검사했고 결과가 무엇이었나 |
 * | 운영 승인 | `gh_operations_policy` (운영자가 revision으로 바꾼다) | 어느 배포 정의를 이 배포의 R0 범위에서 쓰기로 했나, 어떤 capability를 막았나 |
 * | 실행 허용 | 저장하지 않는다 — `decideExecution`이 요청마다 계산한다 | 이 요청이 지금 실행 가능한가 |
 *
 * **API(미리보기·수락)·실행기(claim)·화면이 같은 함수를 부른다.** 입력을 채우는 방법만 다르다 — API는 DB에 남은
 * 기록으로 레지스트리 판정을 채우고, 실행기는 자기 인메모리 검사로 채운다. 판정식을 복제하지 않는다.
 *
 * 운영 승인은 실행 허용의 **상한을 넓히지 않는다.** 상한은 코드의 `EXECUTABLE_CAPABILITIES`와 manifest의
 * `execution: allowed`이며, 승인은 그 안에서 「이 정의를 써도 된다」는 결정 하나를 더할 뿐이다.
 *
 * 이 파일은 순수하다 — DB·네트워크·시계를 직접 부르지 않는다. 시각은 호출자가 넘긴다.
 */

import { findCapability } from './capabilities.js';
import { GH_PINNED_LINUX_AMD64, GH_PINNED_VERSION } from './pin.js';
import { GH_VERSION_TIMEOUT_MS, INVENTORY_HELP_CONCURRENCY, INVENTORY_HELP_TIMEOUT_MS, REGISTRY_CHECK_RETRY_DELAYS_MS } from './registry-cadence.js';
import type { GhCapabilityManifest } from './types.js';
import { reportHash, type GhRegistryReport } from './validate.js';

// ── 보고서 판 해석기 ───────────────────────────────────────────────────────

/** 운영 승인이 통과를 요구하는 게이트. 보고서에 없으면 통과가 아니다. */
export const REQUIRED_APPROVAL_GATES = ['GATE-GH-01', 'GATE-GH-01b', 'GATE-GH-01d'] as const;

/** 해석기가 읽어 낸 보고서의 필요한 부분. 판마다 모양이 달라도 승인 판정은 이것만 본다. */
export interface GhDecodedRegistryReport {
  readonly version: string;
  readonly status: 'passed' | 'incomplete' | 'failed';
  readonly hashVerified: boolean;
  readonly manifestVersion: string;
  readonly manifestHash: string;
  readonly inventoryHash: string;
  readonly ghVersion: string;
  readonly validatorVersion: string;
  readonly rulesVersion: string;
  readonly gates: readonly { readonly id: string; readonly pass: boolean }[];
}

export type GhReportDecodeFailure = 'report_version_unsupported' | 'report_version_superseded' | 'report_invalid';

export type GhReportDecodeOutcome =
  | { readonly ok: true; readonly report: GhDecodedRegistryReport }
  | { readonly ok: false; readonly reason: GhReportDecodeFailure; readonly version: string | null };

const HEX64 = /^[0-9a-f]{64}$/;
const REPORT_STATUSES: ReadonlySet<string> = new Set(['passed', 'incomplete', 'failed']);

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 200;
}

/** `r2` 보고서 (CR-089). 결과 계약 차원을 검증한 첫 판이다. */
function decodeR2(raw: Readonly<Record<string, unknown>>): GhDecodedRegistryReport | null {
  const { status, hashVerified, manifestVersion, manifestHash, inventoryHash, ghVersion, validatorVersion, rulesVersion, gates, dimensions, contracts } = raw;
  if (typeof status !== 'string' || !REPORT_STATUSES.has(status)) return null;
  if (typeof hashVerified !== 'boolean') return null;
  if (!nonEmptyString(manifestVersion) || !nonEmptyString(ghVersion) || !nonEmptyString(validatorVersion) || !nonEmptyString(rulesVersion)) return null;
  if (typeof manifestHash !== 'string' || !HEX64.test(manifestHash) || typeof inventoryHash !== 'string' || !HEX64.test(inventoryHash)) return null;
  if (!Array.isArray(dimensions) || typeof contracts !== 'object' || contracts === null) return null;
  if (!Array.isArray(gates)) return null;
  const decodedGates: { id: string; pass: boolean }[] = [];
  for (const gate of gates) {
    if (typeof gate !== 'object' || gate === null) return null;
    const { id, pass } = gate as Record<string, unknown>;
    if (!nonEmptyString(id) || typeof pass !== 'boolean') return null;
    decodedGates.push({ id, pass });
  }
  return { version: 'r2', status: status as GhDecodedRegistryReport['status'], hashVerified, manifestVersion, manifestHash, inventoryHash, ghVersion, validatorVersion, rulesVersion, gates: decodedGates };
}

/**
 * 등록된 판 해석기. **판 문자열의 크기를 비교하지 않는다** — `r999`처럼 알 수 없는 판은 「더 새로우니 통과」가 아니라
 * 해석할 수 없는 보고서다. 새 판을 만들면 여기에 해석기를 더하는 것이 그 판을 받아들이는 유일한 방법이다.
 * `Map`인 이유: 객체 리터럴이면 `constructor` 같은 판 문자열이 프로토타입의 함수를 해석기로 집는다.
 */
const REPORT_DECODERS: ReadonlyMap<string, (raw: Readonly<Record<string, unknown>>) => GhDecodedRegistryReport | null> = new Map([['r2', decodeR2]]);

/** 해석기는 없지만 존재를 아는 옛 판. 결과 계약 차원을 검증하지 않았으므로 승인 근거가 될 수 없다 (CR-089). */
const SUPERSEDED_REPORT_VERSIONS: ReadonlySet<string> = new Set(['r1']);

export function registeredReportVersions(): readonly string[] {
  return [...REPORT_DECODERS.keys()];
}

/** 저장된 보고서 원문을 등록된 해석기로 읽는다. 읽지 못하면 이유를 돌려준다. */
export function decodeRegistryReport(raw: unknown): GhReportDecodeOutcome {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ok: false, reason: 'report_invalid', version: null };
  const record = raw as Readonly<Record<string, unknown>>;
  const version = typeof record['reportVersion'] === 'string' ? record['reportVersion'] : null;
  if (version === null) return { ok: false, reason: 'report_invalid', version: null };
  const decoder = REPORT_DECODERS.get(version);
  if (decoder === undefined) {
    return { ok: false, reason: SUPERSEDED_REPORT_VERSIONS.has(version) ? 'report_version_superseded' : 'report_version_unsupported', version };
  }
  const report = decoder(record);
  return report === null ? { ok: false, reason: 'report_invalid', version } : { ok: true, report };
}

// ── 신선도 한도 ────────────────────────────────────────────────────────────

/** 드리프트 검사가 `--help`를 띄우는 command 수 — 별칭 전용 행은 프로세스를 띄우지 않는다. */
export function nonAliasCommandCount(manifest: Pick<GhCapabilityManifest, 'commands'>): number {
  return manifest.commands.filter((command) => command.aliasOf === null).length;
}

/**
 * 검사 한 회차의 최악 소요 — 시간 상한이 모두 꽉 찼을 때의 합이다. 추정이 아니라 설정에서 계산한다.
 *
 * 한 번의 시도 = `gh --version`(드리프트) + `gh --version`(인벤토리) + 루트 `--help` + 동시성으로 나눈 command별 `--help`.
 * 한 회차 = 시도 (재시도 + 1)회 + 재시도 대기의 합. 바이너리 해시 계산과 보고서 계산(각각 1초 미만)은 넣지 않는다.
 */
export function registryCheckRoundBudgetMs(commandsWithHelp: number): number {
  if (!Number.isSafeInteger(commandsWithHelp) || commandsWithHelp < 0) throw new Error(`command 수가 음이 아닌 정수가 아니다: ${String(commandsWithHelp)}`);
  const attempt = GH_VERSION_TIMEOUT_MS + INVENTORY_HELP_TIMEOUT_MS + INVENTORY_HELP_TIMEOUT_MS + Math.ceil(commandsWithHelp / INVENTORY_HELP_CONCURRENCY) * INVENTORY_HELP_TIMEOUT_MS;
  const attempts = REGISTRY_CHECK_RETRY_DELAYS_MS.length + 1;
  return attempts * attempt + REGISTRY_CHECK_RETRY_DELAYS_MS.reduce((sum, delay) => sum + delay, 0);
}

/**
 * 검증 근거의 신선도 한도 = 검사 주기 + 한 회차의 최악 소요.
 *
 * 주기 타이머는 기동 시각에 고정되고 진행 중인 회차가 있으면 tick을 건너뛴다. 그래서 건강한 검사기에서 이웃한 두 기록의
 * 간격은 「주기 + 한 회차의 최악 소요」를 넘지 않는다. 그보다 오래된 근거는 검사기가 결과를 내지 못하고 있다는 뜻이다.
 * 기본값(주기 1일, 비별칭 command 228): 86,400,000 + 4 × 1,190,000 + 65,000 = 91,225,000ms(25시간 20분 25초).
 */
export function registryEvidenceMaxAgeMs(input: { readonly intervalMs: number; readonly commandsWithHelp: number }): number {
  if (!Number.isSafeInteger(input.intervalMs) || input.intervalMs <= 0) throw new Error(`검사 주기가 양의 정수가 아니다: ${String(input.intervalMs)}`);
  return input.intervalMs + registryCheckRoundBudgetMs(input.commandsWithHelp);
}

// ── 정책 상태 ──────────────────────────────────────────────────────────────

export interface GhPolicyApproval {
  readonly snapshotId: number;
  readonly verificationId: number;
  readonly reportHash: string;
  readonly manifestVersion: string;
  readonly manifestHash: string;
  readonly ghVersion: string;
  readonly approvedAt: Date;
  readonly approvedBy: string;
}

/** 배포 범위 하나의 현재 운영 정책. 행이 없으면 revision 0·승인 없음·차단 없음이다. */
export interface GhPolicyState {
  readonly scope: string;
  readonly revision: number;
  readonly approval: GhPolicyApproval | null;
  readonly blockedCapabilities: readonly string[];
  readonly updatedAt: Date | null;
  readonly updatedBy: string | null;
}

export function emptyPolicyState(scope: string): GhPolicyState {
  return { scope, revision: 0, approval: null, blockedCapabilities: [], updatedAt: null, updatedBy: null };
}

// ── 레지스트리 판정 입력 ───────────────────────────────────────────────────

export type GhRegistryVerdict =
  | { readonly kind: 'ok' }
  | { readonly kind: 'stale'; readonly detail: string }
  | { readonly kind: 'expired'; readonly lastPassedAt: Date; readonly maxAgeMs: number }
  | { readonly kind: 'unchecked' };

/**
 * 실행기의 판정 입력 — 자기 인메모리 검사에서 채운다.
 *
 * 드리프트·구조 실패(`stale`)가 먼저다. 한 번도 통과하지 않았으면 `unchecked`, 마지막 통과가 신선도 한도를 넘었으면
 * `expired` — 일시 오류가 이어져 과거의 통과 하나로 무기한 실행하는 경로를 막는다.
 */
export function executorRegistryVerdict(input: {
  readonly stale: boolean;
  readonly lastPassedAt: Date | null;
  readonly now: Date;
  readonly intervalMs: number;
  readonly manifest: Pick<GhCapabilityManifest, 'commands'>;
}): GhRegistryVerdict {
  if (input.stale) return { kind: 'stale', detail: 'registry_check_failed' };
  if (input.lastPassedAt === null) return { kind: 'unchecked' };
  const maxAgeMs = registryEvidenceMaxAgeMs({ intervalMs: input.intervalMs, commandsWithHelp: nonAliasCommandCount(input.manifest) });
  if (input.now.getTime() - input.lastPassedAt.getTime() > maxAgeMs) return { kind: 'expired', lastPassedAt: input.lastPassedAt, maxAgeMs };
  return { kind: 'ok' };
}

/** DB에 남은 실행기 기록 하나 — 레지스트리 판정에 필요한 부분. */
export interface GhRecordedCheck {
  readonly status: string;
  readonly manifestHashExpected: string;
}

/**
 * API의 판정 입력 — 이 배포 범위에서 **일시 오류(`error`)를 뺀 가장 최근** 실행기 기록으로 채운다.
 *
 * 실행기가 일시 오류에서 이전 판정을 유지하는 규칙과 같다. 기록이 적재 정의와 다른 manifest를 가리키면 실행기가 다른
 * 정의를 싣고 있다는 뜻이므로 막는다. 신선도는 여기서 보지 않는다 — 기록 실패(DB)는 실행기의 판정을 바꾸지 않으므로
 * 그 사실을 아는 실행기가 claim에서 본다.
 */
export function recordedRegistryVerdict(input: { readonly manifestHash: string; readonly latestDecisive: GhRecordedCheck | null }): GhRegistryVerdict {
  const latest = input.latestDecisive;
  if (latest === null) return { kind: 'unchecked' };
  if (latest.manifestHashExpected !== input.manifestHash) return { kind: 'stale', detail: 'executor_definition_differs' };
  if (latest.status === 'passed') return { kind: 'ok' };
  return { kind: 'stale', detail: `latest_check_${latest.status}` };
}

// ── 실행 판정 ──────────────────────────────────────────────────────────────

export type GhExecutionGateReason =
  | 'operations_disabled'
  | 'capability_not_executable'
  | 'policy_unavailable'
  | 'admin_action_required'
  | 'policy_blocked'
  | 'policy_changed'
  | 'registry_stale'
  | 'registry_evidence_expired'
  | 'registry_unchecked';

export interface GhExecutionGateInput {
  readonly operationsEnabled: boolean;
  readonly capabilityId: string;
  /** 이 프로세스가 적재한 정의. */
  readonly manifest: Pick<GhCapabilityManifest, 'ghVersion' | 'manifestVersion' | 'hash' | 'commands'>;
  /** 정책 상태. 읽지 못했으면 `'unavailable'` — 그때는 실행을 허용하지 않는다. */
  readonly policy: GhPolicyState | 'unavailable';
  readonly registry: GhRegistryVerdict;
  /**
   * 대기 요청을 집을 때만 준다 — 요청을 수락한 시점의 revision. 수락 판정에서는 넘기지 않는다.
   * 과거 revision의 요청은 현재 정책이 허용해도 승계하지 않는다 (FR-GH-012 AC-4, FR-GH-011 AC-9).
   */
  readonly acceptedRevision?: number | null;
}

export type GhExecutionGate =
  | { readonly allowed: true; readonly revision: number }
  | { readonly allowed: false; readonly reason: GhExecutionGateReason; readonly revision: number | null; readonly detail: string | null };

/** 이 capability가 코드와 manifest 둘 다에서 열려 있는가 — 실행 허용의 상한이다. 정책은 이것을 넓히지 못한다. */
export function isExecutableByCode(manifest: Pick<GhCapabilityManifest, 'commands'>, capabilityId: string): boolean {
  const command = manifest.commands.find((entry) => entry.id === capabilityId);
  return command !== undefined && command.execution === 'allowed' && findCapability(capabilityId)?.execution === 'allowed';
}

/** 승인 정의가 적재 정의와 같은가. 다르면 다른 스냅숏으로 옮겨 가거나 이전 정의로 돌아가지 않는다. */
export function approvalMatchesManifest(approval: GhPolicyApproval | null, manifest: Pick<GhCapabilityManifest, 'ghVersion' | 'manifestVersion' | 'hash'>): boolean {
  return (
    approval !== null &&
    approval.manifestHash === manifest.hash &&
    approval.manifestVersion === manifest.manifestVersion &&
    approval.ghVersion === manifest.ghVersion &&
    manifest.ghVersion === GH_PINNED_VERSION
  );
}

/**
 * 실행 허용 판정. 순서가 사용자에게 보이는 사유의 순서다 — 기능 꺼짐 → 상한 → 정책을 읽을 수 있는가 → 운영 승인 →
 * 운영자 차단 → 대기 요청의 revision → 레지스트리. 사용자 연결·권한·저장소는 이 판정 뒤의 기존 재검증이 본다.
 */
export function decideExecution(input: GhExecutionGateInput): GhExecutionGate {
  const policyRevision = input.policy === 'unavailable' ? null : input.policy.revision;
  const deny = (reason: GhExecutionGateReason, detail: string | null = null): GhExecutionGate => ({ allowed: false, reason, revision: policyRevision, detail });
  if (!input.operationsEnabled) return deny('operations_disabled');
  if (!isExecutableByCode(input.manifest, input.capabilityId)) return deny('capability_not_executable');
  if (input.policy === 'unavailable') return deny('policy_unavailable');
  const policy = input.policy;
  if (!approvalMatchesManifest(policy.approval, input.manifest)) {
    return deny('admin_action_required', policy.approval === null ? 'no_approval' : 'approved_definition_differs');
  }
  if (policy.blockedCapabilities.includes(input.capabilityId)) return deny('policy_blocked', 'operator_blocked');
  if (input.acceptedRevision !== undefined && input.acceptedRevision !== policy.revision) {
    return deny('policy_changed', `accepted_${String(input.acceptedRevision)}_current_${String(policy.revision)}`);
  }
  switch (input.registry.kind) {
    case 'stale':
      return deny('registry_stale', input.registry.detail);
    case 'expired':
      return deny('registry_evidence_expired', `last_passed_${input.registry.lastPassedAt.toISOString()}`);
    case 'unchecked':
      return deny('registry_unchecked');
    case 'ok':
      return { allowed: true, revision: policy.revision };
  }
}

// ── 승인 자격 ──────────────────────────────────────────────────────────────

export type GhApprovalIneligibleReason =
  | 'snapshot_missing'
  | 'snapshot_unclassified'
  | 'evidence_missing'
  | 'evidence_not_passed'
  | 'evidence_other_definition'
  | 'evidence_manifest_mismatch'
  | 'evidence_binary_mismatch'
  | 'evidence_inventory_mismatch'
  | 'evidence_cadence_unknown'
  | 'evidence_stale'
  | GhReportDecodeFailure
  | 'report_hash_mismatch'
  | 'report_not_reproducible'
  | 'report_not_passed'
  | 'gate_not_passed'
  | 'already_approved';

export interface GhApprovalSnapshot {
  readonly snapshotId: number;
  readonly ghVersion: string;
  readonly manifestVersion: string;
  readonly manifestHash: string;
  readonly inventoryHash: string;
  readonly unclassifiedCount: number;
  readonly interactionUnclassifiedCount: number;
  readonly flagUnclassifiedCount: number;
  readonly positionalUnclassifiedCount: number;
  readonly activatedAt: Date | null;
}

export interface GhApprovalEvidence {
  readonly verificationId: number;
  readonly snapshotId: number;
  readonly checkedAt: Date;
  readonly checkedBy: string;
  readonly scope: string | null;
  readonly trigger: string;
  readonly status: string;
  readonly environment: Readonly<Record<string, unknown>>;
  readonly ghVersionExpected: string;
  readonly ghVersionObserved: string | null;
  readonly binarySha256Expected: string;
  readonly binarySha256Observed: string | null;
  readonly manifestHashExpected: string;
  readonly manifestHashObserved: string | null;
  readonly inventoryHashExpected: string;
  readonly inventoryHashObserved: string | null;
  readonly report: unknown;
  readonly reportHash: string;
}

export interface GhApprovalEligibilityInput {
  readonly scope: string;
  /** 서버가 적재한 정의 — 승인 대상이다. 클라이언트가 고르지 않는다. */
  readonly manifest: GhCapabilityManifest;
  /** 서버가 같은 정의로 만든 보고서. 저장 보고서와 해시가 같아야 재현된 것이다. */
  readonly servedReport: GhRegistryReport;
  readonly snapshot: GhApprovalSnapshot | null;
  /** 이 배포 범위의 **가장 최근** 실행기 기록(일시 오류 포함). */
  readonly latestEvidence: GhApprovalEvidence | null;
  readonly policy: GhPolicyState;
  readonly now: Date;
}

export interface GhApprovalEligibility {
  readonly eligible: boolean;
  readonly reasons: readonly { readonly code: GhApprovalIneligibleReason; readonly detail: string | null }[];
  readonly snapshotId: number | null;
  readonly verificationId: number | null;
  readonly reportHash: string | null;
  readonly reportVersion: string | null;
  readonly evidenceCheckedAt: Date | null;
  readonly evidenceMaxAgeMs: number | null;
  readonly evidenceExpiresAt: Date | null;
  readonly gates: readonly { readonly id: string; readonly pass: boolean }[];
  /** 승인해도 실제로 열리는 capability — 코드와 manifest가 둘 다 연 것뿐이다. */
  readonly opens: readonly string[];
}

/** 실행기 기록의 환경에서 검사 주기를 읽는다. 옛 실행기의 기록에는 없다. */
export function evidenceIntervalMs(environment: Readonly<Record<string, unknown>>): number | null {
  const raw = environment['registry_check_ms'];
  return typeof raw === 'number' && Number.isSafeInteger(raw) && raw >= 60_000 && raw <= 7 * 86_400_000 ? raw : null;
}

/**
 * 운영 승인 자격. **모든 이유를 모은다** — 화면이 「무엇을 고치면 승인할 수 있나」를 한 번에 보여 줄 수 있어야 한다.
 * DB 함수가 잠금 아래에서 같은 기록의 DB 쪽 사실을 다시 확인하지만, 보고서 해석과 재현 해시는 여기서만 한다.
 */
export function evaluateApprovalEligibility(input: GhApprovalEligibilityInput): GhApprovalEligibility {
  const reasons: { code: GhApprovalIneligibleReason; detail: string | null }[] = [];
  const add = (code: GhApprovalIneligibleReason, detail: string | null = null): void => {
    reasons.push({ code, detail });
  };
  const manifest = input.manifest;
  const opens = manifest.commands.filter((command) => isExecutableByCode(manifest, command.id)).map((command) => command.id);
  const snapshot = input.snapshot;
  const evidence = input.latestEvidence;

  if (snapshot === null) add('snapshot_missing');
  else if (snapshot.unclassifiedCount + snapshot.interactionUnclassifiedCount + snapshot.flagUnclassifiedCount + snapshot.positionalUnclassifiedCount > 0) add('snapshot_unclassified');

  let reportVersion: string | null = null;
  let gates: { id: string; pass: boolean }[] = [];
  let evidenceMaxAgeMs: number | null = null;
  let evidenceExpiresAt: Date | null = null;

  if (evidence === null) {
    add('evidence_missing');
  } else {
    // 호출자가 범위의 실행기 기록을 골라 넘기지만 믿지 않는다 — CLI·CI 기록이나 다른 배포 범위의 기록은 근거가 아니다.
    if (evidence.checkedBy !== 'gh-executor' || evidence.scope !== input.scope) add('evidence_missing', 'not_executor_record_for_scope');
    if (evidence.status !== 'passed') add('evidence_not_passed', evidence.status);
    if (snapshot !== null && (evidence.snapshotId !== snapshot.snapshotId || evidence.manifestHashExpected !== snapshot.manifestHash)) add('evidence_other_definition');
    else if (evidence.manifestHashExpected !== manifest.hash) add('evidence_other_definition');
    if (evidence.manifestHashObserved !== evidence.manifestHashExpected) add('evidence_manifest_mismatch');
    if (
      evidence.binarySha256Observed !== evidence.binarySha256Expected ||
      evidence.binarySha256Expected !== GH_PINNED_LINUX_AMD64.binarySha256 ||
      evidence.ghVersionObserved !== evidence.ghVersionExpected ||
      evidence.ghVersionExpected !== GH_PINNED_VERSION ||
      (snapshot !== null && snapshot.ghVersion !== evidence.ghVersionExpected)
    ) {
      add('evidence_binary_mismatch');
    }
    if (evidence.inventoryHashObserved !== evidence.inventoryHashExpected || (snapshot !== null && snapshot.inventoryHash !== evidence.inventoryHashExpected)) add('evidence_inventory_mismatch');

    const intervalMs = evidenceIntervalMs(evidence.environment);
    if (intervalMs === null) {
      add('evidence_cadence_unknown');
    } else {
      evidenceMaxAgeMs = registryEvidenceMaxAgeMs({ intervalMs, commandsWithHelp: nonAliasCommandCount(manifest) });
      evidenceExpiresAt = new Date(evidence.checkedAt.getTime() + evidenceMaxAgeMs);
      const age = input.now.getTime() - evidence.checkedAt.getTime();
      if (age > evidenceMaxAgeMs || age < 0) add('evidence_stale', age < 0 ? 'checked_in_future' : null);
    }

    const decoded = decodeRegistryReport(evidence.report);
    if (!decoded.ok) {
      reportVersion = decoded.version;
      add(decoded.reason, decoded.version);
    } else {
      const report = decoded.report;
      reportVersion = report.version;
      gates = report.gates.map((gate) => ({ id: gate.id, pass: gate.pass }));
      // 저장된 해시가 보고서 내용과 같은가 — 기록 안에서의 무결성.
      if (reportHash(evidence.report as GhRegistryReport) !== evidence.reportHash) add('report_hash_mismatch');
      // 서버가 같은 정의로 만든 보고서와 같은가 — 실행기와 API가 같은 검증기·같은 manifest를 보고 있는가.
      if (reportHash(input.servedReport) !== evidence.reportHash) add('report_not_reproducible');
      if (report.status !== 'passed' || !report.hashVerified || report.manifestHash !== manifest.hash || report.manifestVersion !== manifest.manifestVersion || report.ghVersion !== GH_PINNED_VERSION) {
        add('report_not_passed', report.status);
      }
      const failing = REQUIRED_APPROVAL_GATES.filter((id) => report.gates.find((gate) => gate.id === id)?.pass !== true);
      if (failing.length > 0) add('gate_not_passed', failing.join(','));
    }
  }

  if (snapshot !== null && input.policy.approval !== null && input.policy.approval.snapshotId === snapshot.snapshotId && approvalMatchesManifest(input.policy.approval, manifest)) {
    add('already_approved');
  }

  return {
    eligible: reasons.length === 0,
    reasons,
    snapshotId: snapshot?.snapshotId ?? null,
    verificationId: evidence?.verificationId ?? null,
    reportHash: evidence?.reportHash ?? null,
    reportVersion,
    evidenceCheckedAt: evidence?.checkedAt ?? null,
    evidenceMaxAgeMs,
    evidenceExpiresAt,
    gates,
    opens,
  };
}
