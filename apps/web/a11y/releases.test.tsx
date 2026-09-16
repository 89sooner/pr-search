/**
 * W-005 릴리스 화면 (WP-026 DoD / 상태 매트릭스 W-005, QA-W005-*).
 *
 * 판정 자체는 `lib/release.test.ts`가 걸었다. 여기서 거는 것은 **그 판정이 실제로
 * 그려지는가**와, 이 화면이 지켜야 하는 두 가지다:
 *
 * - **다른 브랜치의 릴리스가 한 목록에 함께 보인다** — 그래야 QA-W005-03이 도달
 *   가능하다 (CR-030, DEV-158). 목록 요청에 `branch`가 실리면 그 상황이 사라진다.
 * - **없는 수를 지어내지 않는다** — 직전 없음은 0이 아니고, 릴리스 0건의 원인 둘은
 *   함께 안내하며, 저장소 개요(W-009)는 화면이 없어 링크하지 않는다 (DEV-159).
 */

import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

const params = { current: new URLSearchParams() };
const replaced: string[] = [];

vi.mock('next/navigation', () => ({
  usePathname: () => '/releases',
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

const { ReleasesView } = await import('../components/ReleasesView');

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
    { repository: 'acme/payments', base_branch: 'main', sequence_space: 'acme/payments@main', seq_epoch: 3, sequence_state: 'ok' },
    { repository: 'acme/payments', base_branch: 'release/2.4', sequence_space: 'acme/payments@release/2.4', seq_epoch: 1, sequence_state: 'ok' },
  ],
};

/** 다섯 행: main 셋(하나는 가장 이른 릴리스), 다른 브랜치 하나, 체인 밖 하나. */
const RELEASES = {
  repository: 'acme/payments',
  releases: [
    { tag_name: 'v1.2', commit_sha: 'a'.repeat(40), released_at: '2026-08-15T09:00:00Z', source: 'git_tag', base_branch: 'main', sequence_space: 'acme/payments@main', seq_epoch: 3, merge_seq: 6, previous_tag_name: 'v1.1', pull_request_count_since_previous: 1 },
    { tag_name: 'v1.1', commit_sha: 'b'.repeat(40), released_at: '2026-08-14T09:00:00Z', source: 'git_tag', base_branch: 'main', sequence_space: 'acme/payments@main', seq_epoch: 3, merge_seq: 5, previous_tag_name: 'v1.0', pull_request_count_since_previous: 2 },
    { tag_name: 'off-chain', commit_sha: 'f'.repeat(40), released_at: '2026-08-13T09:00:00Z', source: 'git_tag', base_branch: null, sequence_space: null, seq_epoch: null, merge_seq: null, previous_tag_name: null, pull_request_count_since_previous: null },
    { tag_name: 'r2.4.0', commit_sha: 'c'.repeat(40), released_at: '2026-08-12T09:00:00Z', source: 'git_tag', base_branch: 'release/2.4', sequence_space: 'acme/payments@release/2.4', seq_epoch: 1, merge_seq: 2, previous_tag_name: null, pull_request_count_since_previous: null },
    { tag_name: 'v1.0', commit_sha: 'd'.repeat(40), released_at: '2026-08-10T09:00:00Z', source: 'git_tag', base_branch: 'main', sequence_space: 'acme/payments@main', seq_epoch: 3, merge_seq: 2, previous_tag_name: null, pull_request_count_since_previous: null },
  ],
  reason: null,
  truncated: false,
  correlation_id: 'l',
};

function comparisonBody(fromSeq: number, toSeq: number, prCount: number): unknown {
  return {
    sequence_space: 'acme/payments@main',
    seq_epoch: 3,
    sequence_state: 'ok',
    epoch_stale: false,
    normalized_direction: `from=x(seq ${String(fromSeq)}) → to=y(seq ${String(toSeq)})`,
    unreleased: false,
    range: { from_seq: fromSeq, to_seq: toSeq, boundary: '(from, to]' },
    summary: {
      pull_request_count: prCount,
      commit_count: prCount,
      distinct_author_count: 2,
      changed_files_total: 9,
      additions_total: 120,
      deletions_total: 8,
      files_truncated_pull_request_count: 0,
      top_changed_paths: [{ path: 'src/pay', count: 2 }],
    },
    items: [],
    items_missing_in_index: 0,
    next_cursor: null,
    correlation_id: 'c',
  };
}

interface StubRoute {
  readonly releases?: { status: number; body: unknown };
  readonly comparison?: { status: number; body: unknown };
}

function stubFetch(routes: StubRoute = {}): string[] {
  const calls: string[] = [];
  vi.stubGlobal('fetch', (url: string) => {
    calls.push(url);
    let status = 200;
    let body: unknown = {};
    if (url.includes('/api/sequence-spaces')) {
      body = SPACES;
    } else if (url.includes('/api/releases')) {
      status = routes.releases?.status ?? 200;
      body = routes.releases?.body ?? RELEASES;
    } else if (url.includes('/api/release-comparisons')) {
      status = routes.comparison?.status ?? 200;
      body =
        routes.comparison?.body ??
        (url.includes('to=unreleased') ? comparisonBody(6, 8, 2) : comparisonBody(5, 6, 1));
    }
    return Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) } as Response);
  });
  return calls;
}

