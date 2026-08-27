/**
 * W-009 저장소 개요 (WP-034 DoD / QA-W009-*, CR-050).
 *
 * 판정은 `lib/repository-overview.test.ts`가 25건으로 이미 걸었다. 여기서 거는
 * 것은 **그 판정이 실제로 그려지는가**와 접근성이다.
 *
 * 특히 세 값의 구분(`null`·`0`·`unavailable`)은 화면에서만 확인할 수 있다 —
 * 판정 함수가 `unavailable`을 돌려줘도 컴포넌트가 그것을 0으로 그리면 사용자는
 * **틀린 진단**을 받는다.
 */

import { cleanup, render, screen, within } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/repositories',
  useSearchParams: () => new URLSearchParams(''),
}));

const { RepositoryCardGrid } = await import('../components/RepositoryCardGrid');
const { SequenceSpaceStatusList } = await import('../components/SequenceSpaceStatusList');
const { RegisterRequestDialog } = await import('../components/RegisterRequestDialog');

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

type Overview = Parameters<typeof RepositoryCardGrid>[0]['repositories'][number];

function repo(overrides: Partial<Overview> = {}): Overview {
  return {
    repository_id: 4021,
    repository: 'acme/payments',
    registration_state: 'active',
    registered_at: '2026-03-02T04:11:00.000Z',
    last_ingested_at: '2026-08-27T23:58:12.000Z',
    document_counts: { pull_requests: 12, commits: 24, total: 36 },
    backfill: null,
    sequence_spaces: [
      {
        base_branch: 'main',
        last_sequence: 1342,
        seq_epoch: 3,
        sequence_state: 'ok',
        last_assigned_at: '2026-08-27T23:40:02.000Z',
      },
    ],
    reconciliation: { last_completed_at: '2026-08-27T23:00:00.000Z', missing_count: 0 },
    unavailable: [],
    ...overrides,
  };
}

function grid(items: readonly Overview[]): HTMLElement {
  const { container } = render(<RepositoryCardGrid repositories={items} onRetry={() => undefined} />);
  return container;
}

afterEach(cleanup);

describe('QA-W009-01 저장소 카드', () => {
  it('등록 상태·마지막 수집·문서 수·백필이 표시된다', () => {
    grid([repo({ backfill: { state: 'running', job_id: '9', progress: { processed: 8, total: 10 } } })]);
    const card = screen.getByTestId('repository-card');
    expect(within(card).getByTestId('registration-state')).toHaveTextContent('수집 중');
    expect(within(card).getByTestId('last_ingested_at-value')).toBeInTheDocument();
    expect(within(card).getByTestId('document_counts-value')).toHaveTextContent('PR 12건');
    expect(within(card).getByTestId('backfill-state')).toHaveTextContent('진행 중');
  });

  it('**QA-W009-06 해제된 저장소가 상태와 함께 남는다** — 목록에서 빼지 않는다', () => {
    grid([repo({ registration_state: 'archived' })]);
    expect(screen.getByTestId('registration-state')).toHaveTextContent('수집 해제됨');
    expect(screen.getByTestId('archived-note')).toBeInTheDocument();
  });

  it('**QA-W009-08 `null`·`0`·`unavailable`이 서로 다른 문구다**', () => {
    cleanup();
    grid([repo({ last_ingested_at: null })]);
    expect(screen.getByTestId('last_ingested_at-absent')).toHaveTextContent('아직 수집 기록이 없습니다');

    cleanup();
    grid([repo({ last_ingested_at: null, unavailable: ['last_ingested_at'] })]);
    expect(screen.getByTestId('last_ingested_at-unavailable')).toHaveTextContent('확인하지 못했습니다');

    cleanup();
    grid([repo({ document_counts: { pull_requests: 0, commits: 0, total: 0 } })]);
    expect(screen.getByTestId('document_counts-value')).toHaveTextContent('합계 0건');
  });

  it('**QA-W009-07 한 항목이 실패해도 나머지가 남는다**', () => {
    grid([repo({ document_counts: null, unavailable: ['document_counts'] })]);
    const card = screen.getByTestId('repository-card');
    expect(within(card).getByTestId('document_counts-unavailable')).toBeInTheDocument();
    // 나머지 사실은 그대로다.
    expect(within(card).getByTestId('last_ingested_at-value')).toBeInTheDocument();
    expect(within(card).getByTestId('sequence-spaces')).toBeInTheDocument();
    expect(within(card).getByTestId('card-retry')).toBeInTheDocument();
  });

  it('**실행 액션이 없다** (AC-8) — 등록·백필·재채번 버튼을 두지 않는다', () => {
    grid([repo({ backfill: { state: 'running', job_id: '9', progress: {} } })]);
    const card = screen.getByTestId('repository-card');
    for (const label of ['등록', '해제', '백필 실행', '재채번', '재색인']) {
      expect(within(card).queryByRole('button', { name: label })).toBeNull();
    }
  });

  it('QA-W009-03 최근 완료된 조정 스캔 결과가 표시된다', () => {
    cleanup();
    grid([repo()]);
    expect(screen.getByTestId('reconciliation')).toHaveTextContent('누락 없음');

    cleanup();
    grid([repo({ reconciliation: { last_completed_at: null, missing_count: null } })]);
    expect(screen.getByTestId('reconciliation')).toHaveTextContent('완료된 조정 스캔 기록이 없습니다');
  });

  it('axe 위반이 없다', async () => {
    const container = grid([repo(), repo({ repository_id: 4022, repository: 'acme/orders' })]);
    const found = await violations(container);
    expect(describeViolations(found)).toBe('');
  });
});

