/**
 * `GET /search` — 패싯·커서·전문 검색 (WP-032 / FR-SRCH-008·009·011).
 *
 * 실제 Fastify + Elasticsearch + PostgreSQL + Redis.
 *
 * ## 왜 여기여야 하는가
 *
 * 단위 시험은 **모양**을 본다 — 질의 절이 어떻게 생겼는지, 커서가 무엇을
 * 봉인하는지. 그러나 이 WP의 주장 대부분은 모양으로 확인할 수 없다.
 *
 *   - "bucket count가 그 필터만 더한 독립 조회와 같다"는 **두 조회의 결과**다
 *   - "페이지 사이에 항목이 중복·누락되지 않는다"는 **여러 왕복의 합**이다
 *   - "접근 범위 밖 저장소의 팀이 bucket에 없다"는 **실제 집계**다
 *   - "부분 일치가 한글에 걸린다"는 **실제 분석기**다
 *
 * 대역으로는 넷 다 통과시킬 수 있고, 그것이 이 계층이 있는 이유다.
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
import { applyMappings, createEsClient, resolveClientOptions, switchAliasesForTests } from '@prs/es';
import { authRepo, repositoryRepo, type Pool } from '@prs/db';
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

const USER = 'sub-facets';
const PAYMENTS = 8101;
const BILLING = 8102;
/** 접근 범위 **밖**. 이 저장소의 팀·라벨·작성자는 어떤 bucket에도 없어야 한다. */
const HIDDEN = 8900;
const ORG = 81;
const HIDDEN_ORG = 82;

/** Redis 포트를 한 곳에서 만든다 — 여섯 자리가 같은 모양을 손으로 적고 있었다. */
function redisPort(): AuthRedis {
  return {
    get: (key) => redis.get(key),
    set: (key, value, mode, seconds) => redis.set(key, value, mode, seconds),
    del: (...keys) => redis.del(...keys),
    scan: (cursor, m, pattern, c, n) => redis.scan(cursor, m, pattern, c, n),
  };
}

const PAYMENTS_TEAM = 8010;
const BILLING_TEAM = 8011;
const HIDDEN_TEAM = 8099;

let pool: Pool;
let redis: Redis;
let es: Client;
let app: FastifyInstance;
let sessionId: string;

interface FacetEntry {
  readonly value: string;
  readonly count: number;
}

