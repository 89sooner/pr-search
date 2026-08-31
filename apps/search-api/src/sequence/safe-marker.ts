/**
 * 안전 구간 표식의 판정 (API-SEQ-004 / WP-041, FR-SEQ-006).
 *
 * 라우트는 세션·역할·본문 형식·시퀀스 공간까지를 보고(검사 1~4), 이 파일이
 * 나머지 넷을 본다 — 에폭 일치(5), 서수 실재(6), 완전 일치(7), 요청자가 본
 * 값이 아직 현재인가(8). 응답 모양을 만드는 것도 여기다.
 *
 * ## 왜 판정이 라우트에 없는가
 *
 * 같은 순서를 두 번 적으면 한쪽만 고쳐지는 날이 온다. 특히 5~8은 **순서
 * 자체가 계약**이라(`API-SEQ-004`) 흩어 두면 그 순서가 어디에도 없게 된다.
 */

import { mergeSequenceRepo, safeMarkerRepo, type Pool, type SafeMarkerRow } from '@prs/db';
import type { ResolvedSpace } from './space.js';

/** 표식 하나를 응답 모양으로. `epoch_stale`은 저장된 값이 아니라 비교 결과다. */
export interface SafeMarkerView {
  readonly merge_seq: number;
  readonly seq_epoch: number;
  readonly note: string | null;
  readonly created_by: string;
  readonly created_at: string;
  /**
   * 저장된 에폭이 현재와 다른가 (FR-SEQ-005 AC-4).
   *
   * **행을 고쳐 계산하지 않는다.** 재채번은 표식에 아무것도 쓰지 않으며
   * (백엔드 4.3, CR-026 DEV-126), 조회가 현재 에폭과 대조해 그 자리에서
   * 판정한다. 그래서 이 필드는 저장 스키마에 대응하는 열이 없다.
   */
  readonly epoch_stale: boolean;
}

export function toMarkerView(row: SafeMarkerRow, currentEpoch: number): SafeMarkerView {
  return {
    merge_seq: row.merge_seq,
    seq_epoch: row.seq_epoch,
    note: row.note,
    created_by: row.created_by,
    created_at: row.created_at,
    epoch_stale: row.seq_epoch !== currentEpoch,
  };
}

export interface SafeMarkerReadResult {
  readonly sequence_space: string;
  readonly seq_epoch: number;
  readonly marker: SafeMarkerView | null;
}

/**
 * 그 공간의 현재 표식 (`GET`).
 *
 * **표식이 없으면 404가 아니라 `marker: null`이다.** 공간은 실재하고 그
 * 공간에 아직 표식이 없다는 것이 사실이며, 404는 "그런 공간이 없다"를
 * 뜻한다 — 그 판정은 `resolveSpace`가 이미 했다.
 *
 * **낡은 표식을 감추지 않는다.** 무효라는 사실 자체가 사용자가 알아야 할
 * 답이고, 숨기면 "표식이 없다"로 읽힌다 (FR-SEQ-006 AC-4).
 */
export async function readSafeMarker(pool: Pool, space: ResolvedSpace): Promise<SafeMarkerReadResult> {
  const row = await safeMarkerRepo.findCurrentMarker(pool, space.repositoryId, space.baseBranch);
  return {
    sequence_space: space.sequenceSpace,
    seq_epoch: space.seqEpoch,
    marker: row === null ? null : toMarkerView(row, space.seqEpoch),
  };
}

export interface WriteSafeMarkerInput {
  readonly mergeSeq: number;
  readonly seqEpoch: number;
  readonly note: string | null;
  readonly expectedMarkerSeq: number | null;
  readonly createdBy: string;
}

export type WriteSafeMarkerOutcome =
  /** 5. 요청이 딛고 선 에폭이 현재가 아니다. */
  | { readonly kind: 'epoch_stale'; readonly currentEpoch: number; readonly requestedEpoch: number }
  /** 6. 그 서수가 이 `(공간, 에폭)`에 없다. */
  | { readonly kind: 'sequence_not_found'; readonly mergeSeq: number; readonly seqEpoch: number }
  /** 8. 요청자가 본 표식이 더 이상 현재가 아니다. */
  | { readonly kind: 'conflict'; readonly currentMarkerSeq: number | null; readonly expectedMarkerSeq: number | null }
  /** 7. 이미 그 상태다. 아무것도 쓰지 않았다. */
  | { readonly kind: 'unchanged'; readonly marker: SafeMarkerView }
  | { readonly kind: 'created'; readonly marker: SafeMarkerView; readonly replacedMergeSeq: number | null };

