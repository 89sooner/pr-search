/**
 * M 번호 채번의 순수 판정 (WP-074 / FR-SEQ-008 AC-1~AC-4 · AC-6, CR-079, 상세 설계 7절).
 *
 * `sequence-plan.ts`의 `numberCommits`와 같은 계층이다 — 저장소 없이 시험할 수 있는
 * 형태로 떼어 둔다. 이 함수가 하는 일은 한 문장이다: **checkpoint 다음 행부터 서수
 * 순서대로 걷다가, PR 확정이면 다음 번호를 주고, 직접 푸시 확정이면 번호 없이
 * 지나가고, 미확정이면 그 앞에서 멈춘다.**
 *
 * 입력을 정렬하거나 구멍을 메우지 않는다. 순서는 `merge_seq`가 정한 것이고 그것이
 * 값의 정의다 — 여기서 다시 정렬하면 정의가 두 곳이 된다.
 */

import { MERGE_NUMBER_MAX, type MergeNumberBlockReason } from '@prs/domain';

export type PlanDecision = 'pr_confirmed' | 'direct_confirmed' | 'unresolved';

export interface PlanRow {
  readonly mergeSeq: number;
  readonly sha: string;
  readonly decision: PlanDecision;
  /** `pr_confirmed`일 때만 값이 있다. */
  readonly prNumber: number | null;
  /** `unresolved`의 사유 (고정 enum). 없으면 `pr_evidence_pending`으로 본다. */
  readonly reason: MergeNumberBlockReason | null;
  /** 정본 행에 이미 있는 번호. 재실행이면 같은 값이 나와야 한다. */
  readonly existingNumber: number | null;
  /** 정본 행의 `pull_request_number`. 확정 PR과 다르면(둘 다 non-null) 정본 불일치다. */
  readonly existingPr: number | null;
  /** 확정 PR의 `merged_at`. 순서 대조(AC-6)에만 쓴다. */
  readonly mergedAt: Date | null;
}

export interface PlanInput {
  readonly checkpoint: { readonly headSeq: number; readonly headNumber: number };
  readonly rows: readonly PlanRow[];
  /**
   * 직전 회차가 마지막으로 번호를 준 PR의 `merged_at`. 회차 경계에서도 순서를
   * 대조하기 위해서다. 없으면 `null`.
   */
  readonly previousAssignedMergedAt: Date | null;
  /** 직전 회차까지 번호를 받은 PR 집합의 판정 함수. 같은 PR이 다른 서수로 다시 오면 충돌이다. */
  readonly isAlreadyNumbered: (prNumber: number) => boolean;
  /** 이 회차의 처리 예산 (ms). 소진하면 완료가 아니라 다음 회차다. */
  readonly budgetMs?: number;
  readonly now?: () => number;
}

export interface PlanAssignment {
  readonly mergeSeq: number;
  readonly prNumber: number;
  readonly mergeNumber: number;
  readonly mergedAt: Date | null;
}

export interface PlanResult {
  readonly assignments: readonly PlanAssignment[];
  readonly nextHeadSeq: number;
  readonly nextHeadNumber: number;
  /** 멈춘 자리. 없으면 이 batch를 끝까지 확인했다. */
  readonly blocked: { readonly seq: number; readonly reason: MergeNumberBlockReason } | null;
  /** `merged_at` 순서가 서수 순서와 어긋난 PR 쌍 수. 채번을 막지 않는다 (AC-6). */
  readonly orderMismatches: number;
  /** `merged_at`이 없어 대조하지 못한 PR 수. 번호를 막지 않는다. */
  readonly orderUnknown: number;
  /** 예산이 소진돼 여기서 끊었다. `blocked`가 아니라 "이어서"다. */
  readonly budgetExhausted: boolean;
}

/** 입력 자체가 계약을 어겼다. 정렬·구멍·다른 공간은 여기서 숨기지 않고 던진다. */
export class PlanInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlanInputError';
  }
}

