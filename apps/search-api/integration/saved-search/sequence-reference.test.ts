/**
 * 저장된 검색의 시퀀스 인용 (CR-051 / FR-SRCH-010 AC-8, DEV-362·365).
 *
 * ## 이 파일이 지키는 주장 셋
 *
 * 1. **저장 당시의 세대가 보존된다.** 재채번 뒤에 같은 서수가 다른 커밋을
 *    가리키는데 저장된 검색이 그것을 조용히 따라가면, 사용자는 자기가 저장한
 *    조건이 다른 것을 뜻하게 된 줄 모른다.
 * 2. **모르는 것을 지어내지 않는다.** CR-051 이전에 저장된 행에는 에폭이 없고
 *    그 값은 복원할 수 없다 — 현재 값을 채우는 것은 복구가 아니라 추측이다.
 *    목록을 열든 실행을 누르든 이름을 고치든 그 열은 `NULL`로 남아야 한다.
 * 3. **공유는 저장소를 읽을 권한이 아니다.** 볼 수 없는 저장소의 에폭·상태는
 *    응답에 실리지 않는다 (THR-043).
 *
 * 실행: `pnpm test:integration saved-search/sequence-reference`
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
  type AccessScopeSource,
  type SessionRecord,
} from '@prs/authz';
import { authRepo, repositoryRepo, sequenceSpaceRepo, type Pool } from '@prs/db';
import type { Redis } from '@prs/bus';
import { buildServer } from '../../src/server.js';
import type { AuthContext, AuthRedis } from '../../src/auth/context.js';
import {
  SAVED_SEARCHES_PATH,
  SAVED_SEARCH_ITEM_PATH,
  SAVED_SEARCH_RUN_PATH,
} from '../../src/saved-search/routes.js';
import { createTestRedis, migratedPool } from '../helpers.js';
import { TEST_CURSOR_KEY, TEST_CURSOR_SIGNER } from '../_cursor-fixture.js';

const AUTH_CONFIG = {
  enabled: true,
  cookieSecure: true,
  loginPath: '/auth/login',
  groupRoleMap: new Map<string, never>(),
} as const;

/** 이 파일 전용 식별자. 공유 `prs_test`에서 겹치지 않는다 (risks 30). */
const OWNER = 'sub-cr051-owner';
const SHAREE = 'sub-cr051-sharee';
const USERS = [OWNER, SHAREE];
const TEAM = 51_001;
const ORG = 51_002;
const VISIBLE_REPO = 51_101;
const HIDDEN_REPO = 51_102;
const BRANCH = 'main';

const BOUND_QUERY = 'repo:cr051/payments base:main seq:10..20';
const HIDDEN_QUERY = 'repo:cr051-hidden/secret base:main seq:10..20';
const PLAIN_QUERY = 'repo:cr051/payments author:kim';

let pool: Pool;
let redis: Redis;
let app: FastifyInstance;
let sessions: SessionStore;
let ownerCookie: Record<string, string>;
let shareeCookie: Record<string, string>;

interface SequenceReference {
  status: string;
  stored_seq_epoch?: number;
  current_seq_epoch?: number;
  sequence_state?: string;
}

interface SavedSearchBody {
  saved_search_id: number;
  query: string;
  sequence_reference?: SequenceReference;
  error?: { code: string; message: string; detail?: Record<string, unknown> };
}

interface ListBody {
  items: SavedSearchBody[];
}

function authRedis(client: Redis): AuthRedis {
  return {
    get: (key) => client.get(key),
    set: (key, value, mode, seconds) => client.set(key, value, mode, seconds),
    del: (...keys) => client.del(...keys),
    scan: (cursor, m, pattern, c, n) => client.scan(cursor, m, pattern, c, n),
  };
}

async function login(userId: string): Promise<Record<string, string>> {
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
  return { cookie: `${SESSION_COOKIE_NAME}=${sessionId}` };
}

async function create(
  headers: Record<string, string>,
  payload: Record<string, unknown>,
): Promise<{ status: number; body: SavedSearchBody }> {
  const response = await app.inject({
    method: 'POST',
    url: SAVED_SEARCHES_PATH,
    headers: { ...headers, 'content-type': 'application/json' },
    payload,
  });
  return { status: response.statusCode, body: response.json<SavedSearchBody>() };
}

