/**
 * 저장소 수집 진단의 접근 범위와 순회 (API-ING-002 / WP-034, CR-050).
 *
 * ## 이 파일이 반증하려는 결함
 *
 * 1. **ADR-008** — PostgreSQL이 이미 범위를 걸렀다는 이유로 Elasticsearch 집계의
 *    필수 필터를 생략하면, 범위 밖 저장소의 문서가 남의 카드에 섞여 세어진다.
 *
 * 2. **순회 도중의 권한 변경** — 지문 없이 이어 보면 회수된 범위의 저장소를
 *    계속 내준다.
 *
 * 3. **해제된 저장소를 숨기는 것**(AC-7) — 그 사실 자체가 사용자가 찾던 답이다.
 *
 * ## `org_team` parity는 여기서 걸지 않는다
 *
 * `toAccessScope`는 저장소가 **500개를 넘을 때만** `org_team` 표현을 준다
 * (`EXPLICIT_SCOPE_LIMIT`). HTTP 경로로 그 표현을 만들려면 픽스처에 저장소
 * 501개가 필요한데, 그렇게 만든 시험은 무엇이 실패했는지 읽기 어렵다. 그래서
 * **DEV-353의 parity는 `scope-parity.test.ts`가 함수 수준에서** 세 경로
 * (`API-ING-002`·`resolveRepository`·`listSequenceSpaces`)에 같은 범위 픽스처를
 * 직접 넣어 건다.
 *
 * 실행: `pnpm test:integration repositories/overview`
 */

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from '@elastic/elasticsearch';
import {
  AccessScopeResolver,
  SESSION_COOKIE_NAME,
  SessionStore,
  createScopeDatabase,
  createSessionId,
  scopeKey,
  type AccessScopeSource,
} from '@prs/authz';
import { applyMappings, createEsClient, resolveClientOptions, switchAliasesForTests } from '@prs/es';
import { authRepo, repositoryRepo, type Pool } from '@prs/db';
import type { Redis } from '@prs/bus';
import { buildServer } from '../../src/server.js';
import { REPOSITORIES_PATH } from '../../src/repositories/routes.js';
import type { AuthContext, AuthRedis } from '../../src/auth/context.js';
import { createTestRedis, migratedPool } from '../helpers.js';
import { TEST_CURSOR_KEY, TEST_CURSOR_SIGNER } from '../_cursor-fixture.js';

const AUTH_CONFIG = {
  enabled: true,
  cookieSecure: true,
  loginPath: '/auth/login',
  groupRoleMap: new Map<string, never>(),
} as const;

const ORG = 9051;
const OTHER_ORG = 9052;
const MY_TEAM = 90510;
const OTHER_TEAM = 90511;

/** 팀 소속으로만 볼 수 있는 비공개 저장소. **DEV-353이 여기서 사라졌다.** */
const TEAM_PRIVATE = 90520;
/** 같은 조직의 비공개지만 남의 팀 것. 보이면 안 된다. */
const FOREIGN_PRIVATE = 90521;
/** 가시성으로 보이는 저장소. */
const INTERNAL = 90522;
/** 다른 조직. 보이면 안 된다. */
const OTHER_ORG_REPO = 90523;
/** 해제됐지만 범위 안이다 — 숨기지 않는다 (AC-7). */
const ARCHIVED = 90524;

/**
 * 스캔 상한을 강제하는 범위 밖 저장소 무리 (PR #62 리뷰 P2, DEV-357).
 *
 * `owner`가 `wp034`보다 사전순으로 앞서므로 **정렬에서 먼저 온다** — 범위 안
 * 저장소가 그 뒤에 있고, 스캔이 상한에서 멈추면 사용자는 자기 저장소를 영영
 * 보지 못한다.
 */
const NOISE_START = 90540;
const NOISE_COUNT = 120;
const NOISE_REPOS = Array.from({ length: NOISE_COUNT }, (_, index) => NOISE_START + index);

