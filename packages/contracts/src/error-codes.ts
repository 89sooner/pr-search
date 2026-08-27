/**
 * API 오류 코드.
 *
 * 출처: `docs/30_technical_architecture/pr_search_api_contracts.md` 6장.
 * 이 목록은 그 표와 1:1로 일치해야 하며 `error-codes.test.ts`가 문서와 대조한다.
 *
 * `GH_`로 시작하는 코드는 GitHub Operations Plane 전용이다 (CR-005).
 */

export const ERROR_CODES = [
  /** 질의 파싱 실패 (사용자 조치: 오류 구간 수정) — HTTP 400 */
  'QUERY_SYNTAX_ERROR',
  /** hex 접두 7자 미만 (사용자 조치: 더 긴 SHA 입력) — HTTP 400 */
  'SHA_PREFIX_TOO_SHORT',
  /** 검색어 1자 (사용자 조치: 2자 이상 입력) — HTTP 400 */
  'QUERY_TOO_SHORT',
  /** 커서 훼손·만료 (사용자 조치: 첫 페이지부터 재조회) — HTTP 400 */
  'CURSOR_INVALID',
  /** 질의 변경 후 이전 커서 사용 (사용자 조치: 첫 페이지부터 재조회) — HTTP 400 */
  'CURSOR_QUERY_MISMATCH',
  /** from > to (사용자 조치: 앵커 교환) — HTTP 400 */
  'RANGE_INVERTED',
  /** 구간 5만 건 초과 (사용자 조치: 구간 축소) — HTTP 400 */
  'RANGE_TOO_LARGE',
  /** 앵커가 서로 다른 시퀀스 공간 (사용자 조치: 브랜치 통일) — HTTP 400 */
  'SEQUENCE_SPACE_MISMATCH',
  /** 앵커가 first-parent 체인 밖 (사용자 조치: 제안된 머지 커밋 사용) — HTTP 400 */
  'ANCHOR_NOT_ON_BRANCH',
  /** 미머지 PR 앵커 (사용자 조치: 다른 앵커 사용) — HTTP 400 */
  'ANCHOR_NOT_MERGED',
  /** 어떤 유형으로도 해석 불가 (사용자 조치: 지원 형식 확인) — HTTP 400 */
  'ANCHOR_UNRESOLVABLE',
  /** 시계열 버킷 400개 초과 (사용자 조치: 간격 확대) — HTTP 400 */
  'TOO_MANY_BUCKETS',
  /** 내보내기 10만 건 초과 (사용자 조치: 조건 축소) — HTTP 400 */
  'EXPORT_LIMIT_EXCEEDED',
  /** 2단계 확인 문자열 불일치 (사용자 조치: 저장소 이름 정확 입력) — HTTP 400 */
  'CONFIRMATION_MISMATCH',
  /** 시퀀스 대상 브랜치 10개 초과 (사용자 조치: 브랜치 축소) — HTTP 400 */
  'BRANCH_LIMIT_EXCEEDED',
  /** 요청 파라미터·본문이 형식에 맞지 않음 (사용자 조치: 요청 형식 확인) — HTTP 400 */
  'INVALID_PARAMETER',
  /** 세션 없음·만료 (사용자 조치: 재인증) — HTTP 401 */
  'UNAUTHENTICATED',
  /** 역할 부족 (사용자 조치: 필요 역할 요청) — HTTP 403 */
  'FORBIDDEN_ROLE',
  /** 대상 없음 또는 접근 범위 밖 (사용자 조치: 검색으로 복귀) — HTTP 404 */
  'NOT_FOUND',
  /** 릴리스 미수집 저장소 (사용자 조치: 저장소 등록 확인) — HTTP 404 */
  'RELEASE_NOT_INDEXED',
  /** 미머지 PR에 시퀀스 요청 (사용자 조치: 머지 후 재시도) — HTTP 409 */
  'NO_SEQUENCE',
  /** good/bad 표시 모순 (사용자 조치: 탐색 초기화) — HTTP 409 */
  'BISECT_CONTRADICTION',
  /** 동일 대상 잡 실행 중 (사용자 조치: 기존 잡 확인) — HTTP 409 */
  'JOB_CONFLICT',
  /** 다른 별칭이 재색인 중 (사용자 조치: 실행 중인 재색인 완료 대기) — HTTP 409 */
  'REINDEX_BUSY',
  /** 저장 100건 초과 (사용자 조치: 기존 항목 삭제) — HTTP 409 */
  'SAVED_SEARCH_LIMIT',
  /** 웹훅 25MB 초과 (사용자 조치: (GHE 측)) — HTTP 413 */
  'PAYLOAD_TOO_LARGE',
  /** 접근 범위 조회 실패 (사용자 조치: 잠시 후 재시도) — HTTP 503 */
  'PERMISSION_UNAVAILABLE',
  /** 검색 3초 초과 (사용자 조치: 조건 추가) — HTTP 504 */
  'SEARCH_TIMEOUT',
  /** 집계 5초 초과 (사용자 조치: 기간 축소) — HTTP 504 */
  'AGGREGATION_TIMEOUT',
  /** 그래프 2초 초과 (사용자 조치: 깊이 축소 (부분 결과 반환)) — HTTP 200 (부분) */
  'GRAPH_TIMEOUT',
  /** 예상치 못한 오류 (사용자 조치: 상관 ID로 문의) — HTTP 500 */
  'INTERNAL_ERROR',
  /** manifest에 없는 capability (사용자 조치: 레지스트리 상태 확인) — HTTP 404 */
  'GH_CAPABILITY_UNKNOWN',
  /** argument·flag 제약 위반 (사용자 조치: 충돌·의존 관계 수정) — HTTP 400 */
  'GH_CONSTRAINT_VIOLATION',
  /** Operations App 미연결·토큰 만료 (사용자 조치: GitHub 계정 연결) — HTTP 401 */
  'GH_IDENTITY_REQUIRED',
  /** 사용자 GitHub 권한 부족 (사용자 조치: 필요 권한 요청) — HTTP 403 */
  'GH_PERMISSION_DENIED',
  /** 실행 정책이 차단한 capability (사용자 조치: 관리자에게 문의) — HTTP 403 */
  'GH_POLICY_BLOCKED',
  /** `gh api` 엔드포인트 정책 차단 (사용자 조치: 허용된 엔드포인트 사용) — HTTP 403 */
  'GH_ENDPOINT_BLOCKED',
  /** 허용 목록에 없는 확장 (사용자 조치: 관리자 승인 요청) — HTTP 403 */
  'GH_EXTENSION_BLOCKED',
  /** 대상 GHE 버전이 미지원 (사용자 조치: 지원되는 기능 사용) — HTTP 409 */
  'GH_HOST_UNSUPPORTED',
  /** 실행기 gh 버전과 manifest 불일치 (사용자 조치: 관리자 조치 대기) — HTTP 409 */
  'GH_REGISTRY_STALE',
  /** 위험도에 따른 확인 미수행 (사용자 조치: 확인 후 재요청) — HTTP 409 */
  'GH_CONFIRMATION_REQUIRED',
  /** 승인자 승인 대기 (사용자 조치: 승인 후 자동 진행) — HTTP 409 */
  'GH_APPROVAL_REQUIRED',
  /** 실행 직전 대상 상태가 변경됨 (사용자 조치: 새로 고침 후 재확인) — HTTP 409 */
  'GH_TARGET_CHANGED',
  /** 동일 중복 방지 키의 재요청 (사용자 조치: 기존 실행 확인) — HTTP 409 */
  'GH_DUPLICATE_REQUEST',
  /** 같은 대상에 상충 작업 진행 중 (사용자 조치: 완료 후 재시도) — HTTP 409 */
  'GH_RESOURCE_LOCKED',
  /** 실행 시간 상한 초과 (사용자 조치: 범위를 줄여 재시도) — HTTP 504 */
  'GH_EXECUTION_TIMEOUT',
  /** 임시 작업 공간 확보 실패 (사용자 조치: 잠시 후 재시도) — HTTP 503 */
  'GH_WORKSPACE_UNAVAILABLE',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/**
 * 오류 코드별 HTTP 상태.
 *
 * `GRAPH_TIMEOUT`은 부분 결과와 함께 200으로 응답한다 (API 계약 6장).
 */
export const ERROR_HTTP_STATUS: Readonly<Record<ErrorCode, number>> = {
  QUERY_SYNTAX_ERROR: 400,
  SHA_PREFIX_TOO_SHORT: 400,
  QUERY_TOO_SHORT: 400,
  CURSOR_INVALID: 400,
  CURSOR_QUERY_MISMATCH: 400,
  RANGE_INVERTED: 400,
  RANGE_TOO_LARGE: 400,
  SEQUENCE_SPACE_MISMATCH: 400,
  ANCHOR_NOT_ON_BRANCH: 400,
  ANCHOR_NOT_MERGED: 400,
  ANCHOR_UNRESOLVABLE: 400,
  TOO_MANY_BUCKETS: 400,
  EXPORT_LIMIT_EXCEEDED: 400,
  CONFIRMATION_MISMATCH: 400,
  BRANCH_LIMIT_EXCEEDED: 400,
  INVALID_PARAMETER: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN_ROLE: 403,
  NOT_FOUND: 404,
  RELEASE_NOT_INDEXED: 404,
  NO_SEQUENCE: 409,
  BISECT_CONTRADICTION: 409,
  JOB_CONFLICT: 409,
  REINDEX_BUSY: 409,
  SAVED_SEARCH_LIMIT: 409,
  PAYLOAD_TOO_LARGE: 413,
  PERMISSION_UNAVAILABLE: 503,
  SEARCH_TIMEOUT: 504,
  AGGREGATION_TIMEOUT: 504,
  GRAPH_TIMEOUT: 200,
  INTERNAL_ERROR: 500,
  GH_CAPABILITY_UNKNOWN: 404,
  GH_CONSTRAINT_VIOLATION: 400,
  GH_IDENTITY_REQUIRED: 401,
  GH_PERMISSION_DENIED: 403,
  GH_POLICY_BLOCKED: 403,
  GH_ENDPOINT_BLOCKED: 403,
  GH_EXTENSION_BLOCKED: 403,
  GH_HOST_UNSUPPORTED: 409,
  GH_REGISTRY_STALE: 409,
  GH_CONFIRMATION_REQUIRED: 409,
  GH_APPROVAL_REQUIRED: 409,
  GH_TARGET_CHANGED: 409,
  GH_DUPLICATE_REQUEST: 409,
  GH_RESOURCE_LOCKED: 409,
  GH_EXECUTION_TIMEOUT: 504,
  GH_WORKSPACE_UNAVAILABLE: 503,
};

export function isErrorCode(value: string): value is ErrorCode {
  return (ERROR_CODES as readonly string[]).includes(value);
}
