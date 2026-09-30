/* global setTimeout, URLSearchParams */
/**
 * PIPE source 조회를 끝까지 읽는 반복 호출 참고 구현 (CR-138, PSI-1.0 — CONTRACT_DIFF D-28).
 *
 * pr-search의 source 조회에는 총량 상한이 없다. 그 대신 한 응답은 한 창(파일 1 MiB 이하)·한 페이지(디렉터리 5000개, 이력
 * 50개, 변경 목록 100개·트리 비교 1000개, 경로 목록 5000개)이고, 응답이 다음 위치(`next_offset`·`next_page`·`next_after`)를
 * 준다. 그 값이 `null`이 될 때까지 이으면 끝까지다. 한 HTTP 응답에 전체를 합쳐 주는 경로는 없다 — 한 요청의 작업량과
 * 기한(120초)을 지키기 위해서다. 이 모듈은 그 반복을 한곳에 모은 참고 구현이다. PIPE BFF는 이것을 그대로 쓰거나 같은
 * 규칙으로 다시 짠다.
 *
 * `request(path)`는 호출자가 준다: private 리스너에 mTLS로 연결해 grant를 붙여 GET하고 `{ status, headers, body }`를
 * 돌려준다(`body`는 JSON, `headers`는 소문자 이름). `path`는 연동 prefix(`/internal/integrations/pipe/v1`) 뒤의 경로다
 * — 예: `/read/source/acme%2Fpayments/file?path=a.c&revision=…`.
 *
 * 규칙:
 * - 끝은 다음 위치가 `null`일 때뿐이다. 응답의 `text`·`entries`·`files`·`paths`가 짧거나 비어도 끝이 아니다.
 * - 이어 읽을 때는 앞 응답이 고정한 값(`revision`·`tree_sha`·`head`·`base`, 파일은 blob `sha`)을 그대로 넘기고, 응답이 그
 *   값과 다르면 다른 스냅숏이 섞인 것이므로 멈춘다.
 * - 뒤 창이 텍스트가 아니면(바이너리 등) 파일 전체를 텍스트로 보지 않는다 — 앞 창의 텍스트를 완전한 본문처럼 쓰지 않는다.
 * - 429·502·503은 한도·일시 장애다. `Retry-After`(없으면 짧은 지수 대기)를 지켜 같은 위치에서 다시 부른다. 그 밖의
 *   오류는 호출자에게 올린다(`SourceReadError`). 이미 받은 페이지는 버리지 않는다 — 오류에 멈춘 위치(`resume`)를 싣는다.
 */

export class SourceReadError extends Error {
  /**
   * @param {string} message
   * @param {{ status: number, body: unknown, resume: Record<string, unknown> | null }} detail
   */
  constructor(message, detail) {
    super(message);
    this.name = 'SourceReadError';
    this.status = detail.status;
    this.body = detail.body;
    /** 다시 시작할 위치 — 같은 함수에 넘기면 이어서 읽는다. */
    this.resume = detail.resume;
  }
}

const RETRYABLE = new Set([429, 502, 503]);
const q = (query) => new URLSearchParams(Object.entries(query).filter(([, value]) => value !== undefined && value !== null && value !== '').map(([key, value]) => [key, String(value)])).toString();
const sourcePath = (repository, operation, query) => `/read/source/${encodeURIComponent(repository)}/${operation}?${q(query)}`;

/** 한 요청 — 한도·일시 장애만 제한된 횟수로 다시 부른다. */
async function call(request, path, options, resume) {
  const attempts = options.attempts ?? 4;
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const maxWaitMs = options.maxWaitMs ?? 60_000;
  for (let attempt = 1; ; attempt += 1) {
    const response = await request(path);
    if (response.status === 200) return response.body;
    if (!RETRYABLE.has(response.status) || attempt >= attempts) {
      throw new SourceReadError(`source request failed with ${String(response.status)}`, { status: response.status, body: response.body, resume });
    }
    const retryAfter = Number(response.headers?.['retry-after']);
    const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 500 * 2 ** (attempt - 1);
    if (wait > maxWaitMs) throw new SourceReadError(`source request is rate limited for ${String(Math.ceil(wait / 1000))} s`, { status: response.status, body: response.body, resume });
    await sleep(wait);
  }
}

