/**
 * 운영 승인·차단이 실제 실행을 통제하는 사용자 흐름 (WP-080 / FR-GH-011 AC-6~AC-10 · FR-GH-009 AC-8, CR-090).
 *
 * **실제 PostgreSQL · 실제 고정 gh 2.97.0 · 실제 HTTPS 목 GHE · 실제 레지스트리 검사기 · search-api의 실제 조회/변경/수락 함수 ·
 * 실제 러너**로 결정자 지시서 1장의 흐름을 순서대로 본다. 정책 판정을 대역으로 바꾸지 않는다.
 *
 *   1. 운영자가 현재 정의와 검증 근거를 미리 본다(무엇을 승인하는가, 무엇이 열리는가)
 *   2. 승인 전에는 pr.list가 거절된다 → 운영자가 승인한다
 *   3. 사용자가 pr.list를 실행한다 — gh가 실제로 GraphQL을 보낸다
 *   4. 운영자가 차단한다 → 새 요청은 거절되고, 차단 전에 수락된 대기 요청은 claim에서 닫힌다(gh 호출 0)
 *   5. 운영자가 명시적으로 재개한다 → 새 요청이 다시 판정된 뒤 실행된다. 닫힌 요청은 되살아나지 않는다
 *   6. 승인·차단·재개 기록(revision 이력·감사)을 확인한다
 *   그리고: 다른 capability는 여전히 거절, 재시작 뒤에도 정책 유지, 정의가 바뀌면 자동 승인 없음, 오래된 미리보기는 충돌,
 *   같은 키 재요청은 replayed, 철회하면 다시 운영 승인 필요.
 *
 * 웹 화면(Chromium)은 `apps/web/e2e/gh-policy.spec.ts`가 따로 본다 — 이 파일의 증거 범위는 API 함수·DB·실행기·gh다.
 *
 * 검증: `pnpm test:integration policy-flow`
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { InMemoryEventBus } from '@prs/bus';
import { authRepo, ghExecutionRepo, ghIdentityRepo, ghPolicyRepo, repositoryRepo, withTransaction, type GhExecutionRow, type Pool } from '@prs/db';
import { GH_PINNED_VERSION, type GhCapabilityManifest } from '@prs/gh-cli';
import { loadManifest, parseVaultKey, sealSecret } from '@prs/gh-cli/node';
import { resolveExecutorConfig, type ExecutorConfig } from '../src/config.js';
import { createExecutorMetrics } from '../src/metrics.js';
import { startRegistryChecker, type RegistryChecker } from '../src/registry-check.js';
import { runExecution, type RunnerDeps } from '../src/runner.js';
import { migratedPool } from '../../../packages/db/integration/helpers.js';
import { ensurePinnedGh } from '../../../packages/gh-cli/testing/pinned-gh.js';
import { startMockGhe, type MockGhe } from '../../../packages/gh-cli/testing/mock-ghe-tls.js';
import { resolveGhOpsConfig } from '../../search-api/src/gh/config.js';
import { GhRejected, prepare, requestExecution, type ExecutionDeps } from '../../search-api/src/gh/executions.js';
import { PolicyRequestRejected, changePolicy, executionGate, parsePolicyChange, policyStatus, type PolicyDeps } from '../../search-api/src/gh/policy.js';
import { operatorChange, policyDepsFor, readPreview } from './policy-helpers.js';

const VAULT_KEY = 'ab'.repeat(32);
const TOKEN = 'ghu_policyFlowToken00000000000001';
const REPO_ID = 5021;
const PRINCIPAL = { userId: 'u-flow-user', login: 'flow-user', roles: ['developer'] };
const INVOCATION = { capability_id: 'pr.list', context: { repository: 'acme/payments' }, flags: { '--state': 'open', '--limit': 5 }, output: { json_fields: ['number', 'title'] } };

let pool: Pool;
let mock: MockGhe;
let binary: string;
let manifest: GhCapabilityManifest;
let workspaceRoot: string;
let bus: InMemoryEventBus;
let config: ExecutorConfig;
let checker: RegistryChecker;
let policy: PolicyDeps;
let keySequence = 0;

const key = (): string => `flow-${String(Date.now())}-${String((keySequence += 1))}`;

function runnerDeps(overrides: Partial<RunnerDeps> = {}): RunnerDeps {
  return { pool, config, manifest, vaultKey: parseVaultKey(VAULT_KEY), metrics: createExecutorMetrics(), log: () => undefined, registry: { snapshot: () => checker.state() }, ...overrides };
}

function apiDeps(): ExecutionDeps {
  const ops = resolveGhOpsConfig({
    GH_OPERATIONS_ENABLED: 'true',
    GHE_BASE_URL: mock.baseUrl,
    GHE_API_URL: mock.apiUrl,
    GHE_OPS_CLIENT_ID: 'ops',
    GHE_OPS_CLIENT_SECRET: 'secret',
    GHE_OPS_REDIRECT_URI: 'http://web.test/gh/identity/callback',
    GH_IDENTITY_VAULT_KEY: VAULT_KEY,
  });
  return {
    pool,
    bus,
    config: ops,
    manifest,
    identity: { pool, redis: { get: async () => null, set: async () => 'OK', del: async () => 0 }, config: ops, vaultKey: parseVaultKey(VAULT_KEY), http: async () => ({ status: 500, body: null }) },
    scopes: { resolveCached: async () => ({ repositoryIds: [REPO_ID], orgIds: [], teamIds: [], visibilities: [], refreshedAt: Date.now(), version: 1 }) },
  };
}

async function request(): Promise<GhExecutionRow> {
  return requestExecution(apiDeps(), PRINCIPAL, INVOCATION, key(), '00000000-0000-4000-8000-0000000f0001');
}

async function refusal(promise: Promise<unknown>): Promise<GhRejected> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof GhRejected) return error;
    throw error;
  }
  throw new Error('거절을 기대했으나 수락됐다');
}

beforeAll(async () => {
  pool = await migratedPool();
  binary = await ensurePinnedGh();
  manifest = loadManifest(GH_PINNED_VERSION);
  workspaceRoot = mkdtempSync(join(tmpdir(), 'prs-gh-flow-'));
  bus = new InMemoryEventBus();
  mock = await startMockGhe({ expectedToken: TOKEN, pullRequests: [{ number: 31, title: 'Policy flow PR', author: 'alice', headRefName: 'feat/flow' }] });
  config = resolveExecutorConfig({
    GH_OPERATIONS_ENABLED: 'true',
    GHE_BASE_URL: mock.baseUrl,
    GH_IDENTITY_VAULT_KEY: VAULT_KEY,
    GH_EXECUTOR_BIN: binary,
    GH_EXECUTOR_WORKSPACE_ROOT: workspaceRoot,
    GH_EXECUTOR_CA_FILE: mock.caFile,
  });
  policy = policyDepsFor(pool, manifest, mock.host);

  /*
   * 다른 통합 시험 파일이 남긴 행을 비운다. CI는 모든 파일을 한 DB에서 차례로 돌리고 순서는 정해져 있지 않다 —
   * `acme/payments`를 다른 ID로 넣는 파일이 앞에 돌면 저장소 upsert가 (owner, name) 고유 제약에 걸린다(실측).
   * 정책 표도 비운다: 목 GHE의 포트가 다시 쓰이면 남은 정책이 이 흐름의 「승인 전」 전제를 깬다.
   */
  await pool.query('TRUNCATE gh_execution, gh_execution_idempotency, gh_identity_secret, github_identity_connection, app_user, repository, gh_operations_policy_revision, gh_operations_policy RESTART IDENTITY CASCADE');
  await authRepo.upsertUserOnLogin(pool, { user_id: PRINCIPAL.userId, login: PRINCIPAL.login });
  await repositoryRepo.upsertRepository(pool, { repository_id: REPO_ID, owner: 'acme', name: 'payments', org_id: 1, visibility: 'internal', sequence_branches: ['main'] });
  const vaultKey = parseVaultKey(VAULT_KEY);
  await withTransaction(pool, (client) =>
    ghIdentityRepo.connectIdentity(client, {
      userId: PRINCIPAL.userId, githubLogin: 'flow-user', githubUserId: 77, host: mock.host, scopes: [], expiresAt: null, refreshExpiresAt: null,
      keyId: vaultKey.keyId, accessSealed: sealSecret(vaultKey, TOKEN, PRINCIPAL.userId), refreshSealed: null,
    }),
  );

  // 실행기의 기동 검사 — 실제 바이너리로 인벤토리를 추출하고 이 배포 범위의 검증 기록을 남긴다.
  checker = startRegistryChecker({ pool, config, manifest, metrics: createExecutorMetrics(), log: () => undefined, retryDelaysMs: [1, 1, 1] }, 3_600_000);
  const startup = await checker.runOnce('startup');
  if (startup?.status !== 'passed') throw new Error(`기동 검사가 통과하지 않았다: ${String(startup?.status)} ${String(startup?.detail)}`);
}, 240_000);

