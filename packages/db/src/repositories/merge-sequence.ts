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

/**
 * 공간·에폭 안에서 커밋의 서수를 찾는다 (WP-022 / CR-026, DEV-124).
 *
 * `findByCommitSha`와 달리 브랜치·에폭까지 좁힌다 — 재채번의 merge-base
 * 판정은 "**이 에폭의 이 체인**에서 그 커밋이 몇 번인가"를 물어야 하고,
 * 저장소 전체에서 찾으면 다른 브랜치의 같은 커밋이 걸린다.
 *
 * @returns 체인에 없으면 `null`. merge-base가 first-parent 체인 밖(피처
 * 브랜치 안) 커밋이면 정상적으로 이 값이 나온다 (DEV-125).
 */
export async function findSeqByCommit(
  db: Queryable,
  repositoryId: number,
  baseBranch: string,
  seqEpoch: number,
  commitSha: string,
): Promise<number | null> {
  const result = await db.query<{ merge_seq: string }>(
    `SELECT merge_seq FROM merge_sequence
      WHERE repository_id = $1 AND base_branch = $2 AND seq_epoch = $3 AND commit_sha = $4`,
    [repositoryId, baseBranch, seqEpoch, commitSha],
  );
  const seq = result.rows[0]?.merge_seq;
  return seq === undefined ? null : Number(seq);
}

/**
 * 이전 에폭의 서수를 새 에폭으로 복사한다 (WP-022 / CR-026, DEV-124).
 *
 * merge-base까지의 구간은 히스토리가 바뀌지 않았으므로 **값이 그대로다**
 * (ADR-007: "그 구간은 값이 동일하므로 이전 에폭 인용 중 상당수가 여전히
 * 같은 커밋을 가리킨다"). 다시 걸어서 계산해도 같은 값이 나오지만, 복사가
 * 훨씬 싸고 `pull_request_number`처럼 **나중에 채워진 값**을 잃지 않는다 —
 * 재계산하면 그 열은 다시 null에서 시작한다.
 *
 * @returns 복사한 행 수.
 */
export async function copySequencesUpTo(
  db: Queryable,
  repositoryId: number,
  baseBranch: string,
  fromEpoch: number,
  toEpoch: number,
  uptoSeqInclusive: number,
): Promise<number> {
  const result = await db.query(
    `INSERT INTO merge_sequence
       (repository_id, base_branch, seq_epoch, merge_seq, commit_sha, pull_request_number, committed_at)
     SELECT repository_id, base_branch, $4, merge_seq, commit_sha, pull_request_number, committed_at
       FROM merge_sequence
      WHERE repository_id = $1 AND base_branch = $2 AND seq_epoch = $3 AND merge_seq <= $5
     ON CONFLICT (repository_id, base_branch, seq_epoch, merge_seq) DO NOTHING`,
    [repositoryId, baseBranch, fromEpoch, toEpoch, uptoSeqInclusive],
  );
  return result.rowCount ?? 0;
}

/** 어긋난 지점 이후의 이전 에폭 행 수. EVT-SEQ-002의 `affected_count`다. */
export async function countAbove(
  db: Queryable,
  repositoryId: number,
  baseBranch: string,
  seqEpoch: number,
  aboveSeqExclusive: number,
): Promise<number> {
  const result = await db.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM merge_sequence
      WHERE repository_id = $1 AND base_branch = $2 AND seq_epoch = $3 AND merge_seq > $4`,
    [repositoryId, baseBranch, seqEpoch, aboveSeqExclusive],
  );
  return Number(result.rows[0]?.count ?? 0);
}

/**
 * 반개구간의 정확한 건수 (WP-023 / FR-SEQ-002 AC-4, CR-027 DEV-140).
 *
 * API 계약은 이 값을 `estimated_count`로 싣지만 **추정이 아니다.** 서수의 정본이
 * 이 표이므로 `count(*)`가 기본 키 범위 스캔 한 번이고, 추정할 이유가 없다.
 * 추정으로 두면 5만 건 상한 근처에서 통과와 거절이 실행마다 흔들린다.
 */
export async function countRange(
  db: Queryable,
  repositoryId: number,
  baseBranch: string,
  seqEpoch: number,
  fromExclusive: number,
  toInclusive: number,
): Promise<number> {
  const result = await db.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM merge_sequence
      WHERE repository_id = $1 AND base_branch = $2 AND seq_epoch = $3
        AND merge_seq > $4 AND merge_seq <= $5`,
    [repositoryId, baseBranch, seqEpoch, fromExclusive, toInclusive],
  );
  return Number(result.rows[0]?.count ?? 0);
}

