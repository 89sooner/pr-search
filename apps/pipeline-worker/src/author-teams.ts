/**
 * 작성자 소속 팀 해석과 조직 팀 동기화 (WP-069 / CR-058, FR-STAT-006·FR-SRCH-005).
 *
 * ## 답은 사용자 단위이고 조회는 조직 단위다
 *
 * GHE REST에는 **임의 사용자의 팀 목록을 주는 엔드포인트가 없고** 이 저장소는
 * GraphQL을 쓰지 않는다. 그래서 조직의 팀을 읽고 팀마다 구성원을 읽어
 * `login → team_ids`를 만든다 — 비용이 **조직당 팀 수이고 작성자 수와
 * 무관하다.** 작성자마다 팀 수만큼 소속을 묻는 방식은 `작성자 × 팀`이라 PR이
 * 늘수록 선형으로 늘어난다 (DEV-482).
 *
 * ## 범위는 그 PR 저장소의 조직이다
 *
 * `team`의 유일 제약이 `(org_id, slug)`라 slug은 조직 안에서만 유일하다.
 * 등록된 모든 조직으로 넓히면 판정이 **전 조직의 동기화 상태에 묶여** 한 조직의
 * 실패가 모든 문서를 모름으로 만든다 (DEV-481).
 *
 * ## 세 값이 서로 다른 사실이다
 *
 * 동기화가 신선하고 작성자가 팀에 있으면 그 ID들, 신선한데 어느 팀에도 없으면
 * **빈 배열이 사실의 진술**, 낡았거나 없거나 작성자를 모르면 **모름**이다
 * (DEV-486·487). 모름은 필드를 쓰지 않는 것으로 표현하고, 이미 색인된 옛 값은
 * `UpsertRequest.remove`가 실제로 지운다 (DEV-484).
 *
 * ## 재색인은 이 파일의 동기화를 부르지 않는다
 *
 * `ADR-004`의 불변 조건이 "PostgreSQL 데이터만으로 재구성 가능"이므로 재구축은
 * `resolveAuthorTeams`만 쓴다 — 그 함수는 PostgreSQL만 읽는다 (DEV-485).
 */

import { teamMembershipRepo, orgTeamSyncLockKey, acquireAdvisorySessionLock, releaseAdvisorySessionLock, type Pool } from '@prs/db';
import type { GitHubClient, TeamSummary } from '@prs/github';
import type { AuthorTeamResolution } from './documents.js';

/**
 * 조직 동기화를 낡은 것으로 보는 기준 (DEV-486).
 *
 * **접근 범위 캐시의 5분과 다르다.** 그쪽은 사용자 하나의 조회라 값싸고 권한이라
 * 신선도가 안전 문제지만, 이쪽은 조직 팀 전체를 훑는 조회이고 집계의 축이다 —
 * 그리고 낡음의 대가는 **틀린 값이 아니라 모름**이라 안전한 쪽으로 기운다.
 * 소속 변경의 문서 반영은 재색인·백필이 담당한다 (WP-069 DoD).
 */
export const AUTHOR_TEAM_STALENESS_MS = 60 * 60 * 1000;

/** 조직 팀 동기화가 다른 워커에 막혔을 때 기다리는 상한. */
export const ORG_TEAM_SYNC_LOCK_TIMEOUT_MS = 30_000;

/**
 * 작성자 소속의 판정 결과.
 *
 * **정의는 `documents.ts`가 소유한다** — 그것이 문서 모양을 정하는 값이라 순수
 * 계층에 있어야 실제 데이터베이스 없이 문서를 시험할 수 있다. 여기서는 그 타입을
 * 다시 내보내 부르는 쪽이 한 곳만 알면 되게 한다.
 */
export type { AuthorTeamResolution } from './documents.js';

/** 모름. 없는 값을 지어내 빈 배열로 만들지 않는다. */
export const AUTHOR_TEAMS_UNKNOWN: AuthorTeamResolution = { kind: 'unknown' };

export interface AuthorTeamLogEntry {
  readonly level: 'info' | 'warn' | 'error';
  readonly message: string;
  readonly org_id?: number;
  readonly owner?: string;
  readonly teams?: number;
  readonly members?: number;
  readonly reason?: string;
}

export interface AuthorTeamDeps {
  readonly pool: Pool;
  /** 조직 팀을 GHE에서 읽는다. 없으면 동기화하지 않는다 (재색인 경로). */
  readonly github?: GitHubClient | undefined;
  readonly now?: () => Date;
  readonly stalenessMs?: number;
  readonly log?: (entry: AuthorTeamLogEntry) => void;
}

