/**
 * CR-111: Source History의 Revision(SHA)·연결 PR 번호 복사가 별도 Copy 버튼 없이
 * 표시 텍스트 자체(semantic button)로 동작하는지 건다. CR-107의 연결 미확정(`null`)·
 * 확정된 연결 없음(`[]`)·조회 불가(`pull_requests_unavailable`) 구분은 이번 변경이
 * 손대지 않았으므로 회귀 여부만 확인한다.
 *
 * `SourceHistory.tsx`는 `next/navigation`을 쓰지 않는다 — `search.test.tsx`류의
 * 라우터 mock이 필요 없다.
 */
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SourceHistory as SourceHistoryData } from '@prs/contracts';

const { SourceHistory } = await import('../components/source/SourceHistory');

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

const SHA_A = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
const SHA_B = 'b2c3d4e5f60718293a4b5c6d7e8f9012345678a1';
const SHA_C = 'c3d4e5f60718293a4b5c6d7e8f9012345678a1b2';

function historyPayload(overrides: Partial<SourceHistoryData> = {}): SourceHistoryData {
  return {
    repository: 'acme/payments', revision: SHA_A, path: 'src/billing.ts', next_page: null,
    commits: [
      { sha: SHA_A, parents: [], message: 'fix: retry\n', author: 'kim', date: '2026-09-01T00:00:00Z', pull_request_numbers: [42, 7] },
      { sha: SHA_B, parents: [], message: 'chore: cleanup\n', author: 'lee', date: '2026-09-02T00:00:00Z', pull_request_numbers: [] },
      { sha: SHA_C, parents: [], message: 'wip\n', author: 'kim', date: null, pull_request_numbers: null },
    ],
    ...overrides,
  };
}

function stubFetch(body: unknown): void {
  vi.stubGlobal('fetch', () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) } as Response));
}

function view(): ReturnType<typeof render> {
  return render(<SourceHistory repository="acme/payments" path="src/billing.ts" kind="file" revision="" branch="main" />);
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('CR-111: Revision(SHA) 텍스트 자체가 복사 대상이다', () => {
  it('축약 SHA 텍스트를 클릭하면 화면에 보이지 않는 전체 SHA가 복사된다', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    stubFetch(historyPayload());
    view();

    const button = await screen.findByRole('button', { name: `Copy full SHA ${SHA_A}` });
    expect(button).toHaveTextContent(SHA_A.slice(0, 9));
    expect(button).not.toHaveTextContent(SHA_A);

    await userEvent.click(button);
    expect(writeText).toHaveBeenCalledWith(SHA_A);
  });

  it('별도 Copy 버튼이 없다 — 식별자마다 클릭 대상이 정확히 하나뿐이다', async () => {
    stubFetch(historyPayload());
    view();

    await screen.findByRole('button', { name: `Copy full SHA ${SHA_A}` });
    // 고정값: SHA 3개(행마다 하나) + PR 번호 2개(SHA_A의 42·7) = 5. 예전처럼 뱃지 옆에
    // 별도 "Copy SHA"/"Copy PR #.." 버튼이 하나 더 있었다면 이 수가 어긋난다.
    expect(screen.getAllByRole('button', { name: /^Copy (full SHA|PR #)/ })).toHaveLength(5);
    expect(screen.queryByRole('button', { name: /^Copy SHA$/ })).not.toBeInTheDocument();
  });

  it('키보드(Enter)만으로 복사할 수 있다', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    stubFetch(historyPayload());
    view();

    const button = await screen.findByRole('button', { name: `Copy full SHA ${SHA_A}` });
    button.focus();
    await userEvent.keyboard('{Enter}');
    expect(writeText).toHaveBeenCalledWith(SHA_A);
  });

  it('복사 완료를 `role="status"` 라이브 리전으로 알린다', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: () => Promise.resolve() } });
    stubFetch(historyPayload());
    view();

    const button = await screen.findByRole('button', { name: `Copy full SHA ${SHA_A}` });
    await userEvent.click(button);
    await waitFor(() => {
      expect(within(button.closest('td')!).getByRole('status')).toHaveTextContent('Copied');
    });
  });

  it('복사가 거부되면 대체 안내로 알린다', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: () => Promise.reject(new Error('denied')) } });
    stubFetch(historyPayload());
    view();

    const button = await screen.findByRole('button', { name: `Copy full SHA ${SHA_A}` });
    await userEvent.click(button);
    await waitFor(() => {
      expect(within(button.closest('td')!).getByRole('status')).toHaveTextContent(/Select and copy the identifier manually/);
    });
  });
});

describe('CR-111: 연결 PR 번호 텍스트 자체가 복사 대상이다 (CR-107 계약 보존)', () => {
  it('#42 텍스트를 클릭하면 기존과 같은 PR 번호 문자열이 복사된다', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    stubFetch(historyPayload());
    view();

    const button = await screen.findByRole('button', { name: 'Copy PR #42' });
    expect(button).toHaveTextContent('#42');
    await userEvent.click(button);
    expect(writeText).toHaveBeenCalledWith('42');
  });

  it('연결 미확정(null)은 Pending, 확정된 연결 없음([])은 대시로 남는다 — 회귀 없음', async () => {
    stubFetch(historyPayload());
    view();

    await screen.findByText('Pending');
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('PR 조회 자체가 불가능해도 안내 문구를 보이고 Revision 복사는 계속 동작한다', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    stubFetch(historyPayload({ pull_requests_unavailable: true }));
    view();

    await screen.findByText(/PR link lookup is temporarily unavailable/);
    // `commits` fills from a separate passive effect after `pull_requests_unavailable` is already
    // true (CR-111 review, DEV-729) -- findByRole (not getByRole) tolerates that in-between frame.
    const button = await screen.findByRole('button', { name: `Copy full SHA ${SHA_A}` });
    await userEvent.click(button);
    expect(writeText).toHaveBeenCalledWith(SHA_A);
  });
});

describe('CR-111: axe 위반 0건', () => {
  it('History 표에 접근성 위반이 없다', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: () => Promise.resolve() } });
    stubFetch(historyPayload());
    const { container } = view();

    await screen.findByRole('button', { name: `Copy full SHA ${SHA_A}` });
    expect(describeViolations(await violations(container))).toBe('');
  });
});
