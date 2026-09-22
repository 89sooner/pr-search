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
import { auditFailedTotal, recordAuditBestEffort } from '../audit/recorder.js';
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
  resolveJobTarget,
  isCreatableGenericJobType,
  isJobAction,
  toJobResponse,
  CREATABLE_GENERIC_JOB_TYPES,
  JOB_ACTIONS,
} from './jobs.js';
import { startReindex, type ReindexDeps } from './reindex.js';
import { listRawEvents, parseRawEventFilter, type RawEventsDeps } from './raw-events.js';
import { indexStatus, type IndexStatusDeps } from './index-status.js';
import {
  dismissRequest,
  listRequests,
  parseRequestFilter,
  parseRequestLimit,
  parseResolutionNote,
  toAdminRequestView,
  type RequestQueueDeps,
} from './registration-requests.js';
import { CursorInvalidError, CursorQueryMismatchError } from '../cursor/envelope.js';
import { jobRepo, repositoryRepo } from '@prs/db';
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

/** API-ADM-009 등록 검토 요청 대기열 (WP-040 / CR-055). */
export const REGISTRATION_REQUESTS_ADMIN_PATH = '/api/v1/admin/repository-registration-requests';
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
  /**
   * 등록 검토 요청 대기열 의존 (API-ADM-009).
   *
   * 커서 서명 키가 있어야 순회가 성립한다. 없으면 경로를 달지 않는다 —
   * 서명하지 못하는 프로세스가 커서를 내면 그것은 위조 가능한 값이다.
   */
  readonly requestQueue?: RequestQueueDeps;
  /**
   * 색인 상태 조회 의존 (API-ADM-004 `GET`).
   *
   * 별칭 통계를 읽는 포트가 있어야 답할 수 있다. 없으면 경로를 달지 않는다 —
   * 등록해 두고 매번 전부 미확인으로 답하는 것보다 없는 편이 정직하다.
   */
  readonly indexStatus?: IndexStatusDeps;
}

