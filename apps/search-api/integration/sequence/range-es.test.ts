/**
 * `GET /sequence-ranges` — 실제 PostgreSQL + **실제 Elasticsearch** (WP-023 / API-SEQ-001).
 *
 * `range.test.ts`는 대역 색인으로 **서비스의 판정**(정본 우선, 부재 드러내기,
 * `q` 의미)을 건다. 여기서 거는 것은 하나뿐이다 — **그 질의가 진짜 색인에서
 * 진짜로 맞는 문서를 고르는가.**
 *
 * 모양이 맞아도 필드 이름이 하나 어긋나면 아무것도 거르지 못하고, 그것을 잡는
 * 것은 실제 조회뿐이다. 특히 셋:
 *
 * 1. `terms(pr_number)`가 구간의 PR만 고르는가 — 구간 밖 PR이 요약에 섞이면
 *    변경량 합계가 조용히 커진다.
 * 2. `changed_paths.raw` 집계가 도는가 — 분석된 `text` 필드로 집계하면
 *    Elasticsearch가 거부하고, 그것은 대역으로는 절대 드러나지 않는다.
 * 3. 접근 범위 필터가 진짜로 막는가 (ADR-008).
 *
 * 실행: `pnpm test:integration sequence/range-es` (실제 Elasticsearch 필요)
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
import { applyMappings, createEsClient, resolveClientOptions } from '@prs/es';
import { authRepo, mergeSequenceRepo, repositoryRepo, sequenceSpaceRepo, type Pool } from '@prs/db';
import type { Redis } from '@prs/bus';
import { buildServer } from '../../src/server.js';
import { SEQUENCE_RANGE_PATH } from '../../src/sequence/routes.js';
import type { AuthContext, AuthRedis } from '../../src/auth/context.js';
import { createTestRedis, migratedPool } from '../helpers.js';

const AUTH_CONFIG = {
  enabled: true,
  cookieSecure: true,
  loginPath: '/auth/login',
  groupRoleMap: new Map<string, never>(),
} as const;

const USER = 'sub-range-es';
const PAYMENTS = 4101;
const HIDDEN = 4900;
const ORG = 1;
const BRANCH = 'main';

function shaOf(seq: number): string {
  return `${String(seq).padStart(2, '0')}${'e'.repeat(38)}`;
}

/**
 * 서수 1~4가 PR 201~204다.
 *
 * **PR 205는 구간 밖**이고 변경량이 일부러 크다 — `terms(pr_number)`가 새면
 * 합계가 눈에 띄게 틀어진다. 색인에만 있고 `merge_sequence`에는 없다.
 */
const PULL_REQUESTS = [
  {
    _id: 'r-201', repository_id: PAYMENTS, repository: 'acme/payments', org_id: ORG,
    visibility: 'internal', allowed_team_ids: [10], pr_number: 201, title: '결제 재시도',
    author: 'kim', base_branch: BRANCH, merged_at: '2026-08-11T00:00:00Z',
    changed_files_count: 2, additions: 10, deletions: 1,
    changed_paths: ['src/pay/retry.ts', 'src/pay/util.ts'], files_truncated: false,
    document_version: 1,
  },
  {
    _id: 'r-202', repository_id: PAYMENTS, repository: 'acme/payments', org_id: ORG,
    visibility: 'internal', allowed_team_ids: [10], pr_number: 202, title: '세션 만료',
    author: 'lee', base_branch: BRANCH, merged_at: '2026-08-12T00:00:00Z',
    changed_files_count: 1, additions: 20, deletions: 2,
    changed_paths: ['src/pay/retry.ts'], files_truncated: true,
    // 되돌려진 PR (CR-041, DEV-239). 구간 안에서 유일하다.
    link_summary: { is_reverted: true, has_revert: false, has_cherry_pick: false, has_stack: false },
    document_version: 1,
  },
  {
    _id: 'r-203', repository_id: PAYMENTS, repository: 'acme/payments', org_id: ORG,
    visibility: 'internal', allowed_team_ids: [10], pr_number: 203, title: '로그 정리',
    author: 'kim', base_branch: BRANCH, merged_at: '2026-08-13T00:00:00Z',
    changed_files_count: 1, additions: 30, deletions: 3,
    changed_paths: ['src/log/index.ts'], files_truncated: false,
    document_version: 1,
  },
  {
    // 색인에 없다. 정본에만 있는 항목을 만드는 자리다 (DEV-130).
    _id: null, pr_number: 204,
  },
  {
    _id: 'r-205', repository_id: PAYMENTS, repository: 'acme/payments', org_id: ORG,
    visibility: 'internal', allowed_team_ids: [10], pr_number: 205, title: '구간 밖',
    author: 'park', base_branch: BRANCH, merged_at: '2026-08-20T00:00:00Z',
    changed_files_count: 99, additions: 9_000, deletions: 900,
    changed_paths: ['src/other/huge.ts'], files_truncated: false,
    // **구간 밖인데 되돌려져 있다.** `terms(pr_number)`가 새면 되돌림 수가 2가 된다.
    link_summary: { is_reverted: true, has_revert: false, has_cherry_pick: false, has_stack: false },
    document_version: 1,
  },
  {
    _id: 'r-hidden', repository_id: HIDDEN, repository: 'other/secret', org_id: 2,
    visibility: 'private', allowed_team_ids: [99], pr_number: 201, title: '비밀',
    author: 'spy', base_branch: BRANCH, merged_at: '2026-08-11T00:00:00Z',
    changed_files_count: 50, additions: 5_000, deletions: 500,
    changed_paths: ['secret/leak.ts'], files_truncated: false,
    document_version: 1,
  },
] as const;

