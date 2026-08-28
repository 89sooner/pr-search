/**
 * `ops` 모듈 라우트 (API-ADM-001, API-ADM-003, API-ADM-006).
 *
 * **권한은 `operator` 역할이다** (API 계약 3장). WP-012가 OIDC 세션을 세웠으므로
 * 세션이 구성된 배포에서는 그 판정을 쓴다.
 *
 * OIDC가 **구성되지 않은** 배포에서는 CR-012·CR-013이 세운 이름 붙은 토큰이
 * 임시 통제로 남는다. 둘은 배타다 (CR-015, DEV-048) — 실제 세션 옆에 역할
 * 검사를 우회하는 토큰 문이 열린 채로 배포되는 것이 이 통제가 막으려던 바로
 * 그 상황이기 때문이다. 인증 수단이 아예 없으면 경로를 등록하지 않는다.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import type { ErrorResponse } from '@prs/contracts';
import { AccessScopeUnavailableError } from '@prs/es';
import { deadLetterRepo } from '@prs/db';
import type { DeadLetterFilter, DeadLetterState, RepositoryRow, RepositoryStatus } from '@prs/db';
import type { AdminPrincipal } from '../config.js';
import type { AuthContext } from '../auth/context.js';
import {
  authenticateSession,
  authenticateToken,
  principalId,
  requireAnyRole,
  requireRole,
  type Principal,
} from '../auth/principal.js';
import { sendAuthError, toAuthError } from '../auth/errors.js';
import { Gauge, METRICS_CONTENT_TYPE, renderMetrics } from '../metrics.js';
import { ADMIN_ERROR_STATUS, AdminRejected } from './errors.js';
import {
  DEFAULT_LIST_STATES,
  listDeadLetters,
  parseIds,
  parseLimit,
  parseOffset,
  parseRepositoryId,
  parseStage,
  parseState,
  reprocessDeadLetters,
  type OpsDeps,
} from './dead-letters.js';
import { pipelineStatus, type PipelineStatusDeps } from './pipeline-status.js';
import {
  listRepositories,
  normalizeBranches,
  registerRepository,
  unregisterRepository,
  updateRepository,
  type RegistryDeps,
} from './repositories.js';
import {
  applyJobAction,
  createJob,
  isCreatableGenericJobType,
  isJobAction,
  toJobResponse,
  CREATABLE_GENERIC_JOB_TYPES,
  JOB_ACTIONS,
} from './jobs.js';
import { startReindex, type ReindexDeps } from './reindex.js';
import { listRawEvents, parseRawEventFilter, type RawEventsDeps } from './raw-events.js';
import { auditRepo, jobRepo, repositoryRepo } from '@prs/db';
import {
  confirmationMatches,
  expectedNewEpoch,
  parseIntegrityMode,
  runIntegrityCheck,
  type IntegrityDeps,
} from './sequence-integrity.js';


export const DEAD_LETTER_PATH = '/api/v1/admin/dead-letters';
export const REPROCESS_PATH = '/api/v1/admin/dead-letters/reprocess';
export const REPOSITORIES_PATH = '/api/v1/admin/repositories';
export const PIPELINE_STATUS_PATH = '/api/v1/admin/pipeline-status';
export const JOBS_PATH = '/api/v1/admin/jobs';
export const SEQUENCE_INTEGRITY_PATH = '/api/v1/admin/sequence-integrity';
/** API-ADM-004 (WP-035). */
export const REINDEX_PATH = '/api/v1/admin/reindex';
/** API-ADM-008 (WP-036, CR-052). */
export const RAW_EVENTS_PATH = '/api/v1/admin/raw-events';

function fail(
  reply: FastifyReply,
  status: number,
  code: ErrorResponse['error']['code'],
  message: string,
  correlationId: string,
  detail?: Readonly<Record<string, unknown>>,
): FastifyReply {
  const body: ErrorResponse =
    detail === undefined
      ? { error: { code, message }, correlation_id: correlationId }
      : { error: { code, message, detail }, correlation_id: correlationId };
  return reply.status(status).send(body);
}

