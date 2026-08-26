/**
 * JOB-REL-007 릴리스 스냅숏 동기화 — 실제 git + 실제 PostgreSQL (WP-024 / CR-028).
 *
 * ## 무엇이 진짜이고 무엇이 대역인가
 *
 * git(원본·미러)과 PostgreSQL은 진짜다 — **태그의 정본이 미러라는 주장(DEV-143)과
 * 릴리스의 정본이 PostgreSQL이라는 주장(DEV-142)은 진짜 위에서만 검증된다.**
 * Elasticsearch만 대역이다: 투영·비정규화가 "무엇을 보냈는가"를 기록해 단언하고,
 * 그 질의가 진짜 색인에서 도는지는 CI의 실-ES 계층이 본다.
 *
 * 실행: `pnpm test:integration release/refresh`
 */

import { MirrorCommitGraph, MirrorSync } from '@prs/github';
import {
  mergeSequenceRepo,
  releaseRepo,
  repositoryRepo,
  sequenceSpaceRepo,
  withTransaction,
  releaseLockKey,
  type Pool,
} from '@prs/db';
import type { Client } from '@elastic/elasticsearch';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createSequenceFixture,
  firstParentOf,
  makeTempDir,
  removeDir,
  run,
  type SequenceFixture,
} from '../sequence/fixture.js';
import { migratedPool, truncate } from '../../../../packages/db/integration/helpers.js';
import { numberCommits } from '../../src/sequence-plan.js';
import {
  handleReleaseEvent,
  publishedAtByTag,
  refreshReleases,
  startReleaseSweeper,
  type ReleaseDeps,
} from '../../src/release.js';
import { createWorkerMetrics } from '../../src/metrics.js';
import { MAX_RETRIES } from '@prs/bus';

const REPOSITORY_ID = 6101;
const REF = { owner: 'acme', repo: 'payments' };
const BRANCH = 'main';

let pool: Pool;
let origin: SequenceFixture;
let mirrorRoot: string;
let sync: MirrorSync;
let graph: MirrorCommitGraph;
/** git이 낸 first-parent 체인 (서수 1..N). */
let chain: readonly string[];

/** 대역 ES가 받은 호출 기록. */
let esCalls: { bulk: unknown[]; updateByQuery: unknown[]; deleteByQuery: unknown[] };
let esFailNext: boolean;

function stubEs(): Client {
  return {
    bulk: (request: unknown) => {
      if (esFailNext) return Promise.reject(new Error('es down'));
      esCalls.bulk.push(request);
      const operations = (request as { operations?: unknown[] }).operations ?? [];
      const items = [];
      for (const op of operations) {
        const record = op as Record<string, Record<string, unknown>>;
        if (record['update'] !== undefined) items.push({ update: { status: 200, result: 'updated' } });
        else if (record['delete'] !== undefined) items.push({ delete: { status: 200, result: 'deleted' } });
      }
      return Promise.resolve({ errors: false, items });
    },
    updateByQuery: (request: unknown) => {
      if (esFailNext) return Promise.reject(new Error('es down'));
      esCalls.updateByQuery.push(request);
      return Promise.resolve({ updated: 0 });
    },
    deleteByQuery: (request: unknown) => {
      if (esFailNext) return Promise.reject(new Error('es down'));
      esCalls.deleteByQuery.push(request);
      return Promise.resolve({ deleted: 0, failures: [] });
    },
    // 걷어내기가 지우기 전에 refresh한다 — 검색 기반 삭제의 가시성 창 보정.
    indices: { refresh: () => Promise.resolve({}) },
  } as unknown as Client;
}

function deps(overrides: Partial<ReleaseDeps> = {}): ReleaseDeps {
  return {
    pool,
    es: stubEs(),
    bus: { publish: async () => undefined } as never,
    metrics: createWorkerMetrics(),
    sync: (ref, id) => sync.sync(ref, id),
    listTags: (ref) => graph.listTags(ref),
    log: () => undefined,
    ...overrides,
  };
}

