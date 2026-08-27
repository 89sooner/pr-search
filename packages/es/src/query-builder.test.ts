/**
 * AST → ES 질의 (WP-013 DoD 1, DoD 2 / FR-SRCH-006 AC-1, AC-2).
 *
 * 질의 **모양**을 확인한다. 그 모양이 실제로 옳은 문서를 고르는지는
 * `integration/search.test.ts`가 진짜 인덱스에 물어 확인한다 — 모양이 맞아도
 * 필드 이름이 어긋나면 아무것도 거르지 못하기 때문이다.
 */

import { parseQuery } from '@prs/query';
import { describe, expect, it } from 'vitest';
import type { estypes } from '@elastic/elasticsearch';
import {
  EMPTY_RESOLUTION,
  FIRST_PARENT_COMMIT_ROLES,
  FULL_TEXT_FIELDS,
  buildQuery,
  collectNames,
  type NameResolution,
} from './query-builder.js';

const RESOLUTION: NameResolution = {
  orgIds: new Map([['acme', 1]]),
  // slug 하나가 팀 여럿을 가리킬 수 있다 (WP-032, PR #57 리뷰 P2).
  teamIds: new Map([['payments-core', [77]]]),
};

function queryFor(input: string, resolution: NameResolution = RESOLUTION) {
  return buildQuery(parseQuery(input), resolution).query;
}

function filtersOf(input: string, resolution: NameResolution = RESOLUTION): unknown[] {
  const bool = (queryFor(input, resolution) as { bool?: { filter?: unknown[] } }).bool;
  return bool?.filter ?? [];
}

function mustNotOf(input: string): unknown[] {
  const bool = (queryFor(input) as { bool?: { must_not?: unknown[] } }).bool;
  return bool?.must_not ?? [];
}

describe('DoD 1: 필터가 AND로 결합된다 (AC-1)', () => {
  it('다른 키는 `filter` 배열에 나란히 놓인다', () => {
    const filters = filtersOf('repo:acme/payments author:kim label:backend');
    expect(filters).toHaveLength(3);
    expect(filters).toContainEqual({ terms: { repository: ['acme/payments'] } });
    expect(filters).toContainEqual({ terms: { author: ['kim'] } });
    expect(filters).toContainEqual({ terms: { labels: ['backend'] } });
  });

  it('AC-1이 열거한 12종이 모두 절이 된다', () => {
    // 저장소·조직·작성자·팀·리뷰어·라벨·대상 브랜치·상태·머지 범위·생성 범위·시퀀스 범위·경로.
    const input =
      'repo:acme/payments org:acme author:kim team:payments-core reviewer:lee label:backend ' +
      'base:main state:merged merged:2026-08-01..2026-08-19 created:2026-07-01..2026-08-01 ' +
      'seq:1280..1342 path:src/pay';
    expect(filtersOf(input)).toHaveLength(12);
  });

  it('질의가 비면 `match_all`이다 — 조건 없는 조회도 성립한다', () => {
    expect(queryFor('')).toEqual({ match_all: {} });
  });

  it('점수를 만드는 절이 없다 — 전부 filter 문맥이다 (DEV-056)', () => {
    const bool = (queryFor('repo:x author:y') as { bool: Record<string, unknown> }).bool;
    expect(bool['must']).toBeUndefined();
    expect(bool['should']).toBeUndefined();
  });
});

describe('DoD 2: 같은 키 다중 값이 OR로 결합된다 (AC-2)', () => {
  it('같은 키의 값들이 `terms` 하나로 묶인다', () => {
    expect(filtersOf('author:kim author:lee')).toEqual([{ terms: { author: ['kim', 'lee'] } }]);
  });

  it('값이 하나여도 `terms`다 — 모양이 하나여야 읽고 시험하기 쉽다', () => {
    expect(filtersOf('author:kim')).toEqual([{ terms: { author: ['kim'] } }]);
  });

  it('긍정과 부정이 섞이면 서로 다른 자리로 간다', () => {
    expect(filtersOf('author:kim -author:bot')).toEqual([{ terms: { author: ['kim'] } }]);
    expect(mustNotOf('author:kim -author:bot')).toEqual([{ terms: { author: ['bot'] } }]);
  });
});

describe('부정 (AC-6)', () => {
  it('동등 부정이 `must_not`이 된다', () => {
    expect(mustNotOf('-author:bot')).toEqual([{ terms: { author: ['bot'] } }]);
  });

  it('범위 부정도 `must_not`이 된다 (CR-014, DEV-035)', () => {
    expect(mustNotOf('-seq:1..10')).toEqual([{ range: { merge_seq: { gte: 1, lte: 10 } } }]);
  });

  it('부정만 있으면 `filter`가 없다', () => {
    const bool = (queryFor('-author:bot') as { bool: Record<string, unknown> }).bool;
    expect(bool['filter']).toBeUndefined();
    expect(bool['must_not']).toBeDefined();
  });
});

