/**
 * blobless 미러 기반 커밋 그래프 (WP-020 / ADR-005).
 *
 * ## 미러는 읽기 전용이다
 *
 * PR Search는 절대 push하지 않는다. 이 파일에 `push`·`commit`·`write`를
 * 부르는 자리가 없고, 있어서도 안 된다 — 아키텍처 시험이 그것을 검사한다.
 *
 * ## 왜 셸을 쓰지 않는가
 *
 * `execFile`로 인자 배열을 그대로 넘긴다. 문자열 하나로 조립해 셸에 주면
 * 브랜치 이름 하나가 명령이 된다. 인자 자체의 안전성은 `graph-plan.ts`가
 * 넘기기 전에 판정한다.
 *
 * ## blob 지연 인출을 기본으로 막는다 (CR-023, DEV-111)
 *
 * `GIT_NO_LAZY_FETCH=1`이 기본이다. 그래프 연산(`rev-list`·`merge-base`·
 * `rev-parse`)은 blob이 전혀 필요 없으므로 이 설정에서 온전히 동작한다.
 * 영향을 받는 것은 `patchId` 하나뿐이고, 그것은 사유를 붙여 `null`을 돌려준다.
 */

import { execFile } from 'node:child_process';
import type { RepoRef } from './client.js';
import {
  CommitGraphError,
  type CommitGraph,
  type PatchIdResult,
} from './commit-graph.js';
import {
  authArgs,
  branchRef,
  gitEnv,
  isFullSha,
  mirrorPath,
  parseFirstParentCommits,
  parsePatchId,
  parseRevList,
  readAncestorExit,
  revRangeArg,
  type FirstParentCommit,
  type RevRange,
} from './graph-plan.js';
import { safeMessage } from './redact.js';

export interface GitExecResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface GitRunOptions {
  readonly env: NodeJS.ProcessEnv;
  readonly timeoutMs: number;
  /** stdin으로 넘길 본문. `git patch-id`가 그것을 읽는다. */
  readonly input?: string;
}

/** git 실행기. 시험이 실패 경로를 만들 수 있도록 주입 가능하게 둔다. */
export interface GitRunner {
  run(args: readonly string[], options: GitRunOptions): Promise<GitExecResult>;
}

/** 기본 실행기. **`execFile`이라 셸이 없다.** */
export const nodeGitRunner: GitRunner = {
  async run(args, options): Promise<GitExecResult> {
    return new Promise((resolve, reject) => {
      const child = execFile(
        'git',
        [...args],
        { env: options.env, timeout: options.timeoutMs, maxBuffer: 64 * 1024 * 1024 },
        (error, stdout, stderr) => {
          if (error === null) {
            resolve({ code: 0, stdout, stderr });
            return;
          }
          const code = (error as NodeJS.ErrnoException & { code?: number }).code;
          // 종료 코드가 숫자면 git이 정상적으로 끝난 것이다 — 호출 측이 해석한다.
          if (typeof code === 'number') {
            resolve({ code, stdout, stderr });
            return;
          }
          reject(error);
        },
      );
      /*
       * `git patch-id`는 diff를 **stdin으로** 읽는다. 넘기지 않으면 빈 입력에
       * 대해 빈 출력을 내고, 그것을 "계산 실패"로 세면 patch-id가 영영 나오지
       * 않는다. stdin을 닫지 않으면 아예 멈춘다.
       */
      if (child.stdin !== null) {
        if (options.input !== undefined) child.stdin.write(options.input);
        child.stdin.end();
      }
    });
  },
};

