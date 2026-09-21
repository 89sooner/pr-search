/**
 * 마이그레이션 028 — Operations Plane 정본 (REL-007 R0 / WP-077, ENT-GH-001·002, CR-086).
 *
 * 실제 PostgreSQL로 본다:
 *   1. 027 → 028 → 027 → 028 왕복이 기존 표(merge_sequence)를 그대로 두는가
 *   2. 권한 — prs_app은 실행 기록을 읽고 쓰되 지우지 못하고, 파티션 표의 소유자는 prs_admin이다
 *   3. 파티션 — `ensureAllPartitions`가 gh_execution의 달 파티션을 만든다
 *   4. 제약 — 상태 CHECK, 위험도 CHECK, 중복 방지 키 유니크
 *   5. 봉인 표에 토큰 원문이 없다 (리포지터리가 바이트만 넣는다)
 *
 * CR-090: 실행 기록은 수락 시점의 운영 정책 revision을 적고, queued→running은 그 revision·승인 정의가 현재 정책과 같을 때만
 * 된다(마이그레이션 030 가드). 이 파일은 028의 상태 기계를 보므로, 실제 정책 함수로 이 호스트의 정의를 한 번 승인해 둔다 —
 * 가드를 끄거나 우회하지 않는다. 가드 자체의 거절은 `gh-policy.test.ts`가 본다.
 *
 * 검증: `pnpm test:integration gh-schema`
 */

import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { appliedVersions, migrateDown, migrateUp } from '../src/migrate.js';
import { ensureAllPartitions, partitionName } from '../src/partitions.js';
import * as ghExecutionRepo from '../src/repositories/gh-execution.js';
import * as ghIdentityRepo from '../src/repositories/gh-identity.js';
import * as ghPolicyRepo from '../src/repositories/gh-policy.js';
import * as ghRegistryRepo from '../src/repositories/gh-registry.js';
import { withTransaction } from '../src/pool.js';
import { migratedPool } from './helpers.js';

let pool: Pool;

const privilege = async (role: string, table: string, action: string): Promise<boolean> => {
  const result = await pool.query<{ granted: boolean }>('SELECT has_table_privilege($1, $2, $3) AS granted', [role, table, action]);
  return result.rows[0]?.granted === true;
};

beforeAll(async () => {
  pool = await migratedPool();
});

afterAll(async () => {
  await pool.query('TRUNCATE gh_execution, gh_execution_idempotency, gh_identity_secret, github_identity_connection, app_user RESTART IDENTITY CASCADE');
  await pool.end();
});

beforeEach(async () => {
  await pool.query('TRUNCATE gh_execution, gh_execution_idempotency, gh_identity_secret, github_identity_connection, app_user RESTART IDENTITY CASCADE');
  await pool.query(`INSERT INTO app_user (user_id, login) VALUES ('u-alice', 'alice'), ('u-bob', 'bob')`);
});

describe('028 왕복', () => {
  it('027 → 028 → 027 → 028 — 내려가면 세 표가 사라지고 올라오면 돌아온다', async () => {
    const before = await appliedVersions(pool);
    expect(before).toContain('028');
    // 029(레지스트리, CR-088)와 030(운영 정책, CR-090)이 028 위에 있다 — 셋을 내린다. 다음에 031이 생기면 이 단언이 즉시 깨진다 (CR-084의 규율).
    const reverted = await migrateDown(pool, 7);
    expect(reverted).toEqual(['034', '033', '032', '031', '030', '029', '028']);
    const tables = await pool.query<{ relname: string }>(
      `SELECT relname FROM pg_class WHERE relname IN ('gh_execution', 'gh_execution_idempotency', 'gh_identity_secret', 'github_identity_connection')`,
    );
    expect(tables.rows).toEqual([]);
    const applied = await migrateUp(pool);
    expect(applied).toEqual(['028', '029', '030', '031', '032', '033', '034']);
    await ensureAllPartitions(pool, 3);
    // 위 beforeEach의 사용자 행은 CASCADE로 살아 있다 — 028은 app_user를 건드리지 않는다.
    const users = await pool.query('SELECT count(*)::int AS n FROM app_user');
    expect(users.rows[0]?.n).toBe(2);
  });
});

