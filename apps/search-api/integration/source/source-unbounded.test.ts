/**
 * CR-138 / WP-119 — `offset`·`listing` 없이 부르는 예전 호출에도 제품 자체의 총량 제한이 없다(실제 HTTP 위에서).
 *
 * search-api는 실제 `GitHubTransport`로 가짜 GHE(`mock-ghe` + `mock-source`)를 부른다. 가짜 GHE는 GitHub의 규칙대로 답한다 —
 * 원시 본문은 바이트 범위 없이 흘려 보내고, 1MB를 넘는 파일은 기본 미디어 타입의 Contents로 주지 않으며(403), 100MB를 넘는
 * 파일은 어느 API로도 주지 않고(403), 변경 파일 목록은 3,000개에서 멈추고 그 페이지에 다음 링크를 주지 않는다.
 *
 * - 파일: 300 KiB·4,001줄·10만 줄·5 MiB·한 줄 2.5MB를 `offset` 없이 불러도 거절하지 않는다 — 한 창에 들면 완전한 본문, 넘으면
 *   첫 창과 `next_offset`이고 이어 읽은 본문이 원문과 같다. 100MB 초과만 `too_large`(원천 한계)다.
 * - 디렉터리: 5,001개·12,000개를 `offset` 없이 불러도 정렬된 첫 페이지와 `next_offset`이고, 페이지 합집합이 경로 집합과 같다.
 * - 변경 목록: 3,000개에 닿은 GitHub 목록의 30쪽은 `truncated`이고(DEV-793), 트리 비교 목록이 실제 차이 전부다.
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
import type { SourceComparison, SourceFile, SourceTree } from '@prs/contracts';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildServer } from '../../src/server.js';
import type { AuthContext, AuthRedis } from '../../src/auth/context.js';
import { createTestRedis, migratedPool } from '../helpers.js';
import { TEST_CURSOR_KEY } from '../_cursor-fixture.js';
import { generateTestKeyPair, startMockGhe, type MockGhe } from '../../../../packages/github/testing/mock-ghe.js';
import { buildMockSource, type MockSourceRepository } from '../../../../packages/github/testing/mock-source.js';

const AUTH_CONFIG = { enabled: true, cookieSecure: true, loginPath: '/auth/login', groupRoleMap: new Map<string, never>() } as const;
const USER = 'sub-cr138-source';
const ORG = 13_801;
const OWNER = 'cr138src';
const REPOS = { files: 13_801, dirs: 13_802, changes: 13_803 } as const;
const keys = generateTestKeyPair();
const MIB = 1024 * 1024;

/** 300 KiB(307,200바이트), 3,072줄 — 줄 수는 4,000 아래라 바이트 상한만 걸린다. */
const KIB300 = Array.from({ length: 3072 }, (_, i) => `${String(i).padStart(5, '0')} ${'x'.repeat(93)}\n`).join('');
/** 4,001줄, 약 30 KB — 바이트 상한 아래라 줄 상한만 걸린다. */
const LINES4001 = Array.from({ length: 4001 }, (_, i) => `line ${String(i)}\n`).join('');
/** 10만 줄, 약 2.4 MB — 1MB를 넘어 기본 미디어 타입의 Contents가 403인 크기다. */
const LINES100K = Array.from({ length: 100_000 }, (_, i) => `${String(i).padStart(6, '0')} 결제 재시도\n`).join('');
/** 5 MiB 남짓, 한글이 섞인 줄 — 창 끝이 여러 바이트 문자의 가운데에 걸릴 수 있다. */
const BIG = Array.from({ length: 200_000 }, (_, i) => `${String(i).padStart(6, '0')} 결제 재시도 ${'abcdef'.slice(0, i % 7)}\n`).join('');
/** 줄바꿈 없는 2.5 MB 한 줄 — 창을 UTF-8 문자 경계에서 끊어야 한다. */
const ONE_LINE = '가나다라'.repeat(220_000);
/** 앞 1.2 MB는 텍스트이고 그 뒤에 NUL이 있다 — 첫 창은 텍스트, 뒤 창이 binary다. */
const LATE_BINARY = Buffer.concat([Buffer.from(Array.from({ length: 12_000 }, () => `${'t'.repeat(99)}\n`).join(''), 'utf8'), Buffer.from([0x00, 0x01, 0x02, 0x0a])]);
/** GitHub API가 주지 않는 크기 — 본문 없이 크기만 있다. */
const HUGE_BYTES = 150 * MIB;

