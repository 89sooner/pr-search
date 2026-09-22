/**
 * 마이그레이션 030 — GitHub Operations 운영 정책 (WP-080 / ENT-GH-013 · ENT-GH-014, FR-GH-011 AC-6~AC-10 · FR-GH-009 AC-8 ·
 * FR-AUTH-004 AC-6 예외, CR-090).
 *
 * 실제 PostgreSQL로, **애플리케이션 롤(`SET LOCAL ROLE prs_app`)로 실제로 시도해서** 본다. 카탈로그만 읽으면 「권한이 없다」는
 * 알아도 「그 권한 없이 우회할 길이 없다」는 모른다.
 *
 *   1. 권한 경계 — prs_app은 정책 표를 읽고 함수를 실행만 한다. 직접 쓰기·스냅숏 활성화·revision 바꾸기는 거절된다.
 *      search_path를 가로채려는 임시 표는 함수에 닿지 않는다.
 *   2. 승인 — 적용·같은 키 재요청·다른 내용의 같은 키·기대 revision·이미 승인
 *   3. 근거 — 잠금 아래 DB 사실 재확인(최신·출처·범위·관측=기대·신선도)
 *   4. 차단·재개·철회
 *   5. 감사 실패는 변경을 커밋하지 않는다
 *   6. 동시성 — 두 운영자, 승인 대 차단, 검증 기록 대 승인, 실행권 확정 대 차단
 *   7. 실행권 확정 가드 — 옛 앱 경로(revision 없는 INSERT·claim)가 거절된다
 *   8. 029 → 030 → 029 → 030 왕복 — 과거 행이 남고, 승인은 자동으로 되살아나지 않는다
 *
 * 검증: `pnpm test:integration gh-policy`
 */

import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ghPolicyLockKey } from '../src/advisory-lock.js';
import { appliedVersions, migrateDown, migrateUp } from '../src/migrate.js';
import * as execution from '../src/repositories/gh-execution.js';
import * as policyRepo from '../src/repositories/gh-policy.js';
import * as registry from '../src/repositories/gh-registry.js';
import { migratedPool } from './helpers.js';

let pool: Pool;
let counter = 0;
const PIN_SHA = '141507c337e8b202ad398550c3b73d72f5af92e86f71665214538a81efd4c409';
const INSUFFICIENT_PRIVILEGE = '42501';

const errorCode = (error: unknown): string | undefined => (error as { code?: string }).code;
const unique = (label: string): string => `${label}-${String(Date.now())}-${String((counter += 1))}`;
const hash = (seed: string): string => createHash('sha256').update(seed).digest('hex');
const fingerprint = (seed: string): string => hash(`fp:${seed}`);
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

interface Definition {
  readonly snapshotId: number;
  readonly manifestVersion: string;
  readonly manifestHash: string;
  readonly inventoryHash: string;
}

async function seedDefinition(options: { unclassified?: number } = {}): Promise<Definition> {
  const seed = unique('def');
  const manifestHash = hash(`manifest:${seed}`);
  const inventoryHash = hash(`inventory:${seed}`);
  const { row } = await registry.recordSnapshot(pool, {
    ghVersion: '2.97.0',
    manifestVersion: 'r0.3',
    manifestHash,
    inventoryHash,
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
    flagUnclassifiedCount: options.unclassified ?? 0,
    positionalUnclassifiedCount: 0,
    extensionCommandCount: 9,
    executableCount: 1,
    coverage: { dimensions: [] },
  });
  return { snapshotId: row.snapshot_id, manifestVersion: row.manifest_version, manifestHash, inventoryHash };
}

interface EvidenceOptions {
  readonly scope?: string | null;
  readonly checkedBy?: 'gh-executor' | 'ci' | 'cli';
  readonly status?: string;
  readonly checkedAt?: Date;
  readonly binaryObserved?: string;
  readonly inventoryObserved?: string;
  readonly manifestObserved?: string;
}

/** 실행기가 남기는 모양의 기록. 시각을 정해야 하는 시험이 있어 SQL로 넣는다(보고서는 DB 함수가 해석하지 않는다). */
async function seedEvidence(scope: string, definition: Definition, options: EvidenceOptions = {}): Promise<{ readonly verificationId: number; readonly reportHash: string }> {
  const reportHash = hash(`report:${unique('r')}`);
  const result = await pool.query<{ verification_id: number }>(
    `INSERT INTO gh_capability_verification (
       snapshot_id, checked_at, checked_by, trigger, scope, environment, gh_version_expected, gh_version_observed,
       binary_sha256_expected, binary_sha256_observed, manifest_hash_expected, manifest_hash_observed,
       inventory_hash_expected, inventory_hash_observed, validator_version, rules_version, status, report, report_hash)
     VALUES ($1, COALESCE($2, now()), $3, 'startup', $4, '{"registry_check_ms":86400000}'::jsonb, '2.97.0', '2.97.0',
       $5, $6, $7, $8, $9, $10, 'validator-test', 'rules-test', $11, '{"reportVersion":"r2"}'::jsonb, $12)
     RETURNING verification_id`,
    [
      definition.snapshotId,
      options.checkedAt ?? null,
      options.checkedBy ?? 'gh-executor',
      options.scope === undefined ? scope : options.scope,
      PIN_SHA,
      options.binaryObserved ?? PIN_SHA,
      definition.manifestHash,
      options.manifestObserved ?? definition.manifestHash,
      definition.inventoryHash,
      options.inventoryObserved ?? definition.inventoryHash,
      options.status ?? 'passed',
      reportHash,
    ],
  );
  const verificationId = result.rows[0]?.verification_id;
  if (verificationId === undefined) throw new Error('unreachable');
  return { verificationId, reportHash };
}

