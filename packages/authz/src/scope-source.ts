/**
 * 접근 범위의 출처 (FR-AUTH-002 AC-1, OD-002).
 *
 * **OD-002는 열려 있다** — 권한 판정 소스를 GHE 협업자·팀 API로 할 것인가
 * 사내 IdP 그룹으로 할 것인가가 아직 결정되지 않았다 (SRS 15장, 기한 REL-002
 * 착수 전). SRS가 "두 소스 모두에서 동일 수용 기준을 만족한다"고 적었으므로,
 * 여기서는 **포트를 두고 GHE 어댑터를 구현한다.** 결정이 IdP 그룹으로 나면
 * 어댑터를 갈아 끼우는 일이지 `resolveAccessScope`를 다시 쓰는 일이 아니다.
 *
 * 그래서 이 포트는 GHE를 이름에 담지 않는다.
 */

import type { GitHubClient, RepoRef } from '@prs/github';

/** 사용자의 접근 범위 원본. 캐시 이전의 사실이다. */
export interface RawAccessScope {
  /** read 이상 권한을 가진 등록 저장소 ID (FR-AUTH-002 AC-1). */
  readonly repositoryIds: readonly number[];
  /** 그 저장소들이 속한 조직 ID. `org_team` 전환에 쓴다. */
  readonly orgIds: readonly number[];
  /** 사용자가 속한 팀 ID. */
  readonly teamIds: readonly number[];
  /**
   * 조직 안에서 팀 소속 없이도 볼 수 있는 가시성.
   *
   * 조직 구성원이면 `public`·`internal`을 본다 (보안 문서 5.2). 구성원이
   * 아니면 비어 있다 — 그 경우 `org_team` 모드는 팀 조건만으로 좁혀진다.
   */
  readonly visibilities: readonly string[];
}

/**
 * 접근 범위를 조회하는 방법.
 *
 * @throws 조회에 실패하면 던진다. **빈 범위를 돌려주지 않는다** — 빈 범위는
 * "볼 수 있는 것이 없다"는 사실이고, 실패는 "모른다"이다. 둘을 섞으면 기본
 * 거부(AC-3)가 조용한 0건 응답이 된다.
 */
export interface AccessScopeSource {
  fetch(user: { readonly userId: string; readonly login: string }): Promise<RawAccessScope>;
}

/** 접근 범위를 계산할 대상 저장소. 등록된 저장소만 본다. */
export interface RegisteredRepository {
  readonly repositoryId: number;
  readonly owner: string;
  readonly name: string;
  readonly orgId: number;
  readonly visibility: 'public' | 'internal' | 'private';
}

/** `read` 이상으로 치는 GHE 권한 (FR-AUTH-002 AC-1). */
const READABLE_PERMISSIONS = new Set(['pull', 'triage', 'push', 'maintain', 'admin']);

export function isReadable(permission: string): boolean {
  return READABLE_PERMISSIONS.has(permission);
}

/** GHE가 협업자 권한을 돌려주는 모양. */
export interface CollaboratorPermission {
  readonly permission: string;
}

/**
 * GHE에서 권한을 읽어야 하는 부분만 추린 포트.
 *
 * `GitHubClient` 전체가 아니라 이 셋만 받는다 — 테스트가 가짜를 만들기 쉽고,
 * 이 어댑터가 실수로 PR 본문 같은 것을 읽기 시작하면 타입이 막는다.
 */
export interface GhePermissionApi {
  /** `GET /repos/{owner}/{repo}/collaborators/{username}/permission` */
  collaboratorPermission(ref: RepoRef, username: string): Promise<CollaboratorPermission | null>;
  /** `GET /orgs/{org}/teams` */
  listOrgTeams(org: string): Promise<readonly { readonly id: number; readonly slug: string }[]>;
  /** `GET /orgs/{org}/teams/{slug}/memberships/{username}` — 없으면 null */
  teamMembership(org: string, teamSlug: string, username: string): Promise<boolean>;
  /** `GET /orgs/{org}/members/{username}` */
  isOrgMember(org: string, username: string): Promise<boolean>;
}

export interface GheScopeSourceOptions {
  readonly api: GhePermissionApi;
  /** 등록된 저장소를 준다. 등록되지 않은 저장소에는 문서 자체가 없다. */
  readonly listRegistered: () => Promise<readonly RegisteredRepository[]>;
  /** 저장소 권한 조회의 동시 실행 상한. */
  readonly concurrency?: number;
}

