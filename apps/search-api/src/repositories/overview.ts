/**
 * 저장소 수집 진단 (API-ING-002 / WP-034, CR-050 DEV-350).
 *
 * ## 왜 `/admin`이 아닌가
 *
 * W-009는 **일반 사용자** 화면이다. 같은 정보를 가진 `API-ADM-001`·`API-ADM-006`은
 * 둘 다 `operator` 전용이고, 후자의 제한은 FR-ADMIN-001 AC-4가 직접 승인한
 * 것이다. 권한을 완화하면 승인된 보안 계약을 뒤집으므로, 이 경로를 따로 세우고
 * 기존 권한은 한 글자도 건드리지 않는다.
 *
 * ## 접근 통제가 이 파일의 전부다
 *
 * 정본이 PostgreSQL `repository` 표라 `ScopedQuery` 타입 강제가 닿지 않는다
 * (ADR-008, DEV-130). 그 자리를 `isRepositoryInScope`가 메우며, **시퀀스 조회와
 * 같은 함수**를 쓴다 — 규칙이 갈라지면 한쪽 경로만 넓어지고 아무 오류도 나지
 * 않는다.
 *
 * Elasticsearch 집계는 PostgreSQL이 이미 범위를 걸렀더라도 **필수 필터를 다시
 * 지난다.** "앞 단계에서 확인했으니 생략한다"를 한 번 허용하면 그 자리가 곧
 * 우회 경로가 되고, 두 단계의 판정 기준이 갈라지는 순간 조용히 범위 밖 문서를
 * 세게 된다.
 *
 * ## N+1을 만들지 않는다
 *
 * 진단 축이 다섯이고 저장소가 페이지당 최대 100개다. 축마다 저장소를 돌면
 * 한 화면이 500번 질의한다 — 축마다 **한 번씩** 배치로 읽는다.
 */

import type { Client as EsClient } from '@elastic/elasticsearch';
import {
  jobRepo,
  rawEventRepo,
  repositoryRepo,
  sequenceSpaceRepo,
  type JobRow,
  type Pool,
  type RepositoryRow,
  type SequenceSpaceRow,
  type SequenceSpaceState,
} from '@prs/db';
import { applyMandatoryScopeFilter, isRepositoryInScope, search, type AccessScope } from '@prs/es';

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 100;

/**
 * 한 페이지를 채우려고 정본에서 읽는 배수.
 *
 * 접근 범위 판정이 SQL이 아니라 애플리케이션에 있으므로(규칙을 한 곳에 두기
 * 위해서다), 범위 밖 저장소가 섞인 만큼 더 읽어야 한 페이지가 찬다. 배수를
 * 두고 **찰 때까지 반복**한다 — 한 번만 더 읽고 마는 방식은 범위 밖이 몰려
 * 있는 구간에서 페이지를 조용히 짧게 만든다.
 */
const OVERSCAN = 4;
/** 반복 상한. 정본이 아무리 커도 한 요청이 끝난다. */
const MAX_SCAN_ROUNDS = 12;

export interface DocumentCounts {
  readonly pull_requests: number;
  readonly commits: number;
  readonly total: number;
}

export interface BackfillView {
  readonly state: string;
  readonly job_id: string;
  readonly progress: Record<string, unknown>;
}

export interface SequenceSpaceView {
  readonly base_branch: string;
  readonly last_sequence: number | null;
  readonly seq_epoch: number | null;
  readonly sequence_state: SequenceSpaceState;
  readonly last_assigned_at: string | null;
}

export interface ReconciliationView {
  readonly last_completed_at: string | null;
  readonly missing_count: number | null;
}

export interface RepositoryOverviewItem {
  readonly repository_id: number;
  readonly repository: string;
  readonly registration_state: string;
  readonly registered_at: string;
  readonly last_ingested_at: string | null;
  readonly document_counts: DocumentCounts | null;
  readonly backfill: BackfillView | null;
  readonly sequence_spaces: readonly SequenceSpaceView[];
  readonly reconciliation: ReconciliationView;
  /** 이번 응답에서 채우지 못한 항목 이름. */
  readonly unavailable: readonly string[];
}

export interface OverviewPage {
  readonly items: readonly RepositoryOverviewItem[];
  readonly nextCursor: { readonly owner: string; readonly name: string; readonly repositoryId: number } | null;
}

export interface OverviewDeps {
  readonly pool: Pool;
  readonly es: EsClient;
  readonly log?: (entry: { readonly level: string; readonly message: string; readonly reason?: string }) => void;
}

export interface OverviewQuery {
  readonly scope: AccessScope;
  readonly limit: number;
  readonly after?: { readonly owner: string; readonly name: string; readonly repositoryId: number };
  readonly slug?: { readonly owner: string; readonly name: string };
}

