/**
 * ingest-gateway 프로세스 진입점.
 *
 * 종료는 유예를 두고 한다 (WP-004: graceful shutdown 30초). 수신 도중 프로세스가
 * 사라지면 GHE는 202를 받지 못한 채로 재전송하지만, 그 사이 저장이 반쯤 끝났을
 * 수 있다. 진행 중인 요청을 마치고 나가는 편이 재전송·중복 판정 모두에 낫다.
 */

import { createPool } from '@prs/db';
import { resolveGatewayConfig } from './config.js';
import { buildServer, createServerDeps, SERVICE_NAME } from './server.js';

const config = resolveGatewayConfig();

if (config.webhookSecrets.length === 0) {
  // 시크릿이 없으면 모든 요청이 401이 된다. 조용히 뜨는 것보다 못 뜨는 게 낫다.
  process.stderr.write(`${SERVICE_NAME}: GHE_WEBHOOK_SECRET is not set\n`);
  process.exit(1);
}

const pool = createPool();
const deps = createServerDeps(pool, config);
const app = buildServer(deps);

try {
  await app.listen({ port: config.port, host: '0.0.0.0' });
  process.stdout.write(`${SERVICE_NAME} listening on ${String(config.port)}\n`);
} catch (error) {
  process.stderr.write(`${SERVICE_NAME} failed to start: ${String(error)}\n`);
  process.exit(1);
}

let shuttingDown = false;

const shutdown = (signal: string): void => {
  if (shuttingDown) return;
  shuttingDown = true;
  process.stdout.write(`${SERVICE_NAME} shutting down (${signal})\n`);

  const deadline = setTimeout(() => {
    process.stderr.write(`${SERVICE_NAME} shutdown grace expired\n`);
    process.exit(1);
  }, config.shutdownGraceMs);
  deadline.unref();

  void (async (): Promise<void> => {
    try {
      await app.close();
      await deps.archive.close();
      await pool.end();
    } catch (error) {
      process.stderr.write(`${SERVICE_NAME} shutdown error: ${String(error)}\n`);
    }
    clearTimeout(deadline);
    process.exit(0);
  })();
};

process.on('SIGTERM', () => {
  shutdown('SIGTERM');
});
process.on('SIGINT', () => {
  shutdown('SIGINT');
});
