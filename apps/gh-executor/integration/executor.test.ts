/**
 * 실행기 — **실제 고정 gh 바이너리**가 **실제 HTTPS 목 GHE**에 붙는다 (WP-047 DoD, FR-GH-002·006·008·012).
 *
 * 여기서 증명하는 것:
 *   - 요청 수락(search-api의 같은 함수) → 큐 → 실행기 → 결과·이력이 끝까지 이어진다
 *   - gh가 실제로 GraphQL을 보냈고(목이 기록), 토큰은 헤더에만 있다 (FR-GH-008 AC-7)
 *   - 저장된 argv를 같은 빌더로 다시 만들어 대조한다 — 변조되면 실행하지 않는다 (AC-4·AC-8)
 *   - 취소·시간 상한·출력 상한이 실제 프로세스에서 성립한다 (FR-GH-006)
 *   - 연결 철회·만료·registry 불일치 뒤의 대기 실행은 시작되지 않는다 (FR-GH-008 예외 처리)
 *   - 실행이 끝나면 workspace와 토큰이 남지 않는다 (NFR-010)
 *   - 고아 회수와 잔여 큐 스윕 (JOB-GH-007)
 *
 * 바이너리는 `ensurePinnedGh`가 확보한다 — 없으면 **실패**이지 skip이 아니다.
 *
 * 검증: `pnpm test:integration gh-executor`
 */

import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { InMemoryEventBus } from '@prs/bus';
import { authRepo, ghExecutionRepo, ghIdentityRepo, repositoryRepo, withTransaction, type GhExecutionRow, type Pool } from '@prs/db';
import { GH_PINNED_VERSION, type GhCapabilityManifest } from '@prs/gh-cli';
import { loadManifest, parseVaultKey, sealSecret } from '@prs/gh-cli/node';
import { resolveExecutorConfig, type ExecutorConfig } from '../src/config.js';
import { createExecutorMetrics } from '../src/metrics.js';
import { runExecution, type RunnerDeps, type RunnerLogEntry } from '../src/runner.js';
import { startSweeper } from '../src/sweeper.js';
import { migratedPool } from '../../../packages/db/integration/helpers.js';
import { ensurePinnedGh } from '../../../packages/gh-cli/testing/pinned-gh.js';
import { startMockGhe, type MockGhe } from '../../../packages/gh-cli/testing/mock-ghe-tls.js';
import { resolveGhOpsConfig } from '../../search-api/src/gh/config.js';
import { requestExecution, type ExecutionDeps } from '../../search-api/src/gh/executions.js';

const ESC = '\x1b';
const VAULT_KEY = 'cd'.repeat(32);
const TOKEN = 'ghu_mockUserToken0000000000000001';
const REPO_ID = 4021;

let pool: Pool;
let mock: MockGhe;
let binary: string;
let manifest: GhCapabilityManifest;
let workspaceRoot: string;
let bus: InMemoryEventBus;
let logs: RunnerLogEntry[] = [];

function executorDeps(overrides: Partial<Record<string, string>> = {}, extra: Partial<RunnerDeps> = {}): RunnerDeps {
  const config: ExecutorConfig = resolveExecutorConfig({
    GH_OPERATIONS_ENABLED: 'true',
    GHE_BASE_URL: mock.baseUrl,
    GH_IDENTITY_VAULT_KEY: VAULT_KEY,
    GH_EXECUTOR_BIN: binary,
    GH_EXECUTOR_WORKSPACE_ROOT: workspaceRoot,
    GH_EXECUTOR_CA_FILE: mock.caFile,
    GH_EXECUTOR_HEARTBEAT_MS: '500',
    GH_EXECUTOR_ORPHAN_AFTER_MS: '5000',
    GH_EXECUTOR_QUEUED_STALE_MS: '1000',
    ...overrides,
  });
  return {
    pool,
    config,
    manifest,
    vaultKey: parseVaultKey(VAULT_KEY),
    metrics: createExecutorMetrics(),
    log: (entry) => logs.push(entry),
    ...extra,
  };
}

