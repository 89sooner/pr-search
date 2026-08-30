/**
 * 수동 시퀀스 채번이 실제로 실행된다 (JOB-SEQ-001 / FR-ADMIN-002 AC-6, WP-040 / CR-055).
 *
 * **실제 git 저장소와 실제 PostgreSQL을 쓴다.** 러너를 대역으로 세우면 "잡이
 * 종료 상태에 갔다"까지만 재고, 그 잡이 **정말 채번을 했는지**는 재지 못한다 —
 * 이 파일은 잡 하나가 `merge_sequence` 행을 만들고 그 순서가 `git rev-list
 * --first-parent --reverse`와 같다는 것까지 본다.
 *
 * ## 이 파일이 반증하는 결함
 *
 * 1. **유령 잡** — `DEV-430`이 그 상태였다. 잡 유형이 있다는 것과 실행 가능한
 *    잡이라는 것은 다르고, `job_type_chk`에 이름만 있으면 운영자는 누른 뒤
 *    영원히 `queued`를 본다.
 * 2. **두 번째 채번 구현** — 러너가 자기만의 "간단한 채번"을 가지면 버스
 *    경로와 갈라진다. 기본 이음매가 `assignSequence`여야 하고, 이 파일은 그
 *    기본값으로 돈다.
 * 3. **덮이는 취소** — 채번이 도는 동안 취소된 잡을 `completed`로 덮으면
 *    화면이 되돌려진 취소를 성공으로 보인다.
 * 4. **잘못 읽은 대상** — `target`을 러너마다 파싱하면 한쪽만 고쳐지는 날
 *    오류 없이 다른 시퀀스 공간을 가리킨다. 브랜치 이름에 `@`가 들어갈 수
 *    있다는 것이 그 함정이다.
 *
 * 실행: `pnpm run test:integration sequence/assign-runner`
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Client } from '@elastic/elasticsearch';
import type { EventBus } from '@prs/bus';
import { MirrorCommitGraph, MirrorSync, type CommitGraph } from '@prs/github';
import { jobRepo, repositoryRepo, type Pool } from '@prs/db';
import { sequenceSpaceLabel } from '@prs/domain';
import { migratedPool, truncate } from '../../../../packages/db/integration/helpers.js';
import { createWorkerMetrics } from '../../src/metrics.js';
import type { SequenceDeps } from '../../src/sequence.js';
import {
  ASSIGN_JOB,
  runAssignJob,
  startSequenceAssignRunner,
  type AssignRunner,
  type AssignRunnerDeps,
} from '../../src/sequence-assign-runner.js';
import type { AssignOutcome } from '../../src/sequence-plan.js';
import { createSequenceFixture, firstParentOf, makeTempDir, removeDir, type SequenceFixture } from './fixture.js';

const REPOSITORY_ID = 904120;
const OWNER = 'wp040sa';
const NAME = 'assign';
const BRANCH = 'main';
const ACTOR = 'sub-wp040-assign-operator';

let pool: Pool;
let origin: SequenceFixture;
let mirrorRoot: string;
let runner: AssignRunner | undefined;

function fakeEs(): Client {
  return {
    search: async (): Promise<unknown> => ({ hits: { hits: [] } }),
    updateByQuery: async (): Promise<unknown> => ({ updated: 0 }),
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

function sequenceDeps(): SequenceDeps {
  const graph = new MirrorCommitGraph({ root: mirrorRoot, repositoryIdOf: () => REPOSITORY_ID });
  return {
    pool,
    es: fakeEs(),
    bus: fakeBus(),
    metrics: createWorkerMetrics(),
    graphFor: (): CommitGraph => graph,
  };
}

/**
 * 러너 의존.
 *
 * **`assign`을 덮지 않는 것이 기본이다** — 그래야 기본 이음매가 실제
 * `assignSequence`임을 이 파일이 증명한다.
 */
