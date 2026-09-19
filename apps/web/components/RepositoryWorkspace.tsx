'use client';

/** WP-082 / CR-094: repository-first search, with persistent URL filters. */
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type Ref } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import * as Tabs from '@radix-ui/react-tabs';
import { Button, DatePicker, Skeleton, Table, FieldSelect } from './reader/primitives';
import { Spinner, Collapsible } from './ui';
import { GitPullRequest, GitMerge, History, Search, ArrowDown, ArrowUp, ChevronDown, FolderGit2, Command } from 'lucide-react';
import { WorkbenchIcon } from './WorkbenchIcon';
import type { RepositoryOverview } from '../lib/repository-overview';
import type { ResultRow } from './ResultTable';
import { formatTimestamp } from '../lib/format';
import { SourceTree } from './source/SourceTree';
import { SourceHistory } from './source/SourceHistory';
import { DiffModal, TimeLapseModal, SourceActions, type DiffTarget } from './source/SourceDialogs';
import { detectIdentifier, parseQuery } from '@prs/query';
import type { ResolutionCandidate } from './ResolutionCandidateList';
import { serviceMessage } from '../lib/service-message';
import { resolveUrl } from '../lib/search-fetch';
import { MergeNumberBadge } from './MergeNumberBadge';
import { splitSequenceSpace } from '../lib/merge-number';
import { buildRepositoryQuery, buildShaRangeFilter, deriveInitialRangeType, repositoryLabelOptions, repositorySort, type RangeType, type RepositoryWorkspaceTab } from '../lib/repository-search';

interface SearchData { items: ResultRow[]; total?: { value: number; relation: string }; next_cursor?: string | null; facets?: Record<string, { value: string; count: number }[]> }
interface DetailData { body?: string; message?: string; changed_paths?: string[]; files_truncated?: boolean; changed_paths_truncated?: boolean; source_commits?: { commit_sha: string }[]; merge_commit_sha?: string | null; base_branch?: string; head_branch?: string }
const TAB_NAMES = { search: "Search", history: "Commit history", open: "My open PRs", merged: "My merged PRs" } as const;
type WorkspaceTab = RepositoryWorkspaceTab;
/** CR-111: options for the consolidated Range filter selector. */
const RANGE_TYPE_OPTIONS: { value: RangeType; label: string }[] = [
  { value: 'pr', label: 'PR number' },
  { value: 'mnum', label: 'M number' },
  { value: 'date', label: 'Merged date' },
  { value: 'seq', label: 'Merge order' },
];