const changed = (what, resume) => new SourceReadError(`${what} changed while reading; start again`, { status: 409, body: null, resume });

/**
 * 파일 하나를 끝까지 (`read.source.file`). 창을 이어 붙인 `text`는 원문과 바이트까지 같다.
 * @returns {Promise<{ status: string, text: string | null, size: number | null, sha: string | null, reason: string | null, windows: number }>}
 */
export async function getCompleteFile(request, { repository, revision, path, offset = 0 }, options = {}) {
  const parts = [];
  let pinned = null;
  let windows = 0;
  for (let next = offset; ;) {
    const window = await call(request, sourcePath(repository, 'file', { path, revision, offset: next }), options, { offset: next });
    windows += 1;
    if (window.status !== 'text') return { status: window.status, text: null, size: window.size, sha: window.sha, reason: window.reason, windows };
    if (pinned === null) pinned = { sha: window.sha, size: window.size };
    else if (window.sha !== pinned.sha || window.size !== pinned.size) throw changed('file', { offset: next });
    if (window.offset !== next) throw changed('file window', { offset: next });
    parts.push(window.text);
    // A missing key ends the file (a server older than CR-138 answers only complete bodies) — never loop on it.
    window.next_offset ??= null;
    if (window.next_offset === null) return { status: 'text', text: parts.join(''), size: window.size, sha: window.sha, reason: null, windows };
    if (window.next_offset <= next) throw new SourceReadError('file window did not advance', { status: 200, body: window, resume: { offset: next } });
    next = window.next_offset;
  }
}

/**
 * 디렉터리 하나의 모든 항목 (`read.source.tree`). `truncated`는 GitHub가 목록을 잘랐을 때만 참이다(pr-search는 자르지 않는다).
 * 루트는 `ref`(없으면 기본 브랜치)로, 하위 디렉터리는 `revision`·`treeSha`·`path`로 청한다.
 */
export async function getCompleteTree(request, { repository, ref, revision, treeSha, path = '', offset = 0 }, options = {}) {
  const entries = [];
  let pinned = revision && treeSha ? { revision, tree_sha: treeSha } : null;
  let truncated = false;
  for (let next = offset; ;) {
    const query = pinned === null ? { ref, path, offset: next } : { revision: pinned.revision, tree_sha: pinned.tree_sha, path, offset: next };
    const page = await call(request, sourcePath(repository, 'tree', query), options, { revision: pinned?.revision, treeSha: pinned?.tree_sha, offset: next });
    if (pinned === null) pinned = { revision: page.revision, tree_sha: page.tree_sha };
    else if (page.revision !== pinned.revision || page.tree_sha !== pinned.tree_sha) throw changed('tree', { revision: pinned.revision, treeSha: pinned.tree_sha, offset: next });
    entries.push(...page.entries);
    truncated ||= page.truncated;
    page.next_offset ??= null;
    if (page.next_offset === null) return { revision: pinned.revision, tree_sha: pinned.tree_sha, entries, truncated };
    if (page.next_offset <= next) throw new SourceReadError('tree page did not advance', { status: 200, body: null, resume: { revision: pinned.revision, treeSha: pinned.tree_sha, offset: next } });
    next = page.next_offset;
  }
}

/** 고정 revision의 모든 파일 경로 (`read.source.paths`). 같은 이름의 파일도 경로마다 하나씩이다. */
export async function getAllPaths(request, { repository, revision, after = null }, options = {}) {
  const paths = [];
  let incomplete = false;
  for (let cursor = after; ;) {
    const page = await call(request, sourcePath(repository, 'paths', { revision, after: cursor }), options, { after: cursor });
    if (page.revision !== revision) throw changed('paths', { after: cursor });
    paths.push(...page.paths);
    incomplete ||= page.incomplete;
    page.next_after ??= null;
    if (page.next_after === null) return { revision, paths, incomplete };
    if (page.next_after === cursor) throw new SourceReadError('path list did not advance', { status: 200, body: null, resume: { after: cursor } });
    cursor = page.next_after;
  }
}

