/**
 * 운영 정책 HTTP 시험의 근거 fixture (CR-090).
 *
 * **이 근거 행은 fixture다.** search-api는 gh를 띄우지 않으므로 여기서는 실행기의 기동 검사를 흉내 내어 검증 기록을 남긴다 —
 * 보고서는 적재한 manifest로 검증기가 실제로 만든 것이고, 바이너리·인벤토리 관측값은 고정 상수와 manifest에서 온다. 실제 고정
 * 바이너리로 얻은 근거와 그 승인은 `apps/gh-executor/integration/policy-flow.test.ts`가 증명한다.
 *
 * 승인 자체는 대역이 아니다 — search-api의 조회가 자격을 판정하고, 변경 함수가 DB 함수로 쓴다.
 */

import { ghRegistryRepo, type Pool } from '@prs/db';
import { GH_PINNED_LINUX_AMD64, GH_PINNED_VERSION, RULES_VERSION, VALIDATOR_VERSION, reportHash, type GhCapabilityManifest } from '@prs/gh-cli';
import { reportFor } from '../../src/gh/registry.js';

export interface FixtureEvidenceOptions {
  readonly status?: 'passed' | 'incomplete' | 'drift' | 'failed' | 'error';
  readonly checkedAt?: Date;
  readonly registryCheckMs?: number;
}

/** 적재 manifest의 스냅숏과, 그 범위의 실행기 검증 기록 한 행을 남긴다. */
export async function recordFixtureEvidence(pool: Pool, manifest: GhCapabilityManifest, scope: string, options: FixtureEvidenceOptions = {}): Promise<{ readonly snapshotId: number; readonly verificationId: number }> {
  const report = reportFor(manifest);
  const dimension = (id: string): { readonly total: number; readonly unclassified: number } => {
    const found = report.dimensions.find((one) => one.id === id);
    return found === undefined ? { total: 0, unclassified: 0 } : { total: found.total, unclassified: found.unclassified };
  };
  const { row } = await ghRegistryRepo.recordSnapshot(pool, {
    ghVersion: manifest.ghVersion,
    manifestVersion: manifest.manifestVersion,
    manifestHash: manifest.hash,
    inventoryHash: report.inventoryHash,
    commandCount: manifest.commands.length,
    leafCommandCount: manifest.coverage.leafCommands,
    groupCommandCount: manifest.coverage.groupCommands,
    aliasOnlyCommandCount: manifest.coverage.aliasOnlyCommands,
    aliasCount: dimension('command_alias').total,
    positionalCount: dimension('positional').total,
    flagCount: manifest.coverage.commandFlags,
    inheritedFlagCount: manifest.coverage.inheritedFlagOccurrences,
    jsonFieldCount: manifest.coverage.jsonFields,
    unclassifiedCount: manifest.coverage.unclassifiedLeafCommands,
    interactionUnclassifiedCount: dimension('interaction').unclassified,
    flagUnclassifiedCount: dimension('command_flag').unclassified + dimension('inherited_flag').unclassified,
    positionalUnclassifiedCount: dimension('positional').unclassified,
    extensionCommandCount: dimension('extension_split').total,
    executableCount: manifest.coverage.executableCommands,
    coverage: manifest.coverage,
  });
  const status = options.status ?? 'passed';
  const inserted = await pool.query<{ verification_id: number }>(
    `INSERT INTO gh_capability_verification (
       snapshot_id, checked_at, checked_by, trigger, scope, environment, gh_version_expected, gh_version_observed,
       binary_sha256_expected, binary_sha256_observed, manifest_hash_expected, manifest_hash_observed,
       inventory_hash_expected, inventory_hash_observed, validator_version, rules_version, status, report, report_hash)
     VALUES ($1, COALESCE($2, now()), 'gh-executor', 'startup', $3, $4::jsonb, $5, $5, $6, $6, $7, $7, $8, $8, $9, $10, $11, $12::jsonb, $13)
     RETURNING verification_id`,
    [
      row.snapshot_id,
      options.checkedAt ?? null,
      scope,
      JSON.stringify({ executor_id: 'fixture:executor', hostname: 'fixture', registry_check_ms: options.registryCheckMs ?? 86_400_000 }),
      GH_PINNED_VERSION,
      GH_PINNED_LINUX_AMD64.binarySha256,
      manifest.hash,
      report.inventoryHash,
      VALIDATOR_VERSION,
      RULES_VERSION,
      status,
      JSON.stringify(report),
      reportHash(report),
    ],
  );
  const verificationId = inserted.rows[0]?.verification_id;
  if (verificationId === undefined) throw new Error('unreachable: 검증 기록을 남기지 못했다');
  return { snapshotId: row.snapshot_id, verificationId };
}
