/**
 * 시퀀스 재투영 뒤의 실제 검색 (CR-113 / WP-098, FR-SEQ-001 AC-7, FR-SRCH-007).
 *
 * 사내 `pilot.17` 보고의 증상은 화면이었다 — "M number" 정렬(= ES `merge_seq` 정렬)이 어긋나고
 * `merge_seq`를 잃은 문서가 목록 뒤로 밀렸다. 이 파일은 그 증상을 **Search API 자체**로 재현하고,
 * 정본에서 색인으로 재투영한 뒤 새 검색 요청이 정렬·`seq:` 범위·cursor 전체 순회를 정본 순서대로
 * 돌려주는지 확인한다.
 *
 * ## 판정 기준
 *
 * 같은 저장소·base·현재 에폭에서 확정된 서수 순서다. **Merged at 정렬과의 동일성은 기준이 아니다** —
 * fixture는 PR 번호·`merged_at`·서수의 순서가 일부러 서로 다르다. ES 원시 필드(`merge_seq`·
 * `seq_epoch`·`sequence_space`)를 직접 읽어 대조한다 — API가 DB 값으로 화면을 보강했다는 이유로
 * 통과시키지 않는다.
 *
 * ## 기존 cursor/PIT
 *
 * 복구 전에 연 cursor는 PIT 스냅숏을 유지하므로 복구 결과를 보지 않는다. 그것은 결함이 아니라
 * cursor 계약이며 여기서 따로 확인한다 — 복구 뒤 검증은 **새 검색 요청**으로 한다.
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
  applyMappings,
  createEsClient,
  projectSequenceToDocuments,
  readSequenceProjection,
  resolveClientOptions,
  switchAliasesForTests,
  SERVING_ONLY,
  type SequenceProjectionItem,
} from '@prs/es';
import { authRepo, mergeSequenceRepo, prSnapshotRepo, repositoryRepo, sequenceProjectionRepo, sequenceSpaceRepo, type Pool } from '@prs/db';
import { pullRequestDocId } from '@prs/domain';
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

const USER = 'sub-seq-projection-recovery';
const REPOSITORY_ID = 5113;
const ORG = 53;
const BRANCH = 'main';
const SLUG = 'cr113recover/payments';
const SPACE = `${SLUG}@${BRANCH}`;
const QUERY = `repo:${SLUG} base:${BRANCH}`;

/**
 * 서수·PR 번호·merged_at이 **서로 다른 순서**다. 어느 하나로 다른 것을 추정할 수 없게 한다.
 *
 * | seq | PR  | merged_at (시각 순위) |
 * | --- | --- | --------------------- |
 * | 1   | 305 | 3                     |
 * | 2   | 301 | 5                     |
 * | 3   | 309 | 1                     |
 * | 4   | 302 | 4                     |
 * | 5   | 307 | 2                     |
 */
const ROWS = [
  { seq: 1, pr: 305, mergedAt: '2026-09-03T00:00:00Z' },
  { seq: 2, pr: 301, mergedAt: '2026-09-05T00:00:00Z' },
  { seq: 3, pr: 309, mergedAt: '2026-09-01T00:00:00Z' },
  { seq: 4, pr: 302, mergedAt: '2026-09-04T00:00:00Z' },
  { seq: 5, pr: 307, mergedAt: '2026-09-02T00:00:00Z' },
] as const;

const shaOf = (seq: number): string => String(seq).repeat(40).slice(0, 40).replace(/[^0-9a-f]/g, 'a');

let pool: Pool;
let redis: Redis;
let es: Client;
let app: FastifyInstance;
let sessionId: string;
let sessions: SessionStore;

interface SearchBody {
  readonly total?: { value: number; relation: string };
  readonly items?: { pr_number?: number; merge_seq: number | null; seq_epoch: number | null; merged_at?: string | null }[];
  readonly next_cursor?: string | null;
  readonly error?: { code: string; message: string };
}

async function get(query: string): Promise<{ status: number; body: SearchBody }> {
  const response = await app.inject({ method: 'GET', url: `${SEARCH_PATH}?${query}`, headers: { cookie: `${SESSION_COOKIE_NAME}=${sessionId}` } });
  return { status: response.statusCode, body: response.json<SearchBody>() };
}

const prNumbers = (body: SearchBody): number[] => (body.items ?? []).map((one) => one.pr_number ?? -1);

