/**
 * 작성자 소속 팀 (WP-069 / CR-058, FR-STAT-006 · FR-SRCH-005).
 *
 * 실제 PostgreSQL·실제 Redis·**실제 Elasticsearch**를 쓴다. 증명해야 할 것이
 * "필드가 문서에 실렸는가"가 아니라 **"그 문서를 `author_team:`이 찾는가"**라서,
 * 색인과 질의를 대역으로 바꾸면 검증하려던 것을 건너뛴다.
 *
 * 검증: `pnpm test:integration author-teams`
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Client } from '@elastic/elasticsearch';
import { rawEventRepo, repositoryRepo, teamMembershipRepo, type Pool } from '@prs/db';
import { applyMappings, switchAliasesForTests, createEsClient, dropEntityIndices, resolveClientOptions } from '@prs/es';
import { RedisStreamsEventBus, type DeliveredEvent, type Redis } from '@prs/bus';
import { EVENT_NAMES, type IngestionEnriched } from '@prs/domain';
import type { GitHubClient } from '@prs/github';
import { handleEnrichedEvent, type ProjectDeps } from '../../src/project.js';
import {
  AUTHOR_TEAMS_UNKNOWN,
  resolveAuthorTeam,
  resolveAuthorTeams,
  syncOrgTeamsIfStale,
} from '../../src/author-teams.js';
import { createWorkerMetrics } from '../../src/metrics.js';
import { createTestRedis, migratedPool } from '../helpers.js';

const REPOSITORY_ID = 4099;
const ORG = 7799;
const CORE = 88_001;
const PLATFORM = 88_002;
const PR_NUMBER = 5150;
const CORRELATION_ID = '0f0a1b2c-3d4e-5f60-7182-93a4b5c6d7f0';
const MERGE_SHA = 'e3f9c21b4e8d7f0c1a2b3c4d5e6f708192a3b4c5';

let pool: Pool;
let redis: Redis;
let bus: RedisStreamsEventBus;
let es: Client;

beforeAll(async () => {
  pool = await migratedPool();
  redis = createTestRedis();
  bus = new RedisStreamsEventBus(redis);
  es = createEsClient(resolveClientOptions());
  await waitForCluster();
  await dropEntityIndices(es);
  await applyMappings(es);
  await switchAliasesForTests(es);
}, 120_000);

afterAll(async () => {
  await bus.close();
  redis.disconnect();
  await es.close();
  await pool.end();
});

beforeEach(async () => {
  /*
   * **이 파일의 이름 공간만 정리한다.** 전역 DELETE는 다른 통합 파일의 픽스처를
   * 지우고, `(owner, name)` 유일 제약 때문에 저장소 이름도 겹치면 안 된다.
   */
  await pool.query('DELETE FROM raw_event WHERE repository_id = $1', [REPOSITORY_ID]);
  await pool.query('DELETE FROM pull_request_snapshot WHERE repository_id = $1', [REPOSITORY_ID]);
  await pool.query('DELETE FROM team_membership WHERE team_id = ANY($1::bigint[])', [[CORE, PLATFORM]]);
  await pool.query('DELETE FROM org_team_sync WHERE org_id = $1', [ORG]);
  await pool.query('DELETE FROM team WHERE org_id = $1', [ORG]);
  await pool.query('DELETE FROM repository WHERE repository_id = $1', [REPOSITORY_ID]);
  await es.deleteByQuery({
    index: ['prs-pull-requests'],
    query: { term: { repository_id: REPOSITORY_ID } },
    refresh: true,
    conflicts: 'proceed',
  });
  await repositoryRepo.upsertRepository(pool, {
    repository_id: REPOSITORY_ID,
    owner: 'authorteams',
    name: 'payments',
    org_id: ORG,
    visibility: 'internal',
    sequence_branches: ['main'],
  });
});

afterEach(async () => {
  await es.indices.refresh({ index: ['prs-pull-requests'] });
});

async function waitForCluster(timeoutMs = 90_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      await es.cluster.health({ wait_for_status: 'yellow', timeout: '5s' });
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  }
  throw new Error(`Elasticsearch가 준비되지 않았다: ${String(lastError)}`);
}

