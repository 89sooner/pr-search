import { buildServer, DEFAULT_PORT, SERVICE_NAME } from './server.js';

const port = Number(process.env['PIPELINE_WORKER_PORT'] ?? DEFAULT_PORT);
const server = buildServer();

server.listen(port, '0.0.0.0', () => {
  process.stdout.write(`${SERVICE_NAME} listening on ${String(port)}\n`);
});

const shutdown = (): void => {
  server.close(() => process.exit(0));
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