function view(query = 'repo=acme%2Fpayments&branch=main'): ReturnType<typeof render> {
  params.current = new URLSearchParams(query);
  return render(<ReleasesView loginPath="/auth/login" />);
}

async function waitForRows(): Promise<HTMLElement[]> {
  await waitFor(() => {
    expect(screen.getAllByTestId('release-row').length).toBeGreaterThan(0);
  });
  return screen.getAllByTestId('release-row');
}

function rowOf(tagName: string): HTMLElement {
  const row = screen
    .getAllByTestId('release-row')
    .find((candidate) => within(candidate).queryByText(tagName) !== null);
  if (row === undefined) throw new Error(`행을 찾지 못했다: ${tagName}`);
  return row;
}

async function check(tagName: string): Promise<void> {
  await userEvent.click(within(rowOf(tagName)).getByRole('checkbox'));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  replaced.length = 0;
});

describe('목록은 저장소 전체다 (CR-030, DEV-158)', () => {
  it('**요청에 브랜치를 싣지 않는다** — 실으면 AC-3 상황이 만들어지지 않는다', async () => {
    const calls = stubFetch();
    view();
    await waitForRows();
    const listCall = calls.find((url) => url.includes('/api/releases'));
    expect(listCall).toBeDefined();
    expect(listCall).not.toContain('branch=');
  });

  it('다른 브랜치의 릴리스가 한 목록에 함께 보인다', async () => {
    stubFetch();
    view();
    await waitForRows();
    expect(within(rowOf('v1.2')).getByText('main')).toBeInTheDocument();
    expect(within(rowOf('r2.4.0')).getByText('release/2.4')).toBeInTheDocument();
  });

  it('서버가 준 순서를 바꾸지 않는다 (시각 내림차순)', async () => {
    stubFetch();
    view();
    const rows = await waitForRows();
    const tags = rows.map((row) => within(row).getByTestId('release-select').textContent);
    expect(tags).toEqual(['v1.2', 'v1.1', 'off-chain', 'r2.4.0', 'v1.0']);
  });
});

describe('비교 선택 (QA-W005-01·02·03)', () => {
  it('2건을 고르면 구간 비교가 활성화된다 (QA-W005-01)', async () => {
    stubFetch();
    view();
    await waitForRows();
    expect(screen.queryByTestId('compare-link')).not.toBeInTheDocument();
    await check('v1.0');
    await check('v1.2');
    expect(screen.getByTestId('compare-link')).toBeInTheDocument();
  });

  it('고른 순서와 무관하게 서수가 작은 쪽이 시작이다 (QA-W005-02, AC-4)', async () => {
    stubFetch();
    view();
    await waitForRows();
    // 목록이 시각 내림차순이라 최신(v1.2)을 먼저 누르는 것이 자연스럽다.
    await check('v1.2');
    await check('v1.0');
    expect(screen.getByTestId('compare-direction')).toHaveTextContent('v1.0');
    expect(screen.getByTestId('compare-link')).toHaveAttribute(
      'href',
      '/ranges?repo=acme%2Fpayments&branch=main&from=v1.0&to=v1.2&epoch=3',
    );
  });

  it('다른 브랜치 2건은 이동 전에 막고 사유를 보인다 (QA-W005-03, AC-3)', async () => {
    stubFetch();
    view();
    await waitForRows();
    await check('v1.2');
    await check('r2.4.0');
    expect(screen.queryByTestId('compare-link')).not.toBeInTheDocument();
    // 경고 배너는 `status`다 — Conductor는 `danger`에만 `alert`을 준다.
    const blocked = screen.getByRole('status');
    expect(blocked).toHaveTextContent("Cannot compare releases from different base branches");
    expect(blocked).toHaveTextContent('release/2.4');
  });

  it('서수 없는 릴리스는 보이되 고를 수 없다 (DEV-158)', async () => {
    stubFetch();
    view();
    await waitForRows();
    const off = rowOf('off-chain');
    expect(within(off).getByTestId('release-no-seq')).toBeInTheDocument();
    expect(within(off).getByRole('checkbox')).toBeDisabled();
    expect(within(off).getByTestId('release-select-note')).toHaveTextContent("without an ordinal");
  });

  it('상한 2건에 닿으면 미선택 행만 비활성되고 사유가 붙는다', async () => {
    stubFetch();
    view();
    await waitForRows();
    await check('v1.2');
    await check('v1.1');
    const third = within(rowOf('v1.0')).getByRole('checkbox');
    expect(third).toBeDisabled();
    expect(within(rowOf('v1.0')).getByTestId('release-select-note')).toHaveTextContent("up to two releases");
    // 이미 고른 것은 해제할 수 있어야 한다 — 안 그러면 선택을 되돌릴 수 없다.
    expect(within(rowOf('v1.2')).getByRole('checkbox')).not.toBeDisabled();
  });
});

