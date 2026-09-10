/**
 * W-005 릴리스·빌드 화면 (WP-026 DoD / 상태 매트릭스 W-005, QA-W005-*).
 *
 * DoD가 요구하는 둘: **도달 가능한 전 상태의 렌더링**과 **axe 위반 0건**.
 * 판정은 `lib/releases.test.ts`가 걸었다 — 여기서는 그 판정이 실제로
 * 그려지는가, 그리고 **상세가 태그당 한 번만 조회되는가**(IA 원칙 4),
 * **낯선 `select=`가 비교로 복원되지 않는가**(DEV-158)를 실제 네트워크
 * 계수와 라우터 기록으로 건다.
 */

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { afterEach, describe, expect, it, vi } from 'vitest';

const params = { current: new URLSearchParams() };
const replaced: string[] = [];
const pushed: string[] = [];

vi.mock('next/navigation', () => ({
  usePathname: () => '/releases/acme/payments',
  useSearchParams: () => params.current,
  useRouter: () => ({
    replace: (href: string) => replaced.push(href),
    push: (href: string) => pushed.push(href),
  }),
}));

const { ReleasesView, ReleaseSpacePicker } = await import('../components/ReleasesView');

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
    { repository: 'acme/payments', base_branch: 'develop', sequence_space: 'acme/payments@develop', seq_epoch: 1, sequence_state: 'ok' },
  ],
};

/** 서수 내림차순 — 서버가 보장하는 순서 그대로다 (DEV-159). */
const TIMELINE = {
  sequence_space: 'acme/payments@main',
  seq_epoch: 3,
  sequence_state: 'ok',
  releases: [
    { tag_name: 'v1.1', released_at: '2026-08-15T09:00:00Z', commit_sha: 'c'.repeat(40), merge_seq: 5, source: 'git_tag', previous_tag_name: 'v1.0', pull_request_count: 2 },
    { tag_name: 'v1.0', released_at: '2026-08-14T09:00:00Z', commit_sha: 'b'.repeat(40), merge_seq: 2, source: 'git_tag', previous_tag_name: null, pull_request_count: 1 },
  ],
  unreleased: { last_release_tag: 'v1.1', head_seq: 6, head_commit_sha: 'd'.repeat(40), pending_pull_request_count: 4 },
  correlation_id: 't',
};

const COMPARISON = {
  sequence_space: 'acme/payments@main',
  seq_epoch: 3,
  sequence_state: 'ok',
  normalized_direction: 'from=v1.0(seq 2) → to=v1.1(seq 5)',
  from_release: { tag_name: 'v1.0', merge_seq: 2 },
  to_release: { tag_name: 'v1.1', merge_seq: 5 },
  range: { from_seq: 2, to_seq: 5, boundary: '(from, to]' },
  summary: {
    pull_request_count: 2,
    commit_count: 3,
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

interface StubRoutes {
  readonly timeline?: { status: number; body: unknown };
  readonly comparison?: { status: number; body: unknown };
  readonly offline?: boolean;
}

/** URL별 응답 라우터. `calls`가 "태그당 한 번" 계수의 근거다 (IA 원칙 4). */
function stubFetch(routes: StubRoutes = {}): string[] {
  const calls: string[] = [];
  vi.stubGlobal('fetch', (url: string) => {
    calls.push(url);
    if (routes.offline === true && url.includes('/api/releases')) {
      return Promise.reject(new Error('offline'));
    }
    let status = 200;
    let body: unknown = {};
    if (url.includes('/api/sequence-spaces')) {
      body = SPACES;
    } else if (url.includes('/api/release-comparisons')) {
      status = routes.comparison?.status ?? 200;
      body = routes.comparison?.body ?? COMPARISON;
    } else if (url.includes('/api/releases')) {
      status = routes.timeline?.status ?? 200;
      body = routes.timeline?.body ?? TIMELINE;
    }
    return Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) } as Response);
  });
  return calls;
}

function view(query = 'branch=main'): ReturnType<typeof render> {
  params.current = new URLSearchParams(query);
  return render(<ReleasesView owner="acme" repo="payments" loginPath="/auth/login" />);
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  replaced.length = 0;
  pushed.length = 0;
});

