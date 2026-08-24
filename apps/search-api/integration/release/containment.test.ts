/**
 * `GET /containments` + 릴리스 앵커 — 실제 PostgreSQL + Redis (WP-024 / API-REL-002, FR-REL-002).
 *
 * ## 왜 Elasticsearch 없이 도는가
 *
 * 포함 판정의 정본은 PostgreSQL이다 (CR-028, DEV-142): 대상의 서수는
 * `merge_sequence`, 릴리스는 `release`, 포함은 `target.merge_seq <=
 * release.merge_seq` 정수 비교 하나다. 그래서 이 파일의 Elasticsearch는
 * **부르면 던지는 대역**이고, 그 셋업 자체가 단언이다 — 색인 없이 답해야 할
 * 경로가 색인을 부르면 시험이 실패한다.
 *
 * 색인이 필요한 단 하나의 경로(체인 밖 커밋 → 소속 PR, AC-1)만 `esHits`를
 * 채워 답을 준다. 그 질의가 진짜 색인에서 맞는 문서를 고르는지는 CI의
 * 실-ES 계층(`release/containment-es.test.ts`)이 본다.
 *
 * 실행: `pnpm test:integration release/containment`
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
import { CONTAINMENT_PATH, SEQUENCE_ANCHOR_PATH } from '../../src/sequence/routes.js';
import type { AuthContext, AuthRedis } from '../../src/auth/context.js';
import { createTestRedis, migratedPool } from '../helpers.js';

const AUTH_CONFIG = {
  enabled: true,
  cookieSecure: true,
  loginPath: '/auth/login',
  groupRoleMap: new Map<string, never>(),
} as const;

const USER = 'sub-containment';
const PAYMENTS = 2101;
/** 채번은 됐지만 릴리스가 하나도 수집되지 않은 저장소 — `release_not_indexed`의 근거. */
const NORELEASE = 2102;
/** 재채번으로 에폭이 앞서간 저장소 — 이전 에폭 서수는 판정 기준이 아니다 (DEV-149). */
const EPOCH = 2103;
/** 릴리스가 **체인 밖 태그뿐**인 저장소 — 미배포 판정의 대기-수 기준이 0이 된다. */
const OFFCHAIN_ONLY = 2104;
const HIDDEN = 2900;
const ORG = 1;
const BRANCH = 'main';

/** 서수 1~4. 1은 직접 푸시(PR 없음), 2·3·4는 PR 41·42·43의 머지 커밋. */
const COMMITS = [
  { seq: 1, sha: `${'1'.repeat(40)}`, pr: null, at: '2026-08-10T00:00:00Z' },
  { seq: 2, sha: `${'2'.repeat(40)}`, pr: 41, at: '2026-08-11T00:00:00Z' },
  { seq: 3, sha: `${'3'.repeat(40)}`, pr: 42, at: '2026-08-12T00:00:00Z' },
  { seq: 4, sha: `${'4'.repeat(40)}`, pr: 43, at: '2026-08-13T00:00:00Z' },
] as const;

/** 어느 체인에도 없는 SHA들. */
const OFF_CHAIN_SHA = `${'f'.repeat(40)}`;
const DEV_BRANCH_SHA = `${'d'.repeat(40)}`;
const SOURCE_COMMIT_SHA = `feed${'0'.repeat(36)}`;

let pool: Pool;
let redis: Redis;
let app: FastifyInstance;
let sessionId: string;
/** 대역 ES가 받은 search 호출의 원문 — 라우팅·강제 필터가 실렸는지 본다. */
let esRequests: Record<string, unknown>[];
/** `null`이면 부르는 순간 던진다 — "이 경로는 색인을 부르지 않는다"의 단언. */
let esHits: { _source: Record<string, unknown> }[] | null;

interface ContainmentBody {
  readonly target?: { kind: string; repository: string; id: string };
  readonly merge_commit_sha?: string | null;
  readonly merge_seq?: number | null;
  readonly base_branch?: string;
  readonly pull_request_number?: number;
  readonly releases?: {
    tag_name: string;
    released_at: string;
    base_branch: string;
    merge_seq: number;
    source: string;
  }[];
  readonly unreleased?: boolean;
  readonly pending_pull_request_count?: number;
  readonly hint?: string;
  readonly reason?: string;
  readonly error?: { code: string; message: string; detail?: Record<string, unknown> };
  readonly correlation_id: string;
}

