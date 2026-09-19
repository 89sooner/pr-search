/**
 * CR-111: RepositoryWorkspace(실제 기본 `/search` 화면)의 사이드바·필터 패널 재구성을
 * 컴포넌트 단위로 건다.
 *
 * DEV-728: 이 파일 이전에는 이 컴포넌트를 직접 렌더링하는 시험이 하나도 없었다
 * (`lib/repository-search.test.ts`의 순수 함수 시험만 존재). `playwright.config.ts`의
 * `webServer.env`가 `PRS_LEGACY_SEARCH=1`을 고정해 e2e 전체가 `SearchView`만 렌더링하므로,
 * 이 컴포넌트의 실제 브라우저 종단 e2e 공백은 이 파일이 닫지 않는다 — jsdom 컴포넌트
 * 단위의 구조·상호작용·접근성만 건다.
 *
 * `search.test.tsx`처럼 `next/navigation`을 mock한다. `RepositoryWorkspace`의 `navigate()`는
 * (SearchView와 달리) 네이티브 `history.replaceState`가 아니라 mock된 `useRouter().replace`를
 * 직접 부르므로, 그 호출만 감시하면 된다.
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RepositoryOverview } from '../lib/repository-overview';

const params = { current: new URLSearchParams() };
const replaced: string[] = [];

vi.mock('next/navigation', () => ({
  useSearchParams: () => params.current,
  useRouter: () => ({ replace: (href: string) => { replaced.push(href); }, push: () => {} }),
}));

const { RepositoryWorkspace } = await import('../components/RepositoryWorkspace');

async function violations(container: HTMLElement): Promise<axe.Result[]> {
  const results = await axe.run(container, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
    rules: { 'color-contrast': { enabled: false } },
  });
  return results.violations;
}
function describeViolations(list: axe.Result[]): string {
  return list.map(v => `${v.id}: ${v.help} (${String(v.nodes.length)}곳)`).join('\n');
}

function repo(name: string, overrides: Partial<RepositoryOverview> = {}): RepositoryOverview {
  return {
    repository_id: name.length, repository: name, registration_state: 'active', registered_at: '2026-01-01T00:00:00Z',
    last_ingested_at: null, document_counts: null, backfill: null,
    sequence_spaces: [{ base_branch: 'main', last_sequence: 10, seq_epoch: 1, sequence_state: 'ok', last_assigned_at: null }],
    reconciliation: { last_completed_at: null, missing_count: null }, unavailable: [],
    ...overrides,
  };
}

const PAGE_1 = [repo('acme/payments'), repo('acme/billing')];
const PAGE_2 = [repo('acme/search')];

/** URL을 보고 갈라 응답한다 -- 저장소 목록·검색·source tree 세 계통을 각각 고정 값으로 답한다. */
function stubFetch(options: { repoCursor?: string | null } = {}): { calls: string[] } {
  const calls: string[] = [];
  vi.stubGlobal('fetch', (url: string) => {
    calls.push(url);
    if (url.startsWith('/api/repositories')) {
      const cursor = new URL(url, 'http://localhost').searchParams.get('cursor');
      const body = cursor ? { items: PAGE_2, next_cursor: null } : { items: PAGE_1, next_cursor: options.repoCursor ?? null };
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) } as Response);
    }
    if (url.startsWith('/api/search')) {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ items: [] }) } as Response);
    }
    if (url.startsWith('/api/source/')) {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ entries: [], truncated: false, ref: 'main', revision: 'a1b2c3d' }) } as Response);
    }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) } as Response);
  });
  return { calls };
}

function view(): ReturnType<typeof render> {
  return render(<RepositoryWorkspace loginPath="/auth/login" />);
}

async function openFilters(): Promise<void> {
  await userEvent.click(await screen.findByRole('button', { name: /^Filters/ }));
}

