/**
 * CR-133 / WP-114 — Files & folders 검색이 읽는 파일 경로 목록(API-SRC-005)을 실제 HTTP 위에서 본다.
 *
 * search-api는 실제 `GitHubTransport`로 가짜 GHE(`mock-ghe` + `mock-source`)를 부른다. 가짜 GHE는 GitHub처럼 재귀 트리를
 * 루트 기준 전체 경로의 전위 순서(Git 순서)로 주고, `recursiveLimit`을 넘으면 앞부분만 주며 `truncated`를 세운다.
 * PostgreSQL·Redis는 실제다.
 *
 * - 한 번도 PR에 오르지 않은 파일·깊은 파일·같은 이름의 파일 셋을 한 응답으로, 경로 순서대로
 * - 재귀 목록이 잘리면 하위 트리를 걸어 페이지로 끝까지(한 페이지의 디렉터리 호출은 상한 안)
 * - 재귀 호출이 제 기한을 넘기면 걷기로 끝까지
 * - 범위 밖 저장소는 GHE를 부르지 않는 동일 404, 감사는 페이지마다 한 행이고 경로 목록은 남지 않는다
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
import type { SourcePaths } from '@prs/contracts';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildServer } from '../../src/server.js';
import type { AuthContext, AuthRedis } from '../../src/auth/context.js';
import { SOURCE_PATHS_WALK_TREE_CALLS } from '../../src/source/service.js';
import { compareTreePaths } from '../../src/source/tree-diff.js';
import { createTestRedis, migratedPool } from '../helpers.js';
import { TEST_CURSOR_KEY } from '../_cursor-fixture.js';
import { generateTestKeyPair, startMockGhe, type MockGhe } from '../../../../packages/github/testing/mock-ghe.js';
import { buildMockSource, type MockFileContent, type MockSourceRepository } from '../../../../packages/github/testing/mock-source.js';

const AUTH_CONFIG = { enabled: true, cookieSecure: true, loginPath: '/auth/login', groupRoleMap: new Map<string, never>() } as const;
const USER = 'sub-cr133-paths';
const ORG = 13_301;
const OWNER = 'cr133src';
const REPOS = { tree: 13_301, huge: 13_302 } as const;
/** 등록돼 있지만 이 사용자의 범위 밖인 저장소. */
const HIDDEN = { name: 'hidden', id: 13_303 } as const;
const keys = generateTestKeyPair();

/** 첫 커밋의 파일들. 같은 이름 셋, 아홉 단계 깊이의 파일, 경로 순서가 Git 순서와 다른 이름(`a-b.c`·`a.c`·`a/`), 링크·서브모듈. */
const TREE_FILES: Record<string, MockFileContent> = {
  'src/a/config.h': '#define A 1\n', 'src/b/config.h': '#define B 1\n', 'tests/config.h': '#define T 1\n',
  'deep/l1/l2/l3/l4/l5/l6/l7/l8/leaf.c': 'int leaf;\n', 'src/a-b.c': 'int ab;\n', 'src/a.c': 'int a;\n',
  'docs/guide.md': '# Guide\n', link: { symlink: 'docs/guide.md' }, 'vendor/lib': { submodule: 'e'.repeat(40) }, 'README.md': 'tree\n',
};
for (let index = 0; index < 60; index += 1) TREE_FILES[`pkg/p${String(index).padStart(2, '0')}/index.ts`] = `export const p${String(index)} = ${String(index)};\n`;

function tree(): MockSourceRepository {
  return buildMockSource({
    owner: OWNER, repo: 'tree',
    commits: [
      { message: 'initial tree', changes: TREE_FILES },
      { message: 'tune config A', changes: { 'src/a/config.h': '#define A 2\n' } },
    ],
    // 두 번째 커밋만 PR에 오른다 — 나머지 파일은 한 번도 PR에서 바뀌지 않았다.
    pulls: [{ number: 7, title: 'Tune config A', base: 0, head: 1 }],
  });
}
/** 디렉터리 400개(파일 둘씩) — 재귀 목록 상한(100항목)을 넘겨 걷기로 읽는다. */
const HUGE_FILES: Record<string, string> = { 'z.txt': 'z\n' };
for (let index = 0; index < 400; index += 1) {
  const dir = `mod/m${String(index).padStart(3, '0')}`;
  HUGE_FILES[`${dir}/index.ts`] = `export default ${String(index)};\n`;
  HUGE_FILES[`${dir}/README.md`] = `module ${String(index)}\n`;
}
function huge(): MockSourceRepository {
  return buildMockSource({ owner: OWNER, repo: 'huge', commits: [{ message: 'many modules', changes: HUGE_FILES }] });
}

