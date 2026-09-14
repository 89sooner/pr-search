/**
 * 운영 정책 — 레지스트리 운영 승인과 capability 차단 (API-GH-008 / A-005·A-006, FR-GH-011 AC-6~AC-10, FR-GH-009 AC-8, CR-090).
 *
 * ## 이 모듈이 하는 것
 *
 * - **조회** — 현재 적재한 정의, 현재 정책(revision·승인·차단), 승인 미리보기(자격·근거·게이트·열리는 것), 최근 revision.
 * - **변경** — 승인·철회·차단·재개를 **한 트랜잭션·한 배타 잠금** 안에서 판정하고 DB 함수로 쓴다. 판정과 쓰기 사이에 다른
 *   변경·새 검증 기록·실행권 확정이 끼어들지 못한다(잠금 키 `gh:policy:<scope>`).
 *
 * ## 이 모듈이 하지 않는 것
 *
 * - 정책 표를 직접 쓰지 않는다 — `prs_app`에는 권한이 없다. 함수 `gh_operations_policy_apply`가 revision·이력·감사를
 *   한 트랜잭션으로 남긴다(FR-AUTH-004 AC-6 예외).
 * - 검사를 돌리지 않는다. 인벤토리 추출은 20~30초가 들고 요청 경로에 두지 않는다 — 근거가 없거나 오래됐으면 그 사실을 사유로 낸다.
 * - 브라우저가 보낸 결과·해시를 믿지 않는다. 승인 요청의 스냅숏·기록·보고서 해시는 **미리보기에 묶였는가**만 확인하는 값이며,
 *   자격은 서버가 적재한 정의와 DB 근거로 다시 판정한다.
 * - 실행 허용을 넓히지 않는다. 차단·재개의 대상은 코드와 manifest가 이미 연 capability뿐이다.
 */

import { createHash } from 'node:crypto';
import { ghPolicyRepo, ghRegistryRepo, withTransaction, type GhCapabilitySnapshotRow, type GhCapabilityVerificationRow, type GhPolicyAction, type Pool, type PoolClient } from '@prs/db';
import {
  GH_PINNED_VERSION,
  REQUIRED_APPROVAL_GATES,
  canonicalJson,
  decideExecution,
  evaluateApprovalEligibility,
  evidenceIntervalMs,
  isExecutableByCode,
  recordedRegistryVerdict,
  reportHash,
  type GhApprovalEligibility,
  type GhApprovalEvidence,
  type GhApprovalSnapshot,
  type GhCapabilityManifest,
  type GhExecutionGate,
  type GhPolicyState,
} from '@prs/gh-cli';
import { reportFor } from './registry.js';

export const POLICY_ACTIONS: readonly GhPolicyAction[] = ['approve', 'revoke', 'block', 'resume'];
export const POLICY_REASON_MAX = 500;
const CAPABILITY_ID_PATTERN = /^[a-z0-9][a-z0-9.-]{0,79}$/;
const HEX64 = /^[0-9a-f]{64}$/;

export interface PolicyDeps {
  readonly pool: Pool;
  readonly manifest: GhCapabilityManifest;
  /** 배포 범위 = `GHE_BASE_URL`의 호스트. 클라이언트가 지정하지 않는다. */
  readonly scope: string;
  readonly operationsEnabled: boolean;
}

/** 거절. `code`는 API 오류 코드, `detail`은 응답에 싣는 사실. */
export class PolicyRequestRejected extends Error {
  constructor(
    readonly code: 'INVALID_PARAMETER' | 'GH_POLICY_CONFLICT' | 'GH_REGISTRY_APPROVAL_INELIGIBLE' | 'GH_DUPLICATE_REQUEST' | 'GH_POLICY_UNAVAILABLE',
    message: string,
    /**
     * 감사 결과 코드 — `invalid`·`conflict`·`ineligible`·`key_reused`. `null`이면 남기지 않는다: 결정을 판정하지 못한
     * 인프라 사유(정책 잠금 대기 초과)는 결정의 거절이 아니고 정본 결과 어휘에도 없다.
     */
    readonly auditResult: 'invalid' | 'conflict' | 'ineligible' | 'key_reused' | null,
    readonly detail?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = 'PolicyRequestRejected';
  }
}

