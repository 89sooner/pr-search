/**
 * CR-133 / WP-114: Files & folders 검색이 읽는 고정 revision의 파일 경로 목록(API-SRC-005).
 *
 * 대역 리더로 service와 경로를 본다. 실제 HTTP(GHE 대역)를 거치는 재귀 목록·잘림·호출 기한은 통합 시험이 본다.
 */

import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UnauthenticatedError } from '@prs/authz';
import { GitHubApiError, type GitHubSourceReader } from '@prs/github';
import type { Pool } from '@prs/db';
import type { AuthContext } from '../auth/context.js';
import { authenticateSession } from '../auth/principal.js';
import { resolveRepository } from '../sequence/space.js';
import { recordAuditBestEffort } from '../audit/recorder.js';
import { registerSourceRoutes } from './routes.js';
import { SOURCE_PATHS_RECURSIVE_TIMEOUT_MS, SOURCE_PATHS_WALK_TREE_CALLS, sourcePaths, sourceTreeComparison } from './service.js';
import { compareTreePaths } from './tree-diff.js';

vi.mock('../auth/principal.js', () => ({ authenticateSession: vi.fn() }));
vi.mock('../sequence/space.js', () => ({ resolveRepository: vi.fn() }));
vi.mock('../audit/recorder.js', () => ({ recordAuditBestEffort: vi.fn() }));

const SHA = 'a'.repeat(40); const PARENT = 'b'.repeat(40);
const repo = { owner: 'acme', repo: 'app' };

type Kind = 'file' | 'symlink' | 'submodule';
interface Item { path: string; type: string; mode: string; sha: string }

/** 경로 → 종류로 만든 작은 Git 저장소. `tree`는 GitHub처럼 한 디렉터리를, `treeRecursive`는 전위 순서의 전체 경로를 준다. */
function fakeRepository(spec: Readonly<Record<string, Kind>>) {
  type Node = Map<string, Node | Kind>;
  const root: Node = new Map();
  for (const [path, kind] of Object.entries(spec)) {
    const parts = path.split('/'); const name = parts.pop()!;
    let dir = root;
    for (const part of parts) {
      let next = dir.get(part);
      if (!(next instanceof Map)) { next = new Map(); dir.set(part, next); }
      dir = next;
    }
    dir.set(name, kind);
  }
  const trees = new Map<string, Item[]>();
  let counter = 0;
  const nextSha = (): string => (counter++).toString(16).padStart(40, '0');
  // GitHub는 Git 순서로 준다: 디렉터리 이름 뒤에 '/'를 붙여 비교한다(그래서 a-b.c, a.c, a/ 순 — 경로 순서와 다르다).
  const gitKey = ([name, node]: [string, Node | Kind]): string => (node instanceof Map ? `${name}/` : name);
  const write = (dir: Node): string => {
    const entries = [...dir].sort((a, b) => (gitKey(a) < gitKey(b) ? -1 : 1)).map(([name, node]): Item => (node instanceof Map
      ? { path: name, type: 'tree', mode: '040000', sha: write(node) }
      : { path: name, type: node === 'submodule' ? 'commit' : 'blob', mode: node === 'symlink' ? '120000' : node === 'submodule' ? '160000' : '100644', sha: nextSha() }));
    const sha = nextSha(); trees.set(sha, entries); return sha;
  };
  const rootSha = write(root);
  const recursive = (sha: string, prefix = ''): Item[] => (trees.get(sha) ?? []).flatMap((entry) => {
    const path = prefix === '' ? entry.path : `${prefix}/${entry.path}`;
    return entry.type === 'tree' ? [{ ...entry, path }, ...recursive(entry.sha, path)] : [{ ...entry, path }];
  });
  const methods = {
    commit: vi.fn().mockResolvedValue({ sha: SHA, tree: { sha: rootSha }, parents: [], message: 'm', author: { name: 'a', date: '2026-09-29T00:00:00Z' } }),
    tree: vi.fn(async (_ref: unknown, sha: string) => ({ sha, tree: trees.get(sha) ?? [], truncated: false })),
    treeRecursive: vi.fn(async (_ref: unknown, sha: string) => ({ sha, tree: recursive(sha), truncated: false })),
  };
  /** 선택할 수 있는 잎(파일·심볼릭 링크)의 기대 목록, 경로 순서. */
  const expected = Object.entries(spec).filter(([, kind]) => kind !== 'submodule')
    .map(([path, kind]) => ({ path, kind: kind === 'symlink' ? 'symlink' : 'file' })).sort((a, b) => compareTreePaths(a.path, b.path));
  return { methods, reader: methods as unknown as GitHubSourceReader, rootSha, expected };
}

