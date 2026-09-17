/**
 * `seq:`의 시퀀스 공간 지목 (CR-051 / FR-SRCH-005 AC-7).
 *
 * 이 판정이 DEV-349의 뿌리를 막는다 — 공간을 지목하지 않는 `seq:`는 접근
 * 범위의 모든 공간에 걸치고, 그때 "그 공간의 에폭"이라는 것이 존재하지 않는다.
 */

import { describe, expect, it } from 'vitest';
import type { QueryAst } from './ast.js';
import { QueryParseError } from './errors.js';
import { parseQuery } from './parse.js';
import {
  MERGE_NUMBER_BINDING_MESSAGE,
  SEQUENCE_BINDING_MESSAGE,
  analyzeMergeNumberBinding,
  analyzePrNumberBinding,
  analyzeSequenceBinding,
  hasMergeNumberRangeFilter,
  hasPrNumberRangeFilter,
  hasSequenceRangeFilter,
} from './sequence-binding.js';

function analyze(query: string) {
  return analyzeSequenceBinding(parseQuery(query));
}

function analyzeMnum(query: string) {
  return analyzeMergeNumberBinding(parseQuery(query));
}

function analyzePrNumber(query: string) {
  return analyzePrNumberBinding(parseQuery(query));
}

describe('FR-SRCH-005 AC-7: seq: 범위는 공간을 지목해야 한다', () => {
  it('`repo:` 하나와 `base:` 하나면 확정된다', () => {
    expect(analyze('repo:acme/payments base:main seq:1200..1350')).toEqual({
      kind: 'bound',
      repository: 'acme/payments',
      baseBranch: 'main',
    });
  });

  it('**같은 값을 두 번 적은 것은 하나로 본다** — 굳이 모호로 만들지 않는다', () => {
    expect(analyze('repo:acme/payments repo:acme/payments base:main seq:1..5')).toEqual({
      kind: 'bound',
      repository: 'acme/payments',
      baseBranch: 'main',
    });
  });

  it('**부정된 `-seq:` 범위도 같은 규칙을 따른다** — 서수를 참조하는 것은 같다', () => {
    expect(analyze('repo:acme/payments base:main -seq:1..5')).toEqual({
      kind: 'bound',
      repository: 'acme/payments',
      baseBranch: 'main',
    });
    expect(analyze('-seq:1..5')).toEqual({ kind: 'invalid', reason: 'sequence_space_required' });
  });

  it.each([
    ['단독', 'seq:1200..1350'],
    ['base 없음', 'repo:acme/payments seq:1200..1350'],
    ['repo 없음', 'base:main seq:1200..1350'],
    ['다른 조건만 있음', 'author:kim seq:1..5'],
  ])('%s이면 거절한다 (sequence_space_required)', (_label, query) => {
    expect(analyze(query)).toEqual({ kind: 'invalid', reason: 'sequence_space_required' });
  });

  it.each([
    ['repo 둘', 'repo:a/x repo:b/y base:main seq:1..5'],
    ['base 둘', 'repo:a/x base:main base:release seq:1..5'],
  ])('%s이면 거절한다 (sequence_space_ambiguous)', (_label, query) => {
    expect(analyze(query)).toEqual({ kind: 'invalid', reason: 'sequence_space_ambiguous' });
  });

  it('**부정된 `repo:`는 지목이 아니다** — 무엇을 빼는지는 어느 공간인지를 말하지 않는다', () => {
    expect(analyze('-repo:a/x base:main seq:1..5')).toEqual({
      kind: 'invalid',
      reason: 'sequence_space_required',
    });
  });

  it('없는 것과 여럿인 것을 **가른다** — 사용자가 할 일이 다르다', () => {
    /*
     * 없으면 더해야 하고 여럿이면 골라야 한다. 하나의 사유로 묶으면 화면이
     * 같은 문장을 두 상황에 쓰게 되고, 그중 하나는 반드시 틀린 안내가 된다.
     */
    const missing = analyze('seq:1..5');
    const ambiguous = analyze('repo:a/x repo:b/y base:main seq:1..5');
    expect(missing).not.toEqual(ambiguous);
  });
});