export interface MirrorGraphOptions {
  /** 미러 볼륨 루트 (CR-023, DEV-109). */
  readonly root: string;
  /** `repository_id`를 알아야 미러 경로가 나온다. 저장소 슬러그로는 경로를 짓지 않는다. */
  readonly repositoryIdOf: (ref: RepoRef) => Promise<number | undefined> | number | undefined;
  /** 조직별 설치 토큰. 없으면 자격 증명 없이 시도한다 (공개 저장소·시험 픽스처). */
  readonly tokenFor?: (org: string) => Promise<string | null>;
  readonly runner?: GitRunner;
  readonly timeoutMs?: number;
  /** 켜면 patch-id가 살아나지만 blob이 볼륨에 남는다 (CR-023, DEV-111). */
  readonly allowBlobFetch?: boolean;
  readonly env?: NodeJS.ProcessEnv;
}

/** 미러 refs/tags 스냅숏의 한 줄 (WP-024 / CR-028, DEV-143). */
export interface MirrorTag {
  readonly name: string;
  /**
   * git `creatordate` — 주석 태그는 taggerdate, 경량 태그는 커밋 시각이다
   * (CR-028, DEV-147). 릴리스 시각의 기본값이 이 값이다.
   */
  readonly createdAt: string;
  /** peel된 커밋 SHA. 주석 태그의 태그 객체가 아니라 그것이 가리키는 커밋이다. */
  readonly commitSha: string;
}

/** 그래프 명령 기본 상한. JOB-MIR-001의 15분과 달리 이쪽은 단건 조회다. */
const DEFAULT_TIMEOUT_MS = 60_000;

export class MirrorCommitGraph implements CommitGraph {
  readonly kind = 'mirror' as const;
  readonly #options: MirrorGraphOptions;
  readonly #runner: GitRunner;

  constructor(options: MirrorGraphOptions) {
    this.#options = options;
    this.#runner = options.runner ?? nodeGitRunner;
  }

  /** 미러 디렉터리. 저장소를 모르면 던진다 — 추측한 경로에서 git을 돌리지 않는다. */
  async dirFor(ref: RepoRef): Promise<string> {
    const id = await this.#options.repositoryIdOf(ref);
    if (id === undefined) {
      throw new CommitGraphError('mirror', `${ref.owner}/${ref.repo}의 repository_id를 알 수 없다`);
    }
    return mirrorPath(this.#options.root, id);
  }

  /** 실행 환경. 두 자리에서 같은 것을 짓지 않는다. */
  #env(): NodeJS.ProcessEnv {
    const allow = this.#options.allowBlobFetch;
    return gitEnv(this.#options.env ?? process.env, allow === undefined ? {} : { allowBlobFetch: allow });
  }

  async #git(ref: RepoRef, args: readonly string[]): Promise<GitExecResult> {
    const dir = await this.dirFor(ref);
    const token = (await this.#options.tokenFor?.(ref.owner)) ?? null;
    const full = [...authArgs(token), '-C', dir, ...args];
    try {
      return await this.#runner.run(full, {
        env: this.#env(),
        timeoutMs: this.#options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      });
    } catch (error) {
      // 메시지는 `safeMessage`를 거친다 — git 오류에 원격 URL이 섞여 나온다 (NFR-005).
      throw new CommitGraphError('mirror', safeMessage(String(error)).slice(0, 300), { cause: error });
    }
  }

  /** 0이 아니면 던진다. 종료 코드를 해석해야 하는 명령은 이것을 쓰지 않는다. */
  async #expect(ref: RepoRef, args: readonly string[]): Promise<string> {
    const result = await this.#git(ref, args);
    if (result.code !== 0) {
      throw new CommitGraphError(
        'mirror',
        `git ${args[0] ?? ''} 실패 (${String(result.code)}): ${safeMessage(result.stderr).slice(0, 200)}`,
      );
    }
    return result.stdout;
  }

