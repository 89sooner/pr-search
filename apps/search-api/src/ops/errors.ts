/**
 * 관리 API가 요청을 거절하는 이유 (API 계약 6장).
 *
 * HTTP 상태와 오류 코드를 한 곳에 모은다. 라우트는 이 예외를 잡아 계약이
 * 정한 오류 본문으로 옮기기만 한다.
 */

import type { ErrorCode } from '@prs/contracts';

export type AdminErrorCode = Extract<
  ErrorCode,
  'INVALID_PARAMETER' | 'RANGE_TOO_LARGE' | 'CONFIRMATION_MISMATCH' | 'BRANCH_LIMIT_EXCEEDED' | 'FORBIDDEN_ROLE' | 'NOT_FOUND'
>;

export const ADMIN_ERROR_STATUS: Readonly<Record<AdminErrorCode, number>> = {
  INVALID_PARAMETER: 400,
  RANGE_TOO_LARGE: 400,
  CONFIRMATION_MISMATCH: 400,
  BRANCH_LIMIT_EXCEEDED: 400,
  FORBIDDEN_ROLE: 403,
  NOT_FOUND: 404,
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
