/**
 * 무중단 재색인 잡 상태 (WP-035 / JOB-ING-006, CR-045~047).
 *
 * ## 새 표를 만들지 않는다 (DEV-299)
 *
 * 재색인의 모든 상태는 `job` 행 하나에 산다 — `type='reindex'`, `target`은
 * **안정 별칭**, 세부 단계는 `progress.phase`다. 보관 대상(`source_index`)과
 * 전환 시각(`switched_at`)도 완료된 잡의 `progress`에 있고, 정리 스윕은 그것만
 * 읽으면 된다. 표를 하나 더 만들면 잡 행과 그 표가 갈라질 수 있고, 갈라진
 * 순간 어느 쪽이 정본인지 아무도 모른다.
 *
 * ## `job.state`를 늘리지 않는다
 *
 * 기존 여섯(`queued`·`running`·`paused`·`completed`·`failed`·`cancelled`)이
 * 그대로다. 상태 기계를 늘리면 그 여섯으로 판정하는 **모든 운영 경로**가 새 값을
 * 모른다 — 목록·진행률·중단·취소가 전부 그렇다.
 */

import type { Pool, PoolClient } from 'pg';

import { enqueueJob, findActiveJob, type JobRow, type JobState } from './job.js';

type Queryable = Pool | PoolClient;

/** `job.type`. 마이그레이션 001의 CHECK가 이미 허용한다. */
export const REINDEX_JOB_TYPE = 'reindex' as const;

/**
 * 진행 단계 (API 계약 API-ADM-004).
 *
 * `prepare` 대상 인덱스 생성 → `dual_write` 이중 쓰기 활성화(울타리 안) →
 * `backfill` 정본 스캔 → `verify` 전환 전 검증 → `cutover` 원자 전환 →
 * `retention` 옛 인덱스 보관 대기.
 */
export type ReindexPhase = 'prepare' | 'dual_write' | 'backfill' | 'verify' | 'cutover' | 'retention';

/** 이중 쓰기가 살아 있는 단계. 활성화 뒤부터 전환 직전까지다. */
const DUAL_WRITE_PHASES: readonly ReindexPhase[] = ['dual_write', 'backfill', 'verify', 'cutover'];

export interface ReindexProgress {
  readonly phase: ReindexPhase;
  readonly alias: string;
  /** 전환 전 별칭이 가리키던 인덱스. 보관·정리의 대상이다. */
  readonly source_index: string;
  /** 새로 만든 shadow 인덱스. 전환 뒤에는 서비스 인덱스다. */
  readonly target_index: string;
  readonly documents_scanned?: number;
  readonly documents_written?: number;
  /** 알려진 실패 수. 0이 아니면 전환하지 않는다. */
  readonly failures?: number;
  /** 실패 사유 표본. 전부 싣지 않는다 — 진단용이지 정본이 아니다. */
  readonly failure_samples?: readonly string[];
  readonly scan_complete?: boolean;
  readonly dual_write_since?: string;
  readonly switched_at?: string;
}

export interface ReindexJob {
  readonly jobId: number;
  readonly state: JobState;
  readonly alias: string;
  readonly progress: ReindexProgress;
}

function toReindexJob(row: JobRow): ReindexJob | undefined {
  const progress = row.progress as Partial<ReindexProgress>;
  if (typeof progress.phase !== 'string') return undefined;
  return {
    jobId: row.job_id,
    state: row.state,
    alias: row.target,
    progress: { ...progress, alias: row.target } as ReindexProgress,
  };
}

/** 활성(`queued`·`running`·`paused`) 재색인 잡. 동시 실행 상한 1의 근거다. */
export async function findActiveReindexRow(db: Queryable): Promise<JobRow | undefined> {
  const result = await db.query<JobRow>(
    `SELECT * FROM job
      WHERE type = $1 AND state IN ('queued', 'running', 'paused')
      ORDER BY job_id ASC
      LIMIT 1`,
    [REINDEX_JOB_TYPE],
  );
  return result.rows[0];
}

export async function findReindexJob(db: Queryable, jobId: number): Promise<ReindexJob | undefined> {
  const result = await db.query<JobRow>('SELECT * FROM job WHERE job_id = $1 AND type = $2', [
    jobId,
    REINDEX_JOB_TYPE,
  ]);
  const row = result.rows[0];
  return row === undefined ? undefined : toReindexJob(row);
}

