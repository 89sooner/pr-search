/**
 * `GET /releases` + `GET /release-comparisons` — 실제 PostgreSQL + 대역 Elasticsearch
 * (WP-026 / API-REL-005, API-SEQ-003, FR-SEQ-004).
 *
 * ## 이 파일이 지키는 주장
 *
 * 1. **목록은 저장소 스코프다** (CR-030, DEV-158). 두 브랜치의 릴리스가 한 목록에
 *    함께 오지 않으면 "다른 대상 브랜치 릴리스 2건 선택"(AC-3)이라는 상황 자체가
 *    만들어지지 않고, 그 규칙을 검증할 길이 사라진다.
 * 2. **저장된 서수를 믿지 않는다** (DEV-149). 현재 에폭 체인에서 커밋을 다시 찾고,
 *    못 찾으면 서수가 없다고 말한다 — 틀린 서수를 조용히 보이지 않는다.
 * 3. **직전 대비 PR 수는 서수 차가 아니다** (QA-W005-06). 픽스처에 직접 푸시 커밋을
 *    섞어 두 값이 **실제로 달라지게** 만든다 — 같으면 이 시험은 아무것도 지키지 않는다.
 * 4. **방향은 서수가 정한다** (AC-4). 지정 순서를 뒤집어도 같은 구간이 나온다.
 *
 * Elasticsearch는 대역이다. 이 두 API의 판정(서수·구간·정규화·PR 수)은 전부
 * PostgreSQL에서 나오고, 색인은 요약의 통계 값만 채운다.
 *
 * 실행: `pnpm test:integration release/timeline`
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
import {
  authRepo,
  mergeSequenceRepo,
  releaseRepo,
  repositoryRepo,
  sequenceSpaceRepo,
  type Pool,
} from '@prs/db';
import type { Redis } from '@prs/bus';
import { buildServer } from '../../src/server.js';
import { RELEASES_PATH, RELEASE_COMPARISON_PATH } from '../../src/sequence/routes.js';
import type { AuthContext, AuthRedis } from '../../src/auth/context.js';
import { createTestRedis, migratedPool, clearMergeSequence } from '../helpers.js';
import { TEST_CURSOR_KEY, TEST_CURSOR_SIGNER } from '../_cursor-fixture.js';

const AUTH_CONFIG = {
  enabled: true,
  cookieSecure: true,
  loginPath: '/auth/login',
  groupRoleMap: new Map<string, never>(),
} as const;

const USER = 'sub-timeline';
const PAYMENTS = 4101;
/** 채번은 됐으나 릴리스가 0건 — `release_not_indexed`의 근거. */
const LEDGER = 4102;
/** 공간은 에폭 2인데 서수 행은 에폭 1에 남았다 — 이전 에폭 서수를 믿지 않는 근거. */
const RISK = 4103;
const HIDDEN = 4900;
const ORG = 1;
const MAIN = 'main';
const REL24 = 'release/2.4';

/**
 * main 체인 서수 1~7. **3번은 PR 없는 직접 푸시**다 — 서수 차와 PR 수를 가른다.
 *
 * v1.0(서수 2) → v1.1(서수 5) 구간은 서수 차 3인데 PR은 4·5 둘뿐이다.
 */
const MAIN_COMMITS = [
  { seq: 1, pr: 201 },
  { seq: 2, pr: 202 },
  { seq: 3, pr: null },
  { seq: 4, pr: 204 },
  { seq: 5, pr: 205 },
  { seq: 6, pr: 206 },
  { seq: 7, pr: 207 },
] as const;

const REL24_COMMITS = [
  { seq: 1, pr: 301 },
  { seq: 2, pr: 302 },
] as const;

function mainSha(seq: number): string {
  return `${String(seq).padStart(2, '0')}${'a'.repeat(38)}`;
}
function rel24Sha(seq: number): string {
  return `${String(seq).padStart(2, '0')}${'b'.repeat(38)}`;
}
const OFF_CHAIN_SHA = 'f'.repeat(40);

let pool: Pool;
let redis: Redis;
let app: FastifyInstance;
let sessionId: string;
let indexedPrNumbers: Set<number>;

interface ReleaseItem {
  readonly tag_name: string;
  readonly commit_sha: string;
  readonly released_at: string;
  readonly source: string;
  readonly base_branch: string | null;
  readonly sequence_space: string | null;
  readonly seq_epoch: number | null;
  readonly merge_seq: number | null;
  readonly previous_tag_name: string | null;
  readonly pull_request_count_since_previous: number | null;
}

