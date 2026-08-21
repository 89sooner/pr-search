/**
 * `GET /search` (API-SRCH-004).
 *
 * 라우트가 하는 일은 셋뿐이다 — 파라미터를 검증하고, 서비스를 부르고, 오류를
 * 계약이 정한 모양으로 옮긴다. 질의 해석은 `@prs/query`, 질의 변환은 `@prs/es`,
 * 조회 순서는 `service.ts`가 갖는다.
 *
 * **문법·값 오류는 파서가 낸다** (CR-014, DEV-038). 여기서 다시 판정하지 않고
 * `QueryParseError`가 담아 온 코드와 오프셋을 그대로 실어 보낸다.
 */

import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { QUERY_KEYS, QueryParseError, parseQuery } from '@prs/query';
import { AccessScopeUnavailableError, PartialSearchError, SORT_KEYS, isSortKey } from '@prs/es';
import type { ErrorResponse } from '@prs/contracts';
import type { AuthContext } from '../auth/context.js';
import { authenticateSession } from '../auth/principal.js';
import { sendAuthError, toAuthError } from '../auth/errors.js';
import { DEFAULT_SORT_KEY } from '@prs/es';
import {
  clampSize,
  parseOrder,
  runSearch,
  type SearchDeps,
} from './service.js';

export const SEARCH_PATH = '/api/v1/search';

/** ES 조회 마감 (백엔드 아키텍처 8장: 의존 타임아웃 3초 → 504). */
export const SEARCH_TIMEOUT_MS = 3_000;

function fail(
  reply: FastifyReply,
  status: number,
  body: ErrorResponse,
): FastifyReply {
  return reply.status(status).send(body);
}

export interface SearchRouteOptions extends SearchDeps {
  readonly auth: AuthContext;
  readonly loginPath: string;
}

export function registerSearchRoutes(app: FastifyInstance, options: SearchRouteOptions): void {
  const { auth, loginPath, ...deps } = options;

  app.get(SEARCH_PATH, async (request, reply) => {
    const correlationId = randomUUID();
    const query = (request.query ?? {}) as Record<string, unknown>;

    // 1. 세션 검증.
    let userId: string;
    try {
      userId = (await authenticateSession(request, auth.sessions)).userId;
    } catch (error) {
      const shape = toAuthError(error, { correlationId, loginPath });
      if (shape !== null) return sendAuthError(reply, shape);
      throw error;
    }

    // 정렬 키 검증은 조회보다 먼저다 (FR-SRCH-007 AC-3). 400이 될 요청으로
    // Elasticsearch를 부르지 않는다.
    const rawSort = query['sort'];
    const sortKey = rawSort === undefined || rawSort === '' ? DEFAULT_SORT_KEY : String(rawSort);
    if (!isSortKey(sortKey)) {
      return fail(reply, 400, {
        error: {
          code: 'INVALID_PARAMETER',
          message: `지원하지 않는 정렬 키입니다: '${sortKey}'`,
          detail: { field: 'sort', supported_keys: [...SORT_KEYS] },
        },
        correlation_id: correlationId,
      });
    }

    // 2. 질의 파싱. 문법·값 오류는 파서가 코드와 오프셋을 함께 준다.
    const raw = typeof query['q'] === 'string' ? query['q'] : '';
    let ast;
    try {
      ast = parseQuery(raw);
    } catch (error) {
      if (error instanceof QueryParseError) {
        return fail(reply, 400, {
          error: {
            code: error.code,
            message: error.message,
            detail: { ...error.detail, supported_keys: [...QUERY_KEYS] },
          },
          correlation_id: correlationId,
        });
      }
      throw error;
    }

    // 3. 접근 범위 산출. 실패하면 503, 부분 결과 없음 (FR-AUTH-002 AC-3).
    try {
      const scope = await auth.scopes.resolve(userId);
      const result = await runSearch(
        { ast, scope, sortKey, order: parseOrder(query['order']), size: clampSize(query['size']) },
        deps,
      );

      return reply.send({
        query: raw,
        parsed: ast,
        total: result.total,
        sort: result.sort,
        items: result.items,
        // 0건이 아니면 키를 넣지 않는다 — 빈 배열은 "완화할 것이 없다"로 읽힌다.
        ...(result.total.value === 0
          ? {
              relaxation_hints: result.relaxation.hints,
              ...(result.relaxation.truncated ? { relaxation_hints_truncated: true } : {}),
            }
          : {}),
        // 레지스트리에서 못 찾은 이름. 조용히 0건을 내지 않는다 (CR-016, DEV-052).
        ...(result.unresolved.length === 0 ? {} : { unresolved_names: result.unresolved }),
        // WP-032 전까지 늘 `null`이다. 키를 빼면 화면이 마지막 페이지를 오해한다.
        next_cursor: null,
        correlation_id: correlationId,
      });
    } catch (error) {
      const shape = toAuthError(error, { correlationId, loginPath });
      if (shape !== null) return sendAuthError(reply, shape);

      if (error instanceof AccessScopeUnavailableError) {
        // 볼 수 있는 저장소가 하나도 없다. 빈 목록이 아니라 명시적 실패다.
        return fail(reply, 503, {
          error: { code: 'PERMISSION_UNAVAILABLE', message: '접근 권한을 확인할 수 없어 조회를 거부한다' },
          correlation_id: correlationId,
        });
      }

      if (error instanceof PartialSearchError) {
        // 한 인덱스가 통째로 빠진 결과를 200으로 내보내지 않는다 (DEV-054).
        return fail(reply, 504, {
          error: { code: 'SEARCH_TIMEOUT', message: '검색이 부분 결과만 얻어 조회를 거부한다' },
          correlation_id: correlationId,
        });
      }

      throw error;
    }
  });
}
