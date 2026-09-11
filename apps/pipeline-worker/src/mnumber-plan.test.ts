/**
 * WP-074 FR-SEQ-008 — T01 · T02 · T04d의 순수 판정.
 *
 * 기대값은 구현이 아니라 **시험 작성자가 손으로 선언한** 것이다 (실행서 4장).
 * 상세 설계 7절의 예: seq1=PR#21, seq2=direct, seq3=PR#25, seq4=unresolved, seq5=PR#29
 * → M1=#21, M2=#25, checkpoint 3/2, blocked 4. seq4가 PR#27로 확정되면 M3=#27, M4=#29.
 */

import { MERGE_NUMBER_MAX } from '@prs/domain';
import { describe, expect, it } from 'vitest';
import { PlanInputError, planMergeNumbers, type PlanRow } from './mnumber-plan.js';

const at = (iso: string): Date => new Date(iso);

function row(partial: Partial<PlanRow> & { mergeSeq: number }): PlanRow {
  return {
    sha: `sha-${String(partial.mergeSeq)}`,
    decision: 'pr_confirmed',
    prNumber: null,
    reason: null,
    existingNumber: null,
    existingPr: null,
    mergedAt: null,
    ...partial,
  };
}

const pr = (mergeSeq: number, prNumber: number, mergedAt?: string): PlanRow =>
  row({ mergeSeq, decision: 'pr_confirmed', prNumber, mergedAt: mergedAt === undefined ? null : at(mergedAt) });
const direct = (mergeSeq: number): PlanRow => row({ mergeSeq, decision: 'direct_confirmed' });
const pending = (mergeSeq: number, reason: PlanRow['reason'] = 'pr_evidence_pending'): PlanRow =>
  row({ mergeSeq, decision: 'unresolved', reason });

const base = { checkpoint: { headSeq: 0, headNumber: 0 }, previousAssignedMergedAt: null, isAlreadyNumbered: (): boolean => false };

describe('T01: squash PR만 세고 직접 푸시는 번호를 받지도 소비하지도 않는다 (AC-1 · AC-2)', () => {
  it('**설계 7절의 예제 그대로** — M1=#21, M2=#25, checkpoint 3/2, blocked 4', () => {
    const result = planMergeNumbers({ ...base, rows: [pr(1, 21), direct(2), pr(3, 25), pending(4), pr(5, 29)] });
    expect(result.assignments).toEqual([
      { mergeSeq: 1, prNumber: 21, mergeNumber: 1, mergedAt: null },
      { mergeSeq: 3, prNumber: 25, mergeNumber: 2, mergedAt: null },
    ]);
    expect(result.nextHeadSeq).toBe(3);
    expect(result.nextHeadNumber).toBe(2);
    expect(result.blocked).toEqual({ seq: 4, reason: 'pr_evidence_pending' });
  });

  it('seq4가 PR#27로 확정되면 다음 회차가 **같은 번호(M3)로** 이어받는다 (AC-3)', () => {
    const result = planMergeNumbers({
      ...base,
      checkpoint: { headSeq: 3, headNumber: 2 },
      rows: [pr(4, 27), pr(5, 29)],
    });
    expect(result.assignments.map((a) => [a.prNumber, a.mergeNumber])).toEqual([[27, 3], [29, 4]]);
    expect(result.blocked).toBeNull();
    expect(result.nextHeadSeq).toBe(5);
    expect(result.nextHeadNumber).toBe(4);
  });

  it('seq4가 증서 있는 direct면 M3=#29 — 앞 번호는 옮기지 않는다', () => {
    const result = planMergeNumbers({ ...base, checkpoint: { headSeq: 3, headNumber: 2 }, rows: [direct(4), pr(5, 29)] });
    expect(result.assignments).toEqual([{ mergeSeq: 5, prNumber: 29, mergeNumber: 3, mergedAt: null }]);
  });

  it('루트 커밋도 미확정이면 그 자리에서 멈춘다 — 초기 커밋을 임의로 건너뛰지 않는다 (DEV-581)', () => {
    const result = planMergeNumbers({ ...base, rows: [pending(1, 'negative_evidence_unavailable'), pr(2, 21)] });
    expect(result.assignments).toEqual([]);
    expect(result.blocked).toEqual({ seq: 1, reason: 'negative_evidence_unavailable' });
    expect(result.nextHeadSeq).toBe(0);
  });
});

