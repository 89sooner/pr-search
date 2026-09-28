/**
 * 0건 검색의 완화 후보와 `kind:` (CR-128 / FR-SRCH-006 AC-3, DEV-783·DEV-785).
 *
 * 실제 Fastify + Elasticsearch + PostgreSQL + Redis로 건다. 사내 `0.1.0-pilot.20`에서 `kind:`와 다른
 * 필터를 함께 쓴 검색이 결과가 0건일 때마다 500이었다 — 완화 후보가 `kind:`를 걷어 내지 않은 원래
 * AST로 `buildQuery`를 불러 `KindFilterNotAppliedError`로 던졌다. 운영 기본 화면(Repository
 * workspace)은 모든 검색에 `kind:`를 붙이므로 그 화면의 0건 검색이 전부 실패했다.
 *
 * ## 무엇을 거는가
 *
 * 「오류가 나지 않는다」가 아니라 **추천의 내용과 건수가 맞는다**를 건다. 후보마다 그 필터를 뺀 질의로
 * 실제로 다시 검색해, 그 건수가 `would_yield`와 같은지 대조한다(`expectHintsReproduce`). 그 밖에:
 *
 * - `kind:`를 뺀 후보는 요청 경로의 원래 대상(PR + 커밋)에서 센다 — 커밋이 새로 들어온다.
 * - 긍정·부정·같은 키 복수 값·모순 조건.
 * - 추천 건수에도 강제 접근 범위가 걸린다 — 범위 밖 문서의 존재가 새지 않는다.
 * - `seq:`·`mnum:`·`pr_number:`의 지목 규칙과 KST 달력 날짜 범위가 후보에서도 유지된다.
 * - 패싯 켜기·끄기.
 * - 추천 계산의 실패(msearch 실패·갈래 오류·시간 초과·샤드 실패)는 본 조회의 200을 바꾸지 않고
 *   `relaxation_hints_incomplete`로 밝히며, 본 조회·접근 범위의 실패는 전과 같다.
 *
 * 저장소 ID는 12_8xx 대역이다 — ES는 시험 파일 사이에 공유되므로 이 구분이 격리 수단이다. 끝나면
 * 자기 문서와 행만 지운다.
 */

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { errors, type Client } from '@elastic/elasticsearch';
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
import { parseQuery, serializeQuery } from '@prs/query';
import type { Redis } from '@prs/bus';
import { buildServer } from '../../src/server.js';
import { SEARCH_PATH } from '../../src/search/routes.js';
import type { SearchDiagnostic } from '../../src/search/service.js';
import type { AuthContext, AuthRedis } from '../../src/auth/context.js';
import { createTestRedis, migratedPool } from '../helpers.js';
import { TEST_CURSOR_KEY, TEST_CURSOR_SIGNER } from '../_cursor-fixture.js';

const AUTH_CONFIG = {
  enabled: true,
  cookieSecure: true,
  loginPath: '/auth/login',
  groupRoleMap: new Map<string, never>(),
} as const;

const PAYMENTS = 12_801;
const BILLING = 12_802;
const HIDDEN = 12_900;
const ORG = 128;
const BRANCH = 'main';
const PAY = 'cr128/payments';
const BILL = 'cr128/billing';
const SECRET = 'cr128/secret';

/** 두 저장소만 보는 사용자. `cr128/secret`은 범위 밖이다. */
const USER = 'sub-cr128-kim';
/** 비공개 저장소까지 보는 사용자 — 같은 질의의 추천 건수가 범위에 따라 달라지는지 본다. */
const WIDE_USER = 'sub-cr128-wide';
/** 볼 수 있는 저장소가 하나도 없는 사용자. */
const EMPTY_USER = 'sub-cr128-empty';

const SCOPES: ReadonlyMap<string, readonly number[]> = new Map([
  [USER, [PAYMENTS, BILLING]],
  [WIDE_USER, [PAYMENTS, BILLING, HIDDEN]],
  [EMPTY_USER, []],
]);