/**
 * 지금 이중 쓰기를 요구하는 대상 — 별칭 → shadow 인덱스.
 *
 * 세 조건을 모두 본다.
 *
 *   - `running`이다. `failed`가 되면 **shadow 쓰기를 중단한다** (DEV-298) —
 *     불완전한 인덱스에 계속 쓰는 것은 전환할 수 없는 데이터를 더 쌓는 일이다
 *   - 단계가 활성화 뒤·전환 전이다
 *   - 아직 전환하지 않았다. 전환 뒤 옛 인덱스는 **보관 대상**이지 쓰기 대상이 아니다
 *
 * **호출은 반드시 울타리 안에서 한다.** 밖에서 읽으면 읽은 직후 활성화가 끼어들어
 * "shadow 없음"으로 판단한 쓰기가 정본 스캔이 지나간 문서를 갱신한다.
 */
export async function findDualWriteShadows(db: Queryable): Promise<Record<string, string>> {
  const result = await db.query<JobRow>(
    `SELECT * FROM job
      WHERE type = $1
        AND state = 'running'
        AND progress ->> 'switched_at' IS NULL
        AND progress ->> 'phase' = ANY($2::text[])`,
    [REINDEX_JOB_TYPE, [...DUAL_WRITE_PHASES]],
  );

  const shadows: Record<string, string> = {};
  for (const row of result.rows) {
    const job = toReindexJob(row);
    if (job === undefined) continue;
    if (typeof job.progress.target_index !== 'string') continue;
    shadows[job.alias] = job.progress.target_index;
  }
  return shadows;
}

/** 진행 상태를 통째로 대입한다. `progress`가 이 잡의 정본이다. */
export async function setReindexProgress(
  db: Queryable,
  jobId: number,
  progress: ReindexProgress,
): Promise<void> {
  await db.query('UPDATE job SET progress = $2 WHERE job_id = $1', [jobId, JSON.stringify(progress)]);
}

/** 진행 상태를 부분 갱신한다. 없는 잡이면 아무 일도 하지 않는다. */
export async function patchReindexProgress(
  db: Queryable,
  jobId: number,
  patch: Partial<ReindexProgress>,
): Promise<void> {
  await db.query('UPDATE job SET progress = progress || $2::jsonb WHERE job_id = $1', [
    jobId,
    JSON.stringify(patch),
  ]);
}

/** 실패 사유 표본 상한. 진단에 필요한 만큼만 남긴다. */
export const FAILURE_SAMPLE_LIMIT = 20;

/**
 * shadow 쓰기 실패를 기록하고 잡을 `failed`로 만든다 (DEV-298).
 *
 * **서비스 인덱스 결과는 건드리지 않는다** — 이미 성공했고 그것이 사용자가 보는
 * 사실이다. 바뀌는 것은 "이 재색인은 전환할 수 없다"뿐이다.
 *
 * `running`일 때만 옮긴다. 이미 `cancelled`인 잡을 `failed`로 덮으면 운영자의
 * 취소가 사라진다 (`finishJobIfRunning`이 배운 것과 같은 자리, DEV-196).
 *
 * @returns 실제로 `failed`로 옮겼으면 `true`.
 */
export async function recordShadowFailures(
  db: Queryable,
  jobId: number,
  failures: readonly { readonly index: string; readonly operation: string; readonly reason: string }[],
): Promise<boolean> {
  if (failures.length === 0) return false;

  const samples = failures
    .slice(0, FAILURE_SAMPLE_LIMIT)
    .map((one) => `${one.operation} ${one.index}: ${one.reason}`);

  const result = await db.query(
    `UPDATE job
        SET progress = progress
              || jsonb_build_object(
                   'failures', COALESCE((progress ->> 'failures')::int, 0) + $2::int,
                   'failure_samples', $3::jsonb
                 ),
            state = 'failed',
            finished_at = now(),
            error = COALESCE(error, $4)
      WHERE job_id = $1 AND type = $5 AND state = 'running'`,
    [jobId, failures.length, JSON.stringify(samples), 'shadow_write_failed', REINDEX_JOB_TYPE],
  );
  return (result.rowCount ?? 0) > 0;
}

