/**
 * 실행 대상 컨텍스트 (API-GH-003 / FR-GH-004 AC-1, ADR-008).
 *
 * 사용자가 고를 수 있는 저장소는 **등록·활성 저장소 ∩ 접근 범위**다. 접근 범위의
 * 정본은 `AccessScopeResolver`이며 여기서 새로 판정하지 않는다 — 검색과 같은 함수로
 * 같은 답을 낸다. 클라이언트가 보낸 저장소 문자열은 이 목록에 대조하는 재료일 뿐이고,
 * 목록에 없으면 「없다」다 (404 — 존재 여부를 드러내지 않는다, THR-004).
 */

import { repositoryRepo, type Pool, type RepositoryRow } from '@prs/db';
import { shouldUseOrgTeamScope, type CachedScope } from '@prs/authz';

export interface RepositoryContext {
  readonly repositoryId: number;
  readonly owner: string;
  readonly name: string;
  readonly slug: string;
  readonly visibility: RepositoryRow['visibility'];
}

/** 접근 범위가 이 저장소를 허용하는가 — `applyMandatoryScopeFilter`와 같은 의미다. */
export function scopeAllowsRepository(scope: CachedScope, repository: RepositoryRow): boolean {
  if (shouldUseOrgTeamScope(scope.repositoryIds.length)) {
    if (scope.orgIds.includes(repository.org_id)) return true;
    return repository.allowed_team_ids.some((teamId) => scope.teamIds.includes(teamId));
  }
  return scope.repositoryIds.includes(repository.repository_id);
}

export async function listVisibleRepositories(pool: Pool, scope: CachedScope): Promise<RepositoryContext[]> {
  const rows = await repositoryRepo.listRepositories(pool, { status: 'active' });
  return rows
    .filter((row) => scopeAllowsRepository(scope, row))
    .map((row) => ({
      repositoryId: row.repository_id,
      owner: row.owner,
      name: row.name,
      slug: `${row.owner}/${row.name}`,
      visibility: row.visibility,
    }))
    .sort((a, b) => a.slug.localeCompare(b.slug));
}

/** 슬러그 하나를 해석한다. 없거나 볼 수 없으면 `null` — 둘을 구분하지 않는다. */
export async function resolveRepositoryContext(
  pool: Pool,
  scope: CachedScope,
  slug: { readonly owner: string; readonly name: string },
): Promise<RepositoryContext | null> {
  const row = await repositoryRepo.findRepositoryBySlug(pool, slug.owner, slug.name);
  if (row === undefined || row.status !== 'active') return null;
  if (!scopeAllowsRepository(scope, row)) return null;
  return { repositoryId: row.repository_id, owner: row.owner, name: row.name, slug: `${row.owner}/${row.name}`, visibility: row.visibility };
}
