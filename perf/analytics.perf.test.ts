/**
 * 집계 API 성능 harness (WP-037 / DEV-058, NFR-001).
 *
 * ## 이 파일이 답하는 것과 답하지 않는 것
 *
 * **답한다.** 네 집계가 요청 수를 버킷·그룹 수에 비례해 늘리지 않는가.
 * 조회 시점 `script` 없이 도는가. 결정적인 데이터셋에서 지연 분포가 어떤가.
 *
 * **답하지 않는다.** `NFR-001`의 p95 1500ms를 릴리스 규모에서 만족하는가.
 * 그것은 PR 1,000,000 · 커밋 10,000,000의 합성 데이터셋을 요구하며
 * **Gate 5의 몫이다.** 여기 수치를 그 통과로 적으면 작은 픽스처의 숫자가 큰
 * 데이터의 주장이 된다 — 이 저장소가 `ACC-06`에서 거절한 것과 같은 일이다.
 *
 * 크기는 `PERF_DATASET_SIZE`로 조절한다. 같은 harness가 두 규모를 모두 돈다.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  applyMappings,
  bulkUpsert,
  createEsClient,
  resolveClientOptions,
  switchAliasesForTests,
  SERVING_ONLY,
  type AccessScope,
} from '@prs/es';
import { parseQuery } from '@prs/query';
// `@elastic/elasticsearch`는 `@prs/es`의 의존이다. 루트에서 직접 가져오지 않는다.
type Client = ReturnType<typeof createEsClient>;
import {
  buildDistributionsAggs,
  buildGroupsAggs,
  buildPercentilesAggs,
  buildTimeSeriesAggs,
} from '../apps/search-api/src/analytics/aggregations.js';
import { executeAggregation } from '../apps/search-api/src/analytics/execute.js';
import { ANALYTICS_TARGET } from '../apps/search-api/src/analytics/types.js';
import { applyMandatoryScopeFilter, buildQuery, EMPTY_RESOLUTION } from '@prs/es';

const DATASET_SIZE = Number(process.env['PERF_DATASET_SIZE'] ?? '2000');
const WARMUP = Number(process.env['PERF_WARMUP'] ?? '3');
const MEASURE = Number(process.env['PERF_MEASURE'] ?? '10');

const ORG = 900;
const REPOSITORY = 9001;
const TEAMS = [901, 902, 903, 904];
const AUTHORS = ['kim', 'lee', 'park', 'choi', 'jung'];
const LABELS = ['bug', 'feature', 'chore'];

/** 접근 범위. 집계도 이 필터를 지난다 (ADR-008) — 성능도 그 조건 위에서 잰다. */
const SCOPE: AccessScope = { kind: 'explicit', repositoryIds: [REPOSITORY] };

let es: Client;
/** 요청 수를 세는 껍데기. N+1과 버킷 비례 왕복을 잡는 유일한 재료다. */
let requests = 0;

/**
 * 왕복을 세는 껍데기.
 *
 * **`search`만 세면 안 된다.** 리뷰 정정으로 `_count`가 앞에 붙었을 때 이
 * harness가 그것을 보지 못하고 "요청/회 1.0"을 그대로 냈다 — **왕복 수를 재는
 * 도구가 왕복 하나를 놓쳤다.** 클러스터를 부르는 모든 길을 센다.
 */
const COUNTED = new Set(['search', 'count', 'msearch']);

function countingClient(inner: Client): Client {
  return new Proxy(inner, {
    get(target, property, receiver) {
      if (typeof property === 'string' && COUNTED.has(property)) {
        const original = Reflect.get(target, property, receiver) as (
          ...a: unknown[]
        ) => Promise<unknown>;
        return async (...args: unknown[]) => {
          requests += 1;
          return original.call(target, ...args);
        };
      }
      return Reflect.get(target, property, receiver) as unknown;
    },
  }) as Client;
}

/** 결정적 문서 하나. 같은 index는 언제나 같은 값을 낸다 — 측정이 재현되어야 한다. */
function document(index: number): Record<string, unknown> {
  const day = index % 28;
  const created = new Date(Date.UTC(2026, 6, 1 + day, 3, 0, 0));
  const merged = new Date(created.getTime() + ((index % 7) + 1) * 3_600_000);
  const additions = (index % 97) + 1;
  const deletions = (index % 53) + 1;

  return {
    document_version: 1,
    repository_id: REPOSITORY,
    repository: 'perf/analytics',
    org_id: ORG,
    visibility: 'internal',
    allowed_team_ids: [TEAMS[index % TEAMS.length]],
    author_team_ids: [TEAMS[index % TEAMS.length], TEAMS[(index + 1) % TEAMS.length]],
    pr_number: index + 1,
    title: `perf ${String(index)}`,
    state: index % 5 === 0 ? 'open' : 'merged',
    author: AUTHORS[index % AUTHORS.length],
    labels: [LABELS[index % LABELS.length]],
    base_branch: index % 3 === 0 ? 'main' : 'release/1.0',
    created_at: created.toISOString(),
    merged_at: merged.toISOString(),
    lead_time_seconds: Math.floor((merged.getTime() - created.getTime()) / 1000),
    first_review_wait_seconds: ((index % 11) + 1) * 600,
    changed_files_count: (index % 40) + 1,
    additions,
    deletions,
    changed_lines: additions + deletions,
    enrichment_pending: false,
  };
}

function percentile(sorted: readonly number[], percent: number): number {
  if (sorted.length === 0) return 0;
  const rank = Math.ceil((percent / 100) * sorted.length) - 1;
  return sorted[Math.min(Math.max(rank, 0), sorted.length - 1)] ?? 0;
}

