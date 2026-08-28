/**
 * 집계 실행 (WP-037 / CR-053 `API-STAT 공통 규칙`).
 *
 * ## 근사 여부는 세어 본 뒤에 정한다
 *
 * 대상 수를 모르면 근사 여부도 표본 비율도 정할 수 없다. **그 수는 `_count`로
 * 따로 묻는다.**
 *
 * 처음에는 집계 요청에 `track_total_hits`를 얹어 한 번에 얻으려 했고, 그것이
 * 두 가지를 함께 틀리게 했다 (PR #76 리뷰 P1 둘).
 *
 * 1. **`track_total_hits`는 히트 계수만 제한하고 집계 순회는 제한하지 않는다.**
 *    근사할지 정하려고 부른 요청이 전수 집계를 수행했다 — 값을 아끼려던 장치가
 *    정확히 그 값을 치르게 했다.
 * 2. **상한까지만 센 수는 모집단 크기가 아니다.** 문서 5건에 `track_total_hits: 3`을
 *    걸면 `{ value: 3, relation: 'gte' }`가 온다(실측). 5천만 건이 `1,000,001`로
 *    돌아오면 표본 비율이 1에 가까워져 **근사가 근사가 아니게 된다.**
 *
 * `_count`는 정확한 수를 주고 문서를 만들지 않는다. 한 번 더 왕복하지만 그것이
 * 이 판단의 값이다.
 *
 * ## 보장하는 것만 주장한다
 *
 * `random_sampler`의 `doc_count`는 표본 비율로 되돌린 **추정값**이고 백분위는
 * 표본 기반이다. 응답에 `sample_probability`를 함께 실어 그 사실이 숫자와 같이
 * 다니게 한다 (FR-STAT-006 AC-3).
 */

import {
  assertNoShardFailures,
  countDocuments,
  search,
  type ScopedQuery,
  type EntityAlias,
} from '@prs/es';
import type { Client, estypes } from '@elastic/elasticsearch';
import { ANALYTICS_BUDGET_MS, APPROXIMATE_THRESHOLD } from './types.js';

/** 표본 안에서 집계가 놓이는 자리. 근사일 때만 한 겹 더 들어간다. */
const SAMPLER_NAME = 'sample';

/**
 * 예산을 넘겨 부분 결과가 왔다 (PR #76 리뷰 P1).
 *
 * Elasticsearch는 검색 타임아웃에 걸리면 **HTTP 200에 `timed_out: true`를 붙여**
 * 그때까지 모은 것을 돌려준다. 샤드 실패가 아니므로 `assertNoShardFailures`가
 * 잡지 못하고, 그대로 내보내면 **적게 나온 수가 사실처럼 보인다.**
 * `facets.ts`가 같은 자리에서 이미 `timed_out`을 본다.
 */
export class AggregationTimedOutError extends Error {
  constructor() {
    super('집계가 예산 안에 끝나지 않아 부분 결과만 얻었다');
    this.name = 'AggregationTimedOutError';
  }
}

export interface AggregationOutcome {
  /** 고유 PR 수. `_count`가 준 정확한 값이다. */
  readonly total: { readonly value: number; readonly relation: 'eq' };
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

/** 부분 결과를 정상으로 받지 않는다. 두 실패 모양을 함께 본다. */
function assertComplete(response: estypes.SearchResponse<unknown>): void {
  assertNoShardFailures(response);
  if (response.timed_out === true) throw new AggregationTimedOutError();
}

/**
 * 집계를 실행한다.
 *
 * **부분 결과를 정상 집계로 반환하지 않는다** — 일부 샤드가 답하지 못했거나
 * 예산을 넘겨 중간에 끊긴 수는 "적게 나온 수"이고, 그것을 사실처럼 내보내면
 * 조사자가 없는 것을 없다고 읽는다.
 */
export async function executeAggregation(
  client: Client,
  input: ExecuteInput,
): Promise<AggregationOutcome> {
  /*
   * **집계보다 먼저, 집계 없이 센다.** 이 수 하나가 근사 여부와 표본 비율,
   * 그리고 응답의 `total`을 모두 정한다.
   */
  const total = await countDocuments(client, [...input.target], input.scoped);
  const probability = sampleProbabilityFor(total);
  const approximate = probability < 1;

  const response = await search(client, [...input.target], input.scoped, {
    size: 0,
    // 수는 이미 안다. 다시 세지 않는다.
    track_total_hits: false,
    timeout: `${String(ANALYTICS_BUDGET_MS)}ms`,
    aggs: approximate
      ? { [SAMPLER_NAME]: { random_sampler: { probability }, aggs: input.aggs } }
      : input.aggs,
  });
  assertComplete(response);

  return {
    total: { value: total, relation: 'eq' },
    approximate,
    ...(approximate ? { sampleProbability: probability } : {}),
    aggregations: unwrap(response, approximate),
  };
}
