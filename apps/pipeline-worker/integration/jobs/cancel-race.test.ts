/**
 * 취소가 완료로 덮이지 않는다 (DEV-436 / FR-ADMIN-002, WP-040).
 *
 * 실제 PostgreSQL을 쓴다. **읽고 나서 쓰는 방식으로는 못 고치는 결함**이라
 * 데이터베이스가 한 번에 판정하는지를 데이터베이스로 확인해야 한다.
 *
 * ## 결함의 모양
 *
 * 백필 루프는 페이지 **사이**에서 `isJobRunning`을 본다. 마지막 페이지를
 * 처리하는 동안 취소가 들어오면 `!page.hasMore`로 빠져나와 종료 기록에 닿고,
 * 무방비 `finishJob`은 그때 `cancelled`를 `completed`로 덮는다. `catch` 갈래도
 * 같아서 취소가 `failed`가 된다.
 *
 * `DEV-196`이 `finishJobIfRunning`을 만든 바로 그 결함이며, 러너 넷 중 셋
 * (`link_rebuild`·`reindex`·`sequence_reassign`)은 이미 그것을 쓰는데 백필만
 * 옮겨 가지 않았다. `A-003`이 백필 취소를 노출하므로(`QA-A003-04`) 화면이
 * **되돌려지는 취소를 성공으로 보이게 된다.**
 *
 * ## 왜 유형 전부를 도는가
 *
 * `A-003`이 노출하는 유형(`OPERATOR_JOB_TYPES`) 어느 하나라도 이 성질을 잃으면
 * 그 화면의 중단 버튼이 거짓말을 한다. 목록이 자랄 때 새 유형이 조용히 이
 * 규율 밖에 서는 것을 막으려면 성질을 목록 전체에 건다.
 *
 * 실행: `pnpm run test:integration jobs/cancel-race`
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Client } from '@elastic/elasticsearch';
import { jobRepo, repositoryRepo, type Pool, type RepositoryRow } from '@prs/db';
import { applyMappings, switchAliasesForTests, createEsClient, resolveClientOptions } from '@prs/es';
import { OPERATOR_JOB_TYPES } from '../../../search-api/src/ops/jobs.js';
import { runBackfillJob, type BackfillDeps } from '../../src/backfill.js';
import { migratedPool } from '../helpers.js';

const REPOSITORY_ID = 904130;
const OWNER = 'wp040cr';
const NAME = 'cancel';
const TARGET = `${OWNER}/${NAME}`;
const ACTOR = 'sub-wp040-cancel-operator';

let pool: Pool;
let es: Client;
let repository: RepositoryRow;

beforeAll(async () => {
  pool = await migratedPool();
  es = createEsClient(resolveClientOptions());
  await applyMappings(es);
  await switchAliasesForTests(es);

  await pool.query('DELETE FROM job WHERE requested_by = $1', [ACTOR]);
  await pool.query('DELETE FROM repository WHERE repository_id = $1', [REPOSITORY_ID]);
  await repositoryRepo.upsertRepository(pool, {
    repository_id: REPOSITORY_ID,
    owner: OWNER,
    name: NAME,
    org_id: 9041,
    visibility: 'internal',
    sequence_branches: [],
    status: 'active',
  });
  const row = await repositoryRepo.findRepositoryById(pool, REPOSITORY_ID);
  if (row === undefined) throw new Error('픽스처 저장소가 사라졌다');
  repository = row;
}, 120_000);

beforeEach(async () => {
  await pool.query('DELETE FROM job WHERE requested_by = $1', [ACTOR]);
});

afterAll(async () => {
  await pool?.query('DELETE FROM job WHERE requested_by = $1', [ACTOR]);
  await pool?.query('DELETE FROM repository WHERE repository_id = $1', [REPOSITORY_ID]);
  await es?.close();
  await pool?.end();
});

/** 한 유형의 잡을 만들고 `running`으로 옮긴다. */
async function runningJob(type: (typeof OPERATOR_JOB_TYPES)[number], target: string): Promise<number> {
  const jobId = await jobRepo.enqueueJob(pool, type, target, ACTOR);
  const claimed = await jobRepo.claimNextJob(pool, type, 10);
  if (claimed?.job_id !== jobId) throw new Error(`${type} 잡을 집지 못했다`);
  return jobId;
}

