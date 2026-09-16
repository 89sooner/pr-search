'use client';

/**
 * C-002 LeftNavPanel — 역할에 따라 걸러진 내비게이션 (WP-015 / QA-A001-10).
 *
 * 무엇이 보이는가는 `lib/nav.ts`가 정한다. 이 파일은 **그 결과를 그리기만
 * 한다** — 보안 판정을 렌더링 코드에 섞으면 시험이 DOM을 통해서만 그것을
 * 확인할 수 있고, 그러면 판정 자체를 직접 걸 수 없다.
 */

import Link from 'next/link';
import type { ReactNode } from 'react';
import { NavList, type NavItem } from './ui';
import type { Role } from '@prs/authz/roles';
import { WorkbenchIcon, type WorkbenchIconName } from './WorkbenchIcon';
import { SECTION_LABELS, visibleNavEntries } from '../lib/nav';

export interface LeftNavPanelProps {
  readonly roles: readonly Role[];
  /** 현재 항목 id. `lib/nav.ts`의 `activeNavId`가 만든다. */
  readonly activeId: string | null;
}

const ICONS: Readonly<Record<string, WorkbenchIconName>> = {
  search: 'search', 'saved-searches': 'bookmark', repositories: 'repository',
  ranges: 'range', releases: 'tag', analytics: 'chart', 'ops-pipeline': 'pipeline',
  'ops-repositories': 'repository', 'ops-jobs': 'jobs', 'ops-audit': 'shield',
  'gh-command-center': 'branch', 'gh-history': 'jobs',
};

export function LeftNavPanel({ roles, activeId }: LeftNavPanelProps): ReactNode {
  const items: NavItem[] = visibleNavEntries(roles).map((entry) => ({
    id: entry.id,
    icon: <WorkbenchIcon name={ICONS[entry.id] ?? 'repository'} />,
    label: entry.label,
    href: entry.href,
    section: SECTION_LABELS[entry.section],
    active: entry.id === activeId,
  }));

  return (
    <>
    <Link href="/" className="prs-brand" aria-label="PR Search home">
      <span className="prs-brand-mark"><WorkbenchIcon name="branch" /></span>
      <span><strong>PR Search</strong><small>Every change, connected.</small></span>
    </Link>
    <NavList
      className="prs-nav"
      aria-label="Main navigation"
      items={items}
      /*
       * Next.js `Link`로 그린다 — 전체 새로고침 없이 라우팅해야 셸이 유지되고
       * 포커스 이동(`Shell`의 라우트 전환 처리)이 성립한다.
       *
       * Conductor가 준 `className`과 `aria-current`를 그대로 넘긴다. 현재
       * 항목 표시를 우리가 다시 계산하면 디자인 시스템과 어긋난다.
       */
      renderLink={(item, props) => (
        <Link href={item.href} className={props.className} aria-current={props['aria-current']}>
          {props.children}
        </Link>
      )}
    />
    {roles.includes('operator') ? <div className="prs-nav-note">
      <Link href="/search?legacy=1">Advanced search</Link>
      <Link href="/search?legacy=workspace">Repository workspace</Link>
    </div> : null}
    </>
  );
}
