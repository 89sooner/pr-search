/**
 * C-014 시퀀스 배지 판정 (WP-016 / CR-019 DEV-077, QA-W001-22).
 *
 * 가장 중요한 것은 **미머지와 미채번을 가르는 것**이다. 둘을 섞으면 화면이
 * 사실이 아닌 것을 말한다.
 */

import { describe, expect, it } from 'vitest';
import {
  commonSpace,
  isForeignSpace,
  sequenceBadgeState,
  sequenceDescription,
  sequenceLabel,
  type SequenceInput,
} from './sequence';

const merged: SequenceInput = {
  merge_seq: 1342,
  seq_epoch: 3,
  sequence_space: 'acme/payments@main',
  state: 'merged',
};

describe('배지 상태 (DEV-077)', () => {
  it('값이 있으면 `assigned`', () => {
    expect(sequenceBadgeState(merged)).toBe('assigned');
  });

  it('머지되지 않았으면 `unassigned`', () => {
    expect(
      sequenceBadgeState({ merge_seq: null, seq_epoch: null, sequence_space: null, state: 'open' }),
    ).toBe('unassigned');
  });

  it('**머지됐는데 값이 없으면 `not_computed`** — 미머지가 아니다', () => {
    /*
     * WP-021 전까지 모든 문서가 이 상태다. `unassigned`로 그리면 머지된 PR을
     * "머지되지 않았다"고 표시하게 된다 — 조사 도구가 할 수 있는 가장 나쁜
     * 거짓말이다.
     */
    expect(
      sequenceBadgeState({ merge_seq: null, seq_epoch: null, sequence_space: null, state: 'merged' }),
    ).toBe('not_computed');
  });

  it('커밋(`state`가 `null`)은 `not_computed` — 커밋에는 머지 개념이 없다', () => {
    expect(
      sequenceBadgeState({ merge_seq: null, seq_epoch: null, sequence_space: null, state: null }),
    ).toBe('not_computed');
  });

  it('닫힌 PR도 `unassigned` — 머지되지 않은 것은 번호가 없는 게 맞다', () => {
    expect(
      sequenceBadgeState({ merge_seq: null, seq_epoch: null, sequence_space: null, state: 'closed' }),
    ).toBe('unassigned');
  });

  it('값이 0이어도 `assigned` — 0은 없음이 아니다', () => {
    expect(sequenceBadgeState({ ...merged, merge_seq: 0 })).toBe('assigned');
  });
});

describe('시퀀스 공간 비교 (QA-W001-22)', () => {
  it('공간이 다르면 외부다', () => {
    expect(isForeignSpace('acme/a@main', 'acme/b@main')).toBe(true);
  });

  it('같으면 외부가 아니다', () => {
    expect(isForeignSpace('acme/a@main', 'acme/a@main')).toBe(false);
  });

  it('**같은 저장소라도 브랜치가 다르면 외부다** — 공간은 (저장소, 브랜치)다', () => {
    expect(isForeignSpace('acme/a@main', 'acme/a@release')).toBe(true);
  });

  it('문맥이 없으면 외부라고 하지 않는다 — 근거 없이 흐리게 그리지 않는다', () => {
    expect(isForeignSpace('acme/a@main', null)).toBe(false);
    expect(isForeignSpace('acme/a@main', undefined)).toBe(false);
  });

  it('자기 공간을 모르면 비교할 수 없다', () => {
    expect(isForeignSpace(null, 'acme/a@main')).toBe(false);
  });
});

describe('공통 공간 판정', () => {
  it('한 공간뿐이면 그것이 문맥이다', () => {
    expect(commonSpace(['acme/a@main', 'acme/a@main'])).toBe('acme/a@main');
  });

  it('**섞이면 문맥이 없다** — 각 배지가 자기 공간을 밝혀야 한다', () => {
    expect(commonSpace(['acme/a@main', 'acme/b@main'])).toBeNull();
  });

  it('`null`은 세지 않는다 — 미채번 문서가 섞여도 공간은 하나다', () => {
    expect(commonSpace([null, 'acme/a@main', null])).toBe('acme/a@main');
  });

  it('전부 비어 있으면 문맥이 없다', () => {
    expect(commonSpace([null, null])).toBeNull();
    expect(commonSpace([])).toBeNull();
  });
});

describe('읽히는 문구 — 색에만 의존하지 않는다 (C-014 접근성)', () => {
  it('할당된 배지는 값과 에폭을 함께 읽는다 (ADR-007)', () => {
    expect(sequenceLabel(merged, 'assigned')).toBe('1342@e3');
  });

  it('에폭을 모르면 값만 읽는다 — 없는 에폭을 지어내지 않는다', () => {
    expect(sequenceLabel({ ...merged, seq_epoch: null }, 'assigned')).toBe('1342');
  });

  it('미머지와 미채번의 **문구가 다르다**', () => {
    const label1 = sequenceLabel(merged, 'unassigned');
    const label2 = sequenceLabel(merged, 'not_computed');
    expect(label1).not.toBe(label2);
    expect(label1).toBe('미머지');
    expect(label2).toBe('미채번');
  });

  it('설명도 다르다 — 사용자가 할 수 있는 일이 다르기 때문이다', () => {
    const d1 = sequenceDescription(merged, 'unassigned');
    const d2 = sequenceDescription(merged, 'not_computed');
    expect(d1).not.toBe(d2);
    expect(d2).toContain('아직');
  });

  it('설명이 시퀀스 공간과 비교 불가를 밝힌다 (ADR-007)', () => {
    const text = sequenceDescription(merged, 'assigned');
    expect(text).toContain('acme/payments@main');
    expect(text).toContain('에폭 3');
    expect(text).toContain('비교할 수 없');
  });
});
