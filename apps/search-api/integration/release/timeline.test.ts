/**
 * `GET /releases` — 실제 PostgreSQL + Redis (WP-026 / API-REL-005, CR-030 DEV-155).
 *
 * ## 이 파일이 지키는 경계
 *
 * - **"직전 릴리스 대비 PR 수"는 실제 PR 행 수다** (QA-W005-06): 직접 푸시
 *   커밋이 섞인 구간에서 서수 차이와 다른 값이 나와야 한다 — 서수 차이를
 *   내면 이 시험이 잡는다.
 * - **정렬은 서수 내림차순 고정이다** (DEV-159), "직전"은 서수 선행 릴리스다.
 * - **미수집(200+사유)과 이 브랜치에 없음(빈 목록)을 가른다** (DEV-146).
 * - **현재 에폭의 행만 싣는다** (DEV-149).
 *
 * Elasticsearch 대역은 **부르면 던진다** — 이 API는 색인을 전혀 읽지 않는다
 * (정본 PostgreSQL, DEV-142·130). 그 셋업 자체가 단언이다.
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
import { RELEASES_PATH } from '../../src/sequence/routes.js';
import type { AuthContext, AuthRedis } from '../../src/auth/context.js';
import { createTestRedis, migratedPool } from '../helpers.js';

const AUTH_CONFIG = {
  enabled: true,
  cookieSecure: true,
  loginPath: '/auth/login',
  groupRoleMap: new Map<string, never>(),
} as const;

const USER = 'sub-timeline';
const PAYMENTS = 2101;
const NORELEASE = 2102;
/** 재채번으로 에폭이 앞서간 저장소 — 이전 에폭 릴리스는 목록에 없다 (DEV-149). */
const EPOCH = 2103;
/** 릴리스가 전부 체인 밖 — "수집은 됐으나 이 브랜치에 없음"의 근거. */
const OFFCHAIN_ONLY = 2104;
const HIDDEN = 2900;
const ORG = 1;
const BRANCH = 'main';

/**
 * 서수 1~6. 1·4는 직접 푸시(PR 없음) — v1.0 구간(0,2]의 PR은 1건(서수 차 2),
 * v1.1 구간(2,5]의 PR은 2건(서수 차 3)이다. **서수 차이를 세면 두 릴리스 다
 * 틀린다** (QA-W005-06).
 */
const COMMITS = [
  { seq: 1, sha: `${'1'.repeat(40)}`, pr: null, at: '2026-08-10T00:00:00Z' },
  { seq: 2, sha: `${'2'.repeat(40)}`, pr: 41, at: '2026-08-11T00:00:00Z' },
  { seq: 3, sha: `${'3'.repeat(40)}`, pr: 42, at: '2026-08-12T00:00:00Z' },
  { seq: 4, sha: `${'4'.repeat(40)}`, pr: null, at: '2026-08-12T12:00:00Z' },
  { seq: 5, sha: `${'5'.repeat(40)}`, pr: 43, at: '2026-08-13T00:00:00Z' },
  { seq: 6, sha: `${'6'.repeat(40)}`, pr: 44, at: '2026-08-14T00:00:00Z' },
] as const;

let pool: Pool;
let redis: Redis;
let app: FastifyInstance;
let sessionId: string;

interface TimelineBody {
  readonly sequence_space?: string;
  readonly seq_epoch?: number;
  readonly sequence_state?: string;
  readonly releases?: {
    tag_name: string;
    released_at: string;
    commit_sha: string;
    merge_seq: number;
    source: string;
    previous_tag_name: string | null;
    pull_request_count: number;
  }[];
  readonly unreleased?: {
    last_release_tag: string;
    head_seq: number;
    head_commit_sha: string | null;
    pending_pull_request_count: number;
  };
  readonly reason?: string;
  readonly registration_status_path?: string;
  readonly error?: { code: string; message: string };
  readonly correlation_id: string;
}

