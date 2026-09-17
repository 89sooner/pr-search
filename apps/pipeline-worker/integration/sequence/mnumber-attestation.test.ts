/**
 * CR-100 / WP-088 — 운영자 확인서(FR-SEQ-008 AC-15)와 확정 근거 보존(DEV-715).
 *
 * ## 기대값은 손으로 선언한다
 *
 * squash 픽스처: R(직접, 00:00) · A(#21, 01:00) · D(직접, 02:00) · B(#25, 03:00) · C(#27, 04:00) · E(#29, 05:00).
 * 확인서 없이는 R에서 멈춘다(mnumber.test.ts). 유예 0 확인서가 있고 C를 GHE가 모르면 R·D·C를 번호 없이
 * 지나 A=1, B=2, E=3이다 — C는 나중에 알려져도 번호를 받지 않는다(AC-3, 번호는 옮기지 않는다). 유예가
 * 지나지 않은 항목은 확인서가 있어도 미확정으로 남고, 러너는 유예가 끝나는 시각으로 work를 미룬다.
 *
 * ## DEV-715
 *
 * 근거를 트랜잭션 밖에서 읽고 GHE를 조회하는 사이에 들어온 확정(수동 근거·확인서)을 `unresolved`로 덮은
 * 것이 사내 반입에서 실제로 일어났다. 회차는 잠근 채 다시 읽어 버전이 다르면 버리고, SQL은 확정 → 미확정을
 * 거절한다. 두 방어선을 각각 시험한다.
 *
 * 실행: `pnpm exec vitest run --config vitest.integration.config.ts apps/pipeline-worker/integration/sequence/mnumber-attestation`
 */

import type { Client } from '@elastic/elasticsearch';
import type { EventBus } from '@prs/bus';
import { MirrorCommitGraph, MirrorSync, type CommitGraph, type PullRequestEvidence, type RepoRef } from '@prs/github';
import {
  EvidenceDowngradeError,
  mnumberAttestationRepo,
  mnumberEvidenceRepo,
  repositoryRepo,
  sequenceSpaceRepo,
  sequenceWorkRepo,
  type Pool,
} from '@prs/db';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { migratedPool, truncate } from '../../../../packages/db/integration/helpers.js';
import { createWorkerMetrics } from '../../src/metrics.js';
import { prepareAndAssignSequence, type SequenceDeps } from '../../src/sequence.js';
import { reconcileMergeNumbers, type MergeNumberDeps } from '../../src/mnumber.js';
import type { PullRequestEvidenceSource } from '../../src/mnumber-evidence.js';
import { runMergeNumberAttestCommand } from '../../src/mnumber-attest-command.js';
import { runSequenceWorkOnce } from '../../src/sequence-work-runner.js';
import { makeTempDir, removeDir, run } from './fixture.js';
import { createSquashFixture, type SquashFixture } from './squash-fixture.js';

const REPOSITORY_ID = 7431;
const OWNER = 'acme';
const NAME = 'smp1900';
const BRANCH = 'main';

let pool: Pool;
let origin: SquashFixture;
let mirrorRoot: string;

function fakeEs(): Client {
  return {
    search: async (): Promise<unknown> => ({ hits: { hits: [] } }),
    updateByQuery: async (): Promise<unknown> => ({ updated: 0 }),
    get: async (): Promise<unknown> => {
      const error = new Error('not found') as Error & { statusCode: number };
      error.statusCode = 404;
      throw error;
    },
    update: async (): Promise<unknown> => ({ result: 'updated' }),
  } as unknown as Client;
}

function fakeBus(): EventBus {
  return {
    publish: async (): Promise<void> => undefined,
    subscribe: async (): Promise<never> => {
      throw new Error('시험에서 구독하지 않는다');
    },
    close: async (): Promise<void> => undefined,
  } as unknown as EventBus;
}

