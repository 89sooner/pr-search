/**
 * 태그 판정의 순수 부분 (WP-100 / FR-SEQ-012 AC-1·AC-3, ADR-026).
 *
 * HTTP도 DB도 모른다. 「무엇을 만들어야 하는가」와 「원격에 있는 것을 보고 무엇을 할
 * 것인가」만 정한다 — 실행 순서(재확인 → 조회 → 판정 → 쓰기)는 워커가 갖는다.
 */

import { formatMergeNumber, repositoryCodeOf } from '@prs/domain';

/** 태그 이름은 M 번호 표기 문자열 **그 자체**다 (FR-SEQ-012 AC-1). 별도 형식을 만들지 않는다. */
export type TagTarget =
  | { readonly kind: 'target'; readonly name: string; readonly sha: string }
  /** 저장소 이름에서 코드를 정할 수 없다 (OD-009). GHE를 부르지 않는다. */
  | { readonly kind: 'code_unavailable'; readonly reason: 'no_digits' | 'multiple_digit_runs' };

/**
 * 정본 행 하나가 굳혀야 할 태그.
 *
 * @param commitSha 정본 행의 머지 커밋 SHA. 소문자로 정규화한다 — git과 GHE는 소문자 hex를
 *   돌려주고, 대조도 소문자끼리 한다.
 */
export function resolveTagTarget(repositoryName: string, mergeNumber: number, commitSha: string): TagTarget {
  const code = repositoryCodeOf(repositoryName);
  if (code.kind !== 'code') return { kind: 'code_unavailable', reason: code.reason };
  return { kind: 'target', name: formatMergeNumber(code.code, mergeNumber), sha: commitSha.toLowerCase() };
}

/** 원격 ref 조회 결과. `objectType`은 GHE가 준 `object.type`이다 — lightweight면 `commit`, annotated면 `tag`. */
export type RefLookup =
  | { readonly kind: 'missing' }
  | { readonly kind: 'found'; readonly sha: string; readonly objectType: string };

export type TagDecision =
  /** 원격에 없다. 만든다. */
  | { readonly kind: 'create' }
  /** 원격에 같은 SHA의 lightweight 태그가 이미 있다. 쓰지 않는다 (AC-3 멱등). */
  | { readonly kind: 'already_done' }
  /**
   * 같은 이름의 태그가 **다른 것**을 가리킨다 — 다른 커밋이거나 annotated 태그다.
   * **절대 옮기지 않는다** (AC-3). 사람이 판단한다.
   */
  | { readonly kind: 'conflict'; readonly foundSha: string; readonly objectType: string };

/**
 * 원격 상태를 보고 할 일을 정한다.
 *
 * annotated 태그(`object.type === 'tag'`)는 `object.sha`가 태그 객체의 SHA라 커밋과 같을 수
 * 없으므로 언제나 `conflict`다 — 우리가 만든 것이 아니고(우리는 lightweight만 만든다),
 * 그 위에 덮어쓰면 남의 서명·메시지를 지운다.
 */
export function decideTagAction(expectedSha: string, lookup: RefLookup): TagDecision {
  if (lookup.kind === 'missing') return { kind: 'create' };
  const same = lookup.objectType === 'commit' && lookup.sha.toLowerCase() === expectedSha.toLowerCase();
  if (same) return { kind: 'already_done' };
  return { kind: 'conflict', foundSha: lookup.sha.toLowerCase(), objectType: lookup.objectType };
}

/**
 * 원격 태그 이름이 이 저장소의 M 번호 태그인가. 대조(reconcile)가 `M-<코드>-` 접두 목록에서
 * 다른 코드·다른 형식을 걸러 낼 때 쓴다.
 */
export function mergeNumberOfTagName(code: string, name: string): number | null {
  const prefix = `M-${code}-`;
  if (!name.startsWith(prefix)) return null;
  const digits = name.slice(prefix.length);
  if (!/^[1-9][0-9]*$/.test(digits) || digits.length > 16) return null;
  const value = Number(digits);
  return Number.isSafeInteger(value) ? value : null;
}
