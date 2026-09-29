/**
 * 가짜 GHE의 source 저장소 (CR-132).
 *
 * `mock-ghe.ts`에 붙는 선택 픽스처다. 실제 Git처럼 blob·tree·commit SHA를 내용으로 계산한 작은 객체 저장소를 만들고,
 * pr-search의 source 조회가 부르는 REST 경로를 GitHub의 규칙대로 답한다 — 원시 본문은 조각으로 흘려 보내고(바이트
 * 범위 없음), 변경 파일 목록은 3,000개에서 자르며, 1MB를 넘는 파일은 기본 미디어 타입의 Contents로 주지 않는다.
 * 전송 계층의 창 읽기·취소·페이지를 **실제 HTTP 위에서** 보려는 것이다.
 */

import { createHash } from 'node:crypto';
import { once } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';

export type MockFileContent = string | Buffer | { readonly submodule: string } | { readonly symlink: string };

export interface MockSourceCommitInput {
  readonly message: string;
  readonly author?: string;
  /** 앞 커밋에 대한 변경. 값이 `null`이면 그 경로를 지운다. */
  readonly changes: Readonly<Record<string, MockFileContent | null>>;
}

export interface MockSourceInput {
  readonly owner: string;
  readonly repo: string;
  readonly branch?: string;
  /** 선형 이력, 오래된 것부터. 브랜치는 마지막 커밋을 가리킨다. */
  readonly commits: readonly MockSourceCommitInput[];
  /** `base`·`head`는 `commits`의 번호다. */
  readonly pulls?: readonly { readonly number: number; readonly title: string; readonly body?: string | null; readonly base: number; readonly head: number }[];
  /** 커밋 번호 → 그 커밋과 연결된 PR 번호. */
  readonly commitPulls?: Readonly<Record<number, readonly number[]>>;
}

interface TreeEntry { readonly name: string; readonly mode: string; readonly type: 'blob' | 'tree' | 'commit'; readonly sha: string; readonly size?: number }
interface CommitObject { readonly sha: string; readonly tree: string; readonly parents: readonly string[]; readonly message: string; readonly author: string; readonly date: string }

export interface MockSourceRepository {
  readonly owner: string;
  readonly repo: string;
  readonly branch: string;
  /** `commits` 번호 순서의 커밋 SHA. */
  readonly commitShas: readonly string[];
  readonly trees: ReadonlyMap<string, readonly TreeEntry[]>;
  readonly blobs: ReadonlyMap<string, Buffer>;
  readonly commits: ReadonlyMap<string, CommitObject>;
  readonly pulls: ReadonlyMap<number, { readonly number: number; readonly title: string; readonly body: string | null; readonly base: string; readonly head: string }>;
  readonly commitPulls: ReadonlyMap<string, readonly number[]>;
  /** 커밋 `index`의 `path`에 있는 blob SHA (단언용). */
  blobAt(index: number, path: string): string | undefined;
}

export interface MockSourceOptions {
  /** 원시 본문을 흘려 보내는 조각 크기. 기본 64 KiB. */
  readonly rawChunkBytes?: number;
  /** 조각 사이의 지연(ms). 취소 시험에서 전송 도중을 만든다. 기본 0. */
  readonly rawDelayMs?: number;
}

export interface MockRawRead { readonly path: string; bytesSent: number; closedEarly: boolean; finished: boolean }

const MODE = { file: '100644', tree: '040000', gitTree: '40000', symlink: '120000', submodule: '160000' } as const;
/** GitHub가 PR·커밋의 변경 파일을 나열하는 원천 상한. */
export const GITHUB_CHANGED_FILES_LIMIT = 3000;
/** Contents API가 기본 미디어 타입으로 본문을 주는 크기 (GitHub 문서의 1MB). */
const CONTENTS_INLINE_MAX = 1024 * 1024;

function gitHash(kind: string, body: Buffer): string {
  return createHash('sha1').update(`${kind} ${String(body.length)}\0`).update(body).digest('hex');
}
function asBuffer(content: string | Buffer): Buffer {
  return typeof content === 'string' ? Buffer.from(content, 'utf8') : content;
}
/** Git의 트리 항목 순서: 디렉터리는 이름 뒤에 `/`가 붙은 것처럼 비교한다. */
function gitOrder(a: TreeEntry, b: TreeEntry): number {
  const left = a.type === 'tree' ? `${a.name}/` : a.name;
  const right = b.type === 'tree' ? `${b.name}/` : b.name;
  return left < right ? -1 : left > right ? 1 : 0;
}

