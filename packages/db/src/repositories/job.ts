/**
 * `job` 리포지터리 (ENT-ING-004, FR-ADMIN-002·FR-ING-006).
 *
 * 같은 `(type, target)`에 활성 잡은 동시에 하나뿐이다. 이 제약은 부분 유니크
 * 인덱스가 DB에서 강제하므로, 애플리케이션이 먼저 검사하지 않아도 경합에서
 * 두 개가 뜨지 않는다 (FR-ADMIN-002 AC-4).
 */

import type { Pool, PoolClient } from 'pg';

import { advisoryXactLock, jobClaimLockKey } from '../advisory-lock.js';

export type JobType =
  | 'backfill'
  | 'reconcile'
  | 'reindex'
  | 'sequence_assign'
  /** 수동 재채번 (API-ADM-007). 마이그레이션 009가 CHECK에 더했다 (CR-033, DEV-172). */
  | 'sequence_reassign'
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

/**
 * 잡을 **`running`일 때만** 종료 상태로 옮긴다 (CR-037, DEV-196).
 *
 * ## 왜 조건부여야 하나
 *
 * `finishJob`은 무조건 UPDATE라, 운영자가 실행 중 잡을 `cancelled`로 바꿔도
 * 러너가 완료 시점에 그것을 `completed`로 되돌린다 — **취소가 반영되지 않는다.**
 *
 * 읽고 나서 쓰는 방식(`if (state !== 'cancelled') finishJob(...)`)으로는 못 고친다.
 * 읽기와 쓰기 사이에 취소가 들어오면 같은 경주가 그대로 남는다. 전이 조건을
 * **UPDATE의 WHERE 절에** 두어야 데이터베이스가 한 번에 판정한다.
 *
 * @returns 실제로 옮겼으면 `true`. 이미 다른 상태(대개 `cancelled`)면 `false`이며,
 *   **그때 호출부는 아무것도 덮어쓰지 않는다.**
 */
export async function finishJobIfRunning(
  db: Queryable,
  jobId: number,
  state: Extract<JobState, 'completed' | 'failed'>,
  error: string | null = null,
): Promise<boolean> {
  const result = await db.query(
    `UPDATE job SET state = $2, finished_at = now(), error = $3
      WHERE job_id = $1 AND state = 'running'`,
    [jobId, state, error],
  );
  return (result.rowCount ?? 0) > 0;
}

/** 잡의 현재 상태. 취소가 들어왔는지 확인할 때 쓴다 (CR-037, DEV-196). */
export async function findJobState(db: Queryable, jobId: number): Promise<JobState | undefined> {
  const result = await db.query<{ state: JobState }>('SELECT state FROM job WHERE job_id = $1', [jobId]);
  return result.rows[0]?.state;
}

// ------------------------------------------------------------------ 배치 실행

/** 동시 실행 상한의 기본값 (FR-ING-006 AC-6). */
export const DEFAULT_MAX_CONCURRENT_JOBS = 3;

/**
 * claim 직렬화 락 대기 상한 (CR-022, DEV-107).
 *
 * 임계 구역은 짧은 질의 두 개라 정상적으로는 밀리초다. 상한을 두는 것은
 * **락을 쥔 채 멈춘 세션**이 모든 워커를 영구히 묶지 않게 하기 위해서다.
 * 넘기면 예외가 나고 러너가 그것을 기록한 뒤 다음 주기에 다시 본다 —
 * "잡을 것이 없다"로 삼키지 않는다. 조용히 삼키면 큐가 밀리는데도 지표에
 * 아무것도 남지 않는다.
 */
const CLAIM_LOCK_TIMEOUT_MS = 5_000;

