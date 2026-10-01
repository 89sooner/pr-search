/**
 * CR-138 / WP-119: `offset` 없는 예전 호출에도 총량 제한이 없고, 남은 제한은 GitHub의 원천 한계뿐이다.
 *
 * 대역 리더로 service와 경로를 본다. 실제 HTTP(GHE 대역)를 거치는 대형 픽스처는 통합 시험(`integration/source/source-unbounded.test.ts`)이 본다.
 */

import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GitHubApiError, type GitHubSourceReader } from '@prs/github';
import type { Pool } from '@prs/db';
import type { SourceComparison, SourceFile, SourceTree } from '@prs/contracts';
import type { AuthContext } from '../auth/context.js';
import { authenticateSession } from '../auth/principal.js';
import { resolveRepository } from '../sequence/space.js';
import { registerSourceRoutes } from './routes.js';
import {
  GITHUB_BLOB_MAX_BYTES, GITHUB_CHANGED_FILES_MAX, GITHUB_CHANGED_FILES_PAGES, GITHUB_CHANGED_FILES_PER_PAGE, SOURCE_TREE_PAGE_ENTRIES, SOURCE_WINDOW_BYTES,
  sourceComparison, sourceFileWindow,
} from './service.js';

vi.mock('../auth/principal.js', () => ({ authenticateSession: vi.fn() }));
vi.mock('../sequence/space.js', () => ({ resolveRepository: vi.fn() }));
vi.mock('../audit/recorder.js', () => ({ recordAuditBestEffort: vi.fn() }));

const SHA = 'a'.repeat(40); const PARENT = 'b'.repeat(40); const ROOT = 'c'.repeat(40); const DIR = 'd'.repeat(40); const BLOB = 'e'.repeat(40);
const repo = { owner: 'acme', repo: 'app' };
const forbidden = () => new GitHubApiError('auth', 'contents 403', { status: 403 });

/** 트리 두 단계(`assets/huge.bin`)와 Contents가 403인 리더. `size`는 트리 항목의 크기다. */
function oversizedReader(size: number) {
  const methods = {
    contentObject: vi.fn().mockRejectedValue(forbidden()),
    commit: vi.fn().mockResolvedValue({ sha: SHA, tree: { sha: ROOT }, parents: [], message: 'm', author: { name: 'a', date: '2026-10-01T00:00:00Z' } }),
    tree: vi.fn(async (_ref: unknown, sha: string) => (sha === ROOT
      ? { sha, tree: [{ path: 'assets', type: 'tree', mode: '040000', sha: DIR }] }
      : { sha, tree: [{ path: 'huge.bin', type: 'blob', mode: '100644', sha: BLOB, size }] })),
    blobWindow: vi.fn(),
  };
  return { methods, reader: methods as unknown as GitHubSourceReader };
}

describe('CR-138 FR-SRC-003 남은 크기 제한은 GitHub API의 100MB뿐이다', () => {
  it('CR-138 FR-SRC-003 Contents가 403이고 트리 항목이 100MB를 넘으면 원천 한계의 too_large다 — 크기·blob SHA를 싣고 본문을 읽지 않는다', async () => {
    const { methods, reader } = oversizedReader(GITHUB_BLOB_MAX_BYTES + 1);
    const result = await sourceFileWindow(reader, repo, SHA, 'assets/huge.bin', 0);
    expect(result).toMatchObject<Partial<SourceFile>>({ status: 'too_large', size: GITHUB_BLOB_MAX_BYTES + 1, sha: BLOB, text: null, offset: 0, next_offset: null });
    expect(result.reason).toBe('GitHub does not serve files larger than 100 MB through its API.');
    expect(methods.tree.mock.calls.map((call) => call[1])).toEqual([ROOT, DIR]);
    expect(methods.blobWindow).not.toHaveBeenCalled();
  });

  it('CR-138 FR-SRC-003 Contents가 403이어도 크기가 100MB 이하면 원래 오류(권한)를 그대로 올린다 — 크기 때문이라고 지어내지 않는다', async () => {
    const { reader } = oversizedReader(GITHUB_BLOB_MAX_BYTES);
    await expect(sourceFileWindow(reader, repo, SHA, 'assets/huge.bin', 0)).rejects.toMatchObject({ kind: 'auth', status: 403 });
    const missing = oversizedReader(10);
    await expect(sourceFileWindow(missing.reader, repo, SHA, 'assets/other.bin', 0)).rejects.toMatchObject({ kind: 'auth' });
  });

  it('CR-138 FR-SRC-003 한도 소진(403 rate_limited)이나 401은 크기를 보러 가지 않는다', async () => {
    for (const error of [new GitHubApiError('rate_limited', 'exhausted', { status: 403 }), new GitHubApiError('auth', 'bad token', { status: 401 })]) {
      const { methods, reader } = oversizedReader(GITHUB_BLOB_MAX_BYTES + 1);
      methods.contentObject.mockRejectedValue(error);
      await expect(sourceFileWindow(reader, repo, SHA, 'assets/huge.bin', 0)).rejects.toBe(error);
      expect(methods.tree).not.toHaveBeenCalled();
    }
  });

  it('CR-138 FR-SRC-003 Contents 403 뒤 트리를 걷다가 한도·취소에 걸리면 그 오류를 올린다 — 권한 오류(403)로 바꾸지 않는다', async () => {
    const limited = new GitHubApiError('secondary_rate_limited', 'slow down', { status: 429 });
    const { methods, reader } = oversizedReader(GITHUB_BLOB_MAX_BYTES + 1);
    methods.tree.mockRejectedValueOnce(limited);
    await expect(sourceFileWindow(reader, repo, SHA, 'assets/huge.bin', 0)).rejects.toBe(limited);
    const cancelled = oversizedReader(GITHUB_BLOB_MAX_BYTES + 1);
    const reason = new DOMException('The operation was aborted.', 'AbortError');
    cancelled.methods.commit.mockRejectedValueOnce(reason);
    await expect(sourceFileWindow(cancelled.reader, repo, SHA, 'assets/huge.bin', 0)).rejects.toBe(reason);
  });

  it('CR-138 FR-SRC-003 한 창보다 큰 파일도 크기만으로 거절하지 않는다 — 첫 창과 next_offset이다', async () => {
    const content = Buffer.from(Array.from({ length: 70_000 }, (_, i) => `row ${String(i)} ${'y'.repeat(20)}\n`).join(''));
    expect(content.length).toBeGreaterThan(SOURCE_WINDOW_BYTES);
    const methods = {
      contentObject: vi.fn().mockResolvedValue({ type: 'file', size: content.length, sha: BLOB, encoding: 'none', content: '' }),
      blobWindow: vi.fn(async (_ref: unknown, _sha: string, window: { offset: number; length: number }) => ({ bytes: new Uint8Array(content.subarray(window.offset, window.offset + window.length)), eof: window.offset + window.length >= content.length })),
    };
    const first = await sourceFileWindow(methods as unknown as GitHubSourceReader, repo, SHA, 'big.txt', 0);
    expect(first.status).toBe('text');
    expect(first.next_offset).toBeGreaterThan(0);
    expect(Buffer.byteLength(first.text ?? '')).toBe(first.next_offset);
  });
});