export interface OpsRouteOptions extends OpsDeps {
  /** OIDC 미구성 배포의 임시 토큰. `auth`가 있으면 무시된다 (DEV-048). */
  readonly adminTokens: readonly AdminPrincipal[];
  /** 세션 인증 컨텍스트. 있으면 `operator` 역할이 통제한다. */
  readonly auth?: AuthContext | undefined;
  readonly loginPath?: string;
  /** 저장소 등록 의존. 없으면 등록 경로를 달지 않는다 (API-ADM-001). */
  readonly registry?: RegistryDeps;
  /** 파이프라인 상태 의존. 없으면 상태 경로를 달지 않는다 (API-ADM-006). */
  readonly pipeline?: PipelineStatusDeps;
  /**
   * 시퀀스 정합성 점검 의존 (API-ADM-007).
   *
   * 커밋 그래프가 있어야 대조가 성립한다. 없으면 경로를 달지 않는다 — 그래프
   * 없이 뜬 프로세스가 "점검했는데 일치"라고 답하는 것이 최악이다.
   */
  readonly integrity?: IntegrityDeps;
  /**
   * 무중단 재색인 의존 (API-ADM-004).
   *
   * 색인 이름을 아는 포트가 있어야 대상 버전을 정할 수 있다. 없으면 경로를 달지
   * 않는다 — 대상을 못 정하는 프로세스가 "재색인을 시작했다"고 답하는 것이 최악이다.
   */
  readonly reindex?: ReindexDeps;
  /**
   * 원본 아카이브 조회 의존 (API-ADM-008).
   *
   * 없으면 경로를 달지 않는다. **세션 인증이 없는 배포에서도 달지 않는다** —
   * 이름 붙은 관리 토큰은 사용자가 아니라 접근 범위를 산출할 대상이 없고,
   * 범위 없는 조회는 AC-6을 만족시킬 수 없다. 등록해 두고 매번 거절하는 것보다
   * 없는 편이 정직하다.
   */
  readonly rawEvents?: RawEventsDeps;
}

