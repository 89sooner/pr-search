/**
 * W-002 PR 상세 (WP-017 DoD / FR-SRCH-003, QA-W002-*).
 *
 * 판정은 `lib/pr-detail.test.ts`가 34건으로 이미 걸었다. 여기서 거는 것은
 * **그 판정이 실제로 그려지는가**와 접근성이다.
 */

import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

vi.mock('next/navigation', () => ({ usePathname: () => '/pr/acme/payments/1234' }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

const { PrDetailView } = await import('../components/PrDetailView');
const { PendingSection } = await import('../components/PendingSection');

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

const PR = {
  repository: 'acme/payments',
  pr_number: 1234,
  title: 'feat: 결제 재시도',
  state: 'merged',
  author: 'kim',
  base_branch: 'main',
  head_branch: 'feat/retry',
  labels: ['backend'],
  reviewers: ['lee', 'park'],
  approved_by: ['lee'],
  created_at: '2026-08-18T09:00:00Z',
  first_review_at: '2026-08-18T11:30:00Z',
  merged_at: '2026-08-19T05:02:11Z',
  lead_time_seconds: 72_000,
  first_review_wait_seconds: 9_000,
  changed_files_count: 2,
  additions: 120,
  deletions: 15,
  merge_commit_sha: 'a'.repeat(40),
  source_commits: [{ commit_sha: 'b'.repeat(40) }, { commit_sha: 'c'.repeat(40) }],
  source_commits_truncated: false,
  source_commits_total: 2,
  merge_seq: null,
  seq_epoch: null,
  sequence_space: null,
};

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

/** 이웃 응답. 서수 3은 **PR 없는 직접 푸시**다 — 그 행이 빠지면 서수가 건너뛴다. */
const NEIGHBORS = {
  sequence_space: 'acme/payments@main',
  seq_epoch: 3,
  sequence_state: 'ok',
  epoch_stale: false,
  anchor: { merge_seq: 4, kind: 'pull_request', pr_number: 1234, commit_sha: 'a'.repeat(40) },
  items: [
    { merge_seq: 3, kind: 'commit', commit_sha: 'e'.repeat(40), pr_number: null, title: null, author: null, merged_at: '2026-08-18T00:00:00Z', is_anchor: false, indexed: false, url: '/commit/acme/payments/eee' },
    { merge_seq: 4, kind: 'pull_request', commit_sha: 'a'.repeat(40), pr_number: 1234, title: 'feat: 결제 재시도', author: 'kim', merged_at: '2026-08-19T05:02:11Z', is_anchor: true, indexed: true, url: '/pr/acme/payments/1234' },
    { merge_seq: 5, kind: 'pull_request', commit_sha: 'f'.repeat(40), pr_number: 1240, title: 'fix: 세션', author: 'park', merged_at: '2026-08-19T06:00:00Z', is_anchor: false, indexed: true, url: '/pr/acme/payments/1240' },
  ],
  boundary: { at_start: false, at_end: true },
  correlation_id: 'n',
};

/** PR 문서와 이웃을 URL로 가리는 대역. 이웃 응답과 상태를 시험이 정한다. */
function stubWithNeighbors(
  pr: unknown,
  neighbors: { status?: number; body?: unknown } = {},
): string[] {
  const calls: string[] = [];
  vi.stubGlobal('fetch', (url: string) => {
    calls.push(url);
    const isNeighbors = url.includes('/api/sequence-neighbors');
    const status = isNeighbors ? (neighbors.status ?? 200) : 200;
    const body = isNeighbors ? (neighbors.body ?? NEIGHBORS) : pr;
    return Promise.resolve({
      ok: status < 400,
      status,
      json: () => Promise.resolve(body),
    } as Response);
  });
  return calls;
}

function view(props: Partial<Parameters<typeof PrDetailView>[0]> = {}): ReturnType<typeof render> {
  return render(
    <PrDetailView repository="acme/payments" prNumber={1234} loginPath="/auth/login" {...props} />,
  );
}

const stateOf = (): string | null =>
  screen.getByTestId('pr-detail').getAttribute('data-screen-state');

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('DoD 상태 5종', () => {
  it('`loading_initial`', async () => {
    vi.stubGlobal('fetch', () => new Promise<Response>(() => undefined));
    const { container } = view();

    await waitFor(() => {
      expect(stateOf()).toBe('loading_initial');
    });
    expect(describeViolations(await violations(container))).toBe('');
  });

  it('`ready` — 헤더·개요·커밋·타임라인이 선다', async () => {
    stubFetch(PR);
    const { container } = view();

    await waitFor(() => {
      expect(stateOf()).toBe('ready');
    });
    expect(screen.getByTestId('entity-header')).toBeInTheDocument();
    expect(screen.getByTestId('pr-overview')).toBeInTheDocument();
    expect(screen.getByTestId('commit-list')).toBeInTheDocument();
    expect(screen.getByTestId('pr-timeline')).toBeInTheDocument();
    expect(describeViolations(await violations(container))).toBe('');
  });

  it('`enrichment_pending` — **머지 커밋은 보이고 원본만 수집 중** (QA-W002-15)', async () => {
    stubFetch({ ...PR, source_commits: [], enrichment_pending: true });
    const { container } = view();

    await waitFor(() => {
      expect(stateOf()).toBe('ready');
    });
    expect(screen.getByTestId('enrichment-pending')).toBeInTheDocument();
    // 머지 커밋은 그대로다 — 보강과 무관하다.
    expect(within(screen.getByTestId('merge-commit-row')).getByText(/^a{12}$/)).toBeInTheDocument();
    expect(describeViolations(await violations(container))).toBe('');
  });

  it('`truncated` — **총계를 모를 때 아는 척하지 않는다** (QA-W002-03, DEV-082)', async () => {
    const withoutTotal: Record<string, unknown> = { ...PR };
    delete withoutTotal['source_commits_total'];
    stubFetch({ ...withoutTotal, source_commits_truncated: true });
    const { container } = view();

    await waitFor(() => {
      expect(stateOf()).toBe('ready');
    });
    const label = screen.getByTestId('commit-count').textContent ?? '';
    // 절삭 표시는 있다.
    expect(label).toContain('이상');
    // **가짜 총계를 쓰지 않는다.** "2건 중 2건" 같은 문구가 나오면 안 된다.
    expect(label).toContain('전체 건수는 수집하지 않습니다');
    expect(describeViolations(await violations(container))).toBe('');
  });

  it('`not_found` — **존재 여부를 드러내지 않는다** (QA-W002-18)', async () => {
    stubFetch({ error: { code: 'NOT_FOUND', message: 'x' } }, { status: 404 });
    const { container } = view();

    await waitFor(() => {
      expect(stateOf()).toBe('not_found');
    });
    // "권한이 없습니다"라고 쓰면 "있긴 있다"가 새어 나간다.
    expect(container.textContent).not.toContain('권한');
    expect(describeViolations(await violations(container))).toBe('');
  });
});

describe('커밋 목록 (C-018, QA-W002-01·02)', () => {
  it('머지 커밋이 첫 행이고 배지로 구분된다 (QA-W002-01)', async () => {
    stubFetch(PR);
    view();

    await waitFor(() => {
      expect(stateOf()).toBe('ready');
    });
    const merge = screen.getByTestId('merge-commit-row');
    expect(within(merge).getByText('머지 커밋')).toBeInTheDocument();
    expect(screen.getAllByTestId('source-commit-row')).toHaveLength(2);

    /*
     * **순서를 실제로 잰다.** 이름만 "첫 행"이라 붙이고 재지 않으면 머지
     * 커밋이 원본 커밋 뒤로 내려가도 시험이 통과한다. 머지 커밋이 이 PR이
     * 브랜치에 남긴 것이고 원본 커밋은 그 재료다 — 순서가 뒤집히면 읽는
     * 사람이 무엇이 착지한 것인지 알 수 없다.
     */
    const rows = Array.from(
      screen.getByTestId('commit-list').querySelectorAll('[data-testid$="-commit-row"]'),
    );
    expect(rows[0]).toBe(merge);
  });

  it('**미머지 PR은 머지 커밋 행에 사유가 뜬다** (QA-W002-02)', async () => {
    stubFetch({ ...PR, state: 'open', merge_commit_sha: null });
    view();

    await waitFor(() => {
      expect(stateOf()).toBe('ready');
    });
    // 행을 빼지 않는다 — 빼면 "커밋이 없다"로 읽힌다.
    expect(screen.getByTestId('no-merge-commit')).toHaveTextContent('아직 머지되지 않았습니다');
    expect(screen.getAllByTestId('source-commit-row')).toHaveLength(2);
  });

  it('절삭되지 않으면 확정 건수를 말한다', async () => {
    stubFetch(PR);
    view();

    await waitFor(() => {
      expect(stateOf()).toBe('ready');
    });
    expect(screen.getByTestId('commit-count')).toHaveTextContent('원본 커밋 2건');
  });

  it('재조회 버튼이 **다시 부른다** — 자동 폴링이 아니다', async () => {
    const calls = stubFetch({ ...PR, source_commits: [], enrichment_pending: true });
    view();

    await waitFor(() => {
      expect(screen.getByTestId('enrichment-pending')).toBeInTheDocument();
    });
    expect(calls).toHaveLength(1);

    await userEvent.click(screen.getByRole('button', { name: '다시 조회' }));
    await waitFor(() => {
      expect(calls).toHaveLength(2);
    });
  });

  it('가만히 두면 다시 부르지 않는다 — **자동 폴링 금지** (FLOW-002)', async () => {
    const calls = stubFetch({ ...PR, source_commits: [], enrichment_pending: true });
    view();

    await waitFor(() => {
      expect(screen.getByTestId('enrichment-pending')).toBeInTheDocument();
    });
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(calls).toHaveLength(1);
  });
});

describe('타임라인 (C-022, DEV-084)', () => {
  it('**승인은 `done_at_unknown`이고 사유를 밝힌다**', async () => {
    stubFetch(PR);
    view();

    await waitFor(() => {
      expect(stateOf()).toBe('ready');
    });
    const approved = screen.getByTestId('timeline-approved');
    expect(approved).toHaveAttribute('data-status', 'done_at_unknown');
    // 시각을 모르는 이유를 말한다 — 안 그러면 사용자가 버그로 읽는다.
    expect(screen.getByTestId('timeline-note-approved')).toHaveTextContent('승인 시각은 수집하지 않습니다');
  });

  it('승인자가 없으면 `pending`이다', async () => {
    stubFetch({ ...PR, approved_by: [] });
    view();

    await waitFor(() => {
      expect(stateOf()).toBe('ready');
    });
    expect(screen.getByTestId('timeline-approved')).toHaveAttribute('data-status', 'pending');
  });

  it('**릴리스는 `out_of_scope`다** — `pending`과 다르게 표시된다', async () => {
    stubFetch(PR);
    view();

    await waitFor(() => {
      expect(stateOf()).toBe('ready');
    });
    expect(screen.getByTestId('timeline-released')).toHaveAttribute('data-status', 'out_of_scope');
  });

  it('**범위 밖과 대기를 글자로 가른다** — 릴리스는 "곧 온다"가 아니다', async () => {
    // 승인자를 비워 `pending`을 한 화면에 함께 세운다 — 둘을 나란히 비교한다.
    stubFetch({ ...PR, approved_by: [] });
    view();

    await waitFor(() => {
      expect(stateOf()).toBe('ready');
    });
    expect(within(screen.getByTestId('timeline-approved')).getByText('대기')).toBeInTheDocument();
    /*
     * 릴리스는 **아직 안 온 것이 아니라 이 릴리스에서 지원하지 않는 것**이다
     * (WP-024). "대기"로 쓰면 기다리면 채워진다는 거짓말이 된다.
     */
    const released = within(screen.getByTestId('timeline-released'));
    expect(released.queryByText('대기')).toBeNull();
    expect(released.getByText('미지원')).toBeInTheDocument();
  });

  it('상태를 **글자로도** 구분한다 — 색에만 의존하지 않는다', async () => {
    stubFetch(PR);
    view();

    await waitFor(() => {
      expect(stateOf()).toBe('ready');
    });
    expect(within(screen.getByTestId('timeline-approved')).getByText('완료 (시각 미상)')).toBeInTheDocument();
    expect(within(screen.getByTestId('timeline-created')).getByText('완료')).toBeInTheDocument();
  });
});

describe('리뷰 상태 (DEV-085)', () => {
  it('승인함과 아직 아님을 가른다', async () => {
    stubFetch(PR);
    view();

    await waitFor(() => {
      expect(stateOf()).toBe('ready');
    });
    expect(within(screen.getByTestId('reviewer-lee')).getByText('승인함')).toBeInTheDocument();
    expect(within(screen.getByTestId('reviewer-park')).getByText('아직 아님')).toBeInTheDocument();
  });

  it('**"변경 요청"을 만들지 않는다** — 데이터가 없다', async () => {
    stubFetch(PR);
    const { container } = view();

    await waitFor(() => {
      expect(stateOf()).toBe('ready');
    });
    expect(container.textContent).not.toContain('변경 요청');
  });
});

describe('헤더 배지 (W-002-HEADER)', () => {
  it('시퀀스 배지가 선다 — **머지됐지만 채번 전이면 "미채번"이다**', async () => {
    stubFetch(PR);
    view();

    await waitFor(() => {
      expect(stateOf()).toBe('ready');
    });
    const badges = within(screen.getByTestId('entity-badges'));
    expect(badges.getByText('merged')).toBeInTheDocument();
    /*
     * W-002-HEADER가 시퀀스 배지를 요구한다. WP-021 전이라 값이 `null`인데,
     * **`null`을 "미머지"로 읽으면 머지된 PR을 미머지로 표시하게 된다**
     * (CR-019, DEV-077). 배지를 아예 빼는 것도 답이 아니다 — 이 화면의
     * 존재 이유가 시퀀스 위치다.
     */
    expect(badges.getByText('미채번')).toBeInTheDocument();
  });

  it('미머지 PR은 **"미머지"**로 — 미채번과 가른다', async () => {
    stubFetch({ ...PR, state: 'open', merge_commit_sha: null });
    view();

    await waitFor(() => {
      expect(stateOf()).toBe('ready');
    });
    const badges = within(screen.getByTestId('entity-badges'));
    expect(badges.getByText('미머지')).toBeInTheDocument();
    expect(badges.queryByText('미채번')).toBeNull();
  });
});

describe('갱신되지 않는 이유를 밝힌다 (CR-020, DEV-089)', () => {
  it('보관된 저장소를 알린다 — 결과가 더 이상 갱신되지 않는 이유다', async () => {
    stubFetch({ ...PR, repository_archived: true });
    const { container } = view();

    await waitFor(() => {
      expect(stateOf()).toBe('ready');
    });
    expect(screen.getByText('보관된 저장소')).toBeInTheDocument();
    expect(describeViolations(await violations(container))).toBe('');
  });

  it('보관되지 않았으면 경고를 그리지 않는다 — 없는 문제를 만들지 않는다', async () => {
    stubFetch(PR);
    view();

    await waitFor(() => {
      expect(stateOf()).toBe('ready');
    });
    expect(screen.queryByText('보관된 저장소')).toBeNull();
  });

  it('**변경 파일 목록 절삭을 알린다** — 커밋 절삭과 같은 규칙이다', async () => {
    stubFetch({ ...PR, files_truncated: true });
    view();

    await waitFor(() => {
      expect(stateOf()).toBe('ready');
    });
    /*
     * "파일 2개"만 보이면 그것이 전부라고 읽는다. 3000건 상한에 걸린
     * PR에서 그 문구는 거짓이다 (FR-ING-007 AC-4).
     */
    expect(screen.getByTestId('pr-overview').textContent).toContain('절삭');
  });

  it('절삭되지 않았으면 절삭 문구가 없다', async () => {
    stubFetch(PR);
    view();

    await waitFor(() => {
      expect(stateOf()).toBe('ready');
    });
    expect(screen.getByTestId('pr-overview').textContent).not.toContain('절삭');
  });
});

describe('GHE 링크 (C-023, DEV-086)', () => {
  it('구성되어 있으면 새 창 링크를 그린다', async () => {
    stubFetch(PR);
    view({ gheBaseUrl: 'https://ghe.acme.example' });

    await waitFor(() => {
      expect(stateOf()).toBe('ready');
    });
    const link = screen.getByTestId('external-link');
    expect(link).toHaveAttribute('href', 'https://ghe.acme.example/acme/payments/pull/1234');
    expect(link).toHaveAttribute('rel', 'noreferrer');
    // 새 창임을 말로도 알린다 (C-023 접근성).
    expect(link).toHaveAccessibleName(/새 창/);
  });

  it('**미구성이면 버튼을 그리지 않는다** — 죽은 링크보다 없는 편이 낫다', async () => {
    stubFetch(PR);
    view();

    await waitFor(() => {
      expect(stateOf()).toBe('ready');
    });
    expect(screen.queryByTestId('external-link')).toBeNull();
  });
});

describe('준비 중 섹션 (QA-W002-07, QA-W002-17)', () => {
  it('**셋 다 숨기지 않는다** — 숨기면 기능 부재로 오인한다', async () => {
    stubFetch(PR);
    view();

    await waitFor(() => {
      expect(stateOf()).toBe('ready');
    });
    expect(screen.getByTestId('section-neighbors')).toBeInTheDocument();
    expect(screen.getByTestId('section-releases')).toBeInTheDocument();
    expect(screen.getByTestId('section-links')).toBeInTheDocument();
  });

  it('**미머지 PR은 조회하지 않고** 사유를 보인다 (QA-W002-07, CR-031 DEV-164)', async () => {
    const calls = stubWithNeighbors({ ...PR, state: 'open', merge_commit_sha: null });
    view();

    await waitFor(() => {
      expect(stateOf()).toBe('ready');
    });
    await userEvent.click(screen.getByTestId('toggle-neighbors'));
    expect(screen.getByTestId('neighbor-not-merged')).toHaveTextContent('아직 머지되지 않아');
    // PR 문서의 `state`로 아는 사실을 409로 되묻지 않는다.
    expect(calls.filter((url) => url.includes('/api/sequence-neighbors'))).toEqual([]);
  });

  it('머지된 PR은 펼칠 때 1회 부르고 목록을 그린다', async () => {
    const calls = stubWithNeighbors(PR);
    view();

    await waitFor(() => {
      expect(stateOf()).toBe('ready');
    });
    expect(calls).toHaveLength(1);

    await userEvent.click(screen.getByTestId('toggle-neighbors'));
    await waitFor(() => {
      expect(screen.getByTestId('neighbor-list')).toBeInTheDocument();
    });
    expect(calls.filter((url) => url.includes('/api/sequence-neighbors'))).toHaveLength(1);
    expect(calls[1]).toContain('pr_number=1234');
  });

  it('접었다 다시 펼쳐도 재조회하지 않는다', async () => {
    const calls = stubWithNeighbors(PR);
    view();
    await waitFor(() => {
      expect(stateOf()).toBe('ready');
    });
    await userEvent.click(screen.getByTestId('toggle-neighbors'));
    await waitFor(() => {
      expect(screen.getByTestId('neighbor-list')).toBeInTheDocument();
    });
    await userEvent.click(screen.getByTestId('toggle-neighbors'));
    await userEvent.click(screen.getByTestId('toggle-neighbors'));
    expect(calls.filter((url) => url.includes('/api/sequence-neighbors'))).toHaveLength(1);
  });

  it('**건수 변경은 사용자의 조작이므로 다시 부른다** (AC-1)', async () => {
    const calls = stubWithNeighbors(PR);
    view();
    await waitFor(() => {
      expect(stateOf()).toBe('ready');
    });
    await userEvent.click(screen.getByTestId('toggle-neighbors'));
    await waitFor(() => {
      expect(screen.getByTestId('neighbor-count')).toBeInTheDocument();
    });
    await userEvent.selectOptions(screen.getByTestId('neighbor-count'), '50');
    await waitFor(() => {
      expect(calls.filter((url) => url.includes('count=50'))).toHaveLength(1);
    });
  });

  it('**직접 푸시 커밋이 목록에 있어 서수가 건너뛰지 않는다** (CR-031, DEV-161)', async () => {
    stubWithNeighbors(PR);
    view();
    await waitFor(() => {
      expect(stateOf()).toBe('ready');
    });
    await userEvent.click(screen.getByTestId('toggle-neighbors'));
    await waitFor(() => {
      expect(screen.getByTestId('neighbor-list')).toBeInTheDocument();
    });
    const rows = screen.getAllByTestId('neighbor-row');
    expect(rows).toHaveLength(3);
    expect(screen.getByTestId('neighbor-direct-push')).toBeInTheDocument();
    // 기준 개체가 강조된다 (AC-3).
    expect(screen.getByTestId('neighbor-anchor-badge')).toBeInTheDocument();
    // 색인 미반영 행도 남는다 (DEV-166).
    expect(screen.getByTestId('neighbor-unindexed')).toBeInTheDocument();
  });

  it('머지됐으나 채번 전이면 **다른 문구**다 (DEV-077의 구분)', async () => {
    stubWithNeighbors(PR, {
      status: 409,
      body: { error: { code: 'NO_SEQUENCE', message: 'x', detail: { reason: 'not_sequenced' } } },
    });
    view();
    await waitFor(() => {
      expect(stateOf()).toBe('ready');
    });
    await userEvent.click(screen.getByTestId('toggle-neighbors'));
    await waitFor(() => {
      expect(screen.getByTestId('neighbor-not-sequenced')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('neighbor-not-merged')).not.toBeInTheDocument();
  });

  it('**에폭이 어긋나면 경고만 내고 자동으로 다시 부르지 않는다** (QA-W002-16)', async () => {
    const calls = stubWithNeighbors({ ...PR, merge_seq: 4, seq_epoch: 2 });
    view();
    await waitFor(() => {
      expect(stateOf()).toBe('ready');
    });
    await userEvent.click(screen.getByTestId('toggle-neighbors'));
    await waitFor(() => {
      expect(screen.getByTestId('neighbors-epoch-stale')).toBeInTheDocument();
    });
    // 경고 뒤에도 조회는 한 번뿐이다.
    expect(calls.filter((url) => url.includes('/api/sequence-neighbors'))).toHaveLength(1);
  });

  it('범위로 확장이 **서수 앵커**로 W-004에 넘긴다 (DEV-167)', async () => {
    stubWithNeighbors(PR);
    view();
    await waitFor(() => {
      expect(stateOf()).toBe('ready');
    });
    await userEvent.click(screen.getByTestId('toggle-neighbors'));
    await waitFor(() => {
      expect(screen.getByTestId('neighbors-range-expand')).toBeInTheDocument();
    });
    expect(screen.getByTestId('neighbors-range-expand')).toHaveAttribute(
      'href',
      '/ranges?repo=acme%2Fpayments&branch=main&from=seq%3A3&to=seq%3A5&epoch=3',
    );
  });

  it('**진입 시 관계를 함께 부르지 않는다** (QA-W002-17 금지 절반)', async () => {
    const calls = stubFetch(PR);
    view();

    await waitFor(() => {
      expect(stateOf()).toBe('ready');
    });
    // PR 문서 하나뿐이다. 관계·릴리스를 미리 부르지 않는다 (IA 원칙 4).
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('/api/pull-requests/');
  });

  it('접힘이 기본이고 `aria-expanded`가 따라간다', async () => {
    stubFetch(PR);
    view();

    await waitFor(() => {
      expect(stateOf()).toBe('ready');
    });
    const toggle = screen.getByTestId('toggle-links');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
  });

  it('**릴리스는 펼칠 때 한 번만 조회한다** (QA-W002-17 확장 절반 — WP-024가 처음 채웠다)', async () => {
    /*
     * CR-020(DEV-088)이 "확장 전 조회 금지"를 세울 때 "확장하면 조회한다"는
     * 데이터가 생기는 WP로 미뤘다. 릴리스가 그 첫 데이터다 — 화면을 통해
     * 실제 네트워크 계층에서 잰다. 접었다 다시 펼쳐도 재조회하지 않는다.
     */
    const calls: string[] = [];
    vi.stubGlobal('fetch', (url: string) => {
      calls.push(url);
      const body = url.includes('/api/containments')
        ? {
            merge_seq: 1342,
            releases: [
              { tag_name: 'v1.0', released_at: '2026-08-14T09:00:00Z', base_branch: 'main', merge_seq: 1350, source: 'git_tag' },
            ],
            unreleased: false,
          }
        : PR;
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) } as Response);
    });
    view();

    await waitFor(() => {
      expect(stateOf()).toBe('ready');
    });
    expect(calls).toHaveLength(1);

    const toggle = screen.getByTestId('toggle-releases');
    await userEvent.click(toggle);
    await waitFor(() => {
      expect(screen.getByTestId('release-row')).toBeInTheDocument();
    });
    expect(calls).toHaveLength(2);
    expect(calls[1]).toContain('/api/containments');

    await userEvent.click(toggle); // 접기
    await userEvent.click(toggle); // 다시 펼치기
    expect(calls).toHaveLength(2);
  });
});

describe('확장 시에만 조회한다 (QA-W002-17 금지 절반)', () => {
  /*
   * `PrDetailView`는 아직 `onExpand`를 넘기지 않는다 — 부를 데이터가 없다
   * (WP-031). 그래서 **화면을 통해서는 이 규칙을 잴 수 없다.** 컴포넌트를
   * 직접 세워서 잰다. 규칙을 지금 고정해 두어야 WP-031이 조회를 붙일 때
   * 고칠 것이 없다 (CR-020, DEV-088).
   */
  function mountSection(onExpand: () => void): void {
    render(
      <PendingSection
        id="links"
        title="관계"
        reason="관계 파생이 서면 표시됩니다."
        owner="WP-031"
        onExpand={onExpand}
      />,
    );
  }

  it('**진입만으로는 부르지 않는다**', () => {
    const onExpand = vi.fn();
    mountSection(onExpand);
    expect(onExpand).not.toHaveBeenCalled();
  });

  it('펼치면 한 번 부르고, **접을 때는 부르지 않는다**', async () => {
    const onExpand = vi.fn();
    mountSection(onExpand);

    const toggle = screen.getByTestId('toggle-links');
    await userEvent.click(toggle);
    expect(onExpand).toHaveBeenCalledTimes(1);

    // 접기는 조회가 아니다. 여기서 또 부르면 토글할 때마다 서버를 때린다.
    await userEvent.click(toggle);
    expect(onExpand).toHaveBeenCalledTimes(1);

    // 다시 펼치면 부른다 — 갱신 요구는 정당하다.
    await userEvent.click(toggle);
    expect(onExpand).toHaveBeenCalledTimes(2);
  });
});

describe('되돌아가기 (CR-019 DEV-078)', () => {
  it('`from_q`가 있으면 그 질의로 돌아간다', async () => {
    stubFetch(PR);
    view({ fromQuery: 'repo:acme/payments' });

    await waitFor(() => {
      expect(stateOf()).toBe('ready');
    });
    expect(screen.getByTestId('back-link')).toHaveAttribute('href', '/search?q=repo%3Aacme%2Fpayments');
  });

  it('없으면 빈 검색으로 돌아간다', async () => {
    stubFetch(PR);
    view();

    await waitFor(() => {
      expect(stateOf()).toBe('ready');
    });
    expect(screen.getByTestId('back-link')).toHaveAttribute('href', '/search');
  });
});

describe('공간을 요청이 지정한다 · 실패에서 빠져나간다 (CR-032)', () => {
  it('**요청에 문서의 base_branch를 싣는다** (DEV-168)', async () => {
    const calls = stubWithNeighbors(PR);
    view();
    await waitFor(() => {
      expect(stateOf()).toBe('ready');
    });
    await userEvent.click(screen.getByTestId('toggle-neighbors'));
    await waitFor(() => {
      expect(screen.getByTestId('neighbor-list')).toBeInTheDocument();
    });
    const asked = calls.find((url) => url.includes('/api/sequence-neighbors'));
    expect(asked).toBeDefined();
    // 서버가 공간을 고르게 두지 않는다 — 화면이 아는 값을 보낸다.
    expect(asked).toContain('base_branch=main');
  });

  it('**대상 브랜치를 모르면 조회하지 않는다** — main으로 지어내지 않는다', async () => {
    const calls = stubWithNeighbors({ ...PR, base_branch: null });
    view();
    await waitFor(() => {
      expect(stateOf()).toBe('ready');
    });
    await userEvent.click(screen.getByTestId('toggle-neighbors'));
    expect(screen.getByTestId('neighbor-unknown-reason')).toBeInTheDocument();
    expect(calls.filter((url) => url.includes('/api/sequence-neighbors'))).toEqual([]);
  });

  it('**실패한 뒤 다시 시도할 수 있다** (DEV-170)', async () => {
    const calls: string[] = [];
    let neighborAttempts = 0;
    vi.stubGlobal('fetch', (url: string) => {
      calls.push(url);
      if (!url.includes('/api/sequence-neighbors')) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(PR) } as Response);
      }
      neighborAttempts += 1;
      if (neighborAttempts === 1) {
        return Promise.resolve({
          ok: false,
          status: 500,
          json: () => Promise.resolve({ error: { code: 'INTERNAL' } }),
        } as Response);
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(NEIGHBORS) } as Response);
    });

    view();
    await waitFor(() => {
      expect(stateOf()).toBe('ready');
    });
    const documentCalls = calls.filter((url) => !url.includes('/api/sequence-neighbors')).length;

    await userEvent.click(screen.getByTestId('toggle-neighbors'));
    await waitFor(() => {
      expect(screen.getByTestId('neighbors-error')).toBeInTheDocument();
    });

    // 안내만 있고 수단이 없으면 사용자는 상세 화면을 통째로 다시 여는 수밖에 없다.
    await userEvent.click(screen.getByTestId('neighbors-retry'));
    await waitFor(() => {
      expect(screen.getByTestId('neighbor-list')).toBeInTheDocument();
    });
    expect(neighborAttempts).toBe(2);
    // 상세 문서는 다시 부르지 않는다 — 다시 부른 것은 이웃뿐이다.
    expect(calls.filter((url) => !url.includes('/api/sequence-neighbors'))).toHaveLength(documentCalls);
  });

  it('접었다 펴는 것이 유일한 복구 수단이 아니다 — 그 경로로는 낫지 않는다', async () => {
    const calls = stubWithNeighbors(PR, { status: 500, body: { error: { code: 'INTERNAL' } } });
    view();
    await waitFor(() => {
      expect(stateOf()).toBe('ready');
    });
    await userEvent.click(screen.getByTestId('toggle-neighbors'));
    await waitFor(() => {
      expect(screen.getByTestId('neighbors-error')).toBeInTheDocument();
    });
    await userEvent.click(screen.getByTestId('toggle-neighbors'));
    await userEvent.click(screen.getByTestId('toggle-neighbors'));
    // 재조회가 일어나지 않으므로 실패가 그대로다 — 그래서 버튼이 필요하다.
    expect(calls.filter((url) => url.includes('/api/sequence-neighbors'))).toHaveLength(1);
    expect(screen.getByTestId('neighbors-retry')).toBeInTheDocument();
  });
});
