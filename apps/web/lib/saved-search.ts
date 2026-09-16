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
  /**
   * 시퀀스 인용 상태 (CR-051, AC-8). `seq:` 질의에만 있다.
   *
   * **`unavailable`에는 어떤 에폭 값도 없다** — 볼 수 없는 저장소의
   * 에폭은 저장된 것이든 현재 것이든 응답에 실리지 않는다 (THR-043).
   */
  readonly sequence_reference?: {
    readonly status: 'current' | 'epoch_stale' | 'unbound' | 'unavailable';
    readonly stored_seq_epoch?: number;
    readonly current_seq_epoch?: number;
    readonly sequence_state?: string;
  };
  readonly created_at: string;
  readonly last_run_at: string | null;
}

/**
 * 항목 하나의 시퀀스 인용을 화면이 그릴 모양으로 (CR-051).
 *
 * **판정을 컴포넌트에서 하지 않는다.** 저장된 값과 현재 값을 컴포넌트가
 * 비교하면 같은 규칙이 두 곳에 살고 한쪽만 고쳐진다 — 서버가 이미 판정한
 * 것을 여기서 문구로 옮기기만 한다.
 */
export interface SequenceReferenceDisplay {
  readonly label: string;
  readonly detail: string | null;
  /** 실행을 막아야 하는가. `unbound`만 막는다. */
  readonly blocksRun: boolean;
  /** 저장자에게 「현재 에폭으로 다시 연결」을 보일 것인가. */
  readonly offersRebind: boolean;
}

export function describeSequenceReference(
  item: SavedSearchView,
): SequenceReferenceDisplay | null {
  const reference = item.sequence_reference;
  if (reference === undefined) return null;

  switch (reference.status) {
    case 'current':
      return {
        label: 'Sequence epoch matches',
        detail:
          reference.stored_seq_epoch === undefined
            ? null
            : `Epoch ${String(reference.stored_seq_epoch)}`,
        blocksRun: false,
        offersRebind: false,
      };
    case 'epoch_stale':
      return {
        label: 'The sequence epoch has changed',
        detail:
          reference.stored_seq_epoch === undefined || reference.current_seq_epoch === undefined
            ? null
            : `Saved: ${String(reference.stored_seq_epoch)} · Current: ${String(reference.current_seq_epoch)}`,
        /*
         * **막지 않는다.** 실행하면 저장된 에폭 그대로 W-001로 가고 그
         * 화면이 무효를 알린다 — 여기서 막으면 사용자가 무엇이 달라졌는지
         * 볼 기회를 잃는다.
         */
        blocksRun: false,
        offersRebind: true,
      };
    case 'unbound':
      return {
        label: 'Saved without epoch information',
        detail: 'Cannot run safely. Rebind to the current sequence space',
        blocksRun: true,
        offersRebind: true,
      };
    case 'unavailable':
      return {
        /*
         * 어떤 수치도 적지 않는다 (THR-043). 저장된 에폭까지 응답에 없으므로
         * 여기서 만들 것도 없다.
         */
        label: 'Sequence status is unavailable',
        detail: 'The repository referenced by this search is inaccessible',
        blocksRun: false,
        offersRebind: false,
      };
  }
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
  /** 「현재 에폭으로 다시 연결」을 보일 것인가 (CR-051). 저장자에게만 준다. */
  readonly canRebindEpoch: boolean;
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
  /*
   * 미연결 인용도 실행을 막는다 (CR-051). **낡은 것은 막지 않는다** —
   * 실행하면 저장된 에폭 그대로 W-001로 가고 그 화면이 무효를 알리므로,
   * 여기서 막으면 사용자가 무엇이 달라졌는지 볼 기회를 잃는다.
   */
  const sequence = describeSequenceReference(item);
  const sequenceBlocks = sequence?.blocksRun === true;

  return {
    canRun: !invalid && !sequenceBlocks,
    canEdit: item.is_owner,
    canDelete: item.is_owner,
    // **저장자만** 다시 연결한다 (AC-2). 공유받은 사람은 고칠 권한이 없다.
    canRebindEpoch: item.is_owner && sequence?.offersRebind === true,
    blockedReason: invalid
      ? item.is_owner
        ? 'The query cannot be parsed with the current syntax. Edit it to continue.'
        : 'The query cannot be parsed with the current syntax. Its owner must update it.'
      : sequenceBlocks
        ? item.is_owner
          ? 'This search was saved without a sequence epoch and cannot run safely. Rebind it to the current sequence space.'
          : 'This search was saved without a sequence epoch and cannot run safely. Its owner must rebind it.'
        : null,
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
  if (item.visibility === 'private') return 'Private';
  const team = item.target_team;
  if (team === undefined) return 'Shared with team';
  return `Shared with team · ${team.slug}`;
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
  return duplicated ? `${team.slug} (organization ${String(team.org_id)})` : team.slug;
}

/** 저장 대화상자가 보낼 본문. `visibility`가 `private`이면 대상을 담지 않는다. */
export function createPayload(input: {
  readonly name: string;
  readonly query: string;
  readonly visibility: SavedSearchVisibility;
  readonly teamId: number | null;
  /**
   * 지금 보고 있는 조회의 시퀀스 에폭 (CR-051, AC-8).
   *
   * **서버가 현재 값을 대신 채우지 않는 이유가 이 필드다.** 화면이 에폭 3의
   * 결과를 보는 사이에 재채번이 일어나면 서버가 4를 넣게 되고, 그러면
   * 사용자가 본 것과 저장된 것이 달라진다. 자기가 보던 값을 보내고 서버가
   * 대조한다.
   *
   * `seq:` 질의가 아니면 `null`이며 키를 싣지 않는다.
   */
  readonly seqEpoch?: number | null;
}): Record<string, unknown> {
  return {
    name: input.name.trim(),
    query: input.query,
    visibility: input.visibility,
    ...(input.visibility === 'team' && input.teamId !== null ? { team_id: input.teamId } : {}),
    ...(input.seqEpoch === undefined || input.seqEpoch === null ? {} : { seq_epoch: input.seqEpoch }),
  };
}

/** 저장 실패를 사람이 읽을 문장으로. 서버 코드를 화면이 재해석하지 않는다. */
export function saveFailureMessage(code: string | undefined): string {
  switch (code) {
    case 'SAVED_SEARCH_LIMIT':
      return 'You have reached the limit of 100 saved searches. Delete an existing saved search and try again.';
    case 'SAVED_SEARCH_NAME_CONFLICT':
      return 'A saved search with this name already exists. Use a different name.';
    case 'QUERY_SYNTAX_ERROR':
      return 'The query cannot be parsed with the current syntax. Update it before saving.';
    case 'INVALID_PARAMETER':
      return 'Check your input. You can share only with teams you belong to. A seq: filter requires exactly one repo: and one base: filter.';
    case 'SAVED_SEARCH_QUERY_INVALID':
      // 저장하는 사이에 재채번이 일어났다 (CR-051). 현재 값으로 바꿔 저장하지 않는다.
      return 'The sequence epoch changed during the lookup. Review the current results before saving.';
    default:
      return 'Could not save. Try again later.';
  }
}
