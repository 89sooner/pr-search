/**
 * `GET /sequence-ranges` — 구간 순회와 패싯 (WP-032 / FR-SEQ-002 AC-6·7·8).
 *
 * 실제 PostgreSQL + 실제 Elasticsearch.
 *
 * ## 이 파일이 존재하는 이유
 *
 * CR-043이 재현한 결함(DEV-270)과 CR-044가 그 정정에서 찾은 반대 방향의
 * 결함(DEV-287)은 **둘 다 여러 왕복의 합**으로만 드러난다. 응답 하나만 보면
 * 두 상태가 정상과 구분되지 않는다.
 *
 * | 반례 | 무엇이 깨지나 |
 * | --- | --- |
 * | A (DEV-270) | 구간 1~60·`size=10`·일치가 서수 51 하나 → 예전 구현은 `items: []`에 `next_cursor: null`을 냈다. **일치가 있다고 요약이 말하는데 도달할 수 없다** |
 * | B (DEV-287) | chunk 100·`size=10`·그 chunk에 일치 20건 → 커서를 chunk 끝으로 밀면 **나머지 10건이 영영 사라진다** |
 *
 * 둘은 같은 규칙의 두 결과다 — **완결 서수**는 "그 서수 이하에 아직 내주지
 * 않은 일치가 없는 지점"이며, 그 하나의 물음이 양쪽을 함께 막는다.
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
import { authRepo, mergeSequenceRepo, repositoryRepo, sequenceSpaceRepo, type Pool } from '@prs/db';
import type { Redis } from '@prs/bus';
import { buildServer } from '../../src/server.js';
import { SEQUENCE_RANGE_PATH } from '../../src/sequence/routes.js';
import type { AuthContext, AuthRedis } from '../../src/auth/context.js';
import { createTestRedis, migratedPool, clearMergeSequence } from '../helpers.js';
import { TEST_CURSOR_KEY, TEST_CURSOR_SIGNER } from '../_cursor-fixture.js';

const AUTH_CONFIG = {
  enabled: true,
  cookieSecure: true,
  loginPath: '/auth/login',
  groupRoleMap: new Map<string, never>(),
} as const;

const USER = 'sub-range-paging';
const REPO = 4301;
const ORG = 43;
const TEAM = 4310;
const BRANCH = 'main';
/** 구간 크기. 60이면 반례 A의 "구간 1~60"을 그대로 만든다. */
const SIZE = 60;

/**
 * chunk를 **작게** 준다.
 *
 * 운영 기본값은 300이라 60짜리 구간이 chunk 하나에 다 들어간다 — 그러면
 * "chunk 경계에서 일치가 잘린다"(DEV-287)를 도달 불가능한 상태로 두게 된다.
 * 시험이 그 경계를 만들 수 없으면 그 결함은 영영 재현되지 않는다.
 */
const CHUNK = 25;

let pool: Pool;
let redis: Redis;
let es: Client;
let app: FastifyInstance;
let sessionId: string;

interface RangeBody {
  readonly summary?: { pull_request_count: number; commit_count: number };
  readonly items?: { merge_seq: number; pr_number?: number; indexed: boolean }[];
  readonly facets?: Record<string, { value: string; count: number }[]>;
  readonly facets_omitted?: boolean;
  readonly facets_status?: string;
  readonly next_cursor?: string | null;
  readonly seq_epoch?: number;
  readonly error?: { code: string; message: string };
}

function shaOf(seq: number): string {
  return `${String(seq).padStart(3, '0')}${'d'.repeat(37)}`;
}

/**
 * 픽스처의 규칙 — 시험이 무엇을 기대하는지가 여기서 정해진다.
 *
 * - 서수 1..60에 PR 4001..4060이 1:1로 붙는다
 * - **작성자**: 서수 51 하나만 `solo`, 나머지는 `bulk` — 반례 A의 "일치가 하나"
 * - **라벨**: 서수 1..20이 `wide`, 나머지 없음 — 반례 B의 "chunk 안 일치 20건"
 */
const SOLO_SEQ = 51;
const WIDE_SEQS = Array.from({ length: 20 }, (_, i) => i + 1);

function authorOf(seq: number): string {
  return seq === SOLO_SEQ ? 'solo' : 'bulk';
}

