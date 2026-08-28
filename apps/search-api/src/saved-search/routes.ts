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
import { SEQUENCE_BINDING_MESSAGE } from '@prs/query';
import { toAccessScope } from '@prs/authz';
import { isSavedSearchView, type SavedSearchView } from './cursor.js';
import {
  bindEpochForWrite,
  needsSequenceReference,
  resolveSequenceReferences,
  type EpochBindingOutcome,
} from './sequence-reference.js';
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
  readonly seq_epoch?: unknown;
}

/** 본문의 `seq_epoch`. 보내지 않은 것과 형식이 틀린 것을 가른다 (CR-051). */
type BodyEpoch =
  | { readonly ok: true; readonly epoch: number | undefined }
  | { readonly ok: false };

function readBodyEpoch(raw: unknown): BodyEpoch {
  if (raw === undefined) return { ok: true, epoch: undefined };
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 1) return { ok: false };
  return { ok: true, epoch: raw };
}

function fail(reply: FastifyReply, status: number, body: ErrorResponse): FastifyReply {
  return reply.status(status).send(body);
}

/**
 * 에폭 확정 실패를 계약이 정한 응답으로 (CR-051).
 *
 * **새 오류 코드를 만들지 않는다** — 저장할 수 없다는 사실은 이미
 * `SAVED_SEARCH_QUERY_INVALID`가 말하고 있고, `detail.reason`이 사유를
 * 가른다. 코드를 늘리면 화면이 같은 처리를 여러 갈래로 나눠 쓴다.
 *
 * @returns 계속해도 되면 `null`.
 */
