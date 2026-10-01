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

/**
 * `oversized`는 본문 없이 크기만 있는 파일이다 (CR-138). 트리 항목은 그 크기를 싣고, Contents·Blobs API는 GitHub처럼 본문을
 * 주지 않는다(403 `too_large`) — 100MB를 넘는 blob을 메모리에 만들지 않고 원천 한계를 모형으로 만든다.
 */
export type MockFileContent = string | Buffer | { readonly submodule: string } | { readonly symlink: string } | { readonly oversized: number };

export interface MockSourceCommitInput {
  readonly message: string;
  readonly author?: string;
  /**
   * 작성자의 GHE 로그인 (CR-135). 기본은 `author`와 같다. `null`이면 작성자 이메일과 맞는 계정이 없는 커밋이다 —
   * GitHub는 REST의 `author`와 GraphQL의 `author.user`를 `null`로 준다.
   */
  readonly login?: string | null;
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
interface CommitObject { readonly sha: string; readonly tree: string; readonly parents: readonly string[]; readonly message: string; readonly author: string; readonly login: string | null; readonly date: string }

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
  /** 본문 없이 크기만 있는 blob의 SHA → 크기 (CR-138, `{ oversized }`). */
  readonly oversized: ReadonlyMap<string, number>;
  /** 커밋 `index`의 `path`에 있는 blob SHA (단언용). */
  blobAt(index: number, path: string): string | undefined;
}

export interface MockSourceOptions {
  /** 원시 본문을 흘려 보내는 조각 크기. 기본 64 KiB. */
  readonly rawChunkBytes?: number;
  /** 조각 사이의 지연(ms). 취소 시험에서 전송 도중을 만든다. 기본 0. */
  readonly rawDelayMs?: number;
  /**
   * 재귀 트리(`recursive`)가 주는 최대 항목 수 (CR-133). 넘으면 GitHub처럼 앞부분만 주고 `truncated: true`다(GitHub의 실제
   * 한계는 10만 항목·7MB). 기본은 제한 없음.
   */
  readonly recursiveLimit?: number;
  /** 재귀 트리 응답을 늦추는 시간(ms) (CR-133). 호출 기한을 넘긴 재귀 목록이 걷기로 넘어가는지 본다. 기본 0. */
  readonly recursiveDelayMs?: number;
  /**
   * 요청 하나를 GitHub 대신 실패시킨다 (CR-138 — 한도·일시 장애 시험). 저장소 뒤의 경로(쿼리 포함, 예: `/git/blobs/<sha>`)와
   * `Accept`를 받아 상태(와 헤더)를 돌려주면 그 응답으로 끝내고, `undefined`면 평소대로 답한다.
   */
  readonly fail?: (request: { readonly path: string; readonly accept: string }) => { readonly status: number; readonly headers?: Readonly<Record<string, string>> } | undefined;
}

export interface MockRawRead { readonly path: string; bytesSent: number; closedEarly: boolean; finished: boolean }

