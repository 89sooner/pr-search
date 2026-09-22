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

import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  QUERY_KEYS,
  QueryParseError,
  MERGE_NUMBER_BINDING_MESSAGE,
  MERGE_NUMBER_BRANCH_REQUIRED_MESSAGE,
  REPOSITORY_BINDING_MESSAGE,
  SEQUENCE_BINDING_MESSAGE,
  analyzePrNumberBinding,
  hasMergeNumberRangeFilter,
  parseQuery,
  type QueryAst,
  type RepositoryBindingAnalysis,
} from '@prs/query';
import { toAccessScope } from '@prs/authz';
import { AccessScopeUnavailableError, PartialSearchError, SORT_KEYS, isSortKey } from '@prs/es';
import type { ErrorResponse } from '@prs/contracts';
import type { Pool } from '@prs/db';
import type { AuthContext } from '../auth/context.js';
import { sessionInvocation, type ReadInvocation, type ReadPrincipal } from '../auth/read-invocation.js';
import { sendAuthError, toAuthError } from '../auth/errors.js';
import { DEFAULT_SORT_KEY } from '@prs/es';
import { CursorInvalidError, CursorQueryMismatchError } from '../cursor/envelope.js';
import { recordAuditBestEffort } from '../audit/recorder.js';
import { readCursor, readFacets } from '../cursor/params.js';
import { facetResponseFields } from './facets.js';
import {
  resolveMergeNumberRangeEpoch,
  resolveSequenceContext,
  type MergeNumberRangeOutcome,
  type SequenceContextOutcome,
} from './sequence-context.js';
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
 * `mnum:` 판정을 계약이 정한 응답으로 (CR-106).
 *
 * **`toSequenceFailure`와 사유 코드(`detail.reason`)를 그대로 공유한다** — `mnum:`은
 * `seq:`와 같은 공간 지목 규칙을 쓰므로(`FR-SRCH-005` AC-9) 기계가 읽는 사유는 같다.
 * **사람이 읽는 문구는 공유하지 않는다** — `MERGE_NUMBER_BINDING_MESSAGE`를 따로 쓴다.
 * 실측(단위 시험)으로 드러난 실수: 처음에는 `SEQUENCE_BINDING_MESSAGE`를 그대로 써서
 * `mnum:`만 쓰고 `base:`를 빠뜨린 요청에도 "A seq: filter…"라고 답하고 있었다.
 *
 * @returns 조회를 계속해도 되면 `null`.
 */
export function toMergeNumberRangeFailure(
  outcome: MergeNumberRangeOutcome,
  correlationId: string,
): { readonly status: number; readonly body: ErrorResponse } | null {
  if (outcome.kind === 'unbindable') {
    return {
      status: 400,
      body: {
        error: {
          code: 'INVALID_PARAMETER',
          message: MERGE_NUMBER_BINDING_MESSAGE[outcome.reason],
          detail: { field: 'q', reason: outcome.reason, required_keys: ['repo', 'base'] },
        },
        correlation_id: correlationId,
      },
    };
  }
  if (outcome.kind === 'branch_required') {
    /*
     * `repo:`만 적었는데 저장소가 브랜치를 둘 이상 추적한다 (CR-114). 사유 코드는
     * `sequence_space_ambiguous`를 그대로 쓰고(지목이 여럿인 것은 같다) 브랜치 목록을
     * 실어 사용자가 `base:`를 고를 수 있게 한다. 이 목록은 접근 통제를 지난 저장소의
     * 것이다 — `resolveRepository`가 범위 밖이면 `space_unavailable`로 먼저 끝난다.
     */
    return {
      status: 400,
      body: {
        error: {
          code: 'INVALID_PARAMETER',
          message: MERGE_NUMBER_BRANCH_REQUIRED_MESSAGE,
          detail: {
            field: 'q',
            reason: 'sequence_space_ambiguous',
            required_keys: ['base'],
            repository: outcome.repository,
            sequence_branches: [...outcome.sequenceBranches],
          },
        },
        correlation_id: correlationId,
      },
    };
  }
  if (outcome.kind === 'space_unavailable') {
    return {
      status: 404,
      body: {
        error: { code: 'NOT_FOUND', message: '이 mnum: 조건을 해석할 시퀀스 공간을 확인할 수 없습니다.' },
        correlation_id: correlationId,
      },
    };
  }
  return null;
}

