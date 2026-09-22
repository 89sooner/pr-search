/**
 * `GET /resolve?q=M-<코드>-<번호>` — M 번호 문자열의 식별자 해석 (CR-114 / FR-SRCH-001 AC-7).
 *
 * 실제 Fastify + PostgreSQL + Elasticsearch + Redis로 건다. 판별(`@prs/query`)은 단위
 * 시험이 보고, 여기서는 그 판별이 **정본**(`merge_sequence`의 현재 에폭 행)에서 옳은
 * PR을 집어 오는지, 접근 범위 밖 저장소가 어떤 경로로도 새지 않는지, 색인 문서가
 * 없어도 후보가 성립하는지, 기능이 꺼진 배포가 `merge_number_disabled`로 답하는지를 본다.
 *
 * ## 저장소 코드는 이름의 숫자 부분이다 (OD-009)
 *
 * 그래서 소유자가 다른 `cr114/smp1900`·`cr114b/app1900`은 같은 코드 `1900`을 갖고,
 * `M-1900-1450`은 둘 다의 후보가 된다 — AC-5가 정한 "후보 배열, 자동 이동 없음"이다.
 * 범위 밖 `cr114-hidden/web1900`도 같은 코드지만 응답 어디에도 나타나면 안 된다.
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
import { RESOLVE_PATH } from '../../src/resolve/routes.js';
import type { AuthContext, AuthRedis } from '../../src/auth/context.js';
import { createTestRedis, migratedPool } from '../helpers.js';
import { TEST_CURSOR_KEY, TEST_CURSOR_SIGNER } from '../_cursor-fixture.js';

const AUTH_CONFIG = {
  enabled: true,
  cookieSecure: true,
  loginPath: '/auth/login',
  groupRoleMap: new Map<string, never>(),
} as const;

const USER = 'sub-cr114-resolve';
// CR 번호를 딴 저장소 ID 대역 — 다른 통합 시험 파일과 겹치지 않는다.
const SMP = 11_401;
const APP = 11_402;
const HIDDEN = 11_403;
const DUAL = 11_404;
const ORG = 114;
const OTHER_ORG = 115;
const HIDDEN_ORG = 116;
const EPOCH = 3;

let pool: Pool;
let redis: Redis;
let es: Client;
let app: FastifyInstance;
let appOff: FastifyInstance;
let sessions: SessionStore;
let sessionId: string;

interface Candidate {
  readonly kind: string;
  readonly repository: string | null;
  readonly repository_id: number | null;
  readonly display_name: string | null;
  readonly url: string | null;
  readonly pr_number?: number;
  readonly state?: string;
  readonly author?: string;
  readonly merge_seq: number | null;
  readonly seq_epoch: number | null;
  readonly sequence_space: string | null;
  readonly merge_number?: string;
  readonly merge_number_epoch?: number;
  readonly merge_number_state?: string;
}

interface ResolveBody {
  readonly input: string;
  readonly detected_kind: string;
  readonly candidates: Candidate[];
  readonly truncated: boolean;
  readonly reason_code?: string;
  readonly hint?: string;
  readonly error?: { code: string; message: string };
  readonly correlation_id: string;
}

async function resolve(query: string, server: FastifyInstance = app): Promise<{ status: number; body: ResolveBody }> {
  const response = await server.inject({
    method: 'GET',
    url: `${RESOLVE_PATH}?${query}`,
    headers: { cookie: `${SESSION_COOKIE_NAME}=${sessionId}` },
  });
  return { status: response.statusCode, body: response.json<ResolveBody>() };
}

function sha(seed: number): string {
  return `${String(seed)}`.padStart(40, 'c').slice(0, 40);
}

async function seedNumberedRow(input: {
  readonly repositoryId: number;
  readonly baseBranch: string;
  readonly epoch: number;
  readonly mergeSeq: number;
  readonly prNumber: number | null;
  readonly mergeNumber: number | null;
}): Promise<void> {
  await pool.query(
    `INSERT INTO merge_sequence
       (repository_id, base_branch, seq_epoch, merge_seq, commit_sha, pull_request_number, committed_at, merge_number)
     VALUES ($1, $2, $3, $4, $5, $6, now(), $7)`,
    [input.repositoryId, input.baseBranch, input.epoch, input.mergeSeq, sha(input.repositoryId * 1000 + input.mergeSeq), input.prNumber, input.mergeNumber],
  );
}

const REPOSITORY_IDS = [SMP, APP, HIDDEN, DUAL];

function scopeFields(repositoryId: number, repository: string, orgId: number): Record<string, unknown> {
  return { repository_id: repositoryId, repository, org_id: orgId, visibility: 'internal', allowed_team_ids: [orgId * 10] };
}

/** 색인 문서는 `cr114/smp1900#77` 하나뿐이다 — 나머지 후보는 정본만으로 성립해야 한다. */
const PULL_REQUESTS = [
  {
    _id: `${String(SMP)}:77`,
    ...scopeFields(SMP, 'cr114/smp1900', ORG),
    pr_number: 77,
    title: '결제 재시도 (M-1900-1450)',
    state: 'merged',
    author: 'kim',
    base_branch: 'main',
    merge_commit_sha: sha(SMP * 1000 + 5),
    source_commit_shas: [],
    source_commits_truncated: false,
    created_at: '2026-08-18T02:00:00Z',
    merged_at: '2026-08-19T05:02:11Z',
    // 색인에 실린 시퀀스 값은 일부러 낡게 둔다 — 응답의 시퀀스·M 값은 정본이 이겨야 한다.
    merge_seq: 1,
    seq_epoch: 1,
    sequence_space: 'cr114/smp1900@main',
    merge_number: 1,
    merge_number_epoch: 1,
    document_version: 1,
  },
];

