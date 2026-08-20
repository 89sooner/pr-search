/**
 * `EventBus` 포트 (ADR-002).
 *
 * 시그니처는 ADR-002가 정한 그대로다. 워커는 이 인터페이스만 보고, 뒤에 무엇이
 * 있는지 알지 못한다 — Kafka 전환 임계를 넘으면 `KafkaEventBus`를 구현해 끼우고
 * 워커 코드는 건드리지 않는다.
 */

/** 발행하는 이벤트. `payload` 스키마는 이벤트 카탈로그(EVT-###)가 정한다. */
export interface EventEnvelope<T = unknown> {
  /** 이벤트 고유 식별자. 발행자가 만든다. */
  readonly event_id: string;
  /** 카탈로그 이름. 예: `ingestion.event_received` (EVT-ING-001). */
  readonly event_name: string;
  readonly correlation_id: string;
  /** 발생 시각 (ISO 8601). 전달 시각이 아니라 원인이 일어난 시각이다. */
  readonly occurred_at: string;
  readonly payload: T;
}

/** 소비자에게 전달된 이벤트. 버스가 전달 맥락을 덧붙인다. */
export interface DeliveredEvent<T = unknown> extends EventEnvelope<T> {
  readonly partition_key: string;
  readonly partition: number;
  /**
   * 이 이벤트의 **논리적** 전달 횟수. 처음이면 1이다.
   *
   * `defer`로 미룬 것은 여기 포함되지 않는다 (CR-010) — rate limit 대기가
   * 재시도 예산을 갉아먹지 않게 하려는 것이다.
   *
   * 재시도 판정(비동기 5.2)과 실패 대기열 이동 판정(FR-ING-007)에 쓴다.
   * 핸들러가 던지면 ack하지 않으므로 다음 전달에서 값이 올라간다.
   */
  readonly delivery_count: number;
  /** 어댑터 내부 메시지 ID. 조사·로그용이며 의미를 부여하지 않는다. */
  readonly message_id: string;
}

/**
 * 핸들러가 돌려주는 처분 (CR-010, DEV-014).
 *
 * **"반환하면 ack, 던지면 재전달" 둘만으로는 rate limit을 표현할 수 없다.**
 * GitHub이 "10분 뒤에 다시 오라"고 알려 줘도 재전달 간격이 고정이면 그 사이
 * 여러 번 재전달되고, 그 횟수가 재시도로 집계되어 회복 전에 실패 대기열로
 * 간다. 한도 대기는 실패가 아닌데 실패로 세는 셈이다.
 *
 * | 처분 | 의미 | 재시도 예산 |
 * | --- | --- | --- |
 * | `ack` | 처리 완료 | - |
 * | `retry` | 실제 실패. 표준 백오프(1·2·4·8·16초 + 지터)로 재시도 | 소비 |
 * | `defer` | 아직 때가 아니다. 지정 시각까지 미룬다 | **소비하지 않음** |
 * | `dead_letter` | 종료. 호출 측이 이미 기록했고 ack해서 파티션을 푼다 | - |
 */
export type HandlerDisposition =
  | { readonly kind: 'ack' }
  | { readonly kind: 'retry'; readonly reason?: string }
  | { readonly kind: 'defer'; readonly until: Date; readonly reason?: string }
  | { readonly kind: 'dead_letter'; readonly reason: string };

/**
 * 이벤트 처리기.
 *
 * 처분을 돌려주거나, 아무것도 돌려주지 않으면 `ack`으로 본다. 던지면 `retry`다
 * — 삼키고 정상 반환하면 그 이벤트는 조용히 사라진다.
 */
export type EventHandler<T = unknown> = (
  event: DeliveredEvent<T>,
) => Promise<HandlerDisposition | void>;

/** 처분 도우미. `{ kind: ... }`를 매번 적지 않게 한다. */
export const ack = (): HandlerDisposition => ({ kind: 'ack' });
export const retry = (reason?: string): HandlerDisposition =>
  reason === undefined ? { kind: 'retry' } : { kind: 'retry', reason };
export const deferUntil = (until: Date, reason?: string): HandlerDisposition =>
  reason === undefined ? { kind: 'defer', until } : { kind: 'defer', until, reason };
export const deadLetter = (reason: string): HandlerDisposition => ({ kind: 'dead_letter', reason });

export interface Subscription {
  /** 진행 중인 처리를 마치고 소비를 멈춘다. */
  close(): Promise<void>;
}

export interface SubscribeOptions {
  /**
   * 이 구독이 맡을 파티션. 생략하면 토픽의 전체 파티션을 맡는다.
   *
   * 워커를 여러 개 띄울 때 서로 겹치지 않게 나눠 준다. 같은 파티션을 두
   * 구독이 동시에 맡으면 파티션 키 단위 순서 보장이 깨진다.
   */
  readonly partitions?: readonly number[];
  /** 소비자 이름. 같은 그룹 안에서 유일해야 한다. 생략하면 자동 생성한다. */
  readonly consumer?: string;
  /** 한 번에 읽어 올 최대 건수. 읽어 온 뒤에는 파티션 순서대로 하나씩 처리한다. */
  readonly batchSize?: number;
  /** 새 이벤트를 기다리는 시간(ms). 이 주기로 깨어나 종료 여부도 확인한다. */
  readonly blockMs?: number;
  /**
   * 죽은 소비자의 미ack 이벤트를 회수하기까지 기다리는 시간(ms).
   *
   * 처리 중인 이벤트를 남이 가로채지 않을 만큼 길어야 한다.
   */
  readonly claimIdleMs?: number;
  /** 처리 실패를 알린다. 버스는 재전달만 책임지고 기록은 호출 측이 한다. */
  readonly onError?: (error: unknown, event: DeliveredEvent) => void;
  /** 백오프 지터용 난수원. 테스트가 결정론적으로 만들 때만 넘긴다. */
  readonly random?: () => number;
}

/**
 * ADR-002가 정한 포트.
 *
 * `partitionKey`가 같은 이벤트는 같은 파티션에 들어가고, 한 파티션은 한
 * 소비자만 맡는다. 이것이 (저장소, 브랜치) 단위 순서 보장(FR-SEQ-001)의 토대다.
 */
export interface EventBus {
  publish(topic: string, partitionKey: string, message: EventEnvelope): Promise<void>;
  subscribe(
    topic: string,
    group: string,
    handler: EventHandler,
    options?: SubscribeOptions,
  ): Promise<Subscription>;
  /** 연결을 닫는다. 열려 있는 구독도 함께 정리한다. */
  close(): Promise<void>;
}
