/**
 * 저장소 등록 관리 (WP-010 DoD, API-ADM-001, FR-ING-009).
 *
 * 실제 PostgreSQL과 실제 Elasticsearch에 붙는다. 해제 표식은 `dynamic: strict`
 * 매핑을 통과해야 하므로 목으로는 검증되지 않는다 (DEV-028이 그렇게 숨어 있었다).
 *
 * GHE 조회만 좁은 포트로 대체한다 — 토큰 풀과 rate limit은 `@prs/github`의
 * 계약 시험이 이미 덮고 있고, 여기서 보려는 것은 등록 로직이다.
 */

import type { Client as EsClient } from '@elastic/elasticsearch';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { auditRepo, repositoryRepo, type Pool } from '@prs/db';
import { ARCHIVABLE_ALIASES, applyMappings, createEsClient, resolveClientOptions } from '@prs/es';
import { RedisStreamsEventBus, type Redis } from '@prs/bus';
import { buildServer } from '../../src/server.js';
import { REPOSITORIES_PATH } from '../../src/ops/routes.js';
import type { GheRepositoryFacts } from '../../src/ops/repositories.js';
import { createTestRedis, migratedPool } from '../helpers.js';

const TOKEN = 'registry-token';
const AUTH = { authorization: `Bearer ${TOKEN}` };
const REPOSITORY_ID = 4021;

let pool: Pool;
let es: EsClient;
let redis: Redis;
let bus: RedisStreamsEventBus;
let app: FastifyInstance;

/** 조회 결과를 시험이 바꿔 끼운다. `null`이면 접근할 수 없다는 뜻이다. */
let lookupResult: GheRepositoryFacts | null;
let lookupCalls: string[];

function facts(overrides: Partial<GheRepositoryFacts> = {}): GheRepositoryFacts {
  return {
    repository_id: REPOSITORY_ID,
    org_id: 77,
    visibility: 'internal',
    default_branch: 'main',
    ...overrides,
  };
}

async function seedDocument(repositoryId: number): Promise<void> {
  await es.index({
    index: 'prs-commits',
    id: `${String(repositoryId)}:abc1234`,
    routing: String(repositoryId),
    document: {
      document_version: 100,
      repository_id: repositoryId,
      repository: 'acme/payments',
      commit_sha: 'abc1234',
      role: 'source_commit',
      repository_archived: false,
    },
    refresh: true,
  });
}

