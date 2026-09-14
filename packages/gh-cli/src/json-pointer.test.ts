/**
 * 제한된 JSON Pointer (RFC 6901 부분집합, FR-GH-005 AC-8, CR-089).
 *
 * 두 성질을 따로 건다. (1) **표준 적합성** — RFC 6901 5장의 예시 문서와 포인터 12개가 같은 값을 가리키고, 4장의 해독
 * 순서(`~01` → `~1`)와 배열 인덱스 문법(선행 0 금지, `-`는 오류)이 지켜진다. (2) **제품 제한** — 상속 속성·prototype
 * 토큰·길이·깊이·평범하지 않은 객체를 거절하고 없는 값을 보정하지 않는다.
 */

import { describe, expect, it } from 'vitest';
import { JSON_POINTER_MAX_LENGTH, JSON_POINTER_MAX_TOKENS, evaluateJsonPointer, parseJsonPointer } from './json-pointer.js';

/** RFC 6901 5장의 예시 문서 그대로. */
const RFC_DOCUMENT: unknown = JSON.parse('{"foo":["bar","baz"],"":0,"a/b":1,"c%d":2,"e^f":3,"g|h":4,"i\\\\j":5,"k\\"l":6," ":7,"m~n":8}');

describe('RFC 6901 5장 예시 — 표준 적합성', () => {
  it('포인터 12개가 RFC가 적은 값을 가리킨다', () => {
    const cases: readonly (readonly [string, unknown])[] = [
      ['', RFC_DOCUMENT],
      ['/foo', ['bar', 'baz']],
      ['/foo/0', 'bar'],
      ['/', 0],
      ['/a~1b', 1],
      ['/c%d', 2],
      ['/e^f', 3],
      ['/g|h', 4],
      ['/i\\j', 5],
      ['/k"l', 6],
      ['/ ', 7],
      ['/m~0n', 8],
    ];
    for (const [pointer, expected] of cases) {
      expect(evaluateJsonPointer(RFC_DOCUMENT, pointer), pointer).toEqual({ ok: true, value: expected });
    }
  });

  it('~1을 먼저, ~0을 나중에 푼다 — `~01`은 `/`가 아니라 `~1`이다 (4장)', () => {
    const document: unknown = JSON.parse('{"~1":"tilde-one","/":"slash"}');
    expect(evaluateJsonPointer(document, '/~01')).toEqual({ ok: true, value: 'tilde-one' });
    expect(evaluateJsonPointer(document, '/~1')).toEqual({ ok: true, value: 'slash' });
    expect(parseJsonPointer('/~0~1/~1~0')).toEqual({ ok: true, tokens: ['~/', '/~'] });
  });

  it('`~` 뒤에는 0·1만 온다 — 나머지는 문법 오류다 (3장)', () => {
    for (const pointer of ['/~', '/~2', '/a~', '/~~0', '/foo~x']) {
      expect(parseJsonPointer(pointer), pointer).toMatchObject({ ok: false, error: 'invalid_escape' });
    }
    expect(parseJsonPointer('foo')).toMatchObject({ ok: false, error: 'syntax' });
    expect(parseJsonPointer('#/foo')).toMatchObject({ ok: false, error: 'syntax' });
  });

  it('배열 인덱스는 선행 0이 없는 10진수이고, `-`와 길이 밖은 오류다 — 추가 위치·마지막 원소로 해석하지 않는다', () => {
    expect(evaluateJsonPointer(RFC_DOCUMENT, '/foo/1')).toEqual({ ok: true, value: 'baz' });
    expect(evaluateJsonPointer(RFC_DOCUMENT, '/foo/01')).toMatchObject({ ok: false, error: 'invalid_array_index', token: '01' });
    expect(evaluateJsonPointer(RFC_DOCUMENT, '/foo/-')).toMatchObject({ ok: false, error: 'end_of_array' });
    expect(evaluateJsonPointer(RFC_DOCUMENT, '/foo/2')).toMatchObject({ ok: false, error: 'index_out_of_range' });
    for (const token of ['-1', '1.0', ' 1', '1e0', '0x1', '']) {
      expect(evaluateJsonPointer(RFC_DOCUMENT, `/foo/${token}`), token).toMatchObject({ ok: false, error: 'invalid_array_index' });
    }
    expect(evaluateJsonPointer(RFC_DOCUMENT, '/foo/99999999999999999999')).toMatchObject({ ok: false, error: 'index_out_of_range' });
  });
});

