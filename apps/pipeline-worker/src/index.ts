/**
 * pipeline-worker 프로세스 진입점.
 *
 * 시스템 아키텍처 4장대로 한 이미지에 여러 역할이 들어가고, 환경 변수
 * `PIPELINE_WORKER_ROLES`가 이 프로세스가 맡을 역할을 정한다. WP-005가 채우는
 * 역할은 `batch`의 아웃박스 재적재(JOB-ING-007) 하나뿐이다 — 실제 소비 역할
 * (`enrich`, `project`, `sequence`, `link`)은 WP-007 이후가 채운다.
 */

import { createPool } from '@prs/db';
import { RedisStreamsEventBus } from '@prs/bus';
import { buildServer, DEFAULT_PORT, SERVICE_NAME } from './server.js';
import { startOutboxRelay, type OutboxRelay } from './outbox-relay.js';

const port = Number(process.env['PIPELINE_WORKER_PORT'] ?? DEFAULT_PORT);
const roles = (process.env['PIPELINE_WORKER_ROLES'] ?? 'batch')
  .split(',')
  .map((role) => role.trim())
  .filter((role) => role !== '');

const server = buildServer();
server.listen(port, '0.0.0.0', () => {
  process.stdout.write(`${SERVICE_NAME} listening on ${String(port)} (roles: ${roles.join(',')})\n`);
});

const pool = createPool();
const bus = new RedisStreamsEventBus();
let relay: OutboxRelay | undefined;

if (roles.includes('batch')) {
  relay = startOutboxRelay(pool, bus, {
    log: (entry) => {
      process.stdout.write(`${JSON.stringify({ service: SERVICE_NAME, job: 'JOB-ING-007', ...entry })}\n`);
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
      await bus.close();
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