/** 채번을 심는다 — 릴리스 서수 해석의 기반이다 (WP-021이 하는 일의 재현). */
async function seedSequence(epoch: number): Promise<void> {
  const head = (await run(origin.dir, ['rev-parse', BRANCH])).trim();
  const commits = await graph.firstParentCommits(REF, { from: null, to: head });
  for (const entry of numberCommits(0, commits)) {
    await mergeSequenceRepo.upsertMergeSequence(pool, {
      repository_id: REPOSITORY_ID,
      base_branch: BRANCH,
      seq_epoch: epoch,
      merge_seq: entry.mergeSeq,
      commit_sha: entry.sha,
      pull_request_number: entry.sha === origin.mergeSha ? 42 : null,
      committed_at: new Date(entry.committedAt),
    });
  }
  chain = commits.map((commit) => commit.sha);
}

beforeAll(async () => {
  pool = await migratedPool();

  origin = await createSequenceFixture();
  // 태그 넷: 체인 위 경량, 체인 위 주석, 체인 밖(피처 브랜치 커밋),
  // 그리고 **뒤 커밋에 과거 시각으로 단 주석 태그** — 시각 순서가 체인 순서·
  // 이름 순서와 달라야 "released_at 오름차순"이 진짜로 검증된다.
  const mainChain = await firstParentOf(origin.dir, BRANCH);
  await run(origin.dir, ['tag', 'rel-1', mainChain[1]!]);
  await run(origin.dir, ['tag', '-a', 'rel-2-annotated', '-m', 'second', origin.mergeSha]);
  await run(origin.dir, ['tag', '-a', 'zz-oldest', '-m', 'backdated', mainChain[3]!], {
    GIT_COMMITTER_DATE: '2020-01-01T00:00:00 +0000',
  });
  const featureSha = (await run(origin.dir, ['rev-parse', 'feature'])).trim();
  await run(origin.dir, ['tag', 'off-chain', featureSha]);

  mirrorRoot = await makeTempDir('prs-release-refresh-');
  sync = new MirrorSync({ root: mirrorRoot, remoteUrl: () => origin.url });
  graph = new MirrorCommitGraph({ root: mirrorRoot, repositoryIdOf: () => REPOSITORY_ID });

  // 스위트 간 (owner, name) 충돌을 남기지 않도록 통째로 비운다 — 파일 병렬성이
  // 꺼져 있어(vitest.integration.config.ts) 다른 파일과 경합하지 않는다.
  await truncate(pool, 'release', 'merge_sequence', 'sequence_space', 'repository');

  await repositoryRepo.upsertRepository(pool, {
    repository_id: REPOSITORY_ID,
    owner: REF.owner,
    name: REF.repo,
    org_id: 1,
    visibility: 'internal',
    sequence_branches: [BRANCH],
  });
  await sequenceSpaceRepo.ensureSequenceSpace(pool, REPOSITORY_ID, BRANCH);
  await sync.sync(REF, REPOSITORY_ID);
  await seedSequence(1);
}, 180_000);

beforeEach(() => {
  esCalls = { bulk: [], updateByQuery: [], deleteByQuery: [] };
  esFailNext = false;
});

afterAll(async () => {
  await pool?.end();
  await removeDir(origin.dir);
  await removeDir(mirrorRoot);
});

