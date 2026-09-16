/** 루트 진입 (WP-015·WP-073): 로그인 상태를 확인하고 기존 조사 화면으로 안내한다. */

import type { ReactNode } from 'react';
import Link from 'next/link';
import { WorkbenchIcon } from '../components/WorkbenchIcon';
import { EmptyState } from '../components/EmptyState';
import { GuardedPage } from '../lib/server/page-guard';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default function HomePage(): ReactNode {
  // 세션 관문은 `GuardedPage` 하나가 소유한다 (WP-018).
  return (
    <GuardedPage
      title="PR Search"
      returnTo="/"
      whenAuthDisabled={<EmptyState cause="no_permission" title="Authentication is not configured"
        description="Sign in with your company account to access GitHub Enterprise data. Ask an operator to check the authentication settings."
        actions={<Link href="/search">Open search workspace</Link>} />}
    >
      {({ roles }) => { if (process.env['PRS_LEGACY_SEARCH'] !== '1' && !roles.includes('operator')) redirect('/search'); return <>
      <header className="prs-page-heading"><div><p className="prs-eyebrow">GITHUB ENTERPRISE</p><h1>Change history workspace</h1></div></header>
      <div className="prs-home-workflows">
        <Link href="/search#omni-search-input"><WorkbenchIcon name="search" /><strong>Search PRs and commits</strong><span>Find changes and their associated PRs with a single identifier.</span><WorkbenchIcon name="arrow" /></Link>
        <Link href="/ranges"><WorkbenchIcon name="range" /><strong>Investigate a merge range</strong><span>Narrow the range between the last verified point and the first failure.</span><WorkbenchIcon name="arrow" /></Link>
        <Link href="/repositories"><WorkbenchIcon name="repository" /><strong>Browse repositories</strong><span>Check collection status and sequence spaces for each branch.</span><WorkbenchIcon name="arrow" /></Link>
        <Link href="/saved-searches"><WorkbenchIcon name="bookmark" /><strong>Saved searches</strong><span>Run your frequently used investigation queries again.</span><WorkbenchIcon name="arrow" /></Link>
      </div>
      </>; }}
    </GuardedPage>
  );
}