const iso = (value: Date | null): string | null => (value === null ? null : value.toISOString());

function snapshotInput(row: GhCapabilitySnapshotRow): GhApprovalSnapshot {
  return {
    snapshotId: row.snapshot_id,
    ghVersion: row.gh_version,
    manifestVersion: row.manifest_version,
    manifestHash: row.manifest_hash,
    inventoryHash: row.inventory_hash,
    unclassifiedCount: row.unclassified_count,
    interactionUnclassifiedCount: row.interaction_unclassified_count,
    flagUnclassifiedCount: row.flag_unclassified_count,
    positionalUnclassifiedCount: row.positional_unclassified_count,
    activatedAt: row.activated_at,
  };
}

function evidenceInput(row: GhCapabilityVerificationRow): GhApprovalEvidence {
  return {
    verificationId: row.verification_id,
    snapshotId: row.snapshot_id,
    checkedAt: row.checked_at,
    checkedBy: row.checked_by,
    scope: row.scope,
    trigger: row.trigger,
    status: row.status,
    environment: row.environment,
    ghVersionExpected: row.gh_version_expected,
    ghVersionObserved: row.gh_version_observed,
    binarySha256Expected: row.binary_sha256_expected,
    binarySha256Observed: row.binary_sha256_observed,
    manifestHashExpected: row.manifest_hash_expected,
    manifestHashObserved: row.manifest_hash_observed,
    inventoryHashExpected: row.inventory_hash_expected,
    inventoryHashObserved: row.inventory_hash_observed,
    report: row.report,
    reportHash: row.report_hash,
  };
}

interface PolicyFacts {
  readonly now: Date;
  readonly policy: GhPolicyState;
  readonly snapshot: GhCapabilitySnapshotRow | null;
  readonly latestEvidence: GhCapabilityVerificationRow | null;
  readonly eligibility: GhApprovalEligibility;
}

/** 판정에 쓰는 사실을 한 연결에서 읽는다. 시각은 DB의 `now()` — 신선도를 DB 함수와 같은 시계로 잰다. */
async function readFacts(deps: PolicyDeps, db: Pool | PoolClient): Promise<PolicyFacts> {
  const nowRow = await db.query<{ now: Date }>('SELECT now() AS now');
  const now = nowRow.rows[0]?.now ?? new Date();
  const [row, snapshot, latestEvidence] = await Promise.all([
    ghPolicyRepo.findPolicy(db, deps.scope),
    ghRegistryRepo.findSnapshot(db, deps.manifest.manifestVersion, deps.manifest.hash),
    ghRegistryRepo.latestExecutorVerification(db, deps.scope, { excludeTransientErrors: false }),
  ]);
  const policy = ghPolicyRepo.policyStateOf(deps.scope, row);
  const eligibility = evaluateApprovalEligibility({
    scope: deps.scope,
    manifest: deps.manifest,
    servedReport: reportFor(deps.manifest),
    snapshot: snapshot === null ? null : snapshotInput(snapshot),
    latestEvidence: latestEvidence === null ? null : evidenceInput(latestEvidence),
    policy,
    now,
  });
  return { now, policy, snapshot, latestEvidence, eligibility };
}

/**
 * 실행 수락 판정 (API-GH-001·002). **실행기의 claim과 같은 함수**(`decideExecution`)이며 입력만 이 프로세스의 것이다 —
 * 정책은 DB, 레지스트리는 이 범위에서 일시 오류를 뺀 가장 최근 실행기 기록. 정책을 읽지 못하면 `policy_unavailable`이다.
 */