async function getContainment(
  params: Record<string, string>,
  withSession = true,
): Promise<{ status: number; body: ContainmentBody }> {
  const query = new URLSearchParams({ repository: 'acme/payments', ...params }).toString();
  const response = await app.inject({
    method: 'GET',
    url: `${CONTAINMENT_PATH}?${query}`,
    ...(withSession ? { headers: { cookie: `${SESSION_COOKIE_NAME}=${sessionId}` } } : {}),
  });
  return { status: response.statusCode, body: response.json<ContainmentBody>() };
}

interface AnchorBody {
  readonly resolved?: { kind: string; merge_seq: number; commit_sha: string; occurred_at: string }[];
  readonly error?: { code: string; message: string; detail?: Record<string, unknown> };
}

async function resolveAnchor(
  expression: string,
  repository = 'acme/payments',
): Promise<{ status: number; body: AnchorBody }> {
  const response = await app.inject({
    method: 'POST',
    url: SEQUENCE_ANCHOR_PATH,
    headers: { cookie: `${SESSION_COOKIE_NAME}=${sessionId}` },
    payload: { repository, base_branch: BRANCH, anchors: [{ position: 'to', expression }] },
  });
  return { status: response.statusCode, body: response.json<AnchorBody>() };
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

  await authRepo.upsertUserOnLogin(pool, { user_id: USER, login: 'kim', github_user_id: 7102 });
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
  await sequenceSpaceRepo.advanceHead(pool, PAYMENTS, BRANCH, COMMITS[3].sha, 4);

  /*
   * 릴리스 다섯: 체인 위 둘(v1.0=서수 2, v1.1=서수 3), 체인 밖 하나(NULL 셋),
   * **커밋은 체인 위인데 저장 서수가 NULL인 하나**(동기화가 채번보다 먼저 돈
   * 상황 — 앵커가 표의 서수가 아니라 현재 에폭 체인에서 다시 찾는다는 DEV-149의
   * 증거), 그리고 다른 브랜치 것 하나(공간 불일치의 근거).
   */
  const seed: Parameters<typeof releaseRepo.upsertRelease>[1][] = [
    { repository_id: PAYMENTS, tag_name: 'v-dev', commit_sha: DEV_BRANCH_SHA, base_branch: 'develop', seq_epoch: 1, merge_seq: 1, released_at: new Date('2026-08-13T09:00:00Z'), source: 'git_tag' },
    { repository_id: PAYMENTS, tag_name: 'v1.0', commit_sha: COMMITS[1].sha, base_branch: BRANCH, seq_epoch: 1, merge_seq: 2, released_at: new Date('2026-08-14T09:00:00Z'), source: 'git_tag' },
    { repository_id: PAYMENTS, tag_name: 'v1.1', commit_sha: COMMITS[2].sha, base_branch: BRANCH, seq_epoch: 1, merge_seq: 3, released_at: new Date('2026-08-15T09:00:00Z'), source: 'git_tag' },
    { repository_id: PAYMENTS, tag_name: 'off-chain-tag', commit_sha: OFF_CHAIN_SHA, base_branch: null, seq_epoch: null, merge_seq: null, released_at: new Date('2026-08-16T09:00:00Z'), source: 'git_tag' },
    { repository_id: PAYMENTS, tag_name: 'resynced-later', commit_sha: COMMITS[3].sha, base_branch: null, seq_epoch: null, merge_seq: null, released_at: new Date('2026-08-17T09:00:00Z'), source: 'git_tag' },
  ];
  for (const release of seed) await releaseRepo.upsertRelease(pool, release);

  // NORELEASE: 채번은 있으나 릴리스가 0건.
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

  // EPOCH: 공간은 에폭 2로 갔는데 서수 행은 에폭 1에 남았다 (재채번 진행 중의 모습).
  await sequenceSpaceRepo.ensureSequenceSpace(pool, EPOCH, BRANCH);
  await mergeSequenceRepo.upsertMergeSequence(pool, {
    repository_id: EPOCH,
    base_branch: BRANCH,
    seq_epoch: 1,
    merge_seq: 1,
    commit_sha: `${'6'.repeat(40)}`,
    pull_request_number: 61,
    committed_at: new Date('2026-08-10T00:00:00Z'),
  });
  await pool.query('UPDATE sequence_space SET seq_epoch = 2 WHERE repository_id = $1', [EPOCH]);

  // OFFCHAIN_ONLY: 릴리스는 있으나 전부 체인 밖 — 미배포 판정의 기준 서수가 없다.
  await sequenceSpaceRepo.ensureSequenceSpace(pool, OFFCHAIN_ONLY, BRANCH);
  await mergeSequenceRepo.upsertMergeSequence(pool, {
    repository_id: OFFCHAIN_ONLY,
    base_branch: BRANCH,
    seq_epoch: 1,
    merge_seq: 1,
    commit_sha: `${'7'.repeat(40)}`,
    pull_request_number: 71,
    committed_at: new Date('2026-08-10T00:00:00Z'),
  });
  await releaseRepo.upsertRelease(pool, {
    repository_id: OFFCHAIN_ONLY,
    tag_name: 'nightly-tarball',
    commit_sha: `${'8'.repeat(40)}`,
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

  const es = {
    search: (request: Record<string, unknown>) => {
      esRequests.push(request);
      if (esHits === null) throw new Error('이 경로는 Elasticsearch를 부르지 않아야 한다');
      return Promise.resolve({
        hits: { total: { value: esHits.length, relation: 'eq' }, hits: esHits },
      });
    },
    msearch: () => {
      throw new Error('포함 판정은 msearch를 쓰지 않는다');
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
  esRequests = [];
  esHits = null;
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
  // 릴리스 행을 남기면 `sequence/anchors`의 미수집 판정이 어긋난다 — 이 스위트가 지운다.
  await pool?.query('DELETE FROM release');
  await app?.close();
  await redis?.quit();
  await pool?.end();
});

describe('PR 기준 포함 판정 (API-REL-002 AC-2·AC-5)', () => {
  it('**서수 비교 하나로 포함 릴리스가 나온다** — 색인은 부르지 않는다 (DEV-142)', async () => {
    const { status, body } = await getContainment({ kind: 'pull_request', id: '41' });
    expect(status).toBe(200);
    expect(body.merge_seq).toBe(2);
    expect(body.merge_commit_sha).toBe(COMMITS[1].sha);
    expect(body.base_branch).toBe(BRANCH);
    // 서수 2 <= 릴리스 서수인 것: v1.0(2), v1.1(3). 시각 오름차순 (AC-3).
    expect(body.releases?.map((release) => release.tag_name)).toEqual(['v1.0', 'v1.1']);
    expect(body.releases?.[0]).toEqual({
      tag_name: 'v1.0',
      released_at: '2026-08-14T09:00:00.000Z',
      base_branch: BRANCH,
      merge_seq: 2,
      source: 'git_tag',
    });
    expect(body.unreleased).toBe(false);
    expect(body).not.toHaveProperty('reason');
    expect(body).not.toHaveProperty('hint');
    expect(esRequests).toHaveLength(0);
  });

  it('경계는 `<=`다 — 릴리스 직후 서수는 그 릴리스에 포함되지 않는다', async () => {
    // PR 42(서수 3)는 v1.0(서수 2)에는 없고 v1.1(서수 3)에는 있다.
    const { body } = await getContainment({ kind: 'pull_request', id: '42' });
    expect(body.releases?.map((release) => release.tag_name)).toEqual(['v1.1']);
  });

  it('**미배포는 "판정했고 없음"이다** — 대기 수와 안내가 붙는다 (AC-4, QA-W002-09)', async () => {
    // PR 43(서수 4)은 마지막 릴리스 v1.1(서수 3)보다 뒤다.
    const { status, body } = await getContainment({ kind: 'pull_request', id: '43' });
    expect(status).toBe(200);
    expect(body.releases).toEqual([]);
    expect(body.unreleased).toBe(true);
    expect(body.pending_pull_request_count).toBe(1);
    expect(body.hint).toContain('1건');
    expect(body).not.toHaveProperty('reason');
    expect(esRequests).toHaveLength(0);
  });

  it('**미머지 PR은 미배포가 아니라 판정 불가다** (DEV-146)', async () => {
    const { status, body } = await getContainment({ kind: 'pull_request', id: '999' });
    expect(status).toBe(200);
    expect(body.merge_seq).toBeNull();
    expect(body.unreleased).toBe(false);
    expect(body.reason).toBe('target_not_sequenced');
    expect(esRequests).toHaveLength(0);
  });

  it('**릴리스 미수집 저장소도 미배포가 아니다** — 판정 자체가 성립하지 않았다 (DEV-146)', async () => {
    const { status, body } = await getContainment({
      repository: 'acme/ledger',
      kind: 'pull_request',
      id: '51',
    });
    expect(status).toBe(200);
    // 서수는 안다 — 모르는 것은 릴리스 쪽이다.
    expect(body.merge_seq).toBe(1);
    expect(body.releases).toEqual([]);
    expect(body.unreleased).toBe(false);
    expect(body.reason).toBe('release_not_indexed');
  });

  it('**이전 에폭 서수로는 판정하지 않는다** (DEV-149, FR-SEQ-005의 원칙)', async () => {
    const { status, body } = await getContainment({
      repository: 'acme/risk',
      kind: 'pull_request',
      id: '61',
    });
    expect(status).toBe(200);
    expect(body.merge_seq).toBeNull();
    expect(body.reason).toBe('target_not_sequenced');
  });

  it('릴리스가 **체인 밖 태그뿐**이면 미배포이고, 대기 수의 기준은 0이다 (AC-4)', async () => {
    /*
     * 릴리스가 있으므로 미수집이 아니고(판정은 성립), 체인 위 릴리스가 없으므로
     * "마지막 릴리스 서수"가 없다 — 그때 기준은 0이어야 채번된 모든 PR이
     * 대기로 잡힌다. 기준이 대상 서수로 새면 대기 수가 조용히 0이 된다.
     */
    const { status, body } = await getContainment({
      repository: 'acme/infra',
      kind: 'pull_request',
      id: '71',
    });
    expect(status).toBe(200);
    expect(body.merge_seq).toBe(1);
    expect(body.releases).toEqual([]);
    expect(body.unreleased).toBe(true);
    expect(body).not.toHaveProperty('reason');
    expect(body.pending_pull_request_count).toBe(1);
  });
});

describe('커밋 기준 포함 판정 (API-REL-002 AC-1)', () => {
  it('체인 위 커밋은 자기 서수로 판정한다 — 직접 푸시라 PR이 없어도 된다', async () => {
    const { status, body } = await getContainment({ kind: 'commit', id: COMMITS[0].sha });
    expect(status).toBe(200);
    expect(body.merge_seq).toBe(1);
    expect(body.releases?.map((release) => release.tag_name)).toEqual(['v1.0', 'v1.1']);
    expect(body).not.toHaveProperty('pull_request_number');
    expect(esRequests).toHaveLength(0);
  });

  it('**체인 밖 커밋은 소속 PR의 머지 서수로 판정한다** — 유일한 색인 경로다', async () => {
    esHits = [{ _source: { pull_request_numbers: [41] } }];
    const { status, body } = await getContainment({ kind: 'commit', id: SOURCE_COMMIT_SHA });
    expect(status).toBe(200);
    expect(body.pull_request_number).toBe(41);
    // 판정 근거는 머지 커밋이다 — 조회한 원본 커밋이 아니라.
    expect(body.merge_commit_sha).toBe(COMMITS[1].sha);
    expect(body.merge_seq).toBe(2);
    expect(body.releases?.map((release) => release.tag_name)).toEqual(['v1.0', 'v1.1']);
    expect(body.target?.id).toBe(SOURCE_COMMIT_SHA);

    // 색인 호출의 wire 검증 (DEV-141의 교훈): 라우팅과 강제 범위 필터가 실려야 한다.
    expect(esRequests).toHaveLength(1);
    expect(esRequests[0]?.['routing']).toBe(String(PAYMENTS));
    expect(String(esRequests[0]?.['index'])).toContain('commits');
    // 강제 필터가 접근 가능한 저장소 목록으로 좁힌다 — 밖 계층 filter에 실린다.
    expect(JSON.stringify(esRequests[0]?.['query'])).toContain(
      `"terms":{"repository_id":[${String(PAYMENTS)},${String(NORELEASE)},${String(EPOCH)},${String(OFFCHAIN_ONLY)}]}`,
    );
  });

  it('색인이 커밋을 모르면 404다 — 없는 대상에 빈 판정을 지어내지 않는다', async () => {
    esHits = [];
    const { status, body } = await getContainment({ kind: 'commit', id: `${'e'.repeat(40)}` });
    expect(status).toBe(404);
    expect(body.error?.code).toBe('NOT_FOUND');
  });

  it('소속 PR이 없는 체인 밖 커밋은 판정 불가다', async () => {
    esHits = [{ _source: {} }];
    const { status, body } = await getContainment({ kind: 'commit', id: SOURCE_COMMIT_SHA });
    expect(status).toBe(200);
    expect(body.reason).toBe('target_not_sequenced');
  });

  it('대문자 40자 SHA도 소문자로 받아들인다', async () => {
    const { status, body } = await getContainment({ kind: 'commit', id: COMMITS[1].sha.toUpperCase() });
    expect(status).toBe(200);
    expect(body.merge_seq).toBe(2);
  });
});

describe('릴리스 앵커 (FR-SEQ-003 AC-1 / WP-024)', () => {
  it('**수집된 태그가 앵커로 해석되고, 시각은 릴리스 시각이다** (API-SEQ-002)', async () => {
    const { status, body } = await resolveAnchor('v1.0');
    expect(status).toBe(200);
    expect(body.resolved?.[0]).toMatchObject({ kind: 'release', merge_seq: 2, commit_sha: COMMITS[1].sha });
    // 커밋 시각(08-11)이 아니라 릴리스 시각이어야 한다.
    expect(body.resolved?.[0]?.occurred_at).toBe('2026-08-14T09:00:00.000Z');
    expect(esRequests).toHaveLength(0);
  });

  it('**표의 서수가 아니라 현재 에폭 체인에서 다시 찾는다** (DEV-149)', async () => {
    // resynced-later는 저장 서수가 NULL이지만 커밋은 서수 4다 — 그래도 해석돼야 한다.
    const { status, body } = await resolveAnchor('resynced-later');
    expect(status).toBe(200);
    expect(body.resolved?.[0]).toMatchObject({ kind: 'release', merge_seq: 4 });
    expect(esRequests).toHaveLength(0);
  });

  it('수집은 있는데 그 태그가 없으면 사유가 `tag_not_found`다 — 미수집과 갈린다', async () => {
    const { status, body } = await resolveAnchor('v9.9');
    expect(status).toBe(400);
    expect(body.error?.code).toBe('ANCHOR_UNRESOLVABLE');
    expect(body.error?.detail?.['reason']).toBe('tag_not_found');
  });

  it('릴리스가 0건인 저장소는 사유가 `release_not_indexed`다', async () => {
    const { status, body } = await resolveAnchor('v1.0', 'acme/ledger');
    expect(status).toBe(400);
    expect(body.error?.code).toBe('ANCHOR_UNRESOLVABLE');
    expect(body.error?.detail?.['reason']).toBe('release_not_indexed');
  });

  it('**다른 브랜치의 릴리스는 공간 불일치다** — 브랜치를 바꾸면 된다고 말한다', async () => {
    const { status, body } = await resolveAnchor('v-dev');
    expect(status).toBe(400);
    expect(body.error?.code).toBe('SEQUENCE_SPACE_MISMATCH');
    expect(body.error?.detail?.['release_base_branch']).toBe('develop');
    expect(esRequests).toHaveLength(0);
  });

  it('체인 밖 커밋을 가리키는 태그는 `ANCHOR_NOT_ON_BRANCH`다', async () => {
    esHits = []; // 머지 커밋 제안 조회가 빈손으로 돌아오는 경우다.
    const { status, body } = await resolveAnchor('off-chain-tag');
    expect(status).toBe(400);
    expect(body.error?.code).toBe('ANCHOR_NOT_ON_BRANCH');
    expect(body.error?.detail).not.toHaveProperty('suggested_anchor');
  });
});

describe('입력 검증과 접근 통제 (ADR-008)', () => {
  it('kind가 목록 밖이면 400이다', async () => {
    const { status, body } = await getContainment({ kind: 'branch', id: '1' });
    expect(status).toBe(400);
    expect(body.error?.code).toBe('INVALID_PARAMETER');
  });

  it('PR 번호가 정수가 아니면 400이다', async () => {
    expect((await getContainment({ kind: 'pull_request', id: 'abc' })).status).toBe(400);
    expect((await getContainment({ kind: 'pull_request', id: '0' })).status).toBe(400);
  });

  it('**커밋은 40자 전체 SHA만 받는다** — 축약 해석은 `/resolve`의 몫이다 (ADR-012)', async () => {
    const { status, body } = await getContainment({ kind: 'commit', id: COMMITS[1].sha.slice(0, 12) });
    expect(status).toBe(400);
    expect(body.error?.code).toBe('INVALID_PARAMETER');
    expect(esRequests).toHaveLength(0);
  });

  it('접근 범위 밖 저장소는 404다 — 403이면 존재가 알려진다', async () => {
    const { status, body } = await getContainment({
      repository: 'other/secret',
      kind: 'pull_request',
      id: '1',
    });
    expect(status).toBe(404);
    expect(body.error?.code).toBe('NOT_FOUND');
  });

  it('등록되지 않은 저장소도 같은 404다', async () => {
    expect((await getContainment({ repository: 'acme/none', kind: 'pull_request', id: '1' })).status).toBe(404);
  });

  it('세션이 없으면 401이다', async () => {
    expect((await getContainment({ kind: 'pull_request', id: '41' }, false)).status).toBe(401);
  });
});
