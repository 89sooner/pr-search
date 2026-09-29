/**
 * CR-132 / WP-113 — source 조회의 총량 제한 해소를 실제 HTTP 위에서 본다.
 *
 * search-api는 실제 `GitHubTransport`(설치 토큰·스케줄러·원시 창 읽기)로 가짜 GHE(`mock-ghe` + `mock-source`)를
 * 부른다. 가짜 GHE는 blob·tree·commit SHA를 내용으로 계산하고 GitHub의 규칙(원시 본문은 바이트 범위 없이 흘려
 * 보냄, 변경 파일 목록 3,000개 상한, 1MB 넘는 Contents는 object·raw만)대로 답한다. PostgreSQL·Redis는 실제다.
 *
 * - 파일: 5MB·20만 줄 파일과 2.5MB 한 줄 파일을 창으로 끝까지 읽고 원문과 같은지, 창 하나가 blob의 나머지를 받지 않는지
 * - 디렉터리: 12,345개 디렉터리를 페이지로 끝까지
 * - 변경 목록: 3,600개 파일을 바꾼 커밋·PR — GitHub 목록은 3,000개에서 멈추고, 트리 비교 목록이 전부를 준다
 * - 이력: 50,100개 커밋 경로의 1,001번째 페이지
 * - 관련 PR: 7개를 다섯 개에서 자르지 않는다
 * - 보호: 사용자가 끊으면 GHE 전송도 끊기고 감사에 CANCELLED, 요청 기한이 지나면 502와 GHE 전송 중단
 */

import {
  AccessScopeResolver,
  SESSION_COOKIE_NAME,
  SessionStore,
  createScopeDatabase,
  createSessionId,
  scopeKey,
  type AccessScopeSource,
} from '@prs/authz';
import { authRepo, repositoryRepo, type Pool } from '@prs/db';
import type { Redis } from '@prs/bus';
import { GitHubSourceReader, GitHubTransport, InstallationTokenProvider, RequestScheduler, TokenPool } from '@prs/github';
import type { SourceComparison, SourceFile, SourceHistory, SourceTree } from '@prs/contracts';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildServer } from '../../src/server.js';
import type { AuthContext, AuthRedis } from '../../src/auth/context.js';
import { SOURCE_TREE_DIFF_PAGE, SOURCE_TREE_PAGE_ENTRIES, SOURCE_WINDOW_BYTES } from '../../src/source/service.js';
import { createTestRedis, migratedPool } from '../helpers.js';
import { TEST_CURSOR_KEY } from '../_cursor-fixture.js';
import { generateTestKeyPair, startMockGhe, type MockGhe } from '../../../../packages/github/testing/mock-ghe.js';
import { GITHUB_CHANGED_FILES_LIMIT, buildMockSource, type MockSourceRepository } from '../../../../packages/github/testing/mock-source.js';

const AUTH_CONFIG = { enabled: true, cookieSecure: true, loginPath: '/auth/login', groupRoleMap: new Map<string, never>() } as const;
const USER = 'sub-cr132-source';
const ORG = 13_201;
const OWNER = 'cr132src';
const REPOS = { files: 13_201, wide: 13_202, massive: 13_203, deep: 13_204 } as const;
const keys = generateTestKeyPair();

/** 5MB 남짓, 20만 줄. 줄마다 다르고 한글이 섞여 창 끝이 문자 가운데에 걸릴 수 있다. */
const BIG = Array.from({ length: 200_000 }, (_, i) => `${String(i).padStart(6, '0')} 결제 재시도 ${'abcdef'.slice(0, i % 7)}\n`).join('');
const BIG_EDITED = `${BIG.slice(0, -40)}마지막 줄을 바꿨다\n`;
/** 줄바꿈 없는 2.5MB 한 줄 — 창을 UTF-8 문자 경계에서 끊어야 한다. */
const ONE_LINE = '가나다라'.repeat(220_000);