/** GHE 대역. **실제보다 관대하지 않게** 조직 팀 API의 두 호출만 답한다. */
function githubStub(
  teams: readonly { id: number; slug: string; members: readonly string[] }[],
  options: { readonly failOn?: 'teams' | 'members' } = {},
): { client: GitHubClient; calls: string[] } {
  const calls: string[] = [];
  const client = {
    async listOrgTeams(org: string) {
      calls.push(`teams:${org}`);
      if (options.failOn === 'teams') throw new Error('GHE 502');
      return teams.map((team) => ({ id: team.id, slug: team.slug, name: team.slug }));
    },
    async listTeamMembers(org: string, slug: string) {
      calls.push(`members:${org}/${slug}`);
      if (options.failOn === 'members') throw new Error('GHE 502');
      const found = teams.find((team) => team.slug === slug);
      return (found?.members ?? []).map((login, index) => ({ id: index + 1, login }));
    },
  } as unknown as GitHubClient;
  return { client, calls };
}

const TEAMS = [
  { id: CORE, slug: 'core', members: ['alice', 'bob'] },
  { id: PLATFORM, slug: 'platform', members: ['alice'] },
];

function enrichedPayload(overrides: Partial<IngestionEnriched> = {}): IngestionEnriched {
  return {
    delivery_id: 'delivery-author-teams-1',
    repository_id: REPOSITORY_ID,
    entity_kind: 'pull_request',
    pr_number: PR_NUMBER,
    pull_request: {
      number: PR_NUMBER,
      title: 'feat: 결제 재시도',
      body: '',
      state: 'closed',
      draft: false,
      labels: [],
      merged: true,
      created_at: '2026-08-19T09:00:00.000Z',
      updated_at: '2026-08-19T10:00:00.000Z',
      closed_at: '2026-08-19T10:00:00.000Z',
      merged_at: '2026-08-19T10:00:00.000Z',
      merge_commit_sha: MERGE_SHA,
      author: 'alice',
      head_ref: 'feature/retry',
      head_sha: 'b1c2d3e4f5061728394a5b6c7d8e9f0a1b2c3d4f',
      base_ref: 'main',
      base_sha: 'c1d2e3f405162738495a6b7c8d9e0f1a2b3c4d5f',
    },
    source_commit_shas: [],
    changed_files: [],
    reviews: [],
    source_commits_truncated: false,
    files_truncated: false,
    enrichment_pending: false,
    enrichment_errors: [],
    correlation_id: CORRELATION_ID,
    ...overrides,
  };
}

/**
 * 한 이벤트를 투영한다.
 *
 * **`receivedAt`이 문서 버전이다** (FR-ING-005 AC-1). 같은 값으로 두 번 부르면
 * 조건부 업서트가 `noop`이 되므로, 뒤이은 투영은 **나중에 도착한 웹훅**처럼 더 큰
 * 값을 받아야 한다. 소속 변경을 이 경로로 시험할 때 그 사실이 드러난다 — 소속이
 * 바뀌어도 **새 이벤트가 없으면 문서는 그대로이며**, 그것이 `WP-069`의 DoD가
 * 반영 경로를 재색인·백필로 정한 이유다.
 */
async function project(
  payload: IngestionEnriched,
  deliveryId = payload.delivery_id,
  receivedAt = new Date('2026-08-19T10:00:01.000Z'),
): Promise<void> {
  await rawEventRepo.insertRawEventIfAbsent(pool, {
    delivery_id: deliveryId,
    event_type: 'pull_request',
    action: 'closed',
    repository_id: REPOSITORY_ID,
    received_at: receivedAt,
    payload: { number: PR_NUMBER },
    payload_hash: 'b'.repeat(64),
    correlation_id: CORRELATION_ID,
    queued_at: receivedAt,
  });

  const deps: ProjectDeps = {
    pool,
    bus,
    es,
    metrics: createWorkerMetrics(),
    sleep: async (): Promise<void> => undefined,
  };
  const event: DeliveredEvent = {
    event_id: `evt-${deliveryId}`,
    event_name: EVENT_NAMES.ingestionEnriched,
    correlation_id: CORRELATION_ID,
    occurred_at: new Date().toISOString(),
    partition_key: String(REPOSITORY_ID),
    partition: 0,
    delivery_count: 1,
    message_id: 'm-1',
    payload: { ...payload, delivery_id: deliveryId },
  };
  const outcome = await handleEnrichedEvent(deps, event);
  expect(outcome.disposition.kind).toBe('ack');
  await es.indices.refresh({ index: ['prs-pull-requests'] });
}

async function indexedDoc(): Promise<Record<string, unknown>> {
  const found = await es.search<Record<string, unknown>>({
    index: 'prs-pull-requests',
    query: { term: { repository_id: REPOSITORY_ID } },
  });
  const hit = found.hits.hits[0];
  expect(hit).toBeDefined();
  return hit?._source ?? {};
}

