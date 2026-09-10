/**
 * `GET /release-comparisons` — 실제 PostgreSQL + Redis (WP-026 / API-SEQ-003, FR-SEQ-004).
 *
 * ## 이 파일이 지키는 경계
 *
 * - **순서에 의도가 없다** (AC-4, QA-W005-02): 역순 지정이 오류가 아니라
 *   정규화이고, 방향이 응답에 명시된다.
 * - **태그는 분류를 거치지 않는다** (CR-030, DEV-157): hex처럼 생긴 태그가
 *   SHA로 오독되지 않는다.
 * - **저장 서수 trio를 믿지 않는다** (DEV-149): trio가 NULL이어도 커밋이
 *   현재 에폭 체인에 있으면 해석된다.
 * - **지목한 릴리스가 없으면 404 `RELEASE_NOT_INDEXED`다** (DEV-146의 구분):
 *   미수집과 태그 부재를 detail의 `reason`이 가른다.
 *
 * Elasticsearch는 대역이다 — 멤버십·서수는 PostgreSQL이 답하고(DEV-130),
 * 색인은 표시 필드·요약만 채운다. 빈 구간·오류 경로가 색인을 부르면 시험이
 * 실패한다. 실제 색인 위 요약은 CI의 실-ES 계층(`range-es`)이 이미 본다.
 *
 * 실행: `pnpm test:integration release/comparison`
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
import { RELEASE_COMPARISON_PATH } from '../../src/sequence/routes.js';
import type { AuthContext, AuthRedis } from '../../src/auth/context.js';
import { createTestRedis, migratedPool } from '../helpers.js';

const AUTH_CONFIG = {
  enabled: true,
  cookieSecure: true,
  loginPath: '/auth/login',
  groupRoleMap: new Map<string, never>(),
} as const;

const USER = 'sub-comparison';
const PAYMENTS = 2101;
const NORELEASE = 2102;
const HIDDEN = 2900;
const ORG = 1;
const BRANCH = 'main';

/** 서수 1~4. 1은 직접 푸시(PR 없음) — "PR 수 ≠ 서수 차"의 근거다. */
const COMMITS = [
  { seq: 1, sha: `${'1'.repeat(40)}`, pr: null, at: '2026-08-10T00:00:00Z' },
  { seq: 2, sha: `${'2'.repeat(40)}`, pr: 41, at: '2026-08-11T00:00:00Z' },
  { seq: 3, sha: `${'3'.repeat(40)}`, pr: 42, at: '2026-08-12T00:00:00Z' },
  { seq: 4, sha: `${'4'.repeat(40)}`, pr: 43, at: '2026-08-13T00:00:00Z' },
] as const;

const OFF_CHAIN_SHA = `${'f'.repeat(40)}`;

let pool: Pool;
let redis: Redis;
let app: FastifyInstance;
let sessionId: string;

/** msearch 대역: `null`이면 부르는 순간 던진다 — 빈 구간·오류 경로의 단언. */
let msearchPlan: {
  readonly total: number;
  readonly sources: Record<string, unknown>[];
} | null;
let msearchCalls: Record<string, unknown>[];
/** search 대역(머지 커밋 제안 경로만 쓴다): `null`이면 던진다. */
let searchHits: { _source: Record<string, unknown> }[] | null;

interface ComparisonBody {
  readonly sequence_space?: string;
  readonly seq_epoch?: number;
  readonly normalized_direction?: string;
  readonly from_release?: { tag_name: string; merge_seq: number };
  readonly to_release?: { tag_name: string; merge_seq: number };
  readonly range?: { from_seq: number; to_seq: number; boundary: string };
  readonly summary?: Record<string, unknown>;
  readonly items?: { merge_seq: number; kind: string; indexed: boolean }[];
  readonly items_missing_in_index?: number;
  readonly next_cursor?: string | null;
  readonly error?: { code: string; message: string; detail?: Record<string, unknown> };
  readonly correlation_id: string;
}

async function compare(
  params: Record<string, string>,
  withSession = true,
): Promise<{ status: number; body: ComparisonBody }> {
  const query = new URLSearchParams({
    repository: 'acme/payments',
    base_branch: BRANCH,
    ...params,
  }).toString();
  const response = await app.inject({
    method: 'GET',
    url: `${RELEASE_COMPARISON_PATH}?${query}`,
    ...(withSession ? { headers: { cookie: `${SESSION_COOKIE_NAME}=${sessionId}` } } : {}),
  });
  return { status: response.statusCode, body: response.json<ComparisonBody>() };
}

