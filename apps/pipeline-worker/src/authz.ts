/**
 * JOB-AUTH-001 권한 캐시 무효화 워커 (WP-012, FR-AUTH-003).
 *
 * `prs:permission`을 소비해 `EVT-AUTH-001`을 실제 사용자 집합으로 펼치고
 * 캐시를 무효화한다. 게이트웨이가 펼치지 않고 넘긴 일이 여기서 끝난다
 * (CR-015, DEV-042).
 *
 * 지켜야 할 것 셋:
 *
 * 1. **무효화는 멱등이다.** 집합 연산이므로 같은 이벤트를 두 번 처리해도
 *    결과가 같다. 다만 `access_scope_version`은 두 번 오른다 — 그것은 단조
 *    증가 카운터일 뿐이라 해가 없다.
 * 2. **아무도 못 찾았다고 실패로 보지 않는다.** 로그인한 적 없는 사용자의
 *    권한이 바뀌면 무효화할 캐시가 없는 것이 정상이다.
 * 3. **GHE 조회 실패는 재시도한다.** 팀 구성원을 못 읽으면 그 팀의 회수가
 *    반영되지 않으므로, 조용히 ack하지 않고 버스의 표준 백오프에 맡긴다.
 */

import {
  MAX_RETRIES,
  TOPICS,
  consumerGroup,
  type DeliveredEvent,
  type EventBus,
  type HandlerDisposition,
  type SubscribeOptions,
  type Subscription,
} from '@prs/bus';
import { applyInvalidation, type InvalidationPorts, type PermissionInvalidated } from '@prs/authz';
import { authRepo, type Pool } from '@prs/db';
import type { GitHubClient } from '@prs/github';
import type { WorkerMetrics } from './metrics.js';

export const AUTHZ_STAGE = 'authz' as const;

export interface AuthzLogEntry {
  readonly level: 'info' | 'warn' | 'error';
  readonly message: string;
  readonly correlation_id?: string;
  readonly reason?: string;
  readonly team_id?: number | null;
  readonly repository_id?: number | null;
  readonly invalidated?: number;
  readonly error?: string;
}

export interface AuthzDeps {
  readonly bus: EventBus;
  readonly pool: Pool;
  readonly metrics: WorkerMetrics;
  /** Redis 캐시 키를 지우는 방법. `AccessScopeResolver.forget`을 넣는다. */
  readonly forgetCached: (userIds: readonly string[]) => Promise<void>;
  /** 팀 구성원을 GHE에서 다시 읽기 위한 클라이언트. 없으면 표만 쓴다. */
  readonly github?: GitHubClient | undefined;
  /**
   * 포트를 직접 준다. 생략하면 `pool`과 `github`로 만든다.
   *
   * OD-002가 IdP 그룹으로 결정되면 여기에 다른 어댑터가 들어온다 — 그때
   * 이 워커를 고치지 않는다.
   */
  readonly ports?: InvalidationPorts | undefined;
  readonly log?: (entry: AuthzLogEntry) => void;
}

/** 이벤트 payload에서 무효화 대상을 꺼낸다. 모양이 다르면 `null`이다. */
export function parseInvalidationEvent(
  payload: unknown,
): { readonly event: PermissionInvalidated; readonly org: string | null; readonly teamSlug: string | null; readonly orgId: number | null } | null {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return null;
  const value = payload as Record<string, unknown>;

  const userIds = value['user_ids'];
  const logins = value['logins'];
  const teamId = value['team_id'];
  const repositoryId = value['repository_id'];

  const numbers = Array.isArray(userIds) ? userIds.filter((one): one is number => typeof one === 'number') : [];
  const strings = Array.isArray(logins) ? logins.filter((one): one is string => typeof one === 'string') : [];
  const team = typeof teamId === 'number' ? teamId : null;
  const repository = typeof repositoryId === 'number' ? repositoryId : null;

  // 셋 다 비었으면 아무도 무효화하지 않는 이벤트다. 발행 측 버그이므로
  // 조용히 ack하지 않고 모양이 아니라고 말한다.
  if (numbers.length === 0 && strings.length === 0 && team === null && repository === null) return null;

  return {
    event: {
      user_ids: numbers,
      logins: strings,
      team_id: team,
      repository_id: repository,
      reason: typeof value['reason'] === 'string' ? value['reason'] : 'manual',
    },
    org: typeof value['org'] === 'string' ? value['org'] : null,
    teamSlug: typeof value['team_slug'] === 'string' ? value['team_slug'] : null,
    orgId: typeof value['org_id'] === 'number' ? value['org_id'] : null,
  };
}

