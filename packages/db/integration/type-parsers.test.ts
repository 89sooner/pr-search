/**
 * BIGINT 컬럼이 숫자로 돌아오는지 (WP-005에서 발견한 결함의 회귀 테스트).
 *
 * node-postgres는 int8을 기본으로 **문자열**로 준다. 리포지터리 타입은 `number`로
 * 선언되어 있어 타입과 런타임 값이 어긋나 있었다. WP-005의 아웃박스 재적재가
 * `repository_id`를 이벤트 payload에 그대로 실으면서 `"4021"`이 나가 잡혔다.
 *
 * 이 테스트가 실패하면 파서가 빠진 것이고, 그 순간 파티션 키와 소비자 쪽
 * 비교가 조용히 어긋난다.
 */

import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as rawEventRepo from '../src/repositories/raw-event.js';
import * as repositoryRepo from '../src/repositories/repository.js';
import { migratedPool, truncate } from './helpers.js';

describe('BIGINT 타입 파서', () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = await migratedPool();
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await truncate(pool, 'raw_event', 'repository');
  });

  it('raw_event.repository_id가 문자열이 아니라 숫자로 돌아온다', async () => {
    const receivedAt = new Date();
    await rawEventRepo.insertRawEventIfAbsent(pool, {
      delivery_id: 'bigint-1',
      event_type: 'pull_request',
      action: 'closed',
      repository_id: 4021,
      received_at: receivedAt,
      payload: { number: 1 },
      payload_hash: 'a'.repeat(64),
      correlation_id: '00000000-0000-4000-8000-000000000001',
      queued_at: receivedAt,
    });

    const row = await rawEventRepo.findRawEventByDeliveryId(pool, 'bigint-1');
    expect(typeof row?.repository_id).toBe('number');
    expect(row?.repository_id).toBe(4021);
  });

  it('아웃박스 조회에서도 숫자로 돌아온다 — 재적재가 이 값을 파티션 키로 쓴다', async () => {
    const queuedAt = new Date(Date.now() - 60 * 60 * 1_000);
    await rawEventRepo.insertRawEventIfAbsent(pool, {
      delivery_id: 'bigint-2',
      event_type: 'push',
      action: null,
      repository_id: 5150,
      received_at: queuedAt,
      payload: { ref: 'refs/heads/main' },
      payload_hash: 'b'.repeat(64),
      correlation_id: '00000000-0000-4000-8000-000000000002',
      queued_at: queuedAt,
    });

    const rows = await rawEventRepo.findStuckOutboxEvents(pool, new Date(), 10);
    expect(rows).toHaveLength(1);
    expect(typeof rows[0]?.repository_id).toBe('number');
    expect(rows[0]?.repository_id).toBe(5150);
  });

  it('GitHub 규모의 저장소 ID도 정확히 왕복한다', async () => {
    // GitHub 저장소 ID는 현재 10자리대다. 안전 정수 상한(2^53-1)과는 한참 멀다.
    const largeId = 987_654_321_012;
    await repositoryRepo.upsertRepository(pool, {
      repository_id: largeId,
      owner: 'acme',
      name: 'huge',
      org_id: 77,
      visibility: 'private',
      sequence_branches: ['main'],
    });

    const row = await repositoryRepo.findRepositoryById(pool, largeId);
    expect(typeof row?.repository_id).toBe('number');
    expect(row?.repository_id).toBe(largeId);
  });
});
