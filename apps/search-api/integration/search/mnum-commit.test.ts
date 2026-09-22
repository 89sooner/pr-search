/**
 * `kind:commit`의 `mnum:` 조회 (CR-115 / FR-SEQ-012 AC-7).
 *
 * 커밋 문서에 M 값 세 필드가 실리면 질의 빌더·에폭 게이트·브랜치 항(CR-114)이 PR 문서와 똑같이
 * 커밋 인덱스에도 걸린다 — 새 분기가 없다는 것이 이 시험의 요점이다. 실제 Fastify + Elasticsearch +
 * PostgreSQL + Redis로 본다:
 *
 * 1. `kind:commit repo:X base:main mnum:7`이 그 번호의 **머지 커밋 문서**를 낸다.
 * 2. `base:`를 생략해도 추적 브랜치가 하나면 같다(CR-114 규칙이 커밋 인덱스에도 그대로다).
 * 3. 부정형 `-mnum:7`은 다른 번호의 머지 커밋만 낸다 — M 값이 없는 직접 푸시·원본 커밋 문서는
 *    에폭 항에 걸려 나오지 않는다(잠정값을 지어내지 않는다).
 *
 * 커밋 hit 응답에 M 값을 싣는 것은 이 시험의 대상이 아니다(DEV-742).
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

const USER = 'sub-cr115-mnum-commit';
const REPOSITORY_ID = 11_511;
const ORG = 115;
const REPOSITORY = 'cr115c/single';
const SHA_MERGE_7 = '7a'.repeat(20);
const SHA_MERGE_8 = '8b'.repeat(20);
const SHA_DIRECT = '9c'.repeat(20);
const SHA_SOURCE = '0d'.repeat(20);

let pool: Pool;
let redis: Redis;
let es: Client;
let app: FastifyInstance;
let sessions: SessionStore;
let sessionId: string;

interface SearchBody {
  readonly total?: { value: number; relation: string };
  readonly items?: { kind: string; commit_sha?: string; pr_number?: number }[];
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

function shasOf(body: SearchBody): string[] {
  return (body.items ?? []).map((item) => item.commit_sha ?? '').sort();
}

function commit(sha: string, role: string, mergeSeq: number, mergeNumber: number | null) {
  return {
    _id: `${String(REPOSITORY_ID)}:${sha}`,
    repository_id: REPOSITORY_ID,
    repository: REPOSITORY,
    org_id: ORG,
    visibility: 'internal',
    allowed_team_ids: [ORG * 10],
    commit_sha: sha,
    message: `커밋 M 값 픽스처 ${role} ${String(mergeSeq)}`,
    author: 'kim',
    committed_at: '2026-08-19T04:00:00Z',
    authored_at: '2026-08-19T04:00:00Z',
    base_branch: 'main',
    merge_seq: mergeSeq,
    seq_epoch: 1,
    sequence_space: `${REPOSITORY}@main`,
    role,
    changed_paths: ['src/pay/retry.ts'],
    additions: 1,
    deletions: 0,
    document_version: 1,
    // M 값은 `role: merge_commit` 문서에만 있다 (FR-SEQ-012 AC-7) — 직접 푸시·원본 커밋은 비어 있다.
    ...(mergeNumber === null ? {} : { merge_number: mergeNumber, merge_number_epoch: 1, merge_number_state: 'assigned' }),
  };
}

const COMMITS = [
  commit(SHA_MERGE_7, 'merge_commit', 10, 7),
  commit(SHA_MERGE_8, 'merge_commit', 11, 8),
  commit(SHA_DIRECT, 'direct_push', 12, null),
  commit(SHA_SOURCE, 'source_commit', 13, null),
];

beforeAll(async () => {
  pool = await migratedPool();
  redis = createTestRedis();
  es = createEsClient(resolveClientOptions());
  await applyMappings(es);
  await switchAliasesForTests(es);

  await pool.query('DELETE FROM sequence_space WHERE repository_id = $1', [REPOSITORY_ID]);
  await pool.query('DELETE FROM repository WHERE repository_id = $1', [REPOSITORY_ID]);
  await pool.query('DELETE FROM permission_cache WHERE user_id = $1', [USER]);
  await pool.query('DELETE FROM app_user WHERE user_id = $1', [USER]);

  await authRepo.upsertUserOnLogin(pool, { user_id: USER, login: 'cr115-mnum-commit-kim', github_user_id: 115_002 });
  await repositoryRepo.upsertRepository(pool, {
    repository_id: REPOSITORY_ID,
    owner: 'cr115c',
    name: 'single',
    org_id: ORG,
    visibility: 'internal',
    sequence_branches: ['main'],
  });
  await sequenceSpaceRepo.ensureSequenceSpace(pool, REPOSITORY_ID, 'main');

  await es.deleteByQuery({
    index: ['prs-commits', 'prs-pull-requests'],
    query: { term: { repository_id: REPOSITORY_ID } },
    refresh: true,
    conflicts: 'proceed',
  });
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
  sessions = new SessionStore({ redis: redisPort });
  const source: AccessScopeSource = {
    fetch: async () => ({ repositoryIds: [REPOSITORY_ID], orgIds: [ORG], teamIds: [ORG * 10], visibilities: ['public', 'internal'] }),
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
    index: ['prs-commits'],
    query: { term: { repository_id: REPOSITORY_ID } },
    refresh: true,
    conflicts: 'proceed',
  });
  await pool?.query('DELETE FROM permission_cache WHERE user_id = $1', [USER]);
  await pool?.query('DELETE FROM app_user WHERE user_id = $1', [USER]);
  await pool?.query('DELETE FROM sequence_space WHERE repository_id = $1', [REPOSITORY_ID]);
  await pool?.query('DELETE FROM repository WHERE repository_id = $1', [REPOSITORY_ID]);
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
    login: 'cr115-mnum-commit-kim',
    email: null,
    roles: ['developer'],
    issuedAt: now,
    lastSeenAt: now,
    correlationId: null,
  });
});

describe('kind:commit의 mnum:은 머지 커밋 문서의 M 값으로 성립한다 (AC-7)', () => {
  it('`kind:commit repo:X base:main mnum:7`은 그 번호의 머지 커밋 하나다', async () => {
    const { status, body } = await get(`kind:commit repo:${REPOSITORY} base:main mnum:7`);
    expect(status).toBe(200);
    expect(shasOf(body)).toEqual([SHA_MERGE_7]);
    expect(body.items?.[0]?.kind).toBe('commit');
  });

  it('`base:`를 생략해도 추적 브랜치가 하나면 같다 — CR-114의 규칙이 커밋 인덱스에도 그대로다', async () => {
    const { status, body } = await get(`kind:commit repo:${REPOSITORY} mnum:7`);
    expect(status).toBe(200);
    expect(shasOf(body)).toEqual([SHA_MERGE_7]);
  });

  it('범위 `mnum:7..8`은 두 머지 커밋이며 직접 푸시·원본 커밋은 나오지 않는다', async () => {
    const { body } = await get(`kind:commit repo:${REPOSITORY} base:main mnum:7..8`);
    expect(shasOf(body)).toEqual([SHA_MERGE_7, SHA_MERGE_8].sort());
  });

  it('부정형 `-mnum:7`은 다른 번호의 머지 커밋만 낸다 — M 값이 없는 문서는 에폭 항에 걸린다', async () => {
    const { body } = await get(`kind:commit repo:${REPOSITORY} base:main -mnum:7`);
    expect(shasOf(body)).toEqual([SHA_MERGE_8]);
  });

  it('`kind:commit` 없이도 커밋 문서가 `mnum:`에 답한다 — 대상 인덱스는 질의가 정하고 M 값은 인덱스마다 같은 필드다', async () => {
    const { body } = await get(`repo:${REPOSITORY} base:main mnum:7`);
    expect(shasOf(body)).toEqual([SHA_MERGE_7]);
  });
});
