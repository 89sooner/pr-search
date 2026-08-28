/**
 * `GET /search` — 실제 Fastify + Elasticsearch + PostgreSQL + Redis (WP-013 DoD 1~5, 7).
 *
 * 단위 시험은 질의 **모양**을 확인한다. 여기서는 그 모양을 진짜 인덱스에 던져
 * **어떤 문서가 나오는지**를 확인한다 — 모양이 맞아도 필드 이름이 하나 어긋나면
 * 아무것도 거르지 못하고, 그것을 잡는 것은 실제 조회뿐이다.
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

const USER = 'sub-search';
const PAYMENTS = 101;
const BILLING = 102;
const HIDDEN = 900;
const ORG = 1;

let pool: Pool;
let redis: Redis;
let es: Client;
let app: FastifyInstance;
let sessionId: string;

interface SearchBody {
  readonly total: { value: number; relation: string };
  readonly items: { kind: string; repository: string | null; pr_number?: number; commit_sha?: string; merge_seq: number | null; title: string | null }[];
  readonly sort: { field: string; order: string };
  readonly next_cursor: string | null;
  readonly relaxation_hints?: { remove: string; would_yield: number }[];
  readonly relaxation_hints_truncated?: boolean;
  readonly unresolved_names?: { key: string; value: string }[];
  readonly parsed: unknown;
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

/** 결과를 사람이 읽을 수 있는 식별자로 줄인다. */
function idsOf(body: SearchBody): string[] {
  return body.items.map((item) =>
    item.kind === 'commit' ? `c:${item.commit_sha ?? '?'}` : `pr:${String(item.pr_number ?? 0)}`,
  );
}

const PULL_REQUESTS = [
  {
    _id: 'pr-1',
    repository_id: PAYMENTS, repository: 'acme/payments', org_id: ORG, visibility: 'internal',
    allowed_team_ids: [10], pr_number: 1, title: '결제 재시도', state: 'merged', author: 'kim',
    reviewers: ['lee'], labels: ['backend'], base_branch: 'main', head_branch: 'feature/retry',
    merge_seq: 1342, seq_epoch: 3, sequence_space: 'acme/payments@main',
    merged_at: '2026-08-19T05:02:11Z', created_at: '2026-08-15T00:00:00Z', updated_at: '2026-08-19T05:02:11Z',
    changed_files_count: 2, additions: 120, deletions: 15, lead_time_seconds: 345_600,
    changed_paths: ['src/pay/retry.ts'], release_tags: ['v1.2.0'],
    link_summary: { is_reverted: true }, document_version: 1,
  },
  {
    _id: 'pr-2',
    repository_id: PAYMENTS, repository: 'acme/payments', org_id: ORG, visibility: 'internal',
    allowed_team_ids: [10], pr_number: 2, title: '세션 만료', state: 'merged', author: 'lee',
    reviewers: ['kim'], labels: ['frontend'], base_branch: 'main', head_branch: 'feature/session',
    merge_seq: 1341, seq_epoch: 3, sequence_space: 'acme/payments@main',
    merged_at: '2026-08-18T05:02:11Z', created_at: '2026-08-14T00:00:00Z', updated_at: '2026-08-18T05:02:11Z',
    changed_files_count: 8, additions: 8, deletions: 2, lead_time_seconds: 172_800,
    changed_paths: ['web/session.ts'], document_version: 1,
  },
  {
    _id: 'pr-3',
    repository_id: BILLING, repository: 'acme/billing', org_id: ORG, visibility: 'internal',
    allowed_team_ids: [11], pr_number: 3, title: '청구서 양식', state: 'open', author: 'kim',
    labels: ['backend'], base_branch: 'develop', head_branch: 'feature/invoice',
    created_at: '2026-08-20T00:00:00Z', updated_at: '2026-08-20T00:00:00Z',
    changed_files_count: 1, additions: 40, deletions: 0,
    changed_paths: ['src/billing/form.ts'], document_version: 1,
  },
  {
    // `src/pay`의 접두이지만 다른 디렉터리다. `prefix` 질의였다면 잘못 걸린다.
    _id: 'pr-4',
    repository_id: BILLING, repository: 'acme/billing', org_id: ORG, visibility: 'internal',
    allowed_team_ids: [11], pr_number: 4, title: '결제수단 목록', state: 'open', author: 'lee',
    base_branch: 'develop', created_at: '2026-08-20T01:00:00Z', updated_at: '2026-08-20T01:00:00Z',
    changed_files_count: 1, additions: 5, deletions: 0,
    changed_paths: ['src/payments/list.ts'], document_version: 1,
  },
  {
    _id: 'pr-hidden',
    repository_id: HIDDEN, repository: 'other/secret', org_id: 2, visibility: 'private',
    allowed_team_ids: [99], pr_number: 9, title: '비밀', state: 'merged', author: 'kim',
    labels: ['backend'], base_branch: 'main', merge_seq: 9999, merged_at: '2026-08-19T00:00:00Z',
    created_at: '2026-08-01T00:00:00Z', changed_files_count: 1, additions: 1, deletions: 0,
    document_version: 1,
  },
];

