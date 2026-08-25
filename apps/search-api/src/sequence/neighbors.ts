/**
 * 선행·후행 조회 (API-REL-001 / WP-027, CR-031 DEV-161~166).
 *
 * ## 정본에서 이웃을 고른다
 *
 * 색인에서 `range(merge_seq)`로 고르면 **반영이 늦은 항목이 오류 없이 빠지고** 그
 * 자리에 더 먼 항목이 올라와 "인접"이 거짓이 된다 (DEV-166 — 범위 조회가 정본을
 * 읽는 것과 같은 이유, DEV-130). PostgreSQL이 앞뒤를 정하고 색인은 제목·작성자만
 * 채운다. 채우지 못한 항목은 `indexed: false`로 밝힌다.
 *
 * ## 직접 푸시 커밋을 거르지 않는다
 *
 * FR-REL-001 AC-2(SRS v2.4, CR-031)가 그렇게 정한다. 빼면 서수가 `1339 → 1341`처럼
 * 건너뛴 채 보여 사용자가 **누락으로 읽는다**. 그 항목의 제목·작성자는 커밋 메타데이터
 * 보강(WP-067) 전까지 `null`이고 **소속 PR의 값으로 대신 채우지 않는다** (DEV-090).
 *
 * ## 공간은 요청이 지정한다 (CR-032, DEV-168)
 *
 * 서수는 `(저장소, 대상 브랜치)` 안에서만 의미가 있다 (ADR-007). 한 커밋이 여러
 * 브랜치의 현재 체인에 함께 있을 수 있으므로, 공간을 서버가 고르면 사용자가 묻지
 * 않은 브랜치의 서수를 낼 수 있다. `base_branch`는 필수이며 응답의 공간은 언제나
 * 그 값이다.
 *
 * ## 시퀀스가 없을 때 사유를 가른다
 *
 * `NO_SEQUENCE` 한 코드 아래 `not_merged`와 `not_sequenced`다 (DEV-164). C-014가
 * "머지되지 않았다"는 **사실 주장**과 "아직 모른다"를 같이 그리는 것을 금지하므로
 * (DEV-077) 서버가 그 둘을 가려 준다.
 */

import { mergeSequenceRepo } from '@prs/db';
import type { MergeSequenceRow, Pool, SequenceSpaceState } from '@prs/db';
import { applyMandatoryScopeFilter, search, type AccessScope } from '@prs/es';
import type { Client } from '@elastic/elasticsearch';

/** FR-REL-001 AC-1. 한쪽당 건수다 — 응답은 최대 `2N + 1`행이다. */
export const DEFAULT_NEIGHBOR_COUNT = 10;
export const MAX_NEIGHBOR_COUNT = 50;

export function clampNeighborCount(raw: unknown): number {
  if (typeof raw !== 'string' || raw.trim() === '') return DEFAULT_NEIGHBOR_COUNT;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) return DEFAULT_NEIGHBOR_COUNT;
  return Math.min(parsed, MAX_NEIGHBOR_COUNT);
}

export interface NeighborsDeps {
  readonly pool: Pool;
  readonly es: Client;
  readonly timeoutMs?: number;
}

export interface NeighborItem {
  readonly merge_seq: number;
  readonly kind: 'pull_request' | 'commit';
  readonly commit_sha: string;
  readonly pr_number: number | null;
  readonly title: string | null;
  readonly author: string | null;
  readonly merged_at: string | null;
  readonly is_anchor: boolean;
  /** 정본에는 있는데 색인에 표시값이 없다 (DEV-130). 직접 푸시 커밋은 늘 이 상태다. */
  readonly indexed: boolean;
  readonly url: string;
}

export interface NeighborsOk {
  readonly kind: 'ok';
  readonly baseBranch: string;
  readonly seqEpoch: number;
  readonly sequenceState: SequenceSpaceState;
  readonly anchor: {
    readonly merge_seq: number;
    readonly kind: 'pull_request' | 'commit';
    readonly pr_number: number | null;
    readonly commit_sha: string;
  };
  readonly items: readonly NeighborItem[];
  readonly boundary: { readonly at_start: boolean; readonly at_end: boolean };
}

