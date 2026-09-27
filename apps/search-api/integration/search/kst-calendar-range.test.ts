/**
 * KST 달력 날짜 범위 — 실제 Fastify + Elasticsearch + PostgreSQL + Redis (CR-127, WP-108).
 *
 * 화면은 시각을 한국 시간(Asia/Seoul)으로 보인다. 그러면 **화면에서 9월 27일로 보이는
 * 항목은 한국 시간 9월 27일을 검색했을 때 나와야 한다.** 이 파일은 그 한 문장을 세 경로
 * (검색 목록·통계 시계열·내보내기, 저장된 검색)에서 실제 인덱스로 확인한다.
 *
 * - `merged:<날짜>..<날짜>@Asia/Seoul`은 [시작일 00:00 KST, 종료일 다음 날 00:00 KST)다
 *   (FR-SRCH-005 AC-11). 종료일을 23:59:59로 만들거나 1ms를 빼서 흉내 내지 않는다.
 * - 시간대가 없는 옛 `merged:<날짜>..<날짜>`는 **그대로 UTC 날짜다** — 저장된 검색과 공유
 *   URL의 뜻을 조용히 바꾸지 않는다.
 * - 통계 시계열의 날짜만 적은 기간은 요청 시간대의 달력 날짜다 (FR-STAT-002 AC-7). 버킷과
 *   모집단이 같은 기준을 써야 버킷 하나를 누른 결과가 버킷 수와 같다.
 *
 * 경계 문서는 KST 자정의 바로 앞과 바로 뒤(UTC 15:00 전후)에 놓는다. 하루 검색, 월말·연말,
 * 윤년을 같은 규칙으로 본다.
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
import { authRepo, repositoryRepo, type Pool } from '@prs/db';
import type { Redis } from '@prs/bus';
import { buildServer } from '../../src/server.js';
import { SEARCH_PATH } from '../../src/search/routes.js';
import { ANALYTICS_BASE } from '../../src/analytics/routes.js';
import { SAVED_SEARCHES_PATH } from '../../src/saved-search/routes.js';
import type { AuthContext, AuthRedis } from '../../src/auth/context.js';
import { createTestRedis, migratedPool } from '../helpers.js';
import { TEST_CURSOR_KEY, TEST_CURSOR_SIGNER } from '../_cursor-fixture.js';

const AUTH_CONFIG = {
  enabled: true,
  cookieSecure: true,
  loginPath: '/auth/login',
  groupRoleMap: new Map<string, never>(),
} as const;

const USER = 'sub-kst-calendar';
const REPO_ID = 127_001;
const REPO = 'acme/kst';
const ORG = 1;
const SCOPE = `repo:${REPO}`;

/**
 * 경계 문서. 이름 뒤의 주석이 **한국 시간**이다.
 *
 * `created_at`은 `created:` 시험의 두 문서만 뜻이 있고 나머지는 2024-01-01로 둔다.
 */
const MERGED: readonly (readonly [id: string, mergedAt: string])[] = [
  ['l1', '2024-02-28T14:59:59Z'], // 2024-02-28 23:59:59
  ['l2', '2024-02-28T15:00:00Z'], // 2024-02-29 00:00:00 (윤일 시작)
  ['l3', '2024-02-29T14:59:59Z'], // 2024-02-29 23:59:59
  ['l4', '2024-02-29T15:00:00Z'], // 2024-03-01 00:00:00
  ['y1', '2025-12-31T14:59:59Z'], // 2025-12-31 23:59:59
  ['y2', '2025-12-31T15:00:00Z'], // 2026-01-01 00:00:00 (연초)
  ['m1', '2026-08-31T14:59:59Z'], // 2026-08-31 23:59:59
  ['m2', '2026-08-31T15:00:00Z'], // 2026-09-01 00:00:00 (월초)
  ['e1', '2026-09-25T20:00:00Z'], // 2026-09-26 05:00 — UTC로는 9/25
  ['k1', '2026-09-26T14:59:59.999Z'], // 2026-09-26 23:59:59.999
  ['k2', '2026-09-26T15:00:00Z'], // 2026-09-27 00:00:00
  ['k3', '2026-09-27T03:00:00Z'], // 2026-09-27 12:00
  ['k4', '2026-09-27T14:59:59.999Z'], // 2026-09-27 23:59:59.999
  ['k5', '2026-09-27T15:00:00Z'], // 2026-09-28 00:00:00
  ['k6', '2026-09-27T23:59:59Z'], // 2026-09-28 08:59:59 — UTC로는 9/27
  ['e2', '2026-09-28T18:00:00Z'], // 2026-09-29 03:00 — UTC로는 9/28
  ['m3', '2026-09-30T14:59:59Z'], // 2026-09-30 23:59:59 (월말)
  ['m4', '2026-09-30T15:00:00Z'], // 2026-10-01 00:00:00
];

