/**
 * CR-132 / WP-113: 파일·디렉터리·변경 목록의 총량 제한을 이어 읽기로 바꾼 동작과, 한 요청의 기한·취소.
 *
 * 대역 리더로 service와 경로를 본다. 실제 HTTP(GHE 대역)를 거치는 전송·취소는 통합 시험이 본다.
 */

import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GitHubApiError, type GitHubSourceReader } from '@prs/github';
import type { Pool } from '@prs/db';
import type { SourceTree } from '@prs/contracts';
import type { AuthContext } from '../auth/context.js';
import { authenticateSession } from '../auth/principal.js';
import { resolveRepository } from '../sequence/space.js';
import { recordAuditBestEffort } from '../audit/recorder.js';
import { registerSourceRoutes } from './routes.js';
import {
  GITHUB_BLOB_MAX_BYTES, SOURCE_TREE_DIFF_PAGE, SOURCE_TREE_PAGE_ENTRIES, SOURCE_WINDOW_BYTES, SourceRangeError,
  sourceComparison, sourceFileWindow, sourceTree, sourceTreeComparison, utf8Boundary,
} from './service.js';

vi.mock('../auth/principal.js', () => ({ authenticateSession: vi.fn() }));
vi.mock('../sequence/space.js', () => ({ resolveRepository: vi.fn() }));
vi.mock('../audit/recorder.js', () => ({ recordAuditBestEffort: vi.fn() }));

const SHA = 'a'.repeat(40); const PARENT = 'b'.repeat(40); const TREE = 'c'.repeat(40); const BLOB = 'd'.repeat(40);
const repo = { owner: 'acme', repo: 'app' };

/** blob 원시 창 대역 — 전송 계층의 `getRawWindow`와 같은 규칙(끝에서 딱 끝나도 eof)으로 자른다. */
function rawWindows(content: Buffer) {
  return vi.fn(async (_ref: unknown, _sha: string, window: { offset: number; length: number }) => {
    const bytes = content.subarray(window.offset, window.offset + window.length);
    return { bytes: new Uint8Array(bytes), eof: window.offset + window.length >= content.length };
  });
}
function fileReader(content: Buffer, meta: Partial<{ type: string; size: number; sha: string; encoding: string; content: string }> = {}) {
  const methods = {
    contentObject: vi.fn().mockResolvedValue({ type: 'file', size: content.length, sha: BLOB, encoding: 'none', content: '', ...meta }),
    blobWindow: rawWindows(content),
    commit: vi.fn().mockResolvedValue({ sha: SHA, tree: { sha: TREE }, parents: [], message: 'm', author: { name: 'a', date: '2026-09-29T00:00:00Z' } }),
  };
  return { methods, reader: methods as unknown as GitHubSourceReader };
}
/** 창을 끝까지 이어 읽어 합친다 — 사용자가 끝부분까지 닿는지 본다. */
async function readAll(reader: GitHubSourceReader) {
  const texts: string[] = []; const offsets: number[] = [];
  for (let offset: number | null = 0; offset !== null;) {
    offsets.push(offset);
    const window = await sourceFileWindow(reader, repo, SHA, 'big.txt', offset);
    expect(window.status).toBe('text');
    texts.push(window.text ?? '');
    offset = window.next_offset;
    if (offsets.length > 1000) throw new Error('did not converge');
  }
  return { text: texts.join(''), offsets };
}

