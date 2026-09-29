import { GitHubApiError, type GitHubSourceReader, type RepoRef, type SourceCallOptions, type SourceContent, type SourceGitCommit, type SourceGitTree, type SourceRestCommit } from '@prs/github';
import type { SourceComparison, SourceEntry, SourceFile, SourceHistory, SourceTree } from '@prs/contracts';
import type { Client } from '@elastic/elasticsearch';
import { applyMandatoryScopeFilter, assertNoShardFailures, search, type AccessScope } from '@prs/es';
import { walkTreeDiff, type TreeDiffEntry } from './tree-diff.js';

const COMMIT_ALIAS = 'prs-commits' as const;

export const SOURCE_MAX_BYTES = 256 * 1024;
export const SOURCE_MAX_LINES = 4000;
export const SOURCE_MAX_ENTRIES = 5000;
/**
 * `offset`·`listing=tree`를 보낸 요청의 한 번에 읽는 양 (CR-132). 총량 상한이 아니다 — 응답이 다음 위치를 주고 끝까지
 * 이어 읽는다. 위의 세 상한은 그 파라미터를 보내지 않는 예전 호출(PIPE v1 포함)의 동작으로만 남는다.
 */
export const SOURCE_WINDOW_BYTES = 1024 * 1024;
export const SOURCE_TREE_PAGE_ENTRIES = 5000;
export const SOURCE_TREE_DIFF_PAGE = 1000;
/** GitHub Contents·Blobs API가 본문을 주는 최대 크기 — 제품 상한이 아니라 원천 한계다 (CR-132). */
export const GITHUB_BLOB_MAX_BYTES = 100 * 1024 * 1024;
export const FULL_SHA = /^[a-f0-9]{40}$/i;
export class SourceSnapshotChanged extends Error {}
/** 이어 읽기 위치가 대상의 범위 밖이거나 경계가 아니다 (CR-132) — 경로가 400으로 답한다. 문구는 고정 영어다. */
export class SourceRangeError extends Error {}
export function validPath(path: string): boolean {
  return path.length <= 2048 && ![...path].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127 || char === '\\') && !path.startsWith('/') && !path.endsWith('/') && !path.split('/').some(part => part === '..' || part === '.' || (part === '' && path !== ''));
}
export function validRef(ref: string): boolean { return ref.length <= 255 && ref.length > 0 && ![...ref].some(char => char.charCodeAt(0) <= 32 || char.charCodeAt(0) === 127 || '~^:?*[\\'.includes(char)) && !ref.includes('..') && !ref.includes('@{') && !ref.startsWith('-'); }
export function gitCommit(commit: SourceGitCommit) { return { sha: commit.sha, parents: commit.parents.map(parent => parent.sha), message: commit.message, author: commit.author.name, date: commit.committer?.date ?? null }; }
export function restCommit(commit: SourceRestCommit) { return { sha: commit.sha, parents: commit.parents.map(parent => parent.sha), message: commit.commit.message, author: commit.author?.login ?? commit.commit.author?.name ?? 'Unknown', date: commit.commit.committer?.date ?? null }; }

export async function pinRevision(reader: GitHubSourceReader, ref: RepoRef, input: string, options: SourceCallOptions = {}): Promise<{ name: string; sha: string }> {
  const name = input || (await reader.repository(ref, options)).default_branch;
  const sha = FULL_SHA.test(name) ? name : (await reader.branch(ref, name, options)).commit.sha;
  if (!FULL_SHA.test(sha)) throw new Error('Invalid upstream revision');
  return { name, sha };
}
/**
 * 디렉터리 하나의 목록.
 *
 * `offset`이 없으면 예전 동작이다 — 앞 5,000개(정렬 전)에서 자르고 `truncated`를 세운다. `offset`이 있으면(CR-132)
 * 목록 전체를 정렬한 뒤 [offset, offset + 5,000)을 돌려준다. 목록은 트리 SHA로 고정되므로 페이지끼리 섞이지 않는다 —
 * 다음 페이지는 응답의 `revision`·`tree_sha`로 청한다. `truncated`는 GitHub가 목록을 잘랐을 때뿐이다.
 */