/** 선택할 수 있는 파일(서브모듈을 뺀 잎)의 기대 목록 — 경로 순서. */
function expectedPaths(files: Readonly<Record<string, MockFileContent>>): { path: string; kind: string }[] {
  return Object.entries(files)
    .filter(([, content]) => typeof content === 'string' || Buffer.isBuffer(content) || !('submodule' in content))
    .map(([path, content]) => ({ path, kind: typeof content === 'object' && !Buffer.isBuffer(content) && 'symlink' in content ? 'symlink' : 'file' }))
    .sort((a, b) => compareTreePaths(a.path, b.path));
}

let pool: Pool;
let redis: Redis;
let ghe: MockGhe;
let truncGhe: MockGhe;
let slowGhe: MockGhe;
let app: FastifyInstance;
let truncApp: FastifyInstance;
let slowApp: FastifyInstance;
let sessionId: string;
let repos: { tree: MockSourceRepository; huge: MockSourceRepository };

function readerFor(mock: MockGhe): () => GitHubSourceReader {
  const provider = new InstallationTokenProvider({ apiUrl: mock.apiUrl, appId: '13301', privateKey: keys.privateKey, refreshLeadMs: 60_000, requestTimeoutMs: 5_000 });
  const tokens = new TokenPool(provider, { installations: [{ org: OWNER, installationId: 13_301 }], quarantineThreshold: 0.1 });
  const transport = new GitHubTransport({ apiUrl: mock.apiUrl, requestTimeoutMs: 5_000, pool: tokens, scheduler: new RequestScheduler({ maxConcurrent: 8 }) });
  return () => new GitHubSourceReader(transport);
}

async function get<T>(server: FastifyInstance, path: string): Promise<{ status: number; body: T }> {
  const response = await server.inject({ method: 'GET', url: path, headers: { cookie: `${SESSION_COOKIE_NAME}=${sessionId}` } });
  return { status: response.statusCode, body: response.json<T>() };
}
const pathsUrl = (repo: string, query: Record<string, string>) =>
  `/api/v1/source/${encodeURIComponent(`${OWNER}/${repo}`)}/paths?${new URLSearchParams(query)}`;

/** GHE 대역이 받은 트리 요청 — 재귀와 비재귀를 가른다. */
function treeRequests(mock: MockGhe, from = 0): { recursive: number; plain: number } {
  const trees = mock.requests.slice(from).filter((request) => /\/git\/trees\/[0-9a-f]{40}/.test(request.path));
  const recursive = trees.filter((request) => request.path.includes('recursive=')).length;
  return { recursive, plain: trees.length - recursive };
}

/** 클라이언트처럼 `next_after`가 `null`일 때까지 잇는다. 페이지마다 GHE 트리 요청 수를 함께 센다. */
async function readAllPages(server: FastifyInstance, mock: MockGhe, repo: string, revision: string) {
  const pages: { body: SourcePaths; plain: number; recursive: number }[] = [];
  let after: string | null = null;
  do {
    const from = mock.requests.length;
    const { status, body }: { status: number; body: SourcePaths } = await get<SourcePaths>(server, pathsUrl(repo, after === null ? { revision } : { revision, after }));
    expect(status).toBe(200);
    pages.push({ body, ...treeRequests(mock, from) });
    after = body.next_after;
  } while (after !== null && pages.length < 1000);
  return pages;
}