function deps(overrides: Partial<AssignRunnerDeps> = {}): AssignRunnerDeps {
  return { pool, sequence: sequenceDeps(), ...overrides };
}

const target = (branch = BRANCH): string => sequenceSpaceLabel(`${OWNER}/${NAME}`, branch);

const enqueue = (branch = BRANCH): Promise<number> => jobRepo.enqueueJob(pool, ASSIGN_JOB, target(branch), ACTOR);

const stateOf = (jobId: number): Promise<jobRepo.JobState | undefined> => jobRepo.findJobState(pool, jobId);

async function until(predicate: () => Promise<boolean>, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await predicate()) return;
    if (Date.now() > deadline) throw new Error('조건이 시간 안에 성립하지 않았다');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

const terminal = (jobId: number) => async (): Promise<boolean> => {
  const state = await stateOf(jobId);
  return state === 'completed' || state === 'failed' || state === 'cancelled';
};

async function storedSequence(branch = BRANCH): Promise<readonly { seq: number; sha: string }[]> {
  const result = await pool.query<{ merge_seq: string; commit_sha: string }>(
    `SELECT merge_seq, commit_sha FROM merge_sequence
      WHERE repository_id = $1 AND base_branch = $2 ORDER BY merge_seq`,
    [REPOSITORY_ID, branch],
  );
  return result.rows.map((row) => ({ seq: Number(row.merge_seq), sha: row.commit_sha }));
}

async function registerRepository(branches: readonly string[] = [BRANCH], status: 'active' | 'archived' = 'active'): Promise<void> {
  await repositoryRepo.upsertRepository(pool, {
    repository_id: REPOSITORY_ID,
    owner: OWNER,
    name: NAME,
    org_id: 9041,
    visibility: 'internal',
    sequence_branches: branches,
    mirror_enabled: true,
    status,
  });
}

beforeAll(async () => {
  pool = await migratedPool();
}, 120_000);

beforeEach(async () => {
  await truncate(pool, 'merge_sequence', 'sequence_space', 'repository');
  await pool.query('DELETE FROM job WHERE requested_by = $1', [ACTOR]);
  origin = await createSequenceFixture();
  mirrorRoot = await makeTempDir('prs-assign-mirror-');
  await new MirrorSync({ root: mirrorRoot, remoteUrl: () => origin.url }).sync({ owner: OWNER, repo: NAME }, REPOSITORY_ID);
}, 90_000);

afterEach(async () => {
  await runner?.stop();
  runner = undefined;
  await removeDir(origin.dir);
  await removeDir(mirrorRoot);
});

afterAll(async () => {
  await pool?.query('DELETE FROM job WHERE requested_by = $1', [ACTOR]);
  await pool?.end();
});

