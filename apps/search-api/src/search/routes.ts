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
import { QUERY_KEYS, QueryParseError, SEQUENCE_BINDING_MESSAGE, parseQuery } from '@prs/query';
import { toAccessScope } from '@prs/authz';
import { AccessScopeUnavailableError, PartialSearchError, SORT_KEYS, isSortKey } from '@prs/es';
import type { ErrorResponse } from '@prs/contracts';
import type { Pool } from '@prs/db';
import type { AuthContext } from '../auth/context.js';
import { authenticateSession } from '../auth/principal.js';
import { sendAuthError, toAuthError } from '../auth/errors.js';
import { DEFAULT_SORT_KEY } from '@prs/es';
import { CursorInvalidError, CursorQueryMismatchError } from '../cursor/envelope.js';
import { recordAuditBestEffort } from '../audit/recorder.js';
import { readCursor, readFacets } from '../cursor/params.js';
import { facetResponseFields } from './facets.js';
import { resolveSequenceContext, type SequenceContextOutcome } from './sequence-context.js';
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

/**
 * 시퀀스 인용 판정을 계약이 정한 응답으로 (CR-051).
 *
 * **새 오류 코드를 만들지 않는다.** 부족한 것은 파라미터이고(`INVALID_PARAMETER`),
 * 확인할 수 없는 것은 자원이다(`NOT_FOUND`). `detail.reason`이 사유를 가른다.
 *
 * @returns 조회를 계속해도 되면 `null`.
 */
/**
 * 시퀀스 문맥 판정을 HTTP 응답으로 옮긴다.
 *
 * **집계 API도 이것을 쓴다** (CR-053). 같은 판정을 각자 옮기면 `/search`와
 * `/analytics`가 같은 상황에 다른 상태 코드를 내는 날이 오고, 그때 화면은
 * 한쪽만 처리한다.
 */
export function toSequenceFailure(
  outcome: SequenceContextOutcome,
  correlationId: string,
): { readonly status: number; readonly body: ErrorResponse } | null {
  if (outcome.kind === 'unbindable') {
    return {
      status: 400,
      body: {
        error: {
          code: 'INVALID_PARAMETER',
          message: SEQUENCE_BINDING_MESSAGE[outcome.reason],
          detail: { field: 'q', reason: outcome.reason, required_keys: ['repo', 'base'] },
        },
        correlation_id: correlationId,
      },
    };
  }
  if (outcome.kind === 'bad_epoch_param') {
    return {
      status: 400,
      body: {
        error: {
          code: 'INVALID_PARAMETER',
          message: '시퀀스 에폭은 1 이상의 정수여야 합니다',
          detail: { field: 'seq_epoch' },
        },
        correlation_id: correlationId,
      },
    };
  }
  if (outcome.kind === 'orphan_epoch_param') {
    return {
      status: 400,
      body: {
        error: {
          code: 'INVALID_PARAMETER',
          message: 'seq_epoch은 seq: 범위 조건이 있는 질의에서만 의미가 있습니다',
          detail: { field: 'seq_epoch', reason: 'sequence_reference_absent' },
        },
        correlation_id: correlationId,
      },
    };
  }
  if (outcome.kind === 'space_unavailable') {
    /*
     * 미등록·범위 밖·미채번을 구분하지 않는다 (THR-006, CR-027 DEV-137).
     * 구분하는 순간 이 경로가 비공개 저장소의 존재 신탁이 된다.
     */
    return {
      status: 404,
      body: {
        error: { code: 'NOT_FOUND', message: '이 seq: 조건을 해석할 시퀀스 공간을 확인할 수 없습니다.' },
        correlation_id: correlationId,
      },
    };
  }
  return null;
}

/**
 * 라우트가 조회 서비스보다 하나 더 갖는 것 (CR-051).
 *
 * `pool`이 `SearchDeps`가 아니라 여기 있는 이유는 **`runSearch`가 그것을
 * 쓰지 않기 때문**이다. 시퀀스 공간 해석은 접근 통제를 지나는 일이라
 * 라우트의 4-1단계이고, 조회 서비스는 확정된 에폭만 받는다 (백엔드
 * 아키텍처 6.1). 의존을 쓰지 않는 계층에 얹으면 그 계층의 시험이 쓰지도
 * 않을 대역을 만들게 된다.
 *
 * **선택이 아니다** — 빠지면 `seq:` 질의만 조용히 실패한다.
 */
