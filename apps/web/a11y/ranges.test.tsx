/**
 * W-004 범위 조사 화면 (WP-025 DoD / 상태 매트릭스 W-004, QA-W004-*).
 *
 * DoD가 요구하는 둘: **도달 가능한 전 상태의 렌더링**(CR-029 DEV-151의 부분집합)과
 * **axe 위반 0건**. 판정 자체는 `lib/range.test.ts`가 걸었다 — 여기서는 그 판정이
 * 실제로 그려지는가, 그리고 **에폭 불일치가 자동 재조회로 새지 않는가**를
 * 실제 네트워크 계수로 건다 (QA-W004-21).
 */

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

const params = { current: new URLSearchParams() };
const replaced: string[] = [];

vi.mock('next/navigation', () => ({
  usePathname: () => '/ranges',
  useSearchParams: () => params.current,
  useRouter: () => ({
    replace: (href: string) => replaced.push(href),
    push: () => undefined,
  }),
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const { RangesView } = await import('../components/RangesView');

async function violations(container: HTMLElement): Promise<axe.Result[]> {
  const results = await axe.run(container, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
    rules: { 'color-contrast': { enabled: false } },
  });
  return results.violations;
}

const describeViolations = (list: axe.Result[]): string =>
  list.map((v) => `${v.id}: ${v.help} (${String(v.nodes.length)}곳)`).join('\n');

const SPACES = {
  spaces: [
    { repository: 'acme/ledger', base_branch: 'main', sequence_space: 'acme/ledger@main', seq_epoch: null, sequence_state: 'unknown' },
    { repository: 'acme/payments', base_branch: 'main', sequence_space: 'acme/payments@main', seq_epoch: 3, sequence_state: 'ok' },
  ],
};

function resolvedBody(position: 'from' | 'to', expression: string, mergeSeq: number): unknown {
  return {
    sequence_space: 'acme/payments@main',
    seq_epoch: 3,
    resolved: [
      {
        position,
        expression,
        kind: 'sequence',
        merge_seq: mergeSeq,
        commit_sha: `${String(mergeSeq).padStart(2, '0')}${'a'.repeat(38)}`,
        boundary: position === 'from' ? 'exclusive' : 'inclusive',
        occurred_at: '2026-08-12T00:00:00Z',
      },
    ],
    correlation_id: 'c',
  };
}

const RANGE_OK = {
  sequence_space: 'acme/payments@main',
  seq_epoch: 3,
  sequence_state: 'ok',
  epoch_stale: false,
  range: { from_seq: 2, to_seq: 5, boundary: '(from, to]' },
  summary: {
    pull_request_count: 3,
    commit_count: 3,
    distinct_author_count: 2,
    changed_files_total: 9,
    additions_total: 120,
    deletions_total: 8,
    files_truncated_pull_request_count: 0,
    top_changed_paths: [{ path: 'src/pay', count: 2 }],
  },
  items: [
    { merge_seq: 3, kind: 'pull_request', pr_number: 41, commit_sha: 'a'.repeat(40), title: '결제 재시도', author: 'kim', merged_at: '2026-08-12T00:00:00Z', changed_files_count: 3, additions: 40, deletions: 2, indexed: true },
    { merge_seq: 4, kind: 'commit', pr_number: null, commit_sha: 'b'.repeat(40), title: null, author: null, merged_at: null, changed_files_count: null, additions: null, deletions: null, indexed: false },
    { merge_seq: 5, kind: 'pull_request', pr_number: 43, commit_sha: 'c'.repeat(40), title: '세션 만료', author: 'lee', merged_at: '2026-08-13T00:00:00Z', changed_files_count: 2, additions: 30, deletions: 1, indexed: true },
  ],
  items_missing_in_index: 1,
  next_cursor: null,
  correlation_id: 'r',
};

interface StubRoute {
  readonly resolve?: (payload: { position: 'from' | 'to'; expression: string }) => { status: number; body: unknown };
  readonly range?: { status: number; body: unknown };
}

/** URL별 응답 라우터. `calls`가 실제 네트워크 계수의 근거다 (QA-W004-21). */
function stubFetch(routes: StubRoute = {}): string[] {
  const calls: string[] = [];
  vi.stubGlobal('fetch', (url: string, init?: { body?: string }) => {
    calls.push(url);
    let status = 200;
    let body: unknown = {};
    if (url.includes('/api/sequence-spaces')) {
      body = SPACES;
    } else if (url.includes('/api/sequence-anchors/resolve')) {
      const payload = JSON.parse(init?.body ?? '{}') as {
        anchors?: { position: 'from' | 'to'; expression: string }[];
      };
      const anchor = payload.anchors?.[0];
      if (anchor === undefined) {
        status = 400;
        body = { error: { code: 'INVALID_PARAMETER', message: '앵커 없음' }, correlation_id: 'x' };
      } else if (routes.resolve !== undefined) {
        const out = routes.resolve(anchor);
        status = out.status;
        body = out.body;
      } else {
        const seq = /^seq:(\d+)$/.exec(anchor.expression);
        body = resolvedBody(anchor.position, anchor.expression, seq === null ? 1 : Number(seq[1]));
      }
    } else if (url.includes('/api/sequence-ranges')) {
      status = routes.range?.status ?? 200;
      body = routes.range?.body ?? RANGE_OK;
    }
    return Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) } as Response);
  });
  return calls;
}

