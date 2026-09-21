/**
 * PIPE 연동 통합 시험 하네스 (CR-112).
 *
 * ## 운영과 같은 길을 탄다
 *
 * - 신뢰 재료는 **파일로 쓰고** `resolvePipeIntegrationConfig`로 읽는다 (정책 파일·공개키·CA).
 * - 공개 서버는 `buildServer`, 연동 서버는 `buildPipeIntegrationDeps` → `buildIntegrationServer`로 세운다 —
 *   `index.ts`와 같은 조립이다.
 * - 연동 서버는 **127.0.0.1의 실제 TLS 포트**에서 듣고, 요청은 `node:https`가 client 인증서를 실어 보낸다.
 *   헤더로 TLS를 흉내 내지 않는다. 인증서는 `openssl`로 실행마다 새로 만든다 (시험 전용, 2일 유효).
 * - 복제본마다 **자기 PostgreSQL Pool·Redis 연결·접근 범위 해석기**를 갖는다 — 재생 방지·회수 경합이
 *   프로세스 하나의 메모리가 아니라 공유 저장소에서 성립하는지를 본다.
 *
 * 여기서 쓰는 키·인증서는 시험 전용이며 운영 자격이 아니다.
 */

import { execFileSync } from 'node:child_process';
import { X509Certificate, createHash, generateKeyPairSync, randomBytes, type KeyObject } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import type { IncomingHttpHeaders } from 'node:http';
import { request as httpsRequest } from 'node:https';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { CompactSign } from 'jose';
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
import { authRepo, pipeIntegrationRepo, repositoryRepo, sequenceSpaceRepo, type Pool } from '@prs/db';
import type { Redis } from '@prs/bus';
import type { GitHubSourceReader } from '@prs/github';
import { buildServer, type ServerDeps } from '../../../src/server.js';
import type { AuthContext, AuthRedis } from '../../../src/auth/context.js';
import type { SearchApiConfig } from '../../../src/config.js';
import { resolvePipeIntegrationConfig, type PipeIntegrationEnabled } from '../../../src/integrations/pipe/config.js';
import { ASSERTION_TYP } from '../../../src/integrations/pipe/assertion.js';
import { INTEGRATION_PREFIX } from '../../../src/integrations/pipe/operations.js';
import { buildPipeIntegrationDeps, redisReplayStore } from '../../../src/integrations/pipe/runtime.js';
import { buildIntegrationServer } from '../../../src/integrations/pipe/server.js';
import type { GheUserDirectory } from '../../../src/integrations/pipe/identity-binding.js';
import { createTestRedis, migratedPool } from '../../helpers.js';
import { TEST_CURSOR_KEY, TEST_CURSOR_SIGNER } from '../../_cursor-fixture.js';

// ---------------------------------------------------------------- 고정 값

export const GHE_HOST = 'ghe.test';
export const ISSUER = 'urn:test:pipe:dev';
export const AUDIENCE = 'urn:test:pr-search:pipe-integration:dev';
export const OTHER_ISSUER = 'urn:test:pipe:other';
export const OTHER_AUDIENCE = 'urn:test:pr-search:pipe-integration:other';
export const CLIENT_DEV = 'pipe-dev';
export const CLIENT_OTHER = 'pipe-other';
export const ORG = 1;
export const PAYMENTS = 101;
export const BILLING = 102;
export const HIDDEN = 900;

export interface UserFixture {
  readonly userId: string;
  readonly login: string;
  readonly gheId: number;
  readonly subject: string;
}

export const USER_A: UserFixture = { userId: 'github:5001', login: 'alice-psi', gheId: 5001, subject: 'pipe-user-a' };
export const USER_B: UserFixture = { userId: 'github:5002', login: 'bob-psi', gheId: 5002, subject: 'pipe-user-b' };
export const OPERATOR: UserFixture = { userId: 'github:5003', login: 'olivia-psi', gheId: 5003, subject: 'pipe-user-op' };
/** pr-search에 행이 없는 사용자 — binding을 만들 수 없다. */
export const STRANGER: UserFixture = { userId: 'github:5009', login: 'stranger-psi', gheId: 5009, subject: 'pipe-user-x' };