describe('CR-138 FR-SRC-003 GitHub 변경 목록의 마지막 페이지 (DEV-793)', () => {
  function comparisonReader(options: { files: number; nextPage: number | null; changedFiles?: number }) {
    const files = Array.from({ length: options.files }, (_, i) => ({ filename: `f${String(i)}`, status: 'added', additions: 1, deletions: 0 }));
    const pr = { number: 7, title: 't', body: null, head: { sha: SHA }, base: { sha: PARENT }, ...(options.changedFiles === undefined ? {} : { changed_files: options.changedFiles }) };
    const methods = {
      pullRequest: vi.fn().mockResolvedValue(pr),
      mergeBase: vi.fn().mockResolvedValue({ merge_base_commit: { sha: PARENT } }),
      commit: vi.fn().mockResolvedValue({ sha: SHA, tree: { sha: ROOT }, parents: [{ sha: PARENT }], message: 'm', author: { name: 'a', date: '2026-10-01T00:00:00Z' } }),
      changes: vi.fn().mockResolvedValue({ body: files, nextPage: options.nextPage }),
      pullRequestsForCommit: vi.fn().mockResolvedValue([]),
    };
    return methods as unknown as GitHubSourceReader;
  }
  const last = GITHUB_CHANGED_FILES_PAGES;
  const full = GITHUB_CHANGED_FILES_PER_PAGE;

  it('CR-138 FR-SRC-003 30쪽은 GitHub의 3,000개 원천 상한이다 — 100개씩 30쪽', () => {
    expect([GITHUB_CHANGED_FILES_MAX, GITHUB_CHANGED_FILES_PER_PAGE, GITHUB_CHANGED_FILES_PAGES]).toEqual([3000, 100, 30]);
  });

  it('CR-138 FR-SRC-003 PR은 마지막 페이지가 가득하거나 전체 수(changed_files)가 3,000을 넘으면 30쪽이 truncated다 — 전체 수로 거르지 않는다', async () => {
    expect((await sourceComparison(comparisonReader({ files: full, nextPage: null, changedFiles: 3001 }), repo, { pr: 7, page: last })).truncated).toBe(true);
    // 정확히 3,000개여도 마지막 페이지가 가득하면 참이다 — GHES가 경계에서 주는 changed_files를 확인하지 못했으므로 트리 비교로 한 번 더 본다.
    expect((await sourceComparison(comparisonReader({ files: full, nextPage: null, changedFiles: 3000 }), repo, { pr: 7, page: last })).truncated).toBe(true);
    // 마지막 페이지가 덜 찼어도 전체 수가 3,000을 넘으면 참이고, 둘 다 아니면 거짓이다.
    expect((await sourceComparison(comparisonReader({ files: full - 1, nextPage: null, changedFiles: 3001 }), repo, { pr: 7, page: last })).truncated).toBe(true);
    expect((await sourceComparison(comparisonReader({ files: full - 1, nextPage: null, changedFiles: 2999 }), repo, { pr: 7, page: last })).truncated).toBe(false);
    // 전체 수를 주지 않는 GitHub이면 커밋과 같이 가득 찬 마지막 페이지로 가른다.
    expect((await sourceComparison(comparisonReader({ files: full, nextPage: null }), repo, { pr: 7, page: last })).truncated).toBe(true);
  });

  it('CR-138 FR-SRC-003 커밋은 전체 수를 모른다 — 마지막 페이지가 가득하면 truncated, 덜 찼으면 아니다, 다음 링크가 있으면 늘 truncated다', async () => {
    const commit = { commit: SHA };
    expect((await sourceComparison(comparisonReader({ files: full, nextPage: null }), repo, { ...commit, page: last })).truncated).toBe(true);
    expect((await sourceComparison(comparisonReader({ files: full - 1, nextPage: null }), repo, { ...commit, page: last })).truncated).toBe(false);
    const linked = await sourceComparison(comparisonReader({ files: full, nextPage: last + 1 }), repo, { ...commit, page: last });
    expect(linked).toMatchObject<Partial<SourceComparison>>({ truncated: true, next_page: null });
  });

  it('CR-138 FR-SRC-003 마지막 페이지 앞에서는 truncated가 아니고 GitHub의 다음 페이지를 그대로 준다', async () => {
    const page = await sourceComparison(comparisonReader({ files: full, nextPage: 5, changedFiles: 9000 }), repo, { pr: 7, page: 4 });
    expect(page).toMatchObject<Partial<SourceComparison>>({ truncated: false, next_page: 5 });
  });
});

