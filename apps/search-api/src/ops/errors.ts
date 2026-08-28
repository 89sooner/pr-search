/**
 * 관리 API가 요청을 거절하는 이유 (API 계약 6장).
 *
 * HTTP 상태와 오류 코드를 한 곳에 모은다. 라우트는 이 예외를 잡아 계약이
 * 정한 오류 본문으로 옮기기만 한다.
 */

import type { ErrorCode } from '@prs/contracts';

export type AdminErrorCode = Extract<
  ErrorCode,
  | 'INVALID_PARAMETER'
  | 'RANGE_TOO_LARGE'
  | 'CONFIRMATION_MISMATCH'
  | 'BRANCH_LIMIT_EXCEEDED'
  | 'FORBIDDEN_ROLE'
  | 'NOT_FOUND'
  // 같은 대상에 활성 잡이 이미 있다 (API-ADM-002, WP-019).
  | 'JOB_CONFLICT'
  // 다른 별칭이 재색인 중이다 — 동시 실행 상한 1 (API-ADM-004, WP-035 / DEV-300).
  | 'REINDEX_BUSY'
  // 아카이브 조회 커서 (API-ADM-008, CR-052). 검색 쪽과 **같은 코드를 쓴다** —
  // 같은 실패에 다른 이름을 붙이면 화면이 두 갈래를 각자 처리하게 된다.
  | 'CURSOR_INVALID'
  | 'CURSOR_QUERY_MISMATCH'
>;

export const ADMIN_ERROR_STATUS: Readonly<Record<AdminErrorCode, number>> = {
  INVALID_PARAMETER: 400,
  RANGE_TOO_LARGE: 400,
  CONFIRMATION_MISMATCH: 400,
  BRANCH_LIMIT_EXCEEDED: 400,
  FORBIDDEN_ROLE: 403,
  NOT_FOUND: 404,
  JOB_CONFLICT: 409,
  REINDEX_BUSY: 409,
  CURSOR_INVALID: 400,
  CURSOR_QUERY_MISMATCH: 400,
};

export class AdminRejected extends Error {
  constructor(
    readonly code: AdminErrorCode,
    message: string,
    readonly detail?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = 'AdminRejected';
  }
}