async function findByAuthorTeam(teamIds: readonly number[]): Promise<number> {
  const found = await es.search({
    index: 'prs-pull-requests',
    query: {
      bool: {
        filter: [{ term: { repository_id: REPOSITORY_ID } }, { terms: { author_team_ids: [...teamIds] } }],
      },
    },
  });
  return typeof found.hits.total === 'number' ? found.hits.total : (found.hits.total?.value ?? 0);
}

describe('조직 팀 동기화 (WP-069 / CR-058)', () => {
  it('낡았으면 GHE에서 읽어 정본에 쓴다', async () => {
    const { client, calls } = githubStub(TEAMS);
    const synced = await syncOrgTeamsIfStale({ pool, github: client }, { orgId: ORG, owner: 'authorteams' });

    expect(synced).toBe(true);
    expect(calls).toEqual(['teams:authorteams', 'members:authorteams/core', 'members:authorteams/platform']);
    const found = await teamMembershipRepo.findAuthorTeamIds(pool, ORG, ['alice', 'bob']);
    expect(found.get('alice')).toEqual([CORE, PLATFORM]);
    expect(found.get('bob')).toEqual([CORE]);
  });

  it('**신선하면 GHE를 부르지 않는다** — 비용이 조직당 팀 수이고 PR 수와 무관해야 한다', async () => {
    const first = githubStub(TEAMS);
    await syncOrgTeamsIfStale({ pool, github: first.client }, { orgId: ORG, owner: 'authorteams' });

    const second = githubStub(TEAMS);
    const synced = await syncOrgTeamsIfStale({ pool, github: second.client }, { orgId: ORG, owner: 'authorteams' });

    expect(synced).toBe(false);
    expect(second.calls).toEqual([]);
  });

  it('**동시에 둘이 들어와도 GHE를 한 번만 훑는다** — 잠금 뒤 재확인이 그 자리다', async () => {
    /*
     * 잠금만으로는 줄을 세울 뿐이다. 기다리던 쪽이 잠금을 얻은 뒤 신선도를 **다시
     * 보지 않으면** 방금 끝난 동기화를 그대로 한 번 더 한다 — 조직 팀 전체를 훑는
     * 조회라 그 중복이 그대로 GHE 요청 폭증이 된다.
     *
     * 변이로 확인했다: 재확인을 지우면 `teams:` 호출이 둘이 되고 이 시험이 잡는다.
     */
    const calls: string[] = [];
    const first = githubStub(TEAMS);
    const second = githubStub(TEAMS);
    // 두 대역이 같은 배열에 기록하도록 묶는다.
    const track = (stub: { client: GitHubClient; calls: string[] }): GitHubClient => {
      const client = stub.client as unknown as Record<string, (...args: never[]) => Promise<unknown>>;
      const listOrgTeams = client['listOrgTeams'];
      client['listOrgTeams'] = async (...args: never[]) => {
        calls.push('teams');
        return listOrgTeams?.(...args);
      };
      return stub.client;
    };

    await Promise.all([
      syncOrgTeamsIfStale({ pool, github: track(first) }, { orgId: ORG, owner: 'authorteams' }),
      syncOrgTeamsIfStale({ pool, github: track(second) }, { orgId: ORG, owner: 'authorteams' }),
    ]);

    expect(calls).toHaveLength(1);
    expect((await teamMembershipRepo.findAuthorTeamIds(pool, ORG, ['alice'])).get('alice')).toEqual([
      CORE,
      PLATFORM,
    ]);
  });

  it('자격이 없으면 동기화하지 않는다 — 재색인 경로가 그렇게 부른다 (ADR-004)', async () => {
    expect(await syncOrgTeamsIfStale({ pool }, { orgId: ORG, owner: 'authorteams' })).toBe(false);
    expect(await teamMembershipRepo.findOrgSyncedAt(pool, ORG)).toBeNull();
  });

  it('**GHE 조회가 실패하면 동기화 시각을 찍지 않는다** — 실패를 빈 배열로 바꾸지 않는다', async () => {
    const { client } = githubStub(TEAMS, { failOn: 'members' });
    expect(await syncOrgTeamsIfStale({ pool, github: client }, { orgId: ORG, owner: 'authorteams' })).toBe(false);
    expect(await teamMembershipRepo.findOrgSyncedAt(pool, ORG)).toBeNull();
    expect(await resolveAuthorTeam({ pool }, ORG, 'alice')).toEqual(AUTHOR_TEAMS_UNKNOWN);
  });
});

