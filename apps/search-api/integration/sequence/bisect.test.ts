/** WP-042 / FR-SEQ-007: 실제 PostgreSQL·Redis, API-SEQ-005 전체 생명주기. */
import Fastify, { type FastifyInstance } from 'fastify';
import { beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest';
import { authRepo, repositoryRepo, sequenceSpaceRepo, mergeSequenceRepo, type bisectSessionRepo, type Pool } from '@prs/db';
import { createSessionId, SESSION_COOKIE_NAME } from '@prs/authz';
import type { Redis } from '@prs/bus';
import { createAuthContext, type AuthRedis } from '../../src/auth/context.js';
import { registerSequenceRoutes, BISECT_SESSIONS_PATH } from '../../src/sequence/routes.js';
import { migratedPool, createTestRedis } from '../helpers.js';
import { TEST_CURSOR_SIGNER } from '../_cursor-fixture.js';

const REPO = 4201;
const SEQS = [1, 2, 5, 8, 9];
let pool: Pool; let redis: Redis; let app: FastifyInstance;
let cookie: string; let otherCookie: string;
const params = '?repository=acme%2Fwp042&base_branch=main';
const sha = (seq: number): string => String(seq).padStart(40, 'a');
function call(method: 'GET' | 'POST' | 'DELETE', payload?: Record<string, unknown>, session = cookie) {
  return app.inject({ method, url: BISECT_SESSIONS_PATH + (method === 'POST' ? '' : params + (payload?.['session_id'] === undefined ? '' : `&session_id=${String(payload['session_id'])}`)),
    headers: { cookie: session }, ...(method === 'POST' ? { payload: { repository: 'acme/wp042', base_branch: 'main', seq_epoch: 1, ...payload } } : {}) });
}
async function start(from = 1, to = 9) {
  const response = await call('POST', { action: 'start', from_seq: from, to_seq: to });
  expect(response.statusCode).toBe(200);
  return response.json<{ session: bisectSessionRepo.BisectView }>().session;
}

beforeAll(async () => {
  pool = await migratedPool(); redis = createTestRedis();
  await repositoryRepo.upsertRepository(pool, { repository_id: REPO, owner: 'acme', name: 'wp042', org_id: 42, visibility: 'internal', sequence_branches: ['main'] });
  await sequenceSpaceRepo.ensureSequenceSpace(pool, REPO, 'main');
  for (const seq of SEQS) await mergeSequenceRepo.upsertMergeSequence(pool, { repository_id: REPO, base_branch: 'main', seq_epoch: 1, merge_seq: seq, commit_sha: sha(seq), pull_request_number: seq === 9 ? null : 4200 + seq, committed_at: new Date() });
  const port: AuthRedis = { get: (k) => redis.get(k), set: (k, v, m, s) => redis.set(k, v, m, s), del: (...keys) => redis.del(...keys), scan: (c, m, p, c2, n) => redis.scan(c, m, p, c2, n) };
  const auth = createAuthContext({ pool, redis: port, source: { fetch: async () => ({ repositoryIds: [REPO], orgIds: [42], teamIds: [], visibilities: ['internal'] }) } });
  const cookies: string[] = [];
  for (const [index, user] of ['wp042-a', 'wp042-b'].entries()) {
    await authRepo.upsertUserOnLogin(pool, { user_id: user, login: user, github_user_id: 42000 + index });
    const id = createSessionId(); const now = Date.now();
    await auth.sessions.create({ sessionId: id, userId: user, login: user, email: null, roles: ['developer'], issuedAt: now, lastSeenAt: now, correlationId: null });
    cookies.push(`${SESSION_COOKIE_NAME}=${id}`);
  }
  cookie = cookies[0] ?? ''; otherCookie = cookies[1] ?? '';
  app = Fastify();
  registerSequenceRoutes(app, { auth, loginPath: '/auth/login', pool, es: undefined as never, cursorSigner: TEST_CURSOR_SIGNER, resolveNames: async () => ({ orgIds: new Map(), teamIds: new Map() }) });
  await app.ready();
}, 180_000);
beforeEach(async () => {
  await pool.query('DELETE FROM bisect_session WHERE repository_id=$1', [REPO]);
  await pool.query("UPDATE sequence_space SET seq_epoch=1,state='ok' WHERE repository_id=$1", [REPO]);
});
afterAll(async () => {
  await app?.close(); await redis?.quit();
  if (pool !== undefined) {
    for (const table of ['bisect_session', 'merge_sequence', 'sequence_space', 'repository']) await pool.query(`DELETE FROM ${table} WHERE repository_id=$1`, [REPO]);
    await pool.end();
  }
});

describe('FR-SEQ-007 / WP-042 bisect', () => {
  it('AC1~4 sparse commits: actual midpoint → bad/good narrowing → PR convergence', async () => {
    const first = await start();
    expect(first).toMatchObject({ remaining: 4, estimated_steps: 2, next: { merge_seq: 5 }, converged: false });
    const bad = await call('POST', { action: 'mark', session_id: first.session_id, merge_seq: 5, verdict: 'bad' });
    expect(bad.statusCode).toBe(200);
    expect(bad.json().session).toMatchObject({ good_seq: 1, bad_seq: 5, remaining: 2, estimated_steps: 1, next: { merge_seq: 2 } });
    const good = await call('POST', { action: 'mark', session_id: first.session_id, merge_seq: 2, verdict: 'good' });
    expect(good.json().session).toMatchObject({ remaining: 1, estimated_steps: 0, converged: true, next: null, result: { merge_seq: 5, pull_request_number: 4205 } });
  });
  it('AC5 restores server state and isolates users', async () => {
    const first = await start();
    expect((await call('GET')).json().session).toEqual(first);
    expect((await call('GET', undefined, otherCookie)).json().session).toBeNull();
    expect((await call('POST', { action: 'mark', session_id: first.session_id, merge_seq: 5, verdict: 'good' }, otherCookie)).statusCode).toBe(404);
  });
  it('contradictions return 409, preserve state and allow reset', async () => {
    const first = await start(1, 5);
    const response = await call('POST', { action: 'mark', session_id: first.session_id, merge_seq: 8, verdict: 'good' });
    expect(response.statusCode).toBe(409);
    expect(response.json().error).toMatchObject({ code: 'BISECT_CONTRADICTION', detail: { reason: 'bisect_contradiction', good_seq: 8, bad_seq: 5 } });
    expect((await call('GET')).json().session).toEqual(first);
    expect((await call('DELETE', { session_id: first.session_id })).json().session).toBeNull();
  });
  it('epoch changes invalidate stored values and reject old marks', async () => {
    const first = await start();
    await pool.query('UPDATE sequence_space SET seq_epoch=2 WHERE repository_id=$1', [REPO]);
    expect((await call('GET')).json().session).toMatchObject({ seq_epoch: 1, epoch_stale: true, remaining: null, next: null, result: null });
    expect((await call('POST', { action: 'mark', session_id: first.session_id, merge_seq: 5, verdict: 'bad' })).statusCode).toBe(409);
    expect((await call('DELETE', { session_id: first.session_id })).statusCode).toBe(200);
  });
  it('direct push result preserves commit rather than inventing a PR', async () => {
    expect(await start(8, 9)).toMatchObject({ converged: true, remaining: 1, result: { commit_sha: sha(9), pull_request_number: null } });
  });
  it('reassigning blocks reads and writes before the epoch is bumped', async () => {
    const first = await start();
    await pool.query("UPDATE sequence_space SET state='reassigning' WHERE repository_id=$1", [REPO]);
    expect((await call('GET')).json().session).toMatchObject({ epoch_stale: true, remaining: null, next: null });
    expect((await call('POST', { action: 'mark', session_id: first.session_id, merge_seq: 5, verdict: 'good' })).statusCode).toBe(409);
  });
  it('empty/missing/unsafe inputs fail and zero starts at beginning', async () => {
    expect((await call('DELETE', { session_id: '999999999999999999999999' })).statusCode).toBe(400);
    for (const [from, to] of [[5, 5], [3, 9], [0, 100], [0, Number.MAX_SAFE_INTEGER + 1]]) {
      expect((await call('POST', { action: 'start', from_seq: from, to_seq: to })).statusCode).toBe(400);
    }
    expect(await start(0, 1)).toMatchObject({ remaining: 1, converged: true, result: { merge_seq: 1 } });
  });
  it('retries and concurrent marks never widen the interval', async () => {
    const first = await start();
    const marked = await Promise.all([2, 5].map((seq) => call('POST', { action: 'mark', session_id: first.session_id, merge_seq: seq, verdict: 'good' })));
    expect(marked.map((r) => r.statusCode)).toEqual([200, 200]);
    expect((await call('GET')).json().session.good_seq).toBe(5);
    expect((await call('POST', { action: 'start', from_seq: 0, to_seq: 9 })).json().session.good_seq).toBe(5);
  });
  it('old session requests cannot overwrite or delete a newly started session', async () => {
    const first = await start();
    await call('DELETE', { session_id: first.session_id });
    const second = await start(1, 5);
    expect(second.session_id).not.toBe(first.session_id);
    expect((await call('DELETE', { session_id: first.session_id })).statusCode).toBe(404);
    expect((await call('POST', { action: 'mark', session_id: first.session_id, merge_seq: 2, verdict: 'good' })).statusCode).toBe(404);
    expect((await call('GET')).json().session).toEqual(second);
  });
  it('authentication and repository scope are enforced for all operations', async () => {
    expect((await call('GET', undefined, '')).statusCode).toBe(401);
    expect((await call('POST', { repository: 'acme/hidden', action: 'start', from_seq: 0, to_seq: 9 })).statusCode).toBe(404);
  });
});