function nowOf(deps: AuthorTeamDeps): Date {
  return (deps.now ?? ((): Date => new Date()))();
}

function isFresh(syncedAt: Date | null, now: Date, stalenessMs: number): boolean {
  if (syncedAt === null) return false;
  return now.getTime() - syncedAt.getTime() < stalenessMs;
}

/**
 * PostgreSQL만 읽어 작성자들의 소속을 판정한다.
 *
 * **동기화하지 않는다.** 재색인이 이 함수를 쓰므로 여기서 GHE를 부르면
 * `ADR-004`의 재구축 불변 조건이 깨진다 (DEV-485).
 *
 * `logins`에 `null`·빈 문자열이 섞여 오면 그대로 모름이다 — 작성자를 모르는
 * 문서와 소속을 읽지 못한 문서는 다른 사실이지만 **답은 같다** (DEV-487).
 */
export async function resolveAuthorTeams(
  deps: AuthorTeamDeps,
  orgId: number,
  logins: readonly (string | null | undefined)[],
): Promise<Map<string, AuthorTeamResolution>> {
  const named = [...new Set(logins.filter((one): one is string => typeof one === 'string' && one !== ''))];
  const result = new Map<string, AuthorTeamResolution>();
  if (named.length === 0) return result;

  const syncedAt = await teamMembershipRepo.findOrgSyncedAt(deps.pool, orgId);
  if (!isFresh(syncedAt, nowOf(deps), deps.stalenessMs ?? AUTHOR_TEAM_STALENESS_MS)) {
    // 동기화가 낡았으면 **아무것도 안다고 하지 않는다.** 표에 남아 있는 행은
    // 그 시점의 사실이지 지금의 사실이 아니다.
    for (const login of named) result.set(login, AUTHOR_TEAMS_UNKNOWN);
    return result;
  }

  const found = await teamMembershipRepo.findAuthorTeamIds(deps.pool, orgId, named);
  for (const login of named) {
    // 신선한 동기화에서 찾지 못한 작성자는 **팀 0개가 사실**이다 (DEV-486).
    result.set(login, { kind: 'known', teamIds: found.get(login) ?? [] });
  }
  return result;
}

/** 한 작성자만 물을 때의 편의. 이름이 없으면 곧장 모름이다. */
export async function resolveAuthorTeam(
  deps: AuthorTeamDeps,
  orgId: number,
  login: string | null | undefined,
): Promise<AuthorTeamResolution> {
  if (typeof login !== 'string' || login === '') return AUTHOR_TEAMS_UNKNOWN;
  const resolved = await resolveAuthorTeams(deps, orgId, [login]);
  return resolved.get(login) ?? AUTHOR_TEAMS_UNKNOWN;
}

async function readOrgTeams(
  client: GitHubClient,
  owner: string,
): Promise<readonly { teamId: number; slug: string; logins: readonly string[] }[]> {
  const teams: readonly TeamSummary[] = await client.listOrgTeams(owner);
  const snapshots: { teamId: number; slug: string; logins: string[] }[] = [];
  for (const team of teams) {
    const members = await client.listTeamMembers(owner, team.slug);
    snapshots.push({ teamId: team.id, slug: team.slug, logins: members.map((member) => member.login) });
  }
  return snapshots;
}

/**
 * 조직 하나의 팀과 구성원을 GHE에서 다시 읽어 정본에 쓴다.
 *
 * **낡지 않았으면 아무것도 하지 않는다.** 그리고 잠금을 얻은 뒤 신선도를 **다시
 * 본다** — 기다리는 동안 다른 워커가 이미 갱신했으면 같은 조직을 두 번 훑을
 * 이유가 없다.
 *
 * 실패는 던지지 않고 `false`를 돌려준다. 팀을 읽지 못한 것이 **PR을 색인하지
 * 못할 이유는 아니며**, 그때 문서는 모름으로 남는다 (WP-069 실패 격리).
 */