export function registerOpsRoutes(app: FastifyInstance, options: OpsRouteOptions): void {
  const { adminTokens, auth, loginPath, registry, pipeline, integrity, reindex, rawEvents, ...deps } =
    options;

  /**
   * 주체를 세우고 `operator` 역할을 확인한다.
   *
   * 세션이 구성되어 있으면 세션만 본다 — 토큰 경로를 함께 열어 두면 그것이
   * 역할 검사를 우회하는 문이 된다 (CR-015, DEV-048).
   */
  const authorize = async (
    request: FastifyRequest,
    reply: FastifyReply,
    correlationId: string,
  ): Promise<Principal | null> => {
    try {
      const principal =
        auth === undefined
          ? authenticateToken(request, adminTokens)
          : await authenticateSession(request, auth.sessions);
      requireRole(principal, 'operator');
      return principal;
    } catch (error) {
      const shape = toAuthError(error, {
        correlationId,
        ...(loginPath === undefined ? {} : { loginPath }),
      });
      if (shape !== null) {
        void sendAuthError(reply, shape);
        return null;
      }
      throw error;
    }
  };

  app.get(DEAD_LETTER_PATH, async (request, reply) => {
    const correlationId = randomUUID();
    if ((await authorize(request, reply, correlationId)) === null) return reply;

    const query = (request.query ?? {}) as Record<string, unknown>;
    try {
      const state = parseState(query['state']);
      const stage = parseStage(query['stage']);
      const repositoryId = parseRepositoryId(query['repository_id']);
      const filter: DeadLetterFilter = {
        states: state === undefined ? DEFAULT_LIST_STATES : [state],
        ...(stage === undefined ? {} : { stage }),
        ...(repositoryId === undefined ? {} : { repositoryId }),
      };
      const result = await listDeadLetters(
        deps,
        filter,
        parseLimit(query['limit']),
        parseOffset(query['offset']),
      );
      return reply.send(result);
    } catch (error) {
      if (error instanceof AdminRejected) {
        return fail(reply, ADMIN_ERROR_STATUS[error.code], error.code, error.message, correlationId, error.detail);
      }
      throw error;
    }
  });

  app.post(REPROCESS_PATH, async (request, reply) => {
    const correlationId = randomUUID();
    if ((await authorize(request, reply, correlationId)) === null) return reply;

    const body = (request.body ?? {}) as Record<string, unknown>;
    try {
      const rawFilter = body['filter'];
      const filter =
        rawFilter === undefined || rawFilter === null
          ? undefined
          : parseFilter(rawFilter as Record<string, unknown>);
      const confirmation = body['confirmation'];
      const deadLetterIds = parseIds(body['dead_letter_ids']);
      const result = await reprocessDeadLetters(
        deps,
        {
          ...(deadLetterIds === undefined ? {} : { deadLetterIds }),
          ...(filter === undefined ? {} : { filter }),
          confirmation: typeof confirmation === 'string' ? confirmation : null,
        },
        correlationId,
      );
      return reply.status(202).send({ ...result, correlation_id: correlationId });
    } catch (error) {
      if (error instanceof AdminRejected) {
        return fail(reply, ADMIN_ERROR_STATUS[error.code], error.code, error.message, correlationId, error.detail);
      }
      throw error;
    }
  });

  if (registry !== undefined) registerRegistryRoutes(app, registry, authorize);
  if (integrity !== undefined) registerIntegrityRoutes(app, integrity, authorize);
  if (reindex !== undefined) registerReindexRoutes(app, reindex, authorize);

  if (pipeline !== undefined) {
    app.get(PIPELINE_STATUS_PATH, async (request, reply) => {
      const correlationId = randomUUID();
      if ((await authorize(request, reply, correlationId)) === null) return reply;
      return reply.send(await pipelineStatus(pipeline));
    });
  }

  /**
   * API-ADM-008 원본 아카이브 조회 (FR-ING-010, CR-052).
   *
   * `authorize`를 쓰지 않는다 — 그것은 `operator` 전용이고 세션이 없으면 토큰을
   * 받는다. 아카이브는 **두 역할이 보되**(AC-5) **접근 범위 필터를 함께 지나야**
   * 하므로(AC-6) 세션만 받는다. 토큰 주체는 접근 범위를 산출할 대상이 없다.
   */
  if (rawEvents !== undefined && auth !== undefined) {
    const sessions = auth.sessions;
    const scopes = auth.scopes;

    app.get(RAW_EVENTS_PATH, async (request, reply) => {
      const correlationId = randomUUID();

      let principal: Principal;
      try {
        principal = await authenticateSession(request, sessions);
        requireAnyRole(principal, ['operator', 'security_officer']);
      } catch (error) {
        const shape = toAuthError(error, {
          correlationId,
          ...(loginPath === undefined ? {} : { loginPath }),
        });
        if (shape !== null) return sendAuthError(reply, shape);
        throw error;
      }

      const query = (request.query ?? {}) as Record<string, unknown>;
      try {
        const filter = parseRawEventFilter(query);

        // 접근 범위는 캐시된 저장소 목록을 그대로 쓴다 (AC-6). `toAccessScope`의
        // 조직·팀 치환은 아카이브 문서에 그 재료가 없어 쓸 수 없다.
        const cached = await scopes.resolveCached(principalId(principal));
        return reply.send(await listRawEvents(rawEvents, filter, cached.repositoryIds));
      } catch (error) {
        if (error instanceof AdminRejected) {
          return fail(
            reply,
            ADMIN_ERROR_STATUS[error.code],
            error.code,
            error.message,
            correlationId,
            error.detail,
          );
        }
        if (error instanceof AccessScopeUnavailableError) {
          // 볼 수 있는 저장소가 하나도 없다. 빈 목록이 아니라 명시적 실패다.
          return fail(
            reply,
            503,
            'PERMISSION_UNAVAILABLE',
            '접근 권한을 확인할 수 없어 조회를 거부한다',
            correlationId,
          );
        }
        throw error;
      }
    });
  }

  /**
   * 지표 노출 (FR-ING-007 AC-5).
   *
   * 인증을 걸지 않는다. 스크레이프는 클러스터 안에서 오고, 여기 나가는 값은
   * 상태별 건수뿐이라 전달 식별자나 오류 본문이 새지 않는다.
   */
  app.get('/metrics', async (_request, reply): Promise<string> => {
    const counts = await deadLetterRepo.countsByState(deps.pool);
    const byState = new Gauge('dead_letter_total', '실패 대기열 항목 수 (상태별)');
    byState.replace(
      (Object.keys(counts) as DeadLetterState[]).map((state) => ({
        labels: { state },
        value: counts[state],
      })),
    );
    const open = new Gauge(
      'dead_letter_open_total',
      '아직 열려 있는 실패 대기열 항목 수. 100건 초과가 경보 임계다',
    );
    open.set(counts.pending + counts.reprocessing);
    return reply.type(METRICS_CONTENT_TYPE).send(renderMetrics([byState, open]));
  });
}

