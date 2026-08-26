/**
 * `GET /sequence-ranges` — 실제 PostgreSQL + 대역 Elasticsearch (WP-023 / API-SEQ-001, FR-SEQ-002).
 *
 * ## 두 파일로 나눈 이유
 *
 * 이 WP의 핵심 주장은 **"구간의 정답지는 PostgreSQL이고 색인은 채우기만 한다"**
 * 이다 (CR-027, DEV-130). 그 주장이 지켜지는지 보려면 **색인이 답을 덜 주는
 * 상황**을 만들어야 하는데, 진짜 Elasticsearch로는 그 상황을 만들기가 까다롭다 —
 * 문서를 지우면 그것이 정말 "반영이 늦은 것"인지 "원래 없는 것"인지 구분되지
 * 않는다.
 *
 * 그래서 여기서는 **PostgreSQL은 진짜, Elasticsearch는 대역**을 쓴다. 대역이
 * 무엇을 돌려줄지 시험이 정하므로 "정본에는 있는데 색인에 없는" 상황을 정확히
 * 만들 수 있고, SQL(반개구간 경계·오름차순·정확 건수)은 진짜로 검증된다.
 *
 * 질의가 **실제로 맞는 문서를 고르는지**는 `range-es.test.ts`가 진짜 색인으로
 * 확인한다. 대역은 질의를 그대로 받아 두므로 이 파일도 질의 모양은 단언한다.
 *
 * 실행: `pnpm test:integration sequence/range`
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
import { authRepo, mergeSequenceRepo, repositoryRepo, sequenceSpaceRepo, type Pool } from '@prs/db';
import type { Redis } from '@prs/bus';
import { buildServer } from '../../src/server.js';
import { SEQUENCE_RANGE_PATH } from '../../src/sequence/routes.js';
import { RANGE_LIMIT } from '../../src/sequence/range.js';
import type { AuthContext, AuthRedis } from '../../src/auth/context.js';
import { createTestRedis, migratedPool } from '../helpers.js';

const AUTH_CONFIG = {
  enabled: true,
  cookieSecure: true,
  loginPath: '/auth/login',
  groupRoleMap: new Map<string, never>(),
} as const;

const USER = 'sub-range';
const PAYMENTS = 3101;
const ORG = 1;
const BRANCH = 'main';

/** 서수 1~6. 3번은 PR 없는 직접 푸시 커밋이다 — 요약의 PR 수와 커밋 수를 가른다. */
const COMMITS = [
  { seq: 1, pr: 101 },
  { seq: 2, pr: 102 },
  { seq: 3, pr: null },
  { seq: 4, pr: 104 },
  { seq: 5, pr: 105 },
  { seq: 6, pr: 106 },
] as const;

function shaOf(seq: number): string {
  return `${String(seq).padStart(2, '0')}${'c'.repeat(38)}`;
}

let pool: Pool;
let redis: Redis;
let app: FastifyInstance;
let sessionId: string;

/** 대역이 "색인에 있다"고 답할 PR 번호. 시험마다 바꾼다. */
let indexedPrNumbers: Set<number>;
/** 대역이 받은 질의. 모양 단언에 쓴다. */
let lastSearches: unknown[];

interface RangeBody {
  readonly sequence_space?: string;
  readonly seq_epoch?: number;
  readonly sequence_state?: string;
  readonly epoch_stale?: boolean;
  readonly requested_seq_epoch?: number;
  readonly range?: { from_seq: number; to_seq: number; boundary: string };
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
  readonly items?: {
    merge_seq: number;
    kind: string;
    pr_number?: number;
    commit_sha: string;
    title: string | null;
    indexed: boolean;
    url: string | null;
  }[];
  readonly items_missing_in_index?: number;
  readonly next_cursor?: string | null;
  readonly error?: { code: string; message: string; detail?: Record<string, unknown> };
  readonly correlation_id: string;
}