/**
 * `pr_number:` 판정을 계약이 정한 응답으로 (CR-106).
 *
 * **DB를 거치지 않는다** — `pr_number:`는 저장소 지목만 요구하고 존재 확인은
 * 기존 `repo:` 필터와 강제 접근 범위가 이미 한다(위 파일 머리글 참고). 그래서
 * `NOT_FOUND` 분기가 없다 — 지목 자체가 없거나 여럿일 때만 거절한다.
 *
 * @returns 조회를 계속해도 되면 `null`.
 */
export function toPrNumberRangeFailure(
  binding: RepositoryBindingAnalysis,
  correlationId: string,
): { readonly status: number; readonly body: ErrorResponse } | null {
  if (binding.kind !== 'invalid') return null;
  return {
    status: 400,
    body: {
      error: {
        code: 'INVALID_PARAMETER',
        message: REPOSITORY_BINDING_MESSAGE[binding.reason],
        detail: { field: 'q', reason: binding.reason, required_keys: ['repo'] },
      },
      correlation_id: correlationId,
    },
  };
}

/**
 * `mnum:`이 꺼진 배포에서 들어오면 지원하지 않는 키로 거절한다 (CR-106).
 *
 * **`/search`·`/exports`·집계 넷이 전부 이 함수를 쓴다** — 같은 파서(`@prs/query`)를
 * 공유하므로 `mnum:` 판정을 한 곳에서만 걸면 나머지 API는 조용히 새다. 실제로
 * 독립 검토가 이 CR 최초 구현에서 `/exports`·집계가 `mergeNumberEpoch` 없이
 * `buildQuery`를 불러 `MergeNumberEpochRequiredError`를 잡지 못하고 500을 내는
 * 것을 실측으로 잡아냈다 — 여기서 먼저 걸러 그 경로 자체에 도달하지 않게 한다.
 *
 * **`QUERY_KEYS`(파서)는 이 플래그를 모른다.** 그 목록은 배포와 무관한 정적
 * 문법이고(ADR-001, 브라우저와 공유) `MNUMBER_ENABLED`는 배포별 런타임 설정이라,
 * 지원 키 목록에서 빼는 일은 파서가 아니라 API 계층의 일이다.
 *
 * @returns 꺼져 있고 `mnum:`이 있으면 거절 응답. 그 밖은 `null` — 계속 진행한다.
 */
/**
 * `mnum:` 기능 꺼짐 응답 본문 (CR-106).
 *
 * **`/search`·집계가 이 함수 하나를 공유한다.** 처음엔 집계 쪽(`analytics/routes.ts`)이
 * 이 본문을 손으로 다시 타이핑했는데, 그러면 문구·사유 코드가 나중에 여기서만
 * 바뀌어도 컴파일러가 못 잡는 자리가 생긴다(독립 검토가 지적).
 */
export function mergeNumberDisabledFailure(correlationId: string): { readonly status: number; readonly body: ErrorResponse } {
  return {
    status: 400,
    body: {
      error: {
        code: 'QUERY_SYNTAX_ERROR',
        message: "지원하지 않는 검색 키입니다: 'mnum'",
        detail: {
          token: 'mnum',
          reason: 'merge_number_disabled',
          supported_keys: QUERY_KEYS.filter((key) => key !== 'mnum'),
        },
      },
      correlation_id: correlationId,
    },
  };
}

