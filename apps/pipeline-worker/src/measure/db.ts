/**
 * 측정의 읽기 전용 데이터 접근 (WP-074 FR-SEQ-008 AC-14 / 측정 가이드 5절).
 *
 * ## 모든 트랜잭션이 READ ONLY다
 *
 * `default_transaction_read_only`에만 기대지 않는다 — 그 설정은 운영자가 바꿀 수
 * 있고, 바뀐 날 이 도구가 쓸 수 있게 된다. 트랜잭션마다 명시적으로 연다.
 * `statement_timeout` 10초와 `lock_timeout` 1초로 운영 DB를 오래 붙잡지 않는다.
 *
 * ## 없는 표를 조회해 죽지 않는다
 *
 * `baseline`은 024(025 이전) 스키마에서도 돌아야 한다. `to_regclass`로 표와 열의
 * 존재를 먼저 확인하고 가용한 구간만 돌려준다 — 없는 것을 `0`으로 답하지 않는다.
 */

// 앱은 `pg`에 직접 의존하지 않는다 — `@prs/db`가 타입을 다시 내보낸다 (의존 방향: apps → packages).
import type { Pool, PoolClient } from '@prs/db';
import type { Cohort } from './args.js';
import type { SampleTimes } from './stats.js';

/** DB를 읽지 못했다. 호출부가 종료 코드 1로 옮긴다. */
export class MeasureQueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MeasureQueryError';
  }
}

export const STATEMENT_TIMEOUT_MS = 10_000;
export const LOCK_TIMEOUT_MS = 1_000;

/**
 * 읽기 전용 트랜잭션 하나를 연다.
 *
 * `run`이 쓰기를 시도하면 PostgreSQL이 거부한다 — 이 도구가 운영 데이터를 바꾸지
 * 않는다는 주장을 애플리케이션이 아니라 **데이터베이스가** 집행한다.
 */
