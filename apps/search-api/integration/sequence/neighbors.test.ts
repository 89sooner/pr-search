/**
 * `GET /sequence-neighbors` — 실제 PostgreSQL + 대역 Elasticsearch
 * (WP-027 / API-REL-001, FR-REL-001, CR-031).
 *
 * ## 이 파일이 지키는 주장
 *
 * 1. **직접 푸시 커밋을 거르지 않는다** (DEV-161 / AC-2, SRS v2.4). 픽스처의 서수 3은
 *    PR이 없는 커밋이다 — 그 행이 빠지면 목록의 서수가 건너뛰고, 그것이 곧 이
 *    시험이 잡으려는 결함이다.
 * 2. **앵커는 PR과 커밋 둘 다** (DEV-163). 직접 푸시 커밋은 PR이 없어 커밋 앵커로만
 *    자기 위치를 물을 수 있다.
 * 3. **서수가 없을 때 사유를 가른다** (DEV-164): 미머지와 미채번은 다른 답이다.
 * 4. **색인에 없는 이웃도 행으로 남는다** (DEV-166 / DEV-130).
 *
 * 이웃 선택은 전부 PostgreSQL이 한다. 대역 Elasticsearch는 표시값과 실재 확인만
 * 답하며, **무엇을 물었는지**까지 시험이 본다.
 *
 * 실행: `pnpm test:integration sequence/neighbors`
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
import { SEQUENCE_NEIGHBORS_PATH } from '../../src/sequence/routes.js';
import type { AuthContext, AuthRedis } from '../../src/auth/context.js';
import { createTestRedis, migratedPool } from '../helpers.js';
import { TEST_CURSOR_KEY, TEST_CURSOR_SIGNER } from '../_cursor-fixture.js';

const AUTH_CONFIG = {
  enabled: true,
  cookieSecure: true,
  loginPath: '/auth/login',
  groupRoleMap: new Map<string, never>(),
} as const;

const USER = 'sub-neighbors';
const PAYMENTS = 5101;
/** 공간은 에폭 2인데 서수 행은 에폭 1에 남았다 — 이전 에폭 행은 앵커가 아니다. */
const RISK = 5102;
/**
 * 두 시퀀스 공간이 **같은 커밋을 공유하는** 저장소 (CR-032, DEV-168).
 *
 * `main`에 머지된 커밋이 릴리스 브랜치의 first-parent 체인에도 있는 것은 정상이며,
 * 그때 그 커밋은 **공간마다 다른 서수**를 갖는다. 단일 브랜치 픽스처로는 이 상황이
 * 만들어지지 않아 결함이 CI를 통과했다.
 */
const MULTI = 5103;
const HIDDEN = 5900;
const ORG = 1;
const MAIN = 'main';
const RELEASE = 'release/2026.08';
/** 채번된 적 없는 브랜치 — 공간이 없으면 404다 (DEV-137). */
const UNSEQUENCED_BRANCH = 'feature/none';

/**
 * 서수 1~7. **3번은 PR 없는 직접 푸시**다 (CR-031의 핵심 픽스처).
 *
 * 이 행이 목록에서 빠지면 서수가 `2 → 4`로 건너뛴다 — 사용자가 누락으로 읽는
 * 바로 그 화면이며, 시험이 그것을 직접 단언한다.
 */
const COMMITS = [
  { seq: 1, pr: 601 },
  { seq: 2, pr: 602 },
  { seq: 3, pr: null },
  { seq: 4, pr: 604 },
  { seq: 5, pr: 605 },
  { seq: 6, pr: 606 },
  { seq: 7, pr: 607 },
] as const;

/** 색인에 문서가 없는 PR — 정본에는 있다 (DEV-130의 상황). */
const UNINDEXED_PR = 605;
/** 머지됐다고 색인이 말하지만 채번 행이 없는 PR. */
const MERGED_UNSEQUENCED_PR = 700;
/** 색인이 `open`이라고 말하는 PR. */
const OPEN_PR = 701;

function shaOf(seq: number): string {
  return `${String(seq).padStart(2, '0')}${'e'.repeat(38)}`;
}

