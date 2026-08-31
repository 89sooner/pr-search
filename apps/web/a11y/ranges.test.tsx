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

/** 표식 응답 하나 (WP-041 / API-SEQ-004). */
const MARKER_OK = {
  sequence_space: 'acme/payments@main',
  seq_epoch: 3,
  marker: {
    merge_seq: 4,
    seq_epoch: 3,
    note: '결제 회귀 통과',
    created_by: 'kim',
    created_at: '2026-08-14T09:12:44Z',
    epoch_stale: false,
  },
  correlation_id: 'm',
};

interface StubRoute {
  readonly resolve?: (payload: { position: 'from' | 'to'; expression: string }) => { status: number; body: unknown };
  readonly range?: { status: number; body: unknown };
  readonly marker?: { status: number; body: unknown };
  readonly markerPut?: { status: number; body: unknown };
}

/** URL별 응답 라우터. `calls`가 실제 네트워크 계수의 근거다 (QA-W004-21). */
function stubFetch(routes: StubRoute = {}): string[] {
  const calls: string[] = [];
  vi.stubGlobal('fetch', (url: string, init?: { body?: string; method?: string }) => {
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
    } else if (url.includes('/api/safe-markers')) {
      // `PUT`과 `GET`을 가른다 — 등록 뒤 다시 읽는 경로가 둘을 함께 쓴다.
      const isWrite = init?.method === 'PUT';
      status = (isWrite ? routes.markerPut?.status : routes.marker?.status) ?? 200;
      body = (isWrite ? routes.markerPut?.body : routes.marker?.body) ?? MARKER_OK;
    }
    return Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) } as Response);
  });
  return calls;
}