afterAll(async () => {
  await checker.stop();
  await pool.query('TRUNCATE gh_execution, gh_execution_idempotency, gh_identity_secret, github_identity_connection, app_user, repository, gh_operations_policy_revision, gh_operations_policy RESTART IDENTITY CASCADE');
  await mock.close();
  await bus.close();
  rmSync(workspaceRoot, { recursive: true, force: true });
  await pool.end();
});

describe('사용자 흐름 — 승인·실행·차단·재개·기록 (결정자 지시서 1장)', () => {
  let approvedRevision = 0;
  let queuedBeforeBlock: GhExecutionRow;

  it('1·2. 승인 전에는 pr.list가 운영 승인 필요로 거절되고, 운영자는 무엇을 승인하는지 미리 본다', async () => {
    const gate = await executionGate(policy, 'pr.list');
    expect(gate).toMatchObject({ allowed: false, reason: 'admin_action_required', detail: 'no_approval', revision: 0 });
    expect((await refusal(request())).code).toBe('GH_ADMIN_ACTION_REQUIRED');
    expect(mock.graphqlRequests()).toHaveLength(0);

    const status = await policyStatus(policy);
    const preview = status['approval_preview'] as Record<string, unknown>;
    expect(preview).toMatchObject({ eligible: true, reasons: [], verification_id: checker.state().verificationId, report_version: 'r2', opens: ['pr.list'] });
    expect(preview['gates']).toEqual([{ id: 'GATE-GH-01', pass: true }, { id: 'GATE-GH-01b', pass: true }, { id: 'GATE-GH-01d', pass: true }]);
    expect(preview['not_opened']).toMatchObject({ leaf_commands: 196, executable_commands: 1, not_executable_commands: 195, recipes: 'not_available' });
    expect((preview['evidence'] as Record<string, unknown>)).toMatchObject({ checked_by: 'gh-executor', trigger: 'startup', status: 'passed', registry_check_ms: 86_400_000 });
    expect(status['served']).toMatchObject({ manifest_hash: manifest.hash, manifest_version: manifest.manifestVersion, gh_version: GH_PINNED_VERSION });
    expect(status['host_verification']).toMatchObject({ status: 'not_verified' });
  });

  it('2. 운영자가 미리보기대로 승인한다 — revision 1, 이력·감사가 남는다', async () => {
    const { revision, preview } = await readPreview(policy);
    const outcome = await operatorChange(policy, { action: 'approve', expected_revision: revision, reason: 'r0.3 배포 승인', snapshot_id: preview.snapshot_id, verification_id: preview.verification_id, report_hash: preview.report_hash }, 'u-flow-operator');
    expect(outcome).toMatchObject({ outcome: 'applied', revision: 1 });
    approvedRevision = outcome.revision;
    expect(await executionGate(policy, 'pr.list')).toEqual({ allowed: true, revision: 1 });
  });

  it('3. 사용자가 pr.list를 실행한다 — 실제 gh가 GraphQL을 보내고 결과와 이력이 남는다', async () => {
    const row = await request();
    expect(row).toMatchObject({ state: 'queued', policy_revision: approvedRevision });
    expect(await runExecution(runnerDeps(), row.execution_id)).toBe('succeeded');
    const done = await ghExecutionRepo.findById(pool, row.execution_id);
    expect(done?.state).toBe('succeeded');
    expect((done?.result as { rows: { number: number }[] }).rows.map((one) => one.number)).toEqual([31]);
    expect(mock.graphqlRequests()).toHaveLength(1);
  }, 60_000);

  it('4. 운영자가 차단하면 새 요청은 거절되고, 차단 전에 수락된 대기 요청도 claim에서 닫힌다 — gh 호출 0', async () => {
    queuedBeforeBlock = await request();
    const block = await operatorChange(policy, { action: 'block', expected_revision: approvedRevision, reason: '장애 대응 — 조회 폭주', capability_id: 'pr.list' }, 'u-flow-operator');
    expect(block).toMatchObject({ outcome: 'applied', revision: 2 });

    const refused = await refusal(request());
    expect(refused.code).toBe('GH_POLICY_BLOCKED');
    expect(refused.detail).toMatchObject({ reason: 'policy_blocked', detail: 'operator_blocked', policy_revision: 2 });
    // 미리보기도 같은 판정이다 — 사유가 계정 연결보다 먼저 온다.
    const preview = await prepare(apiDeps(), PRINCIPAL, INVOCATION);
    expect(preview.gate).toMatchObject({ allowed: false, reason: 'policy_blocked' });

    const before = mock.graphqlRequests().length;
    expect(await runExecution(runnerDeps(), queuedBeforeBlock.execution_id)).toBe('policy_closed');
    expect(await ghExecutionRepo.findById(pool, queuedBeforeBlock.execution_id)).toMatchObject({ state: 'policy_blocked', error: 'policy_blocked', policy_revision: 1 });
    expect(mock.graphqlRequests()).toHaveLength(before);
  }, 60_000);

  it('5. 운영자가 명시적으로 재개하면 새 요청이 다시 판정된 뒤 실행된다 — 닫힌 요청은 되살아나지 않는다', async () => {
    const resume = await operatorChange(policy, { action: 'resume', expected_revision: 2, reason: '장애 해소', capability_id: 'pr.list' }, 'u-flow-operator');
    expect(resume).toMatchObject({ outcome: 'applied', revision: 3 });
    const row = await request();
    expect(row.policy_revision).toBe(3);
    expect(await runExecution(runnerDeps(), row.execution_id)).toBe('succeeded');
    // 차단 중 닫힌 요청은 그대로 닫혀 있다. 다시 집어도 queued가 아니라 실행하지 않는다.
    expect(await runExecution(runnerDeps(), queuedBeforeBlock.execution_id)).toBe('not_queued');
    expect((await ghExecutionRepo.findById(pool, queuedBeforeBlock.execution_id))?.state).toBe('policy_blocked');
  }, 60_000);

  it('6. 승인·차단·재개 기록 — revision 이력과 감사 행이 운영자·사유·순서대로 남는다', async () => {
    const revisions = await ghPolicyRepo.listPolicyRevisions(pool, mock.host);
    expect(revisions.map((one) => [one.revision, one.action, one.actor, one.reason])).toEqual([
      [3, 'resume', 'u-flow-operator', '장애 해소'],
      [2, 'block', 'u-flow-operator', '장애 대응 — 조회 폭주'],
      [1, 'approve', 'u-flow-operator', 'r0.3 배포 승인'],
    ]);
    for (const revision of revisions) {
      const audit = await pool.query<{ action: string; result_code: string; user_id: string }>('SELECT action, result_code, user_id FROM audit_record WHERE correlation_id = $1', [revision.correlation_id]);
      expect(audit.rows, `revision ${String(revision.revision)}`).toHaveLength(1);
      expect(audit.rows[0]).toMatchObject({ result_code: 'applied', user_id: 'u-flow-operator' });
    }
    const status = await policyStatus(policy);
    expect((status['revisions'] as unknown[]).length).toBe(3);
    // 조회 본문은 중복 방지 키와 요청 지문을 내지 않는다.
    expect(JSON.stringify(status)).not.toContain('idempotency_key');
    expect(JSON.stringify(status)).not.toContain('request_fingerprint');
  });
});