const ALL_REPOS = [
  TEAM_PRIVATE,
  FOREIGN_PRIVATE,
  INTERNAL,
  OTHER_ORG_REPO,
  ARCHIVED,
  ...NOISE_REPOS,
];
/** `FULL_USER`가 보는 집합. */
const VISIBLE = [TEAM_PRIVATE, INTERNAL, ARCHIVED];

/** 보이는 셋을 다 가진 사용자. */
const FULL_USER = 'sub-wp034-full';
/** 하나만 가진 사용자. 커서 지문이 갈리는 재료다. */
const LIMITED_USER = 'sub-wp034-limited';
const USERS = [FULL_USER, LIMITED_USER];

let pool: Pool;
let redis: Redis;
let es: Client;
let app: FastifyInstance;
const cookies = new Map<string, Record<string, string>>();

function redisPort(): AuthRedis {
  return {
    get: (key) => redis.get(key),
    set: (key, value, mode, seconds) => redis.set(key, value, mode, seconds),
    del: (...keys) => redis.del(...keys),
    scan: (cursor, m, pattern, c, n) => redis.scan(cursor, m, pattern, c, n),
  };
}

interface OverviewBody {
  readonly items: {
    readonly repository_id: number;
    readonly repository: string;
    readonly registration_state: string;
    readonly document_counts: { total: number; pull_requests: number } | null;
    readonly sequence_spaces: { base_branch: string; sequence_state: string; last_sequence: number | null }[];
    readonly reconciliation: { last_completed_at: string | null; missing_count: number | null };
    readonly unavailable: readonly string[];
  }[];
  readonly next_cursor: string | null;
  readonly error?: { code?: string };
}

async function overview(user: string, query = ''): Promise<OverviewBody> {
  const response = await app.inject({
    method: 'GET',
    url: query === '' ? REPOSITORIES_PATH : `${REPOSITORIES_PATH}?${query}`,
    headers: cookies.get(user) ?? {},
  });
  expect(response.statusCode).toBe(200);
  return response.json<OverviewBody>();
}

function prDocument(repositoryId: number, name: string, prNumber: number): Record<string, unknown> {
  return {
    document_version: 1,
    repository_id: repositoryId,
    repository: name,
    org_id: repositoryId === OTHER_ORG_REPO ? OTHER_ORG : ORG,
    visibility: repositoryId === INTERNAL || repositoryId === ARCHIVED ? 'internal' : 'private',
    allowed_team_ids: repositoryId === TEAM_PRIVATE ? [MY_TEAM] : [OTHER_TEAM],
    pr_number: prNumber,
    title: `wp034 픽스처 #${String(prNumber)}`,
    body: '저장소 진단 시험',
    state: 'merged',
    author: 'wp034-author',
    labels: [],
    base_branch: 'main',
    head_branch: `feature/${String(prNumber)}`,
    merge_seq: prNumber,
    seq_epoch: 1,
    sequence_space: `${name}@main`,
    created_at: '2026-08-01T00:00:00Z',
    updated_at: '2026-08-02T00:00:00Z',
    merged_at: '2026-08-02T00:00:00Z',
    changed_files_count: 1,
    additions: 1,
    deletions: 1,
    changed_paths: ['src/a.ts'],
    indexed_at: '2026-08-27T00:00:00Z',
  };
}

