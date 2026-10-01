import { GitHubApiError, type GitHubSourceReader, type RepoRef, type SourceCallOptions, type SourceContent, type SourceGitCommit, type SourceGitTree, type SourceRestCommit } from '@prs/github';
import type { SourceBlame, SourceComparison, SourceEntry, SourceFile, SourceHistory, SourcePathEntry, SourcePaths, SourceTree } from '@prs/contracts';
import type { Client } from '@elastic/elasticsearch';
import { applyMandatoryScopeFilter, assertNoShardFailures, search, type AccessScope } from '@prs/es';
import { compareTreePaths, walkTreeDiff, type TreeDiffEntry } from './tree-diff.js';

const COMMIT_ALIAS = 'prs-commits' as const;

/**
 * 한 번에 읽는 양 (CR-132). 총량 상한이 아니다 — 응답이 다음 위치를 주고 끝까지 이어 읽는다. CR-138부터 `offset`을 보내지 않는
 * 예전 호출(PIPE v1 포함)도 같은 창·페이지의 첫 조각이다 — 파일 256 KiB·4,000줄, 디렉터리 5,000개의 총량 상한은 없다.
 */
export const SOURCE_WINDOW_BYTES = 1024 * 1024;
export const SOURCE_TREE_PAGE_ENTRIES = 5000;
export const SOURCE_TREE_DIFF_PAGE = 1000;
/** 재귀 목록이 잘렸을 때 비재귀 걷기로 한 번에 내는 경로 수 (CR-133). 재귀가 성공하면 한 응답에 전부다(GitHub의 재귀 한계가 상한). */
export const SOURCE_PATHS_WALK_PAGE = 5000;
/**
 * 걷기 한 페이지가 읽는 디렉터리 수의 상한 (CR-133). 호출당 500ms인 느린 GHE에서도 한 페이지가 요청 기한(120초) 안에
 * 끝나게 한다 — 첫 페이지는 재귀 시도(`SOURCE_PATHS_RECURSIVE_TIMEOUT_MS`)와 기한을 나눠 쓴다. 잎을 하나도 못 낸 페이지에는
 * 걸지 않는다(`walkTreeDiff`).
 */
export const SOURCE_PATHS_WALK_TREE_CALLS = 100;
/**
 * 재귀 트리 한 번의 호출 기한 (CR-133). 응답이 최대 7MB라 기본 호출 기한(10초)으로는 느린 GHE에서 영영 받지 못할 수 있다.
 * 이 기한을 넘기면 걷기로 넘어간다 — 요청 기한 120초의 나머지가 걷기 몫이다.
 */
export const SOURCE_PATHS_RECURSIVE_TIMEOUT_MS = 45_000;
/** GitHub Contents·Blobs API가 본문을 주는 최대 크기 — 제품 상한이 아니라 원천 한계다 (CR-132). */
export const GITHUB_BLOB_MAX_BYTES = 100 * 1024 * 1024;
const UPSTREAM_TOO_LARGE = 'GitHub does not serve files larger than 100 MB through its API.';
/**
 * GitHub가 PR·커밋의 변경 파일을 나열하는 원천 상한과 한 페이지의 파일 수(리더가 보내는 `per_page`) — 100개씩 30쪽이다
 * (CR-138, 전에는 경로의 리터럴). 제품 상한이 아니다: 그 뒤는 트리 비교 목록(`listing=tree`)이 잇는다.
 */
export const GITHUB_CHANGED_FILES_MAX = 3000;
export const GITHUB_CHANGED_FILES_PER_PAGE = 100;
export const GITHUB_CHANGED_FILES_PAGES = GITHUB_CHANGED_FILES_MAX / GITHUB_CHANGED_FILES_PER_PAGE;
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
 * 디렉터리 하나의 한 페이지 (CR-132 · CR-138).
 *
 * 목록 전체를 정렬(디렉터리 먼저, 이름 순)한 뒤 [offset, offset + 5,000)을 돌려준다. `offset`을 보내지 않은 예전 호출도 첫
 * 페이지(offset 0)다 — CR-138 전에는 정렬 전 앞 5,000개에서 자르고 `truncated`를 세웠다. 목록은 트리 SHA로 고정되므로
 * 페이지끼리 섞이지 않는다 — 다음 페이지는 응답의 `revision`·`tree_sha`와 `next_offset`으로 청하고, `next_offset`이 `null`일
 * 때만 목록이 끝났다. `truncated`는 GitHub가 목록을 잘랐을 때뿐이다.
 */
