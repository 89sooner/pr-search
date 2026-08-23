/**
 * 채번 워커만 쓰는 순수 판정 (WP-021 / FR-SEQ-001, ADR-007).
 *
 * push 웹훅 해석과 시퀀스 공간 문자열은 게이트웨이도 쓰므로 `@prs/domain`에
 * 있다. 여기 남은 것은 **채번 자신의 계산**이다 — 이 제품의 핵심 주장을
 * 지탱하는 계산이라 저장소 없이 시험할 수 있는 형태로 떼어 둔다.
 */

/** 이 저장소에서 채번하는 브랜치인가 (FR-ING-009 AC-2). */
export function isSequenceBranch(sequenceBranches: readonly string[], branch: string): boolean {
  return sequenceBranches.includes(branch);
}

export interface NumberedCommit {
  readonly mergeSeq: number;
  readonly sha: string;
  readonly committedAt: string;
}

/**
 * first-parent 체인에 서수를 붙인다 (FR-SEQ-001 AC-1·AC-2).
 *
 * `headSeq`는 **이미 채번된 마지막 서수**이고 새 커밋은 그 다음부터다. 루트
 * 커밋이 1이 되는 것은 최초 채번에서 `headSeq`가 0이기 때문이다.
 *
 * 입력 순서를 여기서 다시 정렬하지 **않는다.** 순서는 `git rev-list
 * --first-parent --reverse`가 정한 것이고, 그것이 이 값의 정의다 — 여기서 다시
 * 정렬하면 정의가 두 곳이 되고 언젠가 갈라진다.
 */
export function numberCommits(
  headSeq: number,
  commits: readonly { readonly sha: string; readonly committedAt: string }[],
): readonly NumberedCommit[] {
  return commits.map((commit, index) => ({
    mergeSeq: headSeq + index + 1,
    sha: commit.sha,
    committedAt: commit.committedAt,
  }));
}

/**
 * 채번 한 회차의 결말.
 *
 * 여섯을 **하나로 뭉치지 않는다.** 운영자가 "왜 시퀀스가 안 늘어나나"를 물었을
 * 때 대상이 아닌 것과, 브랜치가 아직 없는 것과, 다른 워커가 쥔 것과, 미러를
 * 읽지 못한 것과, 히스토리가 재작성된 것은 해야 할 일이 전부 다르다.
 */
export type AssignOutcome =
  /** 서수를 붙였다. `fromSeq === toSeq`면 새 커밋이 없었다는 뜻이다. */
  | { readonly kind: 'assigned'; readonly fromSeq: number; readonly toSeq: number; readonly headSha: string }
  /** 채번 대상 브랜치가 아니거나 저장소가 등록되어 있지 않다. */
  | { readonly kind: 'skipped'; readonly reason: string }
  /** 대상 브랜치가 아직 없다. 오류가 아니다. */
  | { readonly kind: 'no_branch' }
  /** 다른 워커가 이 공간을 쥐고 있다. 기다리지 않고 나중에 다시 온다 (AC-6). */
  | { readonly kind: 'locked' }
  /** 그래프를 읽지 못했다. 공간을 `stale`로 두고 기존 값은 보존한다. */
  | { readonly kind: 'stale'; readonly reason: string }
  /** 히스토리가 재작성됐다. 여기서 고치지 않는다 (WP-022). */
  | { readonly kind: 'rewritten'; readonly storedHead: string; readonly newHead: string };
