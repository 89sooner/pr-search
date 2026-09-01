/** 워커 통합 테스트 공용 헬퍼. 실제 PostgreSQL과 실제 Redis에 붙는다. */

import { createPool, ensureAllPartitions, resolvePoolConfig, type Pool } from '@prs/db';
import { migrateUp } from '@prs/db/migrate';
import { createRedisClient, type Redis } from '@prs/bus';

export async function migratedPool(): Promise<Pool> {
  const env = { ...process.env };
  if (env['DATABASE_URL'] === undefined || env['DATABASE_URL'] === '') {
    env['POSTGRES_DB'] = env['POSTGRES_TEST_DB'] ?? 'prs_test';
  }
  const pool = createPool(resolvePoolConfig(env));
  await migrateUp(pool);
  /*
   * **파티션 창을 과거로도 연다** (DEV-500). `ensureAllPartitions`의 기본 `from`은
   * **현재 월**이라 앞으로 3개월치만 만드는데, 통합 시험 여럿이 `audit_record`·
   * `raw_event`에 **고정된 과거 날짜**로 쓴다 — 커서 순회와 범위 필터를 검증하려면
   * 결정적인 시각이 필요하기 때문이다. 달이 바뀌면 그 파티션이 사라져 삽입이
   * `23514`로 죽고, **개발자 DB에는 지난달 파티션이 남아 있어 CI에서만 드러난다.**
   *
   * **창을 3개월로 좁혀 둔 데에는 이유가 있다.** 넓히면 그 파티션들이 보존 잡의
   * 드롭 대상 구간에 들어가는데, 여기서 만든 것은 소유자가 `prs`이고 `prs_admin`은
   * 그것을 지우지 못해 `runPartitionRetention`의 `failed`에 쌓인다 — 12개월로 열었다가
   * `retention-role.test.ts`가 그렇게 깨졌다. 더 오래된 날짜가 필요한 시험은
   * `makePartition`처럼 **자기가 만들고 소유권까지 맞춘다.**
   */
  const now = new Date();
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 3, 1));
  await ensureAllPartitions(pool, 6, from);
  return pool;
}

/** 워커 테스트 전용 Redis DB. 버스 계약 테스트(15번)와 겹치지 않게 13번을 쓴다. */
export function createTestRedis(): Redis {
  const base = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
  return createRedisClient({
    url: `${base.replace(/\/\d+$/, '')}/13`,
    maxRetriesPerRequest: 1,
    connectTimeoutMs: 2_000,
    commandTimeoutMs: 2_000,
  });
}
