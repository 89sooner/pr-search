/**
 * 구조화 질의 파싱 (WP-011 DoD, FR-SRCH-005).
 *
 * AC 여섯과 CR-014가 메운 빈칸을 고정한다. 파서는 화면과 서버가 함께 쓰는
 * 코드라 (ADR-001), 여기서 흔들리면 입력창의 오류 강조와 서버의 400이 서로
 * 다른 말을 하게 된다.
 */

import { describe, expect, it } from 'vitest';
import { QUERY_KEYS } from './keys.js';
import { QueryParseError } from './errors.js';
import { parseQuery } from './parse.js';

/** 오류를 잡아 상세를 돌려준다. 던지지 않으면 시험을 실패시킨다. */
function reject(input: string): QueryParseError {
  try {
    parseQuery(input);
  } catch (error) {
    if (error instanceof QueryParseError) return error;
    throw error;
  }
  throw new Error(`거절했어야 한다: ${input}`);
}

describe('AC-1: 지원 키 17종', () => {
  it('SRS가 정한 목록 그대로다', () => {
    expect(QUERY_KEYS).toHaveLength(17);
    expect([...QUERY_KEYS]).toEqual([
      'repo', 'org', 'author', 'team', 'author_team', 'reviewer', 'label', 'base',
      'head', 'state', 'merged', 'created', 'seq', 'release', 'path', 'is', 'kind',
    ]);
  });

  it('**`team`과 `author_team`은 다른 키다** (CR-053, DEV-382)', () => {
    // 하나로 합치면 접근 권한을 성과로 읽게 된다. 파서 층에서 그 둘이
    // 별개 필터로 남는 것이 그 구분의 시작이다.
    const ast = parseQuery('team:payments-core author_team:payments-core');
    expect(ast.filters).toHaveLength(2);
    expect(ast.filters.map((one) => one.key).sort()).toEqual(['author_team', 'team']);
  });

  it('`kind`는 값이 열거되어 있다', () => {
    expect(parseQuery('kind:pull_request').filters).toEqual([
      { key: 'kind', op: 'eq', values: ['pull_request'] },
    ]);
    expect(reject('kind:release').code).toBe('QUERY_SYNTAX_ERROR');
    expect(reject('kind:release').detail.allowed_values).toEqual(['pull_request', 'commit']);
  });

  it('DoD: 15종이 모두 파싱된다', () => {
    // `is`는 값이 열거돼 있고, 범위 전용 키 셋은 **범위 형태로만** 성립한다
    // (DEV-364). 나머지는 아무 문자열이나 받는다.
    const ranges: Record<string, string> = {
      seq: '1200..1350',
      merged: '2026-08-10..2026-08-19',
      created: '2026-08-10..2026-08-19',
    };
    const scalars: Record<string, string> = { is: 'merged', kind: 'pull_request' };
    for (const key of QUERY_KEYS) {
      const range = ranges[key];
      if (range !== undefined) {
        expect(parseQuery(`${key}:${range}`).filters).toMatchObject([{ key, op: 'range' }]);
        continue;
      }
      const value = scalars[key] ?? 'x';
      expect(parseQuery(`${key}:${value}`).filters).toEqual([{ key, op: 'eq', values: [value] }]);
    }
  });
});

