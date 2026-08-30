/**
 * A-003 화면 판정 시험 (WP-040 / CR-055).
 *
 * 여기서 거는 것은 **화면이 서버의 판정을 다시 만들지 않는다**는 성질이다.
 */

import { describe, expect, it } from 'vitest';
import {
  BULK_REPROCESS_CONFIRM_THRESHOLD,
  RUN_OPTIONS,
  UNAVAILABLE_LABEL,
  formatBytes,
  formatCount,
  isDualWriting,
  jobControls,
  needsBulkReconfirm,
  progressView,
  reassignConfirmed,
  runBody,
  runOption,
  type AliasStatusView,
  type JobView,
} from './ops-jobs';

const job = (overrides: Partial<JobView> = {}): JobView => ({
  job_id: 1,
  type: 'backfill',
  target: 'acme/payments',
  state: 'running',
  progress: null,
  requested_by: 'alice',
  started_at: null,
  finished_at: null,
  error: null,
  ...overrides,
});

describe('제어 버튼은 서버가 준 목록이다 (FR-ADMIN-002 AC-7 / QA-A003-13)', () => {
  it('`allowed_actions`를 그대로 거른다', () => {
    expect(jobControls(job({ allowed_actions: ['pause', 'cancel'] }))).toEqual(['pause', 'cancel']);
  });

  it('목록이 비면 버튼이 없다 — 상태를 보고 더하지 않는다', () => {
    // `running`이지만 서버가 아무것도 허용하지 않았다. 그것이 답이다.
    expect(jobControls(job({ state: 'running', allowed_actions: [] }))).toEqual([]);
  });

  it('필드가 아예 없으면 빈 목록이다 — 없는 것을 있다고 가정하지 않는다', () => {
    expect(jobControls(job({ state: 'queued' }))).toEqual([]);
  });

  it('서버가 준 순서와 무관하게 고정 순서로 그린다', () => {
    expect(jobControls(job({ allowed_actions: ['cancel', 'pause'] }))).toEqual(['pause', 'cancel']);
  });

  it('모르는 값은 버튼이 되지 않는다', () => {
    expect(jobControls(job({ allowed_actions: ['delete', 'cancel'] }))).toEqual(['cancel']);
  });
});

describe('진행률은 모르는 총계를 0으로 만들지 않는다', () => {
  it('총계가 없으면 비율이 `null`이다', () => {
    const view = progressView(job({ progress: { done: 120, total: null, unit: 'pull_request' } }));
    expect(view.done).toBe(120);
    expect(view.total).toBeNull();
    expect(view.ratio).toBeNull();
  });

  it('총계가 있으면 비율을 낸다', () => {
    expect(progressView(job({ progress: { done: 50, total: 200 } })).ratio).toBeCloseTo(0.25);
  });

  it('비율은 1을 넘지 않는다', () => {
    expect(progressView(job({ progress: { done: 300, total: 200 } })).ratio).toBe(1);
  });

  it('한도 대기는 진행률에 나타난다 — 상태는 `running`을 유지한다 (DEV-104)', () => {
    const view = progressView(
      job({ state: 'running', progress: { waiting_until: '2026-08-30T10:00:00.000Z' } }),
    );
    expect(view.waitingUntil).toBe('2026-08-30T10:00:00.000Z');
  });
});