export type NeighborsOutcome =
  | NeighborsOk
  /** 서수가 없다. `reason`이 "머지되지 않았다"와 "아직 모른다"를 가른다 (DEV-164). */
  | {
      readonly kind: 'no_sequence';
      readonly reason: 'not_merged' | 'not_sequenced';
      readonly detail: Readonly<Record<string, unknown>>;
    }
  /** 대상 자체가 없다. 접근 범위 밖과 같은 답이다 — 존재를 드러내지 않는다. */
  | { readonly kind: 'not_found'; readonly message: string };

interface PullRequestSource {
  readonly pr_number?: number;
  readonly title?: string;
  readonly author?: string;
  readonly merged_at?: string;
  readonly state?: string;
}

function urlOf(repository: string, row: MergeSequenceRow): string {
  const [owner, name] = repository.split('/');
  if (row.pull_request_number !== null) {
    return `/pr/${owner ?? ''}/${name ?? ''}/${String(row.pull_request_number)}`;
  }
  return `/commit/${owner ?? ''}/${name ?? ''}/${row.commit_sha}`;
}

/**
 * 정본 행 + 색인 표시값 → 응답 항목.
 *
 * 색인에 문서가 없으면 **행을 빼지 않고** 서수·SHA만 확정으로 그린다. 직접 푸시
 * 커밋은 PR 문서가 애초에 없으므로 언제나 이 경로다.
 *
 * ## `merged_at`은 행의 종류가 정한다 (CR-032, DEV-169)
 *
 * 커밋 시각과 PR 머지 시각은 **다른 값이다**. 직접 푸시 커밋 행에는 PR이 없으므로
 * 커밋 시각이 그 행의 시각으로서 참이고 계약도 그렇게 적는다. 그러나 **PR 행의
 * 머지 시각은 PR 문서만 안다** — 색인이 아직 그 문서를 싣지 못했다면 서버가 아는
 * 것은 "모른다"이지 병합 커밋의 `committed_at`이 아니다. 그것을 대신 실으면
 * 화면의 "머지 시각" 칸이 **확인되지 않은 값을 확정처럼** 그린다. `null`을 내고
 * 화면이 `—`로 비운다 — 세지 않은 것을 0으로 채우지 않는 DEV-133과 같은 규율이다.
 */
function toItem(
  repository: string,
  row: MergeSequenceRow,
  anchorSeq: number,
  sources: ReadonlyMap<number, PullRequestSource>,
): NeighborItem {
  const prNumber = row.pull_request_number;
  const source = prNumber === null ? undefined : sources.get(prNumber);
  return {
    merge_seq: Number(row.merge_seq),
    kind: prNumber === null ? 'commit' : 'pull_request',
    commit_sha: row.commit_sha,
    pr_number: prNumber,
    title: source?.title ?? null,
    author: source?.author ?? null,
    merged_at: prNumber === null ? row.committed_at.toISOString() : (source?.merged_at ?? null),
    is_anchor: Number(row.merge_seq) === anchorSeq,
    indexed: source !== undefined,
    url: urlOf(repository, row),
  };
}

/**
 * 서수가 없는 PR의 사유를 가른다 (DEV-164).
 *
 * **이 조회는 409 경로에서만 돈다.** 화면은 PR 문서의 `state`로 미머지를 이미 알아
 * 요청 자체를 보내지 않으므로(와이어프레임 W-002 구현 메모), 정상 흐름에는 이
 * 왕복이 없다.
 */