/** PR 상세 대역 — 알려진 PR만 답한다. 부재를 증명하지 않는다 (빈 목록일 뿐이다). */
function evidenceSource(known: ReadonlyMap<number, { sha: string; mergedAt: string }>): PullRequestEvidenceSource & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async getPullRequestEvidence(_ref: RepoRef, number: number): Promise<PullRequestEvidence | null> {
      calls.push(`detail:${String(number)}`);
      const entry = known.get(number);
      if (entry === undefined) return null;
      return {
        number,
        state: 'closed',
        merged: true,
        merged_at: entry.mergedAt,
        merge_commit_sha: entry.sha,
        updated_at: entry.mergedAt,
        base: { ref: BRANCH, sha: 'x'.repeat(40), repo: { id: REPOSITORY_ID } },
        head: { sha: 'y'.repeat(40) },
      };
    },
    async listPullRequestsForCommitPage(_ref: RepoRef, sha: string, page: number) {
      calls.push(`list:${sha.slice(0, 7)}:${String(page)}`);
      const items = [...known.entries()].filter(([, entry]) => entry.sha === sha).map(([number]) => ({ number }));
      return { items, nextPage: null, requestId: `req-${sha.slice(0, 7)}` };
    },
  };
}

function sequenceDeps(): SequenceDeps {
  const graph = new MirrorCommitGraph({ root: mirrorRoot, repositoryIdOf: () => REPOSITORY_ID });
  return {
    pool,
    es: fakeEs(),
    bus: fakeBus(),
    metrics: createWorkerMetrics(),
    graphFor: (): CommitGraph => graph,
    freshness: { pool, mode: 'mirror', sync: new MirrorSync({ root: mirrorRoot, remoteUrl: () => origin.url }) },
  };
}

function mnumberDeps(source: PullRequestEvidenceSource, overrides: Partial<MergeNumberDeps> = {}): MergeNumberDeps {
  const graph = new MirrorCommitGraph({ root: mirrorRoot, repositoryIdOf: () => REPOSITORY_ID });
  return {
    pool,
    es: fakeEs(),
    bus: fakeBus(),
    metrics: createWorkerMetrics(),
    config: { enabled: true, batchSize: 100, pollMs: 1_000, retryMaxMs: 60_000, profile: 'squash_only' },
    evidence: { pool, source, graphFor: () => graph },
    ...overrides,
  };
}

async function registerRepository(): Promise<void> {
  await repositoryRepo.upsertRepository(pool, {
    repository_id: REPOSITORY_ID,
    owner: OWNER,
    name: NAME,
    org_id: 1,
    visibility: 'internal',
    sequence_branches: [BRANCH],
    mirror_enabled: true,
    status: 'active',
  });
}

async function numbers(): Promise<(number | null)[]> {
  const result = await pool.query<{ merge_number: number | null }>(
    `SELECT merge_number FROM merge_sequence ms
      JOIN sequence_space s USING (repository_id, base_branch, seq_epoch)
     WHERE ms.repository_id = $1 AND ms.base_branch = $2 ORDER BY merge_seq`,
    [REPOSITORY_ID, BRANCH],
  );
  return result.rows.map((row) => row.merge_number);
}

async function blockedAt(): Promise<{ seq: number | null; reason: string | null }> {
  const row = await sequenceSpaceRepo.findSequenceSpace(pool, REPOSITORY_ID, BRANCH);
  return { seq: row!.mnumber_blocked_seq === null ? null : Number(row!.mnumber_blocked_seq), reason: row!.mnumber_blocked_reason };
}

/** 시험이 직접 주입하는 부재 증서 — 사내가 SQL로 손수 넣던 행과 같은 모양이다. */
async function seedDirect(seq: number, sha: string): Promise<void> {
  await mnumberEvidenceRepo.upsertEvidence(pool, {
    repositoryId: REPOSITORY_ID,
    baseBranch: BRANCH,
    seqEpoch: 1,
    mergeSeq: seq,
    commitSha: sha,
    state: 'direct_confirmed',
    prNumber: null,
    reason: null,
    sourceKind: 'authoritative_absence',
    sourcePrVersion: null,
    mergedAt: null,
    proof: { schema_version: 1, profile: 'squash_only', fixture_seeded: true },
  });
}

