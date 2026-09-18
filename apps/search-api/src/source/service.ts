import { GitHubApiError, type GitHubSourceReader, type RepoRef, type SourceGitCommit, type SourceRestCommit } from '@prs/github';
import type { SourceComparison, SourceEntry, SourceFile, SourceHistory, SourceTree } from '@prs/contracts';
import type { Client } from '@elastic/elasticsearch';
import { applyMandatoryScopeFilter, assertNoShardFailures, search, type AccessScope } from '@prs/es';

const COMMIT_ALIAS = 'prs-commits' as const;

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
/**
 * SHA → 연결 PR 번호, 페이지 단위 배치 조회 (CR-107 / FR-SRC-002 AC-1).
 *
 * 페이지의 SHA 전체를 `terms` 질의 하나로 묶는다 — 행마다 개별 조회하면 N+1이
 * 된다. `applyMandatoryScopeFilter`(ADR-008)를 반드시 거친다. `resolve/detail.ts`의
 * `loadSourceCommits`를 호출하지 않는다 — 그 함수의 `_source`는 `pull_request_numbers`를
 * 가져오지 않고, 확장하면 PR 상세 표시(FR-SRCH-003, 별개 기능)까지 영향을 받는다.
 *
 * 히트가 없거나 문서에 `pull_request_numbers` 필드 자체가 없는 SHA는 맵에 키를
 * 두지 않는다 — `loadSourceCommits`와 같은 관례다(CR-016/017, "거짓 null을 채우지
 * 않는다"). 호출부(`sourceHistory`)가 맵에 없는 SHA를 미확정(`null`)으로 채운다.
 *
 * 배열은 오름차순으로 정렬해 반환한다 — AC-1은 "중복 없이 결정적 순서로" 보이길
 * 요구하는데, 원본 union 스크립트(`packages/es/src/upsert.ts`)는 `HashSet`으로
 * 중복만 없앨 뿐 순서를 보장하지 않는다.
 */
export async function loadPullRequestLinks(
  es: Client,
  repository: string,
  shas: readonly string[],
  scope: AccessScope,
): Promise<ReadonlyMap<string, number[]>> {
  if (shas.length === 0) return new Map();
  const normalized = [...new Set(shas.map(sha => sha.toLowerCase()))];
  const response = await search<{ commit_sha: string; pull_request_numbers?: number[] }>(
    es,
    COMMIT_ALIAS,
    applyMandatoryScopeFilter(
      { bool: { filter: [{ term: { repository } }, { terms: { commit_sha: normalized } }] } },
      scope,
    ),
    { size: normalized.length, _source: ['commit_sha', 'pull_request_numbers'] },
  );
  assertNoShardFailures(response);
  const bySha = new Map<string, number[]>();
  for (const hit of response.hits.hits) {
    const source = hit._source;
    if (source?.commit_sha !== undefined && source.pull_request_numbers !== undefined) {
      bySha.set(source.commit_sha.toLowerCase(), [...new Set(source.pull_request_numbers)].sort((a, b) => a - b));
    }
  }
  return bySha;
}

/**
 * `links`가 없으면 배치 조회 자체를 건너뛰고 모든 행을 미확정으로 채운다 — 호출부가
 * ES를 배선하지 않은 경우다. 배치 조회가 던지면(범위 미확인·질의 실패) catch해서
 * 같은 모양으로 답한다 — **PR 연결 조회 실패가 History 본문을 지우지 않는다.**
 * 커밋이 0건이면 조회 자체가 필요 없으므로 `pull_requests_unavailable`을 세우지
 * 않는다 — 아무것도 실패하지 않았다.
 */
export async function sourceHistory(reader: GitHubSourceReader, ref: RepoRef, input: { ref: string; path: string; page: number }, links?: { es: Client; scope: AccessScope }): Promise<SourceHistory> {
  const pinned = await pinRevision(reader, ref, input.ref);
  const response = await reader.history(ref, pinned.sha, input.path, input.page);
  const repository = `${ref.owner}/${ref.repo}`;
  const commits = response.body.map(restCommit);
  const base = { repository, revision: pinned.sha, path: input.path, next_page: response.nextPage };
  // 미확정 모양은 한 곳에서만 만든다 — 건너뛴 경우와 실패한 경우가 따로 적히면
  // 나중에 한쪽만 고쳐 "거짓 null" 규율(CR-016/017)이 조용히 갈라질 수 있다.
  const unavailable = (): SourceHistory => ({ ...base, commits: commits.map(commit => ({ ...commit, pull_request_numbers: null })), pull_requests_unavailable: true });
  if (links === undefined) return unavailable();
  try {
    const bySha = await loadPullRequestLinks(links.es, repository, commits.map(commit => commit.sha), links.scope);
    return { ...base, commits: commits.map(commit => ({ ...commit, pull_request_numbers: bySha.get(commit.sha.toLowerCase()) ?? null })) };
  } catch {
    return unavailable();
  }
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
