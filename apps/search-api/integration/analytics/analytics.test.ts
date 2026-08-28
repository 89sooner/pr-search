/**
 * 집계 네 API — 실제 Fastify + Elasticsearch + PostgreSQL + Redis (WP-037 DoD).
 *
 * 단위 시험은 집계 **모양**을 확인한다. 여기서는 그 모양을 진짜 인덱스에 던져
 * **어떤 수가 나오는지**를 확인한다 — 필드 이름이 하나 어긋나도 모양은 맞고
 * 숫자만 조용히 0이 되며, 그것을 잡는 것은 실제 집계뿐이다.
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
import { ANALYTICS_BASE } from '../../src/analytics/routes.js';
import type { AuthContext, AuthRedis } from '../../src/auth/context.js';
import { createTestRedis, migratedPool } from '../helpers.js';
import { TEST_CURSOR_KEY, TEST_CURSOR_SIGNER } from '../_cursor-fixture.js';

const AUTH_CONFIG = {
  enabled: true,
  cookieSecure: true,
  loginPath: '/auth/login',
  groupRoleMap: new Map<string, never>(),
} as const;

const USER = 'sub-analytics';
const ORG = 1;
const PAYMENTS = 201;
const HIDDEN = 999;
const TEAM_CORE = 21;
const TEAM_PLATFORM = 22;
/** 접근 권한만 있고 작성자 팀은 아닌 팀. 두 필드를 가르는 시험이 이것을 쓴다. */
const TEAM_ACCESS_ONLY = 23;

/**
 * 모든 질의가 **자기 저장소로 한정**한다.
 *
 * `prs_test`와 두 인덱스는 모든 시험 파일이 공유한다. 전역 질의로 세면 앞선
 * 파일이 남긴 문서가 섞여 **단독 실행에서는 통과하고 전량에서만 깨진다** — 실제로
 * 그렇게 만들어 겪었고 risks 「공유 DB 오염」이 세 번 겪었다고 적어 둔 자리다.
 */
const SCOPE_QUERY = 'repo:analytics/payments';

let pool: Pool;
let redis: Redis;
let es: Client;
let app: FastifyInstance;
let sessionId: string;

interface Doc {
  readonly _id: string;
  readonly [key: string]: unknown;
}

/**
 * PR 픽스처.
 *
 * `author_team_ids`와 `allowed_team_ids`를 **일부러 다르게** 둔다 — 집계가
 * 어느 쪽을 보는지 그 차이로만 드러난다 (DEV-382).
 */
