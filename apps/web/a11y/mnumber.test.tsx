/**
 * M 번호 병기와 해석 진입 (WP-074 / FR-SEQ-008 AC-9·AC-10·AC-11, 상세 설계 9절).
 *
 * ## 여기서 거는 것
 *
 * 판정 자체는 `lib/merge-number.test.ts`가 이미 걸었다. 이 파일이 거는 것은
 * **그 판정이 세 화면에 실제로 그려지는가**, **행마다 조회하지 않는가**,
 * **자동 재검증이 계약대로 멈추는가**, 그리고 axe 위반이 없는가이다.
 *
 * 조회 횟수를 실제 `fetch` 계수로 센다 — 설계 9절이 "행별 poll이 아니라 현재
 * 목록/상세 요청 1개"를 요구하므로, 그 수를 세지 않으면 계약을 지켰는지 알 수 없다.
 */

import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
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
const { PrDetailView } = await import('../components/PrDetailView');
const { RangeResultTable } = await import('../components/RangeResultTable');
const { judgeItems } = await import('../lib/range');

async function violations(container: HTMLElement): Promise<axe.Result[]> {
  const results = await axe.run(container, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
    rules: { 'color-contrast': { enabled: false } },
  });
  return results.violations;
}

const describeViolations = (list: axe.Result[]): string =>
  list.map((v) => `${v.id}: ${v.help} (${String(v.nodes.length)}곳)`).join('\n');

// ---------------------------------------------------------------- 고정 응답

const ASSIGNED_ROW = {
  kind: 'pull_request' as const,
  repository: 'acme/smp1900',
  pr_number: 1234,
  title: 'feat: 결제 재시도',
  author: 'kim',
  state: 'merged',
  merge_seq: 1342,
  seq_epoch: 3,
  sequence_space: 'acme/smp1900@main',
  merged_at: '2026-08-19T05:02:11Z',
  changed_files_count: 2,
  additions: 120,
  deletions: 15,
  url: '/pr/acme/smp1900/1234',
  merge_number: 'M-1900-77',
  merge_number_state: 'assigned',
  merge_number_reason: null,
  merge_number_epoch: 3,
};

const PENDING_ROW = {
  ...ASSIGNED_ROW,
  pr_number: 1235,
  url: '/pr/acme/smp1900/1235',
  merge_seq: 1343,
  merge_number: null,
  merge_number_state: 'pending',
  merge_number_reason: 'predecessor_pending',
  merge_number_epoch: 3,
};

/** 커밋 행. M 키를 실어 보내도 **그리지 않는다** — 커밋에는 M 개념이 없다 (AC-1). */
const COMMIT_ROW = {
  ...ASSIGNED_ROW,
  kind: 'commit' as const,
  pr_number: undefined,
  commit_sha: 'a'.repeat(40),
  url: '/commit/acme/smp1900/aaa',
};

function listBody(items: readonly unknown[]): unknown {
  return { items, total: { value: items.length, relation: 'eq' }, next_cursor: null };
}

/** 응답을 고정한 `fetch`. 호출 URL을 기록해 실제 왕복 수를 센다. */
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

