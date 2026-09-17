/**
 * `pr_number:`·`mnum:` 식별자 범위 (CR-106 / FR-SRCH-005 AC-8·AC-9).
 *
 * 실제 Fastify + Elasticsearch + PostgreSQL + Redis로 건다 (`sequence-epoch.test.ts`의
 * 셋업 패턴을 그대로 재사용한다). 단위 시험은 지목 판정의 **모양**과 `buildQuery`가
 * 만드는 절의 **모양**을 본다 — 여기서는 그 절이 실제 색인에서 어떤 문서를
 * 가르는지를 본다.
 *
 * ## 가장 중요한 시험은 두 에폭 필드가 실제로 분리돼 있다는 것이다
 *
 * `mnum:`은 `merge_number_epoch`에 걸리고 `seq:`는 `seq_epoch`에 걸린다
 * (query-builder.ts 주석) — 이 둘이 실은 같은 필드였다면(변이) 아래 D130·D140
 * 픽스처가 정확히 그 차이를 드러낸다.
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

const USER = 'sub-cr106-range';
// CR 번호를 딴 저장소 ID 대역 — 다른 통합 시험 파일(seqepoch 51xx, facets 81xx)과
// 겹치지 않는다. ES는 워크트리 사이에 공유되므로 이 구분이 실제로 격리 수단이다.
const PAYMENTS = 10_601;
const HIDDEN = 10_900;
const ORG = 106;
const BRANCH = 'main';

let pool: Pool;
let redis: Redis;
let es: Client;
let app: FastifyInstance;
let sessionId: string;
let sessions: SessionStore;

interface SearchBody {
  readonly total?: { value: number; relation: string };
  readonly items?: { pr_number?: number; merge_seq: number | null }[];
  readonly facets?: Record<string, { value: string; count: number }[]>;
  readonly next_cursor?: string | null;
  readonly relaxation_hints?: { remove: string; would_yield: number }[];
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

function prNumbersOf(body: SearchBody): number[] {
  return (body.items ?? []).map((item) => item.pr_number ?? 0);
}

interface FixtureOptions {
  readonly repositoryId: number;
  readonly repository: string;
  readonly orgId: number;
  readonly prNumber: number;
  readonly label: string;
  /** M 번호 배정. `undefined`면 필드 자체를 뺀다 — pending·미대상 PR. */
  readonly mergeNumber?: number;
  readonly mergeNumberEpoch?: number;
  /** PR 투영 자체의 `seq_epoch` — 기본은 1. D140에서만 2로 어긋나게 둔다. */
  readonly seqEpoch?: number;
}

/**
 * `pr_number:`·`mnum:` 두 질의가 함께 쓰는 픽스처 문서.
 *
 * `merge_seq`는 `pr_number`와 같은 값을 쓴다 — 기본 정렬(merge_seq desc)의
 * 순서를 예측 가능하게 만들려는 것일 뿐 이 CR의 관심사가 아니다.
 */
function pr(options: FixtureOptions) {
  return {
    _id: `id-pr-${String(options.repositoryId)}-${String(options.prNumber)}`,
    repository_id: options.repositoryId,
    repository: options.repository,
    org_id: options.orgId,
    visibility: 'internal',
    allowed_team_ids: [options.orgId * 10],
    pr_number: options.prNumber,
    title: `범위 픽스처 PR #${String(options.prNumber)}`,
    state: 'merged',
    author: 'kim',
    labels: [options.label],
    base_branch: BRANCH,
    merge_seq: options.prNumber,
    seq_epoch: options.seqEpoch ?? 1,
    sequence_space: `${options.repository}@${BRANCH}`,
    ...(options.mergeNumber === undefined ? {} : { merge_number: options.mergeNumber }),
    ...(options.mergeNumberEpoch === undefined ? {} : { merge_number_epoch: options.mergeNumberEpoch }),
    merged_at: '2026-08-19T05:02:11Z',
    created_at: '2026-08-15T00:00:00Z',
    updated_at: '2026-08-19T05:02:11Z',
    changed_files_count: 1,
    additions: 10,
    deletions: 1,
    document_version: 1,
  };
}

