/**
 * `GET /relations`, `GET /co-changes` (API-REL-006, API-REL-003 / WP-031, CR-042).
 *
 * 라우트가 하는 일은 넷이다 — 세션을 확인하고, 파라미터를 검증하고, 서비스를
 * 부르고, 실패를 계약이 정한 모양으로 옮긴다. **접근 통제는 서비스 안에 있다**
 * (`resolveRelationAnchor`가 강제 필터를 지난다) — 라우트에 두면 새 경로가
 * 늘어날 때마다 빠뜨릴 자리가 생긴다. 시퀀스 경로가 `resolveSpace`로 같은 것을
 * 하는 이유와 같다.
 */

import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { AccessScopeUnavailableError, PartialSearchError, type RelationDirection } from '@prs/es';
import type { ErrorResponse } from '@prs/contracts';
import type { AuthContext } from '../auth/context.js';
import { authenticateSession } from '../auth/principal.js';
import { sendAuthError, toAuthError } from '../auth/errors.js';
import {
  getRelations,
  isRelationLinkType,
  supportsAnchorKind,
  type RelationAnchorInput,
  type RelationDeps,
} from './service.js';
import { getCoChanges, type CoChangeDeps } from './co-changes.js';

export const RELATIONS_PATH = '/api/v1/relations';
export const CO_CHANGES_PATH = '/api/v1/co-changes';

const REPOSITORY = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;
const FULL_SHA = /^[0-9a-fA-F]{40}$/;
const PR_NUMBER = /^\d+$/;
const MAX_PR_NUMBER = 2_147_483_647;

const DIRECTIONS: readonly RelationDirection[] = ['outgoing', 'incoming'];

function fail(reply: FastifyReply, status: number, body: ErrorResponse): FastifyReply {
  return reply.status(status).send(body);
}

