/**
 * `GET /sequence-spaces` — 실제 PostgreSQL + Redis (WP-025 / API-SEQ-006, CR-029 DEV-152).
 *
 * 이 API는 색인을 전혀 부르지 않는다 — Elasticsearch 대역은 부르면 던진다.
 * 거는 것은 둘이다: **접근 범위 밖 저장소가 목록에 없고 그 부재가 조용한가**
 * (ADR-008·THR-004), 그리고 **채번된 적 없는 브랜치를 숨기지 않고 `unknown`으로
 * 싣는가** (숨기면 등록 부재로 오인한다).
 *
 * 실행: `pnpm test:integration sequence/spaces`
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
import { authRepo, repositoryRepo, sequenceSpaceRepo, type Pool } from '@prs/db';
import type { Redis } from '@prs/bus';
import { buildServer } from '../../src/server.js';
import { SEQUENCE_SPACES_PATH } from '../../src/sequence/routes.js';
import type { AuthContext, AuthRedis } from '../../src/auth/context.js';
import { createTestRedis, migratedPool } from '../helpers.js';
import { TEST_CURSOR_KEY, TEST_CURSOR_SIGNER } from '../_cursor-fixture.js';

const AUTH_CONFIG = {
  enabled: true,
  cookieSecure: true,
  loginPath: '/auth/login',
  groupRoleMap: new Map<string, never>(),
} as const;

const USER = 'sub-spaces';
const PAYMENTS = 2101;
/** 브랜치 둘 등록 — 하나만 채번됐다. */
const LEDGER = 2102;
const HIDDEN = 2900;
const ORG = 1;

let pool: Pool;
let redis: Redis;
let app: FastifyInstance;
let sessionId: string;

interface SpacesBody {
  readonly spaces?: {
    repository: string;
    repository_id: number;
    base_branch: string;
    sequence_space: string;
    seq_epoch: number | null;
    sequence_state: string;
  }[];
  readonly error?: { code: string };
}

async function getSpaces(withSession = true): Promise<{ status: number; body: SpacesBody }> {
  const response = await app.inject({
    method: 'GET',
    url: SEQUENCE_SPACES_PATH,
    ...(withSession ? { headers: { cookie: `${SESSION_COOKIE_NAME}=${sessionId}` } } : {}),
  });
  return { status: response.statusCode, body: response.json<SpacesBody>() };
}

beforeAll(async () => {
  pool = await migratedPool();
  redis = createTestRedis();

  await pool.query('DELETE FROM sequence_space');
  await pool.query('DELETE FROM permission_cache');
  await pool.query('DELETE FROM app_user');
  await pool.query('DELETE FROM repository');

  await authRepo.upsertUserOnLogin(pool, { user_id: USER, login: 'kim', github_user_id: 7103 });
  await repositoryRepo.upsertRepository(pool, {
    repository_id: PAYMENTS,
    owner: 'acme',
    name: 'payments',
    org_id: ORG,
    visibility: 'internal',
    sequence_branches: ['main'],
  });
  await repositoryRepo.upsertRepository(pool, {
    repository_id: LEDGER,
    owner: 'acme',
    name: 'ledger',
    org_id: ORG,
    visibility: 'internal',
    // 등록 순서가 곧 목록 순서다 — 채번은 main만 됐다.
    sequence_branches: ['main', 'release/1.0'],
  });
  await repositoryRepo.upsertRepository(pool, {
    repository_id: HIDDEN,
    owner: 'other',
    name: 'secret',
    org_id: 2,
    visibility: 'private',
    sequence_branches: ['main'],
  });

  await sequenceSpaceRepo.ensureSequenceSpace(pool, PAYMENTS, 'main');
  await sequenceSpaceRepo.ensureSequenceSpace(pool, LEDGER, 'main');
  await sequenceSpaceRepo.ensureSequenceSpace(pool, HIDDEN, 'main');
  // PAYMENTS를 재채번 중 상태로 — state 통과를 검증한다.
  await pool.query("UPDATE sequence_space SET state = 'reassigning', seq_epoch = 4 WHERE repository_id = $1", [
    PAYMENTS,
  ]);

  const redisPort: AuthRedis = {
    get: (key) => redis.get(key),
    set: (key, value, mode, seconds) => redis.set(key, value, mode, seconds),
    del: (...keys) => redis.del(...keys),
    scan: (cursor, m, pattern, c, n) => redis.scan(cursor, m, pattern, c, n),
  };
  const source: AccessScopeSource = {
    fetch: async () => ({
      repositoryIds: [PAYMENTS, LEDGER],
      orgIds: [ORG],
      teamIds: [],
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

  const es = {
    search: () => {
      throw new Error('이 API는 Elasticsearch를 부르지 않는다');
    },
  } as unknown as Client;

  app = buildServer({
    config: { port: 0, adminTokens: [], metricsQueryUrl: null, gheBaseUrl: null, auth: AUTH_CONFIG, searchCursorKey: TEST_CURSOR_KEY },
    auth,
    search: { es, cursorSigner: TEST_CURSOR_SIGNER, resolveNames: async () => ({ orgIds: new Map(), teamIds: new Map() }) },
    sequence: { pool, es, cursorSigner: TEST_CURSOR_SIGNER, resolveNames: async () => ({ orgIds: new Map(), teamIds: new Map() }) },
  });
  await app.ready();
}, 180_000);

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
    sessionId,
    userId: USER,
    login: 'kim',
    email: null,
    roles: ['developer'],
    issuedAt: now,
    lastSeenAt: now,
    correlationId: null,
  });
});

afterAll(async () => {
  await app?.close();
  await redis?.quit();
  await pool?.end();
});

describe('시퀀스 공간 목록 (API-SEQ-006)', () => {
  it('**접근 범위 안 공간만, 저장소·브랜치 순서로** 나온다', async () => {
    const { status, body } = await getSpaces();
    expect(status).toBe(200);
    expect(body.spaces?.map((space) => space.sequence_space)).toEqual([
      'acme/ledger@main',
      'acme/ledger@release/1.0',
      'acme/payments@main',
    ]);
    // 범위 밖 저장소는 없고, 없다는 사실 외에는 아무것도 없다.
    expect(JSON.stringify(body)).not.toContain('secret');
  });

  it('**채번된 적 없는 브랜치는 `unknown` + 에폭 null로 싣는다** — 숨기지 않는다', async () => {
    const { body } = await getSpaces();
    const pending = body.spaces?.find((space) => space.base_branch === 'release/1.0');
    expect(pending?.sequence_state).toBe('unknown');
    expect(pending?.seq_epoch).toBeNull();
  });

  it('공간 상태와 에폭이 그대로 전달된다 — C-027의 state prop이 이 값이다', async () => {
    const { body } = await getSpaces();
    const payments = body.spaces?.find((space) => space.repository === 'acme/payments');
    expect(payments?.sequence_state).toBe('reassigning');
    expect(payments?.seq_epoch).toBe(4);
  });

  it('세션이 없으면 401이다', async () => {
    expect((await getSpaces(false)).status).toBe(401);
  });
});