/**
 * 재색인 대상 이름을 정하는 포트 (WP-035, DEV-302).
 *
 * `@prs/db`가 Elasticsearch 클라이언트를 의존하지 않게 한다 — 색인 이름을 아는
 * 것은 `@prs/es`이고, 잡을 만드는 것은 여기다. 앱이 둘을 잇는다
 * (`packages/authz`의 색인 포트와 같은 선례).
 */
export interface ReindexIndexPort {
  /** 별칭이 지금 가리키는 구체 인덱스. */
  resolveServingIndex(alias: string): Promise<string>;
  /** 아직 쓰이지 않은 다음 버전의 구체 이름 (DEV-309). */
  nextTargetIndex(alias: string): Promise<string>;
  /** 안정 별칭인지. 구체 인덱스 지정을 거절하는 근거다 (DEV-294). */
  isAlias(value: string): boolean;
}

export type EnqueueReindexOutcome =
  | { readonly kind: 'queued'; readonly jobId: number; readonly sourceIndex: string; readonly targetIndex: string }
  /** 같은 별칭에 이미 활성 잡이 있다 → 409 `JOB_CONFLICT`. */
  | { readonly kind: 'conflict'; readonly alias: string }
  /** 다른 별칭이 재색인 중이다 → 409 `REINDEX_BUSY`. */
  | { readonly kind: 'busy'; readonly alias: string }
  /** 알 수 없는 별칭 → 400 `INVALID_PARAMETER`. */
  | { readonly kind: 'invalid_alias'; readonly value: string };

/**
 * 재색인 잡 하나를 큐에 넣는다 — **API와 CLI가 함께 쓰는 유일한 seam** (DEV-302).
 *
 * 두 진입점이 각자 알고리즘을 만들면 한쪽만 상한을 보거나 한쪽만 다음 버전을
 * 다르게 고른다. 그리고 그 차이는 두 경로를 모두 써 본 사람만 발견한다.
 *
 * **동시 실행 상한은 전 별칭을 통틀어 1이다** (DEV-300). 재색인은 클러스터 자원을
 * 통째로 쓰므로 일반 잡의 3을 적용하지 않는다. 같은 별칭의 중복은
 * `job_active_uk`가 DB에서 막지만, 다른 별칭은 그 제약의 대상이 아니라 여기서 센다.
 */
export async function enqueueReindex(
  db: Queryable,
  port: ReindexIndexPort,
  alias: string,
  requestedBy: string,
): Promise<EnqueueReindexOutcome> {
  if (!port.isAlias(alias)) return { kind: 'invalid_alias', value: alias };

  const existing = await findActiveReindexRow(db);
  if (existing !== undefined) {
    return existing.target === alias ? { kind: 'conflict', alias } : { kind: 'busy', alias: existing.target };
  }

  const sourceIndex = await port.resolveServingIndex(alias);
  const targetIndex = await port.nextTargetIndex(alias);

  /*
   * **초기 상태를 같은 INSERT에 넣는다** (PR #52 리뷰 P2). 행을 먼저 만들고
   * 진행 상태를 뒤에 쓰면 그 사이에 러너가 집어 초기화되지 않은 잡을 실행하고,
   * 러너는 그것을 "진행 상태가 없다"로 읽어 **API가 받아들인 요청을 영구
   * 실패로** 만든다. 큐에 보이는 순간 이미 완전해야 한다.
   */
  const progress: ReindexProgress = {
    phase: 'prepare',
    alias,
    source_index: sourceIndex,
    target_index: targetIndex,
    documents_scanned: 0,
    documents_written: 0,
    failures: 0,
  };
  const jobId = await enqueueJob(db, REINDEX_JOB_TYPE, alias, requestedBy, { ...progress });

  return { kind: 'queued', jobId, sourceIndex, targetIndex };
}

/** 같은 별칭에 활성 재색인이 있는지. 러너와 API가 함께 본다. */
export async function findActiveReindexFor(db: Queryable, alias: string): Promise<JobRow | undefined> {
  return findActiveJob(db, REINDEX_JOB_TYPE, alias);
}

