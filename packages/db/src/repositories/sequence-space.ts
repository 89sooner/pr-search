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
  /**
   * M 번호 진행 지점 (WP-074 / FR-SEQ-008 AC-3, 마이그레이션 025).
   *
   * `mnumber_head_seq`는 확인을 마친 마지막 서수, `mnumber_head`는 마지막으로 부여한
   * M 번호다. 둘 다 BIGINT이며 타입 파서가 숫자로 준다.
   */
  readonly mnumber_head_seq: number;
  readonly mnumber_head: number;
  /** checkpoint 다음의 미확정·충돌 행. 셋은 함께 있거나 함께 NULL이다. */
  readonly mnumber_blocked_seq: number | null;
  readonly mnumber_blocked_reason: string | null;
  readonly mnumber_blocked_since: Date | null;
}

/** M 채번 한 회차가 남기는 진행 지점. */
export interface MergeNumberCheckpoint {
  readonly headSeq: number;
  readonly headNumber: number;
  readonly blocked: { readonly seq: number; readonly reason: string } | null;
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

/**
 * 여러 저장소의 시퀀스 공간을 한 번에 읽는다 (API-SEQ-006, CR-029 DEV-152).
 *
 * C-027 셀렉터 목록이 쓴다 — 저장소마다 한 번씩 물으면 목록 크기만큼
 * 왕복이 늘어난다. 행이 없는 (저장소, 브랜치) 짝은 결과에 없다: 그 부재가
 * 곧 "채번된 적 없음"이고, 호출 측이 `unknown`으로 옮긴다.
 */
export async function listSpacesForRepositories(
  db: Queryable,
  repositoryIds: readonly number[],
): Promise<SequenceSpaceRow[]> {
  if (repositoryIds.length === 0) return [];
  const result = await db.query<SequenceSpaceRow>(
    'SELECT * FROM sequence_space WHERE repository_id = ANY($1) ORDER BY repository_id, base_branch',
    [repositoryIds],
  );
  return result.rows;
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
    /*
     * M checkpoint도 함께 0으로 돌린다 (WP-074 / ADR-007 규칙 5). 이전 에폭의 M 번호는
     * 그 에폭 행에 남아 무효로 해석되고, 새 에폭은 새 근거로 처음부터 다시 센다.
     * `sequence_space_mnumber_checkpoint_chk`가 `head_seq = 0`과 함께 이것을 요구한다.
     */
    `UPDATE sequence_space
        SET seq_epoch = seq_epoch + 1, head_seq = 0, head_sha = NULL, state = 'reassigning',
            mnumber_head_seq = 0, mnumber_head = 0,
            mnumber_blocked_seq = NULL, mnumber_blocked_reason = NULL, mnumber_blocked_since = NULL
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

/**
 * 시퀀스 공간을 `stale`로 두고 사유를 남긴다 (FR-SEQ-001 예외 처리).
 *
 * **`UPDATE`가 아니라 upsert다.** 채번의 첫 시도에서 그래프를 읽지 못하면
 * 공간을 만든 트랜잭션이 롤백되므로 갱신할 행이 없다 — `UPDATE`로 두면
 * 0행이 갱신되고, 그 저장소는 **`stale`로 표시되지도 경보가 울리지도
 * 않은 채** 조용히 아무 시퀀스도 갖지 못한다. 운영자가 볼 수 있는 신호가
 * 하나도 남지 않는 것이 이 실패의 가장 나쁜 점이다.
 *
 * 기존 시퀀스 값(`head_seq`, `head_sha`)은 건드리지 않는다. 읽지 못한 것과
 * 값이 틀린 것은 다르고, 지우면 그 사이 모든 범위 인용이 죽는다.
 */
export async function markStale(
  db: Queryable,
  repositoryId: number,
  baseBranch: string,
  reason: string,
): Promise<void> {
  await db.query(
    `INSERT INTO sequence_space (repository_id, base_branch, state, last_error)
     VALUES ($1, $2, 'stale', $3)
     ON CONFLICT (repository_id, base_branch) DO UPDATE
        SET state = 'stale', last_error = EXCLUDED.last_error`,
    [repositoryId, baseBranch, reason.slice(0, 500)],
  );
}

/**
 * 재채번이 시작됐음을 **본 트랜잭션 밖에서** 표시한다 (FR-SEQ-005 예외 처리).
 *
 * 재채번 본 작업은 트랜잭션 하나 안에서 끝나므로, 그 안에서 상태를 바꾸면
 * 커밋 전까지 아무도 `reassigning`을 보지 못한다 — "재채번 중 조회는 마지막
 * 확정 값과 `sequence_state: reassigning`을 함께 반환한다"가 성립하려면
 * 이 표시가 **먼저 따로 커밋**되어야 한다. 조회가 보는 서수는 여전히 이전
 * 값이다: 새 에폭 행은 본 트랜잭션이 커밋되기 전까지 보이지 않는다.
 */
export async function markReassigning(
  db: Queryable,
  repositoryId: number,
  baseBranch: string,
): Promise<void> {
  await db.query(
    `UPDATE sequence_space SET state = 'reassigning', last_error = NULL
      WHERE repository_id = $1 AND base_branch = $2`,
    [repositoryId, baseBranch],
  );
}

/**
 * `reassigning` 표시를 원래 상태로 되돌린다 (CR-037, DEV-198).
 *
 * 수동 복구는 재구축을 시작하기 전에 `markReassigning`을 **따로 커밋**해 밖에서
 * 보이게 만든다. 그런데 그 뒤 울타리에 걸려(락 실패·에폭 이동·head 이동) 아무것도
 * 하지 않고 끝날 수 있다. 그때 표시를 그대로 두면 **아무 일도 하지 않는 공간이
 * 영원히 "재채번 중"으로 광고된다.**
 *
 * **`state = 'reassigning'`일 때만 되돌린다.** 그 사이 다른 경로가 `stale`로
 * 옮겼다면 그것이 더 새로운 사실이고, 덮으면 진짜 실패가 지워진다.
 *
 * 서수 값(`head_sha`·`head_seq`·`seq_epoch`)은 건드리지 않는다 — 우리는 그것을
 * 바꾼 적이 없다.
 */
export async function restoreSequenceState(
  db: Queryable,
  repositoryId: number,
  baseBranch: string,
  state: string,
  lastError: string | null,
): Promise<void> {
  await db.query(
    `UPDATE sequence_space
        SET state = $3, last_error = $4
      WHERE repository_id = $1 AND base_branch = $2 AND state = 'reassigning'`,
    [repositoryId, baseBranch, state, lastError],
  );
}

/**
 * M 채번 진행 지점을 옮긴다 (WP-074 / FR-SEQ-008 AC-3, 상세 설계 7절).
 *
 * **에폭을 조건에 둔다.** 락을 잡고 읽은 에폭과 다르면 0행이며 호출 측은 롤백한다 —
 * 다른 에폭에서 계산한 checkpoint를 이 에폭에 쓰지 않는다.
 *
 * blocker가 같은 자리·같은 사유면 `mnumber_blocked_since`를 보존한다. 그래야
 * "얼마나 오래 막혀 있는가"가 회차마다 리셋되지 않는다. 해소되면 셋 다 NULL이다.
 *
 * @returns 갱신됐으면 `true`.
 */
export async function advanceMergeNumberCheckpoint(
  db: Queryable,
  repositoryId: number,
  baseBranch: string,
  seqEpoch: number,
  checkpoint: MergeNumberCheckpoint,
): Promise<boolean> {
  const blockedSeq = checkpoint.blocked?.seq ?? null;
  const blockedReason = checkpoint.blocked?.reason ?? null;
  const result = await db.query(
    `UPDATE sequence_space
        SET mnumber_head_seq       = $4,
            mnumber_head           = $5,
            mnumber_blocked_seq    = $6,
            mnumber_blocked_reason = $7,
            mnumber_blocked_since  = CASE
                                       WHEN $6::bigint IS NULL THEN NULL
                                       WHEN mnumber_blocked_seq = $6::bigint AND mnumber_blocked_reason = $7::text
                                         THEN mnumber_blocked_since
                                       ELSE clock_timestamp()
                                     END
      WHERE repository_id = $1 AND base_branch = $2 AND seq_epoch = $3`,
    [repositoryId, baseBranch, seqEpoch, checkpoint.headSeq, checkpoint.headNumber, blockedSeq, blockedReason],
  );
  return (result.rowCount ?? 0) > 0;
}

/**
 * 시퀀스 공간 여러 개를 한 번에 읽는다 — M 상태 batch 대조가 쓴다 (API 계약 8절).
 * `(repository_id, base_branch)` 짝 목록을 배열 둘로 받는다.
 */
export async function listSpacesByKeys(
  db: Queryable,
  keys: readonly { readonly repositoryId: number; readonly baseBranch: string }[],
): Promise<SequenceSpaceRow[]> {
  if (keys.length === 0) return [];
  const result = await db.query<SequenceSpaceRow>(
    `SELECT s.* FROM sequence_space s
       JOIN unnest($1::bigint[], $2::text[]) AS k(repository_id, base_branch)
         ON k.repository_id = s.repository_id AND k.base_branch = s.base_branch`,
    [keys.map((key) => key.repositoryId), keys.map((key) => key.baseBranch)],
  );
  return result.rows;
}