function apiDeps(target: MockGhe = mock): ExecutionDeps {
  const config = resolveGhOpsConfig({
    GH_OPERATIONS_ENABLED: 'true',
    GHE_BASE_URL: target.baseUrl,
    GHE_API_URL: target.apiUrl,
    GHE_OPS_CLIENT_ID: 'ops',
    GHE_OPS_CLIENT_SECRET: 'secret',
    GHE_OPS_REDIRECT_URI: 'http://web.test/gh/identity/callback',
    GH_IDENTITY_VAULT_KEY: VAULT_KEY,
  });
  return {
    pool,
    bus,
    config,
    manifest,
    identity: { pool, redis: { get: async () => null, set: async () => 'OK', del: async () => 0 }, config, vaultKey: parseVaultKey(VAULT_KEY), http: async () => ({ status: 500, body: null }) },
    scopes: { resolveCached: async () => ({ repositoryIds: [REPO_ID], orgIds: [], teamIds: [], visibilities: [], refreshedAt: Date.now(), version: 1 }) },
  };
}

const PRINCIPAL = { userId: 'u-alice', login: 'alice', roles: ['developer'] };

async function connectAlice(options: { expiresInMs?: number | null; host?: string } = {}): Promise<void> {
  const vaultKey = parseVaultKey(VAULT_KEY);
  await withTransaction(pool, (client) =>
    ghIdentityRepo.connectIdentity(client, {
      userId: 'u-alice',
      githubLogin: 'alice',
      githubUserId: 1,
      host: options.host ?? mock.host,
      scopes: [],
      expiresAt: options.expiresInMs === undefined ? null : options.expiresInMs === null ? null : new Date(Date.now() + options.expiresInMs),
      refreshExpiresAt: null,
      keyId: vaultKey.keyId,
      accessSealed: sealSecret(vaultKey, TOKEN, 'u-alice'),
      refreshSealed: null,
    }),
  );
}

async function enqueue(flags: Record<string, string | number> = { '--state': 'open', '--limit': 5 }, key = `key-${String(Date.now())}-${String(Math.random()).slice(2, 8)}`): Promise<GhExecutionRow> {
  return requestExecution(apiDeps(), PRINCIPAL, { capability_id: 'pr.list', context: { repository: 'acme/payments' }, flags, output: { json_fields: ['number', 'title', 'state', 'author', 'headRefName'] } }, key, '00000000-0000-4000-8000-00000000abcd');
}

beforeAll(async () => {
  pool = await migratedPool();
  binary = await ensurePinnedGh();
  manifest = loadManifest(GH_PINNED_VERSION);
  workspaceRoot = mkdtempSync(join(tmpdir(), 'prs-gh-ws-'));
  bus = new InMemoryEventBus();
  mock = await startMockGhe({
    expectedToken: TOKEN,
    pullRequests: [
      { number: 12, title: `Fix ${ESC}[31mred${ESC}[0m race ${ESC}]8;;https://evil${ESC}\\link${ESC}]8;;${ESC}\\ <script>x</script>`, author: 'alice', headRefName: 'fix/race' },
      // 토큰 모양을 제목에 심는다 — 발췌와 결과 행이 argv와 같은 편집을 지나는지 본다 (심층 방어).
      { number: 11, title: 'Add thing ghu_leakedTokenLooksLikeThis00', author: 'bob', headRefName: 'feat/thing', isDraft: true },
      { number: 9, title: 'Closed one', state: 'CLOSED' },
    ],
  });
}, 180_000);

afterAll(async () => {
  await pool.query('TRUNCATE gh_execution, gh_execution_idempotency, gh_identity_secret, github_identity_connection, app_user, repository RESTART IDENTITY CASCADE');
  await mock.close();
  await bus.close();
  rmSync(workspaceRoot, { recursive: true, force: true });
  await pool.end();
});

