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

/**
 * 한 저장소를 볼 수 있는지 (WP-023 / ADR-008, CR-027 DEV-130).
 *
 * ## 왜 필요한가
 *
 * `applyMandatoryScopeFilter`는 **Elasticsearch를 읽을 때** 접근 범위를 강제한다.
 * 볼 수 없는 저장소의 문서는 매치되지 않으므로 결과에 섞이지 않는다.
 *
 * 그런데 시퀀스 범위 조회는 멤버십을 PostgreSQL `merge_sequence`에서 읽는다
 * (DEV-130). 그 표에는 접근 범위 필터가 걸리지 않으므로, **여기서 명시적으로
 * 막지 않으면 볼 수 없는 저장소의 구간이 그대로 나간다.** 타입 시스템이 지켜
 * 주던 자리가 PostgreSQL 경로에는 없다는 것이 이 함수가 있는 이유다.
 *
 * ## `scopeFilter`와 같은 규칙이어야 한다
 *
 * 그래서 두 함수를 같은 파일에 나란히 둔다. 규칙이 갈라지면 한쪽 경로만 더
 * 넓어지고, 넓어진 쪽은 아무 오류도 내지 않는다.
 *
 * @param allowedTeamIds 저장소가 팀에 개별 허용된 목록. **오늘은 언제나 비어
 * 있다** — `repository.allowed_team_ids` 열이 아직 마이그레이션에 없다(WP-068,
 * DEV-114). 그래서 팀 소속으로만 볼 수 있는 비공개 저장소는 `org_team` 범위에서
 * 거절된다. Elasticsearch 필터도 같은 필드가 비어 있어 같은 결과를 내므로 두
 * 경로가 어긋나지는 않는다. WP-068이 열을 채우면 호출 측이 그 값을 넘긴다.
 */
export function isRepositoryInScope(
  repository: {
    readonly repositoryId: number;
    readonly orgId: number;
    readonly visibility: string;
    readonly allowedTeamIds?: readonly number[];
  },
  scope: AccessScope,
): boolean {
  if (scope.kind === 'explicit') {
    return scope.repositoryIds.includes(repository.repositoryId);
  }

  if (!scope.orgIds.includes(repository.orgId)) return false;
  if (scope.visibilities.includes(repository.visibility)) return true;

  const allowed = repository.allowedTeamIds ?? [];
  return allowed.some((teamId) => scope.teamIds.includes(teamId));
}