beforeEach(() => {
  params.current = new URLSearchParams();
  replaced.length = 0;
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('CR-111: 저장소 선택이 목록이 아니라 콤보박스 하나다', () => {
  it('「Browse repositories」 헤딩·검색창·행별 버튼이 없고, 콤보박스가 현재 저장소를 보인다', async () => {
    stubFetch();
    view();

    const combobox = await screen.findByRole('combobox', { name: 'Find Repository' });
    await waitFor(() => { expect(combobox).toHaveTextContent('acme/payments'); });
    expect(screen.queryByText('Browse repositories')).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Search by name…')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'acme/payments' })).not.toBeInTheDocument();
  });

  it('다른 저장소를 고르면 base/path/M 번호 range를 지우며 이동한다', async () => {
    stubFetch();
    view();
    const combobox = await screen.findByRole('combobox', { name: 'Find Repository' });
    await waitFor(() => { expect(combobox).toHaveTextContent('acme/payments'); });

    await userEvent.click(combobox);
    await userEvent.click(await screen.findByRole('option', { name: 'acme/billing' }));

    await waitFor(() => {
      const last = replaced.at(-1);
      expect(last).toContain('repository=acme%2Fbilling');
      expect(last).not.toMatch(/[?&]base=/);
      expect(last).not.toMatch(/mnum_from=/);
    });
  });

  it('「Load more repositories…」 선택은 다음 페이지만 불러오고 현재 선택을 바꾸지 않는다', async () => {
    const { calls } = stubFetch({ repoCursor: 'cursor-2' });
    view();
    const combobox = await screen.findByRole('combobox', { name: 'Find Repository' });
    await waitFor(() => { expect(combobox).toHaveTextContent('acme/payments'); });

    await userEvent.click(combobox);
    await userEvent.click(await screen.findByRole('option', { name: 'Load more repositories…' }));

    await waitFor(() => { expect(calls.some(url => url.includes('cursor=cursor-2'))).toBe(true); });
    // 선택은 그대로다 -- sentinel을 골랐다고 트리거 표시가 비거나 sentinel 라벨로 바뀌지 않는다.
    expect(combobox).toHaveTextContent('acme/payments');
    expect(replaced).toEqual([]);
  });
});

describe('CR-111: Branch 헤딩 제거, path 폼 제거, Files & folders가 사이드바 본체다', () => {
  it('「Branch」 헤딩 없이 「Base branch」만 남는다', async () => {
    stubFetch();
    view();
    await screen.findByRole('combobox', { name: 'Find Repository' });

    expect(screen.queryByText('Branch')).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Base branch' })).toBeInTheDocument();
  });

  it('독립된 「Find files and paths」 입력·「View path history」 버튼·사이드바 안내 문단이 없다', async () => {
    stubFetch();
    view();
    await screen.findByRole('combobox', { name: 'Find Repository' });

    expect(screen.queryByPlaceholderText('src/components/…')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /View path history/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/Every change, with its context/)).not.toBeInTheDocument();
    // Files & folders 트리 자체(및 트리 내부 필터)는 남아 있다.
    expect(screen.getByText('Files & folders')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Filter root entries…')).toBeInTheDocument();
  });
});

describe('CR-111: 필터는 기본 collapsed이고, 접어도 값이 유지된다', () => {
  it('최초 진입 시 collapsed이고, 토글하면 검색어 입력이 나타난다', async () => {
    /*
     * `forceMount` 아래 실제 시각적 숨김은 `[data-state='closed'] { display: none; }`
     * CSS(외부 스타일시트, jsdom에서는 로드되지 않는다)가 맡는다 -- Radix 자체의
     * `hidden` 속성은 `forceMount`일 때 `context.open || isPresent`의 `isPresent`가
     * `present`(= `forceMount`)로 초기화돼 있어 계속 `false`로 남는다(소스로 확인).
     * 그래서 여기서는 시각적 숨김이 아니라 트리거의 `aria-expanded`로 collapsed 상태를 건다 --
     * 실제 시각적 숨김은 실제 Chromium 검증이 확인한다.
     */
    stubFetch();
    view();
    const toggle = await screen.findByRole('button', { name: /^Filters/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await openFilters();
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('textbox', { name: /Title.*PR number.*commit SHA/ })).toBeInTheDocument();
  });

  it('Owner/Repository/Base branch 중복 필드가 필터 패널 안에 없다', async () => {
    stubFetch();
    view();
    await openFilters();

    expect(screen.queryByRole('textbox', { name: 'Owner' })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Repository' })).not.toBeInTheDocument();
    // 필터 패널 안에는 Base branch가 하나만 있어야 한다(사이드바의 것과 합쳐 둘이면 안 된다).
    expect(screen.getAllByRole('combobox', { name: 'Base branch' })).toHaveLength(1);
  });

  it('필터를 채운 뒤 접었다 다시 열어도 값이 유지된다', async () => {
    stubFetch();
    view();
    const toggle = await screen.findByRole('button', { name: /^Filters/ });
    await openFilters();

    const author = screen.getByRole('textbox', { name: 'Author' });
    await userEvent.type(author, 'kim');
    expect(author).toHaveValue('kim');

    await openFilters(); // 접는다
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await openFilters(); // 다시 연다
    expect(screen.getByRole('textbox', { name: 'Author' })).toHaveValue('kim');
  });
});

describe('CR-111: Range filter 통합', () => {
  it('기본은 PR number이고, 유형을 바꿔도 이전 유형의 값이 사라지지 않는다', async () => {
    stubFetch();
    view();
    await openFilters();

    await userEvent.type(screen.getByRole('spinbutton', { name: 'PR number from' }), '1842');
    expect(screen.queryByRole('textbox', { name: 'Merge order: from commit' })).not.toBeInTheDocument();

    const rangeSelect = screen.getByRole('combobox', { name: 'Range filter' });
    await userEvent.click(rangeSelect);
    await userEvent.click(await screen.findByRole('option', { name: 'Merge order' }));

    expect(screen.queryByRole('spinbutton', { name: 'PR number from' })).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Merge order: from commit' })).toBeInTheDocument();

    await userEvent.click(rangeSelect);
    await userEvent.click(await screen.findByRole('option', { name: 'PR number' }));
    expect(screen.getByRole('spinbutton', { name: 'PR number from' })).toHaveValue(1842);
  });

  it('활성 range가 있으면 유형을 감추고 있어도 요약을 보인다', async () => {
    stubFetch();
    view();
    await openFilters();

    await userEvent.type(screen.getByRole('spinbutton', { name: 'PR number from' }), '1842');
    await userEvent.type(screen.getByRole('spinbutton', { name: 'PR number to' }), '2044');
    expect(await screen.findByText(/PR 1842.{1,3}2044/)).toBeInTheDocument();
  });

  it('M number 필드는 저장소·base branch 선택 전엔 비활성이고 사유가 title로 붙는다', async () => {
    params.current = new URLSearchParams('base=');
    stubFetch();
    view();
    await openFilters();

    const rangeSelect = screen.getByRole('combobox', { name: 'Range filter' });
    await userEvent.click(rangeSelect);
    await userEvent.click(await screen.findByRole('option', { name: 'M number' }));

    const mnumFrom = screen.getByRole('spinbutton', { name: 'M number from' });
    expect(mnumFrom).toBeDisabled();
    expect(mnumFrom).toHaveAttribute('title', 'Select a repository and base branch to filter by M number.');
  });

  it('Reset은 range 유형도 기본(PR number)으로 되돌린다', async () => {
    stubFetch();
    view();
    await openFilters();

    const rangeSelect = screen.getByRole('combobox', { name: 'Range filter' });
    await userEvent.click(rangeSelect);
    await userEvent.click(await screen.findByRole('option', { name: 'Merge order' }));
    expect(screen.getByRole('textbox', { name: 'Merge order: from commit' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect(screen.getByRole('spinbutton', { name: 'PR number from' })).toBeInTheDocument();
  });
});

describe('CR-111: 접혀 있어도 ⌘K가 검색어 입력을 열고 포커스한다', () => {
  it('Ctrl+K를 누르면 Filters가 열리고 검색어 입력에 포커스된다', async () => {
    stubFetch();
    view();
    const toggle = await screen.findByRole('button', { name: /^Filters/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await userEvent.keyboard('{Control>}k{/Control}');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');

    const input = await screen.findByRole('textbox', { name: /Title.*PR number.*commit SHA/ });
    await waitFor(() => { expect(input).toHaveFocus(); });
  });
});

describe('CR-111: axe 위반 0건', () => {
  it('필터가 접혀 있을 때도, 펼쳤을 때도 위반이 없다', async () => {
    stubFetch();
    const { container } = view();
    await screen.findByRole('combobox', { name: 'Find Repository' });
    expect(describeViolations(await violations(container))).toBe('');

    await openFilters();
    expect(describeViolations(await violations(container))).toBe('');
  });
});

describe('CR-111: 콤보박스의 typeahead 입력이 전역 단축키로 새지 않는다 (독립 리뷰 발견)', () => {
  it('경로가 선택된 상태에서 「Find Repository」에 포커스를 두고 t를 눌러도 TimeLapseModal이 열리지 않는다', async () => {
    /*
     * `<input type="search">`였던 예전 저장소 검색창은 전역 `onKeyDown` 가드(`input,textarea,select,...`)에
     * 걸려 이 문제가 없었다. Radix `Select.Trigger`(role="combobox")로 바꾸면서 그 가드를 벗어나게 됐고,
     * Radix는 트리거가 닫혀 있어도 한 글자 키 입력마다 typeahead 검색을 돌린다 -- 이벤트를 안 막으므로
     * `t` 하나가 그대로 새어나가 "path가 선택되고 파일이면 t로 TimeLapseModal을 연다"는 전역 단축키를 건드릴 수 있었다.
     */
    params.current = new URLSearchParams('path=src%2Findex.ts&path_kind=file');
    stubFetch();
    view();

    const combobox = await screen.findByRole('combobox', { name: 'Find Repository' });
    combobox.focus();
    await userEvent.keyboard('t');

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
