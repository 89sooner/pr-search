/**
 * `GET /api/v1/source/:repository/history` — 연결 PR 번호 배치 조회
 * (CR-107 / FR-SRC-002 AC-1, API-SRC-002, WP-093).
 *
 * 단위 시험(`../../src/source/source.test.ts`)은 `loadPullRequestLinks`와
 * `sourceHistory()`의 분기를 ES 클라이언트를 모킹해 본다. 여기서는 그 배선이
 * **실제 Elasticsearch에서 옳은 문서를 집어 오는지**, 그리고 실제 Fastify 라우트가
 * `routes.ts`가 이미 해석해 둔 `scope`를 실제로 넘기는지를 확인한다 — 목을 꽂은
 * 시험은 둘 다 증명하지 못한다.
 *
 * GitHub 업스트림은 스텁이다(GHE 자격 증명이 없다). `history()`가 반환하는 커밋
 * 목록은 손으로 고정하고, `prs-commits`만 실제로 색인해 배치 조회가 실제로
 * 그 인덱스를 읽는지 검증한다.
 */

import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Client } from '@elastic/elasticsearch';
import type { GitHubSourceReader } from '@prs/github';
import {
  AccessScopeResolver,
  SESSION_COOKIE_NAME,
  SessionStore,
  createScopeDatabase,
  createSessionId,
  scopeKey,
  type AccessScopeSource,
} from '@prs/authz';
import { applyMappings, switchAliasesForTests, createEsClient, resolveClientOptions } from '@prs/es';
import { authRepo, repositoryRepo, type Pool } from '@prs/db';
import type { Redis } from '@prs/bus';
import { buildServer } from '../../src/server.js';
import type { AuthContext, AuthRedis } from '../../src/auth/context.js';
import { createTestRedis, migratedPool } from '../helpers.js';
import { TEST_CURSOR_KEY } from '../_cursor-fixture.js';

const AUTH_CONFIG = {
  enabled: true,
  cookieSecure: true,
  loginPath: '/auth/login',
  groupRoleMap: new Map<string, never>(),
} as const;

const USER = 'sub-cr107-history';
// CR 번호를 딴 저장소 ID 대역 — 다른 통합 시험 파일(resolve 2xx/9xx, identifier-range
// 10_601/10_900 등)과 겹치지 않는다. ES는 워크트리 사이에 공유되므로 이 구분이
// 실제 격리 수단이다(메모리: integration-tests-isolated-db-per-worktree).
const PAYMENTS = 10_701;
/** 같은 SHA를 들고 있는 **다른** 저장소. 사용자의 접근 범위 밖이다. */
const OTHER = 10_702;
const ORG = 10_701;
const BRANCH = 'main';

/** `10701<suffix>` + 0 패딩으로 40자 hex를 만든다. 손으로 세지 않아도 길이가 항상 맞는다. */
function sha(suffix: string): string {
  return `10701${suffix}`.padEnd(40, '0');
}

const HEAD_SHA = sha('a0');
/** 연결 PR 하나만 확정된 커밋. */
const SHA_ONE = sha('a1');
/** 연결 PR 여럿(중복·역순 입력)이 확정된 커밋 — 응답은 중복 없이 오름차순이어야 한다. */
const SHA_MANY = sha('a2');
/** `direct_push`류 — 빈 배열로 확정된 "연결 없음". */
const SHA_EMPTY = sha('a3');
/** `prs-commits`에 문서 자체가 없다 — 아직 미확정. */
const SHA_PENDING = sha('a4');
/** PAYMENTS와 OTHER 양쪽에 같은 SHA로 존재한다. 접근 범위 밖 저장소의 연결이 새면 안 된다. */
const SHA_SHARED = sha('a5');

let pool: Pool;
let redis: Redis;
let es: Client;
let app: FastifyInstance;
let appWithoutEs: FastifyInstance;
let sessionId: string;
function spyOnSearch() { return vi.spyOn(es, 'search'); }
let searchSpy: ReturnType<typeof spyOnSearch> | undefined;

interface HistoryCommitBody {
  readonly sha: string;
  readonly pull_request_numbers: number[] | null;
}