interface SearchBody {
  readonly total: { value: number; relation: string };
  readonly items: {
    kind: string;
    repository: string | null;
    pr_number?: number;
    commit_sha?: string;
    title: string | null;
    highlight?: Record<string, { text: string; matches: { start: number; end: number }[] }[]>;
  }[];
  readonly facets?: Record<string, FacetEntry[]>;
  readonly facets_omitted?: boolean;
  readonly facets_status?: string;
  readonly next_cursor: string | null;
  readonly error?: { code: string; message: string };
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

function idsOf(body: SearchBody): string[] {
  return body.items.map((item) =>
    item.kind === 'commit' ? `c:${item.commit_sha ?? '?'}` : `pr:${String(item.pr_number ?? 0)}`,
  );
}

/** 8건: 작성자 셋·라벨 둘·브랜치 둘·상태 둘. bucket 단위 검증의 재료다. */
const PULL_REQUESTS = [
  { n: 1, repo: PAYMENTS, name: 'facets/payments', team: PAYMENTS_TEAM, author: 'kim', labels: ['backend'], base: 'main', state: 'merged', title: '결제 재시도 로직 retry', body: '지수 백오프로 재시도한다' },
  { n: 2, repo: PAYMENTS, name: 'facets/payments', team: PAYMENTS_TEAM, author: 'kim', labels: ['backend', 'urgent'], base: 'main', state: 'merged', title: '결제 취소 처리', body: '취소 요청을 멱등으로 만든다' },
  { n: 3, repo: PAYMENTS, name: 'facets/payments', team: PAYMENTS_TEAM, author: 'lee', labels: ['frontend'], base: 'main', state: 'open', title: '결제 화면 정리', body: '입력 검증을 앞으로 옮긴다' },
  { n: 4, repo: PAYMENTS, name: 'facets/payments', team: PAYMENTS_TEAM, author: 'lee', labels: ['backend'], base: 'release', state: 'merged', title: '환불 파이프라인', body: '환불 이벤트를 재처리한다' },
  { n: 5, repo: BILLING, name: 'facets/billing', team: BILLING_TEAM, author: 'park', labels: ['backend'], base: 'main', state: 'merged', title: '청구서 양식 invoice', body: '양식을 새로 그린다' },
  { n: 6, repo: BILLING, name: 'facets/billing', team: BILLING_TEAM, author: 'park', labels: ['frontend'], base: 'main', state: 'open', title: '청구 이력 화면', body: '이력을 페이지로 나눈다' },
  { n: 7, repo: BILLING, name: 'facets/billing', team: BILLING_TEAM, author: 'kim', labels: ['urgent'], base: 'develop', state: 'merged', title: '세금 계산 수정', body: '반올림 규칙을 고친다' },
  { n: 8, repo: BILLING, name: 'facets/billing', team: BILLING_TEAM, author: 'lee', labels: [], base: 'develop', state: 'open', title: '<script>alert(1)</script> 결제 연동', body: '마크업이 든 제목이다' },
] as const;

const HIDDEN_PR = {
  n: 99, repo: HIDDEN, name: 'facets-other/secret', team: HIDDEN_TEAM, author: 'mallory',
  labels: ['classified'], base: 'secret-main', state: 'merged',
  title: '결제 비밀 계획', body: '보이면 안 된다',
} as const;

function prDocument(one: typeof PULL_REQUESTS[number] | typeof HIDDEN_PR): Record<string, unknown> {
  return {
    document_version: 1,
    repository_id: one.repo,
    repository: one.name,
    org_id: one.repo === HIDDEN ? HIDDEN_ORG : ORG,
    visibility: 'internal',
    allowed_team_ids: [one.team],
    pr_number: one.n,
    title: one.title,
    body: one.body,
    state: one.state,
    author: one.author,
    labels: [...one.labels],
    base_branch: one.base,
    head_branch: `feature/pr-${String(one.n)}`,
    merge_seq: 1000 + one.n,
    seq_epoch: 1,
    sequence_space: `${one.name}@${one.base}`,
    created_at: '2026-08-01T00:00:00Z',
    // 서수 순서와 시각 순서를 같게 둔다 — 정렬 키를 바꿔도 결과 집합이 같아야 한다.
    updated_at: `2026-08-${String(Math.min(10 + one.n, 28)).padStart(2, '0')}T00:00:00Z`,
    merged_at:
      one.state === 'merged'
        ? `2026-08-${String(Math.min(10 + one.n, 28)).padStart(2, '0')}T00:00:00Z`
        : undefined,
    changed_files_count: one.n,
    additions: one.n * 10,
    deletions: one.n,
    changed_paths: [`src/pr-${String(one.n)}.ts`],
    indexed_at: '2026-08-27T00:00:00Z',
  };
}

/**
 * 커밋 둘 — 같은 메시지 낱말을 갖되 `role`이 다르다.
 *
 * `source_commit`이 전문 검색에 걸리면 AC-1이 정한 범위를 넘는다 (DEV-283).
 */
const COMMITS = [
  { id: 'facet-merge', sha: 'b'.repeat(40), role: 'merge_commit', message: '결제 재시도 병합 커밋 메시지' },
  { id: 'facet-source', sha: 'c'.repeat(40), role: 'source_commit', message: '결제 재시도 원본 커밋 메시지' },
] as const;

beforeAll(async () => {
  pool = await migratedPool();
  redis = createTestRedis();
  es = createEsClient(resolveClientOptions());
  await applyMappings(es);
  // 매핑 버전이 올라간 별칭을 현재 정의로 옮긴다 (WP-032). 시험 전용.
  await switchAliasesForTests(es);

  await pool.query('DELETE FROM permission_cache WHERE user_id = $1', [USER]);
  await pool.query('DELETE FROM app_user WHERE user_id = $1', [USER]);
  await pool.query('DELETE FROM team WHERE team_id = ANY($1::bigint[])', [
    [PAYMENTS_TEAM, BILLING_TEAM, HIDDEN_TEAM],
  ]);
  await pool.query('DELETE FROM repository WHERE repository_id = ANY($1::bigint[])', [
    [PAYMENTS, BILLING, HIDDEN],
  ]);

  /*
   * **로그인 이름이 스위트마다 달라야 한다.**
   *
   * `app_user.login`에 UNIQUE가 걸려 있고 공유 `prs_test`를 다른 파일도 쓴다 —
   * `kim`처럼 흔한 이름을 쓰면 먼저 돈 스위트의 행과 부딪힌다 (risks 16).
   */
  await authRepo.upsertUserOnLogin(pool, { user_id: USER, login: 'facets-kim', github_user_id: 8_001 });
  await authRepo.upsertTeam(pool, { team_id: PAYMENTS_TEAM, slug: 'payments-core', org_id: ORG });
  await authRepo.upsertTeam(pool, { team_id: BILLING_TEAM, slug: 'billing-core', org_id: ORG });
  await authRepo.upsertTeam(pool, { team_id: HIDDEN_TEAM, slug: 'secret-team', org_id: HIDDEN_ORG });

  /*
   * **저장소 slug도 스위트 전용이다.** `repository(owner, name)`에 UNIQUE가
   * 걸려 있어 `acme/payments`를 다른 파일이 먼저 등록하면 부딪힌다.
   */
  for (const [id, owner, name, org] of [
    [PAYMENTS, 'facets', 'payments', ORG],
    [BILLING, 'facets', 'billing', ORG],
    [HIDDEN, 'facets-other', 'secret', HIDDEN_ORG],
  ] as const) {
    await repositoryRepo.upsertRepository(pool, {
      repository_id: id, owner, name, org_id: org, visibility: 'internal', sequence_branches: ['main'],
    });
  }

  /*
   * **이 스위트의 저장소만 지운다.**
   *
   * 공유 `prs_test`·공유 Elasticsearch에서 전역 삭제를 걸면 같은 실행의 다른
   * 파일이 심어 둔 문서를 지운다 (risks 16·30에서 세 번 겪었다).
   */
  await es.deleteByQuery({
    index: ['prs-pull-requests', 'prs-commits'],
    query: { terms: { repository_id: [PAYMENTS, BILLING, HIDDEN] } },
    refresh: true,
    conflicts: 'proceed',
  });

  const bulk = await es.bulk({
    refresh: true,
    operations: [
      ...[...PULL_REQUESTS, HIDDEN_PR].flatMap((one) => {
        const id = `facet-pr-${String(one.n)}`;
        return [
          { index: { _index: 'prs-pull-requests', _id: id, routing: String(one.repo) } },
          { ...prDocument(one), doc_id: id },
        ];
      }),
      ...COMMITS.flatMap((one) => [
        { index: { _index: 'prs-commits', _id: one.id, routing: String(PAYMENTS) } },
        {
          doc_id: one.id,
          document_version: 1,
          repository_id: PAYMENTS,
          repository: 'facets/payments',
          org_id: ORG,
          visibility: 'internal',
          allowed_team_ids: [PAYMENTS_TEAM],
          commit_sha: one.sha,
          message: one.message,
          role: one.role,
          author: 'kim',
          committed_at: '2026-08-19T04:00:00Z',
          authored_at: '2026-08-19T04:00:00Z',
          base_branch: 'main',
          merge_seq: 1500,
          seq_epoch: 1,
          sequence_space: 'facets/payments@main',
          indexed_at: '2026-08-27T00:00:00Z',
        },
      ]),
    ],
  });
  if (bulk.errors) {
    const reasons = bulk.items.map((item) => item.index?.error?.reason).filter((one) => one !== undefined);
    throw new Error(`fixture 색인이 거부됐다: ${reasons.join(' / ')}`);
  }

  const sessions = new SessionStore({ redis: redisPort() });
  const source: AccessScopeSource = {
    fetch: async () => ({
      repositoryIds: [PAYMENTS, BILLING],
      orgIds: [ORG],
      teamIds: [PAYMENTS_TEAM, BILLING_TEAM],
      visibilities: ['public', 'internal'],
    }),
  };

  const auth: AuthContext = {
    sessions,
    scopes: new AccessScopeResolver({ redis: redisPort(), db: createScopeDatabase(pool), source }),
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
      resolveTeamSlugs: (ids) => authRepo.resolveTeamSlugs(pool, ids),
    },
  });
  await app.ready();
}, 180_000);

