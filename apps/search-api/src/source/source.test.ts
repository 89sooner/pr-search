import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UnauthenticatedError } from '@prs/authz';
import { GitHubApiError, type GitHubSourceReader } from '@prs/github';
import type { Pool } from '@prs/db';
import type { Client } from '@elastic/elasticsearch';
import type { AccessScope } from '@prs/es';
import type { AuthContext } from '../auth/context.js';
import { authenticateSession } from '../auth/principal.js';
import { resolveRepository } from '../sequence/space.js';
import { recordAuditBestEffort } from '../audit/recorder.js';
import { registerSourceRoutes } from './routes.js';
import { loadPullRequestLinks, sourceComparison, sourceFile, sourceHistory, sourceTree, validPath, validRef } from './service.js';

vi.mock('../auth/principal.js', () => ({ authenticateSession: vi.fn() }));
vi.mock('../sequence/space.js', () => ({ resolveRepository: vi.fn() }));
vi.mock('../audit/recorder.js', () => ({ recordAuditBestEffort: vi.fn() }));
const SHA = 'a'.repeat(40); const PARENT = 'b'.repeat(40); const TREE = 'c'.repeat(40); const repo = { owner: 'acme', repo: 'app' };
function fixture() {
  const methods = {
    repository: vi.fn().mockResolvedValue({ default_branch: 'main' }), branch: vi.fn().mockResolvedValue({ commit: { sha: SHA } }),
    commit: vi.fn().mockResolvedValue({ sha: SHA, tree: { sha: TREE }, parents: [{ sha: PARENT }], message: 'Improve policy', author: { name: 'alice', date: '2026-09-16T00:00:00Z' } }),
    tree: vi.fn().mockResolvedValue({ tree: [{ path: 'src', type: 'tree', mode: '040000', sha: TREE }, { path: 'readme.md', type: 'blob', mode: '100644', sha: SHA, size: 10 }] }),
    content: vi.fn().mockResolvedValue({ type: 'file', size: 7, sha: SHA, encoding: 'base64', content: Buffer.from('secret\n').toString('base64') }),
    history: vi.fn().mockResolvedValue({ body: [{ sha: SHA, parents: [{ sha: PARENT }], author: { login: 'alice' }, commit: { message: 'Improve policy', author: { name: 'Alice', date: '2026-09-16T00:00:00Z' } } }], nextPage: 2 }),
    pullRequest: vi.fn().mockResolvedValue({ number: 7, title: 'Improve policy', body: 'Details', head: { sha: SHA }, base: { sha: PARENT } }),
    mergeBase: vi.fn().mockResolvedValue({ merge_base_commit: { sha: PARENT } }),
    changes: vi.fn().mockResolvedValue({ body: [{ filename: 'src/new.ts', previous_filename: 'src/old.ts', status: 'renamed', additions: 2, deletions: 1 }], nextPage: null }),
    pullRequestsForCommit: vi.fn().mockResolvedValue([]),
  };
  return { methods, reader: methods as unknown as GitHubSourceReader };
}
describe('FR-SRC source data handling', () => {
  it('uses committed time rather than authored time in history', async () => {
    const { methods, reader } = fixture();
    methods.history.mockResolvedValue({ body: [{ sha: SHA, parents: [], commit: { message: 'Rebased change', author: { name: 'Alice', date: '2026-09-01T00:00:00Z' }, committer: { date: '2026-09-17T00:00:00Z' } } }], nextPage: null });
    expect((await sourceHistory(reader, repo, { ref: SHA, path: 'src', page: 1 })).commits[0]?.date).toBe('2026-09-17T00:00:00Z');
  });
  it('compares a root commit to an empty tree even when PR associations fail', async () => {
    const { methods, reader } = fixture();
    methods.commit.mockResolvedValue({ sha: SHA, parents: [], tree: { sha: TREE }, message: 'Initial commit', author: { name: 'Alice' } });
    methods.changes.mockResolvedValue({ body: { files: [{ filename: 'new.ts', status: 'added', additions: 1, deletions: 0 }] }, nextPage: null });
    methods.pullRequestsForCommit.mockRejectedValue(new Error('Unavailable'));
    const result = await sourceComparison(reader, repo, { commit: SHA, page: 1 });
    expect(result.base).toBeNull(); expect(result.files[0]?.status).toBe('added'); expect(result.pull_requests_unavailable).toBe(true);
  });
  it('does not preview LFS, non-files, or files beyond the line budget', async () => {
    const { methods, reader } = fixture();
    for (const [text, expected] of [['version https://git-lfs.github.com/spec/v1\n', 'unsupported'], ['line\n'.repeat(4001), 'too_large']]) {
      methods.content.mockResolvedValueOnce({ type: 'file', size: text!.length, encoding: 'base64', content: Buffer.from(text!).toString('base64') });
      expect((await sourceFile(reader, repo, SHA, 'a')).status).toBe(expected);
    }
    methods.content.mockResolvedValueOnce({ type: 'submodule' });
    expect((await sourceFile(reader, repo, SHA, 'module')).status).toBe('unsupported');
  });
  it('pins default branch and lazily reads a non-recursive Git tree', async () => { const { methods, reader } = fixture(); const root = await sourceTree(reader, repo, { ref: '', path: '' }); expect(root.revision).toBe(SHA); expect(root.entries.map(entry => entry.kind)).toEqual(['directory', 'file']); expect(methods.tree).toHaveBeenCalledWith(repo, TREE); });
  it('history pins sha, forwards selected path and preserves upstream pagination', async () => { const { methods, reader } = fixture(); const result = await sourceHistory(reader, repo, { ref: SHA, path: 'src', page: 2 }); expect(methods.history).toHaveBeenCalledWith(repo, SHA, 'src', 2); expect(methods.branch).not.toHaveBeenCalled(); expect(result.next_page).toBe(2); });
  it('returns text but never treats binary, oversize, or invalid UTF8 as source text', async () => { const { methods, reader } = fixture(); expect((await sourceFile(reader, repo, SHA, 'src/a')).text).toBe('secret\n'); methods.content.mockResolvedValueOnce({ type: 'file', size: 9999999 }); expect((await sourceFile(reader, repo, SHA, 'a')).status).toBe('too_large'); methods.content.mockResolvedValueOnce({ type: 'file', size: 2, encoding: 'base64', content: Buffer.from([0, 1]).toString('base64') }); expect((await sourceFile(reader, repo, SHA, 'a')).status).toBe('binary'); methods.content.mockResolvedValueOnce({ type: 'file', size: 1, encoding: 'base64', content: '/w==' }); expect((await sourceFile(reader, repo, SHA, 'a')).status).toBe('binary'); });
  it('reports an absent path only after validating that the revision exists', async () => { const { methods, reader } = fixture(); methods.content.mockRejectedValue(new GitHubApiError('not_found', 'missing')); expect((await sourceFile(reader, repo, SHA, 'gone')).status).toBe('missing'); expect(methods.commit).toHaveBeenCalledWith(repo, SHA); methods.commit.mockRejectedValue(new GitHubApiError('not_found', 'revision missing')); await expect(sourceFile(reader, repo, SHA, 'gone')).rejects.toThrow(); });
  it('rejects a PR that moves while its file list is loaded', async () => { const { methods, reader } = fixture(); methods.pullRequest.mockResolvedValueOnce({ number: 7, title: 'PR', body: '', head: { sha: SHA }, base: { sha: PARENT } }).mockResolvedValueOnce({ number: 7, title: 'PR', body: '', head: { sha: TREE }, base: { sha: PARENT } }); await expect(sourceComparison(reader, repo, { pr: 7, page: 1 })).rejects.toThrow('Pull request changed'); });
  it('compares PRs to merge-base and preserves rename evidence', async () => { const { reader } = fixture(); const result = await sourceComparison(reader, repo, { pr: 7, page: 1 }); expect(result.base).toBe(PARENT); expect(result.files[0]?.previous_path).toBe('src/old.ts'); });
  it('validates repository-relative paths and references without restricting Unicode filenames', () => { expect(validPath('src/결제 파일.ts')).toBe(true); for (const path of ['../a', '/a', 'a/../b', 'a\\b', 'a\u0000b']) expect(validPath(path)).toBe(false); expect(validRef('feature/payments')).toBe(true); expect(validRef('main~1')).toBe(false); });
});