interface HistoryBody {
  readonly repository?: string;
  readonly revision?: string;
  readonly path?: string;
  readonly commits?: HistoryCommitBody[];
  readonly next_page?: number | null;
  readonly pull_requests_unavailable?: boolean;
  readonly error?: { code: string; message: string };
  readonly correlation_id?: string;
}

/** `reader.history()`가 한 페이지에 고정 커밋 5개를 내는 스텁. GHE를 전혀 부르지 않는다. */
function stubReader(): GitHubSourceReader {
  const body = [
    { sha: SHA_ONE, parents: [{ sha: HEAD_SHA }], author: { login: 'kim' }, commit: { message: '연결 하나', author: { name: 'kim', date: '2026-09-18T00:00:00Z' } } },
    { sha: SHA_MANY, parents: [{ sha: SHA_ONE }], author: { login: 'lee' }, commit: { message: '연결 여럿', author: { name: 'lee', date: '2026-09-17T00:00:00Z' } } },
    { sha: SHA_EMPTY, parents: [{ sha: SHA_MANY }], author: { login: 'park' }, commit: { message: 'direct push', author: { name: 'park', date: '2026-09-16T00:00:00Z' } } },
    { sha: SHA_PENDING, parents: [{ sha: SHA_EMPTY }], author: { login: 'choi' }, commit: { message: '아직 미확정', author: { name: 'choi', date: '2026-09-15T00:00:00Z' } } },
    { sha: SHA_SHARED, parents: [], author: { login: 'jung' }, commit: { message: '다른 저장소와 공유되는 SHA', author: { name: 'jung', date: '2026-09-14T00:00:00Z' } } },
  ];
  const methods = {
    repository: vi.fn().mockResolvedValue({ default_branch: BRANCH }),
    branch: vi.fn().mockResolvedValue({ commit: { sha: HEAD_SHA } }),
    history: vi.fn().mockResolvedValue({ body, nextPage: null }),
  };
  return methods as unknown as GitHubSourceReader;
}

async function getHistory(server: FastifyInstance, repository: string): Promise<{ status: number; body: HistoryBody }> {
  const response = await server.inject({
    method: 'GET',
    url: `/api/v1/source/${encodeURIComponent(repository)}/history?path=${encodeURIComponent('src/app.ts')}&ref=${HEAD_SHA}&page=1`,
    headers: { cookie: `${SESSION_COOKIE_NAME}=${sessionId}` },
  });
  return { status: response.statusCode, body: response.json<HistoryBody>() };
}