export async function executionGate(deps: PolicyDeps, capabilityId: string): Promise<GhExecutionGate> {
  let policy: GhPolicyState | 'unavailable';
  let latestDecisive: GhCapabilityVerificationRow | null = null;
  try {
    const [row, latest] = await Promise.all([
      ghPolicyRepo.findPolicy(deps.pool, deps.scope),
      ghRegistryRepo.latestExecutorVerification(deps.pool, deps.scope, { excludeTransientErrors: true }),
    ]);
    policy = ghPolicyRepo.policyStateOf(deps.scope, row);
    latestDecisive = latest;
  } catch {
    policy = 'unavailable';
  }
  return decideExecution({
    operationsEnabled: deps.operationsEnabled,
    capabilityId,
    manifest: deps.manifest,
    policy,
    registry: recordedRegistryVerdict({
      manifestHash: deps.manifest.hash,
      latestDecisive: latestDecisive === null ? null : { status: latestDecisive.status, manifestHashExpected: latestDecisive.manifest_hash_expected },
    }),
  });
}

export function gateView(gate: GhExecutionGate): Record<string, unknown> {
  return gate.allowed ? { allowed: true, reason: null, detail: null, revision: gate.revision } : { allowed: false, reason: gate.reason, detail: gate.detail, revision: gate.revision };
}

function policyStateView(policy: GhPolicyState, manifest: GhCapabilityManifest): Record<string, unknown> {
  const approval = policy.approval;
  return {
    revision: policy.revision,
    updated_at: iso(policy.updatedAt),
    updated_by: policy.updatedBy,
    approval:
      approval === null
        ? null
        : {
            snapshot_id: approval.snapshotId,
            verification_id: approval.verificationId,
            report_hash: approval.reportHash,
            manifest_version: approval.manifestVersion,
            manifest_hash: approval.manifestHash,
            gh_version: approval.ghVersion,
            approved_at: approval.approvedAt.toISOString(),
            approved_by: approval.approvedBy,
            /** 승인 정의가 지금 이 API가 적재한 정의와 같은가. 아니면 재승인이 필요하다(`admin_action_required`). */
            matches_served: approval.manifestHash === manifest.hash && approval.manifestVersion === manifest.manifestVersion && approval.ghVersion === manifest.ghVersion,
          },
    blocked_capabilities: policy.blockedCapabilities,
  };
}