describe('CR-132 FR-SRC-003 파일 본문의 창', () => {
  it('FR-SRC-003 256KiB·4,000줄을 넘는 파일을 1MiB 창으로 끝까지 이어 읽는다 — 창은 줄바꿈 뒤에서 끊긴다', async () => {
    const lines = Array.from({ length: 60_000 }, (_, i) => `line ${i} 가나다라 ${'x'.repeat(i % 37)}`);
    const original = `${lines.join('\n')}\n`;
    const { methods, reader } = fileReader(Buffer.from(original, 'utf8'));
    const { text, offsets } = await readAll(reader);
    expect(text).toBe(original);
    expect(offsets.length).toBeGreaterThan(2);
    for (const call of methods.blobWindow.mock.calls) expect(call[1]).toBe(BLOB);
    const first = await sourceFileWindow(reader, repo, SHA, 'big.txt', 0);
    expect(first.text?.endsWith('\n')).toBe(true);
    expect(Buffer.byteLength(first.text ?? '')).toBeLessThanOrEqual(SOURCE_WINDOW_BYTES);
    expect(first.size).toBe(Buffer.byteLength(original));
    expect(first.sha).toBe(BLOB);
  });

  it('FR-SRC-003 창보다 긴 한 줄은 UTF-8 문자 경계에서 끊어 이어 붙이면 원문과 같다', async () => {
    const original = '가'.repeat(SOURCE_WINDOW_BYTES); // 3 MiB, 줄바꿈 없음, 창 끝이 문자 가운데에 걸린다
    const { reader } = fileReader(Buffer.from(original, 'utf8'));
    const { text, offsets } = await readAll(reader);
    expect(text).toBe(original);
    expect(offsets.every(offset => offset % 3 === 0)).toBe(true);
  });

  it('FR-SRC-003 메타에 본문이 함께 오면 한 번에 끝내고, 길이가 어긋나면 blob 원시 읽기로 넘어간다', async () => {
    const small = Buffer.from('small\nfile\n');
    const inline = fileReader(small, { encoding: 'base64', content: small.toString('base64') });
    expect(await sourceFileWindow(inline.reader, repo, SHA, 'a', 0)).toMatchObject({ status: 'text', text: 'small\nfile\n', offset: 0, next_offset: null });
    expect(inline.methods.blobWindow).not.toHaveBeenCalled();
    const mismatch = fileReader(small, { encoding: 'base64', content: Buffer.from('short').toString('base64') });
    expect((await sourceFileWindow(mismatch.reader, repo, SHA, 'a', 0)).text).toBe('small\nfile\n');
    expect(mismatch.methods.blobWindow).toHaveBeenCalledTimes(1);
  });

  it('FR-SRC-003 파일 머리의 BOM은 예전처럼 떼고, 가운데 창 머리의 U+FEFF는 원문대로 남긴다', async () => {
    const head = '\uFEFFfirst\n';
    const filler = 'y'.repeat(SOURCE_WINDOW_BYTES - Buffer.byteLength(head) - 1);
    const original = `${head}${filler}\n\uFEFFsecond\n`;
    const { reader } = fileReader(Buffer.from(original, 'utf8'));
    const first = await sourceFileWindow(reader, repo, SHA, 'bom.txt', 0);
    expect(first.text?.startsWith('first')).toBe(true);
    const second = await sourceFileWindow(reader, repo, SHA, 'bom.txt', first.next_offset!);
    expect(second.text).toBe('\uFEFFsecond\n');
  });

  it('FR-SRC-003 NUL·잘못된 UTF-8은 binary, 머리의 LFS 포인터는 unsupported, 파일이 아닌 것은 unsupported다', async () => {
    const nul = Buffer.concat([Buffer.from('a'.repeat(SOURCE_WINDOW_BYTES - 1) + '\n'), Buffer.from([0x61, 0x00, 0x0a])]);
    const nulReader = fileReader(nul).reader;
    expect((await sourceFileWindow(nulReader, repo, SHA, 'x', 0)).status).toBe('text');
    expect((await sourceFileWindow(nulReader, repo, SHA, 'x', SOURCE_WINDOW_BYTES)).status).toBe('binary');
    expect((await sourceFileWindow(fileReader(Buffer.from([0xff, 0xfe, 0x0a])).reader, repo, SHA, 'x', 0)).status).toBe('binary');
    expect((await sourceFileWindow(fileReader(Buffer.from('version https://git-lfs.github.com/spec/v1\noid sha256:0\n')).reader, repo, SHA, 'x', 0)).status).toBe('unsupported');
    for (const type of ['symlink', 'submodule', 'dir']) expect((await sourceFileWindow(fileReader(Buffer.from('x'), { type }).reader, repo, SHA, 'x', 0)).status).toBe('unsupported');
  });

  it('FR-SRC-003 100MB를 넘으면 GitHub 한계라고 밝히고 본문을 읽지 않는다', async () => {
    const { methods, reader } = fileReader(Buffer.from('x'), { size: GITHUB_BLOB_MAX_BYTES + 1 });
    const result = await sourceFileWindow(reader, repo, SHA, 'huge.bin', 0);
    expect(result.status).toBe('too_large');
    expect(result.reason).toContain('GitHub');
    expect(methods.blobWindow).not.toHaveBeenCalled();
  });

  it('FR-SRC-003 파일 끝을 넘는 offset과 문자 가운데의 offset은 거절한다', async () => {
    const content = Buffer.from('가나다\n');
    const { reader } = fileReader(content);
    await expect(sourceFileWindow(reader, repo, SHA, 'x', content.length + 1)).rejects.toBeInstanceOf(SourceRangeError);
    await expect(sourceFileWindow(reader, repo, SHA, 'x', 1)).rejects.toBeInstanceOf(SourceRangeError);
    expect(await sourceFileWindow(reader, repo, SHA, 'x', content.length)).toMatchObject({ status: 'text', text: '', next_offset: null });
  });

  it('FR-SRC-003 없는 경로는 리비전이 있는지 확인한 뒤 missing이다', async () => {
    const { methods, reader } = fileReader(Buffer.from('x'));
    methods.contentObject.mockRejectedValue(new GitHubApiError('not_found', 'missing'));
    expect((await sourceFileWindow(reader, repo, SHA, 'gone', 0)).status).toBe('missing');
    expect(methods.commit).toHaveBeenCalledWith(repo, SHA, {});
  });

  it('FR-SRC-003 끝은 GitHub가 준 크기로 판정한다 — 전송이 끝이라고 해도 크기보다 적으면 잘린 파일을 내지 않고 실패한다', async () => {
    const content = Buffer.from('line one\nline two\nline three\n');
    const { methods, reader } = fileReader(content);
    // 전송이 창 뒤를 버리고 끝이라고 잘못 알린 경우(창보다 작은 바이트 + eof).
    methods.blobWindow.mockResolvedValueOnce({ bytes: new Uint8Array(content.subarray(0, 12)), eof: true });
    await expect(sourceFileWindow(reader, repo, SHA, 'x', 0)).rejects.toThrow('ended before its declared size');
    // 전송이 끝을 모른다고 해도(eof false) 받은 바이트가 크기에 닿으면 끝이다 — 마지막 줄을 잘라 다음 창을 만들지 않는다.
    methods.blobWindow.mockResolvedValueOnce({ bytes: new Uint8Array(Buffer.from('tail without newline')), eof: false });
    methods.contentObject.mockResolvedValueOnce({ type: 'file', size: 20, sha: BLOB, encoding: 'none', content: '' });
    expect(await sourceFileWindow(reader, repo, SHA, 'x', 0)).toMatchObject({ status: 'text', text: 'tail without newline', next_offset: null });
  });

  it('utf8Boundary는 완전한 문자로 끝나면 그대로, 문자 가운데면 그 문자 앞에서 자른다', () => {
    const bytes = Buffer.from('a가😀', 'utf8'); // 1 + 3 + 4
    expect(utf8Boundary(bytes)).toBe(bytes.length);
    expect(utf8Boundary(bytes.subarray(0, 5))).toBe(4);
    expect(utf8Boundary(bytes.subarray(0, 3))).toBe(1);
    expect(utf8Boundary(bytes.subarray(0, 1))).toBe(1);
  });
});

