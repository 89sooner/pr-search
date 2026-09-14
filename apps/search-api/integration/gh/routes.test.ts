/**
 * Operations Plane 라우트 (API-GH-001·002·003·007·010·011 / WP-077, CR-086).
 *
 * 실제 PostgreSQL·Redis·**실제 HTTPS 목 GHE**로 본다. 여기서 증명하는 것:
 *   - 인가 왕복이 실제 HTTP로 성립하고, 봉인 표에 토큰 원문이 없다 (FR-GH-008 AC-5)
 *   - 미리보기 argv와 실행 요청이 남긴 argv가 같다 (FR-GH-002 AC-4)
 *   - 클라이언트가 폼을 우회해도 서버가 같은 제약으로 거절한다 (FR-GH-003 AC-5·AC-8)
 *   - 같은 요청을 두 번 보내도 실행이 하나다 (FR-GH-012 AC-5, QA-GH-14)
 *   - 다른 사용자의 실행·이력에 닿지 못한다 (FR-GH-012 AC-3)
 *   - 연결 없이·철회 뒤에는 실행이 시작되지 않는다 (FR-GH-008 예외 처리, QA-GH-12)
 *
 * 검증: `pnpm test:integration gh/routes`
 */

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  AccessScopeResolver,
  SESSION_COOKIE_NAME,
  SessionStore,
  createScopeDatabase,
  createSessionId,
  type SessionRecord,
} from '@prs/authz';
import { InMemoryEventBus, type Redis } from '@prs/bus';
import { authRepo, ghExecutionRepo, repositoryRepo, type Pool } from '@prs/db';
import { GH_PINNED_VERSION } from '@prs/gh-cli';
import { loadManifest, parseVaultKey } from '@prs/gh-cli/node';
import { buildServer } from '../../src/server.js';
import { resolveGhOpsConfig } from '../../src/gh/config.js';
import {
  GH_CAPABILITIES_PATH,
  GH_CONTEXT_REPOSITORIES_PATH,
  GH_EXECUTIONS_PATH,
  GH_EXECUTION_PREVIEW_PATH,
  GH_IDENTITY_CALLBACK_PATH,
  GH_IDENTITY_PATH,
} from '../../src/gh/routes.js';
import type { AuthContext } from '../../src/auth/context.js';
import { createTestRedis, migratedPool } from '../helpers.js';
import { TEST_CURSOR_KEY } from '../_cursor-fixture.js';
import { httpsJson } from '../../../../packages/gh-cli/testing/https-json.js';
import { startMockGhe, type MockGhe } from '../../../../packages/gh-cli/testing/mock-ghe-tls.js';
import { randomUUID } from 'node:crypto';
import { changePolicy, parsePolicyChange, policyStatus } from '../../src/gh/policy.js';
import { recordFixtureEvidence } from './policy-fixtures.js';

const VAULT_KEY = 'ab'.repeat(32);
const AUTH_CONFIG = { enabled: true, cookieSecure: false, loginPath: '/auth/login', groupRoleMap: new Map<string, never>() } as const;
const REPO_ID = 4021;
const OTHER_REPO_ID = 4022;

let pool: Pool;
let redis: Redis;
let sessions: SessionStore;
let app: FastifyInstance;
let mock: MockGhe;
let bus: InMemoryEventBus;

function redisPort(client: Redis) {
  return {
    get: (key: string) => client.get(key),
    set: (key: string, value: string, mode: 'EX', seconds: number) => client.set(key, value, mode, seconds),
    del: (...keys: string[]) => client.del(...keys),
    scan: (cursor: string, m: 'MATCH', pattern: string, c: 'COUNT', n: number) => client.scan(cursor, m, pattern, c, n),
  };
}

async function login(userId: string, roles: readonly string[] = ['developer']): Promise<Record<string, string>> {
  const sessionId = createSessionId();
  const now = Date.now();
  const record: SessionRecord = { sessionId, userId, login: userId.replace(/^u-/, ''), email: null, roles, issuedAt: now, lastSeenAt: now, correlationId: null };
  await sessions.create(record);
  return { cookie: `${SESSION_COOKIE_NAME}=${sessionId}` };
}

const INVOCATION = {
  capability_id: 'pr.list',
  context: { repository: 'acme/payments' },
  flags: { '--state': 'open', '--limit': 5 },
  output: { json_fields: ['number', 'title', 'state'] },
};

