/**
 * A-001 화면 판정 시험 (WP-040 / FR-ADMIN-001, CR-055).
 */

import { describe, expect, it } from 'vitest';
import {
  POLL_INTERVAL_MS,
  archiveState,
  hasHiddenSlowRepositories,
  isUnavailable,
  mayFetchOperatorData,
  pipelineAccess,
  shouldPoll,
  type PipelineStatusView,
} from './ops-pipeline';

describe('역할이 먼저 판정한다 — 403을 받아 숨기지 않는다 (CR-052 DEV-375)', () => {
  it('`operator`는 전체를 본다', () => {
    expect(pipelineAccess(['operator'])).toBe('full');
  });

  it('`security_officer`만 있으면 아카이브 섹션만 본다', () => {
    expect(pipelineAccess(['security_officer'])).toBe('archive_only');
  });

  it('둘 다 가지면 넓은 쪽이 이긴다', () => {
    expect(pipelineAccess(['security_officer', 'operator'])).toBe('full');
  });

  it('어느 쪽도 아니면 들어오지 못한다', () => {
    expect(pipelineAccess(['developer'])).toBe('none');
    expect(pipelineAccess([])).toBe('none');
  });

  it('`archive_only`는 `operator` 전용 조회를 보내지 않는다', () => {
    // 요청을 보내고 403을 숨기면 권한 판정이 화면 뒤로 밀리고, 감사 로그에
    // 거절된 조회가 사용자 수만큼 쌓인다.
    expect(mayFetchOperatorData('archive_only')).toBe(false);
    expect(mayFetchOperatorData('none')).toBe(false);
    expect(mayFetchOperatorData('full')).toBe(true);
  });
});

describe('부분 실패는 그 항목만 비운다 (FR-ADMIN-001 예외 처리)', () => {
  const status = (overrides: Partial<PipelineStatusView> = {}): PipelineStatusView => ({
    generated_at: '2026-08-30T04:00:00.000Z',
    intake_per_minute: 42,
    dead_letter: { pending: 2 },
    ...overrides,
  });

  it('`unavailable` 배열에 이름이 있으면 미확인이다', () => {
    const value = status({ unavailable: ['stage_latency_seconds'] });
    expect(isUnavailable(value, 'stage_latency_seconds')).toBe(true);
    expect(isUnavailable(value, 'intake_per_minute')).toBe(false);
  });

  it('값이 `"unavailable"` 문자열이어도 미확인이다', () => {
    const value = status({ stage_latency_seconds: { enrich: 'unavailable' } });
    expect(isUnavailable(value, 'stage_latency_seconds')).toBe(false);
    expect(isUnavailable({ ...value, unavailable: ['stage_latency_seconds'] }, 'stage_latency_seconds')).toBe(
      true,
    );
  });

  it('한 항목이 비어도 다른 항목은 정상이다', () => {
    const value = status({ unavailable: ['stage_latency_seconds'] });
    expect(value.intake_per_minute).toBe(42);
    expect(value.dead_letter).toEqual({ pending: 2 });
  });
});

describe('범위 밖 저장소가 있다는 사실을 감추지 않는다 (CR-024, DEV-051)', () => {
  it('목록이 비었는데 건수가 있으면 그 사실을 적는다', () => {
    expect(
      hasHiddenSlowRepositories({
        generated_at: '',
        slowest_repositories: [],
        slowest_repositories_out_of_scope: 3,
      }),
    ).toBe(true);
  });

  it('정말 없으면 적지 않는다 — 두 상태를 같은 모양으로 만들지 않는다', () => {
    expect(
      hasHiddenSlowRepositories({
        generated_at: '',
        slowest_repositories: [],
        slowest_repositories_out_of_scope: 0,
      }),
    ).toBe(false);
  });

  it('목록이 있으면 이 표시는 나오지 않는다', () => {
    expect(
      hasHiddenSlowRepositories({
        generated_at: '',
        slowest_repositories: [{ repository: 'acme/payments' }],
        slowest_repositories_out_of_scope: 3,
      }),
    ).toBe(false);
  });
});

describe('자동 갱신 보류 (QA-A001-09)', () => {
  it('30초 주기다', () => {
    expect(POLL_INTERVAL_MS).toBe(30_000);
  });

  it('조작 중에는 보류한다', () => {
    expect(shouldPoll({ interacting: true, visible: true })).toBe(false);
  });

  it('백그라운드 탭에서는 보류한다', () => {
    expect(shouldPoll({ interacting: false, visible: false })).toBe(false);
  });

  it('둘 다 아니면 갱신한다', () => {
    expect(shouldPoll({ interacting: false, visible: true })).toBe(true);
  });
});

describe('아카이브 상태 (CR-052, DEV-372)', () => {
  it('인덱스가 없는 것과 범위에서 0건인 것은 다르다', () => {
    expect(archiveState({ indexMissing: true, itemCount: 0 })).toBe('archive_unavailable');
    expect(archiveState({ indexMissing: false, itemCount: 0 })).toBe('archive_scope_empty');
    expect(archiveState({ indexMissing: false, itemCount: 5 })).toBe('ready');
  });

  it('인덱스가 없으면 건수와 무관하게 그 사실이 먼저다', () => {
    expect(archiveState({ indexMissing: true, itemCount: 5 })).toBe('archive_unavailable');
  });
});