function parseFilter(raw: Record<string, unknown>): DeadLetterFilter {
  const state = parseState(raw['state']);
  const stage = parseStage(raw['stage']);
  const repositoryId = parseRepositoryId(raw['repository_id']);
  return {
    ...(state !== undefined ? { states: [state] } : {}),
    ...(stage !== undefined ? { stage } : {}),
    ...(repositoryId !== undefined ? { repositoryId } : {}),
  };
}

type Authorize = (
  request: FastifyRequest,
  reply: FastifyReply,
  correlationId: string,
) => Promise<Principal | null>;

function repositoryIdOf(request: FastifyRequest): number {
  const raw = (request.params as { repository_id?: string }).repository_id;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new AdminRejected('INVALID_PARAMETER', `저장소 식별자가 정수가 아니다: ${String(raw)}`);
  }
  return parsed;
}

/** 잡 식별자. `BIGSERIAL`이라 안전 정수 범위 안이다 (CR-013, DEV-027). */
function jobIdOf(request: FastifyRequest): number {
  const raw = (request.params as { job_id?: string }).job_id;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new AdminRejected('INVALID_PARAMETER', `잡 식별자가 정수가 아니다: ${String(raw)}`);
  }
  return parsed;
}

function parseStatus(value: unknown): RepositoryStatus | undefined {
  if (value === undefined) return undefined;
  if (value === 'active' || value === 'archived') return value;
  throw new AdminRejected('INVALID_PARAMETER', `알 수 없는 상태다: ${String(value)}`);
}

