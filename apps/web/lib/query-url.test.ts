/**
 * 질의 ↔ URL 왕복 (WP-015 DoD).
 *
 * 왕복이 깨지면 조사 결과를 붙여넣어 보낸 링크가 다른 화면을 연다. 그것이
 * 이 제품에서 가장 조용하고 가장 나쁜 실패다 — 두 사람이 서로 다른 것을
 * 보면서 같은 것을 본다고 믿는다.
 */

import { describe, expect, it } from 'vitest';
import { parseQuery } from '@prs/query';
import {
  EMPTY_STATE,
  PARAM,
  parseQueryState,
  readQueryState,
  toHref,
  withAst,
  writeQueryState,
  type QueryState,
} from './query-url.js';

function roundTrip(state: QueryState): QueryState {
  return readQueryState(writeQueryState(state));
}

describe('왕복', () => {
  it.each([
    ['빈 상태', EMPTY_STATE],
    ['질의만', { ...EMPTY_STATE, q: 'repo:acme/payments author:kim' }],
    ['정렬까지', { ...EMPTY_STATE, q: 'author:kim', sort: 'merge_seq', order: 'desc' as const }],
    ['전부', { q: 'repo:acme/payments', sort: 'merged_at', order: 'asc' as const, size: 50, repository: 'acme/payments' }],
    ['범위 질의', { ...EMPTY_STATE, q: 'seq:1280..1342 merged:2026-08-01..2026-08-19' }],
    ['부정 질의', { ...EMPTY_STATE, q: '-author:bot label:backend' }],
    ['공백이 든 값', { ...EMPTY_STATE, q: 'title:"결제 재시도"' }],
  ])('%s가 그대로 돌아온다', (_label, state) => {
    expect(roundTrip(state)).toEqual(state);
  });

  it('두 번 왕복해도 같다 — 고정점이다', () => {
    const state: QueryState = { q: 'repo:x author:y', sort: 'additions', order: 'asc', size: 25, repository: null };
    expect(roundTrip(roundTrip(state))).toEqual(roundTrip(state));
  });

  it('같은 상태가 늘 같은 문자열이 된다', () => {
    // 키 순서가 흔들리면 브라우저 히스토리에 같은 조건이 여러 항목으로 쌓인다.
    const state: QueryState = { q: 'a:b', sort: 'merge_seq', order: 'desc', size: 10, repository: 'o/r' };
    expect(writeQueryState(state)).toBe(writeQueryState({ ...state }));
  });
});

describe('빈 값은 키째 뺀다', () => {
  it('빈 상태는 빈 문자열이다', () => {
    expect(writeQueryState(EMPTY_STATE)).toBe('');
  });

  it('빈 질의는 `q=`를 남기지 않는다', () => {
    expect(writeQueryState({ ...EMPTY_STATE, q: '   ' })).toBe('');
  });

  it('`null`인 정렬·크기는 키가 없다', () => {
    const search = writeQueryState({ ...EMPTY_STATE, q: 'x:y' });
    expect(search).not.toContain(PARAM.sort);
    expect(search).not.toContain(PARAM.size);
  });

  it('경로만 남는다 — `?`를 붙이지 않는다', () => {
    expect(toHref('/search', EMPTY_STATE)).toBe('/search');
  });

  it('상태가 있으면 `?`로 잇는다', () => {
    expect(toHref('/search', { ...EMPTY_STATE, q: 'a:b' })).toBe('/search?q=a%3Ab');
  });
});

describe('읽기가 이상한 값을 걸러 낸다', () => {
  it('알 수 없는 `order`는 `null`이다', () => {
    expect(readQueryState('order=sideways').order).toBeNull();
  });

  it('정수가 아닌 `size`는 `null`이다', () => {
    for (const raw of ['abc', '2.5', '-1', '0', '']) {
      expect(readQueryState(`size=${raw}`).size, raw).toBeNull();
    }
  });

  it('**모르는 정렬 키는 버리지 않는다** — 서버가 400과 지원 목록을 준다', () => {
    // 여기서 걸러 내면 사용자가 오타를 고칠 기회를 잃는다.
    expect(readQueryState('sort=deletions').sort).toBe('deletions');
  });

  it('없는 파라미터는 기본값이다', () => {
    expect(readQueryState('')).toEqual(EMPTY_STATE);
  });

  it('`URLSearchParams`도 그대로 받는다', () => {
    expect(readQueryState(new URLSearchParams('q=a%3Ab')).q).toBe('a:b');
  });
});

describe('파싱은 `@prs/query`가 한다 (ADR-001)', () => {
  it('올바른 질의는 AST가 된다', () => {
    const { ast, error } = parseQueryState({ ...EMPTY_STATE, q: 'repo:acme/payments' });
    expect(error).toBeNull();
    expect(ast?.filters).toHaveLength(1);
  });

  it('빈 질의는 AST도 오류도 없다', () => {
    expect(parseQueryState(EMPTY_STATE)).toEqual({ ast: null, error: null });
  });

  it('문법 오류를 **던지지 않고 값으로** 돌려준다 — 렌더 중에 부를 수 있어야 한다', () => {
    const { ast, error } = parseQueryState({ ...EMPTY_STATE, q: 'nope:value' });

    expect(ast).toBeNull();
    expect(error?.code).toBe('QUERY_SYNTAX_ERROR');
    // 오프셋이 있어야 화면이 입력창의 어디가 틀렸는지 강조한다 (FR-SRCH-005 AC-4).
    expect(error?.detail.offset_start).toBeGreaterThanOrEqual(0);
    expect(error?.detail.offset_end).toBeGreaterThan(error?.detail.offset_start ?? 0);
  });

  it('지원 키 목록을 함께 준다', () => {
    const { error } = parseQueryState({ ...EMPTY_STATE, q: 'nope:value' });
    expect(error?.detail.supported_keys?.length ?? 0).toBeGreaterThan(0);
  });
});

describe('AST로 상태를 고친다', () => {
  it('직렬화한 질의가 상태에 들어간다', () => {
    const ast = parseQuery('repo:acme/payments author:kim');
    expect(withAst(EMPTY_STATE, ast).q).toBe('repo:acme/payments author:kim');
  });

  it('나머지 상태는 건드리지 않는다', () => {
    const state: QueryState = { q: 'old', sort: 'merge_seq', order: 'asc', size: 50, repository: 'o/r' };
    const next = withAst(state, parseQuery('author:lee'));

    expect(next).toEqual({ ...state, q: 'author:lee' });
  });

  it('AST를 거친 질의도 왕복한다', () => {
    // 패싯 클릭이 이 경로를 쓴다 — 사용자가 친 질의와 화면이 만든 질의가
    // 같은 문법이어야 URL이 흔들리지 않는다.
    const next = withAst(EMPTY_STATE, parseQuery('label:backend label:frontend'));
    expect(roundTrip(next)).toEqual(next);
  });
});