async function connect(headers: Record<string, string>, userId: string): Promise<void> {
  const start = await app.inject({ method: 'POST', url: GH_IDENTITY_PATH, headers, payload: { return_to: '/gh' } });
  expect(start.statusCode, start.body).toBe(201);
  const { state } = start.json<{ state: string }>();
  const callback = await app.inject({ method: 'POST', url: GH_IDENTITY_CALLBACK_PATH, headers, payload: { code: 'mock-code', state } });
  expect(callback.statusCode, callback.body).toBe(200);
  expect(callback.json<{ github_login: string }>().github_login).toBe('mock-user');
  void userId;
}

beforeAll(async () => {
  pool = await migratedPool();
  redis = createTestRedis();
  mock = await startMockGhe({ expectedToken: 'ghu_mockUserToken0000000000000001' });
  bus = new InMemoryEventBus();
  sessions = new SessionStore({ redis: redisPort(redis) });

  const scopes = new AccessScopeResolver({
    redis: redisPort(redis),
    db: createScopeDatabase(pool),
    source: {
      fetch: async () => ({ repositoryIds: [REPO_ID], orgIds: [1], teamIds: [], visibilities: ['public', 'internal'] }),
    },
  });
  const auth: AuthContext = { sessions, scopes, forget: async () => undefined };

  const ghConfig = resolveGhOpsConfig({
    GH_OPERATIONS_ENABLED: 'true',
    GHE_BASE_URL: mock.baseUrl,
    GHE_API_URL: mock.apiUrl,
    GHE_OPS_CLIENT_ID: 'ops-client-id',
    GHE_OPS_CLIENT_SECRET: 'ops-client-secret',
    GHE_OPS_REDIRECT_URI: 'http://web.test/gh/identity/callback',
    GH_IDENTITY_VAULT_KEY: VAULT_KEY,
  });
  const vaultKey = parseVaultKey(VAULT_KEY);
  const manifest = loadManifest();

  app = buildServer({
    config: { port: 0, adminTokens: [], metricsQueryUrl: null, gheBaseUrl: null, auth: AUTH_CONFIG, searchCursorKey: TEST_CURSOR_KEY, ghOps: ghConfig },
    auth,
    gh: {
      pool,
      bus,
      config: ghConfig,
      manifest,
      identity: { pool, redis: redisPort(redis), config: ghConfig, vaultKey, http: httpsJson(mock.caFile) },
      scopes,
      streamPollMs: 50,
    },
  });
  await app.ready();

  /*
   * 실행 경로 시험의 전제 — 이 목 GHE(배포 범위)의 현재 정의를 운영 승인해 둔다 (CR-090). 근거 행은 fixture이고 승인은 실제
   * 판정·DB 함수를 지난다. 승인·차단 자체의 HTTP 동작은 `policy-routes.test.ts`가 본다.
   */
  const policyDeps = { pool, manifest, scope: mock.host, operationsEnabled: true };
  await recordFixtureEvidence(pool, manifest, mock.host);
  const status = await policyStatus(policyDeps);
  const preview = status['approval_preview'] as { snapshot_id: number; verification_id: number; report_hash: string };
  const request = parsePolicyChange({ action: 'approve', expected_revision: (status['policy'] as { revision: number }).revision, reason: '라우트 시험 전제', snapshot_id: preview.snapshot_id, verification_id: preview.verification_id, report_hash: preview.report_hash }, manifest);
  await changePolicy(policyDeps, 'u-fixture-operator', request, `routes-fixture-${String(Date.now())}`, randomUUID());
}, 120_000);

afterAll(async () => {
  await pool.query('TRUNCATE gh_execution, gh_execution_idempotency, gh_identity_secret, github_identity_connection, app_user, repository RESTART IDENTITY CASCADE');
  await app.close();
  await mock.close();
  await bus.close();
  redis.disconnect();
  await pool.end();
});

beforeEach(async () => {
  await pool.query('TRUNCATE gh_execution, gh_execution_idempotency, gh_identity_secret, github_identity_connection, app_user, repository RESTART IDENTITY CASCADE');
  for (const id of ['u-alice', 'u-bob', 'u-sec']) await authRepo.upsertUserOnLogin(pool, { user_id: id, login: id.replace(/^u-/, '') });
  await repositoryRepo.upsertRepository(pool, { repository_id: REPO_ID, owner: 'acme', name: 'payments', org_id: 1, visibility: 'internal', sequence_branches: ['main'] });
  await repositoryRepo.upsertRepository(pool, { repository_id: OTHER_REPO_ID, owner: 'acme', name: 'secrets', org_id: 2, visibility: 'private', sequence_branches: ['main'] });
  mock.requests.length = 0;
  await redis.flushdb();
});