/*
 * pr_number:100..200 아래에서 보이는 것: 100·150·200·120·130·140 (경계 포함,
 * pending·다른 에폭도 pr_number 조건에는 무관하다).
 *
 * mnum:10..20 아래(DB 에폭 1)에서 보이는 것: 100(mn10)·150(mn15)·200(mn20)·
 * 140(mn14) 넷뿐이다 — 120은 배정이 없고(pending), 130은 mn13이 범위 안이지만
 * `merge_number_epoch=2`라 현재 에폭(1)과 맞지 않는다. **140이 핵심이다**:
 * 이 문서만 `seq_epoch=2`로 어긋나 있는데도 mnum: 조건에는 그대로 걸린다 —
 * 게이트가 `seq_epoch`이 아니라 `merge_number_epoch`를 본다는 증거다.
 */
const PULL_REQUESTS = [
  pr({ repositoryId: PAYMENTS, repository: 'cr106range/payments', orgId: ORG, prNumber: 100, label: 'inrange', mergeNumber: 10, mergeNumberEpoch: 1 }),
  pr({ repositoryId: PAYMENTS, repository: 'cr106range/payments', orgId: ORG, prNumber: 150, label: 'inrange', mergeNumber: 15, mergeNumberEpoch: 1 }),
  pr({ repositoryId: PAYMENTS, repository: 'cr106range/payments', orgId: ORG, prNumber: 200, label: 'inrange', mergeNumber: 20, mergeNumberEpoch: 1 }),
  // 경계 바로 밖 대조군 — pr_number·mnum 둘 다에서 빠져야 한다.
  pr({ repositoryId: PAYMENTS, repository: 'cr106range/payments', orgId: ORG, prNumber: 201, label: 'outrange', mergeNumber: 21, mergeNumberEpoch: 1 }),
  pr({ repositoryId: PAYMENTS, repository: 'cr106range/payments', orgId: ORG, prNumber: 99, label: 'outrange', mergeNumber: 9, mergeNumberEpoch: 1 }),
  // pending: M 번호 미배정. pr_number:에는 걸리지만 mnum:에는 절대 걸리면 안 된다.
  pr({ repositoryId: PAYMENTS, repository: 'cr106range/payments', orgId: ORG, prNumber: 120, label: 'pending' }),
  // 미래 에폭(변이 킬러 C): mn13은 범위 안이지만 그 값이 실린 에폭이 아직 현재가 아니다.
  pr({ repositoryId: PAYMENTS, repository: 'cr106range/payments', orgId: ORG, prNumber: 130, label: 'wrongepoch', mergeNumber: 13, mergeNumberEpoch: 2 }),
  // 변이 킬러 B: 문서 자신의 seq_epoch는 2로 어긋나 있어도 merge_number_epoch=1이면 현재 에폭(1)에 걸린다.
  pr({ repositoryId: PAYMENTS, repository: 'cr106range/payments', orgId: ORG, prNumber: 140, label: 'inrange', mergeNumber: 14, mergeNumberEpoch: 1, seqEpoch: 2 }),
  // 범위 밖 저장소. 두 질의 다 이것을 볼 수 없어야 한다 — pr_number도 mnum도 접근 범위를 지난다.
  pr({ repositoryId: HIDDEN, repository: 'cr106range-hidden/secret', orgId: ORG + 1, prNumber: 150, label: 'hidden', mergeNumber: 15, mergeNumberEpoch: 1 }),
];

