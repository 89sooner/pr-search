'use client';

/**
 * C-063 SafeGhOutputViewer — 무해화 경계를 지난 실행 출력 (WP-077 / NFR-010, ADR-018).
 *
 * **여기 오는 텍스트는 서버(`SafeGhOutput`)가 이미 걷어 낸 값이다.** 이 컴포넌트가 하는
 * 일은 그것을 `<pre>`의 **텍스트 노드**로 그리는 것뿐이다 — `dangerouslySetInnerHTML`을
 * 쓰지 않고, Markdown도 렌더링하지 않는다. 절단·바이너리 플래그는 서버가 준 대로 보인다.
 */

import type { ReactNode } from 'react';
import { Badge } from './ui';

export interface SafeGhOutputViewerProps {
  readonly label: string;
  readonly text: string | null;
  readonly truncated: boolean;
  readonly binary: boolean;
  readonly testId: string;
}

export function SafeGhOutputViewer({ label, text, truncated, binary, testId }: SafeGhOutputViewerProps): ReactNode {
  return (
    <section aria-label={label} data-testid={testId} className="prs-gh-output">
      <div className="prs-gh-output-head">
        <strong>{label}</strong>
        {truncated ? (
          <Badge tone="warning" data-testid={`${testId}-truncated`}>
            Exceeded the limit and was truncated
          </Badge>
        ) : null}
        {binary ? (
          <Badge tone="neutral" data-testid={`${testId}-binary`}>
            Binary output — not displayed as text
          </Badge>
        ) : null}
      </div>
      {binary ? null : text === null || text === '' ? (
        <p data-testid={`${testId}-empty`}>No output.</p>
      ) : (
        <pre data-testid={`${testId}-text`} tabIndex={0}>
          {text}
        </pre>
      )}
    </section>
  );
}
