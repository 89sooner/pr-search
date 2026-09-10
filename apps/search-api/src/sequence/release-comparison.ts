/**
 * 릴리스 구간 비교 (API-SEQ-003 / WP-026, FR-SEQ-004).
 *
 * 이 파일이 하는 일은 **두 릴리스 태그를 서수로 바꾸고 방향을 정규화하는
 * 것까지다** (AC-1). 그 뒤는 API-SEQ-001과 같은 판정·같은 코드(`guardRange` →
 * `runRange`)다 — 비교가 범위 조회와 다른 답을 내기 시작하면 같은 구간의
 * 인용이 화면마다 갈라진다.
 *
 * ## 순서에 의도가 없다 (AC-4)
 *
 * W-004의 역전은 오류다(QA-W004-07 — 타이핑한 순서에는 의도가 있다). 이쪽
 * 입력은 체크박스 선택이라 순서가 우연이다 — 그래서 **시퀀스가 작은 쪽을
 * 말없이 시작 앵커로 삼고**, 무엇이 어느 쪽이 됐는지를 `normalized_direction`
 * 문구로 명시한다.
 *
 * ## 태그는 분류하지 않는다 (CR-030, DEV-157)
 *
 * `from`·`to`는 태그 이름 그대로 `resolveReleaseTagAnchor`로 간다.
 * `classifyAnchor`를 거치면 `deadbee` 같은 태그가 SHA 접두로 오독된다.
 */

import { mergeSequenceRepo } from '@prs/db';
import type { AccessScope } from '@prs/es';
import { boundaryOf } from '@prs/domain';
import {
  resolveReleaseTagAnchor,
  type AnchorFailure,
  type ResolvedAnchor,
} from './anchors.js';
import { guardRange, runRange, type RangeDeps, type RangeResult } from './range.js';
import type { ResolvedSpace } from './space.js';

/** `to`가 이 값이면 마지막 릴리스 이후 브랜치 head까지다 (AC-5). */
export const UNRELEASED_TO = 'unreleased';

export type ComparisonOutcome =
  | { readonly kind: 'anchor_failed'; readonly failure: AnchorFailure }
  | { readonly kind: 'too_large'; readonly total: number }
  | {
      readonly kind: 'ok';
      readonly from: ResolvedAnchor;
      readonly to: ResolvedAnchor;
      /** "from=A(seq X) → to=B(seq Y)" — 정규화가 무엇을 바꿨는지 사람이 읽는 문구다. */
      readonly direction: string;
      readonly total: number;
      readonly result: RangeResult;
    };

function directionOf(from: ResolvedAnchor, to: ResolvedAnchor): string {
  return `from=${from.expression}(seq ${String(from.merge_seq)}) → to=${to.expression}(seq ${String(to.merge_seq)})`;
}

/** 위치를 바꿔 앵커를 다시 세운다. 경계는 표현이 아니라 위치가 정한다 (ADR·boundaryOf). */
function repositioned(anchor: ResolvedAnchor, position: 'from' | 'to'): ResolvedAnchor {
  return { ...anchor, position, boundary: boundaryOf(position) };
}

export async function compareReleases(
  deps: RangeDeps,
  space: ResolvedSpace,
  scope: AccessScope,
  fromTag: string,
  toTag: string,
  size: number,
): Promise<ComparisonOutcome> {
  const anchorDeps = {
    pool: deps.pool,
    es: deps.es,
    ...(deps.timeoutMs === undefined ? {} : { timeoutMs: deps.timeoutMs }),
  };

  const fromOutcome = await resolveReleaseTagAnchor(
    anchorDeps,
    space,
    scope,
    { position: 'from', expression: fromTag },
    fromTag,
  );
  if (fromOutcome.kind === 'failed') return { kind: 'anchor_failed', failure: fromOutcome.failure };

  let toAnchor: ResolvedAnchor;
  if (toTag === UNRELEASED_TO) {
    /*
     * 끝 앵커 = 공간의 head 서수 (AC-5, DEV-157). `release` 표가 아니라
     * `merge_sequence`의 현재 head다 — "마지막 릴리스 이후 지금까지"의 "지금"은
     * 채번의 정본이 말한다.
     */
    const headPoint = await mergeSequenceRepo.findPointBySeq(
      deps.pool,
      space.repositoryId,
      space.baseBranch,
      space.seqEpoch,
      space.headSeq,
    );
    if (headPoint === null) {
      // 공간에 행이 없다 — from이 해석된 이상 정상 경로에선 닿지 않지만, 닿으면 사실대로.
      return {
        kind: 'anchor_failed',
        failure: {
          position: 'to',
          expression: UNRELEASED_TO,
          code: 'ANCHOR_UNRESOLVABLE',
          message: `이 시퀀스 공간에 head 서수가 없습니다: ${space.sequenceSpace}`,
          detail: { expression: UNRELEASED_TO, head_seq: space.headSeq },
        },
      };
    }
    toAnchor = {
      position: 'to',
      expression: UNRELEASED_TO,
      kind: 'sequence',
      merge_seq: headPoint.mergeSeq,
      commit_sha: headPoint.commitSha,
      boundary: 'inclusive',
      occurred_at: headPoint.committedAt.toISOString(),
    };
  } else {
    const toOutcome = await resolveReleaseTagAnchor(
      anchorDeps,
      space,
      scope,
      { position: 'to', expression: toTag },
      toTag,
    );
    if (toOutcome.kind === 'failed') return { kind: 'anchor_failed', failure: toOutcome.failure };
    toAnchor = toOutcome.anchor;
  }

  /*
   * 정규화 (AC-4). 같은 서수는 뒤집지 않는다 — 빈 반개구간 `(s, s]`는 유효하고,
   * 같은 커밋에 붙은 두 태그의 비교가 정확히 이 모양이다.
   */
  let from = fromOutcome.anchor;
  let to = toAnchor;
  if (from.merge_seq > to.merge_seq) {
    const smaller = to;
    to = repositioned(from, 'to');
    from = repositioned(smaller, 'from');
  }

  const guard = await guardRange(deps.pool, space, from.merge_seq, to.merge_seq);
  if (guard.kind === 'too_large') return { kind: 'too_large', total: guard.total };
  if (guard.kind === 'inverted') {
    // 정규화가 방금 크기 순서를 세웠으므로 도달 불가다 — 타입을 좁히기 위한 분기다.
    throw new Error('정규화 뒤에 역전이 남았다');
  }

  const result = await runRange(
    {
      space,
      scope,
      fromExclusive: from.merge_seq,
      toInclusive: to.merge_seq,
      size,
      ast: null,
      rangeTotal: guard.total,
    },
    deps,
  );

  return { kind: 'ok', from, to, direction: directionOf(from, to), total: guard.total, result };
}
