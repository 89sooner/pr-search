/**
 * `GET/PUT /safe-markers` — 실제 PostgreSQL (WP-041 / API-SEQ-004, FR-SEQ-006).
 *
 * ## 무엇을 실물로 재는가
 *
 * 이 WP의 주장 셋은 전부 **데이터베이스의 성질**이라 대역으로는 증명되지
 * 않는다 — 공간당 현재 표식이 하나라는 것(`safe_marker_current_uk`), 대체가
 * 원자적이라는 것(트랜잭션), 동시 요청이 직렬화된다는 것(advisory lock).
 * 그래서 이 파일은 진짜 PostgreSQL에만 붙는다. Elasticsearch는 이 경로에
 * 닿지 않으므로 서버에 넘기지 않는다.
 *
 * ## 다른 파일의 상태를 지우지 않는다
 *
 * 전역 `DELETE`를 쓰지 않고 이 파일이 만든 저장소 ID 범위만 정리한다.
 * 통합 시험은 공유 데이터베이스에서 돌고, 전역 질의는 다른 파일이 방금
 * 세운 픽스처를 지운다 (이 저장소가 세 번 겪었다).
 *
 * 실행: `pnpm run test:integration safe-marker`
 */

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  AccessScopeResolver,
  SESSION_COOKIE_NAME,
  SessionStore,
  createScopeDatabase,
  createSessionId,
  scopeKey,
  type AccessScopeSource,
  type SessionRecord,
} from '@prs/authz';
import {
  auditRepo,
  authRepo,
  mergeSequenceRepo,
  repositoryRepo,
  safeMarkerRepo,
  sequenceSpaceRepo,
  type Pool,
} from '@prs/db';
import type { Redis } from '@prs/bus';
import { buildServer } from '../../src/server.js';
import { SAFE_MARKERS_PATH } from '../../src/sequence/routes.js';
import type { AuthContext, AuthRedis } from '../../src/auth/context.js';
import { createTestRedis, migratedPool, clearMergeSequence } from '../helpers.js';
import { TEST_CURSOR_KEY, TEST_CURSOR_SIGNER } from '../_cursor-fixture.js';

const AUTH_CONFIG = {
  enabled: true,
  cookieSecure: true,
  loginPath: '/auth/login',
  groupRoleMap: new Map<string, never>(),
} as const;

const NS = 'wp041';
const MANAGER = `${NS}-manager`;
const DEVELOPER = `${NS}-developer`;
/** 이 파일이 쓰는 저장소 ID 구간. 정리는 이 범위만 건드린다. */
const ID_FLOOR = 4100;
const ID_CEIL = 4199;
const PAYMENTS = 4101;
/** 접근 범위 밖 저장소. 등록되어 있으나 이 사용자에게 보이지 않는다. */
const SECRET = 4102;
const ORG = 41;
const BRANCH = 'main';
const SEQS = [1, 2, 3] as const;

let pool: Pool;
let redis: Redis;
let app: FastifyInstance;
let managerSession: string;
let developerSession: string;

interface MarkerView {
  readonly merge_seq: number;
  readonly seq_epoch: number;
  readonly note: string | null;
  readonly created_by: string;
  readonly created_at: string;
  readonly epoch_stale: boolean;
}

interface MarkerBody {
  readonly sequence_space?: string;
  readonly seq_epoch?: number;
  readonly outcome?: string;
  readonly marker?: MarkerView | null;
  readonly replaced_merge_seq?: number | null;
  readonly error?: { code: string; message: string; detail?: Record<string, unknown> };
  readonly correlation_id: string;
}

function shaOf(seq: number): string {
  return `${String(seq).padStart(2, '0')}${'d'.repeat(38)}`;
}

async function login(userId: string, roles: readonly string[]): Promise<string> {
  const sessionId = createSessionId();
  const now = Date.now();
  const record: SessionRecord = {
    sessionId,
    userId,
    login: userId,
    email: `${userId}@acme.example`,
    roles,
    issuedAt: now,
    lastSeenAt: now,
    correlationId: null,
  };
  await new SessionStore({ redis: redisPort() }).create(record);
  return sessionId;
}