function view(
  query = 'repo=acme%2Fpayments&branch=main',
  session: { roles?: readonly string[]; authEnabled?: boolean } = {},
): ReturnType<typeof render> {
  params.current = new URLSearchParams(query);
  return render(
    <RangesView
      loginPath="/auth/login"
      roles={session.roles ?? ['developer', 'release_manager']}
      authEnabled={session.authEnabled ?? true}
    />,
  );
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

/**
 * 안전 구간 표식 (WP-041 / FR-SEQ-006, C-031).
 *
 * `QA-W004-12`~`14`를 여기서 증명한다. 판정 자체는 `lib/safe-marker.test.ts`가
 * 걸었고, 여기서는 **그 판정이 실제로 그려지는가**와 **막힌 버튼이 사유를
 * 말하는가**를 본다.
 */
describe('안전 구간 표식 (QA-W004-12·13·14)', () => {
  const SPACE = 'repo=acme%2Fpayments&branch=main';

  it('QA-W004-13: 시퀀스·등록자·시각·메모·에폭이 표시된다', async () => {
    stubFetch();
    view(SPACE);
    await waitFor(() => {
      expect(screen.getByTestId('safe-marker-card')).toBeInTheDocument();
    });
    expect(screen.getByTestId('safe-marker-seq')).toHaveTextContent('seq 4');
    expect(screen.getByTestId('safe-marker-author')).toHaveTextContent('kim');
    expect(screen.getByTestId('safe-marker-epoch')).toHaveTextContent('3');
    expect(screen.getByTestId('safe-marker-note')).toHaveTextContent('결제 회귀 통과');
    expect(screen.getByTestId('safe-marker-time')).not.toBeEmptyDOMElement();
  });

  it('QA-W004-12: `release_manager`가 아니면 등록이 사유와 함께 막힌다', async () => {
    stubFetch();
    view(SPACE, { roles: ['developer'] });
    await waitFor(() => {
      expect(screen.getByTestId('safe-marker-card')).toBeInTheDocument();
    });
    expect(screen.getByTestId('safe-marker-blocked')).toHaveTextContent('release_manager');
    expect(screen.getByTestId('safe-marker-submit')).toBeDisabled();
  });

  it('QA-W004-12: **표식 자체는 그 사용자에게도 보인다** — 막히는 것은 쓰기뿐이다', async () => {
    stubFetch();
    view(SPACE, { roles: ['developer'] });
    await waitFor(() => {
      expect(screen.getByTestId('safe-marker-seq')).toHaveTextContent('seq 4');
    });
  });

  it('인증이 구성되지 않은 배포에서는 빈 역할을 "자격 없음"으로 읽지 않는다', async () => {
    stubFetch();
    // 앵커까지 주어 **역할 말고는 막을 것이 없는 상태**를 만든다.
    view(`${SPACE}&from=seq%3A2&to=seq%3A5`, { roles: [], authEnabled: false });
    await waitFor(() => {
      expect(screen.getByTestId('safe-marker-submit')).toHaveTextContent('seq 5');
    });
    expect(screen.queryByTestId('safe-marker-blocked')).toBeNull();
  });

  it('인증이 구성된 배포에서 빈 역할은 막힌다 — 완화는 미구성 배포에만 적용된다', async () => {
    stubFetch();
    view(`${SPACE}&from=seq%3A2&to=seq%3A5`, { roles: [], authEnabled: true });
    await waitFor(() => {
      expect(screen.getByTestId('safe-marker-blocked')).toHaveTextContent('release_manager');
    });
  });

  it('QA-W004-14: 에폭이 다르면 무효로 표시하고 **감추지 않는다**', async () => {
    stubFetch({
      marker: {
        status: 200,
        body: {
          sequence_space: 'acme/payments@main',
          seq_epoch: 5,
          marker: {
            merge_seq: 4,
            seq_epoch: 3,
            note: null,
            created_by: 'kim',
            created_at: '2026-08-14T09:12:44Z',
            epoch_stale: true,
          },
          correlation_id: 'm',
        },
      },
    });
    view(SPACE);
    await waitFor(() => {
      expect(screen.getByTestId('safe-marker-stale')).toBeInTheDocument();
    });
    // 저장된 에폭이 그대로 보인다 — 현재 값으로 갈아 끼우면 무효가 사라진다.
    expect(screen.getByTestId('safe-marker-epoch')).toHaveTextContent('3');
    expect(screen.getByTestId('safe-marker-stale')).toHaveTextContent('무효');
  });

  it('끝 앵커가 없으면 등록이 사유와 함께 막힌다 (`marker_target_unresolved`)', async () => {
    stubFetch();
    view(SPACE);
    await waitFor(() => {
      expect(screen.getByTestId('safe-marker-card')).toBeInTheDocument();
    });
    expect(screen.getByTestId('safe-marker-blocked')).toHaveTextContent('끝 앵커');
  });

  it('끝 앵커가 해석되면 그 서수를 대상으로 삼는다 (DEV-462)', async () => {
    stubFetch();
    view(`${SPACE}&from=seq%3A2&to=seq%3A5`);
    await waitFor(() => {
      expect(screen.getByTestId('safe-marker-submit')).toHaveTextContent('seq 5');
    });
    expect(screen.queryByTestId('safe-marker-blocked')).toBeNull();
  });

  it('**본 표식을 `expected_marker_seq`로 함께 보낸다** (DEV-464)', async () => {
    const bodies: string[] = [];
    vi.stubGlobal('fetch', (url: string, init?: { body?: string; method?: string }) => {
      if (init?.method === 'PUT') bodies.push(init.body ?? '');
      const body = url.includes('/api/sequence-spaces')
        ? SPACES
        : url.includes('/api/sequence-anchors/resolve')
          ? resolvedBody('to', 'seq:5', 5)
          : url.includes('/api/safe-markers')
            ? init?.method === 'PUT'
              ? { ...MARKER_OK, outcome: 'created', replaced_merge_seq: 4 }
              : MARKER_OK
            : RANGE_OK;
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) } as Response);
    });

    view(`${SPACE}&from=seq%3A2&to=seq%3A5`);
    await waitFor(() => {
      expect(screen.getByTestId('safe-marker-submit')).toHaveTextContent('seq 5');
    });
    await userEvent.click(screen.getByTestId('safe-marker-submit'));
    await waitFor(() => {
      expect(bodies).toHaveLength(1);
    });
    const sent = JSON.parse(bodies[0] ?? '{}') as Record<string, unknown>;
    expect(sent['expected_marker_seq']).toBe(4);
    expect(sent['merge_seq']).toBe(5);
  });

  it('충돌은 사유를 말하고 **자동으로 다시 보내지 않는다** (DEV-464)', async () => {
    let puts = 0;
    vi.stubGlobal('fetch', (url: string, init?: { body?: string; method?: string }) => {
      const isPut = init?.method === 'PUT';
      if (isPut) puts += 1;
      const body = url.includes('/api/sequence-spaces')
        ? SPACES
        : url.includes('/api/sequence-anchors/resolve')
          ? resolvedBody('to', 'seq:5', 5)
          : url.includes('/api/safe-markers')
            ? isPut
              ? {
                  error: {
                    code: 'SAFE_MARKER_CONFLICT',
                    message: '그 사이 다른 사람이 표식을 옮겼습니다',
                    detail: { current_marker_seq: 9, expected_marker_seq: 4 },
                  },
                  correlation_id: 'c',
                }
              : MARKER_OK
            : RANGE_OK;
      return Promise.resolve({
        ok: !isPut,
        status: isPut ? 409 : 200,
        json: () => Promise.resolve(body),
      } as Response);
    });

    view(`${SPACE}&from=seq%3A2&to=seq%3A5`);
    await waitFor(() => {
      expect(screen.getByTestId('safe-marker-submit')).toHaveTextContent('seq 5');
    });
    await userEvent.click(screen.getByTestId('safe-marker-submit'));
    await waitFor(() => {
      expect(screen.getByTestId('safe-marker-result')).toHaveTextContent('seq 9');
    });
    // 한 번만 보냈다. 자동 재시도는 남의 판정을 말없이 덮는 일이다.
    expect(puts).toBe(1);
  });

  it('표식 카드에 axe 위반이 없다 — 막힌 상태에서도', async () => {
    stubFetch();
    const { container } = view(SPACE, { roles: ['developer'] });
    await waitFor(() => {
      expect(screen.getByTestId('safe-marker-card')).toBeInTheDocument();
    });
    const found = await violations(container);
    expect(found, describeViolations(found)).toEqual([]);
  });
});