export async function syncOrgTeamsIfStale(
  deps: AuthorTeamDeps,
  org: { readonly orgId: number; readonly owner: string },
): Promise<boolean> {
  const github = deps.github;
  if (github === undefined) return false;

  const staleness = deps.stalenessMs ?? AUTHOR_TEAM_STALENESS_MS;
  if (isFresh(await teamMembershipRepo.findOrgSyncedAt(deps.pool, org.orgId), nowOf(deps), staleness)) {
    return false;
  }

  const client = await deps.pool.connect();
  try {
    const locked = await acquireAdvisorySessionLock(client, orgTeamSyncLockKey(org.orgId), ORG_TEAM_SYNC_LOCK_TIMEOUT_MS);
    if (!locked) {
      deps.log?.({
        level: 'warn',
        message: '다른 워커가 조직 팀 동기화를 쥐고 있어 이번에는 건너뛴다',
        org_id: org.orgId,
        owner: org.owner,
        reason: 'org_team_lock_timeout',
      });
      return false;
    }

    try {
      // 두 번째 확인. 기다리는 동안 상대가 끝냈으면 다시 훑지 않는다.
      if (isFresh(await teamMembershipRepo.findOrgSyncedAt(deps.pool, org.orgId), nowOf(deps), staleness)) {
        return false;
      }

      const snapshots = await readOrgTeams(github, org.owner);
      const written = await teamMembershipRepo.replaceOrgTeamMembership(
        deps.pool,
        org.orgId,
        snapshots,
        nowOf(deps),
      );
      deps.log?.({
        level: 'info',
        message: '조직 팀 소속을 갱신했다',
        org_id: org.orgId,
        owner: org.owner,
        teams: written.teams,
        members: written.members,
      });
      return true;
    } finally {
      await releaseAdvisorySessionLock(client, orgTeamSyncLockKey(org.orgId)).catch(() => undefined);
    }
  } catch (error) {
    /*
     * **조회 실패를 빈 배열로 바꾸지 않는다.** 동기화 시각을 찍지 않았으므로
     * 다음 판정이 모름을 답하고, 이미 색인된 옛 값은 제거된다. 팀을 읽지
     * 못한 것이 PR을 색인하지 못할 이유는 아니다.
     */
    deps.log?.({
      level: 'error',
      message: '조직 팀 소속을 갱신하지 못했다 — 이 조직의 작성자 팀은 모름으로 남는다',
      org_id: org.orgId,
      owner: org.owner,
      reason: String(error).slice(0, 200),
    });
    return false;
  } finally {
    client.release();
  }
}

/** 주기 스윕 간격. 낡음 기준보다 촘촘해야 그 기준이 실제로 지켜진다. */
export const ORG_TEAM_SWEEP_MS = 10 * 60 * 1000;

export interface OrgTeamSweeper {
  stop(): Promise<void>;
}

/**
 * 등록된 조직의 팀 소속을 주기적으로 갱신한다 (WP-069 / CR-058).
 *
 * **`authz` 역할이 소유한다.** 그 역할이 이미 팀 데이터를 소유하고 GHE 자격을
 * 쥐고 있으며 배포되어 있다 — 새 역할을 만들면 `DEV-304`·`DEV-305`가 기록한
 * "코드에는 있으나 배포되지 않는 역할"을 하나 더 만드는 일이 된다.
 *
 * **투영은 이 스윕을 기다리지 않는다.** 갱신이 아직이면 문서가 모름으로 남고,
 * 다음 투영·백필·재색인이 채운다. 그것이 `WP-069`의 실패 격리다 — 팀을 읽지
 * 못한 것이 PR을 색인하지 못할 이유는 아니다.
 *
 * 간격은 낡음 기준보다 **촘촘하다.** 같으면 스윕이 도는 순간마다 이미 낡아 있어
 * 그 사이 투영이 전부 모름을 답한다.
 */
export function startOrgTeamSweeper(
  deps: AuthorTeamDeps & { readonly listOrgs: () => Promise<readonly { readonly orgId: number; readonly owner: string }[]> },
  options: { readonly intervalMs?: number } = {},
): OrgTeamSweeper {
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  const intervalMs = options.intervalMs ?? ORG_TEAM_SWEEP_MS;

  const sweep = async (): Promise<void> => {
    try {
      for (const org of await deps.listOrgs()) {
        if (stopped) return;
        await syncOrgTeamsIfStale(deps, org);
      }
    } catch (error) {
      // 스윕 하나가 실패해도 다음 회차가 다시 한다. 던지면 워커가 죽는다.
      deps.log?.({
        level: 'error',
        message: '조직 팀 스윕이 실패했다 — 다음 회차가 다시 시도한다',
        reason: String(error).slice(0, 200),
      });
    }
  };

  const loop = (): void => {
    if (stopped) return;
    timer = setTimeout(() => {
      void sweep().finally(loop);
    }, intervalMs);
    timer.unref?.();
  };

  // 첫 회차는 곧바로 돈다 — 시작 직후의 투영이 빈 표를 보고 모름을 답하는
  // 구간을 짧게 만든다.
  void sweep().finally(loop);

  return {
    async stop(): Promise<void> {
      stopped = true;
      if (timer !== undefined) clearTimeout(timer);
    },
  };
}