describe('실행 폼은 러너가 있는 유형만 제시한다 (AC-6 / QA-A003-12)', () => {
  it('각 유형이 자기 API로 간다 — 한 엔드포인트에 몰지 않는다', () => {
    expect(runOption('reindex')?.path).toBe('/api/admin/reindex');
    expect(runOption('sequence_integrity')?.path).toBe('/api/admin/sequence-integrity');
    expect(runOption('backfill')?.path).toBe('/api/admin/jobs');
    expect(runOption('reconcile')?.path).toBe('/api/admin/jobs');
  });

  it('프록시 경로에 `/api/v1`을 적지 않는다 — 프록시가 붙인다', () => {
    for (const option of RUN_OPTIONS) {
      expect(option.path.startsWith('/api/v1')).toBe(false);
    }
  });

  it('조정 스캔은 대상을 보내지 않는다 — 보내면 서버가 거절한다', () => {
    const option = runOption('reconcile');
    expect(option).toBeDefined();
    expect(runBody(option as never, { repository: 'acme/payments' })).toEqual({ type: 'reconcile' });
  });

  it('시퀀스 채번은 저장소와 브랜치를 보낸다 — target 문자열을 조립하지 않는다', () => {
    const option = runOption('sequence_assign');
    expect(runBody(option as never, { repository: 'acme/payments', baseBranch: 'main' })).toEqual({
      type: 'sequence_assign',
      repository: 'acme/payments',
      base_branch: 'main',
    });
  });
});

describe('인덱스 상태는 미확인과 0을 구분한다 (FR-ING-008 AC-7 / QA-A003-14)', () => {
  const alias = (overrides: Partial<AliasStatusView> = {}): AliasStatusView => ({
    alias: 'prs-pull-requests',
    current_index: 'prs-pull-requests-v2',
    document_count: 10,
    store_size_bytes: 2048,
    active_reindex: null,
    last_reindex: null,
    ...overrides,
  });

  it('읽지 못한 문서 수는 미확인이다', () => {
    expect(formatCount(null)).toBe(UNAVAILABLE_LABEL);
  });

  it('0건은 0으로 적는다 — 미확인과 같은 모양이 아니다', () => {
    expect(formatCount(0)).toBe('0');
  });

  it('읽지 못한 크기는 미확인이며 `0 B`가 아니다', () => {
    expect(formatBytes(null)).toBe(UNAVAILABLE_LABEL);
    expect(formatBytes(0)).toBe('0 B');
  });

  it('크기를 사람이 읽는 단위로 적는다', () => {
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(1024 * 1024 * 1024)).toBe('1.0 GB');
  });

  it('이중 쓰기는 활성 재색인과 시작 시각이 함께 있을 때다 (QA-A003-07)', () => {
    expect(isDualWriting(alias())).toBe(false);
    expect(
      isDualWriting(
        alias({
          active_reindex: { job_id: 9, phase: 'backfill', target_index: 'v3', dual_write_since: null },
        }),
      ),
    ).toBe(false);
    expect(
      isDualWriting(
        alias({
          active_reindex: {
            job_id: 9,
            phase: 'backfill',
            target_index: 'v3',
            dual_write_since: '2026-08-30T03:58:00.000Z',
          },
        }),
      ),
    ).toBe(true);
  });
});

describe('재채번 확인은 관대하지 않다 (QA-A003-10 / FLOW-008)', () => {
  it('정확히 같아야 통과한다', () => {
    expect(reassignConfirmed('acme/payments', 'acme/payments')).toBe(true);
  });

  it('공백을 다듬어 주지 않는다 — 비가역 동작의 확인은 증명이다', () => {
    expect(reassignConfirmed(' acme/payments ', 'acme/payments')).toBe(false);
  });

  it('대소문자를 무시하지 않는다', () => {
    expect(reassignConfirmed('ACME/payments', 'acme/payments')).toBe(false);
  });

  it('빈 입력은 통과하지 않는다', () => {
    expect(reassignConfirmed('', 'acme/payments')).toBe(false);
  });
});

describe('일괄 재처리 재확인 경계 (QA-A001-04)', () => {
  it('상한을 넘을 때만 재확인한다', () => {
    expect(needsBulkReconfirm(BULK_REPROCESS_CONFIRM_THRESHOLD)).toBe(false);
    expect(needsBulkReconfirm(BULK_REPROCESS_CONFIRM_THRESHOLD + 1)).toBe(true);
  });
});
