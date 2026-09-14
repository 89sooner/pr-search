/**
 * API-GH-008 운영 정책 — HTTP 계층 (WP-080 / FR-GH-011 AC-6~AC-10 · FR-GH-009 AC-8 · FR-AUTH-004 AC-6 예외, CR-090).
 *
 * 실제 Fastify 서버·실제 세션(Redis)·실제 PostgreSQL로 본다:
 *   - 역할: 조회는 `operator`·`security_officer`, 변경은 `operator`만. 역할 없는 변경 시도는 403이며 감사에 `forbidden`으로 남는다
 *   - 모양: JSON 본문만, `Idempotency-Key` 필수, 틀린 값은 400
 *   - 승인: 미리보기의 근거로만 승인되고, 같은 키 재요청은 replayed, 다른 내용은 409, 오래된 revision은 409(현재 revision 포함)
 *   - 부적격: 근거가 오래되면 409와 사유 목록
 *   - 게이트: 승인 전 capability 목록은 운영 승인 필요, 차단 뒤 실행 요청은 403 `GH_POLICY_BLOCKED`, 재개 뒤 202
 *   - 적용 감사는 DB 함수가 한 행, 거절 감사는 결과 코드로 한 행, replayed는 0행
 *
 * 근거 행은 fixture다(`policy-fixtures.ts`). 실제 바이너리 근거는 `gh-executor/integration/policy-flow.test.ts`가 본다.
 *
 * 검증: `pnpm test:integration policy-routes`
 */

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AccessScopeResolver, SESSION_COOKIE_NAME, SessionStore, createScopeDatabase, createSessionId, type SessionRecord } from '@prs/authz';
import { InMemoryEventBus, type Redis } from '@prs/bus';
import { authRepo, repositoryRepo, type Pool } from '@prs/db';
import type { GhCapabilityManifest } from '@prs/gh-cli';
import { loadManifest, parseVaultKey } from '@prs/gh-cli/node';
import { buildServer } from '../../src/server.js';
import { resolveGhOpsConfig } from '../../src/gh/config.js';
import { GH_CAPABILITIES_PATH, GH_EXECUTIONS_PATH, GH_EXECUTION_PREVIEW_PATH, GH_IDENTITY_CALLBACK_PATH, GH_IDENTITY_PATH, GH_POLICIES_PATH, GH_POLICY_CHANGES_PATH } from '../../src/gh/routes.js';
import type { AuthContext } from '../../src/auth/context.js';
import { createTestRedis, migratedPool } from '../helpers.js';
import { TEST_CURSOR_KEY } from '../_cursor-fixture.js';
import { httpsJson } from '../../../../packages/gh-cli/testing/https-json.js';
import { startMockGhe, type MockGhe } from '../../../../packages/gh-cli/testing/mock-ghe-tls.js';
import { recordFixtureEvidence } from './policy-fixtures.js';

const VAULT_KEY = 'cd'.repeat(32);
const AUTH_CONFIG = { enabled: true, cookieSecure: false, loginPath: '/auth/login', groupRoleMap: new Map<string, never>() } as const;
const REPO_ID = 6021;
const INVOCATION = { capability_id: 'pr.list', context: { repository: 'acme/payments' }, flags: { '--state': 'open', '--limit': 5 }, output: { json_fields: ['number', 'title'] } };

let pool: Pool;
let redis: Redis;
let sessions: SessionStore;
let app: FastifyInstance;
let mock: MockGhe;
let bus: InMemoryEventBus;
let manifest: GhCapabilityManifest;
let keySequence = 0;

const key = (): string => `policy-http-${String(Date.now())}-${String((keySequence += 1))}`;

function redisPort(client: Redis) {
  return {
    get: (k: string) => client.get(k),
    set: (k: string, value: string, mode: 'EX', seconds: number) => client.set(k, value, mode, seconds),
    del: (...keys: string[]) => client.del(...keys),
    scan: (cursor: string, m: 'MATCH', pattern: string, c: 'COUNT', n: number) => client.scan(cursor, m, pattern, c, n),
  };
}

