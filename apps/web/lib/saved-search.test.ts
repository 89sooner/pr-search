/**
 * 저장된 검색의 화면 판정 (W-008 / WP-033, CR-049).
 *
 * 무엇이 보이는가는 권한 판정이므로 DOM 없이 건다 — `nav.test.ts`가 같은
 * 이유로 순수 모듈을 시험한다.
 */

import { describe, expect, it } from 'vitest';
import {
  createPayload,
  resolveSavedSearchState,
  rowActions,
  saveFailureMessage,
  shareTargetLabel,
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
    expect(actions.blockedReason).toContain('편집');
    expect(actions.canEdit).toBe(true);
  });

  it('무효할 때 **공유받은 사람에게는 소유자가 고쳐야 한다고** 안내한다', () => {
    const actions = rowActions(item({ query_status: 'invalid', is_owner: false }));
    expect(actions.blockedReason).toContain('소유자');
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
    expect(visibilityLabel(item())).toBe('비공개');
  });

  it('**팀 공유는 대상 팀 이름을 함께 보인다**', () => {
    expect(
      visibilityLabel(
        item({ visibility: 'team', target_team: { team_id: 7, org_id: 1, slug: 'payments' } }),
      ),
    ).toBe('팀 공유 · payments');
  });

  it('대상이 빠져 있어도 무너지지 않는다', () => {
    expect(visibilityLabel(item({ visibility: 'team' }))).toBe('팀 공유');
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
    expect(shareTargetLabel(payments, [payments, twin, platform])).toBe('payments (조직 10)');
    expect(shareTargetLabel(twin, [payments, twin, platform])).toBe('payments (조직 20)');
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

describe('저장 실패 안내', () => {
  it('**상한 초과는 무엇을 해야 하는지 말한다**', () => {
    expect(saveFailureMessage('SAVED_SEARCH_LIMIT')).toContain('삭제');
  });

  it('이름 충돌은 이름을 바꾸라고 말한다', () => {
    expect(saveFailureMessage('SAVED_SEARCH_NAME_CONFLICT')).toContain('다른 이름');
  });

  it('문법 오류는 질의를 고치라고 말한다', () => {
    expect(saveFailureMessage('QUERY_SYNTAX_ERROR')).toContain('질의');
  });

  it('모르는 코드에도 답이 있다 — 빈 화면을 남기지 않는다', () => {
    expect(saveFailureMessage(undefined)).not.toBe('');
    expect(saveFailureMessage('SOMETHING_NEW')).not.toBe('');
  });
});