const PULL_REQUESTS: readonly Doc[] = [
  {
    _id: 'pr:1', document_version: 1,
    repository_id: PAYMENTS, repository: 'analytics/payments', org_id: ORG, visibility: 'internal',
    allowed_team_ids: [TEAM_ACCESS_ONLY], author_team_ids: [TEAM_CORE],
    pr_number: 1, title: '결제 재시도', state: 'merged', author: 'kim', labels: ['bug', 'payments'],
    base_branch: 'main',
    created_at: '2026-07-01T00:00:00Z', merged_at: '2026-07-01T03:00:00Z',
    lead_time_seconds: 10_800, first_review_wait_seconds: 600,
    changed_files_count: 1, additions: 30, deletions: 20, changed_lines: 50,
    merge_seq: 10, seq_epoch: 3, sequence_space: 'analytics/payments@main',
    enrichment_pending: false,
  },
  {
    _id: 'pr:2', document_version: 1,
    repository_id: PAYMENTS, repository: 'analytics/payments', org_id: ORG, visibility: 'internal',
    allowed_team_ids: [TEAM_ACCESS_ONLY],
    // 작성자가 두 팀에 속한다 — 한 PR이 두 버킷에 들어간다 (AC-7).
    author_team_ids: [TEAM_CORE, TEAM_PLATFORM],
    pr_number: 2, title: '세션 정리', state: 'merged', author: 'lee', labels: ['chore'],
    base_branch: 'main',
    created_at: '2026-07-02T00:00:00Z', merged_at: '2026-07-02T06:00:00Z',
    lead_time_seconds: 21_600, first_review_wait_seconds: 1_800,
    changed_files_count: 4, additions: 100, deletions: 60, changed_lines: 160,
    merge_seq: 11, seq_epoch: 3, sequence_space: 'analytics/payments@main',
    enrichment_pending: false,
  },
  {
    _id: 'pr:3', document_version: 1,
    repository_id: PAYMENTS, repository: 'analytics/payments', org_id: ORG, visibility: 'internal',
    allowed_team_ids: [TEAM_ACCESS_ONLY], author_team_ids: [TEAM_PLATFORM],
    pr_number: 3, title: '보강 대기', state: 'open', author: 'park', labels: ['feature'],
    base_branch: 'release/1.0',
    created_at: '2026-07-03T00:00:00Z',
    // 머지되지 않아 `merged_at`도 리드타임도 없다. 시계열과 백분위가 이것을 센다.
    // 보강이 끝나지 않아 변경 규모를 모른다 — `unknown` 구간이 이 문서다 (AC-5).
    enrichment_pending: true,
  },
  {
    _id: 'pr:4', document_version: 1,
    repository_id: PAYMENTS, repository: 'analytics/payments', org_id: ORG, visibility: 'internal',
    allowed_team_ids: [TEAM_ACCESS_ONLY], author_team_ids: [TEAM_PLATFORM],
    pr_number: 4, title: '자정 경계', state: 'merged', author: 'choi', labels: ['chore'],
    base_branch: 'main',
    created_at: '2026-07-02T20:00:00Z',
    /*
     * **UTC로는 7/2, Asia/Seoul(UTC+9)로는 7/3이다.**
     *
     * 이 문서가 없으면 시간대를 무시하고 UTC로 나눠도 같은 답이 나와,
     * `time_zone`을 넘기는 코드가 하는 일이 시험에 걸리지 않는다 — 변이(M8)가
     * 살아남아 그 사실을 드러냈다.
     */
    merged_at: '2026-07-02T22:00:00Z',
    lead_time_seconds: 7_200, first_review_wait_seconds: 900,
    changed_files_count: 2, additions: 5, deletions: 5, changed_lines: 10,
    merge_seq: 12, seq_epoch: 3, sequence_space: 'analytics/payments@main',
    enrichment_pending: false,
  },
  {
    _id: 'pr:hidden', document_version: 1,
    repository_id: HIDDEN, repository: 'analytics/secret', org_id: 2, visibility: 'private',
    allowed_team_ids: [], author_team_ids: [TEAM_CORE],
    pr_number: 9, title: '범위 밖', state: 'merged', author: 'hidden-author', labels: ['bug'],
    base_branch: 'main',
    created_at: '2026-07-01T00:00:00Z', merged_at: '2026-07-01T01:00:00Z',
    lead_time_seconds: 3_600, first_review_wait_seconds: 60,
    changed_files_count: 900, additions: 5_000, deletions: 5_000, changed_lines: 10_000,
    enrichment_pending: false,
  },
];

/** 커밋 하나. **집계가 이것을 세면 안 된다** (FR-STAT-001 AC-6). */
const COMMITS: readonly Doc[] = [
  {
    _id: 'c:' + 'a'.repeat(40), document_version: 1,
    repository_id: PAYMENTS, repository: 'analytics/payments', org_id: ORG, visibility: 'internal',
    allowed_team_ids: [TEAM_ACCESS_ONLY], commit_sha: 'a'.repeat(40), message: '직접 푸시',
    author: 'kim', committed_at: '2026-07-01T04:00:00Z', authored_at: '2026-07-01T04:00:00Z',
    base_branch: 'main', role: 'direct_push', additions: 7, deletions: 3,
  },
];

/** 그룹 한 줄. `key`는 팀처럼 숫자 식별자일 수 있어 둘을 모두 받는다. */
interface GroupRow {
  readonly key: string | number;
  readonly count: number;
  readonly drill_down_query: string;
  readonly changed_files_sum?: number;
  readonly additions_sum?: number;
  readonly lead_time_median?: number | null;
}

/** 분포 한 줄. `unknown` 구간은 근거 질의가 없다. */
interface BucketRow {
  readonly key: string;
  readonly count: number;
  readonly ratio: number;
  readonly drill_down_query: string | null;
}

