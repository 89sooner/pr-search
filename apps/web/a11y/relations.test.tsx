/**
 * W-002·W-003 관계 섹션과 W-001 관계 배지 (WP-031 DoD / CR-042).
 *
 * 판정은 `lib/relations.test.ts`가 이미 걸었다. 여기서 거는 것은 **그 판정이
 * 실제로 그려지는가**와 접근성이다.
 *
 * 특히 넷을 갈라 그리는지를 본다 — 없는 것 · 모르는 것 · 볼 수 없는 것 ·
 * 해제된 것.
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

const { RelationSection } = await import('../components/RelationSection');
const { CoChangeSection } = await import('../components/CoChangeSection');
const { ResultTable } = await import('../components/ResultTable');

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

interface Route {
  readonly match: (url: string) => boolean;
  readonly body: unknown;
  readonly status?: number;
  /** 참이면 `body` 대신 요청 URL에서 응답을 만든다. */
  readonly echo?: boolean;
}


/** URL마다 다른 답을 주는 대역. 실제 서버와 같은 갈래로 판정해야 한다. */
function routeFetch(routes: readonly Route[]): string[] {
  const calls: string[] = [];
  vi.stubGlobal('fetch', (url: string) => {
    calls.push(url);
    const route = routes.find((one) => one.match(url));
    const status = route?.status ?? (route === undefined ? 404 : 200);
    return Promise.resolve({
      ok: status < 400,
      status,
      json: () => Promise.resolve(route?.echo === true ? echoRelations(url) : (route?.body ?? {})),

    });
  });
  return calls;
}

function relationBody(
  linkType: string,
  direction: string,
  items: readonly unknown[],
  truncated = false,
): unknown {
  return { anchor: {}, link_type: linkType, direction, items, truncated };
}

/**
 * 요청한 유형·방향을 **그대로 되돌려주는** 빈 응답.
 *
 * 고정 `link_type`을 돌려주는 대역은 실제 서버보다 관대하다 — 네 유형이 전부
 * `references`로 그려져 같은 `data-testid`가 여러 개 생기고, 그 사실이 시험을
 * 통과시킨다. **대역이 틀린 입력을 받아 주지 않는지 물어라** (risks 3).
 */
function echoRelations(url: string): unknown {
  const query = new URLSearchParams(url.split('?')[1] ?? '');
  return relationBody(query.get('link_type') ?? 'references', query.get('direction') ?? 'outgoing', []);
}

const EMPTY_ROUTES: readonly Route[] = [
  { match: (url) => url.startsWith('/api/relations'), body: null, echo: true },
];


afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('지연 조회 (QA-W002-17, QA-W003-10)', () => {
  it('**마운트 시 관계를 부르지 않는다**', () => {
    const calls = routeFetch(EMPTY_ROUTES);
    render(
      <RelationSection repository="acme/payments" kind="pull_request" id="1234" sectionId="links" />,
    );
    expect(calls).toEqual([]);
  });

  it('펼치면 유형×방향마다 한 번씩 부른다 — PR은 여덟', async () => {
    const calls = routeFetch(EMPTY_ROUTES);
    render(
      <RelationSection repository="acme/payments" kind="pull_request" id="1234" sectionId="links" />,
    );
    await userEvent.click(screen.getByTestId('toggle-links'));
    await waitFor(() => {
      expect(calls.length).toBe(8);
    });
    expect(calls.every((url) => url.startsWith('/api/relations?'))).toBe(true);
  });

  it('**커밋은 스택을 묻지 않는다** — 여섯이다 (QA-W003-11)', async () => {
    const calls = routeFetch(EMPTY_ROUTES);
    render(
      <RelationSection repository="acme/payments" kind="commit" id={'a'.repeat(40)} sectionId="commit-links" />,
    );
    await userEvent.click(screen.getByTestId('toggle-commit-links'));
    await waitFor(() => {
      expect(calls.length).toBe(6);
    });
    expect(calls.some((url) => url.includes('stacks_on'))).toBe(false);
  });

  it('접었다 다시 펼쳐도 재조회하지 않는다 — 자동 폴링을 만들지 않는다', async () => {
    const calls = routeFetch(EMPTY_ROUTES);
    render(
      <RelationSection repository="acme/payments" kind="pull_request" id="1234" sectionId="links" />,
    );
    const toggle = screen.getByTestId('toggle-links');
    await userEvent.click(toggle);
    await waitFor(() => {
      expect(calls.length).toBe(8);
    });
    await userEvent.click(toggle);
    await userEvent.click(toggle);
    expect(calls.length).toBe(8);
  });
});

