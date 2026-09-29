/**
 * CR-135 / FR-SRC-005 — 고정 revision의 파일 blame(API-SRC-006)을 실제 HTTP 위에서 본다.
 *
 * search-api는 실제 `GitHubTransport`(설치 토큰 발급 → GraphQL POST)로 가짜 GHE의 `POST /api/graphql`을 부른다. 가짜 GHE는
 * `mock-source` 이력에서 blame을 계산하고(`mockBlame`), 오류 주입 옵션으로 GitHub의 실패 모양을 준다. PostgreSQL·Redis는
 * 실제다.
 *
 * - 네 번 고친 파일의 줄 구간이 커밋별로 맞게 귀속된다 — 손으로 적은 표와 대역의 계산 둘 다와 맞는다
 * - 중간 리비전의 blame은 그 리비전까지의 이력만 본다
 * - 없는 경로·리비전 404, 스키마에 blame이 없는 GHES 501, 권한 503, 한도 429 + Retry-After, 일부 결과 502
 * - 범위 밖 저장소는 등록 안 된 저장소와 같은 404이고, 게이트가 꺼진 배포는 404 `feature_disabled`다 — 둘 다 GHE를 부르지 않는다
 */

import {
  AccessScopeResolver,
  SESSION_COOKIE_NAME,
  SessionStore,
  createScopeDatabase,
  createSessionId,
  scopeKey,
  sessionKey,
  type AccessScopeSource,
} from '@prs/authz';
import { authRepo, repositoryRepo, type Pool } from '@prs/db';
import type { Redis } from '@prs/bus';
import { GitHubSourceReader, GitHubTransport, InstallationTokenProvider, RequestScheduler, TokenPool } from '@prs/github';
import type { SourceBlame } from '@prs/contracts';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildServer } from '../../src/server.js';
import type { AuthContext, AuthRedis } from '../../src/auth/context.js';
import { createTestRedis, migratedPool } from '../helpers.js';
import { TEST_CURSOR_KEY } from '../_cursor-fixture.js';
import { generateTestKeyPair, startMockGhe, type MockGhe, type MockGraphqlOptions } from '../../../../packages/github/testing/mock-ghe.js';
import { buildMockSource, mockBlame } from '../../../../packages/github/testing/mock-source.js';

const AUTH_CONFIG = { enabled: true, cookieSecure: true, loginPath: '/auth/login', groupRoleMap: new Map<string, never>() } as const;
const USER = 'sub-cr135-blame';
const ORG = 13_501;
const OWNER = 'cr135src';
const REPO = { name: 'blame', id: 13_501 } as const;
/** 등록돼 있지만 이 사용자의 범위 밖인 저장소. */
const HIDDEN = { name: 'hidden', id: 13_502 } as const;
const keys = generateTestKeyPair();
const PATH = 'src/pay.ts';

/**
 * `src/pay.ts`를 만들고 네 번 고친 이력. 마지막 커밋은 README만 고친다 — 귀속에 끼어들면 안 된다.
 *
 * | # | 작성자 | `src/pay.ts` |
 * | 0 | alice | a b c d |
 * | 1 | bob | a **B** c d |
 * | 2 | carol(GHE 계정 없음) | a B c d **e f** |
 * | 3 | dave | **z** a B d e f (c 삭제) |
 * | 4 | erin | z a B d **E** f |
 * | 5 | frank | (README만) |
 */
