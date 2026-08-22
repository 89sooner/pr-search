/**
 * W-002 PR 상세의 판정 (WP-017 / FR-SRCH-003, CR-020).
 *
 * ## 이 파일의 전부는 "모르는 것을 아는 척하지 않기"다
 *
 * 감사에서 나온 일곱 중 다섯이 같은 모양이었다 — 명세가 요구하는 값의
 * **데이터가 없는데 타입이 그것을 표현하지 못한다** (CR-020). 없는 값을
 * 0이나 빈 문자열로 채우면 화면이 사실이 아닌 것을 말하므로, 여기서
 * **"없다"와 "모른다"를 타입으로 갈라** 컴포넌트가 다르게 그리게 한다.
 *
 * 판정을 렌더링에 섞지 않는 이유는 앞선 WP들과 같다 — DOM을 통해서만
 * 확인할 수 있으면 판정 자체를 걸 수 없다.
 */

/** `/pull-requests/{repo}/{number}` 응답 중 화면이 쓰는 것. 서버가 더 보내도 무시한다. */
export interface PrDetailSource {
  readonly repository?: string;
  readonly pr_number?: number;
  readonly title?: string;
  readonly state?: string;
  readonly draft?: boolean;
  readonly author?: string;
  readonly base_branch?: string;
  readonly head_branch?: string;
  readonly labels?: readonly string[];
  readonly reviewers?: readonly string[];
  readonly approved_by?: readonly string[];
  readonly created_at?: string;
  readonly first_review_at?: string;
  readonly merged_at?: string;
  readonly closed_at?: string;
  readonly lead_time_seconds?: number;
  readonly first_review_wait_seconds?: number;
  readonly changed_files_count?: number;
  readonly additions?: number;
  readonly deletions?: number;
  readonly files_truncated?: boolean;
  /** 미머지면 `null`. 키는 늘 있다 (FR-SRCH-003 AC-2). */
  readonly merge_commit_sha?: string | null;
  readonly source_commits?: readonly { readonly commit_sha: string }[];
  readonly source_commits_truncated?: boolean;
  /** **절삭됐을 때 정확히 그때 빠진다** (CR-017 DEV-063). */
  readonly source_commits_total?: number;
  readonly merge_seq?: number | null;
  readonly seq_epoch?: number | null;
  readonly sequence_space?: string | null;
  readonly enrichment_pending?: boolean;
  readonly links_pending?: boolean;
  readonly repository_archived?: boolean;
}

// ---------------------------------------------------------------- 커밋 목록

export interface CommitListModel {
  readonly mergeCommitSha: string | null;
  readonly sourceCommits: readonly { readonly commit_sha: string }[];
  readonly truncated: boolean;
  /**
   * 확정 총계. **`null`은 "250건 이상, 정확한 수를 모름"이다** (CR-020, DEV-083).
   *
   * 절삭됐을 때 응답에서 `source_commits_total`이 빠지므로 그때만 `null`이다.
   * 배열 길이(250)를 총계로 쓰면 거짓이 된다.
   */
  readonly totalCount: number | null;
  /** 보강이 끝나지 않아 원본 커밋이 비어 있는가 (FR-SRCH-003 예외 처리). */
  readonly enrichmentPending: boolean;
}

export function commitListModel(pr: PrDetailSource): CommitListModel {
  const commits = pr.source_commits ?? [];
  const truncated = pr.source_commits_truncated === true;

  return {
    // 키가 없으면 `null`로 본다 — 미머지와 같은 표시다 (AC-2).
    mergeCommitSha: pr.merge_commit_sha ?? null,
    sourceCommits: commits,
    truncated,
    /*
     * 절삭됐으면 총계를 **모른다.** 서버가 키를 빼는 것이 그 뜻이다.
     * 절삭되지 않았으면 서버가 준 값을 쓰되, 그마저 없으면 배열 길이가
     * 곧 총계다 — 그때는 전부 받았으므로 참이다.
     */
    totalCount: truncated ? (pr.source_commits_total ?? null) : (pr.source_commits_total ?? commits.length),
    enrichmentPending: pr.enrichment_pending === true,
  };
}

