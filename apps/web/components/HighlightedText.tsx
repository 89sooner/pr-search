/**
 * 강조 조각 렌더링 (WP-032 / FR-SRCH-011 AC-5, THR-018).
 *
 * **`dangerouslySetInnerHTML`을 쓰지 않는다.** API가 주는 것은 평문과 일치
 * 구간이고, 여기서 텍스트 노드와 `<mark>`로 조립한다. PR 제목이 `<script>`나
 * `<img onerror=…>`를 담고 있어도 React가 그것을 **글자로** 그린다 — 그것이
 * THR-018의 완화 근거("PR 본문을 HTML로 렌더링하지 않음")가 실제로 서는 자리다.
 *
 * `<mark>`는 시각 표시만이 아니라 의미도 갖는다(브라우저 기본 스타일 + 일부
 * 보조 기술이 "표시된 텍스트"로 읽는다). `<span class="highlight">`로 바꾸면
 * 그 뜻이 사라진다.
 */

import type { ReactNode } from 'react';
import { splitHighlight, type HighlightFragment } from '../lib/highlight';

export interface HighlightedTextProps {
  readonly fragment: HighlightFragment;
}

export function HighlightedText({ fragment }: HighlightedTextProps): ReactNode {
  const parts = splitHighlight(fragment);

  return (
    <span data-testid="highlighted-text">
      {parts.map((part, index) =>
        part.marked ? (
          // key에 index를 쓰는 것은 부분들이 순서로만 구분되기 때문이다.
          <mark key={index} data-testid="highlight-match">
            {part.text}
          </mark>
        ) : (
          <span key={index}>{part.text}</span>
        ),
      )}
    </span>
  );
}
