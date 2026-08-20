import { buildServer, DEFAULT_PORT, SERVICE_NAME } from './server.js';

const port = Number(process.env[`${SERVICE_NAME.toUpperCase().replaceAll('-', '_')}_PORT`] ?? DEFAULT_PORT);
const app = buildServer();

try {
  await app.listen({ port, host: '0.0.0.0' });
  process.stdout.write(`${SERVICE_NAME} listening on ${String(port)}\n`);
} catch (error) {
  process.stderr.write(`${SERVICE_NAME} failed to start: ${String(error)}\n`);
  process.exit(1);
}

const shutdown = (): void => {
  void app.close().then(() => process.exit(0));
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
