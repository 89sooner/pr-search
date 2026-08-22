/**
 * 실제 git 저장소 픽스처 (WP-020 통합 시험).
 *
 * **목 git을 쓰지 않는다.** 이 WP가 증명해야 할 것이 "우리 결과가 `git
 * rev-list --first-parent --reverse`와 같은가"이므로, 비교 대상이 진짜
 * git이 아니면 아무것도 증명하지 못한다.
 */

import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface GitResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

export function git(cwd: string | null, args: readonly string[]): Promise<GitResult> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      cwd === null ? [...args] : ['-C', cwd, ...args],
      {
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: 'fixture',
          GIT_AUTHOR_EMAIL: 'fixture@example.com',
          GIT_COMMITTER_NAME: 'fixture',
          GIT_COMMITTER_EMAIL: 'fixture@example.com',
          // 결정론적 픽스처. 시각이 흔들리면 SHA가 매번 달라진다.
          GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z',
          GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z',
        },
        maxBuffer: 32 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        if (error === null) {
          resolve({ code: 0, stdout, stderr });
          return;
        }
        const code = (error as NodeJS.ErrnoException & { code?: number }).code;
        if (typeof code === 'number') {
          resolve({ code, stdout, stderr });
          return;
        }
        reject(error);
      },
    );
  });
}

export async function run(cwd: string, args: readonly string[]): Promise<string> {
  const result = await git(cwd, args);
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

export interface OriginRepo {
  readonly dir: string;
  readonly url: string;
}

/**
 * 병합 커밋과 직접 푸시가 섞인 히스토리를 만든다.
 *
 * 이 모양이 중요한 이유: first-parent 체인은 **병합 커밋을 하나로 세고 그
 * 안의 원본 커밋을 세지 않는다.** 선형 히스토리로만 시험하면 그 차이가
 * 드러나지 않아, 두 번째 부모를 따라가는 구현도 통과한다.
 */
export async function createOriginRepo(): Promise<OriginRepo> {
  const dir = await makeTempDir('prs-origin-');
  await run(dir, ['init', '-q', '-b', 'main']);
  /*
   * **부분 클론 필터를 켠다.** 켜지 않으면 `--filter=blob:none`이
   * "filtering not recognized by server"로 조용히 무시되고, blob이 전부
   * 들어온 클론을 blobless라고 시험하게 된다 — 통과하지만 아무것도
   * 검증하지 못하는 시험이다.
   */
  await run(dir, ['config', 'uploadpack.allowFilter', 'true']);
  await run(dir, ['config', 'uploadpack.allowAnySHA1InWant', 'true']);

  await write(dir, 'root.txt', 'root\n');
  await run(dir, ['add', '.']);
  await run(dir, ['commit', '-q', '-m', 'c1 root']);

  // 직접 푸시 커밋 하나 (PR을 거치지 않은 것).
  await write(dir, 'direct.txt', 'direct\n');
  await run(dir, ['add', '.']);
  await run(dir, ['commit', '-q', '-m', 'c2 direct push']);

  // 브랜치에서 두 커밋을 만들고 --no-ff로 병합한다.
  await run(dir, ['checkout', '-q', '-b', 'feature']);
  await write(dir, 'feature.txt', 'a\n');
  await run(dir, ['add', '.']);
  await run(dir, ['commit', '-q', '-m', 'f1']);
  await write(dir, 'feature.txt', 'a\nb\n');
  await run(dir, ['add', '.']);
  await run(dir, ['commit', '-q', '-m', 'f2']);
  await run(dir, ['checkout', '-q', 'main']);
  await run(dir, ['merge', '-q', '--no-ff', '-m', 'c3 merge feature', 'feature']);

  // 병합 뒤 직접 푸시 하나 더.
  await write(dir, 'after.txt', 'after\n');
  await run(dir, ['add', '.']);
  await run(dir, ['commit', '-q', '-m', 'c4 after merge']);

  return { dir, url: `file://${dir}` };
}

async function write(dir: string, name: string, body: string): Promise<void> {
  const { writeFile } = await import('node:fs/promises');
  await writeFile(join(dir, name), body, 'utf8');
}

/** 픽스처의 정답. 우리 구현이 아니라 **git이** 낸 값이다. */
export async function expectedFirstParent(originDir: string, range: string): Promise<readonly string[]> {
  const stdout = await run(originDir, ['rev-list', '--first-parent', '--reverse', range]);
  return stdout.split('\n').map((line) => line.trim()).filter((line) => line !== '');
}

/** 미러의 객체 종류별 개수. blob이 0인지 세는 데 쓴다 (THR-015). */
export async function objectTypeCounts(mirrorDir: string): Promise<Record<string, number>> {
  const stdout = await run(mirrorDir, ['cat-file', '--batch-all-objects', '--batch-check=%(objecttype)']);
  const counts: Record<string, number> = {};
  for (const line of stdout.split('\n')) {
    const type = line.trim();
    if (type === '') continue;
    counts[type] = (counts[type] ?? 0) + 1;
  }
  return counts;
}