/** API-GH-008 조회 본문. `operator`·`security_officer`가 읽는다. 중복 방지 키·요청 지문은 내지 않는다. */
export async function policyStatus(deps: PolicyDeps): Promise<Record<string, unknown>> {
  const facts = await readFacts(deps, deps.pool);
  const eligibility = facts.eligibility;
  const evidence = facts.latestEvidence;
  const revisions = await ghPolicyRepo.listPolicyRevisions(deps.pool, deps.scope, 20);
  const served = reportFor(deps.manifest);
  const executable = deps.manifest.commands.filter((command) => isExecutableByCode(deps.manifest, command.id));
  const leafCount = deps.manifest.commands.filter((command) => !command.group && command.aliasOf === null).length;
  const capabilities = await Promise.all(
    executable.map(async (command) => ({
      id: command.id,
      blocked: facts.policy.blockedCapabilities.includes(command.id),
      gate: gateView(await executionGate(deps, command.id)),
    })),
  );
  return {
    scope: deps.scope,
    now: facts.now.toISOString(),
    served: {
      gh_version: deps.manifest.ghVersion,
      pinned_version: GH_PINNED_VERSION,
      manifest_version: deps.manifest.manifestVersion,
      manifest_hash: deps.manifest.hash,
      inventory_hash: served.inventoryHash,
      report_version: served.reportVersion,
      report_hash: reportHash(served),
      validator_version: served.validatorVersion,
      snapshot_id: facts.snapshot?.snapshot_id ?? null,
      snapshot_activated_at: iso(facts.snapshot?.activated_at ?? null),
    },
    policy: policyStateView(facts.policy, deps.manifest),
    approval_preview: {
      eligible: eligibility.eligible,
      reasons: eligibility.reasons,
      /** 승인 요청은 이 세 값과 `expected_revision`을 그대로 되돌려 보낸다 — 그 사이 근거가 바뀌면 충돌로 거절된다. */
      snapshot_id: eligibility.snapshotId,
      verification_id: eligibility.verificationId,
      report_hash: eligibility.reportHash,
      report_version: eligibility.reportVersion,
      evidence:
        evidence === null
          ? null
          : {
              verification_id: evidence.verification_id,
              checked_at: evidence.checked_at.toISOString(),
              checked_by: evidence.checked_by,
              trigger: evidence.trigger,
              status: evidence.status,
              executor_id: typeof evidence.environment['executor_id'] === 'string' ? evidence.environment['executor_id'] : null,
              hostname: typeof evidence.environment['hostname'] === 'string' ? evidence.environment['hostname'] : null,
              registry_check_ms: evidenceIntervalMs(evidence.environment),
            },
      evidence_max_age_ms: eligibility.evidenceMaxAgeMs,
      evidence_expires_at: iso(eligibility.evidenceExpiresAt),
      gates: eligibility.gates,
      required_gates: REQUIRED_APPROVAL_GATES,
      opens: eligibility.opens,
      not_opened: {
        leaf_commands: leafCount,
        executable_commands: executable.length,
        not_executable_commands: leafCount - executable.length,
        recipes: 'not_available',
        write_risk_levels: 'not_available',
        gh_api: 'not_available',
        extensions: 'not_available',
        file_operations: 'not_available',
      },
      scope_note: '이 승인은 이 배포 범위의 현재 R0 정의에 대한 운영 승인이다 — 196개 명령의 실행 허용·사내 GHES 확인·REL-007 완료가 아니다',
    },
    capabilities,
    revisions: revisions.map((revision) => ({
      revision: revision.revision,
      previous_revision: revision.previous_revision,
      action: revision.action,
      capability_id: revision.capability_id,
      snapshot_id: revision.snapshot_id,
      verification_id: revision.verification_id,
      report_hash: revision.report_hash,
      manifest_version: revision.manifest_version,
      manifest_hash: revision.manifest_hash,
      gh_version: revision.gh_version,
      actor: revision.actor,
      reason: revision.reason,
      correlation_id: revision.correlation_id,
      created_at: revision.created_at.toISOString(),
    })),
    host_verification: {
      status: 'not_verified',
      note: '사내 GHES에서 실제로 확인한 command가 없다 — 운영 승인은 이 사실을 바꾸지 않는다 (FR-GH-011 AC-4·AC-5)',
    },
  };
}

export interface PolicyChangeRequest {
  readonly action: GhPolicyAction;
  readonly expectedRevision: number;
  readonly reason: string;
  readonly capabilityId: string | null;
  readonly snapshotId: number | null;
  readonly verificationId: number | null;
  readonly reportHash: string | null;
}

// eslint-disable-next-line no-control-regex -- 사유에 제어 문자(줄바꿈·탭 제외)가 섞이면 감사 query 칸이 로그·화면을 흔든다.
const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

function positiveInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null;
}

/** 본문의 모양만 본다. 값이 정책상 되는지는 판정과 DB 함수가 본다. */
export function parsePolicyChange(body: unknown, manifest: GhCapabilityManifest): PolicyChangeRequest {
  const invalid = (message: string, field: string): PolicyRequestRejected => new PolicyRequestRejected('INVALID_PARAMETER', message, 'invalid', { field });
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw invalid('본문이 객체가 아니다', 'body');
  const record = body as Record<string, unknown>;
  const action = record['action'];
  if (typeof action !== 'string' || !(POLICY_ACTIONS as readonly string[]).includes(action)) throw invalid(`action은 ${POLICY_ACTIONS.join('·')} 중 하나여야 한다`, 'action');
  const expected = record['expected_revision'];
  if (typeof expected !== 'number' || !Number.isSafeInteger(expected) || expected < 0) throw invalid('expected_revision은 0 이상의 정수여야 한다', 'expected_revision');
  const rawReason = record['reason'];
  const reason = typeof rawReason === 'string' ? rawReason.trim() : '';
  if (reason === '' || [...reason].length > POLICY_REASON_MAX || CONTROL_CHARS.test(reason)) throw invalid(`reason은 1~${String(POLICY_REASON_MAX)}자의 문장이어야 한다(제어 문자 없음)`, 'reason');

  let capabilityId: string | null = null;
  let snapshotId: number | null = null;
  let verificationId: number | null = null;
  let reportHashValue: string | null = null;
  if (action === 'block' || action === 'resume') {
    const raw = record['capability_id'];
    if (typeof raw !== 'string' || !CAPABILITY_ID_PATTERN.test(raw)) throw invalid('capability_id가 없다', 'capability_id');
    // 정책은 실행 구현 목록을 줄일 수만 있다 — 코드와 manifest가 연 것만 대상이다 (FR-GH-009 AC-8).
    if (!isExecutableByCode(manifest, raw)) throw invalid(`이 배포가 실행을 열지 않은 capability는 차단·재개 대상이 아니다: ${raw}`, 'capability_id');
    capabilityId = raw;
  }
  if (action === 'approve') {
    snapshotId = positiveInteger(record['snapshot_id']);
    verificationId = positiveInteger(record['verification_id']);
    const rawHash = record['report_hash'];
    reportHashValue = typeof rawHash === 'string' && HEX64.test(rawHash) ? rawHash : null;
    if (snapshotId === null || verificationId === null || reportHashValue === null) {
      throw invalid('승인은 미리보기의 snapshot_id·verification_id·report_hash를 함께 보내야 한다', 'approval_preview');
    }
  }
  return { action: action as GhPolicyAction, expectedRevision: expected, reason, capabilityId, snapshotId, verificationId, reportHash: reportHashValue };
}