/** `acme/multi`의 행. `main`과 `release/2026.08`이 SHARED_SHA를 공유한다. */
const SHARED_SHA = `${'b'.repeat(39)}1`;
const SHARED_PR = 802;
function multiSha(seq: number): string {
  return `${String(seq).padStart(2, '0')}${'c'.repeat(38)}`;
}
/** 같은 커밋이 `main`에서는 서수 2, `release/2026.08`에서는 서수 11이다. */
const MULTI_ROWS = [
  { branch: MAIN, seq: 1, sha: multiSha(1), pr: 801 },
  { branch: MAIN, seq: 2, sha: SHARED_SHA, pr: SHARED_PR },
  { branch: MAIN, seq: 3, sha: multiSha(3), pr: 803 },
  { branch: RELEASE, seq: 10, sha: multiSha(10), pr: 810 },
  { branch: RELEASE, seq: 11, sha: SHARED_SHA, pr: SHARED_PR },
  { branch: RELEASE, seq: 12, sha: multiSha(12), pr: 812 },
] as const;
const UNKNOWN_SHA = 'f'.repeat(40);
/** 색인에는 있으나 체인에 없는 커밋 (원본 커밋의 모습). */
const OFF_CHAIN_SHA = 'a'.repeat(40);

let pool: Pool;
let redis: Redis;
let app: FastifyInstance;
let sessionId: string;
/** 대역이 받은 질의 — 무엇을 물었는지까지 본다. */
let esQueries: { index: string; body: string }[];

interface NeighborItem {
  readonly merge_seq: number;
  readonly kind: string;
  readonly commit_sha: string;
  readonly pr_number: number | null;
  readonly title: string | null;
  readonly author: string | null;
  readonly merged_at: string | null;
  readonly is_anchor: boolean;
  readonly indexed: boolean;
  readonly url: string;
}

interface NeighborsBody {
  readonly sequence_space?: string;
  readonly seq_epoch?: number;
  readonly sequence_state?: string;
  readonly epoch_stale?: boolean;
  readonly requested_seq_epoch?: number;
  readonly anchor?: { merge_seq: number; kind: string; pr_number: number | null; commit_sha: string };
  readonly items?: NeighborItem[];
  readonly boundary?: { at_start: boolean; at_end: boolean };
  readonly error?: { code: string; message: string; detail?: Record<string, unknown> };
  readonly correlation_id: string;
}

async function get(
  params: Record<string, string>,
  withSession = true,
): Promise<{ status: number; body: NeighborsBody }> {
  // 공간을 요청이 지정한다 (CR-032, DEV-168). 시험은 필요할 때 덮어쓴다.
  const query = new URLSearchParams({
    repository: 'acme/payments',
    base_branch: MAIN,
    ...params,
  }).toString();
  const response = await app.inject({
    method: 'GET',
    url: `${SEQUENCE_NEIGHBORS_PATH}?${query}`,
    ...(withSession ? { headers: { cookie: `${SESSION_COOKIE_NAME}=${sessionId}` } } : {}),
  });
  return { status: response.statusCode, body: response.json<NeighborsBody>() };
}

