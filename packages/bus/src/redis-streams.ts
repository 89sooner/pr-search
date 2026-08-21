/**
 * `RedisStreamsEventBus` — ADR-002가 고른 시작 어댑터.
 *
 * **Redis Streams에는 파티션이 없다.** 소비자 그룹은 먼저 읽는 소비자에게
 * 아무 메시지나 준다. 그대로 쓰면 같은 저장소의 이벤트가 서로 다른 워커로
 * 흩어져 순서가 깨지고, (저장소, 브랜치) 단위 순서 보장(FR-SEQ-001)이 무너진다.
 *
 * 그래서 토픽 하나를 물리 스트림 N개(`prs:ingest:0` … `prs:ingest:15`)로 펴고,
 * 파티션 키 해시로 스트림을 고른다. 한 파티션은 한 구독만 맡는다. Kafka의
 * 파티션 모델을 Redis 위에 옮긴 것이라, 나중에 `KafkaEventBus`로 갈아 끼울 때
 * 의미가 그대로 대응된다.
 *
 * 순서에 대한 두 번째 규칙: **미ack 이벤트가 남은 파티션에서는 새 이벤트를 읽지
 * 않는다.** 실패한 이벤트를 건너뛰고 다음 것을 처리하면 그 순간 순서가 깨진다.
 * 대신 그 파티션은 재시도가 성공할 때까지 멈춘다 — 영영 실패하는 이벤트를
 * 실패 대기열로 보내는 일은 WP-009가 맡는다.
 */

import { Redis } from 'ioredis';
import { allPartitions, partitionFor } from './partition.js';
import { retryDelayMs } from './backoff.js';
import { CONSUMER_GROUPS, partitionCount, partitionStream } from './topics.js';
import type {
  DeliveredEvent,
  EventBus,
  EventEnvelope,
  EventHandler,
  HandlerDisposition,
  SubscribeOptions,
  Subscription,
} from './types.js';
import { resolvePartitionOverrides, resolveRedisConfig, type RedisConnectionConfig } from './config.js';

const DEFAULTS = {
  batchSize: 16,
  blockMs: 1_000,
  claimIdleMs: 30_000,
  /** 모든 파티션이 재시도 대기 중일 때 도는 간격. 바쁜 대기를 막는다. */
  idleSleepMs: 25,
} as const;

export interface RedisStreamsOptions {
  /** 토픽별 파티션 수 덮어쓰기. 생략하면 환경 변수와 카탈로그 기본값을 쓴다. */
  readonly partitionOverrides?: Readonly<Record<string, number>>;
}

export function createRedisClient(config: RedisConnectionConfig = resolveRedisConfig()): Redis {
  return new Redis(config.url, {
    maxRetriesPerRequest: config.maxRetriesPerRequest,
    connectTimeout: config.connectTimeoutMs,
    commandTimeout: config.commandTimeoutMs,
    // 오프라인 큐는 켜 둔다. 끄면 연결이 서기 전에 보낸 첫 명령이 곧바로
    // 실패한다 — 기동 직후가 딱 그렇다. 대신 재시도 상한과 명령 타임아웃으로
    // "끊겼을 때 빨리 실패한다"를 만든다. 발행 실패는 아웃박스가 받는다.
    enableOfflineQueue: true,
    lazyConnect: false,
  });
}

/** `XINFO`가 돌려주는 `[k, v, k, v, …]`를 객체로. 값이 문자열이 아닐 수 있다. */
function readPairs(entry: unknown): Record<string, unknown> {
  const record: Record<string, unknown> = {};
  if (!Array.isArray(entry)) return record;
  for (let index = 0; index + 1 < entry.length; index += 2) {
    const key = entry[index];
    if (typeof key === 'string') record[key] = entry[index + 1];
  }
  return record;
}

/** ioredis가 돌려주는 필드 배열(`[k, v, k, v, …]`)을 객체로 만든다. */
function fieldsToRecord(fields: readonly string[]): Record<string, string> {
  const record: Record<string, string> = {};
  for (let index = 0; index + 1 < fields.length; index += 2) {
    const key = fields[index];
    const value = fields[index + 1];
    if (key !== undefined && value !== undefined) record[key] = value;
  }
  return record;
}

