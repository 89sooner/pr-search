/**
 * capability 레지스트리 리포지터리 (ENT-GH-006 · ENT-GH-012, FR-GH-001 AC-5 · FR-GH-011 AC-2, WP-078 / CR-088).
 *
 * 두 표 다 **쓰고 나면 바꾸지 않는다.** 스냅숏은 manifest 해시마다 한 행이라 같은 해시를 다시 보면
 * 새 행을 만들지 않고 기존 행을 돌려주며(`ON CONFLICT DO NOTHING` + 재조회), 검증 기록은 회차마다
 * 한 행을 **더하기만** 한다 — 갱신·삭제는 DB 트리거가 막는다(마이그레이션 029). 그래서 「마지막
 * 검증」은 최신 행이고 「이전과 무엇이 달라졌는가」는 행 사이의 차이다.
 *
 * 이 리포지터리는 실행 허용을 읽지도 쓰지도 않는다. 기록이 초록이어도 실행기는 스스로 대조한다.
 *
 * CR-090: 실행기 기록은 배포 범위(`scope` — `GHE_BASE_URL`의 호스트)를 적는다(마이그레이션 030 CHECK). 운영 승인의 근거는
 * 「그 범위의 가장 최근 실행기 기록」이며 CLI·CI 기록이나 범위가 없는 과거 기록은 근거가 아니다. 기록 INSERT는 트리거가
 * 정책 잠금(공유)을 걸어, 승인이 최신 기록을 읽는 동안 새 기록이 끼어들지 못한다.
 */

import type { Pool, PoolClient } from 'pg';

type Queryable = Pool | PoolClient;

export type GhVerificationSource = 'gh-executor' | 'ci' | 'cli';
export type GhVerificationTrigger = 'startup' | 'periodic' | 'manual';
export type GhVerificationStatus = 'passed' | 'incomplete' | 'drift' | 'failed' | 'error';

export interface GhCapabilitySnapshotRow {
  readonly snapshot_id: number;
  readonly gh_version: string;
  readonly manifest_version: string;
  readonly manifest_hash: string;
  readonly inventory_hash: string;
  readonly command_count: number;
  readonly leaf_command_count: number;
  readonly group_command_count: number;
  readonly alias_only_command_count: number;
  readonly alias_count: number;
  readonly positional_count: number;
  readonly flag_count: number;
  readonly inherited_flag_count: number;
  readonly json_field_count: number;
  readonly unclassified_count: number;
  readonly interaction_unclassified_count: number;
  readonly flag_unclassified_count: number;
  readonly positional_unclassified_count: number;
  readonly extension_command_count: number;
  readonly executable_count: number;
  readonly coverage: unknown;
  readonly first_seen_at: Date;
  readonly activated_at: Date | null;
}

export interface GhCapabilitySnapshotInput {
  readonly ghVersion: string;
  readonly manifestVersion: string;
  readonly manifestHash: string;
  readonly inventoryHash: string;
  readonly commandCount: number;
  readonly leafCommandCount: number;
  readonly groupCommandCount: number;
  readonly aliasOnlyCommandCount: number;
  readonly aliasCount: number;
  readonly positionalCount: number;
  readonly flagCount: number;
  readonly inheritedFlagCount: number;
  readonly jsonFieldCount: number;
  readonly unclassifiedCount: number;
  readonly interactionUnclassifiedCount: number;
  readonly flagUnclassifiedCount: number;
  readonly positionalUnclassifiedCount: number;
  readonly extensionCommandCount: number;
  readonly executableCount: number;
  readonly coverage: unknown;
}

const SNAPSHOT_COLUMNS = `snapshot_id, gh_version, manifest_version, manifest_hash, inventory_hash, command_count, leaf_command_count,
  group_command_count, alias_only_command_count, alias_count, positional_count, flag_count, inherited_flag_count, json_field_count,
  unclassified_count, interaction_unclassified_count, flag_unclassified_count, positional_unclassified_count, extension_command_count,
  executable_count, coverage, first_seen_at, activated_at`;

/**
 * manifest 해시의 스냅숏 행을 확보한다. 처음 보는 해시면 만들고, 아니면 기존 행이다 — 내용은 덮지 않는다.
 *
 * @returns 행과 「이번에 만들었는가」.
 */
