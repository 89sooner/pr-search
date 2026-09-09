/** WP-044 / FR-SRCH-012. Job and request are inserted in one transaction. */
import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { withTransaction } from '../pool.js';
import { enqueueJob } from './job.js';

export interface ExportRecord {
  readonly job_id: number;
  readonly user_id: string;
  readonly scope_version: number;
  readonly repository_ids: number[];
  readonly format: 'csv' | 'json';
  readonly plan: Record<string, unknown>;
  readonly content: string | null;
  readonly row_count: number | null;
}
export async function createExport(pool: Pool, input: Omit<ExportRecord, 'job_id' | 'content' | 'row_count'>): Promise<number> {
  return withTransaction(pool, async (db) => {
    const id = await enqueueJob(db, 'export', randomUUID(), input.user_id);
    await db.query(`INSERT INTO search_export (job_id,user_id,scope_version,repository_ids,format,plan)
      VALUES ($1,$2,$3,$4,$5,$6)`, [id, input.user_id, input.scope_version, input.repository_ids, input.format, JSON.stringify(input.plan)]);
    return id;
  });
}
export async function findExport(pool: Pool, id: number): Promise<ExportRecord | undefined> {
  return (await pool.query<ExportRecord>('SELECT * FROM search_export WHERE job_id=$1', [id])).rows[0];
}
export async function assertExportScope(pool: Pool | PoolClient, row: Pick<ExportRecord, 'user_id' | 'scope_version' | 'plan'>): Promise<void> {
  const result = await pool.query('SELECT 1 FROM app_user WHERE user_id=$1 AND access_scope_version=$2', [row.user_id, row.scope_version]);
  if (result.rowCount !== 1) throw new Error('export_scope_changed');
  const context = row.plan['sequenceContext'] as { repository: string; base_branch: string; seq_epoch: number } | undefined;
  if (context !== undefined) {
    const epoch = await pool.query(`SELECT 1 FROM sequence_space s JOIN repository r USING (repository_id)
      WHERE r.owner || '/' || r.name=$1 AND s.base_branch=$2 AND s.seq_epoch=$3 AND s.state='ok'`,
    [context.repository, context.base_branch, context.seq_epoch]);
    if (epoch.rowCount !== 1) throw new Error('export_epoch_changed');
  }
}
export async function publishExport(pool: Pool, row: ExportRecord, content: string, count: number): Promise<boolean> {
  return withTransaction(pool, async (db) => {
    const active = await db.query(`SELECT 1 FROM job WHERE job_id=$1 AND state='running' FOR UPDATE`, [row.job_id]);
    if (active.rowCount !== 1) return false;
    const scope = await db.query(`SELECT 1 FROM app_user WHERE user_id=$1 AND access_scope_version=$2 FOR SHARE`, [row.user_id, row.scope_version]);
    if (scope.rowCount !== 1) throw new Error('export_scope_changed');
    await assertExportScope(db, row);
    await db.query('UPDATE search_export SET content=$2,row_count=$3 WHERE job_id=$1', [row.job_id, content, count]);
    await db.query(`UPDATE job SET state='completed',finished_at=now(),progress=$2 WHERE job_id=$1`, [row.job_id, JSON.stringify({ processed: count })]);
    return true;
  });
}
