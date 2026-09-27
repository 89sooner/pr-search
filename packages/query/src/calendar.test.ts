/**
 * 달력 날짜와 시간대 (CR-127, FR-SRCH-005 AC-11, NFR-007).
 *
 * 기대값 가운데 서머타임 날의 「하루의 첫 순간」은 **Elasticsearch 8.19에서 실측한 일 버킷 키**다
 * (원장 6.118장) — 통계 버킷과 검색 범위가 같은 순간에서 갈라져야 버킷을 누른 결과가 같다.
 * 이 파일은 실행하는 쪽의 시간대와 무관해야 한다 — `TZ=UTC`·`Asia/Seoul`·`America/Los_Angeles`로
 * 모두 돌린다.
 */

import { describe, expect, it } from 'vitest';
import {
  addDays,
  calendarRangeToUtc,
  canonicalTimeZone,
  endOfMonth,
  isCalendarDate,
  startOfZonedDay,
  todayIn,
  zonedDate,
  zonedParts,
} from './calendar.js';

const iso = (ms: number): string => new Date(ms).toISOString();

describe('시간대 이름 (canonicalTimeZone)', () => {
  it.each([
    ['Asia/Seoul', 'Asia/Seoul'],
    ['asia/seoul', 'Asia/Seoul'],
    ['ASIA/SEOUL', 'Asia/Seoul'],
    ['UTC', 'UTC'],
    ['America/Los_Angeles', 'America/Los_Angeles'],
  ])('%s → %s', (input, expected) => {
    expect(canonicalTimeZone(input)).toBe(expected);
  });

  it.each(['Mars/Olympus', '', ' Asia/Seoul', 'Asia/Seoul ', 'KST', '+09:00', '-05:00', 'Z', '../etc'])(
    '%j는 시간대가 아니다',
    (input) => {
      expect(canonicalTimeZone(input)).toBeNull();
    },
  );
});

describe('순간의 벽시계 (zonedParts·zonedDate)', () => {
  it('KST 자정 앞뒤', () => {
    expect(zonedDate(Date.parse('2026-09-26T14:59:59.999Z'), 'Asia/Seoul')).toBe('2026-09-26');
    expect(zonedDate(Date.parse('2026-09-26T15:00:00.000Z'), 'Asia/Seoul')).toBe('2026-09-27');
    expect(zonedParts(Date.parse('2026-09-26T15:00:00.000Z'), 'Asia/Seoul')).toEqual({
      year: 2026, month: 9, day: 27, hour: 0, minute: 0, second: 0, millisecond: 0,
    });
    expect(zonedParts(Date.parse('2026-09-27T03:04:05.678Z'), 'Asia/Seoul')).toEqual({
      year: 2026, month: 9, day: 27, hour: 12, minute: 4, second: 5, millisecond: 678,
    });
  });

  it('자정은 24가 아니라 0시다', () => {
    expect(zonedParts(Date.parse('2026-09-26T15:00:00Z'), 'Asia/Seoul').hour).toBe(0);
    expect(zonedParts(Date.parse('2026-09-27T00:00:00Z'), 'UTC').hour).toBe(0);
  });

  it('1987년 서울의 서머타임(+10:00)도 IANA 규칙대로 읽는다 — 오프셋을 상수로 두지 않는다', () => {
    expect(zonedParts(Date.parse('1987-05-10T15:00:00Z'), 'Asia/Seoul')).toMatchObject({ day: 11, hour: 1 });
  });

  it('오늘은 부르는 쪽이 준 「지금」의 그 시간대 날짜다', () => {
    const now = Date.parse('2026-09-27T16:30:00Z'); // KST 9/28 01:30, LA 9/27 09:30
    expect(todayIn('Asia/Seoul', now)).toBe('2026-09-28');
    expect(todayIn('America/Los_Angeles', now)).toBe('2026-09-27');
    expect(todayIn('UTC', now)).toBe('2026-09-27');
  });
});