function redisPort(): AuthRedis {
  return {
    get: (key) => redis.get(key),
    set: (key, value, mode, seconds) => redis.set(key, value, mode, seconds),
    del: (...keys) => redis.del(...keys),
    scan: (cursor, m, pattern, c, n) => redis.scan(cursor, m, pattern, c, n),
  };
}

async function read(
  session: string,
  repository = 'acme/wp041-payments',
): Promise<{ status: number; body: MarkerBody }> {
  const response = await app.inject({
    method: 'GET',
    url: `${SAFE_MARKERS_PATH}?repository=${encodeURIComponent(repository)}&base_branch=${BRANCH}`,
    headers: { cookie: `${SESSION_COOKIE_NAME}=${session}` },
  });
  return { status: response.statusCode, body: response.json<MarkerBody>() };
}

async function write(
  session: string,
  payload: Record<string, unknown>,
): Promise<{ status: number; body: MarkerBody }> {
  const response = await app.inject({
    method: 'PUT',
    url: SAFE_MARKERS_PATH,
    headers: { cookie: `${SESSION_COOKIE_NAME}=${session}`, 'content-type': 'application/json' },
    payload: { repository: 'acme/wp041-payments', base_branch: BRANCH, ...payload },
  });
  return { status: response.statusCode, body: response.json<MarkerBody>() };
}

/** 그 공간의 표식 행 전부. 이력까지 본다 — 현재만 보면 대체가 남긴 것을 못 센다. */
async function allRows(repositoryId = PAYMENTS): Promise<
  { merge_seq: number; seq_epoch: number; note: string | null; superseded_at: string | null }[]
> {
  const { rows } = await pool.query<{
    merge_seq: number;
    seq_epoch: number;
    note: string | null;
    superseded_at: string | null;
  }>(
    `SELECT merge_seq::int AS merge_seq, seq_epoch, note,
            superseded_at::text AS superseded_at
       FROM safe_marker WHERE repository_id = $1 AND base_branch = $2
      ORDER BY marker_id`,
    [repositoryId, BRANCH],
  );
  return rows;
}

async function auditRows(resultCode?: string): Promise<auditRepo.AuditRecordRow[]> {
  const filter =
    resultCode === undefined
      ? { action: 'safe_marker.set' }
      : { action: 'safe_marker.set', resultCode };
  return auditRepo.listAuditRecords(pool, filter, 50);
}

beforeAll(async () => {
  pool = await migratedPool();
  redis = createTestRedis();

  await pool.query('DELETE FROM safe_marker WHERE repository_id BETWEEN $1 AND $2', [ID_FLOOR, ID_CEIL]);
  await clearMergeSequence(pool, 'repository_id BETWEEN $1 AND $2', [ID_FLOOR, ID_CEIL]);
  await pool.query('DELETE FROM sequence_space WHERE repository_id BETWEEN $1 AND $2', [ID_FLOOR, ID_CEIL]);
  await pool.query('DELETE FROM repository WHERE repository_id BETWEEN $1 AND $2', [ID_FLOOR, ID_CEIL]);
  await pool.query('DELETE FROM audit_record WHERE user_id LIKE $1', [`${NS}%`]);

  for (const userId of [MANAGER, DEVELOPER]) {
    await authRepo.upsertUserOnLogin(pool, {
      user_id: userId,
      login: userId,
      github_user_id: userId === MANAGER ? 41_001 : 41_002,
    });
  }

  for (const [id, name] of [
    [PAYMENTS, 'wp041-payments'],
    [SECRET, 'wp041-secret'],
  ] as const) {
    await repositoryRepo.upsertRepository(pool, {
      repository_id: id,
      owner: 'acme',
      name,
      org_id: ORG,
      visibility: id === SECRET ? 'private' : 'internal',
      sequence_branches: [BRANCH],
    });
    await sequenceSpaceRepo.ensureSequenceSpace(pool, id, BRANCH);
  }

  for (const seq of SEQS) {
    await mergeSequenceRepo.upsertMergeSequence(pool, {
      repository_id: PAYMENTS,
      base_branch: BRANCH,
      seq_epoch: 1,
      merge_seq: seq,
      commit_sha: shaOf(seq),
      pull_request_number: 400 + seq,
      committed_at: new Date(`2026-08-1${String(seq)}T00:00:00Z`),
    });
  }
  await sequenceSpaceRepo.advanceHead(pool, PAYMENTS, BRANCH, shaOf(3), 3);

  /*
   * 접근 범위는 `payments`만 담는다. `secret`은 등록되어 있으나 이 범위에
   * 없으므로 **404로 감춰져야 한다** — 403이면 그 저장소의 존재가 샌다.
   */
  const source: AccessScopeSource = {
    fetch: async () => ({
      repositoryIds: [PAYMENTS],
      orgIds: [ORG],
      teamIds: [],
      visibilities: ['internal'],
    }),
  };
  const auth: AuthContext = {
    sessions: new SessionStore({ redis: redisPort() }),
    scopes: new AccessScopeResolver({ redis: redisPort(), db: createScopeDatabase(pool), source }),
    forget: async (ids) => {
      if (ids.length > 0) await redis.del(...ids.map(scopeKey));
    },
  };

  app = buildServer({
    config: {
      port: 0,
      adminTokens: [],
      metricsQueryUrl: null,
      gheBaseUrl: null,
      auth: AUTH_CONFIG,
      searchCursorKey: TEST_CURSOR_KEY,
    },
    auth,
    // Elasticsearch는 이 경로에 닿지 않는다 — 넘기지 않는 것이 그 사실의 증명이다.
    sequence: {
      pool,
      es: undefined as never,
      cursorSigner: TEST_CURSOR_SIGNER,
      resolveNames: async () => ({ orgIds: new Map(), teamIds: new Map() }),
    },
  });
  await app.ready();

  managerSession = await login(MANAGER, ['developer', 'release_manager']);
  developerSession = await login(DEVELOPER, ['developer']);
}, 180_000);

