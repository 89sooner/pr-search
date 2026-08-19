/**
 * `merge_sequence` 리포지터리 (ENT-SEQ-001, FR-SEQ-001·FR-SEQ-002).
 *
 * 서수는 `git rev-list --first-parent --reverse` 순서를 그대로 옮긴 값이며 1부터
 * 시작한다. 이 값이 git과 대조 검증 가능하다는 점이 Perforce Changelist를 대체할
 * 수 있는 근거다 (ADR-007).
 */

import type { Pool, PoolClient } from 'pg';

export interface MergeSequenceInsert {
  readonly repository_id: number;
  readonly base_branch: string;
  readonly seq_epoch: number;
  readonly merge_seq: number;
  readonly commit_sha: string;
  readonly pull_request_number: number | null;
  readonly committed_at: Date;
}

export interface MergeSequenceRow extends Omit<MergeSequenceInsert, 'merge_seq'> {
  readonly merge_seq: string;
  readonly assigned_at: Date;
}

type Queryable = Pool | PoolClient;

/** 채번 결과를 기록한다. 재파생이 같은 값을 다시 써도 중복 행을 만들지 않는다. */
export async function insertMergeSequence(db: Queryable, entry: MergeSequenceInsert): Promise<void> {
  await db.query(
    `INSERT INTO merge_sequence
       (repository_id, base_branch, seq_epoch, merge_seq, commit_sha, pull_request_number, committed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (repository_id, base_branch, seq_epoch, merge_seq) DO NOTHING`,
    [
      entry.repository_id,
      entry.base_branch,
      entry.seq_epoch,
      entry.merge_seq,
      entry.commit_sha,
      entry.pull_request_number,
      entry.committed_at,
    ],
  );
}

/**
 * 반개구간 `(from, to]` 조회. `git log from..to`와 같은 의미다.
 *
 * 경계 처리를 여기서 한 번만 정해 두는 이유는, 범위 인용이 제품의 핵심 산출물이라
 * 호출 지점마다 다른 경계를 쓰면 조사 결과가 서로 어긋나기 때문이다.
 */
export async function findRange(
  db: Queryable,
  repositoryId: number,
  baseBranch: string,
  seqEpoch: number,
  fromExclusive: number,
  toInclusive: number,
): Promise<MergeSequenceRow[]> {
  const result = await db.query<MergeSequenceRow>(
    `SELECT * FROM merge_sequence
      WHERE repository_id = $1 AND base_branch = $2 AND seq_epoch = $3
        AND merge_seq > $4 AND merge_seq <= $5
      ORDER BY merge_seq`,
    [repositoryId, baseBranch, seqEpoch, fromExclusive, toInclusive],
  );
  return result.rows;
}

export async function findByCommitSha(
  db: Queryable,
  repositoryId: number,
  commitSha: string,
): Promise<MergeSequenceRow[]> {
  const result = await db.query<MergeSequenceRow>(
    'SELECT * FROM merge_sequence WHERE repository_id = $1 AND commit_sha = $2',
    [repositoryId, commitSha],
  );
  return result.rows;
}

export async function findByPullRequest(
  db: Queryable,
  repositoryId: number,
  pullRequestNumber: number,
): Promise<MergeSequenceRow[]> {
  const result = await db.query<MergeSequenceRow>(
    'SELECT * FROM merge_sequence WHERE repository_id = $1 AND pull_request_number = $2',
    [repositoryId, pullRequestNumber],
  );
  return result.rows;
}