/**
 * 표식을 등록한다 (`PUT`).
 *
 * 검사 순서가 계약이며 그 이유가 각각 다르다.
 *
 * **5가 6보다 먼저다.** 에폭이 다르면 그 세대의 서수 실재 여부를 물을 필요가
 * 없고, 물으면 **낡은 에폭의 서수를 현재 에폭에서 찾게 되어** 있지도 않은
 * 값을 "그 서수는 없다"라고 답한다. 두 오류가 사용자에게 뜻하는 것이 다르다.
 *
 * **7이 8보다 먼저다** (DEV-464). 뒤집으면 응답을 잃은 요청의 정직한 재시도가
 * **자기가 만든 상태 때문에** 충돌로 거절된다. 그 둘은 리포지터리의 한
 * 트랜잭션 안에 있다 — 여기서 미리 읽어 판정하면 읽기와 쓰기 사이가 벌어진다.
 */
export async function writeSafeMarker(
  pool: Pool,
  space: ResolvedSpace,
  input: WriteSafeMarkerInput,
): Promise<WriteSafeMarkerOutcome> {
  if (input.seqEpoch !== space.seqEpoch) {
    return { kind: 'epoch_stale', currentEpoch: space.seqEpoch, requestedEpoch: input.seqEpoch };
  }

  /*
   * 서수가 그 세대에 실재하는가 (FR-SEQ-006 예외 처리).
   *
   * `findPointBySeq`가 하는 일이 정확히 그 실재 확인이며, 앵커 해석이 쓰는
   * 것과 **같은 함수**다 — 표식이 가리킬 수 있는 서수와 앵커가 가리킬 수
   * 있는 서수가 갈리면 화면이 조회한 구간의 끝을 표식하지 못하는 날이 온다.
   */
  const point = await mergeSequenceRepo.findPointBySeq(
    pool,
    space.repositoryId,
    space.baseBranch,
    space.seqEpoch,
    input.mergeSeq,
  );
  if (point === null) {
    return { kind: 'sequence_not_found', mergeSeq: input.mergeSeq, seqEpoch: input.seqEpoch };
  }

  const outcome = await safeMarkerRepo.replaceMarker(pool, {
    repositoryId: space.repositoryId,
    baseBranch: space.baseBranch,
    mergeSeq: input.mergeSeq,
    seqEpoch: input.seqEpoch,
    note: input.note,
    createdBy: input.createdBy,
    expectedMarkerSeq: input.expectedMarkerSeq,
  });

  switch (outcome.kind) {
    case 'unchanged':
      return { kind: 'unchanged', marker: toMarkerView(outcome.row, space.seqEpoch) };
    case 'conflict':
      return {
        kind: 'conflict',
        currentMarkerSeq: outcome.currentMergeSeq,
        expectedMarkerSeq: input.expectedMarkerSeq,
      };
    case 'created':
      return {
        kind: 'created',
        marker: toMarkerView(outcome.row, space.seqEpoch),
        replacedMergeSeq: outcome.replacedMergeSeq,
      };
  }
}

/**
 * 감사의 `target` (`FR-AUTH-004` AC-1 정본 표).
 *
 * 형식은 `{시퀀스 공간}@{시퀀스 값}`이다. `sequence.reassign`이
 * `{시퀀스 공간}@{신규 에폭}`을 쓰는 것과 같은 모양이며, **무엇이 뒤에
 * 오는지는 액션마다 다르다** — 재채번이 가리키는 것은 세대이고 표식이
 * 가리키는 것은 지점이다.
 */
export function markerAuditTarget(space: ResolvedSpace, mergeSeq: number): string {
  return `${space.sequenceSpace}@${String(mergeSeq)}`;
}
