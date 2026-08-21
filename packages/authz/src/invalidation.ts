/**
 * 권한 캐시 무효화 (FR-AUTH-003 AC-2, AC-4 / EVT-AUTH-001 / JOB-AUTH-001).
 *
 * **게이트웨이는 펼치지 않는다 (CR-015, DEV-041·DEV-042).** 웹훅이 준 것만
 * 싣고, 팀을 구성원으로 펼치거나 저장소를 사용자로 펼치는 일은 전부 소비자가
 * 한다. 수신 경로에 GHE 동기 호출을 넣으면 NFR-002의 수신 p95 300ms가 그대로
 * 무너지기 때문이다.
 *
 * 무효화가 하는 일은 셋이고, 셋이 함께 일어나야 한다.
 *   1. Redis 키 삭제
 *   2. `permission_cache` 행 삭제
 *   3. `app_user.access_scope_version` 증가 — 진행 중인 갱신을 막는 울타리
 *
 * 2와 3이 갈라지면 회수가 새어 나간다. 버전만 올리고 행이 남으면 다음 조회가
 * 낡은 행을 쓰고, 행만 지우고 버전이 그대로면 진행 중이던 갱신이 낡은 값을
 * 다시 써 넣는다 (CR-015, DEV-044).
 */

/**
 * EVT-AUTH-001 payload. 세 대상 필드는 모두 선택이며 하나 이상이 있어야 한다.
 *
 * **`user_ids`는 GHE 숫자 사용자 id다** (CR-015, DEV-043). 게이트웨이는 OIDC
 * `sub`를 모른다 — 그것은 로그인이 만드는 값이고, 웹훅에는 GHE 신원만 온다.
 * 소비자가 `app_user.github_user_id`로 옮긴다.
 */
export interface PermissionInvalidated {
  readonly user_ids?: readonly number[];
  /** 숫자 id가 없는 이벤트의 폴백. login은 개명될 수 있으므로 뒤에 쓴다. */
  readonly logins?: readonly string[];
  readonly team_id?: number | null;
  readonly repository_id?: number | null;
  readonly reason: string;
}

export type InvalidationReason = 'member' | 'team' | 'repository' | 'manual';

/** 웹훅에서 뽑아낸 무효화 대상. 아직 펼치지 않은 상태다. */
export interface InvalidationTarget {
  readonly reason: InvalidationReason;
  /** GHE login. `member` 웹훅이 준다. */
  readonly logins: readonly string[];
  /** GHE 숫자 사용자 id. login보다 우선한다 (CR-015, DEV-043). */
  readonly githubUserIds: readonly number[];
  readonly teamId: number | null;
  readonly teamSlug: string | null;
  readonly org: string | null;
  readonly orgId: number | null;
  readonly repositoryId: number | null;
}

const EMPTY_TARGET: InvalidationTarget = {
  reason: 'manual',
  logins: [],
  githubUserIds: [],
  teamId: null,
  teamSlug: null,
  org: null,
  orgId: null,
  repositoryId: null,
};

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : null;
}

/**
 * `member`/`team`/`repository` 웹훅에서 무효화 대상을 뽑는다.
 *
 * 이 세 유형만 다룬다 (FR-AUTH-003 AC-2). 다른 유형이면 `null`이다.
 *
 * **모양이 다르면 조용히 빈 대상을 만들지 않는다.** 아무도 무효화하지 않는
 * 무효화가 성공으로 기록되면, 권한 회수가 반영되지 않은 채로 지표만 깨끗해진다.
 */
export function extractInvalidationTarget(eventType: string, payload: unknown): InvalidationTarget | null {
  const root = record(payload);
  if (root === undefined) return null;

  const organization = record(root['organization']);
  const org = str(organization?.['login']);
  const orgId = num(organization?.['id']);

  if (eventType === 'member') {
    // 저장소 협업자 추가·제거. `member`가 대상 사용자다.
    const member = record(root['member']);
    const login = str(member?.['login']);
    const id = num(member?.['id']);
    if (login === null && id === null) return null;

    return {
      ...EMPTY_TARGET,
      reason: 'member',
      logins: login === null ? [] : [login],
      githubUserIds: id === null ? [] : [id],
      org,
      orgId,
      repositoryId: num(record(root['repository'])?.['id']),
    };
  }

  if (eventType === 'team') {
    const team = record(root['team']);
    const teamId = num(team?.['id']);
    if (teamId === null) return null;

    return {
      ...EMPTY_TARGET,
      reason: 'team',
      teamId,
      teamSlug: str(team?.['slug']),
      org,
      orgId,
      // `team` 이벤트가 저장소를 함께 나를 때가 있다 (`added_to_repository`).
      repositoryId: num(record(root['repository'])?.['id']),
    };
  }

  if (eventType === 'repository') {
    const repositoryId = num(record(root['repository'])?.['id']);
    if (repositoryId === null) return null;

    return { ...EMPTY_TARGET, reason: 'repository', org, orgId, repositoryId };
  }

  return null;
}

/** 대상이 아무것도 가리키지 않는가. 그런 이벤트는 발행하지 않는다. */
export function isEmptyTarget(target: InvalidationTarget): boolean {
  return (
    target.logins.length === 0 &&
    target.githubUserIds.length === 0 &&
    target.teamId === null &&
    target.repositoryId === null
  );
}