describe('seq: 범위가 없는 질의', () => {
  it.each([
    ['빈 질의', ''],
    ['구조화 질의', 'repo:acme/payments author:kim'],
    ['전문 검색', '결제 재시도'],
    ['다른 범위', 'merged:2026-08-01..2026-08-31'],
  ])('%s는 어느 공간에도 묶이지 않는다', (_label, query) => {
    expect(analyze(query)).toEqual({ kind: 'none' });
    expect(hasSequenceRangeFilter(parseQuery(query))).toBe(false);
  });

  it('**스칼라 `seq:1234`는 파서가 먼저 거절한다** (DEV-364)', () => {
    /*
     * CR-051 시점에는 스칼라가 파서를 통과했고, 지목 규칙을 거기에 적용하면
     * 동작이 400으로 바뀌는 것이 승인 범위 밖이라 사실만 등재했다. 이후 실측이
     * 부정형 `-seq:1234`는 0건이 아니라 **필터가 사라진 전체 결과**임을
     * 드러냈고(DEV-378), SRS가 승인한 것이 범위뿐이므로 파서에서 닫았다.
     */
    expect(() => parseQuery('seq:1234')).toThrow(QueryParseError);
  });

  it('AST를 직접 조립해도 범위 조건만 본다', () => {
    /*
     * 이 함수의 계약은 **"범위 필터인가"이지 "seq 키인가"가 아니다.** 파서를
     * 거치지 않는 조립 경로가 생겨도 그 경계는 그대로여야 하므로, 파서가
     * 거절하는 모양을 손으로 만들어 건다.
     */
    const scalarAst: QueryAst = {
      filters: [{ key: 'seq', op: 'eq', values: ['1234'] }],
      text: null,
    };
    expect(hasSequenceRangeFilter(scalarAst)).toBe(false);
    expect(analyzeSequenceBinding(scalarAst)).toEqual({ kind: 'none' });
  });
});

describe('FR-SRCH-005 AC-9: mnum: 범위도 seq:와 같은 공간을 지목해야 한다 (CR-106)', () => {
  it('`repo:` 하나와 `base:` 하나면 확정된다', () => {
    expect(analyzeMnum('repo:acme/payments base:main mnum:1..50')).toEqual({
      kind: 'bound',
      repository: 'acme/payments',
      baseBranch: 'main',
    });
  });

  it('같은 값을 두 번 적은 것은 하나로 본다', () => {
    expect(analyzeMnum('repo:acme/payments repo:acme/payments base:main mnum:1..5')).toEqual({
      kind: 'bound',
      repository: 'acme/payments',
      baseBranch: 'main',
    });
  });

  it('부정된 `-mnum:` 범위도 같은 규칙을 따른다 — M 번호를 참조하는 것은 같다', () => {
    expect(analyzeMnum('repo:acme/payments base:main -mnum:1..5')).toEqual({
      kind: 'bound',
      repository: 'acme/payments',
      baseBranch: 'main',
    });
    expect(analyzeMnum('-mnum:1..5')).toEqual({ kind: 'invalid', reason: 'sequence_space_required' });
  });

  it.each([
    ['단독', 'mnum:1..50'],
    ['base 없음', 'repo:acme/payments mnum:1..50'],
    ['repo 없음', 'base:main mnum:1..50'],
  ])('%s이면 거절한다 (sequence_space_required)', (_label, query) => {
    expect(analyzeMnum(query)).toEqual({ kind: 'invalid', reason: 'sequence_space_required' });
  });

  it.each([
    ['repo 둘', 'repo:a/x repo:b/y base:main mnum:1..5'],
    ['base 둘', 'repo:a/x base:main base:release mnum:1..5'],
  ])('%s이면 거절한다 (sequence_space_ambiguous)', (_label, query) => {
    expect(analyzeMnum(query)).toEqual({ kind: 'invalid', reason: 'sequence_space_ambiguous' });
  });

  it('부정된 `repo:`는 지목이 아니다', () => {
    expect(analyzeMnum('-repo:a/x base:main mnum:1..5')).toEqual({
      kind: 'invalid',
      reason: 'sequence_space_required',
    });
  });

  it.each([
    ['빈 질의', ''],
    ['구조화 질의', 'repo:acme/payments author:kim'],
    ['다른 범위', 'seq:1..50'],
    ['pr_number 범위', 'repo:acme/payments pr_number:1..50'],
  ])('%s는 어느 공간에도 묶이지 않는다', (_label, query) => {
    expect(analyzeMnum(query)).toEqual({ kind: 'none' });
    expect(hasMergeNumberRangeFilter(parseQuery(query))).toBe(false);
  });

  it('**`hasSequenceRangeFilter`는 `mnum:`을 보지 않는다** — 두 검출 함수가 섞이지 않는다', () => {
    // 지목 규칙(공간)은 같아도 에폭을 거는 색인 필드가 달라 커서 지문 등
    // `seq:` 전용 장치가 `mnum:`에 뜻 없이 반응하면 안 된다.
    const ast = parseQuery('repo:acme/payments base:main mnum:1..5');
    expect(hasSequenceRangeFilter(ast)).toBe(false);
    expect(hasMergeNumberRangeFilter(ast)).toBe(true);
  });

  it('**스칼라 `mnum:5`는 파서가 먼저 거절한다**', () => {
    expect(() => parseQuery('mnum:5')).toThrow(QueryParseError);
  });

  it('AST를 직접 조립해도 범위 조건만 본다', () => {
    const scalarAst: QueryAst = {
      filters: [{ key: 'mnum', op: 'eq', values: ['5'] }],
      text: null,
    };
    expect(hasMergeNumberRangeFilter(scalarAst)).toBe(false);
    expect(analyzeMergeNumberBinding(scalarAst)).toEqual({ kind: 'none' });
  });
});