beforeEach(async () => {
  await redis.del(scopeKey(USER));
  sessionId = createSessionId();
  const now = Date.now();
  await new SessionStore({ redis: redisPort() }).create({
    sessionId, userId: USER, login: 'facets-kim', email: null,
    roles: ['developer'], issuedAt: now, lastSeenAt: now, correlationId: null,
  });
});

afterAll(async () => {
  await app?.close();
  await es?.close();
  redis?.disconnect();
  await pool?.end();
});

describe('패싯 응답 상태 (FR-SRCH-009, CR-043 DEV-277)', () => {
  it('요청하지 않으면 **세 키가 모두 없다** — 빈 분포와 다르다', async () => {
    const { body } = await get('q=repo%3Afacets%2Fpayments');
    expect(body.facets).toBeUndefined();
    expect(body.facets_omitted).toBeUndefined();
    expect(body.facets_status).toBeUndefined();
  });

  it('요청하면 여섯 축을 준다 (AC-1)', async () => {
    const { body } = await get('q=repo%3Afacets%2Fpayments&facets=true');
    expect(body.facets_status).toBe('ready');
    expect(body.facets_omitted).toBe(false);
    // 값이 없는 축은 키를 만들지 않는다 — 빈 배열을 그리지 않는다.
    expect(Object.keys(body.facets ?? {}).sort()).toEqual(
      ['author', 'base_branch', 'label', 'repository', 'state', 'team'].sort(),
    );
  });

  it('상위 20까지만 준다 (AC-1)', async () => {
    const { body } = await get('facets=true');
    for (const [axis, values] of Object.entries(body.facets ?? {})) {
      expect(values.length, axis).toBeLessThanOrEqual(20);
    }
  });
});

describe('bucket 단위 검증 (QA-W001-16, DEV-276)', () => {
  /*
   * **`sum(buckets) == total`로 검증하지 않는다.** 그 식은 틀리다 —
   * 상위 20 절삭, 다중 값 필드(`label`·`allowed_team_ids`), `track_total_hits`
   * 근사 셋 때문이다. 검증은 bucket 하나하나를 독립 조회와 대조하는 것이다.
   */
  it('각 bucket count가 그 필터만 더한 독립 조회와 같다', async () => {
    const base = 'repo:facets/payments';
    const { body } = await get(`q=${encodeURIComponent(base)}&facets=true`);
    expect(body.facets_status).toBe('ready');

    const axisToKey: Record<string, string> = {
      author: 'author',
      label: 'label',
      base_branch: 'base',
      state: 'state',
      repository: 'repo',
    };

    let checked = 0;
    for (const [axis, values] of Object.entries(body.facets ?? {})) {
      const key = axisToKey[axis];
      if (key === undefined) continue;
      for (const entry of values) {
        const narrowed = `${base} ${key}:${entry.value}`;
        const independent = await get(`q=${encodeURIComponent(narrowed)}&size=200`);
        expect(independent.body.total.value, `${axis}=${entry.value}`).toBe(entry.count);
        checked += 1;
      }
    }
    // 검사기가 아무것도 안 보고 초록을 내는 것을 막는다.
    expect(checked).toBeGreaterThan(5);
  });

  it('bucket 합과 total은 같아지지 않는다 — 그래서 합으로 검증할 수 없다', async () => {
    const { body } = await get('q=repo%3Afacets%2Fpayments&facets=true');
    const labels = body.facets?.['label'] ?? [];
    const sum = labels.reduce((acc, one) => acc + one.count, 0);

    /*
     * **`sum(buckets) == total`은 틀린 식이다** (DEV-276).
     *
     * 여기서는 두 방향으로 어긋난다 — 라벨을 가진 PR은 넷인데 #2가 라벨 둘을
     * 가져 합이 다섯이고, `total`은 커밋까지 세어 여섯이다. 어느 쪽이든 합과
     * 총계는 만나지 않는다.
     */
    const whole = await get('q=repo%3Afacets%2Fpayments&size=200');
    const prCount = whole.body.items.filter((one) => one.kind === 'pull_request').length;
    expect(sum).toBeGreaterThan(prCount);
    expect(sum).not.toBe(body.total.value);
  });
});

describe('접근 통제 (THR-003)', () => {
  /*
   * 이것이 패싯의 가장 무거운 불변식이다. 목록에 안 나오는 저장소의 값이
   * **분포에는 나오는** 상태는 조용한 유출이다 — 사용자는 자기가 볼 수 없는
   * 저장소에 어떤 팀·라벨·작성자가 있는지 알게 된다.
   */
  it('접근 범위 밖 저장소의 작성자·라벨·저장소가 bucket에 없다', async () => {
    const { body } = await get('facets=true&size=200');
    const flat = JSON.stringify(body.facets ?? {});
    expect(flat).not.toContain('mallory');
    expect(flat).not.toContain('classified');
    expect(flat).not.toContain('facets-other/secret');
    expect(flat).not.toContain('secret-main');
  });

  it('그 저장소의 팀도 없다 — `team` bucket이 `allowed_team_ids`를 세기 때문이다', async () => {
    const { body } = await get('facets=true&size=200');
    const teams = (body.facets?.['team'] ?? []).map((one) => one.value);
    expect(teams).not.toContain('secret-team');
    expect(teams).not.toContain(String(HIDDEN_TEAM));
  });

  it('목록에도 없다 — 분포와 목록이 같은 질의를 지난다', async () => {
    const { body } = await get('q=%EA%B2%B0%EC%A0%9C&size=200');
    expect(idsOf(body)).not.toContain('pr:99');
  });
});

