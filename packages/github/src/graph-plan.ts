/**
 * 커밋 그래프 접근의 순수 판정 (WP-020 / CR-023, ADR-005).
 *
 * git도 네트워크도 모르는 것만 둔다. 그래야 실제 저장소 없이 시험할 수 있고,
 * **무엇을 git에 넘길지**를 넘기기 전에 판정할 수 있다 — 인자 조립을 실행과
 * 섞으면 검증되지 않은 문자열이 `git`의 옵션 자리로 흘러드는 길이 생긴다.
 */

/** 커밋 SHA는 소문자 40자다. 축약 SHA는 검색 입력이지 그래프 입력이 아니다 (ADR-012). */
const FULL_SHA = /^[0-9a-f]{40}$/;

/**
 * 브랜치 이름으로 허용하는 모양.
 *
 * `execFile`을 쓰므로 셸은 없다. 그래도 검사하는 것은 **git 자신의 옵션
 * 주입** 때문이다 — `--upload-pack=...` 같은 이름이 인자 자리에 들어가면
 * git이 그것을 옵션으로 읽는다. 앞의 `-`를 막고 git이 거부하는 문자
 * (공백·`~`·`^`·`:`·`?`·`*`·`[`·`\`)를 함께 막는다.
 */
const SAFE_BRANCH = /^[0-9A-Za-z_][0-9A-Za-z._\-/]*$/;

export function isFullSha(value: string): boolean {
  return FULL_SHA.test(value);
}

export function isSafeBranch(value: string): boolean {
  // `..`는 git의 범위 문법이고 `.lock` 접미는 ref 이름으로 거부된다.
  if (value.includes('..') || value.endsWith('.lock') || value.endsWith('/')) return false;
  return SAFE_BRANCH.test(value);
}

/**
 * 그래프 조회 구간.
 *
 * **문자열 `"a..b"`를 받지 않는다.** 받으면 호출 측이 조립하게 되고, 그
 * 조립이 한 번 틀리면 git이 전혀 다른 구간을 내놓는다. `from`이 `null`인
 * 것은 "처음부터"라는 뜻이며, 그것을 빈 문자열로 표현하면 실수로 비운 것과
 * 구분되지 않는다.
 */
export interface RevRange {
  readonly from: string | null;
  readonly to: string;
}

export class GraphInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GraphInputError';
  }
}

/**
 * 구간을 git 인자 하나로 만든다.
 *
 * @throws {GraphInputError} SHA 모양이 아니면. **모양을 검사하지 않고 넘기면**
 * 그 문자열이 git의 revision 문법으로 해석된다 — `HEAD@{1}`이나 `--all`이
 * 구간 자리에 들어가면 조용히 다른 결과가 나온다.
 */
export function revRangeArg(range: RevRange): string {
  if (!isFullSha(range.to)) throw new GraphInputError(`구간의 끝이 40자 SHA가 아니다: ${range.to}`);
  if (range.from === null) return range.to;
  if (!isFullSha(range.from)) throw new GraphInputError(`구간의 시작이 40자 SHA가 아니다: ${range.from}`);
  return `${range.from}..${range.to}`;
}

/** 미러 디렉터리 경로. `repository_id`를 쓰는 이유는 소유자·이름이 바뀌어도 경로가 따라 바뀌지 않아야 하기 때문이다 (DEV-109). */
export function mirrorPath(root: string, repositoryId: number): string {
  const clean = root.endsWith('/') ? root.slice(0, -1) : root;
  return `${clean}/${String(repositoryId)}.git`;
}

/** 미러 브랜치 ref. `refs/heads/`를 앞에 붙이면 이름이 옵션으로 읽힐 수 없다. */
export function branchRef(branch: string): string {
  if (!isSafeBranch(branch)) throw new GraphInputError(`브랜치 이름이 안전하지 않다: ${branch}`);
  return `refs/heads/${branch}`;
}

// ------------------------------------------------------------------ 실행 환경

export interface GitEnvOptions {
  /**
   * blob 지연 인출을 허용할지 (CR-023, DEV-111).
   *
   * **기본은 금지다.** blobless 미러에서 `git patch-id`는 diff를 요구하고,
   * diff는 blob을 요구한다. git은 그것을 promisor 원격에서 **자동으로 받아와
   * 볼륨에 남긴다** — 실측으로 확인했다. 그러면 THR-015가 근거로 삼은
   * "blobless라 파일 내용이 없음"이 성립하지 않고, 인프라 5장의 용량 산정도
   * 시간이 지나며 어긋난다.
   *
   * 켜면 patch-id 체리픽 탐지(FR-REL-005 AC-2)가 살아나지만 그 대가를 진다.
   * 끄면 AC-5가 정의한 `patch_id_unavailable` 경로로 간다.
   */
  readonly allowBlobFetch?: boolean;
}

/**
 * git 실행 환경 변수.
 *
 * `GIT_TERMINAL_PROMPT=0`은 자격 증명이 없을 때 **프롬프트로 멈추지 않게**
 * 한다. 워커에는 터미널이 없으므로 멈추면 잡 타임아웃까지 매달린다.
 */