beforeAll(async () => {
  pool = await migratedPool();
  redis = createTestRedis();
  repos = { tree: tree(), huge: huge() };
  ghe = await startMockGhe({ source: { repositories: [repos.tree] } });
  truncGhe = await startMockGhe({ source: { repositories: [repos.huge], recursiveLimit: 100 } });
  slowGhe = await startMockGhe({ source: { repositories: [repos.tree], recursiveDelayMs: 2_000 } });

  const ids = [...Object.values(REPOS), HIDDEN.id];
  await pool.query('DELETE FROM permission_cache WHERE user_id = $1', [USER]);
  await pool.query('DELETE FROM audit_record WHERE user_id = $1', [USER]);
  await pool.query('DELETE FROM app_user WHERE user_id = $1', [USER]);
  await pool.query('DELETE FROM repository WHERE repository_id = ANY($1)', [ids]);
  await authRepo.upsertUserOnLogin(pool, { user_id: USER, login: 'cr133-paths-kim', github_user_id: 1_330_001 });
  for (const [name, id] of [...Object.entries(REPOS), [HIDDEN.name, HIDDEN.id] as const]) {
    await repositoryRepo.upsertRepository(pool, { repository_id: id, owner: OWNER, name, org_id: ORG, visibility: 'internal', sequence_branches: ['main'] });
  }

  const redisPort: AuthRedis = {
    get: (key) => redis.get(key),
    set: (key, value, mode, seconds) => redis.set(key, value, mode, seconds),
    del: (...keysToDelete) => redis.del(...keysToDelete),
    scan: (cursor, m, pattern, c, n) => redis.scan(cursor, m, pattern, c, n),
  };
  // 범위에는 tree·huge만 있다 — hidden은 등록돼 있어도 이 사용자에게 없는 저장소다.
  const source: AccessScopeSource = { fetch: async () => ({ repositoryIds: Object.values(REPOS), orgIds: [], teamIds: [], visibilities: [] }) };
  const auth: AuthContext = {
    sessions: new SessionStore({ redis: redisPort }),
    scopes: new AccessScopeResolver({ redis: redisPort, db: createScopeDatabase(pool), source }),
    forget: async (ids) => { if (ids.length > 0) await redis.del(...ids.map(scopeKey)); },
  };
  const config = { port: 0, adminTokens: [], metricsQueryUrl: null, gheBaseUrl: null, auth: AUTH_CONFIG, searchCursorKey: TEST_CURSOR_KEY };
  app = buildServer({ config, auth, source: { pool, reader: readerFor(ghe) } });
  await app.ready();
  truncApp = buildServer({ config, auth, source: { pool, reader: readerFor(truncGhe) } });
  await truncApp.ready();
  slowApp = buildServer({ config, auth, source: { pool, reader: readerFor(slowGhe), pathsRecursiveTimeoutMs: 300 } });
  await slowApp.ready();
}, 240_000);

afterAll(async () => {
  await app?.close();
  await truncApp?.close();
  await slowApp?.close();
  await ghe?.close();
  await truncGhe?.close();
  await slowGhe?.close();
  await pool?.query('DELETE FROM permission_cache WHERE user_id = $1', [USER]);
  await pool?.query('DELETE FROM audit_record WHERE user_id = $1', [USER]);
  await pool?.query('DELETE FROM app_user WHERE user_id = $1', [USER]);
  await pool?.query('DELETE FROM repository WHERE repository_id = ANY($1)', [[...Object.values(REPOS), HIDDEN.id]]);
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
  }).create({ sessionId, userId: USER, login: 'cr133-paths-kim', email: null, roles: ['developer'], issuedAt: now, lastSeenAt: now, correlationId: null });
});