describe('범위 (DEV-037)', () => {
  it('`seq`는 `merge_seq`를 본다', () => {
    expect(filtersOf('seq:1280..1342')).toEqual([{ range: { merge_seq: { gte: 1280, lte: 1342 } } }]);
  });

  it('`merged`·`created`는 시각 필드를 본다', () => {
    expect(filtersOf('merged:2026-08-01..2026-08-19')).toEqual([
      { range: { merged_at: { gte: '2026-08-01', lte: '2026-08-19' } } },
    ]);
    expect(filtersOf('created:2026-08-01..2026-08-19')).toEqual([
      { range: { created_at: { gte: '2026-08-01', lte: '2026-08-19' } } },
    ]);
  });

  it('양끝을 포함한다', () => {
    const range = filtersOf('seq:5..5')[0] as { range: { merge_seq: { gte: number; lte: number } } };
    expect(range.range.merge_seq).toEqual({ gte: 5, lte: 5 });
  });
});

describe('DEV-052: 이름을 ID로 옮긴다', () => {
  it('`org`는 레지스트리에서 찾은 `org_id`를 본다', () => {
    expect(filtersOf('org:acme')).toEqual([{ terms: { org_id: [1] } }]);
  });

  it('`team`은 `allowed_team_ids`를 본다', () => {
    expect(filtersOf('team:payments-core')).toEqual([{ terms: { allowed_team_ids: [77] } }]);
  });

  it('못 찾은 이름은 `match_none`이 되고 응답에 남는다', () => {
    const built = buildQuery(parseQuery('org:unknown-org'), RESOLUTION);
    expect((built.query as { bool: { filter: unknown[] } }).bool.filter).toEqual([{ match_none: {} }]);
    expect(built.unresolved).toEqual([{ key: 'org', value: 'unknown-org' }]);
  });

  it('필터를 조용히 빠뜨리지 않는다 — 그러면 결과가 넓어진다', () => {
    // 이름을 못 찾았다고 `org:` 조건을 버리면 다른 조직 문서가 결과에 섞인다.
    const filters = filtersOf('repo:acme/payments org:unknown', RESOLUTION);
    expect(filters).toHaveLength(2);
    expect(filters).toContainEqual({ match_none: {} });
  });

  it('찾은 이름과 못 찾은 이름이 섞이면 찾은 것만 쓰고 나머지를 남긴다', () => {
    const built = buildQuery(parseQuery('org:acme org:ghost'), RESOLUTION);
    expect((built.query as { bool: { filter: unknown[] } }).bool.filter).toEqual([{ terms: { org_id: [1] } }]);
    expect(built.unresolved).toEqual([{ key: 'org', value: 'ghost' }]);
  });

  it('해석표가 비면 모든 이름이 미해석이다', () => {
    const built = buildQuery(parseQuery('org:acme team:core'), EMPTY_RESOLUTION);
    expect(built.unresolved).toEqual([
      { key: 'org', value: 'acme' },
      { key: 'team', value: 'core' },
    ]);
  });

  it('레지스트리에 물어볼 이름 목록을 모은다', () => {
    expect(collectNames(parseQuery('org:a org:b team:t repo:x'))).toEqual({
      orgs: ['a', 'b'],
      teams: ['t'],
    });
  });

  it('이름이 없으면 물어보지 않는다', () => {
    expect(collectNames(parseQuery('repo:x author:y'))).toEqual({ orgs: [], teams: [] });
  });
});

describe('DEV-053: `is`는 파생 상태다', () => {
  it('`is:merged`는 `state`와 같다', () => {
    expect(filtersOf('is:merged')).toEqual([{ term: { state: 'merged' } }]);
  });

  it('`is:reverted`는 관계 파생이 만든 자리를 본다', () => {
    expect(filtersOf('is:reverted')).toEqual([{ term: { 'link_summary.is_reverted': true } }]);
  });

  it('값이 여럿이면 OR다', () => {
    const clause = filtersOf('is:open is:closed')[0] as { bool: { should: unknown[] } };
    expect(clause.bool.should).toEqual([{ term: { state: 'open' } }, { term: { state: 'closed' } }]);
  });

  it('`state`는 GitHub이 준 값을 그대로 본다 — `is`와 다른 키다', () => {
    expect(filtersOf('state:merged')).toEqual([{ terms: { state: ['merged'] } }]);
  });
});

describe('경로 접두 (AC-1)', () => {
  it('`term`으로 경로 계층의 한 마디를 정확히 가리킨다', () => {
    expect(filtersOf('path:src/pay')).toEqual([
      { bool: { minimum_should_match: 1, should: [{ term: { changed_paths: 'src/pay' } }] } },
    ]);
  });

  it('`match`를 쓰지 않는다 — 같은 위치의 토큰이 OR로 무너진다', () => {
    // `path_hierarchy`는 `src`와 `src/pay`를 **같은 position 0**에 쌓는다.
    // 같은 위치의 토큰은 동의어로 취급되어 `operator: and`가 듣지 않고,
    // `src` 하나로 `src/billing/form.ts`가 걸린다. 실측으로 확인했다.
    const clause = filtersOf('path:src/pay')[0] as { bool: { should: Record<string, unknown>[] } };
    expect(Object.keys(clause.bool.should[0] ?? {})).toEqual(['term']);
  });

  it('경로 여럿은 OR다', () => {
    const clause = filtersOf('path:src path:docs')[0] as { bool: { should: unknown[] } };
    expect(clause.bool.should).toHaveLength(2);
  });

  it('`..`가 든 경로는 범위가 아니라 그 문자열이다 (DEV-037)', () => {
    expect(filtersOf('path:src/a..b')).toEqual([
      { bool: { minimum_should_match: 1, should: [{ term: { changed_paths: 'src/a..b' } }] } },
    ]);
  });
});