function prDocument(row: (typeof ROWS)[number]): Record<string, unknown> {
  return {
    repository_id: REPOSITORY_ID,
    repository: SLUG,
    org_id: ORG,
    visibility: 'internal',
    allowed_team_ids: [530],
    pr_number: row.pr,
    title: `PR ${String(row.pr)}`,
    state: 'merged',
    author: 'kim',
    labels: ['cr113'],
    base_branch: BRANCH,
    merge_commit_sha: shaOf(row.seq),
    merged_at: row.mergedAt,
    created_at: '2026-08-15T00:00:00Z',
    updated_at: row.mergedAt,
    changed_files_count: 1,
    additions: 10,
    deletions: 1,
    document_version: 1,
  };
}

/** 색인 문서를 **서수 없이** 심는다 — 재색인 직후·수동 update_by_query 이전의 운영 상태다. */
async function seedIndexWithoutSequence(): Promise<void> {
  await es.deleteByQuery({ index: ['prs-pull-requests'], query: { term: { repository_id: REPOSITORY_ID } }, refresh: true, conflicts: 'proceed' });
  const bulk = await es.bulk({
    refresh: true,
    operations: ROWS.flatMap((row) => [
      { index: { _index: 'prs-pull-requests', _id: pullRequestDocId(REPOSITORY_ID, row.pr), routing: String(REPOSITORY_ID) } },
      { ...prDocument(row), doc_id: pullRequestDocId(REPOSITORY_ID, row.pr) },
    ]),
  });
  if (bulk.errors) throw new Error('fixture 색인이 거부됐다');
}

/**
 * 정본에서 항목을 만들어 같은 투영기로 비춘다. 애플리케이션 계층의 정본 해석
 * (`sequenceProjectionRepo` → 항목)을 그대로 따른다 — 여기서 PR 번호로 서수를 지어내지 않는다.
 */
async function reprojectFromCanonical(): Promise<void> {
  const rows = await sequenceProjectionRepo.listProjectionTargetsAfter(pool, { repositoryId: REPOSITORY_ID, baseBranch: BRANCH, seqEpoch: 1, afterSeq: 0, limit: 500 });
  const items: SequenceProjectionItem[] = rows.flatMap((row) =>
    row.pr_numbers.map((prNumber) => ({
      kind: 'pull_request' as const,
      docId: pullRequestDocId(REPOSITORY_ID, prNumber),
      repositoryId: REPOSITORY_ID,
      baseBranch: BRANCH,
      seqEpoch: 1,
      sequenceSpace: SPACE,
      expectedSha: row.commit_sha,
      mergeSeq: row.merge_seq,
    })),
  );
  expect(items).toHaveLength(ROWS.length);
  const result = await projectSequenceToDocuments(es, items, SERVING_ONLY);
  expect(result.served['prs-pull-requests']?.counts).toMatchObject({ updated: ROWS.length, document_missing: 0, guard_rejected: 0 });
  await es.indices.refresh({ index: 'prs-pull-requests' });
}

