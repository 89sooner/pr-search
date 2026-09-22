/**
 * `mnum:` 단일 값과 `base:` 생략 (CR-114 / FR-SRCH-005 AC-9 보완).
 *
 * `identifier-range.test.ts`(CR-106)가 범위·에폭 게이트·커서를 걸었고, 여기서는 CR-114가
 * 더한 두 가지만 실제 Fastify + Elasticsearch + PostgreSQL + Redis로 본다:
 *
 * 1. `mnum:15`가 `mnum:15..15`와 같은 결과를 낸다 — 파서가 닫힌 범위로 옮기므로
 *    질의 빌더·에폭 게이트는 그것을 구분하지 못한다.
 * 2. `base:`가 없을 때 저장소가 추적하는 시퀀스 브랜치가 **하나뿐이면** 그 브랜치로
 *    묶이고, 둘 이상이면 400(`sequence_space_ambiguous`)과 브랜치 목록이 온다.
 *    서버가 공간을 고르는 것이 아니다 — 고를 것이 없을 때만 통과한다.
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
import { applyMappings, switchAliasesForTests, createEsClient, resolveClientOptions } from '@prs/es';
import { authRepo, repositoryRepo, sequenceSpaceRepo, type Pool } from '@prs/db';
import type { Redis } from '@prs/bus';
import { buildServer } from '../../src/server.js';
import { SEARCH_PATH } from '../../src/search/routes.js';
import type { AuthContext, AuthRedis } from '../../src/auth/context.js';
import { createTestRedis, migratedPool } from '../helpers.js';
import { TEST_CURSOR_KEY, TEST_CURSOR_SIGNER } from '../_cursor-fixture.js';

const AUTH_CONFIG = {
  enabled: true,
  cookieSecure: true,
  loginPath: '/auth/login',
  groupRoleMap: new Map<string, never>(),
} as const;

const USER = 'sub-cr114-mnum';
const SINGLE = 11_411;
const DUAL = 11_412;
const ORG = 114;
const REPOSITORY_IDS = [SINGLE, DUAL];

let pool: Pool;
let redis: Redis;
let es: Client;
let app: FastifyInstance;
let sessions: SessionStore;
let sessionId: string;

interface SearchBody {
  readonly total?: { value: number; relation: string };
  readonly items?: { pr_number?: number; merge_seq: number | null }[];
  readonly error?: { code: string; message: string; detail?: Record<string, unknown> };
  readonly correlation_id: string;
}

async function get(query: string): Promise<{ status: number; body: SearchBody }> {
  const response = await app.inject({
    method: 'GET',
    url: `${SEARCH_PATH}?q=${encodeURIComponent(query)}`,
    headers: { cookie: `${SESSION_COOKIE_NAME}=${sessionId}` },
  });
  return { status: response.statusCode, body: response.json<SearchBody>() };
}

function prNumbersOf(body: SearchBody): number[] {
  return (body.items ?? []).map((item) => item.pr_number ?? 0).sort((a, b) => a - b);
}

function pr(repositoryId: number, repository: string, baseBranch: string, prNumber: number, mergeNumber: number) {
  return {
    _id: `id-pr-${String(repositoryId)}-${String(prNumber)}`,
    repository_id: repositoryId,
    repository,
    org_id: ORG,
    visibility: 'internal',
    allowed_team_ids: [ORG * 10],
    pr_number: prNumber,
    title: `단일 값 픽스처 PR #${String(prNumber)}`,
    state: 'merged',
    author: 'kim',
    labels: ['cr114'],
    base_branch: baseBranch,
    merge_seq: prNumber,
    seq_epoch: 1,
    sequence_space: `${repository}@${baseBranch}`,
    merge_number: mergeNumber,
    merge_number_epoch: 1,
    merged_at: '2026-08-19T05:02:11Z',
    created_at: '2026-08-15T00:00:00Z',
    updated_at: '2026-08-19T05:02:11Z',
    changed_files_count: 1,
    additions: 10,
    deletions: 1,
    document_version: 1,
  };
}

const PULL_REQUESTS = [
  pr(SINGLE, 'cr114s/single', 'main', 100, 10),
  pr(SINGLE, 'cr114s/single', 'main', 150, 15),
  pr(SINGLE, 'cr114s/single', 'main', 200, 20),
  pr(DUAL, 'cr114s/dual', 'main', 300, 15),
  pr(DUAL, 'cr114s/dual', 'release', 310, 15),
];

beforeAll(async () => {
  pool = await migratedPool();
  redis = createTestRedis();
  es = createEsClient(resolveClientOptions());
  await applyMappings(es);
  await switchAliasesForTests(es);

  await pool.query('DELETE FROM sequence_space WHERE repository_id = ANY($1)', [REPOSITORY_IDS]);
  await pool.query('DELETE FROM repository WHERE repository_id = ANY($1)', [REPOSITORY_IDS]);
  await pool.query('DELETE FROM permission_cache WHERE user_id = $1', [USER]);
  await pool.query('DELETE FROM app_user WHERE user_id = $1', [USER]);

  await authRepo.upsertUserOnLogin(pool, { user_id: USER, login: 'cr114-mnum-kim', github_user_id: 114_002 });
  for (const [id, name, branches] of [
    [SINGLE, 'single', ['main']],
    [DUAL, 'dual', ['main', 'release']],
  ] as const) {
    await repositoryRepo.upsertRepository(pool, {
      repository_id: id,
      owner: 'cr114s',
      name,
      org_id: ORG,
      visibility: 'internal',
      sequence_branches: [...branches],
    });
    for (const branch of branches) await sequenceSpaceRepo.ensureSequenceSpace(pool, id, branch);
  }

  await es.deleteByQuery({
    index: ['prs-pull-requests'],
    query: { terms: { repository_id: REPOSITORY_IDS } },
    refresh: true,
    conflicts: 'proceed',
  });
  const bulk = await es.bulk({
    refresh: true,
    operations: PULL_REQUESTS.flatMap(({ _id, ...doc }) => [
      { index: { _index: 'prs-pull-requests', _id } },
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
  sessions = new SessionStore({ redis: redisPort });
  const source: AccessScopeSource = {
    fetch: async () => ({ repositoryIds: REPOSITORY_IDS, orgIds: [ORG], teamIds: [ORG * 10], visibilities: ['public', 'internal'] }),
  };
  const auth: AuthContext = {
    sessions,
    scopes: new AccessScopeResolver({ redis: redisPort, db: createScopeDatabase(pool), source }),
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
      mergeNumberEnabled: true,
    },
    auth,
    search: {
      pool,
      es,
      cursorSigner: TEST_CURSOR_SIGNER,
      resolveNames: async () => ({ orgIds: new Map(), teamIds: new Map() }),
    },
  });
  await app.ready();
}, 180_000);

afterAll(async () => {
  await app?.close();
  await es?.deleteByQuery({
    index: ['prs-pull-requests'],
    query: { terms: { repository_id: REPOSITORY_IDS } },
    refresh: true,
    conflicts: 'proceed',
  });
  await pool?.query('DELETE FROM permission_cache WHERE user_id = $1', [USER]);
  await pool?.query('DELETE FROM app_user WHERE user_id = $1', [USER]);
  await pool?.query('DELETE FROM sequence_space WHERE repository_id = ANY($1)', [REPOSITORY_IDS]);
  await pool?.query('DELETE FROM repository WHERE repository_id = ANY($1)', [REPOSITORY_IDS]);
  await es?.close();
  await redis?.quit();
  await pool?.end();
});

beforeEach(async () => {
  await redis.del(scopeKey(USER));
  sessionId = createSessionId();
  const now = Date.now();
  await sessions.create({
    sessionId,
    userId: USER,
    login: 'cr114-mnum-kim',
    email: null,
    roles: ['developer'],
    issuedAt: now,
    lastSeenAt: now,
    correlationId: null,
  });
});

describe('mnum: 단일 값은 양끝이 같은 범위다', () => {
  it('`mnum:15`는 `mnum:15..15`와 같은 PR을 낸다', async () => {
    const scalar = await get('repo:cr114s/single base:main mnum:15');
    const range = await get('repo:cr114s/single base:main mnum:15..15');
    expect(scalar.status).toBe(200);
    expect(prNumbersOf(scalar.body)).toEqual([150]);
    expect(prNumbersOf(scalar.body)).toEqual(prNumbersOf(range.body));
    expect(scalar.body.total).toEqual(range.body.total);
  });

  it('부정형 `-mnum:15`는 그 PR만 뺀다', async () => {
    const { body } = await get('repo:cr114s/single base:main -mnum:15');
    expect(prNumbersOf(body)).toEqual([100, 200]);
  });

  it('없는 번호의 단일 값은 0건이다 — 오류가 아니다', async () => {
    const { status, body } = await get('repo:cr114s/single base:main mnum:16');
    expect(status).toBe(200);
    expect(prNumbersOf(body)).toEqual([]);
  });
});

describe('base: 생략 — 추적 브랜치가 하나뿐이면 그 브랜치다', () => {
  it('`repo:` 하나만으로 단일 값을 찾는다', async () => {
    const { status, body } = await get('repo:cr114s/single mnum:15');
    expect(status).toBe(200);
    expect(prNumbersOf(body)).toEqual([150]);
  });

  it('범위도 같은 규칙이다', async () => {
    const { body } = await get('repo:cr114s/single mnum:10..15');
    expect(prNumbersOf(body)).toEqual([100, 150]);
  });

  it('**브랜치가 둘이면 400과 브랜치 목록이다** — 서버가 고르지 않는다', async () => {
    const { status, body } = await get('repo:cr114s/dual mnum:15');
    expect(status).toBe(400);
    expect(body.error?.code).toBe('INVALID_PARAMETER');
    expect(body.error?.detail).toMatchObject({
      field: 'q',
      reason: 'sequence_space_ambiguous',
      required_keys: ['base'],
      repository: 'cr114s/dual',
      sequence_branches: ['main', 'release'],
    });
    expect(body.error?.message).toContain('base:');
  });

  it('브랜치가 둘이어도 `base:`를 적으면 그 공간이다', async () => {
    const main = await get('repo:cr114s/dual base:main mnum:15');
    const release = await get('repo:cr114s/dual base:release mnum:15');
    expect(prNumbersOf(main.body)).toEqual([300]);
    expect(prNumbersOf(release.body)).toEqual([310]);
  });

  it('`repo:` 없는 `mnum:`은 여전히 400 sequence_space_required이며 M 문자열 형식을 안내한다', async () => {
    const { status, body } = await get('mnum:15');
    expect(status).toBe(400);
    expect(body.error?.detail?.['reason']).toBe('sequence_space_required');
    expect(body.error?.message).toContain('M-<code>-<number>');
  });

  it('미등록 저장소는 `base:` 유무와 무관하게 404다', async () => {
    const { status, body } = await get('repo:cr114s/ghost mnum:15');
    expect(status).toBe(404);
    expect(body.error?.code).toBe('NOT_FOUND');
  });
});