function toEpochFailure(
  outcome: EpochBindingOutcome,
  correlationId: string,
): { readonly status: number; readonly body: ErrorResponse } | null {
  switch (outcome.kind) {
    case 'none':
    case 'bound':
      return null;
    case 'unbindable':
      return {
        status: 400,
        body: {
          error: {
            code: 'INVALID_PARAMETER',
            message: SEQUENCE_BINDING_MESSAGE[outcome.reason],
            detail: { field: 'query', reason: outcome.reason, required_keys: ['repo', 'base'] },
          },
          correlation_id: correlationId,
        },
      };
    case 'epoch_required':
      return {
        status: 400,
        body: {
          error: {
            code: 'INVALID_PARAMETER',
            message: 'seq: 조건이 있는 질의는 시퀀스 에폭과 함께 저장해야 합니다',
            detail: { field: 'seq_epoch', reason: 'sequence_epoch_required' },
          },
          correlation_id: correlationId,
        },
      };
    case 'epoch_not_allowed':
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
    case 'epoch_stale':
      /*
       * 저장하는 사이에 재채번이 일어났다. 현재 값으로 바꿔 저장하지 않는다 —
       * **사용자가 본 것과 저장된 것이 달라진다.**
       */
      return {
        status: 409,
        body: {
          error: {
            code: 'SAVED_SEARCH_QUERY_INVALID',
            message: '조회하는 사이에 시퀀스 에폭이 바뀌었습니다. 현재 결과를 다시 확인한 뒤 저장하세요',
            detail: { reason: 'epoch_stale', current_seq_epoch: outcome.current },
          },
          correlation_id: correlationId,
        },
      };
    case 'space_unavailable':
      // 미등록·범위 밖·미채번을 구분하지 않는다 (THR-006).
      return {
        status: 404,
        body: {
          error: { code: 'NOT_FOUND', message: '이 seq: 조건을 해석할 시퀀스 공간을 확인할 수 없습니다.' },
          correlation_id: correlationId,
        },
      };
  }
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
        {
          userId,
          view,
          size: clampPageSize(query['size']),
          cursor,
          nowMs: Date.now(),
          /*
           * 페이지 단위로 한 번에 판정한다 (CR-051). 접근 범위를 구하지
           * 못하면 **목록 자체를 실패시키지 않는다** — 저장된 검색은
           * 사용자 자산이고 접근 범위와 무관하다 (CR-049 AC-3). 그때는
           * 시퀀스 상태만 모르는 것이므로 판정을 건너뛴다.
           */
          resolveSequenceReferences: async (rows) => {
            /*
             * **인용이 없으면 접근 범위를 산출하지 않는다** (CR-051).
             *
             * 판정에만 필요한 의존을 모든 목록 조회에 지우면, 이 자원이
             * 접근 통제 경로에 참여하게 된다 — CR-049가 `/run`에서 피한
             * 바로 그 자리다. `seq:`를 담은 항목이 하나라도 있을 때만 묻는다.
             */
            if (!rows.some(needsSequenceReference)) return new Map();
            try {
              const scoped = await auth.scopes.resolveCached(userId);
              return await resolveSequenceReferences(pool, rows, toAccessScope(scoped));
            } catch {
              return new Map();
            }
          },
        },
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

    const bodyEpoch = readBodyEpoch(body.seq_epoch);
    if (!bodyEpoch.ok) {
      return invalid(reply, correlationId, 'seq_epoch', '시퀀스 에폭은 1 이상의 정수여야 합니다');
    }

    /*
     * 에폭을 확정한다 (CR-051). **접근 범위는 요청한 사람의 것**이다 —
     * 저장자가 볼 수 없는 저장소의 공간을 확인해 주지 않는다.
     */
    const epoch = await bindEpochForWrite(pool, body.query, bodyEpoch.epoch, async () =>
      toAccessScope(await auth.scopes.resolveCached(userId)),
    );
    const epochFailure = toEpochFailure(epoch, correlationId);
    if (epochFailure !== null) return fail(reply, epochFailure.status, epochFailure.body);

    const outcome = await savedSearchRepo.createSavedSearch(pool, {
      ownerUserId: userId,
      name,
      query: body.query,
      visibility: body.visibility,
      teamId: team.teamId,
      seqEpoch: epoch.kind === 'bound' ? epoch.epoch : null,
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

    /*
     * 단건도 목록과 같은 판정을 지난다 (CR-051). 다르게 답하면 화면이 두
     * 경로에서 다른 상태를 그린다. 접근 범위를 못 구해도 자원 자체는
     * 돌려준다 — 시퀀스 상태만 모르는 것이다.
     */
    const references = await (async () => {
      if (!needsSequenceReference(row)) return new Map();
      try {
        const cached = await auth.scopes.resolveCached(userId);
        return await resolveSequenceReferences(pool, [row], toAccessScope(cached));
      } catch {
        return new Map();
      }
    })();
    return reply.send(toResource(row, userId, references.get(row.saved_search_id)));
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
      seqEpoch?: number | null;
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

    /*
     * 시퀀스 인용의 처분 (CR-051 / API 계약 PATCH 다섯 경우).
     *
     * **이 블록이 이 라우트에서 가장 조심할 자리다.** 이름만 고치는 요청이
     * 낡은 에폭을 현재 값으로 옮기면 그것이 CR-051이 막으려는 자동
     * 재해석이고, 사용자는 자기 검색이 다른 세대를 가리키게 된 것을 알
     * 방법이 없다.
     *
     * 판정의 재료는 **`seq_epoch`의 존재와 질의의 실제 변화**이지 본문
     * 필드의 유무가 아니다 — 화면이 전체 폼을 보내는 구현이면 이름 한 글자
     * 수정도 `query`를 담아 오기 때문이다.
     */
    const bodyEpoch = readBodyEpoch(body.seq_epoch);
    if (!bodyEpoch.ok) {
      return invalid(reply, correlationId, 'seq_epoch', '시퀀스 에폭은 1 이상의 정수여야 합니다');
    }

    const current = await savedSearchRepo.findVisibleSavedSearch(pool, savedSearchId, userId);
    if (current === null || current.owner_user_id !== userId) return notFound(reply, correlationId);

    const finalQuery = patch.query ?? current.query;
    const queryChanged = patch.query !== undefined && patch.query !== current.query;

    if (queryChanged || bodyEpoch.epoch !== undefined) {
      /*
       * 질의가 실제로 바뀌었거나 명시적 재연결이다. 어느 쪽이든 새 에폭을
       * 현재 값과 대조해 확정한다.
       */
      const epoch = await bindEpochForWrite(pool, finalQuery, bodyEpoch.epoch, async () =>
        toAccessScope(await auth.scopes.resolveCached(userId)),
      );
      const epochFailure = toEpochFailure(epoch, correlationId);
      if (epochFailure !== null) return fail(reply, epochFailure.status, epochFailure.body);
      // `none`이면 `null`이다 — 질의가 `seq:`를 잃었으면 에폭도 뜻을 잃는다.
      patch.seqEpoch = epoch.kind === 'bound' ? epoch.epoch : null;
    }
    /*
     * 그 밖의 경우 `patch.seqEpoch`을 **설정하지 않는다.** 리포지터리가 키의
     * 부재를 "그대로 둔다"로 읽으므로 낡은 에폭이 낡은 채로 남는다.
     */

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
      case 'sequence_unbound':
        /*
         * 에폭 없이 저장된 옛 항목 (CR-051). 현재 에폭을 붙여 보내지
         * 않는다 — 저장 당시의 값은 복원할 수 없으므로 그것은 추측이다.
         */
        return fail(reply, 409, {
          error: {
            code: 'SAVED_SEARCH_QUERY_INVALID',
            message:
              '이 저장된 검색은 시퀀스 에폭 정보 없이 만들어져 안전하게 실행할 수 없습니다. 현재 시퀀스 공간에 다시 연결하세요',
            detail: { reason: 'sequence_unbound' },
          },
          correlation_id: correlationId,
        });
    }
  });
}
