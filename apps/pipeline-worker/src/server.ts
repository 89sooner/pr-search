/**
 * pipeline-worker — 보강·투영·채번·관계 파생 워커 프로세스.
 *
 * ADR-001에 따라 워커는 Fastify가 아닌 순수 Node 프로세스다. 다만 인프라 3장의
 * 하트비트와 WP-001 DoD("각 앱 헬스체크가 200을 반환한다")를 만족시키기 위해
 * `node:http`로 최소 헬스 엔드포인트만 노출한다. 처리 루프는 WP-007 이후가 채운다.
 */

import { createServer, type Server } from 'node:http';
import type { HealthResponse } from '@prs/contracts';

export const SERVICE_NAME = 'pipeline-worker' as const;
export const DEFAULT_PORT = 3003;

export function buildServer(): Server {
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

    response.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ error: { code: 'NOT_FOUND', message: '대상 없음' } }));
  });
}
