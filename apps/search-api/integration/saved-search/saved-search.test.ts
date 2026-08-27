/**
 * 저장된 검색 — 실제 Fastify + PostgreSQL + Redis (WP-033 / API-SRCH-005, CR-049).
 *
 * ## 이 파일이 지키는 주장
 *
 * 이 기능의 위험은 검색 정확도가 아니라 **공유가 새는 것**이다. `visibility`가
 * `team`인 행 하나가 잘못된 팀에 보이면 그 팀 전체가 남의 조사 조건을 읽는다.
 * 그래서 여기 있는 시험 대부분이 "보이지 않아야 한다"를 건다 — 보이는 것보다
 * 보이지 않는 것을 증명하기가 어렵고, 그 실패는 조용하다.
 *
 * `app.inject`로 진짜 HTTP 경로를 탄다. 리포지터리 함수를 직접 부르면
 * "라우트가 그 함수를 부른다"를 증명하지 못한다 (CR-034, DEV-177의 교훈).
 *
 * 실행: `pnpm test:integration saved-search`
 */

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  AccessScopeResolver,
  SESSION_COOKIE_NAME,
  SessionStore,
  createScopeDatabase,
  createSessionId,
  scopeKey,
  type SessionRecord,
} from '@prs/authz';
import { authRepo, savedSearchRepo, type Pool } from '@prs/db';
import type { Redis } from '@prs/bus';
import { buildServer } from '../../src/server.js';
import type { AuthContext, AuthRedis } from '../../src/auth/context.js';
import {
  SAVED_SEARCHES_PATH,
  SAVED_SEARCH_ITEM_PATH,
  SHARE_TARGETS_PATH,
} from '../../src/saved-search/routes.js';
import {
  computeSavedSearchFingerprint,
  encodeSavedSearchCursor,
} from '../../src/saved-search/cursor.js';
import { createTestRedis, migratedPool } from '../helpers.js';
import { TEST_CURSOR_KEY, TEST_CURSOR_SIGNER } from '../_cursor-fixture.js';

const AUTH_CONFIG = {
  enabled: true,
  cookieSecure: true,
  loginPath: '/auth/login',
  groupRoleMap: new Map<string, never>(),
} as const;

/** 이 파일 전용 식별자. 공유 DB에서 다른 시험과 겹치지 않는다 (risks 30). */
const OWNER_USER = 'sub-wp033-owner';
const TEAMMATE_USER = 'sub-wp033-teammate';
const OUTSIDER_USER = 'sub-wp033-outsider';
const USERS = [OWNER_USER, TEAMMATE_USER, OUTSIDER_USER];

const TEAM_MAIN = 90331;
const TEAM_OTHER = 90332;
/** 같은 `slug`, 다른 조직 — DEV-331이 드러낸 자리. */
const TEAM_TWIN = 90333;
const TEAMS = [TEAM_MAIN, TEAM_OTHER, TEAM_TWIN];

const ORG_A = 9031;
const ORG_B = 9032;

let pool: Pool;
let redis: Redis;
let app: FastifyInstance;
let sessions: SessionStore;

function authRedis(client: Redis): AuthRedis {
  return {
    get: (key) => client.get(key),
    set: (key, value, mode, seconds) => client.set(key, value, mode, seconds),
    del: (...keys) => client.del(...keys),
    scan: (cursor, m, pattern, c, n) => client.scan(cursor, m, pattern, c, n),
  };
}

async function login(userId: string): Promise<string> {
  const sessionId = createSessionId();
  const now = Date.now();
  const record: SessionRecord = {
    sessionId,
    userId,
    login: userId,
    email: `${userId}@acme.example`,
    roles: ['developer'],
    issuedAt: now,
    lastSeenAt: now,
    correlationId: null,
  };
  await sessions.create(record);
  return sessionId;
}

function cookie(sessionId: string): Record<string, string> {
  return { cookie: `${SESSION_COOKIE_NAME}=${sessionId}` };
}

let ownerCookie: Record<string, string>;
let teammateCookie: Record<string, string>;
let outsiderCookie: Record<string, string>;

interface SavedSearchBody {
  saved_search_id: number;
  name: string;
  query: string;
  visibility: string;
  target_team?: { team_id: number; org_id: number; slug: string };
  owner: { user_id: string; login: string };
  is_owner: boolean;
  query_status: string;
  query_error?: { code: string; detail: { offset_start: number } };
  created_at: string;
  last_run_at: string | null;
}

interface ListBody {
  view: string;
  items: SavedSearchBody[];
  next_cursor: string | null;
}

interface ErrorBody {
  error: { code: string; message: string; detail?: Record<string, unknown> };
}

async function create(
  headers: Record<string, string>,
  payload: Record<string, unknown>,
): Promise<{ status: number; body: SavedSearchBody & ErrorBody }> {
  const response = await app.inject({
    method: 'POST',
    url: SAVED_SEARCHES_PATH,
    headers: { ...headers, 'content-type': 'application/json' },
    payload,
  });
  return { status: response.statusCode, body: response.json() };
}

async function list(
  headers: Record<string, string>,
  query: Record<string, string>,
): Promise<{ status: number; body: ListBody & ErrorBody }> {
  const params = new URLSearchParams(query).toString();
  const response = await app.inject({
    method: 'GET',
    url: `${SAVED_SEARCHES_PATH}?${params}`,
    headers,
  });
  return { status: response.statusCode, body: response.json() };
}

function itemUrl(id: number): string {
  return SAVED_SEARCH_ITEM_PATH.replace(':saved_search_id', String(id));
}

