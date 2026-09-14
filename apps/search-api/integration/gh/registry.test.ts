/**
 * 레지스트리 조회 (API-GH-013·014 / A-006, FR-GH-001 AC-5·AC-6, FR-GH-011, NFR-009, CR-088).
 *
 * 실제 PostgreSQL·Redis로 본다. 여기서 증명하는 것:
 *   - `operator`·`security_officer`만 읽는다. `developer`는 403이고 세션 없음은 401이다
 *   - 기록이 없으면 빈 배열이다 — 「0개 정상」이 아니라 「없음」
 *   - 기록이 생기면 출처별 최신 하나와, 지금 적재한 manifest와 같은 해시인지가 보인다
 *   - command 상세가 분류 전부와 정의(있으면)를 낸다. 없는 id는 404, 모양이 틀리면 400
 *   - 분류 메타데이터만 allowed로 바꿔도 실행 준비가 거절한다 — 실행 허용은 코드 표가 정한다
 *   - API-GH-001의 command 목록에 분류 요약(interaction·side_effect·host_support)이 실린다
 *
 * 검증: `pnpm test:integration gh/registry`
 */

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AccessScopeResolver, SESSION_COOKIE_NAME, SessionStore, createScopeDatabase, createSessionId, type SessionRecord } from '@prs/authz';
import { InMemoryEventBus, type Redis } from '@prs/bus';
import { ghRegistryRepo, type Pool } from '@prs/db';
import { GH_PINNED_VERSION, type GhCapabilityManifest, type GhContractSummary } from '@prs/gh-cli';
import { loadManifest, parseVaultKey } from '@prs/gh-cli/node';
import { buildServer } from '../../src/server.js';
import { resolveGhOpsConfig } from '../../src/gh/config.js';
import { reportFor } from '../../src/gh/registry.js';
import { GH_CAPABILITIES_PATH, GH_EXECUTION_PREVIEW_PATH, GH_REGISTRY_PATH } from '../../src/gh/routes.js';
import type { AuthContext } from '../../src/auth/context.js';
import { createTestRedis, migratedPool } from '../helpers.js';
import { TEST_CURSOR_KEY } from '../_cursor-fixture.js';

const VAULT_KEY = 'ab'.repeat(32);
const AUTH_CONFIG = { enabled: true, cookieSecure: false, loginPath: '/auth/login', groupRoleMap: new Map<string, never>() } as const;

let pool: Pool;
let redis: Redis;
let sessions: SessionStore;
let manifest: GhCapabilityManifest;
const apps: FastifyInstance[] = [];