/** 저장소 권한 조회를 몇 개까지 동시에 던질지. GHE secondary limit을 자극하지 않는다. */
export const DEFAULT_REPOSITORY_CONCURRENCY = 8;

/**
 * GHE 어댑터 (OD-002의 첫 번째 선택지).
 *
 * **등록된 저장소만 확인한다.** 조직 전체가 아니라 PR Search가 색인하는
 * 저장소만이 접근 범위의 의미를 갖기 때문이다 — 등록되지 않은 저장소에는
 * 문서가 없으므로 볼 수 있든 없든 결과가 같다.
 *
 * 협업자 권한 API는 조직 기본 권한·팀 권한·직접 협업자를 모두 반영한 **실효
 * 권한**을 돌려준다. 그래서 세 경로를 따로 합치지 않아도 AC-1의 "read 이상
 * 권한을 가진 저장소"가 정확히 나온다.
 */
export class GheAccessScopeSource implements AccessScopeSource {
  readonly #api: GhePermissionApi;
  readonly #listRegistered: () => Promise<readonly RegisteredRepository[]>;
  readonly #concurrency: number;

  constructor(options: GheScopeSourceOptions) {
    this.#api = options.api;
    this.#listRegistered = options.listRegistered;
    this.#concurrency = options.concurrency ?? DEFAULT_REPOSITORY_CONCURRENCY;
  }

  async fetch(user: { readonly userId: string; readonly login: string }): Promise<RawAccessScope> {
    const registered = await this.#listRegistered();
    if (registered.length === 0) {
      return { repositoryIds: [], orgIds: [], teamIds: [], visibilities: [] };
    }

    const repositoryIds = await this.#readableRepositories(registered, user.login);

    // 조직·팀은 `org_team` 전환용이다. 저장소가 500개 이하라면 쓰이지 않지만,
    // 전환 임계를 넘나드는 순간에 다시 조회하지 않도록 함께 담아 둔다.
    const orgs = uniqueOrgs(registered);
    const teamIds: number[] = [];
    const memberOrgs: string[] = [];

    for (const [orgId, owner] of orgs) {
      if (!(await this.#api.isOrgMember(owner, user.login))) continue;
      memberOrgs.push(owner);

      for (const team of await this.#api.listOrgTeams(owner)) {
        if (await this.#api.teamMembership(owner, team.slug, user.login)) teamIds.push(team.id);
      }
      void orgId;
    }

    const orgIds = [...orgs.entries()]
      .filter(([, owner]) => memberOrgs.includes(owner))
      .map(([orgId]) => orgId);

    return {
      repositoryIds,
      orgIds,
      teamIds,
      // 조직 구성원이면 조직 안의 public·internal을 본다 (보안 문서 5.2).
      visibilities: orgIds.length > 0 ? ['public', 'internal'] : [],
    };
  }

  /** 저장소마다 실효 권한을 확인한다. 동시 실행을 묶어 GHE를 몰아치지 않는다. */
  async #readableRepositories(
    registered: readonly RegisteredRepository[],
    login: string,
  ): Promise<number[]> {
    const readable: number[] = [];
    let cursor = 0;

    const workers = Array.from({ length: Math.min(this.#concurrency, registered.length) }, async () => {
      for (;;) {
        const index = cursor;
        cursor += 1;
        if (index >= registered.length) return;

        const repository = registered[index];
        if (repository === undefined) return;

        const permission = await this.#api.collaboratorPermission(
          { owner: repository.owner, repo: repository.name },
          login,
        );
        if (permission !== null && isReadable(permission.permission)) {
          readable.push(repository.repositoryId);
        }
      }
    });

    await Promise.all(workers);
    // 순서를 고정한다. 캐시 값이 조회할 때마다 달라지면 비교가 어려워진다.
    return readable.sort((a, b) => a - b);
  }
}

function uniqueOrgs(registered: readonly RegisteredRepository[]): Map<number, string> {
  const orgs = new Map<number, string>();
  for (const repository of registered) {
    if (!orgs.has(repository.orgId)) orgs.set(repository.orgId, repository.owner);
  }
  return orgs;
}

/** `GitHubClient`를 이 포트에 맞춘다. */
export function ghePermissionApi(client: GitHubClient): GhePermissionApi {
  return {
    async collaboratorPermission(ref, username) {
      return client.collaboratorPermission(ref, username);
    },
    async listOrgTeams(org) {
      return client.listOrgTeams(org);
    },
    async teamMembership(org, teamSlug, username) {
      return client.isTeamMember(org, teamSlug, username);
    },
    async isOrgMember(org, username) {
      return client.isOrgMember(org, username);
    },
  };
}