describe('QA-W009-02 시퀀스 공간 (C-039)', () => {
  const space = {
    base_branch: 'main',
    last_sequence: 1342,
    seq_epoch: 3,
    sequence_state: 'ok' as const,
    last_assigned_at: null,
  };

  it('네 상태가 **텍스트로** 구분된다 — 색만으로 표시하지 않는다', () => {
    render(
      <SequenceSpaceStatusList
        spaces={[
          space,
          { ...space, base_branch: 'a', sequence_state: 'stale' },
          { ...space, base_branch: 'b', sequence_state: 'reassigning' },
          { ...space, base_branch: 'c', sequence_state: 'unknown', last_sequence: null, seq_epoch: null },
        ]}
      />,
    );
    for (const label of ['정상', '갱신 지연', '재채번 중', '아직 채번된 적 없음']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it('**stale에서도 마지막 확정 서수를 보여 준다**', () => {
    render(<SequenceSpaceStatusList spaces={[{ ...space, sequence_state: 'stale' }]} />);
    expect(screen.getByTestId('last-sequence')).toHaveTextContent('1342');
  });

  it('**unknown은 값이 아니라 대시다** — 0으로 그리면 거짓이 된다', () => {
    render(
      <SequenceSpaceStatusList
        spaces={[{ ...space, sequence_state: 'unknown', last_sequence: null, seq_epoch: null }]}
      />,
    );
    expect(screen.getByTestId('last-sequence')).toHaveTextContent('—');
    expect(screen.getByTestId('seq-epoch')).toHaveTextContent('—');
  });

  it('axe 위반이 없다', async () => {
    const { container } = render(<SequenceSpaceStatusList spaces={[space]} />);
    expect(describeViolations(await violations(container))).toBe('');
  });
});

describe('QA-W009-11 등록 검토 요청', () => {
  it('`owner/name`만 받고 브랜치·미러·백필을 받지 않는다', () => {
    render(<RegisterRequestDialog open onOpenChange={() => undefined} />);
    expect(screen.getByTestId('register-request-repository')).toBeInTheDocument();
    for (const label of ['시퀀스 대상 브랜치', '미러', '백필']) {
      expect(screen.queryByText(label)).toBeNull();
    }
  });

  it('**하지 않은 일을 말하지 않는다** — 확인·등록을 주장하는 문구가 없다', () => {
    render(<RegisterRequestDialog open onOpenChange={() => undefined} />);
    const dialog = screen.getByTestId('register-request-dialog');
    const text = dialog.textContent ?? '';
    expect(text).toContain('저장소를 등록하거나 수집을 시작하지 않으며');
    expect(text).not.toContain('저장소를 확인했습니다');
    expect(text).not.toContain('곧 등록됩니다');
  });

  it('axe 위반이 없다', async () => {
    const { container } = render(<RegisterRequestDialog open onOpenChange={() => undefined} />);
    expect(describeViolations(await violations(container))).toBe('');
  });
});