beforeAll(async () => {
  pool = await migratedPool();
  redis = createTestRedis();

  const redisPort = authRedis(redis);
  sessions = new SessionStore({ redis: redisPort });

  const auth: AuthContext = {
    sessions,
    scopes: new AccessScopeResolver({
      redis: redisPort,
      db: createScopeDatabase(pool),
      source: {
        fetch: async () => ({
          repositoryIds: [1],
          orgIds: [ORG_A],
          teamIds: [TEAM_MAIN],
          visibilities: ['public', 'internal'],
        }),
      },
    }),
    forget: async (userIds) => {
      if (userIds.length > 0) await redis.del(...userIds.map(scopeKey));
    },
  };

  app = buildServer({
    config: {
      port: 0,
      adminTokens: [],
      metricsQueryUrl: null,
      gheBaseUrl: null,
      auth: AUTH_CONFIG,
      searchCursorKey: TEST_CURSOR_KEY,
    },
    ops: { pool, bus: undefined as never },
    auth,
    savedSearch: { pool, cursorSigner: TEST_CURSOR_SIGNER },
  });
  await app.ready();

  ownerCookie = cookie(await login(OWNER_USER));
  teammateCookie = cookie(await login(TEAMMATE_USER));
  outsiderCookie = cookie(await login(OUTSIDER_USER));
}, 180_000);

afterAll(async () => {
  /*
   * **자기 픽스처를 남기지 않는다.**
   *
   * `saved_search`가 `app_user`를 참조하므로, 남긴 행이 있으면 뒤이어 도는
   * 다른 파일의 `DELETE FROM app_user`가 외래 키 위반으로 실패한다 — 실제로
   * 전 계층 통합에서 여덟 파일이 그렇게 죽었다. `team` 참조도 같다.
   */
  await pool?.query('DELETE FROM saved_search WHERE owner_user_id = ANY($1::text[])', [USERS]);
  await pool?.query('DELETE FROM team_member WHERE team_id = ANY($1::bigint[])', [TEAMS]);
  // 접근 범위 해석기가 이 표를 채운다 — 사용자를 지우기 전에 비워야 한다.
  await pool?.query('DELETE FROM permission_cache WHERE user_id = ANY($1::text[])', [USERS]);
  await pool?.query('DELETE FROM app_user WHERE user_id = ANY($1::text[])', [USERS]);
  await pool?.query('DELETE FROM team WHERE team_id = ANY($1::bigint[])', [TEAMS]);

  await app?.close();
  await redis?.quit();
  await pool?.end();
});

beforeEach(async () => {
  /*
   * **내 픽스처만 지운다.** 전역 삭제는 같은 DB를 쓰는 다른 시험 파일의 행을
   * 날리고, 그 실패는 이 파일과 상관없는 곳에서 터진다 (risks 30).
   */
  await pool.query('DELETE FROM saved_search WHERE owner_user_id = ANY($1::text[])', [USERS]);
  await pool.query('DELETE FROM team_member WHERE team_id = ANY($1::bigint[])', [TEAMS]);
  await pool.query('DELETE FROM team WHERE team_id = ANY($1::bigint[])', [TEAMS]);
  await pool.query('DELETE FROM app_user WHERE user_id = ANY($1::text[])', [USERS]);

  for (const userId of USERS) {
    await authRepo.upsertUserOnLogin(pool, { user_id: userId, login: userId });
  }

  await authRepo.upsertTeam(pool, { team_id: TEAM_MAIN, slug: 'payments', org_id: ORG_A });
  await authRepo.upsertTeam(pool, { team_id: TEAM_OTHER, slug: 'platform', org_id: ORG_A });
  // 같은 이름, 다른 조직. `team_id`가 정체성이라는 것을 이 팀이 건다.
  await authRepo.upsertTeam(pool, { team_id: TEAM_TWIN, slug: 'payments', org_id: ORG_B });

  await authRepo.replaceTeamMembers(pool, TEAM_MAIN, [OWNER_USER, TEAMMATE_USER]);
  await authRepo.replaceTeamMembers(pool, TEAM_OTHER, [OUTSIDER_USER]);
  await authRepo.replaceTeamMembers(pool, TEAM_TWIN, [OUTSIDER_USER]);
});

/* ------------------------------------------------------------------ */

