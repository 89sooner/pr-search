/**
 * 저장된 검색의 화면 판정 (W-001·W-008 / WP-033, CR-049).
 *
 * **순수 모듈이다.** 무엇을 그릴지·어떤 액션을 보일지는 권한과 상태의 판정이고,
 * 그것을 렌더링 코드와 섞으면 시험이 DOM을 거쳐야만 확인할 수 있게 된다.
 * `lib/nav.ts`가 같은 이유로 갈라져 있다.
 *
 * ## 화면이 그리지 않는 것이 통제가 아니다
 *
 * 여기서 정하는 것은 **보이는 것**이지 허용되는 것이 아니다. 서버가 같은 규칙을
 * 다시 강제하며(`saved-search/routes.ts`), 이 파일은 그 사실을 화면에 옮긴다.
 */

export type SavedSearchVisibility = 'private' | 'team';

export interface ShareTargetTeam {
  readonly team_id: number;
  readonly org_id: number;
  readonly slug: string;
}

export interface SavedSearchView {
  readonly saved_search_id: number;
  readonly name: string;
  readonly query: string;
  readonly visibility: SavedSearchVisibility;
  readonly target_team?: ShareTargetTeam;
  readonly owner: { readonly user_id: string; readonly login: string };
  readonly is_owner: boolean;
  readonly query_status: 'valid' | 'invalid';
  readonly query_error?: {
    readonly message: string;
    readonly detail?: { readonly offset_start?: number; readonly offset_end?: number };
  };
  readonly created_at: string;
  readonly last_run_at: string | null;
}

/** 두 논리 목록. 같은 항목이 양쪽에 나타나지 않는다. */
export type SavedSearchListView = 'mine' | 'team';

/** 목록 상태 (상태 매트릭스 W-008). */
export type SavedSearchScreenState =
  | 'loading_initial'
  | 'loading_more'
  | 'ready'
  | 'empty_no_saved'
  | 'empty_no_shared'
  | 'error_cursor'
  | 'error_load';

export interface ScreenStateInput {
  readonly view: SavedSearchListView;
  readonly loading: boolean;
  readonly resumed: boolean;
  readonly items: readonly SavedSearchView[] | null;
  readonly cursorFailed: boolean;
  readonly loadFailed: boolean;
}

/**
 * 목록 하나의 상태를 정한다.
 *
 * **비어 있음을 목록마다 다르게 말한다.** "내 검색이 0건"과 "공유받은 것이
 * 0건"은 사용자가 할 일이 다르다 — 앞은 W-001에서 저장하면 되고 뒤는 기다리는
 * 것 말고 할 일이 없다. 하나의 `empty`로 묶으면 그 차이가 사라진다.
 */
export function resolveSavedSearchState(input: ScreenStateInput): SavedSearchScreenState {
  /*
   * 커서 실패를 먼저 본다.
   *
   * 그 상태에서도 지금까지 본 목록은 남아 있어야 하므로 `items`가 비어 있지
   * 않다. `ready`로 판정하면 사용자는 이어 보기가 왜 멈췄는지 모른다.
   */
  if (input.cursorFailed) return 'error_cursor';
  if (input.loadFailed) return 'error_load';
  if (input.loading) return input.resumed ? 'loading_more' : 'loading_initial';
  if (input.items === null) return 'loading_initial';
  if (input.items.length > 0) return 'ready';
  return input.view === 'mine' ? 'empty_no_saved' : 'empty_no_shared';
}

/** 행에 그릴 액션. 소유 여부와 질의 유효성이 함께 정한다. */
export interface RowActions {
  readonly canRun: boolean;
  readonly canEdit: boolean;
  readonly canDelete: boolean;
  /** 실행이 막힌 이유. 없으면 `null`. */
  readonly blockedReason: string | null;
}

/**
 * 행의 액션을 정한다 (AC-2, AC-6).
 *
 * **편집 경로는 저장자에게만 준다.** 공유받은 사람에게 "편집" 버튼을 보이고
 * 누르면 404를 주는 것은 그 사람에게 자기 잘못처럼 보인다 — 애초에 그의 것이
 * 아니다.
 */
