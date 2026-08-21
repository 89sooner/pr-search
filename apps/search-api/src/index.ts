import { createPool } from '@prs/db';
import { RedisStreamsEventBus, createRedisClient } from '@prs/bus';
import { createEsClient, resolveClientOptions } from '@prs/es';
import {
  GitHubClient,
  GitHubTransport,
  InstallationTokenProvider,
  RequestScheduler,
  TokenPool,
  hasAppCredentials,
  parseInstallations,
  resolveGitHubConfig,
} from '@prs/github';
import { GheAccessScopeSource, ghePermissionApi } from '@prs/authz';
import { repositoryRepo } from '@prs/db';
import { resolveSearchApiConfig } from './config.js';
import { createAuthContext, createAuthMetrics, type AuthContext, type AuthRedis } from './auth/context.js';
import { createGheLookup } from './ops/ghe-lookup.js';
import type { RegistryDeps } from './ops/repositories.js';
import { buildServer, SERVICE_NAME } from './server.js';

const config = resolveSearchApiConfig();
const pool = createPool();
const bus = new RedisStreamsEventBus();
const es = createEsClient(resolveClientOptions());

const log = (entry: Record<string, unknown>): void => {
  process.stdout.write(`${JSON.stringify({ service: SERVICE_NAME, ...entry })}\n`);
};

/**
 * GHE 클라이언트. 저장소 등록(API-ADM-001)과 접근 범위 산출(FR-AUTH-002)이
 * 함께 쓴다. 자격 증명이 없으면 두 기능 모두 서지 않는다.
 */
function buildGitHub(): { client: GitHubClient; installationFor: (org: string) => number | undefined } | undefined {
  const githubConfig = resolveGitHubConfig();
  const installations = parseInstallations();
  if (!hasAppCredentials(githubConfig) || installations.length === 0) return undefined;

  const tokenPool = new TokenPool(
    new InstallationTokenProvider({
      apiUrl: githubConfig.apiUrl,
      appId: githubConfig.appId,
      privateKey: githubConfig.privateKey,
      refreshLeadMs: githubConfig.tokenRefreshLeadMs,
      requestTimeoutMs: githubConfig.requestTimeoutMs,
    }),
    { installations, quarantineThreshold: githubConfig.quarantineThreshold },
  );
  const client = new GitHubClient(
    new GitHubTransport({
      apiUrl: githubConfig.apiUrl,
      requestTimeoutMs: githubConfig.requestTimeoutMs,
      pool: tokenPool,
      scheduler: new RequestScheduler({ maxConcurrent: githubConfig.maxConcurrentRequests }),
    }),
  );

  return { client, installationFor: (org: string) => tokenPool.installationFor(org) };
}

const github = buildGitHub();

/**
 * 저장소 등록은 GHE 자격 증명을 요구한다 (FR-ING-009 예외 처리).
 *
 * 없으면 등록 경로를 달지 않는다. 접근 권한을 확인할 수 없는 채로 등록을
 * 받으면 수집이 영영 비어 있는 저장소가 "등록됨"으로 남는다.
 */
function buildRegistry(): RegistryDeps | undefined {
  if (github === undefined) {
    log({
      level: 'warn',
      message: 'GHE 자격 증명이 없어 저장소 등록 경로를 등록하지 않는다 (API-ADM-001)',
    });
    return undefined;
  }
  return {
    pool,
    es,
    lookup: createGheLookup(github.client, github.installationFor),
    log: (entry) => log({ ...entry }),
  };
}

/**
 * 세션 인증 컨텍스트 (WP-012).
 *
 * GHE 자격 증명이 없으면 접근 범위를 산출할 방법이 없다. 그 경우 세션을
 * 세우지 않는다 — 모든 조회가 503이 되는 서비스를 띄우는 것보다 인증이
 * 구성되지 않았다고 말하는 편이 낫다.
 */
let authRedis: ReturnType<typeof createRedisClient> | undefined;
function buildAuth(): AuthContext | undefined {
  if (!config.auth.enabled) return undefined;
  if (github === undefined) {
    log({
      level: 'warn',
      message: 'GHE 자격 증명이 없어 세션 인증을 세우지 않는다 (FR-AUTH-002 AC-1)',
    });
    return undefined;
  }

  authRedis = createRedisClient();
  const client = authRedis;
  const redis: AuthRedis = {
    get: (key) => client.get(key),
    set: (key, value, mode, seconds) => client.set(key, value, mode, seconds),
    del: (...keys) => client.del(...keys),
    scan: (cursor, m, pattern, c, n) => client.scan(cursor, m, pattern, c, n),
  };

  return createAuthContext({
    redis,
    pool,
    metrics: createAuthMetrics(),
    source: new GheAccessScopeSource({
      api: ghePermissionApi(github.client),
      // 등록된 저장소만 확인한다 — 등록되지 않은 저장소에는 문서가 없다.
      listRegistered: async () => {
        const rows = await repositoryRepo.listRepositories(pool, { status: 'active' });
        return rows.map((row) => ({
          repositoryId: row.repository_id,
          owner: row.owner,
          name: row.name,
          orgId: row.org_id,
          visibility: row.visibility,
        }));
      },
    }),
  });
}

const registry = buildRegistry();
const auth = buildAuth();

const app = buildServer({
  config,
  ops: { pool, bus, log: (entry) => log({ ...entry }) },
  pipeline: {
    pool,
    bus,
    es,
    metricsQueryUrl: config.metricsQueryUrl,
    log: (entry) => log({ ...entry }),
  },
  ...(registry === undefined ? {} : { registry }),
  ...(auth === undefined ? {} : { auth }),
  log: (entry) => log({ ...entry }),
});

try {
  await app.listen({ port: config.port, host: '0.0.0.0' });
  process.stdout.write(`${SERVICE_NAME} listening on ${String(config.port)}\n`);
} catch (error) {
  process.stderr.write(`${SERVICE_NAME} failed to start: ${String(error)}\n`);
  process.exit(1);
}

const shutdown = (): void => {
  void app
    .close()
    .then(async () => {
      await bus.close();
      await authRedis?.quit();
      await es.close();
      await pool.end();
    })
    .then(() => process.exit(0));
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