/**
 * 반개구간의 한 쪽 (WP-023 / FR-SEQ-002).
 *
 * `findRange`와 달리 상한을 받는다. 구간은 5만 건까지 허용되지만 한 응답에
 * 담는 것은 `size`(최대 200)뿐이므로, 표시할 것보다 많이 읽지 않는다.
 *
 * **정렬은 오름차순 고정이다.** FR-SEQ-002가 그렇게 요구하고, 이 순서가 곧
 * `git log --first-parent --reverse`의 순서다 — 대조 검증이 성립하는 근거다.
 */
export async function findRangePage(
  db: Queryable,
  repositoryId: number,
  baseBranch: string,
  seqEpoch: number,
  fromExclusive: number,
  toInclusive: number,
  limit: number,
): Promise<MergeSequenceRow[]> {
  const result = await db.query<MergeSequenceRow>(
    `SELECT * FROM merge_sequence
      WHERE repository_id = $1 AND base_branch = $2 AND seq_epoch = $3
        AND merge_seq > $4 AND merge_seq <= $5
      ORDER BY merge_seq
      LIMIT $6`,
    [repositoryId, baseBranch, seqEpoch, fromExclusive, toInclusive, limit],
  );
  return result.rows;
}

/** 앵커 해석이 찾는 한 지점. 서수와 그 서수가 가리키는 커밋을 함께 준다 (FR-SEQ-003 AC-5). */
export interface SequencePoint {
  readonly mergeSeq: number;
  readonly commitSha: string;
  readonly pullRequestNumber: number | null;
  readonly committedAt: Date;
}

function toPoint(row: MergeSequenceRow): SequencePoint {
  return {
    mergeSeq: Number(row.merge_seq),
    commitSha: row.commit_sha,
    pullRequestNumber: row.pull_request_number,
    committedAt: row.committed_at,
  };
}

/**
 * 40자 SHA 앵커 (FR-SEQ-003 AC-2).
 *
 * `findSeqByCommit`이 서수만 주는 것과 달리 커밋 시각까지 준다 — AC-5가 응답에
 * 요구하는 값이라, 서수를 받은 뒤 다시 조회하면 왕복이 둘이 된다.
 *
 * `merge_sequence_commit_uk`가 `(저장소, 브랜치, 에폭, SHA)`에 유일하므로 결과는
 * 0건 아니면 1건이다.
 */
export async function findPointByCommit(
  db: Queryable,
  repositoryId: number,
  baseBranch: string,
  seqEpoch: number,
  commitSha: string,
): Promise<SequencePoint | null> {
  const result = await db.query<MergeSequenceRow>(
    `SELECT * FROM merge_sequence
      WHERE repository_id = $1 AND base_branch = $2 AND seq_epoch = $3 AND commit_sha = $4`,
    [repositoryId, baseBranch, seqEpoch, commitSha.toLowerCase()],
  );
  const row = result.rows[0];
  return row === undefined ? null : toPoint(row);
}

/** 서수 앵커. 값이 이미 서수이므로 하는 일은 **실재 확인**뿐이다 (FR-SEQ-003). */
export async function findPointBySeq(
  db: Queryable,
  repositoryId: number,
  baseBranch: string,
  seqEpoch: number,
  mergeSeq: number,
): Promise<SequencePoint | null> {
  const result = await db.query<MergeSequenceRow>(
    `SELECT * FROM merge_sequence
      WHERE repository_id = $1 AND base_branch = $2 AND seq_epoch = $3 AND merge_seq = $4`,
    [repositoryId, baseBranch, seqEpoch, mergeSeq],
  );
  const row = result.rows[0];
  return row === undefined ? null : toPoint(row);
}