/**
 * 이 별칭의 **가장 최근 종료된** 재색인 잡 (API-ADM-004 `GET` / CR-055).
 *
 * **새 이력 표를 만들지 않는다** — `job` 행의 `progress`가 `source_index`·
 * `target_index`·`switched_at`을 이미 갖고 있으므로 이력의 정본은 그것이다
 * (DEV-299의 판단을 그대로 따른다).
 *
 * `finished_at`이 아니라 `job_id`로 정렬한다. `BIGSERIAL`이라 단조 증가하고,
 * `finished_at`은 같은 시각에 끝난 둘의 순서를 정하지 못한다.
 */
export async function findLastReindexFor(db: Queryable, alias: string): Promise<JobRow | undefined> {
  const result = await db.query<JobRow>(
    `SELECT * FROM job
      WHERE type = $1 AND target = $2
        AND state IN ('completed', 'failed', 'cancelled')
      ORDER BY job_id DESC
      LIMIT 1`,
    [REINDEX_JOB_TYPE, alias],
  );
  return result.rows[0];
}

/** 보관 기한이 지난 옛 인덱스 하나. */
export interface RetiredIndex {
  readonly jobId: number;
  readonly alias: string;
  readonly sourceIndex: string;
  readonly switchedAt: Date;
}

/**
 * 보관 기한이 지난 전환 완료 잡을 찾는다 (FR-ING-008 AC-4).
 *
 * 정본은 완료된 잡의 `progress`다 — `source_index`가 보관 대상이고
 * `switched_at`이 기산점이다. **새 표가 없다** (DEV-299).
 *
 * 이미 정리한 잡은 `progress.retired_at`으로 표시해 다시 세지 않는다.
 */
export async function listRetiredIndices(
  db: Queryable,
  switchedBefore: Date,
  limit: number,
): Promise<readonly RetiredIndex[]> {
  const result = await db.query<JobRow>(
    `SELECT * FROM job
      WHERE type = $1
        AND state = 'completed'
        AND progress ->> 'switched_at' IS NOT NULL
        AND (progress ->> 'switched_at')::timestamptz < $2
        AND progress ->> 'retired_at' IS NULL
      ORDER BY job_id ASC
      LIMIT $3`,
    [REINDEX_JOB_TYPE, switchedBefore.toISOString(), limit],
  );

  const out: RetiredIndex[] = [];
  for (const row of result.rows) {
    const job = toReindexJob(row);
    if (job === undefined) continue;
    const switchedAt = job.progress.switched_at;
    if (typeof switchedAt !== 'string' || typeof job.progress.source_index !== 'string') continue;
    out.push({
      jobId: job.jobId,
      alias: job.alias,
      sourceIndex: job.progress.source_index,
      switchedAt: new Date(switchedAt),
    });
  }
  return out;
}

/**
 * 전환은 됐는데 그 사실이 기록되지 않은 잡 (PR #52 리뷰 P2).
 *
 * Elasticsearch 전환은 성공했으나 뒤이은 PostgreSQL 기록이 실패한 자리다. 그
 * 상태를 두면 옛 인덱스가 **보관 대상에 영영 오르지 않는다.** 스윕이 별칭의
 * 현재 대상과 대조해 스스로 고친다.
 */
export async function listUnrecordedSwitches(
  db: Queryable,
  limit: number,
): Promise<readonly { readonly jobId: number; readonly alias: string; readonly targetIndex: string }[]> {
  const result = await db.query<JobRow>(
    `SELECT * FROM job
      WHERE type = $1
        AND state IN ('failed', 'completed', 'running')
        AND progress ->> 'switched_at' IS NULL
        AND progress ->> 'target_index' IS NOT NULL
      ORDER BY job_id DESC
      LIMIT $2`,
    [REINDEX_JOB_TYPE, limit],
  );

  const out: { jobId: number; alias: string; targetIndex: string }[] = [];
  for (const row of result.rows) {
    const job = toReindexJob(row);
    if (job === undefined || typeof job.progress.target_index !== 'string') continue;
    out.push({ jobId: job.jobId, alias: job.alias, targetIndex: job.progress.target_index });
  }
  return out;
}

/** 정리했음을 남긴다. 같은 잡을 매 주기 다시 세지 않게 한다. */
export async function markRetired(db: Queryable, jobId: number, at: Date): Promise<void> {
  await db.query(`UPDATE job SET progress = progress || jsonb_build_object('retired_at', $2::text) WHERE job_id = $1`, [
    jobId,
    at.toISOString(),
  ]);
}
