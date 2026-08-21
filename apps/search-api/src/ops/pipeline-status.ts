/**
 * 파이프라인 상태 (API-ADM-006, FR-ADMIN-001).
 *
 * **항목마다 출처가 다르다** (CR-013, DEV-029). 수신량·수집 반영 지연·저장소별
 * 상위 10은 PostgreSQL에서 정확히 계산하고, 대기열은 Redis, 실패 대기열은
 * PostgreSQL, 보강 대기는 Elasticsearch에서 읽는다. 캐시하지 않으므로 신선도는
 * 요청 시점이며 AC-2의 30초를 만족한다.
 *
 * 단계별 지연만 예외다. 그 값의 생산자는 워커 프로세스의 히스토그램이라
 * `search-api`가 읽을 수 없다. 지표 저장소가 설정되어 있으면 질의하고, 없으면
 * `unavailable`로 둔다 — **워커 복제본 하나를 긁어 클러스터 전체인 양 내놓지
 * 않는다.**
 *
 * 한 출처가 죽어도 나머지는 정상 반환한다 (FR-ADMIN-001 예외 처리). 실패한
 * 항목 이름은 `unavailable` 배열에 담긴다.
 */

import type { Client as EsClient } from '@elastic/elasticsearch';
import { deadLetterRepo, pipelineRepo, type Pool } from '@prs/db';
import type { DeadLetterState, RepositoryLag } from '@prs/db';
import { TOPICS, type EventBus } from '@prs/bus';

/** 수신량을 세는 창. AC-1이 "분당"이라고 정했다. */
export const INTAKE_WINDOW_MS = 60 * 1_000;

/** 상태를 보고할 스트림. `prs:batch`·`prs:permission`은 수집 경로가 아니다. */
export const REPORTED_TOPICS = [TOPICS.ingest, TOPICS.enriched, TOPICS.projected] as const;

export interface PipelineStatusDeps {
  readonly pool: Pool;
  readonly bus: EventBus;
  readonly es: EsClient;
  /** 지표 저장소 질의 주소. `null`이면 단계별 지연을 채우지 않는다. */
  readonly metricsQueryUrl: string | null;
  readonly now?: () => Date;
  readonly log?: (entry: { readonly level: string; readonly message: string; readonly reason?: string }) => void;
}

export interface LagSummary {
  readonly p50: number | null;
  readonly p95: number | null;
  readonly sample_count: number;
}

export interface PipelineStatus {
  readonly generated_at: string;
  readonly intake_per_minute: number | null;
  readonly queue_depth: Readonly<Record<string, number>> | null;
  readonly ingestion_lag_seconds: LagSummary | null;
  readonly stage_latency_seconds: Readonly<Record<string, LagSummary>> | null;
  readonly dead_letter: Readonly<Record<DeadLetterState, number>> | null;
  readonly enrichment_pending: number | null;
  readonly slowest_repositories: readonly RepositoryLag[] | null;
  /** 이번 응답에서 채우지 못한 항목. 비어 있으면 전부 정상이다. */
  readonly unavailable: readonly string[];
}

/**
 * 한 항목을 채운다. 실패하면 `null`을 두고 이름을 `unavailable`에 남긴다.
 *
 * 한 출처의 장애가 화면 전체를 비우면 운영자는 "무엇이 죽었는지"를 알 수 없다.
 */
async function section<T>(
  name: string,
  unavailable: string[],
  deps: PipelineStatusDeps,
  load: () => Promise<T>,
): Promise<T | null> {
  try {
    return await load();
  } catch (error) {
    unavailable.push(name);
    deps.log?.({
      level: 'error',
      message: `파이프라인 상태 항목을 채우지 못했다: ${name}`,
      reason: error instanceof Error ? error.name : 'unknown',
    });
    return null;
  }
}

