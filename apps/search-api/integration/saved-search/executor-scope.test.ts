/**
 * 저장된 검색을 공유받아 실행해도 저장자의 권한이 승계되지 않는다
 * (WP-033 / FR-SRCH-010 AC-3, THR-012 — CR-049).
 *
 * ## 왜 이 파일이 따로 있는가
 *
 * `saved-search.test.ts`는 저장된 검색 자원 자체를 건다 — 누가 보고 누가 고치는가.
 * 그러나 AC-3이 말하는 것은 **그 자원 밖의 결과**다: 공유받은 사람이 실행했을 때
 * 나오는 PR·커밋이 실행한 사람의 접근 범위로 계산되는가.
 *
 * 그것을 증명하려면 실제 Elasticsearch 문서와 두 사람의 서로 다른 접근 범위가
 * 필요하다. `/run` 응답만 보고는 알 수 없다 — 그 응답은 질의 문자열과 이동
 * 대상뿐이고, **바로 그것이 이 설계의 요점이다.**
 *
 * ## 이 파일이 반증하려는 결함
 *
 * 저장된 검색이 저장자의 범위를 어딘가에 남기면(행·응답·캐시) 공유받은 사람이
 * 그 범위로 조회하게 된다. 그것은 접근 통제 우회이고, 실패가 조용하다 —
 * 결과가 **더 많이** 나올 뿐 오류가 나지 않는다.
 *
 * 실행: `pnpm test:integration saved-search/executor-scope`
 */

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Client } from '@elastic/elasticsearch';
import {
  AccessScopeResolver,
  SESSION_COOKIE_NAME,
  SessionStore,
  createScopeDatabase,
  createSessionId,
  scopeKey,
  type AccessScopeSource,
} from '@prs/authz';
import { applyMappings, createEsClient, resolveClientOptions, switchAliasesForTests } from '@prs/es';
import { authRepo, repositoryRepo, type Pool } from '@prs/db';
import type { Redis } from '@prs/bus';
import { buildServer } from '../../src/server.js';
import { SEARCH_PATH } from '../../src/search/routes.js';
import { SAVED_SEARCHES_PATH, SAVED_SEARCH_ITEM_PATH } from '../../src/saved-search/routes.js';
import type { AuthContext, AuthRedis } from '../../src/auth/context.js';
import { createTestRedis, migratedPool } from '../helpers.js';
import { TEST_CURSOR_KEY, TEST_CURSOR_SIGNER } from '../_cursor-fixture.js';

const AUTH_CONFIG = {
  enabled: true,
  cookieSecure: true,
  loginPath: '/auth/login',
  groupRoleMap: new Map<string, never>(),
} as const;

/** 저장자. 두 저장소를 다 본다. */
const SAVER = 'sub-wp033-scope-saver';
/** 공유받는 사람. 같은 팀이지만 비밀 저장소에는 접근이 없다. */
const VIEWER = 'sub-wp033-scope-viewer';
const USERS = [SAVER, VIEWER];

const SHARED_TEAM = 90341;
const OPEN_REPO = 90410;
/** 저장자만 볼 수 있다. 공유받은 사람의 결과에 **한 건도** 나오면 안 된다. */
const SECRET_REPO = 90411;
const ORG = 9041;

/** 저장자·공유자에게 각각 다른 범위를 준다. */
const SCOPES: Record<string, readonly number[]> = {
  [SAVER]: [OPEN_REPO, SECRET_REPO],
  [VIEWER]: [OPEN_REPO],
};

let pool: Pool;
let redis: Redis;
let es: Client;
let app: FastifyInstance;
let saverCookie: Record<string, string>;
let viewerCookie: Record<string, string>;

function redisPort(): AuthRedis {
  return {
    get: (key) => redis.get(key),
    set: (key, value, mode, seconds) => redis.set(key, value, mode, seconds),
    del: (...keys) => redis.del(...keys),
    scan: (cursor, m, pattern, c, n) => redis.scan(cursor, m, pattern, c, n),
  };
}

interface SearchBody {
  readonly total: { value: number };
  readonly items: { repository: string | null; pr_number?: number }[];
}