function filesRepo(): MockSourceRepository {
  return buildMockSource({
    owner: OWNER, repo: 'files',
    commits: [{ message: 'big files', changes: {
      'kib300.txt': KIB300, 'lines4001.txt': LINES4001, 'lines100k.txt': LINES100K, 'big.txt': BIG, 'one-line.txt': ONE_LINE,
      'late-binary.dat': LATE_BINARY, 'huge.bin': { oversized: HUGE_BYTES },
      'bin.dat': Buffer.from([1, 2, 0, 3]), 'lfs.bin': 'version https://git-lfs.github.com/spec/v1\noid sha256:00\nsize 9\n',
      link: { symlink: 'kib300.txt' }, vendor: { submodule: 'e'.repeat(40) },
    } }],
  });
}

const D5001 = Array.from({ length: 5001 }, (_, i) => `f${String(i).padStart(5, '0')}.c`);
const D12000 = Array.from({ length: 12_000 }, (_, i) => `e${String(i).padStart(5, '0')}.h`);
const D12000_DIRS = Array.from({ length: 7 }, (_, i) => `sub${String(i)}`);
function dirsRepo(): MockSourceRepository {
  const changes: Record<string, string> = { 'README.md': 'dirs\n' };
  for (const name of D5001) changes[`d5001/${name}`] = `${name}\n`;
  for (const name of D12000) changes[`d12000/${name}`] = `${name}\n`;
  for (const dir of D12000_DIRS) changes[`d12000/${dir}/keep.txt`] = `${dir}\n`;
  return buildMockSource({ owner: OWNER, repo: 'dirs', commits: [{ message: 'wide directories', changes }] });
}

/** 커밋마다 바꾼 경로 — 기대 집합은 픽스처 입력에서 바로 나온다(가짜 GHE의 계산을 쓰지 않는다). */
const CHANGE_SETS: Record<string, string | null>[] = [];
function changesRepo(): MockSourceRepository {
  const base: Record<string, string | null> = {};
  for (let i = 0; i < 10; i += 1) base[`keep/k${String(i)}.c`] = `keep ${String(i)}\n`;
  // c1: 3,001개 — 하나 고치고, 하나 지우고, 2,999개 더한다.
  const c1: Record<string, string | null> = { 'keep/k1.c': 'changed\n', 'keep/k2.c': null };
  for (let i = 0; i < 2999; i += 1) c1[`a/m${String(i % 40).padStart(2, '0')}/f${String(i).padStart(4, '0')}.c`] = `a${String(i)}\n`;
  // c2: 5,200개 — c1이 더한 파일 200개를 고치고 5,000개를 새 디렉터리에 더한다.
  const c2: Record<string, string | null> = {};
  for (let i = 0; i < 200; i += 1) c2[`a/m${String(i % 40).padStart(2, '0')}/f${String(i).padStart(4, '0')}.c`] = `a${String(i)} edited\n`;
  for (let i = 0; i < 5000; i += 1) c2[`b/n${String(i % 50).padStart(2, '0')}/g${String(i).padStart(4, '0')}.c`] = `b${String(i)}\n`;
  // c3: 정확히 3,000개.
  const c3: Record<string, string | null> = {};
  for (let i = 0; i < 3000; i += 1) c3[`b/n${String(i % 50).padStart(2, '0')}/g${String(i).padStart(4, '0')}.c`] = `b${String(i)} edited\n`;
  CHANGE_SETS.push(base, c1, c2, c3);
  return buildMockSource({
    owner: OWNER, repo: 'changes',
    commits: [{ message: 'base', changes: base }, { message: '3,001 changes', changes: c1 }, { message: '5,200 changes', changes: c2 }, { message: 'exactly 3,000', changes: c3 }],
    pulls: [{ number: 31, title: '3,001 files', base: 0, head: 1 }, { number: 32, title: '5,200 files', base: 1, head: 2 }, { number: 33, title: 'exactly 3,000', base: 2, head: 3 }],
  });
}