async function patch(
  headers: Record<string, string>,
  id: number,
  payload: Record<string, unknown>,
): Promise<{ status: number; body: SavedSearchBody }> {
  const response = await app.inject({
    method: 'PATCH',
    url: SAVED_SEARCH_ITEM_PATH.replace(':saved_search_id', String(id)),
    headers: { ...headers, 'content-type': 'application/json' },
    payload,
  });
  return { status: response.statusCode, body: response.json<SavedSearchBody>() };
}

async function run(
  headers: Record<string, string>,
  id: number,
): Promise<{ status: number; body: { navigation_url?: string; error?: { code: string; detail?: Record<string, unknown> } } }> {
  const response = await app.inject({
    method: 'POST',
    url: SAVED_SEARCH_RUN_PATH.replace(':saved_search_id', String(id)),
    headers,
  });
  return { status: response.statusCode, body: response.json() };
}

async function list(headers: Record<string, string>, view: string): Promise<ListBody> {
  const response = await app.inject({
    method: 'GET',
    url: `${SAVED_SEARCHES_PATH}?view=${view}`,
    headers,
  });
  return response.json<ListBody>();
}

/** 정본의 `seq_epoch`을 직접 읽는다 — 응답이 아니라 저장된 값을 본다. */
async function storedEpoch(id: number): Promise<number | null> {
  const { rows } = await pool.query<{ seq_epoch: number | null }>(
    'SELECT seq_epoch FROM saved_search WHERE saved_search_id = $1',
    [id],
  );
  return rows[0]?.seq_epoch ?? null;
}

async function currentEpoch(): Promise<number> {
  const { rows } = await pool.query<{ seq_epoch: number }>(
    'SELECT seq_epoch FROM sequence_space WHERE repository_id = $1 AND base_branch = $2',
    [VISIBLE_REPO, BRANCH],
  );
  return rows[0]?.seq_epoch ?? 0;
}

beforeAll(async () => {
  pool = await migratedPool();
  redis = createTestRedis();

  await pool.query('DELETE FROM saved_search WHERE owner_user_id = ANY($1)', [USERS]);
  await pool.query('DELETE FROM team_member WHERE user_id = ANY($1)', [USERS]);
  await pool.query('DELETE FROM sequence_space WHERE repository_id = ANY($1)', [
    [VISIBLE_REPO, HIDDEN_REPO],
  ]);
  await pool.query('DELETE FROM repository WHERE repository_id = ANY($1)', [
    [VISIBLE_REPO, HIDDEN_REPO],
  ]);
  await pool.query('DELETE FROM team WHERE team_id = $1', [TEAM]);
  await pool.query('DELETE FROM permission_cache WHERE user_id = ANY($1)', [USERS]);
  await pool.query('DELETE FROM app_user WHERE user_id = ANY($1)', [USERS]);

  for (const userId of USERS) {
    await authRepo.upsertUserOnLogin(pool, { user_id: userId, login: userId });
  }
  await authRepo.upsertTeam(pool, { team_id: TEAM, slug: 'cr051-team', org_id: ORG });
  for (const userId of USERS) {
    await pool.query(
      'INSERT INTO team_member (team_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [TEAM, userId],
    );
  }

  for (const [id, owner, name] of [
    [VISIBLE_REPO, 'cr051', 'payments'],
    [HIDDEN_REPO, 'cr051-hidden', 'secret'],
  ] as const) {
    await repositoryRepo.upsertRepository(pool, {
      repository_id: id,
      owner,
      name,
      org_id: ORG,
      visibility: 'internal',
      sequence_branches: [BRANCH],
    });
    await sequenceSpaceRepo.ensureSequenceSpace(pool, id, BRANCH);
  }

  const redisPort = authRedis(redis);
  sessions = new SessionStore({ redis: redisPort });

  /*
   * **두 사람의 접근 범위가 다르다.** 소유자는 두 저장소를 보고, 공유받은
   * 사람은 하나만 본다 — 그 대비가 있어야 `unavailable`이 무엇을 막는지
   * 증명된다.
   */
  const source: AccessScopeSource = {
    fetch: async (user) => ({
      repositoryIds: user.userId === OWNER ? [VISIBLE_REPO, HIDDEN_REPO] : [VISIBLE_REPO],
      orgIds: [ORG],
      teamIds: [TEAM],
      visibilities: ['public', 'internal'],
    }),
  };

  const auth: AuthContext = {
    sessions,
    scopes: new AccessScopeResolver({ redis: redisPort, db: createScopeDatabase(pool), source }),
    forget: async (ids) => {
      if (ids.length > 0) await redis.del(...ids.map(scopeKey));
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
    auth,
    savedSearch: { pool, cursorSigner: TEST_CURSOR_SIGNER },
  });
  await app.ready();

  ownerCookie = await login(OWNER);
  shareeCookie = await login(SHAREE);
}, 180_000);

