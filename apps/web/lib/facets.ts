/**
 * C-012 필터 레일의 상태 판정 (WP-016 / CR-019 DEV-076).
 *
 * **세 경우를 가른다.** 응답의 두 키(`facets`, `facets_omitted`)가 함께
 * 나타나거나 함께 빠지므로 조합은 셋뿐이고, 셋이 서로 다른 뜻이다:
 *
 * | 응답 | 뜻 | 사용자가 할 수 있는 일 |
 * | --- | --- | --- |
 * | 두 키 없음 | 아직 세지 않는다 (WP-032 전) | 없다. 기다린다 |
 * | `facets_omitted: false` | 세었다 | 분포로 좁힌다 |
 * | `facets_omitted: true` | 예산을 넘겨 생략했다 | 조건을 좁혀 다시 |
 *
 * 셋을 "패싯 없음" 하나로 뭉치면 **마지막 경우에 사용자가 할 수 있는 일을
 * 빼앗는다.** C-012의 "조용히 비우지 않는다"가 이것을 막는다.
 */

export interface FacetValue {
  readonly value: string;
  readonly count: number;
}

/** 응답에서 오는 패싯 묶음. 키는 필드 이름이다. */
export type FacetMap = Readonly<Record<string, readonly FacetValue[]>>;

export type FacetRailState =
  | { readonly kind: 'not_computed' }
  | { readonly kind: 'omitted' }
  | { readonly kind: 'ready'; readonly facets: FacetMap };

/** 응답의 두 키만 본다. 나머지는 알 필요가 없다. */
export interface FacetSource {
  readonly facets?: FacetMap;
  readonly facets_omitted?: boolean;
}

/**
 * 레일 상태를 정한다.
 *
 * `facets_omitted`가 **있는지**를 먼저 본다 — 그 키의 존재가 "세려고
 * 시도했다"를 뜻한다 (CR-016 DEV-057의 키 존재 규칙). 값이 `true`인지
 * 먼저 보면 키가 없을 때와 `false`일 때가 같은 갈래로 떨어진다.
 */
export function facetRailState(source: FacetSource): FacetRailState {
  if (source.facets_omitted === undefined) return { kind: 'not_computed' };
  if (source.facets_omitted) return { kind: 'omitted' };
  return { kind: 'ready', facets: source.facets ?? {} };
}

/** 레일 상단에 표시할 사유. 비어 있으면 표시하지 않는다는 뜻이다. */
export function facetNotice(state: FacetRailState): string | null {
  switch (state.kind) {
    case 'not_computed':
      return '값 분포는 아직 계산하지 않습니다. 아래에서 조건을 직접 고를 수 있습니다.';
    case 'omitted':
      return '이번 조회에서는 분포 계산을 생략했습니다. 조건을 좁히면 다시 계산합니다.';
    case 'ready':
      return null;
  }
}

/**
 * 레일이 다루는 필드와 그것이 만드는 질의 키 (FR-SRCH-006 AC-1).
 *
 * **질의 키로 정의한다.** 레일 조작이 질의 문자열을 갱신하고 그 변경이
 * 조회를 유발하므로(와이어프레임 구현 메모), 레일은 자기 상태를 따로 갖지
 * 않는다 — URL이 단일 진실이다.
 */
export const FACET_FIELDS: readonly { readonly key: string; readonly label: string }[] = [
  { key: 'repo', label: '저장소' },
  { key: 'author', label: '작성자' },
  { key: 'team', label: '팀' },
  { key: 'label', label: '라벨' },
  { key: 'base', label: '대상 브랜치' },
  { key: 'state', label: '상태' },
];
