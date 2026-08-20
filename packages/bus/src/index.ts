/**
 * @prs/bus — EventBus 포트와 Redis Streams 어댑터 (ADR-002).
 *
 * 워커는 `EventBus`만 본다. 어댑터 교체는 여기서 무엇을 만들어 넘기느냐의
 * 문제이며, 워커 코드는 바뀌지 않는다.
 */

export const PACKAGE_NAME = '@prs/bus' as const;

export type {
  DeliveredEvent,
  EventBus,
  EventEnvelope,
  EventHandler,
  HandlerDisposition,
  SubscribeOptions,
  Subscription,
} from './types.js';
export { ack, retry, deferUntil, deadLetter } from './types.js';

export { MAX_RETRIES, RETRY_DELAYS_MS, retryDelayMs } from './backoff.js';

export {
  CONSUMER_GROUPS,
  PARTITION_COUNTS,
  PARTITION_KEY_SOURCES,
  TOPICS,
  consumerGroup,
  isKnownTopic,
  partitionCount,
  partitionStream,
} from './topics.js';
export type { Topic } from './topics.js';

export { allPartitions, hashPartitionKey, partitionFor } from './partition.js';

export { ingestEnvelope, ingestStreamKey } from './ingest.js';

export { resolvePartitionOverrides, resolveRedisConfig } from './config.js';
export type { BusEnv, RedisConnectionConfig } from './config.js';

export { RedisStreamsEventBus, createRedisClient } from './redis-streams.js';
export type { RedisStreamsOptions } from './redis-streams.js';
// 앱이 ioredis에 직접 의존하지 않도록 타입만 다시 내보낸다 (의존 방향: apps → packages).
export type { Redis } from 'ioredis';

export { InMemoryEventBus } from './in-memory.js';