let pool: Pool;
let redis: Redis;
let ghe: MockGhe;
let app: FastifyInstance;
let sessionId: string;
let repos: { files: MockSourceRepository; dirs: MockSourceRepository; changes: MockSourceRepository };

function readerFor(mock: MockGhe): () => GitHubSourceReader {
  const provider = new InstallationTokenProvider({ apiUrl: mock.apiUrl, appId: '13801', privateKey: keys.privateKey, refreshLeadMs: 60_000, requestTimeoutMs: 5_000 });
  const tokens = new TokenPool(provider, { installations: [{ org: OWNER, installationId: 13_801 }], quarantineThreshold: 0.1 });
  const transport = new GitHubTransport({ apiUrl: mock.apiUrl, requestTimeoutMs: 5_000, pool: tokens, scheduler: new RequestScheduler({ maxConcurrent: 8 }) });
  return () => new GitHubSourceReader(transport);
}

async function get<T>(path: string): Promise<{ status: number; body: T }> {
  const response = await app.inject({ method: 'GET', url: path, headers: { cookie: `${SESSION_COOKIE_NAME}=${sessionId}` } });
  return { status: response.statusCode, body: response.json<T>() };
}
const url = (repo: string, operation: string, query: Record<string, string | number>) =>
  `/api/v1/source/${encodeURIComponent(`${OWNER}/${repo}`)}/${operation}?${new URLSearchParams(Object.entries(query).map(([key, value]): [string, string] => [key, String(value)]))}`;

/** `offset` 없이 한 번 부르고, 응답이 `next_offset`을 주면 그 위치부터 끝까지 잇는다. */
async function readWhole(repo: string, revision: string, path: string): Promise<{ first: SourceFile; text: string; windows: number; statuses: string[] }> {
  const first = await get<SourceFile>(url(repo, 'file', { path, revision }));
  expect(first.status).toBe(200);
  const parts = [first.body.text ?? ''];
  const statuses = [first.body.status];
  let next = first.body.next_offset ?? null;
  let windows = 1;
  while (next !== null) {
    const window = await get<SourceFile>(url(repo, 'file', { path, revision, offset: next }));
    expect(window.status).toBe(200);
    statuses.push(window.body.status);
    if (window.body.status !== 'text') break;
    expect(window.body.offset).toBe(next);
    parts.push(window.body.text ?? '');
    next = window.body.next_offset ?? null;
    windows += 1;
    if (windows > 200) throw new Error('windows did not converge');
  }
  return { first: first.body, text: parts.join(''), windows, statuses };
}

async function listAll(repo: string, revision: string, entry: { path: string; sha: string }): Promise<{ pages: SourceTree[]; names: string[] }> {
  const pages: SourceTree[] = [];
  const first = await get<SourceTree>(url(repo, 'tree', { revision, tree_sha: entry.sha, path: entry.path }));
  expect(first.status).toBe(200);
  pages.push(first.body);
  for (let next = first.body.next_offset ?? null; next !== null;) {
    const page = await get<SourceTree>(url(repo, 'tree', { revision, tree_sha: first.body.tree_sha ?? entry.sha, path: entry.path, offset: next }));
    expect(page.status).toBe(200);
    pages.push(page.body);
    next = page.body.next_offset ?? null;
    if (pages.length > 100) throw new Error('pages did not converge');
  }
  return { pages, names: pages.flatMap((page) => page.entries.map((item) => item.name)) };
}

