/**
 * 커밋 정본 스냅숏 (WP-067 / CR-038, DEV-208 / ADR-004).
 *
 * 커밋 자체의 메타데이터를 PostgreSQL에 남긴다. 그것이 없으면 메시지·작성자·부모·
 * 변경 경로가 **색인에만** 존재하고, 색인을 잃으면 되살릴 근거가 없다 — CR-034가
 * PR 축에서 겪은 결함(마이그레이션 010)과 같은 모양이다.
 *
 * ## 값이 불변이라 조건부 비교가 필요 없다
 *
 * 여기 담기는 것은 전부 커밋 객체가 가진 값이다. 같은 SHA면 언제 읽어도 같으므로
 * `pull_request_snapshot`과 달리 버전 비교가 필요 없다 — 그냥 덮어써도 결과가
 * 같다. 다만 **더 나은 출처가 나쁜 출처를 덮게** 두지는 않는다(아래 참조).
 */

import type { Pool, PoolClient } from 'pg';

type Queryable = Pool | PoolClient;

export type CommitMetadataSource = 'mirror' | 'api';

export interface CommitSnapshotInput {
  readonly repositoryId: number;
  readonly commitSha: string;
  readonly parentShas: readonly string[];
  readonly message: string;
  readonly author: string | null;
  readonly committer: string | null;
  readonly authoredAt: Date;
  readonly committedAt: Date;
  readonly changedPaths: readonly string[];
  readonly changedPathsTruncated: boolean;
  readonly patchId: string | null;
  readonly patchIdUnavailable: string | null;
  readonly metadataSource: CommitMetadataSource;
}

export interface CommitSnapshotRow {
  readonly repository_id: string;
  readonly commit_sha: string;
  readonly parent_shas: string[];
  readonly message: string;
  readonly author: string | null;
  readonly committer: string | null;
  readonly authored_at: Date;
  readonly committed_at: Date;
  readonly changed_paths: string[];
  readonly changed_paths_truncated: boolean;
  readonly patch_id: string | null;
  readonly patch_id_unavailable: string | null;
  readonly metadata_source: CommitMetadataSource;
  readonly projected_at: Date | null;
}

/**
 * 스냅숏을 남긴다.
 *
 * ## `patch_id`를 잃지 않는다
 *
 * 미러가 한 번 계산해 준 `patch_id`를, 나중에 API 폴백으로 돈 회차가 `no_mirror`로
 * **덮어쓰지 않는다.** 그 값은 이미 얻은 사실이고 API 경로는 그것을 계산할 수
 * 없을 뿐이다 — 능력이 없는 쪽이 있는 쪽을 지우면 체리픽 파생(WP-030)이 근거를
 * 잃는다. 나머지 필드는 두 경로가 같은 값을 내므로 그대로 덮는다.
 */
export async function upsertCommitSnapshot(db: Queryable, input: CommitSnapshotInput): Promise<void> {
  await db.query(
    `INSERT INTO commit_snapshot
       (repository_id, commit_sha, parent_shas, message, author, committer,
        authored_at, committed_at, changed_paths, changed_paths_truncated,
        patch_id, patch_id_unavailable, metadata_source, fetched_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, now())
     ON CONFLICT (repository_id, commit_sha) DO UPDATE
       SET parent_shas             = EXCLUDED.parent_shas,
           message                 = EXCLUDED.message,
           author                  = EXCLUDED.author,
           committer               = EXCLUDED.committer,
           authored_at             = EXCLUDED.authored_at,
           committed_at            = EXCLUDED.committed_at,
           changed_paths           = EXCLUDED.changed_paths,
           changed_paths_truncated = EXCLUDED.changed_paths_truncated,
           -- 이미 얻은 patch_id를 못 얻는 경로가 지우지 않는다.
           patch_id                = COALESCE(EXCLUDED.patch_id, commit_snapshot.patch_id),
           patch_id_unavailable    = CASE
                                       WHEN EXCLUDED.patch_id IS NOT NULL THEN NULL
                                       WHEN commit_snapshot.patch_id IS NOT NULL THEN NULL
                                       ELSE EXCLUDED.patch_id_unavailable
                                     END,
           metadata_source         = EXCLUDED.metadata_source,
           fetched_at              = now(),
           -- 정본이 다시 쓰였으면 색인은 아직 그 값을 모른다. 투영이 성공할 때
           -- 다시 찍힌다 (CR-038 / PR #42 리뷰).
           projected_at            = NULL`,
    [
      input.repositoryId,
      input.commitSha,
      [...input.parentShas],
      input.message,
      input.author,
      input.committer,
      input.authoredAt,
      input.committedAt,
      [...input.changedPaths],
      input.changedPathsTruncated,
      input.patchId,
      input.patchIdUnavailable,
      input.metadataSource,
    ],
  );
}

