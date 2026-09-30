'use client';
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { ChevronDown, ChevronRight, FileCode, Folder, FolderOpen, GitBranch, RefreshCw, Search } from 'lucide-react';
import type { SourceEntry, SourceTree as TreeData } from '@prs/contracts';
import { EMPTY_PATH_LIST, appendPaths, loadPaths, matchPaths, type PathList } from '../../lib/source-paths';
import { fetchSource, sourceUrl, useSource } from './api';
import { useAutoLoad } from './hooks';

export interface PathSelection { path: string; kind: 'file' | 'directory'; revision: string }
interface TreeProps { repository: string; branch: string; selectedPath: string; onSelect: (selection: PathSelection) => void }
/**
 * CR-132: a directory is listed page by page (5,000 entries each, sorted by the server) instead of stopping at the first
 * 5,000. Later pages are requested by the listed tree's SHA, so they always belong to the same snapshot. CR-138: the next
 * page loads when the reader scrolls to the end of the listed entries; the button stays for the keyboard.
 */
function useMoreEntries(repository: string, first: TreeData | null) {
  const [state, setState] = useState<{ for: TreeData | null; entries: SourceEntry[]; next: number | null; loading: boolean; error: string }>({ for: null, entries: [], next: null, loading: false, error: '' });
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => { controller.current?.abort(); }, [first]);
  const current = state.for === first ? state : { for: first, entries: [], next: first?.next_offset ?? null, loading: false, error: '' };
  const loadMore = useCallback(() => {
    if (!first?.tree_sha || current.next === null) return;
    controller.current?.abort(); const abort = new AbortController(); controller.current = abort;
    const offset = current.next;
    setState({ ...current, loading: true, error: '' });
    fetchSource<TreeData>(sourceUrl(repository, 'tree', { revision: first.revision, tree_sha: first.tree_sha, path: first.path, offset }), abort.signal)
      .then(page => { if (!abort.signal.aborted) setState({ for: first, entries: [...current.entries, ...page.entries], next: page.next_offset ?? null, loading: false, error: '' }); })
      .catch((error: unknown) => { if (!abort.signal.aborted) setState({ ...current, loading: false, error: error instanceof Error ? error.message : 'Unable to load more entries.' }); });
  }, [repository, first, current]);
  const shown = (first?.entries.length ?? 0) + current.entries.length;
  return { entries: current.entries, more: first?.tree_sha !== undefined && current.next !== null, loading: current.loading, error: current.error, shown, total: first?.total ?? shown, loadMore };
}
function MoreEntries({ more }: { more: ReturnType<typeof useMoreEntries> }) {
  const sentinel = useRef<HTMLLIElement>(null);
  useAutoLoad(sentinel, more.more && !more.loading && !more.error, more.loadMore);
  if (!more.more && !more.error) return null;
  return <li ref={sentinel} role="none" className="source-tree-note">{more.error ? <button type="button" onClick={more.loadMore}>Retry: {more.error}</button> : <button type="button" className="source-tree-more" disabled={more.loading} onClick={more.loadMore}>{more.loading ? 'Loading more entries…' : `Show more entries (${more.shown.toLocaleString('en-US')} of ${more.total.toLocaleString('en-US')})`}</button>}</li>;
}
function Node({ entry, revision, repository, selectedPath, onSelect }: Omit<TreeProps, 'branch'> & { entry: SourceEntry; revision: string }) {
  const [open, setOpen] = useState(false); const directory = entry.kind === 'directory';
  useEffect(() => { if (directory && selectedPath.startsWith(`${entry.path}/`)) setOpen(true); }, [directory, selectedPath, entry.path]);
  const data = useSource<TreeData>(directory && open ? sourceUrl(repository, 'tree', { revision, tree_sha: entry.sha, path: entry.path, offset: 0 }) : null);
  const more = useMoreEntries(repository, data.data);
  const item = useRef<HTMLLIElement>(null);
  const selectable = directory || entry.kind === 'file' || entry.kind === 'symlink';
  return <li ref={item} role="treeitem" tabIndex={-1} aria-label={entry.name} aria-expanded={directory ? open : undefined} aria-selected={selectedPath === entry.path} aria-disabled={entry.kind === 'submodule' || undefined} data-path={entry.path}
    onKeyDown={event => { if (event.target !== event.currentTarget) return; if (event.key === 'ArrowRight' && directory) { event.preventDefault(); if (!open) setOpen(true); else item.current?.querySelector<HTMLElement>('[role="treeitem"]')?.focus(); } else if (event.key === 'ArrowLeft') { event.preventDefault(); if (open) setOpen(false); else item.current?.parentElement?.closest<HTMLElement>('[role="treeitem"]')?.focus(); } else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); if (selectable) onSelect({ path: entry.path, kind: directory ? 'directory' : 'file', revision }); if (directory) setOpen(value => !value); } }}>
    <div className="source-tree-node" onClick={() => { item.current?.focus(); if (selectable) onSelect({ path: entry.path, kind: directory ? 'directory' : 'file', revision }); if (directory) setOpen(value => !value); }}>
      {directory ? (open ? <ChevronDown size={12} /> : <ChevronRight size={12} />) : <span className="source-tree-spacer" />}{directory ? (open ? <FolderOpen size={15} /> : <Folder size={15} />) : <FileCode size={15} />}<span title={entry.path}>{entry.name}</span>{entry.kind === 'submodule' || entry.kind === 'symlink' ? <small>{entry.kind === 'submodule' ? 'submodule' : 'link'}</small> : null}
    </div>
    {directory && open ? <ul role="group">{data.loading ? <li role="none" className="source-tree-note">Loading…</li> : null}{data.error ? <li role="none"><button type="button" onClick={data.reload}>Retry: {data.error}</button></li> : null}
      {[...(data.data?.entries ?? []), ...more.entries].map(child => <Node key={child.path} entry={child} revision={revision} repository={repository} selectedPath={selectedPath} onSelect={onSelect} />)}
      <MoreEntries more={more} />
      {data.data?.truncated ? <li role="none" className="source-tree-note">GitHub returned a partial listing for this directory.</li> : null}
    </ul> : null}
  </li>;
}
/** How long typing pauses before a search runs (CR-133). */
const SEARCH_DEBOUNCE_MS = 250;
/** Matches drawn at a time (CR-138: not a total — the next batch draws when the reader scrolls to the end of the results). */
export const SEARCH_RESULT_LIMIT = 200;
const count = (value: number) => value.toLocaleString('en-US');
const matchesText = (value: number) => `${count(value)} ${value === 1 ? 'match' : 'matches'}`;

