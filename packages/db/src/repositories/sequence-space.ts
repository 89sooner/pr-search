/**
 * `sequence_space` 리포지터리 (ENT-SEQ-002, FR-SEQ-001·FR-SEQ-005).
 *
 * 시퀀스 공간은 `(repository_id, base_branch)` 단위다. 대상 브랜치 강제 푸시는
 * `seq_epoch`를 올려 과거 범위 인용을 조용히 바꾸지 않고 무효화한다 (ADR-007).
 */

import type { Pool, PoolClient } from 'pg';

export type SequenceSpaceState = 'ok' | 'stale' | 'reassigning' | 'unknown';

export interface SequenceSpaceRow {
  readonly repository_id: number;
  readonly base_branch: string;
  readonly seq_epoch: number;
  readonly head_sha: string | null;
  readonly head_seq: string;
  readonly state: SequenceSpaceState;
  readonly last_assigned_at: Date | null;
  readonly last_error: string | null;
}

type Queryable = Pool | PoolClient;

export async function ensureSequenceSpace(
  db: Queryable,
  repositoryId: number,
  baseBranch: string,
): Promise<void> {
  await db.query(
    `INSERT INTO sequence_space (repository_id, base_branch)
     VALUES ($1, $2)
     ON CONFLICT (repository_id, base_branch) DO NOTHING`,
    [repositoryId, baseBranch],
  );
}

export async function findSequenceSpace(
  db: Queryable,
  repositoryId: number,
  baseBranch: string,
): Promise<SequenceSpaceRow | undefined> {
  const result = await db.query<SequenceSpaceRow>(
    'SELECT * FROM sequence_space WHERE repository_id = $1 AND base_branch = $2',
    [repositoryId, baseBranch],
  );
  return result.rows[0];
}

/** 채번 진행 상태를 갱신한다. */
export async function advanceHead(
  db: Queryable,
  repositoryId: number,
  baseBranch: string,
  headSha: string,
  headSeq: number,
): Promise<void> {
  await db.query(
    `UPDATE sequence_space
        SET head_sha = $3, head_seq = $4, last_assigned_at = now(), state = 'ok', last_error = NULL
      WHERE repository_id = $1 AND base_branch = $2`,
    [repositoryId, baseBranch, headSha, headSeq],
  );
}

/**
 * 에폭을 올린다. 강제 푸시로 first-parent 체인이 재작성됐을 때 호출한다.
 *
 * @returns 새 에폭 값.
 */
export async function bumpEpoch(
  db: Queryable,
  repositoryId: number,
  baseBranch: string,
): Promise<number> {
  const result = await db.query<{ seq_epoch: number }>(
    `UPDATE sequence_space
        SET seq_epoch = seq_epoch + 1, head_seq = 0, head_sha = NULL, state = 'reassigning'
      WHERE repository_id = $1 AND base_branch = $2
      RETURNING seq_epoch`,
    [repositoryId, baseBranch],
  );

  const epoch = result.rows[0]?.seq_epoch;
  if (epoch === undefined) {
    throw new Error(`시퀀스 공간이 없다: ${String(repositoryId)}/${baseBranch}`);
  }
  return epoch;
}
