/**
 * `/saved-searches` 계열 (API-SRCH-005 / WP-033, CR-049).
 *
 * 라우트가 하는 일은 넷이다 — 세션을 확인하고, 파라미터를 검증하고, 서비스나
 * 리포지터리를 부르고, 결과를 계약이 정한 모양으로 옮긴다. **접근 통제는 여기
 * 없다**: 리포지터리 질의가 권한 조건을 담고 있고, 이 파일은 그 결과의 부재를
 * `404`로 옮길 뿐이다.
 *
 * ## 없음과 볼 수 없음을 구분하지 않는다
 *
 * 소유하지 않은 항목에 대한 수정·삭제도 `404`다. `403`으로 답하면 "그 ID의
 * 저장 검색이 존재한다"가 새어 나간다 — `auth/errors.ts`가 세운 규율이며
 * THR-004와 같은 자리다.
 */

import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { savedSearchRepo, type Pool } from '@prs/db';
import type { ErrorResponse } from '@prs/contracts';
import type { AuthContext } from '../auth/context.js';
import { authenticateSession } from '../auth/principal.js';
import { sendAuthError, toAuthError } from '../auth/errors.js';
import { CursorInvalidError, CursorQueryMismatchError } from '../cursor/envelope.js';
import { isSavedSearchView, type SavedSearchView } from './cursor.js';
import {
  clampPageSize,
  judgeQuery,
  listSavedSearches,
  runSavedSearch,
  toResource,
  type SavedSearchDeps,
} from './service.js';

export const SAVED_SEARCHES_PATH = '/api/v1/saved-searches';
export const SHARE_TARGETS_PATH = `${SAVED_SEARCHES_PATH}/share-targets`;
export const SAVED_SEARCH_ITEM_PATH = `${SAVED_SEARCHES_PATH}/:saved_search_id`;
export const SAVED_SEARCH_RUN_PATH = `${SAVED_SEARCH_ITEM_PATH}/run`;

export interface SavedSearchRouteOptions extends SavedSearchDeps {
  readonly auth: AuthContext;
  readonly loginPath: string;
}

