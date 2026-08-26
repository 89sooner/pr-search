/**
 * 커밋·PR 상세 (API-SRCH-002, API-SRCH-003 / FR-SRCH-002, FR-SRCH-003).
 *
 * ## 채워지지 않은 필드는 키를 넣지 않는다 (CR-017, DEV-060)
 *
 * 커밋 문서는 SHA·역할·소속 PR 번호·대상 브랜치만 갖는다. 매핑에는
 * `message`·`author`·`authored_at`·`parent_shas` 자리가 있으나 **투영이 채우지
 * 않는다** — `EVT-ING-002`가 커밋에 대해 SHA만 나르기 때문이다.
 *
 * 그 필드들을 `null`이나 `0`으로 채우지 않고 **키 자체를 넣지 않는다.** CR-016
 * DEV-057이 `facets`에 세운 규칙과 같다: 키 없음 = 만들지 않았다, `null` =
 * 만들었는데 비었다. `additions: 0`으로 채우면 *파일을 하나도 바꾸지 않은
 * 커밋*과 구분되지 않는다.
 *
 * ## SHA → PR은 두 단계다
 *
 * 데이터 모델 6장의 경로를 그대로 따른다: `prs-commits`에서 커밋을 찾고,
 * 그 문서의 `pull_request_numbers`로 `prs-pull-requests`를 조회한다. 커밋
 * 하나가 여러 PR에 속할 수 있고(N:M) FR-SRCH-002 AC-5가 그 전부를 요구한다.
 */

import {
  applyMandatoryScopeFilter,
  assertNoShardFailures,
  commitDetailQuery,
  pullRequestDetailQuery,
  pullRequestsByNumbersQuery,
  search,
  type AccessScope,
} from '@prs/es';
import type { Client } from '@elastic/elasticsearch';

/** 원본 커밋 상한 (FR-SRCH-003 AC-4). */
export const MAX_SOURCE_COMMITS = 250;

/** 소속 PR 상한. 커밋 하나가 속할 수 있는 PR 수는 실질적으로 작다. */
const MAX_LINKED_PULL_REQUESTS = 50;

const COMMIT_ALIAS = 'prs-commits' as const;
const PR_ALIAS = 'prs-pull-requests' as const;
const SHORT_SHA_LENGTH = 12;

export interface DetailDeps {
  readonly es: Client;
  readonly timeoutMs?: number;
}

interface CommitSource {
  readonly repository?: string;
  readonly repository_id?: number;
  readonly commit_sha?: string;
  readonly role?: string;
  // 커밋 자체의 값 (WP-067 / CR-038, DEV-210). 보강 전에는 키가 없다.
  readonly message?: string;
  readonly author?: string;
  readonly committer?: string;
  readonly authored_at?: string;
  readonly committed_at?: string;
  readonly parent_shas?: readonly string[];
  readonly changed_paths?: readonly string[];
  readonly changed_paths_truncated?: boolean;
  readonly patch_id?: string;
  readonly patch_id_unavailable?: string;
  readonly base_branch?: string;
  readonly pull_request_numbers?: readonly number[];
  readonly enrichment_pending?: boolean;
  /**
   * 참조 추출의 완결 상태 (FR-REL-003 예외 처리, CR-039 DEV-218).
   *
   * 커밋 매핑에 이 필드를 둔 이유가 W-003이 그 상태를 그릴 수 있게 하는
   * 것이었는데 응답에 싣지 않아 화면이 볼 수 없었다 (CR-042, DEV-263).
   */
  readonly links_pending?: boolean;
  readonly repository_archived?: boolean;
  readonly link_summary?: Readonly<Record<string, unknown>>;

  readonly merge_seq?: number;
  readonly seq_epoch?: number;
  readonly sequence_space?: string;
}

interface PullRequestSource {
  readonly repository?: string;
  readonly repository_id?: number;
  readonly pr_number?: number;
  readonly title?: string;
  readonly body?: string;
  readonly state?: string;
  readonly draft?: boolean;
  readonly author?: string;
  readonly reviewers?: readonly string[];
  readonly approved_by?: readonly string[];
  readonly labels?: readonly string[];
  readonly base_branch?: string;
  readonly head_branch?: string;
  readonly merge_commit_sha?: string;
  readonly source_commit_shas?: readonly string[];
  readonly source_commits_truncated?: boolean;
  readonly created_at?: string;
  readonly updated_at?: string;
  readonly merged_at?: string;
  readonly closed_at?: string;
  readonly first_review_at?: string;
  readonly lead_time_seconds?: number;
  readonly first_review_wait_seconds?: number;
  readonly changed_files_count?: number;
  readonly additions?: number;
  readonly deletions?: number;
  readonly changed_paths?: readonly string[];
  readonly files_truncated?: boolean;
  readonly link_summary?: Readonly<Record<string, unknown>>;
  readonly enrichment_pending?: boolean;
  readonly links_pending?: boolean;
  readonly repository_archived?: boolean;
  readonly merge_seq?: number;
  readonly seq_epoch?: number;
  readonly sequence_space?: string;
}