const CREATED_ONLY: readonly (readonly [id: string, createdAt: string])[] = [
  ['c1', '2026-09-26T14:59:59Z'], // 2026-09-26 23:59:59
  ['c2', '2026-09-26T15:00:00Z'], // 2026-09-27 00:00:00
];

let pool: Pool;
let redis: Redis;
let es: Client;
let app: FastifyInstance;
let sessionId: string;

interface SearchBody {
  readonly total: { value: number; relation: string };
  readonly items: { pr_number?: number; merged_at?: string | null }[];
  readonly next_cursor: string | null;
  readonly parsed: { filters: readonly Record<string, unknown>[] };
  readonly error?: { code: string; message: string; detail?: Record<string, unknown> };
}

const NUMBER_OF = new Map<string, number>([...MERGED, ...CREATED_ONLY].map(([id], index) => [id, index + 1]));
const ID_OF = new Map<number, string>([...NUMBER_OF].map(([id, n]) => [n, id]));

async function search(q: string, extra: Record<string, string> = {}): Promise<{ status: number; body: SearchBody }> {
  const params = new URLSearchParams({ q, sort: 'merged_at', order: 'asc', size: '100', ...extra });
  const response = await app.inject({
    method: 'GET',
    url: `${SEARCH_PATH}?${params.toString()}`,
    headers: { cookie: `${SESSION_COOKIE_NAME}=${sessionId}` },
  });
  return { status: response.statusCode, body: response.json<SearchBody>() };
}

async function post<T>(url: string, body: unknown): Promise<{ status: number; body: T; raw: string }> {
  const response = await app.inject({
    method: 'POST',
    url,
    headers: { cookie: `${SESSION_COOKIE_NAME}=${sessionId}`, 'content-type': 'application/json' },
    payload: JSON.stringify(body),
  });
  const raw = response.body;
  let parsed: T;
  try {
    parsed = JSON.parse(raw) as T;
  } catch {
    parsed = raw as unknown as T;
  }
  return { status: response.statusCode, body: parsed, raw };
}

/** 결과를 픽스처 이름으로 줄인다. 정렬은 `merged_at` 오름차순이다. */
function idsOf(body: SearchBody): string[] {
  return body.items.map((item) => ID_OF.get(item.pr_number ?? 0) ?? `?${String(item.pr_number)}`);
}

async function idsFor(q: string): Promise<string[]> {
  const { status, body } = await search(q);
  expect(status, JSON.stringify(body.error)).toBe(200);
  return idsOf(body);
}

