/**
 * C-012 필터 레일의 상태 판정 (WP-016 / CR-019 DEV-076, WP-032 / CR-043 DEV-277).
 *
 * ## 네 경우를 가른다
 *
 * WP-016은 셋이었다 — 응답의 두 키(`facets`, `facets_omitted`)가 함께
 * 나타나거나 함께 빠지므로 조합이 셋뿐이었기 때문이다. WP-032가 `facets_status`를
 * 더하면서 **생략과 실패**가 갈렸다.
 *
 * | 응답 | 뜻 | 사용자가 할 수 있는 일 |
 * | --- | --- | --- |
 * | 세 키 없음 | 세지 않았다 (요청하지 않은 페이지) | 없다 |
 * | `ready` | 세었다 | 분포로 좁힌다 |
 * | `budget_omitted` | 예산을 넘겨 생략했다 | **조건을 좁혀** 다시 |
 * | `failed` | 계산이 실패했다 | **다시 시도** |
 *
 * 넷을 "패싯 없음" 하나로 뭉치면 사용자가 할 수 있는 일을 빼앗는다. 특히 마지막
 * 둘을 같은 문구로 그리면 안 된다 — 예산 초과는 조건을 좁히면 풀리고 계산
 * 실패는 그렇지 않다 (C-012의 "조용히 비우지 않는다").
 */

export interface FacetValue {
  readonly value: string;
  readonly count: number;
}

/** 응답에서 오는 패싯 묶음. 키는 **응답 필드 이름**이다(`repository`, `base_branch`…). */
export type FacetMap = Readonly<Record<string, readonly FacetValue[]>>;

export type FacetRailState =
  | { readonly kind: 'not_computed' }
  | { readonly kind: 'omitted' }
  | { readonly kind: 'failed' }
  | { readonly kind: 'ready'; readonly facets: FacetMap };

/** 응답의 세 키만 본다. 나머지는 알 필요가 없다. */
export interface FacetSource {
  readonly facets?: FacetMap;
  readonly facets_omitted?: boolean;
  readonly facets_status?: string;
}

/**
 * 레일 상태를 정한다.
 *
 * `facets_omitted`가 **있는지**를 먼저 본다 — 그 키의 존재가 "세려고 시도했다"를
 * 뜻한다 (CR-016 DEV-057의 키 존재 규칙). 값이 `true`인지 먼저 보면 키가 없을
 * 때와 `false`일 때가 같은 갈래로 떨어진다.
 *
 * **생략과 실패는 `facets_status`로만 갈린다** — `facets_omitted`는 둘 다
 * `true`다. 그 필드는 "분포를 못 받았다"는 사실이고, **왜** 못 받았는지는
 * 새 필드가 말한다. 상태를 모르면 생략으로 읽는다: 기존 응답(WP-032 전)이
 * 그것을 뜻했고, 실패라고 단정하면 없는 고장을 알리게 된다.
 */
export function facetRailState(source: FacetSource): FacetRailState {
  if (source.facets_omitted === undefined) return { kind: 'not_computed' };
  if (source.facets_omitted) {
    return source.facets_status === 'failed' ? { kind: 'failed' } : { kind: 'omitted' };
  }
  return { kind: 'ready', facets: source.facets ?? {} };
}

/** 레일 상단에 표시할 사유. 비어 있으면 표시하지 않는다는 뜻이다. */
export function facetNotice(state: FacetRailState): string | null {
  switch (state.kind) {
    case 'not_computed':
      return '값 분포는 아직 계산하지 않았습니다. 검색 후 제공되는 필터로 결과를 좁힐 수 있습니다.';
    case 'omitted':
      return '이번 조회에서는 분포 계산을 생략했습니다. 조건을 좁히면 다시 계산합니다.';
    case 'failed':
      return '분포 계산에 실패했습니다. 목록은 정상이며, 다시 시도할 수 있습니다.';
    case 'ready':
      return null;
  }
}

/**
 * 레일의 축 하나.
 *
 * **`key`와 `queryKey`가 다르다.** 응답은 ES 필드 이름으로 오고(`repository`,
 * `base_branch`, `allowed_team_ids`를 센 `team`), 레일이 만드는 것은 질의
 * 토큰이다(`repo:`, `base:`, `team:`). 둘을 같다고 두면 패싯을 눌렀을 때
 * 성립하지 않는 질의가 만들어진다.
 */
export interface FacetField {
  /** 응답 `facets` 객체의 키. */
  readonly key: string;
  /** 이 축이 만드는 질의 키 (FR-SRCH-006 AC-1). */
  readonly queryKey: string;
  readonly label: string;
}

/**
 * W-001의 여섯 축 (FR-SRCH-009 AC-1).
 *
 * `W-001-FACETS`가 한때 여덟(기간·시퀀스 포함)을 적었으나 CR-043이 여섯으로
 * 좁혔다 — 연속 값에 "상위 20개 값과 건수"라는 형태가 맞지 않고, 기간·시퀀스는
 * `merged:`·`seq:` 질의 키로 이미 필터할 수 있다 (DEV-285).
 */
export const SEARCH_FACET_FIELDS: readonly FacetField[] = [
  { key: 'repository', queryKey: 'repo', label: '저장소' },
  { key: 'author', queryKey: 'author', label: '작성자' },
  { key: 'team', queryKey: 'team', label: '팀' },
  { key: 'label', queryKey: 'label', label: '라벨' },
  { key: 'base_branch', queryKey: 'base', label: '대상 브랜치' },
  { key: 'state', queryKey: 'state', label: '상태' },
];

/**
 * W-004의 네 축 (FR-SEQ-002 AC-8).
 *
 * 저장소·대상 브랜치는 시퀀스 공간이 이미 고정하므로 패싯으로 다시 묻지 않고,
 * PR 상태는 W-004의 승인 범위가 아니다.
 */
export const RANGE_FACET_FIELDS: readonly FacetField[] = [
  { key: 'author', queryKey: 'author', label: '작성자' },
  { key: 'team', queryKey: 'team', label: '팀' },
  { key: 'label', queryKey: 'label', label: '라벨' },
  { key: 'path', queryKey: 'path', label: '변경 경로' },
];

/**
 * 예전 이름 — W-001 축의 별칭이다.
 *
 * WP-016이 질의 키를 `key`로 쓰고 있었다(패싯 데이터가 오지 않던 시절이라
 * 응답 키와 맞출 이유가 없었다). 이름을 남겨 두는 것은 이 상수를 참조하는
 * 자리가 하나로 모이게 하기 위해서다.
 */
export const FACET_FIELDS = SEARCH_FACET_FIELDS;