/** ES 클라이언트 자리를 대신하는 스텁. 진짜 applyMandatoryScopeFilter를 그대로 지나게 한다. */
function esFixture(hits: { commit_sha: string; pull_request_numbers?: number[] }[]) {
  const search = vi.fn().mockResolvedValue({ hits: { hits: hits.map(source => ({ _source: source })) }, _shards: { failed: 0, total: 1 } });
  return { search, es: { search } as unknown as Client };
}
const SCOPE: AccessScope = { kind: 'explicit', repositoryIds: [1] };

describe('CR-107 loadPullRequestLinks batch PR-link lookup (FR-SRC-002 AC-1)', () => {
  it('queries once for the whole page; confirmed links are deduped and sorted ascending', async () => {
    const { search, es } = esFixture([{ commit_sha: SHA, pull_request_numbers: [30, 10, 10, 20] }]);
    const result = await loadPullRequestLinks(es, 'acme/app', [SHA, PARENT], SCOPE);
    expect(search).toHaveBeenCalledTimes(1);
    expect(result.get(SHA)).toEqual([10, 20, 30]);
    expect(result.has(PARENT)).toBe(false); // no hit -> undetermined, no key at all (CR-016/017)
  });

  it('does not call Elasticsearch for an empty SHA list', async () => {
    const { search, es } = esFixture([]);
    const result = await loadPullRequestLinks(es, 'acme/app', [], SCOPE);
    expect(search).not.toHaveBeenCalled();
    expect(result.size).toBe(0);
  });

  it('a hit whose document has no pull_request_numbers field gets no key — never a false null', async () => {
    const { es } = esFixture([{ commit_sha: SHA }]);
    const result = await loadPullRequestLinks(es, 'acme/app', [SHA], SCOPE);
    expect(result.has(SHA)).toBe(false);
  });

  it('an empty array (direct_push-like) is preserved as a confirmed "no links"', async () => {
    const { es } = esFixture([{ commit_sha: SHA, pull_request_numbers: [] }]);
    const result = await loadPullRequestLinks(es, 'acme/app', [SHA], SCOPE);
    expect(result.get(SHA)).toEqual([]);
  });

  it('matches regardless of SHA case and scopes the query by repository and mandatory access scope', async () => {
    const { search, es } = esFixture([{ commit_sha: SHA, pull_request_numbers: [1] }]);
    await loadPullRequestLinks(es, 'acme/app', [SHA.toUpperCase()], SCOPE);
    const call = search.mock.calls[0]?.[0] as { index: string; query: unknown; _source: string[] };
    expect(call.index).toBe('prs-commits');
    expect(call._source).toEqual(['commit_sha', 'pull_request_numbers']);
    const serialized = JSON.stringify(call.query);
    expect(serialized).toContain('acme/app');
    expect(serialized).toContain(SHA);
    expect(serialized).toContain('repository_id'); // applyMandatoryScopeFilter actually ran
  });
});