/** `InvalidationTarget`을 EVT-AUTH-001 payload로 옮긴다. */
export function toEventPayload(target: InvalidationTarget): PermissionInvalidated {
  return {
    user_ids: target.githubUserIds,
    logins: target.logins,
    team_id: target.teamId,
    repository_id: target.repositoryId,
    reason: target.reason,
  };
}

/**
 * 무효화 소비자가 쓰는 저장소·GHE 접근면.
 *
 * `@prs/db`의 `authRepo`와 `GitHubClient`를 이 모양으로 맞춰 넣는다. 여기서
 * 좁게 잡아 두면 이 모듈이 실수로 다른 데이터를 건드리기 시작할 때 타입이 막는다.
 */
export interface InvalidationPorts {
  findUserIdsByGithubIds(githubIds: readonly number[]): Promise<string[]>;
  findUserIdsByLogins(logins: readonly string[]): Promise<string[]>;
  findUsersAffectedByRepository(repositoryId: number, orgId: number | null): Promise<string[]>;
  listTeamMembers(teamId: number): Promise<string[]>;
  /** GHE에서 팀 구성원을 다시 읽어 `team_member`를 갱신하고 결과를 돌려준다. */
  refreshTeamMembers?(teamId: number, org: string, teamSlug: string): Promise<string[]>;
  /** Redis + PostgreSQL 무효화 + 버전 증가. 실제로 무효화된 사용자를 돌려준다. */
  invalidate(userIds: readonly string[]): Promise<string[]>;
  forgetCached(userIds: readonly string[]): Promise<void>;
}

export interface InvalidationResult {
  readonly reason: InvalidationReason;
  readonly invalidatedUserIds: readonly string[];
  /** 팀 구성원을 GHE에서 다시 읽었는가 (CR-015, DEV-046). */
  readonly teamRefreshed: boolean;
}

export interface InvalidationContext {
  /** `team_id`를 GHE에서 펼치는 데 필요하다. 없으면 `team_member`만 쓴다. */
  readonly org?: string | null;
  readonly teamSlug?: string | null;
  /** `repository_id`가 속한 조직. `org_team` 모드 사용자를 찾는 데 쓴다. */
  readonly orgId?: number | null;
}

/**
 * 대상을 실제 사용자 집합으로 펼치고 무효화한다 (JOB-AUTH-001).
 *
 * 세 갈래를 합집합으로 모은다.
 *   - `user_ids` (GHE 숫자 id) → `app_user.github_user_id`. 개명에 흔들리지 않는다
 *   - `team_id` → GHE에서 구성원을 다시 읽고, 같은 응답으로 `team_member` 갱신
 *   - `repository_id` → GIN 색인으로 그 저장소를 볼 수 있던 사용자
 *
 * **팀은 GHE 조회 결과를 우선 쓴다.** `team_member`가 비어 있을 때 그것을
 * "무효화할 사람이 없다"로 읽으면 회수가 반영되지 않는다.
 */
export async function applyInvalidation(
  payload: PermissionInvalidated,
  ports: InvalidationPorts,
  context: InvalidationContext = {},
): Promise<InvalidationResult> {
  const targets = new Set<string>();
  let teamRefreshed = false;

  const githubIds = payload.user_ids ?? [];
  if (githubIds.length > 0) {
    for (const userId of await ports.findUserIdsByGithubIds(githubIds)) targets.add(userId);
  }

  // login은 폴백이다. 숫자 id로 이미 찾은 사용자는 집합이 접어 준다.
  const logins = payload.logins ?? [];
  if (logins.length > 0) {
    for (const userId of await ports.findUserIdsByLogins(logins)) targets.add(userId);
  }

  const teamId = payload.team_id ?? null;
  if (teamId !== null) {
    const org = context.org ?? null;
    const slug = context.teamSlug ?? null;

    // GHE에서 다시 읽을 수 있으면 그것이 진실이다. 팀에서 빠진 사람도
    // 무효화해야 하므로, 갱신 **전**의 구성원도 함께 담는다.
    for (const userId of await ports.listTeamMembers(teamId)) targets.add(userId);

    if (ports.refreshTeamMembers !== undefined && org !== null && slug !== null) {
      for (const userId of await ports.refreshTeamMembers(teamId, org, slug)) targets.add(userId);
      teamRefreshed = true;
    }
  }

  const repositoryId = payload.repository_id ?? null;
  if (repositoryId !== null) {
    for (const userId of await ports.findUsersAffectedByRepository(repositoryId, context.orgId ?? null)) {
      targets.add(userId);
    }
  }

  const userIds = [...targets];
  if (userIds.length === 0) {
    return { reason: (payload.reason as InvalidationReason) ?? 'manual', invalidatedUserIds: [], teamRefreshed };
  }

  const invalidated = await ports.invalidate(userIds);
  // Redis는 PostgreSQL 무효화 **뒤에** 지운다. 순서를 뒤집으면 그 사이의
  // 요청이 PostgreSQL의 낡은 행을 읽어 Redis를 다시 채운다.
  await ports.forgetCached(userIds);

  return {
    reason: (payload.reason as InvalidationReason) ?? 'manual',
    invalidatedUserIds: invalidated,
    teamRefreshed,
  };
}