function files(): MockSourceRepository {
  return buildMockSource({
    owner: OWNER, repo: 'files',
    commits: [
      { message: 'add files', changes: { 'big.txt': BIG, 'one-line.txt': ONE_LINE, 'small.txt': 'small\n', 'lfs.bin': 'version https://git-lfs.github.com/spec/v1\noid sha256:00\nsize 9\n', 'bin.dat': Buffer.from([1, 2, 0, 3]), link: { symlink: 'small.txt' }, vendor: { submodule: 'e'.repeat(40) } } },
      { message: 'edit the end of big.txt', changes: { 'big.txt': BIG_EDITED } },
    ],
    commitPulls: { 1: [11, 12, 13, 14, 15, 16, 17] },
  });
}
function wide(): MockSourceRepository {
  const changes: Record<string, string> = { 'README.md': 'wide\n' };
  for (let i = 0; i < 12_345; i += 1) changes[`wide/entry-${String(i).padStart(5, '0')}.c`] = `int v${String(i)};\n`;
  for (let i = 0; i < 30; i += 1) changes[`wide/sub-${String(i).padStart(2, '0')}/keep.h`] = `#define K${String(i)}\n`;
  return buildMockSource({ owner: OWNER, repo: 'wide', commits: [{ message: 'wide directory', changes }] });
}
function massive(): MockSourceRepository {
  const base: Record<string, string> = {};
  for (let i = 0; i < 10; i += 1) base[`keep/k${String(i)}.c`] = `keep ${String(i)}\n`;
  const change: Record<string, string | null> = { 'keep/k1.c': 'changed\n', 'keep/k2.c': null, 'keep/k3.c': 'changed too\n' };
  for (let i = 0; i < 3_600; i += 1) change[`pkg/m${String(i % 60).padStart(2, '0')}/f${String(i).padStart(4, '0')}.c`] = `f${String(i)}\n`;
  return buildMockSource({ owner: OWNER, repo: 'massive', commits: [{ message: 'base', changes: base }, { message: 'import vendor tree', changes: change }], pulls: [{ number: 5, title: 'Huge import', base: 0, head: 1 }] });
}
function deep(): MockSourceRepository {
  return buildMockSource({ owner: OWNER, repo: 'deep', commits: Array.from({ length: 50_100 }, (_, i) => ({ message: `revision ${String(i)}`, changes: { 'src/app.c': `rev ${String(i)}\n` } })) });
}

let pool: Pool;
let redis: Redis;
let ghe: MockGhe;
let slowGhe: MockGhe;
let app: FastifyInstance;
let slowApp: FastifyInstance;
let deadlineApp: FastifyInstance;
let sessionId: string;
let repos: { files: MockSourceRepository; wide: MockSourceRepository; massive: MockSourceRepository; deep: MockSourceRepository };

function readerFor(mock: MockGhe): () => GitHubSourceReader {
  const provider = new InstallationTokenProvider({ apiUrl: mock.apiUrl, appId: '13201', privateKey: keys.privateKey, refreshLeadMs: 60_000, requestTimeoutMs: 5_000 });
  const tokens = new TokenPool(provider, { installations: [{ org: OWNER, installationId: 13_201 }], quarantineThreshold: 0.1 });
  const transport = new GitHubTransport({ apiUrl: mock.apiUrl, requestTimeoutMs: 5_000, pool: tokens, scheduler: new RequestScheduler({ maxConcurrent: 8 }) });
  return () => new GitHubSourceReader(transport);
}

async function get<T>(server: FastifyInstance, path: string): Promise<{ status: number; body: T }> {
  const response = await server.inject({ method: 'GET', url: path, headers: { cookie: `${SESSION_COOKIE_NAME}=${sessionId}` } });
  return { status: response.statusCode, body: response.json<T>() };
}
const url = (repo: string, operation: string, query: Record<string, string | number>) =>
  `/api/v1/source/${encodeURIComponent(`${OWNER}/${repo}`)}/${operation}?${new URLSearchParams(Object.entries(query).map(([key, value]): [string, string] => [key, String(value)]))}`;

async function readFile(server: FastifyInstance, repo: string, revision: string, path: string): Promise<{ text: string; windows: SourceFile[] }> {
  const windows: SourceFile[] = [];
  for (let offset: number | null = 0; offset !== null;) {
    const { status, body }: { status: number; body: SourceFile } = await get<SourceFile>(server, url(repo, 'file', { path, revision, offset }));
    expect(status).toBe(200);
    windows.push(body);
    offset = body.next_offset ?? null;
    if (windows.length > 200) throw new Error('windows did not converge');
  }
  return { text: windows.map((window) => window.text ?? '').join(''), windows };
}