export async function sourceTree(reader: GitHubSourceReader, ref: RepoRef, input: { ref: string; path: string; treeSha?: string; revision?: string; offset?: number }, options: SourceCallOptions = {}): Promise<SourceTree> {
  const pinned = input.treeSha && input.revision ? { name: input.ref || input.revision, sha: input.revision } : await pinRevision(reader, ref, input.ref, options);
  const root = input.treeSha ?? (await reader.commit(ref, pinned.sha, options)).tree.sha;
  const tree = await reader.tree(ref, root, options);
  const head = { repository: `${ref.owner}/${ref.repo}`, ref: pinned.name, revision: pinned.sha, path: input.path };
  const entry = (item: SourceGitTree['tree'][number]): SourceEntry => ({ path: input.path ? `${input.path}/${item.path}` : item.path, name: item.path, sha: item.sha,
    kind: item.type === 'tree' ? 'directory' : item.type === 'commit' ? 'submodule' : item.mode === '120000' ? 'symlink' : 'file', size: item.size ?? null,
  });
  const order = (a: SourceEntry, b: SourceEntry) => Number(b.kind === 'directory') - Number(a.kind === 'directory') || a.name.localeCompare(b.name);
  if (input.offset === undefined) {
    return { ...head, entries: tree.tree.slice(0, SOURCE_MAX_ENTRIES).map(entry).sort(order), truncated: tree.truncated === true || tree.tree.length > SOURCE_MAX_ENTRIES };
  }
  const total = tree.tree.length;
  if (input.offset > total) throw new SourceRangeError('Offset is beyond the end of this directory.');
  const end = input.offset + SOURCE_TREE_PAGE_ENTRIES;
  return { ...head, entries: tree.tree.map(entry).sort(order).slice(input.offset, end), truncated: tree.truncated === true,
    tree_sha: root, offset: input.offset, next_offset: end < total ? end : null, total };
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
export async function sourceHistory(reader: GitHubSourceReader, ref: RepoRef, input: { ref: string; path: string; page: number }, links?: { es: Client; scope: AccessScope }, options: SourceCallOptions = {}): Promise<SourceHistory> {
  const pinned = await pinRevision(reader, ref, input.ref, options);
  const response = await reader.history(ref, pinned.sha, input.path, input.page, options);
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
export async function sourceFile(reader: GitHubSourceReader, ref: RepoRef, revision: string, path: string, options: SourceCallOptions = {}): Promise<SourceFile> {
  const base: SourceFile = { repository: `${ref.owner}/${ref.repo}`, revision, path, status: 'missing', text: null, size: null, sha: null, reason: null };
  try {
    const result = await reader.content(ref, revision, path, options);
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
    if (error instanceof GitHubApiError && error.kind === 'not_found') { await reader.commit(ref, revision, options); return { ...base, reason: 'This path is not available at this revision.' }; }
    throw error;
  }
}

const LFS_POINTER = 'version https://git-lfs.github.com/spec/v1';
/** 창 끝이 여러 바이트 문자의 가운데면 그 문자의 첫 바이트 앞에서 자른다. 완전한 문자로 끝나면 그대로다. */
export function utf8Boundary(bytes: Uint8Array): number {
  const end = bytes.length;
  let index = end - 1;
  let back = 0;
  while (index >= 0 && back < 3 && ((bytes[index] ?? 0) & 0xc0) === 0x80) { index -= 1; back += 1; }
  if (index < 0) return end;
  const lead = bytes[index] ?? 0;
  const need = lead >= 0xf0 ? 4 : lead >= 0xe0 ? 3 : lead >= 0xc0 ? 2 : 1;
  return end - index >= need ? end : index;
}
/**
 * 본문의 한 창 (CR-132, `offset`).
 *
 * 메타(object 미디어 타입)로 종류·크기·blob SHA를 알고, 본문이 메타에 함께 왔으면(base64, 1MB 이하) 그것을 쓰며, 아니면
 * blob SHA로 원시 창을 읽는다 — blob SHA는 내용 주소라 창끼리 다른 리비전이 섞이지 않는다. 창은 1 MiB를 넘지 않고 마지막
 * 줄바꿈 뒤에서 끊으며(줄이 창보다 길면 UTF-8 문자 경계), 다음 창의 바이트 위치를 `next_offset`으로 준다. 본문은 이 요청
 * 안에서만 산다(NFR-005 — 어디에도 저장하지 않는다). 판정 순서는 예전과 같되 크기 상한은 GitHub의 100MB뿐이다.
 */
export async function sourceFileWindow(reader: GitHubSourceReader, ref: RepoRef, revision: string, path: string, offset: number, options: SourceCallOptions = {}): Promise<SourceFile> {
  const base: SourceFile = { repository: `${ref.owner}/${ref.repo}`, revision, path, status: 'missing', text: null, size: null, sha: null, reason: null, offset, next_offset: null };
  let meta: SourceContent;
  try {
    meta = await reader.contentObject(ref, revision, path, options);
  } catch (error) {
    if (error instanceof GitHubApiError && error.kind === 'not_found') { await reader.commit(ref, revision, options); return { ...base, reason: 'This path is not available at this revision.' }; }
    throw error;
  }
  base.size = meta.size ?? null; base.sha = meta.sha ?? null;
  if (meta.type !== 'file') return { ...base, status: 'unsupported', reason: 'This object is not a regular file.' };
  if (meta.size > GITHUB_BLOB_MAX_BYTES) return { ...base, status: 'too_large', reason: 'GitHub does not serve files larger than 100 MB through its API.' };
  if (offset > meta.size) throw new SourceRangeError('Offset is beyond the end of the file.');
  const inline = meta.encoding === 'base64' && typeof meta.content === 'string' ? Buffer.from(meta.content, 'base64') : null;
  let bytes: Uint8Array; let eof: boolean;
  if (inline !== null && inline.length === meta.size) {
    bytes = inline.subarray(offset, offset + SOURCE_WINDOW_BYTES); eof = offset + SOURCE_WINDOW_BYTES >= inline.length;
  } else {
    if (!FULL_SHA.test(meta.sha)) throw new Error('Invalid upstream blob');
    ({ bytes, eof } = await reader.blobWindow(ref, meta.sha, { offset, length: SOURCE_WINDOW_BYTES }, options));
  }
  if (offset > 0 && bytes.length > 0 && ((bytes[0] ?? 0) & 0xc0) === 0x80) throw new SourceRangeError('Offset must be a window boundary returned by the previous response.');
  let cut = bytes.length;
  if (!eof) { const newline = bytes.lastIndexOf(0x0a); cut = newline >= 0 ? newline + 1 : utf8Boundary(bytes); }
  const chunk = bytes.subarray(0, cut);
  if (chunk.includes(0)) return { ...base, status: 'binary', reason: 'Binary files cannot be displayed as text.' };
  let text: string;
  // offset 0은 예전처럼 앞의 BOM을 뗀다. 파일 가운데의 U+FEFF는 원문이므로 남긴다.
  try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: offset > 0 }).decode(chunk); } catch { return { ...base, status: 'binary', reason: 'This file is not UTF-8 text.' }; }
  if (offset === 0 && text.startsWith(LFS_POINTER)) return { ...base, status: 'unsupported', reason: 'Git LFS objects are not downloaded for source preview.' };
  return { ...base, status: 'text', text, next_offset: eof && cut === bytes.length ? null : offset + cut };
}
export async function sourceComparison(reader: GitHubSourceReader, ref: RepoRef, input: { pr?: number; commit?: string; page: number; related?: 'all' }, options: SourceCallOptions = {}): Promise<SourceComparison> {
  let base: string | null; let head: string;
  let baseTip: string | null = null;
  const pullRequests: SourceComparison['pull_requests'] = [];
  let associationsUnavailable = false;
  if (input.pr !== undefined) {
    const pr = await reader.pullRequest(ref, input.pr, options);
    head = pr.head.sha; baseTip = pr.base.sha;
    if (!FULL_SHA.test(head) || !FULL_SHA.test(baseTip)) throw new Error('Invalid upstream revision');
    base = (await reader.mergeBase(ref, baseTip, head, options)).merge_base_commit.sha;
    pullRequests.push({ number: pr.number, title: pr.title, body: pr.body });
  } else {
    head = input.commit!;
    base = (await reader.commit(ref, head, options)).parents[0]?.sha ?? null;
    // Association failure must not prevent a valid source comparison. Never invent a PR.
    try {
      if (input.related === 'all') {
        // CR-132: 다섯 개에서 자르지 않는다. 호출 취소는 연결 실패로 삼키지 않고 그대로 올린다.
        for (let next: number | null = 1; next !== null;) {
          const page = await reader.pullRequestsForCommitPage(ref, head, next, options);
          for (const pr of page.body) pullRequests.push({ number: pr.number, title: pr.title, body: pr.body });
          next = page.nextPage;
        }
      } else for (const pr of (await reader.pullRequestsForCommit(ref, head, options)).slice(0, 5)) pullRequests.push({ number: pr.number, title: pr.title, body: pr.body });
    } catch (error) { if (options.signal?.aborted) throw error; associationsUnavailable = true; pullRequests.length = 0; }
  }
  const commit = await reader.commit(ref, head, options);
  if (!FULL_SHA.test(head) || (base !== null && !FULL_SHA.test(base))) throw new Error('Invalid upstream comparison');
  const page = await reader.changes(ref, input.pr !== undefined ? { pr: input.pr } : { sha: head }, input.page, options);
  const files = Array.isArray(page.body) ? page.body : page.body.files ?? [];
  if (input.pr !== undefined) { const latest = await reader.pullRequest(ref, input.pr, options); if (latest.head.sha !== head || latest.base.sha !== baseTip) throw new SourceSnapshotChanged('Pull request changed'); }
  return { repository: `${ref.owner}/${ref.repo}`, base, head, commit: gitCommit(commit), pull_requests: pullRequests, pull_requests_unavailable: associationsUnavailable,
    files: files.map(file => ({ path: file.filename, previous_path: file.previous_filename ?? null, status: file.status, additions: file.additions, deletions: file.deletions })),
    next_page: input.page < 30 ? page.nextPage : null, truncated: input.page >= 30 && page.nextPage !== null };
}
/**
 * 두 커밋의 트리를 직접 비교한 변경 목록 (CR-132, `listing=tree`).
 *
 * GitHub의 PR·커밋 파일 목록은 3,000개가 원천 상한이다. 그보다 큰 변경도 끝까지 보도록 Trees API(비재귀)로 두 트리를
 * 나란히 걷는다(`walkTreeDiff`). 호출자는 일반 비교 응답에서 고정한 `base`·`head` SHA를 그대로 넘긴다 — 내용 주소라
 * 페이지끼리 다른 리비전이 섞이지 않고, PR을 페이지마다 다시 해석(`compare`)하지 않는다. 줄 수와 이름 변경은 알 수
 * 없다(`additions`·`deletions`·`previous_path`가 `null`). 관련 PR은 일반 비교 응답의 것이므로 여기서는 비운다.
 */