function redisPort(client: Redis) {
  return {
    get: (key: string) => client.get(key),
    set: (key: string, value: string, mode: 'EX', seconds: number) => client.set(key, value, mode, seconds),
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

function serverFor(served: GhCapabilityManifest): FastifyInstance {
  const scopes = new AccessScopeResolver({
    redis: redisPort(redis),
    db: createScopeDatabase(pool),
    source: { fetch: async () => ({ repositoryIds: [], orgIds: [], teamIds: [], visibilities: ['public', 'internal'] }) },
  });
  const auth: AuthContext = { sessions, scopes, forget: async () => undefined };
  const ghConfig = resolveGhOpsConfig({
    GH_OPERATIONS_ENABLED: 'true',
    GHE_BASE_URL: 'https://ghe.test',
    GHE_API_URL: 'https://ghe.test/api/v3',
    GHE_OPS_CLIENT_ID: 'ops-client-id',
    GHE_OPS_CLIENT_SECRET: 'ops-client-secret',
    GHE_OPS_REDIRECT_URI: 'http://web.test/gh/identity/callback',
    GH_IDENTITY_VAULT_KEY: VAULT_KEY,
  });
  const app = buildServer({
    config: { port: 0, adminTokens: [], metricsQueryUrl: null, gheBaseUrl: null, auth: AUTH_CONFIG, searchCursorKey: TEST_CURSOR_KEY, ghOps: ghConfig },
    auth,
    gh: {
      pool,
      bus: new InMemoryEventBus(),
      config: ghConfig,
      manifest: served,
      identity: { pool, redis: redisPort(redis), config: ghConfig, vaultKey: parseVaultKey(VAULT_KEY), http: async () => ({ status: 500, body: null }) },
      scopes,
    },
  });
  apps.push(app);
  return app;
}

let app: FastifyInstance;

interface StatusBody {
  readonly gh: { readonly pinned_version: string };
  readonly manifest: Record<string, unknown>;
  readonly validator: { readonly status: string; readonly report_version?: string };
  readonly coverage: { readonly dimensions: readonly { readonly id: string; readonly total: number; readonly classified: number }[] };
  readonly gates: readonly { readonly id: string; readonly pass: boolean }[];
  readonly execution: unknown;
  readonly contracts: GhContractSummary;
  readonly gate_scope: string;
  readonly verification: {
    readonly latest_by_source: readonly { readonly checked_by: string; readonly status: string; readonly matches_served_manifest: boolean; readonly drift: unknown; readonly report_version: string | null; readonly contract_dimensions: string }[];
    readonly recent: readonly unknown[];
    readonly executor_matches_served_manifest: boolean | null;
  };
  readonly snapshots: readonly Record<string, unknown>[];
  readonly host_verification: { readonly status: string };
}

interface EdgeBody {
  readonly from: string;
  readonly fromPort: string;
  readonly to: string;
  readonly toPort: string;
  readonly verdict: string;
  readonly execution: { readonly executable: boolean; readonly reason: string };
}

interface DetailBody {
  readonly id: string;
  readonly execution: string;
  readonly support: string;
  readonly risk: string | null;
  readonly execution_reason: string | null;
  readonly inventory_flags: readonly unknown[];
  readonly classification: { readonly flags: readonly unknown[]; readonly basis: { readonly evidence: string }; readonly sensitivity: string } & Record<string, unknown>;
  readonly definition: { readonly id: string } | null;
  readonly result_contract: ({ readonly outputPorts: readonly unknown[] } & Record<string, unknown>) | null;
  readonly graph: { readonly outgoing: readonly EdgeBody[]; readonly incoming: readonly EdgeBody[]; readonly blocked: readonly unknown[]; readonly executable_flows: number } | null;
}

/** 검증 기록 시험이 쓰는 스냅숏 입력 — 값 자체는 이 시험의 관심사가 아니다. */
function snapshotInput(manifestHash: string) {
  return {
    ghVersion: '2.97.0',
    manifestVersion: manifest.manifestVersion,
    manifestHash,
    inventoryHash: 'a'.repeat(64),
    commandCount: 229,
    leafCommandCount: 196,
    groupCommandCount: 32,
    aliasOnlyCommandCount: 1,
    aliasCount: 45,
    positionalCount: 164,
    flagCount: 1034,
    inheritedFlagCount: 312,
    jsonFieldCount: 707,
    unclassifiedCount: 0,
    interactionUnclassifiedCount: 0,
    flagUnclassifiedCount: 0,
    positionalUnclassifiedCount: 0,
    extensionCommandCount: 9,
    executableCount: 1,
    coverage: {},
  } as const;
}

beforeAll(async () => {
  pool = await migratedPool();
  redis = createTestRedis();
  sessions = new SessionStore({ redis: redisPort(redis) });
  manifest = loadManifest(GH_PINNED_VERSION);
  app = serverFor(manifest);
  await app.ready();
});

afterAll(async () => {
  await Promise.all(apps.map((one) => one.close()));
  await pool.query('TRUNCATE gh_capability_verification, gh_capability_snapshot RESTART IDENTITY CASCADE');
  await redis.quit();
  await pool.end();
});

beforeEach(async () => {
  await pool.query('TRUNCATE gh_capability_verification, gh_capability_snapshot RESTART IDENTITY CASCADE');
});

describe('접근 (A-006은 운영 화면이다)', () => {
  it('세션 없음은 401, developer는 403, operator와 security_officer는 200이다', async () => {
    expect((await app.inject({ method: 'GET', url: GH_REGISTRY_PATH })).statusCode).toBe(401);
    const developer = await app.inject({ method: 'GET', url: GH_REGISTRY_PATH, headers: await login('u-dev', ['developer']) });
    expect(developer.statusCode).toBe(403);
    expect(developer.json<{ error: { code: string } }>().error.code).toBe('FORBIDDEN_ROLE');
    expect((await app.inject({ method: 'GET', url: GH_REGISTRY_PATH, headers: await login('u-ops', ['developer', 'operator']) })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: GH_REGISTRY_PATH, headers: await login('u-sec', ['developer', 'security_officer']) })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: `${GH_REGISTRY_PATH}/commands/pr.list`, headers: await login('u-dev', ['developer']) })).statusCode).toBe(403);
  });
});