describe('항목 축 상태를 갈라 그린다', () => {
  async function renderWith(items: readonly unknown[], linkType = 'reverts'): Promise<HTMLElement> {
    routeFetch([
      {
        match: (url) => url.includes(`link_type=${linkType}`) && url.includes('direction=outgoing'),
        body: relationBody(linkType, 'outgoing', items),
      },
      { match: (url) => url.startsWith('/api/relations'), body: null, echo: true },
    ]);
    const view = render(
      <RelationSection repository="acme/payments" kind="pull_request" id="1234" sectionId="links" />,
    );
    await userEvent.click(screen.getByTestId('toggle-links'));
    await waitFor(() => {
      expect(screen.getAllByTestId('relation-row').length).toBeGreaterThan(0);
    });
    return view.container;
  }

  it('**해제된 스택을 숨기지도 active로 그리지도 않는다** (QA-W002-23)', async () => {
    await renderWith(
      [
        {
          link_id: 's1',
          confidence: 'derived',
          evidence: 'base=feature/upper',
          resolved: true,
          detached: true,
          content_available: true,
          endpoint: { kind: 'pull_request', repository: 'acme/payments', pr_number: 9, url: '/pr/acme/payments/9' },
        },
      ],
      'stacks_on',
    );
    // 행은 남아 있고, 해제 표시가 텍스트로 붙는다 (색상만으로 구분하지 않는다).
    expect(screen.getByTestId('relation-detached')).toHaveTextContent('해제됨');
    expect(screen.getByTestId('relation-target-link')).toBeInTheDocument();
  });

  it('**다중 후보를 모두 표시하고 다중임을 밝힌다** (QA-W002-24)', async () => {
    await renderWith([
      {
        link_id: 'c1',
        confidence: 'heuristic',
        evidence: 'Revert "같은 제목"',
        resolved: true,
        ambiguous: true,
        content_available: true,
        endpoint: { kind: 'pull_request', repository: 'acme/payments', pr_number: 11, url: '/pr/acme/payments/11' },
      },
      {
        link_id: 'c2',
        confidence: 'heuristic',
        evidence: 'Revert "같은 제목"',
        resolved: true,
        ambiguous: true,
        content_available: true,
        endpoint: { kind: 'pull_request', repository: 'acme/payments', pr_number: 12, url: '/pr/acme/payments/12' },
      },
    ]);
    expect(screen.getAllByTestId('relation-row')).toHaveLength(2);
    expect(screen.getAllByTestId('relation-ambiguous')).toHaveLength(2);
  });

  it('**대상을 볼 수 없으면 링크가 없고 사유를 밝히지 않는다** (QA-W002-25)', async () => {
    const container = await renderWith([
      {
        link_id: 'x1',
        confidence: 'derived',
        evidence: 'Refs: acme/secret#20',
        resolved: true,
        content_available: false,
        endpoint: { kind: 'pull_request', reference_expression: 'acme/secret#20' },
      },
    ]);
    expect(screen.queryByTestId('relation-target-link')).toBeNull();
    expect(screen.getByTestId('relation-target-inactive')).toHaveTextContent('acme/secret#20');
    expect(container.textContent).not.toContain('권한');
  });

  it('미해결 참조는 링크가 비활성이다', async () => {
    await renderWith(
      [
        {
          link_id: 'u1',
          confidence: 'heuristic',
          evidence: 'Refs: abc1234',
          resolved: false,
          content_available: false,
          endpoint: { reference_expression: 'abc1234' },
        },
      ],
      'references',
    );
    expect(screen.getByTestId('relation-unresolved')).toBeInTheDocument();
    expect(screen.queryByTestId('relation-target-link')).toBeNull();
  });

  it('`heuristic` 항목에 근거가 반드시 함께 표시된다 (QA-W002-10)', async () => {
    await renderWith([
      {
        link_id: 'h1',
        confidence: 'heuristic',
        evidence: 'Revert "결제 재시도"',
        resolved: true,
        content_available: true,
        endpoint: { kind: 'pull_request', repository: 'acme/payments', pr_number: 3, url: '/pr/acme/payments/3' },
      },
    ]);
    const row = screen.getByTestId('relation-row');
    expect(within(row).getByTestId('relation-evidence')).toHaveTextContent('Revert "결제 재시도"');
  });

  it('**근거가 평문으로 렌더링된다** (THR-020) — HTML로 해석하지 않는다', async () => {
    const container = await renderWith([
      {
        link_id: 'xss',
        confidence: 'heuristic',
        evidence: '<img src=x onerror="alert(1)">',
        resolved: true,
        content_available: true,
        endpoint: { kind: 'pull_request', repository: 'acme/payments', pr_number: 4, url: '/pr/acme/payments/4' },
      },
    ]);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByTestId('relation-evidence')).toHaveTextContent('<img src=x onerror="alert(1)">');
  });

  it('상한을 넘으면 절삭을 밝힌다', async () => {
    routeFetch([
      {
        match: (url) => url.includes('link_type=references') && url.includes('direction=incoming'),
        body: relationBody(
          'references',
          'incoming',
          [
            {
              link_id: 't1',
              confidence: 'derived',
              evidence: 'e',
              resolved: true,
              content_available: true,
              endpoint: { kind: 'pull_request', repository: 'acme/payments', pr_number: 5, url: '/pr/acme/payments/5' },
            },
          ],
          true,
        ),
      },
      { match: (url) => url.startsWith('/api/relations'), body: null, echo: true },
    ]);
    render(
      <RelationSection repository="acme/payments" kind="pull_request" id="1234" sectionId="links" />,
    );
    await userEvent.click(screen.getByTestId('toggle-links'));
    await waitFor(() => {
      expect(screen.getByTestId('relation-truncated-references-incoming')).toBeInTheDocument();
    });
  });
});

