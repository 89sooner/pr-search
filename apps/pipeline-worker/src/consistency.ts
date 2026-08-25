/**
 * PostgreSQL↔Elasticsearch 정합성 감시 (JOB-ING-008 / WP-028, ADR-004, CR-033).
 *
 * ADR-004는 "Elasticsearch는 PostgreSQL만으로 전량 재구축 가능한 파생 뷰이며,
 * 어떤 데이터도 검색 인덱스에만 존재해서는 안 된다"고 정한다. **그 불변식을
 * 실제로 확인하는 잡은 이것뿐이다** — 그래서 범위에서 빼지 않았다 (DEV-174).
 *
 * ## 왼쪽은 `pull_request_snapshot`이다 (CR-034, DEV-184)
 *
 * 처음에는 `raw_event`를 정본으로 삼았다. 그런데 **백필·조정 스캔은 `raw_event`를
 * 남기지 않는다** — GHE에서 직접 읽어 색인에만 쓴다. 그래서 정상적으로 백필된 PR이
 * 전부 `extra_in_es`로 보고됐다. 감시가 자기 눈금을 잘못 들고 있었던 것이고,
 * 동시에 **ADR-004의 불변식이 그 경로에서 실제로 깨져 있었다.**
 *
 * 마이그레이션 010이 두 투영 경로가 함께 남기는 스냅숏을 세웠고, 이제 대조의
 * 왼쪽은 그 표다 — 재구성 근거와 대조 근거가 **같은 것**이다.
 *
 * ## 두 층을 가른다
 *
 * 개수 대조는 싸고 전체를 본다. 내용 대조는 비싸서 표본만 본다. 하나로 뭉치면
 * "개수는 맞는데 내용이 다른" 경우(투영이 옛 문서를 덮어쓰지 못한 상태)가
 * 보이지 않는다.
 *
 * ## 내용 대조는 **내용을 본다** (CR-034, DEV-181)
 *
 * 처음 구현은 양쪽에서 `pr_number`만 꺼내 집합을 비교했다. 그것은 **식별자
 * 대조**이지 내용 대조가 아니다 — 같은 번호가 양쪽에 있으면서 제목·상태·브랜치가
 * 어긋난 상태를 한 건도 잡지 못했고, `content` 종류는 도달할 수 없는 값이었다.
 *
 * 지금은 정본과 색인에서 **같은 정규 필드 집합**을 뽑아 결정론적 지문을 만들어
 * 비교한다. 보고에는 지문만 남긴다 — 제목·본문 원문을 운영 로그에 복사하지
 * 않는다 (NFR-005).
 *
 * ## 지우지 않는다
 *
 * ES에만 있는 잉여 문서는 **자동 삭제하지 않는다** (DEV-174). 투영이 아직
 * 도착하지 않은 것과 정말로 잉여인 것을 이 잡은 가릴 수 없고, 삭제는 별도로
 * 승인된 계약 없이 수행할 일이 아니다. 불일치로 보고·경보만 한다. 반대 방향
 * (PG에 있고 ES에 없음)은 **재투영이 멱등**이므로 안전하게 되돌릴 수 있다.
 */

import { prSnapshotRepo, repositoryRepo } from '@prs/db';
import { createHash } from 'node:crypto';
import type { Pool, RepositoryRow } from '@prs/db';
import { applyMandatoryScopeFilter, search } from '@prs/es';
import type { Client } from '@elastic/elasticsearch';
import type { WorkerMetrics } from './metrics.js';

/** 스케줄: 6시간 (비동기 문서 9장). */
export const CONSISTENCY_INTERVAL_MS = 6 * 60 * 60 * 1000;
/** 내용 대조 표본 크기. FR-ADMIN-003 AC-2와 같은 값으로 둔다 (CR-033, DEV-174). */
export const CONSISTENCY_SAMPLE_SIZE = 1000;

export type MismatchKind =
  | 'count'
  | 'content'
  | 'missing_in_es'
  | 'extra_in_es'
  /**
   * 정본 부트스트랩이 아직 끝나지 않았다 (CR-037, DEV-195).
   *
   * **`extra_in_es`가 아니다.** "Elasticsearch가 잘못됐다"와 "PostgreSQL 정본
   * 부트스트랩이 아직 안 끝났다"는 다른 사실이고 조치도 다르다 — 앞의 것은
   * 조사할 손상이고 뒤의 것은 기다리면 사라지는 진행 상태다. 뭉쳐 보고하면
   * 운영자가 멀쩡한 색인을 의심하고, 그 소음에 **진짜 잉여 문서가 묻힌다.**
   */
  | 'snapshot_bootstrap_pending';

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