export function buildMockSource(input: MockSourceInput): MockSourceRepository {
  const trees = new Map<string, readonly TreeEntry[]>();
  const blobs = new Map<string, Buffer>();
  const commits = new Map<string, CommitObject>();
  const snapshots: Map<string, MockFileContent>[] = [];
  const commitShas: string[] = [];

  const storeBlob = (bytes: Buffer): string => { const sha = gitHash('blob', bytes); blobs.set(sha, bytes); return sha; };
  const storeTree = (files: ReadonlyMap<string, MockFileContent>): string => {
    // 한 단계씩: 이 디렉터리의 파일과 하위 디렉터리로 나눈다.
    const direct = new Map<string, MockFileContent>();
    const children = new Map<string, Map<string, MockFileContent>>();
    for (const [path, content] of files) {
      const slash = path.indexOf('/');
      if (slash < 0) { direct.set(path, content); continue; }
      const head = path.slice(0, slash);
      let child = children.get(head);
      if (child === undefined) { child = new Map(); children.set(head, child); }
      child.set(path.slice(slash + 1), content);
    }
    const entries: TreeEntry[] = [];
    for (const [name, content] of direct) {
      if (typeof content === 'string' || Buffer.isBuffer(content)) {
        const bytes = asBuffer(content);
        entries.push({ name, mode: MODE.file, type: 'blob', sha: storeBlob(bytes), size: bytes.length });
      } else if ('submodule' in content) {
        entries.push({ name, mode: MODE.submodule, type: 'commit', sha: content.submodule });
      } else {
        const bytes = Buffer.from(content.symlink, 'utf8');
        entries.push({ name, mode: MODE.symlink, type: 'blob', sha: storeBlob(bytes), size: bytes.length });
      }
    }
    for (const [name, child] of children) entries.push({ name, mode: MODE.tree, type: 'tree', sha: storeTree(child) });
    entries.sort(gitOrder);
    const body = Buffer.concat(entries.map((entry) => Buffer.concat([
      Buffer.from(`${entry.type === 'tree' ? MODE.gitTree : entry.mode} ${entry.name}\0`, 'utf8'),
      Buffer.from(entry.sha, 'hex'),
    ])));
    const sha = gitHash('tree', body);
    trees.set(sha, entries);
    return sha;
  };

  let previous = new Map<string, MockFileContent>();
  input.commits.forEach((commit, index) => {
    const files = new Map(previous);
    for (const [path, content] of Object.entries(commit.changes)) {
      if (content === null) files.delete(path);
      else files.set(path, content);
    }
    const tree = storeTree(files);
    const parents = index === 0 ? [] : [commitShas[index - 1] ?? ''];
    const date = new Date(Date.UTC(2026, 0, 1) + index * 3_600_000).toISOString();
    const author = commit.author ?? 'dev';
    const text = [`tree ${tree}`, ...parents.map((parent) => `parent ${parent}`), `author ${author} <${author}@example.invalid> ${String(Date.parse(date) / 1000)} +0000`, `committer ${author} <${author}@example.invalid> ${String(Date.parse(date) / 1000)} +0000`, '', commit.message, ''].join('\n');
    const sha = gitHash('commit', Buffer.from(text, 'utf8'));
    commits.set(sha, { sha, tree, parents, message: commit.message, author, date });
    commitShas.push(sha);
    snapshots.push(files);
    previous = files;
  });

  const pulls = new Map((input.pulls ?? []).map((pull) => [pull.number, { number: pull.number, title: pull.title, body: pull.body ?? null, base: commitShas[pull.base] ?? '', head: commitShas[pull.head] ?? '' }] as const));
  const commitPulls = new Map(Object.entries(input.commitPulls ?? {}).map(([index, numbers]) => [commitShas[Number(index)] ?? '', numbers] as const));
  return {
    owner: input.owner, repo: input.repo, branch: input.branch ?? 'main', commitShas, trees, blobs, commits, pulls, commitPulls,
    blobAt: (index, path) => {
      const content = snapshots[index]?.get(path);
      if (content === undefined) return undefined;
      if (typeof content === 'string' || Buffer.isBuffer(content)) return gitHash('blob', asBuffer(content));
      return 'symlink' in content ? gitHash('blob', Buffer.from(content.symlink, 'utf8')) : undefined;
    },
  };
}