/** 애플리케이션 롤로 한 트랜잭션을 돈다. 던지면 롤백한다. */
async function asApp<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE prs_app');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

interface ChangeOptions {
  readonly action: policyRepo.GhPolicyAction;
  readonly expectedRevision: number;
  readonly actor?: string;
  readonly key?: string;
  readonly fingerprint?: string;
  readonly reason?: string;
  readonly capabilityId?: string;
  readonly definition?: Definition;
  readonly evidence?: { readonly verificationId: number; readonly reportHash: string };
  readonly maxAgeMs?: number;
  readonly correlationId?: string;
}

function changeInput(scope: string, options: ChangeOptions): policyRepo.ApplyPolicyChangeInput {
  const key = options.key ?? unique('key').replace(/[^A-Za-z0-9_-]/g, '_');
  return {
    scope,
    action: options.action,
    expectedRevision: options.expectedRevision,
    actor: options.actor ?? 'u-operator',
    reason: options.reason ?? '시험 사유',
    correlationId: options.correlationId ?? randomUUID(),
    idempotencyKey: key,
    requestFingerprint: options.fingerprint ?? fingerprint(key),
    capabilityId: options.capabilityId ?? null,
    snapshotId: options.definition?.snapshotId ?? null,
    verificationId: options.evidence?.verificationId ?? null,
    reportHash: options.evidence?.reportHash ?? null,
    evidenceMaxAgeMs: options.action === 'approve' ? (options.maxAgeMs ?? 91_225_000) : null,
  };
}

async function apply(scope: string, options: ChangeOptions): Promise<policyRepo.ApplyPolicyChangeResult> {
  return asApp((client) => policyRepo.applyPolicyChange(client, changeInput(scope, options)));
}

async function rejection(promise: Promise<unknown>): Promise<policyRepo.PolicyChangeRejected> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof policyRepo.PolicyChangeRejected) return error;
    throw error;
  }
  throw new Error('거절을 기대했으나 적용됐다');
}

async function approvedScope(): Promise<{ readonly scope: string; readonly definition: Definition; readonly evidence: { verificationId: number; reportHash: string } }> {
  const scope = `${unique('ghe')}.test`;
  const definition = await seedDefinition();
  const evidence = await seedEvidence(scope, definition);
  await apply(scope, { action: 'approve', expectedRevision: 0, definition, evidence });
  return { scope, definition, evidence };
}

