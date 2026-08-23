/**
 * 커밋 그래프 접근 계층 (WP-020 / FR-SEQ-001, FR-REL-005, ADR-005).
 *
 * 머지 시퀀스는 first-parent 체인을 걸어야 나온다. 그 체인을 얻는 길이 둘이고
 * (로컬 blobless 미러 / GitHub REST), 저장소마다 어느 쪽을 쓸지가 다르다
 * (FR-ING-009 AC-1). 그 차이를 호출 측이 알 필요는 없어야 하므로 인터페이스
 * 하나로 덮는다.
 *
 * **모든 연산이 `RepoRef`를 받는다** (CR-023, DEV-108). 백엔드 아키텍처 4.3의
 * 예시는 `isAncestor(shaA, shaB)`처럼 SHA만 넘겼지만, git 명령은 특정 미러
 * 디렉터리에서 돌아야 하고 API 폴백도 저장소를 알아야 호출할 수 있다.
 * 어떤 연산은 저장소를 알고 어떤 연산은 모르는 인터페이스는 언젠가 틀린
 * 저장소를 본다.
 */

import type { RepoRef } from './client.js';
import type { FirstParentCommit, RevRange } from './graph-plan.js';

/** 이 그래프가 어느 경로로 답하는가. 문서에 `patch_id_unavailable`을 적을지 판단할 때 쓴다. */
export type CommitGraphKind = 'mirror' | 'api';

/**
 * patch-id를 낼 수 없는 사유 (FR-REL-005 AC-5).
 *
 * **`null` 하나로 뭉개지 않는다.** 운영자가 "왜 체리픽 탐지가 안 되나"를
 * 물었을 때 미러가 없어서인지, blob 인출이 막혀서인지, 계산이 깨졌는지는
 * 대응이 전부 다르다.
 */
export type PatchIdUnavailable =
  /** 이 저장소는 미러를 쓰지 않는다. API로는 patch-id를 계산할 수 없다 (ADR-005). */
  | 'no_mirror'
  /** 미러는 있으나 blob 지연 인출이 막혀 diff를 만들 수 없다 (CR-023, DEV-111). */
  | 'blob_fetch_disabled'
  /** 계산이 실패했다. 커밋은 있으나 patch-id가 나오지 않았다 (FR-REL-005 예외 처리). */
  | 'compute_failed';

export type PatchIdResult =
  | { readonly patchId: string; readonly unavailable?: undefined }
  | { readonly patchId: null; readonly unavailable: PatchIdUnavailable };

export interface CommitGraph {
  readonly kind: CommitGraphKind;

  /**
   * 브랜치의 현재 head.
   *
   * @returns 브랜치가 없으면 `null`. **던지지 않는다** — 아직 만들어지지
   * 않은 대상 브랜치는 오류가 아니라 "채번할 것이 없음"이다.
   */
  resolveHead(ref: RepoRef, branch: string): Promise<string | null>;

  /** `ancestor`가 `descendant`의 조상인가 (FR-SEQ-005의 재작성 감지). */
  isAncestor(ref: RepoRef, ancestor: string, descendant: string): Promise<boolean>;

  /** 두 커밋의 merge-base. 공통 조상이 없으면 `null`. */
  mergeBase(ref: RepoRef, a: string, b: string): Promise<string | null>;

  /** first-parent 체인을 **오래된 것부터** 준다 (`git rev-list --first-parent --reverse`와 같은 순서). */
  firstParentRevList(ref: RepoRef, range: RevRange): Promise<readonly string[]>;

  /**
   * 같은 체인을 **커밋 시각과 함께** 준다 (CR-025, DEV-115).
   *
   * `merge_sequence.committed_at`이 `NOT NULL`인데 `firstParentRevList`는
   * SHA만 준다. 시각을 따로 한 번 더 걸어서 인덱스로 짝지으면, 두 호출
   * 사이에 강제 푸시가 나는 순간 **서로 다른 히스토리의 SHA와 시각이 붙는다**
   * — 아무 오류도 나지 않고 값만 틀린다. 그래서 한 번의 walk에서 둘 다 낸다.
   */
  firstParentCommits(ref: RepoRef, range: RevRange): Promise<readonly FirstParentCommit[]>;

