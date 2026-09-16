import { GitHubApiError, type GitHubSourceReader, type RepoRef, type SourceGitCommit, type SourceRestCommit } from '@prs/github';
import type { SourceComparison, SourceEntry, SourceFile, SourceHistory, SourceTree } from '@prs/contracts';

export const SOURCE_MAX_BYTES = 256 * 1024;
export const SOURCE_MAX_LINES = 4000;
export const SOURCE_MAX_ENTRIES = 5000;
export const FULL_SHA = /^[a-f0-9]{40}$/i;
export class SourceSnapshotChanged extends Error {}
export function validPath(path: string): boolean {
  return path.length <= 2048 && ![...path].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127 || char === '\\') && !path.startsWith('/') && !path.endsWith('/') && !path.split('/').some(part => part === '..' || part === '.' || (part === '' && path !== ''));
}
export function validRef(ref: string): boolean { return ref.length <= 255 && ref.length > 0 && ![...ref].some(char => char.charCodeAt(0) <= 32 || char.charCodeAt(0) === 127 || '~^:?*[\\'.includes(char)) && !ref.includes('..') && !ref.includes('@{') && !ref.startsWith('-'); }
export function gitCommit(commit: SourceGitCommit) { return { sha: commit.sha, parents: commit.parents.map(parent => parent.sha), message: commit.message, author: commit.author.name, date: commit.committer?.date ?? null }; }
export function restCommit(commit: SourceRestCommit) { return { sha: commit.sha, parents: commit.parents.map(parent => parent.sha), message: commit.commit.message, author: commit.author?.login ?? commit.commit.author?.name ?? 'Unknown', date: commit.commit.committer?.date ?? null }; }