export function rowActions(item: SavedSearchView): RowActions {
  const invalid = item.query_status === 'invalid';
  return {
    canRun: !invalid,
    canEdit: item.is_owner,
    canDelete: item.is_owner,
    blockedReason: !invalid
      ? null
      : item.is_owner
        ? '질의를 현재 문법으로 해석할 수 없습니다. 편집해서 고치세요.'
        : '질의를 현재 문법으로 해석할 수 없습니다. 소유자가 질의를 수정해야 합니다.',
  };
}

/** 질의를 무효 구간 기준으로 셋으로 가른다. */
export interface QuerySpans {
  readonly before: string;
  readonly invalid: string;
  readonly after: string;
}

/**
 * 파서가 준 오프셋으로 무효 구간을 짚는다 (AC-6).
 *
 * **"해석할 수 없다"만으로는 부족하다.** 예외 처리 문장이 요구하는 것은
 * *오류 위치*이며, 긴 질의에서 어느 토큰이 문제인지 모르면 사용자가 고칠
 * 자리를 찾지 못한다.
 *
 * 오프셋이 없거나 범위를 벗어나면 **가르지 않고 전체를 그대로 돌려준다** —
 * 잘못된 오프셋으로 엉뚱한 자리를 짚느니 짚지 않는 편이 낫다.
 */
export function splitInvalidSpan(
  query: string,
  detail: { readonly offset_start?: number; readonly offset_end?: number } | undefined,
): QuerySpans | null {
  const start = detail?.offset_start;
  const end = detail?.offset_end;
  if (typeof start !== 'number' || typeof end !== 'number') return null;
  if (!Number.isInteger(start) || !Number.isInteger(end)) return null;
  if (start < 0 || end > query.length || start >= end) return null;

  return {
    before: query.slice(0, start),
    invalid: query.slice(start, end),
    after: query.slice(end),
  };
}

/** 공개 범위 레이블. **색만으로 구분하지 않는다** (NFR-006). */
export function visibilityLabel(item: SavedSearchView): string {
  if (item.visibility === 'private') return '비공개';
  const team = item.target_team;
  if (team === undefined) return '팀 공유';
  return `팀 공유 · ${team.slug}`;
}

/**
 * 같은 이름의 팀이 여럿일 때 사람이 고를 수 있게 조직을 덧붙인다.
 *
 * `slug`은 `(org_id, slug)`에서만 유일하다. 이름만 보이면 사용자가 어느 팀에
 * 공유하는지 알 수 없고, 그 선택은 되돌리기 어렵다.
 */
export function shareTargetLabel(
  team: ShareTargetTeam,
  all: readonly ShareTargetTeam[],
): string {
  const duplicated = all.filter((one) => one.slug === team.slug).length > 1;
  return duplicated ? `${team.slug} (조직 ${String(team.org_id)})` : team.slug;
}

/** 저장 대화상자가 보낼 본문. `visibility`가 `private`이면 대상을 담지 않는다. */
export function createPayload(input: {
  readonly name: string;
  readonly query: string;
  readonly visibility: SavedSearchVisibility;
  readonly teamId: number | null;
}): Record<string, unknown> {
  return {
    name: input.name.trim(),
    query: input.query,
    visibility: input.visibility,
    ...(input.visibility === 'team' && input.teamId !== null ? { team_id: input.teamId } : {}),
  };
}

/** 저장 실패를 사람이 읽을 문장으로. 서버 코드를 화면이 재해석하지 않는다. */
export function saveFailureMessage(code: string | undefined): string {
  switch (code) {
    case 'SAVED_SEARCH_LIMIT':
      return '저장할 수 있는 검색이 100건을 넘었습니다. 저장된 검색에서 기존 항목을 삭제한 뒤 다시 시도하세요.';
    case 'SAVED_SEARCH_NAME_CONFLICT':
      return '같은 이름의 저장된 검색이 이미 있습니다. 다른 이름을 쓰세요.';
    case 'QUERY_SYNTAX_ERROR':
      return '질의를 현재 문법으로 해석할 수 없습니다. 질의를 고친 뒤 저장하세요.';
    case 'INVALID_PARAMETER':
      return '입력을 확인하세요. 공유 대상 팀은 현재 구성원인 팀만 고를 수 있습니다.';
    default:
      return '저장하지 못했습니다. 잠시 후 다시 시도하세요.';
  }
}