beforeEach(async () => {
  logs = [];
  mock.requests.length = 0;
  await pool.query('TRUNCATE gh_execution, gh_execution_idempotency, gh_identity_secret, github_identity_connection, app_user, repository RESTART IDENTITY CASCADE');
  await authRepo.upsertUserOnLogin(pool, { user_id: 'u-alice', login: 'alice' });
  await repositoryRepo.upsertRepository(pool, { repository_id: REPO_ID, owner: 'acme', name: 'payments', org_id: 1, visibility: 'internal', sequence_branches: ['main'] });
});

describe('사용자 흐름 끝까지 (FR-GH-002 AC-1·AC-4·AC-10, FR-GH-008 AC-7)', () => {
  it('요청 → 실행 → 결과: 실제 gh가 목 GHE에 GraphQL을 보내고 typed 결과가 남는다', async () => {
    await connectAlice();
    const row = await enqueue();
    expect(row.state).toBe('queued');

    const outcome = await runExecution(executorDeps(), row.execution_id);
    expect(outcome, JSON.stringify(logs)).toBe('succeeded');

    const done = await ghExecutionRepo.findById(pool, row.execution_id);
    expect(done?.state).toBe('succeeded');
    expect(done?.exit_code).toBe(0);
    expect(done?.executor_id).toContain(':');
    expect(done?.started_at).not.toBeNull();
    expect(done?.finished_at).not.toBeNull();

    // 저장된 argv는 golden이다 — 미리보기와 실행이 같은 빌더에서 나왔다.
    expect(done?.redacted_argv).toEqual(['pr', 'list', '--repo', `${mock.host}/acme/payments`, '--state', 'open', '--limit', '5', '--json', 'number,title,state,author,headRefName']);

    // gh가 실제로 보낸 것: GraphQL 하나, 토큰은 헤더에만.
    const graphql = mock.graphqlRequests();
    expect(graphql).toHaveLength(1);
    expect(graphql[0]?.headers['authorization']).toBe(`token ${TOKEN}`);
    expect(graphql[0]?.headers['user-agent']).toBe(`GitHub CLI ${GH_PINNED_VERSION}`);
    const variables = (JSON.parse(graphql[0]?.rawBody ?? '{}') as { variables: Record<string, unknown> }).variables;
    expect(variables).toMatchObject({ owner: 'acme', repo: 'payments', limit: 5, state: ['OPEN'] });
    expect(graphql[0]?.path).not.toContain(TOKEN);

    // typed 결과: 허용 필드만, 무해화된 값.
    const result = done?.result as { schema: string; rows: { number: number; title: string; author: string | null; headRefName: string | null }[]; row_count: number; possibly_more: boolean };
    expect(result.schema).toBe('pr_list_v1');
    expect(result.row_count).toBe(2);
    expect(result.rows.map((r) => r.number)).toEqual([12, 11]);
    /*
     * **gh 2.97.0은 `--json` 출력의 C0 제어 문자를 caret 표기(`^[`)로 바꿔 낸다** (실측 — 목이
     * GraphQL 응답에 `\u001b`로 보낸 ESC가 stdout에는 두 글자 `^[`로 나온다). 그래서 원시 ESC는
     * gh를 지나 우리 경계에 닿지 않고, 하이퍼링크(OSC 8)도 성립하지 않는다. 우리 경계
     * (`sanitizeText`)는 그 뒤의 방어선이며 인쇄 가능한 텍스트는 건드리지 않는다 — 단위 시험이
     * 실제 ESC로 그 경계를 따로 건다. 정확한 표기는 고정 버전의 동작이므로 그대로 적는다.
     */
    expect(result.rows[0]?.title).not.toContain(ESC);
    expect(result.rows[0]?.title).toBe('Fix ^[[31mred^[[0m race ^[]8;;https://evil^[\\link^[]8;;^[\\ <script>x</script>');
    expect(result.rows[0]?.author).toBe('alice');
    // GitHub 필드에 심은 토큰 모양은 결과 행에도 발췌에도 남지 않는다.
    expect(result.rows[1]?.title).toBe('Add thing <redacted>');
    expect(done?.stdout_excerpt).not.toContain('ghu_leaked');
    expect(result.possibly_more).toBe(false);
    expect(done?.stdout_excerpt).not.toContain(ESC);
    expect(done?.output_hash).toMatch(/^[0-9a-f]{64}$/);

    // 이력 어디에도 토큰이 없고, workspace가 남지 않았다 (NFR-010).
    expect(JSON.stringify(done)).not.toContain(TOKEN);
    expect(JSON.stringify(logs)).not.toContain(TOKEN);
    expect(readdirSync(workspaceRoot)).toEqual([]);
  }, 60_000);

  it('상태 필터가 실제 질의 변수로 간다 — closed는 gh가 CLOSED+MERGED로 편다 (실측)', async () => {
    await connectAlice();
    const row = await enqueue({ '--state': 'closed', '--limit': 10 });
    expect(await runExecution(executorDeps(), row.execution_id)).toBe('succeeded');
    const variables = (JSON.parse(mock.graphqlRequests()[0]?.rawBody ?? '{}') as { variables: Record<string, unknown> }).variables;
    // gh 2.97.0은 `--state closed`를 GraphQL `states: [CLOSED, MERGED]`로 보낸다 — 공식 help는 이것을 적지 않는다.
    expect(variables['state']).toEqual(['CLOSED', 'MERGED']);
    const result = (await ghExecutionRepo.findById(pool, row.execution_id))?.result as { rows: { number: number }[] };
    expect(result.rows.map((r) => r.number)).toEqual([9]);
  }, 60_000);

  it('잘못된 토큰이면 gh가 실패하고 stderr 발췌에 토큰이 없다', async () => {
    const vaultKey = parseVaultKey(VAULT_KEY);
    await withTransaction(pool, (client) =>
      ghIdentityRepo.connectIdentity(client, {
        userId: 'u-alice', githubLogin: 'alice', githubUserId: 1, host: mock.host, scopes: [], expiresAt: null, refreshExpiresAt: null,
        keyId: vaultKey.keyId, accessSealed: sealSecret(vaultKey, 'ghu_wrongToken000000000000000000', 'u-alice'), refreshSealed: null,
      }),
    );
    const row = await enqueue();
    expect(await runExecution(executorDeps(), row.execution_id)).toBe('failed');
    const done = await ghExecutionRepo.findById(pool, row.execution_id);
    expect(done?.exit_code).not.toBe(0);
    expect(done?.error).toMatch(/^gh_/);
    expect(done?.stderr_excerpt ?? '').not.toContain('ghu_wrong');
    expect(JSON.stringify(done)).not.toContain('ghu_wrong');
  }, 60_000);
});