/** `path`의 트리 항목을 찾는다. 루트는 `null`이다. */
function lookup(repo: MockSourceRepository, treeSha: string, path: string): TreeEntry | null | undefined {
  if (path === '') return null;
  let entries = repo.trees.get(treeSha);
  const parts = path.split('/');
  for (let index = 0; index < parts.length; index += 1) {
    const entry = entries?.find((item) => item.name === parts[index]);
    if (entry === undefined) return undefined;
    if (index === parts.length - 1) return entry;
    if (entry.type !== 'tree') return undefined;
    entries = repo.trees.get(entry.sha);
  }
  return undefined;
}
/** 커밋의 모든 잎(파일·심볼릭 링크·서브모듈)을 경로 → (sha, mode)로 편다. */
function flatten(repo: MockSourceRepository, treeSha: string | null, prefix = '', out = new Map<string, string>()): Map<string, string> {
  if (treeSha === null) return out;
  for (const entry of repo.trees.get(treeSha) ?? []) {
    const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.type === 'tree') flatten(repo, entry.sha, path, out);
    else out.set(path, `${entry.sha}:${entry.mode}`);
  }
  return out;
}
function lineCount(bytes: Buffer | undefined): number {
  if (bytes === undefined || bytes.length === 0) return 0;
  const text = bytes.toString('utf8');
  return text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
}
/** 두 트리의 변경 파일 — GitHub처럼 경로 순서로, 줄 수는 단순 계산이다. */
function changedFiles(repo: MockSourceRepository, baseTree: string | null, headTree: string): { filename: string; status: string; additions: number; deletions: number }[] {
  const before = flatten(repo, baseTree);
  const after = flatten(repo, headTree);
  const paths = [...new Set([...before.keys(), ...after.keys()])].sort();
  const blob = (value: string | undefined) => (value === undefined ? undefined : repo.blobs.get(value.split(':')[0] ?? ''));
  const out: { filename: string; status: string; additions: number; deletions: number }[] = [];
  for (const path of paths) {
    const left = before.get(path); const right = after.get(path);
    if (left === right) continue;
    const status = left === undefined ? 'added' : right === undefined ? 'removed' : 'modified';
    out.push({ filename: path, status, additions: status === 'removed' ? 0 : lineCount(blob(right)), deletions: status === 'added' ? 0 : lineCount(blob(left)) });
  }
  return out;
}

function restCommit(commit: CommitObject) {
  return { sha: commit.sha, parents: commit.parents.map((sha) => ({ sha })), author: { login: commit.author }, commit: { message: commit.message, author: { name: commit.author, date: commit.date }, committer: { date: commit.date } } };
}

/**
 * source 저장소의 경로면 답하고 `true`를 돌려준다. 이 저장소의 경로가 아니면 `false` — 호출자(mock-ghe)가 이어서 처리한다.
 */
