/**
 * 저장소 개요의 화면 판정 (W-009 / WP-034, CR-050).
 *
 * 이 파일이 지키는 것은 **세 값의 구분**이다 — `null`(기록 없음) · `0`(확인된
 * 영) · `unavailable`(조회 실패). 셋을 섞으면 사용자는 "수집이 안 됐다"는 틀린
 * 진단을 받고, 이 화면의 목적이 정확히 그 오독을 막는 것이다.
 */

import { describe, expect, it } from 'vitest';
import {
  ARCHIVED_NOTE,
  EMPTY_NO_REPOSITORY_MESSAGE,
  REGISTRATION_LABEL,
  SEQUENCE_LABEL,
  backfillLabel,
  backfillProgress,
  hasSequenceValue,
  isAxisUnavailable,
  isBackfillActive,
  reconciliationSummary,
  resolveOverviewState,
  retryQuery,
  valueKind,
  type RepositoryOverview,
} from './repository-overview';

function item(overrides: Partial<RepositoryOverview> = {}): RepositoryOverview {
  return {
    repository_id: 1,
    repository: 'acme/payments',
    registration_state: 'active',
    registered_at: '2026-03-02T04:11:00.000Z',
    last_ingested_at: '2026-08-27T23:58:12.000Z',
    document_counts: { pull_requests: 12, commits: 24, total: 36 },
    backfill: null,
    sequence_spaces: [],
    reconciliation: { last_completed_at: '2026-08-27T23:00:00.000Z', missing_count: 0 },
    unavailable: [],
    ...overrides,
  };
}

describe('화면 상태 (상태 매트릭스 W-009)', () => {
  const base = {
    loading: false,
    resumed: false,
    items: [item()],
    nextCursor: null,
    cursorFailed: false,
    loadFailed: false,
  };

  it('첫 조회 중에는 loading_initial이다', () => {
    expect(resolveOverviewState({ ...base, loading: true, items: null })).toBe('loading_initial');
  });

  it('**이어 보기 중에는 loading_more다** — 기존 카드를 유지해야 한다', () => {
    expect(resolveOverviewState({ ...base, loading: true, resumed: true })).toBe('loading_more');
  });

  it('정상이면 ready다', () => {
    expect(resolveOverviewState(base)).toBe('ready');
  });

  it('빈 목록에 커서도 없으면 empty_no_repository다', () => {
    expect(resolveOverviewState({ ...base, items: [] })).toBe('empty_no_repository');
  });

  it('**빈 목록이어도 커서가 있으면 끝이 아니다** (DEV-357) — 범위 밖 구간을 지나는 중이다', () => {
    /*
     * 서버가 한 요청에 정본을 다 훑지 못하면 빈 페이지에 유효한 커서를 붙여
     * 준다. 이것을 `empty_no_repository`로 그리면 사용자는 "볼 수 있는
     * 저장소가 없다"는 틀린 사실을 받는다.
     */
    expect(resolveOverviewState({ ...base, items: [], nextCursor: 'NEXT' })).toBe('loading_more');
  });

  it('**커서 실패가 조회 실패보다 앞선다** — 사유가 다르면 안내도 달라야 한다', () => {
    expect(resolveOverviewState({ ...base, cursorFailed: true, loadFailed: true })).toBe('error_cursor');
  });

  it('조회 실패는 error_load다', () => {
    expect(resolveOverviewState({ ...base, loadFailed: true })).toBe('error_load');
  });

  it('**실패가 로딩보다 앞선다** — 실패한 채로 도는 스피너를 그리지 않는다', () => {
    expect(resolveOverviewState({ ...base, loading: true, loadFailed: true })).toBe('error_load');
  });
});

describe('세 값의 구분', () => {
  it('**조회 실패가 기록 없음보다 앞선다** — 없는 사실을 주장하지 않는다', () => {
    const failed = item({ last_ingested_at: null, unavailable: ['last_ingested_at'] });
    expect(valueKind(failed, 'last_ingested_at', failed.last_ingested_at)).toBe('unavailable');
  });

  it('값이 null이면 absent다', () => {
    const none = item({ last_ingested_at: null });
    expect(valueKind(none, 'last_ingested_at', none.last_ingested_at)).toBe('absent');
  });

  it('**0은 present다** — 확인된 영과 기록 없음은 다르다', () => {
    const zero = item({ document_counts: { pull_requests: 0, commits: 0, total: 0 } });
    expect(valueKind(zero, 'document_counts', zero.document_counts)).toBe('present');
  });

  it('다른 축의 실패가 이 축을 미확인으로 만들지 않는다', () => {
    const partial = item({ unavailable: ['backfill'] });
    expect(isAxisUnavailable(partial, 'backfill')).toBe(true);
    expect(isAxisUnavailable(partial, 'document_counts')).toBe(false);
  });
});

