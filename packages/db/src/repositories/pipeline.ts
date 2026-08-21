/**
 * 파이프라인 상태 질의 (API-ADM-006, FR-ADMIN-001).
 *
 * **표본이 곧 사실이다** (CR-013, DEV-029). `raw_event`에 `received_at`과
 * `processed_at`이 행마다 있으므로 수집 반영 지연은 지표 저장소를 거치지 않고
 * 정확히 계산된다. 히스토그램 버킷의 근사가 아니라 실제 백분위다.
 *
 * 조회 범위를 최근 한 시간으로 묶는 이유는 두 가지다 — `raw_event`가
 * `received_at` 월별 파티션이라 기간을 주어야 가지치기가 되고, "지금 파이프라인이
 * 어떤가"를 묻는 화면에 사흘 전 지연이 섞이면 안 된다.
 */

import type { Pool, PoolClient } from 'pg';

type Queryable = Pool | PoolClient;

/** FR-ADMIN-001 AC-3의 상위 10개. */
export const SLOWEST_REPOSITORY_LIMIT = 10;

/** 백분위 표본 창. AC-2의 신선도(30초)와는 다른 축이다. */
export const LAG_SAMPLE_WINDOW_MS = 60 * 60 * 1_000;

export interface LagPercentiles {
  readonly p50: number | null;
  readonly p95: number | null;
  readonly sample_count: number;
}

export interface RepositoryLag {
  readonly repository_id: number;
  /** `owner/name`. 등록이 해제된 저장소도 이름은 남아 있다. */
  readonly repository: string | null;
  readonly lag_p95_seconds: number;
  readonly sample_count: number;
}

/** 최근 1분 수신 건수 (AC-1의 "수신량(분당)"). */
export async function countRecentIntake(db: Queryable, since: Date): Promise<number> {
  const result = await db.query<{ count: number }>(
    'SELECT count(*)::int AS count FROM raw_event WHERE received_at >= $1',
    [since],
  );
  return result.rows[0]?.count ?? 0;
}

/**
 * 수집 반영 지연 백분위.
 *
 * `processed_at`이 있는 행만 센다. 아직 처리되지 않은 행을 0으로 세면 지연이
 * 실제보다 낮게 보이고, 무한대로 세면 하나만 막혀도 백분위가 무의미해진다.
 */
export async function ingestionLagPercentiles(db: Queryable, since: Date): Promise<LagPercentiles> {
  const result = await db.query<{ p50: string | null; p95: string | null; sample_count: number }>(
    `SELECT percentile_cont(0.5)  WITHIN GROUP (ORDER BY extract(epoch FROM processed_at - received_at)) AS p50,
            percentile_cont(0.95) WITHIN GROUP (ORDER BY extract(epoch FROM processed_at - received_at)) AS p95,
            count(*)::int AS sample_count
       FROM raw_event
      WHERE received_at >= $1 AND processed_at IS NOT NULL`,
    [since],
  );

  const row = result.rows[0];
  return {
    p50: row?.p50 === null || row?.p50 === undefined ? null : Number(row.p50),
    p95: row?.p95 === null || row?.p95 === undefined ? null : Number(row.p95),
    sample_count: row?.sample_count ?? 0,
  };
}

/** 저장소별 지연 상위 N (AC-3). 저장소를 모르는 이벤트는 묶을 축이 없어 뺀다. */
export async function slowestRepositories(
  db: Queryable,
  since: Date,
  limit = SLOWEST_REPOSITORY_LIMIT,
): Promise<RepositoryLag[]> {
  const result = await db.query<{
    repository_id: number;
    owner: string | null;
    name: string | null;
    lag_p95_seconds: string;
    sample_count: number;
  }>(
    `SELECT e.repository_id,
            r.owner,
            r.name,
            percentile_cont(0.95) WITHIN GROUP (ORDER BY extract(epoch FROM e.processed_at - e.received_at))
              AS lag_p95_seconds,
            count(*)::int AS sample_count
       FROM raw_event e
       -- 미등록 저장소의 이벤트도 지연 표본에는 들어간다. 이름만 비는 것이지
       -- 수집이 느린 사실 자체가 사라지면 안 된다.
       LEFT JOIN repository r ON r.repository_id = e.repository_id
      WHERE e.received_at >= $1 AND e.processed_at IS NOT NULL AND e.repository_id IS NOT NULL
      GROUP BY e.repository_id, r.owner, r.name
      ORDER BY lag_p95_seconds DESC
      LIMIT $2`,
    [since, limit],
  );

  return result.rows.map((row) => ({
    repository_id: row.repository_id,
    repository: row.owner === null || row.name === null ? null : `${row.owner}/${row.name}`,
    lag_p95_seconds: Number(row.lag_p95_seconds),
    sample_count: row.sample_count,
  }));
}