describe('API-GH-001 capability 목록 (FR-GH-001 AC-6)', () => {
  it('실행 가능한 것과 아닌 것을 사유와 함께 전부 낸다', async () => {
    const headers = await login('u-alice');
    const response = await app.inject({ method: 'GET', url: GH_CAPABILITIES_PATH, headers });
    expect(response.statusCode).toBe(200);
    const body = response.json<{ gh_version: string; capabilities: { id: string }[]; commands: { id: string; execution: string; execution_reason: string | null }[]; coverage: { leafCommands: number; executableCommands: number } }>();
    expect(body.gh_version).toBe(GH_PINNED_VERSION);
    expect(body.capabilities.map((c) => c.id)).toEqual(['pr.list']);
    expect(body.coverage.leafCommands).toBe(196);
    expect(body.coverage.executableCommands).toBe(1);
    const merge = body.commands.find((c) => c.id === 'pr.merge');
    expect(merge?.execution).toBe('not_implemented');
    expect(merge?.execution_reason).toMatch(/열지 않았다/);
  });

  it('세션이 없으면 401', async () => {
    expect((await app.inject({ method: 'GET', url: GH_CAPABILITIES_PATH })).statusCode).toBe(401);
  });
});

describe('API-GH-003 저장소 컨텍스트 (ADR-008)', () => {
  it('접근 범위 안의 등록·활성 저장소만 낸다', async () => {
    const headers = await login('u-alice');
    const response = await app.inject({ method: 'GET', url: GH_CONTEXT_REPOSITORIES_PATH, headers });
    expect(response.statusCode).toBe(200);
    const body = response.json<{ host: string; items: { repository: string }[] }>();
    expect(body.host).toBe(mock.host);
    expect(body.items.map((item) => item.repository)).toEqual(['acme/payments']);
  });
});

describe('API-GH-007 위임 신원 (FR-GH-008)', () => {
  it('인가 URL에는 state·code_challenge가 있고 verifier·시크릿은 없다', async () => {
    const headers = await login('u-alice');
    const start = await app.inject({ method: 'POST', url: GH_IDENTITY_PATH, headers, payload: {} });
    expect(start.statusCode).toBe(201);
    const url = new URL(start.json<{ authorize_url: string }>().authorize_url);
    expect(url.origin).toBe(mock.baseUrl);
    expect(url.pathname).toBe('/login/oauth/authorize');
    expect(url.searchParams.get('client_id')).toBe('ops-client-id');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('state')).toBeTruthy();
    expect(url.search).not.toContain('code_verifier');
    expect(url.search).not.toContain('ops-client-secret');
  });

  it('콜백이 토큰을 받아 봉인하고 연결한다 — DB 어디에도 토큰 원문이 없다 (AC-5)', async () => {
    const headers = await login('u-alice');
    await connect(headers, 'u-alice');

    const exchange = mock.requests.find((request) => request.path === '/login/oauth/access_token');
    expect(exchange?.method).toBe('POST');
    expect(exchange?.rawBody).toContain('code=mock-code');
    expect(exchange?.rawBody).toContain('code_verifier=');
    expect(exchange?.rawBody).toContain('client_secret=ops-client-secret');
    const user = mock.requests.find((request) => request.path === '/api/v3/user');
    expect(user?.headers['authorization']).toBe('Bearer ghu_mockUserToken0000000000000001');

    const status = await app.inject({ method: 'GET', url: GH_IDENTITY_PATH, headers });
    expect(status.json()).toMatchObject({ status: 'connected', github_login: 'mock-user', github_user_id: 4242, host: mock.host });

    const secrets = await pool.query<{ access_sealed: Buffer; refresh_sealed: Buffer | null }>('SELECT access_sealed, refresh_sealed FROM gh_identity_secret');
    expect(secrets.rows).toHaveLength(1);
    expect(secrets.rows[0]?.access_sealed.toString('latin1')).not.toContain('ghu_');
    expect(secrets.rows[0]?.refresh_sealed?.toString('latin1')).not.toContain('ghr_');
    const connection = await pool.query<{ token_ref: string }>('SELECT token_ref FROM github_identity_connection');
    expect(connection.rows[0]?.token_ref).toMatch(/^ids:/);
    expect(connection.rows[0]?.token_ref).not.toContain('ghu_');
  });

  it('state가 다르거나 이미 쓰였으면 연결되지 않는다 (재생 방지)', async () => {
    const headers = await login('u-alice');
    const start = await app.inject({ method: 'POST', url: GH_IDENTITY_PATH, headers, payload: {} });
    const { state } = start.json<{ state: string }>();
    const wrong = await app.inject({ method: 'POST', url: GH_IDENTITY_CALLBACK_PATH, headers, payload: { code: 'c', state: 'x'.repeat(20) } });
    expect(wrong.statusCode).toBe(401);
    expect(wrong.json<{ error: { code: string } }>().error.code).toBe('GH_IDENTITY_REQUIRED');
    // 다른 사용자가 훔친 state로는 안 된다.
    const bob = await login('u-bob');
    const stolen = await app.inject({ method: 'POST', url: GH_IDENTITY_CALLBACK_PATH, headers: bob, payload: { code: 'c', state } });
    expect(stolen.statusCode).toBe(401);
    // 그 시도가 state를 소비했으므로 원래 사용자도 다시 시작해야 한다.
    const replay = await app.inject({ method: 'POST', url: GH_IDENTITY_CALLBACK_PATH, headers, payload: { code: 'c', state } });
    expect(replay.statusCode).toBe(401);
    expect(mock.requests.filter((request) => request.path === '/login/oauth/access_token')).toHaveLength(0);
  });

  it('철회하면 봉인이 사라지고 상태가 revoked다', async () => {
    const headers = await login('u-alice');
    await connect(headers, 'u-alice');
    const revoked = await app.inject({ method: 'DELETE', url: GH_IDENTITY_PATH, headers });
    expect(revoked.json()).toMatchObject({ status: 'revoked' });
    expect((await pool.query('SELECT count(*)::int AS n FROM gh_identity_secret')).rows[0]?.n).toBe(0);
    expect((await app.inject({ method: 'GET', url: GH_IDENTITY_PATH, headers })).json()).toMatchObject({ status: 'revoked' });
    // GitHub 쪽 철회를 시도했다 (best-effort).
    expect(mock.requests.some((request) => request.method === 'DELETE' && request.path === '/api/v3/applications/ops-client-id/token')).toBe(true);
  });
});

