/**
 * pipeline-worker 프로세스 진입점.
 *
 * 시스템 아키텍처 4장대로 한 이미지에 여러 역할이 들어가고, 환경 변수
 * `PIPELINE_WORKER_ROLES`가 이 프로세스가 맡을 역할을 정한다. 지금 채워진
 * 역할은 셋이다 — `batch`의 아웃박스 재적재(JOB-ING-007, WP-005), `enrich`의
 * PR 보강(JOB-ING-002, WP-007), `project`의 문서 투영(JOB-ING-003, WP-008).
 * `sequence`·`link`는 이후 WP가 채운다.
 */

import { createPool, jobRepo, repositoryRepo } from '@prs/db';
import { scopeKey, type ScopeRedis } from '@prs/authz';
import { RedisStreamsEventBus, createRedisClient } from '@prs/bus';
import {
  GitHubClient,
  GitHubTransport,
  InstallationTokenProvider,
  RequestScheduler,
  TokenPool,
  hasAppCredentials,
  parseInstallations,
  resolveGitHubConfig,
  MirrorSync,
  resolveMirrorConfig,
} from '@prs/github';
import { buildServer, DEFAULT_PORT, SERVICE_NAME } from './server.js';
import { startOutboxRelay, type OutboxRelay } from './outbox-relay.js';
import { createWorkerMetrics } from './metrics.js';
import { startEnrichWorker, type EnrichLogEntry } from './enrich.js';
import { startProjectWorker, type ProjectLogEntry } from './project.js';
import { startAuthzWorker, type AuthzLogEntry } from './authz.js';
import { startBackfillRunner, BACKFILL_JOB, type BackfillLogEntry, type BackfillRunner } from './backfill.js';
import { startMirrorSweeper, type MirrorLogEntry, type MirrorRunner } from './mirror-runner.js';
import { createEsClient } from '@prs/es';
import type { Subscription } from '@prs/bus';
import type { Client } from '@elastic/elasticsearch';

const port = Number(process.env['PIPELINE_WORKER_PORT'] ?? DEFAULT_PORT);
const roles = (process.env['PIPELINE_WORKER_ROLES'] ?? 'batch')
  .split(',')
  .map((role) => role.trim())
  .filter((role) => role !== '');

/**
 * 동시 실행 상한 (FR-ING-006 AC-6, 기본 3).
 *
 * 값이 틀리면 **기본값으로 돈다.** 기동을 거부하지 않는 이유: 백필은
 * 실시간 수집과 달리 멈춰도 데이터가 유실되지 않고, 설정 오타 하나로
 * 워커 전체가 뜨지 않으면 실시간 수집까지 함께 죽는다.
 */
function resolveBackfillConcurrency(): number {
  const raw = process.env['BACKFILL_MAX_CONCURRENCY'];
  if (raw === undefined || raw === '') return jobRepo.DEFAULT_MAX_CONCURRENT_JOBS;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    process.stderr.write(
      `BACKFILL_MAX_CONCURRENCY가 양의 정수가 아니다: ${raw} — 기본값 ${String(jobRepo.DEFAULT_MAX_CONCURRENT_JOBS)}로 돈다\n`,
    );
    return jobRepo.DEFAULT_MAX_CONCURRENT_JOBS;
  }
  return parsed;
}

const metrics = createWorkerMetrics();
const server = buildServer({ metrics });
server.listen(port, '0.0.0.0', () => {
  process.stdout.write(`${SERVICE_NAME} listening on ${String(port)} (roles: ${roles.join(',')})\n`);
});

const pool = createPool();
const bus = new RedisStreamsEventBus();
let relay: OutboxRelay | undefined;
let enrichSubscription: Subscription | undefined;
let projectSubscription: Subscription | undefined;
let authzSubscription: Subscription | undefined;
let authzRedisClient: { quit(): Promise<unknown> } | undefined;
let backfillRunner: BackfillRunner | undefined;
let mirrorRunner: MirrorRunner | undefined;
let esClient: Client | undefined;

if (roles.includes('batch')) {
  relay = startOutboxRelay(pool, bus, {
    log: (entry) => {
      process.stdout.write(`${JSON.stringify({ service: SERVICE_NAME, job: 'JOB-ING-007', ...entry })}\n`);
    },
  });
}

