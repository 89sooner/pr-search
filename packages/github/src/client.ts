/**
 * GitHub Enterprise REST 클라이언트 (SRS 10장, FR-ING-004).
 *
 * **이 클라이언트는 Search/Data Plane 전용이다.** 읽기만 하고, `gh` CLI를
 * 실행하지 않으며, 사용자 위임 신원을 쓰지 않는다. 사용자가 요청한 GitHub
 * 작업은 Operations Plane의 몫이고 신원·권한·감사 경계가 아예 다르다 (ADR-013).
 */

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
  readonly commit: { readonly message: string };
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
    return this.#transport.getAll<CommitSummary>({
      org: orgOf(ref),
      path: `/repos/${ref.owner}/${ref.repo}/commits`,
      query: { sha: query.sha, since: query.since },
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

  /** 접근 범위 산출용 협업자·권한 조회 (FR-AUTH-003). */
  async listCollaborators(ref: RepoRef, options: CallOptions = {}): Promise<CollaboratorSummary[]> {
    return this.#transport.getAll<CollaboratorSummary>({
      org: orgOf(ref),
      path: `/repos/${ref.owner}/${ref.repo}/collaborators`,
      ...options,
    });
  }
}
