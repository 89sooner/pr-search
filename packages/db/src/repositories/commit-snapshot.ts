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
 * 재파생용 열거 (JOB-REL-006 / CR-039, DEV-221).
 *
 * **`commit_sha` 오름차순 + 커서**다. SHA는 불변이라 스캔 도중 행이 갱신돼도
 * 자리가 바뀌지 않는다 — 완결을 찍는 잡이 건너뛰지 않는 유일한 조건이다.
 */
export async function listCommitSnapshotsAfter(
  db: Queryable,
  repositoryId: number,
  afterSha: string,
  limit: number,
): Promise<readonly CommitSnapshotRow[]> {
  const result = await db.query<CommitSnapshotRow>(
    `SELECT * FROM commit_snapshot
      WHERE repository_id = $1 AND commit_sha > $2
      ORDER BY commit_sha ASC
      LIMIT $3`,
    [repositoryId, afterSha, limit],
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

/* ------------------------------------------------------------------------- */
/* 관계 후보 조회 (WP-030 / CR-041, DEV-240)                                   */
/* ------------------------------------------------------------------------- */

/**
 * 같은 저장소에서 같은 `patch_id`를 가진 커밋 (FR-REL-005 AC-2·AC-3·AC-4).
 *
 * ## 동일 저장소 한정을 질의가 강제한다
 *
 * AC-3의 "동일 저장소 안으로 한정"을 호출 측 필터로 미루지 않는다. 그 한 줄이
 * 사라지는 순간 저장소 간 간선이 **조용히** 생기고, 그것은 접근 범위가 다른
 * 저장소의 내용을 잇는 것이다. 조건이 `WHERE`에 있으면 변이가 시험에 걸린다.
 *
 * ## 순서는 결정론이다 (DEV-243)
 *
 * `committed_at` 내림차순 + 동률 시 `commit_sha` 오름차순. 상위 5건이 회차마다
 * 달라지면 같은 정본에서 다른 색인이 나와 ADR-004의 재구축 증명이 깨진다.
 * 인덱스(`commit_snapshot_patch_candidate_idx`)가 이 순서를 그대로 담는다.
 *
 * `self`는 제외한다 — 자기 자신은 후보가 아니다.
 */
export async function findCommitsByPatchId(
  db: Queryable,
  repositoryId: number,
  patchId: string,
  selfSha: string,
  limit: number,
): Promise<readonly CommitSnapshotRow[]> {
  const result = await db.query<CommitSnapshotRow>(
    `SELECT * FROM commit_snapshot
      WHERE repository_id = $1 AND patch_id = $2 AND commit_sha <> $3
      ORDER BY committed_at DESC, commit_sha ASC
      LIMIT $4`,
    [repositoryId, patchId, selfSha, limit],
  );
  return result.rows;
}

/**
 * 제목(메시지 첫 줄)이 일치하는 커밋 — 되돌림 제목 대조 후보 (FR-REL-004 AC-1).
 *
 * 식(`split_part(message, E'\n', 1)`)이 인덱스와 **정확히 같아야** 한다. 한쪽만
 * 바꾸면 인덱스가 조용히 무시되고 저장소 전체 스캔이 된다.
 *
 * **후보를 하나로 좁히지 않는다.** 2건 이상이면 전부 돌려준다 — 고르는 것은
 * 이 함수의 일이 아니고, 애초에 골라서는 안 된다 (DEV-237).
 */
export async function findCommitsBySubject(
  db: Queryable,
  repositoryId: number,
  subject: string,
  limit: number,
): Promise<readonly CommitSnapshotRow[]> {
  const result = await db.query<CommitSnapshotRow>(
    `SELECT * FROM commit_snapshot
      WHERE repository_id = $1 AND split_part(message, E'\n', 1) = $2
      ORDER BY committed_at DESC, commit_sha ASC
      LIMIT $3`,
    [repositoryId, subject, limit],
  );
  return result.rows;
}

/**
 * 이 커밋을 되돌림 대상으로 삼을 수 있는 **다른 커밋들** (역방향 후보, DEV-242).
 *
 * 트레일러는 40자 SHA를 본문에 그대로 적으므로 문자열 포함으로 찾는다. 인덱스가
 * 없는 조회이므로 **저장소 범위 + 상한**으로 경계를 만든다 — 이 경로는 커밋
 * 하나가 새로 준비됐을 때만 돈다.
 */
export async function findCommitsRevertingSha(
  db: Queryable,
  repositoryId: number,
  sha: string,
  limit: number,
): Promise<readonly CommitSnapshotRow[]> {
  const result = await db.query<CommitSnapshotRow>(
    `SELECT * FROM commit_snapshot
      WHERE repository_id = $1 AND commit_sha <> $2 AND position($2 in lower(message)) > 0
      ORDER BY commit_sha ASC
      LIMIT $3`,
    [repositoryId, sha.toLowerCase(), limit],
  );
  return result.rows;
}
