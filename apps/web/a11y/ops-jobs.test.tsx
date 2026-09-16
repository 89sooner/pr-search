/**
 * A-003 인덱스·잡 운영 컴포넌트 (WP-040 DoD / QA-A003-01·07·10·12·13·14·15, CR-055).
 *
 * 순수 판정은 `lib/ops-jobs.test.ts`가 이미 걸었다. 여기서 거는 것은 **그
 * 판정이 실제로 그려지는가**와 접근성이다:
 *   - `allowed_actions`가 빈 잡에 버튼이 없는가 (AC-7, QA-A003-13)
 *   - 총계를 모르는 진행률을 0으로 그리지 않는가
 *   - 인덱스 값의 미확인을 `0`·`0B`로 대신하지 않는가 (AC-7, QA-A003-14)
 *   - **재채번이 확인 전에는 `onReassign`을 부르지 않는가** (QA-A003-10)
 *   - 실행 폼이 러너 있는 유형만 제시하는가 (AC-6, QA-A003-12)
 *   - axe 위반 0건
 */

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { JobTable } from '../components/JobTable';
import { JobRunForm } from '../components/JobRunForm';
import { IndexStatusPanel } from '../components/IndexStatusPanel';
import { IntegrityReportCard } from '../components/IntegrityReportCard';
import { RUN_OPTIONS, type IndexStatusView, type JobView } from '../lib/ops-jobs';

async function violations(container: HTMLElement): Promise<axe.Result[]> {
  const results = await axe.run(container, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
    rules: { 'color-contrast': { enabled: false } },
  });
  return results.violations;
}

const JOBS: readonly JobView[] = [
  {
    job_id: 11,
    type: 'backfill',
    target: 'acme/payments',
    state: 'running',
    // 목록을 끝까지 읽기 전이라 총계를 모른다.
    progress: { done: 120, unit: 'PR' },
    requested_by: 'alice',
    started_at: '2026-08-30T04:00:00.000Z',
    finished_at: null,
    error: null,
    allowed_actions: ['pause', 'cancel'],
  },
  {
    job_id: 12,
    type: 'reconcile',
    target: 'all',
    state: 'running',
    progress: { done: 5, total: 10 },
    requested_by: 'bob',
    started_at: '2026-08-30T04:05:00.000Z',
    finished_at: null,
    // `reconcile`은 `pause`를 지원하지 않는다 — 서버가 목록을 좁혔다.
    error: null,
    allowed_actions: ['cancel'],
  },
  {
    job_id: 13,
    type: 'link_rebuild',
    target: 'acme/payments',
    state: 'cancelled',
    progress: null,
    requested_by: 'alice',
    started_at: '2026-08-30T03:00:00.000Z',
    finished_at: '2026-08-30T03:10:00.000Z',
    error: null,
    // 종료 상태라 제어할 수 없다.
    allowed_actions: [],
  },
];

const INDEX_STATUS: IndexStatusView = {
  generated_at: '2026-08-30T04:10:00.000Z',
  aliases: [
    {
      alias: 'prs-commits',
      current_index: 'prs-commits-v2',
      document_count: 1_200_000,
      store_size_bytes: 3_221_225_472,
      active_reindex: { job_id: 90, phase: 'dual_write', target_index: 'prs-commits-v3', dual_write_since: '2026-08-30T03:50:00.000Z' },
      last_reindex: null,
    },
    {
      alias: 'prs-links',
      current_index: 'prs-links-v1',
      // 통계를 읽지 못했다. **0이 아니다.**
      document_count: null,
      store_size_bytes: null,
      active_reindex: null,
      last_reindex: { job_id: 70, state: 'completed', switched_at: '2026-08-29T10:00:00.000Z' },
    },
  ],
  unavailable: ['prs-links.document_count'],
};

afterEach(() => {
  cleanup();
});