/** 있을 때만 키를 넣는다. `undefined`는 "만들지 않았다"이므로 키가 없어야 한다. */
function put(target: Record<string, unknown>, key: string, value: unknown): void {
  if (value !== undefined) target[key] = value;
}

/**
 * 시퀀스 3종. **키를 두고 `null`이다** — 채번(WP-021)이 아직 없다는 뜻이며,
 * 커밋 메타데이터처럼 "만들지 않은"(키 없음) 것과 구분된다.
 */
function sequence(source: {
  readonly merge_seq?: number;
  readonly seq_epoch?: number;
  readonly sequence_space?: string;
}): Record<string, unknown> {
  return {
    merge_seq: source.merge_seq ?? null,
    seq_epoch: source.seq_epoch ?? null,
    sequence_space: source.sequence_space ?? null,
  };
}

async function findOne<T>(
  deps: DetailDeps,
  alias: typeof COMMIT_ALIAS | typeof PR_ALIAS,
  query: ReturnType<typeof commitDetailQuery>,
  scope: AccessScope,
): Promise<T | null> {
  const response = await search<T>(deps.es, alias, applyMandatoryScopeFilter(query, scope), {
    size: 1,
    ...(deps.timeoutMs === undefined ? {} : { timeout: `${String(deps.timeoutMs)}ms` }),
  });
  assertNoShardFailures(response);
  return response.hits.hits[0]?._source ?? null;
}

/** 커밋에 딸린 PR 요약 (FR-SRCH-002 AC-4의 필드들). */
function linkedPullRequest(source: PullRequestSource): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  put(out, 'pr_number', source.pr_number);
  put(out, 'title', source.title);
  put(out, 'author', source.author);
  put(out, 'reviewers', source.reviewers === undefined ? undefined : [...source.reviewers]);
  put(out, 'approved_by', source.approved_by === undefined ? undefined : [...source.approved_by]);
  put(out, 'state', source.state);
  put(out, 'merged_at', source.merged_at);
  /*
   * W-003의 `no_sequence` 안내가 이 키를 쓴다 (CR-021, DEV-091).
   *
   * 원본 커밋 화면은 "이 커밋은 대상 브랜치에 직접 존재하지 않고 **머지 커밋
   * X로 반영되었습니다**"라고 말하고 그 X로 이동시켜야 하는데, 그 X가 여기
   * 말고는 어디에도 없다. 값은 이미 PR 문서에 있으니 **없는 것을 만드는 것이
   * 아니라 있는 것을 내보내는** 것이다.
   *
   * 미머지 PR이면 키가 없다 — `null`로 채우지 않는다. "머지 커밋이 없다"와
   * "아직 만들지 않았다"를 가르는 이 응답의 규칙 그대로다 (CR-016, DEV-057).
   */
  put(out, 'merge_commit_sha', source.merge_commit_sha);
  if (source.repository !== undefined && source.pr_number !== undefined) {
    out['url'] = `/pr/${source.repository}/${String(source.pr_number)}`;
  }
  return out;
}

/**
 * 커밋 상세 (API-SRCH-002).
 *
 * @returns 커밋이 없거나 접근 범위 밖이면 `null`. 호출 측이 404로 옮긴다 —
 * **403이 아니다.** 403이면 "있지만 못 본다"가 새어 존재 자체가 드러난다
 * (THR-004).
 */
