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
import { registerAnalyticsRoutes } from './analytics/routes.js';
import { registerResolveRoutes } from './resolve/routes.js';
import { registerRelationRoutes } from './relations/routes.js';

import { registerSequenceRoutes } from './sequence/routes.js';
import { registerSavedSearchRoutes } from './saved-search/routes.js';
import { registerRepositoryRoutes, type RepositoryRouteOptions } from './repositories/routes.js';
import type { SavedSearchDeps } from './saved-search/service.js';
import { authRepo, repositoryRepo, type Pool } from '@prs/db';
import type { SearchDeps } from './search/service.js';
import type { RangeDeps } from './sequence/range.js';
import type { AuthContext } from './auth/context.js';
import type { OpsDeps } from './ops/dead-letters.js';
import type { RegistryDeps } from './ops/repositories.js';
import type { PipelineStatusDeps } from './ops/pipeline-status.js';
import type { IntegrityDeps } from './ops/sequence-integrity.js';
import type { ReindexDeps as OpsReindexDeps } from './ops/reindex.js';
import type { RawEventsDeps } from './ops/raw-events.js';

export const SERVICE_NAME = 'search-api' as const;
export const DEFAULT_PORT = 3002;

const VERSION = process.env['npm_package_version'] ?? '0.1.0';

/**
 * 숫자 그룹 키를 표시값으로 옮기는 해석기 (WP-037 / CR-053, PR #76 리뷰 P1).
 *
 * **`SearchDeps`에 넣지 않는다.** 검색은 이 방향의 해석을 쓰지 않으며, 쓰지
 * 않는 계층에 얹으면 그 계층의 시험이 쓰지도 않을 대역을 만들게 된다
 * (CR-051이 `pool`을 라우트에 둔 것과 같은 판단).
 */
function analyticsDisplay(pool: Pool) {
  return async (input: { readonly orgIds: readonly number[]; readonly teamIds: readonly number[] }) => ({
    orgs: await repositoryRepo.resolveOrgOwners(pool, input.orgIds),
    teams: await authRepo.resolveTeamSlugs(pool, input.teamIds),
  });
}

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
   * 무중단 재색인 의존 (API-ADM-004, WP-035).
   *
   * 색인 이름을 아는 포트가 있어야 대상 버전을 정할 수 있다. 없으면 경로를 달지
   * 않는다 — 대상을 못 정하는 프로세스가 "재색인을 시작했다"고 답하면 안 된다.
   */
  readonly reindex?: OpsReindexDeps;
  /**
   * 원본 아카이브 조회 의존 (API-ADM-008, WP-036 / CR-052).
   *
   * 없으면 경로를 달지 않는다. `runtime.ts`는 **세션이 있을 때만** 이것을
   * 만든다 — 조회가 역할 제한에 더해 접근 범위 필터를 지나야 하므로(AC-6)
   * 접근 범위를 산출할 주체가 없으면 성립하지 않는다.
   */
  readonly rawEvents?: RawEventsDeps;
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
  /**
   * 검색 경로 의존. `pool`을 함께 요구한다 (CR-051) — `seq:` 질의의 시퀀스
   * 공간을 확인해야 하고 그 정본은 PostgreSQL이다.
   */
  readonly search?: SearchDeps & { readonly pool: Pool };
  /**
   * 시퀀스 앵커·범위 조회 의존 (API-SEQ-001·002, WP-023).
   *
   * **`search`와 달리 PostgreSQL이 필요하다.** 구간의 멤버십은 `merge_sequence`가
   * 정본이라 Elasticsearch만으로는 답할 수 없다 (CR-027, DEV-130). `search`와
   * 마찬가지로 세션이 있어야 접근 범위를 산출할 수 있으므로 `auth`가 있을 때만
   * 경로를 단다.
   */
  readonly sequence?: RangeDeps;
  /**
   * 저장된 검색 의존 (API-SRCH-005, WP-033).
   *
   * **PostgreSQL과 커서 서명자만 있으면 선다.** 이 자원의 정본은 관계형 표이고
   * Elasticsearch를 거치지 않는다 — 저장된 것은 질의 문자열이지 결과가 아니다.
   * 세션이 없으면 소유자를 정할 수 없으므로 `auth`가 있을 때만 경로를 단다.
   */
  readonly savedSearch?: SavedSearchDeps;
  /**
   * 저장소 수집 진단 의존 (API-ING-002·003, WP-034 / CR-050).
   *
   * **`ops`와 별개다.** 이 경로는 일반 사용자용이고 `/admin` 아래가 아니며,
   * 관리자 토큰으로 열리지 않는다 — 세션이 있어야만 접근 범위를 채울 수 있다
   * (ADR-008). Elasticsearch가 필요한 이유는 문서 수 집계 하나 때문이고,
   * 그 집계도 필수 접근 범위 필터를 지난다.
   */
  readonly repositories?: Omit<RepositoryRouteOptions, 'auth' | 'loginPath'>;
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
      /*
       * 집계 API (WP-037 / API-STAT-001~004).
       *
       * **검색과 같은 의존을 쓰되 별도 등록이다** (FR-STAT-006 AC-4). 목록
       * 응답이 집계 지연에 영향받지 않아야 하므로 경로가 나뉘고, 그 분리는
       * 여기 한 줄에서 시작한다 — **빠지면 네 API가 배포에서 사라진다**
       * (WP-028의 API-ADM-007이 정확히 그 상태였다, CR-034 DEV-177).
       */
      registerAnalyticsRoutes(app, {
        es: deps.search.es,
        pool: deps.search.pool,
        resolveNames: deps.search.resolveNames,
        resolveGroupDisplay: analyticsDisplay(deps.search.pool),
        auth: deps.auth,
        loginPath: config.auth.loginPath,
      });
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

    /*
     * 저장된 검색 (WP-033).
     *
     * **여기 한 줄이 빠지면 그 기능은 배포에서 사라진다** — WP-028의
     * API-ADM-007이 정확히 그 상태였다(CR-034, DEV-177). 회귀가 이 호출 형태를
     * 직접 건다.
     */
    if (deps.savedSearch !== undefined) {
      registerSavedSearchRoutes(app, {
        ...deps.savedSearch,
        auth: deps.auth,
        loginPath: config.auth.loginPath,
      });
    } else {
      log({
        level: 'warn',
        message: 'PostgreSQL 의존이 없어 저장된 검색 경로를 등록하지 않는다 (API-SRCH-005)',
      });
    }

    /*
     * 저장소 수집 진단 (API-ING-002·003, WP-034).
     *
     * 세션 블록 안에 둔다 — 접근 범위 없이는 이 목록을 낼 수 없고,
     * 관리자 토큰 대체 경로를 만들지 않는다 (CR-050, DEV-350).
     */
    if (deps.repositories !== undefined) {
      registerRepositoryRoutes(app, {
        ...deps.repositories,
        auth: deps.auth,
        loginPath: config.auth.loginPath,
      });
    } else {
      log({
        level: 'warn',
        message: '의존이 없어 저장소 진단 경로를 등록하지 않는다 (API-ING-002, API-ING-003)',
      });
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
    ...(deps.reindex === undefined ? {} : { reindex: deps.reindex }),
    ...(deps.rawEvents === undefined ? {} : { rawEvents: deps.rawEvents }),
  });
  return app;
}