  /**
   * 브랜치 head.
   *
   * **"브랜치가 없다"와 "미러를 읽지 못했다"를 가른다.** `--quiet`를 붙인
   * `rev-parse --verify`는 없는 ref에 대해 **1**, 저장소가 없거나 깨졌으면
   * **128**로 끝난다(실측 확인). 둘을 뭉쳐 `null`로 내면 미러가 통째로
   * 사라진 저장소가 "아직 브랜치가 없는 저장소"로 읽혀, 채번이 조용히 아무
   * 일도 하지 않고 시퀀스 공간은 `stale`로도 표시되지 않는다 (FR-SEQ-001
   * 예외 처리). 폴백도 발동하지 않는다 — 실패한 적이 없기 때문이다.
   */
  async resolveHead(ref: RepoRef, branch: string): Promise<string | null> {
    const result = await this.#git(ref, ['rev-parse', '--verify', '--quiet', `${branchRef(branch)}^{commit}`]);
    if (result.code === 1) return null;
    if (result.code !== 0) {
      throw new CommitGraphError(
        'mirror',
        `미러를 읽지 못했다 (${String(result.code)}): ${safeMessage(result.stderr).slice(0, 200)}`,
      );
    }
    const sha = result.stdout.trim();
    return isFullSha(sha) ? sha : null;
  }

  async isAncestor(ref: RepoRef, ancestor: string, descendant: string): Promise<boolean> {
    assertSha(ancestor);
    assertSha(descendant);
    const result = await this.#git(ref, ['merge-base', '--is-ancestor', ancestor, descendant]);
    try {
      return readAncestorExit(result.code);
    } catch (error) {
      throw new CommitGraphError('mirror', safeMessage(String(error)).slice(0, 300), { cause: error });
    }
  }

  async mergeBase(ref: RepoRef, a: string, b: string): Promise<string | null> {
    assertSha(a);
    assertSha(b);
    const result = await this.#git(ref, ['merge-base', a, b]);
    // 코드 1은 "공통 조상 없음"이다. 오류가 아니다.
    if (result.code === 1) return null;
    if (result.code !== 0) {
      throw new CommitGraphError(
        'mirror',
        `merge-base 실패 (${String(result.code)}): ${safeMessage(result.stderr).slice(0, 200)}`,
      );
    }
    const sha = result.stdout.trim();
    return isFullSha(sha) ? sha : null;
  }

