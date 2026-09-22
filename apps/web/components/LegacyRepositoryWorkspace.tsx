'use client';

/** WP-082 / CR-094: repository-first search, with persistent URL filters. */
import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button, Skeleton, Table, Tabs } from './ui';
import { DatePicker } from './reader/primitives';
import { WorkbenchIcon } from './WorkbenchIcon';
import type { RepositoryOverview } from '../lib/repository-overview';
import type { ResultRow } from './ResultTable';
import { formatTimestamp } from '../lib/format';
import { SourceTree } from './source/SourceTree';
import { SourceHistory } from './source/SourceHistory';
import { SourceActions, DiffModal, TimeLapseModal, type DiffTarget } from './source/SourceDialogs';
import { detectIdentifier, parseQuery } from '@prs/query';
import type { ResolutionCandidate } from './ResolutionCandidateList';
import { serviceMessage } from '../lib/service-message';
import { buildRepositoryQuery, repositorySort, type RepositoryWorkspaceTab } from '../lib/repository-search';

interface SearchData { items: ResultRow[]; total?: { value: number; relation: string }; next_cursor?: string | null }
interface DetailData { body?: string; message?: string; changed_paths?: string[]; files_truncated?: boolean; changed_paths_truncated?: boolean; source_commits?: { commit_sha: string }[]; merge_commit_sha?: string | null; base_branch?: string; head_branch?: string }
const TAB_NAMES = { search: "Search", history: "Commit history", open: "My open PRs", merged: "My merged PRs" } as const;
type WorkspaceTab = RepositoryWorkspaceTab;

export function LegacyWorkspaceDetail({ row, gheBaseUrl, onPath }: { row: ResultRow; gheBaseUrl?: string; onPath?: (path: string, revision?: string) => void }): ReactNode {
  const [detail, setDetail] = useState<DetailData | null>(null);
  const [error, setError] = useState('');
  const [nonce, setNonce] = useState(0);
  const [copied, setCopied] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    setDetail(null); setError('');
    const route = row.kind === 'pull_request' ? 'pull-requests' : 'commits';
    void fetch(`/api/${route}/${encodeURIComponent(row.repository ?? '')}/${row.pr_number ?? row.commit_sha ?? ''}`, { signal: controller.signal, cache: 'no-store' })
      .then(async response => { if (!response.ok) throw new Error("Unable to load details."); return response.json() as Promise<DetailData>; })
      .then(data => { if (!controller.signal.aborted) setDetail(data); })
      .catch(() => { if (!controller.signal.aborted) setError("Unable to load details."); });
    return () => { controller.abort(); };
  }, [row.repository, row.pr_number, row.commit_sha, row.kind, nonce]);
  const origin = gheBaseUrl?.replace(/\/$/, '');
  const source = origin && row.repository ? `${origin}/${row.repository}/${row.kind === 'pull_request' ? `pull/${row.pr_number}` : `commit/${row.commit_sha}`}` : null;
  return <div className="repo-detail">
    {error ? <p role="alert">{error} <Button variant="ghost" onClick={() => { setNonce(n => n + 1); }}>Try again</Button></p> : detail === null ? <Skeleton label="Loading details" /> : <>
      <div className="repo-detail-heading"><strong>{detail.head_branch ? `${detail.head_branch} → ${detail.base_branch ?? ''}` : "Change details"}</strong>
        {source ? <a href={source} target="_blank" rel="noreferrer">View in GHE <WorkbenchIcon name="external" /></a> : null}
        {row.repository ? <SourceActions repository={row.repository} {...(row.pr_number !== undefined ? { pr: row.pr_number } : {})} {...(row.commit_sha ? { commit: row.commit_sha } : {})} /> : null}
      </div>
      {detail.body || detail.message ? <p className="repo-description">{detail.body ?? detail.message}</p> : <p className="repo-muted">No description available.</p>}
      <div className="repo-detail-columns"><section><h3>Changed files</h3>
        {detail.changed_paths === undefined ? <p className="repo-muted">The file list has not been collected yet.</p> : detail.changed_paths.length === 0 ? <p className="repo-muted">No changed files.</p> :
          <ul className="repo-file-list">{detail.changed_paths.map(path => <li key={path}><WorkbenchIcon name="file" /><button type="button" onClick={() => { onPath?.(path, row.commit_sha ?? detail.merge_commit_sha ?? undefined); }} disabled={!onPath}>{path}</button></li>)}</ul>}
        {detail.files_truncated || detail.changed_paths_truncated ? <p className="repo-muted">Only some files are shown. View all changes in GHE.</p> : null}
      </section><section><h3>Commit</h3><div className="repo-commit-list">
        {[...(detail.merge_commit_sha ? [{ commit_sha: detail.merge_commit_sha }] : []), ...(detail.source_commits ?? [])].map((commit, index) =>
          <button key={`${commit.commit_sha}-${index}`} type="button" title="Copy SHA" onClick={() => { void navigator.clipboard.writeText(commit.commit_sha).then(() => { setCopied("SHA copied."); }).catch(() => { setCopied("Unable to copy. Select and copy the SHA manually."); }); }}>{commit.commit_sha}</button>)}
        <span role="status">{copied}</span></div></section></div>
    </>}
  </div>;
}