export const SHA = 'a'.repeat(40);

// ---------------------------------------------------------------- TLS

export interface TlsIdentity {
  readonly cert: Buffer;
  readonly key: Buffer;
  readonly sha256: string;
}

export interface TlsFixture {
  readonly dir: string;
  readonly serverCa: Buffer;
  readonly server: TlsIdentity;
  readonly clientCa: Buffer;
  /** 등록된 client `pipe-dev`. */
  readonly pipeDev: TlsIdentity;
  /** 같은 client의 교체 인증서 — SAN이 같고 키·지문이 다르다. */
  readonly pipeDevRotated: TlsIdentity;
  /** 등록된 두 번째 client `pipe-other`. */
  readonly pipeOther: TlsIdentity;
  /** 신뢰 CA가 발급했지만 어떤 client에도 등록되지 않은 인증서. */
  readonly unregistered: TlsIdentity;
  /** 신뢰하지 않는 CA가 발급한, `pipe-dev`와 같은 SAN의 인증서. */
  readonly rogue: TlsIdentity;
}

function openssl(args: readonly string[], cwd: string): void {
  try {
    execFileSync('openssl', args, { cwd, stdio: 'pipe' });
  } catch (error) {
    throw new Error(`openssl이 필요하다 (시험 인증서 생성): ${error instanceof Error ? error.message : String(error)}`);
  }
}

function read(dir: string, name: string): Buffer {
  return readFileSync(join(dir, name));
}

export function generateTls(): TlsFixture {
  const dir = mkdtempSync(join(tmpdir(), 'psi-tls-'));
  const ca = (name: string): void =>
    openssl(
      ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256', '-nodes', '-keyout', `${name}.key`, '-out', `${name}.crt`, '-subj', `/CN=${name}`, '-days', '2'],
      dir,
    );
  const leaf = (name: string, caName: string, extensions: string): TlsIdentity => {
    writeFileSync(join(dir, `${name}.ext`), extensions);
    openssl(
      ['req', '-new', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256', '-nodes', '-keyout', `${name}.key`, '-out', `${name}.csr`, '-subj', `/CN=${name}`],
      dir,
    );
    openssl(
      ['x509', '-req', '-in', `${name}.csr`, '-CA', `${caName}.crt`, '-CAkey', `${caName}.key`, '-CAcreateserial', '-out', `${name}.crt`, '-days', '2', '-extfile', `${name}.ext`],
      dir,
    );
    const cert = read(dir, `${name}.crt`);
    return { cert, key: read(dir, `${name}.key`), sha256: createHash('sha256').update(new X509Certificate(cert).raw).digest('hex') };
  };
  const client = (san: string): string =>
    `subjectAltName=${san}\nextendedKeyUsage=clientAuth\nbasicConstraints=CA:FALSE\n`;

  ca('server-ca');
  ca('client-ca');
  ca('rogue-ca');
  const server = leaf('server', 'server-ca', 'subjectAltName=DNS:localhost,IP:127.0.0.1\nextendedKeyUsage=serverAuth\nbasicConstraints=CA:FALSE\n');
  return {
    dir,
    serverCa: read(dir, 'server-ca.crt'),
    server,
    clientCa: read(dir, 'client-ca.crt'),
    pipeDev: leaf('pipe-dev', 'client-ca', client('URI:spiffe://test/pipe-dev')),
    pipeDevRotated: leaf('pipe-dev-rotated', 'client-ca', client('URI:spiffe://test/pipe-dev')),
    pipeOther: leaf('pipe-other', 'client-ca', client('URI:spiffe://test/pipe-other')),
    unregistered: leaf('unregistered', 'client-ca', client('URI:spiffe://test/somebody-else')),
    rogue: leaf('rogue', 'rogue-ca', client('URI:spiffe://test/pipe-dev')),
  };
}

export interface TlsResponse {
  readonly status: number;
  readonly headers: IncomingHttpHeaders;
  readonly body: string;
  json<T = Record<string, unknown>>(): T;
}

export interface TlsRequest {
  readonly method?: string;
  readonly path: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
  /** `null`이면 client 인증서 없이 연결한다. */
  readonly identity: TlsIdentity | null;
}

/** 실제 TLS 연결 하나로 요청 하나를 보낸다 (연결을 재사용하지 않는다). */
export function tlsRequest(port: number, serverCa: Buffer, input: TlsRequest): Promise<TlsResponse> {
  return new Promise((resolve, reject) => {
    const request = httpsRequest(
      {
        host: '127.0.0.1',
        port,
        method: input.method ?? 'GET',
        path: input.path,
        headers: input.headers ?? {},
        ca: serverCa,
        servername: 'localhost',
        agent: false,
        ...(input.identity === null ? {} : { cert: input.identity.cert, key: input.identity.key }),
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            body,
            json: <T>() => JSON.parse(body) as T,
          });
        });
        response.on('error', reject);
      },
    );
    request.on('error', reject);
    if (input.body !== undefined) request.write(input.body);
    request.end();
  });
}