describe('T02c: 충돌은 앞 번호를 보존하고 새 부여를 멈춘다', () => {
  it('같은 PR이 다른 서수로 또 오면 mapping_conflict', () => {
    const result = planMergeNumbers({ ...base, rows: [pr(1, 21), pr(2, 21)] });
    expect(result.assignments).toHaveLength(1);
    expect(result.blocked).toEqual({ seq: 2, reason: 'mapping_conflict' });
  });

  it('직전 회차에 이미 번호를 받은 PR이 다시 오면 mapping_conflict', () => {
    const result = planMergeNumbers({ ...base, checkpoint: { headSeq: 2, headNumber: 1 }, isAlreadyNumbered: (n) => n === 21, rows: [pr(3, 21)] });
    expect(result.blocked).toEqual({ seq: 3, reason: 'mapping_conflict' });
  });

  it('정본의 PR 연결과 확정 근거가 다르면 canonical_mismatch — COALESCE로 숨기지 않는다', () => {
    const result = planMergeNumbers({ ...base, rows: [row({ mergeSeq: 1, prNumber: 21, existingPr: 22 })] });
    expect(result.blocked).toEqual({ seq: 1, reason: 'canonical_mismatch' });
  });

  it('checkpoint 너머에 다른 번호가 이미 있으면 canonical_mismatch, 같은 번호면 멱등 통과', () => {
    const stale = planMergeNumbers({ ...base, rows: [row({ mergeSeq: 1, prNumber: 21, existingPr: 21, existingNumber: 7 })] });
    expect(stale.blocked).toEqual({ seq: 1, reason: 'canonical_mismatch' });
    const same = planMergeNumbers({ ...base, rows: [row({ mergeSeq: 1, prNumber: 21, existingPr: 21, existingNumber: 1 })] });
    expect(same.blocked).toBeNull();
    expect(same.assignments[0]?.mergeNumber).toBe(1);
  });

  it('상한 값 자체는 부여할 수 있고, 그 위는 서수부터 safe integer를 넘어 입력 계약이 거부한다 (C4)', () => {
    /*
     * M ≤ 확인한 서수 ≤ safe integer이므로 `number_capacity_exceeded`는 planner 안에서
     * 도달할 수 없다 — 그 앞에서 서수 자체가 `PlanInputError`다. 상한 값의 부여가 되는
     * 것과 그 위가 조용히 반올림되지 않는 것을 함께 확인한다. 실제 방어선은 DB CHECK와
     * API의 BigInt 범위 검사다.
     */
    const atMax = planMergeNumbers({
      ...base,
      checkpoint: { headSeq: MERGE_NUMBER_MAX - 1, headNumber: MERGE_NUMBER_MAX - 1 },
      rows: [pr(MERGE_NUMBER_MAX, 5)],
    });
    expect(atMax.assignments[0]?.mergeNumber).toBe(MERGE_NUMBER_MAX);
    expect(() =>
      planMergeNumbers({
        ...base,
        checkpoint: { headSeq: MERGE_NUMBER_MAX, headNumber: MERGE_NUMBER_MAX },
        rows: [pr(MERGE_NUMBER_MAX + 1, 6)],
      }),
    ).toThrow(PlanInputError);
  });
});

describe('T04d: merged_at 순서 대조는 지표일 뿐 채번을 막지 않는다 (AC-6)', () => {
  it('후행 시각 < 선행 시각인 쌍만 센다. 동률은 불일치가 아니다', () => {
    const result = planMergeNumbers({
      ...base,
      rows: [pr(1, 1, '2026-09-01T00:00:10Z'), pr(2, 2, '2026-09-01T00:00:05Z'), pr(3, 3, '2026-09-01T00:00:05Z'), pr(4, 4, '2026-09-01T00:00:20Z')],
    });
    expect(result.assignments).toHaveLength(4);
    expect(result.orderMismatches).toBe(1);
  });

  it('회차 경계도 대조한다 — 직전 회차의 마지막 시각과 비교한다', () => {
    const result = planMergeNumbers({
      ...base,
      checkpoint: { headSeq: 1, headNumber: 1 },
      previousAssignedMergedAt: at('2026-09-01T00:00:10Z'),
      rows: [pr(2, 2, '2026-09-01T00:00:01Z')],
    });
    expect(result.orderMismatches).toBe(1);
  });

  it('merged_at이 없으면 missing으로 세고 번호는 준다', () => {
    const result = planMergeNumbers({ ...base, rows: [pr(1, 1), pr(2, 2, '2026-09-01T00:00:00Z')] });
    expect(result.assignments).toHaveLength(2);
    expect(result.orderUnknown).toBe(1);
    expect(result.orderMismatches).toBe(0);
  });
});

describe('입력 계약', () => {
  it('첫 행이 checkpoint+1이 아니면 던진다 — 정렬해서 숨기지 않는다', () => {
    expect(() => planMergeNumbers({ ...base, rows: [pr(2, 1)] })).toThrow(PlanInputError);
    expect(() => planMergeNumbers({ ...base, rows: [pr(1, 1), pr(3, 2)] })).toThrow(PlanInputError);
    expect(() => planMergeNumbers({ ...base, rows: [pr(2, 2), pr(1, 1)] })).toThrow(PlanInputError);
  });

  it('pr_confirmed 행에 PR 번호가 없으면 던진다', () => {
    expect(() => planMergeNumbers({ ...base, rows: [row({ mergeSeq: 1, decision: 'pr_confirmed' })] })).toThrow(PlanInputError);
  });

  it('예산 소진은 완료가 아니라 "이어서"다', () => {
    let tick = 0;
    const result = planMergeNumbers({ ...base, rows: [pr(1, 1), pr(2, 2), pr(3, 3)], budgetMs: 1, now: () => (tick += 1) });
    expect(result.budgetExhausted).toBe(true);
    expect(result.blocked).toBeNull();
    expect(result.assignments.length).toBeLessThan(3);
  });

  it('빈 입력은 checkpoint를 그대로 돌려준다', () => {
    const result = planMergeNumbers({ ...base, checkpoint: { headSeq: 5, headNumber: 3 }, rows: [] });
    expect(result).toMatchObject({ assignments: [], nextHeadSeq: 5, nextHeadNumber: 3, blocked: null });
  });
});