if (roles.includes('enrich')) {
  const config = resolveGitHubConfig();
  const installations = parseInstallations();
  if (!hasAppCredentials(config)) {
    // 자격 증명 없이 보강 역할을 켜면 모든 이벤트가 인증 실패로 실패 대기열에
    // 쌓인다. 조용히 도는 것보다 기동을 거부하는 편이 낫다.
    throw new Error('enrich 역할에는 GHE_APP_ID와 GHE_APP_PRIVATE_KEY가 필요하다');
  }
  if (installations.length === 0) {
    throw new Error('enrich 역할에는 GHE_INSTALLATIONS가 필요하다 (org:installationId, CR-010 DEV-015)');
  }

  const tokenPool = new TokenPool(
    new InstallationTokenProvider({
      apiUrl: config.apiUrl,
      appId: config.appId,
      privateKey: config.privateKey,
      refreshLeadMs: config.tokenRefreshLeadMs,
      requestTimeoutMs: config.requestTimeoutMs,
    }),
    { installations, quarantineThreshold: config.quarantineThreshold },
  );
  const client = new GitHubClient(
    new GitHubTransport({
      apiUrl: config.apiUrl,
      requestTimeoutMs: config.requestTimeoutMs,
      pool: tokenPool,
      scheduler: new RequestScheduler({ maxConcurrent: config.maxConcurrentRequests }),
    }),
  );

  enrichSubscription = await startEnrichWorker({
    pool,
    bus,
    client,
    installationFor: (org) => tokenPool.installationFor(org),
    metrics,
    log: (entry: EnrichLogEntry) => {
      process.stdout.write(`${JSON.stringify({ service: SERVICE_NAME, job: 'JOB-ING-002', ...entry })}\n`);
    },
  });

  /*
   * 백필도 GHE를 부르므로 `enrich`와 같은 자격 증명·토큰 풀을 쓴다
   * (WP-019 / JOB-ING-004). 별도 역할 플래그로 켜는 이유는 **워커 풀을
   * 나눌 수 있어야** 하기 때문이다 (FR-ING-006 AC-3) — 백필 전용 파드를
   * 띄우면 실시간 파드가 백필 부하를 전혀 받지 않는다.
   *
   * 같은 파드에서 함께 켜도 안전하다: 모든 백필 호출이 `priority: 'backfill'`
   * 이라 `RequestScheduler`가 실시간을 먼저 비운다.
   */
  if (roles.includes('backfill')) {
    esClient = esClient ?? createEsClient();
    backfillRunner = startBackfillRunner(
      {
        pool,
        es: esClient,
        client,
        findRepository: async (target) => {
          const slash = target.indexOf('/');
          if (slash < 0) return undefined;
          return repositoryRepo.findRepositoryBySlug(pool, target.slice(0, slash), target.slice(slash + 1));
        },
        log: (entry: BackfillLogEntry) => {
          process.stdout.write(`${JSON.stringify({ service: SERVICE_NAME, job: BACKFILL_JOB, ...entry })}\n`);
        },
      },
      { maxConcurrent: resolveBackfillConcurrency() },
    );
  }
}

if (roles.includes('project')) {
  // 투영은 GitHub을 부르지 않는다 — EVT-ING-002가 self-contained이기 때문이다
  // (CR-010, DEV-013). 그래서 이 역할에는 GHE 자격 증명이 필요 없다.
  esClient = createEsClient();
  projectSubscription = await startProjectWorker({
    pool,
    bus,
    es: esClient,
    metrics,
    log: (entry: ProjectLogEntry) => {
      process.stdout.write(`${JSON.stringify({ service: SERVICE_NAME, job: 'JOB-ING-003', ...entry })}\n`);
    },
  });
}

if (roles.includes('mirror')) {
  /*
   * JOB-MIR-001 (CR-023, DEV-113).
   *
   * **GHE 자격 증명은 선택이다.** 없으면 자격 증명 없이 클론을 시도하고
   * 사설 저장소에서는 실패한다 — 그 실패는 지표와 로그로 드러나며 조회는
   * API 폴백이 답한다 (ADR-005). 자격 증명을 URL에 넣지 않는 이유는
   * `.git/config`에 평문으로 남기 때문이다 (DEV-110).
   */
  const mirrorConfig = resolveMirrorConfig();
  const ghConfig = resolveGitHubConfig();
  let mirrorTokenFor: ((org: string) => Promise<string | null>) | undefined;
  if (hasAppCredentials(ghConfig) && parseInstallations().length > 0) {
    const mirrorTokens = new TokenPool(
      new InstallationTokenProvider({
        apiUrl: ghConfig.apiUrl,
        appId: ghConfig.appId,
        privateKey: ghConfig.privateKey,
        refreshLeadMs: ghConfig.tokenRefreshLeadMs,
        requestTimeoutMs: ghConfig.requestTimeoutMs,
      }),
      { installations: parseInstallations(), quarantineThreshold: ghConfig.quarantineThreshold },
    );
    mirrorTokenFor = async (org: string): Promise<string | null> => {
      try {
        return (await mirrorTokens.lease(org)).token.token;
      } catch {
        // 토큰을 못 얻으면 자격 증명 없이 시도한다. 공개 저장소는 그래도 된다.
        return null;
      }
    };
  }

  const mirrorSync = new MirrorSync({
    root: mirrorConfig.root,
    remoteUrl: (ref) => `${ghConfig.baseUrl}/${ref.owner}/${ref.repo}.git`,
    allowBlobFetch: mirrorConfig.allowBlobFetch,
    ...(mirrorTokenFor === undefined ? {} : { tokenFor: mirrorTokenFor }),
  });

  mirrorRunner = startMirrorSweeper({
    pool,
    sync: mirrorSync,
    log: (entry: MirrorLogEntry) => {
      process.stdout.write(`${JSON.stringify({ service: SERVICE_NAME, job: 'JOB-MIR-001', ...entry })}\n`);
    },
  });

  if (mirrorConfig.allowBlobFetch) {
    // 조용히 켜져 있으면 안 되는 설정이다 (CR-023, DEV-111).
    process.stdout.write(
      `${JSON.stringify({
        service: SERVICE_NAME,
        level: 'warn',
        message: 'MIRROR_ALLOW_BLOB_FETCH가 켜져 있다 — patch-id가 가능해지지만 소스 blob이 미러 볼륨에 쌓인다 (THR-015)',
      })}\n`,
    );
  }
}