/**
 * 큐에서 잡 하나를 잡는다 (WP-019 / CR-022, DEV-101·DEV-102).
 *
 * ## 왜 이벤트가 아니라 폴링인가
 *
 * 동시 실행 상한(AC-6)은 **"지금 몇 개가 도는가"**에 대한 제약이라 어차피
 * 공유 저장소에서 세어야 한다. 실행 지시를 이벤트로도 나르면 진실이 둘이
 * 되고, 스트림이 재전달할 때 상한이 조용히 새어 나간다.
 *
 * ## 한 트랜잭션만으로는 상한이 서지 않는다 (CR-022, DEV-107)
 *
 * 처음에는 "세는 것과 잡는 것을 한 트랜잭션에 넣으면 된다"고 적었다.
 * **틀렸다.** PostgreSQL 기본 격리 수준(READ COMMITTED)에서 각 문장은 그때까지
 * **커밋된** 것만 본다. 다섯 워커가 동시에 시작하면 다섯 모두 아직 아무도
 * 커밋하지 않은 상태에서 `running = 0`을 읽고, 서로 다른 행을 잡아 다섯 모두
 * 시작한다. 실제로 CI에서 그렇게 됐다 — 상한 3에 다섯이 돌았다.
 *
 * `FOR UPDATE SKIP LOCKED`가 막는 것은 **같은 행**을 둘이 잡는 것뿐이다.
 * 서로 다른 행을 잡는 워커들은 애초에 충돌하지 않으므로 아무것도 직렬화되지
 * 않는다. 세기가 정확하려면 **세는 워커들끼리** 직렬화되어야 한다.
 *
 * 그래서 유형 단위 advisory lock을 먼저 잡는다. 임계 구역은 짧은 질의 두
 * 개뿐이고 백필은 분 단위로 도는 작업이라, 여기서 줄을 서는 비용은 무시할 수
 * 있다. **기다리는** 락을 쓰는 이유는 `try` 버전이면 상한에 여유가 있어도
 * 락을 놓친 워커가 빈손으로 돌아가 큐가 느리게 비기 때문이다.
 *
 * `SKIP LOCKED`는 그대로 둔다. 락 안에서도 앞선 트랜잭션이 아직 커밋하지 않은
 * 행이 남아 있을 수 있고(claim 뒤 커밋 전), 그것을 기다릴 이유는 없다.
 *
 * @returns 잡을 것이 없거나 상한에 닿았으면 `undefined`. **둘을 구분하지
 * 않는다** — 호출 측이 할 일은 둘 다 "잠시 뒤 다시 본다"로 같다.
 */
export async function claimNextJob(
  db: Pool,
  type: JobType,
  maxConcurrent: number = DEFAULT_MAX_CONCURRENT_JOBS,
): Promise<JobRow | undefined> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');

    /*
     * **세기 전에 줄을 선다.** 이것이 없으면 아래 count는 다른 워커가 방금
     * 잡았지만 아직 커밋하지 않은 잡을 보지 못한다 (DEV-107). 락은 커밋·롤백
     * 시점에 저절로 풀린다.
     */
    await advisoryXactLock(client, jobClaimLockKey(type), CLAIM_LOCK_TIMEOUT_MS);

    /*
     * 먼저 센다. `running`만 센다 — `paused`는 운영자가 멈춘 것이라 자원을
     * 쓰지 않고, `queued`는 아직 아무것도 하지 않는다.
     */
    const running = await client.query<{ count: string }>(
      `SELECT count(*) AS count FROM job WHERE type = $1 AND state = 'running'`,
      [type],
    );
    if (Number(running.rows[0]?.count ?? 0) >= maxConcurrent) {
      await client.query('ROLLBACK');
      return undefined;
    }

    /*
     * 오래 기다린 것부터 잡는다. `job_id` 순서가 곧 요청 순서다 —
     * `BIGSERIAL`이라 단조 증가한다.
     */
    const candidate = await client.query<JobRow>(
      `SELECT * FROM job
        WHERE type = $1 AND state = 'queued'
        ORDER BY job_id
        FOR UPDATE SKIP LOCKED
        LIMIT 1`,
      [type],
    );
    const row = candidate.rows[0];
    if (row === undefined) {
      await client.query('ROLLBACK');
      return undefined;
    }

    const claimed = await client.query<JobRow>(
      `UPDATE job
          SET state = 'running',
              started_at = COALESCE(started_at, now())
        WHERE job_id = $1
        RETURNING *`,
      [row.job_id],
    );
    await client.query('COMMIT');
    // `started_at`을 덮어쓰지 않는다 — 재개한 잡의 시작 시각은 처음 시작한 때다.
    return claimed.rows[0];
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * 운영자의 상태 전이 (API-ADM-002 `PATCH`).
 *
 * **종료 상태는 어느 것도 받지 않는다.** 끝난 잡을 되살리는 것은 새 잡이지
 * 전이가 아니다 — `job_active_uk`가 활성 잡 하나만 허용하므로, 되살리기를
 * 허용하면 같은 대상에 둘이 뜨는 길이 생긴다.
 */