/** 저장소 등록 관리 (API-ADM-001, FR-ING-009). */
function registerRegistryRoutes(app: FastifyInstance, registry: RegistryDeps, authorize: Authorize): void {
  /** 성공 상태 코드는 실행 결과가 정한다 — 등록은 신규 201 / 갱신 200이다. */
  const handle = async (
    request: FastifyRequest,
    reply: FastifyReply,
    run: (
      principal: Principal,
      correlationId: string,
    ) => Promise<{ readonly status: number; readonly body: unknown }>,
  ): Promise<FastifyReply> => {
    const correlationId = randomUUID();
    const principal = await authorize(request, reply, correlationId);
    if (principal === null) return reply;

    try {
      const result = await run(principal, correlationId);
      return reply.status(result.status).send(result.body);
    } catch (error) {
      if (error instanceof AdminRejected) {
        return fail(
          reply,
          ADMIN_ERROR_STATUS[error.code],
          error.code,
          error.message,
          correlationId,
          error.detail,
        );
      }
      throw error;
    }
  };

  app.get(REPOSITORIES_PATH, async (request, reply) =>
    handle(request, reply, async () => {
      const query = (request.query ?? {}) as Record<string, unknown>;
      const status = parseStatus(query['status']);
      const page = await listRepositories(
        registry,
        status === undefined ? {} : { status },
        parseLimit(query['limit']),
        parseOffset(query['offset']),
      );
      return { status: 200, body: page };
    }),
  );

  app.post(REPOSITORIES_PATH, async (request, reply) =>
    handle(request, reply, async (principal, correlationId) => {
      const body = (request.body ?? {}) as Record<string, unknown>;
      const result = await registerRepository(
        registry,
        {
          // `repository_id`·`org_id`·`visibility`는 본문에서 읽지 않는다.
          // GHE가 소유한 값이라 물어서 채운다 (CR-013, DEV-033).
          owner: body['owner'] as string,
          name: body['name'] as string,
          sequenceBranches: normalizeBranches(body['sequence_branches']),
          ...(typeof body['mirror_enabled'] === 'boolean' ? { mirrorEnabled: body['mirror_enabled'] } : {}),
          ...(body['backfill'] === true ? { backfill: true } : {}),
        },
        principalId(principal),
        correlationId,
      );
      return {
        status: result.created ? 201 : 200,
        body: {
          ...result.repository,
          documents_marked: result.documentsMarked,
          backfill_job_id: result.backfillJobId,
        },
      };
    }),
  );

  /*
   * API-ADM-002 잡 (WP-019 / CR-022, DEV-103).
   *
   * `registry`가 `pool`을 갖고 있으므로 새 의존을 더하지 않는다 — 잡과
   * 저장소는 같은 DB의 이웃한 테이블이다.
   */
  app.get(JOBS_PATH, async (request, reply) =>
    handle(request, reply, async () => {
      const query = (request.query ?? {}) as Record<string, unknown>;
      const rows = await jobRepo.listJobs(registry.pool, {
        ...(typeof query['type'] === 'string' ? { type: query['type'] as 'backfill' } : {}),
        ...(typeof query['state'] === 'string' ? { state: query['state'] as 'running' } : {}),
        limit: parseLimit(query['limit']),
      });
      return { status: 200, body: { items: rows.map(toJobResponse) } };
    }),
  );

  app.get(`${JOBS_PATH}/:job_id`, async (request, reply) =>
    handle(request, reply, async () => {
      const row = await jobRepo.findJobById(registry.pool, jobIdOf(request));
      if (row === undefined) throw new AdminRejected('NOT_FOUND', '잡을 찾을 수 없다');
      return { status: 200, body: toJobResponse(row) };
    }),
  );

  app.post(JOBS_PATH, async (request, reply) =>
    handle(request, reply, async (principal) => {
      const body = (request.body ?? {}) as Record<string, unknown>;
      /*
       * **집는 러너가 있는 유형만 받는다.** 다른 값을 조용히 큐에 넣으면 아무
       * 워커도 잡지 않는 유령 잡이 남는다 (CR-022, DEV-103).
       *
       * `link_rebuild`는 WP-029가 러너를 세우면서 열렸다 — 그전까지는 이 경로가
       * `backfill`만 받아 **JOB-REL-006을 시작할 방법이 아예 없었다**
       * (CR-039 / PR #44 리뷰 P1).
       */
      /*
       * **`reindex`는 여기서 받지 않는다** (CR-045, DEV-301·302). API-ADM-004가
       * 생성 진입점이며 대상 버전을 서버가 정한다 — 두 경로가 각자 정하면
       * 한쪽만 상한을 보게 된다.
       */
      if (!isCreatableGenericJobType(body['type'])) {
        throw new AdminRejected(
          'INVALID_PARAMETER',
          `type은 ${CREATABLE_GENERIC_JOB_TYPES.map((one) => `'${one}'`).join(' 또는 ')} 중 하나여야 한다`,
        );
      }
      const target = body['target'];
      if (typeof target !== 'string' || !target.includes('/')) {
        throw new AdminRejected('INVALID_PARAMETER', 'target은 owner/repo 형식이어야 한다');
      }

      const outcome = await createJob(registry.pool, body['type'], target, principalId(principal));
      if (outcome.kind === 'unknown_repository') {
        throw new AdminRejected('NOT_FOUND', '등록되지 않은 저장소다', { target });
      }
      if (outcome.kind === 'conflict') {
        throw new AdminRejected('JOB_CONFLICT', '같은 대상에 활성 잡이 이미 있다', { target });
      }
      return { status: 201, body: toJobResponse(outcome.job) };
    }),
  );

  app.patch(`${JOBS_PATH}/:job_id`, async (request, reply) =>
    handle(request, reply, async () => {
      const body = (request.body ?? {}) as Record<string, unknown>;
      const action = body['action'];
      if (!isJobAction(action)) {
        throw new AdminRejected('INVALID_PARAMETER', `action은 ${JOB_ACTIONS.join('·')} 중 하나여야 한다`);
      }

      const outcome = await applyJobAction(registry.pool, jobIdOf(request), action);
      if (outcome.kind === 'not_found') throw new AdminRejected('NOT_FOUND', '잡을 찾을 수 없다');
      if (outcome.kind === 'invalid_transition') {
        // 현재 상태를 함께 준다 — 운영자가 왜 안 되는지 알아야 다음을 고른다.
        throw new AdminRejected('INVALID_PARAMETER', `${outcome.state} 상태에서는 ${action}할 수 없다`, {
          state: outcome.state,
        });
      }
      return { status: 200, body: toJobResponse(outcome.job) };
    }),
  );

  app.patch(`${REPOSITORIES_PATH}/:repository_id`, async (request, reply) =>
    handle(request, reply, async (principal, correlationId) => {
      const repositoryId = repositoryIdOf(request);
      const body = (request.body ?? {}) as Record<string, unknown>;
      const updated = await updateRepository(
        registry,
        repositoryId,
        {
          ...(body['sequence_branches'] === undefined
            ? {}
            : { sequence_branches: normalizeBranches(body['sequence_branches']) }),
          ...(typeof body['mirror_enabled'] === 'boolean' ? { mirror_enabled: body['mirror_enabled'] } : {}),
        },
        principalId(principal),
        correlationId,
      );
      return { status: 200, body: updated };
    }),
  );

  app.delete(`${REPOSITORIES_PATH}/:repository_id`, async (request, reply) =>
    handle(request, reply, async (principal, correlationId) => {
      const result = await unregisterRepository(
        registry,
        repositoryIdOf(request),
        principalId(principal),
        correlationId,
      );
      return {
        status: 200,
        body: {
          repository_id: result.repository.repository_id,
          status: result.repository.status,
          documents_marked: result.documentsMarked,
        },
      };
    }),
  );
}

