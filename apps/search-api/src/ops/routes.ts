/**
 * `ops` 모듈 라우트 (API-ADM-003).
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
import type { DeadLetterFilter, DeadLetterState } from '@prs/db';
import { METRICS_CONTENT_TYPE, renderGauge } from '../metrics.js';
import {
  DEFAULT_LIST_STATES,
  ReprocessRejected,
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

export const DEAD_LETTER_PATH = '/api/v1/admin/dead-letters';
export const REPROCESS_PATH = '/api/v1/admin/dead-letters/reprocess';

const HTTP_STATUS: Readonly<Record<ReprocessRejected['code'], number>> = {
  RANGE_TOO_LARGE: 400,
  CONFIRMATION_MISMATCH: 400,
  INVALID_PARAMETER: 400,
};

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
  readonly adminToken: string;
}

export function registerOpsRoutes(app: FastifyInstance, options: OpsRouteOptions): void {
  const { adminToken, ...deps } = options;

  const authorize = (request: FastifyRequest, reply: FastifyReply, correlationId: string): boolean => {
    const token = bearer(request);
    if (token === undefined || !tokenMatches(token, adminToken)) {
      // 무엇이 틀렸는지는 말하지 않는다. 토큰 존재 여부도 정보다.
      void fail(reply, 401, 'UNAUTHENTICATED', '관리 API 인증에 실패했다', correlationId);
      return false;
    }
    return true;
  };

  app.get(DEAD_LETTER_PATH, async (request, reply) => {
    const correlationId = randomUUID();
    if (!authorize(request, reply, correlationId)) return reply;

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
      if (error instanceof ReprocessRejected) {
        return fail(reply, HTTP_STATUS[error.code], error.code, error.message, correlationId, error.detail);
      }
      throw error;
    }
  });

  app.post(REPROCESS_PATH, async (request, reply) => {
    const correlationId = randomUUID();
    if (!authorize(request, reply, correlationId)) return reply;

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
      if (error instanceof ReprocessRejected) {
        return fail(reply, HTTP_STATUS[error.code], error.code, error.message, correlationId, error.detail);
      }
      throw error;
    }
  });

  /**
   * 지표 노출 (FR-ING-007 AC-5).
   *
   * 인증을 걸지 않는다. 스크레이프는 클러스터 안에서 오고, 여기 나가는 값은
   * 상태별 건수뿐이라 전달 식별자나 오류 본문이 새지 않는다.
   */
  app.get('/metrics', async (_request, reply): Promise<string> => {
    const counts = await deadLetterRepo.countsByState(deps.pool);
    const samples = (Object.keys(counts) as DeadLetterState[]).map((state) => ({
      labels: { state },
      value: counts[state],
    }));
    const body = [
      renderGauge('dead_letter_total', '실패 대기열 항목 수 (상태별)', samples),
      renderGauge(
        'dead_letter_open_total',
        '아직 열려 있는 실패 대기열 항목 수. 100건 초과가 경보 임계다',
        [{ labels: {}, value: counts.pending + counts.reprocessing }],
      ),
    ].join('\n');
    return reply.type(METRICS_CONTENT_TYPE).send(`${body}\n`);
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