beforeEach(() => {
  params.current = new URLSearchParams();
  replaced.length = 0;
  pushed.length = 0;
  vi.spyOn(window.history, 'replaceState').mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

// ---------------------------------------------------------------- W-001 목록

describe('W-001 목록 — PR 번호 옆 M 배지 (AC-9)', () => {
  it('확정이면 표기 문자열과 네 key 링크를 함께 그린다', async () => {
    const calls = stubFetch(listBody([ASSIGNED_ROW]));
    params.current = new URLSearchParams('q=repo:acme/smp1900');
    const { container } = render(<SearchView loginPath="/auth/login" />);

    await waitFor(() => {
      expect(screen.getByTestId('mnumber-badge')).toHaveTextContent('M-1900-77');
    });

    const link = screen.getByTestId('mnumber-link');
    expect(link).toHaveAttribute(
      'href',
      '/search?m_repository=acme%2Fsmp1900&m_base_branch=main&m_seq_epoch=3&m_number=M-1900-77',
    );

    /*
     * 이 시험의 핵심이다 (ADR-023). 목록 한 화면에 왕복은 **하나**여야 한다 —
     * 행마다 resolve를 부르면 N번이 된다.
     */
    expect(calls.filter((url) => url.includes('/api/merge-numbers/resolve'))).toEqual([]);
    expect(calls).toHaveLength(1);
    expect(describeViolations(await violations(container))).toBe('');
  });

  it('대기면 사유를 접근 가능하게 말하고 **링크를 만들지 않는다**', async () => {
    stubFetch(listBody([PENDING_ROW]));
    params.current = new URLSearchParams('q=repo:acme/smp1900');
    const { container } = render(<SearchView loginPath="/auth/login" />);

    await waitFor(() => {
      expect(screen.getByTestId('mnumber-badge')).toHaveTextContent("M number pending");
    });
    expect(screen.queryByTestId('mnumber-link')).toBeNull();
    // 색과 짧은 문구만으로는 이유가 전달되지 않는다 — 설명이 함께 읽혀야 한다.
    expect(screen.getByText(/an earlier entry whose PR association is not confirmed/)).toBeInTheDocument();
    expect(describeViolations(await violations(container))).toBe('');
  });

  it('커밋 행에는 M 영역 자체가 없다 (AC-1)', async () => {
    stubFetch(listBody([COMMIT_ROW]));
    params.current = new URLSearchParams('q=repo:acme/smp1900');
    render(<SearchView loginPath="/auth/login" />);

    await waitFor(() => {
      expect(screen.getByTestId('result-row')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('mnumber-badge')).toBeNull();
  });

  it('M 키가 없는 응답(기능 off·구버전)에는 아무것도 그리지 않는다', async () => {
    const { merge_number, merge_number_state, merge_number_reason, merge_number_epoch, ...bare } = ASSIGNED_ROW;
    void merge_number;
    void merge_number_state;
    void merge_number_reason;
    void merge_number_epoch;
    stubFetch(listBody([bare]));
    params.current = new URLSearchParams('q=repo:acme/smp1900');
    render(<SearchView loginPath="/auth/login" />);

    await waitFor(() => {
      expect(screen.getByTestId('result-row')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('mnumber-badge')).toBeNull();
  });
});

// ---------------------------------------------------------------- 자동 재검증

describe('자동 재검증 — 현재 요청 하나를 5초 간격으로 (설계 9절)', () => {
  /*
   * 가짜 시계를 **render보다 먼저** 세운다.
   *
   * 뒤에 세우면 훅이 이미 진짜 `setInterval`로 타이머를 만든 뒤라 시간을 밀어도
   * tick이 돌지 않는다 — 시험이 조용히 아무것도 재지 않게 된다.
   */
  beforeEach(() => {
    vi.useFakeTimers();
  });

  /** 5초 tick을 n번 흘린다. 각 tick이 만든 요청의 응답 처리까지 기다린다. */
  async function tick(times: number): Promise<void> {
    for (let i = 0; i < times; i += 1) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5_000);
      });
    }
  }

  /** 첫 조회가 끝나고 재검증 창이 열릴 때까지 민다. */
  async function settle(): Promise<void> {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
  }

  it('대기 행이 있으면 tick마다 **같은 요청 하나**를 다시 보낸다', async () => {
    const calls = stubFetch(listBody([PENDING_ROW]));
    params.current = new URLSearchParams('q=repo:acme/smp1900');
    render(<SearchView loginPath="/auth/login" />);
    await settle();

    expect(screen.getByTestId('mnumber-badge')).toBeInTheDocument();
    expect(calls).toHaveLength(1);

    await tick(3);

    // 정확히 3번 더. **행 수와 무관하다** — 행별 poll이면 이 수가 행 수만큼 늘어난다.
    expect(calls).toHaveLength(4);
    expect(new Set(calls).size).toBe(1);
  });

  it('확정된 목록에는 재검증이 돌지 않는다', async () => {
    const calls = stubFetch(listBody([ASSIGNED_ROW]));
    params.current = new URLSearchParams('q=repo:acme/smp1900');
    render(<SearchView loginPath="/auth/login" />);
    await settle();

    expect(screen.getByTestId('mnumber-badge')).toBeInTheDocument();
    await tick(4);
    expect(calls).toHaveLength(1);
  });

  it('탭이 숨겨지면 보내지 않고, 다시 보이면 잇는다', async () => {
    const calls = stubFetch(listBody([PENDING_ROW]));
    params.current = new URLSearchParams('q=repo:acme/smp1900');
    render(<SearchView loginPath="/auth/login" />);
    await settle();
    expect(calls).toHaveLength(1);

    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      await vi.advanceTimersByTimeAsync(0);
    });
    await tick(3);
    expect(calls).toHaveLength(1);

    hidden.mockReturnValue(false);
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      await vi.advanceTimersByTimeAsync(0);
    });
    await tick(2);
    expect(calls).toHaveLength(3);
    hidden.mockRestore();
  });

  it('60초가 지나면 멈추고 수동 새로고침을 제시한다 — 잠정값을 대신 그리지 않는다', async () => {
    const calls = stubFetch(listBody([PENDING_ROW]));
    params.current = new URLSearchParams('q=repo:acme/smp1900');
    render(<SearchView loginPath="/auth/login" />);
    await settle();

    // 12번째 tick이 마감(60초)이다 — 그 tick은 요청을 보내지 않고 멈춘다.
    await tick(12);

    expect(screen.getByTestId('mnumber-poll-exhausted')).toBeInTheDocument();
    expect(calls).toHaveLength(12);

    // 더 밀어도 늘지 않는다.
    await tick(5);
    expect(calls).toHaveLength(12);

    // 번호는 여전히 대기다. 없는 값을 채우지 않았다.
    expect(screen.getByTestId('mnumber-badge')).toHaveTextContent("M number pending");
  });

  /**
   * 번호가 붙으면 **소진 표시도 사라진다** (`DEV-609`).
   *
   * 60초를 다 쓴 뒤 번호가 붙었는데 배너가 남으면, 화면이 번호를 보이면서 동시에
   * "아직 확정되지 않았습니다"라고 말한다. 그리고 다음 대기가 와도 재검증이 아예
   * 시작되지 않는다 — `active`가 소진 표시에 막힌다.
   */
  it('**대기가 끝나면 소진 배너가 사라진다** (DEV-609)', async () => {
    /** 처음에는 대기, 이후에는 확정으로 답하는 대역. */
    let assigned = false;
    const calls: string[] = [];
    vi.stubGlobal('fetch', (url: string) => {
      calls.push(url);
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(listBody([assigned ? ASSIGNED_ROW : PENDING_ROW])),
      } as Response);
    });

    params.current = new URLSearchParams('q=repo:acme/smp1900');
    render(<SearchView loginPath="/auth/login" />);
    await settle();

    await tick(12);
    expect(screen.getByTestId('mnumber-poll-exhausted')).toBeInTheDocument();

    /*
     * **"다시 확인"을 누르지 않는다.** 그 버튼은 `restart()`를 부르므로 소진 표시를
     * 어차피 지운다 — 그 경로로 확인하면 이 시험이 아무것도 증명하지 못한다.
     *
     * 여기서 보려는 것은 사용자가 아무것도 하지 않았는데 **다른 경로로 번호가 붙는**
     * 경우다. 목록이 어떤 이유로든 갱신되어 `pending`이 사라지면(탭 복귀, 다른
     * 상호작용이 부른 재조회) 대기가 끝난 것이고, 배너는 그 사실을 따라야 한다.
     */
    assigned = true;
    document.dispatchEvent(new Event('visibilitychange'));
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
      await vi.advanceTimersByTimeAsync(0);
    });

    // 화면이 여전히 대기를 보이고 배너도 서 있다 — 갱신이 일어나지 않았다.
    expect(screen.getByTestId('mnumber-poll-exhausted')).toBeInTheDocument();

    /*
     * 훅을 직접 본다. `pending`이 거짓이 되면 소진 표시가 지워져야 한다 — 화면이
     * 그것을 어떤 경로로 알게 되든 상관없다.
     */
    const { renderHook } = await import('@testing-library/react');
    const { usePendingRevalidation } = await import('../components/usePendingRevalidation');
    const { result, rerender } = renderHook(
      ({ pending }: { pending: boolean }) =>
        usePendingRevalidation({ sessionKey: 'k', pending, enabled: true, inFlight: false, onRevalidate: () => undefined }),
      { initialProps: { pending: true } },
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(result.current.exhausted, "Should be exhausted after 60 seconds").toBe(true);

    // 번호가 붙어 대기가 끝났다. **버튼을 누르지 않았다.**
    rerender({ pending: false });
    expect(result.current.exhausted, "The exhausted indicator remained after the wait ended").toBe(false);
  });

  it('**포커스를 빼앗지 않는다** — 재검증은 조용한 갱신이다', async () => {
    stubFetch(listBody([PENDING_ROW]));
    params.current = new URLSearchParams('q=repo:acme/smp1900');
    render(<SearchView loginPath="/auth/login" />);
    await settle();

    const target = screen.getByRole('searchbox');
    target.focus();
    expect(document.activeElement).toBe(target);

    await tick(2);
    expect(document.activeElement).toBe(target);
  });
});