beforeAll(async () => {
  pool = await migratedPool();
  redis = createTestRedis();
  es = createEsClient(resolveClientOptions());
  await applyMappings(es);
  await switchAliasesForTests(es);

  await pool.query('DELETE FROM permission_cache WHERE user_id = ANY($1::text[])', [USERS]);
  await pool.query('DELETE FROM team_member WHERE team_id = ANY($1::bigint[])', [[MY_TEAM, OTHER_TEAM]]);
  await pool.query('DELETE FROM app_user WHERE user_id = ANY($1::text[])', [USERS]);
  await pool.query('DELETE FROM team WHERE team_id = ANY($1::bigint[])', [[MY_TEAM, OTHER_TEAM]]);
  await pool.query('DELETE FROM repository WHERE repository_id = ANY($1::bigint[])', [ALL_REPOS]);

  for (const [userId, login] of [
    [FULL_USER, 'wp034-orgteam'],
    [LIMITED_USER, 'wp034-explicit'],
  ] as const) {
    await authRepo.upsertUserOnLogin(pool, { user_id: userId, login });
  }
  await authRepo.upsertTeam(pool, { team_id: MY_TEAM, slug: 'wp034-mine', org_id: ORG });
  await authRepo.upsertTeam(pool, { team_id: OTHER_TEAM, slug: 'wp034-other', org_id: ORG });
  await authRepo.replaceTeamMembers(pool, MY_TEAM, USERS);

  const fixtures = [
    [TEAM_PRIVATE, 'wp034', 'a-team-private', ORG, 'private', [MY_TEAM]],
    [FOREIGN_PRIVATE, 'wp034', 'b-foreign-private', ORG, 'private', [OTHER_TEAM]],
    [INTERNAL, 'wp034', 'c-internal', ORG, 'internal', []],
    [OTHER_ORG_REPO, 'wp034', 'd-other-org', OTHER_ORG, 'internal', []],
    [ARCHIVED, 'wp034', 'e-archived', ORG, 'internal', []],
  ] as const;

  for (const [id, owner, name, org, visibility, teams] of fixtures) {
    await repositoryRepo.upsertRepository(pool, {
      repository_id: id,
      owner,
      name,
      org_id: org,
      visibility,
      sequence_branches: ['main', 'release'],
    });
    if (teams.length > 0) await repositoryRepo.setAllowedTeams(pool, id, [...teams]);
  }
  await repositoryRepo.setRepositoryStatus(pool, ARCHIVED, 'archived');

  /*
   * 범위 밖 저장소를 정렬 앞쪽에 몰아 둔다 — 스캔 상한이 페이지네이션을
   * 끊는지 재기 위한 재료다 (DEV-357).
   */
  for (const [index, id] of NOISE_REPOS.entries()) {
    await repositoryRepo.upsertRepository(pool, {
      repository_id: id,
      owner: 'aaa-noise',
      name: `repo-${String(index).padStart(4, '0')}`,
      org_id: OTHER_ORG,
      visibility: 'internal',
      sequence_branches: [],
    });
  }

  // 최근 완료된 조정 결과 (FR-ING-011 AC-6).
  await repositoryRepo.recordCompletedReconciliation(
    pool,
    TEAM_PRIVATE,
    0,
    new Date('2026-08-27T23:00:00Z'),
  );
  await repositoryRepo.recordCompletedReconciliation(
    pool,
    INTERNAL,
    3,
    new Date('2026-08-27T22:00:00Z'),
  );

  await es.deleteByQuery({
    index: ['prs-pull-requests'],
    query: { terms: { repository_id: ALL_REPOS } },
    refresh: true,
    conflicts: 'proceed',
  });

  const INDEXED = [TEAM_PRIVATE, FOREIGN_PRIVATE, INTERNAL, OTHER_ORG_REPO, ARCHIVED];
  const operations = INDEXED.flatMap((id, index) => [
    { index: { _index: 'prs-pull-requests', _id: `wp034-${String(id)}`, routing: String(id) } },
    { ...prDocument(id, `wp034/repo-${String(id)}`, index + 1), doc_id: `wp034-${String(id)}` },
  ]);
  const bulk = await es.bulk({ refresh: true, operations });
  if (bulk.errors) {
    const reasons = bulk.items.map((item) => item.index?.error?.reason).filter((one) => one !== undefined);
    throw new Error(`fixture 색인이 거부됐다: ${reasons.join(' / ')}`);
  }

  const sessions = new SessionStore({ redis: redisPort() });
  /*
   * **두 사용자에게 다른 범위를 준다.** 같은 범위를 주면 커서 지문이 갈리지
   * 않아 "남의 커서"를 만들 수 없다.
   *
   * 저장소 수가 `EXPLICIT_SCOPE_LIMIT` 이하라 `toAccessScope`가 둘 다
   * `explicit`으로 만든다 — 그것이 이 경로의 실제 운영 모습이다.
   */
  const source: AccessScopeSource = {
    fetch: async (user) => ({
      repositoryIds: user.userId === FULL_USER ? [...VISIBLE] : [INTERNAL],
      orgIds: [],
      teamIds: [MY_TEAM],
      visibilities: [],
    }),
  };

  const auth: AuthContext = {
    sessions,
    scopes: new AccessScopeResolver({ redis: redisPort(), db: createScopeDatabase(pool), source }),
    forget: async (ids) => {
      if (ids.length > 0) await redis.del(...ids.map(scopeKey));
    },
  };

  for (const userId of USERS) {
    const sessionId = createSessionId();
    await sessions.create({
      sessionId,
      userId,
      login: userId,
      email: null,
      roles: ['developer'],
      issuedAt: Date.now(),
      lastSeenAt: Date.now(),
      correlationId: null,
    });
    cookies.set(userId, { cookie: `${SESSION_COOKIE_NAME}=${sessionId}` });
  }

  app = buildServer({
    config: {
      port: 0,
      adminTokens: [],
      metricsQueryUrl: null,
      gheBaseUrl: null,
      auth: AUTH_CONFIG,
      searchCursorKey: TEST_CURSOR_KEY,
    },
    auth,
    search: {
      es,
      cursorSigner: TEST_CURSOR_SIGNER,
      resolveNames: async () => ({ orgIds: new Map(), teamIds: new Map() }),
      resolveTeamSlugs: (ids) => authRepo.resolveTeamSlugs(pool, ids),
    },
    repositories: { pool, es, cursorSigner: TEST_CURSOR_SIGNER },
  });
  await app.ready();
}, 180_000);