describe('달력 날짜 (isCalendarDate·addDays·endOfMonth)', () => {
  it.each([
    ['2024-02-29', true],
    ['2025-02-29', false],
    ['2026-02-30', false],
    ['2026-09-31', false],
    ['2026-13-01', false],
    ['2026-00-10', false],
    ['2026-9-1', false],
    ['2026-09-27T00:00', false],
    ['0000-01-01', false],
  ])('%s → %s', (input, expected) => {
    expect(isCalendarDate(input)).toBe(expected);
  });

  it('월말·연말·윤년을 넘는다', () => {
    expect(addDays('2026-09-30', 1)).toBe('2026-10-01');
    expect(addDays('2025-12-31', 1)).toBe('2026-01-01');
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(addDays('2024-03-01', -1)).toBe('2024-02-29');
    expect(addDays('2026-09-27', -29)).toBe('2026-08-29');
  });

  it('달의 마지막 날', () => {
    expect(endOfMonth('2026-09-01')).toBe('2026-09-30');
    expect(endOfMonth('2024-02-10')).toBe('2024-02-29');
    expect(endOfMonth('2026-12-05')).toBe('2026-12-31');
  });

  it('없는 날짜에는 던진다 — 조용히 다음 달로 넘기지 않는다', () => {
    expect(() => addDays('2025-02-29', 1)).toThrow(RangeError);
    expect(() => startOfZonedDay('2025-02-29', 'Asia/Seoul')).toThrow(RangeError);
  });
});

describe('하루의 첫 순간 (startOfZonedDay)', () => {
  it('KST 9월 27일은 UTC 9월 26일 15:00에 시작한다', () => {
    expect(iso(startOfZonedDay('2026-09-27', 'Asia/Seoul'))).toBe('2026-09-26T15:00:00.000Z');
  });

  it('UTC는 그날 00:00Z다', () => {
    expect(iso(startOfZonedDay('2026-09-27', 'UTC'))).toBe('2026-09-27T00:00:00.000Z');
  });

  it('서머타임 전환이 자정이 아니면 그날 00:00이다 (America/Los_Angeles 2026-03-08)', () => {
    expect(iso(startOfZonedDay('2026-03-08', 'America/Los_Angeles'))).toBe('2026-03-08T08:00:00.000Z');
    expect(iso(startOfZonedDay('2026-03-09', 'America/Los_Angeles'))).toBe('2026-03-09T07:00:00.000Z');
  });

  it('자정이 없는 날은 전환 순간이다 — Elasticsearch 일 버킷 키와 같다 (America/Santiago 2026-09-06)', () => {
    expect(iso(startOfZonedDay('2026-09-06', 'America/Santiago'))).toBe('2026-09-06T04:00:00.000Z');
    expect(iso(startOfZonedDay('2026-09-07', 'America/Santiago'))).toBe('2026-09-07T03:00:00.000Z');
  });

  it('자정이 없는 날의 다른 예 (America/Havana 2026-03-08)', () => {
    expect(iso(startOfZonedDay('2026-03-08', 'America/Havana'))).toBe('2026-03-08T05:00:00.000Z');
  });

  it('자정이 두 번인 날은 앞의 자정이다 (America/Havana 2026-11-01)', () => {
    expect(iso(startOfZonedDay('2026-11-01', 'America/Havana'))).toBe('2026-11-01T04:00:00.000Z');
    expect(iso(startOfZonedDay('2026-11-02', 'America/Havana'))).toBe('2026-11-02T05:00:00.000Z');
  });

  it('모르는 시간대는 던진다', () => {
    expect(() => startOfZonedDay('2026-09-27', 'Mars/Olympus')).toThrow(RangeError);
  });
});

describe('달력 날짜 범위 → UTC 반열림 구간 (calendarRangeToUtc)', () => {
  it('하루: 시작 포함, 다음 날 시작 제외 — 23:59:59나 1ms 빼기가 아니다', () => {
    expect(calendarRangeToUtc('2026-09-27', '2026-09-27', 'Asia/Seoul')).toEqual({
      gte: '2026-09-26T15:00:00.000Z',
      lt: '2026-09-27T15:00:00.000Z',
    });
  });

  it('월말·연말·윤년', () => {
    expect(calendarRangeToUtc('2026-09-01', '2026-09-30', 'Asia/Seoul')).toEqual({
      gte: '2026-08-31T15:00:00.000Z',
      lt: '2026-09-30T15:00:00.000Z',
    });
    expect(calendarRangeToUtc('2025-12-31', '2025-12-31', 'Asia/Seoul')).toEqual({
      gte: '2025-12-30T15:00:00.000Z',
      lt: '2025-12-31T15:00:00.000Z',
    });
    expect(calendarRangeToUtc('2024-02-29', '2024-02-29', 'Asia/Seoul')).toEqual({
      gte: '2024-02-28T15:00:00.000Z',
      lt: '2024-02-29T15:00:00.000Z',
    });
  });

  it('서머타임 날은 23시간이나 25시간이다 — 그대로 둔다', () => {
    const { gte, lt } = calendarRangeToUtc('2026-11-01', '2026-11-01', 'America/Havana');
    expect(Date.parse(lt) - Date.parse(gte)).toBe(25 * 3_600_000);
  });
});
