/**
 * 마이그레이션 029 — capability 레지스트리 (WP-078 / ENT-GH-006 · ENT-GH-012, FR-GH-001 AC-5, CR-088).
 *
 * 실제 PostgreSQL로 본다:
 *   1. 028 → 029 → 028 → 029 왕복 — 내려가면 두 표와 함수가 사라지고 028의 표는 그대로다
 *   2. 권한 — prs_app은 기록(INSERT)과 조회만 하고 갱신·삭제는 없다
 *   3. 불변 — 검증 기록은 소유자도 갱신·삭제할 수 없다(트리거). 스냅숏은 내용 불변, activated_at만 한 번
 *   4. 활성화 CHECK — 미분류가 남은 스냅숏은 activated_at을 가질 수 없다. 기록은 된다
 *   5. 리포지터리 — 같은 해시의 스냅숏은 한 행, 출처별 최신 검증 하나, 실패 기록이 정상 기록을 덮지 않는다
 *
 * 검증: `pnpm test:integration gh-registry-schema`
 */

import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { appliedVersions, migrateDown, migrateUp } from '../src/migrate.js';
import * as registry from '../src/repositories/gh-registry.js';
import { migratedPool } from './helpers.js';

let pool: Pool;

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const RESTRICT_VIOLATION = '23001';
const CHECK_VIOLATION = '23514';

const errorCode = (error: unknown): string | undefined => (error as { code?: string }).code;

function snapshotInput(overrides: Partial<registry.GhCapabilitySnapshotInput> = {}): registry.GhCapabilitySnapshotInput {
  return {
    ghVersion: '2.97.0',
    manifestVersion: 'r0.2',
    manifestHash: HASH_A,
    inventoryHash: HASH_B,
    commandCount: 229,
    leafCommandCount: 196,
    groupCommandCount: 32,
    aliasOnlyCommandCount: 1,
    aliasCount: 45,
    positionalCount: 164,
    flagCount: 1034,
    inheritedFlagCount: 312,
    jsonFieldCount: 707,
    unclassifiedCount: 0,
    interactionUnclassifiedCount: 0,
    flagUnclassifiedCount: 0,
    positionalUnclassifiedCount: 0,
    extensionCommandCount: 9,
    executableCount: 1,
    coverage: { dimensions: [] },
    ...overrides,
  };
}

function verificationInput(snapshotId: number, overrides: Partial<registry.GhCapabilityVerificationInput> = {}): registry.GhCapabilityVerificationInput {
  return {
    snapshotId,
    checkedBy: 'gh-executor',
    trigger: 'startup',
    // 실행기 기록은 배포 범위를 적는다 (마이그레이션 030 CHECK, CR-090).
    scope: 'ghe.example.com',
    environment: { executor_id: 'test:1', hostname: 'test' },
    ghVersionExpected: '2.97.0',
    ghVersionObserved: '2.97.0',
    binarySha256Expected: HASH_B,
    binarySha256Observed: HASH_B,
    manifestHashExpected: HASH_A,
    manifestHashObserved: HASH_A,
    inventoryHashExpected: HASH_B,
    inventoryHashObserved: HASH_B,
    validatorVersion: 'validator-test',
    rulesVersion: 'rules-test',
    status: 'incomplete',
    drift: null,
    report: { status: 'incomplete' },
    reportHash: 'c'.repeat(64),
    error: null,
    ...overrides,
  };
}

const privilege = async (role: string, table: string, action: string): Promise<boolean> => {
  const result = await pool.query<{ granted: boolean }>('SELECT has_table_privilege($1, $2, $3) AS granted', [role, table, action]);
  return result.rows[0]?.granted === true;
};

beforeAll(async () => {
  pool = await migratedPool();
});

afterAll(async () => {
  await pool.query('TRUNCATE gh_capability_verification, gh_capability_snapshot RESTART IDENTITY CASCADE');
  await pool.end();
});

beforeEach(async () => {
  await pool.query('TRUNCATE gh_capability_verification, gh_capability_snapshot RESTART IDENTITY CASCADE');
});

