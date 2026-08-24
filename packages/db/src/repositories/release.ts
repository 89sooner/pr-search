/**
 * `release` 리포지터리 (ENT-REL-001, CR-028 DEV-142 / FR-REL-002, FR-SEQ-003 AC-1).
 *
 * **이 표가 릴리스의 정본이다** (ADR-004). 포함 판정과 릴리스 앵커 해석은 여기를
 * 읽고, `prs-releases`는 이 표의 투영이다 — 색인 반영이 실패해도 포함 목록이
 * 조용히 줄지 않는다 (DEV-130과 같은 원칙).
 *
 * 태그의 출처는 미러의 `refs/tags` 스냅숏이고(DEV-143), 갱신 잡은 그 스냅숏과
 * 이 표를 **diff**한다 — 원격에서 지워진 태그는 여기서도 지워진다.
 */

import type { Pool, PoolClient } from 'pg';

type Queryable = Pool | PoolClient;

export type ReleaseSource = 'git_tag' | 'github_release' | 'ci_deployment';

export interface ReleaseUpsert {
  readonly repository_id: number;
  readonly tag_name: string;
  readonly commit_sha: string;
  /** 체인 밖 태그면 셋 다 `null`이다 — 표시는 되지만 앵커·포함 판정에는 쓰이지 않는다. */
  readonly base_branch: string | null;
  readonly seq_epoch: number | null;
  readonly merge_seq: number | null;
  readonly released_at: Date;
  readonly source: ReleaseSource;
}

export interface ReleaseRow extends Omit<ReleaseUpsert, 'merge_seq'> {
  readonly release_id: string;
  readonly merge_seq: string | null;
  readonly synced_at: Date;
}

/**
 * 태그 하나를 기록하거나 갱신한다.
 *
 * `upsertMergeSequence`와 달리 **모든 열을 대입한다.** 서수는 불변이지만 태그는
 * 아니다 — 태그가 다른 커밋으로 강제 이동될 수 있고(원격의 사실), 에폭이 바뀌면
 * 서수가 재해석된다(DEV-149). 이 표는 "지금 원격이 말하는 것"을 비추는 표이지
 * 이력 표가 아니다. 조사 이력의 불변 근거는 `merge_sequence`가 갖는다.
 */
export async function upsertRelease(db: Queryable, release: ReleaseUpsert): Promise<void> {
  await db.query(
    `INSERT INTO release
       (repository_id, tag_name, commit_sha, base_branch, seq_epoch, merge_seq, released_at, source, synced_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
     ON CONFLICT (repository_id, tag_name) DO UPDATE SET
       commit_sha = EXCLUDED.commit_sha,
       base_branch = EXCLUDED.base_branch,
       seq_epoch = EXCLUDED.seq_epoch,
       merge_seq = EXCLUDED.merge_seq,
       released_at = EXCLUDED.released_at,
       source = EXCLUDED.source,
       synced_at = now()`,
    [
      release.repository_id,
      release.tag_name,
      release.commit_sha,
      release.base_branch,
      release.seq_epoch,
      release.merge_seq,
      release.released_at,
      release.source,
    ],
  );
}

/**
 * 스냅숏에 없는 태그를 지운다 (DEV-143 — 원격에서 지워진 태그의 반영).
 *
 * `ci_deployment`는 지우지 않는다 — 그 소스는 태그가 아니라서 미러 스냅숏에
 * 나타나지 않는 것이 정상이다 (OD-004 조건부, 지금은 쓰는 곳이 없다).
 *
 * @returns 지운 태그 이름들 — 색인에서 같은 문서를 지우는 데 그대로 쓴다.
 */
export async function deleteReleasesNotIn(
  db: Queryable,
  repositoryId: number,
  keepTagNames: readonly string[],
): Promise<string[]> {
  const result = await db.query<{ tag_name: string }>(
    `DELETE FROM release
      WHERE repository_id = $1
        AND source <> 'ci_deployment'
        AND NOT (tag_name = ANY($2::text[]))
      RETURNING tag_name`,
    [repositoryId, [...keepTagNames]],
  );
  return result.rows.map((row) => row.tag_name);
}

/** 저장소의 릴리스 전량. 갱신 잡의 diff와 투영이 쓴다. */
export async function listReleases(db: Queryable, repositoryId: number): Promise<ReleaseRow[]> {
  const result = await db.query<ReleaseRow>(
    'SELECT * FROM release WHERE repository_id = $1 ORDER BY released_at, tag_name',
    [repositoryId],
  );
  return result.rows;
}

/** 릴리스 앵커 해석 (FR-SEQ-003 AC-1). 태그 이름은 대소문자를 구분한다 — git이 그렇다. */
export async function findReleaseByTag(
  db: Queryable,
  repositoryId: number,
  tagName: string,
): Promise<ReleaseRow | undefined> {
  const result = await db.query<ReleaseRow>(
    'SELECT * FROM release WHERE repository_id = $1 AND tag_name = $2',
    [repositoryId, tagName],
  );
  return result.rows[0];
}

/** 저장소에 릴리스가 하나라도 있는가. `release_not_indexed` 판정의 근거다 (DEV-146). */
export async function hasAnyRelease(db: Queryable, repositoryId: number): Promise<boolean> {
  const result = await db.query<{ one: number }>(
    'SELECT 1 AS one FROM release WHERE repository_id = $1 LIMIT 1',
    [repositoryId],
  );
  return result.rows.length > 0;
}

/**
 * 대상을 포함하는 릴리스 (FR-REL-002 AC-5): 같은 공간에서 `release.merge_seq >= $4`.
 *
 * **에폭까지 좁힌다** (DEV-149). 재채번 직후 아직 재해석되지 않은 이전 에폭
 * 행의 서수는 다른 커밋을 가리킬 수 있다 — 그런 행으로 포함을 판정하면 틀린
 * 답이 오류 없이 나간다. 정렬은 시각 오름차순이다 (AC-3).
 */
export async function findContainingReleases(
  db: Queryable,
  repositoryId: number,
  baseBranch: string,
  seqEpoch: number,
  mergeSeq: number,
): Promise<ReleaseRow[]> {
  const result = await db.query<ReleaseRow>(
    `SELECT * FROM release
      WHERE repository_id = $1 AND base_branch = $2 AND seq_epoch = $3 AND merge_seq >= $4
      ORDER BY released_at, tag_name`,
    [repositoryId, baseBranch, seqEpoch, mergeSeq],
  );
  return result.rows;
}

/**
 * 공간의 마지막 릴리스 서수. 미배포 판정과 대기 PR 수 계산의 기준점이다 (AC-4).
 *
 * @returns 이 공간·에폭에 서수 있는 릴리스가 없으면 `null`.
 */
export async function findLatestReleaseSeq(
  db: Queryable,
  repositoryId: number,
  baseBranch: string,
  seqEpoch: number,
): Promise<number | null> {
  const result = await db.query<{ merge_seq: string }>(
    `SELECT max(merge_seq)::text AS merge_seq FROM release
      WHERE repository_id = $1 AND base_branch = $2 AND seq_epoch = $3 AND merge_seq IS NOT NULL`,
    [repositoryId, baseBranch, seqEpoch],
  );
  const seq = result.rows[0]?.merge_seq;
  return seq === undefined || seq === null ? null : Number(seq);
}
