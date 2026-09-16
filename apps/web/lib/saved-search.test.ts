/**
 * 저장된 검색의 화면 판정 (W-008 / WP-033, CR-049).
 *
 * 무엇이 보이는가는 권한 판정이므로 DOM 없이 건다 — `nav.test.ts`가 같은
 * 이유로 순수 모듈을 시험한다.
 */

import { describe, expect, it } from 'vitest';
import {
  createPayload,
  describeSequenceReference,
  resolveSavedSearchState,
  rowActions,
  saveFailureMessage,
  shareTargetLabel,
  splitInvalidSpan,
  visibilityLabel,
  type SavedSearchView,
} from './saved-search';

function item(overrides: Partial<SavedSearchView> = {}): SavedSearchView {
  return {
    saved_search_id: 1,
    name: '결제 리뷰',
    query: 'repo:acme/payments',
    visibility: 'private',
    owner: { user_id: 'sub-alice', login: 'alice' },
    is_owner: true,
    query_status: 'valid',
    created_at: '2026-08-27T09:00:00.000000Z',
    last_run_at: null,
    ...overrides,
  };
}

describe('행 액션 (AC-2, AC-6)', () => {
  it('내 것이면 실행·편집·삭제가 전부 열린다', () => {
    expect(rowActions(item())).toEqual({
      canRun: true,
      canEdit: true,
      canDelete: true,
      // `seq:`가 없는 질의라 인용이 없다 (CR-051).
      canRebindEpoch: false,
      blockedReason: null,
    });
  });

  it('**공유받은 것은 실행만 열린다** — 공유는 소유권 이전이 아니다', () => {
    const actions = rowActions(item({ is_owner: false }));
    expect(actions.canRun).toBe(true);
    expect(actions.canEdit).toBe(false);
    expect(actions.canDelete).toBe(false);
  });

  it('**무효한 질의는 실행이 막힌다**', () => {
    expect(rowActions(item({ query_status: 'invalid' })).canRun).toBe(false);
  });

  it('무효할 때 **저장자에게는 편집 경로를** 안내한다', () => {
    const actions = rowActions(item({ query_status: 'invalid', is_owner: true }));
    expect(actions.blockedReason).toContain("Edit");
    expect(actions.canEdit).toBe(true);
  });

  it('무효할 때 **공유받은 사람에게는 소유자가 고쳐야 한다고** 안내한다', () => {
    const actions = rowActions(item({ query_status: 'invalid', is_owner: false }));
    expect(actions.blockedReason).toContain("owner");
    expect(actions.canEdit).toBe(false);
  });

  it('무효해도 소유자의 삭제는 막지 않는다 — 치울 수 있어야 한다', () => {
    expect(rowActions(item({ query_status: 'invalid', is_owner: true })).canDelete).toBe(true);
  });
});

describe('목록 상태 (상태 매트릭스 W-008)', () => {
  const base = {
    view: 'mine' as const,
    loading: false,
    resumed: false,
    items: [] as readonly SavedSearchView[],
    cursorFailed: false,
    loadFailed: false,
  };

  it('첫 조회는 `loading_initial`이다', () => {
    expect(resolveSavedSearchState({ ...base, loading: true, items: null })).toBe('loading_initial');
  });

  it('이어 보기는 `loading_more`다 — 기존 목록을 유지한다', () => {
    expect(
      resolveSavedSearchState({ ...base, loading: true, resumed: true, items: [item()] }),
    ).toBe('loading_more');
  });

  it('결과가 있으면 `ready`다', () => {
    expect(resolveSavedSearchState({ ...base, items: [item()] })).toBe('ready');
  });

  it('**빈 목록을 목록마다 다르게 말한다**', () => {
    expect(resolveSavedSearchState({ ...base, view: 'mine' })).toBe('empty_no_saved');
    expect(resolveSavedSearchState({ ...base, view: 'team' })).toBe('empty_no_shared');
  });

  it('**커서 실패가 로딩보다 먼저다** — 왜 멈췄는지 말해야 한다', () => {
    expect(
      resolveSavedSearchState({ ...base, loading: true, cursorFailed: true, items: [item()] }),
    ).toBe('error_cursor');
  });

  it('커서 실패 상태에서도 목록이 남아 있다는 것을 `ready`로 덮지 않는다', () => {
    expect(resolveSavedSearchState({ ...base, cursorFailed: true, items: [item()] })).toBe(
      'error_cursor',
    );
  });

  it('조회 실패는 `error_load`다', () => {
    expect(resolveSavedSearchState({ ...base, loadFailed: true })).toBe('error_load');
  });
});

describe('공개 범위 레이블 (NFR-006)', () => {
  it('비공개는 문자로 말한다', () => {
    expect(visibilityLabel(item())).toBe("Private");
  });

  it('**팀 공유는 대상 팀 이름을 함께 보인다**', () => {
    expect(
      visibilityLabel(
        item({ visibility: 'team', target_team: { team_id: 7, org_id: 1, slug: 'payments' } }),
      ),
    ).toBe("Shared with team · payments");
  });

  it('대상이 빠져 있어도 무너지지 않는다', () => {
    expect(visibilityLabel(item({ visibility: 'team' }))).toBe("Shared with team");
  });
});