// ---------------------------------------------------------------- 타임라인

/**
 * 단계 상태 넷 (CR-020, DEV-084).
 *
 * - `done` — 일어났고 **시각을 안다**
 * - `done_at_unknown` — **일어났으나 시각을 모른다.** 승인이 그렇다:
 *   `approved_by`는 있는데 `approved_at`이 ES 매핑에 없다
 * - `pending` — 아직 일어나지 않았다
 * - `out_of_scope` — 이 릴리스에서 다루지 않는다 (릴리스 포함은 WP-024)
 *
 * `done_at_unknown`을 `pending`으로 그리면 **"승인되지 않았다"는 거짓**이 되고,
 * `done`으로 그리면 없는 시각을 지어내야 한다.
 */
export type TimelineStatus = 'done' | 'done_at_unknown' | 'pending' | 'out_of_scope';

export interface TimelineStep {
  readonly key: 'created' | 'first_review' | 'approved' | 'merged' | 'released';
  readonly label: string;
  readonly status: TimelineStatus;
  /** ISO 시각. `done`일 때만 있다. */
  readonly at: string | null;
  /** 왜 시각이 없는지. `done_at_unknown`·`out_of_scope`일 때 화면이 보여 준다. */
  readonly note: string | null;
}

export function timelineSteps(pr: PrDetailSource): readonly TimelineStep[] {
  const approvedBy = pr.approved_by ?? [];

  return [
    step('created', '생성', pr.created_at),
    step('first_review', '첫 리뷰', pr.first_review_at),
    /*
     * 승인. **`approved_by`가 비어 있지 않으면 일어난 것이다.**
     *
     * 시각은 모른다 — 투영이 로그인 목록만 저장한다. 이것을 `pending`으로
     * 그리면 승인된 PR을 "승인 대기"로 표시하게 된다.
     */
    approvedBy.length === 0
      ? { key: 'approved', label: '승인', status: 'pending', at: null, note: null }
      : {
          key: 'approved',
          label: '승인',
          status: 'done_at_unknown',
          at: null,
          note: `${approvedBy.join(', ')}이(가) 승인했습니다. 승인 시각은 수집하지 않습니다.`,
        },
    step('merged', '머지', pr.merged_at),
    {
      key: 'released',
      label: '릴리스 포함',
      status: 'out_of_scope',
      at: null,
      note: '릴리스 수집이 서면 표시됩니다.',
    },
  ];
}

function step(
  key: 'created' | 'first_review' | 'merged',
  label: string,
  at: string | undefined,
): TimelineStep {
  if (at === undefined || at === '') {
    return { key, label, status: 'pending', at: null, note: null };
  }
  return { key, label, status: 'done', at, note: null };
}

// ---------------------------------------------------------------- 리뷰 상태

/**
 * 리뷰어별 상태 (CR-020, DEV-085).
 *
 * **두 값뿐이다.** 투영은 `reviewers`·`approved_by` 로그인 목록만 저장하므로
 * "변경 요청"은 알 수 없다. 그 상태를 UI에 두면 영영 비어 있고, 사용자는
 * 그것을 **"변경 요청한 사람이 없다"로 읽는다** — 없는 것과 모르는 것이
 * 또 섞인다.
 */
export type ReviewStatus = 'approved' | 'not_yet';

export interface ReviewerState {
  readonly login: string;
  readonly status: ReviewStatus;
}

export function reviewerStates(pr: PrDetailSource): readonly ReviewerState[] {
  const approved = new Set(pr.approved_by ?? []);
  const reviewers = pr.reviewers ?? [];

  /*
   * 승인자 중 리뷰어 목록에 없는 사람도 있다 — 지정되지 않았는데 승인한
   * 경우다. 빠뜨리면 "승인 2건"이라 적어 놓고 1명만 보인다.
   */
  const extra = [...approved].filter((login) => !reviewers.includes(login));

  return [
    ...reviewers.map((login) => ({
      login,
      status: (approved.has(login) ? 'approved' : 'not_yet') as ReviewStatus,
    })),
    ...extra.map((login) => ({ login, status: 'approved' as ReviewStatus })),
  ];
}