describe('생성 (API-SRCH-005 POST / FR-SRCH-010 AC-1)', () => {
  it('이름·질의·공개 범위를 저장하고, team이면 대상 팀이 함께 실린다', async () => {
    const { status, body } = await create(ownerCookie, {
      name: '결제 월간 리뷰',
      query: 'repo:acme/payments',
      visibility: 'team',
      team_id: TEAM_MAIN,
    });

    expect(status).toBe(201);
    expect(body.name).toBe('결제 월간 리뷰');
    expect(body.visibility).toBe('team');
    expect(body.target_team).toEqual({ team_id: TEAM_MAIN, org_id: ORG_A, slug: 'payments' });
    expect(body.owner.user_id).toBe(OWNER_USER);
    expect(body.is_owner).toBe(true);
    expect(body.query_status).toBe('valid');
    expect(body.last_run_at).toBeNull();
  });

  it('private에는 대상 팀이 없다', async () => {
    const { status, body } = await create(ownerCookie, {
      name: '내 것',
      query: 'repo:acme/payments',
      visibility: 'private',
    });
    expect(status).toBe(201);
    expect(body.target_team).toBeUndefined();
  });

  it('**소유자를 본문에서 받지 않는다** — 남의 이름으로 저장할 수 없다', async () => {
    const { status, body } = await create(ownerCookie, {
      name: '위조 시도',
      query: 'repo:acme/payments',
      visibility: 'private',
      owner_user_id: TEAMMATE_USER,
    });
    expect(status).toBe(201);
    expect(body.owner.user_id).toBe(OWNER_USER);
  });

  it('team인데 대상이 없으면 400이다 (마이그레이션 015의 불변식)', async () => {
    const { status, body } = await create(ownerCookie, {
      name: '대상 없음',
      query: 'repo:acme/payments',
      visibility: 'team',
    });
    expect(status).toBe(400);
    expect(body.error.code).toBe('INVALID_PARAMETER');
  });

  it('private인데 대상이 있으면 400이다', async () => {
    const { status } = await create(ownerCookie, {
      name: '뜻 없는 조합',
      query: 'repo:acme/payments',
      visibility: 'private',
      team_id: TEAM_MAIN,
    });
    expect(status).toBe(400);
  });

  it('**구성원이 아닌 팀에는 공유할 수 없다** — 요청이 보낸 team_id를 믿지 않는다', async () => {
    const { status, body } = await create(ownerCookie, {
      name: '남의 팀',
      query: 'repo:acme/payments',
      visibility: 'team',
      team_id: TEAM_OTHER,
    });
    expect(status).toBe(400);
    expect(body.error.code).toBe('INVALID_PARAMETER');
    expect(await savedSearchRepo.countOwnedSavedSearches(pool, OWNER_USER)).toBe(0);
  });

  it('문법 오류가 있는 질의는 저장되지 않고 오류 위치를 준다 (AC-6)', async () => {
    const { status, body } = await create(ownerCookie, {
      name: '깨진 질의',
      query: 'nosuchkey:value',
      visibility: 'private',
    });
    expect(status).toBe(400);
    expect(body.error.code).toBe('QUERY_SYNTAX_ERROR');
    expect(body.error.detail?.['offset_start']).toBeTypeOf('number');
    expect(await savedSearchRepo.countOwnedSavedSearches(pool, OWNER_USER)).toBe(0);
  });

  it('같은 이름을 다시 저장하면 409 SAVED_SEARCH_NAME_CONFLICT다', async () => {
    await create(ownerCookie, { name: '같은 이름', query: 'repo:acme/a', visibility: 'private' });
    const { status, body } = await create(ownerCookie, {
      name: '같은 이름',
      query: 'repo:acme/b',
      visibility: 'private',
    });
    expect(status).toBe(409);
    expect(body.error.code).toBe('SAVED_SEARCH_NAME_CONFLICT');
  });

  it('**이름 유일성은 소유자별이다** — 다른 사람이 같은 이름을 쓸 수 있다', async () => {
    await create(ownerCookie, { name: '공용 이름', query: 'repo:acme/a', visibility: 'private' });
    const { status } = await create(teammateCookie, {
      name: '공용 이름',
      query: 'repo:acme/a',
      visibility: 'private',
    });
    expect(status).toBe(201);
  });

  it('공백뿐인 이름은 거절한다', async () => {
    const { status } = await create(ownerCookie, {
      name: '   ',
      query: 'repo:acme/a',
      visibility: 'private',
    });
    expect(status).toBe(400);
  });
});

/* ------------------------------------------------------------------ */

describe('스키마 불변식 (마이그레이션 015 / DEV-335)', () => {
  it('**`private`인데 대상 팀이 있는 행을 거절한다**', async () => {
    await expect(
      pool.query(
        `INSERT INTO saved_search (owner_user_id, name, query, visibility, team_id)
         VALUES ($1, '뜻 없는 조합', 'repo:acme/a', 'private', $2)`,
        [OWNER_USER, TEAM_MAIN],
      ),
    ).rejects.toThrow(/saved_search_team_target_chk/);
  });

  it('**`team`인데 대상이 없는 행을 거절한다** — 공유한다는데 대상이 없다', async () => {
    await expect(
      pool.query(
        `INSERT INTO saved_search (owner_user_id, name, query, visibility)
         VALUES ($1, '대상 없는 공유', 'repo:acme/a', 'team')`,
        [OWNER_USER],
      ),
    ).rejects.toThrow(/saved_search_team_target_chk/);
  });

  it('올바른 두 조합은 받아들인다', async () => {
    await pool.query(
      `INSERT INTO saved_search (owner_user_id, name, query, visibility)
       VALUES ($1, '정상 private', 'repo:acme/a', 'private')`,
      [OWNER_USER],
    );
    await pool.query(
      `INSERT INTO saved_search (owner_user_id, name, query, visibility, team_id)
       VALUES ($1, '정상 team', 'repo:acme/a', 'team', $2)`,
      [OWNER_USER, TEAM_MAIN],
    );
    expect(await savedSearchRepo.countOwnedSavedSearches(pool, OWNER_USER)).toBe(2);
  });

  it('**모르는 공개 범위는 015가 먼저 거절한다** — 004의 CHECK보다 촘촘하다', async () => {
    /*
     * `'org'`는 `private`도 `team`도 아니므로 015의 두 갈래가 모두 거짓이다.
     * 004의 `visibility` CHECK도 같은 행을 거절하지만 **015가 먼저 걸린다** —
     * 둘 중 어느 것이 먼저인지는 제약 평가 순서에 달려 있고, 중요한 것은
     * 그 행이 들어가지 않는다는 사실이다. 제약 이름을 핀으로 박으면 나중에
     * 순서가 바뀔 때 이 시험이 사실이 아니라 순서를 지키게 된다.
     */
    await expect(
      pool.query(
        `INSERT INTO saved_search (owner_user_id, name, query, visibility)
         VALUES ($1, '없는 범위', 'repo:acme/a', 'org')`,
        [OWNER_USER],
      ),
    ).rejects.toThrow(/violates check constraint/);
    expect(await savedSearchRepo.countOwnedSavedSearches(pool, OWNER_USER)).toBe(0);
  });
});