describe('AC-2·AC-3: 범위', () => {
  it('DoD: `seq:1200..1350`이 숫자 범위가 된다', () => {
    expect(parseQuery('seq:1200..1350')).toEqual({
      filters: [{ key: 'seq', op: 'range', from: 1200, to: 1350 }],
      text: null,
    });
  });

  it('DoD: `merged:2026-08-10..2026-08-19`가 시각 범위가 된다', () => {
    expect(parseQuery('merged:2026-08-10..2026-08-19')).toEqual({
      filters: [{ key: 'merged', op: 'range', from: '2026-08-10', to: '2026-08-19' }],
      text: null,
    });
  });

  it('날짜시각도 받는다', () => {
    const ast = parseQuery('created:2026-08-10T05:02:11Z..2026-08-19T00:00:00Z');
    expect(ast.filters[0]).toMatchObject({ key: 'created', op: 'range' });
  });

  it('입력한 문자열을 그대로 둔다 — 자정으로 펴지 않는다', () => {
    // 시간대 해석은 ES 질의로 옮기는 쪽(WP-013)의 몫이다. 파서가 미리 펴면
    // 사용자가 적은 것과 다른 문자열이 왕복에서 돌아온다.
    const ast = parseQuery('merged:2026-08-10..2026-08-19');
    expect(ast.filters[0]).toMatchObject({ from: '2026-08-10' });
  });

  it('DEV-037: 범위를 받는 키는 셋뿐이다', () => {
    // `path:src/a..b`는 범위가 아니라 그 문자열을 찾는 조건이다.
    expect(parseQuery('path:src/a..b').filters).toEqual([
      { key: 'path', op: 'eq', values: ['src/a..b'] },
    ]);
    expect(parseQuery('label:1..2').filters).toEqual([{ key: 'label', op: 'eq', values: ['1..2'] }]);
  });

  it('따옴표 안에서는 `..`가 리터럴이다', () => {
    // 범위 전용 키로는 이 규칙을 보일 수 없다 — 따옴표가 `..`를 리터럴로
    // 만들면 남는 것이 스칼라라서 거절되기 때문이다(DEV-364). 규칙 자체는
    // 범위를 받지 않는 키에서 확인한다.
    expect(parseQuery('label:"1..2"').filters).toEqual([{ key: 'label', op: 'eq', values: ['1..2'] }]);
    expect(reject('seq:"1..2"').message).toContain('범위 형식');
  });

  it('열린 범위는 거절한다 — 지어내지 않는다', () => {
    expect(reject('seq:1200..').message).toContain('양끝');
    expect(reject('seq:..1350').message).toContain('양끝');
  });

  it('뒤집힌 범위를 거절한다', () => {
    expect(reject('seq:1350..1200').message).toContain('뒤집');
    expect(reject('merged:2026-08-19..2026-08-10').message).toContain('뒤집');
  });

  it('정수가 아닌 숫자 범위를 거절한다', () => {
    expect(reject('seq:abc..10').code).toBe('QUERY_SYNTAX_ERROR');
    expect(reject('seq:1.5..10').message).toContain('정수');
  });

  it('존재하지 않는 날짜를 거절한다', () => {
    // 형식은 맞지만 2월 30일은 없다.
    expect(reject('merged:2026-02-30..2026-03-01').message).toContain('존재하지 않는');
  });

  it('날짜 형식이 아니면 거절하고 예를 보여 준다', () => {
    expect(reject('merged:어제..오늘').message).toContain('2026-08-10');
  });
});

