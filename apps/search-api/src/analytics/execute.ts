/**
 * 집계 실행 (WP-037 / CR-053 `API-STAT 공통 규칙`).
 *
 * ## 근사는 두 단계로 정한다
 *
 * 대상 수를 모르면 근사 여부를 정할 수 없다. 그래서 집계 요청에
 * `track_total_hits`를 **문턱 +1로 제한해** 함께 싣는다 — Elasticsearch가 거기까지만
 * 세고 `relation: 'gte'`로 답하므로, 큰 결과에서 전수를 세는 값을 치르지 않는다.
 * 문턱을 넘었으면 그 결과를 **버리고** `random_sampler`로 다시 묻는다.
 *
 * 작은 결과는 한 번, 큰 결과만 두 번이다. **정확한 답을 낼 수 있을 때 근사하지
 * 않는 것**이 이 순서의 목적이다.
 *
 * ## 보장하는 것만 주장한다
 *
 * `random_sampler`의 `doc_count`는 표본 비율로 되돌린 **추정값**이고 백분위는
 * 표본 기반이다. 응답에 `sample_probability`를 함께 실어 그 사실이 숫자와 같이
 * 다니게 한다 (FR-STAT-006 AC-3).
 */

import { assertNoShardFailures, search, type ScopedQuery, type EntityAlias } from '@prs/es';
import type { Client, estypes } from '@elastic/elasticsearch';
import { ANALYTICS_BUDGET_MS, APPROXIMATE_THRESHOLD } from './types.js';

/** 표본 안에서 집계가 놓이는 자리. 근사일 때만 한 겹 더 들어간다. */
const SAMPLER_NAME = 'sample';

export interface AggregationOutcome {
  /** 고유 PR 수. 근사면 표본에서 되돌린 추정값이다. */
  readonly total: { readonly value: number; readonly relation: 'eq' | 'gte' };
  readonly approximate: boolean;
  /** 근사일 때만. 응답에 실어 숫자와 함께 다니게 한다. */
  readonly sampleProbability?: number;
  /** 표본 안쪽 집계 결과. 호출부가 자기 모양으로 옮긴다. */
  readonly aggregations: Record<string, estypes.AggregationsAggregate>;
}

export interface ExecuteInput {
  readonly target: readonly EntityAlias[];
  readonly scoped: ScopedQuery;
  readonly aggs: Record<string, estypes.AggregationsAggregationContainer>;
}

/**
 * 표본 비율을 고른다.
 *
 * 표본이 문턱 언저리를 유지하도록 잡는다 — 대상이 커질수록 비율이 작아지고,
 * 표본 크기는 대체로 일정하다. **비율을 고정하면** 1억 건에서 표본도 백 배가
 * 되어 근사의 뜻이 사라진다.
 */
export function sampleProbabilityFor(total: number): number {
  if (total <= APPROXIMATE_THRESHOLD) return 1;
  const probability = APPROXIMATE_THRESHOLD / total;
  // Elasticsearch가 받는 하한. 이보다 작아지면 표본이 지나치게 성기다.
  return Math.max(probability, 0.00001);
}

function unwrap(
  response: estypes.SearchResponse<unknown>,
  sampled: boolean,
): Record<string, estypes.AggregationsAggregate> {
  const aggregations = response.aggregations ?? {};
  if (!sampled) return aggregations;
  const sampler = aggregations[SAMPLER_NAME] as Record<string, unknown> | undefined;
  if (sampler === undefined) return {};

  /*
   * 표본 집계가 자기 메타를 같은 자리에 얹는다. 그것을 그대로 올려보내면
   * 호출부가 `doc_count`를 집계 결과로 읽을 수 있다 — 이름이 그럴듯해서 더
   * 그렇다.
   */
  const META = new Set(['doc_count', 'seed', 'probability']);
  const inner: Record<string, estypes.AggregationsAggregate> = {};
  for (const [key, value] of Object.entries(sampler)) {
    if (META.has(key)) continue;
    inner[key] = value as estypes.AggregationsAggregate;
  }
  return inner;
}

function totalOf(response: estypes.SearchResponse<unknown>): {
  value: number;
  relation: 'eq' | 'gte';
} {
  const hits = response.hits.total;
  if (typeof hits === 'number') return { value: hits, relation: 'eq' };
  return { value: hits?.value ?? 0, relation: hits?.relation === 'gte' ? 'gte' : 'eq' };
}

/**
 * 집계를 실행한다.
 *
 * **부분 샤드 실패를 정상 집계로 반환하지 않는다** — 일부 샤드가 답하지 못한
 * 수는 "적게 나온 수"이고 그것을 사실처럼 내보내면 조사자가 없는 것을 없다고
 * 읽는다 (`assertNoShardFailures`).
 */
export async function executeAggregation(
  client: Client,
  input: ExecuteInput,
): Promise<AggregationOutcome> {
  const first = await search(client, [...input.target], input.scoped, {
    size: 0,
    // 문턱을 넘는지만 알면 된다. 전수를 세는 값을 치르지 않는다.
    track_total_hits: APPROXIMATE_THRESHOLD + 1,
    timeout: `${String(ANALYTICS_BUDGET_MS)}ms`,
    aggs: input.aggs,
  });
  assertNoShardFailures(first);

  const total = totalOf(first);
  if (total.value <= APPROXIMATE_THRESHOLD) {
    return { total, approximate: false, aggregations: unwrap(first, false) };
  }

  /*
   * 문턱을 넘었다. 위 결과를 **버리고** 표본으로 다시 묻는다.
   *
   * 위 응답의 집계는 전수 위에서 계산됐으므로 그 자체로 정확하지만, 그것을
   * 그대로 쓰면 **예산을 이미 초과한 계산에 의존하게 된다.** 문턱의 목적은
   * 답을 얻는 것이 아니라 그 값을 치르지 않는 것이다.
   */
  const probability = sampleProbabilityFor(total.value);
  const sampled = await search(client, [...input.target], input.scoped, {
    size: 0,
    track_total_hits: APPROXIMATE_THRESHOLD + 1,
    timeout: `${String(ANALYTICS_BUDGET_MS)}ms`,
    aggs: {
      [SAMPLER_NAME]: {
        random_sampler: { probability },
        aggs: input.aggs,
      },
    },
  });
  assertNoShardFailures(sampled);

  return {
    total: totalOf(sampled),
    approximate: true,
    sampleProbability: probability,
    aggregations: unwrap(sampled, true),
  };
}
