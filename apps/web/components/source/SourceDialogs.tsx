'use client';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import * as Slider from '@radix-ui/react-slider';
import { ArrowDown, ArrowLeftRight, ArrowUp, ChevronLeft, ChevronRight, FileCode, GitCompareArrows, History, Maximize2, Minimize2, Search, X } from 'lucide-react';
import type { SourceChange, SourceCommit, SourceComparison, SourceHistory } from '@prs/contracts';
import { Button, Dialog } from '../ui';
import { formatDate } from '../../lib/format';
import { ThemeToggle } from '../ui/ThemeToggle';
import { wordChanges } from '../../lib/source-analysis';
import { ROW_CHANGE, lineEvents } from '../../lib/source-compute';
import { displayLine, rawLines } from '../../lib/source-jobs';
import { formatBytes, type LoadedFile } from '../../lib/source-client';
import { fetchSource, sourceUrl, useSource } from './api';
import { LINE_HEIGHT, scrollToRow, useFileText, useLineDiff, useOffsets, useTrace, useVirtualWindow, type VirtualWindow } from './hooks';

export interface DiffTarget { repository: string; pr?: number; commit?: string; file?: { path: string; base: string | null; head: string } }
function ModalFrame({ title, subtitle, children, onClose, badge }: { title: string; subtitle: string; children: ReactNode; onClose: () => void; badge: string }) {
  const [full, setFull] = useState(false); const [offset, setOffset] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; left: number; top: number; width: number; height: number } | null>(null);
  return <Dialog.Root open onOpenChange={open => { if (!open) onClose(); }}><Dialog.Content className={`source-modal ${full ? 'source-modal--full' : ''}`} style={{ translate: full ? '0 0' : `${offset.x}px ${offset.y}px` } as CSSProperties}>
    <header className="source-modal-header" onPointerDown={event => { if (full || (event.target as HTMLElement).closest('button,input,a')) return; const bounds = event.currentTarget.parentElement!.getBoundingClientRect(); drag.current = { x: event.clientX, y: event.clientY, left: offset.x, top: offset.y, width: bounds.width, height: bounds.height }; event.currentTarget.setPointerCapture(event.pointerId); }} onPointerMove={event => { if (!drag.current || !event.currentTarget.hasPointerCapture(event.pointerId)) return; setOffset({ x: Math.max(-(window.innerWidth - drag.current.width) / 2 + 8, Math.min((window.innerWidth - drag.current.width) / 2 - 8, drag.current.left + event.clientX - drag.current.x)), y: Math.max(-(window.innerHeight - drag.current.height) / 2 + 8, Math.min(window.innerHeight / 2 - 60, drag.current.top + event.clientY - drag.current.y)) }); }} onPointerUp={() => { drag.current = null; }}>
      <span className="source-mode-badge">{badge}</span><div><Dialog.Title>{title}</Dialog.Title><Dialog.Description>{subtitle}</Dialog.Description></div><ThemeToggle /><Button variant="ghost" aria-label={full ? 'Exit full screen' : 'Full screen'} onClick={() => { setFull(value => !value); setOffset({ x: 0, y: 0 }); }}>{full ? <Minimize2 size={17} /> : <Maximize2 size={17} />}</Button><Dialog.Close asChild><Button variant="ghost" aria-label="Close source analysis"><X size={18} /></Button></Dialog.Close>
    </header>{children}
  </Dialog.Content></Dialog.Root>;
}

export function SourceActions({ repository, pr, commit, path, revision }: { repository: string; pr?: number; commit?: string; path?: string; revision?: string }) {
  const [opened, setOpened] = useState<'diff' | 'time' | null>(null);
  return <><Button size="sm" variant="secondary" onClick={() => { setOpened(path ? 'time' : 'diff'); }}>{path ? <History size={14} /> : <GitCompareArrows size={14} />}{path ? 'Time-lapse' : 'View diff'}</Button>
    {opened === 'diff' ? <DiffModal target={{ repository, ...(pr ? { pr } : {}), ...(commit ? { commit } : {}) }} onClose={() => { setOpened(null); }} /> : null}
    {opened === 'time' && path ? <TimeLapseModal repository={repository} path={path} revision={revision ?? commit ?? ''} onClose={() => { setOpened(null); }} /> : null}</>;
}
/** Word highlighting of one changed row, computed only while the row is rendered (CR-132). The whole line is always shown. */
function WordLine({ before, after, side, change, needle }: { before: string | null; after: string | null; side: 'before' | 'after'; change: boolean; needle: string }) {
  const current = side === 'before' ? before : after;
  const parts = useMemo(() => (current === null ? [] : change && before !== null && after !== null ? wordChanges(before, after, side) : [{ text: current, changed: false }]), [current, change, before, after, side]);
  if (current === null) return <span aria-hidden="true"> </span>;
  return <>{parts.map((part, i) => <span key={i} className={part.changed ? 'source-word-change' : undefined}>{highlight(part.text, needle)}</span>)}</>;
}
function highlight(text: string, needle: string): ReactNode {
  if (!needle) return text || ' ';
  const result: ReactNode[] = []; let offset = 0; let index = text.toLowerCase().indexOf(needle.toLowerCase());
  while (index !== -1) { result.push(text.slice(offset, index), <mark key={index}>{text.slice(index, index + needle.length)}</mark>); offset = index + needle.length; index = text.toLowerCase().indexOf(needle.toLowerCase(), offset); }
  result.push(text.slice(offset)); return result;
}
const EMPTY_FILE: LoadedFile = { status: 'text', text: '', size: 0, sha: null, reason: null };
/** GitHub lists at most this many changed files for one pull request or commit (its own documented limit). */
const GITHUB_FILE_LIST_LIMIT = 3000;
const progressText = (states: readonly { progress: { loaded: number; total: number | null } | null }[]): string => {
  const known = states.filter(state => state.progress !== null && state.progress.total !== null);
  if (!known.length) return '';
  const loaded = known.reduce((sum, state) => sum + state.progress!.loaded, 0); const total = known.reduce((sum, state) => sum + (state.progress!.total ?? 0), 0);
  return ` ${formatBytes(loaded)} of ${formatBytes(total)}`;
};
/** Spacer rows keep a virtualized table's scroll height equal to the full table (CR-132). */
function Pad({ height, columns }: { height: number; columns: number }) {
  return height > 0 ? <tr aria-hidden="true" className="source-virtual-pad" style={{ height }}><td colSpan={columns} /></tr> : null;
}

