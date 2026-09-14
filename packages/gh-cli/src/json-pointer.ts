/**
 * 제한된 JSON Pointer — 바인딩의 명시적 선택 (FR-GH-005 AC-8, ADR-020, CR-089).
 *
 * **표현식 해석기가 아니다.** 문법은 RFC 6901 3장, 평가는 4장을 따르고, 이 제품은 그 위에 제한을 더한다.
 * `eval`·`Function`·JSONPath·jq·템플릿은 어디에도 없다.
 *
 * | RFC 6901이 정한 것 | 여기서 |
 * | --- | --- |
 * | `json-pointer = *( "/" reference-token )` — 빈 문자열은 문서 전체 | 같다. 비어 있지 않은데 `/`로 시작하지 않으면 `syntax` |
 * | `escaped = "~" ( "0" / "1" )` — 다른 `~`는 문법 오류(3장) | `invalid_escape` |
 * | `~1`을 먼저 `/`로, 그다음 `~0`을 `~`로 바꾼다(4장) — `~01`은 `~1`이 된다 | 같은 순서 |
 * | 객체 멤버는 이름이 코드 포인트 단위로 같아야 하고 정규화하지 않는다 | 자기 속성(own property)만. 상속 속성은 없는 멤버다 |
 * | 배열 인덱스 `%x30 / ( %x31-39 *(%x30-39) )` — 선행 0 금지 | 같다. 길이 밖이면 `index_out_of_range` |
 * | `-`는 마지막 원소 뒤의 없는 원소라 평가하면 오류 조건이다 | `end_of_array`로 거절한다 — 추가 위치로 해석하지 않는다 |
 * | 없는 값을 가리키면 오류 조건이다(7장) | `nonexistent_member` — 기본값·첫 원소로 보정하지 않는다 |
 *
 * 이 제품이 **더 거절하는 것**: 길이 128자 초과, 토큰 8개 초과, `__proto__`·`constructor`·`prototype` 토큰(JSON.parse가
 * 자기 속성으로 만들 수 있어도), 평범한 객체·배열이 아닌 값 안으로 들어가기. URI 조각 표현(6장, `#/…`)은 받지 않는다 —
 * `#`은 그냥 문자다.
 */

export const JSON_POINTER_MAX_LENGTH = 128;
export const JSON_POINTER_MAX_TOKENS = 8;

const FORBIDDEN_TOKENS: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype']);
const ARRAY_INDEX = /^(?:0|[1-9][0-9]*)$/;

export type JsonPointerError =
  | 'too_long'
  | 'syntax'
  | 'invalid_escape'
  | 'too_deep'
  | 'forbidden_token'
  | 'nonexistent_member'
  | 'not_a_container'
  | 'invalid_array_index'
  | 'end_of_array'
  | 'index_out_of_range';

export type JsonPointerParse =
  | { readonly ok: true; readonly tokens: readonly string[] }
  | { readonly ok: false; readonly error: JsonPointerError; readonly token: string | null };

export type JsonPointerEvaluation =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly error: JsonPointerError; readonly token: string | null };

/** 포인터 문자열을 토큰으로 나눈다. 평가하지 않는다. */
export function parseJsonPointer(pointer: string): JsonPointerParse {
  if (pointer.length > JSON_POINTER_MAX_LENGTH) return { ok: false, error: 'too_long', token: null };
  if (pointer === '') return { ok: true, tokens: [] };
  if (!pointer.startsWith('/')) return { ok: false, error: 'syntax', token: null };
  const pieces = pointer.slice(1).split('/');
  if (pieces.length > JSON_POINTER_MAX_TOKENS) return { ok: false, error: 'too_deep', token: null };
  const tokens: string[] = [];
  for (const piece of pieces) {
    if (/~(?![01])/.test(piece)) return { ok: false, error: 'invalid_escape', token: piece };
    const token = piece.replace(/~1/g, '/').replace(/~0/g, '~');
    if (FORBIDDEN_TOKENS.has(token)) return { ok: false, error: 'forbidden_token', token };
    tokens.push(token);
  }
  return { ok: true, tokens };
}

/** JSON.parse가 만드는 평범한 객체인가 — 클래스 인스턴스·Map 안으로는 들어가지 않는다. */
function isPlainObject(value: unknown): value is Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * JSON 값(`document`)에서 포인터가 가리키는 값을 찾는다. 순수 함수다 — 값을 바꾸지 않고, 없는 값을 만들지 않는다.
 */
export function evaluateJsonPointer(document: unknown, pointer: string): JsonPointerEvaluation {
  const parsed = parseJsonPointer(pointer);
  if (!parsed.ok) return parsed;
  let current: unknown = document;
  for (const token of parsed.tokens) {
    if (Array.isArray(current)) {
      if (token === '-') return { ok: false, error: 'end_of_array', token };
      if (!ARRAY_INDEX.test(token)) return { ok: false, error: 'invalid_array_index', token };
      const index = Number(token);
      if (!Number.isSafeInteger(index) || index >= current.length) return { ok: false, error: 'index_out_of_range', token };
      current = current[index] as unknown;
      continue;
    }
    if (isPlainObject(current)) {
      if (!Object.prototype.hasOwnProperty.call(current, token)) return { ok: false, error: 'nonexistent_member', token };
      current = current[token];
      continue;
    }
    return { ok: false, error: 'not_a_container', token };
  }
  return { ok: true, value: current };
}