const SAMPLE: Readonly<Record<string, Kind>> = {
  'src/a/config.h': 'file', 'src/b/config.h': 'file', 'tests/config.h': 'file', 'README.md': 'file', 'docs/link': 'symlink',
  'vendor/lib': 'submodule', 'deep/1/2/3/4/5/6/7/leaf.txt': 'file', 'src/a-b.c': 'file', 'src/a.c': 'file',
};

/** 페이지를 끝까지 이어 읽는다 — 클라이언트처럼 `next_after`가 `null`일 때까지. */
async function readAllPages(reader: GitHubSourceReader, extra: { walkTreeCalls?: number } = {}) {
  const pages: Awaited<ReturnType<typeof sourcePaths>>[] = [];
  let after: string | null = null;
  do {
    const page = await sourcePaths(reader, repo, { revision: SHA, after, ...extra });
    pages.push(page);
    after = page.next_after;
  } while (after !== null && pages.length < 1000);
  return pages;
}

describe('CR-133 FR-SRC-001 고정 revision의 파일 경로 목록', () => {
  it('FR-SRC-001 재귀 목록이 잘리지 않았으면 모든 파일 경로를 한 응답에 경로 순서로 싣는다 — 디렉터리·서브모듈은 빼고 링크는 가른다', async () => {
    const { methods, reader, expected } = fakeRepository(SAMPLE);
    const signal = new AbortController().signal;
    const result = await sourcePaths(reader, repo, { revision: SHA, after: null }, { signal });
    expect(result).toEqual({ repository: 'acme/app', revision: SHA, paths: expected, next_after: null, incomplete: false });
    // 같은 이름의 파일은 경로마다 따로 나온다.
    expect(result.paths.filter(entry => entry.path.endsWith('/config.h')).map(entry => entry.path)).toEqual(['src/a/config.h', 'src/b/config.h', 'tests/config.h']);
    expect(methods.treeRecursive).toHaveBeenCalledTimes(1);
    expect(methods.treeRecursive).toHaveBeenCalledWith(repo, expect.any(String), { signal, timeoutMs: SOURCE_PATHS_RECURSIVE_TIMEOUT_MS });
    expect(methods.tree).not.toHaveBeenCalled();
  });

  it('FR-SRC-001 GitHub가 재귀 목록을 잘랐으면 비재귀로 걷는다 — 페이지를 이어 붙이면 모든 경로가 같은 순서로 정확히 한 번 나온다', async () => {
    const spec: Record<string, Kind> = { 'z.txt': 'file' };
    for (let dir = 0; dir < 30; dir += 1) for (let name = 0; name < 3; name += 1) spec[`d${String(dir).padStart(2, '0')}/f${name}`] = 'file';
    const { methods, reader, expected } = fakeRepository(spec);
    methods.treeRecursive.mockResolvedValue({ sha: 'x', tree: [], truncated: true });
    const calls: number[] = [];
    const pages: Awaited<ReturnType<typeof sourcePaths>>[] = [];
    for (let after: string | null = null, guard = 0; guard === 0 || (after !== null && guard < 1000); guard += 1) {
      const before = methods.tree.mock.calls.length;
      const page = await sourcePaths(reader, repo, { revision: SHA, after, walkTreeCalls: 5 });
      calls.push(methods.tree.mock.calls.length - before);
      pages.push(page); after = page.next_after;
    }
    expect(pages.flatMap(page => page.paths)).toEqual(expected);
    expect(pages.length).toBeGreaterThanOrEqual(6);
    expect(calls.every(count => count <= 5)).toBe(true);
    // 재귀는 첫 페이지에서 한 번만 시도한다. 이어 읽기는 늘 걷기다.
    expect(methods.treeRecursive).toHaveBeenCalledTimes(1);
    expect(pages.every(page => page.incomplete === false)).toBe(true);
  });

  it('FR-SRC-001 걷기 한 페이지의 디렉터리 수 기본 상한은 100이다', () => {
    expect(SOURCE_PATHS_WALK_TREE_CALLS).toBe(100);
    expect(SOURCE_PATHS_RECURSIVE_TIMEOUT_MS).toBe(45_000);
  });

  it.each([
    ['timeout', new GitHubApiError('timeout', 'slow')],
    ['server', new GitHubApiError('server', 'bad gateway', { status: 502 })],
  ])('FR-SRC-001 재귀 호출이 %s로 끝나면 걷기로 넘어가 전부를 읽는다', async (_kind, error) => {
    const { methods, reader, expected } = fakeRepository(SAMPLE);
    methods.treeRecursive.mockRejectedValue(error);
    const pages = await readAllPages(reader);
    expect(pages.flatMap(page => page.paths)).toEqual(expected);
    expect(methods.tree).toHaveBeenCalled();
  });

  it('FR-SRC-001 요청 기한·사용자 취소와 그 밖의 GitHub 오류는 걷기로 넘기지 않고 그대로 올린다', async () => {
    const aborted = new AbortController(); aborted.abort();
    const { methods, reader } = fakeRepository(SAMPLE);
    methods.treeRecursive.mockRejectedValue(new GitHubApiError('timeout', 'deadline'));
    await expect(sourcePaths(reader, repo, { revision: SHA, after: null }, { signal: aborted.signal })).rejects.toMatchObject({ kind: 'timeout' });
    expect(methods.tree).not.toHaveBeenCalled();
    for (const kind of ['not_found', 'auth', 'rate_limited', 'client', 'network'] as const) {
      methods.treeRecursive.mockRejectedValueOnce(new GitHubApiError(kind, kind));
      await expect(sourcePaths(reader, repo, { revision: SHA, after: null })).rejects.toMatchObject({ kind });
    }
    expect(methods.tree).not.toHaveBeenCalled();
  });

  it('FR-SRC-001 이어 읽기(after)는 재귀를 부르지 않고 커서 뒤의 경로부터 걷는다', async () => {
    const { methods, reader, expected } = fakeRepository(SAMPLE);
    const cursor = 'src/a/config.h';
    const result = await sourcePaths(reader, repo, { revision: SHA, after: cursor });
    expect(result.paths).toEqual(expected.filter(entry => compareTreePaths(entry.path, cursor) > 0));
    expect(result.next_after).toBeNull();
    expect(methods.treeRecursive).not.toHaveBeenCalled();
  });

  it('FR-SRC-001 걷기 중 GitHub가 디렉터리 목록을 잘랐으면 incomplete로 알린다', async () => {
    const { methods, reader } = fakeRepository(SAMPLE);
    methods.treeRecursive.mockResolvedValue({ sha: 'x', tree: [], truncated: true });
    const listing = methods.tree.getMockImplementation()!;
    methods.tree.mockImplementation(async (ref, sha) => ({ ...(await listing(ref, sha)), truncated: true }));
    const pages = await readAllPages(reader);
    expect(pages.some(page => page.incomplete)).toBe(true);
  });

  it('FR-SRC-004 트리 비교 목록(PIPE read.source.diff)의 항목 모양은 그대로다 — 걷기의 항목 정보가 새지 않는다', async () => {
    const baseTree = '1'.repeat(40); const headTree = '2'.repeat(40);
    const same = { path: 'a.txt', type: 'blob', mode: '100644', sha: '3'.repeat(40) };
    const trees: Record<string, Item[]> = { [baseTree]: [same], [headTree]: [same, { path: 'b.txt', type: 'blob', mode: '100644', sha: '4'.repeat(40) }] };
    const reader = {
      commit: vi.fn(async (_ref: unknown, sha: string) => ({ sha, tree: { sha: sha === SHA ? headTree : baseTree }, parents: [], message: 'm', author: { name: 'a', date: '2026-09-29T00:00:00Z' } })),
      tree: vi.fn(async (_ref: unknown, sha: string) => ({ sha, tree: trees[sha] ?? [], truncated: false })),
    } as unknown as GitHubSourceReader;
    const listing = await sourceTreeComparison(reader, repo, { base: PARENT, head: SHA, after: null });
    expect(listing.files).toEqual([{ path: 'b.txt', previous_path: null, status: 'added', additions: null, deletions: null }]);
  });
});