function labelsOf(seq: number): string[] {
  return WIDE_SEQS.includes(seq) ? ['wide'] : [];
}

async function get(query: string): Promise<{ status: number; body: RangeBody }> {
  const response = await app.inject({
    method: 'GET',
    url: `${SEQUENCE_RANGE_PATH}?repository=paging%2Frepo&base_branch=${BRANCH}&${query}`,
    headers: { cookie: `${SESSION_COOKIE_NAME}=${sessionId}` },
  });
  return { status: response.statusCode, body: response.json<RangeBody>() };
}

/**
 * 커서를 끝까지 따라가며 서수를 모은다.
 *
 * **상한을 둔다.** 커서가 전진하지 못하는 결함(DEV-270)은 무한 루프로 나타나며,
 * 그때 시험이 멈추지 않으면 원인이 아니라 타임아웃이 보고된다.
 */
async function walk(query: string, size: number): Promise<number[]> {
  const seen: number[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 30; page += 1) {
    const suffix: string = cursor === null ? '' : `&cursor=${encodeURIComponent(cursor)}`;
    const { status, body } = await get(`${query}&size=${String(size)}${suffix}`);
    expect(status, JSON.stringify(body.error)).toBe(200);
    seen.push(...(body.items ?? []).map((one) => one.merge_seq));
    cursor = body.next_cursor ?? null;
    if (cursor === null) return seen;
  }
  throw new Error('커서가 끝나지 않았다 — 순회가 수렴하지 않는다');
}

beforeAll(async () => {
  pool = await migratedPool();
  redis = createTestRedis();
  es = createEsClient(resolveClientOptions());
  await applyMappings(es);
  // 매핑 버전이 올라간 별칭을 현재 정의로 옮긴다 (WP-032). 시험 전용.
  await switchAliasesForTests(es);

  await clearMergeSequence(pool, 'repository_id = $1', [REPO]);
  await pool.query('DELETE FROM sequence_space WHERE repository_id = $1', [REPO]);
  await pool.query('DELETE FROM permission_cache WHERE user_id = $1', [USER]);
  await pool.query('DELETE FROM app_user WHERE user_id = $1', [USER]);
  await pool.query('DELETE FROM team WHERE team_id = $1', [TEAM]);
  await pool.query('DELETE FROM repository WHERE repository_id = $1', [REPO]);

  await authRepo.upsertUserOnLogin(pool, { user_id: USER, login: 'paging-kim', github_user_id: 4_301 });
  await authRepo.upsertTeam(pool, { team_id: TEAM, slug: 'paging-core', org_id: ORG });
  await repositoryRepo.upsertRepository(pool, {
    repository_id: REPO, owner: 'paging', name: 'repo', org_id: ORG,
    visibility: 'internal', sequence_branches: [BRANCH],
  });

  await sequenceSpaceRepo.ensureSequenceSpace(pool, REPO, BRANCH);
  for (let seq = 1; seq <= SIZE; seq += 1) {
    await mergeSequenceRepo.upsertMergeSequence(pool, {
      repository_id: REPO,
      base_branch: BRANCH,
      seq_epoch: 1,
      merge_seq: seq,
      commit_sha: shaOf(seq),
      pull_request_number: 4000 + seq,
      // 60건이 서수 순서대로 늘어난다. 분(minute)만 올리면 60을 넘길 수 없다.
      committed_at: new Date(Date.UTC(2026, 7, 1, 0, 0, 0) + seq * 60_000),
    });
  }
  await sequenceSpaceRepo.advanceHead(pool, REPO, BRANCH, shaOf(SIZE), SIZE);

  await es.deleteByQuery({
    index: ['prs-pull-requests'],
    query: { term: { repository_id: REPO } },
    refresh: true,
    conflicts: 'proceed',
  });

  /*
   * **운영과 같은 방식으로 색인한다** — `routing`을 준다 (ADR-003).
   *
   * 라우팅 없이 넣으면 문서가 `_id` 해시 샤드에 흩어지고, 라우팅된 읽기는 빈
   * 샤드 하나만 본다. 실제로 CI가 그렇게 9건을 0건으로 만든 적이 있다.
   */
  const bulk = await es.bulk({
    refresh: true,
    operations: Array.from({ length: SIZE }, (_, i) => i + 1).flatMap((seq) => {
      const id = `paging-pr-${String(seq)}`;
      return [
        { index: { _index: 'prs-pull-requests', _id: id, routing: String(REPO) } },
        {
          doc_id: id,
          document_version: 1,
          repository_id: REPO,
          repository: 'paging/repo',
          org_id: ORG,
          visibility: 'internal',
          allowed_team_ids: [TEAM],
          pr_number: 4000 + seq,
          title: `PR ${String(seq)}`,
          state: 'merged',
          author: authorOf(seq),
          labels: labelsOf(seq),
          base_branch: BRANCH,
          merge_seq: seq,
          seq_epoch: 1,
          sequence_space: `paging/repo@${BRANCH}`,
          created_at: '2026-08-01T00:00:00Z',
          updated_at: '2026-08-01T00:00:00Z',
          merged_at: '2026-08-01T00:00:00Z',
          changed_files_count: 1,
          additions: 1,
          deletions: 1,
          changed_paths: [`src/pay/${String(seq)}.ts`],
          indexed_at: '2026-08-27T00:00:00Z',
        },
      ];
    }),
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
  const source: AccessScopeSource = {
    fetch: async () => ({
      repositoryIds: [REPO], orgIds: [ORG], teamIds: [TEAM], visibilities: ['public', 'internal'],
    }),
  };
  const auth: AuthContext = {
    sessions: new SessionStore({ redis: redisPort }),
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
    search: { pool, es, cursorSigner: TEST_CURSOR_SIGNER, resolveNames: async () => ({ orgIds: new Map(), teamIds: new Map() }) },
    sequence: {
      pool,
      es,
      cursorSigner: TEST_CURSOR_SIGNER,
      chunkSize: CHUNK,
      resolveTeamSlugs: (ids) => authRepo.resolveTeamSlugs(pool, ids),
      resolveNames: async () => ({ orgIds: new Map(), teamIds: new Map() }),
    },
  });
  await app.ready();
}, 180_000);

beforeEach(async () => {
  await redis.del(scopeKey(USER));
  await pool.query('UPDATE sequence_space SET seq_epoch = 1 WHERE repository_id = $1', [REPO]);
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
    sessionId, userId: USER, login: 'paging-kim', email: null,
    roles: ['developer'], issuedAt: now, lastSeenAt: now, correlationId: null,
  });
});

