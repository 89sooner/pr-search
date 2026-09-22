/**
 * JOB-SEQ-002 재채번 (WP-022 / FR-SEQ-005, ADR-007).
 *
 * 이 파일이 거는 것은 하나로 모인다: **재작성을 감지한 뒤에도 "번호 순서 =
 * 반영 순서"가 증명 가능하게 남는가.** 에폭이 오르지 않으면 과거 인용이
 * 말없이 다른 커밋을 가리키고, base 이전 값이 흔들리면 아직 유효한 인용까지
 * 죽는다 — 양쪽 다 조용히 틀리는 실패다.
 *
 * WP-021의 채번 시험과 같은 이유로 Elasticsearch를 요구하지 않는다.
 *
 * 검증: `npx vitest run --config vitest.integration.config.ts apps/pipeline-worker/integration/sequence`
 */

import type { Client } from '@elastic/elasticsearch';
import { MirrorCommitGraph, MirrorSync, type CommitGraph, type RepoRef } from '@prs/github';
import type { EventBus } from '@prs/bus';
import { repositoryRepo, sequenceSpaceRepo, type Pool } from '@prs/db';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { migratedPool, truncate } from '../../../../packages/db/integration/helpers.js';
import { assignSequence, reassignSequence, type SequenceDeps } from '../../src/sequence.js';
import { createWorkerMetrics } from '../../src/metrics.js';
import {
  createSequenceFixture,
  firstParentOf,
  makeTempDir,
  removeDir,
  rewriteHistory,
  rewriteToFeatureHead,
  type SequenceFixture,
} from './fixture.js';

const REPOSITORY_ID = 4022;
const OWNER = 'acme';
const NAME = 'payments';
const BRANCH = 'main';
const PR_NUMBER = 42;

let pool: Pool;
let origin: SequenceFixture;
let mirrorRoot: string;
let published: { topic: string; key: string; envelope: unknown }[] = [];

function fakeEs(): Client {
  return {
    search: async (params: { query?: unknown }): Promise<unknown> => {
      const text = JSON.stringify(params.query ?? {});
      const matched = text.includes(origin.mergeSha);
      return { hits: { hits: matched ? [{ _source: { pr_number: PR_NUMBER } }] : [] } };
    },
    updateByQuery: async (): Promise<unknown> => ({ updated: 0 }),
    // CR-113: 문서 단위 투영기가 `mget`·`bulk`를 부른다 — 문서 없음으로 답해 durable work가 남게 둔다.
    mget: async (body: { docs: readonly { _id: string }[] }): Promise<unknown> => ({ docs: body.docs.map((doc) => ({ _id: doc._id, found: false })) }),
    bulk: async (): Promise<unknown> => ({ errors: false, items: [] }),
  } as unknown as Client;
}

function fakeBus(): EventBus {
  return {
    publish: async (topic: string, key: string, envelope: unknown): Promise<void> => {
      published.push({ topic, key, envelope });
    },
    subscribe: async (): Promise<never> => {
      throw new Error('시험에서 구독하지 않는다');
    },
    close: async (): Promise<void> => undefined,
  } as unknown as EventBus;
}

function mirrorGraph(): CommitGraph {
  return new MirrorCommitGraph({ root: mirrorRoot, repositoryIdOf: () => REPOSITORY_ID });
}

function deps(overrides: Partial<SequenceDeps> = {}): SequenceDeps {
  return {
    pool,
    es: fakeEs(),
    bus: fakeBus(),
    metrics: createWorkerMetrics(),
    graphFor: mirrorGraph,
    ...overrides,
  };
}

async function cloneMirror(): Promise<void> {
  const sync = new MirrorSync({ root: mirrorRoot, remoteUrl: () => origin.url });
  await sync.sync({ owner: OWNER, repo: NAME }, REPOSITORY_ID);
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

async function storedSequence(epoch: number): Promise<{ seq: number; sha: string; pr: number | null }[]> {
  const result = await pool.query<{ merge_seq: string; commit_sha: string; pull_request_number: number | null }>(
    `SELECT merge_seq, commit_sha, pull_request_number FROM merge_sequence
      WHERE repository_id = $1 AND base_branch = $2 AND seq_epoch = $3 ORDER BY merge_seq`,
    [REPOSITORY_ID, BRANCH, epoch],
  );
  return result.rows.map((row) => ({
    seq: Number(row.merge_seq),
    sha: row.commit_sha,
    pr: row.pull_request_number,
  }));
}

/** 재작성까지 마친 출발 상태: 에폭 1 채번 완료 + origin 재작성 + 미러 동기화. */
async function assignThenRewrite(): Promise<string> {
  await registerRepository();
  const first = await assignSequence(deps(), REPOSITORY_ID, BRANCH);
  expect(first.kind).toBe('assigned');
  const newHead = await rewriteHistory(origin.dir);
  await cloneMirror();
  return newHead;
}

beforeAll(async () => {
  pool = await migratedPool();
}, 120_000);

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await truncate(pool, 'merge_sequence', 'sequence_space', 'repository', 'audit_record');
  published = [];
  origin = await createSequenceFixture();
  mirrorRoot = await makeTempDir('prs-reassign-mirror-');
  await cloneMirror();
}, 60_000);