describe('JobTable (C-044)', () => {
  it('QA-A003-13: 서버가 준 `allowed_actions`만 그린다', () => {
    render(<JobTable jobs={JOBS} onAction={vi.fn()} />);
    const rows = screen.getAllByTestId('job-row');

    // 백필은 둘, 조정 스캔은 하나 — 상태가 같아도 목록이 다르다.
    expect(within(rows[0] as HTMLElement).getAllByRole('button')).toHaveLength(2);
    expect(within(rows[1] as HTMLElement).getAllByRole('button')).toHaveLength(1);
    expect(within(rows[1] as HTMLElement).queryByTestId('job-action-pause')).toBeNull();
  });

  it('QA-A003-13: 목록이 비면 버튼을 **하나도** 그리지 않는다', () => {
    render(<JobTable jobs={JOBS} onAction={vi.fn()} />);
    const cancelled = screen.getAllByTestId('job-row')[2] as HTMLElement;
    expect(within(cancelled).queryAllByRole('button')).toHaveLength(0);
    // 제어 칸 안에서 본다 — 진행률 칸도 값 없음을 같은 모양으로 그린다.
    const controls = within(cancelled).getByTestId('job-controls');
    expect(within(controls).getByTestId('job-absent')).toBeTruthy();
  });

  it('상태를 보고 동작을 추론하지 않는다 — `allowed_actions`가 없으면 버튼도 없다', () => {
    /* 키를 빼서 만든다 — `exactOptionalPropertyTypes`가 `undefined` 대입을 막는다. */
    const { allowed_actions: _omitted, ...noField } = JOBS[0] as JobView;
    void _omitted;
    render(<JobTable jobs={[noField]} onAction={vi.fn()} />);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('총계를 모르는 진행률을 **0으로 그리지 않는다**', () => {
    render(<JobTable jobs={JOBS} onAction={vi.fn()} />);
    const unknownTotal = screen.getByTestId('job-progress-count');
    expect(unknownTotal.textContent).toContain("total unknown");
    // 게이지를 만들지 않는다 — 빈 게이지가 "진행 없음"으로 읽힌다.
    expect(within(screen.getAllByTestId('job-row')[0] as HTMLElement).queryByTestId('job-progress-meter')).toBeNull();
  });

  it('총계를 알면 게이지를 그린다', () => {
    render(<JobTable jobs={JOBS} onAction={vi.fn()} />);
    expect(screen.getByTestId('job-progress-meter')).toBeTruthy();
  });

  it('QA-A003-01: 상태를 색만으로 나르지 않는다 — 텍스트 라벨이 있다', () => {
    render(<JobTable jobs={JOBS} onAction={vi.fn()} />);
    const badges = screen.getAllByTestId('job-status');
    expect(badges.length).toBeGreaterThan(0);
    expect(badges.map((badge) => badge.textContent).join(' ')).toContain("Running");
  });

  it('제어를 누르면 잡 식별자와 동작을 그대로 넘긴다', () => {
    const onAction = vi.fn();
    render(<JobTable jobs={JOBS} onAction={onAction} />);
    fireEvent.click(within(screen.getAllByTestId('job-row')[1] as HTMLElement).getByTestId('job-action-cancel'));
    expect(onAction).toHaveBeenCalledWith(12, 'cancel');
  });

  it('axe 위반 0건', async () => {
    const { container } = render(<JobTable jobs={JOBS} onAction={vi.fn()} />);
    expect(await violations(container)).toEqual([]);
  });
});

describe('JobRunForm (C-045)', () => {
  it('QA-A003-12: 러너가 있는 유형만 제시한다', () => {
    render(<JobRunForm onSubmit={vi.fn()} />);
    const options = within(screen.getByTestId('job-run-type')).getAllByRole('option');
    expect(options.map((option) => option.getAttribute('value'))).toEqual(RUN_OPTIONS.map((item) => item.type));
  });

  it('`reconcile`은 대상을 묻지 않는다 — 서버가 정한다', () => {
    render(<JobRunForm onSubmit={vi.fn()} />);
    fireEvent.change(screen.getByTestId('job-run-type'), { target: { value: 'reconcile' } });
    expect(screen.queryByTestId('job-run-repository')).toBeNull();
    expect(screen.getByTestId('job-run-no-target')).toBeTruthy();
  });

  it('`sequence_assign`은 저장소와 브랜치를 따로 받는다 — 문자열을 그대로 받지 않는다', () => {
    const onSubmit = vi.fn();
    render(<JobRunForm onSubmit={onSubmit} />);
    fireEvent.change(screen.getByTestId('job-run-type'), { target: { value: 'sequence_assign' } });
    fireEvent.change(screen.getByTestId('job-run-repository'), { target: { value: 'acme/payments' } });
    fireEvent.change(screen.getByTestId('job-run-branch'), { target: { value: 'main' } });
    fireEvent.click(screen.getByTestId('job-run-submit'));

    expect(onSubmit).toHaveBeenCalledWith({
      option: expect.objectContaining({ type: 'sequence_assign', path: '/api/admin/jobs' }),
      body: { type: 'sequence_assign', repository: 'acme/payments', base_branch: 'main' },
    });
  });

  it('재색인은 `API-ADM-004`로 간다 — 일반 잡 경로에 몰지 않는다', () => {
    const onSubmit = vi.fn();
    render(<JobRunForm onSubmit={onSubmit} />);
    fireEvent.change(screen.getByTestId('job-run-type'), { target: { value: 'reindex' } });
    fireEvent.change(screen.getByTestId('job-run-alias'), { target: { value: 'prs-commits' } });
    fireEvent.click(screen.getByTestId('job-run-submit'));

    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({
      option: { path: '/api/admin/reindex' },
      body: { alias: 'prs-commits' },
    });
  });

  it('재료가 비면 제출하지 않는다', () => {
    const onSubmit = vi.fn();
    render(<JobRunForm onSubmit={onSubmit} />);
    fireEvent.click(screen.getByTestId('job-run-submit'));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('axe 위반 0건', async () => {
    const { container } = render(<JobRunForm onSubmit={vi.fn()} />);
    expect(await violations(container)).toEqual([]);
  });
});

describe('IndexStatusPanel (C-046)', () => {
  it('QA-A003-14: 읽지 못한 값을 `0`·`0B`로 대신하지 않는다', () => {
    render(<IndexStatusPanel status={INDEX_STATUS} />);
    const rows = screen.getAllByTestId('index-row');
    const links = rows.find((row) => row.getAttribute('data-alias') === 'prs-links') as HTMLElement;

    expect(within(links).getAllByTestId('index-unavailable').length).toBe(2);
    expect(links.textContent).not.toContain('0 B');
  });

  it('QA-A003-14: 값 하나를 못 읽어도 나머지 행은 정상 표시한다', () => {
    render(<IndexStatusPanel status={INDEX_STATUS} />);
    const commits = screen
      .getAllByTestId('index-row')
      .find((row) => row.getAttribute('data-alias') === 'prs-commits') as HTMLElement;
    expect(commits.textContent).toContain('1,200,000');
  });

  it('QA-A003-07: 이중 쓰기를 상시 표시한다', () => {
    render(<IndexStatusPanel status={INDEX_STATUS} />);
    const active = screen.getByTestId('index-active-reindex');
    expect(active.getAttribute('data-dual-write')).toBe('true');
    expect(active.textContent).toContain("Dual writing");
    expect(screen.getByTestId('index-status-panel').getAttribute('data-state')).toBe('reindex_dual_write');
  });

  it('조회 실패도 미확인으로 적고 0이라 하지 않는다', () => {
    render(<IndexStatusPanel status={null} failed />);
    expect(screen.getByTestId('index-status-panel').getAttribute('data-state')).toBe('index_status_unavailable');
    expect(screen.getByTestId('index-status-failed').textContent).toContain("Unknown");
  });

  it('axe 위반 0건', async () => {
    const { container } = render(<IndexStatusPanel status={INDEX_STATUS} />);
    expect(await violations(container)).toEqual([]);
  });
});

const MISMATCH = {
  repository: 'acme/payments',
  base_branch: 'main',
  seq_epoch: 3,
  checked_at: '2026-08-30T04:00:00.000Z',
  consistent: false,
  first_mismatch_seq: 1207,
  stored_sha: 'a'.repeat(40),
  actual_sha: 'b'.repeat(40),
  checked_count: 200,
};

const IMPACT = {
  affected_commit_count: 143,
  invalidated_safe_marker_count: 2,
  affected_saved_search_count: 7,
};

describe('IntegrityReportCard (C-047)', () => {
  it('AC-3: 최초 불일치와 두 SHA를 함께 보인다', () => {
    render(<IntegrityReportCard report={MISMATCH} impact={IMPACT} onReassign={vi.fn()} />);
    expect(screen.getByTestId('integrity-first-mismatch').textContent).toBe('1207');
    const shas = screen.getByTestId('integrity-shas').textContent ?? '';
    expect(shas).toContain('a'.repeat(40));
    expect(shas).toContain('b'.repeat(40));
  });

  it('**QA-A003-10: 확인 전에는 `onReassign`을 부르지 않는다**', () => {
    const onReassign = vi.fn();
    render(<IntegrityReportCard report={MISMATCH} impact={IMPACT} onReassign={onReassign} />);

    // 다이얼로그를 열기만 해도 아무 일이 없다.
    fireEvent.click(screen.getByTestId('integrity-reassign-open'));
    expect(onReassign).not.toHaveBeenCalled();

    // 틀린 문자열을 넣고 눌러도 나가지 않는다.
    fireEvent.change(screen.getByTestId('reassign-confirm-input'), { target: { value: 'acme/payment' } });
    fireEvent.click(screen.getByTestId('reassign-confirm-submit'));
    expect(onReassign).not.toHaveBeenCalled();
  });

  it('확인 문자열이 정확히 같아야 실행된다 — 공백도 대소문자도 봐준다고 하지 않는다', () => {
    const onReassign = vi.fn();
    render(<IntegrityReportCard report={MISMATCH} impact={IMPACT} onReassign={onReassign} />);
    fireEvent.click(screen.getByTestId('integrity-reassign-open'));

    fireEvent.change(screen.getByTestId('reassign-confirm-input'), { target: { value: ' acme/payments ' } });
    fireEvent.click(screen.getByTestId('reassign-confirm-submit'));
    expect(onReassign).not.toHaveBeenCalled();

    fireEvent.change(screen.getByTestId('reassign-confirm-input'), { target: { value: 'ACME/PAYMENTS' } });
    fireEvent.click(screen.getByTestId('reassign-confirm-submit'));
    expect(onReassign).not.toHaveBeenCalled();

    fireEvent.change(screen.getByTestId('reassign-confirm-input'), { target: { value: 'acme/payments' } });
    fireEvent.click(screen.getByTestId('reassign-confirm-submit'));
    expect(onReassign).toHaveBeenCalledTimes(1);
  });

  it('영향 범위 셋을 보인다 — 화면이 다시 세지 않는다', () => {
    render(<IntegrityReportCard report={MISMATCH} impact={IMPACT} onReassign={vi.fn()} />);
    fireEvent.click(screen.getByTestId('integrity-reassign-open'));
    const impact = screen.getByTestId('reassign-impact').textContent ?? '';
    expect(impact).toContain('143');
    expect(impact).toContain('2');
    expect(impact).toContain('7');
  });

  it('영향 범위를 모르면 미확인으로 적고 0으로 지어내지 않는다', () => {
    render(<IntegrityReportCard report={MISMATCH} impact={null} onReassign={vi.fn()} />);
    fireEvent.click(screen.getByTestId('integrity-reassign-open'));
    expect(screen.getAllByTestId('impact-unavailable')).toHaveLength(3);
  });

  it('일치하면 재채번 버튼을 그리지 않는다', () => {
    render(<IntegrityReportCard report={{ ...MISMATCH, consistent: true }} onReassign={vi.fn()} />);
    expect(screen.queryByTestId('integrity-reassign-open')).toBeNull();
    expect(screen.getByTestId('integrity-consistent')).toBeTruthy();
  });

  it('axe 위반 0건', async () => {
    const { container } = render(<IntegrityReportCard report={MISMATCH} impact={IMPACT} onReassign={vi.fn()} />);
    expect(await violations(container)).toEqual([]);
  });
});