export function registerOpsRoutes(app: FastifyInstance, options: OpsRouteOptions): void {
  const {
    adminTokens,
    auth,
    loginPath,
    registry,
    pipeline,
    integrity,
    reindex,
    rawEvents,
    requestQueue,
    indexStatus: indexStatusDeps,
    ...deps
  } = options;

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
    const principal = await authorize(request, reply, correlationId);
    if (principal === null) return reply;

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
      /*
       * **재처리 실행은 감사 기록 대상이다** (`FR-AUTH-004` AC-1 "재처리 실행").
       * 원장 7장이 "재처리 실행이 감사 기록에 남지 않음"을 알려진 제한으로
       * 등재해 두었던 자리다 — `WP-010`이 감사 적재를 세우고도 이 경로에
       * 붙이지 않았다.
       */
      await recordAuditBestEffort(
        deps.pool,
        {
          userId: principalId(principal),
          action: 'dead_letter.reprocess',
          /*
           * **전달 식별자 목록이다** (`FR-AUTH-004` 정본 표, PR #84 리뷰 P1).
           *
           * 내부 `dead_letter_id`는 그 행을 가리킬 뿐이고, 필터 문자열은
           * 무엇이 재처리됐는지 말하지 않는다 — **필터의 일치 집합은 직후에
           * 달라질 수 있으므로** 그 조건만 남기면 재구성이 불가능하다. 서버가
           * 확정한 대상을 그대로 적는다.
           */
          target: result.delivery_ids.join(','),
          // 어떻게 골랐는지는 조건이므로 `query`가 담는다.
          query: JSON.stringify({
            dead_letter_ids: deadLetterIds ?? null,
            filter: filter ?? null,
          }),
          resultCode: String(result.reinjected),
          correlationId,
        },
        deps.log,
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
  if (indexStatusDeps !== undefined) registerIndexStatusRoute(app, indexStatusDeps, authorize);
  if (requestQueue !== undefined) registerRequestQueueRoutes(app, requestQueue, authorize);

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
        const result = await listRawEvents(rawEvents, filter, cached.repositoryIds);

        /*
         * **원본 열람은 감사에 남는다** (PR #66 리뷰 P1 / 보안 문서 7장).
         *
         * 계약이 "`include_payload=true`는 명시적 열람 의사이며 감사 기록에 그대로
         * 남는다"라고 정했는데 구현이 그것을 따르지 않았다 — 내가 적은 계약을 내
         * 구현이 지키지 않은 자리다. 목록 조회 자체는 남기지 않는다: 원본을 펼친
         * 요청만이 되돌릴 수 없는 노출이고, 모든 조회를 남기면 그 신호가 묻힌다.
         */
        if (filter.includePayload) {
          /*
           * **감사 적재 실패가 조회를 막지 않는다** (PR #67 리뷰 P1 / WP-039 규율).
           *
           * 파티션이 없거나 쓰기가 일시적으로 실패하면 이 await가 거절되고, 감싸지
           * 않으면 **이미 가져온 결과를 버리고 500이 된다.** 감사는 조회의 부수
           * 기록이지 전제가 아니다. 대신 실패를 세어 경보에 올린다.
           *
           * **질의는 적용된 조건 전부를 담는다** (PR #67 리뷰 P2). 일부만 담으면
           * 그 기록으로 무엇을 열람했는지 재구성할 수 없고, `FR-AUTH-004` AC-2가
           * 요구하는 것이 바로 재구성 가능한 질의 문자열이다.
           */
          await recordAuditBestEffort(
            deps.pool,
            {
              userId: principalId(principal),
              action: 'raw_event.view_payload',
              target: filter.deliveryId ?? filter.repository ?? '(범위 전체)',
              query: JSON.stringify({
                delivery_id: filter.deliveryId ?? null,
                repository: filter.repository ?? null,
                event_type: filter.eventType ?? null,
                action: filter.action ?? null,
                received_from: filter.receivedFrom ?? null,
                received_to: filter.receivedTo ?? null,
                limit: filter.limit,
                /*
                 * **커서 원문을 남긴다** (PR #68 리뷰 P2). `paged: true`만 두면
                 * 같은 조건의 2쪽과 5쪽이 **구분되지 않는 기록**을 남기는데,
                 * 그 둘은 서로 다른 payload를 내준다. 커서는 `search_after`
                 * 위치를 담으므로 그것이 곧 "어느 페이지를 열람했는가"다.
                 *
                 * 봉투는 서명될 뿐 비밀을 담지 않는다 — 지문은 해시이고 위치는
                 * 요청자가 이미 들고 있던 값이다.
                 */
                cursor: filter.cursor ?? null,
              }),
              resultCode: String(result.items.length),
              correlationId,
            },
            deps.log,
          );
        }

        return reply.send(result);
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
    return reply.type(METRICS_CONTENT_TYPE).send(renderMetrics([byState, open, auditFailedTotal]));
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
          /*
           * **종료된 요청은 목록이다** (FR-ING-009 AC-11, CR-055). 개수만 주면
           * 화면이 어느 요청이 닫혔는지 알 수 없어 대기열을 통째로 다시 읽어야
           * 한다. ID만 싣는다 — 요청자·사유는 A-002의 대기열이 이미 갖고 있다.
           */
          fulfilled_request_ids: result.fulfilledRequests.map((one) => String(one.request_id)),
          sequence_job_ids: result.sequenceJobIds,
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
    handle(request, reply, async (principal, correlationId) => {
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
      /*
       * **`target`은 유형마다 다른 재료에서 서버가 만든다** (CR-055).
       * `reconcile`은 대상이 하나뿐이고 `sequence_assign`은 저장소와 브랜치
       * 둘을 받는다 — 문자열을 그대로 받으면 서로 다른 시퀀스 공간이 같은
       * 문자열로 충돌하거나 채번 대상이 아닌 브랜치가 큐에 들어간다.
       */
      const resolved = await resolveJobTarget(registry.pool, body['type'], body);
      if (resolved.kind === 'invalid_parameter') {
        throw new AdminRejected('INVALID_PARAMETER', resolved.message, resolved.detail);
      }
      if (resolved.kind === 'unknown_repository') {
        /*
         * 여기서도 감사를 남긴다 — 아래 `job.run` 기록은 잡 생성까지 간 요청만
         * 지나므로, 대상 해석에서 거절된 요청이 흔적 없이 사라지면 "왜 그
         * 잡이 돌지 않았는가"를 추적할 수 없다 (FR-ADMIN-002 AC-5).
         */
        await recordAuditBestEffort(
          registry.pool,
          {
            userId: principalId(principal),
            action: 'job.run',
            target: `${body['type']}:${typeof body['repository'] === 'string' ? body['repository'] : String(body['target'])}`,
            resultCode: 'NOT_FOUND',
            correlationId,
          },
          registry.log,
        );
        throw new AdminRejected('NOT_FOUND', '등록되지 않은 저장소다');
      }
      const target = resolved.target;

      const outcome = await createJob(registry.pool, body['type'], target, principalId(principal), resolved.progress ?? {});

      /*
       * **잡 제어는 감사 기록 대상이다** (`FR-ADMIN-002` AC-5). 거절도 남긴다 —
       * "왜 그 백필이 돌지 않았는가"를 나중에 추적하려면 요청이 있었다는 사실이
       * 있어야 한다.
       *
       * **`reindex.start`를 함께 남기지 않는다.** 이 경로는 `reindex`를 아예
       * 받지 않고(`API-ADM-004`가 그 진입점이다) 저장소 등록의 `backfill=true`도
       * 여기를 지나지 않는다 — **사용자가 누른 것 하나만 기록한다** (CR-054).
       */
      await recordAuditBestEffort(
        registry.pool,
        {
          userId: principalId(principal),
          action: 'job.run',
          target: `${body['type']}:${target}`,
          resultCode: outcome.kind === 'created' ? 'created' : 'JOB_CONFLICT',
          correlationId,
        },
        registry.log,
      );

      if (outcome.kind === 'conflict') {
        /*
         * **실행 중 잡 식별자를 함께 준다** (FR-ADMIN-002 AC-4, QA-A003-03,
         * PR #89 리뷰 P2). 대상만 돌려주면 화면이 "이미 돌고 있다"까지만 말하고
         * **운영자가 그 잡을 찾아갈 곳이 없다.**
         */
        throw new AdminRejected('JOB_CONFLICT', '같은 대상에 활성 잡이 이미 있다', {
          target,
          job_id: outcome.jobId,
        });
      }
      return { status: 201, body: toJobResponse(outcome.job) };
    }),
  );

  app.patch(`${JOBS_PATH}/:job_id`, async (request, reply) =>
    handle(request, reply, async (principal, correlationId) => {
      const body = (request.body ?? {}) as Record<string, unknown>;
      const action = body['action'];
      if (!isJobAction(action)) {
        throw new AdminRejected('INVALID_PARAMETER', `action은 ${JOB_ACTIONS.join('·')} 중 하나여야 한다`);
      }

      const jobId = jobIdOf(request);
      const outcome = await applyJobAction(registry.pool, jobId, action);

      /*
       * **셋 다 기록한다** (`FR-ADMIN-002` AC-5, CR-054 DEV-404). 이전 계약은
       * `job.{run,cancel}` 둘만 적어 **`pause`·`resume`가 승인된 채로 감사에서
       * 사라졌다** — 실제 API가 받는 값이 어휘의 정본이다.
       */
      await recordAuditBestEffort(
        registry.pool,
        {
          userId: principalId(principal),
          action: `job.${action}`,
          target: outcome.kind === 'ok' ? `${outcome.job.type}:${String(jobId)}` : String(jobId),
          resultCode: outcome.kind === 'ok' ? outcome.job.state : outcome.kind,
          correlationId,
        },
        registry.log,
      );

      if (outcome.kind === 'not_found') throw new AdminRejected('NOT_FOUND', '잡을 찾을 수 없다');
      if (outcome.kind === 'unsupported_action') {
        /*
         * 러너가 지원하지 않는 동작이다 (PR #89 리뷰 P2). 허용 목록을 함께
         * 줘서 클라이언트가 무엇을 할 수 있는지 바로 알게 한다.
         */
        throw new AdminRejected('INVALID_PARAMETER', `${outcome.type} 잡은 ${action}을 지원하지 않는다`, {
          type: outcome.type,
          allowed_actions: [...outcome.allowed],
        });
      }
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
          /*
           * 저장소별 표기 해제 (WP-075 / FR-SEQ-009 AC-6).
           *
           * **기존 `repository.update` 경로에 얹는다.** 작은 토글 하나에 새 API와
           * 새 감사 액션을 만들면 같은 행위가 두 이름으로 기록되고, 운영자는 저장소
           * 설정을 바꾸는 자리를 둘 외워야 한다. 꺼도 채번은 계속되며 표기만 멈춘다.
           */
          ...(typeof body['annotate_enabled'] === 'boolean'
            ? { annotate_enabled: body['annotate_enabled'] }
            : {}),
          // 저장소별 태그 해제 (WP-100 / FR-SEQ-012 AC-9). 표기와 같은 자리, 같은 규율이다 — 꺼도 채번은 계속된다.
          ...(typeof body['tag_enabled'] === 'boolean' ? { tag_enabled: body['tag_enabled'] } : {}),
        },
        principalId(principal),
        correlationId,
        /*
         * 표기 재개 (WP-075 안전성 보강).
         *
         * 권한 차단과 본문 불일치 정지는 **스스로 풀리지 않는다** — 앞의 것은 조회
         * 성공을 쓰기 권한의 증거로 삼지 않기 때문이고, 뒤의 것은 자동 재시도가 이미
         * 확인된 차이를 덮기 때문이다. 둘을 여는 유일한 문이 이 플래그이며, 여는
         * 것은 다음 시도의 자격뿐이고 이미 붙은 제목은 그대로다.
         */
        { ...(body['annotate_resume'] === true ? { resumeAnnotation: true } : {}) },
      );
      /*
       * **응답 모양은 `POST`와 같다** — 저장소 필드를 펼치고 이번 조작이 만든
       * 것을 곁들인다. 다른 모양으로 만들면 두 경로를 함께 쓰는 화면이 응답마다
       * 다르게 읽어야 한다.
       */
      return {
        status: 200,
        body: {
          ...updated.repository,
          sequence_job_ids: updated.sequenceJobIds,
          // 재개를 요청했을 때만 실린다. 무엇이 열렸는지 운영자가 바로 본다.
          ...(updated.annotateResumed === undefined ? {} : { annotate_resumed: updated.annotateResumed }),
        },
      };
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

      /*
       * **`reindex.start` 하나만 남긴다** (CR-054). 이 경로가 `job` 행을 만들지만
       * `job.run`을 함께 기록하지 않는다 — 사용자가 누른 것은 재색인 하나이고,
       * 같은 행위를 두 번 세면 감사 로그에서 실제 실행 횟수를 알 수 없게 된다.
       */
      await recordAuditBestEffort(
        reindex.pool,
        {
          userId: principalId(principal),
          action: 'reindex.start',
          target: typeof body['alias'] === 'string' ? body['alias'] : String(body['alias']),
          resultCode: 'accepted',
          correlationId,
        },
        reindex.log,
      );

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
      await recordAuditBestEffort(
        integrity.pool,
        {
          userId: principalId(principal),
          action: 'sequence_integrity.check',
          target: space,
          query: mode,
          resultCode:
            outcome.kind === 'failed' ? outcome.reason : outcome.consistent ? 'consistent' : 'mismatch',
          correlationId,
        },
        integrity.log,
      );

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
      /*
       * **`sequence.reassign`이 정본이다** (CR-054, DEV-405). 이 자리는
       * `WP-028`이 `sequence_integrity.reassign`을 썼고 자동 경로(`pipeline-worker`)는
       * 처음부터 `sequence.reassign`을 썼다 — **같은 사실이 두 이름으로 남았다.**
       * 신규 쓰기를 하나로 모으되 **이미 저장된 옛 행은 고치지 않는다**
       * (`FR-AUTH-004` AC-3). `API-ADM-005`의 `action` 필터가 그 값도 받는다.
       */
      await recordAuditBestEffort(
        integrity.pool,
        {
          userId: principalId(principal),
          action: 'sequence.reassign',
          target: `${space}@${String(newEpoch)}`,
          resultCode: 'queued',
          correlationId,
        },
        integrity.log,
      );

      return {
        status: 202,
        body: { job_id: jobId, type: 'sequence_reassign', state: 'queued', new_epoch_expected: newEpoch },
      };
    }),
  );
}