describe('API-GH-013 — 상태', () => {
  it('기록이 없으면 신원·커버리지·게이트는 있고 검증 기록·스냅숏은 빈 배열이다', async () => {
    const response = await app.inject({ method: 'GET', url: GH_REGISTRY_PATH, headers: await login('u-ops', ['operator']) });
    expect(response.statusCode).toBe(200);
    const body = response.json<StatusBody>();
    expect(body.gh.pinned_version).toBe(GH_PINNED_VERSION);
    expect(body.manifest).toMatchObject({ version: manifest.manifestVersion, hash: manifest.hash, hash_verified: true, leaf_command_count: 196 });
    expect(body.validator).toMatchObject({ status: 'passed', report_version: 'r2' });
    expect(body.coverage.dimensions.length).toBeGreaterThanOrEqual(15);
    expect(body.coverage.dimensions.find((one) => one.id === 'command_path')).toMatchObject({ total: 196, classified: 196 });
    expect(body.gates.map((gate) => [gate.id, gate.pass])).toEqual([
      ['GATE-GH-01', true],
      ['GATE-GH-01b', true],
      ['GATE-GH-01d', true],
    ]);
    // 결과 계약·연결은 분리 집계로 온다 — CLI(gh:validate-capabilities)가 부르는 같은 검증기의 값이다 (CR-089).
    expect(body.contracts).toEqual(reportFor(manifest).contracts);
    expect(body.contracts).toMatchObject({ executableCommands: ['pr.list'], adaptersImplemented: ['pr.list:pr_list_v2'], executableFlows: 0, hostVerified: 0 });
    expect(body.contracts.graph.edges).toBeGreaterThan(0);
    expect(body.gate_scope).toContain('REL-007 완료가 아니다');
    expect(body.execution).toEqual({ allowed: ['pr.list'], definitions: ['pr.list'] });
    expect(body.verification.latest_by_source).toEqual([]);
    expect(body.verification.recent).toEqual([]);
    expect(body.verification.executor_matches_served_manifest).toBeNull();
    expect(body.snapshots).toEqual([]);
    expect(body.host_verification.status).toBe('not_verified');
    expect(JSON.stringify(body)).not.toContain(VAULT_KEY);
  });

  it('기록이 생기면 출처별 최신 하나가 보이고, 적재한 manifest와 같은 해시인지 말한다', async () => {
    const { row } = await ghRegistryRepo.recordSnapshot(pool, {
      ghVersion: '2.97.0',
      manifestVersion: manifest.manifestVersion,
      manifestHash: manifest.hash,
      inventoryHash: 'a'.repeat(64),
      commandCount: 229,
      leafCommandCount: 196,
      groupCommandCount: 32,
      aliasOnlyCommandCount: 1,
      aliasCount: 45,
      positionalCount: 164,
      flagCount: 1034,
      inheritedFlagCount: 312,
      jsonFieldCount: 707,
      unclassifiedCount: 0,
      interactionUnclassifiedCount: 0,
      flagUnclassifiedCount: 0,
      positionalUnclassifiedCount: 0,
      extensionCommandCount: 9,
      executableCount: 1,
      coverage: {},
    });
    const base = {
      snapshotId: row.snapshot_id,
      // 실행기 기록은 배포 범위를 적는다 (마이그레이션 030, CR-090).
      scope: 'ghe.example.com',
      environment: { hostname: 'exec-1' },
      ghVersionExpected: '2.97.0',
      ghVersionObserved: '2.97.0',
      binarySha256Expected: 'b'.repeat(64),
      binarySha256Observed: 'b'.repeat(64),
      manifestHashExpected: manifest.hash,
      manifestHashObserved: manifest.hash,
      inventoryHashExpected: 'a'.repeat(64),
      inventoryHashObserved: 'a'.repeat(64),
      validatorVersion: 'v',
      rulesVersion: 'r',
      drift: null,
      report: { status: 'incomplete' },
      reportHash: 'c'.repeat(64),
      error: null,
    } as const;
    await ghRegistryRepo.insertVerification(pool, { ...base, checkedBy: 'gh-executor', trigger: 'startup', status: 'incomplete' });
    await ghRegistryRepo.insertVerification(pool, { ...base, checkedBy: 'ci', trigger: 'manual', status: 'passed' });
    await new Promise((resolve) => setTimeout(resolve, 5));
    // 실행기가 옛 manifest를 보고 있는 상황 — 기대 해시가 지금 적재한 것과 다르다.
    await ghRegistryRepo.insertVerification(pool, { ...base, checkedBy: 'gh-executor', trigger: 'periodic', status: 'drift', manifestHashExpected: 'd'.repeat(64), drift: { addedCommands: ['x'], removedCommands: [], changedCommands: [] } });

    const body = (await app.inject({ method: 'GET', url: GH_REGISTRY_PATH, headers: await login('u-sec', ['security_officer']) })).json<StatusBody>();
    const latest = body.verification.latest_by_source;
    expect(latest.map((one) => [one.checked_by, one.status, one.matches_served_manifest]).sort()).toEqual([
      ['ci', 'passed', true],
      ['gh-executor', 'drift', false],
    ]);
    expect(latest.find((one) => one.checked_by === 'gh-executor')?.drift).toEqual({ addedCommands: ['x'], removedCommands: [], changedCommands: [] });
    expect(body.verification.executor_matches_served_manifest).toBe(false);
    expect(body.verification.recent).toHaveLength(3);
    expect(body.snapshots).toHaveLength(1);
    expect(body.snapshots[0]).toMatchObject({ manifest_hash: manifest.hash, is_served: true, activated_at: null });
    // 보고서 판을 읽을 수 없는 기록은 결과 계약 차원을 검증했다고 말하지 않는다.
    expect(latest.every((one) => one.report_version === null && one.contract_dimensions === 'not_in_report_version')).toBe(true);
  });

  it('옛 판(r1) 보고서의 기록은 결과 계약 차원을 검증하지 않은 기록으로 낸다 — 새 기준으로 통과처럼 다시 읽지 않는다 (CR-089)', async () => {
    const { row } = await ghRegistryRepo.recordSnapshot(pool, snapshotInput(manifest.hash));
    const base = {
      snapshotId: row.snapshot_id,
      scope: 'ghe.example.com',
      environment: {},
      ghVersionExpected: '2.97.0',
      ghVersionObserved: '2.97.0',
      binarySha256Expected: 'b'.repeat(64),
      binarySha256Observed: 'b'.repeat(64),
      manifestHashExpected: manifest.hash,
      manifestHashObserved: manifest.hash,
      inventoryHashExpected: 'a'.repeat(64),
      inventoryHashObserved: 'a'.repeat(64),
      validatorVersion: 'v',
      rulesVersion: 'r',
      drift: null,
      reportHash: 'c'.repeat(64),
      error: null,
    } as const;
    await ghRegistryRepo.insertVerification(pool, { ...base, checkedBy: 'ci', trigger: 'manual', status: 'incomplete', report: { reportVersion: 'r1', status: 'incomplete' } });
    // r2는 등록된 해석기가 읽을 수 있는 실제 보고서여야 「검증됨」이다 (CR-090 — 판 번호의 크기 비교를 쓰지 않는다).
    await ghRegistryRepo.insertVerification(pool, { ...base, checkedBy: 'gh-executor', trigger: 'startup', status: 'passed', report: JSON.parse(JSON.stringify(reportFor(manifest))) as unknown });
    await ghRegistryRepo.insertVerification(pool, { ...base, checkedBy: 'cli', trigger: 'manual', scope: null, status: 'passed', report: { ...(JSON.parse(JSON.stringify(reportFor(manifest))) as Record<string, unknown>), reportVersion: 'r999' } });
    const body = (await app.inject({ method: 'GET', url: GH_REGISTRY_PATH, headers: await login('u-ops', ['operator']) })).json<StatusBody>();
    const bySource = new Map(body.verification.latest_by_source.map((one) => [one.checked_by, one]));
    expect(bySource.get('ci')).toMatchObject({ report_version: 'r1', contract_dimensions: 'not_in_report_version' });
    expect(bySource.get('gh-executor')).toMatchObject({ report_version: 'r2', contract_dimensions: 'verified' });
    // 해석기가 없는 판은 더 큰 번호여도 검증된 기록이 아니다.
    expect(bySource.get('cli')).toMatchObject({ report_version: 'r999', contract_dimensions: 'unsupported_report_version' });
  });
});