describe('직전 대비 표기 (QA-W005-06, DEV-155)', () => {
  it('무엇과 비교한 수인지 함께 말한다', async () => {
    stubFetch();
    view();
    await waitForRows();
    expect(within(rowOf('v1.1')).getByTestId('release-previous')).toHaveTextContent("v1.0 — PRs added: 2");
  });

  it('직전이 없으면 0이 아니라 없음이다', async () => {
    stubFetch();
    view();
    await waitForRows();
    const label = within(rowOf('v1.0')).getByTestId('release-previous');
    expect(label).toHaveTextContent("No previous release");
    expect(label).not.toHaveTextContent("0");
  });
});

describe('릴리스 상세', () => {
  it('태그를 누르면 직전 대비 요약이 뜨고 되돌림은 준비 중이다 (DEV-150)', async () => {
    stubFetch();
    view();
    await waitForRows();
    await userEvent.click(within(rowOf('v1.2')).getByTestId('release-select'));
    await waitFor(() => {
      expect(screen.getByTestId('range-summary')).toBeInTheDocument();
    });
    expect(screen.getByTestId('detail-heading')).toHaveTextContent("compared with previous release (v1.1)");
    expect(screen.getByTestId('range-summary')).toHaveTextContent("Pending — relationship derivation");
  });

  it('**행의 공간으로 묻는다** — 셀렉터의 브랜치로 고정하지 않는다', async () => {
    /*
     * 목록이 저장소 스코프라 `release/2.4` 행이 함께 있다. 셀렉터(main)의 브랜치로
     * 상세를 물으면 서버가 두 태그를 다른 공간에서 풀어 SEQUENCE_SPACE_MISMATCH를
     * 낸다 — 화면이 스스로 만든 조합을 스스로 거절하는 꼴이다.
     */
    const calls = stubFetch({
      releases: {
        status: 200,
        body: {
          ...RELEASES,
          releases: RELEASES.releases.map((r) =>
            r.tag_name === 'r2.4.0' ? { ...r, previous_tag_name: 'r2.3.0', pull_request_count_since_previous: 4 } : r,
          ),
        },
      },
    });
    view();
    await waitForRows();
    await userEvent.click(within(rowOf('r2.4.0')).getByTestId('release-select'));
    await waitFor(() => {
      expect(calls.some((url) => url.includes('/api/release-comparisons') && url.includes('from=r2.3.0'))).toBe(true);
    });
    const detailCall = calls.find((url) => url.includes('from=r2.3.0'));
    expect(detailCall).toContain('base_branch=release%2F2.4');
    expect(detailCall).not.toContain('base_branch=main');
  });

  it('가장 이른 릴리스는 비교할 구간이 없다고 말한다 — 0으로 그리지 않는다', async () => {
    stubFetch();
    view();
    await waitForRows();
    await userEvent.click(within(rowOf('v1.0')).getByTestId('release-select'));
    expect(screen.getByTestId('detail-no-previous')).toHaveTextContent("No previous release exists for comparison.");
    expect(screen.queryByTestId('range-summary')).not.toBeInTheDocument();
  });
});