describe('공유 대상 레이블 (DEV-331 계열)', () => {
  const payments = { team_id: 1, org_id: 10, slug: 'payments' };
  const twin = { team_id: 2, org_id: 20, slug: 'payments' };
  const platform = { team_id: 3, org_id: 10, slug: 'platform' };

  it('이름이 유일하면 이름만 보인다', () => {
    expect(shareTargetLabel(platform, [payments, platform])).toBe('platform');
  });

  it('**같은 이름이 여럿이면 조직을 덧붙인다** — 어느 팀에 공유하는지 알아야 한다', () => {
    expect(shareTargetLabel(payments, [payments, twin, platform])).toBe("payments (organization 10)");
    expect(shareTargetLabel(twin, [payments, twin, platform])).toBe("payments (organization 20)");
  });
});

describe('저장 본문', () => {
  it('이름의 앞뒤 공백을 다듬는다', () => {
    expect(createPayload({ name: '  결제  ', query: 'repo:a/b', visibility: 'private', teamId: null }))
      .toEqual({ name: '결제', query: 'repo:a/b', visibility: 'private' });
  });

  it('**private에는 대상 팀을 담지 않는다** — 스키마 불변식이 거절한다', () => {
    const payload = createPayload({
      name: 'n',
      query: 'repo:a/b',
      visibility: 'private',
      teamId: 7,
    });
    expect(payload['team_id']).toBeUndefined();
  });

  it('team이면 대상 팀을 담는다', () => {
    expect(
      createPayload({ name: 'n', query: 'repo:a/b', visibility: 'team', teamId: 7 })['team_id'],
    ).toBe(7);
  });

  it('team인데 대상이 없으면 담지 않는다 — 서버가 400으로 말하게 둔다', () => {
    expect(
      createPayload({ name: 'n', query: 'repo:a/b', visibility: 'team', teamId: null })['team_id'],
    ).toBeUndefined();
  });
});

describe('무효 구간 (AC-6)', () => {
  const QUERY = 'repo:acme/a nosuchkey:value author:kim';

  it('**파서가 준 오프셋으로 셋으로 가른다**', () => {
    const spans = splitInvalidSpan(QUERY, { offset_start: 12, offset_end: 21 });
    expect(spans).toEqual({
      before: 'repo:acme/a ',
      invalid: 'nosuchkey',
      after: ':value author:kim',
    });
  });

  it('가른 조각을 다시 이으면 원문이다 — 글자를 잃지 않는다', () => {
    const spans = splitInvalidSpan(QUERY, { offset_start: 12, offset_end: 21 });
    expect(`${spans?.before ?? ''}${spans?.invalid ?? ''}${spans?.after ?? ''}`).toBe(QUERY);
  });

  it('오프셋이 없으면 가르지 않는다', () => {
    expect(splitInvalidSpan(QUERY, undefined)).toBeNull();
    expect(splitInvalidSpan(QUERY, {})).toBeNull();
  });

  it('**범위를 벗어난 오프셋은 가르지 않는다** — 엉뚱한 자리를 짚느니 짚지 않는다', () => {
    expect(splitInvalidSpan(QUERY, { offset_start: -1, offset_end: 5 })).toBeNull();
    expect(splitInvalidSpan(QUERY, { offset_start: 0, offset_end: 9999 })).toBeNull();
    expect(splitInvalidSpan(QUERY, { offset_start: 10, offset_end: 10 })).toBeNull();
    expect(splitInvalidSpan(QUERY, { offset_start: 12, offset_end: 5 })).toBeNull();
  });

  it('정수가 아닌 오프셋도 가르지 않는다', () => {
    expect(splitInvalidSpan(QUERY, { offset_start: 1.5, offset_end: 5 })).toBeNull();
  });

  it('질의 맨 앞·맨 뒤 구간도 다룬다', () => {
    expect(splitInvalidSpan('abc def', { offset_start: 0, offset_end: 3 })).toEqual({
      before: '',
      invalid: 'abc',
      after: ' def',
    });
    expect(splitInvalidSpan('abc def', { offset_start: 4, offset_end: 7 })).toEqual({
      before: 'abc ',
      invalid: 'def',
      after: '',
    });
  });
});

describe('저장 실패 안내', () => {
  it('**상한 초과는 무엇을 해야 하는지 말한다**', () => {
    expect(saveFailureMessage('SAVED_SEARCH_LIMIT')).toContain("Delete");
  });

  it('이름 충돌은 이름을 바꾸라고 말한다', () => {
    expect(saveFailureMessage('SAVED_SEARCH_NAME_CONFLICT')).toContain("different name");
  });

  it('문법 오류는 질의를 고치라고 말한다', () => {
    expect(saveFailureMessage('QUERY_SYNTAX_ERROR')).toContain("query");
  });

  it('모르는 코드에도 답이 있다 — 빈 화면을 남기지 않는다', () => {
    expect(saveFailureMessage(undefined)).not.toBe('');
    expect(saveFailureMessage('SOMETHING_NEW')).not.toBe('');
  });
});

