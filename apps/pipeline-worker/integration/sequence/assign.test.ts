/**
 * JOB-SEQ-001 채번 (WP-021 / FR-SEQ-001, ADR-007).
 *
 * **이 파일이 이 제품의 핵심 주장을 판정한다.** "번호 순서 = 반영 순서"가
 * 성립하는지를 우리 구현이 아니라 **git이 낸 답과 대조해서** 확인한다.
 *
 * Elasticsearch를 요구하지 않는다 — 시퀀스는 PostgreSQL이 정본이고 색인은
 * 그것을 비친 것이라(ADR-004), 정본이 맞는지는 PostgreSQL과 git만으로
 * 판정할 수 있어야 한다. WP-019에서 ES를 요구하는 파일에 PostgreSQL만의
 * 불변식을 넣었다가 로컬에서 못 돌린 채 결함이 CI로 나갔다.
 *
 * 검증: `npx vitest run --config vitest.integration.config.ts apps/pipeline-worker/integration/sequence`
 */

import type { Client } from '@elastic/elasticsearch';
import { MirrorCommitGraph, MirrorSync, type CommitGraph } from '@prs/github';
import type { EventBus } from '@prs/bus';
import { mergeSequenceRepo, repositoryRepo, sequenceSpaceRepo, type Pool } from '@prs/db';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { migratedPool, truncate } from '../../../../packages/db/integration/helpers.js';
import { assignSequence, type SequenceDeps } from '../../src/sequence.js';
import { createWorkerMetrics } from '../../src/metrics.js';
import {
  appendCommit,
  createSequenceFixture,
  firstParentOf,
  makeTempDir,
  removeDir,
  rewriteHistory,
  run,
  type SequenceFixture,
} from './fixture.js';

const REPOSITORY_ID = 4021;
const OWNER = 'acme';
const NAME = 'payments';
const BRANCH = 'main';
const PR_NUMBER = 42;

let pool: Pool;
let origin: SequenceFixture;
let mirrorRoot: string;
let published: { topic: string; key: string; envelope: unknown }[] = [];

/**
 * PR 조회에만 답하는 Elasticsearch 대역.
 *
 * **머지 커밋 하나에만 PR 번호를 준다.** 전부 `null`을 주는 대역을 쓰면
 * "직접 푸시는 null"을 확인하는 시험이 아무것도 검증하지 못한다 — 무엇을
 * 해도 null이 나온다. 둘을 가르는 것이 이 대역의 존재 이유다.
 */
/** 질의 어딘가에 있는 `term` 값을 찾는다. 중첩 모양에 시험이 매달리지 않게 한다. */
function findTerm(node: unknown, field: string): unknown {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findTerm(child, field);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (typeof node !== 'object' || node === null) return undefined;

  const record = node as Record<string, unknown>;
  const term = record['term'];
  if (typeof term === 'object' && term !== null && field in (term as Record<string, unknown>)) {
    return (term as Record<string, unknown>)[field];
  }
  const terms = record['terms'];
  if (typeof terms === 'object' && terms !== null && field in (terms as Record<string, unknown>)) {
    return (terms as Record<string, unknown>)[field];
  }

  for (const value of Object.values(record)) {
    const found = findTerm(value, field);
    if (found !== undefined) return found;
  }
  return undefined;
}

/**
 * PR 조회에만 답하는 Elasticsearch 대역.
 *
 * **머지 커밋 하나에만 PR 번호를 준다.** 전부 `null`을 주는 대역을 쓰면
 * "직접 푸시는 null"을 확인하는 시험이 아무것도 검증하지 못한다 — 무엇을
 * 해도 null이 나온다. 둘을 가르는 것이 이 대역의 존재 이유다.
 *
 * **접근 범위 필터가 붙었는지도 여기서 본다.** 조회가 필터를 거치는지는
 * 아키텍처 시험이 소스로 검사하지만, 그 필터에 **올바른 저장소**가 들어갔는지는
 * 실행해 봐야 안다 — 엉뚱한 저장소로 필터가 걸리면 PR을 영원히 못 찾는다.
 */
