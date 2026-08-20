import { createPool } from '@prs/db';
import { RedisStreamsEventBus } from '@prs/bus';
import { resolveSearchApiConfig } from './config.js';
import { buildServer, SERVICE_NAME } from './server.js';

const config = resolveSearchApiConfig();
const pool = createPool();
const bus = new RedisStreamsEventBus();

const app = buildServer({
  config,
  ops: {
    pool,
    bus,
    log: (entry) => process.stdout.write(`${JSON.stringify({ service: SERVICE_NAME, ...entry })}\n`),
  },
  log: (entry) => process.stdout.write(`${JSON.stringify({ service: SERVICE_NAME, ...entry })}\n`),
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
      await pool.end();
    })
    .then(() => process.exit(0));
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