async function get(query: string): Promise<{ status: number; body: RangeBody }> {
  const response = await app.inject({
    method: 'GET',
    url: `${SEQUENCE_RANGE_PATH}?repository=acme%2Fpayments&base_branch=${BRANCH}&${query}`,
    headers: { cookie: `${SESSION_COOKIE_NAME}=${sessionId}` },
  });
  return { status: response.statusCode, body: response.json<RangeBody>() };
}

/**
 * 대역 Elasticsearch.
 *
 * `terms(pr_number)`에 실린 번호 중 `indexedPrNumbers`에 든 것만 "찾았다"고
 * 답한다 — 그것이 곧 "색인 반영이 덜 된 상태"의 모형이다.
 */
function stubEsClient(): Client {
  const numbersOf = (query: unknown): number[] => {
    const json = JSON.stringify(query);
    const match = /"pr_number":\[([^\]]*)\]/.exec(json);
    if (match === null || match[1] === undefined || match[1] === '') return [];
    return match[1].split(',').map(Number);
  };

  /**
   * `q`가 실린 질의는 실제로 좁아져야 한다.
   *
   * **대역이 `q`를 무시하면 시험이 그것을 못 본다.** 거르지 않은 건수와 거른
   * 건수가 늘 같아지므로, `items_missing_in_index`를 거른 쪽에서 계산하는 결함이
   * 조용히 통과한다 — 실제로 변이 시험에서 그렇게 살아남았다. 그래서 픽스처의
   * 작성자 규칙(짝수 = lee, 홀수 = kim)을 대역도 안다.
   */
  const authorOf = (n: number): string => (n % 2 === 0 ? 'lee' : 'kim');
  const authorFilterOf = (query: unknown): string[] | null => {
    const match = /"author":\[([^\]]*)\]/.exec(JSON.stringify(query));
    if (match === null || match[1] === undefined || match[1] === '') return null;
    return match[1].split(',').map((one) => one.replace(/"/g, ''));
  };

  return {
    msearch: ({ searches }: { searches: unknown[] }) => {
      lastSearches = searches;
      const responses: unknown[] = [];
      // 짝수 인덱스는 헤더(`{index}`), 홀수 인덱스가 본문이다.
      for (let i = 1; i < searches.length; i += 2) {
        const body = searches[i] as { size?: number; aggs?: unknown };
        const authors = authorFilterOf(body);
        const found = numbersOf(body)
          .filter((n) => indexedPrNumbers.has(n))
          .filter((n) => authors === null || authors.includes(authorOf(n)));
        responses.push({
          hits: {
            total: { value: found.length, relation: 'eq' },
            hits:
              (body.size ?? 0) === 0
                ? []
                : found.map((n) => ({
                    _index: 'prs-pull-requests-v1',
                    _id: `p-${String(n)}`,
                    _source: {
                      pr_number: n,
                      title: `PR ${String(n)}`,
                      author: authorOf(n),
                      merged_at: '2026-08-12T00:00:00Z',
                      changed_files_count: 2,
                      additions: 10,
                      deletions: 3,
                    },
                  })),
          },
          ...(body.aggs === undefined
            ? {}
            : {
                aggregations: {
                  distinct_authors: { value: new Set(found.map(authorOf)).size },
                  changed_files: { value: found.length * 2 },
                  additions: { value: found.length * 10 },
                  deletions: { value: found.length * 3 },
                  files_truncated: { doc_count: 1 },
                  top_paths: { buckets: [{ key: 'src/pay/retry.ts', doc_count: found.length }] },
                },
              }),
        });
      }
      return Promise.resolve({ responses });
    },
    search: () => {
      throw new Error('범위 조회는 msearch 한 번으로 끝나야 한다');
    },
  } as unknown as Client;
}

