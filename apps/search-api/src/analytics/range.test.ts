/**
 * 시계열 기간 해석 (API-STAT-002, FR-STAT-002 AC-7, CR-127).
 *
 * 「지금」을 고정해 기본 기간을 본다. 실행하는 쪽의 시간대와 무관해야 한다.
 */

import { describe, expect, it } from 'vitest';
import { isRangeFailure, resolveTimeSeriesRange, type TimeSeriesRange } from './range.js';

/** KST 2026-09-28 01:30 = UTC 2026-09-27 16:30. 두 시간대의 오늘이 다르다. */
const NOW = Date.parse('2026-09-27T16:30:00Z');

function ok(input: { from?: unknown; to?: unknown; timezone?: unknown }): TimeSeriesRange {
  const resolved = resolveTimeSeriesRange({ from: input.from, to: input.to, timezone: input.timezone }, NOW);
  if (isRangeFailure(resolved)) throw new Error(`실패했다: ${resolved.field} ${resolved.message}`);
  return resolved;
}

describe('날짜만 적은 기간은 요청 시간대의 달력 날짜다', () => {
  it('기본 시간대 Asia/Seoul: 모집단은 `@Asia/Seoul` 조건이고 버킷 경계는 그 첫 순간과 마지막 순간이다', () => {
    expect(ok({ from: '2026-09-26', to: '2026-09-28' })).toEqual({
      kind: 'calendar',
      timezone: 'Asia/Seoul',
      appliedFrom: '2026-09-26',
      appliedTo: '2026-09-28',
      rangeFilter: 'merged:2026-09-26..2026-09-28@Asia/Seoul',
      boundsMin: '2026-09-25T15:00:00.000Z',
      boundsMax: '2026-09-28T14:59:59.999Z',
      spanMs: 3 * 86_400_000,
    });
  });

  it('다른 시간대를 적으면 그 시간대의 날짜다 — 버킷의 뜻은 그대로다', () => {
    const range = ok({ from: '2026-09-27', to: '2026-09-27', timezone: 'America/Los_Angeles' });
    expect(range.rangeFilter).toBe('merged:2026-09-27..2026-09-27@America/Los_Angeles');
    expect(range.boundsMin).toBe('2026-09-27T07:00:00.000Z');
  });

  it('`timezone=UTC`는 UTC 날짜다', () => {
    expect(ok({ from: '2026-09-27', to: '2026-09-27', timezone: 'UTC' }).rangeFilter).toBe('merged:2026-09-27..2026-09-27@UTC');
  });

  it('기간을 비우면 요청 시간대의 오늘을 포함한 30일이다 — 서버의 날짜가 아니다', () => {
    const seoul = ok({});
    expect(seoul.appliedTo).toBe('2026-09-28');
    expect(seoul.appliedFrom).toBe('2026-08-30');
    const la = ok({ timezone: 'America/Los_Angeles' });
    expect(la.appliedTo).toBe('2026-09-27');
    expect(la.appliedFrom).toBe('2026-08-29');
  });

  it('한쪽만 주면 다른 쪽이 기본값이다', () => {
    expect(ok({ from: '2026-09-01' })).toMatchObject({ appliedFrom: '2026-09-01', appliedTo: '2026-09-28' });
    expect(ok({ to: '2026-09-10' })).toMatchObject({ appliedFrom: '2026-08-12', appliedTo: '2026-09-10' });
  });

  it('시간대 이름을 정규화한다', () => {
    expect(ok({ from: '2026-09-27', to: '2026-09-27', timezone: 'asia/seoul' }).timezone).toBe('Asia/Seoul');
  });
});

describe('시각을 적은 기간은 기존 뜻 그대로다', () => {
  it('모집단은 시간대 없는 순간 범위이고 적용 기간은 받은 값이다', () => {
    expect(ok({ from: '2026-07-01T00:00:00Z', to: '2026-07-03T00:00:00Z' })).toMatchObject({
      kind: 'instant',
      appliedFrom: '2026-07-01T00:00:00Z',
      appliedTo: '2026-07-03T00:00:00Z',
      rangeFilter: 'merged:2026-07-01T00:00:00Z..2026-07-03T00:00:00Z',
      boundsMin: '2026-07-01T00:00:00Z',
      boundsMax: '2026-07-03T00:00:00Z',
    });
  });

  it('오프셋 없는 시각은 UTC다 — 판정·버킷 수 어림·버킷 경계가 서버 시간대를 타지 않는다 (CR-127)', () => {
    // LA의 서머타임이 시작하는 날이다. 서버 시간대(America/Los_Angeles)로 읽으면 이 세 시간이 두 시간이 된다.
    expect(ok({ from: '2026-03-08T01:00:00', to: '2026-03-08T04:00:00' })).toMatchObject({
      kind: 'instant',
      appliedFrom: '2026-03-08T01:00:00',
      appliedTo: '2026-03-08T04:00:00',
      rangeFilter: 'merged:2026-03-08T01:00:00..2026-03-08T04:00:00',
      boundsMin: '2026-03-08T01:00:00Z',
      boundsMax: '2026-03-08T04:00:00Z',
      spanMs: 3 * 3_600_000,
    });
  });

  it('오프셋이 있는 시각은 받은 그대로다', () => {
    expect(ok({ from: '2026-09-27T00:00:00+09:00', to: '2026-09-27T12:00:00+09:00' })).toMatchObject({
      boundsMin: '2026-09-27T00:00:00+09:00',
      boundsMax: '2026-09-27T12:00:00+09:00',
      spanMs: 12 * 3_600_000,
    });
  });

  it('날짜와 시각이 섞이면 옛 뜻이다', () => {
    expect(ok({ from: '2026-07-01', to: '2026-07-03T00:00:00Z' }).kind).toBe('instant');
  });
});

describe('거절', () => {
  it.each<readonly [{ from?: unknown; to?: unknown; timezone?: unknown }, string]>([
    [{ timezone: 'Mars/Olympus' }, 'timezone'],
    [{ timezone: '' }, 'timezone'],
    [{ timezone: '+09:00' }, 'timezone'],
    [{ timezone: 9 }, 'timezone'],
    [{ from: '2025-02-29', to: '2025-03-01' }, 'from'],
    [{ from: '2026-09-01', to: '2026-02-30' }, 'to'],
    [{ from: '2026-09-28', to: '2026-09-27' }, 'from'],
    [{ from: '2026-10-05' }, 'from'],
    [{ from: 'yesterday', to: '2026-09-27T00:00:00Z' }, 'from'],
  ])('%j → %s', (input, field) => {
    const resolved = resolveTimeSeriesRange({ from: input.from, to: input.to, timezone: input.timezone }, NOW);
    expect(isRangeFailure(resolved) ? resolved.field : null).toBe(field);
  });
});