export type JobAction = 'pause' | 'resume' | 'cancel';

const ALLOWED_FROM: Readonly<Record<JobAction, readonly JobState[]>> = {
  pause: ['queued', 'running'],
  resume: ['paused'],
  cancel: ['queued', 'running', 'paused'],
};

const NEXT_STATE: Readonly<Record<JobAction, JobState>> = {
  pause: 'paused',
  resume: 'queued',
  cancel: 'cancelled',
};

/**
 * @returns 전이한 행. 현재 상태에서 불가능한 전이면 `undefined` —
 * 호출 측이 400으로 옮긴다. **조용히 무시하지 않는다**: 운영자가 중단을
 * 눌렀는데 아무 일도 없으면 멈춘 줄 알고 자리를 뜬다.
 */
export async function transitionJob(
  db: Queryable,
  jobId: number,
  action: JobAction,
): Promise<JobRow | undefined> {
  const next = NEXT_STATE[action];
  const allowed = ALLOWED_FROM[action];
  /*
   * `resume`은 `queued`로 되돌린다 — 곧바로 `running`으로 올리지 않는다.
   * 상한을 넘겨 되살아나는 것을 막으려면 claim을 다시 거쳐야 한다 (DEV-102).
   */
  const result = await db.query<JobRow>(
    `UPDATE job
        SET state = $3,
            finished_at = CASE WHEN $3 = 'cancelled' THEN now() ELSE finished_at END
      WHERE job_id = $1 AND state = ANY($2::text[])
      RETURNING *`,
    [jobId, allowed, next],
  );
  return result.rows[0];
}

export async function findJobById(db: Queryable, jobId: number): Promise<JobRow | undefined> {
  const result = await db.query<JobRow>('SELECT * FROM job WHERE job_id = $1', [jobId]);
  return result.rows[0];
}

export interface JobListFilter {
  readonly type?: JobType;
  readonly state?: JobState;
  readonly limit?: number;
}

/** 최근 것부터. 운영자가 보고 싶은 것은 대개 방금 돌린 잡이다. */
export async function listJobs(db: Queryable, filter: JobListFilter = {}): Promise<readonly JobRow[]> {
  const result = await db.query<JobRow>(
    `SELECT * FROM job
      WHERE ($1::text IS NULL OR type = $1)
        AND ($2::text IS NULL OR state = $2)
      ORDER BY job_id DESC
      LIMIT $3`,
    [filter.type ?? null, filter.state ?? null, filter.limit ?? 20],
  );
  return result.rows;
}

/**
 * 잡이 아직 살아 있는지 확인한다 (중단 감지).
 *
 * 백필 루프가 페이지마다 부른다. 운영자가 `pause`·`cancel`을 누르면 상태가
 * 바뀌므로, 루프는 **다음 페이지를 시작하기 전에** 멈춘다 — 페이지 중간에
 * 끊으면 커서가 가리키는 지점과 실제 처리 지점이 어긋난다.
 */
export async function isJobRunning(db: Queryable, jobId: number): Promise<boolean> {
  const result = await db.query<{ state: JobState }>('SELECT state FROM job WHERE job_id = $1', [jobId]);
  return result.rows[0]?.state === 'running';
}
