/**
 * 질의 AST → Elasticsearch 질의 (FR-SRCH-006, CR-016 DEV-052·DEV-053).
 *
 * `@prs/query`가 문자열을 AST로 옮기고, 여기서 그 AST를 ES 질의로 옮긴다.
 * 파서가 ES를 모르고 이 파일이 문법을 모르는 것이 의도다 — 같은 파서를
 * 브라우저가 쓰기 때문이다 (ADR-001).
 *
 * **결합 규칙은 둘뿐이다** (FR-SRCH-006 AC-1, AC-2).
 *   - 다른 키끼리는 AND — `filter` 배열에 나란히 놓는다
 *   - 같은 키의 값끼리는 OR — `terms` 하나로 묶는다
 *
 * 부정(`-key:value`)은 `must_not`이다. `filter` 안의 `bool.must_not`은 점수를
 * 만들지 않으므로 캐시된다.
 *
 * **구조화 필터는 점수를 만들지 않는다.** 전부 `filter` 문맥이다. 점수를 내는
 * 것은 전문 검색어(`ast.text`) 하나뿐이며 그것은 `must`에 선다 (WP-032,
 * FR-SRCH-011). 접근 범위 필터도 `filter`이므로 권한이 점수에 섞이지 않는다.
 */

import type { estypes } from '@elastic/elasticsearch';
import { isRangeFilter, type QueryAst, type QueryFilter, type QueryKey } from '@prs/query';

/**
 * 키가 보는 ES 필드 (CR-016, DEV-052).
 *
 * `org`·`team`·`is`는 여기 없다 — 필드 이름만으로 풀리지 않아 따로 다룬다.
 */
const TERM_FIELDS: Readonly<Partial<Record<QueryKey, string>>> = {
  repo: 'repository',
  author: 'author',
  reviewer: 'reviewers',
  label: 'labels',
  base: 'base_branch',
  head: 'head_branch',
  state: 'state',
  release: 'release_tags',
};

/** 범위 키가 보는 ES 필드. */
const RANGE_FIELDS: Readonly<Partial<Record<QueryKey, string>>> = {
  seq: 'merge_seq',
  merged: 'merged_at',
  created: 'created_at',
};

/**
 * 경로 접두 필터 (FR-SRCH-006 AC-1의 "변경 경로 접두").
 *
 * `changed_paths`는 `path_hierarchy` 토크나이저를 쓴다 — `src/pay/a.ts`가
 * `src`, `src/pay`, `src/pay/a.ts`로 쪼개진다. 접두 매칭은 **그 토큰 중 하나와
 * 정확히 같은지**를 묻는 것이다.
 *
 * **그래서 `term`이지 `match`가 아니다.** 셋을 실측으로 비교했다.
 *
 * | 질의 | `src/pay/retry.ts` | `src/billing/form.ts` | `src/payments/x.ts` |
 * | --- | --- | --- | --- |
 * | `match` + `operator: and` | 매치 | **매치(오답)** | **매치(오답)** |
 * | `prefix` on `.raw` | 매치 | 무매치 | **매치(오답)** |
 * | `term` | 매치 | 무매치 | 무매치 |
 *
 * `match`가 무너지는 이유는 `path_hierarchy`가 토큰을 **같은 위치(position 0)**에
 * 쌓기 때문이다 — 같은 위치의 토큰은 동의어로 취급되어 `operator: and`가 OR로
 * 돌아간다. `prefix`는 문자열 접두라 `src/pay`가 `src/payments`의 접두가 되어
 * 다른 디렉터리를 끌어온다. `term`만이 "경로 계층의 한 마디"를 정확히 가리킨다.
 */
const PATH_FIELD = 'changed_paths';

/** `is`가 보는 자리 (CR-016, DEV-053). `state`와 겹치는 셋은 같은 필드다. */
const DERIVED_STATE: Readonly<Record<string, estypes.QueryDslQueryContainer>> = {
  merged: { term: { state: 'merged' } },
  open: { term: { state: 'open' } },
  closed: { term: { state: 'closed' } },
  // GitHub에는 없는, 관계 파생이 만든 상태다.
  reverted: { term: { 'link_summary.is_reverted': true } },
};

/**
 * 이름을 ID로 옮기는 표 (CR-016, DEV-052).
 *
 * 문서는 `org_id`와 `allowed_team_ids`를 **숫자로만** 갖는다. 사용자는 이름으로
 * 묻는다. 그 사이를 레지스트리가 잇는다 — 문서에 이름을 넣어 재색인하지 않는
 * 것은 그 이름의 주인이 레지스트리이고, 조직명이 바뀌면 문서 전량을 다시
 * 써야 하기 때문이다.
 */
export interface NameResolution {
  /** `owner` → `org_id`. 못 찾은 이름은 담지 않는다. */
  readonly orgIds: ReadonlyMap<string, number>;
  /** `team.slug` → `team_id`. */
  readonly teamIds: ReadonlyMap<string, number>;
}

export const EMPTY_RESOLUTION: NameResolution = { orgIds: new Map(), teamIds: new Map() };

