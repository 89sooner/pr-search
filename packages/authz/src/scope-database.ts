/**
 * `ScopeDatabase` 포트의 PostgreSQL 어댑터.
 *
 * `@prs/db`의 `authRepo`를 접근 범위 저장소 모양으로 맞춘다. 포트 옆에 두는
 * 이유는 둘이 함께 바뀌기 때문이다 — `CachedScope`에 필드가 하나 늘면 이
 * 파일과 `permission_cache` 열이 같이 움직여야 한다.
 */

import { authRepo, type Pool, type PoolClient } from '@prs/db';
import { shouldUseOrgTeamScope } from '@prs/es';
import type { CachedScope, ScopeDatabase } from './scope.js';

export function createScopeDatabase(db: Pool | PoolClient): ScopeDatabase {
  return {
    readUser: async (userId) => {
      const row = await authRepo.findUserById(db, userId);
      return row === null ? null : { login: row.login, version: row.access_scope_version };
    },

    readCache: async (userId) => {
      const row = await authRepo.findPermissionCache(db, userId);
      if (row === null) return null;
      return {
        repositoryIds: row.repository_ids ?? [],
        orgIds: row.org_ids ?? [],
        teamIds: row.team_ids ?? [],
        visibilities: row.visibilities,
        refreshedAt: row.refreshed_at.getTime(),
        version: row.access_scope_version,
      } satisfies CachedScope;
    },

    writeCache: async (userId, scope) =>
      authRepo.writePermissionCache(db, {
        user_id: userId,
        /*
         * `scope_kind`는 **읽는 쪽이 실제로 쓸 모드**여야 한다.
         *
         * 저장소 목록은 두 모드 모두에 담는다 — 임계를 오갈 때 GHE를 다시
         * 부르지 않기 위해서다. 그러나 이 열은 `toAccessScope`가 고를 값과
         * 같아야 한다: `repository` 웹훅의 영향 사용자 조회가
         * `scope_kind = 'org_team'`으로 거르기 때문이다 (CR-015, DEV-045).
         * 틀리면 그 사용자들이 무효화에서 통째로 빠진다.
         */
        scope_kind: shouldUseOrgTeamScope(scope.repositoryIds.length) ? 'org_team' : 'explicit',
        repository_ids: scope.repositoryIds,
        org_ids: scope.orgIds,
        team_ids: scope.teamIds,
        visibilities: scope.visibilities,
        expected_version: scope.version,
      }),
  };
}