/**
 * CR-132: the complete changed-file list beyond GitHub's 3,000-file limit, read by comparing the two pinned trees.
 * Line counts and renames are not available from a tree comparison, so those columns show "—".
 */
function useTreeListing(repository: string, pinned: { base: string | null; head: string } | null) {
  const [state, setState] = useState<{ active: boolean; files: SourceChange[]; next: string | null; loading: boolean; error: string; partial: boolean }>({ active: false, files: [], next: null, loading: false, error: '', partial: false });
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => { controller.current?.abort(); }, []);
  const load = useCallback((after: string | null) => {
    if (pinned === null) return;
    controller.current?.abort(); const abort = new AbortController(); controller.current = abort;
    setState(value => ({ ...value, active: true, loading: true, error: '' }));
    fetchSource<SourceComparison>(sourceUrl(repository, 'diff', { listing: 'tree', head: pinned.head, base: pinned.base ?? undefined, after: after ?? undefined }), abort.signal)
      .then(page => {
        if (abort.signal.aborted) return;
        if (page.head !== pinned.head || page.base !== pinned.base) { setState(value => ({ ...value, loading: false, error: 'The compared revisions changed. Close and reopen the comparison.' })); return; }
        setState(value => ({ active: true, files: after === null ? page.files : [...value.files, ...page.files], next: page.next_after ?? null, loading: false, error: '', partial: value.partial || page.truncated }));
      })
      .catch((error: unknown) => { if (!abort.signal.aborted) setState(value => ({ ...value, loading: false, error: error instanceof Error ? error.message : 'Unable to load the changed files.' })); });
  }, [repository, pinned]);
  return { ...state, start: () => { load(null); }, more: () => { load(state.next); } };
}