export function clampPageSize(raw: unknown): number | null {
  if (raw === undefined || raw === null || raw === '') return DEFAULT_PAGE_SIZE;
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isSafeInteger(n) || n < 1 || n > MAX_PAGE_SIZE) return null;
  return n;
}

/**
 * 접근 범위 안 저장소를 정렬 순서대로 한 페이지 모은다.
 *
 * **`isRepositoryInScope`가 유일한 판정자다.** SQL에 범위 조건을 복제하면
 * 규칙이 두 곳에 살고, PostgreSQL 배열 연산과 이 함수의 해석이 어긋나는 날
 * 아무 오류 없이 한쪽만 넓어진다.
 */
async function collectVisible(deps: OverviewDeps, query: OverviewQuery): Promise<{
  readonly rows: readonly RepositoryRow[];
  readonly hasMore: boolean;
}> {
  const visible: RepositoryRow[] = [];
  let after = query.after;

  for (let round = 0; round < MAX_SCAN_ROUNDS; round += 1) {
    const batch = await repositoryRepo.listRepositoryOverviewPage(
      deps.pool,
      { ...(query.slug === undefined ? {} : { slug: query.slug }), ...(after === undefined ? {} : { after }) },
      (query.limit + 1) * OVERSCAN,
    );
    if (batch.length === 0) break;

    for (const row of batch) {
      if (
        isRepositoryInScope(
          {
            repositoryId: row.repository_id,
            orgId: row.org_id,
            visibility: row.visibility,
            // 넷을 다 넘긴다 (CR-050, DEV-353). 빠지면 팀 소속 저장소가 조용히 사라진다.
            allowedTeamIds: row.allowed_team_ids,
          },
          query.scope,
        )
      ) {
        visible.push(row);
      }
    }

    const last = batch[batch.length - 1];
    if (last !== undefined) {
      after = { owner: last.owner, name: last.name, repositoryId: last.repository_id };
    }
    if (visible.length > query.limit) break;
    // 정본을 끝까지 읽었다 — 더 읽어도 나올 것이 없다.
    if (batch.length < (query.limit + 1) * OVERSCAN) break;
  }

  /*
   * **정본을 다 읽었는지와 무관하다.** 끝까지 읽었더라도 범위 안 저장소가
   * `limit`보다 많으면 다음 페이지가 있다 — 두 조건을 묶으면 정본이 작은
   * 배치에서 커서가 조용히 끊기고, 사용자는 목록이 거기서 끝났다고 읽는다.
   */
  return { rows: visible.slice(0, query.limit), hasMore: visible.length > query.limit };
}

/**
 * 검색 대상 문서 수 (PR·커밋).
 *
 * **필수 접근 범위 필터를 지난다** — PostgreSQL에서 이미 걸렀다는 이유로
 * 생략하지 않는다 (ADR-008).
 *
 * 인덱스당 집계 한 번이다. `size: 0`이라 문서를 가져오지 않고, `terms`의
 * `size`를 저장소 수에 맞춰 잡아 버킷이 잘리지 않게 한다.
 */
async function countDocuments(
  es: EsClient,
  alias: 'prs-pull-requests' | 'prs-commits',
  repositoryIds: readonly number[],
  scope: AccessScope,
): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  if (repositoryIds.length === 0) return out;

  const scoped = applyMandatoryScopeFilter(
    { bool: { filter: [{ terms: { repository_id: [...repositoryIds] } }] } },
    scope,
  );
  const response = await search<unknown>(es, alias, scoped, {
    size: 0,
    aggregations: {
      by_repository: { terms: { field: 'repository_id', size: repositoryIds.length } },
    },
  });

  const agg = response.aggregations?.['by_repository'] as
    | { readonly buckets?: readonly { readonly key: number; readonly doc_count: number }[] }
    | undefined;
  for (const bucket of agg?.buckets ?? []) out.set(Number(bucket.key), bucket.doc_count);
  return out;
}

/**
 * 등록된 브랜치를 **전부** 싣는다 (CR-029 DEV-152와 같은 판단).
 *
 * 공간 행이 없는 브랜치는 `unknown`이며 `0`으로 그리지 않는다 — 목록에서 빼면
 * 사용자가 "등록이 안 됐다"로 오인하고, `0`으로 두면 "0번까지 채번됐다"는
 * 거짓이 된다. `stale`·`reassigning`에서도 마지막 확정 서수를 숨기지 않는다.
 */
