/**
 * M 번호가 git과 일치한다 (WP-074 FR-SEQ-008 AC-1 · AC-2 / 실행서 T01, 릴리스 검증 8장).
 *
 * ## 왜 회귀 계층인가
 *
 * `regression/sequence.test.ts`(ACC-02)가 묻는 것과 같은 질문을 M 번호에 대해 한다:
 * **"우리가 낸 답이 git이 낸 답과 같은가."** 단위·통합 시험은 "코드가 설계대로
 * 도는가"를 묻고 그 질문에는 이미 통과했다.
 *
 * 기대값은 **git이 만든다** — `git rev-list --first-parent --reverse`에서 squash
 * 머지 커밋만 추린 순서가 곧 M 번호 순서다. 구현의 planner나 classifier가 만든
 * 값을 기대값으로 가져오지 않는다 (실행서 4장).
 *
 * ## 여기서 확인하지 않는 것
 *
 * 직접 푸시의 **부재 확정**. production 판정기는 그것을 만들지 않으며(DEV-581),
 * 이 시험은 확정 증서를 시험이 직접 주입한 상태에서 순서만 대조한다. 이 파일의
 * 통과는 그 게이트를 닫지 않는다.
 *
 * 실행: `pnpm test:regression`
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { planMergeNumbers, type PlanRow } from '../apps/pipeline-worker/src/mnumber-plan.js';
import { removeDir, run } from '../apps/pipeline-worker/integration/sequence/fixture.js';
import { createSquashFixture, squashMerge, type SquashFixture } from '../apps/pipeline-worker/integration/sequence/squash-fixture.js';

let origin: SquashFixture;

beforeAll(async () => {
  origin = await createSquashFixture();
}, 120_000);

afterAll(async () => {
  await removeDir(origin.dir);
});

/** git이 낸 first-parent 체인. 정답지는 우리 구현이 아니라 이것이다. */
async function firstParentChain(): Promise<readonly string[]> {
  const stdout = await run(origin.dir, ['rev-list', '--first-parent', '--reverse', 'main']);
  return stdout.split('\n').map((line) => line.trim()).filter((line) => line !== '');
}

/** 체인을 planner 입력으로 옮긴다. 알려진 squash는 PR 확정, 나머지는 직접 확정이다. */
function toPlanRows(chain: readonly string[], squash: ReadonlyMap<number, string>, mergedAt: ReadonlyMap<number, string>): PlanRow[] {
  const prBySha = new Map([...squash].map(([pr, sha]) => [sha, pr]));
  return chain.map((sha, index) => {
    const pr = prBySha.get(sha);
    return pr === undefined
      ? { mergeSeq: index + 1, sha, decision: 'direct_confirmed' as const, prNumber: null, reason: null, existingNumber: null, existingPr: null, mergedAt: null }
      : {
          mergeSeq: index + 1,
          sha,
          decision: 'pr_confirmed' as const,
          prNumber: pr,
          reason: null,
          existingNumber: null,
          existingPr: null,
          mergedAt: new Date(mergedAt.get(pr) as string),
        };
  });
}