// ---------------------------------------------------------------- 검색 문서

const PULL_REQUESTS = [
  {
    _id: 'psi-pr-1', repository_id: PAYMENTS, repository: 'acme/payments', org_id: ORG, visibility: 'internal',
    allowed_team_ids: [], pr_number: 1, title: '결제 재시도', state: 'merged', author: 'alice-psi', labels: ['backend'],
    base_branch: 'main', head_branch: 'feature/retry', merge_seq: 1, seq_epoch: 3, sequence_space: 'acme/payments@main',
    merged_at: '2026-08-19T05:02:11Z', created_at: '2026-08-15T00:00:00Z', updated_at: '2026-08-19T05:02:11Z',
    changed_files_count: 2, additions: 120, deletions: 15, changed_paths: ['src/pay/retry.ts'],
    merge_commit_sha: SHA, source_commit_shas: [SHA], document_version: 1,
  },
  {
    _id: 'psi-pr-2', repository_id: PAYMENTS, repository: 'acme/payments', org_id: ORG, visibility: 'internal',
    allowed_team_ids: [], pr_number: 2, title: '세션 만료', state: 'open', author: 'bob-psi', labels: ['frontend'],
    base_branch: 'main', created_at: '2026-08-16T00:00:00Z', updated_at: '2026-08-16T00:00:00Z',
    changed_files_count: 1, additions: 8, deletions: 2, document_version: 1,
  },
  {
    _id: 'psi-pr-3', repository_id: BILLING, repository: 'acme/billing', org_id: ORG, visibility: 'internal',
    allowed_team_ids: [], pr_number: 3, title: '청구서 양식', state: 'open', author: 'alice-psi', labels: ['billing'],
    base_branch: 'develop', created_at: '2026-08-20T00:00:00Z', updated_at: '2026-08-20T00:00:00Z',
    changed_files_count: 1, additions: 40, deletions: 0, document_version: 1,
  },
  {
    _id: 'psi-pr-hidden', repository_id: HIDDEN, repository: 'other/secret', org_id: 2, visibility: 'private',
    allowed_team_ids: [], pr_number: 9, title: '비밀 결제', state: 'merged', author: 'alice-psi', labels: ['secret'],
    base_branch: 'main', merged_at: '2026-08-19T00:00:00Z', created_at: '2026-08-01T00:00:00Z', document_version: 1,
  },
];

const COMMITS = [
  {
    _id: 'psi-commit-1', repository_id: PAYMENTS, repository: 'acme/payments', org_id: ORG, visibility: 'internal',
    allowed_team_ids: [], commit_sha: SHA, message: '결제 재시도 구현\n\n본문', author: 'alice-psi',
    committed_at: '2026-08-19T04:00:00Z', base_branch: 'main', merge_seq: 1, seq_epoch: 3,
    sequence_space: 'acme/payments@main', role: 'merge_commit', pull_request_numbers: [1], document_version: 1,
  },
];

// ---------------------------------------------------------------- 하네스

export interface Faults {
  replayDown: boolean;
  directoryDown: boolean;
  scopeDown: boolean;
}

export interface Replica {
  readonly app: FastifyInstance;
  readonly port: number;
  readonly pool: Pool;
  readonly redis: Redis;
}

