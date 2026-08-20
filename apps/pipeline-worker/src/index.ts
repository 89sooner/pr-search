/**
 * pipeline-worker 프로세스 진입점.
 *
 * 시스템 아키텍처 4장대로 한 이미지에 여러 역할이 들어가고, 환경 변수
 * `PIPELINE_WORKER_ROLES`가 이 프로세스가 맡을 역할을 정한다. 지금 채워진
 * 역할은 셋이다 — `batch`의 아웃박스 재적재(JOB-ING-007, WP-005), `enrich`의
 * PR 보강(JOB-ING-002, WP-007), `project`의 문서 투영(JOB-ING-003, WP-008).
 * `sequence`·`link`는 이후 WP가 채운다.
 */

import { createPool } from '@prs/db';
import { RedisStreamsEventBus } from '@prs/bus';
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
import { buildServer, DEFAULT_PORT, SERVICE_NAME } from './server.js';
import { startOutboxRelay, type OutboxRelay } from './outbox-relay.js';
import { createWorkerMetrics } from './metrics.js';
import { startEnrichWorker, type EnrichLogEntry } from './enrich.js';
import { startProjectWorker, type ProjectLogEntry } from './project.js';
import { createEsClient } from '@prs/es';
import type { Subscription } from '@prs/bus';
import type { Client } from '@elastic/elasticsearch';

const port = Number(process.env['PIPELINE_WORKER_PORT'] ?? DEFAULT_PORT);
const roles = (process.env['PIPELINE_WORKER_ROLES'] ?? 'batch')
  .split(',')
  .map((role) => role.trim())
  .filter((role) => role !== '');

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

let shuttingDown = false;
const shutdown = (): void => {
  if (shuttingDown) return;
  shuttingDown = true;
  void (async (): Promise<void> => {
    try {
      // 진행 중인 회차를 마치고 나간다. 중간에 끊으면 발행은 됐는데 타이머를
      // 못 감은 행이 남아 다음 기동에서 한 번 더 발행된다.
      await relay?.stop();
      await enrichSubscription?.close();
      await projectSubscription?.close();
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
