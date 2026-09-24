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
  /**
   * M 번호 (WP-074 / FR-SEQ-008, 마이그레이션 025). PR 항목만 갖고 직접 푸시는 NULL이다.
   * BIGINT이지만 상한이 safe integer라 타입 파서가 숫자로 준다.
   */
  readonly merge_number: number | null;
  /** WP-075 예약. WP-074에서는 언제나 NULL이다. */
  readonly annotate_state: 'done' | 'mismatch' | 'failed' | 'disabled' | 'body_changed' | 'unknown' | null;
  readonly annotated_at: Date | null;
  readonly mnumber_assigned_at: Date | null;
  /**
   * 원격 lightweight 태그 결과 (WP-100 / FR-SEQ-012, 마이그레이션 035). NULL은 아직 시도하지
   * 않은 행이다. `conflict`는 같은 이름의 태그가 **다른 것**을 가리켜 손대지 않은 것이며
   * `tag_found_sha`가 그 근거다.
   */
  readonly tag_state: TagState | null;
  readonly tagged_at: Date | null;
  readonly tag_attempt_id: string | null;
  readonly tag_result_reason: string | null;
  readonly tag_found_sha: string | null;
}

/** `merge_sequence.tag_state`의 값 (035의 CHECK와 같다). */
export type TagState = 'done' | 'conflict' | 'failed' | 'disabled' | 'unknown';

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

/**
 * 주어진 커밋 가운데 **추적 브랜치의 현재 체인**에 있는 것과, 그 커밋을 체인에 올린 PR
 * (CR-117 / FR-SRCH-002 AC-7).
 *
 * 관계 술어(`EFFECTIVE_LINK_SQL`)와 **같은 체인 정의**다 — 저장소가 지금 추적하는 브랜치
 * (`repository.sequence_branches`)의 현재 에폭만 본다. 투영이 체인 커밋에 원본 커밋 문서를
 * 쓰지 않으려고, 복구가 덮인 역할을 되돌리려고 읽는다. 값 배열의 `null`은 「직접 푸시이거나
 * 아직 모름」이다 — 둘을 여기서 가르지 않는다.
 *
 * @returns 체인에 있는 SHA만 키로 갖는다. 없는 SHA는 체인 밖이다.
 */
export async function findCurrentChainLanders(
  db: Queryable,
  repositoryId: number,
  commitShas: readonly string[],
): Promise<ReadonlyMap<string, readonly (number | null)[]>> {
  const shas = [...new Set(commitShas.map((sha) => sha.toLowerCase()))];
  const out = new Map<string, (number | null)[]>();
  if (shas.length === 0) return out;
  const result = await db.query<{ commit_sha: string; pull_request_number: number | null }>(
    `SELECT ms.commit_sha, ms.pull_request_number
       FROM repository r
       JOIN sequence_space ss
         ON ss.repository_id = r.repository_id AND ss.base_branch = ANY (r.sequence_branches)
       JOIN merge_sequence ms
         ON ms.repository_id = ss.repository_id AND ms.base_branch = ss.base_branch AND ms.seq_epoch = ss.seq_epoch
      WHERE r.repository_id = $1 AND ms.commit_sha = ANY($2::text[])`,
    [repositoryId, shas],
  );
  for (const row of result.rows) {
    const key = row.commit_sha.toLowerCase();
    const list = out.get(key) ?? [];
    list.push(row.pull_request_number);
    out.set(key, list);
  }
  return out;
}

/**
 * 두 에폭 사이에 체인 소속이나 PR 대응이 바뀐 커밋 (CR-117 / FR-SRCH-002 AC-7).
 *
 * `(commit_sha, pull_request_number)` 쌍의 **대칭차**다. 옛 에폭에만 있으면 체인에서 빠진 것이고,
 * 새 에폭에만 있으면 새로 오른 것이며, 양쪽에 있어도 PR 대응이 다르면 바뀐 것이다. 재채번은
 * 공통 조상까지를 복사하므로 그 구간은 여기 나타나지 않는다 — 다시 비출 필요가 없다.
 * `EXCEPT`는 `NULL`을 같은 값으로 비교하므로 「대응 모름」끼리는 같다고 본다.
 */