describe('DEV-364: 범위 전용 키의 스칼라를 거절한다', () => {
  it('`seq:1234`가 문법 오류다 — 조용히 0건이 되지 않는다', () => {
    const error = reject('seq:1234');
    expect(error.code).toBe('QUERY_SYNTAX_ERROR');
    expect(error.message).toContain('범위 형식');
    expect(error.message).toContain('seq:1200..1350');
  });

  it('부정형도 거절한다 — 이쪽이 더 나빴다', () => {
    /*
     * 고치기 전 `-seq:1234`는 `must_not: [match_none]`이 되어 **아무것도
     * 걸러내지 않았다**. 사용자는 서수 하나를 뺀 목록을 기대하는데 필터가
     * 통째로 사라진 전체가 돌아왔다 — 스칼라 결함의 두 방향 중 넓어지는 쪽이며
     * 0건보다 알아채기 어렵다.
     */
    expect(reject('-seq:1234').code).toBe('QUERY_SYNTAX_ERROR');
  });

  it('따옴표로 감싸도 스칼라는 스칼라다', () => {
    expect(reject('seq:"1234"').message).toContain('범위 형식');
  });

  it('시각 키 둘도 같은 규칙이다', () => {
    // `merged`·`created`도 `RANGE_FIELDS`에만 있어 스칼라가 `MATCH_NONE`이
    // 되었다. 규칙을 키마다 다르게 두면 그 차이가 다음 결함이 된다.
    expect(reject('merged:2026-08-10').message).toContain('범위 형식');
    expect(reject('created:2026-08-10').message).toContain('범위 형식');
  });

  it('예시는 키마다 다르다 — 사용자를 두 번 틀리게 하지 않는다', () => {
    expect(reject('merged:2026-08-10').message).toContain('merged:2026-08-10..2026-08-19');
    expect(reject('created:2026-08-10').message).toContain('created:2026-08-10..2026-08-19');
  });

  it('오프셋이 문제 토큰을 가리킨다', () => {
    const error = reject('repo:acme/payments seq:1234');
    expect(error.detail.token).toBe('seq:1234');
    expect(error.detail.offset_start).toBe(19);
    expect(error.detail.offset_end).toBe(27);
  });

  it('값이 비면 그 사실을 먼저 말한다', () => {
    // 사용자가 할 일이 다르다 — 값을 적는 것과 형식을 고치는 것.
    expect(reject('seq:').message).toContain('비었습니다');
  });

  it('범위 형태는 그대로 성립한다', () => {
    expect(parseQuery('seq:1..5').filters).toMatchObject([{ key: 'seq', op: 'range' }]);
    expect(parseQuery('-seq:1..5').filters).toMatchObject([{ key: 'seq', op: 'not_range' }]);
    expect(parseQuery('repo:acme/payments base:main seq:1..5').filters).toHaveLength(3);
  });
});

describe('AC-4: 지원하지 않는 키', () => {
  it('DoD: 오프셋과 지원 키 목록을 담는다', () => {
    const error = reject('repo:acme/payments assignee:kim');

    expect(error.code).toBe('QUERY_SYNTAX_ERROR');
    expect(error.message).toContain('assignee');
    expect(error.detail.token).toBe('assignee:kim');
    expect(error.detail.offset_start).toBe(19);
    expect(error.detail.offset_end).toBe(31);
    expect(error.detail.supported_keys).toEqual(QUERY_KEYS);
  });

  it('오프셋이 원문의 실제 자리를 가리킨다', () => {
    const input = '   repo:x   assignee:kim';
    const error = reject(input);
    expect(input.slice(error.detail.offset_start, error.detail.offset_end)).toBe('assignee:kim');
  });

  it('부정된 토큰의 오프셋은 `-`부터다', () => {
    const input = '-assignee:kim';
    const error = reject(input);
    expect(input.slice(error.detail.offset_start, error.detail.offset_end)).toBe('-assignee:kim');
  });
});

describe('AC-5: 같은 키 OR, 다른 키 AND', () => {
  it('DoD: 같은 키가 한 노드에 모인다', () => {
    expect(parseQuery('author:kim author:lee').filters).toEqual([
      { key: 'author', op: 'eq', values: ['kim', 'lee'] },
    ]);
  });

  it('DoD: 다른 키는 각자의 노드다', () => {
    expect(parseQuery('author:kim label:backend').filters).toEqual([
      { key: 'author', op: 'eq', values: ['kim'] },
      { key: 'label', op: 'eq', values: ['backend'] },
    ]);
  });

  it('떨어져 있어도 같은 키는 모인다', () => {
    expect(parseQuery('author:kim label:x author:lee').filters).toEqual([
      { key: 'author', op: 'eq', values: ['kim', 'lee'] },
      { key: 'label', op: 'eq', values: ['x'] },
    ]);
  });

  it('같은 값을 두 번 적어도 한 번만 담는다', () => {
    expect(parseQuery('author:kim author:kim').filters).toEqual([
      { key: 'author', op: 'eq', values: ['kim'] },
    ]);
  });

  it('긍정과 부정은 서로 다른 노드다', () => {
    // `author:kim -author:lee`를 한 노드에 모으면 OR과 AND가 섞여 뜻이 무너진다.
    expect(parseQuery('author:kim -author:lee').filters).toEqual([
      { key: 'author', op: 'eq', values: ['kim'] },
      { key: 'author', op: 'not_eq', values: ['lee'] },
    ]);
  });
});

