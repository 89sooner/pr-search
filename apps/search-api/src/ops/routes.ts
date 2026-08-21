/**
 * `ops` 모듈 라우트 (API-ADM-001, API-ADM-003, API-ADM-006).
 *
 * **토큰이 없으면 이 경로를 등록하지 않는다** (CR-012, DEV-025). 최종 권한은
 * `operator` 역할이고 그 판정은 WP-012의 OIDC 세션이 세우지만, REL-001에는
 * 사용자 신원 자체가 없다. 그 사이에 인증 없이 열린 변경 API를 두는 것보다
 * 경로가 없는 편이 낫다.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import type { ErrorResponse } from '@prs/contracts';
import { deadLetterRepo } from '@prs/db';
import type { DeadLetterFilter, DeadLetterState, RepositoryStatus } from '@prs/db';
import { auditUserId, type AdminPrincipal } from '../config.js';
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

/** 길이 노출과 조기 반환을 막는 상수 시간 비교. */
function tokenMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

function bearer(request: FastifyRequest): string | undefined {
  const header = request.headers.authorization;
  if (typeof header !== 'string') return undefined;
  const match = /^Bearer (.+)$/.exec(header);
  return match?.[1];
}

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
  readonly adminTokens: readonly AdminPrincipal[];
  /** 저장소 등록 의존. 없으면 등록 경로를 달지 않는다 (API-ADM-001). */
  readonly registry?: RegistryDeps;
  /** 파이프라인 상태 의존. 없으면 상태 경로를 달지 않는다 (API-ADM-006). */
  readonly pipeline?: PipelineStatusDeps;
}

export function registerOpsRoutes(app: FastifyInstance, options: OpsRouteOptions): void {
  const { adminTokens, registry, pipeline, ...deps } = options;

  /**
   * 토큰을 주체로 바꾼다.
   *
   * 일치하는 것을 찾아도 **끝까지 돈다.** 처음 일치에서 멈추면 비교 횟수가
   * 토큰 위치를 알려 준다.
   */
  const authorize = (
    request: FastifyRequest,
    reply: FastifyReply,
    correlationId: string,
  ): AdminPrincipal | null => {
    const token = bearer(request);
    let matched: AdminPrincipal | null = null;
    if (token !== undefined) {
      for (const principal of adminTokens) {
        if (tokenMatches(token, principal.token)) matched = principal;
      }
    }
    if (matched === null) {
      // 무엇이 틀렸는지는 말하지 않는다. 토큰 존재 여부도 정보다.
      void fail(reply, 401, 'UNAUTHENTICATED', '관리 API 인증에 실패했다', correlationId);
    }
    return matched;
  };

  app.get(DEAD_LETTER_PATH, async (request, reply) => {
    const correlationId = randomUUID();
    if (authorize(request, reply, correlationId) === null) return reply;

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
    if (authorize(request, reply, correlationId) === null) return reply;

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
      if (authorize(request, reply, correlationId) === null) return reply;
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
) => AdminPrincipal | null;

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
      principal: AdminPrincipal,
      correlationId: string,
    ) => Promise<{ readonly status: number; readonly body: unknown }>,
  ): Promise<FastifyReply> => {
    const correlationId = randomUUID();
    const principal = authorize(request, reply, correlationId);
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
        auditUserId(principal),
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
        auditUserId(principal),
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
        auditUserId(principal),
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