export async function withReadOnly<T>(pool: Pool, run: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN READ ONLY');
    await client.query(`SET LOCAL statement_timeout = ${String(STATEMENT_TIMEOUT_MS)}`);
    await client.query(`SET LOCAL lock_timeout = ${String(LOCK_TIMEOUT_MS)}`);
    const result = await run(client);
    await client.query('ROLLBACK');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** 이 DB가 어디까지 답할 수 있는가. 없는 구간을 재는 척하지 않는다. */
export interface Capability {
  /** 025가 적용됐다 — 표본 표가 있다. */
  readonly hasSamples: boolean;
  /** `merge_sequence.merge_number`가 있다. */
  readonly hasMergeNumber: boolean;
  /** `sequence_space`의 M checkpoint 열이 있다. */
  readonly hasCheckpoint: boolean;
}

export async function readCapability(client: PoolClient): Promise<Capability> {
  const tables = await client.query<{ samples: string | null }>(
    `SELECT to_regclass('public.sequence_latency_sample')::text AS samples`,
  );
  const columns = await client.query<{ table_name: string; column_name: string }>(
    `SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema = 'public'
        AND ((table_name = 'merge_sequence' AND column_name = 'merge_number')
          OR (table_name = 'sequence_space' AND column_name = 'mnumber_head_seq'))`,
  );
  const has = (table: string, column: string): boolean =>
    columns.rows.some((row) => row.table_name === table && row.column_name === column);
  return {
    hasSamples: tables.rows[0]?.samples !== null && tables.rows[0]?.samples !== undefined,
    hasMergeNumber: has('merge_sequence', 'merge_number'),
    hasCheckpoint: has('sequence_space', 'mnumber_head_seq'),
  };
}

/** 024에서도 잴 수 있는 보조 관측 — **커밋 작성 → 채번** 간격이다. 수신 지연이 아니다. */
export interface BaselineRow {
  readonly samples: number;
  readonly p50_ms: number | null;
  readonly p95_ms: number | null;
  readonly p99_ms: number | null;
  readonly max_ms: number | null;
  readonly negative_count: number;
}

export async function readCommitToAssign(client: PoolClient, windowMs: number): Promise<BaselineRow> {
  const result = await client.query<{
    samples: string;
    p50: string | null;
    p95: string | null;
    p99: string | null;
    maximum: string | null;
    negative_count: string;
  }>(
    `SELECT count(*)::text AS samples,
            extract(epoch FROM percentile_disc(0.50) WITHIN GROUP (ORDER BY assigned_at - committed_at))::text AS p50,
            extract(epoch FROM percentile_disc(0.95) WITHIN GROUP (ORDER BY assigned_at - committed_at))::text AS p95,
            extract(epoch FROM percentile_disc(0.99) WITHIN GROUP (ORDER BY assigned_at - committed_at))::text AS p99,
            extract(epoch FROM max(assigned_at - committed_at))::text AS maximum,
            count(*) FILTER (WHERE assigned_at < committed_at)::text AS negative_count
       FROM merge_sequence
      WHERE assigned_at >= now() - ($1::bigint * interval '1 millisecond')`,
    [windowMs],
  );
  const row = result.rows[0];
  if (row === undefined) throw new MeasureQueryError('기준 조회가 행을 돌려주지 않았다');
  const toMs = (value: string | null): number | null => (value === null ? null : Math.round(Number(value) * 1_000));
  return {
    samples: Number(row.samples),
    p50_ms: toMs(row.p50),
    p95_ms: toMs(row.p95),
    p99_ms: toMs(row.p99),
    max_ms: toMs(row.maximum),
    negative_count: Number(row.negative_count),
  };
}

export interface SampleRowRaw extends SampleTimes {
  readonly cohort: string;
  readonly repositoryId: number;
  readonly baseBranch: string;
}

/** 창 안의 표본. cohort가 `all`이면 전부이며 출력에서 cohort별 행을 유지한다. */
export async function readSamples(
  client: PoolClient,
  windowMs: number,
  cohort: Cohort,
): Promise<readonly SampleRowRaw[]> {
  const result = await client.query<{
    trigger_kind: string;
    outcome: SampleTimes['outcome'];
    reason: string | null;
    repository_id: number;
    base_branch: string;
    received_at: Date | null;
    mirror_completed_at: Date | null;
    sequence_assigned_at: Date | null;
    mnumber_assigned_at: Date | null;
    search_observed_at: Date | null;
  }>(
    `SELECT trigger_kind, outcome, reason, repository_id, base_branch,
            received_at, mirror_completed_at, sequence_assigned_at, mnumber_assigned_at, search_observed_at
       FROM sequence_latency_sample
      WHERE created_at >= now() - ($1::bigint * interval '1 millisecond')
        AND ($2::text = 'all' OR trigger_kind = $2)
      ORDER BY created_at`,
    [windowMs, cohort],
  );
  return result.rows.map((row) => ({
    cohort: row.trigger_kind,
    repositoryId: row.repository_id,
    baseBranch: row.base_branch,
    outcome: row.outcome,
    reason: row.reason,
    receivedAt: row.received_at,
    mirrorCompletedAt: row.mirror_completed_at,
    sequenceAssignedAt: row.sequence_assigned_at,
    mnumberAssignedAt: row.mnumber_assigned_at,
    searchObservedAt: row.search_observed_at,
  }));
}

export interface PendingRow {
  readonly items: number;
  readonly known_prs: number;
  readonly oldest_ms: number | null;
  readonly reasons: Readonly<Record<string, number>>;
}

/**
 * 지금 막혀 있는 것 (가이드 5절).
 *
 * `items`는 미확정 커밋 수, `known_prs`는 그 뒤에서 번호를 기다리는 PR 수다 —
 * **합이 같을 필요가 없다.** `oldest`는 blocker가 처음 관측된 시각 기준이며,
 * 과거 커밋 작성 시각을 기다림의 시작으로 쓰지 않는다.
 */
export async function readPending(client: PoolClient): Promise<PendingRow> {
  const blocked = await client.query<{ reason: string; count: string; oldest_ms: string | null }>(
    `SELECT mnumber_blocked_reason AS reason, count(*)::text AS count,
            extract(epoch FROM max(now() - mnumber_blocked_since))::text AS oldest_ms
       FROM sequence_space
      WHERE mnumber_blocked_seq IS NOT NULL
      GROUP BY mnumber_blocked_reason`,
  );
  const waiting = await client.query<{ count: string }>(
    `SELECT count(*)::text AS count
       FROM merge_sequence ms
       JOIN sequence_space s
         ON s.repository_id = ms.repository_id AND s.base_branch = ms.base_branch AND s.seq_epoch = ms.seq_epoch
      WHERE ms.pull_request_number IS NOT NULL AND ms.merge_number IS NULL
        AND s.mnumber_blocked_seq IS NOT NULL AND ms.merge_seq >= s.mnumber_blocked_seq`,
  );
  const reasons: Record<string, number> = {};
  let items = 0;
  let oldest: number | null = null;
  for (const row of blocked.rows) {
    reasons[row.reason] = Number(row.count);
    items += Number(row.count);
    if (row.oldest_ms !== null) {
      const ms = Math.round(Number(row.oldest_ms) * 1_000);
      oldest = oldest === null ? ms : Math.max(oldest, ms);
    }
  }
  return { items, known_prs: Number(waiting.rows[0]?.count ?? 0), oldest_ms: oldest, reasons };
}