describe('AC-6: 부정', () => {
  it('DoD: `-author:kim`이 부정 조건이 된다', () => {
    expect(parseQuery('-author:kim').filters).toEqual([
      { key: 'author', op: 'not_eq', values: ['kim'] },
    ]);
  });

  it('DEV-035: 범위에도 붙는다', () => {
    // `-`는 문법의 성질이지 특정 연산자의 성질이 아니다. 범위에만 금지하면
    // 사용자가 이해할 수 없는 특례가 된다.
    expect(parseQuery('-seq:1..10').filters).toEqual([
      { key: 'seq', op: 'not_range', from: 1, to: 10 },
    ]);
    expect(parseQuery('-merged:2026-08-10..2026-08-19').filters).toEqual([
      { key: 'merged', op: 'not_range', from: '2026-08-10', to: '2026-08-19' },
    ]);
  });
});

describe('DEV-036: 값 검증의 경계', () => {
  it('`is`는 열거된 값만 받는다', () => {
    for (const value of ['merged', 'open', 'closed', 'reverted']) {
      expect(parseQuery(`is:${value}`).filters).toEqual([{ key: 'is', op: 'eq', values: [value] }]);
    }
  });

  it('`is`의 벗어난 값은 허용 목록과 함께 거절한다', () => {
    const error = reject('is:draft');
    expect(error.detail.allowed_values).toEqual(['merged', 'open', 'closed', 'reverted']);
    expect(error.detail.token).toBe('is:draft');
    // 지원하는 키이므로 키 목록은 싣지 않는다 — 무엇이 틀렸는지 흐려진다.
    expect(error.detail.supported_keys).toBeUndefined();
  });

  it('열거되지 않은 키의 값은 검증하지 않는다', () => {
    // SRS가 `state`의 값을 열거하지 않았다. 없는 제약을 지어내지 않는다.
    expect(parseQuery('state:whatever').filters).toEqual([
      { key: 'state', op: 'eq', values: ['whatever'] },
    ]);
  });
});

