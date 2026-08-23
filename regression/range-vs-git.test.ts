/**
 * 범위 조회와 `git log --first-parent A..B`의 일치 (WP-023 DoD / 릴리스 검증 계획 8장).
 *
 * ## 이 파일이 묻는 것
 *
 * 다른 시험은 "코드가 설계대로 도는가"를 묻는다. 여기서 묻는 것은
 * **"우리가 낸 구간이 git이 내는 구간과 같은가"** 하나다. 이 제품이 존재하는
 * 이유가 그 대조 가능성이므로(ADR-007), 그것을 검사하는 시험은 다른 시험에
 * 섞이면 안 된다.
 *
 * 그래서 **정답은 우리 코드가 아니라 `git log`가 낸다.** 기대값을 손으로 적지
 * 않는다 — 손으로 적으면 우리 walk가 틀렸을 때 기대값도 같이 틀리게 적힌다.
 *
 * ## 왜 진짜 PostgreSQL까지 도는가
 *
 * 범위 조회의 정답지가 `merge_sequence`이기 때문이다 (CR-027, DEV-130).
 * walk만 검사하면 SQL의 반개구간 경계가 어긋나도 통과한다 — 그리고 그 어긋남은
 * **오류 없이 항목 하나가 더 들거나 덜 드는** 모양으로 나타난다.
 *
 * 흐름: git 픽스처 → 미러 → first-parent walk → PostgreSQL 채번 → 범위 조회 →
 * `git log A..B`와 대조.
 *
 * 실행: `pnpm test:regression range-vs-git`
 */

import { MirrorCommitGraph, MirrorSync } from '@prs/github';
import { createPool, mergeSequenceRepo, resolvePoolConfig, type Pool } from '@prs/db';
import { migrateUp } from '@prs/db/migrate';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  appendCommit,
  createSequenceFixture,
  makeTempDir,
  removeDir,
  run,
  type SequenceFixture,
} from '../apps/pipeline-worker/integration/sequence/fixture.js';
import { numberCommits } from '../apps/pipeline-worker/src/sequence-plan.js';

const REPOSITORY_ID = 9003;
const REF = { owner: 'acme', repo: 'payments' };
const BRANCH = 'main';
const EPOCH = 1;

let origin: SequenceFixture;
let mirrorRoot: string;
let graph: MirrorCommitGraph;
let pool: Pool;
/** 서수 → SHA. git이 낸 순서를 그대로 옮긴 것이다. */
let chain: readonly string[];

/**
 * `git log --first-parent A..B` — 우리 답을 대조할 정답.
 *
 * `from`이 비면 `A..B`가 아니라 `B` 하나를 준다. **`..main`은 빈 구간이 아니라
 * `HEAD..main`이다** — 그것을 "구간 맨 앞부터"로 쓰면 정답 쪽이 조용히 0건이 되고,
 * 그러면 이 시험이 아무것도 가르지 못한다.
 */
