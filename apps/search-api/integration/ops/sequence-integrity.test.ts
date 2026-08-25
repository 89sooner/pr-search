/**
 * 시퀀스 정합성 점검과 재채번 (API-ADM-007 / WP-028, FR-ADMIN-003, CR-033).
 *
 * 실제 PostgreSQL에 붙는다. 마이그레이션 009가 `sequence_reassign`을 실제로
 * 허용하는지는 **잡 행을 넣어 봐야** 알 수 있다 (DEV-172) — CHECK 제약은 타입이
 * 잡아 주지 않는다.
 *
 * ## 이 파일이 지키는 주장
 *
 * 1. **점검 실패가 시퀀스 공간 상태를 바꾸지 않는다** (DEV-171). 이 WP의 핵심
 *    결정이며, 바꾸는 변이는 여기서 죽는다.
 * 2. **최초 불일치**를 낸다 (AC-3). 마지막이 아니다.
 * 3. **표본은 최근 1000개**다 (AC-2).
 * 4. `confirmation` 불일치는 400이다 (FLOW-008).
 * 5. 점검은 감사 기록 대상이다 (AC-5).
 *
 * 실행: `pnpm test:integration ops/sequence-integrity`
 */

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  auditRepo,
  jobRepo,
  mergeSequenceRepo,
  repositoryRepo,
  sequenceSpaceRepo,
  type Pool,
} from '@prs/db';
import { CommitGraphError, type CommitGraph } from '@prs/github';
import { buildServer } from '../../src/server.js';
import { SEQUENCE_INTEGRITY_PATH } from '../../src/ops/routes.js';
import type { OpsDeps } from '../../src/ops/dead-letters.js';
import { migratedPool } from '../helpers.js';

const TEST_AUTH_CONFIG = {
  enabled: false,
  cookieSecure: false,
  loginPath: '/auth/login',
  groupRoleMap: new Map<string, never>(),
} as const;

const TOKEN = 'test-admin-token';
const AUTH = { authorization: `Bearer ${TOKEN}` };
const REPOSITORY_ID = 7301;
const OWNER = 'acme';
const NAME = 'integrity-wp028';
const SLUG = `${OWNER}/${NAME}`;
const MAIN = 'main';

function shaOf(seq: number): string {
  return `${String(seq).padStart(4, '0')}${'d'.repeat(36)}`;
}

let pool: Pool;
let app: FastifyInstance;
/** 시험이 정하는 실제 체인. 오래된 것부터다. */
let chain: string[];
/** 그래프가 던질 오류. 있으면 `firstParentRevList`가 실패한다. */
let graphFailure: Error | null;
let headOverride: string | null | undefined;

function stubGraph(): CommitGraph {
  return {
    kind: 'api',
    resolveHead: () => Promise.resolve(headOverride === undefined ? (chain.at(-1) ?? null) : headOverride),
    isAncestor: () => Promise.resolve(true),
    mergeBase: () => Promise.resolve(null),
    firstParentRevList: () => (graphFailure === null ? Promise.resolve([...chain]) : Promise.reject(graphFailure)),
    firstParentCommits: () => Promise.resolve([]),
    patchId: () => Promise.resolve({ kind: 'unavailable', reason: 'blob_fetch_disabled' }),
  } as unknown as CommitGraph;
}

async function seedSequence(entries: readonly { seq: number; sha: string }[]): Promise<void> {
  for (const entry of entries) {
    await mergeSequenceRepo.upsertMergeSequence(pool, {
      repository_id: REPOSITORY_ID,
      base_branch: MAIN,
      seq_epoch: 1,
      merge_seq: entry.seq,
      commit_sha: entry.sha,
      pull_request_number: null,
      committed_at: new Date('2026-08-01T00:00:00Z'),
    });
  }
  const last = entries.at(-1);
  if (last !== undefined) await sequenceSpaceRepo.advanceHead(pool, REPOSITORY_ID, MAIN, last.sha, last.seq);
}

async function get(params: Record<string, string> = {}): Promise<{ status: number; body: Record<string, unknown> }> {
  const query = new URLSearchParams({ repository: SLUG, base_branch: MAIN, ...params }).toString();
  const response = await app.inject({ method: 'GET', url: `${SEQUENCE_INTEGRITY_PATH}?${query}`, headers: AUTH });
  return { status: response.statusCode, body: response.json<Record<string, unknown>>() };
}