describe('`links_pending`은 참조 그룹에만 걸린다 (QA-W002-26)', () => {
  it('참조가 분석 중이어도 되돌림은 그대로 보인다', async () => {
    routeFetch([
      {
        match: (url) => url.includes('link_type=reverts') && url.includes('direction=outgoing'),
        body: relationBody('reverts', 'outgoing', [
          {
            link_id: 'r1',
            confidence: 'exact',
            evidence: 'This reverts commit aaaa',
            resolved: true,
            content_available: true,
            endpoint: { kind: 'pull_request', repository: 'acme/payments', pr_number: 7, url: '/pr/acme/payments/7' },
          },
        ]),
      },
      { match: (url) => url.startsWith('/api/relations'), body: null, echo: true },
    ]);
    render(
      <RelationSection
        repository="acme/payments"
        kind="pull_request"
        id="1234"
        sectionId="links"
        linksPending
      />,
    );
    await userEvent.click(screen.getByTestId('toggle-links'));
    await waitFor(() => {
      expect(screen.getByTestId('references-pending')).toHaveTextContent('참조 분석 중');
    });
    // 되돌림 간선은 그 상태와 무관하게 보인다.
    expect(screen.getAllByTestId('relation-row').length).toBeGreaterThan(0);
  });
});

describe('부분 실패와 복구 (QA-W002-27)', () => {
  it('한 그룹이 실패해도 다른 그룹은 그대로이고 **다시 시도 버튼이 있다**', async () => {
    routeFetch([
      { match: (url) => url.includes('link_type=reverts'), status: 500, body: {} },
      { match: (url) => url.startsWith('/api/relations'), body: null, echo: true },
    ]);
    render(
      <RelationSection repository="acme/payments" kind="pull_request" id="1234" sectionId="links" />,
    );
    await userEvent.click(screen.getByTestId('toggle-links'));
    await waitFor(() => {
      expect(screen.getByTestId('relation-error-reverts:outgoing')).toBeInTheDocument();
    });
    // 따를 수 없는 지시를 하지 않는다 — 버튼이 실재한다.
    expect(screen.getByTestId('relation-retry-reverts:outgoing')).toBeInTheDocument();
    // 다른 그룹은 살아 있다.
    expect(screen.getByTestId('relation-empty-references-outgoing')).toBeInTheDocument();
  });
});

describe('동시 변경 (QA-W002-28)', () => {
  it('마운트 시 부르지 않고, 펼치면 한 번 부른다', async () => {
    const calls = routeFetch([
      { match: (url) => url.startsWith('/api/co-changes'), body: { available: true, items: [] } },
    ]);
    render(<CoChangeSection repository="acme/payments" prNumber={1234} sectionId="cochanges" />);
    expect(calls).toEqual([]);
    await userEvent.click(screen.getByTestId('toggle-cochanges'));
    await waitFor(() => {
      expect(screen.getByTestId('cochange-empty')).toBeInTheDocument();
    });
    expect(calls).toHaveLength(1);
  });

  it('**미머지는 사유와 함께, 0건과 다르게 그린다**', async () => {
    routeFetch([
      {
        match: (url) => url.startsWith('/api/co-changes'),
        body: { available: false, reason: 'not_merged', items: [] },
      },
    ]);
    render(<CoChangeSection repository="acme/payments" prNumber={1234} sectionId="cochanges" />);
    await userEvent.click(screen.getByTestId('toggle-cochanges'));
    await waitFor(() => {
      expect(screen.getByTestId('cochange-unavailable')).toHaveTextContent('머지되지 않아');
    });
    expect(screen.queryByTestId('cochange-empty')).toBeNull();
  });

  it('실패하면 재시도 버튼이 있다', async () => {
    routeFetch([{ match: (url) => url.startsWith('/api/co-changes'), status: 500, body: {} }]);
    render(<CoChangeSection repository="acme/payments" prNumber={1234} sectionId="cochanges" />);
    await userEvent.click(screen.getByTestId('toggle-cochanges'));
    await waitFor(() => {
      expect(screen.getByTestId('cochange-retry')).toBeInTheDocument();
    });
  });
});