async function login(userId: string, roles: readonly string[]): Promise<Record<string, string>> {
  const sessionId = createSessionId();
  const now = Date.now();
  const record: SessionRecord = { sessionId, userId, login: userId.replace(/^u-/, ''), email: null, roles, issuedAt: now, lastSeenAt: now, correlationId: null };
  await sessions.create(record);
  return { cookie: `${SESSION_COOKIE_NAME}=${sessionId}` };
}

interface PolicyBody {
  readonly scope: string;
  readonly policy: { readonly revision: number; readonly approval: { readonly matches_served: boolean } | null; readonly blocked_capabilities: readonly string[] };
  readonly approval_preview: { readonly eligible: boolean; readonly reasons: readonly { code: string }[]; readonly snapshot_id: number | null; readonly verification_id: number | null; readonly report_hash: string | null; readonly opens: readonly string[] };
  readonly capabilities: readonly { readonly id: string; readonly blocked: boolean; readonly gate: { readonly allowed: boolean; readonly reason: string | null } }[];
  readonly revisions: readonly Record<string, unknown>[];
}

async function readPolicy(headers: Record<string, string>): Promise<PolicyBody> {
  const response = await app.inject({ method: 'GET', url: GH_POLICIES_PATH, headers });
  expect(response.statusCode, response.body).toBe(200);
  return response.json<PolicyBody>();
}

async function change(headers: Record<string, string>, payload: Record<string, unknown>, idempotencyKey = key()) {
  return app.inject({ method: 'POST', url: GH_POLICY_CHANGES_PATH, headers: { ...headers, 'content-type': 'application/json', 'idempotency-key': idempotencyKey }, payload: JSON.stringify(payload) });
}

async function auditRows(action: string): Promise<{ result_code: string; user_id: string; target: string | null; query: string | null }[]> {
  const result = await pool.query<{ result_code: string; user_id: string; target: string | null; query: string | null }>('SELECT result_code, user_id, target, query FROM audit_record WHERE action = $1 AND (target = $2 OR target LIKE $3) ORDER BY occurred_at, audit_id', [action, mock.host, `${mock.host}/%`]);
  return result.rows;
}

