/**
 * @prs/query — 구조화 질의 토크나이저·파서·AST (FR-SRCH-005).
 *
 * **서버 파싱과 클라이언트 검증이 같은 코드를 쓴다** (ADR-001). 그래서 이
 * 패키지는 HTTP도 Elasticsearch도 모른다. 질의 문자열을 AST로 옮기고 다시
 * 문자열로 되돌리는 것까지가 범위이며, AST를 ES 질의로 바꾸는 일은 WP-013이
 * 맡는다.
 */

export const PACKAGE_NAME = '@prs/query' as const;

export {
  ENUMERATED_VALUES,
  NUMERIC_RANGE_KEYS,
  QUERY_KEYS,
  TEMPORAL_RANGE_KEYS,
  isNumericRangeKey,
  isQueryKey,
  isRangeKey,
  isTemporalRangeKey,
} from './keys.js';
export type { NumericRangeKey, QueryKey, RangeKey, TemporalRangeKey } from './keys.js';

export { EMPTY_QUERY, isNegated, isRangeFilter } from './ast.js';
export type {
  EqualityFilter,
  FilterOp,
  NumericRangeFilter,
  QueryAst,
  QueryFilter,
  RangeFilter,
  TemporalRangeFilter,
} from './ast.js';

export { QueryParseError } from './errors.js';
export type { QueryErrorCode, QueryErrorDetail } from './errors.js';

export { tokenize } from './tokenizer.js';
export type { RawToken } from './tokenizer.js';

export {
  MIN_SHA_PREFIX_LENGTH,
  detectIdentifier,
  primaryKind,
} from './identifier.js';
export type {
  DetectOptions,
  Identifier,
  IdentifierDetection,
  IdentifierKind,
  IdentifierRejection,
} from './identifier.js';

export { MIN_TEXT_LENGTH, countCodePoints, parseQuery } from './parse.js';
export { serializeQuery } from './serialize.js';