afterAll(async () => {
  await app?.close();
  await es?.deleteByQuery({
    index: ['prs-pull-requests'],
    query: { term: { repository_id: REPO } },
    refresh: true,
    conflicts: 'proceed',
  });
  await es?.close();
  redis?.disconnect();
  await pool?.end();
});

describe('반례 A — 첫 페이지 밖의 일치에 도달한다 (CR-043, DEV-270)', () => {
  /*
   * **CR-043이 실제 PostgreSQL·Elasticsearch로 재현한 그 조회다.**
   *
   * > 구간 1~60, `size=10`, 일치가 서수 51 하나뿐인 `q` →
   * > `summary.pull_request_count: 1`, `items: []`, `next_cursor: null`
   *
   * 데이터가 아니라 **절삭**이 원인이었고, 커서가 없으므로 사용자는 그 항목에
   * 도달할 수 없었다.
   */
  it('요약이 1건이라 말하면 목록에도 그 1건이 있다', async () => {
    const { status, body } = await get('from_seq=0&to_seq=60&size=10&q=author%3Asolo');
    expect(status, JSON.stringify(body.error)).toBe(200);

    expect(body.summary?.pull_request_count).toBe(1);
    expect(body.items?.map((one) => one.merge_seq)).toEqual([SOLO_SEQ]);
  });

  it('일치가 하나뿐이면 구간 끝까지 검사했으므로 커서가 없다', async () => {
    const { body } = await get('from_seq=0&to_seq=60&size=10&q=author%3Asolo');
    expect(body.next_cursor).toBeNull();
  });

  /*
   * **일치가 하나도 없는 페이지에서도 커서가 전진해야 한다.**
   *
   * 커서를 "실제로 반환한 마지막 항목"으로만 고정하면 이 조회에서 커서가
   * 만들어지지 않고, 순회가 제자리에 선다 — DEV-270이 만든 상태와 같다.
   */
  it('일치가 없어도 구간 끝까지 훑고 멈춘다 — 무한 순회가 아니다', async () => {
    const seqs = await walk('from_seq=0&to_seq=60&q=author%3Anobody', 10);
    expect(seqs).toEqual([]);
  });
});

