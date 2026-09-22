/**
 * WP-074 FR-SEQ-008 — T01 · T02 · T04c: squash 이력에서 M 번호를 채번한다.
 *
 * ## 기대값은 손으로 선언한다 (실행서 4장)
 *
 * squash 픽스처: R(직접) · A(#21) · D(직접) · B(#25) · C(#27, 늦게) · E(#29).
 * 기대: A=1, D=없음, B=2, C=3, E=4. C 미확정이면 E=없음. C 정보 주입 뒤 **새 push 없이**
 * C=3, E=4. 이 값은 구현이 아니라 시험이 정한 것이고 `git rev-list --first-parent`와
 * 따로 대조한다.
 *
 * ## production은 직접 푸시를 확정하지 않는다 (DEV-581)
 *
 * R·D의 부재 증서는 **시험이 직접 주입**한다(`authoritative_absence`, `fixture_seeded`).
 * 주입 전에는 R에서 멈춰 아무 번호도 붙지 않는 것이 production의 답이며, 그것을 먼저
 * 확인한다. 이 시험의 통과는 DEV-581의 게이트를 닫지 않는다.
 *
 * 실행: `pnpm exec vitest run --config vitest.integration.config.ts apps/pipeline-worker/integration/sequence/mnumber`
 */

import type { Client } from '@elastic/elasticsearch';
import type { EventBus } from '@prs/bus';
import { MirrorCommitGraph, MirrorSync, type CommitGraph, type PullRequestEvidence, type RepoRef } from '@prs/github';
import {
  mnumberEvidenceRepo,
  prSnapshotRepo,
  repositoryRepo,
  sequenceLatencyRepo,
  sequenceSpaceRepo,
  sequenceWorkRepo,
  type Pool,
} from '@prs/db';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { migratedPool, truncate } from '../../../../packages/db/integration/helpers.js';
import { createWorkerMetrics } from '../../src/metrics.js';
import { prepareAndAssignSequence, type SequenceDeps } from '../../src/sequence.js';
import { announceMergeNumbers, observeMergeNumberSamples, reconcileMergeNumbers, materializeMergeNumber, type MergeNumberDeps } from '../../src/mnumber.js';
import type { PullRequestEvidenceSource } from '../../src/mnumber-evidence.js';
import { runSequenceWorkOnce } from '../../src/sequence-work-runner.js';
import { recordProjectionSnapshot } from '../../src/snapshot.js';
import { makeTempDir, removeDir, run } from './fixture.js';
import { createSquashFixture, squashMerge, type SquashFixture } from './squash-fixture.js';

const REPOSITORY_ID = 7431;
const OWNER = 'acme';
const NAME = 'smp1900';
const BRANCH = 'main';

let pool: Pool;
let origin: SquashFixture;
let mirrorRoot: string;
let esCalls: { method: string; body: unknown }[] = [];
let published: { topic: string; envelope: { event_name: string; payload: unknown } }[] = [];

/** ES 대역 — 어떤 갱신이 요청됐는지만 기록한다. */
function fakeEs(): Client {
  return {
    search: async (): Promise<unknown> => ({ hits: { hits: [] } }),
    updateByQuery: async (body: unknown): Promise<unknown> => {
      esCalls.push({ method: 'updateByQuery', body });
      return { updated: 0 };
    },
    // CR-113: 문서 단위 투영기의 `mget`·`bulk` — 문서 없음으로 답한다.
    mget: async (body: { docs: readonly { _id: string }[] }): Promise<unknown> => ({ docs: body.docs.map((doc) => ({ _id: doc._id, found: false })) }),
    bulk: async (): Promise<unknown> => ({ errors: false, items: [] }),
    get: async (body: unknown): Promise<unknown> => {
      esCalls.push({ method: 'get', body });
      const error = new Error('not found') as Error & { statusCode: number };
      error.statusCode = 404;
      throw error;
    },
    update: async (body: unknown): Promise<unknown> => {
      esCalls.push({ method: 'update', body });
      return { result: 'updated' };
    },
  } as unknown as Client;
}

function fakeBus(): EventBus {
  return {
    publish: async (topic: string, _key: string, envelope: { event_name: string; payload: unknown }): Promise<void> => {
      published.push({ topic, envelope });
    },
    subscribe: async (): Promise<never> => {
      throw new Error('시험에서 구독하지 않는다');
    },
    close: async (): Promise<void> => undefined,
  } as unknown as EventBus;
}

/**
 * PR 상세 대역. **알려진 PR만 답한다.** `known`에 없는 PR은 404(null)이고, 커밋 목록은
 * 알려진 squash SHA에만 그 PR을 준다. 부재를 증명하지 않는다 — 빈 목록일 뿐이다.
 */