afterEach(async () => {
  await removeDir(origin.dir);
  await removeDir(mirrorRoot);
});

describe('DoD 1·2: 재작성 감지가 재채번으로 이어진다 (AC-1~AC-3)', () => {
  it('**push 한 번으로 감지→에폭 증가→재채번까지 끝난다**', async () => {
    await assignThenRewrite();

    const outcome = await assignSequence(deps(), REPOSITORY_ID, BRANCH);
    expect(outcome.kind).toBe('reassigned');
    if (outcome.kind !== 'reassigned') return;
    expect(outcome.oldEpoch).toBe(1);
    expect(outcome.newEpoch).toBe(2);

    const space = await sequenceSpaceRepo.findSequenceSpace(pool, REPOSITORY_ID, BRANCH);
    expect(space?.seq_epoch).toBe(2);
    expect(space?.state).toBe('ok');
  });

  it('**새 에폭 체인이 git과 정확히 일치한다** — 재채번 뒤에도 증명 가능성이 남는다', async () => {
    await assignThenRewrite();
    await assignSequence(deps(), REPOSITORY_ID, BRANCH);

    const stored = await storedSequence(2);
    const expected = await firstParentOf(origin.dir, BRANCH);
    expect(stored.map((row) => row.sha)).toEqual(expected);
    expect(stored.map((row) => row.seq)).toEqual(expected.map((_, index) => index + 1));
  });
});

describe('DoD 7: merge-base 이전 값이 새 에폭에서도 동일하다', () => {
  it('**base 이전 서수·SHA·PR 번호가 그대로 복사된다** (DEV-124)', async () => {
    /*
     * PR 번호까지 비교하는 이유: 복사 대신 재계산하면 서수·SHA는 같아도
     * `pull_request_number`는 null에서 다시 시작한다 — 나중에 채워진 값을
     * 잃는 것을 이 단언이 잡는다.
     */
    await assignThenRewrite();
    const before = await storedSequence(1);
    const outcome = await assignSequence(deps(), REPOSITORY_ID, BRANCH);
    expect(outcome.kind).toBe('reassigned');
    if (outcome.kind !== 'reassigned') return;

    const after = await storedSequence(2);
    const commonLength = outcome.divergedAtSeq - 1;
    expect(commonLength).toBeGreaterThan(0);
    expect(after.slice(0, commonLength)).toEqual(before.slice(0, commonLength));
    // 픽스처의 재작성은 마지막 커밋만 바꾼다 — base는 서수 3(병합 커밋)이다.
    expect(after[2]?.pr).toBe(PR_NUMBER);
  });

  it('**이전 에폭 행은 지워지지 않는다** — 이전 인용을 해석할 근거가 남아야 한다', async () => {
    await assignThenRewrite();
    const before = await storedSequence(1);
    await assignSequence(deps(), REPOSITORY_ID, BRANCH);

    expect(await storedSequence(1)).toEqual(before);
  });
});

