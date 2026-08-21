/**
 * JOB-AUTH-001 무효화 워커 (WP-012, FR-AUTH-003 AC-2·AC-4).
 */

import { describe, expect, it } from 'vitest';
import { MAX_RETRIES, type DeliveredEvent } from '@prs/bus';
import { createAuthzHandler, parseInvalidationEvent, type AuthzDeps, type AuthzLogEntry } from './authz.js';
import { createWorkerMetrics } from './metrics.js';

/** 모든 조회가 실패하는 포트. GHE·PostgreSQL 장애를 흉내 낸다. */
function failingPorts(deps: AuthzDeps): NonNullable<AuthzDeps['ports']> {
  const boom = (): never => {
    throw new Error('PostgreSQL 연결 없음');
  };
  return {
    findUserIdsByGithubIds: async () => boom(),
    findUserIdsByLogins: async () => boom(),
    findUsersAffectedByRepository: async () => boom(),
    listTeamMembers: async () => boom(),
    invalidate: async () => boom(),
    forgetCached: deps.forgetCached,
  };
}

function delivered(payload: unknown, deliveryCount = 1): DeliveredEvent {
  return {
    event_id: 'evt-1',
    event_name: 'permission.invalidated',
    correlation_id: 'corr-1',
    occurred_at: '2026-08-21T09:00:00.000Z',
    payload,
    partition_key: 'team:77',
    partition: 0,
    delivery_count: deliveryCount,
    message_id: '1-0',
  };
}

function harness(overrides: Partial<AuthzDeps> = {}): {
  deps: AuthzDeps;
  logs: AuthzLogEntry[];
  forgotten: string[][];
} {
  const logs: AuthzLogEntry[] = [];
  const forgotten: string[][] = [];

  const deps = {
    bus: {} as AuthzDeps['bus'],
    // 이 테스트는 SQL을 타지 않는다 — 포트를 통째로 덮어쓴다.
    pool: {} as AuthzDeps['pool'],
    metrics: createWorkerMetrics(),
    forgetCached: async (userIds: readonly string[]): Promise<void> => {
      forgotten.push([...userIds]);
    },
    log: (entry: AuthzLogEntry): void => {
      logs.push(entry);
    },
    ...overrides,
  } satisfies AuthzDeps;

  return { deps, logs, forgotten };
}

describe('payload 되읽기', () => {
  it('대상 셋을 모두 꺼낸다', () => {
    const parsed = parseInvalidationEvent({
      user_ids: [501],
      logins: ['kim'],
      team_id: 77,
      repository_id: 4021,
      reason: 'team',
      org: 'acme',
      team_slug: 'core',
      org_id: 1,
    });

    expect(parsed?.event).toEqual({
      user_ids: [501],
      logins: ['kim'],
      team_id: 77,
      repository_id: 4021,
      reason: 'team',
    });
    expect(parsed?.org).toBe('acme');
    expect(parsed?.teamSlug).toBe('core');
    expect(parsed?.orgId).toBe(1);
  });

  it('아무 대상도 없으면 null이다', () => {
    expect(parseInvalidationEvent({ reason: 'member' })).toBeNull();
    expect(parseInvalidationEvent({ user_ids: [], logins: [], reason: 'member' })).toBeNull();
    expect(parseInvalidationEvent('not an object')).toBeNull();
    expect(parseInvalidationEvent(null)).toBeNull();
  });

  it('타입이 다른 항목을 걸러 낸다', () => {
    const parsed = parseInvalidationEvent({ user_ids: [501, 'kim', null], reason: 'member' });
    expect(parsed?.event.user_ids).toEqual([501]);
  });
});

describe('처분', () => {
  it('무효화에 성공하면 ack하고 Redis 캐시까지 지운다', async () => {
    const { deps, logs, forgotten } = harness();
    const invalidated: string[] = [];
    const handler = createAuthzHandler({
      ...deps,
      ports: {
        findUserIdsByGithubIds: async () => ['sub-kim'],
        findUserIdsByLogins: async () => [],
        findUsersAffectedByRepository: async () => [],
        listTeamMembers: async () => [],
        invalidate: async (ids) => {
          invalidated.push(...ids);
          return [...ids];
        },
        forgetCached: deps.forgetCached,
      },
    });

    const outcome = await handler(delivered({ user_ids: [501], reason: 'member' }));
    expect(outcome.kind).toBe('ack');
    expect(invalidated).toEqual(['sub-kim']);
    expect(forgotten).toEqual([['sub-kim']]);
    expect(logs.at(-1)).toMatchObject({ message: 'permission cache invalidated', invalidated: 1 });
  });

  it('맞는 사용자가 없어도 실패가 아니다 — 로그인한 적 없는 사용자일 수 있다', async () => {
    const { deps } = harness();
    const handler = createAuthzHandler({
      ...deps,
      ports: {
        findUserIdsByGithubIds: async () => [],
        findUserIdsByLogins: async () => [],
        findUsersAffectedByRepository: async () => [],
        listTeamMembers: async () => [],
        invalidate: async () => [],
        forgetCached: deps.forgetCached,
      },
    });

    expect((await handler(delivered({ user_ids: [999], reason: 'member' }))).kind).toBe('ack');
  });

  it('모양이 다른 payload는 재시도하지 않고 실패 대기열로 보낸다', async () => {
    const { deps, logs } = harness();
    const handler = createAuthzHandler(deps);

    const outcome = await handler(delivered({ reason: 'member' }));
    expect(outcome.kind).toBe('dead_letter');
    // 다시 보내도 같은 모양이므로 재시도가 파티션만 막는다.
    expect(logs.at(-1)?.reason).toBe('malformed');
  });

  it('일시 장애는 재시도한다', async () => {
    const { deps } = harness();
    const handler = createAuthzHandler({ ...deps, ports: failingPorts(deps) });

    expect((await handler(delivered({ user_ids: [501], reason: 'member' }, 1))).kind).toBe('retry');
  });

  it('재시도 상한을 넘기면 실패 대기열로 보낸다', async () => {
    const { deps } = harness();
    const handler = createAuthzHandler({ ...deps, ports: failingPorts(deps) });

    const outcome = await handler(delivered({ user_ids: [501], reason: 'member' }, MAX_RETRIES));
    expect(outcome.kind).toBe('dead_letter');
  });

  it('실패해도 로그에 payload 본문을 싣지 않는다 (NFR-005)', async () => {
    const { deps, logs } = harness();
    const handler = createAuthzHandler({ ...deps, ports: failingPorts(deps) });

    await handler(delivered({ user_ids: [501], logins: ['kim'], reason: 'member' }));
    const serialized = JSON.stringify(logs);
    expect(serialized).not.toContain('kim');
    expect(serialized).not.toContain('501');
  });
});