describe('큐에서 꺼낼 때의 재검증 (FR-GH-008 예외 처리, FR-GH-011 AC-3)', () => {
  it('철회된 연결·만료된 토큰·registry 불일치·변조된 argv는 실행되지 않는다', async () => {
    await connectAlice();
    const revokedRow = await enqueue();
    await withTransaction(pool, (client) => ghIdentityRepo.revokeConnection(client, 'u-alice', 'user_disconnect'));
    expect(await runExecution(executorDeps(), revokedRow.execution_id)).toBe('rejected');
    expect((await ghExecutionRepo.findById(pool, revokedRow.execution_id))?.error).toBe('identity_required');

    // search-api는 만료가 가까운 연결의 요청 자체를 거절한다(갱신 토큰이 없으면 401). 실행기의 판정을
    // 보려면 요청 뒤에 만료를 앞당긴다 — 큐에서 기다리는 사이 만료된 상황이다.
    await connectAlice({ expiresInMs: 3_600_000 });
    const expiredRow = await enqueue();
    await pool.query(`UPDATE github_identity_connection SET expires_at = now() + interval '1 second'`);
    expect(await runExecution(executorDeps(), expiredRow.execution_id)).toBe('rejected');
    expect((await ghExecutionRepo.findById(pool, expiredRow.execution_id))?.error).toBe('identity_expired');

    await connectAlice();
    const staleRow = await enqueue();
    expect(await runExecution(executorDeps({}, { manifest: { ...manifest, hash: 'different' } }), staleRow.execution_id)).toBe('rejected');
    expect((await ghExecutionRepo.findById(pool, staleRow.execution_id))?.error).toBe('registry_stale');

    const tamperedRow = await enqueue();
    await pool.query(`UPDATE gh_execution SET redacted_argv = ARRAY['pr','list','--repo',$2,'--state','all','--limit','100','--json','number'] WHERE execution_id = $1`, [tamperedRow.execution_id, `${mock.host}/acme/payments`]);
    expect(await runExecution(executorDeps(), tamperedRow.execution_id)).toBe('rejected');
    expect((await ghExecutionRepo.findById(pool, tamperedRow.execution_id))?.error).toBe('argv_mismatch');

    const otherHostRow = await enqueue();
    await pool.query(`UPDATE github_identity_connection SET host = 'other.example.com'`);
    expect(await runExecution(executorDeps(), otherHostRow.execution_id)).toBe('rejected');

    expect(mock.graphqlRequests()).toHaveLength(0);
  }, 60_000);

  it('해제된 저장소의 실행은 시작되지 않는다', async () => {
    await connectAlice();
    const row = await enqueue();
    await repositoryRepo.setRepositoryStatus(pool, REPO_ID, 'archived');
    expect(await runExecution(executorDeps(), row.execution_id)).toBe('rejected');
    expect((await ghExecutionRepo.findById(pool, row.execution_id))?.error).toBe('repository_unavailable');
  }, 60_000);
});