beforeAll(async () => {
  pool = await migratedPool();
  redis = createTestRedis();
  es = createEsClient(resolveClientOptions());
  await applyMappings(es);
  await switchAliasesForTests(es);

  await pool.query('DELETE FROM permission_cache WHERE user_id = $1', [USER]);
  await pool.query('DELETE FROM app_user WHERE user_id = $1', [USER]);
  await pool.query('DELETE FROM repository WHERE repository_id = ANY($1)', [[PAYMENTS, OTHER]]);

  await authRepo.upsertUserOnLogin(pool, { user_id: USER, login: 'cr107-history-kim', github_user_id: 1_070_001 });
  for (const [id, owner, name] of [
    [PAYMENTS, 'cr107hist', 'payments'],
    [OTHER, 'cr107hist', 'other'],
  ] as const) {
    await repositoryRepo.upsertRepository(pool, {
      repository_id: id, owner, name, org_id: ORG,
      visibility: 'internal', sequence_branches: [BRANCH],
    });
  }

  await es.deleteByQuery({
    index: ['prs-commits'],
    query: { terms: { repository_id: [PAYMENTS, OTHER] } },
    refresh: true,
    conflicts: 'proceed',
  });

  function commitDoc(repositoryId: number, repository: string, commitSha: string, pullRequestNumbers: number[]) {
    return {
      _id: `${String(repositoryId)}:${commitSha}`,
      repository_id: repositoryId, repository, org_id: ORG, visibility: 'internal', allowed_team_ids: [ORG * 10],
      commit_sha: commitSha, role: pullRequestNumbers.length === 0 ? 'direct_push' : 'source_commit',
      pull_request_numbers: pullRequestNumbers, base_branch: BRANCH, document_version: 1,
    };
  }
  const COMMITS = [
    commitDoc(PAYMENTS, 'cr107hist/payments', SHA_ONE, [301]),
    // 중복·역순 입력 — 응답은 중복 없이 오름차순이어야 한다.
    commitDoc(PAYMENTS, 'cr107hist/payments', SHA_MANY, [303, 301, 302, 301]),
    commitDoc(PAYMENTS, 'cr107hist/payments', SHA_EMPTY, []),
    // SHA_PENDING은 의도적으로 문서를 만들지 않는다 — 미확정 사례다.
    commitDoc(PAYMENTS, 'cr107hist/payments', SHA_SHARED, [555]),
    // 같은 SHA, 접근 범위 밖 저장소. 이 [999]가 새면 시험이 잡는다.
    commitDoc(OTHER, 'cr107hist/other', SHA_SHARED, [999]),
  ];

  const bulk = await es.bulk({
    refresh: true,
    operations: COMMITS.flatMap(({ _id, ...doc }) => [
      { index: { _index: 'prs-commits', _id } },
      { ...doc, doc_id: _id },
    ]),
  });
  if (bulk.errors) {
    const reasons = bulk.items.map((item) => item.index?.error?.reason).filter((one) => one !== undefined);
    throw new Error(`fixture 색인이 거부됐다: ${reasons.join(' / ')}`);
  }

  const redisPort: AuthRedis = {
    get: (key) => redis.get(key),
    set: (key, value, mode, seconds) => redis.set(key, value, mode, seconds),
    del: (...keys) => redis.del(...keys),
    scan: (cursor, m, pattern, c, n) => redis.scan(cursor, m, pattern, c, n),
  };

  const source: AccessScopeSource = {
    // PAYMENTS만 접근 범위 안이다 — OTHER는 절대 나오면 안 된다.
    fetch: async () => ({
      repositoryIds: [PAYMENTS],
      orgIds: [ORG],
      teamIds: [ORG * 10],
      visibilities: ['public', 'internal'],
    }),
  };

  const auth: AuthContext = {
    sessions: new SessionStore({ redis: redisPort }),
    scopes: new AccessScopeResolver({ redis: redisPort, db: createScopeDatabase(pool), source }),
    forget: async (ids) => {
      if (ids.length > 0) await redis.del(...ids.map(scopeKey));
    },
  };

  const config = {
    port: 0, adminTokens: [], metricsQueryUrl: null, gheBaseUrl: null,
    auth: AUTH_CONFIG, searchCursorKey: TEST_CURSOR_KEY,
  };

  // `es`가 배선된 정상 경로 — API-SRC-002의 본 계약.
  app = buildServer({ config, auth, source: { pool, reader: () => stubReader(), es } });
  await app.ready();

  // `es`가 배선되지 않은 경로 — `routes.ts`의 `options.es ? {...} : undefined` 조건 자체를 확인한다.
  appWithoutEs = buildServer({ config, auth, source: { pool, reader: () => stubReader() } });
  await appWithoutEs.ready();
}, 180_000);

afterAll(async () => {
  await app?.close();
  await appWithoutEs?.close();
  await es?.deleteByQuery({
    index: ['prs-commits'],
    query: { terms: { repository_id: [PAYMENTS, OTHER] } },
    refresh: true,
    conflicts: 'proceed',
  });
  await pool?.query('DELETE FROM permission_cache WHERE user_id = $1', [USER]);
  await pool?.query('DELETE FROM app_user WHERE user_id = $1', [USER]);
  await pool?.query('DELETE FROM repository WHERE repository_id = ANY($1)', [[PAYMENTS, OTHER]]);
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
      del: (...keys) => redis.del(...keys),
      scan: (cursor, m, pattern, c, n) => redis.scan(cursor, m, pattern, c, n),
    },
  }).create({
    sessionId, userId: USER, login: 'cr107-history-kim', email: null,
    roles: ['developer'], issuedAt: now, lastSeenAt: now, correlationId: null,
  });
  searchSpy = spyOnSearch();
});