describe('반례 B — chunk 경계에서 일치가 사라지지 않는다 (CR-044, DEV-287)', () => {
  /*
   * chunk 25 · `size` 10 · 서수 1~20이 일치.
   *
   * 커서를 **검사한 마지막 서수**(= chunk 끝 25)로 봉인하면 첫 페이지가 1~10만
   * 내주고 11~20이 영영 사라진다. 완결 서수는 "실제로 실은 마지막 일치"(10)를
   * 봉인하므로 다음 페이지가 11부터 다시 판정한다.
   */
  it('한 chunk의 일치가 `size`보다 많아도 나머지가 사라지지 않는다', async () => {
    const seqs = await walk('from_seq=0&to_seq=60&q=label%3Awide', 10);
    expect(seqs).toEqual(WIDE_SEQS);
  });

  it('페이지 경계가 실제로 chunk 안쪽이다 — 이 시험이 무엇을 재는지 확인한다', async () => {
    const first = await get('from_seq=0&to_seq=60&size=10&q=label%3Awide');
    expect(first.body.items?.map((one) => one.merge_seq)).toEqual(WIDE_SEQS.slice(0, 10));
    // 커서가 없으면 이 반례 자체가 성립하지 않는다.
    expect(first.body.next_cursor).not.toBeNull();
  });

  it('중복도 누락도 없다 — 페이지 크기를 바꿔도 같다', async () => {
    for (const size of [1, 3, 7, 20]) {
      const seqs = await walk('from_seq=0&to_seq=60&q=label%3Awide', size);
      expect(new Set(seqs).size, String(size)).toBe(seqs.length);
      expect(seqs, String(size)).toEqual(WIDE_SEQS);
    }
  });

  it('`q`가 없으면 구간 전체를 순회한다', async () => {
    const seqs = await walk('from_seq=0&to_seq=60', 10);
    expect(seqs).toEqual(Array.from({ length: SIZE }, (_, i) => i + 1));
  });
});

describe('구간 커서의 봉인 (FR-SEQ-002 AC-7)', () => {
  async function firstCursor(query: string): Promise<string> {
    const { body } = await get(`${query}&size=5`);
    expect(body.next_cursor).not.toBeNull();
    return body.next_cursor as string;
  }

  /*
   * **에폭이 바뀐 뒤 옛 커서를 이어 쓰면 서수가 다른 두 공간을 한 목록으로
   * 섞는다** — 그것이 에폭이 존재하는 이유다 (ADR-007).
   */
  it('에폭이 바뀌면 `CURSOR_QUERY_MISMATCH`다', async () => {
    const cursor = await firstCursor('from_seq=0&to_seq=60');
    await pool.query('UPDATE sequence_space SET seq_epoch = 2 WHERE repository_id = $1', [REPO]);

    const { status, body } = await get(`from_seq=0&to_seq=60&size=5&cursor=${encodeURIComponent(cursor)}`);
    expect(status).toBe(400);
    expect(body.error?.code).toBe('CURSOR_QUERY_MISMATCH');
  });

  it('구간 경계가 바뀌면 `CURSOR_QUERY_MISMATCH`다 — 다른 구간을 보고 있다', async () => {
    const cursor = await firstCursor('from_seq=0&to_seq=60');
    const { status, body } = await get(`from_seq=0&to_seq=30&size=5&cursor=${encodeURIComponent(cursor)}`);
    expect(status).toBe(400);
    expect(body.error?.code).toBe('CURSOR_QUERY_MISMATCH');
  });

  it('`q`가 바뀌면 `CURSOR_QUERY_MISMATCH`다', async () => {
    const cursor = await firstCursor('from_seq=0&to_seq=60');
    const { status, body } = await get(
      `from_seq=0&to_seq=60&size=5&q=label%3Awide&cursor=${encodeURIComponent(cursor)}`,
    );
    expect(status).toBe(400);
    expect(body.error?.code).toBe('CURSOR_QUERY_MISMATCH');
  });

  it('훼손된 커서는 `CURSOR_INVALID`다 — 조건 변경과 다른 사실이다', async () => {
    const cursor = await firstCursor('from_seq=0&to_seq=60');
    const tampered = `${cursor.slice(0, -1)}${cursor.endsWith('A') ? 'B' : 'A'}`;
    const { status, body } = await get(`from_seq=0&to_seq=60&size=5&cursor=${encodeURIComponent(tampered)}`);
    expect(status).toBe(400);
    expect(body.error?.code).toBe('CURSOR_INVALID');
  });

  it('W-001의 커서를 여기에 넣어도 거절된다 — 두 순회는 같은 것이 아니다', async () => {
    const { status, body } = await get('from_seq=0&to_seq=60&size=5&cursor=not-a-range-cursor');
    expect(status).toBe(400);
    expect(body.error?.code).toBe('CURSOR_INVALID');
  });
});

