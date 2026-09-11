/**
 * squash-only 이력 픽스처 (WP-074 FR-SEQ-008 / 실행서 4장).
 *
 * ```
 * seq 1  R  root                  직접 푸시 (증서는 시험이 주입)
 * seq 2  A  squash of fa (PR #21)  원본 커밋 3개 → 부모 하나짜리 squash 커밋
 * seq 3  D  direct                 직접 푸시 (증서는 시험이 주입)
 * seq 4  B  squash of fb (PR #25)
 * seq 5  C  squash of fc (PR #27)  스냅숏이 늦게 도착한다
 * seq 6  E  squash of fe (PR #29)
 * ```
 *
 * **기대값은 시험 작성자가 손으로 선언한다**: A=1, D=없음, B=2, C=3, E=4. C가
 * 미확정이면 E도 없다. 구현의 planner나 classifier가 만든 값을 기대값으로 가져오지
 * 않는다. 커밋 메시지의 `(#21)`은 사람이 읽기 위한 것이며 **구현은 읽지 않는다** —
 * 근거는 시험이 넣는 PR 상세 대역이다.
 */

import { firstParentOf, makeTempDir, run } from './fixture.js';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface SquashFixture {
  readonly dir: string;
  readonly url: string;
  /** first-parent 체인 (서수 1..6 순서). git이 낸 답이다. */
  readonly chain: readonly string[];
  readonly rootSha: string;
  readonly directSha: string;
  /** PR 번호 → squash 커밋 SHA. 시험의 PR 상세 대역이 이것으로 답한다. */
  readonly squash: ReadonlyMap<number, string>;
  /** 각 squash 커밋의 `merged_at` (오름차순이 기본). */
  readonly mergedAt: ReadonlyMap<number, string>;
}

async function write(dir: string, name: string, body: string): Promise<void> {
  await writeFile(join(dir, name), body, 'utf8');
}

async function commit(dir: string, name: string, message: string, at: string): Promise<string> {
  await write(dir, `${name}.txt`, `${name}\n`);
  await run(dir, ['add', '.']);
  await run(dir, ['commit', '-q', '-m', message], { GIT_AUTHOR_DATE: at, GIT_COMMITTER_DATE: at });
  return (await run(dir, ['rev-parse', 'HEAD'])).trim();
}

/** 피처 브랜치에 커밋 N개를 만들고 `main`에 squash 머지한다. 결과는 부모 하나짜리 커밋이다. */
export async function squashMerge(
  dir: string,
  branch: string,
  commits: number,
  message: string,
  at: string,
): Promise<string> {
  await run(dir, ['checkout', '-q', '-b', branch]);
  for (let index = 1; index <= commits; index += 1) {
    await commit(dir, `${branch}-${String(index)}`, `${branch} ${String(index)}`, at);
  }
  await run(dir, ['checkout', '-q', 'main']);
  await run(dir, ['merge', '-q', '--squash', branch]);
  await run(dir, ['commit', '-q', '-m', message], { GIT_AUTHOR_DATE: at, GIT_COMMITTER_DATE: at });
  const sha = (await run(dir, ['rev-parse', 'HEAD'])).trim();
  const parents = (await run(dir, ['rev-list', '--parents', '-n', '1', 'HEAD'])).trim().split(' ');
  if (parents.length !== 2) throw new Error(`squash 커밋의 부모가 하나가 아니다: ${String(parents.length - 1)}`);
  return sha;
}

export async function createSquashFixture(): Promise<SquashFixture> {
  const dir = await makeTempDir('prs-squash-origin-');
  await run(dir, ['init', '-q', '-b', 'main']);
  await run(dir, ['config', 'uploadpack.allowFilter', 'true']);
  await run(dir, ['config', 'uploadpack.allowAnySHA1InWant', 'true']);

  const rootSha = await commit(dir, 'root', 'R root', '2026-09-01T00:00:00Z');
  const a = await squashMerge(dir, 'fa', 3, 'A squash (#21)', '2026-09-01T01:00:00Z');
  const directSha = await commit(dir, 'direct', 'D direct push', '2026-09-01T02:00:00Z');
  const b = await squashMerge(dir, 'fb', 1, 'B squash (#25)', '2026-09-01T03:00:00Z');
  const c = await squashMerge(dir, 'fc', 2, 'C squash (#27)', '2026-09-01T04:00:00Z');
  const e = await squashMerge(dir, 'fe', 1, 'E squash (#29)', '2026-09-01T05:00:00Z');

  const chain = await firstParentOf(dir, 'main');
  if (chain.length !== 6) throw new Error(`픽스처 체인이 6이 아니다: ${String(chain.length)}`);
  const expected = [rootSha, a, directSha, b, c, e];
  expected.forEach((sha, index) => {
    if (chain[index] !== sha) throw new Error(`체인 ${String(index + 1)}번이 기대와 다르다`);
  });

  return {
    dir,
    url: `file://${dir}`,
    chain,
    rootSha,
    directSha,
    squash: new Map([
      [21, a],
      [25, b],
      [27, c],
      [29, e],
    ]),
    mergedAt: new Map([
      [21, '2026-09-01T01:00:00Z'],
      [25, '2026-09-01T03:00:00Z'],
      [27, '2026-09-01T04:00:00Z'],
      [29, '2026-09-01T05:00:00Z'],
    ]),
  };
}