/**
 * 응답에 실린 키 전부. 값의 문자열이 아니라 **구조**로 본다 — 결과 계약의 근거 문장은 「stdout」 같은 낱말을
 * 정당하게 쓰므로 문자열 검색은 거짓 경보이고, 실행 기록이 섞였는지는 키로만 판정할 수 있다.
 */
function keysDeep(value: unknown, into = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) keysDeep(item, into);
  } else if (typeof value === 'object' && value !== null) {
    for (const [key, child] of Object.entries(value)) {
      into.add(key);
      keysDeep(child, into);
    }
  }
  return into;
}

/** `gh_execution` 행에만 있는 필드 (`GhExecutionRow`). A-006 상세는 manifest의 정적 계약이라 하나도 없어야 한다. */
const EXECUTION_RECORD_KEYS = ['execution_id', 'github_actor', 'user_id', 'redacted_argv', 'idempotency_key', 'stdout_excerpt', 'stderr_excerpt', 'output_hash', 'exit_code'];

const executionKeysIn = (body: unknown): string[] => [...keysDeep(body)].filter((key) => EXECUTION_RECORD_KEYS.includes(key));

describe('API-GH-014 — command 상세', () => {
  it('pr.list는 분류와 정의를, auth.token은 정책 차단 분류와 null 정의를 낸다', async () => {
    const headers = await login('u-ops', ['operator']);
    const prList = (await app.inject({ method: 'GET', url: `${GH_REGISTRY_PATH}/commands/pr.list`, headers })).json<DetailBody>();
    expect(prList).toMatchObject({ id: 'pr.list', execution: 'allowed', support: 'supported', risk: 'R0' });
    expect(prList.classification).toMatchObject({ support: 'supported', interaction: 'web_native', sideEffect: 'read', resultKind: 'resource_list', hostSupport: 'unverified' });
    expect(prList.classification.flags.length).toBe(prList.inventory_flags.length);
    // 근거는 help 원문 인용이다 — 화면이 「왜」를 보여 줄 수 있어야 한다.
    expect(prList.classification.basis.evidence).toContain('List pull requests');
    expect(prList.definition?.id).toBe('pr.list');
    // 결과 계약·port·간선 (CR-089) — manifest의 정적 계약이며 실행 결과가 아니다.
    expect(prList.result_contract).toMatchObject({ kind: 'resource_list', composability: 'partially_bindable', resourceKind: 'pull_request' });
    expect(prList.graph?.outgoing.find((edge) => edge.to === 'pr.view')).toMatchObject({ fromPort: 'pull_requests', toPort: 'pull_request', verdict: 'conditional', execution: { executable: false } });
    expect(prList.graph?.executable_flows).toBe(0);
    const view = (await app.inject({ method: 'GET', url: `${GH_REGISTRY_PATH}/commands/pr.view`, headers })).json<DetailBody>();
    expect(view.graph?.incoming.map((edge) => edge.from)).toContain('pr.list');
    expect(view.graph?.incoming.every((edge) => edge.execution.executable === false)).toBe(true);
    expect(executionKeysIn(prList)).toEqual([]);
    expect(executionKeysIn(view)).toEqual([]);

    const token = (await app.inject({ method: 'GET', url: `${GH_REGISTRY_PATH}/commands/auth.token`, headers })).json<DetailBody>();
    expect(token).toMatchObject({ execution: 'policy_blocked', support: 'policy_blocked', definition: null });
    expect(token.classification.sensitivity).toBe('secret');
    expect(token.execution_reason).toContain('열지 않기로');
    expect(token.result_contract).toMatchObject({ composability: 'secret_non_bindable', outputPorts: [] });
    expect(token.graph).toMatchObject({ outgoing: [], incoming: [] });
    expect(executionKeysIn(token)).toEqual([]);

    // 별칭 전용 노드는 계약을 따로 갖지 않는다.
    const alias = (await app.inject({ method: 'GET', url: `${GH_REGISTRY_PATH}/commands/co`, headers })).json<DetailBody>();
    expect(alias).toMatchObject({ result_contract: null, graph: null });

    expect((await app.inject({ method: 'GET', url: `${GH_REGISTRY_PATH}/commands/zz.frobnicate`, headers })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: `${GH_REGISTRY_PATH}/commands/..%2Fetc`, headers })).statusCode).toBe(400);
  });
});

