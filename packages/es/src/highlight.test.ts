/**
 * 강조 변환 (WP-032 / FR-SRCH-011 AC-5, THR-018, CR-043 DEV-282).
 *
 * 이 계층이 지키는 것은 하나다 — **API가 만든 마크업이 경계를 넘지 않는다.**
 * Elasticsearch의 highlighter는 원문을 이스케이프하지 않고 태그만 끼워 넣으므로,
 * 그 태그를 걷어 내지 않으면 PR 제목의 마크업과 구분할 수 없다.
 */

import { describe, expect, it } from 'vitest';
import {
  HIGHLIGHT_CLOSE,
  HIGHLIGHT_FIELDS,
  HIGHLIGHT_FRAGMENTS,
  HIGHLIGHT_FRAGMENT_SIZE,
  HIGHLIGHT_OPEN,
  buildHighlight,
  containsHighlightMarker,
  toPlainFragment,
  toPlainHighlight,
} from './highlight.js';

const mark = (value: string): string => `${HIGHLIGHT_OPEN}${value}${HIGHLIGHT_CLOSE}`;

describe('조각 하나 (DEV-282)', () => {
  it('표식을 걷어 내고 그 자리를 구간으로 준다', () => {
    // API 계약의 예시와 같은 값이다 — 실 Elasticsearch로 확인했다.
    expect(toPlainFragment(`feat: ${mark('결제')} 재시도 로직`)).toEqual({
      text: 'feat: 결제 재시도 로직',
      matches: [{ start: 6, end: 8 }],
    });
  });

  it('구간이 여럿이면 전부 준다', () => {
    const fragment = toPlainFragment(`${mark('결제')} 실패 ${mark('재시도')}`);
    expect(fragment.text).toBe('결제 실패 재시도');
    expect(fragment.matches).toEqual([
      { start: 0, end: 2 },
      { start: 6, end: 9 },
    ]);
  });

  it('표식이 없으면 구간도 없다 — 없는 일치를 지어내지 않는다', () => {
    expect(toPlainFragment('평범한 제목')).toEqual({ text: '평범한 제목', matches: [] });
  });

  /*
   * ES가 조각을 자르는 경계에서 짝이 맞지 않는 표식이 나올 수 있다. 그때
   * 구간을 지어내면 엉뚱한 자리가 강조된다 — 텍스트는 남기고 강조만 버린다.
   */
  it('짝이 맞지 않는 표식은 버리되 글자는 남긴다', () => {
    expect(toPlainFragment(`${HIGHLIGHT_OPEN}결제 재시도`)).toEqual({ text: '결제 재시도', matches: [] });
    expect(toPlainFragment(`결제${HIGHLIGHT_CLOSE} 재시도`)).toEqual({ text: '결제 재시도', matches: [] });
  });

  it('빈 강조는 구간을 만들지 않는다', () => {
    expect(toPlainFragment(`a${HIGHLIGHT_OPEN}${HIGHLIGHT_CLOSE}b`).matches).toEqual([]);
  });

  /*
   * **이것이 THR-018이 걸리는 자리다.**
   *
   * 제목이 마크업을 담고 있어도 그것은 사용자가 쓴 글자다. 계약이 금지하는
   * 것은 "API가 만들어 낸 마크업"이므로 원문의 `<script>`는 그대로 남는다 —
   * 화면이 그것을 **텍스트 노드**로 그리는 것이 완화의 실체다.
   */
  it('원문의 마크업은 글자로 남고, API 표식만 사라진다', () => {
    const fragment = toPlainFragment(`fix: <script>alert(1)</script> ${mark('결제')}`);
    expect(fragment.text).toBe('fix: <script>alert(1)</script> 결제');
    expect(containsHighlightMarker(fragment.text)).toBe(false);
  });
});

describe('응답 변환', () => {
  it('필드별로 조각을 준다', () => {
    const result = toPlainHighlight({ title: [`${mark('결제')} 재시도`] });
    expect(result?.['title']?.[0]?.text).toBe('결제 재시도');
    expect(result?.['title']?.[0]?.matches).toEqual([{ start: 0, end: 2 }]);
  });

  it('강조가 없는 조각은 버린다 — 원문의 일부일 뿐이다', () => {
    expect(toPlainHighlight({ title: ['일치 없는 조각'] })).toBeNull();
  });

  it('아무 필드도 없으면 `null`이다 — 빈 객체를 내보내지 않는다', () => {
    expect(toPlainHighlight(undefined)).toBeNull();
    expect(toPlainHighlight({})).toBeNull();
  });

  it('계약 밖 필드는 무시한다 — 응답 모양이 조용히 넓어지지 않는다', () => {
    const result = toPlainHighlight({ body_html: [mark('x')], title: [mark('결제')] });
    expect(Object.keys(result ?? {})).toEqual(['title']);
  });

  it('조각 수 상한을 지킨다 (AC-5)', () => {
    const many = Array.from({ length: 10 }, (_, i) => mark(String(i)));
    expect(toPlainHighlight({ body: many })?.['body']).toHaveLength(HIGHLIGHT_FRAGMENTS);
  });
});

describe('요청 절', () => {
  it('상한 둘을 계약대로 싣는다 (AC-5)', () => {
    const highlight = buildHighlight();
    expect(highlight.number_of_fragments).toBe(3);
    expect(highlight.fragment_size).toBe(160);
    expect(HIGHLIGHT_FRAGMENTS).toBe(3);
    expect(HIGHLIGHT_FRAGMENT_SIZE).toBe(160);
  });

  /*
   * 기본값이 그 동작이지만 명시한다 — "일치하지 않은 필드의 앞부분을 잘라
   * 보여 준다"는 흔한 설정과 이 계약이 다르기 때문이다. 그렇게 하면 강조
   * 구간이 빈 조각이 나가고 화면이 그것을 일치로 그린다.
   */
  it('일치가 없으면 조각을 만들지 않는다', () => {
    expect(buildHighlight().no_match_size).toBe(0);
  });

  it('표식이 원문에 나타날 수 없는 문자다 — 사설 사용 영역', () => {
    expect(HIGHLIGHT_OPEN).toBe('\u{E000}');
    expect(HIGHLIGHT_CLOSE).toBe('\u{E001}');
  });

  it('`partial` 서브필드는 강조하지 않는다 — 같은 문장이 두 벌 실린다', () => {
    expect(HIGHLIGHT_FIELDS).toEqual(['title', 'body', 'message']);
    for (const field of HIGHLIGHT_FIELDS) expect(field).not.toContain('.partial');
  });
});
