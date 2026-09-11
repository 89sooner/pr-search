/**
 * WP-074 FR-SEQ-008 AC-11 — T03a · T03b: 채번 전 미러 최신화 (DEV-576).
 *
 * ## 수정 전 재현부터 한다
 *
 * 실행서 4장이 요구하는 순서다: old mirror의 head가 A까지 fetch됨 → remote에 커밋
 * 추가 → **기존 경로**(`assignSequence`, fetch 없음)로 채번 → 옛 head를 읽어 새 서수
 * 없음. 그 뒤 **같은 픽스처·같은 상태**에서 freshness 진입으로 채번하면 fetch가
 * 먼저 돌고 새 서수가 붙는다. 앞 재현이 "정상 종료"인 것이 이 결함의 성질이다.
 *
 * Elasticsearch를 요구하지 않는다 — 대역이 `updateByQuery`만 흉내 낸다.
 *
 * 실행: `pnpm exec vitest run --config vitest.integration.config.ts apps/pipeline-worker/integration/sequence/freshness`
 */

import type { Client } from '@elastic/elasticsearch';
import type { EventBus } from '@prs/bus';
import { MirrorCommitGraph, MirrorSync, type CommitGraph } from '@prs/github';
import { repositoryRepo, sequenceSpaceRepo, sequenceWorkRepo, mergeSequenceRepo, type Pool } from '@prs/db';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { migratedPool, truncate } from '../../../../packages/db/integration/helpers.js';
import { withMirrorLock } from '../../src/mirror-lock.js';
import { createWorkerMetrics } from '../../src/metrics.js';
import { assignSequence, prepareAndAssignSequence, type SequenceDeps } from '../../src/sequence.js';
import { runSequenceWorkOnce } from '../../src/sequence-work-runner.js';
import { appendCommit, createSequenceFixture, firstParentOf, makeTempDir, removeDir, run, type SequenceFixture } from './fixture.js';

const REPOSITORY_ID = 7421;
const OWNER = 'acme';
const NAME = 'smp1900';
const BRANCH = 'main';

let pool: Pool;
let origin: SequenceFixture;
let mirrorRoot: string;

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

function mirrorSyncTo(url: string): MirrorSync {
  return new MirrorSync({ root: mirrorRoot, remoteUrl: () => url });
}

function deps(overrides: Partial<SequenceDeps> = {}): SequenceDeps {
  const graph = new MirrorCommitGraph({ root: mirrorRoot, repositoryIdOf: () => REPOSITORY_ID });
  return {
    pool,
    es: fakeEs(),
    bus: fakeBus(),
    metrics: createWorkerMetrics(),
    graphFor: (): CommitGraph => graph,
    freshness: { pool, mode: 'mirror', sync: mirrorSyncTo(origin.url) },
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

async function storedHeadSeq(): Promise<number> {
  const space = await sequenceSpaceRepo.findSequenceSpace(pool, REPOSITORY_ID, BRANCH);
  return Number(space?.head_seq ?? 0);
}

async function enqueueRefresh(deliveryId: string, headSha: string, receivedAt = new Date()): Promise<void> {
  await sequenceWorkRepo.enqueueRefreshWork(pool, {
    deliveryId,
    repositoryId: REPOSITORY_ID,
    baseBranch: BRANCH,
    headSha,
    receivedAt,
    correlationId: `corr-${deliveryId}`,
  });
}

beforeAll(async () => {
  pool = await migratedPool();
}, 120_000);

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await truncate(pool, 'sequence_latency_sample', 'sequence_work', 'mnumber_evidence', 'merge_sequence', 'sequence_space', 'repository');
  origin = await createSequenceFixture();
  mirrorRoot = await makeTempDir('prs-fresh-mirror-');
  await mirrorSyncTo(origin.url).sync({ owner: OWNER, repo: NAME }, REPOSITORY_ID);
  await registerRepository();
}, 60_000);

afterEach(async () => {
  await removeDir(origin.dir);
  await removeDir(mirrorRoot);
});

