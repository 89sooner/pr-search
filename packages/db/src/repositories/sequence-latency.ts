/**
 * `sequence_latency_sample` 리포지터리 (ENT-SEQ-007, FR-SEQ-008 AC-14 / WP-074).
 *
 * ## 관측이지 판정이 아니다
 *
 * 표본 저장 실패는 번호·work의 성공을 되돌리지 않는다. 호출 측은 **별도 best-effort
 * 트랜잭션**에서 부르고 실패는 `measurement_missing` 카운터로만 센다 (상세 설계 6.4).
 *
 * ## 시각을 지어내지 않는다
 *
 * `received_at`은 원본 `raw_event`의 값이며 **원인 push의 delivery 연결이 증명된
 * 경우에만** 채운다. 일괄 fetch로 들어온 옛 PR의 수신 시각을 마지막 push 시각으로
 * 채우지 않는다. 다른 stage 시각은 수행 사실 뒤 DB 시계다. 관측 시각은 최초 값만
 * 남기고 이후 관측으로 덮지 않는다.
 */

import type { Pool, PoolClient } from 'pg';

type Queryable = Pool | PoolClient;

export type LatencyTriggerKind = 'new_squash' | 'backfill' | 'retry' | 'reassign' | 'reconcile';
export type LatencyOutcome = 'pending' | 'failed' | 'assigned' | 'visible' | 'skipped';

export interface LatencySampleRow {
  readonly sample_id: string;
  readonly work_key: string;
  readonly attempt: number;
  readonly repository_id: number;
  readonly base_branch: string;
  readonly seq_epoch: number;
  readonly pr_number: number | null;
  readonly delivery_id: string | null;
  readonly trigger_kind: LatencyTriggerKind;
  readonly outcome: LatencyOutcome;
  readonly received_at: Date | null;
  readonly attempt_started_at: Date | null;
  readonly mirror_completed_at: Date | null;
  readonly sequence_assigned_at: Date | null;
  readonly mnumber_assigned_at: Date | null;
  readonly search_observed_at: Date | null;
  readonly last_search_absent_at: Date | null;
  readonly observation_attempts: number;
  readonly reason: string | null;
  readonly search_poll_interval_ms: number | null;
  readonly observed_index_uuid: string | null;
  readonly created_at: Date;
}

export interface LatencySampleUpsert {
  readonly workKey: string;
  readonly attempt: number;
  readonly repositoryId: number;
  readonly baseBranch: string;
  readonly seqEpoch: number;
  readonly prNumber: number | null;
  readonly deliveryId: string | null;
  readonly triggerKind: LatencyTriggerKind;
  readonly outcome: LatencyOutcome;
  readonly receivedAt: Date | null;
  readonly attemptStartedAt: Date | null;
  /** 이미 아는 stage 시각 (정본 행의 값). 없으면 아래 `*Now` 플래그가 DB 시계로 찍는다. */
  readonly mirrorCompletedAt?: Date | null;
  readonly sequenceAssignedAt?: Date | null;
  readonly mnumberAssignedAt?: Date | null;
  /** `true`면 DB 시계로 지금을 찍는다. 이미 값이 있으면 보존한다. */
  readonly mirrorCompletedNow?: boolean;
  readonly sequenceAssignedNow?: boolean;
  readonly mnumberAssignedNow?: boolean;
  readonly reason: string | null;
}

/**
 * 표본을 남긴다. 같은 `(work_key, attempt, epoch, pr)`이면 stage 시각을 **비어 있는
 * 것만** 채우고 결과를 갱신한다.
 */
/**
 * push 단위 표본을 PR 단위로 **승격한다** (WP-074 / DEV-593).
 *
 * ## 왜 승격인가
 *
 * push를 받은 시점에는 PR 번호를 모르므로 표본이 `pr_number IS NULL`로 시작한다.
 * 나중에 M 번호가 붙으면 그제서야 PR을 안다. 그때 **새 행을 만들면 한 요청이 두
 * 행이 된다** — unique 키에 `pr_number`가 들어 있어 둘이 서로를 덮지 않기 때문이다.
 *
 * 그 결과 push 행은 `mnumber_assigned_at`이 영영 비어 `pending`으로 집계되고,
 * 같은 push가 `received_to_sequence`에서 두 번 세어진다. **정상 채번에서도 대기가
 * 쌓이는 표**가 나오고, 운영자는 막히지 않은 것을 막혔다고 읽는다.
 *
 * 그래서 PR을 알게 된 순간 기존 행의 `pr_number`를 채워 **같은 행을 잇는다.**
 *
 * 한 push가 PR 여럿을 실어 오면 첫 PR이 그 행을 가져가고 나머지는 각자 새 행을
 * 만든다 — 행 수가 PR 수와 같아지므로 그것이 옳다.
 *
 * @returns 승격한 행이 있었으면 `true`.
 */