describe('전문 검색어', () => {
  it('키 없는 낱말이 검색어가 된다', () => {
    expect(parseQuery('결제 재시도')).toEqual({ filters: [], text: '결제 재시도' });
  });

  it('필터 사이에 흩어져 있어도 모인다', () => {
    expect(parseQuery('결제 repo:acme/payments 재시도')).toEqual({
      filters: [{ key: 'repo', op: 'eq', values: ['acme/payments'] }],
      text: '결제 재시도',
    });
  });

  it('검색어가 없으면 null이다', () => {
    expect(parseQuery('repo:x').text).toBeNull();
    expect(parseQuery('')).toEqual({ filters: [], text: null });
    expect(parseQuery('   ')).toEqual({ filters: [], text: null });
  });

  it('DEV-038: 1자 검색어는 QUERY_TOO_SHORT다', () => {
    const error = reject('가');
    expect(error.code).toBe('QUERY_TOO_SHORT');
    expect(error.detail.offset_start).toBe(0);
    expect(error.detail.offset_end).toBe(1);
  });

  /*
   * **코드 포인트로 센다** (WP-032 / CR-043, DEV-284).
   *
   * `String.length`는 UTF-16 코드 단위 수다. BMP 밖 문자는 서로게이트 쌍이라
   * **한 글자인데 2로 세어져** 최소 길이 검사를 그냥 통과했다. 사용자가 보는
   * "한 글자"와 검사가 세는 수가 달랐다.
   */
  it('DEV-284: BMP 밖 한 글자도 QUERY_TOO_SHORT다 — `𠮷`', () => {
    // `.length === 2`라 예전 구현은 통과시켰다.
    expect('\u{20BB7}'.length).toBe(2);
    expect(reject('\u{20BB7}').code).toBe('QUERY_TOO_SHORT');
  });

  it('DEV-284: 이모지 한 글자도 QUERY_TOO_SHORT다', () => {
    expect('\u{1F600}'.length).toBe(2);
    expect(reject('\u{1F600}').code).toBe('QUERY_TOO_SHORT');
  });

  it('DEV-284: BMP 밖 두 글자는 통과한다 — 하한을 코드 포인트로 옮겼을 뿐이다', () => {
    const two = '\u{20BB7}\u{20BB7}';
    expect(two.length).toBe(4);
    expect(parseQuery(two).text).toBe(two);
  });

  it('DEV-284: 구조화 필터만 있으면 이 규칙을 적용하지 않는다', () => {
    // 자유 텍스트가 없으면 최소 길이를 물을 대상 자체가 없다.
    expect(parseQuery('repo:a/b').text).toBeNull();
  });

  it('1자라도 필터가 있으면 오프셋이 검색어 자리를 가리킨다', () => {
    const input = 'repo:x 가';
    const error = reject(input);
    expect(input.slice(error.detail.offset_start, error.detail.offset_end)).toBe('가');
  });

  it('2자는 통과한다', () => {
    expect(parseQuery('결제').text).toBe('결제');
  });
});

describe('인용', () => {
  it('공백이 든 값을 묶는다', () => {
    expect(parseQuery('label:"needs review"').filters).toEqual([
      { key: 'label', op: 'eq', values: ['needs review'] },
    ]);
  });

  it('따옴표와 역슬래시를 escape한다', () => {
    expect(parseQuery('label:"say \\"hi\\""').filters).toEqual([
      { key: 'label', op: 'eq', values: ['say "hi"'] },
    ]);
  });

  it('닫히지 않은 따옴표를 거절한다', () => {
    // 남은 문자열을 통째로 값으로 삼으면 오타를 눈치채지 못한 채 검색한다.
    expect(reject('label:"needs review').message).toContain('닫히지');
  });

  it('키 없는 인용 낱말도 검색어다', () => {
    expect(parseQuery('"결제 재시도"').text).toBe('결제 재시도');
  });
});

describe('문법 오류', () => {
  it('값이 빈 키를 거절한다', () => {
    expect(reject('author:').message).toContain('값이 비었');
  });

  it('키처럼 보이지 않는 것은 검색어로 둔다', () => {
    // `12:30`은 키가 아니다. 시각을 적었을 수도 있으니 검색어로 흘린다.
    expect(parseQuery('12:30')).toEqual({ filters: [], text: '12:30' });
  });

  it('토큰마다 따로 본다 — 앞에 검색어가 있어도 뒤의 키는 키다', () => {
    expect(parseQuery('결제 repo:acme/payments')).toEqual({
      filters: [{ key: 'repo', op: 'eq', values: ['acme/payments'] }],
      text: '결제',
    });
    // 그래서 지원하지 않는 키는 앞에 무엇이 있든 거절된다 (AC-4).
    expect(reject('결제 assignee:kim').detail.token).toBe('assignee:kim');
  });

  it('콜론이 든 검색어는 따옴표로 묶어야 한다', () => {
    // `fix: 결제 오류`처럼 적으면 `fix`가 키로 읽혀 거절된다. AC-4가 정한
    // 동작이며, 오류가 지원 키 목록을 보여 주므로 사용자는 따옴표를 쓸 수 있다.
    expect(reject('fix: 결제 오류').detail.token).toBe('fix:');
    expect(parseQuery('"fix: 결제 오류"').text).toBe('fix: 결제 오류');
  });
});