describe('T03a: 낡았지만 읽히는 미러 — 수정 전 재현과 수정 후', () => {
  it('**수정 전 경로는 옛 head를 읽고 "새 커밋 없음"으로 정상 종료한다** (DEV-576 재현)', async () => {
    // 1. 미러가 4개 커밋까지 fetch된 상태에서 첫 채번.
    const first = await assignSequence(deps(), REPOSITORY_ID, BRANCH);
    expect(first).toMatchObject({ kind: 'assigned', fromSeq: 0, toSeq: 4 });

    // 2. 원격에 커밋이 하나 더 들어온다 (push). 미러는 그것을 모른다.
    const newSha = await appendCommit(origin.dir, 'c5');
    expect((await firstParentOf(origin.dir, BRANCH)).length).toBe(5);

    // 3. 기존 경로: fetch 없이 채번 — 오류 없이 toSeq가 그대로다. 이것이 결함의 모양이다.
    const stale = await assignSequence(deps(), REPOSITORY_ID, BRANCH);
    expect(stale).toMatchObject({ kind: 'assigned', fromSeq: 4, toSeq: 4 });
    expect(await storedHeadSeq()).toBe(4);
    expect(await mergeSequenceRepo.findByCommitSha(pool, REPOSITORY_ID, newSha)).toEqual([]);

    // 4. freshness 진입: fetch → 채번. 같은 push가 이번에는 서수를 받는다.
    const fresh = await prepareAndAssignSequence(deps(), REPOSITORY_ID, BRANCH);
    expect(fresh.kind).toBe('done');
    if (fresh.kind !== 'done') return;
    expect(fresh.fetch).toMatchObject({ mode: 'mirror', action: 'fetched' });
    expect(fresh.assign).toMatchObject({ kind: 'assigned', fromSeq: 4, toSeq: 5 });
    expect(await storedHeadSeq()).toBe(5);
    const row = (await mergeSequenceRepo.findByCommitSha(pool, REPOSITORY_ID, newSha))[0];
    expect(Number(row?.merge_seq)).toBe(5);
  });

  it('**fetch 순서가 채번보다 앞선다** — 호출 순서를 기록으로 단언한다', async () => {
    const calls: string[] = [];
    const sync = mirrorSyncTo(origin.url);
    const recordingSync = {
      root: sync.root,
      dirFor: (id: number) => sync.dirFor(id),
      hasBranch: (id: number, branch: string) => sync.hasBranch(id, branch),
      sync: async (ref: { owner: string; repo: string }, id: number) => {
        calls.push('fetch');
        return sync.sync(ref, id);
      },
    } as unknown as MirrorSync;
    const graph = new MirrorCommitGraph({ root: mirrorRoot, repositoryIdOf: () => REPOSITORY_ID });
    const recordingGraph: CommitGraph = {
      kind: 'mirror',
      resolveHead: async (ref, branch) => {
        calls.push('resolveHead');
        return graph.resolveHead(ref, branch);
      },
      isAncestor: (ref, a, b) => graph.isAncestor(ref, a, b),
      mergeBase: (ref, a, b) => graph.mergeBase(ref, a, b),
      firstParentRevList: (ref, range) => graph.firstParentRevList(ref, range),
      firstParentCommits: (ref, range) => graph.firstParentCommits(ref, range),
      patchId: (ref, sha) => graph.patchId(ref, sha),
      readCommit: (ref, sha) => graph.readCommit(ref, sha),
      changedPaths: (ref, sha, limit) => graph.changedPaths(ref, sha, limit),
    };
    await appendCommit(origin.dir, 'c5');
    const outcome = await prepareAndAssignSequence(
      deps({ graphFor: () => recordingGraph, freshness: { pool, mode: 'mirror', sync: recordingSync } }),
      REPOSITORY_ID,
      BRANCH,
    );
    expect(outcome.kind).toBe('done');
    expect(calls[0]).toBe('fetch');
    expect(calls.indexOf('resolveHead')).toBeGreaterThan(calls.indexOf('fetch'));
    expect(await storedHeadSeq()).toBe(5);
  });

  it('**fetch가 실패하면 채번하지 않는다** — 낡은 미러로 정상 채번을 만들지 않는다', async () => {
    await prepareAndAssignSequence(deps(), REPOSITORY_ID, BRANCH);
    await appendCommit(origin.dir, 'c5');
    await enqueueRefresh('d-fail', 'f'.repeat(40));

    /*
     * 이미 클론된 미러의 fetch는 **미러에 설정된 원격**을 쓴다 — `remoteUrl` 옵션은 클론
     * 때만 쓰인다. 그래서 원격 URL 자체를 없는 경로로 바꿔 fetch를 실패시킨다.
     */
    const sync = mirrorSyncTo(origin.url);
    await run(sync.dirFor(REPOSITORY_ID), ['remote', 'set-url', 'origin', 'file:///nonexistent/prs-fixture-that-does-not-exist']);
    const outcome = await prepareAndAssignSequence(deps({ freshness: { pool, mode: 'mirror', sync } }), REPOSITORY_ID, BRANCH, '', { leaseToken: null });
    expect(outcome).toMatchObject({ kind: 'failed', reason: 'mirror_sync_failed', retryable: true });
    // 서수는 그대로이고 refresh 의도는 covered로 닫히지 않는다.
    expect(await storedHeadSeq()).toBe(4);
    expect((await sequenceWorkRepo.findWork(pool, 'push:d-fail'))?.state).toBe('ready');
    // 공간은 stale이 아니다 — fetch 실패는 그래프 실패가 아니라 재시도 대상이다.
    expect((await sequenceSpaceRepo.findSequenceSpace(pool, REPOSITORY_ID, BRANCH))?.state).toBe('ok');
  });

  it('브랜치 삭제는 no_branch이며 기존 서수를 지우지 않는다', async () => {
    await prepareAndAssignSequence(deps(), REPOSITORY_ID, BRANCH);
    await repositoryRepo.updateRepositorySettings(pool, REPOSITORY_ID, { sequence_branches: [BRANCH, 'release'] });
    const outcome = await prepareAndAssignSequence(deps(), REPOSITORY_ID, 'release');
    expect(outcome.kind).toBe('done');
    if (outcome.kind === 'done') expect(outcome.assign.kind).toBe('no_branch');
    expect(await storedHeadSeq()).toBe(4);
  });

  it('API 모드와 mirror_enabled=false는 fetch 없이 진행한다 (Profile B)', async () => {
    const api = await prepareAndAssignSequence(deps({ freshness: { pool, mode: 'api' } }), REPOSITORY_ID, BRANCH);
    expect(api.kind).toBe('done');
    if (api.kind === 'done') expect(api.fetch).toMatchObject({ mode: 'api', action: null });
    await repositoryRepo.updateRepositorySettings(pool, REPOSITORY_ID, { mirror_enabled: false });
    const noMirror = await prepareAndAssignSequence(deps(), REPOSITORY_ID, BRANCH);
    expect(noMirror.kind).toBe('done');
    if (noMirror.kind === 'done') expect(noMirror.fetch.mode).toBe('api');
  });
});