afterAll(async () => {
  await app?.close();
  /*
   * **내 픽스처를 치우고 나간다.** 다른 파일이 전역 `DELETE FROM app_user`를
   * 하는데 내가 남긴 `team_member`·`permission_cache` 행이 외래 키로 그것을
   * 막는다 — 단독 실행은 통과하고 전 계층에서만 깨지는 종류다 (risks 75).
   */
  await pool?.query('DELETE FROM saved_search WHERE owner_user_id = ANY($1)', [USERS]);
  await pool?.query('DELETE FROM team_member WHERE user_id = ANY($1)', [USERS]);
  await pool?.query('DELETE FROM permission_cache WHERE user_id = ANY($1)', [USERS]);
  await pool?.query('DELETE FROM app_user WHERE user_id = ANY($1)', [USERS]);
  await pool?.query('DELETE FROM team WHERE team_id = $1', [TEAM]);
  await pool?.query('DELETE FROM sequence_space WHERE repository_id = ANY($1)', [
    [VISIBLE_REPO, HIDDEN_REPO],
  ]);
  await pool?.query('DELETE FROM repository WHERE repository_id = ANY($1)', [
    [VISIBLE_REPO, HIDDEN_REPO],
  ]);
  await redis?.quit();
  await pool?.end();
});

beforeEach(async () => {
  await pool.query('DELETE FROM saved_search WHERE owner_user_id = ANY($1)', [USERS]);
  await pool.query('UPDATE sequence_space SET seq_epoch = 1, state = $2 WHERE repository_id = ANY($1)', [
    [VISIBLE_REPO, HIDDEN_REPO],
    'ok',
  ]);
  for (const userId of USERS) await redis.del(scopeKey(userId));
});

describe('S1~S5: 저장 시점의 에폭 확정 (AC-8)', () => {
  it('`seq:`가 없는 질의는 에폭 없이 저장된다', async () => {
    const { status, body } = await create(ownerCookie, {
      name: '평범한 검색',
      query: PLAIN_QUERY,
      visibility: 'private',
    });
    expect(status).toBe(201);
    expect(await storedEpoch(body.saved_search_id)).toBeNull();
    expect(body).not.toHaveProperty('sequence_reference');
  });

  it('`seq:` 질의는 보낸 에폭을 정본에 남긴다', async () => {
    const { status, body } = await create(ownerCookie, {
      name: '구간 검색',
      query: BOUND_QUERY,
      visibility: 'private',
      seq_epoch: 1,
    });
    expect(status).toBe(201);
    expect(await storedEpoch(body.saved_search_id)).toBe(1);
  });

  it('`seq:` 질의인데 에폭을 안 보내면 거절한다 — 서버가 대신 채우지 않는다', async () => {
    const { status, body } = await create(ownerCookie, {
      name: '에폭 없음',
      query: BOUND_QUERY,
      visibility: 'private',
    });
    expect(status).toBe(400);
    expect(body.error?.detail?.['reason']).toBe('sequence_epoch_required');
  });

  it('**저장 사이에 에폭이 오르면 거절한다** — 본 것과 저장되는 것이 달라지지 않는다', async () => {
    await sequenceSpaceRepo.bumpEpoch(pool, VISIBLE_REPO, BRANCH);

    const { status, body } = await create(ownerCookie, {
      name: '낡은 에폭 저장',
      query: BOUND_QUERY,
      visibility: 'private',
      seq_epoch: 1,
    });
    expect(status).toBe(409);
    expect(body.error?.code).toBe('SAVED_SEARCH_QUERY_INVALID');
    expect(body.error?.detail?.['reason']).toBe('epoch_stale');
    // 2로 바꿔서 저장하지 않았다.
    const { rows } = await pool.query('SELECT 1 FROM saved_search WHERE owner_user_id = $1', [OWNER]);
    expect(rows).toHaveLength(0);
  });

  it('`seq:`가 없는데 에폭을 보내면 거절한다', async () => {
    const { status, body } = await create(ownerCookie, {
      name: '뜻 없는 에폭',
      query: PLAIN_QUERY,
      visibility: 'private',
      seq_epoch: 1,
    });
    expect(status).toBe(400);
    expect(body.error?.detail?.['reason']).toBe('sequence_reference_absent');
  });

  it('AC-7을 어긴 질의는 저장 경로에서도 거절한다', async () => {
    const { status, body } = await create(ownerCookie, {
      name: '공간 없는 seq',
      query: 'seq:10..20',
      visibility: 'private',
      seq_epoch: 1,
    });
    expect(status).toBe(400);
    expect(body.error?.detail?.['reason']).toBe('sequence_space_required');
  });
});