export async function recordSnapshot(db: Queryable, input: GhCapabilitySnapshotInput): Promise<{ readonly row: GhCapabilitySnapshotRow; readonly created: boolean }> {
  const inserted = await db.query<GhCapabilitySnapshotRow>(
    `INSERT INTO gh_capability_snapshot (
       gh_version, manifest_version, manifest_hash, inventory_hash, command_count, leaf_command_count, group_command_count,
       alias_only_command_count, alias_count, positional_count, flag_count, inherited_flag_count, json_field_count,
       unclassified_count, interaction_unclassified_count, flag_unclassified_count, positional_unclassified_count,
       extension_command_count, executable_count, coverage)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20::jsonb)
     ON CONFLICT (manifest_version, manifest_hash) DO NOTHING
     RETURNING ${SNAPSHOT_COLUMNS}`,
    [
      input.ghVersion,
      input.manifestVersion,
      input.manifestHash,
      input.inventoryHash,
      input.commandCount,
      input.leafCommandCount,
      input.groupCommandCount,
      input.aliasOnlyCommandCount,
      input.aliasCount,
      input.positionalCount,
      input.flagCount,
      input.inheritedFlagCount,
      input.jsonFieldCount,
      input.unclassifiedCount,
      input.interactionUnclassifiedCount,
      input.flagUnclassifiedCount,
      input.positionalUnclassifiedCount,
      input.extensionCommandCount,
      input.executableCount,
      JSON.stringify(input.coverage),
    ],
  );
  const created = inserted.rows[0];
  if (created !== undefined) return { row: created, created: true };
  const existing = await findSnapshot(db, input.manifestVersion, input.manifestHash);
  if (existing === null) throw new Error('unreachable: 충돌한 스냅숏 행이 없다');
  return { row: existing, created: false };
}

export async function findSnapshot(db: Queryable, manifestVersion: string, manifestHash: string): Promise<GhCapabilitySnapshotRow | null> {
  const result = await db.query<GhCapabilitySnapshotRow>(
    `SELECT ${SNAPSHOT_COLUMNS} FROM gh_capability_snapshot WHERE manifest_version = $1 AND manifest_hash = $2`,
    [manifestVersion, manifestHash],
  );
  return result.rows[0] ?? null;
}

export async function listSnapshots(db: Queryable, limit = 20): Promise<GhCapabilitySnapshotRow[]> {
  const result = await db.query<GhCapabilitySnapshotRow>(
    `SELECT ${SNAPSHOT_COLUMNS} FROM gh_capability_snapshot ORDER BY first_seen_at DESC, snapshot_id DESC LIMIT $1`,
    [Math.max(1, Math.min(limit, 200))],
  );
  return result.rows;
}

export interface GhCapabilityVerificationRow {
  readonly verification_id: number;
  readonly snapshot_id: number;
  readonly checked_at: Date;
  readonly checked_by: GhVerificationSource;
  readonly trigger: GhVerificationTrigger;
  /** 배포 범위. 030 이전의 기록과 CLI·CI 기록은 `null`이다. */
  readonly scope: string | null;
  readonly environment: Record<string, unknown>;
  readonly gh_version_expected: string;
  readonly gh_version_observed: string | null;
  readonly binary_sha256_expected: string;
  readonly binary_sha256_observed: string | null;
  readonly manifest_hash_expected: string;
  readonly manifest_hash_observed: string | null;
  readonly inventory_hash_expected: string;
  readonly inventory_hash_observed: string | null;
  readonly validator_version: string;
  readonly rules_version: string;
  readonly status: GhVerificationStatus;
  readonly drift: unknown;
  readonly report: unknown;
  readonly report_hash: string;
  readonly error: string | null;
}

export interface GhCapabilityVerificationInput {
  readonly snapshotId: number;
  readonly checkedBy: GhVerificationSource;
  readonly trigger: GhVerificationTrigger;
  /** 배포 범위. 실행기 기록이면 반드시 준다(030 CHECK). CLI·CI는 `null`. */
  readonly scope: string | null;
  readonly environment: Readonly<Record<string, unknown>>;
  readonly ghVersionExpected: string;
  readonly ghVersionObserved: string | null;
  readonly binarySha256Expected: string;
  readonly binarySha256Observed: string | null;
  readonly manifestHashExpected: string;
  readonly manifestHashObserved: string | null;
  readonly inventoryHashExpected: string;
  readonly inventoryHashObserved: string | null;
  readonly validatorVersion: string;
  readonly rulesVersion: string;
  readonly status: GhVerificationStatus;
  readonly drift: unknown;
  readonly report: unknown;
  readonly reportHash: string;
  readonly error: string | null;
}