describe('T03b: 중복·역순 push, 락 경합, 마지막 push 복구', () => {
  it('**성공한 fetch가 그 전에 도착한 push 의도를 전부 덮고, fetch 중 도착한 것은 남긴다**', async () => {
    const before = new Date(Date.now() - 1_000);
    await enqueueRefresh('d-1', 'a'.repeat(40), before);
    await enqueueRefresh('d-2', 'b'.repeat(40), before);
    // 역순·중복: 옛 head를 실은 push가 뒤에 와도 fetch는 원격의 현재를 읽는다.
    await enqueueRefresh('d-1-dup', 'a'.repeat(40), before);

    let late = false;
    const sync = mirrorSyncTo(origin.url);
    const slowSync = {
      root: sync.root,
      dirFor: (id: number) => sync.dirFor(id),
      hasBranch: (id: number, branch: string) => sync.hasBranch(id, branch),
      sync: async (ref: { owner: string; repo: string }, id: number) => {
        // fetch가 도는 동안 새 push가 도착한다.
        await enqueueRefresh('d-late', 'c'.repeat(40), new Date());
        late = true;
        return sync.sync(ref, id);
      },
    } as unknown as MirrorSync;

    const outcome = await prepareAndAssignSequence(deps({ freshness: { pool, mode: 'mirror', sync: slowSync } }), REPOSITORY_ID, BRANCH);
    expect(late).toBe(true);
    expect(outcome.kind).toBe('done');
    if (outcome.kind !== 'done') return;
    expect(outcome.covered.map((one) => one.payload.delivery_id).sort()).toEqual(['d-1', 'd-1-dup', 'd-2']);
    expect((await sequenceWorkRepo.findWork(pool, 'push:d-late'))?.state).toBe('ready');
    for (const key of ['push:d-1', 'push:d-2', 'push:d-1-dup']) {
      expect((await sequenceWorkRepo.findWork(pool, key))?.state, key).toBe('done');
    }
  });

  it('**미러 락을 다른 호출자가 쥐고 있으면 defer한다** — 같은 디렉터리에 두 fetch가 겹치지 않는다', async () => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const holder = withMirrorLock(pool, REPOSITORY_ID, async () => { await held; });
    await new Promise((resolve) => { setTimeout(resolve, 100); });

    const outcome = await prepareAndAssignSequence(deps(), REPOSITORY_ID, BRANCH);
    expect(outcome).toMatchObject({ kind: 'defer', reason: 'mirror_locked' });
    release();
    await holder;

    const after = await prepareAndAssignSequence(deps(), REPOSITORY_ID, BRANCH);
    expect(after.kind).toBe('done');
  });

  it('**durable 러너가 refresh 의도를 집어 채번하고 covered로 닫는다** — 마지막 push 복구', async () => {
    await appendCommit(origin.dir, 'c5');
    await enqueueRefresh('d-runner', 'd'.repeat(40));
    const metrics = createWorkerMetrics();
    const round = await runSequenceWorkOnce({ pool, sequence: deps({ metrics }), mnumber: null, metrics });
    expect(round.claimed).toBe(1);
    expect(round.outcomes['refresh:assigned']).toBe(1);
    expect((await sequenceWorkRepo.findWork(pool, 'push:d-runner'))?.state).toBe('done');
    expect(await storedHeadSeq()).toBe(5);
    // 채번 트랜잭션이 reconcile 의도를 같은 커밋으로 남겼다 (AC-11).
    const works = await sequenceWorkRepo.listWorkForSpace(pool, REPOSITORY_ID, BRANCH, ['reconcile']);
    expect(works).toHaveLength(1);
    expect(works[0]?.state).toBe('ready');
    // M 기능이 꺼져 있으면 reconcile은 집지 않는다 — 다음 회차 claim 0.
    const idle = await runSequenceWorkOnce({ pool, sequence: deps({ metrics }), mnumber: null, metrics });
    expect(idle.claimed).toBe(0);
  });

  it('러너가 lease를 잃으면 결과를 기록하지 않는다 (0행) — 늦은 ack', async () => {
    await enqueueRefresh('d-lost', 'e'.repeat(40));
    const [claimed] = await sequenceWorkRepo.claimDueWork(pool, { kinds: ['refresh'], limit: 1, leaseMs: 60_000 });
    // 다른 워커가 lease를 회수해 집은 상황을 흉내 낸다.
    await pool.query(`UPDATE sequence_work SET lease_until = now() - interval '1 second' WHERE work_key = $1`, [claimed!.work_key]);
    await sequenceWorkRepo.reclaimExpiredLeases(pool);
    const [second] = await sequenceWorkRepo.claimDueWork(pool, { kinds: ['refresh'], limit: 1, leaseMs: 60_000 });
    expect(second?.lease_token).not.toBe(claimed?.lease_token);
    const stale = await sequenceWorkRepo.completeWork(pool, { workKey: claimed!.work_key, leaseToken: claimed!.lease_token! }, claimed!.requested_generation);
    expect(stale).toBe(false);
    expect((await sequenceWorkRepo.findWork(pool, 'push:d-lost'))?.state).toBe('leased');
  });
});