let pool: Pool;
let redis: Redis;
let es: Client;
let app: FastifyInstance;
let sessions: SessionStore;
const cookies = new Map<string, string>();
const logs: SearchDiagnostic[] = [];

/**
 * Elasticsearch 앞에 끼우는 고장 주입 (CR-128).
 *
 * 추천 계산의 실패는 실제 ES로는 재현할 수 없는 모양(통신 실패·갈래 오류·샤드 실패·시간 초과)이라
 * 응답만 바꾼다. 본 조회 실패(`search`)도 여기서 만든다 — 그것은 전처럼 오류여야 한다.
 */
type MsearchFault = 'none' | 'throw' | 'timeout' | 'branch_error' | 'shard_failure' | 'timed_out';
const faults: { msearch: MsearchFault; search: boolean; msearchCalls: number } = {
  msearch: 'none',
  search: false,
  msearchCalls: 0,
};

function faulty(client: Client): Client {
  return new Proxy(client, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver) as unknown;
      if (typeof value !== 'function') return value;
      const fn = value as (...args: unknown[]) => Promise<unknown>;
      if (prop === 'search') {
        return async (...args: unknown[]) => {
          if (faults.search) throw new errors.ConnectionError('main search down (test)');
          return fn.apply(target, args);
        };
      }
      if (prop === 'msearch') {
        return async (...args: unknown[]) => {
          faults.msearchCalls += 1;
          if (faults.msearch === 'throw') throw new errors.ConnectionError('relaxation msearch down (test)');
          if (faults.msearch === 'timeout') throw new errors.TimeoutError('Request timed out (test)');
          const response = (await fn.apply(target, args)) as { responses: Record<string, unknown>[] };
          if (faults.msearch === 'none' || response.responses.length === 0) return response;
          const [first, ...rest] = response.responses;
          const broken =
            faults.msearch === 'branch_error'
              ? { error: { type: 'search_phase_execution_exception', reason: 'test' }, status: 500 }
              : faults.msearch === 'shard_failure'
                ? { ...first, _shards: { total: 2, successful: 1, skipped: 0, failed: 1 } }
                : { ...first, timed_out: true };
          return { ...response, responses: [broken, ...rest] };
        };
      }
      return fn.bind(target);
    },
  });
}

interface Hint {
  readonly remove: string;
  readonly would_yield: number;
}

interface SearchBody {
  readonly total?: { value: number; relation: string };
  readonly items?: { kind: string; repository: string | null; pr_number?: number; commit_sha?: string }[];
  readonly relaxation_hints?: Hint[];
  readonly relaxation_hints_truncated?: boolean;
  readonly relaxation_hints_incomplete?: boolean;
  readonly facets?: Record<string, unknown>;
  readonly facets_status?: string;
  readonly next_cursor?: string | null;
  readonly correlation_id?: string;
  readonly error?: { code: string };
}

async function get(q: string, extra = '', user = USER): Promise<{ status: number; body: SearchBody }> {
  const response = await app.inject({
    method: 'GET',
    url: `${SEARCH_PATH}?q=${encodeURIComponent(q)}${extra}`,
    headers: { cookie: `${SESSION_COOKIE_NAME}=${cookies.get(user) ?? ''}` },
  });
  return { status: response.statusCode, body: response.json<SearchBody>() };
}

/** 결과가 0건인 정상 응답 — 200, `total` 0, 빈 `items`, `null` 커서. */
async function zero(q: string, extra = '', user = USER): Promise<SearchBody> {
  const { status, body } = await get(q, extra, user);
  expect({ q, status, error: body.error }).toEqual({ q, status: 200, error: undefined });
  expect(body.total).toEqual({ value: 0, relation: 'eq' });
  expect(body.items).toEqual([]);
  expect(body.next_cursor).toBeNull();
  return body;
}