async function gitRange(from: string, to: string): Promise<readonly string[]> {
  const rev = from === '' ? to : `${from}..${to}`;
  const stdout = await run(origin.dir, ['log', '--first-parent', '--reverse', '--format=%H', rev]);
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

/** 우리 답: `merge_sequence`에서 반개구간 `(from, to]`를 읽는다. */
async function ourRange(fromSeq: number, toSeq: number): Promise<readonly string[]> {
  const rows = await mergeSequenceRepo.findRangePage(
    pool,
    REPOSITORY_ID,
    BRANCH,
    EPOCH,
    fromSeq,
    toSeq,
    1_000,
  );
  return rows.map((row) => row.commit_sha);
}

beforeAll(async () => {
  const env = { ...process.env };
  if (env['DATABASE_URL'] === undefined || env['DATABASE_URL'] === '') {
    env['POSTGRES_DB'] = env['POSTGRES_TEST_DB'] ?? 'prs_test';
  }
  pool = createPool(resolvePoolConfig(env));
  await migrateUp(pool);

  origin = await createSequenceFixture();
  // 넷으로는 구간의 안팎을 가르기에 모자라다. 여섯으로 늘려 양끝과 가운데를 만든다.
  await appendCommit(origin.dir, 'c5');
  await appendCommit(origin.dir, 'c6');

  mirrorRoot = await makeTempDir('prs-regression-range-');
  await new MirrorSync({ root: mirrorRoot, remoteUrl: () => origin.url }).sync(REF, REPOSITORY_ID);
  graph = new MirrorCommitGraph({ root: mirrorRoot, repositoryIdOf: () => REPOSITORY_ID });

  const head = await graph.resolveHead(REF, BRANCH);
  if (head === null) throw new Error('대상 브랜치가 없다');
  const commits = await graph.firstParentCommits(REF, { from: null, to: head });

  await pool.query('DELETE FROM merge_sequence WHERE repository_id = $1', [REPOSITORY_ID]);
  for (const entry of numberCommits(0, commits)) {
    await mergeSequenceRepo.upsertMergeSequence(pool, {
      repository_id: REPOSITORY_ID,
      base_branch: BRANCH,
      seq_epoch: EPOCH,
      merge_seq: entry.mergeSeq,
      commit_sha: entry.sha,
      // 머지 커밋 하나만 PR에 대응한다 (픽스처의 c3 = PR #42).
      pull_request_number: entry.sha === origin.mergeSha ? 42 : null,
      committed_at: new Date(entry.committedAt),
    });
  }

  chain = commits.map((commit) => commit.sha);
  if (chain.length !== 6) throw new Error(`체인이 6개가 아니다: ${String(chain.length)}`);
}, 120_000);

afterAll(async () => {
  await pool?.query('DELETE FROM merge_sequence WHERE repository_id = $1', [REPOSITORY_ID]);
  await pool?.end();
  await removeDir(origin.dir);
  await removeDir(mirrorRoot);
});

describe('범위 조회 = `git log --first-parent A..B` (WP-023 DoD)', () => {
  it('**가운데 구간이 git과 정확히 같다**', async () => {
    // 서수 2와 5의 커밋을 앵커로 삼는다. `git`은 SHA로, 우리는 서수로 같은 것을 묻는다.
    const ours = await ourRange(2, 5);
    const theirs = await gitRange(chain[1]!, chain[4]!);
    expect(ours).toEqual(theirs);
    expect(ours).toHaveLength(3);
  });

  it('**시작 앵커의 커밋이 결과에 없다** (FR-SEQ-002 AC-1)', async () => {
    const ours = await ourRange(2, 5);
    expect(ours).not.toContain(chain[1]);
  });

  it('**끝 앵커의 커밋이 결과에 있다** (FR-SEQ-002 AC-1)', async () => {
    const ours = await ourRange(2, 5);
    expect(ours[ours.length - 1]).toBe(chain[4]);
  });

  it('전체 구간이 git의 전체 first-parent 체인과 같다', async () => {
    const ours = await ourRange(0, 6);
    const theirs = await gitRange('', 'main');
    expect(ours).toEqual(theirs);
  });

  it('구간 폭 1이 커밋 하나다 — 반개구간의 최소 단위', async () => {
    const ours = await ourRange(3, 4);
    const theirs = await gitRange(chain[2]!, chain[3]!);
    expect(ours).toEqual(theirs);
    expect(ours).toEqual([chain[3]]);
  });

  it('빈 구간은 git도 우리도 0건이다', async () => {
    const ours = await ourRange(4, 4);
    const theirs = await gitRange(chain[3]!, chain[3]!);
    expect(ours).toEqual([]);
    expect(theirs).toEqual([]);
  });

  it('**머지 커밋 하나만 세고 그 부모 갈래는 세지 않는다**', async () => {
    /*
     * 픽스처의 `feature` 브랜치에는 커밋 둘(f1·f2)이 있고 머지 커밋이 그것을
     * 들여온다. first-parent walk는 머지 커밋 **하나만** 센다 — 두 번째 부모를
     * 따라가는 구현이면 여기서 구간이 커진다. git이 같은 것을 세는지로 건다.
     */
    const ours = await ourRange(2, 3);
    const theirs = await gitRange(chain[1]!, chain[2]!);
    expect(ours).toEqual(theirs);
    expect(ours).toEqual([origin.mergeSha]);
  });

  it('구간 밖 서수를 끝으로 주면 있는 데까지만 준다', async () => {
    const ours = await ourRange(0, 999);
    const theirs = await gitRange('', 'main');
    expect(ours).toEqual(theirs);
  });
});

describe('건수 (FR-SEQ-002 AC-2·AC-4)', () => {
  it('**정확 건수가 git의 건수와 같다** (DEV-140)', async () => {
    for (const [from, to] of [
      [0, 6],
      [2, 5],
      [3, 4],
      [4, 4],
    ] as const) {
      const count = await mergeSequenceRepo.countRange(pool, REPOSITORY_ID, BRANCH, EPOCH, from, to);
      const theirs = await gitRange(from === 0 ? '' : chain[from - 1]!, chain[Math.min(to, 6) - 1]!);
      expect(count).toBe(theirs.length);
    }
  });

  it('PR 번호 목록이 구간 안의 머지 커밋만 담는다', async () => {
    const inRange = await mergeSequenceRepo.listPullRequestNumbersInRange(
      pool,
      REPOSITORY_ID,
      BRANCH,
      EPOCH,
      2,
      3,
    );
    expect(inRange).toEqual([42]);

    // 머지 커밋이 없는 구간은 빈 목록이다 — PR 수와 커밋 수가 갈리는 근거다.
    const outOfRange = await mergeSequenceRepo.listPullRequestNumbersInRange(
      pool,
      REPOSITORY_ID,
      BRANCH,
      EPOCH,
      4,
      6,
    );
    expect(outOfRange).toEqual([]);
  });
});

describe('앵커가 가리키는 커밋 (FR-SEQ-003)', () => {
  it('서수 앵커가 git 체인의 같은 자리를 가리킨다', async () => {
    for (let seq = 1; seq <= chain.length; seq += 1) {
      const point = await mergeSequenceRepo.findPointBySeq(pool, REPOSITORY_ID, BRANCH, EPOCH, seq);
      expect(point?.commitSha).toBe(chain[seq - 1]);
    }
  });

  it('PR 앵커가 머지 커밋을 가리킨다 (AC-3)', async () => {
    const point = await mergeSequenceRepo.findPointByPullRequest(pool, REPOSITORY_ID, BRANCH, EPOCH, 42);
    expect(point?.commitSha).toBe(origin.mergeSha);
    expect(point?.mergeSeq).toBe(3);
  });

  it('**체인 밖 커밋은 찾히지 않는다** (AC-2)', async () => {
    // `feature`의 f1은 히스토리에 있지만 first-parent 체인에는 없다.
    const featureHead = (await run(origin.dir, ['rev-parse', 'feature'])).trim();
    const point = await mergeSequenceRepo.findPointByCommit(pool, REPOSITORY_ID, BRANCH, EPOCH, featureHead);
    expect(point).toBeNull();
    // 그 커밋이 저장소에 실재한다는 것은 확인해 둔다 — 오타로 null이 나온 것이 아니다.
    expect(featureHead).toMatch(/^[0-9a-f]{40}$/);
  });

  it('시각 앵커가 그 시각 이전 마지막 커밋을 가리킨다 (AC-4)', async () => {
    const third = await mergeSequenceRepo.findPointBySeq(pool, REPOSITORY_ID, BRANCH, EPOCH, 3);
    if (third === null) throw new Error('서수 3이 없다');

    const point = await mergeSequenceRepo.findPointAtOrBefore(
      pool,
      REPOSITORY_ID,
      BRANCH,
      EPOCH,
      third.committedAt,
    );
    // 같은 시각이면 포함한다. 픽스처는 커밋들이 같은 초에 찍힐 수 있으므로
    // "3 이상"이 아니라 "3보다 앞서지 않는다"로 건다.
    expect(point).not.toBeNull();
    expect(point!.mergeSeq).toBeGreaterThanOrEqual(3);
  });
});
