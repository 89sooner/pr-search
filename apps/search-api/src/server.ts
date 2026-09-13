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
import { registerExportRoutes } from './export/routes.js';
import { registerAnalyticsRoutes } from './analytics/routes.js';
import { registerResolveRoutes } from './resolve/routes.js';
import { registerRelationRoutes } from './relations/routes.js';

import { registerSequenceRoutes } from './sequence/routes.js';
import { registerSavedSearchRoutes } from './saved-search/routes.js';
import { registerAuditRoutes, type AuditRouteOptions } from './audit/routes.js';
import { registerRepositoryRoutes, type RepositoryRouteOptions } from './repositories/routes.js';
import { registerGhRoutes, type GhRouteOptions } from './gh/routes.js';
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
import type { IndexStatusDeps } from './ops/index-status.js';
import type { RequestQueueDeps } from './ops/registration-requests.js';
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

/** 헬스 프로브 상한. 게이트웨이와 같은 값이다 (인프라 3장). */
const HEALTH_PROBE_MS = 2_000;

async function withHealthTimeout<T>(work: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => { reject(new Error('health probe timeout')); }, HEALTH_PROBE_MS);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export interface ServerDeps {
  readonly config?: SearchApiConfig;

  /**
   * 백킹 서비스 연결 확인 (CR-059, DEV-495).
   *
   * 인프라 3장 표가 이 서비스의 헬스체크를 **`GET /healthz` (ES·PG 연결 확인)**로
   * 적어 두었는데 오랫동안 그 확인이 없었다 — 무조건 `ok`를 답했다. 배포 Profile A는
   * 오케스트레이터가 없어 **health가 유일한 기동 판정 수단**이고, 그 형상에서
   * "DB가 죽어도 ok"는 운영자에게 거짓을 말한다.
   *
   * 선택 필드인 이유는 단위 시험이 백킹 서비스 없이 이 서버를 세우기 때문이다.
   * **운영 배선이 이것을 빠뜨리지 않는지는 회귀가 묻는다** — 선택으로 두고
   * 아무도 검사하지 않으면 `CR-034`가 찾은 결함이 여기서 재현된다.
   */
  readonly checkBackingServices?: () => Promise<void>;
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
   * 색인 상태 조회 의존 (API-ADM-004 `GET`, WP-040 / CR-055).
   *
   * 별칭 통계를 읽는 포트가 있어야 답할 수 있다. 없으면 경로를 달지 않는다 —
   * 등록해 두고 매번 전부 미확인으로 답하는 것보다 없는 편이 정직하다.
   */
  readonly indexStatus?: IndexStatusDeps;
  /**
   * 등록 검토 요청 대기열 의존 (API-ADM-009, WP-040 / CR-055).
   *
   * 커서 서명 키가 있어야 순회가 성립한다. 없으면 경로를 달지 않는다 —
   * 서명하지 못하는 프로세스가 커서를 내면 그것은 위조 가능한 값이다.
   */
  readonly requestQueue?: RequestQueueDeps;
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
  /**
   * 감사 기록 조회 의존 (API-ADM-005, WP-039 / CR-054).
   *
   * **`ops`와 별개다.** 그 관문은 `operator`를 통과시키고 세션이 없으면 토큰을
   * 받는데, 이 경로는 `security_officer` **전용**이며 역할은 세션에만 있다
   * (FR-AUTH-004 AC-5).
   */
  readonly audit?: Omit<AuditRouteOptions, 'auth' | 'loginPath' | 'log'>;
  /**
   * GitHub Operations Plane 의존 (API-GH-001~011, REL-007 R0 / WP-077, CR-086).
   *
   * **세션 블록 안에만 선다** — 위임 신원은 사람 계정에 붙는 것이라 관리자 토큰
   * 대체 경로가 없다. `runtime.ts`는 `GH_OPERATIONS_ENABLED=true`이고 세션이 있을
   * 때만 이것을 만든다. 없으면 경로를 달지 않고 그 사실을 로그로 말한다.
   */
  readonly gh?: Omit<GhRouteOptions, 'auth' | 'loginPath'>;
  readonly log?: (entry: { readonly level: string; readonly message: string }) => void;
}