describe('수명주기 (FR-GH-006 AC-3·AC-4·AC-5, NFR-011)', () => {
  it('시작 전 취소는 cancelled_before_start, 실행 중 취소는 프로세스를 3초 안에 끝낸다', async () => {
    await connectAlice();
    const early = await enqueue();
    await ghExecutionRepo.requestCancel(pool, early.execution_id, 'u-alice');
    expect(await runExecution(executorDeps(), early.execution_id)).toBe('cancelled_before_start');
    expect((await ghExecutionRepo.findById(pool, early.execution_id))?.state).toBe('cancelled');

    const slow = await startMockGhe({ expectedToken: TOKEN, graphqlDelayMs: 8_000 });
    try {
      await connectAlice({ host: slow.host });
      const deps = executorDeps({ GHE_BASE_URL: slow.baseUrl, GH_EXECUTOR_CA_FILE: slow.caFile });
      const row = await requestExecution(apiDeps(slow), PRINCIPAL, { capability_id: 'pr.list', context: { repository: 'acme/payments' }, flags: {}, output: { json_fields: [] } }, 'key-cancel-000001', '00000000-0000-4000-8000-00000000abce');
      const started = Date.now();
      const running = runExecution(deps, row.execution_id);
      await new Promise((resolve) => setTimeout(resolve, 700));
      await ghExecutionRepo.requestCancel(pool, row.execution_id, 'u-alice');
      expect(await running).toBe('cancelled');
      expect(Date.now() - started).toBeLessThan(5_000);
      expect((await ghExecutionRepo.findById(pool, row.execution_id))?.state).toBe('cancelled');
      expect(readdirSync(workspaceRoot)).toEqual([]);
    } finally {
      await slow.close();
    }
  }, 60_000);

  it('시간 상한을 넘기면 timed_out이다', async () => {
    const slow = await startMockGhe({ expectedToken: TOKEN, graphqlDelayMs: 6_000 });
    try {
      await connectAlice({ host: slow.host });
      const row = await requestExecution(apiDeps(slow), PRINCIPAL, { capability_id: 'pr.list', context: { repository: 'acme/payments' }, flags: {}, output: { json_fields: [] } }, 'key-timeout-00001', '00000000-0000-4000-8000-00000000abcf');
      const deps = executorDeps({ GHE_BASE_URL: slow.baseUrl, GH_EXECUTOR_CA_FILE: slow.caFile }, { timeoutMsOverride: 800 });
      const started = Date.now();
      expect(await runExecution(deps, row.execution_id)).toBe('timed_out');
      expect(Date.now() - started).toBeLessThan(5_000);
      const done = await ghExecutionRepo.findById(pool, row.execution_id);
      expect(done?.state).toBe('timed_out');
      expect(done?.error).toMatch(/timed_out_after_800ms/);
    } finally {
      await slow.close();
    }
  }, 60_000);

  it('stdout 상한을 넘기면 절단을 남기고 잘린 목록을 정상으로 꾸미지 않는다 (QA-GH-11)', async () => {
    await connectAlice();
    const row = await enqueue({ '--state': 'open', '--limit': 5 });
    expect(await runExecution(executorDeps({ GH_EXECUTOR_STDOUT_LIMIT_BYTES: '4096' }, { stdoutLimitOverride: 64 }), row.execution_id)).toBe('failed');
    const done = await ghExecutionRepo.findById(pool, row.execution_id);
    expect(done?.stdout_truncated).toBe(true);
    expect(done?.error).toMatch(/result_parse_failed/);
    expect(done?.error).toMatch(/truncated/);
    expect(done?.result).toBeNull();
  }, 60_000);
});