async function reasonForPullRequest(
  deps: NeighborsDeps,
  repositoryId: number,
  scope: AccessScope,
  prNumber: number,
): Promise<NeighborsOutcome> {
  const scoped = applyMandatoryScopeFilter(
    {
      bool: {
        filter: [
          { term: { repository_id: repositoryId } },
          { term: { pr_number: prNumber } },
        ],
      },
    },
    scope,
  );
  const response = await search<PullRequestSource>(deps.es, 'prs-pull-requests', scoped, {
    size: 1,
    routing: String(repositoryId),
    _source: ['state'],
    ...(deps.timeoutMs === undefined ? {} : { timeout: `${String(deps.timeoutMs)}ms` }),
  });
  const source = response.hits.hits[0]?._source;
  if (source === undefined) {
    return { kind: 'not_found', message: `PR을 찾을 수 없습니다: #${String(prNumber)}` };
  }
  if (source.state !== 'merged') {
    return {
      kind: 'no_sequence',
      reason: 'not_merged',
      detail: { pr_number: prNumber, state: source.state ?? null },
    };
  }
  return { kind: 'no_sequence', reason: 'not_sequenced', detail: { pr_number: prNumber } };
}

/** 서수가 없는 커밋의 사유. 실재만 확인한다 — 채번 전인지 체인 밖인지는 역할이 정한다. */
async function reasonForCommit(
  deps: NeighborsDeps,
  repositoryId: number,
  scope: AccessScope,
  commitSha: string,
): Promise<NeighborsOutcome> {
  const scoped = applyMandatoryScopeFilter(
    {
      bool: {
        filter: [
          { term: { repository_id: repositoryId } },
          { term: { commit_sha: commitSha } },
        ],
      },
    },
    scope,
  );
  const response = await search<{ commit_sha?: string }>(deps.es, 'prs-commits', scoped, {
    size: 1,
    routing: String(repositoryId),
    _source: ['commit_sha'],
    ...(deps.timeoutMs === undefined ? {} : { timeout: `${String(deps.timeoutMs)}ms` }),
  });
  if (response.hits.hits[0]?._source === undefined) {
    return { kind: 'not_found', message: `커밋을 찾을 수 없습니다: ${commitSha}` };
  }
  /*
   * 실재하지만 이 공간의 현재 에폭 체인에 없다. **채번 전인지 체인 밖(원본 커밋)인지
   * 서버는 가릴 수 없다** — 그 판정에는 역할이 필요하고 역할은 커밋 문서가 갖는다.
   * 화면이 그것을 알고 문구를 고른다 (DEV-092).
   */
  return { kind: 'no_sequence', reason: 'not_sequenced', detail: { commit_sha: commitSha } };
}

export interface NeighborsRequest {
  readonly repositoryId: number;
  readonly repositorySlug: string;
  readonly scope: AccessScope;
  readonly count: number;
  /**
   * 조회할 시퀀스 공간. **호출자가 정한다** (CR-032, DEV-168).
   *
   * 라우트가 `resolveSpace`로 이미 해석한 값이며, 서버는 여기서 다른 브랜치로
   * 옮겨 가지 않는다 — 응답의 `sequence_space`는 언제나 요청한 이 브랜치다.
   */
  readonly baseBranch: string;
  readonly seqEpoch: number;
  readonly sequenceState: SequenceSpaceState;
  readonly prNumber?: number;
  readonly commitSha?: string;
}

/**
 * 앵커를 찾고 그 앞뒤를 낸다.
 *
 * ## 앵커는 **요청한 공간 안에서만** 찾는다 (CR-032, DEV-168)
 *
 * 서수는 `(저장소, 대상 브랜치)` 공간 안에서만 의미가 있다 (ADR-007). 그런데 한
 * 커밋이 `main`과 `release/*`의 **현재 first-parent 체인에 함께 있는 것은 정상이며**
 * (`merge_sequence`의 유일 색인이 공간별로 걸려 있다), 저장소 전체를 훑어 먼저 온
 * 행을 앵커로 쓰면 어느 공간의 서수를 낼지 **데이터베이스의 반환 순서가 정한다**.
 * 정렬을 더해도 답이 결정적으로 바뀔 뿐 여전히 사용자가 묻지 않은 브랜치다.
 *
 * 그래서 공간을 요청이 지정한다. W-002는 PR 문서의 `base_branch`를, W-003은 커밋
 * 문서의 `base_branch`를 이미 갖고 있으므로 새로 물을 것이 없다. 그 공간에 앵커가
 * 없으면 **다른 브랜치의 행으로 대신 답하지 않고** 서수 없음으로 답한다.
 *
 * 에폭은 라우트가 해석한 현재 에폭이다. 이전 에폭 행은 앵커가 되지 않는다 —
 * 그것으로 이웃을 고르면 **다른 커밋들이 이웃으로 나온다** (DEV-149·DEV-160).
 */