function knownPrs(only?: readonly number[]): Map<number, { sha: string; mergedAt: string }> {
  const out = new Map<number, { sha: string; mergedAt: string }>();
  for (const [pr, sha] of origin.squash) {
    if (only !== undefined && !only.includes(pr)) continue;
    out.set(pr, { sha, mergedAt: origin.mergedAt.get(pr) as string });
  }
  return out;
}

async function attestViaRepo(input: { graceSeconds: number; throughSeq?: number }): Promise<number> {
  const row = await mnumberAttestationRepo.createAttestation(pool, {
    repositoryId: REPOSITORY_ID,
    baseBranch: BRANCH,
    seqEpoch: 1,
    throughSeq: input.throughSeq ?? null,
    graceSeconds: input.graceSeconds,
    actor: 'prsctl:fixture',
    reason: '시험 확인서',
  });
  return row.attestation_id;
}

async function audits(): Promise<{ user_id: string; action: string; target: string | null; query: string | null; result_code: string }[]> {
  const result = await pool.query<{ user_id: string; action: string; target: string | null; query: string | null; result_code: string }>(
    `SELECT user_id, action, target, query, result_code FROM audit_record WHERE action LIKE 'mnumber_attestation.%' ORDER BY audit_id`,
  );
  return result.rows;
}

function commandDeps(now?: () => Date): { pool: Pool; out: string[]; err: string[]; deps: Parameters<typeof runMergeNumberAttestCommand>[1] } {
  const out: string[] = [];
  const err: string[] = [];
  return { pool, out, err, deps: { pool, out: (line) => out.push(line), err: (line) => err.push(line), ...(now === undefined ? {} : { now }) } };
}

beforeAll(async () => {
  pool = await migratedPool();
}, 120_000);

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await truncate(pool, 'audit_record', 'mnumber_attestation', 'sequence_latency_sample', 'sequence_work', 'mnumber_evidence', 'merge_sequence', 'sequence_space', 'pull_request_snapshot', 'repository');
  origin = await createSquashFixture();
  mirrorRoot = await makeTempDir('prs-mnumber-attest-mirror-');
  await new MirrorSync({ root: mirrorRoot, remoteUrl: () => origin.url }).sync({ owner: OWNER, repo: NAME }, REPOSITORY_ID);
  await registerRepository();
  const assigned = await prepareAndAssignSequence(sequenceDeps(), REPOSITORY_ID, BRANCH);
  expect(assigned.kind).toBe('done');
}, 60_000);

afterEach(async () => {
  await removeDir(origin.dir);
  await removeDir(mirrorRoot);
});