describe('제품 제한 — 없는 값·상속 속성·prototype·크기', () => {
  it('없는 멤버와 원시값 안으로 들어가기는 실패다 — 기본값으로 보정하지 않는다', () => {
    expect(evaluateJsonPointer(RFC_DOCUMENT, '/nope')).toMatchObject({ ok: false, error: 'nonexistent_member', token: 'nope' });
    expect(evaluateJsonPointer(RFC_DOCUMENT, '/foo/0/x')).toMatchObject({ ok: false, error: 'not_a_container' });
    expect(evaluateJsonPointer(null, '/x')).toMatchObject({ ok: false, error: 'not_a_container' });
    expect(evaluateJsonPointer(RFC_DOCUMENT, '/%20')).toMatchObject({ ok: false, error: 'nonexistent_member' }); // URI 조각 표현(6장)은 받지 않는다
  });

  it('상속 속성은 없는 멤버다 — 자기 속성만 읽는다', () => {
    for (const token of ['toString', 'hasOwnProperty', 'valueOf', '__defineGetter__']) {
      expect(evaluateJsonPointer({}, `/${token}`), token).toMatchObject({ ok: false, error: 'nonexistent_member' });
    }
    expect(evaluateJsonPointer([1], '/length')).toMatchObject({ ok: false, error: 'invalid_array_index' });
  });

  it('`__proto__`·`constructor`·`prototype` 토큰은 JSON.parse가 자기 속성으로 만들었어도 거절한다', () => {
    const document: unknown = JSON.parse('{"__proto__":{"x":1},"constructor":{"x":2},"prototype":{"x":3},"a":{"__proto__":4}}');
    for (const pointer of ['/__proto__', '/__proto__/x', '/constructor', '/prototype/x', '/a/__proto__', '/a~1b/__proto__']) {
      expect(evaluateJsonPointer(document, pointer), pointer).toMatchObject({ ok: false, error: 'forbidden_token' });
    }
  });

  it('평범한 객체·배열이 아닌 값 안으로 들어가지 않는다', () => {
    class Box {
      readonly a = 1;
    }
    expect(evaluateJsonPointer(new Map([['a', 1]]), '/a')).toMatchObject({ ok: false, error: 'not_a_container' });
    expect(evaluateJsonPointer(new Box(), '/a')).toMatchObject({ ok: false, error: 'not_a_container' });
    expect(evaluateJsonPointer(Object.create(null) as unknown, '/a')).toMatchObject({ ok: false, error: 'nonexistent_member' });
  });

  it('길이와 깊이에 상한이 있다', () => {
    const deep = `/${Array.from({ length: JSON_POINTER_MAX_TOKENS }, () => 'a').join('/')}`;
    expect(parseJsonPointer(deep).ok).toBe(true);
    expect(parseJsonPointer(`${deep}/a`)).toMatchObject({ ok: false, error: 'too_deep' });
    expect(parseJsonPointer(`/${'a'.repeat(JSON_POINTER_MAX_LENGTH)}`)).toMatchObject({ ok: false, error: 'too_long' });
  });

  it('평가는 문서를 바꾸지 않는다', () => {
    const document = { items: [{ id: 1 }, { id: 2 }] };
    const before = JSON.stringify(document);
    expect(evaluateJsonPointer(Object.freeze(document), '/items/1/id')).toEqual({ ok: true, value: 2 });
    expect(JSON.stringify(document)).toBe(before);
  });
});
