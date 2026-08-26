/**
 * 핵심 도메인 타입 골격.
 *
 * 출처: 데이터 모델 2장 엔티티 카탈로그. WP-001에서는 타입만 두고 로직은 두지 않는다.
 */

import type { LinkConfidence, LinkEndpointType, LinkType } from './links.js';

export type RepositoryId = number;
export type OrgId = number;
export type TeamId = number;

/** 저장소 가시성. 접근 범위 필터가 사용한다 (ADR-008). */
export type RepositoryVisibility = 'public' | 'internal' | 'private';

/** 저장소 수집 상태 (ENT-CORE-001, FR-ING-009). */
export type RepositoryStatus = 'active' | 'paused' | 'archived';

/** ENT-CORE-001 Repository — 수집 대상 저장소 등록과 정책. */
export interface Repository {
  readonly repository_id: RepositoryId;
  readonly owner: string;
  readonly name: string;
  readonly org_id: OrgId;
  readonly visibility: RepositoryVisibility;
  /** 시퀀스를 채번하는 기준 브랜치 목록. 최대 `MAX_SEQUENCE_BRANCHES`개. */
  readonly sequence_branches: readonly string[];
  readonly mirror_enabled: boolean;
  readonly status: RepositoryStatus;
}

/** PR 상태 (ENT-CORE-002). */
export type PullRequestState = 'open' | 'closed' | 'merged';

/**
 * 목록 화면의 관계 배지를 간선 인덱스 조회 없이 그리기 위한 비정규화 필드 (ADR-009).
 *
 * **leaf마다 소유 WP가 다르다** (CR-039, DEV-222). `reference_count`는 WP-029,
 * 나머지 넷은 WP-030이다. 그래서 이 객체는 **통째로 대입하면 안 된다** — 한
 * 워커가 자기 값을 쓰면서 다른 워커의 값을 지우게 된다.
 *
 * `has_stack`은 PR 문서에만 있다. 커밋은 스택 관계의 끝점이 아니다.
 */
export interface LinkSummary {
  readonly has_revert: boolean;
  readonly is_reverted: boolean;
  readonly has_cherry_pick: boolean;
  readonly has_stack?: boolean;
  readonly reference_count: number;
}

/** ENT-CORE-002 PullRequest — PR 검색 문서. */
export interface PullRequest {
  readonly repository_id: RepositoryId;
  readonly pr_number: number;
  readonly title: string;
  readonly body: string;
  readonly author: string;
  readonly state: PullRequestState;
  readonly merged_at: string | null;
  readonly merge_commit_sha: string | null;
  /** 머지 시퀀스 서수. 미머지 PR은 `null`이다 (오류 코드 `NO_SEQUENCE`). */
  readonly merge_seq: number | null;
  readonly link_summary: LinkSummary;
}

/**
 * 커밋이 대상 브랜치에서 갖는 역할 (ENT-CORE-003).
 *
 * - `merge_commit`: 대상 브랜치의 머지 커밋. 시퀀스 서수를 갖는다.
 * - `source_commit`: PR 브랜치의 원본 커밋. first-parent 체인 밖이다.
 * - `direct_push`: PR 없이 대상 브랜치에 들어온 first-parent 커밋 (CR-038, DEV-207).
 *
 * **CR-039로 정정했다 (DEV-225).** 이 타입은 `'merge' | 'original'`이었는데 어느
 * 코드도 그 값을 쓰지 않는다 — 투영은 `documents.ts`가 **자기 `CommitRole`을 따로
 * 정의해** 썼고, 그래서 타입 검사가 이 드리프트를 잡지 못했다. 정의를 하나로 모은다.
 */
export type CommitRole = 'merge_commit' | 'source_commit' | 'direct_push';

/** ENT-CORE-003 Commit — 커밋 검색 문서. */
export interface Commit {
  readonly repository_id: RepositoryId;
  readonly commit_sha: string;
  readonly message: string;
  readonly author: string;
  readonly role: CommitRole;
  readonly merge_seq: number | null;
  /** `git patch-id` 값. 체리픽 탐지에 사용한다 (ADR-005, FR-REL-005). */
  readonly patch_id: string | null;
  readonly changed_paths: readonly string[];
}

/** 시퀀스 공간 상태 (ENT-SEQ-002, FR-SEQ-005). */
export type SequenceSpaceState = 'healthy' | 'rebuilding' | 'diverged';

/**
 * ENT-SEQ-002 SequenceSpace — `(repository_id, base_branch)` 단위 시퀀스 공간 상태.
 *
 * 시퀀스 값은 이 공간 안에서만 의미가 있다. 공간이 다르면 비교할 수 없다 (ADR-007).
 * 대상 브랜치 강제 푸시는 `seq_epoch`를 올려 과거 범위 인용을 무효화한다.
 */
export interface SequenceSpace {
  readonly repository_id: RepositoryId;
  readonly base_branch: string;
  readonly seq_epoch: number;
  readonly head_sha: string | null;
  readonly head_seq: number | null;
  readonly state: SequenceSpaceState;
  readonly last_assigned_at: string | null;
}

/**
 * ENT-REL-002 Link — 관계 간선. 정방향 1건만 저장한다 (ADR-009).
 *
 * **접근 통제 material은 근거를 소유한 저장소(`from` 쪽)의 것이다** (CR-039, THR-034).
 * 간선이 다른 저장소를 가리킬 수 있으므로, 대상의 **내용**을 반환하는 조회는
 * 대상 저장소 접근 범위를 다시 교집합해야 한다 — 간선을 볼 수 있다는 것이
 * 대상을 볼 수 있다는 뜻은 아니다.
 */
export interface Link {
  /**
   * 결정론적 해시. **재료가 간선 유형에 따라 다르다** (CR-039, DEV-217).
   *
   * - `references`: `{link_type}:{from_type}:{from_id}:{reference_key}`
   * - 그 밖: `{link_type}:{from_type}:{from_id}:{to_type}:{to_id}`
   *
   * 참조 간선이 대상을 재료로 쓰지 않는 이유는 대상이 **해결 과정에서 바뀌기**
   * 때문이다. 축약 SHA 참조가 해결되면 `to_id`가 40자로 바뀌고, ID가 함께
   * 바뀌면 FR-REL-003 AC-3이 요구하는 "같은 간선을 갱신"이 성립하지 않는다.
   */
  readonly link_id: string;
  /** 접근 통제 material. 문서 생성 시점에 함께 넣는다 (ADR-008, THR-035). */
  readonly repository_id: RepositoryId;
  readonly org_id: number;
  readonly visibility: string;
  readonly allowed_team_ids: readonly number[];

  readonly from_type: LinkEndpointType;
  readonly from_id: string;
  /** 미해결 `references` 간선에는 없다 — 아직 무엇을 가리키는지 모른다. */
  readonly to_type?: LinkEndpointType;
  readonly to_id?: string;
  /** 대상 저장소가 해석된 시점에 채운다 (WP-029). */
  readonly to_repository_id?: number;

  readonly link_type: LinkType;
  /** `references` 간선의 안정 참조 식별자. 다른 유형에는 없다. */
  readonly reference_key?: string;
  readonly confidence: LinkConfidence;
  /** 간선 근거 텍스트. 화면에 항상 함께 표시한다 (FR-REL-003). */
  readonly evidence: string;
  /** 대상이 아직 색인되지 않은 참조는 `false`로 저장한다 (FR-REL-003 AC-3). */
  readonly resolved: boolean;
  /** WP-030 소유. WP-029는 이 필드를 두지 않는다 (CR-039, DEV-223). */
  readonly detached?: boolean;
  readonly created_at: string;
}
