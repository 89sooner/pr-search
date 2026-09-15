/**
 * API-AUTH-001 `GET /me` (CR-015, DEV-040).
 *
 * 세션의 주인이 누구이고 무엇을 볼 수 있는지 한 번에 알려 준다. 셸이
 * 역할 기반 내비게이션 필터링에 쓴다 (WP-015).
 *
 * **접근 범위는 요약이다. 저장소 ID 목록을 싣지 않는다.** 500개를 넘는
 * 사용자에서 응답이 수십 KB가 되고, 그 목록은 조직의 저장소 인벤토리 그
 * 자체다. 화면은 건수만 필요하다.
 */

import {
  ABSOLUTE_TIMEOUT_MS,
  IDLE_TIMEOUT_MS,
  shouldUseOrgTeamScope,
  type AccessScopeResolver,
  type CachedScope,
} from '@prs/authz';
import type { SessionPrincipal } from './principal.js';

export interface AccessScopeSummary {
  readonly scope_kind: 'explicit' | 'org_team';
  /** `org_team` 모드에서는 `null`이다 — 그 모드는 저장소를 세지 않는다. */
  readonly repository_count: number | null;
  /**
   * `explicit` 모드에서는 `null`이다 — 그 모드의 범위는 조직·팀을 읽지 않는다 (CR-092 / DEV-698).
   * `0`으로 두면 "조직 0개의 구성원"이라는 사실로 읽힌다.
   */
  readonly org_count: number | null;
  readonly team_count: number | null;
  readonly refreshed_at: string;
}

export interface MeResponse {
  readonly user_id: string;
  readonly login: string;
  readonly email: string | null;
  readonly roles: readonly string[];
  readonly access_scope: AccessScopeSummary;
  readonly session: {
    readonly issued_at: string;
    readonly idle_expires_at: string;
    readonly absolute_expires_at: string;
  };
  readonly correlation_id: string;
}

export function summarizeScope(scope: CachedScope): AccessScopeSummary {
  const orgTeam = shouldUseOrgTeamScope(scope.repositoryIds.length);
  return {
    scope_kind: orgTeam ? 'org_team' : 'explicit',
    repository_count: orgTeam ? null : scope.repositoryIds.length,
    org_count: orgTeam ? scope.orgIds.length : null,
    team_count: orgTeam ? scope.teamIds.length : null,
    refreshed_at: new Date(scope.refreshedAt).toISOString(),
  };
}

/**
 * `/me` 응답을 만든다.
 *
 * @throws {ScopeUnavailableError} 접근 범위 조회에 실패하면. **부분 응답을
 * 내지 않는다** — `access_scope`를 비우고 200을 주면 화면이 "볼 수 있는
 * 저장소가 없다"로 읽는다. 503이어야 FLOW-000 5단계가 성립한다.
 */
export async function buildMe(
  principal: SessionPrincipal,
  scopes: Pick<AccessScopeResolver, 'resolveCached'>,
  correlationId: string,
): Promise<MeResponse> {
  const scope = await scopes.resolveCached(principal.userId);
  const session = principal.session;

  return {
    user_id: principal.userId,
    login: principal.login,
    email: session.email,
    roles: principal.roles,
    access_scope: summarizeScope(scope),
    session: {
      issued_at: new Date(session.issuedAt).toISOString(),
      idle_expires_at: new Date(session.lastSeenAt + IDLE_TIMEOUT_MS).toISOString(),
      absolute_expires_at: new Date(session.issuedAt + ABSOLUTE_TIMEOUT_MS).toISOString(),
    },
    correlation_id: correlationId,
  };
}