interface ReleaseListBody {
  readonly repository?: string;
  readonly releases?: ReleaseItem[];
  readonly reason?: string | null;
  readonly truncated?: boolean;
  readonly error?: { code: string; message: string; detail?: Record<string, unknown> };
  readonly correlation_id: string;
}

interface ComparisonBody {
  readonly sequence_space?: string;
  readonly seq_epoch?: number;
  readonly sequence_state?: string;
  readonly epoch_stale?: boolean;
  readonly requested_seq_epoch?: number;
  readonly normalized_direction?: string;
  readonly unreleased?: boolean;
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
  readonly items?: { merge_seq: number; commit_sha: string }[];
  readonly next_cursor?: string | null;
  readonly error?: { code: string; message: string; detail?: Record<string, unknown> };
  readonly correlation_id: string;
}

async function listReleases(
  params: Record<string, string>,
): Promise<{ status: number; body: ReleaseListBody }> {
  const query = new URLSearchParams({ repository: 'acme/payments', ...params }).toString();
  const response = await app.inject({
    method: 'GET',
    url: `${RELEASES_PATH}?${query}`,
    headers: { cookie: `${SESSION_COOKIE_NAME}=${sessionId}` },
  });
  return { status: response.statusCode, body: response.json<ReleaseListBody>() };
}

async function compare(
  params: Record<string, string>,
): Promise<{ status: number; body: ComparisonBody }> {
  const query = new URLSearchParams({
    repository: 'acme/payments',
    base_branch: MAIN,
    ...params,
  }).toString();
  const response = await app.inject({
    method: 'GET',
    url: `${RELEASE_COMPARISON_PATH}?${query}`,
    headers: { cookie: `${SESSION_COOKIE_NAME}=${sessionId}` },
  });
  return { status: response.statusCode, body: response.json<ComparisonBody>() };
}

/** 대역 Elasticsearch — `terms(pr_number)`에 실린 번호 중 색인에 있는 것만 답한다. */
function stubEsClient(): Client {
  const numbersOf = (query: unknown): number[] => {
    const match = /"pr_number":\[([^\]]*)\]/.exec(JSON.stringify(query));
    if (match === null || match[1] === undefined || match[1] === '') return [];
    return match[1].split(',').map(Number);
  };

  return {
    msearch: ({ searches }: { searches: unknown[] }) => {
      const responses: unknown[] = [];
      for (let i = 1; i < searches.length; i += 2) {
        const body = searches[i] as { size?: number; aggs?: unknown };
        const found = numbersOf(body).filter((n) => indexedPrNumbers.has(n));
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
                      author: 'kim',
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
                  distinct_authors: { value: 1 },
                  changed_files: { value: found.length * 2 },
                  additions: { value: found.length * 10 },
                  deletions: { value: found.length * 3 },
                  files_truncated: { doc_count: 0 },
                  top_paths: { buckets: [{ key: 'src/pay/retry.ts', doc_count: found.length }] },
                },
              }),
        });
      }
      return Promise.resolve({ responses });
    },
    /*
     * **단일 조회도 받는다** (WP-032, DEV-270).
     *
     * 릴리스 비교도 `runRange`를 지나므로 목록은 이제 정본 chunk 순회다.
     * 요약·건수는 여전히 `msearch` 한 번이며, 그 주장은 `sequence/range.test.ts`의
     * 왕복 수 시험이 지킨다 — 여기서 옛 모양을 강제하면 바뀐 계약을 굳히게 된다.
     */
    search: (body: { size?: number }) => {
      const found = numbersOf(body).filter((n) => indexedPrNumbers.has(n));
      return Promise.resolve({
        _shards: { total: 1, successful: 1, failed: 0, skipped: 0 },
        timed_out: false,
        hits: {
          total: { value: found.length, relation: 'eq' },
          hits:
            (body.size ?? 0) === 0
              ? []
              : found.map((n) => ({
                  _index: 'prs-pull-requests-v2',
                  _id: `p-${String(n)}`,
                  _source: {
                    pr_number: n,
                    title: `PR ${String(n)}`,
                    author: 'kim',
                    merged_at: '2026-08-12T00:00:00Z',
                    changed_files_count: 2,
                    additions: 10,
                    deletions: 3,
                  },
                })),
        },
      });
    },
  } as unknown as Client;
}

