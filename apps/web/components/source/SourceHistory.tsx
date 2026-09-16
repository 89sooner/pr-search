'use client';
import { useEffect, useState } from 'react';
import { FileCode, Folder, GitCommitHorizontal, GitCompareArrows, History, RefreshCw } from 'lucide-react';
import type { SourceCommit, SourceHistory as HistoryData } from '@prs/contracts';
import { Button } from '../ui';
import { sourceUrl, useSource } from './api';
import { DiffModal, TimeLapseModal, type DiffTarget } from './SourceDialogs';

export function SourceHistory({ repository, path, kind, revision, branch }: { repository: string; path: string; kind: string; revision: string; branch: string }) {
  const key = `${repository}|${path}|${revision}|${branch}`;
  return <HistoryBody key={key} repository={repository} path={path} kind={kind} revision={revision} branch={branch} />;
}
function HistoryBody({ repository, path, kind, revision, branch }: { repository: string; path: string; kind: string; revision: string; branch: string }) {
  const [page, setPage] = useState(1); const [pinned, setPinned] = useState(revision); const [commits, setCommits] = useState<SourceCommit[]>([]);
  const response = useSource<HistoryData>(repository ? sourceUrl(repository, 'history', { path, ref: pinned || branch, page }) : null);
  const [selected, setSelected] = useState<string[]>([]); const [diff, setDiff] = useState<DiffTarget | null>(null); const [time, setTime] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  useEffect(() => { if (response.data) { setPinned(response.data.revision); setCommits(previous => page === 1 ? response.data!.commits : [...previous, ...response.data!.commits].filter((item, index, all) => all.findIndex(other => other.sha === item.sha) === index)); } }, [response.data, page]);
  const isFile = Boolean(path) && kind !== 'directory';
  return <section className="source-history" aria-label="Path history" onKeyDown={event => {
    if ((event.target as HTMLElement).closest('input,textarea,select,[role="dialog"]')) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd' && active) { event.preventDefault(); event.stopPropagation(); setDiff({ repository, commit: active }); }
    if (!event.ctrlKey && !event.metaKey && !event.altKey && event.key.toLowerCase() === 't' && isFile && commits.length) { event.preventDefault(); event.stopPropagation(); setTime(true); }
  }}>
    <header className="source-history-header"><div><p className="reader-eyebrow">PATH HISTORY</p><h1>{isFile ? <FileCode size={21} /> : <Folder size={21} />}{path || repository}</h1><p>Changes that touched this {isFile ? 'file' : 'folder'} · <code>{(pinned || branch || 'default branch').slice(0, 12)}</code></p></div><Button variant="ghost" aria-label="Refresh path history" onClick={response.reload}><RefreshCw size={16} /></Button></header>
    <div className="source-history-toolbar"><span><GitCommitHorizontal size={15} />{commits.length} loaded commits</span><Button variant="secondary" disabled={!isFile || selected.length !== 2} onClick={() => { const chosen = commits.filter(commit => selected.includes(commit.sha)); if (chosen.length === 2) setDiff({ repository, file: { path, base: chosen[1]!.sha, head: chosen[0]!.sha } }); }}><GitCompareArrows size={15} />Compare selected {selected.length ? `(${selected.length}/2)` : ''}</Button><Button disabled={!isFile || !commits.length} onClick={() => { setTime(true); }}><History size={15} />Time-lapse</Button></div>
    <p className="source-caption">Select two revisions to compare this file. Folder history includes changes under the selected path. History is path-based; renamed files can be followed from their previous path in Diff.</p>
    {response.error ? <div role="alert" className="source-notice">{response.error}<Button variant="secondary" onClick={response.reload}>Retry</Button></div> : null}
    {response.loading ? <p role="status" className="source-notice">Loading path history…</p> : null}
    <div className="source-history-table"><table><thead><tr><th scope="col"><span className="ui-sr-only">Compare</span></th><th scope="col">Revision</th><th scope="col">Change</th><th scope="col">Author</th><th scope="col">Committed</th><th scope="col">Inspect</th></tr></thead><tbody>{commits.map(commit => <tr key={commit.sha} onMouseEnter={() => { setActive(commit.sha); }} onFocusCapture={() => { setActive(commit.sha); }}><td><input type="checkbox" aria-label={`Select ${commit.sha.slice(0, 7)} for comparison`} checked={selected.includes(commit.sha)} disabled={!isFile || (selected.length >= 2 && !selected.includes(commit.sha))} onChange={() => { setSelected(previous => previous.includes(commit.sha) ? previous.filter(sha => sha !== commit.sha) : [...previous, commit.sha]); }} /></td><td><code title={commit.sha}>{commit.sha.slice(0, 9)}</code></td><td><button type="button" className="source-history-title" onClick={() => { setDiff({ repository, commit: commit.sha }); }}>{commit.message.split('\n')[0]}</button></td><td>{commit.author}</td><td><time dateTime={commit.date ?? undefined}>{commit.date ? new Date(commit.date).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : 'Unknown'}</time></td><td><Button size="sm" variant="ghost" aria-label={`View diff for ${commit.sha.slice(0, 7)}`} onClick={() => { setDiff({ repository, commit: commit.sha }); }}><GitCompareArrows size={15} />Diff</Button></td></tr>)}</tbody></table></div>
    {!response.loading && !response.error && !commits.length ? <div className="source-empty"><History size={28} /><h2>No history for this path</h2><p>Choose another path or branch in the repository tree.</p></div> : null}
    {response.data?.next_page ? <div className="source-load-more"><Button variant="secondary" disabled={response.loading} onClick={() => { setPage(response.data!.next_page!); }}>Load older commits</Button></div> : null}
    {diff ? <DiffModal target={diff} onClose={() => { setDiff(null); }} /> : null}
    {time ? <TimeLapseModal repository={repository} path={path} revision={pinned || branch} initialCommits={commits} moreAvailable={Boolean(response.data?.next_page)} onClose={() => { setTime(false); }} /> : null}
  </section>;
}
