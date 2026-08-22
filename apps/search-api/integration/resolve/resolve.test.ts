/**
 * `GET /resolve`, `/commits/…`, `/pull-requests/…` — 실제 Fastify + ES + PG + Redis
 * (WP-014 DoD / QA-W001-01~06, QA-W002-01~03, QA-W003-01·02·04·05).
 *
 * 판별 자체는 `@prs/query`의 단위 시험이 본다. 여기서는 그 판별이 **진짜
 * 인덱스에서 옳은 문서를 집어 오는지**를 확인한다 — 판별이 맞아도 필드 이름이
 * 하나 어긋나면 아무것도 못 찾고, 그것을 잡는 것은 실제 조회뿐이다.
 *
 * **QA-W003-03(`direct_push`)은 여기에 없다.** 직접 푸시 커밋은 커밋 문서 자체가
 * 만들어지지 않아 조회가 404가 된다 (CR-017, DEV-061). 없는 동작을 시험으로
 * 꾸며 통과시키지 않는다.
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
import { authRepo, repositoryRepo, type Pool } from '@prs/db';
import type { Redis } from '@prs/bus';
import { buildServer } from '../../src/server.js';
import { RESOLVE_PATH } from '../../src/resolve/routes.js';
import type { AuthContext, AuthRedis } from '../../src/auth/context.js';
import { createTestRedis, migratedPool } from '../helpers.js';

const GHE = 'https://ghe.acme.example';

const AUTH_CONFIG = {
  enabled: true,
  cookieSecure: true,
  loginPath: '/auth/login',
  groupRoleMap: new Map<string, never>(),
} as const;

const USER = 'sub-resolve';
const PAYMENTS = 201;
const BILLING = 202;
const HIDDEN = 901;
const ORG = 1;

/** 머지 커밋. PR #1234에 대응한다 (QA-W003-01). */
const MERGE_SHA = 'a3f9c21b4e8d7f0c1a2b3c4d5e6f708192a3b4c5';
/** 원본 커밋 (QA-W003-02). */
const SOURCE_SHA = '1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d';
/** 같은 7자 접두를 공유하는 커밋 둘. 접두 검색이 후보 2건을 내는지 본다. */
const TWIN_A = 'beef1230000000000000000000000000000000aa';
const TWIN_B = 'beef1231111111111111111111111111111111bb';
/** 커밋 하나가 PR 둘에 속하는 경우 (QA-W003-05). */
const SHARED_SHA = 'cafe0011223344556677889900aabbccddeeff01';
/**
 * **미머지 PR에만 속한 원본 커밋** (CR-021, DEV-091).
 *
 * `merge_commit_sha` 키가 **없어야** 하는 경우를 만든다. `SHARED_SHA`로는
 * 잴 수 없다 — 그것은 머지된 PR에도 속해 어느 PR이 첫 항목인지 정해지지 않는다.
 */
const OPEN_SOURCE_SHA = 'bbbb000000000000000000000000000000000001';
/** 접근 범위 밖 저장소의 커밋. 어떤 경로로도 새면 안 된다. */
const HIDDEN_SHA = 'dead000000000000000000000000000000000001';
/** 커밋 문서는 없고 PR 문서의 `head_sha`에만 있는 SHA (40자 폴백). */
const HEAD_ONLY_SHA = 'fade000000000000000000000000000000000009';
/**
 * **같은 SHA가 범위 안 저장소 둘에 있다.**
 *
 * 체리픽·리베이스 없이도 저장소를 옮겨 심으면 생긴다. 상세 조회가 경로의
 * 저장소를 실제로 보는지 확인하는 유일한 방법이다 — SHA가 한 저장소에만
 * 있으면 저장소 조건을 빼도 시험이 통과한다.
 */
const TWIN_REPO_SHA = 'facade00000000000000000000000000000000ff';
/**
 * 범위 안 저장소에 있으나 **문서의 범위 필드가 어긋난** PR.
 *
 * 저장소가 private으로 바뀌었는데 투영이 아직 따라잡지 못한 상태를 흉내낸다.
 * 커밋 → PR 조인이 강제 범위 필터를 거치는지 확인한다 — 조인이 필터를 건너뛰면
 * 커밋이 범위 안이라는 이유로 이 PR이 딸려 나온다.
 */
const SKEWED_PR = 1500;
/** 위 PR을 가리키는 커밋. 커밋 자체는 범위 안이다. */
const SKEW_SHA = 'ba5eba11000000000000000000000000000000cc';

let pool: Pool;
let redis: Redis;
let es: Client;
let app: FastifyInstance;
let sessionId: string;

interface Candidate {
  readonly kind: string;
  readonly repository: string | null;
  readonly commit_sha?: string;
  readonly pr_number?: number;
  readonly role?: string;
  readonly display_name: string | null;
  readonly url: string | null;
  readonly merge_seq: number | null;
  readonly pull_request_numbers?: number[];
}

