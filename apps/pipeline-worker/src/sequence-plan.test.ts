/**
 * 시퀀스 채번의 순수 판정 (WP-021 / FR-SEQ-001, ADR-007).
 *
 * 이 파일이 거는 것은 하나로 모인다: **서수가 first-parent 순서를 그대로
 * 옮기는가.** 이 제품의 핵심 주장이 그 한 문장이고, 여기가 틀리면 검색도
 * 범위 조회도 이분 탐색도 전부 틀린 답을 준다 — 그러면서 아무 오류도 내지
 * 않는다.
 */

import { describe, expect, it } from 'vitest';
import { isSequenceBranch, numberCommits } from './sequence-plan.js';

const c = (sha: string, at = '2026-08-23T00:00:00+00:00'): { sha: string; committedAt: string } => ({
  sha,
  committedAt: at,
});

describe('서수 부여 (AC-1, AC-2)', () => {
  it('최초 채번에서 루트가 1이다', () => {
    const numbered = numberCommits(0, [c('a'), c('b'), c('c')]);
    expect(numbered.map((n) => n.mergeSeq)).toEqual([1, 2, 3]);
  });

  it('입력 순서를 그대로 옮긴다 — 다시 정렬하지 않는다', () => {
    /*
     * 순서의 정의는 `git rev-list --first-parent --reverse`이지 시각이 아니다.
     * 커밋 시각은 rebase·cherry-pick·시계 어긋남으로 얼마든지 역전되며,
     * 여기서 시각으로 다시 정렬하면 **git과 대조 검증이 깨진다.**
     */
    const numbered = numberCommits(0, [
      c('a', '2026-08-23T10:00:00+00:00'),
      c('b', '2026-08-23T09:00:00+00:00'), // 앞 커밋보다 이르다
      c('c', '2026-08-23T11:00:00+00:00'),
    ]);
    expect(numbered.map((n) => n.sha)).toEqual(['a', 'b', 'c']);
    expect(numbered.map((n) => n.mergeSeq)).toEqual([1, 2, 3]);
  });

  it('증분 채번은 저장된 head 다음부터 잇는다 (AC-5)', () => {
    const numbered = numberCommits(1280, [c('x'), c('y')]);
    expect(numbered.map((n) => n.mergeSeq)).toEqual([1281, 1282]);
  });

  it('새 커밋이 없으면 빈 결과다 — 서수를 만들어 내지 않는다', () => {
    expect(numberCommits(42, [])).toEqual([]);
  });

  it('커밋 시각을 그대로 나른다 — `merge_sequence.committed_at`의 유일한 출처다 (DEV-115)', () => {
    const numbered = numberCommits(0, [c('a', '2026-01-02T03:04:05+09:00')]);
    expect(numbered[0]?.committedAt).toBe('2026-01-02T03:04:05+09:00');
  });

  it('연속 채번이 이어 붙어도 서수에 구멍이나 겹침이 없다', () => {
    // 세 회차로 나눠 채번한 결과가 한 번에 채번한 것과 같아야 한다.
    const first = numberCommits(0, [c('a'), c('b')]);
    const second = numberCommits(first[first.length - 1]?.mergeSeq ?? 0, [c('c')]);
    const third = numberCommits(second[second.length - 1]?.mergeSeq ?? 0, [c('d'), c('e')]);

    const stepwise = [...first, ...second, ...third];
    const oneShot = numberCommits(0, [c('a'), c('b'), c('c'), c('d'), c('e')]);
    expect(stepwise.map((n) => [n.mergeSeq, n.sha])).toEqual(oneShot.map((n) => [n.mergeSeq, n.sha]));
  });
});

describe('채번 대상 브랜치 판정 (FR-ING-009 AC-2)', () => {
  it('등록된 브랜치만 채번한다', () => {
    expect(isSequenceBranch(['main', 'release/2026'], 'main')).toBe(true);
    expect(isSequenceBranch(['main', 'release/2026'], 'release/2026')).toBe(true);
  });

  it('등록되지 않은 브랜치는 대상이 아니다 — feature 브랜치마다 시퀀스 공간이 생기지 않는다', () => {
    expect(isSequenceBranch(['main'], 'feature/login')).toBe(false);
  });

  it('빈 목록이면 아무것도 채번하지 않는다', () => {
    expect(isSequenceBranch([], 'main')).toBe(false);
  });

  it('접두 일치로 통과시키지 않는다', () => {
    // `main`이 등록됐다고 `main-backup`이 같은 공간일 수는 없다.
    expect(isSequenceBranch(['main'], 'main-backup')).toBe(false);
    expect(isSequenceBranch(['release'], 'release/2026')).toBe(false);
  });
});