/**
 * PR 번호 앵커 (FR-SEQ-003 AC-3).
 *
 * 이 표에 행이 있다는 것은 **그 PR의 머지 커밋이 first-parent 체인에 있다**는
 * 뜻이다 — 채번이 그 체인만 걷기 때문이다. 그래서 없으면 "미머지이거나 이
 * 브랜치가 아니다"이고, 어느 쪽인지는 호출 측이 PR 문서를 보고 가른다.
 */
export async function findPointByPullRequest(
  db: Queryable,
  repositoryId: number,
  baseBranch: string,
  seqEpoch: number,
  pullRequestNumber: number,
): Promise<SequencePoint | null> {
  const result = await db.query<MergeSequenceRow>(
    `SELECT * FROM merge_sequence
      WHERE repository_id = $1 AND base_branch = $2 AND seq_epoch = $3 AND pull_request_number = $4
      ORDER BY merge_seq
      LIMIT 1`,
    [repositoryId, baseBranch, seqEpoch, pullRequestNumber],
  );
  const row = result.rows[0];
  return row === undefined ? null : toPoint(row);
}

/**
 * 축약 SHA 앵커의 후보 (FR-SEQ-003 AC-2, ADR-012).
 *
 * **후보를 세어서 돌려주는 이유**는 앵커가 하나여야 하기 때문이다. 접두가 두
 * 커밋에 걸리는데 하나를 골라 주면 사용자는 자기가 뜻하지 않은 구간을 보고도
 * 그 사실을 모른다. 2건까지만 읽어 "하나인가 아닌가"만 가른다 — 전부 세는 것은
 * 답을 바꾸지 않으면서 비용만 는다.
 */
export async function findPointsByCommitPrefix(
  db: Queryable,
  repositoryId: number,
  baseBranch: string,
  seqEpoch: number,
  prefix: string,
): Promise<SequencePoint[]> {
  const result = await db.query<MergeSequenceRow>(
    `SELECT * FROM merge_sequence
      WHERE repository_id = $1 AND base_branch = $2 AND seq_epoch = $3
        AND commit_sha LIKE $4 || '%'
      ORDER BY merge_seq
      LIMIT 2`,
    [repositoryId, baseBranch, seqEpoch, prefix.toLowerCase()],
  );
  return result.rows.map(toPoint);
}

/**
 * 시각 앵커 (FR-SEQ-003 AC-4): "그 시각 이전 마지막 커밋".
 *
 * **`committed_at` 최대가 아니라 `merge_seq` 최대다.** 두 값은 대개 같은 순서지만
 * 항상 그렇지는 않다 — 오래된 브랜치를 나중에 머지하면 커밋 시각이 앞선 커밋이
 * 뒤 서수를 받는다. 구간은 서수로 정의되므로 **시각으로 거르고 서수로 고른다.**
 */
export async function findPointAtOrBefore(
  db: Queryable,
  repositoryId: number,
  baseBranch: string,
  seqEpoch: number,
  instant: Date,
): Promise<SequencePoint | null> {
  const result = await db.query<MergeSequenceRow>(
    `SELECT * FROM merge_sequence
      WHERE repository_id = $1 AND base_branch = $2 AND seq_epoch = $3
        AND committed_at <= $4
      ORDER BY merge_seq DESC
      LIMIT 1`,
    [repositoryId, baseBranch, seqEpoch, instant],
  );
  const row = result.rows[0];
  return row === undefined ? null : toPoint(row);
}

/**
 * 구간에 든 PR 번호 (WP-023 / FR-SEQ-002).
 *
 * **행 전체가 아니라 번호만 읽는 이유**는 구간이 5만 건까지 허용되기 때문이다.
 * 행을 통째로 올리면 SHA와 시각까지 5만 벌이 메모리에 들어오는데, 요약이 쓰는
 * 것은 번호뿐이다 — 색인 질의의 `terms`에 실을 목록이 이것이다.
 *
 * 정렬을 걸지 않는다. `terms` 질의는 순서를 보지 않고, 목록의 순서는 페이지를
 * 읽는 `findRangePage`가 정한다.
 */