// ---------------------------------------------------------------- W-002 상세

describe('W-002 상세 — 헤더 배지와 링크 복사 (AC-10)', () => {
  const PR = {
    repository: 'acme/smp1900',
    pr_number: 1234,
    title: 'feat: 결제 재시도',
    state: 'merged',
    author: 'kim',
    base_branch: 'main',
    head_branch: 'feat/retry',
    labels: ['backend'],
    reviewers: ['lee'],
    approved_by: ['lee'],
    created_at: '2026-08-18T09:00:00Z',
    merged_at: '2026-08-19T05:02:11Z',
    changed_files_count: 2,
    additions: 120,
    deletions: 15,
    merge_commit_sha: 'a'.repeat(40),
    source_commits: [{ commit_sha: 'b'.repeat(40) }],
    source_commits_truncated: false,
    source_commits_total: 1,
    merge_seq: 1342,
    seq_epoch: 3,
    sequence_space: 'acme/smp1900@main',
    merge_number: 'M-1900-77',
    merge_number_state: 'assigned',
    merge_number_reason: null,
    merge_number_epoch: 3,
  };

  it('헤더에 배지가 서고 복사가 **네 key의 절대 URL**을 쓴다', async () => {
    stubFetch(PR);
    const written: string[] = [];
    vi.stubGlobal('navigator', {
      ...navigator,
      clipboard: {
        writeText: (text: string) => {
          written.push(text);
          return Promise.resolve();
        },
      },
    });

    const { container } = render(
      <PrDetailView repository="acme/smp1900" prNumber={1234} loginPath="/auth/login" />,
    );
    await waitFor(() => {
      expect(screen.getByTestId('mnumber-badge')).toHaveTextContent('M-1900-77');
    });

    await userEvent.click(screen.getByTestId('mnumber-copy'));
    await waitFor(() => {
      expect(screen.getByTestId('mnumber-copy-status')).toHaveTextContent("M-number link copied.");
    });

    // 상대 경로를 붙여넣으면 채팅에서 링크가 되지 않는다 — 절대 URL이어야 한다.
    expect(written).toHaveLength(1);
    expect(written[0]).toContain('m_repository=acme%2Fsmp1900');
    expect(written[0]).toContain('m_number=M-1900-77');
    expect(written[0]?.startsWith('http')).toBe(true);
    expect(describeViolations(await violations(container))).toBe('');
  });

  it('대기 상태에는 복사 단추가 없다 — 만들 링크가 없다', async () => {
    stubFetch({ ...PR, merge_number: null, merge_number_state: 'pending', merge_number_reason: 'pr_evidence_pending' });
    render(<PrDetailView repository="acme/smp1900" prNumber={1234} loginPath="/auth/login" />);

    await waitFor(() => {
      expect(screen.getByTestId('mnumber-badge')).toHaveTextContent("M number pending");
    });
    expect(screen.queryByTestId('mnumber-copy')).toBeNull();
  });

  it('저장소 코드를 못 정하면 그 사실을 말한다 — 번호를 지어내지 않는다', async () => {
    stubFetch({
      ...PR,
      repository: 'acme/pay19svc20',
      merge_number: null,
      merge_number_state: 'unavailable',
      merge_number_reason: 'repository_code_unavailable',
    });
    render(<PrDetailView repository="acme/pay19svc20" prNumber={1234} loginPath="/auth/login" />);

    await waitFor(() => {
      expect(screen.getByTestId('mnumber-badge')).toHaveTextContent("Repository code needs verification");
    });
    expect(screen.queryByTestId('mnumber-link')).toBeNull();
  });
});