describe('등록 상태 (AC-7)', () => {
  it('두 상태에 각각 문구가 있다', () => {
    expect(REGISTRATION_LABEL.active).not.toBe(REGISTRATION_LABEL.archived);
  });

  it('**해제 안내가 기존 자료의 존속을 함께 말한다** — "사라졌다"로 읽히지 않는다', () => {
    expect(ARCHIVED_NOTE).toContain("Previously collected data remains searchable");
  });
});

describe('빈 목록 문구 (AC-10)', () => {
  it('**"GitHub에 접근 가능한 저장소가 없다"로 말하지 않는다**', () => {
    expect(EMPTY_NO_REPOSITORY_MESSAGE).toContain('PR Search');
    expect(EMPTY_NO_REPOSITORY_MESSAGE).not.toContain('GitHub');
  });
});

describe('시퀀스 공간', () => {
  const space = {
    base_branch: 'main',
    last_sequence: 1342,
    seq_epoch: 3,
    sequence_state: 'ok' as const,
    last_assigned_at: null,
  };

  it('네 상태에 전부 텍스트 레이블이 있다 — 색만으로 구분하지 않는다', () => {
    for (const state of ['ok', 'stale', 'reassigning', 'unknown'] as const) {
      expect(SEQUENCE_LABEL[state].length).toBeGreaterThan(0);
    }
    expect(new Set(Object.values(SEQUENCE_LABEL)).size).toBe(4);
  });

  it('**stale·reassigning에서도 값을 보여 준다** — 경고만 남기면 정보가 없다', () => {
    expect(hasSequenceValue({ ...space, sequence_state: 'stale' })).toBe(true);
    expect(hasSequenceValue({ ...space, sequence_state: 'reassigning' })).toBe(true);
  });

  it('**unknown은 값이 없는 상태다** — 0으로 그리면 "0번까지 채번됐다"는 거짓이다', () => {
    expect(hasSequenceValue({ ...space, sequence_state: 'unknown', last_sequence: null })).toBe(false);
    expect(SEQUENCE_LABEL.unknown).toContain("Never numbered");
  });
});

describe('백필', () => {
  it('잡이 없으면 "요청된 적 없음"이다', () => {
    expect(backfillLabel(null)).toBe("Never requested");
    expect(isBackfillActive(null)).toBe(false);
    expect(backfillProgress(null)).toBeNull();
  });

  it('진행 중 상태를 가려낸다', () => {
    expect(isBackfillActive({ state: 'running', job_id: '1', progress: {} })).toBe(true);
    expect(isBackfillActive({ state: 'queued', job_id: '1', progress: {} })).toBe(true);
    expect(isBackfillActive({ state: 'succeeded', job_id: '1', progress: {} })).toBe(false);
  });

  it('진행률을 계산한다', () => {
    const progress = backfillProgress({
      state: 'running',
      job_id: '1',
      progress: { processed: 820, total: 1200 },
    });
    expect(progress?.processed).toBe(820);
    expect(progress?.ratio).toBeCloseTo(820 / 1200);
  });

  it('**총량을 모르면 비율도 없다** — 0으로 두면 "시작도 안 했다"로 읽힌다', () => {
    expect(backfillProgress({ state: 'running', job_id: '1', progress: {} })).toBeNull();
    expect(
      backfillProgress({ state: 'running', job_id: '1', progress: { processed: 5, total: 0 } }),
    ).toBeNull();
  });

  it('알 수 없는 상태는 그대로 보여 준다 — 계약이 job.state를 그대로 쓴다', () => {
    expect(backfillLabel({ state: 'weird', job_id: '1', progress: {} })).toBe('weird');
  });
});

describe('조정 스캔 문구 (AC-6)', () => {
  it('**조회 실패·기록 없음·확인된 건수 셋을 가른다**', () => {
    expect(reconciliationSummary(item({ unavailable: ['reconciliation'] }))).toBe("Could not verify");
    expect(
      reconciliationSummary(item({ reconciliation: { last_completed_at: null, missing_count: null } })),
    ).toBe("No completed reconciliation scan");
    expect(reconciliationSummary(item())).toBe("No missing items");
    expect(
      reconciliationSummary(
        item({ reconciliation: { last_completed_at: '2026-08-27T23:00:00.000Z', missing_count: 3 } }),
      ),
    ).toBe("Missing items: 3");
  });

  it('**0과 null이 다른 문구다**', () => {
    const zero = reconciliationSummary(item());
    const none = reconciliationSummary(
      item({ reconciliation: { last_completed_at: null, missing_count: null } }),
    );
    expect(zero).not.toBe(none);
  });
});

describe('재시도 질의', () => {
  it('슬래시를 인코딩한다 — 경로로 해석되지 않는다', () => {
    expect(retryQuery('acme/payments')).toBe('repository=acme%2Fpayments');
  });
});
