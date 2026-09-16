'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { Button } from './ui';
import { WorkbenchIcon } from './WorkbenchIcon';

/** W-001 / FR-SRCH-001·005: 예시는 실행하지 않고 입력창에서 편집한다. */
export function SearchWelcome(): ReactNode {
  const examples = [
    { label: "Find a PR", query: 'owner/repo#1234', detail: "Find by repository and PR number" },
    { label: "Investigate merge order", query: 'repo:owner/repo base:main seq:1200..1350', detail: "Explore a range of changes on the same branch" },
    { label: "Track changed paths", query: 'repo:owner/repo path:src/', detail: "Find PRs and commits that changed a path" },
  ];
  return (
    <section className="prs-search-welcome" aria-labelledby="search-welcome-title" data-cause="no_query">
      <div className="prs-welcome-mark"><WorkbenchIcon name="search" /></div>
      <p className="prs-eyebrow">Explore change history</p>
      <h2 id="search-welcome-title">From the first commit to merge order.</h2>
      <p>Search by commit SHA, PR number, or GitHub Enterprise URL.<br /> Use merge sequences to narrow the range and trace related PRs.</p>
      <div className="prs-query-examples" aria-label="Search examples">
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
      <p className="prs-welcome-footnote">Select an example, then replace <code>owner/repo</code> with the repository you want to investigate.</p>
      <Link href="/repositories" className="prs-text-link"><WorkbenchIcon name="repository" /> View registered repositories <WorkbenchIcon name="arrow" /></Link>
    </section>
  );
}
