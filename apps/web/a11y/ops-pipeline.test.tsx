/**
 * A-001 수집 파이프라인 콘솔 컴포넌트 (WP-040 DoD / QA-A001-01·04·05·06·07, CR-055).
 *
 * 여기서 거는 것은:
 *   - 읽지 못한 지표를 **0으로 그리지 않는가** (AC-1 예외 처리)
 *   - "느린 저장소가 없다"와 "내가 볼 수 없다"를 가르는가 (DEV-051)
 *   - 100건 초과 일괄 재처리가 **재확인을 한 번 더** 요구하는가 (AC-3, QA-A001-05)
 *   - **확인 전에는 `onReprocess`를 부르지 않는가**
 *   - 조정 스캔이 "실행했습니다"로 끝나지 않고 **잡으로** 보이는가 (QA-A003-15)
 *   - axe 위반 0건
 *
 * `archive_only`가 `operator` 조회를 보내지 않는 성질은 뷰 전체가 걸어야
 * 하므로 e2e(FLOW-007)가 네트워크 호출 수로 증명한다.
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PipelineMetricGrid } from '../components/PipelineMetricGrid';
import { DeadLetterTable, type DeadLetterItemView } from '../components/DeadLetterTable';
import { ScanResultCard } from '../components/ScanResultCard';
import type { PipelineStatusView } from '../lib/ops-pipeline';
import type { JobView } from '../lib/ops-jobs';

async function violations(container: HTMLElement): Promise<axe.Result[]> {
  const results = await axe.run(container, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
    rules: { 'color-contrast': { enabled: false } },
  });
  return results.violations;
}

const STATUS: PipelineStatusView = {
  generated_at: '2026-08-30T04:00:00.000Z',
  intake_per_minute: 420,
  queue_depth: { ingest: 12, enrich: 3 },
  // 지표 저장소가 없어 단계별 지연을 읽지 못했다 (DEV-029).
  stage_latency_seconds: { ingest: 'unavailable', enrich: 2.4 },
  dead_letter: { pending: 7 },
  enrichment_pending: 5,
  sequence_space_state: { ready: 12, stale: 1 },
  slowest_repositories: [],
  slowest_repositories_out_of_scope: 3,
  unavailable: ['ingestion_lag_seconds'],
};

function items(count: number): readonly DeadLetterItemView[] {
  return Array.from({ length: count }, (_, index) => ({
    dead_letter_id: index + 1,
    delivery_id: `delivery-${String(index + 1)}`,
    stage: 'ingest',
    repository_id: 4021,
    error: '색인 거부',
    retry_count: 2,
    reprocess_count: 0,
    state: 'pending',
    created_at: '2026-08-30T03:00:00.000Z',
    updated_at: '2026-08-30T03:30:00.000Z',
  }));
}

afterEach(() => {
  cleanup();
});

describe('PipelineMetricGrid (C-040)', () => {
  it('QA-A001-01: 여섯 축을 모두 그린다', () => {
    render(<PipelineMetricGrid metrics={STATUS} />);
    for (const id of [
      'metric-intake',
      'metric-queue-depth',
      'metric-stage-latency',
      'metric-dead-letter',
      'metric-enrichment',
      'metric-sequence-space',
    ]) {
      expect(screen.getByTestId(id)).toBeTruthy();
    }
  });

  it('**읽지 못한 값을 0으로 그리지 않는다** — 축 전체와 값 하나를 모두 본다', () => {
    render(<PipelineMetricGrid metrics={STATUS} />);

    // 축 전체가 미확인 (`unavailable` 배열)
    expect(screen.getByTestId('metric-ingestion-lag').getAttribute('data-unavailable')).toBe('true');
    // 축 안의 값 하나만 미확인 (`"unavailable"` 문자열)
    const latency = screen.getByTestId('metric-stage-latency');
    expect(latency.textContent).toContain('미확인');
    expect(latency.textContent).toContain('2.4초');
    expect(latency.textContent).not.toContain('0.0초');
  });

  it('QA-A001-02: 마지막 갱신 시각을 표시한다', () => {
    render(<PipelineMetricGrid metrics={STATUS} />);
    expect(screen.getByTestId('pipeline-updated-at').textContent).toContain('2026-08-30');
  });

  it('신선도가 지나도 값을 지우지 않는다 — 그 시점의 값임을 적는다', () => {
    render(<PipelineMetricGrid metrics={STATUS} stale />);
    expect(screen.getByTestId('pipeline-metric-grid').getAttribute('data-state')).toBe('stale');
    expect(screen.getByTestId('pipeline-updated-at').textContent).toContain('30초가 지났습니다');
  });

  it('DEV-051: "없다"와 "볼 수 없다"를 가르고 식별자는 주지 않는다', () => {
    render(<PipelineMetricGrid metrics={STATUS} />);
    const empty = screen.getByTestId('laggards-empty').textContent ?? '';
    expect(empty).toContain('접근 범위 안에는 없습니다');
    expect(empty).toContain('3건');
  });

  it('범위 밖도 0이면 그냥 없다고 적는다', () => {
    render(<PipelineMetricGrid metrics={{ ...STATUS, slowest_repositories_out_of_scope: 0 }} />);
    expect(screen.getByTestId('laggards-empty').textContent).toBe('지연 상위 저장소가 없습니다.');
  });

  it('조회 실패도 미확인이며 0이 아니다', () => {
    render(<PipelineMetricGrid metrics={null} failed />);
    expect(screen.getByTestId('pipeline-metrics-failed').textContent).toContain('미확인');
  });

  it('axe 위반 0건', async () => {
    const { container } = render(<PipelineMetricGrid metrics={STATUS} />);
    expect(await violations(container)).toEqual([]);
  });
});

describe('DeadLetterTable (C-041)', () => {
  it('QA-A001-04: 실패 사유·재시도 횟수·전달 식별자를 그린다', () => {
    render(<DeadLetterTable items={items(2)} onReprocess={vi.fn()} />);
    expect(screen.getAllByTestId('dead-letter-error')[0]?.textContent).toBe('색인 거부');
    expect(screen.getAllByTestId('dead-letter-retry')[0]?.textContent).toBe('2');
    expect(screen.getAllByTestId('dead-letter-delivery')[0]?.textContent).toBe('delivery-1');
  });

  it('QA-A001-06: 100건 초과면 경보 상태를 표시한다', () => {
    render(<DeadLetterTable items={items(2)} total={101} onReprocess={vi.fn()} />);
    expect(screen.getByTestId('dead-letter-table').getAttribute('data-alerting')).toBe('true');
    expect(screen.getByTestId('dead-letter-alert')).toBeTruthy();
  });

  it('**확인 전에는 `onReprocess`를 부르지 않는다**', () => {
    const onReprocess = vi.fn();
    render(<DeadLetterTable items={items(2)} onReprocess={onReprocess} />);

    fireEvent.click(screen.getAllByTestId('dead-letter-select')[0] as HTMLElement);
    fireEvent.click(screen.getByTestId('dead-letter-reprocess-open'));
    expect(onReprocess).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('dead-letter-reprocess-confirm'));
    expect(onReprocess).toHaveBeenCalledWith([1]);
  });

  it('**QA-A001-05: 100건 초과 선택은 재확인을 한 번 더 거친다**', () => {
    const onReprocess = vi.fn();
    render(<DeadLetterTable items={items(101)} onReprocess={onReprocess} />);

    for (const box of screen.getAllByTestId('dead-letter-select')) fireEvent.click(box);
    fireEvent.click(screen.getByTestId('dead-letter-reprocess-open'));

    // 첫 확인은 재확인 단계로만 넘어간다 — 서버로 가지 않는다.
    fireEvent.click(screen.getByTestId('dead-letter-reprocess-confirm'));
    expect(onReprocess).not.toHaveBeenCalled();
    expect(screen.getByTestId('dead-letter-dialog').getAttribute('data-phase')).toBe('reconfirm');

    fireEvent.click(screen.getByTestId('dead-letter-reprocess-confirm'));
    expect(onReprocess).toHaveBeenCalledTimes(1);
    expect((onReprocess.mock.calls[0]?.[0] as readonly number[]).length).toBe(101);
  });

  it('대상 건수를 확인 다이얼로그에 명시한다', () => {
    render(<DeadLetterTable items={items(3)} onReprocess={vi.fn()} />);
    for (const box of screen.getAllByTestId('dead-letter-select')) fireEvent.click(box);
    fireEvent.click(screen.getByTestId('dead-letter-reprocess-open'));
    expect(screen.getByTestId('dead-letter-dialog-count').textContent).toContain('3건');
  });

  it('원본을 목록이 자동으로 펼치지 않는다 (THR-044)', () => {
    render(<DeadLetterTable items={items(2)} onReprocess={vi.fn()} onOpenPayload={vi.fn()} />);
    expect(screen.queryByText(/payload/i)).toBeNull();
    expect(screen.getAllByTestId('dead-letter-open-payload')).toHaveLength(2);
  });

  it('axe 위반 0건', async () => {
    const { container } = render(<DeadLetterTable items={items(3)} onReprocess={vi.fn()} />);
    expect(await violations(container)).toEqual([]);
  });
});

const SCAN_JOB: JobView = {
  job_id: 55,
  type: 'reconcile',
  target: 'all',
  state: 'running',
  progress: { done: 4, total: 12 },
  requested_by: 'operator',
  started_at: '2026-08-30T04:00:00.000Z',
  finished_at: null,
  error: null,
  allowed_actions: ['cancel'],
};

describe('ScanResultCard (C-042)', () => {
  it('**QA-A003-15: 버튼을 누른 사실이 아니라 잡 상태를 보인다**', () => {
    render(<ScanResultCard result={null} job={SCAN_JOB} onRun={vi.fn()} />);
    const line = screen.getByTestId('scan-job').textContent ?? '';
    expect(line).toContain('잡 55');
    expect(line).toContain('실행 중');
    expect(line).toContain('4');
    expect(line).not.toContain('실행했습니다');
  });

  it('실행 중이면 다시 누를 수 없다 — 두 번째 잡을 만들지 않는다', () => {
    const onRun = vi.fn();
    render(<ScanResultCard result={null} job={SCAN_JOB} onRun={onRun} />);
    fireEvent.click(screen.getByTestId('scan-run'));
    expect(onRun).not.toHaveBeenCalled();
  });

  it('409를 받으면 실행 중 잡을 가리킨다', () => {
    render(<ScanResultCard result={null} job={null} onRun={vi.fn()} conflictJobId={91} />);
    const conflict = screen.getByTestId('scan-conflict').textContent ?? '';
    expect(conflict).toContain('91');
    expect(conflict).toContain('동시에 돌지 않습니다');
  });

  it('QA-A001-07: 발견 누락 건수를 보이고 미확인을 0으로 대신하지 않는다', () => {
    render(
      <ScanResultCard
        result={{ last_scanned_at: '2026-08-30T02:00:00.000Z', missing_count: null, repositories_scanned: 12, deferred_count: 0 }}
        onRun={vi.fn()}
      />,
    );
    expect(screen.getByTestId('scan-missing').textContent).toBe('미확인');
  });

  it('실행 전에는 누를 수 있다', () => {
    const onRun = vi.fn();
    render(<ScanResultCard result={null} job={null} onRun={onRun} />);
    fireEvent.click(screen.getByTestId('scan-run'));
    expect(onRun).toHaveBeenCalledTimes(1);
  });

  it('axe 위반 0건', async () => {
    const { container } = render(<ScanResultCard result={null} job={SCAN_JOB} onRun={vi.fn()} />);
    expect(await violations(container)).toEqual([]);
  });
});