describe('스냅숏 동기화 (DEV-142·143)', () => {
  it('**미러의 태그 전량이 정본에 실리고, 체인 위 태그만 서수를 받는다**', async () => {
    const outcome = await refreshReleases(deps(), REPOSITORY_ID, 'test-1');
    expect(outcome.kind).toBe('refreshed');
    if (outcome.kind !== 'refreshed') return;
    expect(outcome.tagCount).toBe(4);
    expect(outcome.resolvedCount).toBe(3);

    const rows = await releaseRepo.listReleases(pool, REPOSITORY_ID);
    expect(rows.map((row) => row.tag_name).sort()).toEqual([
      'off-chain',
      'rel-1',
      'rel-2-annotated',
      'zz-oldest',
    ]);

    const rel1 = rows.find((row) => row.tag_name === 'rel-1');
    expect(rel1?.base_branch).toBe(BRANCH);
    expect(Number(rel1?.merge_seq)).toBe(2);

    // 주석 태그가 태그 객체가 아니라 **peel된 커밋**으로 해석됐는가 (DEV-143).
    const rel2 = rows.find((row) => row.tag_name === 'rel-2-annotated');
    expect(rel2?.commit_sha).toBe(origin.mergeSha);
    expect(Number(rel2?.merge_seq)).toBe(3);

    // 체인 밖 태그는 서수 셋이 함께 NULL이다 — 반쪽 상태를 만들지 않는다.
    const off = rows.find((row) => row.tag_name === 'off-chain');
    expect(off?.base_branch).toBeNull();
    expect(off?.seq_epoch).toBeNull();
    expect(off?.merge_seq).toBeNull();
  });

  it('갱신은 멱등이다 — 두 번 돌려도 행 수·값이 같다', async () => {
    await refreshReleases(deps(), REPOSITORY_ID);
    const first = await releaseRepo.listReleases(pool, REPOSITORY_ID);
    await refreshReleases(deps(), REPOSITORY_ID);
    const second = await releaseRepo.listReleases(pool, REPOSITORY_ID);
    expect(second.map((row) => [row.tag_name, row.commit_sha, row.merge_seq])).toEqual(
      first.map((row) => [row.tag_name, row.commit_sha, row.merge_seq]),
    );
  });

  it('**원격에서 지운 태그가 정본과 색인 삭제 목록에서 함께 사라진다** (DoD: 자가 치유)', async () => {
    await run(origin.dir, ['tag', 'doomed', chain[0]!]);
    await refreshReleases(deps(), REPOSITORY_ID);
    expect((await releaseRepo.listReleases(pool, REPOSITORY_ID)).map((row) => row.tag_name)).toContain('doomed');

    await run(origin.dir, ['tag', '-d', 'doomed']);
    const outcome = await refreshReleases(deps(), REPOSITORY_ID);
    if (outcome.kind !== 'refreshed') throw new Error(outcome.kind);
    expect(outcome.deletedCount).toBe(1);
    expect((await releaseRepo.listReleases(pool, REPOSITORY_ID)).map((row) => row.tag_name)).not.toContain('doomed');

    /*
     * 색인 쪽 삭제는 "지운 것"이 아니라 **"남길 것 밖 전부"의 질의 삭제**다 —
     * 회차의 부분 실패가 유령 문서로 남지 않고 다음 회차에 아문다 (수렴).
     * doomed는 남길 목록에 없어야 하고, 살아 있는 태그는 있어야 한다.
     */
    const prune = esCalls.deleteByQuery[esCalls.deleteByQuery.length - 1] as {
      routing?: string;
      query?: unknown;
    };
    expect(prune.routing).toBe(String(REPOSITORY_ID));
    const pruneJson = JSON.stringify(prune.query);
    expect(pruneJson).toContain('must_not');
    expect(pruneJson).not.toContain('doomed');
    expect(pruneJson).toContain('rel-1');
  });

  it('**`ci_deployment` 행은 diff 삭제에서 면제다** — 미러에 없는 것이 정상인 출처다 (OD-004)', async () => {
    /*
     * CI 배포 기록은 git 태그가 아니므로 미러 스냅숏에 나타나지 않는다.
     * 삭제 규칙이 출처를 안 가리면 매 갱신마다 CI 기록이 전부 지워진다.
     */
    await releaseRepo.upsertRelease(pool, {
      repository_id: REPOSITORY_ID,
      tag_name: 'deploy-20260819-01',
      commit_sha: chain[1]!,
      base_branch: BRANCH,
      seq_epoch: 1,
      merge_seq: 2,
      released_at: new Date('2026-08-19T00:00:00Z'),
      source: 'ci_deployment',
    });

    const outcome = await refreshReleases(deps(), REPOSITORY_ID);
    if (outcome.kind !== 'refreshed') throw new Error(outcome.kind);
    const names = (await releaseRepo.listReleases(pool, REPOSITORY_ID)).map((row) => row.tag_name);
    expect(names).toContain('deploy-20260819-01');

    await pool.query("DELETE FROM release WHERE repository_id = $1 AND source = 'ci_deployment'", [REPOSITORY_ID]);
  });

  it('**태그 강제 이동이 커밋·서수에 반영된다** (DoD: 자가 치유)', async () => {
    await run(origin.dir, ['tag', '-f', 'rel-1', chain[3]!]);
    try {
      await refreshReleases(deps(), REPOSITORY_ID);
      const row = await releaseRepo.findReleaseByTag(pool, REPOSITORY_ID, 'rel-1');
      expect(row?.commit_sha).toBe(chain[3]);
      expect(Number(row?.merge_seq)).toBe(4);
    } finally {
      await run(origin.dir, ['tag', '-f', 'rel-1', chain[1]!]);
      await refreshReleases(deps(), REPOSITORY_ID);
    }
  });

  it('**에폭이 올라가면 다음 갱신이 현재 에폭으로 재해석한다** (DEV-149)', async () => {
    await refreshReleases(deps(), REPOSITORY_ID);
    const before = await releaseRepo.findReleaseByTag(pool, REPOSITORY_ID, 'rel-1');
    expect(before?.seq_epoch).toBe(1);

    // 재채번의 결과를 재현한다: 에폭 +1, 새 에폭으로 같은 체인을 복사.
    const newEpoch = await sequenceSpaceRepo.bumpEpoch(pool, REPOSITORY_ID, BRANCH);
    await mergeSequenceRepo.copySequencesUpTo(pool, REPOSITORY_ID, BRANCH, 1, newEpoch, chain.length);
    await sequenceSpaceRepo.advanceHead(pool, REPOSITORY_ID, BRANCH, chain[chain.length - 1]!, chain.length);

    const outcome = await refreshReleases(deps(), REPOSITORY_ID);
    expect(outcome.kind).toBe('refreshed');
    const after = await releaseRepo.findReleaseByTag(pool, REPOSITORY_ID, 'rel-1');
    expect(after?.seq_epoch).toBe(newEpoch);
    expect(Number(after?.merge_seq)).toBe(2);
  });

  it('`released_at`이 git creatordate에서 온다 (DEV-147) — 지어낸 시각이 아니다', async () => {
    await refreshReleases(deps(), REPOSITORY_ID);
    const row = await releaseRepo.findReleaseByTag(pool, REPOSITORY_ID, 'rel-1');
    const tagDate = (await run(origin.dir, ['for-each-ref', 'refs/tags/rel-1', '--format=%(creatordate:iso-strict)'])).trim();
    expect(row?.released_at.toISOString()).toBe(new Date(tagDate).toISOString());
    expect(row?.source).toBe('git_tag');
  });
});