describe('운영자 확인서 (CR-100 / FR-SEQ-008 AC-15)', () => {
  it('**유예 0 확인서는 R·D를 번호 없이 지나 A=1, B=2를 준다**; GHE가 모르는 C도 지나 E=3이고, 늦게 알려진 C는 번호를 받지 않는다 (AC-3)', async () => {
    const id = await attestViaRepo({ graceSeconds: 0 });
    const known = knownPrs([21, 25, 29]);
    const source = evidenceSource(known);
    const deps = mnumberDeps(source);

    const first = await reconcileMergeNumbers(deps, REPOSITORY_ID, BRANCH);
    expect(first).toMatchObject({ kind: 'done', assigned: 3, attested: 3, blocked: null });
    expect(await numbers()).toEqual([null, 1, null, 2, null, 3]);
    expect(await blockedAt()).toEqual({ seq: null, reason: null });

    // 지나간 항목의 근거: 출처가 확인서이고 원 사유·확인서 ID가 proof에 남는다.
    for (const seq of [1, 3, 5]) {
      const evidence = await mnumberEvidenceRepo.findEvidence(pool, REPOSITORY_ID, BRANCH, 1, seq);
      expect(evidence, `seq ${String(seq)}`).toMatchObject({ state: 'direct_confirmed', source_kind: 'operator_attestation', pr_number: null, reason: null });
      expect(evidence?.proof).toMatchObject({ attestation_id: id, attested_reason: 'negative_evidence_unavailable', grace_seconds: 0 });
      expect(typeof evidence?.proof.committed_at).toBe('string');
    }
    expect(deps.metrics.render()).toMatch(/mnumber_attested_total\{[^}]*repository="7431"[^}]*\} 3/);

    // C(#27)가 뒤늦게 알려져도 확정된 근거는 다시 묻지 않는다 — 번호는 옮기지 않는다.
    known.set(27, { sha: origin.squash.get(27) as string, mergedAt: origin.mergedAt.get(27) as string });
    const second = await reconcileMergeNumbers(deps, REPOSITORY_ID, BRANCH, { force: true });
    expect(second).toMatchObject({ kind: 'done', assigned: 0, attested: 0, blocked: null });
    expect(await numbers()).toEqual([null, 1, null, 2, null, 3]);
    expect(source.calls.filter((call) => call.startsWith('detail:27'))).toEqual([]);
  });

  it('**유예가 지나지 않은 항목은 확인서가 있어도 미확정으로 남고 다시 볼 시각을 준다**; 유예가 지나면 지나간다', async () => {
    await attestViaRepo({ graceSeconds: 3_600 });
    const source = evidenceSource(knownPrs());

    // R은 00:00에 올랐다. 00:30에는 유예 1시간이 지나지 않았다.
    const early = await reconcileMergeNumbers(mnumberDeps(source, { now: () => new Date('2026-09-01T00:30:00Z') }), REPOSITORY_ID, BRANCH);
    expect(early).toMatchObject({ kind: 'done', assigned: 0, attested: 0, blocked: { seq: 1, reason: 'negative_evidence_unavailable', retryAt: new Date('2026-09-01T01:00:00Z') } });
    expect(await numbers()).toEqual([null, null, null, null, null, null]);
    expect(await mnumberEvidenceRepo.findEvidence(pool, REPOSITORY_ID, BRANCH, 1, 1)).toMatchObject({ state: 'unresolved', source_kind: 'unresolved_lookup' });

    // 01:00에는 R을 지나 A=1이고, D(02:00)는 다시 유예 대기다.
    const later = await reconcileMergeNumbers(mnumberDeps(source, { now: () => new Date('2026-09-01T01:00:00Z') }), REPOSITORY_ID, BRANCH);
    expect(later).toMatchObject({ kind: 'done', assigned: 1, attested: 1, blocked: { seq: 3, reason: 'negative_evidence_unavailable', retryAt: new Date('2026-09-01T03:00:00Z') } });
    expect(await numbers()).toEqual([null, 1, null, null, null, null]);
    expect(await mnumberEvidenceRepo.findEvidence(pool, REPOSITORY_ID, BRANCH, 1, 1)).toMatchObject({ state: 'direct_confirmed', source_kind: 'operator_attestation' });
  });

  it('**러너는 유예 대기를 유예가 끝나는 시각으로 미룬다** — done으로 닫지 않는다', async () => {
    await attestViaRepo({ graceSeconds: 3_600 });
    const now = (): Date => new Date('2026-09-01T00:30:00Z');
    const deps = mnumberDeps(evidenceSource(knownPrs()), { now });
    await sequenceWorkRepo.requestWork(pool, { kind: 'reconcile', repositoryId: REPOSITORY_ID, baseBranch: BRANCH, seqEpoch: 1, payload: { trigger_kind: 'attestation' } });

    const round = await runSequenceWorkOnce({ pool, sequence: sequenceDeps(), mnumber: deps, metrics: deps.metrics, now });
    expect(round.outcomes['reconcile:blocked:negative_evidence_unavailable']).toBe(1);
    const work = await sequenceWorkRepo.findWork(pool, sequenceWorkRepo.spaceWorkKey('reconcile', REPOSITORY_ID, BRANCH, 1));
    expect(work).toMatchObject({ state: 'retry', last_reason: 'attestation_grace_pending', attempt_count: 0 });
    expect(work?.available_at.toISOString()).toBe('2026-09-01T01:00:00.000Z');
  });

  it('`through_seq`까지만 덮는다 — 그 너머는 기존대로 멈춘다', async () => {
    await attestViaRepo({ graceSeconds: 0, throughSeq: 1 });
    const outcome = await reconcileMergeNumbers(mnumberDeps(evidenceSource(knownPrs())), REPOSITORY_ID, BRANCH);
    expect(outcome).toMatchObject({ kind: 'done', assigned: 1, attested: 1, blocked: { seq: 3, reason: 'negative_evidence_unavailable' } });
    expect(outcome.kind === 'done' && outcome.blocked?.retryAt).toBeUndefined();
    expect(await numbers()).toEqual([null, 1, null, null, null, null]);
  });

  it('**철회하면 다음 회차부터 적용하지 않고, 이미 지나간 근거와 번호는 그대로다**', async () => {
    const id = await attestViaRepo({ graceSeconds: 0, throughSeq: 1 });
    const source = evidenceSource(knownPrs());
    await reconcileMergeNumbers(mnumberDeps(source), REPOSITORY_ID, BRANCH);
    expect(await numbers()).toEqual([null, 1, null, null, null, null]);

    const revoked = await mnumberAttestationRepo.revokeAttestation(pool, id, { actor: 'prsctl:fixture', reason: '범위를 다시 정한다' });
    expect(revoked?.revoked_at).not.toBeNull();
    expect(await mnumberAttestationRepo.findActiveAttestation(pool, REPOSITORY_ID, BRANCH, 1)).toBeUndefined();

    const after = await reconcileMergeNumbers(mnumberDeps(source), REPOSITORY_ID, BRANCH, { force: true });
    expect(after).toMatchObject({ kind: 'done', assigned: 0, attested: 0, blocked: { seq: 3, reason: 'negative_evidence_unavailable' } });
    expect(await numbers()).toEqual([null, 1, null, null, null, null]);
    expect(await mnumberEvidenceRepo.findEvidence(pool, REPOSITORY_ID, BRANCH, 1, 1)).toMatchObject({ state: 'direct_confirmed', source_kind: 'operator_attestation' });

    // 철회 뒤에는 같은 공간에 새 확인서를 만들 수 있다 — 이력은 둘 다 남는다.
    await attestViaRepo({ graceSeconds: 0 });
    expect((await mnumberAttestationRepo.listAttestations(pool, { includeRevoked: true })).length).toBe(2);
    expect((await mnumberAttestationRepo.listAttestations(pool)).length).toBe(1);
  });

  it('확인서는 에폭에 묶인다 — 다른 에폭에서는 조회되지 않고 같은 에폭의 활성 확인서는 하나뿐이다', async () => {
    await attestViaRepo({ graceSeconds: 0 });
    expect(await mnumberAttestationRepo.findActiveAttestation(pool, REPOSITORY_ID, BRANCH, 2)).toBeUndefined();
    await expect(attestViaRepo({ graceSeconds: 0 })).rejects.toMatchObject({ code: '23505' });
  });
});

