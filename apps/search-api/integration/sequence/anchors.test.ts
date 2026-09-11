/**
 * `POST /sequence-anchors/resolve` — 실제 PostgreSQL + Redis (WP-023 / API-SEQ-002, FR-SEQ-003).
 *
 * ## 왜 Elasticsearch 없이 도는가
 *
 * 앵커 정규화의 다섯 유형 중 넷은 `merge_sequence` 조회 하나로 끝난다 —
 * 그 표가 first-parent walk의 결과 그 자체이므로 "이 커밋이 체인에 있는가"라는
 * 물음이 곧 "이 표에 행이 있는가"다 (CR-027, DEV-130).
 *
 * 그래서 이 파일은 **부르면 던지는 Elasticsearch 클라이언트**를 넣는다. 그 셋업
 * 자체가 단언이다: 색인을 부르지 않아야 할 경로가 부르면 시험이 실패한다.
 * 색인이 필요한 경로(대체 앵커 제안, 미머지/다른 브랜치 판별)는 `range.test.ts`가
 * 실제 Elasticsearch로 확인한다.
 *
 * 실행: `pnpm test:integration sequence/anchors`
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
  repositoryRepo,
  sequenceSpaceRepo,
  type Pool,
} from '@prs/db';
import type { Redis } from '@prs/bus';
import { buildServer } from '../../src/server.js';
import { SEQUENCE_ANCHOR_PATH } from '../../src/sequence/routes.js';
import type { AuthContext, AuthRedis } from '../../src/auth/context.js';
import { createTestRedis, migratedPool, clearMergeSequence } from '../helpers.js';
import { TEST_CURSOR_KEY, TEST_CURSOR_SIGNER } from '../_cursor-fixture.js';

const AUTH_CONFIG = {
  enabled: true,
  cookieSecure: true,
  loginPath: '/auth/login',
  groupRoleMap: new Map<string, never>(),
} as const;

const USER = 'sub-anchors';
const PAYMENTS = 2101;
const HIDDEN = 2900;
const ORG = 1;
const BRANCH = 'main';

/** 서수 1~4의 커밋. 접두 `aaaaaaa`가 둘에 걸리도록 일부러 겹치게 둔다. */
const COMMITS = [
  { seq: 1, sha: `${'1'.repeat(7)}${'0'.repeat(33)}`, pr: null, at: '2026-08-10T00:00:00Z' },
  { seq: 2, sha: `aaaaaaa${'1'.repeat(33)}`, pr: 41, at: '2026-08-11T00:00:00Z' },
  { seq: 3, sha: `aaaaaaa${'2'.repeat(33)}`, pr: 42, at: '2026-08-12T00:00:00Z' },
  { seq: 4, sha: `bbbbbbb${'3'.repeat(33)}`, pr: 43, at: '2026-08-13T00:00:00Z' },
] as const;

let pool: Pool;
let redis: Redis;
let app: FastifyInstance;
let sessionId: string;
let esCalls: number;
/** 대역이 돌려줄 히트. `null`이면 부르는 순간 던진다. */
let esHits: { _source: Record<string, unknown> }[] | null;

interface AnchorBody {
  readonly sequence_space?: string;
  readonly seq_epoch?: number;
  readonly resolved?: {
    position: string;
    expression: string;
    kind: string;
    merge_seq: number;
    commit_sha: string;
    boundary: string;
    occurred_at: string;
  }[];
  readonly error?: { code: string; message: string; detail?: Record<string, unknown> };
  readonly correlation_id: string;
}

async function resolveAnchor(
  expression: string,
  position: 'from' | 'to' = 'to',
  overrides: Record<string, unknown> = {},
): Promise<{ status: number; body: AnchorBody }> {
  const response = await app.inject({
    method: 'POST',
    url: SEQUENCE_ANCHOR_PATH,
    headers: { cookie: `${SESSION_COOKIE_NAME}=${sessionId}` },
    payload: {
      repository: 'acme/payments',
      base_branch: BRANCH,
      anchors: [{ position, expression }],
      ...overrides,
    },
  });
  return { status: response.statusCode, body: response.json<AnchorBody>() };
}