describe('029 왕복', () => {
  it('028 → 029 → 028 → 029 — 내려가면 두 표와 함수가 사라지고 028의 표는 남는다', async () => {
    expect(await appliedVersions(pool)).toContain('029');
    // 030(운영 정책, CR-090)이 029 위에 있고 029의 표를 참조한다 — 둘을 내린다. 목록으로 단언하므로 031이 생기면 즉시 깨진다.
    const reverted = await migrateDown(pool, 8);
    expect(reverted).toEqual(['036', '035', '034', '033', '032', '031', '030', '029']);
    const gone = await pool.query<{ relname: string }>(`SELECT relname FROM pg_class WHERE relname IN ('gh_capability_snapshot', 'gh_capability_verification')`);
    expect(gone.rows).toEqual([]);
    const functions = await pool.query<{ proname: string }>(`SELECT proname FROM pg_proc WHERE proname IN ('gh_capability_verification_immutable', 'gh_capability_snapshot_guard')`);
    expect(functions.rows).toEqual([]);
    const kept = await pool.query<{ relname: string }>(`SELECT relname FROM pg_class WHERE relname = 'gh_execution'`);
    expect(kept.rows).toHaveLength(1);
    expect(await migrateUp(pool)).toEqual(['029', '030', '031', '032', '033', '034', '035', '036']);
    // 다시 올린 뒤 재실행은 멱등이다 — 적용할 것이 없다.
    expect(await migrateUp(pool)).toEqual([]);
  });
});

describe('권한과 불변 (append-only)', () => {
  it('prs_app: 두 표 모두 SELECT·INSERT 있음, UPDATE·DELETE 없음', async () => {
    for (const table of ['gh_capability_snapshot', 'gh_capability_verification']) {
      expect(await privilege('prs_app', table, 'SELECT'), `${table} SELECT`).toBe(true);
      expect(await privilege('prs_app', table, 'INSERT'), `${table} INSERT`).toBe(true);
      expect(await privilege('prs_app', table, 'UPDATE'), `${table} UPDATE`).toBe(false);
      expect(await privilege('prs_app', table, 'DELETE'), `${table} DELETE`).toBe(false);
    }
  });

  it('검증 기록은 소유자도 갱신·삭제할 수 없다 — 트리거가 막는다', async () => {
    const { row } = await registry.recordSnapshot(pool, snapshotInput());
    const verification = await registry.insertVerification(pool, verificationInput(row.snapshot_id));
    let code: string | undefined;
    try {
      await pool.query(`UPDATE gh_capability_verification SET status = 'passed' WHERE verification_id = $1`, [verification.verification_id]);
    } catch (error) {
      code = errorCode(error);
    }
    expect(code).toBe(RESTRICT_VIOLATION);
    code = undefined;
    try {
      await pool.query(`DELETE FROM gh_capability_verification WHERE verification_id = $1`, [verification.verification_id]);
    } catch (error) {
      code = errorCode(error);
    }
    expect(code).toBe(RESTRICT_VIOLATION);
    expect((await registry.listVerifications(pool))[0]?.status).toBe('incomplete');
  });

  it('스냅숏은 내용이 불변이고 activated_at만 한 번 설정할 수 있으며 삭제는 없다', async () => {
    const { row } = await registry.recordSnapshot(pool, snapshotInput());
    let code: string | undefined;
    try {
      await pool.query(`UPDATE gh_capability_snapshot SET manifest_hash = $2 WHERE snapshot_id = $1`, [row.snapshot_id, HASH_B]);
    } catch (error) {
      code = errorCode(error);
    }
    expect(code).toBe(RESTRICT_VIOLATION);
    await pool.query(`UPDATE gh_capability_snapshot SET activated_at = now() WHERE snapshot_id = $1`, [row.snapshot_id]);
    code = undefined;
    try {
      await pool.query(`UPDATE gh_capability_snapshot SET activated_at = now() + interval '1 day' WHERE snapshot_id = $1`, [row.snapshot_id]);
    } catch (error) {
      code = errorCode(error);
    }
    expect(code).toBe(RESTRICT_VIOLATION);
    code = undefined;
    try {
      await pool.query(`DELETE FROM gh_capability_snapshot WHERE snapshot_id = $1`, [row.snapshot_id]);
    } catch (error) {
      code = errorCode(error);
    }
    expect(code).toBe(RESTRICT_VIOLATION);
  });

  it('어느 차원이든 미분류가 남은 스냅숏은 기록되지만 활성화할 수 없다 (NFR-009 — command·interaction·flag·positional)', async () => {
    const cases: readonly [string, Partial<registry.GhCapabilitySnapshotInput>][] = [
      ['command', { manifestHash: HASH_B, unclassifiedCount: 195 }],
      ['interaction', { manifestHash: 'c'.repeat(64), interactionUnclassifiedCount: 1 }],
      ['flag', { manifestHash: 'd'.repeat(64), flagUnclassifiedCount: 1 }],
      ['positional', { manifestHash: 'e'.repeat(64), positionalUnclassifiedCount: 1 }],
    ];
    for (const [label, overrides] of cases) {
      const { row } = await registry.recordSnapshot(pool, snapshotInput(overrides));
      expect(row.activated_at, label).toBeNull();
      let code: string | undefined;
      try {
        await pool.query(`UPDATE gh_capability_snapshot SET activated_at = now() WHERE snapshot_id = $1`, [row.snapshot_id]);
      } catch (error) {
        code = errorCode(error);
      }
      expect(code, label).toBe(CHECK_VIOLATION);
    }
    // 네 차원이 전부 0이면 활성화된다 — CHECK가 활성화 자체를 막는 것은 아니다.
    const { row: clean } = await registry.recordSnapshot(pool, snapshotInput({ manifestHash: 'f'.repeat(64) }));
    await pool.query(`UPDATE gh_capability_snapshot SET activated_at = now() WHERE snapshot_id = $1`, [clean.snapshot_id]);
    expect((await registry.findSnapshot(pool, 'r0.2', 'f'.repeat(64)))?.activated_at).not.toBeNull();
  });
});

