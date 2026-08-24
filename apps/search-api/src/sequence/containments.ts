/**
 * 포함 관계 조회 (API-REL-002, FR-REL-002 / WP-024).
 *
 * **판정의 정본은 PostgreSQL이다** (CR-028, DEV-142). 대상의 서수는
 * `merge_sequence`에서, 릴리스는 `release`에서 읽고, 포함은 같은 공간에서
 * `target.merge_seq <= release.merge_seq`라는 정수 비교 하나다 (AC-5) —
 * 간선을 만들지 않는다 (ADR-009).
 *
 * Elasticsearch를 부르는 곳은 하나뿐이다: **체인 밖 커밋의 소속 PR** (AC-1).
 * 원본 커밋과 PR의 대응은 커밋 문서의 `pull_request_numbers`에만 있다.
 *
 * ## 세 가지 "없음"을 가른다 (DEV-146)
 *
 * | 상태 | 응답 | 뜻 |
 * | --- | --- | --- |
 * | 릴리스 미수집 | `releases: []` + `reason: "release_not_indexed"` | 판정 자체를 할 수 없다 — 수집이 서면 달라진다 |
 * | 서수 없음 | `merge_seq: null` + `reason` | 미머지 PR·체인 밖 커밋 — 판정할 기준이 없다 |
 * | 미배포 | `releases: []` + `unreleased: true` + 대기 수 | **판정했고**, 아직 어떤 릴리스에도 없다 |
 *
 * 셋 다 200이다 — FR-REL-002 예외 처리가 "빈 배열과 사유 코드를 함께 반환한다"고
 * 정했다. 오류(404)는 저장소·대상 자체가 없을 때뿐이다.
 */

import { mergeSequenceRepo, releaseRepo, sequenceSpaceRepo } from '@prs/db';
import type { Pool, ReleaseRow, RepositoryRow } from '@prs/db';
import { applyMandatoryScopeFilter, search, type AccessScope } from '@prs/es';
import type { Client } from '@elastic/elasticsearch';

export interface ContainmentDeps {
  readonly pool: Pool;
  readonly es: Client;
  readonly timeoutMs?: number;
}

export type ContainmentTargetKind = 'pull_request' | 'commit';

export interface ContainmentReleaseItem {
  readonly tag_name: string;
  readonly released_at: string;
  readonly base_branch: string;
  readonly merge_seq: number;
  readonly source: string;
}

export type ContainmentResult =
  | {
      readonly kind: 'ok';
      readonly mergeCommitSha: string | null;
      readonly mergeSeq: number | null;
      readonly baseBranch: string | null;
      readonly pullRequestNumber: number | null;
      readonly releases: readonly ContainmentReleaseItem[];
      readonly unreleased: boolean;
      readonly pendingPullRequestCount: number;
      /** 판정 불가·미수집의 사유. 정상 판정이면 `null`. */
      readonly reason: 'release_not_indexed' | 'target_not_sequenced' | null;
    }
  | { readonly kind: 'not_found'; readonly message: string };

function toReleaseItem(row: ReleaseRow): ContainmentReleaseItem {
  return {
    tag_name: row.tag_name,
    released_at: row.released_at.toISOString(),
    base_branch: row.base_branch ?? '',
    merge_seq: Number(row.merge_seq),
    source: row.source,
  };
}

/** 대상의 서수 지점. `merge_sequence`가 답한다 — 체인에 있다는 뜻 그 자체다. */
interface TargetPoint {
  readonly baseBranch: string;
  readonly seqEpoch: number;
  readonly mergeSeq: number;
  readonly commitSha: string;
  readonly pullRequestNumber: number | null;
}

/**
 * 판정을 마친 대상에 릴리스 목록·미배포·대기 수를 붙인다.
 *
 * **에폭 검증이 먼저다** (DEV-149와 FR-SEQ-005 AC-4의 원칙). 대상의 서수가
 * 이전 에폭 것이면 릴리스와 비교할 수 없다 — 재채번이 끝나면 채번이 새 에폭
 * 행을 만들므로, 그때까지는 "판정할 기준이 없다"로 답한다.
 */
async function containmentOf(
  deps: ContainmentDeps,
  repository: RepositoryRow,
  point: TargetPoint,
): Promise<Extract<ContainmentResult, { kind: 'ok' }>> {
  const space = await sequenceSpaceRepo.findSequenceSpace(
    deps.pool,
    repository.repository_id,
    point.baseBranch,
  );
  if (space === undefined || space.seq_epoch !== point.seqEpoch) {
    return {
      kind: 'ok',
      mergeCommitSha: point.commitSha,
      mergeSeq: null,
      baseBranch: point.baseBranch,
      pullRequestNumber: point.pullRequestNumber,
      releases: [],
      unreleased: false,
      pendingPullRequestCount: 0,
      reason: 'target_not_sequenced',
    };
  }

  const releases = await releaseRepo.findContainingReleases(
    deps.pool,
    repository.repository_id,
    point.baseBranch,
    point.seqEpoch,
    point.mergeSeq,
  );

  if (releases.length > 0) {
    return {
      kind: 'ok',
      mergeCommitSha: point.commitSha,
      mergeSeq: point.mergeSeq,
      baseBranch: point.baseBranch,
      pullRequestNumber: point.pullRequestNumber,
      releases: releases.map(toReleaseItem),
      unreleased: false,
      pendingPullRequestCount: 0,
      reason: null,
    };
  }

  /*
   * 포함 릴리스가 없다. **미수집과 미배포를 가른다** (DEV-146): 이 저장소에
   * 릴리스가 하나도 없으면 판정 자체가 성립하지 않은 것이고, 있는데 전부 이
   * 서수보다 앞이면 "판정했고 미배포"다.
   */
  if (!(await releaseRepo.hasAnyRelease(deps.pool, repository.repository_id))) {
    return {
      kind: 'ok',
      mergeCommitSha: point.commitSha,
      mergeSeq: point.mergeSeq,
      baseBranch: point.baseBranch,
      pullRequestNumber: point.pullRequestNumber,
      releases: [],
      unreleased: false,
      pendingPullRequestCount: 0,
      reason: 'release_not_indexed',
    };
  }

  /*
   * 대기 PR 수 (AC-4): "마지막 릴리스 이후 head까지"의 PR 수다. 마지막 릴리스
   * 서수가 없으면(전부 체인 밖 태그) 기준을 0으로 — 채번된 모든 PR이 대기다.
   */
  const lastReleaseSeq =
    (await releaseRepo.findLatestReleaseSeq(
      deps.pool,
      repository.repository_id,
      point.baseBranch,
      point.seqEpoch,
    )) ?? 0;
  const pending = await mergeSequenceRepo.countPullRequestsAbove(
    deps.pool,
    repository.repository_id,
    point.baseBranch,
    point.seqEpoch,
    lastReleaseSeq,
  );

  return {
    kind: 'ok',
    mergeCommitSha: point.commitSha,
    mergeSeq: point.mergeSeq,
    baseBranch: point.baseBranch,
    pullRequestNumber: point.pullRequestNumber,
    releases: [],
    unreleased: true,
    pendingPullRequestCount: pending,
    reason: null,
  };
}