describe('실행 허용은 코드 표가 정한다', () => {
  it('manifest의 pr.merge를 allowed로 바꿔 적재해도 실행 준비는 GH_CAPABILITY_NOT_EXECUTABLE이다', async () => {
    const widened: GhCapabilityManifest = {
      ...manifest,
      commands: manifest.commands.map((command) => (command.id === 'pr.merge' ? { ...command, execution: 'allowed', executionReason: null } : command)),
    };
    const other = serverFor(widened);
    await other.ready();
    const response = await other.inject({
      method: 'POST',
      url: GH_EXECUTION_PREVIEW_PATH,
      headers: await login('u-dev', ['developer']),
      payload: { capability_id: 'pr.merge', context: { repository: 'acme/payments' }, flags: {}, output: { json_fields: [] } },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('GH_CAPABILITY_NOT_EXECUTABLE');
  });

  it('결과 계약·port가 있는 pr.view를 allowed로 바꿔 적재해도 실행 준비는 GH_CAPABILITY_NOT_EXECUTABLE이다 (CR-089)', async () => {
    const widened: GhCapabilityManifest = {
      ...manifest,
      commands: manifest.commands.map((command) => (command.id === 'pr.view' ? { ...command, execution: 'allowed', executionReason: null } : command)),
    };
    const other = serverFor(widened);
    await other.ready();
    const response = await other.inject({
      method: 'POST',
      url: GH_EXECUTION_PREVIEW_PATH,
      headers: await login('u-dev', ['developer']),
      payload: { capability_id: 'pr.view', context: { repository: 'acme/payments' }, flags: {}, output: { json_fields: ['number'] } },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('GH_CAPABILITY_NOT_EXECUTABLE');
  });

  it('API-GH-001의 command 목록에 분류 요약이 실리고, 실행 정의에는 결과 계약이 아니라 구현 adapter가 있다', async () => {
    const body = (await app.inject({ method: 'GET', url: GH_CAPABILITIES_PATH, headers: await login('u-dev', ['developer']) })).json<{ commands: Record<string, unknown>[]; capabilities: Record<string, unknown>[] }>();
    const merge = body.commands.find((command) => command['id'] === 'pr.merge');
    expect(merge).toMatchObject({ support: 'supported', execution: 'not_implemented', interaction: 'web_native', side_effect: 'destructive', host_support: 'unverified', composability: 'terminal_result' });
    const token = body.commands.find((command) => command['id'] === 'auth.token');
    expect(token).toMatchObject({ support: 'policy_blocked', execution: 'policy_blocked', side_effect: 'read', composability: 'secret_non_bindable' });
    expect(body.capabilities).toHaveLength(1);
    expect(body.capabilities[0]).toMatchObject({
      id: 'pr.list',
      result_adapter: { mode: 'json', adapter: 'native_json', schema: 'pr_list_v2', outputPort: 'pull_requests' },
      result_contract: { kind: 'resource_list', sensitivity: 'internal', composability: 'partially_bindable', bindable: true, resource_kind: 'pull_request' },
    });
    expect(body.capabilities[0]).not.toHaveProperty('result');
  });
});