const SOURCE = buildMockSource({
  owner: OWNER,
  repo: REPO.name,
  commits: [
    { message: 'init: 결제 모듈\n\n본문은 제목에 싣지 않는다', author: 'alice', changes: { [PATH]: 'a\nb\nc\nd\n', 'README.md': 'readme\n' } },
    { message: 'fix: b를 고친다', author: 'bob', changes: { [PATH]: 'a\nB\nc\nd\n' } },
    { message: 'feat: 끝에 두 줄', author: 'carol', login: null, changes: { [PATH]: 'a\nB\nc\nd\ne\nf\n' } },
    { message: 'refactor: 머리에 z를 넣고 c를 지운다', author: 'dave', changes: { [PATH]: 'z\na\nB\nd\ne\nf\n' } },
    { message: 'fix: e를 고친다', author: 'erin', changes: { [PATH]: 'z\na\nB\nd\nE\nf\n' } },
    { message: 'docs: README', author: 'frank', changes: { 'README.md': 'readme v2\n' } },
  ],
});
const sha = (index: number): string => SOURCE.commitShas[index] ?? '';
const HEAD = sha(5);
/** 커밋 번호 → 기대하는 귀속 커밋 모양(작성자 이름·계정·제목 한 줄). */
const AUTHORS = [
  { name: 'alice', login: 'alice', headline: 'init: 결제 모듈' },
  { name: 'bob', login: 'bob', headline: 'fix: b를 고친다' },
  { name: 'carol', login: null, headline: 'feat: 끝에 두 줄' },
  { name: 'dave', login: 'dave', headline: 'refactor: 머리에 z를 넣고 c를 지운다' },
  { name: 'erin', login: 'erin', headline: 'fix: e를 고친다' },
] as const;
/** 손으로 적은 귀속 표: [시작 줄, 끝 줄, 커밋 번호]. */
function byHand(rows: readonly (readonly [number, number, number])[]) {
  return rows.map(([start, end, index]) => ({
    start_line: start,
    end_line: end,
    commit: { sha: sha(index), author_name: AUTHORS[index]?.name, author_login: AUTHORS[index]?.login, message_headline: AUTHORS[index]?.headline },
  }));
}
/** 대역이 계산한 blame을 서비스 DTO 모양으로 — 대역의 계산과 서비스의 옮김이 한 글자씩 같은지 본다. */
function fromMock(revision: string, path: string): SourceBlame {
  const result = mockBlame(SOURCE, revision, path);
  if (result.kind !== 'ok') throw new Error(`대역 blame이 계산되지 않았다: ${result.kind}`);
  return {
    repository: `${OWNER}/${REPO.name}`, revision: result.oid, path, provider: 'github_graphql',
    ranges: result.ranges.map((range) => ({
      start_line: range.startingLine, end_line: range.endingLine, age: range.age,
      commit: { sha: range.commit.sha, message_headline: range.commit.message.split('\n')[0] ?? '', author_name: range.commit.author, author_login: range.commit.login, authored_at: range.commit.date, committed_at: range.commit.date },
    })),
  };
}

let pool: Pool;
let redis: Redis;
let ghe: MockGhe;
let app: FastifyInstance;
let offApp: FastifyInstance;
let auth: AuthContext;
let sessionId: string;
const sessions: string[] = [];
const CONFIG = { port: 0, adminTokens: [], metricsQueryUrl: null, gheBaseUrl: null, auth: AUTH_CONFIG, searchCursorKey: TEST_CURSOR_KEY };

/** 실제 전송 — REST 루트와 GHES 모양의 GraphQL 끝점(`/api/graphql`)을 함께 준다. */
function readerFor(mock: MockGhe): () => GitHubSourceReader {
  const provider = new InstallationTokenProvider({ apiUrl: mock.apiUrl, appId: '13501', privateKey: keys.privateKey, refreshLeadMs: 60_000, requestTimeoutMs: 5_000 });
  const tokens = new TokenPool(provider, { installations: [{ org: OWNER, installationId: 13_501 }], quarantineThreshold: 0.1 });
  const transport = new GitHubTransport({ apiUrl: mock.apiUrl, graphqlUrl: mock.graphqlUrl, requestTimeoutMs: 5_000, pool: tokens, scheduler: new RequestScheduler({ maxConcurrent: 8 }) });
  return () => new GitHubSourceReader(transport);
}

async function get<T>(server: FastifyInstance, path: string): Promise<{ status: number; body: T; headers: Record<string, unknown> }> {
  const response = await server.inject({ method: 'GET', url: path, headers: { cookie: `${SESSION_COOKIE_NAME}=${sessionId}` } });
  return { status: response.statusCode, body: response.json<T>(), headers: response.headers };
}
const blameUrl = (repo: string, query: Record<string, string>) => `/api/v1/source/${encodeURIComponent(`${OWNER}/${repo}`)}/blame?${new URLSearchParams(query)}`;
type ErrorBody = { error: { code: string; message: string; detail?: { reason?: string } } };

/** 실패 흉내 하나에 GHE 대역과 서버를 따로 세운다 — 대역의 GraphQL 옵션은 서버 전체에 걸린다. */
async function withScenario(graphql: MockGraphqlOptions, run: (mock: MockGhe, server: FastifyInstance) => Promise<void>): Promise<void> {
  const mock = await startMockGhe({ source: { repositories: [SOURCE] }, graphql });
  const server = buildServer({ config: CONFIG, auth, source: { pool, reader: readerFor(mock), blameEnabled: true } });
  try {
    await server.ready();
    await run(mock, server);
  } finally {
    await server.close();
    await mock.close();
  }
}

