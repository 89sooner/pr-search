import type { RepoRef } from './client.js';
import type { GitHubTransport, PageResponse, RawWindow } from './transport.js';

/** Read-only, request-scoped source APIs; callers must authorize the repository first. */
export interface SourceGitCommit { sha: string; tree: { sha: string }; parents: { sha: string }[]; message: string; author: { name: string; date: string }; committer?: { date: string } }
export interface SourceRestCommit { sha: string; parents: { sha: string }[]; author: { login: string } | null; commit: { message: string; author: { name: string; date: string } | null; committer?: { date: string } | null }; files?: SourceRestFile[] }
export interface SourceRestFile { filename: string; previous_filename?: string; status: string; additions: number; deletions: number }
export interface SourceContent { type: string; size: number; sha: string; encoding?: string; content?: string }
export interface SourceGitTree { sha: string; truncated?: boolean; tree: { path: string; sha: string; type: string; mode: string; size?: number }[] }
export interface SourcePr { number: number; title: string; body: string | null; base: { sha: string }; head: { sha: string } }
/** 호출마다 붙는 선택 사항 (CR-132). `signal`은 호출자의 취소·요청 기한이다. */
export interface SourceCallOptions { readonly signal?: AbortSignal }
export class GitHubSourceReader {
  constructor(private readonly transport: GitHubTransport) {}
  private prefix(ref: RepoRef): string { return `/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}`; }
  private get<T>(ref: RepoRef, path: string, query?: Record<string, string | number>, options: SourceCallOptions & { readonly accept?: string; readonly timeoutMs?: number } = {}) {
    return this.transport.get<T>({ org: ref.owner, path: this.prefix(ref) + path, priority: 'realtime', ...(query ? { query } : {}), ...(options.accept ? { accept: options.accept } : {}), ...(options.signal ? { signal: options.signal } : {}), ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}) });
  }
  private signal(options: SourceCallOptions) { return options.signal ? { signal: options.signal } : {}; }
  repository(ref: RepoRef, options: SourceCallOptions = {}) { return this.get<{ default_branch: string }>(ref, '', undefined, options); }
  branch(ref: RepoRef, branch: string, options: SourceCallOptions = {}) { return this.get<{ commit: { sha: string } }>(ref, `/branches/${encodeURIComponent(branch)}`, undefined, options); }
  commit(ref: RepoRef, sha: string, options: SourceCallOptions = {}) { return this.get<SourceGitCommit>(ref, `/git/commits/${encodeURIComponent(sha)}`, undefined, options); }
  tree(ref: RepoRef, sha: string, options: SourceCallOptions = {}) { return this.get<SourceGitTree>(ref, `/git/trees/${encodeURIComponent(sha)}`, undefined, options); }
  /**
   * 트리 전체를 한 번에 (CR-133, 파일 검색). 항목의 `path`는 루트 기준 전체 경로다. GitHub는 10만 항목·7MB를 넘으면
   * `truncated`를 세우고 앞부분만 준다 — 그때는 호출자가 비재귀 `tree`로 하위 트리를 걷는다. `recursive`는 값과 무관하게
   * 있기만 하면 재귀다(`0`·`false`도 재귀, GitHub 문서) — 비재귀는 파라미터를 빼는 것이다. 응답이 최대 7MB라 호출 기한
   * (`timeoutMs`)은 호출자가 따로 준다(기본은 전송 설정의 기한).
   */
  treeRecursive(ref: RepoRef, sha: string, options: SourceCallOptions & { readonly timeoutMs?: number } = {}) { return this.get<SourceGitTree>(ref, `/git/trees/${encodeURIComponent(sha)}`, { recursive: 1 }, options); }
  content(ref: RepoRef, sha: string, path: string, options: SourceCallOptions = {}) { return this.get<SourceContent>(ref, `/contents/${path.split('/').map(encodeURIComponent).join('/')}`, { ref: sha }, options); }
  /**
   * 파일 메타 (CR-132). object 미디어 타입은 1~100MB 파일에도 답한다(본문은 빈 문자열, `encoding: none`). 1MB 이하는
   * base64 본문을 함께 준다. `download_url`은 따라가지 않는다.
   */
  contentObject(ref: RepoRef, sha: string, path: string, options: SourceCallOptions = {}) {
    return this.get<SourceContent>(ref, `/contents/${path.split('/').map(encodeURIComponent).join('/')}`, { ref: sha }, { ...options, accept: 'application/vnd.github.object+json' });
  }
  /** blob 원시 본문의 한 창 (CR-132). Git Blobs API는 100MB까지 원시 바이트로 준다. 바이트 범위는 없다(전송 계층 참고). */
  blobWindow(ref: RepoRef, blobSha: string, window: { readonly offset: number; readonly length: number }, options: SourceCallOptions = {}): Promise<RawWindow> {
    return this.transport.getRawWindow({ org: ref.owner, path: `${this.prefix(ref)}/git/blobs/${encodeURIComponent(blobSha)}`, priority: 'realtime', accept: 'application/vnd.github.raw+json', ...this.signal(options) }, window);
  }
  history(ref: RepoRef, sha: string, path: string, page: number, options: SourceCallOptions = {}): Promise<PageResponse<SourceRestCommit[]>> {
    return this.transport.getPage({ org: ref.owner, path: this.prefix(ref) + '/commits', priority: 'realtime', query: { sha, path: path || undefined, page, per_page: 50 }, ...this.signal(options) });
  }
  pullRequest(ref: RepoRef, number: number, options: SourceCallOptions = {}) { return this.get<SourcePr>(ref, `/pulls/${number}`, undefined, options); }
  mergeBase(ref: RepoRef, base: string, head: string, options: SourceCallOptions = {}) { return this.get<{ merge_base_commit: { sha: string } }>(ref, `/compare/${base}...${head}`, undefined, options); }
  changes(ref: RepoRef, target: { pr: number } | { sha: string }, page: number, options: SourceCallOptions = {}) {
    return this.transport.getPage<SourceRestFile[] | SourceRestCommit>({ org: ref.owner, path: this.prefix(ref) + ('pr' in target ? `/pulls/${target.pr}/files` : `/commits/${target.sha}`), priority: 'realtime', query: { page, per_page: 100 }, ...this.signal(options) });
  }
  pullRequestsForCommit(ref: RepoRef, sha: string, options: SourceCallOptions = {}) { return this.get<SourcePr[]>(ref, `/commits/${sha}/pulls`, { per_page: 5 }, options); }
  /** 커밋과 연결된 PR의 한 페이지 (CR-132, `related=all`). GitHub 최대인 100개씩 읽고 `Link`로 다음 페이지를 안다. */
  pullRequestsForCommitPage(ref: RepoRef, sha: string, page: number, options: SourceCallOptions = {}): Promise<PageResponse<SourcePr[]>> {
    return this.transport.getPage({ org: ref.owner, path: `${this.prefix(ref)}/commits/${sha}/pulls`, priority: 'realtime', query: { page, per_page: 100 }, ...this.signal(options) });
  }
}