  /** 체리픽 판정용 patch-id (FR-REL-005 AC-2). 낼 수 없으면 사유를 함께 준다. */
  patchId(ref: RepoRef, sha: string): Promise<PatchIdResult>;
}

/** 그래프 접근 실패. 채번은 이것을 받으면 시퀀스 공간을 `stale`로 둔다 (FR-SEQ-001 예외 처리). */
export class CommitGraphError extends Error {
  readonly kind: CommitGraphKind;

  constructor(kind: CommitGraphKind, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'CommitGraphError';
    this.kind = kind;
  }
}


/**
 * 저장소별로 어느 경로를 쓸지 고른다 (FR-ING-009 AC-1, ADR-005).
 *
 * **`mirror_enabled`가 유일한 판단 근거다.** 미러가 실제로 있는지를 여기서
 * 확인하지 않는다 — 확인하면 매 호출이 디스크를 때리고, 없으면 어차피
 * `MirrorCommitGraph`가 실패해 호출 측이 폴백한다. 설정과 현실을 여기서
 * 뭉치면 "설정은 켜져 있는데 왜 API로 도나"를 아무도 답할 수 없다.
 */
export function selectCommitGraph(
  repository: { readonly mirror_enabled: boolean },
  graphs: { readonly mirror: CommitGraph; readonly api: CommitGraph },
): CommitGraph {
  return repository.mirror_enabled ? graphs.mirror : graphs.api;
}

/**
 * 미러가 실패하면 API로 넘어가는 그래프 (WP-020 DoD: "미러 fetch 실패 시 API 폴백").
 *
 * **읽기 연산만 폴백한다.** `patchId`는 폴백해도 `no_mirror`가 나오므로
 * 사유가 바뀔 뿐이고, 그 사유가 정확하다 — 미러로 답하지 못한 것이 사실이다.
 */
export class FallbackCommitGraph implements CommitGraph {
  readonly kind = 'mirror' as const;
  readonly #primary: CommitGraph;
  readonly #fallback: CommitGraph;
  readonly #onFallback: ((error: unknown) => void) | undefined;

  constructor(primary: CommitGraph, fallback: CommitGraph, onFallback?: (error: unknown) => void) {
    this.#primary = primary;
    this.#fallback = fallback;
    this.#onFallback = onFallback;
  }

  async #try<T>(run: (graph: CommitGraph) => Promise<T>): Promise<T> {
    try {
      return await run(this.#primary);
    } catch (error) {
      /*
       * **조용히 넘어가지 않는다.** 폴백은 정상 동작이 아니라 성능·정확도가
       * 떨어진 상태이며(patch-id 없음, rate limit 소모), 그것이 계속되면
       * 미러가 죽어 있다는 뜻이다.
       */
      this.#onFallback?.(error);
      return run(this.#fallback);
    }
  }

  resolveHead(ref: RepoRef, branch: string): Promise<string | null> {
    return this.#try((graph) => graph.resolveHead(ref, branch));
  }

  isAncestor(ref: RepoRef, ancestor: string, descendant: string): Promise<boolean> {
    return this.#try((graph) => graph.isAncestor(ref, ancestor, descendant));
  }

  mergeBase(ref: RepoRef, a: string, b: string): Promise<string | null> {
    return this.#try((graph) => graph.mergeBase(ref, a, b));
  }

  firstParentRevList(ref: RepoRef, range: RevRange): Promise<readonly string[]> {
    return this.#try((graph) => graph.firstParentRevList(ref, range));
  }

  firstParentCommits(ref: RepoRef, range: RevRange): Promise<readonly FirstParentCommit[]> {
    return this.#try((graph) => graph.firstParentCommits(ref, range));
  }

  patchId(ref: RepoRef, sha: string): Promise<PatchIdResult> {
    return this.#try((graph) => graph.patchId(ref, sha));
  }
}