beforeAll(async () => {
  pool = await migratedPool();
  redis = createTestRedis();
  es = createEsClient(resolveClientOptions());
  await applyMappings(es);
  await switchAliasesForTests(es);

  await authRepo.upsertUserOnLogin(pool, { user_id: USER, login: 'kst-reader', github_user_id: 127_001 });
  await repositoryRepo.upsertRepository(pool, {
    repository_id: REPO_ID, owner: 'acme', name: 'kst', org_id: ORG,
    visibility: 'internal', sequence_branches: ['main'],
  });

  await es.deleteByQuery({
    index: ['prs-pull-requests', 'prs-commits'],
    query: { term: { repository_id: REPO_ID } },
    refresh: true,
    conflicts: 'proceed',
  });

  const base = {
    repository_id: REPO_ID, repository: REPO, org_id: ORG, visibility: 'internal',
    allowed_team_ids: [], author: 'kim', base_branch: 'main', document_version: 1,
  };
  const docs = [
    ...MERGED.map(([id, mergedAt]) => ({
      ...base, doc_id: `kst-${id}`, pr_number: NUMBER_OF.get(id), title: `merged ${id}`, state: 'merged',
      merged_at: mergedAt, created_at: '2024-01-01T00:00:00Z', updated_at: mergedAt,
    })),
    ...CREATED_ONLY.map(([id, createdAt]) => ({
      ...base, doc_id: `kst-${id}`, pr_number: NUMBER_OF.get(id), title: `open ${id}`, state: 'open',
      created_at: createdAt, updated_at: createdAt,
    })),
  ];
  const bulk = await es.bulk({
    refresh: true,
    operations: docs.flatMap((doc) => [{ index: { _index: 'prs-pull-requests', _id: doc.doc_id } }, doc]),
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
    fetch: async () => ({ repositoryIds: [REPO_ID], orgIds: [ORG], teamIds: [], visibilities: ['public', 'internal'] }),
  };
  const auth: AuthContext = {
    sessions: new SessionStore({ redis: redisPort }),
    scopes: new AccessScopeResolver({ redis: redisPort, db: createScopeDatabase(pool), source }),
    forget: async (ids) => {
      if (ids.length > 0) await redis.del(...ids.map(scopeKey));
    },
  };

  app = buildServer({
    config: { port: 0, adminTokens: [], metricsQueryUrl: null, gheBaseUrl: null, auth: AUTH_CONFIG, searchCursorKey: TEST_CURSOR_KEY },
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
    savedSearch: { pool, cursorSigner: TEST_CURSOR_SIGNER },
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
    sessionId, userId: USER, login: 'kst-reader', email: null,
    roles: ['developer'], issuedAt: now, lastSeenAt: now, correlationId: null,
  });
});

afterAll(async () => {
  await app?.close();
  // 자기 픽스처를 남기지 않는다 — 저장소 전체를 다시 세는 시험이 이 문서를 세면 안 된다.
  await es?.deleteByQuery({
    index: ['prs-pull-requests', 'prs-commits'],
    query: { term: { repository_id: REPO_ID } },
    refresh: true,
    conflicts: 'proceed',
  });
  await pool?.query('DELETE FROM saved_search WHERE owner_user_id = $1', [USER]);
  await es?.close();
  await redis?.quit();
  await pool?.end();
});

describe('KST 달력 날짜 범위는 시작일 00:00 이상, 종료일 다음 날 00:00 미만이다 (FR-SRCH-005 AC-11)', () => {
  it('하루 검색: 자정 직전은 빠지고 자정부터 들어가며, 종료일의 마지막 순간은 들어가고 다음 날 자정은 빠진다', async () => {
    expect(await idsFor(`${SCOPE} merged:2026-09-27..2026-09-27@Asia/Seoul`)).toEqual(['k2', 'k3', 'k4']);
  });

  it('응답의 parsed가 시간대를 싣는다 — 화면 칩과 저장 검색이 같은 조건을 다시 만든다', async () => {
    const { status, body } = await search(`${SCOPE} merged:2026-09-27..2026-09-27@Asia/Seoul`);
    expect(status).toBe(200);
    expect(body.parsed.filters).toContainEqual({
      key: 'merged', op: 'range', from: '2026-09-27', to: '2026-09-27', timezone: 'Asia/Seoul',
    });
  });

  it('여러 날 범위는 양끝 날짜를 모두 포함한다', async () => {
    expect(await idsFor(`${SCOPE} merged:2026-09-26..2026-09-28@Asia/Seoul`)).toEqual(['e1', 'k1', 'k2', 'k3', 'k4', 'k5', 'k6']);
  });

  it('월초·월말: 9월 한 달은 8/31 23:59:59 KST를 빼고 9/30 23:59:59 KST까지 넣는다', async () => {
    expect(await idsFor(`${SCOPE} merged:2026-09-01..2026-09-30@Asia/Seoul`)).toEqual([
      'm2', 'e1', 'k1', 'k2', 'k3', 'k4', 'k5', 'k6', 'e2', 'm3',
    ]);
  });

  it('연말·연초: 12/31과 1/1이 KST 자정에서 갈린다', async () => {
    expect(await idsFor(`${SCOPE} merged:2025-12-31..2025-12-31@Asia/Seoul`)).toEqual(['y1']);
    expect(await idsFor(`${SCOPE} merged:2026-01-01..2026-01-01@Asia/Seoul`)).toEqual(['y2']);
  });

  it('윤년: 2024-02-29 KST 하루', async () => {
    expect(await idsFor(`${SCOPE} merged:2024-02-29..2024-02-29@Asia/Seoul`)).toEqual(['l2', 'l3']);
  });

  it('부정 범위는 같은 반열림 구간을 뺀다', async () => {
    expect(
      await idsFor(`${SCOPE} merged:2026-09-26..2026-09-28@Asia/Seoul -merged:2026-09-27..2026-09-27@Asia/Seoul`),
    ).toEqual(['e1', 'k1', 'k5', 'k6']);
  });

  it('`created:`도 같은 규칙이다', async () => {
    const { status, body } = await search(`${SCOPE} created:2026-09-27..2026-09-27@Asia/Seoul`, { sort: 'created_at' });
    expect(status).toBe(200);
    expect(idsOf(body)).toEqual(['c2']);
  });

  it('시간대 이름의 대소문자는 정규화한다 — 같은 조건이다', async () => {
    const { status, body } = await search(`${SCOPE} merged:2026-09-27..2026-09-27@asia/seoul`);
    expect(status).toBe(200);
    expect(idsOf(body)).toEqual(['k2', 'k3', 'k4']);
    expect(body.parsed.filters).toContainEqual(expect.objectContaining({ key: 'merged', timezone: 'Asia/Seoul' }));
  });

  it('`@UTC`는 UTC 날짜 하루다', async () => {
    expect(await idsFor(`${SCOPE} merged:2026-09-27..2026-09-27@UTC`)).toEqual(['k3', 'k4', 'k5', 'k6']);
  });
});

describe('시간대가 없는 옛 날짜 범위는 뜻이 바뀌지 않는다 (CR-127 기존 조건 보존)', () => {
  it('`merged:2026-09-27..2026-09-27`은 그대로 UTC 9/27 하루다', async () => {
    expect(await idsFor(`${SCOPE} merged:2026-09-27..2026-09-27`)).toEqual(['k3', 'k4', 'k5', 'k6']);
  });

  it('시각과 오프셋을 적은 옛 범위도 그대로다 — 이미 Z나 +09:00이 있는 시점은 다시 보정하지 않는다', async () => {
    expect(await idsFor(`${SCOPE} merged:2026-09-27T00:00:00+09:00..2026-09-27T12:00:00+09:00`)).toEqual(['k2', 'k3']);
    expect(await idsFor(`${SCOPE} merged:2026-09-26T15:00:00Z..2026-09-27T03:00:00Z`)).toEqual(['k2', 'k3']);
  });
});

describe('잘못된 달력 범위는 검색하지 않고 거절한다', () => {
  it.each([
    ['없는 날짜', `${SCOPE} merged:2025-02-29..2025-02-29@Asia/Seoul`],
    ['역전된 날짜', `${SCOPE} merged:2026-09-28..2026-09-27@Asia/Seoul`],
    ['시각과 시간대를 함께', `${SCOPE} merged:2026-09-27T00:00..2026-09-27T23:59@Asia/Seoul`],
    ['오프셋과 시간대를 함께', `${SCOPE} merged:2026-09-27T00:00+09:00..2026-09-28T00:00+09:00@Asia/Seoul`],
    ['모르는 시간대', `${SCOPE} merged:2026-09-27..2026-09-27@Mars/Olympus`],
    ['빈 시간대', `${SCOPE} merged:2026-09-27..2026-09-27@`],
    ['한쪽 끝이 없음', `${SCOPE} merged:2026-09-27..@Asia/Seoul`],
  ])('%s → 400 QUERY_SYNTAX_ERROR', async (_label, q) => {
    const { status, body } = await search(q);
    expect(status).toBe(400);
    expect(body.error?.code).toBe('QUERY_SYNTAX_ERROR');
  });
});

describe('커서는 시간대와 범위 의미를 봉인한다 (FR-SRCH-008 AC-3)', () => {
  it('한 건씩 끝까지 읽어도 빠지거나 겹치지 않는다', async () => {
    const q = `${SCOPE} merged:2026-09-26..2026-09-28@Asia/Seoul`;
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 20; page++) {
      const { status, body } = await search(q, { size: '1', ...(cursor === null ? {} : { cursor }) });
      expect(status).toBe(200);
      seen.push(...idsOf(body));
      cursor = body.next_cursor;
      if (cursor === null) break;
    }
    expect(seen).toEqual(['e1', 'k1', 'k2', 'k3', 'k4', 'k5', 'k6']);
  });

  it('같은 날짜라도 시간대가 다르면 이어 읽지 않는다 (cursor_query_mismatch)', async () => {
    const first = await search(`${SCOPE} merged:2026-09-27..2026-09-27@Asia/Seoul`, { size: '1' });
    expect(first.status).toBe(200);
    const cursor = first.body.next_cursor;
    expect(cursor).not.toBeNull();
    const legacy = await search(`${SCOPE} merged:2026-09-27..2026-09-27`, { size: '1', cursor: cursor ?? '' });
    expect(legacy.status).toBe(400);
    expect(legacy.body.error?.code).toBe('CURSOR_QUERY_MISMATCH');
  });
});