describe('DoD 4: 감사 기록과 이벤트 (AC-5)', () => {
  it('**EVT-SEQ-002가 어긋난 지점·영향 건수와 함께 발행된다**', async () => {
    await assignThenRewrite();
    const outcome = await assignSequence(deps(), REPOSITORY_ID, BRANCH, 'corr-re');
    expect(outcome.kind).toBe('reassigned');
    if (outcome.kind !== 'reassigned') return;

    const event = published.find(
      (p) => (p.envelope as { event_name?: string }).event_name === 'sequence.reassigned',
    );
    expect(event).toBeDefined();
    expect((event?.envelope as { correlation_id?: string }).correlation_id).toBe('corr-re');
    expect((event?.envelope as { payload?: unknown }).payload).toEqual({
      repository_id: REPOSITORY_ID,
      base_branch: BRANCH,
      old_epoch: 1,
      new_epoch: 2,
      diverged_at_seq: outcome.divergedAtSeq,
      // 픽스처는 마지막 커밋 하나(서수 4)만 무효가 된다.
      affected_count: 1,
    });
  });

  it('**감사 기록이 `system:sequence` 주체로 남는다** — 신원을 지어내지 않는다 (DEV-127)', async () => {
    await assignThenRewrite();
    // 게이트웨이의 correlation은 uuid다 — 시험도 현실의 모양을 쓴다.
    await assignSequence(deps(), REPOSITORY_ID, BRANCH, '0f0a1b2c-3d4e-4f60-8182-93a4b5c6d7e8');

    const rows = await pool.query<{ user_id: string; action: string; target: string; result_code: string }>(
      `SELECT user_id, action, target, result_code FROM audit_record WHERE action = 'sequence.reassign'`,
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]).toMatchObject({
      user_id: 'system:sequence',
      action: 'sequence.reassign',
      target: `${OWNER}/${NAME}@${BRANCH}`,
      result_code: 'ok',
    });
  });
});

describe('DoD 5: 재채번 중 조회 (예외 처리)', () => {
  it('**본 작업이 도는 동안 밖에서는 `reassigning`과 이전 확정 값이 보인다**', async () => {
    await assignThenRewrite();
    const before = await storedSequence(1);

    // firstParentCommits에서 멈춰 서는 그래프 — 그 사이가 "재채번 중"이다.
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const real = mirrorGraph();
    const slow: CommitGraph = {
      kind: real.kind,
      resolveHead: (ref: RepoRef, branch: string) => real.resolveHead(ref, branch),
      isAncestor: (ref: RepoRef, a: string, b: string) => real.isAncestor(ref, a, b),
      mergeBase: (ref: RepoRef, a: string, b: string) => real.mergeBase(ref, a, b),
      firstParentCommits: async (ref, range) => {
        await gate;
        return real.firstParentCommits(ref, range);
      },
      firstParentRevList: (ref, range) => real.firstParentRevList(ref, range),
      patchId: (ref, sha) => real.patchId(ref, sha),
      // WP-067이 CommitGraph를 넓혔다. 이 시험은 채번만 보므로 그대로 위임한다.
      readCommit: (ref, sha) => real.readCommit(ref, sha),
      changedPaths: (ref, sha, limit) => real.changedPaths(ref, sha, limit),
    };

    const running = assignSequence(deps({ graphFor: () => slow }), REPOSITORY_ID, BRANCH);

    // 게이트가 잡고 있는 동안 다른 커넥션으로 조회한다.
    await new Promise((resolve) => setTimeout(resolve, 300));
    const during = await sequenceSpaceRepo.findSequenceSpace(pool, REPOSITORY_ID, BRANCH);
    expect(during?.state).toBe('reassigning');
    // 새 에폭 행은 본 트랜잭션이 커밋되기 전이라 보이지 않는다 — 이전 값 그대로.
    expect(await storedSequence(1)).toEqual(before);
    expect(await storedSequence(2)).toEqual([]);

    release();
    const outcome = await running;
    expect(outcome.kind).toBe('reassigned');
  });
});