afterEach(() => {
  searchSpy?.mockRestore();
  searchSpy = undefined;
});

function commit(body: HistoryBody, sha: string): HistoryCommitBody | undefined {
  return body.commits?.find((item) => item.sha === sha);
}

describe('연결 PR 번호 — 확정·미확정·빈 배열·접근 범위 (CR-107 / QA-W001-50)', () => {
  it('배열(빈 배열 포함)이면 확정, 문서가 없으면 미확정(null)이다', async () => {
    const { status, body } = await getHistory(app, 'cr107hist/payments');
    expect(status).toBe(200);
    expect(commit(body, SHA_ONE)?.pull_request_numbers).toEqual([301]);
    expect(commit(body, SHA_EMPTY)?.pull_request_numbers).toEqual([]);
    expect(commit(body, SHA_PENDING)?.pull_request_numbers).toBeNull();
  });

  it('한 SHA가 여러 PR에 속하면 중복 없이 오름차순으로 전부 보인다', async () => {
    const { body } = await getHistory(app, 'cr107hist/payments');
    expect(commit(body, SHA_MANY)?.pull_request_numbers).toEqual([301, 302, 303]);
  });

  it('다른 저장소의 같은 SHA는 접근 범위 밖이라 섞이지 않는다', async () => {
    const { body } = await getHistory(app, 'cr107hist/payments');
    expect(commit(body, SHA_SHARED)?.pull_request_numbers).toEqual([555]);
    expect(JSON.stringify(body)).not.toContain('999');
  });

  it('성공하면 pull_requests_unavailable 키 자체가 없다', async () => {
    const { body } = await getHistory(app, 'cr107hist/payments');
    expect(body.pull_requests_unavailable).toBeUndefined();
  });

  it('페이지의 SHA 5개를 조회 한 번으로 채운다 — N+1 금지', async () => {
    await getHistory(app, 'cr107hist/payments');
    expect(searchSpy).toHaveBeenCalledTimes(1);
  });

  it('반복 요청도 같은 답이다', async () => {
    const first = await getHistory(app, 'cr107hist/payments');
    const second = await getHistory(app, 'cr107hist/payments');
    expect(second.body.commits?.map((c) => c.pull_request_numbers)).toEqual(first.body.commits?.map((c) => c.pull_request_numbers));
  });
});

describe('es가 배선되지 않으면 History 본문은 유지한 채 unavailable로 답한다 (CR-107)', () => {
  it('모든 행이 null이고 pull_requests_unavailable이 true다 — 절대 502가 아니다', async () => {
    const { status, body } = await getHistory(appWithoutEs, 'cr107hist/payments');
    expect(status).toBe(200);
    expect(body.commits).toHaveLength(5);
    expect(body.commits?.every((c) => c.pull_request_numbers === null)).toBe(true);
    expect(body.pull_requests_unavailable).toBe(true);
  });
});

describe('es는 배선됐지만 배치 조회 자체가 실패하면 — routes.ts까지 던지지 않는다 (CR-107)', () => {
  it('실제 라우트(es 정상 배선)에서 조회가 예외를 던져도 200 + unavailable이다 — 절대 502로 새지 않는다', async () => {
    // `sourceHistory()`가 안에서 삼켜야 한다. 던진 예외가 routes.ts의 catch(GitHubApiError 등을
    // 502/503으로 매핑하는 바로 그 블록)까지 올라가면 이 응답은 200이 아니라 502가 된다 —
    // 그 경로 자체를 실제 HTTP 엔드포인트로 확인한다(단위 시험은 `sourceHistory()`를 직접 불러
    // routes.ts를 우회하므로 이 보장을 증명하지 못한다).
    searchSpy?.mockRejectedValueOnce(new Error('es 일시 장애'));
    const { status, body } = await getHistory(app, 'cr107hist/payments');
    expect(status).toBe(200);
    expect(body.error).toBeUndefined();
    expect(body.commits).toHaveLength(5);
    expect(body.commits?.every((c) => c.pull_request_numbers === null)).toBe(true);
    expect(body.pull_requests_unavailable).toBe(true);
  });
});
