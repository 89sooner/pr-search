/**
 * PR 정본 스냅숏 (CR-034, DEV-184 / ADR-004).
 *
 * 투영이 만든 문서를 PostgreSQL에 남긴다. 백필·조정 스캔은 GHE에서 직접 읽어
 * Elasticsearch에만 쓰므로 `raw_event` 근거가 없고, 그 PR들은 색인을 잃으면
 * 되살릴 길이 없었다 — **어떤 데이터도 검색 인덱스에만 존재해서는 안 된다**는
 * ADR-004의 불변식이 그 경로에서 깨져 있었다.
 */

import type { Pool, PoolClient } from 'pg';

type Queryable = Pool | PoolClient;

export type SnapshotSource = 'webhook' | 'backfill' | 'reconcile';

export interface PullRequestSnapshotInput {
  readonly repositoryId: number;
  readonly prNumber: number;
  readonly documentVersion: number;
  readonly source: SnapshotSource;
  readonly document: Readonly<Record<string, unknown>>;
}

export interface PullRequestSnapshotRow {
  readonly repository_id: string;
  readonly pr_number: number;
  readonly document_version: string;
  readonly source: SnapshotSource;
  readonly document: Record<string, unknown>;
}

/**
 * 스냅숏을 남긴다. **조건부다** — 더 낮은 버전은 이기지 못한다.
 *
 * Elasticsearch 업서트와 **같은 버전 규칙**을 쓴다 (DEV-099). 그래서 오래된
 * 백필이 최신 웹훅을 덮어쓰지 않고, 같은 PR을 몇 번 다시 처리해도 결과가 같다.
 *
 * @returns 실제로 갱신됐으면 `true`. 더 낮은 버전이라 무시됐으면 `false`.
 */
export async function upsertPullRequestSnapshot(
  db: Queryable,
  input: PullRequestSnapshotInput,
): Promise<boolean> {
  const result = await db.query(
    `INSERT INTO pull_request_snapshot
       (repository_id, pr_number, document_version, source, document, updated_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, now())
     ON CONFLICT (repository_id, pr_number) DO UPDATE
       SET document_version = EXCLUDED.document_version,
           source           = EXCLUDED.source,
           document         = EXCLUDED.document,
           updated_at       = now()
       WHERE pull_request_snapshot.document_version <= EXCLUDED.document_version`,
    [input.repositoryId, input.prNumber, input.documentVersion, input.source, JSON.stringify(input.document)],
  );
  return (result.rowCount ?? 0) > 0;
}

/** 저장소의 스냅숏을 PR 번호 내림차순으로. 정합성 대조의 표본이다. */
export async function listSnapshots(
  db: Queryable,
  repositoryId: number,
  limit: number,
): Promise<readonly PullRequestSnapshotRow[]> {
  const result = await db.query<PullRequestSnapshotRow>(
    `SELECT repository_id, pr_number, document_version, source, document
       FROM pull_request_snapshot
      WHERE repository_id = $1
      ORDER BY pr_number DESC
      LIMIT $2`,
    [repositoryId, limit],
  );
  return result.rows;
}

/**
 * 재파생용 열거 (JOB-REL-006 / CR-039, DEV-221).
 *
 * **`pr_number` 오름차순 + 커서**다. `updated_at` 정렬은 스캔 중 갱신된 항목을
 * 끝으로 옮기고 뒤 항목을 이미 지나온 페이지로 당긴다 — 완결 표시를 찍는 잡에서
 * 그 건너뜀은 곧 영구 누락이다 (DEV-204와 같은 이유). `pr_number`는 저장소 안에서
 * 불변이라 커서가 안정적이다.
 */
export async function listSnapshotsAfter(
  db: Queryable,
  repositoryId: number,
  afterPrNumber: number,
  limit: number,
): Promise<readonly PullRequestSnapshotRow[]> {
  const result = await db.query<PullRequestSnapshotRow>(
    `SELECT repository_id, pr_number, document_version, source, document
       FROM pull_request_snapshot
      WHERE repository_id = $1 AND pr_number > $2
      ORDER BY pr_number ASC
      LIMIT $3`,
    [repositoryId, afterPrNumber, limit],
  );
  return result.rows;
}

/** 저장소가 정본으로 아는 PR 수. */
export async function countSnapshots(db: Queryable, repositoryId: number): Promise<number> {
  const result = await db.query<{ count: string }>(
    'SELECT count(*)::text AS count FROM pull_request_snapshot WHERE repository_id = $1',
    [repositoryId],
  );
  return Number(result.rows[0]?.count ?? 0);
}

/* ------------------------------------------------------------------------- */
/* 관계 후보 조회 (WP-030 / CR-041, DEV-240)                                   */
/* ------------------------------------------------------------------------- */

