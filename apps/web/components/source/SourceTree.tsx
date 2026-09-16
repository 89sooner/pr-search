'use client';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ChevronDown, ChevronRight, FileCode, Folder, FolderOpen, GitBranch, RefreshCw, Search } from 'lucide-react';
import type { SourceEntry, SourceTree as TreeData } from '@prs/contracts';
import { sourceUrl, useSource } from './api';

export interface PathSelection { path: string; kind: 'file' | 'directory'; revision: string }
interface TreeProps { repository: string; branch: string; selectedPath: string; onSelect: (selection: PathSelection) => void }
function Node({ entry, revision, repository, selectedPath, onSelect }: Omit<TreeProps, 'branch'> & { entry: SourceEntry; revision: string }) {
  const [open, setOpen] = useState(false); const directory = entry.kind === 'directory';
  useEffect(() => { if (directory && selectedPath.startsWith(`${entry.path}/`)) setOpen(true); }, [directory, selectedPath, entry.path]);
  const data = useSource<TreeData>(directory && open ? sourceUrl(repository, 'tree', { revision, tree_sha: entry.sha, path: entry.path }) : null);
  const item = useRef<HTMLLIElement>(null);
  const selectable = directory || entry.kind === 'file' || entry.kind === 'symlink';
  return <li ref={item} role="treeitem" tabIndex={-1} aria-label={entry.name} aria-expanded={directory ? open : undefined} aria-selected={selectedPath === entry.path} aria-disabled={entry.kind === 'submodule' || undefined} data-path={entry.path}
    onKeyDown={event => { if (event.target !== event.currentTarget) return; if (event.key === 'ArrowRight' && directory) { event.preventDefault(); if (!open) setOpen(true); else item.current?.querySelector<HTMLElement>('[role="treeitem"]')?.focus(); } else if (event.key === 'ArrowLeft') { event.preventDefault(); if (open) setOpen(false); else item.current?.parentElement?.closest<HTMLElement>('[role="treeitem"]')?.focus(); } else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); if (selectable) onSelect({ path: entry.path, kind: directory ? 'directory' : 'file', revision }); if (directory) setOpen(value => !value); } }}>
    <div className="source-tree-node" onClick={() => { item.current?.focus(); if (selectable) onSelect({ path: entry.path, kind: directory ? 'directory' : 'file', revision }); if (directory) setOpen(value => !value); }}>
      {directory ? (open ? <ChevronDown size={12} /> : <ChevronRight size={12} />) : <span className="source-tree-spacer" />}{directory ? (open ? <FolderOpen size={15} /> : <Folder size={15} />) : <FileCode size={15} />}<span title={entry.path}>{entry.name}</span>{entry.kind === 'submodule' || entry.kind === 'symlink' ? <small>{entry.kind === 'submodule' ? 'submodule' : 'link'}</small> : null}
    </div>
    {directory && open ? <ul role="group">{data.loading ? <li role="none" className="source-tree-note">Loading…</li> : null}{data.error ? <li role="none"><button type="button" onClick={data.reload}>Retry: {data.error}</button></li> : null}
      {data.data?.entries.map(child => <Node key={child.path} entry={child} revision={revision} repository={repository} selectedPath={selectedPath} onSelect={onSelect} />)}
      {data.data?.truncated ? <li role="none" className="source-tree-note">Directory listing is partial.</li> : null}
    </ul> : null}
  </li>;
}
export function SourceTree(props: TreeProps) {
  const root = useSource<TreeData>(props.repository ? sourceUrl(props.repository, 'tree', { ref: props.branch }) : null);
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
        {root.data.entries.filter(entry => entry.name.toLowerCase().includes(find.toLowerCase())).map(entry => <Node key={`${root.data!.revision}:${entry.path}`} entry={entry} revision={root.data!.revision} repository={props.repository} selectedPath={props.selectedPath} onSelect={props.onSelect} />)}
      </ul>{root.data.truncated ? <p className="source-tree-note">Directory listing is partial. Open available subfolders or enter a path.</p> : null}</> : null}
  </section>;
}