export async function sourceTree(reader: GitHubSourceReader, ref: RepoRef, input: { ref: string; path: string; treeSha?: string; revision?: string; offset: number }, options: SourceCallOptions = {}): Promise<SourceTree> {
  const pinned = input.treeSha && input.revision ? { name: input.ref || input.revision, sha: input.revision } : await pinRevision(reader, ref, input.ref, options);
  const root = input.treeSha ?? (await reader.commit(ref, pinned.sha, options)).tree.sha;
  const tree = await reader.tree(ref, root, options);
  const head = { repository: `${ref.owner}/${ref.repo}`, ref: pinned.name, revision: pinned.sha, path: input.path };
  const entry = (item: SourceGitTree['tree'][number]): SourceEntry => ({ path: input.path ? `${input.path}/${item.path}` : item.path, name: item.path, sha: item.sha,
    kind: item.type === 'tree' ? 'directory' : item.type === 'commit' ? 'submodule' : item.mode === '120000' ? 'symlink' : 'file', size: item.size ?? null,
  });
  const order = (a: SourceEntry, b: SourceEntry) => Number(b.kind === 'directory') - Number(a.kind === 'directory') || a.name.localeCompare(b.name);
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
/**
 * `path`에 있는 blob의 크기와 SHA (CR-138). 고정 revision의 트리를 경로 조각마다 한 번씩 내려간다(비재귀). 경로가 blob이
 * 아니거나 없으면 `null`이다. GitHub가 Contents를 주지 않은 이유가 100MB 원천 한계인지 가를 때만 부른다.
 */
async function blobAt(reader: GitHubSourceReader, ref: RepoRef, revision: string, path: string, options: SourceCallOptions): Promise<{ size: number; sha: string } | null> {
  let tree = (await reader.commit(ref, revision, options)).tree.sha;
  const parts = path.split('/');
  for (let index = 0; index < parts.length; index += 1) {
    const found = (await reader.tree(ref, tree, options)).tree.find(item => item.path === parts[index]);
    if (found === undefined) return null;
    if (index === parts.length - 1) return found.type === 'blob' && typeof found.size === 'number' ? { size: found.size, sha: found.sha } : null;
    if (found.type !== 'tree') return null;
    tree = found.sha;
  }
  return null;
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
 * 본문의 한 창 (CR-132 · CR-138).
 *
 * 파일 조회는 늘 이 함수다 — `offset`을 보내지 않은 예전 호출(PIPE v1 포함)은 offset 0의 창이다(CR-138 전에는 기본 미디어
 * 타입의 Contents 한 번으로 읽고 256 KiB·4,000줄을 넘으면 `too_large`였다). 한 창에 드는 파일(1 MiB 이하)은 한 응답에 완전한
 * 본문이고 `next_offset`이 `null`이며, 넘는 파일은 첫 창과 `next_offset`이다 — `text`는 `next_offset`이 `null`일 때만 완전하다.
 *
 * 메타(object 미디어 타입)로 종류·크기·blob SHA를 알고, 본문이 메타에 함께 왔으면(base64, 1MB 이하) 그것을 쓰며, 아니면
 * blob SHA로 원시 창을 읽는다 — blob SHA는 내용 주소라 창끼리 다른 리비전이 섞이지 않는다. 창은 1 MiB를 넘지 않고 마지막
 * 줄바꿈 뒤에서 끊으며(줄이 창보다 길면 UTF-8 문자 경계), 다음 창의 바이트 위치를 `next_offset`으로 준다. 본문은 이 요청
 * 안에서만 산다(NFR-005 — 어디에도 저장하지 않는다). 크기로 거절하는 것은 GitHub API의 100MB 원천 한계뿐이다 — GitHub는 그
 * 파일의 Contents를 주지 않으므로(문서: 「This endpoint is not supported」, 상태는 적혀 있지 않다) 권한 오류와 같은 403이면
 * 트리 항목의 크기로 가른다. 바이너리·비UTF8·LFS 포인터·파일이 아닌 객체는 크기와 무관한 제한이다.
 */
export async function sourceFileWindow(reader: GitHubSourceReader, ref: RepoRef, revision: string, path: string, offset: number, options: SourceCallOptions = {}): Promise<SourceFile> {
  const base: SourceFile = { repository: `${ref.owner}/${ref.repo}`, revision, path, status: 'missing', text: null, size: null, sha: null, reason: null, offset, next_offset: null };
  let meta: SourceContent;
  try {
    meta = await reader.contentObject(ref, revision, path, options);
  } catch (error) {
    if (error instanceof GitHubApiError && error.kind === 'not_found') { await reader.commit(ref, revision, options); return { ...base, reason: 'This path is not available at this revision.' }; }
    if (error instanceof GitHubApiError && error.kind === 'auth' && error.status === 403 && options.signal?.aborted !== true) {
      // 걷기가 경로를 찾지 못하거나(권한·없음) 그 경로가 blob이 아니면 원래 403을 그대로 올린다. 한도·취소·기한·일시 장애는
      // 걷기의 오류를 올린다 — 삼키면 429(`Retry-After`)나 취소가 권한 오류(503)로 바뀐다 (CR-138 리뷰).
      const blob = await blobAt(reader, ref, revision, path, options).catch((walk: unknown) => {
        if (walk instanceof GitHubApiError && (walk.kind === 'auth' || walk.kind === 'not_found')) return null;
        throw walk;
      });
      if (blob !== null && blob.size > GITHUB_BLOB_MAX_BYTES) return { ...base, size: blob.size, sha: blob.sha, status: 'too_large', reason: UPSTREAM_TOO_LARGE };
    }
    throw error;
  }
  base.size = meta.size ?? null; base.sha = meta.sha ?? null;
  if (meta.type !== 'file') return { ...base, status: 'unsupported', reason: 'This object is not a regular file.' };
  if (meta.size > GITHUB_BLOB_MAX_BYTES) return { ...base, status: 'too_large', reason: UPSTREAM_TOO_LARGE };
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
  // 파일의 끝은 GitHub가 준 크기로 판정한다. 본문이 크기보다 먼저 끝났으면 잘린 파일을 완전한 것처럼 내지 않고 실패한다.
  const end = offset + bytes.length >= meta.size;
  if (eof && !end) throw new Error('Upstream blob ended before its declared size');
  let cut = bytes.length;
  if (!end) { const newline = bytes.lastIndexOf(0x0a); cut = newline >= 0 ? newline + 1 : utf8Boundary(bytes); }
  const chunk = bytes.subarray(0, cut);
  if (chunk.includes(0)) return { ...base, status: 'binary', reason: 'Binary files cannot be displayed as text.' };
  let text: string;
  // offset 0은 예전처럼 앞의 BOM을 뗀다. 파일 가운데의 U+FEFF는 원문이므로 남긴다.
  try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: offset > 0 }).decode(chunk); } catch { return { ...base, status: 'binary', reason: 'This file is not UTF-8 text.' }; }
  if (offset === 0 && text.startsWith(LFS_POINTER)) return { ...base, status: 'unsupported', reason: 'Git LFS objects are not downloaded for source preview.' };
  return { ...base, status: 'text', text, next_offset: end ? null : offset + cut };
}
export async function sourceComparison(reader: GitHubSourceReader, ref: RepoRef, input: { pr?: number; commit?: string; page: number; related?: 'all' }, options: SourceCallOptions = {}): Promise<SourceComparison> {
  let base: string | null; let head: string;
  let baseTip: string | null = null;
  const pullRequests: SourceComparison['pull_requests'] = [];
  let associationsUnavailable = false;
  /** PR의 변경 파일 전체 수(GitHub `changed_files`). 커밋 비교에는 없다. */
  let total: number | undefined;
  if (input.pr !== undefined) {
    const pr = await reader.pullRequest(ref, input.pr, options);
    head = pr.head.sha; baseTip = pr.base.sha;
    total = typeof pr.changed_files === 'number' ? pr.changed_files : undefined;
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
  // CR-138 (DEV-793): GitHub는 3,000개에서 멈추고 마지막(30번째) 페이지에 다음 링크를 주지 않는다 — 링크만 보면 잘린 목록도
  // 완전해 보인다. 마지막 페이지가 가득하거나 PR의 전체 수가 3,000을 넘으면 잘렸을 수 있다고 본다. 전체 수는 거르는 데
  // 쓰지 않고 더하는 데만 쓴다 — 실제 GHES가 경계에서 주는 `changed_files`는 확인하지 못했으므로, 그 값이 틀려도 목록이
  // 조용히 끊기지 않게 한다(정확히 3,000개면 트리 비교를 한 번 더 하고, 그 목록이 같은 3,000개를 준다). 참이면 호출자는
  // `listing=tree`로 끝까지 잇는다.
  const lastPage = input.page >= GITHUB_CHANGED_FILES_PAGES;
  const truncated = lastPage && (page.nextPage !== null || files.length >= GITHUB_CHANGED_FILES_PER_PAGE || (total !== undefined && total > GITHUB_CHANGED_FILES_MAX));
  return { repository: `${ref.owner}/${ref.repo}`, base, head, commit: gitCommit(commit), pull_requests: pullRequests, pull_requests_unavailable: associationsUnavailable,
    files: files.map(file => ({ path: file.filename, previous_path: file.previous_filename ?? null, status: file.status, additions: file.additions, deletions: file.deletions })),
    next_page: lastPage ? null : page.nextPage, truncated };
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

/**
 * 재귀 트리 한 번 (CR-133). 잘리지 않은 목록이면 그 목록, 걷기로 넘어가야 하면 `null`이다: GitHub가 목록을 잘랐거나, 이
 * 호출만 제 기한을 넘겼거나(`timeout`), GitHub가 5xx로 답했다(`server`). GHE가 정말 멈췄으면 걷기의 첫 호출도 실패한다.
 * 요청 전체의 기한·사용자 취소(호출자 신호)와 그 밖의 오류는 그대로 올린다.
 */
async function recursiveListing(reader: GitHubSourceReader, ref: RepoRef, root: string, timeoutMs: number, options: SourceCallOptions): Promise<SourceGitTree | null> {
  try {
    const listing = await reader.treeRecursive(ref, root, { ...options, timeoutMs });
    return listing.truncated === true ? null : listing;
  } catch (error) {
    if (options.signal?.aborted) throw error;
    if (error instanceof GitHubApiError && (error.kind === 'timeout' || error.kind === 'server')) return null;
    throw error;
  }
}
/** 트리 항목 → 검색 결과 항목. 서브모듈(`commit`)과 디렉터리는 선택할 파일이 아니므로 `null`이다. */
function pathEntry(path: string, type: string, mode: string): SourcePathEntry | null {
  if (type !== 'blob') return null;
  return { path, kind: mode === '120000' ? 'symlink' : 'file' };
}
/**
 * 고정 revision의 파일 경로 목록 (CR-133, API-SRC-005).
 *
 * 첫 페이지는 재귀 트리 한 번으로 끝나는 것이 보통이다 — 잘리지 않았으면 전부를 경로 순서(`compareTreePaths`)로 한 응답에
 * 싣고 `next_after`는 `null`이다. GitHub가 재귀 목록을 잘랐거나(10만 항목·7MB) 재귀 호출이 제시간에 끝나지 않았거나 GitHub가
 * 5xx로 답하면 비재귀로 하위 트리를 걷는다(`walkTreeDiff`의 빈 기준 트리 = 모든 잎이 added) — 같은 경로 순서의 페이지와
 * `next_after`. 한 페이지는 경로 5,000개 또는 디렉터리 100개에서 멈추므로 작은 페이지도 정상이다. 이어 읽기(`after`)는 늘
 * 걷기다. 본문은 읽지 않고 저장하지 않는다(경로 문자열만, NFR-005).
 *
 * `recursiveTimeoutMs`·`walkTreeCalls`는 시험용이다(기본 `SOURCE_PATHS_RECURSIVE_TIMEOUT_MS`·`SOURCE_PATHS_WALK_TREE_CALLS`).
 */
export async function sourcePaths(reader: GitHubSourceReader, ref: RepoRef, input: { revision: string; after: string | null; recursiveTimeoutMs?: number; walkTreeCalls?: number }, options: SourceCallOptions = {}): Promise<SourcePaths> {
  const root = (await reader.commit(ref, input.revision, options)).tree.sha;
  const head = { repository: `${ref.owner}/${ref.repo}`, revision: input.revision };
  if (input.after === null) {
    const listing = await recursiveListing(reader, ref, root, input.recursiveTimeoutMs ?? SOURCE_PATHS_RECURSIVE_TIMEOUT_MS, options);
    if (listing !== null) {
      const paths = listing.tree.flatMap((item) => { const entry = pathEntry(item.path, item.type, item.mode); return entry === null ? [] : [entry]; })
        .sort((a, b) => compareTreePaths(a.path, b.path));
      return { ...head, paths, next_after: null, incomplete: false };
    }
  }
  const kind = (type: string): TreeDiffEntry['type'] => (type === 'tree' ? 'tree' : type === 'commit' ? 'commit' : 'blob');
  const page = await walkTreeDiff({
    tree: async (sha, signal) => {
      const listing = await reader.tree(ref, sha, signal ? { signal } : {});
      return { entries: listing.tree.map(item => ({ name: item.path, type: kind(item.type), mode: item.mode, sha: item.sha })), truncated: listing.truncated === true };
    },
  }, null, root, { after: input.after, limit: SOURCE_PATHS_WALK_PAGE, maxTreeCalls: input.walkTreeCalls ?? SOURCE_PATHS_WALK_TREE_CALLS, entries: true, ...(options.signal ? { signal: options.signal } : {}) });
  const paths = page.changes.flatMap((change) => { const entry = change.entry === undefined ? null : pathEntry(change.path, change.entry.type, change.entry.mode); return entry === null ? [] : [entry]; });
  return { ...head, paths, next_after: page.after, incomplete: page.incomplete };
}

/**
 * 고정 revision의 파일 blame (CR-135, API-SRC-006 — FR-SRC-005).
 *
 * GitHub GraphQL `Commit.blame`이 계산한 줄 구간별 귀속을 그대로 옮긴다 — 순서를 바꾸거나 구간을 합치지 않고, GitHub가 주지
 * 않은 작성자 이름·계정을 채우지 않는다(`null` 그대로). Time-lapse의 추정과 섞지 않는다. 본문은 읽지 않는다(같은 revision의
 * `/file`이 준다). 응답의 분류(한도·권한·없음·미지원·일부 결과)는 `readSourceBlame`이 했고, 던진 오류는 경로가 계약 코드로
 * 옮긴다.
 */
export async function sourceBlame(reader: GitHubSourceReader, ref: RepoRef, input: { revision: string; path: string }, options: SourceCallOptions = {}): Promise<SourceBlame> {
  const blame = await reader.blame(ref, input.revision, input.path, options);
  return { repository: `${ref.owner}/${ref.repo}`, revision: blame.revision, path: blame.path, provider: 'github_graphql',
    ranges: blame.ranges.map(range => ({ start_line: range.startLine, end_line: range.endLine, age: range.age,
      commit: { sha: range.commit.sha, message_headline: range.commit.messageHeadline, author_name: range.commit.authorName, author_login: range.commit.authorLogin, authored_at: range.commit.authoredAt, committed_at: range.commit.committedAt } })) };
}
