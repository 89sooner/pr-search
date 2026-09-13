/**
 * 헬스체크·지표 서버 (인프라 3.1 — `GET /healthz` (gh 버전·manifest 대조 포함)).
 *
 * 인프라 12장의 헬스체크는 「gh 버전·manifest 대조」를 포함한다. 기동 시 대조가
 * 실패하면 프로세스가 뜨지 않으므로 여기서는 그 결과와 백킹 서비스(PostgreSQL)를
 * 답한다. 실행이 꺼진 배포는 `execution: disabled`로 정직하게 답한다 — 초록이지만
 * 아무것도 실행하지 않는다는 사실을 숨기지 않는다.
 */

import { createServer, type Server } from 'node:http';
import type { HealthResponse } from '@prs/contracts';
import { METRICS_CONTENT_TYPE } from './metrics.js';

export const SERVICE_NAME = 'gh-executor' as const;
export const DEFAULT_PORT = 3004;

export interface HealthDetail {
  readonly execution: 'enabled' | 'disabled';
  readonly ghVersion: string | null;
  readonly manifestVersion: string | null;
  readonly manifestHash: string | null;
}

export interface ServerOptions {
  readonly detail: () => HealthDetail;
  readonly checkBackingServices?: () => Promise<void>;
  readonly metrics?: { render(): string };
}

const HEALTH_PROBE_MS = 2_000;

export function buildServer(options: ServerOptions): Server {
  return createServer((request, response) => {
    void (async (): Promise<void> => {
      if (request.method === 'GET' && request.url === '/healthz') {
        const version = process.env['npm_package_version'] ?? '0.1.0';
        if (options.checkBackingServices !== undefined) {
          let timer: NodeJS.Timeout | undefined;
          try {
            await Promise.race([
              options.checkBackingServices(),
              new Promise<never>((_, reject) => {
                timer = setTimeout(() => reject(new Error('health probe timeout')), HEALTH_PROBE_MS);
              }),
            ]);
          } catch {
            response.writeHead(503, { 'content-type': 'application/json; charset=utf-8' });
            response.end(JSON.stringify({ status: 'error', service: SERVICE_NAME, version }));
            return;
          } finally {
            if (timer !== undefined) clearTimeout(timer);
          }
        }
        const body: HealthResponse & HealthDetail = { status: 'ok', service: SERVICE_NAME, version, ...options.detail() };
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
    })();
  });
}