describe('CR-133 FR-SRC-001 고정 revision의 파일 경로 목록 (실제 전송)', () => {
  it('FR-SRC-001 한 번도 PR에 오르지 않은 파일까지 모든 파일 경로를 한 응답으로 — 깊은 파일과 같은 이름의 파일이 각각 나온다', async () => {
    const revision = repos.tree.commitShas[1]!;
    const from = ghe.requests.length;
    const { status, body } = await get<SourcePaths>(app, pathsUrl('tree', { revision }));
    expect(status).toBe(200);
    expect(body).toEqual({ repository: `${OWNER}/tree`, revision, paths: expectedPaths(TREE_FILES), next_after: null, incomplete: false });
    expect(body.paths.map((entry) => entry.path).filter((path) => path.endsWith('config.h'))).toEqual(['src/a/config.h', 'src/b/config.h', 'tests/config.h']);
    expect(body.paths).toContainEqual({ path: 'deep/l1/l2/l3/l4/l5/l6/l7/l8/leaf.c', kind: 'file' });
    expect(body.paths).toContainEqual({ path: 'link', kind: 'symlink' });
    expect(body.paths.some((entry) => entry.path === 'vendor/lib')).toBe(false);
    // PR #7이 바꾼 파일은 하나다 — 목록은 PR이 아니라 트리에서 온다.
    expect(repos.tree.pulls.get(7)).toMatchObject({ base: repos.tree.commitShas[0], head: revision });
    expect(body.paths.length).toBeGreaterThan(60);
    expect(treeRequests(ghe, from)).toEqual({ recursive: 1, plain: 0 });
  });

  it('FR-SRC-001 GitHub가 재귀 목록을 잘랐으면 하위 트리를 걸어 끝까지 — 이어 붙인 페이지에 모든 경로가 정확히 한 번 나온다', async () => {
    const revision = repos.huge.commitShas[0]!;
    const pages = await readAllPages(truncApp, truncGhe, 'huge', revision);
    const expected = expectedPaths(HUGE_FILES);
    expect(pages.flatMap((page) => page.body.paths)).toEqual(expected);
    // 첫 페이지는 전부가 아니다 — 클라이언트는 next_after가 null이 될 때까지 「결과 없음」을 말하지 않는다.
    expect(pages[0]!.body.paths.length).toBeLessThan(expected.length);
    expect(pages[0]!.body.next_after).not.toBeNull();
    expect(pages.length).toBeGreaterThanOrEqual(4);
    expect(pages.map((page) => page.recursive)).toEqual([1, ...pages.slice(1).map(() => 0)]);
    expect(pages.every((page) => page.plain <= SOURCE_PATHS_WALK_TREE_CALLS)).toBe(true);
    expect(pages.every((page) => page.body.revision === revision && page.body.incomplete === false)).toBe(true);
  });

  it('FR-SRC-001 재귀 목록이 호출 기한을 넘기면 걷기로 끝까지 읽는다', async () => {
    const revision = repos.tree.commitShas[1]!;
    const pages = await readAllPages(slowApp, slowGhe, 'tree', revision);
    expect(pages.flatMap((page) => page.body.paths)).toEqual(expectedPaths(TREE_FILES));
    expect(pages[0]!.recursive).toBe(1);
    expect(pages[0]!.plain).toBeGreaterThan(0);
  });

  it('FR-SRC-001 범위 밖 저장소는 등록되지 않은 저장소와 같은 404이고 GHE를 부르지 않는다', async () => {
    const revision = repos.tree.commitShas[1]!;
    const from = ghe.requests.length;
    const hidden = await get<{ error: { code: string; message: string } }>(app, pathsUrl(HIDDEN.name, { revision }));
    const unknown = await get<{ error: { code: string; message: string } }>(app, pathsUrl('no-such-repo', { revision }));
    expect(hidden.status).toBe(404);
    expect(hidden.body.error).toEqual(unknown.body.error);
    expect(unknown.status).toBe(404);
    expect(ghe.requests.slice(from)).toEqual([]);
  });

  it('FR-SRC-001 감사는 페이지마다 한 행이다 — revision과 이어 읽기 위치만 남고 경로 목록은 남지 않는다', async () => {
    const revision = repos.huge.commitShas[0]!;
    const before = await pool.query<{ count: string }>("SELECT count(*) FROM audit_record WHERE user_id = $1 AND target = $2", [USER, `source:paths:${OWNER}/huge`]);
    const pages = await readAllPages(truncApp, truncGhe, 'huge', revision);
    let rows: { query: string; result_code: string }[] = [];
    for (let attempt = 0; attempt < 100; attempt += 1) {
      ({ rows } = await pool.query<{ query: string; result_code: string }>(
        'SELECT query, result_code FROM audit_record WHERE user_id = $1 AND target = $2 ORDER BY occurred_at, audit_id', [USER, `source:paths:${OWNER}/huge`]));
      if (rows.length >= Number(before.rows[0]!.count) + pages.length) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    const mine = rows.slice(Number(before.rows[0]!.count));
    expect(mine).toHaveLength(pages.length);
    expect(mine.every((row) => row.result_code === 'OK')).toBe(true);
    const queries = mine.map((row) => JSON.parse(row.query) as { revision: string; after?: string });
    expect(queries.map((query) => query.revision)).toEqual(pages.map(() => revision));
    expect(queries.map((query) => query.after ?? null)).toEqual([null, ...pages.slice(0, -1).map((page) => page.body.next_after)]);
    // 목록은 싣지 않는다 — 한 행은 짧고, 이어 읽기 위치 말고는 경로가 없다.
    expect(mine.every((row) => row.query.length < 1024 && !row.query.includes('"paths"'))).toBe(true);
  });
});
