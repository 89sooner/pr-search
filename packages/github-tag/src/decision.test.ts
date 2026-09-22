/**
 * 태그 판정의 순수 부분 (WP-100 / FR-SEQ-012 AC-1·AC-3).
 */

import { describe, expect, it } from 'vitest';
import { decideTagAction, mergeNumberOfTagName, resolveTagTarget } from './decision.js';

const SHA = 'a3f9c21b4e8d7f0c1a2b3c4d5e6f708192a3b4c5';

describe('resolveTagTarget — 태그 이름은 M 표기 문자열 그 자체다 (AC-1)', () => {
  it('저장소 이름의 숫자 부분이 코드다 (OD-009)', () => {
    expect(resolveTagTarget('smp1900', 1450, SHA)).toEqual({ kind: 'target', name: 'M-1900-1450', sha: SHA });
  });

  it('SHA는 소문자로 정규화한다 — git·GHE와 대조하는 형식이다', () => {
    expect(resolveTagTarget('smp1900', 1, SHA.toUpperCase())).toEqual({ kind: 'target', name: 'M-1900-1', sha: SHA });
  });

  it('선행 0을 보존한다', () => {
    expect(resolveTagTarget('app007', 3, SHA)).toMatchObject({ name: 'M-007-3' });
  });

  it.each([
    ['숫자 없음', 'payments', 'no_digits'],
    ['숫자 run 둘', 'app1900v2', 'multiple_digit_runs'],
  ])('%s이면 코드를 지어내지 않는다', (_label, name, reason) => {
    expect(resolveTagTarget(name, 1, SHA)).toEqual({ kind: 'code_unavailable', reason });
  });
});

describe('decideTagAction — 원격 상태에 따른 할 일 (AC-3)', () => {
  it('없으면 만든다', () => {
    expect(decideTagAction(SHA, { kind: 'missing' })).toEqual({ kind: 'create' });
  });

  it('같은 SHA의 lightweight 태그가 있으면 이미 끝난 것이다 — 쓰지 않는다', () => {
    expect(decideTagAction(SHA, { kind: 'found', sha: SHA.toUpperCase(), objectType: 'commit' })).toEqual({ kind: 'already_done' });
  });

  it('**다른 SHA면 충돌이다** — 절대 옮기지 않는다', () => {
    const other = 'b'.repeat(40);
    expect(decideTagAction(SHA, { kind: 'found', sha: other, objectType: 'commit' })).toEqual({ kind: 'conflict', foundSha: other, objectType: 'commit' });
  });

  it('**annotated 태그는 SHA와 무관하게 충돌이다** — 우리가 만든 것이 아니다', () => {
    expect(decideTagAction(SHA, { kind: 'found', sha: SHA, objectType: 'tag' })).toEqual({ kind: 'conflict', foundSha: SHA, objectType: 'tag' });
  });
});

describe('mergeNumberOfTagName — 대조가 원격 목록에서 이 저장소의 M 태그만 고른다', () => {
  it('접두와 번호를 읽는다', () => {
    expect(mergeNumberOfTagName('1900', 'M-1900-1450')).toBe(1450);
  });

  it.each([
    ['다른 코드', 'M-1901-1'],
    ['선행 0 번호', 'M-1900-007'],
    ['번호 0', 'M-1900-0'],
    ['뒤에 문자', 'M-1900-1450-rc1'],
    ['접두만', 'M-1900-'],
    ['릴리스 태그', 'v1.2.0'],
  ])('%s은 M 태그가 아니다', (_label, name) => {
    expect(mergeNumberOfTagName('1900', name)).toBeNull();
  });
});