describe('낡은 인용의 표시와 실행', () => {
  async function saveBound(): Promise<number> {
    const { body } = await create(ownerCookie, {
      name: '구간 검색',
      query: BOUND_QUERY,
      visibility: 'private',
      seq_epoch: 1,
    });
    return body.saved_search_id;
  }

  it('에폭이 같으면 `current`다', async () => {
    const id = await saveBound();
    const { items } = await list(ownerCookie, 'mine');
    const found = items.find((one) => one.saved_search_id === id);
    expect(found?.sequence_reference).toEqual({
      status: 'current',
      stored_seq_epoch: 1,
      current_seq_epoch: 1,
      sequence_state: 'ok',
    });
  });

  it('에폭이 오르면 `epoch_stale`이며 두 값을 함께 준다', async () => {
    const id = await saveBound();
    await sequenceSpaceRepo.bumpEpoch(pool, VISIBLE_REPO, BRANCH);

    const { items } = await list(ownerCookie, 'mine');
    const found = items.find((one) => one.saved_search_id === id);
    expect(found?.sequence_reference?.status).toBe('epoch_stale');
    expect(found?.sequence_reference?.stored_seq_epoch).toBe(1);
    expect(found?.sequence_reference?.current_seq_epoch).toBe(2);
  });

  it('**목록을 열어도 정본은 그대로다** — 조회가 값을 옮기지 않는다', async () => {
    const id = await saveBound();
    await sequenceSpaceRepo.bumpEpoch(pool, VISIBLE_REPO, BRANCH);

    await list(ownerCookie, 'mine');
    await list(ownerCookie, 'mine');
    expect(await storedEpoch(id)).toBe(1);
  });

  it('**실행은 저장된 에폭을 실은 주소로 간다** — 현재 값으로 바꾸지 않는다', async () => {
    const id = await saveBound();
    await sequenceSpaceRepo.bumpEpoch(pool, VISIBLE_REPO, BRANCH);

    const { status, body } = await run(ownerCookie, id);
    expect(status).toBe(200);
    expect(body.navigation_url).toContain('seq_epoch=1');
    expect(body.navigation_url).not.toContain('seq_epoch=2');
    expect(await storedEpoch(id)).toBe(1);
  });
});