/** GitHub 목록(REST)을 30쪽까지 — 마지막 페이지의 `truncated`와 모든 파일. */
async function restPages(query: { pr: number } | { commit: string }): Promise<{ files: string[]; last: SourceComparison; pages: number }> {
  const files: string[] = [];
  let last: SourceComparison | undefined;
  let pages = 0;
  for (let page: number | null = 1; page !== null;) {
    const response: { status: number; body: SourceComparison } = await get<SourceComparison>(url('changes', 'diff', { ...('pr' in query ? { pr: query.pr } : { commit: query.commit }), page }));
    expect(response.status).toBe(200);
    files.push(...response.body.files.map((file) => file.path));
    last = response.body;
    pages += 1;
    page = response.body.next_page;
  }
  return { files, last: last!, pages };
}

async function treeListing(base: string | null, head: string): Promise<string[]> {
  const paths: string[] = [];
  for (let after: string | null = null, pages = 0; ; pages += 1) {
    const response: { status: number; body: SourceComparison } = await get<SourceComparison>(url('changes', 'diff', { listing: 'tree', head, ...(base === null ? {} : { base }), ...(after === null ? {} : { after }) }));
    expect(response.status).toBe(200);
    expect(response.body.truncated).toBe(false);
    paths.push(...response.body.files.map((file) => file.path));
    after = response.body.next_after ?? null;
    if (after === null) return paths;
    if (pages > 100) throw new Error('listing did not converge');
  }
}

beforeAll(async () => {
  pool = await migratedPool();
  redis = createTestRedis();
  repos = { files: filesRepo(), dirs: dirsRepo(), changes: changesRepo() };
  ghe = await startMockGhe({ source: { repositories: Object.values(repos), rawChunkBytes: 100_003 } });

  await pool.query('DELETE FROM permission_cache WHERE user_id = $1', [USER]);
  await pool.query('DELETE FROM audit_record WHERE user_id = $1', [USER]);
  await pool.query('DELETE FROM app_user WHERE user_id = $1', [USER]);
  await pool.query('DELETE FROM repository WHERE repository_id = ANY($1)', [Object.values(REPOS)]);
  await authRepo.upsertUserOnLogin(pool, { user_id: USER, login: 'cr138-source-kim', github_user_id: 1_380_001 });
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
}, 240_000);

afterAll(async () => {
  await app?.close();
  await ghe?.close();
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
  }).create({ sessionId, userId: USER, login: 'cr138-source-kim', email: null, roles: ['developer'], issuedAt: now, lastSeenAt: now, correlationId: null });
});