/**
 * 시험이 읽는 응답 모양.
 *
 * 네 API가 서로 다른 키를 내므로 **선택 필드를 모은 하나**로 둔다. 각각을 따로
 * 정의하고 호출마다 캐스팅하면 그 캐스팅이 실제 응답과 어긋나도 시험은 통과한다.
 */
interface Body {
  readonly total?: { readonly value: number; readonly relation: string };
  readonly groups?: readonly GroupRow[];
  readonly truncated?: boolean;
  readonly approximate?: boolean;
  readonly sample_probability?: number;
  readonly buckets?: readonly (string & BucketRow)[] | readonly string[] | readonly BucketRow[];
  readonly series?: readonly { readonly key: string; readonly values: readonly number[] }[];
  readonly interval?: string;
  readonly timezone?: string;
  readonly applied_range?: { readonly from: string; readonly to: string };
  readonly unit?: string;
  readonly overall?: Readonly<Record<string, number | null>>;
  readonly sample_size?: number;
  readonly low_sample?: boolean;
  readonly excluded_count?: number;
  readonly excluded_reasons?: Readonly<Record<string, number>>;
  readonly dimension?: string;
  readonly epoch_stale?: boolean;
  readonly requested_seq_epoch?: number;
  readonly error?: {
    readonly code: string;
    readonly message: string;
    readonly detail?: Readonly<Record<string, unknown>>;
  };
}

async function post(path: string, body: unknown): Promise<{ status: number; body: Body }> {
  const response = await app.inject({
    method: 'POST',
    url: `${ANALYTICS_BASE}${path}`,
    headers: { cookie: `${SESSION_COOKIE_NAME}=${sessionId}` },
    payload: body as Record<string, unknown>,
  });
  return { status: response.statusCode, body: response.json<Body>() };
}

/** 응답의 그룹 목록. 없으면 빈 배열 — 시험이 `undefined`에서 터지지 않게 한다. */
const groupsOf = (body: Body): readonly GroupRow[] => body.groups ?? [];
/** 분포의 구간 목록. 시계열의 `buckets`(문자열 배열)와 모양이 다르다. */
const rowsOf = (body: Body): readonly BucketRow[] => (body.buckets ?? []) as readonly BucketRow[];
/** 시계열의 버킷 라벨. */
const labelsOf = (body: Body): readonly string[] => (body.buckets ?? []) as readonly string[];

