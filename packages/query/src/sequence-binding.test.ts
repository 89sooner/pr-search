/**
 * `seq:`의 시퀀스 공간 지목 (CR-051 / FR-SRCH-005 AC-7).
 *
 * 이 판정이 DEV-349의 뿌리를 막는다 — 공간을 지목하지 않는 `seq:`는 접근
 * 범위의 모든 공간에 걸치고, 그때 "그 공간의 에폭"이라는 것이 존재하지 않는다.
 */

import { describe, expect, it } from 'vitest';
import { parseQuery } from './parse.js';
import { analyzeSequenceBinding, hasSequenceRangeFilter } from './sequence-binding.js';

function analyze(query: string) {
  return analyzeSequenceBinding(parseQuery(query));
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

  it('**스칼라 `seq:1234`는 이 규칙의 대상이 아니다** (DEV-364)', () => {
    /*
     * SRS AC-2가 승인한 것은 범위뿐이다. 스칼라는 파서를 통과하지만 질의
     * 빌더에서 `MATCH_NONE`이 되어 언제나 0건이며, 여기에 지목 규칙을
     * 적용하면 그 동작이 400으로 바뀐다 — 승인받지 않은 제품 결정이다.
     * 그 사실은 원장 5장에 판정으로 남겼다.
     */
    expect(analyze('seq:1234')).toEqual({ kind: 'none' });
    expect(hasSequenceRangeFilter(parseQuery('seq:1234'))).toBe(false);
  });
});