afterAll(async () => {
  await pool?.query('DELETE FROM team_member WHERE team_id = ANY($1::bigint[])', [[MY_TEAM, OTHER_TEAM]]);
  await pool?.query('DELETE FROM permission_cache WHERE user_id = ANY($1::text[])', [USERS]);
  await pool?.query('DELETE FROM app_user WHERE user_id = ANY($1::text[])', [USERS]);
  await pool?.query('DELETE FROM team WHERE team_id = ANY($1::bigint[])', [[MY_TEAM, OTHER_TEAM]]);
  await pool?.query('DELETE FROM repository WHERE repository_id = ANY($1::bigint[])', [ALL_REPOS]);
  await es?.deleteByQuery({
    index: ['prs-pull-requests'],
    query: { terms: { repository_id: ALL_REPOS } },
    refresh: true,
    conflicts: 'proceed',
  });
  await app?.close();
  await es?.close();
  redis?.disconnect();
  await pool?.end();
});

describe('접근 범위 (FR-AUTH-002)', () => {
  it('범위 안 저장소만 보인다', async () => {
    const body = await overview(FULL_USER, 'limit=100');
    const ids = body.items.map((item) => item.repository_id).sort((a, b) => a - b);
    expect(ids).toEqual([...VISIBLE].sort((a, b) => a - b));
  });

  it('남의 팀 비공개 저장소는 보이지 않는다', async () => {
    const body = await overview(FULL_USER, 'limit=100');
    expect(body.items.map((item) => item.repository_id)).not.toContain(FOREIGN_PRIVATE);
  });

  it('다른 조직 저장소는 보이지 않는다', async () => {
    const body = await overview(FULL_USER, 'limit=100');
    expect(body.items.map((item) => item.repository_id)).not.toContain(OTHER_ORG_REPO);
  });

  it('**범위가 좁은 사용자는 그만큼만 본다**', async () => {
    const body = await overview(LIMITED_USER, 'limit=100');
    expect(body.items.map((item) => item.repository_id)).toEqual([INTERNAL]);
  });

  it('**해제된 저장소도 범위 안이면 보인다** (AC-7) — 그 사실이 사용자가 찾던 답이다', async () => {
    const body = await overview(FULL_USER, 'limit=100');
    const archived = body.items.find((item) => item.repository_id === ARCHIVED);
    expect(archived).toBeDefined();
    expect(archived?.registration_state).toBe('archived');
  });

  it('**범위 밖 건수를 알리지 않는다** — 가려진 저장소의 존재 자체가 새지 않는다', async () => {
    const body = await overview(FULL_USER, 'limit=100');
    expect(JSON.stringify(body)).not.toContain(String(FOREIGN_PRIVATE));
    expect(JSON.stringify(body)).not.toContain(String(OTHER_ORG_REPO));
  });

  it('**exact 조회도 범위를 지난다** — 미등록과 볼 수 없음을 구분하지 않는다', async () => {
    const hidden = await overview(FULL_USER, 'repository=wp034%2Fb-foreign-private');
    const absent = await overview(FULL_USER, 'repository=wp034%2Fdoes-not-exist');
    expect(hidden.items).toHaveLength(0);
    expect(absent.items).toHaveLength(0);
    // 두 응답이 같은 모양이라 조회자가 둘을 가를 수 없다.
    expect(hidden.next_cursor).toBe(absent.next_cursor);
  });
});

