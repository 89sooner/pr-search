/**
 * 토크나이저 (FR-SRCH-005).
 *
 * 문자 오프셋을 잃지 않는 것이 이 단계의 전부다. AC-4가 "문제 토큰의 문자
 * 오프셋"을 요구하고 화면이 그것으로 입력창을 강조하므로, 토큰을 잘라 내는
 * 순간 위치를 함께 들고 다녀야 한다.
 *
 * 문법은 셋뿐이다 — `key:value`, `-key:value`, 그리고 키 없는 낱말.
 * 값은 따옴표로 묶을 수 있고 그 안에서 `"`와 `\` 는 `\`로 escape한다.
 */

import { syntaxError } from './errors.js';

export interface RawToken {
  /** 토큰 원문. 오류 본문에 그대로 실린다. */
  readonly raw: string;
  readonly start: number;
  /** 끝 위치(제외). */
  readonly end: number;
  readonly negated: boolean;
  /** 키 없는 낱말이면 `null`. */
  readonly key: string | null;
  /** 따옴표를 벗기고 escape를 푼 값. 키가 없으면 낱말 자체다. */
  readonly value: string;
  /** 값이 따옴표로 묶여 있었는지. 직렬화가 다시 묶을지 정할 때 쓴다. */
  readonly quoted: boolean;
}

const KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/;

/** 공백 아닌 문자가 나올 때까지 건너뛴다. */
function skipSpace(input: string, index: number): number {
  let cursor = index;
  while (cursor < input.length && /\s/.test(input[cursor] ?? '')) cursor += 1;
  return cursor;
}

/**
 * 따옴표 문자열을 읽는다.
 *
 * 닫히지 않은 따옴표는 오류다. 남은 문자열을 통째로 값으로 삼으면 사용자가
 * 오타를 눈치채지 못한 채 엉뚱한 검색을 한다.
 */
function readQuoted(input: string, start: number, tokenStart: number): { value: string; next: number } {
  let cursor = start + 1;
  let value = '';

  while (cursor < input.length) {
    const char = input[cursor] ?? '';
    if (char === '\\') {
      const escaped = input[cursor + 1];
      if (escaped === undefined) break;
      value += escaped;
      cursor += 2;
      continue;
    }
    if (char === '"') return { value, next: cursor + 1 };
    value += char;
    cursor += 1;
  }

  throw syntaxError(
    'Unclosed quotation mark',
    input.slice(tokenStart),
    tokenStart,
    input.length,
  );
}

/** 공백이 나올 때까지 읽는다. */
function readBare(input: string, start: number): { value: string; next: number } {
  let cursor = start;
  while (cursor < input.length && !/\s/.test(input[cursor] ?? '')) cursor += 1;
  return { value: input.slice(start, cursor), next: cursor };
}

export function tokenize(input: string): RawToken[] {
  const tokens: RawToken[] = [];
  let cursor = skipSpace(input, 0);

  while (cursor < input.length) {
    const tokenStart = cursor;
    const negated = input[cursor] === '-';
    if (negated) cursor += 1;

    // 키를 찾는다. 따옴표로 시작하면 키가 없는 인용 낱말이다.
    let key: string | null = null;
    if (input[cursor] !== '"') {
      const colon = input.indexOf(':', cursor);
      if (colon > cursor) {
        const candidate = input.slice(cursor, colon);
        // 공백이 끼면 `key:` 형태가 아니다. `foo bar:baz`의 `foo`가 그렇다.
        if (KEY_PATTERN.test(candidate)) {
          key = candidate;
          cursor = colon + 1;
        }
      }
    }

    const quoted = input[cursor] === '"';
    const read = quoted ? readQuoted(input, cursor, tokenStart) : readBare(input, cursor);
    cursor = read.next;

    // `-`만 있고 뒤가 빈 토큰은 버린다. 사용자가 지우다 만 흔적이다.
    if (read.value !== '' || quoted || key !== null) {
      tokens.push({
        raw: input.slice(tokenStart, cursor),
        start: tokenStart,
        end: cursor,
        negated,
        key,
        value: read.value,
        quoted,
      });
    }

    cursor = skipSpace(input, cursor);
  }

  return tokens;
}