describe('공유 격리 (AC-2 / THR-012)', () => {
  it('**private은 남에게 보이지 않는다** — 단건도 목록도', async () => {
    const created = await create(ownerCookie, {
      name: '비공개',
      query: 'repo:acme/a',
      visibility: 'private',
    });
    const id = created.body.saved_search_id;

    const single = await app.inject({ method: 'GET', url: itemUrl(id), headers: teammateCookie });
    expect(single.statusCode).toBe(404);

    const shared = await list(teammateCookie, { view: 'team' });
    expect(shared.body.items).toHaveLength(0);
  });

  it('team 공개는 **대상 팀의 현재 구성원**에게 보인다', async () => {
    const created = await create(ownerCookie, {
      name: '팀 공유',
      query: 'repo:acme/a',
      visibility: 'team',
      team_id: TEAM_MAIN,
    });
    const id = created.body.saved_search_id;

    const single = await app.inject({ method: 'GET', url: itemUrl(id), headers: teammateCookie });
    expect(single.statusCode).toBe(200);
    expect(single.json<SavedSearchBody>().is_owner).toBe(false);

    const shared = await list(teammateCookie, { view: 'team' });
    expect(shared.body.items.map((one) => one.saved_search_id)).toEqual([id]);
  });

  it('**다른 팀 사용자에게는 404다** — 403이 아니다 (존재를 흘리지 않는다)', async () => {
    const created = await create(ownerCookie, {
      name: '팀 공유',
      query: 'repo:acme/a',
      visibility: 'team',
      team_id: TEAM_MAIN,
    });

    const single = await app.inject({
      method: 'GET',
      url: itemUrl(created.body.saved_search_id),
      headers: outsiderCookie,
    });
    expect(single.statusCode).toBe(404);
    expect(single.json<ErrorBody>().error.code).toBe('NOT_FOUND');
  });

  it('**같은 slug의 다른 조직 팀으로 새지 않는다** (DEV-331 계열)', async () => {
    /*
     * `TEAM_TWIN`은 `TEAM_MAIN`과 이름이 같고 조직만 다르다. 대상을 이름으로
     * 판정하면 그 팀의 구성원(OUTSIDER)에게 보인다 — `team_id`가 정체성이므로
     * 보이지 않아야 한다.
     */
    await create(ownerCookie, {
      name: '팀 공유',
      query: 'repo:acme/a',
      visibility: 'team',
      team_id: TEAM_MAIN,
    });

    const shared = await list(outsiderCookie, { view: 'team' });
    expect(shared.body.items).toHaveLength(0);
  });

  it('**내가 소유한 team 검색은 team 목록에 나타나지 않는다** — 두 목록이 배타다', async () => {
    const created = await create(ownerCookie, {
      name: '내가 만든 팀 공유',
      query: 'repo:acme/a',
      visibility: 'team',
      team_id: TEAM_MAIN,
    });

    const mine = await list(ownerCookie, { view: 'mine' });
    expect(mine.body.items.map((one) => one.saved_search_id)).toEqual([created.body.saved_search_id]);

    const shared = await list(ownerCookie, { view: 'team' });
    expect(shared.body.items).toHaveLength(0);
  });

  it('팀에서 회수되면 **그 순간부터** 보이지 않는다', async () => {
    const created = await create(ownerCookie, {
      name: '팀 공유',
      query: 'repo:acme/a',
      visibility: 'team',
      team_id: TEAM_MAIN,
    });
    const id = created.body.saved_search_id;

    expect(
      (await app.inject({ method: 'GET', url: itemUrl(id), headers: teammateCookie })).statusCode,
    ).toBe(200);

    await authRepo.replaceTeamMembers(pool, TEAM_MAIN, [OWNER_USER]);

    expect(
      (await app.inject({ method: 'GET', url: itemUrl(id), headers: teammateCookie })).statusCode,
    ).toBe(404);
  });
});

/* ------------------------------------------------------------------ */

describe('소유권 — 공유는 읽기·실행 권한이지 소유권 이전이 아니다 (AC-2)', () => {
  let sharedId: number;

  beforeEach(async () => {
    const created = await create(ownerCookie, {
      name: '팀 공유',
      query: 'repo:acme/a',
      visibility: 'team',
      team_id: TEAM_MAIN,
    });
    sharedId = created.body.saved_search_id;
  });

  it('**공유받은 사람은 수정할 수 없다** — 화면이 액션을 감추는 것과 별개로 서버가 막는다', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: itemUrl(sharedId),
      headers: { ...teammateCookie, 'content-type': 'application/json' },
      payload: { name: '가로챈 이름' },
    });
    expect(response.statusCode).toBe(404);

    const still = await app.inject({ method: 'GET', url: itemUrl(sharedId), headers: ownerCookie });
    expect(still.json<SavedSearchBody>().name).toBe('팀 공유');
  });

  it('**공유받은 사람은 삭제할 수 없다**', async () => {
    const response = await app.inject({
      method: 'DELETE',
      url: itemUrl(sharedId),
      headers: teammateCookie,
    });
    expect(response.statusCode).toBe(404);
    expect(await savedSearchRepo.countOwnedSavedSearches(pool, OWNER_USER)).toBe(1);
  });

  it('저장자는 수정·삭제할 수 있다', async () => {
    const patched = await app.inject({
      method: 'PATCH',
      url: itemUrl(sharedId),
      headers: { ...ownerCookie, 'content-type': 'application/json' },
      payload: { name: '고친 이름' },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json<SavedSearchBody>().name).toBe('고친 이름');

    const deleted = await app.inject({
      method: 'DELETE',
      url: itemUrl(sharedId),
      headers: ownerCookie,
    });
    expect(deleted.statusCode).toBe(204);
  });

  it('`is_owner`가 요청한 사람에 따라 다르다', async () => {
    const asOwner = await app.inject({ method: 'GET', url: itemUrl(sharedId), headers: ownerCookie });
    const asViewer = await app.inject({
      method: 'GET',
      url: itemUrl(sharedId),
      headers: teammateCookie,
    });
    expect(asOwner.json<SavedSearchBody>().is_owner).toBe(true);
    expect(asViewer.json<SavedSearchBody>().is_owner).toBe(false);
  });
});