async function search(headers: Record<string, string>, query: string): Promise<SearchBody> {
  const response = await app.inject({
    method: 'GET',
    url: `${SEARCH_PATH}?q=${encodeURIComponent(query)}`,
    headers,
  });
  expect(response.statusCode).toBe(200);
  return response.json<SearchBody>();
}

function prDocument(repositoryId: number, name: string, prNumber: number, title: string): Record<string, unknown> {
  return {
    document_version: 1,
    repository_id: repositoryId,
    repository: name,
    org_id: ORG,
    visibility: 'internal',
    allowed_team_ids: [SHARED_TEAM],
    pr_number: prNumber,
    title,
    body: '실행자 범위 시험 픽스처',
    state: 'merged',
    author: 'wp033-author',
    labels: [],
    base_branch: 'main',
    head_branch: `feature/${String(prNumber)}`,
    merge_seq: prNumber,
    seq_epoch: 1,
    sequence_space: `${name}@main`,
    created_at: '2026-08-01T00:00:00Z',
    updated_at: '2026-08-02T00:00:00Z',
    merged_at: '2026-08-02T00:00:00Z',
    changed_files_count: 1,
    additions: 1,
    deletions: 1,
    changed_paths: ['src/a.ts'],
    indexed_at: '2026-08-27T00:00:00Z',
  };
}

beforeAll(async () => {
  pool = await migratedPool();
  redis = createTestRedis();
  es = createEsClient(resolveClientOptions());
  await applyMappings(es);
  await switchAliasesForTests(es);

  await pool.query('DELETE FROM saved_search WHERE owner_user_id = ANY($1::text[])', [USERS]);
  await pool.query('DELETE FROM permission_cache WHERE user_id = ANY($1::text[])', [USERS]);
  await pool.query('DELETE FROM team_member WHERE team_id = $1', [SHARED_TEAM]);
  await pool.query('DELETE FROM app_user WHERE user_id = ANY($1::text[])', [USERS]);
  await pool.query('DELETE FROM team WHERE team_id = $1', [SHARED_TEAM]);
  await pool.query('DELETE FROM repository WHERE repository_id = ANY($1::bigint[])', [
    [OPEN_REPO, SECRET_REPO],
  ]);

  for (const [userId, login] of [
    [SAVER, 'wp033-scope-saver'],
    [VIEWER, 'wp033-scope-viewer'],
  ] as const) {
    await authRepo.upsertUserOnLogin(pool, { user_id: userId, login });
  }
  await authRepo.upsertTeam(pool, { team_id: SHARED_TEAM, slug: 'wp033-scope', org_id: ORG });
  await authRepo.replaceTeamMembers(pool, SHARED_TEAM, [SAVER, VIEWER]);

  for (const [id, owner, name] of [
    [OPEN_REPO, 'wp033', 'open'],
    [SECRET_REPO, 'wp033', 'secret'],
  ] as const) {
    await repositoryRepo.upsertRepository(pool, {
      repository_id: id,
      owner,
      name,
      org_id: ORG,
      visibility: 'internal',
      sequence_branches: ['main'],
    });
  }

  // 이 스위트의 저장소만 지운다 (risks 30).
  await es.deleteByQuery({
    index: ['prs-pull-requests'],
    query: { terms: { repository_id: [OPEN_REPO, SECRET_REPO] } },
    refresh: true,
    conflicts: 'proceed',
  });

  const bulk = await es.bulk({
    refresh: true,
    operations: [
      { index: { _index: 'prs-pull-requests', _id: 'wp033-open-1', routing: String(OPEN_REPO) } },
      { ...prDocument(OPEN_REPO, 'wp033/open', 1, '열린 저장소의 변경'), doc_id: 'wp033-open-1' },
      { index: { _index: 'prs-pull-requests', _id: 'wp033-secret-1', routing: String(SECRET_REPO) } },
      { ...prDocument(SECRET_REPO, 'wp033/secret', 2, '비밀 저장소의 변경'), doc_id: 'wp033-secret-1' },
    ],
  });
  if (bulk.errors) {
    const reasons = bulk.items.map((item) => item.index?.error?.reason).filter((one) => one !== undefined);
    throw new Error(`fixture 색인이 거부됐다: ${reasons.join(' / ')}`);
  }

  const sessions = new SessionStore({ redis: redisPort() });
  /*
   * **사용자마다 다른 범위를 준다.** 이것이 이 파일의 재료다 — 같은 범위를
   * 주면 승계가 일어나도 결과가 같아서 아무것도 증명하지 못한다.
   */
  const source: AccessScopeSource = {
    fetch: async (user) => ({
      repositoryIds: [...(SCOPES[user.userId] ?? [])],
      orgIds: [],
      teamIds: [SHARED_TEAM],
      visibilities: ['public', 'internal'],
    }),
  };

  const auth: AuthContext = {
    sessions,
    scopes: new AccessScopeResolver({ redis: redisPort(), db: createScopeDatabase(pool), source }),
    forget: async (ids) => {
      if (ids.length > 0) await redis.del(...ids.map(scopeKey));
    },
  };

  app = buildServer({
    config: {
      port: 0,
      adminTokens: [],
      metricsQueryUrl: null,
      gheBaseUrl: null,
      auth: AUTH_CONFIG,
      searchCursorKey: TEST_CURSOR_KEY,
    },
    auth,
    search: {
      es,
      cursorSigner: TEST_CURSOR_SIGNER,
      resolveNames: async (names) => ({
        orgIds: await repositoryRepo.resolveOrgIds(pool, names.orgs),
        teamIds: await authRepo.resolveTeamIds(pool, names.teams),
      }),
      resolveTeamSlugs: (ids) => authRepo.resolveTeamSlugs(pool, ids),
    },
    savedSearch: { pool, cursorSigner: TEST_CURSOR_SIGNER },
  });
  await app.ready();
}, 180_000);

