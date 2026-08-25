/**
 * GitHub Enterprise REST 클라이언트 (SRS 10장, FR-ING-004).
 *
 * **이 클라이언트는 Search/Data Plane 전용이다.** 읽기만 하고, `gh` CLI를
 * 실행하지 않으며, 사용자 위임 신원을 쓰지 않는다. 사용자가 요청한 GitHub
 * 작업은 Operations Plane의 몫이고 신원·권한·감사 경계가 아예 다르다 (ADR-013).
 */

import { GitHubApiError } from './errors.js';
import type { RequestPriority } from './scheduler.js';
import type { GitHubTransport, PagedResult } from './transport.js';

export interface RepoRef {
  readonly owner: string;
  readonly repo: string;
}

/** 조직은 곧 설치이고 설치는 곧 rate limit 경계다 (백엔드 아키텍처 4.2). */
function orgOf(ref: RepoRef): string {
  return ref.owner;
}

export interface CallOptions {
  readonly priority?: RequestPriority;
}

/**
 * PR 요약.
 *
 * 필드 경계는 **PR 문서 매핑(ENT-CORE-002)이 선언한 PR 고유 필드 전부**다
 * (CR-011, DEV-018). "지금 쓰는 것만" 담으면 다음 WP가 이 타입을 또 연다.
 * 본문(`body`)까지는 담되 patch/diff와 소스 코드는 담지 않는다.
 */
export interface PullRequestSummary {
  readonly number: number;
  readonly title: string;
  readonly body: string | null;
  readonly state: string;
  readonly draft: boolean;
  readonly labels: readonly { readonly name: string }[];
  readonly user: { readonly login: string } | null;
  readonly merged: boolean;
  readonly merge_commit_sha: string | null;
  /** 투영의 `lead_time_seconds`·`first_review_wait_seconds` 기준점이다. */
  readonly created_at: string;
  readonly updated_at: string | null;
  readonly closed_at: string | null;
  readonly merged_at: string | null;
  readonly head: { readonly ref: string; readonly sha: string };
  readonly base: { readonly ref: string; readonly sha: string };
}

export interface CommitSummary {
  readonly sha: string;
  readonly parents: readonly { readonly sha: string }[];
  readonly commit: {
    readonly message: string;
    /**
     * 커밋 시각 (CR-025, DEV-115).
     *
     * `merge_sequence.committed_at`이 요구하는 값이고, API 폴백 경로에서는
     * 여기가 유일한 출처다. **선택으로 둔 이유**는 GHE 버전에 따라 이 필드가
     * 빠질 수 있어서다 — 빠졌을 때 `now()`로 메우면 커밋 시각이 채번 시각이
     * 되어 시간순 정렬이 조용히 거짓말을 한다. 호출 측이 그것을 보고 던진다.
     */
    readonly committer?: { readonly date?: string };
  };
}

/** `GET /repos/{o}/{r}/compare/{base}...{head}` 응답 중 이 시스템이 쓰는 것만. */
export interface CompareResult {
  readonly merge_base_commit?: { readonly sha?: string };
  readonly status?: string;
  readonly commits?: readonly CommitSummary[];
}

export interface ChangedFile {
  readonly filename: string;
  readonly additions: number;
  readonly deletions: number;
  readonly status: string;
}

export interface ReviewSummary {
  readonly id: number;
  readonly state: string;
  readonly user: { readonly login: string } | null;
  readonly submitted_at: string | null;
}

/**
 * 저장소 요약.
 *
 * `owner.id`와 `visibility`가 여기 있는 이유는 저장소 등록이 그 둘을 요구하기
 * 때문이다 (CR-013, DEV-033). `repository.org_id`는 NOT NULL이고
 * `repository.visibility`는 `public|internal|private` CHECK이며, **ADR-008의
 * 필수 접근 범위 필터가 바로 그 두 필드 위에 선다.**
 *
 * `private: boolean`으로 대신할 수 없다. 사내 GitHub Enterprise의 저장소
 * 대부분이 `internal`인데 그것을 `private`로 적으면 접근 범위 판정이 조직
 * 전체에서 어긋난다.
 */
export interface RepositorySummary {
  readonly id: number;
  readonly full_name: string;
  readonly private: boolean;
  readonly default_branch: string;
  readonly owner: { readonly id: number; readonly login: string };
  /** GHES 3.x가 주는 값. 예전 응답에는 없을 수 있어 선택으로 둔다. */
  readonly visibility?: 'public' | 'internal' | 'private';
}