/** 서수 없는 대상의 공통 응답. 어느 릴리스와도 비교할 수 없다 — 미배포와 다른 상태다. */
function unsequenced(
  commitSha: string | null,
  pullRequestNumber: number | null,
): Extract<ContainmentResult, { kind: 'ok' }> {
  return {
    kind: 'ok',
    mergeCommitSha: commitSha,
    mergeSeq: null,
    baseBranch: null,
    pullRequestNumber,
    releases: [],
    unreleased: false,
    pendingPullRequestCount: 0,
    reason: 'target_not_sequenced',
  };
}

/** PR 기준 조회 (AC-2): 머지 커밋의 서수로 판정한다. */
export async function containmentForPullRequest(
  deps: ContainmentDeps,
  repository: RepositoryRow,
  prNumber: number,
): Promise<ContainmentResult> {
  const rows = await mergeSequenceRepo.findByPullRequest(deps.pool, repository.repository_id, prNumber);
  const row = rows[0];
  if (row === undefined) {
    /*
     * 채번에 없다 = 미머지이거나 아직 채번 전이다. PR의 실재는 색인이 알지만,
     * 여기서 판정에 필요한 것은 "서수가 없다"는 사실뿐이므로 조회를 늘리지
     * 않는다 — 화면은 이 응답으로 "미머지·미채번" 배지를 그린다.
     */
    return unsequenced(null, prNumber);
  }
  return containmentOf(deps, repository, {
    baseBranch: row.base_branch,
    seqEpoch: row.seq_epoch,
    mergeSeq: Number(row.merge_seq),
    commitSha: row.commit_sha,
    pullRequestNumber: prNumber,
  });
}

/**
 * 커밋 기준 조회 (AC-1): 소속 PR과 포함 릴리스.
 *
 * 체인 위 커밋(머지 커밋·직접 푸시)은 자기 서수로 판정한다. 체인 밖 커밋
 * (PR의 원본 커밋)은 **소속 PR의 머지 커밋 서수**로 판정한다 — 그 커밋이
 * 대상 브랜치에 실린 지점이 곧 그 PR의 머지이기 때문이다.
 */
export async function containmentForCommit(
  deps: ContainmentDeps,
  repository: RepositoryRow,
  scope: AccessScope,
  commitSha: string,
): Promise<ContainmentResult> {
  const sha = commitSha.toLowerCase();
  const rows = await mergeSequenceRepo.findByCommitSha(deps.pool, repository.repository_id, sha);
  const onChain = rows[0];
  if (onChain !== undefined) {
    return containmentOf(deps, repository, {
      baseBranch: onChain.base_branch,
      seqEpoch: onChain.seq_epoch,
      mergeSeq: Number(onChain.merge_seq),
      commitSha: sha,
      pullRequestNumber: onChain.pull_request_number,
    });
  }

  // 체인 밖 — 소속 PR을 색인에서 찾는다 (강제 필터를 지난다, ADR-008).
  const scoped = applyMandatoryScopeFilter(
    {
      bool: {
        filter: [
          { term: { repository_id: repository.repository_id } },
          { term: { commit_sha: sha } },
        ],
      },
    },
    scope,
  );
  const response = await search<{ pull_request_numbers?: readonly number[] }>(
    deps.es,
    'prs-commits',
    scoped,
    {
      size: 1,
      _source: ['pull_request_numbers'],
      routing: String(repository.repository_id),
      ...(deps.timeoutMs === undefined ? {} : { timeout: `${String(deps.timeoutMs)}ms` }),
    },
  );

  const source = response.hits.hits[0]?._source;
  if (source === undefined) {
    return { kind: 'not_found', message: `알 수 없는 커밋이다: ${sha.slice(0, 12)}` };
  }

  const prNumber = source.pull_request_numbers?.[0];
  if (prNumber === undefined) return unsequenced(sha, null);

  const result = await containmentForPullRequest(deps, repository, prNumber);
  if (result.kind !== 'ok') return result;
  // 대상은 커밋이다 — 조회의 SHA를 유지하되 판정 근거(머지 커밋 서수)는 그대로 싣는다.
  return { ...result, pullRequestNumber: prNumber };
}