function view(query = 'repo=acme%2Fpayments&branch=main'): ReturnType<typeof render> {
  params.current = new URLSearchParams(query);
  return render(<RangesView loginPath="/auth/login" />);
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  replaced.length = 0;
});

async function typeAndCommit(id: 'from' | 'to', text: string): Promise<void> {
  const input = screen.getByTestId(`anchor-${id}-input`);
  await userEvent.clear(input);
  await userEvent.type(input, `${text}{Enter}`);
}

describe('반개구간 규칙 (QA-W004-01)', () => {
  it('**제외/포함 라벨과 구간 규칙이 조회 전부터 상시 보인다**', async () => {
    stubFetch();
    view();
    await waitFor(() => {
      expect(screen.getByTestId('space-selector')).toBeInTheDocument();
    });
    expect(screen.getByTestId('range-boundary-rule')).toHaveTextContent('(시작, 끝]');
    expect(screen.getByTestId('anchor-from-boundary')).toHaveTextContent('제외');
    expect(screen.getByTestId('anchor-to-boundary')).toHaveTextContent('포함');
  });
});

describe('앵커 정규화 표시 (QA-W004-04·05·06)', () => {
  it('정규화 결과에 원본 표현·서수·SHA·에폭 넷이 보인다 (AC-5)', async () => {
    stubFetch();
    view();
    await waitFor(() => {
      expect(screen.getByTestId('anchor-from-input')).toBeInTheDocument();
    });
    await typeAndCommit('from', 'seq:2');
    await waitFor(() => {
      expect(screen.getByTestId('anchor-from-resolved')).toBeInTheDocument();
    });
    const resolved = screen.getByTestId('anchor-from-resolved');
    expect(resolved).toHaveTextContent('seq:2');
    expect(resolved).toHaveTextContent('seq 2');
    expect(resolved).toHaveTextContent('02' + 'a'.repeat(10));
    expect(resolved).toHaveTextContent('에폭 3');
  });

  it('**체인 밖 커밋은 머지 커밋 제안 버튼이 붙는다** (QA-W004-05)', async () => {
    stubFetch({
      resolve: ({ expression }) =>
        expression.startsWith('feed')
          ? {
              status: 400,
              body: {
                error: {
                  code: 'ANCHOR_NOT_ON_BRANCH',
                  message: '체인 밖',
                  detail: { suggested_anchor: { commit_sha: 'f'.repeat(40) } },
                },
                correlation_id: 'x',
              },
            }
          : { status: 200, body: resolvedBody('to', expression, 5) },
    });
    view();
    await waitFor(() => {
      expect(screen.getByTestId('anchor-from-input')).toBeInTheDocument();
    });
    await typeAndCommit('from', `feed${'0'.repeat(36)}`);
    await waitFor(() => {
      expect(screen.getByTestId('anchor-from-error')).toBeInTheDocument();
    });
    await userEvent.click(screen.getByTestId('anchor-from-suggested'));
    // 제안 클릭은 입력을 머지 커밋으로 바꾼다 — 다음 확정에서 해석된다.
    expect(screen.getByTestId('anchor-from-input')).toHaveValue('f'.repeat(40));
  });

  it('미머지 PR은 `anchor_not_merged` 사유가 보인다 (QA-W004-06)', async () => {
    stubFetch({
      resolve: () => ({
        status: 400,
        body: { error: { code: 'ANCHOR_NOT_MERGED', message: '미머지' }, correlation_id: 'x' },
      }),
    });
    view();
    await waitFor(() => {
      expect(screen.getByTestId('anchor-from-input')).toBeInTheDocument();
    });
    await typeAndCommit('from', '#900');
    await waitFor(() => {
      expect(screen.getByTestId('anchor-from-error')).toHaveTextContent('머지되지 않은');
    });
  });
});

