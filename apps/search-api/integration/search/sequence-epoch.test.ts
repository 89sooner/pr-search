/**
 * `seq:` 인용의 공간 지목과 에폭 바인딩 (CR-051 / DEV-349, DEV-359~363).
 *
 * 실제 Fastify + Elasticsearch + PostgreSQL + Redis로 건다. 단위 시험은 판정의
 * **모양**을 보고, 여기서는 그 판정이 실제 색인에서 **어떤 문서를 가르는지**를
 * 본다 — 필터 필드 이름이 하나 어긋나면 아무것도 거르지 못하고, 그것을 잡는
 * 것은 진짜 조회뿐이다.
 *
 * ## 가장 중요한 시험은 「섞이지 않는다」이다
 *
 * 같은 저장소·브랜치·서수에 에폭만 다른 문서 둘을 색인해 두고, 각 조회가
 * 자기 세대만 돌려주는지 확인한다. 이 픽스처가 없으면 `seq_epoch` 필터를
 * 통째로 지워도 아무 시험이 깨지지 않는다.
 */

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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
import { applyMappings, switchAliasesForTests, createEsClient, resolveClientOptions } from '@prs/es';
import { authRepo, repositoryRepo, sequenceSpaceRepo, type Pool } from '@prs/db';
import type { Redis } from '@prs/bus';
import { buildServer } from '../../src/server.js';
import { SEARCH_PATH } from '../../src/search/routes.js';
import type { AuthContext, AuthRedis } from '../../src/auth/context.js';
import { createTestRedis, migratedPool } from '../helpers.js';
import { TEST_CURSOR_KEY, TEST_CURSOR_SIGNER } from '../_cursor-fixture.js';

const AUTH_CONFIG = {
  enabled: true,
  cookieSecure: true,
  loginPath: '/auth/login',
  groupRoleMap: new Map<string, never>(),
} as const;

const USER = 'sub-seq-epoch';
const PAYMENTS = 5101;
const HIDDEN = 5900;
const ORG = 51;
const BRANCH = 'main';

let pool: Pool;
let redis: Redis;
let es: Client;
let app: FastifyInstance;
let sessionId: string;
let sessions: SessionStore;

interface SearchBody {
  readonly total?: { value: number; relation: string };
  readonly items?: { pr_number?: number; merge_seq: number | null; seq_epoch: number | null }[];
  readonly facets?: Record<string, { value: string; count: number }[]>;
  readonly next_cursor?: string | null;
  readonly relaxation_hints?: { remove: string; would_yield: number }[];
  readonly sequence_context?: {
    sequence_space: string;
    repository: string;
    base_branch: string;
    seq_epoch: number;
    sequence_state: string;
  };
  readonly epoch_stale?: boolean;
  readonly requested_seq_epoch?: number;
  readonly error?: { code: string; message: string; detail?: Record<string, unknown> };
  readonly correlation_id: string;
}

async function get(query: string): Promise<{ status: number; body: SearchBody }> {
  const response = await app.inject({
    method: 'GET',
    url: `${SEARCH_PATH}?${query}`,
    headers: { cookie: `${SESSION_COOKIE_NAME}=${sessionId}` },
  });
  return { status: response.statusCode, body: response.json<SearchBody>() };
}

/** 같은 자리(저장소·브랜치·서수)에 에폭만 다른 문서를 만든다. */
function prAt(epoch: number, seq: number, prNumber: number, label: string) {
  return {
    _id: `pr-e${String(epoch)}-${String(prNumber)}`,
    repository_id: PAYMENTS,
    repository: 'seqepoch/payments',
    org_id: ORG,
    visibility: 'internal',
    allowed_team_ids: [510],
    pr_number: prNumber,
    title: `세대 ${String(epoch)} 변경`,
    state: 'merged',
    author: 'kim',
    labels: [label],
    base_branch: BRANCH,
    merge_seq: seq,
    seq_epoch: epoch,
    sequence_space: `seqepoch/payments@${BRANCH}`,
    merged_at: '2026-08-19T05:02:11Z',
    created_at: '2026-08-15T00:00:00Z',
    updated_at: '2026-08-19T05:02:11Z',
    changed_files_count: 1,
    additions: 10,
    deletions: 1,
    document_version: 1,
  };
}