beforeAll(async () => {
  pool = await migratedPool();
  redis = createTestRedis();
  repos = { files: files(), wide: wide(), massive: massive(), deep: deep() };
  const repositories = Object.values(repos);
  ghe = await startMockGhe({ source: { repositories, rawChunkBytes: 64 * 1024, rawDelayMs: 1 } });
  // 느린 GHE — 5MB를 64KiB씩 40ms 간격으로 흘린다(3초 남짓). 전송 도중의 취소·기한을 만든다.
  slowGhe = await startMockGhe({ source: { repositories: [repos.files], rawChunkBytes: 64 * 1024, rawDelayMs: 40 } });

  await pool.query('DELETE FROM permission_cache WHERE user_id = $1', [USER]);
  await pool.query('DELETE FROM audit_record WHERE user_id = $1', [USER]);
  await pool.query('DELETE FROM app_user WHERE user_id = $1', [USER]);
  await pool.query('DELETE FROM repository WHERE repository_id = ANY($1)', [Object.values(REPOS)]);
  await authRepo.upsertUserOnLogin(pool, { user_id: USER, login: 'cr132-source-kim', github_user_id: 1_320_001 });
  for (const [name, id] of Object.entries(REPOS)) {
    await repositoryRepo.upsertRepository(pool, { repository_id: id, owner: OWNER, name, org_id: ORG, visibility: 'internal', sequence_branches: ['main'] });
  }

  const redisPort: AuthRedis = {
    get: (key) => redis.get(key),
    set: (key, value, mode, seconds) => redis.set(key, value, mode, seconds),
    del: (...keysToDelete) => redis.del(...keysToDelete),
    scan: (cursor, m, pattern, c, n) => redis.scan(cursor, m, pattern, c, n),
  };
  const source: AccessScopeSource = { fetch: async () => ({ repositoryIds: Object.values(REPOS), orgIds: [ORG], teamIds: [], visibilities: ['public', 'internal'] }) };
  const auth: AuthContext = {
    sessions: new SessionStore({ redis: redisPort }),
    scopes: new AccessScopeResolver({ redis: redisPort, db: createScopeDatabase(pool), source }),
    forget: async (ids) => { if (ids.length > 0) await redis.del(...ids.map(scopeKey)); },
  };
  const config = { port: 0, adminTokens: [], metricsQueryUrl: null, gheBaseUrl: null, auth: AUTH_CONFIG, searchCursorKey: TEST_CURSOR_KEY };
  app = buildServer({ config, auth, source: { pool, reader: readerFor(ghe) } });
  await app.ready();
  slowApp = buildServer({ config, auth, source: { pool, reader: readerFor(slowGhe) } });
  await slowApp.listen({ port: 0, host: '127.0.0.1' });
  deadlineApp = buildServer({ config, auth, source: { pool, reader: readerFor(slowGhe), deadlineMs: 600 } });
  await deadlineApp.ready();
}, 240_000);

afterAll(async () => {
  await app?.close();
  await slowApp?.close();
  await deadlineApp?.close();
  await ghe?.close();
  await slowGhe?.close();
  await pool?.query('DELETE FROM permission_cache WHERE user_id = $1', [USER]);
  await pool?.query('DELETE FROM audit_record WHERE user_id = $1', [USER]);
  await pool?.query('DELETE FROM app_user WHERE user_id = $1', [USER]);
  await pool?.query('DELETE FROM repository WHERE repository_id = ANY($1)', [Object.values(REPOS)]);
  await redis?.quit();
  await pool?.end();
});

beforeEach(async () => {
  await redis.del(scopeKey(USER));
  sessionId = createSessionId();
  const now = Date.now();
  await new SessionStore({
    redis: {
      get: (key) => redis.get(key),
      set: (key, value, mode, seconds) => redis.set(key, value, mode, seconds),
      del: (...keysToDelete) => redis.del(...keysToDelete),
      scan: (cursor, m, pattern, c, n) => redis.scan(cursor, m, pattern, c, n),
    },
  }).create({ sessionId, userId: USER, login: 'cr132-source-kim', email: null, roles: ['developer'], issuedAt: now, lastSeenAt: now, correlationId: null });
});

