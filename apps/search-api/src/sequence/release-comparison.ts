/**
 * 릴리스 구간 비교 (API-SEQ-003 / WP-026, CR-030 DEV-156).
 *
 * **이 API가 따로 소유하는 것은 셋뿐이다**: `to=unreleased`, 서수 기준 방향
 * 정규화(FR-SEQ-004 AC-4), `size=0`(요약만). 요약·항목·에폭 봉투는 API-SEQ-001과
 * **같은 계층**(`runRange`)을 그대로 딛는다 — 두 API가 같은 구간에 다른 숫자를
 * 말하지 않게 하는 것이 그 재사용의 목적이다.
 *
 * 소비자는 W-005의 릴리스 상세와 미배포 구간이다. **구간 비교 버튼은 이 API를
 * 부르지 않는다** — FLOW-003대로 W-004로 앵커를 넘겨 이동하고, 결과 목록·패싯·
 * 뒤로가기 복귀는 거기 한 곳에만 둔다.
 */

import { releaseRepo } from '@prs/db';
import type { ErrorCode } from '@prs/contracts';
import type { AccessScope } from '@prs/es';
import { resolveAnchors, type AnchorDeps, type AnchorFailure } from './anchors.js';
import type { ResolvedSpace } from './space.js';

/** `to`가 이 값이면 마지막 릴리스 이후 브랜치 head까지다 (FR-SEQ-004 AC-5). */
export const UNRELEASED = 'unreleased';

/** 요약만 필요한 호출을 위해 **0을 허용한다**. 그 밖에는 API-SEQ-001과 같다. */
export const DEFAULT_COMPARISON_SIZE = 50;
export const MAX_COMPARISON_SIZE = 200;

export function clampComparisonSize(raw: unknown): number {
  if (typeof raw !== 'string' || raw.trim() === '') return DEFAULT_COMPARISON_SIZE;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) return DEFAULT_COMPARISON_SIZE;
  return Math.min(parsed, MAX_COMPARISON_SIZE);
}

export interface ComparisonEndpoint {
  readonly label: string;
  readonly seq: number;
}

export type ComparisonPlan =
  | {
      readonly kind: 'ok';
      readonly fromSeq: number;
      readonly toSeq: number;
      /** 실제로 무엇을 조회했는지 말하는 문자열 (AC-4). */
      readonly normalizedDirection: string;
      readonly unreleased: boolean;
    }
  | { readonly kind: 'failed'; readonly failure: AnchorFailure };

function direction(from: ComparisonEndpoint, to: ComparisonEndpoint): string {
  return `from=${from.label}(seq ${String(from.seq)}) → to=${to.label}(seq ${String(to.seq)})`;
}

/**
 * 두 앵커를 서수로 정규화한다 (AC-4).
 *
 * **지정 순서는 보지 않는다.** 서수가 작은 쪽이 시작이고 큰 쪽이 끝이다 — 뒤집힌
 * 입력은 오류가 아니라 정규화 대상이며, 그래서 이 경로에는 `RANGE_INVERTED`가
 * 없다. 반개구간 `(from, to]`의 경계는 **정규화된 위치**가 정한다: 요청에 적힌
 * `from`/`to`가 아니라 서수 순서가 경계를 정해야 `git log A..B`와 같은 뜻이 된다.
 */
function normalize(a: ComparisonEndpoint, b: ComparisonEndpoint, unreleased: boolean): ComparisonPlan {
  const [from, to] = a.seq <= b.seq ? [a, b] : [b, a];
  return {
    kind: 'ok',
    fromSeq: from.seq,
    toSeq: to.seq,
    normalizedDirection: direction(from, to),
    unreleased,
  };
}

/**
 * 요청의 `from`·`to`를 구간으로 바꾼다.
 *
 * `to=unreleased`이고 `from`이 없으면 **마지막 릴리스**가 시작 앵커다 — 미배포
 * 구간의 정의가 그것이다. 릴리스가 하나도 없으면 서수 0(첫 커밋 앞)부터다:
 * 태그가 없는 저장소에서 "전부 미배포"는 참이므로 404가 아니다 (DEV-146과 같은
 * 갈래 — `RELEASE_NOT_INDEXED`는 **지목한 태그**가 없을 때의 코드다).
 */
export async function planComparison(
  deps: AnchorDeps,
  space: ResolvedSpace,
  scope: AccessScope,
  from: string | null,
  to: string,
): Promise<ComparisonPlan> {
  if (to === UNRELEASED) {
    const head: ComparisonEndpoint = { label: `${space.baseBranch} head`, seq: space.headSeq };

    if (from === null) {
      const latest = await releaseRepo.findLatestRelease(
        deps.pool,
        space.repositoryId,
        space.baseBranch,
        space.seqEpoch,
      );
      const start: ComparisonEndpoint =
        latest === undefined
          ? { label: '릴리스 없음', seq: 0 }
          : { label: latest.tag_name, seq: Number(latest.merge_seq) };
      return normalize(start, head, true);
    }

    const [outcome] = await resolveAnchors(deps, space, scope, [{ position: 'from', expression: from }]);
    if (outcome === undefined || outcome.kind === 'failed') {
      return { kind: 'failed', failure: (outcome as { failure: AnchorFailure }).failure };
    }
    return normalize({ label: outcome.anchor.expression, seq: outcome.anchor.merge_seq }, head, true);
  }

  const outcomes = await resolveAnchors(deps, space, scope, [
    { position: 'from', expression: from ?? '' },
    { position: 'to', expression: to },
  ]);
  for (const outcome of outcomes) {
    if (outcome.kind === 'failed') return { kind: 'failed', failure: outcome.failure };
  }

  const [first, second] = outcomes;
  if (first === undefined || second === undefined || first.kind !== 'resolved' || second.kind !== 'resolved') {
    throw new Error('앵커 두 건을 요청했는데 결과가 두 건이 아니다');
  }
  return normalize(
    { label: first.anchor.expression, seq: first.anchor.merge_seq },
    { label: second.anchor.expression, seq: second.anchor.merge_seq },
    false,
  );
}

/**
 * 릴리스 앵커의 실패를 계약이 정한 코드로 옮긴다.
 *
 * 앵커 해석기는 없는 태그를 `ANCHOR_UNRESOLVABLE`(400)로 답하지만, API-SEQ-003의
 * 계약은 **지목한 릴리스가 없을 때 404 `RELEASE_NOT_INDEXED`**다. `detail.reason`이
 * `tag_not_found`(다른 태그는 있다)와 `release_not_indexed`(수집 자체가 없다)를
 * 그대로 가르므로 그 구분은 응답에 남는다.
 */
export function comparisonFailureCode(failure: AnchorFailure): ErrorCode {
  const reason = failure.detail['reason'];
  if (
    failure.code === 'ANCHOR_UNRESOLVABLE' &&
    (reason === 'tag_not_found' || reason === 'release_not_indexed')
  ) {
    return 'RELEASE_NOT_INDEXED';
  }
  return failure.code;
}