export function planMergeNumbers(input: PlanInput): PlanResult {
  const now = input.now ?? Date.now;
  const deadline = input.budgetMs === undefined ? null : now() + input.budgetMs;

  let headSeq = input.checkpoint.headSeq;
  let headNumber = input.checkpoint.headNumber;
  if (!Number.isSafeInteger(headSeq) || headSeq < 0 || !Number.isSafeInteger(headNumber) || headNumber < 0) {
    throw new PlanInputError(`checkpoint가 비음수 정수가 아니다: ${String(headSeq)}/${String(headNumber)}`);
  }
  if (headNumber > headSeq) {
    throw new PlanInputError(`번호 수가 확인한 행 수보다 크다: ${String(headNumber)} > ${String(headSeq)}`);
  }

  const assignments: PlanAssignment[] = [];
  const numberedThisRound = new Set<number>();
  let previousMergedAt = input.previousAssignedMergedAt;
  let orderMismatches = 0;
  let orderUnknown = 0;
  let blocked: PlanResult['blocked'] = null;
  let budgetExhausted = false;

  for (const row of input.rows) {
    if (!Number.isSafeInteger(row.mergeSeq) || row.mergeSeq !== headSeq + 1) {
      throw new PlanInputError(
        `행이 연속이 아니다: ${String(headSeq + 1)}을 기대했는데 ${String(row.mergeSeq)}이다`,
      );
    }
    if (deadline !== null && now() > deadline) {
      budgetExhausted = true;
      break;
    }

    /*
     * checkpoint 너머에 이미 번호가 있다 — 정본이 이 planner 밖에서 바뀌었다는 뜻이다.
     * 멱등 재실행(같은 PR·같은 다음 번호)만 통과시키고 그 밖은 정본 불일치로 멈춘다.
     */
    if (row.existingNumber !== null) {
      const idempotent =
        row.decision === 'pr_confirmed' &&
        row.prNumber !== null &&
        row.existingPr === row.prNumber &&
        row.existingNumber === headNumber + 1;
      if (!idempotent) {
        blocked = { seq: row.mergeSeq, reason: 'canonical_mismatch' };
        break;
      }
    }

    if (row.decision === 'unresolved') {
      blocked = { seq: row.mergeSeq, reason: row.reason ?? 'pr_evidence_pending' };
      break;
    }

    if (row.decision === 'direct_confirmed') {
      // 번호를 받지도 소비하지도 않는다 (AC-1). 위치만 지나간다.
      headSeq = row.mergeSeq;
      continue;
    }

    // pr_confirmed
    const prNumber = row.prNumber;
    if (prNumber === null) {
      throw new PlanInputError(`pr_confirmed 행에 PR 번호가 없다: 서수 ${String(row.mergeSeq)}`);
    }
    if (row.existingPr !== null && row.existingPr !== prNumber) {
      // 정본의 PR 연결과 확정 근거가 다르다. COALESCE로 숨기지 않는다.
      blocked = { seq: row.mergeSeq, reason: 'canonical_mismatch' };
      break;
    }
    if (numberedThisRound.has(prNumber) || input.isAlreadyNumbered(prNumber)) {
      // 같은 PR이 다른 서수로 또 왔다 — 이중 squash SHA. 앞 번호는 그대로 두고 멈춘다.
      blocked = { seq: row.mergeSeq, reason: 'mapping_conflict' };
      break;
    }
    const nextNumber = headNumber + 1;
    if (nextNumber > MERGE_NUMBER_MAX) {
      blocked = { seq: row.mergeSeq, reason: 'number_capacity_exceeded' };
      break;
    }

    if (row.mergedAt === null) {
      orderUnknown += 1;
    } else {
      if (previousMergedAt !== null && row.mergedAt.getTime() < previousMergedAt.getTime()) {
        orderMismatches += 1;
      }
      previousMergedAt = row.mergedAt;
    }

    assignments.push({ mergeSeq: row.mergeSeq, prNumber, mergeNumber: nextNumber, mergedAt: row.mergedAt });
    numberedThisRound.add(prNumber);
    headSeq = row.mergeSeq;
    headNumber = nextNumber;
  }

  return { assignments, nextHeadSeq: headSeq, nextHeadNumber: headNumber, blocked, orderMismatches, orderUnknown, budgetExhausted };
}