type StreamEntry = readonly [id: string, fields: readonly string[]];

function isStreamEntry(value: unknown): value is StreamEntry {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    typeof value[0] === 'string' &&
    Array.isArray(value[1]) &&
    (value[1] as unknown[]).every((field) => typeof field === 'string')
  );
}

function toDelivered(
  entry: StreamEntry,
  partition: number,
  deliveryCount: number,
): DeliveredEvent | null {
  const fields = fieldsToRecord(entry[1]);
  const payloadRaw = fields['payload'];
  if (payloadRaw === undefined) return null;

  let payload: unknown;
  try {
    payload = JSON.parse(payloadRaw) as unknown;
  } catch {
    // 발행 측이 넣은 것이라 정상 경로에서는 일어나지 않는다. 깨진 것을 계속
    // 재전달하면 파티션이 멈추므로 건너뛰고 ack한다.
    return null;
  }

  return {
    event_id: fields['event_id'] ?? entry[0],
    event_name: fields['event_name'] ?? '',
    correlation_id: fields['correlation_id'] ?? '',
    occurred_at: fields['occurred_at'] ?? '',
    partition_key: fields['partition_key'] ?? '',
    partition,
    delivery_count: deliveryCount,
    message_id: entry[0],
    payload,
  };
}

export class RedisStreamsEventBus implements EventBus {
  readonly #redis: Redis;
  readonly #ownsClient: boolean;
  readonly #overrides: Readonly<Record<string, number>>;
  readonly #subscriptions = new Set<RedisSubscription>();

  constructor(redis?: Redis, options: RedisStreamsOptions = {}) {
    this.#redis = redis ?? createRedisClient();
    this.#ownsClient = redis === undefined;
    this.#overrides = options.partitionOverrides ?? resolvePartitionOverrides();
  }

  /** 토픽의 파티션 수. 구독 측이 파티션을 나눌 때도 쓴다. */
  partitions(topic: string): number {
    return partitionCount(topic, this.#overrides);
  }

  async publish(topic: string, partitionKey: string, message: EventEnvelope): Promise<void> {
    const partition = partitionFor(partitionKey, this.partitions(topic));
    await this.#redis.xadd(
      partitionStream(topic, partition),
      '*',
      'event_id',
      message.event_id,
      'event_name',
      message.event_name,
      'correlation_id',
      message.correlation_id,
      'occurred_at',
      message.occurred_at,
      'partition_key',
      partitionKey,
      'payload',
      JSON.stringify(message.payload),
    );
  }

  /**
   * 대기 길이 (FR-ADMIN-001 AC-1).
   *
   * `XLEN`이 아니다. Redis Streams는 ack해도 항목을 지우지 않으므로 `XLEN`은
   * **처리량**이지 적체가 아니다 — 잘 도는 파이프라인일수록 커진다. 소비자
   * 그룹이 아직 읽지 않은 수(`lag`)와 읽었지만 ack하지 않은 수(`pending`)를
   * 더한 값이 "아직 소비되지 않은" 것이다.
   *
   * 그룹이 아직 없으면(소비자가 한 번도 뜨지 않았다) 전량이 대기 중이다.
   */
  async depth(topic: string): Promise<number> {
    const group = CONSUMER_GROUPS[topic as keyof typeof CONSUMER_GROUPS];
    let total = 0;

    for (const partition of allPartitions(this.partitions(topic))) {
      const stream = partitionStream(topic, partition);
      if (group === undefined) {
        total += await this.#redis.xlen(stream);
        continue;
      }
      total += await this.#groupDepth(stream, group);
    }
    return total;
  }

  async #groupDepth(stream: string, group: string): Promise<number> {
    let groups: unknown;
    try {
      groups = await this.#redis.xinfo('GROUPS', stream);
    } catch {
      // 스트림 자체가 없다. 발행이 한 번도 없었다는 뜻이라 0이다.
      return 0;
    }
    if (!Array.isArray(groups)) return 0;