/**
 * 대조에 쓰는 정규 필드 (CR-034, DEV-181).
 *
 * **본문(`body`)은 넣지 않는다.** 대조에 필요하지 않고, 불일치 보고가 커지면
 * 운영 로그에 PR 본문이 그대로 복사된다 (NFR-005).
 */
export const CANONICAL_FIELDS = [
  'repository_id',
  'pr_number',
  'title',
  'state',
  'draft',
  'author',
  'base_branch',
  'head_branch',
  'merge_commit_sha',
  'created_at',
  'updated_at',
  'merged_at',
  'closed_at',
  'labels',
  'document_version',
] as const;

/**
 * 접근 통제에 쓰이는 필드 (CR-037, DEV-193).
 *
 * ## 왜 이것들이 대조에 있어야 하나
 *
 * `packages/es/src/scoped-query.ts`의 `org_team` 경로(저장소 500개를 넘긴
 * 사용자)는 `org_id`·`visibility`·`allowed_team_ids`를 **그대로 읽어** 필수 접근
 * 범위 필터를 만든다. 그 셋이 빠져 있으면 저장소 이전·공개 범위 변경·색인 손상
 * 뒤에 PostgreSQL과 Elasticsearch가 접근 통제 데이터에서 어긋나도 이 잡이
 * `consistent`라고 보고한다.
 *
 * **그것은 검색 데이터 drift가 아니라 authorization material drift다** — 잘못된
 * 조직에 결과를 노출하거나 정당한 결과를 감추는 상태를 감시가 통과시킨다.
 */
export const SCOPE_FIELDS = ['org_id', 'visibility', 'allowed_team_ids', 'repository_archived'] as const;

/**
 * 지문에 들어가는 전체 필드. **PostgreSQL 쪽과 Elasticsearch 쪽이 같은 목록을 쓴다.**
 *
 * 두 쪽이 다른 목록을 쓰면 대조가 언제나 불일치를 내거나(한쪽에만 있는 필드)
 * 언제나 일치를 낸다(양쪽에서 빠진 필드). 스키마는 하나여야 한다.
 */
export const FINGERPRINT_FIELDS = [...CANONICAL_FIELDS, ...SCOPE_FIELDS] as const;

/**
 * 저장소의 **현재** 접근 범위 상태 (CR-037, DEV-193).
 *
 * 정본은 `repository` 표다 — 스냅숏에 권한 상태를 중복 저장하지 않는다. 스냅숏은
 * 투영 당시의 사본을 담고 있지만, 그 뒤 팀이 회수되거나 공개 범위가 바뀌면
 * **그 사본이야말로 낡은 값**이다. 기대값은 언제나 지금의 레지스트리에서 만든다.
 */
export function repositoryScopeState(repository: RepositoryRow): Readonly<Record<string, unknown>> {
  return {
    org_id: repository.org_id,
    visibility: repository.visibility,
    allowed_team_ids: [...repository.allowed_team_ids],
    repository_archived: repository.status === 'archived',
  };
}

/** 순서가 의미 없는 모음은 정렬 후 비교한다 — 순서 차이는 불일치가 아니다. */
function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return [...(value as unknown[])].map(String).sort();
  return value ?? null;
}

/**
 * 결정론적 지문. 같은 내용이면 같은 문자열이 나온다.
 *
 * 필드를 **고정 순서**로 늘어놓아 JSON 키 순서에 기대지 않는다.
 */
