/**
 * 수동 정합성 복구 (JOB-SEQ-002 수동 경로 / CR-034, DEV-182).
 *
 * **실제 git 저장소와 대조한다.** 이 파일의 핵심 픽스처는 자동 재작성 복구가
 * 구조적으로 고칠 수 없는 자리다:
 *
 * ```
 * 실제 first-parent:   1 c1   2 c2   3 c3(merge)   4 c4
 * 저장된 현재 에폭:     1 c1   2 c2   3 XXXX        4 c4
 * ```
 *
 * `storedHead == actualHead == c4`이므로 `reassignSequence`는
 * `mergeBase(c4, c4) = c4`를 검증 지점으로 보고 **손상 구간을 통째로 복사한 뒤
 * 다시 계산할 커밋이 0건**이 된다 — 손상이 그대로 살아남고 에폭만 오른다.
 *
 * 검증: `pnpm test:integration pipeline-worker/integration/sequence/repair`
 */

import type { Client } from '@elastic/elasticsearch';
import type { EventBus } from '@prs/bus';
import { MirrorCommitGraph, MirrorSync, type CommitGraph } from '@prs/github';
import { jobRepo, mergeSequenceRepo, repositoryRepo, sequenceSpaceRepo, type Pool } from '@prs/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { migratedPool } from '../../../../packages/db/integration/helpers.js';
import { reassignSequence, repairSequence, type SequenceDeps } from '../../src/sequence.js';
import { runRepairJob, parseRepairTarget } from '../../src/sequence-repair-runner.js';
import { createWorkerMetrics } from '../../src/metrics.js';
import {
  createSequenceFixture,
  firstParentOf,
  makeTempDir,
  removeDir,
  type SequenceFixture,
} from './fixture.js';

const REPOSITORY_ID = 4402;
const OWNER = 'acme';
const NAME = 'repair-wp028';
const BRANCH = 'main';
const CORRUPT_SHA = 'f'.repeat(40);

let pool: Pool;
let origin: SequenceFixture;
let mirrorRoot: string;
/** git이 낸 정답지. 오래된 것부터다. */
let actual: readonly string[];

function deps(): SequenceDeps {
  return {
    pool,
    es: {
      search: () => Promise.resolve({ hits: { hits: [] } }),
      updateByQuery: () => Promise.resolve({ updated: 0 }),
    } as unknown as Client,
    bus: { publish: () => Promise.resolve() } as unknown as EventBus,
    metrics: createWorkerMetrics(),
    graphFor: (): CommitGraph =>
      new MirrorCommitGraph({ root: mirrorRoot, repositoryIdOf: () => REPOSITORY_ID }),
  };
}

async function storedSequence(epoch: number): Promise<readonly { seq: number; sha: string }[]> {
  const result = await pool.query<{ merge_seq: string; commit_sha: string }>(
    `SELECT merge_seq, commit_sha FROM merge_sequence
      WHERE repository_id = $1 AND base_branch = $2 AND seq_epoch = $3 ORDER BY merge_seq`,
    [REPOSITORY_ID, BRANCH, epoch],
  );
  return result.rows.map((row) => ({ seq: Number(row.merge_seq), sha: row.commit_sha }));
}

/** 실제 체인을 그대로 채번한 뒤 한 지점만 손상시킨다. */
async function seedWithCorruptionAt(seq: number | null): Promise<void> {
  for (const [index, sha] of actual.entries()) {
    await mergeSequenceRepo.upsertMergeSequence(pool, {
      repository_id: REPOSITORY_ID,
      base_branch: BRANCH,
      seq_epoch: 1,
      merge_seq: index + 1,
      commit_sha: index + 1 === seq ? CORRUPT_SHA : sha,
      pull_request_number: null,
      committed_at: new Date('2026-08-01T00:00:00Z'),
    });
  }
  await sequenceSpaceRepo.advanceHead(pool, REPOSITORY_ID, BRANCH, actual.at(-1) ?? '', actual.length);
}