describe('상한·재시작·정의 변경·오래된 확인·재요청·철회', () => {
  it('승인과 차단 해제가 있어도 다른 capability는 여전히 실행되지 않고, 차단·재개 대상도 되지 않는다', async () => {
    const refused = await refusal(prepare(apiDeps(), PRINCIPAL, { ...INVOCATION, capability_id: 'pr.view' }));
    expect(refused.code).toBe('GH_CAPABILITY_NOT_EXECUTABLE');
    expect(() => parsePolicyChange({ action: 'block', expected_revision: 3, reason: 'x', capability_id: 'pr.view' }, manifest)).toThrow(PolicyRequestRejected);
  });

  it('재시작 — 새 실행기(새 검사기·새 러너)도 DB의 승인·정책을 그대로 읽는다', async () => {
    const restarted = startRegistryChecker({ pool, config, manifest, metrics: createExecutorMetrics(), log: () => undefined, retryDelaysMs: [1, 1, 1] }, 3_600_000);
    try {
      expect((await restarted.runOnce('startup'))?.status).toBe('passed');
      const row = await request();
      expect(await runExecution(runnerDeps({ registry: { snapshot: () => restarted.state() } }), row.execution_id)).toBe('succeeded');
      expect(await executionGate(policyDepsFor(pool, manifest, mock.host), 'pr.list')).toMatchObject({ allowed: true, revision: 3 });
    } finally {
      await restarted.stop();
    }
  }, 120_000);

  it('정의가 바뀐 배포는 자동으로 승인되지 않는다 — 다른 스냅숏으로 옮겨 가지 않고 운영 승인 필요다', async () => {
    const changed = { ...manifest, hash: 'f0'.repeat(32) };
    const changedPolicy = { ...policy, manifest: changed };
    expect(await executionGate(changedPolicy, 'pr.list')).toMatchObject({ allowed: false, reason: 'admin_action_required', detail: 'approved_definition_differs' });
    const preview = await readPreview(changedPolicy);
    expect(preview.preview.eligible).toBe(false);
    expect(preview.preview.reasons.map((reason) => reason.code)).toEqual(expect.arrayContaining(['snapshot_missing', 'report_not_reproducible']));
  });

  it('오래된 미리보기로 제출하면 충돌이다 — 그 사이 새 검증 기록이 생겼다', async () => {
    await operatorChange(policy, { action: 'revoke', expected_revision: 3, reason: '재승인 시험' }, 'u-flow-operator');
    const stale = await readPreview(policy);
    expect(stale.preview.eligible).toBe(true);
    // 주기 검사가 새 기록을 남긴다.
    expect((await checker.runOnce('periodic'))?.status).toBe('passed');
    const refused = await operatorChange(policy, { action: 'approve', expected_revision: stale.revision, reason: '오래된 확인', snapshot_id: stale.preview.snapshot_id, verification_id: stale.preview.verification_id, report_hash: stale.preview.report_hash }).then(
      () => null,
      (error: unknown) => error,
    );
    expect(refused).toBeInstanceOf(PolicyRequestRejected);
    expect(refused).toMatchObject({ code: 'GH_POLICY_CONFLICT', detail: { reason: 'evidence_changed' } });
  }, 120_000);

  it('응답을 잃은 승인의 재요청은 같은 결과를 돌려주고 revision을 더 만들지 않는다', async () => {
    const fresh = await readPreview(policy);
    const body = parsePolicyChange({ action: 'approve', expected_revision: fresh.revision, reason: '재승인', snapshot_id: fresh.preview.snapshot_id, verification_id: fresh.preview.verification_id, report_hash: fresh.preview.report_hash }, manifest);
    const idempotencyKey = key();
    const first = await changePolicy(policy, 'u-flow-operator', body, idempotencyKey, '00000000-0000-4000-8000-0000000f0002');
    const again = await changePolicy(policy, 'u-flow-operator', body, idempotencyKey, '00000000-0000-4000-8000-0000000f0003');
    expect(first).toMatchObject({ outcome: 'applied' });
    expect(again).toMatchObject({ outcome: 'replayed', revision: first.revision });
    expect((await ghPolicyRepo.listPolicyRevisions(pool, mock.host, 1))[0]?.revision).toBe(first.revision);
  });

  it('재검증과 claim 사이에 차단되면 claim 트랜잭션의 판정이 닫는다 — 앞선 판정을 믿지 않고 gh 호출 0 (FR-GH-011 AC-9)', async () => {
    const queued = await request();
    const accepted = queued.policy_revision ?? -1;
    const before = mock.graphqlRequests().length;
    const outcome = await runExecution(
      runnerDeps({
        beforeClaim: async () => {
          await operatorChange(policy, { action: 'block', expected_revision: accepted, reason: 'claim 직전 차단', capability_id: 'pr.list' }, 'u-flow-operator');
        },
      }),
      queued.execution_id,
    );
    expect(outcome).toBe('policy_closed');
    // 사유가 `policy_blocked`다 — DB 가드가 거절한 뒤의 대체 경로(`policy_changed`)가 아니라 claim 트랜잭션의 판정이 막았다.
    expect(await ghExecutionRepo.findById(pool, queued.execution_id)).toMatchObject({ state: 'policy_blocked', error: 'policy_blocked', policy_revision: accepted });
    expect(mock.graphqlRequests()).toHaveLength(before);
    await operatorChange(policy, { action: 'resume', expected_revision: accepted + 1, reason: '경합 시험 뒤 재개', capability_id: 'pr.list' }, 'u-flow-operator');
  }, 60_000);

  it('정책 상태를 읽지 못하면 실행기는 대기 요청을 집지도 닫지도 않는다 — 다시 읽을 수 있게 되면 현재 정책으로 판정해 실행한다 (FR-GH-011 AC-9)', async () => {
    const queued = await request();
    const before = mock.graphqlRequests().length;
    // 마이그레이션 030이 빠진 DB나 권한 오류와 같은 조건 — 표 이름을 잠시 바꿔 정책 조회를 실패시킨다.
    await pool.query('ALTER TABLE gh_operations_policy RENAME TO gh_operations_policy_unreadable');
    try {
      expect(await runExecution(runnerDeps(), queued.execution_id)).toBe('policy_unavailable');
      expect((await ghExecutionRepo.findById(pool, queued.execution_id))?.state).toBe('queued');
      expect(mock.graphqlRequests()).toHaveLength(before);
    } finally {
      await pool.query('ALTER TABLE gh_operations_policy_unreadable RENAME TO gh_operations_policy');
    }
    expect(await runExecution(runnerDeps(), queued.execution_id)).toBe('succeeded');
    expect(mock.graphqlRequests()).toHaveLength(before + 1);
  }, 60_000);

  it('철회하면 새 요청은 다시 운영 승인 필요이고, 철회 전에 수락된 대기 요청은 닫힌다', async () => {
    const queued = await request();
    const current = (await readPreview(policy)).revision;
    await operatorChange(policy, { action: 'revoke', expected_revision: current, reason: '배포 교체 예정' }, 'u-flow-operator');
    expect((await refusal(request())).code).toBe('GH_ADMIN_ACTION_REQUIRED');
    expect(await runExecution(runnerDeps(), queued.execution_id)).toBe('policy_closed');
    expect(await ghExecutionRepo.findById(pool, queued.execution_id)).toMatchObject({ state: 'policy_blocked', error: 'admin_action_required' });
  }, 60_000);
});