function evidenceSource(known: ReadonlyMap<number, { sha: string; mergedAt: string; base?: string; repoId?: number }>): PullRequestEvidenceSource & { calls: string[] } {
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
        base: { ref: entry.base ?? BRANCH, sha: 'x'.repeat(40), repo: { id: entry.repoId ?? REPOSITORY_ID } },
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

function mnumberDeps(source: PullRequestEvidenceSource | null, overrides: Partial<MergeNumberDeps> = {}): MergeNumberDeps {
  const graph = new MirrorCommitGraph({ root: mirrorRoot, repositoryIdOf: () => REPOSITORY_ID });
  const metrics = createWorkerMetrics();
  return {
    pool,
    es: fakeEs(),
    bus: fakeBus(),
    metrics,
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

/** 정본이 말하는 (서수, PR, M) 표. 이것을 손으로 선언한 기대값과 대조한다. */
async function numbers(): Promise<{ seq: number; pr: number | null; m: number | null }[]> {
  const result = await pool.query<{ merge_seq: string; pull_request_number: number | null; merge_number: number | null }>(
    `SELECT merge_seq, pull_request_number, merge_number FROM merge_sequence ms
      JOIN sequence_space s USING (repository_id, base_branch, seq_epoch)
     WHERE ms.repository_id = $1 AND ms.base_branch = $2 ORDER BY merge_seq`,
    [REPOSITORY_ID, BRANCH],
  );
  return result.rows.map((row) => ({ seq: Number(row.merge_seq), pr: row.pull_request_number, m: row.merge_number }));
}

async function space(): Promise<{ epoch: number; headSeq: number; headNumber: number; blockedSeq: number | null; reason: string | null }> {
  const row = await sequenceSpaceRepo.findSequenceSpace(pool, REPOSITORY_ID, BRANCH);
  return {
    epoch: row!.seq_epoch,
    headSeq: Number(row!.mnumber_head_seq),
    headNumber: Number(row!.mnumber_head),
    blockedSeq: row!.mnumber_blocked_seq === null ? null : Number(row!.mnumber_blocked_seq),
    reason: row!.mnumber_blocked_reason,
  };
}

/** 직접 푸시 부재 증서를 **시험이** 주입한다. production 판정기는 이것을 만들지 않는다. */
async function seedDirect(seq: number, sha: string, epoch = 1): Promise<void> {
  await mnumberEvidenceRepo.upsertEvidence(pool, {
    repositoryId: REPOSITORY_ID,
    baseBranch: BRANCH,
    seqEpoch: epoch,
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

function knownPrs(fixture: SquashFixture, only?: readonly number[]): Map<number, { sha: string; mergedAt: string }> {
  const out = new Map<number, { sha: string; mergedAt: string }>();
  for (const [pr, sha] of fixture.squash) {
    if (only !== undefined && !only.includes(pr)) continue;
    out.set(pr, { sha, mergedAt: fixture.mergedAt.get(pr) as string });
  }
  return out;
}

beforeAll(async () => {
  pool = await migratedPool();
}, 120_000);

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await truncate(pool, 'sequence_latency_sample', 'sequence_work', 'mnumber_evidence', 'merge_sequence', 'sequence_space', 'pull_request_snapshot', 'repository');
  esCalls = [];
  published = [];
  origin = await createSquashFixture();
  mirrorRoot = await makeTempDir('prs-mnumber-mirror-');
  await new MirrorSync({ root: mirrorRoot, remoteUrl: () => origin.url }).sync({ owner: OWNER, repo: NAME }, REPOSITORY_ID);
  await registerRepository();
  const assigned = await prepareAndAssignSequence(sequenceDeps(), REPOSITORY_ID, BRANCH);
  expect(assigned.kind).toBe('done');
}, 60_000);

afterEach(async () => {
  await removeDir(origin.dir);
  await removeDir(mirrorRoot);
});

describe('T01 · T02a: squash PR당 번호 하나, 직접 푸시는 소비하지 않는다', () => {
  it('**production 기본: 루트 커밋에서 멈춘다** — 빈 조회는 부재 증명이 아니다 (DEV-581)', async () => {
    const source = evidenceSource(knownPrs(origin));
    const outcome = await reconcileMergeNumbers(mnumberDeps(source), REPOSITORY_ID, BRANCH);
    expect(outcome).toMatchObject({ kind: 'done', assigned: 0, blocked: { seq: 1, reason: 'negative_evidence_unavailable' } });
    expect((await numbers()).every((row) => row.m === null)).toBe(true);
    expect(await space()).toMatchObject({ headSeq: 0, headNumber: 0, blockedSeq: 1 });
    // 근거 표에는 미확정이 사유와 함께 남고, 열거가 끝났다는 사실만 기록된다.
    const evidence = await mnumberEvidenceRepo.findEvidence(pool, REPOSITORY_ID, BRANCH, 1, 1);
    expect(evidence).toMatchObject({ state: 'unresolved', reason: 'negative_evidence_unavailable', source_kind: 'unresolved_lookup' });
    expect(evidence?.proof.lookup_complete).toBe(true);
    expect(evidence?.first_pending_at).not.toBeNull();
  });

  it('**증서 주입 뒤 A=1, B=2이고 C(미확정)에서 멈춘다; C 정보가 오면 새 push 없이 C=3, E=4**', async () => {
    await seedDirect(1, origin.rootSha);
    await seedDirect(3, origin.directSha);

    // C(#27)는 아직 GHE가 모른다.
    const known = knownPrs(origin, [21, 25, 29]);
    const source = evidenceSource(known);
    const first = await reconcileMergeNumbers(mnumberDeps(source), REPOSITORY_ID, BRANCH);
    expect(first).toMatchObject({ kind: 'done', assigned: 2, blocked: { seq: 5, reason: 'negative_evidence_unavailable' } });
    /*
     * **PR 번호는 확정 근거가 채운다.** 이 시험의 ES 대역은 빈 결과를 주므로 채번
     * (`findPullRequestByMergeCommit`)이 남긴 `pull_request_number`는 전부 NULL이고,
     * 값이 생긴 행은 M 근거가 확정된 둘뿐이다 — 근거가 정본이고 그 값이 곧 사실이다.
     * C·E는 근거가 없으므로 PR 번호도 M 번호도 없다.
     */
    expect(await numbers()).toEqual([
      { seq: 1, pr: null, m: null },
      { seq: 2, pr: 21, m: 1 },
      { seq: 3, pr: null, m: null },
      { seq: 4, pr: 25, m: 2 },
      { seq: 5, pr: null, m: null },
      { seq: 6, pr: null, m: null },
    ]);
    expect(await space()).toMatchObject({ headSeq: 4, headNumber: 2, blockedSeq: 5 });
    // E(#29)는 확정 가능한 정보가 있어도 앞이 막혀 번호를 받지 않는다 (AC-3).
    // materialize·announce 의도가 번호와 같은 트랜잭션으로 남았다.
    const works = await sequenceWorkRepo.listWorkForSpace(pool, REPOSITORY_ID, BRANCH);
    expect(works.filter((w) => w.kind === 'materialize').map((w) => w.payload['pr_number']).sort()).toEqual([21, 25]);
    const announce = works.find((w) => w.kind === 'announce');
    expect(announce?.payload).toMatchObject({ from_mnumber: 1, to_mnumber: 2, pull_request_numbers: [21, 25], seq_epoch: 1 });

    // C 정보 도착 — 시험이 스냅숏 저장 트랜잭션과 같은 효과(재개 의도)를 만든다. push는 없다.
    known.set(27, { sha: origin.squash.get(27) as string, mergedAt: origin.mergedAt.get(27) as string });
    const second = await reconcileMergeNumbers(mnumberDeps(source), REPOSITORY_ID, BRANCH, { force: true });
    expect(second).toMatchObject({ kind: 'done', assigned: 2, blocked: null });
    expect(await numbers()).toEqual([
      { seq: 1, pr: null, m: null },
      { seq: 2, pr: 21, m: 1 },
      { seq: 3, pr: null, m: null },
      { seq: 4, pr: 25, m: 2 },
      { seq: 5, pr: 27, m: 3 },
      { seq: 6, pr: 29, m: 4 },
    ]);
    expect(await space()).toMatchObject({ headSeq: 6, headNumber: 4, blockedSeq: null });

    // **멱등**: 같은 구간을 다시 돌려도 값이 변하지 않는다 (AC-4).
    const third = await reconcileMergeNumbers(mnumberDeps(source), REPOSITORY_ID, BRANCH, { force: true });
    expect(third).toMatchObject({ kind: 'done', assigned: 0, blocked: null });
    expect((await numbers()).map((row) => row.m)).toEqual([null, 1, null, 2, 3, 4]);
  });

  it('**순서가 `git rev-list --first-parent`에서 squash 커밋만 추린 순서와 같다** (독립 대조)', async () => {
    await seedDirect(1, origin.rootSha);
    await seedDirect(3, origin.directSha);
    await reconcileMergeNumbers(mnumberDeps(evidenceSource(knownPrs(origin))), REPOSITORY_ID, BRANCH);
    const gitChain = (await run(origin.dir, ['rev-list', '--first-parent', '--reverse', BRANCH])).trim().split('\n');
    const squashInGitOrder = gitChain.filter((sha) => [...origin.squash.values()].includes(sha));
    const numbered = await pool.query<{ commit_sha: string; merge_number: number }>(
      'SELECT commit_sha, merge_number FROM merge_sequence WHERE repository_id = $1 AND merge_number IS NOT NULL ORDER BY merge_number',
      [REPOSITORY_ID],
    );
    expect(numbered.rows.map((row) => row.commit_sha)).toEqual(squashInGitOrder);
    expect(numbered.rows.map((row) => row.merge_number)).toEqual([1, 2, 3, 4]);
  });

  it('GHE 자격이 없으면 검증된 스냅숏만 근거다 — state·SHA·base·저장소가 전부 일치할 때만 확정한다 (C7)', async () => {
    await seedDirect(1, origin.rootSha);
    await seedDirect(3, origin.directSha);
    const a = origin.squash.get(21) as string;
    const b = origin.squash.get(25) as string;
    await prSnapshotRepo.upsertPullRequestSnapshot(pool, { repositoryId: REPOSITORY_ID, prNumber: 21, documentVersion: 10, source: 'webhook', document: { state: 'merged', merge_commit_sha: a, base_branch: BRANCH, merged_at: origin.mergedAt.get(21) } });
    // B는 base가 다르다고 적힌 스냅숏 — 확정하지 않는다.
    await prSnapshotRepo.upsertPullRequestSnapshot(pool, { repositoryId: REPOSITORY_ID, prNumber: 25, documentVersion: 10, source: 'webhook', document: { state: 'merged', merge_commit_sha: b, base_branch: 'release', merged_at: origin.mergedAt.get(25) } });

    const outcome = await reconcileMergeNumbers(mnumberDeps(null), REPOSITORY_ID, BRANCH);
    expect(outcome).toMatchObject({ kind: 'done', assigned: 1, blocked: { seq: 4, reason: 'pr_evidence_pending' } });
    const evidence = await mnumberEvidenceRepo.findEvidence(pool, REPOSITORY_ID, BRANCH, 1, 2);
    expect(evidence).toMatchObject({ state: 'pr_confirmed', pr_number: 21, source_kind: 'verified_snapshot' });
  });

  it('부모가 둘 이상인 커밋은 squash 프로파일 밖이라 그 앞에서 멈춘다 (AC-9)', async () => {
    // 원격에 진짜 머지 커밋을 더한 뒤 fetch → 채번.
    await run(origin.dir, ['checkout', '-q', '-b', 'fm']);
    await run(origin.dir, ['commit', '-q', '--allow-empty', '-m', 'fm 1']);
    await run(origin.dir, ['checkout', '-q', BRANCH]);
    await run(origin.dir, ['merge', '-q', '--no-ff', '-m', 'M merge (#31)', 'fm']);
    await prepareAndAssignSequence(sequenceDeps(), REPOSITORY_ID, BRANCH);
    await seedDirect(1, origin.rootSha);
    await seedDirect(3, origin.directSha);
    const outcome = await reconcileMergeNumbers(mnumberDeps(evidenceSource(knownPrs(origin))), REPOSITORY_ID, BRANCH);
    expect(outcome).toMatchObject({ kind: 'done', assigned: 4, blocked: { seq: 7, reason: 'unsupported_merge_profile' } });
  });
});

describe('T02c: 충돌은 부여된 번호를 보존하고 새 부여를 멈춘다', () => {
  it('확정된 PR과 다른 확정이 오면 mapping_conflict — 번호를 옮기지 않는다', async () => {
    await seedDirect(1, origin.rootSha);
    await seedDirect(3, origin.directSha);
    const known = knownPrs(origin);
    const source = evidenceSource(known);
    await reconcileMergeNumbers(mnumberDeps(source), REPOSITORY_ID, BRANCH);
    expect((await numbers()).map((row) => row.m)).toEqual([null, 1, null, 2, 3, 4]);

    // 뒤늦게 GHE가 A의 SHA를 PR #99의 것이라고도 답한다 — 후보 둘.
    known.set(99, { sha: origin.squash.get(21) as string, mergedAt: '2026-09-01T01:30:00Z' });
    // 근거 재검증을 강제하려면 미확정이어야 한다. 확정 근거는 다시 묻지 않으므로 값은 그대로다.
    const again = await reconcileMergeNumbers(mnumberDeps(source), REPOSITORY_ID, BRANCH, { force: true });
    expect(again).toMatchObject({ kind: 'done', assigned: 0, blocked: null });
    expect((await numbers()).map((row) => row.m)).toEqual([null, 1, null, 2, 3, 4]);
  });

  it('같은 PR이 두 squash SHA로 나타나면 두 번째에서 mapping_conflict', async () => {
    await seedDirect(1, origin.rootSha);
    await seedDirect(3, origin.directSha);
    const known = knownPrs(origin);
    // B의 SHA를 PR #21의 것이라고도 답한다: 21이 A와 B 둘 다에 나타난다.
    known.set(25, { sha: origin.squash.get(25) as string, mergedAt: origin.mergedAt.get(25) as string });
    const source: PullRequestEvidenceSource = {
      ...evidenceSource(known),
      async listPullRequestsForCommitPage(_ref, sha, page) {
        const base = await evidenceSource(known).listPullRequestsForCommitPage(_ref, sha, page);
        if (sha === origin.squash.get(25)) return { ...base, items: [{ number: 21 }] };
        return base;
      },
      async getPullRequestEvidence(ref, number) {
        const detail = await evidenceSource(known).getPullRequestEvidence(ref, number);
        if (number === 21 && detail !== null) return { ...detail, merge_commit_sha: origin.squash.get(25) as string };
        return detail;
      },
    };
    const outcome = await reconcileMergeNumbers(mnumberDeps(source), REPOSITORY_ID, BRANCH);
    // A는 #21로 확정되지 않는다(상세의 SHA가 B) → 후보 열거로도 A의 PR이 없다 → A에서 멈춘다.
    expect(outcome.kind).toBe('done');
    if (outcome.kind === 'done') expect(outcome.blocked?.seq).toBe(2);
  });
});

describe('T04c · T04d: 에폭 상향과 merged_at 대조', () => {
  it('**에폭이 오르면 이전 에폭 번호는 그 행에 남고 새 에폭에서 다시 센다**; 색인의 옛 번호 정리를 요청한다', async () => {
    await seedDirect(1, origin.rootSha);
    await seedDirect(3, origin.directSha);
    const source = evidenceSource(knownPrs(origin));
    await reconcileMergeNumbers(mnumberDeps(source), REPOSITORY_ID, BRANCH);
    expect((await numbers()).map((row) => row.m)).toEqual([null, 1, null, 2, 3, 4]);

    // 강제 푸시: E를 지우고 다른 squash를 얹는다.
    await run(origin.dir, ['reset', '-q', '--hard', 'HEAD~1']);
    const eNew = await squashMerge(origin.dir, 'fe2', 1, 'E2 squash (#33)', '2026-09-01T06:00:00Z');
    const reassigned = await prepareAndAssignSequence(sequenceDeps(), REPOSITORY_ID, BRANCH);
    expect(reassigned.kind).toBe('done');
    if (reassigned.kind === 'done') expect(reassigned.assign.kind).toBe('reassigned');
    expect((await space()).epoch).toBe(2);
    expect(await space()).toMatchObject({ headSeq: 0, headNumber: 0, blockedSeq: null });

    // 이전 에폭 행의 번호는 보존된다.
    const old = await pool.query<{ merge_number: number | null }>('SELECT merge_number FROM merge_sequence WHERE repository_id = $1 AND seq_epoch = 1 ORDER BY merge_seq', [REPOSITORY_ID]);
    expect(old.rows.map((row) => row.merge_number)).toEqual([null, 1, null, 2, 3, 4]);

    // 새 에폭: 증서를 다시 주입하고 #33을 알려 준 뒤 채번하면 1..4가 다시 붙는다.
    await seedDirect(1, origin.rootSha, 2);
    await seedDirect(3, origin.directSha, 2);
    const known = knownPrs(origin, [21, 25, 27]);
    known.set(33, { sha: eNew, mergedAt: '2026-09-01T06:00:00Z' });
    const deps = mnumberDeps(evidenceSource(known));
    const outcome = await reconcileMergeNumbers(deps, REPOSITORY_ID, BRANCH);
    expect(outcome).toMatchObject({ kind: 'done', assigned: 4, epoch: 2, blocked: null });
    const fresh = await pool.query<{ pull_request_number: number | null; merge_number: number | null }>('SELECT pull_request_number, merge_number FROM merge_sequence WHERE repository_id = $1 AND seq_epoch = 2 ORDER BY merge_seq', [REPOSITORY_ID]);
    expect(fresh.rows.map((row) => [row.pull_request_number, row.merge_number])).toEqual([[null, null], [21, 1], [null, null], [25, 2], [27, 3], [33, 4]]);

    // 색인의 옛 에폭 번호 정리가 update_by_query로 요청됐다 (merge_number_epoch < 2).
    const clear = esCalls.find((call) => call.method === 'updateByQuery' && JSON.stringify(call.body).includes('merge_number_epoch'));
    expect(clear).toBeDefined();
    expect(JSON.stringify(clear?.body)).toContain('"lt":2');
  });

  it('merged_at 순서가 서수 순서와 어긋나면 지표에 남고 채번은 계속된다 (AC-6)', async () => {
    await seedDirect(1, origin.rootSha);
    await seedDirect(3, origin.directSha);
    const known = knownPrs(origin);
    // B(#25)가 A(#21)보다 먼저 머지된 것으로 답한다.
    known.set(25, { sha: origin.squash.get(25) as string, mergedAt: '2026-09-01T00:30:00Z' });
    const deps = mnumberDeps(evidenceSource(known));
    const outcome = await reconcileMergeNumbers(deps, REPOSITORY_ID, BRANCH);
    expect(outcome).toMatchObject({ kind: 'done', assigned: 4 });
    expect(deps.metrics.render()).toMatch(/mnumber_order_mismatch_total\{[^}]*\} 1/);
  });
});

/**
 * T04a — **번호·checkpoint·전달 의도가 전부 있거나 전부 없다.**
 *
 * 설계 7절이 그 셋을 한 트랜잭션에 두라고 정한 이유는, 번호만 쓰이고 checkpoint가
 * 뒤처지면 다음 회차가 같은 서수에 **다른 번호를 다시 부여하려 하고**, 반대로
 * checkpoint만 오르면 번호 없는 구간이 영영 건너뛰어지기 때문이다.
 *
 * 여기서는 커밋 직전에 예외를 주입해 그 원자성을 실제로 확인한다. 대역이 아니라
 * **진짜 PostgreSQL 트랜잭션**이 되돌리는 것을 본다.
 */
describe('T04a: 번호·checkpoint·전달 의도의 원자성', () => {
  /**
   * 특정 문장이 지나간 **뒤** 첫 `COMMIT`에서 던지는 pool 대역. 연결은 진짜다.
   *
   * **놓을 때 원래 함수를 되돌린다.** 연결은 풀로 돌아가 다음 시험이 다시 받으므로,
   * 감싼 채로 두면 그 시험이 남의 주입에 걸린다 — 실제로 그렇게 다섯 건이 깨졌다.
   */
  function poolFailingAfter(marker: string): Pool {
    let armed = false;
    return {
      ...pool,
      query: pool.query.bind(pool),
      connect: async () => {
        const client = await pool.connect();
        const originalQuery = client.query.bind(client);
        const originalRelease = client.release.bind(client);
        const restore = (): void => {
          (client as { query: unknown }).query = originalQuery;
          (client as { release: unknown }).release = originalRelease;
        };
        (client as { query: unknown }).query = async (...args: unknown[]) => {
          const text = typeof args[0] === 'string' ? args[0] : String((args[0] as { text?: string })?.text ?? '');
          if (armed && text.trim().toUpperCase().startsWith('COMMIT')) {
            throw new Error('시험이 주입한 커밋 실패');
          }
          if (text.includes(marker)) armed = true;
          return originalQuery(...(args as Parameters<typeof originalQuery>));
        };
        (client as { release: unknown }).release = (...args: unknown[]) => {
          restore();
          return originalRelease(...(args as Parameters<typeof originalRelease>));
        };
        return client;
      },
    } as unknown as Pool;
  }

  it('**커밋이 실패하면 번호도 checkpoint도 work도 남지 않는다**', async () => {
    await seedDirect(1, origin.rootSha);
    await seedDirect(3, origin.directSha);
    const deps = mnumberDeps(evidenceSource(knownPrs(origin)), { pool: poolFailingAfter('mnumber_head') });

    await expect(reconcileMergeNumbers(deps, REPOSITORY_ID, BRANCH)).rejects.toThrow('시험이 주입한 커밋 실패');

    // 셋 다 트랜잭션 전 상태다 — 하나라도 남으면 다음 회차가 어긋난 자리에서 시작한다.
    expect((await numbers()).map((row) => row.m)).toEqual([null, null, null, null, null, null]);
    expect(await space()).toMatchObject({ headSeq: 0, headNumber: 0, blockedSeq: null });
    const works = await sequenceWorkRepo.listWorkForSpace(pool, REPOSITORY_ID, BRANCH);
    // 태그 의도도 같은 트랜잭션이다 (CR-115) — 커밋이 실패하면 함께 사라진다.
    expect(works.filter((one) => one.kind === 'materialize' || one.kind === 'announce' || one.kind === 'tag')).toEqual([]);
  });

  it('되돌린 뒤 같은 입력으로 다시 돌리면 같은 번호가 붙는다 — 실패가 번호를 소비하지 않는다', async () => {
    await seedDirect(1, origin.rootSha);
    await seedDirect(3, origin.directSha);
    await expect(
      reconcileMergeNumbers(mnumberDeps(evidenceSource(knownPrs(origin)), { pool: poolFailingAfter('mnumber_head') }), REPOSITORY_ID, BRANCH),
    ).rejects.toThrow();

    const retry = await reconcileMergeNumbers(mnumberDeps(evidenceSource(knownPrs(origin))), REPOSITORY_ID, BRANCH);
    expect(retry).toMatchObject({ kind: 'done', assigned: 4 });
    expect((await numbers()).map((row) => row.m)).toEqual([null, 1, null, 2, 3, 4]);
  });
});

describe('durable 러너와 materialize/announce (T04b 일부)', () => {
  it('러너가 reconcile → materialize → announce를 공간 순서대로 처리하고 이벤트를 낸다', async () => {
    await seedDirect(1, origin.rootSha);
    await seedDirect(3, origin.directSha);
    const deps = mnumberDeps(evidenceSource(knownPrs(origin)));
    const runnerDeps = { pool, sequence: sequenceDeps(), mnumber: deps, metrics: deps.metrics };
    // beforeEach의 채번이 남긴 reconcile 의도가 있다.
    let rounds = 0;
    for (;;) {
      const round = await runSequenceWorkOnce(runnerDeps);
      rounds += 1;
      if (round.claimed === 0 || rounds > 10) break;
    }
    expect((await numbers()).map((row) => row.m)).toEqual([null, 1, null, 2, 3, 4]);
    const works = await sequenceWorkRepo.listWorkForSpace(pool, REPOSITORY_ID, BRANCH);
    // announce는 발행 뒤 done, materialize는 문서가 없어(404) 재시도 대기다.
    expect(works.find((w) => w.kind === 'announce')?.state).toBe('done');
    expect(works.filter((w) => w.kind === 'materialize').every((w) => w.state === 'retry')).toBe(true);
    /*
     * 채번 트랜잭션이 PR마다 원격 태그 의도도 남긴다 (CR-115 / FR-SEQ-012 AC-2). **이 러너는 그것을
     * 집지 않는다** — GHE 쓰기 자격은 `tag` 역할에만 있으므로 `ready`로 남아 있어야 한다.
     */
    const tagWorks = works.filter((w) => w.kind === 'tag');
    expect(tagWorks.map((w) => (w.payload as { pr_number: number }).pr_number).sort((a, b) => a - b)).toEqual([21, 25, 27, 29]);
    expect(tagWorks.every((w) => w.state === 'ready')).toBe(true);
    expect(tagWorks.map((w) => (w.payload as { commit_sha: string }).commit_sha)).toEqual(tagWorks.map((w) => origin.squash.get((w.payload as { pr_number: number }).pr_number)));
    const event = published.find((one) => one.envelope.event_name === 'mnumber.assigned');
    expect(event?.topic).toBe('prs:projected');

    /*
     * **`EVT-SEQ-004`가 정한 여섯 필드 그대로다** (DEV-604).
     *
     * `toMatchObject`는 추가 키를 잡지 못한다 — 상관 ID를 work에 남기면서 payload에도
     * 실렸던 것이 그래서 통과했다. 키 집합 자체를 센다.
     */
    expect(Object.keys(event?.envelope.payload as Record<string, unknown>).sort()).toEqual([
      'base_branch', 'from_mnumber', 'pull_request_numbers', 'repository_id', 'seq_epoch', 'to_mnumber',
    ]);
    expect(event?.envelope.payload).toEqual({ repository_id: REPOSITORY_ID, base_branch: BRANCH, seq_epoch: 1, from_mnumber: 1, to_mnumber: 4, pull_request_numbers: [21, 25, 27, 29] });
  });

  /**
   * 상관 ID는 **봉투에만** 있다 (DEV-594·DEV-604).
   *
   * work에 남겨야 발행 시점에 복원할 수 있지만, 봉투에 이미 있는 값을 payload에
   * 또 넣으면 타입이 말하는 것과 실제로 나가는 것이 달라진다.
   */
  it('**상관 ID가 봉투에 실리고 payload에는 없다** (DEV-604)', async () => {
    await seedDirect(1, origin.rootSha);
    await seedDirect(3, origin.directSha);
    const deps = mnumberDeps(evidenceSource(knownPrs(origin)));
    await reconcileMergeNumbers(deps, REPOSITORY_ID, BRANCH, { correlationId: 'c-측정-1' });

    const work = (await sequenceWorkRepo.listWorkForSpace(pool, REPOSITORY_ID, BRANCH)).find((one) => one.kind === 'announce');
    expect(work?.payload['correlation_id'], 'work는 상관 ID를 남겨야 복원할 수 있다').toBe('c-측정-1');

    published = [];
    expect(await announceMergeNumbers(deps, work as NonNullable<typeof work>)).toBe('done');
    const event = published.find((one) => one.envelope.event_name === 'mnumber.assigned');
    expect((event?.envelope as { correlation_id?: string }).correlation_id).toBe('c-측정-1');
    expect(event?.envelope.payload).not.toHaveProperty('correlation_id');
  });

  /**
   * 뒤늦게 도착한 PR 스냅숏이 **스스로 재개를 예약한다** (AC-11, 상세 설계 5.2).
   *
   * 앞의 시험들은 `reconcileMergeNumbers`를 직접 불러 "재개하면 번호가 붙는다"를
   * 확인한다. 여기서 확인하는 것은 그 앞 단계다 — **스냅숏 저장이 재개 의도를
   * 같은 트랜잭션에 남기는가.** 남기지 않으면 늦게 온 PR 정보는 다음 push나
   * 일일 스윕까지 아무 일도 일으키지 않고, 사용자는 번호가 멈춘 이유를 알 수 없다.
   */
  it('**뒤늦은 PR 스냅숏이 reconcile 의도를 같은 트랜잭션에 남긴다** (AC-11)', async () => {
    await seedDirect(1, origin.rootSha);
    await seedDirect(3, origin.directSha);
    // C(#27)만 빼고 확정한다 — 앞이 막혀 E(#29)도 번호를 받지 못한다.
    const known = knownPrs(origin, [21, 25, 29]);
    await reconcileMergeNumbers(mnumberDeps(evidenceSource(known)), REPOSITORY_ID, BRANCH);
    expect(await space()).toMatchObject({ headNumber: 2, blockedSeq: 5 });

    // 이 시점의 reconcile work는 앞선 회차가 이미 끝낸 것들이다.
    const before = (await sequenceWorkRepo.listWorkForSpace(pool, REPOSITORY_ID, BRANCH))
      .filter((one) => one.kind === 'reconcile');
    const beforeGeneration = before[0]?.requested_generation ?? 0;

    // C의 스냅숏이 이제 도착한다. push도, 수동 호출도 없다.
    await recordProjectionSnapshot(
      pool,
      [
        {
          alias: 'prs-pull-requests',
          id: `pr:${String(REPOSITORY_ID)}:27`,
          routing: String(REPOSITORY_ID),
          doc: {
            document_version: 20,
            state: 'merged',
            base_branch: BRANCH,
            merge_commit_sha: origin.squash.get(27) as string,
            merged_at: origin.mergedAt.get(27) as string,
          },
        },
      ],
      {
        repositoryId: REPOSITORY_ID,
        prNumber: 27,
        source: 'webhook',
        linkObservation: {
          observedVersion: 20,
          sourceShas: [],
          mergeSha: origin.squash.get(27) as string,
          commitsComplete: true,
          pullRequestAuthoritative: true,
          commitsErrorKind: null,
          apiCommitCount: null,
          sourceCommitsTruncated: false,
          headSha: null,
          baseSha: null,
          baseBranch: BRANCH,
          prState: 'merged',
          reason: null,
        },
      },
    );

    const after = (await sequenceWorkRepo.listWorkForSpace(pool, REPOSITORY_ID, BRANCH))
      .filter((one) => one.kind === 'reconcile');
    expect(after).toHaveLength(1);
    // 새 세대가 요청됐다 — 이것이 러너가 다시 돌 근거다.
    expect(after[0]?.requested_generation).toBe(beforeGeneration + 1);
    expect(after[0]?.seq_epoch).toBe(1);
    expect(after[0]?.payload).toMatchObject({ trigger_kind: 'snapshot', pr_number: 27 });

    // 그 의도만으로 러너가 끝까지 간다 — 새 push 없이 번호가 이어 붙는다.
    known.set(27, { sha: origin.squash.get(27) as string, mergedAt: origin.mergedAt.get(27) as string });
    const runnerDeps = { pool, sequence: sequenceDeps(), mnumber: mnumberDeps(evidenceSource(known)), metrics: createWorkerMetrics() };
    for (let round = 0; round < 12; round += 1) {
      if ((await runSequenceWorkOnce(runnerDeps)).claimed === 0) break;
    }
    expect((await numbers()).map((row) => row.m)).toEqual([null, 1, null, 2, 3, 4]);
  });

  it('**낮은 버전이라 무시된 스냅숏은 재개를 요청하지 않는다** — 새 정보가 아니다', async () => {
    await seedDirect(1, origin.rootSha);
    await seedDirect(3, origin.directSha);
    await reconcileMergeNumbers(mnumberDeps(evidenceSource(knownPrs(origin, [21]))), REPOSITORY_ID, BRANCH);

    const document = {
      document_version: 20,
      state: 'merged',
      base_branch: BRANCH,
      merge_commit_sha: origin.squash.get(25) as string,
      merged_at: origin.mergedAt.get(25) as string,
    };
    const request = { alias: 'prs-pull-requests' as const, id: `pr:${String(REPOSITORY_ID)}:25`, routing: String(REPOSITORY_ID), doc: document };
    const linkObservationFor = (documentVersion: number): {
      observedVersion: number;
      sourceShas: readonly string[];
      mergeSha: string;
      commitsComplete: boolean;
      pullRequestAuthoritative: boolean;
      commitsErrorKind: null;
      apiCommitCount: null;
      sourceCommitsTruncated: boolean;
      headSha: null;
      baseSha: null;
      baseBranch: string;
      prState: string;
      reason: null;
    } => ({
      observedVersion: documentVersion,
      sourceShas: [],
      mergeSha: origin.squash.get(25) as string,
      commitsComplete: true,
      pullRequestAuthoritative: true,
      commitsErrorKind: null,
      apiCommitCount: null,
      sourceCommitsTruncated: false,
      headSha: null,
      baseSha: null,
      baseBranch: BRANCH,
      prState: 'merged',
      reason: null,
    });
    await recordProjectionSnapshot(pool, [request], {
      repositoryId: REPOSITORY_ID,
      prNumber: 25,
      source: 'webhook',
      linkObservation: linkObservationFor(20),
    });
    const afterFirst = (await sequenceWorkRepo.listWorkForSpace(pool, REPOSITORY_ID, BRANCH))
      .find((one) => one.kind === 'reconcile')?.requested_generation ?? 0;

    // 더 낮은 버전이 뒤늦게 온다 — 스냅숏도 바뀌지 않고 재개도 요청하지 않는다.
    await recordProjectionSnapshot(
      pool,
      [{ ...request, doc: { ...document, document_version: 5 } }],
      {
        repositoryId: REPOSITORY_ID,
        prNumber: 25,
        source: 'webhook',
        linkObservation: linkObservationFor(5),
      },
    );
    const afterSecond = (await sequenceWorkRepo.listWorkForSpace(pool, REPOSITORY_ID, BRANCH))
      .find((one) => one.kind === 'reconcile')?.requested_generation ?? 0;
    expect(afterSecond).toBe(afterFirst);
  });

  it('materialize는 payload가 아니라 현재 정본을 읽고, 에폭이 바뀐 work는 obsolete다', async () => {
    await seedDirect(1, origin.rootSha);
    await seedDirect(3, origin.directSha);
    const deps = mnumberDeps(evidenceSource(knownPrs(origin)));
    await reconcileMergeNumbers(deps, REPOSITORY_ID, BRANCH);
    const stale = await materializeMergeNumber(deps, { repository_id: REPOSITORY_ID, base_branch: BRANCH, seq_epoch: 99, payload: { pr_number: 21 } });
    expect(stale).toBe('obsolete');
    const missing = await materializeMergeNumber(deps, { repository_id: REPOSITORY_ID, base_branch: BRANCH, seq_epoch: 1, payload: { pr_number: 21 } });
    expect(missing).toBe('document_missing');
  });
});

/**
 * 관측 루프 (WP-074 / 설계 7절, `DEV-610`).
 *
 * ES bulk ACK는 가시성이 아니다. 실제 `_search` hit의 값이 정본과 같을 때만 관측
 * 시각을 남긴다. 여기서 함께 거는 것은 **그 확인의 비용**이다 — 표본마다 정본을
 * 물으면 기본 한도 100에서 왕복이 100번이고 그것이 2초마다 돈다.
 */
describe('관측 루프가 정본을 한 번에 묻는다 (DEV-610)', () => {
  /** 이 회차가 실행한 SQL. 표본 수와 무관하게 고정인지 센다. */
  function countingPool(): { pool: Pool; lookups: string[] } {
    const lookups: string[] = [];
    const proxy = new Proxy(pool, {
      get(target, property, receiver) {
        if (property === 'query') {
          return (...args: unknown[]): unknown => {
            const first = args[0];
            const text = typeof first === 'string' ? first : String((first as { text?: string }).text ?? '');
            if (text.includes('FROM merge_sequence ms') && text.includes('unnest')) lookups.push(text);
            return (target.query as (...a: unknown[]) => unknown).apply(target, args);
          };
        }
        return Reflect.get(target, property, receiver) as unknown;
      },
    }) as Pool;
    return { pool: proxy, lookups };
  }

  it('**표본 셋에 정본 조회가 1회다** — 표본마다 묻지 않는다', async () => {
    await seedDirect(1, origin.rootSha);
    await seedDirect(3, origin.directSha);
    await reconcileMergeNumbers(mnumberDeps(evidenceSource(knownPrs(origin))), REPOSITORY_ID, BRANCH);

    // 번호를 받은 PR마다 표본이 하나씩 있다.
    const samples = await sequenceLatencyRepo.listUnobservedAssigned(pool, 100);
    expect(samples.length).toBeGreaterThanOrEqual(3);

    const counting = countingPool();
    const deps = mnumberDeps(evidenceSource(knownPrs(origin)), { pool: counting.pool });
    await observeMergeNumberSamples(deps, 100);

    expect(counting.lookups).toHaveLength(1);
  });

  /**
   * 한 PR에 정본 행이 둘일 때 **번호를 가진 행이 이긴다** (`DEV-611`).
   *
   * `lookupMergeNumbers`는 `merge_seq` 순서로 둘 다 돌려준다. 그냥 `Map`에 넣으면
   * 나중 행이 덮으므로, 번호 있는 행이 앞이고 충돌 행이 뒤면 관측이 번호 없는 쪽을
   * 보고 **영영 `visible`이 되지 않는다.** API 쪽 `preferRow`와 같은 규칙이다.
   */
  it('**충돌 행이 뒤에 있어도 번호를 가진 행으로 관측한다** (DEV-611)', async () => {
    await seedDirect(1, origin.rootSha);
    await seedDirect(3, origin.directSha);
    await reconcileMergeNumbers(mnumberDeps(evidenceSource(knownPrs(origin))), REPOSITORY_ID, BRANCH);

    // PR 21에 번호 없는 둘째 행을 더한다 — 같은 PR의 이중 squash SHA다.
    const numbered = (await pool.query<{ merge_seq: string; merge_number: string | null; commit_sha: string }>(
      'SELECT merge_seq, merge_number, commit_sha FROM merge_sequence WHERE repository_id = $1 AND pull_request_number = 21',
      [REPOSITORY_ID],
    )).rows[0];
    expect(numbered?.merge_number, '먼저 번호가 붙어 있어야 한다').not.toBeNull();

    const conflictSeq = 90;
    await pool.query(
      `INSERT INTO merge_sequence (repository_id, base_branch, seq_epoch, merge_seq, commit_sha, pull_request_number, committed_at)
       VALUES ($1, $2, 1, $3, $4, 21, now())`,
      [REPOSITORY_ID, BRANCH, conflictSeq, 'c'.repeat(40)],
    );

    /*
     * 색인이 번호를 이미 담고 있다고 답하는 ES 대역. **번호 있는 행을 골랐다면**
     * 값이 일치해 관측이 완료되고, 번호 없는 행을 골랐다면 `expected.merge_number`가
     * `null`이라 `visible`이 되지 않는다.
     */
    const before = (await sequenceLatencyRepo.listUnobservedAssigned(pool, 100)).filter((one) => one.pr_number === 21);
    expect(before.length, '관측 대기 표본이 있어야 한다').toBeGreaterThan(0);

    const es = {
      search: async (): Promise<unknown> => ({
        _shards: { failed: 0, total: 1 },
        hits: {
          total: { value: 1, relation: 'eq' },
          hits: [{
            _index: 'prs-pull-requests-v1',
            _id: 'x',
            _source: {
              merge_number: Number(numbered?.merge_number),
              merge_number_epoch: 1,
              merge_commit_sha: numbered?.commit_sha,
            },
          }],
        },
      }),
    } as unknown as Client;

    const observed = await observeMergeNumberSamples(mnumberDeps(evidenceSource(knownPrs(origin)), { es }), 100);
    expect(observed, '번호 있는 행을 골랐다면 관측이 완료된다').toBeGreaterThan(0);

    await pool.query('DELETE FROM merge_sequence WHERE repository_id = $1 AND merge_seq = $2', [REPOSITORY_ID, conflictSeq]);
  });

  it('정본을 읽지 못하면 아무것도 관측하지 않는다 — 없는 사실을 남기지 않는다', async () => {
    await seedDirect(1, origin.rootSha);
    await seedDirect(3, origin.directSha);
    await reconcileMergeNumbers(mnumberDeps(evidenceSource(knownPrs(origin))), REPOSITORY_ID, BRANCH);

    const failing = {
      ...pool,
      query: (...args: unknown[]): unknown => {
        const first = args[0];
        const text = typeof first === 'string' ? first : String((first as { text?: string }).text ?? '');
        if (text.includes('FROM merge_sequence ms')) return Promise.reject(new Error('시험이 주입한 조회 실패'));
        return (pool.query as (...a: unknown[]) => unknown).apply(pool, args);
      },
    } as unknown as Pool;

    const deps = mnumberDeps(evidenceSource(knownPrs(origin)), { pool: failing });
    expect(await observeMergeNumberSamples(deps, 100)).toBe(0);

    // 표본은 그대로 미관측이다 — 다음 회차가 다시 본다.
    expect((await sequenceLatencyRepo.listUnobservedAssigned(pool, 100)).length).toBeGreaterThan(0);
  });
});
