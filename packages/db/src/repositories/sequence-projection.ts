/**
 * 시퀀스 투영 대상의 정본 해석 (CR-113 / WP-098, FR-SEQ-001 AC-7, ADR-004 Amendment).
 *
 * ## 정본은 셋의 교차다
 *
 * "이 서수를 어느 문서에 비추는가"는 PostgreSQL만 보고 답한다.
 *
 *   - `merge_sequence` — 어느 SHA가 몇 번인가 (현재 에폭).
 *   - `pull_request_snapshot` — 어느 PR의 `merge_commit_sha`가 그 SHA인가. **`merge_sequence.
 *     pull_request_number`는 근거로 쓰지 않는다** — 채번 시점에 PR을 몰랐으면 그 열은 `null`로
 *     남고, 그것을 믿으면 나중에 확인된 PR이 영원히 제외된다.
 *   - `commit_snapshot` — 커밋 문서가 정본에서 만들어질 수 있는가 (`projected_at`은 실제로
 *     만들어졌는가).
 *
 * ## Elasticsearch 값은 입력이 아니다
 *
 * 색인이 지금 무엇을 말하든 여기서는 읽지 않는다. 색인에서 서수를 추정해 정본을 채우면
 * 파생 뷰가 정본을 승격하는 것이고, 그것이 ADR-004가 금지하는 방향이다.
 */

import type { Pool, PoolClient } from 'pg';

type Queryable = Pool | PoolClient;

/** 정본 행 하나가 가리키는 투영 대상. */
export interface ProjectionTargetRow {
  readonly merge_seq: number;
  readonly commit_sha: string;
  readonly pull_request_number: number | null;
  /** `commit_snapshot` 행이 있다 — 재구축이 커밋 문서를 만든다. */
  readonly commit_snapshot_exists: boolean;
  /** 보강이 실제로 색인에 커밋 문서를 만들었다(`projected_at IS NOT NULL`). */
  readonly commit_projected: boolean;
  /**
   * 이 SHA를 `merge_commit_sha`로, 이 브랜치를 `base_branch`로 가진 PR 스냅숏의 번호.
   * 보통 0 또는 1개다. 둘 이상이면 매핑 충돌 후보이며 호출 측이 쓰지 않는다.
   */
  readonly pr_numbers: readonly number[];
}

interface ProjectionTargetRaw {
  readonly merge_seq: number;
  readonly commit_sha: string;
  readonly pull_request_number: number | null;
  readonly commit_snapshot_exists: boolean;
  readonly commit_projected: boolean;
  readonly pr_numbers: readonly (number | null)[] | null;
}

function toRow(raw: ProjectionTargetRaw): ProjectionTargetRow {
  return {
    merge_seq: Number(raw.merge_seq),
    commit_sha: raw.commit_sha,
    pull_request_number: raw.pull_request_number,
    commit_snapshot_exists: raw.commit_snapshot_exists,
    commit_projected: raw.commit_projected,
    pr_numbers: (raw.pr_numbers ?? []).filter((one): one is number => typeof one === 'number'),
  };
}

const TARGET_SELECT = `
  SELECT ms.merge_seq, ms.commit_sha, ms.pull_request_number,
         (cs.commit_sha IS NOT NULL)   AS commit_snapshot_exists,
         (cs.projected_at IS NOT NULL) AS commit_projected,
         prs.pr_numbers
    FROM merge_sequence ms
    LEFT JOIN commit_snapshot cs
      ON cs.repository_id = ms.repository_id AND cs.commit_sha = ms.commit_sha
    LEFT JOIN LATERAL (
      SELECT array_agg(ps.pr_number ORDER BY ps.pr_number) AS pr_numbers
        FROM pull_request_snapshot ps
       WHERE ps.repository_id = ms.repository_id
         AND ps.document ->> 'merge_commit_sha' = ms.commit_sha
         AND ps.document ->> 'base_branch' = ms.base_branch
    ) prs ON true`;

/**
 * 한 공간·에폭의 대상을 서수 순으로 한 페이지 읽는다. 커서는 `merge_seq`다 — 서수는 불변이라
 * 스캔 도중 행이 더해져도 자리가 바뀌지 않는다.
 */
export async function listProjectionTargetsAfter(
  db: Queryable,
  input: {
    readonly repositoryId: number;
    readonly baseBranch: string;
    readonly seqEpoch: number;
    readonly afterSeq: number;
    readonly limit: number;
  },
): Promise<ProjectionTargetRow[]> {
  const result = await db.query<ProjectionTargetRaw>(
    `${TARGET_SELECT}
   WHERE ms.repository_id = $1 AND ms.base_branch = $2 AND ms.seq_epoch = $3 AND ms.merge_seq > $4
   ORDER BY ms.merge_seq
   LIMIT $5`,
    [input.repositoryId, input.baseBranch, input.seqEpoch, input.afterSeq, input.limit],
  );
  return result.rows.map(toRow);
}

