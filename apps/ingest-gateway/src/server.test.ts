/**
 * HTTP 배선 단위 테스트.
 *
 * 실제 PostgreSQL 없이 도는 범위만 본다 — 라우트, 본문 파서, 오류 매핑,
 * 지표 노출. 저장 경로는 `integration/webhook.test.ts`가 본다.
 */

import { describe, expect, it } from 'vitest';
import { NULL_ARCHIVE_WRITER } from './archive.js';
import { MAX_BODY_BYTES, type GatewayConfig } from './config.js';
import { createIngestMetrics } from './metrics.js';
import { buildServer, SERVICE_NAME, WEBHOOK_PATH, type ServerDeps } from './server.js';
import { computeSignature } from './signature.js';

const SECRET = 'test-webhook-secret';

const config = (overrides: Partial<GatewayConfig> = {}): GatewayConfig => ({
  port: 0,
  webhookSecrets: [SECRET],
  maxBodyBytes: MAX_BODY_BYTES,
  archivePath: null,
  shutdownGraceMs: 30_000,
  ...overrides,
});

function deps(overrides: Partial<ServerDeps> = {}): ServerDeps {
  return {
    config: config(),
    store: async () => ({ duplicate: false }),
    checkDatabase: async (): Promise<void> => {
      /* 정상 */
    },
    archive: NULL_ARCHIVE_WRITER,
    metrics: createIngestMetrics(),
    log: (): void => {
      /* 테스트에서는 로그를 삼킨다 */
    },
    ...overrides,
  };
}

describe(`${SERVICE_NAME} 헬스체크 (인프라 3장)`, () => {
  it('GET /healthz가 200과 서비스 이름을 반환한다', async () => {
    const app = buildServer(deps());
    try {
      const response = await app.inject({ method: 'GET', url: '/healthz' });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ status: 'ok', service: SERVICE_NAME });
    } finally {
      await app.close();
    }
  });

  it('PostgreSQL 연결이 안 되면 503이고 내부 오류를 노출하지 않는다', async () => {
    const app = buildServer(
      deps({
        checkDatabase: async (): Promise<void> => {
          throw new Error('ECONNREFUSED 127.0.0.1:5432');
        },
      }),
    );
    try {
      const response = await app.inject({ method: 'GET', url: '/healthz' });
      expect(response.statusCode).toBe(503);
      expect(response.body).not.toContain('ECONNREFUSED');
    } finally {
      await app.close();
    }
  });
});

describe('QA-A001-01: 수신 지표 노출', () => {
  it('GET /metrics가 네 지표를 Prometheus 형식으로 노출한다', async () => {
    const app = buildServer(deps());
    try {
      await app.inject({
        method: 'POST',
        url: WEBHOOK_PATH,
        headers: {
          'content-type': 'application/json',
          'x-github-event': 'push',
          'x-github-delivery': 'd-1',
          'x-hub-signature-256': computeSignature(Buffer.from('{}', 'utf8'), SECRET),
        },
        payload: '{}',
      });

      const response = await app.inject({ method: 'GET', url: '/metrics' });
      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('text/plain');
      for (const name of [
        'ingest_received_total',
        'ingest_rejected_total',
        'ingest_duplicate_total',
        'ingest_response_seconds',
      ]) {
        expect(response.body).toContain(name);
      }
      expect(response.body).toContain('ingest_received_total{event_type="push",supported="true"} 1');
      expect(response.body).toContain('ingest_response_seconds_count{status="202"} 1');
    } finally {
      await app.close();
    }
  });
});

describe(`POST ${WEBHOOK_PATH}`, () => {
  it('유효 서명 요청이 202와 API-ING-001 본문을 돌려준다', async () => {
    const app = buildServer(deps());
    try {
      const body = '{"action":"opened","repository":{"id":4021}}';
      const response = await app.inject({
        method: 'POST',
        url: WEBHOOK_PATH,
        headers: {
          'content-type': 'application/json',
          'x-github-event': 'pull_request',
          'x-github-delivery': '72d1e0f3-a4b5-4c6d-8e7f-90a1b2c3d4e5',
          'x-hub-signature-256': computeSignature(Buffer.from(body, 'utf8'), SECRET),
        },
        payload: body,
      });
      expect(response.statusCode).toBe(202);
      expect(response.json()).toEqual({
        accepted: true,
        delivery_id: '72d1e0f3-a4b5-4c6d-8e7f-90a1b2c3d4e5',
        duplicate: false,
      });
    } finally {
      await app.close();
    }
  });

  it('Fastify 기본 JSON 파서가 아니라 원문 바이트가 핸들러에 온다', async () => {
    // 기본 파서가 살아 있으면 이 요청은 400 FST_ERR_CTP_INVALID_JSON이 된다.
    // 401이 나온다는 것은 파싱 없이 서명 검증까지 갔다는 뜻이다 (보안 문서 9장).
    const app = buildServer(deps());
    try {
      const response = await app.inject({
        method: 'POST',
        url: WEBHOOK_PATH,
        headers: {
          'content-type': 'application/json',
          'x-github-event': 'push',
          'x-hub-signature-256': 'sha256=00',
        },
        payload: '{"broken":',
      });
      expect(response.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  it('FR-ING-001 AC-6: 상한을 넘는 본문은 413이고 저장 경로에 닿지 않는다', async () => {
    let stored = 0;
    const app = buildServer(
      deps({
        config: config({ maxBodyBytes: 1024 }),
        store: async () => {
          stored += 1;
          return { duplicate: false };
        },
      }),
    );
    try {
      const body = JSON.stringify({ pad: 'x'.repeat(4096) });
      const response = await app.inject({
        method: 'POST',
        url: WEBHOOK_PATH,
        headers: {
          'content-type': 'application/json',
          'x-github-event': 'push',
          'x-hub-signature-256': computeSignature(Buffer.from(body, 'utf8'), SECRET),
        },
        payload: body,
      });
      expect(response.statusCode).toBe(413);
      expect(stored).toBe(0);
      expect(response.body).not.toContain('FST_ERR');
    } finally {
      await app.close();
    }
  });

  it('예기치 못한 오류도 500과 상관 ID만 돌려준다', async () => {
    const app = buildServer(
      deps({
        store: async () => {
          throw new Error('relation "raw_event" does not exist');
        },
      }),
    );
    try {
      const body = '{}';
      const response = await app.inject({
        method: 'POST',
        url: WEBHOOK_PATH,
        headers: {
          'content-type': 'application/json',
          'x-github-event': 'push',
          'x-hub-signature-256': computeSignature(Buffer.from(body, 'utf8'), SECRET),
        },
        payload: body,
      });
      expect(response.statusCode).toBe(500);
      expect(response.body).not.toContain('raw_event');
      expect(response.json()).toHaveProperty('correlation_id');
    } finally {
      await app.close();
    }
  });
});
