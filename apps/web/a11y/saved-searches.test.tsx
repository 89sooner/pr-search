/**
 * W-008 저장된 검색 · W-001 저장 대화상자 (WP-033 DoD / QA-W008-*).
 *
 * 판정은 `lib/saved-search.test.ts`가 26건으로 이미 걸었다. 여기서 거는 것은
 * **그 판정이 실제로 그려지는가**와 접근성이다.
 *
 * 특히 QA-W008-06(공유받은 항목에 편집·삭제가 없다)은 화면에서만 확인할 수
 * 있다 — 판정 함수가 `canEdit: false`를 돌려줘도 컴포넌트가 그것을 무시하면
 * 버튼이 그려진다.
 */

import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import type { SavedSearchView } from '../lib/saved-search';
import { afterEach, describe, expect, it, vi } from 'vitest';

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
  usePathname: () => '/saved-searches',
  useSearchParams: () => new URLSearchParams(''),
}));

const { SavedSearchList } = await import('../components/SavedSearchList');
const { SavedSearchesView } = await import('../components/SavedSearchesView');
const { SaveSearchDialog } = await import('../components/SaveSearchDialog');

async function violations(container: HTMLElement): Promise<axe.Result[]> {
  const results = await axe.run(container, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
    rules: { 'color-contrast': { enabled: false } },
  });
  return results.violations;
}

function describeViolations(list: axe.Result[]): string {
  return list.map((v) => `${v.id}: ${v.help} (${String(v.nodes.length)}곳)`).join('\n');
}

const MINE = {
  saved_search_id: 1,
  name: '결제 월간 리뷰',
  query: 'repo:acme/payments',
  visibility: 'private' as const,
  owner: { user_id: 'sub-alice', login: 'alice' },
  is_owner: true,
  query_status: 'valid' as const,
  created_at: '2026-08-27T09:00:00.000000Z',
  last_run_at: '2026-08-27T10:00:00.000000Z',
};

const SHARED = {
  ...MINE,
  saved_search_id: 2,
  name: '팀이 공유한 검색',
  visibility: 'team' as const,
  target_team: { team_id: 7, org_id: 1, slug: 'payments' },
  owner: { user_id: 'sub-bob', login: 'bob' },
  is_owner: false,
  last_run_at: null,
};

const INVALID_SHARED = {
  ...SHARED,
  saved_search_id: 3,
  name: '옛 문법 검색',
  query: 'repo:acme/a nosuchkey:value',
  query_status: 'invalid' as const,
  query_error: { message: '지원하지 않는 검색 키입니다', detail: { offset_start: 12, offset_end: 21 } },
};

const INVALID_MINE = {
  ...INVALID_SHARED,
  saved_search_id: 4,
  owner: { user_id: 'sub-alice', login: 'alice' },
  is_owner: true,
};

/** 요청 URL에서 응답을 만든다 — 고정 응답 대역은 틀린 입력을 받아 준다 (risks 44). */
function stubFetch(pages: Record<string, unknown>): string[] {
  const calls: string[] = [];
  vi.stubGlobal('fetch', (url: string, init?: { method?: string }) => {
    calls.push(`${init?.method ?? 'GET'} ${url}`);
    const key = Object.keys(pages).find((one) => url.includes(one));
    const body = key === undefined ? { items: [], next_cursor: null } : pages[key];
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve(body),
    });
  });
  return calls;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  push.mockReset();
});

