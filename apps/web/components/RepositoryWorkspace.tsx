'use client';

/** WP-082 / CR-094: repository-first search, with persistent URL filters. */
import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button, Skeleton, Table, Tabs } from '@conductor-by-89soone/react';
import { WorkbenchIcon } from './WorkbenchIcon';
import type { RepositoryOverview } from '../lib/repository-overview';
import type { ResultRow } from './ResultTable';
import { formatTimestamp } from '../lib/format';
import { detectIdentifier, parseQuery } from '@prs/query';
import type { ResolutionCandidate } from './ResolutionCandidateList';

interface SearchData { items: ResultRow[]; total?: { value: number; relation: string }; next_cursor?: string | null }
interface DetailData { body?: string; message?: string; changed_paths?: string[]; files_truncated?: boolean; changed_paths_truncated?: boolean; source_commits?: { commit_sha: string }[]; merge_commit_sha?: string | null; base_branch?: string; head_branch?: string }
const TAB_NAMES = { search: '검색', history: '커밋 이력', open: '내 열린 PR', merged: '내 머지 PR' } as const;
type WorkspaceTab = keyof typeof TAB_NAMES;
const quote = (value: string): string => JSON.stringify(value);

export function WorkspaceDetail({ row, gheBaseUrl, onPath }: { row: ResultRow; gheBaseUrl?: string; onPath?: (path: string) => void }): ReactNode {
  const [detail, setDetail] = useState<DetailData | null>(null);
  const [error, setError] = useState('');
  const [nonce, setNonce] = useState(0);
  const [copied, setCopied] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    setDetail(null); setError('');
    const route = row.kind === 'pull_request' ? 'pull-requests' : 'commits';
    void fetch(`/api/${route}/${encodeURIComponent(row.repository ?? '')}/${row.pr_number ?? row.commit_sha ?? ''}`, { signal: controller.signal, cache: 'no-store' })
      .then(async response => { if (!response.ok) throw new Error('상세 정보를 불러오지 못했습니다.'); return response.json() as Promise<DetailData>; })
      .then(data => { if (!controller.signal.aborted) setDetail(data); })
      .catch(() => { if (!controller.signal.aborted) setError('상세 정보를 불러오지 못했습니다.'); });
    return () => { controller.abort(); };
  }, [row.repository, row.pr_number, row.commit_sha, row.kind, nonce]);
  const origin = gheBaseUrl?.replace(/\/$/, '');
  const source = origin && row.repository ? `${origin}/${row.repository}/${row.kind === 'pull_request' ? `pull/${row.pr_number}` : `commit/${row.commit_sha}`}` : null;
  return <div className="repo-detail">
    {error ? <p role="alert">{error} <Button variant="ghost" onClick={() => { setNonce(n => n + 1); }}>다시 시도</Button></p> : detail === null ? <Skeleton label="상세 정보 불러오는 중" /> : <>
      <div className="repo-detail-heading"><strong>{detail.head_branch ? `${detail.head_branch} → ${detail.base_branch ?? ''}` : '변경 상세'}</strong>
        {source ? <a href={source} target="_blank" rel="noreferrer">GHE에서 보기 <WorkbenchIcon name="external" /></a> : null}
        {source ? <a href={`${source}${row.kind === 'pull_request' ? '/files' : ''}`} target="_blank" rel="noreferrer">Diff 열기 <WorkbenchIcon name="external" /></a> : null}
      </div>
      {detail.body || detail.message ? <p className="repo-description">{detail.body ?? detail.message}</p> : <p className="repo-muted">등록된 설명이 없습니다.</p>}
      <div className="repo-detail-columns"><section><h3>변경 파일</h3>
        {detail.changed_paths === undefined ? <p className="repo-muted">파일 목록을 아직 수집하지 않았습니다.</p> : detail.changed_paths.length === 0 ? <p className="repo-muted">변경 파일이 없습니다.</p> :
          <ul className="repo-file-list">{detail.changed_paths.map(path => <li key={path}><WorkbenchIcon name="file" /><button type="button" onClick={() => { onPath?.(path); }} disabled={!onPath}>{path}</button></li>)}</ul>}
        {detail.files_truncated || detail.changed_paths_truncated ? <p className="repo-muted">일부 파일만 표시됩니다. 전체 변경은 GHE에서 확인하세요.</p> : null}
      </section><section><h3>커밋</h3><div className="repo-commit-list">
        {[...(detail.merge_commit_sha ? [{ commit_sha: detail.merge_commit_sha }] : []), ...(detail.source_commits ?? [])].map((commit, index) =>
          <button key={`${commit.commit_sha}-${index}`} type="button" title="SHA 복사" onClick={() => { void navigator.clipboard.writeText(commit.commit_sha).then(() => { setCopied('SHA를 복사했습니다.'); }).catch(() => { setCopied('복사할 수 없습니다. SHA를 직접 선택해 복사하세요.'); }); }}>{commit.commit_sha}</button>)}
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
  const [repoFind, setRepoFind] = useState('');
  const repository = params.get('repository') ?? repositories[0]?.repository ?? '';
  const selected = repositories.find(repo => repo.repository === repository);
  const tab: WorkspaceTab = params.get('tab') === 'history' ? 'history' : params.get('tab') === 'open' ? 'open' : params.get('tab') === 'merged' ? 'merged' : 'search';
  const [draft, setDraft] = useState<Record<string, string>>({});
  useEffect(() => { setDraft(Object.fromEntries(new URLSearchParams(serialized))); }, [serialized]);
  function navigate(changes: Record<string, string>): void {
    const next = new URLSearchParams(serialized);
    next.delete('legacy');
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
          if (response.status === 401) { setUnauthorized(true); throw new Error('로그인이 필요합니다.'); }
          if (!response.ok) throw new Error('저장소를 불러오지 못했습니다.');
          const body = await response.json() as { items: RepositoryOverview[]; next_cursor?: string | null };
          if (controller.signal.aborted) return;
          setRepositories(current => [...(repoNext ? current : []), ...body.items].filter((repo, index, all) => all.findIndex(item => item.repository_id === repo.repository_id) === index));
          next = body.next_cursor ?? null;
          setRepositoryCursor(next);
          if (body.items.length || !next) break;
        }
      } catch (reason) { if (!controller.signal.aborted) setRepositoryError(reason instanceof Error ? reason.message : '저장소 조회 실패'); }
      finally { if (!controller.signal.aborted) setRepositoryLoading(false); }
    })();
    return () => { controller.abort(); };
  }, [repoNonce, repoNext]);
  const query = useMemo(() => {
    const values = new URLSearchParams(serialized);
    const filters = [`kind:${tab === 'history' ? 'commit' : 'pull_request'}`, `repo:${quote(repository)}`];
    for (const key of ['base', 'author', 'label', 'path', 'state']) {
      const value = values.get(key);
      if (value && !(key === 'state' && (tab === 'open' || tab === 'merged')) && !(key === 'author' && (tab === 'open' || tab === 'merged'))) filters.push(`${key}:${quote(value)}`);
    }
    if (tab === 'open' || tab === 'merged') { filters.push(`author:${quote(login)}`, `state:${tab === 'open' ? 'open' : 'merged'}`); }
    const from = values.get('from'); const to = values.get('to');
    if (from && to) filters.push(`merged:${from}..${to}`);
    const text = values.get('q')?.trim();
    if (text) filters.push(text);
    return filters.join(' ');
  }, [serialized, repository, tab, login]);
  const sort = params.get('sort') ?? (tab === 'history' ? 'merge_seq' : 'merged_at');
  const order = params.get('order') === 'asc' ? 'asc' : 'desc';
  const requestKey = `${query}|${sort}|${order}`;
  const [loadedKey, setLoadedKey] = useState('');
  useEffect(() => { setCursor(null); setExpanded(null); }, [requestKey]);
  useEffect(() => {
    if (!repository || ((tab === 'open' || tab === 'merged') && !login)) { setLoading(false); return; }
    const controller = new AbortController();
    setLoading(true); setError('');
    const currentParams = new URLSearchParams(serialized);
    if (Boolean(currentParams.get('from')) !== Boolean(currentParams.get('to'))) {
      setError('머지 시작일과 종료일을 모두 입력해 주세요.'); setLoading(false); return;
    }
    try { parseQuery(query); } catch (reason) { setError(reason instanceof Error ? reason.message : '검색 조건을 확인해 주세요.'); setLoading(false); return; }
    const continuation = loadedKey === requestKey ? cursor : null;
    const search = new URLSearchParams({ q: query, sort, order, size: '50' });
    if (continuation) search.set('cursor', continuation);
    const raw = currentParams.get('q')?.trim() ?? '';
    const detected = detectIdentifier(raw, gheBaseUrl ? { gheBaseUrl } : {});
    const identifier = raw !== '' && detected.interpretations.some(item => item.kind === 'commit' || item.kind === 'pull_request');
    const target = identifier ? `/api/resolve?${new URLSearchParams({ q: raw.startsWith('#') ? `${repository}${raw}` : raw, limit: '50' })}` : `/api/search?${search.toString()}`;
    void fetch(target, { signal: controller.signal, cache: 'no-store' })
      .then(async response => {
        if (response.status === 401) setUnauthorized(true);
        const body = await response.json() as SearchData & { error?: { message?: string }; candidates?: ResolutionCandidate[]; truncated?: boolean; epoch_stale?: boolean };
        if (!response.ok) throw new Error(body.error?.message ?? '검색 결과를 불러오지 못했습니다.');
        if (body.epoch_stale) throw new Error('시퀀스 세대가 변경되었습니다. 조건을 확인한 뒤 다시 조회하세요.');
        if (identifier) return { items: (body.candidates ?? []).map(candidate => ({ ...candidate, title: candidate.display_name, author: candidate.author ?? null, state: candidate.state ?? null, merged_at: null, changed_files_count: null, additions: null, deletions: null })), total: { value: body.candidates?.length ?? 0, relation: body.truncated ? 'gte' : 'eq' } };
        return body;
      }).then(body => {
        if (controller.signal.aborted) return;
        setData(previous => ({ ...body, items: continuation ? [...(previous?.items ?? []), ...body.items] : body.items }));
        setLoadedKey(requestKey);
      }).catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '검색 실패'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => { controller.abort(); };
    // loadedKey determines whether a cursor belongs to this request; it is not a fetch trigger.
  }, [requestKey, cursor, nonce, repository, login, gheBaseUrl]);
  const rows = loadedKey === requestKey ? data?.items ?? [] : [];
  function field(key: string, label: string, placeholder = '', type = 'text'): ReactNode {
    return <label className="repo-field"><span>{label}</span><input type={type} value={draft[key] ?? ''} placeholder={placeholder} onChange={event => { setDraft(current => ({ ...current, [key]: event.target.value })); }} /></label>;
  }
  function sortBy(fieldName: string): void { navigate({ sort: fieldName, order: sort === fieldName && order === 'desc' ? 'asc' : 'desc' }); }
  return <div className="repo-workspace">
    <aside className="repo-sidebar" aria-label="저장소 탐색">
      <div className="repo-sidebar-heading"><WorkbenchIcon name="repository" /><h2>저장소 탐색</h2></div>
      <label className="repo-field"><span>저장소 찾기</span><input type="search" placeholder="이름으로 검색…" value={repoFind} onChange={event => { setRepoFind(event.target.value); }} /></label>
      <div className="repo-repositories">{repositories.filter(repo => repo.repository.toLowerCase().includes(repoFind.toLowerCase())).map(repo =>
        <button type="button" key={repo.repository_id} aria-pressed={repository === repo.repository} onClick={() => { navigate({ repository: repo.repository, base: '', path: '' }); }}><WorkbenchIcon name="repository" /><span>{repo.repository}</span><WorkbenchIcon name="chevron" /></button>)}
        {repositoryLoading ? <Skeleton label="저장소 불러오는 중" /> : null}
        {repositoryError ? <p role="alert">{repositoryError} <Button variant="ghost" onClick={() => { setRepoNonce(n => n + 1); }}>다시 시도</Button></p> : null}
        {repositoryCursor ? <Button variant="ghost" disabled={repositoryLoading} onClick={() => { setRepoNext(repositoryCursor); }}>저장소 더 보기</Button> : null}
        {!repositoryLoading && !repositoryError && !repositories.length ? <p className="repo-muted">조회 가능한 저장소가 없습니다.</p> : null}
      </div>
      <div className="repo-sidebar-heading"><WorkbenchIcon name="branch" /><h2>브랜치</h2></div>
      <label className="repo-field"><span>대상 브랜치</span><input list="repo-branches" placeholder="모든 브랜치" value={draft['base'] ?? ''} onChange={event => { setDraft(current => ({ ...current, base: event.target.value })); }} onBlur={() => { if ((draft['base'] ?? '') !== (params.get('base') ?? '')) navigate({ base: draft['base'] ?? '' }); }} onKeyDown={event => { if (event.key === 'Enter') navigate({ base: draft['base'] ?? '' }); }} /></label>
      <datalist id="repo-branches">{selected?.sequence_spaces.map(space => <option key={space.base_branch} value={space.base_branch} />)}</datalist>
      <form onSubmit={event => { event.preventDefault(); navigate({ path: draft['path'] ?? '', tab: 'history' }); }}>
        {field('path', '파일·경로 찾기', 'src/components/…')}
        <Button type="submit" variant="secondary" disabled={!repository}><WorkbenchIcon name="history" /> 경로 이력 보기</Button>
      </form>
      <p className="repo-sidebar-note">파일을 변경한 PR과 커밋을 함께 탐색하세요. 상세의 파일을 선택하면 해당 경로의 이력으로 이동합니다.</p>
    </aside>
    <section className="repo-main" aria-label="저장소 작업 공간">
      <header className="repo-heading"><div><p className="prs-eyebrow">REPOSITORY WORKSPACE</p><h1>{repository || '통합 검색'}</h1><p>변경의 맥락을 찾는 가장 빠른 방법</p></div><Button variant="ghost" aria-label="검색 새로고침" onClick={() => { setCursor(null); setNonce(n => n + 1); }}><WorkbenchIcon name="refresh" /></Button></header>
      <Tabs.Root value={tab} onValueChange={value => { navigate({ tab: value, state: '', author: '' }); }} activationMode="automatic">
        <Tabs.List aria-label="탐색 방식">{Object.entries(TAB_NAMES).map(([value, label]) => <Tabs.Trigger key={value} value={value}>{label}</Tabs.Trigger>)}</Tabs.List>
        {Object.keys(TAB_NAMES).map(value => <Tabs.Content key={value} value={value}>
          {value === tab ? <>
            <form className="repo-filter-form" onSubmit={event => { event.preventDefault(); navigate(Object.fromEntries(['q', 'author', 'label', 'state', 'from', 'to', 'path', 'base'].map(key => [key, draft[key] ?? '']))); }}>
              <div className="repo-query-row">{field('q', '검색어', '제목, 본문 또는 검색 조건 입력…')}<Button type="submit" disabled={!repository}><WorkbenchIcon name="search" /> 검색</Button></div>
              <div className="repo-filter-grid">
                {tab === 'open' || tab === 'merged' ? <label className="repo-field"><span>작성자</span><input value={login} readOnly /></label> : field('author', '작성자', 'GitHub 사용자명')}
                {field('label', '라벨', '모든 라벨')}
                <label className="repo-field"><span>상태</span><select value={tab === 'open' || tab === 'merged' ? tab : draft['state'] ?? ''} disabled={tab !== 'search'} onChange={event => { setDraft(current => ({ ...current, state: event.target.value })); }}><option value="">전체</option><option value="open">열림</option><option value="merged">머지됨</option><option value="closed">닫힘</option></select></label>
                {field('from', '머지 시작일', '', 'date')}{field('to', '머지 종료일', '', 'date')}
              </div>
              <div className="repo-filter-footer"><span>조건을 조합해 필요한 변경만 확인하세요.</span><Button type="button" variant="ghost" size="sm" onClick={() => { navigate({ q: '', author: '', label: '', state: '', from: '', to: '', path: '', base: '' }); }}>필터 초기화</Button></div>
            </form>
            <div className="repo-results-heading"><span><WorkbenchIcon name="pr" /> {TAB_NAMES[tab]} <strong>{loading ? '조회 중…' : loadedKey === requestKey && data?.total ? `${data.total.value.toLocaleString('ko-KR')}${data.total.relation === 'gte' ? '+' : ''}건` : ''}</strong></span><span>머지 순서는 저장소 · 브랜치 기준</span></div>
            {unauthorized ? <p role="alert">세션이 만료되었습니다. <a href={`${loginPath}?return_to=${encodeURIComponent(`/search?${serialized}`)}`}>다시 로그인</a></p> : null}
            {error ? <p role="alert" className="repo-error">{error} <Button variant="secondary" onClick={() => { setCursor(null); setNonce(n => n + 1); }}>첫 페이지 다시 조회</Button></p> : null}
            <Table className="repo-table" aria-label={TAB_NAMES[tab]} scrollContainerProps={{ tabIndex: 0 }}>
              <Table.Head><Table.Row><Table.HeaderCell scope="col"><span className="cdt-sr-only">상세</span></Table.HeaderCell>
                <Table.HeaderCell scope="col" aria-sort={sort === 'merge_seq' ? order === 'asc' ? 'ascending' : 'descending' : 'none'}><button type="button" onClick={() => { sortBy('merge_seq'); }}>시퀀스 ↕</button></Table.HeaderCell>
                <Table.HeaderCell scope="col">PR / 변경 내용</Table.HeaderCell><Table.HeaderCell scope="col">작성자</Table.HeaderCell><Table.HeaderCell scope="col">상태</Table.HeaderCell>
                <Table.HeaderCell scope="col" aria-sort={sort === 'merged_at' ? order === 'asc' ? 'ascending' : 'descending' : 'none'}><button type="button" onClick={() => { sortBy('merged_at'); }}>머지 시각 ↕</button></Table.HeaderCell><Table.HeaderCell scope="col">변경</Table.HeaderCell>
              </Table.Row></Table.Head><Table.Body>
                {loading && !rows.length ? Array.from({ length: 7 }, (_, index) => <Table.Row key={index}><Table.Cell colSpan={7}><Skeleton label={index === 0 ? '변경 목록 불러오는 중' : ''} /></Table.Cell></Table.Row>) : rows.map(row => {
                  const id = `${row.kind}:${row.repository}:${row.pr_number ?? row.commit_sha}:${row.sequence_space}`;
                  const name = row.pr_number ? `#${row.pr_number}` : row.commit_sha?.slice(0, 12) ?? '커밋';
                  return <Fragment key={id}><Table.Row data-expanded={expanded === id || undefined}>
                    <Table.Cell><button type="button" className="repo-expand" aria-expanded={expanded === id} aria-label={`${name} 상세`} onClick={() => { setExpanded(expanded === id ? null : id); }}><WorkbenchIcon name="chevron" /></button></Table.Cell>
                    <Table.Cell><span className="repo-sequence" title={row.sequence_space ?? ''}>{row.merge_seq ?? '—'}</span></Table.Cell>
                    <Table.Cell><button type="button" className="repo-title-button" onClick={() => { setExpanded(expanded === id ? null : id); }}><span className="repo-pr-number">{name}</span>{row.title ?? name}</button><small>{row.sequence_space ?? row.repository}</small></Table.Cell>
                    <Table.Cell>{row.author ?? '—'}</Table.Cell><Table.Cell><span className="prs-result-state" data-state={row.state ?? 'unknown'}>{row.state === 'merged' ? '머지됨' : row.state === 'open' ? '열림' : row.state === 'closed' ? '닫힘' : '—'}</span></Table.Cell>
                    <Table.Cell><time dateTime={row.merged_at ?? undefined}>{formatTimestamp(row.merged_at)}</time></Table.Cell><Table.Cell><span className="prs-diff-added">{row.additions === null ? '—' : `+${row.additions}`}</span> <span className="repo-deletions">{row.deletions === null ? '' : `−${row.deletions}`}</span></Table.Cell>
                  </Table.Row>{expanded === id ? <Table.Row><Table.Cell colSpan={7}><WorkspaceDetail row={row} {...(gheBaseUrl ? { gheBaseUrl } : {})} onPath={path => { navigate({ path, tab: 'history' }); }} /></Table.Cell></Table.Row> : null}</Fragment>;
                })}
              </Table.Body></Table>
            {!loading && !error && !rows.length ? <div className="repo-empty"><WorkbenchIcon name="search" /><h2>{repository ? '조건에 맞는 변경이 없습니다' : '표시할 저장소가 없습니다'}</h2><p>{repository ? '검색어나 필터를 조정해 다시 검색하세요.' : '접근 가능한 수집 저장소가 준비되면 PR 목록이 바로 표시됩니다.'}</p></div> : null}
            {loadedKey === requestKey && data?.next_cursor ? <div className="repo-load-more"><Button variant="secondary" disabled={loading} onClick={() => { setCursor(data.next_cursor ?? null); }}>변경 더 보기</Button><span>{rows.length.toLocaleString('ko-KR')}건 표시</span></div> : null}
          </> : null}
        </Tabs.Content>)}
      </Tabs.Root>
    </section>
  </div>;
}