export async function sourceTreeComparison(reader: GitHubSourceReader, ref: RepoRef, input: { base: string | null; head: string; after: string | null }, options: SourceCallOptions = {}): Promise<SourceComparison> {
  const headCommit = await reader.commit(ref, input.head, options);
  const baseTree = input.base === null ? null : (await reader.commit(ref, input.base, options)).tree.sha;
  const kind = (type: string): TreeDiffEntry['type'] => (type === 'tree' ? 'tree' : type === 'commit' ? 'commit' : 'blob');
  const page = await walkTreeDiff({
    tree: async (sha, signal) => {
      const listing = await reader.tree(ref, sha, signal ? { signal } : {});
      return { entries: listing.tree.map(item => ({ name: item.path, type: kind(item.type), mode: item.mode, sha: item.sha })), truncated: listing.truncated === true };
    },
  }, baseTree, headCommit.tree.sha, { after: input.after, limit: SOURCE_TREE_DIFF_PAGE, ...(options.signal ? { signal: options.signal } : {}) });
  return { repository: `${ref.owner}/${ref.repo}`, base: input.base, head: input.head, commit: gitCommit(headCommit), pull_requests: [], pull_requests_unavailable: false,
    files: page.changes.map(change => ({ path: change.path, previous_path: null, status: change.status, additions: null, deletions: null })),
    next_page: null, truncated: page.incomplete, listing: 'tree', next_after: page.after };
}