describe('미연결 인용 — 지어내지 않는다 (DEV-362)', () => {
  /** CR-051 이전에 저장된 모양을 재현한다: `seq:`는 있고 에폭은 없다. */
  async function insertLegacy(): Promise<number> {
    const { rows } = await pool.query<{ saved_search_id: number }>(
      `INSERT INTO saved_search (owner_user_id, name, query, visibility, seq_epoch)
       VALUES ($1, $2, $3, 'private', NULL)
       RETURNING saved_search_id`,
      [OWNER, '옛 구간 검색', BOUND_QUERY],
    );
    return rows[0]?.saved_search_id ?? 0;
  }

  it('목록에 나오고 `unbound`로 표시된다', async () => {
    const id = await insertLegacy();
    const { items } = await list(ownerCookie, 'mine');
    const found = items.find((one) => one.saved_search_id === id);

    expect(found?.sequence_reference?.status).toBe('unbound');
    // 저장된 값이 없다는 사실을 그대로 말한다.
    expect(found?.sequence_reference).not.toHaveProperty('stored_seq_epoch');
    // 무엇으로 다시 연결하게 되는지는 보여 준다.
    expect(found?.sequence_reference?.current_seq_epoch).toBe(1);
  });

  it('실행을 막고 `last_run_at`도 남기지 않는다', async () => {
    const id = await insertLegacy();
    const { status, body } = await run(ownerCookie, id);

    expect(status).toBe(409);
    expect(body.error?.code).toBe('SAVED_SEARCH_QUERY_INVALID');
    expect(body.error?.detail?.['reason']).toBe('sequence_unbound');

    const { rows } = await pool.query<{ last_run_at: string | null }>(
      'SELECT last_run_at FROM saved_search WHERE saved_search_id = $1',
      [id],
    );
    expect(rows[0]?.last_run_at).toBeNull();
  });

  it('**가장 중요한 시험 — 어떤 조회도 정본을 채우지 않는다**', async () => {
    const id = await insertLegacy();
    await sequenceSpaceRepo.bumpEpoch(pool, VISIBLE_REPO, BRANCH);
    await sequenceSpaceRepo.bumpEpoch(pool, VISIBLE_REPO, BRANCH);
    expect(await currentEpoch()).toBe(3);

    await list(ownerCookie, 'mine');
    await run(ownerCookie, id);
    await app.inject({
      method: 'GET',
      url: SAVED_SEARCH_ITEM_PATH.replace(':saved_search_id', String(id)),
      headers: ownerCookie,
    });

    /*
     * 저장 당시의 에폭은 어디에도 남아 있지 않다. 현재 값(3)을 넣는 것은
     * 복구가 아니라 추측이고, 그 추측을 정본에 쓰면 조용한 오답이 영구히
     * 승인된다.
     */
    expect(await storedEpoch(id)).toBeNull();
  });

  it('이름만 고쳐도 `NULL`로 남는다', async () => {
    const id = await insertLegacy();
    const { status } = await patch(ownerCookie, id, { name: '이름만 바꿈' });
    expect(status).toBe(200);
    expect(await storedEpoch(id)).toBeNull();
  });

  it('저장자가 명시적으로 다시 연결하면 그때 값이 생긴다', async () => {
    const id = await insertLegacy();
    const { status } = await patch(ownerCookie, id, { seq_epoch: 1 });
    expect(status).toBe(200);
    expect(await storedEpoch(id)).toBe(1);
  });
});

describe('PATCH 다섯 경우 (API 계약)', () => {
  async function saveBound(): Promise<number> {
    const { body } = await create(ownerCookie, {
      name: '구간 검색',
      query: BOUND_QUERY,
      visibility: 'private',
      seq_epoch: 1,
    });
    return body.saved_search_id;
  }

  it('**이름만 고치면 낡은 에폭이 그대로 남는다** — 자동 재해석 금지', async () => {
    const id = await saveBound();
    await sequenceSpaceRepo.bumpEpoch(pool, VISIBLE_REPO, BRANCH);

    const { status } = await patch(ownerCookie, id, { name: '새 이름' });
    expect(status).toBe(200);
    expect(await storedEpoch(id)).toBe(1);
  });

  it('**질의를 함께 보내도 내용이 같으면 옮기지 않는다** — 전체 폼 제출을 재연결로 읽지 않는다', async () => {
    const id = await saveBound();
    await sequenceSpaceRepo.bumpEpoch(pool, VISIBLE_REPO, BRANCH);

    const { status } = await patch(ownerCookie, id, { name: '새 이름', query: BOUND_QUERY });
    expect(status).toBe(200);
    expect(await storedEpoch(id)).toBe(1);
  });

  it('공개 범위만 바꿔도 그대로다', async () => {
    const id = await saveBound();
    await sequenceSpaceRepo.bumpEpoch(pool, VISIBLE_REPO, BRANCH);

    const { status } = await patch(ownerCookie, id, { visibility: 'team', team_id: TEAM });
    expect(status).toBe(200);
    expect(await storedEpoch(id)).toBe(1);
  });

  it('질의가 `seq:`를 잃으면 에폭을 지운다', async () => {
    const id = await saveBound();
    const { status } = await patch(ownerCookie, id, { query: PLAIN_QUERY });
    expect(status).toBe(200);
    expect(await storedEpoch(id)).toBeNull();
  });

  it('질의를 다른 `seq:`로 바꾸면 새 에폭이 필요하다', async () => {
    const id = await saveBound();
    const { status, body } = await patch(ownerCookie, id, {
      query: 'repo:cr051/payments base:main seq:30..40',
    });
    expect(status).toBe(400);
    expect(body.error?.detail?.['reason']).toBe('sequence_epoch_required');
  });

  it('명시적 재연결은 현재 값과 대조된다', async () => {
    const id = await saveBound();
    await sequenceSpaceRepo.bumpEpoch(pool, VISIBLE_REPO, BRANCH);

    // 낡은 값을 보내면 거절한다.
    const stale = await patch(ownerCookie, id, { seq_epoch: 1 });
    expect(stale.status).toBe(409);
    expect(await storedEpoch(id)).toBe(1);

    // 현재 값이면 갱신한다.
    const fresh = await patch(ownerCookie, id, { seq_epoch: 2 });
    expect(fresh.status).toBe(200);
    expect(await storedEpoch(id)).toBe(2);
  });
});