/** 서수 구간 `(from, to]`의 대상. 채번 직후 인라인 투영이 새 구간만 읽을 때 쓴다. */
export async function listProjectionTargetsInRange(
  db: Queryable,
  input: {
    readonly repositoryId: number;
    readonly baseBranch: string;
    readonly seqEpoch: number;
    readonly fromExclusive: number;
    readonly toInclusive: number;
  },
): Promise<ProjectionTargetRow[]> {
  const result = await db.query<ProjectionTargetRaw>(
    `${TARGET_SELECT}
   WHERE ms.repository_id = $1 AND ms.base_branch = $2 AND ms.seq_epoch = $3
     AND ms.merge_seq > $4 AND ms.merge_seq <= $5
   ORDER BY ms.merge_seq`,
    [input.repositoryId, input.baseBranch, input.seqEpoch, input.fromExclusive, input.toInclusive],
  );
  return result.rows.map(toRow);
}

/** SHA 하나의 대상. 그 SHA가 이 공간·에폭의 체인에 없으면 `undefined`. */
export async function findProjectionTargetBySha(
  db: Queryable,
  input: { readonly repositoryId: number; readonly baseBranch: string; readonly seqEpoch: number; readonly commitSha: string },
): Promise<ProjectionTargetRow | undefined> {
  const result = await db.query<ProjectionTargetRaw>(
    `${TARGET_SELECT}
   WHERE ms.repository_id = $1 AND ms.base_branch = $2 AND ms.seq_epoch = $3 AND ms.commit_sha = $4`,
    [input.repositoryId, input.baseBranch, input.seqEpoch, input.commitSha.toLowerCase()],
  );
  const row = result.rows[0];
  return row === undefined ? undefined : toRow(row);
}

/** PR 스냅숏이 말하는 머지 커밋·base 브랜치. 문서 단위 work가 "아직 대상인가"를 여기서 다시 묻는다. */
export interface PullRequestMergeFacts {
  readonly prNumber: number;
  readonly mergeCommitSha: string | null;
  readonly baseBranch: string | null;
  readonly merged: boolean;
}

export async function findPullRequestMergeFacts(
  db: Queryable,
  repositoryId: number,
  prNumber: number,
): Promise<PullRequestMergeFacts | undefined> {
  const result = await db.query<{ merge_commit_sha: string | null; base_branch: string | null; state: string | null }>(
    `SELECT document ->> 'merge_commit_sha' AS merge_commit_sha,
            document ->> 'base_branch'      AS base_branch,
            document ->> 'state'            AS state
       FROM pull_request_snapshot
      WHERE repository_id = $1 AND pr_number = $2`,
    [repositoryId, prNumber],
  );
  const row = result.rows[0];
  if (row === undefined) return undefined;
  return {
    prNumber,
    mergeCommitSha: row.merge_commit_sha === null || row.merge_commit_sha === '' ? null : row.merge_commit_sha.toLowerCase(),
    baseBranch: row.base_branch === null || row.base_branch === '' ? null : row.base_branch,
    merged: row.state === 'merged',
  };
}

/**
 * `(브랜치, SHA)` 쌍 중 **그 브랜치의 현재 에폭 체인에 실제로 있는** 것.
 *
 * 커밋 문서는 SHA당 하나라(`commitDocId`), 문서가 단 `base_branch`가 다른 공간의 것이면
 * 그 공간이 지금도 이 SHA를 갖고 있는지 정본에 묻는다 — 갖고 있으면 그쪽 서수를 지키고,
 * 없으면(재작성으로 체인에서 빠졌거나 채번 대상에서 빠진 브랜치) 이 공간이 문서를 가져간다.
 */
export async function listSpacesHoldingCommits(
  db: Queryable,
  repositoryId: number,
  pairs: readonly { readonly baseBranch: string; readonly commitSha: string }[],
): Promise<Set<string>> {
  if (pairs.length === 0) return new Set();
  const result = await db.query<{ base_branch: string; commit_sha: string }>(
    `SELECT ms.base_branch, ms.commit_sha
       FROM merge_sequence ms
       JOIN sequence_space s
         ON s.repository_id = ms.repository_id AND s.base_branch = ms.base_branch AND s.seq_epoch = ms.seq_epoch
       JOIN unnest($2::text[], $3::text[]) AS p(base_branch, commit_sha)
         ON p.base_branch = ms.base_branch AND p.commit_sha = ms.commit_sha
      WHERE ms.repository_id = $1`,
    [repositoryId, pairs.map((one) => one.baseBranch), pairs.map((one) => one.commitSha.toLowerCase())],
  );
  return new Set(result.rows.map((row) => `${row.base_branch}\n${row.commit_sha}`));
}

/** `listSpacesHoldingCommits`가 돌려준 집합의 키. */
export function spaceCommitKey(baseBranch: string, commitSha: string): string {
  return `${baseBranch}\n${commitSha.toLowerCase()}`;
}