interface Listing { key: string; list: PathList; next: string | null; started: boolean; loading: boolean; done: boolean; cancelled: boolean; error: string; incomplete: boolean }
const idle = (key: string): Listing => ({ key, list: EMPTY_PATH_LIST, next: null, started: false, loading: false, done: false, cancelled: false, error: '', incomplete: false });
/**
 * CR-133: every file path of the pinned revision, read once when a search starts (`active`) and kept in memory while the
 * revision stays. Typing filters it locally; only Cancel, another revision or leaving the page stops the reading.
 */
function usePathListing(repository: string, revision: string | null, active: boolean) {
  const key = revision ? `${repository}@${revision}` : '';
  const [state, setState] = useState<Listing>(() => idle(key));
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => { controller.current?.abort(); }, [key]);
  const current = state.key === key ? state : idle(key);
  const read = useCallback((after: string | null) => {
    if (!revision) return;
    controller.current?.abort(); const abort = new AbortController(); controller.current = abort;
    const update = (change: (value: Listing) => Partial<Listing>) => { setState(value => { const base = value.key === key ? value : idle(key); return { ...base, ...change(base) }; }); };
    update(() => ({ started: true, loading: true, done: false, error: '', cancelled: false }));
    loadPaths(repository, revision, { signal: abort.signal, after, onPage: page => {
      if (!abort.signal.aborted) update(value => ({ list: appendPaths(value.list, page.paths), next: page.next_after, incomplete: value.incomplete || page.incomplete, done: page.next_after === null, loading: page.next_after !== null }));
    } }).catch((error: unknown) => { if (!abort.signal.aborted) update(() => ({ loading: false, error: error instanceof Error ? error.message : 'Unable to list the files in this revision.' })); });
  }, [repository, revision, key]);
  useEffect(() => { if (active && revision && !current.started) read(null); }, [active, revision, current.started, read]);
  // A search that starts again after a failed listing (the box was cleared, then typed into) retries once from where the
  // listing stopped, rather than showing the old failure against the new query. A cancel stays until Continue listing.
  const wasActive = useRef(active);
  useEffect(() => {
    if (active && !wasActive.current && current.error !== '' && !current.loading) read(current.next);
    wasActive.current = active;
  }, [active, current.error, current.loading, current.next, read]);
  return {
    ...current,
    resume: () => { read(current.next); },
    cancel: () => { controller.current?.abort(); setState(value => (value.key === key ? { ...value, loading: false, cancelled: true } : value)); },
  };
}