describe('CR-138 FR-SRC-003 offset 없는 파일 조회도 크기·줄 수로 거절하지 않는다 (실제 전송)', () => {
  it('CR-138 FR-SRC-003 300 KiB(3,072줄) 파일은 한 응답에 완전한 본문이다 — 256 KiB 상한이 없다', async () => {
    const { first, text, windows } = await readWhole('files', repos.files.commitShas[0]!, 'kib300.txt');
    expect(first.status).toBe('text');
    expect(first.offset).toBe(0);
    expect(first.next_offset).toBeNull();
    expect(first.size).toBe(Buffer.byteLength(KIB300));
    expect(windows).toBe(1);
    expect(text).toBe(KIB300);
  });

  it('CR-138 FR-SRC-003 4,001줄 파일은 한 응답에 완전한 본문이다 — 4,000줄 상한이 없다', async () => {
    const { first, text } = await readWhole('files', repos.files.commitShas[0]!, 'lines4001.txt');
    expect(first.status).toBe('text');
    expect(first.next_offset).toBeNull();
    expect(text).toBe(LINES4001);
    expect(text.split('\n').length - 1).toBe(4001);
  });

  it('CR-138 FR-SRC-003 1MB를 넘는 10만 줄 파일은 권한 오류(503)가 아니라 첫 창과 next_offset이고, 이어 읽으면 원문과 같다', async () => {
    const { first, text, windows } = await readWhole('files', repos.files.commitShas[0]!, 'lines100k.txt');
    expect(first.status).toBe('text');
    expect(first.offset).toBe(0);
    expect(first.next_offset).toBeGreaterThan(0);
    expect(first.next_offset!).toBeLessThanOrEqual(MIB);
    expect(first.size).toBe(Buffer.byteLength(LINES100K));
    expect(windows).toBe(3);
    expect(text).toBe(LINES100K);
    expect(text.split('\n').length - 1).toBe(100_000);
  });

  it('CR-138 FR-SRC-003 5 MiB 파일과 줄바꿈 없는 2.5 MB 한 줄을 offset 없이 시작해 끝까지 이으면 원문과 바이트까지 같다 (UTF-8 경계)', async () => {
    const big = await readWhole('files', repos.files.commitShas[0]!, 'big.txt');
    expect(big.text).toBe(BIG);
    expect(big.windows).toBeGreaterThanOrEqual(5);
    const line = await readWhole('files', repos.files.commitShas[0]!, 'one-line.txt');
    expect(line.text).toBe(ONE_LINE);
    expect(line.windows).toBe(3);
  });

  it('CR-138 FR-SRC-003 100MB를 넘는 파일만 too_large다 — 원천(GitHub API) 한계이고 크기를 싣는다, offset이 있든 없든 같다', async () => {
    const queries: Record<string, number>[] = [{}, { offset: 0 }];
    for (const query of queries) {
      const { status, body } = await get<SourceFile>(url('files', 'file', { path: 'huge.bin', revision: repos.files.commitShas[0]!, ...query }));
      expect(status).toBe(200);
      expect(body.status).toBe('too_large');
      expect(body.text).toBeNull();
      expect(body.size).toBe(HUGE_BYTES);
      expect(body.next_offset).toBeNull();
      expect(body.reason).toMatch(/GitHub/);
      expect(body.reason).toMatch(/100 MB/);
      expect(body.reason).not.toMatch(/256 KiB|4,000 lines/);
    }
  });

  it('CR-138 FR-SRC-003 크기와 무관한 제한(binary·LFS·서브모듈·심볼릭 링크)은 그대로 구분한다', async () => {
    const revision = repos.files.commitShas[0]!;
    const status = async (path: string) => (await get<SourceFile>(url('files', 'file', { path, revision }))).body;
    expect((await status('bin.dat')).status).toBe('binary');
    expect((await status('lfs.bin')).status).toBe('unsupported');
    expect((await status('vendor')).status).toBe('unsupported');
    expect((await status('link')).status).toBe('unsupported');
    // 뒤 창에서 NUL이 나오면 그 창이 binary다 — 앞 창의 텍스트를 완전한 본문으로 내지 않는다.
    const late = await readWhole('files', revision, 'late-binary.dat');
    expect(late.first.status).toBe('text');
    expect(late.first.next_offset).not.toBeNull();
    expect(late.statuses.at(-1)).toBe('binary');
  });
});

