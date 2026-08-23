/**
 * 재작성 히스토리에서의 시퀀스-git 일치 (WP-022 / 릴리스 검증 계획 8장).
 *
 * 회귀 픽스처 목록의 "**대상 브랜치 강제 푸시 (재작성)**" 항목을 이 파일이
 * 채운다. 묻는 것은 둘이다.
 *
 * 1. 재작성된 히스토리에서도 walk가 git과 일치하는가 — 재채번의 정확성은
 *    결국 이 walk 위에 선다.
 * 2. **공통 접두의 결정론**: 재작성 전후 히스토리가 같은 구간은 walk를 다시
 *    해도 같은 서수가 나오는가. DEV-125의 전체 재채번 폴백이 정확성을 잃지
 *    않는 근거가 바로 이 성질이다 — 이것이 깨지면 폴백은 base 이전 인용까지
 *    바꿔 버린다.
 *
 * DB 재채번 자체(에폭·복사·트랜잭션)는 통합 시험이 git과 대조한다. 여기는
 * 그 아래층 — walk의 성질만 — git만으로 건다.
 *
 * 실행: `pnpm test:regression`
 */

import { MirrorCommitGraph, MirrorSync } from '@prs/github';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createSequenceFixture,
  firstParentOf,
  makeTempDir,
  removeDir,
  rewriteHistory,
  type SequenceFixture,
} from '../apps/pipeline-worker/integration/sequence/fixture.js';
import { numberCommits } from '../apps/pipeline-worker/src/sequence-plan.js';

const REPOSITORY_ID = 9002;
const REF = { owner: 'acme', repo: 'payments' };
const BRANCH = 'main';

let origin: SequenceFixture;
let mirrorRoot: string;
let graph: MirrorCommitGraph;
let beforeRewrite: readonly { mergeSeq: number; sha: string }[];

async function walkNumbered(): Promise<readonly { mergeSeq: number; sha: string }[]> {
  const head = await graph.resolveHead(REF, BRANCH);
  if (head === null) throw new Error('대상 브랜치가 없다');
  const commits = await graph.firstParentCommits(REF, { from: null, to: head });
  return numberCommits(0, commits).map((entry) => ({ mergeSeq: entry.mergeSeq, sha: entry.sha }));
}

async function syncMirror(): Promise<void> {
  await new MirrorSync({ root: mirrorRoot, remoteUrl: () => origin.url }).sync(REF, REPOSITORY_ID);
}

beforeAll(async () => {
  origin = await createSequenceFixture();
  mirrorRoot = await makeTempDir('prs-regression-rewrite-');
  await syncMirror();
  graph = new MirrorCommitGraph({ root: mirrorRoot, repositoryIdOf: () => REPOSITORY_ID });

  beforeRewrite = await walkNumbered();
  await rewriteHistory(origin.dir);
  await syncMirror();
}, 120_000);

afterAll(async () => {
  await removeDir(origin.dir);
  await removeDir(mirrorRoot);
});

describe('강제 푸시 재작성 회귀 (릴리스 검증 계획 8장)', () => {
  it('**재작성 감지의 근거가 성립한다** — 이전 head는 새 head의 조상이 아니다 (AC-1)', async () => {
    const oldHead = beforeRewrite[beforeRewrite.length - 1]!.sha;
    const newHead = await graph.resolveHead(REF, BRANCH);
    expect(newHead).not.toBeNull();
    expect(newHead).not.toBe(oldHead);
    expect(await graph.isAncestor(REF, oldHead, newHead!)).toBe(false);
  });

  it('**재작성된 히스토리에서도 walk가 git과 정확히 일치한다**', async () => {
    const ours = await walkNumbered();
    const theirs = await firstParentOf(origin.dir, BRANCH);
    expect(ours.map((entry) => entry.sha)).toEqual(theirs);
    expect(ours.map((entry) => entry.mergeSeq)).toEqual(theirs.map((_, index) => index + 1));
  });

  it('**공통 접두는 재작성 전과 같은 서수를 받는다** — 전체 재채번 폴백의 근거다 (DEV-125)', async () => {
    /*
     * 픽스처의 재작성은 마지막 커밋만 바꾼다. 앞의 셋은 히스토리가 같으므로
     * 처음부터 다시 걸어도 같은 서수가 나와야 한다 — first-parent walk가
     * 결정론이라는 성질이 이 단언이고, 복사(copy)가 최적화일 뿐 정확성의
     * 조건이 아니라는 주장의 근거다.
     */
    const after = await walkNumbered();
    const common = beforeRewrite.slice(0, -1);
    expect(after.slice(0, common.length)).toEqual(common);
    // 어긋난 지점 이후는 실제로 다르다 — 같다면 이 시험은 아무것도 가르지 못한다.
    expect(after[common.length]?.sha).not.toBe(beforeRewrite[common.length]?.sha);
  });
});
