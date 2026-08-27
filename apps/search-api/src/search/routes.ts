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
import { toAccessScope } from '@prs/authz';
import { AccessScopeUnavailableError, PartialSearchError, SORT_KEYS, isSortKey } from '@prs/es';
import type { ErrorResponse } from '@prs/contracts';
import type { AuthContext } from '../auth/context.js';
import { authenticateSession } from '../auth/principal.js';
import { sendAuthError, toAuthError } from '../auth/errors.js';
import { DEFAULT_SORT_KEY } from '@prs/es';
import { CursorInvalidError, CursorQueryMismatchError } from '../cursor/envelope.js';
import { readCursor, readFacets } from '../cursor/params.js';
import { facetResponseFields } from './facets.js';
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

/**
 * 커서 오류를 계약 모양으로 (CR-043, DEV-273).
 *
 * **두 코드가 다른 사실을 말한다.** 둘 다 사용자를 첫 페이지로 되돌리지만
 * 하나는 "조건이 바뀌었다"이고 다른 하나는 "이 커서를 쓸 수 없다"이다.
 * 자동 재시도 루프를 만들지 않는다 — 화면이 안내하고 사용자가 정한다.
 */
function toCursorError(error: unknown, correlationId: string): ErrorResponse | null {
  if (error instanceof CursorQueryMismatchError) {
    return {
      error: {
        code: 'CURSOR_QUERY_MISMATCH',
        message: '검색 조건이 바뀌어 이어 보기를 계속할 수 없습니다. 첫 페이지부터 다시 봅니다.',
      },
      correlation_id: correlationId,
    };
  }
  if (error instanceof CursorInvalidError) {
    return {
      error: {
        code: 'CURSOR_INVALID',
        message: '이어 보기 정보를 사용할 수 없습니다. 첫 페이지부터 다시 봅니다.',
      },
      correlation_id: correlationId,
    };
  }
  return null;
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
      /*
       * **한 번만 산출한다** (CR-043, DEV-272).
       *
       * 지문에 `access_scope_version`이 들어가므로 범위와 버전이 함께 필요한데,
       * `resolve()`는 버전을 버린다. 같은 요청에서 두 번 부르면 그 사이에 회수가
       * 끼어들어 **질의에 쓴 범위와 지문에 쓴 버전이 어긋날 수 있다.**
       */
      const cached = await auth.scopes.resolveCached(userId);
      const scope = toAccessScope(cached);
      const result = await runSearch(
        {
          ast,
          scope,
          scopeVersion: cached.version,
          sortKey,
          order: parseOrder(query['order']),
          size: clampSize(query['size']),
          cursor: readCursor(query),
          facets: readFacets(query),
        },
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
        // 세 키는 함께 나타나거나 함께 빠진다 (CR-019, DEV-076).
        ...facetResponseFields(result.facets),
        // 마지막 페이지에서 `null`이다 (AC-1). 키를 빼면 화면이 그것을 오해한다.
        next_cursor: result.nextCursor,
        correlation_id: correlationId,
      });
    } catch (error) {
      const cursorError = toCursorError(error, correlationId);
      // 커서 실패는 400이다 — 서버 잘못이 아니라 이 커서를 쓸 수 없다는 사실이다.
      if (cursorError !== null) return fail(reply, 400, cursorError);

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