/** 해석하지 못한 이름. 응답에 남겨 "왜 0건인가"를 말할 수 있게 한다. */
export interface UnresolvedName {
  readonly key: 'org' | 'team';
  readonly value: string;
}

export interface BuiltQuery {
  readonly query: estypes.QueryDslQueryContainer;
  /** 레지스트리에 없던 이름. 비어 있지 않으면 그만큼 결과가 좁아진 것이다. */
  readonly unresolved: readonly UnresolvedName[];
}

/**
 * 전문 검색이 인정하는 커밋의 역할 (FR-SRCH-011 AC-1, CR-043 DEV-283).
 *
 * AC-1이 정한 커밋 축은 **머지 커밋 메시지**다. `/search`는 `prs-commits`를
 * 함께 도는데 그 인덱스에는 `source_commit`도 들어 있으므로, 자유 텍스트를
 * `message`에 조건 없이 걸면 **PR에 딸린 원본 커밋 메시지까지** 검색 대상이
 * 된다 — 승인된 범위를 넘는다.
 *
 * 직접 푸시(`direct_push`)를 함께 넣는 것은 그것도 first-parent 체인에 실제로
 * 나타난 메시지이기 때문이다. 셋 중 빠지는 것은 `source_commit` 하나다.
 */
export const FIRST_PARENT_COMMIT_ROLES = ['merge_commit', 'direct_push'] as const;

/**
 * 자유 텍스트가 점수를 얻는 필드와 가중치 (FR-SRCH-011 AC-1·AC-2).
 *
 * **제목이 본문보다 위다** — AC-2가 그렇게 정한다. `partial`(부분 일치 조각)은
 * 같은 축의 절반 가중치를 준다: 토큰이 통째로 맞은 문서가 접두만 맞은 문서보다
 * 위에 서야 한다.
 *
 * 브랜치명은 `keyword` 본체가 아니라 분석된 서브필드를 본다 — 본체로 걸면
 * `feature/pay-retry` 전체와 정확히 같을 때만 매치된다.
 */
export const FULL_TEXT_FIELDS: readonly string[] = [
  'title^3',
  'title.partial^1.5',
  'body',
  'message',
  'message.partial^0.5',
  'base_branch.text',
  'base_branch.partial^0.5',
  'head_branch.text',
  'head_branch.partial^0.5',
];

/**
 * first-parent 체인 밖의 커밋 (= `source_commit`).
 *
 * `role`이 **있으면서** 승인된 값이 아닌 문서다. PR 문서에는 `role`이 아예
 * 없으므로 `exists`가 걸러 준다 — 이 절이 PR을 배제하지 않는 근거다.
 */
const NON_FIRST_PARENT_COMMIT: estypes.QueryDslQueryContainer = {
  bool: {
    filter: [{ exists: { field: 'role' } }],
    must_not: [{ terms: { role: [...FIRST_PARENT_COMMIT_ROLES] } }],
  },
};

/**
 * 자유 텍스트 절 (FR-SRCH-011).
 *
 * `best_fields`는 "한 필드에서 가장 잘 맞은 점수"를 쓴다. 제목과 본문에 같은
 * 낱말이 있다고 점수를 더하지 않는 것이 옳다 — 그러면 긴 본문이 제목 가중치를
 * 이긴다.
 */
export function buildTextClause(text: string): estypes.QueryDslQueryContainer {
  return { multi_match: { query: text, fields: [...FULL_TEXT_FIELDS], type: 'best_fields' } };
}

/**
 * 이름을 못 찾았을 때 쓰는 절.
 *
 * **빈 `terms`를 넣지 않는다.** `terms: { org_id: [] }`는 아무것도 매치하지
 * 않지만, 읽는 사람에게 "조건이 없다"처럼 보인다. 명시적으로 아무것도 아닌
 * 것을 매치한다고 적는다.
 */
const MATCH_NONE: estypes.QueryDslQueryContainer = { match_none: {} };

function termsClause(field: string, values: readonly string[]): estypes.QueryDslQueryContainer {
  // 값이 하나여도 `terms`를 쓴다. 모양이 하나면 읽고 시험하기 쉽다.
  return { terms: { [field]: [...values] } };
}

function idsClause(field: string, ids: readonly number[]): estypes.QueryDslQueryContainer {
  return ids.length === 0 ? MATCH_NONE : { terms: { [field]: [...ids] } };
}

/** 경로 값 하나하나가 OR다. `path:a path:b`는 둘 중 하나에 닿으면 매치다. */
function pathClause(values: readonly string[]): estypes.QueryDslQueryContainer {
  return {
    bool: {
      minimum_should_match: 1,
      // `term`은 질의를 분석하지 않는다 — 색인된 경로 토큰과 **정확히** 같아야 한다.
      should: values.map((value) => ({ term: { [PATH_FIELD]: value } })),
    },
  };
}

function derivedStateClause(values: readonly string[]): estypes.QueryDslQueryContainer {
  const clauses = values.map((value) => DERIVED_STATE[value]).filter((one) => one !== undefined);
  // 파서가 값을 이미 검증했으므로 여기 도달한 값은 넷 중 하나다.
  return clauses.length === 1 && clauses[0] !== undefined
    ? clauses[0]
    : { bool: { minimum_should_match: 1, should: clauses as estypes.QueryDslQueryContainer[] } };
}

