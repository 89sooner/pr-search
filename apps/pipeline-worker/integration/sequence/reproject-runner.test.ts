/**
 * 수동 시퀀스 재투영 (JOB-SEQ-006 / CR-113, FR-SEQ-001 AC-8).
 *
 * `sequence_reproject` 잡·`prsctl sequence reproject|status` 명령이 실제 PostgreSQL·
 * Elasticsearch에서 durable work를 거쳐 서수를 되살리는지, 그리고 그 과정에서 **정본을 한 값도
 * 바꾸지 않는지**를 판정한다. dry-run은 PG·ES·작업 큐·감사 기록 어디에도 쓰지 않아야 한다.
 *
 * 격리된 Elasticsearch에서만 돌린다 (`projection.test.ts`와 같은 이유).
 */

import type { Client } from '@elastic/elasticsearch';
import type { EventBus } from '@prs/bus';
import { MirrorCommitGraph, MirrorSync, type CommitGraph } from '@prs/github';
import { jobRepo, mergeSequenceRepo, repositoryRepo, sequenceSpaceRepo, sequenceWorkRepo, withReindexWrite, type Pool, type RepositoryRow } from '@prs/db';
import { applyMappings, bulkUpsert, createEsClient, switchAliasesForTests } from '@prs/es';
import { sequenceSpaceLabel } from '@prs/domain';
import type { IngestionEnriched } from '@prs/domain';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { migratedPool, truncate } from '../../../../packages/db/integration/helpers.js';
import { buildUpsertRequests } from '../../src/documents.js';
import { createWorkerMetrics } from '../../src/metrics.js';
import { prepareAndAssignSequence, repairSequence, type SequenceDeps } from '../../src/sequence.js';
import { runSequenceWorkOnce } from '../../src/sequence-work-runner.js';
import { runSequenceReprojectCommand } from '../../src/sequence-reproject-command.js';
import { REPROJECT_JOB, runReprojectJob } from '../../src/sequence-reproject-runner.js';
import { runRepairJob } from '../../src/sequence-repair-runner.js';
import { linkObservationOf, recordProjectionSnapshot } from '../../src/snapshot.js';
import { makeTempDir, removeDir } from './fixture.js';
import { createSquashFixture, type SquashFixture } from './squash-fixture.js';

const REPOSITORY_ID = 7514;
const OWNER = 'acme';
const NAME = 'reproject-cr113';
const BRANCH = 'main';
const LABEL = sequenceSpaceLabel(`${OWNER}/${NAME}`, BRANCH);
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

function sequenceDeps(): SequenceDeps {
  const graph = new MirrorCommitGraph({ root: mirrorRoot, repositoryIdOf: () => REPOSITORY_ID });
  return {
    pool,
    es,
    bus: fakeBus(),
    metrics: createWorkerMetrics(),
    graphFor: (): CommitGraph => graph,
    freshness: { pool, mode: 'mirror', sync: new MirrorSync({ root: mirrorRoot, remoteUrl: () => origin.url }) },
  };
}

/** durable 러너 한 회차. 재시도 지연은 0에 가깝다. `MNUMBER_ENABLED=false` 구성이다. */
async function workOnce(): Promise<number> {
  const result = await runSequenceWorkOnce({ pool, sequence: sequenceDeps(), mnumber: null, metrics: createWorkerMetrics(), retryMaxMs: 1, random: () => 0.5 });
  return result.claimed;
}