interface ResolveBody {
  readonly input: string;
  readonly detected_kind: string;
  readonly candidates: Candidate[];
  readonly truncated: boolean;
  readonly reason_code?: string;
  readonly hint?: string;
  readonly error?: { code: string; message: string; detail?: Record<string, unknown> };
  readonly correlation_id: string;
}

interface DetailBody {
  readonly repository?: string;
  readonly commit_sha?: string;
  readonly role?: string;
  readonly pull_requests?: {
    pr_number?: number;
    title?: string;
    author?: string;
    reviewers?: string[];
    approved_by?: string[];
    state?: string;
    merged_at?: string;
    // W-003의 `no_sequence` 안내가 쓴다 (CR-021, DEV-091). 미머지면 키가 없다.
    merge_commit_sha?: string;
    url?: string;
  }[];
  readonly pr_number?: number;
  readonly title?: string;
  readonly state?: string;
  readonly merge_commit_sha?: string | null;
  readonly source_commits?: { commit_sha: string }[];
  readonly source_commits_total?: number;
  readonly source_commits_truncated?: boolean;
  readonly merge_seq?: number | null;
  readonly seq_epoch?: number | null;
  readonly sequence_space?: string | null;
  readonly reason_code?: string;
  readonly error?: { code: string; message: string };
  readonly correlation_id: string;
}

async function resolve(query: string): Promise<{ status: number; body: ResolveBody }> {
  const response = await app.inject({
    method: 'GET',
    url: `${RESOLVE_PATH}?${query}`,
    headers: { cookie: `${SESSION_COOKIE_NAME}=${sessionId}` },
  });
  return { status: response.statusCode, body: response.json<ResolveBody>() };
}

async function getPath(path: string): Promise<{ status: number; body: DetailBody }> {
  const response = await app.inject({
    method: 'GET',
    url: path,
    headers: { cookie: `${SESSION_COOKIE_NAME}=${sessionId}` },
  });
  return { status: response.statusCode, body: response.json<DetailBody>() };
}

function scope(repository: string, id: number): Record<string, unknown> {
  return { repository_id: id, repository, org_id: repository.startsWith('acme/') ? ORG : 2, visibility: 'internal', allowed_team_ids: [10] };
}

const PULL_REQUESTS = [
  {
    _id: `${String(PAYMENTS)}:1234`,
    ...scope('acme/payments', PAYMENTS),
    pr_number: 1234, title: '결제 재시도 로직', body: '지수 백오프로 3회 재시도합니다',
    state: 'merged', draft: false, author: 'kim', reviewers: ['lee', 'park'], approved_by: ['lee'],
    labels: ['payment', 'backend'], base_branch: 'main', head_branch: 'feature/retry',
    merge_commit_sha: MERGE_SHA, source_commit_shas: [SOURCE_SHA, SHARED_SHA],
    source_commits_truncated: false,
    created_at: '2026-08-18T02:00:00Z', merged_at: '2026-08-19T05:02:11Z',
    changed_files_count: 2, additions: 120, deletions: 15, document_version: 1,
  },
  {
    _id: `${String(PAYMENTS)}:1235`,
    ...scope('acme/payments', PAYMENTS),
    pr_number: 1235, title: '재시도 후속', state: 'open', draft: false, author: 'lee',
    base_branch: 'main', head_branch: 'feature/followup',
    // 미머지: `merge_commit_sha`가 없다 (QA-W002-02).
    source_commit_shas: [SHARED_SHA], source_commits_truncated: false,
    created_at: '2026-08-20T02:00:00Z', document_version: 1,
  },
  {
    _id: `${String(PAYMENTS)}:1236`,
    ...scope('acme/payments', PAYMENTS),
    // 미머지이고 이 커밋은 **이 PR에만** 속한다 (CR-021, DEV-091 시험용).
    pr_number: 1236, title: '미머지 후속', state: 'open', draft: false, author: 'park',
    base_branch: 'main', head_branch: 'feature/open',
    source_commit_shas: [OPEN_SOURCE_SHA], source_commits_truncated: false,
    created_at: '2026-08-21T02:00:00Z', document_version: 1,
  },
  {
    _id: `${String(BILLING)}:1234`,
    ...scope('acme/billing', BILLING),
    // 같은 번호가 다른 저장소에 있다 — `#1234`가 후보 2건을 내야 한다 (QA-W001-05).
    pr_number: 1234, title: '청구서 양식', state: 'open', draft: false, author: 'kim',
    base_branch: 'main', source_commit_shas: [], source_commits_truncated: false,
    created_at: '2026-08-15T02:00:00Z', document_version: 1,
  },
  {
    _id: `${String(BILLING)}:1300`,
    ...scope('acme/billing', BILLING),
    pr_number: 1300, title: '절삭 시험용', state: 'merged', author: 'kim', base_branch: 'main',
    // 250건을 넘긴다 (QA-W002-03).
    source_commit_shas: Array.from({ length: 260 }, (_, i) => `b${String(i).padStart(39, '0')}`),
    source_commits_truncated: false,
    created_at: '2026-08-10T02:00:00Z', merged_at: '2026-08-11T02:00:00Z', document_version: 1,
  },
  {
    _id: `${String(PAYMENTS)}:1400`,
    ...scope('acme/payments', PAYMENTS),
    pr_number: 1400, title: 'head만 있는 PR', state: 'open', author: 'kim', base_branch: 'main',
    head_sha: HEAD_ONLY_SHA, source_commit_shas: [], source_commits_truncated: false,
    created_at: '2026-08-21T02:00:00Z', document_version: 1,
  },
  {
    _id: `${String(PAYMENTS)}:${String(SKEWED_PR)}`,
    ...scope('acme/payments', PAYMENTS),
    // 저장소는 범위 안인데 문서의 범위 필드가 범위 밖을 가리킨다.
    visibility: 'private', allowed_team_ids: [99], org_id: 2,
    pr_number: SKEWED_PR, title: '범위가 어긋난 PR', state: 'merged', author: 'kim',
    base_branch: 'main', source_commit_shas: [], source_commits_truncated: false,
    created_at: '2026-08-05T00:00:00Z', merged_at: '2026-08-06T00:00:00Z', document_version: 1,
  },
  {
    _id: `${String(HIDDEN)}:9`,
    ...scope('other/secret', HIDDEN),
    visibility: 'private', allowed_team_ids: [99],
    pr_number: 9, title: '비밀', state: 'merged', author: 'kim', base_branch: 'main',
    merge_commit_sha: HIDDEN_SHA, source_commit_shas: [], source_commits_truncated: false,
    created_at: '2026-08-01T00:00:00Z', merged_at: '2026-08-02T00:00:00Z', document_version: 1,
  },
];

