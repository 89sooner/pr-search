'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { Button } from '@conductor-by-89soone/react';
import { WorkbenchIcon } from './WorkbenchIcon';

/** W-001 / FR-SRCH-001·005: 예시는 실행하지 않고 입력창에서 편집한다. */
export function SearchWelcome(): ReactNode {
  const examples = [
    { label: 'PR 찾기', query: 'owner/repo#1234', detail: '저장소와 PR 번호로 바로 찾기' },
    { label: '머지 순서 조사', query: 'repo:owner/repo base:main seq:1200..1350', detail: '같은 브랜치에 반영된 변경 범위' },
    { label: '변경 경로 추적', query: 'repo:owner/repo path:src/', detail: '특정 경로를 수정한 PR과 커밋' },
  ];
  return (
    <section className="prs-search-welcome" aria-labelledby="search-welcome-title" data-cause="no_query">
      <div className="prs-welcome-mark"><WorkbenchIcon name="search" /></div>
      <p className="prs-eyebrow">변경 이력 탐색</p>
      <h2 id="search-welcome-title">변경의 시작부터, 반영된 순서까지.</h2>
      <p>커밋 SHA, PR 번호 또는 GitHub Enterprise URL을 검색하세요.<br />머지 시퀀스로 변경 범위를 좁히고 관련 PR을 함께 추적할 수 있습니다.</p>
      <div className="prs-query-examples" aria-label="검색 예시">
        {examples.map((example) => (
          <Button key={example.label} variant="ghost" className="prs-query-example"
            onClick={() => {
              document.dispatchEvent(new CustomEvent('prs:search-draft', { detail: example.query }));
            }}>
            <span><strong>{example.label}</strong><span>{example.detail}</span><code>{example.query}</code></span>
            <WorkbenchIcon name="arrow" />
          </Button>
        ))}
      </div>
      <p className="prs-welcome-footnote">예시를 누른 뒤 <code>owner/repo</code>를 조사할 저장소로 바꾸세요.</p>
      <Link href="/repositories" className="prs-text-link"><WorkbenchIcon name="repository" />등록된 저장소 확인<WorkbenchIcon name="arrow" /></Link>
    </section>
  );
}
