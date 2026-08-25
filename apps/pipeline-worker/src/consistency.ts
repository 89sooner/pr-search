/**
 * PostgreSQL↔Elasticsearch 정합성 감시 (JOB-ING-008 / WP-028, ADR-004, CR-033).
 *
 * ADR-004는 "Elasticsearch는 PostgreSQL만으로 전량 재구축 가능한 파생 뷰이며,
 * 어떤 데이터도 검색 인덱스에만 존재해서는 안 된다"고 정한다. **그 불변식을
 * 실제로 확인하는 잡은 이것뿐이다** — 그래서 범위에서 빼지 않았다 (DEV-174).
 *
 * ## 왼쪽은 `raw_event`다
 *
 * 이 스키마에 정규화된 `pull_request` 표는 없다. ADR-004가 "재생의 진짜 소스는
 * PostgreSQL의 `raw_event`"라고 정하고 엔티티는 그 원본에서 재구성된다. 대조의
 * 정본 쪽을 그 표에서 뽑는 이유이며, 없는 표를 가정하면 이 잡은 ADR-004가 아닌
 * 다른 것을 검증하게 된다.
 *
 * ## 두 층을 가른다
 *
 * 개수 대조는 싸고 전체를 본다. 내용 대조는 비싸서 표본만 본다. 하나로 뭉치면
 * "개수는 맞는데 내용이 다른" 경우(투영이 옛 문서를 덮어쓰지 못한 상태)가
 * 보이지 않는다.
 *
 * ## 지우지 않는다
 *
 * ES에만 있는 잉여 문서는 **자동 삭제하지 않는다** (DEV-174). 투영이 아직
 * 도착하지 않은 것과 정말로 잉여인 것을 이 잡은 가릴 수 없고, 삭제는 별도로
 * 승인된 계약 없이 수행할 일이 아니다. 불일치로 보고·경보만 한다. 반대 방향
 * (PG에 있고 ES에 없음)은 **재투영이 멱등**이므로 안전하게 되돌릴 수 있다.
 */

import { repositoryRepo } from '@prs/db';
import type { Pool, RepositoryRow } from '@prs/db';
import { applyMandatoryScopeFilter, search } from '@prs/es';
import type { Client } from '@elastic/elasticsearch';
import type { WorkerMetrics } from './metrics.js';

/** 스케줄: 6시간 (비동기 문서 9장). */
export const CONSISTENCY_INTERVAL_MS = 6 * 60 * 60 * 1000;
/** 내용 대조 표본 크기. FR-ADMIN-003 AC-2와 같은 값으로 둔다 (CR-033, DEV-174). */
export const CONSISTENCY_SAMPLE_SIZE = 1000;

export type MismatchKind = 'count' | 'content' | 'missing_in_es' | 'extra_in_es';

/**
 * 조사 가능한 근거.
 *
 * **민감 페이로드와 소스 코드는 넣지 않는다** — 식별자와 개수만 남긴다
 * (NFR-005). 이 보고는 로그로 나가고 로그는 사내 저장소에 오래 남는다.
 */
export interface ConsistencyReport {
  readonly repository: string;
  readonly index: string;
  readonly kind: MismatchKind;
  readonly observedAt: string;
  readonly postgresCount: number;
  readonly elasticsearchCount: number;
  /** 최대 20건. 전부 실으면 로그 한 줄이 수 MB가 된다. */
  readonly sampleIdentifiers: readonly string[];
}

export interface ConsistencyLogFields {
  readonly level: 'info' | 'warn' | 'error';
  readonly message: string;
  readonly repository?: string;
  readonly report?: string;
  readonly reason?: string;
}

export interface ConsistencyDeps {
  readonly pool: Pool;
  readonly es: Client;
  readonly metrics: WorkerMetrics;
  readonly log?: (fields: ConsistencyLogFields) => void;
  readonly now?: () => Date;
  readonly sleep?: (ms: number) => Promise<void>;
  /**
   * PG에 있고 ES에 없는 문서의 재투영 예약. 없으면 보고만 한다.
   *
   * **멱등한 경로만 받는다** — 재투영은 `document_version` 조건부 업서트라
   * 여러 번 돌아도 결과가 같다 (FR-ING-005 AC-1).
   */
  readonly requestReprojection?: (repositoryId: number, prNumbers: readonly number[]) => Promise<void>;
}

const MAX_SAMPLE_IDENTIFIERS = 20;