describe('패싯은 구간 전체를 센다 (FR-SEQ-002 AC-8)', () => {
  it('네 축이다 — 공간이 고정한 축을 다시 묻지 않는다', async () => {
    const { body } = await get('from_seq=0&to_seq=60&size=5&facets=true');
    expect(body.facets_status).toBe('ready');
    const axes = Object.keys(body.facets ?? {}).sort();
    expect(axes).toEqual(['author', 'label', 'path', 'team']);
    // 저장소·대상 브랜치·상태는 W-004의 축이 아니다.
    expect(axes).not.toContain('repository');
    expect(axes).not.toContain('base_branch');
    expect(axes).not.toContain('state');
  });

  /*
   * **페이지가 아니라 구간이 기준이다.**
   *
   * 정본 구간을 첫 `size`로 자른 뒤 집계하면 DEV-270의 결함이 패싯 축에서
   * 반복된다 — 페이지 1이 5건인데 분포가 5건 기준이면 사용자는 구간 전체의
   * 분포를 볼 수 없다.
   */
  it('페이지가 5건이어도 분포는 60건 기준이다', async () => {
    const { body } = await get('from_seq=0&to_seq=60&size=5&facets=true');
    expect(body.items).toHaveLength(5);

    const authors = body.facets?.['author'] ?? [];
    const total = authors.reduce((acc, one) => acc + one.count, 0);
    expect(total).toBe(SIZE);
    expect(authors.find((one) => one.value === 'solo')?.count).toBe(1);
    expect(authors.find((one) => one.value === 'bulk')?.count).toBe(SIZE - 1);
  });

  it('`q`가 좁히면 분포도 좁아진다 — 목록과 같은 조건이다', async () => {
    const { body } = await get('from_seq=0&to_seq=60&size=5&facets=true&q=label%3Awide');
    const authors = body.facets?.['author'] ?? [];
    expect(authors.reduce((acc, one) => acc + one.count, 0)).toBe(WIDE_SEQS.length);
  });

  it('팀 축이 slug으로 해석된다 (DEV-281)', async () => {
    const { body } = await get('from_seq=0&to_seq=60&size=5&facets=true');
    expect((body.facets?.['team'] ?? []).map((one) => one.value)).toEqual(['paging-core']);
  });

  it('경로 축이 `changed_paths.raw`를 센다 — 분석된 필드로는 집계가 거부된다', async () => {
    const { body } = await get('from_seq=0&to_seq=60&size=5&facets=true');
    const paths = body.facets?.['path'] ?? [];
    expect(paths.length).toBeGreaterThan(0);
    expect(paths[0]?.value).toMatch(/^src\/pay\//);
  });

  it('요청하지 않으면 세 키가 없다', async () => {
    const { body } = await get('from_seq=0&to_seq=60&size=5');
    expect(body.facets).toBeUndefined();
    expect(body.facets_omitted).toBeUndefined();
    expect(body.facets_status).toBeUndefined();
  });

  it('이어 보기는 분포를 다시 세지 않는다 — 같은 값을 다시 계산할 뿐이다', async () => {
    const first = await get('from_seq=0&to_seq=60&size=5&facets=true');
    const next = await get(
      `from_seq=0&to_seq=60&size=5&cursor=${encodeURIComponent(String(first.body.next_cursor))}`,
    );
    expect(next.status).toBe(200);
    expect(next.body.facets).toBeUndefined();
  });
});
