/**
 * `repository` 리포지터리 (ENT-CORE-001, FR-ING-009).
 */

import type { Pool, PoolClient } from 'pg';

export interface RepositoryRow {
  readonly repository_id: number;
  readonly owner: string;
  readonly name: string;
  readonly org_id: number;
  readonly visibility: 'public' | 'internal' | 'private';
  readonly sequence_branches: string[];
  readonly mirror_enabled: boolean;
  readonly status: 'active' | 'archived';
}

type Queryable = Pool | PoolClient;

/** 저장소를 등록하거나 갱신한다. 시퀀스 대상 브랜치는 최대 10개다 (FR-ING-009 AC-2). */
export async function upsertRepository(
  db: Queryable,
  repository: Omit<RepositoryRow, 'mirror_enabled' | 'status'> &
    Partial<Pick<RepositoryRow, 'mirror_enabled' | 'status'>>,
): Promise<void> {
  await db.query(
    `INSERT INTO repository
       (repository_id, owner, name, org_id, visibility, sequence_branches, mirror_enabled, status)
     VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, true), COALESCE($8, 'active'))
     ON CONFLICT (repository_id) DO UPDATE SET
       owner = EXCLUDED.owner,
       name = EXCLUDED.name,
       org_id = EXCLUDED.org_id,
       visibility = EXCLUDED.visibility,
       sequence_branches = EXCLUDED.sequence_branches,
       mirror_enabled = EXCLUDED.mirror_enabled,
       status = EXCLUDED.status`,
    [
      repository.repository_id,
      repository.owner,
      repository.name,
      repository.org_id,
      repository.visibility,
      repository.sequence_branches,
      repository.mirror_enabled ?? null,
      repository.status ?? null,
    ],
  );
}

export async function findRepositoryById(db: Queryable, repositoryId: number): Promise<RepositoryRow | undefined> {
  const result = await db.query<RepositoryRow>('SELECT * FROM repository WHERE repository_id = $1', [
    repositoryId,
  ]);
  return result.rows[0];
}

export async function listActiveRepositories(db: Queryable): Promise<RepositoryRow[]> {
  const result = await db.query<RepositoryRow>(
    "SELECT * FROM repository WHERE status = 'active' ORDER BY owner, name",
  );
  return result.rows;
}