export interface SearchRouteOptions extends SearchDeps {
  /** M 번호 기능 (WP-074). 꺼져 있으면 목록 응답에서 M 키가 생략된다. */
  readonly mergeNumberEnabled?: boolean;
  readonly pool: Pool;
  readonly auth: AuthContext;
  readonly loginPath: string;
}

/**
 * 검색 실행 감사 (`FR-AUTH-004` AC-1 "검색 실행", WP-039).
 *
 * **`target`은 `null`이다** (AC-2, CR-054 DEV-415). 검색은 대상이 하나가
 * 아니므로 그 칸에 담을 식별자가 없고, 질의 문자열은 `query`가 담는다 —
 * 두 칸은 서로 다른 것을 담으며 `ENT-CORE-007`이 따로 둔 이유가 그것이다.
 *
 * **에폭이 낡아 조회를 실행하지 않은 경우도 남긴다.** 사용자가 무엇을 물었는지가
 * 감사의 대상이지 서버가 답했는지가 아니다.
 */
async function recordSearchAudit(
  pool: Pool,
  userId: string,
  raw: string,
  resultCode: string,
  correlationId: string,
): Promise<void> {
  await recordAuditBestEffort(pool, {
    userId,
    action: 'search.execute',
    target: null,
    query: raw,
    resultCode,
    correlationId,
  });
}

export function registerSearchRoutes(app: FastifyInstance, options: SearchRouteOptions): void {
  const { auth, loginPath, mergeNumberEnabled = false, ...rest } = options;
  const deps: SearchRouteOptions = {
    ...rest,
    auth,
    loginPath,
    mergeNumbers: { pool: rest.pool, enabled: mergeNumberEnabled },
  };

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

      /*
       * 4-1. 시퀀스 인용 바인딩 (CR-051, 백엔드 아키텍처 6.1).
       *
       * **접근 범위 산출 뒤에 온다** — 공간 해석이 접근 통제를 지나야 하고,
       * 미등록과 범위 밖이 같은 404가 되어야 하기 때문이다.
       */
      const sequence = await resolveSequenceContext(deps.pool, {
        ast,
        rawEpoch: query['seq_epoch'],
        scope,
      });

      const sequenceFailure = toSequenceFailure(sequence, correlationId);
      if (sequenceFailure !== null) return fail(reply, sequenceFailure.status, sequenceFailure.body);

      if (sequence.kind === 'stale') {
        /*
         * **조회를 실행하지 않는다** (ADR-007, FR-SEQ-005 AC-4).
         *
         * `items`·`total`·`facets`·`relaxation_hints` 키를 넣지 않는다 —
         * 계산하지 않은 것을 빈 값으로 채우면 "구간이 비었다"로 읽힌다.
         * `API-SEQ-001`이 같은 이유로 같은 모양을 쓴다.
         */
        await recordSearchAudit(deps.pool, userId, raw, 'epoch_stale', correlationId);
        return reply.send({
          query: raw,
          parsed: ast,
          sequence_context: sequence.context,
          requested_seq_epoch: sequence.requested,
          epoch_stale: true,
          next_cursor: null,
          correlation_id: correlationId,
        });
      }

      const sequenceEpoch = sequence.kind === 'bound' ? sequence.epoch : null;
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
          sequenceEpoch,
        },
        deps,
      );


      await recordSearchAudit(deps.pool, userId, raw, String(result.total.value), correlationId);

      return reply.send({
        query: raw,
        parsed: ast,
        // `seq:` 질의에서만 나타난다. 없는 질의에 빈 값을 실으면 화면이
        // "공간이 없는 시퀀스 조회"라는 없는 상태를 그린다.
        ...(sequence.kind === 'bound'
          ? { sequence_context: sequence.context, epoch_stale: false }
          : {}),
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