describe('타임라인 (W-005-LIST)', () => {
  it('ready: 서버 순서 그대로 목록·PR 수·첫 릴리스 표식이 그려지고 axe 위반이 없다', async () => {
    stubFetch();
    const { container } = view();
    await waitFor(() => expect(screen.getByTestId('release-timeline')).toBeTruthy());

    const rows = screen.getAllByTestId(/^release-row-/);
    expect(rows.map((row) => row.getAttribute('data-testid'))).toEqual([
      'release-row-v1.1',
      'release-row-v1.0',
    ]);
    expect(screen.getByTestId('release-meta-v1.1').textContent).toContain('PR 2건');
    // 첫 릴리스의 수는 "히스토리 시작부터"임이 함께 보인다 — 직전 대비로 오독되지 않게.
    expect(screen.getByTestId('release-meta-v1.0').textContent).toContain('히스토리 시작부터');

    const found = await violations(container);
    expect(found, describeViolations(found)).toEqual([]);
  });

  it('loading_initial: 조회가 끝나기 전에는 skeleton 문구다', () => {
    vi.stubGlobal('fetch', () => new Promise(() => undefined));
    view();
    expect(screen.getByTestId('releases-loading')).toBeTruthy();
  });

  it('empty_no_release: 수집은 됐으나 이 브랜치에 없음 — 사유 없는 빈 목록의 전용 문구다', async () => {
    stubFetch({ timeline: { status: 200, body: { ...TIMELINE, releases: [], unreleased: undefined } } });
    view();
    await waitFor(() => expect(screen.getByText('이 브랜치에는 릴리스가 없습니다')).toBeTruthy());
    expect(screen.queryByTestId('release-timeline')).toBeNull();
  });

  it('not_indexed: 미수집은 저장소 개요 경로와 함께다 (QA-W005-05)', async () => {
    stubFetch({
      timeline: {
        status: 200,
        body: { ...TIMELINE, releases: [], unreleased: undefined, reason: 'release_not_indexed', registration_status_path: '/repositories' },
      },
    });
    const { container } = view();
    await waitFor(() => expect(screen.getByTestId('release-registration-path')).toBeTruthy());
    expect(screen.getByTestId('release-registration-path').getAttribute('href')).toBe('/repositories');

    const found = await violations(container);
    expect(found, describeViolations(found)).toEqual([]);
  });

  it('server_error(404)·offline: 공통 규칙으로 내린다', async () => {
    stubFetch({ timeline: { status: 404, body: { error: { code: 'NOT_FOUND', message: '등록되지 않은 저장소다' }, correlation_id: 'x' } } });
    view();
    await waitFor(() => expect(screen.getByText(/릴리스 목록 조회 실패/)).toBeTruthy());
    cleanup();

    stubFetch({ offline: true });
    view();
    await waitFor(() => expect(screen.getByTestId('releases-offline')).toBeTruthy());
  });

  it('reassigning: 재채번 배너가 선다', async () => {
    stubFetch({ timeline: { status: 200, body: { ...TIMELINE, sequence_state: 'reassigning' } } });
    view();
    await waitFor(() => expect(screen.getByTestId('releases-reassigning-banner')).toBeTruthy());
  });
});