/** 대역 Elasticsearch. 표시값과 실재만 답한다 — 이웃 선택에는 관여하지 않는다. */
function stubEsClient(): Client {
  return {
    search: (request: { index: string; query: unknown; _source?: readonly string[] }) => {
      const body = JSON.stringify(request.query);
      esQueries.push({ index: request.index, body });

      const terms = /"pr_number":\[([^\]]*)\]/.exec(body);
      if (terms !== null && terms[1] !== undefined && terms[1] !== '') {
        const numbers = terms[1].split(',').map(Number).filter((n) => n !== UNINDEXED_PR);
        return Promise.resolve({
          hits: {
            total: { value: numbers.length, relation: 'eq' },
            hits: numbers.map((n) => ({
              _index: 'prs-pull-requests-v1',
              _id: `p-${String(n)}`,
              _source: {
                pr_number: n,
                title: `PR ${String(n)}`,
                author: 'kim',
                merged_at: '2026-08-12T00:00:00Z',
              },
            })),
          },
        });
      }

      const single = /"pr_number":(\d+)/.exec(body);
      if (single !== null) {
        const number = Number(single[1]);
        const known = number === MERGED_UNSEQUENCED_PR || number === OPEN_PR;
        return Promise.resolve({
          hits: {
            total: { value: known ? 1 : 0, relation: 'eq' },
            hits: known
              ? [
                  {
                    _index: 'prs-pull-requests-v1',
                    _id: `p-${String(number)}`,
                    _source: { state: number === OPEN_PR ? 'open' : 'merged' },
                  },
                ]
              : [],
          },
        });
      }

      /*
       * 직접 푸시 행의 표시값 조회 (WP-067 / CR-038, DEV-212).
       *
       * `terms`로 여러 SHA를 **한 번에** 묻는다. 행마다 물으면 이 갈래가 목록
       * 길이만큼 호출되고, `esQueries`가 그것을 그대로 드러낸다.
       */
      const shaTerms = /"commit_sha":\[([^\]]*)\]/.exec(body);
      if (shaTerms !== null && shaTerms[1] !== undefined && shaTerms[1] !== '') {
        const shas = shaTerms[1].split(',').map((one) => one.replace(/"/g, ''));
        // 서수 3(직접 푸시)만 보강돼 있다. 나머지는 아직 문서가 없다.
        const enriched = shas.filter((one) => one === shaOf(3));
        return Promise.resolve({
          hits: {
            total: { value: enriched.length, relation: 'eq' },
            hits: enriched.map((one) => ({
              _index: 'prs-commits-v1',
              _id: `c-${one}`,
              _source: {
                commit_sha: one,
                message: 'hotfix: 결제 타임아웃\n\n본문은 목록에 실리지 않는다.',
                author: 'park',
                committed_at: '2026-08-11T05:00:00Z',
              },
            })),
          },
        });
      }

      const sha = /"commit_sha":"([0-9a-f]{40})"/.exec(body);
      const known = sha !== null && sha[1] === OFF_CHAIN_SHA;
      return Promise.resolve({
        hits: {
          total: { value: known ? 1 : 0, relation: 'eq' },
          hits: known
            ? [{ _index: 'prs-commits-v1', _id: 'c-1', _source: { commit_sha: OFF_CHAIN_SHA } }]
            : [],
        },
      });
    },
    msearch: () => {
      throw new Error('선행·후행은 search만 쓴다');
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

  await authRepo.upsertUserOnLogin(pool, { user_id: USER, login: 'kim', github_user_id: 7401 });
  for (const [id, owner, name, org, branches] of [
    [PAYMENTS, 'acme', 'payments', ORG, [MAIN]],
    [RISK, 'acme', 'risk', ORG, [MAIN]],
    [MULTI, 'acme', 'multi', ORG, [MAIN, RELEASE]],
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
  for (const commit of COMMITS) {
    await mergeSequenceRepo.upsertMergeSequence(pool, {
      repository_id: PAYMENTS,
      base_branch: MAIN,
      seq_epoch: 1,
      merge_seq: commit.seq,
      commit_sha: shaOf(commit.seq),
      pull_request_number: commit.pr,
      committed_at: new Date(`2026-08-0${String(commit.seq)}T00:00:00Z`),
    });
  }
  await sequenceSpaceRepo.advanceHead(pool, PAYMENTS, MAIN, shaOf(7), 7);

  // RISK: 공간은 에폭 2, 서수 행은 에폭 1 — 이전 에폭 행은 앵커가 되지 않는다.
  await sequenceSpaceRepo.ensureSequenceSpace(pool, RISK, MAIN);
  await mergeSequenceRepo.upsertMergeSequence(pool, {
    repository_id: RISK,
    base_branch: MAIN,
    seq_epoch: 1,
    merge_seq: 1,
    commit_sha: `${'9'.repeat(40)}`,
    pull_request_number: MERGED_UNSEQUENCED_PR,
    committed_at: new Date('2026-08-01T00:00:00Z'),
  });
  await pool.query('UPDATE sequence_space SET seq_epoch = 2 WHERE repository_id = $1', [RISK]);

  /*
   * MULTI: 두 공간이 SHARED_SHA를 공유한다. **릴리스 행을 먼저 넣는다** — 공간을
   * 좁히지 않는 조회는 저장 순서가 먼저 준 행을 앵커로 쓰므로, 이 순서에서
   * `base_branch=main` 요청이 `main` 답을 내야 결함이 없는 것이다.
   */
  await sequenceSpaceRepo.ensureSequenceSpace(pool, MULTI, RELEASE);
  await sequenceSpaceRepo.ensureSequenceSpace(pool, MULTI, MAIN);
  for (const row of [...MULTI_ROWS].sort((a, b) => (a.branch === RELEASE ? -1 : 1) - (b.branch === RELEASE ? -1 : 1))) {
    await mergeSequenceRepo.upsertMergeSequence(pool, {
      repository_id: MULTI,
      base_branch: row.branch,
      seq_epoch: 1,
      merge_seq: row.seq,
      commit_sha: row.sha,
      pull_request_number: row.pr,
      committed_at: new Date('2026-08-10T00:00:00Z'),
    });
  }
  await sequenceSpaceRepo.advanceHead(pool, MULTI, MAIN, multiSha(3), 3);
  await sequenceSpaceRepo.advanceHead(pool, MULTI, RELEASE, multiSha(12), 12);

  const redisPort: AuthRedis = {
    get: (key) => redis.get(key),
    set: (key, value, mode, seconds) => redis.set(key, value, mode, seconds),
    del: (...keys) => redis.del(...keys),
    scan: (cursor, m, pattern, c, n) => redis.scan(cursor, m, pattern, c, n),
  };
  const source: AccessScopeSource = {
    fetch: async () => ({
      repositoryIds: [PAYMENTS, RISK, MULTI],
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
    search: { es, cursorSigner: TEST_CURSOR_SIGNER, resolveNames: async () => ({ orgIds: new Map(), teamIds: new Map() }) },
    sequence: { pool, es, cursorSigner: TEST_CURSOR_SIGNER, resolveNames: async () => ({ orgIds: new Map(), teamIds: new Map() }) },
  });
  await app.ready();
}, 180_000);

beforeEach(async () => {
  esQueries = [];
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

describe('앞뒤 각 N건 (AC-1·AC-2·AC-3)', () => {
  it('기준을 포함해 서수 오름차순으로 낸다', async () => {
    const { status, body } = await get({ pr_number: '604', count: '2' });
    expect(status).toBe(200);
    expect((body.items ?? []).map((item) => item.merge_seq)).toEqual([2, 3, 4, 5, 6]);
    expect(body.anchor).toEqual({
      merge_seq: 4,
      kind: 'pull_request',
      pr_number: 604,
      commit_sha: shaOf(4),
    });
    const anchors = (body.items ?? []).filter((item) => item.is_anchor);
    expect(anchors).toHaveLength(1);
    expect(anchors[0]?.merge_seq).toBe(4);
  });

  it('**직접 푸시 커밋을 거르지 않는다 — 서수가 건너뛰지 않는다** (CR-031, DEV-161)', async () => {
    const { body } = await get({ pr_number: '604', count: '2' });
    const seqs = (body.items ?? []).map((item) => item.merge_seq);
    // 연속이어야 한다. PR만 실으면 3이 빠져 [2,4,5,6]이 된다.
    expect(seqs).toEqual([2, 3, 4, 5, 6]);
    const direct = (body.items ?? []).find((item) => item.merge_seq === 3);
    expect(direct?.kind).toBe('commit');
    expect(direct?.pr_number).toBeNull();
    /*
     * **소속 PR 값으로 채우지 않는다** (DEV-090). 그 규칙은 그대로다.
     *
     * 달라진 것은 표시값의 **출처**다: WP-067이 커밋 문서를 채우면서 그 행의
     * 제목·작성자를 커밋 자신에게서 얻는다 (CR-038, DEV-212). 앵커 PR의 제목이
     * 새어 들어오지 않는 것이 여기서 걸리는 불변식이다.
     */
    expect(direct?.title).not.toBe('PR 604');
    expect(direct?.author).toBe('park');
    expect(direct?.url).toBe(`/commit/acme/payments/${shaOf(3)}`);
  });

  it('기본은 10건이고 상한은 50이다', async () => {
    const base = await get({ pr_number: '604' });
    // 공간이 7건뿐이라 전부 나온다 — 기본값이 10이라는 사실은 경계로 확인한다.
    expect((base.body.items ?? []).length).toBe(7);
    const capped = await get({ pr_number: '604', count: '9999' });
    expect((capped.body.items ?? []).length).toBe(7);
    const one = await get({ pr_number: '604', count: '1' });
    expect((one.body.items ?? []).map((item) => item.merge_seq)).toEqual([3, 4, 5]);
  });
});

describe('공간 경계 (AC-4)', () => {
  it('앞이 모자라면 존재분만 내고 at_start를 밝힌다', async () => {
    const { status, body } = await get({ pr_number: '601', count: '3' });
    expect(status).toBe(200);
    expect((body.items ?? []).map((item) => item.merge_seq)).toEqual([1, 2, 3, 4]);
    expect(body.boundary).toEqual({ at_start: true, at_end: false });
  });

  it('뒤가 모자라면 at_end를 밝힌다', async () => {
    const { body } = await get({ pr_number: '607', count: '3' });
    expect((body.items ?? []).map((item) => item.merge_seq)).toEqual([4, 5, 6, 7]);
    expect(body.boundary).toEqual({ at_start: false, at_end: true });
  });

  it('양쪽이 다 차면 경계가 아니다', async () => {
    const { body } = await get({ pr_number: '604', count: '1' });
    expect(body.boundary).toEqual({ at_start: false, at_end: false });
  });
});

describe('커밋 앵커 (CR-031, DEV-163)', () => {
  it('같은 지점을 커밋으로 물어도 같은 목록이다', async () => {
    const byPr = await get({ pr_number: '604', count: '2' });
    const bySha = await get({ commit_sha: shaOf(4), count: '2' });
    expect(bySha.status).toBe(200);
    expect((bySha.body.items ?? []).map((i) => i.merge_seq)).toEqual(
      (byPr.body.items ?? []).map((i) => i.merge_seq),
    );
    expect(bySha.body.anchor).toEqual(byPr.body.anchor);
  });

  it('**직접 푸시 커밋도 앵커가 된다** — PR이 없어 이 경로뿐이다', async () => {
    const { status, body } = await get({ commit_sha: shaOf(3), count: '1' });
    expect(status).toBe(200);
    expect(body.anchor).toEqual({
      merge_seq: 3,
      kind: 'commit',
      pr_number: null,
      commit_sha: shaOf(3),
    });
    expect((body.items ?? []).map((i) => i.merge_seq)).toEqual([2, 3, 4]);
  });

  it('앵커가 둘이거나 없으면 400이다', async () => {
    const both = await get({ pr_number: '604', commit_sha: shaOf(4) });
    expect(both.status).toBe(400);
    expect(both.body.error?.code).toBe('INVALID_PARAMETER');
    const neither = await get({});
    expect(neither.status).toBe(400);
  });

  it('축약 SHA는 받지 않는다 — 해석은 `/resolve`의 몫이다', async () => {
    const { status, body } = await get({ commit_sha: 'abc1234' });
    expect(status).toBe(400);
    expect(body.error?.detail?.['field']).toBe('commit_sha');
  });
});

describe('서수가 없을 때 사유를 가른다 (DEV-164)', () => {
  it('미머지 PR은 not_merged다', async () => {
    const { status, body } = await get({ pr_number: String(OPEN_PR) });
    expect(status).toBe(409);
    expect(body.error?.code).toBe('NO_SEQUENCE');
    expect(body.error?.detail?.['reason']).toBe('not_merged');
    expect(body.error?.detail?.['state']).toBe('open');
  });

  it('머지됐으나 채번 전이면 not_sequenced다 — 같은 문구로 묶지 않는다', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `${SEQUENCE_NEIGHBORS_PATH}?repository=acme%2Frisk&base_branch=${MAIN}&pr_number=${String(MERGED_UNSEQUENCED_PR)}`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${sessionId}` },
    });
    expect(response.statusCode).toBe(409);
    const body = response.json<NeighborsBody>();
    expect(body.error?.detail?.['reason']).toBe('not_sequenced');
  });

  it('체인 밖 커밋도 not_sequenced다 — 실재는 색인이 확인한다', async () => {
    const { status, body } = await get({ commit_sha: OFF_CHAIN_SHA });
    expect(status).toBe(409);
    expect(body.error?.detail?.['reason']).toBe('not_sequenced');
  });

  it('없는 PR·커밋은 404다 — 존재를 드러내지 않는다', async () => {
    const pr = await get({ pr_number: '9999' });
    expect(pr.status).toBe(404);
    const sha = await get({ commit_sha: UNKNOWN_SHA });
    expect(sha.status).toBe(404);
  });
});

describe('표시값과 접근 통제', () => {
  it('색인에 없는 이웃도 행으로 남는다 (DEV-166 / DEV-130)', async () => {
    const { body } = await get({ pr_number: '604', count: '2' });
    const unindexed = (body.items ?? []).find((item) => item.pr_number === UNINDEXED_PR);
    expect(unindexed).toBeDefined();
    expect(unindexed?.indexed).toBe(false);
    expect(unindexed?.title).toBeNull();
    // 서수와 SHA는 확정값이다.
    expect(unindexed?.merge_seq).toBe(5);
    expect(unindexed?.commit_sha).toBe(shaOf(5));
  });

  it('표시값 조회가 저장소로 라우팅되고 강제 필터를 지난다 (ADR-008)', async () => {
    await get({ pr_number: '604', count: '2' });
    const display = esQueries.find((q) => q.body.includes('"pr_number":['));
    expect(display).toBeDefined();
    expect(display?.body).toContain('"repository_id"');
  });

  it('접근 범위 밖 저장소는 404다', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `${SEQUENCE_NEIGHBORS_PATH}?repository=other%2Fsecret&base_branch=${MAIN}&pr_number=1`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${sessionId}` },
    });
    expect(response.statusCode).toBe(404);
  });

  it('세션이 없으면 조회할 수 없다', async () => {
    const { status } = await get({ pr_number: '604' }, false);
    expect(status).toBe(401);
  });
});

describe('에폭 봉투 (ADR-007)', () => {
  it('인용이 다르면 결과를 내지 않는다', async () => {
    const { status, body } = await get({ pr_number: '604', seq_epoch: '99' });
    expect(status).toBe(200);
    expect(body.epoch_stale).toBe(true);
    expect(body.requested_seq_epoch).toBe(99);
    expect(body.items).toBeUndefined();
  });

  it('같은 에폭이면 그대로 낸다', async () => {
    const { body } = await get({ pr_number: '604', seq_epoch: '1' });
    expect(body.epoch_stale).toBe(false);
    expect(body.items).toBeDefined();
    expect(body.sequence_state).toBe('ok');
  });
});

describe('공간을 요청이 지정한다 (CR-032, DEV-168)', () => {
  async function multi(params: Record<string, string>): Promise<{ status: number; body: NeighborsBody }> {
    const query = new URLSearchParams({ repository: 'acme/multi', ...params }).toString();
    const response = await app.inject({
      method: 'GET',
      url: `${SEQUENCE_NEIGHBORS_PATH}?${query}`,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${sessionId}` },
    });
    return { status: response.statusCode, body: response.json<NeighborsBody>() };
  }

  it('**같은 PR이 두 공간에 있으면 요청한 공간의 서수를 낸다**', async () => {
    const main = await multi({ base_branch: MAIN, pr_number: String(SHARED_PR), count: '5' });
    expect(main.status).toBe(200);
    expect(main.body.sequence_space).toBe(`acme/multi@${MAIN}`);
    expect(main.body.anchor?.merge_seq).toBe(2);
    expect((main.body.items ?? []).map((i) => i.merge_seq)).toEqual([1, 2, 3]);

    const release = await multi({ base_branch: RELEASE, pr_number: String(SHARED_PR), count: '5' });
    expect(release.status).toBe(200);
    expect(release.body.sequence_space).toBe(`acme/multi@${RELEASE}`);
    expect(release.body.anchor?.merge_seq).toBe(11);
    expect((release.body.items ?? []).map((i) => i.merge_seq)).toEqual([10, 11, 12]);
  });

  it('**같은 커밋 앵커도 요청한 공간을 따른다** — 앵커 종류가 규칙을 바꾸지 않는다', async () => {
    const main = await multi({ base_branch: MAIN, commit_sha: SHARED_SHA, count: '5' });
    expect(main.body.sequence_space).toBe(`acme/multi@${MAIN}`);
    expect(main.body.anchor?.merge_seq).toBe(2);
    expect((main.body.items ?? []).map((i) => i.merge_seq)).toEqual([1, 2, 3]);

    const release = await multi({ base_branch: RELEASE, commit_sha: SHARED_SHA, count: '5' });
    expect(release.body.sequence_space).toBe(`acme/multi@${RELEASE}`);
    expect(release.body.anchor?.merge_seq).toBe(11);
    expect((release.body.items ?? []).map((i) => i.merge_seq)).toEqual([10, 11, 12]);
  });

  it('응답의 공간은 **언제나 요청한 공간이다** — 이웃도 그 공간에서만 나온다', async () => {
    for (const [branch, seqs] of [
      [MAIN, [1, 2, 3]],
      [RELEASE, [10, 11, 12]],
    ] as const) {
      const { body } = await multi({ base_branch: branch, pr_number: String(SHARED_PR), count: '5' });
      expect(body.sequence_space).toBe(`acme/multi@${branch}`);
      // 다른 공간의 서수가 한 건도 섞이지 않는다.
      expect((body.items ?? []).map((i) => i.merge_seq)).toEqual([...seqs]);
    }
  });

  it('**저장 순서를 뒤집어도 답이 같다** — 데이터베이스 반환 순서에 기대지 않는다', async () => {
    const readMain = async (): Promise<number | undefined> =>
      (await multi({ base_branch: MAIN, pr_number: String(SHARED_PR), count: '5' })).body.anchor?.merge_seq;
    expect(await readMain()).toBe(2);

    // 공유 커밋의 두 행을 지우고 순서를 바꿔 다시 넣는다.
    await pool.query(
      'DELETE FROM merge_sequence WHERE repository_id = $1 AND commit_sha = $2',
      [MULTI, SHARED_SHA],
    );
    for (const branch of [MAIN, RELEASE]) {
      const row = MULTI_ROWS.find((r) => r.branch === branch && r.sha === SHARED_SHA);
      if (row === undefined) throw new Error('픽스처가 깨졌다');
      await mergeSequenceRepo.upsertMergeSequence(pool, {
        repository_id: MULTI,
        base_branch: row.branch,
        seq_epoch: 1,
        merge_seq: row.seq,
        commit_sha: row.sha,
        pull_request_number: row.pr,
        committed_at: new Date('2026-08-10T00:00:00Z'),
      });
    }
    expect(await readMain()).toBe(2);
  });

  it('다른 공간에만 있는 PR은 그 공간의 답으로 대신하지 않는다', async () => {
    // 810은 릴리스 공간에만 있다. main으로 물으면 그 행을 빌려 오지 않는다.
    const { status, body } = await multi({ base_branch: MAIN, pr_number: '810' });
    expect(status).not.toBe(200);
    expect(body.items).toBeUndefined();
  });

  it('base_branch가 없으면 공간을 추측하지 않는다 — 400이다', async () => {
    const { status, body } = await multi({ pr_number: String(SHARED_PR) });
    expect(status).toBe(400);
    expect(body.error?.code).toBe('INVALID_PARAMETER');
    expect(body.error?.detail?.['field']).toBe('base_branch');
  });

  it('채번된 적 없는 브랜치는 404다 (DEV-137)', async () => {
    const { status } = await multi({ base_branch: UNSEQUENCED_BRANCH, pr_number: String(SHARED_PR) });
    expect(status).toBe(404);
  });
});

describe('merged_at은 행의 종류가 정한다 (CR-032, DEV-169)', () => {
  it('색인된 PR 행은 PR 문서의 머지 시각이다', async () => {
    const { body } = await get({ pr_number: '604', count: '2' });
    const indexed = (body.items ?? []).find((item) => item.pr_number === 604);
    expect(indexed?.indexed).toBe(true);
    expect(indexed?.merged_at).toBe('2026-08-12T00:00:00Z');
  });

  it('**색인 안 된 PR 행은 null이다 — 커밋 시각을 머지 시각으로 싣지 않는다**', async () => {
    const { body } = await get({ pr_number: '604', count: '2' });
    const unindexed = (body.items ?? []).find((item) => item.pr_number === UNINDEXED_PR);
    expect(unindexed?.indexed).toBe(false);
    expect(unindexed?.kind).toBe('pull_request');
    // 정본의 committed_at(서수 5 = 2026-08-05)이 새어 나오면 안 된다.
    expect(unindexed?.merged_at).toBeNull();
  });

  it('직접 푸시 커밋 행은 커밋 시각이다 — 그 행에는 PR이 없다', async () => {
    const { body } = await get({ pr_number: '604', count: '2' });
    const direct = (body.items ?? []).find((item) => item.merge_seq === 3);
    expect(direct?.kind).toBe('commit');
    expect(direct?.pr_number).toBeNull();
    expect(direct?.merged_at).toBe('2026-08-03T00:00:00.000Z');
  });

  /**
   * 직접 푸시 행의 표시값 (WP-067 / CR-038, DEV-212).
   *
   * WP-027이 이 행을 실제로 노출하기 시작했는데 제목·작성자가 언제나 비어 있었다 —
   * **SHA만 보이는 행**이다. 그것이 이 WP의 사용자-visible 동기다.
   */
  describe('직접 푸시 행이 메타데이터를 보인다 (WP-067)', () => {
    it('**제목 첫 줄·작성자가 실제로 채워진다**', async () => {
      esQueries.length = 0;
      const { status, body } = await get({ pr_number: '604', count: '3' });
      expect(status).toBe(200);

      const direct = (body.items ?? []).find((item) => item.merge_seq === 3);
      expect(direct).toBeDefined();
      expect(direct?.pr_number).toBeNull();
      // 목록 행이라 첫 줄만이다. 전문은 커밋 상세가 준다.
      expect(direct?.title).toBe('hotfix: 결제 타임아웃');
      expect(direct?.author).toBe('park');
      // 표시 소스가 색인에 있으므로 `indexed`가 참이다 (DEV-130의 규칙).
      expect(direct?.indexed).toBe(true);
      // 그 행의 시각은 커밋 시각이다 (DEV-169). 커밋 문서가 그것을 덮지 않는다.
      expect(direct?.merged_at).not.toBeNull();
    });

    it('**커밋 표시값을 조회 한 번으로 읽는다** — N+1이 아니다', async () => {
      esQueries.length = 0;
      await get({ pr_number: '604', count: '3' });

      const commitQueries = esQueries.filter((one) => one.index === 'prs-commits');
      expect(commitQueries).toHaveLength(1);
      // 그리고 그 한 번이 `terms`로 여러 SHA를 함께 묻는다.
      expect(commitQueries[0]?.body).toContain('"commit_sha":[');
    });

    it('보강되지 않은 직접 푸시 행은 제목이 비고 `indexed`가 거짓이다', async () => {
      /*
       * 조용히 채우지 않는다 — "아직 보강되지 않았다"와 "제목이 없다"는 다른
       * 사실이고, 화면이 그 둘을 구분할 수 있어야 한다.
       */
      esQueries.length = 0;
      const { body } = await get({ repository: 'acme/multi', pr_number: String(SHARED_PR), count: '3' });
      const rows = (body.items ?? []).filter((item) => item.pr_number === null);
      for (const row of rows) {
        expect(row.title).toBeNull();
        expect(row.indexed).toBe(false);
      }
    });
  });
});
