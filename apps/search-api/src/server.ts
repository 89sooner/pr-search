/**
 * search-api — 조회 API. 모든 ES 질의가 필수 접근 범위 필터를 거친다 (ADR-008).
 *
 * 지금 살아 있는 것은 헬스체크와 `ops` 모듈(WP-009)뿐이다. 검색 처리 경로는
 * WP-013·WP-014가 채운다.
 */

import Fastify, { type FastifyInstance } from 'fastify';
import type { HealthResponse } from '@prs/contracts';
import { resolveSearchApiConfig, type SearchApiConfig } from './config.js';
import { registerOpsRoutes } from './ops/routes.js';
import type { OpsDeps } from './ops/dead-letters.js';

export const SERVICE_NAME = 'search-api' as const;
export const DEFAULT_PORT = 3002;

const VERSION = process.env['npm_package_version'] ?? '0.1.0';

export interface ServerDeps {
  readonly config?: SearchApiConfig;
  /**
   * `ops` 모듈 의존. 없으면 관리 경로를 등록하지 않는다 — 헬스체크만 있는
   * 프로세스로 뜬다.
   */
  readonly ops?: OpsDeps;
  readonly log?: (entry: { readonly level: string; readonly message: string }) => void;
}

export function buildServer(deps: ServerDeps = {}): FastifyInstance {
  const app = Fastify({ logger: false });
  const config = deps.config ?? resolveSearchApiConfig();
  const log = deps.log ?? ((): void => undefined);

  /**
   * 인프라 3장이 정의한 헬스체크 경로.
   *
   * 백킹 서비스 연결 확인은 각 연결을 실제로 여는 WP에서 더한다.
   */
  app.get('/healthz', async (): Promise<HealthResponse> => {
    return { status: 'ok', service: SERVICE_NAME, version: VERSION };
  });

  if (deps.ops === undefined) return app;

  if (config.adminToken === null) {
    // 조용히 열어 두지 않는다. 뜨는 순간 왜 없는지 로그로 말한다 (CR-012, DEV-025).
    log({
      level: 'warn',
      message: 'ADMIN_API_TOKEN이 없어 관리 경로를 등록하지 않는다 (API-ADM-003)',
    });
    return app;
  }

  registerOpsRoutes(app, { ...deps.ops, adminToken: config.adminToken });
  return app;
}