beforeAll(async () => {
  pool = await migratedPool();
  redis = createTestRedis();

  // 릴리스 미수집(release_not_indexed) 판정이 이 표의 0건에 기댄다 (WP-024).
  await pool.query('DELETE FROM release');
  await clearMergeSequence(pool);
  await pool.query('DELETE FROM sequence_space');
  await pool.query('DELETE FROM permission_cache');
  await pool.query('DELETE FROM app_user');
  await pool.query('DELETE FROM repository');

  await authRepo.upsertUserOnLogin(pool, { user_id: USER, login: 'kim', github_user_id: 7101 });
  for (const [id, owner, name, org] of [
    [PAYMENTS, 'acme', 'payments', ORG],
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
  await sequenceSpaceRepo.ensureSequenceSpace(pool, HIDDEN, BRANCH);
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

  /*
   * 기본은 **부르면 던지는** 클라이언트다. 이 파일의 시험 대부분이 색인을
   * 건드리지 않는다는 것이 곧 "정본만으로 답한다"는 주장의 증거다 (DEV-130).
   *
   * `esHits`를 채운 시험만 답을 받는다 — 색인이 있어야만 답할 수 있는 두 경로
   * (대체 앵커 제안, 미머지와 다른 브랜치의 구분)를 위해서다. 그 질의가 진짜
   * 색인에서 진짜로 맞는 문서를 고르는지는 `range-es.test.ts` 쪽 계층이 본다.
   */
  const es = {
    search: () => {
      esCalls += 1;
      if (esHits === null) throw new Error('이 경로는 Elasticsearch를 부르지 않아야 한다');
      return Promise.resolve({
        hits: { total: { value: esHits.length, relation: 'eq' }, hits: esHits },
      });
    },
    msearch: () => {
      esCalls += 1;
      throw new Error('앵커 해석은 msearch를 쓰지 않는다');
    },
  } as unknown as Client;

  app = buildServer({
    config: { port: 0, adminTokens: [], metricsQueryUrl: null, gheBaseUrl: null, auth: AUTH_CONFIG, searchCursorKey: TEST_CURSOR_KEY },
    auth,
    search: { pool, es, cursorSigner: TEST_CURSOR_SIGNER, resolveNames: async () => ({ orgIds: new Map(), teamIds: new Map() }) },
    sequence: { pool, es, cursorSigner: TEST_CURSOR_SIGNER, resolveNames: async () => ({ orgIds: new Map(), teamIds: new Map() }) },
  });
  await app.ready();
}, 180_000);

beforeEach(async () => {
  esCalls = 0;
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
  await app?.close();
  await redis?.quit();
  await pool?.end();
});

describe('앵커 정규화 성공 (FR-SEQ-003 AC-1~AC-5, QA-W004-03·04)', () => {
  it('서수 앵커 `seq:3`이 그 서수의 커밋으로 해석된다', async () => {
    const { status, body } = await resolveAnchor('seq:3');
    expect(status).toBe(200);
    expect(body.resolved?.[0]).toMatchObject({
      kind: 'sequence',
      merge_seq: 3,
      commit_sha: COMMITS[2].sha,
      boundary: 'inclusive',
    });
    expect(esCalls).toBe(0);
  });

  it('PR 번호 앵커 `#42`가 그 PR의 머지 커밋 서수가 된다 (AC-3)', async () => {
    const { status, body } = await resolveAnchor('#42');
    expect(status).toBe(200);
    expect(body.resolved?.[0]).toMatchObject({ kind: 'pull_request', merge_seq: 3, commit_sha: COMMITS[2].sha });
    expect(esCalls).toBe(0);
  });

  it('40자 커밋 SHA 앵커가 해석된다 (AC-2)', async () => {
    const { status, body } = await resolveAnchor(COMMITS[1].sha);
    expect(status).toBe(200);
    expect(body.resolved?.[0]).toMatchObject({ kind: 'commit', merge_seq: 2 });
    expect(esCalls).toBe(0);
  });

  it('축약 SHA 앵커가 하나에만 걸리면 해석된다 (ADR-012)', async () => {
    const { status, body } = await resolveAnchor('bbbbbbb');
    expect(status).toBe(200);
    expect(body.resolved?.[0]).toMatchObject({ kind: 'commit', merge_seq: 4 });
  });

  it('**시각 앵커는 그 시각 이전 마지막 커밋이다** (AC-4)', async () => {
    // 2026-08-12T12:00Z 이전 마지막은 서수 3(08-12T00:00Z)이고 서수 4(08-13)가 아니다.
    const { status, body } = await resolveAnchor('2026-08-12T12:00:00Z');
    expect(status).toBe(200);
    expect(body.resolved?.[0]).toMatchObject({ kind: 'time', merge_seq: 3 });
    expect(esCalls).toBe(0);
  });

  it('시각이 커밋과 정확히 같으면 그 커밋을 포함한다 — 경계는 `<=`다', async () => {
    const { body } = await resolveAnchor('2026-08-12T00:00:00Z');
    expect(body.resolved?.[0]?.merge_seq).toBe(3);
  });

  it('응답이 AC-5의 넷을 모두 담는다 — 원본 표현·서수·커밋 SHA·에폭', async () => {
    const { body } = await resolveAnchor('#42');
    expect(body.seq_epoch).toBe(1);
    expect(body.sequence_space).toBe('acme/payments@main');
    const anchor = body.resolved?.[0];
    expect(anchor?.expression).toBe('#42');
    expect(anchor?.merge_seq).toBe(3);
    expect(anchor?.commit_sha).toBe(COMMITS[2].sha);
    expect(anchor?.occurred_at).toBe('2026-08-12T00:00:00.000Z');
  });

  it('**경계는 위치가 정한다** (FR-SEQ-002 AC-1)', async () => {
    const from = await resolveAnchor('seq:2', 'from');
    const to = await resolveAnchor('seq:2', 'to');
    expect(from.body.resolved?.[0]?.boundary).toBe('exclusive');
    expect(to.body.resolved?.[0]?.boundary).toBe('inclusive');
  });

  it('앵커 둘을 한 번에 해석한다', async () => {
    const response = await app.inject({
      method: 'POST',
      url: SEQUENCE_ANCHOR_PATH,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${sessionId}` },
      payload: {
        repository: 'acme/payments',
        base_branch: BRANCH,
        anchors: [
          { position: 'from', expression: 'seq:1' },
          { position: 'to', expression: '#43' },
        ],
      },
    });
    const body = response.json<AnchorBody>();
    expect(response.statusCode).toBe(200);
    expect(body.resolved?.map((one) => one.merge_seq)).toEqual([1, 4]);
  });
});

describe('앵커 정규화 실패 (QA-W004-06, FR-SEQ-003 예외 처리)', () => {
  it('없는 서수는 `ANCHOR_UNRESOLVABLE`이다 — 빈 구간으로 조용히 넘어가지 않는다', async () => {
    const { status, body } = await resolveAnchor('seq:9999');
    expect(status).toBe(400);
    expect(body.error?.code).toBe('ANCHOR_UNRESOLVABLE');
    expect(body.error?.detail?.['head_seq']).toBe(4);
  });

  it('**축약 SHA가 둘에 걸리면 하나를 고르지 않고 거절한다** (ADR-012)', async () => {
    /*
     * `aaaaaaa`는 서수 2와 3 둘 다의 접두다. 하나를 골라 주면 사용자는 자기가
     * 뜻하지 않은 구간을 보고도 그 사실을 모른다.
     */
    const { status, body } = await resolveAnchor('aaaaaaa');
    expect(status).toBe(400);
    expect(body.error?.code).toBe('ANCHOR_UNRESOLVABLE');
    expect(body.error?.detail?.['ambiguous']).toBe(true);
  });

  it('**릴리스 태그는 아직 해석할 수 없다고 말한다** (CR-027, DEV-132 / AC-1)', async () => {
    const { status, body } = await resolveAnchor('build-20260812-03');
    expect(status).toBe(400);
    expect(body.error?.code).toBe('ANCHOR_UNRESOLVABLE');
    // 사유가 "형식이 틀렸다"가 아니라 "아직 수집하지 않았다"여야 한다.
    expect(body.error?.detail?.['reason']).toBe('release_not_indexed');
  });

  it('맨 숫자는 지원 형식 목록과 함께 거절한다 — 어느 쪽으로도 읽지 않는다', async () => {
    const { status, body } = await resolveAnchor('1234');
    expect(status).toBe(400);
    expect(body.error?.code).toBe('ANCHOR_UNRESOLVABLE');
    expect(Array.isArray(body.error?.detail?.['candidates'])).toBe(true);
    expect(Array.isArray(body.error?.detail?.['supported_formats'])).toBe(true);
  });

  it('7자 미만 SHA는 조회 전에 거절한다 (FR-SRCH-004 AC-2와 같은 규칙)', async () => {
    const { status, body } = await resolveAnchor('a3f9c2');
    expect(status).toBe(400);
    expect(body.error?.code).toBe('ANCHOR_UNRESOLVABLE');
    expect(esCalls).toBe(0);
  });

  it('앵커가 비어 있으면 `INVALID_PARAMETER`다', async () => {
    const response = await app.inject({
      method: 'POST',
      url: SEQUENCE_ANCHOR_PATH,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${sessionId}` },
      payload: { repository: 'acme/payments', base_branch: BRANCH, anchors: [] },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json<AnchorBody>().error?.code).toBe('INVALID_PARAMETER');
  });

  it('**여럿이 실패해도 첫 번째만 낸다** — 오류는 하나씩 고친다', async () => {
    const response = await app.inject({
      method: 'POST',
      url: SEQUENCE_ANCHOR_PATH,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${sessionId}` },
      payload: {
        repository: 'acme/payments',
        base_branch: BRANCH,
        anchors: [
          { position: 'from', expression: 'seq:9999' },
          { position: 'to', expression: 'build-1' },
        ],
      },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json<AnchorBody>().error?.detail?.['expression']).toBe('seq:9999');
  });
});

describe('색인이 있어야 답하는 두 경로 (FR-SEQ-003 AC-2·AC-3, QA-W004-05·06)', () => {
  it('**체인 밖 커밋에 머지 커밋 대체 제안이 붙는다** (AC-2, QA-W004-05)', async () => {
    /*
     * 서수 3의 머지 커밋이 이 원본 커밋을 대상 브랜치에 들여왔다고 색인이
     * 답한다. 제안은 **체인에 실재하는 커밋**이어야 한다 — 확인 없이 제안하면
     * 사용자가 그대로 넣었을 때 같은 오류가 한 번 더 난다.
     */
    esHits = [{ _source: { merge_commit_sha: COMMITS[2].sha } }];
    const outside = `feed${'0'.repeat(36)}`;
    const { status, body } = await resolveAnchor(outside);

    expect(status).toBe(400);
    expect(body.error?.code).toBe('ANCHOR_NOT_ON_BRANCH');
    expect(body.error?.detail?.['suggested_anchor']).toEqual({
      kind: 'commit',
      commit_sha: COMMITS[2].sha,
      reason: '이 커밋을 대상 브랜치에 반영한 머지 커밋',
    });
  });

  it('**체인에 없는 머지 커밋은 제안하지 않는다** — 틀린 제안보다 없는 편이 낫다', async () => {
    esHits = [{ _source: { merge_commit_sha: `dead${'0'.repeat(36)}` } }];
    const { status, body } = await resolveAnchor(`beef${'0'.repeat(36)}`);
    expect(status).toBe(400);
    expect(body.error?.code).toBe('ANCHOR_NOT_ON_BRANCH');
    expect(body.error?.detail).not.toHaveProperty('suggested_anchor');
  });

  it('색인이 아무것도 못 찾아도 오류는 그대로 난다', async () => {
    esHits = [];
    const { status, body } = await resolveAnchor(`cafe${'0'.repeat(36)}`);
    expect(status).toBe(400);
    expect(body.error?.code).toBe('ANCHOR_NOT_ON_BRANCH');
  });

  it('**다른 브랜치로 머지된 PR은 `SEQUENCE_SPACE_MISMATCH`다** (FR-SEQ-002 AC-5)', async () => {
    /*
     * 사용자가 할 일이 다르므로 `ANCHOR_NOT_MERGED`와 갈라야 한다 — 이쪽은
     * 브랜치를 바꿔야 하고, 저쪽은 머지를 기다려야 한다. "없다"로 뭉뚱그리면
     * 어느 쪽인지 알 수 없다.
     */
    esHits = [{ _source: { base_branch: 'develop', merged_at: '2026-08-12T00:00:00Z' } }];
    const { status, body } = await resolveAnchor('#777');
    expect(status).toBe(400);
    expect(body.error?.code).toBe('SEQUENCE_SPACE_MISMATCH');
    expect(body.error?.detail?.['pull_request_base_branch']).toBe('develop');
  });

  it('같은 브랜치인데 채번에 없으면 `ANCHOR_NOT_MERGED`다 (AC-3, QA-W004-06)', async () => {
    esHits = [{ _source: { base_branch: BRANCH } }];
    const { status, body } = await resolveAnchor('#778');
    expect(status).toBe(400);
    expect(body.error?.code).toBe('ANCHOR_NOT_MERGED');
  });

  it('색인이 그 PR을 아예 모르면 `ANCHOR_NOT_MERGED`다 — 모르는 것을 공간 불일치로 단정하지 않는다', async () => {
    esHits = [];
    const { status, body } = await resolveAnchor('#779');
    expect(status).toBe(400);
    expect(body.error?.code).toBe('ANCHOR_NOT_MERGED');
  });
});

describe('접근 통제 (ADR-008, CR-027 DEV-130)', () => {
  it('**접근 범위 밖 저장소는 404다** — 403이면 저장소의 존재가 알려진다', async () => {
    const response = await app.inject({
      method: 'POST',
      url: SEQUENCE_ANCHOR_PATH,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${sessionId}` },
      payload: { repository: 'other/secret', base_branch: BRANCH, anchors: [{ position: 'to', expression: 'seq:1' }] },
    });
    expect(response.statusCode).toBe(404);
    expect(response.json<AnchorBody>().error?.code).toBe('NOT_FOUND');
  });

  it('등록되지 않은 저장소도 404다 — 두 실패가 구분되지 않는다', async () => {
    const response = await app.inject({
      method: 'POST',
      url: SEQUENCE_ANCHOR_PATH,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${sessionId}` },
      payload: { repository: 'acme/none', base_branch: BRANCH, anchors: [{ position: 'to', expression: 'seq:1' }] },
    });
    expect(response.statusCode).toBe(404);
  });

  it('**채번된 적 없는 브랜치는 404다** — 빈 결과가 "아무것도 없다"로 읽히지 않게 (DEV-137)', async () => {
    const response = await app.inject({
      method: 'POST',
      url: SEQUENCE_ANCHOR_PATH,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${sessionId}` },
      payload: {
        repository: 'acme/payments',
        base_branch: 'release/1.0',
        anchors: [{ position: 'to', expression: 'seq:1' }],
      },
    });
    expect(response.statusCode).toBe(404);
    expect(response.json<AnchorBody>().error?.message).toContain('채번된 적이 없는');
  });

  it('세션이 없으면 401이다', async () => {
    const response = await app.inject({
      method: 'POST',
      url: SEQUENCE_ANCHOR_PATH,
      payload: { repository: 'acme/payments', base_branch: BRANCH, anchors: [{ position: 'to', expression: 'seq:1' }] },
    });
    expect(response.statusCode).toBe(401);
  });
});