export interface Harness {
  readonly pool: Pool;
  readonly redis: Redis;
  readonly es: Client;
  readonly tls: TlsFixture;
  readonly setting: PipeIntegrationEnabled;
  readonly publicApp: FastifyInstance;
  readonly replicas: readonly Replica[];
  /** 사용자 → 볼 수 있는 저장소 (가짜 GHE 권한). */
  readonly scopes: Map<string, number[]>;
  /** GHE login → 숫자 ID (가짜 GHE 사용자 조회). */
  readonly gheUsers: Map<string, number>;
  readonly faults: Faults;
  /** 연동 서버 시계 오프셋 (ms). assertion 서명도 같은 시계를 쓴다. */
  clockOffsetMs: number;
  readonly sourceCalls: string[];
  /** 가짜 GHE 권한 조회가 불린 사용자 순서 (캐시 적중이면 늘지 않는다). */
  readonly scopeFetches: string[];
  /** 사용자 → 조직·팀 표현 재료. 500개를 넘는 범위를 흉내 낼 때 쓴다. */
  readonly orgScopes: Map<string, { orgIds: number[]; visibilities: string[] }>;
  readonly logs: Record<string, unknown>[];
  now(): number;
  signAssertion(input: SignInput): Promise<string>;
  exchange(assertion: string, options?: CallOptions): Promise<TlsResponse>;
  get(path: string, grant: string | null, options?: CallOptions): Promise<TlsResponse>;
  post(path: string, body: string | undefined, options?: CallOptions): Promise<TlsResponse>;
  grantFor(user: UserFixture, options?: SignInput & CallOptions): Promise<string>;
  publicGet(url: string, user: UserFixture | null, headers?: Record<string, string>): Promise<{ status: number; body: string; json<T = Record<string, unknown>>(): T }>;
  resetScopeCache(): Promise<void>;
  close(): Promise<void>;
}

export interface CallOptions {
  readonly identity?: TlsIdentity | null;
  readonly replica?: number;
  readonly headers?: Record<string, string>;
  readonly method?: string;
}

export interface SignInput {
  readonly user?: UserFixture;
  readonly purpose?: 'grant' | 'revoke_context';
  readonly contextId?: string;
  readonly client?: 'dev' | 'other';
  readonly kid?: string;
  readonly overrides?: Record<string, unknown>;
  readonly jti?: string;
}

export interface HarnessOptions {
  readonly replicas?: number;
  readonly devAllowlist?: readonly number[];
  readonly otherAllowlist?: readonly number[];
  readonly mergeNumberEnabled?: boolean;
}

const AUTH_CONFIG = { enabled: true, cookieSecure: true, loginPath: '/auth/login', groupRoleMap: new Map<string, never>() } as const;

function authRedis(client: Redis): AuthRedis {
  return {
    get: (key) => client.get(key),
    set: (key, value, mode, seconds) => client.set(key, value, mode, seconds),
    del: (...keys) => client.del(...keys),
    scan: (cursor, m, pattern, c, n) => client.scan(cursor, m, pattern, c, n),
  };
}

/** 연동 표를 비운다 — **외래 키 순서대로**. 다른 시험 파일의 `DELETE FROM app_user`가 막히지 않게 한다. */
export async function clearIntegrationTables(pool: Pool): Promise<void> {
  await pool.query('DELETE FROM pipe_integration_event');
  await pool.query('DELETE FROM pipe_integration_grant');
  await pool.query('DELETE FROM pipe_integration_auth_context');
  await pool.query('DELETE FROM pipe_integration_credential_revocation');
  await pool.query('DELETE FROM pipe_integration_identity_binding');
}

export async function bind(pool: Pool, user: UserFixture, issuer = ISSUER): Promise<void> {
  await pipeIntegrationRepo.insertBinding(pool, {
    issuer,
    subject: user.subject,
    prsUserId: user.userId,
    gheHost: GHE_HOST,
    gheUserId: user.gheId,
    verifiedBy: 'prsctl:tester',
    verifiedAt: new Date(),
    verificationReference: 'TEST-FIXTURE',
  });
}