export function LegacyRepositoryWorkspace({ login = '', loginPath, gheBaseUrl }: { login?: string; loginPath: string; gheBaseUrl?: string }): ReactNode {
  const router = useRouter();
  const params = useSearchParams();
  const serialized = params.toString();
  const [repositories, setRepositories] = useState<RepositoryOverview[]>([]);
  const [repositoryCursor, setRepositoryCursor] = useState<string | null>(null);
  const [repositoryError, setRepositoryError] = useState('');
  const [repositoryLoading, setRepositoryLoading] = useState(true);
  const [repoNonce, setRepoNonce] = useState(0);
  const [repoNext, setRepoNext] = useState<string | null>(null);
  const [data, setData] = useState<SearchData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [unauthorized, setUnauthorized] = useState(false);
  const [nonce, setNonce] = useState(0);
  const [cursor, setCursor] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [repoFind, setRepoFind] = useState('');
  const [activeRow, setActiveRow] = useState<ResultRow | null>(null);
  const [diffTarget, setDiffTarget] = useState<DiffTarget | null>(null);
  const [timeOpen, setTimeOpen] = useState(false);
  const repository = params.get('repository') ?? repositories[0]?.repository ?? '';
  const selected = repositories.find(repo => repo.repository === repository);
  const tab: WorkspaceTab = params.get('tab') === 'history' ? 'history' : params.get('tab') === 'open' ? 'open' : params.get('tab') === 'merged' ? 'merged' : 'search';
  const [draft, setDraft] = useState<Record<string, string>>({});
  useEffect(() => { setDraft(Object.fromEntries(new URLSearchParams(serialized))); }, [serialized]);
  function navigate(changes: Record<string, string>): void {
    const next = new URLSearchParams(serialized);
    next.delete('legacy');
    if (changes['repository'] !== undefined || (changes['base'] !== undefined && changes['base'] !== (params.get('base') ?? ''))) { next.delete('source_ref'); next.delete('path_kind'); }
    for (const [key, value] of Object.entries(changes)) { if (value) next.set(key, value); else next.delete(key); }
    if (!next.has('repository') && repository) next.set('repository', repository);
    router.replace(`/search?${next.toString()}`, { scroll: false });
  }
  useEffect(() => {
    const controller = new AbortController();
    setRepositoryLoading(true); setRepositoryError('');
    void (async () => {
      try {
        let next = repoNext;
        // Scope filtering can return empty pages. Continue until a visible repository or the end.
        for (let page = 0; page < 20; page++) {
          const response = await fetch(`/api/repositories?limit=100${next ? `&cursor=${encodeURIComponent(next)}` : ''}`, { signal: controller.signal, cache: 'no-store' });
          if (response.status === 401) { setUnauthorized(true); throw new Error("Sign in required."); }
          if (!response.ok) throw new Error("Unable to load repositories.");
          const body = await response.json() as { items: RepositoryOverview[]; next_cursor?: string | null };
          if (controller.signal.aborted) return;
          setRepositories(current => [...(repoNext ? current : []), ...body.items].filter((repo, index, all) => all.findIndex(item => item.repository_id === repo.repository_id) === index));
          next = body.next_cursor ?? null;
          setRepositoryCursor(next);
          if (body.items.length || !next) break;
        }
      } catch (reason) { if (!controller.signal.aborted) setRepositoryError(reason instanceof Error ? reason.message : "Unable to load repositories"); }
      finally { if (!controller.signal.aborted) setRepositoryLoading(false); }
    })();
    return () => { controller.abort(); };
  }, [repoNonce, repoNext]);
  const query = useMemo(() => {
    return buildRepositoryQuery({ serialized, repository, tab, login });
  }, [serialized, repository, tab, login]);
  const sort = repositorySort(tab, params.get('sort'));
  const order = params.get('order') === 'asc' ? 'asc' : 'desc';
  const requestKey = `${query}|${sort}|${order}`;
  const [loadedKey, setLoadedKey] = useState('');
  useEffect(() => { setCursor(null); setExpanded(null); }, [requestKey]);
  useEffect(() => {
    if (!repository || tab === 'history' || ((tab === 'open' || tab === 'merged') && !login)) { setLoading(false); return; }
    const controller = new AbortController();
    setLoading(true); setError('');
    const currentParams = new URLSearchParams(serialized);
    if (Boolean(currentParams.get('from')) !== Boolean(currentParams.get('to'))) {
      setError("Enter both merge start and end dates."); setLoading(false); return;
    }
    try { parseQuery(query); } catch (reason) { setError(reason instanceof Error ? reason.message : "Check your search filters."); setLoading(false); return; }
    const continuation = loadedKey === requestKey ? cursor : null;
    const search = new URLSearchParams({ q: query, sort, order, size: '50' });
    if (continuation) search.set('cursor', continuation);
    const raw = currentParams.get('q')?.trim() ?? '';
    const detected = detectIdentifier(raw, gheBaseUrl ? { gheBaseUrl } : {});
    const identifier = raw !== '' && detected.interpretations.some(item => item.kind === 'commit' || item.kind === 'pull_request' || item.kind === 'merge_number');
    const target = identifier ? `/api/resolve?${new URLSearchParams({ q: raw.startsWith('#') ? `${repository}${raw}` : raw, limit: '50' })}` : `/api/search?${search.toString()}`;
    void fetch(target, { signal: controller.signal, cache: 'no-store' })
      .then(async response => {
        if (response.status === 401) setUnauthorized(true);
        const body = await response.json() as SearchData & { error?: { message?: string; code?: string }; candidates?: ResolutionCandidate[]; truncated?: boolean; epoch_stale?: boolean };
        if (!response.ok) throw new Error(serviceMessage(body.error?.message, "Unable to load search results.", body.error?.code));
        if (body.epoch_stale) throw new Error("The sequence epoch changed. Check your filters and try again.");
        if (identifier) return { items: (body.candidates ?? []).map(candidate => ({ ...candidate, title: candidate.display_name, author: candidate.author ?? null, state: candidate.state ?? null, merged_at: null, changed_files_count: null, additions: null, deletions: null })), total: { value: body.candidates?.length ?? 0, relation: body.truncated ? 'gte' : 'eq' } };
        return body;
      }).then(body => {
        if (controller.signal.aborted) return;
        setData(previous => ({ ...body, items: continuation ? [...(previous?.items ?? []), ...body.items] : body.items }));
        setLoadedKey(requestKey);
      }).catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Search failed"); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => { controller.abort(); };
    // loadedKey determines whether a cursor belongs to this request; it is not a fetch trigger.
  }, [requestKey, cursor, nonce, repository, login, gheBaseUrl]);
  const rows = loadedKey === requestKey ? data?.items ?? [] : [];
  function field(key: string, label: string, placeholder = '', type = 'text'): ReactNode {
    const date = type === 'date';
    return <label className="repo-field"><span>{label}</span><input type={date ? 'text' : type} inputMode={date ? 'numeric' : undefined} pattern={date ? '\\d{4}-\\d{2}-\\d{2}' : undefined} value={draft[key] ?? ''} placeholder={date ? 'YYYY-MM-DD' : placeholder} onChange={event => { setDraft(current => ({ ...current, [key]: event.target.value })); }} /></label>;
  }
  function sortBy(fieldName: string): void { navigate({ sort: fieldName, order: sort === fieldName && order === 'desc' ? 'asc' : 'desc' }); }
  return <div className="repo-workspace" onKeyDown={event => {
    if ((event.target as HTMLElement).closest('input,textarea,select,[contenteditable="true"],[role="dialog"]')) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd' && activeRow?.repository && tab !== 'history') { event.preventDefault(); setDiffTarget({ repository: activeRow.repository, ...(activeRow.pr_number ? { pr: activeRow.pr_number } : {}), ...(activeRow.commit_sha ? { commit: activeRow.commit_sha } : {}) }); }
    if (!event.ctrlKey && !event.metaKey && !event.altKey && event.key.toLowerCase() === 't' && params.get('path') && params.get('path_kind') !== 'directory') { event.preventDefault(); setTimeOpen(true); }
  }}>
    <aside className="repo-sidebar" aria-label="Browse repositories">
      <div className="repo-sidebar-heading"><WorkbenchIcon name="repository" /><h2>Browse repositories</h2></div>
      <label className="repo-field"><span>Find repository</span><input type="search" placeholder="Search by name…" value={repoFind} onChange={event => { setRepoFind(event.target.value); }} /></label>
      <div className="repo-repositories">{repositories.filter(repo => repo.repository.toLowerCase().includes(repoFind.toLowerCase())).map(repo =>
        <button type="button" key={repo.repository_id} aria-pressed={repository === repo.repository} onClick={() => { navigate({ repository: repo.repository, base: '', path: '' }); }}><WorkbenchIcon name="repository" /><span>{repo.repository}</span><WorkbenchIcon name="chevron" /></button>)}
        {repositoryLoading ? <Skeleton label="Loading repositories" /> : null}
        {repositoryError ? <p role="alert">{repositoryError} <Button variant="ghost" onClick={() => { setRepoNonce(n => n + 1); }}>Try again</Button></p> : null}
        {repositoryCursor ? <Button variant="ghost" disabled={repositoryLoading} onClick={() => { setRepoNext(repositoryCursor); }}>More repositories</Button> : null}
        {!repositoryLoading && !repositoryError && !repositories.length ? <p className="repo-muted">No accessible repositories.</p> : null}
      </div>
      <div className="repo-sidebar-heading"><WorkbenchIcon name="branch" /><h2>Branch</h2></div>
      <label className="repo-field"><span>Base branch</span><input list="repo-branches" placeholder="All branches" value={draft['base'] ?? ''} onChange={event => { setDraft(current => ({ ...current, base: event.target.value })); }} onBlur={() => { if ((draft['base'] ?? '') !== (params.get('base') ?? '')) navigate({ base: draft['base'] ?? '' }); }} onKeyDown={event => { if (event.key === 'Enter') navigate({ base: draft['base'] ?? '' }); }} /></label>
      <datalist id="repo-branches">{selected?.sequence_spaces.map(space => <option key={space.base_branch} value={space.base_branch} />)}</datalist>
      <form onSubmit={event => { event.preventDefault(); const path = draft['path'] ?? ''; navigate({ path: path.replace(/\/+$/, ''), path_kind: !path || path.endsWith('/') ? 'directory' : 'file', source_ref: '', tab: 'history' }); }}>
        {field('path', "Find files and paths", 'src/components/…')}
        <Button type="submit" variant="secondary" disabled={!repository}><WorkbenchIcon name="history" /> View path history</Button>
      </form>
      <SourceTree repository={repository} branch={params.get('base') ?? ''} selectedPath={params.get('path') ?? ''} onSelect={selection => { navigate({ path: selection.path, path_kind: selection.kind, source_ref: selection.revision, tab: 'history' }); }} />
      <p className="repo-sidebar-note">Explore PRs and commits that changed a file. Select a file in the details to view its path history.</p>
    </aside>
    <section className="repo-main" aria-label="Repository workspace">
      <header className="repo-heading"><div><p className="prs-eyebrow">REPOSITORY WORKSPACE</p><h1>{repository || "Search"}</h1><p>Find the context behind every change</p></div><Button variant="ghost" aria-label="Refresh search" onClick={() => { setCursor(null); setNonce(n => n + 1); }}><WorkbenchIcon name="refresh" /></Button></header>
      <Tabs.Root value={tab} onValueChange={value => { navigate({ tab: value, state: '', author: '' }); }} activationMode="automatic">
        <Tabs.List aria-label="Browse by">{Object.entries(TAB_NAMES).map(([value, label]) => <Tabs.Trigger key={value} value={value}>{label}</Tabs.Trigger>)}</Tabs.List>
        {Object.keys(TAB_NAMES).map(value => <Tabs.Content key={value} value={value}>
          {value === tab && tab === 'history' ? <SourceHistory repository={repository} path={params.get('path') ?? ''} kind={params.get('path_kind') ?? 'file'} revision={params.get('source_ref') ?? ''} branch={params.get('base') ?? ''} /> : value === tab ? <>
            <form className="repo-filter-form" onSubmit={event => { event.preventDefault(); navigate(Object.fromEntries(['q', 'author', 'label', 'state', 'from', 'to', 'path', 'base'].map(key => [key, draft[key] ?? '']))); }}>
              <div className="repo-query-row">{field('q', "Search query", "Search titles, descriptions, or filters…")}<Button type="submit" disabled={!repository}><WorkbenchIcon name="search" /> Search</Button></div>
              <div className="repo-filter-grid">
                {tab === 'open' || tab === 'merged' ? <label className="repo-field"><span>Author</span><input value={login} readOnly /></label> : field('author', "Author", "GitHub username")}
                {field('label', "Label", "All labels")}
                <label className="repo-field"><span>Status</span><select value={tab === 'open' || tab === 'merged' ? tab : draft['state'] ?? ''} disabled={tab !== 'search'} onChange={event => { setDraft(current => ({ ...current, state: event.target.value })); }}><option value="">All</option><option value="open">Open</option><option value="merged">Merged</option><option value="closed">Closed</option></select></label>
                <DatePicker label="Merged after" value={draft['from'] ?? ''} onChange={from => { setDraft(current => ({ ...current, from })); }} /><DatePicker label="Merged before" value={draft['to'] ?? ''} onChange={to => { setDraft(current => ({ ...current, to })); }} />
              </div>
              <div className="repo-filter-footer"><span>Combine filters to find the changes you need.</span><Button type="button" variant="ghost" size="sm" onClick={() => { navigate({ q: '', author: '', label: '', state: '', from: '', to: '', path: '', base: '' }); }}>Reset filters</Button></div>
            </form>
            <div className="repo-results-heading"><span><WorkbenchIcon name="pr" /> {TAB_NAMES[tab]} <strong>{loading ? "Loading…" : loadedKey === requestKey && data?.total ? `${data.total.value.toLocaleString("en-US")}${data.total.relation === 'gte' ? '+' : ''} items` : ''}</strong></span><span>Merge order is scoped to a repository and branch</span></div>
            {unauthorized ? <p role="alert">Your session has expired. <a href={`${loginPath}?return_to=${encodeURIComponent(`/search?${serialized}`)}`}>Sign in again</a></p> : null}
            {error ? <p role="alert" className="repo-error">{error} <Button variant="secondary" onClick={() => { setCursor(null); setNonce(n => n + 1); }}>Reload first page</Button></p> : null}
            <Table className="repo-table" aria-label={TAB_NAMES[tab]} scrollContainerProps={{ tabIndex: 0 }}>
              <Table.Head><Table.Row><Table.HeaderCell scope="col"><span className="ui-sr-only">Details</span></Table.HeaderCell>
                <Table.HeaderCell scope="col" aria-sort={sort === 'merge_seq' ? order === 'asc' ? 'ascending' : 'descending' : 'none'}><button type="button" onClick={() => { sortBy('merge_seq'); }}>Sequence ↕</button></Table.HeaderCell>
                <Table.HeaderCell scope="col">PR / changes</Table.HeaderCell><Table.HeaderCell scope="col">Author</Table.HeaderCell><Table.HeaderCell scope="col">Status</Table.HeaderCell>
                <Table.HeaderCell scope="col" aria-sort={sort === 'merged_at' ? order === 'asc' ? 'ascending' : 'descending' : 'none'}><button type="button" onClick={() => { sortBy('merged_at'); }}>Merged at ↕</button></Table.HeaderCell><Table.HeaderCell scope="col">Changes</Table.HeaderCell>
              </Table.Row></Table.Head><Table.Body>
                {loading && !rows.length ? Array.from({ length: 7 }, (_, index) => <Table.Row key={index}><Table.Cell colSpan={7}><Skeleton label={index === 0 ? "Loading changes" : ''} /></Table.Cell></Table.Row>) : rows.map(row => {
                  const id = `${row.kind}:${row.repository}:${row.pr_number ?? row.commit_sha}:${row.sequence_space}`;
                  const name = row.pr_number ? `#${row.pr_number}` : row.commit_sha?.slice(0, 12) ?? "Commit";
                  return <Fragment key={id}><Table.Row data-expanded={expanded === id || undefined} onMouseEnter={() => { setActiveRow(row); }} onFocusCapture={() => { setActiveRow(row); }}>
                    <Table.Cell><button type="button" className="repo-expand" aria-expanded={expanded === id} aria-label={`${name} Details`} onClick={() => { setExpanded(expanded === id ? null : id); }}><WorkbenchIcon name="chevron" /></button></Table.Cell>
                    <Table.Cell><span className="repo-sequence" title={row.sequence_space ?? ''}>{row.merge_seq ?? '—'}</span></Table.Cell>
                    <Table.Cell><button type="button" className="repo-title-button" onClick={() => { setExpanded(expanded === id ? null : id); }}><span className="repo-pr-number">{name}</span>{row.title ?? name}</button><small>{row.sequence_space ?? row.repository}</small></Table.Cell>
                    <Table.Cell>{row.author ?? '—'}</Table.Cell><Table.Cell><span className="prs-result-state" data-state={row.state ?? 'unknown'}>{row.state === 'merged' ? "Merged" : row.state === 'open' ? "Open" : row.state === 'closed' ? "Closed" : '—'}</span></Table.Cell>
                    <Table.Cell><time dateTime={row.merged_at ?? undefined}>{formatTimestamp(row.merged_at)}</time></Table.Cell><Table.Cell><span className="prs-diff-added">{row.additions === null ? '—' : `+${row.additions}`}</span> <span className="repo-deletions">{row.deletions === null ? '' : `−${row.deletions}`}</span></Table.Cell>
                  </Table.Row>{expanded === id ? <Table.Row><Table.Cell colSpan={7}><LegacyWorkspaceDetail row={row} {...(gheBaseUrl ? { gheBaseUrl } : {})} onPath={(path, revision) => { navigate({ path, tab: 'history', path_kind: 'file', source_ref: revision ?? '' }); }} /></Table.Cell></Table.Row> : null}</Fragment>;
                })}
              </Table.Body></Table>
            {!loading && !error && !rows.length ? <div className="repo-empty"><WorkbenchIcon name="search" /><h2>{repository ? "No matching changes" : "No repositories to display"}</h2><p>{repository ? "Adjust your query or filters and search again." : "PRs will appear when an accessible ingested repository is available."}</p></div> : null}
            {loadedKey === requestKey && data?.next_cursor ? <div className="repo-load-more"><Button variant="secondary" disabled={loading} onClick={() => { setCursor(data.next_cursor ?? null); }}>More changes</Button><span>{rows.length.toLocaleString("en-US")} shown</span></div> : null}
          </> : null}
        </Tabs.Content>)}
      </Tabs.Root>
    </section>
    {diffTarget ? <DiffModal target={diffTarget} onClose={() => { setDiffTarget(null); }} /> : null}
    {timeOpen && params.get('path') ? <TimeLapseModal repository={repository} path={params.get('path')!} revision={params.get('source_ref') ?? params.get('base') ?? ''} onClose={() => { setTimeOpen(false); }} /> : null}
  </div>;
}
