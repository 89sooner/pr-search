/**
 * 정합성 점검이 읽는 것 (WP-028 / FR-ADMIN-003, CR-033).
 *
 * 점검은 **읽기만 한다.** 이 파일에 쓰기 질의가 없는 것이 그 규율의 표현이다 —
 * 그래프를 읽지 못해 점검이 실패해도 `sequence_space.state`는 바뀌지 않는다
 * (CR-033, DEV-171). 진단 실행의 실패는 진단 결과에 담기지 진단 대상의 정본
 * 상태가 되지 않는다.
 */

import type { Pool, PoolClient } from 'pg';

type Queryable = Pool | PoolClient;

/** 대조할 저장분 한 줄. `@prs/domain`의 `StoredSequenceEntry`와 같은 모양이다. */
export interface StoredSequenceRow {
  readonly merge_seq: string;
  readonly commit_sha: string;
}

/**
 * 한 공간·에폭의 저장된 서수-커밋 대응을 서수 오름차순으로 읽는다.
 *
 * @param fromSeq 포함 하한. 표본 모드는 `sampleFromSeq(headSeq)`를, 전량 모드는 `1`을 준다.
 */
export async function listStoredSequence(
  db: Queryable,
  repositoryId: number,
  baseBranch: string,
  seqEpoch: number,
  fromSeq: number,
): Promise<readonly { readonly mergeSeq: number; readonly commitSha: string }[]> {
  const result = await db.query<StoredSequenceRow>(
    `SELECT merge_seq, commit_sha FROM merge_sequence
      WHERE repository_id = $1 AND base_branch = $2 AND seq_epoch = $3 AND merge_seq >= $4
      ORDER BY merge_seq`,
    [repositoryId, baseBranch, seqEpoch, fromSeq],
  );
  return result.rows.map((row) => ({ mergeSeq: Number(row.merge_seq), commitSha: row.commit_sha }));
}

/**
 * 최초 불일치 서수 **이상**의 행 수 (`impact_estimate.affected_commit_count`).
 *
 * 재채번이 뜻을 바꿀 서수의 개수다. 불일치 지점을 포함한다 — 그 서수부터 이미
 * 다른 커밋을 가리키고 있다.
 */
export async function countAffectedCommits(
  db: Queryable,
  repositoryId: number,
  baseBranch: string,
  seqEpoch: number,
  fromSeqInclusive: number,
): Promise<number> {
  const result = await db.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM merge_sequence
      WHERE repository_id = $1 AND base_branch = $2 AND seq_epoch = $3 AND merge_seq >= $4`,
    [repositoryId, baseBranch, seqEpoch, fromSeqInclusive],
  );
  return Number(result.rows[0]?.count ?? 0);
}

/**
 * 그 구간에 걸린 안전 구간 표식 수 (`invalidated_safe_marker_count`).
 *
 * **표식이 하나도 없으면 `0`이 참이다** — `safe_marker` 표가 실재하고 질의가
 * 성립하므로, 여기서 나온 0은 "세어 보니 없다"이지 "세지 않았다"가 아니다
 * (DEV-133이 금지한 것은 후자를 전자처럼 적는 일이다).
 *
 * 이미 대체된 표식(`superseded_at`이 있는 것)은 세지 않는다 — 무효화할 것이
 * 남아 있지 않다.
 */
export async function countInvalidatedSafeMarkers(
  db: Queryable,
  repositoryId: number,
  baseBranch: string,
  seqEpoch: number,
  fromSeqInclusive: number,
): Promise<number> {
  const result = await db.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM safe_marker
      WHERE repository_id = $1 AND base_branch = $2 AND seq_epoch = $3
        AND merge_seq >= $4 AND superseded_at IS NULL`,
    [repositoryId, baseBranch, seqEpoch, fromSeqInclusive],
  );
  return Number(result.rows[0]?.count ?? 0);
}

/**
 * 저장 검색의 질의 문자열 전부.
 *
 * 영향 판정은 **파서가 한다** (CR-033, DEV-173) — `saved_search`에는 저장소 열이
 * 없고 질의 문자열뿐이라, 여기서는 문자열만 내고 해석은 호출부가 `@prs/query`로
 * 한다. 문자열을 정규식으로 훑으면 인용 안의 본문과 부정 필터를 전부 오답으로
 * 만든다.
 */
export async function listSavedSearchQueries(db: Queryable): Promise<readonly string[]> {
  const result = await db.query<{ query: string }>('SELECT query FROM saved_search');
  return result.rows.map((row) => row.query);
}