export async function listPullRequestNumbersInRange(
  db: Queryable,
  repositoryId: number,
  baseBranch: string,
  seqEpoch: number,
  fromExclusive: number,
  toInclusive: number,
): Promise<number[]> {
  const result = await db.query<{ pull_request_number: number }>(
    `SELECT DISTINCT pull_request_number FROM merge_sequence
      WHERE repository_id = $1 AND base_branch = $2 AND seq_epoch = $3
        AND merge_seq > $4 AND merge_seq <= $5
        AND pull_request_number IS NOT NULL`,
    [repositoryId, baseBranch, seqEpoch, fromExclusive, toInclusive],
  );
  return result.rows.map((row) => row.pull_request_number);
}

/**
 * 서수 초과 구간의 PR 수 (WP-024 / FR-REL-002 AC-4).
 *
 * "대상 브랜치 head까지 대기 중인 PR 수" — 마지막 릴리스 서수보다 큰 서수를
 * 받은 **PR**의 수다. `countAbove`와 달리 직접 푸시 커밋(`pull_request_number
 * IS NULL`)은 세지 않는다: AC-4가 세라는 것은 커밋이 아니라 PR이다.
 */
export async function countPullRequestsAbove(
  db: Queryable,
  repositoryId: number,
  baseBranch: string,
  seqEpoch: number,
  aboveSeqExclusive: number,
): Promise<number> {
  const result = await db.query<{ count: string }>(
    `SELECT count(DISTINCT pull_request_number)::text AS count FROM merge_sequence
      WHERE repository_id = $1 AND base_branch = $2 AND seq_epoch = $3
        AND merge_seq > $4 AND pull_request_number IS NOT NULL`,
    [repositoryId, baseBranch, seqEpoch, aboveSeqExclusive],
  );
  return Number(result.rows[0]?.count ?? 0);
}

/**
 * 기준 서수의 앞뒤 이웃 (WP-027 / FR-REL-001, CR-031).
 *
 * ## 왜 정본에서 고르는가
 *
 * 이웃을 색인에서 `range(merge_seq)`로 고르면 **색인 반영이 늦은 항목이 오류 없이
 * 빠지고**, 그 자리에 더 먼 항목이 올라와 "인접"이 거짓이 된다 (CR-031, DEV-166 —
 * 범위 조회가 정본을 읽는 것과 같은 이유, DEV-130). 여기서 앞뒤를 고른 뒤 표시값만
 * 색인에서 채운다.
 *
 * ## 직접 푸시 커밋을 거르지 않는다
 *
 * `pull_request_number IS NULL`인 행도 이웃이다 (CR-031, DEV-161 / FR-REL-001 AC-2).
 * 빼면 목록의 서수가 건너뛴 채 보여 사용자가 **누락으로 읽는다** — 이 제품이 지켜야
 * 하는 것은 "서수가 `git log --first-parent`와 대조된다"는 사실이다.
 *
 * @param count 한쪽당 건수. 반환은 최대 `2 * count + 1`행이며 **서수 오름차순**이다.
 * @returns 기준 서수의 행이 없으면 빈 배열 — 호출부가 그것을 먼저 확인한다.
 */
export async function findNeighbors(
  db: Queryable,
  repositoryId: number,
  baseBranch: string,
  seqEpoch: number,
  anchorSeq: number,
  count: number,
): Promise<MergeSequenceRow[]> {
  const result = await db.query<MergeSequenceRow>(
    `WITH before AS (
       SELECT * FROM merge_sequence
        WHERE repository_id = $1 AND base_branch = $2 AND seq_epoch = $3 AND merge_seq < $4
        ORDER BY merge_seq DESC
        LIMIT $5
     ),
     anchor AS (
       SELECT * FROM merge_sequence
        WHERE repository_id = $1 AND base_branch = $2 AND seq_epoch = $3 AND merge_seq = $4
     ),
     after AS (
       SELECT * FROM merge_sequence
        WHERE repository_id = $1 AND base_branch = $2 AND seq_epoch = $3 AND merge_seq > $4
        ORDER BY merge_seq ASC
        LIMIT $5
     )
     SELECT * FROM before
     UNION ALL SELECT * FROM anchor
     UNION ALL SELECT * FROM after
     ORDER BY merge_seq`,
    [repositoryId, baseBranch, seqEpoch, anchorSeq, count],
  );
  return result.rows;
}