beforeEach(async () => {
  await pool.query('DELETE FROM safe_marker WHERE repository_id BETWEEN $1 AND $2', [ID_FLOOR, ID_CEIL]);
  await pool.query('DELETE FROM audit_record WHERE user_id LIKE $1', [`${NS}%`]);
  await pool.query('UPDATE sequence_space SET seq_epoch = 1 WHERE repository_id = $1', [PAYMENTS]);
});

afterAll(async () => {
  await pool.query('DELETE FROM safe_marker WHERE repository_id BETWEEN $1 AND $2', [ID_FLOOR, ID_CEIL]);
  await clearMergeSequence(pool, 'repository_id BETWEEN $1 AND $2', [ID_FLOOR, ID_CEIL]);
  await pool.query('DELETE FROM sequence_space WHERE repository_id BETWEEN $1 AND $2', [ID_FLOOR, ID_CEIL]);
  await pool.query('DELETE FROM repository WHERE repository_id BETWEEN $1 AND $2', [ID_FLOOR, ID_CEIL]);
  await pool.query('DELETE FROM audit_record WHERE user_id LIKE $1', [`${NS}%`]);
  await app?.close();
  await redis?.quit();
  await pool?.end();
});

describe('GET — 표식 조회 (FR-SEQ-006, DEV-461)', () => {
  it('표식이 없으면 404가 아니라 `marker: null`이다', async () => {
    const { status, body } = await read(managerSession);
    expect(status).toBe(200);
    expect(body.marker).toBeNull();
    expect(body.sequence_space).toBe('acme/wp041-payments@main');
    expect(body.seq_epoch).toBe(1);
  });

  it('**`release_manager`가 아닌 사용자도 읽는다** — 막히는 것은 쓰기뿐이다', async () => {
    await write(managerSession, { merge_seq: 2, seq_epoch: 1, note: '검증 완료', expected_marker_seq: null });
    const { status, body } = await read(developerSession);
    expect(status).toBe(200);
    expect(body.marker?.merge_seq).toBe(2);
  });

  it('접근 범위 밖 저장소는 404이며 미등록과 **구분되지 않는다**', async () => {
    const outside = await read(managerSession, 'acme/wp041-secret');
    const missing = await read(managerSession, 'acme/wp041-nonexistent');

    expect(outside.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(outside.body.error?.code).toBe(missing.body.error?.code);

    /*
     * 메시지는 요청한 이름을 되돌려 주므로 그 부분은 당연히 다르다. 새는지
     * 여부를 가르는 것은 **나머지 문장이 같은가**이다 — "권한이 없다"와
     * "그런 저장소가 없다"가 갈리면 비공개 저장소의 존재가 드러난다
     * (ADR-008, THR-006).
     */
    const template = (message: string | undefined, name: string): string =>
      (message ?? '').replace(name, '{repository}');
    expect(template(outside.body.error?.message, 'acme/wp041-secret')).toBe(
      template(missing.body.error?.message, 'acme/wp041-nonexistent'),
    );
  });
});

describe('PUT — 등록과 대체 (AC-1, AC-2)', () => {
  it('첫 등록이 성공하고 GET이 그것을 돌려준다', async () => {
    const put = await write(managerSession, {
      merge_seq: 2,
      seq_epoch: 1,
      note: '결제 회귀 통과',
      expected_marker_seq: null,
    });
    expect(put.status).toBe(200);
    expect(put.body.outcome).toBe('created');
    expect(put.body.replaced_merge_seq).toBeNull();

    const got = await read(managerSession);
    expect(got.body.marker).toMatchObject({
      merge_seq: 2,
      seq_epoch: 1,
      note: '결제 회귀 통과',
      created_by: MANAGER,
      epoch_stale: false,
    });
  });

  it('**등록자와 시각을 요청이 지정할 수 없다**', async () => {
    const put = await write(managerSession, {
      merge_seq: 2,
      seq_epoch: 1,
      expected_marker_seq: null,
      created_by: 'someone-else',
      created_at: '1999-01-01T00:00:00Z',
    });
    expect(put.status).toBe(200);
    expect(put.body.marker?.created_by).toBe(MANAGER);
    expect(put.body.marker?.created_at.startsWith('1999')).toBe(false);
  });

  it('새 표식이 이전 것을 이력으로 남기고 대체한다 (AC-1)', async () => {
    await write(managerSession, { merge_seq: 1, seq_epoch: 1, expected_marker_seq: null });
    const second = await write(managerSession, { merge_seq: 3, seq_epoch: 1, expected_marker_seq: 1 });

    expect(second.body.outcome).toBe('created');
    expect(second.body.replaced_merge_seq).toBe(1);

    const rows = await allRows();
    expect(rows).toHaveLength(2);
    // 이력은 남고 현재는 하나다.
    expect(rows.filter((r) => r.superseded_at === null).map((r) => r.merge_seq)).toEqual([3]);
    expect(rows.find((r) => r.merge_seq === 1)?.superseded_at).not.toBeNull();
  });

  it('메모 500자는 통과하고 501자는 400이다 (AC-2)', async () => {
    const ok = await write(managerSession, {
      merge_seq: 1,
      seq_epoch: 1,
      note: 'ㄱ'.repeat(500),
      expected_marker_seq: null,
    });
    expect(ok.status).toBe(200);

    const tooLong = await write(managerSession, {
      merge_seq: 2,
      seq_epoch: 1,
      note: 'ㄱ'.repeat(501),
      expected_marker_seq: 1,
    });
    expect(tooLong.status).toBe(400);
    expect(tooLong.body.error?.code).toBe('INVALID_PARAMETER');
  });
});

describe('권한과 존재 (AC-3, 예외 처리)', () => {
  it('`release_manager`가 아닌 쓰기는 403이다 (AC-3)', async () => {
    const put = await write(developerSession, { merge_seq: 1, seq_epoch: 1, expected_marker_seq: null });
    expect(put.status).toBe(403);
    expect(put.body.error?.code).toBe('FORBIDDEN_ROLE');
    expect(await allRows()).toHaveLength(0);
  });

  it('**역할을 접근 범위보다 먼저 본다** — 403이 저장소의 존재를 흘리지 않는다', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: SAFE_MARKERS_PATH,
      headers: { cookie: `${SESSION_COOKIE_NAME}=${developerSession}`, 'content-type': 'application/json' },
      payload: { repository: 'acme/wp041-secret', base_branch: BRANCH, merge_seq: 1, seq_epoch: 1, expected_marker_seq: null },
    });
    /*
     * 자격 없는 사용자에게는 **범위 밖 저장소도 403**이다. 404를 주면 그
     * 사용자가 403과 404의 차이로 저장소의 존재를 탐지한다.
     */
    expect(response.statusCode).toBe(403);
  });

  it('존재하지 않는 서수는 400 `SEQUENCE_NOT_FOUND`다', async () => {
    const put = await write(managerSession, { merge_seq: 99, seq_epoch: 1, expected_marker_seq: null });
    expect(put.status).toBe(400);
    expect(put.body.error?.code).toBe('SEQUENCE_NOT_FOUND');
    expect(put.body.error?.detail).toMatchObject({ merge_seq: 99, seq_epoch: 1 });
    expect(await allRows()).toHaveLength(0);
  });

  it('`expected_marker_seq` 키가 없으면 400이다 — 확인하지 않은 요청은 통과하지 않는다', async () => {
    const put = await write(managerSession, { merge_seq: 1, seq_epoch: 1 });
    expect(put.status).toBe(400);
    expect(put.body.error?.detail).toMatchObject({ field: 'expected_marker_seq' });
    expect(await allRows()).toHaveLength(0);
  });
});

