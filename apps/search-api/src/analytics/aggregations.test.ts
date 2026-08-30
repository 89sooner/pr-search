/**
 * 집계 응답 변환 (WP-037 / FR-STAT-001~005).
 *
 * **경계를 겨냥한다.** 통합 시험은 실제 인덱스에 던져 "어떤 수가 나오는지"를
 * 보지만, 픽스처가 경계에 걸치지 않으면 그 규칙이 시험에 걸리지 않는다 —
 * 표본 20건 경계를 변이(M7)로 흔들었을 때 픽스처가 2건이라 살아남았다.
 *
 * 여기서는 Elasticsearch 응답을 손으로 만들어 **경계 양쪽을 직접 건다.**
 */

import { describe, expect, it } from 'vitest';
import type { estypes } from '@elastic/elasticsearch';
import { parseQuery } from '@prs/query';
import {
  buildDistributionsAggs,
  buildGroupsAggs,
  drillDownQuery,
  toDistributionsOutcome,
  toGroupsOutcome,
  toPercentilesOutcome,
} from './aggregations.js';
import { LOW_SAMPLE_THRESHOLD } from './types.js';

type Aggs = Record<string, estypes.AggregationsAggregate>;

/** 백분위 집계 응답 하나. `sample_size`만 바꿔 경계를 흔든다. */
function percentileAggs(sampleSize: number, pending = 0): Aggs {
  return {
    percentiles: { values: { '50.0': 100, '95.0': 900 } },
    sample_size: { value: sampleSize },
    enrichment_pending: { doc_count: pending },
  } as unknown as Aggs;
}

describe('백분위 표본 경계 (FR-STAT-003 예외/실패 처리)', () => {
  it(`표본 ${String(LOW_SAMPLE_THRESHOLD - 1)}건은 low_sample이다`, () => {
    const outcome = toPercentilesOutcome(percentileAggs(LOW_SAMPLE_THRESHOLD - 1), {
      percentiles: [50, 95],
      groupBy: null,
      field: 'lead_time_seconds',
      total: LOW_SAMPLE_THRESHOLD - 1,
    });
    expect(outcome.overall.low_sample).toBe(true);
  });

  it(`**표본 ${String(LOW_SAMPLE_THRESHOLD)}건은 low_sample이 아니다** — 경계가 미만이다`, () => {
    /*
     * `< 20`을 `<= 20`으로 바꾸는 변이가 통합에서 살아남았다. 픽스처의 표본이
     * 2건이라 어느 쪽이든 `true`였기 때문이다 — **경계를 흔드는 변이는 경계에
     * 걸친 입력으로만 죽는다.**
     */
    const outcome = toPercentilesOutcome(percentileAggs(LOW_SAMPLE_THRESHOLD), {
      percentiles: [50, 95],
      groupBy: null,
      field: 'lead_time_seconds',
      total: LOW_SAMPLE_THRESHOLD,
    });
    expect(outcome.overall.low_sample).toBe(false);
  });

  it('제외 사유를 가른다 — 보강 대기와 리뷰 없음은 다른 사실이다', () => {
    // 대상 10건 중 값이 있는 것 4건, 그중 보강 대기가 2건.
    const outcome = toPercentilesOutcome(percentileAggs(4, 2), {
      percentiles: [50],
      groupBy: null,
      field: 'lead_time_seconds',
      total: 10,
    });
    expect(outcome.excludedCount).toBe(6);
    expect(outcome.excludedReasons['enrichment_pending']).toBe(2);
    expect(outcome.excludedReasons['no_review']).toBe(4);
  });

  it('근사에서 표본이 총계를 넘어도 제외 수가 음수가 되지 않는다', () => {
    // `random_sampler`가 되돌린 수는 어긋날 수 있다. 음수 제외 건수를 내보내지 않는다.
    const outcome = toPercentilesOutcome(percentileAggs(12), {
      percentiles: [50],
      groupBy: null,
      field: 'lead_time_seconds',
      total: 10,
    });
    expect(outcome.excludedCount).toBe(0);
  });
});

