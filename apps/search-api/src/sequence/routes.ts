/**
 * 시퀀스 앵커·범위 경로 (API-SEQ-001, API-SEQ-002 / WP-023).
 *
 * 라우트가 하는 일은 넷이다 — 세션을 확인하고, 파라미터를 검증하고, 서비스를
 * 부르고, 실패를 계약이 정한 모양으로 옮긴다. 판정은 전부 서비스에 있다.
 *
 * **접근 통제의 자리가 여기가 아니라 `resolveSpace`인 것이 중요하다** (ADR-008).
 * 시퀀스 조회는 멤버십을 PostgreSQL에서 읽으므로 `ScopedQuery` 타입이 지켜 주는
 * 자리가 없다. 저장소 ID를 얻는 유일한 통로를 통제가 있는 함수로 만들어 두면
 * 새 경로가 늘어도 빠뜨릴 자리가 생기지 않는다.
 */

import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { QUERY_KEYS, QueryParseError, parseQuery, type QueryAst } from '@prs/query';
import { toAccessScope } from '@prs/authz';
import { AccessScopeUnavailableError, PartialSearchError } from '@prs/es';
import { ERROR_HTTP_STATUS } from '@prs/contracts';
import type { ErrorResponse } from '@prs/contracts';
import { SUPPORTED_ANCHOR_FORMATS } from '@prs/domain';
import { SAFE_MARKER_NOTE_LIMIT, bisectSessionRepo } from '@prs/db';
import type { AuthContext } from '../auth/context.js';
import { authenticateSession, requireRole, type SessionPrincipal } from '../auth/principal.js';
import { sendAuthError, toAuthError } from '../auth/errors.js';
import { recordAuditBestEffort } from '../audit/recorder.js';
import { CursorInvalidError, CursorQueryMismatchError } from '../cursor/envelope.js';
import { readCursor, readFacets } from '../cursor/params.js';
import { facetResponseFields } from '../search/facets.js';
import {
  MAX_ANCHORS,
  resolveAnchors,
  type AnchorInput,
  type AnchorOutcome,
} from './anchors.js';
import { RANGE_LIMIT, clampRangeSize, guardRange, runRange, type RangeDeps } from './range.js';
import {
  isEpochStale,
  readEpochParam,
  parseRepositorySlug,
  resolveRepository,
  resolveSpace,
  type ResolvedSpace,
  type SpaceLookup,
} from './space.js';
import {
  containmentForCommit,
  containmentForPullRequest,
  type ContainmentResult,
} from './containments.js';
import { listSequenceSpaces } from './spaces-list.js';
import { clampReleaseLimit, listReleases } from './releases-list.js';
import { clampNeighborCount, findNeighbors } from './neighbors.js';
import { markerAuditTarget, readSafeMarker, writeSafeMarker } from './safe-marker.js';
import {
  UNRELEASED,
  clampComparisonSize,
  comparisonFailureCode,
  planComparison,
} from './release-comparison.js';
import { MERGE_NUMBER_RESOLVE_PATH, resolveMergeNumber } from './merge-numbers.js';

export const SEQUENCE_RANGE_PATH = '/api/v1/sequence-ranges';
export const SEQUENCE_ANCHOR_PATH = '/api/v1/sequence-anchors/resolve';
export const CONTAINMENT_PATH = '/api/v1/containments';
export const SEQUENCE_SPACES_PATH = '/api/v1/sequence-spaces';
export const RELEASES_PATH = '/api/v1/releases';
export const RELEASE_COMPARISON_PATH = '/api/v1/release-comparisons';
export const SEQUENCE_NEIGHBORS_PATH = '/api/v1/sequence-neighbors';
export const SAFE_MARKERS_PATH = '/api/v1/safe-markers';
export const BISECT_SESSIONS_PATH = '/api/v1/bisect-sessions';

export interface SequenceRouteOptions extends RangeDeps {
  readonly auth: AuthContext;
  readonly loginPath: string;
  /** M 번호 기능 (WP-074). 꺼져 있으면 `API-SEQ-007`이 404 `feature_disabled`다. */
  readonly mergeNumberEnabled?: boolean;
}

function fail(reply: FastifyReply, status: number, body: ErrorResponse): FastifyReply {
  return reply.status(status).send(body);
}

function invalidParameter(
  reply: FastifyReply,
  correlationId: string,
  field: string,
  message: string,
): FastifyReply {
  return fail(reply, 400, {
    error: { code: 'INVALID_PARAMETER', message, detail: { field } },
    correlation_id: correlationId,
  });
}

/** 공간 조회 실패를 응답으로. 접근 거부도 404다 — 저장소의 존재를 흘리지 않는다. */
function sendSpaceFailure(
  reply: FastifyReply,
  correlationId: string,
  lookup: Exclude<SpaceLookup, { kind: 'ok' }>,
): FastifyReply {
  return fail(reply, 404, {
    error: { code: 'NOT_FOUND', message: lookup.message },
    correlation_id: correlationId,
  });
}

/** 1 이상의 정수만 서수로 받는다. 0은 유효한 `from`이다 — 구간 맨 앞을 뜻한다. */
function parseSeq(raw: unknown, allowZero: boolean): number | null {
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  const value = Number(raw);
  if (!Number.isInteger(value)) return null;
  return value >= (allowZero ? 0 : 1) ? value : null;
}

function parseAnchorInputs(raw: unknown): readonly AnchorInput[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_ANCHORS) return null;

  const inputs: AnchorInput[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) return null;
    const record = entry as Record<string, unknown>;
    const position = record['position'];
    const expression = record['expression'];
    if (position !== 'from' && position !== 'to') return null;
    if (typeof expression !== 'string' || expression.trim() === '') return null;
    inputs.push({ position, expression: expression.trim() });
  }
  return inputs;
}

/**
 * `PUT /safe-markers` 본문 (`API-SEQ-004` 검사 3).
 *
 * **`expected_marker_seq`는 키가 있어야 한다.** 키를 빼는 것("확인하지
 * 않았다")과 `null`을 보내는 것("없는 것을 봤다")은 다른 뜻이며, 앞엣것을
 * 뒤엣것으로 접으면 **아무것도 확인하지 않은 요청이 첫 등록으로 통과한다**
 * (DEV-464). `seq_epoch`가 세 상태를 구분하는 것과 같은 규율이다.
 */
interface SafeMarkerBody {
  readonly repository: unknown;
  readonly baseBranch: unknown;
  readonly mergeSeq: number;
  readonly seqEpoch: number;
  readonly note: string | null;
  readonly expectedMarkerSeq: number | null;
}

type SafeMarkerBodyParse =
  | { readonly kind: 'ok'; readonly body: SafeMarkerBody }
  | { readonly kind: 'invalid'; readonly field: string; readonly message: string };