beforeAll(async () => {
  pool = await migratedPool();
  redis = createTestRedis();
  es = createEsClient(resolveClientOptions());
  await applyMappings(es);
  await switchAliasesForTests(es);

  /*
   * **자기 행만 지운다.** `prs_test`는 모든 시험 파일이 공유하므로 전역
   * `DELETE`는 나중에 도는 파일의 픽스처를 없앤다 — 실제로 그렇게 만들어
   * `authz/team-scope.test.ts`를 깨뜨렸다 (risks 「공유 DB 오염」).
   */
  await pool.query('DELETE FROM permission_cache WHERE user_id = $1', [USER]);
  await pool.query('DELETE FROM app_user WHERE user_id = $1', [USER]);
  await pool.query('DELETE FROM team_member WHERE team_id = ANY($1)', [
    [TEAM_CORE, TEAM_PLATFORM, TEAM_ACCESS_ONLY],
  ]);
  await pool.query('DELETE FROM repository WHERE repository_id = ANY($1)', [[PAYMENTS, HIDDEN]]);
  await pool.query('DELETE FROM team WHERE team_id = ANY($1)', [
    [TEAM_CORE, TEAM_PLATFORM, TEAM_ACCESS_ONLY],
  ]);

  /*
   * slug도 고유해야 한다 — `team`은 `(org_id, slug)`가 유니크이고 다른 파일이
   * `payments-core`를 쓴다. 겹치면 이 파일이 그 행을 밀어내거나 거절당한다.
   */
  // `login`과 `github_user_id`도 유니크다 — 다른 파일이 'kim'을 이미 만든다.
  await authRepo.upsertUserOnLogin(pool, {
    user_id: USER,
    login: 'analytics-user',
    github_user_id: 8001,
  });
  await authRepo.upsertTeam(pool, { team_id: TEAM_CORE, slug: 'analytics-core', org_id: ORG });
  await authRepo.upsertTeam(pool, { team_id: TEAM_PLATFORM, slug: 'analytics-platform', org_id: ORG });
  await authRepo.upsertTeam(pool, { team_id: TEAM_ACCESS_ONLY, slug: 'analytics-access', org_id: ORG });
  for (const [id, owner, name] of [
    [PAYMENTS, 'analytics', 'payments'],
    [HIDDEN, 'analytics', 'secret'],
  ] as const) {
    await repositoryRepo.upsertRepository(pool, {
      repository_id: id, owner, name, org_id: name === 'payments' ? ORG : 2,
      visibility: name === 'payments' ? 'internal' : 'private', sequence_branches: ['main'],
    });
  }

  // `seq:` 질의가 딛고 설 공간 (CR-051).
  await sequenceSpaceRepo.ensureSequenceSpace(pool, PAYMENTS, 'main');
  await pool.query(
    'UPDATE sequence_space SET seq_epoch = 3 WHERE repository_id = $1 AND base_branch = $2',
    [PAYMENTS, 'main'],
  );

  /*
   * **`match_all`로 지우지 않는다.** `prs_test`와 이 인덱스는 모든 시험 파일이
   * 공유하므로, 전량 실행에서 앞선 파일이 남긴 문서를 지우면 그 파일이 아니라
   * **나중에 도는 파일이 깨진다** (risks 「공유 DB 오염」). 자기 저장소만 지운다.
   */
  await es.deleteByQuery({
    index: ['prs-pull-requests', 'prs-commits'],
    query: { terms: { repository_id: [PAYMENTS, HIDDEN] } },
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
  const source: AccessScopeSource = {
    fetch: async () => ({
      repositoryIds: [PAYMENTS],
      orgIds: [ORG],
      teamIds: [TEAM_ACCESS_ONLY],
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
      port: 0, adminTokens: [], metricsQueryUrl: null, gheBaseUrl: null,
      auth: AUTH_CONFIG, searchCursorKey: TEST_CURSOR_KEY,
    },
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
    sessionId, userId: USER, login: 'analytics-user', email: null,
    roles: ['developer'], issuedAt: now, lastSeenAt: now, correlationId: null,
  });
});

afterAll(async () => {
  await app?.close();
  await es?.deleteByQuery({
    index: ['prs-pull-requests', 'prs-commits'],
    query: { terms: { repository_id: [PAYMENTS, HIDDEN] } },
    refresh: true,
    conflicts: 'proceed',
  });
  await es?.close();
  await redis?.quit();
  await pool?.end();
});

describe('모집단은 Pull Request 단독이다 (FR-STAT-001 AC-6, DEV-381)', () => {
  it('커밋을 세지 않는다 — 범위 안 PR 셋이 전부다', async () => {
    /*
     * 같은 저장소에 커밋 문서가 하나 있다. 목록 조회는 그것을 보여 주지만
     * 집계는 세지 않는다 — 그룹 키 셋과 지표 둘이 커밋 매핑에 없어서
     * 넣으면 그 다섯이 조용히 0이나 `unknown`이 되기 때문이다.
     */
    const { status, body } = await post('/groups', { query: SCOPE_QUERY, group_by: 'author' });
    expect(status).toBe(200);
    expect(body.total?.value).toBe(4);
  });

  it('**`kind:commit`은 400이다 — 조용한 0건이 아니다**', async () => {
    // 집계 대상이 PR이므로 이것은 "결과 없음"이 아니라 이 API의 물음이 아니다.
    const { status, body } = await post('/groups', { query: `${SCOPE_QUERY} kind:commit`, group_by: 'author' });
    expect(status).toBe(400);
    expect(body.error?.detail?.reason).toBe('analytics_population_empty');
  });

  it('`kind:pull_request`는 그대로 성립한다', async () => {
    const { status, body } = await post('/groups', {
      query: `${SCOPE_QUERY} kind:pull_request`,
      group_by: 'author',
    });
    expect(status).toBe(200);
    expect(body.total?.value).toBe(4);
  });
});

describe('접근 범위가 어느 숫자에도 새지 않는다 (FR-AUTH-002 AC-5, THR-003)', () => {
  /*
   * **이 절은 대부분 `repo:` 조건을 쓰지 않는다.**
   *
   * `SCOPE_QUERY`로 한정하면 그 질의 자체가 범위 밖 저장소를 빼므로,
   * **강제 필터를 통째로 제거해도 같은 답이 나온다** — 실제로 변이 시험(M1)이
   * 살아남아 그 사실을 드러냈다. 필터가 하는 일을 보려면 질의가 그것을 대신하지
   * 않아야 한다.
   *
   * 대신 전역 건수로 단언하지 않는다. 다른 시험 파일의 문서가 섞이더라도
   * **"`analytics/secret`이 나타나는가"**는 그 오염과 무관하게 참이거나 거짓이다
   * (risks 「내 저장소의 상태가 이렇게 됐는가로 건다」).
   */
  it('그룹 어디에도 범위 밖 저장소가 없다', async () => {
    const { body } = await post('/groups', { query: '', group_by: 'repository' });
    const keys = groupsOf(body).map((one) => String(one.key));
    expect(keys).toContain('analytics/payments');
    expect(keys).not.toContain('analytics/secret');
  });

  it('작성자 그룹에도 범위 밖 문서가 기여하지 않는다', async () => {
    /*
     * 숨은 PR의 작성자는 `hidden-author`이고 범위 안에는 그 이름이 없다.
     * 필터가 빠지면 그것이 버킷으로 나타난다 — **건수가 아니라 존재로 건다.**
     */
    const { body } = await post('/groups', { query: '', group_by: 'author' });
    expect(groupsOf(body).map((one) => String(one.key))).not.toContain('hidden-author');
  });

  it('백분위 표본에 범위 밖 값이 섞이지 않는다', async () => {
    // 숨은 PR의 리드타임은 3600초다. 범위 안 최솟값(10800)보다 작으므로
    // 섞이면 p50이 그 아래로 내려간다.
    const { body } = await post('/percentiles', { query: SCOPE_QUERY, field: 'lead_time_seconds' });
    expect(body.sample_size).toBe(3);
    // 숨은 PR(3600초)이 섞이면 p50이 7200 아래로 내려간다.
    expect(body.overall?.p50).toBeGreaterThanOrEqual(7_200);
  });

  it('분포에 범위 밖 문서가 나타나지 않는다', async () => {
    // 숨은 PR은 10000줄을 바꿨다. `1000+` 구간에 나타나면 유출이다.
    const { body } = await post('/distributions', { query: '', dimension: 'changed_lines' });
    const over = rowsOf(body).find((one) => one.key === '1000+');
    expect(over?.count).toBe(0);
  });
});

describe('그룹 집계 (API-STAT-001)', () => {
  it('지원 그룹 키 일곱이 모두 동작한다 (AC-1, QA-W006-01)', async () => {
    for (const key of ['repository', 'org', 'team', 'author', 'label', 'base_branch', 'state']) {
      const { status, body } = await post('/groups', { query: SCOPE_QUERY, group_by: key });
      expect(status, `${key}가 실패했다`).toBe(200);
      expect(Array.isArray(body.groups), `${key}의 groups가 배열이 아니다`).toBe(true);
    }
  });

  it('**`team` 그룹이 작성자 팀을 본다 — 접근 권한 팀이 아니다** (DEV-382)', async () => {
    /*
     * 픽스처의 세 PR은 모두 `allowed_team_ids: [access-only]`이고
     * `author_team_ids`만 다르다. 접근 권한 팀을 보면 버킷이 하나가 되고,
     * 작성자 팀을 보면 둘이 된다 — **그 차이가 이 시험의 전부다.**
     */
    const { body } = await post('/groups', { query: SCOPE_QUERY, group_by: 'team' });
    const keys = groupsOf(body).map((one) => String(one.key)).sort();
    expect(keys).toEqual([String(TEAM_CORE), String(TEAM_PLATFORM)]);
    expect(keys).not.toContain(String(TEAM_ACCESS_ONLY));
  });

  it('**다중 소속이면 버킷 합이 총계를 넘는다** (AC-7, DEV-385)', async () => {
    // pr:2의 작성자가 두 팀에 속한다. `total`은 언제나 고유 PR 수다.
    const { body } = await post('/groups', { query: SCOPE_QUERY, group_by: 'team' });
    const sum = groupsOf(body).reduce((acc, one) => acc + one.count, 0);
    expect(sum).toBe(5);
    expect(body.total?.value).toBe(4);
  });

  it('정렬이 결정적이다 — 같은 요청이 같은 순서를 낸다 (AC-8, DEV-389)', async () => {
    const first = await post('/groups', { query: SCOPE_QUERY, group_by: 'author' });
    const second = await post('/groups', { query: SCOPE_QUERY, group_by: 'author' });
    expect(groupsOf(first.body).map((one) => one.key)).toEqual(
      groupsOf(second.body).map((one) => one.key),
    );
    // 건수가 모두 1이므로 키 오름차순이 남는다.
    expect(groupsOf(first.body).map((one) => one.key)).toEqual(['choi', 'kim', 'lee', 'park']);
  });

  it('지표 넷이 응답에 실린다 (AC-2)', async () => {
    const { body } = await post('/groups', {
      query: SCOPE_QUERY,
      group_by: 'author',
      metrics: ['count', 'changed_files_sum', 'additions_sum', 'lead_time_median'],
    });
    const kim = groupsOf(body).find((one) => one.key === 'kim');
    expect(kim?.count).toBe(1);
    expect(kim?.changed_files_sum).toBe(1);
    expect(kim?.additions_sum).toBe(30);
    expect(kim?.lead_time_median).toBe(10_800);
  });

  it('**`drill_down_query`가 같은 모집단을 가리킨다** (AC-5, DEV-383)', async () => {
    const { body } = await post('/groups', { query: 'repo:analytics/payments', group_by: 'team' });
    const core = groupsOf(body).find((one) => String(one.key) === String(TEAM_CORE));
    // `team:`이 아니라 `author_team:`이다 — 그 키는 접근 권한을 뜻한다.
    expect(core?.drill_down_query).toContain('kind:pull_request');
    expect(core?.drill_down_query).toContain('author_team:');
    expect(core?.drill_down_query).not.toMatch(/(^|\s)team:/);
  });

  it('지원하지 않는 그룹 키는 400이다', async () => {
    const { status } = await post('/groups', { query: SCOPE_QUERY, group_by: 'reviewer' });
    expect(status).toBe(400);
  });
});

describe('시계열 (API-STAT-002)', () => {
  it('빈 구간도 0으로 채운다 (AC-4, QA-W006-06)', async () => {
    const { status, body } = await post('/time-series', {
      query: SCOPE_QUERY,
      from: '2026-07-01T00:00:00Z',
      to: '2026-07-05T00:00:00Z',
      interval: 'day',
      timezone: 'UTC',
    });
    expect(status).toBe(200);
    // 7/1~7/5 닷새. 머지는 7/1과 7/2에만 있다.
    expect(labelsOf(body).length).toBe(5);
    expect((body.series ?? [])[0]?.values).toEqual([1, 2, 0, 0, 0]);
  });

  it('**시간대가 버킷 경계를 바꾼다** (AC-2, QA-W006-04)', async () => {
    /*
     * `pr:4`는 **UTC 7/2 22:00**에 머지됐고 Asia/Seoul(UTC+9)에서는 **7/3**이다.
     * 그래서 같은 기간을 두 시간대로 물으면 7/2와 7/3의 건수가 서로 바뀐다 —
     * **UTC로 나눈 뒤 이름만 바꾸면 이 차이가 생기지 않는다.**
     */
    const range = { query: SCOPE_QUERY, from: '2026-07-01T00:00:00Z', to: '2026-07-04T00:00:00Z', interval: 'day' };
    const utc = await post('/time-series', { ...range, timezone: 'UTC' });
    const seoul = await post('/time-series', { ...range, timezone: 'Asia/Seoul' });

    const countOn = (body: Body, date: string): number => {
      const at = labelsOf(body).findIndex((one) => one.startsWith(date));
      return at < 0 ? -1 : ((body.series ?? [])[0]?.values[at] ?? -1);
    };

    expect(seoul.body.timezone).toBe('Asia/Seoul');
    // UTC에서는 7/2에 둘(pr:2·pr:4), 7/3에 없다.
    expect(countOn(utc.body, '2026-07-02')).toBe(2);
    expect(countOn(utc.body, '2026-07-03')).toBe(0);
    // 서울에서는 7/2에 하나(pr:2), 7/3에 하나(pr:4).
    expect(countOn(seoul.body, '2026-07-02')).toBe(1);
    expect(countOn(seoul.body, '2026-07-03')).toBe(1);
  });

  it('기간 미지정 시 적용 구간을 응답에 명시한다 (QA-W006-07)', async () => {
    const { body } = await post('/time-series', { query: SCOPE_QUERY, interval: 'day' });
    expect(body.applied_range?.from).toBeTruthy();
    expect(body.applied_range?.to).toBeTruthy();
  });

  it('계열이 그룹별로 나뉜다 (AC-5)', async () => {
    const { body } = await post('/time-series', {
      query: SCOPE_QUERY, from: '2026-07-01T00:00:00Z', to: '2026-07-03T00:00:00Z',
      interval: 'day', timezone: 'UTC', group_by: 'team',
    });
    expect((body.series ?? []).length).toBe(2);
    expect((body.series ?? []).every((one) => one.values.length === labelsOf(body).length)).toBe(true);
  });

  it('버킷 상한을 넘으면 400과 사유 코드다 (AC-3, QA-W006-05)', async () => {
    const { status, body } = await post('/time-series', {
      query: SCOPE_QUERY, from: '2020-01-01T00:00:00Z', to: '2026-12-31T00:00:00Z',
      interval: 'hour', timezone: 'UTC',
    });
    expect(status).toBe(400);
    expect(body.error?.code).toBe('TOO_MANY_BUCKETS');
  });
});

describe('백분위 (API-STAT-003·API-STAT-004)', () => {
  it('표본 20건 미만이면 `low_sample`이다 (QA-W006-09)', async () => {
    const { body } = await post('/percentiles', { query: SCOPE_QUERY, field: 'lead_time_seconds' });
    expect(body.sample_size).toBe(3);
    expect(body.low_sample).toBe(true);
    expect(body.unit).toBe('seconds');
  });

  it('**제외 사유를 구분한다** — 리뷰 없음과 보강 대기는 다른 사실이다', async () => {
    /*
     * `pr:3`은 머지되지 않아 리드타임이 없고 보강도 끝나지 않았다. 두 사유를
     * 하나로 묶으면 운영자가 "리뷰 문화"와 "파이프라인 지연"을 구분할 수 없다.
     */
    const { body } = await post('/percentiles', { query: SCOPE_QUERY, field: 'lead_time_seconds' });
    expect(body.excluded_count).toBe(1);
    expect(body.excluded_reasons?.enrichment_pending).toBe(1);
    expect(body.excluded_reasons?.no_review).toBe(0);
  });

  it('지원하지 않는 필드는 400이다', async () => {
    const { status } = await post('/percentiles', { query: SCOPE_QUERY, field: 'additions' });
    expect(status).toBe(400);
  });
});

describe('분포 (API-STAT-004)', () => {
  it('구간이 명세대로 나뉘고 비율이 함께 온다 (AC-1~AC-3)', async () => {
    const { status, body } = await post('/distributions', {
      query: SCOPE_QUERY, dimension: 'changed_files',
    });
    expect(status).toBe(200);
    expect(rowsOf(body).map((one) => one.key)).toEqual([
      '1', '2-5', '6-20', '21-100', '100+', 'unknown',
    ]);
    // pr:1은 파일 1개, pr:2는 4개, pr:3은 값이 없다.
    const one = rowsOf(body).find((one) => one.key === '1');
    expect(one?.count).toBe(1);
    expect(one?.ratio).toBeCloseTo(1 / 4, 4);
  });

  it('**`changed_lines`가 `additions + deletions`다** (AC-2, DEV-386)', async () => {
    // pr:1은 30+20=50줄(1-50), pr:2는 100+60=160줄(51-200).
    const { body } = await post('/distributions', { query: SCOPE_QUERY, dimension: 'changed_lines' });
    const small = rowsOf(body).find((one) => one.key === '1-50');
    const medium = rowsOf(body).find((one) => one.key === '51-200');
    // pr:1(30+20=50)과 pr:4(5+5=10)가 작은 구간, pr:2(100+60=160)가 가운데.
    expect(small?.count).toBe(2);
    expect(medium?.count).toBe(1);
  });

  it('**값이 없는 문서는 `unknown`이며 0과 다르다** (AC-5, QA-W006-13)', async () => {
    const { body } = await post('/distributions', { query: SCOPE_QUERY, dimension: 'changed_files' });
    const unknown = rowsOf(body).find((one) => one.key === 'unknown');
    expect(unknown?.count).toBe(1);
    // 근거 목록으로 갈 길이 없다 — 질의 문법에 "값이 없음"이 없다.
    expect(unknown?.drill_down_query).toBeNull();
  });

  it('결과가 0건이면 모든 구간이 0이다 (예외/실패 처리)', async () => {
    const { body } = await post('/distributions', { query: `${SCOPE_QUERY} author:없는사람` });
    expect(body.total?.value).toBe(0);
    expect(rowsOf(body).every((one) => one.count === 0 && one.ratio === 0)).toBe(true);
  });
});

describe('시퀀스 인용 (FR-STAT-006 AC-6, DEV-384)', () => {
  it('`seq:` 범위가 공간을 지목하지 않으면 400이다', async () => {
    const { status, body } = await post('/groups', { query: 'seq:1..100', group_by: 'author' });
    expect(status).toBe(400);
    expect(body.error?.detail?.reason).toBe('sequence_space_required');
  });

  it('공간을 지목하면 성립한다', async () => {
    const { status, body } = await post('/groups', {
      query: 'repo:analytics/payments base:main seq:1..100',
      group_by: 'author',
    });
    expect(status).toBe(200);
    // 서수를 가진 셋(pr:1·2·4). pr:3은 머지되지 않아 채번되지 않았다.
    expect(body.total?.value).toBe(3);
  });

  it('**낡은 에폭이면 집계를 계산하지 않는다** — 0건으로 위장하지 않는다', async () => {
    const { status, body } = await post('/groups', {
      query: 'repo:analytics/payments base:main seq:1..100',
      seq_epoch: 2,
      group_by: 'author',
    });
    expect(status).toBe(200);
    expect(body.epoch_stale).toBe(true);
    expect(body.requested_seq_epoch).toBe(2);
    // 계산하지 않은 것을 빈 값으로 채우지 않는다.
    expect(body.groups).toBeUndefined();
    expect(body.total).toBeUndefined();
  });
});

describe('총 건수 일치 (FR-STAT-006 AC-2, QA-W006-14)', () => {
  it('네 집계가 같은 질의에 같은 총계를 낸다', async () => {
    const query = 'repo:analytics/payments';
    const groups = await post('/groups', { query, group_by: 'author' });
    const distributions = await post('/distributions', { query });
    const percentiles = await post('/percentiles', { query, field: 'lead_time_seconds' });

    expect(groups.body.total?.value).toBe(4);
    expect(distributions.body.total?.value).toBe(4);
    expect(percentiles.body.total?.value).toBe(4);
  });

  it('근사가 아니다 — 문턱 아래에서는 정확한 수다 (AC-3)', async () => {
    const { body } = await post('/groups', { query: SCOPE_QUERY, group_by: 'author' });
    expect(body.approximate).toBe(false);
    expect(body.sample_probability).toBeUndefined();
    expect(body.total?.relation).toBe('eq');
  });
});

describe('인증과 문법 (공통)', () => {
  it('세션 없이는 401이다', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `${ANALYTICS_BASE}/groups`,
      payload: { query: SCOPE_QUERY, group_by: 'author' },
    });
    expect(response.statusCode).toBe(401);
  });

  it('문법 오류는 오프셋과 지원 키를 담은 400이다', async () => {
    const { status, body } = await post('/groups', { query: 'assignee:kim', group_by: 'author' });
    expect(status).toBe(400);
    expect(body.error?.code).toBe('QUERY_SYNTAX_ERROR');
    expect(body.error?.detail?.supported_keys).toHaveLength(17);
  });

  it('범위 전용 키의 스칼라도 400이다 (DEV-364)', async () => {
    const { status } = await post('/groups', { query: 'merged:2026-07-01', group_by: 'author' });
    expect(status).toBe(400);
  });
});