describe('조회 전 사전 판정 (QA-W004-07·08·09)', () => {
  it('**역전이면 조회가 비활성이고 교환 제안이 뜬다**', async () => {
    stubFetch();
    view();
    await waitFor(() => {
      expect(screen.getByTestId('anchor-from-input')).toBeInTheDocument();
    });
    await typeAndCommit('from', 'seq:10');
    await typeAndCommit('to', 'seq:3');
    await waitFor(() => {
      expect(screen.getByTestId('range-inverted')).toBeInTheDocument();
    });
    expect(screen.getByTestId('range-query')).toBeDisabled();

    await userEvent.click(screen.getByTestId('range-swap'));
    expect(screen.getByTestId('anchor-from-input')).toHaveValue('seq:3');
    expect(screen.getByTestId('anchor-to-input')).toHaveValue('seq:10');
    // 해석 상태도 함께 바뀌었으므로 조회가 살아난다.
    expect(screen.getByTestId('range-query')).toBeEnabled();
  });

  it('**5만 건 초과는 조회 전에 안내한다**', async () => {
    stubFetch();
    view();
    await waitFor(() => {
      expect(screen.getByTestId('anchor-from-input')).toBeInTheDocument();
    });
    await typeAndCommit('from', 'seq:1');
    await typeAndCommit('to', 'seq:60001');
    await waitFor(() => {
      expect(screen.getByTestId('range-too-large')).toBeInTheDocument();
    });
    expect(screen.getByTestId('range-query')).toBeDisabled();
  });
});

describe('조회와 결과 (QA-W004-10·11)', () => {
  async function queryReady(): Promise<string[]> {
    const calls = stubFetch();
    view();
    await waitFor(() => {
      expect(screen.getByTestId('anchor-from-input')).toBeInTheDocument();
    });
    await typeAndCommit('from', 'seq:2');
    await typeAndCommit('to', 'seq:5');
    await userEvent.click(screen.getByTestId('range-query'));
    await waitFor(() => {
      expect(screen.getByTestId('range-results')).toBeInTheDocument();
    });
    return calls;
  }

  it('**요약 넷이 보이고 되돌림 자리는 "준비 중"이다** (QA-W004-10 절반, DEV-150)', async () => {
    await queryReady();
    expect(screen.getByTestId('summary-pr-count')).toHaveTextContent('3건');
    expect(screen.getByTestId('summary-author-count')).toHaveTextContent('2명');
    expect(screen.getByTestId('summary-reverts-pending')).toHaveTextContent('준비 중');
  });

  it('**결과가 서버 순서 그대로이고 색인 대기 행이 표시된다** (QA-W004-11, DEV-130)', async () => {
    await queryReady();
    const rows = screen.getAllByTestId('range-row');
    expect(rows.map((row) => row.querySelector('td')?.textContent)).toEqual(['3', '4', '5']);
    expect(screen.getByTestId('range-row-unindexed')).toBeInTheDocument();
    expect(screen.getByTestId('range-missing-in-index')).toHaveTextContent('1건');
  });

  it('성공한 조회가 URL을 현재 에폭 인용으로 바꾼다', async () => {
    await queryReady();
    expect(replaced[replaced.length - 1]).toContain('epoch=3');
    expect(replaced[replaced.length - 1]).toContain('from=seq%3A2');
  });

  it('결과 행이 PR·커밋 상세로 간다 (FLOW-003 5단계)', async () => {
    await queryReady();
    const links = screen.getAllByTestId('range-row-link');
    expect(links[0]).toHaveAttribute('href', '/pr/acme/payments/41');
    expect(links[1]).toHaveAttribute('href', `/commit/acme/payments/${'b'.repeat(40)}`);
  });
});