describe('미배포 구간 (QA-W005-04, AC-5)', () => {
  it('대기 수를 보이고 서수 앵커로 W-004에 넘긴다', async () => {
    stubFetch();
    view();
    await waitFor(() => {
      expect(screen.getByTestId('unreleased-summary')).toBeInTheDocument();
    });
    expect(screen.getByTestId('unreleased-summary')).toHaveTextContent("2");
    expect(screen.getByTestId('unreleased-link')).toHaveAttribute(
      'href',
      '/ranges?repo=acme%2Fpayments&branch=main&from=seq%3A6&to=seq%3A8&epoch=3',
    );
  });
});

describe('릴리스 0건 (QA-W005-05 절반, DEV-159)', () => {
  it('원인 둘을 함께 안내하고 W-009로 링크하지 않는다', async () => {
    stubFetch({ releases: { status: 200, body: { repository: 'acme/payments', releases: [], reason: 'release_not_indexed', truncated: false } } });
    const { container } = view();
    await waitFor(() => {
      expect(screen.getByText("No releases in this repository")).toBeInTheDocument();
    });
    // 원인 둘이 한 안내에 함께 있다 — 판별할 수 없는 것을 갈라 말하지 않는다.
    expect(screen.getByText(/No tags exist yet/)).toBeInTheDocument();
    expect(screen.getByText(/release ingestion has not reached/)).toBeInTheDocument();
    // W-009는 REL-004~005다 — 없는 경로로 보내지 않는다.
    expect(container.querySelector('a[href="/repositories"]')).toBeNull();
    expect(screen.queryByTestId('release-timeline')).not.toBeInTheDocument();
  });
});

describe('상태 렌더링과 접근성', () => {
  it('절삭을 말없이 넘기지 않는다', async () => {
    stubFetch({ releases: { status: 200, body: { ...RELEASES, truncated: true } } });
    view();
    await waitFor(() => {
      expect(screen.getByTestId('releases-truncated')).toBeInTheDocument();
    });
  });

  it('접근 범위 밖 저장소는 not_found로 그린다', async () => {
    stubFetch({ releases: { status: 404, body: { error: { code: 'NOT_FOUND', message: 'x' } } } });
    view();
    await waitFor(() => {
      expect(screen.getByText("Repository not found")).toBeInTheDocument();
    });
  });

  it('목록 조회 실패는 영향과 복구 경로를 함께 말한다', async () => {
    stubFetch({ releases: { status: 503, body: {} } });
    view();
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent("Unable to load releases");
    });
    expect(screen.getByRole('button', { name: "Try again" })).toBeInTheDocument();
  });

  it('**"다시 시도"가 실제로 다시 부른다**', async () => {
    // 같은 저장소로 상태만 새 객체로 바꾸면 효과가 다시 돌지 않는다 — 그 자리다.
    const calls = stubFetch({ releases: { status: 503, body: {} } });
    view();
    await waitFor(() => {
      expect(screen.getByTestId('releases-retry')).toBeInTheDocument();
    });
    const before = calls.filter((url) => url.includes('/api/releases')).length;
    await userEvent.click(screen.getByTestId('releases-retry'));
    await waitFor(() => {
      expect(calls.filter((url) => url.includes('/api/releases')).length).toBe(before + 1);
    });
  });

  it('공간이 없으면 무엇을 해야 하는지 말한다', async () => {
    stubFetch();
    view('');
    await waitFor(() => {
      expect(screen.getByText("Select a sequence space")).toBeInTheDocument();
    });
  });

  it('axe 위반 0건 — 목록과 비교 차단 상태', async () => {
    stubFetch();
    const { container } = view();
    await waitForRows();
    await check('v1.2');
    await check('r2.4.0');
    const found = await violations(container);
    expect(found, describeViolations(found)).toEqual([]);
  });

  it('axe 위반 0건 — 상세와 미배포가 함께 뜬 상태', async () => {
    stubFetch();
    const { container } = view();
    await waitForRows();
    await userEvent.click(within(rowOf('v1.2')).getByTestId('release-select'));
    await waitFor(() => {
      expect(screen.getByTestId('range-summary')).toBeInTheDocument();
    });
    const found = await violations(container);
    expect(found, describeViolations(found)).toEqual([]);
  });

  it('axe 위반 0건 — 릴리스 0건 상태', async () => {
    stubFetch({ releases: { status: 200, body: { repository: 'acme/payments', releases: [], reason: 'release_not_indexed', truncated: false } } });
    const { container } = view();
    await waitFor(() => {
      expect(screen.getByText("No releases in this repository")).toBeInTheDocument();
    });
    const found = await violations(container);
    expect(found, describeViolations(found)).toEqual([]);
  });
});
