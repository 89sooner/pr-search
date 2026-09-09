/** JOB-SRCH-001 / WP-044: restartable batch, complete-file publication only. */
import { jobRepo, searchExportRepo, type Pool } from '@prs/db';
import { collectExport, serializeExport, type ExportPlan } from '@prs/es';
import type { Client } from '@elastic/elasticsearch';

export interface ExportDeps { readonly pool: Pool; readonly es: Client; readonly log: (entry: Record<string, unknown>) => void }
export async function runExportJob(deps: ExportDeps): Promise<boolean> {
  // A killed worker cannot publish an artifact; stale claims eventually fail closed.
  await deps.pool.query(`UPDATE job SET state='failed',finished_at=now(),error='export_timeout'
    WHERE type='export' AND state='running' AND started_at < now() - interval '30 minutes'`);
  const job = await jobRepo.claimNextJob(deps.pool, 'export');
  if (job === undefined) return false;
  try {
    const row = await searchExportRepo.findExport(deps.pool, job.job_id);
    if (row === undefined) throw new Error('export_request_missing');
    const deadline = Date.now() + 30 * 60_000;
    const check = async (): Promise<void> => {
      if (Date.now() > deadline) throw new Error('export_timeout');
      if (!(await jobRepo.isJobRunning(deps.pool, job.job_id))) throw new Error('export_interrupted');
      await searchExportRepo.assertExportScope(deps.pool, row);
    };
    const rows = await collectExport(deps.es, row.plan as unknown as ExportPlan, check);
    await check();
    await searchExportRepo.publishExport(deps.pool, row, serializeExport(rows, row.format), rows.length);
  } catch (error) {
    const reason = error instanceof Error && ['export_scope_changed', 'export_epoch_changed', 'export_timeout', 'export_limit_exceeded', 'export_interrupted'].includes(error.message) ? error.message : 'export_failed';
    await jobRepo.finishJobIfRunning(deps.pool, job.job_id, 'failed', reason);
    deps.log({ level: 'warn', job: 'JOB-SRCH-001', job_id: job.job_id, reason });
  }
  return true;
}
export function startExportRunner(deps: ExportDeps): { stop(): Promise<void> } {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running: Promise<void> = Promise.resolve();
  const tick = (): void => {
    running = runExportJob(deps).then(() => undefined).catch(() => { deps.log({ level: 'error', job: 'JOB-SRCH-001', reason: 'export_runner_failed' }); }).finally(() => {
      if (!stopped) { timer = setTimeout(tick, 1000); timer.unref(); }
    });
  };
  tick();
  return { async stop() { stopped = true; clearTimeout(timer); await running; } };
}
