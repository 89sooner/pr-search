/**
 * API-ADM-005 감사 기록 조회 (WP-039 / FR-AUTH-004, NFR-006, CR-054).
 *
 * ## 접근 범위 필터를 걸지 않는다
 *
 * 다른 조회 경로와 다른 이 판단은 `ADR-008`의 예외가 아니라 **대상이 다르기
 * 때문**이다. 감사 기록은 저장소의 내용이 아니라 **행위의 기록**이고
 * `security_officer`는 그 평면 전체를 조사하는 역할이다. 조사자의 저장소
 * 접근 범위로 감사를 자르면 **자기가 볼 수 없는 저장소에서 일어난 일을 조사할
 * 수 없게 되며**, 그것이 이 역할의 존재 이유를 없앤다.
 *
 * 반대 방향의 완화도 하지 않는다: `operator`나 일반 관리 토큰에 이 경로를 열지
 * 않는다. `authorize`(운영 라우트의 공용 관문)를 쓰지 않는 이유가 그것이다 —
 * 그 관문은 `operator`를 통과시키고 세션이 없으면 토큰을 받는다.
 *
 * ## 갱신·삭제 엔드포인트가 없다
 *
 * `FR-AUTH-004` AC-3의 불변성은 **UI에 버튼이 없는 것이 아니라 DB 롤에
 * `UPDATE`/`DELETE` 권한이 없는 것**으로 지켜진다 (마이그레이션 005). 여기에
 * 쓰기 경로를 두지 않는 것은 그 방어선의 바깥쪽 한 겹이다.
 */

import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { auditRepo, type Pool } from '@prs/db';
import type { ErrorResponse } from '@prs/contracts';
import { isCalendarDate } from '@prs/query';
import type { AuthContext } from '../auth/context.js';
import { authenticateSession, principalId, requireRole } from '../auth/principal.js';
import { sendAuthError, toAuthError } from '../auth/errors.js';
import { CursorInvalidError, CursorOutdatedError, CursorQueryMismatchError, type CursorSigner } from '../cursor/envelope.js';
import { recordAuditBestEffort, type AuditLog } from './recorder.js';
import {
  computeAuditFingerprint,
  decodeAuditCursor,
  encodeAuditCursor,
  type AuditFilterInput,
} from './cursor.js';

export const AUDIT_RECORDS_PATH = '/api/v1/admin/audit-records';

export interface AuditRouteOptions {
  readonly pool: Pool;
  readonly auth: AuthContext;
  readonly cursorSigner: CursorSigner;
  readonly loginPath?: string;
  readonly log?: AuditLog;
  /** 시험이 시각을 고정한다. */
  readonly now?: () => number;
}

interface AuditItem {
  readonly user_id: string;
  readonly action: string;
  readonly target: string | null;
  readonly query: string | null;
  readonly occurred_at: string;
  readonly result_code: string;
  readonly correlation_id: string;
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

/** 문자열 파라미터. 빈 문자열은 "조건 없음"이 아니라 오류다. */
function readText(raw: unknown): string | null | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== 'string' || raw === '') return null;
  return raw;
}

/**
 * 기간 끝의 모양 (FR-AUTH-004 AC-9, CR-127): ISO-8601 날짜, 또는 날짜와 시각(초·밀리초
 * 선택)에 오프셋(`Z`·`±hh:mm`) 선택.
 */
const INSTANT = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})?)?$/;

/**
 * 기간 끝을 순간으로 읽는다.
 *
 * **오프셋이 없으면 UTC다** — `new Date(raw)`에 그대로 넘기면 서버 프로세스의 기본
 * 시간대로 읽혀 같은 요청이 실행 환경마다 다른 기록을 냈다(DEV-782). 컨테이너 배포는
 * UTC였으므로 이것은 그 동작을 명시한 것이다. 화면(A-004)은 한국 벽시계에 `+09:00`을
 * 붙여 보낸다. 없는 날짜·시각(`2025-02-29`, `24:30`)은 `Date`가 다음 날로 넘기므로
 * 따로 거른다.
 */
function readInstant(raw: unknown): Date | null | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== 'string' || raw === '') return null;
  const match = INSTANT.exec(raw);
  if (match === null) return null;
  const [, date = '', hour, minute, second, zone] = match;
  if (!isCalendarDate(date)) return null;
  if (hour !== undefined && (Number(hour) > 23 || Number(minute) > 59 || (second !== undefined && Number(second) > 59))) {
    return null;
  }
  const iso = hour === undefined ? `${date}T00:00:00Z` : zone === undefined ? `${raw}Z` : raw;
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function readLimit(raw: unknown): number | null | undefined {
  if (raw === undefined) return undefined;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > auditRepo.AUDIT_MAX_LIMIT) return null;
  return parsed;
}

function toItem(row: auditRepo.AuditRecordRow): AuditItem {
  return {
    user_id: row.user_id,
    action: row.action,
    // `null`을 그대로 낸다 (FR-AUTH-004 AC-2). `N/A`를 채우면 "대상이 없는
    // 액션"과 "대상을 기록하지 못한 액션"이 같은 모양이 된다.
    target: row.target,
    query: row.query,
    occurred_at: row.occurred_at.toISOString(),
    result_code: row.result_code,
    correlation_id: row.correlation_id,
  };
}

