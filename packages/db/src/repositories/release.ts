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
 * **서수는 저장 열이 아니라 현재 에폭 체인에서 다시 찾는다** (DEV-149, CR-030
 * DEV-160). 이유가 둘이다:
 *
 * - 이전 에폭 행의 서수는 다른 커밋을 가리킬 수 있다. 그런 값으로 판정하면 틀린
 *   답이 오류 없이 나간다.
 * - 동기화(JOB-REL-007)가 채번보다 먼저 돌면 표에는 `base_branch`·`merge_seq`가
 *   `NULL`인데 커밋은 이미 체인 위에 있다. 저장 열로 판정하면 **그 릴리스가 포함
 *   목록에서 통째로 빠지고**, 이미 배포된 PR이 "미배포"로 보인다. 앵커 해석은
 *   이미 다시 찾는데(DEV-149) 포함 판정만 저장 열을 읽고 있었다 — 같은 화면의
 *   두 답이 어긋나던 자리다.
 *
 * 정렬은 시각 오름차순이다 (AC-3).
 */
export async function findContainingReleases(
  db: Queryable,
  repositoryId: number,
  baseBranch: string,
  seqEpoch: number,
  mergeSeq: number,
): Promise<ReleaseRow[]> {
  const result = await db.query<ReleaseRow>(
    `SELECT rel.release_id, rel.repository_id, rel.tag_name, rel.commit_sha,
            $2::text AS base_branch, $3::int AS seq_epoch, ms.merge_seq::text AS merge_seq,
            rel.released_at, rel.source, rel.synced_at
       FROM release rel
       JOIN merge_sequence ms
         ON ms.repository_id = rel.repository_id
        AND ms.base_branch = $2
        AND ms.seq_epoch = $3
        AND ms.commit_sha = rel.commit_sha
      WHERE rel.repository_id = $1 AND ms.merge_seq >= $4
      ORDER BY rel.released_at, rel.tag_name`,
    [repositoryId, baseBranch, seqEpoch, mergeSeq],
  );
  return result.rows;
}

/** 공간의 마지막 릴리스 — 태그 이름과 **현재 에폭에서 다시 확인한** 서수. */
export interface LatestReleasePoint {
  readonly tag_name: string;
  readonly merge_seq: string;
}

/**
 * 공간의 마지막 릴리스 (API-SEQ-003의 `to=unreleased` 시작 앵커, CR-030 DEV-156).
 *
 * **저장된 `base_branch`·`merge_seq`를 조건으로 쓰지 않는다** (DEV-149). 동기화가
 * 채번보다 먼저 돌면 표에는 그 둘이 `NULL`인데 커밋은 이미 체인 위에 있고, 저장된
 * 값으로 고르면 **그 릴리스를 건너뛴 채** 더 오래된 릴리스가 미배포 구간의 시작이
 * 된다 — 이미 배포된 PR이 미배포로 세어진다. 타임라인(`listReleaseTimeline`)은
 * 서수를 다시 찾으므로, 여기서 다시 찾지 않으면 **같은 화면의 두 숫자가 어긋난다.**
 *
 * 그래서 판정은 하나뿐이다: 이 공간의 현재 에폭 체인에 커밋이 있는 태그 중 서수가
 * 가장 큰 것.
 *
 * 태그 이름을 함께 주는 이유는 미배포 구간의 방향 표기 때문이다 — "마지막 릴리스
 * 이후"라고만 적으면 그것이 무엇인지 화면에서 확인할 수 없다.
 */
export async function findLatestRelease(
  db: Queryable,
  repositoryId: number,
  baseBranch: string,
  seqEpoch: number,
): Promise<LatestReleasePoint | undefined> {
  const result = await db.query<LatestReleasePoint>(
    `SELECT rel.tag_name, ms.merge_seq::text AS merge_seq
       FROM release rel
       JOIN merge_sequence ms
         ON ms.repository_id = rel.repository_id
        AND ms.base_branch = $2
        AND ms.seq_epoch = $3
        AND ms.commit_sha = rel.commit_sha
      WHERE rel.repository_id = $1
      ORDER BY ms.merge_seq DESC
      LIMIT 1`,
    [repositoryId, baseBranch, seqEpoch],
  );
  return result.rows[0];
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
  // 판정은 `findLatestRelease` 하나뿐이다 (CR-030, DEV-160). 두 벌로 두면
  // 대기 수와 미배포 구간의 시작점이 서로 다른 릴리스를 기준으로 삼는다.
  const latest = await findLatestRelease(db, repositoryId, baseBranch, seqEpoch);
  return latest === undefined ? null : Number(latest.merge_seq);
}

/**
 * W-005 타임라인 한 행 (API-REL-005, CR-030 DEV-155).
 *
 * `merge_seq`는 **저장된 값이 아니라 현재 에폭에서 다시 확인한 값**이다 (DEV-149).
 * 확인되지 않으면 `null`이다 — 재채번 직후 아직 재해석되지 않았거나 체인 밖이다.
 */
export interface ReleaseTimelineRow {
  readonly tag_name: string;
  readonly commit_sha: string;
  readonly released_at: Date;
  readonly source: ReleaseSource;
  readonly base_branch: string | null;
  readonly seq_epoch: number | null;
  readonly merge_seq: string | null;
  readonly previous_tag_name: string | null;
  readonly pull_request_count_since_previous: string | null;
}

