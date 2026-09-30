'use client';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import * as Slider from '@radix-ui/react-slider';
import { ArrowDown, ArrowLeftRight, ArrowUp, ChevronLeft, ChevronRight, FileCode, GitCompareArrows, History, Maximize2, Minimize2, Search, X } from 'lucide-react';
import type { SourceChange, SourceCommit, SourceComparison, SourceHistory } from '@prs/contracts';
import { Button, Dialog } from '../ui';
import { formatDate } from '../../lib/format';
import { ThemeToggle } from '../ui/ThemeToggle';
import { wordChanges } from '../../lib/source-analysis';
import { ROW_CHANGE, lineEvents, nodesAt } from '../../lib/source-compute';
import { displayLine, rawLines } from '../../lib/source-jobs';
import { fetchSourceRetrying, formatBytes, type LoadedFile } from '../../lib/source-client';
import { sourceUrl, useSource } from './api';
import { LINE_HEIGHT, scrollToRow, useChangedFiles, useFileText, useLineDiff, useNarrow, useOffsets, useTrace, useVirtualWindow, type VirtualWindow } from './hooks';

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

/** Height of one changed-file row once the list is long enough to be virtualized (CSS pins the rows to it). */
const FILE_ROW_HEIGHT = 48;
const count = (value: number): string => value.toLocaleString('en-US');
const waitText = (ms: number | null): string => (ms === null ? '' : ` GitHub asked to wait — trying again in ${String(Math.max(1, Math.round(ms / 1000)))} s.`);

/**
 * CR-138: the changed files of a comparison, every one of them. The list reads its pages by itself (useChangedFiles);
 * above the virtualization threshold only the rows near the viewport are in the DOM.
 */
function ChangedFileList({ files, selected, onSelect, counts, scroller }: { files: readonly SourceChange[]; selected: string | undefined; onSelect: (path: string) => void; counts: (file: SourceChange) => string; scroller: RefObject<HTMLElement | null> }) {
  // The aside scrolls (its heading, filter and notes come first); the rows are measured from the list's own start.
  const list = useRef<HTMLDivElement>(null);
  const rowHeight = useCallback(() => FILE_ROW_HEIGHT, []);
  const offsets = useOffsets(files.length, rowHeight);
  const windowed = useVirtualWindow(scroller, offsets, 'y', list);
  const rendered: ReactNode[] = [];
  for (let index = windowed.start; index < windowed.end; index++) {
    const item = files[index]!;
    rendered.push(<button type="button" key={item.path} title={item.path} aria-pressed={selected === item.path} onClick={() => { onSelect(item.path); }}><FileCode size={14} /><span>{item.path}<small>{item.status}{item.previous_path ? ` ← ${item.previous_path}` : ''}</small></span><small className="source-file-count">{counts(item)}</small></button>);
  }
  return <div ref={list} className={`source-changed-file-list${windowed.virtual ? ' source-changed-file-list--virtual' : ''}`}>
    {windowed.padTop > 0 ? <div aria-hidden="true" style={{ height: windowed.padTop }} /> : null}{rendered}{windowed.padBottom > 0 ? <div aria-hidden="true" style={{ height: windowed.padBottom }} /> : null}
  </div>;
}