export async function getCommitDetail(
  repository: string,
  commitSha: string,
  scope: AccessScope,
  deps: DetailDeps,
): Promise<Record<string, unknown> | null> {
  const sha = commitSha.toLowerCase();
  const commit = await findOne<CommitSource>(
    deps,
    COMMIT_ALIAS,
    commitDetailQuery(repository, sha),
    scope,
  );
  if (commit === null) return null;

  const numbers = commit.pull_request_numbers ?? [];
  let pullRequests: Record<string, unknown>[] = [];

  if (numbers.length > 0) {
    const response = await search<PullRequestSource>(
      deps.es,
      PR_ALIAS,
      applyMandatoryScopeFilter(
        pullRequestsByNumbersQuery(repository, numbers.slice(0, MAX_LINKED_PULL_REQUESTS)),
        scope,
      ),
      {
        size: MAX_LINKED_PULL_REQUESTS,
        ...(deps.timeoutMs === undefined ? {} : { timeout: `${String(deps.timeoutMs)}ms` }),
      },
    );
    assertNoShardFailures(response);
    pullRequests = response.hits.hits
      .map((hit) => hit._source)
      .filter((one): one is PullRequestSource => one !== undefined)
      .map(linkedPullRequest);
  }

  const out: Record<string, unknown> = {
    repository: commit.repository ?? repository,
    commit_sha: sha,
    short_sha: sha.slice(0, SHORT_SHA_LENGTH),
    ...sequence(commit),
    pull_requests: pullRequests,
    url: `/commit/${commit.repository ?? repository}/${sha}`,
  };

  put(out, 'repository_id', commit.repository_id);
  put(out, 'role', commit.role);
  put(out, 'base_branch', commit.base_branch);
  /*
   * 커밋 자체의 값 (WP-067 / CR-038, DEV-210).
   *
   * **`put`이 `undefined`면 키를 넣지 않는다.** 보강 전 문서와 보강된 문서를
   * 화면이 구분할 수 있어야 한다 — `null`로 채우면 "만들었는데 비었다"가 되고,
   * 그것은 "아직 보강되지 않았다"와 다른 사실이다 (DEV-060의 규율).
   */
  put(out, 'message', commit.message);
  put(out, 'author', commit.author);
  put(out, 'committer', commit.committer);
  put(out, 'authored_at', commit.authored_at);
  put(out, 'committed_at', commit.committed_at);
  put(out, 'parent_shas', commit.parent_shas === undefined ? undefined : [...commit.parent_shas]);
  put(out, 'changed_paths', commit.changed_paths === undefined ? undefined : [...commit.changed_paths]);
  put(out, 'changed_paths_truncated', commit.changed_paths_truncated);
  put(out, 'patch_id', commit.patch_id);
  put(out, 'patch_id_unavailable', commit.patch_id_unavailable);
  put(out, 'link_summary', commit.link_summary);
  put(out, 'enrichment_pending', commit.enrichment_pending);
  put(out, 'links_pending', commit.links_pending);

  put(out, 'repository_archived', commit.repository_archived);

  /*
   * PR이 하나도 없으면 사유를 남긴다 (FR-SRCH-002 AC-3 / API-SRCH-002).
   *
   * 다만 이것이 곧 `direct_push`는 **아니다** (CR-017, DEV-061). 직접 푸시
   * 커밋은 커밋 문서 자체가 만들어지지 않아 여기 도달하지 않는다. 여기서
   * PR이 비는 것은 투영이 아직 PR 번호를 잇지 못한 경우다.
   */
  if (pullRequests.length === 0) {
    out['reason_code'] = 'no_pull_request';
  }

  return out;
}

/**
 * 원본 커밋의 표시값을 **한 번에** 읽는다 (WP-067 / CR-038, DEV-211).
 *
 * ## N+1을 만들지 않는다
 *
 * `source_commits`는 최대 250개다. 하나씩 조회하면 그 비용이 목록 길이에 비례해
 * 사용자에게 그대로 간다 — 조회 하나로 묶는다.
 *
 * 접근 범위는 **여기서도 강제된다** (ADR-008). 대상 커밋이 같은 저장소라는 것을
 * 알고 있어도 우회 경로를 만들지 않는다 — 한 번 만들면 그것이 다음 조회의
 * 선례가 된다.
 *
 * 보강되지 않은 커밋은 **키가 없는 채로** 남는다. 거짓 `null`을 채우지 않는다.
 */
async function loadSourceCommits(
  repository: string,
  shas: readonly string[],
  scope: AccessScope,
  deps: DetailDeps,
): Promise<ReadonlyMap<string, CommitSource>> {
  if (shas.length === 0) return new Map();

  const response = await search<CommitSource>(
    deps.es,
    COMMIT_ALIAS,
    applyMandatoryScopeFilter(
      {
        bool: {
          filter: [
            { term: { repository: repository } },
            { terms: { commit_sha: shas.map((sha) => sha.toLowerCase()) } },
          ],
        },
      },
      scope,
    ),
    {
      size: shas.length,
      _source: ['commit_sha', 'message', 'author', 'authored_at', 'committed_at'],
      ...(deps.timeoutMs === undefined ? {} : { timeout: `${String(deps.timeoutMs)}ms` }),
    },
  );
  assertNoShardFailures(response);

  const bySha = new Map<string, CommitSource>();
  for (const hit of response.hits.hits) {
    const source = hit._source;
    if (source?.commit_sha !== undefined) bySha.set(source.commit_sha.toLowerCase(), source);
  }
  return bySha;
}

/**
 * 원본 커밋 항목 하나.
 *
 * 계약이 요구하는 최소는 `commit_sha`·제목 첫 줄·작성자·작성 시각이다. 커밋
 * 메시지 전문이 아니라 **첫 줄**을 싣는다 — 목록 행에 여러 줄이 들어가면 화면이
 * 무너지고, 전문은 커밋 상세가 준다.
 */
