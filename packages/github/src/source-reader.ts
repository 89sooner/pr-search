import type { RepoRef } from './client.js';
import type { GitHubTransport, PageResponse } from './transport.js';

/** Read-only, request-scoped source APIs; callers must authorize the repository first. */
export interface SourceGitCommit { sha: string; tree: { sha: string }; parents: { sha: string }[]; message: string; author: { name: string; date: string }; committer?: { date: string } }
export interface SourceRestCommit { sha: string; parents: { sha: string }[]; author: { login: string } | null; commit: { message: string; author: { name: string; date: string } | null; committer?: { date: string } | null }; files?: SourceRestFile[] }
export interface SourceRestFile { filename: string; previous_filename?: string; status: string; additions: number; deletions: number }
export interface SourceContent { type: string; size: number; sha: string; encoding?: string; content?: string }
export interface SourceGitTree { sha: string; truncated?: boolean; tree: { path: string; sha: string; type: string; mode: string; size?: number }[] }
export interface SourcePr { number: number; title: string; body: string | null; base: { sha: string }; head: { sha: string } }
export class GitHubSourceReader {
  constructor(private readonly transport: GitHubTransport) {}
  private prefix(ref: RepoRef): string { return `/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}`; }
  private get<T>(ref: RepoRef, path: string, query?: Record<string, string | number>) { return this.transport.get<T>({ org: ref.owner, path: this.prefix(ref) + path, priority: 'realtime', ...(query ? { query } : {}) }); }
  repository(ref: RepoRef) { return this.get<{ default_branch: string }>(ref, ''); }
  branch(ref: RepoRef, branch: string) { return this.get<{ commit: { sha: string } }>(ref, `/branches/${encodeURIComponent(branch)}`); }
  commit(ref: RepoRef, sha: string) { return this.get<SourceGitCommit>(ref, `/git/commits/${encodeURIComponent(sha)}`); }
  tree(ref: RepoRef, sha: string) { return this.get<SourceGitTree>(ref, `/git/trees/${encodeURIComponent(sha)}`); }
  content(ref: RepoRef, sha: string, path: string) { return this.get<SourceContent>(ref, `/contents/${path.split('/').map(encodeURIComponent).join('/')}`, { ref: sha }); }
  history(ref: RepoRef, sha: string, path: string, page: number): Promise<PageResponse<SourceRestCommit[]>> {
    return this.transport.getPage({ org: ref.owner, path: this.prefix(ref) + '/commits', priority: 'realtime', query: { sha, path: path || undefined, page, per_page: 50 } });
  }
  pullRequest(ref: RepoRef, number: number) { return this.get<SourcePr>(ref, `/pulls/${number}`); }
  mergeBase(ref: RepoRef, base: string, head: string) { return this.get<{ merge_base_commit: { sha: string } }>(ref, `/compare/${base}...${head}`); }
  changes(ref: RepoRef, target: { pr: number } | { sha: string }, page: number) {
    return this.transport.getPage<SourceRestFile[] | SourceRestCommit>({ org: ref.owner, path: this.prefix(ref) + ('pr' in target ? `/pulls/${target.pr}/files` : `/commits/${target.sha}`), priority: 'realtime', query: { page, per_page: 100 } });
  }
  pullRequestsForCommit(ref: RepoRef, sha: string) { return this.get<SourcePr[]>(ref, `/commits/${sha}/pulls`, { per_page: 5 }); }
}