const COMMITS = [
  {
    _id: `${String(PAYMENTS)}:${MERGE_SHA}`,
    ...scope('acme/payments', PAYMENTS),
    commit_sha: MERGE_SHA, role: 'merge_commit', pull_request_numbers: [1234],
    base_branch: 'main', enrichment_pending: false,
    link_summary: { has_revert: false, is_reverted: false, has_cherry_pick: false },
    document_version: 1,
  },
  {
    _id: `${String(PAYMENTS)}:${SOURCE_SHA}`,
    ...scope('acme/payments', PAYMENTS),
    commit_sha: SOURCE_SHA, role: 'source_commit', pull_request_numbers: [1234],
    base_branch: 'main', enrichment_pending: false, document_version: 1,
  },
  {
    _id: `${String(PAYMENTS)}:${SHARED_SHA}`,
    ...scope('acme/payments', PAYMENTS),
    // 같은 커밋이 PR 둘에 속한다 (QA-W003-05).
    commit_sha: SHARED_SHA, role: 'source_commit', pull_request_numbers: [1234, 1235],
    base_branch: 'main', enrichment_pending: false, document_version: 1,
  },
  {
    _id: `${String(PAYMENTS)}:${OPEN_SOURCE_SHA}`,
    ...scope('acme/payments', PAYMENTS),
    commit_sha: OPEN_SOURCE_SHA, role: 'source_commit', pull_request_numbers: [1236],
    base_branch: 'main', enrichment_pending: false, document_version: 1,
  },
  {
    _id: `${String(PAYMENTS)}:${TWIN_A}`,
    ...scope('acme/payments', PAYMENTS),
    commit_sha: TWIN_A, role: 'source_commit', pull_request_numbers: [1234],
    base_branch: 'main', document_version: 1,
  },
  {
    _id: `${String(PAYMENTS)}:${TWIN_B}`,
    ...scope('acme/payments', PAYMENTS),
    commit_sha: TWIN_B, role: 'source_commit', pull_request_numbers: [1234],
    base_branch: 'main', document_version: 1,
  },
  {
    // 같은 SHA, 저장소 둘. 경로의 저장소가 어느 문서를 고르는지 가른다.
    _id: `${String(PAYMENTS)}:${TWIN_REPO_SHA}`,
    ...scope('acme/payments', PAYMENTS),
    commit_sha: TWIN_REPO_SHA, role: 'merge_commit', pull_request_numbers: [1234],
    base_branch: 'main', document_version: 1,
  },
  {
    _id: `${String(BILLING)}:${TWIN_REPO_SHA}`,
    ...scope('acme/billing', BILLING),
    commit_sha: TWIN_REPO_SHA, role: 'source_commit', pull_request_numbers: [1234],
    base_branch: 'release', document_version: 1,
  },
  {
    _id: `${String(PAYMENTS)}:${SKEW_SHA}`,
    ...scope('acme/payments', PAYMENTS),
    // 커밋은 범위 안이지만 가리키는 PR의 범위 필드가 어긋나 있다.
    commit_sha: SKEW_SHA, role: 'merge_commit', pull_request_numbers: [SKEWED_PR],
    base_branch: 'main', document_version: 1,
  },
  {
    _id: `${String(HIDDEN)}:${HIDDEN_SHA}`,
    ...scope('other/secret', HIDDEN),
    visibility: 'private', allowed_team_ids: [99],
    commit_sha: HIDDEN_SHA, role: 'merge_commit', pull_request_numbers: [9],
    base_branch: 'main', document_version: 1,
  },
];

