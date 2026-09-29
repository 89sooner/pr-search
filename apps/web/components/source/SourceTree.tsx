'use client';
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ChevronDown, ChevronRight, FileCode, Folder, FolderOpen, GitBranch, RefreshCw, Search } from 'lucide-react';
import type { SourceEntry, SourceTree as TreeData } from '@prs/contracts';
import { fetchSource, sourceUrl, useSource } from './api';

export interface PathSelection { path: string; kind: 'file' | 'directory'; revision: string }
interface TreeProps { repository: string; branch: string; selectedPath: string; onSelect: (selection: PathSelection) => void }
/**
 * CR-132: a directory is listed page by page (5,000 entries each, sorted by the server) instead of stopping at the first
 * 5,000. Later pages are requested by the listed tree's SHA, so they always belong to the same snapshot.
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
  if (!more.more && !more.error) return null;
  return <li role="none" className="source-tree-note">{more.error ? <button type="button" onClick={more.loadMore}>Retry: {more.error}</button> : <button type="button" className="source-tree-more" disabled={more.loading} onClick={more.loadMore}>{more.loading ? 'Loading more entries…' : `Show more entries (${more.shown.toLocaleString('en-US')} of ${more.total.toLocaleString('en-US')})`}</button>}</li>;
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
export function SourceTree(props: TreeProps) {
  const root = useSource<TreeData>(props.repository ? sourceUrl(props.repository, 'tree', { ref: props.branch, offset: 0 }) : null);
  const more = useMoreEntries(props.repository, root.data);
  const [find, setFind] = useState(''); const tree = useRef<HTMLUListElement>(null);
  useEffect(() => { setFind(''); }, [props.repository, props.branch]);
  function move(event: KeyboardEvent<HTMLUListElement>) {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const items = Array.from(tree.current?.querySelectorAll<HTMLElement>('[role="treeitem"]') ?? []);
    const index = items.indexOf(document.activeElement as HTMLElement); if (!items.length) return;
    event.preventDefault(); const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : Math.max(0, Math.min(items.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1))); items[next]?.focus();
  }
  return <section className="source-tree" aria-label="Repository files">
    <header><strong>Files & folders</strong><button type="button" aria-label="Refresh file tree" disabled={root.loading} onClick={root.reload}><RefreshCw size={13} /></button></header>
    {root.data ? <p className="source-tree-ref"><GitBranch size={12} />{root.data.ref.slice(0, 35)}<code title={root.data.revision}>{root.data.revision.slice(0, 7)}</code></p> : null}
    <label className="source-tree-find"><Search size={13} /><span className="ui-sr-only">Filter root entries</span><input placeholder="Filter root entries…" value={find} onChange={event => { setFind(event.target.value); }} /></label>
    {root.loading ? <p role="status" className="source-tree-note">Loading repository tree…</p> : root.error ? <div role="alert" className="source-tree-note">{root.error}<button type="button" onClick={root.reload}>Retry</button></div> : null}
    {root.data ? <><button type="button" className="source-tree-root" onClick={() => { props.onSelect({ path: '', kind: 'directory', revision: root.data!.revision }); }}><FolderOpen size={14} />/ <span>All changes</span></button>
      <ul ref={tree} role="tree" aria-label="Files and folders" tabIndex={0} onKeyDown={move}>
        {[...root.data.entries, ...more.entries].filter(entry => entry.name.toLowerCase().includes(find.toLowerCase())).map(entry => <Node key={`${root.data!.revision}:${entry.path}`} entry={entry} revision={root.data!.revision} repository={props.repository} selectedPath={props.selectedPath} onSelect={props.onSelect} />)}
        <MoreEntries more={more} />
      </ul>{root.data.truncated ? <p className="source-tree-note">GitHub returned a partial listing for this directory.</p> : null}</> : null}
  </section>;
}