/** 원래 질의에서 `remove`에 해당하는 필터 하나를 뺀 질의 문자열. */
function withoutFilter(q: string, remove: string): string {
  const ast = parseQuery(q);
  const index = ast.filters.findIndex((filter) => serializeQuery({ filters: [filter], text: null }) === remove);
  expect(index, `${remove} 필터가 ${q}에 있어야 한다`).toBeGreaterThanOrEqual(0);
  return serializeQuery({ ...ast, filters: ast.filters.filter((_, at) => at !== index) });
}

/**
 * **추천을 실제로 실행한 결과가 추천과 같다** — 후보마다 그 필터를 빼고 다시 검색한 건수가
 * `would_yield`와 같다. 추천이 거짓이면 사용자는 제안을 따른 뒤 다른 결과를 본다.
 */
async function expectHintsReproduce(q: string, hints: readonly Hint[], user = USER): Promise<void> {
  for (const hint of hints) {
    const relaxed = withoutFilter(q, hint.remove);
    const { status, body } = await get(relaxed, '', user);
    expect({ relaxed, status, total: body.total?.value }).toEqual({ relaxed, status: 200, total: hint.would_yield });
  }
}

function pr(id: string, fields: Record<string, unknown>): Record<string, unknown> {
  return {
    _id: id,
    org_id: ORG,
    visibility: 'internal',
    allowed_team_ids: [],
    base_branch: BRANCH,
    created_at: '2026-08-10T00:00:00Z',
    updated_at: '2026-08-20T00:00:00Z',
    changed_files_count: 1,
    additions: 1,
    deletions: 0,
    document_version: 1,
    ...fields,
  };
}

/*
 * 자료 — 무엇이 어디에 걸리는지.
 *
 * | 문서 | 저장소 | 작성자 | 상태 | 경로 | seq | M | 머지 시각(UTC → KST) |
 * | --- | --- | --- | --- | --- | --- | --- | --- |
 * | PR #1 | payments | kim | merged | src/pay/retry.ts | 1 | 1 | 08-19 05:02 → 08-19 14:02 |
 * | PR #2 | payments | lee | open | web/session.ts | – | – | – |
 * | PR #3 | billing | kim | open | src/billing/form.ts | – | – | – |
 * | PR #4 | payments | lee | merged | src/pay/refund.ts | 2 | 2 | 08-18 16:30 → **08-19 01:30** |
 * | PR #9 | **secret(범위 밖)** | kim | open | src/pay/secret.ts | – | – | – |
 * | 커밋 a… | payments | kim | (없음) | src/pay/retry.ts | – | – | source_commit |
 * | 커밋 b… | payments | lee | (없음) | src/pay/refund.ts | 2 | – | merge_commit |
 * | 커밋 c… | payments | lee | (없음) | src/pay/fix.ts | 3 | – | direct_push |
 * | 커밋 d… | **secret(범위 밖)** | lee | (없음) | src/pay/secret.ts | – | – | – |
 *
 * 커밋 문서에는 `state`·`labels`·`pr_number`·`merged_at`이 없다 — 그 조건이 남은 후보에서는
 * 커밋이 매치되지 않는다(정상이다, API 계약 API-SRCH-004).
 */
const PULL_REQUESTS = [
  pr('cr128-pr-1', {
    repository_id: PAYMENTS, repository: PAY, pr_number: 1, title: '결제 재시도', state: 'merged', author: 'kim',
    labels: ['backend'], merge_seq: 1, seq_epoch: 1, sequence_space: `${PAY}@${BRANCH}`, merge_number: 1,
    merge_number_epoch: 1, merged_at: '2026-08-19T05:02:11Z', changed_paths: ['src/pay/retry.ts'],
  }),
  pr('cr128-pr-2', {
    repository_id: PAYMENTS, repository: PAY, pr_number: 2, title: '세션 만료', state: 'open', author: 'lee',
    labels: ['frontend'], changed_paths: ['web/session.ts'],
  }),
  pr('cr128-pr-3', {
    repository_id: BILLING, repository: BILL, pr_number: 3, title: '청구서 양식', state: 'open', author: 'kim',
    labels: ['backend'], base_branch: 'develop', changed_paths: ['src/billing/form.ts'],
  }),
  pr('cr128-pr-4', {
    repository_id: PAYMENTS, repository: PAY, pr_number: 4, title: '환불', state: 'merged', author: 'lee',
    labels: ['backend'], merge_seq: 2, seq_epoch: 1, sequence_space: `${PAY}@${BRANCH}`, merge_number: 2,
    merge_number_epoch: 1, merged_at: '2026-08-18T16:30:00Z', changed_paths: ['src/pay/refund.ts'],
  }),
  pr('cr128-pr-9', {
    repository_id: HIDDEN, repository: SECRET, org_id: ORG + 1, visibility: 'private', pr_number: 9, title: '비밀',
    state: 'open', author: 'kim', labels: ['backend'], changed_paths: ['src/pay/secret.ts'],
  }),
];