/**
 * API-ADM-007 시퀀스 정합성 점검과 재채번 (WP-028 / FR-ADMIN-003, CR-033).
 *
 * **점검은 공간 상태를 바꾸지 않는다** (DEV-171). 실패는 `check_state: "failed"`와
 * 사유로 답하고, 그때 `consistent`를 싣지 않는다 — 검사하지 않은 것을 "일치"로
 * 적으면 그 한 줄이 거짓이다.
 */
/**
 * API-ADM-004 무중단 재색인 (WP-035 / CR-045).
 *
 * `operator` 전용이며 **`alias`만** 받는다 (DEV-294). 대상 버전은 서버가 정한다.
 */
function registerReindexRoutes(app: FastifyInstance, reindex: ReindexDeps, authorize: Authorize): void {
  app.post(REINDEX_PATH, async (request, reply) => {
    const correlationId = randomUUID();
    const principal = await authorize(request, reply, correlationId);
    if (principal === null) return reply;

    try {
      const body = (request.body ?? {}) as Record<string, unknown>;
      const result = await startReindex(reindex, body['alias'], principalId(principal));
      return reply.status(202).send({ ...result, correlation_id: correlationId });
    } catch (error) {
      if (error instanceof AdminRejected) {
        return fail(reply, ADMIN_ERROR_STATUS[error.code], error.code, error.message, correlationId, error.detail);
      }
      throw error;
    }
  });
}

