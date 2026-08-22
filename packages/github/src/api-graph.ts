/**
 * GitHub REST 기반 커밋 그래프 폴백 (WP-020 / ADR-005).
 *
 * 보안 정책이 미러를 불허하는 저장소(OD-001 (b))와 미러 동기화가 깨진
 * 저장소가 이 경로로 온다. **나중에 만들지 않고 지금 만든다** — ADR-005의
 * follow-up이 그것을 명시한다. 폴백을 뒤로 미루면 정작 필요한 날 없다.
 *
 * ## 순서를 믿지 않는다
 *
 * `GET /repos/{o}/{r}/commits`의 반환 순서가 first-parent 체인이라는 보장은
 * 계약에 없다. 그래서 목록을 받아 **`parents[0]`을 직접 따라간다.** 순서를
 * 믿고 그대로 쓰면 병합이 얽힌 히스토리에서 조용히 다른 체인이 나오고,
 * 그 결과가 시퀀스가 된다.
 *
 * ## patch-id는 낼 수 없다
 *
 * REST로는 diff 본문을 커밋 단위로 안정적으로 얻어도 git의 patch-id 계산과
 * 같은 값을 보장할 수 없다. FR-REL-005 AC-5가 그 경우를 정의하므로
 * `no_mirror` 사유와 함께 `null`을 돌려준다.
 */

import type { GitHubClient, RepoRef } from './client.js';
import { CommitGraphError, type CommitGraph, type PatchIdResult } from './commit-graph.js';
import { firstParentChain, isFullSha, type ParentLink, type RevRange } from './graph-plan.js';

export interface ApiGraphOptions {
  readonly client: GitHubClient;
  /**
   * 체인 재구성에 끌어올 커밋 수 상한.
   *
   * 무한히 끌어오면 한 저장소의 백필이 조직 전체의 rate limit을 먹는다.
   * 넘으면 **던진다** — 잘린 체인으로 채번하면 서수가 전부 밀리고,
   * 그 사실을 아무도 눈치채지 못한다.
   */
  readonly maxCommits?: number;
  readonly priority?: 'realtime' | 'backfill';
}

export const DEFAULT_MAX_API_COMMITS = 5_000;

export class ApiCommitGraph implements CommitGraph {
  readonly kind = 'api' as const;
  readonly #options: ApiGraphOptions;

  constructor(options: ApiGraphOptions) {
    this.#options = options;
  }

  get #call(): { readonly priority?: 'realtime' | 'backfill' } {
    const priority = this.#options.priority;
    return priority === undefined ? {} : { priority };
  }

  async resolveHead(ref: RepoRef, branch: string): Promise<string | null> {
    return this.#options.client.getBranchHead(ref, branch, this.#call);
  }

  /**
   * 조상 여부.
   *
   * `compare(base, head)`의 `status`가 이것을 직접 말해 준다. `status`는
   * **head가 base에 대해 어떤가**를 말하므로, `ahead`(head가 앞섬)이거나
   * `identical`이면 base가 head의 조상이다. `behind`는 반대 방향이고
   * `diverged`는 조상 아님이다. 체인을 걸어 확인하는 것보다 호출이 한 번이고
   * GitHub이 그래프를 직접 보고 답한다.
   */
  async isAncestor(ref: RepoRef, ancestor: string, descendant: string): Promise<boolean> {
    assertSha(ancestor);
    assertSha(descendant);
    const compared = await this.#options.client.compareCommits(ref, ancestor, descendant, this.#call);
    const status = compared.status;
    if (status === undefined) {
      throw new CommitGraphError('api', 'compare 응답에 status가 없다 — 조상 여부를 추측하지 않는다');
    }
    return status === 'identical' || status === 'ahead';
  }

  async mergeBase(ref: RepoRef, a: string, b: string): Promise<string | null> {
    assertSha(a);
    assertSha(b);
    const compared = await this.#options.client.compareCommits(ref, a, b, this.#call);
    return compared.merge_base_commit?.sha ?? null;
  }

  async firstParentRevList(ref: RepoRef, range: RevRange): Promise<readonly string[]> {
    if (!isFullSha(range.to)) throw new CommitGraphError('api', `구간의 끝이 40자 SHA가 아니다: ${range.to}`);
    if (range.from !== null && !isFullSha(range.from)) {
      throw new CommitGraphError('api', `구간의 시작이 40자 SHA가 아니다: ${range.from}`);
    }

    const max = this.#options.maxCommits ?? DEFAULT_MAX_API_COMMITS;
    const page = await this.#options.client.listCommitsPaged(ref, { sha: range.to }, { ...this.#call, maxItems: max });
    /*
     * **절삭을 길이로 추측하지 않는다.** 배열 길이가 상한과 같다는 사실만으로는
     * 잘린 것인지 원래 그만큼인지 알 수 없다 — `truncated`가 그것을 말한다.
     * 잘린 목록으로 체인을 이으면 그 뒤 서수가 전부 밀린다.
     */
    if (page.truncated) {
      throw new CommitGraphError(
        'api',
        `체인 재구성에 필요한 커밋이 상한 ${String(max)}건을 넘는다 — 잘린 체인으로 채번하지 않는다`,
      );
    }

    try {
      return firstParentChain(page.items as readonly ParentLink[], range.to, range.from);
    } catch (error) {
      throw new CommitGraphError('api', String(error instanceof Error ? error.message : error), { cause: error });
    }
  }

  /** ADR-005: API 경로에서는 계산하지 않는다 (FR-REL-005 AC-5). */
  async patchId(_ref: RepoRef, sha: string): Promise<PatchIdResult> {
    assertSha(sha);
    return Promise.resolve({ patchId: null, unavailable: 'no_mirror' });
  }
}

function assertSha(sha: string): void {
  if (!isFullSha(sha)) throw new CommitGraphError('api', `40자 SHA가 아니다: ${sha}`);
}
