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
  bucketHeadingFor,
  bucketLabelFor,
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
    const dated = buildTimeSeriesRequest({ ...BASE, from: '2026-07-01', to: '2026-07-31' });
    expect(dated['from']).toBe('2026-07-01');
    expect(dated['to']).toBe('2026-07-31');
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

  const KST = { timezone: 'Asia/Seoul', appliedRange: null } as const;
  const qOf = (href: string | null): string => new URLSearchParams((href ?? '').split('?')[1] ?? '').get('q') ?? '';

  it('DEV-396·CR-127: 일 버킷은 그 시간대의 한국 날짜 하루다 — 끝을 1ms 빼서 만들지 않는다', () => {
    const href = bucketDrillDownHref('org:acme', '2026-09-27T00:00:00.000+09:00', 'day', null, KST);
    expect(qOf(href)).toBe('org:acme merged:2026-09-27..2026-09-27@Asia/Seoul');
  });

  it('DEV-781: KST 월 버킷은 그 달 1일부터 말일까지다 — UTC 달 더하기로 하루를 더하거나 빼지 않는다', () => {
    expect(qOf(bucketDrillDownHref('', '2026-09-01T00:00:00.000+09:00', 'month', null, KST))).toBe('merged:2026-09-01..2026-09-30@Asia/Seoul');
    expect(qOf(bucketDrillDownHref('', '2026-10-01T00:00:00.000+09:00', 'month', null, KST))).toBe('merged:2026-10-01..2026-10-31@Asia/Seoul');
    expect(qOf(bucketDrillDownHref('', '2026-02-01T00:00:00.000+09:00', 'month', null, KST))).toBe('merged:2026-02-01..2026-02-28@Asia/Seoul');
    expect(qOf(bucketDrillDownHref('', '2024-02-01T00:00:00.000+09:00', 'month', null, KST))).toBe('merged:2024-02-01..2024-02-29@Asia/Seoul');
  });

  it('주 버킷은 그 주의 첫날부터 7일이고, 적용 기간과 겹친 만큼만 간다', () => {
    // 2026-09-21은 월요일이다. 적용 기간이 수요일(9/23)에 시작하면 그 앞은 버킷에 없었다.
    const calendar = { timezone: 'Asia/Seoul', appliedRange: { from: '2026-09-23', to: '2026-09-25' } } as const;
    expect(qOf(bucketDrillDownHref('', '2026-09-21T00:00:00.000+09:00', 'week', null, calendar))).toBe('merged:2026-09-23..2026-09-25@Asia/Seoul');
    expect(qOf(bucketDrillDownHref('', '2026-09-21T00:00:00.000+09:00', 'week', null, KST))).toBe('merged:2026-09-21..2026-09-27@Asia/Seoul');
  });

  it('시각으로 적은 적용 기간이면 그 안에 온전히 든 버킷만 달력 범위로 가고, 걸친 버킷은 링크가 없다', () => {
    // KST 9/27 하루는 [09-26T15:00Z, 09-27T15:00Z)다. 적용 기간이 그 하루를 다 덮으면 링크, 반만 덮으면 없다.
    const covering = { timezone: 'Asia/Seoul', appliedRange: { from: '2026-09-26T15:00:00Z', to: '2026-09-27T15:00:00Z' } } as const;
    expect(qOf(bucketDrillDownHref('', '2026-09-27T00:00:00.000+09:00', 'day', null, covering))).toBe('merged:2026-09-27..2026-09-27@Asia/Seoul');
    const partial = { timezone: 'Asia/Seoul', appliedRange: { from: '2026-09-27T00:00:00Z', to: '2026-09-28T00:00:00Z' } } as const;
    expect(bucketDrillDownHref('', '2026-09-27T00:00:00.000+09:00', 'day', null, partial)).toBe(null);
  });

  it('오프셋 없는 시각형 적용 기간은 UTC로 읽는다 — 브라우저 시간대가 달라도 같은 링크다 (CR-127)', () => {
    // UTC로 읽으면 KST 9/27 하루를 정확히 덮는다. 서울·LA 시간대로 읽으면 걸친 기간이 되어 링크가 사라진다.
    const naive = { timezone: 'Asia/Seoul', appliedRange: { from: '2026-09-26T15:00:00', to: '2026-09-27T14:59:59.999' } } as const;
    expect(qOf(bucketDrillDownHref('', '2026-09-27T00:00:00.000+09:00', 'day', null, naive))).toBe('merged:2026-09-27..2026-09-27@Asia/Seoul');
  });

  it('다른 시간대를 적은 대시보드는 그 시간대의 날짜로 간다', () => {
    const la = { timezone: 'America/Los_Angeles', appliedRange: null } as const;
    expect(qOf(bucketDrillDownHref('', '2026-09-27T00:00:00.000-07:00', 'day', null, la))).toBe('merged:2026-09-27..2026-09-27@America/Los_Angeles');
  });

  it('시간 버킷은 그 한 시간의 순간 범위 그대로다', () => {
    expect(qOf(bucketDrillDownHref('', '2026-09-27T13:00:00.000+09:00', 'hour', null, KST))).toBe('merged:2026-09-27T04:00:00.000Z..2026-09-27T04:59:59.999Z');
  });

  it('잘못된 버킷 시각·시간대는 링크를 만들지 않는다', () => {
    expect(bucketDrillDownHref('org:acme', 'not-a-date', 'day', null, KST)).toBe(null);
    expect(bucketDrillDownHref('org:acme', '2026-09-27T00:00:00.000+09:00', 'day', null, { timezone: 'Mars/Olympus', appliedRange: null })).toBe(null);
  });

  it('CR-127: 버킷 이름과 열 제목은 대시보드 시간대로 적는다', () => {
    expect(bucketLabelFor('day', 'Asia/Seoul')('2026-09-27T00:00:00.000+09:00')).toBe('2026-09-27');
    expect(bucketLabelFor('hour', 'Asia/Seoul')('2026-09-27T13:00:00.000+09:00')).toBe('2026-09-27 13:00');
    expect(bucketLabelFor('month', 'Asia/Seoul')('2026-09-01T00:00:00.000+09:00')).toBe('2026-09');
    expect(bucketLabelFor('day', 'Asia/Seoul')('2026-07-01')).toBe('2026-07-01');
    expect(bucketHeadingFor('Asia/Seoul')).toBe('Range (KST)');
    expect(bucketHeadingFor('UTC')).toBe('Range (UTC)');
  });
});

describe('백분위 응답 읽기', () => {
  it('FR-STAT-003: spread된 백분위 값에서 요청한 것만 읽는다', () => {
    const values = readPercentileValues({ p50: 61200, p75: 80000, p90: 120000, p95: 200000, p99: 400000 });
    expect(values).toEqual({ '50': 61200, '75': 80000, '90': 120000, '95': 200000, '99': 400000 });
  });

  it('없는 백분위 키는 건너뛴다 (undefined를 0으로 만들지 않는다)', () => {
    const values = readPercentileValues({ p50: 61200 }, [50, 90]);
    expect(values).toEqual({ '50': 61200 });
    expect('90' in values).toBe(false);
  });
});