function sourceCommitItem(sha: string, source: CommitSource | undefined): Record<string, unknown> {
  const item: Record<string, unknown> = { commit_sha: sha };
  if (source === undefined) return item;

  const firstLine = source.message === undefined ? undefined : source.message.split('\n', 1)[0];
  put(item, 'message', firstLine);
  put(item, 'author', source.author);
  put(item, 'authored_at', source.authored_at);
  put(item, 'committed_at', source.committed_at);
  return item;
}

/**
 * PR 상세 (API-SRCH-003).
 *
 * `source_commits`는 객체 배열이며 **커밋 문서와 조인해 표시값을 채운다**
 * (CR-038, DEV-211). WP-067 이전에는 `commit_sha`만 있었고(CR-017, DEV-062),
 * 그래서 메타데이터를 채워도 화면에는 계속 SHA만 나왔다.
 */
export async function getPullRequestDetail(
  repository: string,
  prNumber: number,
  scope: AccessScope,
  deps: DetailDeps,
): Promise<Record<string, unknown> | null> {
  const pr = await findOne<PullRequestSource>(
    deps,
    PR_ALIAS,
    pullRequestDetailQuery(repository, prNumber),
    scope,
  );
  if (pr === null) return null;

  const shas = pr.source_commit_shas ?? [];
  const truncated = pr.source_commits_truncated === true || shas.length > MAX_SOURCE_COMMITS;
  const shown = shas.slice(0, MAX_SOURCE_COMMITS);
  // 조회 **한 번**이다 (DEV-211). 250개를 하나씩 물으면 그 비용이 사용자에게 간다.
  const commitMeta = await loadSourceCommits(pr.repository ?? repository, shown, scope, deps);

  const out: Record<string, unknown> = {
    repository: pr.repository ?? repository,
    pr_number: pr.pr_number ?? prNumber,
    // 미머지 PR은 `null`이다 (FR-SRCH-003 AC-2). 키가 없으면 화면이 "아직 모른다"로 읽는다.
    merge_commit_sha: pr.merge_commit_sha ?? null,
    source_commits: shown.map((sha) => sourceCommitItem(sha, commitMeta.get(sha.toLowerCase()))),
    source_commits_truncated: truncated,
    ...sequence(pr),
    url: `/pr/${pr.repository ?? repository}/${String(pr.pr_number ?? prNumber)}`,
  };

  /*
   * 총계는 절삭되지 않았을 때만 싣는다 (CR-017, DEV-063).
   *
   * 250건에서 잘렸을 때의 진짜 총계는 저장되어 있지 않다 — 보강 payload가
   * 그 수를 나르지 않는다. 250을 총계로 내보내면 거짓이므로 키를 뺀다.
   * `source_commits_truncated: true`가 "더 있다"를 말하고, 얼마나 더 있는지는
   * 모른다고 두는 편이 틀린 수를 주는 것보다 낫다.
   */
  if (!truncated) out['source_commits_total'] = shas.length;

  put(out, 'repository_id', pr.repository_id);
  put(out, 'title', pr.title);
  put(out, 'body', pr.body);
  put(out, 'state', pr.state);
  put(out, 'draft', pr.draft);
  put(out, 'author', pr.author);
  put(out, 'reviewers', pr.reviewers === undefined ? undefined : [...pr.reviewers]);
  put(out, 'approved_by', pr.approved_by === undefined ? undefined : [...pr.approved_by]);
  put(out, 'labels', pr.labels === undefined ? undefined : [...pr.labels]);
  put(out, 'base_branch', pr.base_branch);
  put(out, 'head_branch', pr.head_branch);
  put(out, 'created_at', pr.created_at);
  put(out, 'updated_at', pr.updated_at);
  put(out, 'merged_at', pr.merged_at);
  put(out, 'closed_at', pr.closed_at);
  put(out, 'first_review_at', pr.first_review_at);
  put(out, 'lead_time_seconds', pr.lead_time_seconds);
  put(out, 'first_review_wait_seconds', pr.first_review_wait_seconds);
  put(out, 'changed_files_count', pr.changed_files_count);
  put(out, 'additions', pr.additions);
  put(out, 'deletions', pr.deletions);
  put(out, 'changed_paths', pr.changed_paths === undefined ? undefined : [...pr.changed_paths]);
  put(out, 'files_truncated', pr.files_truncated);
  put(out, 'link_summary', pr.link_summary);
  put(out, 'enrichment_pending', pr.enrichment_pending);
  put(out, 'links_pending', pr.links_pending);
  put(out, 'repository_archived', pr.repository_archived);

  return out;
}
