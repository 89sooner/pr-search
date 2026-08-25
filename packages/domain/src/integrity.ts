/**
 * 시퀀스 정합성 대조 (WP-028 / FR-ADMIN-003, CR-033).
 *
 * ## 왜 순수 함수인가
 *
 * 같은 판정을 두 곳이 한다 — 운영자가 부르는 `GET /admin/sequence-integrity`와
 * 하루 한 번 도는 `JOB-SEQ-003`이다. 둘이 각자 비교 규칙을 갖고 있으면 언젠가
 * 한쪽만 고쳐지고, 그때 "점검은 통과인데 잡은 불일치"라는 답이 나온다. 입력을
 * 모으는 방법(한쪽은 요청, 한쪽은 스케줄)만 다르고 **비교는 하나다.**
 *
 * ## 불변식
 *
 * `merge_seq`는 `git rev-list --first-parent --reverse`의 1-기반 서수다
 * (ADR-007). 따라서 체인을 오래된 것부터 늘어놓았을 때 **`i`번째(0-기반) 커밋의
 * 서수는 `i + 1`이다.** 이 함수는 그 대응이 깨진 첫 지점을 찾는다.
 */

/** 저장된 서수-커밋 대응 한 줄. */
export interface StoredSequenceEntry {
  readonly mergeSeq: number;
  readonly commitSha: string;
}

/**
 * 최초 불일치 지점.
 *
 * `actualCommitSha`가 `null`이면 히스토리가 짧아져 그 서수에 해당하는 커밋이
 * 아예 없다는 뜻이다 — 강제 푸시로 뒤쪽이 잘린 모습이다.
 */
export interface SequenceMismatch {
  readonly mergeSeq: number;
  readonly storedCommitSha: string;
  readonly actualCommitSha: string | null;
}

/**
 * 저장된 대응과 실제 체인을 대조해 **최초** 불일치를 찾는다.
 *
 * 최초 지점 하나만 낸다 (FR-ADMIN-003 AC-3). 한 번 어긋나면 그 뒤는 전부 밀린
 * 결과라 나열해도 정보가 늘지 않고, 운영자가 재채번을 결정하는 데 필요한 것은
 * "어디서부터"뿐이다.
 *
 * **체인이 저장분보다 긴 것은 불일치가 아니다.** 채번이 아직 따라잡지 못한
 * 상태이며(웹훅 지연·채번 예약 대기), 그것을 불일치로 부르면 정상 운영 중에
 * 재채번을 권하게 된다. 반대로 **저장분이 체인보다 긴 것은 불일치다** — 그
 * 서수가 가리키던 커밋이 히스토리에서 사라졌다는 뜻이다.
 *
 * @param stored 저장된 대응. 서수 오름차순일 필요는 없다 — 여기서 정렬한다.
 * @param actualOldestFirst first-parent 체인을 **오래된 것부터**. `[i]`의 서수는 `i + 1`이다.
 */
export function firstSequenceMismatch(
  stored: readonly StoredSequenceEntry[],
  actualOldestFirst: readonly string[],
): SequenceMismatch | null {
  const ascending = [...stored].sort((a, b) => a.mergeSeq - b.mergeSeq);
  for (const entry of ascending) {
    const actual = actualOldestFirst[entry.mergeSeq - 1] ?? null;
    if (actual === null) {
      return { mergeSeq: entry.mergeSeq, storedCommitSha: entry.commitSha, actualCommitSha: null };
    }
    if (actual.toLowerCase() !== entry.commitSha.toLowerCase()) {
      return { mergeSeq: entry.mergeSeq, storedCommitSha: entry.commitSha, actualCommitSha: actual };
    }
  }
  return null;
}

/** 표본 모드가 대조하는 서수 개수 (FR-ADMIN-003 AC-2). */
export const INTEGRITY_SAMPLE_SIZE = 1000;

/**
 * 표본 모드가 대조할 서수 하한 (포함).
 *
 * "최근 1000개"다. 채번된 것이 1000개 미만이면 전부 본다 — 그때 하한은 1이다.
 * 0이나 음수를 내지 않는다: 서수는 1부터다.
 */
export function sampleFromSeq(headSeq: number, sampleSize = INTEGRITY_SAMPLE_SIZE): number {
  return Math.max(1, headSeq - sampleSize + 1);
}