describe('에폭 (AC-4, FR-SEQ-005 AC-4)', () => {
  it('저장된 표식의 에폭이 낡으면 `epoch_stale`이며 **행은 그대로다**', async () => {
    await write(managerSession, { merge_seq: 2, seq_epoch: 1, note: '옛 세대', expected_marker_seq: null });
    const before = await allRows();

    await pool.query('UPDATE sequence_space SET seq_epoch = 2 WHERE repository_id = $1', [PAYMENTS]);

    const got = await read(managerSession);
    expect(got.body.seq_epoch).toBe(2);
    expect(got.body.marker).toMatchObject({ merge_seq: 2, seq_epoch: 1, epoch_stale: true });
    // 재채번은 표식에 아무것도 쓰지 않는다 (CR-026, DEV-126).
    expect(await allRows()).toEqual(before);
  });

  it('**낡은 표식을 감추지 않는다** — 무효라는 사실 자체가 답이다', async () => {
    await write(managerSession, { merge_seq: 2, seq_epoch: 1, expected_marker_seq: null });
    await pool.query('UPDATE sequence_space SET seq_epoch = 3 WHERE repository_id = $1', [PAYMENTS]);
    const got = await read(managerSession);
    expect(got.body.marker).not.toBeNull();
  });

  it('**현재 에폭의 같은 서수로 자동 재해석하지 않는다**', async () => {
    await write(managerSession, { merge_seq: 2, seq_epoch: 1, expected_marker_seq: null });
    await pool.query('UPDATE sequence_space SET seq_epoch = 2 WHERE repository_id = $1', [PAYMENTS]);
    const got = await read(managerSession);
    // 저장된 에폭이 그대로 보인다 — 현재 값으로 갈아 끼우면 무효가 사라진다.
    expect(got.body.marker?.seq_epoch).toBe(1);
    expect(got.body.marker?.epoch_stale).toBe(true);
  });

  it('낡은 에폭으로 쓰면 409 `SEQUENCE_EPOCH_STALE`이며 저장하지 않는다', async () => {
    await pool.query('UPDATE sequence_space SET seq_epoch = 2 WHERE repository_id = $1', [PAYMENTS]);
    const put = await write(managerSession, { merge_seq: 2, seq_epoch: 1, expected_marker_seq: null });
    expect(put.status).toBe(409);
    expect(put.body.error?.code).toBe('SEQUENCE_EPOCH_STALE');
    expect(put.body.error?.detail).toMatchObject({
      reason: 'epoch_stale',
      current_seq_epoch: 2,
      requested_seq_epoch: 1,
    });
    expect(await allRows()).toHaveLength(0);
  });

  it('**5가 6보다 먼저다** — 낡은 에폭이면 서수 실재를 묻지 않는다', async () => {
    await pool.query('UPDATE sequence_space SET seq_epoch = 2 WHERE repository_id = $1', [PAYMENTS]);
    /*
     * 서수 99는 어느 에폭에도 없다. 순서가 뒤집혀 있으면 `SEQUENCE_NOT_FOUND`가
     * 나오고, 그러면 사용자가 "그 서수를 고쳐라"는 잘못된 지시를 받는다.
     */
    const put = await write(managerSession, { merge_seq: 99, seq_epoch: 1, expected_marker_seq: null });
    expect(put.body.error?.code).toBe('SEQUENCE_EPOCH_STALE');
  });
});