describe('team 패싯은 slug으로 해석된다 (DEV-281)', () => {
  it('숫자가 아니라 이름이 나간다', async () => {
    const { body } = await get('facets=true&size=200');
    const teams = (body.facets?.['team'] ?? []).map((one) => one.value).sort();
    expect(teams).toEqual(['billing-core', 'payments-core']);
  });

  it('`team:` 질의 키와 같은 것을 센다 — 눌렀을 때 건수가 같아야 한다', async () => {
    const { body } = await get('facets=true&size=200');
    const bucket = (body.facets?.['team'] ?? []).find((one) => one.value === 'payments-core');
    expect(bucket).toBeDefined();
    const narrowed = await get('q=team%3Apayments-core&size=200');
    expect(narrowed.body.total.value).toBe(bucket?.count);
  });

  /*
   * **slug은 조직 안에서만 유일하다** (`UNIQUE (org_id, slug)`) — PR #57 리뷰 P2.
   *
   * 서로 다른 조직의 같은 이름 팀이 각각 bucket이 되면, 표시값으로 옮긴 뒤
   * 같은 이름이 두 줄로 나온다. 화면에서는 중복된 체크박스 ID가 되고, 어느
   * 쪽을 눌러도 질의는 `team:<slug>` 하나다 — **누른 것과 나온 것이 달라진다.**
   */
  it('다른 조직의 같은 slug을 한 bucket으로 합치고, 눌렀을 때 그 건수가 나온다', async () => {
    const OTHER_ORG_TEAM = 8_012;
    await authRepo.upsertTeam(pool, { team_id: OTHER_ORG_TEAM, slug: 'payments-core', org_id: HIDDEN_ORG });
    // 접근 범위 **안**의 문서 하나에 그 팀을 더한다 — 두 ID가 함께 세어져야 한다.
    await es.update({
      index: 'prs-pull-requests',
      id: 'facet-pr-5',
      routing: String(BILLING),
      refresh: true,
      doc: { allowed_team_ids: [BILLING_TEAM, OTHER_ORG_TEAM] },
    });

    try {
      const { body } = await get('facets=true&size=200');
      const teams = (body.facets?.['team'] ?? []).map((one) => one.value);
      // 같은 이름이 두 줄로 나오지 않는다.
      expect(teams.filter((one) => one === 'payments-core')).toHaveLength(1);

      const bucket = (body.facets?.['team'] ?? []).find((one) => one.value === 'payments-core');
      // 합친 건수가 그 이름으로 좁힌 조회와 같다 — `resolveTeamIds`가 ID를 전부 준다.
      const narrowed = await get('q=team%3Apayments-core&size=200');
      expect(narrowed.body.total.value).toBe(bucket?.count);
      // 두 팀에 걸친 문서가 실제로 포함된다.
      expect(idsOf(narrowed.body)).toContain('pr:5');
    } finally {
      await es.update({
        index: 'prs-pull-requests',
        id: 'facet-pr-5',
        routing: String(BILLING),
        refresh: true,
        doc: { allowed_team_ids: [BILLING_TEAM] },
      });
      await pool.query('DELETE FROM team WHERE team_id = $1', [OTHER_ORG_TEAM]);
    }
  });
});

