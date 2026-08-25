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
import { MirrorCommitGraph, MirrorSync, type CommitGraph, type RepoRef } from '@prs/github';
import { jobRepo, mergeSequenceRepo, repositoryRepo, sequenceSpaceRepo, type Pool } from '@prs/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { migratedPool } from '../../../../packages/db/integration/helpers.js';
import { reassignSequence, repairSequence, type RepairOutcome, type SequenceDeps } from '../../src/sequence.js';
import { runRepairJob, parseRepairTarget } from '../../src/sequence-repair-runner.js';
import { createWorkerMetrics } from '../../src/metrics.js';
import {
  appendCommit,
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


  /**
   * 커밋 직전 head 울타리·관측 가능한 `reassigning`·`stale` 영속·이벤트 대칭
   * (CR-037, DEV-192·197·198·199).
   *
   * 실행: `pnpm test:integration pipeline-worker/integration/sequence/repair`
   */
  describe('수동 복구의 울타리와 부수 효과 (CR-037)', () => {
    /** 특정 호출 시점에 끼어드는 그래프 데코레이터. */
    class StagedGraph implements CommitGraph {
      readonly kind: CommitGraph['kind'];
      constructor(
        private readonly inner: CommitGraph,
        private readonly hooks: {
          afterRevList?: () => Promise<void>;
          beforeFirstParentCommits?: () => Promise<void>;
        },
      ) {
        this.kind = inner.kind;
      }
      resolveHead(ref: RepoRef, branch: string): Promise<string | null> {
        return this.inner.resolveHead(ref, branch);
      }
      isAncestor(ref: RepoRef, a: string, b: string): Promise<boolean> {
        return this.inner.isAncestor(ref, a, b);
      }
      mergeBase(ref: RepoRef, a: string, b: string): Promise<string | null> {
        return this.inner.mergeBase(ref, a, b);
      }
      patchId(...args: Parameters<CommitGraph['patchId']>): ReturnType<CommitGraph['patchId']> {
        return this.inner.patchId(...args);
      }
      readCommit(...args: Parameters<CommitGraph['readCommit']>): ReturnType<CommitGraph['readCommit']> {
        return this.inner.readCommit(...args);
      }
      changedPaths(...args: Parameters<CommitGraph['changedPaths']>): ReturnType<CommitGraph['changedPaths']> {
        return this.inner.changedPaths(...args);
      }
      async firstParentRevList(ref: RepoRef, range: Parameters<CommitGraph['firstParentRevList']>[1]): Promise<readonly string[]> {
        const result = await this.inner.firstParentRevList(ref, range);
        if (this.hooks.afterRevList !== undefined) await this.hooks.afterRevList();
        return result;
      }
      async firstParentCommits(
        ref: RepoRef,
        range: Parameters<CommitGraph['firstParentCommits']>[1],
      ): Promise<readonly { readonly sha: string; readonly committedAt: string }[]> {
        if (this.hooks.beforeFirstParentCommits !== undefined) await this.hooks.beforeFirstParentCommits();
        return this.inner.firstParentCommits(ref, range);
      }
    }

    function stagedDeps(
      hooks: ConstructorParameters<typeof StagedGraph>[1],
      published: unknown[] = [],
    ): SequenceDeps {
      const base = deps();
      return {
        ...base,
        bus: {
          publish: (_topic: string, _key: string, event: unknown) => {
            published.push(event);
            return Promise.resolve();
          },
        } as unknown as SequenceDeps['bus'],
        graphFor: (): CommitGraph =>
          new StagedGraph(
            new MirrorCommitGraph({ root: mirrorRoot, repositoryIdOf: () => REPOSITORY_ID }),
            hooks,
          ),
      };
    }

    async function spaceRow(): Promise<{ state: string; head_sha: string | null; head_seq: number; seq_epoch: number; last_error: string | null }> {
      const result = await pool.query<{ state: string; head_sha: string | null; head_seq: string; seq_epoch: string; last_error: string | null }>(
        'SELECT state, head_sha, head_seq, seq_epoch, last_error FROM sequence_space WHERE repository_id = $1 AND base_branch = $2',
        [REPOSITORY_ID, BRANCH],
      );
      const row = result.rows[0]!;
      return { ...row, head_seq: Number(row.head_seq), seq_epoch: Number(row.seq_epoch) };
    }

    /**
     * **지금 git이 가진 체인**으로 씨를 뿌린다.
     *
     * 이 describe의 첫 시험이 origin에 커밋을 더하므로, `beforeAll`에서 잡아 둔
     * `actual`을 쓰면 뒤 시험이 실행 순서에 묶인다. 매번 실측한다.
     */
    async function seedLiveWithCorruptionAt(seq: number): Promise<readonly string[]> {
      const chain = await firstParentOf(origin.dir, BRANCH);
      for (const [index, sha] of chain.entries()) {
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
      await sequenceSpaceRepo.advanceHead(pool, REPOSITORY_ID, BRANCH, chain.at(-1) ?? '', chain.length);
      return chain;
    }

    beforeEach(async () => {
      await pool.query('DELETE FROM merge_sequence WHERE repository_id = $1', [REPOSITORY_ID]);
      await pool.query('DELETE FROM job');
      await sequenceSpaceRepo.ensureSequenceSpace(pool, REPOSITORY_ID, BRANCH);
      await pool.query(
        "UPDATE sequence_space SET state = 'ok', head_seq = 0, seq_epoch = 1, head_sha = NULL, last_error = NULL WHERE repository_id = $1",
        [REPOSITORY_ID],
      );
    });

    it('**분석 중 head가 전진하면 커밋하지 않는다 — 그리고 재시도가 E까지 고친다** (DEV-192)', async () => {
      await seedLiveWithCorruptionAt(3);
      const before = await spaceRow();
      const repository = (await repositoryRepo.findRepositoryBySlug(pool, OWNER, NAME))!;

      /*
       * 분석 walk가 끝난 직후 origin에 커밋 하나를 더 얹고 미러를 다시 맞춘다 —
       * 채번이 D→E로 전진한 상황 그대로다. 울타리가 없으면 옛 head `D`가 커밋되어
       * **head가 뒤로 가고 `E`가 누락된다.**
       */
      let advanced = false;
      const first = await repairSequence(
        stagedDeps({
          afterRevList: async (): Promise<void> => {
            if (advanced) return;
            advanced = true;
            await appendCommit(origin.dir, 'moving-head-e');
            await new MirrorSync({ root: mirrorRoot, remoteUrl: () => origin.url }).sync(
              { owner: OWNER, repo: NAME },
              REPOSITORY_ID,
            );
          },
        }),
        repository,
        BRANCH,
      );

      expect(first.kind).toBe('skipped');
      if (first.kind === 'skipped') expect(first.reason).toBe('head_moved');

      // 아무것도 커밋되지 않았다 — 에폭도 head도 그대로다.
      const after = await spaceRow();
      expect(after.seq_epoch).toBe(before.seq_epoch);
      expect(after.head_sha).toBe(before.head_sha);
      expect(after.head_seq).toBe(before.head_seq);
      // 표시를 되돌렸다 — 아무것도 하지 않은 공간이 "재채번 중"으로 남지 않는다.
      expect(after.state).toBe('ok');

      // ---- 재시도: 이제 E까지 보고 고친다.
      const retry = await repairSequence(deps(), repository, BRANCH);
      expect(retry.kind).toBe('repaired');

      const chain = await firstParentOf(origin.dir, BRANCH);
      expect(chain).toHaveLength(5);
      const final = await spaceRow();
      expect(final.head_sha).toBe(chain.at(-1));
      expect(final.head_seq).toBe(5);
      expect(final.state).toBe('ok');

      const rows = await storedSequence(final.seq_epoch);
      expect(rows.map((row) => row.sha)).toEqual([...chain]);
    });

    it('일을 마친 직후 취소가 들어오면 최종 상태는 cancelled다 (DEV-196)', async () => {
      await seedLiveWithCorruptionAt(3);
      const repository = (await repositoryRepo.findRepositoryBySlug(pool, OWNER, NAME))!;
      const jobId = await jobRepo.enqueueJob(pool, 'sequence_reassign', `${OWNER}/${NAME}@${BRANCH}`, 'operator-cr037');
      const claimed = await jobRepo.claimNextJob(pool, 'sequence_reassign');
      expect(claimed?.job_id).toBe(jobId);

      /*
       * 실제 일을 마친 **직후, finish 직전**에 취소가 들어온다. 무조건 UPDATE면
       * 여기서 `cancelled`가 `completed`로 덮인다.
       */
      const outcome = await runRepairJob(
        {
          pool,
          sequence: deps(),
          repair: async (): Promise<RepairOutcome> => {
            await pool.query("UPDATE job SET state = 'cancelled' WHERE job_id = $1", [jobId]);
            return { kind: 'consistent', checked: 4 };
          },
        },
        claimed!,
      );

      expect(outcome?.kind).toBe('consistent');
      const state = await jobRepo.findJobState(pool, jobId);
      expect(state).toBe('cancelled');
      expect(repository.repository_id).toBe(REPOSITORY_ID);
    });

    it('시작 전에 취소된 잡은 비가역 복구를 실행하지 않는다 (DEV-196)', async () => {
      await seedLiveWithCorruptionAt(3);
      const jobId = await jobRepo.enqueueJob(pool, 'sequence_reassign', `${OWNER}/${NAME}@${BRANCH}`, 'operator-cr037');
      const claimed = await jobRepo.claimNextJob(pool, 'sequence_reassign');
      await pool.query("UPDATE job SET state = 'cancelled' WHERE job_id = $1", [jobId]);

      let ran = false;
      const outcome = await runRepairJob(
        {
          pool,
          sequence: deps(),
          repair: (): Promise<RepairOutcome> => {
            ran = true;
            return Promise.resolve({ kind: 'consistent', checked: 4 });
          },
        },
        claimed!,
      );

      expect(ran).toBe(false);
      expect(outcome).toBeNull();
      expect(await jobRepo.findJobState(pool, jobId)).toBe('cancelled');
    });

    it('저장된 head가 움직였으면 Git head가 그대로여도 커밋하지 않는다 (DEV-192)', async () => {
      /*
       * 실제 Git head 울타리만으로는 부족하다. 다른 채번이 `sequence_space`의
       * head를 앞세운 뒤 브랜치가 되돌려졌거나 미러가 아직 옛 ref를 보고 있으면,
       * **살아 있는 head는 우리가 분석한 것과 같은데 저장분은 다르다.** 그대로
       * 커밋하면 그 채번 결과를 조용히 버린다.
       */
      const chain = await seedLiveWithCorruptionAt(3);
      const repository = (await repositoryRepo.findRepositoryBySlug(pool, OWNER, NAME))!;
      const other = 'a'.repeat(40);

      let moved = false;
      const outcome = await repairSequence(
        stagedDeps({
          afterRevList: async (): Promise<void> => {
            if (moved) return;
            moved = true;
            // 다른 채번이 head를 앞세운 상황. Git은 건드리지 않는다.
            await pool.query(
              'UPDATE sequence_space SET head_sha = $3 WHERE repository_id = $1 AND base_branch = $2',
              [REPOSITORY_ID, BRANCH, other],
            );
          },
        }),
        repository,
        BRANCH,
      );

      expect(outcome.kind).toBe('skipped');
      if (outcome.kind === 'skipped') expect(outcome.reason).toBe('head_moved');

      const after = await spaceRow();
      // 다른 채번이 세운 값을 지우지 않았고, 에폭도 올리지 않았다.
      expect(after.head_sha).toBe(other);
      expect(after.seq_epoch).toBe(1);
      expect(after.state).toBe('ok');
      expect(chain.length).toBeGreaterThan(0);
    });

    it('락을 못 얻으면 남의 `reassigning`을 건드리지 않는다 (DEV-202)', async () => {
      /*
       * 표시를 락보다 **먼저** 세우면, 락 경쟁에서 진 쪽이 이긴 쪽의 표시를 자기
       * 것으로 알고 `ok`로 되돌린다 — 다른 워커가 한창 재구축 중인 공간을 조회가
       * "정상"으로 읽는다. 표시는 락을 잡은 뒤에만 세워야 한다.
       */
      await seedLiveWithCorruptionAt(3);
      const repository = (await repositoryRepo.findRepositoryBySlug(pool, OWNER, NAME))!;

      // 다른 워커가 이미 공간을 쥐고 재구축 중인 상태를 만든다.
      const holder = await pool.connect();
      try {
        await holder.query('BEGIN');
        await holder.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
          `seq:${String(REPOSITORY_ID)}:${BRANCH}`,
        ]);
        await pool.query(
          "UPDATE sequence_space SET state = 'reassigning' WHERE repository_id = $1 AND base_branch = $2",
          [REPOSITORY_ID, BRANCH],
        );

        const outcome = await repairSequence(deps(), repository, BRANCH);
        expect(outcome.kind).toBe('locked');

        // 남의 표시가 그대로 살아 있어야 한다.
        expect((await spaceRow()).state).toBe('reassigning');
      } finally {
        await holder.query('ROLLBACK').catch(() => undefined);
        holder.release();
      }
    });

    it('락을 얻기 전에는 표시를 세우지 않는다 (DEV-202)', async () => {
      /*
       * 락 경쟁에서 지면 우리는 **아무 일도 하지 않는다.** 그런데 표시를 락보다 먼저
       * 세우면 그 사실이 공간에 남고, 되돌릴 주인도 없어 **아무도 재구축하지 않는
       * 공간이 계속 "재채번 중"으로 광고된다.** 조회는 그동안 서수를 믿지 못한다.
       */
      await seedLiveWithCorruptionAt(3);
      const repository = (await repositoryRepo.findRepositoryBySlug(pool, OWNER, NAME))!;
      expect((await spaceRow()).state).toBe('ok');

      const holder = await pool.connect();
      try {
        await holder.query('BEGIN');
        await holder.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
          `seq:${String(REPOSITORY_ID)}:${BRANCH}`,
        ]);

        const outcome = await repairSequence(deps(), repository, BRANCH);
        expect(outcome.kind).toBe('locked');

        // 표시를 세운 적이 없으므로 공간은 출발 상태 그대로다.
        expect((await spaceRow()).state).toBe('ok');
      } finally {
        await holder.query('ROLLBACK').catch(() => undefined);
        holder.release();
      }
    });

    it('재구축이 도는 동안 다른 연결이 `reassigning`을 본다 (DEV-198)', async () => {
      await seedLiveWithCorruptionAt(3);
      const repository = (await repositoryRepo.findRepositoryBySlug(pool, OWNER, NAME))!;

      let observed: string | null = null;
      const outcome = await repairSequence(
        stagedDeps({
          beforeFirstParentCommits: async (): Promise<void> => {
            if (observed !== null) return;
            // **다른 커넥션**이다. 같은 트랜잭션 안에서만 바뀌면 여기서 'ok'가 보인다.
            const result = await pool.query<{ state: string }>(
              'SELECT state FROM sequence_space WHERE repository_id = $1 AND base_branch = $2',
              [REPOSITORY_ID, BRANCH],
            );
            observed = result.rows[0]?.state ?? null;
          },
        }),
        repository,
        BRANCH,
      );

      expect(outcome.kind).toBe('repaired');
      expect(observed).toBe('reassigning');
      // 끝나면 정상으로 돌아온다 — 표시가 고착되지 않는다.
      expect((await spaceRow()).state).toBe('ok');
    });

    it('그래프를 읽지 못하면 `stale`이 실제로 남고 마지막 확정 값은 보존된다 (DEV-199)', async () => {
      await seedLiveWithCorruptionAt(3);
      const before = await spaceRow();
      const repository = (await repositoryRepo.findRepositoryBySlug(pool, OWNER, NAME))!;

      const outcome = await repairSequence(
        stagedDeps({
          beforeFirstParentCommits: (): Promise<void> => Promise.reject(new Error('mirror gone')),
        }),
        repository,
        BRANCH,
      );

      expect(outcome.kind).toBe('stale');

      const after = await spaceRow();
      expect(after.state).toBe('stale');
      expect(after.last_error).not.toBeNull();
      // 읽지 못한 것과 값이 틀린 것은 다르다 — 서수는 지우지 않는다.
      expect(after.head_sha).toBe(before.head_sha);
      expect(after.head_seq).toBe(before.head_seq);
      expect(after.seq_epoch).toBe(before.seq_epoch);
    });

    it('성공한 수동 복구가 EVT-SEQ-002를 발행한다 (DEV-197)', async () => {
      await seedLiveWithCorruptionAt(3);
      const repository = (await repositoryRepo.findRepositoryBySlug(pool, OWNER, NAME))!;
      const published: unknown[] = [];

      const outcome = await repairSequence(stagedDeps({}, published), repository, BRANCH);
      expect(outcome.kind).toBe('repaired');
      if (outcome.kind !== 'repaired') return;

      const reassigned = published.filter(
        (event) => (event as { event_name?: string }).event_name === 'sequence.reassigned',
      );
      expect(reassigned).toHaveLength(1);
      const payload = (reassigned[0] as { payload: Record<string, unknown> }).payload;
      expect(payload['repository_id']).toBe(REPOSITORY_ID);
      expect(payload['base_branch']).toBe(BRANCH);
      expect(payload['old_epoch']).toBe(outcome.oldEpoch);
      expect(payload['new_epoch']).toBe(outcome.newEpoch);
      expect(payload['diverged_at_seq']).toBe(outcome.divergedAtSeq);
    });
  });
});
