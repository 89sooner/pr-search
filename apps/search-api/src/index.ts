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
import { authRepo, repositoryRepo } from '@prs/db';
import { resolveSearchApiConfig } from './config.js';
import { createAuthContext, createAuthMetrics, type AuthContext, type AuthRedis } from './auth/context.js';
import { SEARCH_TIMEOUT_MS } from './search/routes.js';
import { createGheLookup } from './ops/ghe-lookup.js';
import type { RegistryDeps } from './ops/repositories.js';
import { buildServer, SERVICE_NAME } from './server.js';
import { buildServerDeps, runtimeCapabilities } from './runtime.js';
import { buildPipeIntegrationDeps, gheUserDirectory, redisReplayStore } from './integrations/pipe/runtime.js';
import { buildIntegrationServer } from './integrations/pipe/server.js';

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
function buildGitHub():
  | { client: GitHubClient; installationFor: (org: string) => number | undefined; orgs: readonly string[] }
  | undefined {
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

  return {
    client,
    installationFor: (org: string) => tokenPool.installationFor(org),
    // PIPE 연동의 GHE 사용자 조회가 설치 토큰을 고를 조직 (CR-112). 조회 대상과 무관하다.
    orgs: installations.map((installation) => installation.org),
  };
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
    /*
     * 저장소 팀 접근 범위 (WP-068 / CR-035, DEV-185). 등록·갱신 시 채운다 —
     * 이 값이 없으면 `team:` 질의가 한 건도 맞히지 못한다.
     */
    listTeams: async (owner, name) => github.client.listRepositoryTeams({ owner, repo: name }),
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
    log: (message, detail) => {
      log({ level: 'warn', message, ...detail });
    },
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

/**
 * `org`·`team` 이름을 ID로 옮긴다 (CR-016, DEV-052).
 *
 * 문서는 숫자만 갖고 사용자는 이름으로 묻는다. 레지스트리가 그 사이를 잇는다.
 */
const searchDeps = {
  es,
  resolveNames: async (names: { readonly orgs: readonly string[]; readonly teams: readonly string[] }) => ({
    orgIds: await repositoryRepo.resolveOrgIds(pool, names.orgs),
    teamIds: await authRepo.resolveTeamIds(pool, names.teams),
  }),
  timeoutMs: SEARCH_TIMEOUT_MS,
};

/*
 * 조립은 `runtime.ts`가 한다 (CR-034, DEV-177). 여기서 직접 객체를 만들면
 * "무엇을 넘기는가"가 어떤 시험에도 걸리지 않는 자리로 남는다 — API-ADM-007이
 * 정확히 그 자리에서 빠졌다.
 */
/*
 * 위임 인가 왕복 상태(REL-007 R0)는 세션과 같은 Redis에 둔다 — 별도 연결을 만들
 * 이유가 없고, 세션이 없는 배포에는 위임 신원도 없다.
 */
const identityClient = authRedis;
const identityRedis =
  identityClient === undefined
    ? undefined
    : {
        get: (key: string) => identityClient.get(key),
        set: (key: string, value: string, mode: 'EX', seconds: number) => identityClient.set(key, value, mode, seconds),
        del: (...keys: string[]) => identityClient.del(...keys),
      };

const runtimeParts = {
  config,
  pool,
  bus,
  es,
  log,
  ...(github === undefined ? {} : { github }),
  ...(registry === undefined ? {} : { registry }),
  ...(auth === undefined ? {} : { auth, searchDeps }),
  ...(identityRedis === undefined ? {} : { identityRedis }),
};

log({ level: 'info', message: '기능 가용성', capabilities: runtimeCapabilities(runtimeParts) });

const serverDeps = buildServerDeps(runtimeParts);
const app = buildServer(serverDeps);

/*
 * PIPE 연동 private 리스너 (CR-112 / ADR-025).
 *
 * **공개 리스너와 같은 의존으로** 조립한다(`buildPipeIntegrationDeps`). 꺼져 있으면 만들지 않는다. 켰는데
 * 의존이 모자라면 여기서 던져 **기동하지 않는다** — 일부만 선 연동을 띄우지 않는다.
 */
const pipeSetting = config.pipeIntegration ?? { enabled: false as const };
const pipeReplayClient = authRedis;
const pipeInstallOrg = github?.orgs[0];
const pipeOptions = buildPipeIntegrationDeps({
  config,
  setting: pipeSetting,
  serverDeps,
  replay: pipeReplayClient === undefined ? undefined : redisReplayStore(pipeReplayClient),
  directory: github === undefined || pipeInstallOrg === undefined ? undefined : gheUserDirectory(github.client, pipeInstallOrg),
  log,
});
const integrationApp = pipeOptions === undefined ? undefined : buildIntegrationServer(pipeOptions);

try {
  await app.listen({ port: config.port, host: '0.0.0.0' });
  process.stdout.write(`${SERVICE_NAME} listening on ${String(config.port)}\n`);
  if (integrationApp !== undefined && pipeSetting.enabled) {
    await integrationApp.listen({ port: pipeSetting.port, host: pipeSetting.host });
    log({
      level: 'info',
      message: 'PIPE 연동 private 리스너 (mTLS)',
      host: pipeSetting.host,
      port: pipeSetting.port,
      clients: pipeSetting.clients.map((client) => client.clientId),
    });
  }
} catch (error) {
  process.stderr.write(`${SERVICE_NAME} failed to start: ${String(error)}\n`);
  process.exit(1);
}

const shutdown = (): void => {
  void Promise.all([app.close(), integrationApp?.close()])
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