describe('권한 (FR-GH-012 — 감사 축은 갱신하되 지우지 않는다)', () => {
  it('prs_app: gh_execution SELECT·INSERT·UPDATE 있음, DELETE 없음', async () => {
    expect(await privilege('prs_app', 'gh_execution', 'SELECT')).toBe(true);
    expect(await privilege('prs_app', 'gh_execution', 'INSERT')).toBe(true);
    expect(await privilege('prs_app', 'gh_execution', 'UPDATE')).toBe(true);
    expect(await privilege('prs_app', 'gh_execution', 'DELETE')).toBe(false);
  });

  it('prs_app: 연결·봉인 표는 CRUD 전부 (철회가 봉인을 지운다)', async () => {
    for (const table of ['github_identity_connection', 'gh_identity_secret']) {
      for (const action of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
        expect(await privilege('prs_app', table, action), `${table} ${action}`).toBe(true);
      }
    }
  });

  it('gh_execution의 소유자는 prs_admin이다 — 파티션 수명 잡이 자식을 만들고 지운다', async () => {
    const owner = await pool.query<{ rolname: string }>(
      `SELECT r.rolname FROM pg_class c JOIN pg_roles r ON r.oid = c.relowner WHERE c.relname = 'gh_execution'`,
    );
    expect(owner.rows[0]?.rolname).toBe('prs_admin');
  });
});

describe('파티션 (NFR-012 — 월별 파티션)', () => {
  it('ensureAllPartitions가 gh_execution의 이번 달 파티션을 만든다', async () => {
    const now = new Date();
    const name = partitionName('gh_execution', new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)));
    const result = await pool.query('SELECT to_regclass($1) AS oid', [name]);
    expect(result.rows[0]?.oid).not.toBeNull();
  });
});

const SCHEMA_HOST = 'ghe.example.com';
const SCHEMA_MANIFEST_HASH = 'a1'.repeat(32);

/** 이 호스트의 정의를 실제 정책 함수로 승인하고 revision을 돌려준다 (CR-090). 이미 승인돼 있으면 그 revision이다. */
async function approveSchemaDefinition(): Promise<number> {
  const current = await ghPolicyRepo.findPolicy(pool, SCHEMA_HOST);
  if (current?.approved_manifest_hash === SCHEMA_MANIFEST_HASH) return current.revision;
  const { row: snapshot } = await ghRegistryRepo.recordSnapshot(pool, {
    ghVersion: '2.97.0', manifestVersion: 'r0.1', manifestHash: SCHEMA_MANIFEST_HASH, inventoryHash: 'b2'.repeat(32),
    commandCount: 1, leafCommandCount: 1, groupCommandCount: 0, aliasOnlyCommandCount: 0, aliasCount: 0, positionalCount: 0, flagCount: 0,
    inheritedFlagCount: 0, jsonFieldCount: 0, unclassifiedCount: 0, interactionUnclassifiedCount: 0, flagUnclassifiedCount: 0,
    positionalUnclassifiedCount: 0, extensionCommandCount: 0, executableCount: 1, coverage: { dimensions: [] },
  });
  const evidence = await ghRegistryRepo.insertVerification(pool, {
    snapshotId: snapshot.snapshot_id, checkedBy: 'gh-executor', trigger: 'startup', scope: SCHEMA_HOST, environment: { registry_check_ms: 86_400_000 },
    ghVersionExpected: '2.97.0', ghVersionObserved: '2.97.0', binarySha256Expected: 'c3'.repeat(32), binarySha256Observed: 'c3'.repeat(32),
    manifestHashExpected: SCHEMA_MANIFEST_HASH, manifestHashObserved: SCHEMA_MANIFEST_HASH, inventoryHashExpected: 'b2'.repeat(32), inventoryHashObserved: 'b2'.repeat(32),
    validatorVersion: 'validator-test', rulesVersion: 'rules-test', status: 'passed', drift: null, report: { reportVersion: 'r2' }, reportHash: 'd4'.repeat(32), error: null,
  });
  const applied = await ghPolicyRepo.applyPolicyChange(pool, {
    scope: SCHEMA_HOST, action: 'approve', expectedRevision: current?.revision ?? 0, actor: 'test:gh-schema', reason: '028 상태 기계 시험의 전제',
    correlationId: '00000000-0000-4000-8000-0000000000aa', idempotencyKey: `schema-${String(Date.now())}`, requestFingerprint: 'e5'.repeat(32),
    snapshotId: snapshot.snapshot_id, verificationId: evidence.verification_id, reportHash: evidence.report_hash, evidenceMaxAgeMs: 91_225_000,
  });
  return applied.revision;
}