/* ------------------------------------------------------------------ */

describe('저장자가 대상 팀에서 이탈한 뒤 (AC-7)', () => {
  let sharedId: number;

  beforeEach(async () => {
    const created = await create(ownerCookie, {
      name: '팀 공유',
      query: 'repo:acme/a',
      visibility: 'team',
      team_id: TEAM_MAIN,
    });
    sharedId = created.body.saved_search_id;
    // 저장자만 팀에서 뺀다. 공유받은 구성원은 그대로 남는다.
    await authRepo.replaceTeamMembers(pool, TEAM_MAIN, [TEAMMATE_USER]);
  });

  it('**시스템이 자동으로 지우거나 private으로 바꾸지 않는다**', async () => {
    const row = await savedSearchRepo.findVisibleSavedSearch(pool, sharedId, OWNER_USER);
    expect(row?.visibility).toBe('team');
    expect(row?.team_id).toBe(TEAM_MAIN);
  });

  it('대상 팀의 현재 구성원에게는 계속 보인다', async () => {
    const response = await app.inject({
      method: 'GET',
      url: itemUrl(sharedId),
      headers: teammateCookie,
    });
    expect(response.statusCode).toBe(200);
  });

  it('저장자는 여전히 자기 것을 본다', async () => {
    const response = await app.inject({ method: 'GET', url: itemUrl(sharedId), headers: ownerCookie });
    expect(response.statusCode).toBe(200);
  });

  it('**그 팀을 대상으로 남기는 수정은 거절된다** — 이름만 고쳐도 그렇다', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: itemUrl(sharedId),
      headers: { ...ownerCookie, 'content-type': 'application/json' },
      payload: { name: '이름만 고친다' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json<ErrorBody>().error.code).toBe('INVALID_PARAMETER');
  });

  it('**private 전환은 된다**', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: itemUrl(sharedId),
      headers: { ...ownerCookie, 'content-type': 'application/json' },
      payload: { visibility: 'private' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json<SavedSearchBody>().visibility).toBe('private');
    expect(response.json<SavedSearchBody>().target_team).toBeUndefined();
  });

  it('**삭제는 된다** — 자기 자산을 치우는 일을 막을 이유가 없다', async () => {
    const response = await app.inject({
      method: 'DELETE',
      url: itemUrl(sharedId),
      headers: ownerCookie,
    });
    expect(response.statusCode).toBe(204);
  });
});

/* ------------------------------------------------------------------ */

describe('100건 상한 (AC-4 / DEV-336)', () => {
  async function seed(count: number): Promise<void> {
    for (let index = 0; index < count; index += 1) {
      const outcome = await savedSearchRepo.createSavedSearch(pool, {
        ownerUserId: OWNER_USER,
        name: `채움-${String(index)}`,
        query: 'repo:acme/a',
        visibility: 'private',
      });
      if (outcome.kind !== 'created') throw new Error(`픽스처 생성 실패: ${outcome.kind}`);
    }
  }

  it('100건에서 한 건 더 저장하면 409 SAVED_SEARCH_LIMIT이다', async () => {
    await seed(100);
    const { status, body } = await create(ownerCookie, {
      name: '백한 번째',
      query: 'repo:acme/a',
      visibility: 'private',
    });
    expect(status).toBe(409);
    expect(body.error.code).toBe('SAVED_SEARCH_LIMIT');
    expect(await savedSearchRepo.countOwnedSavedSearches(pool, OWNER_USER)).toBe(100);
  }, 60_000);

  it('99건에서 동시 저장 둘을 보내도 최종 개수가 100이다', async () => {
    await seed(99);

    const [first, second] = await Promise.all([
      create(ownerCookie, { name: '동시-A', query: 'repo:acme/a', visibility: 'private' }),
      create(ownerCookie, { name: '동시-B', query: 'repo:acme/b', visibility: 'private' }),
    ]);

    const statuses = [first.status, second.status].sort((a, b) => a - b);
    expect(statuses).toEqual([201, 409]);

    const rejected = first.status === 409 ? first : second;
    expect(rejected.body.error.code).toBe('SAVED_SEARCH_LIMIT');

    expect(await savedSearchRepo.countOwnedSavedSearches(pool, OWNER_USER)).toBe(100);
  }, 60_000);

  it('**소유자 행 잠금이 실제로 배타를 만든다** (DEV-336)', async () => {
    /*
     * ## 왜 위 시험만으로는 부족한가
     *
     * 두 요청을 `Promise.all`로 보내도 `count`와 `INSERT` 사이의 창이 너무 짧아
     * **경합이 실제로 겹치지 않는다.** 잠금을 지우고 돌려도 위 시험은 통과한다 —
     * 변이 M4가 살아남아 그것을 드러냈다. 그때 잠금 없는 구현을 직접 재현해
     * 보니 창을 50ms만 벌려도 101건이 됐다. 등가가 아니라 시험 구멍이었다.
     *
     * 그래서 결과가 아니라 **잠금 자체**를 건다: 소유자 행을 밖에서 잡고 있으면
     * 생성이 멈춰야 한다. 잠그지 않는 구현은 멈추지 않는다.
     *
     * ## 왜 `FOR KEY SHARE`인가
     *
     * 밖에서 `FOR UPDATE`로 잡으면 **잠금을 지운 구현도 멈춘다** — `saved_search`의
     * `owner_user_id` 외래 키 때문에 `INSERT`가 부모 행에 `FOR KEY SHARE`를 잡고,
     * 그것이 `FOR UPDATE`와 충돌하기 때문이다. 그러면 이 시험은 잠금이 아니라
     * 외래 키의 부작용을 재게 되고, 실제로 첫 형태가 그래서 변이를 놓쳤다.
     *
     * `FOR KEY SHARE`는 외래 키가 잡는 것과 **같은 잠금**이라 서로 호환된다.
     * 그래서 잠금을 지운 구현은 통과하고, `FOR UPDATE`를 잡는 구현만 멈춘다 —
     * 이 시험이 구분하려는 그 차이다.
     */
    await seed(50);

    const blocker = await pool.connect();
    try {
      await blocker.query('BEGIN');
      await blocker.query('SELECT user_id FROM app_user WHERE user_id = $1 FOR KEY SHARE', [OWNER_USER]);

      let settled = false;
      const pending = create(ownerCookie, {
        name: '잠금 뒤에서 기다린다',
        query: 'repo:acme/a',
        visibility: 'private',
      }).then((result) => {
        settled = true;
        return result;
      });

      // 잠금이 없으면 이 시점에 이미 끝나 있다.
      await new Promise((resolve) => setTimeout(resolve, 400));
      expect(settled).toBe(false);

      await blocker.query('COMMIT');

      const result = await pending;
      expect(result.status).toBe(201);
      expect(settled).toBe(true);
    } finally {
      blocker.release();
    }
  }, 60_000);

  it('**남이 공유한 검색은 내 상한에 들어가지 않는다**', async () => {
    await create(ownerCookie, {
      name: '팀 공유',
      query: 'repo:acme/a',
      visibility: 'team',
      team_id: TEAM_MAIN,
    });
    expect(await savedSearchRepo.countOwnedSavedSearches(pool, TEAMMATE_USER)).toBe(0);
  });
});