// ---------------------------------------------------------------- W-004 범위

describe('W-004 범위 — 행 병기만 한다 (설계 9절)', () => {
  const ITEMS = judgeItems({
    items: [
      {
        merge_seq: 1342,
        kind: 'pull_request',
        pr_number: 1234,
        commit_sha: 'a'.repeat(40),
        title: 'feat: 결제 재시도',
        author: 'kim',
        merged_at: '2026-08-19T05:02:11Z',
        indexed: true,
        merge_number: 'M-1900-77',
        merge_number_state: 'assigned',
        merge_number_reason: null,
        merge_number_epoch: 3,
      },
      {
        merge_seq: 1343,
        kind: 'commit',
        pr_number: null,
        commit_sha: 'b'.repeat(40),
        title: null,
        author: null,
        merged_at: null,
        indexed: true,
      },
    ],
  });

  it('PR 행에만 배지가 서고 커밋 행에는 서지 않는다', async () => {
    const { container } = render(
      <RangeResultTable repository="acme/smp1900" baseBranch="main" items={ITEMS} missingInIndex={0} />,
    );

    const rows = screen.getAllByTestId('range-row');
    expect(rows).toHaveLength(2);
    expect(within(rows[0] as HTMLElement).getByTestId('mnumber-badge')).toHaveTextContent('M-1900-77');
    expect(within(rows[1] as HTMLElement).queryByTestId('mnumber-badge')).toBeNull();
    expect(describeViolations(await violations(container))).toBe('');
  });

  it('구간 이동의 입력은 그대로 `merge_seq`다 — 배지가 seq 칸을 바꾸지 않는다', () => {
    render(<RangeResultTable repository="acme/smp1900" baseBranch="main" items={ITEMS} missingInIndex={0} />);
    const cells = within(screen.getAllByTestId('range-row')[0] as HTMLElement).getAllByRole('cell');
    expect(cells[0]).toHaveTextContent('1342');
  });
});