beforeAll(async () => {
  pool = await migratedPool();
  redis = createTestRedis();
  ghe = await startMockGhe({ source: { repositories: [SOURCE] } });

  const ids = [REPO.id, HIDDEN.id];
  await pool.query('DELETE FROM permission_cache WHERE user_id = $1', [USER]);
  await pool.query('DELETE FROM audit_record WHERE user_id = $1', [USER]);
  await pool.query('DELETE FROM app_user WHERE user_id = $1', [USER]);
  await pool.query('DELETE FROM repository WHERE repository_id = ANY($1)', [ids]);
  await authRepo.upsertUserOnLogin(pool, { user_id: USER, login: 'cr135-blame-kim', github_user_id: 1_350_001 });
  for (const { name, id } of [REPO, HIDDEN]) {
    await repositoryRepo.upsertRepository(pool, { repository_id: id, owner: OWNER, name, org_id: ORG, visibility: 'internal', sequence_branches: ['main'] });
  }

  const redisPort: AuthRedis = {
    get: (key) => redis.get(key),
    set: (key, value, mode, seconds) => redis.set(key, value, mode, seconds),
    del: (...keysToDelete) => redis.del(...keysToDelete),
    scan: (cursor, m, pattern, c, n) => redis.scan(cursor, m, pattern, c, n),
  };
  // 범위에는 blame만 있다 — hidden은 등록돼 있어도 이 사용자에게 없는 저장소다.
  const source: AccessScopeSource = { fetch: async () => ({ repositoryIds: [REPO.id], orgIds: [], teamIds: [], visibilities: [] }) };
  auth = {
    sessions: new SessionStore({ redis: redisPort }),
    scopes: new AccessScopeResolver({ redis: redisPort, db: createScopeDatabase(pool), source }),
    forget: async (forgotten) => { if (forgotten.length > 0) await redis.del(...forgotten.map(scopeKey)); },
  };
  app = buildServer({ config: CONFIG, auth, source: { pool, reader: readerFor(ghe), blameEnabled: true } });
  await app.ready();
  // 게이트가 꺼진 배포(기본값) — 같은 GHE 대역을 가리킨다.
  offApp = buildServer({ config: CONFIG, auth, source: { pool, reader: readerFor(ghe) } });
  await offApp.ready();
}, 240_000);

afterAll(async () => {
  await app?.close();
  await offApp?.close();
  await ghe?.close();
  if (sessions.length > 0) await redis?.del(...sessions.map(sessionKey));
  await redis?.del(scopeKey(USER));
  await pool?.query('DELETE FROM permission_cache WHERE user_id = $1', [USER]);
  await pool?.query('DELETE FROM audit_record WHERE user_id = $1', [USER]);
  await pool?.query('DELETE FROM app_user WHERE user_id = $1', [USER]);
  await pool?.query('DELETE FROM repository WHERE repository_id = ANY($1)', [[REPO.id, HIDDEN.id]]);
  await redis?.quit();
  await pool?.end();
});

beforeEach(async () => {
  await redis.del(scopeKey(USER));
  sessionId = createSessionId();
  sessions.push(sessionId);
  const now = Date.now();
  await auth.sessions.create({ sessionId, userId: USER, login: 'cr135-blame-kim', email: null, roles: ['developer'], issuedAt: now, lastSeenAt: now, correlationId: null });
});