describe('나머지 키가 보는 자리 (DEV-052)', () => {
  it.each([
    ['repo:acme/payments', { terms: { repository: ['acme/payments'] } }],
    ['reviewer:lee', { terms: { reviewers: ['lee'] } }],
    ['label:backend', { terms: { labels: ['backend'] } }],
    ['base:main', { terms: { base_branch: ['main'] } }],
    ['head:feature/x', { terms: { head_branch: ['feature/x'] } }],
    ['release:v1.2.0', { terms: { release_tags: ['v1.2.0'] } }],
  ])('%s', (input, expected) => {
    expect(filtersOf(input)).toEqual([expected]);
  });
});

describe('전문 검색 (WP-032 / FR-SRCH-011, CR-043 DEV-283)', () => {
  const withText = (query: string): estypes.QueryDslBoolQuery =>
    (buildQuery(parseQuery(query)).query as { bool: estypes.QueryDslBoolQuery }).bool;

  it('자유 텍스트가 `must`에 선다 — 점수를 내는 절은 그것뿐이다', () => {
    const bool = withText('repo:acme/payments 결제');
    expect(bool.must).toHaveLength(1);
    // 구조화 필터는 `filter`에 그대로 남는다 — 권한도 점수도 섞이지 않는다.
    expect(bool.filter).toHaveLength(1);
  });

  it('제목이 본문보다 위다 (AC-2)', () => {
    const fields = FULL_TEXT_FIELDS;
    const title = fields.find((f) => f.startsWith('title^'));
    expect(title).toBe('title^3');
    // 본문에는 가중치가 없다 — 기본 1이다.
    expect(fields).toContain('body');
  });

  it('부분 일치 필드가 같은 축의 절반 가중치다 — 통째로 맞은 문서가 위다', () => {
    expect(FULL_TEXT_FIELDS).toContain('title.partial^1.5');
    expect(FULL_TEXT_FIELDS).toContain('message.partial^0.5');
  });

  it('브랜치명은 `keyword` 본체가 아니라 분석된 서브필드를 본다', () => {
    // 본체로 걸면 `feature/pay-retry` 전체와 정확히 같을 때만 매치된다.
    expect(FULL_TEXT_FIELDS).toContain('base_branch.text');
    expect(FULL_TEXT_FIELDS).not.toContain('base_branch');
    expect(FULL_TEXT_FIELDS).not.toContain('head_branch');
  });

  /*
   * **AC-1이 정한 커밋 축은 머지 커밋 메시지다** (DEV-283).
   *
   * `/search`는 `prs-commits`를 함께 도는데 그 인덱스에는 `source_commit`도
   * 들어 있다. 자유 텍스트를 `message`에 조건 없이 걸면 PR에 딸린 원본 커밋
   * 메시지까지 검색 대상이 되어 승인된 범위를 넘는다.
   */
  it('`source_commit`을 배제한다 — first-parent 체인만 점수를 받는다', () => {
    const bool = withText('결제');
    const excluded = JSON.stringify(bool.must_not);
    expect(excluded).toContain('merge_commit');
    expect(excluded).toContain('direct_push');
    expect(excluded).not.toContain('source_commit');
    expect(FIRST_PARENT_COMMIT_ROLES).toEqual(['merge_commit', 'direct_push']);
  });

  it('PR 문서는 배제 절에 걸리지 않는다 — `role`이 없으면 `exists`가 거른다', () => {
    const bool = withText('결제');
    const clause = (bool.must_not as estypes.QueryDslQueryContainer[])[0] as {
      bool: { filter: { exists: { field: string } }[] };
    };
    expect(clause.bool.filter[0]?.exists.field).toBe('role');
  });

  /*
   * **자유 텍스트가 있을 때만이다.**
   *
   * 원본 커밋을 배제하는 것은 "무엇이 검색 대상 메시지인가"에 대한 답이지
   * "무엇이 이 저장소의 커밋인가"에 대한 답이 아니다.
   */
  it('구조화 필터만 있으면 배제하지 않는다 — 기존 동작이 바뀌지 않는다', () => {
    const bool = withText('repo:acme/payments');
    expect(bool.must).toBeUndefined();
    expect(bool.must_not).toBeUndefined();
  });

  it('빈 텍스트는 절을 만들지 않는다', () => {
    expect(buildQuery({ filters: [], text: null }).query).toEqual({ match_all: {} });
    expect(buildQuery({ filters: [], text: '' }).query).toEqual({ match_all: {} });
  });
});
