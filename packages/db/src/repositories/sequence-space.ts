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

/**
 * 상태별 시퀀스 공간 수 (WP-021, 관측 문서 RB-10).
 *
 * **게이지는 "지금 몇 개가 그 상태인가"여야 한다.** 채번할 때마다 1을 써 넣으면
 * 한 번 `stale`이 된 공간이 복구된 뒤에도 그 라벨이 1로 남아 경보가 영원히
 * 울린다. 그래서 매번 세어서 통째로 바꾼다 — 사라진 상태의 라벨도 함께 사라진다.
 */
export async function countByState(db: Queryable): Promise<Readonly<Record<string, number>>> {
  const result = await db.query<{ state: string; count: string }>(
    'SELECT state, count(*)::text AS count FROM sequence_space GROUP BY state',
  );
  const counts: Record<string, number> = {};
  for (const row of result.rows) counts[row.state] = Number(row.count);
  return counts;
}

/** 시퀀스 공간을 `stale`로 두고 사유를 남긴다. 기존 시퀀스 값은 건드리지 않는다 (FR-SEQ-001 예외 처리). */
export async function markStale(
  db: Queryable,
  repositoryId: number,
  baseBranch: string,
  reason: string,
): Promise<void> {
  await db.query(
    `UPDATE sequence_space SET state = 'stale', last_error = $3
      WHERE repository_id = $1 AND base_branch = $2`,
    [repositoryId, baseBranch, reason.slice(0, 500)],
  );
}