describe('그룹 절삭 판정 (FR-STAT-001 AC-3)', () => {
  const rows = (count: number): Aggs =>
    ({
      groups: {
        buckets: Array.from({ length: 3 }, (_, i) => ({ key: `g${String(i)}`, doc_count: 1 })),
        sum_other_doc_count: count,
      },
    }) as unknown as Aggs;

  it('**`sum_other_doc_count`가 절삭의 정본이다**', () => {
    /*
     * `buckets.length === size`로 판정하면 그룹 수가 정확히 상한과 같을 때
     * 절삭하지 않았는데도 절삭했다고 말한다.
     */
    const ast = parseQuery('');
    expect(toGroupsOutcome(rows(0), { ast, groupBy: 'author', metrics: ['count'] }).truncated).toBe(
      false,
    );
    expect(toGroupsOutcome(rows(7), { ast, groupBy: 'author', metrics: ['count'] }).truncated).toBe(
      true,
    );
  });
});

describe('근거 질의 (FR-STAT-001 AC-5, DEV-383)', () => {
  it('**모집단 판별자와 작성자 팀 키가 함께 들어간다**', () => {
    const query = drillDownQuery(parseQuery('org:acme'), 'team', '77');
    expect(query).toContain('kind:pull_request');
    // `team:`이 아니다 — 그 키는 저장소 접근 권한을 뜻한다 (DEV-382).
    expect(query).toContain('author_team:77');
    expect(query).not.toMatch(/(^|\s)team:/);
  });

  it('이미 `kind:`가 있으면 두 번 넣지 않는다', () => {
    // 파서가 같은 (키, op)를 한 노드로 모으므로 왕복이 깨지지 않아야 한다.
    const query = drillDownQuery(parseQuery('kind:pull_request'), 'author', 'kim');
    expect(query.match(/kind:pull_request/g)).toHaveLength(1);
  });
});