export function DiffModal({ target, onClose }: { target: DiffTarget; onClose: () => void }) {
  const [page, setPage] = useState(1); const metadata = useSource<SourceComparison>(target.file ? null : sourceUrl(target.repository, 'diff', { pr: target.pr, commit: target.commit, page, related: target.commit ? 'all' : undefined }));
  const [allFiles, setAllFiles] = useState<SourceChange[]>([]); const [selected, setSelected] = useState(target.file?.path ?? ''); const [filter, setFilter] = useState(''); const [contextError, setContextError] = useState('');
  const pinned = useRef<{ base: string | null; head: string } | null>(null);
  useEffect(() => {
    if (!metadata.data) return;
    if (pinned.current && (metadata.data.head !== pinned.current.head || metadata.data.base !== pinned.current.base)) { setContextError('This PR changed while loading files. Close and reopen the comparison.'); return; }
    pinned.current = { base: metadata.data.base, head: metadata.data.head };
    setAllFiles(previous => { if (page === 1) return metadata.data!.files; const seen = new Set(previous.map(file => file.path)); return [...previous, ...metadata.data!.files.filter(file => !seen.has(file.path))]; });
    setSelected(previous => previous || metadata.data!.files[0]?.path || '');
  }, [metadata.data, page]);
  const listing = useTreeListing(target.repository, pinned.current);
  const files: SourceChange[] = target.file ? [{ path: target.file.path, previous_path: null, status: 'modified', additions: 0, deletions: 0 }] : listing.active ? listing.files : allFiles;
  const file = files.find(item => item.path === selected) ?? files[0];
  const originalBase = target.file?.base ?? pinned.current?.base ?? null; const originalHead = target.file?.head ?? pinned.current?.head ?? '';
  const [swapped, setSwapped] = useState(false);
  const beforePath = file?.previous_path ?? file?.path ?? ''; const afterPath = file?.path ?? '';
  const beforeState = useFileText(target.repository, file && originalBase && file.status !== 'added' ? beforePath : null, originalBase);
  const afterState = useFileText(target.repository, file && originalHead && file.status !== 'removed' ? afterPath : null, originalHead || null);
  const originalBefore = !originalBase || file?.status === 'added' ? EMPTY_FILE : beforeState.file;
  const originalAfter = file?.status === 'removed' ? EMPTY_FILE : afterState.file;
  const comparable = (loaded: LoadedFile | null): loaded is LoadedFile => loaded !== null && (loaded.status === 'text' || (Boolean(target.file) && loaded.status === 'missing'));
  const beforeText = file && comparable(originalBefore) ? originalBefore.text ?? '' : null; const afterText = file && comparable(originalAfter) ? originalAfter.text ?? '' : null;
  const diff = useLineDiff(beforeText, afterText);
  const before = swapped ? originalAfter : originalBefore; const after = swapped ? originalBefore : originalAfter;
  const leftLines = useMemo(() => rawLines((swapped ? afterText : beforeText) ?? ''), [swapped, beforeText, afterText]);
  const rightLines = useMemo(() => rawLines((swapped ? beforeText : afterText) ?? ''), [swapped, beforeText, afterText]);
  const rows = diff.result?.rows ?? null; const rowTotal = rows ? rows.length / 3 : 0;
  const left = useCallback((row: number) => rows![3 * row + (swapped ? 2 : 1)]!, [rows, swapped]);
  const right = useCallback((row: number) => rows![3 * row + (swapped ? 1 : 2)]!, [rows, swapped]);
  const [mode, setMode] = useState<'split' | 'unified'>('split'); const [find, setFind] = useState(''); const [showAll, setShowAll] = useState(false); const [time, setTime] = useState(false);
  const counts = useMemo(() => { let additions = 0; let deletions = 0; for (let row = 0; row < rowTotal; row++) if (rows![3 * row] === ROW_CHANGE) { if (right(row) >= 0) additions++; if (left(row) >= 0) deletions++; } return { additions, deletions }; }, [rows, rowTotal, left, right]);
  const scroller = useRef<HTMLDivElement>(null); const [position, setPosition] = useState(0);
  useEffect(() => { setPosition(0); setShowAll(false); }, [selected, find, swapped]);
  const lineText = useCallback((side: 'left' | 'right', row: number): string | null => { const index = side === 'left' ? left(row) : right(row); return index < 0 ? null : displayLine((side === 'left' ? leftLines : rightLines)[index] ?? ''); }, [left, right, leftLines, rightLines]);
  const matches = useMemo(() => {
    const out: number[] = []; const needle = find.toLowerCase();
    for (let row = 0; row < rowTotal; row++) {
      if (find) { if (lineText('left', row)?.toLowerCase().includes(needle) || lineText('right', row)?.toLowerCase().includes(needle)) out.push(row); }
      else if (rows![3 * row] === ROW_CHANGE && (row === 0 || rows![3 * (row - 1)] !== ROW_CHANGE)) out.push(row);
    }
    return out;
  }, [rows, rowTotal, find, lineText]);
  // Rows shown when unchanged lines are collapsed: every change and three lines of context around it.
  const context = useMemo(() => {
    if (!rows) return null; const mask = new Uint8Array(rowTotal); let any = false;
    for (let row = 0; row < rowTotal; row++) if (rows[3 * row] === ROW_CHANGE) { any = true; for (let n = Math.max(0, row - 3); n <= Math.min(rowTotal - 1, row + 3); n++) mask[n] = 1; }
    return any ? mask : null;
  }, [rows, rowTotal]);
  const collapsed = !showAll && !find && context !== null;
  /** Display items: a row index, or -(index + 1) for the "Show unchanged lines" row that replaces a hidden run. */
  const items = useMemo(() => {
    if (!rows) return new Int32Array(0);
    if (!collapsed) return Int32Array.from({ length: rowTotal }, (_, row) => row);
    const out: number[] = [];
    for (let row = 0; row < rowTotal; row++) { if (context![row]) out.push(row); else if (row === 0 || context![row - 1]) out.push(-(row + 1)); }
    return Int32Array.from(out);
  }, [rows, rowTotal, collapsed, context]);
  const heightOf = useCallback((position: number) => { const item = items[position]!; return item >= 0 && mode === 'unified' && rows![3 * item] === ROW_CHANGE && left(item) >= 0 && right(item) >= 0 ? 2 * LINE_HEIGHT : LINE_HEIGHT; }, [items, mode, rows, left, right]);
  const offsets = useOffsets(items.length, heightOf);
  const windowed = useVirtualWindow(scroller, offsets);
  function jump(direction: number) {
    if (!matches.length) return; const next = (position + direction + matches.length) % matches.length; setPosition(next);
    const row = matches[next]!; let low = 0; let high = items.length - 1;
    while (low < high) { const middle = (low + high) >>> 1; const item = items[middle]!; if ((item >= 0 ? item : -item - 1) < row) low = middle + 1; else high = middle; }
    scrollToRow(scroller.current, offsets, low);
  }
  const loadingFiles = beforeState.loading || afterState.loading;
  const cancelledLoad = beforeState.cancelled || afterState.cancelled || diff.cancelled;
  const failure = contextError || metadata.error || listing.error || beforeState.error || afterState.error || diff.error;
  const busy = loadingFiles || diff.computing || (!files.length && metadata.loading);
  const githubLimit = !target.file && !listing.active && !metadata.loading && !metadata.data?.next_page && (allFiles.length >= GITHUB_FILE_LIST_LIMIT || metadata.data?.truncated === true);
  const unavailable = !loadingFiles && !cancelledLoad && Boolean(file) && originalBefore !== null && originalAfter !== null && (beforeText === null || afterText === null);
  const changedRows = useMemo(() => (rows ? rowsChanged(rows) : 0), [rows]);
  const allEqual = rows !== null && changedRows === 0;
  const retry = () => { metadata.reload(); beforeState.reload(); afterState.reload(); diff.retry(); };
  const count = (item: SourceChange, side: 'additions' | 'deletions') => { if (target.file) return rows ? String(counts[side]) : '—'; const value = item[side]; return value === null ? '—' : String(value); };
  return <ModalFrame title={target.pr ? `Pull request #${target.pr}` : metadata.data?.commit.message.split('\n')[0] || 'Compare changes'} subtitle={`${target.repository} · ${originalBase?.slice(0, 9) ?? 'Empty tree'} → ${originalHead.slice(0, 9)}`} badge="DIFF" onClose={onClose}>
    <div className="source-diff-toolbar"><div className="source-segment" aria-label="Diff layout"><button type="button" aria-pressed={mode === 'split'} onClick={() => { setMode('split'); }}>Side by side</button><button type="button" aria-pressed={mode === 'unified'} onClick={() => { setMode('unified'); }}>Unified</button></div><label className="source-find"><Search size={14} /><input aria-label="Find in diff" placeholder="Find in diff…" value={find} onChange={event => { setFind(event.target.value); }} /></label><span>{matches.length} {find ? (matches.length === 1 ? 'matching line' : 'matching lines') : (matches.length === 1 ? 'change group' : 'change groups')}</span><Button size="sm" variant="ghost" aria-label="Previous match or change" disabled={!matches.length} onClick={() => { jump(-1); }}><ArrowUp size={14} /></Button><Button size="sm" variant="ghost" aria-label="Next match or change" disabled={!matches.length} onClick={() => { jump(1); }}><ArrowDown size={14} /></Button><Button size="sm" variant="ghost" onClick={() => { setSwapped(value => !value); }}><ArrowLeftRight size={14} />Swap</Button><Button size="sm" variant="secondary" disabled={!file} onClick={() => { setTime(true); }}><History size={14} />Time-lapse</Button></div>
    <div className="source-diff-layout"><aside className="source-changed-files"><h3>Changed files <span>{files.length}</span></h3><input aria-label="Filter changed files" placeholder="Filter files…" value={filter} onChange={event => { setFilter(event.target.value); }} />{files.filter(item => `${item.path} ${item.previous_path ?? ''}`.toLowerCase().includes(filter.toLowerCase())).map(item => <button type="button" key={item.path} aria-pressed={file?.path === item.path} onClick={() => { setSelected(item.path); }}><FileCode size={14} /><span>{item.path}<small>{item.status}{item.previous_path ? ` ← ${item.previous_path}` : ''}</small></span><small className="source-file-count">{target.file && !rows ? '—' : `+${count(item, 'additions')} −${count(item, 'deletions')}`}</small></button>)}
      {!listing.active && metadata.data?.next_page && !contextError ? <Button variant="ghost" disabled={metadata.loading} onClick={() => { setPage(metadata.data!.next_page!); }}>More files</Button> : null}
      {githubLimit ? <div className="source-list-limit"><p>GitHub lists at most 3,000 changed files for one change, so this list may be incomplete.</p><Button variant="secondary" disabled={!pinned.current || Boolean(contextError)} onClick={listing.start}>Load the complete list</Button></div> : null}
      {listing.active ? <div className="source-list-limit"><p>Complete list from comparing the two trees. Line counts and renames are not available here.{listing.partial ? ' GitHub returned a partial listing for a directory, so files may still be missing.' : ''}</p>{listing.next ? <Button variant="ghost" disabled={listing.loading} onClick={listing.more}>{listing.loading ? 'Loading files…' : 'More files'}</Button> : listing.loading ? <p role="status">Loading files…</p> : null}</div> : null}
    </aside><section className="source-diff-pane"><div className="source-file-heading"><strong>{file?.path ?? 'Choose a file'}</strong><label><input type="checkbox" checked={showAll} onChange={event => { setShowAll(event.target.checked); }} />Show all lines</label></div>
      {file?.previous_path ? <p className="source-caption">Renamed from <a href={`/search?${new URLSearchParams({ repository: target.repository, path: file.previous_path, tab: 'history', path_kind: 'file', source_ref: originalBase ?? '' })}`}>{file.previous_path}</a></p> : null}
      {failure ? <div role="alert" className="source-notice">{failure}{!contextError ? <Button variant="secondary" onClick={retry}>Retry</Button> : null}</div>
        : loadingFiles ? <p role="status" className="source-notice">Loading file versions…{progressText([beforeState, afterState])}<Button variant="ghost" onClick={() => { beforeState.cancel(); afterState.cancel(); }}>Cancel</Button></p>
        : diff.computing ? <p role="status" className="source-notice">Comparing lines…<Button variant="ghost" onClick={diff.cancel}>Cancel</Button></p>
        : cancelledLoad ? <div role="status" className="source-notice">The comparison was cancelled.<Button variant="secondary" onClick={retry}>Retry</Button></div>
        : busy ? <p role="status" className="source-notice">Loading file versions…</p> : null}
      {!busy && !failure && metadata.data && !files.length ? <div className="source-empty"><FileCode size={28} /><h3>No changed files</h3><p>This revision has no file changes to compare.</p></div> : null}
      {!failure && unavailable ? <div className="source-empty"><FileCode size={28} /><h3>Text comparison unavailable</h3><p>{before?.reason ?? after?.reason ?? 'This file cannot be compared as text.'}</p></div> : null}
      {!busy && !failure && rows ? <DiffRows rows={rows} items={items} windowed={windowed} scroller={scroller} mode={mode} find={find} left={left} right={right} lineText={lineText} onExpand={() => { setShowAll(true); }} labels={{ before: `BEFORE · ${(swapped ? originalHead : originalBase)?.slice(0, 9) ?? 'Empty tree'}${before?.status === 'missing' ? ' · Path absent' : ''}`, after: `AFTER · ${(swapped ? originalBase : originalHead)?.slice(0, 9) ?? 'Empty tree'}${after?.status === 'missing' ? ' · Path absent' : ''}` }}
        empty={allEqual ? (beforeText === afterText ? 'No differences between these versions.' : 'These versions differ only in the newline at the end of the file.') : null}
        caption={`${before?.text && !before.text.endsWith('\n') ? 'Before: no newline at EOF. ' : ''}${after?.text && !after.text.endsWith('\n') ? 'After: no newline at EOF. ' : ''}${changedRows} changed ${changedRows === 1 ? 'row' : 'rows'} · Revisions stay pinned while you inspect.${diff.result?.approximate ? ' The exact line alignment exceeded its time budget, so an approximate alignment is shown: every line is present, but some changes may be grouped differently than Git would group them.' : ''}`} /> : null}
    </section></div>
    {metadata.data?.pull_requests_unavailable ? <p className="source-caption">PR context is temporarily unavailable. The source comparison remains available.</p> : null}
    {metadata.data?.pull_requests.length ? <details className="source-pr-context"><summary>Related pull requests · {metadata.data.pull_requests.length}</summary>{metadata.data.pull_requests.map(pr => <article key={pr.number}><a href={`/pr/${target.repository}/${pr.number}`}>#{pr.number} {pr.title}</a><pre>{pr.body || 'No description.'}</pre></article>)}</details> : null}
    {time && file ? <TimeLapseModal repository={target.repository} path={file.path} revision={originalHead} onClose={() => { setTime(false); }} /> : null}
  </ModalFrame>;
}
function rowsChanged(rows: Int32Array): number { let changed = 0; for (let index = 0; index < rows.length; index += 3) if (rows[index] === ROW_CHANGE) changed++; return changed; }

/** The diff table. Above the virtualization threshold only the rows near the viewport are in the DOM (CR-132). */
function DiffRows({ rows, items, windowed, scroller, mode, find, left, right, lineText, onExpand, labels, empty, caption }: {
  rows: Int32Array; items: Int32Array; windowed: VirtualWindow; scroller: RefObject<HTMLDivElement | null>; mode: 'split' | 'unified'; find: string;
  left: (row: number) => number; right: (row: number) => number; lineText: (side: 'left' | 'right', row: number) => string | null;
  onExpand: () => void; labels: { before: string; after: string }; empty: string | null; caption: string;
}) {
  const rendered: ReactNode[] = [];
  for (let position = windowed.start; position < windowed.end; position++) {
    const item = items[position]!; const rowIndex = windowed.virtual ? { 'aria-rowindex': position + 2 } : {};
    if (item < 0) { rendered.push(<tr key={`gap-${-item - 1}`} {...rowIndex}><td colSpan={4}><button type="button" className="source-context-expand" onClick={onExpand}>Show unchanged lines</button></td></tr>); continue; }
    const change = rows[3 * item] === ROW_CHANGE; const beforeText = lineText('left', item); const afterText = lineText('right', item);
    const beforeNumber = left(item) >= 0 ? left(item) + 1 : undefined; const afterNumber = right(item) >= 0 ? right(item) + 1 : undefined;
    if (mode === 'unified') rendered.push(<tr key={item} {...rowIndex} data-diff-index={item} className={change ? 'source-unified-change' : undefined}><td className="source-line-number">{beforeNumber}</td><td className="source-line-number">{afterNumber}</td><td colSpan={2}>{!change ? <code>{highlight(afterText ?? '', find)}</code> : <>{beforeText !== null ? <div className="source-deleted"><span aria-hidden="true">− </span><code><WordLine before={beforeText} after={afterText} side="before" change={change} needle={find} /></code></div> : null}{afterText !== null ? <div className="source-added"><span aria-hidden="true">+ </span><code><WordLine before={beforeText} after={afterText} side="after" change={change} needle={find} /></code></div> : null}</>}</td></tr>);
    else rendered.push(<tr key={item} {...rowIndex} data-diff-index={item}><td className="source-line-number">{beforeNumber}</td><td className={change && beforeText !== null ? 'source-deleted' : ''}><code><WordLine before={beforeText} after={afterText} side="before" change={change} needle={find} /></code></td><td className="source-line-number">{afterNumber}</td><td className={change && afterText !== null ? 'source-added' : ''}><code><WordLine before={beforeText} after={afterText} side="after" change={change} needle={find} /></code></td></tr>);
  }
  return <><div className="source-revision-headings"><span>{labels.before}</span><span>{labels.after}</span></div><div ref={scroller} className="source-code-scroll" tabIndex={0} role="region" aria-label="File diff"><table className={`source-diff-table source-diff-table--${mode}${windowed.virtual ? ' source-virtual' : ''}`} {...(windowed.virtual ? { 'aria-rowcount': items.length + 1 } : {})}>{mode === 'split' ? <colgroup><col style={{ width: 44 }} /><col style={{ width: 'calc(50% - 44px)' }} /><col style={{ width: 44 }} /><col style={{ width: 'calc(50% - 44px)' }} /></colgroup> : null}<thead className="ui-sr-only"><tr><th scope="col">Before line</th><th scope="col">{mode === 'split' ? 'Before source' : 'After line'}</th><th scope="col">{mode === 'split' ? 'After line' : 'Source'}</th><th scope="col">After source</th></tr></thead><tbody><Pad height={windowed.padTop} columns={4} />{rendered}<Pad height={windowed.padBottom} columns={4} /></tbody></table>{empty ? <p className="source-notice">{empty}</p> : null}</div><p className="source-caption">{caption}</p></>;
}

/** How far back the line analysis reaches from the selected revision (CR-132 — beyond the old fixed 30). */
const ANALYSIS_RANGES = [{ value: '30', label: 'Last 30 revisions' }, { value: '100', label: 'Last 100 revisions' }, { value: '300', label: 'Last 300 revisions' }, { value: 'all', label: 'All loaded revisions' }] as const;
type AnalysisRange = (typeof ANALYSIS_RANGES)[number]['value'];
const FULL_SHA = /^[0-9a-f]{40}$/i;

export function TimeLapseModal({ repository, path, revision, initialCommits, moreAvailable = false, nextPage = null, onClose }: { repository: string; path: string; revision: string; initialCommits?: SourceCommit[]; moreAvailable?: boolean; nextPage?: number | null; onClose: () => void }) {
  const history = useSource<SourceHistory>(initialCommits ? null : sourceUrl(repository, 'history', { ref: revision, path }));
  // CR-132: older revisions load inside the dialog, pinned to the commit SHA the first page resolved.
  const pinnedRevision = history.data?.revision ?? (FULL_SHA.test(revision) ? revision : null);
  const [older, setOlder] = useState<{ commits: SourceCommit[]; next: number | null; touched: boolean; loading: boolean; error: string }>({ commits: [], next: null, touched: false, loading: false, error: '' });
  const olderController = useRef<AbortController | null>(null);
  useEffect(() => () => { olderController.current?.abort(); }, []);
  const firstNext = initialCommits ? (nextPage ?? null) : (history.data?.next_page ?? null);
  const next = older.touched ? older.next : firstNext;
  const newestFirst = useMemo(() => { const seen = new Set<string>(); return [...(initialCommits ?? history.data?.commits ?? []), ...older.commits].filter(commit => (seen.has(commit.sha) ? false : (seen.add(commit.sha), true))); }, [initialCommits, history.data, older.commits]);
  const commits = useMemo(() => [...newestFirst].reverse(), [newestFirst]);
  function loadOlder() {
    if (next === null || pinnedRevision === null) return;
    olderController.current?.abort(); const abort = new AbortController(); olderController.current = abort;
    setOlder(value => ({ ...value, loading: true, error: '' }));
    fetchSource<SourceHistory>(sourceUrl(repository, 'history', { ref: pinnedRevision, path, page: next }), abort.signal)
      .then(pageData => { if (!abort.signal.aborted) setOlder(value => ({ commits: [...value.commits, ...pageData.commits], next: pageData.next_page, touched: true, loading: false, error: '' })); })
      .catch((error: unknown) => { if (!abort.signal.aborted) setOlder(value => ({ ...value, loading: false, error: error instanceof Error ? error.message : 'Unable to load older revisions.' })); });
  }
  const [selectedSha, setSelectedSha] = useState<string | null>(null);
  const found = selectedSha === null ? -1 : commits.findIndex(commit => commit.sha === selectedSha);
  const currentIndex = found >= 0 ? found : commits.length - 1; const selected = commits[currentIndex];
  const select = (index: number) => { const commit = commits[index]; if (commit) setSelectedSha(commit.sha); };
  const file = useFileText(repository, selected ? path : null, selected?.sha ?? null, 180);
  const [contextOpen, setContextOpen] = useState(false); const context = useSource<SourceComparison>(contextOpen && selected ? sourceUrl(repository, 'diff', { commit: selected.sha, related: 'all' }) : null, 180);
  const trace = useTrace(); const [range, setRange] = useState<AnalysisRange>('30');
  const [line, setLine] = useState<number | null>(null); const [needle, setNeedle] = useState('');
  const codePane = useRef<HTMLDivElement>(null);
  const content = useMemo(() => (file.file?.status === 'text' ? rawLines(file.file.text ?? '').map(displayLine) : []), [file.file]);
  const lineHeight = useCallback(() => LINE_HEIGHT, []);
  const offsets = useOffsets(content.length, lineHeight);
  const windowed = useVirtualWindow(codePane, offsets);
  useEffect(() => { if (line !== null && !file.loading) { scrollToRow(codePane.current, offsets, line); codePane.current?.querySelector<HTMLElement>(`[data-source-line="${line}"] button`)?.focus({ preventScroll: true }); } }, [line, file.loading, selected?.sha, offsets]);
  function analyze() {
    if (currentIndex < 0) return;
    const span = range === 'all' ? currentIndex + 1 : Number(range);
    trace.run({ repository, path, revisions: commits.slice(Math.max(0, currentIndex - span + 1), currentIndex + 1).map(commit => commit.sha) });
  }
  const lineage = trace.result?.lineage ?? null;
  const revisionIndex = lineage && selected ? lineage.revisions.indexOf(selected.sha) : -1;
  const nodes = revisionIndex >= 0 ? lineage!.lineNodes[revisionIndex] : undefined;
  const heat = (index: number) => (nodes && lineage ? Math.min(4, (lineage.nodeDepth[nodes[index] ?? -1] ?? 1) - 1) : 0);
  const events = line === null || revisionIndex < 0 ? [] : lineEvents(lineage!, revisionIndex, line);
  const skipped = trace.result?.skipped ?? [];
  const summary = lineage ? `${lineage.revisions.length} revisions analyzed.${skipped.length ? ` ${skipped.length} ${skipped.length === 1 ? 'revision was' : 'revisions were'} skipped because ${skipped.length === 1 ? 'it is' : 'they are'} not text (${skipped.slice(0, 3).map(item => `${item.sha.slice(0, 9)}: ${item.reason}`).join('; ')}${skipped.length > 3 ? '; …' : ''}).` : ''}${lineage.approximatePairs ? ` ${lineage.approximatePairs} adjacent ${lineage.approximatePairs === 1 ? 'pair was' : 'pairs were'} aligned approximately.` : ''} ` : '';
  const rendered: ReactNode[] = [];
  for (let i = windowed.start; i < windowed.end; i++) {
    const text = content[i]!;
    rendered.push(<tr key={i} data-source-line={i} {...(windowed.virtual ? { 'aria-rowindex': i + 2 } : {})} className={`${line === i ? 'source-selected-line' : ''} source-heat-${heat(i)}`}><td className="source-line-number"><button type="button" aria-label={`Inspect line ${i + 1}`} aria-pressed={line === i} tabIndex={line === i || (line === null && i === windowed.start) ? 0 : -1} onKeyDown={event => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setLine(Math.max(0, Math.min(content.length - 1, i + (event.key === 'ArrowDown' ? 1 : -1)))); } }} onClick={() => { setLine(i); }}>{i + 1}</button></td><td onClick={() => { setLine(i); }}><code>{highlight(text, needle)}</code></td></tr>);
  }
  return <ModalFrame title={path} subtitle={`${repository} · Revision-aware file history`} badge="TIME-LAPSE" onClose={onClose}>
    <div className="source-time-toolbar"><Button variant="ghost" aria-label="Previous file revision" disabled={currentIndex <= 0} onClick={() => { setLine(null); select(currentIndex - 1); }}><ChevronLeft size={17} /></Button><Slider.Root aria-label="File revision" min={0} max={Math.max(1, commits.length - 1)} step={1} value={[Math.max(0, currentIndex)]} disabled={commits.length < 2} onValueChange={values => { setLine(null); select(values[0] ?? 0); }} className="source-slider"><Slider.Track><Slider.Range /></Slider.Track><Slider.Thumb aria-label="File revision" aria-valuetext={selected ? `Revision ${currentIndex + 1} of ${commits.length}: ${selected.sha.slice(0, 9)}` : 'No revisions'} /></Slider.Root><Button variant="ghost" aria-label="Next file revision" disabled={currentIndex >= commits.length - 1} onClick={() => { setLine(null); select(currentIndex + 1); }}><ChevronRight size={17} /></Button><span>{Math.max(0, currentIndex + 1)} / {commits.length}</span>
      <label className="source-analysis-range"><span className="ui-sr-only">Analysis range</span><select aria-label="Analysis range" value={range} disabled={trace.running} onChange={event => { setRange(event.target.value as AnalysisRange); }}>{ANALYSIS_RANGES.map(option => <option key={option.value} value={option.value}>{option.value === 'all' ? `All loaded revisions (${Math.max(0, currentIndex + 1)})` : option.label}</option>)}</select></label>
      {trace.running ? <Button variant="secondary" onClick={trace.cancel}>Cancel analysis</Button> : <Button variant="secondary" disabled={!selected || file.loading || file.file?.status !== 'text'} onClick={analyze}>Analyze line history</Button>}<Button variant="ghost" aria-pressed={contextOpen} onClick={() => { setContextOpen(value => !value); }}>Related PRs</Button></div>
    {next !== null || moreAvailable ? <div className="source-caption">{older.loading ? <span role="status">Loading older revisions…</span> : <Button size="sm" variant="ghost" disabled={next === null || pinnedRevision === null} onClick={loadOlder}>Load older revisions</Button>} {commits.length} revisions loaded. Older revisions of this path are available.</div> : null}
    {trace.running && trace.progress ? <p role="status" className="source-notice">Analyzing revision {trace.progress.done} of {trace.progress.total}…{trace.progress.skipped ? ` ${trace.progress.skipped} skipped (not text).` : ''}</p> : null}
    {trace.cancelled ? <p role="status" className="source-notice">The line analysis was cancelled.{trace.result ? ' The previous analysis is still shown.' : ''}</p> : null}
    {history.error || trace.error || older.error ? <div role="alert" className="source-notice">{history.error || trace.error || older.error}<Button variant="ghost" onClick={older.error ? loadOlder : history.reload}>{older.error ? 'Retry older revisions' : 'Retry history'}</Button></div> : null}
    <div className="source-time-layout"><aside className="source-revisions"><h3>Revisions</h3>{commits.map((commit, i) => ({ commit, i })).reverse().map(({ commit, i }) => <button type="button" key={commit.sha} aria-pressed={i === currentIndex} onClick={() => { setLine(null); select(i); }}><code>{commit.sha.slice(0, 9)}</code><strong>{commit.message.split('\n')[0]}</strong><small>{commit.author} · {commit.date ? formatDate(commit.date, { label: true }) : 'Unknown date'}</small></button>)}</aside>
      <section className="source-time-code"><header><code>{selected?.sha.slice(0, 12) ?? (history.loading ? 'Loading…' : 'No revisions')}</code><label><Search size={13} /><input aria-label="Find in file" placeholder="Find in file…" value={needle} onChange={event => { setNeedle(event.target.value); }} /></label></header>
        {file.loading || history.loading ? <p role="status" className="source-notice">Loading revision…{progressText([file])}{file.loading ? <Button variant="ghost" onClick={file.cancel}>Cancel</Button> : null}</p> : file.error ? <div role="alert" className="source-notice">{file.error}<Button variant="ghost" onClick={file.reload}>Retry</Button></div> : file.cancelled ? <div role="status" className="source-notice">Loading was cancelled.<Button variant="ghost" onClick={file.reload}>Retry</Button></div> : file.file?.status !== 'text' ? <p className="source-notice">{file.file?.reason ?? 'No file content available.'}</p> : <div ref={codePane} className="source-code-scroll" role="region" tabIndex={0} aria-label="File content">{content.length === 0 ? <p className="source-notice">This file is empty at this revision.</p> : null}<table className={`source-file-code${windowed.virtual ? ' source-virtual' : ''}`} {...(windowed.virtual ? { 'aria-rowcount': content.length + 1 } : {})}><thead className="ui-sr-only"><tr><th scope="col">Line</th><th scope="col">Source</th></tr></thead><tbody><Pad height={windowed.padTop} columns={2} />{rendered}<Pad height={windowed.padBottom} columns={2} /></tbody></table></div>}
      </section><aside className="source-line-history"><h3>Line history {line === null ? '' : `· ${line + 1}`}</h3>{!lineage ? <p>Analyze line history, then select a line to follow its changes.</p> : revisionIndex < 0 ? <p>This revision is outside the analyzed range. Analyze again to include it.</p> : line === null ? <p>Select a line number in the file.</p> : <><p role="status">{events.length} observed versions of this line</p>{[...events].reverse().map((event, i) => <button type="button" key={`${event.sha}-${i}`} onClick={() => { const index = commits.findIndex(commit => commit.sha === event.sha); if (index >= 0) { select(index); setLine(event.line - 1); } }}><code>{event.sha.slice(0, 9)}</code><small>{event.kind === 'baseline' ? 'Present at range start' : event.kind === 'edited' ? 'Aligned replacement' : 'Added'}</small><pre>{displayLine(event.text)}</pre></button>)}</>}
        <div className="source-heat-legend" aria-label="Observed edit frequency"><span>Low</span>{[0, 1, 2, 3, 4].map(value => <i key={value} className={`source-heat-${value}`} aria-hidden="true" />)}<span>High</span></div><p className="source-line-disclaimer">{summary}Line correspondence is inferred from adjacent diffs, not authoritative blame. Earlier history and renamed paths may be outside this range.</p>
      </aside></div>
    {contextOpen ? <div className="source-pr-context">{context.loading ? <p>Loading related PRs…</p> : context.error ? <p role="alert">{context.error}</p> : context.data?.pull_requests_unavailable ? <p>PR associations are temporarily unavailable.</p> : context.data?.pull_requests.length ? context.data.pull_requests.map(pr => <article key={pr.number}><a href={`/pr/${repository}/${pr.number}`}>#{pr.number} {pr.title}</a><pre>{pr.body || 'No description.'}</pre></article>) : <p>No associated PR was returned by GitHub.</p>}</div> : null}
  </ModalFrame>;
}
