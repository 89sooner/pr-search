/**
 * 연동 조회의 서버 내부 문맥 (CR-112 / 공통 계약 6.3, 지시서 8절, PSI-D01·D04·D08·D09).
 *
 * ## 권한은 기존 엔진이 정한다
 *
 * grant에 저장소 목록을 복사해 5분간 믿는 새 권한 엔진을 만들지 않는다. 매 요청 기존
 * `AccessScopeResolver.resolveCached`(5분 캐시·버전 울타리·만료 캐시 거부·GHE 실패 시 503)를 부르고,
 * 그 결과와 client 허용 목록의 **교집합**을 조회 전에 만든다.
 *
 * ## 교집합은 언제나 명시적 저장소 목록이다
 *
 * `CachedScope.repositoryIds`는 두 표현(`explicit`·`org_team`) 모두에서 GHE 실효 read 권한을 가진
 * 등록 저장소 전부를 담는다(`scope-source.ts`). 허용 목록은 500개 이하(config)라 교집합도 500개
 * 이하이고, `toAccessScope`가 늘 `explicit`로 옮긴다 — 필수 필터·`isRepositoryInScope`·커서 지문이
 * 그대로 그 목록을 쓴다.
 *
 * 사용자의 범위가 `org_team` 표현이면 일반 경로의 결과 집합은 조직·가시성·팀 조건이 정한다. 두 표현이
 * 어긋나는 가장자리(외부 협업자 등)에서 연동이 일반 경로보다 넓어지지 않도록, 그때는 저장소 행으로
 * `isRepositoryInScope`를 한 번 더 건다. 결과는 **둘 다를 만족하는** 저장소뿐이다 (fail closed).
 *
 * 이 모듈의 값은 grant 검증 뒤 서버가 만든다. 네트워크 입력으로 만들지 않는다.
 */

import { ScopeUnavailableError, toAccessScope, type AccessScopeResolver, type CachedScope } from '@prs/authz';
import { pipeIntegrationRepo, type Pool } from '@prs/db';
import { isRepositoryInScope } from '@prs/es';
import type { ReadInvocation, ReadPrincipal } from '../../auth/read-invocation.js';
import type { PipeClientPolicy } from './config.js';

export interface EffectiveScopeDeps {
  readonly scopes: Pick<AccessScopeResolver, 'resolveCached'>;
  readonly pool: Pool;
}

/**
 * 사용자 범위 ∩ client 허용 목록.
 *
 * @throws {ScopeUnavailableError} 기존 해석기와 같다 — 503 `PERMISSION_UNAVAILABLE`로 옮겨진다.
 *   교집합이 비는 것은 실패가 아니다: 빈 목록이 그대로 나가고, 기존 실행 함수가 **0개 저장소 사용자에게
 *   원래 답하던 대로** 답한다 (FR-AUTH-002 AC-3의 기본 거부) —
 *   `search`·`resolve`·PR 상세·커밋 상세는 필수 필터가 던져 **503 `PERMISSION_UNAVAILABLE`**,
 *   `repositories`는 **200 빈 페이지**, `source` 4종과 `merge-numbers/resolve`는 **404 `NOT_FOUND`**
 *   (`isRepositoryInScope`). 이 표는 handoff `CONTRACT_DIFF.md` D-01에 그대로 있다.
 */
export async function resolveEffectiveScope(
  deps: EffectiveScopeDeps,
  userId: string,
  client: Pick<PipeClientPolicy, 'repositoryIds'>,
): Promise<CachedScope> {
  const cached = await deps.scopes.resolveCached(userId);
  const allowed = new Set(client.repositoryIds);
  let ids = [...new Set(cached.repositoryIds.filter((id) => allowed.has(id)))];

  const userScope = toAccessScope(cached);
  if (userScope.kind === 'org_team' && ids.length > 0) {
    // 저장소 행을 읽지 못하면 범위를 확인하지 못한 것이다 — 기존 해석기의 실패와 같은 오류로 올린다.
    let rows: Awaited<ReturnType<typeof pipeIntegrationRepo.findRepositoryScopeRows>>;
    try {
      rows = await pipeIntegrationRepo.findRepositoryScopeRows(deps.pool, ids);
    } catch {
      throw new ScopeUnavailableError('연동 허용 저장소의 가시성 재료를 읽지 못했다');
    }
    const visible = new Set(
      rows
        .filter((row) =>
          isRepositoryInScope(
            {
              repositoryId: row.repository_id,
              orgId: row.org_id,
              visibility: row.visibility,
              allowedTeamIds: row.allowed_team_ids,
            },
            userScope,
          ),
        )
        .map((row) => row.repository_id),
    );
    ids = ids.filter((id) => visible.has(id));
  }

  return {
    repositoryIds: ids.sort((a, b) => a - b),
    orgIds: [],
    teamIds: [],
    visibilities: [],
    refreshedAt: cached.refreshedAt,
    // 커서 지문의 재료다 — 권한이 회수되면 사용자 범위의 버전이 오르고 진행 중 페이징이 죽는다.
    version: cached.version,
  };
}

export interface IntegrationPrincipalInput {
  readonly correlationId: string;
  readonly prsUserId: string;
  readonly client: Pick<PipeClientPolicy, 'clientId' | 'repositoryIds'>;
}

/**
 * 연동 경로의 `ReadInvocation`.
 *
 * `cursorBinding`에 client와 canonical 사용자를 넣는다 — 우연히 범위가 같은 다른 사용자·다른 client의
 * 커서를 받지 않는다. 일반 경로의 커서 지문은 결속이 없어 바뀌지 않는다 (추가 전용).
 */
export function integrationInvocation(input: IntegrationPrincipalInput, deps: EffectiveScopeDeps): ReadInvocation {
  let memo: Promise<CachedScope> | undefined;
  const cached = (): Promise<CachedScope> => {
    memo ??= resolveEffectiveScope(deps, input.prsUserId, input.client);
    return memo;
  };
  const principal: ReadPrincipal = {
    userId: input.prsUserId,
    resolveScope: async () => toAccessScope(await cached()),
    resolveCachedScope: cached,
    cursorBinding: `pipe:${input.client.clientId}:${input.prsUserId}`,
  };
  return { correlationId: input.correlationId, identify: () => Promise.resolve(principal) };
}
