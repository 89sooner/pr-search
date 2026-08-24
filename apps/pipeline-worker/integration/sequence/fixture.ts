/**
 * 채번 시험용 git 픽스처 (WP-021 / 릴리스 검증 계획 8장 회귀 픽스처).
 *
 * **머지 커밋과 직접 푸시를 같은 히스토리에 섞는다.** 섞지 않으면
 * `pull_request_number`가 null인 것을 확인하는 시험이 아무것도 검증하지
 * 못한다 — PR 문서가 애초에 없으니 무엇을 해도 null이 나온다. 둘이 함께
 * 있어야 "머지 커밋에는 붙고 직접 푸시에는 안 붙는다"를 대조할 수 있다.
 */

import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface GitOut {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** 저자·커미터를 고정한다. 환경의 git 설정에 시험 결과가 좌우되면 안 된다. */
const GIT_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  GIT_AUTHOR_NAME: 'PRS Fixture',
  GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
  GIT_COMMITTER_NAME: 'PRS Fixture',
  GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
  GIT_CONFIG_NOSYSTEM: '1',
  HOME: '/nonexistent',
};

export function git(
  cwd: string | null,
  args: readonly string[],
  env: NodeJS.ProcessEnv = {},
): Promise<GitOut> {
  return new Promise((resolve) => {
    execFile(
      'git',
      cwd === null ? [...args] : ['-C', cwd, ...args],
      { env: { ...GIT_ENV, ...env }, maxBuffer: 8 * 1024 * 1024 },
      (error, stdout, stderr) => {
        const code = error === null ? 0 : ((error as NodeJS.ErrnoException & { code?: number }).code ?? 1);
        resolve({ code: typeof code === 'number' ? code : 1, stdout, stderr });
      },
    );
  });
}

export async function run(
  cwd: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv = {},
): Promise<string> {
  const result = await git(cwd, args, env);
  if (result.code !== 0) {
    throw new Error(`git ${args.join(' ')} 실패 (${String(result.code)}): ${result.stderr}`);
  }
  return result.stdout;
}

export async function makeTempDir(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

export async function removeDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}

export interface SequenceFixture {
  readonly dir: string;
  readonly url: string;
  /** 머지 커밋의 SHA. 이것만 PR #42에 대응한다. */
  readonly mergeSha: string;
  /** 직접 푸시 커밋들의 SHA. 어느 PR에도 대응하지 않는다. */
  readonly directShas: readonly string[];
}

async function write(dir: string, name: string, body: string): Promise<void> {
  await writeFile(join(dir, name), body, 'utf8');
}

/**
 * main의 first-parent 체인이 정확히 넷인 저장소를 만든다.
 *
 * ```
 * 1  c1 root            직접 푸시
 * 2  c2 direct push     직접 푸시
 * 3  c3 merge feature   머지 커밋 (PR #42)
 * 4  c4 after merge     직접 푸시
 * ```
 *
 * `feature` 브랜치의 f1·f2는 체인에 **없다** — first-parent가 병합 커밋을
 * 하나로 세기 때문이다. 선형 히스토리로만 시험하면 두 번째 부모를 따라가는
 * 구현도 통과한다.
 */
export async function createSequenceFixture(): Promise<SequenceFixture> {
  const dir = await makeTempDir('prs-seq-origin-');
  await run(dir, ['init', '-q', '-b', 'main']);
  await run(dir, ['config', 'uploadpack.allowFilter', 'true']);
  await run(dir, ['config', 'uploadpack.allowAnySHA1InWant', 'true']);

  await write(dir, 'root.txt', 'root\n');
  await run(dir, ['add', '.']);
  await run(dir, ['commit', '-q', '-m', 'c1 root']);

  await write(dir, 'direct.txt', 'direct\n');
  await run(dir, ['add', '.']);
  await run(dir, ['commit', '-q', '-m', 'c2 direct push']);

  await run(dir, ['checkout', '-q', '-b', 'feature']);
  await write(dir, 'feature.txt', 'a\n');
  await run(dir, ['add', '.']);
  await run(dir, ['commit', '-q', '-m', 'f1']);
  await write(dir, 'feature.txt', 'a\nb\n');
  await run(dir, ['add', '.']);
  await run(dir, ['commit', '-q', '-m', 'f2']);
  await run(dir, ['checkout', '-q', 'main']);
  await run(dir, ['merge', '-q', '--no-ff', '-m', 'c3 merge feature (#42)', 'feature']);

  await write(dir, 'after.txt', 'after\n');
  await run(dir, ['add', '.']);
  await run(dir, ['commit', '-q', '-m', 'c4 after merge']);

  const chain = await firstParentOf(dir, 'main');
  if (chain.length !== 4) throw new Error(`픽스처가 4개가 아니다: ${String(chain.length)}`);

  return {
    dir,
    url: `file://${dir}`,
    mergeSha: chain[2]!,
    directShas: [chain[0]!, chain[1]!, chain[3]!],
  };
}

/** 정답은 우리 구현이 아니라 **git이** 낸다. */
export async function firstParentOf(dir: string, range: string): Promise<readonly string[]> {
  const stdout = await run(dir, ['rev-list', '--first-parent', '--reverse', range]);
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

/** 대상 브랜치에 커밋 하나를 더한다. 증분 채번 시험이 쓴다. */
export async function appendCommit(dir: string, name: string): Promise<string> {
  await write(dir, `${name}.txt`, `${name}\n`);
  await run(dir, ['add', '.']);
  await run(dir, ['commit', '-q', '-m', name]);
  return (await run(dir, ['rev-parse', 'HEAD'])).trim();
}

/**
 * 대상 브랜치의 히스토리를 다시 쓴다 (강제 푸시와 같은 효과).
 *
 * @returns 재작성 뒤의 head.
 */
export async function rewriteHistory(dir: string): Promise<string> {
  // 마지막 커밋을 지우고 다른 내용으로 새로 만든다 — 이전 head는 더 이상 조상이 아니다.
  await run(dir, ['reset', '-q', '--hard', 'HEAD~1']);
  await write(dir, 'rewritten.txt', 'rewritten\n');
  await run(dir, ['add', '.']);
  await run(dir, ['commit', '-q', '-m', 'c4 rewritten']);
  return (await run(dir, ['rev-parse', 'HEAD'])).trim();
}

/**
 * main을 **피처 브랜치의 마지막 커밋**으로 재작성한다 (DEV-125 폴백 시나리오).
 *
 * 이전 head(병합 커밋)와 새 head(f2)의 merge-base는 f2 자신인데, f2는
 * first-parent 체인 **밖**(병합의 두 번째 부모 쪽)이다 — `findSeqByCommit`이
 * `null`을 돌려주는 유일하게 자연스러운 구성이고, 이때 재채번은 처음부터
 * 전부 다시 걸어야 한다.
 *
 * @returns 재작성 뒤의 head (= f2).
 */
export async function rewriteToFeatureHead(dir: string): Promise<string> {
  const f2 = (await run(dir, ['rev-parse', 'feature'])).trim();
  await run(dir, ['checkout', '-q', 'feature']);
  await run(dir, ['branch', '-f', 'main', 'feature']);
  await run(dir, ['checkout', '-q', 'main']);
  return f2;
}