export function handleMockSource(
  repos: readonly MockSourceRepository[],
  request: IncomingMessage,
  response: ServerResponse,
  options: MockSourceOptions,
  rawReads: MockRawRead[],
  headers: Record<string, string>,
): boolean {
  const url = new URL(request.url ?? '/', 'http://localhost');
  const match = /^\/api\/v3\/repos\/([^/]+)\/([^/]+)(\/.*)?$/.exec(url.pathname);
  if (match === null) return false;
  const repo = repos.find((one) => one.owner === decodeURIComponent(match[1] ?? '') && one.repo === decodeURIComponent(match[2] ?? ''));
  if (repo === undefined) return false;
  const rest = match[3] ?? '';
  const accept = String(request.headers.accept ?? '');
  const send = (status: number, body: unknown, extra: Record<string, string> = {}): true => {
    response.writeHead(status, { 'content-type': 'application/json', ...headers, ...extra });
    response.end(JSON.stringify(body));
    return true;
  };
  const notFound = (): true => send(404, { message: 'Not Found' });
  const page = Math.max(1, Number(url.searchParams.get('page') ?? '1'));
  const perPage = Math.min(100, Math.max(1, Number(url.searchParams.get('per_page') ?? '30')));
  /** `Link: rel="next"`까지 붙여 한 페이지를 보낸다. `cap`은 GitHub의 원천 상한이다. */
  const paged = <T>(items: readonly T[], cap = Number.POSITIVE_INFINITY, wrap?: (slice: T[]) => unknown): true => {
    const visible = items.slice(0, cap);
    const slice = visible.slice((page - 1) * perPage, page * perPage);
    const extra: Record<string, string> = {};
    if (page * perPage < visible.length) {
      const next = new URL(url.toString()); next.searchParams.set('page', String(page + 1));
      extra['link'] = `<http://ghe.invalid${next.pathname}${next.search}>; rel="next"`;
    }
    return send(200, wrap ? wrap(slice) : slice, extra);
  };

  if (rest === '') return send(200, { full_name: `${repo.owner}/${repo.repo}`, default_branch: repo.branch, private: true, visibility: 'internal' });
  let found = /^\/branches\/(.+)$/.exec(rest);
  if (found !== null) {
    return decodeURIComponent(found[1] ?? '') === repo.branch ? send(200, { name: repo.branch, commit: { sha: repo.commitShas.at(-1) } }) : notFound();
  }
  found = /^\/git\/commits\/([0-9a-f]{40})$/.exec(rest);
  if (found !== null) {
    const commit = repo.commits.get(found[1] ?? '');
    if (commit === undefined) return notFound();
    return send(200, { sha: commit.sha, tree: { sha: commit.tree }, parents: commit.parents.map((sha) => ({ sha })), message: commit.message, author: { name: commit.author, date: commit.date }, committer: { date: commit.date } });
  }
  found = /^\/git\/trees\/([0-9a-f]{40})$/.exec(rest);
  if (found !== null) {
    const entries = repo.trees.get(found[1] ?? '');
    if (entries === undefined) return notFound();
    return send(200, { sha: found[1], truncated: false, tree: entries.map((entry) => ({ path: entry.name, mode: entry.mode, type: entry.type, sha: entry.sha, ...(entry.size === undefined ? {} : { size: entry.size }) })) });
  }
  found = /^\/git\/blobs\/([0-9a-f]{40})$/.exec(rest);
  if (found !== null) {
    const bytes = repo.blobs.get(found[1] ?? '');
    if (bytes === undefined) return notFound();
    if (!accept.includes('raw')) return send(200, { sha: found[1], size: bytes.length, encoding: 'base64', content: bytes.toString('base64') });
    streamRaw(response, bytes, headers, options, rawReads, url.pathname);
    return true;
  }
  found = /^\/contents\/(.+)$/.exec(rest);
  if (found !== null) {
    const commit = repo.commits.get(url.searchParams.get('ref') ?? '');
    if (commit === undefined) return notFound();
    const path = (found[1] ?? '').split('/').map(decodeURIComponent).join('/');
    const entry = lookup(repo, commit.tree, path);
    if (entry === undefined || entry === null) return notFound();
    const object = accept.includes('object');
    if (entry.type === 'tree') {
      const entries = (repo.trees.get(entry.sha) ?? []).map((item) => ({ type: item.type === 'tree' ? 'dir' : item.type === 'commit' ? 'submodule' : 'file', name: item.name, path: `${path}/${item.name}`, sha: item.sha, size: item.size ?? 0 }));
      return send(200, object ? { type: 'dir', name: entry.name, path, sha: entry.sha, size: 0, entries } : entries);
    }
    if (entry.type === 'commit') return send(200, { type: 'submodule', name: entry.name, path, sha: entry.sha, size: 0, submodule_git_url: 'https://ghe.invalid/other.git' });
    const bytes = repo.blobs.get(entry.sha) ?? Buffer.alloc(0);
    if (entry.mode === MODE.symlink) return send(200, { type: 'symlink', name: entry.name, path, sha: entry.sha, size: bytes.length, target: bytes.toString('utf8') });
    const inline = bytes.length <= CONTENTS_INLINE_MAX;
    if (!inline && !object) {
      // 1MB를 넘는 파일은 기본 미디어 타입으로 주지 않는다 — GitHub가 raw·object만 받는다.
      return send(403, { message: 'This API returns blobs up to 1 MB in size. The requested blob is too large to fetch via the API, but you can use the Git Data API to request blobs up to 100 MB in size.', errors: [{ resource: 'Blob', field: 'data', code: 'too_large' }] });
    }
    return send(200, { type: 'file', name: entry.name, path, sha: entry.sha, size: bytes.length, encoding: inline ? 'base64' : 'none', content: inline ? bytes.toString('base64') : '' });
  }
  found = /^\/compare\/([0-9a-f]{40})\.\.\.([0-9a-f]{40})$/.exec(rest);
  if (found !== null) {
    const base = found[1] ?? ''; const head = found[2] ?? '';
    // 선형 이력이므로 더 오래된 쪽이 merge-base다.
    const baseIndex = repo.commitShas.indexOf(base); const headIndex = repo.commitShas.indexOf(head);
    if (baseIndex < 0 || headIndex < 0) return notFound();
    return send(200, { merge_base_commit: { sha: repo.commitShas[Math.min(baseIndex, headIndex)] } });
  }
  found = /^\/pulls\/(\d+)(\/files)?$/.exec(rest);
  if (found !== null) {
    const pull = repo.pulls.get(Number(found[1]));
    if (pull === undefined) return notFound();
    const files = changedFiles(repo, repo.commits.get(pull.base)?.tree ?? null, repo.commits.get(pull.head)?.tree ?? '');
    if (found[2] === undefined) return send(200, { number: pull.number, title: pull.title, body: pull.body, head: { sha: pull.head }, base: { sha: pull.base }, changed_files: files.length });
    return paged(files, GITHUB_CHANGED_FILES_LIMIT);
  }
  found = /^\/commits\/([0-9a-f]{40})\/pulls$/.exec(rest);
  if (found !== null) {
    const numbers = repo.commitPulls.get(found[1] ?? '') ?? [];
    return paged(numbers.map((number) => ({ number, title: `PR ${String(number)}`, body: null, head: { sha: found?.[1] }, base: { sha: found?.[1] } })));
  }
  found = /^\/commits\/([0-9a-f]{40})$/.exec(rest);
  if (found !== null) {
    const commit = repo.commits.get(found[1] ?? '');
    if (commit === undefined) return notFound();
    const parent = commit.parents[0] === undefined ? null : repo.commits.get(commit.parents[0])?.tree ?? null;
    const files = changedFiles(repo, parent, commit.tree);
    return paged(files, GITHUB_CHANGED_FILES_LIMIT, (slice) => ({ ...restCommit(commit), files: slice }));
  }
  if (rest === '/commits') {
    // 경로 이력: 첫 부모를 따라가며 그 경로의 객체가 바뀐 커밋만.
    const start = url.searchParams.get('sha') ?? repo.commitShas.at(-1) ?? '';
    const path = url.searchParams.get('path') ?? '';
    const out: ReturnType<typeof restCommit>[] = [];
    for (let commit = repo.commits.get(start); commit !== undefined;) {
      const parent = commit.parents[0] === undefined ? undefined : repo.commits.get(commit.parents[0]);
      const mine = path === '' ? commit.tree : lookup(repo, commit.tree, path)?.sha;
      const theirs = parent === undefined ? undefined : path === '' ? parent.tree : lookup(repo, parent.tree, path)?.sha;
      if (mine !== theirs) out.push(restCommit(commit));
      commit = parent;
    }
    return paged(out);
  }
  return notFound();
}

/** 원시 본문을 조각으로 흘려 보낸다. 받는 쪽이 끊으면 거기서 멈추고 `closedEarly`로 남긴다. */
function streamRaw(response: ServerResponse, bytes: Buffer, headers: Record<string, string>, options: MockSourceOptions, rawReads: MockRawRead[], path: string): void {
  const read: MockRawRead = { path, bytesSent: 0, closedEarly: false, finished: false };
  rawReads.push(read);
  response.writeHead(200, { 'content-type': 'application/vnd.github.raw', ...headers });
  response.on('close', () => { if (!response.writableFinished) read.closedEarly = true; });
  const chunk = options.rawChunkBytes ?? 64 * 1024;
  void (async () => {
    for (let offset = 0; offset < bytes.length; offset += chunk) {
      if (response.destroyed) return;
      const part = bytes.subarray(offset, offset + chunk);
      read.bytesSent += part.length;
      if (!response.write(part)) await Promise.race([once(response, 'drain'), once(response, 'close')]);
      if ((options.rawDelayMs ?? 0) > 0) await new Promise((resolve) => setTimeout(resolve, options.rawDelayMs));
    }
    if (!response.destroyed) { response.end(); read.finished = true; }
  })();
}