// ---------------------------------------------------------------- 외부 링크

/**
 * GHE 링크 (CR-020, DEV-086).
 *
 * 형식은 **FR-SRCH-001 AC-3이 이미 정했다** — 판별기가 파싱하는 것과 같은
 * 모양이라 새로 정할 것이 없다. `GHE_BASE_URL`이 없으면 `null`이고, 화면은
 * 버튼을 그리지 않는다. **죽은 링크는 없는 것보다 나쁘다.**
 */
export function gheePullRequestUrl(
  baseUrl: string | undefined,
  repository: string | null,
  prNumber: number | null,
): string | null {
  if (baseUrl === undefined || baseUrl.trim() === '') return null;
  if (repository === null || repository === '' || prNumber === null) return null;
  return `${baseUrl.replace(/\/+$/, '')}/${repository}/pull/${String(prNumber)}`;
}

/**
 * 검색으로 되돌아가는 링크 (CR-019, DEV-078).
 *
 * W-001이 결과 행에 `from_q`를 실어 보낸다. 그것을 되살려 주지 않으면
 * 사용자가 조사하던 질의를 손으로 다시 친다.
 *
 * **화면이 아니라 여기서 만드는 이유**: PR 상세뿐 아니라 번호 모양이 틀린
 * 라우트도 같은 링크를 내놓아야 한다. 두 군데서 따로 만들면 한쪽만 고쳐진다.
 */
export function searchBackHref(fromQuery: string | undefined): string {
  if (fromQuery === undefined || fromQuery.trim() === '') return '/search';
  return `/search?q=${encodeURIComponent(fromQuery)}`;
}

// ---------------------------------------------------------------- 화면 상태

/** 상태 매트릭스 W-002 중 **WP-017의 DoD가 요구하는 것**만. */
export type PrScreenState =
  | { readonly kind: 'loading_initial' }
  | { readonly kind: 'ready' }
  | { readonly kind: 'not_found' }
  | { readonly kind: 'no_permission' }
  | { readonly kind: 'auth_expired'; readonly loginPath: string }
  | { readonly kind: 'offline' }
  | { readonly kind: 'error_other'; readonly code: string; readonly message: string; readonly correlationId: string | null };

export interface PrStateInput {
  readonly loading: boolean;
  readonly networkFailed: boolean;
  readonly errorBody: {
    readonly error: { readonly code: string; readonly message: string; readonly detail?: Readonly<Record<string, unknown>> };
    readonly correlation_id?: string;
  } | null;
  readonly status: number | null;
  readonly detail: PrDetailSource | null;
  readonly loginPath: string;
}

/**
 * 상태 하나로 좁힌다.
 *
 * **404는 "없다"가 아니라 "없거나 못 본다"이다** (THR-004, FR-AUTH-002 AC-4).
 * 접근 범위 밖 PR도 404로 오므로 화면은 존재 여부를 드러내지 않는다 —
 * 403을 내면 "있긴 있다"가 새어 나간다.
 */
export function resolvePrScreenState(input: PrStateInput): PrScreenState {
  if (input.loading) return { kind: 'loading_initial' };
  if (input.networkFailed) return { kind: 'offline' };

  if (input.errorBody !== null) {
    const code = input.errorBody.error.code;

    if (code === 'UNAUTHENTICATED' || input.status === 401) {
      const detail = input.errorBody.error.detail;
      const path = typeof detail?.['login_path'] === 'string' ? detail['login_path'] : input.loginPath;
      return { kind: 'auth_expired', loginPath: path };
    }
    if (input.status === 404 || code === 'NOT_FOUND') return { kind: 'not_found' };
    if (code === 'PERMISSION_UNAVAILABLE' || code === 'NO_ACCESSIBLE_REPOSITORY') {
      return { kind: 'no_permission' };
    }
    return {
      kind: 'error_other',
      code,
      message: input.errorBody.error.message,
      correlationId: input.errorBody.correlation_id ?? null,
    };
  }

  if (input.detail === null) return { kind: 'loading_initial' };
  return { kind: 'ready' };
}
