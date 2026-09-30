/**
 * CR-139 / DEV-810 — mirror 모드 sequence 역할의 M 번호 근거가 커밋을 미러에서 읽는다.
 *
 * ## 무엇을 증명하는가
 *
 * `resolveEvidence`는 squash 프로파일을 판정하려고 `readCommit`으로 부모 수를 읽는다
 * (FR-SEQ-008 AC-9). 옛 미러 `readCommit`(`git show --no-patch`)은 **삭제와 추가가 함께 있는
 * squash 커밋**에서 이름 변경 감지 때문에 blob을 요구해 실패했다. 운영 배선
 * (`apps/pipeline-worker/src/index.ts`의 `FallbackCommitGraph`)은 그때마다 API를 불렀고,
 * API가 한도 격리 중이면 `profile_unverified`로 막혀 durable work가 60초마다 같은 조회를
 * 되풀이했다.
 *
 * 운영과 같은 모양으로 세운다 — HTTP 원격에서 `MirrorSync`로 만든 blobless 미러(`SEQUENCE_GRAPH_MODE=mirror`),
 * 미러 우선·API 폴백 그래프, 요청 수를 세는 원격(`packages/github/integration/smart-http.ts`)과
 * 호출 수를 세는 API 대역. 이 시험은 사내 GHE도 사내 PIPE도 거치지 않는다.
 *
 * 실행: `pnpm exec vitest run --config vitest.integration.config.ts apps/pipeline-worker/integration/sequence/mnumber-mirror-readcommit`
 */

import { writeFile } from 'node:fs/promises';
import type { Client } from '@elastic/elasticsearch';
import type { EventBus } from '@prs/bus';
import {
  FallbackCommitGraph,
  GitHubApiError,
  MirrorCommitGraph,
  MirrorSync,
  type CommitGraph,
  type PullRequestEvidence,
  type RepoRef,
} from '@prs/github';
import { mnumberEvidenceRepo, repositoryRepo, sequenceWorkRepo, type Pool } from '@prs/db';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { migratedPool, truncate } from '../../../../packages/db/integration/helpers.js';
import {
  basicAuthorization,
  startCountingRemote,
  type CountingRemote,
} from '../../../../packages/github/integration/smart-http.js';
import { createWorkerMetrics } from '../../src/metrics.js';
import { reconcileMergeNumbers, type MergeNumberDeps } from '../../src/mnumber.js';
import type { PullRequestEvidenceSource } from '../../src/mnumber-evidence.js';
import { prepareAndAssignSequence, type SequenceDeps } from '../../src/sequence.js';
import { runSequenceWorkOnce } from '../../src/sequence-work-runner.js';
import { firstParentOf, makeTempDir, removeDir, run } from './fixture.js';
import { createSquashFixture, type SquashFixture } from './squash-fixture.js';

const REPOSITORY_ID = 7439;
const OWNER = 'acme';
const NAME = 'smp1939';
const BRANCH = 'main';
const FAKE_TOKEN = 'fake-installation-token-cr139';
/** 삭제와 추가가 함께 있는 squash 커밋의 PR. */
const RENAME_PR = 31;

let pool: Pool;
let origin: SquashFixture;
/** 삭제+추가 squash 커밋 F (서수 7). */
let renameSquash: string;
let remote: CountingRemote;
let mirrorRoot: string;