export function gitEnv(
  base: NodeJS.ProcessEnv,
  options: GitEnvOptions = {},
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...base,
    GIT_TERMINAL_PROMPT: '0',
    // 사용자 설정이 끼어들면 같은 명령이 환경마다 다른 결과를 낸다.
    GIT_CONFIG_NOSYSTEM: '1',
    HOME: base['HOME'] ?? '/nonexistent',
  };
  if (options.allowBlobFetch === true) {
    delete env['GIT_NO_LAZY_FETCH'];
  } else {
    env['GIT_NO_LAZY_FETCH'] = '1';
  }
  return env;
}

/**
 * 인증 헤더를 `-c`로 넘기는 git 전역 인자 (CR-023, DEV-110).
 *
 * **토큰을 remote URL에 넣지 않는다.** 넣으면 `.git/config`에 평문으로 남아
 * 볼륨 수명 내내 존재한다. `-c`는 프로세스 인자라 디스크에 남지 않는다.
 *
 * @returns 토큰이 없으면 빈 배열. 공개 저장소나 자격 증명 없는 시험 환경이다.
 */
export function authArgs(token: string | null): readonly string[] {
  if (token === null || token === '') return [];
  const basic = Buffer.from(`x-access-token:${token}`, 'utf8').toString('base64');
  return ['-c', `http.extraHeader=Authorization: Basic ${basic}`];
}

// ------------------------------------------------------------------ 출력 해석

/** `rev-list` 출력 → SHA 배열. 빈 줄은 버린다. */
export function parseRevList(stdout: string): readonly string[] {
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

/**
 * `git patch-id` 출력 → patch-id.
 *
 * 출력은 `<patch-id> <commit-sha>` 한 줄이다. **빈 출력은 오류가 아니다** —
 * 변경이 없는 커밋(빈 커밋, 머지 커밋의 기본 diff)은 patch-id가 없다.
 */
export function parsePatchId(stdout: string): string | null {
  const first = stdout.split('\n')[0]?.trim() ?? '';
  const id = first.split(/\s+/)[0] ?? '';
  return FULL_SHA.test(id) ? id : null;
}

/**
 * `merge-base --is-ancestor`의 종료 코드 해석.
 *
 * 0은 조상, 1은 조상 아님, **그 밖은 오류다**. 셋을 둘로 뭉개면 git이 깨진
 * 상황이 "조상 아님"으로 읽혀 재채번이 잘못 발동한다 (FR-SEQ-005).
 */
export function readAncestorExit(code: number): boolean {
  if (code === 0) return true;
  if (code === 1) return false;
  throw new Error(`merge-base --is-ancestor가 예상 밖 코드로 끝났다: ${String(code)}`);
}

// ------------------------------------------------------------------ API 폴백

export interface ParentLink {
  readonly sha: string;
  readonly parents: readonly { readonly sha: string }[];
}

/**
 * `parents[0]` 체인을 재구성한다 (ADR-005의 API 폴백).
 *
 * GitHub의 커밋 목록은 **first-parent 순서를 계약으로 보장하지 않는다.**
 * 그래서 순서를 믿지 않고 부모 링크를 직접 따라간다.
 *
 * @param to 체인의 끝(가장 새 커밋).
 * @param from 여기까지 **제외하고** 멈춘다. `null`이면 루트까지.
 * @returns 오래된 것부터(= `--reverse`와 같은 순서).
 * @throws 체인이 끊기면. **추측해서 잇지 않는다** — 빠진 커밋이 있는 채로
 * 채번하면 그 뒤 서수가 전부 밀리고, 그 사실을 아무도 눈치채지 못한다.
 */
export function firstParentChain(
  commits: readonly ParentLink[],
  to: string,
  from: string | null,
): readonly string[] {
  const byShaz = new Map(commits.map((commit) => [commit.sha, commit]));
  const chain: string[] = [];
  let cursor: string | null = to;

  while (cursor !== null && cursor !== from) {
    const node = byShaz.get(cursor);
    if (node === undefined) {
      throw new Error(`부모 체인이 끊겼다: ${cursor}를 목록에서 찾을 수 없다`);
    }
    chain.push(cursor);
    cursor = node.parents[0]?.sha ?? null;
  }

  // `from`에 닿지 못한 채 루트에서 멈췄다면 구간이 성립하지 않는다.
  if (from !== null && cursor !== from) {
    throw new Error(`구간의 시작 ${from}이 ${to}의 first-parent 체인에 없다`);
  }
  return chain.reverse();
}

// ------------------------------------------------------------------ 볼륨

/**
 * 미러 볼륨 사용률 (`mirror_disk_usage_ratio`, ADR-005 follow-up).
 *
 * @returns 0~1. **총량이 0이면 `null`이다** — 0으로 나눈 값을 0으로 적으면
 * "여유롭다"로 읽히는데, 실제로는 볼륨을 읽지 못한 것이다.
 */
export function diskUsageRatio(stat: { readonly blocks: number; readonly bfree: number }): number | null {
  if (stat.blocks <= 0) return null;
  const used = stat.blocks - stat.bfree;
  return Math.min(1, Math.max(0, used / stat.blocks));
}

/** 경보 임계 (관측성 문서 4장: 85%). */
export const MIRROR_DISK_ALERT_RATIO = 0.85;
