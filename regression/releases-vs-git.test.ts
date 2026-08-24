/**
 * 포함 판정과 `git merge-base --is-ancestor`의 일치 (WP-024 DoD / FR-REL-002).
 *
 * ## 이 파일이 묻는 것
 *
 * **"우리가 '이 릴리스에 포함된다'고 말한 것을 git도 그렇게 말하는가"** 하나다.
 * 포함 판정은 정수 비교(`target.merge_seq <= release.merge_seq`)로 구현돼
 * 있지만, 그 비교가 옳다는 근거는 "first-parent 체인 위에서 앞선 커밋은 뒤
 * 커밋의 조상이다"라는 git의 사실이다 (ADR-007). 그래서 정답은 우리 코드가
 * 아니라 `git merge-base --is-ancestor`가 낸다 — 기대값을 손으로 적지 않는다.
 *
 * 릴리스 행 자체도 손으로 심지 않고 **실제 JOB-REL-007(`refreshReleases`)**이
 * 미러에서 만들게 한다 — 수집이 틀리면 판정 대조가 그것까지 잡아야 한다.
 *
 * 실행: `pnpm test:regression releases-vs-git`
 */

import { MirrorCommitGraph, MirrorSync } from '@prs/github';
import {
  createPool,
  mergeSequenceRepo,
  releaseRepo,
  repositoryRepo,
  resolvePoolConfig,
  sequenceSpaceRepo,
  type Pool,
} from '@prs/db';
import { migrateUp } from '@prs/db/migrate';
import type { Client } from '@elastic/elasticsearch';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  appendCommit,
  createSequenceFixture,
  git,
  makeTempDir,
  removeDir,
  run,
  type SequenceFixture,
} from '../apps/pipeline-worker/integration/sequence/fixture.js';
import { numberCommits } from '../apps/pipeline-worker/src/sequence-plan.js';
import { refreshReleases, type ReleaseDeps } from '../apps/pipeline-worker/src/release.js';
import { createWorkerMetrics } from '../apps/pipeline-worker/src/metrics.js';

const REPOSITORY_ID = 9004;
const REF = { owner: 'acme', repo: 'rel-regress' };
const BRANCH = 'main';
const EPOCH = 1;

/** 체인 위 태그 셋. 값은 픽스처가 아니라 git에서 다시 읽는다. */
const ON_CHAIN_TAGS = ['rel-early', 'rel-merge', 'rel-head'] as const;

let origin: SequenceFixture;
let mirrorRoot: string;
let pool: Pool;
/** 서수 → SHA (git이 낸 first-parent 순서 그대로). */
let chain: readonly string[];
/** 태그명 → 그 태그가 가리키는 커밋 (`^{commit}`으로 peel한 값). */
let tagCommit: Map<string, string>;

function stubEs(): Client {
  return {
    bulk: (request: unknown) => {
      const operations = (request as { operations?: unknown[] }).operations ?? [];
      const items = [];
      for (const op of operations) {
        const record = op as Record<string, unknown>;
        if (record['update'] !== undefined) items.push({ update: { status: 200, result: 'updated' } });
        else if (record['delete'] !== undefined) items.push({ delete: { status: 200, result: 'deleted' } });
      }
      return Promise.resolve({ errors: false, items });
    },
    updateByQuery: () => Promise.resolve({ updated: 0 }),
    deleteByQuery: () => Promise.resolve({ deleted: 0, failures: [] }),
  } as unknown as Client;
}

/** `git merge-base --is-ancestor A B` — 판정의 정답. 종료 코드 0=조상, 1=아님. */
async function gitContains(commitSha: string, tagSha: string): Promise<boolean> {
  const result = await git(origin.dir, ['merge-base', '--is-ancestor', commitSha, tagSha]);
  if (result.code !== 0 && result.code !== 1) {
    throw new Error(`merge-base 실패 (${String(result.code)}): ${result.stderr}`);
  }
  return result.code === 0;
}

/** 우리 답: 그 서수를 포함하는 릴리스의 태그명 집합. */
async function ourContainments(mergeSeq: number): Promise<readonly string[]> {
  const rows = await releaseRepo.findContainingReleases(pool, REPOSITORY_ID, BRANCH, EPOCH, mergeSeq);
  return rows.map((row) => row.tag_name);
}

