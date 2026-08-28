/**
 * 파서 (FR-SRCH-005).
 *
 * 토큰을 AST로 옮기고, SRS가 정한 것만 검증한다.
 *
 * **검증의 경계가 이 파일의 핵심이다.** 지원하지 않는 *키*는 거절하고(AC-4),
 * 값이 열거된 키의 *값*도 거절한다(CR-014 DEV-036). 그러나 열거되지 않은 키의
 * 값은 건드리지 않는다 — `state:whatever`가 결과를 못 내는 것과 파서가 없는
 * 제약을 만드는 것은 다른 문제다.
 *
 * **범위 전용 키의 형태도 거절한다** (DEV-364). 이것은 위 문단의 예외가 아니라
 * 같은 규율이다 — SRS가 `seq`·`merged`·`created`에 승인한 것은 범위뿐이므로,
 * 스칼라를 통과시키는 쪽이야말로 승인되지 않은 문법을 지어내는 일이었다.
 */

import type { EqualityFilter, QueryAst, QueryFilter, RangeFilter } from './ast.js';
import { QueryParseError, rangeOnlyKey, syntaxError, unsupportedKey } from './errors.js';
import {
  ENUMERATED_VALUES,
  isNumericRangeKey,
  isQueryKey,
  isRangeKey,
  isTemporalRangeKey,
  type QueryKey,
} from './keys.js';
import { tokenize, type RawToken } from './tokenizer.js';

/** 전문 검색어 최소 길이. API 계약 6장의 `QUERY_TOO_SHORT`가 1자를 거절한다. */
export const MIN_TEXT_LENGTH = 2;

/**
 * **코드 포인트로 센다** (WP-032, CR-043 DEV-284).
 *
 * `String.length`는 UTF-16 코드 단위 수다. BMP 밖 문자(`𠮷`, 대부분의 이모지)는
 * 서로게이트 쌍이라 **한 글자인데 2로 세어져** 최소 길이 검사를 그냥 통과한다.
 * 사용자가 보는 "한 글자"와 검사가 세는 수가 달랐다.
 *
 * 자소 군집(grapheme cluster)이 아니라 코드 포인트인 것은 계약이 코드 포인트를
 * 정하기 때문이다. 그 경계를 위해 라이브러리를 새로 들이지 않는다.
 */
export function countCodePoints(value: string): number {
  // `[...value]`가 서로게이트 쌍을 한 원소로 묶는다 — 그것이 코드 포인트 수다.
  return [...value].length;
}

const RANGE_SEPARATOR = '..';
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const DATE_TIME = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:?\d{2})?$/;

function parseNumericBound(raw: string, token: RawToken): number {
  if (!/^-?\d+$/.test(raw)) {
    throw syntaxError(`범위 끝이 정수가 아닙니다: '${raw}'`, token.raw, token.start, token.end);
  }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed)) {
    throw syntaxError(`범위 끝이 너무 큽니다: '${raw}'`, token.raw, token.start, token.end);
  }
  return parsed;
}

function checkTemporalBound(raw: string, token: RawToken): string {
  if (!DATE_ONLY.test(raw) && !DATE_TIME.test(raw)) {
    throw syntaxError(
      `날짜 형식이 아닙니다: '${raw}' (예: 2026-08-10 또는 2026-08-10T05:02:11Z)`,
      token.raw,
      token.start,
      token.end,
    );
  }
  // 형식이 맞아도 실재하지 않는 날짜일 수 있다. `Date.parse('2026-02-30')`은
  // 3월 2일로 넘겨 버리므로 NaN 검사로는 잡히지 않는다 — 그대로 두면 범위
  // 비교가 "뒤집혔다"는 엉뚱한 이유로 거절한다.
  const [year, month, day] = raw.slice(0, 10).split('-').map(Number);
  const probe = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() + 1 !== month ||
    probe.getUTCDate() !== day ||
    Number.isNaN(Date.parse(raw))
  ) {
    throw syntaxError(`존재하지 않는 날짜입니다: '${raw}'`, token.raw, token.start, token.end);
  }
  return raw;
}

/**
 * 범위 토큰을 필터로 옮긴다.
 *
 * 양끝이 모두 있어야 한다. 열린 범위(`seq:1200..`)는 요구되지 않았으므로
 * 지어내지 않고, 무엇이 잘못됐는지 말해 주고 거절한다.
 */