/** 한 커밋의 정본. 재구성과 API 응답이 같은 것을 읽는다. */
export async function findCommitSnapshot(
  db: Queryable,
  repositoryId: number,
  commitSha: string,
): Promise<CommitSnapshotRow | undefined> {
  const result = await db.query<CommitSnapshotRow>(
    'SELECT * FROM commit_snapshot WHERE repository_id = $1 AND commit_sha = $2',
    [repositoryId, commitSha.toLowerCase()],
  );
  return result.rows[0];
}

/**
 * 여러 커밋의 정본을 **한 번에** 읽는다 (CR-038, DEV-211·212).
 *
 * PR 상세의 `source_commits`(최대 250)와 선행·후행 목록이 이것을 쓴다. 하나씩
 * 조회하면 N+1이고, 그 비용은 목록 길이에 비례해 사용자에게 그대로 간다.
 */
export async function listCommitSnapshots(
  db: Queryable,
  repositoryId: number,
  shas: readonly string[],
): Promise<readonly CommitSnapshotRow[]> {
  if (shas.length === 0) return [];
  const result = await db.query<CommitSnapshotRow>(
    'SELECT * FROM commit_snapshot WHERE repository_id = $1 AND commit_sha = ANY($2::text[])',
    [repositoryId, shas.map((sha) => sha.toLowerCase())],
  );
  return result.rows;
}

/**
 * 아직 정본이 없는 first-parent 커밋 (WP-067 스윕).
 *
 * `merge_sequence`가 **현재 에폭의** first-parent 체인을 전부 알고 있으므로 그것이
 * 기준이다 — 직접 푸시 커밋도 여기 들어 있다. 이미 스냅숏이 있는 것은 건너뛴다.
 */
export async function listCommitsMissingSnapshot(
  db: Queryable,
  limit: number,
): Promise<readonly { readonly repository_id: string; readonly commit_sha: string; readonly base_branch: string; readonly pull_request_number: number | null }[]> {
  const result = await db.query<{
    repository_id: string;
    commit_sha: string;
    base_branch: string;
    pull_request_number: number | null;
  }>(
    `SELECT ms.repository_id, ms.commit_sha, ms.base_branch, ms.pull_request_number
       FROM merge_sequence ms
       JOIN sequence_space ss
         ON ss.repository_id = ms.repository_id
        AND ss.base_branch = ms.base_branch
        AND ss.seq_epoch = ms.seq_epoch
       LEFT JOIN commit_snapshot cs
         ON cs.repository_id = ms.repository_id
        AND cs.commit_sha = ms.commit_sha
      WHERE cs.commit_sha IS NULL
      ORDER BY ms.repository_id, ms.merge_seq
      LIMIT $1`,
    [limit],
  );
  return result.rows;
}

/**
 * 색인 투영이 성공했음을 기록한다 (CR-038 / PR #42 리뷰).
 *
 * **정본을 색인보다 먼저 쓰므로**, 색인 쓰기가 실패한 커밋은 스냅숏만 남는다.
 * 스윕이 "스냅숏이 없는 커밋"만 찾으면 그 커밋은 영원히 재시도되지 않는다 —
 * 다시 투영할 다른 경로도 없다. 이 표식이 그 구멍을 막는다.
 */
export async function markCommitProjected(
  db: Queryable,
  repositoryId: number,
  commitSha: string,
  at: Date,
): Promise<void> {
  await db.query(
    'UPDATE commit_snapshot SET projected_at = $3 WHERE repository_id = $1 AND commit_sha = $2',
    [repositoryId, commitSha.toLowerCase(), at],
  );
}

/**
 * 정본은 있으나 **색인 투영이 밀린** 커밋 (CR-038 / PR #42 리뷰).
 *
 * Elasticsearch 장애 중에 보강된 커밋들이 여기 쌓인다. 스윕이 이것도 함께 집어야
 * 장애가 끝난 뒤 스스로 회복한다.
 */
export async function listCommitsMissingProjection(
  db: Queryable,
  limit: number,
): Promise<readonly { readonly repository_id: string; readonly commit_sha: string; readonly base_branch: string; readonly pull_request_number: number | null }[]> {
  const result = await db.query<{
    repository_id: string;
    commit_sha: string;
    base_branch: string;
    pull_request_number: number | null;
  }>(
    `SELECT cs.repository_id, cs.commit_sha,
            COALESCE(ms.base_branch, '') AS base_branch,
            ms.pull_request_number
       FROM commit_snapshot cs
       LEFT JOIN merge_sequence ms
         ON ms.repository_id = cs.repository_id
        AND ms.commit_sha = cs.commit_sha
      WHERE cs.projected_at IS NULL
      ORDER BY cs.repository_id, cs.commit_sha
      LIMIT $1`,
    [limit],
  );
  return result.rows;
}