/** 1 이상의 정수인가. 서수도 에폭도 0을 갖지 않는다. */
function positiveInt(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 ? value : null;
}

/** BIGSERIAL 식별자는 문자열로 받되 PostgreSQL bigint 범위를 넘기지 않는다. */
function validBisectSessionId(value: unknown): value is string {
  return typeof value === 'string' && /^[1-9]\d{0,18}$/.test(value) && BigInt(value) <= 9223372036854775807n;
}

function parseSafeMarkerBody(raw: unknown): SafeMarkerBodyParse {
  if (typeof raw !== 'object' || raw === null) {
    return { kind: 'invalid', field: 'body', message: '본문이 JSON 객체여야 합니다.' };
  }
  const record = raw as Record<string, unknown>;

  if (parseRepositorySlug(record['repository']) === null) {
    return { kind: 'invalid', field: 'repository', message: 'repository는 owner/name 형식이어야 합니다.' };
  }
  const baseBranch = record['base_branch'];
  if (typeof baseBranch !== 'string' || baseBranch.trim() === '') {
    return { kind: 'invalid', field: 'base_branch', message: 'base_branch가 필요합니다.' };
  }

  const mergeSeq = positiveInt(record['merge_seq']);
  if (mergeSeq === null) {
    return { kind: 'invalid', field: 'merge_seq', message: 'merge_seq는 1 이상의 정수여야 합니다.' };
  }
  const seqEpoch = positiveInt(record['seq_epoch']);
  if (seqEpoch === null) {
    return { kind: 'invalid', field: 'seq_epoch', message: 'seq_epoch는 1 이상의 정수여야 합니다.' };
  }

  const rawNote = record['note'];
  let note: string | null = null;
  if (rawNote !== undefined && rawNote !== null) {
    if (typeof rawNote !== 'string') {
      return { kind: 'invalid', field: 'note', message: 'note는 문자열이어야 합니다.' };
    }
    if (rawNote.length > SAFE_MARKER_NOTE_LIMIT) {
      return {
        kind: 'invalid',
        field: 'note',
        message: `note는 ${String(SAFE_MARKER_NOTE_LIMIT)}자 이하여야 합니다.`,
      };
    }
    note = rawNote;
  }

  /*
   * 키의 부재와 `null`을 가른다. `'expected_marker_seq' in record`가 그
   * 판정이며, `record['expected_marker_seq'] === undefined`로는 갈리지
   * 않는다 — 명시적 `undefined`가 키 없음과 같은 값을 준다.
   */
  if (!('expected_marker_seq' in record)) {
    return {
      kind: 'invalid',
      field: 'expected_marker_seq',
      message: '현재 표식을 확인했다는 것을 expected_marker_seq로 밝혀야 합니다 (없으면 null).',
    };
  }
  const rawExpected = record['expected_marker_seq'];
  let expectedMarkerSeq: number | null = null;
  if (rawExpected !== null) {
    const parsed = positiveInt(rawExpected);
    if (parsed === null) {
      return {
        kind: 'invalid',
        field: 'expected_marker_seq',
        message: 'expected_marker_seq는 1 이상의 정수이거나 null이어야 합니다.',
      };
    }
    expectedMarkerSeq = parsed;
  }

  return {
    kind: 'ok',
    body: {
      repository: record['repository'],
      baseBranch: baseBranch.trim(),
      mergeSeq,
      seqEpoch,
      note,
      expectedMarkerSeq,
    },
  };
}

/** 앵커 실패 하나를 400으로. 여럿이 실패해도 **첫 번째만** 낸다 — 오류는 하나씩 고친다. */
function sendAnchorFailure(
  reply: FastifyReply,
  correlationId: string,
  outcomes: readonly AnchorOutcome[],
): FastifyReply | null {
  for (const outcome of outcomes) {
    if (outcome.kind !== 'failed') continue;
    const { failure } = outcome;
    return fail(reply, 400, {
      error: { code: failure.code, message: failure.message, detail: { ...failure.detail } },
      correlation_id: correlationId,
    });
  }
  return null;
}