describe('멱등과 충돌 (DEV-464, DEV-465)', () => {
  it('같은 요청의 재시도는 `unchanged`이며 이력을 늘리지 않는다', async () => {
    const first = await write(managerSession, {
      merge_seq: 2,
      seq_epoch: 1,
      note: '검증 완료',
      expected_marker_seq: null,
    });
    expect(first.body.outcome).toBe('created');

    const retry = await write(managerSession, {
      merge_seq: 2,
      seq_epoch: 1,
      note: '검증 완료',
      expected_marker_seq: null,
    });
    expect(retry.status).toBe(200);
    expect(retry.body.outcome).toBe('unchanged');
    expect(retry.body.replaced_merge_seq).toBeNull();
    expect(await allRows()).toHaveLength(1);
  });

  it('**메모만 다르면 변경이다** — 이력이 생긴다 (DEV-465)', async () => {
    await write(managerSession, { merge_seq: 2, seq_epoch: 1, note: '오타', expected_marker_seq: null });
    const corrected = await write(managerSession, {
      merge_seq: 2,
      seq_epoch: 1,
      note: '정정한 근거',
      expected_marker_seq: 2,
    });

    expect(corrected.body.outcome).toBe('created');
    expect(corrected.body.marker?.note).toBe('정정한 근거');
    const rows = await allRows();
    expect(rows).toHaveLength(2);
    expect(rows.filter((r) => r.superseded_at === null)).toHaveLength(1);
  });

  it('요청자가 본 표식이 더 이상 현재가 아니면 409다 (DEV-464)', async () => {
    await write(managerSession, { merge_seq: 1, seq_epoch: 1, expected_marker_seq: null });
    await write(managerSession, { merge_seq: 3, seq_epoch: 1, expected_marker_seq: 1 });

    // 1을 보고 만든 요청이 뒤늦게 도착한다.
    const late = await write(managerSession, { merge_seq: 2, seq_epoch: 1, expected_marker_seq: 1 });
    expect(late.status).toBe(409);
    expect(late.body.error?.code).toBe('SAFE_MARKER_CONFLICT');
    expect(late.body.error?.detail).toMatchObject({ current_marker_seq: 3, expected_marker_seq: 1 });
    // 현재 표식은 그대로다.
    expect((await allRows()).filter((r) => r.superseded_at === null).map((r) => r.merge_seq)).toEqual([3]);
  });

  it('**응답을 잃은 재시도가 그 사이의 갱신을 되돌리지 않는다** (DEV-464의 시나리오)', async () => {
    await write(managerSession, { merge_seq: 1, seq_epoch: 1, note: 'a', expected_marker_seq: null });
    // 응답이 유실된 것으로 친다. 그 사이 다른 매니저가 경계를 올린다.
    await write(managerSession, { merge_seq: 3, seq_epoch: 1, note: 'b', expected_marker_seq: 1 });

    const retried = await write(managerSession, {
      merge_seq: 1,
      seq_epoch: 1,
      note: 'a',
      expected_marker_seq: null,
    });
    expect(retried.status).toBe(409);
    expect((await allRows()).filter((r) => r.superseded_at === null).map((r) => r.merge_seq)).toEqual([3]);
  });

  it('**7이 8보다 먼저다** — 정직한 재시도는 자기가 만든 상태로 거절되지 않는다', async () => {
    await write(managerSession, { merge_seq: 2, seq_epoch: 1, note: 'x', expected_marker_seq: null });
    /*
     * 이 재시도의 `expected_marker_seq`는 `null`이고 현재 표식은 2다 —
     * 검사 8만 있으면 409가 된다. 완전 일치(7)가 먼저이므로 `unchanged`다.
     */
    const retry = await write(managerSession, {
      merge_seq: 2,
      seq_epoch: 1,
      note: 'x',
      expected_marker_seq: null,
    });
    expect(retry.status).toBe(200);
    expect(retry.body.outcome).toBe('unchanged');
  });
});