function rangeClause(filter: QueryFilter): estypes.QueryDslQueryContainer | null {
  if (!isRangeFilter(filter)) return null;
  const field = RANGE_FIELDS[filter.key];
  if (field === undefined) return null;
  // 양끝을 모두 포함한다 — `seq:1280..1342`는 1280과 1342를 포함한다.
  return { range: { [field]: { gte: filter.from, lte: filter.to } } };
}

/**
 * 동등 필터 하나를 절로 옮긴다.
 *
 * 못 옮기는 키는 `null`이 아니라 `MATCH_NONE`을 준다. 조용히 빠뜨리면 그
 * 필터가 없었던 것처럼 결과가 **넓어진다** — 필터를 잃는 것보다 0건이 낫다.
 */
function equalityClause(
  filter: QueryFilter,
  resolution: NameResolution,
  unresolved: UnresolvedName[],
): estypes.QueryDslQueryContainer {
  if (isRangeFilter(filter)) return MATCH_NONE;
  const values = filter.values;

  const field = TERM_FIELDS[filter.key];
  if (field !== undefined) return termsClause(field, values);

  if (filter.key === 'path') return pathClause(values);
  if (filter.key === 'is') return derivedStateClause(values);

  if (filter.key === 'org') {
    const ids = values.map((value) => resolution.orgIds.get(value)).filter((id): id is number => id !== undefined);
    for (const value of values) {
      if (!resolution.orgIds.has(value)) unresolved.push({ key: 'org', value });
    }
    return idsClause('org_id', ids);
  }

  if (filter.key === 'team') {
    const ids = values.map((value) => resolution.teamIds.get(value)).filter((id): id is number => id !== undefined);
    for (const value of values) {
      if (!resolution.teamIds.has(value)) unresolved.push({ key: 'team', value });
    }
    return idsClause('allowed_team_ids', ids);
  }

  // 파서가 `QUERY_KEYS` 밖을 이미 거절했으므로 도달하지 않는다.
  return MATCH_NONE;
}

/**
 * 필터 하나를 절로 옮긴다. 부정 여부는 호출 측이 본다.
 */
function toClause(
  filter: QueryFilter,
  resolution: NameResolution,
  unresolved: UnresolvedName[],
): estypes.QueryDslQueryContainer {
  return rangeClause(filter) ?? equalityClause(filter, resolution, unresolved);
}

function isNegated(filter: QueryFilter): boolean {
  return filter.op === 'not_eq' || filter.op === 'not_range';
}

/**
 * AST를 ES 질의로 옮긴다 (WP-013 + WP-032).
 *
 * 자유 텍스트가 있으면 두 가지가 더해진다.
 *
 *   1. `must`에 점수를 내는 절 — 구조화 필터는 그대로 `filter`에 남는다
 *   2. `must_not`에 first-parent 체인 밖 커밋 배제 (DEV-283)
 *
 * **둘 다 자유 텍스트가 있을 때만이다.** `repo:acme/a` 하나로 커밋을 찾는
 * 기존 동작은 바뀌지 않는다 — 원본 커밋을 배제하는 것은 "무엇이 검색 대상
 * 메시지인가"에 대한 답이지 "무엇이 이 저장소의 커밋인가"에 대한 답이 아니다.
 */
export function buildQuery(ast: QueryAst, resolution: NameResolution = EMPTY_RESOLUTION): BuiltQuery {
  const unresolved: UnresolvedName[] = [];
  const filter: estypes.QueryDslQueryContainer[] = [];
  const mustNot: estypes.QueryDslQueryContainer[] = [];
  const must: estypes.QueryDslQueryContainer[] = [];

  for (const one of ast.filters) {
    const clause = toClause(one, resolution, unresolved);
    if (isNegated(one)) mustNot.push(clause);
    else filter.push(clause);
  }

  if (ast.text !== null && ast.text !== '') {
    must.push(buildTextClause(ast.text));
    mustNot.push(NON_FIRST_PARENT_COMMIT);
  }

  if (filter.length === 0 && mustNot.length === 0 && must.length === 0) {
    return { query: { match_all: {} }, unresolved };
  }

  return {
    query: {
      bool: {
        ...(must.length === 0 ? {} : { must }),
        ...(filter.length === 0 ? {} : { filter }),
        ...(mustNot.length === 0 ? {} : { must_not: mustNot }),
      },
    },
    unresolved,
  };
}

/** 질의에 쓰인 이름들. 호출 측이 레지스트리에 물어볼 목록을 만든다. */
export function collectNames(ast: QueryAst): { readonly orgs: string[]; readonly teams: string[] } {
  const orgs = new Set<string>();
  const teams = new Set<string>();

  for (const one of ast.filters) {
    if (isRangeFilter(one)) continue;
    if (one.key === 'org') for (const value of one.values) orgs.add(value);
    if (one.key === 'team') for (const value of one.values) teams.add(value);
  }

  return { orgs: [...orgs], teams: [...teams] };
}