/** 요청에서 필터를 읽는다. 형식 오류는 `null`을 담아 돌려준다. */
function parseFilter(
  query: Record<string, unknown>,
):
  | { readonly ok: true; readonly filter: AuditFilterInput }
  | { readonly ok: false; readonly field: string; readonly message?: string } {
  const userId = readText(query['user_id']);
  if (userId === null) return { ok: false, field: 'user_id' };
  const action = readText(query['action']);
  if (action === null) return { ok: false, field: 'action' };
  const target = readText(query['target']);
  if (target === null) return { ok: false, field: 'target' };
  const resultCode = readText(query['result_code']);
  if (resultCode === null) return { ok: false, field: 'result_code' };
  const from = readInstant(query['from']);
  if (from === null) return { ok: false, field: 'from' };
  const to = readInstant(query['to']);
  if (to === null) return { ok: false, field: 'to' };
  // 역전된 기간은 빈 목록이 아니라 입력 오류다 (CR-127). 같은 순간이면 빈 구간이며 허용한다.
  if (from !== undefined && to !== undefined && from.getTime() > to.getTime()) {
    return { ok: false, field: 'from', message: "'from'이 'to'보다 늦습니다" };
  }

  return {
    ok: true,
    filter: {
      ...(userId === undefined ? {} : { userId }),
      ...(action === undefined ? {} : { action }),
      ...(target === undefined ? {} : { target }),
      ...(resultCode === undefined ? {} : { resultCode }),
      ...(from === undefined ? {} : { from }),
      ...(to === undefined ? {} : { to }),
    },
  };
}

export function registerAuditRoutes(app: FastifyInstance, options: AuditRouteOptions): void {
  const { pool, auth, cursorSigner, loginPath, log } = options;
  const now = options.now ?? ((): number => Date.now());

  app.get(AUDIT_RECORDS_PATH, async (request: FastifyRequest, reply: FastifyReply) => {
    const correlationId = randomUUID();

    /*
     * `security_officer` **전용**이다 (AC-5). `operator`도 403을 받는다 —
     * 권한 매트릭스가 A-004를 그 역할에서 제외한다.
     */
    let userId: string;
    try {
      const principal = await authenticateSession(request, auth.sessions);
      requireRole(principal, 'security_officer');
      userId = principalId(principal);
    } catch (error) {
      const shape = toAuthError(error, {
        correlationId,
        ...(loginPath === undefined ? {} : { loginPath }),
      });
      if (shape !== null) return sendAuthError(reply, shape);
      throw error;
    }

    const query = (request.query ?? {}) as Record<string, unknown>;

    const parsed = parseFilter(query);
    if (!parsed.ok) {
      return invalid(reply, correlationId, parsed.field, parsed.message ?? `'${parsed.field}' 값을 읽을 수 없습니다`);
    }
    const filter = parsed.filter;

    const limit = readLimit(query['limit']);
    if (limit === null) {
      return invalid(
        reply,
        correlationId,
        'limit',
        `limit은 1 이상 ${String(auditRepo.AUDIT_MAX_LIMIT)} 이하여야 합니다`,
      );
    }

    const fingerprint = computeAuditFingerprint(filter);
    const rawCursor = query['cursor'];
    let after: auditRepo.AuditCursorPosition | null = null;
    if (typeof rawCursor === 'string' && rawCursor !== '') {
      try {
        after = decodeAuditCursor(rawCursor, fingerprint, cursorSigner, now());
      } catch (error) {
        if (error instanceof CursorQueryMismatchError) {
          return fail(reply, 400, {
            error: { code: 'CURSOR_QUERY_MISMATCH', message: error.message },
            correlation_id: correlationId,
          });
        }
        if (error instanceof CursorInvalidError) {
          // 옛 판 커서는 같은 코드에 `detail`로 그 사실을 싣는다 — 화면이 첫 페이지 재조회를 따로 안내한다 (DEV-777).
          return fail(reply, 400, {
            error:
              error instanceof CursorOutdatedError
                ? { code: 'CURSOR_INVALID', message: error.message, detail: error.detail }
                : { code: 'CURSOR_INVALID', message: error.message },
            correlation_id: correlationId,
          });
        }
        throw error;
      }
    }

    const page = await auditRepo.listAuditRecordPage(
      pool,
      filter,
      limit ?? auditRepo.AUDIT_DEFAULT_LIMIT,
      after,
    );

    const body = {
      items: page.items.map(toItem),
      next_cursor:
        page.next === null ? null : encodeAuditCursor(page.next, fingerprint, cursorSigner, now()),
      correlation_id: correlationId,
    };

    /*
     * **자기 자신을 응답 뒤에 기록한다** (AC-8, CR-054).
     *
     * 질의보다 먼저 넣으면 그 기록이 자기 응답의 첫 페이지에 나타나 **같은
     * 요청이 같은 답을 주지 않는다.** 여기서는 `body`가 이미 확정된 뒤라
     * 이 INSERT가 그것을 흔들지 못한다. 자기 자신은 다음 조회부터 보인다.
     *
     * `target`은 `null`이다 — 감사 조회는 대상이 하나가 아니고, 무엇을 물었는지는
     * `query`가 담는다 (AC-2, DEV-415).
     */
    await recordAuditBestEffort(
      pool,
      {
        userId,
        action: 'audit.view',
        target: null,
        query: JSON.stringify({
          user_id: filter.userId ?? null,
          action: filter.action ?? null,
          target: filter.target ?? null,
          result_code: filter.resultCode ?? null,
          from: filter.from?.toISOString() ?? null,
          to: filter.to?.toISOString() ?? null,
          limit: limit ?? auditRepo.AUDIT_DEFAULT_LIMIT,
          // 커서 원문을 남긴다 (PR #68 리뷰 P2의 선례). `paged: true`만 두면
          // 같은 조건의 2쪽과 5쪽이 구분되지 않는 기록을 남긴다.
          cursor: typeof rawCursor === 'string' && rawCursor !== '' ? rawCursor : null,
        }),
        resultCode: String(page.items.length),
        correlationId,
      },
      log,
    );

    return reply.send(body);
  });
}