describe('GitHub Release 덮어쓰기 (DEV-147)', () => {
  it('발행된 릴리스의 published_at이 같은 태그의 시각을 덮고 source가 바뀐다', async () => {
    const outcome = await refreshReleases(
      deps({
        listReleases: async () => [
          { id: 1, tag_name: 'rel-1', draft: false, prerelease: false, published_at: '2026-08-20T12:00:00Z' },
          { id: 2, tag_name: 'rel-2-annotated', draft: true, prerelease: false, published_at: '2026-08-21T00:00:00Z' },
        ],
      }),
      REPOSITORY_ID,
    );
    expect(outcome.kind).toBe('refreshed');

    const overlaid = await releaseRepo.findReleaseByTag(pool, REPOSITORY_ID, 'rel-1');
    expect(overlaid?.released_at.toISOString()).toBe('2026-08-20T12:00:00.000Z');
    expect(overlaid?.source).toBe('github_release');

    // 초안은 걸러진다 — 발행되지 않은 릴리스는 앵커가 아니다.
    const draft = await releaseRepo.findReleaseByTag(pool, REPOSITORY_ID, 'rel-2-annotated');
    expect(draft?.source).toBe('git_tag');
  });

  it('publishedAtByTag가 초안·미발행을 거른다', () => {
    const byTag = publishedAtByTag([
      { id: 1, tag_name: 'a', draft: false, prerelease: false, published_at: '2026-01-01T00:00:00Z' },
      { id: 2, tag_name: 'b', draft: true, prerelease: false, published_at: '2026-01-02T00:00:00Z' },
      { id: 3, tag_name: 'c', draft: false, prerelease: false, published_at: null },
    ]);
    expect([...byTag.keys()]).toEqual(['a']);
  });

  it('GHE 조회 실패는 git_tag 값으로 계속 간다 — 덮어쓰기는 보강이지 조건이 아니다', async () => {
    const outcome = await refreshReleases(
      deps({ listReleases: async () => Promise.reject(new Error('ghe down')) }),
      REPOSITORY_ID,
    );
    expect(outcome.kind).toBe('refreshed');
    expect((await releaseRepo.findReleaseByTag(pool, REPOSITORY_ID, 'rel-1'))?.source).toBe('git_tag');
  });
});