export async function promotePushSample(
  db: Queryable,
  key: { readonly workKey: string; readonly attempt: number; readonly seqEpoch: number; readonly prNumber: number },
): Promise<boolean> {
  const result = await db.query(
    `UPDATE sequence_latency_sample
        SET pr_number = $4
      WHERE work_key = $1 AND attempt = $2 AND seq_epoch = $3 AND pr_number IS NULL`,
    [key.workKey, key.attempt, key.seqEpoch, key.prNumber],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function upsertSample(db: Queryable, input: LatencySampleUpsert): Promise<LatencySampleRow> {
  const result = await db.query<LatencySampleRow>(
    `INSERT INTO sequence_latency_sample
       (work_key, attempt, repository_id, base_branch, seq_epoch, pr_number, delivery_id, trigger_kind, outcome,
        received_at, attempt_started_at, mirror_completed_at, sequence_assigned_at, mnumber_assigned_at, reason)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
             COALESCE($16, CASE WHEN $12 THEN clock_timestamp() END),
             COALESCE($17, CASE WHEN $13 THEN clock_timestamp() END),
             COALESCE($18, CASE WHEN $14 THEN clock_timestamp() END),
             $15)
     ON CONFLICT (work_key, attempt, seq_epoch, pr_number) DO UPDATE
        SET outcome              = EXCLUDED.outcome,
            delivery_id          = COALESCE(sequence_latency_sample.delivery_id, EXCLUDED.delivery_id),
            received_at          = COALESCE(sequence_latency_sample.received_at, EXCLUDED.received_at),
            attempt_started_at   = COALESCE(sequence_latency_sample.attempt_started_at, EXCLUDED.attempt_started_at),
            mirror_completed_at  = COALESCE(sequence_latency_sample.mirror_completed_at, EXCLUDED.mirror_completed_at),
            sequence_assigned_at = COALESCE(sequence_latency_sample.sequence_assigned_at, EXCLUDED.sequence_assigned_at),
            mnumber_assigned_at  = COALESCE(sequence_latency_sample.mnumber_assigned_at, EXCLUDED.mnumber_assigned_at),
            reason               = EXCLUDED.reason
     RETURNING *`,
    [
      input.workKey,
      input.attempt,
      input.repositoryId,
      input.baseBranch,
      input.seqEpoch,
      input.prNumber,
      input.deliveryId,
      input.triggerKind,
      input.outcome,
      input.receivedAt,
      input.attemptStartedAt,
      input.mirrorCompletedNow === true,
      input.sequenceAssignedNow === true,
      input.mnumberAssignedNow === true,
      input.reason,
      input.mirrorCompletedAt ?? null,
      input.sequenceAssignedAt ?? null,
      input.mnumberAssignedAt ?? null,
    ],
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error('표본 upsert가 행을 돌려주지 않았다');
  return row;
}

/** 관측 대기 표본 — 번호는 붙었는데 검색에서 아직 확인하지 못한 것. 오래된 것부터. */
export async function listUnobservedAssigned(db: Queryable, limit: number): Promise<LatencySampleRow[]> {
  const result = await db.query<LatencySampleRow>(
    `SELECT * FROM sequence_latency_sample
      WHERE outcome = 'assigned' AND search_observed_at IS NULL
      ORDER BY created_at
      LIMIT $1`,
    [limit],
  );
  return result.rows;
}

/** 검색에서 실제로 보였다. 최초 관측만 남기고 `visible`로 옮긴다. */
export async function markObserved(
  db: Queryable,
  sampleId: string,
  observed: { readonly indexUuid: string | null; readonly pollIntervalMs: number },
): Promise<void> {
  await db.query(
    `UPDATE sequence_latency_sample
        SET search_observed_at      = COALESCE(search_observed_at, clock_timestamp()),
            outcome                 = 'visible',
            observed_index_uuid     = COALESCE(observed_index_uuid, $2),
            search_poll_interval_ms = COALESCE(search_poll_interval_ms, $3),
            observation_attempts    = observation_attempts + 1
      WHERE sample_id = $1`,
    [sampleId, observed.indexUuid, observed.pollIntervalMs],
  );
}

/** 이번 poll에서는 보이지 않았다. 부재 관측 시각을 남겨 `(last_absent, first_present]` 구간을 복원한다. */
export async function markAbsent(db: Queryable, sampleId: string, pollIntervalMs: number): Promise<void> {
  await db.query(
    `UPDATE sequence_latency_sample
        SET last_search_absent_at   = clock_timestamp(),
            search_poll_interval_ms = COALESCE(search_poll_interval_ms, $2),
            observation_attempts    = observation_attempts + 1
      WHERE sample_id = $1`,
    [sampleId, pollIntervalMs],
  );
}

/** 관측 시한을 넘겼다. 0ms를 저장하지 않고 사유만 남긴 채 `assigned`로 둔다 — 느린 재시도 대상이다. */
export async function markObservationTimedOut(db: Queryable, sampleId: string, reason: string): Promise<void> {
  await db.query('UPDATE sequence_latency_sample SET reason = $2 WHERE sample_id = $1', [sampleId, reason]);
}

/** 30일 보존 정리. 한 번에 `limit`행. */
export async function cleanupSamples(db: Queryable, olderThan: Date, limit = 1_000): Promise<number> {
  const result = await db.query(
    `DELETE FROM sequence_latency_sample
      WHERE sample_id IN (
        SELECT sample_id FROM sequence_latency_sample WHERE created_at < $1 ORDER BY created_at LIMIT $2
      )`,
    [olderThan, limit],
  );
  return result.rowCount ?? 0;
}

export async function listSamplesForSpace(
  db: Queryable,
  repositoryId: number,
  baseBranch: string,
): Promise<LatencySampleRow[]> {
  const result = await db.query<LatencySampleRow>(
    `SELECT * FROM sequence_latency_sample WHERE repository_id = $1 AND base_branch = $2 ORDER BY created_at, pr_number`,
    [repositoryId, baseBranch],
  );
  return result.rows;
}
