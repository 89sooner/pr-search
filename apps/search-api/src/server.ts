/**
 * search-api — 조회 API. 모든 ES 질의가 필수 접근 범위 필터를 거친다 (ADR-008).
 *
 * 지금 살아 있는 것은 헬스체크와 `ops` 모듈(WP-009), 그리고 `/me`(WP-012)다.
 * 검색 처리 경로는 WP-013·WP-014가 채운다.
 *
 * **인증 통제는 둘 중 하나다** (CR-015, DEV-048). OIDC 세션이 구성되어 있으면
 * `/me`가 서고 `/admin/*`는 `operator` 역할이 지킨다. 구성되지 않았으면
 * 이름 붙은 토큰이 `/admin/*`의 임시 통제로 남고 `/me`는 서지 않는다.
 * 둘을 함께 두면 토큰이 역할 검사를 우회하는 문이 된다.
 */

import Fastify, { type FastifyInstance } from 'fastify';
import type { HealthResponse } from '@prs/contracts';
import { resolveSearchApiConfig, type SearchApiConfig } from './config.js';
import { registerOpsRoutes } from './ops/routes.js';
import { registerAuthRoutes } from './auth/routes.js';
import type { AuthContext } from './auth/context.js';
import type { OpsDeps } from './ops/dead-letters.js';
import type { RegistryDeps } from './ops/repositories.js';
import type { PipelineStatusDeps } from './ops/pipeline-status.js';

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
  /** 저장소 등록 의존. 없으면 등록 경로를 달지 않는다 (API-ADM-001). */
  readonly registry?: RegistryDeps;
  /** 파이프라인 상태 의존. 없으면 상태 경로를 달지 않는다 (API-ADM-006). */
  readonly pipeline?: PipelineStatusDeps;
  /**
   * 세션 인증 컨텍스트 (WP-012).
   *
   * 있으면 `/me`가 서고 `/admin/*`의 통제가 `operator` 역할이 된다.
   * 없으면 이름 붙은 토큰이 `/admin/*`를 지킨다 (CR-015, DEV-048).
   */
  readonly auth?: AuthContext;
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

  if (deps.auth !== undefined) {
    if (config.adminTokens.length > 0) {
      // 세션 옆에 토큰 우회를 열어 둔 배포를 만들지 않는다 (CR-015, DEV-048).
      throw new Error(
        'OIDC 세션과 ADMIN_API_TOKENS를 함께 구성할 수 없다 (CR-015, DEV-048). ' +
          '세션이 서면 관리 API의 통제는 operator 역할이며 토큰 경로는 대체된다',
      );
    }
    registerAuthRoutes(app, { auth: deps.auth, loginPath: config.auth.loginPath });
  }

  if (deps.ops === undefined) return app;

  if (deps.auth === undefined && config.adminTokens.length === 0) {
    // 조용히 열어 두지 않는다. 뜨는 순간 왜 없는지 로그로 말한다 (CR-012, DEV-025).
    log({
      level: 'warn',
      message: '인증 수단이 없어 관리 경로를 등록하지 않는다 (API-ADM-001, API-ADM-003)',
    });
    return app;
  }

  registerOpsRoutes(app, {
    ...deps.ops,
    adminTokens: config.adminTokens,
    ...(deps.auth === undefined ? {} : { auth: deps.auth }),
    loginPath: config.auth.loginPath,
    ...(deps.registry === undefined ? {} : { registry: deps.registry }),
    ...(deps.pipeline === undefined ? {} : { pipeline: deps.pipeline }),
  });
  return app;
}