/* ------------------------------------------------------------------ */

describe('목록 커서 (AC-5 / DEV-340)', () => {
  async function seedMine(count: number): Promise<void> {
    for (let index = 0; index < count; index += 1) {
      const outcome = await savedSearchRepo.createSavedSearch(pool, {
        ownerUserId: OWNER_USER,
        name: `항목-${String(index).padStart(2, '0')}`,
        query: 'repo:acme/a',
        visibility: 'private',
      });
      if (outcome.kind !== 'created') throw new Error('픽스처 생성 실패');
    }
  }

  it('**전량 순회에 누락도 중복도 없다**', async () => {
    await seedMine(7);

    const seen: number[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 10; page += 1) {
      const result: { status: number; body: ListBody & ErrorBody } = await list(ownerCookie, {
        view: 'mine',
        size: '3',
        ...(cursor === null ? {} : { cursor }),
      });
      expect(result.status).toBe(200);
      seen.push(...result.body.items.map((one) => one.saved_search_id));
      cursor = result.body.next_cursor;
      if (cursor === null) break;
    }

    expect(seen).toHaveLength(7);
    expect(new Set(seen).size).toBe(7);
  });

  it('마지막 페이지의 `next_cursor`는 null이다 — 키를 빼지 않는다', async () => {
    await seedMine(2);
    const result = await list(ownerCookie, { view: 'mine', size: '10' });
    expect(result.body.items).toHaveLength(2);
    expect(result.body.next_cursor).toBeNull();
  });

  it('**팀 구성이 바뀌면 team 커서가 CURSOR_QUERY_MISMATCH다**', async () => {
    // 공유 항목 셋을 만들어 첫 페이지가 커서를 내주게 한다.
    for (const name of ['공유-1', '공유-2', '공유-3']) {
      await create(ownerCookie, { name, query: 'repo:acme/a', visibility: 'team', team_id: TEAM_MAIN });
    }
    const first = await list(teammateCookie, { view: 'team', size: '2' });
    expect(first.body.next_cursor).not.toBeNull();

    // 다른 팀에 넣어 소속을 바꾼다. 회수가 아니라 **추가**여도 집합이 달라진다.
    await authRepo.replaceTeamMembers(pool, TEAM_OTHER, [OUTSIDER_USER, TEAMMATE_USER]);

    const second = await list(teammateCookie, {
      view: 'team',
      size: '2',
      cursor: first.body.next_cursor ?? '',
    });
    expect(second.status).toBe(400);
    expect(second.body.error.code).toBe('CURSOR_QUERY_MISMATCH');
  });

  it('**남의 커서는 CURSOR_QUERY_MISMATCH다** (DEV-345)', async () => {
    await seedMine(3);
    const mine = await list(ownerCookie, { view: 'mine', size: '1' });
    expect(mine.body.next_cursor).not.toBeNull();

    const stolen = await list(teammateCookie, {
      view: 'mine',
      size: '1',
      cursor: mine.body.next_cursor ?? '',
    });
    expect(stolen.status).toBe(400);
    expect(stolen.body.error.code).toBe('CURSOR_QUERY_MISMATCH');
  });

  it('**다른 목록의 커서도 거절한다** — mine 커서를 team에 쓰지 못한다', async () => {
    await seedMine(3);
    const mine = await list(ownerCookie, { view: 'mine', size: '1' });

    const crossed = await list(ownerCookie, {
      view: 'team',
      size: '1',
      cursor: mine.body.next_cursor ?? '',
    });
    expect(crossed.status).toBe(400);
    expect(crossed.body.error.code).toBe('CURSOR_QUERY_MISMATCH');
  });

  it('훼손된 커서는 CURSOR_INVALID다', async () => {
    const result = await list(ownerCookie, { view: 'mine', cursor: 'not-a-cursor' });
    expect(result.status).toBe(400);
    expect(result.body.error.code).toBe('CURSOR_INVALID');
  });

  it('만료된 커서는 CURSOR_INVALID다', async () => {
    const teams = await savedSearchRepo.listTeamsForUser(pool, OWNER_USER);
    const expired = encodeSavedSearchCursor(
      { createdAt: '2026-08-27T00:00:00.000000Z', savedSearchId: 1 },
      'mine',
      computeSavedSearchFingerprint({
        userId: OWNER_USER,
        view: 'mine',
        teamIds: teams.map((team) => team.team_id),
      }),
      TEST_CURSOR_SIGNER,
      Date.now() - 10 * 60 * 1000,
    );

    const result = await list(ownerCookie, { view: 'mine', cursor: expired });
    expect(result.status).toBe(400);
    expect(result.body.error.code).toBe('CURSOR_INVALID');
  });

  it('`view`가 없으면 400이다 — 어느 목록인지 추측하지 않는다', async () => {
    const result = await list(ownerCookie, {});
    expect(result.status).toBe(400);
    expect(result.body.error.code).toBe('INVALID_PARAMETER');
  });

  it('**같은 밀리초에 만들어진 항목도 건너뛰지 않는다** — 마이크로초를 보존한다', async () => {
    /*
     * `created_at`을 밀리초로 자르면 같은 밀리초 안의 아직 내주지 않은 행이
     * 키셋 비교에서 빠진다. 한 트랜잭션 안에서 만들면 `now()`가 같은 값이라
     * 그 상황이 재현된다 — `saved_search_id`만이 둘을 가른다.
     */
    await pool.query(
      `INSERT INTO saved_search (owner_user_id, name, query, visibility)
       SELECT $1, '동시각-' || g, 'repo:acme/a', 'private' FROM generate_series(1, 4) AS g`,
      [OWNER_USER],
    );

    const seen: number[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 6; page += 1) {
      const result: { status: number; body: ListBody & ErrorBody } = await list(ownerCookie, {
        view: 'mine',
        size: '1',
        ...(cursor === null ? {} : { cursor }),
      });
      expect(result.status).toBe(200);
      seen.push(...result.body.items.map((one) => one.saved_search_id));
      cursor = result.body.next_cursor;
      if (cursor === null) break;
    }

    expect(seen).toHaveLength(4);
    expect(new Set(seen).size).toBe(4);
  });
});