beforeAll(async () => {
  const env = { ...process.env };
  if (env['DATABASE_URL'] === undefined || env['DATABASE_URL'] === '') {
    env['POSTGRES_DB'] = env['POSTGRES_TEST_DB'] ?? 'prs_test';
  }
  pool = createPool(resolvePoolConfig(env));
  await migrateUp(pool);

  origin = await createSequenceFixture();
  await appendCommit(origin.dir, 'c5');
  await appendCommit(origin.dir, 'c6');
  const fullChain = (await run(origin.dir, ['rev-list', '--first-parent', '--reverse', BRANCH]))
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
  if (fullChain.length !== 6) throw new Error(`체인이 6개가 아니다: ${String(fullChain.length)}`);
  chain = fullChain;

  // 체인 위: 앞(경량)·머지 커밋(주석)·머리(경량). 체인 밖: feature 브랜치의 머리.
  await run(origin.dir, ['tag', 'rel-early', chain[1]!]);
  await run(origin.dir, ['tag', '-a', 'rel-merge', '-m', 'the merge', origin.mergeSha]);
  await run(origin.dir, ['tag', 'rel-head', chain[5]!]);
  await run(origin.dir, ['tag', 'on-feature', (await run(origin.dir, ['rev-parse', 'feature'])).trim()]);

  tagCommit = new Map();
  for (const tag of [...ON_CHAIN_TAGS, 'on-feature']) {
    tagCommit.set(tag, (await run(origin.dir, ['rev-parse', `${tag}^{commit}`])).trim());
  }

  mirrorRoot = await makeTempDir('prs-regression-releases-');
  const sync = new MirrorSync({ root: mirrorRoot, remoteUrl: () => origin.url });
  const graph = new MirrorCommitGraph({ root: mirrorRoot, repositoryIdOf: () => REPOSITORY_ID });
  await sync.sync(REF, REPOSITORY_ID);

  await pool.query('DELETE FROM release WHERE repository_id = $1', [REPOSITORY_ID]);
  await pool.query('DELETE FROM merge_sequence WHERE repository_id = $1', [REPOSITORY_ID]);
  await pool.query('DELETE FROM sequence_space WHERE repository_id = $1', [REPOSITORY_ID]);
  await pool.query('DELETE FROM repository WHERE repository_id = $1', [REPOSITORY_ID]);
  await repositoryRepo.upsertRepository(pool, {
    repository_id: REPOSITORY_ID,
    owner: REF.owner,
    name: REF.repo,
    org_id: 1,
    visibility: 'internal',
    sequence_branches: [BRANCH],
  });
  await sequenceSpaceRepo.ensureSequenceSpace(pool, REPOSITORY_ID, BRANCH);

  const commits = await graph.firstParentCommits(REF, {
    from: null,
    to: (await run(origin.dir, ['rev-parse', BRANCH])).trim(),
  });
  for (const entry of numberCommits(0, commits)) {
    await mergeSequenceRepo.upsertMergeSequence(pool, {
      repository_id: REPOSITORY_ID,
      base_branch: BRANCH,
      seq_epoch: EPOCH,
      merge_seq: entry.mergeSeq,
      commit_sha: entry.sha,
      pull_request_number: entry.sha === origin.mergeSha ? 42 : null,
      committed_at: new Date(entry.committedAt),
    });
  }

  // 릴리스 행은 실제 JOB-REL-007이 미러에서 만든다.
  const deps: ReleaseDeps = {
    pool,
    es: stubEs(),
    bus: { publish: async () => undefined } as never,
    metrics: createWorkerMetrics(),
    sync: (ref, id) => sync.sync(ref, id),
    listTags: (ref) => graph.listTags(ref),
    log: () => undefined,
  };
  const outcome = await refreshReleases(deps, REPOSITORY_ID, 'regression');
  if (outcome.kind !== 'refreshed') throw new Error(`수집 실패: ${outcome.kind}`);
}, 120_000);