beforeAll(async () => {
  pool = await migratedPool();
  redis = createTestRedis();
  es = createEsClient(resolveClientOptions());
  await applyMappings(es);
  await switchAliasesForTests(es);

  await pool.query('DELETE FROM sequence_space WHERE repository_id = ANY($1)', [[PAYMENTS, HIDDEN]]);
  await pool.query('DELETE FROM repository WHERE repository_id = ANY($1)', [[PAYMENTS, HIDDEN]]);
  await pool.query('DELETE FROM permission_cache WHERE user_id = $1', [USER]);
  await pool.query('DELETE FROM app_user WHERE user_id = $1', [USER]);

  await authRepo.upsertUserOnLogin(pool, {
    user_id: USER,
    login: 'cr106-range-kim',
    github_user_id: 76_001,
  });
  // **`cr106range/ghost`는 일부러 등록하지 않는다** — 미등록 저장소의 404 시험용이다.
  for (const [id, owner, name, org] of [
    [PAYMENTS, 'cr106range', 'payments', ORG],
    [HIDDEN, 'cr106range-hidden', 'secret', ORG + 1],
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
      teamIds: [ORG * 10],
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
      /*
       * CR-106. 이 파일은 `mnum:`을 시험하므로 켜야 한다 — 독립 검토 이전에는
       * 이 플래그를 검사하는 코드 자체가 없어 값과 무관하게 통과했지만, 지금은
       * 꺼진 배포에서 `mnum:`을 `QUERY_SYNTAX_ERROR`로 거절하는 게이트가 생겼다
       * (다른 두 API도 마찬가지다, `checkMergeNumberFeatureFlag`).
       */
      mergeNumberEnabled: true,
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
  await es?.deleteByQuery({
    index: ['prs-pull-requests'],
    query: { terms: { repository_id: [PAYMENTS, HIDDEN] } },
    refresh: true,
    conflicts: 'proceed',
  });
  await pool?.query('DELETE FROM permission_cache WHERE user_id = $1', [USER]);
  await pool?.query('DELETE FROM app_user WHERE user_id = $1', [USER]);
  await pool?.query('DELETE FROM sequence_space WHERE repository_id = ANY($1)', [[PAYMENTS, HIDDEN]]);
  await pool?.query('DELETE FROM repository WHERE repository_id = ANY($1)', [[PAYMENTS, HIDDEN]]);
  await redis?.quit();
  await pool?.end();
});

beforeEach(async () => {
  // 에폭을 1로 되돌린다 — 에폭 시험이 이 값을 바꾸므로 시험마다 시작점이 같아야 한다.
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
    login: 'cr106-range-kim',
    email: null,
    roles: ['developer'],
    issuedAt: now,
    lastSeenAt: now,
    correlationId: null,
  });
});

const PR_NUMBER_QUERY = 'repo:cr106range/payments pr_number:100..200';
const MNUM_QUERY = 'repo:cr106range/payments base:main mnum:10..20';

describe('AC-8: pr_number: 는 repo: 하나만 지목하면 된다', () => {
  it('범위 안의 PR만 나온다 — 양끝 포함', async () => {
    const { status, body } = await get(`q=${encodeURIComponent(PR_NUMBER_QUERY)}`);
    expect(status).toBe(200);
    expect(prNumbersOf(body).sort((a, b) => a - b)).toEqual([100, 120, 130, 140, 150, 200]);
  });

  it('경계 바로 밖은 빠진다', async () => {
    const { body } = await get(`q=${encodeURIComponent(PR_NUMBER_QUERY)}`);
    const numbers = prNumbersOf(body);
    expect(numbers).not.toContain(201);
    expect(numbers).not.toContain(99);
  });

  it('**M 번호가 배정되지 않은 PR도 나온다** — pr_number:는 M 번호와 무관하다', async () => {
    const { body } = await get(`q=${encodeURIComponent(PR_NUMBER_QUERY)}`);
    expect(prNumbersOf(body)).toContain(120);
  });

  it('접근 범위 밖 저장소는 같은 pr_number라도 나오지 않는다', async () => {
    const { body } = await get(`q=${encodeURIComponent('repo:cr106range-hidden/secret pr_number:100..200')}`);
    // 저장소 자체가 접근 범위 밖이라 이 질의는 그 저장소를 아예 볼 수 없다.
    expect(body.total?.value).toBe(0);
  });

  it('`repo:` 없이 쓰면 400 repository_required다', async () => {
    const { status, body } = await get(`q=${encodeURIComponent('pr_number:100..200')}`);
    expect(status).toBe(400);
    expect(body.error?.code).toBe('INVALID_PARAMETER');
    expect(body.error?.detail?.['reason']).toBe('repository_required');
    expect(body.error?.detail?.['required_keys']).toEqual(['repo']);
  });

  it('`base:`는 있어도 없어도 무관하다', async () => {
    const withBase = await get(`q=${encodeURIComponent(`${PR_NUMBER_QUERY} base:main`)}`);
    const withoutBase = await get(`q=${encodeURIComponent(PR_NUMBER_QUERY)}`);
    expect(prNumbersOf(withBase.body).sort()).toEqual(prNumbersOf(withoutBase.body).sort());
  });
});

