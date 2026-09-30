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
 *
 * **메타데이터 명령이 blob을 요구하지 않게 고르는 것은 이 파일의 몫이다** (CR-139,
 * DEV-810·811). 지연 인출 차단은 blob 읽기를 원격 요청 없이 실패시킬 뿐, 읽으려는
 * 시도 자체를 없애지 않는다. `git show`처럼 diff를 계산하는 명령은 차단된 설정에서
 * 실패하고(메일맵 읽기는 stderr에 오류 한 줄만 남긴다), 허용된 설정에서는 둘 다
 * promisor 원격에서 blob을 받아 볼륨에 남긴다 — 실측은 원장 6장 CR-139 절.
 */

import { execFile } from 'node:child_process';
import type { RepoRef } from './client.js';
import {
  CHANGED_PATHS_LIMIT,
  CommitGraphError,
  type ChangedPaths,
  type CommitGraph,
  type CommitMetadata,
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
   *
   * **`--no-use-mailmap`이 그 전제를 지킨다** (CR-139, DEV-811). `log.mailmap`이 기본으로
   * 켜져 있고 bare 저장소의 `mailmap.blob` 기본값이 `HEAD:.mailmap`이라, 기본 브랜치에
   * `.mailmap`이 있는 저장소에서는 `git log`가 시작하면서 그 blob을 읽으려 한다. 이 형식은
   * 이름을 싣지 않으므로 끄는 것이 값을 바꾸지 않는다.
   */
  async firstParentCommits(ref: RepoRef, range: RevRange): Promise<readonly FirstParentCommit[]> {
    const stdout = await this.#expect(ref, [
      'log',
      '--first-parent',
      '--reverse',
      '--no-use-mailmap',
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

  /**
   * 커밋 객체 하나를 읽는다 (WP-067 / CR-038).
   *
   * **커밋 객체만 읽는다 — blob도 원격도 부르지 않는다** (CR-139, DEV-810). 그래서
   * 명령이 `git show`가 아니라 `git log -1`이다. `git show`는 `--no-patch`를 주어도 diff
   * **출력**만 끄고 **계산**은 한다. 그 계산의 이름 변경 감지(`diff.renames` 기본 켜짐)와
   * 병합의 결합 diff는 추가와 삭제가 함께 있는 커밋에서 blob 내용을 요구하고, blobless
   * 미러에는 그 blob이 없다 — 지연 인출이 막힌 운영 기본에서는 원격 요청 없이 실패해
   * `null`이 되고 폴백이 API를 불렀으며, 허용된 설정에서는 promisor 원격에서 blob을 받아
   * 볼륨에 남겼다. `git log`는 diff를 요청받지 않으면 계산하지 않고, `-1`은 요청한 커밋
   * 하나에서 멈춘다. `--no-patch`는 그 의도를 적어 둔다.
   *
   * `--no-use-mailmap`은 기본 브랜치의 `.mailmap` blob을 읽지 않게 한다 (DEV-811,
   * `firstParentCommits`와 같은 이유). `%an`·`%ae`·`%cn`·`%ce`는 메일맵을 적용하지 않은
   * 원래 값이므로 끄는 것이 값을 바꾸지 않는다.
   *
   * 구분자는 NUL이다. 커밋 메시지에는 개행·파이프가 자유롭게 오므로 눈에 보이는
   * 문자를 구분자로 쓰면 그런 메시지 하나가 그 줄 전체를 오독하게 만든다.
   * 메시지(`%B`)는 **맨 뒤**에 둔다 — 여러 줄이라 그 앞에 필드가 오면 파싱이 깨진다.
   *
   * 시각은 `%aI`·`%cI`(ISO-8601 오프셋 포함)다. `%ad`류를 쓰면 워커의 시간대가
   * 값에 새어 들어간다.
   */
  async readCommit(ref: RepoRef, sha: string): Promise<CommitMetadata | null> {
    assertSha(sha);
    const result = await this.#git(ref, [
      'log',
      '-1',
      '--no-patch',
      '--no-use-mailmap',
      '--format=%H%x00%P%x00%an%x00%ae%x00%cn%x00%ce%x00%aI%x00%cI%x00%B',
      sha,
      '--',
    ]);
    /*
     * 커밋이 아직 미러에 없다(`bad object`). 오류가 아니라 "다음 회차에 다시 본다"이다.
     * 이때 원격을 부르지 않는 것은 명령이 아니라 지연 인출 차단(`GIT_NO_LAZY_FETCH=1`)
     * 덕분이다 — 허용된 설정에서는 git이 없는 커밋을 promisor 원격에서 받아 온다.
     */
    if (result.code !== 0 || result.stdout.trim() === '') return null;

    const parts = result.stdout.split('\u0000');
    const [full, parents, author, authorEmail, committer, committerEmail, authoredAt, committedAt] = parts;
    const message = parts.slice(8).join('\u0000');
    if (
      full === undefined || !isFullSha(full) ||
      parents === undefined || authoredAt === undefined || committedAt === undefined
    ) {
      throw new CommitGraphError('mirror', `커밋 줄을 해석할 수 없다: ${sha}`);
    }
    /*
     * `log`는 주석 태그를 그것이 가리키는 커밋으로 벗겨 답한다. 요청한 객체가 커밋이
     * 아니었다면 다른 커밋의 값을 이 SHA의 값으로 싣지 않는다 — 옛 `show`도 그 경우
     * 태그 머리글 때문에 해석에 실패해 던졌다.
     */
    if (full !== sha) {
      throw new CommitGraphError('mirror', `요청한 SHA가 커밋이 아니다: ${sha}`);
    }

    return {
      sha: full,
      parentShas: parents.trim() === '' ? [] : parents.trim().split(/\s+/),
      // 끝의 개행만 떼고 본문은 그대로 둔다 — 메시지는 검색 대상이다.
      message: (message ?? '').replace(/\n+$/, ''),
      author: emptyToNull(author),
      authorEmail: emptyToNull(authorEmail),
      committer: emptyToNull(committer),
      committerEmail: emptyToNull(committerEmail),
      authoredAt,
      committedAt,
    };
  }

  /**
   * 변경 경로 (WP-067).
   *
   * `--name-only`는 **트리만 읽는다** — blob을 인출하지 않으므로 blobless 미러의
   * 완화 근거(THR-015)가 그대로 유지된다. `patchId`가 blob을 요구하는 것과 다르다.
   *
   * 루트 커밋에는 부모가 없어 `diff-tree`가 빈 결과를 낸다. 그때는 `--root`로
   * 다시 읽는다 — 첫 커밋의 변경 경로를 "없음"으로 적으면 거짓이다.
   */
  async changedPaths(ref: RepoRef, sha: string, limit = CHANGED_PATHS_LIMIT): Promise<ChangedPaths> {
    assertSha(sha);
    const base = ['diff-tree', '--no-commit-id', '--name-only', '-r', '-z'];

    /*
     * **부모를 명시해서 비교한다.**
     *
     * 인자 하나로 부른 `diff-tree`는 **병합 커밋에 대해 아무것도 내지 않는다** —
     * 부모가 둘 이상이면 어느 쪽과 비교할지 정해지지 않기 때문이다. 그대로 두면
     * 병합 커밋의 `changed_paths`가 조용히 빈 배열이 되고, 경로 기반 조사가
     * "이 병합은 아무것도 바꾸지 않았다"고 거짓을 말한다. API 폴백은 `files[]`를
     * 첫 부모 기준으로 주므로 두 경로의 값도 갈라진다.
     *
     * **첫 부모와 비교한다.** 이 제품의 세계관이 first-parent이고(ADR-007),
     * GitHub 커밋 API도 같은 기준이다. 부모가 없는 루트 커밋만 `--root`다.
     */
    const parent = await this.#git(ref, ['rev-parse', '--verify', '--quiet', `${sha}^1`]);
    const firstParent = parent.code === 0 ? parent.stdout.trim() : '';

    /*
     * **실패를 빈 결과로 세지 않는다** (PR #42 리뷰). 미러가 없거나 커밋이 아직
     * 동기화되지 않았을 때 `[]`를 돌려주면, 폴백 그래프는 그것을 **정상 응답**으로
     * 읽어 API로 넘어가지 않고 "이 커밋은 아무 파일도 바꾸지 않았다"가 저장된다.
     * 변경 없음(exit 0 + 빈 출력)과 읽지 못함(exit != 0)은 다른 사실이다.
     */
    const result =
      firstParent === ''
        ? await this.#expect(ref, [...base, '--root', sha, '--'])
        : await this.#expect(ref, [...base, firstParent, sha, '--']);

    const all = result.split('\u0000').filter((path) => path !== '');
    return { paths: all.slice(0, limit), truncated: all.length > limit };
  }
}

/** 빈 문자열은 "값이 없다"로 읽는다 — git은 없는 필드를 빈 문자열로 낸다. */
function emptyToNull(value: string | undefined): string | null {
  return value === undefined || value === '' ? null : value;
}

function assertSha(sha: string): void {
  if (!isFullSha(sha)) throw new CommitGraphError('mirror', `40자 SHA가 아니다: ${sha}`);
}