export async function pinRevision(reader: GitHubSourceReader, ref: RepoRef, input: string): Promise<{ name: string; sha: string }> {
  const name = input || (await reader.repository(ref)).default_branch;
  const sha = FULL_SHA.test(name) ? name : (await reader.branch(ref, name)).commit.sha;
  if (!FULL_SHA.test(sha)) throw new Error('Invalid upstream revision');
  return { name, sha };
}
export async function sourceTree(reader: GitHubSourceReader, ref: RepoRef, input: { ref: string; path: string; treeSha?: string; revision?: string }): Promise<SourceTree> {
  const pinned = input.treeSha && input.revision ? { name: input.ref || input.revision, sha: input.revision } : await pinRevision(reader, ref, input.ref);
  const root = input.treeSha ?? (await reader.commit(ref, pinned.sha)).tree.sha;
  const tree = await reader.tree(ref, root);
  return { repository: `${ref.owner}/${ref.repo}`, ref: pinned.name, revision: pinned.sha, path: input.path,
    entries: tree.tree.slice(0, SOURCE_MAX_ENTRIES).map((entry): SourceEntry => ({ path: input.path ? `${input.path}/${entry.path}` : entry.path, name: entry.path, sha: entry.sha,
      kind: entry.type === 'tree' ? 'directory' : entry.type === 'commit' ? 'submodule' : entry.mode === '120000' ? 'symlink' : 'file', size: entry.size ?? null,
    })).sort((a, b) => Number(b.kind === 'directory') - Number(a.kind === 'directory') || a.name.localeCompare(b.name)),
    truncated: tree.truncated === true || tree.tree.length > SOURCE_MAX_ENTRIES };
}
export async function sourceHistory(reader: GitHubSourceReader, ref: RepoRef, input: { ref: string; path: string; page: number }): Promise<SourceHistory> {
  const pinned = await pinRevision(reader, ref, input.ref);
  const response = await reader.history(ref, pinned.sha, input.path, input.page);
  return { repository: `${ref.owner}/${ref.repo}`, revision: pinned.sha, path: input.path, commits: response.body.map(restCommit), next_page: response.nextPage };
}
export async function sourceFile(reader: GitHubSourceReader, ref: RepoRef, revision: string, path: string): Promise<SourceFile> {
  const base: SourceFile = { repository: `${ref.owner}/${ref.repo}`, revision, path, status: 'missing', text: null, size: null, sha: null, reason: null };
  try {
    const result = await reader.content(ref, revision, path);
    base.size = result.size ?? null; base.sha = result.sha ?? null;
    if (result.type !== 'file') return { ...base, status: 'unsupported', reason: 'This object is not a regular file.' };
    if (result.size > SOURCE_MAX_BYTES || (result.content?.length ?? 0) > SOURCE_MAX_BYTES * 1.5) return { ...base, status: 'too_large', reason: 'Source preview is limited to 256 KiB per file.' };
    if (result.encoding !== 'base64' || typeof result.content !== 'string') return { ...base, status: 'unsupported', reason: 'The server did not provide previewable content.' };
    const bytes = Buffer.from(result.content, 'base64');
    if (bytes.length > SOURCE_MAX_BYTES) return { ...base, status: 'too_large', reason: 'Source preview is limited to 256 KiB per file.' };
    if (bytes.includes(0)) return { ...base, status: 'binary', reason: 'Binary files cannot be displayed as text.' };
    let text: string;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { return { ...base, status: 'binary', reason: 'This file is not UTF-8 text.' }; }
    if (text.startsWith('version https://git-lfs.github.com/spec/v1')) return { ...base, status: 'unsupported', reason: 'Git LFS objects are not downloaded for source preview.' };
    if (text.split('\n').length > SOURCE_MAX_LINES) return { ...base, status: 'too_large', reason: 'Source preview is limited to 4,000 lines per file.' };
    return { ...base, status: 'text', text };
  } catch (error) {
    if (error instanceof GitHubApiError && error.kind === 'not_found') { await reader.commit(ref, revision); return { ...base, reason: 'This path is not available at this revision.' }; }
    throw error;
  }
}
export async function sourceComparison(reader: GitHubSourceReader, ref: RepoRef, input: { pr?: number; commit?: string; page: number }): Promise<SourceComparison> {
  let base: string | null; let head: string;
  let baseTip: string | null = null;
  const pullRequests: SourceComparison['pull_requests'] = [];
  let associationsUnavailable = false;
  if (input.pr !== undefined) {
    const pr = await reader.pullRequest(ref, input.pr);
    head = pr.head.sha; baseTip = pr.base.sha;
    if (!FULL_SHA.test(head) || !FULL_SHA.test(baseTip)) throw new Error('Invalid upstream revision');
    base = (await reader.mergeBase(ref, baseTip, head)).merge_base_commit.sha;
    pullRequests.push({ number: pr.number, title: pr.title, body: pr.body });
  } else {
    head = input.commit!;
    base = (await reader.commit(ref, head)).parents[0]?.sha ?? null;
    // Association failure must not prevent a valid source comparison. Never invent a PR.
    try { for (const pr of (await reader.pullRequestsForCommit(ref, head)).slice(0, 5)) pullRequests.push({ number: pr.number, title: pr.title, body: pr.body }); } catch { associationsUnavailable = true; }
  }
  const commit = await reader.commit(ref, head);
  if (!FULL_SHA.test(head) || (base !== null && !FULL_SHA.test(base))) throw new Error('Invalid upstream comparison');
  const page = await reader.changes(ref, input.pr !== undefined ? { pr: input.pr } : { sha: head }, input.page);
  const files = Array.isArray(page.body) ? page.body : page.body.files ?? [];
  if (input.pr !== undefined) { const latest = await reader.pullRequest(ref, input.pr); if (latest.head.sha !== head || latest.base.sha !== baseTip) throw new SourceSnapshotChanged('Pull request changed'); }
  return { repository: `${ref.owner}/${ref.repo}`, base, head, commit: gitCommit(commit), pull_requests: pullRequests, pull_requests_unavailable: associationsUnavailable,
    files: files.map(file => ({ path: file.filename, previous_path: file.previous_filename ?? null, status: file.status, additions: file.additions, deletions: file.deletions })),
    next_page: input.page < 30 ? page.nextPage : null, truncated: input.page >= 30 && page.nextPage !== null };
}