let pool: Pool;
let redis: Redis;
let es: Client;
let app: FastifyInstance;
let sessionId: string;

interface RangeBody {
  readonly summary?: {
    pull_request_count: number;
    commit_count: number;
    distinct_author_count: number;
    changed_files_total: number;
    additions_total: number;
    deletions_total: number;
    files_truncated_pull_request_count: number;
    reverted_pull_request_count: number;
    top_changed_paths: { path: string; count: number }[];
  };
  readonly items?: { merge_seq: number; pr_number?: number; title: string | null; indexed: boolean }[];
  readonly items_missing_in_index?: number;
  readonly error?: { code: string; message: string };
  readonly correlation_id: string;
}

async function get(query: string, repository = 'acme%2Fpayments'): Promise<{ status: number; body: RangeBody }> {
  const response = await app.inject({
    method: 'GET',
    url: `${SEQUENCE_RANGE_PATH}?repository=${repository}&base_branch=${BRANCH}&${query}`,
    headers: { cookie: `${SESSION_COOKIE_NAME}=${sessionId}` },
  });
  return { status: response.statusCode, body: response.json<RangeBody>() };
}

beforeAll(async () => {
  pool = await migratedPool();
  redis = createTestRedis();
  es = createEsClient(resolveClientOptions());
  await applyMappings(es);

  await pool.query('DELETE FROM merge_sequence');
  await pool.query('DELETE FROM sequence_space');
  await pool.query('DELETE FROM permission_cache');
  await pool.query('DELETE FROM app_user');
  await pool.query('DELETE FROM repository');

  await authRepo.upsertUserOnLogin(pool, { user_id: USER, login: 'kim', github_user_id: 7301 });
  for (const [id, owner, name, org] of [
    [PAYMENTS, 'acme', 'payments', ORG],
    [HIDDEN, 'other', 'secret', 2],
  ] as const) {
    await repositoryRepo.upsertRepository(pool, {
      repository_id: id, owner, name, org_id: org, visibility: 'internal', sequence_branches: [BRANCH],
    });
  }

  await sequenceSpaceRepo.ensureSequenceSpace(pool, PAYMENTS, BRANCH);
  // 서수 1~4에 PR 201~204. 205는 넣지 않는다 — 구간 밖 PR을 만드는 것이 목적이다.
  for (const seq of [1, 2, 3, 4]) {
    await mergeSequenceRepo.upsertMergeSequence(pool, {
      repository_id: PAYMENTS,
      base_branch: BRANCH,
      seq_epoch: 1,
      merge_seq: seq,
      commit_sha: shaOf(seq),
      pull_request_number: 200 + seq,
      committed_at: new Date(`2026-08-${String(10 + seq)}T00:00:00Z`),
    });
  }
  await sequenceSpaceRepo.advanceHead(pool, PAYMENTS, BRANCH, shaOf(4), 4);

  await es.deleteByQuery({
    index: ['prs-pull-requests'],
    query: { match_all: {} },
    refresh: true,
    conflicts: 'proceed',
  });
  const indexed = PULL_REQUESTS.filter(
    (doc): doc is Extract<(typeof PULL_REQUESTS)[number], { repository_id: number }> => doc._id !== null,
  );
  /*
   * **`routing` 없이 색인하면 이 파일의 시험 전부가 0건을 본다.**
   *
   * 운영 색인은 모든 문서를 `repository_id`로 라우팅하고(ADR-003, `upsert.ts`),
   * 범위 조회는 같은 값으로 라우팅해 단일 샤드만 읽는다. 픽스처가 라우팅 없이
   * 색인하면 문서는 `_id` 해시 샤드에 흩어지고 라우팅된 읽기는 빈 샤드 하나만
   * 본다 — 실제로 1차 CI에서 그렇게 9건이 0건으로 실패했다. 픽스처는 운영이
   * 쓰는 것과 같은 방식으로 넣어야 시험이 운영을 말한다.
   */
  const bulk = await es.bulk({
    refresh: true,
    operations: indexed.flatMap(({ _id, ...doc }) => [
      { index: { _index: 'prs-pull-requests', _id: _id as string, routing: String(doc.repository_id) } },
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
  const source: AccessScopeSource = {
    fetch: async () => ({
      repositoryIds: [PAYMENTS],
      orgIds: [ORG],
      teamIds: [10],
      visibilities: ['public', 'internal'],
    }),
  };
  const auth: AuthContext = {
    sessions: new SessionStore({ redis: redisPort }),
    scopes: new AccessScopeResolver({ redis: redisPort, db: createScopeDatabase(pool), source }),
    forget: async (ids) => {
      if (ids.length > 0) await redis.del(...ids.map(scopeKey));
    },
  };

  app = buildServer({
    config: { port: 0, adminTokens: [], metricsQueryUrl: null, gheBaseUrl: null, auth: AUTH_CONFIG },
    auth,
    search: {
      es,
      resolveNames: async (names) => ({
        orgIds: await repositoryRepo.resolveOrgIds(pool, names.orgs),
        teamIds: await authRepo.resolveTeamIds(pool, names.teams),
      }),
    },
    sequence: {
      pool,
      es,
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
    index: ['prs-pull-requests'],
    query: { match_all: {} },
    refresh: true,
    conflicts: 'proceed',
  });
  await es?.close();
  await redis?.quit();
  await pool?.end();
});

describe('질의가 실제로 고르는 문서 (CR-027, DEV-130)', () => {
  it('**구간 밖 PR이 요약에 섞이지 않는다**', async () => {
    /*
     * PR 205는 색인에 있고 같은 저장소·브랜치지만 `merge_sequence`에 없다.
     * `range(merge_seq)`로 걸렀다면 서수가 없어 빠졌겠지만, 우리는 정본이 준
     * 번호 목록으로 거른다 — 그 목록에 205가 없으므로 빠져야 한다.
     * 새면 additions가 9,000만큼 튄다.
     */
    const { status, body } = await get('from_seq=0&to_seq=4');
    expect(status).toBe(200);
    expect(body.summary?.additions_total).toBe(60);
    expect(body.summary?.changed_files_total).toBe(4);
    expect(body.summary?.deletions_total).toBe(6);
  });

  it('부분 구간이 그 구간의 PR만 집계한다', async () => {
    // `(1, 3]` = 서수 2·3 = PR 202·203.
    const { body } = await get('from_seq=1&to_seq=3');
    expect(body.summary?.additions_total).toBe(50);
    expect(body.summary?.pull_request_count).toBe(2);
  });

  it('**`changed_paths.raw` 집계가 실제로 돈다** — 분석된 필드로 집계하면 거부된다', async () => {
    const { body } = await get('from_seq=0&to_seq=4');
    const paths = body.summary?.top_changed_paths ?? [];
    expect(paths.length).toBeGreaterThan(0);
    // 두 PR이 함께 건드린 경로가 맨 앞이어야 한다.
    expect(paths[0]).toEqual({ path: 'src/pay/retry.ts', count: 2 });
    // 파일 경로다 — 디렉터리가 아니다 (DEV-134).
    expect(paths.map((one) => one.path)).toContain('src/pay/util.ts');
  });

  it('고유 작성자 수가 실제 `cardinality` 집계에서 온다', async () => {
    const { body } = await get('from_seq=0&to_seq=4');
    // kim(201·203), lee(202). 204는 색인에 없고 205는 구간 밖이다.
    expect(body.summary?.distinct_author_count).toBe(2);
  });

  it('절삭된 PR 수가 실제 `filter` 집계에서 온다 (DEV-135)', async () => {
    const { body } = await get('from_seq=0&to_seq=4');
    expect(body.summary?.files_truncated_pull_request_count).toBe(1);
  });

  it('**되돌려진 PR 수가 같은 왕복의 `filter` 집계에서 온다** (CR-041, DEV-239)', async () => {
    /*
     * CR-027(DEV-133)이 뺐던 키다 — 되돌림 파생 전에는 세면 언제나 0이고 그 0이
     * "되돌림이 없다"와 구분되지 않았다. WP-030이 `is_reverted`를 실제로 쓰면서
     * 그 조건이 해소됐다.
     *
     * **구간 밖 PR 205도 되돌려져 있다.** `terms(pr_number)` 경계가 새면 2가 나온다.
     */
    const { body } = await get('from_seq=0&to_seq=4');
    expect(body.summary?.reverted_pull_request_count).toBe(1);
  });

  it('되돌림이 없는 구간은 **0이고 그 0은 사실 주장이다**', async () => {
    const { body } = await get('from_seq=2&to_seq=3');
    expect(body.summary?.reverted_pull_request_count).toBe(0);
  });
});

describe('색인에 없는 항목 (DEV-130)', () => {
  it('**정본에만 있는 PR 204가 목록에 남고 `indexed: false`다**', async () => {
    const { body } = await get('from_seq=0&to_seq=4');
    expect(body.items?.map((one) => one.merge_seq)).toEqual([1, 2, 3, 4]);
    const missing = body.items?.find((one) => one.pr_number === 204);
    expect(missing?.indexed).toBe(false);
    expect(missing?.title).toBeNull();
  });

  it('빠진 수를 응답이 말한다', async () => {
    const { body } = await get('from_seq=0&to_seq=4');
    expect(body.items_missing_in_index).toBe(1);
  });

  it('**커밋 수는 색인이 아니라 정본이 정한다**', async () => {
    const { body } = await get('from_seq=0&to_seq=4');
    expect(body.summary?.commit_count).toBe(4);
    expect(body.summary?.pull_request_count).toBe(4);
  });
});

describe('`q` 필터가 진짜 색인에서 도는가 (DEV-136)', () => {
  it('`author:kim`이 목록과 요약을 함께 좁힌다', async () => {
    const { status, body } = await get('from_seq=0&to_seq=4&q=author:kim');
    expect(status).toBe(200);
    expect(body.items?.map((one) => one.pr_number)).toEqual([201, 203]);
    expect(body.summary?.pull_request_count).toBe(2);
    expect(body.summary?.additions_total).toBe(40);
  });

  it('`path:` 필터가 경로 계층 분석기로 걸린다', async () => {
    const { body } = await get('from_seq=0&to_seq=4&q=path:src/pay');
    expect(body.items?.map((one) => one.pr_number)).toEqual([201, 202]);
  });

  it('**`q`가 있어도 색인 부재 수는 같다** — 두 가지를 한 숫자에 섞지 않는다', async () => {
    const filtered = await get('from_seq=0&to_seq=4&q=author:kim');
    const all = await get('from_seq=0&to_seq=4');
    expect(filtered.body.items_missing_in_index).toBe(all.body.items_missing_in_index);
  });
});

describe('접근 범위 필터 (ADR-008)', () => {
  it('**범위 밖 저장소의 문서가 요약에 섞이지 않는다**', async () => {
    /*
     * `other/secret`에도 `pr_number: 201`인 문서가 있다. `terms(pr_number)`만으로
     * 걸렀다면 그 문서가 섞여 additions가 5,000만큼 튄다. `term(repository_id)`와
     * 강제 필터 둘 다가 이것을 막는다.
     */
    const { body } = await get('from_seq=0&to_seq=1');
    expect(body.summary?.additions_total).toBe(10);
    expect(body.items?.[0]?.title).toBe('결제 재시도');
  });

  it('범위 밖 저장소를 직접 물으면 404다', async () => {
    const { status } = await get('from_seq=0&to_seq=4', 'other%2Fsecret');
    expect(status).toBe(404);
  });
});
