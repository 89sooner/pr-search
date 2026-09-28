/**
 * 표시 포맷 (WP-015 / 화면 공통).
 *
 * 이 함수들은 **서버와 클라이언트가 같은 문자열을 만들어야 한다.** 다르면
 * 하이드레이션이 깨지고, 두 사람이 같은 화면에서 다른 값을 읽는다.
 */

import { describe, expect, it } from 'vitest';
import { calendarRangeToUtc } from '@prs/query';
import {
  DISPLAY_TIME_ZONE,
  SHORT_SHA_LENGTH,
  UNKNOWN_TIME,
  formatDate,
  formatDuration,
  formatInTimeZone,
  formatRepository,
  formatSequence,
  formatSequenceRef,
  formatTimeOfDay,
  formatTimestamp,
  formatUtcTitle,
  instantMs,
  shortSha,
  timeZoneLabel,
} from './format';

const SHA = 'a3f9c21b4e8d7f0c1a2b3c4d5e6f708192a3b4c5';

describe('SHA 축약', () => {
  it('40자를 12자로 줄인다', () => {
    expect(shortSha(SHA)).toBe('a3f9c21b4e8d');
    expect(shortSha(SHA)).toHaveLength(SHORT_SHA_LENGTH);
  });

  it('대문자를 소문자로 맞춘다 — 같은 커밋이 두 모양으로 보이지 않게', () => {
    expect(shortSha(SHA.toUpperCase())).toBe('a3f9c21b4e8d');
  });

  it('**이미 축약된 값은 손대지 않는다**', () => {
    // 7자 입력을 다시 자르면 무엇을 검색했는지 화면에서 알 수 없다.
    expect(shortSha('a3f9c21')).toBe('a3f9c21');
    expect(shortSha('a3f9c21b4e8d7f0')).toBe('a3f9c21b4e8d7f0');
  });

  it('hex가 아니면 그대로 둔다', () => {
    expect(shortSha('not-a-sha')).toBe('not-a-sha');
  });

  it('양끝 공백을 없앤다', () => {
    expect(shortSha(`  ${SHA}  `)).toBe('a3f9c21b4e8d');
  });
});

describe('시퀀스 표기', () => {
  it('**자릿수 구분 기호를 넣지 않는다**', () => {
    // `1,342`를 복사해 검색창에 넣으면 숫자로 읽히지 않는다. 시퀀스는
    // 세는 수가 아니라 식별자다.
    expect(formatSequence(1342)).toBe('1342');
    expect(formatSequence(1234567)).toBe('1234567');
    expect(formatSequence(1234567)).not.toContain(',');
  });

  it('없는 시퀀스는 `—`다 — `0`이 아니다', () => {
    // `0`으로 그리면 "채번 안 됨"과 "첫 번째 커밋"이 구분되지 않는다.
    expect(formatSequence(null)).toBe('—');
    expect(formatSequence(undefined)).toBe('—');
    expect(formatSequence(Number.NaN)).toBe('—');
  });

  it('0은 그대로 0이다', () => {
    expect(formatSequence(0)).toBe('0');
  });
});

describe('시퀀스 + 에폭 (ADR-007)', () => {
  it('에폭을 함께 적는다', () => {
    // 에폭이 다르면 같은 시퀀스 값이라도 다른 커밋을 가리킨다.
    expect(formatSequenceRef(1342, 3)).toBe('1342@e3');
  });

  it('에폭이 없으면 시퀀스만', () => {
    expect(formatSequenceRef(1342, null)).toBe('1342');
  });

  it('시퀀스가 없으면 에폭이 있어도 `—`다', () => {
    expect(formatSequenceRef(null, 3)).toBe('—');
  });
});

describe('기간 표기', () => {
  it('1분 미만은 초다', () => {
    expect(formatDuration(0)).toBe("0s");
    expect(formatDuration(59)).toBe("59s");
  });

  it('분·시간·일로 올라간다', () => {
    expect(formatDuration(60)).toBe("1m");
    expect(formatDuration(3_600)).toBe("1h");
    expect(formatDuration(86_400)).toBe("1d");
  });

  it('**두 단위까지만 쓴다** — 표에서 줄을 넘기지 않게', () => {
    // 2일 3시간 14분 9초가 아니라 2일 3시간.
    expect(formatDuration(2 * 86_400 + 3 * 3_600 + 14 * 60 + 9)).toBe("2d 3h");
  });

  it('WP-013의 리드 타임 예시가 읽힌다', () => {
    expect(formatDuration(97_331)).toBe("1d 3h");
  });

  it('음수는 `—`다 — `0초`가 아니다', () => {
    // 0으로 보이면 데이터 오류가 "즉시 머지"로 읽힌다.
    expect(formatDuration(-1)).toBe('—');
  });

  it('없는 값은 `—`다', () => {
    expect(formatDuration(null)).toBe('—');
    expect(formatDuration(undefined)).toBe('—');
    expect(formatDuration(Number.NaN)).toBe('—');
  });
});