describe('커서 페이지네이션 (FR-SRCH-008)', () => {
  /**
   * 페이지를 끝까지 넘기며 모은다. `size`를 바꿔 가며 부를 수 있어야 한다 —
   * `size`는 지문에 없기 때문이다 (DEV-272).
   */
  async function walk(query: string, sizes: readonly number[]): Promise<string[]> {
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 20; page += 1) {
      const size = sizes[Math.min(page, sizes.length - 1)] as number;
      const suffix: string = cursor === null ? '' : `&cursor=${encodeURIComponent(cursor)}`;
      const { status, body } = await get(`${query}&size=${String(size)}${suffix}`);
      expect(status, JSON.stringify(body)).toBe(200);
      seen.push(...idsOf(body));
      cursor = body.next_cursor;
      if (cursor === null) return seen;
    }
    throw new Error('커서가 끝나지 않았다 — 순회가 수렴하지 않는다');
  }

  it('전량을 중복·누락 없이 훑는다', async () => {
    const all = await walk('q=repo%3Afacets%2Fpayments', [2]);
    expect(new Set(all).size).toBe(all.length);
    const whole = await get('q=repo%3Afacets%2Fpayments&size=200');
    expect(all.sort()).toEqual(idsOf(whole.body).sort());
  });

  it('마지막 페이지에서 `next_cursor`가 null이다 (AC-1)', async () => {
    /*
     * **정확히 나누어떨어지는 경우**가 이 단언의 요점이다.
     *
     * `size`만 읽으면 "더 있는가"를 알 수 없어 빈 페이지를 한 번 더 내주게
     * 된다. 한 건 더 읽어 판정하므로 마지막 페이지에서 커서가 없다.
     */
    const whole = await get('q=repo%3Afacets%2Fpayments&size=200');
    const total = whole.body.items.length;
    const { body } = await get(`q=repo%3Afacets%2Fpayments&size=${String(total)}`);
    expect(body.items).toHaveLength(total);
    expect(body.next_cursor).toBeNull();
  });

  it('`size` 200 초과는 절삭이지 오류가 아니다 (AC-2)', async () => {
    const { status, body } = await get('size=100000');
    expect(status).toBe(200);
    expect(body.items.length).toBeLessThanOrEqual(200);
  });

  /*
   * `size`를 지문에서 뺀 판단(DEV-272)이 정확성을 깨지 않는지 **실측한다.**
   * 추측으로 넣지 않기로 했으므로, 그 추측을 시험이 대신 답한다.
   */
  it('페이지마다 `size`를 바꿔도 중복·누락이 없다', async () => {
    const all = await walk('q=repo%3Afacets%2Fbilling', [1, 3, 2]);
    expect(new Set(all).size).toBe(all.length);
    const whole = await get('q=repo%3Afacets%2Fbilling&size=200');
    expect(all.sort()).toEqual(idsOf(whole.body).sort());
  });

  it('어떤 정렬 키에서도 중복·누락이 없다 (QA-W001-29, DEV-286)', async () => {
    const whole = await get('q=repo%3Afacets%2Fpayments&size=200');
    const expected = idsOf(whole.body).sort();
    /*
     * 여섯 키 중 셋(`merged_at`·`updated_at`·`additions`)은 커밋 문서에 **없다** —
     * 누락 센티널을 커서로 되먹이는 경로가 바로 여기다 (DEV-329).
     */
    for (const sort of ['merge_seq', 'merged_at', 'updated_at', 'created_at', 'relevance', 'additions']) {
      const all = await walk(`q=repo%3Afacets%2Fpayments&sort=${sort}`, [2]);
      expect(new Set(all).size, sort).toBe(all.length);
      expect(all.sort(), sort).toEqual(expected);
    }
  });

  /*
   * **PIT이 지키는 것은 "값이 움직이지 않는 뷰"다** (DEV-286).
   *
   * 처음에는 순회 중에 **새 문서**를 넣어 이것을 재려 했다. 변이(M2 — 페이지마다
   * PIT을 새로 연다)가 살아남아 경로를 읽었더니, 새 문서가 경계보다 **앞에**
   * 정렬되면 `search_after`가 그것을 자연히 배제한다 — PIT이 없어도 결과가
   * 같으므로 그 시험은 PIT을 보고 있지 않았다.
   *
   * 실제로 깨지는 것은 **이미 본 문서의 정렬 값이 아직 안 본 구간으로 움직일
   * 때**다. 그러면 뷰가 고정되지 않은 순회는 그 문서를 **두 번** 내준다.
   * `updated_at`은 모든 PR 갱신 웹훅이 움직이는 값이라 이것은 가정이 아니다.
   */
  it('이미 본 문서의 정렬 값이 움직여도 두 번 나오지 않는다 (QA-W001-29, DEV-286)', async () => {
    const query = 'q=repo%3Afacets%2Fpayments&size=2&sort=updated_at&order=desc';
    const first = await get(query);
    expect(first.body.next_cursor).not.toBeNull();
    expect(first.body.items.length).toBe(2);

    // 첫 페이지에 실린 문서 하나를 고른다 — 이미 지나간 자리다.
    const moved = first.body.items[0];
    const movedId = `facet-pr-${String(moved?.pr_number ?? 0)}`;
    const original = await es.get<Record<string, unknown>>({
      index: 'prs-pull-requests',
      id: movedId,
      routing: String(PAYMENTS),
    });

    try {
      /*
       * 그 문서를 **아직 안 본 구간**으로 밀어 넣는다.
       *
       * 내림차순이므로 `updated_at`을 가장 오래된 값보다 더 뒤로 보내면 순회의
       * 끝자락에 다시 나타날 자리가 생긴다. 뷰가 고정돼 있으면 그 변경은 이
       * 순회에 보이지 않는다.
       */
      await es.update({
        index: 'prs-pull-requests',
        id: movedId,
        routing: String(PAYMENTS),
        refresh: true,
        doc: { updated_at: '1999-01-01T00:00:00Z' },
      });

      const seen = [...idsOf(first.body)];
      let cursor: string | null = first.body.next_cursor;
      for (let page = 0; page < 20 && cursor !== null; page += 1) {
        const next = await get(`${query}&cursor=${encodeURIComponent(cursor)}`);
        expect(next.status, JSON.stringify(next.body.error)).toBe(200);
        seen.push(...idsOf(next.body));
        cursor = next.body.next_cursor;
      }

      // **중복이 없다.** 뷰가 고정되지 않았다면 옮긴 문서가 뒤에서 다시 나온다.
      expect(new Set(seen).size, `중복: ${seen.join(',')}`).toBe(seen.length);
      // 그리고 아무것도 잃지 않았다.
      const whole = await get('q=repo%3Afacets%2Fpayments&size=200');
      expect([...seen].sort()).toEqual(idsOf(whole.body).sort());
    } finally {
      const source = original._source as Record<string, unknown>;
      await es.update({
        index: 'prs-pull-requests',
        id: movedId,
        routing: String(PAYMENTS),
        refresh: true,
        doc: { updated_at: source['updated_at'] },
      });
    }
  });

  it('오프셋 파라미터가 존재하지 않는다 (AC-4, ADR-010)', async () => {
    // `from`·`offset`을 줘도 아무 일도 일어나지 않는다 — 무시된다.
    const plain = await get('q=repo%3Afacets%2Fpayments&size=2');
    const offset = await get('q=repo%3Afacets%2Fpayments&size=2&from=2&offset=2&page=2');
    expect(idsOf(offset.body)).toEqual(idsOf(plain.body));
  });
});

