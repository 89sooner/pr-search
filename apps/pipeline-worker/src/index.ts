/**
 * pipeline-worker 프로세스 진입점.
 *
 * 시스템 아키텍처 4장대로 한 이미지에 여러 역할이 들어가고, 환경 변수
 * `PIPELINE_WORKER_ROLES`가 이 프로세스가 맡을 역할을 정한다. 지금 채워진
 * 역할은 `batch`·`enrich`·`backfill`·`project`·`mirror`·`sequence`·`reconcile`·
 * `release`·`authz`·`link`다. **`link`는 WP-029가 채웠다** (CR-039) — JOB-REL-001
 * 참조 간선 파생, JOB-REL-005 미해결 참조 해결, JOB-REL-006 전량 재파생.
 */

import { createAdminPool, createPool, jobRepo, repositoryRepo, withReindexWrite, type Pool } from '@prs/db';
import { deterministicEventId } from '@prs/domain';
import {
  refreshTeamScope,
  scopeKey,
  syncRepositoryTeamScope,
  type ScopeRedis,
  type TeamScopeDeps,
} from '@prs/authz';
import { RedisStreamsEventBus, TOPICS, createRedisClient } from '@prs/bus';
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
  MirrorCommitGraph,
  ApiCommitGraph,
  FallbackCommitGraph,
  selectCommitGraph,
  resolveMirrorConfig,
} from '@prs/github';
import { buildServer, DEFAULT_PORT, SERVICE_NAME } from './server.js';
import { startOutboxRelay, type OutboxRelay } from './outbox-relay.js';
import { startRetentionRunner, type RetentionRunner } from './retention.js';
import { startExportRunner } from './export.js';
import { createWorkerMetrics } from './metrics.js';
import { startEnrichWorker, type EnrichLogEntry } from './enrich.js';
import { startProjectWorker, type ProjectLogEntry } from './project.js';
import { startOrgTeamSweeper, type OrgTeamSweeper } from './author-teams.js';
import { startAuthzWorker, type AuthzLogEntry } from './authz.js';
import { startBackfillRunner, BACKFILL_JOB, type BackfillLogEntry, type BackfillRunner } from './backfill.js';
import { startMirrorSweeper, type MirrorLogEntry, type MirrorRunner } from './mirror-runner.js';
import {
  refreshSequenceSpaceStates,
  startSequenceWorker,
  type SequenceDeps,
  type SequenceLogFields,
} from './sequence.js';
import { startReleaseSweeper, startReleaseWorker, type ReleaseLogFields, type ReleaseSweeper } from './release.js';
import { startIntegritySweeper, type IntegritySweeper } from './integrity.js';
import { startConsistencySweeper, type ConsistencySweeper } from './consistency.js';
import { startReconcileSweeper, type ReconcileSweeper } from './reconcile.js';
import {
  startCommitEnrichSweeper,
  startCommitEnrichWorker,
  type CommitEnrichDeps,
  type CommitEnrichSweeper,
} from './commit-enrich.js';
import {
  enqueueSnapshotBootstrap,
  startSnapshotBootstrapRunner,
} from './snapshot-bootstrap.js';
import { startSequenceRepairRunner, type RepairRunner } from './sequence-repair-runner.js';
import { startSequenceAssignRunner, type AssignRunner } from './sequence-assign-runner.js';
import { withMirrorLock } from './mirror-lock.js';
import { resolveMergeNumberConfig, resolveMergeNumberEnabled, resolveSequenceGraphMode } from './mnumber-config.js';
import { observeMergeNumberSamples, OBSERVE_POLL_MS, type MergeNumberDeps } from './mnumber.js';
import { startMergeNumberHintWorker } from './mnumber-hint.js';
import {
  startAnnotateSweeper,
  startAnnotateWorker,
  type AnnotateDeps,
  type AnnotateLogFields,
  type AnnotateSweeper,
} from './annotate.js';
import { AnnotateClient, annotateConfigFailure, resolveAnnotateConfig } from '@prs/github-annotate';
import { startSequenceWorkRunner, type SequenceWorkRunner } from './sequence-work-runner.js';
import { startSequenceMetadataCleanup, type MetadataCleanup } from './sequence-metadata-cleanup.js';
import { statSync } from 'node:fs';
import {
  runReferenceRebuild,
  startLinkWorker,
  startReferenceRebuildRunner,
  type LinkDeps,
  type LinkLogFields,
  type RebuildCursor,
  type RebuildResult,
  type RebuildRunner,
} from './link.js';
import { applyRepositoryTeams, createEsClient } from '@prs/es';
import {
  startReindexRunner,
  startRetentionSweeper,
  type ReindexDeps,
  type ReindexRunner,
  type RetentionSweeper,
} from './reindex.js';
import type { Subscription } from '@prs/bus';
import type { ReleaseSummary } from '@prs/github';
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
let orgTeamSweeper: OrgTeamSweeper | undefined;
let mirrorRunner: MirrorRunner | undefined;
/** JOB-MIR-002 (WP-067 / CR-038). 미러 역할이 함께 세운다. */
let commitEnrichSubscription: Subscription | undefined;
let commitEnrichSweeper: CommitEnrichSweeper | undefined;
let sequenceSubscription: Subscription | undefined;
/** WP-074: durable work 러너·M 힌트 구독·관측 루프. sequence 역할이 세운다. */
let sequenceWorkRunner: SequenceWorkRunner | undefined;
let mnumberHintSubscription: Subscription | undefined;
let mnumberObserver: { stop(): Promise<void> } | undefined;
/** WP-074: 운영 메타데이터 정리. batch 역할이 세운다. */
let sequenceMetadataCleanup: MetadataCleanup | undefined;
let esClient: Client | undefined;
/** JOB-ING-006 (WP-035 / CR-045). `batch` 역할이 세운다. */
let reindexRunner: ReindexRunner | undefined;
let exportRunner: ReturnType<typeof startExportRunner> | undefined;
let retentionSweeper: RetentionSweeper | undefined;
/** JOB-AUD-001 (WP-039 / CR-054). `batch` 역할이 세우되 관리 연결이 있어야 한다. */
let adminPool: Pool | undefined;
let partitionRetention: RetentionRunner | undefined;

