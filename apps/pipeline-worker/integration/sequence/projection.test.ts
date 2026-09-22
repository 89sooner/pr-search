/**
 * 머지 시퀀스의 Elasticsearch 투영 수렴 (CR-113 / WP-098, FR-SEQ-001 AC-7, ADR-004).
 *
 * ## 무엇을 판정하나
 *
 * PostgreSQL이 확정한 `merge_seq`가 **도착 순서·실패·재시작과 무관하게** 커밋·PR
 * 문서에 비치고, 그 뒤 새 push 없이도 수렴하는지를 실제 PostgreSQL·Elasticsearch로
 * 확인한다. 사내 `pilot.17` 보고(재색인 뒤 `merge_seq` 0/4,214)의 원인이 된 다섯
 * 경로를 각각 하나의 시험으로 고정한다 — 이 파일은 구현 전에 먼저 쓰였고 현 코드에서
 * 전부 실패했다.
 *
 * ## 무엇을 바꾸지 않나
 *
 * 어느 시험도 PostgreSQL의 `merge_seq`·`seq_epoch`·`head_sha`·`head_seq`를 바꾸지
 * 않는다. 복구는 정본에서 색인으로만 흐른다.
 *
 * ## 격리
 *
 * 고정 `prs-*` 별칭을 실제로 만들고 지우므로 **격리된 Elasticsearch**에서만 돌린다.
 * `ELASTICSEARCH_NODE`가 공용 클러스터를 가리키면 `beforeAll`이 거부한다.
 */

import type { Client } from '@elastic/elasticsearch';
import type { EventBus } from '@prs/bus';
import { MirrorCommitGraph, MirrorSync, type CommitGraph } from '@prs/github';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { EVENT_NAMES, type IngestionEnriched } from '@prs/domain';
import {
  jobRepo,
  mergeSequenceRepo,
  reindexRepo,
  repositoryRepo,
  sequenceSpaceRepo,
  sequenceWorkRepo,
  withReindexWrite,
  type Pool,
  type RepositoryRow,
} from '@prs/db';
import {
  applyMappings,
  bulkUpsert,
  concreteIndexName,
  createEsClient,
  listIndexVersions,
  resolveServingIndex,
  switchAlias,
  switchAliasesForTests,
} from '@prs/es';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { migratedPool, truncate } from '../../../../packages/db/integration/helpers.js';
import { enrichCommit, type CommitEnrichDeps } from '../../src/commit-enrich.js';
import { buildUpsertRequests } from '../../src/documents.js';
import { createWorkerMetrics } from '../../src/metrics.js';
import { REINDEX_TYPE, runReindexJob, verifyBeforeCutover } from '../../src/reindex.js';
import { verifySequenceProjection } from '../../src/sequence-projection.js';
import { prepareAndAssignSequence, repairSequence, type SequenceDeps } from '../../src/sequence.js';
import { runSequenceWorkOnce } from '../../src/sequence-work-runner.js';
import { recordProjectionSnapshot } from '../../src/snapshot.js';
import { makeTempDir, removeDir, run } from './fixture.js';
import { createSquashFixture, type SquashFixture } from './squash-fixture.js';

const REPOSITORY_ID = 7513;
const OWNER = 'acme';
const NAME = 'projection-cr113';
const BRANCH = 'main';
const SPACE = `${OWNER}/${NAME}@${BRANCH}`;
const PR_ALIAS = 'prs-pull-requests';
const COMMIT_ALIAS = 'prs-commits';

let pool: Pool;
let es: Client;
let origin: SquashFixture;
let mirrorRoot: string;
let repository: RepositoryRow;

function fakeBus(): EventBus {
  return {
    publish: async (): Promise<void> => undefined,
    subscribe: async (): Promise<never> => {
      throw new Error('시험에서 구독하지 않는다');
    },
    close: async (): Promise<void> => undefined,
  } as unknown as EventBus;
}

function graph(): CommitGraph {
  return new MirrorCommitGraph({ root: mirrorRoot, repositoryIdOf: () => REPOSITORY_ID });
}