describe('커서 실패의 두 갈래 (DEV-273)', () => {
  async function firstCursor(query: string): Promise<string> {
    const { body } = await get(`${query}&size=1`);
    expect(body.next_cursor).not.toBeNull();
    return body.next_cursor as string;
  }

  it('질의가 바뀌면 `CURSOR_QUERY_MISMATCH`다 (AC-3)', async () => {
    const cursor = await firstCursor('q=repo%3Afacets%2Fpayments');
    const { status, body } = await get(
      `q=${encodeURIComponent('repo:facets/billing')}&size=1&cursor=${encodeURIComponent(cursor)}`,
    );
    expect(status).toBe(400);
    expect(body.error?.code).toBe('CURSOR_QUERY_MISMATCH');
  });

  it('정렬이 바뀌어도 `CURSOR_QUERY_MISMATCH`다 — 순서가 달라지면 위치가 뜻이 없다', async () => {
    const cursor = await firstCursor('q=repo%3Afacets%2Fpayments');
    const { status, body } = await get(
      `q=${encodeURIComponent('repo:facets/payments')}&sort=created_at&size=1&cursor=${encodeURIComponent(cursor)}`,
    );
    expect(status).toBe(400);
    expect(body.error?.code).toBe('CURSOR_QUERY_MISMATCH');
  });

  it('봉투를 손으로 고치면 `CURSOR_INVALID`다 — 서명이 실제로 걸린다', async () => {
    const cursor = await firstCursor('q=repo%3Afacets%2Fpayments');
    const [payload, signature] = cursor.split('.');
    const decoded = JSON.parse(Buffer.from(String(payload), 'base64url').toString('utf8')) as Record<string, unknown>;
    decoded['s'] = [999_999];
    const forged = `${Buffer.from(JSON.stringify(decoded), 'utf8').toString('base64url')}.${String(signature)}`;

    const { status, body } = await get(
      `q=${encodeURIComponent('repo:facets/payments')}&size=1&cursor=${encodeURIComponent(forged)}`,
    );
    expect(status).toBe(400);
    expect(body.error?.code).toBe('CURSOR_INVALID');
  });

  it('형식이 아니면 `CURSOR_INVALID`다', async () => {
    const { status, body } = await get('q=repo%3Afacets%2Fpayments&cursor=garbage');
    expect(status).toBe(400);
    expect(body.error?.code).toBe('CURSOR_INVALID');
  });

  it('빈 커서는 첫 페이지다 — 오류가 아니다', async () => {
    const { status } = await get('q=repo%3Afacets%2Fpayments&cursor=');
    expect(status).toBe(200);
  });

  /*
   * **권한이 회수되면 진행 중이던 페이징이 죽는다 — 그것이 옳다.**
   *
   * 이전 권한 집합 기준으로 계산된 순서를 회수 뒤에 이어 쓰면 사용자는 지금
   * 볼 수 없는 문서 사이의 위치에서 페이징을 계속하게 된다.
   */
  it('`access_scope_version`이 오르면 진행 중 커서가 거절된다', async () => {
    const cursor = await firstCursor('q=repo%3Afacets%2Fpayments');
    await authRepo.invalidateUsers(pool, [USER]);
    await redis.del(scopeKey(USER));

    const { status, body } = await get(
      `q=${encodeURIComponent('repo:facets/payments')}&size=1&cursor=${encodeURIComponent(cursor)}`,
    );
    expect(status).toBe(400);
    expect(body.error?.code).toBe('CURSOR_QUERY_MISMATCH');
  });
});

describe('이어 보기와 패싯 (QA-W001-27)', () => {
  it('`facets=false`면 세 키가 없다 — 이어 보기가 분포를 다시 세지 않는다', async () => {
    const first = await get('q=repo%3Afacets%2Fpayments&size=1&facets=true');
    expect(first.body.facets_status).toBe('ready');

    const next = await get(
      `q=${encodeURIComponent('repo:facets/payments')}&size=1&cursor=${encodeURIComponent(String(first.body.next_cursor))}`,
    );
    expect(next.status).toBe(200);
    expect(next.body.facets).toBeUndefined();
    expect(next.body.facets_omitted).toBeUndefined();
  });

  it('패싯 요청 여부가 커서를 무효화하지 않는다 — 표현이지 정체성이 아니다 (DEV-272)', async () => {
    const first = await get('q=repo%3Afacets%2Fpayments&size=1&facets=true');
    const next = await get(
      `q=${encodeURIComponent('repo:facets/payments')}&size=1&facets=true&cursor=${encodeURIComponent(String(first.body.next_cursor))}`,
    );
    expect(next.status).toBe(200);
  });
});

describe('전문 검색 (FR-SRCH-011)', () => {
  it('한글 부분 일치가 걸린다 — `nori` 없이 (AC-4, OD-005)', async () => {
    const { body } = await get('q=%EA%B2%B0%EC%A0%9C&size=200');
    // "결제"는 어떤 제목에서도 독립 토큰이 아니다 — edge_ngram이 없으면 0건이다.
    expect(body.total.value).toBeGreaterThan(0);
  });

  it('한글·영문 혼용 질의가 두 토큰을 모두 본다 (AC-4)', async () => {
    const mixed = await get(`q=${encodeURIComponent('결제 retry')}&size=200`);
    const single = await get(`q=${encodeURIComponent('retry')}&size=200`);
    expect(mixed.body.total.value).toBeGreaterThanOrEqual(single.body.total.value);
    // 한글만 맞은 문서도, 영문만 맞은 문서도 함께 나온다.
    expect(idsOf(mixed.body)).toContain('pr:1');
    expect(idsOf(mixed.body)).toContain('pr:2');
  });

  it('제목 일치가 본문 일치보다 상위다 (AC-2)', async () => {
    // "환불"은 PR #4의 제목과 본문 양쪽에, 다른 문서에는 없다. 제목 가중치를
    // 확인하려면 제목에만 있는 낱말과 본문에만 있는 낱말을 함께 물어야 한다.
    const { body } = await get(`q=${encodeURIComponent('invoice 멱등')}&sort=relevance&size=200`);
    // `invoice`는 PR #5 제목, `멱등`은 PR #2 본문.
    expect(idsOf(body).slice(0, 2)).toContain('pr:5');
    expect(idsOf(body)[0]).toBe('pr:5');
  });

  /*
   * **AC-1이 정한 커밋 축은 머지 커밋 메시지다** (DEV-283).
   *
   * 두 커밋이 같은 낱말을 갖고 `role`만 다르다 — 원본 커밋이 나오면 승인된
   * 범위를 넘은 것이다.
   */
  it('`source_commit` 메시지가 전문 검색에 걸리지 않는다', async () => {
    const { body } = await get(`q=${encodeURIComponent('병합 원본')}&size=200`);
    const ids = idsOf(body);
    expect(ids).toContain(`c:${'b'.repeat(40)}`);
    expect(ids).not.toContain(`c:${'c'.repeat(40)}`);
  });

  it('구조화 필터로는 원본 커밋을 여전히 찾는다 — 기존 동작이 바뀌지 않는다', async () => {
    const { body } = await get('q=repo%3Afacets%2Fpayments&size=200');
    expect(idsOf(body)).toContain(`c:${'c'.repeat(40)}`);
  });

  it('`relevance`가 요청한 방향을 존중한다 (FR-SRCH-007 AC-1, DEV-275)', async () => {
    const desc = await get(`q=${encodeURIComponent('결제')}&sort=relevance&order=desc&size=200`);
    const asc = await get(`q=${encodeURIComponent('결제')}&sort=relevance&order=asc&size=200`);
    expect(idsOf(desc.body).length).toBeGreaterThan(1);
    // 같은 집합이다 — 방향만 바뀐다.
    expect([...idsOf(asc.body)].sort()).toEqual([...idsOf(desc.body)].sort());

    /*
     * **정확한 역순도, 특정 자리도 요구하지 않는다.**
     *
     * 처음에는 `asc`의 마지막이 `desc`의 첫 항목이라고 단언했다. **CI가 그것을
     * 깼다** — 로컬에서는 최상위 점수가 유일했지만 CI에서는 동률이었다. BM25의
     * term statistics는 샤드 분포와 문서 수에 따라 달라지므로 "누가 1등인가"는
     * 환경마다 다를 수 있고, 동률 무리는 어느 방향에서도 `doc_id` 오름차순으로
     * 갈린다(AC-4의 결정론) — 그 무리의 내부 순서는 뒤집히지 않는다.
     *
     * 이 계층이 실제로 걸 것은 **방향이 API를 지나 적용된다**는 사실이다.
     * `_score`에 요청한 방향이 실린다는 주장은 `packages/es/src/sort.test.ts`가
     * 결정론적으로 핀으로 박는다 — 여기서 그것을 다시 재려 하면 점수 계산에
     * 시험을 매다는 셈이 된다.
     */
    expect(idsOf(asc.body)[0]).not.toBe(idsOf(desc.body)[0]);
  });

  it('코드 포인트 한 글자는 `QUERY_TOO_SHORT`다 (QA-W001-28, DEV-284)', async () => {
    for (const raw of ['\u{20BB7}', '\u{1F600}', '가']) {
      const { status, body } = await get(`q=${encodeURIComponent(raw)}`);
      expect(status, raw).toBe(400);
      expect(body.error?.code, raw).toBe('QUERY_TOO_SHORT');
    }
  });
});

