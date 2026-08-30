/**
 * API-ADM-009 등록 검토 요청 조회·종료 (WP-040 / FR-ING-009 AC-11, CR-055).
 *
 * HTTP를 모르는 순수 로직이다. 라우트는 `routes.ts`가 감싼다.
 *
 * ## `API-ING-003`과 같은 표를 읽되 평면이 다르다
 *
 * `API-ING-003`은 일반 사용자가 요청을 남기는 자리이고 그 응답은 `FR-ING-009`
 * AC-10의 비공개 경계를 지킨다 — "기록했다"뿐이다. 이 모듈은 운영자 평면이며
 * 처리 상태와 처리 이력을 준다. **두 평면을 한 엔드포인트로 합치지 않는다**:
 * 합치면 역할에 따라 응답 모양이 달라지고, 그 분기 하나가 빠지는 날 처리
 * 상태가 요청자에게 새어 나간다 (THR-045).
 *
 * ## 승인은 이 모듈에 없다
 *
 * `fulfilled`로 옮기는 경로를 여기 두지 않는다. 요청받은 식별자의 저장소 등록이
 * `API-ADM-001`로 성공하면 그 처리가 같은 트랜잭션에서 옮긴다 — **승인은 성공한
 * 등록 그 자체이고**, 등록되지 않은 채 승인된 상태는 아무것도 보장하지 못한다.
 */

import { registrationRequestRepo, type Pool, type RegistrationRequestRow } from '@prs/db';
import type { CursorSigner } from '../cursor/envelope.js';
import type { AuditLog } from '../audit/recorder.js';
import { AdminRejected } from './errors.js';
import {
  computeRequestFingerprint,
  decodeRequestCursor,
  encodeRequestCursor,
  type RequestFilterInput,
} from './registration-request-cursor.js';

/** 기본·최대 페이지 크기. 공통 원칙 7의 상한과 같은 자리에 둔다. */
export const DEFAULT_REQUEST_PAGE_SIZE = 25;
export const MAX_REQUEST_PAGE_SIZE = 100;

/** 운영자가 남기는 처리 메모의 상한. 마이그레이션 020의 CHECK와 같은 값이다. */
export const MAX_RESOLUTION_NOTE = 500;

export interface RequestQueueDeps {
  readonly pool: Pool;
  readonly cursorSigner: CursorSigner;
  /** 감사 기록 실패를 남길 곳. 없으면 지표만 오른다 (WP-039). */
  readonly log?: AuditLog;
  readonly now?: () => Date;
}

/**
 * 운영자 평면의 응답 모양.
 *
 * **행을 그대로 펼치지 않는다.** 열이 늘 때마다 무엇이 나가는지 다시 판정하게
 * 만드는 것이 허용 목록의 값이다 — `toRequestView`(일반 사용자 평면)가 같은
 * 이유로 세 필드만 고른다.
 */
export interface AdminRequestView {
  readonly request_id: string;
  readonly requested_by: string;
  readonly repository: string;
  readonly created_at: string;
  readonly status: string;
  readonly resolved_at: string | null;
  readonly resolved_by: string | null;
  readonly resolution_note: string | null;
}

export function toAdminRequestView(row: RegistrationRequestRow): AdminRequestView {
  return {
    request_id: String(row.request_id),
    requested_by: row.requested_by,
    repository: `${row.repository_owner}/${row.repository_name}`,
    created_at: row.created_at.toISOString(),
    status: row.status,
    resolved_at: row.resolved_at?.toISOString() ?? null,
    resolved_by: row.resolved_by,
    resolution_note: row.resolution_note,
  };
}

export interface RequestPage {
  readonly items: readonly AdminRequestView[];
  readonly nextCursor: string | null;
}

/**
 * 질의에서 필터를 읽는다. 알 수 없는 값은 조용히 무시하지 않고 거절한다.
 *
 * **`status`의 기본값은 `pending`이다** (API 계약 `API-ADM-009`, PR #89 리뷰 P2).
 * 이 목록은 **처리 대기열**이고 화면도 그렇게 말한다. 필터를 걸지 않으면
 * 종료된 이력이 쌓일수록 25행 페이지를 채워 **처리할 것이 그 아래로 묻힌다** —
 * 운영자는 대기열을 열고 아무것도 할 일이 없다고 읽는다. 이력을 보려면
 * `status`를 명시한다. 전부 보는 값은 두지 않았다: 그것이 필요해지는 화면이
 * 아직 없고, 미리 만들면 기본값의 뜻이 흐려진다.
 */