function sequenceDeps(client: Client = es): SequenceDeps {
  return {
    pool,
    es: client,
    bus: fakeBus(),
    metrics: createWorkerMetrics(),
    graphFor: graph,
    freshness: { pool, mode: 'mirror', sync: new MirrorSync({ root: mirrorRoot, remoteUrl: () => origin.url }) },
  };
}

function enrichDeps(): CommitEnrichDeps {
  return { pool, es, bus: fakeBus(), metrics: createWorkerMetrics(), graphFor: graph };
}

/**
 * durable 러너를 큐가 빌 때까지 돌린다. 재시도 지연은 사실상 0으로 둔다 — 시험은
 * "몇 번 만에"가 아니라 "결국 수렴하는가"를 묻는다. `MNUMBER_ENABLED=false`와 같은
 * 구성(`mnumber: null`)이다 — 시퀀스 복구는 M 기능과 무관하게 돌아야 한다.
 */
async function drainWork(client: Client = es, rounds = 12): Promise<Record<string, number>> {
  const outcomes: Record<string, number> = {};
  for (let round = 0; round < rounds; round += 1) {
    const result = await runSequenceWorkOnce({
      pool,
      sequence: sequenceDeps(client),
      mnumber: null,
      metrics: createWorkerMetrics(),
      retryMaxMs: 1,
      random: () => 0.5,
    });
    for (const [key, value] of Object.entries(result.outcomes)) outcomes[key] = (outcomes[key] ?? 0) + value;
    if (result.claimed === 0) {
      // 지연된 재시도가 남아 있으면 그것이 도착할 때까지 잠깐 기다린다.
      const pending = await sequenceWorkRepo.countPendingWork(pool);
      const due = Object.entries(pending).some(([key, count]) => key.startsWith('project:') && !key.endsWith(':parked') && count > 0);
      if (!due) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  return outcomes;
}

function enrichedFor(prNumber: number, mergeSha: string | null, sourceShas: readonly string[] = []): IngestionEnriched {
  return {
    delivery_id: `delivery-${String(prNumber)}-${mergeSha === null ? 'open' : 'merged'}`,
    repository_id: REPOSITORY_ID,
    entity_kind: 'pull_request',
    pr_number: prNumber,
    pull_request: {
      number: prNumber,
      title: `PR ${String(prNumber)}`,
      body: '',
      state: 'closed',
      draft: false,
      labels: [],
      merged: mergeSha !== null,
      created_at: '2026-09-01T00:00:00.000Z',
      updated_at: '2026-09-01T00:00:00.000Z',
      closed_at: mergeSha === null ? null : '2026-09-01T00:00:00.000Z',
      merged_at: mergeSha === null ? null : origin.mergedAt.get(prNumber) ?? '2026-09-01T00:00:00.000Z',
      merge_commit_sha: mergeSha,
      author: 'dev',
      head_ref: `feature/${String(prNumber)}`,
      head_sha: 'b'.repeat(40),
      base_ref: BRANCH,
      base_sha: 'c'.repeat(40),
    },
    source_commit_shas: [...sourceShas],
    changed_files: [],
    reviews: [],
    source_commits_truncated: false,
    files_truncated: false,
    enrichment_pending: false,
    enrichment_errors: [],
    correlation_id: '4c1a4d5e-6f70-4a81-92b3-c4d5e6f70819',
  };
}

/**
 * PR 하나를 **운영 투영과 같은 순서**로 색인한다 — 정본 스냅숏(같은 트랜잭션의 의도)
 * 먼저, 그다음 울타리 안의 bulk. `project.ts`가 하는 일이며, 투영 워커의 버스·
 * raw_event까지 세우지 않고 그 두 primitive만 쓴다.
 */
async function projectPullRequest(prNumber: number, mergeSha: string | null, documentVersion: number): Promise<void> {
  const requests = buildUpsertRequests({
    enriched: enrichedFor(prNumber, mergeSha),
    repository,
    documentVersion,
    indexedAt: new Date(),
    authorTeams: { kind: 'unknown' },
  });
  await recordProjectionSnapshot(pool, requests, { repositoryId: REPOSITORY_ID, prNumber, source: 'webhook' });
  await withReindexWrite(pool, async (targets) => {
    const result = await bulkUpsert(es, requests, targets);
    const rejected = result.outcomes.filter((one) => one.kind !== 'ok');
    if (rejected.length > 0) throw new Error(`PR 투영 실패: ${rejected[0]?.reason ?? 'unknown'}`);
  });
}

async function rawDoc(index: string, id: string): Promise<Record<string, unknown> | undefined> {
  await es.indices.refresh({ index });
  try {
    const response = await es.get<Record<string, unknown>>({ index, id, routing: String(REPOSITORY_ID) });
    return response._source;
  } catch (error) {
    if ((error as { statusCode?: number }).statusCode === 404) return undefined;
    throw error;
  }
}

const prDoc = (prNumber: number, index = PR_ALIAS): Promise<Record<string, unknown> | undefined> =>
  rawDoc(index, `${String(REPOSITORY_ID)}:${String(prNumber)}`);
const commitDoc = (sha: string, index = COMMIT_ALIAS): Promise<Record<string, unknown> | undefined> =>
  rawDoc(index, `${String(REPOSITORY_ID)}:${sha}`);

/** 정본이 말하는 (SHA → 서수). 시험의 기대값은 언제나 여기서 나온다. */
async function canonical(): Promise<Map<string, number>> {
  const space = await sequenceSpaceRepo.findSequenceSpace(pool, REPOSITORY_ID, BRANCH);
  if (space === undefined) throw new Error('시퀀스 공간이 없다');
  const rows = await mergeSequenceRepo.findRange(pool, REPOSITORY_ID, BRANCH, space.seq_epoch, 0, Number(space.head_seq));
  return new Map(rows.map((row) => [row.commit_sha, Number(row.merge_seq)]));
}

async function canonicalSnapshot(): Promise<{ epoch: number; headSha: string | null; headSeq: number; rows: [string, number][] }> {
  const space = await sequenceSpaceRepo.findSequenceSpace(pool, REPOSITORY_ID, BRANCH);
  if (space === undefined) throw new Error('시퀀스 공간이 없다');
  return { epoch: space.seq_epoch, headSha: space.head_sha, headSeq: Number(space.head_seq), rows: [...(await canonical()).entries()] };
}

/** ES 문서가 정본과 같은 서수·에폭·공간을 갖는가 — **원시 필드**를 본다. */
function expectProjected(doc: Record<string, unknown> | undefined, seq: number, epoch = 1): void {
  expect(doc, '문서가 없다').toBeDefined();
  expect(doc).toMatchObject({ merge_seq: seq, seq_epoch: epoch, sequence_space: SPACE, base_branch: BRANCH });
}

async function assign(): Promise<void> {
  const outcome = await prepareAndAssignSequence(sequenceDeps(), REPOSITORY_ID, BRANCH);
  expect(outcome.kind).toBe('done');
}

beforeAll(async () => {
  pool = await migratedPool();
  es = createEsClient();
  const info = await es.info();
  /*
   * 파괴적 시험이다 — 클러스터 이름이 격리 표식을 달고 있을 때만 시작한다. 공용
   * `prs-elasticsearch`를 가리키면 별칭을 옮기고 문서를 지우기 전에 여기서 멈춘다.
   */
  if (!/isolated|test|ci/i.test(String(info.cluster_name)) && process.env['CI'] !== 'true') {
    throw new Error(`격리되지 않은 Elasticsearch(${String(info.cluster_name)})에서는 이 시험을 돌리지 않는다`);
  }
  await applyMappings(es);
  await switchAliasesForTests(es);
}, 120_000);

afterAll(async () => {
  await es.close();
  await pool.end();
});

beforeEach(async () => {
  await truncate(
    pool,
    'sequence_latency_sample',
    'sequence_work',
    'mnumber_evidence',
    'merge_sequence',
    'sequence_space',
    'pull_request_snapshot',
    'commit_snapshot',
    'repository',
  );
  await pool.query('DELETE FROM job WHERE type = $1', [REINDEX_TYPE]);
  await es.indices.refresh({ index: [PR_ALIAS, COMMIT_ALIAS] });
  await es.deleteByQuery({ index: [PR_ALIAS, COMMIT_ALIAS], query: { match_all: {} }, refresh: true, conflicts: 'proceed' });

  origin = await createSquashFixture();
  mirrorRoot = await makeTempDir('prs-projection-mirror-');
  await new MirrorSync({ root: mirrorRoot, remoteUrl: () => origin.url }).sync({ owner: OWNER, repo: NAME }, REPOSITORY_ID);
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
  const found = await repositoryRepo.findRepositoryById(pool, REPOSITORY_ID);
  if (found === undefined) throw new Error('시험 저장소를 만들지 못했다');
  repository = found;
}, 60_000);

afterEach(async () => {
  await removeDir(origin.dir);
  await removeDir(mirrorRoot);
});

describe('도착 순서와 무관하게 수렴한다 (FR-SEQ-001 AC-7)', () => {
  it('**시퀀스가 먼저 확정되고 PR 문서가 나중에 도착한다** — 새 push 없이 서수를 받는다', async () => {
    await assign();
    // 채번이 남긴 durable work는 PR 문서가 오기 **전에** 이미 다 돌았다 — 운영에서 1초 안에 일어나는 일이다.
    await drainWork();
    const seqOf = await canonical();
    const shaA = origin.squash.get(21) as string;

    // 채번 시점에는 PR 문서가 없었다. 늦게 도착한 PR 스냅숏이 의도를 남겨야 한다.
    expect(await prDoc(21)).toBeUndefined();
    await projectPullRequest(21, shaA, 1_000);
    await drainWork();

    expectProjected(await prDoc(21), seqOf.get(shaA) as number);
    expect(await canonicalSnapshot()).toMatchObject({ epoch: 1, headSha: origin.chain[5] });
  });

  it('**PR 문서가 먼저 있고 `merge_commit_sha`가 나중에 채워진다** — 갱신 뒤 서수를 받는다', async () => {
    // 열린 PR로 먼저 투영된다(머지 커밋 없음). 그 뒤 채번, 그 뒤 머지 상태 갱신.
    await projectPullRequest(25, null, 1_000);
    await assign();
    await drainWork();
    const seqOf = await canonical();
    const shaB = origin.squash.get(25) as string;
    expect((await prDoc(25))?.['merge_seq']).toBeUndefined();

    await projectPullRequest(25, shaB, 2_000);
    await drainWork();

    expectProjected(await prDoc(25), seqOf.get(shaB) as number);
  });

  it('**PR 먼저·시퀀스 먼저 두 순서가 같은 결과를 낸다** — 정렬 fixture는 PR 번호·merged_at·서수가 서로 다르다', async () => {
    // PR 문서가 먼저(#27·#29), 채번, 그 뒤 나머지(#21·#25). 서수는 git이 정하고 PR 번호와 무관하다.
    const shas = new Map([...origin.squash.entries()]);
    await projectPullRequest(29, shas.get(29) as string, 1_000);
    await projectPullRequest(27, shas.get(27) as string, 1_000);
    await assign();
    await drainWork();
    await projectPullRequest(21, shas.get(21) as string, 1_000);
    await projectPullRequest(25, shas.get(25) as string, 1_000);
    await drainWork();

    const seqOf = await canonical();
    for (const [pr, sha] of shas) expectProjected(await prDoc(pr), seqOf.get(sha) as number);
    // 서수 순서(21 < 25 < 27 < 29)는 fixture 체인이 정한 것이고 merged_at 정렬과 같아야 할 이유가 없다.
    const bySeq = [...shas.entries()].sort((a, b) => (seqOf.get(a[1]) as number) - (seqOf.get(b[1]) as number)).map(([pr]) => pr);
    expect(bySeq).toEqual([21, 25, 27, 29]);
  });

  it('**직접 푸시 커밋 문서가 채번 뒤에 생성된다** — 보강이 만든 문서도 서수를 받는다', async () => {
    await assign();
    await drainWork();
    const seqOf = await canonical();
    // 채번 시점에 커밋 문서는 하나도 없다 — 직접 푸시 커밋은 PR 투영이 만들지 않는다.
    expect(await commitDoc(origin.directSha)).toBeUndefined();

    const enriched = await enrichCommit(enrichDeps(), repository, {
      commitSha: origin.directSha,
      firstParent: true,
      pullRequestNumber: null,
      baseBranch: BRANCH,
    });
    expect(enriched).toBe(true);
    await drainWork();

    const doc = await commitDoc(origin.directSha);
    expectProjected(doc, seqOf.get(origin.directSha) as number);
    expect(doc?.['role']).toBe('direct_push');
  });
});

describe('실패·복구 뒤에도 새 push 없이 수렴한다', () => {
  it('**ES 쓰기가 실패한 뒤 새 push가 전혀 없다** — durable 작업이 정본을 다시 비춘다', async () => {
    const shaC = origin.squash.get(27) as string;
    await projectPullRequest(27, shaC, 1_000);

    // 채번 회차의 색인 쓰기만 죽는 ES. 읽기·조회는 그대로다.
    const failing = new Proxy(es, {
      get(target, property: string | symbol) {
        if (property === 'updateByQuery' || property === 'bulk' || property === 'update' || property === 'mget') {
          return async (): Promise<never> => {
            throw new Error('injected_es_failure');
          };
        }
        return Reflect.get(target, property) as unknown;
      },
    }) as Client;
    const outcome = await prepareAndAssignSequence(sequenceDeps(failing), REPOSITORY_ID, BRANCH);
    expect(outcome.kind).toBe('done');
    const seqOf = await canonical();
    expect((await prDoc(27))?.['merge_seq']).toBeUndefined();

    // 새 push 없이 러너만 돈다 — 건강한 ES로.
    await drainWork();
    expectProjected(await prDoc(27), seqOf.get(shaC) as number);
    expect(await canonicalSnapshot()).toMatchObject({ epoch: 1, headSeq: 6 });
  });

  it('**Git·PG는 consistent인데 ES 필드만 비어 있다** — 재채번 복구가 에폭을 올리지 않고 서수를 되살린다', async () => {
    const shaE = origin.squash.get(29) as string;
    await projectPullRequest(29, shaE, 1_000);
    await assign();
    const before = await canonicalSnapshot();
    await drainWork();
    expectProjected(await prDoc(29), before.rows.find(([sha]) => sha === shaE)?.[1] as number);

    // 색인만 손상시킨다 — 운영에서 재색인·수동 update_by_query가 남긴 상태와 같다.
    await es.update({
      index: PR_ALIAS,
      id: `${String(REPOSITORY_ID)}:29`,
      routing: String(REPOSITORY_ID),
      refresh: true,
      script: { lang: 'painless', source: 'ctx._source.remove("merge_seq"); ctx._source.remove("seq_epoch"); ctx._source.remove("sequence_space");' },
    });
    expect((await prDoc(29))?.['merge_seq']).toBeUndefined();

    const repaired = await repairSequence(sequenceDeps(), repository, BRANCH);
    expect(repaired.kind).toBe('consistent');
    await drainWork();

    expectProjected(await prDoc(29), before.rows.find(([sha]) => sha === shaE)?.[1] as number);
    // 정본은 한 값도 바뀌지 않았다.
    expect(await canonicalSnapshot()).toEqual(before);
  });
});

describe('재색인이 새 인덱스에 시퀀스를 복원한다 (FR-ING-008 AC-8)', () => {
  const created = new Set<string>();

  async function enqueueReindex(alias: 'prs-pull-requests' | 'prs-commits'): Promise<{ jobId: number; targetIndex: string; sourceIndex: string }> {
    const outcome = await reindexRepo.enqueueReindex(
      pool,
      {
        resolveServingIndex: (name) => resolveServingIndex(es, name),
        async nextTargetIndex(name) {
          const versions = await listIndexVersions(es, name);
          const highest = versions.length === 0 ? 0 : (versions[versions.length - 1] as number);
          return concreteIndexName(name, highest + 1);
        },
        isAlias: (value) => value === alias,
      },
      alias,
      'test',
    );
    if (outcome.kind !== 'queued') throw new Error(`큐에 넣지 못했다: ${outcome.kind}`);
    created.add(outcome.targetIndex);
    await pool.query("UPDATE job SET state = 'running', started_at = now() WHERE job_id = $1", [outcome.jobId]);
    return { jobId: outcome.jobId, targetIndex: outcome.targetIndex, sourceIndex: outcome.sourceIndex };
  }

  async function restoreAlias(alias: string, sourceIndex: string): Promise<void> {
    const serving = await resolveServingIndex(es, alias);
    if (serving !== sourceIndex) await switchAlias(es, alias, serving, sourceIndex);
    for (const index of created) {
      if (await es.indices.exists({ index })) await es.indices.delete({ index });
    }
    created.clear();
  }

  it('**PG 시퀀스를 유지한 채 `prs-pull-requests`를 재색인한다** — 새 인덱스의 PR 문서가 정본 서수를 갖고 전환된다', async () => {
    for (const [pr, sha] of origin.squash) await projectPullRequest(pr, sha, 1_000);
    await assign();
    await drainWork();
    const before = await canonicalSnapshot();

    const { jobId, targetIndex, sourceIndex } = await enqueueReindex(PR_ALIAS);
    try {
      const row = await jobRepo.findJobById(pool, jobId);
      if (row === undefined) throw new Error('잡을 찾지 못했다');
      await runReindexJob({ pool, es, refresh: true, mergeNumberEnabled: false }, row);

      const job = await jobRepo.findJobById(pool, jobId);
      expect(job?.state, job?.error ?? '').toBe('completed');
      // 새 인덱스의 **원시 필드**를 본다 — API의 DB 보강이 아니라 색인 자체다.
      for (const [pr, sha] of origin.squash) {
        expectProjected(await prDoc(pr, targetIndex), before.rows.find(([one]) => one === sha)?.[1] as number);
      }
      expect(await canonicalSnapshot()).toEqual(before);
      // replay가 공간·에폭·건수를 진행 상태에 남겼다 — 전환 울타리의 에폭 대조와 중단 뒤 재개의 근거다.
      const replay = (job?.progress as { sequence_replay?: { spaces: Record<string, unknown>[] } }).sequence_replay;
      expect(replay?.spaces).toHaveLength(1);
      expect(replay?.spaces[0]).toMatchObject({ repository_id: REPOSITORY_ID, base_branch: BRANCH, seq_epoch: 1, head_seq: 6, settled: 4, unsettled: 0 });

      /*
       * 전환 전 검증은 문서마다 대조한다. target에서 문서 하나를 지우고 하나의 서수를 비우면 —
       * 비운 것은 다시 비춰 고치고(repaired), 없는 것은 고칠 수 없어 실패 사유로 남는다.
       */
      await es.delete({ index: targetIndex, id: `${String(REPOSITORY_ID)}:21`, routing: String(REPOSITORY_ID), refresh: true });
      await es.update({ index: targetIndex, id: `${String(REPOSITORY_ID)}:25`, routing: String(REPOSITORY_ID), refresh: true, script: { lang: 'painless', source: 'ctx._source.remove("merge_seq");' } });
      const verified = await verifySequenceProjection({ pool, es }, 'pull_request', targetIndex);
      expect(verified.ok).toBe(false);
      expect(verified.repaired).toBe(1);
      expect(verified.reasons.some((one) => one.includes(`${String(REPOSITORY_ID)}:21`) && one.includes('document_missing'))).toBe(true);
      expectProjected(await prDoc(25, targetIndex), before.rows.find(([one]) => one === (origin.squash.get(25) as string))?.[1] as number);
      // 재색인 잡의 전환 전 검증도 같은 사유를 낸다 — 잡 상태 사유와 함께.
      const gate = await verifyBeforeCutover({ pool, es }, jobId, null);
      expect(gate.ok).toBe(false);
      expect(gate.reasons.some((one) => one.includes('시퀀스 투영 불일치'))).toBe(true);
    } finally {
      await restoreAlias(PR_ALIAS, sourceIndex);
    }
  });

  it('**PG 시퀀스를 유지한 채 `prs-commits`를 재색인한다** — first-parent 커밋 문서의 서수가 복원된다', async () => {
    for (const [pr, sha] of origin.squash) await projectPullRequest(pr, sha, 1_000);
    await assign();
    for (const sha of origin.chain) {
      await enrichCommit(enrichDeps(), repository, {
        commitSha: sha,
        firstParent: true,
        pullRequestNumber: [...origin.squash.entries()].find(([, one]) => one === sha)?.[0] ?? null,
        baseBranch: BRANCH,
      });
    }
    await drainWork();
    const before = await canonicalSnapshot();

    const { jobId, targetIndex, sourceIndex } = await enqueueReindex(COMMIT_ALIAS);
    try {
      const row = await jobRepo.findJobById(pool, jobId);
      if (row === undefined) throw new Error('잡을 찾지 못했다');
      await runReindexJob({ pool, es, refresh: true, mergeNumberEnabled: false }, row);

      const job = await jobRepo.findJobById(pool, jobId);
      expect(job?.state, job?.error ?? '').toBe('completed');
      for (const [sha, seq] of before.rows) expectProjected(await commitDoc(sha, targetIndex), seq);
      expect(await canonicalSnapshot()).toEqual(before);
      const replay = (job?.progress as { sequence_replay?: { spaces: Record<string, unknown>[] } }).sequence_replay;
      expect(replay?.spaces[0]).toMatchObject({ repository_id: REPOSITORY_ID, base_branch: BRANCH, seq_epoch: 1, settled: 6, unsettled: 0 });
    } finally {
      await restoreAlias(COMMIT_ALIAS, sourceIndex);
    }
  });

  it('**first-parent 히스토리를 공유하는 두 시퀀스 브랜치** — 공유 커밋은 한 공간의 서수만 달고, 다른 공간의 `prs-commits` 재색인도 전환된다 (독립 리뷰 지적)', async () => {
    /*
     * `release`를 A(서수 2) 시점에서 갈라 커밋 하나를 더한다. 두 브랜치의 first-parent 체인은 root·A를
     * 공유하며, 커밋 문서는 SHA당 하나라 한 공간만 라벨링한다. 처음 판의 전환 전 검증은 대표 범위
     * 정렬의 기대치에 공유 커밋(`other_space`)까지 넣어 길이가 어긋났고, 그래서 다중 브랜치 저장소의
     * 커밋 재색인이 전환에 닿지 못했다.
     */
    const RELEASE = 'release';
    await run(origin.dir, ['branch', RELEASE, origin.chain[1] as string]);
    await run(origin.dir, ['checkout', '-q', RELEASE]);
    await writeFile(join(origin.dir, 'release-1.txt'), 'release-1\n', 'utf8');
    await run(origin.dir, ['add', '.']);
    await run(origin.dir, ['commit', '-q', '-m', 'R1 release fix'], { GIT_AUTHOR_DATE: '2026-09-01T06:00:00Z', GIT_COMMITTER_DATE: '2026-09-01T06:00:00Z' });
    const releaseHead = (await run(origin.dir, ['rev-parse', 'HEAD'])).trim();
    await run(origin.dir, ['checkout', '-q', 'main']);
    await repositoryRepo.upsertRepository(pool, {
      repository_id: REPOSITORY_ID,
      owner: OWNER,
      name: NAME,
      org_id: 1,
      visibility: 'internal',
      sequence_branches: [BRANCH, RELEASE],
      mirror_enabled: true,
      status: 'active',
    });
    repository = (await repositoryRepo.findRepositoryById(pool, REPOSITORY_ID)) as RepositoryRow;

    for (const [pr, sha] of origin.squash) await projectPullRequest(pr, sha, 1_000);
    expect((await prepareAndAssignSequence(sequenceDeps(), REPOSITORY_ID, BRANCH)).kind).toBe('done');
    expect((await prepareAndAssignSequence(sequenceDeps(), REPOSITORY_ID, RELEASE)).kind).toBe('done');
    const releaseSpace = await sequenceSpaceRepo.findSequenceSpace(pool, REPOSITORY_ID, RELEASE);
    expect(Number(releaseSpace?.head_seq)).toBe(3); // root · A · R1
    for (const sha of origin.chain) {
      await enrichCommit(enrichDeps(), repository, { commitSha: sha, firstParent: true, pullRequestNumber: [...origin.squash.entries()].find(([, one]) => one === sha)?.[0] ?? null, baseBranch: BRANCH });
    }
    await enrichCommit(enrichDeps(), repository, { commitSha: releaseHead, firstParent: true, pullRequestNumber: null, baseBranch: RELEASE });
    await drainWork();
    const mainBefore = await canonicalSnapshot();

    const { jobId, targetIndex, sourceIndex } = await enqueueReindex(COMMIT_ALIAS);
    try {
      const row = await jobRepo.findJobById(pool, jobId);
      if (row === undefined) throw new Error('잡을 찾지 못했다');
      await runReindexJob({ pool, es, refresh: true, mergeNumberEnabled: false }, row);
      const job = await jobRepo.findJobById(pool, jobId);
      expect(job?.state, job?.error ?? '').toBe('completed');

      // 공유 커밋(root·A)은 replay 순서상 먼저 온 main의 서수를 달고, release 전용 커밋은 release의 서수를 단다.
      expectProjected(await commitDoc(origin.chain[0] as string, targetIndex), 1);
      expectProjected(await commitDoc(origin.chain[1] as string, targetIndex), 2);
      const r1 = await commitDoc(releaseHead, targetIndex);
      expect(r1).toMatchObject({ merge_seq: 3, seq_epoch: 1, base_branch: RELEASE, sequence_space: `${OWNER}/${NAME}@${RELEASE}` });
      // release 공간의 replay 기록은 공유 커밋 둘을 other_space로 접고 R1 하나만 settled로 센다.
      const replay = (job?.progress as { sequence_replay?: { spaces: Record<string, unknown>[] } }).sequence_replay;
      const releaseRecord = replay?.spaces.find((one) => one['base_branch'] === RELEASE);
      expect(releaseRecord).toMatchObject({ seq_epoch: 1, head_seq: 3, settled: 1, unsettled: 0, skipped: 2 });
      // 정본은 두 공간 모두 그대로다.
      expect(await canonicalSnapshot()).toEqual(mainBefore);
      expect(Number((await sequenceSpaceRepo.findSequenceSpace(pool, REPOSITORY_ID, RELEASE))?.head_seq)).toBe(3);
    } finally {
      await restoreAlias(COMMIT_ALIAS, sourceIndex);
    }
  });

  it('**shadow(target) 쓰기가 던지면 replay 기록이 그 공간을 unsettled로 세고 잡은 실패한다** — active 성공이 shadow 실패를 덮지 않는다 (독립 리뷰 지적)', async () => {
    for (const [pr, sha] of origin.squash) await projectPullRequest(pr, sha, 1_000);
    await assign();
    await drainWork();

    const { jobId, targetIndex, sourceIndex } = await enqueueReindex(PR_ALIAS);
    try {
      // target 인덱스에 대한 사전 읽기(mget)만 죽는 ES — 서비스 별칭 쪽 투영은 그대로 성공한다.
      const flaky = new Proxy(es, {
        get(target, property: string | symbol) {
          if (property === 'mget') {
            return async (params: { index?: string }): Promise<unknown> => {
              if (params.index === targetIndex) throw new Error('injected_shadow_failure');
              return es.mget(params as never);
            };
          }
          return Reflect.get(target, property) as unknown;
        },
      }) as Client;
      const row = await jobRepo.findJobById(pool, jobId);
      if (row === undefined) throw new Error('잡을 찾지 못했다');
      await runReindexJob({ pool, es: flaky, refresh: true, mergeNumberEnabled: false }, row);

      const job = await jobRepo.findJobById(pool, jobId);
      // 울타리가 shadow 실패를 잡 실패로 만들고 별칭은 옮겨지지 않는다.
      expect(job?.state).toBe('failed');
      expect(job?.error).toBe('shadow_write_failed');
      expect(await resolveServingIndex(es, PR_ALIAS)).toBe(sourceIndex);
      // replay 기록은 서비스 결과로 물러서지 않는다 — target에 쓰지 못한 넷 전부가 unsettled다.
      const replay = (job?.progress as { sequence_replay?: { spaces: Record<string, unknown>[] } }).sequence_replay;
      expect(replay?.spaces[0]).toMatchObject({ base_branch: BRANCH, settled: 0, unsettled: 4 });
    } finally {
      await restoreAlias(PR_ALIAS, sourceIndex);
    }
  });
});

/*
 * `EVENT_NAMES`는 fixture 이벤트 이름을 문서화하려고만 참조한다 — 이 시험은 버스를
 * 세우지 않는다(채번 뒤 이벤트는 `fakeBus`가 버린다).
 */
void EVENT_NAMES;
