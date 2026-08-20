/**
 * `InMemoryEventBus` — 프로세스 안에서만 도는 어댑터.
 *
 * 존재 이유는 두 가지다. 하나는 워커 단위 테스트가 Redis 없이 돌게 하는 것이고,
 * 다른 하나는 **계약 테스트가 Redis에만 맞춰 쓰이지 않았음을 증명하는 것**이다.
 * 같은 계약 테스트를 두 어댑터가 통과하지 못하면 그 계약은 어댑터 교체
 * 가능성(ADR-002)을 보장하지 못한다.
 *
 * 영속성이 없으므로 운영에서는 쓰지 않는다.
 */

import { allPartitions, partitionFor } from './partition.js';
import { retryDelayMs } from './backoff.js';
import { partitionCount } from './topics.js';
import type {
  DeliveredEvent,
  EventBus,
  EventEnvelope,
  EventHandler,
  HandlerDisposition,
  SubscribeOptions,
  Subscription,
} from './types.js';

interface StoredMessage {
  readonly envelope: EventEnvelope;
  readonly partitionKey: string;
  readonly partition: number;
  readonly messageId: string;
  /** 논리적 재시도 횟수. `defer`는 올리지 않는다 (CR-010). */
  retries: number;
  /** 이 시각 전에는 다시 전달하지 않는다. */
  nextAttemptAt: number;
}

interface GroupCursor {
  /** 아직 아무에게도 전달되지 않은 메시지 큐. */
  readonly backlog: StoredMessage[];
  /** 전달했지만 ack되지 않은 메시지. Redis의 PEL에 해당한다. */
  readonly pending: StoredMessage[];
}

const POLL_MS = 5;

export class InMemoryEventBus implements EventBus {
  readonly #partitionOverrides: Readonly<Record<string, number>>;
  /** `topic:partition` → `group` → 커서 */
  readonly #cursors = new Map<string, Map<string, GroupCursor>>();
  readonly #subscriptions = new Set<InMemorySubscription>();
  #sequence = 0;

  constructor(partitionOverrides: Readonly<Record<string, number>> = {}) {
    this.#partitionOverrides = partitionOverrides;
  }

  partitions(topic: string): number {
    return partitionCount(topic, this.#partitionOverrides);
  }

  #cursorsFor(topic: string, partition: number): Map<string, GroupCursor> {
    const key = `${topic}:${String(partition)}`;
    let groups = this.#cursors.get(key);
    if (groups === undefined) {
      groups = new Map<string, GroupCursor>();
      this.#cursors.set(key, groups);
    }
    return groups;
  }

  #cursor(topic: string, partition: number, group: string): GroupCursor {
    const groups = this.#cursorsFor(topic, partition);
    let cursor = groups.get(group);
    if (cursor === undefined) {
      cursor = { backlog: [], pending: [] };
      groups.set(group, cursor);
    }
    return cursor;
  }

  async publish(topic: string, partitionKey: string, message: EventEnvelope): Promise<void> {
    const partition = partitionFor(partitionKey, this.partitions(topic));
    this.#sequence += 1;
    const stored: StoredMessage = {
      envelope: message,
      partitionKey,
      partition,
      messageId: `${String(Date.now())}-${String(this.#sequence)}`,
      retries: 0,
      nextAttemptAt: 0,
    };

    const groups = this.#cursorsFor(topic, partition);
    if (groups.size === 0) {
      // 아직 구독자가 없다. Redis Streams는 그룹을 `0`부터 만들어 이전 이벤트도
      // 읽으므로, 같은 동작을 내려면 어딘가 담아 둬야 한다.
      groups.set('__unclaimed__', { backlog: [stored], pending: [] });
      return;
    }
    for (const cursor of groups.values()) cursor.backlog.push(stored);
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
      // 구독보다 먼저 발행된 이벤트를 이 그룹의 백로그로 옮긴다.
      const groups = this.#cursorsFor(topic, partition);
      const unclaimed = groups.get('__unclaimed__');
      const cursor = this.#cursor(topic, partition, group);
      if (unclaimed !== undefined) {
        cursor.backlog.push(...unclaimed.backlog);
        groups.delete('__unclaimed__');
      }
    }

    const subscription = new InMemorySubscription(
      partitions.map((partition) => this.#cursor(topic, partition, group)),
      partitions,
      handler,
      options,
    );
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
  }
}

class InMemorySubscription {
  #stopped = false;
  #loop: Promise<void> = Promise.resolve();

  constructor(
    private readonly cursors: readonly GroupCursor[],
    private readonly partitions: readonly number[],
    private readonly handler: EventHandler,
    private readonly options: SubscribeOptions,
  ) {}

  start(): void {
    this.#loop = this.#run();
  }

  async close(): Promise<void> {
    this.#stopped = true;
    await this.#loop;
  }

  async #run(): Promise<void> {
    const random = this.options.random ?? Math.random;

    while (!this.#stopped) {
      let worked = false;
      for (let index = 0; index < this.cursors.length; index += 1) {
        if (this.#stopped) return;
        const cursor = this.cursors[index];
        const partition = this.partitions[index];
        if (cursor === undefined || partition === undefined) continue;

        // Redis 어댑터와 같은 규칙 둘.
        //   1. 미ack가 남은 파티션에서는 새 것을 읽지 않는다 (순서 보장)
        //   2. 재전달·유예 시각 전에는 핸들러를 부르지 않는다 (CR-010)
        const pending = cursor.pending[0];
        let message: StoredMessage | undefined;
        if (pending !== undefined) {
          if (Date.now() < pending.nextAttemptAt) continue;
          message = pending;
        } else {
          message = cursor.backlog.shift();
          if (message === undefined) continue;
          cursor.pending.push(message);
        }

        worked = true;
        const event: DeliveredEvent = {
          ...message.envelope,
          partition_key: message.partitionKey,
          partition,
          delivery_count: message.retries + 1,
          message_id: message.messageId,
        };

        let disposition: HandlerDisposition;
        try {
          disposition = (await this.handler(event)) ?? { kind: 'ack' };
        } catch (error) {
          this.options.onError?.(error, event);
          disposition = { kind: 'retry' };
        }

        switch (disposition.kind) {
          case 'ack':
          case 'dead_letter':
            // 종료 상태다. 파티션을 푼다.
            cursor.pending.shift();
            break;
          case 'defer':
            // 재시도 횟수를 올리지 않는다.
            message.nextAttemptAt = disposition.until.getTime();
            break;
          case 'retry':
            message.retries += 1;
            message.nextAttemptAt = Date.now() + retryDelayMs(message.retries, random);
            break;
        }
      }
      // 항상 매크로태스크로 한 번 넘긴다. 마이크로태스크만 이어 붙이면
      // setTimeout이 영영 돌지 못한다.
      await sleep(worked ? 0 : POLL_MS);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
