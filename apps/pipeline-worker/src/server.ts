/**
 * pipeline-worker — 보강·투영·채번·관계 파생 워커 프로세스.
 *
 * ADR-001에 따라 워커는 Fastify가 아닌 순수 Node 프로세스다. 다만 인프라 3장의
 * 하트비트와 WP-001 DoD("각 앱 헬스체크가 200을 반환한다")를 만족시키기 위해
 * `node:http`로 최소 엔드포인트만 노출한다 — 헬스체크와 지표 스크레이프.
 */

import { createServer, type Server } from 'node:http';
import type { HealthResponse } from '@prs/contracts';
import { METRICS_CONTENT_TYPE } from './metrics.js';

export const SERVICE_NAME = 'pipeline-worker' as const;
export const DEFAULT_PORT = 3003;

export interface ServerOptions {
  /** 지표 렌더러. 주지 않으면 `/metrics`는 404다 — 없는 것을 있는 척하지 않는다. */
  readonly metrics?: { render(): string };
}

export function buildServer(options: ServerOptions = {}): Server {
  return createServer((request, response) => {
    if (request.method === 'GET' && request.url === '/healthz') {
      const body: HealthResponse = {
        status: 'ok',
        service: SERVICE_NAME,
        version: process.env['npm_package_version'] ?? '0.1.0',
      };
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify(body));
      return;
    }

    if (request.method === 'GET' && request.url === '/metrics' && options.metrics !== undefined) {
      response.writeHead(200, { 'content-type': METRICS_CONTENT_TYPE });
      response.end(options.metrics.render());
      return;
    }

    response.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ error: { code: 'NOT_FOUND', message: '대상 없음' } }));
  });
}
