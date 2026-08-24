/**
 * W-003 커밋 상세 (WP-018 DoD / FR-SRCH-002, QA-W003-*).
 *
 * 판정은 `lib/commit-detail.test.ts`가 27건으로 이미 걸었다. 여기서 거는 것은
 * **그 판정이 실제로 그려지는가**와 접근성이다.
 */

import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

const MERGE_SHA = 'a3f9c21b4e8d7f0c1a2b3c4d5e6f708192a3b4c5';
const SOURCE_SHA = '1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d';

vi.mock('next/navigation', () => ({ usePathname: () => `/commit/acme/payments/${MERGE_SHA}` }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

const { CommitDetailView } = await import('../components/CommitDetailView');
const { ShaChip } = await import('../components/ShaChip');

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

/** 머지 커밋 (QA-W003-01). */
const COMMIT = {
  repository: 'acme/payments',
  commit_sha: MERGE_SHA,
  short_sha: MERGE_SHA.slice(0, 12),
  role: 'merge_commit',
  base_branch: 'main',
  merge_seq: null,
  seq_epoch: null,
  sequence_space: null,
  enrichment_pending: false,
  pull_requests: [
    {
      pr_number: 1234,
      title: 'feat: 결제 재시도',
      author: 'kim',
      reviewers: ['lee', 'park'],
      approved_by: ['lee'],
      state: 'merged',
      merged_at: '2026-08-19T05:02:11Z',
      merge_commit_sha: MERGE_SHA,
      url: '/pr/acme/payments/1234',
    },
  ],
};

/** 원본 커밋 (QA-W003-02). 체인 밖이다. */
const SOURCE = { ...COMMIT, commit_sha: SOURCE_SHA, short_sha: SOURCE_SHA.slice(0, 12), role: 'source_commit' };

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

function view(props: Partial<Parameters<typeof CommitDetailView>[0]> = {}): ReturnType<typeof render> {
  return render(
    <CommitDetailView
      repository="acme/payments"
      commitSha={MERGE_SHA}
      loginPath="/auth/login"
      {...props}
    />,
  );
}

const stateOf = (): string | null =>
  screen.getByTestId('commit-detail').getAttribute('data-screen-state');

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('DoD 상태', () => {
  it('`loading_initial` — 응답 전에는 skeleton이다', () => {
    vi.stubGlobal('fetch', () => new Promise(() => undefined));
    const { container } = view();

    expect(stateOf()).toBe('loading_initial');
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
  });

  it('`ready` — 헤더·소속 PR·시퀀스·변경 경로가 선다', async () => {
    stubFetch(COMMIT);
    const { container } = view();

    await waitFor(() => {
      expect(stateOf()).toBe('ready');
    });
    expect(screen.getByTestId('entity-header')).toBeInTheDocument();
    expect(screen.getByTestId('linked-prs')).toBeInTheDocument();
    expect(screen.getByTestId('sequence-position')).toBeInTheDocument();
    expect(screen.getByTestId('changed-paths')).toBeInTheDocument();
    expect(describeViolations(await violations(container))).toBe('');
  });

  it('`not_found` — **존재 여부를 드러내지 않는다** (QA-W002-18과 같은 규칙)', async () => {
    stubFetch({ error: { code: 'NOT_FOUND', message: 'x' } }, { status: 404 });
    const { container } = view();

    await waitFor(() => {
      expect(stateOf()).toBe('not_found');
    });
    expect(container.textContent).not.toContain('권한');
    expect(describeViolations(await violations(container))).toBe('');
  });

  it('`offline` — 네트워크가 끊기면 다시 시도를 준다', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new Error('boom')));
    const { container } = view();

    await waitFor(() => {
      expect(stateOf()).toBe('offline');
    });
    expect(describeViolations(await violations(container))).toBe('');
  });

  it('`auth_expired` — 로그인으로 돌아올 경로를 담는다', async () => {
    stubFetch({ error: { code: 'UNAUTHENTICATED', message: 'x' } }, { status: 401 });
    view();

    await waitFor(() => {
      expect(stateOf()).toBe('auth_expired');
    });
    const link = screen.getByRole('link', { name: '다시 로그인' });
    expect(link.getAttribute('href')).toContain(encodeURIComponent(`/commit/acme/payments/${MERGE_SHA}`));
  });
});