describe('시각 표기 (CR-127, NFR-007 「시각 표시 기준」)', () => {
  /*
   * 이 묶음은 **실행하는 쪽의 시간대와 무관해야 한다** — `TZ=UTC`·`Asia/Seoul`·
   * `America/Los_Angeles`로 모두 돌린다. 서버(컨테이너 UTC)와 브라우저(어디든)가 같은
   * 문자열을 내야 하이드레이션이 깨지지 않고 두 사람이 같은 시각을 읽는다.
   */
  it('`Asia/Seoul`로 고정한다 — API 원본 `2026-09-27T03:00:00Z`는 `2026-09-27 12:00 KST`다', () => {
    expect(DISPLAY_TIME_ZONE).toBe('Asia/Seoul');
    expect(formatTimestamp('2026-09-27T03:00:00Z')).toBe('2026-09-27 12:00 KST');
  });

  it('KST 자정 앞뒤는 날짜가 갈린다', () => {
    expect(formatTimestamp('2026-09-26T14:59:59Z')).toBe('2026-09-26 23:59 KST');
    expect(formatTimestamp('2026-09-26T15:00:00Z')).toBe('2026-09-27 00:00 KST');
  });

  it('자정은 `24`가 아니라 `00`이다', () => {
    expect(formatTimestamp('2026-09-26T15:00:00Z')).toContain(' 00:00 ');
  });

  it('오프셋이 붙은 입력도 같은 순간의 KST다 — 보정을 두 번 하지 않는다', () => {
    expect(formatTimestamp('2026-09-27T12:00:00+09:00')).toBe('2026-09-27 12:00 KST');
    expect(formatTimestamp('2026-09-26T20:00:00-07:00')).toBe('2026-09-27 12:00 KST');
  });

  it('오프셋 없는 시각은 UTC로 읽는다 — 브라우저 시간대를 타지 않는다', () => {
    expect(formatTimestamp('2026-09-27T03:00:00')).toBe('2026-09-27 12:00 KST');
  });

  it('필요한 자리는 초까지', () => {
    expect(formatTimestamp('2026-09-27T03:04:05.678Z', { seconds: true })).toBe('2026-09-27 12:04:05 KST');
  });

  it('한 자리 월·일·시를 0으로 채운다', () => {
    expect(formatTimestamp('2026-01-01T18:04:05Z')).toBe('2026-01-02 03:04 KST');
  });

  it('값이 없으면 `—`, 읽지 못하면 `Unknown`(미확인)이다', () => {
    expect(formatTimestamp(null)).toBe('—');
    expect(formatTimestamp(undefined)).toBe('—');
    expect(formatTimestamp('')).toBe('—');
    expect(formatTimestamp('not-a-date')).toBe(UNKNOWN_TIME);
    expect(UNKNOWN_TIME).toBe('Unknown');
  });

  it('날짜만은 KST 날짜다 — 열 제목이 없는 자리는 표지를 붙인다', () => {
    expect(formatDate('2026-09-26T15:00:00Z')).toBe('2026-09-27');
    expect(formatDate('2026-09-26T14:59:59.999Z')).toBe('2026-09-26');
    expect(formatDate('2026-09-26T15:00:00Z', { label: true })).toBe('2026-09-27 KST');
    expect(formatDate(null)).toBe('—');
    expect(formatDate('garbage')).toBe('Unknown');
  });

  it('시각만', () => {
    expect(formatTimeOfDay('2026-09-27T03:04:59Z')).toBe('12:04');
  });

  it('툴팁은 원본 UTC다 — `Z` 값은 받은 그대로(마이크로초 보존), 다른 오프셋은 UTC로 옮긴다', () => {
    expect(formatUtcTitle('2026-09-27T03:00:00.123456Z')).toBe('2026-09-27T03:00:00.123456Z (UTC)');
    expect(formatUtcTitle('2026-09-27T12:00:00+09:00')).toBe('2026-09-27T03:00:00.000Z (UTC)');
    expect(formatUtcTitle(null)).toBeUndefined();
    expect(formatUtcTitle('garbage')).toBeUndefined();
  });

  it('판정용 순간도 같은 해석이다 — 오프셋 없는 시각은 UTC, 없거나 깨진 값은 NaN', () => {
    expect(instantMs('2026-09-27T03:00:00')).toBe(Date.parse('2026-09-27T03:00:00Z'));
    expect(instantMs('2026-09-27T12:00:00+09:00')).toBe(Date.parse('2026-09-27T03:00:00Z'));
    expect(instantMs('2026-09-27')).toBe(Date.parse('2026-09-27T00:00:00Z'));
    expect(instantMs(null)).toBeNaN();
    expect(instantMs('garbage')).toBeNaN();
  });

  it('화면의 KST 날짜와 날짜 검색의 하루가 같은 경계에서 갈린다 (FR-SRCH-005 AC-11)', () => {
    const { gte, lt } = calendarRangeToUtc('2026-09-27', '2026-09-27', DISPLAY_TIME_ZONE);
    expect(formatDate(gte)).toBe('2026-09-27');
    expect(formatDate(new Date(Date.parse(lt) - 1).toISOString())).toBe('2026-09-27');
    expect(formatDate(lt)).toBe('2026-09-28');
  });

  it('대시보드 시간대로 그리는 자리 — 버킷 이름', () => {
    expect(formatInTimeZone('2026-09-27T00:00:00.000+09:00', 'Asia/Seoul', 'date')).toBe('2026-09-27');
    expect(formatInTimeZone('2026-09-27T13:00:00.000+09:00', 'Asia/Seoul', 'minute')).toBe('2026-09-27 13:00');
    expect(formatInTimeZone('2026-09-01T00:00:00.000+09:00', 'Asia/Seoul', 'month')).toBe('2026-09');
    expect(formatInTimeZone('2026-09-27T00:00:00.000-07:00', 'America/Los_Angeles', 'date')).toBe('2026-09-27');
    expect(timeZoneLabel('Asia/Seoul')).toBe('KST');
    expect(timeZoneLabel('America/Los_Angeles')).toBe('America/Los_Angeles');
  });
});

describe('저장소 표기', () => {
  it('있으면 그대로', () => {
    expect(formatRepository('acme/payments')).toBe('acme/payments');
  });

  it('없으면 `—`다', () => {
    expect(formatRepository(null)).toBe('—');
    expect(formatRepository('')).toBe('—');
  });
});
