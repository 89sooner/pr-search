/**
 * 저장소 팀 접근 범위 동기화 (WP-068 / CR-036, DEV-188~190).
 *
 * ## 왜 패키지에 있나
 *
 * 같은 동기화를 두 곳이 한다 — 저장소 등록(search-api)과 팀 웹훅 처리
 * (pipeline-worker). 앱은 서로를 가져올 수 없으므로 각자 구현하면 **한쪽만
 * 고쳐지는 날**이 오고, 접근 범위에서 그것은 유출이다.
 *
 * ## 정본을 GHE에서 다시 읽는다
 *
 * 첫 구현은 팀 웹훅에서 **PostgreSQL에 이미 있는 값**을 색인에 다시 썼다. 그
 * 값은 회수 사건에서 **아직 제거된 팀을 담고 있으므로**, 회수가 색인에 반영되지
 * 않고 옛 구성원이 문서를 계속 보게 된다 (CR-036, DEV-188). 추가 사건에서는
 * 저장소가 아직 그 팀을 갖고 있지 않아 대상 자체가 발견되지 않았다.
 *
 * 방아쇠가 무엇이든 **GHE가 지금 무엇이라고 답하는지**를 다시 읽는다.
 */

import { authRepo, repositoryRepo } from '@prs/db';
import type { Pool } from '@prs/db';
/**
 * 색인 반영 포트.
 *
 * Elasticsearch 클라이언트 전체가 아니라 이 하나만 받는다 — `scope-source.ts`가
 * `GitHubClient`에 대해 하는 것과 같은 이유다. 시험이 가짜를 만들기 쉽고, 이
 * 패키지가 색인 클라이언트 타입에 묶이지 않는다.
 */
export interface TeamScopeIndex {
  applyRepositoryTeams: (
    repositoryId: number,
    teamIds: readonly number[],
  ) => Promise<{ readonly total: number }>;
}

export interface RepositoryTeamsSource {
  /** GHE가 지금 답하는 "이 저장소에 접근 가능한 팀". */
  listRepositoryTeams: (
    owner: string,
    name: string,
  ) => Promise<readonly { readonly id: number; readonly slug: string }[]>;
}

export interface TeamScopeDeps {
  readonly pool: Pool;
  readonly index: TeamScopeIndex;
  readonly source: RepositoryTeamsSource;
  readonly log?: (entry: { level: 'info' | 'error'; message: string; repository_id?: number; reason?: string }) => void;
}

export interface TeamSyncOutcome {
  readonly repositoryId: number;
  readonly changed: boolean;
  readonly teamIds: readonly number[];
  readonly documentsRefreshed: number;
  /** 색인 반영에 실패해 정본을 되돌렸다. 다음 동기화가 다시 시도한다. */
  readonly rolledBack: boolean;
}

/**
 * 한 저장소의 팀 접근 범위를 GHE 기준으로 맞춘다.
 *
 * ## 색인이 실패하면 정본을 되돌린다 (CR-036, DEV-189)
 *
 * 정본만 바꾸고 색인이 실패하면 다음 동기화는 "바뀐 것이 없다"고 판단해
 * **다시 시도하지 않는다** — 회수된 팀이 색인에 영원히 남는다. 그래서 색인
 * 반영이 실패하면 정본을 이전 값으로 되돌려 **다음 회차가 같은 차이를 다시
 * 보게** 한다. 재시도 경로를 남기는 것이 목적이다.
 */
export async function syncRepositoryTeamScope(
  deps: TeamScopeDeps,
  repository: { readonly repository_id: number; readonly owner: string; readonly name: string; readonly org_id: number },
): Promise<TeamSyncOutcome> {
  const teams = await deps.source.listRepositoryTeams(repository.owner, repository.name);
  for (const team of teams) {
    // `team:` 질의가 slug를 ID로 옮길 수 있어야 한다 (DEV-186).
    await authRepo.upsertTeam(deps.pool, { team_id: team.id, slug: team.slug, org_id: repository.org_id });
  }

  const before = await repositoryRepo.findRepositoryById(deps.pool, repository.repository_id);
  const previous = before?.allowed_team_ids ?? [];
  const teamIds = teams.map((team) => team.id);
  const changed = await repositoryRepo.setAllowedTeams(deps.pool, repository.repository_id, teamIds);

  if (!changed) {
    return { repositoryId: repository.repository_id, changed: false, teamIds, documentsRefreshed: 0, rolledBack: false };
  }

  try {
    const result = await deps.index.applyRepositoryTeams(repository.repository_id, teamIds);
    return {
      repositoryId: repository.repository_id,
      changed: true,
      teamIds,
      documentsRefreshed: result.total,
      rolledBack: false,
    };
  } catch (error) {
    // 되돌려 두어야 다음 동기화가 같은 차이를 다시 보고 재시도한다.
    await repositoryRepo.setAllowedTeams(deps.pool, repository.repository_id, previous);
    deps.log?.({
      level: 'error',
      message: '색인 반영 실패로 팀 접근 범위를 되돌렸다 — 다음 동기화가 다시 시도한다',
      repository_id: repository.repository_id,
      reason: String(error).slice(0, 200),
    });
    return {
      repositoryId: repository.repository_id,
      changed: false,
      teamIds: previous,
      documentsRefreshed: 0,
      rolledBack: true,
    };
  }
}

/**
 * 팀 사건 하나를 처리한다 (CR-036, DEV-188).
 *
 * `repositoryId`가 있으면 **그 저장소**를 본다 — 팀이 새로 추가된 저장소는
 * 아직 정본에 그 팀이 없어 역조회로는 찾을 수 없다. 없으면 그 팀을 현재 갖고
 * 있는 저장소들을 본다(회수·이름 변경처럼 대상이 여럿인 사건).
 */
export async function refreshTeamScope(
  deps: TeamScopeDeps,
  event: { readonly teamId: number | null; readonly repositoryId: number | null },
): Promise<readonly TeamSyncOutcome[]> {
  const targets =
    event.repositoryId !== null
      ? [await repositoryRepo.findRepositoryById(deps.pool, event.repositoryId)].filter(
          (row): row is NonNullable<typeof row> => row !== undefined,
        )
      : event.teamId === null
        ? []
        : await repositoryRepo.findRepositoriesForTeam(deps.pool, event.teamId);

  const outcomes: TeamSyncOutcome[] = [];
  for (const repository of targets) {
    outcomes.push(await syncRepositoryTeamScope(deps, repository));
  }
  return outcomes;
}
