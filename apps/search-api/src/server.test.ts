import { describe, expect, it } from 'vitest';
import { buildServer, SERVICE_NAME } from './server.js';

describe(`${SERVICE_NAME} 헬스체크`, () => {
  it('GET /healthz가 200과 서비스 이름을 반환한다', async () => {
    const app = buildServer();
    try {
      const response = await app.inject({ method: 'GET', url: '/healthz' });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ status: 'ok', service: SERVICE_NAME });
    } finally {
      await app.close();
    }
  });
});