describe('작성자 소속 판정 (WP-069 / CR-058)', () => {
  it('동기화한 적 없으면 모름이다 — 표가 비어 있는 것과 팀이 없는 것은 다르다 (DEV-486)', async () => {
    expect(await resolveAuthorTeam({ pool }, ORG, 'alice')).toEqual(AUTHOR_TEAMS_UNKNOWN);
  });

  it('**동기화가 낡으면 표에 행이 있어도 모름이다** — 그때의 사실이 지금의 사실은 아니다', async () => {
    const { client } = githubStub(TEAMS);
    await syncOrgTeamsIfStale({ pool, github: client }, { orgId: ORG, owner: 'authorteams' });

    expect(await resolveAuthorTeam({ pool, stalenessMs: 0 }, ORG, 'alice')).toEqual(AUTHOR_TEAMS_UNKNOWN);
    expect(await resolveAuthorTeam({ pool }, ORG, 'alice')).toEqual({ kind: 'known', teamIds: [CORE, PLATFORM] });
  });

  it('**신선한데 어느 팀에도 없으면 빈 배열이 사실이다**', async () => {
    const { client } = githubStub(TEAMS);
    await syncOrgTeamsIfStale({ pool, github: client }, { orgId: ORG, owner: 'authorteams' });
    expect(await resolveAuthorTeam({ pool }, ORG, 'outsider')).toEqual({ kind: 'known', teamIds: [] });
  });

  it('작성자를 모르면 조회하지 않고 곧장 모름이다 (DEV-487)', async () => {
    const { client } = githubStub(TEAMS);
    await syncOrgTeamsIfStale({ pool, github: client }, { orgId: ORG, owner: 'authorteams' });
    expect(await resolveAuthorTeam({ pool }, ORG, null)).toEqual(AUTHOR_TEAMS_UNKNOWN);
    expect(await resolveAuthorTeam({ pool }, ORG, '')).toEqual(AUTHOR_TEAMS_UNKNOWN);
  });

  it('일괄 조회가 작성자마다 왕복하지 않는다', async () => {
    const { client } = githubStub(TEAMS);
    await syncOrgTeamsIfStale({ pool, github: client }, { orgId: ORG, owner: 'authorteams' });
    const resolved = await resolveAuthorTeams({ pool }, ORG, ['alice', 'bob', 'outsider', null]);
    expect(resolved.get('alice')).toEqual({ kind: 'known', teamIds: [CORE, PLATFORM] });
    expect(resolved.get('bob')).toEqual({ kind: 'known', teamIds: [CORE] });
    expect(resolved.get('outsider')).toEqual({ kind: 'known', teamIds: [] });
    expect(resolved.size).toBe(3);
  });
});