describe('역할 배지 (QA-W003-01·02)', () => {
  it('머지 커밋은 **머지 커밋**이다', async () => {
    stubFetch(COMMIT);
    view();

    await waitFor(() => {
      expect(stateOf()).toBe('ready');
    });
    expect(screen.getByTestId('role-badge')).toHaveTextContent('머지 커밋');
  });

  it('원본 커밋은 **원본 커밋**이다 — 글자로 구분한다', async () => {
    stubFetch(SOURCE);
    view({ commitSha: SOURCE_SHA });

    await waitFor(() => {
      expect(stateOf()).toBe('ready');
    });
    expect(screen.getByTestId('role-badge')).toHaveTextContent('원본 커밋');
  });

  it('**역할을 모르면 그렇게 쓴다** — 머지 커밋으로 넘겨짚지 않는다', async () => {
    const noRole: Record<string, unknown> = { ...COMMIT };
    delete noRole['role'];
    stubFetch(noRole);
    view();

    await waitFor(() => {
      expect(stateOf()).toBe('ready');
    });
    expect(screen.getByTestId('role-badge')).toHaveTextContent('역할 미상');
  });
});

describe('소속 PR (QA-W003-04·05, DEV-093)', () => {
  it('AC-4가 요구하는 필드가 모두 보인다', async () => {
    stubFetch(COMMIT);
    view();

    await waitFor(() => {
      expect(stateOf()).toBe('ready');
    });
    const row = within(screen.getByTestId('linked-pr-row'));
    expect(row.getByText('#1234')).toBeInTheDocument();
    expect(row.getByText('feat: 결제 재시도')).toBeInTheDocument();
    expect(row.getByText('kim')).toBeInTheDocument();
    expect(row.getByText('lee, park')).toBeInTheDocument();
    expect(row.getByText('2026-08-19T05:02:11Z')).toBeInTheDocument();
  });

  it('PR 링크가 **진짜 링크**다 — W-002로 간다', async () => {
    stubFetch(COMMIT);
    view();

    await waitFor(() => {
      expect(stateOf()).toBe('ready');
    });
    expect(screen.getByTestId('linked-pr-link')).toHaveAttribute('href', '/pr/acme/payments/1234');
  });

  it('**같은 SHA가 PR 둘에 속하면 둘 다 보인다** (QA-W003-05)', async () => {
    stubFetch({
      ...COMMIT,
      pull_requests: [
        { pr_number: 1234, title: 'A', url: '/pr/acme/payments/1234' },
        { pr_number: 1235, title: 'B', url: '/pr/acme/payments/1235' },
      ],
    });
    const { container } = view();

    await waitFor(() => {
      expect(stateOf()).toBe('ready');
    });
    expect(screen.getAllByTestId('linked-pr-row')).toHaveLength(2);
    // 둘이라는 사실 자체가 정보다 — 배지로도 알린다.
    expect(screen.getByTestId('multi-pr-badge')).toHaveTextContent('PR 2건');
    expect(describeViolations(await violations(container))).toBe('');
  });

  it('**`reason_code`를 "직접 푸시"라고 쓰지 않는다** (QA-W003-03 절반, DEV-093)', async () => {
    const { container } = (() => {
      stubFetch({ ...COMMIT, pull_requests: [], reason_code: 'no_pull_request' });
      return view();
    })();

    await waitFor(() => {
      expect(stateOf()).toBe('ready');
    });
    expect(screen.getByTestId('not-linked-yet')).toHaveTextContent('아직 PR 연결을 찾지 못했습니다');
    /*
     * 이것이 이 화면에서 가장 하기 쉬운 거짓말이다 — "직접 푸시"라고 쓰면
     * 사용자는 PR 리뷰를 거치지 않은 커밋으로 읽는다.
     */
    expect(container.textContent).not.toContain('직접 푸시');
    expect(screen.queryByTestId('direct-push')).toBeNull();
  });

  it('**`role: direct_push`일 때만 "직접 푸시"다** — 도달하면 옳게 그린다', async () => {
    // WP-021 전까지 서버가 이 값을 내지 않는다. 합성 입력으로 매핑을 건다.
    stubFetch({ ...COMMIT, role: 'direct_push', pull_requests: [] });
    view();

    await waitFor(() => {
      expect(stateOf()).toBe('ready');
    });
    expect(screen.getByTestId('direct-push')).toHaveTextContent('PR 없음 (직접 푸시)');
    expect(screen.queryByTestId('not-linked-yet')).toBeNull();
  });

  it('**보강 중은 PR 연결 없음과 다르다** (DEV-095)', async () => {
    stubFetch({ ...COMMIT, enrichment_pending: true });
    view();

    await waitFor(() => {
      expect(stateOf()).toBe('ready');
    });
    // 이미 이어진 PR은 그대로 보이고, 늘 수 있다고만 알린다.
    expect(screen.getByTestId('pr-enrichment-pending')).toHaveTextContent('늘 수 있습니다');
    expect(screen.getByTestId('linked-pr-row')).toBeInTheDocument();
    expect(screen.queryByTestId('not-linked-yet')).toBeNull();
  });

  it('재조회 버튼이 다시 부른다 — 자동 폴링이 아니다', async () => {
    const calls = stubFetch({ ...COMMIT, enrichment_pending: true });
    view();

    await waitFor(() => {
      expect(screen.getByTestId('pr-enrichment-pending')).toBeInTheDocument();
    });
    expect(calls).toHaveLength(1);

    await userEvent.click(screen.getByTestId('pr-refetch'));
    await waitFor(() => {
      expect(calls).toHaveLength(2);
    });
  });

  it('가만히 두면 다시 부르지 않는다 — **자동 폴링 금지**', async () => {
    const calls = stubFetch({ ...COMMIT, enrichment_pending: true });
    view();

    await waitFor(() => {
      expect(screen.getByTestId('pr-enrichment-pending')).toBeInTheDocument();
    });
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(calls).toHaveLength(1);
  });
});