beforeAll(async () => {
  pool = await migratedPool();
  redis = createTestRedis();
  mock = await startMockGhe({ expectedToken: 'ghu_mockUserToken0000000000000001' });
  bus = new InMemoryEventBus();
  sessions = new SessionStore({ redis: redisPort(redis) });
  manifest = loadManifest();
  const scopes = new AccessScopeResolver({
    redis: redisPort(redis),
    db: createScopeDatabase(pool),
    source: { fetch: async () => ({ repositoryIds: [REPO_ID], orgIds: [1], teamIds: [], visibilities: ['public', 'internal'] }) },
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
  app = buildServer({
    config: { port: 0, adminTokens: [], metricsQueryUrl: null, gheBaseUrl: null, auth: AUTH_CONFIG, searchCursorKey: TEST_CURSOR_KEY, ghOps: ghConfig },
    auth,
    gh: { pool, bus, config: ghConfig, manifest, identity: { pool, redis: redisPort(redis), config: ghConfig, vaultKey: parseVaultKey(VAULT_KEY), http: httpsJson(mock.caFile) }, scopes, streamPollMs: 50 },
  });
  await app.ready();
  /*
   * 다른 통합 시험 파일이 남긴 행을 비운다. CI는 모든 파일을 한 DB에서 차례로 돌리고 순서는 정해져 있지 않다 —
   * `acme/payments`를 다른 ID로 넣는 파일이 앞에 돌면 저장소 upsert가 (owner, name) 고유 제약에 걸린다(실측).
   * 정책 표도 비운다: 목 GHE의 포트가 다시 쓰이면 남은 정책이 이 파일의 「revision 0」 전제를 깬다.
   */
  await pool.query('TRUNCATE gh_execution, gh_execution_idempotency, gh_identity_secret, github_identity_connection, app_user, repository, gh_operations_policy_revision, gh_operations_policy RESTART IDENTITY CASCADE');
  for (const id of ['u-dev', 'u-ops', 'u-sec', 'u-both']) await authRepo.upsertUserOnLogin(pool, { user_id: id, login: id.replace(/^u-/, '') });
  await repositoryRepo.upsertRepository(pool, { repository_id: REPO_ID, owner: 'acme', name: 'payments', org_id: 1, visibility: 'internal', sequence_branches: ['main'] });
}, 120_000);

afterAll(async () => {
  await pool.query('TRUNCATE gh_execution, gh_execution_idempotency, gh_identity_secret, github_identity_connection, app_user, repository, gh_operations_policy_revision, gh_operations_policy RESTART IDENTITY CASCADE');
  await app.close();
  await mock.close();
  await bus.close();
  redis.disconnect();
  await pool.end();
});

beforeEach(async () => {
  await redis.flushdb();
});

describe('API-GH-008 — 역할과 요청 모양', () => {
  it('조회는 operator·security_officer만, 세션이 없으면 401·다른 역할은 403', async () => {
    expect((await app.inject({ method: 'GET', url: GH_POLICIES_PATH })).statusCode).toBe(401);
    const denied = await app.inject({ method: 'GET', url: GH_POLICIES_PATH, headers: await login('u-dev', ['developer']) });
    expect(denied.statusCode).toBe(403);
    const security = await readPolicy(await login('u-sec', ['security_officer']));
    expect(security).toMatchObject({ scope: mock.host, policy: { revision: 0, approval: null, blocked_capabilities: [] } });
    expect(security.approval_preview.eligible).toBe(false);
    expect(security.approval_preview.reasons.map((reason) => reason.code)).toContain('evidence_missing');
    expect(security.capabilities).toEqual([{ id: 'pr.list', blocked: false, gate: expect.objectContaining({ allowed: false, reason: 'admin_action_required' }) as unknown }]);
  });

  it('변경은 operator만 — developer·security_officer의 시도는 403이고 감사에 forbidden으로 남는다', async () => {
    for (const [userId, roles] of [['u-dev', ['developer']], ['u-sec', ['security_officer']]] as const) {
      const response = await change(await login(userId, roles), { action: 'block', expected_revision: 0, reason: '권한 없는 시도', capability_id: 'pr.list' });
      expect(response.statusCode, userId).toBe(403);
      expect(response.json<{ error: { code: string } }>().error.code).toBe('FORBIDDEN_ROLE');
    }
    const forbidden = (await auditRows('gh_capability.block')).filter((row) => row.result_code === 'forbidden');
    expect(forbidden.map((row) => row.user_id).sort()).toEqual(['u-dev', 'u-sec']);
    expect((await readPolicy(await login('u-ops', ['operator']))).policy.revision).toBe(0);
  });

  it('JSON 본문만 받고, 중복 방지 키와 값의 모양이 틀리면 400이다', async () => {
    const headers = await login('u-ops', ['operator']);
    const formPost = await app.inject({ method: 'POST', url: GH_POLICY_CHANGES_PATH, headers: { ...headers, 'content-type': 'application/x-www-form-urlencoded', 'idempotency-key': key() }, payload: 'action=block&expected_revision=0&reason=x&capability_id=pr.list' });
    expect([400, 415]).toContain(formPost.statusCode);
    const textPost = await app.inject({ method: 'POST', url: GH_POLICY_CHANGES_PATH, headers: { ...headers, 'content-type': 'text/plain', 'idempotency-key': key() }, payload: '{"action":"block","expected_revision":0,"reason":"x","capability_id":"pr.list"}' });
    expect(textPost.statusCode).toBe(400);
    const noKey = await app.inject({ method: 'POST', url: GH_POLICY_CHANGES_PATH, headers: { ...headers, 'content-type': 'application/json' }, payload: JSON.stringify({ action: 'block', expected_revision: 0, reason: 'x', capability_id: 'pr.list' }) });
    expect(noKey.statusCode).toBe(400);
    for (const payload of [
      { action: 'delete', expected_revision: 0, reason: 'x' },
      { action: 'block', expected_revision: -1, reason: 'x', capability_id: 'pr.list' },
      { action: 'block', expected_revision: 0, reason: '', capability_id: 'pr.list' },
      { action: 'block', expected_revision: 0, reason: 'x', capability_id: 'pr.merge' },
      { action: 'approve', expected_revision: 0, reason: 'x' },
    ]) {
      const response = await change(headers, payload);
      expect(response.statusCode, JSON.stringify(payload)).toBe(400);
      expect(response.json<{ error: { code: string } }>().error.code).toBe('INVALID_PARAMETER');
    }
    expect((await readPolicy(headers)).policy.revision).toBe(0);
  });
});

describe('API-GH-008 — 승인·차단·재개가 실행 요청을 통제한다', () => {
  it('근거가 오래되면 부적격 사유와 함께 409이다', async () => {
    await recordFixtureEvidence(pool, manifest, mock.host, { checkedAt: new Date(Date.now() - 3 * 86_400_000) });
    const headers = await login('u-ops', ['operator']);
    const body = await readPolicy(headers);
    expect(body.approval_preview.reasons.map((reason) => reason.code)).toEqual(['evidence_stale']);
    const response = await change(headers, { action: 'approve', expected_revision: 0, reason: '오래된 근거로 승인 시도', snapshot_id: body.approval_preview.snapshot_id, verification_id: body.approval_preview.verification_id, report_hash: body.approval_preview.report_hash });
    expect(response.statusCode).toBe(409);
    expect(response.json<{ error: { code: string; detail: { reasons: { code: string }[] } } }>().error).toMatchObject({ code: 'GH_REGISTRY_APPROVAL_INELIGIBLE', detail: { reasons: [{ code: 'evidence_stale' }] } });
    expect((await auditRows('gh_registry.approve')).map((row) => row.result_code)).toContain('ineligible');
  });

  it('승인 → 실행 수락 → 차단 → 403 → 재개 → 수락. 재요청·다른 내용·오래된 revision도 HTTP 응답으로 구분된다', async () => {
    await recordFixtureEvidence(pool, manifest, mock.host);
    const operator = await login('u-ops', ['operator']);
    const user = await login('u-dev', ['developer']);
    const start = await app.inject({ method: 'POST', url: GH_IDENTITY_PATH, headers: user, payload: {} });
    const { state } = start.json<{ state: string }>();
    expect((await app.inject({ method: 'POST', url: GH_IDENTITY_CALLBACK_PATH, headers: user, payload: { code: 'mock-code', state } })).statusCode).toBe(200);

    // 승인 전 — 사용자의 실행 요청은 409 운영 승인 필요.
    const before = await app.inject({ method: 'POST', url: GH_EXECUTIONS_PATH, headers: { ...user, 'idempotency-key': key() }, payload: INVOCATION });
    expect(before.statusCode).toBe(409);
    expect(before.json<{ error: { code: string } }>().error.code).toBe('GH_ADMIN_ACTION_REQUIRED');

    const preview = (await readPolicy(operator)).approval_preview;
    expect(preview).toMatchObject({ eligible: true, opens: ['pr.list'] });
    const approveBody = { action: 'approve', expected_revision: 0, reason: 'HTTP 승인', snapshot_id: preview.snapshot_id, verification_id: preview.verification_id, report_hash: preview.report_hash };
    const approvalKey = key();
    const approved = await change(operator, approveBody, approvalKey);
    expect(approved.statusCode, approved.body).toBe(200);
    expect(approved.json()).toMatchObject({ outcome: 'applied', revision: 1, policy: { revision: 1 } });

    const replay = await change(operator, approveBody, approvalKey);
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toMatchObject({ outcome: 'replayed', revision: 1 });
    expect((await auditRows('gh_registry.approve')).filter((row) => row.result_code === 'applied')).toHaveLength(1);

    const reused = await change(operator, { ...approveBody, reason: '다른 사유' }, approvalKey);
    expect(reused.statusCode).toBe(409);
    expect(reused.json<{ error: { code: string; detail: { reason: string } } }>().error).toMatchObject({ code: 'GH_DUPLICATE_REQUEST', detail: { reason: 'idempotency_key_reused' } });

    const staleRevision = await change(operator, { action: 'block', expected_revision: 0, reason: '오래된 화면', capability_id: 'pr.list' });
    expect(staleRevision.statusCode).toBe(409);
    expect(staleRevision.json<{ error: { code: string; detail: Record<string, unknown> } }>().error).toMatchObject({ code: 'GH_POLICY_CONFLICT', detail: { reason: 'revision_changed', current_revision: 1 } });

    const capabilities = (await app.inject({ method: 'GET', url: GH_CAPABILITIES_PATH, headers: user })).json<{ capabilities: { id: string; execution_gate: { allowed: boolean; revision: number } }[] }>();
    expect(capabilities.capabilities[0]?.execution_gate).toMatchObject({ allowed: true, revision: 1 });
    const accepted = await app.inject({ method: 'POST', url: GH_EXECUTIONS_PATH, headers: { ...user, 'idempotency-key': key() }, payload: INVOCATION });
    expect(accepted.statusCode, accepted.body).toBe(202);

    const blocked = await change(operator, { action: 'block', expected_revision: 1, reason: '사고 대응', capability_id: 'pr.list' });
    expect(blocked.statusCode).toBe(200);
    const refused = await app.inject({ method: 'POST', url: GH_EXECUTIONS_PATH, headers: { ...user, 'idempotency-key': key() }, payload: INVOCATION });
    expect(refused.statusCode).toBe(403);
    expect(refused.json<{ error: { code: string; detail: { reason: string } } }>().error).toMatchObject({ code: 'GH_POLICY_BLOCKED', detail: { reason: 'policy_blocked' } });
    const previewBlocked = (await app.inject({ method: 'POST', url: GH_EXECUTION_PREVIEW_PATH, headers: user, payload: INVOCATION })).json<{ executable: boolean; blockers: string[] }>();
    expect(previewBlocked).toMatchObject({ executable: false, blockers: ['policy_blocked'] });

    const resumed = await change(operator, { action: 'resume', expected_revision: 2, reason: '해소', capability_id: 'pr.list' });
    expect(resumed.statusCode).toBe(200);
    const after = await app.inject({ method: 'POST', url: GH_EXECUTIONS_PATH, headers: { ...user, 'idempotency-key': key() }, payload: INVOCATION });
    expect(after.statusCode).toBe(202);
    expect(after.json<{ execution_id: number }>().execution_id).toBeGreaterThan(0);

    const history = (await readPolicy(await login('u-sec', ['security_officer']))).revisions.map((one) => [one['revision'], one['action'], one['actor']]);
    expect(history).toEqual([[3, 'resume', 'u-ops'], [2, 'block', 'u-ops'], [1, 'approve', 'u-ops']]);
    expect((await auditRows('gh_capability.block')).map((row) => row.result_code)).toEqual(expect.arrayContaining(['forbidden', 'applied']));
  });

  it('security_officer와 operator를 모두 가진 사용자는 변경할 수 있다', async () => {
    const both = await login('u-both', ['security_officer', 'operator']);
    const current = (await readPolicy(both)).policy.revision;
    const response = await change(both, { action: 'block', expected_revision: current, reason: '두 역할', capability_id: 'pr.list' });
    expect(response.statusCode, response.body).toBe(200);
    expect((await change(both, { action: 'resume', expected_revision: current + 1, reason: '두 역할 재개', capability_id: 'pr.list' })).statusCode).toBe(200);
  });
});