function toRangeFilter(key: QueryKey, token: RawToken): RangeFilter {
  const separator = token.value.indexOf(RANGE_SEPARATOR);
  const from = token.value.slice(0, separator);
  const to = token.value.slice(separator + RANGE_SEPARATOR.length);

  if (from === '' || to === '') {
    throw syntaxError(
      `범위는 양끝이 모두 있어야 합니다: '${token.value}' (예: 1200..1350)`,
      token.raw,
      token.start,
      token.end,
    );
  }

  const op = token.negated ? 'not_range' : 'range';
  if (isNumericRangeKey(key)) {
    const low = parseNumericBound(from, token);
    const high = parseNumericBound(to, token);
    if (low > high) {
      throw syntaxError(`범위가 뒤집혔습니다: '${token.value}'`, token.raw, token.start, token.end);
    }
    return { key, op, from: low, to: high };
  }
  if (isTemporalRangeKey(key)) {
    const low = checkTemporalBound(from, token);
    const high = checkTemporalBound(to, token);
    if (Date.parse(low) > Date.parse(high)) {
      throw syntaxError(`범위가 뒤집혔습니다: '${token.value}'`, token.raw, token.start, token.end);
    }
    return { key, op, from: low, to: high };
  }
  // 도달하지 않는다. 호출 측이 `isRangeKey`로 걸렀다.
  throw syntaxError(`범위를 지원하지 않는 키입니다: '${key}'`, token.raw, token.start, token.end);
}

function checkEnumeratedValue(key: QueryKey, token: RawToken): void {
  const allowed = ENUMERATED_VALUES[key];
  if (allowed === undefined || allowed.includes(token.value)) return;

  throw new QueryParseError('QUERY_SYNTAX_ERROR', `'${key}'가 받지 않는 값입니다: '${token.value}'`, {
    token: token.raw,
    offset_start: token.start,
    offset_end: token.end,
    allowed_values: allowed,
  });
}

/**
 * 질의 문자열을 AST로 옮긴다.
 *
 * @throws {QueryParseError} 문법·키·값 오류. 문자 오프셋을 담고 있다.
 */
export function parseQuery(input: string): QueryAst {
  const filters: QueryFilter[] = [];
  /** 같은 (키, op)를 한 노드로 모으기 위한 색인. AC-5의 OR이 이것이다. */
  const equalities = new Map<string, string[]>();
  const textTerms: string[] = [];
  let firstTextStart = -1;

  for (const token of tokenize(input)) {
    if (token.key === null) {
      // 키 없는 낱말은 전문 검색어다. `-`는 필터에만 뜻이 있다.
      if (firstTextStart < 0) firstTextStart = token.start;
      textTerms.push(token.negated ? `-${token.value}` : token.value);
      continue;
    }

    if (!isQueryKey(token.key)) {
      throw unsupportedKey(token.key, token.raw, token.start, token.end);
    }

    // 따옴표로 묶은 값에서는 `..`가 리터럴이다. `label:"1..2"`는 범위가 아니다.
    if (!token.quoted && isRangeKey(token.key) && token.value.includes(RANGE_SEPARATOR)) {
      filters.push(toRangeFilter(token.key, token));
      continue;
    }

    if (token.value === '') {
      throw syntaxError(`'${token.key}'의 값이 비었습니다`, token.raw, token.start, token.end);
    }

    /*
     * 범위 전용 키를 스칼라로 썼다 (DEV-364, DEV-378, DEV-379).
     *
     * 위의 범위 분기를 타지 않고 여기 도달하는 범위 키는 `..`가 없거나
     * 따옴표로 묶인 것뿐이며 둘 다 스칼라다. SRS가 승인한 것은 범위뿐이다 —
     * AC-2·AC-3이 범위만 예시로 들고 AC-7은 아예 "`seq:` **범위** 조건"이라고
     * 적는다. 그러므로 이 거절은 새 제약이 아니라 승인된 경계다.
     *
     * **값이 빈 경우보다 뒤에 둔다.** `seq:`는 "값이 비었습니다"가 더 정확한
     * 사실이며, 사용자가 할 일도 다르다.
     */
    if (isRangeKey(token.key)) {
      throw rangeOnlyKey(token.key, token.raw, token.start, token.end);
    }

    checkEnumeratedValue(token.key, token);

    const op = token.negated ? 'not_eq' : 'eq';
    const bucket = `${token.key} ${op}`;
    const existing = equalities.get(bucket);
    if (existing !== undefined) {
      // 같은 값을 두 번 적어도 한 번만 담는다. OR에서 중복은 뜻이 없다.
      if (!existing.includes(token.value)) existing.push(token.value);
      continue;
    }

    const values: string[] = [token.value];
    equalities.set(bucket, values);
    filters.push({ key: token.key, op, values } satisfies EqualityFilter);
  }

  const text = textTerms.length === 0 ? null : textTerms.join(' ');
  if (text !== null && countCodePoints(text) < MIN_TEXT_LENGTH) {
    // 오프셋은 첫 검색어 낱말의 자리다. 화면이 그 한 글자를 강조한다.
    throw new QueryParseError('QUERY_TOO_SHORT', `검색어는 ${String(MIN_TEXT_LENGTH)}자 이상이어야 합니다`, {
      token: text,
      offset_start: firstTextStart,
      offset_end: firstTextStart + text.length,
    });
  }

  return { filters, text };
}