/* ------------------------------------------------------------------ */

describe('무효가 된 질의 (AC-6)', () => {
  /** 문법이 바뀌기 전에 저장된 행을 흉내 낸다 — API로는 만들 수 없다. */
  async function seedInvalid(): Promise<number> {
    const { rows } = await pool.query<{ saved_search_id: number }>(
      `INSERT INTO saved_search (owner_user_id, name, query, visibility, team_id)
       VALUES ($1, '옛 문법', 'nosuchkey:value', 'team', $2)
       RETURNING saved_search_id`,
      [OWNER_USER, TEAM_MAIN],
    );
    return rows[0]?.saved_search_id ?? 0;
  }

  it('목록에 나타나되 `query_status: invalid`와 오류 위치를 함께 준다', async () => {
    const id = await seedInvalid();
    const result = await list(ownerCookie, { view: 'mine' });

    const item = result.body.items.find((one) => one.saved_search_id === id);
    expect(item?.query_status).toBe('invalid');
    expect(item?.query_error?.code).toBe('QUERY_SYNTAX_ERROR');
    expect(item?.query_error?.detail.offset_start).toBeTypeOf('number');
  });

  it('**직접 실행하면 409 SAVED_SEARCH_QUERY_INVALID다**', async () => {
    const id = await seedInvalid();
    const response = await app.inject({
      method: 'POST',
      url: `${itemUrl(id)}/run`,
      headers: ownerCookie,
    });
    expect(response.statusCode).toBe(409);
    expect(response.json<ErrorBody>().error.code).toBe('SAVED_SEARCH_QUERY_INVALID');
  });

  it('**무효 실행은 `last_run_at`을 갱신하지 않는다** — 실행되지 않은 것을 실행했다고 적지 않는다', async () => {
    const id = await seedInvalid();
    await app.inject({ method: 'POST', url: `${itemUrl(id)}/run`, headers: ownerCookie });

    const row = await savedSearchRepo.findVisibleSavedSearch(pool, id, OWNER_USER);
    expect(row?.last_run_at).toBeNull();
  });

  it('**자동으로 고치지 않는다** — 질의가 그대로 남는다', async () => {
    const id = await seedInvalid();
    await app.inject({ method: 'POST', url: `${itemUrl(id)}/run`, headers: ownerCookie });

    const row = await savedSearchRepo.findVisibleSavedSearch(pool, id, OWNER_USER);
    expect(row?.query).toBe('nosuchkey:value');
  });

  it('공유받은 사람도 같은 사실을 본다', async () => {
    const id = await seedInvalid();
    const single = await app.inject({ method: 'GET', url: itemUrl(id), headers: teammateCookie });
    expect(single.json<SavedSearchBody>().query_status).toBe('invalid');
    expect(single.json<SavedSearchBody>().is_owner).toBe(false);
  });
});

/* ------------------------------------------------------------------ */

