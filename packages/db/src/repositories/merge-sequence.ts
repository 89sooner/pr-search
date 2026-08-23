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

/**
 * 채번 결과를 기록한다 (FR-SEQ-001 AC-4, CR-025 DEV-118).
 *
 * ## 무엇이 멱등하고 무엇이 채워지는가
 *
 * **서수와 커밋의 대응은 절대 바뀌지 않는다.** AC-4가 요구하는 멱등이 그것이고,
 * 그 값이 흔들리면 이 제품의 모든 범위 인용이 흔들린다.
 *
 * 반면 `pull_request_number`는 **나중에 알게 될 수 있다.** push 이벤트가 그 PR의
 * 투영보다 먼저 도착하면 채번 시점에는 대응하는 PR을 모르므로 `null`이 된다.
 * 그래서 `COALESCE(기존, 신규)`를 쓴다 — 아직 모르는 값은 나중에 채워지고,
 * **이미 아는 값은 `null`로 덮이지 않는다.** 순서를 반대로 두면 늦게 도착한
 * 재채번이 알던 PR 연결을 지운다.
 *
 * ## 같은 서수에 다른 커밋이 오면 던진다
 *
 * 그것은 경합이 아니라 손상이다. `ON CONFLICT ... DO UPDATE ... WHERE`로 조용히
 * 넘기면 서수 하나가 두 커밋을 가리키는 상태가 아무 신호 없이 남는다. `WHERE`가
 * 막아 갱신된 행이 0이면 그 사실을 그대로 던진다.
 *
 * @throws 같은 `(저장소, 브랜치, 에폭, 서수)`에 **다른 커밋**이 이미 있으면.
 */
export async function upsertMergeSequence(db: Queryable, entry: MergeSequenceInsert): Promise<void> {
  const result = await db.query(
    `INSERT INTO merge_sequence
       (repository_id, base_branch, seq_epoch, merge_seq, commit_sha, pull_request_number, committed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (repository_id, base_branch, seq_epoch, merge_seq) DO UPDATE
        SET pull_request_number = COALESCE(merge_sequence.pull_request_number, EXCLUDED.pull_request_number)
      WHERE merge_sequence.commit_sha = EXCLUDED.commit_sha`,
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

  if (result.rowCount === 0) {
    throw new Error(
      `시퀀스 ${String(entry.merge_seq)}에 다른 커밋이 이미 있다: ` +
        `${String(entry.repository_id)}/${entry.base_branch}@${String(entry.seq_epoch)} != ${entry.commit_sha}`,
    );
  }
}

/** @deprecated `upsertMergeSequence`를 쓴다. 이름만 남긴 별칭이다. */
export const insertMergeSequence = upsertMergeSequence;

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