describe('THR-043: 볼 수 없는 저장소의 상태를 누설하지 않는다', () => {
  async function shareHidden(): Promise<number> {
    const { status, body } = await create(ownerCookie, {
      name: '비공개 구간 공유',
      query: HIDDEN_QUERY,
      visibility: 'team',
      team_id: TEAM,
      seq_epoch: 1,
    });
    expect(status).toBe(201);
    return body.saved_search_id;
  }

  it('접근할 수 있는 사람에게는 값이 보인다', async () => {
    const id = await shareHidden();
    await sequenceSpaceRepo.bumpEpoch(pool, HIDDEN_REPO, BRANCH);

    const { items } = await list(ownerCookie, 'mine');
    const found = items.find((one) => one.saved_search_id === id);
    expect(found?.sequence_reference?.status).toBe('epoch_stale');
    expect(found?.sequence_reference?.current_seq_epoch).toBe(2);
  });

  it('**접근할 수 없는 사람에게는 `status`뿐이다**', async () => {
    const id = await shareHidden();
    await sequenceSpaceRepo.bumpEpoch(pool, HIDDEN_REPO, BRANCH);

    const { items } = await list(shareeCookie, 'team');
    const found = items.find((one) => one.saved_search_id === id);

    expect(found?.sequence_reference?.status).toBe('unavailable');
    /*
     * 셋 다 **키가 없어야 한다.** 값을 가리는 것과 응답에서 빼는 것은 다르며,
     * `stored_seq_epoch: 5` 하나만으로도 "그 저장소가 다섯 세대를 거쳤다"가
     * 새어 나간다.
     */
    expect(found?.sequence_reference).not.toHaveProperty('current_seq_epoch');
    expect(found?.sequence_reference).not.toHaveProperty('stored_seq_epoch');
    expect(found?.sequence_reference).not.toHaveProperty('sequence_state');
    // 직렬화된 본문 어디에도 현재 에폭이 없다.
    expect(JSON.stringify(found)).not.toContain('"current_seq_epoch"');
  });

  it('공유받은 사람도 볼 수 있는 저장소면 값이 보인다 — 무조건 가리는 것이 아니다', async () => {
    const { body } = await create(ownerCookie, {
      name: '공개 구간 공유',
      query: BOUND_QUERY,
      visibility: 'team',
      team_id: TEAM,
      seq_epoch: 1,
    });

    const { items } = await list(shareeCookie, 'team');
    const found = items.find((one) => one.saved_search_id === body.saved_search_id);
    expect(found?.sequence_reference?.status).toBe('current');
    expect(found?.sequence_reference?.current_seq_epoch).toBe(1);
  });
});

describe('N+1 방지 (CR-051)', () => {
  it('항목이 늘어도 공간 조회가 항목 수에 비례하지 않는다', async () => {
    for (let index = 0; index < 8; index += 1) {
      await create(ownerCookie, {
        name: `구간 ${String(index)}`,
        query: BOUND_QUERY,
        visibility: 'private',
        seq_epoch: 1,
      });
    }

    /*
     * 여덟 항목이 **같은 공간**을 인용한다. 공간 조회가 한 번으로 접히지
     * 않으면 이 목록이 여덟 번 왕복한다 — 그 사실을 직접 세기 위해 질의
     * 로그를 가로챈다.
     */
    const original = pool.query.bind(pool);
    let spaceQueries = 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (pool as any).query = (...args: unknown[]) => {
      const text = typeof args[0] === 'string' ? args[0] : String((args[0] as { text?: string })?.text ?? '');
      if (text.includes('sequence_space')) spaceQueries += 1;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (original as any)(...args);
    };

    try {
      const { items } = await list(ownerCookie, 'mine');
      expect(items.length).toBeGreaterThanOrEqual(8);
      // 공간 하나이므로 한 번이면 된다. 여덟이면 N+1이다.
      expect(spaceQueries).toBeLessThanOrEqual(2);
    } finally {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (pool as any).query = original;
    }
  });
});