function registerIntegrityRoutes(app: FastifyInstance, integrity: IntegrityDeps, authorize: Authorize): void {
  const handle = async (
    request: FastifyRequest,
    reply: FastifyReply,
    run: (
      principal: Principal,
      correlationId: string,
    ) => Promise<{ readonly status: number; readonly body: unknown }>,
  ): Promise<FastifyReply> => {
    const correlationId = randomUUID();
    const principal = await authorize(request, reply, correlationId);
    if (principal === null) return reply;

    try {
      const result = await run(principal, correlationId);
      return reply.status(result.status).send(result.body);
    } catch (error) {
      if (error instanceof AdminRejected) {
        return fail(reply, ADMIN_ERROR_STATUS[error.code], error.code, error.message, correlationId, error.detail);
      }
      throw error;
    }
  };

  /** `owner/name` + 브랜치를 읽고 저장소 행을 찾는다. 없으면 404다. */
  const target = async (
    source: Record<string, unknown>,
  ): Promise<{ readonly repository: RepositoryRow; readonly baseBranch: string; readonly slug: string }> => {
    const raw = source['repository'];
    if (typeof raw !== 'string' || raw.split('/').length !== 2) {
      throw new AdminRejected('INVALID_PARAMETER', 'repository는 owner/name 형식이어야 한다');
    }
    const [owner, name] = raw.split('/') as [string, string];
    const baseBranch = source['base_branch'];
    if (typeof baseBranch !== 'string' || baseBranch.trim() === '') {
      throw new AdminRejected('INVALID_PARAMETER', 'base_branch가 필요하다');
    }
    const repository = await repositoryRepo.findRepositoryBySlug(integrity.pool, owner, name);
    if (repository === undefined) {
      throw new AdminRejected('NOT_FOUND', '등록되지 않은 저장소다', { repository: raw });
    }
    return { repository, baseBranch: baseBranch.trim(), slug: `${owner}/${name}` };
  };

  app.get(SEQUENCE_INTEGRITY_PATH, async (request, reply) =>
    handle(request, reply, async (principal, correlationId) => {
      const query = (request.query ?? {}) as Record<string, unknown>;
      const mode = parseIntegrityMode(query['mode']);
      if (mode === null) throw new AdminRejected('INVALID_PARAMETER', "mode는 'sample' 또는 'full'이어야 한다");

      const { repository, baseBranch, slug } = await target(query);
      const outcome = await runIntegrityCheck(integrity, { repository, baseBranch, mode });
      if (outcome.kind === 'not_found') throw new AdminRejected('NOT_FOUND', outcome.message);

      const space = `${slug}@${baseBranch}`;
      /*
       * **점검 결과는 감사 기록 대상이다** (FR-ADMIN-003 AC-5). 실패도 남긴다 —
       * 운영자가 "점검했는데 답이 없었다"를 나중에 추적할 수 있어야 한다.
       */
      await auditRepo.recordAudit(integrity.pool, {
        userId: principalId(principal),
        action: 'sequence_integrity.check',
        target: space,
        query: mode,
        resultCode: outcome.kind === 'failed' ? outcome.reason : outcome.consistent ? 'consistent' : 'mismatch',
        correlationId,
      });

      if (outcome.kind === 'failed') {
        return {
          status: 200,
          body: {
            sequence_space: space,
            seq_epoch: outcome.seqEpoch,
            mode,
            check_state: 'failed',
            reason: outcome.reason,
            message: outcome.message,
            correlation_id: correlationId,
          },
        };
      }

      return {
        status: 200,
        body: {
          sequence_space: space,
          seq_epoch: outcome.seqEpoch,
          mode,
          check_state: 'completed',
          checked_count: outcome.checkedCount,
          consistent: outcome.consistent,
          first_mismatch:
            outcome.firstMismatch === null
              ? null
              : {
                  merge_seq: outcome.firstMismatch.mergeSeq,
                  stored_commit_sha: outcome.firstMismatch.storedCommitSha,
                  actual_commit_sha: outcome.firstMismatch.actualCommitSha,
                },
          ...(outcome.impact === null ? {} : { impact_estimate: outcome.impact }),
          correlation_id: correlationId,
        },
      };
    }),
  );

  app.post(SEQUENCE_INTEGRITY_PATH, async (request, reply) =>
    handle(request, reply, async (principal, correlationId) => {
      const body = (request.body ?? {}) as Record<string, unknown>;
      if (body['action'] !== 'reassign') {
        throw new AdminRejected('INVALID_PARAMETER', "action은 'reassign'이어야 한다");
      }
      const { repository, baseBranch, slug } = await target(body);

      /*
       * **확인 문자열을 먼저 본다.** 잡을 만든 뒤에 확인하면 그 사이에 실패한
       * 요청이 활성 잡을 남긴다. 재채번은 비가역이므로 순서가 통제다 (FLOW-008).
       */
      if (!confirmationMatches(body['confirmation'], slug)) {
        throw new AdminRejected('CONFIRMATION_MISMATCH', '확인 문자열이 저장소 이름과 다르다', {
          expected: slug,
        });
      }

      const newEpoch = await expectedNewEpoch(integrity.pool, repository.repository_id, baseBranch);
      if (newEpoch === null) {
        throw new AdminRejected('NOT_FOUND', '채번된 적이 없는 시퀀스 공간이다', { base_branch: baseBranch });
      }

      const space = `${slug}@${baseBranch}`;
      const active = await jobRepo.findActiveJob(integrity.pool, 'sequence_reassign', space);
      if (active !== undefined) {
        throw new AdminRejected('JOB_CONFLICT', '같은 공간에 활성 재채번 잡이 이미 있다', { target: space });
      }

      const jobId = await jobRepo.enqueueJob(
        integrity.pool,
        'sequence_reassign',
        space,
        principalId(principal),
      );
      await auditRepo.recordAudit(integrity.pool, {
        userId: principalId(principal),
        action: 'sequence_integrity.reassign',
        target: space,
        resultCode: 'queued',
        correlationId,
      });

      return {
        status: 202,
        body: { job_id: jobId, type: 'sequence_reassign', state: 'queued', new_epoch_expected: newEpoch },
      };
    }),
  );
}
