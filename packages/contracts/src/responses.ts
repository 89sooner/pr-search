/**
 * 공통 응답 타입.
 *
 * 출처: API 계약 6장(오류 모델), ADR-010(커서 전용 페이지네이션).
 */

import type { ErrorCode } from './error-codes.js';

/** 모든 오류 응답의 본문. */
export interface ErrorResponse {
  readonly error: {
    readonly code: ErrorCode;
    /** 사용자에게 보일 한국어 설명. */
    readonly message: string;
    readonly detail?: Readonly<Record<string, unknown>>;
  };
  readonly correlation_id: string;
}

/**
 * 커서 기반 목록 응답.
 *
 * 오프셋 파라미터는 존재하지 않는다. 다음 페이지는 `next_cursor`로만 얻는다 (ADR-010).
 */
export interface CursorPage<T> {
  readonly items: readonly T[];
  /** 다음 페이지가 없으면 `null`. */
  readonly next_cursor: string | null;
  readonly total: number;
  /** 집계 표본이 상한에 걸려 근사치가 된 경우 `true` (FR-STAT-006). */
  readonly approximate?: boolean;
}

/** 헬스체크 응답. 각 앱이 `GET /healthz`로 노출한다 (인프라 3장). */
export interface HealthResponse {
  readonly status: 'ok';
  readonly service: string;
  readonly version: string;
}

export function isErrorResponse(value: unknown): value is ErrorResponse {
  return (
    typeof value === 'object' &&
    value !== null &&
    'error' in value &&
    typeof (value as { error: unknown }).error === 'object'
  );
}