describe('FR-SRCH-005 AC-8: pr_number: 범위는 repo: 하나만 지목하면 된다 (CR-106)', () => {
  it('`repo:` 하나면 확정된다 — `base:`는 요구하지 않는다', () => {
    expect(analyzePrNumber('repo:acme/payments pr_number:100..200')).toEqual({
      kind: 'bound',
      repository: 'acme/payments',
    });
  });

  it('`base:`가 있어도 무관하다', () => {
    expect(analyzePrNumber('repo:acme/payments base:main pr_number:100..200')).toEqual({
      kind: 'bound',
      repository: 'acme/payments',
    });
  });

  it('같은 값을 두 번 적은 것은 하나로 본다', () => {
    expect(analyzePrNumber('repo:acme/payments repo:acme/payments pr_number:1..5')).toEqual({
      kind: 'bound',
      repository: 'acme/payments',
    });
  });

  it('부정된 `-pr_number:` 범위도 같은 규칙을 따른다', () => {
    expect(analyzePrNumber('repo:acme/payments -pr_number:1..5')).toEqual({
      kind: 'bound',
      repository: 'acme/payments',
    });
    expect(analyzePrNumber('-pr_number:1..5')).toEqual({ kind: 'invalid', reason: 'repository_required' });
  });

  it('`repo:` 없으면 거절한다 (repository_required)', () => {
    expect(analyzePrNumber('pr_number:100..200')).toEqual({
      kind: 'invalid',
      reason: 'repository_required',
    });
    expect(analyzePrNumber('base:main pr_number:100..200')).toEqual({
      kind: 'invalid',
      reason: 'repository_required',
    });
  });

  it('`repo:`가 둘이면 거절한다 (repository_ambiguous)', () => {
    expect(analyzePrNumber('repo:a/x repo:b/y pr_number:1..5')).toEqual({
      kind: 'invalid',
      reason: 'repository_ambiguous',
    });
  });

  it('부정된 `repo:`는 지목이 아니다', () => {
    expect(analyzePrNumber('-repo:a/x pr_number:1..5')).toEqual({
      kind: 'invalid',
      reason: 'repository_required',
    });
  });

  it.each([
    ['빈 질의', ''],
    ['구조화 질의', 'repo:acme/payments author:kim'],
    ['다른 범위', 'seq:1..50'],
    ['mnum 범위', 'repo:acme/payments base:main mnum:1..50'],
  ])('%s는 어느 저장소에도 묶이지 않는다', (_label, query) => {
    expect(analyzePrNumber(query)).toEqual({ kind: 'none' });
    expect(hasPrNumberRangeFilter(parseQuery(query))).toBe(false);
  });

  it('**스칼라 `pr_number:100`은 파서가 먼저 거절한다**', () => {
    expect(() => parseQuery('pr_number:100')).toThrow(QueryParseError);
  });

  it('AST를 직접 조립해도 범위 조건만 본다', () => {
    const scalarAst: QueryAst = {
      filters: [{ key: 'pr_number', op: 'eq', values: ['100'] }],
      text: null,
    };
    expect(hasPrNumberRangeFilter(scalarAst)).toBe(false);
    expect(analyzePrNumberBinding(scalarAst)).toEqual({ kind: 'none' });
  });
});

/*
 * 실측(구현 도중)으로 드러난 실수를 다시 만들지 않는다: `mnum:`의 응답 문구가
 * 처음에는 `SEQUENCE_BINDING_MESSAGE`(`seq:` 전용 문구)를 그대로 재사용해,
 * `mnum:`만 쓰고 `base:`를 빠뜨린 요청에도 "A seq: filter…"라고 답하고 있었다.
 * 사유 코드(`SequenceBindingProblem`)는 공유해도 되지만 문구는 공유하면 안 된다.
 */
describe('CR-106: mnum: 응답 문구는 seq:와 사유 코드만 공유하고 문장은 따로 쓴다', () => {
  it('두 문구 집합의 키(사유 코드)는 완전히 같다', () => {
    expect(Object.keys(MERGE_NUMBER_BINDING_MESSAGE).sort()).toEqual(
      Object.keys(SEQUENCE_BINDING_MESSAGE).sort(),
    );
  });

  it('mnum: 문구는 `mnum:`을 말하고 `seq:`를 말하지 않는다', () => {
    for (const message of Object.values(MERGE_NUMBER_BINDING_MESSAGE)) {
      expect(message).toContain('mnum:');
      expect(message).not.toContain('seq:');
    }
  });

  it('seq: 문구는 그대로 `seq:`를 말한다 — 회귀 확인', () => {
    for (const message of Object.values(SEQUENCE_BINDING_MESSAGE)) {
      expect(message).toContain('seq:');
    }
  });
});
