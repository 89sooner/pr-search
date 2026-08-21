'use client';

/**
 * C-014 SequenceBadge — 머지 시퀀스와 그 시퀀스 공간 (WP-016 / FR-SEQ-001, ADR-007).
 *
 * ## 이 배지는 사실을 주장한다
 *
 * 판정은 전부 `lib/sequence.ts`가 한다. 여기서는 그 결과를 그리기만 한다 —
 * "미머지"와 "미채번"을 가르는 것이 렌더링 코드에 섞이면 시험이 DOM을
 * 통해서만 그것을 확인할 수 있다 (CR-019, DEV-077).
 *
 * ## 색에만 의존하지 않는다
 *
 * 다른 시퀀스 공간의 값은 tone을 `neutral`로 낮추지만(QA-W001-22), **그것만으로
 * 끝내지 않는다.** 색을 못 보는 사용자에게도 "이 번호는 다른 저장소의 것"이
 * 전달되어야 하므로 설명 텍스트를 `aria-describedby`로 잇는다 (C-014 접근성).
 */

import { useId, type ReactNode } from 'react';
import { Badge } from '@conductor-by-89soone/react';
import {
  isForeignSpace,
  sequenceBadgeState,
  sequenceDescription,
  sequenceLabel,
  type SequenceInput,
  type SequenceSpaceRef,
} from '../lib/sequence';

export interface SequenceBadgeProps extends SequenceInput {
  /**
   * 이 목록이 서 있는 시퀀스 공간. 없으면 공간이 섞여 있다는 뜻이다.
   *
   * CR-019 DEV-077로 널 허용이 되었다 — WP-021 전까지 값이 없다.
   */
  readonly contextSpace?: SequenceSpaceRef | null;
}

/** 상태별 tone. 미채번은 `neutral`이다 — 경고가 아니라 아직 모르는 것이다. */
const TONE = {
  assigned: 'accent',
  unassigned: 'neutral',
  not_computed: 'neutral',
} as const;

export function SequenceBadge({ contextSpace, ...input }: SequenceBadgeProps): ReactNode {
  const state = sequenceBadgeState(input);
  const foreign = isForeignSpace(input.sequence_space, contextSpace);
  const describedBy = useId();

  /*
   * 다른 공간이면 tone을 낮춘다.
   *
   * `1342`와 `1341`이 나란히 있으면 사용자는 연속된 번호로 읽는데, 저장소가
   * 다르면 그 관계가 **성립하지 않는다.** 시각적으로 묶여 보이지 않게 한다.
   */
  const tone = foreign ? 'neutral' : TONE[state];

  return (
    <>
      <Badge
        tone={tone}
        data-seq-state={state}
        data-foreign={foreign ? '' : undefined}
        aria-describedby={describedBy}
      >
        {sequenceLabel(input, state)}
      </Badge>
      {/*
       * 설명은 화면에 보이지 않되 스크린 리더에는 읽힌다. `display: none`이면
       * 읽히지 않으므로 Conductor의 시각적 숨김 클래스를 쓴다.
       */}
      <span id={describedBy} className="cdt-sr-only">
        {sequenceDescription(input, state)}
        {foreign ? ' 목록의 다른 항목과 다른 시퀀스 공간입니다.' : ''}
      </span>
    </>
  );
}