/**
 * 저장소의 릴리스 타임라인 (API-REL-005 / FR-SEQ-004).
 *
 * ## 왜 저장된 서수를 믿지 않는가
 *
 * 릴리스 서수는 에폭에 묶인 스냅숏이다 (DEV-149). 재채번이 에폭을 올리면 이전
 * 에폭의 서수는 다른 커밋을 가리킬 수 있으므로, **현재 에폭의 `merge_sequence`에서
 * `commit_sha`로 다시 찾아** 서수를 얻는다 — 앵커 해석이 표의 서수 대신
 * `findPointByCommit`을 다시 묻는 것과 같은 규칙이다. 탐색은 저장소의 시퀀스
 * 공간(스키마상 최대 10개)을 돌며 각각 유일 인덱스를 그대로 타고, 릴리스 행이
 * 적어 둔 브랜치를 먼저 본다. 브랜치도 그렇게 **다시 정한다**: 동기화가 채번보다
 * 먼저 돌면 표에는 `NULL`인데 커밋은 체인 위에 있다. 못 찾으면 `null`이다 —
 * 재채번 중에 틀린 서수를 조용히 보이는 것보다 서수가 없다고 말하는 쪽이 옳다.
 *
 * ## 왜 저장소 스코프인가
 *
 * 브랜치를 강제로 고정하면 "다른 대상 브랜치 릴리스 2건 선택"(FR-SEQ-004 AC-3)이
 * 만들어지지 않아 그 규칙을 검증할 길이 사라진다 (DEV-158). `branch`는 선택 필터다.
 *
 * ## "직전"은 시각이 아니라 서수다
 *
 * 태그는 나중에 옛 커밋을 가리키며 생길 수 있어 시각 순서와 서수 순서가 어긋나는데,
 * 구간은 서수로 잘린다. 그래서 `lag`를 **서수로** 매기고 비교 대상 태그명을 함께
 * 싣는다 — 화면이 무엇과 비교한 수인지 말할 수 있어야 한다.
 *
 * `pull_request_count_since_previous`는 서수 차가 아니라 반개구간
 * `(previous, current]`의 **PR 문서 수**다 (QA-W005-06). 직접 푸시 커밋이 섞이면
 * 두 값이 달라진다. 비교 대상이 없는 첫 릴리스는 `null`이다 — 0이 아니다.
 *
 * @param limit 페이지 크기. 절삭 판정을 위해 호출자가 `+1`을 넘긴다.
 */
export async function listReleaseTimeline(
  db: Queryable,
  repositoryId: number,
  branch: string | null,
  limit: number,
): Promise<ReleaseTimelineRow[]> {
  const result = await db.query<ReleaseTimelineRow>(
    `WITH resolved AS (
       SELECT rel.tag_name, rel.commit_sha, rel.released_at, rel.source,
              COALESCE(pt.base_branch, rel.base_branch) AS base_branch,
              pt.seq_epoch AS seq_epoch,
              pt.merge_seq AS merge_seq
         FROM release rel
         LEFT JOIN LATERAL (
           SELECT ms.base_branch, ms.seq_epoch, ms.merge_seq
             FROM sequence_space ss
             JOIN merge_sequence ms
               ON ms.repository_id = ss.repository_id
              AND ms.base_branch = ss.base_branch
              AND ms.seq_epoch = ss.seq_epoch
              AND ms.commit_sha = rel.commit_sha
            WHERE ss.repository_id = rel.repository_id
            ORDER BY (ss.base_branch IS NOT DISTINCT FROM rel.base_branch) DESC, ss.base_branch
            LIMIT 1
         ) pt ON true
        WHERE rel.repository_id = $1
     ),
     filtered AS (
       SELECT * FROM resolved
        WHERE $2::text IS NULL OR base_branch = $2::text
     ),
     windowed AS (
       SELECT f.*,
              lag(f.merge_seq) OVER w AS prev_seq,
              lag(f.tag_name)  OVER w AS prev_tag
         FROM filtered f
       WINDOW w AS (PARTITION BY f.base_branch ORDER BY f.merge_seq)
     ),
     page AS (
       SELECT * FROM windowed ORDER BY released_at DESC, tag_name ASC LIMIT $3::int
     )
     SELECT p.tag_name, p.commit_sha, p.released_at, p.source, p.base_branch,
            p.seq_epoch,
            p.merge_seq::text AS merge_seq,
            CASE WHEN p.merge_seq IS NULL THEN NULL ELSE p.prev_tag END AS previous_tag_name,
            CASE WHEN p.merge_seq IS NULL OR p.prev_seq IS NULL THEN NULL ELSE (
              SELECT count(DISTINCT ms2.pull_request_number)::text
                FROM merge_sequence ms2
               WHERE ms2.repository_id = $1
                 AND ms2.base_branch = p.base_branch
                 AND ms2.seq_epoch = p.seq_epoch
                 AND ms2.merge_seq > p.prev_seq
                 AND ms2.merge_seq <= p.merge_seq
                 AND ms2.pull_request_number IS NOT NULL
            ) END AS pull_request_count_since_previous
       FROM page p
      ORDER BY p.released_at DESC, p.tag_name ASC`,
    [repositoryId, branch, limit],
  );
  return result.rows;
}
