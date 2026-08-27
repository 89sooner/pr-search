/**
 * 강조 구간 (WP-032 / FR-SRCH-011 AC-5, THR-018, CR-043 DEV-282).
 *
 * ## 마크업은 API 경계를 넘지 않는다
 *
 * Elasticsearch의 highlighter는 원문을 **이스케이프하지 않고** 태그만 끼워
 * 넣는다. PR 제목이 `<script>`를 담고 있으면 그것이 그대로 조각에 실린다.
 * 그 문자열을 화면이 HTML로 그리면 THR-018의 완화 근거("PR 본문을 HTML로
 * 렌더링하지 않음")가 무너진다.
 *
 * 그래서 계약은 **평문 조각 + 일치 구간**이다. ES 안에서 태그를 쓰는 것은
 * 무방하되 그 태그를 응답 밖으로 내보내지 않는다 — 여기서 걷어 내고 걷어 낸
 * 자리를 오프셋으로 바꾼다. 화면은 텍스트 노드와 `<mark>`로 조립한다.
 *
 * ## 왜 `<em>`이 아니라 사설 영역 문자인가
 *
 * 표식은 원문에 **나타날 수 없어야** 한다. `<em>`은 PR 본문에 실제로 들어
 * 있을 수 있고, 그러면 사용자가 쓴 글자를 강조 표식으로 잘못 읽어 오프셋이
 * 밀린다. 유니코드 사설 사용 영역(U+E000·U+E001)은 어떤 키보드로도 입력되지
 * 않고 GitHub이 만들어 내지도 않는다.
 */

import type { estypes } from '@elastic/elasticsearch';

/** 강조 시작·끝 표식. 원문에 나타날 수 없는 사설 사용 영역 문자다. */
export const HIGHLIGHT_OPEN = '\u{E000}';
export const HIGHLIGHT_CLOSE = '\u{E001}';

/** 필드당 조각 수 상한 (FR-SRCH-011 AC-5). */
export const HIGHLIGHT_FRAGMENTS = 3;
/** 조각 하나의 길이 상한 (FR-SRCH-011 AC-5). */
export const HIGHLIGHT_FRAGMENT_SIZE = 160;

/**
 * 강조를 요청하는 필드.
 *
 * **`partial` 서브필드는 넣지 않는다.** 조각 텍스트는 사용자에게 보이는
 * 문자열이고 `partial`은 같은 원문을 다르게 분석한 사본일 뿐이라, 넣으면 같은
 * 문장이 두 벌 실린다. `matched_fields`로 묶을 수도 있으나 그것은 같은 분석기
 * 계열을 요구하며 여기서는 얻는 것이 없다.
 */
export const HIGHLIGHT_FIELDS: readonly string[] = ['title', 'body', 'message'];

/** 조각 하나. 마크업이 아니라 평문과 구간이다. */
export interface HighlightFragment {
  readonly text: string;
  readonly matches: readonly { readonly start: number; readonly end: number }[];
}

/** 필드 이름 → 조각들. 필드가 없으면 키도 없다. */
export type HighlightMap = Readonly<Record<string, readonly HighlightFragment[]>>;

/** 조회에 실을 `highlight` 절. 자유 텍스트가 있을 때만 붙인다. */
export function buildHighlight(): estypes.SearchHighlight {
  return {
    pre_tags: [HIGHLIGHT_OPEN],
    post_tags: [HIGHLIGHT_CLOSE],
    number_of_fragments: HIGHLIGHT_FRAGMENTS,
    fragment_size: HIGHLIGHT_FRAGMENT_SIZE,
    /*
     * 일치가 없으면 조각을 만들지 않는다.
     *
     * 기본값(`no_match_size: 0`)이 그 동작이다. 명시하는 것은 "일치하지 않은
     * 필드의 앞부분을 잘라 보여 준다"는 흔한 설정과 이 계약이 다르기 때문이다 —
     * 그렇게 하면 강조 구간이 빈 조각이 나가고 화면이 그것을 일치로 그린다.
     */
    no_match_size: 0,
    fields: Object.fromEntries(HIGHLIGHT_FIELDS.map((field) => [field, {}])),
  };
}

/**
 * 표식이 박힌 조각 하나를 평문과 구간으로 옮긴다.
 *
 * 짝이 맞지 않는 표식(열림만 있거나 닫힘만 있는 경우)은 **버린다.** ES가 조각을
 * 자르는 경계에서 그런 모양이 나올 수 있고, 그때 구간을 지어내면 엉뚱한 자리가
 * 강조된다. 텍스트 자체는 그대로 남으므로 사용자가 잃는 것은 강조뿐이다.
 */
export function toPlainFragment(marked: string): HighlightFragment {
  const matches: { start: number; end: number }[] = [];
  let text = '';
  let openAt: number | null = null;

  for (const char of marked) {
    if (char === HIGHLIGHT_OPEN) {
      // 열림이 겹치면 바깥 것을 버리고 안쪽을 쓴다 — 마지막 열림이 실제 시작이다.
      openAt = text.length;
      continue;
    }
    if (char === HIGHLIGHT_CLOSE) {
      if (openAt !== null && text.length > openAt) matches.push({ start: openAt, end: text.length });
      openAt = null;
      continue;
    }
    text += char;
  }

  return { text, matches };
}

/**
 * ES 응답의 `highlight`를 계약 모양으로 옮긴다.
 *
 * 표식이 하나도 없는 조각은 버린다 — 강조가 없는 조각은 그냥 원문의 일부이고,
 * 화면이 이미 제목·메시지를 그리고 있다.
 */
export function toPlainHighlight(
  raw: Readonly<Record<string, readonly string[]>> | undefined,
): HighlightMap | null {
  if (raw === undefined) return null;

  const result: Record<string, readonly HighlightFragment[]> = {};
  for (const field of HIGHLIGHT_FIELDS) {
    const fragments = raw[field];
    if (fragments === undefined || fragments.length === 0) continue;

    const converted = fragments
      .slice(0, HIGHLIGHT_FRAGMENTS)
      .map(toPlainFragment)
      .filter((fragment) => fragment.matches.length > 0);

    if (converted.length > 0) result[field] = converted;
  }

  return Object.keys(result).length === 0 ? null : result;
}

/**
 * 응답에 마크업이 남지 않았는지 확인한다 (THR-018).
 *
 * 회귀 시험이 부르는 판정이다. `toPlainHighlight`가 표식을 걷어 내므로 정상
 * 경로에서는 늘 참이지만, **원문이 담고 있던 마크업**은 그대로 남는다 — 그것이
 * 옳다. 계약이 금지하는 것은 "API가 만들어 낸 마크업"이지 사용자가 쓴 글자가
 * 아니다. 이 함수는 표식 문자만 본다.
 */
export function containsHighlightMarker(value: string): boolean {
  return value.includes(HIGHLIGHT_OPEN) || value.includes(HIGHLIGHT_CLOSE);
}