/**
 * 제목이 일치하는 PR — 되돌림 제목 대조 후보 (FR-REL-004 AC-1).
 *
 * **후보를 하나로 좁히지 않는다.** 2건 이상이면 전부 돌려주고, 호출 측이 전부
 * 저장한다 (예외 처리, DEV-237). `LIMIT`은 폭주 방지이지 선택이 아니다.
 */
export async function findPullRequestsByTitle(
  db: Queryable,
  repositoryId: number,
  title: string,
  limit: number,
): Promise<readonly PullRequestSnapshotRow[]> {
  const result = await db.query<PullRequestSnapshotRow>(
    `SELECT repository_id, pr_number, document_version, source, document
       FROM pull_request_snapshot
      WHERE repository_id = $1 AND document ->> 'title' = $2
      ORDER BY pr_number ASC
      LIMIT $3`,
    [repositoryId, title, limit],
  );
  return result.rows;
}

/**
 * `head_branch`가 일치하는 **열린** PR — 스택 상위 후보 (FR-REL-006).
 *
 * 요구사항 문장이 "다른 **열린** PR"이므로 상태 조건이 질의에 있다. 부분 인덱스
 * (`pull_request_snapshot_open_head_idx`)와 같은 술어를 쓴다.
 *
 * **후보가 여럿일 수 있다** (DEV-244). 계약이 `head_branch` 유일성을 보장하지
 * 않으므로 첫 결과로 좁히지 않는다 — 실제 의존 하나가 조용히 사라진다.
 */
export async function findOpenPullRequestsByHeadBranch(
  db: Queryable,
  repositoryId: number,
  headBranch: string,
  limit: number,
): Promise<readonly PullRequestSnapshotRow[]> {
  const result = await db.query<PullRequestSnapshotRow>(
    `SELECT repository_id, pr_number, document_version, source, document
       FROM pull_request_snapshot
      WHERE repository_id = $1
        AND document ->> 'head_branch' = $2
        AND document ->> 'state' = 'open'
      ORDER BY pr_number ASC
      LIMIT $3`,
    [repositoryId, headBranch, limit],
  );
  return result.rows;
}

/**
 * `base_branch`가 이 분기인 PR — **스택 하위(child) 역방향 후보** (DEV-232).
 *
 * 상위 PR이 머지·종료·retarget될 때 바뀌어야 하는 것은 **하위 PR의 간선**인데,
 * 하위 PR에는 그때 아무 이벤트도 오지 않는다. 이 조회가 그 역방향의 경계다 —
 * 없으면 저장소 전량 스캔이거나, 더 나쁘게는 재평가 자체를 하지 않게 된다.
 *
 * 상태로 거르지 않는다. 닫힌 하위 PR의 간선도 `detached` 판정 대상이다.
 */
export async function findPullRequestsByBaseBranch(
  db: Queryable,
  repositoryId: number,
  baseBranch: string,
  limit: number,
): Promise<readonly PullRequestSnapshotRow[]> {
  const result = await db.query<PullRequestSnapshotRow>(
    `SELECT repository_id, pr_number, document_version, source, document
       FROM pull_request_snapshot
      WHERE repository_id = $1 AND document ->> 'base_branch' = $2
      ORDER BY pr_number ASC
      LIMIT $3`,
    [repositoryId, baseBranch, limit],
  );
  return result.rows;
}

/** 한 PR의 정본 스냅숏. 없으면 `undefined` — 실패가 아니다. */
export async function findPullRequestSnapshot(
  db: Queryable,
  repositoryId: number,
  prNumber: number,
): Promise<PullRequestSnapshotRow | undefined> {
  const result = await db.query<PullRequestSnapshotRow>(
    `SELECT repository_id, pr_number, document_version, source, document
       FROM pull_request_snapshot
      WHERE repository_id = $1 AND pr_number = $2`,
    [repositoryId, prNumber],
  );
  return result.rows[0];
}

/**
 * 머지 커밋 SHA로 스냅숏 후보를 찾는다 (WP-074 / 상세 설계 5.1의 1).
 *
 * `pull_request_snapshot_merge_commit_idx`(표현식 인덱스, 마이그레이션 025)가 받는다.
 * **후보다** — 확정은 호출 측이 원본 PR 상세 또는 문서 필드 대조로 한다. 상한을 두는
 * 이유는 같은 SHA를 가리키는 스냅숏이 둘 이상이면 그것이 곧 `mapping_conflict`
 * 후보이기 때문이다.
 */
export async function findSnapshotsByMergeCommit(
  db: Queryable,
  repositoryId: number,
  mergeCommitSha: string,
  limit = 5,
): Promise<readonly PullRequestSnapshotRow[]> {
  const result = await db.query<PullRequestSnapshotRow>(
    `SELECT repository_id, pr_number, document_version, source, document
       FROM pull_request_snapshot
      WHERE repository_id = $1 AND document ->> 'merge_commit_sha' = $2
      ORDER BY pr_number ASC
      LIMIT $3`,
    [repositoryId, mergeCommitSha.toLowerCase(), limit],
  );
  return result.rows;
}