describe('CR-132 FR-SRC-001 디렉터리 목록의 페이지', () => {
  function treeReader(count: number, truncated = false) {
    const tree = Array.from({ length: count }, (_, i) => ({ path: `f${String(i).padStart(5, '0')}`, type: i % 10 === 0 ? 'tree' : 'blob', mode: i % 10 === 0 ? '040000' : '100644', sha: SHA }));
    const methods = { tree: vi.fn().mockResolvedValue({ sha: TREE, tree, truncated }), commit: vi.fn().mockResolvedValue({ sha: SHA, tree: { sha: TREE }, parents: [] }), repository: vi.fn(), branch: vi.fn() };
    return { methods, reader: methods as unknown as GitHubSourceReader };
  }
  it('FR-SRC-001 5,000개를 넘는 디렉터리를 정렬한 목록의 페이지로 끝까지 읽는다 — 트리 SHA로 고정된다', async () => {
    const { reader } = treeReader(12_345);
    const pages: SourceTree[] = []; let offset: number | null = 0; let treeSha = '';
    while (offset !== null) {
      const page = await sourceTree(reader, repo, { ref: SHA, path: '', ...(treeSha ? { treeSha, revision: SHA } : {}), offset });
      pages.push(page); treeSha = page.tree_sha; offset = page.next_offset;
    }
    expect(pages.map(page => page.entries.length)).toEqual([SOURCE_TREE_PAGE_ENTRIES, SOURCE_TREE_PAGE_ENTRIES, 12_345 - 2 * SOURCE_TREE_PAGE_ENTRIES]);
    expect(pages.every(page => page.total === 12_345 && page.truncated === false && page.tree_sha === TREE)).toBe(true);
    const all = pages.flatMap(page => page.entries);
    expect(new Set(all.map(entry => entry.name)).size).toBe(12_345);
    const firstFile = all.findIndex(entry => entry.kind !== 'directory');
    expect(all.slice(0, firstFile).every(entry => entry.kind === 'directory')).toBe(true);
    expect(all.slice(firstFile).every(entry => entry.kind !== 'directory')).toBe(true);
  });
  it('FR-SRC-001 truncated는 GitHub가 목록을 잘랐을 때뿐이고, 끝을 넘는 offset은 거절한다', async () => {
    expect((await sourceTree(treeReader(10, true).reader, repo, { ref: SHA, path: '', offset: 0 })).truncated).toBe(true);
    await expect(sourceTree(treeReader(10).reader, repo, { ref: SHA, path: '', offset: 11 })).rejects.toBeInstanceOf(SourceRangeError);
    expect(await sourceTree(treeReader(0).reader, repo, { ref: SHA, path: '', offset: 0 })).toMatchObject({ entries: [], total: 0, next_offset: null });
  });
});

