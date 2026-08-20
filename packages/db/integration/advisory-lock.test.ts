import type { Pool, PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sequenceLockKey, trySequenceSpaceLock } from '../src/advisory-lock.js';
import { migratedPool } from './helpers.js';

describe('advisory lock (WP-002 DoD 5, FR-SEQ-001 AC-6)', () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = await migratedPool();
  });

  afterAll(async () => {
    await pool.end();
  });

  it('같은 시퀀스 공간을 동시에 잡으면 하나만 성공한다', async () => {
    const first: PoolClient = await pool.connect();
    const second: PoolClient = await pool.connect();

    try {
      await first.query('BEGIN');
      await second.query('BEGIN');

      const firstLocked = await trySequenceSpaceLock(first, 1001, 'main');
      const secondLocked = await trySequenceSpaceLock(second, 1001, 'main');

      expect(firstLocked).toBe(true);
      // 대기하지 않고 즉시 false다. 워커는 재큐하고 끝낸다.
      expect(secondLocked).toBe(false);

      await first.query('COMMIT');

      // 트랜잭션 범위 락이라 커밋과 함께 풀린다.
      expect(await trySequenceSpaceLock(second, 1001, 'main')).toBe(true);
      await second.query('COMMIT');
    } finally {
      first.release();
      second.release();
    }
  });

  it('다른 시퀀스 공간은 서로를 막지 않는다', async () => {
    const first: PoolClient = await pool.connect();
    const second: PoolClient = await pool.connect();

    try {
      await first.query('BEGIN');
      await second.query('BEGIN');

      expect(await trySequenceSpaceLock(first, 1001, 'main')).toBe(true);
      expect(await trySequenceSpaceLock(second, 1001, 'release/24.1')).toBe(true);
      expect(await trySequenceSpaceLock(second, 1002, 'main')).toBe(true);

      await first.query('COMMIT');
      await second.query('COMMIT');
    } finally {
      first.release();
      second.release();
    }
  });

  it('락 키가 시퀀스 공간을 유일하게 식별한다', () => {
    expect(sequenceLockKey(1001, 'main')).toBe('seq:1001:main');
    expect(sequenceLockKey(1001, 'main')).not.toBe(sequenceLockKey(1002, 'main'));
    expect(sequenceLockKey(1001, 'main')).not.toBe(sequenceLockKey(1001, 'release/24.1'));
  });
});