export async function listChangedCommitsBetweenEpochs(
  db: Queryable,
  repositoryId: number,
  baseBranch: string,
  oldEpoch: number,
  newEpoch: number,
): Promise<string[]> {
  const result = await db.query<{ commit_sha: string }>(
    `WITH old_rows AS (
       SELECT commit_sha, pull_request_number FROM merge_sequence
        WHERE repository_id = $1 AND base_branch = $2 AND seq_epoch = $3
     ), new_rows AS (
       SELECT commit_sha, pull_request_number FROM merge_sequence
        WHERE repository_id = $1 AND base_branch = $2 AND seq_epoch = $4
     )
     SELECT DISTINCT commit_sha FROM (
       (SELECT * FROM old_rows EXCEPT SELECT * FROM new_rows)
       UNION ALL
       (SELECT * FROM new_rows EXCEPT SELECT * FROM old_rows)
     ) AS changed`,
    [repositoryId, baseBranch, oldEpoch, newEpoch],
  );
  return result.rows.map((row) => row.commit_sha.toLowerCase());
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

/* ------------------------------------------------------------------------- */
/* M 번호 (WP-074 / FR-SEQ-008, CR-077 · CR-079, ADR-023)                       */
/* ------------------------------------------------------------------------- */

/** 채번 후보 행. checkpoint 다음부터 서수 오름차순이며 근거는 호출 측이 따로 읽는다. */
export interface MergeNumberCandidateRow {
  readonly merge_seq: number;
  readonly commit_sha: string;
  readonly pull_request_number: number | null;
  readonly merge_number: number | null;
  readonly committed_at: Date;
}

/**
 * checkpoint 다음의 행들 (상세 설계 7절의 batch 입력).
 *
 * **정렬은 서수 오름차순 고정**이고 호출 측은 첫 행이 `afterSeq + 1`인지 확인한다 —
 * 구멍이 있으면 정본이 손상된 것이며 정렬로 숨기지 않는다.
 */
export async function listCandidatesAfter(
  db: Queryable,
  repositoryId: number,
  baseBranch: string,
  seqEpoch: number,
  afterSeq: number,
  limit: number,
): Promise<MergeNumberCandidateRow[]> {
  const result = await db.query<MergeNumberCandidateRow>(
    `SELECT merge_seq::bigint AS merge_seq, commit_sha, pull_request_number, merge_number, committed_at
       FROM merge_sequence
      WHERE repository_id = $1 AND base_branch = $2 AND seq_epoch = $3 AND merge_seq > $4
      ORDER BY merge_seq
      LIMIT $5`,
    [repositoryId, baseBranch, seqEpoch, afterSeq, limit],
  );
  return result.rows.map((row) => ({ ...row, merge_seq: Number(row.merge_seq) }));
}

export interface MergeNumberAssignment {
  readonly mergeSeq: number;
  readonly prNumber: number;
  readonly mergeNumber: number;
}

/**
 * 번호를 쓴다 (AC-1 · AC-3). **조건이 곧 불변식이다**:
 *
 * - 같은 서수에 같은 PR이 있어야 하고 (`pull_request_number = $pr`),
 * - 번호가 아직 없거나 **같은 번호**여야 한다 (멱등 재실행).
 *
 * 하나라도 어긋나면 갱신 행 수가 부족하고 호출 측은 트랜잭션을 롤백한다. 이미
 * 부여된 다른 번호를 덮는 UPDATE는 이 함수로 만들 수 없다.
 *
 * `pull_request_number`가 아직 NULL인 행(채번이 PR을 늦게 알게 된 경우)은 확정
 * 근거의 PR로 **함께 채운다** — 근거가 정본이고 그 값이 곧 사실이다. 다른 non-null
 * PR이 이미 있으면 COALESCE로 숨기지 않고 조건 불일치(0행)로 드러난다.
 *
 * @returns 갱신된 행 수. 입력 수와 같아야 한다.
 */
export async function assignMergeNumbers(
  db: Queryable,
  repositoryId: number,
  baseBranch: string,
  seqEpoch: number,
  assignments: readonly MergeNumberAssignment[],
): Promise<number> {
  if (assignments.length === 0) return 0;
  const result = await db.query(
    `UPDATE merge_sequence AS ms
        SET merge_number        = a.merge_number,
            pull_request_number = a.pr_number,
            mnumber_assigned_at = COALESCE(ms.mnumber_assigned_at, clock_timestamp())
       FROM unnest($4::bigint[], $5::int[], $6::bigint[]) AS a(merge_seq, pr_number, merge_number)
      WHERE ms.repository_id = $1 AND ms.base_branch = $2 AND ms.seq_epoch = $3
        AND ms.merge_seq = a.merge_seq
        AND (ms.pull_request_number IS NULL OR ms.pull_request_number = a.pr_number)
        AND (ms.merge_number IS NULL OR ms.merge_number = a.merge_number)`,
    [
      repositoryId,
      baseBranch,
      seqEpoch,
      assignments.map((one) => one.mergeSeq),
      assignments.map((one) => one.prNumber),
      assignments.map((one) => one.mergeNumber),
    ],
  );
  return result.rowCount ?? 0;
}

/** 이 에폭에서 번호를 받은 행들 (서수 오름차순, 상한). 색인 재구축·재적용이 쓴다. */
export async function listNumberedAfter(
  db: Queryable,
  repositoryId: number,
  baseBranch: string,
  seqEpoch: number,
  afterSeq: number,
  limit: number,
): Promise<MergeSequenceRow[]> {
  const result = await db.query<MergeSequenceRow>(
    `SELECT * FROM merge_sequence
      WHERE repository_id = $1 AND base_branch = $2 AND seq_epoch = $3
        AND merge_seq > $4 AND merge_number IS NOT NULL
      ORDER BY merge_seq
      LIMIT $5`,
    [repositoryId, baseBranch, seqEpoch, afterSeq, limit],
  );
  return result.rows;
}

/** M 번호 → 행 (API-SEQ-007 M 방향). 없으면 `null` — 잠정값을 지어내지 않는다. */
export async function findRowByMergeNumber(
  db: Queryable,
  repositoryId: number,
  baseBranch: string,
  seqEpoch: number,
  mergeNumber: number,
): Promise<MergeSequenceRow | null> {
  const result = await db.query<MergeSequenceRow>(
    `SELECT * FROM merge_sequence
      WHERE repository_id = $1 AND base_branch = $2 AND seq_epoch = $3 AND merge_number = $4`,
    [repositoryId, baseBranch, seqEpoch, mergeNumber],
  );
  return result.rows[0] ?? null;
}

/** 정본 batch 대조의 한 행 — 공간의 현재 상태와 PR의 서수·번호를 함께 준다. */
export interface MergeNumberLookup {
  readonly repository_id: number;
  readonly base_branch: string;
  readonly pull_request_number: number;
  readonly merge_seq: number;
  readonly commit_sha: string;
  readonly merge_number: number | null;
  readonly seq_epoch: number;
}

export interface MergeNumberSpaceState {
  readonly repository_id: number;
  readonly base_branch: string;
  readonly seq_epoch: number;
  readonly state: string;
  readonly mnumber_head_seq: number;
  readonly mnumber_blocked_seq: number | null;
  readonly mnumber_blocked_reason: string | null;
}

/**
 * 페이지의 PR 튜플을 **한 번에** 정본과 대조한다 (API 계약 8절, ADR-023 C5).
 *
 * 행별 HTTP 호출도, 행별 SQL도 만들지 않는다. 현재 에폭 행만 돌려주며 이전 에폭의
 * 번호는 여기 나오지 않는다 — 옛 번호를 현재처럼 보이게 하지 않는다.
 */
export async function lookupMergeNumbers(
  db: Queryable,
  tuples: readonly { readonly repositoryId: number; readonly baseBranch: string; readonly prNumber: number }[],
): Promise<{
  readonly spaces: MergeNumberSpaceState[];
  readonly rows: MergeNumberLookup[];
  /** 저장소별 채번 대상 브랜치. 비대상 브랜치를 `pending`이 아니라 `not_applicable`로 가른다. */
  readonly tracked: Map<number, readonly string[]>;
}> {
  if (tuples.length === 0) return { spaces: [], rows: [], tracked: new Map() };
  const repositoryIds = tuples.map((one) => one.repositoryId);
  const baseBranches = tuples.map((one) => one.baseBranch);
  const prNumbers = tuples.map((one) => one.prNumber);

  const spaces = await db.query<MergeNumberSpaceState>(
    `SELECT DISTINCT s.repository_id, s.base_branch, s.seq_epoch, s.state,
            s.mnumber_head_seq, s.mnumber_blocked_seq, s.mnumber_blocked_reason
       FROM sequence_space s
       JOIN unnest($1::bigint[], $2::text[]) AS k(repository_id, base_branch)
         ON k.repository_id = s.repository_id AND k.base_branch = s.base_branch`,
    [repositoryIds, baseBranches],
  );
  const rows = await db.query<MergeNumberLookup>(
    `SELECT ms.repository_id, ms.base_branch, ms.pull_request_number, ms.merge_seq::bigint AS merge_seq,
            ms.commit_sha, ms.merge_number, ms.seq_epoch
       FROM merge_sequence ms
       JOIN sequence_space s
         ON s.repository_id = ms.repository_id AND s.base_branch = ms.base_branch AND s.seq_epoch = ms.seq_epoch
       JOIN unnest($1::bigint[], $2::text[], $3::int[]) AS k(repository_id, base_branch, pr_number)
         ON k.repository_id = ms.repository_id AND k.base_branch = ms.base_branch
        AND k.pr_number = ms.pull_request_number
      -- 한 PR에 행이 둘일 수 있다(이중 squash SHA). 순서를 고정해 조회마다 답이 바뀌지 않게 한다.
      ORDER BY ms.repository_id, ms.base_branch, ms.pull_request_number, ms.merge_seq`,
    [repositoryIds, baseBranches, prNumbers],
  );
  /*
   * 채번 대상 브랜치를 같은 스냅숏에서 함께 읽는다 (WP-074 / DEV-591).
   *
   * 이것이 없으면 비대상 브랜치에 머지된 PR이 `not_applicable`이 아니라
   * **`pending / not_sequenced`로 보인다** — 화면이 "시퀀스 채번 대기"라고 말하는데
   * 그 PR은 영원히 채번되지 않는다. 해석 API는 같은 경우에 409 `branch_not_tracked`를
   * 답하므로 두 표면의 답이 갈린다.
   */
  const repositories = await db.query<{ repository_id: string; sequence_branches: string[] }>(
    `SELECT repository_id, sequence_branches
       FROM repository
      WHERE repository_id = ANY($1::bigint[])`,
    [[...new Set(repositoryIds)]],
  );

  return {
    tracked: new Map(repositories.rows.map((row) => [Number(row.repository_id), row.sequence_branches ?? []])),
    spaces: spaces.rows,
    rows: rows.rows.map((row) => ({ ...row, merge_seq: Number(row.merge_seq) })),
  };
}

/** 이 에폭에서 이미 번호를 받은 PR (후보 집합 안에서만). 같은 PR의 이중 SHA 판정에 쓴다. */
export async function listNumberedPullRequests(
  db: Queryable,
  repositoryId: number,
  baseBranch: string,
  seqEpoch: number,
  prNumbers: readonly number[],
): Promise<Set<number>> {
  if (prNumbers.length === 0) return new Set();
  const result = await db.query<{ pull_request_number: number }>(
    `SELECT pull_request_number FROM merge_sequence
      WHERE repository_id = $1 AND base_branch = $2 AND seq_epoch = $3
        AND merge_number IS NOT NULL AND pull_request_number = ANY($4::int[])`,
    [repositoryId, baseBranch, seqEpoch, prNumbers],
  );
  return new Set(result.rows.map((row) => row.pull_request_number));
}

/* ------------------------------------------------------------------ WP-075 표기 */

/**
 * 표기 대상 한 건 (WP-075 / FR-SEQ-009).
 *
 * `BIGINT`는 `type-parsers.ts`가 safe integer로 바꿔 주므로 숫자로 받는다.
 */
export interface AnnotateTargetRow {
  readonly repository_id: number;
  readonly owner: string;
  readonly name: string;
  readonly base_branch: string;
  readonly seq_epoch: number;
  readonly merge_seq: number;
  readonly pull_request_number: number;
  readonly merge_number: number;
  readonly annotate_state: 'failed' | 'disabled' | 'unknown' | null;
}

export interface AnnotateTargetFilter {
  readonly limit: number;
  /** 이벤트 경로는 공간을 좁혀 부른다. 스윕은 좁히지 않는다. */
  readonly repositoryId?: number;
  readonly baseBranch?: string;
  readonly pullRequestNumbers?: readonly number[];
  /**
   * 권한 차단을 다시 볼 기준 시각. 이보다 **오래된** 차단만 통과시킨다.
   *
   * 주지 않으면 차단된 저장소를 전부 제외한다 — 이벤트 경로가 그렇게 부른다.
   * 차단 직후 도착한 이벤트가 방금 막은 저장소를 다시 두드리지 않게 한다.
   */
  readonly blockedBefore?: Date;
}

/**
 * 아직 표기하지 못한 행을 고른다 (FR-SEQ-009 AC-6·AC-7, JOB-SEQ-005).
 *
 * ## 에폭은 조인이 강제한다
 *
 * `sequence_space`와 `seq_epoch`까지 함께 조인하므로 **현재 에폭의 행만** 나온다.
 * 늦게 도착한 이전 에폭 이벤트가 지금 제목을 고치는 경로가 애플리케이션 코드가
 * 아니라 질의에서 막힌다 — 호출부가 깜빡할 수 있는 검사를 한 곳에 모은다.
 *
 * ## 무엇을 다시 보는가
 *
 * ## 방금 손댄 행을 뒤로 보낸다 (WP-075 리뷰 major)
 *
 * **영원히 실패하는 행이 존재한다.** 저장소 이름으로 코드를 정할 수 없으면
 * (`no_digits`·`multiple_digit_runs`) 그 행은 몇 번을 다시 봐도 `failed`다. 정렬이
 * `repository_id`로 시작하면 낮은 번호의 그런 저장소가 상한(`LIMIT`)을 통째로
 * 차지해 **높은 번호 저장소의 행에 스윕이 영영 닿지 않는다** — 복구 안전망이
 * 무력해지는 자리다.
 *
 * 그래서 `annotated_at`이 비어 있는 행(한 번도 시도하지 않은 것)을 먼저 보고,
 * 그다음은 가장 오래전에 손댄 것부터 본다. 저장소 코드 규칙을 SQL에 다시 쓰지
 * 않는 이유는 그 규칙의 정본이 `@prs/domain`의 `repositoryCodeOf` 하나여야 하기
 * 때문이며, 공평한 순서는 **영구 실패의 종류를 몰라도** 성립한다.
 *
 * ## 무엇을 다시 보는가
 *
 * `done`과 `mismatch`는 끝난 상태다. `failed`는 일시 실패였을 수 있으니 다시 본다.
 * `disabled`도 다시 보는데, 그 행을 남긴 뒤 운영자가 저장소를 **다시 켰을 수**
 * 있기 때문이다 — 이 질의는 켜진 저장소만 내므로 꺼진 채면 애초에 나오지 않는다.
 * 다시 보는 것이 곧 다시 쓰는 것은 아니다: 처리는 언제나 제목 조회부터 시작하고
 * 이미 같은 접두가 있으면 호출 없이 `done`이 된다.
 *
 * `unknown`도 다시 본다 — **요청을 보냈는지조차 모르는 행**이므로 확인이 필요하고,
 * 확인은 곧 제목 조회다. 이미 붙어 있으면 호출 없이 끝난다.
 *
 * **`body_changed`는 다시 보지 않는다.** 서버가 저장한 제목이 우리가 보낸 값과 달랐던
 * 행이며, 자동으로 다시 쓰면 그 차이를 덮어 「원래 제목을 지킨다」는 계약이 조용히
 * 무너진다. 운영자가 확인하고 재개를 지시할 때까지 여기서 나오지 않는다.
 */
export async function listAnnotateTargets(
  db: Queryable,
  filter: AnnotateTargetFilter,
): Promise<AnnotateTargetRow[]> {
  const result = await db.query<AnnotateTargetRow>(
    `SELECT ms.repository_id, r.owner, r.name, ms.base_branch, ms.seq_epoch,
            ms.merge_seq, ms.pull_request_number, ms.merge_number, ms.annotate_state
       FROM merge_sequence ms
       JOIN sequence_space sp
         ON sp.repository_id = ms.repository_id
        AND sp.base_branch   = ms.base_branch
        AND sp.seq_epoch     = ms.seq_epoch
       JOIN repository r ON r.repository_id = ms.repository_id
      WHERE ms.merge_number IS NOT NULL
        AND sp.state <> 'reassigning'
        AND ms.pull_request_number IS NOT NULL
        AND (ms.annotate_state IS NULL OR ms.annotate_state IN ('failed', 'disabled', 'unknown'))
        AND r.status = 'active'
        AND r.annotate_enabled
        AND (r.annotate_blocked_at IS NULL OR ($5::timestamptz IS NOT NULL AND r.annotate_blocked_at < $5))
        AND ($1::bigint IS NULL OR ms.repository_id = $1)
        AND ($2::text   IS NULL OR ms.base_branch   = $2)
        AND ($3::int[]  IS NULL OR ms.pull_request_number = ANY($3))
      ORDER BY ms.annotated_at ASC NULLS FIRST, ms.repository_id, ms.base_branch, ms.merge_seq
      LIMIT $4`,
    [
      filter.repositoryId ?? null,
      filter.baseBranch ?? null,
      filter.pullRequestNumbers === undefined ? null : [...filter.pullRequestNumbers],
      filter.limit,
      filter.blockedBefore ?? null,
    ],
  );
  return result.rows;
}

/**
 * **쓰기 직전에 다시 묻는다** (WP-075 / CR-084, 리뷰 P1).
 *
 * `listAnnotateTargets`의 조인은 **그 질의가 도는 순간**의 에폭만 증명한다. 목록을
 * 뽑아 한 건씩 처리하는 동안 재채번이 들어와 에폭이 오르면, 그 뒤의 행은 이미
 * 무효가 된 M 번호를 들고 GHE로 나간다. 제목은 되돌릴 수 없으므로 **외부 쓰기
 * 경계 바로 앞에서 한 번 더 묻는다.**
 *
 * 이것이 경합을 완전히 없애지는 못한다 — 이 질의와 PATCH 사이의 간격은 남는다.
 * 다만 그 창이 목록 전체의 처리 시간에서 질의 한 번으로 줄고, 재채번 중(`reassigning`)
 * 공간은 애초에 목록에 들어오지 않는다.
 *
 * @returns 지금도 같은 에폭·같은 번호로 표기해도 되는가.
 */
export async function isAnnotationCurrent(
  db: Queryable,
  key: {
    readonly repositoryId: number;
    readonly baseBranch: string;
    readonly seqEpoch: number;
    readonly mergeSeq: number;
  },
  mergeNumber: number,
): Promise<boolean> {
  const result = await db.query<{ ok: boolean }>(
    `SELECT true AS ok
       FROM merge_sequence ms
       JOIN sequence_space sp
         ON sp.repository_id = ms.repository_id
        AND sp.base_branch   = ms.base_branch
        AND sp.seq_epoch     = ms.seq_epoch
       JOIN repository r ON r.repository_id = ms.repository_id
      WHERE ms.repository_id = $1 AND ms.base_branch = $2 AND ms.seq_epoch = $3 AND ms.merge_seq = $4
        AND ms.merge_number = $5
        AND sp.state <> 'reassigning'
        AND r.status = 'active'
        AND r.annotate_enabled`,
    [key.repositoryId, key.baseBranch, key.seqEpoch, key.mergeSeq, mergeNumber],
  );
  return result.rows.length === 1;
}

export type AnnotateState = 'done' | 'mismatch' | 'failed' | 'disabled' | 'body_changed' | 'unknown';

/** 결과와 함께 남기는 최소 근거 (027). 제목 원문은 담지 않는다. */
export interface AnnotateOutcomeEvidence {
  /** 그 시도의 식별자. 감사 기록과 이 행을 나중에 맞춰 볼 끈이다. */
  readonly attemptId?: string;
  /** 쓰려 한 제목의 지문(해시 앞 16자). 원문이 아니다. */
  readonly expectedDigest?: string;
  /** 짧은 사유 코드. 자유 문장을 넣지 않는다. */
  readonly reason?: string;
}

/**
 * 표기 결과를 남긴다.
 *
 * **`merge_number`를 되돌리지 않는다** (FR-SEQ-009 AC-3). 표기가 실패해도 번호는
 * 이미 확정된 사실이며, 실패로 번호를 지우면 같은 PR이 다음 회차에 다른 번호를
 * 받을 수 있다.
 *
 * 근거를 주지 않으면 **기존 값을 지운다.** 결과가 바뀌었는데 옛 사유가 남아 있으면
 * 운영자가 지금 상태를 옛 이유로 읽는다.
 */
export async function markAnnotateState(
  db: Queryable,
  key: {
    readonly repositoryId: number;
    readonly baseBranch: string;
    readonly seqEpoch: number;
    readonly mergeSeq: number;
  },
  state: AnnotateState,
  evidence: AnnotateOutcomeEvidence = {},
): Promise<void> {
  await db.query(
    `UPDATE merge_sequence
        SET annotate_state = $5, annotated_at = now(),
            annotate_attempt_id = $6, annotate_expected_digest = $7, annotate_result_reason = $8
      WHERE repository_id = $1 AND base_branch = $2 AND seq_epoch = $3 AND merge_seq = $4`,
    [
      key.repositoryId,
      key.baseBranch,
      key.seqEpoch,
      key.mergeSeq,
      state,
      evidence.attemptId ?? null,
      evidence.expectedDigest ?? null,
      evidence.reason ?? null,
    ],
  );
}

/**
 * 운영자가 확인을 마친 행의 표기를 다시 열어 준다 (안전성 보강 / 재개 절차).
 *
 * **`body_changed`만 푼다.** 그 상태만이 「자동으로는 다시 하지 않는다」는 뜻을
 * 가지며, 나머지는 애초에 스스로 다시 시도한다. 상태를 `NULL`로 되돌려 다음 회차가
 * 처음 보는 행처럼 다루게 하되, **근거는 지우지 않는다** — 무엇을 확인하고 열었는지
 * 남아 있어야 같은 일이 반복될 때 앞선 판단을 볼 수 있다.
 *
 * 이미 GHE에 붙은 제목을 되돌리지 않는다. 여는 것은 다음 시도의 자격뿐이다.
 *
 * **`annotated_at`도 비운다.** 대상 정렬이 `annotated_at ASC NULLS FIRST`이므로 값을
 * 남기면 운영자가 방금 연 행이 대기열 **뒤로** 밀린다 — 사람이 확인하고 다시 하라고
 * 지시한 행이 가장 늦게 처리되는 것은 그 지시의 뜻과 어긋난다. 근거 세 열은 지우지
 * 않으므로 「한 번도 시도하지 않은 행」과는 여전히 구별된다.
 *
 * @returns 이번에 다시 연 행 수.
 */
export async function resumeAnnotateTargets(
  db: Queryable,
  repositoryId: number,
): Promise<number> {
  const result = await db.query(
    `UPDATE merge_sequence
        SET annotate_state = NULL, annotated_at = NULL
      WHERE repository_id = $1 AND annotate_state = 'body_changed'`,
    [repositoryId],
  );
  return result.rowCount ?? 0;
}

/**
 * 표기 현황을 저장소 하나에 대해 센다 (읽기 전용 사전 점검).
 *
 * **아무것도 바꾸지 않는다.** 운영자가 전역 스위치를 열기 전에 「무엇이 몇 건
 * 바뀌는가」를 먼저 볼 수 있어야 하고, 그 답은 정본에만 있다.
 */
export interface AnnotateReadiness {
  /** 번호가 확정돼 표기 대상이 될 수 있는 행. */
  readonly numbered: number;
  /** 아직 표기하지 않은 행 (지금 켜면 제목이 바뀔 수). */
  readonly pending: number;
  readonly done: number;
  readonly mismatch: number;
  readonly failed: number;
  readonly disabled: number;
  readonly body_changed: number;
  readonly unknown: number;
  /** 번호를 받지 못한 행. `DEV-581`이 열려 있으면 여기가 크다. */
  readonly unnumbered: number;
}

export async function countAnnotateReadiness(
  db: Queryable,
  repositoryId: number,
  baseBranch?: string,
): Promise<AnnotateReadiness> {
  const result = await db.query<Record<string, string | number>>(
    `SELECT
       count(*) FILTER (WHERE ms.merge_number IS NOT NULL)                                  AS numbered,
       count(*) FILTER (WHERE ms.merge_number IS NOT NULL AND ms.annotate_state IS NULL)     AS pending,
       count(*) FILTER (WHERE ms.annotate_state = 'done')                                    AS done,
       count(*) FILTER (WHERE ms.annotate_state = 'mismatch')                                AS mismatch,
       count(*) FILTER (WHERE ms.annotate_state = 'failed')                                  AS failed,
       count(*) FILTER (WHERE ms.annotate_state = 'disabled')                                AS disabled,
       count(*) FILTER (WHERE ms.annotate_state = 'body_changed')                            AS body_changed,
       count(*) FILTER (WHERE ms.annotate_state = 'unknown')                                 AS unknown,
       count(*) FILTER (WHERE ms.merge_number IS NULL AND ms.pull_request_number IS NOT NULL) AS unnumbered
       FROM merge_sequence ms
       JOIN sequence_space sp
         ON sp.repository_id = ms.repository_id
        AND sp.base_branch   = ms.base_branch
        AND sp.seq_epoch     = ms.seq_epoch
      WHERE ms.repository_id = $1
        AND ($2::text IS NULL OR ms.base_branch = $2)`,
    [repositoryId, baseBranch ?? null],
  );
  const row = result.rows[0] ?? {};
  const read = (key: string): number => Number(row[key] ?? 0);
  return {
    numbered: read('numbered'),
    pending: read('pending'),
    done: read('done'),
    mismatch: read('mismatch'),
    failed: read('failed'),
    disabled: read('disabled'),
    body_changed: read('body_changed'),
    unknown: read('unknown'),
    unnumbered: read('unnumbered'),
  };
}

/**
 * 해제된 저장소의 행을 `disabled`로 남긴다 (WP-075 구현 범위).
 *
 * **GHE를 부르지 않는다.** 운영자가 왜 이 PR에 번호만 있고 제목에는 없는지 물을 때
 * 답이 되는 것은 이 표시뿐이다 — 아무 표시도 없으면 "아직 안 했다"와 "하지 않기로
 * 했다"를 구분할 수 없다.
 *
 * 이미 `disabled`인 행은 건드리지 않아 스윕마다 같은 행을 다시 쓰지 않는다.
 * `done`·`mismatch`도 덮지 않는다: 끈 것이 이미 쓴 사실을 지우지는 않는다.
 *
 * @returns 이번에 표시한 행 수.
 */
export async function markDisabledRepositoryTargets(db: Queryable, limit: number): Promise<number> {
  const result = await db.query(
    `UPDATE merge_sequence ms
        SET annotate_state = 'disabled', annotated_at = now()
      WHERE (ms.repository_id, ms.base_branch, ms.seq_epoch, ms.merge_seq) IN (
        SELECT t.repository_id, t.base_branch, t.seq_epoch, t.merge_seq
          FROM merge_sequence t
          JOIN sequence_space sp
            ON sp.repository_id = t.repository_id
           AND sp.base_branch   = t.base_branch
           AND sp.seq_epoch     = t.seq_epoch
          JOIN repository r ON r.repository_id = t.repository_id
         WHERE t.merge_number IS NOT NULL
           AND t.pull_request_number IS NOT NULL
           AND (t.annotate_state IS NULL OR t.annotate_state = 'failed')
           AND NOT r.annotate_enabled
         ORDER BY t.repository_id, t.base_branch, t.merge_seq
         LIMIT $1
      )`,
    [limit],
  );
  return result.rowCount ?? 0;
}

/* ------------------------------------------------------------------ M 번호 태그 (WP-100 / CR-115) */

/** 태그 work가 실행 직전에 다시 읽는 정본 행 — 저장소 정책·차단·추적 브랜치까지 한 번에. */
export interface TagTargetRow {
  readonly repository_id: number;
  readonly owner: string;
  readonly name: string;
  readonly sequence_branches: string[];
  readonly tag_enabled: boolean;
  readonly tag_blocked_at: Date | null;
  readonly repository_status: string;
  readonly base_branch: string;
  readonly seq_epoch: number;
  readonly merge_seq: number;
  readonly commit_sha: string;
  readonly pull_request_number: number;
  readonly merge_number: number;
  readonly tag_state: TagState | null;
  readonly tag_found_sha: string | null;
}

/**
 * PR 하나의 현재 에폭 정본 행 (태그 work의 재확인, FR-SEQ-012 AC-2·AC-4).
 *
 * `sequence_space`와 `seq_epoch`까지 조인하므로 **현재 에폭의 행만** 나온다 — 옛 에폭의
 * work가 이미 무효가 된 번호로 태그를 만드는 경로가 애플리케이션 코드가 아니라 질의에서
 * 막힌다(표기의 `listAnnotateTargets`와 같은 규율). 재채번 중(`reassigning`) 공간은 나오지 않는다.
 */
export async function findTagTarget(
  db: Queryable,
  key: { readonly repositoryId: number; readonly baseBranch: string; readonly prNumber: number },
): Promise<TagTargetRow | undefined> {
  const result = await db.query<TagTargetRow>(
    `SELECT ms.repository_id, r.owner, r.name, r.sequence_branches, r.tag_enabled, r.tag_blocked_at,
            r.status AS repository_status, ms.base_branch, ms.seq_epoch, ms.merge_seq, ms.commit_sha,
            ms.pull_request_number, ms.merge_number, ms.tag_state, ms.tag_found_sha
       FROM merge_sequence ms
       JOIN sequence_space sp
         ON sp.repository_id = ms.repository_id
        AND sp.base_branch   = ms.base_branch
        AND sp.seq_epoch     = ms.seq_epoch
       JOIN repository r ON r.repository_id = ms.repository_id
      WHERE ms.repository_id = $1 AND ms.base_branch = $2 AND ms.pull_request_number = $3
        AND ms.merge_number IS NOT NULL
        AND sp.state <> 'reassigning'
      ORDER BY ms.merge_seq
      LIMIT 1`,
    [key.repositoryId, key.baseBranch, key.prNumber],
  );
  return result.rows[0];
}

export interface TagSweepFilter {
  readonly limit: number;
  readonly repositoryId?: number;
  readonly baseBranch?: string;
  /** 권한 차단을 다시 볼 기준 시각. 이보다 오래된 차단만 통과시킨다. 없으면 차단된 저장소를 뺀다. */
  readonly blockedBefore?: Date;
}

/**
 * 태그 work를 다시 요청해야 할 행 (JOB-SEQ-007 잔여 스윕, FR-SEQ-012 AC-2).
 *
 * 현재 에폭에서 번호가 확정됐는데 태그 결과가 없거나(`NULL`) 다시 볼 수 있는 상태
 * (`failed`·`unknown`)인 행이다. `done`·`conflict`·`disabled`는 끝난 상태라 여기 나오지 않는다 —
 * `conflict`를 스윕이 다시 두드리면 손대지 않기로 한 태그에 요청만 반복하고, `disabled`는
 * 운영자가 저장소를 다시 켰을 때 대조(reconcile)가 연다. 이 함수는 **과거 채번분의
 * backfill**이기도 하다: CR-115 이전에 번호를 받은 행에는 `tag` work가 없다.
 */
export async function listTagSweepTargets(db: Queryable, filter: TagSweepFilter): Promise<TagTargetRow[]> {
  const result = await db.query<TagTargetRow>(
    `SELECT ms.repository_id, r.owner, r.name, r.sequence_branches, r.tag_enabled, r.tag_blocked_at,
            r.status AS repository_status, ms.base_branch, ms.seq_epoch, ms.merge_seq, ms.commit_sha,
            ms.pull_request_number, ms.merge_number, ms.tag_state, ms.tag_found_sha
       FROM merge_sequence ms
       JOIN sequence_space sp
         ON sp.repository_id = ms.repository_id
        AND sp.base_branch   = ms.base_branch
        AND sp.seq_epoch     = ms.seq_epoch
       JOIN repository r ON r.repository_id = ms.repository_id
      WHERE ms.merge_number IS NOT NULL
        AND ms.pull_request_number IS NOT NULL
        AND sp.state <> 'reassigning'
        AND (ms.tag_state IS NULL OR ms.tag_state IN ('failed', 'unknown'))
        AND r.status = 'active'
        AND r.tag_enabled
        AND (r.tag_blocked_at IS NULL OR ($4::timestamptz IS NOT NULL AND r.tag_blocked_at < $4))
        AND ($1::bigint IS NULL OR ms.repository_id = $1)
        AND ($2::text   IS NULL OR ms.base_branch   = $2)
      ORDER BY ms.tagged_at ASC NULLS FIRST, ms.repository_id, ms.base_branch, ms.merge_seq
      LIMIT $3`,
    [filter.repositoryId ?? null, filter.baseBranch ?? null, filter.limit, filter.blockedBefore ?? null],
  );
  return result.rows;
}

/** 현재 에폭에서 번호가 확정된 행을 서수 순으로 페이지한다 (대조·상태 집계). */
export async function listNumberedRowsPage(
  db: Queryable,
  key: { readonly repositoryId: number; readonly baseBranch: string; readonly seqEpoch: number },
  afterSeq: number,
  limit: number,
): Promise<MergeSequenceRow[]> {
  const result = await db.query<MergeSequenceRow>(
    `SELECT * FROM merge_sequence
      WHERE repository_id = $1 AND base_branch = $2 AND seq_epoch = $3
        AND merge_number IS NOT NULL AND merge_seq > $4
      ORDER BY merge_seq
      LIMIT $5`,
    [key.repositoryId, key.baseBranch, key.seqEpoch, afterSeq, limit],
  );
  return result.rows;
}

export interface TagOutcomeEvidence {
  readonly attemptId?: string;
  readonly reason?: string;
  /** `conflict`의 근거 — 원격 태그가 가리키던 SHA. */
  readonly foundSha?: string;
}

/**
 * 태그 결과를 남긴다. **`merge_number`를 되돌리지 않는다** (FR-SEQ-012 AC-5) — 태그가 실패해도
 * 번호는 확정된 사실이다. 근거를 주지 않으면 기존 값을 지운다(표기와 같은 규율).
 */
export async function markTagState(
  db: Queryable,
  key: { readonly repositoryId: number; readonly baseBranch: string; readonly seqEpoch: number; readonly mergeSeq: number },
  state: TagState,
  evidence: TagOutcomeEvidence = {},
): Promise<void> {
  await db.query(
    `UPDATE merge_sequence
        SET tag_state = $5, tagged_at = now(),
            tag_attempt_id = $6, tag_result_reason = $7, tag_found_sha = $8
      WHERE repository_id = $1 AND base_branch = $2 AND seq_epoch = $3 AND merge_seq = $4`,
    [key.repositoryId, key.baseBranch, key.seqEpoch, key.mergeSeq, state, evidence.attemptId ?? null, evidence.reason ?? null, evidence.foundSha ?? null],
  );
}

/**
 * 종결 상태를 지우고 「미시도」로 되돌린다 (FR-SEQ-012 AC-10).
 *
 * 부르는 곳은 대조(reconcile) 하나다 — 원격에 태그가 **없음을 방금 확인한** `conflict` 행만 다시 연다.
 * 실행자는 `conflict` 행을 원격 조회 없이 건너뛰므로 이 경로 없이는 사람이 GHE에서 지운 태그가
 * 영영 다시 만들어지지 않는다. `merge_number`는 건드리지 않는다(AC-5). 사유는 남겨 왜 열렸는지
 * 읽을 수 있게 한다.
 */
export async function clearTagState(
  db: Queryable,
  key: { readonly repositoryId: number; readonly baseBranch: string; readonly seqEpoch: number; readonly mergeSeq: number },
  reason: string,
): Promise<void> {
  await db.query(
    `UPDATE merge_sequence
        SET tag_state = NULL, tagged_at = now(),
            tag_attempt_id = NULL, tag_result_reason = $5, tag_found_sha = NULL
      WHERE repository_id = $1 AND base_branch = $2 AND seq_epoch = $3 AND merge_seq = $4`,
    [key.repositoryId, key.baseBranch, key.seqEpoch, key.mergeSeq, reason.slice(0, 200)],
  );
}

/**
 * **쓰기 직전에 다시 묻는다** — `findTagTarget`으로 읽은 뒤 GHE 조회가 몇 초를 쓰는 동안
 * 재채번이 에폭을 올렸을 수 있다. 태그는 되돌릴 수 없으므로(옮기지도 지우지도 않는다,
 * AC-3) 무효가 된 번호를 내보내지 않는다.
 */
export async function isTagTargetCurrent(
  db: Queryable,
  key: { readonly repositoryId: number; readonly baseBranch: string; readonly seqEpoch: number; readonly mergeSeq: number },
  mergeNumber: number,
  commitSha: string,
  /**
   * 저장소 정책·차단·추적 브랜치도 함께 다시 본다 (FR-SEQ-012 AC-4, 독립 검토 지적 1). `blockedBefore`는
   * 권한 차단을 다시 볼 기준 시각이다 — 그보다 새 차단(조회 사이에 다른 실행자가 건 것)이면 만들지 않고,
   * 쿨다운을 지난 옛 차단은 진입 게이트와 같이 통과시킨다.
   */
  options: { readonly blockedBefore: Date },
): Promise<boolean> {
  const result = await db.query<{ ok: boolean }>(
    `SELECT true AS ok
       FROM merge_sequence ms
       JOIN sequence_space sp
         ON sp.repository_id = ms.repository_id
        AND sp.base_branch   = ms.base_branch
        AND sp.seq_epoch     = ms.seq_epoch
       JOIN repository r ON r.repository_id = ms.repository_id
      WHERE ms.repository_id = $1 AND ms.base_branch = $2 AND ms.seq_epoch = $3 AND ms.merge_seq = $4
        AND ms.merge_number = $5 AND lower(ms.commit_sha) = lower($6)
        AND sp.state <> 'reassigning'
        AND r.status = 'active' AND r.tag_enabled
        AND (r.tag_blocked_at IS NULL OR r.tag_blocked_at < $7)
        AND coalesce(array_length(r.sequence_branches, 1), 0) = 1`,
    [key.repositoryId, key.baseBranch, key.seqEpoch, key.mergeSeq, mergeNumber, commitSha, options.blockedBefore],
  );
  return result.rows.length > 0;
}

/** 저장소·브랜치의 현재 에폭 태그 상태 집계 (읽기 전용 — `prsctl mnumber tags status`). */
export async function countTagStates(
  db: Queryable,
  key: { readonly repositoryId: number; readonly baseBranch: string; readonly seqEpoch: number },
): Promise<Readonly<Record<string, number>>> {
  const result = await db.query<{ state: string | null; count: string }>(
    `SELECT tag_state AS state, count(*)::text AS count
       FROM merge_sequence
      WHERE repository_id = $1 AND base_branch = $2 AND seq_epoch = $3 AND merge_number IS NOT NULL
      GROUP BY tag_state`,
    [key.repositoryId, key.baseBranch, key.seqEpoch],
  );
  const out: Record<string, number> = {};
  for (const row of result.rows) out[row.state ?? 'untried'] = Number(row.count);
  return out;
}

/**
 * 머지 커밋 SHA로 현재 에폭의 번호 행을 찾는다 (커밋 보강이 merge_commit 문서를 만든 뒤
 * M 값을 비출 work를 요청할 때, CR-115). 없거나 번호가 없으면 `undefined`.
 */
export async function findNumberedRowBySha(
  db: Queryable,
  repositoryId: number,
  baseBranch: string,
  seqEpoch: number,
  commitSha: string,
): Promise<MergeSequenceRow | undefined> {
  const result = await db.query<MergeSequenceRow>(
    `SELECT * FROM merge_sequence
      WHERE repository_id = $1 AND base_branch = $2 AND seq_epoch = $3 AND lower(commit_sha) = lower($4)
        AND merge_number IS NOT NULL
      LIMIT 1`,
    [repositoryId, baseBranch, seqEpoch, commitSha],
  );
  return result.rows[0];
}
