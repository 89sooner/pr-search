/**
 * 질의 오류 (FR-SRCH-005 AC-4, 예외/실패 처리).
 *
 * **HTTP를 모른다.** 오류 코드는 API 계약 6장의 것을 그대로 쓰되 상태 코드는
 * 만들지 않는다 — 이 패키지는 브라우저에서도 돈다 (ADR-001: 서버 파싱과
 * 클라이언트 검증이 같은 코드를 쓴다).
 *
 * 문자 오프셋을 반드시 싣는다. 화면이 입력창의 오류 구간을 강조하려면
 * "무엇이 틀렸다"가 아니라 "어디가 틀렸다"가 있어야 한다.
 */

import type { ErrorCode } from '@prs/contracts';
import { QUERY_KEYS, RANGE_KEY_EXAMPLE, type RangeKey } from './keys.js';

export type QueryErrorCode = Extract<ErrorCode, 'QUERY_SYNTAX_ERROR' | 'QUERY_TOO_SHORT'>;

export interface QueryErrorDetail {
  /** 문제가 된 토큰 원문. */
  readonly token: string;
  /** 질의 문자열에서의 시작 위치. */
  readonly offset_start: number;
  /** 끝 위치(제외). `offset_end - offset_start`가 토큰 길이다. */
  readonly offset_end: number;
  /** 지원하지 않는 키일 때만 (AC-4). */
  readonly supported_keys?: readonly string[];
  /** 값이 열거된 키의 값이 틀렸을 때만 (CR-014, DEV-036). */
  readonly allowed_values?: readonly string[];
}

export class QueryParseError extends Error {
  constructor(
    readonly code: QueryErrorCode,
    message: string,
    readonly detail: QueryErrorDetail,
  ) {
    super(message);
    this.name = 'QueryParseError';
  }
}

export function unsupportedKey(key: string, token: string, start: number, end: number): QueryParseError {
  return new QueryParseError('QUERY_SYNTAX_ERROR', `Unsupported search key: '${key}'`, {
    token,
    offset_start: start,
    offset_end: end,
    supported_keys: QUERY_KEYS,
  });
}

/**
 * 범위 전용 키를 스칼라로 썼다 (DEV-364, DEV-378, DEV-379).
 *
 * **거절하는 것이 조용히 답하는 것보다 정직하다.** 고치기 전에는 `seq:1234`가
 * `match_none`이 되어 0건이었고, 부정형 `-seq:1234`는 `must_not: [match_none]`이
 * 되어 **필터가 통째로 사라진 전체 결과**였다 — 하나는 너무 좁고 하나는 너무
 * 넓은데 둘 다 오류를 내지 않았다.
 */
export function rangeOnlyKey(key: RangeKey, token: string, start: number, end: number): QueryParseError {
  return new QueryParseError(
    'QUERY_SYNTAX_ERROR',
    `'${key}' only supports ranges (for example: ${RANGE_KEY_EXAMPLE[key]})`,
    { token, offset_start: start, offset_end: end },
  );
}

export function syntaxError(message: string, token: string, start: number, end: number): QueryParseError {
  return new QueryParseError('QUERY_SYNTAX_ERROR', message, {
    token,
    offset_start: start,
    offset_end: end,
  });
}