describe('저장소 등록 관리 (WP-010, API-ADM-001)', () => {
  beforeAll(async () => {
    pool = await migratedPool();
    es = createEsClient(resolveClientOptions());
    await applyMappings(es);
    redis = createTestRedis();
    bus = new RedisStreamsEventBus(redis);
    app = buildServer({
      config: { port: 0, adminTokens: [{ name: 'alice', token: TOKEN }], metricsQueryUrl: null },
      ops: { pool, bus },
      registry: {
        pool,
        es,
        lookup: async (owner, name) => {
          lookupCalls.push(`${owner}/${name}`);
          return lookupResult;
        },
      },
    });
    await app.ready();
  }, 90_000);

  afterAll(async () => {
    await app.close();
    await bus.close();
    redis.disconnect();
    await es.close();
    await pool.end();
  });

  beforeEach(async () => {
    lookupResult = facts();
    lookupCalls = [];
    await pool.query('TRUNCATE repository, job, audit_record RESTART IDENTITY CASCADE');
    // 표식은 두 인덱스 모두에 붙으므로 두 곳 다 비운다. 한 곳만 비우면 다른
    // 스위트가 남긴 문서까지 세어 `documents_marked`가 흔들린다.
    for (const alias of ARCHIVABLE_ALIASES) {
      await es.deleteByQuery({
        index: alias,
        refresh: true,
        conflicts: 'proceed',
        query: { term: { repository_id: REPOSITORY_ID } },
      });
    }
  });

  async function register(body: Record<string, unknown>): Promise<ReturnType<FastifyInstance['inject']>> {
    return app.inject({ method: 'POST', url: REPOSITORIES_PATH, headers: AUTH, payload: body });
  }

  describe('등록 (AC-1)', () => {
    it('소유자·이름만 받고 나머지는 GHE에 물어서 채운다', async () => {
      // 클라이언트가 보낸 org_id·visibility를 믿으면 잘못된 조직으로 색인된
      // 문서가 ADR-008의 접근 범위 필터를 통과한다 (DEV-033).
      const response = await register({
        owner: 'acme',
        name: 'payments',
        sequence_branches: ['main'],
        org_id: 999,
        visibility: 'public',
        repository_id: 1,
      });

      expect(response.statusCode).toBe(201);
      expect(response.json()).toMatchObject({
        repository_id: REPOSITORY_ID,
        owner: 'acme',
        name: 'payments',
        org_id: 77,
        visibility: 'internal',
        sequence_branches: ['main'],
        mirror_enabled: true,
        status: 'active',
      });
      expect(lookupCalls).toEqual(['acme/payments']);
    });

    it('두 번째 등록은 200이고 설정을 갱신한다', async () => {
      await register({ owner: 'acme', name: 'payments', sequence_branches: ['main'] });
      const again = await register({
        owner: 'acme',
        name: 'payments',
        sequence_branches: ['main', 'release/2026.08'],
        mirror_enabled: false,
      });

      expect(again.statusCode).toBe(200);
      expect(again.json()).toMatchObject({
        sequence_branches: ['main', 'release/2026.08'],
        mirror_enabled: false,
      });
    });

    it('DoD: 대상 브랜치 11개면 400 BRANCH_LIMIT_EXCEEDED다 (AC-2)', async () => {
      const branches = Array.from({ length: 11 }, (_, index) => `branch-${String(index)}`);
      const response = await register({ owner: 'acme', name: 'payments', sequence_branches: branches });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({
        error: { code: 'BRANCH_LIMIT_EXCEEDED', detail: { limit: 10, given: 11 } },
      });
      // 거절했으면 행도 없어야 한다.
      expect(await repositoryRepo.countRepositories(pool)).toBe(0);
    });

    it('중복을 접은 뒤에 센다 — 10개는 통과한다', async () => {
      const branches = Array.from({ length: 10 }, (_, index) => `branch-${String(index)}`);
      expect((await register({ owner: 'acme', name: 'payments', sequence_branches: branches })).statusCode).toBe(201);

      const deduped = await register({
        owner: 'acme',
        name: 'payments',
        sequence_branches: [...branches, 'branch-0', 'branch-1'],
      });
      expect(deduped.statusCode).toBe(200);
    });

    it('DoD: 접근 권한이 없으면 403과 필요한 권한을 돌려준다', async () => {
      lookupResult = null;
      const response = await register({ owner: 'acme', name: 'secret', sequence_branches: [] });

      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({
        error: {
          code: 'FORBIDDEN_ROLE',
          detail: { required_permissions: ['metadata:read', 'contents:read', 'pull_requests:read'] },
        },
      });
      expect(await repositoryRepo.countRepositories(pool)).toBe(0);
    });

    it('백필을 요청하면 잡을 큐에 넣는다 (DEV-031)', async () => {
      const response = await register({
        owner: 'acme',
        name: 'payments',
        sequence_branches: [],
        backfill: true,
      });

      // DEV-027: `BIGSERIAL`이라 JSON에 숫자로 나간다. 문자열로 선언해 두면
      // 클라이언트 비교가 어긋난다.
      expect(response.json()).toMatchObject({ backfill_job_id: expect.any(Number) });
      const jobs = await pool.query<{ type: string; target: string; state: string; requested_by: string }>(
        'SELECT type, target, state, requested_by FROM job',
      );
      expect(jobs.rows).toEqual([
        { type: 'backfill', target: 'acme/payments', state: 'queued', requested_by: 'admin:alice' },
      ]);
    });

    it('백필을 요청하지 않으면 잡이 없다', async () => {
      await register({ owner: 'acme', name: 'payments', sequence_branches: [] });
      expect((await pool.query('SELECT 1 FROM job')).rows).toHaveLength(0);
    });

    it('소유자·이름이 없으면 400이다', async () => {
      expect((await register({ name: 'payments' })).statusCode).toBe(400);
      expect((await register({ owner: 'acme' })).statusCode).toBe(400);
      expect((await register({ owner: 'a/b', name: 'payments' })).statusCode).toBe(400);
    });
  });

  describe('조회', () => {
    it('상태로 좁힌다', async () => {
      await register({ owner: 'acme', name: 'payments', sequence_branches: [] });
      lookupResult = facts({ repository_id: 5150 });
      await register({ owner: 'acme', name: 'billing', sequence_branches: [] });
      await repositoryRepo.setRepositoryStatus(pool, 5150, 'archived');

      const all = await app.inject({ method: 'GET', url: REPOSITORIES_PATH, headers: AUTH });
      expect((all.json() as { total: number }).total).toBe(2);

      const active = await app.inject({
        method: 'GET',
        url: `${REPOSITORIES_PATH}?status=active`,
        headers: AUTH,
      });
      expect((active.json() as { total: number }).total).toBe(1);
    });

    it('인증 없이는 볼 수 없다', async () => {
      expect((await app.inject({ method: 'GET', url: REPOSITORIES_PATH })).statusCode).toBe(401);
    });
  });

  describe('변경', () => {
    it('시퀀스 브랜치와 미러 설정만 바꾼다', async () => {
      await register({ owner: 'acme', name: 'payments', sequence_branches: ['main'] });
      const response = await app.inject({
        method: 'PATCH',
        url: `${REPOSITORIES_PATH}/${String(REPOSITORY_ID)}`,
        headers: AUTH,
        payload: { sequence_branches: ['develop'], mirror_enabled: false, visibility: 'public' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        sequence_branches: ['develop'],
        mirror_enabled: false,
        // GHE가 소유한 값이라 여기서 바뀌지 않는다.
        visibility: 'internal',
      });
    });

    it('없는 저장소는 404다', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: `${REPOSITORIES_PATH}/999999`,
        headers: AUTH,
        payload: { mirror_enabled: false },
      });
      expect(response.statusCode).toBe(404);
    });

    it('브랜치 상한은 변경에도 적용된다', async () => {
      await register({ owner: 'acme', name: 'payments', sequence_branches: ['main'] });
      const response = await app.inject({
        method: 'PATCH',
        url: `${REPOSITORIES_PATH}/${String(REPOSITORY_ID)}`,
        headers: AUTH,
        payload: { sequence_branches: Array.from({ length: 11 }, (_, i) => `b-${String(i)}`) },
      });
      expect(response.statusCode).toBe(400);
    });
  });

  describe('해제 (AC-3)', () => {
    it('DoD: 문서를 지우지 않고 표식만 붙인다', async () => {
      await register({ owner: 'acme', name: 'payments', sequence_branches: [] });
      await seedDocument(REPOSITORY_ID);

      const response = await app.inject({
        method: 'DELETE',
        url: `${REPOSITORIES_PATH}/${String(REPOSITORY_ID)}`,
        headers: AUTH,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ status: 'archived', documents_marked: 1 });

      // 행도 문서도 남아 있다.
      expect((await repositoryRepo.findRepositoryById(pool, REPOSITORY_ID))?.status).toBe('archived');
      const doc = await es.get<{ repository_archived: boolean }>({
        index: 'prs-commits',
        id: `${String(REPOSITORY_ID)}:abc1234`,
        routing: String(REPOSITORY_ID),
      });
      expect(doc._source?.repository_archived).toBe(true);
    });

    it('재등록하면 표식이 풀린다', async () => {
      await register({ owner: 'acme', name: 'payments', sequence_branches: [] });
      await seedDocument(REPOSITORY_ID);
      await app.inject({
        method: 'DELETE',
        url: `${REPOSITORIES_PATH}/${String(REPOSITORY_ID)}`,
        headers: AUTH,
      });

      const again = await register({ owner: 'acme', name: 'payments', sequence_branches: [] });
      expect(again.json()).toMatchObject({ status: 'active', documents_marked: 1 });

      const doc = await es.get<{ repository_archived: boolean }>({
        index: 'prs-commits',
        id: `${String(REPOSITORY_ID)}:abc1234`,
        routing: String(REPOSITORY_ID),
      });
      expect(doc._source?.repository_archived).toBe(false);
    });

    it('없는 저장소는 404다', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: `${REPOSITORIES_PATH}/999999`,
        headers: AUTH,
      });
      expect(response.statusCode).toBe(404);
    });
  });

  describe('감사 기록 (AC-5, DEV-030)', () => {
    it('DoD: 등록·변경·해제가 남고 주체는 토큰 이름이다', async () => {
      await register({ owner: 'acme', name: 'payments', sequence_branches: [] });
      await app.inject({
        method: 'PATCH',
        url: `${REPOSITORIES_PATH}/${String(REPOSITORY_ID)}`,
        headers: AUTH,
        payload: { mirror_enabled: false },
      });
      await app.inject({
        method: 'DELETE',
        url: `${REPOSITORIES_PATH}/${String(REPOSITORY_ID)}`,
        headers: AUTH,
      });

      const records = await auditRepo.listAuditRecords(pool);
      expect(records.map((row) => row.action)).toEqual([
        'repository.unregister',
        'repository.update',
        'repository.register',
      ]);
      expect(records.every((row) => row.user_id === 'admin:alice')).toBe(true);
      expect(records.every((row) => row.target === 'acme/payments')).toBe(true);
    });

    it('거절된 등록도 남는다', async () => {
      lookupResult = null;
      await register({ owner: 'acme', name: 'secret', sequence_branches: [] });

      const records = await auditRepo.listAuditRecords(pool);
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({
        action: 'repository.register',
        target: 'acme/secret',
        result_code: 'FORBIDDEN_ROLE',
        user_id: 'admin:alice',
      });
    });

    it('인증 실패는 아무것도 남기지 않는다', async () => {
      await app.inject({ method: 'POST', url: REPOSITORIES_PATH, payload: { owner: 'a', name: 'b' } });
      expect(await auditRepo.listAuditRecords(pool)).toHaveLength(0);
    });
  });
});