describe('확정 근거를 미확정으로 덮지 않는다 (DEV-715)', () => {
  it('**근거 조회 중에 들어온 direct_confirmed를 덮지 않는다** — 회차를 버리고 다음 회차가 새 근거로 판정한다', async () => {
    const source = evidenceSource(knownPrs());
    const racing: PullRequestEvidenceSource = {
      getPullRequestEvidence: (ref, number) => source.getPullRequestEvidence(ref, number),
      async listPullRequestsForCommitPage(ref, sha, page) {
        // 워커가 GHE를 묻는 사이에 운영자가 R의 근거를 손으로 넣는다 — 사내가 실제로 한 일이다.
        if (sha === origin.rootSha) await seedDirect(1, origin.rootSha);
        return source.listPullRequestsForCommitPage(ref, sha, page);
      },
    };
    const deps = mnumberDeps(racing);
    const first = await reconcileMergeNumbers(deps, REPOSITORY_ID, BRANCH);
    expect(first).toEqual({ kind: 'retry', reason: 'evidence_moved' });
    expect(await mnumberEvidenceRepo.findEvidence(pool, REPOSITORY_ID, BRANCH, 1, 1)).toMatchObject({ state: 'direct_confirmed', source_kind: 'authoritative_absence', evidence_version: 1 });
    expect(await numbers()).toEqual([null, null, null, null, null, null]);

    const second = await reconcileMergeNumbers(deps, REPOSITORY_ID, BRANCH);
    expect(second).toMatchObject({ kind: 'done', assigned: 1, blocked: { seq: 3, reason: 'negative_evidence_unavailable' } });
    expect(await numbers()).toEqual([null, 1, null, null, null, null]);
  });

  it('`upsertEvidence`는 확정 위에 unresolved를 거절한다 — SQL이 마지막 방어선이다', async () => {
    await seedDirect(1, origin.rootSha);
    const downgrade = mnumberEvidenceRepo.upsertEvidence(pool, {
      repositoryId: REPOSITORY_ID,
      baseBranch: BRANCH,
      seqEpoch: 1,
      mergeSeq: 1,
      commitSha: origin.rootSha,
      state: 'unresolved',
      prNumber: null,
      reason: 'negative_evidence_unavailable',
      sourceKind: 'unresolved_lookup',
      sourcePrVersion: null,
      mergedAt: null,
      proof: { schema_version: 1, profile: 'squash_only' },
    });
    await expect(downgrade).rejects.toBeInstanceOf(EvidenceDowngradeError);
    expect(await mnumberEvidenceRepo.findEvidence(pool, REPOSITORY_ID, BRANCH, 1, 1)).toMatchObject({ state: 'direct_confirmed', evidence_version: 1 });

    // 다른 커밋의 근거는 여전히 정본 손상으로 거절한다 — 기존 규칙이 바뀌지 않았다.
    await expect(
      mnumberEvidenceRepo.upsertEvidence(pool, {
        repositoryId: REPOSITORY_ID,
        baseBranch: BRANCH,
        seqEpoch: 1,
        mergeSeq: 1,
        commitSha: 'f'.repeat(40),
        state: 'unresolved',
        prNumber: null,
        reason: 'negative_evidence_unavailable',
        sourceKind: 'unresolved_lookup',
        sourcePrVersion: null,
        mergedAt: null,
        proof: { schema_version: 1, profile: 'squash_only' },
      }),
    ).rejects.toThrow(/다른 커밋이 이미 있다/);
  });
});

