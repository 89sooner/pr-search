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

import {
  acquireAdvisorySessionLock,
  authRepo,
  releaseAdvisorySessionLock,
  repositoryRepo,
  repositoryScopeLockKey,
} from '@prs/db';
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
  readonly log?: (entry: {
    level: 'info' | 'warn' | 'error';
    message: string;
    repository_id?: number;
    reason?: string;
  }) => void;
  /**
   * 락 대기 상한. 넘기면 이 회차를 미룬다 (CR-037, DEV-191).
   *
   * GHE 왕복 하나보다 훨씬 길게 잡는다 — 정상적으로는 도달하지 않고, **락을 쥔 채
   * 멈춘 세션**이 모든 진입점을 영구히 묶지 않게 하는 상한이다.
   */
  readonly lockTimeoutMs?: number;
}

export interface TeamSyncOutcome {
  readonly repositoryId: number;
  readonly changed: boolean;
  readonly teamIds: readonly number[];
  readonly documentsRefreshed: number;
  /** 색인 반영에 실패해 정본을 되돌렸다. 다음 동기화가 다시 시도한다. */
  readonly rolledBack: boolean;
  /**
   * 락을 얻지 못해 이 회차를 미뤘다 (CR-037, DEV-191).
   *
   * 같은 저장소를 다른 동기화가 쥐고 있다는 뜻이다. 그 쪽이 **우리보다 나중에**
   * GHE를 읽으므로 결과는 최소한 우리 것만큼 새롭다. 조정 스캔(JOB-ING-005)이
   * 주기적으로 모든 저장소를 다시 훑으므로 미룬 회차는 스스로 메워진다.
   */
  readonly deferred: boolean;
}

/**
 * 한 저장소의 팀 접근 범위를 GHE 기준으로 맞춘다.
 *
 * ## 저장소 단위로 직렬화한다 (CR-037, DEV-191)
 *
 * 이 함수를 부르는 자리는 셋이다 — 저장소 등록(search-api), 팀 웹훅
 * (pipeline-worker), 조정 스캔(JOB-ING-005). 잠금 없이 두면 셋이 겹칠 때 각자
 * **다른 GHE 스냅숏**을 읽고 조건 없이 덮어쓴다. 늦게 끝난 옛 호출이 새 회수를
 * 되돌려 **이미 제거된 팀 ID가 색인에 복원되고**, 그 팀에서 빠진 사용자가 다음
 * 동기화가 올 때까지 문서를 계속 본다. 권한 스트림은 `team_id`로만 파티션되므로
 * 그 직렬화는 여기에 닿지 않는다.
 *
 * 그래서 **GHE 조회부터 색인 반영까지**를 저장소 단위 세션 advisory lock으로
 * 묶는다. 조회가 락 안에 있는 것이 핵심이다 — 락이 쓰기만 감싸면 두 호출이
 * 여전히 각자 옛 스냅숏을 읽어 놓고 줄만 서서 덮어쓴다.
 *
 * **프로세스 내부 mutex로는 안 된다.** 워커 복제본이 여럿이고 등록 경로는 아예
 * 다른 프로세스다 — 정확성 경계가 프로세스 안에 있지 않다.
 *
 * **GHE 왕복 동안 트랜잭션을 열지 않는다.** 세션 락은 트랜잭션과 수명이
 * 분리되므로 커넥션 하나만 쥐고 네트워크를 기다린다.
 *
 * ## 정본과 색인을 같은 커넥션으로 쓴다
 *
 * 락을 쥔 커넥션이 그대로 정본 쓰기도 한다. 풀에서 두 번째 커넥션을 얻으려 하면
 * 모든 커넥션이 락을 기다리는 상황에서 **교착**이 된다 — 승자가 쓰기용 커넥션을
 * 얻지 못한다.
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
  const repositoryId = repository.repository_id;
  const key = repositoryScopeLockKey(repositoryId);
  const client = await deps.pool.connect();

  try {
    const locked = await acquireAdvisorySessionLock(client, key, deps.lockTimeoutMs);
    if (!locked) {
      deps.log?.({
        level: 'warn',
        message: '다른 동기화가 저장소를 쥐고 있어 팀 접근 범위 갱신을 미뤘다',
        repository_id: repositoryId,
        reason: 'scope_lock_timeout',
      });
      return {
        repositoryId,
        changed: false,
        teamIds: [],
        documentsRefreshed: 0,
        rolledBack: false,
        deferred: true,
      };
    }

    try {
      /*
       * ---- 락 안에서 읽는다. 여기가 이 정정의 핵심이다: 조회가 락 밖에 있으면
       * 두 호출이 각자 옛 스냅숏을 들고 줄만 서게 된다.
       */
      const teams = await deps.source.listRepositoryTeams(repository.owner, repository.name);
      for (const team of teams) {
        // `team:` 질의가 slug를 ID로 옮길 수 있어야 한다 (DEV-186).
        await authRepo.upsertTeam(client, { team_id: team.id, slug: team.slug, org_id: repository.org_id });
      }

      const before = await repositoryRepo.findRepositoryById(client, repositoryId);
      const previous = before?.allowed_team_ids ?? [];
      const teamIds = teams.map((team) => team.id);
      const changed = await repositoryRepo.setAllowedTeams(client, repositoryId, teamIds);

      if (!changed) {
        return { repositoryId, changed: false, teamIds, documentsRefreshed: 0, rolledBack: false, deferred: false };
      }

      try {
        const result = await deps.index.applyRepositoryTeams(repositoryId, teamIds);
        return {
          repositoryId,
          changed: true,
          teamIds,
          documentsRefreshed: result.total,
          rolledBack: false,
          deferred: false,
        };
      } catch (error) {
        // 되돌려 두어야 다음 동기화가 같은 차이를 다시 보고 재시도한다.
        await repositoryRepo.setAllowedTeams(client, repositoryId, previous);
        deps.log?.({
          level: 'error',
          message: '색인 반영 실패로 팀 접근 범위를 되돌렸다 — 다음 동기화가 다시 시도한다',
          repository_id: repositoryId,
          reason: String(error).slice(0, 200),
        });
        return {
          repositoryId,
          changed: false,
          teamIds: previous,
          documentsRefreshed: 0,
          rolledBack: true,
          deferred: false,
        };
      }
    } finally {
      // 세션 락은 반납해도 남는다. 풀지 않으면 이 커넥션을 다음에 쓰는 쪽이
      // 영원히 잠긴 키를 물려받는다.
      await releaseAdvisorySessionLock(client, key).catch(() => undefined);
    }
  } finally {
    client.release();
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