async function listReleases(
  params: Record<string, string> = {},
  withSession = true,
): Promise<{ status: number; body: TimelineBody }> {
  const query = new URLSearchParams({
    repository: 'acme/payments',
    base_branch: BRANCH,
    ...params,
  }).toString();
  const response = await app.inject({
    method: 'GET',
    url: `${RELEASES_PATH}?${query}`,
    ...(withSession ? { headers: { cookie: `${SESSION_COOKIE_NAME}=${sessionId}` } } : {}),
  });
  return { status: response.statusCode, body: response.json<TimelineBody>() };
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

  await authRepo.upsertUserOnLogin(pool, { user_id: USER, login: 'kim', github_user_id: 7104 });
  for (const [id, owner, name, org] of [
    [PAYMENTS, 'acme', 'payments', ORG],
    [NORELEASE, 'acme', 'ledger', ORG],
    [EPOCH, 'acme', 'risk', ORG],
    [OFFCHAIN_ONLY, 'acme', 'infra', ORG],
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
  await sequenceSpaceRepo.advanceHead(pool, PAYMENTS, BRANCH, COMMITS[5].sha, 6);

  /*
   * 릴리스 셋 + 같은 커밋의 태그 하나:
   * - v1.0 = 서수 2 (구간 (0,2], PR 1건 — 첫 릴리스, 히스토리 시작부터)
   * - v1.1 = 서수 5 (구간 (2,5], PR 2건 — 직접 푸시 서수 4는 세지 않는다)
   * - v1.1-hotfix = 같은 서수 5 (구간 (5,5] — 0건. 태그 이름 오름차순이 순서를 정한다)
   * - 체인 밖 태그와 다른 브랜치 태그는 이 공간의 타임라인에 없다.
   */
  const seed: Parameters<typeof releaseRepo.upsertRelease>[1][] = [
    { repository_id: PAYMENTS, tag_name: 'v1.0', commit_sha: COMMITS[1].sha, base_branch: BRANCH, seq_epoch: 1, merge_seq: 2, released_at: new Date('2026-08-14T09:00:00Z'), source: 'git_tag' },
    { repository_id: PAYMENTS, tag_name: 'v1.1', commit_sha: COMMITS[4].sha, base_branch: BRANCH, seq_epoch: 1, merge_seq: 5, released_at: new Date('2026-08-15T09:00:00Z'), source: 'git_tag' },
    { repository_id: PAYMENTS, tag_name: 'v1.1-hotfix', commit_sha: COMMITS[4].sha, base_branch: BRANCH, seq_epoch: 1, merge_seq: 5, released_at: new Date('2026-08-15T10:00:00Z'), source: 'git_tag' },
    { repository_id: PAYMENTS, tag_name: 'off-chain-tag', commit_sha: `${'f'.repeat(40)}`, base_branch: null, seq_epoch: null, merge_seq: null, released_at: new Date('2026-08-16T09:00:00Z'), source: 'git_tag' },
    { repository_id: PAYMENTS, tag_name: 'v-dev', commit_sha: `${'d'.repeat(40)}`, base_branch: 'develop', seq_epoch: 1, merge_seq: 1, released_at: new Date('2026-08-13T09:00:00Z'), source: 'git_tag' },
  ];
  for (const release of seed) await releaseRepo.upsertRelease(pool, release);

  // NORELEASE: 채번은 있으나 릴리스 0건.
  await sequenceSpaceRepo.ensureSequenceSpace(pool, NORELEASE, BRANCH);
  await mergeSequenceRepo.upsertMergeSequence(pool, {
    repository_id: NORELEASE,
    base_branch: BRANCH,
    seq_epoch: 1,
    merge_seq: 1,
    commit_sha: `${'7'.repeat(40)}`,
    pull_request_number: 51,
    committed_at: new Date('2026-08-10T00:00:00Z'),
  });

  // EPOCH: 릴리스는 에폭 1에 있는데 공간은 에폭 2로 갔다 — 목록은 비어야 한다.
  await sequenceSpaceRepo.ensureSequenceSpace(pool, EPOCH, BRANCH);
  await releaseRepo.upsertRelease(pool, {
    repository_id: EPOCH,
    tag_name: 'stale-epoch',
    commit_sha: `${'8'.repeat(40)}`,
    base_branch: BRANCH,
    seq_epoch: 1,
    merge_seq: 1,
    released_at: new Date('2026-08-13T09:00:00Z'),
    source: 'git_tag',
  });
  await pool.query('UPDATE sequence_space SET seq_epoch = 2 WHERE repository_id = $1', [EPOCH]);

  // OFFCHAIN_ONLY: 릴리스는 있으나 전부 체인 밖 — "이 브랜치에 없음"이지 미수집이 아니다.
  await sequenceSpaceRepo.ensureSequenceSpace(pool, OFFCHAIN_ONLY, BRANCH);
  await releaseRepo.upsertRelease(pool, {
    repository_id: OFFCHAIN_ONLY,
    tag_name: 'nightly-tarball',
    commit_sha: `${'9'.repeat(40)}`,
    base_branch: null,
    seq_epoch: null,
    merge_seq: null,
    released_at: new Date('2026-08-18T09:00:00Z'),
    source: 'git_tag',
  });

  const redisPort: AuthRedis = {
    get: (key) => redis.get(key),
    set: (key, value, mode, seconds) => redis.set(key, value, mode, seconds),
    del: (...keys) => redis.del(...keys),
    scan: (cursor, m, pattern, c, n) => redis.scan(cursor, m, pattern, c, n),
  };

  const source: AccessScopeSource = {
    fetch: async () => ({
      repositoryIds: [PAYMENTS, NORELEASE, EPOCH, OFFCHAIN_ONLY],
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

  // 이 API는 색인을 전혀 읽지 않는다 (DEV-142) — 부르면 시험이 실패한다.
  const es = {
    search: () => {
      throw new Error('릴리스 타임라인은 Elasticsearch를 부르지 않는다');
    },
    msearch: () => {
      throw new Error('릴리스 타임라인은 msearch를 부르지 않는다');
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
  await pool.query('DELETE FROM release');
  await pool.end();
  await redis.quit();
});

describe('타임라인 (QA-W005-06, DEV-159)', () => {
  it('**PR 수는 서수 차이가 아니라 실제 PR 행 수다** — 직접 푸시가 섞이면 두 값이 다르다', async () => {
    const { status, body } = await listReleases();
    expect(status).toBe(200);
    const byTag = new Map((body.releases ?? []).map((release) => [release.tag_name, release]));
    // v1.1 구간 (2,5]: 서수 차 3, PR은 42·43 둘뿐 (서수 4는 직접 푸시).
    expect(byTag.get('v1.1')?.pull_request_count).toBe(2);
    // v1.0 구간 (0,2]: 서수 차 2, PR은 41 하나뿐 (서수 1은 직접 푸시). 첫 릴리스 = 히스토리 시작부터.
    expect(byTag.get('v1.0')?.pull_request_count).toBe(1);
    expect(byTag.get('v1.0')?.previous_tag_name).toBeNull();
  });

  it('**서수 내림차순 고정이다** — 같은 서수는 태그 이름이 순서를 정하고 뒤 태그 구간은 0건이다', async () => {
    const { body } = await listReleases();
    expect((body.releases ?? []).map((release) => release.tag_name)).toEqual([
      'v1.1-hotfix',
      'v1.1',
      'v1.0',
    ]);
    const hotfix = body.releases?.find((release) => release.tag_name === 'v1.1-hotfix');
    // 같은 커밋의 두 번째 태그 — 구간 (5,5]은 비어 있다.
    expect(hotfix?.previous_tag_name).toBe('v1.1');
    expect(hotfix?.pull_request_count).toBe(0);
  });

  it('체인 밖·다른 브랜치 태그는 이 공간의 타임라인에 없다', async () => {
    const { body } = await listReleases();
    const tags = (body.releases ?? []).map((release) => release.tag_name);
    expect(tags).not.toContain('off-chain-tag');
    expect(tags).not.toContain('v-dev');
  });

  it('미배포 블록: 마지막 릴리스 이후 head까지의 실제 PR 수다 (FR-REL-002 AC-4)', async () => {
    const { body } = await listReleases();
    expect(body.unreleased).toEqual({
      last_release_tag: 'v1.1-hotfix',
      head_seq: 6,
      head_commit_sha: COMMITS[5].sha,
      pending_pull_request_count: 1,
    });
  });
});

describe('미수집과 없음을 가른다 (DEV-146·149)', () => {
  it('**미수집 저장소는 200 + 빈 목록 + 사유 + 저장소 개요 경로다** (QA-W005-05)', async () => {
    const { status, body } = await listReleases({ repository: 'acme/ledger' });
    expect(status).toBe(200);
    expect(body.releases).toEqual([]);
    expect(body.reason).toBe('release_not_indexed');
    expect(body.registration_status_path).toBe('/repositories');
    expect(body.unreleased).toBeUndefined();
  });

  it('수집은 됐으나 이 브랜치에 없으면 사유 없는 빈 목록이다 — `empty_no_release`의 근거', async () => {
    const { status, body } = await listReleases({ repository: 'acme/infra' });
    expect(status).toBe(200);
    expect(body.releases).toEqual([]);
    expect(body.reason).toBeUndefined();
    expect(body.unreleased).toBeUndefined();
  });

  it('**이전 에폭의 릴리스는 싣지 않는다** (DEV-149) — 재해석 전의 서수는 다른 커밋일 수 있다', async () => {
    const { status, body } = await listReleases({ repository: 'acme/risk' });
    expect(status).toBe(200);
    expect(body.seq_epoch).toBe(2);
    expect(body.releases).toEqual([]);
    // 릴리스 행 자체는 있으므로 미수집이 아니다 — 사유를 지어내지 않는다.
    expect(body.reason).toBeUndefined();
  });
});

describe('통제 (ADR-008, THR-004)', () => {
  it('범위 밖 저장소는 404다 — 존재를 흘리지 않는다', async () => {
    const { status, body } = await listReleases({ repository: 'other/secret' });
    expect(status).toBe(404);
    expect(body.error?.code).toBe('NOT_FOUND');
  });

  it('채번된 적 없는 브랜치는 404다 (DEV-137과 같은 자세)', async () => {
    const { status } = await listReleases({ base_branch: 'nope' });
    expect(status).toBe(404);
  });

  it('세션이 없으면 401이다', async () => {
    const { status } = await listReleases({}, false);
    expect(status).toBe(401);
  });
});