async function measure(label: string, run: () => Promise<unknown>): Promise<number> {
  for (let i = 0; i < WARMUP; i += 1) await run();

  const before = requests;
  const samples: number[] = [];
  for (let i = 0; i < MEASURE; i += 1) {
    const started = performance.now();
    await run();
    samples.push(performance.now() - started);
  }
  const perCall = (requests - before) / MEASURE;

  const sorted = [...samples].sort((a, b) => a - b);
  process.stdout.write(
    `[perf] ${label.padEnd(14)} ` +
      `p50=${percentile(sorted, 50).toFixed(1)}ms ` +
      `p95=${percentile(sorted, 95).toFixed(1)}ms ` +
      `max=${(sorted[sorted.length - 1] ?? 0).toFixed(1)}ms ` +
      `요청/회=${perCall.toFixed(1)}\n`,
  );
  return perCall;
}

/** 질의 하나를 접근 범위까지 지난 모양으로. 라우트와 같은 순서를 밟는다. */
function scopedFor(query: string) {
  const ast = parseQuery(query);
  return { ast, scoped: applyMandatoryScopeFilter(buildQuery(ast, EMPTY_RESOLUTION).query, SCOPE) };
}

describe('집계 성능 (Level A — 알고리즘 회귀 감지)', () => {
  beforeAll(async () => {
    es = countingClient(createEsClient(resolveClientOptions()));
    await applyMappings(es);
    await switchAliasesForTests(es);

    await es.deleteByQuery({
      index: 'prs-pull-requests',
      query: { term: { repository_id: REPOSITORY } },
      refresh: true,
      conflicts: 'proceed',
    });

    const BATCH = 500;
    for (let start = 0; start < DATASET_SIZE; start += BATCH) {
      const requestsBatch = [];
      for (let i = start; i < Math.min(start + BATCH, DATASET_SIZE); i += 1) {
        requestsBatch.push({
          alias: 'prs-pull-requests' as const,
          id: `${String(REPOSITORY)}:${String(i + 1)}`,
          routing: String(REPOSITORY),
          doc: document(i) as never,
        });
      }
      await bulkUpsert(es, requestsBatch, SERVING_ONLY);
    }
    await es.indices.refresh({ index: 'prs-pull-requests' });

    process.stdout.write(`[perf] 데이터셋 ${String(DATASET_SIZE)}건 준비 완료\n`);
    // 준비 요청은 측정에 넣지 않는다.
    requests = 0;
  });

  afterAll(async () => {
    await es.deleteByQuery({
      index: 'prs-pull-requests',
      query: { term: { repository_id: REPOSITORY } },
      refresh: true,
      conflicts: 'proceed',
    });
  });

  it('그룹 집계가 그룹 수에 비례해 왕복하지 않는다 (API-STAT-001)', async () => {
    const { scoped } = scopedFor('');
    const perCall = await measure('groups', () =>
      executeAggregation(es, {
        target: ANALYTICS_TARGET,
        scoped,
        aggs: buildGroupsAggs('author', ['count', 'changed_files_sum', 'lead_time_median'], 500),
      }),
    );
    /*
     * **둘이어야 한다** — 근사 여부를 정하는 `_count` 하나와 집계 하나.
     *
     * 그룹마다 지표를 따로 물으면 N+1이 되고, 그 실패는 결과를 재는 시험에
     * 잡히지 않는다 — 답은 맞고 값만 비싸다. 이 수가 늘면 그것이 신호다.
     */
    expect(perCall).toBe(2);
  });

  it('시계열이 버킷 수에 비례해 왕복하지 않는다 (API-STAT-002)', async () => {
    const { scoped } = scopedFor('');
    const perCall = await measure('time-series', () =>
      executeAggregation(es, {
        target: ANALYTICS_TARGET,
        scoped,
        aggs: buildTimeSeriesAggs({
          interval: 'day',
          timezone: 'Asia/Seoul',
          from: '2026-07-01T00:00:00Z',
          to: '2026-07-28T00:00:00Z',
          groupBy: 'team',
        }),
      }),
    );
    expect(perCall).toBe(2);
  });

  it('백분위가 그룹마다 다시 묻지 않는다 (API-STAT-003)', async () => {
    const { scoped } = scopedFor('');
    const perCall = await measure('percentiles', () =>
      executeAggregation(es, {
        target: ANALYTICS_TARGET,
        scoped,
        aggs: buildPercentilesAggs({
          field: 'lead_time_seconds',
          percentiles: [50, 75, 90, 95, 99],
          groupBy: 'team',
        }),
      }),
    );
    expect(perCall).toBe(2);
  });

  it('분포가 구간마다 다시 묻지 않는다 (API-STAT-004)', async () => {
    const { scoped } = scopedFor('');
    const perCall = await measure('distributions', () =>
      executeAggregation(es, {
        target: ANALYTICS_TARGET,
        scoped,
        aggs: buildDistributionsAggs('changed_lines'),
      }),
    );
    expect(perCall).toBe(2);
  });

  it('**측정이 실제 요청 위에서 이뤄졌다**', () => {
    /*
     * 요청 수가 0이면 harness가 아무것도 재지 않은 것이다. 그 상태로 통과하는
     * 성능 시험은 **없는 증거를 있는 것처럼 보이게 한다** — DEV-058이 열려
     * 있던 동안 그 자리에 아무것도 없었던 것보다 나쁘다.
     */
    expect(requests).toBeGreaterThan(0);
    process.stdout.write(
      `[perf] 총 요청 ${String(requests)}회 · 데이터셋 ${String(DATASET_SIZE)}건\n` +
        `[perf] **이 수치는 NFR-001의 릴리스 규모 실측이 아니다** (Gate 5, NOT RUN)\n`,
    );
  });
});