describe('C-037 목록 (QA-W008-01·02·06)', () => {
  it('내 항목에는 실행·편집·삭제가 있다', () => {
    render(
      <SavedSearchList
        items={[MINE]}
        onRun={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onRebindEpoch={vi.fn()}
        testIdPrefix="t"
      />,
    );
    expect(screen.getByTestId('t-row-1-run')).toBeTruthy();
    expect(screen.getByTestId('t-row-1-edit')).toBeTruthy();
    expect(screen.getByTestId('t-row-1-delete')).toBeTruthy();
  });

  it('**공유받은 항목에는 편집·삭제를 그리지 않는다** (QA-W008-06)', () => {
    render(
      <SavedSearchList
        items={[SHARED]}
        onRun={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onRebindEpoch={vi.fn()}
        testIdPrefix="t"
      />,
    );
    expect(screen.getByTestId('t-row-2-run')).toBeTruthy();
    // 비활성으로 보여 주지도 않는다 — 존재 자체를 알리지 않는다 (C-002와 같은 규율).
    expect(screen.queryByTestId('t-row-2-edit')).toBeNull();
    expect(screen.queryByTestId('t-row-2-delete')).toBeNull();
  });

  it('**무효한 질의는 실행이 비활성이고 사유가 글로 있다** (QA-W008-05)', () => {
    render(
      <SavedSearchList
        items={[INVALID_SHARED]}
        onRun={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onRebindEpoch={vi.fn()}
        testIdPrefix="t"
      />,
    );
    const run = screen.getByTestId('t-row-3-run') as HTMLButtonElement;
    expect(run.disabled).toBe(true);

    // 색이 아니라 글로도 말한다 (NFR-006).
    expect(screen.getByTestId('t-row-3-invalid').textContent).toContain("Cannot resolve");
    expect(screen.getByTestId('t-row-3-blocked').textContent).toContain("owner");
  });

  it('공개 범위를 문자로 보인다 — 색만으로 구분하지 않는다', () => {
    render(
      <SavedSearchList
        items={[MINE, SHARED]}
        onRun={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onRebindEpoch={vi.fn()}
        testIdPrefix="t"
      />,
    );
    expect(screen.getByTestId('t-row-1-visibility').textContent).toBe("Private");
    expect(screen.getByTestId('t-row-2-visibility').textContent).toContain('payments');
  });

  it('**삭제는 확인 대화상자를 거친다**', async () => {
    const onDelete = vi.fn();
    const user = userEvent.setup();
    render(
      <SavedSearchList
        items={[MINE]}
        onRun={vi.fn()}
        onEdit={vi.fn()}
        onDelete={onDelete}
        onRebindEpoch={vi.fn()}
        testIdPrefix="t"
      />,
    );

    await user.click(screen.getByTestId('t-row-1-delete'));
    // 누른 것만으로는 지워지지 않는다.
    expect(onDelete).not.toHaveBeenCalled();

    await user.click(await screen.findByTestId('t-delete-confirm'));
    expect(onDelete).toHaveBeenCalledWith(MINE);
  });

  it('**무효 구간을 파서 오프셋으로 짚는다** (AC-6)', () => {
    render(
      <SavedSearchList
        items={[INVALID_SHARED]}
        onRun={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onRebindEpoch={vi.fn()}
        testIdPrefix="t"
      />,
    );

    const span = screen.getByTestId('t-row-3-invalid-span');
    expect(span.textContent).toBe('nosuchkey');
    // 짚되 글자를 잃지 않는다 — 질의 전체가 그대로 있다.
    expect(screen.getByTestId('t-row-3-query').textContent).toBe('repo:acme/a nosuchkey:value');
  });

  it('유효한 질의에는 구간 표식이 없다', () => {
    render(
      <SavedSearchList
        items={[MINE]}
        onRun={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onRebindEpoch={vi.fn()}
        testIdPrefix="t"
      />,
    );
    expect(screen.queryByTestId('t-row-1-invalid-span')).toBeNull();
  });

  it('axe 위반 0건', async () => {
    const { container } = render(
      <SavedSearchList
        items={[MINE, SHARED, INVALID_SHARED]}
        onRun={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onRebindEpoch={vi.fn()}
        testIdPrefix="t"
      />,
    );
    const found = await violations(container);
    expect(describeViolations(found)).toBe('');
  });
});

describe('W-008 화면 (QA-W008-02)', () => {
  it('**프록시 경로로 부른다** — `/api/v1`을 적으면 `/api/v1/v1/...`이 된다', async () => {
    const calls = stubFetch({});
    render(<SavedSearchesView loginPath="/auth/login" />);

    await waitFor(() => {
      expect(calls.length).toBeGreaterThan(0);
    });
    for (const call of calls) {
      expect(call).toContain('/api/saved-searches');
      expect(call).not.toContain('/api/v1/');
    }
  });

  it('**두 목록을 각각 조회한다** — 같은 항목이 양쪽에 나타나지 않는다', async () => {
    const calls = stubFetch({
      'view=mine': { items: [MINE], next_cursor: null },
      'view=team': { items: [SHARED], next_cursor: null },
    });

    render(<SavedSearchesView loginPath="/auth/login" />);

    await waitFor(() => {
      expect(screen.getByTestId('saved-mine-table')).toBeTruthy();
      expect(screen.getByTestId('saved-team-table')).toBeTruthy();
    });

    expect(calls.some((one) => one.includes('view=mine'))).toBe(true);
    expect(calls.some((one) => one.includes('view=team'))).toBe(true);

    // 각 표에 자기 항목만 있다.
    expect(within(screen.getByTestId('saved-mine-table')).queryByText('팀이 공유한 검색')).toBeNull();
    expect(within(screen.getByTestId('saved-team-table')).queryByText('결제 월간 리뷰')).toBeNull();
  });

  it('빈 목록을 목록마다 다르게 말한다', async () => {
    stubFetch({});
    render(<SavedSearchesView loginPath="/auth/login" />);

    await waitFor(() => {
      expect(screen.getByTestId('saved-mine-state').dataset['screenState']).toBe('empty_no_saved');
    });
    expect(screen.getByTestId('saved-team-state').dataset['screenState']).toBe('empty_no_shared');
  });

  it('**실행하면 서버가 준 주소로 간다** — 화면이 URL을 다시 만들지 않는다', async () => {
    stubFetch({
      'view=mine': { items: [MINE], next_cursor: null },
      '/run': { navigation_url: '/search?q=repo%3Aacme%2Fpayments' },
    });
    const user = userEvent.setup();

    render(<SavedSearchesView loginPath="/auth/login" />);
    await waitFor(() => {
      expect(screen.getByTestId('saved-mine-row-1-run')).toBeTruthy();
    });

    await user.click(screen.getByTestId('saved-mine-row-1-run'));
    await waitFor(() => {
      expect(push).toHaveBeenCalledWith('/search?q=repo%3Aacme%2Fpayments');
    });
  });

  it('**편집이 PATCH로 간다** — W-001로 보내면 이름도 공개 범위도 못 고친다', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', (url: string, init?: { method?: string }) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      const view = url.includes('view=team') ? 'team' : 'mine';
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve(
            (init?.method ?? 'GET') === 'GET' && url.includes('/api/saved-searches?')
              ? { items: view === 'mine' ? [MINE] : [], next_cursor: null }
              : {},
          ),
      });
    });
    const user = userEvent.setup();

    render(<SavedSearchesView loginPath="/auth/login" />);
    await waitFor(() => {
      expect(screen.getByTestId('saved-mine-row-1-edit')).toBeTruthy();
    });

    await user.click(screen.getByTestId('saved-mine-row-1-edit'));

    // 대화상자가 열리고 현재 값이 담긴다 — 화면 이동이 아니다.
    const nameField = (await screen.findByTestId('save-search-name')) as HTMLInputElement;
    expect(nameField.value).toBe('결제 월간 리뷰');
    expect(push).not.toHaveBeenCalled();

    await user.click(screen.getByTestId('save-search-submit'));
    await waitFor(() => {
      expect(calls).toContain('PATCH /api/saved-searches/1');
    });
  });

  it('**편집 대화상자에서는 질의를 고칠 수 있다** — 무효가 된 질의를 되살릴 길이다', async () => {
    stubFetch({ 'view=mine': { items: [INVALID_MINE], next_cursor: null } });
    const user = userEvent.setup();

    render(<SavedSearchesView loginPath="/auth/login" />);
    await waitFor(() => {
      expect(screen.getByTestId('saved-mine-row-4-edit')).toBeTruthy();
    });

    await user.click(screen.getByTestId('saved-mine-row-4-edit'));
    const query = (await screen.findByTestId('save-search-query')) as HTMLInputElement;
    expect(query.readOnly).toBe(false);
    expect(query.value).toBe('repo:acme/a nosuchkey:value');
  });

  it('axe 위반 0건', async () => {
    stubFetch({
      'view=mine': { items: [MINE], next_cursor: null },
      'view=team': { items: [SHARED], next_cursor: null },
    });
    const { container } = render(<SavedSearchesView loginPath="/auth/login" />);
    await waitFor(() => {
      expect(screen.getByTestId('saved-mine-table')).toBeTruthy();
    });

    const found = await violations(container);
    expect(describeViolations(found)).toBe('');
  });
});

describe('W-001 저장 대화상자 (QA-W008-01)', () => {
  it('**질의를 그대로 담고 편집할 수 없다**', async () => {
    stubFetch({});
    render(
      <SaveSearchDialog open onOpenChange={vi.fn()} query="repo:acme/payments author:kim" />,
    );

    const query = (await screen.findByTestId('save-search-query')) as HTMLInputElement;
    expect(query.value).toBe('repo:acme/payments author:kim');
    expect(query.readOnly).toBe(true);
  });

  it('**이름이 없으면 저장할 수 없다**', async () => {
    stubFetch({});
    render(<SaveSearchDialog open onOpenChange={vi.fn()} query="repo:acme/a" />);

    const submit = (await screen.findByTestId('save-search-submit')) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
  });

  it('**공개 범위를 고르기 전에는 팀 목록을 부르지 않는다**', async () => {
    const calls = stubFetch({});
    render(<SaveSearchDialog open onOpenChange={vi.fn()} query="repo:acme/a" />);
    await screen.findByTestId('save-search-dialog');

    expect(calls.some((one) => one.includes('share-targets'))).toBe(false);
  });

  const TEAM_EDIT = {
    saved_search_id: 5,
    name: '팀 공유 항목',
    query: 'repo:acme/a',
    visibility: 'team' as const,
    team_id: 7,
  };

  it('**`team`인 항목을 열면 대상 목록을 곧바로 읽는다** — 선택기가 빈 채로 뜨지 않는다', async () => {
    const calls = stubFetch({ 'share-targets': { teams: [{ team_id: 7, org_id: 1, slug: 'payments' }] } });

    render(<SaveSearchDialog open onOpenChange={vi.fn()} query="repo:acme/a" edit={TEAM_EDIT} />);

    await waitFor(() => {
      expect(calls.filter((one) => one.includes('share-targets'))).toHaveLength(1);
    });
    expect(await screen.findByTestId('save-search-team')).toBeTruthy();
  });

  it('**다시 열면 팀 목록을 다시 읽는다** — 소속이 바뀌면 선택지도 바뀌어야 한다', async () => {
    const calls = stubFetch({ 'share-targets': { teams: [{ team_id: 7, org_id: 1, slug: 'payments' }] } });

    const { rerender } = render(
      <SaveSearchDialog open onOpenChange={vi.fn()} query="repo:acme/a" edit={TEAM_EDIT} />,
    );
    await waitFor(() => {
      expect(calls.filter((one) => one.includes('share-targets'))).toHaveLength(1);
    });

    // 닫았다 다시 연다. 한 번 받아 둔 목록을 재사용하면 여기서 늘지 않는다.
    rerender(
      <SaveSearchDialog open={false} onOpenChange={vi.fn()} query="repo:acme/a" edit={TEAM_EDIT} />,
    );
    rerender(<SaveSearchDialog open onOpenChange={vi.fn()} query="repo:acme/a" edit={TEAM_EDIT} />);

    await waitFor(() => {
      expect(calls.filter((one) => one.includes('share-targets'))).toHaveLength(2);
    });
  });

  it('**저장이 프록시 경로로 간다**', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', (url: string, init?: { method?: string }) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      return Promise.resolve({ ok: true, status: 201, json: () => Promise.resolve({}) });
    });
    const user = userEvent.setup();

    render(<SaveSearchDialog open onOpenChange={vi.fn()} query="repo:acme/a" />);
    await user.type(await screen.findByTestId('save-search-name'), '이름');
    await user.click(screen.getByTestId('save-search-submit'));

    await waitFor(() => {
      expect(calls).toContain('POST /api/saved-searches');
    });
  });

  it('저장 실패를 사유와 함께 보인다', async () => {
    vi.stubGlobal('fetch', () =>
      Promise.resolve({
        ok: false,
        status: 409,
        json: () => Promise.resolve({ error: { code: 'SAVED_SEARCH_LIMIT' } }),
      }),
    );
    const user = userEvent.setup();

    render(<SaveSearchDialog open onOpenChange={vi.fn()} query="repo:acme/a" />);
    await user.type(await screen.findByTestId('save-search-name'), '이름');
    await user.click(screen.getByTestId('save-search-submit'));

    const error = await screen.findByTestId('save-search-error');
    expect(error.textContent).toContain("100 saved searches");
  });

  it('axe 위반 0건', async () => {
    stubFetch({});
    const { baseElement } = render(
      <SaveSearchDialog open onOpenChange={vi.fn()} query="repo:acme/a" />,
    );
    await screen.findByTestId('save-search-dialog');

    // 대화상자는 포털로 body에 붙는다 — `container`만 보면 아무것도 검사하지 않는다.
    const found = await violations(baseElement);
    expect(describeViolations(found)).toBe('');
  });
});