describe('에폭 판정 (QA-W004-21)', () => {
  it('**URL 에폭이 낡으면 경고만 내고 자동 재조회하지 않는다**', async () => {
    const calls = stubFetch();
    view('repo=acme%2Fpayments&branch=main&epoch=2');
    await waitFor(() => {
      expect(screen.getByTestId('epoch-stale-banner')).toBeInTheDocument();
    });
    // 공간 목록 하나뿐 — 범위 조회가 자동으로 나가지 않았다.
    expect(calls.filter((url) => url.includes('/api/sequence-ranges'))).toHaveLength(0);
  });

  it('서버가 낡음을 판정하면 결과 없이 재조회 액션이 뜬다', async () => {
    stubFetch({
      range: {
        status: 200,
        body: {
          sequence_space: 'acme/payments@main',
          seq_epoch: 3,
          sequence_state: 'ok',
          epoch_stale: true,
          requested_seq_epoch: 2,
          correlation_id: 'r',
        },
      },
    });
    view('repo=acme%2Fpayments&branch=main&from=seq%3A2&to=seq%3A5&epoch=2');
    await waitFor(() => {
      expect(screen.getByTestId('range-query')).toBeEnabled();
    });
    await userEvent.click(screen.getByTestId('range-query'));
    await waitFor(() => {
      expect(screen.getByTestId('epoch-stale-result')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('range-results')).toBeNull();
    expect(screen.getByTestId('requery-current-epoch')).toBeInTheDocument();
  });
});

describe('재채번·서버 오류 상태 (QA-W004-22, 상태 매트릭스)', () => {
  it('**재채번 중이면 마지막 확정 값과 배너가 함께 보인다**', async () => {
    stubFetch({ range: { status: 200, body: { ...RANGE_OK, sequence_state: 'reassigning' } } });
    view('repo=acme%2Fpayments&branch=main&from=seq%3A2&to=seq%3A5');
    await waitFor(() => {
      expect(screen.getByTestId('range-query')).toBeEnabled();
    });
    await userEvent.click(screen.getByTestId('range-query'));
    await waitFor(() => {
      expect(screen.getByTestId('reassigning-banner')).toBeInTheDocument();
    });
    // 배너가 결과를 대체하지 않는다 — 마지막 확정 값이 함께 있다.
    expect(screen.getByTestId('range-results')).toBeInTheDocument();
  });

  it('서버 RANGE_TOO_LARGE는 오류 배너로 온다 — 이중 방어의 서버 절반', async () => {
    stubFetch({
      range: {
        status: 400,
        body: {
          error: { code: 'RANGE_TOO_LARGE', message: '구간이 50,000건을 넘습니다' },
          correlation_id: 'r',
        },
      },
    });
    view('repo=acme%2Fpayments&branch=main&from=seq%3A2&to=seq%3A5');
    await waitFor(() => {
      expect(screen.getByTestId('range-query')).toBeEnabled();
    });
    await userEvent.click(screen.getByTestId('range-query'));
    await waitFor(() => {
      expect(screen.getByText(/RANGE_TOO_LARGE/)).toBeInTheDocument();
    });
  });
});

describe('빈 상태와 공간 선택', () => {
  it('앵커가 없으면 `empty_no_anchor` 안내가 보인다', async () => {
    stubFetch();
    view('');
    await waitFor(() => {
      expect(screen.getByTestId('range-empty')).toBeInTheDocument();
    });
  });

  it('채번 이력 없는 공간은 상태 배지가 말한다 — 숨기지 않는다', async () => {
    stubFetch();
    view('repo=acme%2Fledger&branch=main');
    await waitFor(() => {
      expect(screen.getByTestId('space-state')).toHaveTextContent('채번 이력 없음');
    });
    expect(screen.getByTestId('space-epoch-none')).toBeInTheDocument();
  });
});

describe('접근성 (DoD: axe 위반 0건)', () => {
  it('결과 화면에 axe 위반이 없다', async () => {
    stubFetch();
    const { container } = view('repo=acme%2Fpayments&branch=main&from=seq%3A2&to=seq%3A5');
    await waitFor(() => {
      expect(screen.getByTestId('range-query')).toBeEnabled();
    });
    await userEvent.click(screen.getByTestId('range-query'));
    await waitFor(() => {
      expect(screen.getByTestId('range-results')).toBeInTheDocument();
    });
    const found = await violations(container);
    expect(found, describeViolations(found)).toEqual([]);
  });

  it('오류·경고 상태에도 axe 위반이 없다', async () => {
    stubFetch();
    const { container } = view('repo=acme%2Fpayments&branch=main&epoch=2');
    await waitFor(() => {
      expect(screen.getByTestId('epoch-stale-banner')).toBeInTheDocument();
    });
    const found = await violations(container);
    expect(found, describeViolations(found)).toEqual([]);
  });
});