  async firstParentRevList(ref: RepoRef, range: RevRange): Promise<readonly string[]> {
    const stdout = await this.#expect(ref, [
      'rev-list',
      '--first-parent',
      '--reverse',
      revRangeArg(range),
      // 같은 이름의 경로가 있어도 revision으로만 읽히게 한다.
      '--',
    ]);
    return parseRevList(stdout);
  }

  /**
   * 같은 체인을 커밋 시각과 함께 (CR-025, DEV-115).
   *
   * **`rev-list`가 아니라 `log`를 쓴다.** `rev-list --format=...`은 커밋마다
   * `commit <sha>` 머리줄을 한 줄 더 내보내 파싱이 두 갈래가 된다 — 실측으로
   * 확인했다. `log`는 한 줄에 한 커밋이라 파서가 줄 수를 곧 커밋 수로 믿을 수
   * 있다.
   *
   * `%cI`는 오프셋을 포함한 엄격 ISO 8601이다. 오프셋 없는 `%cd`를 쓰면 같은
   * 커밋이 워커의 시간대에 따라 다른 시각으로 저장된다.
   *
   * **커밋 객체만 읽으므로 blob이 필요 없다** — blobless 미러에서 그대로
   * 동작하고 THR-015의 완화 근거를 깨지 않는다.
   */
  async firstParentCommits(ref: RepoRef, range: RevRange): Promise<readonly FirstParentCommit[]> {
    const stdout = await this.#expect(ref, [
      'log',
      '--first-parent',
      '--reverse',
      '--format=%H %cI',
      revRangeArg(range),
      '--',
    ]);
    try {
      return parseFirstParentCommits(stdout);
    } catch (error) {
      throw new CommitGraphError('mirror', String(error instanceof Error ? error.message : error), { cause: error });
    }
  }

  /**
   * patch-id (FR-REL-005 AC-2).
   *
   * `diff-tree -p`가 blob을 요구한다. 기본 설정에서는 지연 인출이 막혀 있어
   * 실패하고, 그때 `blob_fetch_disabled`를 돌려준다 — **실패를 성공으로 세지
   * 않는다.** 켜져 있는데도 실패하면 `compute_failed`다.
   */
  /**
   * refs/tags 스냅숏 (WP-024 / CR-028, DEV-143).
   *
   * **미러가 태그의 정본이다.** `--mirror` 클론의 refspec `+refs/*:refs/*`는
   * `--no-tags`와 무관하게 태그를 옮기고 `--prune`이 삭제도 반영한다 — 합성
   * 저장소로 실측했다. GHE API를 부르지 않으므로 자격 증명 없이도, 백필과
   * 실시간에서 같은 경로로 돈다.
   *
   * 구분자는 NUL이다 — `|` 같은 문자는 태그 이름에 올 수 있어 구분자로 쓰면
   * 그런 태그 하나가 그 줄 전체를 오독하게 만든다.
   *
   * `%(if)%(*objectname)`은 주석 태그를 peel한다: 태그 객체가 아니라 그것이
   * 가리키는 커밋의 SHA를 얻는다. 경량 태그는 `%(objectname)`이 이미 커밋이다.
   */
  async listTags(ref: RepoRef): Promise<readonly MirrorTag[]> {
    const stdout = await this.#expect(ref, [
      'for-each-ref',
      'refs/tags',
      '--format=%(refname:short)%00%(creatordate:iso-strict)%00%(if)%(*objectname)%(then)%(*objectname)%(else)%(objectname)%(end)',
    ]);

    const tags: MirrorTag[] = [];
    for (const line of stdout.split('\n')) {
      if (line.trim() === '') continue;
      const [name, createdAt, sha] = line.split('\u0000');
      /*
       * 셋 중 하나라도 어긋난 줄은 **버리지 않고 던진다.** 조용히 건너뛰면
       * 그 태그가 diff에서 "삭제됨"으로 읽혀 릴리스가 사라진다 — 파싱 실패는
       * 데이터가 아니라 코드의 문제이므로 소리를 내야 고쳐진다.
       */
      if (name === undefined || name === '' || createdAt === undefined || sha === undefined || !/^[0-9a-f]{40}$/.test(sha)) {
        throw new CommitGraphError('mirror', `태그 줄을 해석할 수 없다: ${line.slice(0, 120)}`);
      }
      tags.push({ name, createdAt, commitSha: sha });
    }
    return tags;
  }

  async patchId(ref: RepoRef, sha: string): Promise<PatchIdResult> {
    assertSha(sha);
    const diff = await this.#git(ref, ['diff-tree', '-p', '--no-color', sha]);
    if (diff.code !== 0 || diff.stdout === '') {
      /*
       * blob이 없으면 여기서 실패한다. 기본 설정이 지연 인출을 막고 있으므로
       * **그 경우를 먼저 말한다** — `compute_failed`로 뭉치면 운영자가 계산이
       * 깨진 줄 알고 엉뚱한 곳을 본다 (CR-023, DEV-111).
       */
      const blocked = this.#options.allowBlobFetch !== true;
      return { patchId: null, unavailable: blocked ? 'blob_fetch_disabled' : 'compute_failed' };
    }

    const computed = await this.#runner.run(['patch-id', '--stable'], {
      env: this.#env(),
      timeoutMs: this.#options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      input: diff.stdout,
    });
    const id = computed.code === 0 ? parsePatchId(computed.stdout) : null;
    return id === null ? { patchId: null, unavailable: 'compute_failed' } : { patchId: id };
  }
}

function assertSha(sha: string): void {
  if (!isFullSha(sha)) throw new CommitGraphError('mirror', `40자 SHA가 아니다: ${sha}`);
}