const COMMITS = [
  {
    _id: 'cr128-c-a', repository_id: PAYMENTS, repository: PAY, org_id: ORG, visibility: 'internal', allowed_team_ids: [],
    commit_sha: 'a'.repeat(40), message: '재시도 구현', author: 'kim', committed_at: '2026-08-19T04:00:00Z',
    base_branch: BRANCH, role: 'source_commit', changed_paths: ['src/pay/retry.ts'], document_version: 1,
  },
  {
    _id: 'cr128-c-b', repository_id: PAYMENTS, repository: PAY, org_id: ORG, visibility: 'internal', allowed_team_ids: [],
    commit_sha: 'b'.repeat(40), message: 'Merge #4', author: 'lee', committed_at: '2026-08-18T16:30:00Z',
    base_branch: BRANCH, merge_seq: 2, seq_epoch: 1, sequence_space: `${PAY}@${BRANCH}`, role: 'merge_commit',
    changed_paths: ['src/pay/refund.ts'], document_version: 1,
  },
  {
    _id: 'cr128-c-c', repository_id: PAYMENTS, repository: PAY, org_id: ORG, visibility: 'internal', allowed_team_ids: [],
    commit_sha: 'c'.repeat(40), message: 'hotfix', author: 'lee', committed_at: '2026-08-20T01:00:00Z',
    base_branch: BRANCH, merge_seq: 3, seq_epoch: 1, sequence_space: `${PAY}@${BRANCH}`, role: 'direct_push',
    changed_paths: ['src/pay/fix.ts'], document_version: 1,
  },
  {
    _id: 'cr128-c-d', repository_id: HIDDEN, repository: SECRET, org_id: ORG + 1, visibility: 'private', allowed_team_ids: [],
    commit_sha: 'd'.repeat(40), message: '비밀 커밋', author: 'lee', committed_at: '2026-08-19T00:00:00Z',
    base_branch: BRANCH, role: 'source_commit', changed_paths: ['src/pay/secret.ts'], document_version: 1,
  },
];

async function clearFixtures(): Promise<void> {
  await es.deleteByQuery({
    index: ['prs-pull-requests', 'prs-commits'],
    query: { terms: { repository_id: [PAYMENTS, BILLING, HIDDEN] } },
    refresh: true,
    conflicts: 'proceed',
  });
}

