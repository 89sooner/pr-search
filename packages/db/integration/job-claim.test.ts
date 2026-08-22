/**
 * 잡 claim의 동시 실행 상한 (FR-ING-006 AC-6, CR-022 DEV-107).
 *
 * **여기에 두는 이유가 있다.** 같은 단언이 `jobs/backfill.test.ts`에도 있지만
 * 그 파일은 Elasticsearch를 요구해 ES 없는 환경에서는 아예 뜨지 않는다.
 * 상한은 PostgreSQL만의 성질이므로 PostgreSQL만 있으면 판정할 수 있어야
 * 한다 — 실제로 이 결함은 ES가 없어 로컬에서 못 돌린 채 CI로 나갔다.
 *
 * 검증: `npx vitest run --config vitest.integration.config.ts packages/db/integration/job-claim.test.ts`
 */

import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as jobRepo from '../src/repositories/job.js';
import { migratedPool, truncate } from './helpers.js';

const MAX = 3;

describe('claimNextJob 동시 실행 상한 (FR-ING-006 AC-6)', () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = await migratedPool();
  }, 60_000);

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await truncate(pool, 'job');
  });

  async function enqueue(count: number, prefix = 'acme/repo'): Promise<void> {
    for (let index = 0; index < count; index += 1) {
      await jobRepo.enqueueJob(pool, 'backfill', `${prefix}-${String(index)}`, 'alice');
    }
  }

  function running(): Promise<number> {
    return pool
      .query<{ count: number }>(`SELECT count(*)::int AS count FROM job WHERE state = 'running'`)
      .then((result) => result.rows[0]?.count ?? 0);
  }

  it('**동시에 다섯이 잡아도 셋만 돈다** — 이것이 상한의 전부다', async () => {
    /*
     * 순차 호출로는 이 결함이 드러나지 않는다. READ COMMITTED에서 각 문장은
     * **커밋된** 것만 보므로, 동시에 시작한 다섯은 모두 `running = 0`을 읽고
     * 서로 다른 행을 잡아 모두 시작한다. `FOR UPDATE SKIP LOCKED`는 같은
     * 행을 둘이 잡는 것만 막지, 세기를 직렬화하지 않는다 (DEV-107).
     */
    await enqueue(5);

    const claimed = await Promise.all(
      Array.from({ length: 5 }, () => jobRepo.claimNextJob(pool, 'backfill', MAX)),
    );

    expect(claimed.filter((one) => one !== undefined)).toHaveLength(MAX);
    expect(await running()).toBe(MAX);
  });

  it('여러 회차를 반복해도 넘지 않는다 — 한 번 통과는 우연일 수 있다', async () => {
    for (let round = 0; round < 5; round += 1) {
      await truncate(pool, 'job');
      await enqueue(5, `acme/round${String(round)}`);

      const claimed = await Promise.all(
        Array.from({ length: 5 }, () => jobRepo.claimNextJob(pool, 'backfill', MAX)),
      );

      expect(claimed.filter((one) => one !== undefined)).toHaveLength(MAX);
      expect(await running()).toBe(MAX);
    }
  });

  it('**유형이 다르면 서로를 막지 않는다** — 상한은 유형마다 따로다', async () => {
    await enqueue(3, 'acme/backfill');
    for (let index = 0; index < 3; index += 1) {
      await jobRepo.enqueueJob(pool, 'reindex', `acme/reindex-${String(index)}`, 'alice');
    }

    const claimed = await Promise.all([
      ...Array.from({ length: 3 }, () => jobRepo.claimNextJob(pool, 'backfill', MAX)),
      ...Array.from({ length: 3 }, () => jobRepo.claimNextJob(pool, 'reindex', MAX)),
    ]);

    /*
     * 여섯 모두 돈다 — 상한이 유형마다 따로 세어지기 때문이다.
     *
     * 이 시험이 거는 것은 **세기의 범위**이지 락의 범위가 아니다. 락을
     * 전역으로 잡아도 세기가 유형별이면 여섯은 그대로 돈다(느려질 뿐이다).
     * 락을 유형 단위로 두는 이유는 처리량이고, 그것은 시험이 아니라
     * `jobClaimLockKey`의 주석이 말한다.
     */
    expect(claimed.filter((one) => one !== undefined)).toHaveLength(6);
  });

  it('하나가 끝나면 기다리던 자리가 열린다', async () => {
    await enqueue(4);
    const first = await jobRepo.claimNextJob(pool, 'backfill', MAX);
    await jobRepo.claimNextJob(pool, 'backfill', MAX);
    await jobRepo.claimNextJob(pool, 'backfill', MAX);
    expect(await jobRepo.claimNextJob(pool, 'backfill', MAX)).toBeUndefined();

    await jobRepo.finishJob(pool, first!.job_id, 'completed');

    expect(await jobRepo.claimNextJob(pool, 'backfill', MAX)).toBeDefined();
  });

  it('`paused`는 자리를 차지하지 않는다 — 운영자가 멈춘 잡은 자원을 쓰지 않는다', async () => {
    await enqueue(4);
    const first = await jobRepo.claimNextJob(pool, 'backfill', MAX);
    await jobRepo.claimNextJob(pool, 'backfill', MAX);
    await jobRepo.claimNextJob(pool, 'backfill', MAX);
    await jobRepo.transitionJob(pool, first!.job_id, 'pause');

    expect(await jobRepo.claimNextJob(pool, 'backfill', MAX)).toBeDefined();
  });

  it('같은 행을 둘이 잡지 않는다 — 동시에 잡힌 잡은 서로 다르다', async () => {
    await enqueue(5);

    const claimed = (
      await Promise.all(Array.from({ length: 5 }, () => jobRepo.claimNextJob(pool, 'backfill', MAX)))
    ).filter((one): one is NonNullable<typeof one> => one !== undefined);

    expect(new Set(claimed.map((job) => job.job_id)).size).toBe(claimed.length);
  });
});
