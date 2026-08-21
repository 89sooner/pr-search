/**
 * 표시 포맷 (WP-015 / 화면 공통).
 *
 * 이 함수들은 **서버와 클라이언트가 같은 문자열을 만들어야 한다.** 다르면
 * 하이드레이션이 깨지고, 두 사람이 같은 화면에서 다른 값을 읽는다.
 */

import { describe, expect, it } from 'vitest';
import {
  SHORT_SHA_LENGTH,
  formatDuration,
  formatRepository,
  formatSequence,
  formatSequenceRef,
  formatTimestamp,
  shortSha,
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
    expect(formatDuration(0)).toBe('0초');
    expect(formatDuration(59)).toBe('59초');
  });

  it('분·시간·일로 올라간다', () => {
    expect(formatDuration(60)).toBe('1분');
    expect(formatDuration(3_600)).toBe('1시간');
    expect(formatDuration(86_400)).toBe('1일');
  });

  it('**두 단위까지만 쓴다** — 표에서 줄을 넘기지 않게', () => {
    // 2일 3시간 14분 9초가 아니라 2일 3시간.
    expect(formatDuration(2 * 86_400 + 3 * 3_600 + 14 * 60 + 9)).toBe('2일 3시간');
  });

  it('WP-013의 리드 타임 예시가 읽힌다', () => {
    expect(formatDuration(97_331)).toBe('1일 3시간');
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

describe('시각 표기', () => {
  it('**UTC로 고정한다** — 실행 시간대와 무관하다', () => {
    // 사용자의 시간대로 그리면 서버 렌더와 클라이언트 렌더가 달라진다.
    expect(formatTimestamp('2026-08-19T05:02:11Z')).toBe('2026-08-19 05:02 UTC');
  });

  it('오프셋이 붙은 입력도 UTC로 옮긴다', () => {
    expect(formatTimestamp('2026-08-19T14:02:11+09:00')).toBe('2026-08-19 05:02 UTC');
  });

  it('한 자리 월·일·시를 0으로 채운다', () => {
    expect(formatTimestamp('2026-01-02T03:04:05Z')).toBe('2026-01-02 03:04 UTC');
  });

  it('없거나 깨진 값은 `—`다', () => {
    expect(formatTimestamp(null)).toBe('—');
    expect(formatTimestamp('')).toBe('—');
    expect(formatTimestamp('not-a-date')).toBe('—');
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