const MODE = { file: '100644', tree: '040000', gitTree: '40000', symlink: '120000', submodule: '160000' } as const;
/** GitHub가 PR·커밋의 변경 파일을 나열하는 원천 상한. */
export const GITHUB_CHANGED_FILES_LIMIT = 3000;
/** Contents·Blobs API가 본문을 주는 최대 크기 (GitHub 문서의 100MB). 넘는 blob은 두 API 모두 주지 않는다 (CR-138). */
export const GITHUB_API_BLOB_MAX = 100 * 1024 * 1024;
/** 100MB를 넘는 blob에 대한 응답 — GitHub 문서는 상태를 적지 않는다. 1MB 제한과 같은 모양의 403으로 둔다. */
const BLOB_TOO_LARGE = { message: 'This API returns blobs up to 100 MB in size. The requested blob is too large to fetch via the API.', errors: [{ resource: 'Blob', field: 'data', code: 'too_large' }] } as const;
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
  const oversized = new Map<string, number>();
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
      } else if ('oversized' in content) {
        // 본문이 없으므로 SHA는 크기에서 만든 자리표시다 — 같은 크기의 가상 파일은 같은 blob이다.
        const sha = gitHash('blob', Buffer.from(`oversized ${String(content.oversized)}`, 'utf8'));
        oversized.set(sha, content.oversized);
        entries.push({ name, mode: MODE.file, type: 'blob', sha, size: content.oversized });
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
    commits.set(sha, { sha, tree, parents, message: commit.message, author, login: commit.login === undefined ? author : commit.login, date });
    commitShas.push(sha);
    snapshots.push(files);
    previous = files;
  });

  const pulls = new Map((input.pulls ?? []).map((pull) => [pull.number, { number: pull.number, title: pull.title, body: pull.body ?? null, base: commitShas[pull.base] ?? '', head: commitShas[pull.head] ?? '' }] as const));
  const commitPulls = new Map(Object.entries(input.commitPulls ?? {}).map(([index, numbers]) => [commitShas[Number(index)] ?? '', numbers] as const));
  return {
    owner: input.owner, repo: input.repo, branch: input.branch ?? 'main', commitShas, trees, blobs, commits, pulls, commitPulls, oversized,
    blobAt: (index, path) => {
      const content = snapshots[index]?.get(path);
      if (content === undefined) return undefined;
      if (typeof content === 'string' || Buffer.isBuffer(content)) return gitHash('blob', asBuffer(content));
      if ('oversized' in content) return gitHash('blob', Buffer.from(`oversized ${String(content.oversized)}`, 'utf8'));
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
  return { sha: commit.sha, parents: commit.parents.map((sha) => ({ sha })), author: commit.login === null ? null : { login: commit.login }, commit: { message: commit.message, author: { name: commit.author, date: commit.date }, committer: { date: commit.date } } };
}

/** blame의 한 구간 (CR-135). 줄 번호는 1부터다. */
export interface MockBlameRange { readonly startingLine: number; readonly endingLine: number; readonly age: number; readonly commit: CommitObject }
export type MockBlameResult =
  | { readonly kind: 'no_object' }
  | { readonly kind: 'not_commit'; readonly typename: 'Tree' | 'Blob' }
  | { readonly kind: 'no_file' }
  | { readonly kind: 'ok'; readonly oid: string; readonly ranges: readonly MockBlameRange[] };

interface BlameLine { readonly text: string; readonly commit: CommitObject }

function splitLines(bytes: Buffer | undefined): string[] {
  if (bytes === undefined || bytes.length === 0) return [];
  const lines = bytes.toString('utf8').split('\n');
  if (lines.at(-1) === '') lines.pop();
  return lines;
}

/**
 * 앞 본문의 귀속을 새 본문에 옮긴다 (CR-135). 앞뒤 공통 줄을 먼저 떼고 가운데만 LCS로 맞춘다 — 맞은 줄은 앞 귀속을
 * 물려받고, 새 줄·바뀐 줄은 `commit`의 것이다.
 */
function carryAttribution(previous: readonly BlameLine[], texts: readonly string[], commit: CommitObject): BlameLine[] {
  const same = (line: BlameLine | undefined, text: string | undefined): boolean => line !== undefined && line.text === text;
  let head = 0;
  while (head < previous.length && head < texts.length && same(previous[head], texts[head])) head += 1;
  let tail = 0;
  while (tail < previous.length - head && tail < texts.length - head && same(previous[previous.length - 1 - tail], texts[texts.length - 1 - tail])) tail += 1;
  const before = previous.slice(head, previous.length - tail);
  const after = texts.slice(head, texts.length - tail);
  // lcs[i][j] = before[i..]와 after[j..]의 최장 공통 부분열 길이
  const lcs = Array.from({ length: before.length + 1 }, () => new Array<number>(after.length + 1).fill(0));
  const at = (i: number, j: number): number => lcs[i]?.[j] ?? 0;
  for (let i = before.length - 1; i >= 0; i -= 1) {
    for (let j = after.length - 1; j >= 0; j -= 1) {
      const row = lcs[i];
      if (row !== undefined) row[j] = same(before[i], after[j]) ? at(i + 1, j + 1) + 1 : Math.max(at(i + 1, j), at(i, j + 1));
    }
  }
  const middle: BlameLine[] = [];
  let i = 0;
  let j = 0;
  while (j < after.length) {
    const kept = before[i];
    const text = after[j] ?? '';
    if (kept !== undefined && kept.text === text) { middle.push(kept); i += 1; j += 1; }
    else if (kept !== undefined && at(i + 1, j) >= at(i, j + 1)) i += 1;
    else { middle.push({ text, commit }); j += 1; }
  }
  return [...previous.slice(0, head), ...middle, ...previous.slice(previous.length - tail)];
}

/**
 * 한 리비전의 파일 blame을 이력에서 계산한다 (CR-135, GHE 대역의 `Commit.blame`).
 *
 * 첫 부모를 따라 오래된 커밋부터 보며, 그 경로의 blob이 바뀐 커밋마다 앞 본문과 줄을 LCS로 맞춘다. 파일이 지워졌다 다시
 * 생기면 귀속을 새로 시작하고, 이름 바꾸기는 따라가지 않는다. 같은 커밋이 이어지는 줄은 한 구간으로 묶고, age는 구간에
 * 나오는 커밋 가운데 가장 새것 1 ~ 가장 오래된 것 10으로 고르게 매긴다(GitHub의 분위 계산을 흉내 내지 않는다).
 */
export function mockBlame(repo: MockSourceRepository, revision: string, path: string): MockBlameResult {
  const target = repo.commits.get(revision);
  if (target === undefined) {
    if (repo.trees.has(revision)) return { kind: 'not_commit', typename: 'Tree' };
    if (repo.blobs.has(revision)) return { kind: 'not_commit', typename: 'Blob' };
    return { kind: 'no_object' };
  }
  const blobOf = (commit: CommitObject): string | undefined => {
    const entry = lookup(repo, commit.tree, path);
    return entry !== undefined && entry !== null && entry.type === 'blob' ? entry.sha : undefined;
  };
  if (blobOf(target) === undefined) return { kind: 'no_file' };

  const chain: CommitObject[] = [];
  for (let commit: CommitObject | undefined = target; commit !== undefined;) {
    chain.unshift(commit);
    const parent: string | undefined = commit.parents[0];
    commit = parent === undefined ? undefined : repo.commits.get(parent);
  }
  let lines: BlameLine[] = [];
  let previousBlob: string | undefined;
  for (const commit of chain) {
    const blob = blobOf(commit);
    if (blob === previousBlob) continue;
    previousBlob = blob;
    lines = blob === undefined ? [] : carryAttribution(lines, splitLines(repo.blobs.get(blob)), commit);
  }

  const groups: { startingLine: number; endingLine: number; commit: CommitObject }[] = [];
  lines.forEach((line, index) => {
    const last = groups.at(-1);
    if (last !== undefined && last.commit === line.commit) last.endingLine = index + 1;
    else groups.push({ startingLine: index + 1, endingLine: index + 1, commit: line.commit });
  });
  const order = new Map(chain.map((commit, index) => [commit.sha, index] as const));
  const positions = groups.map((group) => order.get(group.commit.sha) ?? 0);
  const newest = Math.max(0, ...positions);
  const span = newest - Math.min(newest, ...positions);
  const ranges = groups.map((group, index) => ({
    ...group,
    age: span === 0 ? 1 : 1 + Math.round((9 * (newest - (positions[index] ?? newest))) / span),
  }));
  return { kind: 'ok', oid: target.sha, ranges };
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
  const injected = options.fail?.({ path: `${rest}${url.search}`, accept });
  if (injected !== undefined) return send(injected.status, { message: 'Injected failure' }, { ...injected.headers });
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
    const item = (entry: TreeEntry, path: string) => ({ path, mode: entry.mode, type: entry.type, sha: entry.sha, ...(entry.size === undefined ? {} : { size: entry.size }) });
    if (url.searchParams.has('recursive')) {
      // GitHub의 재귀 목록: 루트 기준 전체 경로, 디렉터리 항목도 싣는다(전위 순서). 값과 무관하게 파라미터가 있으면 재귀다.
      const all: ReturnType<typeof item>[] = [];
      const walk = (list: readonly TreeEntry[], prefix: string): void => {
        for (const entry of list) {
          const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
          all.push(item(entry, path));
          if (entry.type === 'tree') walk(repo.trees.get(entry.sha) ?? [], path);
        }
      };
      walk(entries, '');
      const limit = options.recursiveLimit ?? Number.POSITIVE_INFINITY;
      const body = { sha: found[1], truncated: all.length > limit, tree: all.slice(0, limit) };
      const delay = options.recursiveDelayMs ?? 0;
      if (delay <= 0) return send(200, body);
      // 호출자가 기한으로 끊었으면 쓰지 않는다.
      setTimeout(() => { if (!response.destroyed) send(200, body); }, delay);
      return true;
    }
    return send(200, { sha: found[1], truncated: false, tree: entries.map((entry) => item(entry, entry.name)) });
  }
  found = /^\/git\/blobs\/([0-9a-f]{40})$/.exec(rest);
  if (found !== null) {
    if (repo.oversized.has(found[1] ?? '')) return send(403, BLOB_TOO_LARGE);
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
    // 100MB를 넘는 파일은 어느 미디어 타입으로도 주지 않는다 — GitHub 문서의 「Greater than 100 MB: This endpoint is not supported」.
    if ((entry.size ?? 0) > GITHUB_API_BLOB_MAX) return send(403, BLOB_TOO_LARGE);
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