describe('CR-132 FR-SRC-004 변경 목록 — 트리 비교와 관련 PR 전량', () => {
  it('FR-SRC-004 고정한 base·head의 트리를 비교해 줄 수 없는 변경 목록을 페이지로 준다', async () => {
    const trees: Record<string, { path: string; type: string; mode: string; sha: string }[]> = {
      baseRoot: [{ path: 'keep.txt', type: 'blob', mode: '100644', sha: '1'.repeat(40) }, { path: 'old.txt', type: 'blob', mode: '100644', sha: '2'.repeat(40) }],
      headRoot: [{ path: 'keep.txt', type: 'blob', mode: '100644', sha: '1'.repeat(40) }, { path: 'dir', type: 'tree', mode: '040000', sha: 'dirTree' }],
      dirTree: Array.from({ length: SOURCE_TREE_DIFF_PAGE + 5 }, (_, i) => ({ path: `n${String(i).padStart(4, '0')}`, type: 'blob', mode: '100644', sha: '3'.repeat(40) })),
    };
    const methods = {
      commit: vi.fn(async (_ref: unknown, sha: string) => ({ sha, tree: { sha: sha === SHA ? 'headRoot' : 'baseRoot' }, parents: [], message: 'head', author: { name: 'a', date: '2026-09-29T00:00:00Z' } })),
      tree: vi.fn(async (_ref: unknown, sha: string) => ({ sha, tree: trees[sha] ?? [], truncated: false })),
    };
    const reader = methods as unknown as GitHubSourceReader;
    const first = await sourceTreeComparison(reader, repo, { base: PARENT, head: SHA, after: null });
    // 일반 비교 응답처럼 pull_requests_unavailable을 언제나 싣는다(PIPE 스키마의 필수 키).
    expect(first).toMatchObject({ listing: 'tree', base: PARENT, head: SHA, pull_requests: [], pull_requests_unavailable: false, next_page: null, truncated: false });
    expect(first.files).toHaveLength(SOURCE_TREE_DIFF_PAGE);
    expect(first.files[0]).toEqual({ path: 'dir/n0000', previous_path: null, status: 'added', additions: null, deletions: null });
    const second = await sourceTreeComparison(reader, repo, { base: PARENT, head: SHA, after: first.next_after! });
    expect(second.next_after).toBeNull();
    expect(second.files.map(file => file.path)).toEqual([...Array.from({ length: 5 }, (_, i) => `dir/n${String(SOURCE_TREE_DIFF_PAGE + i).padStart(4, '0')}`), 'old.txt']);
    expect(second.files.at(-1)?.status).toBe('removed');
    const before = methods.commit.mock.calls.length;
    const root = await sourceTreeComparison(reader, repo, { base: null, head: SHA, after: null });
    expect(root.files[0]?.status).toBe('added');
    // base가 없으면(루트 커밋) 빈 트리와 비교한다 — base 커밋을 읽지 않는다.
    expect(methods.commit.mock.calls.slice(before).map(call => call[1])).toEqual([SHA]);
  });

  it('FR-SRC-004 related=all이면 연결 PR을 다섯 개에서 자르지 않고 끝까지 읽는다', async () => {
    const prs = (from: number, count: number) => Array.from({ length: count }, (_, i) => ({ number: from + i, title: `PR ${from + i}`, body: null, base: { sha: PARENT }, head: { sha: SHA } }));
    const methods = {
      commit: vi.fn().mockResolvedValue({ sha: SHA, tree: { sha: TREE }, parents: [{ sha: PARENT }], message: 'm', author: { name: 'a', date: '2026-09-29T00:00:00Z' } }),
      pullRequestsForCommit: vi.fn().mockResolvedValue(prs(1, 9)),
      pullRequestsForCommitPage: vi.fn()
        .mockResolvedValueOnce({ body: prs(1, 100), nextPage: 2 })
        .mockResolvedValueOnce({ body: prs(101, 100), nextPage: 3 })
        .mockResolvedValueOnce({ body: prs(201, 7), nextPage: null }),
      changes: vi.fn().mockResolvedValue({ body: { files: [] }, nextPage: null }),
    };
    const reader = methods as unknown as GitHubSourceReader;
    expect((await sourceComparison(reader, repo, { commit: SHA, page: 1 })).pull_requests).toHaveLength(5);
    const all = await sourceComparison(reader, repo, { commit: SHA, page: 1, related: 'all' });
    expect(all.pull_requests).toHaveLength(207);
    expect(all.pull_requests_unavailable).toBe(false);
  });

  it('FR-SRC-004 연결 PR 조회가 실패하면 비교는 남기되, 호출이 취소된 것이면 삼키지 않는다', async () => {
    const methods = {
      commit: vi.fn().mockResolvedValue({ sha: SHA, tree: { sha: TREE }, parents: [{ sha: PARENT }], message: 'm', author: { name: 'a', date: '2026-09-29T00:00:00Z' } }),
      pullRequestsForCommitPage: vi.fn().mockResolvedValueOnce({ body: [{ number: 1, title: 't', body: null }], nextPage: 2 }).mockRejectedValue(new Error('down')),
      changes: vi.fn().mockResolvedValue({ body: { files: [] }, nextPage: null }),
    };
    const reader = methods as unknown as GitHubSourceReader;
    const partial = await sourceComparison(reader, repo, { commit: SHA, page: 1, related: 'all' });
    expect(partial.pull_requests).toEqual([]);
    expect(partial.pull_requests_unavailable).toBe(true);
    const controller = new AbortController(); controller.abort();
    methods.pullRequestsForCommitPage.mockRejectedValue(new Error('aborted'));
    await expect(sourceComparison(reader, repo, { commit: SHA, page: 1, related: 'all' }, { signal: controller.signal })).rejects.toThrow('aborted');
  });
});