describe('AC-9: mnum: 은 seq:와 같은 공간 지목을 요구한다', () => {
  it('배정된 M 번호가 범위 안인 PR만 나온다 — 양끝 포함', async () => {
    const { status, body } = await get(`q=${encodeURIComponent(MNUM_QUERY)}`);
    expect(status).toBe(200);
    expect(prNumbersOf(body).sort((a, b) => a - b)).toEqual([100, 140, 150, 200]);
  });

  it('**pending(미배정) PR은 절대 섞이지 않는다**', async () => {
    const { body } = await get(`q=${encodeURIComponent(MNUM_QUERY)}`);
    expect(prNumbersOf(body)).not.toContain(120);
  });

  it('**다른 에폭에 배정된 M 번호는 범위 안이어도 섞이지 않는다** (변이 킬러)', async () => {
    const { body } = await get(`q=${encodeURIComponent(MNUM_QUERY)}`);
    // pr130의 merge_number(13)는 10..20 범위 안이지만 merge_number_epoch가 2라
    // 현재 에폭(1)과 다르다 — merge_number_epoch 필터가 실제로 실려야 빠진다.
    expect(prNumbersOf(body)).not.toContain(130);
  });

  it('**게이트는 문서 자신의 seq_epoch가 아니라 merge_number_epoch를 본다**', async () => {
    const { body } = await get(`q=${encodeURIComponent(MNUM_QUERY)}`);
    // pr140은 seq_epoch=2로 어긋나 있지만 merge_number_epoch=1이라 여전히 걸린다.
    // 게이트가 seq_epoch를 봤다면(변이) 이 문서는 빠졌을 것이다.
    expect(prNumbersOf(body)).toContain(140);
  });

  it('`base:` 없이 쓰면 400 sequence_space_required다', async () => {
    const { status, body } = await get(`q=${encodeURIComponent('repo:cr106range/payments mnum:10..20')}`);
    expect(status).toBe(400);
    expect(body.error?.code).toBe('INVALID_PARAMETER');
    expect(body.error?.detail?.['reason']).toBe('sequence_space_required');
  });

  it('미등록 저장소를 지목하면 404다', async () => {
    const { status, body } = await get(
      `q=${encodeURIComponent('repo:cr106range/ghost base:main mnum:1..5')}`,
    );
    expect(status).toBe(404);
    expect(body.error?.code).toBe('NOT_FOUND');
  });
});

describe('에폭이 오르면 세대가 바뀐다 — 섞이지 않는다', () => {
  it('에폭을 올리면 이전 세대의 M 번호는 사라지고 새 세대만 남는다', async () => {
    const before = await get(`q=${encodeURIComponent(MNUM_QUERY)}`);
    expect(prNumbersOf(before.body).sort((a, b) => a - b)).toEqual([100, 140, 150, 200]);

    await sequenceSpaceRepo.bumpEpoch(pool, PAYMENTS, BRANCH);

    const after = await get(`q=${encodeURIComponent(MNUM_QUERY)}`);
    // pr130(mn13, merge_number_epoch=2)만 새 에폭(2)과 일치해 나타난다.
    expect(prNumbersOf(after.body)).toEqual([130]);
    // 이전 세대 넷과 새 세대 하나 사이에 교집합이 없다 — 섞이지 않는다.
    const beforeSet = new Set(prNumbersOf(before.body));
    for (const n of prNumbersOf(after.body)) expect(beforeSet.has(n)).toBe(false);
  });
});

describe('total·facets·목록·다음 커서가 같은 조건을 일관되게 반영한다', () => {
  it('한 페이지 안에서 total과 목록 길이가 맞고, label 패싯 합도 같다', async () => {
    const { body } = await get(`q=${encodeURIComponent(`${MNUM_QUERY} label:inrange`)}&facets=true&size=10`);
    expect(body.total?.value).toBe(4);
    expect(body.items).toHaveLength(4);
    expect(body.next_cursor).toBeNull();
    const labelFacet = body.facets?.['label'] ?? [];
    expect(labelFacet).toEqual([{ value: 'inrange', count: 4 }]);
  });

  it('페이지를 나눠도 total은 그대로이고, 모아 보면 한 페이지 결과와 같다', async () => {
    const whole = await get(`q=${encodeURIComponent(MNUM_QUERY)}&size=10`);

    const page1 = await get(`q=${encodeURIComponent(MNUM_QUERY)}&size=2`);
    expect(page1.body.total?.value).toBe(4);
    expect(page1.body.items).toHaveLength(2);
    expect(page1.body.next_cursor).toBeTruthy();

    const page2 = await get(
      `q=${encodeURIComponent(MNUM_QUERY)}&size=2&cursor=${encodeURIComponent(page1.body.next_cursor ?? '')}`,
    );
    expect(page2.body.total?.value).toBe(4);
    expect(page2.body.items).toHaveLength(2);
    expect(page2.body.next_cursor).toBeNull();

    const paged = [...prNumbersOf(page1.body), ...prNumbersOf(page2.body)].sort((a, b) => a - b);
    expect(paged).toEqual(prNumbersOf(whole.body).sort((a, b) => a - b));
  });

  it('같은 질의를 두 번 물어도 같은 답이다', async () => {
    const first = await get(`q=${encodeURIComponent(MNUM_QUERY)}`);
    const second = await get(`q=${encodeURIComponent(MNUM_QUERY)}`);
    expect(prNumbersOf(second.body).sort()).toEqual(prNumbersOf(first.body).sort());
    expect(second.body.total).toEqual(first.body.total);
  });
});

