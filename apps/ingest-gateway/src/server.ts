/**
 * ingest-gateway — GHE 웹훅 수신 게이트웨이 (ADR-002 레인 A 입구).
 *
 * WP-001 범위는 헬스체크뿐이다. 실제 처리 경로는 WP-004가 채운다.
 */

import Fastify, { type FastifyInstance } from 'fastify';
import type { HealthResponse } from '@prs/contracts';

export const SERVICE_NAME = 'ingest-gateway' as const;
export const DEFAULT_PORT = 3001;

export function buildServer(): FastifyInstance {
  const app = Fastify({ logger: false });

  /**
   * 인프라 3장이 정의한 헬스체크 경로.
   *
   * WP-001에서는 프로세스 기동만 확인한다. 백킹 서비스 연결 확인은 각 연결을
   * 실제로 여는 WP에서 더한다.
   */
  app.get('/healthz', async (): Promise<HealthResponse> => {
    return { status: 'ok', service: SERVICE_NAME, version: process.env['npm_package_version'] ?? '0.1.0' };
  });

  return app;
}