    for (const entry of groups) {
      const fields = readPairs(entry);
      if (fields['name'] !== group) continue;
      const pending = Number(fields['pending'] ?? 0);
      const lag = fields['lag'];
      // `lag`는 Redis 7+가 준다. 알 수 없으면(`null`) 전량에서 읽은 수를 뺀다.
      if (lag !== null && lag !== undefined) return Number(lag) + pending;
      const read = Number(fields['entries-read'] ?? 0);
      return Math.max(0, (await this.#redis.xlen(stream)) - read) + pending;
    }

    // 그룹이 없다. 아직 아무도 읽지 않았으므로 전량이 대기 중이다.
    return this.#redis.xlen(stream);
  }

  async subscribe(
    topic: string,
    group: string,
    handler: EventHandler,
    options: SubscribeOptions = {},
  ): Promise<Subscription> {
    const count = this.partitions(topic);
    const partitions = options.partitions ?? allPartitions(count);
    for (const partition of partitions) {
      if (!Number.isInteger(partition) || partition < 0 || partition >= count) {
        throw new Error(`${topic}의 파티션 범위를 벗어났다: ${String(partition)} (0..${String(count - 1)})`);
      }
    }

    // 블로킹 읽기는 연결을 점유한다. 발행용 연결과 섞으면 발행이 멈춘다.
    const connection = this.#redis.duplicate();
    for (const partition of partitions) {
      await ensureGroup(connection, partitionStream(topic, partition), group);
    }

    const subscription = new RedisSubscription(connection, topic, group, partitions, handler, options);
    this.#subscriptions.add(subscription);
    subscription.start();
    return {
      close: async (): Promise<void> => {
        await subscription.close();
        this.#subscriptions.delete(subscription);
      },
    };
  }

  async close(): Promise<void> {
    await Promise.all([...this.#subscriptions].map(async (subscription) => subscription.close()));
    this.#subscriptions.clear();
    if (this.#ownsClient) this.#redis.disconnect();
  }
}

/** 소비자 그룹을 만든다. 이미 있으면 그대로 둔다. */
async function ensureGroup(redis: Redis, stream: string, group: string): Promise<void> {
  try {
    // `$`가 아니라 `0`으로 만든다. `$`면 그룹 생성 이전에 쌓인 이벤트를
    // 영영 읽지 못한다 — 게이트웨이가 워커보다 먼저 떠 있는 것이 정상이다.
    await redis.xgroup('CREATE', stream, group, '0', 'MKSTREAM');
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes('BUSYGROUP')) throw error;
  }
}

/**
 * 재시도·유예 상태 (CR-010, DEV-014).
 *
 * Redis의 전달 횟수는 물리적이라 `defer`로 미룬 것까지 센다. 논리적 재시도만
 * 세려면 따로 기록해야 한다.
 *
 * 이 상태는 프로세스 메모리에만 있다. 재기동하면 논리 횟수가 0으로 돌아가
 * 이벤트가 5회보다 많이 재시도될 수 있다 — at-least-once 범위 안의 동작이며,
 * 실패 대기열은 정확성 경계가 아니라 운영 분류 도구다.
 */
interface AttemptState {
  /** 논리적 재시도 횟수. `defer`는 올리지 않는다. */
  retries: number;
  /** 이 시각 전에는 다시 전달하지 않는다. */
  nextAttemptAt: number;
}

/**
 * 재시도 상태를 찾는 열쇠.
 *
 * **스트림 엔트리 ID는 스트림 안에서만 유일하다.** `<밀리초>-<일련번호>` 형식이라
 * 같은 밀리초에 서로 다른 파티션 스트림에 하나씩 들어가면 둘 다 `…-0`이 된다.
 * ID만으로 상태를 찾으면 한 파티션에서 미룬 이벤트가 다른 파티션의 무관한
 * 이벤트를 함께 묶어 버린다 — 파티션 격리가 조용히 무너진다.
 */
function attemptKey(stream: string, messageId: string): string {
  return `${stream}\u0000${messageId}`;
}

class RedisSubscription {
  #running = false;
  #stopped = false;
  #loop: Promise<void> = Promise.resolve();
  readonly #attempts = new Map<string, AttemptState>();

  constructor(
    private readonly redis: Redis,
    private readonly topic: string,
    private readonly group: string,
    private readonly partitions: readonly number[],
    private readonly handler: EventHandler,
    private readonly options: SubscribeOptions,
  ) {}

  get #consumer(): string {
    return this.options.consumer ?? `${this.group}-${this.partitions.join('_')}`;
  }

  start(): void {
    if (this.#running) return;
    this.#running = true;
    this.#loop = this.#run();
  }

  async close(): Promise<void> {
    this.#stopped = true;
    await this.#loop;
    this.redis.disconnect();
  }

  async #run(): Promise<void> {
    const batchSize = this.options.batchSize ?? DEFAULTS.batchSize;
    const blockMs = this.options.blockMs ?? DEFAULTS.blockMs;
    const claimIdleMs = this.options.claimIdleMs ?? DEFAULTS.claimIdleMs;

    while (!this.#stopped) {
      try {
        const fresh: number[] = [];
        for (const partition of this.partitions) {
          if (this.#stopped) return;
          const hasPending = await this.#retryPending(partition, batchSize, claimIdleMs);
          if (!hasPending) fresh.push(partition);
        }

        if (this.#stopped) return;
        if (fresh.length === 0) {
          // 전 파티션이 재시도·유예 대기 중이다. 블로킹 읽기가 없으니 쉰다.
          // 다음 시도 시각까지 쉬되 blockMs로 잘라 종료 응답성을 지킨다 —
          // 10분 유예 때문에 10분 동안 종료 신호를 못 보면 안 된다.
          const earliest = this.#earliestAttemptAt();
          const waitMs = earliest === undefined ? DEFAULTS.idleSleepMs : earliest - Date.now();
          await sleep(Math.max(DEFAULTS.idleSleepMs, Math.min(waitMs, blockMs)));
          continue;
        }
        await this.#readFresh(fresh, batchSize, blockMs);
      } catch (error) {
        if (this.#stopped) return;
        // 연결이 끊겼거나 Redis가 내려갔다. 구독을 죽이지 않고 다시 시도한다 —
        // 여기서 나가면 Redis 복구 후에도 소비가 살아나지 않는다.
        this.options.onError?.(error, emptyEvent(this.topic));
        await sleep(DEFAULTS.idleSleepMs);
      }
    }
  }

  /**
   * 파티션에 남은 미ack 이벤트를 회수해 재시도한다.
   *
   * @returns 아직 미ack 이벤트가 남아 있으면 `true`. 이 파티션에서는 새 이벤트를
   *          읽지 않는다는 뜻이다.
   */
  async #retryPending(partition: number, batchSize: number, claimIdleMs: number): Promise<boolean> {
    const stream = partitionStream(this.topic, partition);
    const summary = await this.redis.xpending(stream, this.group);
    if (!Array.isArray(summary) || Number(summary[0] ?? 0) === 0) return false;

    // 회수 대상은 충분히 오래 방치된 것만이다. 처리 중인 이벤트를 가로채면
    // 같은 이벤트가 두 번 처리된다.
    const stale = await this.redis.xpending(stream, this.group, 'IDLE', claimIdleMs, '-', '+', batchSize);
    if (!Array.isArray(stale) || stale.length === 0) return true;

    const ids: string[] = [];
    for (const row of stale) {
      if (!Array.isArray(row) || typeof row[0] !== 'string') continue;
      ids.push(row[0]);
      // 이 구독이 처음 보는 메시지라면 Redis의 물리적 전달 횟수를 논리 횟수의
      // 하한으로 삼는다. 죽은 소비자에게서 넘겨받은 이벤트가 "처음 전달"로
      // 보이면 재시도 예산이 그때마다 되살아난다.
      const key = attemptKey(stream, row[0]);
      if (!this.#attempts.has(key)) {
        this.#attempts.set(key, { retries: Math.max(0, Number(row[3] ?? 1)), nextAttemptAt: 0 });
      }
    }
    if (ids.length === 0) return true;

    const claimed = await this.redis.xclaim(stream, this.group, this.#consumer, claimIdleMs, ...ids);
    if (!Array.isArray(claimed)) return true;

    for (const entry of claimed) {
      if (this.#stopped) return true;
      if (!isStreamEntry(entry)) continue;
      // 재시도가 또 실패했거나 아직 때가 아니다. 이 파티션은 여기서 멈춘다 —
      // 다음 것을 처리하면 순서가 깨진다.
      if (!(await this.#deliver(stream, entry, partition))) return true;
    }

    const remaining = await this.redis.xpending(stream, this.group);
    return Array.isArray(remaining) && Number(remaining[0] ?? 0) > 0;
  }

  async #readFresh(partitions: readonly number[], batchSize: number, blockMs: number): Promise<void> {
    const streams = partitions.map((partition) => partitionStream(this.topic, partition));
    const result = await this.redis.xreadgroup(
      'GROUP',
      this.group,
      this.#consumer,
      'COUNT',
      batchSize,
      'BLOCK',
      blockMs,
      'STREAMS',
      ...streams,
      ...streams.map(() => '>'),
    );
    if (!Array.isArray(result)) return;

    for (const streamResult of result) {
      if (!Array.isArray(streamResult) || typeof streamResult[0] !== 'string') continue;
      const stream = streamResult[0];
      const partition = Number(stream.slice(stream.lastIndexOf(':') + 1));
      const entries = streamResult[1];
      if (!Array.isArray(entries)) continue;

      for (const entry of entries) {
        if (this.#stopped) return;
        if (!isStreamEntry(entry)) continue;
        // 실패하면 그 파티션의 남은 이벤트는 이번 회차에서 건드리지 않는다.
        if (!(await this.#deliver(stream, entry, partition))) break;
      }
    }
  }

  /**
   * @returns ack해서 파티션을 진행시켰으면 `true`. 미ack로 남겼으면 `false`.
   */
  async #deliver(stream: string, entry: StreamEntry, partition: number): Promise<boolean> {
    const messageId = entry[0];
    const key = attemptKey(stream, messageId);
    const state = this.#attempts.get(key);
    const now = Date.now();

    // 아직 때가 아니다. 핸들러를 부르지 않는다 — retryAt 이전에 다시
    // 나가지 않는다는 계약이 여기서 지켜진다.
    if (state !== undefined && state.nextAttemptAt > now) return false;

    const event = toDelivered(entry, partition, (state?.retries ?? 0) + 1);
    if (event === null) {
      await this.redis.xack(stream, this.group, messageId);
      this.#attempts.delete(key);
      return true;
    }

    let disposition: HandlerDisposition;
    try {
      disposition = (await this.handler(event)) ?? { kind: 'ack' };
    } catch (error) {
      this.options.onError?.(error, event);
      disposition = { kind: 'retry' };
    }

    switch (disposition.kind) {
      case 'ack':
      case 'dead_letter': {
        // 종료 상태다. ack해서 파티션을 푼다 — 실패 대기열 기록은 호출 측 몫이고,
        // 여기서 계속 미ack로 두면 그 파티션이 영영 막힌다.
        await this.redis.xack(stream, this.group, messageId);
        this.#attempts.delete(key);
        return true;
      }
      case 'defer': {
        // 재시도 횟수를 올리지 않는다. 한도 대기는 실패가 아니다.
        this.#attempts.set(key, {
          retries: state?.retries ?? 0,
          nextAttemptAt: disposition.until.getTime(),
        });
        return false;
      }
      case 'retry': {
        const retries = (state?.retries ?? 0) + 1;
        this.#attempts.set(key, {
          retries,
          nextAttemptAt: Date.now() + retryDelayMs(retries, this.options.random ?? Math.random),
        });
        return false;
      }
    }
  }

  /** 이 파티션에서 다음 전달이 가능해지는 시각. 없으면 `undefined`. */
  #earliestAttemptAt(): number | undefined {
    let earliest: number | undefined;
    for (const state of this.#attempts.values()) {
      if (earliest === undefined || state.nextAttemptAt < earliest) earliest = state.nextAttemptAt;
    }
    return earliest;
  }
}

function emptyEvent(topic: string): DeliveredEvent {
  return {
    event_id: '',
    event_name: '',
    correlation_id: '',
    occurred_at: '',
    partition_key: topic,
    partition: -1,
    delivery_count: 0,
    message_id: '',
    payload: null,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