beforeAll(async () => {
  pool = await migratedPool();
  redis = createTestRedis();

  await pool.query('DELETE FROM release');
  await pool.query('DELETE FROM merge_sequence');
  await pool.query('DELETE FROM sequence_space');
  await pool.query('DELETE FROM permission_cache');
  await pool.query('DELETE FROM app_user');
  await pool.query('DELETE FROM repository');

  await authRepo.upsertUserOnLogin(pool, { user_id: USER, login: 'kim', github_user_id: 7103 });
  for (const [id, owner, name, org] of [
    [PAYMENTS, 'acme', 'payments', ORG],
    [NORELEASE, 'acme', 'ledger', ORG],
    [HIDDEN, 'other', 'secret', 2],
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
  for (const commit of COMMITS) {
    await mergeSequenceRepo.upsertMergeSequence(pool, {
      repository_id: PAYMENTS,
      base_branch: BRANCH,
      seq_epoch: 1,
      merge_seq: commit.seq,
      commit_sha: commit.sha,
      pull_request_number: commit.pr,
      committed_at: new Date(commit.at),
    });
  }
  await sequenceSpaceRepo.advanceHead(pool, PAYMENTS, BRANCH, COMMITS[3].sha, 4);

  /*
   * 릴리스 넷: 체인 위 둘(v1.0=서수 2, v1.1=서수 3), 체인 밖 하나,
   * 그리고 **trio가 NULL인데 커밋은 체인 위인 하나**(`deadbeefcafe` — hex처럼
   * 생긴 태그이기도 하다: 분류를 거치면 SHA 접두로 오독되는 바로 그 모양).
   */
  const seed: Parameters<typeof releaseRepo.upsertRelease>[1][] = [
    { repository_id: PAYMENTS, tag_name: 'v1.0', commit_sha: COMMITS[1].sha, base_branch: BRANCH, seq_epoch: 1, merge_seq: 2, released_at: new Date('2026-08-14T09:00:00Z'), source: 'git_tag' },
    { repository_id: PAYMENTS, tag_name: 'v1.1', commit_sha: COMMITS[2].sha, base_branch: BRANCH, seq_epoch: 1, merge_seq: 3, released_at: new Date('2026-08-15T09:00:00Z'), source: 'git_tag' },
    { repository_id: PAYMENTS, tag_name: 'v-dev', commit_sha: `${'d'.repeat(40)}`, base_branch: 'develop', seq_epoch: 1, merge_seq: 1, released_at: new Date('2026-08-13T09:00:00Z'), source: 'git_tag' },
    { repository_id: PAYMENTS, tag_name: 'off-chain-tag', commit_sha: OFF_CHAIN_SHA, base_branch: null, seq_epoch: null, merge_seq: null, released_at: new Date('2026-08-16T09:00:00Z'), source: 'git_tag' },
    { repository_id: PAYMENTS, tag_name: 'deadbeefcafe', commit_sha: COMMITS[3].sha, base_branch: null, seq_epoch: null, merge_seq: null, released_at: new Date('2026-08-17T09:00:00Z'), source: 'git_tag' },
  ];
  for (const release of seed) await releaseRepo.upsertRelease(pool, release);

  // NORELEASE: 채번은 있으나 릴리스가 0건 — `release_not_indexed`의 근거.
  await sequenceSpaceRepo.ensureSequenceSpace(pool, NORELEASE, BRANCH);
  await mergeSequenceRepo.upsertMergeSequence(pool, {
    repository_id: NORELEASE,
    base_branch: BRANCH,
    seq_epoch: 1,
    merge_seq: 1,
    commit_sha: `${'5'.repeat(40)}`,
    pull_request_number: 51,
    committed_at: new Date('2026-08-10T00:00:00Z'),
  });
  await sequenceSpaceRepo.advanceHead(pool, NORELEASE, BRANCH, `${'5'.repeat(40)}`, 1);

  const redisPort: AuthRedis = {
    get: (key) => redis.get(key),
    set: (key, value, mode, seconds) => redis.set(key, value, mode, seconds),
    del: (...keys) => redis.del(...keys),
    scan: (cursor, m, pattern, c, n) => redis.scan(cursor, m, pattern, c, n),
  };

  const source: AccessScopeSource = {
    fetch: async () => ({
      repositoryIds: [PAYMENTS, NORELEASE],
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

  const es = {
    search: () => {
      if (searchHits === null) throw new Error('이 경로는 search를 부르지 않아야 한다');
      return Promise.resolve({
        hits: { total: { value: searchHits.length, relation: 'eq' }, hits: searchHits },
      });
    },
    msearch: (request: Record<string, unknown>) => {
      msearchCalls.push(request);
      if (msearchPlan === null) throw new Error('빈 구간과 오류 경로는 색인 요약을 부르지 않아야 한다');
      return Promise.resolve({
        took: 1,
        responses: [
          {
            status: 200,
            took: 1,
            timed_out: false,
            hits: { total: { value: msearchPlan.total, relation: 'eq' }, hits: [] },
            aggregations: {
              distinct_authors: { value: 2 },
              changed_files: { value: 10 },
              additions: { value: 100 },
              deletions: { value: 20 },
              files_truncated: { doc_count: 0 },
              top_paths: { buckets: [{ key: 'services/payment', doc_count: 3 }] },
            },
          },
          {
            status: 200,
            took: 1,
            timed_out: false,
            hits: {
              total: { value: msearchPlan.sources.length, relation: 'eq' },
              hits: msearchPlan.sources.map((source) => ({ _source: source })),
            },
          },
        ],
      });
    },
  } as unknown as Client;

  app = buildServer({
    config: { port: 0, adminTokens: [], metricsQueryUrl: null, gheBaseUrl: null, auth: AUTH_CONFIG },
    auth,
    search: { es, resolveNames: async () => ({ orgIds: new Map(), teamIds: new Map() }) },
    sequence: { pool, es, resolveNames: async () => ({ orgIds: new Map(), teamIds: new Map() }) },
  });
  await app.ready();
}, 180_000);

beforeEach(async () => {
  msearchPlan = null;
  msearchCalls = [];
  searchHits = null;
  await redis.del(scopeKey(USER));
  sessionId = createSessionId();
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
    issuedAt: Date.now(),
    lastSeenAt: Date.now(),
    correlationId: null,
  });
});

afterAll(async () => {
  await app.close();
  // 다음 파일의 시드와 충돌하지 않게 릴리스만 정리한다 — 표는 파일마다 자기 시드를 깐다.
  await pool.query('DELETE FROM release');
  await pool.end();
  await redis.quit();
});

describe('정규화 (FR-SEQ-004 AC-4, QA-W005-02)', () => {
  it('**역순 지정은 오류가 아니라 정규화다** — 작은 서수가 시작이 되고 방향이 명시된다', async () => {
    msearchPlan = {
      total: 1,
      sources: [{ pr_number: 42, title: '위험 판정 개편', author: 'lee', merged_at: '2026-08-12T00:10:00Z', changed_files_count: 4, additions: 40, deletions: 6 }],
    };
    const { status, body } = await compare({ from: 'v1.1', to: 'v1.0' });
    expect(status).toBe(200);
    expect(body.range).toEqual({ from_seq: 2, to_seq: 3, boundary: '(from, to]' });
    expect(body.from_release).toEqual({ tag_name: 'v1.0', merge_seq: 2 });
    expect(body.to_release).toEqual({ tag_name: 'v1.1', merge_seq: 3 });
    expect(body.normalized_direction).toBe('from=v1.0(seq 2) → to=v1.1(seq 3)');
    expect(body.summary?.['pull_request_count']).toBe(1);
    expect(body.items?.map((item) => item.merge_seq)).toEqual([3]);
    // 요약 질의가 강제 범위 필터를 지났는지 — 원문에 저장소 항이 실려야 한다 (ADR-008).
    expect(JSON.stringify(msearchCalls)).toContain('"repository_id"');
  });

  it('같은 태그 둘은 빈 반개구간이다 — 색인을 부르지 않고 0건을 낸다', async () => {
    const { status, body } = await compare({ from: 'v1.0', to: 'v1.0' });
    expect(status).toBe(200);
    expect(body.range).toEqual({ from_seq: 2, to_seq: 2, boundary: '(from, to]' });
    expect(body.summary?.['pull_request_count']).toBe(0);
    expect(body.summary?.['commit_count']).toBe(0);
    expect(body.items).toEqual([]);
    expect(msearchCalls).toHaveLength(0);
  });

  it('**되돌림 수 키는 응답에 없다** (DEV-156) — WP-030 전에 세면 언제나 0이라 싣지 않는다', async () => {
    msearchPlan = { total: 1, sources: [] };
    const { body } = await compare({ from: 'v1.0', to: 'v1.1' });
    expect(body.summary).toBeDefined();
    expect(Object.keys(body.summary ?? {})).not.toContain('reverted_pull_request_count');
  });
});

describe('태그 해석 (CR-030, DEV-157·149)', () => {
  it('**hex처럼 생긴 태그가 SHA로 오독되지 않는다** — 분류 없이 태그 그대로 해석한다', async () => {
    msearchPlan = { total: 2, sources: [] };
    const { status, body } = await compare({ from: 'v1.0', to: 'deadbeefcafe' });
    expect(status).toBe(200);
    // trio가 NULL인 행인데도 커밋 SHA를 현재 에폭 체인에서 재해석해 서수 4가 선다 (DEV-149).
    expect(body.to_release).toEqual({ tag_name: 'deadbeefcafe', merge_seq: 4 });
    expect(body.range?.to_seq).toBe(4);
  });

  it('다른 브랜치 릴리스는 400 SEQUENCE_SPACE_MISMATCH다 (AC-3, QA-W005-03)', async () => {
    const { status, body } = await compare({ from: 'v-dev', to: 'v1.0' });
    expect(status).toBe(400);
    expect(body.error?.code).toBe('SEQUENCE_SPACE_MISMATCH');
    expect(body.error?.detail?.['release_base_branch']).toBe('develop');
  });

  it('체인 밖 태그는 400 ANCHOR_NOT_ON_BRANCH다 — 머지 커밋 제안 경로가 선다', async () => {
    searchHits = []; // 제안을 찾지 못한 경우 — 실패는 그대로, 제안만 없다.
    const { status, body } = await compare({ from: 'off-chain-tag', to: 'v1.0' });
    expect(status).toBe(400);
    expect(body.error?.code).toBe('ANCHOR_NOT_ON_BRANCH');
  });

  it('**없는 태그는 404 RELEASE_NOT_INDEXED, reason=tag_not_found다** — 릴리스 자체를 지목했다', async () => {
    const { status, body } = await compare({ from: 'v9.9', to: 'v1.0' });
    expect(status).toBe(404);
    expect(body.error?.code).toBe('RELEASE_NOT_INDEXED');
    expect(body.error?.detail?.['reason']).toBe('tag_not_found');
    // 앵커 표현이 아니므로 형식 안내를 싣지 않는다.
    expect(body.error?.detail?.['supported_formats']).toBeUndefined();
    expect(body.error?.detail?.['registration_status_path']).toBeUndefined();
  });

  it('**미수집 저장소는 reason=release_not_indexed + 저장소 개요 경로다** (QA-W005-05)', async () => {
    const { status, body } = await compare(
      { repository: 'acme/ledger', from: 'v1.0', to: 'v1.1' },
    );
    expect(status).toBe(404);
    expect(body.error?.code).toBe('RELEASE_NOT_INDEXED');
    expect(body.error?.detail?.['reason']).toBe('release_not_indexed');
    expect(body.error?.detail?.['registration_status_path']).toBe('/repositories');
  });
});

describe('미배포 구간 (FR-SEQ-004 AC-5, QA-W005-04)', () => {
  it("`to=unreleased`는 마지막 릴리스 이후 head까지다 — 끝 서수가 head 서수다", async () => {
    msearchPlan = {
      total: 1,
      sources: [{ pr_number: 43, title: '정산 재시도', author: 'kim', merged_at: '2026-08-13T00:10:00Z', changed_files_count: 2, additions: 12, deletions: 3 }],
    };
    const { status, body } = await compare({ from: 'v1.1', to: 'unreleased' });
    expect(status).toBe(200);
    expect(body.to_release).toEqual({ tag_name: 'unreleased', merge_seq: 4 });
    expect(body.range).toEqual({ from_seq: 3, to_seq: 4, boundary: '(from, to]' });
    expect(body.normalized_direction).toBe('from=v1.1(seq 3) → to=unreleased(seq 4)');
    expect(body.summary?.['pull_request_count']).toBe(1);
  });
});

describe('경계와 통제', () => {
  it('from이 비면 400 INVALID_PARAMETER다 — `to=unreleased`여도 from은 필수다 (DEV-157)', async () => {
    const { status, body } = await compare({ to: 'unreleased' });
    expect(status).toBe(400);
    expect(body.error?.code).toBe('INVALID_PARAMETER');
    expect(body.error?.detail?.['field']).toBe('from');
  });

  it('범위 밖 저장소는 404다 — 존재를 흘리지 않는다 (THR-004)', async () => {
    const { status, body } = await compare({ repository: 'other/secret', from: 'a', to: 'b' });
    expect(status).toBe(404);
    expect(body.error?.code).toBe('NOT_FOUND');
  });

  it('세션이 없으면 401이다', async () => {
    const { status } = await compare({ from: 'v1.0', to: 'v1.1' }, false);
    expect(status).toBe(401);
  });
});