describe('커서: mnum: 이 커서 정체성의 일부다 (이 CR의 핵심 안전 속성)', () => {
  it('**mnum: 범위를 바꿔서 같은 커서로 이어 보면 CURSOR_QUERY_MISMATCH다**', async () => {
    const first = await get(`q=${encodeURIComponent(MNUM_QUERY)}&size=2`);
    const cursor = first.body.next_cursor;
    expect(cursor).toBeTruthy();

    const widened = 'repo:cr106range/payments base:main mnum:10..21';
    const resumed = await get(`q=${encodeURIComponent(widened)}&size=2&cursor=${encodeURIComponent(cursor ?? '')}`);

    expect(resumed.status).toBe(400);
    expect(resumed.body.error?.code).toBe('CURSOR_QUERY_MISMATCH');
  });

  it('**M 번호 에폭이 바뀌어도 같은 커서는 거절된다**', async () => {
    const first = await get(`q=${encodeURIComponent(MNUM_QUERY)}&size=2`);
    const cursor = first.body.next_cursor;
    expect(cursor).toBeTruthy();

    await sequenceSpaceRepo.bumpEpoch(pool, PAYMENTS, BRANCH);

    const resumed = await get(`q=${encodeURIComponent(MNUM_QUERY)}&size=2&cursor=${encodeURIComponent(cursor ?? '')}`);
    expect(resumed.status).toBe(400);
    expect(resumed.body.error?.code).toBe('CURSOR_QUERY_MISMATCH');
  });
});

describe('완화 제안은 실행할 수 있는 질의만 제안한다 (relaxation.ts, CR-106)', () => {
  /*
   * `mnum:10..20`·`pr_number:100..200`은 그대로면 각각 4건·6건이 나오는
   * 범위다(위 describe 블록) — 여기서는 `author:`를 더해 0건으로 만든다.
   * **범위를 무관한 값으로 비우지 않는다**: 그러면 `author:`를 빼도 여전히
   * 0건이라 "빼면 실제로 나온다"는 것을 증명하지 못한다.
   */
  it('`mnum:`이 남는데 `repo:`·`base:`를 빼는 후보를 제안하지 않는다', async () => {
    const empty = `${MNUM_QUERY} author:ghost-nobody`;
    const { body } = await get(`q=${encodeURIComponent(empty)}`);

    expect(body.total?.value).toBe(0);
    const removals = (body.relaxation_hints ?? []).map((hint) => hint.remove);
    // 그 둘을 빼면 남은 mnum:이 공간을 잃어 AC-9가 400으로 거절한다.
    expect(removals.some((one) => one.startsWith('repo:'))).toBe(false);
    expect(removals.some((one) => one.startsWith('base:'))).toBe(false);
    // author:는 빼도 여전히 실행 가능하다 — 실제로 4건이 나온다는 것까지 확인한다.
    const authorHint = (body.relaxation_hints ?? []).find((hint) => hint.remove === 'author:ghost-nobody');
    expect(authorHint?.would_yield).toBe(4);
  });

  it('`pr_number:`가 남는데 `repo:`를 빼는 후보를 제안하지 않는다', async () => {
    const empty = `${PR_NUMBER_QUERY} author:ghost-nobody`;
    const { body } = await get(`q=${encodeURIComponent(empty)}`);

    expect(body.total?.value).toBe(0);
    const removals = (body.relaxation_hints ?? []).map((hint) => hint.remove);
    expect(removals.some((one) => one.startsWith('repo:'))).toBe(false);
    const authorHint = (body.relaxation_hints ?? []).find((hint) => hint.remove === 'author:ghost-nobody');
    expect(authorHint?.would_yield).toBe(6);
  });
});
