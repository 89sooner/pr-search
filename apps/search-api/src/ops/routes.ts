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
import { deadLetterRepo } from '@prs/db';
import type { DeadLetterFilter, DeadLetterState, RepositoryStatus } from '@prs/db';
import type { AdminPrincipal } from '../config.js';
import type { AuthContext } from '../auth/context.js';
import {
  authenticateSession,
  authenticateToken,
  principalId,
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

export const DEAD_LETTER_PATH = '/api/v1/admin/dead-letters';
export const REPROCESS_PATH = '/api/v1/admin/dead-letters/reprocess';
export const REPOSITORIES_PATH = '/api/v1/admin/repositories';
export const PIPELINE_STATUS_PATH = '/api/v1/admin/pipeline-status';

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
}

export function registerOpsRoutes(app: FastifyInstance, options: OpsRouteOptions): void {
  const { adminTokens, auth, loginPath, registry, pipeline, ...deps } = options;

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

  if (pipeline !== undefined) {
    app.get(PIPELINE_STATUS_PATH, async (request, reply) => {
      const correlationId = randomUUID();
      if ((await authorize(request, reply, correlationId)) === null) return reply;
      return reply.send(await pipelineStatus(pipeline));
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