/** 경로의 모든 이력 (`read.source.history`). 첫 페이지가 고정한 revision으로 다음 페이지를 청한다. */
export async function getCompleteHistory(request, { repository, path = '', ref, page = 1 }, options = {}) {
  const commits = [];
  let revision = null;
  let pullRequestsUnavailable = false;
  for (let next = page; ;) {
    const body = await call(request, sourcePath(repository, 'history', { ref: revision ?? ref, path, page: next }), options, { ref: revision ?? ref, page: next });
    if (revision === null) revision = body.revision;
    else if (body.revision !== revision) throw changed('history', { ref: revision, page: next });
    commits.push(...body.commits);
    pullRequestsUnavailable ||= body.pull_requests_unavailable === true;
    body.next_page ??= null;
    if (body.next_page === null) return { revision, commits, pull_requests_unavailable: pullRequestsUnavailable };
    if (body.next_page <= next) throw new SourceReadError('history page did not advance', { status: 200, body: null, resume: { ref: revision, page: next } });
    next = body.next_page;
  }
}

/**
 * PR 또는 커밋의 모든 변경 파일 (`read.source.diff`).
 *
 * GitHub 목록(100개씩, 최대 30쪽 = 3000개)을 먼저 읽는다. 마지막 페이지의 `truncated`가 참이면 GitHub 목록이 잘렸을 수
 * 있으므로 같은 `base`·`head`의 트리 비교 목록(`listing=tree`)을 끝까지 읽고, GitHub 목록에 없는 경로만 덧붙인다 — GitHub
 * 목록에 있는 파일은 줄 수·이전 경로를 그대로 두고, 덧붙인 파일은 그 값이 `null`이다(지어내지 않는다). 이름 변경은 GitHub
 * 목록 안에서만 한 항목이고, 트리 비교로만 알게 된 이름 변경은 삭제와 추가 두 항목이다.
 * @returns {Promise<{ base: string | null, head: string, files: object[], listing: 'rest' | 'rest+tree', incomplete: boolean }>}
 */
export async function getCompleteDiffFiles(request, { repository, pr, commit }, options = {}) {
  const target = pr !== undefined ? { pr } : { commit };
  const files = [];
  /** GitHub 목록의 경로(페이지 사이 중복 제거)와, 트리 비교에서 건너뛸 경로(그 경로 + 이름 변경의 이전 경로). */
  const listed = new Set();
  const covered = new Set();
  let pinned = null;
  let last = null;
  for (let next = 1; next !== null;) {
    const page = await call(request, sourcePath(repository, 'diff', { ...target, page: next }), options, { page: next });
    if (pinned === null) pinned = { base: page.base, head: page.head };
    else if (page.base !== pinned.base || page.head !== pinned.head) throw changed('comparison', { page: next });
    for (const file of page.files) {
      if (listed.has(file.path)) continue;
      listed.add(file.path);
      covered.add(file.path);
      if (file.previous_path) covered.add(file.previous_path);
      files.push(file);
    }
    last = page;
    next = page.next_page ?? null;
  }
  if (!last.truncated) return { base: pinned.base, head: pinned.head, files, listing: 'rest', incomplete: false };
  let incomplete = false;
  for (let after = null; ;) {
    const page = await call(request, sourcePath(repository, 'diff', { listing: 'tree', head: pinned.head, base: pinned.base ?? undefined, after }), options, { listing: 'tree', after });
    if (page.head !== pinned.head || page.base !== pinned.base) throw changed('tree comparison', { listing: 'tree', after });
    for (const file of page.files) if (!covered.has(file.path)) { covered.add(file.path); files.push(file); }
    incomplete ||= page.truncated;
    page.next_after ??= null;
    if (page.next_after === null) return { base: pinned.base, head: pinned.head, files, listing: 'rest+tree', incomplete };
    if (page.next_after === after) throw new SourceReadError('tree comparison did not advance', { status: 200, body: null, resume: { listing: 'tree', after } });
    after = page.next_after;
  }
}