describe('CR-107 sourceHistory PR-link branches (FR-SRC-002 AC-1)', () => {
  it('without a links argument, every row is undetermined and the response is marked unavailable', async () => {
    const { reader } = fixture();
    const result = await sourceHistory(reader, repo, { ref: SHA, path: 'src', page: 1 });
    expect(result.commits).toHaveLength(1);
    expect(result.commits.every(commit => commit.pull_request_numbers === null)).toBe(true);
    expect(result.pull_requests_unavailable).toBe(true);
  });

  it('with links, confirmed/empty/undetermined rows are distinguished from a single page-wide query', async () => {
    const { methods, reader } = fixture();
    methods.history.mockResolvedValue({
      body: [
        { sha: SHA, parents: [{ sha: PARENT }], author: { login: 'alice' }, commit: { message: 'confirmed', author: { name: 'Alice', date: '2026-09-16T00:00:00Z' } } },
        { sha: PARENT, parents: [], author: { login: 'bob' }, commit: { message: 'direct push', author: { name: 'Bob', date: '2026-09-15T00:00:00Z' } } },
        { sha: TREE, parents: [], author: { login: 'carol' }, commit: { message: 'pending', author: { name: 'Carol', date: '2026-09-14T00:00:00Z' } } },
      ],
      nextPage: null,
    });
    const { search, es } = esFixture([
      { commit_sha: SHA, pull_request_numbers: [7] },
      { commit_sha: PARENT, pull_request_numbers: [] },
      // TREE has no hit at all -> undetermined.
    ]);
    const result = await sourceHistory(reader, repo, { ref: SHA, path: 'src', page: 1 }, { es, scope: SCOPE });
    expect(search).toHaveBeenCalledTimes(1); // N+1 guard: one call covers the whole page
    expect(result.pull_requests_unavailable).toBeUndefined(); // success omits the key entirely
    expect(result.commits.find(commit => commit.sha === SHA)?.pull_request_numbers).toEqual([7]);
    expect(result.commits.find(commit => commit.sha === PARENT)?.pull_request_numbers).toEqual([]);
    expect(result.commits.find(commit => commit.sha === TREE)?.pull_request_numbers).toBeNull();
  });

  it('when the batch lookup throws, History body is preserved and the response is marked unavailable, never rejected', async () => {
    const { reader } = fixture();
    const es = { search: vi.fn().mockRejectedValue(new Error('es down')) } as unknown as Client;
    const result = await sourceHistory(reader, repo, { ref: SHA, path: 'src', page: 1 }, { es, scope: SCOPE });
    expect(result.commits).toHaveLength(1);
    expect(result.commits.every(commit => commit.pull_request_numbers === null)).toBe(true);
    expect(result.pull_requests_unavailable).toBe(true);
  });

  it('an empty access scope makes applyMandatoryScopeFilter throw, and History still answers unavailable, not an error', async () => {
    const { reader } = fixture();
    const { es } = esFixture([{ commit_sha: SHA, pull_request_numbers: [1] }]);
    const result = await sourceHistory(reader, repo, { ref: SHA, path: 'src', page: 1 }, { es, scope: { kind: 'explicit', repositoryIds: [] } });
    expect(result.commits.every(commit => commit.pull_request_numbers === null)).toBe(true);
    expect(result.pull_requests_unavailable).toBe(true);
  });

  it('a page with zero commits never calls Elasticsearch and is not marked unavailable', async () => {
    const { methods, reader } = fixture();
    methods.history.mockResolvedValue({ body: [], nextPage: null });
    const { search, es } = esFixture([]);
    const result = await sourceHistory(reader, repo, { ref: SHA, path: 'src', page: 1 }, { es, scope: SCOPE });
    expect(search).not.toHaveBeenCalled();
    expect(result.commits).toEqual([]);
    expect(result.pull_requests_unavailable).toBeUndefined();
  });
});