function invalid(
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

function notFound(reply: FastifyReply, correlationId: string, message: string): FastifyReply {
  return fail(reply, 404, { error: { code: 'NOT_FOUND', message }, correlation_id: correlationId });
}

function toErrorResponse(
  reply: FastifyReply,
  error: unknown,
  correlationId: string,
  loginPath: string,
): FastifyReply | null {
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
  return null;
}

/** 문자열 파라미터 하나. 배열로 오면 없는 것으로 본다 — 첫 값을 골라 주지 않는다. */
function param(query: Record<string, unknown>, key: string): string | null {
  const value = query[key];
  return typeof value === 'string' ? value : null;
}

export interface RelationRouteOptions extends RelationDeps, CoChangeDeps {
  readonly auth: AuthContext;
  readonly loginPath: string;
}

export function registerRelationRoutes(app: FastifyInstance, options: RelationRouteOptions): void {
  const { auth, loginPath, ...deps } = options;

  async function authenticate(
    request: FastifyRequest,
    reply: FastifyReply,
    correlationId: string,
  ): Promise<string | null> {
    try {
      return (await authenticateSession(request, auth.sessions)).userId;
    } catch (error) {
      const shape = toAuthError(error, { correlationId, loginPath });
      if (shape !== null) {
        await sendAuthError(reply, shape);
        return null;
      }
      throw error;
    }
  }

  // ---------------------------------------------------------------- API-REL-006
  app.get(RELATIONS_PATH, async (request, reply) => {
    const correlationId = randomUUID();
    const query = (request.query ?? {}) as Record<string, unknown>;

    const userId = await authenticate(request, reply, correlationId);
    if (userId === null) return reply;

    const repository = param(query, 'repository') ?? '';
    if (!REPOSITORY.test(repository)) {
      return invalid(reply, correlationId, 'repository', '저장소는 `owner/name` 형식이어야 합니다');
    }

    const linkType = param(query, 'link_type') ?? '';
    if (!isRelationLinkType(linkType)) {
      return invalid(
        reply,
        correlationId,
        'link_type',
        '`references`·`reverts`·`cherry_picks`·`stacks_on` 중 하나여야 합니다',
      );
    }

    const rawDirection = param(query, 'direction') ?? '';
    if (!(DIRECTIONS as readonly string[]).includes(rawDirection)) {
      return invalid(reply, correlationId, 'direction', '`outgoing` 또는 `incoming`이어야 합니다');
    }
    const direction = rawDirection as RelationDirection;

    /*
     * 앵커는 하나다 (API-REL-001과 같은 규칙). 둘 다 주거나 둘 다 없으면 400 —
     * 어느 쪽을 골라 주면 사용자가 묻지 않은 개체의 답이 나간다.
     */
    const rawPr = param(query, 'pr_number');
    const rawSha = param(query, 'commit_sha');
    if ((rawPr === null) === (rawSha === null)) {
      return invalid(
        reply,
        correlationId,
        'pr_number',
        '`pr_number` 또는 `commit_sha` 중 하나만 지정해야 합니다',
      );
    }

    let anchor: RelationAnchorInput;
    if (rawPr !== null) {
      if (!PR_NUMBER.test(rawPr)) {
        return invalid(reply, correlationId, 'pr_number', 'PR 번호는 양의 정수여야 합니다');
      }
      const prNumber = Number(rawPr);
      if (prNumber < 1 || prNumber > MAX_PR_NUMBER) {
        return invalid(reply, correlationId, 'pr_number', 'PR 번호 범위를 벗어났습니다');
      }
      anchor = { kind: 'pull_request', prNumber };
    } else {
      if (rawSha === null || !FULL_SHA.test(rawSha)) {
        return invalid(reply, correlationId, 'commit_sha', '커밋 SHA는 40자여야 합니다');
      }
      anchor = { kind: 'commit', commitSha: rawSha.toLowerCase() };
    }

    /*
     * **끝점 조합이 성립하지 않으면 거절한다.** 빈 배열로 답하면 "관계 없음"으로
     * 읽히는데 실제로는 물을 수 없는 질문이다 — 스택은 PR↔PR 관계이고 커밋에는
     * 그 개념 자체가 없다 (CR-041이 `has_stack`에 대해 세운 규율).
     */
    if (!supportsAnchorKind(linkType, anchor.kind)) {
      return invalid(
        reply,
        correlationId,
        'link_type',
        '`stacks_on`은 PR 사이의 관계라 커밋 앵커로 조회할 수 없습니다',
      );
    }

    const rawLimit = param(query, 'limit');
    const limit = rawLimit === null ? undefined : Number(rawLimit);
    if (limit !== undefined && (!Number.isFinite(limit) || limit < 1)) {
      return invalid(reply, correlationId, 'limit', '`limit`은 양의 정수여야 합니다');
    }

    try {
      const scope = await auth.scopes.resolve(userId);
      const result = await getRelations(
        { repository, anchor, linkType, direction, ...(limit === undefined ? {} : { limit }) },
        scope,
        deps,
      );
      if (result === null) {
        // 범위 밖인지 없는지를 구분하지 않는다 (THR-004).
        return notFound(reply, correlationId, '대상을 찾을 수 없습니다');
      }
      return reply.send({ ...result.body, correlation_id: correlationId });
    } catch (error) {
      const response = toErrorResponse(reply, error, correlationId, loginPath);
      if (response !== null) return response;
      throw error;
    }
  });

  // ---------------------------------------------------------------- API-REL-003
  app.get(CO_CHANGES_PATH, async (request, reply) => {
    const correlationId = randomUUID();
    const query = (request.query ?? {}) as Record<string, unknown>;

    const userId = await authenticate(request, reply, correlationId);
    if (userId === null) return reply;

    const repository = param(query, 'repository') ?? '';
    if (!REPOSITORY.test(repository)) {
      return invalid(reply, correlationId, 'repository', '저장소는 `owner/name` 형식이어야 합니다');
    }

    const rawPr = param(query, 'pr_number') ?? '';
    if (!PR_NUMBER.test(rawPr)) {
      return invalid(reply, correlationId, 'pr_number', 'PR 번호는 양의 정수여야 합니다');
    }
    const prNumber = Number(rawPr);
    if (prNumber < 1 || prNumber > MAX_PR_NUMBER) {
      return invalid(reply, correlationId, 'pr_number', 'PR 번호 범위를 벗어났습니다');
    }

    try {
      const scope = await auth.scopes.resolve(userId);
      const result = await getCoChanges({ repository, prNumber }, scope, deps);
      if (result === null) {
        return notFound(reply, correlationId, 'PR을 찾을 수 없습니다');
      }
      return reply.send({ ...result, correlation_id: correlationId });
    } catch (error) {
      const response = toErrorResponse(reply, error, correlationId, loginPath);
      if (response !== null) return response;
      throw error;
    }
  });
}