describe('DoD 6: 실패 시 부분 상태로 남지 않는다', () => {
  it('**walk가 중간에 죽으면 새 에폭 행이 0이고 공간은 `stale`이다**', async () => {
    await assignThenRewrite();
    const before = await storedSequence(1);

    const real = mirrorGraph();
    const broken: CommitGraph = {
      kind: real.kind,
      resolveHead: (ref: RepoRef, branch: string) => real.resolveHead(ref, branch),
      isAncestor: (ref: RepoRef, a: string, b: string) => real.isAncestor(ref, a, b),
      mergeBase: (ref: RepoRef, a: string, b: string) => real.mergeBase(ref, a, b),
      firstParentCommits: async () => {
        throw new Error('그래프가 죽었다');
      },
      firstParentRevList: (ref, range) => real.firstParentRevList(ref, range),
      patchId: (ref, sha) => real.patchId(ref, sha),
      // WP-067이 CommitGraph를 넓혔다. 이 시험은 채번만 보므로 그대로 위임한다.
      readCommit: (ref, sha) => real.readCommit(ref, sha),
      changedPaths: (ref, sha, limit) => real.changedPaths(ref, sha, limit),
    };

    const outcome = await assignSequence(deps({ graphFor: () => broken }), REPOSITORY_ID, BRANCH);
    expect(outcome.kind).toBe('stale');

    // 트랜잭션이 통째로 롤백됐다 — 에폭도 행도 그대로다.
    const space = await sequenceSpaceRepo.findSequenceSpace(pool, REPOSITORY_ID, BRANCH);
    expect(space?.state).toBe('stale');
    expect(space?.seq_epoch).toBe(1);
    expect(await storedSequence(2)).toEqual([]);
    expect(await storedSequence(1)).toEqual(before);
  });

  it('실패 뒤 다음 회차가 정상 그래프로 재채번을 완주한다', async () => {
    await assignThenRewrite();
    const real = mirrorGraph();
    const broken: CommitGraph = {
      ...real,
      kind: real.kind,
      resolveHead: (ref: RepoRef, branch: string) => real.resolveHead(ref, branch),
      isAncestor: (ref: RepoRef, a: string, b: string) => real.isAncestor(ref, a, b),
      mergeBase: (ref: RepoRef, a: string, b: string) => real.mergeBase(ref, a, b),
      firstParentCommits: async () => {
        throw new Error('그래프가 죽었다');
      },
      firstParentRevList: (ref, range) => real.firstParentRevList(ref, range),
      patchId: (ref, sha) => real.patchId(ref, sha),
    };
    await assignSequence(deps({ graphFor: () => broken }), REPOSITORY_ID, BRANCH);

    const outcome = await assignSequence(deps(), REPOSITORY_ID, BRANCH);
    expect(outcome.kind).toBe('reassigned');
    const stored = await storedSequence(2);
    expect(stored.map((row) => row.sha)).toEqual(await firstParentOf(origin.dir, BRANCH));
  });
});

describe('DEV-125: merge-base가 first-parent 체인 밖이면 전체 재채번한다', () => {
  it('**체인 밖 merge-base에서도 재채번이 git과 일치한다**', async () => {
    await registerRepository();
    await assignSequence(deps(), REPOSITORY_ID, BRANCH);

    // main → feature 끝 커밋으로 재작성. merge-base(병합, f2) = f2 = 체인 밖.
    await rewriteToFeatureHead(origin.dir);
    await cloneMirror();

    const outcome = await assignSequence(deps(), REPOSITORY_ID, BRANCH);
    expect(outcome.kind).toBe('reassigned');
    if (outcome.kind !== 'reassigned') return;
    // 공통 지점을 못 찾았으므로 처음부터다.
    expect(outcome.divergedAtSeq).toBe(1);

    const stored = await storedSequence(2);
    const expected = await firstParentOf(origin.dir, BRANCH);
    expect(stored.map((row) => row.sha)).toEqual(expected);
    expect(stored.map((row) => row.seq)).toEqual(expected.map((_, index) => index + 1));
  });
});

describe('멱등과 경합', () => {
  it('재채번 직후의 재실행은 새 커밋 없는 정상 채번이다', async () => {
    await assignThenRewrite();
    await assignSequence(deps(), REPOSITORY_ID, BRANCH);

    const again = await assignSequence(deps(), REPOSITORY_ID, BRANCH);
    expect(again.kind).toBe('assigned');
    if (again.kind !== 'assigned') return;
    expect(again.fromSeq).toBe(again.toSeq);
  });

  it('저장된 head가 그새 움직였으면 이어 가지 않는다 — 옛 판정으로 재채번하지 않는다', async () => {
    const newHead = await assignThenRewrite();
    // 먼저 정상 재채번을 끝내 head를 움직여 둔다.
    await assignSequence(deps(), REPOSITORY_ID, BRANCH);

    const repository = await repositoryRepo.findRepositoryById(pool, REPOSITORY_ID);
    expect(repository).toBeDefined();
    // 옛 storedHead 기준으로 직접 부른다 — 다른 워커가 이미 처리한 상황이다.
    const outcome = await reassignSequence(deps(), repository!, BRANCH, 'f'.repeat(40), newHead);
    expect(outcome).toEqual({ kind: 'skipped', reason: 'head_moved' });

    // 에폭이 또 오르지 않았다.
    const space = await sequenceSpaceRepo.findSequenceSpace(pool, REPOSITORY_ID, BRANCH);
    expect(space?.seq_epoch).toBe(2);
  });
});