beforeAll(async () => {
  pool = await migratedPool();
  redis = createTestRedis();

  await pool.query('DELETE FROM merge_sequence');
  await pool.query('DELETE FROM sequence_space');
  await pool.query('DELETE FROM permission_cache');
  await pool.query('DELETE FROM app_user');
  await pool.query('DELETE FROM repository');

  await authRepo.upsertUserOnLogin(pool, { user_id: USER, login: 'kim', github_user_id: 7201 });
  await repositoryRepo.upsertRepository(pool, {
    repository_id: PAYMENTS,
    owner: 'acme',
    name: 'payments',
    org_id: ORG,
    visibility: 'internal',
    sequence_branches: [BRANCH],
  });

  await sequenceSpaceRepo.ensureSequenceSpace(pool, PAYMENTS, BRANCH);
  for (const commit of COMMITS) {
    await mergeSequenceRepo.upsertMergeSequence(pool, {
      repository_id: PAYMENTS,
      base_branch: BRANCH,
      seq_epoch: 1,
      merge_seq: commit.seq,
      commit_sha: shaOf(commit.seq),
      pull_request_number: commit.pr,
      committed_at: new Date(`2026-08-${String(9 + commit.seq).padStart(2, '0')}T00:00:00Z`),
    });
  }
  await sequenceSpaceRepo.advanceHead(pool, PAYMENTS, BRANCH, shaOf(6), 6);

  const redisPort: AuthRedis = {
    get: (key) => redis.get(key),
    set: (key, value, mode, seconds) => redis.set(key, value, mode, seconds),
    del: (...keys) => redis.del(...keys),
    scan: (cursor, m, pattern, c, n) => redis.scan(cursor, m, pattern, c, n),
  };
  const source: AccessScopeSource = {
    fetch: async () => ({
      repositoryIds: [PAYMENTS, 3199],
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

  const es = stubEsClient();
  app = buildServer({
    config: { port: 0, adminTokens: [], metricsQueryUrl: null, gheBaseUrl: null, auth: AUTH_CONFIG },
    auth,
    search: { es, resolveNames: async () => ({ orgIds: new Map(), teamIds: new Map() }) },
    sequence: { pool, es, resolveNames: async () => ({ orgIds: new Map(), teamIds: new Map() }) },
  });
  await app.ready();
}, 180_000);

beforeEach(async () => {
  indexedPrNumbers = new Set(COMMITS.flatMap((c) => (c.pr === null ? [] : [c.pr as number])));
  lastSearches = [];
  await redis.del(scopeKey(USER));
  await pool.query('UPDATE sequence_space SET state = $1, seq_epoch = 1 WHERE repository_id = $2', [
    'ok',
    PAYMENTS,
  ]);
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
    sessionId,
    userId: USER,
    login: 'kim',
    email: null,
    roles: ['developer'],
    issuedAt: now,
    lastSeenAt: now,
    correlationId: null,
  });
});

afterAll(async () => {
  await app?.close();
  await redis?.quit();
  await pool?.end();
});

describe('반개구간 (FR-SEQ-002 AC-1, QA-W004-02·11)', () => {
  it('**시작 앵커는 빠지고 끝 앵커는 든다**', async () => {
    const { status, body } = await get('from_seq=2&to_seq=5');
    expect(status).toBe(200);
    expect(body.items?.map((one) => one.merge_seq)).toEqual([3, 4, 5]);
  });

  it('결과가 시퀀스 오름차순이다 (QA-W004-11)', async () => {
    const { body } = await get('from_seq=0&to_seq=6');
    const seqs = body.items?.map((one) => one.merge_seq) ?? [];
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(seqs).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('`from_seq=0`은 구간 맨 앞이다 — 첫 커밋부터 든다', async () => {
    const { body } = await get('from_seq=0&to_seq=1');
    expect(body.items?.map((one) => one.merge_seq)).toEqual([1]);
  });

  it('빈 구간은 200에 빈 목록이다 — 없는 것과 못 찾은 것은 다르다', async () => {
    const { status, body } = await get('from_seq=6&to_seq=6');
    expect(status).toBe(200);
    expect(body.items).toEqual([]);
    expect(body.range).toEqual({ from_seq: 6, to_seq: 6, boundary: '(from, to]' });
  });

  it('`size`가 목록만 자르고 요약은 구간 전체를 말한다', async () => {
    const { body } = await get('from_seq=0&to_seq=6&size=2');
    expect(body.items).toHaveLength(2);
    expect(body.summary?.commit_count).toBe(6);
    expect(body.summary?.pull_request_count).toBe(5);
  });
});

describe('요약 (FR-SEQ-002 AC-2, QA-W004-10)', () => {
  it('**커밋 수는 first-parent 커밋 수다** (DEV-139)', async () => {
    // 서수 1~6 중 PR이 붙은 것은 다섯이고, 서수 3은 직접 푸시다.
    const { body } = await get('from_seq=0&to_seq=6');
    expect(body.summary?.commit_count).toBe(6);
    expect(body.summary?.pull_request_count).toBe(5);
  });

  it('작성자 수·변경량·경로 상위가 색인 집계에서 온다', async () => {
    const { body } = await get('from_seq=0&to_seq=6');
    expect(body.summary?.distinct_author_count).toBe(2);
    expect(body.summary?.changed_files_total).toBe(10);
    expect(body.summary?.additions_total).toBe(50);
    expect(body.summary?.deletions_total).toBe(15);
    expect(body.summary?.top_changed_paths?.[0]?.path).toBe('src/pay/retry.ts');
  });

  it('**절삭된 PR 수를 함께 낸다** — 합계가 하한임을 말할 자리다 (DEV-135)', async () => {
    const { body } = await get('from_seq=0&to_seq=6');
    expect(body.summary?.files_truncated_pull_request_count).toBe(1);
  });

  it('**`reverted_pull_request_count`를 낸다** (CR-041 / DEV-239 — DEV-133 이월 종결)', async () => {
    /*
     * **이 시험은 반대를 단언하고 있었다.** CR-027(DEV-133)이 정한 것은 "되돌림
     * 파생(WP-030) 전에는 세면 언제나 0이고, 그 0은 '되돌림이 없다'와 구분되지
     * 않으므로 키를 넣지 않는다"였다. 그 전제가 WP-030으로 해소됐다 —
     * `link_summary.is_reverted`를 실제로 쓰는 워커가 생겼으므로 이제 `0`이
     * **사실 주장**이다.
     *
     * 계약이 바뀐 것이지 시험이 틀렸던 것이 아니다. 그래서 지우지 않고 뒤집는다.
     */
    const { body } = await get('from_seq=0&to_seq=6');
    expect(body.summary).toHaveProperty('reverted_pull_request_count');
    // 이 픽스처의 PR에는 되돌림이 없다. 그 `0`은 이제 확인된 사실이다.
    expect(body.summary?.reverted_pull_request_count).toBe(0);
  });
});

describe('색인이 덜 채워졌을 때 (CR-027, DEV-130)', () => {
  it('**정본에는 있고 색인에 없는 항목이 목록에서 사라지지 않는다**', async () => {
    indexedPrNumbers = new Set([101, 102]);
    const { body } = await get('from_seq=0&to_seq=6');

    // 여섯 줄이 그대로 있다 — 색인이 둘만 알아도 구간의 정의는 변하지 않는다.
    expect(body.items?.map((one) => one.merge_seq)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(body.summary?.commit_count).toBe(6);
  });

  it('**빠진 수를 응답이 말한다** — 덜 채워진 결과와 완전한 결과가 구분된다', async () => {
    indexedPrNumbers = new Set([101, 102]);
    const { body } = await get('from_seq=0&to_seq=6');
    // PR 다섯 중 색인이 아는 것은 둘이므로 셋이 빈다.
    expect(body.items_missing_in_index).toBe(3);
  });

  it('색인이 전부 알면 `0`이다 — 이 값이 늘 양수면 신호가 되지 못한다', async () => {
    const { body } = await get('from_seq=0&to_seq=6');
    expect(body.items_missing_in_index).toBe(0);
  });

  it('색인에 없는 줄은 `indexed: false`이고 표시 필드가 `null`이다', async () => {
    indexedPrNumbers = new Set([101]);
    const { body } = await get('from_seq=0&to_seq=6');
    const found = body.items?.find((one) => one.pr_number === 101);
    const missing = body.items?.find((one) => one.pr_number === 102);
    expect(found?.indexed).toBe(true);
    expect(found?.title).toBe('PR 101');
    expect(missing?.indexed).toBe(false);
    expect(missing?.title).toBeNull();
    // 서수와 SHA는 정본에서 온 확정값이라 그대로 있다.
    expect(missing?.merge_seq).toBe(2);
    expect(missing?.commit_sha).toBe(shaOf(2));
  });

  it('PR 없는 직접 푸시 커밋도 `indexed: false`로 남는다', async () => {
    const { body } = await get('from_seq=2&to_seq=3');
    const direct = body.items?.find((one) => one.merge_seq === 3);
    expect(direct?.kind).toBe('commit');
    expect(direct?.indexed).toBe(false);
    expect(direct?.url).toBe(`/commit/acme/payments/${shaOf(3)}`);
  });
});

describe('`q` 필터 (DEV-136)', () => {
  it('**`q`는 목록과 요약을 함께 좁힌다**', async () => {
    // 픽스처의 짝수 PR이 `lee`다 — 102·104·106이 걸리고 서수 2·4·6이 남는다.
    const { status, body } = await get('from_seq=0&to_seq=6&q=author:lee');
    expect(status).toBe(200);
    expect(body.items?.map((one) => one.pr_number)).toEqual([102, 104, 106]);
    expect(body.summary?.pull_request_count).toBe(3);
    expect(body.summary?.commit_count).toBe(3);
  });

  it('`q`가 있으면 판정할 수 없는 직접 푸시 커밋은 목록에서 빠진다', async () => {
    // 구간 `(1, 4]`는 서수 2·3·4다. 3은 PR이 없어 `q`를 적용할 수 없다.
    const { body } = await get('from_seq=1&to_seq=4&q=author:lee');
    expect(body.items?.map((one) => one.merge_seq)).toEqual([2, 4]);
  });

  it('`q`가 있어도 `items_missing_in_index`는 같은 것을 센다', async () => {
    // 색인이 아는 것은 101 하나. `q`가 무엇을 거르든 "색인이 모르는 넷"은 그대로다.
    indexedPrNumbers = new Set([101]);
    const withQuery = await get('from_seq=0&to_seq=6&q=author:lee');
    const withoutQuery = await get('from_seq=0&to_seq=6');
    // `q`는 101조차 거른다. 그래도 "색인이 모르는 넷"은 그대로여야 한다.
    expect(withQuery.body.summary?.pull_request_count).toBe(0);
    expect(withQuery.body.items_missing_in_index).toBe(4);
    expect(withoutQuery.body.items_missing_in_index).toBe(4);
  });

  it('**색인이 전부 아는데 `q`가 좁히면 부재는 그래도 `0`이다**', async () => {
    /*
     * 거른 건수로 부재를 계산하면 여기서 `3`이 나온다 — "필터에 걸러진 것"과
     * "색인에 없는 것"이 한 숫자에 섞이는 결함이며, 사용자는 색인이 멀쩡한데도
     * 결과가 덜 채워졌다고 읽는다. 그래서 `q`가 있을 때 왕복을 하나 더 쓴다.
     */
    const { body } = await get('from_seq=0&to_seq=6&q=author:kim');
    expect(body.summary?.pull_request_count).toBe(2);
    expect(body.items_missing_in_index).toBe(0);
  });

  it('질의 문법 오류는 조회 전에 400이다', async () => {
    const { status, body } = await get('from_seq=0&to_seq=6&q=nope:1');
    expect(status).toBe(400);
    expect(lastSearches).toEqual([]);
    expect(body.error?.detail?.['supported_keys']).toBeDefined();
  });
});

describe('구간 검증 (AC-3, AC-4 / QA-W004-07·08)', () => {
  it('**역전은 `RANGE_INVERTED`이고 교환 제안을 준다** (QA-W004-07)', async () => {
    const { status, body } = await get('from_seq=5&to_seq=2');
    expect(status).toBe(400);
    expect(body.error?.code).toBe('RANGE_INVERTED');
    expect(body.error?.detail?.['swapped']).toEqual({ from_seq: 2, to_seq: 5 });
  });

  it('**역전을 건수보다 먼저 본다** — 뒤집힌 구간은 언제나 0건이라 통과해 버린다', async () => {
    const { status } = await get('from_seq=6&to_seq=1');
    expect(status).toBe(400);
  });

  it('**폭이 아니라 건수로 판정한다** (DEV-140)', async () => {
    // 상한을 훨씬 넘는 구간 **폭**을 요청해도 실제 건수가 6이면 통과해야 한다.
    const { status, body } = await get('from_seq=0&to_seq=999999');
    expect(status).toBe(200);
    expect(body.summary?.commit_count).toBe(6);
  });

  it('**실제로 5만 건을 넘기면 조회 전에 `RANGE_TOO_LARGE`다** (AC-4, QA-W004-08)', async () => {
    /*
     * 상한을 진짜로 넘겨 본다. 여섯 건짜리 픽스처로는 이 분기가 **한 번도 실행되지
     * 않으며**, 실행되지 않는 분기는 상한을 1,000배로 바꿔도 시험이 초록이다 —
     * 변이 시험에서 실제로 그렇게 살아남았다.
     *
     * 별도 저장소에 한 문장으로 채운다. 본 픽스처를 건드리면 다른 시험의 건수가
     * 함께 흔들린다.
     */
    const BULK = 3199;
    await pool.query('DELETE FROM merge_sequence WHERE repository_id = $1', [BULK]);
    await repositoryRepo.upsertRepository(pool, {
      repository_id: BULK, owner: 'acme', name: 'bulk', org_id: ORG,
      visibility: 'internal', sequence_branches: [BRANCH],
    });
    await sequenceSpaceRepo.ensureSequenceSpace(pool, BULK, BRANCH);
    await pool.query(
      `INSERT INTO merge_sequence
         (repository_id, base_branch, seq_epoch, merge_seq, commit_sha, pull_request_number, committed_at)
       SELECT $1, $2, 1, g, lpad(g::text, 40, '0'), NULL, now()
         FROM generate_series(1, $3::bigint) g`,
      [BULK, BRANCH, RANGE_LIMIT + 1],
    );

    const response = await app.inject({
      method: 'GET',
      url: `${SEQUENCE_RANGE_PATH}?repository=acme%2Fbulk&base_branch=${BRANCH}&from_seq=0&to_seq=${String(RANGE_LIMIT + 1)}`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${sessionId}` },
    });
    const body = response.json<RangeBody>();

    expect(response.statusCode).toBe(400);
    expect(body.error?.code).toBe('RANGE_TOO_LARGE');
    // 이름은 계약을 따르되 값은 정확하다 (DEV-140) — 추정이면 이 단언이 흔들린다.
    expect(body.error?.detail?.['estimated_count']).toBe(RANGE_LIMIT + 1);
    expect(body.error?.detail?.['exact']).toBe(true);
    // 조회를 시작하지 않았다는 것이 "사전"의 뜻이다.
    expect(lastSearches).toEqual([]);

    // 정확히 상한이면 통과한다 — 경계가 `>`이지 `>=`가 아니다.
    const atLimit = await app.inject({
      method: 'GET',
      url: `${SEQUENCE_RANGE_PATH}?repository=acme%2Fbulk&base_branch=${BRANCH}&from_seq=1&to_seq=${String(RANGE_LIMIT + 1)}`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${sessionId}` },
    });
    expect(atLimit.statusCode).toBe(200);

    await pool.query('DELETE FROM merge_sequence WHERE repository_id = $1', [BULK]);
  }, 120_000);

  it('음수 서수는 `INVALID_PARAMETER`다', async () => {
    const { status, body } = await get('from_seq=-1&to_seq=5');
    expect(status).toBe(400);
    expect(body.error?.code).toBe('INVALID_PARAMETER');
  });

  it('`to_seq`가 없으면 `INVALID_PARAMETER`다', async () => {
    const { status, body } = await get('from_seq=1');
    expect(status).toBe(400);
    expect(body.error?.detail?.['field']).toBe('to_seq');
  });
});

describe('에폭과 상태 (ADR-007, FR-SEQ-002 예외 처리 / QA-W004-21·22)', () => {
  it('현재 에폭과 같으면 정상 조회다', async () => {
    const { status, body } = await get('from_seq=0&to_seq=6&seq_epoch=1');
    expect(status).toBe(200);
    expect(body.epoch_stale).toBe(false);
    expect(body.items).toHaveLength(6);
  });

  it('**에폭이 다르면 구간을 실행하지 않는다** (QA-W004-21)', async () => {
    const { status, body } = await get('from_seq=0&to_seq=6&seq_epoch=2');
    expect(status).toBe(200);
    expect(body.epoch_stale).toBe(true);
    expect(body.requested_seq_epoch).toBe(2);
    /*
     * **키가 없어야 한다.** 빈 배열을 주면 "구간이 비었다"로 읽히고, 현재 에폭으로
     * 계산해 주면 같은 번호가 다른 커밋을 가리키는 결과가 오류 없이 돌아간다 —
     * ADR-007이 막으려는 바로 그 동작이다.
     */
    expect(body).not.toHaveProperty('items');
    expect(body).not.toHaveProperty('summary');
    expect(lastSearches).toEqual([]);
  });

  it('`sequence_state`를 함께 낸다 — 재채번 중에도 마지막 확정 값을 준다 (QA-W004-22)', async () => {
    await pool.query('UPDATE sequence_space SET state = $1 WHERE repository_id = $2', [
      'reassigning',
      PAYMENTS,
    ]);
    const { status, body } = await get('from_seq=0&to_seq=6');
    expect(status).toBe(200);
    expect(body.sequence_state).toBe('reassigning');
    expect(body.items).toHaveLength(6);
  });

  it('`stale` 상태도 결과와 함께 드러난다', async () => {
    await pool.query('UPDATE sequence_space SET state = $1 WHERE repository_id = $2', ['stale', PAYMENTS]);
    const { body } = await get('from_seq=0&to_seq=6');
    expect(body.sequence_state).toBe('stale');
  });
});

describe('질의 모양과 계약 (ADR-008, DEV-138)', () => {
  it('**모든 색인 질의가 접근 범위 필터를 지난다**', async () => {
    await get('from_seq=0&to_seq=6');
    const bodies = lastSearches.filter((_, index) => index % 2 === 1);
    expect(bodies).not.toHaveLength(0);
    for (const body of bodies) {
      expect(JSON.stringify(body)).toContain('repository_id');
    }
  });

  it('`q`가 없으면 왕복이 둘이다 — 거르지 않은 건수를 따로 세지 않는다', async () => {
    await get('from_seq=0&to_seq=6');
    expect(lastSearches).toHaveLength(4);
  });

  it('`q`가 있으면 왕복이 셋이다 — 색인 부재를 필터와 섞지 않기 위해서다', async () => {
    await get('from_seq=0&to_seq=6&q=author:kim');
    expect(lastSearches).toHaveLength(6);
  });

  it('`next_cursor`는 키를 두고 늘 `null`이다 (DEV-138)', async () => {
    const { body } = await get('from_seq=0&to_seq=6');
    expect(body).toHaveProperty('next_cursor');
    expect(body.next_cursor).toBeNull();
  });

  it('구간에 PR이 하나도 없으면 색인을 부르지 않는다', async () => {
    const { status, body } = await get('from_seq=2&to_seq=3');
    expect(status).toBe(200);
    expect(body.items?.map((one) => one.merge_seq)).toEqual([3]);
    expect(lastSearches).toEqual([]);
  });
});

describe('접근 통제 (ADR-008)', () => {
  it('접근 범위 밖 저장소는 404다', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `${SEQUENCE_RANGE_PATH}?repository=other%2Fsecret&base_branch=main&from_seq=0&to_seq=6`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${sessionId}` },
    });
    expect(response.statusCode).toBe(404);
  });

  it('세션이 없으면 401이다', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `${SEQUENCE_RANGE_PATH}?repository=acme%2Fpayments&base_branch=main&from_seq=0&to_seq=6`,
    });
    expect(response.statusCode).toBe(401);
  });
});