/**
 * 등록에 쓸 가시성.
 *
 * `visibility`가 오면 그대로 쓰고, 없으면 `private`로만 갈린다 — `internal`을
 * 지어내지 않는다. 모르면서 아는 척하는 것보다 좁게 잡는 편이 안전하다.
 */
export function resolveVisibility(summary: RepositorySummary): 'public' | 'internal' | 'private' {
  return summary.visibility ?? (summary.private ? 'private' : 'public');
}

export interface TeamSummary {
  readonly id: number;
  readonly slug: string;
  readonly name: string;
}

export interface CollaboratorSummary {
  readonly login: string;
  readonly permissions: Readonly<Record<string, boolean>>;
}

/**
 * `GET /repos/{owner}/{repo}/collaborators/{username}/permission`의 응답.
 *
 * `permission`은 `none`·`read`·`write`·`admin`이 아니라 GHE 내부 이름
 * (`pull`·`triage`·`push`·`maintain`·`admin`)으로 온다. `read` 이상의 판정은
 * `@prs/authz`의 `isReadable`이 한다.
 */
export interface PermissionSummary {
  readonly permission: string;
  readonly user?: { readonly login: string; readonly id: number };
}

/** 팀 구성원 (CR-015, DEV-046). */
export interface TeamMemberSummary {
  readonly id: number;
  readonly login: string;
}

export interface TagSummary {
  readonly name: string;
  readonly commit: { readonly sha: string };
}

export interface ReleaseSummary {
  readonly id: number;
  readonly tag_name: string;
  readonly draft: boolean;
  readonly prerelease: boolean;
  readonly published_at: string | null;
}

/** FR-ING-004 AC-4: 변경 파일 상한. 초과분은 절삭하고 표식을 남긴다. */
export const MAX_CHANGED_FILES = 3000;
/** FR-SRCH-003 AC-4: 원본 커밋 상한. */
export const MAX_PR_COMMITS = 250;

export class GitHubClient {
  readonly #transport: GitHubTransport;

  constructor(transport: GitHubTransport) {
    this.#transport = transport;
  }