/*
 * ## 정본은 `raw_event`다
 *
 * 이 스키마에는 정규화된 `pull_request` 표가 없다. ADR-004가 "재생의 진짜
 * 소스는 PostgreSQL의 `raw_event`"라고 못 박고 있고, 엔티티는 그 원본을 다시
 * 흘려 재구성한다. 그래서 대조의 왼쪽은 `raw_event`에서 뽑은 **PR 번호 집합**
 * 이다 — 없는 표를 가정하면 이 잡은 ADR-004가 아니라 다른 무언가를 검증한다.
 *
 * PR 번호는 페이로드 안에 있다. `raw_event_repo_idx (repository_id,
 * received_at DESC)`가 저장소 슬라이스를 좁혀 주고, 6시간 주기 잡이라 이
 * 비용은 감당할 수 있다. 표본 상한이 그 위에 한 번 더 걸린다.
 */
const PR_NUMBER_PATH = "payload->'pull_request'->>'number'";

/** 정본이 아는 PR 번호 — 최근 수신분부터 표본 크기까지. */
async function postgresPullRequests(pool: Pool, repositoryId: number): Promise<readonly number[]> {
  const result = await pool.query<{ pr_number: string }>(
    `SELECT DISTINCT (${PR_NUMBER_PATH})::bigint AS pr_number
       FROM raw_event
      WHERE repository_id = $1 AND event_type = 'pull_request' AND ${PR_NUMBER_PATH} IS NOT NULL
      ORDER BY pr_number DESC
      LIMIT $2`,
    [repositoryId, CONSISTENCY_SAMPLE_SIZE],
  );
  return result.rows.map((row) => Number(row.pr_number));
}

/** 정본이 아는 서로 다른 PR 수. 같은 PR의 이벤트 여러 건은 한 번만 센다. */
async function postgresCount(pool: Pool, repositoryId: number): Promise<number> {
  const result = await pool.query<{ count: string }>(
    `SELECT count(DISTINCT ${PR_NUMBER_PATH})::text AS count
       FROM raw_event
      WHERE repository_id = $1 AND event_type = 'pull_request'`,
    [repositoryId],
  );
  return Number(result.rows[0]?.count ?? 0);
}

/** 색인이 아는 PR 번호. 범위는 대상 저장소 하나다 (ADR-008을 우회하지 않는다). */
async function elasticsearchPullRequests(
  deps: ConsistencyDeps,
  repositoryId: number,
): Promise<{ readonly total: number; readonly numbers: ReadonlySet<number> }> {
  const scoped = applyMandatoryScopeFilter(
    { bool: { filter: [{ term: { repository_id: repositoryId } }] } },
    { kind: 'explicit', repositoryIds: [repositoryId] },
  );
  const response = await search<{ pr_number?: number }>(deps.es, 'prs-pull-requests', scoped, {
    size: CONSISTENCY_SAMPLE_SIZE,
    routing: String(repositoryId),
    _source: ['pr_number'],
    sort: [{ pr_number: 'desc' }],
    track_total_hits: true,
  });
  const total =
    typeof response.hits.total === 'number' ? response.hits.total : (response.hits.total?.value ?? 0);
  const numbers = new Set<number>();
  for (const hit of response.hits.hits) {
    if (hit._source?.pr_number !== undefined) numbers.add(hit._source.pr_number);
  }
  return { total, numbers };
}