describe('Elasticsearch 집계도 필수 필터를 지난다 (ADR-008)', () => {
  it('**범위 밖 저장소의 문서가 세어지지 않는다** — PG가 걸렀다는 이유로 생략하지 않는다', async () => {
    const body = await overview(FULL_USER, 'limit=100');
    for (const item of body.items) {
      expect(item.document_counts).not.toBeNull();
    }
    // 보이는 저장소마다 픽스처 문서가 하나씩이다.
    const visible = body.items.find((item) => item.repository_id === TEAM_PRIVATE);
    expect(visible?.document_counts?.pull_requests).toBe(1);
  });
});

describe('진단 축', () => {
  it('**등록된 브랜치를 전부 싣는다** — 채번 안 된 것은 `unknown`이지 0이 아니다', async () => {
    const body = await overview(FULL_USER, 'limit=100');
    const item = body.items.find((one) => one.repository_id === TEAM_PRIVATE);
    expect(item?.sequence_spaces.map((space) => space.base_branch)).toEqual(['main', 'release']);
    for (const space of item?.sequence_spaces ?? []) {
      expect(space.sequence_state).toBe('unknown');
      expect(space.last_sequence).toBeNull();
    }
  });

  it('**최근 완료된 조정 결과를 그대로 준다** — 0과 null이 다르다', async () => {
    const body = await overview(FULL_USER, 'limit=100');
    const zero = body.items.find((one) => one.repository_id === TEAM_PRIVATE);
    const three = body.items.find((one) => one.repository_id === INTERNAL);
    const none = body.items.find((one) => one.repository_id === ARCHIVED);
    expect(zero?.reconciliation.missing_count).toBe(0);
    expect(three?.reconciliation.missing_count).toBe(3);
    expect(none?.reconciliation.missing_count).toBeNull();
    expect(none?.reconciliation.last_completed_at).toBeNull();
  });

  it('정상 응답에는 미확인 항목이 없다', async () => {
    const body = await overview(FULL_USER, 'limit=100');
    for (const item of body.items) expect(item.unavailable).toEqual([]);
  });
});

