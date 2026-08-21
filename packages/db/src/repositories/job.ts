/**
 * `job` 리포지터리 (ENT-ING-004, FR-ADMIN-002·FR-ING-006).
 *
 * 같은 `(type, target)`에 활성 잡은 동시에 하나뿐이다. 이 제약은 부분 유니크
 * 인덱스가 DB에서 강제하므로, 애플리케이션이 먼저 검사하지 않아도 경합에서
 * 두 개가 뜨지 않는다 (FR-ADMIN-002 AC-4).
 */

import type { Pool, PoolClient } from 'pg';

export type JobType =
  | 'backfill'
  | 'reconcile'
  | 'reindex'
  | 'sequence_assign'
  | 'sequence_integrity'
  | 'link_rebuild'
  | 'export';

export type JobState = 'queued' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';

/** 이 상태들에 대해서만 `job_active_uk` 부분 유니크 인덱스가 걸린다. */
export const ACTIVE_JOB_STATES: readonly JobState[] = ['queued', 'running', 'paused'];

export interface JobRow {
  /**
   * `BIGSERIAL`이라 int8이고, `@prs/db`의 타입 파서가 숫자로 준다 (CR-013,
   * DEV-027). 선언을 `string`으로 두면 타입만 문자열이고 런타임 값은 숫자인
   * 상태가 되어 `===` 비교와 JSON 직렬화가 조용히 어긋난다 — 실제로 WP-010의
   * 등록 응답이 `backfill_job_id`를 내보내면서 드러났다.
   */
  readonly job_id: number;
  readonly type: JobType;
  readonly target: string;
  readonly state: JobState;
  readonly progress: Record<string, unknown>;
  readonly cursor: Record<string, unknown> | null;
  readonly requested_by: string;
  readonly started_at: Date | null;
  readonly finished_at: Date | null;
  readonly error: string | null;
}

type Queryable = Pool | PoolClient;

/** 잡을 큐에 넣는다. 같은 대상에 활성 잡이 있으면 유니크 위반이 발생한다. */
export async function enqueueJob(
  db: Queryable,
  type: JobType,
  target: string,
  requestedBy: string,
): Promise<number> {
  const result = await db.query<{ job_id: number }>(
    `INSERT INTO job (type, target, state, requested_by)
     VALUES ($1, $2, 'queued', $3)
     RETURNING job_id`,
    [type, target, requestedBy],
  );

  const jobId = result.rows[0]?.job_id;
  if (jobId === undefined) throw new Error('잡 생성이 job_id를 반환하지 않았다');
  return jobId;
}

export async function findActiveJob(
  db: Queryable,
  type: JobType,
  target: string,
): Promise<JobRow | undefined> {
  const result = await db.query<JobRow>(
    `SELECT * FROM job
      WHERE type = $1 AND target = $2 AND state IN ('queued', 'running', 'paused')`,
    [type, target],
  );
  return result.rows[0];
}

/** 진행률과 재개 지점을 기록한다. `cursor`가 있어야 중단 후 이어서 실행된다 (FR-ING-006 AC-4). */
export async function updateJobProgress(
  db: Queryable,
  jobId: number,
  progress: Record<string, unknown>,
  cursor: Record<string, unknown> | null,
): Promise<void> {
  await db.query('UPDATE job SET progress = $2, cursor = $3 WHERE job_id = $1', [
    jobId,
    JSON.stringify(progress),
    cursor === null ? null : JSON.stringify(cursor),
  ]);
}

export async function finishJob(
  db: Queryable,
  jobId: number,
  state: Extract<JobState, 'completed' | 'failed' | 'cancelled'>,
  error: string | null = null,
): Promise<void> {
  await db.query('UPDATE job SET state = $2, finished_at = now(), error = $3 WHERE job_id = $1', [
    jobId,
    state,
    error,
  ]);
}