describe('API-GH-002 미리보기와 실행 (FR-GH-002·003·012)', () => {
  it('미리보기 argv와 실행 요청이 남긴 argv가 같다 (AC-4·AC-8, QA-GH-05)', async () => {
    const headers = await login('u-alice');
    await connect(headers, 'u-alice');
    const preview = await app.inject({ method: 'POST', url: GH_EXECUTION_PREVIEW_PATH, headers, payload: INVOCATION });
    expect(preview.statusCode, preview.body).toBe(200);
    const previewBody = preview.json<{ argv: string[]; env: { key: string; value: string }[]; context: Record<string, unknown>; executable: boolean }>();
    expect(previewBody.argv).toEqual(['pr', 'list', '--repo', `${mock.host}/acme/payments`, '--state', 'open', '--limit', '5', '--json', 'number,title,state']);
    expect(previewBody.env.find((entry) => entry.key === 'GH_ENTERPRISE_TOKEN')?.value).toBe('<redacted>');
    expect(previewBody.env.map((entry) => entry.key)).not.toContain('GH_TOKEN');
    expect(previewBody.context).toMatchObject({ host: mock.host, repository: 'acme/payments', github_actor: 'mock-user', identity_status: 'connected', gh_version: GH_PINNED_VERSION, permission_check: 'delegated_token_intersection' });
    expect(previewBody.executable).toBe(true);

    const execute = await app.inject({ method: 'POST', url: GH_EXECUTIONS_PATH, headers: { ...headers, 'idempotency-key': 'req-0001-alpha' }, payload: INVOCATION });
    expect(execute.statusCode, execute.body).toBe(202);
    const created = execute.json<{ execution_id: number; state: string; argv: string[]; env_keys: string[] }>();
    expect(created.state).toBe('queued');
    expect(created.argv).toEqual(previewBody.argv);
    expect(created.env_keys).toContain('GH_ENTERPRISE_TOKEN');
    // 큐에 이벤트가 하나 실렸다.
    expect(await bus.depth('prs:gh:executions')).toBe(1);
    // 실행 기록 어디에도 토큰이 없다.
    const row = await ghExecutionRepo.findById(pool, created.execution_id);
    expect(JSON.stringify(row)).not.toContain('ghu_');
  });

  it('QA-GH-14: 같은 중복 방지 키는 실행을 하나만 만든다', async () => {
    const headers = await login('u-alice');
    await connect(headers, 'u-alice');
    const first = await app.inject({ method: 'POST', url: GH_EXECUTIONS_PATH, headers: { ...headers, 'idempotency-key': 'req-dup-000001' }, payload: INVOCATION });
    const second = await app.inject({ method: 'POST', url: GH_EXECUTIONS_PATH, headers: { ...headers, 'idempotency-key': 'req-dup-000001' }, payload: INVOCATION });
    expect(first.statusCode).toBe(202);
    expect(second.statusCode).toBe(409);
    expect(second.json<{ error: { code: string; detail: { execution_id: number } } }>().error).toMatchObject({ code: 'GH_DUPLICATE_REQUEST', detail: { execution_id: first.json<{ execution_id: number }>().execution_id } });
    expect((await pool.query('SELECT count(*)::int AS n FROM gh_execution')).rows[0]?.n).toBe(1);
  });

  it('QA-GH-03: 폼을 우회한 요청도 서버가 같은 제약으로 거절한다', async () => {
    const headers = await login('u-alice');
    await connect(headers, 'u-alice');
    const cases: { payload: Record<string, unknown>; code: string; status: number }[] = [
      { payload: { ...INVOCATION, flags: { '--web': true } }, code: 'GH_CONSTRAINT_VIOLATION', status: 400 },
      { payload: { ...INVOCATION, flags: { '--state': 'open; id' } }, code: 'GH_CONSTRAINT_VIOLATION', status: 400 },
      { payload: { ...INVOCATION, flags: { '--limit': 1000 } }, code: 'GH_CONSTRAINT_VIOLATION', status: 400 },
      { payload: { ...INVOCATION, output: { json_fields: ['body'] } }, code: 'GH_CONSTRAINT_VIOLATION', status: 400 },
      { payload: { ...INVOCATION, argv: ['pr', 'merge'] }, code: 'GH_CONSTRAINT_VIOLATION', status: 400 },
      { payload: { ...INVOCATION, context: { repository: 'acme/payments; rm -rf /' } }, code: 'GH_CONSTRAINT_VIOLATION', status: 400 },
      { payload: { ...INVOCATION, capability_id: 'pr.merge' }, code: 'GH_CAPABILITY_NOT_EXECUTABLE', status: 409 },
      { payload: { ...INVOCATION, capability_id: 'no.such' }, code: 'GH_CAPABILITY_UNKNOWN', status: 404 },
      // 범위 밖 저장소는 존재 여부를 드러내지 않는다.
      { payload: { ...INVOCATION, context: { repository: 'acme/secrets' } }, code: 'NOT_FOUND', status: 404 },
      { payload: { ...INVOCATION, context: { repository: 'acme/nonexistent' } }, code: 'NOT_FOUND', status: 404 },
    ];
    for (const [index, { payload, code, status }] of cases.entries()) {
      const response = await app.inject({ method: 'POST', url: GH_EXECUTIONS_PATH, headers: { ...headers, 'idempotency-key': `req-bad-${String(index).padStart(6, '0')}` }, payload });
      expect(response.statusCode, JSON.stringify(payload)).toBe(status);
      expect(response.json<{ error: { code: string } }>().error.code, JSON.stringify(payload)).toBe(code);
    }
    expect((await pool.query('SELECT count(*)::int AS n FROM gh_execution')).rows[0]?.n).toBe(0);
    // 미리보기도 같은 판정이다 — 두 판정이 갈리지 않는다 (AC-8).
    const preview = await app.inject({ method: 'POST', url: GH_EXECUTION_PREVIEW_PATH, headers, payload: { ...INVOCATION, flags: { '--web': true } } });
    expect(preview.statusCode).toBe(400);
  });

  it('Idempotency-Key가 없거나 형식이 틀리면 400', async () => {
    const headers = await login('u-alice');
    await connect(headers, 'u-alice');
    expect((await app.inject({ method: 'POST', url: GH_EXECUTIONS_PATH, headers, payload: INVOCATION })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: GH_EXECUTIONS_PATH, headers: { ...headers, 'idempotency-key': 'x y' }, payload: INVOCATION })).statusCode).toBe(400);
  });

  it('QA-GH-12: 연결이 없으면 미리보기는 되고 실행은 401이며, 철회 뒤에도 같다', async () => {
    const headers = await login('u-alice');
    const preview = await app.inject({ method: 'POST', url: GH_EXECUTION_PREVIEW_PATH, headers, payload: INVOCATION });
    expect(preview.statusCode).toBe(200);
    expect(preview.json<{ executable: boolean; blockers: string[] }>()).toMatchObject({ executable: false, blockers: ['identity_not_connected'] });
    const execute = await app.inject({ method: 'POST', url: GH_EXECUTIONS_PATH, headers: { ...headers, 'idempotency-key': 'req-noid-000001' }, payload: INVOCATION });
    expect(execute.statusCode).toBe(401);
    expect(execute.json<{ error: { code: string } }>().error.code).toBe('GH_IDENTITY_REQUIRED');

    await connect(headers, 'u-alice');
    await app.inject({ method: 'DELETE', url: GH_IDENTITY_PATH, headers });
    const afterRevoke = await app.inject({ method: 'POST', url: GH_EXECUTIONS_PATH, headers: { ...headers, 'idempotency-key': 'req-noid-000002' }, payload: INVOCATION });
    expect(afterRevoke.statusCode).toBe(401);
    expect((await pool.query('SELECT count(*)::int AS n FROM gh_execution')).rows[0]?.n).toBe(0);
  });
});

