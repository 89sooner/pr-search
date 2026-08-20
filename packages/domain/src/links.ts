/**
 * 관계 간선의 유형과 신뢰도 어휘.
 *
 * 출처: ADR-009, 데이터 모델 4.3, glossary `link_confidence`.
 */

/** 간선 유형 어휘 전체. `precedes`와 `co_changes`는 어휘에는 있으나 저장하지 않는다. */
export const LINK_TYPES = [
  'contains',
  'precedes',
  'references',
  'reverts',
  'cherry_picks',
  'stacks_on',
  'co_changes',
] as const;

export type LinkType = (typeof LINK_TYPES)[number];

/**
 * 실제로 `prs-links` 인덱스에 저장되는 간선 유형 (데이터 모델 4.3).
 *
 * - `precedes`는 시퀀스 값 비교로 계산한다 (FR-REL-001).
 * - `co_changes`는 조회 시점에 `changed_paths` 교집합으로 계산한다 (FR-REL-007).
 */
export const STORED_LINK_TYPES = [
  'contains',
  'references',
  'reverts',
  'cherry_picks',
  'stacks_on',
] as const;

export type StoredLinkType = (typeof STORED_LINK_TYPES)[number];

/** 저장하지 않고 조회 시점에 계산하는 간선 유형. */
export const COMPUTED_LINK_TYPES = ['precedes', 'co_changes'] as const;

export type ComputedLinkType = (typeof COMPUTED_LINK_TYPES)[number];

/**
 * 간선 근거의 확실성 (glossary `link_confidence`).
 *
 * - `exact`: SHA 일치
 * - `derived`: 구조 파생
 * - `heuristic`: 텍스트 추정
 */
export const LINK_CONFIDENCES = ['exact', 'derived', 'heuristic'] as const;

export type LinkConfidence = (typeof LINK_CONFIDENCES)[number];

/** 간선 양 끝점의 엔티티 유형. */
export const LINK_ENDPOINT_TYPES = ['pull_request', 'commit', 'release', 'issue'] as const;

export type LinkEndpointType = (typeof LINK_ENDPOINT_TYPES)[number];

export function isStoredLinkType(value: LinkType): value is StoredLinkType {
  return (STORED_LINK_TYPES as readonly string[]).includes(value);
}

export function isComputedLinkType(value: LinkType): value is ComputedLinkType {
  return (COMPUTED_LINK_TYPES as readonly string[]).includes(value);
}
