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
  withFromQuery,
  withQuery,
  writeQueryState,
  type QueryState,
} from './query-url';

function roundTrip(state: QueryState): QueryState {
  return readQueryState(writeQueryState(state));
}

describe('왕복', () => {
  it.each([
    ['빈 상태', EMPTY_STATE],
    ['질의만', { ...EMPTY_STATE, q: 'repo:acme/payments author:kim' }],
    ['정렬까지', { ...EMPTY_STATE, q: 'author:kim', sort: 'merge_seq', order: 'desc' as const }],
    [
      '전부',
      {
        q: 'repo:acme/payments',
        sort: 'merged_at',
        order: 'asc' as const,
        size: 50,
        repository: 'acme/payments',
        seqEpoch: null,
      },
    ],
    // `seq:` 질의는 공간을 지목해야 하고 에폭을 함께 나른다 (CR-051).
    [
      '범위 질의',
      {
        ...EMPTY_STATE,
        q: 'repo:acme/payments base:main seq:1280..1342 merged:2026-08-01..2026-08-19',
        seqEpoch: '3',
      },
    ],
    ['부정 질의', { ...EMPTY_STATE, q: '-author:bot label:backend' }],
    ['공백이 든 값', { ...EMPTY_STATE, q: 'title:"결제 재시도"' }],
  ])('%s가 그대로 돌아온다', (_label, state) => {
    expect(roundTrip(state)).toEqual(state);
  });

  it('두 번 왕복해도 같다 — 고정점이다', () => {
    const state: QueryState = {
      q: 'repo:x author:y',
      sort: 'additions',
      order: 'asc',
      size: 25,
      repository: null,
      seqEpoch: null,
    };
    expect(roundTrip(roundTrip(state))).toEqual(roundTrip(state));
  });

  it('같은 상태가 늘 같은 문자열이 된다', () => {
    // 키 순서가 흔들리면 브라우저 히스토리에 같은 조건이 여러 항목으로 쌓인다.
    const state: QueryState = {
      q: 'a:b',
      sort: 'merge_seq',
      order: 'desc',
      size: 10,
      repository: 'o/r',
      seqEpoch: null,
    };
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
    const state: QueryState = {
      q: 'old',
      sort: 'merge_seq',
      order: 'asc',
      size: 50,
      repository: 'o/r',
      seqEpoch: null,
    };
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

describe('`from_q` 부착 (DEV-078, DEV-097)', () => {
  it('원본 입력을 인코딩해 싣는다', () => {
    expect(withFromQuery('/pr/acme/a/1', 'title:"a&b" OR author:kim')).toBe(
      '/pr/acme/a/1?from_q=title%3A%22a%26b%22%20OR%20author%3Akim',
    );
  });

  it('**되살아난 질의가 원본과 같다** — 왕복이 성립한다', () => {
    const raw = 'repo:acme/payments merged:>2026-01-01';
    const href = withFromQuery('/commit/acme/a/abc', raw);
    expect(new URL(href ?? '', 'https://x.example').searchParams.get('from_q')).toBe(raw);
  });

  it('질의가 비면 그냥 그 경로다 — `?from_q=`를 빈 채로 붙이지 않는다', () => {
    expect(withFromQuery('/pr/acme/a/1', '')).toBe('/pr/acme/a/1');
    expect(withFromQuery('/pr/acme/a/1', '   ')).toBe('/pr/acme/a/1');
  });

  it('**갈 곳이 없으면 `null`이다** — 죽은 링크를 만들지 않는다', () => {
    expect(withFromQuery(null, 'q')).toBeNull();
    expect(withFromQuery('', 'q')).toBeNull();
  });
});

describe('시퀀스 인용 에폭 (CR-051)', () => {
  it('`seq_epoch`이 왕복한다', () => {
    const state: QueryState = {
      ...EMPTY_STATE,
      q: 'repo:acme/payments base:main seq:1280..1342',
      seqEpoch: '3',
    };
    expect(roundTrip(state)).toEqual(state);
    expect(writeQueryState(state)).toContain('seq_epoch=3');
  });

  it('**형식이 틀린 값도 원문 그대로 나른다** — 서버가 거절할 수 있어야 한다 (PR #64 리뷰 P1)', () => {
    /*
     * 화면이 `abc`를 `null`로 접으면 그 파라미터가 요청에서 사라지고, 서버는
     * `INVALID_PARAMETER`를 낼 기회 없이 **현재 세대로 바인딩한다** — 붙여넣은
     * 낡은 주소가 조용히 재해석되는 바로 그 실패다. 판정은 서버 한 곳에서 한다.
     */
    for (const raw of ['abc', '0', '-1', '1.5']) {
      const state = readQueryState(`q=a%3Ab&seq_epoch=${raw}`);
      expect(state.seqEpoch).toBe(raw);
      expect(writeQueryState(state)).toContain(`seq_epoch=${raw}`);
    }
  });

  it('빈 값도 사라지지 않는다 — `seq_epoch=`는 서버가 거절한다', () => {
    // 공백만 남은 값은 `readString`이 `null`로 접는다. 그 경우만 "없음"이다.
    expect(readQueryState('q=a%3Ab&seq_epoch=').seqEpoch).toBeNull();
  });

  it('에폭이 없으면 파라미터를 쓰지 않는다 — 빈 키가 URL에 남지 않는다', () => {
    expect(writeQueryState({ ...EMPTY_STATE, q: 'a:b' })).not.toContain('seq_epoch');
  });

  it('**질의가 `seq:`를 잃으면 에폭도 지운다** (CR-051)', () => {
    /*
     * 뜻이 없어진 파라미터를 남기면 다음 조회가 그것을 근거로 400을 받는다 —
     * 사용자는 토큰 칩 하나를 지웠을 뿐인데 오류를 보게 된다.
     */
    const state: QueryState = {
      ...EMPTY_STATE,
      q: 'repo:acme/payments base:main seq:1..5',
      seqEpoch: '3',
    };
    const next = withAst(state, parseQuery('repo:acme/payments author:kim'));
    expect(next.seqEpoch).toBeNull();
  });

  it('`seq:`가 남아 있으면 에폭을 유지한다', () => {
    const state: QueryState = {
      ...EMPTY_STATE,
      q: 'repo:acme/payments base:main seq:1..5',
      seqEpoch: '3',
    };
    const next = withAst(state, parseQuery('repo:acme/payments base:main seq:1..5 author:kim'));
    expect(next.seqEpoch).toBe('3');
  });

  it('**새 질의로 갈아탈 때는 에폭을 물려주지 않는다**', () => {
    /*
     * 새 질의는 다른 공간을 가리킬 수 있다. 옛 에폭을 그대로 보내면 서버가
     * 무효로 판정해 사용자가 방금 친 질의의 결과 대신 경고를 본다.
     */
    const state: QueryState = { ...EMPTY_STATE, q: 'repo:a/x base:main seq:1..5', seqEpoch: '3' };
    expect(withQuery(state, 'repo:b/y base:main seq:1..5').seqEpoch).toBeNull();
  });
});