function fakeEs(): Client {
  return {
    search: async (): Promise<unknown> => ({ hits: { hits: [] } }),
    updateByQuery: async (): Promise<unknown> => ({ updated: 0 }),
    mget: async (body: { docs: readonly { _id: string }[] }): Promise<unknown> => ({ docs: body.docs.map((doc) => ({ _id: doc._id, found: false })) }),
    bulk: async (): Promise<unknown> => ({ errors: false, items: [] }),
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

function mirrorSync(): MirrorSync {
  return new MirrorSync({
    root: mirrorRoot,
    remoteUrl: (ref) => remote.url(ref.owner, ref.repo),
    tokenFor: async () => Promise.resolve(FAKE_TOKEN),
  });
}

function mirrorGraph(): MirrorCommitGraph {
  return new MirrorCommitGraph({ root: mirrorRoot, repositoryIdOf: () => REPOSITORY_ID, tokenFor: async () => Promise.resolve(FAKE_TOKEN) });
}

/** PR 상세 대역. 알려진 PR만 답한다 (mnumber.test.ts와 같은 규칙). */
function evidenceSource(known: ReadonlyMap<number, { sha: string; mergedAt: string }>): PullRequestEvidenceSource {
  return {
    async getPullRequestEvidence(_ref: RepoRef, number: number): Promise<PullRequestEvidence | null> {
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
    async listPullRequestsForCommitPage(_ref: RepoRef, sha: string) {
      const items = [...known.entries()].filter(([, entry]) => entry.sha === sha).map(([number]) => ({ number }));
      return { items, nextPage: null, requestId: `req-${sha.slice(0, 7)}` };
    },
  };
}

/**
 * 운영 배선과 같은 미러 우선·API 폴백 그래프. API 대역은 `readCommit` 호출을 세고,
 * `quarantined`면 한도 격리 중인 전송처럼 보내기 전에 던진다.
 */
function graphUnderTest(options: { readonly quarantined: boolean }): {
  readonly graph: CommitGraph;
  readonly apiCalls: string[];
  readonly fallbacks: unknown[];
} {
  const apiCalls: string[] = [];
  const fallbacks: unknown[] = [];
  const mirror = mirrorGraph();
  const api = {
    kind: 'api',
    readCommit: async (_ref: RepoRef, sha: string) => {
      apiCalls.push(sha);
      if (options.quarantined) throw new GitHubApiError('rate_limited', `${OWNER} 토큰이 한도 회복을 기다리는 중이다`);
      const parents = (await run(origin.dir, ['rev-list', '--parents', '-n', '1', sha])).trim().split(' ').slice(1);
      return { sha, parentShas: parents, message: '', author: null, authorEmail: null, committer: null, committerEmail: null, authoredAt: '2026-09-01T00:00:00Z', committedAt: '2026-09-01T00:00:00Z' };
    },
  } as unknown as CommitGraph;
  return { graph: new FallbackCommitGraph(mirror, api, (error) => fallbacks.push(error)), apiCalls, fallbacks };
}

function sequenceDeps(): SequenceDeps {
  const graph = mirrorGraph();
  return {
    pool,
    es: fakeEs(),
    bus: fakeBus(),
    metrics: createWorkerMetrics(),
    graphFor: (): CommitGraph => graph,
    freshness: { pool, mode: 'mirror', sync: mirrorSync() },
  };
}

function mnumberDeps(graph: CommitGraph, known: ReadonlyMap<number, { sha: string; mergedAt: string }>): MergeNumberDeps {
  return {
    pool,
    es: fakeEs(),
    bus: fakeBus(),
    metrics: createWorkerMetrics(),
    config: { enabled: true, batchSize: 100, pollMs: 1_000, retryMaxMs: 60_000, profile: 'squash_only' },
    evidence: { pool, source: evidenceSource(known), graphFor: () => graph },
  };
}

function knownPrs(only?: readonly number[]): Map<number, { sha: string; mergedAt: string }> {
  const out = new Map<number, { sha: string; mergedAt: string }>();
  for (const [pr, sha] of origin.squash) {
    if (only === undefined || only.includes(pr)) out.set(pr, { sha, mergedAt: origin.mergedAt.get(pr) as string });
  }
  if (only === undefined || only.includes(RENAME_PR)) out.set(RENAME_PR, { sha: renameSquash, mergedAt: '2026-09-01T06:00:00Z' });
  return out;
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

/** 삭제와 추가를 함께 담은 squash 커밋을 main에 더한다. 부모는 하나다. */
async function addDeleteAddSquash(dir: string): Promise<string> {
  const at = { GIT_AUTHOR_DATE: '2026-09-01T06:00:00Z', GIT_COMMITTER_DATE: '2026-09-01T06:00:00Z' };
  await run(dir, ['checkout', '-q', '-b', 'fr']);
  await run(dir, ['rm', '-q', 'direct.txt']);
  await run(dir, ['commit', '-q', '-m', 'fr delete'], at);
  await writeFile(`${dir}/fr-added.txt`, 'a file that replaces direct.txt\nwith different content\n', 'utf8');
  await run(dir, ['add', '.']);
  await run(dir, ['commit', '-q', '-m', 'fr add'], at);
  await run(dir, ['checkout', '-q', 'main']);
  await run(dir, ['merge', '-q', '--squash', 'fr']);
  await run(dir, ['commit', '-q', '-m', `F squash (#${String(RENAME_PR)})`], at);
  const sha = (await run(dir, ['rev-parse', 'HEAD'])).trim();
  const parents = (await run(dir, ['rev-list', '--parents', '-n', '1', 'HEAD'])).trim().split(' ');
  if (parents.length !== 2) throw new Error('F squash의 부모가 하나가 아니다');
  const changed = (await run(dir, ['diff-tree', '--no-commit-id', '--name-status', '-r', 'HEAD^1', 'HEAD'])).trim();
  // 이 커밋이 유발 조건(삭제와 추가가 한 diff에)을 실제로 갖는지 먼저 확인한다.
  if (!/^D\tdirect\.txt$/m.test(changed) || !/^A\tfr-added\.txt$/m.test(changed)) {
    throw new Error(`F squash가 삭제+추가가 아니다: ${changed}`);
  }
  return sha;
}

beforeAll(async () => {
  pool = await migratedPool();
}, 120_000);

afterAll(async () => {
  await truncate(pool, 'sequence_latency_sample', 'sequence_work', 'mnumber_evidence', 'merge_sequence', 'sequence_space', 'pull_request_snapshot', 'repository');
  await pool.end();
});

beforeEach(async () => {
  await truncate(pool, 'sequence_latency_sample', 'sequence_work', 'mnumber_evidence', 'merge_sequence', 'sequence_space', 'pull_request_snapshot', 'repository');
  origin = await createSquashFixture();
  renameSquash = await addDeleteAddSquash(origin.dir);
  remote = await startCountingRemote({
    repos: { [`/${OWNER}/${NAME}.git`]: `${origin.dir}/.git` },
    expectedAuthorization: basicAuthorization(FAKE_TOKEN),
  });
  mirrorRoot = await makeTempDir('prs-cr139-seq-mirror-');
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
  // 채번 전 최신화가 HTTP 원격에서 blobless 미러를 만든다 (mirror 모드).
  const assigned = await prepareAndAssignSequence(sequenceDeps(), REPOSITORY_ID, BRANCH);
  expect(assigned.kind).toBe('done');
  const mirrorDir = `${mirrorRoot}/${String(REPOSITORY_ID)}.git`;
  expect((await run(mirrorDir, ['config', '--get', 'remote.origin.promisor'])).trim()).toBe('true');
  expect((await run(mirrorDir, ['config', '--get', 'remote.origin.partialclonefilter'])).trim()).toBe('blob:none');
  expect(await firstParentOf(origin.dir, 'main')).toHaveLength(7);
  await seedDirect(1, origin.rootSha);
  await seedDirect(3, origin.directSha);
  remote.reset();
}, 60_000);

afterEach(async () => {
  await remote.close();
  await removeDir(origin.dir);
  await removeDir(mirrorRoot);
});

describe('CR-139: mirror 모드 M 번호 근거의 커밋 읽기', () => {
  it('**삭제+추가 squash 커밋의 프로파일을 미러가 판정한다** — API 폴백 0, 원격 요청 0, 번호가 끝까지 붙는다', async () => {
    const under = graphUnderTest({ quarantined: false });
    const outcome = await reconcileMergeNumbers(mnumberDeps(under.graph, knownPrs()), REPOSITORY_ID, BRANCH);

    // 손으로 선언한 기대값: R·D는 직접 푸시, A=1 B=2 C=3 E=4 F=5.
    expect(await numbers()).toEqual([null, 1, null, 2, 3, 4, 5]);
    expect(outcome).toMatchObject({ kind: 'done', blocked: null });
    expect(under.fallbacks).toEqual([]);
    expect(under.apiCalls).toEqual([]);
    expect(remote.counters().total).toBe(0);
  });

  it('**API가 한도 격리 중이어도 막히지 않는다** — 미러가 답하므로 `profile_unverified`가 없다', async () => {
    const under = graphUnderTest({ quarantined: true });
    const outcome = await reconcileMergeNumbers(mnumberDeps(under.graph, knownPrs()), REPOSITORY_ID, BRANCH);

    expect(outcome).toMatchObject({ kind: 'done', blocked: null });
    expect(await numbers()).toEqual([null, 1, null, 2, 3, 4, 5]);
    expect(under.apiCalls).toEqual([]);
  });

  it('**막힌 squash 커밋을 10번 다시 봐도 API·원격 요청이 늘지 않는다** — 재확인마다 폴백하던 증폭이 없다', async () => {
    // F(#31)의 PR을 GHE가 아직 모른다 — F는 미확정으로 남고 회차마다 다시 확인된다.
    const under = graphUnderTest({ quarantined: false });
    const deps = mnumberDeps(under.graph, knownPrs([21, 25, 27, 29]));
    for (let round = 0; round < 10; round += 1) {
      const outcome = await reconcileMergeNumbers(deps, REPOSITORY_ID, BRANCH, { force: true });
      expect(outcome).toMatchObject({ kind: 'done', blocked: { seq: 7, reason: 'negative_evidence_unavailable' } });
    }
    expect(await numbers()).toEqual([null, 1, null, 2, 3, 4, null]);
    expect(under.fallbacks).toEqual([]);
    expect(under.apiCalls).toEqual([]);
    expect(remote.counters().total).toBe(0);
  });

  it('**durable 러너의 reconcile work가 재시도 대기로 남지 않는다** (API 격리 중)', async () => {
    const under = graphUnderTest({ quarantined: true });
    const deps = mnumberDeps(under.graph, knownPrs());
    const runnerDeps = { pool, sequence: sequenceDeps(), mnumber: deps, metrics: deps.metrics };
    let rounds = 0;
    for (;;) {
      const round = await runSequenceWorkOnce(runnerDeps);
      rounds += 1;
      if (round.claimed === 0 || rounds > 10) break;
    }
    const reconcile = (await sequenceWorkRepo.listWorkForSpace(pool, REPOSITORY_ID, BRANCH)).filter((work) => work.kind === 'reconcile');
    expect(reconcile.length).toBeGreaterThan(0);
    expect(reconcile.filter((work) => work.last_reason === 'profile_unverified')).toEqual([]);
    expect(reconcile.every((work) => work.state === 'done')).toBe(true);
    expect(await numbers()).toEqual([null, 1, null, 2, 3, 4, 5]);
    expect(under.apiCalls).toEqual([]);
  });
});