export function checkMergeNumberFeatureFlag(
  ast: QueryAst,
  enabled: boolean,
  correlationId: string,
): { readonly status: number; readonly body: ErrorResponse } | null {
  if (enabled || !hasMergeNumberRangeFilter(ast)) return null;
  return mergeNumberDisabledFailure(correlationId);
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

/**
 * 검색 실행에 필요한 것 (CR-112).
 *
 * 일반 경로와 PIPE 연동 경로가 **같은 값**으로 `executeSearch`를 부른다. 세션 컨텍스트(`auth`)는
 * 여기 없다 — 주체와 접근 범위는 `ReadInvocation`이 준다.
 */
export interface SearchExecution {
  readonly deps: SearchDeps & { readonly pool: Pool };
  readonly loginPath: string;
  readonly mergeNumberEnabled: boolean;
}

export function searchExecution(options: Omit<SearchRouteOptions, 'auth'>): SearchExecution {
  const { loginPath, mergeNumberEnabled = false, ...rest } = options;
  return {
    deps: { ...rest, mergeNumbers: { pool: rest.pool, enabled: mergeNumberEnabled } },
    loginPath,
    mergeNumberEnabled,
  };
}

export function registerSearchRoutes(app: FastifyInstance, options: SearchRouteOptions): void {
  const { auth, ...rest } = options;
  const execution = searchExecution(rest);

  app.get(SEARCH_PATH, async (request, reply) =>
    executeSearch((request.query ?? {}) as Record<string, unknown>, reply, sessionInvocation(request, auth), execution),
  );
}

/**
 * `GET /search`의 본문 (CR-112가 라우트에서 꺼냈다 — 검사 순서와 응답은 그대로다).
 *
 * PIPE 연동 경로도 이 함수를 부른다. 다른 것은 `invocation` 하나다: 주체와 접근 범위를 세션이
 * 아니라 검증된 grant가 준다.
 */
export async function executeSearch(
  query: Record<string, unknown>,
  reply: FastifyReply,
  invocation: ReadInvocation,
  execution: SearchExecution,
): Promise<FastifyReply> {
  const { correlationId } = invocation;
  const { deps, loginPath, mergeNumberEnabled } = execution;

  // 1. 주체 확인. 일반 경로는 세션 검증이다.
  let principal: ReadPrincipal;
  try {
    principal = await invocation.identify();
  } catch (error) {
    const shape = toAuthError(error, { correlationId, loginPath });
    if (shape !== null) return sendAuthError(reply, shape);
    throw error;
  }
  const userId = principal.userId;

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
    const cached = await principal.resolveCachedScope();
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
       *
       * **`mnum:`/`pr_number:` 판정보다 먼저다** (CR-106, 독립 검토 정정) —
       * `seq:` 인용 자체가 낡았으면 그 사실이 다른 무엇보다 먼저 답이어야
       * 한다. `/exports`·집계 셋도 이 순서다 — 세 API가 판정 순서까지
       * 같아야 같은 입력에 같은 상태 코드를 낸다.
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

    /*
     * 4-2. `mnum:` 기능 꺼짐 (CR-106). 판정보다 먼저 — 꺼져 있으면 공간
     * 판정 자체가 뜻이 없다.
     */
    const mnumFlagFailure = checkMergeNumberFeatureFlag(ast, mergeNumberEnabled, correlationId);
    if (mnumFlagFailure !== null) return fail(reply, mnumFlagFailure.status, mnumFlagFailure.body);

    /*
     * 4-3. `pr_number:` 저장소 지목 (CR-106). DB를 거치지 않으므로 `seq:`
     * 판정 바로 뒤, 접근 범위 산출과 같은 try 블록 안에서 동기로 끝낸다.
     */
    const prNumberBinding = analyzePrNumberBinding(ast);
    const prNumberFailure = toPrNumberRangeFailure(prNumberBinding, correlationId);
    if (prNumberFailure !== null) return fail(reply, prNumberFailure.status, prNumberFailure.body);

    /*
     * 4-4. `mnum:` 공간·에폭 바인딩 (CR-106). `seq:`와 같은 공간 지목
     * 규칙이지만 인용 파라미터가 없다 — 언제나 현재 에폭을 쓴다. `seq:`가
     * 이미 같은 공간을 읽었으면(4-1) 그 결과를 재사용해 공간을 두 번 읽지
     * 않는다 — 그 사이의 강제 푸시가 두 게이트를 다른 세대로 갈라놓는
     * 경합을 막는다(독립 검토, CR-106).
     */
    const mergeNumberRange = await resolveMergeNumberRangeEpoch(
      deps.pool,
      { ast, scope },
      sequence.kind === 'bound'
        ? { repository: sequence.context.repository, baseBranch: sequence.context.base_branch, epoch: sequence.context.seq_epoch }
        : undefined,
    );
    const mergeNumberFailure = toMergeNumberRangeFailure(mergeNumberRange, correlationId);
    if (mergeNumberFailure !== null) return fail(reply, mergeNumberFailure.status, mergeNumberFailure.body);

    const sequenceEpoch = sequence.kind === 'bound' ? sequence.epoch : null;
    const mergeNumberEpoch = mergeNumberRange.kind === 'bound' ? mergeNumberRange.epoch : null;
    // 에폭과 같은 판정에서 나온 브랜치다 — 질의 빌더가 `base_branch` 항으로 걸고 지문에도 싣는다 (CR-114).
    const mergeNumberBaseBranch = mergeNumberRange.kind === 'bound' ? mergeNumberRange.baseBranch : null;
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
        mergeNumberEpoch,
        mergeNumberBaseBranch,
        ...(principal.cursorBinding === undefined ? {} : { cursorBinding: principal.cursorBinding }),
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
}
