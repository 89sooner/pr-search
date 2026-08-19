import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as jobRepo from '../src/repositories/job.js';
import * as rawEventRepo from '../src/repositories/raw-event.js';
import { UNIQUE_VIOLATION, errorCode, migratedPool, truncate } from './helpers.js';

describe('DB 제약 (WP-002 DoD 3·4)', () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = await migratedPool();
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await truncate(pool, 'raw_event', 'job', 'safe_marker');
  });

  it('FR-ING-002 AC-1: 같은 delivery_id를 두 번 저장하면 유니크 위반이 발생한다', async () => {
    const receivedAt = new Date();
    const event = {
      delivery_id: 'dup-delivery-1',
      event_type: 'pull_request',
      action: 'closed',
      repository_id: 1001,
      received_at: receivedAt,
      payload: { number: 1 },
      payload_hash: 'sha256:test',
      correlation_id: '00000000-0000-4000-8000-000000000001',
    };

    await rawEventRepo.insertRawEvent(pool, event);

    await expect(rawEventRepo.insertRawEvent(pool, event)).rejects.toSatisfy(
      (error: unknown) => errorCode(error) === UNIQUE_VIOLATION,
    );
  });

  it('FR-ADMIN-002 AC-4: 같은 (type, target)에 활성 잡 두 개를 만들면 유니크 위반이 발생한다', async () => {
    await jobRepo.enqueueJob(pool, 'backfill', 'repository:1001', 'operator-1');

    await expect(jobRepo.enqueueJob(pool, 'backfill', 'repository:1001', 'operator-2')).rejects.toSatisfy(
      (error: unknown) => errorCode(error) === UNIQUE_VIOLATION,
    );
  });

  it('FR-ADMIN-002 AC-4: 앞선 잡이 끝나면 같은 대상에 새 잡을 만들 수 있다', async () => {
    const first = await jobRepo.enqueueJob(pool, 'reindex', 'prs-commits', 'operator-1');
    await jobRepo.finishJob(pool, first, 'completed');

    const second = await jobRepo.enqueueJob(pool, 'reindex', 'prs-commits', 'operator-2');
    expect(second).not.toBe(first);

    // 활성 잡은 항상 하나뿐이다.
    const active = await jobRepo.findActiveJob(pool, 'reindex', 'prs-commits');
    expect(active?.job_id).toBe(second);
  });

  it('FR-SEQ-006 AC-1: 안전 구간 표식은 저장소·브랜치당 현재 하나뿐이고 이전 것은 이력으로 남는다', async () => {
    const insert = async (mergeSeq: number): Promise<void> => {
      await pool.query(
        `INSERT INTO safe_marker (repository_id, base_branch, seq_epoch, merge_seq, created_by)
         VALUES (1001, 'main', 1, $1, 'release-manager')`,
        [mergeSeq],
      );
    };

    await insert(100);
    await expect(insert(200)).rejects.toSatisfy(
      (error: unknown) => errorCode(error) === UNIQUE_VIOLATION,
    );

    // 이전 표식을 대체 처리하면 새 표식을 넣을 수 있다.
    await pool.query('UPDATE safe_marker SET superseded_at = now() WHERE merge_seq = 100');
    await insert(200);

    const rows = await pool.query<{ count: string }>('SELECT count(*) AS count FROM safe_marker');
    expect(Number(rows.rows[0]?.count)).toBe(2);
  });
});