/**
 * API-ADM-004 `GET` 색인 상태 (WP-040 / FR-ING-008 AC-7, CR-055).
 *
 * 재색인 실행과 **같은 자원**이므로 새 경로가 아니라 같은 경로의 `GET`이다.
 */
function registerIndexStatusRoute(
  app: FastifyInstance,
  deps: IndexStatusDeps,
  authorize: Authorize,
): void {
  app.get(REINDEX_PATH, async (request, reply) => {
    const correlationId = randomUUID();
    if ((await authorize(request, reply, correlationId)) === null) return reply;
    return reply.send({ ...(await indexStatus(deps)), correlation_id: correlationId });
  });
}

/**
 * API-ADM-009 등록 검토 요청 조회·종료 (WP-040 / FR-ING-009 AC-11, CR-055).
 *
 * **`API-ING-003`과 합치지 않는다.** 그쪽은 일반 사용자가 요청을 남기는 자리이고
 * 응답은 "기록했다"뿐이다 (AC-10). 한 엔드포인트가 역할에 따라 다른 모양을
 * 내면 그 분기 하나가 빠지는 날 처리 상태가 요청자에게 새어 나간다 (THR-045).
 */
function registerRequestQueueRoutes(
  app: FastifyInstance,
  queue: RequestQueueDeps,
  authorize: Authorize,
): void {
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
      /*
       * 커서 오류 둘을 여기서 가른다. **지문 불일치는 `CURSOR_QUERY_MISMATCH`**
       * 이며 `CURSOR_INVALID`가 아니다 — 커서 자체는 멀쩡하고 조건이 달라진
       * 것이므로, 코드를 섞으면 클라이언트가 "첫 페이지로"라는 정해진 처리를
       * 하지 못한다 (PR #88 리뷰 P2).
       */
      if (error instanceof CursorQueryMismatchError) {
        return fail(reply, 400, 'CURSOR_QUERY_MISMATCH', error.message, correlationId);
      }
      if (error instanceof CursorInvalidError) {
        return fail(reply, 400, 'CURSOR_INVALID', error.message, correlationId);
      }
      throw error;
    }
  };

  app.get(REGISTRATION_REQUESTS_ADMIN_PATH, async (request, reply) =>
    handle(request, reply, async (_principal, correlationId) => {
      const query = (request.query ?? {}) as Record<string, unknown>;
      const page = await listRequests(
        queue,
        parseRequestFilter(query),
        parseRequestLimit(query['limit']),
        typeof query['cursor'] === 'string' ? query['cursor'] : undefined,
      );
      /*
       * **`total`을 내지 않는다.** 세려면 전량을 훑어야 하고, 화면이 필요로 하는
       * 것은 "처리할 것이 남았는가"이며 그것은 `next_cursor`가 답한다.
       *
       * **이 조회 자체는 감사 대상이 아니다** — `FR-AUTH-004` AC-1의 정본 표가
       * 감사 대상을 정하고 운영 목록 조회는 그 표에 없다.
       */
      return {
        status: 200,
        body: { items: page.items, next_cursor: page.nextCursor, correlation_id: correlationId },
      };
    }),
  );

  app.patch(`${REGISTRATION_REQUESTS_ADMIN_PATH}/:request_id`, async (request, reply) =>
    handle(request, reply, async (principal, correlationId) => {
      const body = (request.body ?? {}) as Record<string, unknown>;
      /*
       * **`dismiss` 하나만 받는다** (CR-055). `approve`를 만들지 않는 이유는
       * 승인이 성공한 등록 그 자체이기 때문이다 — `API-ADM-001`의 `POST`가
       * 같은 식별자의 대기 중 요청을 종료한다.
       */
      if (body['action'] !== 'dismiss') {
        throw new AdminRejected('INVALID_PARAMETER', "action은 'dismiss'여야 한다");
      }
      const note = parseResolutionNote(body['reason']);
      const requestId = requestIdOf(request);
      const outcome = await dismissRequest(queue, requestId, note, principalId(principal));

      /*
       * **감사에는 `query` 칸에 메모가 간다** (`FR-AUTH-004` AC-1의 정본 표).
       * `audit_record`의 자유 칸은 `target`과 `query` 둘뿐이라 다른 이름을 쓰면
       * 저장할 수 없는 필드를 가리키게 된다 (PR #88 리뷰 P1).
       *
       * 거절도 남긴다 — "왜 그 요청이 아직 열려 있는가"를 추적하려면 시도가
       * 있었다는 사실이 있어야 한다.
       */
      await recordAuditBestEffort(
        queue.pool,
        {
          userId: principalId(principal),
          action: 'repository_registration_request.dismiss',
          target: String(requestId),
          ...(note === null ? {} : { query: note }),
          resultCode: outcome.kind === 'ok' ? 'dismissed' : outcome.kind,
          correlationId,
        },
        queue.log,
      );

      if (outcome.kind === 'not_found') throw new AdminRejected('NOT_FOUND', '등록 검토 요청을 찾을 수 없다');
      if (outcome.kind === 'invalid_transition') {
        // 현재 상태를 함께 준다 — 운영자가 왜 안 되는지 알아야 다음을 고른다.
        throw new AdminRejected('INVALID_PARAMETER', `${outcome.status} 상태의 요청은 종료할 수 없다`, {
          status: outcome.status,
        });
      }
      return { status: 200, body: toAdminRequestView(outcome.request) };
    }),
  );
}

/** 경로 파라미터의 요청 식별자. 정수가 아니면 400이다. */
function requestIdOf(request: FastifyRequest): number {
  const raw = (request.params as { request_id?: string }).request_id;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new AdminRejected('INVALID_PARAMETER', 'request_id는 양의 정수다');
  }
  return value;
}