export async function findNeighbors(
  deps: NeighborsDeps,
  request: NeighborsRequest,
): Promise<NeighborsOutcome> {
  const { repositoryId, scope, count, baseBranch, seqEpoch } = request;
  /*
   * 공간 안의 앵커 해석은 API-SEQ-002가 쓰는 함수를 그대로 쓴다 (WP-023). 두
   * 경로가 같은 질의를 각자 갖고 있으면 한쪽만 고쳐지는 날이 온다.
   */
  const anchor =
    request.prNumber !== undefined
      ? await mergeSequenceRepo.findPointByPullRequest(
          deps.pool,
          repositoryId,
          baseBranch,
          seqEpoch,
          request.prNumber,
        )
      : await mergeSequenceRepo.findPointByCommit(
          deps.pool,
          repositoryId,
          baseBranch,
          seqEpoch,
          request.commitSha ?? '',
        );

  if (anchor === null) {
    return request.prNumber !== undefined
      ? await reasonForPullRequest(deps, repositoryId, scope, request.prNumber)
      : await reasonForCommit(deps, repositoryId, scope, request.commitSha ?? '');
  }

  const anchorSeq = anchor.mergeSeq;
  // 앵커를 찾은 공간이 곧 요청한 공간이다 — 이웃도 같은 공간에서만 고른다.
  const neighbors = await mergeSequenceRepo.findNeighbors(
    deps.pool,
    repositoryId,
    baseBranch,
    seqEpoch,
    anchorSeq,
    count,
  );

  // 표시값은 색인에서 채운다 — 강제 필터를 지난다 (ADR-008).
  const prNumbers = [
    ...new Set(
      neighbors.filter((row) => row.pull_request_number !== null).map((row) => row.pull_request_number as number),
    ),
  ];
  const sources = new Map<number, PullRequestSource>();
  if (prNumbers.length > 0) {
    const scoped = applyMandatoryScopeFilter(
      {
        bool: {
          filter: [
            { term: { repository_id: repositoryId } },
            { terms: { pr_number: prNumbers } },
          ],
        },
      },
      scope,
    );
    const response = await search<PullRequestSource>(deps.es, 'prs-pull-requests', scoped, {
      size: prNumbers.length,
      routing: String(repositoryId),
      _source: ['pr_number', 'title', 'author', 'merged_at'],
      ...(deps.timeoutMs === undefined ? {} : { timeout: `${String(deps.timeoutMs)}ms` }),
    });
    for (const hit of response.hits.hits) {
      const source = hit._source;
      if (source?.pr_number !== undefined) sources.set(source.pr_number, source);
    }
  }

  const before = neighbors.filter((row) => Number(row.merge_seq) < anchorSeq).length;
  const after = neighbors.filter((row) => Number(row.merge_seq) > anchorSeq).length;

  return {
    kind: 'ok',
    /*
     * **요청한 공간을 그대로 되돌린다** (CR-032, DEV-168). 저장 행의 값을 쓰면
     * 불변식이 "우연히 같다"에 기대게 된다 — 응답의 공간은 구조적으로 요청과
     * 같아야 한다.
     */
    baseBranch,
    seqEpoch,
    sequenceState: request.sequenceState,
    anchor: {
      merge_seq: anchorSeq,
      kind: anchor.pullRequestNumber === null ? 'commit' : 'pull_request',
      pr_number: anchor.pullRequestNumber,
      commit_sha: anchor.commitSha,
    },
    items: neighbors.map((row) => toItem(request.repositorySlug, row, anchorSeq, sources)),
    // 한쪽을 `count`만큼 채우지 못했다 = 그 끝이 공간의 경계다 (AC-4).
    boundary: { at_start: before < count, at_end: after < count },
  };
}