describe('투영이 실제로 색인하고 `author_team:`이 찾는다 (FR-SRCH-005 · FR-STAT-006)', () => {
  it('**소속을 알면 그 PR을 팀으로 찾는다** — WP-069이 닫는 경로다', async () => {
    const { client } = githubStub(TEAMS);
    await syncOrgTeamsIfStale({ pool, github: client }, { orgId: ORG, owner: 'authorteams' });

    await project(enrichedPayload());

    const doc = await indexedDoc();
    expect(doc['author']).toBe('alice');
    expect(doc['author_team_ids']).toEqual([CORE, PLATFORM]);
    expect(await findByAuthorTeam([CORE])).toBe(1);
    expect(await findByAuthorTeam([PLATFORM])).toBe(1);
  });

  it('**`allowed_team_ids`와 다른 값이다** — 접근 권한을 성과로 읽지 않는다 (DEV-382)', async () => {
    const { client } = githubStub(TEAMS);
    await syncOrgTeamsIfStale({ pool, github: client }, { orgId: ORG, owner: 'authorteams' });
    await project(enrichedPayload());

    const doc = await indexedDoc();
    expect(doc['author_team_ids']).toEqual([CORE, PLATFORM]);
    expect(doc['allowed_team_ids']).toEqual([]);
  });

  it('동기화 전에는 필드가 없다 — 그리고 그때 그 PR은 어느 팀 버킷에도 없다', async () => {
    await project(enrichedPayload());

    const doc = await indexedDoc();
    expect(Object.keys(doc)).not.toContain('author_team_ids');
    expect(await findByAuthorTeam([CORE])).toBe(0);
  });

  it('**모르게 되면 이미 색인된 소속이 사라진다** (DEV-484)', async () => {
    const { client } = githubStub(TEAMS);
    await syncOrgTeamsIfStale({ pool, github: client }, { orgId: ORG, owner: 'authorteams' });
    await project(enrichedPayload(), 'delivery-author-teams-known');
    expect(await findByAuthorTeam([CORE])).toBe(1);

    // 동기화 기록이 사라지면 모름이다 — 그때 옛 값을 남겨 두면 떠난 팀이 계속 답한다.
    await pool.query('DELETE FROM org_team_sync WHERE org_id = $1', [ORG]);
    await project(enrichedPayload(), 'delivery-author-teams-unknown', new Date('2026-08-19T11:00:00.000Z'));

    const doc = await indexedDoc();
    expect(Object.keys(doc)).not.toContain('author_team_ids');
    expect(await findByAuthorTeam([CORE])).toBe(0);
  });

  it('**팀을 옮기면 새 소속만 남는다** — 옛 팀에 남아 있지 않는다', async () => {
    const before = githubStub(TEAMS);
    await syncOrgTeamsIfStale({ pool, github: before.client }, { orgId: ORG, owner: 'authorteams' });
    await project(enrichedPayload(), 'delivery-author-teams-a');
    expect(await findByAuthorTeam([CORE])).toBe(1);

    // alice가 core에서 빠지고 platform만 남았다.
    await teamMembershipRepo.replaceOrgTeamMembership(
      pool,
      ORG,
      [
        { teamId: CORE, slug: 'core', logins: ['bob'] },
        { teamId: PLATFORM, slug: 'platform', logins: ['alice'] },
      ],
      new Date(),
    );
    await project(enrichedPayload(), 'delivery-author-teams-b', new Date('2026-08-19T11:00:00.000Z'));

    expect((await indexedDoc())['author_team_ids']).toEqual([PLATFORM]);
    expect(await findByAuthorTeam([CORE])).toBe(0);
    expect(await findByAuthorTeam([PLATFORM])).toBe(1);
  });

  it('**소속이 없어지면 빈 배열이 남는다** — 부재가 아니다', async () => {
    const { client } = githubStub(TEAMS);
    await syncOrgTeamsIfStale({ pool, github: client }, { orgId: ORG, owner: 'authorteams' });
    await project(enrichedPayload(), 'delivery-author-teams-c');

    await teamMembershipRepo.replaceOrgTeamMembership(pool, ORG, [
      { teamId: CORE, slug: 'core', logins: ['bob'] },
    ], new Date());
    await project(enrichedPayload(), 'delivery-author-teams-d', new Date('2026-08-19T11:00:00.000Z'));

    expect((await indexedDoc())['author_team_ids']).toEqual([]);
    expect(await findByAuthorTeam([CORE])).toBe(0);
  });

  it('작성자를 모르는 문서에는 필드가 없다 (DEV-487)', async () => {
    const { client } = githubStub(TEAMS);
    await syncOrgTeamsIfStale({ pool, github: client }, { orgId: ORG, owner: 'authorteams' });
    await project(enrichedPayload({ pull_request: null, enrichment_pending: true }));

    const doc = await indexedDoc();
    expect(Object.keys(doc)).not.toContain('author');
    expect(Object.keys(doc)).not.toContain('author_team_ids');
  });
});

describe('**소속 변경은 새 이벤트가 있어야 문서에 닿는다** (FR-ING-005 AC-1)', () => {
  it('같은 `document_version`으로 다시 투영하면 `noop`이다 — 그래서 DoD의 반영 경로가 재색인·백필이다', async () => {
    const { client } = githubStub(TEAMS);
    await syncOrgTeamsIfStale({ pool, github: client }, { orgId: ORG, owner: 'authorteams' });
    await project(enrichedPayload(), 'delivery-noop-a');
    expect((await indexedDoc())['author_team_ids']).toEqual([CORE, PLATFORM]);

    await teamMembershipRepo.replaceOrgTeamMembership(
      pool,
      ORG,
      [{ teamId: PLATFORM, slug: 'platform', logins: ['alice'] }],
      new Date(),
    );
    // 같은 수신 시각 = 같은 문서 버전. 조건부 업서트가 대입하지 않는다.
    await project(enrichedPayload(), 'delivery-noop-b');

    expect((await indexedDoc())['author_team_ids']).toEqual([CORE, PLATFORM]);
  });
});