describe('동시성 (API-SEQ-004의 「멱등과 동시성」)', () => {
  it('첫 등록이 동시에 둘 와도 유일 제약으로 둘 다 실패하지 않는다', async () => {
    const [a, b] = await Promise.all([
      write(managerSession, { merge_seq: 1, seq_epoch: 1, expected_marker_seq: null }),
      write(managerSession, { merge_seq: 3, seq_epoch: 1, expected_marker_seq: null }),
    ]);

    const statuses = [a.status, b.status].sort();
    // 하나는 성공하고 하나는 충돌이다. 500이 섞이면 제약이 그대로 튄 것이다.
    expect(statuses).toEqual([200, 409]);
    expect((await allRows()).filter((r) => r.superseded_at === null)).toHaveLength(1);
  });

  it('동시 대체에서도 현재 표식이 둘이 되지 않는다', async () => {
    await write(managerSession, { merge_seq: 1, seq_epoch: 1, expected_marker_seq: null });
    const [a, b] = await Promise.all([
      write(managerSession, { merge_seq: 2, seq_epoch: 1, expected_marker_seq: 1 }),
      write(managerSession, { merge_seq: 3, seq_epoch: 1, expected_marker_seq: 1 }),
    ]);

    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const current = (await allRows()).filter((r) => r.superseded_at === null);
    expect(current).toHaveLength(1);
    // 진 쪽이 이긴 쪽을 덮지 않았다.
    expect([2, 3]).toContain(current[0]?.merge_seq);
  });

  it('실패한 쓰기가 직전 current를 잃지 않는다', async () => {
    await write(managerSession, { merge_seq: 2, seq_epoch: 1, note: '지켜져야 한다', expected_marker_seq: null });
    // 없는 서수로 실패시킨다.
    await write(managerSession, { merge_seq: 99, seq_epoch: 1, expected_marker_seq: 2 });

    const current = (await allRows()).filter((r) => r.superseded_at === null);
    expect(current).toHaveLength(1);
    expect(current[0]).toMatchObject({ merge_seq: 2, note: '지켜져야 한다' });
  });

  it('**대체 트랜잭션이 에폭을 다시 본다** — 재채번이 끼어들어도 무효를 저장하지 않는다 (DEV-471)', async () => {
    /*
     * 라우트의 사전 검사(5)는 **다른 트랜잭션에서 읽은 값**으로 판정한다.
     * 여기서는 그 사이에 재채번이 커밋한 상황을 만든다 — 리포지터리에
     * 옛 에폭을 그대로 넘기고, 공간의 에폭은 이미 올라가 있다.
     */
    await pool.query('UPDATE sequence_space SET seq_epoch = 2 WHERE repository_id = $1', [PAYMENTS]);

    const outcome = await safeMarkerRepo.replaceMarker(pool, {
      repositoryId: PAYMENTS,
      baseBranch: BRANCH,
      mergeSeq: 2,
      seqEpoch: 1,
      note: null,
      createdBy: MANAGER,
      expectedMarkerSeq: null,
    });

    expect(outcome).toEqual({ kind: 'epoch_stale', currentEpoch: 2 });
    // 무효한 표식이 저장되지 않았다.
    expect(await allRows()).toHaveLength(0);
  });

  it('**이 스키마에서 `FOR SHARE`가 `bumpEpoch`를 실제로 막는다** — 재검증이 딛고 선 전제 (DEV-471)', async () => {
    /*
     * 재검증만으로는 부족하다. 잠그지 않고 읽으면 `READ COMMITTED`에서
     * **읽은 직후에 커밋한 재채번**을 보지 못하고, 그 창으로 무효한 표식이
     * 들어간다.
     *
     * **이 시험은 우리 코드가 아니라 그 전제를 잰다** — `sequence_space` 행에
     * `FOR SHARE`를 걸면 `bumpEpoch`의 `UPDATE`가 기다린다는 것. 리포지터리가
     * 실제로 그 잠금을 쓰는지는 `regression/runtime-reachability.test.ts`가
     * 소스에서 확인한다. **둘 중 하나만 있으면 변이가 살아남는다** — `FOR
     * SHARE`만 뺀 변이가 통합 32건을 전부 통과한 것이 그 자리였다.
     */
    const holder = await pool.connect();
    const bumper = await pool.connect();
    try {
      await holder.query('BEGIN');
      await holder.query(
        `SELECT seq_epoch FROM sequence_space
          WHERE repository_id = $1 AND base_branch = $2 FOR SHARE`,
        [PAYMENTS, BRANCH],
      );

      await bumper.query('BEGIN');
      await bumper.query('SET LOCAL lock_timeout = 400');
      const bump = bumper.query(
        `UPDATE sequence_space SET seq_epoch = seq_epoch + 1
          WHERE repository_id = $1 AND base_branch = $2`,
        [PAYMENTS, BRANCH],
      );

      await expect(bump).rejects.toThrow(/lock timeout|55P03|canceling statement/i);
      await bumper.query('ROLLBACK');
      await holder.query('ROLLBACK');
    } finally {
      holder.release();
      bumper.release();
    }

    // 에폭은 그대로다 — 대기가 취소된 갱신은 아무것도 바꾸지 않았다.
    const { rows } = await pool.query<{ seq_epoch: number }>(
      'SELECT seq_epoch FROM sequence_space WHERE repository_id = $1 AND base_branch = $2',
      [PAYMENTS, BRANCH],
    );
    expect(rows[0]?.seq_epoch).toBe(1);
  });

  it('공간이 사라지면 `space_missing`이며 아무것도 쓰지 않는다 (DEV-471)', async () => {
    const outcome = await safeMarkerRepo.replaceMarker(pool, {
      repositoryId: ID_CEIL, // 등록된 적 없는 ID
      baseBranch: BRANCH,
      mergeSeq: 1,
      seqEpoch: 1,
      note: null,
      createdBy: MANAGER,
      expectedMarkerSeq: null,
    });
    expect(outcome).toEqual({ kind: 'space_missing' });
    expect(await allRows(ID_CEIL)).toHaveLength(0);
  });

  it('리포지터리 계층에서도 같은 불변식이 성립한다', async () => {
    // 라우트를 지나지 않고 직접 겨루게 해서 트랜잭션 자체를 확인한다.
    await safeMarkerRepo.replaceMarker(pool, {
      repositoryId: PAYMENTS,
      baseBranch: BRANCH,
      mergeSeq: 1,
      seqEpoch: 1,
      note: null,
      createdBy: MANAGER,
      expectedMarkerSeq: null,
    });
    const outcomes = await Promise.all(
      [2, 3].map((seq) =>
        safeMarkerRepo.replaceMarker(pool, {
          repositoryId: PAYMENTS,
          baseBranch: BRANCH,
          mergeSeq: seq,
          seqEpoch: 1,
          note: null,
          createdBy: MANAGER,
          expectedMarkerSeq: 1,
        }),
      ),
    );
    expect(outcomes.map((o) => o.kind).sort()).toEqual(['conflict', 'created']);
    expect((await allRows()).filter((r) => r.superseded_at === null)).toHaveLength(1);
  });
});