interface CreateBody {
  readonly name?: unknown;
  readonly query?: unknown;
  readonly visibility?: unknown;
  readonly team_id?: unknown;
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

function notFound(reply: FastifyReply, correlationId: string): FastifyReply {
  return fail(reply, 404, {
    error: { code: 'NOT_FOUND', message: '저장된 검색을 찾을 수 없습니다' },
    correlation_id: correlationId,
  });
}

/** 커서 오류를 계약 모양으로. 두 코드가 **다른 사실**을 말한다 (DEV-273과 같은 규율). */
function toCursorError(error: unknown, correlationId: string): ErrorResponse | null {
  if (error instanceof CursorQueryMismatchError) {
    return {
      error: {
        code: 'CURSOR_QUERY_MISMATCH',
        message: '목록 조건이 바뀌어 이어 보기를 계속할 수 없습니다. 첫 페이지부터 다시 봅니다.',
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

/** 저장·수정이 받아들일 수 있는 이름인가. 공백뿐인 이름만 거절한다. */
function readName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed === '' ? null : trimmed;
}

function readSavedSearchId(raw: unknown): number | null {
  if (typeof raw !== 'string' || !/^\d+$/.test(raw)) return null;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

/** 공개 범위와 대상 팀의 조합을 판정한다 (FR-SRCH-010 AC-1, 마이그레이션 015). */
function readTeamId(visibility: 'private' | 'team', raw: unknown): { ok: true; teamId: number | null } | { ok: false; message: string } {
  if (visibility === 'private') {
    if (raw !== undefined && raw !== null) {
      return { ok: false, message: 'private 공개 범위에는 대상 팀을 지정할 수 없습니다' };
    }
    return { ok: true, teamId: null };
  }
  if (typeof raw !== 'number' || !Number.isSafeInteger(raw) || raw <= 0) {
    return { ok: false, message: 'team 공개 범위에는 대상 팀(team_id)이 필요합니다' };
  }
  return { ok: true, teamId: raw };
}

export function registerSavedSearchRoutes(
  app: FastifyInstance,
  options: SavedSearchRouteOptions,
): void {
  const { auth, loginPath, ...deps } = options;
  const pool: Pool = deps.pool;

  /** 세션을 읽고, 실패하면 계약 모양으로 답한다. `null`이면 이미 응답했다. */
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

  /*
   * **정적 경로를 파라미터 경로보다 먼저 등록한다.**
   *
   * `/share-targets`와 `/:saved_search_id`는 같은 자리에서 겹친다. 등록 순서가
   * 틀리면 `share-targets`가 ID로 해석되고, 그때 나오는 답은 400이라 화면은
   * "잘못된 요청"을 보게 된다. 이 순서는 산문이 아니라 시험이 지킨다.
   */
  app.get(SHARE_TARGETS_PATH, async (request, reply) => {
    const correlationId = randomUUID();
    const userId = await session(request, reply, correlationId);
    if (userId === null) return reply;

    const teams = await savedSearchRepo.listTeamsForUser(pool, userId);
    return reply.send({
      teams: teams.map((team) => ({ team_id: team.team_id, org_id: team.org_id, slug: team.slug })),
      correlation_id: correlationId,
    });
  });

  app.get(SAVED_SEARCHES_PATH, async (request, reply) => {
    const correlationId = randomUUID();
    const query = (request.query ?? {}) as Record<string, unknown>;

    const userId = await session(request, reply, correlationId);
    if (userId === null) return reply;

    const rawView = query['view'];
    if (!isSavedSearchView(rawView)) {
      return invalid(reply, correlationId, 'view', "view는 'mine' 또는 'team'이어야 합니다");
    }
    const view: SavedSearchView = rawView;
    const rawCursor = query['cursor'];
    const cursor = typeof rawCursor === 'string' && rawCursor !== '' ? rawCursor : null;

    try {
      const result = await listSavedSearches(
        { userId, view, size: clampPageSize(query['size']), cursor, nowMs: Date.now() },
        deps,
      );
      return reply.send({
        view: result.view,
        items: result.items,
        // 마지막 페이지에서 `null`이다. 키를 빼면 화면이 그것을 "더 있다"로 오해한다.
        next_cursor: result.nextCursor,
        correlation_id: correlationId,
      });
    } catch (error) {
      const cursorError = toCursorError(error, correlationId);
      if (cursorError !== null) return fail(reply, 400, cursorError);
      throw error;
    }
  });

  app.post(SAVED_SEARCHES_PATH, async (request, reply) => {
    const correlationId = randomUUID();
    const userId = await session(request, reply, correlationId);
    if (userId === null) return reply;

    const body = (request.body ?? {}) as CreateBody;

    const name = readName(body.name);
    if (name === null) return invalid(reply, correlationId, 'name', '이름이 필요합니다');

    if (typeof body.query !== 'string') {
      return invalid(reply, correlationId, 'query', '질의 문자열이 필요합니다');
    }
    if (body.visibility !== 'private' && body.visibility !== 'team') {
      return invalid(reply, correlationId, 'visibility', "공개 범위는 'private' 또는 'team'이어야 합니다");
    }
    const team = readTeamId(body.visibility, body.team_id);
    if (!team.ok) return invalid(reply, correlationId, 'team_id', team.message);

    // 새 무효 질의를 저장하지 않는다 (AC-6). 파서가 코드와 오프셋을 함께 준다.
    const queryError = judgeQuery(body.query);
    if (queryError !== null) {
      return fail(reply, 400, {
        error: { code: 'QUERY_SYNTAX_ERROR', message: queryError.message, detail: { ...queryError.detail } },
        correlation_id: correlationId,
      });
    }

    const outcome = await savedSearchRepo.createSavedSearch(pool, {
      ownerUserId: userId,
      name,
      query: body.query,
      visibility: body.visibility,
      teamId: team.teamId,
    });

    switch (outcome.kind) {
      case 'created':
        return reply.status(201).send(toResource(outcome.row, userId));
      case 'limit_reached':
        return fail(reply, 409, {
          error: {
            code: 'SAVED_SEARCH_LIMIT',
            message: `저장할 수 있는 검색은 ${String(outcome.limit)}건까지입니다. 기존 항목을 삭제한 뒤 다시 시도하세요`,
            detail: { limit: outcome.limit },
          },
          correlation_id: correlationId,
        });
      case 'name_conflict':
        return fail(reply, 409, {
          error: { code: 'SAVED_SEARCH_NAME_CONFLICT', message: '같은 이름의 저장된 검색이 이미 있습니다' },
          correlation_id: correlationId,
        });
      case 'not_team_member':
        return invalid(reply, correlationId, 'team_id', '현재 구성원인 팀에만 공유할 수 있습니다');
    }
  });

  app.get(SAVED_SEARCH_ITEM_PATH, async (request, reply) => {
    const correlationId = randomUUID();
    const params = (request.params ?? {}) as Record<string, unknown>;
    const savedSearchId = readSavedSearchId(params['saved_search_id']);

    const userId = await session(request, reply, correlationId);
    if (userId === null) return reply;
    if (savedSearchId === null) return notFound(reply, correlationId);

    const row = await savedSearchRepo.findVisibleSavedSearch(pool, savedSearchId, userId);
    if (row === null) return notFound(reply, correlationId);
    return reply.send(toResource(row, userId));
  });

  app.patch(SAVED_SEARCH_ITEM_PATH, async (request, reply) => {
    const correlationId = randomUUID();
    const params = (request.params ?? {}) as Record<string, unknown>;
    const savedSearchId = readSavedSearchId(params['saved_search_id']);

    const userId = await session(request, reply, correlationId);
    if (userId === null) return reply;
    if (savedSearchId === null) return notFound(reply, correlationId);

    const body = (request.body ?? {}) as CreateBody;
    const patch: {
      name?: string;
      query?: string;
      visibility?: 'private' | 'team';
      teamId?: number | null;
    } = {};

    if (body.name !== undefined) {
      const name = readName(body.name);
      if (name === null) return invalid(reply, correlationId, 'name', '이름이 필요합니다');
      patch.name = name;
    }

    if (body.query !== undefined) {
      if (typeof body.query !== 'string') {
        return invalid(reply, correlationId, 'query', '질의 문자열이 필요합니다');
      }
      const queryError = judgeQuery(body.query);
      if (queryError !== null) {
        return fail(reply, 400, {
          error: { code: 'QUERY_SYNTAX_ERROR', message: queryError.message, detail: { ...queryError.detail } },
          correlation_id: correlationId,
        });
      }
      patch.query = body.query;
    }

    if (body.visibility !== undefined) {
      if (body.visibility !== 'private' && body.visibility !== 'team') {
        return invalid(reply, correlationId, 'visibility', "공개 범위는 'private' 또는 'team'이어야 합니다");
      }
      patch.visibility = body.visibility;
      const team = readTeamId(body.visibility, body.team_id);
      if (!team.ok) return invalid(reply, correlationId, 'team_id', team.message);
      patch.teamId = team.teamId;
    } else if (body.team_id !== undefined) {
      /*
       * 공개 범위를 함께 보내지 않고 대상만 바꾸는 요청.
       *
       * 최종 상태가 `team`인지는 리포지터리가 현재 값으로 정한다 — 여기서
       * `private` 행에 대상을 붙이려 하면 마이그레이션 015가 거절하므로,
       * 그 조합은 형식 단계에서 막는다.
       */
      if (typeof body.team_id !== 'number' || !Number.isSafeInteger(body.team_id) || body.team_id <= 0) {
        return invalid(reply, correlationId, 'team_id', '대상 팀(team_id)이 올바르지 않습니다');
      }
      patch.teamId = body.team_id;
    }

    const outcome = await savedSearchRepo.updateSavedSearch(pool, savedSearchId, userId, patch);
    switch (outcome.kind) {
      case 'updated':
        return reply.send(toResource(outcome.row, userId));
      case 'not_found':
        return notFound(reply, correlationId);
      case 'name_conflict':
        return fail(reply, 409, {
          error: { code: 'SAVED_SEARCH_NAME_CONFLICT', message: '같은 이름의 저장된 검색이 이미 있습니다' },
          correlation_id: correlationId,
        });
      case 'not_team_member':
        return invalid(reply, correlationId, 'team_id', '현재 구성원인 팀에만 공유할 수 있습니다');
    }
  });

  app.delete(SAVED_SEARCH_ITEM_PATH, async (request, reply) => {
    const correlationId = randomUUID();
    const params = (request.params ?? {}) as Record<string, unknown>;
    const savedSearchId = readSavedSearchId(params['saved_search_id']);

    const userId = await session(request, reply, correlationId);
    if (userId === null) return reply;
    if (savedSearchId === null) return notFound(reply, correlationId);

    const deleted = await savedSearchRepo.deleteSavedSearch(pool, savedSearchId, userId);
    if (!deleted) return notFound(reply, correlationId);
    return reply.status(204).send();
  });

  app.post(SAVED_SEARCH_RUN_PATH, async (request, reply) => {
    const correlationId = randomUUID();
    const params = (request.params ?? {}) as Record<string, unknown>;
    const savedSearchId = readSavedSearchId(params['saved_search_id']);

    const userId = await session(request, reply, correlationId);
    if (userId === null) return reply;
    if (savedSearchId === null) return notFound(reply, correlationId);

    const outcome = await runSavedSearch(savedSearchId, userId, deps);
    switch (outcome.kind) {
      case 'ok':
        return reply.send({
          saved_search_id: outcome.savedSearchId,
          query: outcome.query,
          last_run_at: outcome.lastRunAt,
          navigation_url: outcome.navigationUrl,
          correlation_id: correlationId,
        });
      case 'not_found':
        return notFound(reply, correlationId);
      case 'query_invalid':
        return fail(reply, 409, {
          error: {
            code: 'SAVED_SEARCH_QUERY_INVALID',
            message: '저장된 질의를 현재 문법으로 해석할 수 없어 실행하지 않았습니다',
            detail: { ...outcome.error.detail },
          },
          correlation_id: correlationId,
        });
    }
  });
}
