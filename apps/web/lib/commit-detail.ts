/**
 * W-003 판정 (WP-018 / CR-021, FR-SRCH-002).
 *
 * W-002와 같은 규칙 위에 선다 — **화면이 모르는 것을 아는 척하지 않는다.**
 * 다만 커밋은 PR보다 아는 것이 훨씬 적다: `EVT-ING-002`가 커밋에 대해 **SHA만**
 * 나르므로(CR-017, DEV-060) 메시지도 작성자도 시각도 없다. 그 빈칸을 소속
 * PR로 메우고 싶은 유혹이 이 화면의 가장 큰 함정이다 (DEV-090).
 */

/** 커밋이 대상 브랜치에서 갖는 역할. 서버가 싣는 값 그대로다. */
export type CommitRole = 'merge_commit' | 'source_commit' | 'direct_push';

export interface LinkedPullRequest {
  readonly pr_number?: number;
  readonly title?: string;
  readonly author?: string;
  readonly reviewers?: readonly string[];
  readonly approved_by?: readonly string[];
  readonly state?: string;
  readonly merged_at?: string;
  /** 머지된 PR에만 있다 (CR-021, DEV-091). `no_sequence` 안내가 이것으로 링크를 만든다. */
  readonly merge_commit_sha?: string;
  readonly url?: string;
}

export interface CommitDetailSource {
  readonly repository?: string;
  readonly commit_sha?: string;
  readonly short_sha?: string;
  readonly role?: string;
  readonly base_branch?: string;
  readonly merge_seq?: number | null;
  readonly seq_epoch?: number | null;
  readonly sequence_space?: string | null;
  readonly pull_requests?: readonly LinkedPullRequest[];
  readonly reason_code?: string;
  readonly enrichment_pending?: boolean;
  /** 참조 추출의 완결 상태. 되돌림·체리픽과 무관하다 (CR-042, DEV-258). */
  readonly links_pending?: boolean;
  readonly repository_archived?: boolean;

  /* WP-020이 붙일 커밋 메타데이터. 지금은 어느 키도 오지 않는다. */
  readonly message?: string;
  readonly author?: string;
  readonly authored_at?: string;
  readonly changed_paths?: readonly ChangedPath[];
  readonly changed_files_count?: number;
  readonly additions?: number;
  readonly deletions?: number;
}

export interface ChangedPath {
  readonly path: string;
  readonly additions?: number;
  readonly deletions?: number;
}

// ------------------------------------------------------------------ 역할

/**
 * 역할 배지.
 *
 * **셋을 모두 다룬다.** `direct_push`는 WP-021 전까지 도달하지 않지만
 * (DEV-061), 이것은 `epoch_stale`(DEV-087)처럼 화면 상태 전체가 아니라
 * **전량 매핑의 한 값**이다 — 값이 오는 날 배지가 저절로 옳아진다. 빼 두면
 * 그날 `undefined`가 화면에 뜬다.
 */
export function roleLabel(role: string | undefined): { readonly text: string; readonly known: boolean } {
  switch (role) {
    case 'merge_commit':
      return { text: '머지 커밋', known: true };
    case 'source_commit':
      return { text: '원본 커밋', known: true };
    case 'direct_push':
      return { text: '직접 푸시', known: true };
    default:
      /*
       * 서버가 역할을 싣지 않았다. 지어내지 않는다 — `merge_commit`으로
       * 기본값을 두면 원본 커밋이 "이 커밋이 브랜치에 착지했다"로 읽힌다.
       */
      return { text: '역할 미상', known: false };
  }
}

// ------------------------------------------------------------- 시퀀스 위치

/**
 * 시퀀스 위치의 세 갈래.
 *
 * - `assigned` — 채번됐다. WP-021 뒤에만 나온다
 * - `off_chain` — **대상 브랜치 first-parent 체인 밖**이다 (원본 커밋)
 * - `not_computed` — 체인 위에 있는데 아직 채번하지 않았다
 */
export type SequencePositionState = 'assigned' | 'off_chain' | 'not_computed';

/**
 * **시퀀스 값이 아니라 역할로 판정한다** (CR-021, DEV-092).
 *
 * `merge_seq`는 WP-021까지 **모든 커밋에서 `null`**이다. 값만 보면 머지
 * 커밋까지 "체인 밖"이 되는데, 그것은 거짓이다 — 머지 커밋은 정의상 체인
 * 위에 있고 단지 아직 번호를 받지 못했을 뿐이다.
 *
 * `source_commit`이 체인 밖인 것은 **squash merge의 정의**에서 따라온다:
 * 원본 커밋은 브랜치에 직접 착지하지 않고 머지 커밋 하나로 압축된다.
 * 시퀀스가 없어도 지금 말할 수 있는 사실이라 여기서 판정한다.
 */
export function sequencePositionState(commit: CommitDetailSource): SequencePositionState {
  if (commit.merge_seq !== null && commit.merge_seq !== undefined) return 'assigned';
  if (commit.role === 'source_commit') return 'off_chain';
  return 'not_computed';
}

/**
 * 원본 커밋이 실제로 착지한 머지 커밋.
 *
 * 소속 PR 중 **머지된 것**의 `merge_commit_sha`를 쓴다. 미머지 PR만 있으면
 * 그런 커밋이 아직 없으므로 `null`이다 — 링크 대신 PR로 가는 길만 준다.
 */
