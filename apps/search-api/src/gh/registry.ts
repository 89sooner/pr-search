/**
 * capability 레지스트리 조회 (API-GH-013 · API-GH-014 / A-006, FR-GH-001 AC-5·AC-6, FR-GH-011 AC-2·AC-3, NFR-009, CR-088).
 *
 * **CLI·API·화면이 같은 모델을 읽는다.** 커버리지와 게이트는 `@prs/gh-cli`의 `validateManifest`가 적재한
 * manifest에서 한 번 계산한 것이고, 검증 기록은 실행기(JOB-GH-003)·CI·CLI가 DB에 남긴 것이다. 여기서
 * 커버리지를 다른 공식으로 다시 세지 않는다.
 *
 * ## 이 조회가 하지 않는 것
 *
 * - **검사를 돌리지 않는다.** 요청마다 `gh --help` 트리를 순회하지 않는다 — 저장된 기록을 읽을 뿐이다.
 * - **실행 허용을 바꾸지 않는다.** 화면이 초록이어도 실행기는 스스로 대조한다.
 * - **사내 호스트 지원을 단정하지 않는다.** `host_verification`은 `not_verified`이며 그 사실을 그대로 낸다.
 */

import { ghRegistryRepo, type GhCapabilitySnapshotRow, type GhCapabilityVerificationRow, type Pool } from '@prs/db';
import { GH_PINNED_LINUX_AMD64, GH_PINNED_VERSION, validateManifest, type GhCapabilityManifest, type GhManifestCommand, type GhRegistryReport } from '@prs/gh-cli';

/** 실행기의 기본 검사 주기(`GH_EXECUTOR_REGISTRY_CHECK_MS`). 화면이 「지났다」를 판정하는 근거로 함께 낸다. */
export const REGISTRY_CHECK_INTERVAL_MS = 86_400_000;

const reports = new WeakMap<GhCapabilityManifest, GhRegistryReport>();

/** 적재한 manifest의 보고서. 요청마다 다시 만들지 않는다 — 같은 manifest는 같은 보고서다. */
export function reportFor(manifest: GhCapabilityManifest): GhRegistryReport {
  const cached = reports.get(manifest);
  if (cached !== undefined) return cached;
  const report = validateManifest(manifest);
  reports.set(manifest, report);
  return report;
}

function verificationView(row: GhCapabilityVerificationRow, servedHash: string): Record<string, unknown> {
  return {
    verification_id: row.verification_id,
    snapshot_id: row.snapshot_id,
    checked_at: row.checked_at.toISOString(),
    checked_by: row.checked_by,
    trigger: row.trigger,
    status: row.status,
    gh_version_expected: row.gh_version_expected,
    gh_version_observed: row.gh_version_observed,
    binary_sha256_expected: row.binary_sha256_expected,
    binary_sha256_observed: row.binary_sha256_observed,
    manifest_hash_expected: row.manifest_hash_expected,
    manifest_hash_observed: row.manifest_hash_observed,
    inventory_hash_expected: row.inventory_hash_expected,
    inventory_hash_observed: row.inventory_hash_observed,
    validator_version: row.validator_version,
    rules_version: row.rules_version,
    drift: row.drift,
    error: row.error,
    report_hash: row.report_hash,
    /** 이 기록이 **지금 이 API가 적재한** manifest에 대한 것인가. 아니면 옛 배포의 기록이다. */
    matches_served_manifest: row.manifest_hash_expected === servedHash,
    environment: row.environment,
  };
}

function snapshotView(row: GhCapabilitySnapshotRow, servedHash: string): Record<string, unknown> {
  return {
    snapshot_id: row.snapshot_id,
    gh_version: row.gh_version,
    manifest_version: row.manifest_version,
    manifest_hash: row.manifest_hash,
    inventory_hash: row.inventory_hash,
    leaf_command_count: row.leaf_command_count,
    unclassified_count: row.unclassified_count,
    executable_count: row.executable_count,
    first_seen_at: row.first_seen_at.toISOString(),
    activated_at: row.activated_at?.toISOString() ?? null,
    is_served: row.manifest_hash === servedHash,
  };
}