describe('실패 갈래', () => {
  it('**미러 동기화 실패는 아무것도 바꾸지 않는다** — 오래된 스냅숏으로 지우는 것이 최악이다', async () => {
    await refreshReleases(deps(), REPOSITORY_ID);
    const before = (await releaseRepo.listReleases(pool, REPOSITORY_ID)).length;

    const outcome = await refreshReleases(
      deps({ sync: async () => Promise.reject(new Error('network down')) }),
      REPOSITORY_ID,
    );
    expect(outcome).toEqual({ kind: 'failed', reason: 'mirror_sync_failed' });
    expect((await releaseRepo.listReleases(pool, REPOSITORY_ID)).length).toBe(before);
  });

  it('등록되지 않은 저장소는 skip이다', async () => {
    const outcome = await refreshReleases(deps(), 999_999);
    expect(outcome).toEqual({ kind: 'skipped', reason: 'repository_not_registered' });
  });

  it('**락 경합이면 locked다** — diff는 멱등이라 그쪽 결과가 곧 이쪽 결과다', async () => {
    await withTransaction(pool, async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [releaseLockKey(REPOSITORY_ID)]);
      const outcome = await refreshReleases(deps(), REPOSITORY_ID);
      expect(outcome).toEqual({ kind: 'locked' });
    });
  });

  it('**색인 실패는 갱신을 실패시키지 않는다** — 정본이 먼저다 (ADR-004)', async () => {
    esFailNext = true;
    const outcome = await refreshReleases(deps(), REPOSITORY_ID);
    expect(outcome.kind).toBe('refreshed');
    // 정본은 갱신됐다.
    expect((await releaseRepo.listReleases(pool, REPOSITORY_ID)).length).toBeGreaterThan(0);
  });

  const releaseEvent = (deliveryCount: number): never =>
    ({
      payload: { repository_id: REPOSITORY_ID, correlation_id: 'evt-1' },
      correlation_id: 'evt-1',
      delivery_count: deliveryCount,
    }) as never;

  it('**일시 실패 이벤트는 ack가 아니라 retry다** — 예산 안에서는 다시 시도한다', async () => {
    /*
     * ack하면 XACK로 사라져 문서화된 3회 백오프(비동기 문서 4장)를 쓰지 못하고,
     * 일시 장애가 "다음 웹훅 또는 6시간 스윕까지 지연"으로 확대된다.
     */
    const disposition = await handleReleaseEvent(
      deps({ sync: async () => Promise.reject(new Error('network down')) }),
      releaseEvent(1),
    );
    expect(disposition).toEqual({ kind: 'retry', reason: 'mirror_sync_failed' });

    // 성공은 그대로 ack다.
    expect(await handleReleaseEvent(deps(), releaseEvent(1))).toEqual({ kind: 'ack' });
  });

  it('**예산을 소진하면 종료 처분으로 파티션을 푼다** (CR-039, DEV-228)', async () => {
    /*
     * 이 자리는 원래 `delivery_count`를 보지 않고 무조건 `retry`를 냈다. 주석은
     * "버스가 재시도 예산을 집행한다"고 적었지만 **버스는 그러지 않는다** —
     * 두 어댑터 모두 `retry`를 받으면 백오프만 늘리고 횟수 상한을 보지 않는다.
     * 그래서 영구 실패가 무한히 재시도되며 그 파티션의 뒤 이벤트를 영영 막았다
     * (PR #30의 P1 지적, 미해결로 남아 있었다).
     *
     * 릴리스 스냅숏은 6시간 보정 스윕과 재채번 후 재동기화라는 다른 경로가
     * 있으므로 종료 처분이 유실이 아니다.
     */
    const permanent = deps({ sync: async () => Promise.reject(new Error('mirror gone forever')) });

    // 예산 안: 다시 시도한다.
    expect(await handleReleaseEvent(permanent, releaseEvent(MAX_RETRIES - 1))).toEqual({
      kind: 'retry',
      reason: 'mirror_sync_failed',
    });

    // 소진: 파티션을 푼다.
    expect(await handleReleaseEvent(permanent, releaseEvent(MAX_RETRIES))).toEqual({
      kind: 'dead_letter',
      reason: 'mirror_sync_failed',
    });
    expect(await handleReleaseEvent(permanent, releaseEvent(MAX_RETRIES + 5))).toEqual({
      kind: 'dead_letter',
      reason: 'mirror_sync_failed',
    });
  });
});