export async function pipelineStatus(deps: PipelineStatusDeps): Promise<PipelineStatus> {
  const now = (deps.now ?? ((): Date => new Date()))();
  const unavailable: string[] = [];
  const intakeSince = new Date(now.getTime() - INTAKE_WINDOW_MS);
  const lagSince = new Date(now.getTime() - pipelineRepo.LAG_SAMPLE_WINDOW_MS);

  const [intake, queueDepth, lag, deadLetter, enrichmentPending, slowest, stageLatency] = await Promise.all([
    section('intake_per_minute', unavailable, deps, () =>
      pipelineRepo.countRecentIntake(deps.pool, intakeSince),
    ),
    section('queue_depth', unavailable, deps, async () => {
      const entries = await Promise.all(
        REPORTED_TOPICS.map(async (topic) => [topic, await deps.bus.depth(topic)] as const),
      );
      return Object.fromEntries(entries);
    }),
    section('ingestion_lag_seconds', unavailable, deps, () =>
      pipelineRepo.ingestionLagPercentiles(deps.pool, lagSince),
    ),
    section('dead_letter', unavailable, deps, () => deadLetterRepo.countsByState(deps.pool)),
    section('enrichment_pending', unavailable, deps, () => countEnrichmentPending(deps.es)),
    section('slowest_repositories', unavailable, deps, () =>
      pipelineRepo.slowestRepositories(deps.pool, lagSince),
    ),
    stageLatencies(deps, unavailable),
  ]);

  return {
    generated_at: now.toISOString(),
    intake_per_minute: intake,
    queue_depth: queueDepth,
    ingestion_lag_seconds: lag,
    stage_latency_seconds: stageLatency,
    dead_letter: deadLetter,
    enrichment_pending: enrichmentPending,
    slowest_repositories: slowest,
    unavailable,
  };
}

/** 부분 보강으로 색인된 문서 수 (FR-ING-004 AC-3의 뒷면). */
async function countEnrichmentPending(es: EsClient): Promise<number> {
  const response = await es.count({
    index: 'prs-pull-requests',
    query: { term: { enrichment_pending: true } },
  });
  return Number(response.count ?? 0);
}

/**
 * 단계별 지연 (CR-013, DEV-029).
 *
 * 지표 저장소가 없으면 조회를 시도조차 하지 않고 `unavailable`에 남긴다.
 * "설정되지 않음"과 "조회 실패"는 운영자에게 같은 뜻이다 — 이 값이 지금 없다.
 */
async function stageLatencies(
  deps: PipelineStatusDeps,
  unavailable: string[],
): Promise<Readonly<Record<string, LagSummary>> | null> {
  if (deps.metricsQueryUrl === null) {
    unavailable.push('stage_latency_seconds');
    return null;
  }

  return section('stage_latency_seconds', unavailable, deps, async () => {
    const stages = ['enrich', 'project'] as const;
    const entries = await Promise.all(
      stages.map(async (stage) => {
        const [p50, p95] = await Promise.all([
          queryQuantile(deps.metricsQueryUrl ?? '', stage, 0.5),
          queryQuantile(deps.metricsQueryUrl ?? '', stage, 0.95),
        ]);
        return [stage, { p50, p95, sample_count: 0 }] as const;
      }),
    );
    return Object.fromEntries(entries);
  });
}

/** Prometheus 호환 순간 질의. 응답 모양이 다르면 `null`이다 — 추측하지 않는다. */
async function queryQuantile(baseUrl: string, stage: string, quantile: number): Promise<number | null> {
  const expression = `histogram_quantile(${String(quantile)}, sum by (le) (rate(stage_latency_seconds_bucket{stage="${stage}"}[5m])))`;
  const url = new URL('/api/v1/query', baseUrl);
  url.searchParams.set('query', expression);

  const response = await fetch(url, { signal: AbortSignal.timeout(3_000) });
  if (!response.ok) throw new Error(`지표 저장소가 ${String(response.status)}를 반환했다`);

  const body = (await response.json()) as {
    data?: { result?: { value?: [number, string] }[] };
  };
  const raw = body.data?.result?.[0]?.value?.[1];
  if (raw === undefined) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}