function fakeEs(): Client {
  return {
    search: async (params: { query?: unknown }): Promise<unknown> => {
      const scoped = findTerm(params.query, 'repository_id');
      if (scoped === undefined) throw new Error('접근 범위 필터가 붙지 않은 조회다');
      const inScope = Array.isArray(scoped) ? scoped.includes(REPOSITORY_ID) : scoped === REPOSITORY_ID;
      if (!inScope) throw new Error(`엉뚱한 저장소로 필터가 걸렸다: ${JSON.stringify(scoped)}`);

      const sha = findTerm(params.query, 'merge_commit_sha');
      const matched = typeof sha === 'string' && sha === origin.mergeSha;
      return { hits: { hits: matched ? [{ _source: { pr_number: PR_NUMBER } }] : [] } };
    },
    updateByQuery: async (): Promise<unknown> => ({ updated: 0 }),
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

function deps(overrides: Partial<SequenceDeps> = {}): SequenceDeps {
  const graph = new MirrorCommitGraph({ root: mirrorRoot, repositoryIdOf: () => REPOSITORY_ID });
  return {
    pool,
    es: fakeEs(),
    bus: fakeBus(),
    metrics: createWorkerMetrics(),
    graphFor: (): CommitGraph => graph,
    ...overrides,
  };
}

async function cloneMirror(): Promise<void> {
  const sync = new MirrorSync({ root: mirrorRoot, remoteUrl: () => origin.url });
  await sync.sync({ owner: OWNER, repo: NAME }, REPOSITORY_ID);
}

async function registerRepository(over: { sequence_branches?: string[]; status?: 'active' | 'archived' } = {}): Promise<void> {
  await repositoryRepo.upsertRepository(pool, {
    repository_id: REPOSITORY_ID,
    owner: OWNER,
    name: NAME,
    org_id: 1,
    visibility: 'internal',
    sequence_branches: over.sequence_branches ?? [BRANCH],
    mirror_enabled: true,
    status: over.status ?? 'active',
  });
}

async function storedSequence(): Promise<{ seq: number; sha: string; pr: number | null }[]> {
  const result = await pool.query<{ merge_seq: string; commit_sha: string; pull_request_number: number | null }>(
    `SELECT merge_seq, commit_sha, pull_request_number FROM merge_sequence
      WHERE repository_id = $1 AND base_branch = $2 ORDER BY merge_seq`,
    [REPOSITORY_ID, BRANCH],
  );
  return result.rows.map((row) => ({
    seq: Number(row.merge_seq),
    sha: row.commit_sha,
    pr: row.pull_request_number,
  }));
}

beforeAll(async () => {
  pool = await migratedPool();
}, 120_000);

afterAll(async () => {
  await pool.end();
});

/*
 * **픽스처를 시험마다 새로 만든다.** 증분 채번 시험은 origin에 커밋을 더하고
 * 재작성 시험은 히스토리를 통째로 다시 쓴다 — 공유하면 뒤 시험이 앞 시험의
 * 부작용을 물려받아, 순서를 바꾸는 것만으로 결과가 달라진다. 그런 시험은
 * 실패했을 때 무엇이 틀렸는지 알려 주지 못한다.
 */
beforeEach(async () => {
  await truncate(pool, 'merge_sequence', 'sequence_space', 'repository');
  published = [];
  origin = await createSequenceFixture();
  mirrorRoot = await makeTempDir('prs-seq-mirror-');
  await cloneMirror();
}, 60_000);

afterEach(async () => {
  await removeDir(origin.dir);
  await removeDir(mirrorRoot);
});

describe('DoD 1·2: 채번이 git과 정확히 일치한다 (AC-1, AC-2)', () => {
  it('**서수 순서가 `git rev-list --first-parent --reverse`와 같다**', async () => {
    await registerRepository();
    const outcome = await assignSequence(deps(), REPOSITORY_ID, BRANCH);

    expect(outcome.kind).toBe('assigned');

    const stored = await storedSequence();
    const expected = await firstParentOf(origin.dir, BRANCH);
    expect(stored.map((row) => row.sha)).toEqual(expected);
  });

  it('루트가 1이고 서수에 구멍이 없다 (AC-1)', async () => {
    await registerRepository();
    await assignSequence(deps(), REPOSITORY_ID, BRANCH);

    const stored = await storedSequence();
    expect(stored.map((row) => row.seq)).toEqual([1, 2, 3, 4]);
  });

  it('병합 커밋 안의 원본 커밋은 서수를 받지 않는다', async () => {
    await registerRepository();
    await assignSequence(deps(), REPOSITORY_ID, BRANCH);

    const stored = await storedSequence();
    const allCommits = (await run(origin.dir, ['rev-list', BRANCH])).split('\n').filter((l) => l.trim() !== '');
    // 저장소에는 커밋이 6개(root, direct, f1, f2, merge, after)지만 체인은 4개다.
    expect(allCommits.length).toBeGreaterThan(stored.length);
    expect(stored).toHaveLength(4);
  });

  it('커밋 시각이 채번 시각이 아니라 git이 말하는 값이다 (DEV-115)', async () => {
    await registerRepository();
    const before = new Date();
    await assignSequence(deps(), REPOSITORY_ID, BRANCH);

    const result = await pool.query<{ committed_at: Date; assigned_at: Date }>(
      `SELECT committed_at, assigned_at FROM merge_sequence
        WHERE repository_id = $1 AND merge_seq = 1`,
      [REPOSITORY_ID],
    );
    const row = result.rows[0];
    expect(row).toBeDefined();
    // 커밋은 채번보다 **먼저** 있었다. now()로 채웠다면 둘이 거의 같아진다.
    expect(row!.committed_at.getTime()).toBeLessThanOrEqual(before.getTime());
  });
});

describe('DoD 3: 직접 푸시와 머지 커밋을 가른다 (AC-3)', () => {
  it('**머지 커밋에는 PR 번호가 붙고 직접 푸시에는 붙지 않는다**', async () => {
    /*
     * 둘을 같은 히스토리에서 대조하는 것이 핵심이다. 직접 푸시만 있는
     * 픽스처로 "null이다"를 확인하면, PR 조회를 아예 하지 않는 구현도
     * 통과한다 — 아무것도 검증하지 못하는 시험이 된다.
     */
    await registerRepository();
    await assignSequence(deps(), REPOSITORY_ID, BRANCH);

    const stored = await storedSequence();
    const merge = stored.find((row) => row.sha === origin.mergeSha);
    expect(merge?.pr).toBe(PR_NUMBER);

    for (const sha of origin.directShas) {
      const direct = stored.find((row) => row.sha === sha);
      expect(direct, `직접 푸시 ${sha}가 채번되지 않았다`).toBeDefined();
      expect(direct?.pr, `직접 푸시 ${sha}에 PR 번호가 붙었다`).toBeNull();
    }
  });

  it('직접 푸시 커밋도 서수를 받는다 — 받지 않으면 체인과 1:1 대응이 깨진다 (ADR-007 규칙 7)', async () => {
    await registerRepository();
    await assignSequence(deps(), REPOSITORY_ID, BRANCH);

    const stored = await storedSequence();
    for (const sha of origin.directShas) {
      expect(stored.some((row) => row.sha === sha)).toBe(true);
    }
  });
});

describe('DoD 4: 멱등 (AC-4)', () => {
  it('**같은 채번을 두 번 실행해도 값이 변하지 않는다**', async () => {
    await registerRepository();
    await assignSequence(deps(), REPOSITORY_ID, BRANCH);
    const first = await storedSequence();

    await assignSequence(deps(), REPOSITORY_ID, BRANCH);
    const second = await storedSequence();

    expect(second).toEqual(first);
  });

  it('두 번째 실행은 새 커밋이 없으므로 서수를 늘리지 않는다', async () => {
    await registerRepository();
    const first = await assignSequence(deps(), REPOSITORY_ID, BRANCH);
    const second = await assignSequence(deps(), REPOSITORY_ID, BRANCH);

    expect(first.kind === 'assigned' && first.toSeq).toBe(4);
    expect(second.kind === 'assigned' && second.fromSeq).toBe(4);
    expect(second.kind === 'assigned' && second.toSeq).toBe(4);
  });

  it('아는 PR 번호가 재실행으로 지워지지 않는다 (DEV-118)', async () => {
    await registerRepository();
    await assignSequence(deps(), REPOSITORY_ID, BRANCH);

    // PR을 더 이상 찾지 못하는 대역으로 다시 돌린다.
    const blindEs = { search: async (): Promise<unknown> => ({ hits: { hits: [] } }) } as unknown as Client;
    await assignSequence(deps({ es: blindEs }), REPOSITORY_ID, BRANCH);

    const stored = await storedSequence();
    expect(stored.find((row) => row.sha === origin.mergeSha)?.pr).toBe(PR_NUMBER);
  });
});

describe('DoD 5: 증분 채번 (AC-5)', () => {
  it('**저장된 head 이후만 처리한다**', async () => {
    await registerRepository();
    await assignSequence(deps(), REPOSITORY_ID, BRANCH);

    const newSha = await appendCommit(origin.dir, 'c5');
    await cloneMirror();

    const outcome = await assignSequence(deps(), REPOSITORY_ID, BRANCH);
    expect(outcome.kind === 'assigned' && outcome.fromSeq).toBe(4);
    expect(outcome.kind === 'assigned' && outcome.toSeq).toBe(5);

    const stored = await storedSequence();
    expect(stored).toHaveLength(5);
    expect(stored[4]).toMatchObject({ seq: 5, sha: newSha });
  });

  it('나눠 채번한 결과가 한 번에 채번한 것과 같다', async () => {
    await registerRepository();
    await assignSequence(deps(), REPOSITORY_ID, BRANCH);
    await appendCommit(origin.dir, 'c6');
    await cloneMirror();
    await assignSequence(deps(), REPOSITORY_ID, BRANCH);

    const stepwise = await storedSequence();
    const expected = await firstParentOf(origin.dir, BRANCH);
    expect(stepwise.map((row) => row.sha)).toEqual(expected);
    expect(stepwise.map((row) => row.seq)).toEqual(expected.map((_, index) => index + 1));
  });
});

describe('DoD 6: 시퀀스 공간당 동시 1개 (AC-6)', () => {
  it('**같은 공간에 대한 채번 다섯을 동시에 돌려도 서수가 어긋나지 않는다**', async () => {
    await registerRepository();

    const outcomes = await Promise.all(
      Array.from({ length: 5 }, () => assignSequence(deps(), REPOSITORY_ID, BRANCH)),
    );

    // 락을 얻지 못한 쪽은 `locked`다 — 기다리지 않고 나중에 온다.
    const assigned = outcomes.filter((o) => o.kind === 'assigned');
    expect(assigned.length).toBeGreaterThanOrEqual(1);

    const stored = await storedSequence();
    const expected = await firstParentOf(origin.dir, BRANCH);
    // 중복도 구멍도 없어야 한다.
    expect(stored.map((row) => row.sha)).toEqual(expected);
    expect(stored.map((row) => row.seq)).toEqual(expected.map((_, index) => index + 1));
  });

  it('다른 시퀀스 공간은 서로를 막지 않는다', async () => {
    await registerRepository({ sequence_branches: [BRANCH, 'feature'] });

    const [main, feature] = await Promise.all([
      assignSequence(deps(), REPOSITORY_ID, BRANCH),
      assignSequence(deps(), REPOSITORY_ID, 'feature'),
    ]);

    expect(main.kind).toBe('assigned');
    expect(feature.kind).toBe('assigned');
  });
});

describe('DoD 7: 그래프 실패는 `stale`이고 기존 값을 보존한다', () => {
  it('**미러를 읽지 못하면 공간이 `stale`이 되고 시퀀스는 그대로다**', async () => {
    await registerRepository();
    await assignSequence(deps(), REPOSITORY_ID, BRANCH);
    const before = await storedSequence();

    // 미러가 없는 루트를 가리키는 그래프 — 읽기가 실패한다.
    const brokenRoot = await makeTempDir('prs-seq-broken-');
    const broken = new MirrorCommitGraph({ root: brokenRoot, repositoryIdOf: () => REPOSITORY_ID });
    const outcome = await assignSequence(deps({ graphFor: (): CommitGraph => broken }), REPOSITORY_ID, BRANCH);
    await removeDir(brokenRoot);

    expect(outcome.kind).toBe('stale');

    const space = await sequenceSpaceRepo.findSequenceSpace(pool, REPOSITORY_ID, BRANCH);
    expect(space?.state).toBe('stale');
    expect(space?.last_error).not.toBeNull();

    // 읽지 못한 것과 값이 틀린 것은 다르다. 지우면 그 사이 모든 범위 인용이 죽는다.
    expect(await storedSequence()).toEqual(before);
  });

  it('**첫 채번이 실패해도 공간이 `stale`로 남는다** — 시험이 잡아낸 결함이다', async () => {
    /*
     * 채번의 첫 시도에서 그래프를 읽지 못하면 공간을 만든 트랜잭션이
     * 롤백된다. `markStale`이 `UPDATE`였을 때는 갱신할 행이 없어 0행이
     * 갱신됐고, 그 저장소는 **`stale`로 표시되지도 경보가 울리지도 않은 채**
     * 조용히 아무 시퀀스도 갖지 못했다. 운영자가 볼 신호가 하나도 없었다.
     */
    await registerRepository();

    const brokenRoot = await makeTempDir('prs-seq-first-fail-');
    const broken = new MirrorCommitGraph({ root: brokenRoot, repositoryIdOf: () => REPOSITORY_ID });
    const outcome = await assignSequence(deps({ graphFor: (): CommitGraph => broken }), REPOSITORY_ID, BRANCH);
    await removeDir(brokenRoot);

    expect(outcome.kind).toBe('stale');

    const space = await sequenceSpaceRepo.findSequenceSpace(pool, REPOSITORY_ID, BRANCH);
    expect(space, '첫 실패에서 시퀀스 공간이 아예 만들어지지 않았다').toBeDefined();
    expect(space?.state).toBe('stale');
    expect(space?.last_error).not.toBeNull();
  });
});

describe('히스토리 재작성은 재채번으로 이어진다 (WP-022, FR-SEQ-005)', () => {
  it('**재작성을 감지하면 에폭을 올려 재채번하고 이전 에폭 행을 보존한다**', async () => {
    /*
     * WP-021 시점에는 감지만 하고 `stale`로 멈추는 것이 계약이었다.
     * WP-022가 그 자리를 재채번으로 이었다 — 이전 에폭 행은 그대로 남는다
     * (이전 인용을 해석할 근거다). 재채번 자체의 전 경로는
     * `reassign.test.ts`가 건다.
     */
    await registerRepository();
    await assignSequence(deps(), REPOSITORY_ID, BRANCH);

    // `storedSequence()`는 에폭 구분이 없다 — 재채번 뒤에는 두 에폭이 섞이므로
    // 이 시험만 에폭을 직접 거른다.
    const epochRows = async (epoch: number): Promise<unknown[]> =>
      (
        await pool.query(
          `SELECT merge_seq, commit_sha FROM merge_sequence
            WHERE repository_id = $1 AND base_branch = $2 AND seq_epoch = $3 ORDER BY merge_seq`,
          [REPOSITORY_ID, BRANCH, epoch],
        )
      ).rows;
    const before = await epochRows(1);

    await rewriteHistory(origin.dir);
    await cloneMirror();

    const outcome = await assignSequence(deps(), REPOSITORY_ID, BRANCH);
    expect(outcome.kind).toBe('reassigned');

    // 이전 에폭(1) 행은 조용히 다시 매겨지지 않고 그대로 남는다.
    expect(await epochRows(1)).toEqual(before);

    const space = await sequenceSpaceRepo.findSequenceSpace(pool, REPOSITORY_ID, BRANCH);
    expect(space?.seq_epoch).toBe(2);
    expect(space?.state).toBe('ok');
  });
});

describe('채번 대상 판정', () => {
  it('등록되지 않은 저장소는 건너뛴다 — 실패가 아니다', async () => {
    const outcome = await assignSequence(deps(), REPOSITORY_ID, BRANCH);
    expect(outcome).toEqual({ kind: 'skipped', reason: 'repository_unregistered' });
    expect(await storedSequence()).toEqual([]);
  });

  it('등록 해제된 저장소는 건너뛴다', async () => {
    await registerRepository({ status: 'archived' });
    const outcome = await assignSequence(deps(), REPOSITORY_ID, BRANCH);
    expect(outcome).toEqual({ kind: 'skipped', reason: 'repository_archived' });
  });

  it('채번 대상이 아닌 브랜치는 건너뛴다 (FR-ING-009 AC-2)', async () => {
    await registerRepository({ sequence_branches: ['release/2026'] });
    const outcome = await assignSequence(deps(), REPOSITORY_ID, BRANCH);
    expect(outcome).toEqual({ kind: 'skipped', reason: 'not_sequence_branch' });
    expect(await storedSequence()).toEqual([]);
  });

  it('없는 브랜치는 `no_branch`다 — 오류가 아니라 채번할 것이 없다는 뜻이다', async () => {
    await registerRepository({ sequence_branches: ['no-such-branch'] });
    const outcome = await assignSequence(deps(), REPOSITORY_ID, 'no-such-branch');
    expect(outcome).toEqual({ kind: 'no_branch' });
  });
});

describe('EVT-SEQ-001 발행 (DEV-121)', () => {
  it('채번 뒤에 이벤트를 낸다', async () => {
    await registerRepository();
    await assignSequence(deps(), REPOSITORY_ID, BRANCH, 'corr-1');

    const event = published.find(
      (p) => (p.envelope as { event_name?: string }).event_name === 'sequence.assigned',
    );
    expect(event).toBeDefined();
    expect(event?.key).toBe(`${String(REPOSITORY_ID)}:${BRANCH}`);
    expect((event?.envelope as { correlation_id?: string }).correlation_id).toBe('corr-1');
    const chain = await firstParentOf(origin.dir, BRANCH);
    expect((event?.envelope as { payload?: { from_seq?: number; to_seq?: number } }).payload).toMatchObject({
      from_seq: 0,
      to_seq: chain.length,
    });
  });

  it('새 커밋이 없어도 이벤트를 낸다 — 내지 않으면 "채번이 돌긴 했나"를 알 수 없다', async () => {
    await registerRepository();
    await assignSequence(deps(), REPOSITORY_ID, BRANCH);
    published = [];

    await assignSequence(deps(), REPOSITORY_ID, BRANCH);
    expect(
      published.some((p) => (p.envelope as { event_name?: string }).event_name === 'sequence.assigned'),
    ).toBe(true);
  });
});

describe('시퀀스 공간 상태 게이지 (관측 문서 RB-10)', () => {
  it('**`stale`이 복구되면 게이지가 따라 내려간다** — 올리기만 하면 경보가 영원히 울린다', async () => {
    await registerRepository();
    const metrics = createWorkerMetrics();

    const brokenRoot = await makeTempDir('prs-seq-broken2-');
    const broken = new MirrorCommitGraph({ root: brokenRoot, repositoryIdOf: () => REPOSITORY_ID });
    await assignSequence(deps({ metrics, graphFor: (): CommitGraph => broken }), REPOSITORY_ID, BRANCH);
    await removeDir(brokenRoot);

    expect(metrics.sequenceSpaceState.get({ state: 'stale' })).toBe(1);

    // 미러가 돌아오면 다음 회차가 공간을 `ok`로 되돌린다.
    await assignSequence(deps({ metrics }), REPOSITORY_ID, BRANCH);

    expect(metrics.sequenceSpaceState.get({ state: 'stale' })).toBe(0);
    expect(metrics.sequenceSpaceState.get({ state: 'ok' })).toBe(1);
  });
});

describe('머지 시퀀스 손상 감지 (DEV-118)', () => {
  it('같은 서수에 다른 커밋을 쓰려 하면 던진다 — 경합이 아니라 손상이다', async () => {
    await registerRepository();
    await assignSequence(deps(), REPOSITORY_ID, BRANCH);

    await expect(
      mergeSequenceRepo.upsertMergeSequence(pool, {
        repository_id: REPOSITORY_ID,
        base_branch: BRANCH,
        seq_epoch: 1,
        merge_seq: 1,
        commit_sha: 'f'.repeat(40),
        pull_request_number: null,
        committed_at: new Date(),
      }),
    ).rejects.toThrow(/다른 커밋/);
  });
});
