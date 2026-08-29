/**
 * W-006 순수 계층 시험 (WP-038 / FR-STAT-001~006).
 *
 * 겨냥하는 것은 "숫자가 조용히 틀리는" 자리다: 에폭이 낡았는데 0으로 그리는가,
 * `seq:`가 없는데 에폭을 싣는가, unknown 구간에 드릴다운을 만드는가. 통합 시험이
 * 경계를 비켜 가면 그 규칙은 코드에만 있고 시험에는 없다(WP-037 세션).
 */

import { describe, expect, it } from 'vitest';
import {
  readAnalyticsState,
  writeAnalyticsState,
  analyticsHref,
  buildGroupsRequest,
  buildTimeSeriesRequest,
  buildPercentilesRequest,
  buildDistributionsRequest,
  resolvePanelState,
  drillDownHref,
  bucketDrillDownHref,
  readPercentileValues,
  EMPTY_ANALYTICS_STATE,
  type AnalyticsUrlState,
} from './analytics';

const BASE: AnalyticsUrlState = { ...EMPTY_ANALYTICS_STATE };
const SEQ: AnalyticsUrlState = { ...EMPTY_ANALYTICS_STATE, q: 'seq:1200..1350', seqEpoch: 'abc123' };

describe('URL 상태', () => {
  it('FR-STAT-001: group_by가 지원 키가 아니면 null로 접는다', () => {
    expect(readAnalyticsState('group_by=team').groupBy).toBe('team');
    expect(readAnalyticsState('group_by=nonsense').groupBy).toBe(null);
    expect(readAnalyticsState('group_by=allowed_team_ids').groupBy).toBe(null);
  });

  it('FR-STAT-002: interval이 지원 값이 아니면 기본 day', () => {
    expect(readAnalyticsState('interval=week').interval).toBe('week');
    expect(readAnalyticsState('interval=fortnight').interval).toBe('day');
    expect(readAnalyticsState('').interval).toBe('day');
  });

  it('기본값은 URL에 싣지 않는다 — 딥링크가 짧게 유지된다', () => {
    expect(writeAnalyticsState(BASE)).toBe('');
    expect(analyticsHref(BASE)).toBe('/analytics');
    expect(writeAnalyticsState({ ...BASE, interval: 'day', timezone: 'Asia/Seoul' })).toBe('');
  });

  it('CR-051: seq: 범위가 없으면 seq_epoch을 쓰지 않는다', () => {
    // seq:가 없는 질의에 에폭이 붙어 있어도 URL에 싣지 않는다.
    const noSeq: AnalyticsUrlState = { ...BASE, q: 'org:acme', seqEpoch: 'abc123' };
    expect(writeAnalyticsState(noSeq)).not.toContain('seq_epoch');
    // seq: 범위가 있으면 원문 그대로 싣는다.
    expect(writeAnalyticsState(SEQ)).toContain('seq_epoch=abc123');
  });

  it('라운드트립: 읽고 쓴 상태가 같은 뜻을 유지한다', () => {
    const href = analyticsHref({ ...BASE, q: 'org:acme', groupBy: 'team', interval: 'week' });
    const search = href.split('?')[1] ?? '';
    const back = readAnalyticsState(search);
    expect(back.q).toBe('org:acme');
    expect(back.groupBy).toBe('team');
    expect(back.interval).toBe('week');
  });
});

describe('요청 본문', () => {
  it('group_by가 null이면 요청에 넣지 않는다 (전체 집계)', () => {
    expect('group_by' in buildGroupsRequest(BASE)).toBe(false);
    expect(buildGroupsRequest({ ...BASE, groupBy: 'author' })['group_by']).toBe('author');
  });

  it('그룹 요청은 지표 넷을 싣는다', () => {
    expect(buildGroupsRequest(BASE)['metrics']).toEqual([
      'count',
      'changed_files_sum',
      'additions_sum',
      'lead_time_median',
    ]);
  });

  it('CR-051: seq_epoch은 seq: 범위가 있을 때만 요청에 붙는다', () => {
    expect('seq_epoch' in buildGroupsRequest(BASE)).toBe(false);
    expect('seq_epoch' in buildGroupsRequest({ ...BASE, seqEpoch: 'abc' })).toBe(false); // seq: 없음
    expect(buildGroupsRequest(SEQ)['seq_epoch']).toBe('abc123');
    expect(buildTimeSeriesRequest(SEQ)['seq_epoch']).toBe('abc123');
    expect(buildPercentilesRequest(SEQ, 'lead_time_seconds')['seq_epoch']).toBe('abc123');
    expect(buildDistributionsRequest(SEQ, 'changed_files')['seq_epoch']).toBe('abc123');
  });

  it('시계열은 interval·timezone·metric을 싣고, from/to는 있을 때만', () => {
    const req = buildTimeSeriesRequest({ ...BASE, interval: 'month', timezone: 'UTC' });
    expect(req['interval']).toBe('month');
    expect(req['timezone']).toBe('UTC');
    expect(req['metric']).toBe('count');
    expect('from' in req).toBe(false);
    const dated = buildTimeSeriesRequest({ ...BASE, from: '2026-07-01T00:00:00Z', to: '2026-08-01T00:00:00Z' });
    expect(dated['from']).toBe('2026-07-01T00:00:00Z');
  });
});