if (roles.includes('batch')) {
  relay = startOutboxRelay(pool, bus, {
    log: (entry) => {
      process.stdout.write(`${JSON.stringify({ service: SERVICE_NAME, job: 'JOB-ING-007', ...entry })}\n`);
    },
  });

  /*
   * JOB-ING-006 무중단 재색인 (WP-035 / FR-ING-008).
   *
   * 간선 재구축은 **JOB-REL-006의 경로를 그대로 쓴다** — 두 번째 파생 알고리즘을
   * 만들지 않는다 (DEV-295). 그래서 여기서 링크 파생 deps를 세워 포트로 넘긴다.
   */
  const reindexEs = createEsClient();
  esClient = esClient ?? reindexEs;
  const reindexLog = (entry: Record<string, unknown>): void => {
    process.stdout.write(`${JSON.stringify({ service: SERVICE_NAME, job: 'JOB-ING-006', ...entry })}\n`);
  };
  const reindexLinkDeps: LinkDeps = {
    pool,
    es: reindexEs,
    bus,
    metrics,
    gheHost: resolveGitHubConfig().baseUrl,
    log: (entry) => { reindexLog({ ...entry }); },
  };

  const reindexDeps: ReindexDeps = {
    pool,
    es: reindexEs,
    log: (entry) => { reindexLog({ ...entry }); },
    /*
     * 재색인 뒤 M 복구 의도를 남길지 (WP-074 / DEV-605·DEV-607·DEV-608).
     *
     * **이 한 값만 읽는다.** `resolveMergeNumberConfig()`는 `MNUMBER_BATCH_SIZE`·
     * `MNUMBER_POLL_MS` 같은 **채번 전용 값까지 검증하고 범위를 벗어나면 던진다.**
     * 그것을 여기서 부르면 채번과 무관한 `batch` 역할이 채번 설정 때문에 기동하지
     * 못한다 — 정리·보존·재색인이 함께 죽는다. 그 검증은 그 값을 실제로 쓰는
     * `sequence` 역할의 몫이다.
     *
     * **판정을 여기서 다시 쓰지 않는다.** `resolveMergeNumberConfig`도 같은 함수를
     * 부르므로 두 역할이 같은 값에 다른 답을 낼 수 없다 (DEV-608).
     */
    mergeNumberEnabled: resolveMergeNumberEnabled(),
    links: {
      async rebuildRepository(repository) {
        let cursor: RebuildCursor | undefined;
        let processed = 0;
        for (;;) {
          const result: RebuildResult = await runReferenceRebuild(reindexLinkDeps, repository, cursor);
          processed += result.processed;
          cursor = result.cursor;
          if (result.done) break;
        }
        return processed;
      },
    },
  };

  reindexRunner = startReindexRunner(reindexDeps);
  exportRunner = startExportRunner({ pool, es: reindexEs, log: reindexLog });
  retentionSweeper = startRetentionSweeper(reindexDeps);

  /*
   * WP-074 운영 메타데이터 정리 (상세 설계 6.3 · 6.4). 완료된 refresh/announce work와
   * 30일 지난 지연 표본만 1000행씩 지운다. 기존 보존 잡·범용 job API를 확장하지 않는다.
   */
  sequenceMetadataCleanup = startSequenceMetadataCleanup({
    pool,
    log: (entry) => {
      process.stdout.write(`${JSON.stringify({ service: SERVICE_NAME, job: 'JOB-SEQ-004', component: 'cleanup', ...entry })}\n`);
    },
  });

  /*
   * JOB-AUD-001 파티션 수명 (WP-039 / FR-ING-003 AC-5, NFR-006, CR-054).
   *
   * **관리 연결이 없으면 이 잡만 서지 않는다.** 기동을 거부하지 않는 이유는
   * `BACKFILL_MAX_CONCURRENCY`와 같다 — 설정 하나가 없어서 워커 전체가 뜨지
   * 않으면 실시간 수집까지 함께 죽는다. 대신 **없다는 사실을 로그로 드러낸다**:
   * 조용히 넘어가면 세 달 뒤 파티션이 소진될 때까지 아무도 모른다.
   */
  const admin = createAdminPool();
  if (admin === null) {
    process.stderr.write(
      `${JSON.stringify({
        service: SERVICE_NAME,
        job: 'JOB-AUD-001',
        level: 'warn',
        message:
          'ADMIN_DATABASE_URL이 없어 파티션 수명 잡을 세우지 않는다 — 다가올 파티션이 소진되면 raw_event·audit_record의 INSERT가 거부된다',
      })}\n`,
    );
  } else {
    adminPool = admin;
    partitionRetention = startRetentionRunner({
      admin,
      pool,
      log: (entry) => {
        process.stdout.write(`${JSON.stringify({ service: SERVICE_NAME, ...entry })}\n`);
      },
    });
  }
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

let consistencySweeper: ConsistencySweeper | undefined;

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

  /*
   * JOB-ING-008 PG↔ES 정합성 감시 (WP-028 / ADR-004). 투영 역할이 소유한다 —
   * 투영이 만든 것을 투영이 검산한다.
   *
   * **ES에만 있는 잉여 문서는 지우지 않는다** (CR-033, DEV-174). 보고만 하고,
   * 되돌릴 수 있는 방향(정본에 있고 색인에 없음)만 조치 대상이다.
   */
  consistencySweeper = startConsistencySweeper({
    pool,
    es: esClient,
    metrics,
    log: (fields) => {
      process.stdout.write(`${JSON.stringify({ service: SERVICE_NAME, job: 'JOB-ING-008', ...fields })}\n`);
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

  /*
   * JOB-MIR-002 커밋 메타데이터 보강 (WP-067 / CR-038).
   *
   * **미러 역할이 소유한다** — 이 잡의 정답지가 미러이고, 새 역할을 만들면 미러
   * 볼륨을 두 곳에 붙여야 한다. 다만 미러가 없는 저장소는 API 폴백으로 돈다
   * (ADR-005).
   *
   * `prs:projected`를 **전용 소비자 그룹**으로 구독한다 (DEV-205) — 관계 파생과
   * 같은 그룹을 쓰면 이벤트가 둘로 나뉘어 각자 절반씩만 본다.
   */
  const enrichEs = createEsClient();
  esClient = esClient ?? enrichEs;
  const enrichLog = (fields: Record<string, unknown>): void => {
    process.stdout.write(`${JSON.stringify({ service: SERVICE_NAME, job: 'JOB-MIR-002', ...fields })}\n`);
  };
  const enrichMirrorGraph = new MirrorCommitGraph({
    root: mirrorConfig.root,
    repositoryIdOf: async (ref) =>
      (await repositoryRepo.findRepositoryBySlug(pool, ref.owner, ref.repo))?.repository_id,
    allowBlobFetch: mirrorConfig.allowBlobFetch,
    ...(mirrorTokenFor === undefined ? {} : { tokenFor: mirrorTokenFor }),
  });
  /*
   * 미러가 없는 저장소의 폴백 (ADR-005). 자격 증명이 없으면 API 그래프를 만들 수
   * 없으므로 미러만으로 돈다 — 미러도 없는 저장소는 보강되지 않고 그 사실이
   * `commit_enrich_total{result="not_found"}`로 보인다.
   */
  const enrichApiGraph =
    hasAppCredentials(ghConfig) && parseInstallations().length > 0
      ? new ApiCommitGraph({
          client: new GitHubClient(
            new GitHubTransport({
              apiUrl: ghConfig.apiUrl,
              requestTimeoutMs: ghConfig.requestTimeoutMs,
              pool: new TokenPool(
                new InstallationTokenProvider({
                  apiUrl: ghConfig.apiUrl,
                  appId: ghConfig.appId,
                  privateKey: ghConfig.privateKey,
                  refreshLeadMs: ghConfig.tokenRefreshLeadMs,
                  requestTimeoutMs: ghConfig.requestTimeoutMs,
                }),
                { installations: parseInstallations(), quarantineThreshold: ghConfig.quarantineThreshold },
              ),
              scheduler: new RequestScheduler({ maxConcurrent: ghConfig.maxConcurrentRequests }),
            }),
          ),
          priority: 'backfill',
        })
      : undefined;

  const enrichDeps: CommitEnrichDeps = {
    pool,
    es: enrichEs,
    bus,
    metrics,
    /*
     * **미러를 폴백으로 감싼다** (ADR-005 / PR #42 리뷰). `selectCommitGraph`에
     * 미러를 맨몸으로 넘기면 미러 디렉터리가 없거나 fetch가 깨졌을 때 폴백이 아예
     * 돌지 않는다 — `readCommit`이 던지지 않고 `null`을 돌려주기 때문이다. 시퀀스
     * 역할이 하는 것과 같은 형태로 감싼다.
     */
    graphFor: (repository) =>
      enrichApiGraph === undefined
        ? enrichMirrorGraph
        : selectCommitGraph(repository, {
            mirror: new FallbackCommitGraph(enrichMirrorGraph, enrichApiGraph, (error) => {
              enrichLog({
                level: 'warn',
                message: '미러 조회가 실패해 API로 넘어갔다 — 계속되면 미러가 죽어 있다는 뜻이다',
                repository_id: repository.repository_id,
                reason: 'graph_fallback',
                detail: String(error instanceof Error ? error.message : error).slice(0, 200),
              });
            }),
            api: enrichApiGraph,
          }),
    log: (fields) => { enrichLog({ ...fields }); },
  };

  commitEnrichSubscription = await startCommitEnrichWorker(enrichDeps);
  commitEnrichSweeper = startCommitEnrichSweeper(enrichDeps);
}

let integritySweeper: IntegritySweeper | undefined;
let repairRunner: RepairRunner | undefined;
/** JOB-SEQ-001 수동 채번 러너 (WP-040 / CR-055). 재채번 러너와 같은 역할에 선다. */
let assignRunner: AssignRunner | undefined;

if (roles.includes('sequence')) {
  /*
   * JOB-SEQ-001 (WP-021). **이 제품의 핵심 값이 여기서 만들어진다.**
   *
   * 그래프는 저장소별로 고른다 (`selectCommitGraph`, ADR-005). 미러가 켜진
   * 저장소는 미러를 쓰되 실패하면 API로 넘어가고(`FallbackCommitGraph`), 그
   * 전환은 **조용히 넘어가지 않고** 로그로 드러난다 — 폴백이 계속되면 미러가
   * 죽어 있다는 뜻이다.
   */
  const seqMirrorConfig = resolveMirrorConfig();
  const seqGhConfig = resolveGitHubConfig();
  const seqEs = createEsClient();

  const seqTokenPool = new TokenPool(
    new InstallationTokenProvider({
      apiUrl: seqGhConfig.apiUrl,
      appId: seqGhConfig.appId,
      privateKey: seqGhConfig.privateKey,
      refreshLeadMs: seqGhConfig.tokenRefreshLeadMs,
      requestTimeoutMs: seqGhConfig.requestTimeoutMs,
    }),
    { installations: parseInstallations(), quarantineThreshold: seqGhConfig.quarantineThreshold },
  );
  const apiGraph = new ApiCommitGraph({
    client: new GitHubClient(
      new GitHubTransport({
        apiUrl: seqGhConfig.apiUrl,
        requestTimeoutMs: seqGhConfig.requestTimeoutMs,
        pool: seqTokenPool,
        scheduler: new RequestScheduler({ maxConcurrent: seqGhConfig.maxConcurrentRequests }),
      }),
    ),
    priority: 'realtime',
  });
  const mirrorGraph = new MirrorCommitGraph({
    root: seqMirrorConfig.root,
    repositoryIdOf: async (ref) =>
      (await repositoryRepo.findRepositoryBySlug(pool, ref.owner, ref.repo))?.repository_id,
    allowBlobFetch: seqMirrorConfig.allowBlobFetch,
    tokenFor: async (org: string): Promise<string | null> => {
      try {
        return (await seqTokenPool.lease(org)).token.token;
      } catch {
        // 토큰을 못 얻으면 자격 증명 없이 시도한다. 공개 저장소는 그래도 된다.
        return null;
      }
    },
  });

  const seqLog = (entry: SequenceLogFields): void => {
    process.stdout.write(`${JSON.stringify({ service: SERVICE_NAME, job: 'JOB-SEQ-001', ...entry })}\n`);
  };

  /*
   * 채번 전 미러 최신화 (WP-074 / CR-079, DEV-576).
   *
   * **mirror 모드는 미러 볼륨이 실재해야 기동한다.** 없는데 조용히 API로 바꾸면
   * "설정은 mirror인데 왜 API로 도나"를 아무도 답할 수 없다 (`selectCommitGraph`의 규율).
   * `repository.mirror_enabled = false`인 저장소는 어느 모드에서도 API 경로다.
   */
  const graphMode = resolveSequenceGraphMode();
  let seqMirrorSync: MirrorSync | undefined;
  if (graphMode === 'mirror') {
    let isDirectory = false;
    try {
      isDirectory = statSync(seqMirrorConfig.root).isDirectory();
    } catch {
      isDirectory = false;
    }
    if (!isDirectory) {
      throw new Error(
        `SEQUENCE_GRAPH_MODE=mirror인데 미러 볼륨이 없다: ${seqMirrorConfig.root} — 볼륨을 마운트하거나 SEQUENCE_GRAPH_MODE=api로 명시한다 (WP-074)`,
      );
    }
    seqMirrorSync = new MirrorSync({
      root: seqMirrorConfig.root,
      remoteUrl: (ref) => `${seqGhConfig.baseUrl}/${ref.owner}/${ref.repo}.git`,
      allowBlobFetch: seqMirrorConfig.allowBlobFetch,
      tokenFor: async (org: string): Promise<string | null> => {
        try {
          return (await seqTokenPool.lease(org)).token.token;
        } catch {
          return null;
        }
      },
    });
  }
  seqLog({ level: 'info', message: 'sequence 그래프 모드', mode: graphMode, mirror_root: graphMode === 'mirror' ? seqMirrorConfig.root : null });

  /*
   * 채번 소비자와 수동 복구 러너가 **같은 의존**을 쓴다 (CR-034, DEV-178).
   * 둘이 각자 그래프를 만들면 한쪽만 미러를 쓰는 날이 온다.
   */
  const sequenceDeps: SequenceDeps = {
    pool,
    es: seqEs,
    bus,
    metrics,
    requestReleaseRefresh: async (repositoryId: number, correlationId: string): Promise<void> => {
      await bus.publish(TOPICS.release, String(repositoryId), {
        event_id: deterministicEventId('release.refresh_requested', String(repositoryId), correlationId),
        event_name: 'release.refresh_requested',
        correlation_id: correlationId,
        occurred_at: new Date().toISOString(),
        payload: { repository_id: repositoryId, correlation_id: correlationId },
      });
    },
    graphFor: (repository) =>
      /*
       * API 모드에서는 미러 그래프를 만들지 않는다 — 로컬 캐시의 존재를 가정하지 않는다
       * (Profile B, 상세 설계 4.1의 4). mirror 모드는 기존대로 미러 우선·API 폴백이다.
       */
      graphMode === 'api'
        ? apiGraph
        : selectCommitGraph(repository, {
            mirror: new FallbackCommitGraph(mirrorGraph, apiGraph, (error) => {
              seqLog({
                level: 'warn',
                message: '미러 조회가 실패해 API로 넘어갔다 — 계속되면 미러가 죽어 있다는 뜻이다',
                repository: repository.repository_id,
                reason: 'graph_fallback',
                detail: String(error instanceof Error ? error.message : error).slice(0, 200),
              });
            }),
            api: apiGraph,
          }),
    log: seqLog,
    freshness: {
      pool,
      mode: graphMode,
      ...(seqMirrorSync === undefined ? {} : { sync: seqMirrorSync }),
      log: seqLog,
    },
  };

  sequenceSubscription = await startSequenceWorker(sequenceDeps);

  /*
   * JOB-SEQ-004 M 번호 채번 (WP-074 / CR-077 · CR-079, ADR-023).
   *
   * **durable 러너가 정상 경로다.** push 의도(refresh)는 M 기능과 무관하게 여기서
   * 처리되어 DEV-576을 닫는다. M 기능(`MNUMBER_ENABLED`)이 켜져 있을 때만 reconcile·
   * materialize·announce를 집는다. 버스 구독(`link:mnumber`)은 힌트일 뿐이며 발행 전
   * crash는 DB의 work가 복구한다 (상세 설계 5.2).
   *
   * 근거 출처는 채번과 같은 자격이다. 자격이 없으면 GHE 상세를 읽지 못하므로 검증된
   * 스냅숏만 근거가 된다 (C7).
   */
  const mnumberConfig = resolveMergeNumberConfig();
  const mnumberLog = (entry: Record<string, unknown>): void => {
    process.stdout.write(`${JSON.stringify({ service: SERVICE_NAME, job: 'JOB-SEQ-004', ...entry })}\n`);
  };
  const seqHasCredentials = hasAppCredentials(seqGhConfig) && parseInstallations().length > 0;
  const mnumberDeps: MergeNumberDeps | null = mnumberConfig.enabled
    ? {
        pool,
        es: seqEs,
        bus,
        metrics,
        config: mnumberConfig,
        evidence: {
          pool,
          source: seqHasCredentials
            ? new GitHubClient(
                new GitHubTransport({
                  apiUrl: seqGhConfig.apiUrl,
                  requestTimeoutMs: seqGhConfig.requestTimeoutMs,
                  pool: seqTokenPool,
                  scheduler: new RequestScheduler({ maxConcurrent: seqGhConfig.maxConcurrentRequests }),
                }),
              )
            : null,
          graphFor: sequenceDeps.graphFor,
        },
        log: (fields) => { mnumberLog({ ...fields }); },
      }
    : null;
  mnumberLog({ level: 'info', message: mnumberConfig.enabled ? 'M 번호 채번 활성' : 'M 번호 채번 비활성 (MNUMBER_ENABLED=false) — push freshness는 그대로 돈다', evidence_source: seqHasCredentials ? 'pr_detail' : 'verified_snapshot' });

  sequenceWorkRunner = startSequenceWorkRunner({
    pool,
    sequence: sequenceDeps,
    mnumber: mnumberDeps,
    metrics,
    log: (fields) => { mnumberLog({ ...fields }); },
    pollMs: mnumberConfig.pollMs,
    retryMaxMs: mnumberConfig.retryMaxMs,
  });

  if (mnumberDeps !== null) {
    const runner = sequenceWorkRunner;
    mnumberHintSubscription = await startMergeNumberHintWorker({
      pool,
      bus,
      wake: () => runner.wake(),
      log: (fields) => { mnumberLog({ ...fields }); },
    });

    // 관측 루프: 번호가 실제 검색에서 보이는 시각을 남긴다 (상세 설계 7절). 실패는 번호를 되돌리지 않는다.
    let observerStopped = false;
    const observerLoop = (async (): Promise<void> => {
      while (!observerStopped) {
        try {
          await observeMergeNumberSamples(mnumberDeps);
        } catch (error) {
          mnumberLog({ level: 'warn', message: 'M 관측 회차 실패', reason: 'observe_failed', detail: String(error).slice(0, 200) });
        }
        await new Promise<void>((resolve) => { setTimeout(resolve, OBSERVE_POLL_MS); });
      }
    })();
    mnumberObserver = {
      async stop(): Promise<void> {
        observerStopped = true;
        await observerLoop;
      },
    };
  }

  // 기동 직후 한 번 세어 둔다. 세지 않으면 `stale` 공간이 있어도 게이지가 비어
  // 있고, 경보가 "값이 없음"과 "0"을 구분하지 못한다 (관측 문서 RB-10).
  void refreshSequenceSpaceStates({ pool, es: seqEs, bus, metrics, graphFor: () => apiGraph, log: seqLog });

  /*
   * JOB-SEQ-003 정합성 점검 (WP-028 / FR-ADMIN-003). 시퀀스 역할이 이미 갖고 있는
   * `graphFor`를 그대로 쓴다 — 대조의 정답지가 채번과 같은 그래프여야 한다.
   *
   * **점검은 공간 상태를 바꾸지 않는다** (CR-033, DEV-171). 실패는
   * `sequence_integrity_check_failed_total`로만 보인다.
   */
  integritySweeper = startIntegritySweeper({
    pool,
    metrics,
    graphFor: (repository) => selectCommitGraph(repository, { mirror: mirrorGraph, api: apiGraph }),
    log: (fields) => {
      process.stdout.write(`${JSON.stringify({ service: SERVICE_NAME, job: 'JOB-SEQ-003', ...fields })}\n`);
    },
  });

  /*
   * JOB-SEQ-002 수동 재채번 러너 (CR-034, DEV-178).
   *
   * API-ADM-007 POST가 만드는 `sequence_reassign` 잡을 **실제로 집는 곳**이다.
   * 이것이 없어서 운영자의 요청이 영구 `queued`로 남았고, `job_active_uk` 때문에
   * 같은 공간의 다음 요청까지 전부 거절됐다.
   *
   * 시퀀스 역할이 소유한다 — 공간 락(`trySequenceSpaceLock`)과 그래프가 이미
   * 여기 있고, 채번을 두 프로세스가 나눠 갖지 않는 편이 안전하다.
   */
  repairRunner = startSequenceRepairRunner({
    pool,
    sequence: sequenceDeps,
    log: (fields) => {
      process.stdout.write(`${JSON.stringify({ service: SERVICE_NAME, job: 'JOB-SEQ-002', ...fields })}\n`);
    },
  });

  /*
   * 수동 채번 러너 (JOB-SEQ-001 / WP-040, CR-055).
   *
   * **버스 소비자와 같은 역할에 선다.** 둘 다 `assignSequence`로 모이고 공간
   * 직렬은 그 함수의 advisory lock이 지키므로, 같은 프로세스에서 함께 깨어나도
   * 안전하다 — `JOB-ING-005`처럼 루프를 합칠 이유가 없는 것이 그 때문이다.
   *
   * **러너 없이 잡 유형만 여는 일을 하지 않았다** (FR-ADMIN-002 AC-6). 이
   * 러너와 `CREATABLE_GENERIC_JOB_TYPES`의 등재가 같은 변경에서 들어왔다.
   */
  assignRunner = startSequenceAssignRunner({
    pool,
    sequence: sequenceDeps,
    log: (fields) => {
      process.stdout.write(`${JSON.stringify({ service: SERVICE_NAME, job: 'JOB-SEQ-001', ...fields })}\n`);
    },
  });

  if (seqGhConfig.baseUrl === '') {
    seqLog({ level: 'warn', message: 'GHE base URL이 비어 있다 — API 폴백 경로가 동작하지 않는다' });
  }
}

let releaseSubscription: Awaited<ReturnType<typeof startReleaseWorker>> | undefined;
let releaseSweeper: ReleaseSweeper | undefined;
/**
 * 조정 스캔 역할 (JOB-ING-005 / CR-034, DEV-179).
 *
 * ## 왜 전용 역할인가
 *
 * `enrich`에 몰래 붙이지 않는다. 조정 스캔은 정기 정비 작업이라 **확장 축이
 * 실시간 소비자와 다르다** — 실시간은 이벤트 유량을 따라 늘리고, 정비는 저장소
 * 수를 따라 한 번씩 돈다. 같은 파드에 묶으면 실시간을 늘릴 때마다 주기 스윕이
 * 그 수만큼 중복 실행된다.
 *
 * `batch`라는 이름 하나에 서로 다른 의존 집합을 밀어 넣지도 않는다. 역할이 하나
 * 느는 편이 암묵적 조건부 실행보다 읽기 쉽다.
 *
 * ## 주기 스윕이 있는 역할은 replica 1이 기본이다
 *
 * 여러 파드가 같은 주기에 함께 돌면 같은 저장소를 동시에 조정한다. 되돌리기는
 * 멱등하지만 GHE 한도를 그만큼 더 쓴다. 수평 확장이 필요하면 claim 규칙을 먼저
 * 세운다 — 배포 문서에 그렇게 적었다.
 */
let reconcileSweeper: ReconcileSweeper | undefined;
/** JOB-ING-010 러너. 예약과 같은 역할에서 함께 선다 (CR-037, DEV-194). */
let snapshotBootstrapRunner: BackfillRunner | undefined;
let linkSubscription: Subscription | undefined;
let referenceRebuildRunner: RebuildRunner | undefined;

if (roles.includes('reconcile')) {
  const config = resolveGitHubConfig();
  const installations = parseInstallations();
  if (!hasAppCredentials(config) || installations.length === 0) {
    // 자격 증명 없이 켜면 매 주기가 인증 실패로 끝난다. 조용히 도는 것보다 낫다.
    throw new Error('reconcile 역할에는 GHE_APP_ID·GHE_APP_PRIVATE_KEY·GHE_INSTALLATIONS가 필요하다');
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
  const reconcileEs = createEsClient();
  esClient = esClient ?? reconcileEs;
  const reconcileLog = (entry: Record<string, unknown>): void => {
    process.stdout.write(`${JSON.stringify({ service: SERVICE_NAME, job: 'JOB-ING-005', ...entry })}\n`);
  };

  reconcileSweeper = startReconcileSweeper({
    pool,
    es: reconcileEs,
    client,
    bus,
    metrics,
    graphFor: () => new ApiCommitGraph({ client, priority: 'backfill' }),
    /*
     * 마이그레이션 이전 저장소의 팀 접근 범위를 메운다 (CR-036, DEV-190).
     * 등록 경로만으로는 다시 등록하기 전까지 빈 채로 남는다.
     */
    syncTeams: async (repository) => {
      await syncRepositoryTeamScope(
        {
          pool,
          index: {
            applyRepositoryTeams: (id, teamIds) =>
              withReindexWrite(pool, (targets) => applyRepositoryTeams(reconcileEs, id, teamIds, targets)),
          },
          source: {
            listRepositoryTeams: (owner, name) => client.listRepositoryTeams({ owner, repo: name }),
          },
          log: (entry) => { reconcileLog({ ...entry }); },
        },
        repository,
      );
    },
    /*
     * 정본 스냅숏 부트스트랩 예약 (JOB-ING-010 / CR-037, DEV-194). 마이그레이션
     * 010이 남긴 빈 표를 채우는 유일한 경로이며, 팀 접근 범위와 같은 이유로
     * 이미 저장소를 도는 정기 정비에 얹는다.
     */
    enqueueSnapshotBootstrap: () => enqueueSnapshotBootstrap(pool),
    // 되돌리기는 백필과 같은 경로다 (DEV-176) — 여기서 그 의존을 만든다.
    backfill: {
      pool,
      es: reconcileEs,
      client,
      snapshotSource: 'reconcile',
      log: (entry) => { reconcileLog({ ...entry }); },
    },
    log: (fields) => { reconcileLog({ ...fields }); },
  });

  /*
   * 예약만 하고 집는 러너가 없으면 잡 행이 영구 `queued`로 남고
   * `job_active_uk`가 이후 요청을 전부 막는다 — DEV-178·DEV-180이 같은 모양의
   * 결함이었다. 예약과 실행을 **같은 역할에서 함께** 세운다.
   */
  snapshotBootstrapRunner = startSnapshotBootstrapRunner({
    pool,
    es: reconcileEs,
    client,
    findRepository: async (target) => {
      const [owner, name] = target.split('/');
      if (owner === undefined || name === undefined) return undefined;
      return repositoryRepo.findRepositoryBySlug(pool, owner, name);
    },
    log: (entry) => { reconcileLog({ job: 'JOB-ING-010', ...entry }); },
  });
}

if (roles.includes('release')) {
  /*
   * JOB-REL-007 (WP-024 / CR-028). 태그의 정본은 미러이므로(DEV-143) 이 역할은
   * 미러 볼륨을 요구한다. GHE 자격 증명은 **선택**이다 — 없으면 `git_tag`
   * 소스만으로 돌고, 있으면 GitHub Release의 `published_at`이 시각을 덮는다.
   */
  const relMirrorConfig = resolveMirrorConfig();
  const relGhConfig = resolveGitHubConfig();
  const relEs = createEsClient();

  let relTokenFor: ((org: string) => Promise<string | null>) | undefined;
  let relListReleases: ((ref: { owner: string; repo: string }) => Promise<readonly ReleaseSummary[]>) | undefined;
  if (hasAppCredentials(relGhConfig) && parseInstallations().length > 0) {
    const relTokens = new TokenPool(
      new InstallationTokenProvider({
        apiUrl: relGhConfig.apiUrl,
        appId: relGhConfig.appId,
        privateKey: relGhConfig.privateKey,
        refreshLeadMs: relGhConfig.tokenRefreshLeadMs,
        requestTimeoutMs: relGhConfig.requestTimeoutMs,
      }),
      { installations: parseInstallations(), quarantineThreshold: relGhConfig.quarantineThreshold },
    );
    relTokenFor = async (org: string): Promise<string | null> => {
      try {
        return (await relTokens.lease(org)).token.token;
      } catch {
        return null;
      }
    };
    const relClient = new GitHubClient(
      new GitHubTransport({
        apiUrl: relGhConfig.apiUrl,
        requestTimeoutMs: relGhConfig.requestTimeoutMs,
        pool: relTokens,
        scheduler: new RequestScheduler({ maxConcurrent: relGhConfig.maxConcurrentRequests }),
      }),
    );
    relListReleases = async (ref) => relClient.listReleases(ref);
  }

  const relSync = new MirrorSync({
    root: relMirrorConfig.root,
    remoteUrl: (ref) => `${relGhConfig.baseUrl}/${ref.owner}/${ref.repo}.git`,
    allowBlobFetch: relMirrorConfig.allowBlobFetch,
    ...(relTokenFor === undefined ? {} : { tokenFor: relTokenFor }),
  });
  const relGraph = new MirrorCommitGraph({
    root: relMirrorConfig.root,
    repositoryIdOf: async (ref) =>
      (await repositoryRepo.findRepositoryBySlug(pool, ref.owner, ref.repo))?.repository_id,
    allowBlobFetch: relMirrorConfig.allowBlobFetch,
    ...(relTokenFor === undefined ? {} : { tokenFor: relTokenFor }),
  });

  const relLog = (entry: ReleaseLogFields): void => {
    process.stdout.write(`${JSON.stringify({ service: SERVICE_NAME, job: 'JOB-REL-007', ...entry })}\n`);
  };

  const releaseDeps = {
    pool,
    es: relEs,
    bus,
    metrics,
    // 미러 락 아래에서 fetch한다 (WP-074 / ADR-023 C1). 채번의 선행 fetch와 같은 디렉터리에 동시에 쓰지 않는다.
    sync: (ref: { owner: string; repo: string }, repositoryId: number) =>
      withMirrorLock(pool, repositoryId, () => relSync.sync(ref, repositoryId), { wait: true }),
    listTags: (ref: { owner: string; repo: string }) => relGraph.listTags(ref),
    ...(relListReleases === undefined ? {} : { listReleases: relListReleases }),
    log: relLog,
  };

  releaseSubscription = await startReleaseWorker(releaseDeps);
  releaseSweeper = startReleaseSweeper(releaseDeps);
}

if (roles.includes('link')) {
  /*
   * JOB-REL-001·005·006 (WP-029 / CR-039).
   *
   * **파생의 정본은 PostgreSQL이다** — `pull_request_snapshot.document`와
   * `commit_snapshot.message`. Elasticsearch 현재 문서를 파생의 근거로 읽지
   * 않는다 (ADR-004). 그래서 이 역할에는 GHE 자격 증명이 필요 없다.
   *
   * **기본 소비자 그룹 `link`를 쓴다.** 이름을 바꾸면 Redis에서 읽던 자리를
   * 잃는다 (CR-038, DEV-205). 커밋 보강은 `link:commit-enrich`라는 다른 group이라
   * 두 소비자가 같은 이벤트를 각각 전부 받는다.
   */
  esClient ??= createEsClient();
  const linkDeps = {
    pool,
    es: esClient,
    bus,
    metrics,
    /*
     * URL 참조는 **승인된 GHE 호스트만** 인정한다 (THR-036). 구성이 없으면
     * URL 참조를 만들지 않는다 — 검증할 근거가 없는 상태에서 외부가 심은
     * 문자열을 내부 대상으로 해석하지 않는다.
     */
    gheHost: resolveGitHubConfig().baseUrl,
    log: (entry: LinkLogFields) => {
      process.stdout.write(`${JSON.stringify({ service: SERVICE_NAME, ...entry })}\n`);
    },
  };

  linkSubscription = await startLinkWorker(linkDeps);

  /*
   * JOB-REL-006 전량 재파생 (DEV-221).
   *
   * Redis stream backlog는 마이그레이션 보장이 아니다 — retention이 정본이 아니고,
   * WP-029 이전의 직접 푸시 커밋에는 애초에 `EVT-ING-003`이 없었다. 이 러너가
   * 없으면 배포 뒤 "새 이벤트부터만 관계가 생긴다"가 운영 구멍으로 남는다.
   */
  referenceRebuildRunner = startReferenceRebuildRunner(linkDeps);
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
    /*
     * 팀 변경을 색인에 소급 적용한다 (WP-068 / CR-035, DEV-187).
     *
     * 권한 캐시 무효화와 **같은 사건에서 함께** 돈다 — 강제 필터는 문서에
     * 박힌 `allowed_team_ids`를 보므로, 캐시만 지우고 문서를 두면 팀에서 빠진
     * 사용자가 과거 문서를 계속 본다.
     */
    /*
     * 팀 변경을 색인에 소급 적용한다 (WP-068 / CR-035 DEV-187, CR-036 DEV-188).
     *
     * **GHE에서 다시 읽는다.** 첫 구현은 PostgreSQL에 이미 있는 값을 색인에 다시
     * 썼는데, 회수 사건에서 그 값은 **아직 제거된 팀을 담고 있어** 회수가 반영되지
     * 않았다 — 옛 구성원이 문서를 계속 보는 유출이다. 추가 사건에서는 저장소가
     * 아직 그 팀을 갖고 있지 않아 역조회로 대상을 찾지도 못했다.
     *
     * 그래서 웹훅의 `repository_id`를 함께 받고, 판정은 공유 구현에 맡긴다.
     */
    refreshRepositoryTeams: async (teamId: number, repositoryId: number | null): Promise<number> => {
      if (authzGithub === undefined) return 0;
      const authzEs = (esClient = esClient ?? createEsClient());
      const teamScopeDeps: TeamScopeDeps = {
          pool,
          index: {
            applyRepositoryTeams: (id, teamIds) =>
              withReindexWrite(pool, (targets) => applyRepositoryTeams(authzEs, id, teamIds, targets)),
          },
          source: {
            listRepositoryTeams: (owner, name) =>
              authzGithub.listRepositoryTeams({ owner, repo: name }),
          },
          log: (entry) => {
            process.stdout.write(
              `${JSON.stringify({ service: SERVICE_NAME, job: 'JOB-AUTH-001', ...entry })}\n`,
            );
          },
      };
      const outcomes = await refreshTeamScope(teamScopeDeps, { teamId, repositoryId });
      return outcomes.reduce((sum, outcome) => sum + outcome.documentsRefreshed, 0);
    },
    log: (entry: AuthzLogEntry) => {
      process.stdout.write(`${JSON.stringify({ service: SERVICE_NAME, job: 'JOB-AUTH-001', ...entry })}\n`);
    },
  });

  /*
   * 작성자 소속 팀 스윕 (WP-069 / CR-058).
   *
   * **이 역할이 소유한다.** 팀 데이터를 이미 소유하고 GHE 자격을 쥐고 있으며
   * 배포되어 있다 — 새 역할을 만들면 `DEV-304`·`DEV-305`가 기록한 "코드에는
   * 있으나 배포되지 않는 역할"을 하나 더 만드는 일이 된다.
   *
   * `refreshTeamMembers`와 **다른 것을 채운다.** 그쪽은 `team_member`(로그인한
   * PR Search 사용자)를 팀 이벤트마다 갱신하고, 이쪽은 `team_membership`(GHE
   * 사용자)을 조직 단위로 훑는다. 둘의 뜻이 다르므로 표도 다르다 (DEV-482).
   *
   * 자격이 없으면 스윕이 돌지 않는다 — 그때 작성자 팀은 언제나 모름이고, 위의
   * 경고가 그 사실을 이미 말한다.
   */
  if (authzGithub !== undefined) {
    orgTeamSweeper = startOrgTeamSweeper({
      pool,
      github: authzGithub,
      listOrgs: () => repositoryRepo.listRegisteredOrgs(pool),
      log: (entry) => {
        process.stdout.write(
          `${JSON.stringify({ service: SERVICE_NAME, job: 'JOB-AUTH-001', component: 'org-team-sweep', ...entry })}\n`,
        );
      },
    });
  }
}

let annotateSubscription: Subscription | undefined;
let annotateSweeper: AnnotateSweeper | undefined;
if (roles.includes('annotate')) {
  /*
   * JOB-SEQ-005 (WP-075 / FR-SEQ-009, ADR-022).
   *
   * **GHE 쓰기 자격을 가진 유일한 역할이다.** 조회 역할과 같은 프로세스에 두지
   * 않는 이유는 자격이 한 프로세스에 함께 있으면 분리가 배포가 아니라 약속이
   * 되기 때문이다 (ADR-022 결정 1). 자격도 `resolveAnnotateConfig`가 표기 전용
   * 변수에서만 읽으며 조회용 `GHE_APP_*`은 이 블록에 등장하지 않는다.
   */
  const annotateConfig = resolveAnnotateConfig();
  const annotateLog = (entry: AnnotateLogFields): void => {
    process.stdout.write(`${JSON.stringify({ service: SERVICE_NAME, job: 'JOB-SEQ-005', ...entry })}\n`);
  };

  if (!annotateConfig.enabled) {
    /*
     * **기본값이 꺼짐이다.** 역할이 배포돼 있어도 전역 스위치가 열리기 전에는
     * 아무것도 쓰지 않는다 — 이 코드를 받는 것만으로 남의 PR 제목이 바뀌어서는
     * 안 된다. 구독도 걸지 않으므로 소비자 그룹조차 만들지 않는다.
     */
    annotateLog({
      level: 'info',
      message: '표기가 꺼져 있다 — GHE에 아무것도 쓰지 않는다',
      reason: 'MNUMBER_ANNOTATE_ENABLED=false',
    });
  } else {
    /*
     * 켜 놓고 자격이 없는 배포는 **쓰기를 시도하기 전에** 멈춘다 (CR-078이 세운
     * 규율). 조용히 꺼진 채 돌면 운영자가 켰다고 믿는 쓰기가 일어나지 않고
     * 그것을 알아챌 신호도 없다.
     */
    const failure = annotateConfigFailure(annotateConfig);
    if (failure !== null) throw new Error(`${failure} (WP-075 / JOB-SEQ-005)`);

    const annotateDeps: AnnotateDeps = {
      pool,
      bus,
      config: annotateConfig,
      metrics,
      log: annotateLog,
      client: new AnnotateClient({
        config: annotateConfig,
        onResponse: (event) => {
          // 토큰도 제목도 넘기지 않는다. 남기는 것은 어느 경로가 무엇을 답했는지뿐이다.
          annotateLog({
            level: 'info',
            message: 'GHE 표기 요청',
            method: event.method,
            repository: `${event.owner}/${event.repo}`,
            pull_request_number: event.pullRequestNumber,
            status: event.status,
            duration_ms: event.durationMs,
          });
        },
      }),
    };

    annotateSubscription = await startAnnotateWorker(annotateDeps);
    annotateSweeper = startAnnotateSweeper(annotateDeps);
    annotateLog({
      level: 'info',
      message: '표기를 시작한다',
      installations: annotateConfig.installations.length,
      sweep_interval_ms: annotateConfig.sweepIntervalMs,
    });
  }
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
      await reindexRunner?.stop();
      await exportRunner?.stop();
      await retentionSweeper?.stop();
      // JOB-AUD-001은 회차 중간에 끊어도 안전하다 — 파티션 드롭은 개별
      // 트랜잭션이고 다음 기동이 멱등하게 이어받는다.
      await partitionRetention?.stop();
      await adminPool?.end();
      /*
       * 러너는 **현재 페이지를 마치고** 나간다. 중간에 끊으면 커서가 가리키는
       * 지점과 실제 처리 지점이 어긋나 재개가 처리하지 않은 PR을 건너뛴다.
       */
      await backfillRunner?.stop();
      await orgTeamSweeper?.stop();
      await mirrorRunner?.stop();
      await commitEnrichSweeper?.stop();
      await commitEnrichSubscription?.close();
      await enrichSubscription?.close();
      await projectSubscription?.close();
      /*
       * WP-074: 새 claim을 멈추고 진행 중 회차를 끝낸다. lease는 회수하지 않는다 —
       * 미완료로 남은 lease는 만료 뒤 다른 프로세스가 회수한다 (상세 설계 10절).
       */
      await sequenceWorkRunner?.stop();
      await mnumberObserver?.stop();
      await mnumberHintSubscription?.close();
      await sequenceMetadataCleanup?.stop();
      await sequenceSubscription?.close();
      await releaseSubscription?.close();
      await releaseSweeper?.stop();
      await integritySweeper?.stop();
      await consistencySweeper?.stop();
      await reconcileSweeper?.stop();
      await snapshotBootstrapRunner?.stop();
      await referenceRebuildRunner?.stop();
      await linkSubscription?.close();
      await repairRunner?.stop();
      await assignRunner?.stop();
      await authzSubscription?.close();
      /*
       * WP-075: 진행 중인 표기 회차를 마치고 나간다. PATCH 뒤 정본 갱신 전에
       * 끊기면 그 행은 다음 회차가 제목을 다시 읽어 호출 없이 복구한다.
       */
      await annotateSweeper?.stop();
      await annotateSubscription?.close();
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
