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

import type { estypes } from "@elastic/elasticsearch";
import {
  hasMergeNumberRangeFilter,
  hasSequenceRangeFilter,
  isRangeFilter,
  type QueryAst,
  type QueryFilter,
  type QueryKey,
} from "@prs/query";
import type { EntityAlias } from "./indices.js";

/**
 * 키가 보는 ES 필드 (CR-016, DEV-052).
 *
 * `org`·`team`·`author_team`·`is`·`kind`는 여기 없다 — 필드 이름만으로
 * 풀리지 않아 따로 다룬다. 앞의 셋은 레지스트리 해석이 필요하고, `is`는 파생
 * 상태이며, `kind`는 **필드가 아니라 인덱스가 답한다** (CR-053, DEV-383).
 */
const TERM_FIELDS: Readonly<Partial<Record<QueryKey, string>>> = {
  repo: "repository",
  author: "author",
  reviewer: "reviewers",
  label: "labels",
  base: "base_branch",
  head: "head_branch",
  state: "state",
  release: "release_tags",
};

/** 범위 키가 보는 ES 필드. */
const RANGE_FIELDS: Readonly<Partial<Record<QueryKey, string>>> = {
  seq: "merge_seq",
  merged: "merged_at",
  created: "created_at",
  /*
   * 변경 규모 (CR-056, DEV-451). 분포 구간의 드릴다운이 이 조건으로 그 구간을
   * 가리킨다.
   *
   * **값이 없는 문서는 여기 걸리지 않는다** — 보강이 끝나지 않은 문서는 이
   * 필드를 갖지 않으며(DEV-450), 그것이 `unknown` 구간에 질의를 주지 않는
   * 이유이기도 하다. 없는 값을 거는 조건은 만들지 않는다.
   */
  changed_files: "changed_files_count",
  changed_lines: "changed_lines",
  /*
   * 식별자 범위 (CR-106, FR-SRCH-005 AC-8·AC-9).
   *
   * `pr_number`는 이 매핑만으로 충분하다 — 에폭 게이트가 필요 없다(아래
   * `buildQuery`의 `mnum:` 처리와 다르다).
   */
  pr_number: "pr_number",
  mnum: "merge_number",
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
const PATH_FIELD = "changed_paths";

/** `is`가 보는 자리 (CR-016, DEV-053). `state`와 겹치는 셋은 같은 필드다. */
const DERIVED_STATE: Readonly<Record<string, estypes.QueryDslQueryContainer>> = {
  merged: { term: { state: "merged" } },
  open: { term: { state: "open" } },
  closed: { term: { state: "closed" } },
  // GitHub에는 없는, 관계 파생이 만든 상태다.
  reverted: { term: { "link_summary.is_reverted": true } },
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
  /**
   * `team.slug` → `team_id` **목록** (WP-032, PR #57 리뷰 P2).
   *
   * slug은 조직 안에서만 유일하다(`UNIQUE (org_id, slug)`). 이름 하나가 팀
   * 여럿을 가리킬 수 있으므로 목록이며, `terms`로 묶으면 OR가 되어 "그 이름의
   * 팀 중 어느 것이든"이라는 사용자의 뜻과 맞는다. 하나만 고르면 패싯을
   * 눌렀을 때 나오는 건수가 bucket과 다르다.
   */
  readonly teamIds: ReadonlyMap<string, readonly number[]>;
}

export const EMPTY_RESOLUTION: NameResolution = { orgIds: new Map(), teamIds: new Map() };

/**
 * 해석하지 못한 이름. 응답에 남겨 "왜 0건인가"를 말할 수 있게 한다.
 *
 * **`team`과 `author_team`을 구분해 싣는다** (CR-053, DEV-382). 같은 slug라도
 * 사용자가 물은 것이 접근 권한인지 작성자 소속인지에 따라 할 일이 다르다.
 */
export interface UnresolvedName {
  readonly key: "org" | "team" | "author_team";
  readonly value: string;
}

export interface BuiltQuery {
  readonly query: estypes.QueryDslQueryContainer;
  /** 레지스트리에 없던 이름. 비어 있지 않으면 그만큼 결과가 좁아진 것이다. */
  readonly unresolved: readonly UnresolvedName[];
}

export interface BuildQueryOptions {
  /**
   * `seq:` 범위 조건이 딛고 선 시퀀스 에폭 (CR-051, DEV-361).
   *
   * **AST에 `seq:` 범위가 있으면 필수다.** 없으면 `buildQuery`가 던진다 —
   * 선택으로 두면 호출부가 빠뜨렸을 때 **오류 없이 모든 세대의 문서를
   * 함께 돌려주고**, 그 실패는 결과를 재는 시험에 잡히지 않는다
   * (DEV-353이 다섯 WP를 살아남은 것과 같은 모양). 여기서는 fail-closed가
   * 아니라 fail-open이라 더 나쁘다.
   */
  readonly sequenceEpoch?: number;
  /**
   * `mnum:` 범위 조건이 딛고 선 M 번호 유효 에폭 (CR-106).
   *
   * **`sequenceEpoch`과 값은 같을 수 있지만 별개 옵션이다.** 이 값은
   * `seq_epoch`이 아니라 색인의 `merge_number_epoch` 필드에 건다 — 두 필드는
   * 서로 다른 투영 작업(PR 투영·M 번호 투영)이 다른 시점에 쓰므로
   * (`packages/es/src/mappings/pull-requests.ts` 주석), `sequenceEpoch`
   * 하나로 두 필드를 함께 게이트할 수 없다. `seq:`와 `mnum:`이 같은 질의에
   * 함께 있으면 두 옵션에 **같은 값**(그 공간의 현재 에폭)을 넣는다 — 공간
   * 해석은 호출부가 한 번만 한다.
   */
  readonly mergeNumberEpoch?: number;
}

/** `seq:` 범위가 있는데 에폭 없이 질의를 만들려 했다. 배포·조립 오류다. */
export class SequenceEpochRequiredError extends Error {
  constructor() {
    super("seq: 범위 조건이 있는 질의에는 시퀀스 에폭이 필요하다 (CR-051)");
    this.name = "SequenceEpochRequiredError";
  }
}

/** `mnum:` 범위가 있는데 M 번호 에폭 없이 질의를 만들려 했다. 배포·조립 오류다 (CR-106). */
export class MergeNumberEpochRequiredError extends Error {
  constructor() {
    super("mnum: 범위 조건이 있는 질의에는 M 번호 에폭이 필요하다 (CR-106)");
    this.name = "MergeNumberEpochRequiredError";
  }
}

/**
 * `kind:` 필터가 인덱스로 옮겨지지 않은 채 질의 조립에 도달했다 (CR-053, DEV-383).
 *
 * 호출부는 `resolveSearchTarget`으로 검색 대상을 좁힌 뒤 `buildQuery`를 부른다.
 * **빠뜨리면 던진다** — 조용히 넘기면 `filter`에서는 0건이 되고 `must_not`에서는
 * 조건이 통째로 사라지며, 후자는 결과를 재는 시험에 잡히지 않는다.
 */
export class KindFilterNotAppliedError extends Error {
  constructor() {
    super("kind: 필터는 resolveSearchTarget으로 검색 대상을 좁혀 적용한다 (CR-053)");
    this.name = "KindFilterNotAppliedError";
  }
}

/** `kind:` 값과 엔티티 별칭의 대응. 사용자에게 인덱스 이름을 노출하지 않는다. */
const KIND_ALIAS: Readonly<Record<string, EntityAlias>> = {
  pull_request: "prs-pull-requests",
  commit: "prs-commits",
};

/**
 * `kind:` 필터가 정하는 검색 대상 (CR-053, DEV-383).
 *
 * **문서에 `kind` 필드를 두지 않고 인덱스를 좁힌다.** 인덱스가 이미 그 사실을
 * 알고 있어 중복 저장이 되고, 두 곳이 갈라지면 한쪽만 맞는 날이 온다.
 *
 * **걷어낸 AST를 함께 돌려준다.** `kind:`를 남긴 채 `buildQuery`에 넘기면
 * `KindFilterNotAppliedError`가 난다 — 그 오류의 목적은 "대상을 좁히지 않았다"를
 * 드러내는 것이므로, 좁힌 뒤에는 필터가 사라져 있어야 한다. 두 값을 함께 주면
 * 호출부가 하나만 쓰다 어긋날 자리가 없다.
 *
 * @returns `target`이 `null`이면 어떤 문서도 매치하지 않는다 — 호출부가
 *   조회하지 않고 빈 결과를 낸다. 빈 배열을 돌려주지 않는 이유는 Elasticsearch가
 *   빈 인덱스 목록을 **전체 검색**으로 읽기 때문이다.
 */
export function resolveSearchTarget(
  ast: QueryAst,
  base: readonly EntityAlias[],
): { readonly target: readonly EntityAlias[] | null; readonly ast: QueryAst } {
  let allowed = new Set<EntityAlias>(base);
  let touched = false;

  for (const filter of ast.filters) {
    if (isRangeFilter(filter) || filter.key !== "kind") continue;
    touched = true;
    // 파서가 값을 열거로 검증했으므로 여기 도달한 값은 둘 중 하나다.
    const named = filter.values
      .map((value) => KIND_ALIAS[value])
      .filter((alias): alias is EntityAlias => alias !== undefined);

    if (filter.op === "eq") {
      // 같은 키의 값 여럿은 OR다 (AC-5) — 교집합을 그 합집합으로 좁힌다.
      const keep = new Set<EntityAlias>(named);
      allowed = new Set([...allowed].filter((alias) => keep.has(alias)));
    } else {
      for (const alias of named) allowed.delete(alias);
    }
  }

  if (!touched) return { target: base, ast };

  const stripped: QueryAst = {
    ...ast,
    filters: ast.filters.filter((filter) => isRangeFilter(filter) || filter.key !== "kind"),
  };
  return { target: allowed.size === 0 ? null : [...allowed], ast: stripped };
}

/**
 * 범위 전용 키가 동등 필터로 왔다. 배포·조립 오류다 (DEV-364, DEV-378, DEV-379).
 *
 * **조용한 실패의 방향이 부호마다 다르다.** `filter`에 놓인 `MATCH_NONE`은
 * 0건이지만 `must_not`에 놓이면 아무것도 걸러내지 않아 **필터가 통째로
 * 사라진다** — 하나는 너무 좁고 하나는 너무 넓은데 둘 다 오류를 내지 않는다.
 * 그래서 `MATCH_NONE`으로 삼키지 않고 던진다.
 */
export class RangeKeyEqualityError extends Error {
  constructor(readonly key: QueryKey) {
    super(`'${key}'는 범위 전용 키다 — 동등 필터로 질의를 만들 수 없다 (DEV-364)`);
    this.name = "RangeKeyEqualityError";
  }
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
export const FIRST_PARENT_COMMIT_ROLES = ["merge_commit", "direct_push"] as const;

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
  "title^3",
  "title.partial^1.5",
  "body",
  "message",
  "message.partial^0.5",
  "base_branch.text",
  "base_branch.partial^0.5",
  "head_branch.text",
  "head_branch.partial^0.5",
];

/**
 * first-parent 체인 밖의 커밋 (= `source_commit`).
 *
 * `role`이 **있으면서** 승인된 값이 아닌 문서다. PR 문서에는 `role`이 아예
 * 없으므로 `exists`가 걸러 준다 — 이 절이 PR을 배제하지 않는 근거다.
 */
const NON_FIRST_PARENT_COMMIT: estypes.QueryDslQueryContainer = {
  bool: {
    filter: [{ exists: { field: "role" } }],
    must_not: [{ terms: { role: [...FIRST_PARENT_COMMIT_ROLES] } }],
  },
};

/**
 * 자유 텍스트 절 (FR-SRCH-011).
 *
 * `best_fields`는 "한 필드에서 가장 잘 맞은 점수"를 쓴다. 제목과 본문에 같은
 * 낱말이 있다고 점수를 더하지 않는 것이 옳다 — 그러면 긴 본문이 제목 가중치를
 * 이긴다.
 *
 * **공백 없는 한 마디는 구문으로 묶는다** (AC-4, DEV-722). `standard`
 * 토크나이저는 하이픈에도 끊는다 — `VANGUARD-1`이 `vanguard`·`1` 두 토큰이
 * 된다. 기본 OR(`best_fields`)는 둘 중 하나만 맞아도 매치를 인정하므로, 흔한
 * 토큰 `1`이 본문·브랜치명 어딘가에 있을 뿐인 무관한 문서가 함께 걸린다.
 * `type: "phrase"`로 그 서브토큰들이 인접해야만 매치되게 묶으면 이 문제가
 * 사라진다 — 실제 Elasticsearch로 실측했다
 * (`apps/search-api/integration/search/facets.test.ts`의 DEV-722 시험).
 *
 * **공백이 있는 여러 낱말에는 적용하지 않는다.** AC-4는 `결제 retry`처럼
 * 언어가 섞인 여러 낱말 질의에서 **어느 한쪽만 맞아도** 매치를 요구한다 —
 * 거기에 구문 매칭을 적용하면 그 요구를 어긴다. 판단 기준은 분석 후 토큰
 * 개수가 아니라 **사용자가 실제로 입력한, 분석 이전의 원문에 공백이
 * 있는지**다 — 토큰 개수로 가르면 공백 있는 낱말이 조사·기호 없이 한
 * 토큰으로 분석되는 우연한 경우와 구분할 수 없다.
 */
export function buildTextClause(text: string): estypes.QueryDslQueryContainer {
  const isSingleToken = !/\s/.test(text.trim());
  return {
    multi_match: {
      query: text,
      fields: [...FULL_TEXT_FIELDS],
      type: isSingleToken ? "phrase" : "best_fields",
    },
  };
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

  /*
   * 파서가 이미 거절하므로 사용자 입력으로는 도달하지 않는다 (DEV-364).
   * 그래도 던지는 것은 AST를 직접 조립하는 경로가 생겼을 때를 위해서다 —
   * 그 실패는 결과를 재는 시험에 잡히지 않는다.
   */
  if (RANGE_FIELDS[filter.key] !== undefined) throw new RangeKeyEqualityError(filter.key);

  const values = filter.values;

  const field = TERM_FIELDS[filter.key];
  if (field !== undefined) return termsClause(field, values);

  if (filter.key === "path") return pathClause(values);
  if (filter.key === "is") return derivedStateClause(values);

  if (filter.key === "org") {
    const ids = values
      .map((value) => resolution.orgIds.get(value))
      .filter((id): id is number => id !== undefined);
    for (const value of values) {
      if (!resolution.orgIds.has(value)) unresolved.push({ key: "org", value });
    }
    return idsClause("org_id", ids);
  }

  if (filter.key === "team" || filter.key === "author_team") {
    /*
     * 이름 하나가 팀 여럿을 가리킬 수 있다 — 전부 실어 OR로 만든다.
     *
     * **두 키가 같은 레지스트리를 쓰고 다른 필드를 본다** (CR-053, DEV-382).
     * slug → team_id 해석은 같은 표가 답하지만, `team`은 저장소 접근 권한
     * (`allowed_team_ids`)이고 `author_team`은 작성자 소속(`author_team_ids`)이다.
     * 필드를 하나로 합치면 **권한을 성과로 읽게 된다.**
     */
    const ids = values.flatMap((value) => [...(resolution.teamIds.get(value) ?? [])]);
    for (const value of values) {
      if (!resolution.teamIds.has(value)) unresolved.push({ key: filter.key, value });
    }
    return idsClause(filter.key === "team" ? "allowed_team_ids" : "author_team_ids", ids);
  }

  /*
   * `kind`는 절이 되지 않는다 — `resolveSearchTarget`이 인덱스를 좁혀 이미
   * 처리했어야 한다 (CR-053, DEV-383).
   *
   * **여기 도달하면 호출부가 그것을 빠뜨린 것이므로 던진다.** `MATCH_NONE`으로
   * 삼키면 `filter`에서는 0건이 되고 `must_not`에서는 조건이 통째로 사라진다 —
   * DEV-378이 범위 전용 키에서 겪은 것과 같은 실패다.
   */
  if (filter.key === "kind") throw new KindFilterNotAppliedError();

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
  return filter.op === "not_eq" || filter.op === "not_range";
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
export function buildQuery(
  ast: QueryAst,
  resolution: NameResolution = EMPTY_RESOLUTION,
  options: BuildQueryOptions = {},
): BuiltQuery {
  const unresolved: UnresolvedName[] = [];
  const filter: estypes.QueryDslQueryContainer[] = [];
  const mustNot: estypes.QueryDslQueryContainer[] = [];
  const must: estypes.QueryDslQueryContainer[] = [];

  /*
   * 서수는 한 세대 안에서만 뜻이 있다 (ADR-007, CR-051).
   *
   * 재채번 도중에는 옛 세대와 새 세대의 문서가 잠시 함께 있고, 이 필터가
   * 없으면 **한 목록에 두 세대가 섞인다.** 부정된 `-seq:`도 같은 서수를
   * 참조하므로 함께 걸린다 — `must_not`에 들어가는 것은 범위 절이고
   * 에폭은 결과 집합 전체의 조건이다.
   */
  if (hasSequenceRangeFilter(ast)) {
    if (options.sequenceEpoch === undefined) throw new SequenceEpochRequiredError();
    filter.push({ term: { seq_epoch: options.sequenceEpoch } });
  }

  /*
   * M 번호도 한 세대 안에서만 뜻이 있다 (CR-106) — 같은 이유, 다른 필드다.
   *
   * `seq_epoch`이 아니라 `merge_number_epoch`에 건다. 색인의 두 필드는 서로
   * 다른 투영 작업이 다른 시점에 쓰므로(PR 투영·M 번호 투영), `seq_epoch`만
   * 걸면 M 번호 투영이 뒤처진 문서가 최신 PR 투영 문서와 함께 통과해 두
   * 세대의 M 번호가 한 목록에 섞인다 — 위 블록이 `seq:`에 대해 막는 것과
   * 같은 결함을 `mnum:` 자리에서 반복하는 셈이다. 배정되지 않은 M 번호(
   * `pending`·미대상)는 이 필드 자체가 없으므로 `range` 절이 자연히
   * 걸러 낸다 — 별도 판정을 더하지 않는다.
   */
  if (hasMergeNumberRangeFilter(ast)) {
    if (options.mergeNumberEpoch === undefined) throw new MergeNumberEpochRequiredError();
    filter.push({ term: { merge_number_epoch: options.mergeNumberEpoch } });
  }

  for (const one of ast.filters) {
    const clause = toClause(one, resolution, unresolved);
    if (isNegated(one)) mustNot.push(clause);
    else filter.push(clause);
  }

  if (ast.text !== null && ast.text !== "") {
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

/**
 * 질의에 쓰인 이름들. 호출 측이 레지스트리에 물어볼 목록을 만든다.
 *
 * **`author_team`도 여기 모은다** (CR-053, DEV-382). 두 키가 같은 레지스트리를
 * 쓰므로 목록은 하나다 — 빠뜨리면 그 필터만 해석되지 않아 **조용히 0건**이 된다.
 */
export function collectNames(ast: QueryAst): { readonly orgs: string[]; readonly teams: string[] } {
  const orgs = new Set<string>();
  const teams = new Set<string>();

  for (const one of ast.filters) {
    if (isRangeFilter(one)) continue;
    if (one.key === "org") for (const value of one.values) orgs.add(value);
    if (one.key === "team" || one.key === "author_team") {
      for (const value of one.values) teams.add(value);
    }
  }

  return { orgs: [...orgs], teams: [...teams] };
}