export function DiffModal({ target, onClose }: { target: DiffTarget; onClose: () => void }) {
  const changes = useChangedFiles(target.repository, target.file ? null : { ...(target.pr !== undefined ? { pr: target.pr } : {}), ...(target.commit !== undefined ? { commit: target.commit } : {}) });
  const comparison = changes.comparison;
  const [selected, setSelected] = useState(target.file?.path ?? ''); const [filter, setFilter] = useState('');
  const fileAside = useRef<HTMLElement>(null);
  const files: readonly SourceChange[] = target.file ? [{ path: target.file.path, previous_path: null, status: 'modified', additions: 0, deletions: 0 }] : changes.files;
  useEffect(() => { if (!selected && files[0]) setSelected(files[0].path); }, [files, selected]);
  const file = files.find(item => item.path === selected) ?? files[0];
  const originalBase = target.file?.base ?? comparison?.base ?? null; const originalHead = target.file?.head ?? comparison?.head ?? '';
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
  // A list failure blocks the pane only before any file is listed; later it is reported beside the list (CR-138).
  const listFailure = !target.file && !files.length ? changes.error : '';
  const failure = listFailure || beforeState.error || afterState.error || diff.error;
  const busy = loadingFiles || diff.computing || (!target.file && !files.length && changes.loading);
  const unavailable = !loadingFiles && !cancelledLoad && Boolean(file) && originalBefore !== null && originalAfter !== null && (beforeText === null || afterText === null);
  const changedRows = useMemo(() => (rows ? rowsChanged(rows) : 0), [rows]);
  const allEqual = rows !== null && changedRows === 0;
  const retry = () => { if (listFailure) changes.resume(); beforeState.reload(); afterState.reload(); diff.retry(); };
  const fileCount = useCallback((item: SourceChange): string => {
    const value = (side: 'additions' | 'deletions'): string => { if (target.file) return rows ? String(counts[side]) : '—'; const number = item[side]; return number === null ? '—' : String(number); };
    return target.file && !rows ? '—' : `+${value('additions')} −${value('deletions')}`;
  }, [target.file, rows, counts]);
  const needle = filter.toLowerCase();
  const shownFiles = useMemo(() => (needle ? files.filter(item => `${item.path} ${item.previous_path ?? ''}`.toLowerCase().includes(needle)) : files), [files, needle]);
  const listStatus = target.file ? null
    : changes.loading ? <div className="source-list-limit"><p role="status">Loading changed files… {count(files.length)} so far.{waitText(changes.waitingMs)}</p><Button variant="ghost" onClick={changes.cancel}>Stop loading files</Button></div>
    : changes.cancelled ? <div className="source-list-limit"><p role="status">Stopped after {count(files.length)} files, so this list is not complete.</p><Button variant="secondary" onClick={changes.resume}>Continue loading files</Button></div>
    : changes.error && files.length && !changes.changed ? <div role="alert" className="source-list-limit"><p>{changes.error} The list is not complete ({count(files.length)} files so far).</p><Button variant="secondary" onClick={changes.resume}>Retry</Button></div>
    : changes.changed && files.length ? <div role="alert" className="source-list-limit"><p>{changes.error}</p></div> : null;
  return <ModalFrame title={target.pr ? `Pull request #${target.pr}` : comparison?.commit.message.split('\n')[0] || 'Compare changes'} subtitle={`${target.repository} · ${originalBase?.slice(0, 9) ?? 'Empty tree'} → ${originalHead.slice(0, 9)}`} badge="DIFF" onClose={onClose}>
    <div className="source-diff-toolbar"><div className="source-segment" aria-label="Diff layout"><button type="button" aria-pressed={mode === 'split'} onClick={() => { setMode('split'); }}>Side by side</button><button type="button" aria-pressed={mode === 'unified'} onClick={() => { setMode('unified'); }}>Unified</button></div><label className="source-find"><Search size={14} /><input aria-label="Find in diff" placeholder="Find in diff…" value={find} onChange={event => { setFind(event.target.value); }} /></label><span>{matches.length} {find ? (matches.length === 1 ? 'matching line' : 'matching lines') : (matches.length === 1 ? 'change group' : 'change groups')}</span><Button size="sm" variant="ghost" aria-label="Previous match or change" disabled={!matches.length} onClick={() => { jump(-1); }}><ArrowUp size={14} /></Button><Button size="sm" variant="ghost" aria-label="Next match or change" disabled={!matches.length} onClick={() => { jump(1); }}><ArrowDown size={14} /></Button><Button size="sm" variant="ghost" onClick={() => { setSwapped(value => !value); }}><ArrowLeftRight size={14} />Swap</Button><Button size="sm" variant="secondary" disabled={!file} onClick={() => { setTime(true); }}><History size={14} />Time-lapse</Button></div>
    <div className="source-diff-layout"><aside ref={fileAside} className="source-changed-files"><h3>Changed files <span>{count(files.length)}{changes.loading && !target.file ? '+' : ''}</span></h3><input aria-label="Filter changed files" placeholder="Filter files…" value={filter} onChange={event => { setFilter(event.target.value); }} />
      {listStatus}
      {changes.compared ? <div className="source-list-limit"><p>GitHub lists at most 3,000 changed files. The rest were found by comparing the two trees, so their line counts and renames are not available (—).{changes.incomplete ? ' GitHub returned a partial listing for a directory, so files may still be missing.' : ''}</p></div> : null}
      {needle && !shownFiles.length && !changes.loading ? <p className="source-list-limit" role="status">No changed file matches the filter{changes.cancelled || changes.error ? ' among the files loaded so far' : ''}.</p> : null}
      <ChangedFileList files={shownFiles} selected={file?.path} onSelect={setSelected} counts={fileCount} scroller={fileAside} />
    </aside><section className="source-diff-pane"><div className="source-file-heading"><strong>{file?.path ?? 'Choose a file'}</strong><label><input type="checkbox" checked={showAll} onChange={event => { setShowAll(event.target.checked); }} />Show all lines</label></div>
      {file?.previous_path ? <p className="source-caption">Renamed from <a href={`/search?${new URLSearchParams({ repository: target.repository, path: file.previous_path, tab: 'history', path_kind: 'file', source_ref: originalBase ?? '' })}`}>{file.previous_path}</a></p> : null}
      {failure ? <div role="alert" className="source-notice">{failure}{!changes.changed ? <Button variant="secondary" onClick={retry}>Retry</Button> : null}</div>
        : loadingFiles ? <p role="status" className="source-notice">Loading file versions…{progressText([beforeState, afterState])}{waitText(beforeState.waitingMs ?? afterState.waitingMs)}<Button variant="ghost" onClick={() => { beforeState.cancel(); afterState.cancel(); }}>Cancel</Button></p>
        : diff.computing ? <p role="status" className="source-notice">Comparing lines…<Button variant="ghost" onClick={diff.cancel}>Cancel</Button></p>
        : cancelledLoad ? <div role="status" className="source-notice">The comparison was cancelled.<Button variant="secondary" onClick={retry}>Retry</Button></div>
        : busy ? <p role="status" className="source-notice">Loading file versions…</p> : null}
      {!busy && !failure && !changes.loading && comparison && !files.length ? <div className="source-empty"><FileCode size={28} /><h3>No changed files</h3><p>This revision has no file changes to compare.</p></div> : null}
      {!failure && unavailable ? <div className="source-empty"><FileCode size={28} /><h3>Text comparison unavailable</h3><p>{before?.reason ?? after?.reason ?? 'This file cannot be compared as text.'}</p></div> : null}
      {!busy && !failure && rows ? <DiffRows rows={rows} items={items} windowed={windowed} scroller={scroller} mode={mode} find={find} left={left} right={right} lineText={lineText} onExpand={() => { setShowAll(true); }} labels={{ before: `BEFORE · ${(swapped ? originalHead : originalBase)?.slice(0, 9) ?? 'Empty tree'}${before?.status === 'missing' ? ' · Path absent' : ''}`, after: `AFTER · ${(swapped ? originalBase : originalHead)?.slice(0, 9) ?? 'Empty tree'}${after?.status === 'missing' ? ' · Path absent' : ''}` }}
        empty={allEqual ? (beforeText === afterText ? 'No differences between these versions.' : 'These versions differ only in the newline at the end of the file.') : null}
        caption={`${before?.text && !before.text.endsWith('\n') ? 'Before: no newline at EOF. ' : ''}${after?.text && !after.text.endsWith('\n') ? 'After: no newline at EOF. ' : ''}${changedRows} changed ${changedRows === 1 ? 'row' : 'rows'} · Revisions stay pinned while you inspect.${diff.result?.approximate ? ' The exact line alignment exceeded its time budget, so an approximate alignment is shown: every line is present, but some changes may be grouped differently than Git would group them.' : ''}`} /> : null}
    </section></div>
    {comparison?.pull_requests_unavailable ? <p className="source-caption">PR context is temporarily unavailable. The source comparison remains available.</p> : null}
    {comparison?.pull_requests.length ? <details className="source-pr-context"><summary>Related pull requests · {comparison.pull_requests.length}</summary>{comparison.pull_requests.map(pr => <article key={pr.number}><a href={`/pr/${target.repository}/${pr.number}`}>#{pr.number} {pr.title}</a><pre>{pr.body || 'No description.'}</pre></article>)}</details> : null}
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

/**
 * How far back the line analysis reaches from the selected revision. 30·100·300 are quick presets (CR-132); none is a
 * maximum — "All loaded revisions" covers what the dialog has read and "All history" (CR-138) reads the rest of the
 * path's history first, to its first revision.
 */
const ANALYSIS_RANGES = [{ value: '30', label: 'Last 30 revisions' }, { value: '100', label: 'Last 100 revisions' }, { value: '300', label: 'Last 300 revisions' }, { value: 'all', label: 'All loaded revisions' }, { value: 'history', label: 'All history' }] as const;
type AnalysisRange = (typeof ANALYSIS_RANGES)[number]['value'];
const FULL_SHA = /^[0-9a-f]{40}$/i;
/** Above this many revisions, "All history" says how many file versions it will read and waits for a second click. */
const CONFIRM_ABOVE = 1000;
/** Size of one revision row once the list is virtualized: height in the column layout, width (180px + 6px gap) in the narrow row layout. */
const REVISION_ROW_HEIGHT = 84; const REVISION_ROW_WIDTH = 186;

/** The dialog's own copy of the path's older history pages (CR-132), read one page or — for "All history" — all of them. */
interface OlderHistory { readonly commits: SourceCommit[]; readonly next: number | null; readonly touched: boolean; readonly loading: boolean; readonly all: boolean; readonly error: string; readonly cancelled: boolean; readonly waitingMs: number | null }

export function TimeLapseModal({ repository, path, revision, initialCommits, nextPage = null, onClose }: { repository: string; path: string; revision: string; initialCommits?: SourceCommit[]; nextPage?: number | null; onClose: () => void }) {
  const history = useSource<SourceHistory>(initialCommits ? null : sourceUrl(repository, 'history', { ref: revision, path }));
  // CR-132: older revisions load inside the dialog, pinned to the commit SHA the first page resolved.
  const pinnedRevision = history.data?.revision ?? (FULL_SHA.test(revision) ? revision : null);
  const [older, setOlder] = useState<OlderHistory>({ commits: [], next: null, touched: false, loading: false, all: false, error: '', cancelled: false, waitingMs: null });
  const olderRef = useRef(older); olderRef.current = older;
  const olderController = useRef<AbortController | null>(null);
  useEffect(() => () => { olderController.current?.abort(); }, []);
  const firstNext = initialCommits ? (nextPage ?? null) : (history.data?.next_page ?? null);
  const next = older.touched ? older.next : firstNext;
  const firstPage = useMemo(() => initialCommits ?? history.data?.commits ?? [], [initialCommits, history.data]);
  const newestFirst = useMemo(() => { const seen = new Set<string>(); return [...firstPage, ...older.commits].filter(commit => (seen.has(commit.sha) ? false : (seen.add(commit.sha), true))); }, [firstPage, older.commits]);
  const commits = useMemo(() => [...newestFirst].reverse(), [newestFirst]);
  /**
   * Reads older history pages: one page, or (`all`) every page to the path's first revision. Resolves the older commits
   * when the history is complete and `null` when it stopped (cancel, failure, or a single page with more to come).
   */
  const readOlder = useCallback(async (all: boolean): Promise<SourceCommit[] | null> => {
    const start = olderRef.current;
    let cursor = start.touched ? start.next : firstNext;
    if (cursor === null || pinnedRevision === null) return cursor === null ? start.commits : null;
    olderController.current?.abort(); const abort = new AbortController(); olderController.current = abort;
    let collected = start.commits;
    const publish = (change: Partial<OlderHistory>): void => { if (!abort.signal.aborted) setOlder(value => ({ ...value, ...change })); };
    publish({ loading: true, all, error: '', cancelled: false, waitingMs: null });
    try {
      do {
        const page: SourceHistory = await fetchSourceRetrying<SourceHistory>(sourceUrl(repository, 'history', { ref: pinnedRevision, path, page: cursor }), abort.signal, { onWait: (ms) => { publish({ waitingMs: ms }); } });
        if (page.revision !== pinnedRevision) throw new Error('The history moved while it was loading. Close and reopen Time-lapse.');
        collected = [...collected, ...page.commits]; cursor = page.next_page ?? null;
        publish({ commits: collected, next: cursor, touched: true, loading: all && cursor !== null, waitingMs: null });
      } while (all && cursor !== null);
      publish({ loading: false });
      return cursor === null ? collected : null;
    } catch (error) {
      if (!abort.signal.aborted) publish({ loading: false, waitingMs: null, error: error instanceof Error ? error.message : 'Unable to load older revisions.' });
      return null;
    }
  }, [firstNext, pinnedRevision, repository, path]);
  const stopOlder = useCallback(() => { olderController.current?.abort(); setOlder(value => (value.loading ? { ...value, loading: false, cancelled: true, waitingMs: null } : value)); }, []);
  const [selectedSha, setSelectedSha] = useState<string | null>(null);
  const found = selectedSha === null ? -1 : commits.findIndex(commit => commit.sha === selectedSha);
  const currentIndex = found >= 0 ? found : commits.length - 1; const selected = commits[currentIndex];
  const select = (index: number) => { const commit = commits[index]; if (commit) setSelectedSha(commit.sha); };
  const file = useFileText(repository, selected ? path : null, selected?.sha ?? null, 180);
  const [contextOpen, setContextOpen] = useState(false); const context = useSource<SourceComparison>(contextOpen && selected ? sourceUrl(repository, 'diff', { commit: selected.sha, related: 'all' }) : null, 180);
  const trace = useTrace(); const [range, setRange] = useState<AnalysisRange>('30');
  /** "All history" found this many revisions and waits for the reader to confirm reading them all. */
  const [confirm, setConfirm] = useState<readonly string[] | null>(null);
  const [line, setLine] = useState<number | null>(null); const [needle, setNeedle] = useState('');
  const codePane = useRef<HTMLDivElement>(null);
  /** The line the keyboard moved to — only keyboard moves take focus; other jumps (line history, revision change) only scroll. */
  const keyboardLine = useRef<number | null>(null);
  const content = useMemo(() => (file.file?.status === 'text' ? rawLines(file.file.text ?? '').map(displayLine) : []), [file.file]);
  const lineHeight = useCallback(() => LINE_HEIGHT, []);
  const offsets = useOffsets(content.length, lineHeight);
  const windowed = useVirtualWindow(codePane, offsets);
  useEffect(() => { if (line !== null && !file.loading) scrollToRow(codePane.current, offsets, line); }, [line, file.loading, selected?.sha, offsets]);
  // A keyboard move lands one line away, inside the rendered slice; focus it once it is in the DOM.
  useEffect(() => { if (line !== null && keyboardLine.current === line) { const button = codePane.current?.querySelector<HTMLElement>(`[data-source-line="${line}"] button`); if (button) { button.focus({ preventScroll: true }); keyboardLine.current = null; } } }, [line, windowed.start, windowed.end]);
  async function analyze() {
    if (currentIndex < 0) return;
    setConfirm(null);
    if (range !== 'history') {
      const span = range === 'all' ? currentIndex + 1 : Number(range);
      trace.run({ repository, path, revisions: commits.slice(Math.max(0, currentIndex - span + 1), currentIndex + 1).map(commit => commit.sha) });
      return;
    }
    const target = selected?.sha;
    const olderCommits = await readOlder(true);
    if (olderCommits === null || target === undefined) return;
    // The whole history, oldest first, up to the selected revision.
    const seen = new Set<string>();
    const all = [...firstPage, ...olderCommits].filter(commit => (seen.has(commit.sha) ? false : (seen.add(commit.sha), true))).reverse();
    const upTo = all.findIndex(commit => commit.sha === target);
    if (upTo < 0) return;
    const revisions = all.slice(0, upTo + 1).map(commit => commit.sha);
    if (revisions.length > CONFIRM_ABOVE) setConfirm(revisions);
    else trace.run({ repository, path, revisions });
  }
  const lineage = trace.result?.lineage ?? null;
  const revisionIndex = lineage && selected ? lineage.revisions.indexOf(selected.sha) : -1;
  const nodes = useMemo(() => (lineage && revisionIndex >= 0 ? nodesAt(lineage, revisionIndex) : undefined), [lineage, revisionIndex]);
  const heat = (index: number) => (nodes && lineage ? Math.min(4, (lineage.nodeDepth[nodes[index] ?? -1] ?? 1) - 1) : 0);
  const events = line === null || revisionIndex < 0 || !lineage ? [] : lineEvents(lineage, revisionIndex, line, nodes);
  const skipped = trace.result?.skipped ?? [];
  const summary = lineage ? `${lineage.revisions.length} revisions analyzed.${skipped.length ? ` ${skipped.length} ${skipped.length === 1 ? 'revision was' : 'revisions were'} skipped because ${skipped.length === 1 ? 'it is' : 'they are'} not text (${skipped.slice(0, 3).map(item => `${item.sha.slice(0, 9)}: ${item.reason}`).join('; ')}${skipped.length > 3 ? '; …' : ''}).` : ''}${lineage.approximatePairs ? ` ${lineage.approximatePairs} adjacent ${lineage.approximatePairs === 1 ? 'pair was' : 'pairs were'} aligned approximately.` : ''} ` : '';
  const rendered: ReactNode[] = [];
  for (let i = windowed.start; i < windowed.end; i++) {
    const text = content[i]!;
    rendered.push(<tr key={i} data-source-line={i} {...(windowed.virtual ? { 'aria-rowindex': i + 2 } : {})} className={`${line === i ? 'source-selected-line' : ''} source-heat-${heat(i)}`}><td className="source-line-number"><button type="button" aria-label={`Inspect line ${i + 1}`} aria-pressed={line === i} tabIndex={line === i || (line === null && i === windowed.start) ? 0 : -1} onKeyDown={event => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); const next = Math.max(0, Math.min(content.length - 1, i + (event.key === 'ArrowDown' ? 1 : -1))); keyboardLine.current = next; setLine(next); } }} onClick={() => { setLine(i); }}>{i + 1}</button></td><td onClick={() => { setLine(i); }}><code>{highlight(text, needle)}</code></td></tr>);
  }
  // CR-138: a long revision list is virtualized too — a column on wide screens, a row on narrow ones (newest first).
  const narrow = useNarrow();
  const revisionPane = useRef<HTMLElement>(null);
  const revisionStart = useRef<HTMLDivElement>(null);
  const revisionSize = useCallback(() => (narrow ? REVISION_ROW_WIDTH : REVISION_ROW_HEIGHT), [narrow]);
  const revisionOffsets = useOffsets(commits.length, revisionSize);
  const revisionWindow = useVirtualWindow(revisionPane, revisionOffsets, narrow ? 'x' : 'y', revisionStart);
  const revisionButtons: ReactNode[] = [];
  for (let position = revisionWindow.start; position < revisionWindow.end; position++) {
    const i = commits.length - 1 - position; const commit = commits[i]!;
    revisionButtons.push(<button type="button" key={commit.sha} aria-pressed={i === currentIndex} onClick={() => { setLine(null); select(i); }}><code>{commit.sha.slice(0, 9)}</code><strong>{commit.message.split('\n')[0]}</strong><small>{commit.author} · {commit.date ? formatDate(commit.date, { label: true }) : 'Unknown date'}</small></button>);
  }
  const spacer = (size: number, ref?: RefObject<HTMLDivElement | null>): ReactNode => (size > 0 || ref ? <div ref={ref} aria-hidden="true" className="source-virtual-spacer" style={narrow ? { width: size, flex: 'none' } : { height: size }} /> : null);
  const progress = trace.progress;
  const traceStatus = trace.running && progress
    ? <p role="status" className="source-notice">{progress.loaded < progress.total ? `Loading revision ${count(Math.min(progress.total, progress.loaded + 1))} / ${count(progress.total)} · ` : ''}Analyzing revision {count(progress.done)} / {count(progress.total)}…{progress.skipped ? ` ${count(progress.skipped)} skipped (not text).` : ''}{waitText(progress.waitingMs)}</p>
    : null;
  const stoppedAt = trace.stopped ? `revision ${count(trace.stopped.partial.next + 1)} of ${count(trace.stopped.input.revisions.length)}` : '';
  const historyStatus = older.loading && older.all ? <p role="status" className="source-notice">Loading history… {count(commits.length)} revisions so far.{waitText(older.waitingMs)}<Button variant="ghost" onClick={stopOlder}>Cancel</Button></p>
    : older.cancelled ? <p role="status" className="source-notice">Loading the history was cancelled after {count(commits.length)} revisions.<Button variant="ghost" onClick={() => { void analyze(); }}>Continue</Button></p> : null;
  return <ModalFrame title={path} subtitle={`${repository} · Revision-aware file history`} badge="TIME-LAPSE" onClose={onClose}>
    <div className="source-time-toolbar"><Button variant="ghost" aria-label="Previous file revision" disabled={currentIndex <= 0} onClick={() => { setLine(null); select(currentIndex - 1); }}><ChevronLeft size={17} /></Button><Slider.Root aria-label="File revision" min={0} max={Math.max(1, commits.length - 1)} step={1} value={[Math.max(0, currentIndex)]} disabled={commits.length < 2} onValueChange={values => { setLine(null); select(values[0] ?? 0); }} className="source-slider"><Slider.Track><Slider.Range /></Slider.Track><Slider.Thumb aria-label="File revision" aria-valuetext={selected ? `Revision ${currentIndex + 1} of ${commits.length}: ${selected.sha.slice(0, 9)}` : 'No revisions'} /></Slider.Root><Button variant="ghost" aria-label="Next file revision" disabled={currentIndex >= commits.length - 1} onClick={() => { setLine(null); select(currentIndex + 1); }}><ChevronRight size={17} /></Button><span>{Math.max(0, currentIndex + 1)} / {commits.length}</span>
      <label className="source-analysis-range"><span className="ui-sr-only">Analysis range</span><select aria-label="Analysis range" value={range} disabled={trace.running || older.loading} onChange={event => { setRange(event.target.value as AnalysisRange); setConfirm(null); }}>{ANALYSIS_RANGES.map(option => <option key={option.value} value={option.value}>{option.value === 'all' ? `All loaded revisions (${Math.max(0, currentIndex + 1)})` : option.label}</option>)}</select></label>
      {trace.running ? <Button variant="secondary" onClick={trace.cancel}>Cancel analysis</Button> : <Button variant="secondary" disabled={!selected || file.loading || file.file?.status !== 'text' || older.loading} onClick={() => { void analyze(); }}>{range === 'history' ? 'Analyze all history' : 'Analyze line history'}</Button>}<Button variant="ghost" aria-pressed={contextOpen} onClick={() => { setContextOpen(value => !value); }}>Related PRs</Button></div>
    {next !== null && !(older.loading && older.all) ? <div className="source-caption">{older.loading ? <span role="status">Loading older revisions…</span> : <Button size="sm" variant="ghost" disabled={pinnedRevision === null} onClick={() => { void readOlder(false); }}>Load older revisions</Button>} {commits.length} revisions loaded. Older revisions of this path are available{range === 'history' ? ' — All history reads them all' : ''}.</div> : older.touched && next === null ? <p className="source-caption">All {commits.length} revisions of this path are loaded.</p> : null}
    {historyStatus}
    {confirm ? <div role="status" className="source-notice">All history of this path has {count(confirm.length)} revisions up to the selected one. Analyzing them reads {count(confirm.length)} file versions from GitHub and may take a while; you can cancel at any time.<Button variant="secondary" onClick={() => { const revisions = confirm; setConfirm(null); trace.run({ repository, path, revisions }); }}>Analyze {count(confirm.length)} revisions</Button><Button variant="ghost" onClick={() => { setConfirm(null); }}>Not now</Button></div> : null}
    {traceStatus}
    {trace.cancelled ? <p role="status" className="source-notice">The line analysis was cancelled{stoppedAt ? ` at ${stoppedAt}` : ''}.{trace.result ? ' The previous analysis is still shown.' : ''}{trace.stopped ? <Button variant="ghost" onClick={trace.resume}>Continue analysis</Button> : null}</p> : null}
    {history.error || older.error ? <div role="alert" className="source-notice">{history.error || older.error}<Button variant="ghost" onClick={older.error ? () => { void (older.all ? analyze() : readOlder(false)); } : history.reload}>{older.error ? 'Retry older revisions' : 'Retry history'}</Button></div> : null}
    {trace.error ? <div role="alert" className="source-notice">{trace.stopped ? `Line analysis stopped at ${stoppedAt}: ` : ''}{trace.error}{trace.stopped ? <Button variant="ghost" onClick={trace.resume}>Continue analysis</Button> : null}</div> : null}
    <div className="source-time-layout"><aside ref={revisionPane} className={`source-revisions${revisionWindow.virtual ? ' source-revisions--virtual' : ''}`}><h3>Revisions</h3>{spacer(revisionWindow.padTop, revisionWindow.virtual ? revisionStart : undefined)}{revisionButtons}{spacer(revisionWindow.padBottom)}</aside>
      <section className="source-time-code"><header><code>{selected?.sha.slice(0, 12) ?? (history.loading ? 'Loading…' : 'No revisions')}</code><label><Search size={13} /><input aria-label="Find in file" placeholder="Find in file…" value={needle} onChange={event => { setNeedle(event.target.value); }} /></label></header>
        {file.loading || history.loading ? <p role="status" className="source-notice">Loading revision…{progressText([file])}{waitText(file.waitingMs)}{file.loading ? <Button variant="ghost" onClick={file.cancel}>Cancel</Button> : null}</p> : file.error ? <div role="alert" className="source-notice">{file.error}<Button variant="ghost" onClick={file.reload}>Retry</Button></div> : file.cancelled ? <div role="status" className="source-notice">Loading was cancelled.<Button variant="ghost" onClick={file.reload}>Retry</Button></div> : file.file?.status !== 'text' ? <p className="source-notice">{file.file?.reason ?? 'No file content available.'}</p> : <div ref={codePane} className="source-code-scroll" role="region" tabIndex={0} aria-label="File content">{content.length === 0 ? <p className="source-notice">This file is empty at this revision.</p> : null}<table className={`source-file-code${windowed.virtual ? ' source-virtual' : ''}`} {...(windowed.virtual ? { 'aria-rowcount': content.length + 1 } : {})}><thead className="ui-sr-only"><tr><th scope="col">Line</th><th scope="col">Source</th></tr></thead><tbody><Pad height={windowed.padTop} columns={2} />{rendered}<Pad height={windowed.padBottom} columns={2} /></tbody></table></div>}
      </section><aside className="source-line-history"><h3>Line history {line === null ? '' : `· ${line + 1}`}</h3>{!lineage ? <p>Analyze line history, then select a line to follow its changes.</p> : revisionIndex < 0 ? <p>This revision is outside the analyzed range. Analyze again to include it.</p> : line === null ? <p>Select a line number in the file.</p> : <><p role="status">{events.length} observed versions of this line</p>{[...events].reverse().map((event, i) => <button type="button" key={`${event.sha}-${i}`} onClick={() => { const index = commits.findIndex(commit => commit.sha === event.sha); if (index >= 0) { select(index); setLine(event.line - 1); } }}><code>{event.sha.slice(0, 9)}</code><small>{event.kind === 'baseline' ? 'Present at range start' : event.kind === 'edited' ? 'Aligned replacement' : 'Added'}</small><pre>{displayLine(event.text)}</pre></button>)}</>}
        <div className="source-heat-legend" aria-label="Observed edit frequency"><span>Low</span>{[0, 1, 2, 3, 4].map(value => <i key={value} className={`source-heat-${value}`} aria-hidden="true" />)}<span>High</span></div><p className="source-line-disclaimer">{summary}Line correspondence is inferred from adjacent diffs, not authoritative blame. Earlier history and renamed paths may be outside this range.</p>
      </aside></div>
    {contextOpen ? <div className="source-pr-context">{context.loading ? <p>Loading related PRs…</p> : context.error ? <p role="alert">{context.error}</p> : context.data?.pull_requests_unavailable ? <p>PR associations are temporarily unavailable.</p> : context.data?.pull_requests.length ? context.data.pull_requests.map(pr => <article key={pr.number}><a href={`/pr/${repository}/${pr.number}`}>#{pr.number} {pr.title}</a><pre>{pr.body || 'No description.'}</pre></article>) : <p>No associated PR was returned by GitHub.</p>}</div> : null}
  </ModalFrame>;
}
