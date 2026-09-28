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

describe(`${SERVICE_NAME} 처리되지 않은 오류의 공통 처리 (CR-129 / DEV-786)`, () => {
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  const QUERY_TEXT = 'payments-outage-kim';

  function serverWithLog() {
    const entries: Record<string, unknown>[] = [];
    const app = buildServer({ log: (entry) => { entries.push({ ...entry }); } });
    return { app, entries };
  }

  it('경로가 던진 예외는 500 INTERNAL_ERROR 봉투와 correlation_id이고, 같은 ID로 진단을 남긴다', async () => {
    const { app, entries } = serverWithLog();
    app.get('/api/v1/boom', async () => {
      throw new TypeError(`cannot read properties of ${QUERY_TEXT}`);
    });
    try {
      const response = await app.inject({ method: 'GET', url: `/api/v1/boom?q=${QUERY_TEXT}` });
      expect(response.statusCode).toBe(500);
      const body = response.json<{ error: { code: string; message: string }; correlation_id: string }>();
      expect(body.error.code).toBe('INTERNAL_ERROR');
      expect(body.correlation_id).toMatch(UUID);
      expect(response.body).not.toContain(QUERY_TEXT);
      expect(response.body).not.toContain('TypeError');
      expect(response.body).not.toContain('statusCode');

      const logged = entries.filter((entry) => entry['event'] === 'http.unhandled_error');
      expect(logged).toHaveLength(1);
      expect(logged[0]).toMatchObject({
        level: 'error',
        correlation_id: body.correlation_id,
        method: 'GET',
        route: '/api/v1/boom',
        stage: 'handler',
        status: 500,
        error_name: 'TypeError',
        error_kind: 'application',
      });
      expect(JSON.stringify(logged[0])).not.toContain(QUERY_TEXT);
    } finally {
      await app.close();
    }
  });

  it('요청마다 다른 correlation ID이고, 앞단 헤더를 요청 식별자로 받지 않는다', async () => {
    const { app } = serverWithLog();
    app.get('/api/v1/boom', async () => {
      throw new Error('x');
    });
    try {
      const forged = '11111111-1111-4111-8111-111111111111';
      const first = await app.inject({ method: 'GET', url: '/api/v1/boom', headers: { 'request-id': forged, 'x-correlation-id': forged } });
      const second = await app.inject({ method: 'GET', url: '/api/v1/boom' });
      const a = first.json<{ correlation_id: string }>().correlation_id;
      const b = second.json<{ correlation_id: string }>().correlation_id;
      expect(a).toMatch(UUID);
      expect(a).not.toBe(forged);
      expect(a).not.toBe(b);
    } finally {
      await app.close();
    }
  });

  it('없는 경로는 404 NOT_FOUND 봉투다', async () => {
    const { app, entries } = serverWithLog();
    try {
      const response = await app.inject({ method: 'GET', url: '/api/v1/no-such-route' });
      expect(response.statusCode).toBe(404);
      const body = response.json<{ error: { code: string }; correlation_id: string }>();
      expect(body.error.code).toBe('NOT_FOUND');
      expect(body.correlation_id).toMatch(UUID);
      expect(entries.filter((entry) => typeof entry['event'] === 'string')).toHaveLength(0);
    } finally {
      await app.close();
    }
  });

  it('본문을 읽지 못한 요청은 그 상태의 계약 봉투다 — 400·415·413', async () => {
    const { app, entries } = serverWithLog();
    app.post('/api/v1/echo', async (request) => ({ ok: request.body !== undefined }));
    try {
      const invalid = await app.inject({ method: 'POST', url: '/api/v1/echo', headers: { 'content-type': 'application/json' }, payload: '{"broken":' });
      expect(invalid.statusCode).toBe(400);
      expect(invalid.json<{ error: { code: string } }>().error.code).toBe('INVALID_PARAMETER');

      const media = await app.inject({ method: 'POST', url: '/api/v1/echo', headers: { 'content-type': 'application/xml' }, payload: '<x/>' });
      expect(media.statusCode).toBe(415);
      expect(media.json<{ error: { code: string } }>().error.code).toBe('UNSUPPORTED_MEDIA_TYPE');

      const large = await app.inject({
        method: 'POST',
        url: '/api/v1/echo',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ blob: 'x'.repeat(1_100_000) }),
      });
      expect(large.statusCode).toBe(413);
      expect(large.json<{ error: { code: string } }>().error.code).toBe('PAYLOAD_TOO_LARGE');

      const warned = entries.filter((entry) => entry['event'] === 'http.client_error');
      expect(warned.map((entry) => [entry['status'], entry['stage'], entry['level']])).toEqual([
        [400, 'parsing', 'warn'],
        [415, 'parsing', 'warn'],
        [413, 'parsing', 'warn'],
      ]);
      for (const entry of warned) expect(entry['frames']).toBeUndefined();
    } finally {
      await app.close();
    }
  });

  it('정상 JSON 본문은 단계 훅을 지나 경로에 그대로 닿는다', async () => {
    const { app, entries } = serverWithLog();
    app.post('/api/v1/echo', async (request) => ({ body: request.body as unknown }));
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/echo',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ anchors: ['v1.2.0', 'abc1234'], nested: { n: 1 } }),
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ body: { anchors: ['v1.2.0', 'abc1234'], nested: { n: 1 } } });
      expect(entries.filter((entry) => typeof entry['event'] === 'string')).toHaveLength(0);
    } finally {
      await app.close();
    }
  });

  it('경로가 직접 보낸 4xx·5xx 응답은 바꾸지 않는다', async () => {
    const { app, entries } = serverWithLog();
    app.get('/api/v1/handled', async (_request, reply) =>
      reply.status(503).send({ error: { code: 'PERMISSION_UNAVAILABLE', message: 'x' }, correlation_id: 'kept' }),
    );
    try {
      const response = await app.inject({ method: 'GET', url: '/api/v1/handled' });
      expect(response.statusCode).toBe(503);
      expect(response.json()).toEqual({ error: { code: 'PERMISSION_UNAVAILABLE', message: 'x' }, correlation_id: 'kept' });
      expect(entries.filter((entry) => typeof entry['event'] === 'string')).toHaveLength(0);
    } finally {
      await app.close();
    }
  });

  it('기록 수단이 던져도 응답은 500 봉투로 나간다', async () => {
    const app = buildServer({
      log: () => {
        throw new Error('stdout closed');
      },
    });
    app.get('/api/v1/boom', async () => {
      throw new Error('x');
    });
    try {
      const response = await app.inject({ method: 'GET', url: '/api/v1/boom' });
      expect(response.statusCode).toBe(500);
      expect(response.json<{ error: { code: string } }>().error.code).toBe('INTERNAL_ERROR');
    } finally {
      await app.close();
    }
  });
});