afterAll(async () => {
  await app?.close();
  await es?.close();
  redis?.disconnect();
  await pool?.end();
});

beforeEach(async () => {
  await pool.query('DELETE FROM saved_search WHERE owner_user_id = ANY($1::text[])', [USERS]);
  for (const userId of USERS) await redis.del(scopeKey(userId));

  const now = Date.now();
  const sessions = new SessionStore({ redis: redisPort() });
  const saverSession = createSessionId();
  const viewerSession = createSessionId();
  await sessions.create({
    sessionId: saverSession,
    userId: SAVER,
    login: 'wp033-scope-saver',
    email: null,
    roles: ['developer'],
    issuedAt: now,
    lastSeenAt: now,
    correlationId: null,
  });
  await sessions.create({
    sessionId: viewerSession,
    userId: VIEWER,
    login: 'wp033-scope-viewer',
    email: null,
    roles: ['developer'],
    issuedAt: now,
    lastSeenAt: now,
    correlationId: null,
  });
  saverCookie = { cookie: `${SESSION_COOKIE_NAME}=${saverSession}` };
  viewerCookie = { cookie: `${SESSION_COOKIE_NAME}=${viewerSession}` };
});

describe('두 사람의 접근 범위가 실제로 다르다 (전제 확인)', () => {
  it('저장자는 비밀 저장소의 PR을 본다', async () => {
    const body = await search(saverCookie, 'repo:wp033/secret');
    expect(body.items.map((item) => item.repository)).toEqual(['wp033/secret']);
  });

  it('**공유받는 사람은 같은 질의로 0건을 받는다**', async () => {
    const body = await search(viewerCookie, 'repo:wp033/secret');
    expect(body.items).toHaveLength(0);
    expect(body.total.value).toBe(0);
  });
});

