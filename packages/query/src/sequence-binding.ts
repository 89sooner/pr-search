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

/**
 * `seq:`·`mnum:` 공용 공간 지목 판정 (CR-106).
 *
 * **`analyzeSequenceBinding`과 `analyzeMergeNumberBinding`이 이 함수 하나를
 * 부른다.** 처음엔 두 함수가 이 본문을 각자 손으로 복제했는데, 그 복제가
 * 실제로 사고를 냈다 — `mnum:` 응답 문구가 `seq:`의 것을 그대로 물려받은 채
 * 나갔다(`toMergeNumberRangeFailure` 주석 참고). 판정 로직은 하나로 묶고,
 * 갈라야 하는 것(에폭을 어느 색인 필드에 거는지, 문구)만 호출부에서 가른다.
 *
 * @param hasFilter 이 판정을 트리거하는 범위 조건이 있는가
 *   (`hasSequenceRangeFilter`/`hasMergeNumberRangeFilter`). 판정 자체는 어느
 *   키가 트리거했는지 몰라도 된다 — 공간 지목 규칙은 같기 때문이다.
 */
function analyzeSpaceBinding(ast: QueryAst, hasFilter: boolean): SequenceBindingAnalysis {
  if (!hasFilter) return { kind: 'none' };

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

/** 이 질의에 `seq:` **범위** 조건이 있는가. 부정된 `-seq:`도 서수를 참조하므로 포함한다. */
export function hasSequenceRangeFilter(ast: QueryAst): boolean {
  return ast.filters.some((filter) => isRangeFilter(filter) && filter.key === 'seq');
}

/**
 * 이 질의에 `mnum:` **범위** 조건이 있는가 (CR-106). 부정된 `-mnum:`도 포함한다.
 *
 * **`hasSequenceRangeFilter`를 넓히지 않는다.** 그 함수는 `seq_epoch` 커서 지문·
 * URL 인용처럼 `seq:` 전용 장치 여럿이 그대로 가져다 쓰므로, `mnum:`을 섞으면
 * 그 장치들이 `mnum:`만 있는 질의에도 뜻 없이 반응한다. 지목 규칙(공간)은
 * 같아도 에폭을 어느 색인 필드에 거는지는 다르므로(아래 `analyzeMergeNumberBinding`
 * 주석) 검출 함수를 분리해 둔다.
 */
export function hasMergeNumberRangeFilter(ast: QueryAst): boolean {
  return ast.filters.some((filter) => isRangeFilter(filter) && filter.key === 'mnum');
}

/**
 * `mnum:` 판정의 반환 모양 (CR-106 → CR-114).
 *
 * `seq:`와 같은 `none`·`bound`·`invalid`에 **`repository_only`가 하나 더 있다** —
 * `repo:`는 하나인데 `base:`가 없는 경우다. `seq:`라면 `sequence_space_required`로
 * 거절하지만(AC-7), `mnum:`은 그 저장소가 추적하는 시퀀스 브랜치가 **하나뿐이면**
 * 지목이 유일하므로 서버가 그 브랜치로 묶는다(AC-9 보완). 브랜치가 여럿이면
 * 서버가 거절한다 — 서버가 고르는 것이 아니라 고를 것이 없을 때만 통과한다.
 * 이 파일은 저장소 정보를 모르므로 그 판정을 호출부에 넘긴다.
 */
export type MergeNumberBindingAnalysis =
  | SequenceBindingAnalysis
  | { readonly kind: 'repository_only'; readonly repository: string };

/**
 * `mnum:` 조건이 지목하는 시퀀스 공간을 판정한다 (FR-SRCH-005 AC-9, CR-106 · CR-114).
 *
 * **`analyzeSequenceBinding`과 판정 로직이 같다** — M 번호는 `merge_seq`와 같은
 * 시퀀스 공간·에폭을 공유하므로(용어집 「M 넘버」) 지목 규칙도 AC-7을 그대로
 * 따른다(AC-9). 로직을 복제하는 이유는 **호출부가 다르기 때문**이다 — `seq:`
 * 판정은 `seq_epoch` 커서 지문·URL 인용까지 딸려 있고, `mnum:` 판정은 그런
 * 부가 장치 없이 "현재 에폭"만 필요하다(API 계약 「식별자 범위 지목 계약」).
 *
 * CR-114가 더한 것은 `base:` 생략 한 가지다: `repo:`가 하나이고 `base:`가 없으면
 * `repository_only`로 돌려주고, 브랜치가 유일한지는 서버가 저장소 행을 읽어
 * 정한다. `repo:`가 없거나 여럿인 것, `base:`가 여럿인 것은 그대로 `invalid`다.
 *
 * @returns `none`이면 검사할 것이 없고, `bound`면 공간 하나가 확정됐으며,
 *   `repository_only`면 저장소만 확정됐고, `invalid`면 질의를 실행하지 않고
 *   거절해야 한다.
 */
export function analyzeMergeNumberBinding(ast: QueryAst): MergeNumberBindingAnalysis {
  if (!hasMergeNumberRangeFilter(ast)) return { kind: 'none' };

  const repositories = positiveValues(ast, 'repo');
  const baseBranches = positiveValues(ast, 'base');
  if (repositories.size === 0) return { kind: 'invalid', reason: 'sequence_space_required' };
  if (repositories.size > 1 || baseBranches.size > 1) {
    return { kind: 'invalid', reason: 'sequence_space_ambiguous' };
  }
  const [repository] = [...repositories];
  if (repository === undefined) return { kind: 'invalid', reason: 'sequence_space_required' };
  if (baseBranches.size === 0) return { kind: 'repository_only', repository };
  const [baseBranch] = [...baseBranches];
  if (baseBranch === undefined) return { kind: 'invalid', reason: 'sequence_space_required' };
  return { kind: 'bound', repository, baseBranch };
}

/** 지목이 성립하지 않는 두 경우 (CR-106). API 계약의 `detail.reason`과 같은 문자열이다. */
export type RepositoryBindingProblem = 'repository_required' | 'repository_ambiguous';

export type RepositoryBindingAnalysis =
  /** `pr_number:` 범위 조건이 없다. */
  | { readonly kind: 'none' }
  /** 정확히 하나의 저장소를 지목했다. 실재 여부는 여기서 모른다. */
  | { readonly kind: 'bound'; readonly repository: string }
  /** 지목이 없거나 여럿이다. */
  | { readonly kind: 'invalid'; readonly reason: RepositoryBindingProblem };

/** 이 질의에 `pr_number:` **범위** 조건이 있는가 (CR-106). 부정된 `-pr_number:`도 포함한다. */
export function hasPrNumberRangeFilter(ast: QueryAst): boolean {
  return ast.filters.some((filter) => isRangeFilter(filter) && filter.key === 'pr_number');
}

/**
 * `pr_number:` 조건이 지목하는 저장소를 판정한다 (FR-SRCH-005 AC-8, CR-106).
 *
 * **`base:`를 요구하지 않는다.** PR 번호는 GitHub이 저장소 안에서 생성 시점에
 * 매기므로 대상 브랜치나 시퀀스 에폭과 무관하다 — `analyzeSequenceBinding`보다
 * 요구가 하나 적은, 별개의 더 단순한 판정이다.
 */
export function analyzePrNumberBinding(ast: QueryAst): RepositoryBindingAnalysis {
  if (!hasPrNumberRangeFilter(ast)) return { kind: 'none' };

  const repositories = positiveValues(ast, 'repo');
  if (repositories.size === 0) return { kind: 'invalid', reason: 'repository_required' };
  if (repositories.size > 1) return { kind: 'invalid', reason: 'repository_ambiguous' };

  const [repository] = [...repositories];
  if (repository === undefined) return { kind: 'invalid', reason: 'repository_required' };
  return { kind: 'bound', repository };
}

/** 화면과 API가 같은 문구를 쓰도록 한 곳에 둔다 (CR-106). */
export const REPOSITORY_BINDING_MESSAGE: Readonly<Record<RepositoryBindingProblem, string>> = {
  repository_required: 'A pr_number: filter applies to a single repository. Specify exactly one repo: filter.',
  repository_ambiguous: 'The pr_number: filter references multiple repositories. Keep only one repo: filter.',
};

/**
 * `seq:` 조건이 지목하는 공간을 판정한다.
 *
 * @returns `none`이면 검사할 것이 없고, `bound`면 공간 하나가 확정됐으며,
 *   `invalid`면 질의를 실행하지 않고 거절해야 한다.
 */
export function analyzeSequenceBinding(ast: QueryAst): SequenceBindingAnalysis {
  return analyzeSpaceBinding(ast, hasSequenceRangeFilter(ast));
}

/** 화면과 API가 같은 문구를 쓰도록 한 곳에 둔다. */
export const SEQUENCE_BINDING_MESSAGE: Readonly<Record<SequenceBindingProblem, string>> = {
  sequence_space_required:
    'A seq: filter applies to a single sequence space. Specify exactly one repo: and one base: filter.',
  sequence_space_ambiguous:
    'The seq: filter references multiple sequence spaces. Keep only one repo: and one base: filter.',
};

/**
 * `mnum:` 전용 문구 (CR-106).
 *
 * **사유 코드(`SequenceBindingProblem`)는 `SEQUENCE_BINDING_MESSAGE`와 공유하지만
 * 문구는 공유하지 않는다.** `analyzeMergeNumberBinding`이 `analyzeSequenceBinding`과
 * 같은 판정 로직·같은 `detail.reason` 문자열을 내는 것은 의도된 설계이지만, 사람이
 * 읽는 문장까지 `seq:`로 고정하면 `mnum:`만 쓰고 `base:`를 빠뜨린 사용자에게 "A seq:
 * filter…"라고 답하는 오답이 된다 — 기계가 읽는 사유 코드와 사람이 읽는 문구는
 * 같은 것을 공유할 이유가 없다.
 */
export const MERGE_NUMBER_BINDING_MESSAGE: Readonly<Record<SequenceBindingProblem, string>> = {
  sequence_space_required:
    'A mnum: filter applies to a single sequence space. Specify exactly one repo: filter (and one base: filter when the repository tracks more than one branch), or search the M number itself as M-<code>-<number>.',
  sequence_space_ambiguous:
    'The mnum: filter references multiple sequence spaces. Keep only one repo: and one base: filter.',
};

/**
 * `repo:`만 적었는데 그 저장소가 시퀀스 브랜치를 둘 이상 추적한다 (CR-114).
 *
 * 사유 코드는 `sequence_space_ambiguous`를 그대로 쓴다 — 지목이 여럿인 것은
 * 같다. 문구만 다르다: 사용자가 할 일이 `repo:`를 줄이는 것이 아니라 `base:`를
 * 더하는 것이기 때문이다. 어느 브랜치가 있는지는 서버가 `detail.sequence_branches`로 준다.
 */
export const MERGE_NUMBER_BRANCH_REQUIRED_MESSAGE =
  'This repository tracks more than one sequence branch, so the mnum: filter needs exactly one base: filter.';