describe('JOB-GH-007 고아 회수와 잔여 큐 스윕', () => {
  it('하트비트가 끊긴 running은 failed로, 오래된 queued는 실행된다', async () => {
    await connectAlice();
    const orphan = await enqueue();
    await ghExecutionRepo.claimExecution(pool, orphan.execution_id, 'dead-executor');
    await pool.query(`UPDATE gh_execution SET heartbeat_at = now() - interval '1 hour' WHERE execution_id = $1`, [orphan.execution_id]);
    const stale = await enqueue({ '--state': 'open', '--limit': 2 });
    await pool.query(`UPDATE gh_execution SET requested_at = requested_at - interval '10 minutes' WHERE execution_id = $1`, [stale.execution_id]);

    const sweeper = startSweeper(executorDeps(), 60_000);
    try {
      const { reclaimed, resumed } = await sweeper.runOnce();
      expect(reclaimed).toEqual([orphan.execution_id]);
      expect(resumed).toEqual([stale.execution_id]);
    } finally {
      await sweeper.stop();
    }
    expect((await ghExecutionRepo.findById(pool, orphan.execution_id))).toMatchObject({ state: 'failed', error: 'executor_lost' });
    expect((await ghExecutionRepo.findById(pool, stale.execution_id))?.state).toBe('succeeded');
  }, 60_000);
});

describe('격리 (NFR-010)', () => {
  it('workspace 부모는 실행 중에만 채워지고 끝나면 비며, 존재하지 않는 바이너리는 spawn 실패로 기록된다', async () => {
    await connectAlice();
    const row = await enqueue();
    const deps = executorDeps({ GH_EXECUTOR_BIN: join(workspaceRoot, '..', 'no-such-gh') });
    expect(await runExecution(deps, row.execution_id)).toBe('failed');
    const done = await ghExecutionRepo.findById(pool, row.execution_id);
    expect(done?.error).toMatch(/^spawn_failed/);
    expect(existsSync(workspaceRoot)).toBe(true);
    expect(readdirSync(workspaceRoot)).toEqual([]);
  }, 60_000);
});
