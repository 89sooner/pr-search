/**
 * `seq:` 조건이 지목하는 시퀀스 공간 (CR-051 / FR-SRCH-005 AC-7).
 *
 * **이 파일은 데이터베이스도 Elasticsearch도 모른다.** 하는 일은 AST 하나를
 * 읽어 "이 질의의 `seq:`가 어느 공간을 뜻하는가"를 판정하는 것뿐이며, 그
 * 공간이 실재하는지·이 사용자가 볼 수 있는지·현재 에폭이 얼마인지는
 * `search-api`가 판정한다. 그래서 **같은 코드를 브라우저가 쓴다** (ADR-001).
 *
 * ## 왜 필요한가
 *
 * 서수는 `(저장소, 대상 브랜치)` 안에서만 뜻이 있다 (ADR-007 규칙 1). 그런데
 * `seq:1200..1350`은 그 공간을 지목하지 않으므로, 접근 범위에 저장소가 여럿이면
 * **같은 번호가 공간마다 다른 커밋을 가리킨 채 한 목록에 섞인다** (DEV-359).
 *
 * 이 판단은 저장소가 이미 한 번 내렸다 — `API-SEQ-004`의 "`base_branch`는
 * 필수다, 서버가 시퀀스 공간을 고르지 않는다" (CR-032, DEV-168). 서버가 고르면
 * 사용자가 묻지 않은 브랜치의 답이 나오고, 정렬을 더해도 결정적으로 같은
 * 오답일 뿐이다.
 *
 * ## 범위 조건만 대상이다
 *
 * `seq:1234`(스칼라)는 여기서 보지 않는다 — **파서가 먼저 거절하기 때문에 이
 * 함수에 도달하지 않는다** (DEV-364). CR-051 시점에는 스칼라가 파서를 통과해
 * `MATCH_NONE`이 되었고, 그때는 그 동작을 400으로 바꾸는 것이 승인 범위 밖이라
 * 사실만 등재했다. 이후 실측이 **부정형 `-seq:1234`는 0건이 아니라 필터가
 * 사라진 전체 결과**임을 드러냈고(DEV-378), SRS가 승인한 것이 범위뿐이므로
 * 파서에서 거절하는 것이 승인된 경계임을 확인해 닫았다.
 */

import { isRangeFilter, type QueryAst } from './ast.js';

/** 공간 지목이 성립하지 않는 두 경우. API 계약의 `detail.reason`과 같은 문자열이다. */
export type SequenceBindingProblem = 'sequence_space_required' | 'sequence_space_ambiguous';

export type SequenceBindingAnalysis =
  /** `seq:` 범위 조건이 없다. 이 질의는 어느 공간에도 묶이지 않는다. */
  | { readonly kind: 'none' }
  /** 정확히 하나의 공간을 지목했다. 실재 여부는 여기서 모른다. */
  | { readonly kind: 'bound'; readonly repository: string; readonly baseBranch: string }
  /** 지목이 없거나 여럿이다. */
  | { readonly kind: 'invalid'; readonly reason: SequenceBindingProblem };

/**
 * 부정이 아닌 `eq` 필터의 값을 모은다.
 *
 * 파서가 같은 `(키, op)`를 한 노드로 모으고 중복 값을 지우므로
 * (`parse.ts`의 `equalities`) 보통 노드는 하나다. 그래도 전부 순회해 `Set`으로
 * 모으는 이유는 **"같은 값을 두 번 적은 것은 하나로 본다"가 계약이기 때문**이며,
 * 그 성질을 파서의 현재 구현에 기대지 않는다.
 */
function positiveValues(ast: QueryAst, key: 'repo' | 'base'): Set<string> {
  const values = new Set<string>();
  for (const filter of ast.filters) {
    if (isRangeFilter(filter)) continue;
    if (filter.key !== key || filter.op !== 'eq') continue;
    for (const value of filter.values) values.add(value);
  }
  return values;
}

/** 이 질의에 `seq:` **범위** 조건이 있는가. 부정된 `-seq:`도 서수를 참조하므로 포함한다. */
export function hasSequenceRangeFilter(ast: QueryAst): boolean {
  return ast.filters.some((filter) => isRangeFilter(filter) && filter.key === 'seq');
}

/**
 * `seq:` 조건이 지목하는 공간을 판정한다.
 *
 * @returns `none`이면 검사할 것이 없고, `bound`면 공간 하나가 확정됐으며,
 *   `invalid`면 질의를 실행하지 않고 거절해야 한다.
 */
export function analyzeSequenceBinding(ast: QueryAst): SequenceBindingAnalysis {
  if (!hasSequenceRangeFilter(ast)) return { kind: 'none' };

  const repositories = positiveValues(ast, 'repo');
  const baseBranches = positiveValues(ast, 'base');

  // 없는 것과 여럿인 것을 가른다 — 사용자가 할 일이 다르다. 없으면 더해야 하고
  // 여럿이면 골라야 한다.
  if (repositories.size === 0 || baseBranches.size === 0) {
    return { kind: 'invalid', reason: 'sequence_space_required' };
  }
  if (repositories.size > 1 || baseBranches.size > 1) {
    return { kind: 'invalid', reason: 'sequence_space_ambiguous' };
  }

  const [repository] = [...repositories];
  const [baseBranch] = [...baseBranches];
  /*
   * `size === 1`을 확인했으므로 도달하지 않는다. 타입을 좁히기 위한 가드다.
   *
   * **위의 첫 검사를 지우면 도달한다** — 변이 시험(M1)이 살아남아 그 사실을
   * 드러냈다. 같은 `sequence_space_required`를 내므로 결과는 우연히 같지만,
   * 그때 **`ambiguous`와 `required`를 가르는 능력을 잃는다**(M2는 죽는다).
   * 첫 검사의 가치는 "거절한다"가 아니라 **"어느 쪽으로 거절하는가"**이며,
   * 사용자가 할 일이 그 둘에서 다르다.
   */
  if (repository === undefined || baseBranch === undefined) {
    return { kind: 'invalid', reason: 'sequence_space_required' };
  }
  return { kind: 'bound', repository, baseBranch };
}

/** 화면과 API가 같은 문구를 쓰도록 한 곳에 둔다. */
export const SEQUENCE_BINDING_MESSAGE: Readonly<Record<SequenceBindingProblem, string>> = {
  sequence_space_required:
    'seq: 조건은 하나의 시퀀스 공간에서만 의미가 있습니다. repo:와 base:를 각각 하나씩 지정하세요.',
  sequence_space_ambiguous:
    'seq: 조건이 여러 시퀀스 공간을 가리킵니다. repo:와 base:를 각각 하나만 남기세요.',
};