beforeAll(async () => {
  pool = await migratedPool();
  redis = createTestRedis();
  es = createEsClient(resolveClientOptions());
  // 별칭을 옮기는 파괴적 시험이다 — 격리 표식이 없는 클러스터에서는 시작하지 않는다 (CR-113, DEV-737).
  const info = await es.info();
  if (!/isolated|test|ci/i.test(String(info.cluster_name)) && process.env['CI'] !== 'true') {
    throw new Error(`격리되지 않은 Elasticsearch(${String(info.cluster_name)})에서는 이 시험을 돌리지 않는다`);
  }
  await applyMappings(es);
  await switchAliasesForTests(es);

  await pool.query('DELETE FROM merge_sequence WHERE repository_id = $1', [REPOSITORY_ID]);
  await pool.query('DELETE FROM sequence_space WHERE repository_id = $1', [REPOSITORY_ID]);
  await pool.query('DELETE FROM pull_request_snapshot WHERE repository_id = $1', [REPOSITORY_ID]);
  await pool.query('DELETE FROM repository WHERE repository_id = $1', [REPOSITORY_ID]);
  await pool.query('DELETE FROM permission_cache WHERE user_id = $1', [USER]);
  await pool.query('DELETE FROM app_user WHERE user_id = $1', [USER]);

  await authRepo.upsertUserOnLogin(pool, { user_id: USER, login: 'seq-recovery-kim', github_user_id: 75_113 });
  await repositoryRepo.upsertRepository(pool, {
    repository_id: REPOSITORY_ID,
    owner: 'cr113recover',
    name: 'payments',
    org_id: ORG,
    visibility: 'internal',
    sequence_branches: [BRANCH],
  });
  // 정본: 시퀀스 공간·서수·스냅숏. 색인은 이것을 비춘 것일 뿐이다.
  await sequenceSpaceRepo.ensureSequenceSpace(pool, REPOSITORY_ID, BRANCH);
  for (const row of ROWS) {
    await mergeSequenceRepo.upsertMergeSequence(pool, {
      repository_id: REPOSITORY_ID,
      base_branch: BRANCH,
      seq_epoch: 1,
      merge_seq: row.seq,
      commit_sha: shaOf(row.seq),
      pull_request_number: null, // 채번 시점에 PR을 몰랐던 모양 — 스냅숏이 대응을 말한다.
      committed_at: new Date(row.mergedAt),
    });
    await prSnapshotRepo.upsertPullRequestSnapshot(pool, { repositoryId: REPOSITORY_ID, prNumber: row.pr, documentVersion: 1, source: 'webhook', document: prDocument(row) });
  }
  await sequenceSpaceRepo.advanceHead(pool, REPOSITORY_ID, BRANCH, shaOf(5), 5);

  const redisPort: AuthRedis = {
    get: (key) => redis.get(key),
    set: (key, value, mode, seconds) => redis.set(key, value, mode, seconds),
    del: (...keys) => redis.del(...keys),
    scan: (cursor, m, pattern, c, n) => redis.scan(cursor, m, pattern, c, n),
  };
  sessions = new SessionStore({ redis: redisPort });
  const source: AccessScopeSource = {
    fetch: async () => ({ repositoryIds: [REPOSITORY_ID], orgIds: [ORG], teamIds: [530], visibilities: ['public', 'internal'] }),
  };
  const auth: AuthContext = {
    sessions,
    scopes: new AccessScopeResolver({ redis: redisPort, db: createScopeDatabase(pool), source }),
    forget: async (ids) => {
      if (ids.length > 0) await redis.del(...ids.map(scopeKey));
    },
  };
  app = buildServer({
    config: { port: 0, adminTokens: [], metricsQueryUrl: null, gheBaseUrl: null, auth: AUTH_CONFIG, searchCursorKey: TEST_CURSOR_KEY },
    auth,
    search: { pool, es, cursorSigner: TEST_CURSOR_SIGNER, resolveNames: async () => ({ orgIds: new Map(), teamIds: new Map() }) },
  });
  await app.ready();
}, 180_000);

afterAll(async () => {
  await app?.close();
  await es?.deleteByQuery({ index: ['prs-pull-requests'], query: { term: { repository_id: REPOSITORY_ID } }, refresh: true, conflicts: 'proceed' });
  await es?.close();
  await pool?.query('DELETE FROM merge_sequence WHERE repository_id = $1', [REPOSITORY_ID]);
  await pool?.query('DELETE FROM sequence_space WHERE repository_id = $1', [REPOSITORY_ID]);
  await pool?.query('DELETE FROM pull_request_snapshot WHERE repository_id = $1', [REPOSITORY_ID]);
  await pool?.query('DELETE FROM repository WHERE repository_id = $1', [REPOSITORY_ID]);
  await pool?.query('DELETE FROM permission_cache WHERE user_id = $1', [USER]);
  await pool?.query('DELETE FROM app_user WHERE user_id = $1', [USER]);
  await redis?.quit();
  await pool?.end();
});

beforeEach(async () => {
  await seedIndexWithoutSequence();
  await redis.del(scopeKey(USER));
  sessionId = createSessionId();
  const now = Date.now();
  await sessions.create({ sessionId, userId: USER, login: 'seq-recovery-kim', email: null, roles: ['developer'], issuedAt: now, lastSeenAt: now, correlationId: null });
});

const BY_SEQ_DESC = [...ROWS].sort((a, b) => b.seq - a.seq).map((row) => row.pr); // [307, 302, 309, 301, 305]
const BY_MERGED_AT_DESC = [...ROWS].sort((a, b) => b.mergedAt.localeCompare(a.mergedAt)).map((row) => row.pr); // [301, 302, 305, 307, 309]

describe('재현 — 서수를 잃은 색인', () => {
  it('**M number 정렬이 정본 순서와 다르다** — 모든 항목이 서수 없음으로 밀려 순서를 잃는다', async () => {
    const { status, body } = await get(`q=${encodeURIComponent(QUERY)}&sort=merge_seq&order=desc`);
    expect(status).toBe(200);
    expect(body.total?.value).toBe(ROWS.length);
    expect((body.items ?? []).every((one) => one.merge_seq === null)).toBe(true);
    expect(prNumbers(body)).not.toEqual(BY_SEQ_DESC);
  });

  it('**`seq:` 범위 조회가 아무것도 찾지 못한다**', async () => {
    const { status, body } = await get(`q=${encodeURIComponent(`${QUERY} seq:2..4`)}`);
    expect(status).toBe(200);
    expect(body.total?.value).toBe(0);
  });
});