describe('리포지터리', () => {
  it('같은 manifest 해시는 한 행이다 — 두 번째 기록은 기존 행을 돌려주고 내용을 덮지 않는다', async () => {
    const first = await registry.recordSnapshot(pool, snapshotInput());
    const second = await registry.recordSnapshot(pool, snapshotInput({ unclassifiedCount: 999 }));
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.row.snapshot_id).toBe(first.row.snapshot_id);
    expect(second.row.unclassified_count).toBe(0);
    expect(await registry.listSnapshots(pool)).toHaveLength(1);
  });

  it('출처별 최신 검증 하나를 돌려주고, 실패 기록이 정상 기록을 덮지 않는다', async () => {
    const { row } = await registry.recordSnapshot(pool, snapshotInput());
    await registry.insertVerification(pool, verificationInput(row.snapshot_id, { checkedBy: 'gh-executor', status: 'incomplete' }));
    await registry.insertVerification(pool, verificationInput(row.snapshot_id, { checkedBy: 'ci', trigger: 'manual', scope: null, status: 'passed' }));
    await new Promise((resolve) => setTimeout(resolve, 5));
    await registry.insertVerification(pool, verificationInput(row.snapshot_id, { checkedBy: 'gh-executor', trigger: 'periodic', status: 'error', error: 'gh --help timed out' }));

    const latest = await registry.latestVerifications(pool);
    expect(latest.map((one) => [one.checked_by, one.status]).sort()).toEqual([
      ['ci', 'passed'],
      ['gh-executor', 'error'],
    ]);
    // 이전 정상 기록은 그대로 남아 있다 — 덮이지 않았다.
    const all = await registry.listVerifications(pool);
    expect(all.map((one) => one.status).sort()).toEqual(['error', 'incomplete', 'passed']);
  });

  it('기록이 없으면 빈 배열이다 — 「0개 정상」이 아니라 「없음」이다', async () => {
    expect(await registry.latestVerifications(pool)).toEqual([]);
    expect(await registry.listSnapshots(pool)).toEqual([]);
  });
});
