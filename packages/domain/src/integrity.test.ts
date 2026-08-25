/**
 * 시퀀스 정합성 대조 (WP-028 / FR-ADMIN-003 AC-3, CR-033).
 *
 * 이 파일이 지키는 주장: **최초 지점 하나만 낸다**, **채번이 뒤처진 것은
 * 불일치가 아니다**, **히스토리가 짧아진 것은 불일치다**.
 */

import { describe, expect, it } from 'vitest';
import { firstSequenceMismatch, sampleFromSeq, INTEGRITY_SAMPLE_SIZE } from './integrity.js';

const sha = (n: number): string => `${String(n).padStart(2, '0')}${'a'.repeat(38)}`;

describe('firstSequenceMismatch', () => {
  it('전부 일치하면 null이다', () => {
    const stored = [1, 2, 3].map((n) => ({ mergeSeq: n, commitSha: sha(n) }));
    expect(firstSequenceMismatch(stored, [sha(1), sha(2), sha(3)])).toBeNull();
  });

  it('**최초** 불일치만 낸다 — 뒤의 어긋남은 전부 밀린 결과다', () => {
    const stored = [1, 2, 3, 4].map((n) => ({ mergeSeq: n, commitSha: sha(n) }));
    const actual = [sha(1), sha(9), sha(8), sha(7)];
    expect(firstSequenceMismatch(stored, actual)).toEqual({
      mergeSeq: 2,
      storedCommitSha: sha(2),
      actualCommitSha: sha(9),
    });
  });

  it('**체인이 저장분보다 길어도 불일치가 아니다** — 채번이 뒤처졌을 뿐이다', () => {
    const stored = [1, 2].map((n) => ({ mergeSeq: n, commitSha: sha(n) }));
    expect(firstSequenceMismatch(stored, [sha(1), sha(2), sha(3), sha(4)])).toBeNull();
  });

  it('**저장분이 체인보다 길면 불일치다** — 그 서수의 커밋이 사라졌다', () => {
    const stored = [1, 2, 3].map((n) => ({ mergeSeq: n, commitSha: sha(n) }));
    expect(firstSequenceMismatch(stored, [sha(1), sha(2)])).toEqual({
      mergeSeq: 3,
      storedCommitSha: sha(3),
      actualCommitSha: null,
    });
  });

  it('입력 순서에 기대지 않는다 — 서수로 정렬해 본다', () => {
    const stored = [3, 1, 2].map((n) => ({ mergeSeq: n, commitSha: sha(n) }));
    const actual = [sha(1), sha(2), sha(9)];
    expect(firstSequenceMismatch(stored, actual)?.mergeSeq).toBe(3);
  });

  it('대소문자가 달라도 같은 SHA다', () => {
    const stored = [{ mergeSeq: 1, commitSha: sha(1).toUpperCase() }];
    expect(firstSequenceMismatch(stored, [sha(1)])).toBeNull();
  });

  it('표본이 앞을 건너뛰어도 그 구간만 본다', () => {
    // 서수 1이 어긋나 있지만 표본에 없으면 표본은 통과다 — 본 것만 말한다.
    const stored = [{ mergeSeq: 3, commitSha: sha(3) }];
    expect(firstSequenceMismatch(stored, [sha(9), sha(9), sha(3)])).toBeNull();
  });
});

describe('sampleFromSeq', () => {
  it('최근 1000개의 하한이다', () => {
    expect(sampleFromSeq(5000)).toBe(4001);
    expect(INTEGRITY_SAMPLE_SIZE).toBe(1000);
  });

  it('채번분이 표본보다 적으면 1부터다 — 0이나 음수를 내지 않는다', () => {
    expect(sampleFromSeq(10)).toBe(1);
    expect(sampleFromSeq(0)).toBe(1);
  });
});