describe('커서 순회 (ADR-010)', () => {
  it('**끝까지 순회해 중복·누락이 없다**', async () => {
    const seen: number[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 10; page += 1) {
      const query: string = cursor === null ? 'limit=1' : `limit=1&cursor=${encodeURIComponent(cursor)}`;
      const body: OverviewBody = await overview(FULL_USER, query);
      seen.push(...body.items.map((item) => item.repository_id));
      cursor = body.next_cursor;
      if (cursor === null) break;
    }
    expect([...seen].sort((a, b) => a - b)).toEqual([...VISIBLE].sort((a, b) => a - b));
    expect(new Set(seen).size, '중복이 있다').toBe(seen.length);
  });

  it('**정렬이 owner·name·id 오름차순이다**', async () => {
    const body = await overview(FULL_USER, 'limit=100');
    const names = body.items.map((item) => item.repository);
    expect(names).toEqual([...names].sort());
  });

  it('**남의 커서는 지문 불일치다** — 다른 범위의 위치를 이어 볼 수 없다', async () => {
    const first = await overview(FULL_USER, 'limit=1');
    expect(first.next_cursor).not.toBeNull();
    const response = await app.inject({
      method: 'GET',
      url: `${REPOSITORIES_PATH}?limit=1&cursor=${encodeURIComponent(first.next_cursor as string)}`,
      headers: cookies.get(LIMITED_USER) ?? {},
    });
    expect(response.statusCode).toBe(400);
    expect(response.json<OverviewBody>().error?.code).toBe('CURSOR_QUERY_MISMATCH');
  });

  it('**필터가 바뀌면 이어 볼 수 없다**', async () => {
    const first = await overview(FULL_USER, 'limit=1');
    const response = await app.inject({
      method: 'GET',
      url: `${REPOSITORIES_PATH}?limit=1&repository=wp034%2Fc-internal&cursor=${encodeURIComponent(
        first.next_cursor as string,
      )}`,
      headers: cookies.get(FULL_USER) ?? {},
    });
    expect(response.statusCode).toBe(400);
    expect(response.json<OverviewBody>().error?.code).toBe('CURSOR_QUERY_MISMATCH');
  });

  it('훼손된 커서는 CURSOR_INVALID다', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `${REPOSITORIES_PATH}?cursor=not-a-real-cursor`,
      headers: cookies.get(FULL_USER) ?? {},
    });
    expect(response.statusCode).toBe(400);
    expect(response.json<OverviewBody>().error?.code).toBe('CURSOR_INVALID');
  });

  it('**오프셋 파라미터를 지원하지 않는다** (ADR-010)', async () => {
    const withOffset = await overview(FULL_USER, 'limit=100&offset=2');
    const without = await overview(FULL_USER, 'limit=100');
    // 무시될 뿐 페이지를 건너뛰지 않는다.
    expect(withOffset.items.map((item) => item.repository_id)).toEqual(
      without.items.map((item) => item.repository_id),
    );
  });

  it('**스캔 상한이 순회를 끊지 않는다** — 범위 밖이 몰려 있어도 끝까지 닿는다 (DEV-357)', async () => {
    /*
     * 정렬 앞쪽에 범위 밖 저장소 120개가 있다. 접근 범위 판정이 SQL이 아니라
     * 애플리케이션에 있으므로 한 요청이 그것을 다 건너뛰지 못할 수 있는데,
     * **그때 `next_cursor`를 비우면 뒤에 있는 저장소가 영영 사라진다.**
     * 빈 페이지 + 유효한 커서는 커서 순회의 정상 상태다.
     */
    const seen: number[] = [];
    let cursor: string | null = null;
    let pages = 0;

    for (; pages < 40; pages += 1) {
      const query: string = cursor === null ? 'limit=1' : `limit=1&cursor=${encodeURIComponent(cursor)}`;
      const body: OverviewBody = await overview(FULL_USER, query);
      seen.push(...body.items.map((item) => item.repository_id));
      cursor = body.next_cursor;
      if (cursor === null) break;
    }

    expect([...seen].sort((a, b) => a - b), 'DEV-357: 범위 밖 무리 뒤의 저장소가 사라졌다').toEqual(
      [...VISIBLE].sort((a, b) => a - b),
    );
    expect(new Set(seen).size, '중복이 있다').toBe(seen.length);
  });

  it('limit 범위를 벗어나면 400이다', async () => {
    for (const bad of ['0', '101', 'abc']) {
      const response = await app.inject({
        method: 'GET',
        url: `${REPOSITORIES_PATH}?limit=${bad}`,
        headers: cookies.get(FULL_USER) ?? {},
      });
      expect(response.statusCode, `limit=${bad}`).toBe(400);
      expect(response.json<OverviewBody>().error?.code).toBe('INVALID_PARAMETER');
    }
  });
});

describe('인증', () => {
  it('세션이 없으면 401이다 — 관리자 토큰으로 열리지 않는다', async () => {
    const response = await app.inject({ method: 'GET', url: REPOSITORIES_PATH });
    expect(response.statusCode).toBe(401);
  });
});