/**
 * A-006의 첫 화면 — 신원·커버리지·게이트·검증 기록·스냅숏. 기록이 없으면 빈 배열이다 (「0개 정상」이 아니라 「없음」).
 */
export async function registryStatus(pool: Pool, manifest: GhCapabilityManifest): Promise<Record<string, unknown>> {
  const report = reportFor(manifest);
  const [latest, snapshots, recent] = await Promise.all([
    ghRegistryRepo.latestVerifications(pool),
    ghRegistryRepo.listSnapshots(pool, 10),
    ghRegistryRepo.listVerifications(pool, 10),
  ]);
  const executor = latest.find((row) => row.checked_by === 'gh-executor') ?? null;
  return {
    gh: {
      pinned_version: GH_PINNED_VERSION,
      binary_sha256_expected: GH_PINNED_LINUX_AMD64.binarySha256,
    },
    manifest: {
      version: manifest.manifestVersion,
      hash: manifest.hash,
      generated_at: manifest.generatedAt,
      inventory_hash: report.inventoryHash,
      hash_verified: report.hashVerified,
      command_count: manifest.commands.length,
      leaf_command_count: manifest.coverage.leafCommands,
      group_command_count: manifest.coverage.groupCommands,
      alias_only_command_count: manifest.coverage.aliasOnlyCommands,
      help_topics: manifest.coverage.helpTopics,
    },
    validator: { version: report.validatorVersion, rules_version: report.rulesVersion, status: report.status },
    coverage: {
      classified_leaf_commands: manifest.coverage.classifiedLeafCommands,
      unclassified_leaf_commands: manifest.coverage.unclassifiedLeafCommands,
      executable_commands: manifest.coverage.executableCommands,
      dimensions: report.dimensions,
    },
    gates: report.gates,
    execution: report.execution,
    findings: {
      errors: report.findings.filter((finding) => finding.severity === 'error').length,
      gaps: report.findings.filter((finding) => finding.severity === 'gap').length,
      infos: report.findings.filter((finding) => finding.severity === 'info').length,
      sample: report.findings.slice(0, 50),
    },
    verification: {
      check_interval_ms: REGISTRY_CHECK_INTERVAL_MS,
      latest_by_source: latest.map((row) => verificationView(row, manifest.hash)),
      recent: recent.map((row) => verificationView(row, manifest.hash)),
      /** 실행기의 마지막 기록이 지금 적재한 manifest와 같은 해시인가. 다르면 실행기가 옛 manifest를 보거나 아직 검사하지 않은 것이다. */
      executor_matches_served_manifest: executor === null ? null : executor.manifest_hash_expected === manifest.hash,
    },
    snapshots: snapshots.map((row) => snapshotView(row, manifest.hash)),
    host_verification: {
      status: 'not_verified',
      note: '사내 GHES에서 실제로 확인한 command가 없다. unsupported_by_host로 적은 것도 0건이다 — 확인하지 않은 것을 미지원으로 적지 않는다 (FR-GH-011 AC-4·AC-5)',
    },
  };
}

/** A-006의 command 상세 — 분류 전부(flag·positional·근거). 없으면 `null`. */
export function commandDetail(manifest: GhCapabilityManifest, id: string): Record<string, unknown> | null {
  const command: GhManifestCommand | undefined = manifest.commands.find((entry) => entry.id === id);
  if (command === undefined) return null;
  return {
    id: command.id,
    path: command.path,
    summary: command.summary,
    usage: command.usage,
    section: command.section,
    aliases: command.aliases,
    alias_of: command.aliasOf,
    group: command.group,
    help_status: command.helpStatus,
    support: command.support,
    execution: command.execution,
    execution_reason: command.executionReason,
    risk: command.risk,
    json_fields: command.jsonFields,
    inventory_flags: command.flags,
    classification: command.classification,
    /** 실행을 여는 정의가 있으면 그 옵션·제약·결과 계약. 대부분은 `null`이다 — 그것이 R0 범위다. */
    definition: manifest.capabilities.find((capability) => capability.id === id) ?? null,
  };
}