export function SourceTree(props: TreeProps) {
  const root = useSource<TreeData>(props.repository ? sourceUrl(props.repository, 'tree', { ref: props.branch, offset: 0 }) : null);
  const more = useMoreEntries(props.repository, root.data);
  const [find, setFind] = useState(''); const [query, setQuery] = useState('');
  const tree = useRef<HTMLUListElement>(null); const input = useRef<HTMLInputElement>(null); const results = useRef<HTMLUListElement>(null);
  useEffect(() => { setFind(''); setQuery(''); }, [props.repository, props.branch]);
  // CR-133: the search runs once typing pauses; clearing the box shows the tree at once.
  useEffect(() => { const next = find.trim(); const timer = setTimeout(() => { setQuery(next); }, next === '' ? 0 : SEARCH_DEBOUNCE_MS); return () => { clearTimeout(timer); }; }, [find]);
  const revision = root.data?.revision ?? null;
  const searching = query !== '' && revision !== null;
  const listing = usePathListing(props.repository, revision, searching);
  const [shown, setShown] = useState(SEARCH_RESULT_LIMIT);
  useEffect(() => { setShown(SEARCH_RESULT_LIMIT); }, [query, revision]);
  const found = useMemo(() => matchPaths(listing.list, query, shown), [listing.list, query, shown]);
  const moreResults = useRef<HTMLLIElement>(null);
  const showMore = useCallback(() => { setShown((value) => value + SEARCH_RESULT_LIMIT); }, []);
  useAutoLoad(moreResults, searching && found.total > found.matches.length, showMore);
  function move(event: KeyboardEvent<HTMLUListElement>) {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const items = Array.from(tree.current?.querySelectorAll<HTMLElement>('[role="treeitem"]') ?? []);
    const index = items.indexOf(document.activeElement as HTMLElement); if (!items.length) return;
    event.preventDefault(); const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : Math.max(0, Math.min(items.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1))); items[next]?.focus();
  }
  const resultButtons = () => Array.from(results.current?.querySelectorAll<HTMLButtonElement>('button.source-search-result') ?? []);
  function clearSearch() { setFind(''); input.current?.focus(); }
  function moveResults(event: KeyboardEvent<HTMLUListElement>) {
    if (event.key === 'Escape') { event.preventDefault(); clearSearch(); return; }
    const buttons = resultButtons();
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) || !buttons.length) return;
    event.preventDefault(); const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === 'ArrowUp' && index <= 0) { input.current?.focus(); return; }
    buttons[event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : Math.max(0, Math.min(buttons.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))]?.focus();
  }
  const listed = listing.list.entries.length;
  // Never "no files match" before the whole list has been read (CR-133): while listing, after a cancel or an error the
  // count says how far the search got.
  const status = listing.error ? <div role="alert" className="source-search-status">{listing.error}<button type="button" onClick={listing.resume}>Retry</button></div>
    : listing.cancelled ? <p role="status" className="source-search-status">Listing stopped after {count(listed)} paths · {matchesText(found.total)} so far, so the results may be incomplete.<button type="button" onClick={listing.resume}>Continue listing</button></p>
    : !listing.done ? <p role="status" className="source-search-status">Listing files… {count(listed)} paths{listed > 0 ? ` · ${matchesText(found.total)} so far` : ''}<button type="button" onClick={listing.cancel}>Cancel</button></p>
    : found.total === 0 ? <p role="status" className="source-search-status">No files in this revision match &quot;{query}&quot;.</p>
    : <p role="status" className="source-search-status">{matchesText(found.total)}{found.total > found.matches.length ? ` · showing ${count(found.matches.length)}, more as you scroll` : ''}</p>;
  return <section className="source-tree" aria-label="Repository files">
    <header><strong>Files & folders</strong><button type="button" aria-label="Refresh file tree" disabled={root.loading} onClick={root.reload}><RefreshCw size={13} /></button></header>
    {root.data ? <p className="source-tree-ref"><GitBranch size={12} />{root.data.ref.slice(0, 35)}<code title={root.data.revision}>{root.data.revision.slice(0, 7)}</code></p> : null}
    <label className="source-tree-find"><Search size={13} /><span className="ui-sr-only">Search files in this revision</span><input ref={input} placeholder="Search files in this revision…" value={find} onChange={event => { setFind(event.target.value); }}
      onKeyDown={event => { if (event.key === 'Escape' && find !== '') { event.preventDefault(); clearSearch(); } else if (event.key === 'ArrowDown' && searching) { const first = resultButtons()[0]; if (first) { event.preventDefault(); first.focus(); } } }} /></label>
    {root.loading ? <p role="status" className="source-tree-note">Loading repository tree…</p> : root.error ? <div role="alert" className="source-tree-note">{root.error}<button type="button" onClick={root.reload}>Retry</button></div> : null}
    {searching ? <>{status}{listing.incomplete ? <p className="source-search-status">GitHub returned a partial listing for a directory, so some files may be missing.</p> : null}
      <ul ref={results} className="source-search-results" aria-label="Matching files" onKeyDown={moveResults}>
        {found.matches.map(match => <li key={match.entry.path}><button type="button" className="source-search-result" title={match.entry.path} aria-current={props.selectedPath === match.entry.path ? 'true' : undefined}
          onClick={() => { props.onSelect({ path: match.entry.path, kind: 'file', revision: revision! }); }}><FileCode size={14} /><span><strong>{match.name}</strong><small>{match.parent === '' ? '/' : match.parent}</small></span>{match.entry.kind === 'symlink' ? <small className="source-search-kind">link</small> : null}</button></li>)}
        {found.total > found.matches.length ? <li ref={moreResults}><button type="button" className="source-tree-more" onClick={showMore}>Show more matches ({count(found.matches.length)} of {count(found.total)})</button></li> : null}
      </ul></> : null}
    {root.data ? <><button type="button" className="source-tree-root" hidden={searching} onClick={() => { props.onSelect({ path: '', kind: 'directory', revision: root.data!.revision }); }}><FolderOpen size={14} />/ <span>All changes</span></button>
      {/* CR-133: the tree stays mounted while searching so its open folders are kept for when the search is cleared. */}
      <ul ref={tree} role="tree" aria-label="Files and folders" tabIndex={0} onKeyDown={move} hidden={searching}>
        {[...root.data.entries, ...more.entries].map(entry => <Node key={`${root.data!.revision}:${entry.path}`} entry={entry} revision={root.data!.revision} repository={props.repository} selectedPath={props.selectedPath} onSelect={props.onSelect} />)}
        <MoreEntries more={more} />
      </ul>{root.data.truncated && !searching ? <p className="source-tree-note">GitHub returned a partial listing for this directory.</p> : null}</> : null}
  </section>;
}