export function fingerprint(document: Readonly<Record<string, unknown>>): string {
  const canonical = FINGERPRINT_FIELDS.map((field) => [field, canonicalValue(document[field])]);
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

interface SnapshotSide {
  readonly numbers: readonly number[];
  readonly fingerprints: ReadonlyMap<number, string>;
}

/**
 * 정본 쪽 표본 — `pull_request_snapshot` (CR-034, DEV-184).
 *
 * `raw_event`가 아니다: 백필·조정 스캔은 원본 이벤트를 남기지 않으므로 그 표를
 * 정본으로 삼으면 정상 백필 문서가 전부 잉여로 보고된다.
 */
async function postgresPullRequests(pool: Pool, repository: RepositoryRow): Promise<SnapshotSide> {
  const rows = await prSnapshotRepo.listSnapshots(pool, repository.repository_id, CONSISTENCY_SAMPLE_SIZE);
  /*
   * 엔티티 상태는 스냅숏이, **접근 범위는 레지스트리가** 준다 (CR-037, DEV-193).
   * 겹치면 레지스트리가 이긴다 — 팀 회수 뒤 스냅숏에 남은 옛 배열을 기대값으로
   * 삼으면 색인의 같은 옛 배열과 일치해 **유출 상태가 정상으로 보고된다.**
   */
  const scope = repositoryScopeState(repository);
  const fingerprints = new Map<number, string>();
  for (const row of rows) fingerprints.set(row.pr_number, fingerprint({ ...row.document, ...scope }));
  return { numbers: rows.map((row) => row.pr_number), fingerprints };
}

/** 정본이 아는 PR 수. */
async function postgresCount(pool: Pool, repositoryId: number): Promise<number> {
  return prSnapshotRepo.countSnapshots(pool, repositoryId);
}

/**
 * 색인 쪽 표본. 범위는 대상 저장소 하나다 (ADR-008을 우회하지 않는다).
 *
 * **정규 필드를 실제로 가져온다** (CR-034, DEV-181) — `pr_number`만 읽으면
 * 식별자 대조밖에 할 수 없고 `content` 불일치는 영영 나오지 않는다.
 */
async function elasticsearchPullRequests(
  deps: ConsistencyDeps,
  repositoryId: number,
): Promise<{ readonly total: number; readonly numbers: ReadonlySet<number>; readonly fingerprints: ReadonlyMap<number, string> }> {
  const scoped = applyMandatoryScopeFilter(
    { bool: { filter: [{ term: { repository_id: repositoryId } }] } },
    { kind: 'explicit', repositoryIds: [repositoryId] },
  );
  const response = await search<Record<string, unknown>>(deps.es, 'prs-pull-requests', scoped, {
    size: CONSISTENCY_SAMPLE_SIZE,
    routing: String(repositoryId),
    _source: [...FINGERPRINT_FIELDS],
    sort: [{ pr_number: 'desc' }],
    track_total_hits: true,
  });
  const total =
    typeof response.hits.total === 'number' ? response.hits.total : (response.hits.total?.value ?? 0);
  const numbers = new Set<number>();
  const fingerprints = new Map<number, string>();
  for (const hit of response.hits.hits) {
    const source = hit._source;
    const prNumber = source?.['pr_number'];
    if (typeof prNumber !== 'number') continue;
    numbers.add(prNumber);
    fingerprints.set(prNumber, fingerprint(source ?? {}));
  }
  return { total, numbers, fingerprints };
}

/** 한 저장소의 두 층을 대조한다. */
export async function checkRepositoryConsistency(
  deps: ConsistencyDeps,
  repository: RepositoryRow,
): Promise<readonly ConsistencyReport[]> {
  const slug = `${repository.owner}/${repository.name}`;
  const observedAt = (deps.now ?? ((): Date => new Date()))().toISOString();
  const reports: ConsistencyReport[] = [];

  const [pgTotal, pgSide, esSide] = await Promise.all([
    postgresCount(deps.pool, repository.repository_id),
    postgresPullRequests(deps.pool, repository),
    elasticsearchPullRequests(deps, repository.repository_id),
  ]);
  const pgSample = pgSide.numbers;

  /*
   * ---- 부트스트랩 이전 상태를 손상으로 확정하지 않는다 (CR-037, DEV-195).
   *
   * 스냅숏이 아직 완전하다고 확인되지 않은 저장소는 개수도 식별자도 당연히
   * 어긋난다. 그것을 `count`·`extra_in_es`로 적으면 **정상적인 진행 상태가
   * 색인 손상으로 보고된다.** 진행 상태를 그 이름으로 부르고, 대조는 여기서
   * 멈춘다 — 기대값 자체가 아직 완성되지 않았으므로 그 위의 판정은 전부 무의미하다.
   *
   * `content` 대조도 하지 않는다: 표본에 든 일부 스냅숏이 맞더라도, 그 표본이
   * 전체를 대표한다는 근거가 없다.
   */
  if (repository.snapshot_bootstrapped_at === null) {
    return [
      {
        repository: slug,
        index: 'prs-pull-requests',
        kind: 'snapshot_bootstrap_pending',
        observedAt,
        postgresCount: pgTotal,
        elasticsearchCount: esSide.total,
        sampleIdentifiers: [],
      },
    ];
  }

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

  /*
   * 2층-b: **양쪽에 있는 것의 내용**. 여기가 `content`다 (CR-034, DEV-181).
   * 개수와 식별자가 같아도 투영이 옛 문서를 덮어쓰지 못했으면 여기서만 보인다.
   */
  const drifted = pgSample.filter((number) => {
    const expected = pgSide.fingerprints.get(number);
    const actual = esSide.fingerprints.get(number);
    return expected !== undefined && actual !== undefined && expected !== actual;
  });
  if (drifted.length > 0) {
    reports.push({
      repository: slug,
      index: 'prs-pull-requests',
      kind: 'content',
      observedAt,
      postgresCount: pgSample.length,
      elasticsearchCount: esSide.numbers.size,
      sampleIdentifiers: drifted.slice(0, MAX_SAMPLE_IDENTIFIERS).map(String),
    });
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