describe('prsctl mnumber 명령 (attest · revoke · list)', () => {
  const ATTEST = ['attest', '--repository-id', String(REPOSITORY_ID), '--base-branch', BRANCH, '--seq-epoch', '1', '--reason', '사내 squash-only 저장소의 직접 푸시 이력', '--grace-hours', '0', '--actor', 'alice'];

  it('**attest는 확인서·감사 기록·채번 회차 요청을 한 트랜잭션에 남긴다**; 러너가 그 요청을 집어 지나간다', async () => {
    const cmd = commandDeps();
    expect(await runMergeNumberAttestCommand(ATTEST, cmd.deps)).toBe(0);
    expect(cmd.err).toEqual([]);
    expect(cmd.out[0]).toMatch(/^확인서를 만들었다: #1 acme\/smp1900 main @1 · 범위 에폭 전체 · 유예 0시간 · 행위자 prsctl:alice$/);

    const active = await mnumberAttestationRepo.findActiveAttestation(pool, REPOSITORY_ID, BRANCH, 1);
    expect(active).toMatchObject({ attestation_id: 1, through_seq: null, grace_seconds: 0, actor: 'prsctl:alice', reason: '사내 squash-only 저장소의 직접 푸시 이력' });
    expect(await audits()).toEqual([
      { user_id: 'prsctl:alice', action: 'mnumber_attestation.create', target: 'acme/smp1900/main@1#1', query: '사내 squash-only 저장소의 직접 푸시 이력', result_code: 'created' },
    ]);
    const work = await sequenceWorkRepo.findWork(pool, sequenceWorkRepo.spaceWorkKey('reconcile', REPOSITORY_ID, BRANCH, 1));
    expect(work).toMatchObject({ state: 'ready', payload: { trigger_kind: 'attestation', attestation_id: 1 } });
    // 감사 기록의 상관 ID가 채번 회차 요청에 실린다 — 운영자 행위와 EVT-SEQ-004가 한 ID로 이어진다 (DEV-594).
    const audit = await pool.query<{ correlation_id: string }>(`SELECT correlation_id FROM audit_record WHERE action = 'mnumber_attestation.create'`);
    expect(work?.payload['correlation_id']).toBe(audit.rows[0]?.correlation_id);

    const deps = mnumberDeps(evidenceSource(knownPrs([21, 25, 29])));
    const round = await runSequenceWorkOnce({ pool, sequence: sequenceDeps(), mnumber: deps, metrics: deps.metrics });
    expect(round.outcomes['reconcile:done']).toBe(1);
    expect(await numbers()).toEqual([null, 1, null, 2, null, 3]);
  });

  it('같은 공간·에폭의 두 번째 확인서, 현재와 다른 에폭, 시퀀스 대상이 아닌 브랜치, 행위자 없음은 거절한다', async () => {
    const first = commandDeps();
    expect(await runMergeNumberAttestCommand(ATTEST, first.deps)).toBe(0);

    const duplicate = commandDeps();
    expect(await runMergeNumberAttestCommand(ATTEST, duplicate.deps)).toBe(2);
    expect(duplicate.err.join('\n')).toMatch(/이미 활성 확인서가 있다: #1 /);

    const wrongEpoch = commandDeps();
    expect(await runMergeNumberAttestCommand(ATTEST.map((arg, i) => (ATTEST[i - 1] === '--seq-epoch' ? '2' : arg)), wrongEpoch.deps)).toBe(2);
    expect(wrongEpoch.err.join('\n')).toMatch(/현재 에폭은 1이다/);

    const wrongBranch = commandDeps();
    expect(await runMergeNumberAttestCommand(ATTEST.map((arg, i) => (ATTEST[i - 1] === '--base-branch' ? 'develop' : arg)), wrongBranch.deps)).toBe(2);
    expect(wrongBranch.err.join('\n')).toMatch(/시퀀스 대상 브랜치는 \[main\]이다/);

    const noActor = commandDeps();
    expect(await runMergeNumberAttestCommand(ATTEST.slice(0, -2), noActor.deps)).toBe(2);
    expect(noActor.err.join('\n')).toMatch(/--actor/);

    // 거절은 아무것도 남기지 않는다 — 확인서 하나, 감사 기록 하나다.
    expect((await mnumberAttestationRepo.listAttestations(pool, { includeRevoked: true })).length).toBe(1);
    expect((await audits()).length).toBe(1);
  });

  it('**revoke는 철회와 감사 기록을 남기고, 두 번째 철회는 바뀐 것이 없어 거절하며 기록하지 않는다**; list가 이력을 보여 준다', async () => {
    expect(await runMergeNumberAttestCommand(ATTEST, commandDeps().deps)).toBe(0);

    const revoke = commandDeps();
    expect(await runMergeNumberAttestCommand(['revoke', '--id', '1', '--reason', '범위를 다시 정한다', '--actor', 'bob'], revoke.deps)).toBe(0);
    expect(revoke.out[0]).toMatch(/^확인서를 철회했다: #1 acme\/smp1900 main @1/);
    expect((await audits()).map((row) => [row.action, row.user_id, row.result_code])).toEqual([
      ['mnumber_attestation.create', 'prsctl:alice', 'created'],
      ['mnumber_attestation.revoke', 'prsctl:bob', 'revoked'],
    ]);

    const again = commandDeps();
    expect(await runMergeNumberAttestCommand(['revoke', '--id', '1', '--reason', '한 번 더', '--actor', 'bob'], again.deps)).toBe(2);
    expect(again.err.join('\n')).toMatch(/이미 .* 철회됐다/);
    expect((await audits()).length).toBe(2);

    const activeOnly = commandDeps();
    expect(await runMergeNumberAttestCommand(['list'], activeOnly.deps)).toBe(0);
    expect(activeOnly.out).toEqual(['활성 확인서가 없다. 철회된 것까지 보려면 --all.']);

    const all = commandDeps();
    expect(await runMergeNumberAttestCommand(['list', '--all', '--repository-id', String(REPOSITORY_ID)], all.deps)).toBe(0);
    expect(all.out[0]).toMatch(/^id\trepository_id\tbase_branch/);
    expect(all.out[1]).toMatch(/^1\t7431\tmain\t1\t-\t0\tprsctl:alice\t.+Z\t.+Z\t사내 squash-only 저장소의 직접 푸시 이력$/);
  });
});

describe('독립 검토 뒤 보강 (CR-100)', () => {
  it('**squash 프로파일 밖(2-parent 머지 커밋)도 확인서가 지나간다** — 사내 저장소 399의 seq=3 상황', async () => {
    // 원격에 진짜 머지 커밋을 더한 뒤 fetch → 채번 (mnumber.test.ts의 AC-9 픽스처와 같다).
    await run(origin.dir, ['checkout', '-q', '-b', 'fm']);
    await run(origin.dir, ['commit', '-q', '--allow-empty', '-m', 'fm 1']);
    await run(origin.dir, ['checkout', '-q', BRANCH]);
    await run(origin.dir, ['merge', '-q', '--no-ff', '-m', 'M merge (#31)', 'fm']);
    await prepareAndAssignSequence(sequenceDeps(), REPOSITORY_ID, BRANCH);
    await attestViaRepo({ graceSeconds: 0 });

    const outcome = await reconcileMergeNumbers(mnumberDeps(evidenceSource(knownPrs())), REPOSITORY_ID, BRANCH);
    expect(outcome).toMatchObject({ kind: 'done', assigned: 4, attested: 3, blocked: null });
    expect(await numbers()).toEqual([null, 1, null, 2, 3, 4, null]);
    const merge = await mnumberEvidenceRepo.findEvidence(pool, REPOSITORY_ID, BRANCH, 1, 7);
    expect(merge).toMatchObject({ state: 'direct_confirmed', source_kind: 'operator_attestation' });
    expect(merge?.proof.attested_reason).toBe('unsupported_merge_profile');
  });

  it('`--through-seq`가 지금 멈춘 서수보다 작으면 만들되 경고한다', async () => {
    await seedDirect(1, origin.rootSha);
    const first = await reconcileMergeNumbers(mnumberDeps(evidenceSource(knownPrs())), REPOSITORY_ID, BRANCH);
    expect(first).toMatchObject({ kind: 'done', assigned: 1, blocked: { seq: 3, reason: 'negative_evidence_unavailable' } });

    const cmd = commandDeps();
    const argv = ['attest', '--repository-id', String(REPOSITORY_ID), '--base-branch', BRANCH, '--seq-epoch', '1', '--reason', '범위 시험', '--grace-hours', '0', '--through-seq', '2', '--actor', 'alice'];
    expect(await runMergeNumberAttestCommand(argv, cmd.deps)).toBe(0);
    expect(cmd.err.join('\n')).toMatch(/^경고: 지금 멈춘 서수는 3인데 --through-seq 2는 그 앞까지만 덮는다/m);
    expect(await mnumberAttestationRepo.findActiveAttestation(pool, REPOSITORY_ID, BRANCH, 1)).toMatchObject({ through_seq: 2 });
  });
});