describe('M 번호가 `git rev-list --first-parent`에서 squash만 추린 순서와 같다 (AC-1 · AC-2)', () => {
  it('**순서와 구성이 완전히 같다**', async () => {
    const chain = await firstParentChain();
    const plan = planMergeNumbers({
      checkpoint: { headSeq: 0, headNumber: 0 },
      rows: toPlanRows(chain, origin.squash, origin.mergedAt),
      previousAssignedMergedAt: null,
      isAlreadyNumbered: () => false,
    });

    // git이 낸 순서에서 squash 커밋만 추린다 — 이것이 기대값이다.
    const squashShas = new Set(origin.squash.values());
    const expected = chain.filter((sha) => squashShas.has(sha));
    const actual = plan.assignments.map((one) => chain[one.mergeSeq - 1]);
    expect(actual).toEqual(expected);
    expect(plan.assignments.map((one) => one.mergeNumber)).toEqual([1, 2, 3, 4]);
    expect(plan.blocked).toBeNull();
  });

  it('**직접 푸시 커밋은 번호를 받지도 소비하지도 않는다**', async () => {
    const chain = await firstParentChain();
    const plan = planMergeNumbers({
      checkpoint: { headSeq: 0, headNumber: 0 },
      rows: toPlanRows(chain, origin.squash, origin.mergedAt),
      previousAssignedMergedAt: null,
      isAlreadyNumbered: () => false,
    });
    // 체인은 6이고 직접 푸시가 둘이다 — 번호는 4에서 끝난다.
    expect(chain).toHaveLength(6);
    expect(plan.nextHeadSeq).toBe(6);
    expect(plan.nextHeadNumber).toBe(4);
    const numberedSeqs = plan.assignments.map((one) => one.mergeSeq);
    expect(numberedSeqs).not.toContain(1); // root
    expect(numberedSeqs).not.toContain(3); // direct push
  });

  it('**squash 머지는 원본 커밋 수와 무관하게 번호 하나를 받는다**', async () => {
    // A는 원본 커밋 3개짜리 PR이었다. 체인에는 하나로 들어간다.
    const featureCommits = await run(origin.dir, ['rev-list', '--count', 'fa']);
    expect(Number(featureCommits.trim())).toBeGreaterThan(1);
    const chain = await firstParentChain();
    expect(chain.filter((sha) => sha === origin.squash.get(21))).toHaveLength(1);
  });

  it('커밋이 늘어도 기존 번호가 흔들리지 않는다 (인용의 근거)', async () => {
    const before = await firstParentChain();
    const beforePlan = planMergeNumbers({
      checkpoint: { headSeq: 0, headNumber: 0 },
      rows: toPlanRows(before, origin.squash, origin.mergedAt),
      previousAssignedMergedAt: null,
      isAlreadyNumbered: () => false,
    });

    const newSha = await squashMerge(origin.dir, 'fz', 1, 'Z squash (#41)', '2026-09-02T00:00:00Z');
    const after = await firstParentChain();
    const squash = new Map([...origin.squash, [41, newSha]]);
    const mergedAt = new Map([...origin.mergedAt, [41, '2026-09-02T00:00:00Z']]);
    const afterPlan = planMergeNumbers({
      checkpoint: { headSeq: 0, headNumber: 0 },
      rows: toPlanRows(after, squash, mergedAt),
      previousAssignedMergedAt: null,
      isAlreadyNumbered: () => false,
    });

    // 앞선 번호는 그대로이고 새 PR이 그 다음 번호를 받는다.
    for (const assignment of beforePlan.assignments) {
      const same = afterPlan.assignments.find((one) => one.prNumber === assignment.prNumber);
      expect(same?.mergeNumber, `PR #${String(assignment.prNumber)}의 번호가 움직였다`).toBe(assignment.mergeNumber);
    }
    expect(afterPlan.assignments.find((one) => one.prNumber === 41)?.mergeNumber).toBe(5);
  });

  it('증분 채번이 한 번에 채번한 것과 같은 결과를 낸다 (멱등)', async () => {
    const chain = await firstParentChain();
    const rows = toPlanRows(chain, new Map([...origin.squash, [41, chain[chain.length - 1] as string]]), new Map([...origin.mergedAt, [41, '2026-09-02T00:00:00Z']]));
    const whole = planMergeNumbers({
      checkpoint: { headSeq: 0, headNumber: 0 },
      rows,
      previousAssignedMergedAt: null,
      isAlreadyNumbered: () => false,
    });

    const firstHalf = planMergeNumbers({
      checkpoint: { headSeq: 0, headNumber: 0 },
      rows: rows.slice(0, 4),
      previousAssignedMergedAt: null,
      isAlreadyNumbered: () => false,
    });
    const numbered = new Set(firstHalf.assignments.map((one) => one.prNumber));
    const secondHalf = planMergeNumbers({
      checkpoint: { headSeq: firstHalf.nextHeadSeq, headNumber: firstHalf.nextHeadNumber },
      rows: rows.slice(4),
      previousAssignedMergedAt: null,
      isAlreadyNumbered: (pr) => numbered.has(pr),
    });

    expect([...firstHalf.assignments, ...secondHalf.assignments]).toEqual(whole.assignments);
  });
});
