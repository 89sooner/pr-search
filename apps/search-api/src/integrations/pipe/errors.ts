/**
 * PSI-1.0 연동 오류 (CR-112 / ADR-025, 공통 계약 8장).
 *
 * ## 두 가지 오류 모양이 공존한다
 *
 * 1. **연동 고유의 실패**(mTLS·assertion·grant·identity·기능 꺼짐)는 이 파일의 봉투를 쓴다 —
 *    `retryable`이 붙는다. PIPE BFF가 이 코드로 재발급 여부를 정한다.
 * 2. **원본 조회의 실패**(질의 문법·커서·source·에폭·권한 범위 밖 404·503)는 기존 `/api/v1/*`의
 *    본문을 **그대로** 낸다 (계약 8장 마지막 행). 연동 봉투로 다시 싸면 Stage 1 화면의 오류
 *    처리가 두 벌이 된다.
 *
 * 메시지에는 원인 값(토큰·assertion·키 ID 목록·GHE 응답)을 싣지 않는다 (FR-INT-001 AC-10).
 */

export const PROTOCOL_VERSION = 'PSI-1.0' as const;

/** 연동 고유 오류 코드. 계약 8장 표와 1:1이다 — 표에 없는 코드는 `CONTRACT_DIFF.md`에 적는다. */
export const PSI_ERROR_CODES = [
  'CLIENT_AUTH_FAILED',
  'ASSERTION_INVALID',
  'ASSERTION_REPLAYED',
  'IDENTITY_BINDING_REQUIRED',
  'IDENTITY_BINDING_CONFLICT',
  'IDENTITY_DISABLED',
  'GRANT_EXPIRED',
  'GRANT_INVALID',
  'GRANT_REVOKED',
  'CONTEXT_REVOKED',
  'GRANT_BINDING_MISMATCH',
  'CLIENT_DISABLED',
  'PERMISSION_UNAVAILABLE',
  'OPERATION_NOT_ALLOWED',
  'NOT_FOUND',
  'INTEGRATION_DISABLED',
  // 계약 표에 없던 것 — 입력·저장소 장애를 다른 코드로 위장하지 않으려고 더했다 (CONTRACT_DIFF D-04).
  'INVALID_REQUEST',
  'PAYLOAD_TOO_LARGE',
  'UNSUPPORTED_MEDIA_TYPE',
  'AUTH_STORE_UNAVAILABLE',
  'INTERNAL_ERROR',
] as const;

export type PsiErrorCode = (typeof PSI_ERROR_CODES)[number];

interface PsiErrorSpec {
  readonly status: number;
  readonly retryable: boolean;
  readonly message: string;
}

/**
 * 코드 → 상태·재시도 가능·고정 문구.
 *
 * 문구는 **고정**이다. 호출부가 원인 문자열을 넘기지 못하게 해서 비밀이 응답으로 새는
 * 길을 타입으로 막는다. 원인은 이벤트 기록(`detail.reason`)과 운영 로그가 갖는다.
 */
export const PSI_ERRORS: Readonly<Record<PsiErrorCode, PsiErrorSpec>> = {
  CLIENT_AUTH_FAILED: { status: 401, retryable: false, message: 'Client authentication failed.' },
  ASSERTION_INVALID: { status: 401, retryable: false, message: 'The user assertion is not valid.' },
  ASSERTION_REPLAYED: { status: 401, retryable: false, message: 'The user assertion was already used.' },
  IDENTITY_BINDING_REQUIRED: { status: 403, retryable: false, message: 'Search identity is not connected.' },
  IDENTITY_BINDING_CONFLICT: { status: 409, retryable: false, message: 'Search identity mapping needs operator review.' },
  IDENTITY_DISABLED: { status: 403, retryable: false, message: 'Search identity is disabled.' },
  GRANT_EXPIRED: { status: 401, retryable: true, message: 'The search grant has expired.' },
  GRANT_INVALID: { status: 401, retryable: false, message: 'The search grant is not valid.' },
  GRANT_REVOKED: { status: 401, retryable: false, message: 'The search grant was revoked.' },
  CONTEXT_REVOKED: { status: 403, retryable: false, message: 'The login context was revoked.' },
  GRANT_BINDING_MISMATCH: { status: 401, retryable: false, message: 'The search grant is bound to a different client credential.' },
  CLIENT_DISABLED: { status: 403, retryable: false, message: 'The integration client is disabled.' },
  PERMISSION_UNAVAILABLE: { status: 503, retryable: true, message: 'Repository access could not be verified.' },
  OPERATION_NOT_ALLOWED: { status: 403, retryable: false, message: 'This operation is not available to the integration.' },
  NOT_FOUND: { status: 404, retryable: false, message: 'Not found.' },
  INTEGRATION_DISABLED: { status: 503, retryable: false, message: 'The search integration is disabled.' },
  INVALID_REQUEST: { status: 400, retryable: false, message: 'The request is not valid.' },
  PAYLOAD_TOO_LARGE: { status: 413, retryable: false, message: 'The request body is too large.' },
  UNSUPPORTED_MEDIA_TYPE: { status: 415, retryable: false, message: 'The request content type is not supported.' },
  AUTH_STORE_UNAVAILABLE: { status: 503, retryable: true, message: 'Search authorization storage is unavailable.' },
  INTERNAL_ERROR: { status: 500, retryable: false, message: 'Internal error.' },
};

/**
 * 연동 고유의 실패.
 *
 * `reason`은 **기계가 읽는 짧은 사유 코드**다(예: `unknown_kid`). 응답 본문에 싣지 않고
 * 이벤트 기록의 `detail.reason`으로만 간다 — 공격자에게 어느 검사에서 떨어졌는지 알려 주지
 * 않는다.
 */
export class PsiError extends Error {
  readonly code: PsiErrorCode;
  readonly reason: string;

  constructor(code: PsiErrorCode, reason: string) {
    super(`${code}: ${reason}`);
    this.name = 'PsiError';
    this.code = code;
    this.reason = reason;
  }

  get status(): number {
    return PSI_ERRORS[this.code].status;
  }
}

export interface PsiErrorBody {
  readonly error: { readonly code: PsiErrorCode; readonly message: string; readonly retryable: boolean };
  readonly correlation_id: string;
}

export function psiErrorBody(code: PsiErrorCode, correlationId: string): PsiErrorBody {
  const spec = PSI_ERRORS[code];
  return { error: { code, message: spec.message, retryable: spec.retryable }, correlation_id: correlationId };
}