describe('시퀀스 인용 표시 (CR-051 / AC-8)', () => {
  const bound = (reference: SavedSearchView['sequence_reference']): SavedSearchView => ({
    saved_search_id: 1,
    name: '구간 검색',
    query: 'repo:acme/payments base:main seq:1..5',
    visibility: 'private',
    owner: { user_id: 'sub-a', login: 'alice' },
    is_owner: true,
    query_status: 'valid',
    created_at: '2026-08-28T00:00:00Z',
    last_run_at: null,
    ...(reference === undefined ? {} : { sequence_reference: reference }),
  });

  it('`seq:`가 없으면 표시하지 않는다', () => {
    expect(describeSequenceReference(bound(undefined))).toBeNull();
  });

  it('`current`는 실행을 막지 않고 재연결도 제안하지 않는다', () => {
    const view = describeSequenceReference(
      bound({ status: 'current', stored_seq_epoch: 3, current_seq_epoch: 3 }),
    );
    expect(view?.blocksRun).toBe(false);
    expect(view?.offersRebind).toBe(false);
  });

  it('**`epoch_stale`은 실행을 막지 않는다** — W-001이 무효를 보여 줘야 한다', () => {
    /*
     * 여기서 막으면 사용자가 무엇이 달라졌는지 볼 기회를 잃는다. 실행하면
     * 저장된 에폭 그대로 W-001로 가고 그 화면이 두 값을 나란히 보인다.
     */
    const view = describeSequenceReference(
      bound({ status: 'epoch_stale', stored_seq_epoch: 3, current_seq_epoch: 4 }),
    );
    expect(view?.blocksRun).toBe(false);
    expect(view?.offersRebind).toBe(true);
    expect(view?.detail).toContain('3');
    expect(view?.detail).toContain('4');
  });

  it('`unbound`는 실행을 막는다', () => {
    const view = describeSequenceReference(bound({ status: 'unbound', current_seq_epoch: 4 }));
    expect(view?.blocksRun).toBe(true);
    expect(view?.offersRebind).toBe(true);
  });

  it('**`unavailable`은 아무 수치도 적지 않는다** (THR-043)', () => {
    const view = describeSequenceReference(bound({ status: 'unavailable' }));
    expect(view?.blocksRun).toBe(false);
    expect(view?.offersRebind).toBe(false);
    // 숫자가 하나라도 들어가면 그것이 유출이다.
    expect(`${view?.label ?? ''} ${view?.detail ?? ''}`).not.toMatch(/\d/);
  });

  it('**색만으로 말하지 않는다** — 네 상태 모두 문자 레이블을 갖는다 (NFR-006)', () => {
    for (const status of ['current', 'epoch_stale', 'unbound', 'unavailable'] as const) {
      const view = describeSequenceReference(bound({ status }));
      expect(view?.label.trim()).not.toBe('');
    }
  });
});

describe('rowActions와 시퀀스 인용 (CR-051)', () => {
  const item = (
    over: Partial<SavedSearchView> & { sequence_reference?: SavedSearchView['sequence_reference'] },
  ): SavedSearchView => ({
    saved_search_id: 1,
    name: 'n',
    query: 'repo:a/b base:main seq:1..5',
    visibility: 'private',
    owner: { user_id: 'sub-a', login: 'alice' },
    is_owner: true,
    query_status: 'valid',
    created_at: '2026-08-28T00:00:00Z',
    last_run_at: null,
    ...over,
  });

  it('`unbound`면 실행이 막히고 사유를 준다', () => {
    const actions = rowActions(item({ sequence_reference: { status: 'unbound' } }));
    expect(actions.canRun).toBe(false);
    expect(actions.blockedReason).toContain("Rebind");
  });

  it('**공유받은 사람에게는 재연결을 그리지 않는다** — 저장자만 고친다 (AC-2)', () => {
    const actions = rowActions(
      item({ is_owner: false, sequence_reference: { status: 'epoch_stale', stored_seq_epoch: 1 } }),
    );
    expect(actions.canRebindEpoch).toBe(false);
    expect(actions.canEdit).toBe(false);
  });

  it('공유받은 사람의 `unbound` 사유는 저장자를 가리킨다', () => {
    const actions = rowActions(item({ is_owner: false, sequence_reference: { status: 'unbound' } }));
    expect(actions.canRun).toBe(false);
    expect(actions.blockedReason).toContain("owner");
  });

  it('낡았어도 실행은 열려 있다', () => {
    const actions = rowActions(
      item({ sequence_reference: { status: 'epoch_stale', stored_seq_epoch: 1, current_seq_epoch: 2 } }),
    );
    expect(actions.canRun).toBe(true);
    expect(actions.canRebindEpoch).toBe(true);
  });
});