  async getPullRequest(ref: RepoRef, number: number, options: CallOptions = {}): Promise<PullRequestSummary> {
    return this.#transport.get<PullRequestSummary>({
      org: orgOf(ref),
      path: `/repos/${ref.owner}/${ref.repo}/pulls/${String(number)}`,
      ...options,
    });
  }

  /**
   * 저장소의 PR 목록 한 페이지 (WP-019 / CR-022, DEV-098).
   *
   * ## 왜 한 페이지씩인가
   *
   * `getAllPaged`는 상한까지 **전부 모아서** 돌려준다. 백필 대상 저장소는 PR이
   * 수만 건일 수 있고, 그것을 메모리에 쌓은 뒤 처리하면 중간에 죽었을 때
   * 처음부터 다시 해야 한다. 백필은 **한 페이지 처리 → 커서 저장**을 반복해야
   * 재개가 성립한다 (FR-ING-006 AC-4).
   *
   * ## 정렬은 `updated asc`가 **기본값**이다
   *
   * GitHub 기본값은 `created desc`인데, 그대로 쓰면 **백필 도중 새 PR이 생길
   * 때마다 목록 앞이 밀려** 아직 읽지 않은 항목이 뒤 페이지로 넘어가고 그대로
   * 건너뛰어진다.
   *
   * `updated asc`에서는 갱신된 PR이 **목록 끝으로** 간다. 이미 처리한 것이
   * 다시 걸릴 수는 있어도 **아직 처리하지 않은 것이 사라지지 않는다.**
   * 재처리는 문서 버전 비교가 흡수하지만(FR-ING-005 AC-1), 건너뛴 PR은
   * 아무도 눈치채지 못한 채 검색에서 영영 빠진다 — 조사 도구에서 그것이
   * 훨씬 나쁘다. **백필은 이 기본값을 그대로 쓴다.**
   *
   * ## `direction`을 왜 열었나 (CR-033, DEV-175)
   *
   * 조정 스캔(JOB-ING-005)은 "최근 24시간 갱신 PR"을 읽어야 하는데, `/pulls`에는
   * `since`가 없다. `updated desc`로 읽어 컷오프에 닿으면 멈추는 것이 그 질문에
   * 답하는 유일한 방법이다 — **없는 `since`를 있는 것처럼 만들지 않는다.**
   *
   * 기본값을 `asc`로 두는 것이 이 옵션의 핵심이다. 백필의 건너뜀 방지(DEV-098)는
   * 호출부가 아무것도 하지 않아도 유지되고, `desc`를 고르는 쪽이 **전량을 읽지
   * 않는다는 것을 알고** 고른다.
   *
   * @returns `hasMore`는 "이 페이지가 꽉 찼다"는 뜻이다. 총계가 `perPage`의
   * 배수면 다음 요청이 빈 배열을 받는데, 그 한 번의 여분 요청이 "더 있는지"를
   * 추측하지 않는 값이다.
   */
  async listPullRequestsPage(
    ref: RepoRef,
    page: number,
    options: CallOptions & {
      readonly perPage?: number;
      /** 기본 `asc` — 백필의 건너뜀 방지(DEV-098)가 기본값으로 유지된다. */
      readonly direction?: 'asc' | 'desc';
      /**
       * 정렬 키. 기본 `updated` — 기존 호출부의 의미를 바꾸지 않는다 (CR-037, DEV-204).
       *
       * **전량 열거에는 `created`를 쓴다.** `updated`로 페이지를 넘기는 동안 어떤 PR이
       * 갱신되면 그 항목이 목록 끝으로 이동하고, **뒤에 있던 항목이 이미 지나온 페이지
       * 자리로 당겨져 영영 방문되지 않는다.** 생성 시각은 바뀌지 않으므로 `created`에서는
       * 어떤 항목도 앞으로 당겨지지 않는다.
       */
      readonly sort?: 'created' | 'updated';
    } = {},
  ): Promise<{ readonly items: readonly PullRequestSummary[]; readonly hasMore: boolean }> {
    const perPage = options.perPage ?? 100;
    const items = await this.#transport.get<PullRequestSummary[]>({
      org: orgOf(ref),
      path: `/repos/${ref.owner}/${ref.repo}/pulls`,
      query: {
        // 열린 것만 받으면 백필의 목적(과거 PR)을 정면으로 놓친다.
        state: 'all',
        sort: options.sort ?? 'updated',
        direction: options.direction ?? 'asc',
        per_page: perPage,
        page,
      },
      ...options,
    });

    if (!Array.isArray(items)) return { items: [], hasMore: false };
    return { items, hasMore: items.length >= perPage };
  }

  async listPullRequestCommits(ref: RepoRef, number: number, options: CallOptions = {}): Promise<CommitSummary[]> {
    return [...(await this.listPullRequestCommitsPaged(ref, number, options)).items];
  }

  /**
   * 원본 커밋 목록 + 절삭 여부 (FR-SRCH-003 AC-4).
   *
   * 보강 워커는 `source_commits_truncated`를 이 결과에서 읽는다. 배열 길이가
   * 250이라는 사실만으로는 잘린 것인지 원래 250건인지 알 수 없다.
   */
  async listPullRequestCommitsPaged(
    ref: RepoRef,
    number: number,
    options: CallOptions = {},
  ): Promise<PagedResult<CommitSummary>> {
    return this.#transport.getAllPaged<CommitSummary>({
      org: orgOf(ref),
      path: `/repos/${ref.owner}/${ref.repo}/pulls/${String(number)}/commits`,
      maxItems: MAX_PR_COMMITS,
      ...options,
    });
  }

  /**
   * 변경 파일 목록.
   *
   * 미러로는 얻을 수 없다 — blobless partial clone이라 diff를 계산할 수 없다
   * (백엔드 아키텍처 4.2). 그래서 이 경로만은 API가 유일한 출처다.
   */
  async listPullRequestFiles(ref: RepoRef, number: number, options: CallOptions = {}): Promise<ChangedFile[]> {
    return [...(await this.listPullRequestFilesPaged(ref, number, options)).items];
  }

  /** 변경 파일 목록 + 절삭 여부 (FR-ING-004 AC-4). */
  async listPullRequestFilesPaged(
    ref: RepoRef,
    number: number,
    options: CallOptions = {},
  ): Promise<PagedResult<ChangedFile>> {
    return this.#transport.getAllPaged<ChangedFile>({
      org: orgOf(ref),
      path: `/repos/${ref.owner}/${ref.repo}/pulls/${String(number)}/files`,
      maxItems: MAX_CHANGED_FILES,
      ...options,
    });
  }

  async listPullRequestReviews(ref: RepoRef, number: number, options: CallOptions = {}): Promise<ReviewSummary[]> {
    return this.#transport.getAll<ReviewSummary>({
      org: orgOf(ref),
      path: `/repos/${ref.owner}/${ref.repo}/pulls/${String(number)}/reviews`,
      ...options,
    });
  }

  /** 미러를 쓸 수 없을 때의 커밋 목록 폴백 (FR-ING-004 AC-5, ADR-005). */
  async listCommits(
    ref: RepoRef,
    query: { readonly sha?: string; readonly since?: string } = {},
    options: CallOptions = {},
  ): Promise<CommitSummary[]> {
    return [...(await this.listCommitsPaged(ref, query, options)).items];
  }

  /**
   * 절삭 여부까지 알려 주는 커밋 목록 (WP-020).
   *
   * **`listCommits`만으로는 부모 체인을 재구성할 수 없다.** 상한에서 잘린
   * 목록과 원래 그만큼인 목록이 구분되지 않아, 잘린 줄 모르고 체인을 이으면
   * 서수가 통째로 밀린다. 그 사실은 아무도 눈치채지 못한다.
   */
  async listCommitsPaged(
    ref: RepoRef,
    query: { readonly sha?: string; readonly since?: string } = {},
    options: CallOptions & { readonly maxItems?: number } = {},
  ): Promise<PagedResult<CommitSummary>> {
    return this.#transport.getAllPaged<CommitSummary>({
      org: orgOf(ref),
      path: `/repos/${ref.owner}/${ref.repo}/commits`,
      query: { sha: query.sha, since: query.since },
      ...options,
    });
  }

  /**
   * 브랜치의 현재 head (WP-020, ADR-005의 API 폴백).
   *
   * @returns 브랜치가 없으면 `null`. 아직 만들어지지 않은 대상 브랜치는
   * 오류가 아니라 "채번할 것이 없음"이다 (FR-SEQ-001).
   */
  async getBranchHead(ref: RepoRef, branch: string, options: CallOptions = {}): Promise<string | null> {
    try {
      const body = await this.#transport.get<{ commit?: { sha?: string } }>({
        org: orgOf(ref),
        path: `/repos/${ref.owner}/${ref.repo}/branches/${encodeURIComponent(branch)}`,
        ...options,
      });
      return body.commit?.sha ?? null;
    } catch (error) {
      if (error instanceof GitHubApiError && error.kind === 'not_found') return null;
      throw error;
    }
  }

  /**
   * 두 커밋의 비교 (WP-020).
   *
   * API 폴백에는 `merge-base`에 대응하는 것이 이것뿐이다 — GitHub이
   * `merge_base_commit`을 직접 준다. 커밋 목록도 함께 오지만 **그 순서를
   * first-parent 체인으로 믿지 않는다** (ADR-005).
   */
  async compareCommits(
    ref: RepoRef,
    base: string,
    head: string,
    options: CallOptions = {},
  ): Promise<CompareResult> {
    return this.#transport.get<CompareResult>({
      org: orgOf(ref),
      path: `/repos/${ref.owner}/${ref.repo}/compare/${base}...${head}`,
      ...options,
    });
  }

  async getRepository(ref: RepoRef, options: CallOptions = {}): Promise<RepositorySummary> {
    return this.#transport.get<RepositorySummary>({
      org: orgOf(ref),
      path: `/repos/${ref.owner}/${ref.repo}`,
      ...options,
    });
  }

  async listTags(ref: RepoRef, options: CallOptions = {}): Promise<TagSummary[]> {
    return this.#transport.getAll<TagSummary>({
      org: orgOf(ref),
      path: `/repos/${ref.owner}/${ref.repo}/tags`,
      ...options,
    });
  }

  async listReleases(ref: RepoRef, options: CallOptions = {}): Promise<ReleaseSummary[]> {
    return this.#transport.getAll<ReleaseSummary>({
      org: orgOf(ref),
      path: `/repos/${ref.owner}/${ref.repo}/releases`,
      ...options,
    });
  }

  async listOrgTeams(org: string, options: CallOptions = {}): Promise<TeamSummary[]> {
    return this.#transport.getAll<TeamSummary>({ org, path: `/orgs/${org}/teams`, ...options });
  }

  /**
   * **이 저장소에 접근 가능한 팀** (WP-068 / CR-035, DEV-185).
   *
   * `allowed_team_ids`가 필요로 하는 것은 **저장소 축**의 답인데, 기존 조회는
   * 셋 다 사용자 축이다(`listOrgTeams`는 조직 전체 팀, `isTeamMember`는 사용자가
   * 그 팀인가, `collaboratorPermission`은 사용자의 저장소 권한). 조직 전체 팀을
   * 훑어 각각 확인하면 **등록 한 번이 팀 수만큼의 요청**이 된다.
   *
   * GitHub이 이 질문에 직접 답하는 엔드포인트를 제공하므로 그것을 쓴다.
   */
  async listRepositoryTeams(ref: RepoRef, options: CallOptions = {}): Promise<TeamSummary[]> {
    return this.#transport.getAll<TeamSummary>({
      org: orgOf(ref),
      path: `/repos/${ref.owner}/${ref.repo}/teams`,
      ...options,
    });
  }

  /** 접근 범위 산출용 협업자·권한 조회 (FR-AUTH-003). */
  async listCollaborators(ref: RepoRef, options: CallOptions = {}): Promise<CollaboratorSummary[]> {
    return this.#transport.getAll<CollaboratorSummary>({
      org: orgOf(ref),
      path: `/repos/${ref.owner}/${ref.repo}/collaborators`,
      ...options,
    });
  }

  /**
   * 한 사용자의 저장소 **실효** 권한 (FR-AUTH-002 AC-1, WP-012).
   *
   * 조직 기본 권한·팀 권한·직접 협업자를 모두 반영한 값이라, 세 경로를 따로
   * 합치지 않아도 "read 이상 권한을 가진 저장소"가 정확히 나온다.
   *
   * 권한이 없으면 GHE가 404를 준다. **그것은 실패가 아니라 답이므로** `null`로
   * 옮긴다 — 던지면 접근 범위 산출 전체가 503이 되고, 볼 수 없는 저장소 하나가
   * 사용자의 모든 조회를 막는다.
   */
  async collaboratorPermission(
    ref: RepoRef,
    username: string,
    options: CallOptions = {},
  ): Promise<PermissionSummary | null> {
    try {
      return await this.#transport.get<PermissionSummary>({
        org: orgOf(ref),
        path: `/repos/${ref.owner}/${ref.repo}/collaborators/${encodeURIComponent(username)}/permission`,
        ...options,
      });
    } catch (error) {
      if (error instanceof GitHubApiError && error.kind === 'not_found') return null;
      throw error;
    }
  }

  /**
   * 조직 구성원 여부 (FR-AUTH-002 AC-6).
   *
   * 구성원이 아니면 404다. 여기서도 404는 답이다.
   */
  async isOrgMember(org: string, username: string, options: CallOptions = {}): Promise<boolean> {
    return this.#exists({ org, path: `/orgs/${org}/members/${encodeURIComponent(username)}`, ...options });
  }

  /** 팀 소속 여부. 소속이 아니면 404다. */
  async isTeamMember(
    org: string,
    teamSlug: string,
    username: string,
    options: CallOptions = {},
  ): Promise<boolean> {
    return this.#exists({
      org,
      path: `/orgs/${org}/teams/${encodeURIComponent(teamSlug)}/memberships/${encodeURIComponent(username)}`,
      ...options,
    });
  }

  /** 팀 구성원 목록 (CR-015, DEV-046). `team` 웹훅이 `team_member`를 갱신할 때 쓴다. */
  async listTeamMembers(org: string, teamSlug: string, options: CallOptions = {}): Promise<TeamMemberSummary[]> {
    return this.#transport.getAll<TeamMemberSummary>({
      org,
      path: `/orgs/${org}/teams/${encodeURIComponent(teamSlug)}/members`,
      ...options,
    });
  }

  /**
   * "있는가"를 묻는 조회.
   *
   * 404만 `false`로 옮긴다. 401·403·5xx는 그대로 던진다 — **권한을 모르는
   * 것과 권한이 없는 것을 섞으면 기본 거부가 무너진다** (FR-AUTH-002 AC-3).
   */
  async #exists(options: { org: string; path: string } & CallOptions): Promise<boolean> {
    try {
      await this.#transport.get<unknown>(options);
      return true;
    } catch (error) {
      if (error instanceof GitHubApiError && error.kind === 'not_found') return false;
      throw error;
    }
  }
}