interface TimeSeriesBody {
  readonly timezone: string;
  readonly applied_range: { from: string; to: string };
  readonly total: { value: number };
  readonly buckets: readonly string[];
  readonly series: readonly { key: string; values: readonly number[] }[];
  readonly error?: { code: string; detail?: Record<string, unknown> };
}

/** 버킷 키(요청 시간대로 그린 ISO)에서 그 지역의 날짜를 읽는다. */
function bucketDate(key: string): string {
  return key.slice(0, 10);
}

async function timeSeries(body: Record<string, unknown>): Promise<{ status: number; body: TimeSeriesBody }> {
  const { status, body: parsed } = await post<TimeSeriesBody>(`${ANALYTICS_BASE}/time-series`, { query: SCOPE, ...body });
  return { status, body: parsed };
}

describe('통계 시계열의 날짜만 적은 기간은 요청 시간대의 달력 날짜다 (FR-STAT-002 AC-7)', () => {
  it('기본 시간대(Asia/Seoul): 버킷은 요청한 사흘뿐이고, 버킷마다 같은 KST 하루 검색과 건수가 같다', async () => {
    const { status, body } = await timeSeries({ from: '2026-09-26', to: '2026-09-28', interval: 'day' });
    expect(status, JSON.stringify(body.error)).toBe(200);
    expect(body.timezone).toBe('Asia/Seoul');
    expect(body.applied_range).toEqual({ from: '2026-09-26', to: '2026-09-28' });
    expect(body.buckets.map(bucketDate)).toEqual(['2026-09-26', '2026-09-27', '2026-09-28']);
    const values = body.series[0]?.values ?? [];
    expect(values).toEqual([2, 3, 2]);
    for (const [index, key] of body.buckets.entries()) {
      const day = bucketDate(key);
      const listed = await search(`${SCOPE} merged:${day}..${day}@Asia/Seoul`);
      expect(listed.body.total.value, `${day} 버킷과 검색`).toBe(values[index]);
    }
    const whole = await search(`${SCOPE} merged:2026-09-26..2026-09-28@Asia/Seoul`);
    expect(body.total.value).toBe(whole.body.total.value);
  });

  it('월 버킷: 9월 버킷은 9월 한 달 검색과 건수가 같다', async () => {
    const { status, body } = await timeSeries({ from: '2026-08-01', to: '2026-10-31', interval: 'month' });
    expect(status, JSON.stringify(body.error)).toBe(200);
    expect(body.buckets.map(bucketDate)).toEqual(['2026-08-01', '2026-09-01', '2026-10-01']);
    const values = body.series[0]?.values ?? [];
    const september = await search(`${SCOPE} merged:2026-09-01..2026-09-30@Asia/Seoul`);
    expect(values[1]).toBe(september.body.total.value);
    expect(values).toEqual([1, 10, 1]);
  });

  it('`timezone=UTC`는 UTC 날짜로 나누고 UTC 날짜로 거른다 — 옛 UTC 날짜 검색과 같다', async () => {
    const { status, body } = await timeSeries({ from: '2026-09-27', to: '2026-09-27', interval: 'day', timezone: 'UTC' });
    expect(status, JSON.stringify(body.error)).toBe(200);
    expect(body.buckets.map(bucketDate)).toEqual(['2026-09-27']);
    const legacy = await search(`${SCOPE} merged:2026-09-27..2026-09-27`);
    expect(body.series[0]?.values).toEqual([legacy.body.total.value]);
  });

  it('시각을 적은 기간(API 직접 호출)은 기존 뜻 그대로다 — 양끝 순간을 포함한다', async () => {
    const { status, body } = await timeSeries({ from: '2026-09-26T15:00:00Z', to: '2026-09-27T14:59:59.999Z', interval: 'day' });
    expect(status, JSON.stringify(body.error)).toBe(200);
    expect(body.total.value).toBe(3);
  });

  it('기간을 주지 않으면 요청 시간대의 오늘을 포함한 30일이다 — 적용 기간을 날짜로 알린다', async () => {
    const { status, body } = await timeSeries({ interval: 'day' });
    expect(status, JSON.stringify(body.error)).toBe(200);
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    expect(body.applied_range.to).toBe(today);
    expect(body.buckets).toHaveLength(30);
    expect(bucketDate(body.buckets[29] ?? '')).toBe(today);
    expect(bucketDate(body.buckets[0] ?? '')).toBe(body.applied_range.from);
  });

  it('없는 시간대는 400이다 — 검색 클러스터를 부르지 않는다', async () => {
    const { status, body } = await timeSeries({ from: '2026-09-27', to: '2026-09-27', timezone: 'Mars/Olympus' });
    expect(status).toBe(400);
    expect(body.error?.code).toBe('INVALID_PARAMETER');
    expect(body.error?.detail?.['field']).toBe('timezone');
  });

  it('없는 날짜와 역전된 기간은 400이다', async () => {
    const missing = await timeSeries({ from: '2025-02-29', to: '2025-03-01' });
    expect(missing.status).toBe(400);
    const reversed = await timeSeries({ from: '2026-09-28', to: '2026-09-27' });
    expect(reversed.status).toBe(400);
  });
});