describe('보정 스윕의 종료 (SIGTERM)', () => {
  it('**대기 중에도 stop()이 즉시 돌아온다** — 6시간 타이머를 기다리면 강제 종료된다', async () => {
    const sweeper = startReleaseSweeper(deps(), { intervalMs: 6 * 60 * 60 * 1_000 });
    // 첫 회차(이 저장소 하나)가 sleep에 들어갈 시간을 준다.
    await new Promise((resolve) => setTimeout(resolve, 400));

    const startedAt = Date.now();
    await sweeper.stop();
    expect(Date.now() - startedAt).toBeLessThan(2_000);
  });
});

describe('색인 투영과 비정규화의 모양', () => {
  it('배지 비정규화가 released_at 오름차순 목록과 에폭 필터를 싣는다 (DEV-148·149)', async () => {
    await refreshReleases(deps(), REPOSITORY_ID);
    expect(esCalls.updateByQuery.length).toBeGreaterThan(0);

    const first = esCalls.updateByQuery[0] as {
      query?: unknown;
      script?: { params?: { releases?: { tag: string; seq: number }[] } };
    };
    const json = JSON.stringify(first.query);
    expect(json).toContain('seq_epoch');
    expect(json).toContain('base_branch');

    const sent = first.script?.params?.releases ?? [];
    /*
     * 체인 위 셋만, **released_at 오름차순으로** 실린다 — 체인 밖 태그는 비교할
     * 서수가 없다. zz-oldest는 체인 마지막 커밋의 태그이지만 시각이 2020년이라
     * 맨 앞이어야 한다: 순서가 이름·체인 순서로 새면 여기서 갈린다. 스크립트는
     * 앞에서부터 5개에서 멈추므로(DEV-148) 이 순서가 곧 "가장 이른 5개"다.
     */
    expect(sent.map((release) => release.tag)).toEqual(['zz-oldest', 'rel-1', 'rel-2-annotated']);
  });
});
