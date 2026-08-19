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
 */
export interface LinkSummary {
  readonly has_revert: boolean;
  readonly has_cherry_pick: boolean;
  readonly reverted_by_count: number;
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
 * 커밋이 PR에서 갖는 역할 (ENT-CORE-003).
 *
 * - `merge`: 대상 브랜치의 머지 커밋. 시퀀스 서수를 갖는다.
 * - `original`: PR 브랜치의 원본 커밋.
 */
export type CommitRole = 'merge' | 'original';

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

/** ENT-REL-002 Link — 관계 간선. 정방향 1건만 저장한다 (ADR-009). */
export interface Link {
  /** `{link_type}:{from_type}:{from_id}:{to_type}:{to_id}`의 결정론적 해시. */
  readonly link_id: string;
  readonly repository_id: RepositoryId;
  readonly from_type: LinkEndpointType;
  readonly from_id: string;
  readonly to_type: LinkEndpointType;
  readonly to_id: string;
  readonly link_type: LinkType;
  readonly confidence: LinkConfidence;
  /** 간선 근거 텍스트. 화면에 항상 함께 표시한다 (FR-REL-003). */
  readonly evidence: string;
  /** 대상이 아직 색인되지 않은 참조는 `false`로 저장한다 (FR-REL-003 AC-3). */
  readonly resolved: boolean;
}
