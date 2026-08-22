/**
 * W-001 통합 검색 화면 (WP-016 DoD / 상태 매트릭스 W-001, QA-W001-*).
 *
 * DoD가 요구하는 둘을 여기서 건다:
 *   1. **상태 매트릭스의 모든 상태**에 대응하는 컴포넌트 시험
 *   2. **axe 위반 0건**
 *
 * 상태 **판정**은 `lib/search-state.test.ts`가 이미 걸었다. 여기서 거는 것은
 * 그 판정이 **실제로 그려지는가**와 접근성이다 — 판정을 여기서 다시 걸면
 * 같은 것을 느린 계층에서 두 번 건다.
 */

import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

const params = { current: new URLSearchParams() };
const replaced: string[] = [];
const pushed: string[] = [];

vi.mock('next/navigation', () => ({
  usePathname: () => '/search',
  useSearchParams: () => params.current,
  useRouter: () => ({
    replace: (href: string) => replaced.push(href),
    push: (href: string) => pushed.push(href),
  }),
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const { SearchView } = await import('../components/SearchView');
const { SequenceBadge } = await import('../components/SequenceBadge');

/** 대비는 `checkContrast`가 본다 — jsdom에는 레이아웃도 canvas도 없다. */
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

const ROW = {
  kind: 'pull_request' as const,
  repository: 'acme/payments',
  pr_number: 1234,
  title: 'feat: 결제 재시도',
  author: 'kim',
  state: 'merged',
  merge_seq: 1342,
  seq_epoch: 3,
  sequence_space: 'acme/payments@main',
  merged_at: '2026-08-19T05:02:11Z',
  changed_files_count: 2,
  additions: 120,
  deletions: 15,
  url: '/pr/acme/payments/1234',
};

/** 응답을 고정한 `fetch`. 호출 URL을 기록해 "부르지 않았다"를 걸 수 있게 한다. */
function stubFetch(body: unknown, init: { status?: number } = {}): string[] {
  const calls: string[] = [];
  vi.stubGlobal('fetch', (url: string) => {
    calls.push(url);
    return Promise.resolve({
      ok: (init.status ?? 200) < 400,
      status: init.status ?? 200,
      json: () => Promise.resolve(body),
    } as Response);
  });
  return calls;
}

function view(): ReturnType<typeof render> {
  return render(<SearchView loginPath="/auth/login" />);
}

/** 화면이 현재 무슨 상태인지. 컴포넌트가 DOM에 남긴다. */
function stateOf(): string | null {
  return screen.getByTestId('search-view').getAttribute('data-screen-state');
}

beforeEach(() => {
  params.current = new URLSearchParams();
  replaced.length = 0;
  pushed.length = 0;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('상태 매트릭스 W-001 — 모든 상태가 그려진다', () => {
  it('`empty_no_query` — 예시 질의를 보여 준다', async () => {
    stubFetch({});
    const { container } = view();

    expect(stateOf()).toBe('empty_no_query');
    expect(screen.getByText(/seq:1200\.\.1350/)).toBeInTheDocument();
    expect(describeViolations(await violations(container))).toBe('');
  });

  it('`error_prefix_too_short` — **서버를 부르지 않는다** (QA-W001-04)', async () => {
    const calls = stubFetch({});
    params.current = new URLSearchParams('q=a1b2c3');
    const { container } = view();

    expect(stateOf()).toBe('error_prefix_too_short');
    expect(screen.getByTestId('prefix-too-short')).toBeInTheDocument();

    // 이 시험의 핵심이다. 안내만 뜨고 왕복이 없어야 한다.
    await waitFor(() => {
      expect(calls).toEqual([]);
    });
    expect(describeViolations(await violations(container))).toBe('');
  });

  it('`error_query_syntax` — 오류 구간과 지원 키 (QA-W001-07)', async () => {
    const calls = stubFetch({});
    params.current = new URLSearchParams('q=assignee:kim');
    const { container } = view();

    expect(stateOf()).toBe('error_query_syntax');
    // 오류 구간이 원문 안에서 강조된다 (FR-SRCH-005 예외 처리).
    expect(screen.getByTestId('query-error-range')).toHaveTextContent('assignee:kim');
    // 무엇을 쓸 수 있는지 함께 보여 준다 (AC-4).
    expect(screen.getByTestId('supported-keys')).toHaveTextContent('repo');

    // 클라이언트가 잡았으므로 서버를 부르지 않는다.
    await waitFor(() => {
      expect(calls).toEqual([]);
    });
    expect(describeViolations(await violations(container))).toBe('');
  });

  it('`loading_initial` — skeleton 8행', async () => {
    // 응답을 영원히 미뤄 로딩 상태에 머문다.
    vi.stubGlobal('fetch', () => new Promise<Response>(() => undefined));
    params.current = new URLSearchParams('q=repo:acme/payments');
    const { container } = view();

    await waitFor(() => {
      expect(stateOf()).toBe('loading_initial');
    });
    expect(screen.getAllByTestId('result-skeleton')).toHaveLength(8);
    expect(describeViolations(await violations(container))).toBe('');
  });

  it('`ready` — 결과 행이 선다', async () => {
    stubFetch({ total: { value: 1, relation: 'eq' }, items: [ROW], next_cursor: null });
    params.current = new URLSearchParams('q=repo:acme/payments');
    const { container } = view();

    await waitFor(() => {
      expect(stateOf()).toBe('ready');
    });
    expect(screen.getAllByTestId('result-row')).toHaveLength(1);
    expect(describeViolations(await violations(container))).toBe('');
  });

  it('`empty_no_result` — 완화 후보를 함께 준다 (QA-W001-11)', async () => {
    stubFetch({
      total: { value: 0, relation: 'eq' },
      items: [],
      relaxation_hints: [{ remove: 'author:kim', total: 12 }],
      next_cursor: null,
    });
    params.current = new URLSearchParams('q=repo:acme/a author:kim');
    const { container } = view();

    await waitFor(() => {
      expect(stateOf()).toBe('empty_no_result');
    });
    const hints = screen.getByTestId('relaxation-hints');
    expect(hints).toHaveTextContent('author:kim');
    expect(hints).toHaveTextContent('12');
    expect(describeViolations(await violations(container))).toBe('');
  });

  it('**제출한 뒤 후보 1건이면 상세로 이동한다** (FLOW-001 4단계, CR-021 DEV-097)', async () => {
    const sha = 'a'.repeat(40);
    stubFetch({
      detected_kind: 'commit',
      candidates: [
        { kind: 'commit', repository: 'acme/a', display_name: 'a1b2c3d',
          url: `/commit/acme/a/${sha}`, merge_seq: null, seq_epoch: null, sequence_space: null },
      ],
      truncated: false,
    });
    params.current = new URLSearchParams(`q=${sha}`);
    view();

    await waitFor(() => {
      expect(stateOf()).toBe('resolved_single');
    });
    /*
     * `resolved_single` 분기가 없으면 화면이 `loading_initial`에 **영원히
     * 멈춘다** — 해석 응답에는 `items`가 없기 때문이다. 40자 SHA 붙여넣기가
     * 이 제품에서 가장 흔한 입력이므로 그 정지는 곧 제품이 멈추는 것이다.
     */
    await userEvent.type(screen.getByRole('searchbox'), `${sha}{Enter}`);
    await waitFor(() => {
      expect(pushed).toContain(`/commit/acme/a/${sha}?from_q=${sha}`);
    });
  });

  it('**제출하지 않았으면 이동하지 않는다** — 뒤로가기가 튕겨 나가지 않는다', async () => {
    const sha = 'a'.repeat(40);
    stubFetch({
      candidates: [
        { kind: 'commit', repository: 'acme/a', display_name: 'a1b2c3d',
          url: `/commit/acme/a/${sha}`, merge_seq: null, seq_epoch: null, sequence_space: null },
      ],
      truncated: false,
    });
    params.current = new URLSearchParams(`q=${sha}`);
    view();

    await waitFor(() => {
      expect(stateOf()).toBe('resolved_single');
    });
    /*
     * 뒤로가기로 이 URL에 **돌아온** 경우다. 여기서 또 떠나면 사용자는
     * 검색 화면에 영영 닿지 못한다 — e2e가 실제로 그것을 잡았다.
     */
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(pushed.filter((h) => h.startsWith('/commit/'))).toEqual([]);
    // 대신 후보 카드를 눌러 갈 수 있어야 한다.
    expect(screen.getByTestId('candidate-link')).toHaveAttribute(
      'href',
      `/commit/acme/a/${sha}?from_q=${sha}`,
    );
  });

  it('**제출 한 번에 이동도 한 번이다** — 제출 횟수를 소비한다', async () => {
    const sha = 'a'.repeat(40);
    stubFetch({
      candidates: [
        { kind: 'commit', repository: 'acme/a', display_name: 'a1b2c3d',
          url: `/commit/acme/a/${sha}`, merge_seq: null, seq_epoch: null, sequence_space: null },
      ],
      truncated: false,
    });
    params.current = new URLSearchParams(`q=${sha}`);
    const { rerender } = view();

    await waitFor(() => {
      expect(stateOf()).toBe('resolved_single');
    });
    await userEvent.type(screen.getByRole('searchbox'), `${sha}{Enter}`);
    await waitFor(() => {
      expect(pushed.filter((h) => h.startsWith('/commit/'))).toHaveLength(1);
    });

    /*
     * 소비하지 않으면 이후의 어떤 갱신에서도 이동이 되풀이된다. 실제
     * 브라우저에서는 곧 언마운트되어 가려지지만, **가려진 결함은 결함이다** —
     * 이동이 막히거나 화면이 남는 순간 드러난다.
     */
    rerender(<SearchView loginPath="/auth/login" />);
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(pushed.filter((h) => h.startsWith('/commit/'))).toHaveLength(1);
  });

  it('이동 중에도 **후보 카드를 남긴다** — 이동이 막히면 손으로 누른다', async () => {
    stubFetch({
      candidates: [
        { kind: 'commit', repository: 'acme/a', display_name: 'a1b2c3d',
          url: '/commit/acme/a/x', merge_seq: null, seq_epoch: null, sequence_space: null },
      ],
      truncated: false,
    });
    params.current = new URLSearchParams('q=a1b2c3d');
    const { container } = view();

    await waitFor(() => {
      expect(stateOf()).toBe('resolved_single');
    });
    expect(screen.getByTestId('candidate-link')).toBeInTheDocument();
    expect(describeViolations(await violations(container))).toBe('');
  });

  it('`ambiguous` — **자동 이동하지 않는다** (QA-W001-05)', async () => {
    stubFetch({
      candidates: [
        { kind: 'commit', repository: 'acme/a', display_name: 'a1b2c3d', url: '/commit/acme/a/a1b2c3d', merge_seq: null, seq_epoch: null, sequence_space: null },
        { kind: 'commit', repository: 'acme/b', display_name: 'a1b2c3e', url: '/commit/acme/b/a1b2c3e', merge_seq: null, seq_epoch: null, sequence_space: null },
      ],
      truncated: false,
    });
    params.current = new URLSearchParams('q=a1b2c3d');
    const { container } = view();

    await waitFor(() => {
      expect(stateOf()).toBe('ambiguous');
    });
    expect(screen.getAllByTestId('candidate-link')).toHaveLength(2);
    // 라우터를 부르지 않았다 — 사용자가 고른다.
    expect(pushed).toEqual([]);
    expect(describeViolations(await violations(container))).toBe('');
  });

  it('`ambiguous` + 절삭 표시 (QA-W001-06)', async () => {
    stubFetch({
      candidates: [
        { kind: 'commit', repository: 'acme/a', display_name: 'x', url: '/c/1', merge_seq: null, seq_epoch: null, sequence_space: null },
        { kind: 'commit', repository: 'acme/b', display_name: 'y', url: '/c/2', merge_seq: null, seq_epoch: null, sequence_space: null },
      ],
      truncated: true,
    });
    params.current = new URLSearchParams('q=a1b2c3d');
    view();

    await waitFor(() => {
      expect(screen.getByTestId('candidates-truncated')).toBeInTheDocument();
    });
  });

  it('`error_search_timeout` — 조건 추가를 안내한다', async () => {
    stubFetch({ error: { code: 'SEARCH_TIMEOUT', message: '시간 초과' } }, { status: 504 });
    params.current = new URLSearchParams('q=repo:acme/a');
    const { container } = view();

    await waitFor(() => {
      expect(stateOf()).toBe('error_search_timeout');
    });
    // 복구 경로를 준다 — "실패했습니다"만으로는 사용자가 할 일이 없다.
    expect(screen.getByText(/저장소 조건.*좁혀/)).toBeInTheDocument();
    expect(describeViolations(await violations(container))).toBe('');
  });

  it('`no_permission`', async () => {
    stubFetch({ error: { code: 'NO_ACCESSIBLE_REPOSITORY', message: 'x' } }, { status: 503 });
    params.current = new URLSearchParams('q=repo:acme/a');
    const { container } = view();

    await waitFor(() => {
      expect(stateOf()).toBe('no_permission');
    });
    expect(describeViolations(await violations(container))).toBe('');
  });

  it('`auth_expired` — 원래 경로를 담아 로그인으로 보낸다 (QA-COMMON-18)', async () => {
    stubFetch({ error: { code: 'UNAUTHENTICATED', message: 'x' } }, { status: 401 });
    params.current = new URLSearchParams('q=repo:acme/a');
    const { container } = view();

    await waitFor(() => {
      expect(stateOf()).toBe('auth_expired');
    });
    const link = screen.getByRole('link', { name: '다시 로그인' });
    expect(link).toHaveAttribute('href', '/auth/login?return_to=%2Fsearch');
    expect(describeViolations(await violations(container))).toBe('');
  });

  it('`offline` — 네트워크 실패', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new Error('네트워크 없음')));
    params.current = new URLSearchParams('q=repo:acme/a');
    const { container } = view();

    await waitFor(() => {
      expect(stateOf()).toBe('offline');
    });
    expect(describeViolations(await violations(container))).toBe('');
  });

  it('`error_other` — 서버 문구를 그대로 보여 준다', async () => {
    stubFetch({ error: { code: 'INTERNAL', message: '내부 오류가 발생했습니다' } }, { status: 500 });
    params.current = new URLSearchParams('q=repo:acme/a');
    const { container } = view();

    await waitFor(() => {
      expect(stateOf()).toBe('error_other');
    });
    expect(screen.getByText('내부 오류가 발생했습니다')).toBeInTheDocument();
    expect(describeViolations(await violations(container))).toBe('');
  });
});

describe('정렬 (FR-SRCH-007, C-013 접근성)', () => {
  it('정렬 헤더에 `aria-sort`가 붙는다', async () => {
    stubFetch({
      total: { value: 1, relation: 'eq' },
      items: [ROW],
      sort: { field: 'merge_seq', order: 'desc' },
      next_cursor: null,
    });
    params.current = new URLSearchParams('q=repo:acme/a');
    view();

    await waitFor(() => {
      expect(stateOf()).toBe('ready');
    });

    const header = screen.getByRole('columnheader', { name: /시퀀스/ });
    expect(header).toHaveAttribute('aria-sort', 'descending');
  });

  it('**기본 정렬이 머지 시퀀스 내림차순이다** (QA-W001-12)', async () => {
    stubFetch({ total: { value: 1, relation: 'eq' }, items: [ROW], next_cursor: null });
    params.current = new URLSearchParams('q=repo:acme/a');
    view();

    await waitFor(() => {
      expect(stateOf()).toBe('ready');
    });
    // URL에 정렬이 없어도 시퀀스 열이 내림차순으로 표시된다.
    expect(screen.getByRole('columnheader', { name: /시퀀스/ })).toHaveAttribute(
      'aria-sort',
      'descending',
    );
  });

  it('정렬하지 않는 열에는 `aria-sort`가 `none`이다', async () => {
    stubFetch({
      total: { value: 1, relation: 'eq' },
      items: [ROW],
      sort: { field: 'merge_seq', order: 'desc' },
      next_cursor: null,
    });
    params.current = new URLSearchParams('q=repo:acme/a');
    view();

    await waitFor(() => {
      expect(stateOf()).toBe('ready');
    });
    expect(screen.getByRole('columnheader', { name: /머지 시각/ })).toHaveAttribute(
      'aria-sort',
      'none',
    );
  });

  it('헤더를 누르면 **`replace`로** URL을 고친다 — 히스토리를 쌓지 않는다', async () => {
    stubFetch({ total: { value: 1, relation: 'eq' }, items: [ROW], next_cursor: null });
    params.current = new URLSearchParams('q=repo:acme/a');
    view();

    await waitFor(() => {
      expect(stateOf()).toBe('ready');
    });
    await userEvent.click(screen.getByRole('button', { name: '머지 시각' }));

    expect(pushed).toEqual([]);
    expect(replaced).toHaveLength(1);
    expect(replaced[0]).toContain('sort=merged_at');
  });

  it('키보드로 정렬할 수 있다 — 헤더가 버튼이다', async () => {
    stubFetch({ total: { value: 1, relation: 'eq' }, items: [ROW], next_cursor: null });
    params.current = new URLSearchParams('q=repo:acme/a');
    view();

    await waitFor(() => {
      expect(stateOf()).toBe('ready');
    });
    screen.getByRole('button', { name: '머지 시각' }).focus();
    await userEvent.keyboard('{Enter}');
    expect(replaced).toHaveLength(1);
  });
});

describe('결과 행 (C-013)', () => {
  it('**행 제목이 실제 링크다** — 새 탭 열기가 살아 있어야 한다', async () => {
    stubFetch({ total: { value: 1, relation: 'eq' }, items: [ROW], next_cursor: null });
    params.current = new URLSearchParams('q=repo:acme/a');
    view();

    await waitFor(() => {
      expect(stateOf()).toBe('ready');
    });
    const link = screen.getByTestId('result-link');
    expect(link.tagName).toBe('A');
    expect(link.getAttribute('href')).toContain('/pr/acme/payments/1234');
  });

  it('원본 입력을 `from_q`로 남긴다 (CR-019, DEV-078 / FLOW-001 4단계)', async () => {
    stubFetch({ total: { value: 1, relation: 'eq' }, items: [ROW], next_cursor: null });
    params.current = new URLSearchParams('q=repo:acme/a');
    view();

    await waitFor(() => {
      expect(stateOf()).toBe('ready');
    });
    // `q`가 아니라 `from_q`다 — 상세 URL이 검색 결과처럼 읽히면 안 된다.
    const href = screen.getByTestId('result-link').getAttribute('href') ?? '';
    expect(href).toContain('from_q=');
    expect(href).not.toMatch(/[?&]q=/);
  });

  it('**페이지 번호 UI가 없다** (QA-W001-14의 절반 / CR-019 DEV-075)', async () => {
    stubFetch({ total: { value: 1, relation: 'eq' }, items: [ROW], next_cursor: null });
    params.current = new URLSearchParams('q=repo:acme/a');
    const { container } = view();

    await waitFor(() => {
      expect(stateOf()).toBe('ready');
    });
    /*
     * 오프셋 페이징을 시사하는 UI를 두지 않는다 (C-016 사용 규칙). 커서
     * 동작 자체는 WP-032지만, **금지 규칙은 지금 세우는 것이 옳다** —
     * 나중에 검사하면 이미 잘못 만든 뒤다.
     */
    expect(container.querySelector('[aria-label*="페이지"]')).toBeNull();
    expect(screen.queryByRole('navigation', { name: /페이지/ })).toBeNull();
    expect(container.textContent).not.toMatch(/\d+\s*\/\s*\d+\s*페이지/);
  });
});

describe('시퀀스 배지 (C-014, QA-W001-22)', () => {
  it('미채번과 미머지의 **문구가 다르다**', () => {
    const { container: a } = render(
      <SequenceBadge merge_seq={null} seq_epoch={null} sequence_space={null} state="merged" />,
    );
    const notComputed = a.textContent ?? '';
    cleanup();

    const { container: b } = render(
      <SequenceBadge merge_seq={null} seq_epoch={null} sequence_space={null} state="open" />,
    );
    const unassigned = b.textContent ?? '';

    expect(notComputed).not.toBe(unassigned);
  });

  it('다른 시퀀스 공간이면 **글자로도** 밝힌다 — 색에만 의존하지 않는다', () => {
    const { container } = render(
      <SequenceBadge
        merge_seq={1342}
        seq_epoch={3}
        sequence_space="acme/a@main"
        state="merged"
        contextSpace="acme/b@main"
      />,
    );

    const badge = container.querySelector('[data-seq-state]');
    expect(badge).toHaveAttribute('data-foreign', '');
    expect(container.textContent).toContain('다른 시퀀스 공간');
  });

  it('같은 공간이면 표식이 없다 — 근거 없이 흐리게 그리지 않는다', () => {
    const { container } = render(
      <SequenceBadge
        merge_seq={1342}
        seq_epoch={3}
        sequence_space="acme/a@main"
        state="merged"
        contextSpace="acme/a@main"
      />,
    );
    expect(container.querySelector('[data-seq-state]')).not.toHaveAttribute('data-foreign');
  });

  it('설명이 배지에 `aria-describedby`로 이어진다 (C-014 접근성)', () => {
    const { container } = render(
      <SequenceBadge merge_seq={1342} seq_epoch={3} sequence_space="acme/a@main" state="merged" />,
    );
    const badge = container.querySelector('[data-seq-state]');
    const id = badge?.getAttribute('aria-describedby');
    expect(id).toBeTruthy();
    expect(container.querySelector(`#${CSS.escape(id ?? '')}`)?.textContent).toContain('에폭 3');
  });
});

describe('질의 토큰 바 (C-011)', () => {
  it('칩 제거 버튼의 이름이 명세대로다', async () => {
    stubFetch({ total: { value: 1, relation: 'eq' }, items: [ROW], next_cursor: null });
    params.current = new URLSearchParams('q=repo:acme/a author:kim');
    view();

    await waitFor(() => {
      expect(stateOf()).toBe('ready');
    });
    expect(screen.getByRole('button', { name: 'author:kim 필터 제거' })).toBeInTheDocument();
  });

  it('칩을 지우면 **AST를 고쳐** URL을 `replace`한다', async () => {
    stubFetch({ total: { value: 1, relation: 'eq' }, items: [ROW], next_cursor: null });
    params.current = new URLSearchParams('q=repo:acme/a author:kim');
    view();

    await waitFor(() => {
      expect(stateOf()).toBe('ready');
    });
    await userEvent.click(screen.getByRole('button', { name: 'author:kim 필터 제거' }));

    expect(pushed).toEqual([]);
    expect(replaced).toHaveLength(1);
    // 남은 조건만 실린다 — 문자열을 자른 게 아니라 AST를 다시 직렬화했다.
    expect(decodeURIComponent(replaced[0] ?? '')).toContain('q=repo:acme/a');
    expect(decodeURIComponent(replaced[0] ?? '')).not.toContain('author:kim');
  });

  it('부정 조건은 제거 이름에 말로 밝힌다 (AC-6)', async () => {
    stubFetch({ total: { value: 1, relation: 'eq' }, items: [ROW], next_cursor: null });
    params.current = new URLSearchParams('q=-author:kim');
    view();

    await waitFor(() => {
      expect(stateOf()).toBe('ready');
    });
    expect(screen.getByRole('button', { name: '제외 조건 author:kim 필터 제거' })).toBeInTheDocument();
  });
});

describe('필터 레일 (C-012, CR-019 DEV-076)', () => {
  it('패싯 키가 없으면 **왜 비었는지 말한다** — 조용히 비우지 않는다', async () => {
    stubFetch({ total: { value: 1, relation: 'eq' }, items: [ROW], next_cursor: null });
    params.current = new URLSearchParams('q=repo:acme/a');
    view();

    await waitFor(() => {
      expect(stateOf()).toBe('ready');
    });
    const notice = screen.getByTestId('facet-notice');
    expect(notice).toHaveAttribute('data-facet-state', 'not_computed');
  });

  it('예산 초과 생략은 **다른 문구**로 말한다', async () => {
    stubFetch({
      total: { value: 1, relation: 'eq' },
      items: [ROW],
      facets_omitted: true,
      next_cursor: null,
    });
    params.current = new URLSearchParams('q=repo:acme/a');
    view();

    await waitFor(() => {
      expect(screen.getByTestId('facet-notice')).toHaveAttribute('data-facet-state', 'omitted');
    });
  });

  it('분포가 오면 선택 UI를 그리고 사유는 감춘다', async () => {
    stubFetch({
      total: { value: 1, relation: 'eq' },
      items: [ROW],
      facets_omitted: false,
      facets: { author: [{ value: 'kim', count: 18 }] },
      next_cursor: null,
    });
    params.current = new URLSearchParams('q=repo:acme/a');
    view();

    await waitFor(() => {
      expect(stateOf()).toBe('ready');
    });
    expect(screen.queryByTestId('facet-notice')).toBeNull();
    // 건수를 이름에 넣는다 — "kim"만 들리면 18건인지 1건인지 모른다.
    expect(within(screen.getByTestId('facet-author')).getByText(/kim \(18\)/)).toBeInTheDocument();
  });
});

describe('찾을 수 없는 이름 (CR-016, DEV-052)', () => {
  it('조용히 0건을 내지 않고 알린다', async () => {
    stubFetch({
      total: { value: 0, relation: 'eq' },
      items: [],
      unresolved_names: [{ key: 'team', value: 'nope' }],
      next_cursor: null,
    });
    params.current = new URLSearchParams('q=team:nope');
    view();

    await waitFor(() => {
      expect(screen.getByTestId('unresolved-names')).toHaveTextContent('team:nope');
    });
  });
});

describe('제출 경로 (C-010, QA-W001-04)', () => {
  it('**짧은 hex를 쳐서 제출해도 아무것도 부르지 않는다**', async () => {
    /*
     * URL로 들어오는 경로는 위에서 걸었다. 여기서는 **사람이 치고 누르는**
     * 경로를 건다 — 변이 시험에서 제출 가드를 없앴을 때 위 시험들이
     * 잡지 못했다(URL 경로에서는 `chooseRoute`가 이미 막기 때문이다).
     */
    const calls = stubFetch({});
    view();

    await userEvent.type(screen.getByRole('searchbox'), 'a1b2c3');
    await userEvent.click(screen.getByRole('button', { name: '검색' }));

    expect(pushed).toEqual([]);
    await waitFor(() => {
      expect(calls).toEqual([]);
    });
  });

  it('**Enter로도 제출되지 않는다** — 버튼 잠금과 별개의 가드다', async () => {
    /*
     * 버튼이 잠겨 있어도 입력창에서 Enter를 치면 폼이 제출될 수 있다.
     * 그래서 가드가 둘이다 — 잠금(보이는 것)과 `handleSubmit`의 조기 반환
     * (실제로 막는 것). 변이 시험이 후자를 없앴을 때 앞 시험이 잡지
     * 못해서(버튼이 잠겨 클릭이 아무 일도 안 한다) 이것을 더했다.
     */
    const calls = stubFetch({});
    view();

    await userEvent.type(screen.getByRole('searchbox'), 'a1b2c3{Enter}');

    expect(pushed).toEqual([]);
    await waitFor(() => {
      expect(calls).toEqual([]);
    });
  });

  it('짧은 hex 동안 제출 버튼이 잠긴다', async () => {
    stubFetch({});
    view();

    await userEvent.type(screen.getByRole('searchbox'), 'a1b2c3');
    expect(screen.getByRole('button', { name: '검색' })).toBeDisabled();
  });

  it('7자가 되면 잠금이 풀리고 제출이 라우팅한다', async () => {
    stubFetch({});
    view();

    await userEvent.type(screen.getByRole('searchbox'), 'a1b2c3d');
    expect(screen.getByRole('button', { name: '검색' })).toBeEnabled();

    await userEvent.click(screen.getByRole('button', { name: '검색' }));
    // 제출은 새 조사다 — `push`로 히스토리에 남는다.
    expect(pushed).toHaveLength(1);
    expect(pushed[0]).toContain('a1b2c3d');
  });

  it('**URL이 바뀌면 입력창이 따라간다** — 뒤로가기가 성립한다', async () => {
    stubFetch({ total: { value: 1, relation: 'eq' }, items: [ROW], next_cursor: null });
    params.current = new URLSearchParams('q=repo:acme/a');
    const { rerender } = view();

    await waitFor(() => {
      expect(screen.getByRole('searchbox')).toHaveValue('repo:acme/a');
    });

    // 뒤로가기가 일어난 것과 같은 상황: URL만 바뀐다.
    params.current = new URLSearchParams('q=repo:acme/older');
    rerender(<SearchView loginPath="/auth/login" />);

    await waitFor(() => {
      expect(screen.getByRole('searchbox')).toHaveValue('repo:acme/older');
    });
  });
});

describe('경합 (늦게 도착한 응답)', () => {
  it('**먼저 보낸 요청이 나중에 와도 화면을 덮지 않는다**', async () => {
    /*
     * 사용자가 빠르게 조건을 바꾸면 순서가 뒤집힐 수 있다. 옛 응답을 그리면
     * **화면이 URL과 다른 것을 보여 준다** — 조사 도구에서 가장 나쁜 종류의
     * 거짓이다. `AbortController`만으로는 이미 도착한 응답을 막지 못한다.
     */
    const resolvers: ((value: unknown) => void)[] = [];
    vi.stubGlobal('fetch', (url: string) => {
      const isOld = url.includes('older');
      return new Promise<Response>((resolve) => {
        resolvers.push(() =>
          resolve({
            ok: true,
            status: 200,
            json: () =>
              Promise.resolve({
                total: { value: 1, relation: 'eq' },
                items: [{ ...ROW, title: isOld ? '옛 결과' : '새 결과' }],
                next_cursor: null,
              }),
          } as Response),
        );
      });
    });

    params.current = new URLSearchParams('q=repo:acme/older');
    const { rerender } = view();
    await waitFor(() => {
      expect(resolvers).toHaveLength(1);
    });

    params.current = new URLSearchParams('q=repo:acme/newer');
    rerender(<SearchView loginPath="/auth/login" />);
    await waitFor(() => {
      expect(resolvers).toHaveLength(2);
    });

    // **새 요청을 먼저, 옛 요청을 나중에** 응답시킨다.
    resolvers[1]?.(null);
    await waitFor(() => {
      expect(screen.getByText('새 결과')).toBeInTheDocument();
    });

    resolvers[0]?.(null);
    // 옛 응답이 도착해도 화면은 새 결과를 유지해야 한다.
    await waitFor(() => {
      expect(screen.getByText('새 결과')).toBeInTheDocument();
    });
    expect(screen.queryByText('옛 결과')).toBeNull();
  });
});
