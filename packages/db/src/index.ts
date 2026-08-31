/**
 * @prs/db — PostgreSQL 리포지터리 계층 (ADR-004).
 *
 * PostgreSQL이 시스템 오브 레코드다. Elasticsearch는 여기서 전량 재구성 가능한
 * 파생 뷰이며, 어떤 데이터도 검색 인덱스에만 존재해서는 안 된다.
 */

export const PACKAGE_NAME = '@prs/db' as const;

export { resolvePoolConfig, resolveAdminPoolConfig, ADMIN_DB_ROLE } from './config.js';
export type { DatabaseEnv } from './config.js';

export { createPool, createAdminPool, withTransaction } from './pool.js';
export { installTypeParsers } from './type-parsers.js';
// 앱이 pg에 직접 의존하지 않도록 타입만 다시 내보낸다 (의존 방향: apps → packages).
export type { Pool, PoolClient } from 'pg';

export {
  acquireAdvisorySessionLock,
  advisoryXactLock,
  jobClaimLockKey,
  deliveryLockKey,
  orgTeamSyncLockKey,
  releaseAdvisorySessionLock,
  releaseLockKey,
  repositoryScopeLockKey,
  safeMarkerLockKey,
  sequenceLockKey,
  tryAdvisoryXactLock,
  trySequenceSpaceLock,
} from './advisory-lock.js';

/*
 * 마이그레이션 실행기는 여기서 내보내지 않는다 (CR-018, DEV-072).
 *
 * `@prs/db/migrate` 서브패스로 가져간다. 진입점에 두면 `MIGRATIONS_DIR`의
 * `new URL('../migrations', import.meta.url)`이 **이 패키지를 간접적으로
 * 가져오는 모든 곳**의 번들 그래프에 들어간다 — 디렉터리라 어떤 번들러도
 * 해석하지 못하고, `web`의 빌드가 그것 때문에 깨졌다.
 *
 * 마이그레이션은 운영 도구이지 조회 경로가 아니므로 경계가 여기 있는 것이 옳다.
 */

export {
  ensureAllPartitions,
  ensureMonthlyPartitions,
  listPartitionBounds,
  partitionName,
  retentionCutoff,
  runPartitionRetention,
  PARTITIONED_TABLES,
  RETENTION_MONTHS,
} from './partitions.js';
export type {
  DroppedPartition,
  PartitionBound,
  PartitionDropFailure,
  PartitionedTable,
  RetentionResult,
} from './partitions.js';

export { seed, SEED_TARGET } from './seed.js';
export type { SeedCounts } from './seed.js';

export * from './repositories/index.js';

/** 재색인 울타리 (WP-035 / CR-045·046, DEV-296·308). */
export {
  FENCE_LOCK_TIMEOUT_MS,
  ReindexFenceUnavailableError,
  withReindexExclusive,
  withReindexWrite,
  type FenceShadowFailure,
  type ReindexWriteTargets,
} from './reindex-fence.js';
