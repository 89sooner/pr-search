import { describe, expect, it } from 'vitest';

import { decideTitleUpdate, resolveAnnotationTarget } from './title.js';

describe('resolveAnnotationTarget — 표기 문자열 (FR-SEQ-008 AC-5, OD-009)', () => {
  it('저장소 이름의 숫자 구간이 코드가 된다', () => {
    expect(resolveAnnotationTarget('smp1900', 1)).toEqual({ kind: 'target', expected: 'M-1900-1' });
  });

  it('선행 0을 보존한다', () => {
    // `007`을 `7`로 접으면 표기 문자열이 저장소 이름과 대응하지 않는다.
    expect(resolveAnnotationTarget('app007', 12)).toEqual({ kind: 'target', expected: 'M-007-12' });
  });

  it('숫자가 없는 저장소는 코드를 지어내지 않는다', () => {
    expect(resolveAnnotationTarget('payments', 1)).toEqual({ kind: 'code_unavailable', reason: 'no_digits' });
  });

  it('숫자 구간이 둘 이상이면 하나를 고르지 않는다', () => {
    expect(resolveAnnotationTarget('smp1900-v2', 1)).toEqual({
      kind: 'code_unavailable',
      reason: 'multiple_digit_runs',
    });
  });

  it('소유자 이름은 코드가 아니다 — 이름만 받는 계약을 호출부가 지켜야 한다', () => {
    /*
     * `acme99/smp1900`을 통째로 넘기면 숫자 구간이 둘이 되어 코드를 만들지
     * 못한다. 조용히 `99`나 `991900`을 고르지 않는 것이 이 계약의 값이다.
     */
    expect(resolveAnnotationTarget('acme99/smp1900', 1)).toEqual({
      kind: 'code_unavailable',
      reason: 'multiple_digit_runs',
    });
  });
});

describe('decideTitleUpdate — 접두 판정 (FR-SEQ-009 AC-1·AC-2)', () => {
  it('접두가 없으면 앞에 붙이고 나머지는 그대로 둔다', () => {
    expect(decideTitleUpdate('M-1900-1', 'Fix device initialization race')).toEqual({
      kind: 'update',
      nextTitle: '[M-1900-1] Fix device initialization race',
    });
  });

  it('같은 접두가 이미 있으면 GHE를 부르지 않는다 (멱등)', () => {
    expect(decideTitleUpdate('M-1900-1', '[M-1900-1] Fix device initialization race')).toEqual({
      kind: 'already_annotated',
    });
  });

  it('다른 M 넘버 접두는 덮어쓰지 않고 불일치로 남긴다', () => {
    expect(decideTitleUpdate('M-1900-1', '[M-1900-77] Fix device initialization race')).toEqual({
      kind: 'mismatch',
      found: 'M-1900-77',
    });
  });

  it('저장소 코드가 다른 M 넘버도 불일치다', () => {
    // 에폭 상향이나 이관으로 코드가 달라진 자리다. 판정은 같다 — 덮지 않는다.
    expect(decideTitleUpdate('M-1900-1', '[M-2000-1] 제목')).toEqual({ kind: 'mismatch', found: 'M-2000-1' });
  });

  it('M 넘버가 아닌 접두는 지우지 않고 그 앞에 붙인다', () => {
    expect(decideTitleUpdate('M-1900-1', '[WIP] Fix device initialization race')).toEqual({
      kind: 'update',
      nextTitle: '[M-1900-1] [WIP] Fix device initialization race',
    });
  });

  it('유니코드 제목을 정규화하지 않는다', () => {
    const title = '결제 재시도 로직을 고친다 — 재고 동기화 포함';
    expect(decideTitleUpdate('M-1900-5', title)).toEqual({ kind: 'update', nextTitle: `[M-1900-5] ${title}` });
  });

  it('대소문자와 구두점을 건드리지 않는다', () => {
    const title = '  FIX:   Weird   Spacing!!  ';
    expect(decideTitleUpdate('M-1900-5', title)).toEqual({ kind: 'update', nextTitle: `[M-1900-5] ${title}` });
  });

  it('접두 뒤에 공백이 없어도 이미 표기된 것으로 본다', () => {
    /*
     * 공백을 넣으려고 다시 쓰면 그것도 제목을 고치는 일이다. 접두가 있다는
     * 사실이 판정의 전부다.
     */
    expect(decideTitleUpdate('M-1900-1', '[M-1900-1]제목')).toEqual({ kind: 'already_annotated' });
  });

  it('접두만 있고 뒤가 비어도 이미 표기된 것이다', () => {
    expect(decideTitleUpdate('M-1900-1', '[M-1900-1]')).toEqual({ kind: 'already_annotated' });
  });

  it('앞에 공백이 있어도 접두를 알아본다 — 두 번 붙이지 않는다', () => {
    /*
     * 이 검사가 없으면 ` [M-1900-1] 제목`이 "접두 없음"으로 읽혀
     * `[M-1900-1]  [M-1900-1] 제목`이 된다. §14의 중복 금지가 걸리는 자리다.
     */
    expect(decideTitleUpdate('M-1900-1', ' [M-1900-1] 제목')).toEqual({ kind: 'already_annotated' });
  });

  it('닫히지 않은 대괄호는 접두가 아니다', () => {
    expect(decideTitleUpdate('M-1900-1', '[unclosed 제목')).toEqual({
      kind: 'update',
      nextTitle: '[M-1900-1] [unclosed 제목',
    });
  });

  it('M 넘버 형식이 아닌 대괄호 내용은 접두로 세지 않는다', () => {
    // `M-1900-0`은 `MERGE_NUMBER_PATTERN`이 거부한다(서수는 1부터다).
    expect(decideTitleUpdate('M-1900-1', '[M-1900-0] 제목')).toEqual({
      kind: 'update',
      nextTitle: '[M-1900-1] [M-1900-0] 제목',
    });
  });

  it('빈 제목에도 붙는다', () => {
    expect(decideTitleUpdate('M-1900-1', '')).toEqual({ kind: 'update', nextTitle: '[M-1900-1] ' });
  });

  it('아주 긴 제목을 자르지 않는다', () => {
    /*
     * 잘라서 성공시키는 것은 "원래 제목을 보존한다"를 어기는 일이다. 길이 때문에
     * GHE가 거부하면 그 거부를 사유로 남긴다 — 판정은 자르지 않는다.
     */
    const long = 'x'.repeat(1_000);
    const decision = decideTitleUpdate('M-1900-1', long);
    expect(decision).toEqual({ kind: 'update', nextTitle: `[M-1900-1] ${long}` });
  });
});
