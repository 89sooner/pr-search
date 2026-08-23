/**
 * ACC-02 시퀀스-git 일치 (릴리스 검증 계획 8장, Gate 7).
 *
 * **묻는 것이 다른 시험과 다르다.** 단위·통합 시험은 "코드가 설계대로 도는가"를
 * 묻지만, 여기서 묻는 것은 **"우리가 낸 답이 git이 낸 답과 같은가"**다.
 * ADR-007이 first-parent 서수를 고른 이유가 바로 그 대조 가능성이었고,
 * 그것이 Perforce Changelist가 주던 신뢰의 본질이다. 이 대조가 깨지면 다른
 * 품질 지표가 전부 통과해도 제품은 잘못된 답을 준다.
 *
 * 릴리스 검증 계획 8장이 요구하는 회귀 픽스처의 형태 중 **이 파일이 다루는
 * 것은 셋**이다: 일반 squash merge 연속, PR을 거치지 않은 직접 푸시,
 * 병합 커밋 정책 저장소. 나머지(강제 푸시 재작성·체리픽·되돌림·태그)는
 * 그 기능을 내는 WP가 이 파일 옆에 더한다.
 *
 * 실행: `pnpm test:regression`
 */

import { MirrorCommitGraph, MirrorSync } from '@prs/github';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  appendCommit,
  createSequenceFixture,
  firstParentOf,
  makeTempDir,
  removeDir,
  run,
  type SequenceFixture,
} from '../apps/pipeline-worker/integration/sequence/fixture.js';
import { numberCommits } from '../apps/pipeline-worker/src/sequence-plan.js';

const REPOSITORY_ID = 9001;
const REF = { owner: 'acme', repo: 'payments' };
const BRANCH = 'main';

let origin: SequenceFixture;
let mirrorRoot: string;
let graph: MirrorCommitGraph;

beforeAll(async () => {
  origin = await createSequenceFixture();
  mirrorRoot = await makeTempDir('prs-regression-');
  await new MirrorSync({ root: mirrorRoot, remoteUrl: () => origin.url }).sync(REF, REPOSITORY_ID);
  graph = new MirrorCommitGraph({ root: mirrorRoot, repositoryIdOf: () => REPOSITORY_ID });
}, 120_000);

afterAll(async () => {
  await removeDir(origin.dir);
  await removeDir(mirrorRoot);
});

/** 우리 구현이 낸 서수 표. */
async function ourSequence(): Promise<readonly { mergeSeq: number; sha: string }[]> {
  const head = await graph.resolveHead(REF, BRANCH);
  if (head === null) throw new Error('대상 브랜치가 없다');
  const commits = await graph.firstParentCommits(REF, { from: null, to: head });
  return numberCommits(0, commits).map((entry) => ({ mergeSeq: entry.mergeSeq, sha: entry.sha }));
}

describe('ACC-02: 시퀀스가 `git rev-list --first-parent --reverse`와 일치한다', () => {
  it('**순서와 구성이 완전히 같다**', async () => {
    const ours = await ourSequence();
    const theirs = await firstParentOf(origin.dir, BRANCH);

    expect(ours.map((entry) => entry.sha)).toEqual(theirs);
    expect(ours.map((entry) => entry.mergeSeq)).toEqual(theirs.map((_, index) => index + 1));
  });

  it('**병합 커밋을 하나로 세고 그 안의 원본 커밋을 세지 않는다**', async () => {
    /*
     * 회귀 픽스처가 병합 커밋을 담는 이유가 이것이다. 선형 히스토리로만
     * 검사하면 두 번째 부모를 따라가는 구현도 통과한다 — 그리고 실제
     * 저장소에서 처음 틀린 답을 낸다.
     */
    const ours = await ourSequence();
    const everyCommit = (await run(origin.dir, ['rev-list', BRANCH]))
      .split('\n')
      .filter((line) => line.trim() !== '');

    expect(everyCommit.length).toBeGreaterThan(ours.length);
    expect(ours.some((entry) => entry.sha === origin.mergeSha)).toBe(true);
  });

  it('**PR을 거치지 않은 직접 푸시 커밋도 서수를 받는다** (ADR-007 규칙 7)', async () => {
    // 받지 않으면 시퀀스가 브랜치 히스토리와 1:1 대응하지 않게 되어
    // 검증 가능성 자체가 깨진다.
    const ours = await ourSequence();
    for (const sha of origin.directShas) {
      expect(ours.some((entry) => entry.sha === sha), `직접 푸시 ${sha}에 서수가 없다`).toBe(true);
    }
  });

  it('커밋이 늘어도 기존 서수가 흔들리지 않는다 (ACC-01의 씨앗)', async () => {
    const before = await ourSequence();

    await appendCommit(origin.dir, 'regression-extra');
    await new MirrorSync({ root: mirrorRoot, remoteUrl: () => origin.url }).sync(REF, REPOSITORY_ID);

    const after = await ourSequence();

    // 앞부분이 그대로여야 한다 — 에폭이 바뀌지 않았으므로 값이 변할 이유가 없다.
    expect(after.slice(0, before.length)).toEqual(before);
    expect(after).toHaveLength(before.length + 1);
  });

  it('부분 구간이 `git log <from>..<to>`와 같다 — 범위 인용의 근거다 (AC-5)', async () => {
    const chain = await firstParentOf(origin.dir, BRANCH);
    const from = chain[0]!;
    const to = chain[chain.length - 1]!;

    const ours = await graph.firstParentCommits(REF, { from, to });
    const theirs = await firstParentOf(origin.dir, `${from}..${to}`);

    expect(ours.map((commit) => commit.sha)).toEqual(theirs);
  });
});