async function post(body: Record<string, unknown>): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await app.inject({ method: 'POST', url: SEQUENCE_INTEGRITY_PATH, headers: AUTH, payload: body });
  return { status: response.statusCode, body: response.json<Record<string, unknown>>() };
}

async function spaceState(): Promise<string | undefined> {
  const space = await sequenceSpaceRepo.findSequenceSpace(pool, REPOSITORY_ID, MAIN);
  return space?.state;
}

describe('API-ADM-007 시퀀스 정합성 점검 (WP-028)', () => {
  beforeAll(async () => {
    pool = await migratedPool();
    await repositoryRepo.upsertRepository(pool, {
      repository_id: REPOSITORY_ID,
      owner: OWNER,
      name: NAME,
      org_id: 1,
      visibility: 'internal',
      sequence_branches: [MAIN],
    });
    app = buildServer({
      config: {
        port: 0,
        adminTokens: [{ name: 'tester', token: TOKEN }],
        metricsQueryUrl: null,
        gheBaseUrl: null,
        auth: TEST_AUTH_CONFIG,
      },
      /*
       * `ops`는 관리 경로 전체의 관문이다 (`deps.ops === undefined`면 등록하지
       * 않는다). 이 시험은 실패 대기열 경로를 쓰지 않으므로 `bus`는 호출되지
       * 않는 자리채움이다 — 쓰이는 순간 시험이 죽도록 던지게 둔다.
       */
      ops: {
        pool,
        bus: {
          publish: () => Promise.reject(new Error('이 시험은 버스를 쓰지 않는다')),
        } as unknown as OpsDeps['bus'],
      },
      integrity: { pool, graphFor: () => stubGraph() },
    });
    await app.ready();
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await pool?.end();
  });

  beforeEach(async () => {
    await pool.query('DELETE FROM merge_sequence WHERE repository_id = $1', [REPOSITORY_ID]);
    await pool.query('DELETE FROM safe_marker WHERE repository_id = $1', [REPOSITORY_ID]);
    await pool.query('DELETE FROM job');
    await pool.query('DELETE FROM saved_search');
    await sequenceSpaceRepo.ensureSequenceSpace(pool, REPOSITORY_ID, MAIN);
    await pool.query("UPDATE sequence_space SET state = 'ok', head_seq = 0, seq_epoch = 1 WHERE repository_id = $1", [REPOSITORY_ID]);
    chain = [];
    graphFailure = null;
    headOverride = undefined;
  });

  describe('일치 판정', () => {
    it('저장분과 체인이 같으면 consistent다', async () => {
      chain = [shaOf(1), shaOf(2), shaOf(3)];
      await seedSequence([1, 2, 3].map((seq) => ({ seq, sha: shaOf(seq) })));

      const { status, body } = await get();
      expect(status).toBe(200);
      expect(body['check_state']).toBe('completed');
      expect(body['consistent']).toBe(true);
      expect(body['checked_count']).toBe(3);
      expect(body['first_mismatch']).toBeNull();
      expect(body['sequence_space']).toBe(`${SLUG}@${MAIN}`);
    });

    it('채번이 뒤처진 것은 불일치가 아니다', async () => {
      chain = [shaOf(1), shaOf(2), shaOf(3), shaOf(4)];
      await seedSequence([1, 2].map((seq) => ({ seq, sha: shaOf(seq) })));
      expect((await get()).body['consistent']).toBe(true);
    });
  });

  describe('불일치 보고 (AC-3)', () => {
    it('**최초** 불일치의 저장 SHA와 실제 SHA를 낸다', async () => {
      chain = [shaOf(1), shaOf(91), shaOf(92)];
      await seedSequence([1, 2, 3].map((seq) => ({ seq, sha: shaOf(seq) })));

      const { body } = await get();
      expect(body['consistent']).toBe(false);
      expect(body['first_mismatch']).toEqual({
        merge_seq: 2,
        stored_commit_sha: shaOf(2),
        actual_commit_sha: shaOf(91),
      });
    });

    it('impact_estimate를 실제 데이터로 계산한다', async () => {
      chain = [shaOf(1), shaOf(91), shaOf(92)];
      await seedSequence([1, 2, 3].map((seq) => ({ seq, sha: shaOf(seq) })));
      await pool.query(
        `INSERT INTO safe_marker (repository_id, base_branch, seq_epoch, merge_seq, created_by)
         VALUES ($1, $2, 1, 3, 'tester')`,
        [REPOSITORY_ID, MAIN],
      );
      await pool.query(
        `INSERT INTO app_user (user_id, login, github_user_id) VALUES ('u-wp028', 'wp028-tester', 9301)
         ON CONFLICT DO NOTHING`,
      );
      await pool.query(
        `INSERT INTO saved_search (owner_user_id, name, query) VALUES ('u-wp028', 's1', $1), ('u-wp028', 's2', $2)`,
        [`repo:${SLUG} seq:1..9`, 'repo:acme/other seq:1..9'],
      );

      const impact = (await get()).body['impact_estimate'] as Record<string, number>;
      // 서수 2·3이 영향 범위다.
      expect(impact['affected_commit_count']).toBe(2);
      expect(impact['invalidated_safe_marker_count']).toBe(1);
      // 다른 저장소로 좁힌 검색은 세지 않는다.
      expect(impact['affected_saved_search_count']).toBe(1);
    });
  });

  describe('표본과 전량 (AC-1·AC-2)', () => {
    it('표본은 최근 1000개만 본다', async () => {
      const total = 1005;
      chain = Array.from({ length: total }, (_, index) => shaOf(index + 1));
      const entries = Array.from({ length: total }, (_, index) => ({ seq: index + 1, sha: shaOf(index + 1) }));
      await seedSequence(entries);

      expect((await get({ mode: 'sample' })).body['checked_count']).toBe(1000);
      expect((await get({ mode: 'full' })).body['checked_count']).toBe(total);
    });

    it('모르는 mode는 400이다', async () => {
      const { status, body } = await get({ mode: 'everything' });
      expect(status).toBe(400);
      expect((body['error'] as Record<string, unknown>)['code']).toBe('INVALID_PARAMETER');
    });
  });

  describe('**점검 실패가 공간 상태를 바꾸지 않는다** (CR-033, DEV-171)', () => {
    it('그래프를 읽지 못하면 failed로 답하고 상태는 그대로다', async () => {
      chain = [shaOf(1)];
      await seedSequence([{ seq: 1, sha: shaOf(1) }]);
      const before = await spaceState();
      graphFailure = new CommitGraphError('api', 'upstream down');

      const { status, body } = await get();
      expect(status).toBe(200);
      expect(body['check_state']).toBe('failed');
      expect(body['reason']).toBe('commit_graph_unavailable');
      // **핵심**: 상태가 unknown으로 바뀌지 않는다.
      expect(await spaceState()).toBe(before);
      expect(await spaceState()).not.toBe('unknown');
    });

    it('**실패를 consistent로 표현하지 않는다** — 검사하지 않은 것을 일치라 적지 않는다', async () => {
      chain = [shaOf(1)];
      await seedSequence([{ seq: 1, sha: shaOf(1) }]);
      graphFailure = new CommitGraphError('api', 'upstream down');

      const { body } = await get();
      expect(body).not.toHaveProperty('consistent');
      expect(body).not.toHaveProperty('checked_count');
    });

    it('브랜치가 사라져도 상태를 바꾸지 않는다', async () => {
      await seedSequence([{ seq: 1, sha: shaOf(1) }]);
      headOverride = null;

      const { body } = await get();
      expect(body['check_state']).toBe('failed');
      expect(body['reason']).toBe('branch_head_missing');
      expect(await spaceState()).not.toBe('unknown');
    });
  });

  describe('감사 기록 (AC-5)', () => {
    it('점검 결과가 감사 기록에 남는다', async () => {
      chain = [shaOf(1)];
      await seedSequence([{ seq: 1, sha: shaOf(1) }]);
      await get();

      const records = await auditRepo.listAuditRecords(pool, {}, 20);
      const record = records.find((row) => row.action === 'sequence_integrity.check');
      expect(record).toBeDefined();
      expect(record?.target).toBe(`${SLUG}@${MAIN}`);
      expect(record?.result_code).toBe('consistent');
    });

    it('실패한 점검도 남는다 — 답이 없었다는 사실을 추적할 수 있어야 한다', async () => {
      await seedSequence([{ seq: 1, sha: shaOf(1) }]);
      graphFailure = new CommitGraphError('api', 'down');
      await get();

      const records = await auditRepo.listAuditRecords(pool, {}, 20);
      expect(records.some((row) => row.result_code === 'commit_graph_unavailable')).toBe(true);
    });
  });

  describe('재채번 실행 (FLOW-008)', () => {
    it('confirmation이 다르면 400이다', async () => {
      await seedSequence([{ seq: 1, sha: shaOf(1) }]);
      const { status, body } = await post({
        repository: SLUG,
        base_branch: MAIN,
        action: 'reassign',
        confirmation: 'acme/wrong',
      });
      expect(status).toBe(400);
      expect((body['error'] as Record<string, unknown>)['code']).toBe('CONFIRMATION_MISMATCH');
      // 거절된 요청은 잡을 남기지 않는다.
      const jobs = await jobRepo.listJobs(pool, {});
      expect(jobs).toHaveLength(0);
    });

    it('**일치하면 sequence_reassign 잡이 실제로 만들어진다** (마이그레이션 009 / DEV-172)', async () => {
      await seedSequence([{ seq: 1, sha: shaOf(1) }]);
      const { status, body } = await post({
        repository: SLUG,
        base_branch: MAIN,
        action: 'reassign',
        confirmation: SLUG,
      });
      expect(status).toBe(202);
      expect(body['type']).toBe('sequence_reassign');
      expect(body['state']).toBe('queued');
      // 현재 에폭 1 + 1. 고정값이 아니라 계산 결과다.
      expect(body['new_epoch_expected']).toBe(2);

      // CHECK 제약을 실제로 지났는지 행으로 확인한다.
      const row = await jobRepo.findJobById(pool, body['job_id'] as number);
      expect(row?.type).toBe('sequence_reassign');
      expect(row?.target).toBe(`${SLUG}@${MAIN}`);
    });

    it('에폭이 오르면 예상값도 따라 오른다', async () => {
      await seedSequence([{ seq: 1, sha: shaOf(1) }]);
      await pool.query('UPDATE sequence_space SET seq_epoch = 7 WHERE repository_id = $1', [REPOSITORY_ID]);
      const { body } = await post({ repository: SLUG, base_branch: MAIN, action: 'reassign', confirmation: SLUG });
      expect(body['new_epoch_expected']).toBe(8);
    });

    it('같은 공간에 활성 잡이 있으면 409다', async () => {
      await seedSequence([{ seq: 1, sha: shaOf(1) }]);
      await post({ repository: SLUG, base_branch: MAIN, action: 'reassign', confirmation: SLUG });
      const second = await post({ repository: SLUG, base_branch: MAIN, action: 'reassign', confirmation: SLUG });
      expect(second.status).toBe(409);
      expect((second.body['error'] as Record<string, unknown>)['code']).toBe('JOB_CONFLICT');
    });

    it('재채번 실행이 감사 기록에 남는다', async () => {
      await seedSequence([{ seq: 1, sha: shaOf(1) }]);
      await post({ repository: SLUG, base_branch: MAIN, action: 'reassign', confirmation: SLUG });
      const records = await auditRepo.listAuditRecords(pool, {}, 20);
      expect(records.some((row) => row.action === 'sequence_integrity.reassign')).toBe(true);
    });
  });

  describe('입력과 권한', () => {
    it('토큰이 없으면 401이다', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `${SEQUENCE_INTEGRITY_PATH}?repository=${SLUG}&base_branch=${MAIN}`,
      });
      expect(response.statusCode).toBe(401);
    });

    it('base_branch가 없으면 400이다', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `${SEQUENCE_INTEGRITY_PATH}?repository=${SLUG}`,
        headers: AUTH,
      });
      expect(response.statusCode).toBe(400);
    });

    it('등록되지 않은 저장소는 404다', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `${SEQUENCE_INTEGRITY_PATH}?repository=acme/none&base_branch=main`,
        headers: AUTH,
      });
      expect(response.statusCode).toBe(404);
    });

    it('채번된 적 없는 공간은 404다', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `${SEQUENCE_INTEGRITY_PATH}?repository=${SLUG}&base_branch=feature/none`,
        headers: AUTH,
      });
      expect(response.statusCode).toBe(404);
    });
  });
});