async function drainWork(rounds = 12): Promise<void> {
  for (let round = 0; round < rounds; round += 1) {
    if ((await workOnce()) === 0) {
      const pending = await sequenceWorkRepo.countPendingWork(pool);
      if (!Object.entries(pending).some(([key, count]) => key.startsWith('project:') && !key.endsWith(':parked') && count > 0)) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
}

/** 잡 러너가 기다리는 동안 durable 러너를 함께 돌린다 — 운영에서 두 루프가 한 프로세스에 있는 모양이다. */
function withBackgroundWork<T>(run: () => Promise<T>): Promise<T> {
  let stopped = false;
  const loop = (async (): Promise<void> => {
    while (!stopped) {
      try {
        await workOnce();
      } catch {
        // 시험에서는 삼킨다 — 잡 결과가 말한다.
      }
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
  })();
  return run().finally(async () => {
    stopped = true;
    await loop;
  });
}

function enrichedFor(prNumber: number, mergeSha: string): IngestionEnriched {
  return {
    delivery_id: `delivery-${String(prNumber)}`,
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
      merged: true,
      created_at: '2026-09-01T00:00:00.000Z',
      updated_at: '2026-09-01T00:00:00.000Z',
      closed_at: '2026-09-01T00:00:00.000Z',
      merged_at: origin.mergedAt.get(prNumber) ?? '2026-09-01T00:00:00.000Z',
      merge_commit_sha: mergeSha,
      author: 'dev',
      head_ref: `feature/${String(prNumber)}`,
      head_sha: 'b'.repeat(40),
      base_ref: BRANCH,
      base_sha: 'c'.repeat(40),
      commits_count: 0,
    },
    source_commit_shas: [],
    changed_files: [],
    reviews: [],
    source_commits_truncated: false,
    source_commits_complete: true,
    files_truncated: false,
    enrichment_pending: false,
    enrichment_errors: [],
    correlation_id: '4c1a4d5e-6f70-4a81-92b3-c4d5e6f70819',
  };
}

async function projectPullRequest(prNumber: number, mergeSha: string): Promise<void> {
  const requests = buildUpsertRequests({ enriched: enrichedFor(prNumber, mergeSha), repository, documentVersion: 1_000, indexedAt: new Date(), authorTeams: { kind: 'unknown' } });
  await recordProjectionSnapshot(pool, requests, {
    repositoryId: REPOSITORY_ID,
    prNumber,
    source: 'webhook',
    linkObservation: linkObservationOf(enrichedFor(prNumber, mergeSha), 1_000),
  });
  await withReindexWrite(pool, async (targets) => {
    const result = await bulkUpsert(es, requests, targets);
    if (result.outcomes.some((one) => one.kind !== 'ok')) throw new Error('PR 투영 실패');
  });
}

async function prDoc(prNumber: number): Promise<Record<string, unknown> | undefined> {
  await es.indices.refresh({ index: PR_ALIAS });
  try {
    return (await es.get<Record<string, unknown>>({ index: PR_ALIAS, id: `${String(REPOSITORY_ID)}:${String(prNumber)}`, routing: String(REPOSITORY_ID) }))._source;
  } catch (error) {
    if ((error as { statusCode?: number }).statusCode === 404) return undefined;
    throw error;
  }
}

/** 서수 필드만 비운다 — 운영에서 재색인·수동 update_by_query가 남긴 상태. */
async function stripSequenceFields(prNumber: number): Promise<void> {
  await es.update({
    index: PR_ALIAS,
    id: `${String(REPOSITORY_ID)}:${String(prNumber)}`,
    routing: String(REPOSITORY_ID),
    refresh: true,
    script: { lang: 'painless', source: 'ctx._source.remove("merge_seq"); ctx._source.remove("seq_epoch"); ctx._source.remove("sequence_space");' },
  });
}

async function canonicalSnapshot(): Promise<Record<string, unknown>> {
  const space = await sequenceSpaceRepo.findSequenceSpace(pool, REPOSITORY_ID, BRANCH);
  if (space === undefined) throw new Error('공간이 없다');
  const rows = await mergeSequenceRepo.findRange(pool, REPOSITORY_ID, BRANCH, space.seq_epoch, 0, Number(space.head_seq));
  return { epoch: space.seq_epoch, headSha: space.head_sha, headSeq: Number(space.head_seq), rows: rows.map((row) => [row.commit_sha, Number(row.merge_seq), row.pull_request_number, row.merge_number]) };
}

async function auditRows(): Promise<{ action: string; target: string | null; result_code: string; user_id: string }[]> {
  const result = await pool.query<{ action: string; target: string | null; result_code: string; user_id: string }>(
    "SELECT action, target, result_code, user_id FROM audit_record WHERE target LIKE 'sequence_reproject:%' ORDER BY occurred_at",
  );
  return result.rows;
}

function commandDeps(): { deps: Parameters<typeof runSequenceReprojectCommand>[1]; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return { deps: { pool, es, out: (line) => out.push(line), err: (line) => err.push(line), sleep: async () => undefined }, out, err };
}

beforeAll(async () => {
  pool = await migratedPool();
  es = createEsClient();
  const info = await es.info();
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
  await truncate(pool, 'sequence_latency_sample', 'sequence_work', 'mnumber_evidence', 'merge_sequence', 'sequence_space', 'pull_request_snapshot', 'commit_snapshot', 'repository');
  await pool.query('DELETE FROM job WHERE type IN ($1, $2)', [REPROJECT_JOB, 'sequence_reassign']);
  await pool.query("DELETE FROM audit_record WHERE target LIKE 'sequence_reproject:%'");
  await es.indices.refresh({ index: [PR_ALIAS, COMMIT_ALIAS] });
  await es.deleteByQuery({ index: [PR_ALIAS, COMMIT_ALIAS], query: { match_all: {} }, refresh: true, conflicts: 'proceed' });

  origin = await createSquashFixture();
  mirrorRoot = await makeTempDir('prs-reproject-mirror-');
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
  repository = (await repositoryRepo.findRepositoryById(pool, REPOSITORY_ID)) as RepositoryRow;

  // 정상 상태: PR 넷이 투영되고 채번되고 서수가 색인에 있다.
  for (const [pr, sha] of origin.squash) await projectPullRequest(pr, sha);
  expect((await prepareAndAssignSequence(sequenceDeps(), REPOSITORY_ID, BRANCH)).kind).toBe('done');
  await drainWork();
  for (const pr of origin.squash.keys()) expect((await prDoc(pr))?.['merge_seq']).toBeTypeOf('number');
}, 60_000);

afterEach(async () => {
  await removeDir(origin.dir);
  await removeDir(mirrorRoot);
});

describe('sequence_reproject 잡 (JOB-SEQ-006)', () => {
  it('**기존 번호를 바꾸지 않고 누락된 서수를 되살린다** — 잡은 durable work를 예약하고 완료를 기다린다', async () => {
    const before = await canonicalSnapshot();
    await stripSequenceFields(21);
    await stripSequenceFields(27);

    const jobId = await jobRepo.enqueueJob(pool, REPROJECT_JOB, LABEL, 'operator-cr113', { expected_epoch: 1, aliases: [PR_ALIAS] });
    const claimed = await jobRepo.claimNextJob(pool, REPROJECT_JOB);
    expect(claimed?.job_id).toBe(jobId);

    const outcome = await withBackgroundWork(() => runReprojectJob({ pool, waitMs: 20_000, watchMs: 30 }, claimed!));
    expect(outcome).toBe('completed');

    const job = await jobRepo.findJobById(pool, jobId);
    expect(job?.state).toBe('completed');
    expect(job?.progress).toMatchObject({ projection: 'completed', pending_documents: 0, expected_epoch: 1, work_state: 'done' });
    expect(String((job?.progress as { work_key?: string }).work_key)).toBe(`project:${JSON.stringify([REPOSITORY_ID, BRANCH, 1, 'full'])}`);
    const seqOf = new Map((before['rows'] as [string, number][]).map(([sha, seq]) => [sha, seq]));
    for (const [pr, sha] of origin.squash) {
      expect(await prDoc(pr)).toMatchObject({ merge_seq: seqOf.get(sha), seq_epoch: 1, sequence_space: LABEL });
    }
    // 정본은 한 값도 바뀌지 않았다 — 재투영은 재채번이 아니다.
    expect(await canonicalSnapshot()).toEqual(before);
  });

  it('**expected_epoch가 다르면 아무것도 예약하지 않고 실패한다**', async () => {
    const jobId = await jobRepo.enqueueJob(pool, REPROJECT_JOB, LABEL, 'operator-cr113', { expected_epoch: 2, aliases: [PR_ALIAS] });
    const claimed = await jobRepo.claimNextJob(pool, REPROJECT_JOB);
    expect(await runReprojectJob({ pool, waitMs: 1_000, watchMs: 10 }, claimed!)).toBe('rejected');
    const job = await jobRepo.findJobById(pool, jobId);
    expect(job?.state).toBe('failed');
    expect(job?.error).toContain('epoch_mismatch');
    const works = await sequenceWorkRepo.listWorkForSpace(pool, REPOSITORY_ID, BRANCH, ['project']);
    expect(works.filter((row) => (row.payload as { trigger_kind?: string }).trigger_kind === 'operator_reproject')).toEqual([]);
  });

  it('**반복 실행은 멱등이다** — 두 번째 잡은 noop만 세고 문서는 같다', async () => {
    const run = async (): Promise<Record<string, unknown>> => {
      const jobId = await jobRepo.enqueueJob(pool, REPROJECT_JOB, LABEL, 'operator-cr113', { expected_epoch: 1 });
      const claimed = await jobRepo.claimNextJob(pool, REPROJECT_JOB);
      await withBackgroundWork(() => runReprojectJob({ pool, waitMs: 20_000, watchMs: 30 }, claimed!));
      const job = await jobRepo.findJobById(pool, jobId);
      expect(job?.state).toBe('completed');
      return job?.progress ?? {};
    };
    await run();
    const docs = await Promise.all([...origin.squash.keys()].map((pr) => prDoc(pr)));
    const second = await run();
    expect(await Promise.all([...origin.squash.keys()].map((pr) => prDoc(pr)))).toEqual(docs);
    expect((second['counts'] as Record<string, number>)['settled']).toBeGreaterThan(0);
    expect((second['counts'] as Record<string, number>)['pending'] ?? 0).toBe(0);
  });

  it('**같은 공간에 활성 재투영 잡이 둘 생기지 않는다** (FR-ADMIN-002 AC-4)', async () => {
    await jobRepo.enqueueJob(pool, REPROJECT_JOB, LABEL, 'operator-cr113', { expected_epoch: 1 });
    await expect(jobRepo.enqueueJob(pool, REPROJECT_JOB, LABEL, 'operator-cr113', { expected_epoch: 1 })).rejects.toMatchObject({ code: '23505' });
  });
});

describe('prsctl sequence 명령', () => {
  it('**dry-run은 PG·ES·작업 큐·감사 기록 어디에도 쓰지 않고 썼을 것만 센다**', async () => {
    const before = await canonicalSnapshot();
    await stripSequenceFields(25);
    const worksBefore = await sequenceWorkRepo.listWorkForSpace(pool, REPOSITORY_ID, BRANCH);

    const { deps, out, err } = commandDeps();
    const exit = await runSequenceReprojectCommand(['reproject', '--repository', `${OWNER}/${NAME}`, '--base-branch', BRANCH, '--expected-epoch', '1', '--alias', PR_ALIAS, '--dry-run', '--actor', 'tester'], deps);
    expect(exit, err.join('\n')).toBe(0);
    expect(out.some((line) => line.includes('would_update=1'))).toBe(true);
    expect(out.some((line) => line.includes('already_current=3'))).toBe(true);

    expect((await prDoc(25))?.['merge_seq']).toBeUndefined();
    expect(await sequenceWorkRepo.listWorkForSpace(pool, REPOSITORY_ID, BRANCH)).toEqual(worksBefore);
    expect(await jobRepo.listJobs(pool, { type: REPROJECT_JOB })).toEqual([]);
    expect(await auditRows()).toEqual([]);
    expect(await canonicalSnapshot()).toEqual(before);
  });

  it('**실제 실행은 잡을 만들고 감사 `job.run`을 남기며 완료까지 기다린다**', async () => {
    await stripSequenceFields(29);
    const { deps, out, err } = commandDeps();
    const exit = await withBackgroundWork(async () => {
      // 잡 러너도 함께 돈다 — 운영의 worker-sequence 프로세스 모양이다.
      const runnerLoop = (async (): Promise<void> => {
        for (let round = 0; round < 200; round += 1) {
          const claimed = await jobRepo.claimNextJob(pool, REPROJECT_JOB);
          if (claimed !== undefined) {
            await runReprojectJob({ pool, waitMs: 20_000, watchMs: 30 }, claimed);
            return;
          }
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
      })();
      const code = await runSequenceReprojectCommand(['reproject', '--repository', `${OWNER}/${NAME}`, '--base-branch', BRANCH, '--expected-epoch', '1', '--wait-seconds', '30', '--actor', 'tester'], deps);
      await runnerLoop;
      return code;
    });
    expect(exit, err.join('\n')).toBe(0);
    expect(out.some((line) => line.includes('재투영 잡을 만들었다'))).toBe(true);
    expect((await prDoc(29))?.['merge_seq']).toBeTypeOf('number');
    const audit = await auditRows();
    expect(audit).toEqual([{ action: 'job.run', target: `sequence_reproject:${LABEL}`, result_code: 'created', user_id: 'prsctl:tester' }]);
    const jobs = await jobRepo.listJobs(pool, { type: REPROJECT_JOB });
    expect(jobs[0]).toMatchObject({ state: 'completed', requested_by: 'prsctl:tester' });
  });

  it('**status는 에폭·잡·work를 읽기만 한다**', async () => {
    const { deps, out } = commandDeps();
    expect(await runSequenceReprojectCommand(['status', '--repository', `${OWNER}/${NAME}`, '--base-branch', BRANCH], deps)).toBe(0);
    expect(out[0]).toContain('seq_epoch=1');
    expect(out[0]).toContain('head_seq=6');
  });
});

describe('sequence_reassign이 consistent일 때 (FR-ADMIN-003 AC-6)', () => {
  it('**DB 정합과 ES 복구를 다른 결과로 보고하고 에폭을 올리지 않는다**', async () => {
    const before = await canonicalSnapshot();
    await stripSequenceFields(21);
    const jobId = await jobRepo.enqueueJob(pool, 'sequence_reassign', LABEL, 'operator-cr113');
    const claimed = await jobRepo.claimNextJob(pool, 'sequence_reassign');
    const outcome = await withBackgroundWork(() => runRepairJob({ pool, sequence: sequenceDeps(), projectionWaitMs: 20_000, projectionWatchMs: 30 }, claimed!));
    expect(outcome?.kind).toBe('consistent');
    const job = await jobRepo.findJobById(pool, jobId);
    expect(job?.state).toBe('completed');
    expect(job?.progress).toMatchObject({ db: 'consistent', projection: 'completed', pending_documents: 0 });
    expect((await prDoc(21))?.['merge_seq']).toBeTypeOf('number');
    expect(await canonicalSnapshot()).toEqual(before);
    // 직접 부른 복구도 같은 모양을 돌려준다.
    const direct = await repairSequence(sequenceDeps(), repository, BRANCH);
    expect(direct.kind).toBe('consistent');
  });
});