describe('조건부 종료 전이 — A-003이 노출하는 유형 전부', () => {
  it.each(OPERATOR_JOB_TYPES)('%s — `cancelled`를 `completed`가 덮지 않는다', async (type) => {
    const jobId = await runningJob(type, `${TARGET}-${type}-completed`);
    await jobRepo.transitionJob(pool, jobId, 'cancel');

    const moved = await jobRepo.finishJobIfRunning(pool, jobId, 'completed', null);

    expect(moved).toBe(false);
    expect(await jobRepo.findJobState(pool, jobId)).toBe('cancelled');
  });

  it.each(OPERATOR_JOB_TYPES)('%s — `cancelled`를 `failed`가 덮지 않는다', async (type) => {
    const jobId = await runningJob(type, `${TARGET}-${type}-failed`);
    await jobRepo.transitionJob(pool, jobId, 'cancel');

    const moved = await jobRepo.finishJobIfRunning(pool, jobId, 'failed', '러너가 죽었다');

    expect(moved).toBe(false);
    expect(await jobRepo.findJobState(pool, jobId)).toBe('cancelled');
    // 오류 문구도 남지 않는다 — 취소된 잡에 실패 사유를 붙이면 그 잡이 실패한 것처럼 읽힌다.
    expect((await jobRepo.findJobById(pool, jobId))?.error).toBeNull();
  });

  it.each(OPERATOR_JOB_TYPES)('%s — `running`이면 정상적으로 옮긴다', async (type) => {
    const jobId = await runningJob(type, `${TARGET}-${type}-normal`);

    const moved = await jobRepo.finishJobIfRunning(pool, jobId, 'completed', null);

    expect(moved).toBe(true);
    expect(await jobRepo.findJobState(pool, jobId)).toBe('completed');
  });
});

/**
 * GHE 목. `onPage`로 **마지막 페이지를 처리하는 동안** 취소를 밀어 넣는다 —
 * 페이지 사이의 `isJobRunning` 검사가 놓치는 바로 그 창이다.
 */
function fakeClient(onPage: (page: number) => Promise<void>): BackfillDeps['client'] {
  return {
    listPullRequestsPage: async (_ref: unknown, page: number) => {
      await onPage(page);
      return { items: [], hasMore: false };
    },
  } as unknown as BackfillDeps['client'];
}

function backfillDeps(client: BackfillDeps['client']): BackfillDeps {
  return {
    pool,
    es,
    client,
    log: () => undefined,
    sleep: async () => undefined,
  };
}

describe('백필 러너의 마지막 페이지 경합 (DEV-436)', () => {
  it('**마지막 페이지를 처리하는 동안 취소되면 `cancelled`로 남는다**', async () => {
    const jobId = await runningJob('backfill', `${TARGET}-last-page`);
    const job = await jobRepo.findJobById(pool, jobId);

    /*
     * 이 취소는 페이지 **사이**가 아니라 페이지를 읽는 **도중**에 들어온다.
     * 루프의 `isJobRunning`은 이미 지나갔고, 다음에 닿는 자리가 종료 기록이다.
     */
    await runBackfillJob(
      backfillDeps(
        fakeClient(async () => {
          await jobRepo.transitionJob(pool, jobId, 'cancel');
        }),
      ),
      job!,
      repository,
    );

    expect(await jobRepo.findJobState(pool, jobId)).toBe('cancelled');
  }, 60_000);

  it('**같은 창에서 예외가 나도 취소가 `failed`로 바뀌지 않는다**', async () => {
    const jobId = await runningJob('backfill', `${TARGET}-last-page-throw`);
    const job = await jobRepo.findJobById(pool, jobId);

    await runBackfillJob(
      backfillDeps(
        fakeClient(async () => {
          await jobRepo.transitionJob(pool, jobId, 'cancel');
          throw new Error('페이지를 읽다 죽었다');
        }),
      ),
      job!,
      repository,
    );

    expect(await jobRepo.findJobState(pool, jobId)).toBe('cancelled');
    expect((await jobRepo.findJobById(pool, jobId))?.error).toBeNull();
  }, 60_000);

  it('취소가 없으면 평소대로 `completed`로 끝난다', async () => {
    const jobId = await runningJob('backfill', `${TARGET}-clean`);
    const job = await jobRepo.findJobById(pool, jobId);

    await runBackfillJob(backfillDeps(fakeClient(async () => undefined)), job!, repository);

    expect(await jobRepo.findJobState(pool, jobId)).toBe('completed');
  }, 60_000);
});