describe('패널 상태 판정', () => {
  const loginPath = '/login';
  const input = (over: Partial<Parameters<typeof resolvePanelState>[0]>) =>
    resolvePanelState({ loading: false, networkFailed: false, status: 200, body: {}, loginPath, ...over });

  it('로딩과 오프라인이 먼저다', () => {
    expect(input({ loading: true }).kind).toBe('loading');
    expect(input({ networkFailed: true }).kind).toBe('offline');
  });

  it('DEV-384: epoch_stale는 200에 실려 오고 오류보다 먼저 판정한다', () => {
    const state = input({
      status: 200,
      body: { epoch_stale: true, requested_seq_epoch: 'old', sequence_context: { space: 'acme/a@main' } },
    });
    expect(state.kind).toBe('epoch_stale');
    if (state.kind === 'epoch_stale') {
      expect(state.requested).toBe('old');
      expect(state.context).toEqual({ space: 'acme/a@main' });
    }
  });

  it('epoch_stale를 empty로 착각하지 않는다 — isEmpty가 참이어도 stale이 이긴다', () => {
    const state = input({ status: 200, body: { epoch_stale: true }, isEmpty: true });
    expect(state.kind).toBe('epoch_stale');
  });

  it('401은 재인증, 접근 범위 없음은 no_permission', () => {
    expect(input({ status: 401, body: { error: { code: 'UNAUTHENTICATED', message: '' } } }).kind).toBe('auth_expired');
    expect(input({ status: 503, body: { error: { code: 'PERMISSION_UNAVAILABLE', message: '' } } }).kind).toBe('no_permission');
  });

  it('FR-STAT-002: TOO_MANY_BUCKETS는 상세(개수·상한)를 싣는다', () => {
    const state = input({
      status: 400,
      body: { error: { code: 'TOO_MANY_BUCKETS', message: '', detail: { bucket_count: 512, max: 400 } } },
    });
    expect(state.kind).toBe('error_too_many_buckets');
    if (state.kind === 'error_too_many_buckets') {
      expect(state.bucketCount).toBe(512);
      expect(state.max).toBe(400);
    }
  });

  it('AGGREGATION_TIMEOUT(504)는 timeout 상태', () => {
    expect(input({ status: 504, body: { error: { code: 'AGGREGATION_TIMEOUT', message: '' } } }).kind).toBe(
      'error_aggregation_timeout',
    );
  });

  it('FR-STAT-006: approximate는 배지로 그리고, 빈 데이터와 구분한다', () => {
    expect(input({ body: { approximate: true, sample_probability: 0.1 } }).kind).toBe('approximate');
    expect(input({ isEmpty: true, body: {} }).kind).toBe('empty_no_data');
    expect(input({ body: { approximate: false, total: { value: 42, relation: 'eq' } } }).kind).toBe('ready');
  });
});

describe('드릴다운 (근거 목록으로)', () => {
  it('FR-STAT-001 AC-5: 서버 drill_down_query를 그대로 넘긴다', () => {
    const href = drillDownHref('kind:pull_request org:acme author_team:payments', null);
    expect(href).toBe('/search?q=kind%3Apull_request+org%3Aacme+author_team%3Apayments');
  });

  it('FR-STAT-005 AC-5: unknown 구간은 드릴다운이 없다 (null → 링크 없음)', () => {
    expect(drillDownHref(null, null)).toBe(null);
    expect(drillDownHref('', null)).toBe(null);
  });

  it('CR-051: 드릴다운에 seq: 범위가 있을 때만 에폭을 보존한다', () => {
    expect(drillDownHref('org:acme', 'abc')).not.toContain('seq_epoch');
    expect(drillDownHref('seq:1200..1350', 'abc')).toContain('seq_epoch=abc');
  });

  it('DEV-396: 시계열 버킷은 클라이언트가 기간 범위를 만든다 (일 간격)', () => {
    const href = bucketDrillDownHref('org:acme', '2026-07-01T00:00:00.000Z', 'day', null);
    expect(href).not.toBe(null);
    // 하루 뒤까지의 merged: 범위를 포함한다.
    expect(href).toContain('merged');
    expect(decodeURIComponent(href ?? '')).toContain('2026-07-02T00:00:00.000Z');
  });

  it('DEV-396: 월 간격은 한 달 뒤로 경계를 잡는다', () => {
    const href = bucketDrillDownHref('', '2026-01-15T00:00:00.000Z', 'month', null);
    expect(decodeURIComponent(href ?? '')).toContain('2026-02-15T00:00:00.000Z');
  });

  it('잘못된 버킷 시각은 링크를 만들지 않는다', () => {
    expect(bucketDrillDownHref('org:acme', 'not-a-date', 'day', null)).toBe(null);
  });
});

describe('백분위 응답 읽기', () => {
  it('FR-STAT-003: spread된 백분위 값에서 요청한 것만 읽는다', () => {
    const values = readPercentileValues({ '50': 61200, '75': 80000, '90': 120000, '95': 200000, '99': 400000 });
    expect(values).toEqual({ '50': 61200, '75': 80000, '90': 120000, '95': 200000, '99': 400000 });
  });

  it('없는 백분위 키는 건너뛴다 (undefined를 0으로 만들지 않는다)', () => {
    const values = readPercentileValues({ '50': 61200 }, [50, 90]);
    expect(values).toEqual({ '50': 61200 });
    expect('90' in values).toBe(false);
  });
});
