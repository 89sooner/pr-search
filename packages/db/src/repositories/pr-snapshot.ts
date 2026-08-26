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