beforeAll(async () => {
  pool = await migratedPool();
  redis = createTestRedis();
  es = createEsClient(resolveClientOptions());
  await applyMappings(es);
  await switchAliasesForTests(es);

  for (const user of SCOPES.keys()) {
    await pool.query('DELETE FROM permission_cache WHERE user_id = $1', [user]);
    await authRepo.upsertUserOnLogin(pool, { user_id: user, login: user, github_user_id: 12_800 + [...SCOPES.keys()].indexOf(user) });
  }
  for (const [id, owner, name, org] of [
    [PAYMENTS, 'cr128', 'payments', ORG],
    [BILLING, 'cr128', 'billing', ORG],
    [HIDDEN, 'cr128', 'secret', ORG + 1],
  ] as const) {
    await repositoryRepo.upsertRepository(pool, {
      repository_id: id, owner, name, org_id: org, visibility: 'internal', sequence_branches: [BRANCH],
    });
  }
  await sequenceSpaceRepo.ensureSequenceSpace(pool, PAYMENTS, BRANCH);
  await pool.query('UPDATE sequence_space SET seq_epoch = 1, state = $2 WHERE repository_id = $1 AND base_branch = $3', [
    PAYMENTS, 'ok', BRANCH,
  ]);

  await clearFixtures();
  const bulk = await es.bulk({
    refresh: true,
    operations: [
      ...PULL_REQUESTS.flatMap(({ _id, ...doc }) => [
        { index: { _index: 'prs-pull-requests', _id: _id as string } },
        { ...doc, doc_id: _id },
      ]),
      ...COMMITS.flatMap(({ _id, ...doc }) => [
        { index: { _index: 'prs-commits', _id } },
        { ...doc, doc_id: _id },
      ]),
    ],
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
    fetch: async (user) => ({
      repositoryIds: [...(SCOPES.get(user.userId) ?? [])],
      orgIds: [],
      teamIds: [],
      visibilities: [],
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
      // `mnum:` 후보를 시험한다 (CR-106의 게이트가 꺼진 배포에서는 400으로 거절한다).
      mergeNumberEnabled: true,
    },
    auth,
    search: {
      pool,
      es: faulty(es),
      cursorSigner: TEST_CURSOR_SIGNER,
      resolveNames: async (names) => ({
        orgIds: await repositoryRepo.resolveOrgIds(pool, names.orgs),
        teamIds: await authRepo.resolveTeamIds(pool, names.teams),
      }),
      log: (entry) => {
        logs.push(entry);
      },
    },
  });
  await app.ready();
}, 180_000);

beforeEach(async () => {
  faults.msearch = 'none';
  faults.search = false;
  faults.msearchCalls = 0;
  logs.length = 0;
  const now = Date.now();
  for (const user of SCOPES.keys()) {
    await redis.del(scopeKey(user));
    const sessionId = createSessionId();
    cookies.set(user, sessionId);
    await sessions.create({
      sessionId, userId: user, login: user, email: null, roles: ['developer'],
      issuedAt: now, lastSeenAt: now, correlationId: null,
    });
  }
});

afterAll(async () => {
  await app?.close();
  if (es !== undefined) await clearFixtures();
  await es?.close();
  for (const user of SCOPES.keys()) {
    await pool?.query('DELETE FROM permission_cache WHERE user_id = $1', [user]);
    await pool?.query('DELETE FROM app_user WHERE user_id = $1', [user]);
  }
  await pool?.query('DELETE FROM sequence_space WHERE repository_id = ANY($1)', [[PAYMENTS, BILLING, HIDDEN]]);
  await pool?.query('DELETE FROM repository WHERE repository_id = ANY($1)', [[PAYMENTS, BILLING, HIDDEN]]);
  await redis?.quit();
  await pool?.end();
});

describe('사내 보고의 질의 모양 — `kind:` + path + author + is (DEV-783)', () => {
  it('결과가 있으면 정상 목록이고 완화 키가 없다', async () => {
    const { status, body } = await get('kind:pull_request path:src/pay author:kim is:merged');
    expect(status).toBe(200);
    expect(body.total).toEqual({ value: 1, relation: 'eq' });
    expect(body.items?.map((item) => `${item.kind}:${String(item.pr_number)}`)).toEqual(['pull_request:1']);
    expect(body).not.toHaveProperty('relaxation_hints');
    expect(body).not.toHaveProperty('relaxation_hints_incomplete');
  });

  it('**같은 모양의 0건이 500이 아니라 200 + 정확한 후보다** — 범위 밖 PR은 세지 않는다', async () => {
    const q = `kind:pull_request path:src/pay author:lee is:open`;
    const body = await zero(q);
    /*
     * - `kind:`를 빼면 PR + 커밋: 커밋에는 state가 없어 0 → 후보 아님
     * - `path:`를 빼면 lee의 열린 PR: #2 → 1
     * - `author:`를 빼면 src/pay의 열린 PR: #9뿐인데 범위 밖 → 0 → 후보 아님 (존재가 새지 않는다)
     * - `is:`를 빼면 lee의 src/pay PR: #4 → 1
     */
    expect(body.relaxation_hints).toEqual([
      { remove: 'path:src/pay', would_yield: 1 },
      { remove: 'is:open', would_yield: 1 },
    ]);
    expect(body).not.toHaveProperty('relaxation_hints_incomplete');
    await expectHintsReproduce(q, body.relaxation_hints ?? []);
  });

  it('`path:` 없이도, 저장소 조건이 있어도 같다 — path나 저장소 이름이 원인이 아니다', async () => {
    for (const q of [
      'kind:pull_request author:nobody label:backend',
      `kind:pull_request repo:${PAY} author:nobody`,
      'kind:pull_request author:nobody',
    ]) {
      const body = await zero(q);
      expect(body.relaxation_hints?.length, q).toBeGreaterThan(0);
      expect(body, q).not.toHaveProperty('relaxation_hints_incomplete');
      await expectHintsReproduce(q, body.relaxation_hints ?? []);
    }
  });

  it('`kind:` 없는 0건은 전과 같다', async () => {
    const q = 'path:src/pay author:nobody';
    const body = await zero(q);
    // 경로를 빼도 nobody는 없다. 작성자를 빼면 src/pay의 PR #1·#4와 커밋 a·b·c.
    expect(body.relaxation_hints).toEqual([{ remove: 'author:nobody', would_yield: 5 }]);
    await expectHintsReproduce(q, body.relaxation_hints ?? []);
  });
});

describe('`kind:`를 뺀 후보는 원래 대상에서 다시 해석한다 (FR-SRCH-006 AC-3, CR-128)', () => {
  it('**PR로 좁힌 질의에서 `kind:`를 빼면 커밋이 새로 들어온다**', async () => {
    const q = 'kind:pull_request path:src/pay/fix.ts author:lee';
    const body = await zero(q);
    expect(body.relaxation_hints).toEqual([
      // lee의 PR #2·#4
      { remove: 'path:src/pay/fix.ts', would_yield: 2 },
      // 좁힌 대상(PR)으로 셌다면 0이라 빠졌을 후보 — 커밋 c가 들어온다
      { remove: 'kind:pull_request', would_yield: 1 },
    ]);
    await expectHintsReproduce(q, body.relaxation_hints ?? []);
    const { body: relaxed } = await get('path:src/pay/fix.ts author:lee');
    expect(relaxed.items?.map((item) => item.kind)).toEqual(['commit']);
  });

  it('`kind:commit`의 0건에서 `kind:`를 빼면 PR이 들어온다', async () => {
    const q = 'kind:commit path:src/pay author:kim label:backend';
    const body = await zero(q);
    expect(body.relaxation_hints).toEqual([
      // PR #1 (#9는 범위 밖)
      { remove: 'kind:commit', would_yield: 1 },
      // 커밋 a
      { remove: 'label:backend', would_yield: 1 },
    ]);
    await expectHintsReproduce(q, body.relaxation_hints ?? []);
  });

  it('부정 `-kind:commit`도 같다', async () => {
    const q = '-kind:commit path:src/pay/fix.ts author:lee';
    const body = await zero(q);
    expect(body.relaxation_hints).toEqual([
      { remove: 'path:src/pay/fix.ts', would_yield: 2 },
      { remove: '-kind:commit', would_yield: 1 },
    ]);
    await expectHintsReproduce(q, body.relaxation_hints ?? []);
  });

  it('같은 키의 복수 값(`kind:pull_request kind:commit`)은 하나의 필터로 뺀다', async () => {
    const q = 'kind:pull_request kind:commit path:src/pay/fix.ts author:kim';
    const body = await zero(q);
    expect(body.relaxation_hints).toEqual([
      // kim의 PR #1·#3과 커밋 a (#9는 범위 밖)
      { remove: 'path:src/pay/fix.ts', would_yield: 3 },
      // 커밋 c
      { remove: 'author:kim', would_yield: 1 },
    ]);
    await expectHintsReproduce(q, body.relaxation_hints ?? []);
  });
});

describe('모순된 `kind:` — 본 조회는 하지 않고 후보는 센다 (CR-128)', () => {
  it('`kind:pull_request -kind:pull_request`에서 둘 중 하나를 빼면 결과가 생긴다', async () => {
    const q = 'kind:pull_request -kind:pull_request author:lee';
    const body = await zero(q);
    expect(body.relaxation_hints).toEqual([
      // 커밋 b·c (d는 범위 밖)
      { remove: 'kind:pull_request', would_yield: 2 },
      // PR #2·#4
      { remove: '-kind:pull_request', would_yield: 2 },
    ]);
    expect(body).not.toHaveProperty('relaxation_hints_incomplete');
    // 저자를 뺀 후보는 남은 유형이 없어 조회하지 않는다 — 두 갈래만 보낸다.
    expect(faults.msearchCalls).toBe(1);
    await expectHintsReproduce(q, body.relaxation_hints ?? []);
  });

  it('부정만으로 모든 유형을 뺀 질의도 같다', async () => {
    const q = '-kind:commit -kind:pull_request author:lee';
    const body = await zero(q);
    expect(body.relaxation_hints).toEqual([{ remove: '-kind:commit -kind:pull_request', would_yield: 4 }]);
    await expectHintsReproduce(q, body.relaxation_hints ?? []);
  });

  it('**볼 수 있는 저장소가 없는 사용자는 모순된 질의에서도 503이다** — 인가 실패를 200으로 바꾸지 않는다', async () => {
    const { status, body } = await get('kind:pull_request -kind:pull_request author:lee', '', EMPTY_USER);
    expect([status, body.error?.code]).toEqual([503, 'PERMISSION_UNAVAILABLE']);
  });
});

describe('추천 건수에도 강제 접근 범위가 걸린다 (ADR-008, FR-SRCH-006 AC-4)', () => {
  it('범위 밖 문서만 맞는 후보는 나오지 않는다 — 같은 질의라도 범위가 넓으면 나온다', async () => {
    const q = 'kind:pull_request path:src/pay/secret.ts author:nobody';
    const narrow = await zero(q);
    expect(narrow.relaxation_hints).toEqual([]);
    expect(narrow).not.toHaveProperty('relaxation_hints_incomplete');

    const wide = await zero(q, '', WIDE_USER);
    expect(wide.relaxation_hints).toEqual([{ remove: 'author:nobody', would_yield: 1 }]);
    await expectHintsReproduce(q, wide.relaxation_hints ?? [], WIDE_USER);
  });
});

describe('지목 규칙과 시간대는 후보에서도 그대로다 (CR-051·CR-106·CR-127)', () => {
  it('`seq:` — 저장소·브랜치를 빼는 후보는 없고, `kind:`를 빼면 그 구간의 커밋을 센다', async () => {
    const q = `kind:pull_request repo:${PAY} base:${BRANCH} seq:3..3 author:lee`;
    const body = await zero(q);
    expect(body.relaxation_hints).toEqual([
      // lee의 payments@main PR #2·#4
      { remove: 'seq:3..3', would_yield: 2 },
      // 서수 3의 직접 푸시 커밋 c
      { remove: 'kind:pull_request', would_yield: 1 },
    ]);
    await expectHintsReproduce(q, body.relaxation_hints ?? []);
  });

  it('`pr_number:` — 저장소를 빼는 후보는 없다', async () => {
    const q = `kind:pull_request repo:${PAY} pr_number:1..4 author:nobody`;
    const body = await zero(q);
    expect(body.relaxation_hints).toEqual([{ remove: 'author:nobody', would_yield: 3 }]);
    await expectHintsReproduce(q, body.relaxation_hints ?? []);
  });

  it('`mnum:` — 같은 에폭·브랜치로 센다', async () => {
    const q = `kind:pull_request repo:${PAY} base:${BRANCH} mnum:1..2 author:nobody`;
    const body = await zero(q);
    expect(body.relaxation_hints).toEqual([{ remove: 'author:nobody', would_yield: 2 }]);
    await expectHintsReproduce(q, body.relaxation_hints ?? []);
  });

  it('KST 달력 날짜 — 한국 날짜 8/19에 머지된 PR 둘을 센다(UTC 날짜라면 하나)', async () => {
    const q = 'kind:pull_request merged:2026-08-19..2026-08-19@Asia/Seoul author:nobody';
    const body = await zero(q);
    expect(body.relaxation_hints).toEqual([{ remove: 'author:nobody', would_yield: 2 }]);
    await expectHintsReproduce(q, body.relaxation_hints ?? []);
  });
});

describe('패싯 켜기·끄기', () => {
  it('패싯을 켜도 0건 응답과 후보가 같고, 패싯 세 키가 함께 온다', async () => {
    const q = 'kind:pull_request path:src/pay author:lee is:open';
    const on = await zero(q, '&facets=true');
    const off = await zero(q);
    expect(on.relaxation_hints).toEqual(off.relaxation_hints);
    expect(on.facets_status).toBe('ready');
    expect(off).not.toHaveProperty('facets');
  });
});

describe('추천 계산의 실패는 격리하고 밝힌다 (FR-SRCH-006 예외/실패 처리, DEV-785)', () => {
  const Q = 'kind:pull_request path:src/pay author:lee is:open';

  it.each([
    ['msearch 통신 실패', 'throw', 'msearch', 'ConnectionError'],
    ['msearch 왕복 상한 초과', 'timeout', 'msearch', 'TimeoutError'],
  ] as const)('%s → 200 · 0건 · 빈 목록 + incomplete, 진단 로그에 correlation ID', async (_label, fault, stage, reason) => {
    faults.msearch = fault;
    const body = await zero(Q);
    expect(body.relaxation_hints).toEqual([]);
    expect(body.relaxation_hints_incomplete).toBe(true);
    expect(logs).toEqual([
      expect.objectContaining({
        event: 'search.relaxation_incomplete',
        level: 'warn',
        stage,
        reason,
        counted: 4,
        failed: 4,
        correlation_id: body.correlation_id,
      }),
    ]);
    // 질의 문자열을 로그에 싣지 않는다.
    expect(JSON.stringify(logs)).not.toContain('src/pay');
  });

  it.each([
    ['갈래 오류', 'branch_error', 'search_phase_execution_exception'],
    ['갈래의 샤드 실패', 'shard_failure', 'shard_failures'],
    ['갈래의 시간 예산 초과', 'timed_out', 'timed_out'],
  ] as const)('%s → 그 후보만 빼고 나머지는 정확하게, incomplete', async (_label, fault, reason) => {
    faults.msearch = fault;
    const body = await zero(Q);
    // 첫 갈래(`kind:`를 뺀 후보)는 원래 0이라 목록이 같다 — 그래도 「다 셌다」고 말하지 않는다.
    expect(body.relaxation_hints).toEqual([
      { remove: 'path:src/pay', would_yield: 1 },
      { remove: 'is:open', would_yield: 1 },
    ]);
    expect(body.relaxation_hints_incomplete).toBe(true);
    expect(logs).toEqual([
      expect.objectContaining({ stage: 'branch', reason, counted: 4, failed: 1, correlation_id: body.correlation_id }),
    ]);
  });

  it('본 조회의 실패는 여전히 오류다 — 추천 격리가 넓어지지 않는다', async () => {
    faults.search = true;
    const { status } = await get(Q);
    expect(status).toBe(500);
    expect(faults.msearchCalls).toBe(0);
  });

  it('결과가 있으면 추천을 계산하지 않는다', async () => {
    faults.msearch = 'throw';
    const { status, body } = await get('kind:pull_request author:lee');
    expect(status).toBe(200);
    expect(body.total?.value).toBe(2);
    expect(faults.msearchCalls).toBe(0);
    expect(logs).toEqual([]);
  });
});
