'use client';
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import * as Slider from '@radix-ui/react-slider';
import { ArrowDown, ArrowLeftRight, ArrowUp, ChevronLeft, ChevronRight, FileCode, GitCompareArrows, History, Maximize2, Minimize2, Search, X } from 'lucide-react';
import type { SourceChange, SourceCommit, SourceComparison, SourceFile, SourceHistory } from '@prs/contracts';
import { Button, Dialog } from '../ui';
import { ThemeToggle } from '../ui/ThemeToggle';
import { compareLines, lines, traceLines, wordChanges, type DiffRow, type TracedLine } from '../../lib/source-analysis';
import { fetchSource, sourceUrl, useSource } from './api';

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
function WordLine({ row, side, needle }: { row: DiffRow; side: 'before' | 'after'; needle: string }) {
  const current = row[side]; if (!current) return <span aria-hidden="true"> </span>;
  const parts = row.kind === 'change' && row.before && row.after ? wordChanges(row.before.text, row.after.text, side) : [{ text: current.text, changed: false }];
  return <>{parts.map((part, i) => <span key={i} className={part.changed ? 'source-word-change' : undefined}>{highlight(part.text, needle)}</span>)}</>;
}
function highlight(text: string, needle: string): ReactNode {
  if (!needle) return text || ' ';
  const result: ReactNode[] = []; let offset = 0; let index = text.toLowerCase().indexOf(needle.toLowerCase());
  while (index !== -1) { result.push(text.slice(offset, index), <mark key={index}>{text.slice(index, index + needle.length)}</mark>); offset = index + needle.length; index = text.toLowerCase().indexOf(needle.toLowerCase(), offset); }
  result.push(text.slice(offset)); return result;
}
const emptyFile = (revision: string | null, path: string): SourceFile => ({ repository: '', revision: revision ?? '', path, text: '', status: 'text', size: 0, sha: null, reason: null });