beforeAll(async () => {
  pool = await migratedPool();
  redis = createTestRedis();

  await pool.query('DELETE FROM release');
  await clearMergeSequence(pool);
  await pool.query('DELETE FROM sequence_space');
  await pool.query('DELETE FROM permission_cache');
  await pool.query('DELETE FROM app_user');
  await pool.query('DELETE FROM repository');

  await authRepo.upsertUserOnLogin(pool, { user_id: USER, login: 'kim', github_user_id: 7301 });
  for (const [id, owner, name, org, branches] of [
    [PAYMENTS, 'acme', 'payments', ORG, [MAIN, REL24]],
    [LEDGER, 'acme', 'ledger', ORG, [MAIN]],
    [RISK, 'acme', 'risk', ORG, [MAIN]],
    [HIDDEN, 'other', 'secret', 2, [MAIN]],
  ] as const) {
    await repositoryRepo.upsertRepository(pool, {
      repository_id: id,
      owner,
      name,
      org_id: org,
      visibility: 'internal',
      sequence_branches: [...branches],
    });
  }

  await sequenceSpaceRepo.ensureSequenceSpace(pool, PAYMENTS, MAIN);
  for (const commit of MAIN_COMMITS) {
    await mergeSequenceRepo.upsertMergeSequence(pool, {
      repository_id: PAYMENTS,
      base_branch: MAIN,
      seq_epoch: 1,
      merge_seq: commit.seq,
      commit_sha: mainSha(commit.seq),
      pull_request_number: commit.pr,
      committed_at: new Date(`2026-08-${String(commit.seq).padStart(2, '0')}T00:00:00Z`),
    });
  }
  await sequenceSpaceRepo.advanceHead(pool, PAYMENTS, MAIN, mainSha(7), 7);

  await sequenceSpaceRepo.ensureSequenceSpace(pool, PAYMENTS, REL24);
  for (const commit of REL24_COMMITS) {
    await mergeSequenceRepo.upsertMergeSequence(pool, {
      repository_id: PAYMENTS,
      base_branch: REL24,
      seq_epoch: 1,
      merge_seq: commit.seq,
      commit_sha: rel24Sha(commit.seq),
      pull_request_number: commit.pr,
      committed_at: new Date('2026-08-12T00:00:00Z'),
    });
  }
  await sequenceSpaceRepo.advanceHead(pool, PAYMENTS, REL24, rel24Sha(2), 2);

  /*
   * 릴리스 다섯. `resynced`는 **저장 서수가 NULL인데 커밋은 체인 위**다 — 동기화가
   * 채번보다 먼저 돈 모습이고, 읽기가 현재 에폭에서 다시 찾는다는 DEV-149의 증거다.
   */
  const seed: Parameters<typeof releaseRepo.upsertRelease>[1][] = [
    { repository_id: PAYMENTS, tag_name: 'v1.0', commit_sha: mainSha(2), base_branch: MAIN, seq_epoch: 1, merge_seq: 2, released_at: new Date('2026-08-10T09:00:00Z'), source: 'git_tag' },
    { repository_id: PAYMENTS, tag_name: 'r2.4.0', commit_sha: rel24Sha(2), base_branch: REL24, seq_epoch: 1, merge_seq: 2, released_at: new Date('2026-08-12T09:00:00Z'), source: 'git_tag' },
    { repository_id: PAYMENTS, tag_name: 'off-chain', commit_sha: OFF_CHAIN_SHA, base_branch: null, seq_epoch: null, merge_seq: null, released_at: new Date('2026-08-13T09:00:00Z'), source: 'git_tag' },
    { repository_id: PAYMENTS, tag_name: 'v1.1', commit_sha: mainSha(5), base_branch: MAIN, seq_epoch: 1, merge_seq: 5, released_at: new Date('2026-08-14T09:00:00Z'), source: 'git_tag' },
    { repository_id: PAYMENTS, tag_name: 'resynced', commit_sha: mainSha(6), base_branch: null, seq_epoch: null, merge_seq: null, released_at: new Date('2026-08-15T09:00:00Z'), source: 'git_tag' },
  ];
  for (const release of seed) await releaseRepo.upsertRelease(pool, release);

  // LEDGER: 채번은 있고 릴리스는 0건.
  await sequenceSpaceRepo.ensureSequenceSpace(pool, LEDGER, MAIN);
  await mergeSequenceRepo.upsertMergeSequence(pool, {
    repository_id: LEDGER,
    base_branch: MAIN,
    seq_epoch: 1,
    merge_seq: 1,
    commit_sha: `${'5'.repeat(40)}`,
    pull_request_number: 401,
    committed_at: new Date('2026-08-10T00:00:00Z'),
  });
  await sequenceSpaceRepo.advanceHead(pool, LEDGER, MAIN, `${'5'.repeat(40)}`, 1);

  // RISK: 공간은 에폭 2, 서수 행과 릴리스는 에폭 1에 남았다.
  await sequenceSpaceRepo.ensureSequenceSpace(pool, RISK, MAIN);
  await mergeSequenceRepo.upsertMergeSequence(pool, {
    repository_id: RISK,
    base_branch: MAIN,
    seq_epoch: 1,
    merge_seq: 1,
    commit_sha: `${'6'.repeat(40)}`,
    pull_request_number: 501,
    committed_at: new Date('2026-08-10T00:00:00Z'),
  });
  await releaseRepo.upsertRelease(pool, {
    repository_id: RISK,
    tag_name: 'old-epoch',
    commit_sha: `${'6'.repeat(40)}`,
    base_branch: MAIN,
    seq_epoch: 1,
    merge_seq: 1,
    released_at: new Date('2026-08-11T09:00:00Z'),
    source: 'git_tag',
  });
  await pool.query('UPDATE sequence_space SET seq_epoch = 2 WHERE repository_id = $1', [RISK]);

  const redisPort: AuthRedis = {
    get: (key) => redis.get(key),
    set: (key, value, mode, seconds) => redis.set(key, value, mode, seconds),
    del: (...keys) => redis.del(...keys),
    scan: (cursor, m, pattern, c, n) => redis.scan(cursor, m, pattern, c, n),
  };
  const source: AccessScopeSource = {
    fetch: async () => ({
      repositoryIds: [PAYMENTS, LEDGER, RISK],
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
    config: { port: 0, adminTokens: [], metricsQueryUrl: null, gheBaseUrl: null, auth: AUTH_CONFIG, searchCursorKey: TEST_CURSOR_KEY },
    auth,
    search: { pool, es, cursorSigner: TEST_CURSOR_SIGNER, resolveNames: async () => ({ orgIds: new Map(), teamIds: new Map() }) },
    sequence: { pool, es, cursorSigner: TEST_CURSOR_SIGNER, resolveNames: async () => ({ orgIds: new Map(), teamIds: new Map() }) },
  });
  await app.ready();
}, 180_000);

beforeEach(async () => {
  indexedPrNumbers = new Set([
    ...MAIN_COMMITS.flatMap((c) => (c.pr === null ? [] : [c.pr as number])),
    ...REL24_COMMITS.map((c) => c.pr as number),
    401,
    501,
  ]);
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

describe('GET /releases — 저장소 릴리스 목록 (API-REL-005)', () => {
  it('두 브랜치의 릴리스가 한 목록에 함께 온다 (DEV-158 / AC-3의 전제)', async () => {
    const { status, body } = await listReleases({});
    expect(status).toBe(200);
    const branches = new Set((body.releases ?? []).map((r) => r.base_branch));
    expect(branches).toContain(MAIN);
    expect(branches).toContain(REL24);
  });

  it('정렬은 시각 내림차순이다', async () => {
    const { body } = await listReleases({});
    expect((body.releases ?? []).map((r) => r.tag_name)).toEqual([
      'resynced',
      'v1.1',
      'off-chain',
      'r2.4.0',
      'v1.0',
    ]);
  });

  it('직전 대비 PR 수는 서수 차가 아니라 PR 문서 수다 (QA-W005-06)', async () => {
    const { body } = await listReleases({});
    const v11 = (body.releases ?? []).find((r) => r.tag_name === 'v1.1');
    expect(v11?.previous_tag_name).toBe('v1.0');
    // (2, 5]의 서수는 셋(3·4·5)인데 3번은 직접 푸시라 PR은 둘이다.
    expect(v11?.merge_seq).toBe(5);
    expect(v11?.pull_request_count_since_previous).toBe(2);
    expect(v11?.pull_request_count_since_previous).not.toBe(5 - 2);
  });

  it('서수가 가장 낮은 릴리스의 직전 값은 null이다 — 0이 아니다', async () => {
    const { body } = await listReleases({});
    const v10 = (body.releases ?? []).find((r) => r.tag_name === 'v1.0');
    expect(v10?.previous_tag_name).toBeNull();
    expect(v10?.pull_request_count_since_previous).toBeNull();
  });

  it('체인 밖 태그도 싣되 서수는 없다 (숨기지 않는다)', async () => {
    const { body } = await listReleases({});
    const off = (body.releases ?? []).find((r) => r.tag_name === 'off-chain');
    expect(off).toBeDefined();
    expect(off?.merge_seq).toBeNull();
    expect(off?.base_branch).toBeNull();
    expect(off?.sequence_space).toBeNull();
    expect(off?.pull_request_count_since_previous).toBeNull();
  });

  it('저장 서수가 NULL이어도 현재 에폭 체인에 있으면 서수가 산다 (DEV-149)', async () => {
    const { body } = await listReleases({});
    const resynced = (body.releases ?? []).find((r) => r.tag_name === 'resynced');
    expect(resynced?.merge_seq).toBe(6);
    expect(resynced?.base_branch).toBe(MAIN);
    expect(resynced?.sequence_space).toBe(`acme/payments@${MAIN}`);
    expect(resynced?.previous_tag_name).toBe('v1.1');
    // (5, 6]에는 PR 206 하나.
    expect(resynced?.pull_request_count_since_previous).toBe(1);
  });

  it('이전 에폭의 저장 서수는 믿지 않는다 (DEV-149)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `${RELEASES_PATH}?repository=acme%2Frisk`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${sessionId}` },
    });
    const body = response.json<ReleaseListBody>();
    expect(response.statusCode).toBe(200);
    const old = (body.releases ?? [])[0];
    expect(old?.tag_name).toBe('old-epoch');
    // 표에는 서수 1이 적혀 있지만 현재 에폭(2)의 체인에는 그 커밋이 없다.
    expect(old?.merge_seq).toBeNull();
    expect(old?.seq_epoch).toBeNull();
  });

  it('브랜치 필터는 그 공간만 남긴다', async () => {
    const { body } = await listReleases({ branch: REL24 });
    expect((body.releases ?? []).map((r) => r.tag_name)).toEqual(['r2.4.0']);
    expect(body.reason).toBeNull();
  });

  it('필터가 걸러 낸 빈 목록에는 사유를 싣지 않는다 — 릴리스는 있다', async () => {
    const { body } = await listReleases({ branch: 'no-such-branch' });
    expect(body.releases).toEqual([]);
    expect(body.reason).toBeNull();
  });

  it('릴리스가 0건이면 200 + release_not_indexed다 — 404가 아니다 (DEV-146)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `${RELEASES_PATH}?repository=acme%2Fledger`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${sessionId}` },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<ReleaseListBody>();
    expect(body.releases).toEqual([]);
    expect(body.reason).toBe('release_not_indexed');
  });

  it('접근 범위 밖 저장소는 404다 — 존재를 드러내지 않는다', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `${RELEASES_PATH}?repository=other%2Fsecret`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${sessionId}` },
    });
    expect(response.statusCode).toBe(404);
    expect(response.json<ReleaseListBody>().error?.code).toBe('NOT_FOUND');
  });

  it('상한을 넘으면 최신부터 채우고 truncated를 싣는다 — 말없이 자르지 않는다', async () => {
    const { body } = await listReleases({ limit: '2' });
    expect(body.truncated).toBe(true);
    expect((body.releases ?? []).map((r) => r.tag_name)).toEqual(['resynced', 'v1.1']);

    const all = await listReleases({});
    expect(all.body.truncated).toBe(false);
  });

  it('세션이 없으면 조회할 수 없다', async () => {
    const response = await app.inject({ method: 'GET', url: `${RELEASES_PATH}?repository=acme%2Fpayments` });
    expect(response.statusCode).toBe(401);
  });
});

describe('GET /release-comparisons — 릴리스 구간 비교 (API-SEQ-003)', () => {
  it('지정 순서를 뒤집어도 같은 구간이고 방향이 명시된다 (AC-4)', async () => {
    const forward = await compare({ from: 'v1.0', to: 'v1.1' });
    const reversed = await compare({ from: 'v1.1', to: 'v1.0' });

    expect(forward.status).toBe(200);
    expect(reversed.status).toBe(200);
    expect(forward.body.range).toEqual({ from_seq: 2, to_seq: 5, boundary: '(from, to]' });
    expect(reversed.body.range).toEqual(forward.body.range);
    expect(reversed.body.normalized_direction).toContain('from=v1.0(seq 2)');
    expect(reversed.body.normalized_direction).toContain('to=v1.1(seq 5)');
  });

  it('요약은 API-SEQ-001과 같은 계층이다 — **되돌림 키가 양쪽에 함께 생긴다** (CR-041)', async () => {
    const { body } = await compare({ from: 'v1.0', to: 'v1.1' });
    // (2, 5]: 서수 셋 중 PR은 204·205 둘.
    expect(body.summary?.pull_request_count).toBe(2);
    expect(body.summary?.commit_count).toBe(3);
    /*
     * **이 시험도 반대를 단언하고 있었다** (DEV-133). 두 API가 `RangeSummary` 하나를
     * 공유하므로 한쪽에만 생길 수 없다 — 그것이 이 시험의 원래 요지였고, WP-030이
     * 키를 세우면서 요지는 그대로인 채 값만 반대가 됐다.
     */
    expect(Object.keys(body.summary ?? {})).toContain('reverted_pull_request_count');
  });

  it('size=0은 요약만 낸다', async () => {
    const { body } = await compare({ from: 'v1.0', to: 'v1.1', size: '0' });
    expect(body.items).toEqual([]);
    expect(body.summary?.pull_request_count).toBe(2);
  });

  it('다른 대상 브랜치의 릴리스는 비교하지 않는다 (AC-3)', async () => {
    const { status, body } = await compare({ from: 'v1.0', to: 'r2.4.0' });
    expect(status).toBe(400);
    expect(body.error?.code).toBe('SEQUENCE_SPACE_MISMATCH');
  });

  it('to=unreleased는 마지막 릴리스 이후 head까지다 (AC-5)', async () => {
    const { status, body } = await compare({ to: 'unreleased' });
    expect(status).toBe(200);
    expect(body.unreleased).toBe(true);
    // 마지막 릴리스는 `resynced`(서수 6), head는 7.
    expect(body.range).toEqual({ from_seq: 6, to_seq: 7, boundary: '(from, to]' });
    expect(body.normalized_direction).toContain('from=resynced(seq 6)');
    expect(body.summary?.pull_request_count).toBe(1);
  });

  it('릴리스가 하나도 없어도 미배포는 답한다 — 전부 미배포가 참이다', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `${RELEASE_COMPARISON_PATH}?repository=acme%2Fledger&base_branch=${MAIN}&to=unreleased`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${sessionId}` },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<ComparisonBody>();
    expect(body.range).toEqual({ from_seq: 0, to_seq: 1, boundary: '(from, to]' });
    expect(body.summary?.pull_request_count).toBe(1);
  });

  it('지목한 태그가 없으면 404 RELEASE_NOT_INDEXED다', async () => {
    const { status, body } = await compare({ from: 'v1.0', to: 'no-such-tag' });
    expect(status).toBe(404);
    expect(body.error?.code).toBe('RELEASE_NOT_INDEXED');
    // 다른 태그는 있으므로 "수집 자체가 없다"와 구분된다.
    expect(body.error?.detail?.['reason']).toBe('tag_not_found');
  });

  it('릴리스 수집 자체가 없는 저장소는 사유가 다르다', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `${RELEASE_COMPARISON_PATH}?repository=acme%2Fledger&base_branch=${MAIN}&from=v9.8.7&to=v9.9.9`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${sessionId}` },
    });
    expect(response.statusCode).toBe(404);
    expect(response.json<ComparisonBody>().error?.detail?.['reason']).toBe('release_not_indexed');
  });

  it('에폭 인용이 다르면 구간을 실행하지 않는다 (ADR-007)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `${RELEASE_COMPARISON_PATH}?repository=acme%2Fpayments&base_branch=${MAIN}&from=v1.0&to=v1.1&seq_epoch=99`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${sessionId}` },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<ComparisonBody>();
    expect(body.epoch_stale).toBe(true);
    expect(body.requested_seq_epoch).toBe(99);
    // 계산하지 않은 것을 빈 값으로 채우지 않는다.
    expect(body.summary).toBeUndefined();
    expect(body.items).toBeUndefined();
  });

  it('to가 없으면 400이다', async () => {
    const { status, body } = await compare({ from: 'v1.0' });
    expect(status).toBe(400);
    expect(body.error?.code).toBe('INVALID_PARAMETER');
  });

  it('to가 릴리스인데 from이 없으면 400이다 — 미배포일 때만 생략할 수 있다', async () => {
    const { status, body } = await compare({ to: 'v1.1' });
    expect(status).toBe(400);
    expect(body.error?.detail?.['field']).toBe('from');
  });
});
