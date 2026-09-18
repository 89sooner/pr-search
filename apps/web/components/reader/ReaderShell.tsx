'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import * as Dropdown from '@radix-ui/react-dropdown-menu';
import * as Dialog from '@radix-ui/react-dialog';
import { GitPullRequest, Search, ChevronDown, LogOut, Keyboard, X, ArrowUpRight } from 'lucide-react';
import { Button } from './primitives';
import { ThemeToggle } from '../ui/ThemeToggle';
import { visibleNavEntries, SECTION_LABELS } from '../../lib/nav';
import type { Role } from '@prs/authz/roles';
import { regressionEnabled } from '../../lib/regression/flags';
import { WorkbenchIcon } from '../WorkbenchIcon';

export function ReaderShell({ children, user, operator = false, roles = [] }: { children: ReactNode; user: { login: string; email: string | null } | null; operator?: boolean; roles?: readonly Role[] }): ReactNode {
  const pathname = usePathname();
  const main = useRef<HTMLElement>(null);
  const previousPath = useRef(pathname);
  const logout = useRef<HTMLFormElement>(null);
  const [help, setHelp] = useState(false);
  const helpTrigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (previousPath.current !== pathname) { main.current?.focus(); previousPath.current = pathname; }
    if (window.location.hash === '#omni-search-input') document.querySelector<HTMLInputElement>('[data-reader-search]')?.focus();
  }, [pathname]);
  useEffect(() => {
    const listener = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && (event.key.toLowerCase() === 'k' || event.key.toLowerCase() === 'g')) {
        const input = document.querySelector<HTMLInputElement>('[data-reader-search]');
        if (input) { event.preventDefault(); input.focus(); input.select(); }
      }
    };
    window.addEventListener('keydown', listener);
    return () => { window.removeEventListener('keydown', listener); };
  }, []);
  return <div className="reader-ui reader-shell" data-regression-enabled={regressionEnabled}>
    <a href="#reader-main" className="reader-skip">Skip to content</a>
    <header className="reader-header"><div className="reader-header-inner">
      <Link href="/search" className="reader-brand"><span className="reader-brand-mark"><GitPullRequest size={21} /></span><span>PR Search<small>Every change, connected.</small></span></Link>
      <span className="reader-environment">GitHub Enterprise</span>
      <nav aria-label="Main navigation"><Link href="/search" aria-current={pathname === '/search' ? 'page' : undefined}><Search size={15} />Search</Link>{regressionEnabled ? <Link href="/regression" aria-current={pathname === '/regression' ? 'page' : undefined}><WorkbenchIcon name="range"/>Regression</Link> : null}{operator ? <Link href="/search?legacy=1">Legacy search<ArrowUpRight size={14} /></Link> : null}</nav>
      {operator ? <Dropdown.Root><Dropdown.Trigger className="reader-workspace-menu">Workspace<ChevronDown size={13} /></Dropdown.Trigger><Dropdown.Portal><Dropdown.Content align="end" sideOffset={10} className="reader-ui reader-user-menu">{visibleNavEntries(roles).map((entry, index, entries) => <div key={entry.id}>{entry.section !== entries[index - 1]?.section ? <Dropdown.Label className="reader-menu-section">{SECTION_LABELS[entry.section]}</Dropdown.Label> : null}<Dropdown.Item asChild><Link href={entry.href}>{entry.label}</Link></Dropdown.Item></div>)}</Dropdown.Content></Dropdown.Portal></Dropdown.Root> : null}
      <ThemeToggle />
      <Button ref={helpTrigger} variant="ghost" className="reader-help" onClick={() => { setHelp(true); }} aria-label="Search help"><Keyboard size={18} /></Button>
      {user ? <><form ref={logout} method="post" action="/auth/logout" hidden /><Dropdown.Root><Dropdown.Trigger className="reader-user" aria-label={`User menu: ${user.login}`}><span>{user.login.slice(0, 2).toUpperCase()}</span><span>{user.login}</span><ChevronDown size={13} /></Dropdown.Trigger><Dropdown.Portal><Dropdown.Content align="end" sideOffset={10} className="reader-ui reader-user-menu"><Dropdown.Label>{user.login}<small>{user.email}</small></Dropdown.Label><Dropdown.Separator /><Dropdown.Item onSelect={() => { logout.current?.requestSubmit(); }}><LogOut size={15} />Sign out</Dropdown.Item></Dropdown.Content></Dropdown.Portal></Dropdown.Root></> : null}
    </div></header>
    <main ref={main} id="reader-main" tabIndex={-1} className="reader-container">{children}</main>
    <footer className="reader-footer"><span>PR Search <span> / </span> Every change, connected.</span><span>Merge sequences are scoped to a repository and base branch</span></footer>
    <Dialog.Root open={help} onOpenChange={setHelp}><Dialog.Portal><Dialog.Overlay className="reader-overlay" /><Dialog.Content className="reader-ui reader-dialog" onCloseAutoFocus={event => { event.preventDefault(); helpTrigger.current?.focus(); }}><Dialog.Title>Find the change that matters</Dialog.Title><Dialog.Description>Explore history by PR number, commit SHA, or search filters.</Dialog.Description><dl><dt><kbd>Ctrl / ⌘ K</kbd></dt><dd>Focus search</dd><dt><code>#1842</code></dt><dd>Find a PR in this repository</dd><dt><code>author:kim label:bug</code></dt><dd>Combine search filters</dd><dt>Expand a row</dt><dd>Read the description, changed files, and commits</dd></dl><Dialog.Close asChild><Button variant="ghost" className="reader-dialog-close" aria-label="Close help"><X size={18} /></Button></Dialog.Close></Dialog.Content></Dialog.Portal></Dialog.Root>
  </div>;
}
