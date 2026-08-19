import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { buildServer, SERVICE_NAME } from './server.js';

describe(`${SERVICE_NAME} 헬스체크`, () => {
  it('GET /healthz가 200과 서비스 이름을 반환한다', async () => {
    const server = buildServer();
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');

    try {
      const { port } = server.address() as AddressInfo;
      const response = await fetch(`http://127.0.0.1:${String(port)}/healthz`);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ status: 'ok', service: SERVICE_NAME });
    } finally {
      server.close();
      await once(server, 'close');
    }
  });

  it('정의되지 않은 경로는 404다', async () => {
    const server = buildServer();
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');

    try {
      const { port } = server.address() as AddressInfo;
      const response = await fetch(`http://127.0.0.1:${String(port)}/nope`);
      expect(response.status).toBe(404);
    } finally {
      server.close();
      await once(server, 'close');
    }
  });
});