/** 같은 키의 재요청이 같은 내용인지 가르는 지문. 사유까지 포함한다 — 다른 사유로 같은 키를 쓰면 다른 요청이다. */
export function requestFingerprint(scope: string, request: PolicyChangeRequest): string {
  return createHash('sha256')
    .update(
      canonicalJson({
        scope,
        action: request.action,
        expected_revision: request.expectedRevision,
        reason: request.reason,
        capability_id: request.capabilityId,
        snapshot_id: request.snapshotId,
        verification_id: request.verificationId,
        report_hash: request.reportHash,
      }),
    )
    .digest('hex');
}

export interface PolicyChangeOutcome {
  readonly outcome: 'applied' | 'replayed';
  readonly revision: number;
  readonly auditTarget: string;
}

export function auditTargetOf(scope: string, request: Pick<PolicyChangeRequest, 'action' | 'capabilityId'>): string {
  return request.action === 'block' || request.action === 'resume' ? `${scope}/${request.capabilityId ?? ''}` : scope;
}

/**
 * 정책을 바꾼다. 한 트랜잭션·한 배타 잠금 안에서 (1) 같은 키의 기존 revision (2) 기대 revision (3) 승인이면 자격과
 * 미리보기 묶음을 본 뒤 함수를 부른다. 함수가 같은 사실을 DB에서 다시 확인하고 revision·이력·감사를 함께 쓴다.
 *
 * @throws {PolicyRequestRejected} 거절이면. 호출자가 결과 코드로 감사를 남긴다(트랜잭션 밖, best-effort).
 */