/** 한 저장소의 두 층을 대조한다. */
export async function checkRepositoryConsistency(
  deps: ConsistencyDeps,
  repository: RepositoryRow,
): Promise<readonly ConsistencyReport[]> {
  const slug = `${repository.owner}/${repository.name}`;
  const observedAt = (deps.now ?? ((): Date => new Date()))().toISOString();
  const reports: ConsistencyReport[] = [];

  const [pgTotal, pgSample, esSide] = await Promise.all([
    postgresCount(deps.pool, repository.repository_id),
    postgresPullRequests(deps.pool, repository.repository_id),
    elasticsearchPullRequests(deps, repository.repository_id),
  ]);

  // 1층: 개수. 싸고 전체를 본다.
  if (pgTotal !== esSide.total) {
    reports.push({
      repository: slug,
      index: 'prs-pull-requests',
      kind: 'count',
      observedAt,
      postgresCount: pgTotal,
      elasticsearchCount: esSide.total,
      sampleIdentifiers: [],
    });
  }

  // 2층: 표본 내용. 어느 쪽에 없는지를 가른다 — 조치가 다르기 때문이다.
  const missingInEs = pgSample.filter((number) => !esSide.numbers.has(number));
  if (missingInEs.length > 0) {
    reports.push({
      repository: slug,
      index: 'prs-pull-requests',
      kind: 'missing_in_es',
      observedAt,
      postgresCount: pgSample.length,
      elasticsearchCount: esSide.numbers.size,
      sampleIdentifiers: missingInEs.slice(0, MAX_SAMPLE_IDENTIFIERS).map(String),
    });
    /*
     * 정본에 있고 색인에 없다 — **재투영으로 되돌릴 수 있다.** 조건부 업서트라
     * 멱등하므로 중복 예약이 해를 끼치지 않는다.
     */
    if (deps.requestReprojection !== undefined) {
      await deps.requestReprojection(repository.repository_id, missingInEs);
    }
  }

  const pgSet = new Set(pgSample);
  const extraInEs = [...esSide.numbers].filter((number) => !pgSet.has(number));
  if (extraInEs.length > 0) {
    /*
     * 색인에만 있다. **지우지 않는다** (DEV-174) — 표본 경계 밖의 정본 행일 수도
     * 있고, 정말 잉여여도 삭제는 승인된 계약 없이 할 일이 아니다. 보고만 한다.
     */
    reports.push({
      repository: slug,
      index: 'prs-pull-requests',
      kind: 'extra_in_es',
      observedAt,
      postgresCount: pgSample.length,
      elasticsearchCount: esSide.numbers.size,
      sampleIdentifiers: extraInEs.slice(0, MAX_SAMPLE_IDENTIFIERS).map(String),
    });
  }

  return reports;
}

export async function runConsistencySweep(deps: ConsistencyDeps): Promise<{
  readonly repositories: number;
  readonly mismatches: number;
}> {
  const log = deps.log ?? ((): void => undefined);
  const repositories = await repositoryRepo.listRepositories(deps.pool, { status: 'active' });
  let mismatches = 0;

  for (const repository of repositories) {
    try {
      const reports = await checkRepositoryConsistency(deps, repository);
      for (const report of reports) {
        mismatches += 1;
        deps.metrics.projectionConsistencyMismatch.inc({ index: report.index, kind: report.kind });
        log({
          level: 'warn',
          message: `PG↔ES 불일치 — ${report.kind}`,
          repository: report.repository,
          report: JSON.stringify(report),
        });
      }
    } catch (error) {
      log({
        level: 'error',
        message: '정합성 감시 실패',
        repository: `${repository.owner}/${repository.name}`,
        reason: String(error).slice(0, 200),
      });
    }
  }

  return { repositories: repositories.length, mismatches };
}

export interface ConsistencySweeper {
  stop(): Promise<void>;
}

/** 주기 정합성 감시. `startReleaseSweeper`와 같은 형태다 (깨울 수 있는 sleep). */
export function startConsistencySweeper(
  deps: ConsistencyDeps,
  options: { readonly intervalMs?: number } = {},
): ConsistencySweeper {
  const interval = options.intervalMs ?? CONSISTENCY_INTERVAL_MS;
  const log = deps.log ?? ((): void => undefined);
  let stopped = false;

  let wake: () => void = () => undefined;
  const interruptibleSleep = (ms: number): Promise<void> =>
    new Promise((resolve) => {
      const timer = setTimeout(() => {
        wake = () => undefined;
        resolve();
      }, ms);
      wake = (): void => {
        clearTimeout(timer);
        wake = () => undefined;
        resolve();
      };
    });
  const sleep = deps.sleep ?? interruptibleSleep;

  const loop = (async (): Promise<void> => {
    while (!stopped) {
      try {
        const result = await runConsistencySweep(deps);
        log({
          level: result.mismatches > 0 ? 'warn' : 'info',
          message: `정합성 감시 완료 — 저장소 ${String(result.repositories)}개, 불일치 ${String(result.mismatches)}`,
        });
      } catch (error) {
        log({ level: 'error', message: '정합성 감시 스윕 실패', reason: String(error).slice(0, 200) });
      }
      if (stopped) break;
      await sleep(interval);
    }
  })();

  return {
    async stop(): Promise<void> {
      stopped = true;
      wake();
      await loop;
    },
  };
}
