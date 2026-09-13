/**
 * gh-executor — GitHub Operations Plane의 실행 런타임 (ADR-013·ADR-016, JOB-GH-001, REL-007 R0).
 *
 * `search-api`·`pipeline-worker`는 `gh`를 띄우지 않는다. 이 프로세스만 한다.
 *
 * 기동 순서:
 *   1. 설정 — 켜져 있는데 필수 값이 없으면 거부한다.
 *   2. 고정 바이너리 대조 — `gh --version`이 고정 버전과 같고, 파일의 SHA-256이 고정 값과
 *      같아야 한다 (FR-GH-011 AC-1·AC-2). 다르면 **기동하지 않는다** — `execution_disabled`를
 *      조용히 진행하지 않는다 (AC-3).
 *   3. manifest 로드 — 해시가 내용과 맞아야 한다.
 *   4. 구독 — `prs:gh:executions`를 `GH_EXECUTOR_MAX_CONCURRENT`개의 구독으로 나눠 맡는다.
 *      구독 하나가 파티션 집합 하나를 맡으므로 동시 실행 수가 곧 구독 수다.
 *   5. 스윕 — 고아 회수·잔여 큐.
 *
 * 꺼져 있으면(`GH_OPERATIONS_ENABLED=false`) 헬스체크만 서고 아무것도 구독하지 않는다.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { RedisStreamsEventBus, TOPICS, allPartitions, consumerGroup, partitionCount, type Subscription, ack } from '@prs/bus';
import { createPool } from '@prs/db';
import { GH_PINNED_LINUX_AMD64, GH_PINNED_VERSION, type GhCapabilityManifest } from '@prs/gh-cli';
import { loadManifest, readGhVersion } from '@prs/gh-cli/node';
import { executorConfigFailure, resolveExecutorConfig } from './config.js';
import { createExecutorMetrics } from './metrics.js';
import { runExecution, type RunnerDeps, type RunnerLogEntry } from './runner.js';
import { buildServer, SERVICE_NAME } from './server.js';
import { startSweeper, type Sweeper } from './sweeper.js';

const config = resolveExecutorConfig();
const metrics = createExecutorMetrics();

const log = (entry: RunnerLogEntry | Record<string, unknown>): void => {
  process.stdout.write(`${JSON.stringify({ service: SERVICE_NAME, ...entry })}\n`);
};

const failure = executorConfigFailure(config);
if (failure !== null) {
  process.stderr.write(`${SERVICE_NAME}: ${failure} (REL-007 / WP-077)\n`);
  process.exit(1);
}

const pool = createPool();
let manifest: GhCapabilityManifest | null = null;
let ghVersion: string | null = null;
let bus: RedisStreamsEventBus | null = null;
const subscriptions: Subscription[] = [];
let sweeper: Sweeper | null = null;

if (!config.enabled) {
  log({ level: 'info', message: 'Operations 실행이 꺼져 있다 — gh를 띄우지 않고 구독도 걸지 않는다', reason: 'GH_OPERATIONS_ENABLED=false' });
} else {
  /*
   * 고정 바이너리 대조 (FR-GH-011). 버전 문자열만 믿지 않는다 — 같은 버전 문자열을 내는
   * 다른 빌드가 실릴 수 있으므로 파일 해시까지 본다.
   */
  ghVersion = readGhVersion(config.binaryPath);
  if (ghVersion !== GH_PINNED_VERSION) {
    process.stderr.write(`${SERVICE_NAME}: 설치된 gh ${ghVersion}가 고정 버전 ${GH_PINNED_VERSION}과 다르다 — execution_disabled (FR-GH-011 AC-3)\n`);
    process.exit(1);
  }
  const binaryHash = createHash('sha256').update(readFileSync(config.binaryPath)).digest('hex');
  if (binaryHash !== GH_PINNED_LINUX_AMD64.binarySha256) {
    process.stderr.write(`${SERVICE_NAME}: gh 바이너리의 SHA-256이 고정 값과 다르다 — execution_disabled (FR-GH-011 AC-1)\n`);
    process.exit(1);
  }
  manifest = loadManifest(GH_PINNED_VERSION);

  const vaultKey = config.vaultKey;
  if (vaultKey === null) throw new Error('unreachable: executorConfigFailure가 잡았어야 한다');
  const deps: RunnerDeps = { pool, config, manifest, vaultKey, metrics, log };

  bus = new RedisStreamsEventBus();
  const topic = TOPICS.ghExecutions;
  const group = consumerGroup(topic, 'gh-executor');
  const partitions = allPartitions(partitionCount(topic));
  const groups: number[][] = Array.from({ length: config.maxConcurrent }, () => []);
  partitions.forEach((partition, index) => groups[index % config.maxConcurrent]?.push(partition));

  for (const [index, owned] of groups.entries()) {
    if (owned.length === 0) continue;
    subscriptions.push(
      await bus.subscribe(
        topic,
        group,
        async (event) => {
          const payload = event.payload as { execution_id?: unknown };
          const executionId = typeof payload.execution_id === 'number' ? payload.execution_id : Number(payload.execution_id);
          if (!Number.isSafeInteger(executionId)) {
            log({ level: 'warn', message: '실행 ID가 없는 이벤트를 버린다', reason: 'payload_invalid' });
            return ack();
          }
          // 러너는 던지지 않는다. 결과가 무엇이든 이벤트는 처리된 것이다 — 재전달하면 같은 행을 다시 본다.
          await runExecution(deps, executionId);
          return ack();
        },
        {
          partitions: owned,
          consumer: `${config.executorId}-${String(index)}`,
          onError: (error) => {
            log({ level: 'error', message: '구독 오류', reason: error instanceof Error ? error.message : String(error) });
          },
        },
      ),
    );
  }
  sweeper = startSweeper(deps);
  log({
    level: 'info',
    message: 'Operations 실행이 켜졌다',
    gh_version: ghVersion,
    manifest_version: manifest.manifestVersion,
    manifest_hash: manifest.hash,
    subscriptions: subscriptions.length,
    executor_id: config.executorId,
  });
}

const server = buildServer({
  detail: () => ({
    execution: config.enabled ? 'enabled' : 'disabled',
    ghVersion,
    manifestVersion: manifest?.manifestVersion ?? null,
    manifestHash: manifest?.hash ?? null,
  }),
  checkBackingServices: async () => {
    await pool.query('SELECT 1');
  },
  metrics,
});

server.listen(config.port, '0.0.0.0', () => {
  process.stdout.write(`${SERVICE_NAME} listening on ${String(config.port)}\n`);
});

let shuttingDown = false;
const shutdown = (signal: string): void => {
  if (shuttingDown) return;
  shuttingDown = true;
  process.stdout.write(`${SERVICE_NAME} shutting down (${signal})\n`);
  const deadline = setTimeout(() => {
    process.stderr.write(`${SERVICE_NAME} shutdown grace expired\n`);
    process.exit(1);
  }, 45_000);
  deadline.unref();

  void (async (): Promise<void> => {
    try {
      server.close();
      await sweeper?.stop();
      // 진행 중인 실행이 끝날 때까지 구독을 닫는다 — 닫힌 뒤 도착한 이벤트는 다른 실행기가 집는다.
      await Promise.all(subscriptions.map((subscription) => subscription.close()));
      await bus?.close();
      await pool.end();
    } catch (error) {
      process.stderr.write(`${SERVICE_NAME} shutdown error: ${String(error)}\n`);
    }
    clearTimeout(deadline);
    process.exit(0);
  })();
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