/*
 * **재현하는 문제** (DEV-722). `standard` 토크나이저는 하이픈에서도 끊는다 —
 * `VANGUARD-1`은 `vanguard`·`1` 두 토큰이 된다. 기본 OR(`best_fields`)에서는
 * 흔한 토큰 `1` 하나만 맞아도 매치되므로, 본문 어딘가에 숫자 `1`이 있을 뿐인
 * 무관한 문서가 함께 걸린다. 이 스위트 전용 문서 둘을 따로 색인하고 정리한다 —
 * 공유 `PULL_REQUESTS` fixture는 다른 describe의 bucket·total 단언이 딛고 있어
 * 건드리지 않는다.
 */
describe('식별자가 하이픈으로 쪼개지는 전문 검색 (FR-SRCH-011 AC-4, DEV-722)', () => {
  const VANGUARD_ID = 'facet-pr-vanguard-1';
  const STRAY_DIGIT_ID = 'facet-pr-stray-digit';

  function identifierDocument(
    id: string,
    n: number,
    title: string,
    body: string,
  ): Record<string, unknown> {
    return {
      document_version: 1,
      repository_id: PAYMENTS,
      repository: 'facets/payments',
      org_id: ORG,
      visibility: 'internal',
      allowed_team_ids: [PAYMENTS_TEAM],
      doc_id: id,
      pr_number: n,
      title,
      body,
      state: 'merged',
      author: 'kim',
      labels: [],
      base_branch: 'main',
      head_branch: `feature/pr-${String(n)}`,
      merge_seq: 1000 + n,
      seq_epoch: 1,
      sequence_space: 'facets/payments@main',
      created_at: '2026-08-01T00:00:00Z',
      updated_at: '2026-08-21T00:00:00Z',
      merged_at: '2026-08-21T00:00:00Z',
      changed_files_count: 1,
      additions: 10,
      deletions: 1,
      changed_paths: [`src/pr-${String(n)}.ts`],
      indexed_at: '2026-08-27T00:00:00Z',
    };
  }

  beforeAll(async () => {
    const bulk = await es.bulk({
      refresh: true,
      operations: [
        { index: { _index: 'prs-pull-requests', _id: VANGUARD_ID, routing: String(PAYMENTS) } },
        identifierDocument(
          VANGUARD_ID,
          901,
          'VANGUARD-1 배포 안정화',
          '릴리스 식별자를 문서 제목에 그대로 적는다',
        ),
        { index: { _index: 'prs-pull-requests', _id: STRAY_DIGIT_ID, routing: String(PAYMENTS) } },
        identifierDocument(
          STRAY_DIGIT_ID,
          902,
          '결제 정책 문서 버전 1',
          'VANGUARD와 무관하게 숫자 하나만 등장한다',
        ),
      ],
    });
    if (bulk.errors) {
      const reasons = bulk.items.map((item) => item.index?.error?.reason).filter((one) => one !== undefined);
      throw new Error(`fixture 색인이 거부됐다: ${reasons.join(' / ')}`);
    }
  });

  afterAll(async () => {
    await es.deleteByQuery({
      index: 'prs-pull-requests',
      query: { ids: { values: [VANGUARD_ID, STRAY_DIGIT_ID] } },
      refresh: true,
      conflicts: 'proceed',
    });
  });

  it('제목이 하이픈으로 쪼개지는 식별자를 구문으로 묶어 매칭한다 (AC-4, DEV-722)', async () => {
    const { body } = await get(`q=${encodeURIComponent('VANGUARD-1')}&size=200`);
    const ids = idsOf(body);
    expect(ids).toContain('pr:901');
    // 숫자 `1`만 우연히 같을 뿐 `VANGUARD`와는 무관한 문서는 걸리지 않는다.
    expect(ids).not.toContain('pr:902');
  });
});

