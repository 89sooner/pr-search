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

/**
 * 아카이브 인덱스용 접근 범위 필터 (FR-ING-010 AC-6, CR-052).
 *
 * ## 왜 `applyMandatoryScopeFilter`를 그대로 쓰지 않는가
 *
 * 그 함수의 `org_team` 갈래는 `org_id`·`visibility`·`allowed_team_ids`를 읽는데
 * **아카이브 문서에는 그 셋이 없다.** 웹훅 수신 시점에 알 수 없는 값이고, 담아
 * 두더라도 저장소의 가시성이나 팀 허용이 바뀌는 순간 낡는다 — 낡은 접근 통제
 * 재료는 그 자체가 유출 경로다.
 *
 * 그래서 **같은 저장소 집합을 `explicit` 표현으로 고정해서** 건다. `CachedScope`는
 * 크기와 무관하게 언제나 `repositoryIds`를 들고 있고, `toAccessScope`가 500개를
 * 넘을 때만 조직·팀 조건으로 치환하는데 그 치환은 **결과 집합이 같아야 한다**는
 * 규칙 아래 있다 (보안 문서 5.2). 따라서 규칙이 두 곳에 사는 것이 아니다 —
 * 같은 집합의 다른 표현이며, 아카이브는 그중 하나만 쓸 수 있을 뿐이다.
 *
 * 미등록 저장소의 문서는 `repository_id`가 없어 이 `terms`에 걸리지 않는다.
 * 그것이 옳다 — 어떤 접근 범위에도 속하지 않으므로 조회되면 안 되고, 내주면
 * 그 응답이 곧 존재 신탁이 된다 (`FR-AUTH-002` AC-4).
 */
export function applyArchiveScopeFilter(
  query: estypes.QueryDslQueryContainer,
  repositoryIds: readonly number[],
): ScopedQuery {
  if (repositoryIds.length === 0) {
    throw new AccessScopeUnavailableError('접근 가능한 저장소가 없다');
  }

  const filter: estypes.QueryDslQueryContainer = {
    terms: { repository_id: [...repositoryIds] },
  };

  return {
    bool: {
      must: [query],
      filter: [filter],
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
 ## `allowedTeamIds`는 선택이 아니다 (CR-050, DEV-353)
 *
 * 이 인자는 v0.5까지 선택이었고 기본값이 빈 배열이었다. 그래서 호출부가
 * 빠뜨리면 **오류 없이 조용히 좁게 답했다** — `org_team` 범위에서 팀 소속으로만
 * 허용되는 비공개 저장소가 결과에서 사라진다. fail-closed라 유출은 아니지만,
 * 사용자에게는 "그 저장소가 없다"는 **틀린 사실**로 보이고 W-009에서는 그것이
 * 곧 "등록되지 않았다"는 틀린 진단이 된다.
 *
 * WP-068이 `repository.allowed_team_ids`를 채운 뒤에도 두 호출부가 stale 주석과
 * 함께 그 값을 넘기지 않고 있었다. **결과를 재는 시험은 이것을 잡지 못한다** —
 * 넘어간 재료를 봐야 잡힌다. 그래서 인자를 필수로 만들어 컴파일러가 먼저
 * 잡게 하고, 회귀가 `explicit`/`org_team` parity를 함께 건다.
 *
 * @param allowedTeamIds 저장소가 팀에 개별 허용된 목록(`repository.allowed_team_ids`).
 * 팀 개별 허용이 없는 저장소는 빈 배열을 **명시적으로** 넘긴다.
 */
export function isRepositoryInScope(
  repository: {
    readonly repositoryId: number;
    readonly orgId: number;
    readonly visibility: string;
    readonly allowedTeamIds: readonly number[];
  },
  scope: AccessScope,
): boolean {
  if (scope.kind === 'explicit') {
    return scope.repositoryIds.includes(repository.repositoryId);
  }

  if (!scope.orgIds.includes(repository.orgId)) return false;
  if (scope.visibilities.includes(repository.visibility)) return true;

  return repository.allowedTeamIds.some((teamId) => scope.teamIds.includes(teamId));
}