describe('분포 (FR-STAT-005)', () => {
  const distributionAggs = (counted: Readonly<Record<string, number>>, unknown: number): Aggs =>
    ({
      ranges: {
        buckets: Object.entries(counted).map(([key, doc_count]) => ({ key, doc_count })),
      },
      unknown: { doc_count: unknown },
    }) as unknown as Aggs;

  it('**`unknown`에는 근거 질의가 없다** — 질의 문법에 "값 없음"이 없다', () => {
    const rows = toDistributionsOutcome(distributionAggs({ '1': 2 }, 1), {
      ast: parseQuery(''),
      dimension: 'changed_files',
      total: 3,
    });
    const unknown = rows.find((one) => one.key === 'unknown');
    expect(unknown?.count).toBe(1);
    expect(unknown?.drill_down_query).toBeNull();
  });

  it('대상이 0건이면 모든 구간이 0이다 — 0으로 나누지 않는다', () => {
    const rows = toDistributionsOutcome(distributionAggs({}, 0), {
      ast: parseQuery(''),
      dimension: 'changed_lines',
      total: 0,
    });
    expect(rows.every((one) => one.count === 0 && one.ratio === 0)).toBe(true);
  });

  it('구간 경계가 양끝을 포함한다 — ES의 `to`는 제외이므로 1을 더한다', () => {
    const aggs = buildDistributionsAggs('changed_files');
    const ranges = (aggs['ranges'] as { range: { ranges: { key: string; from: number; to?: number }[] } })
      .range.ranges;
    // `2-5` 구간은 5를 포함해야 하므로 `to`가 6이다.
    expect(ranges.find((one) => one.key === '2-5')).toMatchObject({ from: 2, to: 6 });
    // 위로 열린 구간에는 `to`가 없다.
    expect(ranges.find((one) => one.key === '100+')).toEqual({ key: '100+', from: 101 });
  });

  it('**`0` 구간이 있다** — 0인 문서가 어디에도 없으면 집계에서 사라진다 (CR-056, DEV-449)', () => {
    for (const dimension of ['changed_files', 'changed_lines'] as const) {
      const aggs = buildDistributionsAggs(dimension);
      const ranges = (aggs['ranges'] as { range: { ranges: { key: string; from: number; to?: number }[] } })
        .range.ranges;
      // ES의 `to`는 제외이므로 0만 담는 구간의 `to`는 1이다.
      expect(ranges.find((one) => one.key === '0'), `${dimension}에 0 구간이 없다`).toMatchObject({
        from: 0,
        to: 1,
      });
    }
  });

  it('**0을 첫 구간에 흡수하지 않는다** — 하나도 바꾸지 않음과 하나 바꿈은 다른 사실이다', () => {
    const ranges = (
      buildDistributionsAggs('changed_files') as {
        ranges: { range: { ranges: { key: string; from: number }[] } };
      }
    ).ranges.range.ranges;
    expect(ranges.find((one) => one.key === '1')?.from).toBe(1);
  });

  it('**구간마다 그 구간을 거는 질의를 준다** (AC-4, CR-056 DEV-451)', () => {
    const rows = toDistributionsOutcome(distributionAggs({ '0': 1, '2-5': 7 }, 0), {
      ast: parseQuery('org:acme'),
      dimension: 'changed_files',
      total: 8,
    });

    expect(rows.find((one) => one.key === '0')?.drill_down_query).toContain('changed_files:0..0');
    expect(rows.find((one) => one.key === '2-5')?.drill_down_query).toContain('changed_files:2..5');
    // 기준 조건과 모집단은 그대로 실린다.
    expect(rows.find((one) => one.key === '2-5')?.drill_down_query).toContain('org:acme');
    expect(rows.find((one) => one.key === '2-5')?.drill_down_query).toContain('kind:pull_request');
  });

  it('구간 질의가 서로 다르다 — 하나를 만들어 돌려 쓰면 그것이 이 결함이다', () => {
    const rows = toDistributionsOutcome(distributionAggs({}, 0), {
      ast: parseQuery(''),
      dimension: 'changed_lines',
      total: 0,
    });
    const queries = rows.filter((one) => one.key !== 'unknown').map((one) => one.drill_down_query);
    expect(new Set(queries).size).toBe(queries.length);
  });

  it('상한이 없는 구간은 `integer` 최댓값을 끝으로 쓴다 — 열린 범위 문법을 만들지 않는다', () => {
    const rows = toDistributionsOutcome(distributionAggs({ '100+': 3 }, 0), {
      ast: parseQuery(''),
      dimension: 'changed_files',
      total: 3,
    });
    expect(rows.find((one) => one.key === '100+')?.drill_down_query).toContain(
      'changed_files:101..2147483647',
    );
  });

  it('기준 질의에 같은 범위가 있으면 갈아 끼운다 — 겹치면 그 수가 또 달라진다', () => {
    const rows = toDistributionsOutcome(distributionAggs({ '2-5': 4 }, 0), {
      ast: parseQuery('changed_files:900..1000'),
      dimension: 'changed_files',
      total: 4,
    });
    const query = rows.find((one) => one.key === '2-5')?.drill_down_query ?? '';
    expect(query).toContain('changed_files:2..5');
    expect(query).not.toContain('900..1000');
  });
});

describe('지표 선택 (FR-STAT-001 AC-2)', () => {
  it('요청하지 않은 지표는 집계에 넣지 않는다', () => {
    // 쓰지 않을 값을 계산하는 것은 그 자체로 비용이다.
    const aggs = buildGroupsAggs('author', ['count'], 10);
    const inner = (aggs['groups'] as { aggs?: Record<string, unknown> }).aggs;
    expect(inner).toBeUndefined();
  });

  it('`lead_time_median`은 `p50`으로 계산한다 (DEV-390)', () => {
    // 두 API가 같은 값을 다른 방법으로 계산해 미세하게 다른 수를 내지 않게 한다.
    const aggs = buildGroupsAggs('author', ['lead_time_median'], 10);
    const inner = (aggs['groups'] as { aggs: Record<string, unknown> }).aggs;
    expect(inner['lead_time_median']).toEqual({
      percentiles: { field: 'lead_time_seconds', percents: [50] },
    });
  });
});