/** 감사는 응답을 보낸 뒤 쓰인다 — 조건에 맞는 행이 나타날 때까지 기다린다. */
async function auditWhere(match: (row: { query: string; result_code: string }) => boolean): Promise<{ query: string; result_code: string }> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const { rows } = await pool.query<{ query: string; result_code: string }>('SELECT query, result_code FROM audit_record WHERE user_id = $1 ORDER BY occurred_at DESC, audit_id DESC LIMIT 20', [USER]);
    const found = rows.find(match);
    if (found !== undefined) return found;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('no matching audit row');
}

describe('CR-132 FR-SRC-003 큰 파일을 끝까지 (실제 전송)', () => {
  it('FR-SRC-003 5MB·20만 줄 파일을 1MiB 창으로 끝까지 읽고 원문과 같다 — 창은 blob SHA로 고정되고 줄바꿈 뒤에서 끊긴다', async () => {
    const revision = repos.files.commitShas[1]!;
    const { text, windows } = await readFile(app, 'files', revision, 'big.txt');
    expect(text).toBe(BIG_EDITED);
    expect(text.endsWith('마지막 줄을 바꿨다\n')).toBe(true);
    expect(windows.length).toBeGreaterThanOrEqual(5);
    expect(windows.every((window) => window.status === 'text' && window.sha === repos.files.blobAt(1, 'big.txt') && window.size === Buffer.byteLength(BIG_EDITED))).toBe(true);
    expect(windows.slice(0, -1).every((window) => window.text?.endsWith('\n') && Buffer.byteLength(window.text) <= SOURCE_WINDOW_BYTES)).toBe(true);
    const accepts = ghe.requests.map((request) => request.accept ?? '');
    expect(accepts).toContain('application/vnd.github.object+json');
    expect(accepts).toContain('application/vnd.github.raw+json');
    // 예전 호출(offset 없음)은 그대로다: 1MB를 넘는 파일을 기본 미디어 타입으로 청해 GitHub의 거절을 받는다.
    expect((await get(app, url('files', 'file', { path: 'big.txt', revision }))).status).toBe(503);
  });

  it('FR-SRC-003 줄바꿈 없는 2.5MB 한 줄을 문자 경계에서 끊어 이으면 원문과 같다', async () => {
    const { text, windows } = await readFile(app, 'files', repos.files.commitShas[1]!, 'one-line.txt');
    expect(text).toBe(ONE_LINE);
    expect(windows.length).toBeGreaterThanOrEqual(3);
  });

  it('FR-SRC-003 앞 창 하나를 읽으려고 blob의 나머지를 받지 않는다 — 창을 채우면 GHE 전송을 끊는다', async () => {
    const before = ghe.rawReads().length;
    const { body } = await get<SourceFile>(app, url('files', 'file', { path: 'big.txt', revision: repos.files.commitShas[0]!, offset: 0 }));
    expect(body.next_offset).not.toBeNull();
    const read = ghe.rawReads()[before];
    expect(read).toBeDefined();
    for (let i = 0; i < 50 && !read!.closedEarly; i += 1) await new Promise((resolve) => setTimeout(resolve, 10));
    expect(read!.closedEarly).toBe(true);
    expect(read!.bytesSent).toBeLessThan(Buffer.byteLength(BIG) / 2);
  });

  it('FR-SRC-003 binary·LFS·심볼릭 링크·서브모듈은 크기와 무관하게 예전 판정 그대로다', async () => {
    const revision = repos.files.commitShas[0]!;
    const status = async (path: string) => (await get<SourceFile>(app, url('files', 'file', { path, revision, offset: 0 }))).body.status;
    expect(await status('bin.dat')).toBe('binary');
    expect(await status('lfs.bin')).toBe('unsupported');
    expect(await status('link')).toBe('unsupported');
    expect(await status('vendor')).toBe('unsupported');
    expect(await status('small.txt')).toBe('text');
    expect(await status('absent.txt')).toBe('missing');
  });
});

