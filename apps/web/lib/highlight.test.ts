/**
 * 강조 조각 조립 (WP-032 / FR-SRCH-011 AC-5, THR-018).
 *
 * 화면이 마크업을 **만들지 않는다**는 것을 여기서 건다. 조각을 부분으로
 * 자르는 것까지가 이 계층이고, `<mark>`를 붙이는 것은 React다 — 그래서
 * 이상한 입력이 와도 던지지 않아야 한다: 강조 하나 때문에 결과 행이
 * 사라지면 안 된다.
 */

import { describe, expect, it } from 'vitest';
import { judgeHighlight, primaryFragment, splitHighlight } from './highlight';

describe('조각 자르기', () => {
  it('구간 앞뒤를 나눈다', () => {
    expect(splitHighlight({ text: 'feat: 결제 재시도', matches: [{ start: 6, end: 8 }] })).toEqual([
      { text: 'feat: ', marked: false },
      { text: '결제', marked: true },
      { text: ' 재시도', marked: false },
    ]);
  });

  it('맨 앞·맨 뒤 구간도 다룬다', () => {
    expect(splitHighlight({ text: '결제', matches: [{ start: 0, end: 2 }] })).toEqual([
      { text: '결제', marked: true },
    ]);
  });

  it('구간이 없으면 통짜 한 덩어리다', () => {
    expect(splitHighlight({ text: '평범', matches: [] })).toEqual([{ text: '평범', marked: false }]);
  });

  it('구간 순서가 뒤집혀 와도 정렬해 다룬다', () => {
    const parts = splitHighlight({
      text: 'abcdef',
      matches: [
        { start: 4, end: 5 },
        { start: 0, end: 1 },
      ],
    });
    expect(parts.filter((p) => p.marked).map((p) => p.text)).toEqual(['a', 'e']);
  });

  /*
   * **던지지 않는다.**
   *
   * 강조는 표시상의 도움이다. 서버가 이상한 구간을 줬다고 결과 행이 사라지면
   * 사용자는 검색이 고장 났다고 읽는다 — 이상한 구간만 버린다.
   */
  it('범위 밖·역전·소수 구간을 버리고 글자는 남긴다', () => {
    for (const matches of [
      [{ start: -1, end: 2 }],
      [{ start: 0, end: 99 }],
      [{ start: 3, end: 1 }],
      [{ start: 0, end: 0 }],
      [{ start: 0.5, end: 2 }],
    ]) {
      const parts = splitHighlight({ text: 'abcd', matches });
      expect(parts.map((p) => p.text).join(''), JSON.stringify(matches)).toBe('abcd');
    }
  });

  it('겹치는 구간은 앞의 것이 이긴다 — 같은 자리를 두 번 표시하지 않는다', () => {
    const parts = splitHighlight({
      text: 'abcdef',
      matches: [
        { start: 0, end: 3 },
        { start: 1, end: 4 },
      ],
    });
    expect(parts.map((p) => p.text).join('')).toBe('abcdef');
    expect(parts.filter((p) => p.marked)).toHaveLength(1);
  });
});

describe('행이 보여 줄 조각', () => {
  it('제목이 있으면 제목이다', () => {
    const map = { title: [{ text: 't', matches: [] }], body: [{ text: 'b', matches: [] }] };
    expect(primaryFragment(map, 'title')?.text).toBe('t');
  });

  it('커밋 행은 `message` 축이다', () => {
    expect(primaryFragment({ message: [{ text: 'm', matches: [] }] }, 'message')?.text).toBe('m');
  });

  it('없으면 `null` — 강조 없이 제목을 그린다', () => {
    expect(primaryFragment(undefined, 'title')).toBeNull();
    expect(primaryFragment({}, 'title')).toBeNull();
  });
});

describe('응답 판정', () => {
  it('계약 모양을 받는다', () => {
    const judged = judgeHighlight({ title: [{ text: 'a', matches: [{ start: 0, end: 1 }] }] });
    expect(judged?.['title']?.[0]?.matches).toEqual([{ start: 0, end: 1 }]);
  });

  it('모양이 아니면 `undefined`다 — 화면이 추측하지 않는다', () => {
    for (const raw of [null, undefined, 'x', 1, [], {}, { title: 'not-array' }]) {
      expect(judgeHighlight(raw), JSON.stringify(raw)).toBeUndefined();
    }
  });

  it('`matches`가 빠지거나 이상하면 빈 배열로 둔다 — 조각은 살린다', () => {
    expect(judgeHighlight({ title: [{ text: 'a' }] })?.['title']?.[0]?.matches).toEqual([]);
    expect(judgeHighlight({ title: [{ text: 'a', matches: ['x'] }] })?.['title']?.[0]?.matches).toEqual([]);
  });
});
