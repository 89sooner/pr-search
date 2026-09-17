/**
 * 직렬화와 왕복 (WP-011 DoD 7).
 *
 * 화면은 파싱된 토큰 칩을 보여 주고, 칩을 지우거나 패싯을 고르면 AST를 고쳐
 * 다시 문자열로 만들어 URL에 넣는다 (`/search?q=<질의>`). **왕복이 흔들리면
 * 칩 하나를 지울 때마다 질의가 조금씩 달라진다.**
 */

import { describe, expect, it } from 'vitest';
import { parseQuery } from './parse.js';
import { serializeQuery } from './serialize.js';

/** 실제 쓰일 법한 질의들. 왕복 성질을 이 전부에 건다. */
const CORPUS = [
  '',
  'repo:acme/payments',
  'repo:acme/payments seq:1280..1342 -author:bot',
  'author:kim author:lee label:backend',
  'author:kim -author:lee',
  '-seq:1..10',
  '-merged:2026-08-10..2026-08-19',
  'created:2026-08-10T05:02:11Z..2026-08-19T00:00:00Z',
  'is:merged state:closed',
  'label:"needs review"',
  'label:"say \\"hi\\""',
  'path:src/a..b',
  '결제 재시도',
  '결제 repo:acme/payments 재시도',
  'repo:acme/payments org:acme team:payments-core reviewer:lee base:main head:feature/x release:v1 path:src/pay.ts is:reverted',
  '"fix: 결제 오류"',
  '-결제',
  // 식별자 범위 (CR-106). 지문 재료로 쓰이는 `serializeQuery`가 새 키를
  // 특별 취급 없이 왕복시키는지 — 키 목록에 빠뜨리면 여기서 먼저 깨진다.
  'repo:acme/payments pr_number:100..200',
  'repo:acme/payments base:main mnum:1..50',
];

describe('DoD 7: 왕복', () => {
  it.each(CORPUS)('파싱 → 직렬화 → 재파싱이 같은 AST를 만든다: %s', (input) => {
    const first = parseQuery(input);
    const second = parseQuery(serializeQuery(first));
    expect(second).toEqual(first);
  });

  it.each(CORPUS)('두 번째 직렬화부터는 문자열도 고정된다: %s', (input) => {
    // URL이 이유 없이 바뀌지 않으려면 문자열까지 안정돼야 한다.
    const once = serializeQuery(parseQuery(input));
    const twice = serializeQuery(parseQuery(once));
    expect(twice).toBe(once);
  });
});

describe('직렬화 형태', () => {
  it('필터가 먼저, 검색어가 뒤다', () => {
    expect(serializeQuery(parseQuery('결제 repo:x 재시도'))).toBe('repo:x 결제 재시도');
  });

  it('같은 키의 값 하나하나가 토큰이 된다', () => {
    expect(serializeQuery(parseQuery('author:kim author:lee'))).toBe('author:kim author:lee');
  });

  it('부정을 `-`로 되돌린다 — 범위에도 붙는다', () => {
    expect(serializeQuery(parseQuery('-author:kim'))).toBe('-author:kim');
    expect(serializeQuery(parseQuery('-seq:1..10'))).toBe('-seq:1..10');
  });

  it('범위를 `a..b`로 되돌린다', () => {
    expect(serializeQuery(parseQuery('seq:1200..1350'))).toBe('seq:1200..1350');
    expect(serializeQuery(parseQuery('merged:2026-08-10..2026-08-19'))).toBe(
      'merged:2026-08-10..2026-08-19',
    );
  });

  it('빈 AST는 빈 문자열이다', () => {
    expect(serializeQuery({ filters: [], text: null })).toBe('');
  });
});

describe('인용 규칙', () => {
  it('공백이 든 값을 다시 묶는다', () => {
    expect(serializeQuery(parseQuery('label:"needs review"'))).toBe('label:"needs review"');
  });

  it('따옴표와 역슬래시를 escape한다', () => {
    const ast = { filters: [{ key: 'label', op: 'eq', values: ['a"b\\c'] }], text: null } as const;
    expect(serializeQuery(ast)).toBe('label:"a\\"b\\\\c"');
    expect(parseQuery(serializeQuery(ast))).toEqual(ast);
  });

  it('콜론이 든 값을 묶는다 — 묶지 않으면 키 구분자로 다시 읽힌다', () => {
    const ast = { filters: [{ key: 'path', op: 'eq', values: ['src/a:b'] }], text: null } as const;
    expect(serializeQuery(ast)).toBe('path:"src/a:b"');
    expect(parseQuery(serializeQuery(ast))).toEqual(ast);
  });

  it('`-`로 시작하는 값을 묶는다 — 묶지 않으면 부정으로 읽힌다', () => {
    const ast = { filters: [{ key: 'label', op: 'eq', values: ['-wip'] }], text: null } as const;
    expect(serializeQuery(ast)).toBe('label:"-wip"');
    expect(parseQuery(serializeQuery(ast))).toEqual(ast);
  });

  it('묶을 필요가 없으면 묶지 않는다', () => {
    expect(serializeQuery(parseQuery('repo:acme/payments'))).toBe('repo:acme/payments');
  });

  it('검색어의 `-`는 그대로 둔다 — 검색어에서는 부정이 아니다', () => {
    expect(serializeQuery(parseQuery('-결제'))).toBe('-결제');
    expect(parseQuery('-결제').text).toBe('-결제');
  });

  it('콜론이 든 검색어를 묶어 키로 오해받지 않게 한다', () => {
    expect(serializeQuery(parseQuery('"fix: 결제"'))).toBe('"fix:" 결제');
    expect(parseQuery(serializeQuery(parseQuery('"fix: 결제"'))).text).toBe('fix: 결제');
  });
});

describe('화면이 AST를 고치는 경우', () => {
  it('칩 하나를 지운 결과가 온전한 질의다', () => {
    const ast = parseQuery('repo:acme/payments author:kim seq:1..10');
    const withoutAuthor = { ...ast, filters: ast.filters.filter((f) => f.key !== 'author') };

    const serialized = serializeQuery(withoutAuthor);
    expect(serialized).toBe('repo:acme/payments seq:1..10');
    expect(parseQuery(serialized)).toEqual(withoutAuthor);
  });

  it('패싯으로 값을 더한 결과도 온전하다', () => {
    const ast = parseQuery('repo:acme/payments');
    const withLabel = {
      ...ast,
      filters: [...ast.filters, { key: 'label', op: 'eq', values: ['backend'] } as const],
    };

    expect(serializeQuery(withLabel)).toBe('repo:acme/payments label:backend');
    expect(parseQuery(serializeQuery(withLabel))).toEqual(withLabel);
  });
});
