/**
 * 강조 조각을 조립 가능한 부분으로 (WP-032 / FR-SRCH-011 AC-5, THR-018).
 *
 * ## 마크업을 받지 않는다
 *
 * API가 주는 것은 **평문과 일치 구간**이다 (`{ text, matches: [{start, end}] }`).
 * 화면은 그것을 텍스트 노드와 `<mark>`로 조립한다 — `dangerouslySetInnerHTML`을
 * 쓰지 않는다. PR 제목이 `<script>`를 담고 있어도 그것은 **글자**로 그려진다.
 *
 * 이 파일은 순수 함수다. 조각을 조각내는 규칙을 React 없이 시험할 수 있어야
 * 한다 — `lib/search-state.ts`와 같은 이유다.
 */

export interface HighlightMatch {
  readonly start: number;
  readonly end: number;
}

export interface HighlightFragment {
  readonly text: string;
  readonly matches: readonly HighlightMatch[];
}

/** 필드 이름 → 조각들. 응답의 `highlight` 객체와 같은 모양이다. */
export type HighlightMap = Readonly<Record<string, readonly HighlightFragment[]>>;

/** 조각을 그릴 수 있는 단위로 자른 결과. `marked`면 `<mark>`로 감싼다. */
export interface HighlightPart {
  readonly text: string;
  readonly marked: boolean;
}

/**
 * 조각 하나를 부분들로 자른다.
 *
 * 구간이 겹치거나 순서가 어긋나거나 범위를 벗어나도 **던지지 않는다.** 강조는
 * 표시상의 도움이고, 그것 하나 때문에 결과 행이 사라지면 안 된다 — 이상한
 * 구간은 버리고 글자는 그대로 남긴다.
 */
export function splitHighlight(fragment: HighlightFragment): readonly HighlightPart[] {
  const length = fragment.text.length;

  const valid = fragment.matches
    .filter(
      (match) =>
        Number.isInteger(match.start) &&
        Number.isInteger(match.end) &&
        match.start >= 0 &&
        match.end <= length &&
        match.start < match.end,
    )
    .slice()
    .sort((a, b) => a.start - b.start);

  const parts: HighlightPart[] = [];
  let cursor = 0;

  for (const match of valid) {
    // 겹치는 구간은 앞의 것이 이긴다 — 뒤의 것은 이미 표시된 자리를 다시 말한다.
    if (match.start < cursor) continue;
    if (match.start > cursor) parts.push({ text: fragment.text.slice(cursor, match.start), marked: false });
    parts.push({ text: fragment.text.slice(match.start, match.end), marked: true });
    cursor = match.end;
  }

  if (cursor < length) parts.push({ text: fragment.text.slice(cursor), marked: false });
  return parts;
}

/**
 * 행이 보여 줄 조각 하나를 고른다.
 *
 * **제목이 있으면 제목이다.** 목록의 제목 칸에 본문 조각을 그리면 사용자는
 * 그것을 제목으로 읽는다. 커밋 행은 `message`가 그 자리다.
 *
 * 여러 조각 중 첫 번째만 쓴다 — 목록 한 행에 세 조각을 이어 붙이면 행 높이가
 * 들쭉날쭉해지고, 상세 화면이 아니라 목록이다.
 */
export function primaryFragment(
  highlight: HighlightMap | undefined,
  field: 'title' | 'message',
): HighlightFragment | null {
  return highlight?.[field]?.[0] ?? null;
}

/** 응답의 `highlight`가 계약 모양인지. 아니면 `undefined`로 떨어뜨린다. */
export function judgeHighlight(raw: unknown): HighlightMap | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;

  const result: Record<string, readonly HighlightFragment[]> = {};
  for (const [field, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(value)) continue;
    const fragments = value
      .filter((one): one is Record<string, unknown> => typeof one === 'object' && one !== null)
      .filter((one) => typeof one['text'] === 'string')
      .map((one) => ({
        text: one['text'] as string,
        matches: Array.isArray(one['matches'])
          ? (one['matches'] as unknown[])
              .filter(
                (m): m is HighlightMatch =>
                  typeof m === 'object' &&
                  m !== null &&
                  typeof (m as Record<string, unknown>)['start'] === 'number' &&
                  typeof (m as Record<string, unknown>)['end'] === 'number',
              )
              .map((m) => ({ start: m.start, end: m.end }))
          : [],
      }));
    if (fragments.length > 0) result[field] = fragments;
  }

  return Object.keys(result).length === 0 ? undefined : result;
}
