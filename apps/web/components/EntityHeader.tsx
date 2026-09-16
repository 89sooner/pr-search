'use client';

/**
 * C-023 EntityHeader — 상세 화면 공통 헤더 (WP-017 / W-002-HEADER).
 *
 * W-002·W-003·W-005가 함께 쓴다. 그래서 PR에만 있는 것을 여기 넣지 않고
 * `badges`로 받는다 — 커밋 상세(WP-018)가 같은 헤더를 쓰려면 그래야 한다.
 *
 * ## 외부 링크가 선택인 이유
 *
 * `GHE_BASE_URL`이 없는 배포에서는 링크를 만들 수 없다 (CR-020, DEV-086).
 * 그때 **버튼을 그리지 않는다** — 눌러도 아무 데도 안 가는 버튼은 없는 것보다
 * 나쁘다.
 */

import type { ReactNode } from 'react';
import { Panel } from './ui';

export interface EntityHeaderProps {
  readonly actions?: ReactNode;
  readonly kind: 'pull_request' | 'commit' | 'release';
  readonly title: string;
  /** `owner/repo #1234` 처럼 사람이 읽는 식별자. */
  readonly identifier: string;
  readonly badges?: ReactNode;
  /** GHE 링크. 없으면 버튼을 그리지 않는다 (DEV-086). */
  readonly externalUrl?: string | null;
}

/** 새 창으로 나감을 나타내는 글리프. 아이콘 라이브러리를 들이지 않는다. */
function ExternalGlyph(): ReactNode {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
      <path
        d="M4.5 2h5.5v5.5M10 2L5 7M8 8.5V10H2V4h1.5"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

const KIND_LABEL: Readonly<Record<EntityHeaderProps['kind'], string>> = {
  pull_request: 'PR',
  commit: "Commit",
  release: "Release",
};

export function EntityHeader({
  kind,
  title,
  identifier,
  badges,
  externalUrl,
  actions,
}: EntityHeaderProps): ReactNode {
  return (
    <Panel as="section" aria-labelledby="entity-title" data-testid="entity-header">
      <p data-testid="entity-identifier">
        <span className="ui-sr-only">{KIND_LABEL[kind]} </span>
        <code className="ui-mono">{identifier}</code>
      </p>
      <h1 id="entity-title">{title}</h1>
      {badges === undefined ? null : <div data-testid="entity-badges">{badges}</div>}
      {actions ? <div className="source-detail-actions">{actions}</div> : null}

      {externalUrl === undefined || externalUrl === null ? null : (
        /*
         * 새 창임을 **말로도 알린다** (C-023 접근성). 아이콘만으로는
         * 스크린 리더 사용자가 탭이 바뀌는 것을 예상하지 못한다.
         * `noreferrer`는 GHE에 우리 URL이 새어 나가지 않게 한다.
         */
        <a
          href={externalUrl}
          target="_blank"
          rel="noreferrer"
          data-testid="external-link"
        >
          Open in GHE
          <ExternalGlyph />
          <span className="ui-sr-only"> (opens in a new window)</span>
        </a>
      )}
    </Panel>
  );
}