afterAll(async () => {
  await pool?.query('DELETE FROM release WHERE repository_id = $1', [REPOSITORY_ID]);
  await pool?.query('DELETE FROM merge_sequence WHERE repository_id = $1', [REPOSITORY_ID]);
  await pool?.query('DELETE FROM sequence_space WHERE repository_id = $1', [REPOSITORY_ID]);
  await pool?.query('DELETE FROM repository WHERE repository_id = $1', [REPOSITORY_ID]);
  await pool?.end();
  await removeDir(origin.dir);
  await removeDir(mirrorRoot);
});

describe('포함 판정 = git 조상 관계 (WP-024 DoD)', () => {
  it('**체인 위 커밋 전수 × 체인 위 태그 전수가 git과 정확히 같다**', async () => {
    /*
     * 6 커밋 × 3 태그 = 18쌍 전수다. 서수 비교의 경계(`<=`)가 한 칸이라도
     * 어긋나면 어느 쌍에선가 git과 갈린다 — 그리고 그 어긋남은 오류 없이
     * "포함 릴리스가 하나 더 있거나 없는" 모양으로 화면까지 간다.
     */
    for (const [index, sha] of chain.entries()) {
      const ours = await ourContainments(index + 1);
      const theirs: string[] = [];
      for (const tag of ON_CHAIN_TAGS) {
        if (await gitContains(sha, tagCommit.get(tag)!)) theirs.push(tag);
      }
      expect(ours.slice().sort(), `서수 ${String(index + 1)}의 포함 집합`).toEqual(theirs.sort());
    }
  });

  it('주석 태그의 peel이 git과 같다 — 태그 객체가 아니라 커밋으로 판정한다 (DEV-143)', async () => {
    const row = await releaseRepo.findReleaseByTag(pool, REPOSITORY_ID, 'rel-merge');
    expect(row?.commit_sha).toBe(tagCommit.get('rel-merge'));
    expect(Number(row?.merge_seq)).toBe(chain.indexOf(tagCommit.get('rel-merge')!) + 1);
  });

  it('**릴리스 시각 순서가 git의 creatordate 정렬과 같다** (FR-REL-002 AC-3)', async () => {
    // for-each-ref는 마지막 --sort가 1차 키다: creatordate 1차, refname 2차 —
    // 우리 `ORDER BY released_at, tag_name`과 같은 규칙이다.
    const theirs = (
      await run(origin.dir, [
        'for-each-ref',
        '--sort=refname',
        '--sort=creatordate',
        '--format=%(refname:short)',
        'refs/tags',
      ])
    )
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '');
    const ours = (await releaseRepo.listReleases(pool, REPOSITORY_ID)).map((row) => row.tag_name);
    expect(ours).toEqual(theirs);
  });

  it('**체인 밖 태그는 git이 조상이라 해도 포함 목록에 없다** — 설계된 차이다', async () => {
    /*
     * feature는 c2에서 갈라졌으므로 git의 DAG로는 c1·c2가 on-feature의 조상이다.
     * 그래도 포함 판정에는 넣지 않는다: 릴리스는 시퀀스 공간(대상 브랜치)에
     * 속하고(FR-REL-002), 피처 브랜치 태그는 main의 릴리스가 아니다. 이 시험은
     * 그 경계가 의도임을 못박는다 — git과 무조건 같아지려는 구현이 나오면 잡는다.
     */
    expect(await gitContains(chain[0]!, tagCommit.get('on-feature')!)).toBe(true);
    for (const [index] of chain.entries()) {
      expect(await ourContainments(index + 1)).not.toContain('on-feature');
    }
    // 다만 표시용 행으로는 존재한다 — 서수 셋 없이 (DEV-142).
    const row = await releaseRepo.findReleaseByTag(pool, REPOSITORY_ID, 'on-feature');
    expect(row?.merge_seq).toBeNull();
  });

  it('마지막 릴리스 서수가 git 체인에서 가장 뒤 태그의 자리와 같다', async () => {
    const latest = await releaseRepo.findLatestReleaseSeq(pool, REPOSITORY_ID, BRANCH, EPOCH);
    const positions = ON_CHAIN_TAGS.map((tag) => chain.indexOf(tagCommit.get(tag)!) + 1);
    expect(latest).toBe(Math.max(...positions));
  });
});