describe('잡이 실제 채번에 닿는다 (FR-ADMIN-002 AC-6)', () => {
  it('러너가 잡을 집어 `assignSequence`를 돌리고 서수가 git과 같다', async () => {
    await registerRepository();
    const jobId = await enqueue();

    runner = startSequenceAssignRunner(deps(), { intervalMs: 10 });
    await until(terminal(jobId));

    expect(await stateOf(jobId)).toBe('completed');

    // **git이 낸 답과 대조한다** — 우리 구현끼리 비교하면 둘 다 틀려도 통과한다.
    const expected = await firstParentOf(origin.dir, BRANCH);
    const stored = await storedSequence();
    expect(stored.map((row) => row.sha)).toEqual([...expected]);
    expect(stored.map((row) => row.seq)).toEqual(expected.map((_, index) => index + 1));
  }, 90_000);

  it('유령 잡이 남지 않는다', async () => {
    await registerRepository();
    const jobId = await enqueue();

    runner = startSequenceAssignRunner(deps(), { intervalMs: 10 });
    await until(terminal(jobId));

    const active = await pool.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM job WHERE requested_by = $1 AND state = ANY($2::text[])`,
      [ACTOR, ['queued', 'running', 'paused']],
    );
    expect(active.rows[0]?.count).toBe(0);
  }, 90_000);

  it('시작·종료 시각이 채워진다', async () => {
    await registerRepository();
    const jobId = await enqueue();
    runner = startSequenceAssignRunner(deps(), { intervalMs: 10 });
    await until(terminal(jobId));

    const job = await jobRepo.findJobById(pool, jobId);
    expect(job?.started_at).not.toBeNull();
    expect(job?.finished_at).not.toBeNull();
  }, 90_000);
});

describe('대상 판정', () => {
  it('등록되지 않은 저장소는 실패로 끝난다', async () => {
    // 저장소를 만들지 않는다.
    const jobId = await enqueue();
    runner = startSequenceAssignRunner(deps(), { intervalMs: 10 });
    await until(terminal(jobId));

    const job = await jobRepo.findJobById(pool, jobId);
    expect(job?.state).toBe('failed');
    expect(job?.error).toContain('등록되지 않은 저장소');
    expect(await storedSequence()).toHaveLength(0);
  }, 90_000);

  it('채번 대상이 아닌 브랜치는 채번하지 않는다', async () => {
    await registerRepository(['release']);
    const jobId = await enqueue(BRANCH);
    runner = startSequenceAssignRunner(deps(), { intervalMs: 10 });
    await until(terminal(jobId));

    /*
     * **완료로 적는다.** 큐에서 기다리는 사이 대상 브랜치 목록이 바뀔 수 있고,
     * 그때 실패로 적으면 운영자가 없는 문제를 쫓는다 (`skipped`의 뜻).
     */
    expect(await stateOf(jobId)).toBe('completed');
    expect(await storedSequence()).toHaveLength(0);
  }, 90_000);

  it('`target` 형식이 아니면 실패한다', async () => {
    await registerRepository();
    const jobId = await jobRepo.enqueueJob(pool, ASSIGN_JOB, 'not-a-space-label', ACTOR);
    runner = startSequenceAssignRunner(deps(), { intervalMs: 10 });
    await until(terminal(jobId));

    const job = await jobRepo.findJobById(pool, jobId);
    expect(job?.state).toBe('failed');
    expect(job?.error).toContain('target 형식');
  }, 90_000);

  it('브랜치 이름의 `@`가 공간을 갈라놓지 않는다 — 첫 `@`에서 자른다', async () => {
    await registerRepository(['release/@next']);
    const label = target('release/@next');
    expect(label).toBe(`${OWNER}/${NAME}@release/@next`);

    const jobId = await jobRepo.enqueueJob(pool, ASSIGN_JOB, label, ACTOR);
    const job = await jobRepo.claimNextJob(pool, ASSIGN_JOB, 1);

    /*
     * **러너가 어떤 브랜치로 불렀는지를 잰다.** 없는 브랜치의 결과 갈래
     * (`no_branch`인지 `stale`인지)는 그래프 구현이 정하는 것이고 파싱의
     * 정확성과 무관하다 — 여기서 물어야 하는 것은 `release/@next`가 통째로
     * 넘어갔는가이며, 첫 `@`가 아니라 마지막 `@`에서 자르면 `next`가 된다.
     */
    const branches: string[] = [];
    await runAssignJob(
      deps({
        assign: async (_deps, _repositoryId, baseBranch): Promise<AssignOutcome> => {
          branches.push(baseBranch);
          return { kind: 'no_branch' };
        },
      }),
      job!,
    );

    expect(branches).toEqual(['release/@next']);
    expect(await stateOf(jobId)).toBe('completed');
  }, 90_000);
});

describe('취소가 완료로 덮이지 않는다', () => {
  it('채번이 도는 중에 취소하면 `cancelled`로 남는다', async () => {
    await registerRepository();
    const jobId = await enqueue();

    const job = await jobRepo.claimNextJob(pool, ASSIGN_JOB, 1);
    expect(job).toBeDefined();

    // 채번이 진행되는 그 순간에 취소를 밀어 넣는다.
    await runAssignJob(
      deps({
        assign: async (): Promise<AssignOutcome> => {
          await jobRepo.transitionJob(pool, jobId, 'cancel');
          return { kind: 'assigned', fromSeq: 0, toSeq: 3, headSha: 'a'.repeat(40) };
        },
      }),
      job!,
    );

    expect(await stateOf(jobId)).toBe('cancelled');
  }, 90_000);

  it('시작 전에 취소된 잡은 채번을 아예 시작하지 않는다', async () => {
    await registerRepository();
    const jobId = await enqueue();
    const job = await jobRepo.claimNextJob(pool, ASSIGN_JOB, 1);
    await jobRepo.transitionJob(pool, jobId, 'cancel');

    let called = 0;
    const outcome = await runAssignJob(
      deps({
        assign: async (): Promise<AssignOutcome> => {
          called += 1;
          return { kind: 'assigned', fromSeq: 0, toSeq: 3, headSha: 'a'.repeat(40) };
        },
      }),
      job!,
    );

    expect(called).toBe(0);
    expect(outcome).toBeNull();
    expect(await stateOf(jobId)).toBe('cancelled');
  }, 90_000);
});

describe('락 경합과 실패 갈래', () => {
  it('`locked`는 재시도하고 상한에 닿으면 실패로 적는다', async () => {
    await registerRepository();
    const jobId = await enqueue();
    const job = await jobRepo.claimNextJob(pool, ASSIGN_JOB, 1);

    let attempts = 0;
    await runAssignJob(
      deps({
        sleep: async () => undefined,
        assign: async (): Promise<AssignOutcome> => {
          attempts += 1;
          return { kind: 'locked' };
        },
      }),
      job!,
    );

    expect(attempts).toBeGreaterThan(1);
    const finished = await jobRepo.findJobById(pool, jobId);
    expect(finished?.state).toBe('failed');
    expect(finished?.error).toContain('locked');
  }, 90_000);

  it('`locked` 재시도 중 취소되면 이어서 채번하지 않는다', async () => {
    await registerRepository();
    const jobId = await enqueue();
    const job = await jobRepo.claimNextJob(pool, ASSIGN_JOB, 1);

    let attempts = 0;
    await runAssignJob(
      deps({
        sleep: async () => undefined,
        assign: async (): Promise<AssignOutcome> => {
          attempts += 1;
          if (attempts === 1) await jobRepo.transitionJob(pool, jobId, 'cancel');
          return { kind: 'locked' };
        },
      }),
      job!,
    );

    expect(attempts).toBe(1);
    expect(await stateOf(jobId)).toBe('cancelled');
  }, 90_000);

  it('`stale`은 실패이며 사유를 남긴다 — 기존 값은 보존된다', async () => {
    await registerRepository();
    const jobId = await enqueue();
    const job = await jobRepo.claimNextJob(pool, ASSIGN_JOB, 1);

    await runAssignJob(
      deps({ assign: async (): Promise<AssignOutcome> => ({ kind: 'stale', reason: '그래프를 읽지 못했다' }) }),
      job!,
    );

    const finished = await jobRepo.findJobById(pool, jobId);
    expect(finished?.state).toBe('failed');
    expect(finished?.error).toContain('그래프를 읽지 못했다');
  }, 90_000);
});

describe('활성 잡 제약', () => {
  it('같은 공간에 활성 잡이 둘 생기지 않는다 (AC-4)', async () => {
    await registerRepository();
    await enqueue();
    await expect(enqueue()).rejects.toThrow();
  }, 90_000);

  it('다른 브랜치는 별개의 대상이라 함께 큐에 든다', async () => {
    await registerRepository([BRANCH, 'release']);
    const first = await enqueue(BRANCH);
    const second = await enqueue('release');
    expect(first).not.toBe(second);
  }, 90_000);
});