describe('CR-138 FR-SRC 경로 — offset 없는 file·tree도 창·페이지다', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(authenticateSession).mockResolvedValue({ userId: 'user-1' } as Awaited<ReturnType<typeof authenticateSession>>);
    vi.mocked(resolveRepository).mockResolvedValue({ kind: 'ok', repository: {} } as Awaited<ReturnType<typeof resolveRepository>>);
  });
  async function get(url: string, methods: Record<string, unknown>) {
    const scopes = { resolve: vi.fn().mockResolvedValue({ kind: 'explicit', repositoryIds: [1] }) };
    const server = Fastify();
    registerSourceRoutes(server, { pool: {} as Pool, auth: { sessions: {}, scopes } as unknown as AuthContext, loginPath: '/auth/login', reader: () => methods as unknown as GitHubSourceReader });
    try { return await server.inject({ method: 'GET', url }); } finally { await server.close(); }
  }

  it('CR-138 FR-SRC-003 offset 없는 /file은 object 미디어 타입의 창(offset 0)이다 — 5,000줄 파일도 한 응답에 완전하고 두 키가 있다', async () => {
    const text = 'x\n'.repeat(5000);
    const methods = { contentObject: vi.fn().mockResolvedValue({ type: 'file', size: text.length, sha: BLOB, encoding: 'base64', content: Buffer.from(text).toString('base64') }) };
    const response = await get(`/api/v1/source/acme%2Fapp/file?path=a.txt&revision=${SHA}`, methods);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'text', text, offset: 0, next_offset: null });
    expect(methods.contentObject).toHaveBeenCalledTimes(1);
  });

  it('CR-138 FR-SRC-001 offset 없는 /tree는 정렬한 첫 페이지와 next_offset이다 — 12,345개에서 5,000개로 자르고 끝내지 않는다', async () => {
    const tree = Array.from({ length: 12_345 }, (_, i) => ({ path: `f${String(i).padStart(5, '0')}`, type: 'blob', mode: '100644', sha: BLOB }));
    const methods = {
      repository: vi.fn().mockResolvedValue({ default_branch: 'main' }),
      branch: vi.fn().mockResolvedValue({ commit: { sha: SHA } }),
      commit: vi.fn().mockResolvedValue({ sha: SHA, tree: { sha: ROOT }, parents: [] }),
      tree: vi.fn().mockResolvedValue({ sha: ROOT, tree }),
    };
    const response = await get('/api/v1/source/acme%2Fapp/tree?ref=main', methods);
    expect(response.statusCode).toBe(200);
    const body = response.json<SourceTree>();
    expect(body.entries).toHaveLength(SOURCE_TREE_PAGE_ENTRIES);
    expect(body).toMatchObject({ truncated: false, tree_sha: ROOT, offset: 0, next_offset: SOURCE_TREE_PAGE_ENTRIES, total: 12_345 });
  });

  it('CR-138 FR-SRC-003 diff의 page는 GitHub의 30쪽까지다(원천 상한) — 31쪽은 400', async () => {
    const methods = { pullRequest: vi.fn(), commit: vi.fn(), changes: vi.fn() };
    expect((await get(`/api/v1/source/acme%2Fapp/diff?commit=${SHA}&page=${String(GITHUB_CHANGED_FILES_PAGES + 1)}`, methods)).statusCode).toBe(400);
    expect(methods.changes).not.toHaveBeenCalled();
  });
});