describe('FR-SRC session, scope, cache and audit boundary', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.mocked(authenticateSession).mockResolvedValue({ userId: 'user-1' } as Awaited<ReturnType<typeof authenticateSession>>); vi.mocked(resolveRepository).mockResolvedValue({ kind: 'ok', repository: {} } as Awaited<ReturnType<typeof resolveRepository>>); });
  async function request(url: string) { const { methods, reader } = fixture(); const readerFactory = vi.fn(() => reader); const scope = { kind: 'explicit', repositoryIds: [1] }; const scopes = { resolve: vi.fn().mockResolvedValue(scope) }; const app = Fastify(); registerSourceRoutes(app, { pool: {} as Pool, auth: { sessions: {}, scopes } as unknown as AuthContext, loginPath: '/auth/login', reader: readerFactory }); const response = await app.inject({ method: 'GET', url }); await app.close(); return { response, methods, readerFactory, scopes, scope }; }
  it('never reads GitHub without a session', async () => { vi.mocked(authenticateSession).mockRejectedValue(new UnauthenticatedError('missing')); const { response, readerFactory } = await request(`/api/v1/source/acme%2Fapp/file?revision=${SHA}&path=a`); expect(response.statusCode).toBe(401); expect(readerFactory).not.toHaveBeenCalled(); });
  it.each(['forbidden', 'not_found'] as const)('returns the same 404 for %s before acquiring the source reader', async kind => { vi.mocked(resolveRepository).mockResolvedValue({ kind, message: 'do not expose' }); const { response, readerFactory } = await request('/api/v1/source/acme%2Fapp/tree'); expect(response.statusCode).toBe(404); expect(response.json().error.message).toBe('Repository not found.'); expect(readerFactory).not.toHaveBeenCalled(); });
  it('rejects invalid path/ref arguments without touching GitHub', async () => { const { response, methods } = await request(`/api/v1/source/acme%2Fapp/file?revision=${SHA}&path=../private`); expect(response.statusCode).toBe(400); expect(methods.content).not.toHaveBeenCalled(); });
  it('returns no-store and audits metadata without source text', async () => { const { response, scopes, scope } = await request(`/api/v1/source/acme%2Fapp/file?revision=${SHA}&path=src/a.ts`); expect(response.statusCode).toBe(200); expect(response.json().text).toBe('secret\n'); expect(response.headers['cache-control']).toContain('no-store'); expect(scopes.resolve).toHaveBeenCalledWith('user-1'); expect(resolveRepository).toHaveBeenCalledWith({}, { owner: 'acme', name: 'app' }, scope); expect(recordAuditBestEffort).toHaveBeenCalled(); expect(JSON.stringify(vi.mocked(recordAuditBestEffort).mock.calls)).not.toContain('secret'); });
});
