/**
 * 필수 접근 범위 필터 (ADR-008, FR-AUTH-002).
 *
 * 모든 Elasticsearch 조회는 이 파일의 `applyMandatoryScopeFilter`를 거친다.
 * 거치지 않은 질의는 `ScopedQuery`가 아니고, `search`는 `ScopedQuery`만 받는다.
 * 즉 필터 누락이 런타임 버그가 아니라 **컴파일 오류**가 된다.
 *
 * WP-003은 타입 경계와 결합 규칙만 세운다. 접근 범위를 실제로 조회하는 부분
 * (GHE 권한 API, Redis 캐시, 500개 초과 시 org_team 치환)은 WP-012가 채운다.
 */

import type { estypes } from '@elastic/elasticsearch';

declare const scopedBrand: unique symbol;

/**
 * 접근 범위 필터가 결합된 질의.
 *
 * 이 타입은 `applyMandatoryScopeFilter`만 만들 수 있다. 다른 곳에서 값을 만들어
 * 넣으려면 명시적 캐스팅이 필요하고, 그 캐스팅은 코드 리뷰와 아키텍처 테스트에서
 * 드러난다.
 */
export type ScopedQuery = estypes.QueryDslQueryContainer & { readonly [scopedBrand]: true };

/** ADR-008 AC-6: 접근 범위가 이 수를 넘으면 `terms` 목록 대신 조직·팀 조건으로 치환한다. */
export const EXPLICIT_SCOPE_LIMIT = 500;

/** 명시적 저장소 목록으로 표현된 접근 범위. */
export interface ExplicitAccessScope {
  readonly kind: 'explicit';
  readonly repositoryIds: readonly number[];
}

/** 저장소 수가 많아 조직·팀 조건으로 치환된 접근 범위. */
export interface OrgTeamAccessScope {
  readonly kind: 'org_team';
  readonly orgIds: readonly number[];
  readonly teamIds: readonly number[];
  /** 조직 안에서 이 가시성까지는 팀 소속 없이도 볼 수 있다. */
  readonly visibilities: readonly string[];
}

export type AccessScope = ExplicitAccessScope | OrgTeamAccessScope;

/** 접근 범위를 확인할 수 없는 상태. 기본 거부의 근거다. */
export class AccessScopeUnavailableError extends Error {
  constructor(reason: string) {
    super(`접근 범위를 확인할 수 없다: ${reason}`);
    this.name = 'AccessScopeUnavailableError';
  }
}

function scopeFilter(scope: AccessScope): estypes.QueryDslQueryContainer {
  if (scope.kind === 'explicit') {
    return { terms: { repository_id: [...scope.repositoryIds] } };
  }

  return {
    bool: {
      filter: [{ terms: { org_id: [...scope.orgIds] } }],
      minimum_should_match: 1,
      should: [
        { terms: { visibility: [...scope.visibilities] } },
        { terms: { allowed_team_ids: [...scope.teamIds] } },
      ],
    },
  };
}

/**
 * 사용자 질의에 접근 범위 필터를 결합한다.
 *
 * 결합은 `must`가 아니라 `filter`다. 접근 범위는 점수에 영향을 주면 안 되고,
 * filter 절은 캐시된다.
 *
 * @throws {AccessScopeUnavailableError} 범위가 비어 있으면 던진다. 빈 목록으로
 * 조회하면 0건이 반환되는데, 그것은 "권한이 없다"와 "결과가 없다"를 구분하지
 * 못하게 만든다. 기본 거부는 명시적 실패여야 한다 (FR-AUTH-002 AC-3).
 */
export function applyMandatoryScopeFilter(
  query: estypes.QueryDslQueryContainer,
  scope: AccessScope,
): ScopedQuery {
  if (scope.kind === 'explicit' && scope.repositoryIds.length === 0) {
    throw new AccessScopeUnavailableError('접근 가능한 저장소가 없다');
  }
  if (scope.kind === 'org_team' && scope.orgIds.length === 0) {
    throw new AccessScopeUnavailableError('접근 가능한 조직이 없다');
  }

  return {
    bool: {
      must: [query],
      filter: [scopeFilter(scope)],
    },
  } as ScopedQuery;
}

/** 접근 범위가 명시적 목록으로 표현 가능한 크기인지 판정한다 (ADR-008 AC-6). */
export function shouldUseOrgTeamScope(repositoryCount: number): boolean {
  return repositoryCount > EXPLICIT_SCOPE_LIMIT;
}