describe('공유받아 실행해도 저장자의 권한이 승계되지 않는다 (AC-3 / THR-012)', () => {
  let savedSearchId: number;
  const SECRET_QUERY = 'repo:wp033/secret';

  beforeEach(async () => {
    const created = await app.inject({
      method: 'POST',
      url: SAVED_SEARCHES_PATH,
      headers: { ...saverCookie, 'content-type': 'application/json' },
      payload: {
        name: '비밀 저장소 조사',
        query: SECRET_QUERY,
        visibility: 'team',
        team_id: SHARED_TEAM,
      },
    });
    expect(created.statusCode).toBe(201);
    savedSearchId = created.json<{ saved_search_id: number }>().saved_search_id;
  });

  it('공유받은 사람에게 **저장된 검색 자체는 보인다** — 자산은 공유된다', async () => {
    const response = await app.inject({
      method: 'GET',
      url: SAVED_SEARCH_ITEM_PATH.replace(':saved_search_id', String(savedSearchId)),
      headers: viewerCookie,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json<{ query: string }>().query).toBe(SECRET_QUERY);
  });

  it('**그러나 그 질의를 실행하면 결과가 0건이다** — 결과는 실행자의 범위로 계산된다', async () => {
    const run = await app.inject({
      method: 'POST',
      url: `${SAVED_SEARCH_ITEM_PATH.replace(':saved_search_id', String(savedSearchId))}/run`,
      headers: viewerCookie,
    });
    expect(run.statusCode).toBe(200);

    const { query, navigation_url: navigationUrl } = run.json<{
      query: string;
      navigation_url: string;
    }>();
    expect(navigationUrl).toBe(`/search?q=${encodeURIComponent(SECRET_QUERY)}`);

    /*
     * 화면이 하는 일을 그대로 한다 — `/run`이 준 질의로 `/search`를 **자기
     * 세션으로** 부른다. 저장된 검색은 이 조회에 아무것도 기여하지 않는다.
     */
    const body = await search(viewerCookie, query);
    expect(body.items).toHaveLength(0);
    expect(body.total.value).toBe(0);
  });

  it('같은 저장된 검색을 저장자가 실행하면 결과가 나온다 — 차이는 실행자다', async () => {
    const run = await app.inject({
      method: 'POST',
      url: `${SAVED_SEARCH_ITEM_PATH.replace(':saved_search_id', String(savedSearchId))}/run`,
      headers: saverCookie,
    });
    const { query } = run.json<{ query: string }>();

    const body = await search(saverCookie, query);
    expect(body.items.map((item) => item.repository)).toEqual(['wp033/secret']);
  });

  it('**저장된 행에 저장자의 접근 범위가 없다**', async () => {
    const { rows } = await pool.query<Record<string, unknown>>(
      'SELECT * FROM saved_search WHERE saved_search_id = $1',
      [savedSearchId],
    );
    const row = rows[0] ?? {};
    const serialized = JSON.stringify(row);

    for (const forbidden of ['repository_ids', 'access_scope', 'scope_kind', 'visibilities']) {
      expect(serialized).not.toContain(forbidden);
    }
    // 열 자체를 세어 둔다 — 새 열이 조용히 늘면 이 시험이 먼저 말한다.
    expect(Object.keys(row).sort()).toEqual([
      'created_at',
      'last_run_at',
      'name',
      'owner_user_id',
      'query',
      'saved_search_id',
      'team_id',
      'visibility',
    ]);
  });

  it('**두 사람이 같은 질의를 직접 부른 결과가 서로 다르다** — 강제 필터가 살아 있다', async () => {
    /*
     * 둘 다 볼 수 있는 저장소에서는 결과가 같고, 한쪽만 볼 수 있는 저장소에서
     * 갈린다. 이 대비가 있어야 "0건"이 권한 때문인지 데이터가 없어서인지
     * 구분된다 — 후자면 이 시험은 아무것도 증명하지 못한다.
     */
    const saverOpen = await search(saverCookie, 'repo:wp033/open');
    const viewerOpen = await search(viewerCookie, 'repo:wp033/open');
    expect(saverOpen.items).toHaveLength(1);
    expect(viewerOpen.items).toHaveLength(1);

    const saverSecret = await search(saverCookie, 'repo:wp033/secret');
    const viewerSecret = await search(viewerCookie, 'repo:wp033/secret');
    expect(saverSecret.items).toHaveLength(1);
    expect(viewerSecret.items).toHaveLength(0);
  });
});