describe('시퀀스 위치 (QA-W003-06, DEV-092)', () => {
  it('**원본 커밋은 체인 밖이고 머지 커밋으로 가는 길을 준다**', async () => {
    stubFetch(SOURCE);
    const { container } = view({ commitSha: SOURCE_SHA });

    await waitFor(() => {
      expect(stateOf()).toBe('ready');
    });
    expect(screen.getByTestId('sequence-position')).toHaveAttribute('data-seq-state', 'off_chain');
    // 상태 매트릭스가 정한 복구 경로다 — "머지 커밋 이동".
    expect(screen.getByTestId('landed-as-link')).toHaveAttribute(
      'href',
      `/commit/acme/payments/${MERGE_SHA}`,
    );
    // 오류가 아니다 — 경고나 오류 배너를 띄우지 않는다.
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(describeViolations(await violations(container))).toBe('');
  });

  it('**머지 커밋은 미채번이다** — 체인 밖과 다른 문구다', async () => {
    stubFetch(COMMIT);
    view();

    await waitFor(() => {
      expect(stateOf()).toBe('ready');
    });
    expect(screen.getByTestId('sequence-position')).toHaveAttribute('data-seq-state', 'not_computed');
    expect(screen.getByTestId('seq-not-computed')).toHaveTextContent('아직 채번하지 않았습니다');
    expect(screen.queryByTestId('seq-off-chain')).toBeNull();
  });

  it('미머지 PR만 있으면 **머지 커밋 링크를 만들지 않는다**', async () => {
    stubFetch({
      ...SOURCE,
      pull_requests: [{ pr_number: 1236, title: '미머지', state: 'open', url: '/pr/acme/payments/1236' }],
    });
    view({ commitSha: SOURCE_SHA });

    await waitFor(() => {
      expect(stateOf()).toBe('ready');
    });
    expect(screen.queryByTestId('landed-as-link')).toBeNull();
    expect(screen.getByTestId('seq-off-chain')).toHaveTextContent('아직 머지되지 않아');
  });
});