describe('CR-132 FR-SRC-001 5,000개를 넘는 디렉터리 (실제 전송)', () => {
  it('FR-SRC-001 12,375개 디렉터리를 트리 SHA로 고정한 페이지로 끝까지 읽는다', async () => {
    const root = await get<SourceTree>(app, url('wide', 'tree', { ref: 'main', offset: 0 }));
    expect(root.status).toBe(200);
    const dir = root.body.entries.find((entry) => entry.name === 'wide');
    expect(dir?.kind).toBe('directory');
    const pages: SourceTree[] = [];
    for (let offset: number | null = 0; offset !== null;) {
      const { status, body }: { status: number; body: SourceTree } = await get<SourceTree>(app, url('wide', 'tree', { revision: root.body.revision, tree_sha: dir!.sha, path: 'wide', offset }));
      expect(status).toBe(200);
      pages.push(body);
      offset = body.next_offset ?? null;
    }
    const entries = pages.flatMap((page) => page.entries);
    expect(pages.map((page) => page.entries.length)).toEqual([SOURCE_TREE_PAGE_ENTRIES, SOURCE_TREE_PAGE_ENTRIES, 12_375 - 2 * SOURCE_TREE_PAGE_ENTRIES]);
    expect(new Set(entries.map((entry) => entry.path)).size).toBe(12_375);
    expect(entries.slice(0, 30).every((entry) => entry.kind === 'directory')).toBe(true);
    expect(entries.at(-1)?.path).toBe('wide/entry-12344.c');
    expect(pages.every((page) => page.total === 12_375 && page.truncated === false && page.tree_sha === dir!.sha)).toBe(true);
  });
});

describe('CR-132 FR-SRC-004 3,000개를 넘는 변경 (실제 전송)', () => {
  it('FR-SRC-004 GitHub 목록은 3,000개에서 멈추고, 트리 비교 목록은 고정한 SHA로 3,603개 전부를 준다', async () => {
    const head = repos.massive.commitShas[1]!;
    let listed = 0; let last: SourceComparison | undefined;
    for (let page = 1; page <= 30; page += 1) {
      const { status, body } = await get<SourceComparison>(app, url('massive', 'diff', { commit: head, page }));
      expect(status).toBe(200);
      listed += body.files.length; last = body;
      if (body.next_page === null) break;
    }
    expect(listed).toBe(GITHUB_CHANGED_FILES_LIMIT);
    expect(last?.next_page).toBeNull();
    const base = last!.base!;
    const changes: SourceComparison['files'] = [];
    let pages = 0;
    for (let after: string | null = null; ;) {
      const { status, body }: { status: number; body: SourceComparison } = await get<SourceComparison>(app, url('massive', 'diff', { listing: 'tree', head, base, ...(after === null ? {} : { after }) }));
      expect(status).toBe(200);
      expect(body).toMatchObject({ listing: 'tree', head, base, truncated: false, pull_requests: [] });
      changes.push(...body.files); pages += 1;
      after = body.next_after ?? null;
      if (after === null) break;
    }
    // 픽스처의 변경: 3,600개 추가 + 2개 수정 + 1개 삭제.
    expect(changes).toHaveLength(3_603);
    expect(pages).toBe(Math.ceil(3_603 / SOURCE_TREE_DIFF_PAGE));
    expect(new Set(changes.map((change) => change.path)).size).toBe(3_603);
    expect(changes.find((change) => change.path === 'keep/k2.c')?.status).toBe('removed');
    expect(changes.find((change) => change.path === 'keep/k1.c')?.status).toBe('modified');
    expect(changes.every((change) => change.additions === null && change.deletions === null && change.previous_path === null)).toBe(true);
  });

  it('FR-SRC-004 PR도 일반 비교의 base·head(merge-base)를 그대로 넘겨 전부를 본다', async () => {
    const first = await get<SourceComparison>(app, url('massive', 'diff', { pr: 5, page: 1 }));
    expect(first.status).toBe(200);
    expect(first.body.base).toBe(repos.massive.commitShas[0]);
    const tree = await get<SourceComparison>(app, url('massive', 'diff', { listing: 'tree', head: first.body.head, base: first.body.base! }));
    expect(tree.body.files).toHaveLength(SOURCE_TREE_DIFF_PAGE);
    expect(tree.body.next_after).not.toBeNull();
    const audit = await auditWhere((row) => row.query.includes('"listing":"tree"'));
    expect(audit.result_code).toBe('OK');
    expect(JSON.parse(audit.query)).toMatchObject({ listing: 'tree', head: first.body.head, base: first.body.base });
  });
});