beforeAll(async () => {
  pool = await migratedPool();
  redis = createTestRedis();
  es = createEsClient(resolveClientOptions());
  await applyMappings(es);

  await pool.query('DELETE FROM permission_cache');
  await pool.query('DELETE FROM team_member');
  await pool.query('DELETE FROM team');
  await pool.query('DELETE FROM app_user');
  await pool.query('DELETE FROM repository');

  await authRepo.upsertUserOnLogin(pool, { user_id: USER, login: 'kim', github_user_id: 7101 });
  await authRepo.upsertTeam(pool, { team_id: 10, slug: 'resolve-core', org_id: ORG });
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
    // 벌크는 실패해도 HTTP 200이다. 그대로 두면 빈 인덱스로 시험이 통과한다.
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
  /*
   * **이 스위트는 `org_team` 범위로 돈다** (저장소 500개 초과, WP-012 AC-6).
   *
   * `explicit` 범위는 `repository_id` 하나만 보므로, 같은 저장소 안의 문서는
   * 범위 필드가 어긋나 있어도 전부 통과한다 — 커밋 → PR 조인이 강제 필터를
   * 건너뛰어도 아무 차이가 없어 ADR-008 위반을 시험이 잡지 못한다.
   * `org_team`은 문서의 `org_id`·`visibility`·`allowed_team_ids`를 보므로 그
   * 위반이 드러난다.
   *
   * `explicit` 경로는 `search/list.test.ts`가 덮는다. 둘을 갈라 두 모드를 모두
   * 실제 조회로 확인한다.
   */
  const source: AccessScopeSource = {
    fetch: async () => ({
      repositoryIds: [PAYMENTS, BILLING, ...Array.from({ length: 600 }, (_, i) => 5000 + i)],
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
    config: {
      port: 0, adminTokens: [], metricsQueryUrl: null, auth: AUTH_CONFIG,
      gheBaseUrl: GHE,
    },
    auth,
    search: {
      es,
      resolveNames: async () => ({ orgIds: new Map(), teamIds: new Map() }),
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

describe('QA-W001-01: 40자 SHA가 커밋으로 해석된다 (FR-SRCH-001 AC-1)', () => {
  it('커밋 1건을 찾는다', async () => {
    const { status, body } = await resolve(`q=${MERGE_SHA}`);

    expect(status).toBe(200);
    expect(body.detected_kind).toBe('commit');
    expect(body.candidates).toHaveLength(1);
    expect(body.candidates[0]).toMatchObject({
      kind: 'commit',
      repository: 'acme/payments',
      commit_sha: MERGE_SHA,
      role: 'merge_commit',
    });
  });

  it('대문자로 넣어도 같은 커밋이다 (FR-SRCH-004 AC-4)', async () => {
    const { body } = await resolve(`q=${MERGE_SHA.toUpperCase()}`);
    expect(body.candidates[0]?.commit_sha).toBe(MERGE_SHA);
  });

  it('커밋 문서가 없으면 PR의 `head_sha`로 찾는다 (백엔드 아키텍처 4.5 폴백)', async () => {
    const { body } = await resolve(`q=${HEAD_ONLY_SHA}`);

    expect(body.candidates).toHaveLength(1);
    expect(body.candidates[0]).toMatchObject({ kind: 'pull_request', pr_number: 1400 });
  });

  it('커밋을 찾으면 폴백을 돌리지 않는다', async () => {
    // 둘 다 실으면 같은 SHA에 후보 2건이 되어 자동 이동해야 할 상황이 선택 화면이 된다.
    const { body } = await resolve(`q=${MERGE_SHA}`);
    expect(body.candidates.every((one) => one.kind === 'commit')).toBe(true);
  });

  it('없는 SHA는 200에 빈 배열과 사유 코드다', async () => {
    const { status, body } = await resolve(`q=${'9'.repeat(40)}`);

    expect(status).toBe(200);
    expect(body.candidates).toEqual([]);
    expect(body.reason_code).toBe('not_found');
    expect(body.hint).toBeDefined();
  });
});

describe('QA-W001-02: PR 참조 (FR-SRCH-001 AC-2, AC-3)', () => {
  it('`owner/repo#N`이 그 저장소의 PR 1건이다', async () => {
    const { body } = await resolve('q=acme%2Fpayments%231234');

    expect(body.detected_kind).toBe('pull_request');
    expect(body.candidates).toHaveLength(1);
    expect(body.candidates[0]).toMatchObject({
      kind: 'pull_request',
      repository: 'acme/payments',
      pr_number: 1234,
      display_name: '결제 재시도 로직',
    });
  });

  it('GHE PR URL도 같은 PR이다', async () => {
    const { body } = await resolve(`q=${encodeURIComponent(`${GHE}/acme/payments/pull/1234`)}`);
    expect(body.candidates).toHaveLength(1);
    expect(body.candidates[0]).toMatchObject({ repository: 'acme/payments', pr_number: 1234 });
  });

  it('GHE 커밋 URL은 커밋이다', async () => {
    const { body } = await resolve(`q=${encodeURIComponent(`${GHE}/acme/payments/commit/${MERGE_SHA}`)}`);
    expect(body.candidates[0]).toMatchObject({ kind: 'commit', commit_sha: MERGE_SHA });
  });

  it('DEV-064: 다른 호스트의 URL은 우리 저장소로 해석되지 않는다', async () => {
    const { body } = await resolve(`q=${encodeURIComponent('https://other.example/acme/payments/pull/1234')}`);

    expect(body.detected_kind).toBe('text');
    expect(body.candidates).toEqual([]);
  });
});

describe('QA-W001-05: 후보 2건이면 자동 이동하지 않는다 (FR-SRCH-001 AC-5)', () => {
  it('`#1234`는 저장소 둘의 PR을 모두 준다', async () => {
    const { body } = await resolve('q=%231234');

    expect(body.candidates).toHaveLength(2);
    expect(body.candidates.map((one) => one.repository).sort()).toEqual([
      'acme/billing',
      'acme/payments',
    ]);
  });

  it('`repository` 힌트가 후보를 좁힌다', async () => {
    const { body } = await resolve('q=%231234&repository=acme%2Fbilling');

    expect(body.candidates).toHaveLength(1);
    expect(body.candidates[0]?.repository).toBe('acme/billing');
  });

  it('접두가 겹치는 커밋 둘이 모두 후보가 된다', async () => {
    const { body } = await resolve('q=beef123');

    expect(body.detected_kind).toBe('commit');
    expect(body.candidates.map((one) => one.commit_sha).sort()).toEqual([TWIN_A, TWIN_B].sort());
  });
});

describe('QA-W001-03·04·06: 축약 SHA (FR-SRCH-004)', () => {
  it('7자 접두가 커밋을 찾는다 (AC-1)', async () => {
    const { body } = await resolve(`q=${MERGE_SHA.slice(0, 7)}`);
    expect(body.candidates[0]?.commit_sha).toBe(MERGE_SHA);
  });

  it('6자는 400 `SHA_PREFIX_TOO_SHORT`다 (AC-2)', async () => {
    const { status, body } = await resolve('q=a3f9c2');

    expect(status).toBe(400);
    expect(body.error?.code).toBe('SHA_PREFIX_TOO_SHORT');
    expect(body.error?.detail).toMatchObject({ min_length: 7, actual_length: 6 });
  });

  it('짧은 숫자는 400이 아니다 — PR 번호로 읽힌다', async () => {
    const { status } = await resolve('q=1234');
    expect(status).toBe(200);
  });

  it('`limit`을 넘는 후보가 있으면 절삭 표식이 붙는다 (AC-3)', async () => {
    // 접두 `beef123`은 둘을 부른다. `limit=1`이면 하나만 싣고 잘렸다고 말한다.
    const { body } = await resolve('q=beef123&limit=1');

    expect(body.candidates).toHaveLength(1);
    expect(body.truncated).toBe(true);
  });

  it('절삭되지 않으면 표식이 붙지 않는다', async () => {
    const { body } = await resolve('q=beef123');
    expect(body.truncated).toBe(false);
  });
});

describe('DEV-066: 순수 정수는 PR 경로와 커밋 접두 경로를 모두 돈다', () => {
  it('숫자 접두로만 찾히는 커밋도 후보가 된다', async () => {
    // `1a2b3c4`는 PR 번호로는 없고 SHA 접두로는 SOURCE_SHA다.
    const { body } = await resolve('q=1a2b3c4');
    expect(body.candidates[0]?.commit_sha).toBe(SOURCE_SHA);
  });

  it('PR로 먼저 찾히면 그것이 `detected_kind`다', async () => {
    const { body } = await resolve('q=%231234');
    expect(body.detected_kind).toBe('pull_request');
  });

  it('아무것도 못 찾아도 우선순위 1위의 유형을 말한다', async () => {
    const { body } = await resolve('q=9999999');
    expect(body.detected_kind).toBe('pull_request');
    expect(body.candidates).toEqual([]);
  });
});

describe('FR-SRCH-001 AC-6: 접근 범위 밖은 어떤 경로로도 새지 않는다', () => {
  it('범위 밖 커밋 SHA는 후보 0건이다', async () => {
    const { status, body } = await resolve(`q=${HIDDEN_SHA}`);

    expect(status).toBe(200);
    expect(body.candidates).toEqual([]);
    expect(body.reason_code).toBe('not_found');
  });

  it('범위 밖 PR 번호도 후보 0건이다', async () => {
    const { body } = await resolve('q=other%2Fsecret%239');
    expect(body.candidates).toEqual([]);
  });

  it('범위 밖 커밋의 접두도 새지 않는다', async () => {
    const { body } = await resolve(`q=${HIDDEN_SHA.slice(0, 8)}`);
    expect(body.candidates).toEqual([]);
  });

  it('범위 밖 커밋 상세는 404다 — 403이면 존재가 샌다 (THR-004)', async () => {
    const { status, body } = await getPath(
      `/api/v1/commits/${encodeURIComponent('other/secret')}/${HIDDEN_SHA}`,
    );

    expect(status).toBe(404);
    expect(body.error?.code).toBe('NOT_FOUND');
  });

  it('범위 밖 PR 상세도 404다', async () => {
    const { status } = await getPath(`/api/v1/pull-requests/${encodeURIComponent('other/secret')}/9`);
    expect(status).toBe(404);
  });
});

describe('QA-W003-01·02·04·05: 커밋 상세 (API-SRCH-002 / FR-SRCH-002)', () => {
  it('머지 커밋은 역할 `merge_commit`과 대응 PR 1건이다 (AC-1)', async () => {
    const { status, body } = await getPath(
      `/api/v1/commits/${encodeURIComponent('acme/payments')}/${MERGE_SHA}`,
    );

    expect(status).toBe(200);
    expect(body.role).toBe('merge_commit');
    expect(body.pull_requests).toHaveLength(1);
    expect(body.pull_requests?.[0]?.pr_number).toBe(1234);
  });

  it('원본 커밋은 역할 `source_commit`이다 (AC-2)', async () => {
    const { body } = await getPath(
      `/api/v1/commits/${encodeURIComponent('acme/payments')}/${SOURCE_SHA}`,
    );
    expect(body.role).toBe('source_commit');
  });

  it('AC-4가 요구하는 PR 필드가 모두 실린다', async () => {
    const { body } = await getPath(
      `/api/v1/commits/${encodeURIComponent('acme/payments')}/${MERGE_SHA}`,
    );
    const pr = body.pull_requests?.[0];

    expect(pr).toMatchObject({
      pr_number: 1234,
      title: '결제 재시도 로직',
      author: 'kim',
      reviewers: ['lee', 'park'],
      approved_by: ['lee'],
      state: 'merged',
      merged_at: '2026-08-19T05:02:11Z',
    });
  });

  it('시퀀스 3종은 키를 두고 `null`이다 — 채번이 WP-021이다', async () => {
    const { body } = await getPath(
      `/api/v1/commits/${encodeURIComponent('acme/payments')}/${MERGE_SHA}`,
    );

    expect(body).toHaveProperty('merge_seq');
    expect(body.merge_seq).toBeNull();
    expect(body.seq_epoch).toBeNull();
    expect(body.sequence_space).toBeNull();
  });

  it('**소속 PR에 `merge_commit_sha`가 실린다** (CR-021, DEV-091)', async () => {
    /*
     * W-003의 `no_sequence` 안내가 이 키를 쓴다 — 원본 커밋 화면이 "머지 커밋
     * X로 반영되었습니다"라고 말하고 그 X로 이동시킬 수 있어야 한다.
     */
    const { body } = await getPath(
      `/api/v1/commits/${encodeURIComponent('acme/payments')}/${SOURCE_SHA}`,
    );

    expect(body.pull_requests?.[0]?.merge_commit_sha).toBe(MERGE_SHA);
  });

  it('미머지 PR이면 `merge_commit_sha` **키가 없다** — `null`로 채우지 않는다', async () => {
    const { body } = await getPath(
      `/api/v1/commits/${encodeURIComponent('acme/payments')}/${OPEN_SOURCE_SHA}`,
    );

    const pr = body.pull_requests?.[0];
    expect(pr?.pr_number).toBe(1236);
    // 키가 없어야 한다. `null`이면 "머지 커밋이 없다"는 다른 주장이 된다.
    expect(pr).not.toHaveProperty('merge_commit_sha');
  });

  it('같은 SHA가 PR 둘에 속하면 둘 다 실린다 (AC-5)', async () => {
    const { body } = await getPath(
      `/api/v1/commits/${encodeURIComponent('acme/payments')}/${SHARED_SHA}`,
    );

    expect(body.pull_requests?.map((one) => one.pr_number).sort()).toEqual([1234, 1235]);
  });

  it('DEV-060: 채워지지 않은 커밋 메타데이터는 **키가 없다**', async () => {
    const { body } = await getPath(
      `/api/v1/commits/${encodeURIComponent('acme/payments')}/${MERGE_SHA}`,
    );

    // `null`이나 `0`으로 채우면 "파일을 하나도 안 바꾼 커밋"과 구분되지 않는다.
    for (const key of ['message', 'author', 'committer', 'authored_at', 'parent_shas', 'additions', 'changed_files_count']) {
      expect(body, key).not.toHaveProperty(key);
    }
  });

  it('M14: 경로의 저장소가 어느 문서를 고르는지 가른다', async () => {
    // 같은 SHA가 범위 안 저장소 둘에 있다. 저장소 조건을 빼면 아무거나 나온다.
    const payments = await getPath(
      `/api/v1/commits/${encodeURIComponent('acme/payments')}/${TWIN_REPO_SHA}`,
    );
    const billing = await getPath(
      `/api/v1/commits/${encodeURIComponent('acme/billing')}/${TWIN_REPO_SHA}`,
    );

    expect(payments.body.repository).toBe('acme/payments');
    expect(payments.body.role).toBe('merge_commit');
    expect(billing.body.repository).toBe('acme/billing');
    expect(billing.body.role).toBe('source_commit');
  });

  it('ADR-008: 커밋 → PR 조인도 강제 범위 필터를 지난다', async () => {
    /*
     * 커밋은 범위 안이지만 그것이 가리키는 PR의 범위 필드는 범위 밖을
     * 가리킨다(저장소가 private이 됐는데 투영이 아직 따라잡지 못한 상태).
     * 조인이 필터를 건너뛰면 커밋이 범위 안이라는 이유로 이 PR이 딸려 나온다.
     */
    const { status, body } = await getPath(
      `/api/v1/commits/${encodeURIComponent('acme/payments')}/${SKEW_SHA}`,
    );

    expect(status).toBe(200);
    expect(body.pull_requests).toEqual([]);
    // 볼 수 있는 PR이 없으므로 사유가 남는다.
    expect(body.reason_code).toBe('no_pull_request');
  });

  it('DEV-060: 값이 없는 선택 필드는 `null`이 아니라 **키가 없다**', async () => {
    // 원본 커밋 fixture에는 `link_summary`가 없다.
    const { body } = await getPath(
      `/api/v1/commits/${encodeURIComponent('acme/payments')}/${SOURCE_SHA}`,
    );

    expect(body).not.toHaveProperty('link_summary');
    // 있는 것은 그대로 실린다 — 규칙이 "전부 뺀다"가 아님을 함께 건다.
    expect(body).toHaveProperty('role');
    expect(body).toHaveProperty('base_branch');
  });

  it('40자가 아닌 SHA로 상세를 부르면 404다', async () => {
    const { status } = await getPath(`/api/v1/commits/${encodeURIComponent('acme/payments')}/beef123`);
    expect(status).toBe(404);
  });

  it('없는 커밋은 404다', async () => {
    const { status } = await getPath(
      `/api/v1/commits/${encodeURIComponent('acme/payments')}/${'7'.repeat(40)}`,
    );
    expect(status).toBe(404);
  });
});

describe('QA-W002-01·02·03: PR 상세 (API-SRCH-003 / FR-SRCH-003)', () => {
  it('머지 커밋 1건과 원본 커밋 배열을 구분해 준다 (AC-1)', async () => {
    const { status, body } = await getPath(
      `/api/v1/pull-requests/${encodeURIComponent('acme/payments')}/1234`,
    );

    expect(status).toBe(200);
    expect(body.merge_commit_sha).toBe(MERGE_SHA);
    expect(body.source_commits?.map((one) => one.commit_sha).sort()).toEqual(
      [SOURCE_SHA, SHARED_SHA].sort(),
    );
  });

  it('미머지 PR은 머지 커밋이 `null`이고 원본만 있다 (AC-2)', async () => {
    const { body } = await getPath(
      `/api/v1/pull-requests/${encodeURIComponent('acme/payments')}/1235`,
    );

    expect(body.merge_commit_sha).toBeNull();
    expect(body.source_commits).toEqual([{ commit_sha: SHARED_SHA }]);
  });

  it('250건을 넘으면 앞의 250건과 절삭 표식이다 (AC-3)', async () => {
    const { body } = await getPath(
      `/api/v1/pull-requests/${encodeURIComponent('acme/billing')}/1300`,
    );

    expect(body.source_commits).toHaveLength(250);
    expect(body.source_commits_truncated).toBe(true);
  });

  it('DEV-063: 절삭됐을 때 총계 키를 넣지 않는다 — 250은 총계가 아니다', async () => {
    const { body } = await getPath(
      `/api/v1/pull-requests/${encodeURIComponent('acme/billing')}/1300`,
    );

    expect(body).not.toHaveProperty('source_commits_total');
  });

  it('절삭되지 않았으면 총계가 배열 길이다', async () => {
    const { body } = await getPath(
      `/api/v1/pull-requests/${encodeURIComponent('acme/payments')}/1234`,
    );

    expect(body.source_commits_total).toBe(2);
    expect(body.source_commits_truncated).toBe(false);
  });

  it('DEV-062: 원본 커밋은 객체 배열이되 `commit_sha`만 채운다', async () => {
    const { body } = await getPath(
      `/api/v1/pull-requests/${encodeURIComponent('acme/payments')}/1235`,
    );
    const [one] = body.source_commits ?? [];

    // 모양을 지금부터 객체로 두어 WP-020이 키를 더할 때 계약을 고치지 않는다.
    expect(Object.keys(one ?? {})).toEqual(['commit_sha']);
  });

  it('PR 본문 필드가 실린다', async () => {
    const { body } = await getPath(
      `/api/v1/pull-requests/${encodeURIComponent('acme/payments')}/1234`,
    );

    expect(body).toMatchObject({ pr_number: 1234, title: '결제 재시도 로직', state: 'merged' });
  });

  it('DEV-060: PR에서도 값이 없는 선택 필드는 키가 없다', async () => {
    // 미머지 PR fixture에는 `labels`·`reviewers`·`merged_at`이 없다.
    const { body } = await getPath(
      `/api/v1/pull-requests/${encodeURIComponent('acme/payments')}/1235`,
    );

    for (const key of ['labels', 'reviewers', 'approved_by', 'merged_at']) {
      expect(body, key).not.toHaveProperty(key);
    }
    // `merge_commit_sha`만은 키를 두고 `null`이다 — "미머지"를 말해야 한다 (AC-2).
    expect(body).toHaveProperty('merge_commit_sha');
    expect(body.merge_commit_sha).toBeNull();
  });

  it('없는 PR은 404다', async () => {
    const { status } = await getPath(
      `/api/v1/pull-requests/${encodeURIComponent('acme/payments')}/999999`,
    );
    expect(status).toBe(404);
  });

  it('PR 번호가 숫자가 아니면 404다', async () => {
    const { status } = await getPath(
      `/api/v1/pull-requests/${encodeURIComponent('acme/payments')}/abc`,
    );
    expect(status).toBe(404);
  });
});

describe('인증 (FR-AUTH-001)', () => {
  it('세션 없이 해석하면 401이다', async () => {
    const response = await app.inject({ method: 'GET', url: `${RESOLVE_PATH}?q=${MERGE_SHA}` });
    expect(response.statusCode).toBe(401);
  });

  it('세션 없이 커밋 상세를 부르면 401이다 — 404보다 먼저다', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/commits/${encodeURIComponent('acme/payments')}/${MERGE_SHA}`,
    });
    expect(response.statusCode).toBe(401);
  });

  it('세션 없이 PR 상세를 불러도 401이다', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/pull-requests/${encodeURIComponent('acme/payments')}/1234`,
    });
    expect(response.statusCode).toBe(401);
  });
});

describe('응답 스키마가 계약과 맞는다', () => {
  it('`/resolve`가 계약의 최상위 키를 갖는다', async () => {
    const { body } = await resolve(`q=${MERGE_SHA}`);
    for (const key of ['input', 'detected_kind', 'candidates', 'truncated', 'correlation_id']) {
      expect(body, key).toHaveProperty(key);
    }
  });

  it('후보가 있으면 `reason_code`를 넣지 않는다', async () => {
    const { body } = await resolve(`q=${MERGE_SHA}`);
    expect(body).not.toHaveProperty('reason_code');
  });

  it('`input`이 정규화된 입력이다', async () => {
    const { body } = await resolve(`q=${encodeURIComponent(`  ${MERGE_SHA}  `)}`);
    expect(body.input).toBe(MERGE_SHA);
  });

  it('상관 ID가 요청마다 다르다', async () => {
    const one = await resolve(`q=${MERGE_SHA}`);
    const two = await resolve(`q=${MERGE_SHA}`);
    expect(one.body.correlation_id).not.toBe(two.body.correlation_id);
  });
});