export function buildServer(deps: ServerDeps = {}): FastifyInstance {
  const app = Fastify({ logger: false });
  const config = deps.config ?? resolveSearchApiConfig();
  const log = deps.log ?? ((): void => undefined);

  /**
   * 인프라 3장이 정의한 헬스체크 경로 — **ES·PG 연결까지 확인한다** (CR-059, DEV-495).
   *
   * 확인에 상한을 건다. 백킹 서비스가 느리게 죽으면 health 자체가 매달려
   * **판정이 오지 않는 것과 실패가 구분되지 않는다.**
   */
  app.get('/healthz', async (_request, reply): Promise<HealthResponse | { status: string }> => {
    if (deps.checkBackingServices !== undefined) {
      try {
        await withHealthTimeout(deps.checkBackingServices());
      } catch {
        // 이유는 본문에 싣지 않는다 — 인증 없이 닿는 경로다 (게이트웨이와 같은 규칙).
        return reply.status(503).send({ status: 'error', service: SERVICE_NAME, version: VERSION });
      }
    }
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
      registerSearchRoutes(app, {
        ...deps.search,
        auth: deps.auth,
        loginPath: config.auth.loginPath,
        mergeNumberEnabled: config.mergeNumberEnabled === true,
      });
      registerExportRoutes(app, { ...deps.search, auth: deps.auth, loginPath: config.auth.loginPath });
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
        pool: deps.search.pool,
        ...(deps.search.timeoutMs === undefined ? {} : { timeoutMs: deps.search.timeoutMs }),
        auth: deps.auth,
        loginPath: config.auth.loginPath,
        gheBaseUrl: config.gheBaseUrl,
        mergeNumberEnabled: config.mergeNumberEnabled === true,
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
     * 감사 기록 조회 (API-ADM-005, WP-039 / CR-054).
     *
     * 세션 블록 안에 둔다 — `security_officer` 역할 없이는 이 경로가 어떤
     * 답도 내지 않으며 그 역할은 세션에만 있다 (FR-AUTH-004 AC-5).
     */
    if (deps.audit !== undefined) {
      registerAuditRoutes(app, {
        ...deps.audit,
        auth: deps.auth,
        loginPath: config.auth.loginPath,
        log: (entry) => { log({ level: entry.level, message: entry.message }); },
      });
    } else {
      log({
        level: 'warn',
        message: 'PostgreSQL 의존이 없어 감사 기록 조회 경로를 등록하지 않는다 (API-ADM-005)',
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
        mergeNumberEnabled: config.mergeNumberEnabled === true,
      });
    } else {
      log({
        level: 'warn',
        message: 'PostgreSQL 의존이 없어 시퀀스 경로를 등록하지 않는다 (API-SEQ-001, API-SEQ-002)',
      });
    }

    /*
     * GitHub Operations Plane (REL-007 R0 / WP-077, CR-086).
     *
     * **여기 한 줄이 빠지면 그 기능은 배포에서 사라진다** — 회귀가 이 호출 형태를
     * 직접 건다 (CR-034의 규율). 꺼진 배포는 `runtime.ts`가 `gh`를 만들지 않으므로
     * 경로가 없고, 그 사실을 로그로 말한다.
     */
    if (deps.gh !== undefined) {
      registerGhRoutes(app, { ...deps.gh, auth: deps.auth, loginPath: config.auth.loginPath });
    } else {
      log({ level: 'info', message: 'GitHub Operations Plane이 꺼져 있거나 의존이 없어 /gh 경로를 등록하지 않는다 (API-GH-001~011)' });
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
    ...(deps.indexStatus === undefined ? {} : { indexStatus: deps.indexStatus }),
    ...(deps.requestQueue === undefined ? {} : { requestQueue: deps.requestQueue }),
  });
  return app;
}