describe('CR-132 FR-SRC-002·004 이력과 관련 PR (실제 전송)', () => {
  it('FR-SRC-002 50,000번째 커밋 뒤의 History 페이지를 읽는다', async () => {
    const head = repos.deep.commitShas.at(-1)!;
    const { status, body } = await get<SourceHistory>(app, url('deep', 'history', { ref: head, path: 'src/app.c', page: 1001 }));
    expect(status).toBe(200);
    expect(body.commits).toHaveLength(50);
    expect(body.commits[0]?.message).toBe(`revision ${String(50_100 - 1 - 50_000)}`);
    expect(body.next_page).toBe(1002);
    const lastPage = await get<SourceHistory>(app, url('deep', 'history', { ref: head, path: 'src/app.c', page: 1002 }));
    expect(lastPage.body.commits.at(-1)?.message).toBe('revision 0');
    expect(lastPage.body.next_page).toBeNull();
  }, 60_000);

  it('FR-SRC-004 related=all은 연결 PR 7개를 모두 주고, 예전 호출은 다섯 개다', async () => {
    const commit = repos.files.commitShas[1]!;
    expect((await get<SourceComparison>(app, url('files', 'diff', { commit }))).body.pull_requests).toHaveLength(5);
    expect((await get<SourceComparison>(app, url('files', 'diff', { commit, related: 'all' }))).body.pull_requests.map((pr) => pr.number)).toEqual([11, 12, 13, 14, 15, 16, 17]);
  });
});

describe('CR-132 FR-SRC-003 한 요청의 보호 — 취소와 기한 (실제 소켓)', () => {
  it('FR-SRC-003 사용자가 연결을 끊으면 GHE 원시 전송도 끊기고 감사에는 CANCELLED로 남는다', async () => {
    const address = slowApp.server.address();
    const port = typeof address === 'object' && address !== null ? address.port : 0;
    const before = slowGhe.rawReads().length;
    const client = new AbortController();
    const pending = fetch(`http://127.0.0.1:${String(port)}${url('files', 'file', { path: 'big.txt', revision: repos.files.commitShas[0]!, offset: 4_194_304 })}`, {
      headers: { cookie: `${SESSION_COOKIE_NAME}=${sessionId}` }, signal: client.signal,
    }).catch(() => 'aborted');
    for (let i = 0; i < 100 && slowGhe.rawReads().length === before; i += 1) await new Promise((resolve) => setTimeout(resolve, 20));
    await new Promise((resolve) => setTimeout(resolve, 200));
    client.abort();
    expect(await pending).toBe('aborted');
    const read = slowGhe.rawReads()[before]!;
    for (let i = 0; i < 100 && !read.closedEarly; i += 1) await new Promise((resolve) => setTimeout(resolve, 20));
    expect(read.closedEarly).toBe(true);
    expect(read.finished).toBe(false);
    expect(read.bytesSent).toBeLessThan(Buffer.byteLength(BIG));
    const audit = await auditWhere((row) => row.result_code === 'CANCELLED');
    expect(JSON.parse(audit.query)).toMatchObject({ path: 'big.txt', offset: '4194304' });
    expect(audit.query).not.toContain('결제 재시도');
  });

  it('FR-SRC-003 요청 기한이 지나면 502로 답하고 GHE 원시 전송을 끊는다', async () => {
    const before = slowGhe.rawReads().length;
    const { status, body } = await get<{ error: { code: string; message: string } }>(deadlineApp, url('files', 'file', { path: 'big.txt', revision: repos.files.commitShas[0]!, offset: 4_194_304 }));
    expect(status).toBe(502);
    expect(body.error).toEqual({ code: 'SOURCE_UNAVAILABLE', message: 'Source data could not be loaded from GitHub in time. Please retry.' });
    const read = slowGhe.rawReads()[before]!;
    for (let i = 0; i < 100 && !read.closedEarly; i += 1) await new Promise((resolve) => setTimeout(resolve, 20));
    expect(read.closedEarly).toBe(true);
    expect(read.finished).toBe(false);
  });
});