describe('비교 선택 (QA-W005-01·02, C-032)', () => {
  it('**2건 선택 시 비교가 활성화되고 방향이 정규화되어 명시된다** — 체크 순서는 방향이 아니다', async () => {
    stubFetch();
    view();
    await waitFor(() => expect(screen.getByTestId('release-timeline')).toBeTruthy());
    expect(screen.getByTestId('release-compare-hint').textContent).toContain('0/2');

    // 큰 서수(v1.1)를 먼저 체크해도 방향은 작은 서수가 시작이다 (QA-W005-02).
    await userEvent.click(screen.getByLabelText('비교 대상: v1.1'));
    expect(screen.getByTestId('release-compare-hint').textContent).toContain('1/2');
    await userEvent.click(screen.getByLabelText('비교 대상: v1.0'));

    expect(screen.getByTestId('release-compare-direction').textContent).toBe(
      'from=v1.0(seq 2) → to=v1.1(seq 5)',
    );
    await userEvent.click(screen.getByTestId('release-compare-go'));
    // W-004 인용에 태그 앵커와 현재 에폭이 실린다 (ADR-007).
    expect(pushed).toContain('/ranges?repo=acme%2Fpayments&branch=main&from=v1.0&to=v1.1&epoch=3');
  });

  it('체크가 바뀔 때마다 URL이 선택을 싣는다 — 딥링크가 곧 화면 상태다', async () => {
    stubFetch();
    view();
    await waitFor(() => expect(screen.getByTestId('release-timeline')).toBeTruthy());
    await userEvent.click(screen.getByLabelText('비교 대상: v1.1'));
    expect(replaced.at(-1)).toBe('/releases/acme/payments?branch=main&select=v1.1');
    await userEvent.click(screen.getByLabelText('비교 대상: v1.1'));
    expect(replaced.at(-1)).toBe('/releases/acme/payments?branch=main');
  });

  it('딥링크 select=가 체크 상태로 복원된다 (DEV-158)', async () => {
    stubFetch();
    view('branch=main&select=v1.0,v1.1');
    await waitFor(() =>
      expect(screen.getByTestId('release-compare-direction').textContent).toBe(
        'from=v1.0(seq 2) → to=v1.1(seq 5)',
      ),
    );
  });

  it('**타임라인에 없는 태그는 복원하지 않고 경고한다** — error_space_mismatch의 화면 쪽 처리다 (QA-W005-03)', async () => {
    stubFetch();
    const { container } = view('branch=main&select=v1.0,v-dev');
    await waitFor(() => expect(screen.getByTestId('release-selection-unknown')).toBeTruthy());
    expect(screen.getByTestId('release-selection-unknown').textContent).toContain('v-dev');
    // 낯선 태그가 빠졌으므로 선택은 1건 — 비교는 서지 않는다.
    expect(screen.getByTestId('release-compare-hint').textContent).toContain('1/2');
    expect(screen.queryByTestId('release-compare-go')).toBeNull();

    const found = await violations(container);
    expect(found, describeViolations(found)).toEqual([]);
  });

  it('상한 2에서 나머지 체크박스는 비활성이다 — 셋째 선택을 말없이 버리지 않는다', async () => {
    stubFetch({
      timeline: {
        status: 200,
        body: {
          ...TIMELINE,
          releases: [
            ...TIMELINE.releases,
            { tag_name: 'v0.9', released_at: '2026-08-13T09:00:00Z', commit_sha: 'a'.repeat(40), merge_seq: 1, source: 'git_tag', previous_tag_name: null, pull_request_count: 0 },
          ],
        },
      },
    });
    view('branch=main&select=v1.0,v1.1');
    await waitFor(() => expect(screen.getByTestId('release-timeline')).toBeTruthy());
    const third = screen.getByLabelText('비교 대상: v0.9');
    expect((third as HTMLButtonElement).disabled || third.getAttribute('data-disabled') !== null).toBe(true);
    // 해제는 언제나 가능하다.
    const checked = screen.getByLabelText('비교 대상: v1.0');
    expect((checked as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('릴리스 상세 (W-005-DETAIL, DEV-156·158)', () => {
  it('**상세는 태그당 한 번만 조회한다** — 다시 선택해도 캐시가 답한다 (IA 원칙 4)', async () => {
    const calls = stubFetch();
    view();
    await waitFor(() => expect(screen.getByTestId('release-timeline')).toBeTruthy());
    const countComparisons = (): number => calls.filter((url) => url.includes('/api/release-comparisons')).length;
    expect(countComparisons()).toBe(0);

    await userEvent.click(screen.getByTestId('release-detail-v1.1'));
    await waitFor(() => expect(screen.getByTestId('release-detail-ready-v1.1')).toBeTruthy());
    expect(countComparisons()).toBe(1);
    expect(screen.getByTestId('release-detail-direction').textContent).toBe(
      'from=v1.0(seq 2) → to=v1.1(seq 5)',
    );
    // 되돌림 수 자리는 값이 아니라 "준비 중"이다 (DEV-156 — DEV-150과 같은 화면 규칙).
    expect(screen.getByTestId('summary-reverts-pending')).toBeTruthy();
    expect(screen.getByTestId('release-detail-range-link').getAttribute('href')).toBe(
      '/ranges?repo=acme%2Fpayments&branch=main&from=v1.0&to=v1.1&epoch=3',
    );

    // 다른 행을 다녀와도 v1.1 재선택은 조회를 늘리지 않는다.
    await userEvent.click(screen.getByTestId('release-detail-v1.0'));
    await waitFor(() => expect(screen.getByTestId('release-detail-first')).toBeTruthy());
    await userEvent.click(screen.getByTestId('release-detail-v1.1'));
    await waitFor(() => expect(screen.getByTestId('release-detail-ready-v1.1')).toBeTruthy());
    expect(countComparisons()).toBe(1);
  });

  it('**첫 릴리스는 비교를 부르지 않는다** — 안내와 비활성 사유가 그 자리다 (DEV-158)', async () => {
    const calls = stubFetch();
    const { container } = view();
    await waitFor(() => expect(screen.getByTestId('release-timeline')).toBeTruthy());
    await userEvent.click(screen.getByTestId('release-detail-v1.0'));
    await waitFor(() => expect(screen.getByTestId('release-detail-first')).toBeTruthy());
    expect(calls.filter((url) => url.includes('/api/release-comparisons'))).toHaveLength(0);
    expect(screen.getByTestId('release-detail-first-no-range')).toBeTruthy();

    const found = await violations(container);
    expect(found, describeViolations(found)).toEqual([]);
  });

  it('상세 실패는 재시도 액션과 함께다 — 막다른 길을 만들지 않는다', async () => {
    stubFetch({ comparison: { status: 400, body: { error: { code: 'SEQUENCE_SPACE_MISMATCH', message: '다른 브랜치 릴리스다' }, correlation_id: 'x' } } });
    view();
    await waitFor(() => expect(screen.getByTestId('release-timeline')).toBeTruthy());
    await userEvent.click(screen.getByTestId('release-detail-v1.1'));
    await waitFor(() => expect(screen.getByTestId('release-detail-error')).toBeTruthy());
    expect(screen.getByTestId('release-detail-retry')).toBeTruthy();
  });
});

describe('미배포 구간 (W-005-UNRELEASED, QA-W005-04)', () => {
  it('대기 PR 수가 보이고, 진입은 head 서수를 끝 앵커로 하는 W-004 인용이다', async () => {
    stubFetch();
    view();
    await waitFor(() => expect(screen.getByTestId('release-unreleased')).toBeTruthy());
    expect(screen.getByTestId('release-pending-count').textContent).toBe('4');
    await userEvent.click(screen.getByTestId('release-unreleased-go'));
    expect(pushed).toContain('/ranges?repo=acme%2Fpayments&branch=main&from=v1.1&to=seq%3A6&epoch=3');
  });

  it('서수 있는 릴리스가 없으면 미배포 구간도 없다 — "마지막 릴리스 이후"가 정의되지 않는다', async () => {
    stubFetch({ timeline: { status: 200, body: { ...TIMELINE, releases: [], unreleased: undefined } } });
    view();
    await waitFor(() => expect(screen.getByText('이 브랜치에는 릴리스가 없습니다')).toBeTruthy());
    expect(screen.queryByTestId('release-unreleased')).toBeNull();
  });
});

describe('진입과 공간 (W-005 진입 경로)', () => {
  it('branch가 없으면 조회하지 않고 공간 선택을 안내한다', async () => {
    const calls = stubFetch();
    const { container } = view('');
    expect(screen.getByTestId('releases-need-branch')).toBeTruthy();
    await waitFor(() => expect(calls.some((url) => url.includes('/api/sequence-spaces'))).toBe(true));
    expect(calls.filter((url) => url.includes('/api/releases?'))).toHaveLength(0);

    const found = await violations(container);
    expect(found, describeViolations(found)).toEqual([]);
  });

  it('`/releases` 진입 화면도 axe 위반이 없다', async () => {
    stubFetch();
    params.current = new URLSearchParams('');
    const { container } = render(<ReleaseSpacePicker />);
    await waitFor(() => expect(screen.getByTestId('releases-picker')).toBeTruthy());
    const found = await violations(container);
    expect(found, describeViolations(found)).toEqual([]);
  });
});