describe('수동 정합성 복구 (CR-034, DEV-182)', () => {
  beforeAll(async () => {
    pool = await migratedPool();
    origin = await createSequenceFixture();
    mirrorRoot = await makeTempDir('prs-repair-mirror-');
    await new MirrorSync({ root: mirrorRoot, remoteUrl: () => origin.url }).sync(
      { owner: OWNER, repo: NAME },
      REPOSITORY_ID,
    );
    actual = await firstParentOf(origin.dir, BRANCH);
    expect(actual).toHaveLength(4);

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
  }, 180_000);

  afterAll(async () => {
    await pool?.end();
    if (origin !== undefined) await removeDir(origin.dir);
    if (mirrorRoot !== undefined) await removeDir(mirrorRoot);
  });

  beforeEach(async () => {
    await pool.query('DELETE FROM merge_sequence WHERE repository_id = $1', [REPOSITORY_ID]);
    await pool.query('DELETE FROM job');
    await sequenceSpaceRepo.ensureSequenceSpace(pool, REPOSITORY_ID, BRANCH);
    await pool.query(
      "UPDATE sequence_space SET state = 'ok', head_seq = 0, seq_epoch = 1, head_sha = NULL WHERE repository_id = $1",
      [REPOSITORY_ID],
    );
  });

  it('**head가 그대로인 중간 손상을 실제 git 체인과 같게 고친다**', async () => {
    await seedWithCorruptionAt(3);

    const outcome = await repairSequence(deps(), (await repositoryRepo.findRepositoryBySlug(pool, OWNER, NAME))!, BRANCH);
    expect(outcome.kind).toBe('repaired');
    if (outcome.kind !== 'repaired') return;
    expect(outcome.divergedAtSeq).toBe(3);
    expect(outcome.newEpoch).toBe(2);
    expect(outcome.toSeq).toBe(4);

    // git이 낸 답과 정확히 같아야 한다.
    expect(await storedSequence(2)).toEqual(actual.map((sha, index) => ({ seq: index + 1, sha })));

    const space = await sequenceSpaceRepo.findSequenceSpace(pool, REPOSITORY_ID, BRANCH);
    expect(space?.head_sha).toBe(actual.at(-1));
    expect(Number(space?.head_seq)).toBe(4);
  });

  it('**자동 재작성 경로는 같은 손상을 고치지 못한다** — 그래서 수동 경로가 따로 있다', async () => {
    await seedWithCorruptionAt(3);
    const head = actual.at(-1) ?? '';
    const repository = (await repositoryRepo.findRepositoryBySlug(pool, OWNER, NAME))!;

    // storedHead == newHead == 실제 head. 자동 경로가 다루도록 만들어진 모양이 아니다.
    await reassignSequence(deps(), repository, BRANCH, head, head);

    const after = await storedSequence(2);
    // 손상이 새 에폭에 그대로 복사된다 — 이것이 DEV-182의 근거다.
    expect(after.find((row) => row.seq === 3)?.sha).toBe(CORRUPT_SHA);
  });

  it('서수 1부터 어긋나면 전체를 다시 건다', async () => {
    await seedWithCorruptionAt(1);
    const outcome = await repairSequence(deps(), (await repositoryRepo.findRepositoryBySlug(pool, OWNER, NAME))!, BRANCH);
    expect(outcome.kind === 'repaired' && outcome.divergedAtSeq).toBe(1);
    expect(await storedSequence(2)).toEqual(actual.map((sha, index) => ({ seq: index + 1, sha })));
  });

  it('**실행 시점에 다시 읽는다** — 이미 일치하면 에폭을 올리지 않는다', async () => {
    await seedWithCorruptionAt(null);
    const outcome = await repairSequence(deps(), (await repositoryRepo.findRepositoryBySlug(pool, OWNER, NAME))!, BRANCH);
    expect(outcome).toEqual({ kind: 'consistent', checked: 4 });
    const space = await sequenceSpaceRepo.findSequenceSpace(pool, REPOSITORY_ID, BRANCH);
    expect(space?.seq_epoch).toBe(1);
  });

  it('저장분이 실제보다 길면 새 head_seq가 실제 길이에 맞는다', async () => {
    await seedWithCorruptionAt(null);
    // 실제에 없는 서수 5를 덧붙인다 — 히스토리가 짧아진 모양이다.
    await mergeSequenceRepo.upsertMergeSequence(pool, {
      repository_id: REPOSITORY_ID,
      base_branch: BRANCH,
      seq_epoch: 1,
      merge_seq: 5,
      commit_sha: CORRUPT_SHA,
      pull_request_number: null,
      committed_at: new Date('2026-08-01T00:00:00Z'),
    });
    await sequenceSpaceRepo.advanceHead(pool, REPOSITORY_ID, BRANCH, actual.at(-1) ?? '', 5);

    const outcome = await repairSequence(deps(), (await repositoryRepo.findRepositoryBySlug(pool, OWNER, NAME))!, BRANCH);
    expect(outcome.kind).toBe('repaired');
    if (outcome.kind !== 'repaired') return;
    expect(outcome.divergedAtSeq).toBe(5);
    expect(outcome.toSeq).toBe(4);
    expect(await storedSequence(2)).toEqual(actual.map((sha, index) => ({ seq: index + 1, sha })));
  });

describe('재채번 러너가 큐를 비운다 (CR-034, DEV-178)', () => {
  it('target을 가른다', () => {
    expect(parseRepairTarget('acme/payments@main')).toEqual({
      owner: 'acme',
      name: 'payments',
      baseBranch: 'main',
    });
    expect(parseRepairTarget('acme/payments@release/2026.08')?.baseBranch).toBe('release/2026.08');
    expect(parseRepairTarget('acme/payments')).toBeNull();
  });

  it('**queued 잡을 집어 completed로 닫는다** — 영구 queued를 남기지 않는다', async () => {
    await seedWithCorruptionAt(3);
    const jobId = await jobRepo.enqueueJob(pool, 'sequence_reassign', `${OWNER}/${NAME}@${BRANCH}`, 'tester');
    const claimed = await jobRepo.claimNextJob(pool, 'sequence_reassign');
    expect(claimed?.job_id).toBe(jobId);
    if (claimed === undefined) return;

    const outcome = await runRepairJob({ pool, sequence: deps() }, claimed);
    expect(outcome?.kind).toBe('repaired');
    expect((await jobRepo.findJobById(pool, jobId))?.state).toBe('completed');
    // 잡이 닫혔으므로 다음 요청이 JOB_CONFLICT로 막히지 않는다.
    expect(await jobRepo.findActiveJob(pool, 'sequence_reassign', `${OWNER}/${NAME}@${BRANCH}`)).toBeUndefined();
  });

  it('이미 일치하면 completed다 — 없는 문제를 실패로 적지 않는다', async () => {
    await seedWithCorruptionAt(null);
    const jobId = await jobRepo.enqueueJob(pool, 'sequence_reassign', `${OWNER}/${NAME}@${BRANCH}`, 'tester');
    const claimed = await jobRepo.claimNextJob(pool, 'sequence_reassign');
    if (claimed === undefined) throw new Error('claim 실패');
    const outcome = await runRepairJob({ pool, sequence: deps() }, claimed);
    expect(outcome?.kind).toBe('consistent');
    expect((await jobRepo.findJobById(pool, jobId))?.state).toBe('completed');
  });

  it('등록되지 않은 저장소는 failed로 닫는다', async () => {
    const jobId = await jobRepo.enqueueJob(pool, 'sequence_reassign', 'acme/none@main', 'tester');
    const claimed = await jobRepo.claimNextJob(pool, 'sequence_reassign');
    if (claimed === undefined) throw new Error('claim 실패');
    await runRepairJob({ pool, sequence: deps() }, claimed);
    expect((await jobRepo.findJobById(pool, jobId))?.state).toBe('failed');
  });
});
});
