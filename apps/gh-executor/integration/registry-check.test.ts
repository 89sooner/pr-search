/**
 * 레지스트리 검사 — JOB-GH-003 (FR-GH-011 AC-2·AC-3, NFR-009 GATE-GH-02, WP-078 / CR-088).
 *
 * **실제 고정 gh 바이너리**와 **실제 PostgreSQL**로 본다:
 *   - 기동 검사가 스냅숏(해시마다 한 행)과 검증 기록(회차마다 한 행)을 남기고, 두 번째 회차는 스냅숏을 재사용한다
 *   - 드리프트가 확인되면 `stale`이 서고 검증 기록에 status·diff가 남는다 — 실행기는 그때 `registry_stale`로 거절한다
 *   - 일시 오류는 3회까지 다시 시도하고, 끝내 오류면 기록은 남기되 `stale`을 바꾸지 않는다
 *   - 주기 검사기는 동시 1로 돌고 stop이 진행 중 회차를 기다린다
 *
 * 드리프트·오류 경로는 검사 함수를 바꿔 끼워 재현한다 — 실제 바이너리를 바꿔치기하지 않는다.
 *
 * 검증: `pnpm test:integration gh-executor/integration/registry-check`
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ghRegistryRepo, type Pool } from '@prs/db';
import { GH_PINNED_VERSION, type GhCapabilityManifest } from '@prs/gh-cli';
import { loadManifest, type DriftCheck } from '@prs/gh-cli/node';
import { resolveExecutorConfig } from '../src/config.js';
import { createExecutorMetrics } from '../src/metrics.js';
import { runRegistryCheck, startRegistryChecker, type RegistryCheckDeps } from '../src/registry-check.js';
import { migratedPool } from '../../../packages/db/integration/helpers.js';
import { ensurePinnedGh } from '../../../packages/gh-cli/testing/pinned-gh.js';

let pool: Pool;
let binary: string;
let manifest: GhCapabilityManifest;
let logs: Record<string, unknown>[] = [];

function deps(extra: Partial<RegistryCheckDeps> = {}): RegistryCheckDeps {
  const config = resolveExecutorConfig({
    GH_OPERATIONS_ENABLED: 'true',
    GHE_BASE_URL: 'https://ghe.test',
    GH_IDENTITY_VAULT_KEY: 'ef'.repeat(32),
    GH_EXECUTOR_BIN: binary,
    GH_EXECUTOR_REGISTRY_CHECK_MS: '60000',
  });
  return { pool, config, manifest, metrics: createExecutorMetrics(), log: (entry) => logs.push(entry as Record<string, unknown>), retryDelaysMs: [1, 1, 1], ...extra };
}

const MATCH: DriftCheck = {
  status: 'match',
  ghVersionExpected: '2.97.0',
  ghVersionObserved: '2.97.0',
  binarySha256Expected: 'x',
  binarySha256Observed: 'x',
  inventoryHashExpected: 'h',
  inventoryHashObserved: 'h',
  diff: { addedCommands: [], removedCommands: [], changedCommands: [] },
  error: null,
};

beforeAll(async () => {
  pool = await migratedPool();
  binary = await ensurePinnedGh();
  manifest = loadManifest(GH_PINNED_VERSION);
}, 180_000);

afterAll(async () => {
  await pool.query('TRUNCATE gh_capability_verification, gh_capability_snapshot RESTART IDENTITY CASCADE');
  await pool.end();
});

beforeEach(async () => {
  logs = [];
  await pool.query('TRUNCATE gh_capability_verification, gh_capability_snapshot RESTART IDENTITY CASCADE');
});

describe('기동 검사 — 실제 바이너리·실제 manifest', () => {
  it('스냅숏 한 행과 검증 기록 한 행을 남기고, 두 번째 회차는 같은 스냅숏에 기록만 더한다', async () => {
    const first = await runRegistryCheck(deps(), 'startup');
    // 커밋된 manifest(r0.3)는 GATE-GH-01·01b·01d를 통과한다(CR-089) — passed이며 stale이 아니다.
    expect(first.status).toBe('passed');
    expect(first.report.gates.every((gate) => gate.pass)).toBe(true);
    expect(first.stale).toBe(false);
    expect(first.attempts).toBe(1);
    expect(first.drift.status).toBe('match');
    expect(first.report.execution.allowed).toEqual(['pr.list']);

    const snapshots = await ghRegistryRepo.listSnapshots(pool);
    expect(snapshots).toHaveLength(1);
    // 검사가 passed여도 스냅숏을 활성화하지 않는다 — 활성화는 운영자의 별도 절차다(WP-059, CR-089 범위 밖).
    expect(snapshots[0]).toMatchObject({ manifest_hash: manifest.hash, manifest_version: 'r0.3', gh_version: '2.97.0', unclassified_count: 0, executable_count: 1, leaf_command_count: 196, flag_count: 1034, activated_at: null });
    const verifications = await ghRegistryRepo.listVerifications(pool);
    expect(verifications).toHaveLength(1);
    expect(verifications[0]).toMatchObject({ checked_by: 'gh-executor', trigger: 'startup', status: 'passed', gh_version_observed: '2.97.0', manifest_hash_expected: manifest.hash });
    expect(verifications[0]?.inventory_hash_observed).toBe(verifications[0]?.inventory_hash_expected);
    expect((verifications[0]?.environment as { binary_path?: string }).binary_path).toBe(binary);
    expect(verifications[0]?.report as { status?: string; reportVersion?: string }).toMatchObject({ status: 'passed', reportVersion: 'r2' });
    // 결과 계약 요약이 검증 기록에 남는다 — 실행 허용은 그대로 하나다.
    expect((verifications[0]?.report as { contracts?: { executableCommands: string[]; executableFlows: number } }).contracts).toMatchObject({ executableCommands: ['pr.list'], executableFlows: 0 });

    const second = await runRegistryCheck(deps(), 'periodic');
    expect(second.snapshotId).toBe(first.snapshotId);
    expect(second.verificationId).not.toBe(first.verificationId);
    expect(await ghRegistryRepo.listSnapshots(pool)).toHaveLength(1);
    expect(await ghRegistryRepo.listVerifications(pool)).toHaveLength(2);
  }, 240_000);
});

describe('드리프트·오류 경로 (검사 함수 주입)', () => {
  it('드리프트가 확인되면 stale이 서고 기록에 diff가 남는다 — 다음 회차가 match면 내린다', async () => {
    const drifted: DriftCheck = { ...MATCH, status: 'drift', inventoryHashObserved: 'other', diff: { addedCommands: ['pr frobnicate'], removedCommands: [], changedCommands: ['pr list'] } };
    let next = drifted;
    const checker = startRegistryChecker(deps({ drift: () => next }), 3_600_000);
    const result = await checker.runOnce('startup');
    expect(result?.status).toBe('drift');
    expect(checker.state()).toMatchObject({ status: 'drift', stale: true });
    expect(checker.state().detail).toContain('added 1');
    const row = (await ghRegistryRepo.listVerifications(pool))[0];
    expect(row?.status).toBe('drift');
    expect(row?.drift).toEqual(drifted.diff);
    expect(logs.some((entry) => entry['level'] === 'error' && String(entry['message']).includes('registry_stale'))).toBe(true);

    next = MATCH;
    await checker.runOnce('periodic');
    expect(checker.state()).toMatchObject({ status: 'passed', stale: false });
    await checker.stop();
  });

  it('드리프트를 확인했는데 DB 기록이 실패해도 stale은 선다 — 기록 실패가 실행을 열어 두지 않는다 (독립 검토 가)', async () => {
    const drifted: DriftCheck = { ...MATCH, status: 'drift', inventoryHashObserved: 'other', diff: { addedCommands: ['pr frobnicate'], removedCommands: [], changedCommands: [] } };
    const deadPool = { query: async () => { throw new Error('db down'); } } as unknown as Pool;
    const base = deps({ drift: () => drifted });
    const checker = startRegistryChecker({ ...base, pool: deadPool }, 3_600_000);
    const result = await checker.runOnce('periodic');
    expect(result).not.toBeNull();
    expect(result?.status).toBe('drift');
    expect(result?.stale).toBe(true);
    expect(result?.verificationId).toBeNull();
    expect(result?.recordError).toContain('db down');
    expect(checker.state()).toMatchObject({ status: 'drift', stale: true, verificationId: null });
    expect(base.metrics.render()).toContain('record_failed');
    expect(logs.some((entry) => entry['level'] === 'error' && String(entry['message']).includes('registry_stale'))).toBe(true);
    // DB에는 아무 행도 남지 않았다 — 기록 실패는 기록 실패다.
    expect(await ghRegistryRepo.listVerifications(pool)).toEqual([]);
    await checker.stop();
  });

  it('바이너리 불일치·구조 실패는 failed이며 stale이다', async () => {
    const checker = startRegistryChecker(deps({ drift: () => ({ ...MATCH, status: 'binary_mismatch', binarySha256Observed: 'deadbeef' }) }), 3_600_000);
    const result = await checker.runOnce('manual');
    expect(result?.status).toBe('failed');
    expect(checker.state().stale).toBe(true);
    await checker.stop();
  });

  it('일시 오류는 3회까지 다시 시도하고, 끝내 오류면 기록은 남기되 stale은 바꾸지 않는다', async () => {
    let calls = 0;
    const flaky = deps({
      drift: () => {
        calls += 1;
        return calls < 3 ? { ...MATCH, status: 'error', diff: null, inventoryHashObserved: null, error: 'gh --help timed out' } : MATCH;
      },
    });
    const recovered = await runRegistryCheck(flaky, 'periodic');
    expect(recovered.attempts).toBe(3);
    expect(recovered.status).toBe('passed');
    expect(recovered.stale).toBe(false);

    const checker = startRegistryChecker(deps({ drift: () => ({ ...MATCH, status: 'error', diff: null, inventoryHashObserved: null, error: 'boom' }) }), 3_600_000);
    const failed = await checker.runOnce('periodic');
    expect(failed?.status).toBe('error');
    expect(failed?.attempts).toBe(4);
    expect(checker.state()).toMatchObject({ status: 'error', stale: false });
    const rows = await ghRegistryRepo.listVerifications(pool);
    expect(rows.map((row) => row.status).sort()).toEqual(['error', 'passed']);
    expect(rows.find((row) => row.status === 'error')?.error).toBe('boom');
    await checker.stop();
  });

  it('주기 검사기는 스스로 돌고 stop이 진행 중 회차를 기다린다', async () => {
    const checker = startRegistryChecker(deps({ drift: () => MATCH }), 30);
    await new Promise((resolve) => setTimeout(resolve, 200));
    await checker.stop();
    const rows = await ghRegistryRepo.listVerifications(pool, 50);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.trigger === 'periodic')).toBe(true);
    expect(checker.state().checkedAt).not.toBeNull();
  });

  it('진행 중이면 주기 tick을 건너뛴다 — 짧은 주기·느린 검사에서 회차가 쌓이지 않는다 (독립 검토 나)', async () => {
    const slow = (): Promise<DriftCheck> => new Promise((resolve) => setTimeout(() => resolve(MATCH), 100));
    const checker = startRegistryChecker(deps({ drift: slow }), 5);
    await new Promise((resolve) => setTimeout(resolve, 420));
    await checker.stop();
    const rows = await ghRegistryRepo.listVerifications(pool, 200);
    // 5ms tick × 420ms = 84번 tick이지만 회차마다 ≥100ms이므로 5번 안팎이다. 쌓였다면 수십 건이다.
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThanOrEqual(6);
  });

  it('stop은 재시도 대기(수십 초)를 기다리지 않고 즉시 끊는다', async () => {
    const failing = deps({ drift: () => ({ ...MATCH, status: 'error', diff: null, inventoryHashObserved: null, error: 'boom' }), retryDelaysMs: [30_000, 30_000, 30_000] });
    const checker = startRegistryChecker(failing, 3_600_000);
    const pending = checker.runOnce('periodic');
    await new Promise((resolve) => setTimeout(resolve, 50));
    const started = Date.now();
    await checker.stop();
    expect(Date.now() - started).toBeLessThan(2_000);
    const result = await pending;
    // 끊긴 회차는 마지막 관측(error)으로 기록되며 stale은 바꾸지 않는다.
    expect(result?.status).toBe('error');
    expect(checker.state().stale).toBe(false);
  });

  it('구조 실패(해시 불일치 manifest)는 일시 오류에 가려지지 않는다 — failed·stale', async () => {
    const tampered = { ...manifest, hash: 'deadbeef' };
    const checker = startRegistryChecker(deps({ manifest: tampered, drift: () => ({ ...MATCH, status: 'error', diff: null, inventoryHashObserved: null, error: 'timeout' }) }), 3_600_000);
    const result = await checker.runOnce('manual');
    expect(result?.status).toBe('failed');
    expect(result?.detail).toContain('구조 오류');
    expect(checker.state().stale).toBe(true);
    await checker.stop();
  });

  it('해시만 다른 드리프트(서명 밖 차이)는 detail이 그 사실을 말한다', async () => {
    const hashOnly: DriftCheck = { ...MATCH, status: 'drift', inventoryHashObserved: 'x'.repeat(64), diff: { addedCommands: [], removedCommands: [], changedCommands: [] } };
    const result = await runRegistryCheck(deps({ drift: () => hashOnly }), 'manual');
    expect(result.status).toBe('drift');
    expect(result.stale).toBe(true);
    expect(result.detail).toContain('인벤토리 해시 불일치');
    expect(result.detail).toContain('서명은 같고');
  });
});