// ---------------------------------------------------------------- M 해석 진입

describe('`/search` M 해석 진입 — 화면을 늘리지 않는다 (CR-079)', () => {
  const ENTRY = 'm_repository=acme%2Fsmp1900&m_base_branch=main&m_seq_epoch=3&m_number=M-1900-77';

  it('네 key가 오면 resolve를 **정확히 1회** 부르고 상세로 옮긴다', async () => {
    const calls = stubFetch({
      sequence_space: 'acme/smp1900@main',
      seq_epoch: 3,
      sequence_state: 'ok',
      epoch_stale: false,
      pr_number: 1234,
      merge_seq: 1342,
      merge_number: 'M-1900-77',
      merge_number_state: 'assigned',
      merge_number_reason: null,
      merge_number_epoch: 3,
    });
    params.current = new URLSearchParams(`${ENTRY}&q=repo%3Aacme%2Fsmp1900`);
    const { container } = render(<SearchView loginPath="/auth/login" />);

    await waitFor(() => {
      expect(replaced).toHaveLength(1);
    });
    expect(replaced[0]).toBe('/pr/acme/smp1900/1234?from_q=repo%3Aacme%2Fsmp1900');

    // 보통의 검색은 부르지 않는다 — 여기는 경유지다.
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('/api/merge-numbers/resolve');
    expect(calls[0]).toContain('merge_number=M-1900-77');
    expect(describeViolations(await violations(container))).toBe('');
  });

  it('키가 일부만 오면 **임의 branch·epoch로 메우지 않고** 무엇이 빠졌는지 말한다', async () => {
    const calls = stubFetch({});
    params.current = new URLSearchParams('m_repository=acme%2Fsmp1900&m_number=M-1900-77');
    const { container } = render(<SearchView loginPath="/auth/login" />);

    await waitFor(() => {
      expect(screen.getByTestId('search-view')).toHaveAttribute('data-screen-state', 'merge_number_entry');
    });
    expect(screen.getByText(/Base branch/)).toBeInTheDocument();
    expect(screen.getByText(/sequence epoch/)).toBeInTheDocument();

    // 서버를 부르지 않는다. 부르면 사용자가 묻지 않은 공간의 답이 나온다.
    await waitFor(() => {
      expect(calls).toEqual([]);
    });
    expect(describeViolations(await violations(container))).toBe('');
  });

  it('기능이 꺼진 배포에서는 404를 알리고 기존 검색 링크를 준다', async () => {
    stubFetch({ error: { code: 'NOT_FOUND', detail: { reason: 'feature_disabled' } } }, { status: 404 });
    params.current = new URLSearchParams(ENTRY);
    const { container } = render(<SearchView loginPath="/auth/login" />);

    await waitFor(() => {
      expect(screen.getByTestId('search-view')).toHaveAttribute('data-screen-state', 'merge_number_entry');
    });
    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Go to search' })).toBeInTheDocument();
    });
    expect(replaced).toEqual([]);
    expect(describeViolations(await violations(container))).toBe('');
  });
});