export function DiffModal({ target, onClose }: { target: DiffTarget; onClose: () => void }) {
  const [page, setPage] = useState(1); const metadata = useSource<SourceComparison>(target.file ? null : sourceUrl(target.repository, 'diff', { pr: target.pr, commit: target.commit, page }));
  const [allFiles, setAllFiles] = useState<SourceChange[]>([]); const [selected, setSelected] = useState(target.file?.path ?? ''); const [filter, setFilter] = useState(''); const [contextError, setContextError] = useState('');
  const pinned = useRef<{ base: string | null; head: string } | null>(null);
  useEffect(() => {
    if (!metadata.data) return;
    if (pinned.current && (metadata.data.head !== pinned.current.head || metadata.data.base !== pinned.current.base)) { setContextError('This PR changed while loading files. Close and reopen the comparison.'); return; }
    pinned.current = { base: metadata.data.base, head: metadata.data.head };
    setAllFiles(previous => page === 1 ? metadata.data!.files : [...previous, ...metadata.data!.files].filter((file, i, list) => list.findIndex(other => other.path === file.path) === i));
    setSelected(previous => previous || metadata.data!.files[0]?.path || '');
  }, [metadata.data, page]);
  const files: SourceChange[] = target.file ? [{ path: target.file.path, previous_path: null, status: 'modified', additions: 0, deletions: 0 }] : allFiles;
  const file = files.find(item => item.path === selected) ?? files[0];
  const originalBase = target.file?.base ?? pinned.current?.base ?? null; const originalHead = target.file?.head ?? pinned.current?.head ?? '';
  const [swapped, setSwapped] = useState(false);
  const beforePath = file?.previous_path ?? file?.path ?? ''; const afterPath = file?.path ?? '';
  const beforeResult = useSource<SourceFile>(file && originalBase && file.status !== 'added' ? sourceUrl(target.repository, 'file', { path: beforePath, revision: originalBase }) : null);
  const afterResult = useSource<SourceFile>(file && originalHead && file.status !== 'removed' ? sourceUrl(target.repository, 'file', { path: afterPath, revision: originalHead }) : null);
  const originalBefore = !originalBase || file?.status === 'added' ? emptyFile(originalBase, beforePath) : beforeResult.data;
  const originalAfter = file?.status === 'removed' ? emptyFile(originalHead, afterPath) : afterResult.data;
  const before = swapped ? originalAfter : originalBefore; const after = swapped ? originalBefore : originalAfter;
  const [mode, setMode] = useState<'split' | 'unified'>('split'); const [find, setFind] = useState(''); const [showAll, setShowAll] = useState(false); const [time, setTime] = useState(false);
  const rows = useMemo(() => before && after && (before.status === 'text' || target.file && before.status === 'missing') && (after.status === 'text' || target.file && after.status === 'missing') ? compareLines(before.text ?? '', after.text ?? '') : null, [before, after, target.file]);
  const counts = useMemo(() => ({ additions: rows?.filter(row => row.kind === 'change' && row.after).length ?? 0, deletions: rows?.filter(row => row.kind === 'change' && row.before).length ?? 0 }), [rows]);
  const scroller = useRef<HTMLDivElement>(null); const [position, setPosition] = useState(0);
  useEffect(() => { setPosition(0); setShowAll(false); }, [selected, find, swapped]);
  const matches = useMemo(() => (rows ?? []).flatMap((row, index) => find ? (row.before?.text.toLowerCase().includes(find.toLowerCase()) || row.after?.text.toLowerCase().includes(find.toLowerCase()) ? [index] : []) : row.kind === 'change' && rows?.[index - 1]?.kind !== 'change' ? [index] : []), [rows, find]);
  function jump(direction: number) { if (!matches.length) return; const next = (position + direction + matches.length) % matches.length; setPosition(next); scroller.current?.querySelector<HTMLElement>(`[data-diff-index="${matches[next]}"]`)?.scrollIntoView({ block: 'center' }); }
  const visible = useMemo(() => { const indices = new Set<number>(); (rows ?? []).forEach((row, index) => { if (row.kind === 'change' || (find && (row.before?.text.includes(find) || row.after?.text.includes(find)))) for (let n = Math.max(0, index - 3); n <= Math.min((rows?.length ?? 1) - 1, index + 3); n++) indices.add(n); }); return indices; }, [rows, find]);
  const failure = contextError || metadata.error || beforeResult.error || afterResult.error;
  const busy = beforeResult.loading || afterResult.loading || (!files.length && metadata.loading);
  return <ModalFrame title={target.pr ? `Pull request #${target.pr}` : metadata.data?.commit.message.split('\n')[0] || 'Compare changes'} subtitle={`${target.repository} · ${originalBase?.slice(0, 9) ?? 'Empty tree'} → ${originalHead.slice(0, 9)}`} badge="DIFF" onClose={onClose}>
    <div className="source-diff-toolbar"><div className="source-segment" aria-label="Diff layout"><button type="button" aria-pressed={mode === 'split'} onClick={() => { setMode('split'); }}>Side by side</button><button type="button" aria-pressed={mode === 'unified'} onClick={() => { setMode('unified'); }}>Unified</button></div><label className="source-find"><Search size={14} /><input aria-label="Find in diff" placeholder="Find in diff…" value={find} onChange={event => { setFind(event.target.value); }} /></label><span>{matches.length} {find ? (matches.length === 1 ? 'matching line' : 'matching lines') : (matches.length === 1 ? 'change group' : 'change groups')}</span><Button size="sm" variant="ghost" aria-label="Previous match or change" disabled={!matches.length} onClick={() => { jump(-1); }}><ArrowUp size={14} /></Button><Button size="sm" variant="ghost" aria-label="Next match or change" disabled={!matches.length} onClick={() => { jump(1); }}><ArrowDown size={14} /></Button><Button size="sm" variant="ghost" onClick={() => { setSwapped(value => !value); }}><ArrowLeftRight size={14} />Swap</Button><Button size="sm" variant="secondary" disabled={!file} onClick={() => { setTime(true); }}><History size={14} />Time-lapse</Button></div>
    <div className="source-diff-layout"><aside className="source-changed-files"><h3>Changed files <span>{files.length}</span></h3><input aria-label="Filter changed files" placeholder="Filter files…" value={filter} onChange={event => { setFilter(event.target.value); }} />{files.filter(item => `${item.path} ${item.previous_path ?? ''}`.toLowerCase().includes(filter.toLowerCase())).map(item => <button type="button" key={item.path} aria-pressed={file?.path === item.path} onClick={() => { setSelected(item.path); }}><FileCode size={14} /><span>{item.path}<small>{item.status}{item.previous_path ? ` ← ${item.previous_path}` : ''}</small></span><small className="source-file-count">{target.file && !rows ? '—' : `+${target.file ? counts.additions : item.additions} −${target.file ? counts.deletions : item.deletions}`}</small></button>)}
      {metadata.data?.next_page && !contextError ? <Button variant="ghost" disabled={metadata.loading} onClick={() => { setPage(metadata.data!.next_page!); }}>More files</Button> : null}{metadata.data?.truncated ? <p>GitHub file limit reached. This list is partial.</p> : null}
    </aside><section className="source-diff-pane"><div className="source-file-heading"><strong>{file?.path ?? 'Choose a file'}</strong><label><input type="checkbox" checked={showAll} onChange={event => { setShowAll(event.target.checked); }} />Show all lines</label></div>
      {file?.previous_path ? <p className="source-caption">Renamed from <a href={`/search?${new URLSearchParams({ repository: target.repository, path: file.previous_path, tab: 'history', path_kind: 'file', source_ref: originalBase ?? '' })}`}>{file.previous_path}</a></p> : null}
      {failure ? <div role="alert" className="source-notice">{failure}{!contextError ? <Button variant="secondary" onClick={() => { metadata.reload(); beforeResult.reload(); afterResult.reload(); }}>Retry</Button> : null}</div> : busy ? <p role="status" className="source-notice">Loading file versions…</p> : null}
      {!busy && !failure && metadata.data && !files.length ? <div className="source-empty"><FileCode size={28} /><h3>No changed files</h3><p>This revision has no file changes to compare.</p></div> : null}
      {!busy && before && after && !rows ? <div className="source-empty"><FileCode size={28} /><h3>Text comparison unavailable</h3><p>{before.reason ?? after.reason ?? 'This comparison exceeds the interactive diff budget.'}</p></div> : null}
      {!busy && rows ? <><div className="source-revision-headings"><span>BEFORE · {(swapped ? originalHead : originalBase)?.slice(0, 9) ?? 'Empty tree'}{before?.status === 'missing' ? ' · Path absent' : ''}</span><span>AFTER · {(swapped ? originalBase : originalHead)?.slice(0, 9) ?? 'Empty tree'}{after?.status === 'missing' ? ' · Path absent' : ''}</span></div><div ref={scroller} className="source-code-scroll" tabIndex={0} role="region" aria-label="File diff"><table className={`source-diff-table source-diff-table--${mode}`}>{mode === 'split' ? <colgroup><col style={{ width: 44 }} /><col style={{ width: 'calc(50% - 44px)' }} /><col style={{ width: 44 }} /><col style={{ width: 'calc(50% - 44px)' }} /></colgroup> : null}<thead className="ui-sr-only"><tr><th scope="col">Before line</th><th scope="col">{mode === 'split' ? 'Before source' : 'After line'}</th><th scope="col">{mode === 'split' ? 'After line' : 'Source'}</th><th scope="col">After source</th></tr></thead><tbody>{rows.map((row, index) => {
        if (!showAll && !find && visible.size && !visible.has(index)) return index > 0 && !visible.has(index - 1) ? null : <tr key={`gap-${index}`}><td colSpan={4}><button type="button" className="source-context-expand" onClick={() => { setShowAll(true); }}>Show unchanged lines</button></td></tr>;
        if (mode === 'unified') return <tr key={index} data-diff-index={index} className={row.kind === 'change' ? 'source-unified-change' : undefined}><td className="source-line-number">{row.before?.number}</td><td className="source-line-number">{row.after?.number}</td><td colSpan={2}>{row.kind === 'equal' ? <code>{highlight(row.after?.text ?? '', find)}</code> : <>{row.before ? <div className="source-deleted"><span aria-hidden="true">− </span><code><WordLine row={row} side="before" needle={find} /></code></div> : null}{row.after ? <div className="source-added"><span aria-hidden="true">+ </span><code><WordLine row={row} side="after" needle={find} /></code></div> : null}</>}</td></tr>;
        return <tr key={index} data-diff-index={index}><td className="source-line-number">{row.before?.number}</td><td className={row.kind === 'change' && row.before ? 'source-deleted' : ''}><code><WordLine row={row} side="before" needle={find} /></code></td><td className="source-line-number">{row.after?.number}</td><td className={row.kind === 'change' && row.after ? 'source-added' : ''}><code><WordLine row={row} side="after" needle={find} /></code></td></tr>;
      })}</tbody></table>{rows.every(row => row.kind === 'equal') ? <p className="source-notice">No differences between these versions.</p> : null}</div><p className="source-caption">{before?.text && !before.text.endsWith('\n') ? 'Before: no newline at EOF. ' : ''}{after?.text && !after.text.endsWith('\n') ? 'After: no newline at EOF.' : ''}{rows.filter(row => row.kind === 'change').length} changed {rows.filter(row => row.kind === 'change').length === 1 ? 'row' : 'rows'} · Revisions stay pinned while you inspect.</p></> : null}
    </section></div>
    {metadata.data?.pull_requests_unavailable ? <p className="source-caption">PR context is temporarily unavailable. The source comparison remains available.</p> : null}
    {metadata.data?.pull_requests.length ? <details className="source-pr-context"><summary>Related pull requests · {metadata.data.pull_requests.length}</summary>{metadata.data.pull_requests.map(pr => <article key={pr.number}><a href={`/pr/${target.repository}/${pr.number}`}>#{pr.number} {pr.title}</a><pre>{pr.body || 'No description.'}</pre></article>)}</details> : null}
    {time && file ? <TimeLapseModal repository={target.repository} path={file.path} revision={originalHead} onClose={() => { setTime(false); }} /> : null}
  </ModalFrame>;
}

export function TimeLapseModal({ repository, path, revision, initialCommits, moreAvailable = false, onClose }: { repository: string; path: string; revision: string; initialCommits?: SourceCommit[]; moreAvailable?: boolean; onClose: () => void }) {
  const history = useSource<SourceHistory>(initialCommits ? null : sourceUrl(repository, 'history', { ref: revision, path }));
  const commits = useMemo(() => [...(initialCommits ?? history.data?.commits ?? [])].reverse(), [initialCommits, history.data]);
  const [index, setIndex] = useState<number | null>(null); const currentIndex = Math.min(index ?? commits.length - 1, commits.length - 1); const selected = commits[currentIndex];
  const file = useSource<SourceFile>(selected ? sourceUrl(repository, 'file', { path, revision: selected.sha }) : null, 180);
  const [contextOpen, setContextOpen] = useState(false); const context = useSource<SourceComparison>(contextOpen && selected ? sourceUrl(repository, 'diff', { commit: selected.sha }) : null, 180);
  const [analysis, setAnalysis] = useState<Map<string, TracedLine[]> | null>(null); const [analysisCount, setAnalysisCount] = useState(0); const [analyzing, setAnalyzing] = useState(false); const [analysisError, setAnalysisError] = useState(''); const [line, setLine] = useState<number | null>(null); const [needle, setNeedle] = useState('');
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => { controller.current?.abort(); }, []);
  const codePane = useRef<HTMLDivElement>(null);
  useEffect(() => { if (line !== null && !file.loading) codePane.current?.querySelector<HTMLElement>(`[data-source-line="${line}"]`)?.scrollIntoView({ block: 'nearest' }); }, [line, file.loading, selected?.sha]);
  async function analyze() {
    controller.current?.abort(); const abort = new AbortController(); controller.current = abort;
    setAnalyzing(true); setAnalysisError('');
    try {
      const window = commits.slice(Math.max(0, currentIndex - 29), currentIndex + 1); const versions: { sha: string; text: string }[] = [];
      for (let i = 0; i < window.length; i += 3) {
        const batch = await Promise.all(window.slice(i, i + 3).map(async commit => {
          const content = await fetchSource<SourceFile>(sourceUrl(repository, 'file', { revision: commit.sha, path }), abort.signal);
          if (!['text', 'missing'].includes(content.status)) throw new Error(content.reason ?? 'A revision cannot be analyzed as text.');
          return { sha: commit.sha, text: content.text ?? '' };
        })); versions.push(...batch);
      }
      if (abort.signal.aborted) return;
      const result = traceLines(versions); if (!result) throw new Error('These versions exceed the interactive line analysis budget.');
      setAnalysis(result); setAnalysisCount(versions.length);
    } catch (error) { if (!abort.signal.aborted) setAnalysisError(error instanceof Error ? error.message : 'Line analysis failed.'); }
    finally { if (!abort.signal.aborted) setAnalyzing(false); }
  }
  const content = file.data?.status === 'text' ? lines(file.data.text ?? '') : [];
  const traced = selected ? analysis?.get(selected.sha) : undefined;
  const events = line === null ? [] : traced?.[line]?.events ?? [];
  return <ModalFrame title={path} subtitle={`${repository} · Revision-aware file history`} badge="TIME-LAPSE" onClose={onClose}>
    <div className="source-time-toolbar"><Button variant="ghost" aria-label="Previous file revision" disabled={currentIndex <= 0} onClick={() => { setLine(null); setIndex(currentIndex - 1); }}><ChevronLeft size={17} /></Button><Slider.Root aria-label="File revision" min={0} max={Math.max(1, commits.length - 1)} step={1} value={[Math.max(0, currentIndex)]} disabled={commits.length < 2} onValueChange={values => { setLine(null); setIndex(values[0] ?? 0); }} className="source-slider"><Slider.Track><Slider.Range /></Slider.Track><Slider.Thumb aria-label="File revision" aria-valuetext={selected ? `Revision ${currentIndex + 1} of ${commits.length}: ${selected.sha.slice(0, 9)}` : 'No revisions'} /></Slider.Root><Button variant="ghost" aria-label="Next file revision" disabled={currentIndex >= commits.length - 1} onClick={() => { setLine(null); setIndex(currentIndex + 1); }}><ChevronRight size={17} /></Button><span>{Math.max(0, currentIndex + 1)} / {commits.length}</span><Button variant="secondary" disabled={analyzing || !selected || file.loading || file.data?.status !== 'text'} onClick={() => { void analyze(); }}>{analyzing ? 'Analyzing…' : 'Analyze line history'}</Button><Button variant="ghost" aria-pressed={contextOpen} onClick={() => { setContextOpen(value => !value); }}>Related PRs</Button></div>
    {moreAvailable || history.data?.next_page ? <p className="source-caption">Showing the loaded path revisions. Load older commits in History before opening Time-lapse to extend the window.</p> : null}
    {history.error || analysisError ? <div role="alert" className="source-notice">{history.error || analysisError}<Button variant="ghost" onClick={history.reload}>Retry history</Button></div> : null}
    <div className="source-time-layout"><aside className="source-revisions"><h3>Revisions</h3>{commits.map((commit, i) => ({ commit, i })).reverse().map(({ commit, i }) => <button type="button" key={commit.sha} aria-pressed={i === currentIndex} onClick={() => { setLine(null); setIndex(i); }}><code>{commit.sha.slice(0, 9)}</code><strong>{commit.message.split('\n')[0]}</strong><small>{commit.author} · {commit.date?.slice(0, 10) ?? 'Unknown date'}</small></button>)}</aside>
      <section className="source-time-code"><header><code>{selected?.sha.slice(0, 12) ?? (history.loading ? 'Loading…' : 'No revisions')}</code><label><Search size={13} /><input aria-label="Find in file" placeholder="Find in file…" value={needle} onChange={event => { setNeedle(event.target.value); }} /></label></header>
        {file.loading || history.loading ? <p role="status" className="source-notice">Loading revision…</p> : file.error ? <div role="alert" className="source-notice">{file.error}<Button variant="ghost" onClick={file.reload}>Retry</Button></div> : file.data?.status !== 'text' ? <p className="source-notice">{file.data?.reason ?? 'No file content available.'}</p> : <div ref={codePane} className="source-code-scroll" role="region" tabIndex={0} aria-label="File content">{content.length === 0 ? <p className="source-notice">This file is empty at this revision.</p> : null}<table className="source-file-code"><thead className="ui-sr-only"><tr><th scope="col">Line</th><th scope="col">Source</th></tr></thead><tbody>{content.map((text, i) => <tr key={i} data-source-line={i} className={`${line === i ? 'source-selected-line' : ''} source-heat-${Math.min(4, (traced?.[i]?.events.length ?? 1) - 1)}`}><td className="source-line-number"><button type="button" aria-label={`Inspect line ${i + 1}`} aria-pressed={line === i} tabIndex={line === i || (line === null && i === 0) ? 0 : -1} onKeyDown={event => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); const next = Math.max(0, Math.min(content.length - 1, i + (event.key === 'ArrowDown' ? 1 : -1))); setLine(next); codePane.current?.querySelector<HTMLButtonElement>(`[data-source-line="${next}"] button`)?.focus(); } }} onClick={() => { setLine(i); }}>{i + 1}</button></td><td onClick={() => { setLine(i); }}><code>{highlight(text, needle)}</code></td></tr>)}</tbody></table></div>}
      </section><aside className="source-line-history"><h3>Line history {line === null ? '' : `· ${line + 1}`}</h3>{!analysis ? <p>Analyze line history, then select a line to follow its changes.</p> : !traced ? <p>This revision is outside the analyzed window. Analyze again to include it.</p> : line === null ? <p>Select a line number in the file.</p> : <><p role="status">{events.length} observed versions of this line</p>{[...events].reverse().map((event, i) => <button type="button" key={`${event.sha}-${i}`} onClick={() => { const next = commits.findIndex(commit => commit.sha === event.sha); if (next >= 0) { setIndex(next); setLine(event.line - 1); } }}><code>{event.sha.slice(0, 9)}</code><small>{event.kind === 'baseline' ? 'Present at window start' : event.kind === 'edited' ? 'Aligned replacement' : 'Added'}</small><pre>{event.text}</pre></button>)}</>}
        <div className="source-heat-legend" aria-label="Observed edit frequency"><span>Low</span>{[0, 1, 2, 3, 4].map(value => <i key={value} className={`source-heat-${value}`} aria-hidden="true" />)}<span>High</span></div><p className="source-line-disclaimer">{analysisCount ? `${analysisCount} revisions analyzed. ` : ''}Line correspondence is inferred from adjacent diffs, not authoritative blame. Earlier history and renamed paths may be outside this window.</p>
      </aside></div>
    {contextOpen ? <div className="source-pr-context">{context.loading ? <p>Loading related PRs…</p> : context.error ? <p role="alert">{context.error}</p> : context.data?.pull_requests_unavailable ? <p>PR associations are temporarily unavailable.</p> : context.data?.pull_requests.length ? context.data.pull_requests.map(pr => <article key={pr.number}><a href={`/pr/${repository}/${pr.number}`}>#{pr.number} {pr.title}</a><pre>{pr.body || 'No description.'}</pre></article>) : <p>No associated PR was returned by GitHub.</p>}</div> : null}
  </ModalFrame>;
}