describe('복구 뒤 새 검색 요청 (FR-SEQ-001 AC-7)', () => {
  it('**원시 필드가 정본과 같고, M number 정렬이 서수 순서다** — merged_at 정렬과는 다르다', async () => {
    await reprojectFromCanonical();

    // 색인의 원시 필드를 직접 본다.
    const observed = await readSequenceProjection(
      es,
      'prs-pull-requests',
      ROWS.map((row) => ({ kind: 'pull_request' as const, docId: pullRequestDocId(REPOSITORY_ID, row.pr), repositoryId: REPOSITORY_ID })),
    );
    for (const row of ROWS) {
      expect(observed.get(pullRequestDocId(REPOSITORY_ID, row.pr))).toMatchObject({ merge_seq: row.seq, seq_epoch: 1, sequence_space: SPACE, base_branch: BRANCH });
    }

    const desc = await get(`q=${encodeURIComponent(QUERY)}&sort=merge_seq&order=desc`);
    expect(prNumbers(desc.body)).toEqual(BY_SEQ_DESC);
    expect((desc.body.items ?? []).map((one) => one.merge_seq)).toEqual([5, 4, 3, 2, 1]);
    // 서수 순서는 merged_at 순서와 다르다 — 그것이 fixture의 뜻이고, 판정 기준은 서수다.
    expect(BY_SEQ_DESC).not.toEqual(BY_MERGED_AT_DESC);
    const byMergedAt = await get(`q=${encodeURIComponent(QUERY)}&sort=merged_at&order=desc`);
    expect(prNumbers(byMergedAt.body)).toEqual(BY_MERGED_AT_DESC);

    const asc = await get(`q=${encodeURIComponent(QUERY)}&sort=merge_seq&order=asc`);
    expect(prNumbers(asc.body)).toEqual([...BY_SEQ_DESC].reverse());
  });

  it('**`seq:` 범위 조회가 정본 구간을 서수 순으로 돌려준다**', async () => {
    await reprojectFromCanonical();
    const { status, body } = await get(`q=${encodeURIComponent(`${QUERY} seq:2..4`)}&sort=merge_seq&order=asc`);
    expect(status).toBe(200);
    expect(body.total?.value).toBe(3);
    expect(prNumbers(body)).toEqual([301, 309, 302]);
    expect((body.items ?? []).map((one) => one.merge_seq)).toEqual([2, 3, 4]);
  });

  it('**cursor 전체 순회가 정본 순서로 빠짐없이 이어진다**', async () => {
    await reprojectFromCanonical();
    const collected: number[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 10; page += 1) {
      const { status, body } = await get(`q=${encodeURIComponent(QUERY)}&sort=merge_seq&order=desc&size=2${cursor === null ? '' : `&cursor=${encodeURIComponent(cursor)}`}`);
      expect(status).toBe(200);
      expect(body.total?.value).toBe(ROWS.length);
      collected.push(...prNumbers(body));
      cursor = body.next_cursor ?? null;
      if (cursor === null) break;
    }
    expect(collected).toEqual(BY_SEQ_DESC);
  });

  it('**복구 전에 연 cursor는 이전 스냅숏을 유지한다** — 복구 검증은 새 요청으로 한다', async () => {
    const before = await get(`q=${encodeURIComponent(QUERY)}&sort=merge_seq&order=desc&size=2`);
    expect(before.status).toBe(200);
    const stale = before.body.next_cursor;
    expect(stale).toBeTruthy();

    await reprojectFromCanonical();

    // 옛 cursor는 PIT 스냅숏 위에서 이어진다 — 오류가 아니고, 복구 결과도 아니다.
    const continued = await get(`q=${encodeURIComponent(QUERY)}&sort=merge_seq&order=desc&size=2&cursor=${encodeURIComponent(stale ?? '')}`);
    expect(continued.status).toBe(200);
    expect((continued.body.items ?? []).every((one) => one.merge_seq === null)).toBe(true);

    // 새 요청은 복구된 순서를 본다.
    const fresh = await get(`q=${encodeURIComponent(QUERY)}&sort=merge_seq&order=desc`);
    expect(prNumbers(fresh.body)).toEqual(BY_SEQ_DESC);
  });
});