/**
 * `@prs/db`와 GHE를 무효화 포트에 맞춘다.
 *
 * `refreshTeamMembers`는 GHE 클라이언트가 있을 때만 채운다. 없으면
 * `applyInvalidation`이 `team_member` 표만 쓴다 (CR-015, DEV-046).
 */
export function createInvalidationPorts(deps: AuthzDeps): InvalidationPorts {
  const { pool, github } = deps;

  const ports: InvalidationPorts = {
    findUserIdsByGithubIds: (ids) => authRepo.findUserIdsByGithubIds(pool, ids),
    findUserIdsByLogins: (logins) => authRepo.findUserIdsByLogins(pool, logins),
    findUsersAffectedByRepository: (repositoryId, orgId) =>
      authRepo.findUsersAffectedByRepository(pool, repositoryId, orgId),
    listTeamMembers: (teamId) => authRepo.listTeamMembers(pool, teamId),
    invalidate: (userIds) => authRepo.invalidateUsers(pool, userIds),
    forgetCached: deps.forgetCached,
  };

  if (github === undefined) return ports;

  return {
    ...ports,
    refreshTeamMembers: async (teamId, org, teamSlug): Promise<string[]> => {
      const members = await github.listTeamMembers(org, teamSlug);
      const userIds = await authRepo.findUserIdsByGithubIds(
        pool,
        members.map((member) => member.id),
      );
      // 표를 통째로 갈아 끼운다. 빠진 사람은 다음 팀 무효화 대상에서 사라진다.
      return authRepo.replaceTeamMembers(pool, teamId, userIds);
    },
  };
}

export function createAuthzHandler(
  deps: AuthzDeps,
): (delivered: DeliveredEvent) => Promise<HandlerDisposition> {
  const log = deps.log ?? ((): void => {});
  const ports = deps.ports ?? createInvalidationPorts(deps);

  return async (delivered: DeliveredEvent): Promise<HandlerDisposition> => {
    const parsed = parseInvalidationEvent(delivered.payload);
    if (parsed === null) {
      // 다시 보내도 같은 모양이다. 재시도로 파티션을 막지 않는다.
      deps.metrics.permissionInvalidationFailed.inc({ reason: 'malformed' });
      log({
        level: 'error',
        message: 'permission.invalidated payload가 대상을 가리키지 않는다',
        correlation_id: delivered.correlation_id,
        reason: 'malformed',
      });
      return { kind: 'dead_letter', reason: 'malformed permission.invalidated payload' };
    }

    try {
      const result = await applyInvalidation(parsed.event, ports, {
        org: parsed.org,
        teamSlug: parsed.teamSlug,
        orgId: parsed.orgId,
      });

      deps.metrics.permissionInvalidated.inc({ reason: result.reason }, result.invalidatedUserIds.length);
      log({
        level: 'info',
        message: 'permission cache invalidated',
        correlation_id: delivered.correlation_id,
        reason: result.reason,
        team_id: parsed.event.team_id ?? null,
        repository_id: parsed.event.repository_id ?? null,
        invalidated: result.invalidatedUserIds.length,
      });
      return { kind: 'ack' };
    } catch (error) {
      deps.metrics.permissionInvalidationFailed.inc({ reason: 'error' });
      const message = error instanceof Error ? error.message : String(error);
      log({
        level: 'error',
        message: '권한 무효화 실패 — 재시도한다',
        correlation_id: delivered.correlation_id,
        error: message,
      });

      // GHE·PostgreSQL 장애는 지나간다. 상한까지 실패하면 실패 대기열로 —
      // 그 사이 캐시 TTL 5분이 최후의 안전망이다.
      return delivered.delivery_count >= MAX_RETRIES
        ? { kind: 'dead_letter', reason: message }
        : { kind: 'retry', reason: message };
    }
  };
}

export async function startAuthzWorker(
  deps: AuthzDeps,
  options: SubscribeOptions = {},
): Promise<Subscription> {
  return deps.bus.subscribe(
    TOPICS.permission,
    consumerGroup(TOPICS.permission),
    createAuthzHandler(deps),
    options,
  );
}
