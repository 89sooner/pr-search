/** WP-044 / FR-SRCH-012: real PostgreSQL, ES, Redis, API and batch runner. */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Client } from '@elastic/elasticsearch';
import { AccessScopeResolver, SessionStore, createSessionId, createScopeDatabase, SESSION_COOKIE_NAME, scopeKey } from '@prs/authz';
import { authRepo, jobRepo, repositoryRepo, searchExportRepo, type Pool } from '@prs/db';
import { applyMappings, createEsClient, switchAliasesForTests } from '@prs/es';
import type { Redis } from '@prs/bus';
import { buildServer } from '../../src/server.js';
import { resolveSearchApiConfig } from '../../src/config.js';
import type { AuthRedis } from '../../src/auth/context.js';
import { runExportJob } from '../../../pipeline-worker/src/export.js';
import { migratedPool, createTestRedis } from '../helpers.js';
import { TEST_CURSOR_SIGNER } from '../_cursor-fixture.js';

const USER = 'wp044-export-user';
const OTHER = 'wp044-export-other';
const REPO = 44001;
const HIDDEN = 44002;
let pool: Pool;
let redis: Redis;
let es: Client;
let app: FastifyInstance;
let cookie: string;
let otherCookie: string;
const jobIds: number[] = [];
beforeAll(async () => {
  pool = await migratedPool(); redis = createTestRedis(); es = createEsClient();
  await applyMappings(es); await switchAliasesForTests(es);
  for (const user of [USER, OTHER]) {
    await authRepo.upsertUserOnLogin(pool, { user_id: user, login: user });
    await pool.query('DELETE FROM job WHERE type=$1 AND requested_by=$2', ['export', user]);
    await pool.query('UPDATE app_user SET access_scope_version=0 WHERE user_id=$1', [user]);
    await pool.query('DELETE FROM permission_cache WHERE user_id=$1', [user]);
    await redis.del(scopeKey(user));
  }
  for (const [id, name] of [[REPO, 'visible'], [HIDDEN, 'hidden']] as const) {
    await repositoryRepo.upsertRepository(pool, { repository_id: id, owner: 'wp044', name, org_id: 44, visibility: 'internal', sequence_branches: ['main'] });
  }
  await es.deleteByQuery({ index: ['prs-pull-requests', 'prs-commits'], query: { terms: { repository_id: [REPO, HIDDEN] } }, refresh: true, conflicts: 'proceed' });
  const operations = Array.from({ length: 1002 }, (_, i) => [
    { index: { _index: 'prs-pull-requests', _id: `wp044-${i}` } },
    { doc_id: `wp044-${i}`, repository_id: i === 1001 ? HIDDEN : REPO, repository: i === 1001 ? 'wp044/hidden' : 'wp044/visible', base_branch: 'main', org_id: 44, visibility: 'internal', allowed_team_ids: [], pr_number: i+1, title: `제목 ${i}`, state: 'merged', merge_seq: i+1, seq_epoch: 1, sequence_space: 'wp044/visible@main', author: 'wp044-user', labels: i < 1000 ? ['sync'] : [], updated_at: '2026-09-01T00:00:00Z', created_at: '2026-09-01T00:00:00Z', merged_at: '2026-09-01T00:00:00Z' },
  ]).flat();
  const bulk = await es.bulk({ refresh: true, operations });
  expect(bulk.errors, JSON.stringify(bulk.items.filter((item) => item.index?.error))).toBe(false);
  const port: AuthRedis = { get: (key) => redis.get(key), set: (key,v,m,s) => redis.set(key,v,m,s), del: (...keys) => redis.del(...keys), scan: (c,m,p,n,s) => redis.scan(c,m,p,n,s) };
  const sessions = new SessionStore({ redis: port });
  const scopes = new AccessScopeResolver({ redis: port, db: createScopeDatabase(pool), source: { fetch: async () => ({ repositoryIds: [REPO], orgIds: [44], teamIds: [], visibilities: ['internal'] }) } });
  async function login(userId: string): Promise<string> {
    const sessionId = createSessionId(); const now = Date.now();
    await sessions.create({ sessionId, userId, login: userId, email: null, roles: ['developer'], issuedAt: now, lastSeenAt: now, correlationId: null });
    return `${SESSION_COOKIE_NAME}=${sessionId}`;
  }
  cookie = await login(USER); otherCookie = await login(OTHER);
  app = buildServer({ config: { ...resolveSearchApiConfig({}), adminTokens: [] }, auth: { sessions, scopes, forget: async () => undefined }, search: { pool, es, cursorSigner: TEST_CURSOR_SIGNER, resolveNames: async () => ({ orgIds: new Map(), teamIds: new Map() }) } });
});
afterAll(async () => {
  await app?.close();
  if (pool !== undefined) {
    await pool.query('DELETE FROM job WHERE type=$1 AND requested_by=ANY($2)', ['export', [USER, OTHER]]);
    await pool.query('DELETE FROM permission_cache WHERE user_id=ANY($1)', [[USER, OTHER]]);
    await pool.query('DELETE FROM app_user WHERE user_id=ANY($1)', [[USER, OTHER]]);
    await pool.query('DELETE FROM sequence_space WHERE repository_id=ANY($1)', [[REPO, HIDDEN]]);
    await pool.query('DELETE FROM repository WHERE repository_id=ANY($1)', [[REPO, HIDDEN]]);
    await pool.end();
  }
  if (redis !== undefined) { await redis.del(scopeKey(USER), scopeKey(OTHER)); await redis.quit(); }
  if (es !== undefined) { await es.deleteByQuery({ index: ['prs-pull-requests', 'prs-commits'], query: { terms: { repository_id: [REPO, HIDDEN] } }, refresh: true, conflicts: 'proceed' }); await es.close(); }
});
const post = (payload: Record<string, unknown>) => app.inject({ method: 'POST', url: '/api/v1/exports', headers: { cookie }, payload: { q: 'repo:wp044/visible', format: 'json', ...payload } });
const get = (id: number, download = false, who = cookie) => app.inject({ method: 'GET', url: `/api/v1/exports/${id}${download ? '/download' : ''}`, headers: { cookie: who } });
async function queued(): Promise<number> {
  const response = await post({}); expect(response.statusCode, response.body).toBe(202);
  const id = response.json<{ job_id: number }>().job_id; jobIds.push(id); return id;
}
describe('WP-044 export contract', () => {
  it('1000 sync JSON file, preview exact count, scope hides private repository', async () => {
    const preview = await post({ q: 'repo:wp044/visible label:sync', preview: true });
    expect(preview.json()).toEqual({ total: 1000, mode: 'sync' });
    const response = await post({ q: 'repo:wp044/visible label:sync' });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.headers['content-disposition']).toContain('attachment');
    expect(response.json<unknown[]>()).toHaveLength(1000);
    const hidden = await post({ q: 'repo:wp044/hidden' });
    expect(hidden.json()).toEqual([]);
    const audit = await pool.query('SELECT * FROM audit_record WHERE user_id=$1 AND action=$2', [USER, 'export.create']);
    expect(audit.rowCount).toBeGreaterThan(0);
  });
  it('1001 creates real job; owner only downloads complete file', async () => {
    const id = await queued();
    expect((await get(id, true)).statusCode).toBe(404);
    expect((await get(id, false, otherCookie)).statusCode).toBe(404);
    await runExportJob({ pool, es, log: () => undefined });
    expect((await get(id)).json()).toMatchObject({ state: 'completed', total: 1001, download_url: `/api/v1/exports/${id}/download` });
    const file = await get(id, true); expect(file.statusCode).toBe(200); expect(file.json<unknown[]>()).toHaveLength(1001);
  });
  it('100001 count gives 400 export_limit_exceeded', async () => {
    const spy = vi.spyOn(es, 'search').mockResolvedValueOnce({ timed_out: false, _shards: { total: 1, failed: 0, successful: 1, skipped: 0 }, hits: { total: { value: 100001, relation: 'gte' }, hits: [] }, took: 1 } as never);
    try { const response = await post({}); expect(response.statusCode).toBe(400); expect(response.json()).toMatchObject({ error: { code: 'EXPORT_LIMIT_EXCEEDED', detail: { reason: 'export_limit_exceeded' } } }); }
    finally { spy.mockRestore(); }
  });
  it('timed-out worker cannot publish a partial file', async () => {
    const id = await queued();
    const spy = vi.spyOn(es, 'search').mockResolvedValueOnce({ timed_out: true, _shards: { total: 1, failed: 0, successful: 1, skipped: 0 }, hits: { total: { value: 1001, relation: 'eq' }, hits: [] }, took: 1 } as never);
    try { await runExportJob({ pool, es, log: () => undefined }); } finally { spy.mockRestore(); }
    expect((await jobRepo.findJobById(pool, id))?.state).toBe('failed');
    expect((await searchExportRepo.findExport(pool, id))?.content).toBeNull();
    expect((await get(id, true)).statusCode).toBe(404);
  });
  it('PG scope fence rejects stale Redis in sync and queued execution', async () => {
    const id = await queued();
    await pool.query('UPDATE app_user SET access_scope_version=access_scope_version+1 WHERE user_id=$1', [USER]);
    const sync = await post({ q: 'repo:wp044/visible label:sync' });
    expect(sync.statusCode).not.toBe(200);
    await runExportJob({ pool, es, log: () => undefined });
    expect((await jobRepo.findJobById(pool, id))?.error).toBe('export_scope_changed');
    expect((await get(id, true)).statusCode).toBe(404);
    await pool.query('UPDATE app_user SET access_scope_version=0 WHERE user_id=$1', [USER]);
    await pool.query('DELETE FROM permission_cache WHERE user_id=$1', [USER]);
    await redis.del(scopeKey(USER));
  });
  it('epoch changes while queued fail instead of returning fewer rows', async () => {
    await pool.query(`INSERT INTO sequence_space(repository_id,base_branch,seq_epoch,state) VALUES ($1,'main',1,'ok') ON CONFLICT(repository_id,base_branch) DO UPDATE SET seq_epoch=1,state='ok'`, [REPO]);
    const response = await post({ q: 'repo:wp044/visible base:main seq:1..1001', seq_epoch: 1 });
    expect(response.statusCode, response.body).toBe(202);
    const id = response.json<{ job_id: number }>().job_id;
    expect((await searchExportRepo.findExport(pool, id))?.plan['sequenceContext']).toMatchObject({ repository: 'wp044/visible', base_branch: 'main', seq_epoch: 1 });
    await pool.query('UPDATE sequence_space SET seq_epoch=2 WHERE repository_id=$1', [REPO]);
    await runExportJob({ pool, es, log: () => undefined });
    expect((await jobRepo.findJobById(pool, id))?.error).toBe('export_epoch_changed');
    expect((await get(id, true)).statusCode).toBe(404);
  });
});
