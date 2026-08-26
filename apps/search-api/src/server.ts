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
import { registerSearchRoutes } from './search/routes.js';
import { registerResolveRoutes } from './resolve/routes.js';
import { registerRelationRoutes } from './relations/routes.js';

import { registerSequenceRoutes } from './sequence/routes.js';
import type { SearchDeps } from './search/service.js';
import type { RangeDeps } from './sequence/range.js';
import type { AuthContext } from './auth/context.js';
import type { OpsDeps } from './ops/dead-letters.js';
import type { RegistryDeps } from './ops/repositories.js';
import type { PipelineStatusDeps } from './ops/pipeline-status.js';
import type { IntegrityDeps } from './ops/sequence-integrity.js';

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
   * 시퀀스 정합성 점검 의존 (API-ADM-007, WP-028).
   *
   * 커밋 그래프가 있어야 대조가 성립하므로 없으면 경로를 달지 않는다.
   */
  readonly integrity?: IntegrityDeps;
  /**
   * 세션 인증 컨텍스트 (WP-012).
   *
   * 있으면 `/me`가 서고 `/admin/*`의 통제가 `operator` 역할이 된다.
   * 없으면 이름 붙은 토큰이 `/admin/*`를 지킨다 (CR-015, DEV-048).
   */
  readonly auth?: AuthContext;
  /**
   * 목록 조회 의존 (API-SRCH-004).
   *
   * 세션 없이는 접근 범위를 산출할 수 없으므로 `auth`가 있을 때만 경로를
   * 단다. 없으면 검색이 전부 401이 되는 서비스를 띄우는 것보다 경로가
   * 없는 편이 낫다.
   */
  readonly search?: SearchDeps;
  /**
   * 시퀀스 앵커·범위 조회 의존 (API-SEQ-001·002, WP-023).
   *
   * **`search`와 달리 PostgreSQL이 필요하다.** 구간의 멤버십은 `merge_sequence`가
   * 정본이라 Elasticsearch만으로는 답할 수 없다 (CR-027, DEV-130). `search`와
   * 마찬가지로 세션이 있어야 접근 범위를 산출할 수 있으므로 `auth`가 있을 때만
   * 경로를 단다.
   */
  readonly sequence?: RangeDeps;
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

    if (deps.search !== undefined) {
      registerSearchRoutes(app, { ...deps.search, auth: deps.auth, loginPath: config.auth.loginPath });
      // 식별자 해석은 목록 조회와 같은 의존을 쓴다 (WP-014). ES 하나면 된다.
      registerResolveRoutes(app, {
        es: deps.search.es,
        ...(deps.search.timeoutMs === undefined ? {} : { timeoutMs: deps.search.timeoutMs }),
        auth: deps.auth,
        loginPath: config.auth.loginPath,
        gheBaseUrl: config.gheBaseUrl,
      });
      /*
       * 관계 조회도 같은 의존을 쓴다 (WP-031, API-REL-006·API-REL-003).
       *
       * **여기 한 줄이 빠지면 그 기능은 배포에서 사라진다** — WP-028의 API-ADM-007이
       * 정확히 그 상태였다(CR-034, DEV-177). 함수도 라우트도 시험도 있었지만
       * 운영이 부르지 않았다. 회귀가 이 호출 형태를 직접 건다.
       */
      registerRelationRoutes(app, {
        es: deps.search.es,
        ...(deps.search.timeoutMs === undefined ? {} : { timeoutMs: deps.search.timeoutMs }),
        auth: deps.auth,
        loginPath: config.auth.loginPath,
      });

    } else {
      log({ level: 'warn', message: 'Elasticsearch 의존이 없어 검색 경로를 등록하지 않는다 (API-SRCH-004)' });
    }

    if (deps.sequence !== undefined) {
      registerSequenceRoutes(app, {
        ...deps.sequence,
        auth: deps.auth,
        loginPath: config.auth.loginPath,
      });
    } else {
      log({
        level: 'warn',
        message: 'PostgreSQL 의존이 없어 시퀀스 경로를 등록하지 않는다 (API-SEQ-001, API-SEQ-002)',
      });
    }
  } else if (deps.search !== undefined) {
    // 세션 없이 검색을 열면 접근 범위를 채울 신원이 없다 (ADR-008).
    log({ level: 'warn', message: '세션 인증이 없어 검색 경로를 등록하지 않는다 (FR-AUTH-002)' });
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
    ...(deps.integrity === undefined ? {} : { integrity: deps.integrity }),
  });
  return app;
}
