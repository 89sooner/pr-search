/**
 * C-014 시퀀스 배지의 상태 판정 (WP-016 / CR-019 DEV-077, ADR-007).
 *
 * ## 왜 순수 함수인가
 *
 * "이 배지가 무엇을 말하는가"는 **사실 주장**이다. `unassigned`는 "이 PR은
 * 머지되지 않았다"이고 `not_computed`는 "아직 모른다"인데, 둘을 같이 그리면
 * 화면이 **거짓을 말한다.** 그런 판정은 렌더링에 섞지 않는다.
 *
 * ## 왜 `not_computed`가 필요한가
 *
 * WP-021이 시퀀스를 채우기 전까지 `merge_seq`·`seq_epoch`·`sequence_space`가
 * 전부 `null`이다. 명세의 상태 목록에는 `unassigned`(미머지)밖에 없어서
 * 그대로 쓰면 머지된 PR을 "미머지"로 표시하게 된다 (CR-019, DEV-077).
 */

/** 투영이 주는 시퀀스 공간. `owner/repo@branch` 모양이다. */
export type SequenceSpaceRef = string;

export type SequenceBadgeState =
  /** 값이 있다. 정상 표시. */
  | 'assigned'
  /** 머지되지 않아 번호가 붙을 자리가 없다. */
  | 'unassigned'
  /** 아직 채번하지 않았다 (WP-021 전). **미머지와 다르다.** */
  | 'not_computed';

export interface SequenceInput {
  readonly merge_seq: number | null;
  readonly seq_epoch: number | null;
  readonly sequence_space: SequenceSpaceRef | null;
  /** PR 상태. `merged`가 아니면 번호가 없는 것이 정상이다. */
  readonly state: string | null;
}

/**
 * 배지 상태를 정한다.
 *
 * **머지 여부가 먼저다.** 머지되지 않았으면 시퀀스가 없는 것이 옳은 상태이고,
 * 머지됐는데 없으면 아직 계산하지 않은 것이다. 이 순서를 뒤집으면 미머지 PR이
 * 전부 "계산 중"으로 보인다.
 */
export function sequenceBadgeState(input: SequenceInput): SequenceBadgeState {
  if (input.merge_seq !== null) return 'assigned';
  // 커밋에는 `state`가 없다(`null`). 커밋은 머지 개념이 없으므로 미계산이다.
  if (input.state !== null && input.state !== 'merged') return 'unassigned';
  return 'not_computed';
}

/**
 * 다른 시퀀스 공간의 값인가 (QA-W001-22).
 *
 * 서로 다른 저장소·브랜치의 시퀀스는 **비교할 수 없는 수**다. 한 목록에
 * 나란히 놓으면 사용자가 "1342가 1341 다음"이라고 읽는데, 공간이 다르면
 * 그 관계가 성립하지 않는다. 그래서 공간이 다르면 tone을 낮춘다.
 *
 * `contextSpace`가 없으면(단일 공간 화면이 아니면) 비교할 기준이 없으므로
 * **다르다고 하지 않는다** — 근거 없이 전부 흐리게 그리면 표식이 뜻을 잃는다.
 */
export function isForeignSpace(
  space: SequenceSpaceRef | null,
  contextSpace: SequenceSpaceRef | null | undefined,
): boolean {
  if (contextSpace === null || contextSpace === undefined) return false;
  if (space === null) return false;
  return space !== contextSpace;
}

/**
 * 목록 전체가 한 시퀀스 공간인가.
 *
 * 한 공간뿐이면 그 공간을 문맥으로 삼아 배지를 정상 tone으로 그린다. 둘
 * 이상이 섞이면 문맥이 없으므로 **각 배지가 자기 공간을 밝혀야 한다**.
 */
export function commonSpace(spaces: readonly (SequenceSpaceRef | null)[]): SequenceSpaceRef | null {
  const present = spaces.filter((s): s is SequenceSpaceRef => s !== null);
  if (present.length === 0) return null;
  const first = present[0] as SequenceSpaceRef;
  return present.every((s) => s === first) ? first : null;
}

/**
 * 배지에 읽히는 문구.
 *
 * **시각적 tone 차이에만 의존하지 않는다** (C-014 접근성 규칙). 색이 흐린
 * 것만으로는 "다른 저장소의 번호"임이 전달되지 않으므로 텍스트로도 말한다.
 */
export function sequenceLabel(input: SequenceInput, state: SequenceBadgeState): string {
  switch (state) {
    case 'assigned': {
      const seq = String(input.merge_seq);
      const epoch = input.seq_epoch === null ? '' : `@e${String(input.seq_epoch)}`;
      return `${seq}${epoch}`;
    }
    case 'unassigned':
      return '미머지';
    case 'not_computed':
      return '미채번';
  }
}

/** 툴팁·`aria-describedby`에 실을 설명. 공간과 에폭을 밝힌다 (ADR-007). */
export function sequenceDescription(input: SequenceInput, state: SequenceBadgeState): string {
  if (state === 'unassigned') return '머지되지 않아 시퀀스가 없습니다.';
  if (state === 'not_computed') {
    return '머지 시퀀스를 아직 계산하지 않았습니다. 값이 없는 것과 다릅니다.';
  }
  const space = input.sequence_space ?? '알 수 없는 시퀀스 공간';
  const epoch = input.seq_epoch === null ? '' : ` (에폭 ${String(input.seq_epoch)})`;
  return `${space}의 머지 시퀀스${epoch}. 다른 시퀀스 공간의 값과 비교할 수 없습니다.`;
}
