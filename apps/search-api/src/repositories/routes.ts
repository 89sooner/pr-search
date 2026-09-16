/**
 * `/repositories` 계열 (API-ING-002·003 / WP-034, CR-050).
 *
 * **`/admin` 아래가 아니다.** W-009는 일반 사용자 화면이고, 같은 정보를 가진
 * `API-ADM-001`·`API-ADM-006`은 `operator` 전용이며 그 제한은 FR-ADMIN-001
 * AC-4가 승인한 것이다 (DEV-350). 여기서 관리자 토큰 우회를 만들지 않는다 —
 * 이 경로는 세션 인증만 받는다.
 *
 * ## 미등록과 볼 수 없음을 구분하지 않는다
 *
 * `repository=` 완전 일치 조회가 빈 결과를 낼 때 그것이 "등록되지 않았다"인지
 * "볼 수 없다"인지 말하지 않는다. 구분하면 비공개 저장소의 존재가 샌다
 * (FR-ING-009 AC-10, THR-004와 같은 자리).
 */

import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from '@prs/db';
import type { Client as EsClient } from '@elastic/elasticsearch';
import type { ErrorResponse } from '@prs/contracts';
import type { AuthContext } from '../auth/context.js';
import { authenticateSession, requireRole } from '../auth/principal.js';
import { sendAuthError, toAuthError } from '../auth/errors.js';
import {
  CursorInvalidError,
  CursorQueryMismatchError,
  type CursorSigner,
} from '../cursor/envelope.js';
import {
  computeRepositoryFingerprint,
  decodeRepositoryCursor,
  encodeRepositoryCursor,
} from './cursor.js';
import { clampPageSize, loadRepositoryOverview } from './overview.js';
import { parseRequestSlug, recordRegistrationRequest } from './registration-requests.js';

export const REPOSITORIES_PATH = '/api/v1/repositories';
export const REGISTRATION_REQUESTS_PATH = '/api/v1/repository-registration-requests';

export interface RepositoryRouteOptions {
  readonly pool: Pool;
  readonly es: EsClient;
  readonly cursorSigner: CursorSigner;
  readonly auth: AuthContext;
  readonly loginPath: string;
  readonly now?: () => number;
  readonly log?: (entry: { readonly level: string; readonly message: string; readonly reason?: string }) => void;
}

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

/** 커서 오류 둘은 **다른 사실**을 말한다 (CR-043, DEV-273). */
function toCursorError(error: unknown, correlationId: string): ErrorResponse | null {
  if (error instanceof CursorQueryMismatchError) {
    return {
      error: {
        code: 'CURSOR_QUERY_MISMATCH',
        message: '접근 범위 또는 조회 조건이 바뀌어 이어 보기를 계속할 수 없습니다. 첫 페이지부터 다시 봅니다.',
      },
      correlation_id: correlationId,
    };
  }
  if (error instanceof CursorInvalidError) {
    return {
      error: {
        code: 'CURSOR_INVALID',
        message: '이 위치를 더 쓸 수 없습니다. 첫 페이지부터 다시 봅니다.',
      },
      correlation_id: correlationId,
    };
  }
  return null;
}

export function registerRepositoryRoutes(
  app: FastifyInstance,
  options: RepositoryRouteOptions,
): void {
  const { auth, loginPath, cursorSigner, pool, es } = options;
  const now = options.now ?? ((): number => Date.now());
  const deps = { pool, es, ...(options.log === undefined ? {} : { log: options.log }) };

  const session = async (
    request: FastifyRequest,
    reply: FastifyReply,
    correlationId: string,
  ): Promise<string | null> => {
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
  };

  app.get(REPOSITORIES_PATH, async (request, reply) => {
    const correlationId = randomUUID();
    const query = (request.query ?? {}) as Record<string, unknown>;

    const userId = await session(request, reply, correlationId);
    if (userId === null) return reply;

    const limit = clampPageSize(query['limit']);
    if (limit === null) return invalid(reply, correlationId, 'limit', 'limit은 1~100의 정수입니다');

    const rawSlug = query['repository'];
    let slug: { owner: string; name: string } | undefined;
    if (rawSlug !== undefined && rawSlug !== null && rawSlug !== '') {
      const parsed = parseRequestSlug(rawSlug);
      if (parsed === null) {
        return invalid(reply, correlationId, 'repository', 'repository는 owner/name 형식입니다');
      }
      slug = parsed;
    }

    const scope = await auth.scopes.resolve(userId);
    const fingerprint = computeRepositoryFingerprint({
      scope,
      slug: slug === undefined ? null : `${slug.owner}/${slug.name}`,
    });

    let after: { owner: string; name: string; repositoryId: number } | undefined;
    const rawCursor = query['cursor'];
    if (typeof rawCursor === 'string' && rawCursor !== '') {
      try {
        after = decodeRepositoryCursor(rawCursor, fingerprint, cursorSigner, now());
      } catch (error) {
        const shape = toCursorError(error, correlationId);
        if (shape === null) throw error;
        return fail(reply, 400, shape);
      }
    }

    const page = await loadRepositoryOverview(deps, {
      scope,
      limit,
      ...(after === undefined ? {} : { after }),
      ...(slug === undefined ? {} : { slug }),
    });

    return reply.send({
      items: page.items,
      next_cursor:
        page.nextCursor === null
          ? null
          : encodeRepositoryCursor(page.nextCursor, fingerprint, cursorSigner, now()),
      correlation_id: correlationId,
    });
  });

  app.post(REGISTRATION_REQUESTS_PATH, async (request, reply) => {
    const correlationId = randomUUID();
    const body = (request.body ?? {}) as Record<string, unknown>;

    // CR-094: the retired developer request workflow is retained for operators only.
    try {
      requireRole(await authenticateSession(request, auth.sessions), 'operator');
    } catch (error) {
      const shape = toAuthError(error, { correlationId, loginPath });
      if (shape !== null) { await sendAuthError(reply, shape); return reply; }
      throw error;
    }

    const userId = await session(request, reply, correlationId);
    if (userId === null) return reply;

    const slug = parseRequestSlug(body['repository']);
    if (slug === null) {
      return invalid(
        reply,
        correlationId,
        'repository',
        'repository는 owner/name 형식이며 각 조각이 100자를 넘지 않습니다',
      );
    }

    /*
     * **여기서 GitHub Enterprise를 부르지 않는다** (AC-10). 존재 확인을 하면
     * 그 응답이 곧 비공개 저장소의 존재 신탁이 된다. 본문의 다른 필드도 읽지
     * 않는다 — 등록 계약을 클라이언트 입력으로 열지 않는다.
     */
    const view = await recordRegistrationRequest({ pool }, userId, slug);
    return reply.status(201).send({ ...view, correlation_id: correlationId });
  });
}