let schemaRevision = 0;

const insertInput = (overrides: Partial<ghExecutionRepo.GhExecutionInsert> = {}): ghExecutionRepo.GhExecutionInsert => ({
  userId: 'u-alice',
  githubActor: 'alice',
  host: SCHEMA_HOST,
  repository: 'acme/payments',
  repositoryId: 4021,
  capabilityId: 'pr.list',
  invocation: { capability_id: 'pr.list' },
  context: {},
  redactedArgv: ['pr', 'list'],
  envKeys: [],
  riskLevel: 'R0',
  ghVersion: '2.97.0',
  manifestVersion: 'r0.1',
  manifestHash: SCHEMA_MANIFEST_HASH,
  idempotencyKey: 'key-00000001',
  authorizationResult: 'delegated_token_intersection',
  correlationId: '00000000-0000-4000-8000-000000000001',
  policyRevision: schemaRevision,
  ...overrides,
});

describe('제약과 상태 기계', () => {
  beforeAll(async () => {
    schemaRevision = await approveSchemaDefinition();
  });

  it('중복 방지 키는 같은 사용자 안에서 유일하다 (FR-GH-012 AC-5)', async () => {
    await ghExecutionRepo.insertExecution(pool, insertInput());
    await expect(ghExecutionRepo.insertExecution(pool, insertInput())).rejects.toBeInstanceOf(ghExecutionRepo.DuplicateIdempotencyKeyError);
    // 경합에서도 하나다 — 같은 키를 동시에 넣는다.
    const raced = await Promise.allSettled([1, 2, 3].map(() => ghExecutionRepo.insertExecution(pool, insertInput({ idempotencyKey: 'key-race-000001' }))));
    expect(raced.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    // 다른 사용자의 같은 키는 다른 실행이다.
    await ghExecutionRepo.insertExecution(pool, insertInput({ userId: 'u-bob', githubActor: 'bob' }));
  });

  it('위험도·상태 CHECK', async () => {
    await expect(ghExecutionRepo.insertExecution(pool, insertInput({ riskLevel: 'R9' }))).rejects.toThrow(/gh_execution_risk_chk/);
    await expect(pool.query(`UPDATE gh_execution SET state = 'exploded'`)).resolves.toBeDefined();
    const row = await ghExecutionRepo.insertExecution(pool, insertInput({ idempotencyKey: 'key-00000002' }));
    await expect(pool.query(`UPDATE gh_execution SET state = 'exploded' WHERE execution_id = $1`, [row.execution_id])).rejects.toThrow(/gh_execution_state_chk/);
  });

  it('claim은 queued일 때만, 한 번만 성공한다 — 두 실행기가 같은 행을 집지 못한다', async () => {
    const row = await ghExecutionRepo.insertExecution(pool, insertInput());
    const first = await ghExecutionRepo.claimExecution(pool, row.execution_id, 'exec-1');
    const second = await ghExecutionRepo.claimExecution(pool, row.execution_id, 'exec-2');
    expect(first?.state).toBe('running');
    expect(first?.executor_id).toBe('exec-1');
    expect(second).toBeNull();
  });

  it('finish는 그 실행기가 집은 running 행만 닫는다 — 회수된 뒤 늦게 온 결과가 덮지 않는다', async () => {
    const row = await ghExecutionRepo.insertExecution(pool, insertInput());
    await ghExecutionRepo.claimExecution(pool, row.execution_id, 'exec-1');
    const outcome: ghExecutionRepo.ExecutionOutcome = {
      state: 'succeeded', exitCode: 0, outputHash: 'x', error: null, result: { rows: [] },
      stdoutExcerpt: '[]', stderrExcerpt: null, stdoutTruncated: false, stderrTruncated: false, outputBinary: false,
    };
    expect(await ghExecutionRepo.finishExecution(pool, row.execution_id, 'exec-2', outcome)).toBeNull();
    const reclaimed = await ghExecutionRepo.reclaimOrphans(pool, new Date(Date.now() + 60_000));
    expect(reclaimed).toEqual([row.execution_id]);
    expect(await ghExecutionRepo.finishExecution(pool, row.execution_id, 'exec-1', outcome)).toBeNull();
    const final = await ghExecutionRepo.findById(pool, row.execution_id);
    expect(final?.state).toBe('failed');
    expect(final?.error).toBe('executor_lost');
  });

  it('취소 요청은 queued·running에만 걸리고 종료 뒤에는 무동작이다', async () => {
    const row = await ghExecutionRepo.insertExecution(pool, insertInput());
    expect((await ghExecutionRepo.requestCancel(pool, row.execution_id, 'u-alice'))?.cancel_requested_at).not.toBeNull();
    // 큐에서 집기 전 취소 → cancelled. claim은 이제 실패한다.
    expect(await ghExecutionRepo.claimExecution(pool, row.execution_id, 'exec-1')).toBeNull();
    expect((await ghExecutionRepo.cancelQueued(pool, row.execution_id))?.state).toBe('cancelled');
    expect(await ghExecutionRepo.requestCancel(pool, row.execution_id, 'u-alice')).toBeNull();
  });

  it('최근 24시간의 같은 키를 찾는다', async () => {
    const row = await ghExecutionRepo.insertExecution(pool, insertInput());
    expect((await ghExecutionRepo.findByIdempotencyKey(pool, 'u-alice', 'key-00000001'))?.execution_id).toBe(row.execution_id);
    expect(await ghExecutionRepo.findByIdempotencyKey(pool, 'u-bob', 'key-00000001')).toBeNull();
  });
});

describe('봉인 표 (FR-GH-008 AC-5)', () => {
  it('연결과 봉인이 한 트랜잭션이고, 재연결이 옛 봉인을 지우며, 철회가 봉인을 지운다', async () => {
    const sealed = Buffer.from('opaque-bytes-not-a-token');
    const first = await withTransaction(pool, (client) =>
      ghIdentityRepo.connectIdentity(client, {
        userId: 'u-alice', githubLogin: 'alice', githubUserId: 1, host: 'ghe', scopes: [],
        expiresAt: null, refreshExpiresAt: null, keyId: 'k1', accessSealed: sealed, refreshSealed: null,
      }),
    );
    const second = await withTransaction(pool, (client) =>
      ghIdentityRepo.connectIdentity(client, {
        userId: 'u-alice', githubLogin: 'alice', githubUserId: 1, host: 'ghe', scopes: ['x'],
        expiresAt: null, refreshExpiresAt: null, keyId: 'k1', accessSealed: sealed, refreshSealed: sealed,
      }),
    );
    expect(second.token_ref).not.toBe(first.token_ref);
    expect(await ghIdentityRepo.loadSecret(pool, first.token_ref)).toBeNull();
    expect((await ghIdentityRepo.loadSecret(pool, second.token_ref))?.refresh_sealed?.equals(sealed)).toBe(true);

    const revoked = await withTransaction(pool, (client) => ghIdentityRepo.revokeConnection(client, 'u-alice', 'user_disconnect'));
    expect(revoked?.revoked_at).not.toBeNull();
    expect(await ghIdentityRepo.loadSecret(pool, second.token_ref)).toBeNull();
    // 행은 남는다 — A-007이 「언제 왜 끊겼는가」를 답한다.
    expect((await ghIdentityRepo.findConnection(pool, 'u-alice'))?.revoke_reason).toBe('user_disconnect');
  });

  it('사용자 삭제가 연결·봉인을 함께 지운다 (ON DELETE CASCADE)', async () => {
    await withTransaction(pool, (client) =>
      ghIdentityRepo.connectIdentity(client, {
        userId: 'u-bob', githubLogin: 'bob', githubUserId: 2, host: 'ghe', scopes: [],
        expiresAt: null, refreshExpiresAt: null, keyId: 'k1', accessSealed: Buffer.from('x'), refreshSealed: null,
      }),
    );
    await pool.query(`DELETE FROM app_user WHERE user_id = 'u-bob'`);
    expect(await ghIdentityRepo.findConnection(pool, 'u-bob')).toBeNull();
    const secrets = await pool.query(`SELECT count(*)::int AS n FROM gh_identity_secret WHERE user_id = 'u-bob'`);
    expect(secrets.rows[0]?.n).toBe(0);
  });
});
