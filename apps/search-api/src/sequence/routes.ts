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
import { AccessScopeUnavailableError, PartialSearchError } from '@prs/es';
import type { ErrorResponse } from '@prs/contracts';
import { SUPPORTED_ANCHOR_FORMATS } from '@prs/domain';
import type { AuthContext } from '../auth/context.js';
import { authenticateSession } from '../auth/principal.js';
import { sendAuthError, toAuthError } from '../auth/errors.js';
import {
  MAX_ANCHORS,
  resolveAnchors,
  type AnchorInput,
  type AnchorOutcome,
} from './anchors.js';
import { RANGE_LIMIT, clampRangeSize, guardRange, runRange, type RangeDeps } from './range.js';
import {
  isEpochStale,
  parseEpochParam,
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

export const SEQUENCE_RANGE_PATH = '/api/v1/sequence-ranges';
export const SEQUENCE_ANCHOR_PATH = '/api/v1/sequence-anchors/resolve';
export const CONTAINMENT_PATH = '/api/v1/containments';

export interface SequenceRouteOptions extends RangeDeps {
  readonly auth: AuthContext;
  readonly loginPath: string;
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
  const { auth, loginPath, ...deps } = options;

  /** 세션 → 접근 범위 → 시퀀스 공간. 두 경로가 똑같이 먼저 하는 일이다. */
  const enter = async (
    request: FastifyRequest,
    reply: FastifyReply,
    correlationId: string,
    repository: unknown,
    baseBranch: unknown,
  ): Promise<{ space: ResolvedSpace; scope: Awaited<ReturnType<AuthContext['scopes']['resolve']>> } | null> => {
    const userId = (await authenticateSession(request, auth.sessions)).userId;

    const slug = parseRepositorySlug(repository);
    if (slug === null) {
      invalidParameter(reply, correlationId, 'repository', 'repository는 owner/name 형식이어야 합니다.');
      return null;
    }
    if (typeof baseBranch !== 'string' || baseBranch.trim() === '') {
      invalidParameter(reply, correlationId, 'base_branch', 'base_branch가 필요합니다.');
      return null;
    }

    const scope = await auth.scopes.resolve(userId);
    const lookup = await resolveSpace(deps.pool, slug, baseBranch.trim(), scope);
    if (lookup.kind !== 'ok') {
      sendSpaceFailure(reply, correlationId, lookup);
      return null;
    }
    return { space: lookup.space, scope };
  };

  /** 두 경로가 같은 실패 처리를 쓴다. 인증·권한·부분 결과의 응답이 갈리면 안 된다. */
  const toFailureResponse = (reply: FastifyReply, correlationId: string, error: unknown): FastifyReply => {
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
      const requestedEpoch = parseEpochParam(query['seq_epoch']);
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
          fromExclusive: fromSeq,
          toInclusive: toSeq,
          size: clampRangeSize(query['size']),
          ast,
          rangeTotal: guard.total,
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
        // WP-032 전까지 늘 `null`이다. 키를 빼면 화면이 마지막 페이지를 오해한다.
        next_cursor: null,
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