describe('API-GH-010·011 이력·상세·취소 (FR-GH-012 AC-3)', () => {
  it('다른 사용자의 실행은 보이지도 취소되지도 않고, 보안 담당자는 전체를 본다', async () => {
    const alice = await login('u-alice');
    await connect(alice, 'u-alice');
    const created = await app.inject({ method: 'POST', url: GH_EXECUTIONS_PATH, headers: { ...alice, 'idempotency-key': 'req-vis-000001' }, payload: INVOCATION });
    const id = created.json<{ execution_id: number }>().execution_id;

    const bob = await login('u-bob');
    expect((await app.inject({ method: 'GET', url: `${GH_EXECUTIONS_PATH}/${String(id)}`, headers: bob })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: `${GH_EXECUTIONS_PATH}/${String(id)}/cancel`, headers: bob })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: `${GH_EXECUTIONS_PATH}/${String(id)}/stream`, headers: bob })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: GH_EXECUTIONS_PATH, headers: bob })).json<{ items: unknown[] }>().items).toEqual([]);
    expect((await app.inject({ method: 'GET', url: `${GH_EXECUTIONS_PATH}?all=true`, headers: bob })).statusCode).toBe(403);

    const officer = await login('u-sec', ['developer', 'security_officer']);
    const all = await app.inject({ method: 'GET', url: `${GH_EXECUTIONS_PATH}?all=true`, headers: officer });
    expect(all.json<{ items: { execution_id: number; user_id: string }[] }>().items.map((item) => item.execution_id)).toEqual([id]);
    expect((await app.inject({ method: 'GET', url: `${GH_EXECUTIONS_PATH}/${String(id)}`, headers: officer })).statusCode).toBe(200);

    const own = await app.inject({ method: 'GET', url: `${GH_EXECUTIONS_PATH}/${String(id)}`, headers: alice });
    expect(own.json<{ state: string; stdout: unknown }>()).toMatchObject({ state: 'queued', stdout: null });
  });

  it('소유자의 취소는 요청을 남기고, SSE는 상태를 흘리고 종료에서 닫힌다', async () => {
    const alice = await login('u-alice');
    await connect(alice, 'u-alice');
    const created = await app.inject({ method: 'POST', url: GH_EXECUTIONS_PATH, headers: { ...alice, 'idempotency-key': 'req-cancel-0001' }, payload: INVOCATION });
    const id = created.json<{ execution_id: number }>().execution_id;

    const cancel = await app.inject({ method: 'POST', url: `${GH_EXECUTIONS_PATH}/${String(id)}/cancel`, headers: alice });
    expect(cancel.statusCode).toBe(202);
    expect(cancel.json<{ cancel_requested_at: string | null }>().cancel_requested_at).not.toBeNull();

    // 실행기가 없으므로 시험이 종료 상태를 직접 만든다 — 스트림이 그것을 보고 닫히는가.
    setTimeout(() => {
      void ghExecutionRepo.cancelQueued(pool, id);
    }, 120);
    const stream = await app.inject({ method: 'GET', url: `${GH_EXECUTIONS_PATH}/${String(id)}/stream`, headers: alice });
    expect(stream.statusCode).toBe(200);
    expect(stream.headers['content-type']).toContain('text/event-stream');
    expect(stream.body).toContain('event: state');
    expect(stream.body).toContain('"state":"queued"');
    expect(stream.body).toContain('"state":"cancelled"');
    expect(stream.body).toContain('event: done');
  }, 15_000);
});