beforeAll(async () => {
  pool = await migratedPool();
  redis = createTestRedis();
  es = createEsClient(resolveClientOptions());
  await applyMappings(es);
  await switchAliasesForTests(es);

  await pool.query('DELETE FROM merge_sequence WHERE repository_id = ANY($1)', [REPOSITORY_IDS]);
  await pool.query('DELETE FROM sequence_space WHERE repository_id = ANY($1)', [REPOSITORY_IDS]);
  await pool.query('DELETE FROM repository WHERE repository_id = ANY($1)', [REPOSITORY_IDS]);
  await pool.query('DELETE FROM permission_cache WHERE user_id = $1', [USER]);
  await pool.query('DELETE FROM app_user WHERE user_id = $1', [USER]);

  await authRepo.upsertUserOnLogin(pool, { user_id: USER, login: 'cr114-kim', github_user_id: 114_001 });

  for (const [id, owner, name, org, branches] of [
    [SMP, 'cr114', 'smp1900', ORG, ['main']],
    [APP, 'cr114b', 'app1900', OTHER_ORG, ['main']],
    [HIDDEN, 'cr114-hidden', 'web1900', HIDDEN_ORG, ['main']],
    [DUAL, 'cr114', 'dual1900', ORG, ['main', 'release']],
  ] as const) {
    await repositoryRepo.upsertRepository(pool, {
      repository_id: id,
      owner,
      name,
      org_id: org,
      visibility: 'internal',
      sequence_branches: [...branches],
    });
    for (const branch of branches) {
      await sequenceSpaceRepo.ensureSequenceSpace(pool, id, branch);
      await pool.query('UPDATE sequence_space SET seq_epoch = $3 WHERE repository_id = $1 AND base_branch = $2', [id, branch, EPOCH]);
    }
  }

  // smp1900: M 1450 → #77(색인 문서 있음), M 1451 → #78(문서 없음), 직접 푸시(번호 없음), 옛 에폭의 M 3000.
  await seedNumberedRow({ repositoryId: SMP, baseBranch: 'main', epoch: EPOCH, mergeSeq: 5, prNumber: 77, mergeNumber: 1450 });
  await seedNumberedRow({ repositoryId: SMP, baseBranch: 'main', epoch: EPOCH, mergeSeq: 6, prNumber: 78, mergeNumber: 1451 });
  await seedNumberedRow({ repositoryId: SMP, baseBranch: 'main', epoch: EPOCH, mergeSeq: 7, prNumber: null, mergeNumber: null });
  await seedNumberedRow({ repositoryId: SMP, baseBranch: 'main', epoch: EPOCH - 1, mergeSeq: 5, prNumber: 70, mergeNumber: 3000 });
  // app1900: 같은 코드, 다른 조직, 같은 번호 1450 → #88.
  await seedNumberedRow({ repositoryId: APP, baseBranch: 'main', epoch: EPOCH, mergeSeq: 9, prNumber: 88, mergeNumber: 1450 });
  // web1900: 범위 밖. 같은 번호가 있어도 새면 안 된다.
  await seedNumberedRow({ repositoryId: HIDDEN, baseBranch: 'main', epoch: EPOCH, mergeSeq: 2, prNumber: 99, mergeNumber: 1450 });
  // dual1900: 브랜치 둘이 각자 M 9를 갖는다.
  await seedNumberedRow({ repositoryId: DUAL, baseBranch: 'main', epoch: EPOCH, mergeSeq: 3, prNumber: 901, mergeNumber: 9 });
  await seedNumberedRow({ repositoryId: DUAL, baseBranch: 'release', epoch: EPOCH, mergeSeq: 4, prNumber: 902, mergeNumber: 9 });

  await es.deleteByQuery({
    index: ['prs-pull-requests'],
    query: { terms: { repository_id: REPOSITORY_IDS } },
    refresh: true,
    conflicts: 'proceed',
  });
  const bulk = await es.bulk({
    refresh: true,
    operations: PULL_REQUESTS.flatMap(({ _id, ...doc }) => [
      { index: { _index: 'prs-pull-requests', _id } },
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
  sessions = new SessionStore({ redis: redisPort });
  /*
   * `org_team` 범위: 두 조직(114·115)은 보이고 116은 보이지 않는다. 문서의 `org_id`·
   * `visibility`·`allowed_team_ids`와 정본 행의 저장소 판정이 같은 범위를 지나야 한다.
   */
  const source: AccessScopeSource = {
    fetch: async () => ({
      repositoryIds: [SMP, APP, DUAL, ...Array.from({ length: 600 }, (_, i) => 60_000 + i)],
      orgIds: [ORG, OTHER_ORG],
      teamIds: [ORG * 10, OTHER_ORG * 10],
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

  const build = (mergeNumberEnabled: boolean): FastifyInstance =>
    buildServer({
      config: {
        port: 0,
        adminTokens: [],
        metricsQueryUrl: null,
        gheBaseUrl: null,
        auth: AUTH_CONFIG,
        searchCursorKey: TEST_CURSOR_KEY,
        mergeNumberEnabled,
      },
      auth,
      search: {
        pool,
        es,
        cursorSigner: TEST_CURSOR_SIGNER,
        resolveNames: async () => ({ orgIds: new Map(), teamIds: new Map() }),
      },
    });
  app = build(true);
  appOff = build(false);
  await app.ready();
  await appOff.ready();
}, 180_000);

afterAll(async () => {
  await app?.close();
  await appOff?.close();
  await es?.deleteByQuery({
    index: ['prs-pull-requests'],
    query: { terms: { repository_id: REPOSITORY_IDS } },
    refresh: true,
    conflicts: 'proceed',
  });
  await pool?.query('DELETE FROM merge_sequence WHERE repository_id = ANY($1)', [REPOSITORY_IDS]);
  await pool?.query('DELETE FROM sequence_space WHERE repository_id = ANY($1)', [REPOSITORY_IDS]);
  await pool?.query('DELETE FROM repository WHERE repository_id = ANY($1)', [REPOSITORY_IDS]);
  await pool?.query('DELETE FROM permission_cache WHERE user_id = $1', [USER]);
  await pool?.query('DELETE FROM app_user WHERE user_id = $1', [USER]);
  await es?.close();
  await redis?.quit();
  await pool?.end();
});

beforeEach(async () => {
  await redis.del(scopeKey(USER));
  sessionId = createSessionId();
  const now = Date.now();
  await sessions.create({
    sessionId,
    userId: USER,
    login: 'cr114-kim',
    email: null,
    roles: ['developer'],
    issuedAt: now,
    lastSeenAt: now,
    correlationId: null,
  });
});

describe('FR-SRCH-001 AC-7: M 번호 문자열 하나로 PR을 찾는다', () => {
  it('`M-1900-1451`은 후보 1건이며 유형이 merge_number다', async () => {
    const { status, body } = await resolve('q=M-1900-1451');

    expect(status).toBe(200);
    expect(body.detected_kind).toBe('merge_number');
    expect(body.candidates).toHaveLength(1);
    expect(body.candidates[0]).toMatchObject({
      kind: 'pull_request',
      repository: 'cr114/smp1900',
      repository_id: SMP,
      pr_number: 78,
      url: '/pr/cr114/smp1900/78',
      merge_number: 'M-1900-1451',
      merge_number_epoch: EPOCH,
      merge_number_state: 'assigned',
      merge_seq: 6,
      seq_epoch: EPOCH,
      sequence_space: 'cr114/smp1900@main',
    });
    expect(body.reason_code).toBeUndefined();
  });

  it('**색인 문서가 없어도 후보는 성립한다** — 정본이 확정한 PR이다', async () => {
    const { body } = await resolve('q=M-1900-1451');
    // #78의 PR 문서는 색인에 없다. 제목은 모르지만 상세 URL·번호·상태는 정본만으로 만든다.
    expect(body.candidates[0]).toMatchObject({ display_name: null, state: 'merged' });
  });

  it('색인 문서가 있으면 표시 필드를 덧대되 **시퀀스·M 값은 정본이 이긴다**', async () => {
    const { body } = await resolve('q=M-1900-1450&repository=cr114%2Fsmp1900');
    const smp = body.candidates.find((one) => one.repository === 'cr114/smp1900');
    expect(smp).toMatchObject({
      pr_number: 77,
      display_name: '결제 재시도 (M-1900-1450)',
      author: 'kim',
      state: 'merged',
      // 색인에는 merge_seq 1·에폭 1·M 1이 실려 있지만 정본은 서수 5·에폭 3·M 1450이다.
      merge_seq: 5,
      seq_epoch: EPOCH,
      merge_number: 'M-1900-1450',
      merge_number_epoch: EPOCH,
    });
  });

  it('제목 접두 그대로 `[M-1900-1451]`을 넣어도 같은 PR이다', async () => {
    const { body } = await resolve(`q=${encodeURIComponent('[M-1900-1451]')}`);
    expect(body.detected_kind).toBe('merge_number');
    expect(body.candidates.map((one) => one.pr_number)).toEqual([78]);
  });
});

describe('FR-SRCH-001 AC-5: 같은 코드의 저장소가 여럿이면 후보 배열이다', () => {
  it('`M-1900-1450`은 소유자가 다른 두 저장소의 PR을 모두 준다', async () => {
    const { body } = await resolve('q=M-1900-1450');

    expect(body.candidates.map((one) => [one.repository, one.pr_number])).toEqual([
      ['cr114/smp1900', 77],
      ['cr114b/app1900', 88],
    ]);
    expect(body.truncated).toBe(false);
  });

  it('시퀀스 브랜치가 둘인 저장소는 브랜치마다 후보가 된다', async () => {
    const { body } = await resolve('q=M-1900-9');
    expect(body.candidates.map((one) => [one.pr_number, one.sequence_space])).toEqual([
      [901, 'cr114/dual1900@main'],
      [902, 'cr114/dual1900@release'],
    ]);
  });

  it('`limit`을 넘으면 절삭 표식이 붙는다 (FR-SRCH-004 AC-3과 같은 규칙)', async () => {
    const { body } = await resolve('q=M-1900-1450&limit=1');
    expect(body.candidates).toHaveLength(1);
    expect(body.truncated).toBe(true);
  });
});

describe('FR-SRCH-001 AC-6: 접근 범위 밖은 새지 않는다', () => {
  it('범위 밖 저장소의 같은 번호는 후보에 없다', async () => {
    const { body } = await resolve('q=M-1900-1450');
    expect(body.candidates.some((one) => one.repository_id === HIDDEN)).toBe(false);
    expect(JSON.stringify(body)).not.toContain('web1900');
  });
});

describe('없는 번호·다른 코드·옛 에폭은 후보 0건이다', () => {
  it('발급되지 않은 번호는 `not_found`다 — 잠정값을 지어내지 않는다', async () => {
    const { status, body } = await resolve('q=M-1900-99999');
    expect(status).toBe(200);
    expect(body.detected_kind).toBe('merge_number');
    expect(body.candidates).toEqual([]);
    expect(body.reason_code).toBe('not_found');
  });

  it('코드가 어느 저장소 이름과도 맞지 않으면 `not_found`다', async () => {
    const { body } = await resolve('q=M-4242-1');
    expect(body.candidates).toEqual([]);
    expect(body.reason_code).toBe('not_found');
  });

  it('**옛 에폭의 번호는 찾지 않는다** — 현재 에폭 정본만 본다 (ADR-007 규칙 5)', async () => {
    const { body } = await resolve('q=M-1900-3000');
    expect(body.candidates).toEqual([]);
  });
});

describe('M 번호 기능이 꺼진 배포', () => {
  it('후보 0건과 `merge_number_disabled`로 답한다 — `not_found`와 섞지 않는다', async () => {
    const { status, body } = await resolve('q=M-1900-1451', appOff);
    expect(status).toBe(200);
    expect(body.detected_kind).toBe('merge_number');
    expect(body.candidates).toEqual([]);
    expect(body.reason_code).toBe('merge_number_disabled');
    expect(body.hint).toContain('MNUMBER_ENABLED');
  });

  it('다른 식별자 해석은 그대로다', async () => {
    const { body } = await resolve('q=cr114%2Fsmp1900%2377', appOff);
    expect(body.candidates.map((one) => one.pr_number)).toEqual([77]);
  });
});