describe('변경 경로 (QA-W003-08, DEV-094)', () => {
  it('**수집 전이면 사유를 적고 숨기지 않는다**', async () => {
    stubFetch(COMMIT);
    view();

    await waitFor(() => {
      expect(stateOf()).toBe('ready');
    });
    expect(screen.getByTestId('changed-paths')).toBeInTheDocument();
    expect(screen.getByTestId('paths-reason')).toHaveTextContent('아직 수집하지 않았습니다');
    // `0`으로 그리면 "바꾼 파일이 없다"는 거짓이 된다.
    expect(screen.getByTestId('changed-paths').textContent).not.toContain('파일 0개');
  });

  it('경로가 오면 경로와 라인 수만 그린다 — **파일 내용은 없다**', async () => {
    stubFetch({
      ...COMMIT,
      changed_paths: [{ path: 'src/payment/retry.ts', additions: 80, deletions: 12 }],
      changed_files_count: 1,
    });
    const { container } = view();

    await waitFor(() => {
      expect(stateOf()).toBe('ready');
    });
    expect(screen.getByTestId('path-row')).toHaveTextContent('src/payment/retry.ts');
    expect(screen.getByTestId('path-count')).toHaveTextContent('파일 1개');
    expect(describeViolations(await violations(container))).toBe('');
  });
});

describe('SHA 복사 (QA-W003-07, C-024, DEV-096)', () => {
  it('**표시값이 아니라 전체 40자를 복사한다**', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    render(<ShaChip commitSha={MERGE_SHA} />);

    // 화면에는 12자만 보인다.
    expect(screen.getByTestId('sha-short')).toHaveTextContent(MERGE_SHA.slice(0, 12));

    await userEvent.click(screen.getByTestId('sha-copy'));
    // 복사되는 것은 40자다. 12자를 복사하면 붙여넣어도 커밋을 못 찾는다.
    expect(writeText).toHaveBeenCalledWith(MERGE_SHA);
  });

  it('성공을 `aria-live`로 알린다', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: () => Promise.resolve() } });
    render(<ShaChip commitSha={MERGE_SHA} />);

    await userEvent.click(screen.getByTestId('sha-copy'));
    await waitFor(() => {
      expect(screen.getByTestId('sha-copy-status')).toHaveTextContent('복사했습니다');
    });
  });

  it('**클립보드가 없으면 조용히 실패하지 않는다** — 알리고 전체 SHA를 보인다', async () => {
    // 보안 컨텍스트가 아닌 배포에서 실제로 이렇게 된다.
    vi.stubGlobal('navigator', {});
    render(<ShaChip commitSha={MERGE_SHA} />);

    await userEvent.click(screen.getByTestId('sha-copy'));
    await waitFor(() => {
      expect(screen.getByTestId('sha-copy-status')).toHaveTextContent('복사하지 못했습니다');
    });
    // 손으로 옮겨 적을 수 있어야 한다.
    expect(screen.getByTestId('sha-full')).toHaveTextContent(MERGE_SHA);
  });

  it('**권한이 거부돼도 알린다**', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: () => Promise.reject(new Error('denied')) } });
    render(<ShaChip commitSha={MERGE_SHA} />);

    await userEvent.click(screen.getByTestId('sha-copy'));
    await waitFor(() => {
      expect(screen.getByTestId('sha-copy-status')).toHaveTextContent('복사하지 못했습니다');
    });
  });

  it('**결과 영역이 실제 라이브 리전이다** (C-024 접근성)', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: () => Promise.resolve() } });
    render(<ShaChip commitSha={MERGE_SHA} />);

    /*
     * 문구만 바뀌고 라이브 리전이 아니면 **스크린 리더 사용자는 복사가
     * 됐는지 영영 모른다** — 화면을 보지 않으니 그 문구를 읽을 계기가 없다.
     * 명세가 `aria-live="polite"`를 못박는다.
     */
    const status = screen.getByTestId('sha-copy-status');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status).toHaveAttribute('role', 'status');
  });

  it('축약 자릿수를 바꿔도 복사는 전체다', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    render(<ShaChip commitSha={MERGE_SHA} abbreviate={7} />);

    expect(screen.getByTestId('sha-short')).toHaveTextContent(MERGE_SHA.slice(0, 7));
    await userEvent.click(screen.getByTestId('sha-copy'));
    expect(writeText).toHaveBeenCalledWith(MERGE_SHA);
  });
});

