/**
 * PR 제목 표기의 순수 판정 (WP-075 / FR-SEQ-009, ADR-022).
 *
 * **GHE를 부르기 전에 여기서 답이 나온다.** 무엇을 쓸지 정하는 일과 실제로 쓰는
 * 일을 한 함수에 두면, "덮어쓰지 않는다"(ADR-022 결정 5)를 시험하려고 매번 HTTP를
 * 세워야 하고 그러면 경계값이 거의 검증되지 않는다.
 *
 * ## 이 파일이 M 번호를 만들지 않는다
 *
 * 저장소 코드와 표기 문자열의 정본은 `@prs/domain`의 `repositoryCodeOf`·
 * `formatMergeNumber`다. 여기서 숫자를 다시 뽑거나 형식을 다시 쓰면 표기하는 쪽과
 * 읽는 쪽이 갈라진다 — 그것이 `@prs/domain/mnumber.ts`가 존재하는 이유다.
 * `merge_number`도 이미 확정된 값을 받기만 하며 다시 계산하지 않는다 (FR-SEQ-009 AC-7).
 */

import { formatMergeNumber, parseMergeNumber, repositoryCodeOf } from '@prs/domain';

/**
 * 제목 맨 앞의 대괄호 한 덩어리.
 *
 * **앞 공백을 허용하는 이유는 중복을 막기 위해서다.** ` [M-1900-1] 제목`을 "접두
 * 없음"으로 읽으면 우리가 하나 더 붙여 `[M-1900-1]  [M-1900-1] 제목`이 된다.
 * 허용은 **탐지에만** 쓰고, 붙일 때는 원래 문자열을 그대로 둔다 — 공백을 정리하는
 * 것도 제목을 고치는 일이고 AC-1은 나머지를 바꾸지 말라고 한다.
 *
 * 관용하는 공백은 **줄바꿈이 아닌 모든 공백**이다. 칸 문자와 탭만 보면 사용자가
 * 붙여 넣은 non-breaking space 뒤의 접두를 못 알아보고 하나 더 붙인다. 줄바꿈은
 * 제외한다 — GitHub PR 제목은 한 줄이며, 여러 줄 입력에서 `[` 뒤 아무 데나 있는
 * `]`까지 삼키면 본문 일부를 접두로 오인한다.
 */
const LEADING_BRACKET = /^[^\S\r\n]*\[([^\]\r\n]*)\]/;

export type AnnotationTarget =
  /** 표기할 문자열이 정해졌다. */
  | { readonly kind: 'target'; readonly expected: string }
  /**
   * 저장소 코드를 확정할 수 없다 (`OD-009`).
   *
   * 첫 숫자 구간을 고르거나 여러 구간을 이어 붙이지 **않는다**. 그렇게 만든 코드는
   * 저장소 이름이 바뀐 날 과거 인용이 조용히 다른 저장소를 가리키게 한다.
   */
  | { readonly kind: 'code_unavailable'; readonly reason: 'no_digits' | 'multiple_digit_runs' };

/**
 * 표기 문자열을 정한다. **GHE를 부르기 전에 부른다.**
 *
 * 코드를 못 만드는 저장소는 여기서 걸러야 제목 조회 요청 한 번도 나가지 않는다 —
 * 어차피 쓸 수 없는 대상에 한도를 쓰지 않는다.
 *
 * @param repositoryName 저장소 **이름**만이다. `owner/name`을 넘기면 소유자의 숫자가
 *   코드가 되어 버린다 (`repositoryCodeOf`의 계약).
 * @param mergeNumber 정본에 이미 저장된 `merge_number`. 이 함수는 채번하지 않는다.
 */
export function resolveAnnotationTarget(repositoryName: string, mergeNumber: number): AnnotationTarget {
  const code = repositoryCodeOf(repositoryName);
  if (code.kind === 'unavailable') return { kind: 'code_unavailable', reason: code.reason };
  return { kind: 'target', expected: formatMergeNumber(code.code, mergeNumber) };
}

export type TitleDecision =
  /** 접두가 없다. 붙인다. */
  | { readonly kind: 'update'; readonly nextTitle: string }
  /** 같은 접두가 이미 있다. GHE를 부르지 않는다 (FR-SEQ-009 AC-2). */
  | { readonly kind: 'already_annotated' }
  /**
   * 다른 M 넘버 접두가 있다. **덮어쓰지 않는다** (ADR-022 결정 5).
   *
   * 사람이 손으로 넣었거나 다른 도구가 쓴 값을 조용히 지우면 이 제품이 조사 대상
   * 자체를 오염시킨다. 에폭이 오른 뒤의 옛 번호도 같은 규칙으로 남는다.
   */
  | { readonly kind: 'mismatch'; readonly found: string };

/**
 * 지금 제목을 보고 무엇을 할지 정한다.
 *
 * **`expected`는 `resolveAnnotationTarget`이 만든 값이어야 한다.** 호출부가 문자열을
 * 직접 조립하면 이 파일이 막으려던 갈라짐이 그 자리에서 생긴다.
 *
 * @param currentTitle **방금 GHE에서 읽은** 제목이어야 한다. 이벤트나 정본에 저장된
 *   옛 제목을 넣으면 그 사이의 사용자 편집을 덮는다 (WP-075 구현 범위).
 */
export function decideTitleUpdate(expected: string, currentTitle: string): TitleDecision {
  const bracket = LEADING_BRACKET.exec(currentTitle);
  const inner = bracket?.[1];
  if (inner !== undefined && parseMergeNumber(inner) !== null) {
    return inner === expected ? { kind: 'already_annotated' } : { kind: 'mismatch', found: inner };
  }
  /*
   * 접두가 아예 없거나(`제목`), M 넘버가 아닌 접두가 있다(`[WIP] 제목`). 둘 다 앞에
   * 붙이기만 한다 — `[WIP]`를 지우거나 옮기지 않는다. 원래 문자열은 공백·대소문자·
   * 유니코드까지 한 글자도 건드리지 않고 그대로 뒤에 둔다 (AC-1).
   */
  return { kind: 'update', nextTitle: `[${expected}] ${currentTitle}` };
}
