/**
 * @prs/db — PostgreSQL 리포지터리 계층 (ADR-004).
 *
 * PostgreSQL이 시스템 오브 레코드다. Elasticsearch는 여기서 전량 재구성 가능한
 * 파생 뷰이며, 어떤 데이터도 검색 인덱스에만 존재해서는 안 된다.
 */

export const PACKAGE_NAME = '@prs/db' as const;

export { resolvePoolConfig } from './config.js';
export type { DatabaseEnv } from './config.js';

export { createPool, withTransaction } from './pool.js';
export { installTypeParsers } from './type-parsers.js';
// 앱이 pg에 직접 의존하지 않도록 타입만 다시 내보낸다 (의존 방향: apps → packages).
export type { Pool, PoolClient } from 'pg';

export {
  advisoryXactLock,
  deliveryLockKey,
  sequenceLockKey,
  tryAdvisoryXactLock,
  trySequenceSpaceLock,
} from './advisory-lock.js';

export { appliedVersions, loadMigrations, migrateDown, migrateUp, MIGRATIONS_DIR } from './migrate.js';
export type { Migration } from './migrate.js';

export { ensureAllPartitions, ensureMonthlyPartitions, partitionName, PARTITIONED_TABLES } from './partitions.js';
export type { PartitionedTable } from './partitions.js';

export { seed, SEED_TARGET } from './seed.js';
export type { SeedCounts } from './seed.js';

export * from './repositories/index.js';