describe('강조 (AC-5, THR-018)', () => {
  it('평문 조각과 일치 구간을 준다 — 마크업이 아니다', async () => {
    const { body } = await get(`q=${encodeURIComponent('결제')}&size=200`);
    // 커밋 행은 `message` 축이라 `title`이 없다 — 제목 축을 가진 행을 고른다.
    const withHighlight = body.items.find((item) => item.highlight?.['title'] !== undefined);
    expect(withHighlight).toBeDefined();

    const fragment = withHighlight?.highlight?.['title']?.[0];
    expect(fragment).toBeDefined();
    expect(fragment?.matches.length).toBeGreaterThan(0);
    const { start, end } = fragment?.matches[0] as { start: number; end: number };
    expect(fragment?.text.slice(start, end)).toBe('결제');
  });

  it('API가 만든 마크업이 응답에 없다', async () => {
    const { body } = await get(`q=${encodeURIComponent('결제')}&size=200`);
    const flat = JSON.stringify(body.items.map((item) => item.highlight));
    expect(flat).not.toContain('<em>');
    expect(flat).not.toContain('</em>');
    // 사설 사용 영역 표식도 경계를 넘지 않는다.
    expect(flat).not.toContain('\u{E000}');
    expect(flat).not.toContain('\u{E001}');
  });

  /*
   * **원문의 마크업은 글자로 남는다.** 계약이 금지하는 것은 "API가 만들어 낸
   * 마크업"이지 사용자가 쓴 글자가 아니다 — 화면이 그것을 텍스트 노드로 그린다.
   */
  it('마크업을 담은 제목도 평문 조각으로 나간다 (QA-W001-26)', async () => {
    const { body } = await get(`q=${encodeURIComponent('연동')}&size=200`);
    const item = body.items.find((one) => one.pr_number === 8);
    expect(item).toBeDefined();
    const text = item?.highlight?.['title']?.[0]?.text ?? '';
    expect(text).toContain('<script>alert(1)</script>');
    expect(text).not.toContain('\u{E000}');
  });

  it('자유 텍스트가 없으면 강조가 없다 — 없는 일치를 그리지 않는다', async () => {
    const { body } = await get('q=repo%3Afacets%2Fpayments&size=200');
    for (const item of body.items) expect(item.highlight).toBeUndefined();
  });
});

/** 같은 세션·같은 범위를 쓰는 두 번째 서버. 예산·해석만 바꿔 끼운다. */
function narrowAuth(): AuthContext {
  return {
    sessions: new SessionStore({ redis: redisPort() }),
    scopes: new AccessScopeResolver({
      redis: redisPort(),
      db: createScopeDatabase(pool),
      source: {
        fetch: async () => ({
          repositoryIds: [PAYMENTS, BILLING],
          orgIds: [ORG],
          teamIds: [PAYMENTS_TEAM, BILLING_TEAM],
          visibilities: ['public', 'internal'],
        }),
      },
    }),
    forget: async () => undefined,
  };
}

describe('패싯 실패가 목록을 막지 않는다 (FR-SRCH-009 예외 처리)', () => {
  /*
   * 예산을 1ms로 낮춰 `budget_omitted`를 재현한다.
   *
   * 실제 예산(1.5초)으로는 시험 인덱스가 늘 이긴다 — 상태를 도달 가능하게
   * 만들지 못하면 화면이 그리는 갈래 하나가 영영 검증되지 않는다.
   */
  it('예산을 넘기면 `budget_omitted`이고 목록은 그대로다', async () => {
    const narrow = buildServer({
      config: {
        port: 0, adminTokens: [], metricsQueryUrl: null, gheBaseUrl: null,
        auth: AUTH_CONFIG, searchCursorKey: TEST_CURSOR_KEY,
      },
      auth: narrowAuth(),
      search: {
        pool,
        es,
        cursorSigner: TEST_CURSOR_SIGNER,
        resolveNames: async () => ({ orgIds: new Map(), teamIds: new Map() }),
        facetBudgetMs: 1,
      },
    });
    await narrow.ready();

    try {
      const response = await narrow.inject({
        method: 'GET',
        url: `${SEARCH_PATH}?q=${encodeURIComponent('repo:facets/payments')}&facets=true&size=200`,
        headers: { cookie: `${SESSION_COOKIE_NAME}=${sessionId}` },
      });
      const body = response.json<SearchBody>();
      expect(response.statusCode).toBe(200);
      // 예산이 이겼는지 아닌지는 클러스터가 정한다 — 어느 쪽이든 **목록은 산다.**
      expect(body.items.length).toBeGreaterThan(0);
      if (body.facets_status !== 'ready') {
        expect(body.facets_status).toBe('budget_omitted');
        expect(body.facets_omitted).toBe(true);
        expect(body.facets).toEqual({});
      }
    } finally {
      await narrow.close();
    }
  });

  it('팀 이름 해석이 실패해도 분포는 나간다 — 표시 이름과 분포는 다른 것이다', async () => {
    const broken = buildServer({
      config: {
        port: 0, adminTokens: [], metricsQueryUrl: null, gheBaseUrl: null,
        auth: AUTH_CONFIG, searchCursorKey: TEST_CURSOR_KEY,
      },
      auth: narrowAuth(),
      search: {
        pool,
        es,
        cursorSigner: TEST_CURSOR_SIGNER,
        resolveNames: async () => ({ orgIds: new Map(), teamIds: new Map() }),
        resolveTeamSlugs: () => Promise.reject(new Error('레지스트리 장애')),
      },
    });
    await broken.ready();

    try {
      const response = await broken.inject({
        method: 'GET',
        url: `${SEARCH_PATH}?facets=true&size=200`,
        headers: { cookie: `${SESSION_COOKIE_NAME}=${sessionId}` },
      });
      const body = response.json<SearchBody>();
      expect(body.facets_status).toBe('ready');
      // 이름을 못 얻은 팀은 **숫자로 남는다** — 버리면 그 건수가 조용히 사라진다.
      const teams = (body.facets?.['team'] ?? []).map((one) => one.value);
      expect(teams).toContain(String(PAYMENTS_TEAM));
    } finally {
      await broken.close();
    }
  });
});