describe('W-001 관계 배지 (QA-W001-24)', () => {
  const BASE = {
    kind: 'pull_request' as const,
    repository: 'acme/payments',
    title: '제목',
    author: 'kim',
    state: 'merged',
    merge_seq: null,
    seq_epoch: null,
    sequence_space: null,
    merged_at: null,
    changed_files_count: null,
    additions: null,
    deletions: null,
    url: null,
  };

  it('**세 상태를 구분한다** — 요약 없음 / 관계 없음 / 관계 있음', () => {
    render(
      <ResultTable
        rows={[
          { ...BASE, pr_number: 1 },
          { ...BASE, pr_number: 2, link_summary: { has_revert: false, reference_count: 0 } },
          { ...BASE, pr_number: 3, link_summary: { is_reverted: true, reference_count: 2 } },
        ]}
        sort={{ field: 'merge_seq', order: 'desc' }}
        onSortChange={() => undefined}
      />,
    );
    const rows = screen.getAllByTestId('result-row');
    // 요약이 없는 행: 배지 영역 자체가 없다 — "관계 없음"으로 읽히면 안 된다.
    expect(within(rows[0] as HTMLElement).queryByTestId('relation-badges')).toBeNull();
    // 값이 있고 전부 비어 있는 행: 역시 배지가 없지만 그것은 "확인했고 없다"이다.
    expect(within(rows[1] as HTMLElement).queryByTestId('relation-badges')).toBeNull();
    // 관계가 있는 행: 라벨 텍스트를 포함한 배지가 있다.
    const third = within(rows[2] as HTMLElement);
    expect(third.getByTestId('relation-badge-is_reverted')).toHaveTextContent('되돌림됨');
    expect(third.getByTestId('relation-badge-references')).toHaveTextContent('참조 2');
  });
});

describe('접근성', () => {
  it('관계 섹션에 axe 위반이 없다', async () => {
    routeFetch([
      {
        match: (url) => url.includes('link_type=reverts') && url.includes('direction=outgoing'),
        body: relationBody('reverts', 'outgoing', [
          {
            link_id: 'a1',
            confidence: 'heuristic',
            evidence: 'Revert "결제"',
            resolved: true,
            ambiguous: true,
            content_available: true,
            endpoint: { kind: 'pull_request', repository: 'acme/payments', pr_number: 8, url: '/pr/acme/payments/8' },
          },
        ]),
      },
      { match: (url) => url.startsWith('/api/relations'), body: null, echo: true },
    ]);
    const { container } = render(
      <RelationSection repository="acme/payments" kind="pull_request" id="1234" sectionId="links" />,
    );
    await userEvent.click(screen.getByTestId('toggle-links'));
    await waitFor(() => {
      expect(screen.getAllByTestId('relation-row').length).toBeGreaterThan(0);
    });
    const found = await violations(container);
    expect(found, describeViolations(found)).toEqual([]);
  });

  it('동시 변경 섹션에 axe 위반이 없다', async () => {
    routeFetch([
      {
        match: (url) => url.startsWith('/api/co-changes'),
        body: {
          available: true,
          items: [
            {
              repository: 'acme/payments',
              pr_number: 77,
              title: '겹치는 PR',
              author: 'lee',
              similarity: 0.5,
              overlapping_paths: ['src/a.ts', 'src/b.ts'],
              url: '/pr/acme/payments/77',
            },
          ],
        },
      },
    ]);
    const { container } = render(
      <CoChangeSection repository="acme/payments" prNumber={1234} sectionId="cochanges" />,
    );
    await userEvent.click(screen.getByTestId('toggle-cochanges'));
    await waitFor(() => {
      expect(screen.getByTestId('cochange-row')).toBeInTheDocument();
    });
    const found = await violations(container);
    expect(found, describeViolations(found)).toEqual([]);
  });

  it('관계 배지가 있는 결과 표에 axe 위반이 없다', async () => {
    const { container } = render(
      <ResultTable
        rows={[
          {
            kind: 'pull_request',
            repository: 'acme/payments',
            pr_number: 9,
            title: '제목',
            author: 'kim',
            state: 'merged',
            merge_seq: 1,
            seq_epoch: 1,
            sequence_space: 'acme/payments@main',
            merged_at: '2026-08-19T05:02:11Z',
            changed_files_count: 2,
            additions: 1,
            deletions: 1,
            link_summary: { has_revert: true, reference_count: 1 },
            url: '/pr/acme/payments/9',
          },
        ]}
        sort={{ field: 'merge_seq', order: 'desc' }}
        onSortChange={() => undefined}
      />,
    );
    const found = await violations(container);
    expect(found, describeViolations(found)).toEqual([]);
  });
});