/**
 * 에폭 1과 2가 **같은 서수 자리**를 차지한다.
 *
 * 재채번 도중에는 두 세대가 실제로 잠시 함께 있고, 그때 필터가 없으면 한
 * 목록에 섞인다. 라벨을 달리 두어 패싯 버킷도 갈리는지 함께 본다.
 */
const PULL_REQUESTS = [
  prAt(1, 10, 101, 'old-gen'),
  prAt(1, 11, 102, 'old-gen'),
  prAt(1, 12, 103, 'old-gen'),
  prAt(2, 10, 201, 'new-gen'),
  prAt(2, 11, 202, 'new-gen'),
  {
    // 범위 밖 저장소. `seq:` 질의가 이것을 볼 수 없어야 한다.
    ...prAt(1, 10, 999, 'hidden'),
    _id: 'pr-hidden',
    repository_id: HIDDEN,
    repository: 'seqepoch-hidden/secret',
    org_id: 52,
    visibility: 'private',
    allowed_team_ids: [599],
    sequence_space: `seqepoch-hidden/secret@${BRANCH}`,
  },
];

beforeAll(async () => {
  pool = await migratedPool();
  redis = createTestRedis();
  es = createEsClient(resolveClientOptions());
  await applyMappings(es);
  await switchAliasesForTests(es);

  /*
   * **전역 삭제를 하지 않는다.** `prs_test`는 공유 환경이라 다른 파일의
   * 픽스처를 지우면 그쪽이 순서에 따라 죽는다. 내 저장소 ID만 치운다.
   */
  await pool.query('DELETE FROM sequence_space WHERE repository_id = ANY($1)', [[PAYMENTS, HIDDEN]]);
  await pool.query('DELETE FROM repository WHERE repository_id = ANY($1)', [[PAYMENTS, HIDDEN]]);
  await pool.query('DELETE FROM permission_cache WHERE user_id = $1', [USER]);
  await pool.query('DELETE FROM app_user WHERE user_id = $1', [USER]);

  // `app_user.login`은 유니크다. 공유 `prs_test`에서 다른 파일과 겹치지 않게 둔다.
  await authRepo.upsertUserOnLogin(pool, {
    user_id: USER,
    login: 'seq-epoch-kim',
    github_user_id: 75_001,
  });
  for (const [id, owner, name, org] of [
    [PAYMENTS, 'seqepoch', 'payments', ORG],
    [HIDDEN, 'seqepoch-hidden', 'secret', 52],
  ] as const) {
    await repositoryRepo.upsertRepository(pool, {
      repository_id: id,
      owner,
      name,
      org_id: org,
      visibility: 'internal',
      sequence_branches: [BRANCH],
    });
  }
  await sequenceSpaceRepo.ensureSequenceSpace(pool, PAYMENTS, BRANCH);
  await sequenceSpaceRepo.ensureSequenceSpace(pool, HIDDEN, BRANCH);

  await es.deleteByQuery({
    index: ['prs-pull-requests'],
    query: { terms: { repository_id: [PAYMENTS, HIDDEN] } },
    refresh: true,
    conflicts: 'proceed',
  });

  const bulk = await es.bulk({
    refresh: true,
    operations: PULL_REQUESTS.flatMap(({ _id, ...doc }) => [
      { index: { _index: 'prs-pull-requests', _id } },
      { ...doc, doc_id: _id },
    ]),
  });
  if (bulk.errors) {
    const reasons = bulk.items.map((item) => item.index?.error?.reason).filter((one) => one !== undefined);
    throw new Error(`fixture 색인이 거부됐다: ${reasons.join(' / ')}`);
  }

  const redisPort: AuthRedis = {
    get: (key) => redis.get(key),
    set: (key, value, mode, seconds) => redis.set(key, value, mode, seconds),
    del: (...keys) => redis.del(...keys),
    scan: (cursor, m, pattern, c, n) => redis.scan(cursor, m, pattern, c, n),
  };

  sessions = new SessionStore({ redis: redisPort });
  const source: AccessScopeSource = {
    fetch: async () => ({
      repositoryIds: [PAYMENTS],
      orgIds: [ORG],
      teamIds: [510],
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
    search: {
      pool,
      es,
      cursorSigner: TEST_CURSOR_SIGNER,
      resolveNames: async () => ({ orgIds: new Map(), teamIds: new Map() }),
    },
  });
  await app.ready();
}, 180_000);

afterAll(async () => {
  await app?.close();
  // 내 픽스처를 치우고 나간다 (risks 75). ES 문서도 함께 지운다.
  await es?.deleteByQuery({
    index: ['prs-pull-requests'],
    query: { terms: { repository_id: [PAYMENTS, HIDDEN] } },
    refresh: true,
    conflicts: 'proceed',
  });
  await pool?.query('DELETE FROM permission_cache WHERE user_id = $1', [USER]);
  await pool?.query('DELETE FROM app_user WHERE user_id = $1', [USER]);
  await pool?.query('DELETE FROM sequence_space WHERE repository_id = ANY($1)', [
    [PAYMENTS, HIDDEN],
  ]);
  await pool?.query('DELETE FROM repository WHERE repository_id = ANY($1)', [[PAYMENTS, HIDDEN]]);
  await redis?.quit();
  await pool?.end();
});

beforeEach(async () => {
  // 에폭을 1로 되돌린다 — 시험마다 시작점이 같아야 한다.
  await pool.query('UPDATE sequence_space SET seq_epoch = 1, state = $2 WHERE repository_id = $1', [
    PAYMENTS,
    'ok',
  ]);
  await redis.del(scopeKey(USER));

  sessionId = createSessionId();
  const now = Date.now();
  await sessions.create({
    sessionId,
    userId: USER,
    login: 'seq-epoch-kim',
    email: null,
    roles: ['developer'],
    issuedAt: now,
    lastSeenAt: now,
    correlationId: null,
  });
});

const BOUND = 'repo:seqepoch/payments base:main seq:9..12';

describe('AC-7: 공간을 지목하지 않는 seq:는 실행되지 않는다', () => {
  it.each([
    ['단독', 'seq:9..12', 'sequence_space_required'],
    ['base 없음', 'repo:seqepoch/payments seq:9..12', 'sequence_space_required'],
    ['repo 없음', 'base:main seq:9..12', 'sequence_space_required'],
    ['repo 둘', 'repo:seqepoch/payments repo:seqepoch/billing base:main seq:9..12', 'sequence_space_ambiguous'],
    ['base 둘', 'repo:seqepoch/payments base:main base:develop seq:9..12', 'sequence_space_ambiguous'],
  ])('%s → 400', async (_label, query, reason) => {
    const { status, body } = await get(`q=${encodeURIComponent(query)}`);
    expect(status).toBe(400);
    expect(body.error?.code).toBe('INVALID_PARAMETER');
    expect(body.error?.detail?.['reason']).toBe(reason);
    // 무엇을 더해야 하는지 알려 준다 — "잘못됐다"만으로는 고칠 수 없다.
    expect(body.error?.detail?.['required_keys']).toEqual(['repo', 'base']);
  });

  it('중복 값은 하나로 본다 — `repo:` 두 번이 모호가 되지 않는다', async () => {
    const query = 'repo:seqepoch/payments repo:seqepoch/payments base:main seq:9..12';
    const { status } = await get(`q=${encodeURIComponent(query)}`);
    expect(status).toBe(200);
  });
});

describe('첫 요청이 에폭을 바인딩한다 (규칙 2)', () => {
  it('`seq_epoch` 없이 보내면 현재 에폭으로 조회하고 그 값을 응답에 싣는다', async () => {
    const { status, body } = await get(`q=${encodeURIComponent(BOUND)}`);

    expect(status).toBe(200);
    expect(body.sequence_context).toEqual({
      sequence_space: 'seqepoch/payments@main',
      repository: 'seqepoch/payments',
      base_branch: 'main',
      seq_epoch: 1,
      sequence_state: 'ok',
    });
    expect(body.epoch_stale).toBe(false);
    // 에폭 1의 문서만. 같은 서수에 있는 에폭 2 문서는 나오지 않는다.
    expect(body.items?.map((item) => item.pr_number).sort()).toEqual([101, 102, 103]);
  });

  it('현재 에폭을 명시해도 같은 결과다', async () => {
    const { body } = await get(`q=${encodeURIComponent(BOUND)}&seq_epoch=1`);
    expect(body.epoch_stale).toBe(false);
    expect(body.items?.map((item) => item.pr_number).sort()).toEqual([101, 102, 103]);
  });

  it('**`seq:`가 없는 질의에는 두 키가 아예 없다** — 빈 값으로 싣지 않는다', async () => {
    const { body } = await get(`q=${encodeURIComponent('repo:seqepoch/payments author:kim')}`);
    expect(body).not.toHaveProperty('sequence_context');
    expect(body).not.toHaveProperty('epoch_stale');
  });
});

describe('규칙 4: 에폭이 결과 집합을 실제로 가른다', () => {
  it('**같은 서수의 두 세대가 섞이지 않는다**', async () => {
    const first = await get(`q=${encodeURIComponent(BOUND)}&seq_epoch=1`);
    expect(first.body.items?.map((item) => item.seq_epoch)).toEqual([1, 1, 1]);

    await sequenceSpaceRepo.bumpEpoch(pool, PAYMENTS, BRANCH);
    const second = await get(`q=${encodeURIComponent(BOUND)}&seq_epoch=2`);

    expect(second.body.epoch_stale).toBe(false);
    expect(second.body.items?.map((item) => item.pr_number).sort()).toEqual([201, 202]);
    expect(second.body.items?.map((item) => item.seq_epoch)).toEqual([2, 2]);
  });

  it('**패싯도 같은 에폭만 센다** — 목록이 맞다고 버킷도 맞은 것은 아니다', async () => {
    const first = await get(`q=${encodeURIComponent(BOUND)}&seq_epoch=1&facets=true`);

    const oldLabels = first.body.facets?.['label'] ?? [];
    expect(oldLabels.map((one) => one.value)).toEqual(['old-gen']);
    expect(oldLabels[0]?.count).toBe(3);
    // 에폭 2의 `new-gen` 버킷이 섞이면 이 단언이 깨진다.
    expect(oldLabels.some((one) => one.value === 'new-gen')).toBe(false);

    /*
     * **다른 에폭에서도 버킷이 따라와야 한다** (변이 M4b가 이 구멍을 드러냈다).
     *
     * 한 에폭만 검사하면 패싯 질의가 그 값으로 **고정**돼 있어도 시험이
     * 통과한다 — 목록은 요청 에폭을 따르고 버킷은 상수를 세는 상태가
     * 그대로 병합된다. 두 세대를 다 물어야 "따라온다"가 증명된다.
     */
    await sequenceSpaceRepo.bumpEpoch(pool, PAYMENTS, BRANCH);
    const second = await get(`q=${encodeURIComponent(BOUND)}&seq_epoch=2&facets=true`);

    const newLabels = second.body.facets?.['label'] ?? [];
    expect(newLabels.map((one) => one.value)).toEqual(['new-gen']);
    expect(newLabels[0]?.count).toBe(2);
    expect(newLabels.some((one) => one.value === 'old-gen')).toBe(false);
  });
});

describe('규칙 3: 낡은 인용은 조회를 실행하지 않는다', () => {
  it('에폭이 오르면 옛 값으로 온 요청에 결과 키가 없다', async () => {
    await sequenceSpaceRepo.bumpEpoch(pool, PAYMENTS, BRANCH);

    const { status, body } = await get(`q=${encodeURIComponent(BOUND)}&seq_epoch=1`);

    expect(status).toBe(200);
    expect(body.epoch_stale).toBe(true);
    expect(body.requested_seq_epoch).toBe(1);
    expect(body.sequence_context?.seq_epoch).toBe(2);
    expect(body.next_cursor).toBeNull();

    /*
     * **계산하지 않은 것을 빈 값으로 채우지 않는다.** `items: []`·`total: 0`은
     * "구간이 비었다"는 거짓말이며, 사용자가 할 일이 정반대가 된다.
     */
    expect(body).not.toHaveProperty('items');
    expect(body).not.toHaveProperty('total');
    expect(body).not.toHaveProperty('facets');
    expect(body).not.toHaveProperty('relaxation_hints');
  });

  it('패싯을 요청해도 낡은 인용에는 세지 않는다', async () => {
    await sequenceSpaceRepo.bumpEpoch(pool, PAYMENTS, BRANCH);
    const { body } = await get(`q=${encodeURIComponent(BOUND)}&seq_epoch=1&facets=true`);
    expect(body.epoch_stale).toBe(true);
    expect(body).not.toHaveProperty('facets');
  });

  it('사용자가 현재 에폭을 명시하면 그때 새 세대가 나온다', async () => {
    await sequenceSpaceRepo.bumpEpoch(pool, PAYMENTS, BRANCH);
    const { body } = await get(`q=${encodeURIComponent(BOUND)}&seq_epoch=2`);
    expect(body.epoch_stale).toBe(false);
    expect(body.items?.map((item) => item.pr_number).sort()).toEqual([201, 202]);
  });
});

describe('규칙 5: 에폭이 커서 정체성의 일부다 (DEV-361)', () => {
  it('에폭 3의 커서를 에폭 4 조회에 쓰면 거절된다', async () => {
    const first = await get(`q=${encodeURIComponent(BOUND)}&seq_epoch=1&size=2`);
    const cursor = first.body.next_cursor;
    expect(cursor).toBeTruthy();

    await sequenceSpaceRepo.bumpEpoch(pool, PAYMENTS, BRANCH);

    const resumed = await get(
      `q=${encodeURIComponent(BOUND)}&seq_epoch=2&cursor=${encodeURIComponent(cursor ?? '')}`,
    );
    expect(resumed.status).toBe(400);
    expect(resumed.body.error?.code).toBe('CURSOR_QUERY_MISMATCH');
  });

  it('**낡은 인용이 커서보다 먼저 판정된다** — 옛 서수로 순회가 이어지지 않는다', async () => {
    const first = await get(`q=${encodeURIComponent(BOUND)}&seq_epoch=1&size=2`);
    const cursor = first.body.next_cursor ?? '';

    await sequenceSpaceRepo.bumpEpoch(pool, PAYMENTS, BRANCH);

    const resumed = await get(
      `q=${encodeURIComponent(BOUND)}&seq_epoch=1&cursor=${encodeURIComponent(cursor)}`,
    );
    // 400이 아니라 200 + `epoch_stale`이다. 2페이지를 내주지 않는다.
    expect(resumed.status).toBe(200);
    expect(resumed.body.epoch_stale).toBe(true);
    expect(resumed.body).not.toHaveProperty('items');
  });
});

describe('규칙 6·7: 확인할 수 없는 공간과 파라미터 형식', () => {
  it('**범위 밖 저장소를 지목하면 404다** — 존재를 알리지 않는다', async () => {
    const { status, body } = await get(
      `q=${encodeURIComponent('repo:seqepoch-hidden/secret base:main seq:9..12')}`,
    );
    expect(status).toBe(404);
    expect(body.error?.code).toBe('NOT_FOUND');
  });

  it('미등록 저장소도 **같은 404**다 — 두 답이 구분되면 그것이 존재 신탁이다', async () => {
    const { status, body } = await get(
      `q=${encodeURIComponent('repo:zzz-nope/zzz-nope base:main seq:9..12')}`,
    );
    expect(status).toBe(404);
    expect(body.error?.code).toBe('NOT_FOUND');
  });

  it.each(['abc', '0', '-1', '1.5'])('`seq_epoch=%s`는 400이다 — 무시하지 않는다', async (raw) => {
    const { status, body } = await get(`q=${encodeURIComponent(BOUND)}&seq_epoch=${raw}`);
    expect(status).toBe(400);
    expect(body.error?.code).toBe('INVALID_PARAMETER');
    expect(body.error?.detail?.['field']).toBe('seq_epoch');
  });

  it('`seq:`가 없는데 `seq_epoch`만 오면 거절한다', async () => {
    const { status, body } = await get(
      `q=${encodeURIComponent('repo:seqepoch/payments author:kim')}&seq_epoch=1`,
    );
    expect(status).toBe(400);
    expect(body.error?.detail?.['reason']).toBe('sequence_reference_absent');
  });
});

describe('완화 제안은 실행할 수 있는 질의만 제안한다 (CR-051)', () => {
  it('`repo:`·`base:`를 빼는 후보를 제안하지 않는다', async () => {
    // 0건이 되는 구간으로 완화 계산을 유발한다.
    const empty = 'repo:seqepoch/payments base:main seq:900..999 author:kim';
    const { body } = await get(`q=${encodeURIComponent(empty)}`);

    expect(body.total?.value).toBe(0);
    const removals = (body.relaxation_hints ?? []).map((hint) => hint.remove);
    /*
     * 그 둘을 빼면 남은 `seq:`가 공간을 잃어 AC-7이 400으로 거절한다.
     * "빼면 N건이 나옵니다"라고 제안해 놓고 실제로 빼면 오류가 나는 것은
     * 제안이 아니라 함정이다.
     */
    expect(removals.some((one) => one.startsWith('repo:'))).toBe(false);
    expect(removals.some((one) => one.startsWith('base:'))).toBe(false);
  });
});