if (roles.includes('authz')) {
  // JOB-AUTH-001. GHE 자격 증명은 **선택**이다 — 없으면 `team_member` 표만으로
  // 팀을 펼친다. 표가 비어 있으면 팀 무효화가 아무도 맞히지 못하므로,
  // 자격 증명이 있는 배포를 권한다 (CR-015, DEV-046).
  const authzRedis = createRedisClient();
  const scopeRedis: ScopeRedis = {
    get: (key) => authzRedis.get(key),
    set: (key, value, mode, seconds) => authzRedis.set(key, value, mode, seconds),
    del: (...keys) => authzRedis.del(...keys),
  };

  let authzGithub: GitHubClient | undefined;
  const ghConfig = resolveGitHubConfig();
  if (hasAppCredentials(ghConfig) && parseInstallations().length > 0) {
    const authzPool = new TokenPool(
      new InstallationTokenProvider({
        apiUrl: ghConfig.apiUrl,
        appId: ghConfig.appId,
        privateKey: ghConfig.privateKey,
        refreshLeadMs: ghConfig.tokenRefreshLeadMs,
        requestTimeoutMs: ghConfig.requestTimeoutMs,
      }),
      { installations: parseInstallations(), quarantineThreshold: ghConfig.quarantineThreshold },
    );
    authzGithub = new GitHubClient(
      new GitHubTransport({
        apiUrl: ghConfig.apiUrl,
        requestTimeoutMs: ghConfig.requestTimeoutMs,
        pool: authzPool,
        scheduler: new RequestScheduler({ maxConcurrent: ghConfig.maxConcurrentRequests }),
      }),
    );
  } else {
    process.stdout.write(
      `${JSON.stringify({
        service: SERVICE_NAME,
        job: 'JOB-AUTH-001',
        level: 'warn',
        message: 'GHE 자격 증명이 없다 — 팀 무효화는 team_member 표만 쓴다 (CR-015, DEV-046)',
      })}\n`,
    );
  }

  authzRedisClient = authzRedis;
  authzSubscription = await startAuthzWorker({
    pool,
    bus,
    metrics,
    github: authzGithub,
    forgetCached: async (userIds) => {
      if (userIds.length === 0) return;
      await scopeRedis.del(...userIds.map(scopeKey));
    },
    log: (entry: AuthzLogEntry) => {
      process.stdout.write(`${JSON.stringify({ service: SERVICE_NAME, job: 'JOB-AUTH-001', ...entry })}\n`);
    },
  });
}

let shuttingDown = false;
const shutdown = (): void => {
  if (shuttingDown) return;
  shuttingDown = true;
  void (async (): Promise<void> => {
    try {
      // 진행 중인 회차를 마치고 나간다. 중간에 끊으면 발행은 됐는데 타이머를
      // 못 감은 행이 남아 다음 기동에서 한 번 더 발행된다.
      await relay?.stop();
      /*
       * 러너는 **현재 페이지를 마치고** 나간다. 중간에 끊으면 커서가 가리키는
       * 지점과 실제 처리 지점이 어긋나 재개가 처리하지 않은 PR을 건너뛴다.
       */
      await backfillRunner?.stop();
      await mirrorRunner?.stop();
      await enrichSubscription?.close();
      await projectSubscription?.close();
      await authzSubscription?.close();
      await authzRedisClient?.quit();
      await bus.close();
      await esClient?.close();
      await pool.end();
    } catch (error) {
      process.stderr.write(`${SERVICE_NAME} shutdown error: ${String(error)}\n`);
    }
    server.close(() => {
      process.exit(0);
    });
  })();
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