function toSequenceViews(
  repository: RepositoryRow,
  spaces: readonly SequenceSpaceRow[],
): readonly SequenceSpaceView[] {
  const byBranch = new Map<string, SequenceSpaceRow>();
  for (const space of spaces) byBranch.set(space.base_branch, space);

  return repository.sequence_branches.map((branch) => {
    const space = byBranch.get(branch);
    if (space === undefined) {
      return {
        base_branch: branch,
        last_sequence: null,
        seq_epoch: null,
        sequence_state: 'unknown' as const,
        last_assigned_at: null,
      };
    }
    return {
      base_branch: branch,
      // `head_seq`는 `bigint`라 드라이버가 문자열로 준다. 다른 서수 응답과 같이
      // 숫자로 옮긴다 (`space.ts`·`sequence-integrity.ts`가 같은 변환을 한다).
      last_sequence: Number(space.head_seq),
      seq_epoch: space.seq_epoch,
      sequence_state: space.state,
      last_assigned_at: space.last_assigned_at?.toISOString() ?? null,
    };
  });
}

function toBackfillView(job: JobRow | undefined): BackfillView | null {
  if (job === undefined) return null;
  return { state: job.state, job_id: String(job.job_id), progress: job.progress };
}

/**
 * 한 축을 채운다. 실패하면 그 축만 `unavailable`이 되고 나머지는 그대로 나간다
 * (FR-ING-009 예외 처리).
 *
 * **카드 전체를 오류로 만들지 않는다** — 사용자가 확인하러 온 다른 사실까지
 * 잃는다.
 */
async function axis<T>(
  name: string,
  failed: string[],
  deps: OverviewDeps,
  load: () => Promise<T>,
): Promise<T | null> {
  try {
    return await load();
  } catch (error) {
    failed.push(name);
    deps.log?.({
      level: 'warn',
      message: `저장소 진단 항목 조회 실패: ${name}`,
      reason: String(error).slice(0, 200),
    });
    return null;
  }
}

export async function loadRepositoryOverview(
  deps: OverviewDeps,
  query: OverviewQuery,
): Promise<OverviewPage> {
  const { rows, hasMore } = await collectVisible(deps, query);
  if (rows.length === 0) return { items: [], nextCursor: null };

  const ids = rows.map((row) => row.repository_id);
  const slugs = rows.map((row) => `${row.owner}/${row.name}`);
  const failed: string[] = [];

  const [lastIngested, prCounts, commitCounts, backfills, spaces] = await Promise.all([
    axis('last_ingested_at', failed, deps, () => rawEventRepo.lastReceivedAtByRepository(deps.pool, ids)),
    axis('document_counts', failed, deps, () =>
      countDocuments(deps.es, 'prs-pull-requests', ids, query.scope),
    ),
    axis('document_counts', failed, deps, () =>
      countDocuments(deps.es, 'prs-commits', ids, query.scope),
    ),
    axis('backfill', failed, deps, () => jobRepo.latestJobsByTarget(deps.pool, 'backfill', slugs)),
    axis('sequence_spaces', failed, deps, () =>
      sequenceSpaceRepo.listSpacesForRepositories(deps.pool, ids),
    ),
  ]);

  const spacesByRepository = new Map<number, SequenceSpaceRow[]>();
  for (const space of spaces ?? []) {
    const list = spacesByRepository.get(space.repository_id) ?? [];
    list.push(space);
    spacesByRepository.set(space.repository_id, list);
  }

  /*
   * 문서 수는 두 인덱스가 함께 성립해야 뜻이 있다. 한쪽만 실패하면 합계가
   * 거짓이 되므로 **둘 다 없을 때와 같이** 미확인으로 둔다 — 절반의 합계를
   * 내놓으면 사용자는 그것을 전체로 읽는다.
   */
  const countsAvailable = prCounts !== null && commitCounts !== null;
  const unavailableCommon = [...new Set(failed)];

  const items: RepositoryOverviewItem[] = rows.map((row) => {
    const slug = `${row.owner}/${row.name}`;
    const pr = prCounts?.get(row.repository_id) ?? 0;
    const commit = commitCounts?.get(row.repository_id) ?? 0;
    return {
      repository_id: row.repository_id,
      repository: slug,
      registration_state: row.status,
      registered_at: row.registered_at.toISOString(),
      last_ingested_at: lastIngested?.get(row.repository_id)?.toISOString() ?? null,
      document_counts: countsAvailable ? { pull_requests: pr, commits: commit, total: pr + commit } : null,
      backfill: backfills === null ? null : toBackfillView(backfills.get(slug)),
      sequence_spaces: toSequenceViews(row, spacesByRepository.get(row.repository_id) ?? []),
      reconciliation: {
        last_completed_at: row.last_reconciled_at?.toISOString() ?? null,
        missing_count: row.last_reconcile_missing_count,
      },
      unavailable: unavailableCommon,
    };
  });

  const last = rows[rows.length - 1];
  const nextCursor =
    hasMore && last !== undefined
      ? { owner: last.owner, name: last.name, repositoryId: last.repository_id }
      : null;

  return { items, nextCursor };
}