export function parseRequestFilter(query: Record<string, unknown>): RequestFilterInput {
  const filter: {
    status?: registrationRequestRepo.RegistrationRequestStatus;
    owner?: string;
    name?: string;
    requestedBy?: string;
  } = { status: 'pending' };

  const status = query['status'];
  if (status !== undefined) {
    if (status !== 'pending' && status !== 'fulfilled' && status !== 'dismissed') {
      throw new AdminRejected('INVALID_PARAMETER', "status는 'pending'·'fulfilled'·'dismissed' 중 하나다");
    }
    filter.status = status;
  }

  const repository = query['repository'];
  if (repository !== undefined) {
    if (typeof repository !== 'string') {
      throw new AdminRejected('INVALID_PARAMETER', 'repository는 owner/name 형식의 문자열이다');
    }
    const slash = repository.indexOf('/');
    const owner = slash < 0 ? '' : repository.slice(0, slash);
    const name = slash < 0 ? '' : repository.slice(slash + 1);
    if (owner === '' || name === '') {
      throw new AdminRejected('INVALID_PARAMETER', 'repository는 owner/name 형식의 문자열이다');
    }
    filter.owner = owner;
    filter.name = name;
  }

  const requestedBy = query['requested_by'];
  if (requestedBy !== undefined) {
    if (typeof requestedBy !== 'string' || requestedBy === '') {
      throw new AdminRejected('INVALID_PARAMETER', 'requested_by는 비어 있지 않은 문자열이다');
    }
    filter.requestedBy = requestedBy;
  }

  return filter;
}

/** `limit`을 읽는다. 상한을 넘으면 거절하지 않고 절삭한다 (공통 원칙 7). */
export function parseRequestLimit(raw: unknown): number {
  if (raw === undefined) return DEFAULT_REQUEST_PAGE_SIZE;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new AdminRejected('INVALID_PARAMETER', 'limit은 1 이상의 정수다');
  }
  return Math.min(value, MAX_REQUEST_PAGE_SIZE);
}

/**
 * 대기열 한 페이지.
 *
 * **`total`을 내지 않는다.** 세려면 전량을 훑어야 하고, 화면이 필요로 하는 것은
 * "처리할 것이 남았는가"이며 그것은 `nextCursor`가 답한다. 현재 페이지의 행
 * 수를 전체 수처럼 쓰지 않는 것은 화면의 책임이다.
 */
export async function listRequests(
  deps: RequestQueueDeps,
  filter: RequestFilterInput,
  limit: number,
  cursor: string | undefined,
): Promise<RequestPage> {
  const nowMs = (deps.now ?? ((): Date => new Date()))().getTime();
  const fingerprint = computeRequestFingerprint(filter);
  const after =
    cursor === undefined ? undefined : decodeRequestCursor(cursor, fingerprint, deps.cursorSigner, nowMs);

  /*
   * `limit + 1`을 읽어 다음 페이지 유무를 판정한다. 별도 `count` 질의를 두지
   * 않는 이유는 그것이 전량 스캔이고, 알아야 하는 것은 "더 있는가" 하나이기
   * 때문이다.
   */
  const rows = await registrationRequestRepo.listRequestPage(deps.pool, filter, limit + 1, after);
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];

  const nextCursor =
    rows.length > limit && last !== undefined
      ? encodeRequestCursor(
          { createdAt: last.created_at, requestId: last.request_id },
          fingerprint,
          deps.cursorSigner,
          nowMs,
        )
      : null;

  return { items: page.map(toAdminRequestView), nextCursor };
}

export type DismissOutcome =
  | { readonly kind: 'ok'; readonly request: RegistrationRequestRow }
  | { readonly kind: 'not_found' }
  | { readonly kind: 'invalid_transition'; readonly status: string };

/**
 * 요청을 등록 없이 종료한다.
 *
 * **`dismiss` 하나만 받는다** (CR-055). `approve`·`accept`·`reopen`·`delete`를
 * 만들지 않는다 — 승인은 성공한 등록이고, 재검토는 별도 요구사항이며, 요청
 * 기록은 삭제하지 않는다.
 */
export async function dismissRequest(
  deps: RequestQueueDeps,
  requestId: number,
  note: string | null,
  actor: string,
): Promise<DismissOutcome> {
  const updated = await registrationRequestRepo.dismissRequest(deps.pool, requestId, actor, note);
  if (updated !== undefined) return { kind: 'ok', request: updated };

  /*
   * 옮기지 못했다. 없는 요청과 이미 종료된 요청을 구분해 준다 — 운영자가 왜
   * 안 되는지 알아야 다음 행동을 고른다 (`applyJobAction`과 같은 규율).
   */
  const current = await registrationRequestRepo.findRequestById(deps.pool, requestId);
  if (current === undefined) return { kind: 'not_found' };
  return { kind: 'invalid_transition', status: current.status };
}

/** 처리 메모를 읽는다. 비어 있으면 `null`이며, 상한을 넘으면 거절한다. */
export function parseResolutionNote(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'string') {
    throw new AdminRejected('INVALID_PARAMETER', 'reason은 문자열이다');
  }
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  if (trimmed.length > MAX_RESOLUTION_NOTE) {
    throw new AdminRejected('INVALID_PARAMETER', `reason은 ${String(MAX_RESOLUTION_NOTE)}자를 넘을 수 없다`, {
      limit: MAX_RESOLUTION_NOTE,
      given: trimmed.length,
    });
  }
  return trimmed;
}