describe('내보내기와 저장된 검색은 같은 조건을 쓴다', () => {
  it('내보내기 건수와 내용이 검색과 같고, 시각은 UTC 원본 그대로다', async () => {
    const q = `${SCOPE} merged:2026-09-27..2026-09-27@Asia/Seoul`;
    const preview = await post<{ total: number }>('/api/v1/exports', { q, format: 'json', preview: true });
    expect(preview.status).toBe(200);
    expect(preview.body.total).toBe(3);
    const exported = await post<unknown>('/api/v1/exports', { q, format: 'json', sort: 'merged_at', order: 'asc' });
    expect(exported.status).toBe(200);
    const rows = (Array.isArray(exported.body) ? exported.body : (exported.body as { items?: unknown[] }).items ?? []) as { merged_at?: string }[];
    expect(rows.map((row) => row.merged_at)).toEqual(['2026-09-26T15:00:00Z', '2026-09-27T03:00:00Z', '2026-09-27T14:59:59.999Z']);
  });

  it('저장된 검색은 시간대를 담은 질의를 그대로 저장하고 같은 질의로 이동한다', async () => {
    const query = `${SCOPE} merged:2026-09-27..2026-09-27@Asia/Seoul`;
    const created = await post<{ saved_search_id: number; query: string }>(SAVED_SEARCHES_PATH, { name: 'KST 9/27', query, visibility: 'private' });
    expect(created.status).toBe(201);
    expect(created.body.query).toBe(query);
    const run = await post<{ navigation_url: string }>(`${SAVED_SEARCHES_PATH}/${String(created.body.saved_search_id)}/run`, {});
    expect(run.status).toBe(200);
    const navigated = new URL(run.body.navigation_url, 'http://prs.test').searchParams.get('q') ?? '';
    expect(navigated).toBe(query);
    expect(await idsFor(navigated)).toEqual(['k2', 'k3', 'k4']);
  });

  it('시간대 없는 옛 저장 검색은 고치지 않고 UTC 날짜 그대로 실행한다', async () => {
    const query = `${SCOPE} merged:2026-09-27..2026-09-27`;
    const created = await post<{ saved_search_id: number; query: string }>(SAVED_SEARCHES_PATH, { name: 'UTC 9/27', query, visibility: 'private' });
    expect(created.status).toBe(201);
    const run = await post<{ navigation_url: string }>(`${SAVED_SEARCHES_PATH}/${String(created.body.saved_search_id)}/run`, {});
    const navigated = new URL(run.body.navigation_url, 'http://prs.test').searchParams.get('q') ?? '';
    expect(navigated).toBe(query);
    expect(await idsFor(navigated)).toEqual(['k3', 'k4', 'k5', 'k6']);
  });
});