export function WorkspaceDetail({ row, gheBaseUrl, onPath }: { row: ResultRow; gheBaseUrl?: string; onPath?: (path: string, revision?: string) => void }): ReactNode {
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

export function RepositoryWorkspace({ login = '', loginPath, gheBaseUrl }: { login?: string; loginPath: string; gheBaseUrl?: string }): ReactNode {
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
  const [activeRow, setActiveRow] = useState<ResultRow | null>(null);
  const [diffTarget, setDiffTarget] = useState<DiffTarget | null>(null);
  const [timeOpen, setTimeOpen] = useState(false);
  // CR-106: merge-order range from two commit SHAs. Resolved client-side on submit, kept out of `draft`/the URL because it needs a network round trip `buildRepositoryQuery` can't do synchronously.
  const [shaFrom, setShaFrom] = useState('');
  const [shaTo, setShaTo] = useState('');
  const [seqRange, setSeqRange] = useState<{ space: string; range: string } | undefined>(undefined);
  const [resolving, setResolving] = useState(false);
  const shaSubmitToken = useRef(0);
  // CR-111: filter panel starts collapsed; the active-filter/range summaries let users tell it's non-empty without opening it.
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [rangeType, setRangeType] = useState<RangeType>(() => deriveInitialRangeType(serialized));
  const qRef = useRef<HTMLInputElement>(null);
  const pendingFocus = useRef(false);
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
    return buildRepositoryQuery({ serialized, repository, tab, login, ...(seqRange ? { seqRange } : {}) });
  }, [serialized, repository, tab, login, seqRange]);
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
    // CR-111: a range's own fields are hidden unless its type is selected -- surface the type that has the problem, or the error points at fields the user can't see.
    if (Boolean(currentParams.get('from')) !== Boolean(currentParams.get('to'))) {
      setRangeType('date'); setError("Enter both merge start and end dates."); setLoading(false); return;
    }
    if (Boolean(currentParams.get('pr_from')) !== Boolean(currentParams.get('pr_to'))) {
      setRangeType('pr'); setError("Enter both PR number range bounds."); setLoading(false); return;
    }
    if (Boolean(currentParams.get('mnum_from')) !== Boolean(currentParams.get('mnum_to'))) {
      setRangeType('mnum'); setError("Enter both M number range bounds."); setLoading(false); return;
    }
    const continuation = loadedKey === requestKey ? cursor : null;
    const search = new URLSearchParams({ q: query, sort, order, size: '50', facets: continuation ? 'false' : 'true' });
    if (continuation) search.set('cursor', continuation);
    const raw = currentParams.get('q')?.trim() ?? '';
    const detected = detectIdentifier(raw, gheBaseUrl ? { gheBaseUrl } : {});
    const identifier = raw !== '' && detected.interpretations.some(item => item.kind === 'commit' || item.kind === 'pull_request');
    if (!identifier) { try { parseQuery(query); } catch (reason) { setError(reason instanceof Error ? reason.message : "Check your search filters."); setLoading(false); return; } }
    const target = identifier ? resolveUrl(raw.startsWith('#') ? `${repository}${raw}` : raw) : `/api/search?${search.toString()}`;
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
        setData(previous => ({ ...body, ...(continuation && previous?.facets ? { facets: previous.facets } : {}), items: continuation ? [...(previous?.items ?? []), ...body.items] : body.items }));
        setLoadedKey(requestKey);
      }).catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Search failed"); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => { controller.abort(); };
    // loadedKey determines whether a cursor belongs to this request; it is not a fetch trigger.
  }, [requestKey, cursor, nonce, repository, login, gheBaseUrl]);
  const rows = loadedKey === requestKey ? data?.items ?? [] : [];
  const nextCursor = loadedKey === requestKey ? data?.next_cursor ?? null : null;
  /*
   * CR-104/WP-091: infinite scroll replaces the "More changes" button. The observer callback reads
   * this ref instead of closing over `nextCursor`/`loading`/`error` directly, so the sentinel doesn't
   * need to be torn down and re-observed (which re-fires the callback immediately, per spec) every
   * time a fetch starts or finishes -- only when the sentinel DOM node itself mounts or unmounts.
   * `!hasError` is what preserves CR-043's no-auto-retry rule: a rejected cursor sets `error` and the
   * existing banner + "Reload first page" button (unchanged) becomes the only way to resume: the
   * observer keeps firing on scroll (the sentinel is still there) but every callback is a no-op while
   * `error` is truthy, so it can't loop.
   */
  const infiniteScrollState = useRef({ nextCursor, loading, error });
  infiniteScrollState.current = { nextCursor, loading, error };
  const observerRef = useRef<IntersectionObserver | null>(null);
  const sentinelRef = useCallback((node: HTMLDivElement | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    if (!node) return;
    const observer = new IntersectionObserver(entries => {
      if (!entries[0]?.isIntersecting) return;
      const state = infiniteScrollState.current;
      if (state.nextCursor && !state.loading && !state.error) setCursor(state.nextCursor);
    }, { rootMargin: '200px' });
    observer.observe(node);
    observerRef.current = observer;
  }, []);
  const labelOptions = useMemo(() => {
    return repositoryLabelOptions(draft['label'] ?? '', data?.facets?.['label'] ?? []);
  }, [data?.facets, draft]);
  // CR-111: which range kinds currently hold a value, so the collapsed selector can summarize them without showing every input at once.
  const rangeActive = {
    pr: Boolean(draft['pr_from'] && draft['pr_to']),
    mnum: Boolean(draft['mnum_from'] && draft['mnum_to']),
    date: Boolean(draft['from'] && draft['to']),
    // seqRange is resolved against a specific repository@base; once either changes it's stale even though the state hasn't been cleared (matches the staleness check `buildRepositoryQuery` already applies before emitting `seq:`).
    seq: Boolean(seqRange && seqRange.space === `${repository}@${draft['base'] ?? ''}`) || Boolean(shaFrom && shaTo),
  };
  const activeRangeSummaries = [
    rangeActive.pr ? `PR ${draft['pr_from']}–${draft['pr_to']}` : null,
    rangeActive.mnum ? `M ${draft['mnum_from']}–${draft['mnum_to']}` : null,
    rangeActive.date ? `Merged ${draft['from']}–${draft['to']}` : null,
    rangeActive.seq ? (seqRange ? 'Merge order set' : 'Merge order pending') : null,
  ].filter((summary): summary is string => summary !== null);
  const activeFilterCount = [draft['q'], tab === 'search' ? draft['author'] : '', draft['label'], tab === 'search' ? draft['state'] : ''].filter(Boolean).length + Object.values(rangeActive).filter(Boolean).length;
  function field(key: string, label: string, placeholder = '', type = 'text', min?: string, disabledReason?: string, ref?: Ref<HTMLInputElement>): ReactNode {
    const date = type === 'date';
    return <label className={`repo-field repo-field--${key}`}><span>{label}</span><input ref={ref} type={date ? 'text' : type} inputMode={date ? 'numeric' : undefined} pattern={date ? '\\d{4}-\\d{2}-\\d{2}' : undefined} min={min} step={type === 'number' ? '1' : undefined} data-reader-search={key === 'q' ? '' : undefined} value={draft[key] ?? ''} placeholder={date ? 'YYYY-MM-DD' : placeholder} disabled={disabledReason !== undefined} title={disabledReason} onChange={event => { setDraft(current => ({ ...current, [key]: event.target.value })); }} /></label>;
  }
  function sortBy(fieldName: string): void { navigate({ sort: fieldName, order: sort === fieldName && order === 'desc' ? 'asc' : 'desc' }); }
  /*
   * CR-106 정정(독립 검토): `mnum:`은 `base:`가 있어야 뜻이 있다(AC-9). 필드
   * 자체는 base가 없을 때 `disabled`로 그려지지만, `draft['mnum_from'/'to']`가
   * 그 전에 채워진 값을 그대로 들고 있을 수 있다(예: 저장소를 바꾼 뒤 base를
   * 아직 다시 고르지 않은 경우) — 화면은 비활성으로 보이는데 제출은 그 값을
   * 실어 보내는 어긋남을 여기서 한 번 더 막는다. 개별 변경 지점(저장소 전환,
   * Base branch 선택 두 곳)에서도 지우지만, 그것들을 놓친 경우의 마지막 방어선이다.
   */
  const commitFilters = (): void => {
    const base = draft['base'] ?? '';
    navigate(Object.fromEntries(['q', 'author', 'label', 'state', 'from', 'to', 'path', 'base', 'pr_from', 'pr_to', 'mnum_from', 'mnum_to'].map(key => [key, (key === 'mnum_from' || key === 'mnum_to') && !base ? '' : draft[key] ?? ''])));
  };
  /*
   * CR-106: SHA range is a client-side transform, not a query key -- resolve both commits before
   * committing anything, and abort the whole submit (no navigate) on any failure so a bad range
   * never silently drops or overwrites the rest of the filters (brief: "검색을 진행하지 않고").
   */
  function submitSearch(): void {
    /*
     * CR-106 정정(독립 검토): 두 SHA 칸을 비운 채 다시 제출하면 이전에 확정한
     * `seqRange`를 지워야 한다 — repo/base가 그대로면 공간이 계속 일치해
     * 지우지 않으면 화면에는 안 보이는 `seq:` 조건이 계속 걸린 채로 남는다.
     */
    if (!shaFrom && !shaTo) { setSeqRange(undefined); commitFilters(); return; }
    if (!shaFrom || !shaTo) { setRangeType('seq'); setError("Enter both commit SHAs for the merge-order range."); return; }
    if (!repository || !draft['base']) { setRangeType('seq'); setError("Select a repository and base branch before searching a merge-order range."); return; }
    const token = ++shaSubmitToken.current;
    setResolving(true); setError('');
    void (async () => {
      const identify = (value: string): string | null => {
        const detected = detectIdentifier(value, gheBaseUrl ? { gheBaseUrl } : {});
        if (detected.rejection) return detected.rejection.message;
        return detected.interpretations.some(item => item.kind === 'commit') ? null : "Enter a valid commit SHA (at least 7 hexadecimal characters).";
      };
      const problems = [identify(shaFrom), identify(shaTo)].filter((message): message is string => message !== null);
      if (problems.length) { setError(problems.join(' ')); setResolving(false); return; }
      const resolve = (sha: string) => fetch(resolveUrl(sha), { cache: 'no-store' })
        .then(async response => { const body = await response.json() as { candidates?: ResolutionCandidate[]; error?: { message?: string; code?: string } }; if (!response.ok) throw new Error(serviceMessage(body.error?.message, "Unable to resolve the commit SHA.", body.error?.code)); return body.candidates ?? []; });
      try {
        const [fromCandidates, toCandidates] = await Promise.all([resolve(shaFrom), resolve(shaTo)]);
        if (shaSubmitToken.current !== token) return;
        const outcome = buildShaRangeFilter({ repository, base: draft['base'] ?? '', fromCandidates, toCandidates });
        if (outcome.kind === 'error') { setError(outcome.message); setResolving(false); return; }
        setSeqRange({ space: outcome.space, range: outcome.range }); setResolving(false); commitFilters();
      } catch (reason) {
        if (shaSubmitToken.current === token) { setError(reason instanceof Error ? reason.message : "Unable to resolve the commit SHAs."); setResolving(false); }
      }
    })();
  }
  /*
   * CR-111: the `q` input now lives inside a `Collapsible` that would otherwise unmount while
   * closed. It's `forceMount`ed in the JSX below (CSS hides it via `[data-state='closed']`) so
   * ReaderShell's own `⌘K`/`Ctrl+G`/`#omni-search-input` handlers still find it and `preventDefault()`
   * correctly -- but `element.focus()` on a `display:none` element is a silent no-op, so this
   * component also opens the section itself and queues a focus that fires once it's actually
   * visible. When filters are already open, `setFiltersOpen` is a no-op (no state change, so the
   * effect below never fires) and ReaderShell's own unassisted focus call already works.
   */
  useEffect(() => {
    function openWithFocus(): void {
      setFiltersOpen(current => { if (!current) pendingFocus.current = true; return true; });
    }
    if (window.location.hash === '#omni-search-input') openWithFocus();
    const listener = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && (event.key.toLowerCase() === 'k' || event.key.toLowerCase() === 'g')) openWithFocus();
    };
    window.addEventListener('keydown', listener);
    return () => { window.removeEventListener('keydown', listener); };
  }, []);
  useEffect(() => {
    if (filtersOpen && pendingFocus.current) { pendingFocus.current = false; qRef.current?.focus(); qRef.current?.select(); }
  }, [filtersOpen]);
  return <div className="repo-workspace" onKeyDown={event => {
    if ((event.target as HTMLElement).closest('input,textarea,select,[contenteditable="true"],[role="dialog"],[role="combobox"],[role="listbox"]')) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd' && activeRow?.repository && tab !== 'history') { event.preventDefault(); setDiffTarget({ repository: activeRow.repository, ...(activeRow.pr_number ? { pr: activeRow.pr_number } : {}), ...(activeRow.commit_sha ? { commit: activeRow.commit_sha } : {}) }); }
    if (!event.ctrlKey && !event.metaKey && !event.altKey && event.key.toLowerCase() === 't' && params.get('path') && params.get('path_kind') !== 'directory') { event.preventDefault(); setTimeOpen(true); }
  }}>
    <aside className="repo-sidebar" aria-label="Repository and files">
      <FieldSelect
        label="Find Repository"
        value={repository}
        disabled={repositoryLoading && !repositories.length}
        onChange={next => {
          if (next === '__more__') { setRepoNext(repositoryCursor); return; }
          navigate({ repository: next, base: '', path: '', mnum_from: '', mnum_to: '' });
        }}
        options={[
          // A page beyond what's loaded so far can be the URL's selected repository before its own page has been fetched; without this it matches no option and the trigger renders blank.
          ...(repository && !repositories.some(repo => repo.repository === repository) ? [{ value: repository, label: repository }] : []),
          ...(repositories.length ? repositories.map(repo => ({ value: repo.repository, label: repo.repository })) : [{ value: '', label: repositoryLoading ? 'Loading repositories…' : repositoryError ? 'Unable to load repositories' : 'No repositories', disabled: true }]),
          ...(repositoryCursor ? [{ value: '__more__', label: repositoryLoading ? 'Loading more…' : 'Load more repositories…', disabled: repositoryLoading }] : []),
        ]}
      />
      {repositoryError ? <p role="alert" className="repo-sidebar-error">{repositoryError} <Button variant="ghost" onClick={() => { setRepoNonce(n => n + 1); }}>Try again</Button></p> : null}
      <FieldSelect className="repo-sidebar-gap" label="Base branch" value={draft['base'] ?? ''} onChange={base => { setDraft(current => ({ ...current, base, mnum_from: '', mnum_to: '' })); navigate({ base, mnum_from: '', mnum_to: '' }); }} options={[{ value: '', label: 'All branches' }, ...(selected?.sequence_spaces.map(space => ({ value: space.base_branch, label: space.base_branch })) ?? [])]} />
      <SourceTree repository={repository} branch={params.get('base') ?? ''} selectedPath={params.get('path') ?? ''} onSelect={selection => { navigate({ path: selection.path, path_kind: selection.kind, source_ref: selection.revision, tab: 'history' }); }} />
    </aside>
    <section className="repo-main" aria-label="Repository workspace">
      <Tabs.Root value={tab} onValueChange={value => { navigate({ tab: value }); }} activationMode="manual">
        <Tabs.List aria-label="Browse by">{Object.entries(TAB_NAMES).map(([value, label]) => <Tabs.Trigger key={value} value={value}>{value === 'search' ? <Search size={16} /> : value === 'history' ? <History size={16} /> : value === 'open' ? <GitPullRequest size={16} /> : <GitMerge size={16} />}{label}</Tabs.Trigger>)}</Tabs.List>
        {Object.keys(TAB_NAMES).map(value => <Tabs.Content key={value} value={value}>
          {value === tab && tab === 'history' ? <SourceHistory repository={repository} path={params.get('path') ?? ''} kind={params.get('path_kind') ?? 'file'} revision={params.get('source_ref') ?? ''} branch={params.get('base') ?? ''} /> : value === tab ? <>
            <form className="repo-filter-form repo-filter-form--compact" onSubmit={event => { event.preventDefault(); submitSearch(); }}>
              <header className="reader-panel-heading repo-panel-heading--compact"><div><p className="reader-eyebrow">REPOSITORY WORKSPACE</p><h1>{tab === 'history' ? "Commit history" : 'Pull requests'}</h1></div><span className="reader-context"><FolderGit2 size={14} />{repository || "Select repository"}</span></header>
              <Collapsible.Root open={filtersOpen} onOpenChange={setFiltersOpen}>
                <Collapsible.Trigger className="repo-filters-toggle">
                  <span>Filters{activeFilterCount ? ` (${activeFilterCount})` : ''}</span>
                  <ChevronDown size={15} />
                </Collapsible.Trigger>
                {/* CR-111: `forceMount` + CSS `[data-state='closed']` keeps `q` (and its `⌘K` target) mounted while collapsed -- see the effects above `return`. */}
                <Collapsible.Content forceMount className="repo-filters-content">
                  <div className="repo-filter-grid">
                    <FieldSelect label="Status" value={tab === 'open' || tab === 'merged' ? tab : draft['state'] ?? ''} disabled={tab !== 'search'} onChange={state => { setDraft(current => ({ ...current, state })); }} options={[{ value: '', label: "All states" }, { value: 'open', label: "Open" }, { value: 'merged', label: "Merged" }, { value: 'closed', label: "Closed" }]} />
                    {field('q', "Title · PR number · commit SHA", "Keywords, #1842, or commit SHA…", undefined, undefined, undefined, qRef)}
                    {tab === 'open' || tab === 'merged' ? <label className="repo-field"><span>Author</span><input value={login} readOnly /></label> : field('author', "Author", "GitHub username")}
                    <FieldSelect label="Label" value={draft['label'] ?? ''} onChange={label => { setDraft(current => ({ ...current, label })); }} options={labelOptions} />
                  </div>
                  <div className="repo-range-filter">
                    <div className="repo-range-row">
                      <FieldSelect label="Range filter" value={rangeType} onChange={value => { setRangeType(value as RangeType); }} options={RANGE_TYPE_OPTIONS} />
                      {rangeType === 'pr' ? <div className="repo-range-fields">{field('pr_from', "PR number from", 'e.g. 1842', 'number', '1')}{field('pr_to', "PR number to", 'e.g. 2044', 'number', '1')}</div> : null}
                      {rangeType === 'mnum' ? <div className="repo-range-fields">{field('mnum_from', "M number from", 'Number only, e.g. 42', 'number', '1', !repository || !draft['base'] ? "Select a repository and base branch to filter by M number." : undefined)}{field('mnum_to', "M number to", 'Number only, e.g. 980', 'number', '1', !repository || !draft['base'] ? "Select a repository and base branch to filter by M number." : undefined)}</div> : null}
                      {rangeType === 'date' ? <div className="repo-range-fields"><DatePicker label="Merged after" value={draft['from'] ?? ''} onChange={from => { setDraft(current => ({ ...current, from })); }} /><DatePicker label="Merged before" value={draft['to'] ?? ''} onChange={to => { setDraft(current => ({ ...current, to })); }} /></div> : null}
                      {rangeType === 'seq' ? <div className="repo-range-fields">
                        <label className="repo-field"><span>Merge order: from commit</span><input value={shaFrom} disabled={!repository || !draft['base']} title={!repository || !draft['base'] ? "Select a repository and base branch to search a merge-order range." : undefined} placeholder="7+ character SHA" onChange={event => { setShaFrom(event.target.value); }} /></label>
                        <label className="repo-field"><span>Merge order: to commit</span><input value={shaTo} disabled={!repository || !draft['base']} title={!repository || !draft['base'] ? "Select a repository and base branch to search a merge-order range." : undefined} placeholder="7+ character SHA" onChange={event => { setShaTo(event.target.value); }} /></label>
                      </div> : null}
                    </div>
                    {activeRangeSummaries.length ? <p className="repo-range-active">{activeRangeSummaries.join(' · ')}</p> : null}
                  </div>
                </Collapsible.Content>
              </Collapsible.Root>
              <div className="repo-filter-footer repo-filter-footer--compact"><Button type="submit" disabled={!repository || loading || resolving}><Search size={15} />{resolving ? "Resolving…" : loading ? "Searching…" : "Search"}<kbd>↵</kbd></Button><Button type="button" variant="secondary" onClick={() => { setShaFrom(''); setShaTo(''); setSeqRange(undefined); setRangeType('pr'); navigate({ q: '', author: '', label: '', state: '', from: '', to: '', path: '', base: '', pr_from: '', pr_to: '', mnum_from: '', mnum_to: '' }); }}>Reset</Button><span className="reader-key-hint"><Command size={13} /> K <span>Quick search</span></span></div>
            </form>
            <div className="repo-results-heading"><span><GitPullRequest size={17} /> {tab === 'history' ? "Commit" : 'Pull requests'} <strong>{loading ? "Loading…" : loadedKey === requestKey && data?.total ? `${data.total.value.toLocaleString("en-US")}${data.total.relation === 'gte' ? '+' : ''} items` : ''}</strong></span><div><span>{sort === 'pr_number' ? "PR" : sort === 'merge_seq' ? "M number" : "Merged at"} {order === 'desc' ? "Descending" : "Ascending"}</span><Button variant="ghost" aria-label="Refresh search" disabled={loading} onClick={() => { setCursor(null); setNonce(n => n + 1); }}><WorkbenchIcon name="refresh" /></Button></div></div>
            {unauthorized ? <p role="alert">Your session has expired. <a href={`${loginPath}?return_to=${encodeURIComponent(`/search?${serialized}`)}`}>Sign in again</a></p> : null}
            {error ? <p role="alert" className="repo-error">{error} <Button variant="secondary" onClick={() => { setCursor(null); setNonce(n => n + 1); }}>Reload first page</Button></p> : null}
            <div className="repo-results-scroll">
            <Table className="repo-table" aria-label={TAB_NAMES[tab]} scrollContainerProps={{ tabIndex: 0 }}>
              <Table.Head><Table.Row><Table.HeaderCell scope="col" aria-sort={sort === 'pr_number' ? order === 'asc' ? 'ascending' : 'descending' : 'none'}><button type="button" onClick={() => { sortBy('pr_number'); }}># {sort === 'pr_number' && order === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />}</button></Table.HeaderCell>
                <Table.HeaderCell scope="col" aria-sort={sort === 'merge_seq' ? order === 'asc' ? 'ascending' : 'descending' : 'none'}><button type="button" onClick={() => { sortBy('merge_seq'); }}>M number {sort === 'merge_seq' && order === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />}</button></Table.HeaderCell>
                <Table.HeaderCell scope="col">Title</Table.HeaderCell><Table.HeaderCell scope="col">Author</Table.HeaderCell><Table.HeaderCell scope="col">Status</Table.HeaderCell>
                <Table.HeaderCell scope="col" aria-sort={sort === 'merged_at' ? order === 'asc' ? 'ascending' : 'descending' : 'none'}><button type="button" onClick={() => { sortBy('merged_at'); }}>Merged at {sort === 'merged_at' && order === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />}</button></Table.HeaderCell><Table.HeaderCell scope="col">Changes</Table.HeaderCell>
                <Table.HeaderCell scope="col"><span className="reader-sr-only">Details</span></Table.HeaderCell>
              </Table.Row></Table.Head><Table.Body>
                {loading && !rows.length ? Array.from({ length: 7 }, (_, index) => <Table.Row key={index}><Table.Cell colSpan={8}><Skeleton label={index === 0 ? "Loading changes" : ''} /></Table.Cell></Table.Row>) : rows.map(row => {
                  const id = `${row.kind}:${row.repository}:${row.pr_number ?? row.commit_sha}:${row.sequence_space}`;
                  const name = row.pr_number ? `#${row.pr_number}` : row.commit_sha?.slice(0, 12) ?? "Commit";
                  const gheHref = gheBaseUrl && row.repository && row.pr_number ? `${gheBaseUrl.replace(/\/$/, '')}/${row.repository}/pull/${row.pr_number}` : null;
                  return <Fragment key={id}><Table.Row data-expanded={expanded === id || undefined} onMouseEnter={() => { setActiveRow(row); }} onFocusCapture={() => { setActiveRow(row); }}>
                    <Table.Cell>{gheHref ? <a className="repo-pr-link" href={gheHref} target="_blank" rel="noreferrer" aria-label={`${name} in GitHub Enterprise`}>{name}</a> : <span className="repo-pr-link">{name}</span>}</Table.Cell>
                    <Table.Cell><span className="repo-mnumber"><MergeNumberBadge fields={row} context={{ kind: row.kind, repository: splitSequenceSpace(row.sequence_space)?.repository ?? row.repository, baseBranch: splitSequenceSpace(row.sequence_space)?.baseBranch ?? null }} /></span></Table.Cell>
                    <Table.Cell><button type="button" className="repo-title-button" onClick={() => { setExpanded(expanded === id ? null : id); }}>{row.title ?? (row.kind === 'commit' ? name : 'Untitled pull request')}</button><small>{row.sequence_space ?? row.repository}</small></Table.Cell>
                    <Table.Cell><span className="reader-author"><span className="reader-avatar">{(row.author ?? '?').slice(0, 2).toUpperCase()}</span>{row.author ?? '—'}</span></Table.Cell><Table.Cell><span className="reader-state" data-state={row.state ?? 'unknown'}>{row.state === 'merged' ? <GitMerge size={13} /> : <GitPullRequest size={13} />}{row.state === 'merged' ? "Merged" : row.state === 'open' ? "Open" : row.state === 'closed' ? "Closed" : '—'}</span></Table.Cell>
                    <Table.Cell><time dateTime={row.merged_at ?? undefined}>{formatTimestamp(row.merged_at)}</time></Table.Cell><Table.Cell><span className="prs-diff-added">{row.additions === null ? '—' : `+${row.additions}`}</span> <span className="repo-deletions">{row.deletions === null ? '' : `−${row.deletions}`}</span></Table.Cell>
                    <Table.Cell><button type="button" className="repo-expand" aria-expanded={expanded === id} aria-label={`${name} Details`} onClick={() => { setExpanded(expanded === id ? null : id); }}><WorkbenchIcon name="chevron" /></button></Table.Cell>
                  </Table.Row>{expanded === id ? <Table.Row><Table.Cell colSpan={8}><WorkspaceDetail row={row} {...(gheBaseUrl ? { gheBaseUrl } : {})} onPath={(path, revision) => { navigate({ path, tab: 'history', path_kind: 'file', source_ref: revision ?? '' }); }} /></Table.Cell></Table.Row> : null}</Fragment>;
                })}
              </Table.Body></Table>
            {!loading && !error && !rows.length ? <div className="repo-empty"><WorkbenchIcon name="search" /><h2>{repository ? "No matching changes" : "No repositories to display"}</h2><p>{repository ? "Adjust your query or filters and search again." : "PRs will appear when an accessible ingested repository is available."}</p></div> : null}
            {nextCursor ? <div className="repo-load-more"><div ref={sentinelRef} aria-hidden="true">{loading ? <Spinner label="Loading more" /> : null}</div><span aria-live="polite">{rows.length.toLocaleString("en-US")} shown</span></div> : null}
            </div>
          </> : null}
        </Tabs.Content>)}
      </Tabs.Root>
    </section>
    {diffTarget ? <DiffModal target={diffTarget} onClose={() => { setDiffTarget(null); }} /> : null}
    {timeOpen && params.get('path') ? <TimeLapseModal repository={repository} path={params.get('path')!} revision={params.get('source_ref') ?? params.get('base') ?? ''} onClose={() => { setTimeOpen(false); }} /> : null}
  </div>;
}