export async function changePolicy(deps: PolicyDeps, actor: string, request: PolicyChangeRequest, idempotencyKey: string, correlationId: string): Promise<PolicyChangeOutcome> {
  const fingerprint = requestFingerprint(deps.scope, request);
  const auditTarget = auditTargetOf(deps.scope, request);
  try {
    return await withTransaction(deps.pool, async (client) => {
      await ghPolicyRepo.lockPolicyExclusive(client, deps.scope);
      const input = {
        scope: deps.scope,
        action: request.action,
        expectedRevision: request.expectedRevision,
        actor,
        reason: request.reason,
        correlationId,
        idempotencyKey,
        requestFingerprint: fingerprint,
        capabilityId: request.capabilityId,
        snapshotId: request.snapshotId,
        verificationId: request.verificationId,
        reportHash: request.reportHash,
      };
      // 같은 키의 기존 요청이면 판정을 다시 하지 않는다 — 함수가 같은 지문이면 기존 결과를, 다르면 거절을 낸다.
      const previous = await ghPolicyRepo.findRevisionByKey(client, deps.scope, actor, idempotencyKey);
      if (previous !== null) {
        const replayed = await ghPolicyRepo.applyPolicyChange(client, { ...input, evidenceMaxAgeMs: null });
        return { outcome: replayed.outcome, revision: replayed.revision, auditTarget };
      }
      const facts = await readFacts(deps, client);
      if (facts.policy.revision !== request.expectedRevision) {
        throw new PolicyRequestRejected('GH_POLICY_CONFLICT', '정책이 확인한 뒤 바뀌었다 — 다시 확인하고 제출한다', 'conflict', { reason: 'revision_changed', current_revision: facts.policy.revision });
      }
      let evidenceMaxAgeMs: number | null = null;
      if (request.action === 'approve') {
        const eligibility = facts.eligibility;
        // 미리보기에 묶였는가 — 그 사이 근거·스냅숏이 바뀌었으면 예전 확인을 적용하지 않는다 (FR-GH-011 AC-8).
        if (eligibility.snapshotId !== request.snapshotId || eligibility.verificationId !== request.verificationId || eligibility.reportHash !== request.reportHash) {
          throw new PolicyRequestRejected('GH_POLICY_CONFLICT', '승인 근거가 확인한 뒤 바뀌었다 — 미리보기를 다시 확인한다', 'conflict', {
            reason: 'evidence_changed',
            current_revision: facts.policy.revision,
            snapshot_id: eligibility.snapshotId,
            verification_id: eligibility.verificationId,
            report_hash: eligibility.reportHash,
          });
        }
        if (!eligibility.eligible) {
          throw new PolicyRequestRejected('GH_REGISTRY_APPROVAL_INELIGIBLE', '현재 근거로는 운영 승인할 수 없다', 'ineligible', { reasons: eligibility.reasons });
        }
        evidenceMaxAgeMs = eligibility.evidenceMaxAgeMs;
      }
      const applied = await ghPolicyRepo.applyPolicyChange(client, { ...input, evidenceMaxAgeMs });
      return { outcome: applied.outcome, revision: applied.revision, auditTarget };
    });
  } catch (error) {
    if (error instanceof PolicyRequestRejected) throw error;
    if (error instanceof ghPolicyRepo.PolicyChangeRejected) {
      switch (error.kind) {
        case 'conflict':
          throw new PolicyRequestRejected('GH_POLICY_CONFLICT', '정책이나 근거가 확인한 뒤 바뀌었다 — 다시 확인하고 제출한다', 'conflict', {
            reason: error.reason,
            ...(error.reason === 'revision_changed' && error.detail !== null ? { current_revision: Number(error.detail) } : {}),
          });
        case 'no_change':
          throw new PolicyRequestRejected('GH_POLICY_CONFLICT', '바꿀 것이 없다 — 이미 그 상태다', 'conflict', { reason: error.reason });
        case 'key_reused':
          throw new PolicyRequestRejected('GH_DUPLICATE_REQUEST', '같은 중복 방지 키가 다른 내용의 요청에 이미 쓰였다', 'key_reused', {
            reason: 'idempotency_key_reused',
            ...(error.detail === null ? {} : { revision: Number(error.detail) }),
          });
        case 'ineligible':
          throw new PolicyRequestRejected('GH_REGISTRY_APPROVAL_INELIGIBLE', '현재 근거로는 운영 승인할 수 없다', 'ineligible', { reasons: [{ code: error.reason, detail: null }] });
        case 'invalid':
          throw new PolicyRequestRejected('INVALID_PARAMETER', `요청 값이 틀렸다: ${error.reason}`, 'invalid', { field: error.reason });
      }
    }
    if (ghPolicyRepo.isPolicyLockTimeout(error)) {
      // 다른 정책 변경이 잠금을 오래 쥐었다. 트랜잭션이 롤백돼 적용된 것이 없으므로 새 키로 다시 제출해도 두 번 적용되지 않는다.
      throw new PolicyRequestRejected('GH_POLICY_UNAVAILABLE', '다른 운영 정책 변경이 진행 중이라 잠금을 얻지 못했다 — 잠시 후 다시 확인하고 제출한다', null, { reason: 'policy_lock_timeout' });
    }
    throw error;
  }
}