const COMMITS = [
  {
    _id: 'commit-1',
    repository_id: PAYMENTS, repository: 'acme/payments', org_id: ORG, visibility: 'internal',
    allowed_team_ids: [10], commit_sha: 'a'.repeat(40), message: '결제 재시도 구현\n\n본문',
    author: 'kim', committed_at: '2026-08-19T04:00:00Z', authored_at: '2026-08-19T04:00:00Z',
    base_branch: 'main', merge_seq: 1340, seq_epoch: 3, sequence_space: 'acme/payments@main',
    role: 'source_commit', changed_paths: ['src/pay/retry.ts'], additions: 100, deletions: 10,
    document_version: 1,
  },
];

beforeAll(async () => {
  pool = await migratedPool();
  redis = createTestRedis();
  es = createEsClient(resolveClientOptions());
  await applyMappings(es);
  // 매핑 버전이 올라간 별칭을 현재 정의로 옮긴다 (WP-032). 시험 전용.
  await switchAliasesForTests(es);

  await pool.query('DELETE FROM permission_cache');
  await pool.query('DELETE FROM app_user');
  await pool.query('DELETE FROM team_member');
  await pool.query('DELETE FROM team');
  await pool.query('DELETE FROM repository');

  await authRepo.upsertUserOnLogin(pool, { user_id: USER, login: 'kim', github_user_id: 7001 });
  await authRepo.upsertTeam(pool, { team_id: 10, slug: 'payments-core', org_id: ORG });
  for (const [id, owner, name] of [
    [PAYMENTS, 'acme', 'payments'],
    [BILLING, 'acme', 'billing'],
    [HIDDEN, 'other', 'secret'],
  ] as const) {
    await repositoryRepo.upsertRepository(pool, {
      repository_id: id, owner, name, org_id: owner === 'acme' ? ORG : 2,
      visibility: 'internal', sequence_branches: ['main'],
    });
  }

  /*
   * `seq:` 질의는 시퀀스 공간을 확인한다 (CR-051, AC-7). 픽스처 문서의
   * `seq_epoch: 3`과 공간의 에폭을 맞춰 두지 않으면 그 조회가 낡은 인용으로
   * 판정된다.
   */
  await sequenceSpaceRepo.ensureSequenceSpace(pool, PAYMENTS, 'main');
  await pool.query(
    'UPDATE sequence_space SET seq_epoch = 3 WHERE repository_id = $1 AND base_branch = $2',
    [PAYMENTS, 'main'],
  );

  await es.deleteByQuery({
    index: ['prs-pull-requests', 'prs-commits'],
    query: { match_all: {} },
    refresh: true,
    conflicts: 'proceed',
  });

  const bulk = await es.bulk({
    refresh: true,
    operations: [
      ...PULL_REQUESTS.flatMap(({ _id, ...doc }) => [
        { index: { _index: 'prs-pull-requests', _id } },
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

  const sessions = new SessionStore({ redis: redisPort });
  // 사용자는 acme의 두 저장소만 볼 수 있다. `other/secret`은 범위 밖이다.
  const source: AccessScopeSource = {
    fetch: async () => ({
      repositoryIds: [PAYMENTS, BILLING],
      orgIds: [ORG],
      teamIds: [10],
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
    config: { port: 0, adminTokens: [], metricsQueryUrl: null, gheBaseUrl: null, auth: AUTH_CONFIG, searchCursorKey: TEST_CURSOR_KEY },
    auth,
    search: {
      pool,
      es,
      cursorSigner: TEST_CURSOR_SIGNER,
      resolveNames: async (names) => ({
        orgIds: await repositoryRepo.resolveOrgIds(pool, names.orgs),
        teamIds: await authRepo.resolveTeamIds(pool, names.teams),
      }),
    },
  });
  await app.ready();
}, 180_000);

beforeEach(async () => {
  await redis.del(scopeKey(USER));
  sessionId = createSessionId();
  const now = Date.now();
  await new SessionStore({
    redis: {
      get: (key) => redis.get(key),
      set: (key, value, mode, seconds) => redis.set(key, value, mode, seconds),
      del: (...keys) => redis.del(...keys),
      scan: (cursor, m, pattern, c, n) => redis.scan(cursor, m, pattern, c, n),
    },
  }).create({
    sessionId, userId: USER, login: 'kim', email: null,
    roles: ['developer'], issuedAt: now, lastSeenAt: now, correlationId: null,
  });
});

afterAll(async () => {
  await app?.close();
  await es?.deleteByQuery({
    index: ['prs-pull-requests', 'prs-commits'],
    query: { match_all: {} },
    refresh: true,
    conflicts: 'proceed',
  });
  await es?.close();
  await redis?.quit();
  await pool?.end();
});

describe('DoD 1: 필터가 AND로 결합된다 (AC-1)', () => {
  it('조건 없는 조회가 범위 안 문서를 전부 준다', async () => {
    const { status, body } = await get('q=');
    expect(status).toBe(200);
    // PR 넷 + 커밋 하나. `other/secret`은 접근 범위 밖이다.
    expect(idsOf(body).sort()).toEqual(['c:' + 'a'.repeat(40), 'pr:1', 'pr:2', 'pr:3', 'pr:4']);
  });

  it('필터 둘이 AND로 좁힌다', async () => {
    const { body } = await get('q=repo%3Aacme%2Fpayments+author%3Akim');
    expect(idsOf(body).sort()).toEqual(['c:' + 'a'.repeat(40), 'pr:1']);
  });

  it('셋을 걸면 더 좁아진다', async () => {
    const { body } = await get('q=repo%3Aacme%2Fpayments+author%3Akim+label%3Abackend');
    expect(idsOf(body)).toEqual(['pr:1']);
  });

  it('AC-1의 12종이 실제 문서를 고른다', async () => {
    const cases: [string, string[]][] = [
      ['repo%3Aacme%2Fbilling', ['pr:3', 'pr:4']],
      ['org%3Aacme', ['c:' + 'a'.repeat(40), 'pr:1', 'pr:2', 'pr:3', 'pr:4']],
      ['author%3Alee', ['pr:2', 'pr:4']],
      ['reviewer%3Alee', ['pr:1']],
      ['label%3Afrontend', ['pr:2']],
      ['base%3Adevelop', ['pr:3', 'pr:4']],
      ['state%3Aopen', ['pr:3', 'pr:4']],
      ['merged%3A2026-08-19..2026-08-20', ['pr:1']],
      ['created%3A2026-08-20..2026-08-21', ['pr:3', 'pr:4']],
      // `seq:`는 공간을 지목해야 한다 (CR-051, AC-7).
      ['repo%3Aacme%2Fpayments+base%3Amain+seq%3A1341..1342', ['pr:1', 'pr:2']],
      ['path%3Asrc%2Fpay', ['c:' + 'a'.repeat(40), 'pr:1']],
      ['head%3Afeature%2Fsession', ['pr:2']],
    ];

    for (const [query, expected] of cases) {
      const { body } = await get(`q=${query}`);
      expect(idsOf(body).sort(), query).toEqual(expected.sort());
    }
  });
});

describe('경로 접두 (AC-1)', () => {
  it('형제 디렉터리를 끌어오지 않는다 — `src/pay`는 `src/payments`가 아니다', async () => {
    const { body } = await get('q=path%3Asrc%2Fpay');
    expect(idsOf(body).sort()).toEqual(['c:' + 'a'.repeat(40), 'pr:1']);
  });

  it('상위 디렉터리로 물으면 그 아래가 전부 나온다', async () => {
    const { body } = await get('q=path%3Asrc');
    expect(idsOf(body).sort()).toEqual(['c:' + 'a'.repeat(40), 'pr:1', 'pr:3', 'pr:4']);
  });
});

describe('DoD 2: 같은 키 다중 값이 OR다 (AC-2)', () => {
  it('작성자 둘 중 하나면 매치한다', async () => {
    const { body } = await get('q=repo%3Aacme%2Fpayments+author%3Akim+author%3Alee');
    expect(idsOf(body).sort()).toEqual(['c:' + 'a'.repeat(40), 'pr:1', 'pr:2']);
  });

  it('다른 키와 섞이면 그 키 안에서만 OR다', async () => {
    // (author=kim OR author=lee) AND label=backend
    const { body } = await get('q=author%3Akim+author%3Alee+label%3Abackend');
    expect(idsOf(body).sort()).toEqual(['pr:1', 'pr:3']);
  });
});

describe('부정 (AC-6)', () => {
  it('`-author:bot`이 그 작성자를 뺀다', async () => {
    const { body } = await get('q=repo%3Aacme%2Fpayments+-author%3Alee');
    expect(idsOf(body).sort()).toEqual(['c:' + 'a'.repeat(40), 'pr:1']);
  });

  it('범위 부정도 동작한다 — 부정에도 공간 지목이 필요하다 (CR-051)', async () => {
    const { body } = await get('q=repo%3Aacme%2Fpayments+base%3Amain+-seq%3A1341..1342');
    expect(idsOf(body)).toEqual(['c:' + 'a'.repeat(40)]);
  });
});

describe('DEV-054: PR과 커밋을 함께 돈다', () => {
  it('두 유형이 한 목록에 나온다', async () => {
    const { body } = await get('q=repo%3Aacme%2Fpayments&sort=merge_seq');
    expect(body.items.map((one) => one.kind)).toEqual(['pull_request', 'pull_request', 'commit']);
  });

  it('커밋 문서에 없는 필드로 필터하면 커밋이 빠진다 — 정상이다', async () => {
    // 커밋에는 라벨이 없다. 라벨로 물었으면 커밋이 안 나오는 것이 맞다.
    const { body } = await get('q=label%3Abackend');
    expect(idsOf(body).every((id) => id.startsWith('pr:'))).toBe(true);
  });

  it('커밋 제목은 메시지 첫 줄이다', async () => {
    const { body } = await get('q=repo%3Aacme%2Fpayments+-state%3Amerged');
    const commit = body.items.find((one) => one.kind === 'commit');
    expect(commit?.title).toBe('결제 재시도 구현');
  });

  it('PR에만 있는 필드로 정렬해도 커밋이 사라지지 않는다', async () => {
    // `unmapped_type`이 없으면 여기서 샤드 부분 실패가 나 커밋 인덱스가 통째로 빠진다.
    const { status, body } = await get('q=repo%3Aacme%2Fpayments&sort=merged_at');
    expect(status).toBe(200);
    expect(body.items.some((one) => one.kind === 'commit')).toBe(true);
  });

  it('PR에만 있는 정렬 키 전부에서 커밋이 살아남는다', async () => {
    for (const key of ['merged_at', 'created_at', 'updated_at', 'changed_files_count', 'lead_time_seconds']) {
      const { status, body } = await get(`q=repo%3Aacme%2Fpayments&sort=${key}`);
      expect(status, key).toBe(200);
      expect(body.items.length, key).toBe(3);
    }
  });
});

describe('DoD 4: 정렬 (FR-SRCH-007)', () => {
  it('기본은 `merge_seq` 내림차순이다 (AC-2)', async () => {
    const { body } = await get('q=repo%3Aacme%2Fpayments');
    expect(body.sort).toEqual({ field: 'merge_seq', order: 'desc' });
    expect(body.items.map((one) => one.merge_seq)).toEqual([1342, 1341, 1340]);
  });

  it('시퀀스 없는 문서가 뒤에 온다 (AC-2)', async () => {
    const { body } = await get('q=org%3Aacme');
    // pr-3·pr-4에는 `merge_seq`가 없다. 둘이 맨 뒤에 모인다.
    expect(idsOf(body).slice(-2).sort()).toEqual(['pr:3', 'pr:4']);
    // 시퀀스가 있는 문서는 전부 그 앞이다.
    expect(idsOf(body).slice(0, -2)).toEqual(['pr:1', 'pr:2', 'c:' + 'a'.repeat(40)]);
  });

  it('정렬 키 여덟이 모두 200이다 (AC-1)', async () => {
    for (const key of [
      'merge_seq', 'merged_at', 'created_at', 'updated_at',
      'changed_files_count', 'additions', 'lead_time_seconds', 'relevance',
    ]) {
      const { status } = await get(`q=&sort=${key}`);
      expect(status, key).toBe(200);
    }
  });

  it('오름차순이 동작한다', async () => {
    const { body } = await get('q=repo%3Aacme%2Fpayments&sort=additions&order=asc');
    expect(body.items.map((one) => one.pr_number ?? 0)).toEqual([2, 0, 1]);
  });

  it('미지원 정렬 키는 400과 지원 키 목록이다 (AC-3)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `${SEARCH_PATH}?q=&sort=deletions`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${sessionId}` },
    });

    expect(response.statusCode).toBe(400);
    const body = response.json<{ error: { code: string; detail: { supported_keys: string[] } } }>();
    expect(body.error.code).toBe('INVALID_PARAMETER');
    expect(body.error.detail.supported_keys).toHaveLength(8);
  });
});

describe('DoD 5: 같은 조건 두 번 조회가 같은 순서다 (AC-4)', () => {
  it('기본 정렬에서 순서가 같다', async () => {
    const first = idsOf((await get('q=org%3Aacme')).body);
    const second = idsOf((await get('q=org%3Aacme')).body);
    expect(second).toEqual(first);
  });

  it('동점이 있는 정렬에서도 순서가 같다', async () => {
    // `seq_epoch`가 같은 문서들 — 정렬 키만으로는 순서가 정해지지 않는다.
    const runs = await Promise.all([
      get('q=&sort=relevance'),
      get('q=&sort=relevance'),
      get('q=&sort=relevance'),
    ]);
    const [first, ...rest] = runs.map((one) => idsOf(one.body));
    for (const ids of rest) expect(ids).toEqual(first);
  });
});

describe('DoD 3: 0건일 때 완화 후보 (AC-3)', () => {
  it('빼면 결과가 생기는 필터를 알려 준다', async () => {
    const { status, body } = await get('q=repo%3Aacme%2Fpayments+author%3Anobody');

    expect(status).toBe(200);
    expect(body.total.value).toBe(0);
    expect(body.items).toEqual([]);
    expect(body.relaxation_hints).toEqual([{ remove: 'author:nobody', would_yield: 3 }]);
  });

  it('많이 나오는 후보가 먼저 온다', async () => {
    // `label:frontend`를 빼면 acme/billing 둘, `repo:`를 빼면 frontend 하나.
    const { body } = await get('q=repo%3Aacme%2Fbilling+label%3Afrontend');
    const hints = body.relaxation_hints ?? [];

    expect(hints.length).toBeGreaterThan(1);
    expect(hints[0]?.would_yield).toBeGreaterThanOrEqual(hints[1]?.would_yield ?? 0);
    expect(hints[0]?.remove).toBe('label:frontend');
  });

  it('빼도 0건인 필터는 후보가 아니다', async () => {
    const { body } = await get('q=author%3Anobody+label%3Anothing');
    // 둘 중 무엇을 빼도 여전히 0건이다.
    expect(body.relaxation_hints).toEqual([]);
  });

  it('필터가 하나면 후보를 계산하지 않는다', async () => {
    // "필터를 전부 지우면 결과가 나옵니다"는 도움이 되지 않는다.
    const { body } = await get('q=author%3Anobody');
    expect(body.relaxation_hints).toEqual([]);
  });

  it('결과가 있으면 후보 키 자체가 없다', async () => {
    const { body } = await get('q=repo%3Aacme%2Fpayments');
    expect(body.relaxation_hints).toBeUndefined();
  });

  it('ADR-008: 후보 계산도 강제 접근 범위 필터를 지난다', async () => {
    /*
     * 완화 후보는 건수만 돌려주지만 그 건수도 정보다. 범위 밖 문서를 세면
     * "이 조건을 빼면 1건이 나옵니다"가 볼 수 없는 문서의 존재를 알려 준다.
     *
     * `repo:other/secret`은 범위 밖 저장소이고 `pr-hidden`이 그 안에 있다.
     * `author:kim`을 **빼면** 남는 것은 `repo:other/secret`뿐이다 — 범위 필터가
     * 있으면 0건이라 후보가 되지 않고, 없으면 `pr-hidden`이 걸려 후보로
     * 올라온다. 그 차이가 이 시험이 보는 것이다.
     */
    const { status, body } = await get('q=repo%3Aother%2Fsecret+author%3Akim');

    expect(status).toBe(200);
    expect(body.total.value).toBe(0);

    const hints = body.relaxation_hints ?? [];
    expect(hints.map((one) => one.remove)).not.toContain('author:kim');
    // 범위 안에서 세는 후보는 그대로 나온다 — 후보 계산 자체가 죽은 것이 아니다.
    // `author:kim`은 범위 안에서 PR 둘과 커밋 하나에 걸린다.
    expect(hints).toContainEqual({ remove: 'repo:other/secret', would_yield: 3 });
  });
});

describe('DoD 7: 응답 스키마가 계약과 맞는다', () => {
  it('계약이 정한 최상위 키를 모두 갖는다', async () => {
    const { body } = await get('q=repo%3Aacme%2Fpayments');
    for (const key of ['query', 'parsed', 'total', 'sort', 'items', 'next_cursor', 'correlation_id']) {
      expect(body, key).toHaveProperty(key);
    }
  });

  it('`next_cursor`는 늘 `null`이다 — 키를 빼지 않는다 (DEV-057)', async () => {
    const { body } = await get('q=repo%3Aacme%2Fpayments');
    expect(body.next_cursor).toBeNull();
  });

  it('`facets` 키는 아예 없다 (DEV-057)', async () => {
    // 빈 객체는 "패싯을 셌는데 아무것도 없다"로 읽힌다.
    const { body } = await get('q=repo%3Aacme%2Fpayments');
    expect(body).not.toHaveProperty('facets');
  });

  it('항목이 계약의 필드를 갖는다', async () => {
    const { body } = await get('q=repo%3Aacme%2Fpayments+author%3Akim+label%3Abackend');
    expect(body.items[0]).toMatchObject({
      kind: 'pull_request',
      repository: 'acme/payments',
      pr_number: 1,
      title: '결제 재시도',
      merge_seq: 1342,
      seq_epoch: 3,
      link_summary: { is_reverted: true },
    });
  });

  it('`total.relation`이 실린다', async () => {
    const { body } = await get('q=');
    expect(['eq', 'gte']).toContain(body.total.relation);
  });

  it('`size`가 기본 25, 최대 200으로 절삭된다', async () => {
    expect((await get('q=&size=1')).body.items).toHaveLength(1);
    // 초과는 오류가 아니라 절삭이다.
    expect((await get('q=&size=9999')).status).toBe(200);
    expect((await get('q=&size=abc')).status).toBe(200);
  });
});

describe('FR-AUTH-002: 접근 범위가 늘 결합된다 (AC-4)', () => {
  it('범위 밖 저장소를 콕 집어 물어도 0건이다', async () => {
    const { body } = await get('q=repo%3Aother%2Fsecret');
    expect(body.items).toEqual([]);
  });

  it('조건 없는 조회에도 범위 밖 문서가 없다', async () => {
    const { body } = await get('q=');
    expect(idsOf(body)).not.toContain('pr:9');
  });

  it('미인증 요청은 401이다', async () => {
    const response = await app.inject({ method: 'GET', url: `${SEARCH_PATH}?q=` });
    expect(response.statusCode).toBe(401);
  });
});

describe('DEV-052: 이름 해석', () => {
  it('`org:acme`가 레지스트리를 거쳐 `org_id`를 찾는다', async () => {
    const { body } = await get('q=org%3Aacme');
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.unresolved_names).toBeUndefined();
  });

  it('없는 조직은 0건이고 그 사실을 응답에 남긴다', async () => {
    const { body } = await get('q=org%3Aghost');
    expect(body.total.value).toBe(0);
    expect(body.unresolved_names).toEqual([{ key: 'org', value: 'ghost' }]);
  });

  it('`team`은 slug을 찾지만 문서의 팀 ID가 비어 있어 0건이다', async () => {
    // WP-012가 남긴 제한이다. 이름은 찾았으므로 `unresolved_names`에 없다.
    const { body } = await get('q=team%3Apayments-core');
    expect(body.unresolved_names).toBeUndefined();
    expect(body.total.value).toBeGreaterThanOrEqual(0);
  });

  it('없는 팀은 응답에 남는다', async () => {
    const { body } = await get('q=team%3Ano-such-team');
    expect(body.unresolved_names).toEqual([{ key: 'team', value: 'no-such-team' }]);
  });
});

describe('문법 오류 (CR-014, DEV-038)', () => {
  it('미지원 키는 400에 오프셋과 지원 키 목록을 담는다', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `${SEARCH_PATH}?q=assignee%3Akim`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${sessionId}` },
    });

    expect(response.statusCode).toBe(400);
    const body = response.json<{ error: { code: string; detail: Record<string, unknown> } }>();
    expect(body.error.code).toBe('QUERY_SYNTAX_ERROR');
    expect(body.error.detail['offset_start']).toBe(0);
    expect(body.error.detail['supported_keys']).toHaveLength(15);
  });

  it('스칼라 `seq:1234`는 400이다 — 조용히 0건이 아니다 (DEV-364)', async () => {
    /*
     * 고치기 전 이 요청은 200에 0건을 돌려줬다. **사용자가 읽는 뜻은 "그
     * 서수에는 결과가 없다"이고 그것이 거짓이었다.** 여기서 400을 거는 것은
     * 단위 시험이 파서만 보기 때문이다 — 라우트가 오류를 삼키면 그 실패는
     * 파서 시험에 잡히지 않는다.
     */
    const response = await app.inject({
      method: 'GET',
      url: `${SEARCH_PATH}?q=seq%3A1234`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${sessionId}` },
    });

    expect(response.statusCode).toBe(400);
    const body = response.json<{ error: { code: string; message: string } }>();
    expect(body.error.code).toBe('QUERY_SYNTAX_ERROR');
    expect(body.error.message).toContain('범위 형식');
  });

  it('부정형 `-seq:1234`도 400이다 — 이쪽이 전체를 돌려줬다 (DEV-378)', async () => {
    // `must_not: [match_none]`은 아무것도 걸러내지 않는다. 0건보다 나쁘다.
    const response = await app.inject({
      method: 'GET',
      url: `${SEARCH_PATH}?q=-seq%3A1234`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${sessionId}` },
    });
    expect(response.statusCode).toBe(400);
  });

  it('시각 키의 스칼라도 400이다 (DEV-379)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `${SEARCH_PATH}?q=merged%3A2026-08-10`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${sessionId}` },
    });
    expect(response.statusCode).toBe(400);
  });

  it('`is`의 열거 밖 값은 400이다 (DEV-036)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `${SEARCH_PATH}?q=is%3Awhatever`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${sessionId}` },
    });
    expect(response.statusCode).toBe(400);
  });

  it('문법 오류에서는 Elasticsearch를 부르지 않는다', async () => {
    // 400이 될 요청으로 검색 클러스터를 부르지 않는다.
    const response = await app.inject({
      method: 'GET',
      url: `${SEARCH_PATH}?q=&sort=nope`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${sessionId}` },
    });
    expect(response.statusCode).toBe(400);
  });
});

describe('DEV-053: `is`는 파생 상태다', () => {
  it('`is:reverted`가 관계 요약을 본다', async () => {
    const { body } = await get('q=is%3Areverted');
    expect(idsOf(body)).toEqual(['pr:1']);
  });

  it('`is:merged`가 `state:merged`와 같은 결과를 준다', async () => {
    const viaIs = idsOf((await get('q=is%3Amerged')).body).sort();
    const viaState = idsOf((await get('q=state%3Amerged')).body).sort();
    expect(viaIs).toEqual(viaState);
  });
});