describe('CR-133 FR-SRC-001 경로 — /paths', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(authenticateSession).mockResolvedValue({ userId: 'user-1' } as Awaited<ReturnType<typeof authenticateSession>>);
    vi.mocked(resolveRepository).mockResolvedValue({ kind: 'ok', repository: {} } as Awaited<ReturnType<typeof resolveRepository>>);
  });
  async function request(url: string) {
    const { methods, reader } = fakeRepository(SAMPLE);
    const readerFactory = vi.fn(() => reader);
    const scopes = { resolve: vi.fn().mockResolvedValue({ kind: 'explicit', repositoryIds: [1] }) };
    const app = Fastify();
    registerSourceRoutes(app, { pool: {} as Pool, auth: { sessions: {}, scopes } as unknown as AuthContext, loginPath: '/auth/login', reader: readerFactory });
    try { return { response: await app.inject({ method: 'GET', url }), methods, readerFactory }; } finally { await app.close(); }
  }

  it('FR-SRC-001 고정 revision의 경로 목록을 no-store로 주고, 감사에는 revision·after만 남긴다(목록은 남기지 않는다)', async () => {
    const { response, methods } = await request(`/api/v1/source/acme%2Fapp/paths?revision=${SHA}`);
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(response.json()).toMatchObject({ repository: 'acme/app', revision: SHA, next_after: null, incomplete: false });
    expect(response.json().paths.map((entry: { path: string }) => entry.path)).toContain('deep/1/2/3/4/5/6/7/leaf.txt');
    expect(methods.commit).toHaveBeenCalledWith(repo, SHA, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    const audit = vi.mocked(recordAuditBestEffort).mock.calls.at(-1)?.[1];
    expect(audit).toMatchObject({ action: 'entity.view', target: 'source:paths:acme/app', resultCode: 'OK' });
    const query = String(audit?.query);
    expect(JSON.parse(query)).toMatchObject({ revision: SHA, observed_revision: SHA });
    expect(query).not.toContain('config.h');
    const cursor = await request(`/api/v1/source/acme%2Fapp/paths?revision=${SHA}&after=${encodeURIComponent('src/a/config.h')}`);
    expect(cursor.response.statusCode).toBe(200);
    expect(JSON.parse(String(vi.mocked(recordAuditBestEffort).mock.calls.at(-1)?.[1].query))).toMatchObject({ revision: SHA, after: 'src/a/config.h' });
  });

  it('FR-SRC-001 revision과 after 말고는 받지 않는다 — 짧은 SHA·빈 커서·다른 키는 400이고 GitHub를 부르지 않는다', async () => {
    for (const query of [
      '', 'revision=abc', `revision=${SHA}&path=src`, `revision=${SHA}&ref=main`, `revision=${SHA}&offset=0`, `revision=${SHA}&page=2`,
      `revision=${SHA}&listing=tree`, `revision=${SHA}&head=${SHA}`, `revision=${SHA}&tree_sha=${SHA}`, `revision=${SHA}&foo=1`,
      `revision=${SHA}&after=`, `revision=${SHA}&after=${'x'.repeat(4097)}`, `revision=${SHA}&after=%00`, `revision=${SHA}&revision=${SHA}`,
    ]) {
      const { response, methods } = await request(`/api/v1/source/acme%2Fapp/paths?${query}`);
      expect({ query: query.slice(0, 80), status: response.statusCode }).toEqual({ query: query.slice(0, 80), status: 400 });
      expect(methods.commit).not.toHaveBeenCalled();
    }
  });

  it('FR-SRC-001 세션과 저장소 범위를 GitHub보다 먼저 본다 — 범위 밖은 등록 안 된 저장소와 같은 404다', async () => {
    vi.mocked(authenticateSession).mockRejectedValueOnce(new UnauthenticatedError('missing'));
    const anonymous = await request(`/api/v1/source/acme%2Fapp/paths?revision=${SHA}`);
    expect(anonymous.response.statusCode).toBe(401);
    expect(anonymous.readerFactory).not.toHaveBeenCalled();
    for (const kind of ['forbidden', 'not_found'] as const) {
      vi.mocked(resolveRepository).mockResolvedValueOnce({ kind, message: 'do not expose' } as Awaited<ReturnType<typeof resolveRepository>>);
      const hidden = await request(`/api/v1/source/acme%2Fapp/paths?revision=${SHA}`);
      expect(hidden.response.statusCode).toBe(404);
      expect(hidden.response.json().error.message).toBe('Repository not found.');
      expect(hidden.readerFactory).not.toHaveBeenCalled();
    }
  });
});