export function registerSequenceRoutes(app: FastifyInstance, options: SequenceRouteOptions): void {
  const { auth, loginPath, mergeNumberEnabled = false, ...rest } = options;
  // 범위 조회도 같은 플래그를 쓴다 — 화면마다 M이 보였다 안 보였다 하지 않는다.
  const deps: RangeDeps = { ...rest, mergeNumberEnabled };

  /** 세션 → 접근 범위 → 시퀀스 공간. 두 경로가 똑같이 먼저 하는 일이다. */
  const enter = async (
    request: FastifyRequest,
    reply: FastifyReply,
    correlationId: string,
    repository: unknown,
    baseBranch: unknown,
    /**
     * 이미 인증한 주체. 넘기면 세션을 다시 읽지 않는다 (WP-041).
     *
     * `PUT /safe-markers`는 **역할을 접근 범위보다 먼저** 봐야 해서
     * (`API-SEQ-004` 검사 순서) 이 함수 밖에서 인증을 끝낸다. 그것을
     * 넘기지 않으면 같은 요청이 Redis를 두 번 읽는다.
     */
    authenticated?: SessionPrincipal,
  ): Promise<{
    space: ResolvedSpace;
    scope: Awaited<ReturnType<AuthContext['scopes']['resolve']>>;
    /** `app_user.access_scope_version`. 구간 커서 지문의 재료다 (WP-032). */
    scopeVersion: number;
  } | null> => {
    const userId = (authenticated ?? (await authenticateSession(request, auth.sessions))).userId;

    const slug = parseRepositorySlug(repository);
    if (slug === null) {
      invalidParameter(reply, correlationId, 'repository', 'repository는 owner/name 형식이어야 합니다.');
      return null;
    }
    if (typeof baseBranch !== 'string' || baseBranch.trim() === '') {
      invalidParameter(reply, correlationId, 'base_branch', 'base_branch가 필요합니다.');
      return null;
    }

    /*
     * **접근 범위를 한 번만 산출한다** (CR-043, DEV-272).
     *
     * 커서 지문이 `access_scope_version`을 재료로 쓰는데 `resolve()`는 그것을
     * 버린다. 두 번 부르면 그 사이에 회수가 끼어들어 질의에 쓴 범위와 지문에
     * 쓴 버전이 어긋날 수 있다.
     */
    const cached = await auth.scopes.resolveCached(userId);
    const scope = toAccessScope(cached);
    const lookup = await resolveSpace(deps.pool, slug, baseBranch.trim(), scope);
    if (lookup.kind !== 'ok') {
      sendSpaceFailure(reply, correlationId, lookup);
      return null;
    }
    return { space: lookup.space, scope, scopeVersion: cached.version };
  };

  /**
   * 거절된 표식 등록을 감사에 남긴다 (`API-SEQ-004`의 「감사」).
   *
   * **거절도 남기되 성공으로 남기지 않는다.** 저장된 검색이 상한 거절을
   * 기록하는 것과 같은 이유다 — 그 사실이 "왜 등록되지 않았는가"의 답이다.
   * `result_code`가 사유를 담으므로 성공(`created`)과 섞이지 않는다.
   *
   * **401·403은 부르지 않는다.** 세션이 없으면 남길 주체가 없고, 자격 없는
   * 사용자의 반복 요청을 기록하면 그것이 감사 평면을 채운다.
   *
   * `target`은 공간과 서수를 확정한 뒤에만 값을 갖는다 — 그전의 거절(본문
   * 형식·404)은 무엇을 가리켰는지 알 수 없으므로 `null`이다. 지어내지 않는다
   * (FR-AUTH-004 AC-2).
   */
  const recordMarkerRejection = async (
    userId: string,
    correlationId: string,
    target: string | null,
    resultCode: string,
  ): Promise<void> => {
    await recordAuditBestEffort(deps.pool, {
      userId,
      action: 'safe_marker.set',
      target,
      query: null,
      resultCode,
      correlationId,
    });
  };

  /** 두 경로가 같은 실패 처리를 쓴다. 인증·권한·부분 결과의 응답이 갈리면 안 된다. */
  const toFailureResponse = (reply: FastifyReply, correlationId: string, error: unknown): FastifyReply => {
    /*
     * 커서 실패는 **400**이다 (CR-043, DEV-273).
     *
     * 서버 잘못이 아니라 "이 커서를 쓸 수 없다"는 사실이다. 그리고 두 코드가
     * 다른 것을 말한다 — 에폭이 바뀐 것과 커서가 훼손된 것은 사용자가 이해할
     * 내용이 다르다. 자동 재시도 루프를 만들지 않는다.
     */
    if (error instanceof CursorQueryMismatchError) {
      return fail(reply, 400, {
        error: {
          code: 'CURSOR_QUERY_MISMATCH',
          message: '구간 조건이 바뀌어 이어 보기를 계속할 수 없습니다. 첫 페이지부터 다시 봅니다.',
        },
        correlation_id: correlationId,
      });
    }
    if (error instanceof CursorInvalidError) {
      return fail(reply, 400, {
        error: {
          code: 'CURSOR_INVALID',
          message: '이어 보기 정보를 사용할 수 없습니다. 첫 페이지부터 다시 봅니다.',
        },
        correlation_id: correlationId,
      });
    }

    const shape = toAuthError(error, { correlationId, loginPath });
    if (shape !== null) return sendAuthError(reply, shape);

    if (error instanceof AccessScopeUnavailableError) {
      return fail(reply, 503, {
        error: { code: 'PERMISSION_UNAVAILABLE', message: '접근 권한을 확인할 수 없어 조회를 거부한다' },
        correlation_id: correlationId,
      });
    }
    if (error instanceof PartialSearchError) {
      return fail(reply, 504, {
        error: { code: 'SEARCH_TIMEOUT', message: '검색이 부분 결과만 얻어 조회를 거부한다' },
        correlation_id: correlationId,
      });
    }
    throw error;
  };

  // API-SEQ-005 / WP-042. 사용자 식별자는 본문이 아닌 인증 세션에서만 얻는다.
  app.route({ method: ['GET', 'POST', 'DELETE'], url: BISECT_SESSIONS_PATH, handler: async (request, reply) => {
    const correlationId = randomUUID();
    try {
      const principal = await authenticateSession(request, auth.sessions);
      const raw = (request.method === 'POST' ? request.body : request.query) ?? {};
      if (typeof raw !== 'object' || Array.isArray(raw)) return invalidParameter(reply, correlationId, 'body', 'JSON 객체가 필요합니다.');
      const body = raw as Record<string, unknown>;
      const entered = await enter(request, reply, correlationId, body['repository'], body['base_branch'], principal);
      if (entered === null) return reply;
      let action: bisectSessionRepo.BisectAction = { kind: 'read' };
      if (request.method === 'DELETE') {
        if (!validBisectSessionId(body['session_id'])) return invalidParameter(reply, correlationId, 'session_id', '초기화할 session_id가 필요합니다.');
        action = { kind: 'reset', sessionId: body['session_id'] };
      } else if (request.method === 'POST') {
        const epoch = body['seq_epoch'];
        if (typeof epoch !== 'number' || !Number.isSafeInteger(epoch) || epoch < 1) return invalidParameter(reply, correlationId, 'seq_epoch', '양의 정수 에폭이 필요합니다.');
        if (body['action'] === 'start') {
          const from = body['from_seq']; const to = body['to_seq'];
          if (typeof from !== 'number' || !Number.isSafeInteger(from) || from < 0 || typeof to !== 'number' || !Number.isSafeInteger(to) || to < 1) return invalidParameter(reply, correlationId, 'range', 'from_seq와 to_seq는 유효한 정수여야 합니다.');
          action = { kind: 'start', seqEpoch: epoch, fromSeq: from, toSeq: to };
        } else if (body['action'] === 'mark') {
          const seq = body['merge_seq']; const verdict = body['verdict']; const id = body['session_id'];
          if (typeof seq !== 'number' || !Number.isSafeInteger(seq) || seq < 1 || (verdict !== 'good' && verdict !== 'bad') || !validBisectSessionId(id)) return invalidParameter(reply, correlationId, 'mark', 'session_id, 실재 서수, good/bad 판정이 필요합니다.');
          action = { kind: 'mark', seqEpoch: epoch, sessionId: id, mergeSeq: seq, verdict };
        } else return invalidParameter(reply, correlationId, 'action', 'action은 start 또는 mark여야 합니다.');
      }
      const result = await bisectSessionRepo.applyBisectAction(deps.pool, principal.userId, entered.space.repositoryId, entered.space.baseBranch, action);
      if (result.kind === 'ok') return reply.send({ sequence_space: entered.space.sequenceSpace, seq_epoch: result.seqEpoch, session: result.session, correlation_id: correlationId });
      if (result.kind === 'invalid') return invalidParameter(reply, correlationId, 'sequence', result.reason);
      if (result.kind === 'contradiction') return fail(reply, 409, { error: { code: 'BISECT_CONTRADICTION', message: '정상·이상 표시가 모순됩니다. 탐색을 초기화하세요.', detail: { reason: 'bisect_contradiction', good_seq: result.goodSeq, bad_seq: result.badSeq } }, correlation_id: correlationId });
      if (result.kind === 'stale') return fail(reply, 409, { error: { code: 'SEQUENCE_EPOCH_STALE', message: '에폭이 바뀌었거나 재채번 중입니다. 탐색을 초기화하세요.', detail: { reason: 'epoch_stale', current_seq_epoch: result.seqEpoch } }, correlation_id: correlationId });
      return fail(reply, 404, { error: { code: 'NOT_FOUND', message: '탐색 세션 또는 시퀀스 공간이 없습니다. 다시 조회하세요.' }, correlation_id: correlationId });
    } catch (error) { return toFailureResponse(reply, correlationId, error); }
  } });

  app.post(SEQUENCE_ANCHOR_PATH, async (request, reply) => {
    const correlationId = randomUUID();
    const body = (request.body ?? {}) as Record<string, unknown>;

    try {
      const inputs = parseAnchorInputs(body['anchors']);
      if (inputs === null) {
        return fail(reply, 400, {
          error: {
            code: 'INVALID_PARAMETER',
            message: `anchors는 1~${String(MAX_ANCHORS)}개의 { position, expression }이어야 합니다.`,
            detail: { field: 'anchors', supported_formats: SUPPORTED_ANCHOR_FORMATS },
          },
          correlation_id: correlationId,
        });
      }

      const entered = await enter(request, reply, correlationId, body['repository'], body['base_branch']);
      if (entered === null) return reply;

      const outcomes = await resolveAnchors(
        { pool: deps.pool, es: deps.es, ...(deps.timeoutMs === undefined ? {} : { timeoutMs: deps.timeoutMs }) },
        entered.space,
        entered.scope,
        inputs,
      );

      const failureResponse = sendAnchorFailure(reply, correlationId, outcomes);
      if (failureResponse !== null) return failureResponse;

      return reply.send({
        sequence_space: entered.space.sequenceSpace,
        seq_epoch: entered.space.seqEpoch,
        resolved: outcomes.map((outcome) => (outcome.kind === 'resolved' ? outcome.anchor : null)).filter(Boolean),
        correlation_id: correlationId,
      });
    } catch (error) {
      return toFailureResponse(reply, correlationId, error);
    }
  });

  app.get(SEQUENCE_RANGE_PATH, async (request, reply) => {
    const correlationId = randomUUID();
    const query = (request.query ?? {}) as Record<string, unknown>;

    // `from_seq`는 0을 받는다 — 구간 맨 앞(첫 커밋부터)을 뜻하는 정상 값이다.
    const fromSeq = parseSeq(query['from_seq'], true);
    const toSeq = parseSeq(query['to_seq'], false);
    if (fromSeq === null) {
      return invalidParameter(reply, correlationId, 'from_seq', 'from_seq는 0 이상의 정수여야 합니다.');
    }
    if (toSeq === null) {
      return invalidParameter(reply, correlationId, 'to_seq', 'to_seq는 1 이상의 정수여야 합니다.');
    }

    // 질의 파싱은 조회보다 먼저다. 400이 될 요청으로 PostgreSQL을 부르지 않는다.
    const raw = typeof query['q'] === 'string' ? query['q'].trim() : '';
    let ast: QueryAst | null = null;
    if (raw !== '') {
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
    }

    try {
      const entered = await enter(request, reply, correlationId, query['repository'], query['base_branch']);
      if (entered === null) return reply;
      const { space, scope } = entered;

      /*
       * 인용이 딛고 선 에폭이 다르면 **구간을 실행하지 않는다** (ADR-007).
       *
       * 현재 에폭으로 자동 재조회하면 같은 번호가 다른 커밋을 가리키는 결과가
       * 오류 없이 돌아온다 — 조용히 옮기지 않고 무효라고 말하는 것이 ADR-007의
       * 요구다. `summary`와 `items` 키는 **넣지 않는다**: 계산하지 않은 것을
       * 빈 값으로 채우면 "구간이 비었다"로 읽힌다.
       */
      const epochParam = readEpochParam(query['seq_epoch']);
      // 형식 오류를 "지정 안 함"으로 접지 않는다 (CR-051, DEV-363) — 오타 하나가
      // 조용히 현재 에폭 조회로 흘러가면 그것이 ADR-007이 막으려는 재해석이다.
      if (epochParam.kind === 'invalid') {
        return invalidParameter(
          reply,
          correlationId,
          'seq_epoch',
          '시퀀스 에폭은 1 이상의 정수여야 합니다',
        );
      }
      const requestedEpoch = epochParam.kind === 'value' ? epochParam.epoch : null;
      if (isEpochStale(space, requestedEpoch)) {
        return reply.send({
          sequence_space: space.sequenceSpace,
          seq_epoch: space.seqEpoch,
          sequence_state: space.state,
          epoch_stale: true,
          requested_seq_epoch: requestedEpoch,
          range: { from_seq: fromSeq, to_seq: toSeq, boundary: '(from, to]' },
          next_cursor: null,
          correlation_id: correlationId,
        });
      }

      const guard = await guardRange(deps.pool, space, fromSeq, toSeq);
      if (guard.kind === 'inverted') {
        return fail(reply, 400, {
          error: {
            code: 'RANGE_INVERTED',
            message: `시작 시퀀스가 끝 시퀀스보다 큽니다: ${String(fromSeq)} > ${String(toSeq)}`,
            // 화면이 교환 제안을 그릴 재료다 (QA-W004-07).
            detail: { from_seq: fromSeq, to_seq: toSeq, swapped: { from_seq: toSeq, to_seq: fromSeq } },
          },
          correlation_id: correlationId,
        });
      }
      if (guard.kind === 'too_large') {
        return fail(reply, 400, {
          error: {
            code: 'RANGE_TOO_LARGE',
            message:
              `구간에 포함된 항목이 상한(${String(RANGE_LIMIT)})을 넘습니다. ` +
              `현재 ${guard.total.toLocaleString('en-US')}건.`,
            // 이름은 계약을 따르되 값은 정확하다 (CR-027, DEV-140).
            detail: { estimated_count: guard.total, limit: RANGE_LIMIT, exact: true },
          },
          correlation_id: correlationId,
        });
      }

      const result = await runRange(
        {
          space,
          scope,
          scopeVersion: entered.scopeVersion,
          fromExclusive: fromSeq,
          toInclusive: toSeq,
          size: clampRangeSize(query['size']),
          ast,
          rangeTotal: guard.total,
          cursor: readCursor(query),
          facets: readFacets(query),
        },
        deps,
      );

      return reply.send({
        sequence_space: space.sequenceSpace,
        seq_epoch: space.seqEpoch,
        sequence_state: space.state,
        epoch_stale: false,
        range: { from_seq: fromSeq, to_seq: toSeq, boundary: '(from, to]' },
        summary: result.summary,
        items: result.items,
        items_missing_in_index: result.items_missing_in_index,
        // 레지스트리에서 못 찾은 이름. 조용히 0건을 내지 않는다 (CR-016, DEV-052).
        ...(result.unresolved.length === 0 ? {} : { unresolved_names: result.unresolved }),
        // 세 키는 함께 나타나거나 함께 빠진다 (CR-019, DEV-076).
        ...facetResponseFields(result.facets),
        // 구간 끝까지 검사했으면 `null`이다 (FR-SEQ-002 AC-6).
        next_cursor: result.nextCursor,
        correlation_id: correlationId,
      });
    } catch (error) {
      return toFailureResponse(reply, correlationId, error);
    }
  });

  // API-SEQ-006: C-027 셀렉터의 데이터 소스 (CR-029, DEV-152).
  app.get(SEQUENCE_SPACES_PATH, async (request, reply) => {
    const correlationId = randomUUID();
    try {
      const userId = (await authenticateSession(request, auth.sessions)).userId;
      const scope = await auth.scopes.resolve(userId);
      const spaces = await listSequenceSpaces(deps.pool, scope);
      return await reply.send({ spaces, correlation_id: correlationId });
    } catch (error) {
      return toFailureResponse(reply, correlationId, error);
    }
  });

  // API-REL-001: W-002 선행·후행과 W-003 시퀀스 위치 (CR-031, DEV-161~166).
  /**
   * `GET /safe-markers` — 그 공간의 현재 표식 (API-SEQ-004, FR-SEQ-006).
   *
   * **`release_manager`를 요구하지 않는다.** AC-3이 403으로 정한 것은 쓰기
   * 요청이고, 표식은 조직이 공유하는 판정이라 볼 수 없으면 공유가 성립하지
   * 않는다 (CR-057, DEV-461).
   */
  app.get(SAFE_MARKERS_PATH, async (request, reply) => {
    const correlationId = randomUUID();
    try {
      const query = request.query as Record<string, unknown>;
      const entered = await enter(request, reply, correlationId, query['repository'], query['base_branch']);
      if (entered === null) return reply;

      const result = await readSafeMarker(deps.pool, entered.space);
      return await reply.send({ ...result, correlation_id: correlationId });
    } catch (error) {
      return toFailureResponse(reply, correlationId, error);
    }
  });

  /**
   * `PUT /safe-markers` — 표식 등록 (API-SEQ-004, FR-SEQ-006).
   *
   * 검사 순서가 계약이다. **역할이 접근 범위보다 먼저인 것**이 그중 하나다:
   * 역할은 저장소와 무관한 성질이라 그 판정이 저장소의 존재를 흘리지 않지만,
   * 순서를 뒤집으면 자격 없는 사용자가 403과 404의 차이로 **비공개 저장소의
   * 존재를 탐지한다** (ADR-008).
   *
   * 화면의 `canWrite`는 보안 경계가 아니다 — 직접 보낸 요청도 여기를 지난다.
   */
  app.put(SAFE_MARKERS_PATH, async (request, reply) => {
    const correlationId = randomUUID();
    try {
      // 1·2. 세션과 역할.
      const principal = await authenticateSession(request, auth.sessions);
      requireRole(principal, 'release_manager');

      // 3. 본문 형식.
      const parsed = parseSafeMarkerBody(request.body);
      if (parsed.kind === 'invalid') {
        await recordMarkerRejection(principal.userId, correlationId, null, `invalid:${parsed.field}`);
        return invalidParameter(reply, correlationId, parsed.field, parsed.message);
      }
      const body = parsed.body;

      // 4. 저장소·접근 범위·시퀀스 공간.
      const entered = await enter(
        request,
        reply,
        correlationId,
        body.repository,
        body.baseBranch,
        principal,
      );
      if (entered === null) {
        await recordMarkerRejection(principal.userId, correlationId, null, 'not_found');
        return reply;
      }

      // 5~8. 판정은 서비스가 한다.
      const outcome = await writeSafeMarker(deps.pool, entered.space, {
        mergeSeq: body.mergeSeq,
        seqEpoch: body.seqEpoch,
        note: body.note,
        expectedMarkerSeq: body.expectedMarkerSeq,
        createdBy: principal.userId,
      });

      const target = markerAuditTarget(entered.space, body.mergeSeq);
      const envelope = {
        sequence_space: entered.space.sequenceSpace,
        seq_epoch: entered.space.seqEpoch,
      };

      switch (outcome.kind) {
        case 'epoch_stale':
          await recordMarkerRejection(principal.userId, correlationId, target, 'epoch_stale');
          return fail(reply, 409, {
            error: {
              code: 'SEQUENCE_EPOCH_STALE',
              message: '조회하는 사이에 시퀀스 에폭이 바뀌었습니다. 현재 값을 다시 확인한 뒤 등록하세요',
              detail: {
                reason: 'epoch_stale',
                current_seq_epoch: outcome.currentEpoch,
                requested_seq_epoch: outcome.requestedEpoch,
              },
            },
            correlation_id: correlationId,
          });

        case 'space_missing':
          /*
           * 그 사이 공간이 사라졌다 (DEV-471). **404이며 미등록과 메시지가
           * 같다** — 접근 범위 밖과 구분되면 존재가 샌다 (ADR-008).
           */
          await recordMarkerRejection(principal.userId, correlationId, target, 'not_found');
          return fail(reply, 404, {
            error: { code: 'NOT_FOUND', message: '채번된 적이 없는 시퀀스 공간이다' },
            correlation_id: correlationId,
          });

        case 'sequence_not_found':
          await recordMarkerRejection(principal.userId, correlationId, target, 'sequence_not_found');
          return fail(reply, 400, {
            error: {
              code: 'SEQUENCE_NOT_FOUND',
              message: '그 서수는 이 시퀀스 공간에 없습니다.',
              detail: { merge_seq: outcome.mergeSeq, seq_epoch: outcome.seqEpoch },
            },
            correlation_id: correlationId,
          });

        case 'conflict':
          await recordMarkerRejection(principal.userId, correlationId, target, 'marker_conflict');
          return fail(reply, 409, {
            error: {
              code: 'SAFE_MARKER_CONFLICT',
              message: '그 사이 다른 사람이 표식을 옮겼습니다. 현재 값을 확인한 뒤 다시 결정하세요',
              detail: {
                current_marker_seq: outcome.currentMarkerSeq,
                expected_marker_seq: outcome.expectedMarkerSeq,
              },
            },
            correlation_id: correlationId,
          });

        case 'unchanged':
          /*
           * **감사를 남기지 않는다** (API-SEQ-004의 「멱등과 동시성」).
           * 아무것도 바뀌지 않았으므로 남길 사실이 없고, 남기면 재시도
           * 횟수가 등록 횟수로 보인다.
           */
          return await reply.send({
            ...envelope,
            outcome: 'unchanged',
            marker: outcome.marker,
            replaced_merge_seq: null,
            correlation_id: correlationId,
          });

        case 'created':
          await recordAuditBestEffort(deps.pool, {
            userId: principal.userId,
            action: 'safe_marker.set',
            target,
            // `query`는 `null`이다 (FR-AUTH-004 AC-1 정본 표). 메모는 조건이 아니다.
            query: null,
            resultCode: 'created',
            correlationId,
          });
          return await reply.send({
            ...envelope,
            outcome: 'created',
            marker: outcome.marker,
            replaced_merge_seq: outcome.replacedMergeSeq,
            correlation_id: correlationId,
          });
      }
    } catch (error) {
      return toFailureResponse(reply, correlationId, error);
    }
  });

  /**
   * `GET /merge-numbers/resolve` — M 번호 ↔ PR 양방향 해석 (API-SEQ-007 / WP-074).
   *
   * 판정은 전부 `resolveMergeNumber`에 있다. 이 라우트가 하는 일은 세션을 확인하고,
   * 접근 범위를 산출하고, 결과를 계약이 정한 HTTP 모양으로 옮기는 것뿐이다.
   */
  app.get(MERGE_NUMBER_RESOLVE_PATH, async (request, reply) => {
    const correlationId = randomUUID();
    const query = (request.query ?? {}) as Record<string, unknown>;
    try {
      const userId = (await authenticateSession(request, auth.sessions)).userId;
      const scope = toAccessScope(await auth.scopes.resolveCached(userId));
      const outcome = await resolveMergeNumber(
        { pool: deps.pool, es: deps.es, enabled: mergeNumberEnabled },
        {
          repository: query['repository'],
          baseBranch: query['base_branch'],
          prNumber: query['pr_number'],
          mergeNumber: query['merge_number'],
          seqEpoch: query['seq_epoch'],
          scope,
        },
      );

      switch (outcome.kind) {
        case 'ok':
          return await reply.send({ ...outcome.body, correlation_id: correlationId });
        case 'invalid':
          return fail(reply, 400, {
            error: {
              code: 'INVALID_PARAMETER',
              message: outcome.message,
              detail: { field: outcome.field, ...(outcome.reason === undefined ? {} : { reason: outcome.reason }) },
            },
            correlation_id: correlationId,
          });
        case 'not_found':
          return fail(reply, 404, {
            error: { code: 'NOT_FOUND', message: outcome.message },
            correlation_id: correlationId,
          });
        case 'no_sequence':
          return fail(reply, ERROR_HTTP_STATUS['NO_SEQUENCE'], {
            error: { code: 'NO_SEQUENCE', message: outcome.message, detail: { reason: outcome.reason } },
            correlation_id: correlationId,
          });
        case 'feature_disabled':
          /*
           * 기능이 꺼진 배포다. **404이며 사유를 밝힌다** — 화면이 "찾을 수 없음"과
           * "아직 켜지 않음"을 구분해 안내할 수 있어야 한다 (설계 9절).
           */
          return fail(reply, 404, {
            error: { code: 'NOT_FOUND', message: 'M 번호 기능이 활성화되지 않았습니다.', detail: { reason: 'feature_disabled' } },
            correlation_id: correlationId,
          });
      }
    } catch (error) {
      return toFailureResponse(reply, correlationId, error);
    }
  });

  app.get(SEQUENCE_NEIGHBORS_PATH, async (request, reply) => {
    const correlationId = randomUUID();
    const query = (request.query ?? {}) as Record<string, unknown>;

    /*
     * **앵커는 하나다** (CR-031, DEV-163). 둘 다 주면 무엇을 기준으로 셌는지가
     * 응답에서 모호해지고, 둘 다 없으면 셀 기준이 없다.
     */
    const rawPr = typeof query['pr_number'] === 'string' ? query['pr_number'].trim() : '';
    const rawSha = typeof query['commit_sha'] === 'string' ? query['commit_sha'].trim() : '';
    if ((rawPr === '') === (rawSha === '')) {
      return invalidParameter(
        reply,
        correlationId,
        'pr_number',
        'pr_number 또는 commit_sha 중 하나가 필요합니다.',
      );
    }

    let prNumber: number | null = null;
    if (rawPr !== '') {
      const value = Number(rawPr);
      if (!Number.isInteger(value) || value < 1) {
        return invalidParameter(reply, correlationId, 'pr_number', 'PR 번호는 1 이상의 정수여야 합니다.');
      }
      prNumber = value;
    }
    if (rawSha !== '' && !/^[0-9a-f]{40}$/i.test(rawSha)) {
      // 축약 해석은 `/resolve`의 몫이다 (ADR-012) — 이 API의 호출자는 전체 SHA를 갖고 있다.
      return invalidParameter(reply, correlationId, 'commit_sha', '커밋은 40자 SHA여야 합니다.');
    }

    try {
      /*
       * **공간을 요청이 지정한다** (CR-032, DEV-168). 한 커밋이 여러 브랜치의 현재
       * 체인에 함께 있을 수 있으므로, 서버가 공간을 고르면 사용자가 묻지 않은
       * 브랜치의 서수를 낼 수 있다. `enter`는 API-SEQ-001·API-SEQ-002가 이미 쓰는
       * 관문이며 `base_branch` 누락을 `INVALID_PARAMETER`로, 채번된 적 없는 공간을
       * 404로 답한다 (DEV-137) — 새 오류 코드를 만들지 않는다.
       */
      const entered = await enter(request, reply, correlationId, query['repository'], query['base_branch']);
      if (entered === null) return reply;
      const { space, scope } = entered;

      /*
       * 항목 URL이 쓸 `owner/name`. `space.sequenceSpace`를 자르지 않는다 — 브랜치
       * 이름에 `@`가 들어가면 그 분리가 틀린다. `enter`가 이미 통과시킨 값이므로
       * 여기서 다시 가르는 것은 문자열 파싱뿐이고 조회는 없다.
       */
      const slug = parseRepositorySlug(query['repository']);
      if (slug === null) {
        return invalidParameter(reply, correlationId, 'repository', 'repository는 owner/name 형식이어야 합니다.');
      }
      const repositorySlug = `${slug.owner}/${slug.name}`;
      const outcome = await findNeighbors(
        { pool: deps.pool, es: deps.es, ...(deps.timeoutMs === undefined ? {} : { timeoutMs: deps.timeoutMs }) },
        {
          repositoryId: space.repositoryId,
          repositorySlug,
          scope,
          count: clampNeighborCount(query['count']),
          baseBranch: space.baseBranch,
          seqEpoch: space.seqEpoch,
          sequenceState: space.state,
          ...(prNumber === null ? {} : { prNumber }),
          ...(rawSha === '' ? {} : { commitSha: rawSha.toLowerCase() }),
        },
      );

      if (outcome.kind === 'not_found') {
        return fail(reply, 404, {
          error: { code: 'NOT_FOUND', message: outcome.message },
          correlation_id: correlationId,
        });
      }
      if (outcome.kind === 'no_sequence') {
        /*
         * 코드는 하나, 사유는 둘이다 (DEV-164). 화면이 "머지되지 않았다"는 사실
         * 주장과 "아직 모른다"를 같은 문구로 그리지 않게 하는 것이 이 구분이다.
         */
        return fail(reply, ERROR_HTTP_STATUS['NO_SEQUENCE'], {
          error: {
            code: 'NO_SEQUENCE',
            message:
              outcome.reason === 'not_merged'
                ? '이 PR은 아직 머지되지 않아 머지 시퀀스가 없습니다.'
                : '이 개체는 현재 에폭의 first-parent 체인에서 서수를 찾을 수 없습니다.',
            detail: { ...outcome.detail, reason: outcome.reason },
          },
          correlation_id: correlationId,
        });
      }

      // 에폭 봉투는 API-SEQ-001과 같다 (ADR-007). 인용이 다르면 결과를 내지 않는다.
      const epochParam = readEpochParam(query['seq_epoch']);
      // 형식 오류를 "지정 안 함"으로 접지 않는다 (CR-051, DEV-363) — 오타 하나가
      // 조용히 현재 에폭 조회로 흘러가면 그것이 ADR-007이 막으려는 재해석이다.
      if (epochParam.kind === 'invalid') {
        return invalidParameter(
          reply,
          correlationId,
          'seq_epoch',
          '시퀀스 에폭은 1 이상의 정수여야 합니다',
        );
      }
      const requestedEpoch = epochParam.kind === 'value' ? epochParam.epoch : null;
      if (requestedEpoch !== null && requestedEpoch !== outcome.seqEpoch) {
        return reply.send({
          sequence_space: `${repositorySlug}@${outcome.baseBranch}`,
          seq_epoch: outcome.seqEpoch,
          sequence_state: outcome.sequenceState,
          epoch_stale: true,
          requested_seq_epoch: requestedEpoch,
          correlation_id: correlationId,
        });
      }

      return await reply.send({
        sequence_space: `${repositorySlug}@${outcome.baseBranch}`,
        seq_epoch: outcome.seqEpoch,
        sequence_state: outcome.sequenceState,
        epoch_stale: false,
        anchor: outcome.anchor,
        items: outcome.items,
        boundary: outcome.boundary,
        correlation_id: correlationId,
      });
    } catch (error) {
      return toFailureResponse(reply, correlationId, error);
    }
  });

  // API-REL-005: C-032 릴리스 타임라인의 데이터 소스 (CR-030, DEV-155).
  app.get(RELEASES_PATH, async (request, reply) => {
    const correlationId = randomUUID();
    const query = (request.query ?? {}) as Record<string, unknown>;

    try {
      const userId = (await authenticateSession(request, auth.sessions)).userId;

      const slug = parseRepositorySlug(query['repository']);
      if (slug === null) {
        return invalidParameter(reply, correlationId, 'repository', 'repository는 owner/name 형식이어야 합니다.');
      }

      const scope = await auth.scopes.resolve(userId);
      const lookup = await resolveRepository(deps.pool, slug, scope);
      if (lookup.kind !== 'ok') {
        return fail(reply, 404, {
          error: { code: 'NOT_FOUND', message: lookup.message },
          correlation_id: correlationId,
        });
      }

      /*
       * `branch`는 **선택 필터**다 (DEV-158). 없으면 저장소 전체를 낸다 — 브랜치를
       * 고정하면 "다른 대상 브랜치 릴리스 2건 선택"(AC-3)이 만들어지지 않는다.
       */
      const rawBranch = query['branch'];
      const branch = typeof rawBranch === 'string' && rawBranch.trim() !== '' ? rawBranch.trim() : null;
      const repository = `${slug.owner}/${slug.name}`;

      const result = await listReleases(
        deps.pool,
        lookup.repository.repository_id,
        repository,
        branch,
        clampReleaseLimit(query['limit']),
      );

      return await reply.send({
        repository,
        releases: result.releases,
        // 릴리스 0건은 오류가 아니라 상태다 (DEV-146). 키는 늘 있고 값이 없을 뿐이다.
        reason: result.reason,
        truncated: result.truncated,
        correlation_id: correlationId,
      });
    } catch (error) {
      return toFailureResponse(reply, correlationId, error);
    }
  });

  // API-SEQ-003: W-005의 릴리스 상세와 미배포 구간 (CR-030, DEV-156).
  app.get(RELEASE_COMPARISON_PATH, async (request, reply) => {
    const correlationId = randomUUID();
    const query = (request.query ?? {}) as Record<string, unknown>;

    const rawFrom = typeof query['from'] === 'string' ? query['from'].trim() : '';
    const rawTo = typeof query['to'] === 'string' ? query['to'].trim() : '';
    if (rawTo === '') {
      return invalidParameter(reply, correlationId, 'to', `to가 필요합니다. 릴리스 태그 또는 '${UNRELEASED}'.`);
    }
    // `from`은 `to=unreleased`일 때만 생략할 수 있다 — 그때 시작은 마지막 릴리스다.
    if (rawFrom === '' && rawTo !== UNRELEASED) {
      return invalidParameter(reply, correlationId, 'from', 'from이 필요합니다.');
    }

    try {
      const entered = await enter(request, reply, correlationId, query['repository'], query['base_branch']);
      if (entered === null) return reply;
      const { space, scope } = entered;

      // 에폭 봉투는 API-SEQ-001과 같다 (ADR-007). 인용이 다른 에폭이면 실행하지 않는다.
      const epochParam = readEpochParam(query['seq_epoch']);
      // 형식 오류를 "지정 안 함"으로 접지 않는다 (CR-051, DEV-363) — 오타 하나가
      // 조용히 현재 에폭 조회로 흘러가면 그것이 ADR-007이 막으려는 재해석이다.
      if (epochParam.kind === 'invalid') {
        return invalidParameter(
          reply,
          correlationId,
          'seq_epoch',
          '시퀀스 에폭은 1 이상의 정수여야 합니다',
        );
      }
      const requestedEpoch = epochParam.kind === 'value' ? epochParam.epoch : null;
      if (isEpochStale(space, requestedEpoch)) {
        return reply.send({
          sequence_space: space.sequenceSpace,
          seq_epoch: space.seqEpoch,
          sequence_state: space.state,
          epoch_stale: true,
          requested_seq_epoch: requestedEpoch,
          next_cursor: null,
          correlation_id: correlationId,
        });
      }

      const plan = await planComparison(
        { pool: deps.pool, es: deps.es, ...(deps.timeoutMs === undefined ? {} : { timeoutMs: deps.timeoutMs }) },
        space,
        scope,
        rawFrom === '' ? null : rawFrom,
        rawTo,
      );
      if (plan.kind === 'failed') {
        // 상태는 계약 표가 정한다 — 여기서 숫자를 다시 적으면 둘이 갈라진다.
        const code = comparisonFailureCode(plan.failure);
        return fail(reply, ERROR_HTTP_STATUS[code], {
          error: {
            code,
            message: plan.failure.message,
            detail: { ...plan.failure.detail },
          },
          correlation_id: correlationId,
        });
      }

      /*
       * 5만 건 가드는 API-SEQ-001과 **같은 함수**다. 릴리스 두 개 사이가 넓은 것은
       * 흔한 일이고, 그때 여기만 상한이 없으면 같은 구간이 API에 따라 되기도 하고
       * 안 되기도 한다. 방향은 이미 정규화됐으므로 `inverted`는 나오지 않는다.
       */
      const guard = await guardRange(deps.pool, space, plan.fromSeq, plan.toSeq);
      if (guard.kind === 'too_large') {
        return fail(reply, 400, {
          error: {
            code: 'RANGE_TOO_LARGE',
            message:
              `구간에 포함된 항목이 상한(${String(RANGE_LIMIT)})을 넘습니다. ` +
              `현재 ${guard.total.toLocaleString('en-US')}건.`,
            detail: { estimated_count: guard.total, limit: RANGE_LIMIT, exact: true },
          },
          correlation_id: correlationId,
        });
      }
      if (guard.kind === 'inverted') {
        throw new Error('정규화된 구간이 역전됐다');
      }

      const result = await runRange(
        {
          space,
          scope,
          scopeVersion: entered.scopeVersion,
          fromExclusive: plan.fromSeq,
          toInclusive: plan.toSeq,
          size: clampComparisonSize(query['size']),
          ast: null,
          rangeTotal: guard.total,
          cursor: readCursor(query),
          /*
           * 릴리스 비교(API-SEQ-003)에는 패싯이 없다.
           *
           * W-005의 승인 범위가 아니고, 패싯 축은 FR-SEQ-002 AC-8이 W-004에
           * 대해 정한 것이다. 요청 파라미터를 받아 조용히 다른 화면에 열지 않는다.
           */
          facets: false,
        },
        deps,
      );

      return reply.send({
        sequence_space: space.sequenceSpace,
        seq_epoch: space.seqEpoch,
        sequence_state: space.state,
        epoch_stale: false,
        normalized_direction: plan.normalizedDirection,
        unreleased: plan.unreleased,
        range: { from_seq: plan.fromSeq, to_seq: plan.toSeq, boundary: '(from, to]' },
        summary: result.summary,
        items: result.items,
        items_missing_in_index: result.items_missing_in_index,
        ...(result.unresolved.length === 0 ? {} : { unresolved_names: result.unresolved }),
        /*
         * 릴리스 비교도 구간 커서를 쓴다 (API-SEQ-003).
         *
         * 두 릴리스 사이는 넓을 수 있고 `size` 상한은 200이다. 커서 기계가
         * 이미 있는데 여기만 `null`로 두면 같은 데이터가 화면에 따라 도달
         * 가능하기도 하고 아니기도 하다. **패싯은 열지 않는다** — W-005의
         * 승인 범위가 아니다.
         */
        next_cursor: result.nextCursor,
        correlation_id: correlationId,
      });
    } catch (error) {
      return toFailureResponse(reply, correlationId, error);
    }
  });

  app.get(CONTAINMENT_PATH, async (request, reply) => {
    const correlationId = randomUUID();
    const query = (request.query ?? {}) as Record<string, unknown>;

    try {
      const userId = (await authenticateSession(request, auth.sessions)).userId;

      const slug = parseRepositorySlug(query['repository']);
      if (slug === null) {
        return invalidParameter(reply, correlationId, 'repository', 'repository는 owner/name 형식이어야 합니다.');
      }

      const kind = query['kind'];
      if (kind !== 'pull_request' && kind !== 'commit') {
        return invalidParameter(reply, correlationId, 'kind', "kind는 'pull_request' 또는 'commit'이어야 합니다.");
      }

      const rawId = typeof query['id'] === 'string' ? query['id'].trim() : '';
      let prNumber: number | null = null;
      let commitSha: string | null = null;
      if (kind === 'pull_request') {
        const value = Number(rawId);
        if (!Number.isInteger(value) || value < 1) {
          return invalidParameter(reply, correlationId, 'id', 'PR 번호는 1 이상의 정수여야 합니다.');
        }
        prNumber = value;
      } else {
        /*
         * 커밋은 40자 전체 SHA만 받는다. 판정의 정본이 PostgreSQL 정확 일치라
         * 접두로는 답할 수 없고, 이 API의 호출자(W-002·W-003 상세 화면)는 전체
         * SHA를 이미 갖고 있다. 축약 해석은 `/resolve`의 몫이다 (ADR-012).
         */
        if (!/^[0-9a-f]{40}$/i.test(rawId)) {
          return invalidParameter(reply, correlationId, 'id', '커밋은 40자 SHA여야 합니다.');
        }
        commitSha = rawId.toLowerCase();
      }

      const scope = await auth.scopes.resolve(userId);
      const lookup = await resolveRepository(deps.pool, slug, scope);
      if (lookup.kind !== 'ok') {
        return fail(reply, 404, {
          error: { code: 'NOT_FOUND', message: lookup.message },
          correlation_id: correlationId,
        });
      }

      const result: ContainmentResult =
        prNumber !== null
          ? await containmentForPullRequest(
              { pool: deps.pool, es: deps.es, ...(deps.timeoutMs === undefined ? {} : { timeoutMs: deps.timeoutMs }) },
              lookup.repository,
              prNumber,
            )
          : await containmentForCommit(
              { pool: deps.pool, es: deps.es, ...(deps.timeoutMs === undefined ? {} : { timeoutMs: deps.timeoutMs }) },
              lookup.repository,
              scope,
              commitSha ?? '',
            );

      if (result.kind === 'not_found') {
        return fail(reply, 404, {
          error: { code: 'NOT_FOUND', message: result.message },
          correlation_id: correlationId,
        });
      }

      return reply.send({
        target: { kind, repository: `${slug.owner}/${slug.name}`, id: rawId },
        merge_commit_sha: result.mergeCommitSha,
        merge_seq: result.mergeSeq,
        ...(result.baseBranch === null ? {} : { base_branch: result.baseBranch }),
        ...(result.pullRequestNumber === null ? {} : { pull_request_number: result.pullRequestNumber }),
        releases: result.releases,
        unreleased: result.unreleased,
        pending_pull_request_count: result.pendingPullRequestCount,
        ...(result.unreleased && result.pendingPullRequestCount > 0
          ? { hint: `마지막 릴리스 이후 ${String(result.pendingPullRequestCount)}건이 대기 중입니다.` }
          : {}),
        // 미수집·판정 불가의 사유 (DEV-146). 정상 판정이면 키를 넣지 않는다.
        ...(result.reason === null ? {} : { reason: result.reason }),
        correlation_id: correlationId,
      });
    } catch (error) {
      return toFailureResponse(reply, correlationId, error);
    }
  });
}