export function landedAsCommitSha(commit: CommitDetailSource): string | null {
  for (const pr of commit.pull_requests ?? []) {
    const sha = pr.merge_commit_sha;
    if (sha !== undefined && sha !== '') return sha;
  }
  return null;
}

// -------------------------------------------------------------- 소속 PR

/**
 * 소속 PR 목록이 왜 이 모습인가.
 *
 * - `linked` — PR이 하나 이상 있다 (`multi_pr`은 길이 2 이상인 경우다)
 * - `direct_push` — **PR을 거치지 않았다.** `role`이 그렇게 말할 때만이다
 * - `not_linked_yet` — 투영이 아직 PR 번호를 잇지 못했다
 *
 * **뒤의 둘을 섞지 않는 것이 이 함수의 존재 이유다** (CR-021, DEV-093).
 * 서버의 `reason_code: 'no_pull_request'`는 "아직 못 이었다"이지 "직접
 * 푸시"가 아니다 — `detail.ts`의 주석이 그렇게 명시한다. 섞어서 "PR 없음
 * (직접 푸시)"이라고 쓰면 **없는 사실을 주장하게 된다.**
 */
export type LinkedPrState = 'linked' | 'direct_push' | 'not_linked_yet';

export function linkedPrState(commit: CommitDetailSource): LinkedPrState {
  if ((commit.pull_requests ?? []).length > 0) return 'linked';
  if (commit.role === 'direct_push') return 'direct_push';
  return 'not_linked_yet';
}

// ------------------------------------------------------- 변경 경로 (C-025)

export interface ChangedPathModel {
  readonly paths: readonly ChangedPath[];
  /** **`null`은 "세지 않았다"** — `0`("바꾼 파일이 없다")과 다르다 (DEV-094). */
  readonly totalCount: number | null;
  readonly truncated: boolean;
  /** 커밋 메타데이터가 통째로 없는가. WP-020 전까지 항상 참이다. */
  readonly notCollected: boolean;
}

/**
 * 변경 경로 모델.
 *
 * `changed_paths` 키가 **없으면** 수집 전이다. 빈 배열이면 "수집했는데 바꾼
 * 파일이 없다"이고, 그것은 다른 사실이다 (CR-016 DEV-057의 규칙).
 */
export function changedPathModel(commit: CommitDetailSource): ChangedPathModel {
  const paths = commit.changed_paths;
  if (paths === undefined) {
    return { paths: [], totalCount: null, truncated: false, notCollected: true };
  }
  const total = commit.changed_files_count;
  return {
    paths,
    totalCount: total ?? null,
    truncated: total !== undefined && total > paths.length,
    notCollected: false,
  };
}

/**
 * 파일 수 문구. **모르면 모른다고 말한다.**
 *
 * 판정 모듈에 두는 이유는 이것이 그리기가 아니라 **주장**이기 때문이다 —
 * "파일 0개"는 *파일을 하나도 바꾸지 않은 커밋*을 뜻하고, 아직 세지 않은
 * 것을 그렇게 쓰면 화면이 없는 사실을 말하게 된다.
 */
export function pathCountLabel(model: ChangedPathModel): string {
  if (model.notCollected) return '변경 경로는 아직 수집하지 않았습니다.';
  if (model.totalCount === null) {
    return `경로 ${String(model.paths.length)}건 (전체 파일 수는 수집하지 않습니다)`;
  }
  if (model.truncated) {
    return `전체 ${String(model.totalCount)}개 중 상위 ${String(model.paths.length)}건`;
  }
  return `파일 ${String(model.totalCount)}개`;
}

// ------------------------------------------------------------- 헤더 표시명

/**
 * 헤더가 무엇을 이름으로 쓰는가.
 *
 * **축약 SHA다.** 커밋 메시지 첫 줄이 있으면 그것을 쓰지만, 지금은 오지
 * 않는다 (DEV-060). **소속 PR의 제목으로 대체하지 않는다** (CR-021, DEV-090) —
 * 한 PR의 원본 커밋 N건이 전부 같은 제목으로 보이게 되고, 체리픽·되돌림
 * 조사에서 그것은 정확히 반대의 결론을 부른다.
 */
export function commitTitle(commit: CommitDetailSource): string {
  const message = commit.message;
  if (message !== undefined && message.trim() !== '') return message.split('\n')[0] ?? message;
  return commit.short_sha ?? (commit.commit_sha ?? '').slice(0, 12);
}

/** 커밋 자체의 메타데이터를 하나라도 아는가. 전부 모르면 그 사실을 밝힌다. */
export function hasCommitMetadata(commit: CommitDetailSource): boolean {
  return commit.message !== undefined || commit.author !== undefined || commit.authored_at !== undefined;
}

// ------------------------------------------------------------- GHE 링크

/**
 * GHE 커밋 URL.
 *
 * 형식은 판별기가 이미 파싱하는 것과 같다 — `<host>/<owner>/<repo>/commit/<sha>`
 * (`packages/query/src/identifier.ts`). 새로 정할 것이 없다.
 * **미구성이면 `null`** — 죽은 링크는 없는 것보다 나쁘다 (DEV-086과 같은 규칙).
 */
export function gheCommitUrl(
  baseUrl: string | undefined,
  repository: string | null,
  commitSha: string | null,
): string | null {
  if (baseUrl === undefined || baseUrl.trim() === '') return null;
  if (repository === null || repository === '' || commitSha === null || commitSha === '') return null;
  return `${baseUrl.replace(/\/+$/, '')}/${repository}/commit/${commitSha}`;
}
