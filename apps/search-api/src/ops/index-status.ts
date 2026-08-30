/**
 * API-ADM-004 `GET` 인덱스 상태 (WP-040 / FR-ING-008 AC-7, CR-055).
 *
 * `A-003-INDEX`가 그릴 값을 준다 — 별칭과 실제 인덱스의 대응, 문서 수, 크기,
 * 진행 중인 재색인과 그 단계, 최근 재색인 이력.
 *
 * ## 새 API ID를 만들지 않았다
 *
 * 별칭의 현재 상태와 그 별칭을 바꾸는 실행은 같은 것을 다루므로 자원이 하나다.
 * `API-ADM-004`의 `GET`으로 연다.
 *
 * ## 새 이력 표를 만들지 않았다
 *
 * 재색인 이력의 정본은 `job` 행의 `progress`다 (`source_index`·`target_index`·
 * `switched_at`). `CR-045`(DEV-299)가 보관 정리의 입력으로 그것을 이미 쓰고
 * 있으므로 여기서 표를 새로 만들면 같은 사실이 두 곳에 살고 한쪽만 낡는다.
 *
 * ## 모르는 값을 0으로 채우지 않는다
 *
 * **크기를 모르는 것과 인덱스가 빈 것은 다른 사실이다.** 후자로 적으면 운영자가
 * 재색인이 실패했다고 읽는다. 읽지 못한 값은 `null`이고 그 이름이
 * `unavailable`에 들어간다 — `API-ADM-006`의 부분 실패 규칙과 같다.
 */

import { reindexRepo, type JobRow, type Pool } from '@prs/db';
import type { AliasIndexStats } from '@prs/es';

/** 별칭별 색인 상태를 읽는 포트. `@prs/es`의 `indexStatsPort`가 구현한다. */
export interface IndexStatsPort {
  aliases(): readonly string[];
  stats(alias: string): Promise<AliasIndexStats>;
}

export interface IndexStatusDeps {
  readonly pool: Pool;
  readonly stats: IndexStatsPort;
  readonly now?: () => Date;
}

interface ActiveReindexView {
  readonly job_id: number;
  readonly phase: string | null;
  readonly target_index: string | null;
  readonly dual_write_since: string | null;
}

interface LastReindexView {
  readonly job_id: number;
  readonly state: string;
  readonly switched_at: string | null;
}

interface AliasStatusView {
  readonly alias: string;
  readonly current_index: string | null;
  readonly document_count: number | null;
  readonly store_size_bytes: number | null;
  readonly active_reindex: ActiveReindexView | null;
  readonly last_reindex: LastReindexView | null;
}

export interface IndexStatusResponse {
  readonly generated_at: string;
  readonly aliases: readonly AliasStatusView[];
  readonly unavailable: readonly string[];
}

/** `progress`에서 문자열 하나를 꺼낸다. 없거나 모양이 다르면 `null`이다. */
function progressString(progress: JobRow['progress'], key: string): string | null {
  if (typeof progress !== 'object' || progress === null) return null;
  const value = (progress as Record<string, unknown>)[key];
  return typeof value === 'string' && value !== '' ? value : null;
}

function toActiveView(row: JobRow): ActiveReindexView {
  return {
    job_id: row.job_id,
    phase: progressString(row.progress, 'phase'),
    target_index: progressString(row.progress, 'target_index'),
    dual_write_since: progressString(row.progress, 'dual_write_since'),
  };
}

function toLastView(row: JobRow): LastReindexView {
  return {
    job_id: row.job_id,
    state: row.state,
    switched_at: progressString(row.progress, 'switched_at'),
  };
}

/**
 * 별칭 전부의 상태를 모은다.
 *
 * **별칭 하나가 실패해도 나머지는 정상 반환한다.** 한 별칭의 인덱스가 아직
 * 없다는 것은 다른 별칭의 값을 못 읽을 이유가 아니다.
 *
 * `unavailable`의 이름은 `<별칭>.<필드>` 형식이다 — 어느 별칭의 어느 값이
 * 비었는지 화면이 알아야 그 자리만 미확인으로 그린다.
 */
export async function indexStatus(deps: IndexStatusDeps): Promise<IndexStatusResponse> {
  const now = (deps.now ?? ((): Date => new Date()))();
  const unavailable: string[] = [];

  const aliases = await Promise.all(
    deps.stats.aliases().map(async (alias): Promise<AliasStatusView> => {
      const stats = await deps.stats.stats(alias);
      if (stats.currentIndex === null) unavailable.push(`${alias}.current_index`);
      if (stats.documentCount === null) unavailable.push(`${alias}.document_count`);
      if (stats.storeSizeBytes === null) unavailable.push(`${alias}.store_size_bytes`);

      /*
       * 잡 조회는 별칭마다 독립이며 실패해도 색인 통계를 버리지 않는다 —
       * PostgreSQL이 잠깐 답하지 못했다고 "인덱스가 없다"로 읽히면 안 된다.
       */
      let active: JobRow | undefined;
      let last: JobRow | undefined;
      try {
        active = await reindexRepo.findActiveReindexFor(deps.pool, alias);
        last = await reindexRepo.findLastReindexFor(deps.pool, alias);
      } catch {
        unavailable.push(`${alias}.reindex_history`);
      }

      return {
        alias,
        current_index: stats.currentIndex,
        document_count: stats.documentCount,
        store_size_bytes: stats.storeSizeBytes,
        active_reindex: active === undefined ? null : toActiveView(active),
        last_reindex: last === undefined ? null : toLastView(last),
      };
    }),
  );

  return {
    generated_at: now.toISOString(),
    aliases,
    // 순서를 고정한다 — 같은 상태에서 같은 응답이 나와야 시험이 걸린다.
    unavailable: [...unavailable].sort(),
  };
}