describe('CR-138 FR-SRC-001 offset 없는 디렉터리 조회도 5,000개에서 자르지 않는다 (실제 전송)', () => {
  const entryOf = (name: string) => {
    const root = repos.dirs.trees.get(repos.dirs.commits.get(repos.dirs.commitShas[0]!)!.tree)!;
    const found = root.find((item) => item.name === name)!;
    return { path: name, sha: found.sha };
  };

  it('CR-138 FR-SRC-001 5,001개 디렉터리 — 첫 응답은 정렬된 5,000개와 next_offset이고 truncated가 아니다, 두 페이지의 합이 5,001개 전부다', async () => {
    const revision = repos.dirs.commitShas[0]!;
    const { pages, names } = await listAll('dirs', revision, entryOf('d5001'));
    expect(pages[0]!.entries).toHaveLength(5000);
    expect(pages[0]!.truncated).toBe(false);
    expect(pages[0]!.next_offset).toBe(5000);
    expect(pages[0]!.total).toBe(5001);
    expect(pages[0]!.offset).toBe(0);
    expect(pages[0]!.tree_sha).toBe(entryOf('d5001').sha);
    expect(pages).toHaveLength(2);
    expect(names).toHaveLength(5001);
    expect(new Set(names)).toEqual(new Set(D5001));
  });

  it('CR-138 FR-SRC-001 12,000개 파일과 하위 디렉터리 — 페이지를 끝까지 이으면 중복·누락 없이 전부이고 디렉터리가 먼저다', async () => {
    const revision = repos.dirs.commitShas[0]!;
    const { pages, names } = await listAll('dirs', revision, entryOf('d12000'));
    expect(pages).toHaveLength(3);
    expect(names).toHaveLength(12_007);
    expect(new Set(names)).toEqual(new Set([...D12000, ...D12000_DIRS]));
    expect(pages[0]!.entries.slice(0, 7).every((item) => item.kind === 'directory')).toBe(true);
    expect(pages.every((page) => page.truncated === false)).toBe(true);
  });

  it('CR-138 FR-SRC-001 루트 조회(ref만)도 페이지 모양이다 — tree_sha·offset·next_offset·total이 있다', async () => {
    const { status, body } = await get<SourceTree>(url('dirs', 'tree', { ref: 'main' }));
    expect(status).toBe(200);
    expect(body.revision).toBe(repos.dirs.commitShas[0]);
    expect(body.offset).toBe(0);
    expect(body.next_offset).toBeNull();
    expect(body.total).toBe(3);
    expect(body.tree_sha).toBe(repos.dirs.commits.get(repos.dirs.commitShas[0]!)!.tree);
  });
});

describe('CR-138 FR-SRC-003 GitHub 목록이 3,000개에 닿으면 30쪽이 truncated이고 트리 비교가 실제 차이 전부다 (DEV-793)', () => {
  const expectedPaths = (index: number) => new Set(Object.keys(CHANGE_SETS[index]!));

  it('CR-138 FR-SRC-003 3,001개를 바꾼 PR·커밋 — GitHub 목록은 3,000개에서 멈추고 30쪽이 truncated다, 트리 비교 목록은 3,001개 전부다', async () => {
    const pr = await restPages({ pr: 31 });
    expect(pr.pages).toBe(30);
    expect(pr.files).toHaveLength(3000);
    expect(pr.last.next_page).toBeNull();
    expect(pr.last.truncated).toBe(true);
    const commit = await restPages({ commit: repos.changes.commitShas[1]! });
    expect(commit.files).toHaveLength(3000);
    expect(commit.last.truncated).toBe(true);
    const listed = await treeListing(pr.last.base, pr.last.head);
    expect(listed).toHaveLength(3001);
    expect(new Set(listed)).toEqual(expectedPaths(1));
  });

  it('CR-138 FR-SRC-003 5,200개를 바꾼 PR — 트리 비교 목록을 끝까지 이으면 중복·누락 없이 실제 차이 전부다', async () => {
    const pr = await restPages({ pr: 32 });
    expect(pr.last.truncated).toBe(true);
    const listed = await treeListing(pr.last.base, pr.last.head);
    expect(listed).toHaveLength(5200);
    expect(new Set(listed)).toEqual(expectedPaths(2));
  });

  it('CR-138 FR-SRC-003 정확히 3,000개 — PR은 changed_files로 완전함을 알아 truncated가 아니다, 커밋은 총수를 몰라 30쪽이 가득하면 truncated다(트리 비교가 같은 3,000개를 준다)', async () => {
    const pr = await restPages({ pr: 33 });
    expect(pr.files).toHaveLength(3000);
    expect(pr.last.truncated).toBe(false);
    const commit = await restPages({ commit: repos.changes.commitShas[3]! });
    expect(commit.files).toHaveLength(3000);
    expect(commit.last.truncated).toBe(true);
    const listed = await treeListing(commit.last.base, commit.last.head);
    expect(new Set(listed)).toEqual(expectedPaths(3));
  });
});