describe('CR-135 FR-SRC-005 고정 revision의 파일 blame (실제 전송 → GHE 대역 /api/graphql)', () => {
  it('CR-135 FR-SRC-005 네 번 고친 파일의 줄 구간이 커밋별로 맞게 귀속된다 — 손으로 적은 표와 대역의 계산 둘 다와 맞고, 계정 없는 작성자의 login은 null이다', async () => {
    const before = ghe.graphqlRequests.length;
    const { status, body, headers } = await get<SourceBlame>(app, blameUrl(REPO.name, { path: PATH, revision: HEAD }));
    expect(status).toBe(200);
    expect(headers['cache-control']).toBe('private, no-store');
    // HEAD의 파일: z(dave) a(alice) B(bob) d(alice) E(erin) f(carol). README만 고친 frank는 나오지 않는다.
    expect(body.ranges).toMatchObject(byHand([[1, 1, 3], [2, 2, 0], [3, 3, 1], [4, 4, 0], [5, 5, 4], [6, 6, 2]]));
    expect(body).toEqual(fromMock(HEAD, PATH));
    expect(body).toMatchObject({ repository: `${OWNER}/${REPO.name}`, revision: HEAD, path: PATH, provider: 'github_graphql' });
    expect(body.ranges.find((range) => range.commit.author_name === 'carol')?.commit.author_login).toBeNull();
    expect(body.ranges.some((range) => range.commit.sha === sha(5))).toBe(false);
    // 서버 소유 고정 query 한 번, 변수는 저장소·리비전·경로뿐이다.
    expect(ghe.graphqlRequests.slice(before)).toEqual([{ fixedQuery: true, variables: { owner: OWNER, name: REPO.name, revision: HEAD, path: PATH } }]);
  });

  it('CR-135 FR-SRC-005 중간 리비전의 blame은 그 리비전까지의 이력만 본다', async () => {
    const revision = sha(2);
    const { status, body } = await get<SourceBlame>(app, blameUrl(REPO.name, { path: PATH, revision }));
    expect(status).toBe(200);
    // 커밋 2의 파일: a(alice) B(bob) c d(alice) e f(carol). 뒤 커밋(dave·erin)은 끼어들지 않는다.
    expect(body.ranges).toMatchObject(byHand([[1, 1, 0], [2, 2, 1], [3, 4, 0], [5, 6, 2]]));
    expect(body).toEqual(fromMock(revision, PATH));
    expect(body.revision).toBe(revision);
  });

  it('CR-135 FR-SRC-005 없는 경로·리비전은 404 NOT_FOUND다 — 추정 결과를 blame인 것처럼 주지 않는다', async () => {
    for (const query of [{ path: 'src/nope.ts', revision: HEAD }, { path: PATH, revision: 'f'.repeat(40) }, { path: 'src', revision: HEAD }]) {
      const { status, body } = await get<ErrorBody>(app, blameUrl(REPO.name, query));
      expect({ query, status, error: body.error }).toEqual({ query, status: 404, error: { code: 'NOT_FOUND', message: 'The requested repository object was not found.' } });
    }
  });

  it('CR-135 FR-SRC-005 범위 밖 저장소는 등록되지 않은 저장소와 같은 404이고 GHE를 부르지 않는다', async () => {
    const rest = ghe.requests.length; const graphql = ghe.graphqlRequests.length;
    const hidden = await get<ErrorBody>(app, blameUrl(HIDDEN.name, { path: PATH, revision: HEAD }));
    const unknown = await get<ErrorBody>(app, blameUrl('no-such-repo', { path: PATH, revision: HEAD }));
    expect(hidden.status).toBe(404);
    expect(unknown.status).toBe(404);
    expect(hidden.body.error).toEqual(unknown.body.error);
    expect(hidden.body.error).toEqual({ code: 'NOT_FOUND', message: 'Repository not found.' });
    expect(ghe.requests.length).toBe(rest);
    expect(ghe.graphqlRequests.length).toBe(graphql);
  });

  it('CR-135 FR-SRC-005 게이트가 꺼진 배포는 404 feature_disabled이고 GHE를 부르지 않는다 — 범위 밖 저장소도 같은 답이다', async () => {
    const rest = ghe.requests.length; const graphql = ghe.graphqlRequests.length;
    for (const repo of [REPO.name, HIDDEN.name]) {
      const { status, body } = await get<ErrorBody>(offApp, blameUrl(repo, { path: PATH, revision: HEAD }));
      expect({ repo, status, error: body.error }).toEqual({ repo, status: 404, error: { code: 'NOT_FOUND', message: 'Blame is not enabled on this deployment.', detail: { reason: 'feature_disabled' } } });
    }
    expect(ghe.requests.length).toBe(rest);
    expect(ghe.graphqlRequests.length).toBe(graphql);
  });

  it('CR-135 FR-SRC-005 감사는 요청마다 source:blame 한 행이다 — 경로·revision·결과 코드만 남고 구간·커밋 제목은 남지 않는다', async () => {
    const target = `source:blame:${OWNER}/${REPO.name}`;
    const count = async () => Number((await pool.query<{ count: string }>('SELECT count(*) FROM audit_record WHERE user_id = $1 AND target = $2', [USER, target])).rows[0]?.count ?? 0);
    const before = await count();
    expect((await get(app, blameUrl(REPO.name, { path: PATH, revision: HEAD }))).status).toBe(200);
    expect((await get(app, blameUrl(REPO.name, { path: 'src/nope.ts', revision: HEAD }))).status).toBe(404);
    let rows: { query: string; result_code: string }[] = [];
    for (let attempt = 0; attempt < 100; attempt += 1) {
      ({ rows } = await pool.query<{ query: string; result_code: string }>(
        'SELECT query, result_code FROM audit_record WHERE user_id = $1 AND target = $2 ORDER BY occurred_at, audit_id', [USER, target]));
      if (rows.length >= before + 2) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    const mine = rows.slice(before);
    expect(mine.map((row) => row.result_code)).toEqual(['OK', 'NOT_FOUND']);
    expect(mine.map((row) => JSON.parse(row.query) as unknown)).toEqual([
      { path: PATH, revision: HEAD, observed_revision: HEAD },
      { path: 'src/nope.ts', revision: HEAD, observed_revision: null },
    ]);
    expect(mine.every((row) => !row.query.includes('결제 모듈') && !row.query.includes('ranges'))).toBe(true);
  });
});

describe('CR-135 FR-SRC-005 GitHub의 실패를 가른다 (GHE 대역 오류 주입)', () => {
  it.each([
    ['스키마에 Commit.blame이 없는 GHES', 501, 'SOURCE_BLAME_UNSUPPORTED', 'This GitHub Enterprise Server does not provide blame through its API.', { blame: 'unsupported' }],
    ['저장소 권한 없음(FORBIDDEN)', 503, 'SOURCE_PERMISSION_REQUIRED', 'The configured GitHub App requires repository Contents read permission.', { failure: 'forbidden' }],
    ['설치 토큰 거부(401)', 503, 'SOURCE_PERMISSION_REQUIRED', 'The configured GitHub App requires repository Contents read permission.', { failure: 'unauthorized' }],
    ['일부 결과(errors와 data가 함께 온다)', 502, 'SOURCE_UNAVAILABLE', 'Source data could not be loaded from GitHub. Please retry.', { failure: 'partial' }],
    ['GitHub가 끊은 조회(502)', 502, 'SOURCE_UNAVAILABLE', 'Source data could not be loaded from GitHub. Please retry.', { failure: 'server_502' }],
  ] as const)('CR-135 FR-SRC-005 %s → %i %s', async (_label, status, code, message, graphql) => {
    await withScenario(graphql, async (mock, server) => {
      const response = await get<ErrorBody>(server, blameUrl(REPO.name, { path: PATH, revision: HEAD }));
      expect({ status: response.status, error: response.body.error }).toEqual({ status, error: { code, message } });
      expect(response.headers['retry-after']).toBeUndefined();
      // 원격 문구(오류 메시지·요청 ID)는 싣지 않는다.
      expect(JSON.stringify(response.body)).not.toMatch(/Commit'|0000:1111|integration|Bad credentials/);
      expect(mock.graphqlRequests).toEqual([{ fixedQuery: true, variables: { owner: OWNER, name: REPO.name, revision: HEAD, path: PATH } }]);
    });
  });

  it('CR-135 FR-SRC-005 주 한도(200 + RATE_LIMITED)는 429 SOURCE_RATE_LIMITED와 회복 시각까지의 Retry-After다', async () => {
    const reset = Math.floor(Date.now() / 1000) + 120;
    await withScenario({ failure: 'rate_limited', rateHeaders: { remaining: 0, reset } }, async (_mock, server) => {
      const response = await get<ErrorBody>(server, blameUrl(REPO.name, { path: PATH, revision: HEAD }));
      expect(response.status).toBe(429);
      expect(response.body.error).toEqual({ code: 'SOURCE_RATE_LIMITED', message: 'GitHub is rate limited. Try again later.' });
      const retryAfter = Number(response.headers['retry-after']);
      expect(retryAfter).toBeGreaterThanOrEqual(118);
      expect(retryAfter).toBeLessThanOrEqual(120);
    });
  });

  it('CR-135 FR-SRC-005 부 한도(403)는 429 SOURCE_RATE_LIMITED와 GitHub의 retry-after다 — 권한 부족(503)으로 읽지 않는다', async () => {
    await withScenario({ failure: 'secondary_403' }, async (_mock, server) => {
      const response = await get<ErrorBody>(server, blameUrl(REPO.name, { path: PATH, revision: HEAD }));
      expect(response.status).toBe(429);
      expect(response.body.error.code).toBe('SOURCE_RATE_LIMITED');
      const retryAfter = Number(response.headers['retry-after']);
      expect(retryAfter).toBeGreaterThanOrEqual(29);
      expect(retryAfter).toBeLessThanOrEqual(30);
    });
  });

  it('CR-135 FR-SRC-005 성공 응답의 잔여 한도 0은 실패가 아니다 — 귀속을 그대로 준다', async () => {
    await withScenario({ rateHeaders: { remaining: 0, reset: Math.floor(Date.now() / 1000) + 600 } }, async (_mock, server) => {
      const response = await get<SourceBlame>(server, blameUrl(REPO.name, { path: PATH, revision: HEAD }));
      expect(response.status).toBe(200);
      expect(response.body).toEqual(fromMock(HEAD, PATH));
    });
  });
});
