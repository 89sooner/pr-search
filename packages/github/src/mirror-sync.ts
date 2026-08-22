/**
 * JOB-MIR-001 미러 fetch 동기화 (WP-020 / ADR-005).
 *
 * ## 미러는 재구성 가능한 캐시다
 *
 * 백업하지 않고, 손실되면 다시 클론한다 (인프라 8장). 그래서 이 파일의
 * 실패 처리는 "복구"가 아니라 "다시 만든다"이고, 그동안 호출 측은 API
 * 폴백으로 답한다.
 *
 * ## 절대 push하지 않는다
 *
 * ADR-005가 못박은 것이고 THR-015의 전제다. 여기에 `push`가 없다는 것을
 * 아키텍처 시험이 검사한다 — 주석으로만 적으면 언젠가 누가 넣는다.
 */

import { mkdir, stat } from 'node:fs/promises';
import { statfs } from 'node:fs';
import { dirname } from 'node:path';
import type { RepoRef } from './client.js';
import { authArgs, diskUsageRatio, gitEnv, isSafeBranch, mirrorPath } from './graph-plan.js';
import type { GitRunner } from './mirror-graph.js';
import { nodeGitRunner } from './mirror-graph.js';
import { safeMessage } from './redact.js';

export interface MirrorSyncOptions {
  readonly root: string;
  /** 원격 URL을 만든다. **자격 증명을 넣지 않은 순수 URL이어야 한다** (CR-023, DEV-110). */
  readonly remoteUrl: (ref: RepoRef) => string;
  readonly tokenFor?: (org: string) => Promise<string | null>;
  readonly runner?: GitRunner;
  readonly timeoutMs?: number;
  readonly allowBlobFetch?: boolean;
  readonly env?: NodeJS.ProcessEnv;
}

/** JOB-MIR-001의 잡 타임아웃 (잡 카탈로그: 15분). */
export const MIRROR_SYNC_TIMEOUT_MS = 15 * 60 * 1_000;

export type MirrorSyncAction = 'cloned' | 'fetched';

export interface MirrorSyncResult {
  readonly action: MirrorSyncAction;
  readonly dir: string;
}

export class MirrorSyncError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'MirrorSyncError';
  }
}

export class MirrorSync {
  readonly #options: MirrorSyncOptions;
  readonly #runner: GitRunner;

  constructor(options: MirrorSyncOptions) {
    this.#options = options;
    this.#runner = options.runner ?? nodeGitRunner;
  }

  #env(): NodeJS.ProcessEnv {
    const allow = this.#options.allowBlobFetch;
    return gitEnv(this.#options.env ?? process.env, allow === undefined ? {} : { allowBlobFetch: allow });
  }

  /** 볼륨 루트. 사용률 지표가 이 경로를 잰다. */
  get root(): string {
    return this.#options.root;
  }

  dirFor(repositoryId: number): string {
    return mirrorPath(this.#options.root, repositoryId);
  }

  /**
   * 미러를 최신으로 만든다.
   *
   * 없으면 클론하고 있으면 fetch한다. **`--prune`을 붙이는 이유**는 원격에서
   * 지워진 브랜치가 미러에 남으면 `resolveHead`가 이미 없는 브랜치의 head를
   * 답하기 때문이다 — 그 값으로 채번하면 존재하지 않는 구간이 나온다.
   */
  async sync(ref: RepoRef, repositoryId: number): Promise<MirrorSyncResult> {
    const dir = this.dirFor(repositoryId);
    const token = (await this.#options.tokenFor?.(ref.owner)) ?? null;
    const auth = authArgs(token);
    const exists = await this.#isRepo(dir);

    if (!exists) {
      await mkdir(dirname(dir), { recursive: true });
      await this.#run([
        ...auth,
        'clone',
        '--mirror',
        // ADR-005: 파일 내용은 이 시스템이 전혀 쓰지 않는다.
        '--filter=blob:none',
        this.#options.remoteUrl(ref),
        dir,
      ]);
      return { action: 'cloned', dir };
    }

    await this.#run([...auth, '-C', dir, 'fetch', '--prune', '--no-tags', 'origin']);
    return { action: 'fetched', dir };
  }

  /** `refs/heads/<branch>`가 미러에 있는지. 동기화 성공을 브랜치 존재로 오해하지 않기 위해 따로 둔다. */
  async hasBranch(repositoryId: number, branch: string): Promise<boolean> {
    if (!isSafeBranch(branch)) return false;
    const result = await this.#runner.run(
      ['-C', this.dirFor(repositoryId), 'rev-parse', '--verify', '--quiet', `refs/heads/${branch}`],
      { env: this.#env(), timeoutMs: this.#options.timeoutMs ?? MIRROR_SYNC_TIMEOUT_MS },
    );
    return result.code === 0;
  }

  async #isRepo(dir: string): Promise<boolean> {
    try {
      // 미러 클론은 bare라 `HEAD`가 디렉터리 바로 아래에 있다.
      const found = await stat(`${dir}/HEAD`);
      return found.isFile();
    } catch {
      return false;
    }
  }

  async #run(args: readonly string[]): Promise<void> {
    const result = await this.#runner.run(args, {
      env: this.#env(),
      timeoutMs: this.#options.timeoutMs ?? MIRROR_SYNC_TIMEOUT_MS,
    });
    if (result.code !== 0) {
      // stderr에 원격 URL이 섞여 나온다. `safeMessage`를 거친다 (NFR-005).
      throw new MirrorSyncError(`git ${args.find((a) => !a.startsWith('-')) ?? ''} 실패 (${String(result.code)}): ${safeMessage(result.stderr).slice(0, 300)}`);
    }
  }
}

/**
 * 미러 볼륨 사용률 (`mirror_disk_usage_ratio`, 관측성 문서 4장).
 *
 * @returns 볼륨을 읽을 수 없으면 `null`. **0을 돌려주지 않는다** — 0은
 * "비어 있다"로 읽히는데 실제로는 모르는 것이다.
 */
export async function mirrorDiskUsage(root: string): Promise<number | null> {
  return new Promise((resolve) => {
    statfs(root, (error, stats) => {
      if (error !== null) {
        resolve(null);
        return;
      }
      resolve(diskUsageRatio({ blocks: Number(stats.blocks), bfree: Number(stats.bfree) }));
    });
  });
}