export async function startHarness(options: HarnessOptions = {}): Promise<Harness> {
  const tls = generateTls();
  const devKeys = { 'k-dev-1': generateKeyPairSync('rsa', { modulusLength: 2048 }), 'k-dev-2': generateKeyPairSync('rsa', { modulusLength: 2048 }) };
  const otherKey = generateKeyPairSync('rsa', { modulusLength: 2048 });
  for (const [kid, pair] of Object.entries(devKeys)) {
    writeFileSync(join(tls.dir, `${kid}.pub.pem`), pair.publicKey.export({ type: 'spki', format: 'pem' }));
  }
  writeFileSync(join(tls.dir, 'k-other-1.pub.pem'), otherKey.publicKey.export({ type: 'spki', format: 'pem' }));
  writeFileSync(join(tls.dir, 'server.key.pem'), tls.server.key);
  writeFileSync(join(tls.dir, 'server.crt.pem'), tls.server.cert);
  writeFileSync(join(tls.dir, 'client-ca.pem'), tls.clientCa);
  writeFileSync(
    join(tls.dir, 'policy.json'),
    JSON.stringify({
      schema: 'pipe-search-integration-policy/v1',
      clients: [
        {
          client_id: CLIENT_DEV, status: 'active', policy_version: 1, issuer: ISSUER, audience: AUDIENCE, profile: 'search-read-v1',
          signing_keys: Object.keys(devKeys).map((kid) => ({ kid, public_key_file: join(tls.dir, `${kid}.pub.pem`) })),
          tls_client: { subject_alt_names: ['URI:spiffe://test/pipe-dev'] },
          repository_ids: options.devAllowlist ?? [PAYMENTS, BILLING, HIDDEN],
        },
        {
          client_id: CLIENT_OTHER, status: 'active', policy_version: 1, issuer: OTHER_ISSUER, audience: OTHER_AUDIENCE, profile: 'search-read-v1',
          signing_keys: [{ kid: 'k-other-1', public_key_file: join(tls.dir, 'k-other-1.pub.pem') }],
          tls_client: { certificate_sha256: [tls.pipeOther.sha256] },
          repository_ids: options.otherAllowlist ?? [PAYMENTS],
        },
      ],
    }),
  );
  const setting = resolvePipeIntegrationConfig({
    PIPE_SEARCH_INTEGRATION_ENABLED: 'true',
    PIPE_SEARCH_INTEGRATION_HOST: '127.0.0.1',
    PIPE_SEARCH_INTEGRATION_PORT: '1',
    PIPE_SEARCH_INTEGRATION_TLS_KEY_FILE: join(tls.dir, 'server.key.pem'),
    PIPE_SEARCH_INTEGRATION_TLS_CERT_FILE: join(tls.dir, 'server.crt.pem'),
    PIPE_SEARCH_INTEGRATION_TLS_CLIENT_CA_FILE: join(tls.dir, 'client-ca.pem'),
    PIPE_SEARCH_INTEGRATION_POLICY_FILE: join(tls.dir, 'policy.json'),
    GHE_BASE_URL: `https://${GHE_HOST}`,
  });
  if (!setting.enabled) throw new Error('연동 구성이 켜져야 한다');

  const pool = await migratedPool();
  const redis = createTestRedis();
  const es = createEsClient(resolveClientOptions());
  await applyMappings(es);
  await switchAliasesForTests(es);

  await clearIntegrationTables(pool);
  await pool.query('DELETE FROM permission_cache');
  await pool.query('DELETE FROM app_user');
  await pool.query('DELETE FROM team_member');
  await pool.query('DELETE FROM team');
  await pool.query('DELETE FROM repository');
  for (const user of [USER_A, USER_B, OPERATOR]) {
    await authRepo.upsertUserOnLogin(pool, { user_id: user.userId, login: user.login, github_user_id: user.gheId });
    await redis.del(scopeKey(user.userId));
  }
  await authRepo.setAssignedRoles(pool, OPERATOR.userId, ['developer', 'operator', 'security_officer']);
  for (const [id, owner, name, org] of [
    [PAYMENTS, 'acme', 'payments', ORG],
    [BILLING, 'acme', 'billing', ORG],
    [HIDDEN, 'other', 'secret', 2],
  ] as const) {
    await repositoryRepo.upsertRepository(pool, { repository_id: id, owner, name, org_id: org, visibility: 'internal', sequence_branches: ['main'] });
  }
  await sequenceSpaceRepo.ensureSequenceSpace(pool, PAYMENTS, 'main');
  await pool.query('UPDATE sequence_space SET seq_epoch = 3 WHERE repository_id = $1 AND base_branch = $2', [PAYMENTS, 'main']);
  for (const user of [USER_A, USER_B, OPERATOR]) await bind(pool, user);

  await es.deleteByQuery({ index: ['prs-pull-requests', 'prs-commits'], query: { match_all: {} }, refresh: true, conflicts: 'proceed' });
  const bulk = await es.bulk({
    refresh: true,
    operations: [
      ...PULL_REQUESTS.flatMap(({ _id, ...doc }) => [{ index: { _index: 'prs-pull-requests', _id } }, { ...doc, doc_id: _id }]),
      ...COMMITS.flatMap(({ _id, ...doc }) => [{ index: { _index: 'prs-commits', _id } }, { ...doc, doc_id: _id }]),
    ],
  });
  if (bulk.errors) throw new Error('fixture 색인이 거부됐다');

  const scopes = new Map<string, number[]>([
    [USER_A.userId, [PAYMENTS, BILLING]],
    [USER_B.userId, [BILLING]],
    [OPERATOR.userId, [PAYMENTS, BILLING, HIDDEN]],
  ]);
  const gheUsers = new Map<string, number>([
    [USER_A.login, USER_A.gheId],
    [USER_B.login, USER_B.gheId],
    [OPERATOR.login, OPERATOR.gheId],
  ]);
  const faults: Faults = { replayDown: false, directoryDown: false, scopeDown: false };
  const sourceCalls: string[] = [];
  const scopeFetches: string[] = [];
  const orgScopes = new Map<string, { orgIds: number[]; visibilities: string[] }>();
  const logs: Record<string, unknown>[] = [];
  const clock = { offsetMs: 0 };
  const now = (): number => Date.now() + clock.offsetMs;

  const source: AccessScopeSource = {
    fetch: async (user) => {
      scopeFetches.push(user.userId);
      if (faults.scopeDown) throw new Error('GHE permission API down');
      const org = orgScopes.get(user.userId);
      return {
        repositoryIds: scopes.get(user.userId) ?? [],
        orgIds: org?.orgIds ?? [],
        teamIds: [],
        visibilities: org?.visibilities ?? [],
      };
    },
  };
  const directory: GheUserDirectory = {
    findUserByLogin: async (login) => {
      if (faults.directoryDown) throw new Error('GHE users API down');
      const id = gheUsers.get(login);
      return id === undefined ? null : { id, login };
    },
  };
  const reader = new Proxy(
    {},
    {
      get: (_target, method: string) => method === 'then' ? undefined : async () => {
        sourceCalls.push(method);
        if (method === 'repository') return { default_branch: 'main' };
        if (method === 'branch') return { commit: { sha: SHA } };
        if (method === 'commit') return { sha: SHA, tree: { sha: 'c'.repeat(40) }, parents: [], message: 'm', author: { name: 'a' } };
        if (method === 'tree') return { tree: [{ path: 'README.md', type: 'blob', mode: '100644', sha: SHA, size: 5 }] };
        if (method === 'content') return { type: 'file', size: 6, sha: SHA, encoding: 'base64', content: Buffer.from('hello\n').toString('base64') };
        if (method === 'history') return { body: [{ sha: SHA, parents: [], commit: { message: 'm', author: { name: 'A', date: '2026-08-19T04:00:00Z' }, committer: { date: '2026-08-19T04:00:00Z' } } }], nextPage: null };
        if (method === 'changes') return { body: [{ filename: 'src/pay/retry.ts', status: 'modified', additions: 3, deletions: 1 }], nextPage: null };
        if (method === 'pullRequestsForCommit') return [{ number: 1, title: '결제 재시도', body: null }];
        return {};
      },
    },
  ) as unknown as GitHubSourceReader;

  const config = {
    port: 0,
    adminTokens: [],
    metricsQueryUrl: null,
    gheBaseUrl: `https://${GHE_HOST}`,
    auth: AUTH_CONFIG,
    searchCursorKey: TEST_CURSOR_KEY,
    mergeNumberEnabled: options.mergeNumberEnabled ?? true,
    pipeIntegration: setting,
  } as SearchApiConfig;

  const buildDeps = (replicaPool: Pool, replicaRedis: Redis): ServerDeps => {
    const port = authRedis(replicaRedis);
    const resolveNames = async (names: { readonly orgs: readonly string[]; readonly teams: readonly string[] }) => ({
      orgIds: await repositoryRepo.resolveOrgIds(replicaPool, names.orgs),
      teamIds: await authRepo.resolveTeamIds(replicaPool, names.teams),
    });
    const auth: AuthContext = {
      sessions: new SessionStore({ redis: port }),
      scopes: new AccessScopeResolver({ redis: port, db: createScopeDatabase(replicaPool), source }),
      forget: async (ids) => {
        if (ids.length > 0) await replicaRedis.del(...ids.map(scopeKey));
      },
    };
    return {
      config,
      auth,
      search: { pool: replicaPool, es, cursorSigner: TEST_CURSOR_SIGNER, resolveNames },
      repositories: { pool: replicaPool, es, cursorSigner: TEST_CURSOR_SIGNER },
      sequence: { pool: replicaPool, es, cursorSigner: TEST_CURSOR_SIGNER, resolveNames },
      source: { pool: replicaPool, reader: () => reader, es },
    };
  };

  const publicDeps = buildDeps(pool, redis);
  const publicApp = buildServer(publicDeps);
  await publicApp.ready();

  const replicas: Replica[] = [];
  for (let index = 0; index < (options.replicas ?? 1); index += 1) {
    const replicaPool = index === 0 ? pool : await migratedPool();
    const replicaRedis = index === 0 ? redis : createTestRedis();
    const store = redisReplayStore(replicaRedis as unknown as Parameters<typeof redisReplayStore>[0]);
    const built = buildPipeIntegrationDeps({
      config,
      setting,
      serverDeps: index === 0 ? publicDeps : buildDeps(replicaPool, replicaRedis),
      replay: { setIfAbsent: (key, seconds) => (faults.replayDown ? Promise.reject(new Error('redis down')) : store.setIfAbsent(key, seconds)) },
      directory,
      log: (entry) => {
        logs.push(entry);
      },
      now,
    });
    if (built === undefined) throw new Error('연동 서버가 조립되어야 한다');
    const app = buildIntegrationServer(built);
    await app.listen({ host: '127.0.0.1', port: 0 });
    replicas.push({ app, port: (app.server.address() as AddressInfo).port, pool: replicaPool, redis: replicaRedis });
  }

  const keyFor = (input: SignInput): { kid: string; key: KeyObject } => {
    if (input.client === 'other') return { kid: input.kid ?? 'k-other-1', key: otherKey.privateKey };
    const kid = input.kid ?? 'k-dev-1';
    const pair = (devKeys as Record<string, { privateKey: KeyObject }>)[kid] ?? devKeys['k-dev-1'];
    return { kid, key: pair.privateKey };
  };

  const harness: Harness = {
    pool,
    redis,
    es,
    tls,
    setting,
    publicApp,
    replicas,
    scopes,
    gheUsers,
    faults,
    get clockOffsetMs() {
      return clock.offsetMs;
    },
    set clockOffsetMs(value: number) {
      clock.offsetMs = value;
    },
    sourceCalls,
    scopeFetches,
    orgScopes,
    logs,
    now,
    async signAssertion(input: SignInput) {
      const user = input.user ?? USER_A;
      const nowS = Math.floor(now() / 1000);
      const other = input.client === 'other';
      const payload: Record<string, unknown> = {
        iss: other ? OTHER_ISSUER : ISSUER,
        aud: other ? OTHER_AUDIENCE : AUDIENCE,
        sub: user.subject,
        client_id: other ? CLIENT_OTHER : CLIENT_DEV,
        purpose: input.purpose ?? 'grant',
        profile: 'search-read-v1',
        auth_context_id: input.contextId ?? `ctx-${user.subject}-0001`,
        auth_expires_at: nowS + 3600,
        iat: nowS,
        nbf: nowS,
        exp: nowS + 60,
        jti: input.jti ?? randomBytes(18).toString('base64url'),
        ...input.overrides,
      };
      const { kid, key } = keyFor(input);
      return new CompactSign(new TextEncoder().encode(JSON.stringify(payload)))
        .setProtectedHeader({ alg: 'RS256', typ: ASSERTION_TYP, kid })
        .sign(key);
    },
    exchange(assertion, callOptions = {}) {
      return harness.post('/auth/exchange', JSON.stringify({ assertion }), callOptions);
    },
    get(path, grant, callOptions = {}) {
      const replica = replicas[callOptions.replica ?? 0];
      if (replica === undefined) throw new Error('복제본이 없다');
      return tlsRequest(replica.port, tls.serverCa, {
        method: callOptions.method ?? 'GET',
        path: `${INTEGRATION_PREFIX}${path}`,
        headers: { ...(grant === null ? {} : { authorization: `Bearer ${grant}` }), ...callOptions.headers },
        identity: callOptions.identity === undefined ? tls.pipeDev : callOptions.identity,
      });
    },
    post(path, body, callOptions = {}) {
      const replica = replicas[callOptions.replica ?? 0];
      if (replica === undefined) throw new Error('복제본이 없다');
      return tlsRequest(replica.port, tls.serverCa, {
        method: callOptions.method ?? 'POST',
        path: `${INTEGRATION_PREFIX}${path}`,
        headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...callOptions.headers },
        ...(body === undefined ? {} : { body }),
        identity: callOptions.identity === undefined ? tls.pipeDev : callOptions.identity,
      });
    },
    async grantFor(user, input = {}) {
      const response = await harness.exchange(await harness.signAssertion({ ...input, user }), input);
      if (response.status !== 200) throw new Error(`grant 발급 실패: ${String(response.status)} ${response.body}`);
      return response.json<{ access_token: string }>().access_token;
    },
    async publicGet(url, user, headers = {}) {
      let cookie: Record<string, string> = {};
      if (user !== null) {
        const sessionId = createSessionId();
        const at = Date.now();
        await publicDeps.auth?.sessions.create({
          sessionId,
          userId: user.userId,
          login: user.login,
          email: null,
          roles: ['developer'],
          issuedAt: at,
          lastSeenAt: at,
          correlationId: null,
          githubUserId: user.gheId,
        });
        cookie = { cookie: `${SESSION_COOKIE_NAME}=${sessionId}` };
      }
      const response = await publicApp.inject({ method: 'GET', url, headers: { ...cookie, ...headers } });
      return { status: response.statusCode, body: response.body, json: <T>() => response.json<T>() };
    },
    async resetScopeCache() {
      await pool.query('DELETE FROM permission_cache');
      for (const user of [USER_A, USER_B, OPERATOR]) await redis.del(scopeKey(user.userId));
    },
    async close() {
      for (const replica of replicas) await replica.app.close();
      await publicApp.close();
      await clearIntegrationTables(pool);
      for (const replica of replicas.slice(1)) {
        await replica.pool.end();
        await replica.redis.quit();
      }
      await redis.quit();
      await es.close();
      await pool.end();
      rmSync(tls.dir, { recursive: true, force: true });
    },
  };
  return harness;
}

/** 이벤트 기록은 응답 뒤에 남는다. 행이 생길 때까지 잠시 기다린다. */
export async function eventsFor(pool: Pool, correlationId: string, attempts = 50): Promise<Record<string, unknown>[]> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const { rows } = await pool.query<Record<string, unknown>>(
      'SELECT * FROM pipe_integration_event WHERE correlation_id = $1 ORDER BY event_id',
      [correlationId],
    );
    if (rows.length > 0) return rows;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return [];
}