describe('실행 (API-SRCH-005 POST /{id}/run)', () => {
  it('질의와 이동 대상을 주고 `last_run_at`을 찍는다', async () => {
    const created = await create(ownerCookie, {
      name: '실행 대상',
      query: 'repo:acme/payments',
      visibility: 'private',
    });
    const id = created.body.saved_search_id;

    const response = await app.inject({ method: 'POST', url: `${itemUrl(id)}/run`, headers: ownerCookie });
    expect(response.statusCode).toBe(200);

    const body = response.json<{ query: string; navigation_url: string; last_run_at: string | null }>();
    expect(body.query).toBe('repo:acme/payments');
    expect(body.navigation_url).toBe('/search?q=repo%3Aacme%2Fpayments');
    expect(body.last_run_at).not.toBeNull();
  });

  it('**응답에 저장자의 접근 범위가 없다** (AC-3, THR-012)', async () => {
    const created = await create(ownerCookie, {
      name: '실행 대상',
      query: 'repo:acme/payments',
      visibility: 'private',
    });

    const response = await app.inject({
      method: 'POST',
      url: `${itemUrl(created.body.saved_search_id)}/run`,
      headers: ownerCookie,
    });

    const raw = response.body;
    for (const forbidden of ['access_scope', 'repository_ids', 'scope_kind', 'owner_scope']) {
      expect(raw).not.toContain(forbidden);
    }
  });

  it('공유받은 구성원의 실행도 `last_run_at`을 갱신한다 — "마지막으로 쓰인 시각"이다', async () => {
    const created = await create(ownerCookie, {
      name: '팀 공유',
      query: 'repo:acme/a',
      visibility: 'team',
      team_id: TEAM_MAIN,
    });
    const id = created.body.saved_search_id;

    const response = await app.inject({
      method: 'POST',
      url: `${itemUrl(id)}/run`,
      headers: teammateCookie,
    });
    expect(response.statusCode).toBe(200);

    const row = await savedSearchRepo.findVisibleSavedSearch(pool, id, OWNER_USER);
    expect(row?.last_run_at).not.toBeNull();
  });

  it('**권한 없는 실행은 404이고 시각을 갱신하지 않는다**', async () => {
    const created = await create(ownerCookie, {
      name: '비공개',
      query: 'repo:acme/a',
      visibility: 'private',
    });
    const id = created.body.saved_search_id;

    const response = await app.inject({
      method: 'POST',
      url: `${itemUrl(id)}/run`,
      headers: outsiderCookie,
    });
    expect(response.statusCode).toBe(404);

    const row = await savedSearchRepo.findVisibleSavedSearch(pool, id, OWNER_USER);
    expect(row?.last_run_at).toBeNull();
  });
});

/* ------------------------------------------------------------------ */

describe('공유 대상 (API-SRCH-005 /share-targets)', () => {
  it('**현재 구성원인 팀만 준다**', async () => {
    const response = await app.inject({
      method: 'GET',
      url: SHARE_TARGETS_PATH,
      headers: ownerCookie,
    });
    expect(response.statusCode).toBe(200);

    const body = response.json<{ teams: { team_id: number; org_id: number; slug: string }[] }>();
    expect(body.teams).toEqual([{ team_id: TEAM_MAIN, org_id: ORG_A, slug: 'payments' }]);
  });

  it('동명 팀은 `org_id`로 구분되고 정체성은 `team_id`다', async () => {
    const response = await app.inject({
      method: 'GET',
      url: SHARE_TARGETS_PATH,
      headers: outsiderCookie,
    });
    const body = response.json<{ teams: { team_id: number; org_id: number; slug: string }[] }>();

    expect(body.teams).toHaveLength(2);
    expect(new Set(body.teams.map((team) => team.slug))).toEqual(new Set(['platform', 'payments']));
    expect(new Set(body.teams.map((team) => team.team_id))).toEqual(new Set([TEAM_OTHER, TEAM_TWIN]));
  });

  it('소속 팀이 없으면 빈 목록이다 — 오류가 아니다', async () => {
    await pool.query('DELETE FROM team_member WHERE user_id = $1', [TEAMMATE_USER]);
    const response = await app.inject({
      method: 'GET',
      url: SHARE_TARGETS_PATH,
      headers: teammateCookie,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json<{ teams: unknown[] }>().teams).toEqual([]);
  });

  it('**정적 경로가 `{id}`로 해석되지 않는다** — 등록 순서를 시험이 지킨다', async () => {
    const response = await app.inject({
      method: 'GET',
      url: SHARE_TARGETS_PATH,
      headers: ownerCookie,
    });
    // ID로 해석됐다면 400(INVALID_PARAMETER) 또는 404가 나온다.
    expect(response.statusCode).toBe(200);
    expect(response.json<{ teams?: unknown }>().teams).toBeDefined();
  });
});

/* ------------------------------------------------------------------ */

describe('인증', () => {
  it('세션이 없으면 모든 경로가 401이다', async () => {
    for (const [method, url] of [
      ['GET', `${SAVED_SEARCHES_PATH}?view=mine`],
      ['POST', SAVED_SEARCHES_PATH],
      ['GET', SHARE_TARGETS_PATH],
      ['GET', itemUrl(1)],
      ['PATCH', itemUrl(1)],
      ['DELETE', itemUrl(1)],
      ['POST', `${itemUrl(1)}/run`],
    ] as const) {
      const response = await app.inject({ method, url });
      expect(response.statusCode, `${method} ${url}`).toBe(401);
    }
  });

  it('신원을 주장하는 헤더로는 통과하지 못한다 (DEV-047)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `${SAVED_SEARCHES_PATH}?view=mine`,
      headers: { 'x-user-id': OWNER_USER },
    });
    expect(response.statusCode).toBe(401);
  });
});