describe('CR-132 FR-SRC 경로 — 새 파라미터, 기한, 끊긴 연결', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(authenticateSession).mockResolvedValue({ userId: 'user-1' } as Awaited<ReturnType<typeof authenticateSession>>);
    vi.mocked(resolveRepository).mockResolvedValue({ kind: 'ok', repository: {} } as Awaited<ReturnType<typeof resolveRepository>>);
  });
  function app(methods: Record<string, unknown>, deadlineMs?: number) {
    const scopes = { resolve: vi.fn().mockResolvedValue({ kind: 'explicit', repositoryIds: [1] }) };
    // 끊긴 연결을 기다리지 않고 닫는다(시험 서버만) — 실제 소켓을 쓰는 시험이 닫기에서 몇 초를 쓰지 않게 한다.
    const server = Fastify({ forceCloseConnections: true });
    registerSourceRoutes(server, { pool: {} as Pool, auth: { sessions: {}, scopes } as unknown as AuthContext, loginPath: '/auth/login', reader: () => methods as unknown as GitHubSourceReader, ...(deadlineMs ? { deadlineMs } : {}) });
    return server;
  }
  const base = {
    repository: vi.fn().mockResolvedValue({ default_branch: 'main' }),
    branch: vi.fn().mockResolvedValue({ commit: { sha: SHA } }),
    commit: vi.fn().mockResolvedValue({ sha: SHA, tree: { sha: TREE }, parents: [], message: 'm', author: { name: 'a', date: '2026-09-29T00:00:00Z' } }),
    tree: vi.fn().mockResolvedValue({ sha: TREE, tree: [] }),
    history: vi.fn().mockResolvedValue({ body: [], nextPage: null }),
  };
  async function get(url: string, methods: Record<string, unknown> = base, deadlineMs?: number) {
    const server = app(methods, deadlineMs);
    try { return await server.inject({ method: 'GET', url }); } finally { await server.close(); }
  }

  it('FR-SRC-002 History의 1,000페이지 상한이 없다 — 50,000번째 커밋 뒤도 청할 수 있다', async () => {
    expect((await get('/api/v1/source/acme%2Fapp/history?ref=main&page=1001')).statusCode).toBe(200);
    expect(base.history).toHaveBeenCalledWith(repo, SHA, '', 1001, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    for (const page of ['0', '-1', '1.5', 'x']) expect((await get(`/api/v1/source/acme%2Fapp/history?page=${page}`)).statusCode).toBe(400);
  });

  it('FR-SRC-001 offset은 tree·file에만, 음이 아닌 정수로만 받는다', async () => {
    expect((await get(`/api/v1/source/acme%2Fapp/history?offset=0`)).statusCode).toBe(400);
    expect((await get(`/api/v1/source/acme%2Fapp/diff?commit=${SHA}&offset=0`)).statusCode).toBe(400);
    for (const offset of ['01', '-1', '1.0', '1e3', '']) expect((await get(`/api/v1/source/acme%2Fapp/tree?offset=${offset}`)).statusCode).toBe(400);
    const ok = await get('/api/v1/source/acme%2Fapp/tree?ref=main&offset=0');
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ tree_sha: TREE, offset: 0, next_offset: null, total: 0 });
  });

  it('FR-SRC-004 비교 파라미터는 diff에만, listing=tree는 전체 head SHA가 있어야 하고 일반 비교 키와 섞이지 않는다', async () => {
    for (const url of [
      '/api/v1/source/acme%2Fapp/tree?listing=tree', '/api/v1/source/acme%2Fapp/history?related=all', `/api/v1/source/acme%2Fapp/file?path=a&revision=${SHA}&after=a`,
      '/api/v1/source/acme%2Fapp/diff?listing=tree', `/api/v1/source/acme%2Fapp/diff?listing=tree&head=${SHA}&pr=1`, `/api/v1/source/acme%2Fapp/diff?listing=tree&head=${SHA}&page=2`,
      `/api/v1/source/acme%2Fapp/diff?listing=flat&head=${SHA}`, `/api/v1/source/acme%2Fapp/diff?listing=tree&head=${SHA}&base=abc`, `/api/v1/source/acme%2Fapp/diff?listing=tree&head=${SHA}&after=`,
      `/api/v1/source/acme%2Fapp/diff?commit=${SHA}&head=${SHA}`, `/api/v1/source/acme%2Fapp/diff?commit=${SHA}&related=some`,
    ]) expect({ url, status: (await get(url)).statusCode }).toEqual({ url, status: 400 });
    const tree = await get(`/api/v1/source/acme%2Fapp/diff?listing=tree&head=${SHA}&base=${PARENT}&after=${encodeURIComponent('src/a b.txt')}`);
    expect(tree.statusCode).toBe(200);
    expect(tree.json()).toMatchObject({ listing: 'tree', head: SHA, base: PARENT, next_after: null, files: [] });
  });

  it('FR-SRC-003 요청 기한이 지나면 GitHub 호출에 준 신호가 끊기고 502로 답한다', async () => {
    let seen: AbortSignal | undefined;
    const stuck = { ...base, tree: vi.fn((_ref: unknown, _sha: string, options: { signal?: AbortSignal }) => { seen = options.signal; return new Promise((_resolve, reject) => { options.signal?.addEventListener('abort', () => { reject(new GitHubApiError('timeout', 'deadline')); }); }); }) };
    const response = await get('/api/v1/source/acme%2Fapp/tree?ref=main', stuck, 50);
    expect(response.statusCode).toBe(502);
    expect(response.json().error).toEqual({ code: 'SOURCE_UNAVAILABLE', message: 'Source data could not be loaded from GitHub in time. Please retry.' });
    expect(seen?.aborted).toBe(true);
    expect(vi.mocked(recordAuditBestEffort).mock.calls.at(-1)?.[1]).toMatchObject({ resultCode: 'SOURCE_UNAVAILABLE' });
  });

  it('FR-SRC-003 정상으로 끝난 요청은 신호를 끊지 않는다(응답 뒤의 close는 취소가 아니다)', async () => {
    let seen: AbortSignal | undefined;
    const spy = { ...base, tree: vi.fn(async (_ref: unknown, _sha: string, options: { signal?: AbortSignal }) => { seen = options.signal; return { sha: TREE, tree: [] }; }) };
    expect((await get('/api/v1/source/acme%2Fapp/tree?ref=main', spy)).statusCode).toBe(200);
    await new Promise((r) => setTimeout(r, 10));
    expect(seen?.aborted).toBe(false);
  });

  it('FR-SRC-003 사용자가 연결을 끊으면 GitHub 호출에 준 신호가 끊기고 감사에는 취소로 남는다', async () => {
    let entered!: () => void; const reached = new Promise<void>((resolve) => { entered = resolve; });
    let seen: AbortSignal | undefined;
    const stuck = { ...base, tree: vi.fn((_ref: unknown, _sha: string, options: { signal?: AbortSignal }) => { seen = options.signal; entered(); return new Promise((_resolve, reject) => { options.signal?.addEventListener('abort', () => { reject(new GitHubApiError('network', 'cancelled')); }); }); }) };
    const server = app(stuck);
    const address = await server.listen({ port: 0, host: '127.0.0.1' });
    try {
      const client = new AbortController();
      const pending = fetch(`${address}/api/v1/source/acme%2Fapp/tree?ref=main`, { signal: client.signal }).catch(() => 'aborted');
      await reached;
      client.abort();
      expect(await pending).toBe('aborted');
      for (let i = 0; i < 50 && !seen?.aborted; i += 1) await new Promise((r) => setTimeout(r, 10));
      expect(seen?.aborted).toBe(true);
      for (let i = 0; i < 50 && vi.mocked(recordAuditBestEffort).mock.calls.length === 0; i += 1) await new Promise((r) => setTimeout(r, 10));
      expect(vi.mocked(recordAuditBestEffort).mock.calls.at(-1)?.[1]).toMatchObject({ resultCode: 'CANCELLED' });
    } finally {
      await server.close();
    }
  });
});
