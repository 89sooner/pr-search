/**
 * 버스 통합 테스트 공용 헬퍼.
 *
 * 실제 Redis에 붙는다. 테스트 전용 DB(기본 15번)를 쓰고 매 테스트마다 비운다 —
 * 개발용 0번 DB를 테스트가 지우지 않게 분리한다.
 */

import { Redis } from 'ioredis';
import { CONTRACT_PARTITIONS, CONTRACT_TOPIC } from './contract.js';

export function testRedisUrl(): string {
  const explicit = process.env['REDIS_TEST_URL'];
  if (explicit !== undefined && explicit !== '') return explicit;
  const base = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
  return `${base.replace(/\/\d+$/, '')}/15`;
}

export function createTestRedis(): Redis {
  return new Redis(testRedisUrl(), {
    maxRetriesPerRequest: 1,
    connectTimeout: 2_000,
    commandTimeout: 2_000,
    enableOfflineQueue: true,
  });
}

/** 계약 테스트가 쓰는 파티션 수 고정값. */
export const TEST_PARTITION_OVERRIDES: Readonly<Record<string, number>> = {
  [CONTRACT_TOPIC]: CONTRACT_PARTITIONS,
};

export async function flushTestRedis(redis: Redis): Promise<void> {
  await redis.flushdb();
}