const VERIFICATION_COLUMNS = `verification_id, snapshot_id, checked_at, checked_by, trigger, scope, environment, gh_version_expected, gh_version_observed,
  binary_sha256_expected, binary_sha256_observed, manifest_hash_expected, manifest_hash_observed, inventory_hash_expected,
  inventory_hash_observed, validator_version, rules_version, status, drift, report, report_hash, error`;

/** 검증 한 회차를 더한다. 실패·드리프트도 그대로 남긴다 — 기존 정상 기록을 덮지 않는다. */
export async function insertVerification(db: Queryable, input: GhCapabilityVerificationInput): Promise<GhCapabilityVerificationRow> {
  const result = await db.query<GhCapabilityVerificationRow>(
    `INSERT INTO gh_capability_verification (
       snapshot_id, checked_by, trigger, environment, gh_version_expected, gh_version_observed, binary_sha256_expected,
       binary_sha256_observed, manifest_hash_expected, manifest_hash_observed, inventory_hash_expected, inventory_hash_observed,
       validator_version, rules_version, status, drift, report, report_hash, error, scope)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16::jsonb, $17::jsonb, $18, $19, $20)
     RETURNING ${VERIFICATION_COLUMNS}`,
    [
      input.snapshotId,
      input.checkedBy,
      input.trigger,
      JSON.stringify(input.environment),
      input.ghVersionExpected,
      input.ghVersionObserved,
      input.binarySha256Expected,
      input.binarySha256Observed,
      input.manifestHashExpected,
      input.manifestHashObserved,
      input.inventoryHashExpected,
      input.inventoryHashObserved,
      input.validatorVersion,
      input.rulesVersion,
      input.status,
      input.drift === null || input.drift === undefined ? null : JSON.stringify(input.drift),
      JSON.stringify(input.report),
      input.reportHash,
      input.error,
      input.scope,
    ],
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error('unreachable: INSERT가 행을 돌려주지 않았다');
  return row;
}

/** 출처(실행기·CI·CLI)마다 가장 최근 회차 하나. 없는 출처는 빠진다 — 「기록 없음」은 빈 배열이다. */
export async function latestVerifications(db: Queryable): Promise<GhCapabilityVerificationRow[]> {
  const result = await db.query<GhCapabilityVerificationRow>(
    `SELECT DISTINCT ON (checked_by) ${VERIFICATION_COLUMNS}
       FROM gh_capability_verification
      ORDER BY checked_by, checked_at DESC, verification_id DESC`,
  );
  return result.rows;
}

/**
 * 배포 범위의 가장 최근 **실행기** 기록 (CR-090).
 *
 * - 운영 승인의 근거는 `excludeTransientErrors: false` — 일시 오류라도 가장 최근이 통과가 아니면 승인하지 않는다.
 * - 실행 수락의 레지스트리 판정은 `true` — 실행기가 일시 오류에서 이전 판정을 유지하는 규칙과 같다.
 */
export async function latestExecutorVerification(db: Queryable, scope: string, options: { readonly excludeTransientErrors: boolean }): Promise<GhCapabilityVerificationRow | null> {
  const result = await db.query<GhCapabilityVerificationRow>(
    `SELECT ${VERIFICATION_COLUMNS} FROM gh_capability_verification
      WHERE checked_by = 'gh-executor' AND scope = $1 ${options.excludeTransientErrors ? "AND status <> 'error'" : ''}
      ORDER BY checked_at DESC, verification_id DESC LIMIT 1`,
    [scope],
  );
  return result.rows[0] ?? null;
}

export async function findSnapshotById(db: Queryable, snapshotId: number): Promise<GhCapabilitySnapshotRow | null> {
  const result = await db.query<GhCapabilitySnapshotRow>(`SELECT ${SNAPSHOT_COLUMNS} FROM gh_capability_snapshot WHERE snapshot_id = $1`, [snapshotId]);
  return result.rows[0] ?? null;
}

export async function listVerifications(db: Queryable, limit = 20): Promise<GhCapabilityVerificationRow[]> {
  const result = await db.query<GhCapabilityVerificationRow>(
    `SELECT ${VERIFICATION_COLUMNS} FROM gh_capability_verification ORDER BY checked_at DESC, verification_id DESC LIMIT $1`,
    [Math.max(1, Math.min(limit, 200))],
  );
  return result.rows;
}