async function count(sql: string, params: unknown[]): Promise<number> {
  const result = await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${sql}`, params);
  return result.rows[0]?.n ?? -1;
}

async function queuedExecution(scope: string, definition: Pick<Definition, 'manifestVersion' | 'manifestHash'>, policyRevision: number): Promise<execution.GhExecutionRow> {
  return execution.insertExecution(pool, {
    userId: 'u-policy-test',
    githubActor: 'alice',
    host: scope,
    repository: 'acme/payments',
    repositoryId: 1,
    capabilityId: 'pr.list',
    invocation: { capability_id: 'pr.list' },
    context: { host: scope },
    redactedArgv: ['pr', 'list'],
    envKeys: [],
    riskLevel: 'R0',
    ghVersion: '2.97.0',
    manifestVersion: definition.manifestVersion,
    manifestHash: definition.manifestHash,
    idempotencyKey: unique('exec').replace(/[^A-Za-z0-9_-]/g, '_'),
    authorizationResult: 'delegated_token_intersection',
    correlationId: randomUUID(),
    policyRevision,
  });
}

beforeAll(async () => {
  pool = await migratedPool();
}, 120_000);

afterAll(async () => {
  await pool.end();
});

describe('권한 경계 — prs_app은 읽고, 함수를 실행할 뿐이다', () => {
  it('카탈로그: 정책 표는 SELECT만, 함수는 SECURITY DEFINER·소유자 prs_admin·search_path 고정·PUBLIC 실행 불가', async () => {
    for (const table of ['gh_operations_policy', 'gh_operations_policy_revision']) {
      const privileges = await pool.query<{ s: boolean; i: boolean; u: boolean; d: boolean }>(
        `SELECT has_table_privilege('prs_app', $1, 'SELECT') AS s, has_table_privilege('prs_app', $1, 'INSERT') AS i,
                has_table_privilege('prs_app', $1, 'UPDATE') AS u, has_table_privilege('prs_app', $1, 'DELETE') AS d`,
        [table],
      );
      expect(privileges.rows[0], table).toEqual({ s: true, i: false, u: false, d: false });
    }
    const fn = await pool.query<{ secdef: boolean; owner: string; config: string[] | null; app: boolean; pub: boolean }>(
      `SELECT p.prosecdef AS secdef, pg_get_userbyid(p.proowner) AS owner, p.proconfig AS config,
              has_function_privilege('prs_app', p.oid, 'EXECUTE') AS app,
              EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE') AS pub
         FROM pg_proc p WHERE p.proname = 'gh_operations_policy_apply'`,
    );
    expect(fn.rows).toHaveLength(1);
    expect(fn.rows[0]).toMatchObject({ secdef: true, owner: 'prs_admin', app: true, pub: false });
    expect(fn.rows[0]?.config).toEqual(['search_path=pg_catalog, public, pg_temp']);
    // 함수 본문의 한정하지 않은 내장 함수·연산자를 prs_app이 만든 객체로 가로챌 수 없다 — public에 CREATE가 없다(독립 검토 A).
    const create = await pool.query<{ c: boolean }>("SELECT has_schema_privilege('prs_app', 'public', 'CREATE') AS c");
    expect(create.rows[0]?.c).toBe(false);
  });

  it('prs_app으로 직접 쓰면 거절된다 — 정책 표·이력 표·스냅숏 활성화', async () => {
    const { scope, definition } = await approvedScope();
    const attempts: readonly [string, string, unknown[]][] = [
      ['정책 UPDATE', `UPDATE gh_operations_policy SET blocked_capabilities = '{}' WHERE scope = $1`, [scope]],
      ['정책 INSERT', `INSERT INTO gh_operations_policy (scope, revision, updated_at, updated_by) VALUES ($1, 9, now(), 'x')`, [`${scope}.x`]],
      ['정책 DELETE', 'DELETE FROM gh_operations_policy WHERE scope = $1', [scope]],
      ['이력 INSERT', `INSERT INTO gh_operations_policy_revision (scope, revision, previous_revision, action, capability_id, actor, reason, correlation_id, idempotency_key, request_fingerprint)
                       VALUES ($1, 2, 1, 'resume', 'pr.list', 'x', 'x', gen_random_uuid(), 'k1234567', $2)`, [scope, 'a'.repeat(64)]],
      ['스냅숏 활성화', 'UPDATE gh_capability_snapshot SET activated_at = now() WHERE snapshot_id = $1', [definition.snapshotId]],
    ];
    for (const [label, sql, params] of attempts) {
      const outcome = await asApp((client) => client.query(sql, params)).then(
        () => 'allowed',
        (error: unknown) => errorCode(error),
      );
      expect(outcome, label).toBe(INSUFFICIENT_PRIVILEGE);
    }
  });

  it('prs_app은 실행 기록의 revision을 바꿔 가드를 비켜 갈 수 없다 (PRS10)', async () => {
    const { scope, definition } = await approvedScope();
    const row = await queuedExecution(scope, definition, 1);
    const outcome = await asApp((client) => client.query('UPDATE gh_execution SET policy_revision = 99 WHERE execution_id = $1', [row.execution_id])).then(
      () => 'allowed',
      (error: unknown) => errorCode(error),
    );
    expect(outcome).toBe('PRS10');
  });

  it('search_path 가로채기 — prs_app이 같은 이름의 임시 표를 만들어도 함수는 public 표에 쓴다', async () => {
    const scope = `${unique('ghe')}.test`;
    const outcome = await asApp(async (client) => {
      // ON COMMIT DROP — 풀 연결 세션에 임시 표가 남으면 뒤이은 시험의 한정하지 않은 조회가 이 표를 읽는다(실측).
      await client.query('CREATE TEMP TABLE gh_operations_policy (scope TEXT, revision BIGINT, blocked_capabilities TEXT[]) ON COMMIT DROP');
      await client.query('CREATE TEMP TABLE audit_record (user_id TEXT) ON COMMIT DROP');
      const applied = await policyRepo.applyPolicyChange(client, changeInput(scope, { action: 'block', expectedRevision: 0, capabilityId: 'pr.list' }));
      const temp = await client.query<{ n: number }>('SELECT count(*)::int AS n FROM pg_temp.gh_operations_policy');
      return { applied, temp: temp.rows[0]?.n };
    });
    expect(outcome.applied.outcome).toBe('applied');
    expect(outcome.temp).toBe(0);
    const state = await policyRepo.findPolicy(pool, scope);
    expect(state?.blocked_capabilities).toEqual(['pr.list']);
  });
});

describe('운영 승인 — 적용·재요청·키 재사용·기대 revision (FR-GH-011 AC-8)', () => {
  it('적용하면 상태·revision 이력·감사 한 행이 같은 상관 ID로 함께 남고 스냅숏의 최초 승인 시각이 채워진다', async () => {
    const scope = `${unique('ghe')}.test`;
    const definition = await seedDefinition();
    const evidence = await seedEvidence(scope, definition);
    const correlationId = randomUUID();
    const result = await apply(scope, { action: 'approve', expectedRevision: 0, definition, evidence, correlationId, actor: 'u-op-1', reason: '배포 r0.3 승인' });
    expect(result).toMatchObject({ outcome: 'applied', revision: 1 });

    const state = await policyRepo.findPolicy(pool, scope);
    expect(state).toMatchObject({
      revision: 1,
      approved_snapshot_id: definition.snapshotId,
      approved_verification_id: evidence.verificationId,
      approved_report_hash: evidence.reportHash,
      approved_manifest_hash: definition.manifestHash,
      approved_gh_version: '2.97.0',
      approved_by: 'u-op-1',
      blocked_capabilities: [],
    });
    const [revision] = await policyRepo.listPolicyRevisions(pool, scope);
    expect(revision).toMatchObject({ revision: 1, previous_revision: 0, action: 'approve', snapshot_id: definition.snapshotId, actor: 'u-op-1', reason: '배포 r0.3 승인', correlation_id: correlationId });
    const audit = await pool.query<{ action: string; target: string; query: string; result_code: string }>('SELECT action, target, query, result_code FROM audit_record WHERE correlation_id = $1', [correlationId]);
    expect(audit.rows).toEqual([{ action: 'gh_registry.approve', target: scope, query: '배포 r0.3 승인', result_code: 'applied' }]);
    const snapshot = await registry.findSnapshotById(pool, definition.snapshotId);
    expect(snapshot?.activated_at).toBeInstanceOf(Date);
  });

  it('같은 키·같은 내용의 재요청은 기존 결과를 돌려주고 아무것도 더 쓰지 않는다 — 다른 내용이면 거절한다', async () => {
    const scope = `${unique('ghe')}.test`;
    const definition = await seedDefinition();
    const evidence = await seedEvidence(scope, definition);
    const key = unique('idem').replace(/[^A-Za-z0-9_-]/g, '_');
    const first = await apply(scope, { action: 'approve', expectedRevision: 0, definition, evidence, key, fingerprint: fingerprint('same') });
    const before = { revisions: await count('gh_operations_policy_revision WHERE scope = $1', [scope]), audit: await count("audit_record WHERE target = $1 AND action = 'gh_registry.approve'", [scope]) };
    const replay = await apply(scope, { action: 'approve', expectedRevision: 0, definition, evidence, key, fingerprint: fingerprint('same') });
    expect(replay).toEqual({ outcome: 'replayed', revision: first.revision, revisionId: first.revisionId });
    expect(await count('gh_operations_policy_revision WHERE scope = $1', [scope])).toBe(before.revisions);
    expect(await count("audit_record WHERE target = $1 AND action = 'gh_registry.approve'", [scope])).toBe(before.audit);

    const reused = await rejection(apply(scope, { action: 'approve', expectedRevision: 0, definition, evidence, key, fingerprint: fingerprint('different') }));
    expect(reused).toMatchObject({ kind: 'key_reused', reason: 'idempotency_key_reused', detail: '1' });
  });

  it('기대 revision이 다르면 충돌이고 현재 revision을 알려 준다 — 이미 승인된 정의는 바꿀 것이 없다', async () => {
    const { scope, definition, evidence } = await approvedScope();
    expect(await rejection(apply(scope, { action: 'block', expectedRevision: 0, capabilityId: 'pr.list' }))).toMatchObject({ kind: 'conflict', reason: 'revision_changed', detail: '1' });
    expect(await rejection(apply(scope, { action: 'approve', expectedRevision: 1, definition, evidence }))).toMatchObject({ kind: 'no_change', reason: 'already_approved' });
  });

  it('철회하면 승인이 비고 이력에 철회한 정의가 남으며, 다시 승인해도 최초 승인 시각은 바뀌지 않는다', async () => {
    const { scope, definition, evidence } = await approvedScope();
    const firstActivation = (await registry.findSnapshotById(pool, definition.snapshotId))?.activated_at;
    await apply(scope, { action: 'revoke', expectedRevision: 1, reason: '장애 조사' });
    const revoked = await policyRepo.findPolicy(pool, scope);
    expect(revoked).toMatchObject({ revision: 2, approved_snapshot_id: null, approved_manifest_hash: null });
    const [revocation] = await policyRepo.listPolicyRevisions(pool, scope, 1);
    expect(revocation).toMatchObject({ action: 'revoke', snapshot_id: definition.snapshotId, verification_id: evidence.verificationId, manifest_hash: definition.manifestHash });
    expect(await rejection(apply(scope, { action: 'revoke', expectedRevision: 2 }))).toMatchObject({ kind: 'no_change', reason: 'not_approved' });

    await sleep(20);
    const fresh = await seedEvidence(scope, definition);
    await apply(scope, { action: 'approve', expectedRevision: 2, definition, evidence: fresh });
    const again = await registry.findSnapshotById(pool, definition.snapshotId);
    expect(again?.activated_at?.getTime()).toBe(firstActivation?.getTime());
  });
});

describe('승인 근거 — 함수가 잠금 아래에서 DB 사실을 다시 확인한다 (FR-GH-011 AC-7)', () => {
  const scopeAndDefinition = async (): Promise<{ scope: string; definition: Definition }> => ({ scope: `${unique('ghe')}.test`, definition: await seedDefinition() });

  it('더 최신의 실패·드리프트 기록이 있으면 과거 통과로 승인하지 않는다 (충돌)', async () => {
    const { scope, definition } = await scopeAndDefinition();
    const passed = await seedEvidence(scope, definition, { checkedAt: new Date(Date.now() - 60_000) });
    await seedEvidence(scope, definition, { status: 'drift' });
    expect(await rejection(apply(scope, { action: 'approve', expectedRevision: 0, definition, evidence: passed }))).toMatchObject({ kind: 'conflict', reason: 'evidence_not_latest' });
  });

  it('보고서 해시가 미리보기와 다르면 충돌이다', async () => {
    const { scope, definition } = await scopeAndDefinition();
    const evidence = await seedEvidence(scope, definition);
    expect(await rejection(apply(scope, { action: 'approve', expectedRevision: 0, definition, evidence: { ...evidence, reportHash: 'f'.repeat(64) } }))).toMatchObject({ kind: 'conflict', reason: 'evidence_changed' });
  });

  it('출처·범위·상태·관측값·스냅숏이 틀리면 부적격이다', async () => {
    const cases: readonly [string, EvidenceOptions & { unclassified?: number }, string][] = [
      ['CI 기록', { checkedBy: 'ci', scope: null }, 'evidence_missing'],
      ['다른 배포 범위', { scope: 'other-ghe.test' }, 'evidence_missing'],
      ['통과 아님', { status: 'incomplete' }, 'evidence_not_passed'],
      ['바이너리 관측 불일치', { binaryObserved: 'e'.repeat(64) }, 'evidence_binary_mismatch'],
      ['인벤토리 관측 불일치', { inventoryObserved: 'd'.repeat(64) }, 'evidence_inventory_mismatch'],
      ['manifest 관측 불일치', { manifestObserved: 'c'.repeat(64) }, 'evidence_manifest_mismatch'],
      ['신선도 한도 초과', { checkedAt: new Date(Date.now() - 2 * 3_600_000) }, 'evidence_stale'],
      ['미래 시각', { checkedAt: new Date(Date.now() + 3_600_000) }, 'evidence_stale'],
    ];
    for (const [label, options, reason] of cases) {
      const scope = `${unique('ghe')}.test`;
      const definition = await seedDefinition();
      const evidence = await seedEvidence(scope, definition, options);
      const refused = await rejection(apply(scope, { action: 'approve', expectedRevision: 0, definition, evidence, maxAgeMs: 3_600_000 }));
      expect(refused, label).toMatchObject({ kind: 'ineligible', reason });
    }
    const scope = `${unique('ghe')}.test`;
    const unclassified = await seedDefinition({ unclassified: 1 });
    const evidence = await seedEvidence(scope, unclassified);
    expect(await rejection(apply(scope, { action: 'approve', expectedRevision: 0, definition: unclassified, evidence }))).toMatchObject({ kind: 'ineligible', reason: 'snapshot_unclassified' });
  });

  it('인자 모양이 틀리면 쓰기 전에 거절한다 — 신선도 한도를 부풀리는 호출도 거절한다', async () => {
    const { scope, definition } = await scopeAndDefinition();
    const evidence = await seedEvidence(scope, definition);
    expect(await rejection(apply(scope, { action: 'approve', expectedRevision: 0, definition, evidence, maxAgeMs: 30 * 86_400_000 }))).toMatchObject({ kind: 'invalid', reason: 'invalid_evidence_max_age' });
    expect(await rejection(apply('bad scope', { action: 'block', expectedRevision: 0, capabilityId: 'pr.list' }))).toMatchObject({ kind: 'invalid', reason: 'invalid_scope' });
    expect(await rejection(apply(scope, { action: 'block', expectedRevision: 0, capabilityId: 'PR LIST' }))).toMatchObject({ kind: 'invalid', reason: 'invalid_capability_id' });
    expect(await rejection(apply(scope, { action: 'block', expectedRevision: 0, capabilityId: 'pr.list', reason: '   ' }))).toMatchObject({ kind: 'invalid', reason: 'invalid_reason' });
  });
});

describe('차단·재개 (FR-GH-009 AC-8)', () => {
  it('차단은 목록에 더하고 감사 대상이 `{범위}/{capability}`이며, 같은 상태로 다시 바꾸려 하면 바꿀 것이 없다', async () => {
    const { scope } = await approvedScope();
    const correlationId = randomUUID();
    await apply(scope, { action: 'block', expectedRevision: 1, capabilityId: 'pr.list', correlationId, reason: '사고 대응' });
    expect((await policyRepo.findPolicy(pool, scope))?.blocked_capabilities).toEqual(['pr.list']);
    const audit = await pool.query<{ action: string; target: string }>('SELECT action, target FROM audit_record WHERE correlation_id = $1', [correlationId]);
    expect(audit.rows).toEqual([{ action: 'gh_capability.block', target: `${scope}/pr.list` }]);
    expect(await rejection(apply(scope, { action: 'block', expectedRevision: 2, capabilityId: 'pr.list' }))).toMatchObject({ kind: 'no_change', reason: 'already_blocked' });
    await apply(scope, { action: 'resume', expectedRevision: 2, capabilityId: 'pr.list' });
    expect((await policyRepo.findPolicy(pool, scope))?.blocked_capabilities).toEqual([]);
    expect(await rejection(apply(scope, { action: 'resume', expectedRevision: 3, capabilityId: 'pr.list' }))).toMatchObject({ kind: 'no_change', reason: 'not_blocked' });
  });
});

describe('감사 실패는 변경을 커밋하지 않는다 (FR-AUTH-004 AC-6 예외)', () => {
  it('audit_record INSERT가 실패하면 상태·이력·스냅숏 활성화가 모두 그대로다', async () => {
    const scope = `${unique('ghe')}.test`;
    const definition = await seedDefinition();
    const evidence = await seedEvidence(scope, definition);
    await pool.query(`CREATE OR REPLACE FUNCTION test_audit_fail() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.user_id = 'test:audit-fail' THEN RAISE EXCEPTION 'audit store unavailable (test)'; END IF; RETURN NEW; END $$`);
    await pool.query('CREATE TRIGGER test_audit_fail_trg BEFORE INSERT ON audit_record FOR EACH ROW EXECUTE FUNCTION test_audit_fail()');
    try {
      const outcome = await apply(scope, { action: 'approve', expectedRevision: 0, definition, evidence, actor: 'test:audit-fail' }).then(
        () => 'applied',
        (error: unknown) => (error instanceof policyRepo.PolicyChangeRejected ? `rejected:${error.reason}` : `error:${(error as Error).message}`),
      );
      expect(outcome).toBe('error:audit store unavailable (test)');
    } finally {
      await pool.query('DROP TRIGGER IF EXISTS test_audit_fail_trg ON audit_record');
      await pool.query('DROP FUNCTION IF EXISTS test_audit_fail()');
    }
    expect(await policyRepo.findPolicy(pool, scope)).toBeNull();
    expect(await count('gh_operations_policy_revision WHERE scope = $1', [scope])).toBe(0);
    expect((await registry.findSnapshotById(pool, definition.snapshotId))?.activated_at).toBeNull();
  });
});

describe('동시성 — 먼저 성공한 변경만 반영되고 나머지는 충돌이다', () => {
  async function concurrently<A, B>(first: (client: PoolClient) => Promise<A>, second: (client: PoolClient) => Promise<B>): Promise<{ first: A | Error; second: B | Error; secondWaited: boolean }> {
    const a = await pool.connect();
    const b = await pool.connect();
    try {
      await a.query('BEGIN');
      await a.query('SET LOCAL ROLE prs_app');
      await b.query('BEGIN');
      await b.query('SET LOCAL ROLE prs_app');
      const firstResult = await first(a).catch((error: unknown) => error as Error);
      let secondDone = false;
      const secondPromise = second(b)
        .catch((error: unknown) => error as Error)
        .finally(() => {
          secondDone = true;
        });
      await sleep(300);
      const secondWaited = !secondDone;
      await a.query(firstResult instanceof Error ? 'ROLLBACK' : 'COMMIT');
      const secondResult = await secondPromise;
      await b.query(secondResult instanceof Error ? 'ROLLBACK' : 'COMMIT');
      return { first: firstResult, second: secondResult, secondWaited };
    } finally {
      a.release();
      b.release();
    }
  }

  it('두 운영자가 같은 revision을 보고 승인하면 하나만 적용된다', async () => {
    const scope = `${unique('ghe')}.test`;
    const definition = await seedDefinition();
    const evidence = await seedEvidence(scope, definition);
    const outcome = await concurrently(
      (client) => policyRepo.applyPolicyChange(client, changeInput(scope, { action: 'approve', expectedRevision: 0, definition, evidence, actor: 'u-op-a' })),
      (client) => policyRepo.applyPolicyChange(client, changeInput(scope, { action: 'approve', expectedRevision: 0, definition, evidence, actor: 'u-op-b' })),
    );
    expect(outcome.secondWaited).toBe(true);
    expect(outcome.first).toMatchObject({ outcome: 'applied', revision: 1 });
    expect(outcome.second).toBeInstanceOf(policyRepo.PolicyChangeRejected);
    expect(outcome.second).toMatchObject({ kind: 'conflict', reason: 'revision_changed', detail: '1' });
    expect(await count('gh_operations_policy_revision WHERE scope = $1', [scope])).toBe(1);
  });

  it('승인과 차단이 경합하면 먼저 커밋한 쪽만 반영된다', async () => {
    const scope = `${unique('ghe')}.test`;
    const definition = await seedDefinition();
    const evidence = await seedEvidence(scope, definition);
    const outcome = await concurrently(
      (client) => policyRepo.applyPolicyChange(client, changeInput(scope, { action: 'block', expectedRevision: 0, capabilityId: 'pr.list', actor: 'u-op-a' })),
      (client) => policyRepo.applyPolicyChange(client, changeInput(scope, { action: 'approve', expectedRevision: 0, definition, evidence, actor: 'u-op-b' })),
    );
    expect(outcome.first).toMatchObject({ outcome: 'applied', revision: 1 });
    expect(outcome.second).toMatchObject({ kind: 'conflict', reason: 'revision_changed' });
    const state = await policyRepo.findPolicy(pool, scope);
    expect(state).toMatchObject({ revision: 1, approved_snapshot_id: null, blocked_capabilities: ['pr.list'] });
  });

  it('승인이 잠금을 쥔 동안 같은 범위의 새 검증 기록은 커밋되지 못하고 기다린다 — 직렬화 지점', async () => {
    const scope = `${unique('ghe')}.test`;
    const definition = await seedDefinition();
    const evidence = await seedEvidence(scope, definition);
    const a = await pool.connect();
    try {
      await a.query('BEGIN');
      await a.query('SET LOCAL ROLE prs_app');
      await policyRepo.applyPolicyChange(a, changeInput(scope, { action: 'approve', expectedRevision: 0, definition, evidence }));
      let inserted = false;
      const insertion = seedEvidence(scope, definition, { status: 'drift' }).then(() => {
        inserted = true;
      });
      await sleep(300);
      expect(inserted).toBe(false);
      await a.query('COMMIT');
      await insertion;
      expect(inserted).toBe(true);
    } finally {
      a.release();
    }
    const latest = await registry.latestExecutorVerification(pool, scope, { excludeTransientErrors: false });
    expect(latest?.status).toBe('drift');
  });

  it('실행권 확정이 먼저 잠금을 쥐면 차단은 그 뒤에 커밋되고, 차단 뒤의 확정은 가드가 거절한다', async () => {
    const { scope, definition } = await approvedScope();
    const first = await queuedExecution(scope, definition, 1);
    const second = await queuedExecution(scope, definition, 1);
    const claimer = await pool.connect();
    try {
      await claimer.query('BEGIN');
      await claimer.query('SET LOCAL ROLE prs_app');
      await policyRepo.lockPolicyShared(claimer, scope);
      const claimed = await execution.claimExecution(claimer, first.execution_id, 'exec-a');
      expect(claimed?.state).toBe('running');
      let blocked = false;
      const blocking = apply(scope, { action: 'block', expectedRevision: 1, capabilityId: 'pr.list' }).then(() => {
        blocked = true;
      });
      await sleep(300);
      expect(blocked).toBe(false);
      await claimer.query('COMMIT');
      await blocking;
    } finally {
      claimer.release();
    }
    expect((await execution.findById(pool, first.execution_id))?.state).toBe('running');
    const late = await asApp((client) => execution.claimExecution(client, second.execution_id, 'exec-b')).then(
      () => 'claimed',
      (error: unknown) => errorCode(error),
    );
    expect(late).toBe('PRS11');
    expect((await execution.findById(pool, second.execution_id))?.state).toBe('queued');
  });

  it('잠금 키 문자열이 TypeScript와 SQL에서 같다', async () => {
    const scope = `${unique('ghe')}.test`;
    const holder = await pool.connect();
    try {
      await holder.query('BEGIN');
      await holder.query('SELECT pg_advisory_xact_lock(hashtext($1))', [ghPolicyLockKey(scope)]);
      let done = false;
      const pending = apply(scope, { action: 'block', expectedRevision: 0, capabilityId: 'pr.list' }).then(() => {
        done = true;
      });
      await sleep(300);
      expect(done).toBe(false);
      await holder.query('COMMIT');
      await pending;
      expect(done).toBe(true);
    } finally {
      holder.release();
    }
  });
});

describe('실행권 확정 가드 — 옛 앱 경로가 실행을 다시 열지 못한다 (롤백 방어)', () => {
  it('revision 없는 새 실행 기록은 들어가지 않는다 (PRS10)', async () => {
    const { scope, definition } = await approvedScope();
    const outcome = await pool
      .query(
        `INSERT INTO gh_execution (user_id, github_actor, host, capability_id, invocation, context, redacted_argv, risk_level, state,
                                   gh_version, manifest_version, manifest_hash, idempotency_key, authorization_result, correlation_id)
         VALUES ('u-old', 'alice', $1, 'pr.list', '{}', '{}', '{}', 'R0', 'queued', '2.97.0', 'r0.3', $2, 'old-api-key', 'x', gen_random_uuid())`,
        [scope, definition.manifestHash],
      )
      .then(
        () => 'inserted',
        (error: unknown) => errorCode(error),
      );
    expect(outcome).toBe('PRS10');
  });

  it('새 실행 기록은 queued로만 들어간다 — prs_app이 running·종료 상태로 바로 넣어 claim 대조를 건너뛰지 못한다 (PRS10)', async () => {
    const { scope, definition } = await approvedScope();
    for (const state of ['running', 'succeeded', 'policy_blocked']) {
      const outcome = await asApp((client) =>
        client.query(
          `INSERT INTO gh_execution (user_id, github_actor, host, capability_id, invocation, context, redacted_argv, risk_level, state,
                                     gh_version, manifest_version, manifest_hash, idempotency_key, authorization_result, correlation_id, policy_revision)
           VALUES ('u-direct', 'alice', $1, 'pr.list', '{}', '{}', '{}', 'R0', $2, '2.97.0', 'r0.3', $3, $4, 'x', gen_random_uuid(), 1)`,
          [scope, state, definition.manifestHash, unique('direct').replace(/[^A-Za-z0-9_-]/g, '_')],
        ),
      ).then(
        () => 'inserted',
        (error: unknown) => errorCode(error),
      );
      expect(outcome, state).toBe('PRS10');
    }
  });

  it('현재 정책과 다른 요청의 claim은 거절되고, 맞는 요청만 running이 된다 (PRS11)', async () => {
    const { scope, definition } = await approvedScope();
    const stale = await queuedExecution(scope, definition, 0);
    const otherDefinition = await queuedExecution(scope, { manifestVersion: 'r0.3', manifestHash: 'b'.repeat(64) }, 1);
    const good = await queuedExecution(scope, definition, 1);
    for (const [label, row] of [['과거 revision', stale], ['승인과 다른 정의', otherDefinition]] as const) {
      const outcome = await asApp((client) => execution.claimExecution(client, row.execution_id, 'exec-old')).then(
        () => 'claimed',
        (error: unknown) => errorCode(error),
      );
      expect(outcome, label).toBe('PRS11');
    }
    expect((await asApp((client) => execution.claimExecution(client, good.execution_id, 'exec-new')))?.state).toBe('running');

    await apply(scope, { action: 'block', expectedRevision: 1, capabilityId: 'pr.list' });
    const blockedRow = await queuedExecution(scope, definition, 2);
    const blocked = await asApp((client) => execution.claimExecution(client, blockedRow.execution_id, 'exec-new')).then(
      () => 'claimed',
      (error: unknown) => errorCode(error),
    );
    expect(blocked).toBe('PRS11');
  });
});

describe('029 → 030 → 029 → 030 왕복 — 과거 행 보존과 승인 비승계', () => {
  it('내리면 정책 표·함수·가드가 사라지고 029 기록은 남는다. 다시 올려도 승인은 자동으로 생기지 않고, 그 사이의 대기 요청은 실행되지 않는다', async () => {
    const { scope, definition } = await approvedScope();
    const verificationsBefore = await count('gh_capability_verification', []);
    const auditBefore = await count("audit_record WHERE action = 'gh_registry.approve'", []);

    // 030 위에 031(CR-100)이 쌓였다 — 030을 내리려면 함께 내린다. 목록으로 단언하므로 새 마이그레이션이 생기면 여기서 깨진다.
    expect(await migrateDown(pool, 7)).toEqual(['036', '035', '034', '033', '032', '031', '030']);
    expect(await appliedVersions(pool)).not.toContain('030');
    const objects = await pool.query<{ policy: string | null; revision: string | null; fn: number }>(
      `SELECT to_regclass('gh_operations_policy')::text AS policy, to_regclass('gh_operations_policy_revision')::text AS revision,
              (SELECT count(*)::int FROM pg_proc WHERE proname IN ('gh_operations_policy_apply', 'gh_execution_policy_guard')) AS fn`,
    );
    expect(objects.rows[0]).toEqual({ policy: null, revision: null, fn: 0 });
    expect(await count('gh_capability_verification', [])).toBe(verificationsBefore);
    expect((await registry.findSnapshotById(pool, definition.snapshotId))?.activated_at).toBeInstanceOf(Date);

    // 030이 없는 동안(옛 앱)의 대기 요청 — revision 열이 없다.
    const legacy = await pool.query<{ execution_id: number }>(
      `INSERT INTO gh_execution (user_id, github_actor, host, capability_id, invocation, context, redacted_argv, risk_level, state,
                                 gh_version, manifest_version, manifest_hash, idempotency_key, authorization_result, correlation_id)
       VALUES ('u-legacy', 'alice', $1, 'pr.list', '{}', '{}', '{}', 'R0', 'queued', '2.97.0', 'r0.3', $2, $3, 'x', gen_random_uuid())
       RETURNING execution_id`,
      [scope, definition.manifestHash, unique('legacy').replace(/[^A-Za-z0-9_-]/g, '_')],
    );

    expect(await migrateUp(pool)).toEqual(['030', '031', '032', '033', '034', '035', '036']);
    expect(await policyRepo.findPolicy(pool, scope)).toBeNull();
    expect(await count("audit_record WHERE action = 'gh_registry.approve'", [])).toBe(auditBefore);
    const legacyId = legacy.rows[0]?.execution_id ?? -1;
    const claim = await asApp((client) => execution.claimExecution(client, legacyId, 'exec-new')).then(
      () => 'claimed',
      (error: unknown) => errorCode(error),
    );
    expect(claim).toBe('PRS11');
  });
});