describe('감사 (AC-5, FR-AUTH-004)', () => {
  it('성공한 등록이 `safe_marker.set`을 남긴다', async () => {
    await write(managerSession, { merge_seq: 2, seq_epoch: 1, note: '메모', expected_marker_seq: null });
    const rows = await auditRows('created');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      user_id: MANAGER,
      action: 'safe_marker.set',
      target: 'acme/wp041-payments@main@2',
    });
    // 메모는 조건이 아니므로 `query`에 담지 않는다.
    expect(rows[0]?.query).toBeNull();
  });

  it('**거절이 성공으로 기록되지 않는다**', async () => {
    await write(managerSession, { merge_seq: 99, seq_epoch: 1, expected_marker_seq: null });
    expect(await auditRows('created')).toHaveLength(0);
    const rejected = await auditRows('sequence_not_found');
    expect(rejected).toHaveLength(1);
  });

  it('403은 감사에 남기지 않는다 — 자격 없는 반복 요청이 평면을 채운다', async () => {
    await write(developerSession, { merge_seq: 1, seq_epoch: 1, expected_marker_seq: null });
    expect(await auditRows()).toHaveLength(0);
  });

  it('**멱등 재시도는 감사를 남기지 않는다** — 재시도 횟수가 등록 횟수로 보인다', async () => {
    await write(managerSession, { merge_seq: 2, seq_epoch: 1, note: 'n', expected_marker_seq: null });
    await write(managerSession, { merge_seq: 2, seq_epoch: 1, note: 'n', expected_marker_seq: null });
    expect(await auditRows()).toHaveLength(1);
  });

  it('충돌도 사유와 함께 남는다', async () => {
    await write(managerSession, { merge_seq: 1, seq_epoch: 1, expected_marker_seq: null });
    await write(managerSession, { merge_seq: 3, seq_epoch: 1, expected_marker_seq: 99 });
    expect(await auditRows('marker_conflict')).toHaveLength(1);
  });
});
