import { createPool } from '@prs/db';
import { RedisStreamsEventBus } from '@prs/bus';
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
import { resolveSearchApiConfig } from './config.js';
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
 * 저장소 등록은 GHE 자격 증명을 요구한다 (FR-ING-009 예외 처리).
 *
 * 없으면 등록 경로를 달지 않는다. 접근 권한을 확인할 수 없는 채로 등록을
 * 받으면 수집이 영영 비어 있는 저장소가 "등록됨"으로 남는다.
 */
function buildRegistry(): RegistryDeps | undefined {
  const githubConfig = resolveGitHubConfig();
  const installations = parseInstallations();
  if (!hasAppCredentials(githubConfig) || installations.length === 0) {
    log({
      level: 'warn',
      message: 'GHE 자격 증명이 없어 저장소 등록 경로를 등록하지 않는다 (API-ADM-001)',
    });
    return undefined;
  }

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

  return {
    pool,
    es,
    lookup: createGheLookup(client, (org) => tokenPool.installationFor(org)),
    log: (entry) => log({ ...entry }),
  };
}

const registry = buildRegistry();

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
      await es.close();
      await pool.end();
    })
    .then(() => process.exit(0));
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