describe('커밋 메타데이터 (DEV-090)', () => {
  it('**PR 제목을 커밋 제목으로 쓰지 않는다**', async () => {
    stubFetch(COMMIT);
    view();

    await waitFor(() => {
      expect(stateOf()).toBe('ready');
    });
    // 헤더의 이름은 축약 SHA다.
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(MERGE_SHA.slice(0, 12));
    expect(screen.getByRole('heading', { level: 1 })).not.toHaveTextContent('결제 재시도');
  });

  it('메타데이터가 없으면 **왜 없는지 적는다** — 비워 두지 않는다', async () => {
    stubFetch(COMMIT);
    view();

    await waitFor(() => {
      expect(stateOf()).toBe('ready');
    });
    expect(screen.getByTestId('commit-meta-missing')).toHaveTextContent('SHA만 나릅니다');
  });

  it('메타데이터가 오면 그린다 (WP-020 뒤)', async () => {
    stubFetch({ ...COMMIT, message: 'fix: 재시도 한도', author: 'kim', authored_at: '2026-08-19T00:00:00Z' });
    view();

    await waitFor(() => {
      expect(stateOf()).toBe('ready');
    });
    expect(screen.getByTestId('commit-meta')).toHaveTextContent('fix: 재시도 한도');
    expect(screen.queryByTestId('commit-meta-missing')).toBeNull();
  });
});

describe('되돌아가기와 준비 중 섹션', () => {
  it('`from_q`가 있으면 그 질의로 돌아간다', async () => {
    stubFetch(COMMIT);
    view({ fromQuery: 'repo:acme/payments' });

    await waitFor(() => {
      expect(stateOf()).toBe('ready');
    });
    expect(screen.getByTestId('back-link')).toHaveAttribute('href', '/search?q=repo%3Aacme%2Fpayments');
  });

  it('릴리스·관계 골격을 **숨기지 않는다**', async () => {
    stubFetch(COMMIT);
    view();

    await waitFor(() => {
      expect(stateOf()).toBe('ready');
    });
    expect(screen.getByTestId('section-commit-releases')).toBeInTheDocument();
    expect(screen.getByTestId('section-commit-links')).toBeInTheDocument();
  });

  it('**진입 시 커밋 문서 하나만 부른다**', async () => {
    const calls = stubFetch(COMMIT);
    view();

    await waitFor(() => {
      expect(stateOf()).toBe('ready');
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('/api/commits/');
  });

  it('**릴리스는 펼칠 때 한 번만 조회한다** (QA-W002-17 확장 절반 — WP-024)', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', (url: string) => {
      calls.push(url);
      const body = url.includes('/api/containments')
        ? { merge_seq: null, releases: [], unreleased: false, reason: 'target_not_sequenced' }
        : COMMIT;
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) } as Response);
    });
    view();

    await waitFor(() => {
      expect(stateOf()).toBe('ready');
    });
    expect(calls).toHaveLength(1);

    const toggle = screen.getByTestId('toggle-commit-releases');
    await userEvent.click(toggle);
    // 서수 없는 커밋은 미배포가 아니라 판정 불가로 그린다 (DEV-146).
    await waitFor(() => {
      expect(screen.getByTestId('releases-not-sequenced')).toBeInTheDocument();
    });
    expect(calls).toHaveLength(2);
    expect(calls[1]).toContain('/api/containments');

    await userEvent.click(toggle);
    await userEvent.click(toggle);
    expect(calls).toHaveLength(2);
  });
});