describe('시퀀스 인용 상태 (QA-W008-13~19 / CR-051)', () => {
  const withReference = (
    reference: NonNullable<SavedSearchView['sequence_reference']>,
    over: Partial<SavedSearchView> = {},
  ): SavedSearchView => ({
    ...MINE,
    query: 'repo:acme/payments base:main seq:10..20',
    sequence_reference: reference,
    ...over,
  });

  function draw(item: SavedSearchView, onRebindEpoch = vi.fn()) {
    return render(
      <SavedSearchList
        items={[item]}
        onRun={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onRebindEpoch={onRebindEpoch}
        testIdPrefix="t"
      />,
    );
  }

  it('낡은 인용을 **글로** 알린다 — 색만으로 말하지 않는다 (NFR-006)', () => {
    draw(withReference({ status: 'epoch_stale', stored_seq_epoch: 3, current_seq_epoch: 4 }));

    expect(screen.getByTestId('t-row-1-sequence-status').textContent).toContain("changed");
    const detail = screen.getByTestId('t-row-1-sequence-detail').textContent ?? '';
    expect(detail).toContain('3');
    expect(detail).toContain('4');
  });

  it('낡았어도 실행 버튼은 열려 있다 — W-001이 무효를 보여 준다', () => {
    draw(withReference({ status: 'epoch_stale', stored_seq_epoch: 3, current_seq_epoch: 4 }));
    expect(screen.getByTestId<HTMLButtonElement>('t-row-1-run').disabled).toBe(false);
  });

  it('**미연결 인용은 실행을 막고 사유를 준다**', () => {
    draw(withReference({ status: 'unbound', current_seq_epoch: 4 }));

    expect(screen.getByTestId<HTMLButtonElement>('t-row-1-run').disabled).toBe(true);
    expect(screen.getByTestId('t-row-1-blocked').textContent).toContain("Rebind");
  });

  it('저장자에게 재연결 버튼을 그리고, 누르면 콜백이 불린다', async () => {
    const user = userEvent.setup();
    const onRebindEpoch = vi.fn();
    draw(withReference({ status: 'unbound', current_seq_epoch: 4 }), onRebindEpoch);

    await user.click(screen.getByTestId('t-row-1-rebind-epoch'));
    expect(onRebindEpoch).toHaveBeenCalledTimes(1);
  });

  it('**공유받은 사람에게는 재연결을 그리지 않는다** (AC-2)', () => {
    draw(
      withReference(
        { status: 'epoch_stale', stored_seq_epoch: 3, current_seq_epoch: 4 },
        { is_owner: false, saved_search_id: 1 },
      ),
    );
    expect(screen.queryByTestId('t-row-1-rebind-epoch')).toBeNull();
  });

  it('**`unavailable`에는 어떤 숫자도 나오지 않는다** (THR-043)', () => {
    draw(withReference({ status: 'unavailable' }, { is_owner: false }));

    const status = screen.getByTestId('t-row-1-sequence-status').textContent ?? '';
    const detail = screen.getByTestId('t-row-1-sequence-detail').textContent ?? '';
    // 에폭 값이 하나라도 화면에 나오면 그것이 유출이다.
    expect(`${status} ${detail}`).not.toMatch(/\d/);
    expect(screen.queryByTestId('t-row-1-rebind-epoch')).toBeNull();
  });

  it('`seq:`가 없는 항목에는 인용 표시가 없다', () => {
    draw(MINE);
    expect(screen.queryByTestId('t-row-1-sequence-status')).toBeNull();
  });

  it('axe 위반 0건', async () => {
    const { container } = draw(
      withReference({ status: 'epoch_stale', stored_seq_epoch: 3, current_seq_epoch: 4 }),
    );
    const found = await violations(container);
    expect(describeViolations(found)).toBe('');
  });
});

describe('편집이 시퀀스 인용을 다루는 법 (CR-051, PR #64 리뷰 P2)', () => {
  const EDIT_TARGET = {
    saved_search_id: 7,
    name: '구간 검색',
    query: 'repo:acme/payments base:main seq:10..20',
    visibility: 'private' as const,
    team_id: null,
    current_seq_epoch: 4,
  };

  function captureBody(): { last: Record<string, unknown> | null } {
    const box: { last: Record<string, unknown> | null } = { last: null };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.body !== undefined) box.last = JSON.parse(String(init.body)) as Record<string, unknown>;
        return { ok: true, status: 200, json: async () => ({ teams: [] }) } as Response;
      }),
    );
    return box;
  }

  it('**질의를 고치면 현재 에폭을 함께 보낸다** — 없으면 편집 자체가 막힌다', async () => {
    const user = userEvent.setup();
    const box = captureBody();
    render(<SaveSearchDialog open onOpenChange={vi.fn()} query="" edit={EDIT_TARGET} />);

    const queryInput = await screen.findByTestId('save-search-query');
    await user.clear(queryInput);
    await user.type(queryInput, 'repo:acme/payments base:main seq:10..20 author:kim');
    await user.click(screen.getByTestId('save-search-submit'));

    /*
     * 이 값이 없으면 PATCH가 `sequence_epoch_required`로 거절해, 사용자는
     * `seq:` 검색에 필터 하나를 더하는 것조차 못 한다.
     */
    expect(box.last?.['seq_epoch']).toBe(4);
  });

  it('**이름만 고치면 에폭을 보내지 않는다** — 낡은 값이 그대로 남는다', async () => {
    const user = userEvent.setup();
    const box = captureBody();
    render(<SaveSearchDialog open onOpenChange={vi.fn()} query="" edit={EDIT_TARGET} />);

    const nameInput = await screen.findByTestId('save-search-name');
    await user.clear(nameInput);
    await user.type(nameInput, '새 이름');
    await user.click(screen.getByTestId('save-search-submit'));

    // 키 자체가 없어야 한다. 있으면 서버가 그것을 명시적 재연결로 읽는다.
    expect(box.last).not.toHaveProperty('seq_epoch');
  });
});
